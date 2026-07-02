import os
import re
from uuid import uuid4
from urllib.parse import urlparse

from flask import Blueprint, jsonify, current_app, redirect, request, send_file
from sqlmodel import col, select
from datetime import datetime, UTC

from settings import ASSETS_DIR, SUPABASE_QUESTION_ASSET_BUCKET
from auth.supabase import get_current_user_id, supabase_auth_required
from storage import storage_configured, public_url as storage_public_url, upload_object
from questions.db import get_session
from questions.types import (
    AssetDB,
    PaperCreate,
    PaperDB,
    PaperOutcome,
    PaperVerificationRequestDB,
    PaperVerificationRequestRead,
    PaperUpdate,
    QuestionDB,
    QuestionOutcome,
    QuestionSyllabusPointDB,
    paper_db_to_meta_read,
    paper_db_to_read,
    question_db_to_read,
    question_verified_fingerprint,
)
from questions.utils import _build_question_db
from admin import is_admin
from io import BytesIO
from flask import Response


q_bp = Blueprint("tppr-questions", __name__)
ASSET_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")

def _normalised_codes(values) -> list[str]:
    if not values:
        return []
    codes = [
        str(value).strip()
        for value in values
        if str(value).strip()
    ]
    return list(dict.fromkeys(codes))


def _renumber_questions(questions) -> list[dict]:
    if not isinstance(questions, list):
        return []
    return [
        {
            **question,
            "number": index,
        }
        for index, question in enumerate(questions, start=1)
        if isinstance(question, dict)
    ]


def _replace_paper_outcomes(session, paper_id: str, outcomes) -> None:
    existing = session.exec(
        select(PaperOutcome).where(PaperOutcome.paper_id == paper_id)
    ).all()
    for outcome in existing:
        session.delete(outcome)
    if existing:
        session.flush()
    for code in _normalised_codes(outcomes):
        session.add(PaperOutcome(paper_id=paper_id, outcome_code=code))


def _removed_response():
    response = jsonify({"message": "Paper has been removed", "visibility": "removed"})
    response.headers["Cache-Control"] = "no-store"
    return response, 410


def _valid_asset_id(asset_id: str) -> bool:
    return bool(ASSET_ID_RE.fullmatch(asset_id))


def _valid_source_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _can_view_paper(paper: PaperDB, user_id: str | None) -> bool:
    if user_id and is_admin(str(user_id)):
        return True
    if paper.visibility == "removed":
        return False
    if paper.visibility == "public":
        return True
    return bool(user_id and paper.author_id == str(user_id))


def _removed_source_paper_ids(session, paper: PaperDB) -> set[str]:
    source_ids = {
        q.source_paper_id
        for q in paper.questions
        if q.source_paper_id
    }
    if not source_ids:
        return set()

    removed = session.exec(
        select(PaperDB).where(
            col(PaperDB.id).in_(source_ids),
            PaperDB.visibility == "removed",
        )
    ).all()
    return {p.id for p in removed}


def _paper_read_for_viewer(session, paper: PaperDB, user_id: str | None):
    admin_viewer = bool(user_id and is_admin(str(user_id)))
    owner_viewer = bool(user_id and paper.author_id == str(user_id))
    removed_sources = _removed_source_paper_ids(session, paper)
    visible_questions = []

    for q in paper.questions:
        source_removed = bool(q.source_paper_id and q.source_paper_id in removed_sources)
        if source_removed and not (admin_viewer or owner_viewer):
            continue
        visible_questions.append(
            question_db_to_read(
                q,
                source_removed=source_removed and owner_viewer and not admin_viewer,
                paper_verified=paper.verified,
            )
        )
    
    visible_questions.sort(key=lambda q: q.number)

    if admin_viewer or owner_viewer:
        return paper_db_to_read(paper, questions=visible_questions)

    return paper_db_to_read(
        paper,
        questions=visible_questions,
        question_count=len(visible_questions),
        total_marks=sum(q.marks for q in paper.questions if not (
            q.source_paper_id and q.source_paper_id in removed_sources
        )),
    )


def _clone_question_for_remix(
    source: QuestionDB,
    *,
    target_paper_id: str,
    author_id: str,
    number: int,
    now: datetime,
) -> QuestionDB:
    return QuestionDB(
        id=str(uuid4()),
        paper_id=target_paper_id,
        author_id=author_id,
        number=number,
        type=source.type,
        marks=source.marks,
        stimulus_json=source.stimulus_json,
        content_json=source.content_json,
        parts_json=source.parts_json,
        options_json=source.options_json,
        topics_json=source.topics_json,
        answer=source.answer,
        difficulty=source.difficulty,
        remixed_from=source.id,
        source_question_id=source.source_question_id or source.id,
        source_paper_id=source.source_paper_id or source.paper_id,
        created_at=now,
        updated_at=now,
    )


def _stamp_verified_question_fingerprints(paper: PaperDB) -> None:
    for question in paper.questions:
        question.verified_fingerprint = question_verified_fingerprint(question)


def _clear_verified_question_fingerprints(paper: PaperDB) -> None:
    for question in paper.questions:
        question.verified_fingerprint = None


def _verification_request_read(request_row: PaperVerificationRequestDB) -> dict:
    return PaperVerificationRequestRead.model_validate(request_row).model_dump(
        mode="json"
    )


# --- Assets ---

@q_bp.route("/api/papers/<string:paper_id>/assets", methods=["POST"])
@supabase_auth_required()
def upload_asset(paper_id):
    user_id = str(get_current_user_id())
    asset_file = request.files.get("file")
    asset_id = request.form.get("asset_id") or str(uuid4())

    if not asset_file:
        return jsonify({"message": "No file provided"}), 400
    if not _valid_asset_id(asset_id):
        return jsonify({"message": "Invalid asset id"}), 400
    if not (asset_file.mimetype or "").startswith("image/"):
        return jsonify({"message": "Only image assets are supported"}), 400

    with get_session() as session:
        paper = session.get(PaperDB, paper_id)
        if not paper:
            return jsonify({"message": "Paper not found"}), 404
        if paper.visibility == "removed":
            return _removed_response()
        if paper.author_id != user_id:
            return jsonify({"message": "Forbidden"}), 403

        existing = session.get(AssetDB, asset_id)
        if existing and existing.paper_id != paper_id:
            return jsonify({"message": "Asset id already belongs to another paper"}), 409

        file_data = asset_file.read()
        now = datetime.now(UTC)

        # When Supabase Storage is configured, push the bytes to the public
        # question-assets bucket and keep only an empty placeholder in Postgres
        # (the `data` column is NOT NULL). If the upload fails, fall back to
        # storing the bytes in the DB so the asset still resolves.
        stored_data = b""
        if storage_configured():
            try:
                upload_object(
                    SUPABASE_QUESTION_ASSET_BUCKET,
                    f"{paper_id}/{asset_id}",
                    asset_file.mimetype or "application/octet-stream",
                    file_data,
                )
            except Exception:
                stored_data = file_data
        else:
            stored_data = file_data

        if existing:
            existing.uploader_id = user_id
            existing.mime_type = asset_file.mimetype
            existing.filename = asset_file.filename
            existing.data = stored_data
            existing.updated_at = now
            asset = existing
        else:
            asset = AssetDB(
                id=asset_id,
                paper_id=paper_id,
                uploader_id=user_id,
                mime_type=asset_file.mimetype,
                filename=asset_file.filename,
                data=stored_data,
                created_at=now,
                updated_at=now,
            )
        session.add(asset)
        session.commit()

        return jsonify({
            "id": asset.id,
            "paper_id": asset.paper_id,
            "mime_type": asset.mime_type,
        }), 201

@q_bp.route("/api/assets/<string:asset_id>", methods=["GET"])
@supabase_auth_required(optional=True)
def get_asset(asset_id):
    if not _valid_asset_id(asset_id):
        return jsonify({"message": "Asset not found"}), 404

    user_id = get_current_user_id()
    with get_session() as session:
        asset = session.get(AssetDB, asset_id)
        if not asset:
            return jsonify({"message": "Asset not found"}), 404

        paper = session.get(PaperDB, asset.paper_id)
        if not paper or not _can_view_paper(paper, str(user_id) if user_id else None):
            return jsonify({"message": "Asset not found"}), 404

        # New uploads live in the public Supabase Storage bucket and have an
        # empty `data` placeholder; redirect to the public URL. Legacy rows
        # (written before Storage was configured) still carry their bytes and
        # are served from the DB.
        if storage_configured() and not asset.data:
            return redirect(
                storage_public_url(
                    SUPABASE_QUESTION_ASSET_BUCKET,
                    f"{asset.paper_id}/{asset.id}",
                )
            )

        response = send_file(
            BytesIO(asset.data),
            mimetype=asset.mime_type,
            download_name=asset.filename,
        )
        response.headers["X-Paper-Id"] = asset.paper_id
        response.headers["Cache-Control"] = "private, max-age=31536000"
        return response

# --- Papers ---

@q_bp.route("/api/papers/search", methods=["GET"])
def search_papers():
    q = request.args.get("q")
    subject = request.args.get("subject")
    source = request.args.get("source")
    course_level = request.args.get("course_level")
    year = request.args.get("year")
    verified = request.args.get("verified")
    school = request.args.get("school")
    topic = request.args.get("topic")
    outcome = request.args.get("outcome")
    min_marks = request.args.get("min_marks")
    max_marks = request.args.get("max_marks")
    min_duration = request.args.get("min_duration")
    max_duration = request.args.get("max_duration")
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 20))

    with get_session() as session:
        statement = select(PaperDB).where(PaperDB.visibility == "public")

        if q:
            statement = statement.where(
                col(PaperDB.title).contains(q) | col(PaperDB.subject).contains(q)
            )
        if subject:
            statement = statement.where(PaperDB.subject == subject)
        if source:
            statement = statement.where(PaperDB.source == source)
        if course_level:
            statement = statement.where(PaperDB.course_level == course_level)
        if year:
            statement = statement.where(PaperDB.year == int(year))
        if verified == "true":
            statement = statement.where(PaperDB.verified.is_(True))
        elif verified == "false":
            statement = statement.where(PaperDB.verified.is_(False))
        if school:
            statement = statement.where(col(PaperDB.school).contains(school))
        if topic:
            statement = statement.where(col(PaperDB.topics_json).contains(topic))
        if outcome:
            statement = statement.join(PaperOutcome).where(
                col(PaperOutcome.outcome_code).contains(outcome)
            )
        if min_marks:
            statement = statement.where(PaperDB.total_marks >= int(min_marks))
        if max_marks:
            statement = statement.where(PaperDB.total_marks <= int(max_marks))
        if min_duration:
            statement = statement.where(PaperDB.duration_minutes >= int(min_duration))
        if max_duration:
            statement = statement.where(PaperDB.duration_minutes <= int(max_duration))

        total = len(session.exec(statement).all())
        statement = statement.offset((page - 1) * per_page).limit(per_page)
        papers = session.exec(statement).all()

        return jsonify(
            {
                "papers": [paper_db_to_meta_read(p).model_dump(mode="json") for p in papers],
                "total": total,
                "page": page,
                "per_page": per_page,
            }
        )


@q_bp.route("/api/papers/<string:paper_id>/verification-request", methods=["GET"])
@supabase_auth_required()
def get_paper_verification_request(paper_id):
    user_id = str(get_current_user_id())

    with get_session() as session:
        paper = session.get(PaperDB, paper_id)
        if not paper:
            return jsonify({"message": "Paper not found"}), 404
        if paper.visibility == "removed":
            return _removed_response()
        if paper.author_id != user_id and not is_admin(user_id):
            return jsonify({"message": "Forbidden"}), 403

        rows = session.exec(
            select(PaperVerificationRequestDB)
            .where(PaperVerificationRequestDB.paper_id == paper_id)
            .order_by(col(PaperVerificationRequestDB.created_at).desc())
            .limit(1)
        ).all()
        if not rows:
            return jsonify({"request": None}), 200
        return jsonify({"request": _verification_request_read(rows[0])}), 200


@q_bp.route("/api/papers/<string:paper_id>/verification-request", methods=["POST"])
@supabase_auth_required()
def submit_paper_verification_request(paper_id):
    user_id = str(get_current_user_id())
    data = request.get_json(silent=True) or {}
    source_name = str(data.get("source_name") or "").strip()
    source_url = str(data.get("source_url") or "").strip() or None
    note = str(data.get("note") or "").strip() or None

    if not source_name:
        return jsonify({"message": "source_name is required"}), 400
    if source_url and not _valid_source_url(source_url):
        return jsonify({"message": "source_url must be an http(s) URL"}), 400

    with get_session() as session:
        paper = session.get(PaperDB, paper_id)
        if not paper:
            return jsonify({"message": "Paper not found"}), 404
        if paper.visibility == "removed":
            return _removed_response()
        if paper.author_id != user_id:
            return jsonify({"message": "Forbidden"}), 403
        if paper.verified:
            return jsonify({"message": "Paper is already verified"}), 409

        existing = session.exec(
            select(PaperVerificationRequestDB)
            .where(PaperVerificationRequestDB.paper_id == paper_id)
            .where(PaperVerificationRequestDB.status == "pending")
        ).first()
        if existing:
            return jsonify({"request": _verification_request_read(existing)}), 200

        now = datetime.now(UTC)
        request_row = PaperVerificationRequestDB(
            id=str(uuid4()),
            paper_id=paper_id,
            requester_id=user_id,
            source_name=source_name,
            source_url=source_url,
            note=note,
            created_at=now,
            updated_at=now,
        )
        session.add(request_row)
        session.commit()
        session.refresh(request_row)
        return jsonify({"request": _verification_request_read(request_row)}), 201

@q_bp.route("/api/papers", methods=["GET"])
@supabase_auth_required()
def list_papers():
    user_id = get_current_user_id()
    q = request.args.get("q")
    subject = request.args.get("subject")
    source = request.args.get("source")
    course_level = request.args.get("course_level")
    year = request.args.get("year")
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 20))

    with get_session() as session:
        statement = select(PaperDB).where(PaperDB.author_id == str(user_id))

        if q:
            statement = statement.where(
                col(PaperDB.title).contains(q) | col(PaperDB.subject).contains(q)
            )
        if subject:
            statement = statement.where(PaperDB.subject == subject)
        if source:
            statement = statement.where(PaperDB.source == source)
        if course_level:
            statement = statement.where(PaperDB.course_level == course_level)
        if year:
            statement = statement.where(PaperDB.year == int(year))

        total = len(session.exec(statement).all())
        statement = statement.offset((page - 1) * per_page).limit(per_page)
        papers = session.exec(statement).all()

        return jsonify(
            {
                "papers": [paper_db_to_meta_read(p).model_dump(mode="json") for p in papers],
                "total": total,
                "page": page,
                "per_page": per_page,
            }
        )

@q_bp.route("/api/papers/<string:paper_id>", methods=["GET"])
@supabase_auth_required(optional=True)
def get_paper(paper_id):
    user_id = get_current_user_id()  # None if not logged in

    with get_session() as session:
        paper = session.get(PaperDB, paper_id)
        if not paper:
            return jsonify({"message": "Paper not found"}), 404

        # Admins can view everything
        if user_id and is_admin(str(user_id)):
            return jsonify(
                _paper_read_for_viewer(session, paper, str(user_id)).model_dump(mode="json")
            )

        # Removed papers, tell the user it's gone (owner included)
        if paper.visibility == "removed":
            return _removed_response()

        # Private papers are only visible to their author
        if paper.visibility == "private" and str(paper.author_id) != str(user_id):
            return jsonify({"message": "Paper not found"}), 404

        return jsonify(
            _paper_read_for_viewer(
                session,
                paper,
                str(user_id) if user_id else None,
            ).model_dump(mode="json")
        )


# --- SYNCING ---

@q_bp.route("/api/papers", methods=["POST"])
@supabase_auth_required()
def create_paper():
    user_id = get_current_user_id()
    data = request.get_json()
    if not data:
        return jsonify({"message": "No data provided"}), 400

    with get_session() as session:
        visibility = data.get("visibility", "private")
        if visibility == "removed":
            return jsonify({"message": "Cannot create a removed paper"}), 400
        
        paper_id = data.get("id", str(uuid4()))
        existing = session.get(PaperDB, paper_id)
        if existing:
            return jsonify({"message": "Paper already exists"}), 409
        
        paper = PaperDB(
            id=data.get("id", str(__import__("uuid").uuid4())),
            title=data.get("title", "Untitled"),
            author_id=str(user_id),
            subject=data.get("subject", ""),
            syllabus_id=data.get("syllabus_id"),
            year=data.get("year"),
            source=data.get("source"),
            school=data.get("school"),
            course_level=data.get("course_level"),
            visibility=visibility,
            question_count=data.get("question_count", 0),
            total_marks=data.get("total_marks", 0),
            duration_minutes=data.get("duration_minutes"),
        )
        if data.get("topics"):
            paper.set_topics(data["topics"])

        session.add(paper)
        _replace_paper_outcomes(session, paper.id, data.get("outcomes"))

        for q_data in _renumber_questions(data.get("questions", [])):
            q = _build_question_db(q_data, paper.id, str(user_id), preserve_id=False)
            session.add(q)

        session.commit()
        session.refresh(paper)
        try:
            return jsonify(paper_db_to_read(paper).model_dump(mode="json")), 201
        except Exception as e:
            current_app.logger.error(f"Failed to serialize created paper: {e}")
            return jsonify({
                "message": "Paper created but response serialization failed",
                "paper_id": paper.id,
            }), 201


@q_bp.route("/api/papers/<string:paper_id>", methods=["PUT"])
@supabase_auth_required()
def update_paper(paper_id):
    user_id = get_current_user_id()
    data = request.get_json()
    if not data:
        return jsonify({"message": "No data provided"}), 400

    with get_session() as session:
        paper = session.get(PaperDB, paper_id)
        if not paper:
            return jsonify({"message": "Paper not found"}), 404
        if paper.visibility == "removed":
            return _removed_response()
        if paper.author_id != str(user_id):
            return jsonify({"message": "Forbidden"}), 403

        # Update paper fields
        if "title" in data:
            paper.title = data["title"]
        if "subject" in data:
            paper.subject = data["subject"]
        if "syllabus_id" in data:
            paper.syllabus_id = data["syllabus_id"]
        if "year" in data:
            paper.year = data["year"]
        if "source" in data:
            paper.source = data["source"]
        if "school" in data:
            paper.school = data["school"]
        if "course_level" in data:
            paper.course_level = data["course_level"]
        if "visibility" in data and data["visibility"] != "removed":
            paper.visibility = data["visibility"]
        if "question_count" in data:
            paper.question_count = data["question_count"]
        if "total_marks" in data:
            paper.total_marks = data["total_marks"]
        if "duration_minutes" in data:
            paper.duration_minutes = data["duration_minutes"]
        if "topics" in data:
            paper.set_topics(data["topics"])
        if "outcomes" in data:
            _replace_paper_outcomes(session, paper.id, data["outcomes"])

        paper.updated_at = datetime.now(UTC)

        if "questions" in data:
            verified_fingerprints = {
                q.id: q.verified_fingerprint
                for q in paper.questions
            }
            paper.questions.clear()
            session.flush()

            new_questions = []
            for q_data in _renumber_questions(data["questions"]):
                q = _build_question_db(q_data, paper_id, str(user_id))
                if paper.verified:
                    q.verified_fingerprint = verified_fingerprints.get(q.id, "")
                new_questions.append(q)
            paper.questions = new_questions

            paper.question_count = len(data["questions"])
            paper.total_marks = sum(q.get("marks", 0) for q in data["questions"])

        session.commit()
        session.refresh(paper)
        return jsonify(paper_db_to_read(paper).model_dump(mode="json")), 200

@q_bp.route("/api/papers/<string:paper_id>", methods=["DELETE"])
@supabase_auth_required()
def delete_paper(paper_id):
    user_id = get_current_user_id()

    with get_session() as session:
        paper = session.get(PaperDB, paper_id)
        if not paper:
            return jsonify({"message": "Paper not found"}), 404
        if paper.visibility == "removed":
            return _removed_response()
        if paper.author_id != str(user_id):
            return jsonify({"message": "Forbidden"}), 403

        assets = session.exec(select(AssetDB).where(AssetDB.paper_id == paper_id)).all()
        for asset in assets:
            session.delete(asset)

        for question in paper.questions:
            question_outcomes = session.exec(
                select(QuestionOutcome).where(QuestionOutcome.question_id == question.id)
            ).all()
            for outcome in question_outcomes:
                session.delete(outcome)

            syllabus_points = session.exec(
                select(QuestionSyllabusPointDB).where(
                    QuestionSyllabusPointDB.question_id == question.id
                )
            ).all()
            for syllabus_point in syllabus_points:
                session.delete(syllabus_point)

            session.delete(question)
        for outcome in paper.outcomes:
            session.delete(outcome)
        session.flush()

        session.delete(paper)
        session.commit()
        return jsonify({"message": "Deleted"}), 200


@q_bp.route("/api/admin/papers/<string:paper_id>/verification", methods=["PATCH"])
@supabase_auth_required()
def update_paper_verification(paper_id):
    user_id = str(get_current_user_id())
    if not is_admin(user_id):
        return jsonify({"message": "Forbidden"}), 403

    data = request.get_json(silent=True) or {}
    verified = bool(data.get("verified", False))
    source_name = (data.get("source_name") or "").strip()
    source_url = (data.get("source_url") or "").strip()

    if verified and not source_name:
        return jsonify({"message": "source_name is required when verifying"}), 400
    if len(source_name) > 160:
        return jsonify({"message": "source_name is too long"}), 400
    if source_url and (len(source_url) > 500 or not _valid_source_url(source_url)):
        return jsonify({"message": "source_url must be a valid http(s) URL"}), 400

    with get_session() as session:
        paper = session.get(PaperDB, paper_id)
        if not paper:
            return jsonify({"message": "Paper not found"}), 404

        now = datetime.now(UTC)
        paper.verified = verified
        paper.verified_source_name = source_name if verified else None
        paper.verified_source_url = source_url if verified and source_url else None
        paper.verified_at = now if verified else None
        paper.verified_by = user_id if verified else None
        paper.updated_at = now
        if verified:
            _stamp_verified_question_fingerprints(paper)
        else:
            _clear_verified_question_fingerprints(paper)

        session.add(paper)
        session.commit()
        session.refresh(paper)
        return jsonify(paper_db_to_meta_read(paper).model_dump(mode="json")), 200

# --- PUBLISHING ---

@q_bp.route("/api/papers/<string:paper_id>/publish", methods=["POST"])
@supabase_auth_required()
def publish_paper(paper_id):
    user_id = get_current_user_id()

    with get_session() as session:
        paper = session.get(PaperDB, paper_id)

        if paper:
            # it exists, verify it
            if paper.author_id != str(user_id):
                return jsonify({"message": "Forbidden"}), 403
            if paper.visibility == "removed":
                return _removed_response()
            if paper.visibility == "public":
                return jsonify({"message": "Paper is already public"}), 409
        else:
            # paper doesnt exist on server, create it
            data = request.get_json()
            if not data:
                return jsonify({"message": "Paper not found and no body provided"}), 400

            paper = PaperDB(
                id=paper_id,
                title=data.get("title", "Untitled"),
                author_id=str(user_id),
                subject=data.get("subject", ""),
                syllabus_id=data.get("syllabus_id"),
                year=data.get("year"),
                source=data.get("source"),
                school=data.get("school"),
                course_level=data.get("course_level"),
                question_count=data.get("question_count", 0),
                total_marks=data.get("total_marks", 0),
                duration_minutes=data.get("duration_minutes"),
            )
            session.add(paper)

        paper.visibility = "public"
        paper.updated_at = datetime.now(UTC)
        session.add(paper)
        session.commit()
        session.refresh(paper)

        return jsonify(paper_db_to_meta_read(paper).model_dump(mode="json")), 200

@q_bp.route("/api/papers/<string:paper_id>/publish", methods=["DELETE"])
@supabase_auth_required()
def unpublish_paper(paper_id):
    user_id = get_current_user_id()

    with get_session() as session:
        paper = session.get(PaperDB, paper_id)
        if not paper:
            return jsonify({"message": "Paper not found"}), 404
        if paper.author_id != str(user_id):
            return jsonify({"message": "Forbidden"}), 403
        if paper.visibility == "removed":
            return _removed_response()
        if paper.visibility == "private":
            return jsonify({"message": "Paper is already private"}), 409

        paper.visibility = "private"
        paper.updated_at = datetime.now(UTC)
        
        session.add(paper)
        session.commit()
        session.refresh(paper)

        return jsonify(paper_db_to_meta_read(paper).model_dump(mode="json")), 200

# --- REMIXING ---

@q_bp.route("/api/papers/<string:paper_id>/remix", methods=["POST"])
@supabase_auth_required()
def remix_paper(paper_id):
    user_id = get_current_user_id()

    with get_session() as session:
        original = session.get(PaperDB, paper_id)
        if not original:
            return jsonify({"message": "Paper not found"}), 404
        if original.visibility != "public":
            return jsonify({"message": "Cannot remix a private paper"}), 403

        new_id = str(uuid4())
        now = datetime.now(UTC)

        # clone the paper
        remix = PaperDB(
            id=new_id,
            title=f"{original.title} (remix)",
            author_id=str(user_id),
            subject=original.subject,
            syllabus_id=original.syllabus_id,
            year=original.year,
            source=original.source,
            school=original.school,
            course_level=original.course_level,
            visibility="private",
            question_count=original.question_count,
            total_marks=original.total_marks,
            duration_minutes=original.duration_minutes,
            topics_json=original.topics_json,
            remixed=paper_id,
            created_at=now,
            updated_at=now,
        )
        session.add(remix)

        # clone questions
        for q in original.questions:
            session.add(_clone_question_for_remix(
                q,
                target_paper_id=new_id,
                author_id=str(user_id),
                number=q.number,
                now=now,
            ))

        session.commit()
        session.refresh(remix)
        return jsonify(_paper_read_for_viewer(session, remix, str(user_id)).model_dump(mode="json")), 201


@q_bp.route(
    "/api/papers/<string:paper_id>/questions/<string:question_id>/remix",
    methods=["POST"],
)
@supabase_auth_required()
def remix_question(paper_id, question_id):
    user_id = str(get_current_user_id())
    data = request.get_json() or {}
    target_paper_id = data.get("target_paper_id")
    if not target_paper_id:
        return jsonify({"message": "target_paper_id is required"}), 400

    with get_session() as session:
        source_paper = session.get(PaperDB, paper_id)
        if not source_paper:
            return jsonify({"message": "Paper not found"}), 404
        if source_paper.visibility != "public":
            return jsonify({"message": "Cannot remix a private paper"}), 403

        source_question = session.get(QuestionDB, question_id)
        if not source_question or source_question.paper_id != paper_id:
            return jsonify({"message": "Question not found"}), 404

        target_paper = session.get(PaperDB, target_paper_id)
        if not target_paper:
            return jsonify({"message": "Target paper not found"}), 404
        if target_paper.visibility == "removed":
            return _removed_response()
        if target_paper.author_id != user_id:
            return jsonify({"message": "Forbidden"}), 403

        now = datetime.now(UTC)
        next_number = max((q.number for q in target_paper.questions), default=0) + 1
        target_paper.questions.append(_clone_question_for_remix(
            source_question,
            target_paper_id=target_paper.id,
            author_id=user_id,
            number=next_number,
            now=now,
        ))
        target_paper.question_count = len(target_paper.questions)
        target_paper.total_marks = sum(q.marks for q in target_paper.questions)
        target_paper.updated_at = now

        session.add(target_paper)
        session.commit()
        session.refresh(target_paper)
        return jsonify(
            _paper_read_for_viewer(session, target_paper, user_id).model_dump(mode="json")
        ), 201
