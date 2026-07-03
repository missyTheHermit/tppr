import os
import sys

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg2://test:test@localhost:5432/test",
)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


def test_sensitive_probe_paths_do_not_fall_back_to_spa(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "argv", ["main.py"])
    import auth.db
    import questions.db
    monkeypatch.setattr(auth.db.AuthenticationDB, "prepare", lambda self, log: None)
    monkeypatch.setattr(questions.db, "prepare", lambda log: None)
    monkeypatch.setattr("admin.init_admins", lambda: None)

    import main

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>app shell</html>", encoding="utf-8")
    monkeypatch.setattr(main, "frontend_dist_dir", str(dist))

    client = main.app.test_client()

    for path in ["/.git/config", "/actuator/env", "/.env", "/credentials.json"]:
        response = client.get(path)
        assert response.status_code == 404
        assert response.get_json()["message"] == "404, resource not found"

    assert client.get("/users/tirbofish").status_code == 200
