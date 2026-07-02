from datetime import UTC, datetime, timedelta

from flask import Blueprint, jsonify, request

from auth.db import AuthenticationDB, UserDB
from auth.supabase import get_current_user_id, supabase_auth_required
from admin import is_admin
from questions.db import get_session
from sqlmodel import select

from progress.aggregations import compute_many_students, ZERO_STUDENT_STATS
from questions.types import PaperDB, paper_db_to_meta_read
from .db import SocialDB
from .models import FriendshipDB, UserPresenceDB  # noqa: F401 (ensures table registered)
from .time import as_utc

social_bp = Blueprint("tppr-social", __name__)
auth_db = AuthenticationDB()
social_db = SocialDB()

LEADERBOARD_LIMIT = 100
PRESENCE_STALE_AFTER = timedelta(minutes=10)


def _error(message: str, status: int):
    return jsonify({"message": message}), status


def resolve_profile_user(session, profile_ref: str) -> UserDB | None:
    user = session.get(UserDB, profile_ref)
    if user:
        return user
    return session.exec(
        select(UserDB).where(UserDB.username == profile_ref)
    ).first()


def _paper_presence_dict(paper: PaperDB | None):
    if not paper or paper.visibility != "public":
        return None
    return {
        "id": paper.id,
        "title": paper.title,
        "subject": paper.subject,
        "visibility": paper.visibility,
    }


def _presence_response(presence: UserPresenceDB, paper: PaperDB | None) -> dict:
    now = datetime.now(UTC)
    last_seen_at = as_utc(presence.last_seen_at)
    session_started_at = as_utc(presence.session_started_at)
    active_paper_started_at = as_utc(presence.active_paper_started_at)
    online = (
        now - last_seen_at <= timedelta(seconds=90)
        if last_seen_at
        else False
    )
    active_paper = _paper_presence_dict(paper)
    return {
        "online": online,
        "session_started_at": session_started_at.isoformat()
        if session_started_at
        else None,
        "last_seen_at": last_seen_at.isoformat()
        if last_seen_at
        else None,
        "seconds_on_site": max(
            0,
            int((now - session_started_at).total_seconds()),
        )
        if online and session_started_at
        else 0,
        "active_paper": active_paper,
        "active_seconds": max(
            0,
            int((now - active_paper_started_at).total_seconds()),
        )
        if online and active_paper and active_paper_started_at
        else 0,
    }


@social_bp.route("/api/presence", methods=["POST"])
@supabase_auth_required()
def heartbeat_presence():
    user_id = str(get_current_user_id())
    data = request.get_json(silent=True) or {}
    now = datetime.now(UTC)
    paper_id_supplied = "paper_id" in data
    paper_id = data.get("paper_id")

    with get_session() as session:
        presence = session.get(UserPresenceDB, user_id)
        if not presence:
            presence = UserPresenceDB(
                user_id=user_id,
                session_started_at=now,
                last_seen_at=now,
            )
        elif (
            not (last_seen_at := as_utc(presence.last_seen_at))
            or now - last_seen_at > PRESENCE_STALE_AFTER
        ):
            presence.session_started_at = now

        paper = None
        if paper_id_supplied:
            if paper_id:
                paper = session.get(PaperDB, str(paper_id))
                if not paper or paper.visibility == "removed":
                    return _error("Paper not found", 404)
                presence.active_paper_id = paper.id
                presence.active_paper_started_at = now
            else:
                presence.active_paper_id = None
                presence.active_paper_started_at = None
        elif presence.active_paper_id:
            paper = session.get(PaperDB, presence.active_paper_id)

        presence.last_seen_at = now
        session.add(presence)
        session.commit()
        session.refresh(presence)
        if presence.active_paper_id and not paper:
            paper = session.get(PaperDB, presence.active_paper_id)
        return jsonify(_presence_response(presence, paper)), 200


@social_bp.route("/api/presence/active-paper", methods=["DELETE"])
@supabase_auth_required()
def clear_active_paper_presence():
    user_id = str(get_current_user_id())
    now = datetime.now(UTC)
    with get_session() as session:
        presence = session.get(UserPresenceDB, user_id)
        if not presence:
            presence = UserPresenceDB(
                user_id=user_id,
                session_started_at=now,
                last_seen_at=now,
            )
        presence.active_paper_id = None
        presence.active_paper_started_at = None
        presence.last_seen_at = now
        session.add(presence)
        session.commit()
        session.refresh(presence)
        return jsonify(_presence_response(presence, None)), 200


@social_bp.route("/api/friends/requests", methods=["POST"])
@supabase_auth_required()
def send_friend_request():
    user_id = get_current_user_id()
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()

    if not username:
        return _error("username is required", 400)

    target = auth_db.get_user_by_username(username)
    if not target:
        return _error("No user with that username", 404)

    ok, message = social_db.send_request(user_id, target["user_id"])
    if not ok:
        return _error(message, 400)
    return jsonify({"message": message}), 201


@social_bp.route("/api/friends/requests/incoming", methods=["GET"])
@supabase_auth_required()
def list_incoming_requests():
    user_id = get_current_user_id()
    return jsonify({"requests": social_db.list_incoming(user_id)}), 200


@social_bp.route("/api/friends/requests/outgoing", methods=["GET"])
@supabase_auth_required()
def list_outgoing_requests():
    user_id = get_current_user_id()
    return jsonify({"requests": social_db.list_outgoing(user_id)}), 200


@social_bp.route("/api/friends/requests/<int:friendship_id>/accept", methods=["POST"])
@supabase_auth_required()
def accept_friend_request(friendship_id):
    user_id = get_current_user_id()
    ok, message = social_db.accept_request(friendship_id, user_id)
    if not ok:
        return _error(message, 400)
    return jsonify({"message": message}), 200


@social_bp.route("/api/friends/requests/<int:friendship_id>/decline", methods=["POST"])
@supabase_auth_required()
def decline_friend_request(friendship_id):
    user_id = get_current_user_id()
    ok, message = social_db.decline_request(friendship_id, user_id)
    if not ok:
        return _error(message, 400)
    return jsonify({"message": message}), 200


@social_bp.route("/api/friends/requests/<int:friendship_id>", methods=["DELETE"])
@supabase_auth_required()
def cancel_friend_request(friendship_id):
    user_id = get_current_user_id()
    ok, message = social_db.cancel_outgoing(friendship_id, user_id)
    if not ok:
        return _error(message, 400)
    return jsonify({"message": message}), 200


@social_bp.route("/api/friends", methods=["GET"])
@supabase_auth_required()
def list_friends():
    user_id = get_current_user_id()
    return jsonify({"friends": social_db.list_friends(user_id)}), 200


@social_bp.route("/api/friends/<string:other_id>", methods=["DELETE"])
@supabase_auth_required()
def remove_friend(other_id):
    user_id = get_current_user_id()
    ok, message = social_db.remove_friend(user_id, other_id)
    if not ok:
        return _error(message, 400)
    return jsonify({"message": message}), 200


def _leaderboard_entries(session, users: list[UserDB]) -> list[dict]:
    if not users:
        return []

    stats = compute_many_students(session, [u.user_id for u in users])

    entries = []
    for u in users:
        s = stats.get(u.user_id, dict(ZERO_STUDENT_STATS))
        entries.append(
            {
                "user_id": u.user_id,
                "username": u.username,
                "avatar_url": u.avatar_url,
                "attempts_count": s.get("attempts_count", 0),
                "papers_attempted": s.get("papers_attempted", 0),
                "papers_completed": s.get("papers_completed", 0),
                "questions_answered": s.get("questions_answered", 0),
                "total_study_seconds": s.get("total_study_seconds", 0),
                "current_streak": s.get("current_streak", 0),
                "longest_streak": s.get("longest_streak", 0),
            }
        )

    entries.sort(
        key=lambda e: (
            -e["papers_completed"],
            -e["total_study_seconds"],
            -e["questions_answered"],
            e["username"],
        )
    )
    for i, entry in enumerate(entries, start=1):
        entry["rank"] = i
    return entries[:LEADERBOARD_LIMIT]


@social_bp.route("/api/users/<string:profile_ref>/profile", methods=["GET"])
@supabase_auth_required(optional=True)
def user_profile(profile_ref):
    with get_session() as session:
        profile_user = resolve_profile_user(session, profile_ref)
        if not profile_user:
            return _error("User not found", 404)
        profile_user_id = profile_user.user_id

        stats = compute_many_students(session, [profile_user_id]).get(
            profile_user_id,
            dict(ZERO_STUDENT_STATS),
        )
        presence = session.get(UserPresenceDB, profile_user_id)
        paper = (
            session.get(PaperDB, presence.active_paper_id)
            if presence and presence.active_paper_id
            else None
        )
        public_papers = session.exec(
            select(PaperDB)
            .where(PaperDB.author_id == profile_user_id)
            .where(PaperDB.visibility == "public")
        ).all()

        return jsonify({
            "user": {
                "user_id": profile_user.user_id,
                "username": profile_user.username,
                "avatar_url": profile_user.avatar_url,
                "created_at": profile_user.created_at.isoformat()
                if profile_user.created_at
                else None,
                "admin": is_admin(profile_user.user_id),
            },
            "stats": stats,
            "presence": _presence_response(presence, paper) if presence else None,
            "public_papers": [
                paper_db_to_meta_read(p).model_dump(mode="json")
                for p in public_papers[:12]
            ],
        }), 200


@social_bp.route("/api/leaderboard", methods=["GET"])
@supabase_auth_required(optional=True)
def leaderboard():
    scope = (request.args.get("scope") or "").strip().lower()
    user_id = get_current_user_id()

    with get_session() as session:
        if scope == "friends":
            if not user_id:
                return _error("Sign in to view the friends leaderboard", 401)
            ids = social_db.list_friend_user_ids(user_id)
            ids.append(user_id)  # include the caller
            users = list(
                session.exec(
                    select(UserDB).where(UserDB.user_id.in_(ids))
                ).all()
            )
        else:
            users = list(session.exec(select(UserDB)).all())

        entries = _leaderboard_entries(session, users)

    return jsonify({"entries": entries}), 200
