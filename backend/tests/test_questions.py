import pytest
import dotenv
dotenv.load_dotenv()

from unittest.mock import patch, MagicMock
from flask import Flask, g

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def app():
    """Create a minimal Flask app with auth blueprints registered."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret"

    from auth.account import account_bp
    from auth.management import management_bp
    from auth.two_factor import two_fa_bp

    app.register_blueprint(account_bp)
    app.register_blueprint(management_bp)
    app.register_blueprint(two_fa_bp)

    return app


@pytest.fixture
def client(app):
    return app.test_client()


def _fake_auth(user_id="user-123"):
    """Patch supabase auth so endpoints think the user is authenticated."""
    def fake_authenticate(optional=False, sync_user=False):
        g.user_id = user_id
        g.supabase_claims = {"sub": user_id, "role": "authenticated"}
        g.local_user = {"user_id": user_id}
        return None
    return fake_authenticate


# ---------------------------------------------------------------------------
# /api/whoami
# ---------------------------------------------------------------------------

class TestWhoami:
    def test_unauthenticated(self, client):
        """Missing token returns 401."""
        resp = client.get("/api/whoami")
        assert resp.status_code == 401

    @patch("auth.account.get_current_user_id", return_value="user-123")
    @patch("auth.account.db.get_user_by_id", return_value={
        "user_id": "user-123",
        "username": "testuser",
        "email": "test@example.com",
        "totp_enabled": 0,
    })
    @patch("admin.has_admin_role", return_value=False)
    @patch("admin.is_admin", return_value=False)
    def test_authenticated(self, mock_admin, mock_admin_role, mock_db, mock_uid, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.get("/api/whoami")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["username"] == "testuser"
        assert data["email"] == "test@example.com"
        assert data["totp_enabled"] is False

    @patch("auth.account.get_current_user_id", return_value="user-999")
    @patch("auth.account.db.get_user_by_id", return_value=None)
    def test_user_not_found(self, mock_db, mock_uid, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-999")):
            resp = client.get("/api/whoami")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# /api/whotf
# ---------------------------------------------------------------------------

class TestWhotf:
    def test_missing_user_id_param(self, client):
        resp = client.get("/api/whotf")
        assert resp.status_code == 400
        assert "user_id is required" in resp.get_json()["message"]

    @patch("auth.management.db.get_user_by_id", return_value={
        "user_id": "user-123",
        "username": "testuser",
    })
    def test_found(self, mock_db, client):
        resp = client.get("/api/whotf?user_id=user-123")
        assert resp.status_code == 200
        assert resp.get_json()["username"] == "testuser"

    @patch("auth.management.db.get_user_by_id", return_value=None)
    def test_not_found(self, mock_db, client):
        resp = client.get("/api/whotf?user_id=nonexistent")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# /api/account/username  (PUT)
# ---------------------------------------------------------------------------

class TestUpdateUsername:
    def test_unauthenticated(self, client):
        resp = client.put("/api/account/username", data={"username": "new"})
        assert resp.status_code == 401

    @patch("auth.management.get_current_user_id", return_value="user-123")
    @patch("auth.management.db.get_user_by_id", return_value={"user_id": "user-123"})
    @patch("auth.management.db.is_username_taken", return_value=False)
    @patch("auth.management.db.update_username")
    def test_success(self, mock_update, mock_taken, mock_get, mock_uid, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.put("/api/account/username", data={"username": "newname"})
        assert resp.status_code == 200
        assert resp.get_json()["username"] == "newname"

    @patch("auth.management.get_current_user_id", return_value="user-123")
    @patch("auth.management.db.get_user_by_id", return_value={"user_id": "user-123"})
    @patch("auth.management.db.is_username_taken", return_value=True)
    def test_username_taken(self, mock_taken, mock_get, mock_uid, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.put("/api/account/username", data={"username": "taken"})
        assert resp.status_code == 400
        assert "already in use" in resp.get_json()["message"]

    @patch("auth.management.get_current_user_id", return_value="user-123")
    def test_empty_username(self, mock_uid, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.put("/api/account/username", data={"username": ""})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# /api/account/password  (PUT)
# ---------------------------------------------------------------------------

class TestUpdatePassword:
    def test_returns_gone(self, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.put("/api/account/password")
        assert resp.status_code == 410


# ---------------------------------------------------------------------------
# /api/account  (DELETE)
# ---------------------------------------------------------------------------

class TestDeleteAccount:
    @patch("auth.management.get_current_user_id", return_value="user-123")
    @patch("auth.management.db.get_user_by_id", return_value={"avatar_url": None})
    @patch("auth.management.db.delete_user", return_value=True)
    @patch("auth.management.delete_supabase_auth_user")
    def test_success(self, mock_supabase_delete, mock_del, mock_get, mock_uid, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.delete("/api/account")
        assert resp.status_code == 200

    @patch("auth.management.get_current_user_id", return_value="user-123")
    @patch("auth.management.db.get_user_by_id", return_value={"avatar_url": None})
    @patch("auth.management.db.delete_user", return_value=False)
    @patch("auth.management.delete_supabase_auth_user")
    def test_not_found(self, mock_supabase_delete, mock_del, mock_get, mock_uid, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.delete("/api/account")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# /api/verify_2fa  (POST) — deprecated
# ---------------------------------------------------------------------------

class TestVerify2FA:
    def test_returns_gone(self, client):
        resp = client.post("/api/verify_2fa")
        assert resp.status_code == 410


# ---------------------------------------------------------------------------
# /api/account/enable_2fa  (POST)
# ---------------------------------------------------------------------------

class TestEnable2FA:
    @patch("auth.two_factor.get_current_user_id", return_value="user-123")
    @patch("auth.two_factor.db.get_user_by_id", return_value={
        "user_id": "user-123",
        "email": "test@example.com",
        "totp_enabled": 0,
    })
    @patch("auth.two_factor.db.enable_totp")
    def test_success(self, mock_enable, mock_get, mock_uid, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.post("/api/account/enable_2fa")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "totp_secret" in data
        assert "qr_code" in data
        assert data["qr_code"].startswith("data:image/png;base64,")

    @patch("auth.two_factor.get_current_user_id", return_value="user-123")
    @patch("auth.two_factor.db.get_user_by_id", return_value={
        "user_id": "user-123",
        "email": "test@example.com",
        "totp_enabled": 1,
    })
    def test_already_enabled(self, mock_get, mock_uid, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.post("/api/account/enable_2fa")
        assert resp.status_code == 400
        assert "already enabled" in resp.get_json()["message"]


# ---------------------------------------------------------------------------
# /api/account/disable_2fa  (POST)
# ---------------------------------------------------------------------------

class TestDisable2FA:
    @patch("auth.two_factor.get_current_user_id", return_value="user-123")
    def test_missing_code(self, mock_uid, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.post("/api/account/disable_2fa", data={})
        assert resp.status_code == 400

    @patch("auth.two_factor.get_current_user_id", return_value="user-123")
    @patch("auth.two_factor.db.get_user_by_id", return_value={
        "user_id": "user-123",
        "totp_secret": "JBSWY3DPEHPK3PXP",
        "totp_enabled": 1,
    })
    @patch("auth.two_factor.db.disable_totp")
    def test_valid_code(self, mock_disable, mock_get, mock_uid, app, client):
        import pyotp
        secret = "JBSWY3DPEHPK3PXP"
        valid_code = pyotp.TOTP(secret).now()

        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.post("/api/account/disable_2fa", data={"totp_code": valid_code})
        assert resp.status_code == 200

    @patch("auth.two_factor.get_current_user_id", return_value="user-123")
    @patch("auth.two_factor.db.get_user_by_id", return_value={
        "user_id": "user-123",
        "totp_secret": "JBSWY3DPEHPK3PXP",
        "totp_enabled": 1,
    })
    def test_invalid_code(self, mock_get, mock_uid, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.post("/api/account/disable_2fa", data={"totp_code": "000000"})
        assert resp.status_code == 401

    @patch("auth.two_factor.get_current_user_id", return_value="user-123")
    @patch("auth.two_factor.db.get_user_by_id", return_value={
        "user_id": "user-123",
        "totp_secret": None,
        "totp_enabled": 0,
    })
    def test_2fa_not_enabled(self, mock_get, mock_uid, app, client):
        with patch("auth.supabase.authenticate_supabase_request", side_effect=_fake_auth("user-123")):
            resp = client.post("/api/account/disable_2fa", data={"totp_code": "123456"})
        assert resp.status_code == 400
