from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models import Role, Visit

PASSWORD = "correct-horse-battery"


@pytest.fixture
def auth(client, make_user):
    def _auth(role: Role, email: str):
        make_user(email=email, password=PASSWORD, role=role)
        token = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return _auth


@pytest.fixture
def people(auth):
    return {
        "admin": auth(Role.ADMIN, "admin@aegis.example"),
        "guard": auth(Role.GUARD, "guard@aegis.example"),
        "camera": auth(Role.SERVICE, "camera@aegis.example"),
    }


def read(client, headers, direction, plate="ABC1234"):
    body = {"plate_number": plate, "plate_confidence": 0.99}
    if direction:
        body["direction"] = direction
    return client.post("/api/v1/alerts", headers=headers, json=body).json()


class TestPairing:
    def test_an_entry_then_an_exit_is_one_visit(self, client, people, db):
        read(client, people["camera"], "entry")
        assert [v["plate_number"] for v in client.get("/api/v1/visits/on-site", headers=people["guard"]).json()] == ["ABC1234"]

        read(client, people["camera"], "exit")

        visit = db.scalar(select(Visit))
        assert visit.entered_at and visit.exited_at and visit.exited_at >= visit.entered_at
        assert client.get("/api/v1/visits/on-site", headers=people["guard"]).json() == []

    def test_a_second_entry_read_is_the_same_visit(self, client, people, db):
        read(client, people["camera"], "entry")
        read(client, people["camera"], "entry")

        assert len(db.scalars(select(Visit)).unique().all()) == 1

    def test_an_exit_without_an_entry_is_kept(self, client, people, db):
        read(client, people["camera"], "exit")

        visit = db.scalar(select(Visit))
        assert visit.entered_at is None and visit.exited_at is not None

    def test_an_untagged_camera_records_no_visit(self, client, people, db):
        read(client, people["camera"], None)

        assert db.scalar(select(Visit)) is None

    def test_a_vehicle_turned_away_at_the_entry_never_came_in(self, client, people):
        alert = read(client, people["camera"], "entry")

        client.post("/api/v1/access-logs", headers=people["guard"],
                    json={"plate_number": "ABC1234", "action": "deny", "details": {"alert_id": alert["id"]}})

        assert client.get("/api/v1/visits/on-site", headers=people["guard"]).json() == []

    def test_a_visitor_on_site_shows_their_pass(self, client, people, auth):
        now = datetime.now(timezone.utc)
        resident = auth(Role.USER, "resident@aegis.example")
        client.post("/api/v1/visitor-passes", headers=resident, json={
            "plate_number": "ABC1234", "visitor_name": "Tendai M.",
            "valid_from": (now - timedelta(hours=1)).isoformat(), "valid_until": (now + timedelta(hours=2)).isoformat()})

        read(client, people["camera"], "entry")

        on_site = client.get("/api/v1/visits/on-site", headers=people["guard"]).json()
        assert on_site[0]["visitor_pass"]["visitor_name"] == "Tendai M."


class TestHistory:
    def test_admins_see_durations_and_the_median(self, client, people, db):
        read(client, people["camera"], "entry")
        read(client, people["camera"], "exit")
        visit = db.scalar(select(Visit))
        visit.entered_at = visit.exited_at - timedelta(minutes=42)
        db.commit()

        body = client.get("/api/v1/visits", headers=people["admin"]).json()

        assert body["total"] == 1
        assert body["median_minutes"] == 42.0

    def test_guards_do_not_see_the_history(self, client, people):
        assert client.get("/api/v1/visits", headers=people["guard"]).status_code == 403
