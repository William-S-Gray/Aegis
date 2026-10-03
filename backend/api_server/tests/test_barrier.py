import json
import time

import pytest
from sqlalchemy import select

from app.core import barrier
from app.models import AccessLog, AuditLog, Role, Vehicle

PASSWORD = "correct-horse-battery"


@pytest.fixture
def auth(client, make_user):
    def _auth(role: Role, email: str):
        make_user(email=email, password=PASSWORD, role=role)
        token = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return _auth


@pytest.fixture
def relay(monkeypatch):
    """Captures barrier calls; `succeeds` decides the controller's answer."""
    from app.api.v1 import alerts

    monkeypatch.setattr(alerts.settings, "barrier_open_url", "http://relay.test/open")
    monkeypatch.setattr(alerts.settings, "barrier_secret", "s3cret")
    calls = []

    class Relay:
        succeeds = True

        def __call__(self, url, secret, timeout, **payload):
            calls.append(payload)
            return self.succeeds

    fake = Relay()
    fake.calls = calls
    monkeypatch.setattr(barrier, "open_barrier", fake)
    return fake


@pytest.fixture
def setup(client, auth):
    admin = auth(Role.ADMIN, "admin@aegis.example")
    client.post("/api/v1/vehicles", headers=admin, json={"plate_number": "AAA5329", "vehicle_type": "sedan"})
    return {
        "admin": admin,
        "camera": auth(Role.SERVICE, "camera@aegis.example"),
        "guard": auth(Role.GUARD, "guard@aegis.example"),
    }


def detect(client, headers, **kwargs):
    body = {"plate_number": "AAA5329", "plate_confidence": 0.99, "detected_type": "sedan", **kwargs}
    return client.post("/api/v1/alerts", headers=headers, json=body).json()


class TestAutomaticOpening:
    def test_a_registered_matching_vehicle_opens_the_barrier(self, client, setup, relay, db):
        alert = detect(client, setup["camera"])

        assert alert["auto_opened"] is True
        assert relay.calls == [{"alert_id": alert["id"], "plate": "AAA5329", "site_id": None}]
        log = db.scalar(select(AccessLog))
        assert (log.action.value, log.user_id, log.details["automatic"]) == ("approve", None, True)
        assert db.scalar(select(AuditLog).where(AuditLog.action == "barrier.auto_opened"))

    @pytest.mark.parametrize(
        "kwargs",
        [
            {"plate_number": "ZZZ9999"},  # unregistered
            {"detected_type": "truck"},  # plate on the wrong kind of vehicle
            {"plate_confidence": 0.70},  # needs a human
        ],
    )
    def test_anything_short_of_a_clean_match_waits_for_a_guard(self, client, setup, relay, kwargs):
        alert = detect(client, setup["camera"], **kwargs)

        assert alert["auto_opened"] is False
        assert relay.calls == []

    def test_a_deactivated_vehicle_does_not_open_it(self, client, setup, relay, db):
        db.query(Vehicle).update({"is_active": False})
        db.commit()

        assert detect(client, setup["camera"])["auto_opened"] is False
        assert relay.calls == []

    def test_a_watchlisted_vehicle_never_opens_it_even_when_it_matches(self, client, setup, relay):
        """A stolen registered car matches its registration exactly."""
        client.post("/api/v1/watchlist", headers=setup["admin"],
                    json={"plate_number": "AAA5329", "reason": "Reported stolen"})

        alert = detect(client, setup["camera"])

        assert alert["mismatch_type"] == "watchlist"
        assert alert["auto_opened"] is False
        assert relay.calls == []

    def test_a_plate_typed_by_a_guard_does_not_open_it(self, client, setup, relay):
        """Manual entry is a guard at the gate: the guard decides, not the relay."""
        alert = client.post("/api/v1/alerts", headers=setup["guard"], json={"plate_number": "AAA5329"}).json()

        assert alert["auto_opened"] is False
        assert relay.calls == []

    def test_a_failed_relay_falls_back_to_the_guard(self, client, setup, relay, db):
        relay.succeeds = False

        assert detect(client, setup["camera"])["auto_opened"] is False
        assert db.scalar(select(AccessLog)) is None
        assert db.scalar(select(AuditLog).where(AuditLog.action == "barrier.open_failed"))

    def test_off_unless_configured(self, client, setup, monkeypatch):
        from app.api.v1 import alerts

        calls = []
        monkeypatch.setattr(barrier, "open_barrier", lambda *a, **k: calls.append(k) or True)
        monkeypatch.setattr(alerts.settings, "barrier_open_url", "")

        assert detect(client, setup["camera"])["auto_opened"] is False
        assert calls == []


class TestSignedRequest:
    def test_the_relay_can_verify_the_request_came_from_aegis(self, monkeypatch):
        sent = {}

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        def fake_open(request, timeout):
            sent.update(body=request.data, signature=request.get_header("X-aegis-signature"), timeout=timeout)
            return Response()

        monkeypatch.setattr(barrier._opener, "open", fake_open)

        assert barrier.open_barrier("http://relay.test/open", "s3cret", 3.0, alert_id="a1", plate="AAA5329", site_id=None)
        sent_body = json.loads(sent["body"])
        assert sent_body["plate"] == "AAA5329"
        # Signed along with the rest, so the relay can refuse a replayed request.
        assert abs(sent_body["timestamp"] - time.time()) < 5
        assert sent["signature"] == barrier.sign(sent["body"], "s3cret")
        assert sent["timeout"] == 3.0

    def test_an_unreachable_relay_is_a_failure_not_an_error(self):
        assert barrier.open_barrier("http://127.0.0.1:9/open", "s", 0.5, alert_id="a1", plate="X", site_id=None) is False


def test_a_barrier_url_without_a_secret_is_refused_at_startup():
    """Unsigned, anyone who can reach the relay could open the gate."""
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError, match="BARRIER_SECRET"):
        Settings(barrier_open_url="http://relay.test/open", barrier_secret="")
