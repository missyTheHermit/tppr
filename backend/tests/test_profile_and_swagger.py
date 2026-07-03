import os
import sys
from unittest.mock import patch

import pytest
from flask import Flask, g

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg2://test:test@localhost:5432/test",
)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    from social import social_bp
    from swagger import swagger_bp

    app.register_blueprint(social_bp)
    app.register_blueprint(swagger_bp)
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def _fake_auth(user_id="viewer-1"):
    def fake_authenticate(optional=False, sync_user=False):
        g.user_id = user_id
        g.supabase_claims = {"sub": user_id, "role": "authenticated"}
        g.local_user = {"user_id": user_id}
        return None

    return fake_authenticate


def test_swagger_exposes_api_key_authorization(client):
    response = client.get("/swagger.json")

    assert response.status_code == 200
    spec = response.get_json()
    assert spec["components"]["securitySchemes"]["apiKeyAuth"] == {
        "type": "apiKey",
        "in": "header",
        "name": "X-API-Key",
    }
    assert {"apiKeyAuth": []} in spec["paths"]["/api/papers"]["post"]["security"]


def test_profile_can_be_loaded_by_username_without_friendship(client):
    from auth.db import UserDB

    profile_user = UserDB(
        user_id="user-123",
        username="tirbofish",
        email="tirbofish@example.com",
        password_hash="",
    )

    with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("viewer-1")), \
        patch("social.routes.resolve_profile_user", return_value=profile_user), \
        patch("social.routes.compute_many_students", return_value={"user-123": {}}), \
        patch("social.routes.get_session") as mock_get_session:
        session = mock_get_session.return_value.__enter__.return_value
        session.get.return_value = None
        session.exec.return_value.all.return_value = []

        response = client.get("/api/users/tirbofish/profile")

    assert response.status_code == 200
    assert response.get_json()["user"]["username"] == "tirbofish"
