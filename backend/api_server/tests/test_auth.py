from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.security import create_access_token, create_refresh_token, decode_token
from app.models import AuditLog, RefreshToken, Role

PASSWORD = "correct-horse-battery"


class TestLogin:
    def test_valid_credentials_return_tokens_and_user(self, client, make_user):
        make_user(email="guard@aegis.example", password=PASSWORD, role=Role.GUARD)

        response = client.post(
            "/api/v1/auth/login",
            json={"email": "guard@aegis.example", "password": PASSWORD},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["token_type"] == "bearer"
        assert body["user"]["email"] == "guard@aegis.example"
        assert body["user"]["role"] == "guard"
        # The digest must never be exposed.
        assert "hashed_password" not in body["user"]
        assert "password" not in body["user"]

    def test_wrong_password_is_rejected(self, client, make_user):
        make_user(email="guard@aegis.example", password=PASSWORD)

        response = client.post(
            "/api/v1/auth/login",
            json={"email": "guard@aegis.example", "password": "wrong-password"},
        )

        assert response.status_code == 401
        assert "access_token" not in response.json()

    def test_unknown_email_is_rejected(self, client):
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "nobody@aegis.example", "password": PASSWORD},
        )
        assert response.status_code == 401

    def test_unknown_and_wrong_password_are_indistinguishable(self, client, make_user):
        """Account enumeration guard: both failures must look identical."""
        make_user(email="real@aegis.example", password=PASSWORD)

        unknown = client.post(
            "/api/v1/auth/login",
            json={"email": "ghost@aegis.example", "password": PASSWORD},
        )
        wrong = client.post(
            "/api/v1/auth/login",
            json={"email": "real@aegis.example", "password": "nope-nope-nope"},
        )

        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json()["detail"] == wrong.json()["detail"]

    def test_inactive_account_cannot_log_in(self, client, make_user):
        make_user(email="fired@aegis.example", password=PASSWORD, is_active=False)

        response = client.post(
            "/api/v1/auth/login",
            json={"email": "fired@aegis.example", "password": PASSWORD},
        )
        assert response.status_code == 401

    def test_email_is_case_insensitive(self, client, make_user):
        make_user(email="mixed@aegis.example", password=PASSWORD)

        response = client.post(
            "/api/v1/auth/login",
            json={"email": "MiXeD@AEGIS.example", "password": PASSWORD},
        )
        assert response.status_code == 200

    def test_repeated_failures_are_throttled(self, client, make_user):
        make_user(email="target@aegis.example", password=PASSWORD)

        for _ in range(5):
            client.post(
                "/api/v1/auth/login",
                json={"email": "target@aegis.example", "password": "bad"},
            )

        blocked = client.post(
            "/api/v1/auth/login",
            json={"email": "target@aegis.example", "password": PASSWORD},
        )
        assert blocked.status_code == 429
        assert "Retry-After" in blocked.headers

    def test_login_is_audited(self, client, make_user, db):
        make_user(email="audited@aegis.example", password=PASSWORD)

        client.post(
            "/api/v1/auth/login",
            json={"email": "audited@aegis.example", "password": PASSWORD},
        )
        client.post(
            "/api/v1/auth/login",
            json={"email": "audited@aegis.example", "password": "bad"},
        )

        actions = set(db.scalars(select(AuditLog.action)).all())
        assert "auth.login.succeeded" in actions
        assert "auth.login.failed" in actions

    def test_audit_never_stores_the_password(self, client, make_user, db):
        make_user(email="audited@aegis.example", password=PASSWORD)
        client.post(
            "/api/v1/auth/login",
            json={"email": "audited@aegis.example", "password": "sup3r-s3cret-value"},
        )

        for entry in db.scalars(select(AuditLog)).all():
            assert "sup3r-s3cret-value" not in str(entry.details or {})


class TestProtectedRoutes:
    def _login(self, client, email, password=PASSWORD):
        return client.post(
            "/api/v1/auth/login", json={"email": email, "password": password}
        ).json()

    def test_me_requires_a_token(self, client):
        assert client.get("/api/v1/auth/me").status_code == 401

    def test_me_rejects_a_garbage_token(self, client):
        response = client.get(
            "/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"}
        )
        assert response.status_code == 401

    def test_me_returns_the_caller(self, client, make_user):
        make_user(email="me@aegis.example", password=PASSWORD, role=Role.ADMIN)
        tokens = self._login(client, "me@aegis.example")

        response = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        assert response.status_code == 200
        assert response.json()["email"] == "me@aegis.example"

    def test_refresh_token_is_not_accepted_as_an_access_token(self, client, make_user):
        make_user(email="me@aegis.example", password=PASSWORD)
        tokens = self._login(client, "me@aegis.example")

        response = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {tokens['refresh_token']}"},
        )
        assert response.status_code == 401

    def test_token_for_a_deactivated_user_stops_working(self, client, make_user, db):
        user = make_user(email="soon@aegis.example", password=PASSWORD)
        tokens = self._login(client, "soon@aegis.example")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        assert client.get("/api/v1/auth/me", headers=headers).status_code == 200

        user.is_active = False
        db.commit()

        assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


class TestRefreshFlow:
    def test_refresh_returns_a_new_pair(self, client, make_user):
        make_user(email="r@aegis.example", password=PASSWORD)
        first = client.post(
            "/api/v1/auth/login", json={"email": "r@aegis.example", "password": PASSWORD}
        ).json()

        second = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]}
        )

        assert second.status_code == 200
        assert second.json()["refresh_token"] != first["refresh_token"]

    def test_refresh_token_cannot_be_reused(self, client, make_user):
        """Rotation: a stolen refresh token is good for at most one exchange."""
        make_user(email="r@aegis.example", password=PASSWORD)
        first = client.post(
            "/api/v1/auth/login", json={"email": "r@aegis.example", "password": PASSWORD}
        ).json()

        client.post("/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]})
        replay = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]}
        )

        assert replay.status_code == 401

    def test_unknown_refresh_token_is_rejected(self, client):
        response = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": "made-up-value"}
        )
        assert response.status_code == 401

    def test_logout_revokes_the_refresh_token(self, client, make_user):
        make_user(email="out@aegis.example", password=PASSWORD)
        tokens = client.post(
            "/api/v1/auth/login", json={"email": "out@aegis.example", "password": PASSWORD}
        ).json()

        logout = client.post(
            "/api/v1/auth/logout",
            json={"refresh_token": tokens["refresh_token"]},
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        assert logout.status_code == 204

        replay = client.post(
            "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
        assert replay.status_code == 401

    def test_refresh_tokens_are_never_stored_in_plaintext(self, client, make_user, db):
        make_user(email="h@aegis.example", password=PASSWORD)
        tokens = client.post(
            "/api/v1/auth/login", json={"email": "h@aegis.example", "password": PASSWORD}
        ).json()

        stored = db.scalars(select(RefreshToken)).all()
        assert stored
        for row in stored:
            assert row.token_hash != tokens["refresh_token"]
            assert len(row.token_hash) == 64


class TestTokenPrimitives:
    def test_access_token_round_trips(self):
        token = create_access_token("abc-123")
        assert decode_token(token, "access")["sub"] == "abc-123"

    def test_decoding_with_the_wrong_expected_type_fails(self):
        import jwt as pyjwt
        import pytest

        token = create_access_token("abc-123")
        with pytest.raises(pyjwt.InvalidTokenError):
            decode_token(token, "refresh")

    def test_refresh_token_digest_is_not_the_raw_value(self):
        raw, digest, expires_at = create_refresh_token()
        assert raw != digest
        assert len(digest) == 64
        assert expires_at > datetime.now(timezone.utc) + timedelta(days=6)
