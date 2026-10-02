import pytest
from sqlalchemy import select

from app.models import AuditLog, Role

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


def watch(client, headers, plate="ABC 1234", reason="Reported stolen 30 Sep"):
    return client.post("/api/v1/watchlist", headers=headers, json={"plate_number": plate, "reason": reason})


def read(client, headers, plate="ABC1234", **extra):
    return client.post("/api/v1/alerts", headers=headers, json={"plate_number": plate, "plate_confidence": 0.99, **extra}).json()


class TestManagingTheList:
    def test_only_admins_add_and_remove(self, client, people):
        assert watch(client, people["guard"]).status_code == 403
        entry = watch(client, people["admin"]).json()

        assert client.post(f"/api/v1/watchlist/{entry['id']}/remove", headers=people["guard"]).status_code == 403
        assert client.post(f"/api/v1/watchlist/{entry['id']}/remove", headers=people["admin"]).json()["removed_at"]

    def test_guards_can_see_what_is_watched(self, client, people):
        watch(client, people["admin"])

        assert [e["plate_number"] for e in client.get("/api/v1/watchlist", headers=people["guard"]).json()] == ["ABC1234"]

    def test_a_plate_is_watched_once(self, client, people):
        watch(client, people["admin"])

        assert watch(client, people["admin"], plate="abc-1234").status_code == 409

    def test_changes_are_audited(self, client, people, db):
        entry = watch(client, people["admin"]).json()
        client.post(f"/api/v1/watchlist/{entry['id']}/remove", headers=people["admin"])

        actions = set(db.scalars(select(AuditLog.action)))
        assert {"watchlist.added", "watchlist.removed"} <= actions


class TestAtTheGate:
    def test_a_watched_plate_is_flagged_with_the_reason(self, client, people):
        watch(client, people["admin"])

        alert = read(client, people["camera"])

        assert alert["mismatch_type"] == "watchlist"
        assert alert["watchlist_entry"]["reason"] == "Reported stolen 30 Sep"

    def test_it_outranks_a_registered_vehicle_that_matches(self, client, people):
        """A stolen plate on the right car, or the registered car itself stolen."""
        client.post("/api/v1/vehicles", headers=people["admin"], json={"plate_number": "ABC1234", "vehicle_type": "sedan"})
        watch(client, people["admin"])

        assert read(client, people["camera"], detected_type="sedan")["mismatch_type"] == "watchlist"

    def test_a_removed_entry_no_longer_flags(self, client, people):
        entry = watch(client, people["admin"]).json()
        client.post(f"/api/v1/watchlist/{entry['id']}/remove", headers=people["admin"])

        assert read(client, people["camera"])["mismatch_type"] == "unregistered"

    def test_hits_are_counted_for_alerting_without_the_plate(self, client, people):
        """Prometheus pages on this; the plate itself must never reach a metric label."""
        from app.core.metrics import registry

        watch(client, people["admin"])
        read(client, people["camera"])

        hits = registry.get_sample_value(
            "aegis_alerts_created_total", {"mismatch_type": "watchlist", "requires_review": "false"}
        )
        assert hits and hits >= 1
        exposition = "\n".join(f"{s.name}{s.labels}" for m in registry.collect() for s in m.samples)
        assert "ABC1234" not in exposition


def test_export_and_erasure_cover_the_watchlist(client, people, db):
    from app.models import WatchlistEntry
    from app.services import privacy

    watch(client, people["admin"])
    assert privacy.export_by_plate(db, "ABC1234")["watchlist_entries"][0]["reason"] == "Reported stolen 30 Sep"

    privacy.erase_by_plate(db, "ABC1234")

    assert db.scalar(select(WatchlistEntry)).plate_number != "ABC1234"
