"""Public demo accounts (DEMO_READONLY_EMAILS) can read but never write."""
import pytest

from app.config import get_settings
from app.core.security import create_access_token
from app.models import Role


@pytest.fixture
def demo_guard(make_user, monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_readonly_emails", "Demo.Guard@aegis.example, other@x.example")
    user = make_user(email="demo.guard@aegis.example", role=Role.GUARD)
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


def test_demo_account_can_read(client, demo_guard):
    assert client.get("/api/v1/vehicles", headers=demo_guard).status_code == 200


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/api/v1/auth/password"),
        ("post", "/api/v1/vehicles"),
        ("post", "/api/v1/access-logs"),
        ("post", "/api/v1/watchlist"),
    ],
)
def test_demo_account_cannot_write(client, demo_guard, method, path):
    resp = getattr(client, method)(path, headers=demo_guard, json={})
    assert resp.status_code == 403
    assert "read-only" in resp.text


def test_demo_account_can_sign_out(client, demo_guard):
    assert client.post("/api/v1/auth/logout", headers=demo_guard, json={}).status_code != 403


def test_other_accounts_still_write(client, make_user, monkeypatch):
    monkeypatch.setattr(get_settings(), "demo_readonly_emails", "demo.guard@aegis.example")
    user = make_user(email="real.guard@aegis.example", role=Role.GUARD)
    headers = {"Authorization": f"Bearer {create_access_token(str(user.id))}"}
    # A validation error, not the demo refusal: the request reached the route.
    resp = client.post("/api/v1/watchlist", headers=headers, json={})
    assert "read-only" not in resp.text
