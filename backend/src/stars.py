from datetime import UTC, datetime

from flask import Blueprint, jsonify
from sqlalchemy import UniqueConstraint, func
from sqlmodel import Field, SQLModel, col, select

from auth.supabase import get_current_user_id, supabase_auth_required
from questions.db import get_session
from questions.types import PaperDB, paper_db_to_meta_read

stars_bp = Blueprint("tppr-stars", __name__)


class PaperStarDB(SQLModel, table=True):
    __tablename__ = "paper_stars"
    __table_args__ = (
        UniqueConstraint("user_id", "paper_id", name="uq_paper_stars_user_paper"),
    )

    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(index=True)
    paper_id: str = Field(index=True)
    starred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


def _can_star_paper(paper: PaperDB | None, user_id: str) -> bool:
    if paper is None or paper.visibility == "removed":
        return False
    return paper.visibility == "public" or paper.author_id == user_id


def _star_payload(star: PaperStarDB, paper: PaperDB) -> dict:
    return {
        "paper": paper_db_to_meta_read(paper).model_dump(mode="json"),
        "starred_at": star.starred_at.isoformat() if star.starred_at else None,
    }


@stars_bp.route("/api/stars", methods=["GET"])
@supabase_auth_required()
def list_stars():
    user_id = str(get_current_user_id())

    with get_session() as session:
        rows = session.exec(
            select(PaperStarDB, PaperDB)
            .join(PaperDB, PaperDB.id == PaperStarDB.paper_id)
            .where(PaperStarDB.user_id == user_id)
            .where(
                (PaperDB.visibility == "public")
                | ((PaperDB.visibility == "private") & (PaperDB.author_id == user_id))
            )
            .where(PaperDB.visibility != "removed")
            .order_by(col(PaperStarDB.starred_at).desc())
        ).all()

        return jsonify({"stars": [_star_payload(star, paper) for star, paper in rows]}), 200


@stars_bp.route("/api/papers/<string:paper_id>/star", methods=["GET"])
@supabase_auth_required(optional=True)
def star_status(paper_id):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({"starred": False}), 200

    with get_session() as session:
        star = session.exec(
            select(PaperStarDB).where(
                PaperStarDB.user_id == str(user_id),
                PaperStarDB.paper_id == paper_id,
            )
        ).first()
        return jsonify({"starred": star is not None}), 200


@stars_bp.route("/api/papers/<string:paper_id>/star", methods=["POST"])
@supabase_auth_required()
def star_paper(paper_id):
    user_id = str(get_current_user_id())

    with get_session() as session:
        paper = session.get(PaperDB, paper_id)
        if not _can_star_paper(paper, user_id):
            return jsonify({"message": "Paper not found"}), 404

        star = session.exec(
            select(PaperStarDB).where(
                PaperStarDB.user_id == user_id,
                PaperStarDB.paper_id == paper_id,
            )
        ).first()
        if star is None:
            star = PaperStarDB(user_id=user_id, paper_id=paper_id)
            session.add(star)
            session.commit()
            session.refresh(star)

        return jsonify({"starred": True, "starred_at": star.starred_at.isoformat()}), 200


@stars_bp.route("/api/papers/<string:paper_id>/star", methods=["DELETE"])
@supabase_auth_required()
def unstar_paper(paper_id):
    user_id = str(get_current_user_id())

    with get_session() as session:
        star = session.exec(
            select(PaperStarDB).where(
                PaperStarDB.user_id == user_id,
                PaperStarDB.paper_id == paper_id,
            )
        ).first()
        if star:
            session.delete(star)
            session.commit()

    return jsonify({"starred": False}), 200


@stars_bp.route("/api/papers/<string:paper_id>/star-count", methods=["GET"])
def paper_star_count(paper_id):
    """Public endpoint: total number of stars for a paper."""
    with get_session() as session:
        count = session.exec(
            select(func.count(PaperStarDB.id)).where(
                PaperStarDB.paper_id == paper_id
            )
        ).one()
        return jsonify({"star_count": int(count)}), 200
