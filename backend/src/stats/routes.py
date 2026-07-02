from flask import Blueprint, jsonify
from sqlalchemy import func
from sqlmodel import col, select

from auth.db import AuthenticationDB, UserDB
from auth.supabase import get_current_user_id, supabase_auth_required
from progress.aggregations import compute_many_students, ZERO_STUDENT_STATS
from progress.models import PaperAttemptDB
from progress.routes import _attempt_dict, _paper_meta_map
from questions.db import get_session
from questions.types import PaperDB
from stars import PaperStarDB

stats_bp = Blueprint("tppr-stats", __name__)
auth_db = AuthenticationDB()

RECENT_ATTEMPTS_LIMIT = 6


def _is_admin(user_id: str) -> bool:
    """Local import avoids a circular import with the admin module."""
    from admin import is_admin

    return is_admin(user_id)


def _student_payload(user: UserDB, stats: dict) -> dict:
    return {
        "user_id": user.user_id,
        "username": user.username,
        "avatar_url": user.avatar_url,
        "joined_at": user.created_at.isoformat() if user.created_at else None,
        "attempts_count": stats.get("attempts_count", 0),
        "papers_attempted": stats.get("papers_attempted", 0),
        "papers_completed": stats.get("papers_completed", 0),
        "questions_answered": stats.get("questions_answered", 0),
        "total_study_seconds": stats.get("total_study_seconds", 0),
        "reveal_count": stats.get("reveal_count", 0),
        "current_streak": stats.get("current_streak", 0),
        "longest_streak": stats.get("longest_streak", 0),
        "last_active_at": stats.get("last_active_at"),
    }


@stats_bp.route("/api/stats/me", methods=["GET"])
@supabase_auth_required(sync_user=True)
def my_stats():
    user_id = get_current_user_id()

    with get_session() as session:
        user = session.get(UserDB, user_id)
        if not user:
            return jsonify({"message": "User not found"}), 404

        stats = compute_many_students(session, [user_id]).get(
            user_id, dict(ZERO_STUDENT_STATS)
        )

        recent = session.exec(
            select(PaperAttemptDB)
            .where(PaperAttemptDB.user_id == str(user_id))
            .order_by(col(PaperAttemptDB.started_at).desc())
            .limit(RECENT_ATTEMPTS_LIMIT)
        ).all()
        meta_map = _paper_meta_map(session, [a.paper_id for a in recent])
        recent_attempts = [_attempt_dict(a, meta_map.get(a.paper_id)) for a in recent]

        payload = _student_payload(user, stats)
        payload["recent_attempts"] = recent_attempts
        return jsonify(payload), 200


@stats_bp.route("/api/stats/users", methods=["GET"])
@supabase_auth_required()
def all_user_stats():
    user_id = get_current_user_id()
    if not _is_admin(user_id):
        return jsonify({"message": "Forbidden"}), 403

    with get_session() as session:
        users = list(session.exec(select(UserDB)).all())
        stats = compute_many_students(session, [u.user_id for u in users])

        rows = [_student_payload(u, stats.get(u.user_id, dict(ZERO_STUDENT_STATS))) for u in users]

    rows.sort(
        key=lambda r: (
            -r["papers_completed"],
            -r["total_study_seconds"],
            -r["questions_answered"],
            r["username"],
        )
    )
    return jsonify({"users": rows}), 200


@stats_bp.route("/api/papers/<string:paper_id>/author-stats", methods=["GET"])
@supabase_auth_required()
def paper_author_stats(paper_id):
    """Aggregate stats for a paper, visible only to its author."""
    user_id = get_current_user_id()

    with get_session() as session:
        paper = session.get(PaperDB, paper_id)
        if not paper:
            return jsonify({"message": "Paper not found"}), 404
        if paper.author_id != str(user_id):
            return jsonify({"message": "Forbidden"}), 403

        attempts = session.exec(
            select(PaperAttemptDB).where(PaperAttemptDB.paper_id == paper_id)
        ).all()

        total_attempts = len(attempts)

        unique_attempters = session.exec(
            select(func.count(func.distinct(PaperAttemptDB.user_id))).where(
                PaperAttemptDB.paper_id == paper_id
            )
        ).one()

        def _is_completed(attempt: PaperAttemptDB) -> bool:
            return bool(attempt.completed) or attempt.max_slide >= paper.question_count + 1

        completed = [a for a in attempts if _is_completed(a)]
        completion_rate = (len(completed) / total_attempts) if total_attempts else 0.0

        completed_seconds = [
            int(a.elapsed_seconds) for a in completed if int(a.elapsed_seconds) > 0
        ]
        average_completion_seconds = (
            sum(completed_seconds) / len(completed_seconds)
            if completed_seconds
            else None
        )

        reveal_counts = [int(a.reveal_count) for a in attempts]
        average_reveal_count = (
            sum(reveal_counts) / len(reveal_counts) if reveal_counts else None
        )

        star_count = session.exec(
            select(func.count(PaperStarDB.id)).where(PaperStarDB.paper_id == paper_id)
        ).one()

        return (
            jsonify(
                {
                    "total_attempts": total_attempts,
                    "unique_attempters": int(unique_attempters),
                    "completion_rate": round(completion_rate, 4),
                    "average_completion_seconds": round(average_completion_seconds, 2)
                    if average_completion_seconds is not None
                    else None,
                    "average_reveal_count": round(average_reveal_count, 2)
                    if average_reveal_count is not None
                    else None,
                    "star_count": int(star_count),
                }
            ),
            200,
        )
