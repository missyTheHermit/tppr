# ensure tippy top of script
from dotenv import load_dotenv
load_dotenv()

import base64
import hashlib
import os
import re
import sys

import auth
import swagger
import settings
from admin import admin_bp, init_admins, teardown_admins
from auth.supabase import authenticate_supabase_request
from auth.db import AuthenticationDB
from flask import Flask, jsonify, redirect, request, send_from_directory
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from questions.db import prepare as prepare_paper_db
from questions.endpoints import q_bp
from social import social_bp
from stats import stats_bp
from progress import progress_bp
from stars import stars_bp
from reports import reports_bp

assets_dir = settings.ASSETS_DIR
frontend_dist_dir = settings.FRONTEND_DIST_DIR
api_only = settings.API_ONLY_FLAG in sys.argv
INLINE_SCRIPT_RE = re.compile(r"<script(?:\s[^>]*)?>(.*?)</script>", re.DOTALL)
SENSITIVE_PATH_SEGMENTS = {
    ".git",
    ".hg",
    ".svn",
    ".well-known",  # served nowhere in tppr; keep scanners away from SPA fallback
    "actuator",
}
SENSITIVE_FILENAMES = {
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    "appsettings.json",
    "config.json",
    "credentials.json",
    "firebase.json",
    "key.json",
    "secrets.json",
    "service-account.json",
}

app = Flask(__name__)

# --- secure stuff ---
if settings.BACKEND_ALLOWED_ORIGINS:
    CORS(
        app,
        supports_credentials=True,
        origins=settings.BACKEND_ALLOWED_ORIGINS,
        resources={r"/api/*": {"origins": settings.BACKEND_ALLOWED_ORIGINS}},
    )

app.config.update(
    ENV="production" if settings.PRODUCTION else "development",
    DEBUG=settings.BACKEND_DEBUG,
    TESTING=False,
    SECRET_KEY=settings.SECRET_KEY,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=settings.PRODUCTION,
    SESSION_COOKIE_SAMESITE=settings.SESSION_COOKIE_SAMESITE,
)

limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=[settings.RATELIMIT_DEFAULT],
    storage_uri=settings.RATELIMIT_STORAGE_URI,
)

PUBLIC_API_ENDPOINTS = {
    "api_landing",
    "api_docs_redirect",
    "api_not_found",
    "ping",
    "tppr-account-authentication.register",
    "tppr-account-authentication.login",
    "tppr-account-2fa.verify_2fa",
    "tppr-account-management.whotfisthis",
    "tppr-questions.get_asset",
    "tppr-questions.search_papers",
    "tppr-questions.get_paper",
    "tppr-progress.paper_focus_stats",
    "tppr-social.leaderboard",
    "tppr-social.user_profile",
    "tppr-stars.paper_star_count",
}

PUBLIC_API_DOC_ENDPOINTS = {
    "swagger.swagger_json",
    "swagger_ui.show",
    "swagger_ui.static",
}

PUBLIC_ENDPOINT_RATE_LIMITS = {
    "ping": "60 per minute",
    "tppr-account-authentication.register": "5 per hour",
    "tppr-account-authentication.login": "10 per minute",
    "tppr-account-2fa.verify_2fa": "10 per minute",
    "tppr-account-management.whotfisthis": "60 per minute",
    "tppr-questions.search_papers": "60 per minute",
    "tppr-questions.get_paper": "120 per minute",
    "tppr-questions.get_asset": "120 per minute",
    "tppr-progress.paper_focus_stats": "60 per minute",
    "tppr-admin.verify_admin": "5 per minute",
    "tppr-social.leaderboard": "60 per minute",
}


@app.before_request
def require_auth_for_private_api_routes():
    if request.method == "OPTIONS":
        return None
    if not settings.PRODUCTION or not request.path.startswith("/api"):
        return None
    if request.endpoint in PUBLIC_API_ENDPOINTS:
        return None
    if settings.PUBLIC_API_DOCS and request.endpoint in PUBLIC_API_DOC_ENDPOINTS:
        return None
    return authenticate_supabase_request()


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = (
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
        "magnetometer=(), microphone=(), payment=(), usb=()"
    )
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"

    if response.content_type.startswith("text/html"):
        script_src = "'self'"
        connect_sources = ["'self'", "https://api.mistral.ai"]
        if settings.SUPABASE_URL:
            connect_sources.append(settings.SUPABASE_URL)
        if request.path.startswith("/api/docs"):
            body = response.get_data(as_text=True)
            script_hashes = [
                "'sha256-"
                + base64.b64encode(
                    hashlib.sha256(script.encode("utf-8")).digest()
                ).decode("ascii")
                + "'"
                for script in INLINE_SCRIPT_RE.findall(body)
                if script.strip()
            ]
            script_src = " ".join([script_src, *script_hashes])
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "object-src 'none'; "
            f"script-src {script_src}; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "font-src 'self' data:; "
            f"connect-src {' '.join(connect_sources)}; "
        )

    if settings.PRODUCTION:
        response.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains; preload"
        )

    if request.path.startswith("/api") and "Cache-Control" not in response.headers:
        response.headers["Cache-Control"] = "no-store"
    return response


# --- basic routes ---

def serve_api_landing():
    return send_from_directory(assets_dir, "missing.html")


def frontend_dist_available():
    return os.path.isfile(os.path.join(frontend_dist_dir, "index.html"))


def is_sensitive_probe_path(path: str) -> bool:
    parts = [part for part in path.split("/") if part]
    if not parts:
        return False
    if any(part in SENSITIVE_PATH_SEGMENTS for part in parts):
        return True
    return parts[-1] in SENSITIVE_FILENAMES


@app.route("/api")
@app.route("/api/")
def api_landing():
    return serve_api_landing()


@app.route("/api/docs")
def api_docs_redirect():
    return redirect("/api/docs/", code=308)


@app.route("/api/<path:path>")
def api_not_found(path):
    body = {"message": "404, requested API resource not found"}
    if settings.SHOW_ERROR_CAUSES:
        body["cause"] = f"/api/{path}"
    return jsonify(body), 404


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def index(path):
    if api_only or not frontend_dist_available():
        return serve_api_landing()

    if path:
        if is_sensitive_probe_path(path):
            return jsonify({"message": "404, resource not found"}), 404

        requested_file = os.path.join(frontend_dist_dir, path)
        if os.path.isfile(requested_file):
            response = send_from_directory(frontend_dist_dir, path)
            if path.startswith("assets/"):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return response
        # Don't serve index.html for missing static assets
        if "." in path.split("/")[-1]:
            return jsonify({"message": "404, resource not found"}), 404

    response = send_from_directory(frontend_dist_dir, "index.html")
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.route("/ping")
def ping():
    return jsonify('tppr says "Pong!"')


@app.errorhandler(404)
def page_not_found(e):
    body = {"message": "404, requested resource not found"}
    if settings.SHOW_ERROR_CAUSES:
        body["cause"] = str(e)
    return jsonify(body), 404

# --- blueprint registration ---

auth.register_blueprint(app)
swagger.register_blueprint(app)
app.register_blueprint(q_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(social_bp)
app.register_blueprint(stats_bp)
app.register_blueprint(progress_bp)
app.register_blueprint(stars_bp)
app.register_blueprint(reports_bp)

for endpoint, limit in PUBLIC_ENDPOINT_RATE_LIMITS.items():
    view = app.view_functions.get(endpoint)
    if view:
        app.view_functions[endpoint] = limiter.limit(limit)(view)


_runtime_initialized = False


def initialize_runtime():
    global _runtime_initialized
    if _runtime_initialized:
        return

    auth_db = AuthenticationDB()
    auth_db.prepare(app.logger)
    prepare_paper_db(app.logger)
    init_admins()
    _runtime_initialized = True


initialize_runtime()

# --- do not add code any further than this line, or else...👻👻👻 ---

if not settings.PRODUCTION:
    print("\nAvailable endpoints:")
    for rule in sorted(app.url_map.iter_rules(), key=lambda r: r.rule):
        methods = ",".join(sorted(rule.methods - {"HEAD", "OPTIONS"}))
        if methods:
            print(f"  {methods:8s} {rule.rule}")
    print()

if __name__ == "__main__":
    try:
        app.run(
            debug=settings.BACKEND_DEBUG,
            host=settings.BACKEND_HOST,
            port=settings.BACKEND_PORT,
        )
    finally:
        teardown_admins()
