from datetime import datetime, timedelta, timezone

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


def window(start_hours=-1, end_hours=4):
    now = datetime.now(timezone.utc)
    return {"valid_from": (now + timedelta(hours=start_hours)).isoformat(),
            "valid_until": (now + timedelta(hours=end_hours)).isoformat()}


def issue(client, headers, plate="ABC 1234", **extra):
    return client.post("/api/v1/visitor-passes", headers=headers,
                       json={"plate_number": plate, "visitor_name": "Tendai M.", **window(), **extra})


def camera_read(client, headers, plate="ABC1234"):
    return client.post("/api/v1/alerts", headers=headers, json={"plate_number": plate, "plate_confidence": 0.99}).json()


class TestPasses:
    def test_a_resident_hosts_their_own_visitor(self, client, auth, db):
        resident = auth(Role.USER, "resident@aegis.example")
        body = issue(client, resident).json()

        assert body["plate_number"] == "ABC1234"
        assert body["host_name"]
        assert db.scalar(select(AuditLog).where(AuditLog.action == "visitor_pass.created"))

    def test_a_resident_cannot_issue_for_someone_else(self, client, auth, make_user):
        other = make_user(email="other@aegis.example", password=PASSWORD, role=Role.USER)
        resident = auth(Role.USER, "resident@aegis.example")

        assert issue(client, resident, host_id=str(other.id)).status_code == 403

    def test_a_guard_can_issue_for_a_host(self, client, auth, make_user):
        host = make_user(email="host@aegis.example", password=PASSWORD, role=Role.USER)
        guard = auth(Role.GUARD, "guard@aegis.example")

        assert issue(client, guard, host_id=str(host.id)).json()["host_id"] == str(host.id)

    @pytest.mark.parametrize(
        ("start", "end", "reason"),
        [(2, 1, "after valid_from"), (-5, -1, "past"), (0, 24 * 31, "at most 30 days")],
    )
    def test_bad_windows_are_refused(self, client, auth, start, end, reason):
        resident = auth(Role.USER, "resident@aegis.example")
        response = issue(client, resident, **window(start, end))

        assert response.status_code == 422
        assert reason in response.text

    def test_residents_see_only_their_own_passes(self, client, auth):
        a = auth(Role.USER, "a@aegis.example")
        b = auth(Role.USER, "b@aegis.example")
        issue(client, a, plate="AAA1111")
        issue(client, b, plate="BBB2222")
        guard = auth(Role.GUARD, "guard@aegis.example")

        assert [p["plate_number"] for p in client.get("/api/v1/visitor-passes", headers=a).json()] == ["AAA1111"]
        assert len(client.get("/api/v1/visitor-passes", headers=guard).json()) == 2

    def test_another_hosts_pass_cannot_be_revoked(self, client, auth):
        a = auth(Role.USER, "a@aegis.example")
        b = auth(Role.USER, "b@aegis.example")
        pass_id = issue(client, a).json()["id"]

        assert client.post(f"/api/v1/visitor-passes/{pass_id}/revoke", headers=b).status_code == 404
        assert client.post(f"/api/v1/visitor-passes/{pass_id}/revoke", headers=a).json()["revoked_at"]


class TestAtTheGate:
    def test_a_valid_pass_makes_the_read_an_expected_visitor(self, client, auth):
        issue(client, auth(Role.USER, "resident@aegis.example"))
        camera = auth(Role.SERVICE, "camera@aegis.example")

        alert = camera_read(client, camera)

        assert alert["mismatch_type"] == "visitor"
        assert alert["visitor_pass"]["visitor_name"] == "Tendai M."

    @pytest.mark.parametrize("state", ["revoked", "not_started", "expired"])
    def test_a_pass_outside_its_window_does_not_count(self, client, auth, db, state):
        resident = auth(Role.USER, "resident@aegis.example")
        if state == "not_started":
            issue(client, resident, **window(2, 5))
        else:
            pass_id = issue(client, resident).json()["id"]
            if state == "revoked":
                client.post(f"/api/v1/visitor-passes/{pass_id}/revoke", headers=resident)
            else:
                from app.models import VisitorPass

                db.query(VisitorPass).update({"valid_until": datetime.now(timezone.utc) - timedelta(minutes=1)})
                db.commit()
        camera = auth(Role.SERVICE, "camera@aegis.example")

        alert = camera_read(client, camera)

        assert alert["mismatch_type"] == "unregistered"
        assert alert["visitor_pass"] is None

    def test_a_correction_to_the_visitors_plate_finds_the_pass(self, client, auth):
        """Misread at the gate, corrected by a guard: the pass still applies."""
        issue(client, auth(Role.USER, "resident@aegis.example"))
        camera = auth(Role.SERVICE, "camera@aegis.example")
        guard = auth(Role.GUARD, "guard@aegis.example")
        alert = client.post("/api/v1/alerts", headers=camera,
                            json={"plate_number": "A8C1234", "plate_confidence": 0.70}).json()

        corrected = client.post(f"/api/v1/alerts/{alert['id']}/confirm-plate", headers=guard,
                                json={"plate_number": "ABC1234"}).json()

        assert corrected["mismatch_type"] == "visitor"


class TestSubjectRights:
    def test_export_and_erasure_cover_visitor_passes(self, client, auth, db):
        from app.services import privacy

        issue(client, auth(Role.USER, "resident@aegis.example"), notes="Blue van, plumber")

        exported = privacy.export_by_plate(db, "ABC1234")
        assert exported["visitor_passes"][0]["visitor_name"] == "Tendai M."

        privacy.erase_by_plate(db, "ABC1234")

        from app.models import VisitorPass

        erased = db.scalar(select(VisitorPass))
        assert (erased.plate_number, erased.visitor_name, erased.notes) != ("ABC1234", "Tendai M.", "Blue van, plumber")
        assert erased.visitor_name == "erased" and erased.notes is None


def test_ended_passes_are_purged_after_retention(client, auth, db):
    from app.models import VisitorPass
    from app.services import retention

    issue(client, auth(Role.USER, "resident@aegis.example"))
    db.query(VisitorPass).update({"valid_until": datetime.now(timezone.utc) - timedelta(days=91)})
    db.commit()

    removed = retention.purge(db)

    assert removed.counts["visitor_passes"] == 1
    assert db.scalar(select(VisitorPass)) is None
