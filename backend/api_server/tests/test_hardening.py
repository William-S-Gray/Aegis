"""
Regressions for the adversarial audit (docs/audit/2026-09-28-adversarial-refinement.md).

Each test names the finding it guards. Every one of them failed against the
code it replaced.
"""

import base64
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.routing import APIRoute
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from app.api.v1 import realtime
from app.core.deps import get_current_user
from app.core.state import ip_throttle, ticket_store
from app.main import app
from app.models import AccessLog, AuditLog, Role, User, Vehicle

PASSWORD = "correct-horse-battery"
JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 64).decode()


def _login(client, email, password=PASSWORD, forwarded_for=None):
    headers = {"X-Forwarded-For": forwarded_for} if forwarded_for else {}
    return client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}, headers=headers
    )


@pytest.fixture
def auth(client, make_user):
    def _auth(role: Role = Role.GUARD, email: str | None = None):
        email = email or f"{role.value}@aegis.example"
        user = make_user(email=email, password=PASSWORD, role=role)
        token = _login(client, email).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}, user

    return _auth


# ------------------------------------------------------------------ auth


class TestLoginThrottle:
    def test_forwarded_for_cannot_reset_the_throttle(self, client, make_user):
        """F-001: a fresh X-Forwarded-For per attempt used to mean a fresh bucket."""
        make_user(email="guard@aegis.example", password=PASSWORD, role=Role.GUARD)

        codes = [
            _login(client, "guard@aegis.example", "wrong-password", f"10.0.0.{i}").status_code
            for i in range(8)
        ]

        assert codes[:5] == [401] * 5
        assert set(codes[5:]) == {429}

    def test_forwarded_for_is_not_what_the_audit_log_records(self, client, db):
        _login(client, "nobody@aegis.example", "wrong-password", "203.0.113.9")

        entry = db.scalar(select(AuditLog).where(AuditLog.action == "auth.login.failed"))
        assert entry.ip_address != "203.0.113.9"

    def test_one_address_cannot_spray_many_accounts(self, client, monkeypatch):
        """F-003: the only limit used to be per account."""
        monkeypatch.setattr(ip_throttle, "_max_attempts", 3)

        codes = [
            _login(client, f"user{i}@aegis.example", "wrong-password").status_code
            for i in range(5)
        ]

        assert codes == [401, 401, 401, 429, 429]

    def test_a_locked_address_is_audited_once(self, client, db, monkeypatch):
        """F-038: every rejected request used to write an audit row."""
        monkeypatch.setattr(ip_throttle, "_max_attempts", 1)
        for i in range(10):
            _login(client, f"user{i}@aegis.example", "wrong-password")

        throttled = db.scalars(
            select(AuditLog).where(AuditLog.action == "auth.login.throttled")
        ).all()
        assert len(throttled) == 1


class TestEveryRouteIsAuthenticated:
    """A route added without require_roles used to pass CI silently."""

    PUBLIC = {"/health", "/ready", "/metrics", "/api/v1/auth/login", "/api/v1/auth/refresh"}

    @staticmethod
    def _depends_on(dependant, target) -> bool:
        return any(
            dep.call is target or TestEveryRouteIsAuthenticated._depends_on(dep, target)
            for dep in dependant.dependencies
        )

    def test_no_unguarded_routes(self):
        unguarded = [
            route.path
            for route in app.routes
            if isinstance(route, APIRoute)
            and route.path not in self.PUBLIC
            and not self._depends_on(route.dependant, get_current_user)
        ]
        assert unguarded == []


class TestRoster:
    def test_guards_see_only_active_colleagues(self, client, auth, make_user):
        """F-011: guards used to receive every account, service and former staff included."""
        headers, _ = auth(Role.GUARD)
        make_user(email="svc@aegis.example", role=Role.SERVICE)
        make_user(email="resident@aegis.example", role=Role.USER)
        make_user(email="gone@aegis.example", role=Role.GUARD, is_active=False)
        make_user(email="boss@aegis.example", role=Role.ADMIN)

        emails = {u["email"] for u in client.get("/api/v1/users", headers=headers).json()}

        assert emails == {"guard@aegis.example", "boss@aegis.example"}

    def test_admins_still_see_everyone(self, client, auth, make_user):
        headers, _ = auth(Role.ADMIN)
        make_user(email="svc@aegis.example", role=Role.SERVICE)

        emails = {u["email"] for u in client.get("/api/v1/users", headers=headers).json()}

        assert "svc@aegis.example" in emails


# ------------------------------------------------------------ realtime


class TestStreamRevocation:
    def test_a_deactivated_guard_is_disconnected(self, client, auth, db, monkeypatch):
        """F-005: the socket used to outlive the account."""
        monkeypatch.setattr(realtime, "_HEARTBEAT_SECONDS", 0.05)
        monkeypatch.setattr(realtime, "_REVALIDATE_SECONDS", 0)
        headers, guard = auth(Role.GUARD)
        ticket = client.post("/api/v1/auth/ws-ticket", headers=headers).json()["ticket"]

        with client.websocket_connect(
            f"/api/v1/ws/guard-alerts/{guard.id}?ticket={ticket}"
        ) as ws:
            assert ws.receive_json()["type"] == "connected"

            db.get(User, guard.id).is_active = False
            db.commit()

            with pytest.raises(WebSocketDisconnect):
                for _ in range(100):
                    ws.receive_json()

        ticket_store.clear()


# -------------------------------------------------------------- alerts


class TestRegister:
    def test_a_deactivated_vehicle_is_not_a_match(self, client, auth, db):
        """F-017: revocation used to leave the vehicle "matching the register"."""
        headers, _ = auth(Role.GUARD)
        db.add(
            Vehicle(
                plate_number="AB12CD",
                plate_display="AB12 CD",
                color="red",
                vehicle_type="car",
                is_active=False,
            )
        )
        db.commit()

        body = client.post(
            "/api/v1/alerts",
            json={"plate_number": "AB12CD", "detected_color": "red", "detected_type": "car"},
            headers=headers,
        ).json()

        assert body["mismatch_type"] == "unregistered"


class TestPlateValidation:
    @pytest.mark.parametrize("plate", ["---", "  ", "АВ", "ß" * 17])
    def test_unstorable_plates_are_refused(self, client, auth, plate):
        """F-025/F-026: empty and over-long normalised plates used to be stored or 500."""
        headers, _ = auth(Role.GUARD)

        for path, payload in [
            ("/api/v1/alerts", {"plate_number": plate}),
            ("/api/v1/access-logs", {"plate_number": plate, "action": "approve"}),
        ]:
            assert client.post(path, json=payload, headers=headers).status_code == 422, path


class TestReviewIntegrity:
    def _pending(self, client, headers) -> str:
        return client.post(
            "/api/v1/alerts",
            json={"plate_number": "AB12CD", "plate_confidence": 0.6},
            headers=headers,
        ).json()["id"]

    def test_an_accepted_alert_cannot_be_rewritten(self, client, auth):
        """F-024: any alert's plate used to be rewritable through confirm-plate."""
        headers, _ = auth(Role.GUARD)
        accepted = client.post(
            "/api/v1/alerts", json={"plate_number": "AB12CD"}, headers=headers
        ).json()["id"]

        response = client.post(
            f"/api/v1/alerts/{accepted}/confirm-plate",
            json={"plate_number": "ZZ99ZZ"},
            headers=headers,
        )

        assert response.status_code == 409

    def test_a_read_is_confirmed_once(self, client, auth):
        headers, _ = auth(Role.GUARD)
        alert_id = self._pending(client, headers)

        first = client.post(
            f"/api/v1/alerts/{alert_id}/confirm-plate",
            json={"plate_number": "AB12CD"},
            headers=headers,
        )
        second = client.post(
            f"/api/v1/alerts/{alert_id}/confirm-plate",
            json={"plate_number": "XX11XX"},
            headers=headers,
        )

        assert first.status_code == 200
        assert second.status_code == 409

    def test_the_queue_gauge_counts_beyond_one_page(self, client, auth):
        """F-031: the gauge was len(page), so it could never exceed `limit`."""
        from app.core import metrics

        headers, _ = auth(Role.GUARD)
        for _ in range(3):
            self._pending(client, headers)

        client.get("/api/v1/alerts/review-queue?limit=1", headers=headers)

        assert metrics.review_queue_depth._value.get() == 3


class TestServiceAccount:
    def test_a_machine_read_must_state_its_confidence(self, client, auth):
        """F-034: omitting confidence used to skip human review."""
        headers, _ = auth(Role.SERVICE)

        response = client.post("/api/v1/alerts", json={"plate_number": "AB12CD"}, headers=headers)

        assert response.status_code == 422

    def test_the_stub_is_refused_outside_development(self, client, auth, monkeypatch):
        from app.api.v1 import alerts

        monkeypatch.setattr(alerts.settings, "environment", "production")
        headers, _ = auth(Role.SERVICE)

        response = client.post(
            "/api/v1/alerts",
            json={"plate_number": "AB12CD", "plate_confidence": 0.9, "detector_name": "stub"},
            headers=headers,
        )

        assert response.status_code == 422


class TestPlateImage:
    def test_the_reviewer_sees_the_crop_and_the_view_is_audited(self, client, auth, db):
        """F-030: review used to happen without any image of the plate."""
        service, _ = auth(Role.SERVICE)
        guard, _ = auth(Role.GUARD)
        alert_id = client.post(
            "/api/v1/alerts",
            json={"plate_number": "AB12CD", "plate_confidence": 0.6, "plate_crop_jpeg": JPEG},
            headers=service,
        ).json()["id"]

        crop = client.get(f"/api/v1/alerts/{alert_id}/crop", headers=guard)

        assert crop.status_code == 200
        assert crop.headers["content-type"] == "image/jpeg"
        assert crop.content == base64.b64decode(JPEG)
        assert db.scalar(select(AuditLog).where(AuditLog.action == "alert.crop_viewed"))

    def test_only_jpeg_is_accepted(self, client, auth):
        headers, _ = auth(Role.SERVICE)
        html = base64.b64encode(b"<html><script>1</script></html>").decode()

        response = client.post(
            "/api/v1/alerts",
            json={"plate_number": "AB12CD", "plate_confidence": 0.6, "plate_crop_jpeg": html},
            headers=headers,
        )

        assert response.status_code == 422

    def test_a_service_account_cannot_view_crops(self, client, auth):
        headers, _ = auth(Role.SERVICE)
        assert client.get(f"/api/v1/alerts/{uuid.uuid4()}/crop", headers=headers).status_code == 403

    def test_list_endpoints_do_not_carry_the_image(self, client, auth):
        service, _ = auth(Role.SERVICE)
        guard, _ = auth(Role.GUARD)
        client.post(
            "/api/v1/alerts",
            json={"plate_number": "AB12CD", "plate_confidence": 0.6, "plate_crop_jpeg": JPEG},
            headers=service,
        )

        body = client.get("/api/v1/alerts", headers=guard).json()

        assert "plate_crop" not in str(body)
        # Only whether one exists, so the review page asks just for images that do.
        queue = client.get("/api/v1/alerts/review-queue", headers=guard).json()
        assert [a["has_crop"] for a in queue] == [True]


# ---------------------------------------------------------- access logs


class TestAccessLogs:
    def test_a_replayed_decision_is_recorded_once(self, client, auth, db):
        """F-022: offline replays and retries used to duplicate decisions."""
        headers, _ = auth(Role.GUARD)
        payload = {"plate_number": "AB12CD", "action": "approve", "client_ref": str(uuid.uuid4())}

        first = client.post("/api/v1/access-logs", json=payload, headers=headers)
        second = client.post("/api/v1/access-logs", json=payload, headers=headers)

        assert first.json()["id"] == second.json()["id"]
        assert len(db.scalars(select(AccessLog)).all()) == 1

    @pytest.mark.parametrize(
        "timestamp",
        [
            (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            (datetime.now(timezone.utc) - timedelta(days=30)).isoformat(),
            "2026-01-01T00:00:00",  # no timezone
        ],
    )
    def test_implausible_timestamps_are_refused(self, client, auth, timestamp):
        """F-023: the client's clock used to be accepted as-is."""
        headers, _ = auth(Role.GUARD)

        response = client.post(
            "/api/v1/access-logs",
            json={"plate_number": "AB12CD", "action": "approve", "timestamp": timestamp},
            headers=headers,
        )

        assert response.status_code == 422

    def test_details_are_bounded(self, client, auth):
        """F-053: any guard could store megabytes per row."""
        headers, _ = auth(Role.GUARD)

        response = client.post(
            "/api/v1/access-logs",
            json={"plate_number": "AB12CD", "action": "approve", "details": {"x": "a" * 10_000}},
            headers=headers,
        )

        assert response.status_code == 422

    def test_a_new_owner_does_not_see_the_previous_owners_history(
        self, client, auth, make_user, db
    ):
        """F-029: history used to be scoped by plate text, not ownership period."""
        guard, _ = auth(Role.GUARD)
        admin, _ = auth(Role.ADMIN)
        first = make_user(email="first@aegis.example", role=Role.USER)
        second_headers, second = auth(Role.USER, email="second@aegis.example")

        vehicle_id = client.post(
            "/api/v1/vehicles",
            json={"plate_number": "AB12CD", "owner_id": str(first.id)},
            headers=admin,
        ).json()["id"]
        client.post(
            "/api/v1/access-logs", json={"plate_number": "AB12CD", "action": "entry"}, headers=guard
        )

        client.patch(
            f"/api/v1/vehicles/{vehicle_id}", json={"owner_id": str(second.id)}, headers=admin
        )
        client.post(
            "/api/v1/access-logs", json={"plate_number": "AB12CD", "action": "exit"}, headers=guard
        )

        logs = client.get("/api/v1/logs", headers=second_headers).json()["logs"]

        assert [entry["action"] for entry in logs] == ["exit"]


class TestReadiness:
    def test_ready_checks_the_database(self, client):
        assert client.get("/ready").json() == {"status": "ready"}


class TestCliCreateUser:
    def test_rejects_an_email_the_api_cannot_serve(self, capsys):
        from app.cli import create_user

        # Reserved domains pass a naive check but fail the API's EmailStr, which
        # made GET /users return 500 for every admin once one such row existed.
        assert create_user("admin@aegis.local", "Admin", "admin") == 1
        assert "Invalid email" in capsys.readouterr().err


class TestCameraPreview:
    JPEG = b"\xff\xd8\xff\xe0" + b"frame" * 20

    def _publish(self, client, headers, body=JPEG, camera="main-gate"):
        return client.put(
            f"/api/v1/cameras/{camera}/frame?name=Main%20Gate",
            content=body,
            headers={**headers, "content-type": "image/jpeg"},
        )

    def test_each_camera_reports_how_long_since_its_last_frame(self, client, auth):
        """Feeds the AegisCameraOffline alert; one series per camera id."""
        service, _ = auth(Role.SERVICE)
        self._publish(client, service)

        body = client.get("/metrics").text

        line = next(l for l in body.splitlines() if l.startswith("aegis_camera_seconds_since_frame{"))
        assert line.startswith('aegis_camera_seconds_since_frame{camera="main-gate"} ')
        assert 0 <= float(line.split()[-1]) < 5

    def test_guard_sees_the_latest_frame_the_service_published(self, client, auth, db):
        service, _ = auth(Role.SERVICE)
        guard, _ = auth(Role.GUARD)
        assert self._publish(client, service).status_code == 204

        cameras = client.get("/api/v1/cameras", headers=guard).json()
        assert [(c["id"], c["name"], c["online"]) for c in cameras] == [("main-gate", "Main Gate", True)]

        frame = client.get("/api/v1/cameras/main-gate/frame", headers=guard)
        assert frame.status_code == 200
        assert frame.content == self.JPEG
        assert frame.headers["cache-control"] == "no-store"

        # Viewing is audited once per window, not once per polled frame.
        client.get("/api/v1/cameras/main-gate/frame", headers=guard)
        views = db.scalars(select(AuditLog).where(AuditLog.action == "camera.viewed")).all()
        assert len(views) == 1

    def test_only_the_service_account_may_publish(self, client, auth):
        for role in (Role.GUARD, Role.ADMIN):
            headers, _ = auth(role)
            assert self._publish(client, headers).status_code == 403

    def test_the_service_account_cannot_watch(self, client, auth):
        service, _ = auth(Role.SERVICE)
        assert client.get("/api/v1/cameras", headers=service).status_code == 403

    def test_rejects_non_jpeg_oversized_and_malformed_ids(self, client, auth):
        service, _ = auth(Role.SERVICE)
        assert self._publish(client, service, body=b"\x89PNG....").status_code == 415
        big = b"\xff\xd8" + b"x" * (600 * 1024)
        assert self._publish(client, service, body=big).status_code == 413
        assert self._publish(client, service, camera="Bad_ID").status_code == 404

    def test_a_silent_camera_is_offline(self, client, auth, monkeypatch):
        from app.api.v1 import cameras

        service, _ = auth(Role.SERVICE)
        guard, _ = auth(Role.GUARD)
        self._publish(client, service)
        monkeypatch.setattr(cameras, "STALE_AFTER_SECONDS", 0)
        assert client.get("/api/v1/cameras", headers=guard).json()[0]["online"] is False
        assert client.get("/api/v1/cameras/main-gate/frame", headers=guard).status_code == 404
