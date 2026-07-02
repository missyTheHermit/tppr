"""API key authentication for tppr.

Allows users to create revocable API keys as an alternative to Supabase JWT
auth. Only the SHA-256 hash of each key is stored; the full key is returned
exactly once at creation time.
"""

import hashlib
import secrets
from datetime import UTC, datetime

from flask import Blueprint, current_app, g, jsonify, request
from sqlmodel import Field, SQLModel, col, select

from questions.db import get_session

from .supabase import get_current_user_id, supabase_auth_required

api_keys_bp = Blueprint("tppr-account-api-keys", __name__)

KEY_PREFIX = "tpk_"


class ApiKeyDB(SQLModel, table=True):
    __tablename__ = "api_keys"

    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(index=True)
    key_hash: str = Field(unique=True)
    name: str | None = None
    prefix: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    last_used_at: datetime | None = None
    revoked: int = Field(default=0)


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _display_prefix(raw_key: str) -> str:
    """Short, human-readable prefix like 'tpk_abc...xyz'."""
    tail = raw_key[-3:] if len(raw_key) >= 3 else raw_key
    head = raw_key[:8] if len(raw_key) >= 8 else raw_key
    return f"{head}...{tail}"


def authenticate_api_key() -> tuple[str | None, bool]:
    """Authenticate a request via the ``X-API-Key`` header.

    Returns ``(user_id, success)``. On success ``g.user_id`` is set and the
    key's ``last_used_at`` is updated. On failure ``user_id`` is ``None`` and
    ``success`` is ``False``.

    This is intended to be called from ``authenticate_supabase_request`` as
    an alternative to JWT auth, so it does not return a Flask response.
    """
    raw_key = request.headers.get("X-API-Key", "").strip()
    if not raw_key:
        return None, False

    key_hash = _hash_key(raw_key)
    with get_session() as session:
        api_key = session.exec(
            select(ApiKeyDB).where(
                ApiKeyDB.key_hash == key_hash,
                ApiKeyDB.revoked == 0,
            )
        ).first()

        if api_key is None:
            return None, False

        api_key.last_used_at = datetime.now(UTC)
        session.add(api_key)
        session.commit()

        g.user_id = api_key.user_id
        g.supabase_claims = {}
        g.local_user = None
        return api_key.user_id, True


@api_keys_bp.route("/api/account/api-keys", methods=["POST"])
@supabase_auth_required(sync_user=True)
def create_api_key():
    user_id = str(get_current_user_id())

    body = request.get_json(silent=True) or {}
    name = body.get("name")
    if name is not None:
        name = str(name).strip() or None

    raw_key = KEY_PREFIX + secrets.token_urlsafe(32)
    key_hash = _hash_key(raw_key)
    prefix = _display_prefix(raw_key)

    with get_session() as session:
        api_key = ApiKeyDB(
            user_id=user_id,
            key_hash=key_hash,
            name=name,
            prefix=prefix,
        )
        session.add(api_key)
        session.commit()
        session.refresh(api_key)

        return (
            jsonify(
                {
                    "key": raw_key,
                    "name": api_key.name,
                    "prefix": api_key.prefix,
                    "created_at": api_key.created_at.isoformat()
                    if api_key.created_at
                    else None,
                }
            ),
            201,
        )


@api_keys_bp.route("/api/account/api-keys", methods=["GET"])
@supabase_auth_required(sync_user=True)
def list_api_keys():
    user_id = str(get_current_user_id())

    with get_session() as session:
        rows = session.exec(
            select(ApiKeyDB)
            .where(ApiKeyDB.user_id == user_id, ApiKeyDB.revoked == 0)
            .order_by(col(ApiKeyDB.created_at).desc())
        ).all()

        keys = [
            {
                "id": row.id,
                "name": row.name,
                "prefix": row.prefix,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "last_used_at": row.last_used_at.isoformat()
                if row.last_used_at
                else None,
            }
            for row in rows
        ]

        return jsonify({"keys": keys}), 200


@api_keys_bp.route("/api/account/api-keys/<int:key_id>", methods=["DELETE"])
@supabase_auth_required(sync_user=True)
def revoke_api_key(key_id):
    user_id = str(get_current_user_id())

    with get_session() as session:
        api_key = session.exec(
            select(ApiKeyDB).where(
                ApiKeyDB.id == key_id,
                ApiKeyDB.user_id == user_id,
            )
        ).first()

        if api_key is None:
            return jsonify({"message": "API key not found"}), 404

        api_key.revoked = 1
        session.add(api_key)
        session.commit()

        return jsonify({"message": "API key revoked"}), 200