from functools import wraps
from typing import Any

from flask import current_app, g, jsonify, request
import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError
from settings import (
    SUPABASE_JWT_AUDIENCE,
    SUPABASE_JWKS_URL,
    SUPABASE_JWT_ISSUER,
    SUPABASE_JWT_SECRET,
)

ASYMMETRIC_ALGORITHMS = ["RS256", "ES256"]
LEGACY_ALGORITHMS = ["HS256"]
_jwks_client: PyJWKClient | None = None


def _bearer_token() -> str:
    auth_header = request.headers.get("Authorization", "")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return token.strip()


def _decode_supabase_token(token: str) -> dict[str, Any]:
    header = jwt.get_unverified_header(token)
    algorithm = header.get("alg")

    if algorithm in ASYMMETRIC_ALGORITHMS:
        if not SUPABASE_JWKS_URL:
            raise RuntimeError("SUPABASE_URL or SUPABASE_JWKS_URL is not configured")
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        return _decode_with_key(token, signing_key.key, ASYMMETRIC_ALGORITHMS)

    if algorithm in LEGACY_ALGORITHMS and SUPABASE_JWT_SECRET:
        return _decode_with_key(token, SUPABASE_JWT_SECRET, LEGACY_ALGORITHMS)

    if algorithm in LEGACY_ALGORITHMS:
        raise RuntimeError("SUPABASE_JWT_SECRET is required for legacy HS256 tokens")

    raise jwt.InvalidAlgorithmError(f"Unsupported Supabase JWT algorithm: {algorithm}")


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(
            SUPABASE_JWKS_URL,
            cache_keys=True,
            lifespan=600,
            timeout=5,
        )
    return _jwks_client


def _unverified_claims(token: str) -> dict[str, Any]:
    return jwt.decode(
        token,
        options={
            "verify_signature": False,
            "verify_exp": False,
            "verify_aud": False,
            "verify_iss": False,
        },
    )


def _validate_supabase_claims(payload: dict[str, Any]) -> None:
    if payload.get("role") != "authenticated":
        raise jwt.InvalidTokenError("Supabase JWT is not for an authenticated user")


def _decode_with_key(
    token: str,
    key,
    algorithms: list[str],
) -> dict[str, Any]:
    claims = _unverified_claims(token)
    has_audience = bool(claims.get("aud"))
    options: dict[str, Any] = {"verify_aud": has_audience}
    kwargs: dict[str, Any] = {}
    if SUPABASE_JWT_ISSUER:
        kwargs["issuer"] = SUPABASE_JWT_ISSUER
    if has_audience:
        kwargs["audience"] = SUPABASE_JWT_AUDIENCE

    payload = jwt.decode(
        token,
        key,
        algorithms=algorithms,
        options=options,
        **kwargs,
    )
    _validate_supabase_claims(payload)
    return payload


def _sync_local_user(payload: dict[str, Any]) -> dict:
    from .db import AuthenticationDB

    user_id = payload.get("sub")
    metadata = payload.get("user_metadata") or {}
    email = payload.get("email") or metadata.get("email")
    if not user_id or not email:
        raise ValueError("Supabase token is missing required user claims")

    return AuthenticationDB().sync_supabase_user(
        user_id=str(user_id),
        email=str(email),
        metadata=metadata,
    )


def _sync_response(payload: dict[str, Any]):
    try:
        return _sync_local_user(payload), None
    except Exception as e:
        current_app.logger.error(f"Unable to sync Supabase user: {e}")
        return None, (jsonify({"message": "Unable to sync authenticated user"}), 500)


def authenticate_supabase_request(
    optional: bool = False,
    *,
    sync_user: bool = False,
):
    if getattr(g, "user_id", None) and getattr(g, "supabase_claims", None):
        if sync_user and getattr(g, "local_user", None) is None:
            local_user, error_response = _sync_response(g.supabase_claims)
            if error_response is not None:
                return error_response
            g.local_user = local_user
        return None

    # API key auth: if an X-API-Key header is present, try it before JWT.
    if request.headers.get("X-API-Key"):
        from .api_keys import authenticate_api_key

        _user_id, ok = authenticate_api_key()
        if ok:
            return None
        # API key auth failed; fall through to JWT auth below.

    token = _bearer_token()

    g.user_id = None
    g.supabase_claims = {}
    g.local_user = None

    if not token:
        if optional:
            return None
        return jsonify({"message": "Missing authorization token"}), 401

    try:
        payload = _decode_supabase_token(token)
        g.user_id = str(payload["sub"])
        g.supabase_claims = payload
        if sync_user:
            g.local_user = _sync_local_user(payload)
    except jwt.ExpiredSignatureError:
        return jsonify({"message": "Token expired"}), 401
    except (jwt.InvalidTokenError, PyJWKClientError) as e:
        current_app.logger.info(f"Invalid Supabase token: {e}")
        if optional:
            return None
        return jsonify({"message": "Invalid token"}), 401
    except RuntimeError as e:
        current_app.logger.error(f"Supabase auth is not configured: {e}")
        return jsonify({"message": "Authentication is not configured"}), 500
    except Exception as e:
        current_app.logger.error(f"Unable to sync Supabase user: {e}")
        return jsonify({"message": "Unable to sync authenticated user"}), 500

    return None


def supabase_auth_required(optional=False, *, sync_user: bool = False):
    """Decorator to verify Supabase JWTs from the Authorization header."""
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            auth_response = authenticate_supabase_request(
                optional=optional,
                sync_user=sync_user,
            )
            if auth_response is not None:
                return auth_response
            return f(*args, **kwargs)
        return wrapper
    return decorator


def get_current_user_id() -> str | None:
    """Get the current user ID from the request context."""
    return getattr(g, "user_id", None)


def get_current_user_claims() -> dict[str, Any]:
    """Get the decoded Supabase JWT claims from the request context."""
    return getattr(g, "supabase_claims", {})
