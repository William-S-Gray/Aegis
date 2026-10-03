from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models import (
    AccessLog,
    Alert,
    AlertStatus,
    AuditLog,
    FeedbackStatus,
    MismatchType,
    Role,
    User,
    Vehicle,
)

PASSWORD = "correct-horse-battery"


@pytest.fixture
def auth(client, make_user):
    """Returns a helper that signs a role in and yields its Authorization header."""

    def _auth(role: Role = Role.ADMIN, email: str | None = None):
        email = email or f"{role.value}@aegis.example"
        make_user(email=email, password=PASSWORD, role=role)
        token = client.post(
            "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
        ).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return _auth


class TestAuthorization:
    """Every endpoint must enforce roles server-side, not just in the UI."""

    def test_endpoints_reject_anonymous_callers(self, client):
        for method, path in [
            ("get", "/api/v1/users"),
            ("get", "/api/v1/vehicles"),
            ("get", "/api/v1/logs"),
            ("get", "/api/v1/alerts"),
            ("get", "/api/v1/sites"),
            ("get", "/api/v1/attribute-mismatch-rules"),
            ("get", "/api/v1/analytics/mismatches"),
        ]:
            response = getattr(client, method)(path)
            assert response.status_code == 401, f"{path} allowed an anonymous caller"

    def test_plain_user_cannot_read_the_roster(self, client, auth):
        headers = auth(Role.USER)
        assert client.get("/api/v1/users", headers=headers).status_code == 403

    def test_plain_user_cannot_reach_analytics(self, client, auth):
        headers = auth(Role.USER)
        for path in [
            "/api/v1/analytics/mismatches",
            "/api/v1/analytics/feedback-stats",
            "/api/v1/analytics/escalation-rate",
        ]:
            assert client.get(path, headers=headers).status_code == 403

    def test_guard_cannot_create_users(self, client, auth):
        headers = auth(Role.GUARD)
        response = client.post(
            "/api/v1/users",
            headers=headers,
            json={
                "email": "new@aegis.example",
                "full_name": "New",
                "password": "a-long-enough-password",
                "role": "guard",
            },
        )
        assert response.status_code == 403

    def test_guard_cannot_manage_rules(self, client, auth):
        headers = auth(Role.GUARD)
        assert (
            client.get("/api/v1/attribute-mismatch-rules", headers=headers).status_code == 403
        )


class TestServiceAccountConfinement:
    """
    The vision service runs on a camera host — the most physically reachable
    and least trusted machine in a deployment. Its account may publish
    detections and nothing else, so compromising that host does not yield a
    guard's access to the register or the ability to record a gate decision.
    """

    def _service_headers(self, client, make_user):
        make_user(email="vision@aegis.example", password=PASSWORD, role=Role.SERVICE)
        token = client.post(
            "/api/v1/auth/login",
            json={"email": "vision@aegis.example", "password": PASSWORD},
        ).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    def test_service_account_can_publish_a_detection(self, client, make_user):
        headers = self._service_headers(client, make_user)

        response = client.post(
            "/api/v1/alerts",
            headers=headers,
            json={"plate_number": "SVC001", "plate_confidence": 0.95},
        )
        assert response.status_code == 201

    def test_service_account_cannot_read_the_vehicle_register(self, client, make_user):
        headers = self._service_headers(client, make_user)
        assert client.get("/api/v1/vehicles", headers=headers).status_code == 403

    def test_service_account_cannot_read_the_user_roster(self, client, make_user):
        headers = self._service_headers(client, make_user)
        assert client.get("/api/v1/users", headers=headers).status_code == 403

    def test_service_account_cannot_record_an_access_decision(self, client, make_user):
        """A camera must never be able to say a vehicle was let through."""
        headers = self._service_headers(client, make_user)

        response = client.post(
            "/api/v1/access-logs",
            headers=headers,
            json={"plate_number": "SVC001", "action": "approve"},
        )
        assert response.status_code == 403

    def test_service_account_cannot_list_or_review_alerts(self, client, make_user):
        headers = self._service_headers(client, make_user)

        assert client.get("/api/v1/alerts", headers=headers).status_code == 403
        assert client.get("/api/v1/alerts/review-queue", headers=headers).status_code == 403

    def test_service_account_cannot_open_the_alert_stream(self, client, make_user):
        headers = self._service_headers(client, make_user)
        assert client.post("/api/v1/auth/ws-ticket", headers=headers).status_code == 403

    def test_service_account_cannot_reach_analytics_or_rules(self, client, make_user):
        headers = self._service_headers(client, make_user)

        assert (
            client.get("/api/v1/analytics/mismatches", headers=headers).status_code == 403
        )
        assert (
            client.get("/api/v1/attribute-mismatch-rules", headers=headers).status_code == 403
        )


class TestUsers:
    def test_admin_can_create_and_list(self, client, auth):
        headers = auth(Role.ADMIN)
        created = client.post(
            "/api/v1/users",
            headers=headers,
            json={
                "email": "newguard@aegis.example",
                "full_name": "New Guard",
                "password": "a-long-enough-password",
                "role": "guard",
            },
        )
        assert created.status_code == 201
        assert "hashed_password" not in created.json()

        listed = client.get("/api/v1/users", headers=headers).json()
        assert any(u["email"] == "newguard@aegis.example" for u in listed)

    def test_duplicate_email_conflicts(self, client, auth):
        headers = auth(Role.ADMIN)
        body = {
            "email": "dupe@aegis.example",
            "full_name": "Dupe",
            "password": "a-long-enough-password",
            "role": "user",
        }
        assert client.post("/api/v1/users", headers=headers, json=body).status_code == 201
        assert client.post("/api/v1/users", headers=headers, json=body).status_code == 409

    def test_short_password_is_rejected(self, client, auth):
        headers = auth(Role.ADMIN)
        response = client.post(
            "/api/v1/users",
            headers=headers,
            json={
                "email": "weak@aegis.example",
                "full_name": "Weak",
                "password": "short",
                "role": "user",
            },
        )
        assert response.status_code == 422

    def test_admin_cannot_deactivate_themselves(self, client, auth, db):
        headers = auth(Role.ADMIN, email="boss@aegis.example")
        me = client.get("/api/v1/auth/me", headers=headers).json()

        response = client.delete(f"/api/v1/users/{me['id']}", headers=headers)
        assert response.status_code == 400

    def test_admin_cannot_demote_themselves(self, client, auth):
        headers = auth(Role.ADMIN, email="boss@aegis.example")
        me = client.get("/api/v1/auth/me", headers=headers).json()

        response = client.patch(
            f"/api/v1/users/{me['id']}", headers=headers, json={"role": "user"}
        )
        assert response.status_code == 400

    def test_deactivation_ends_the_session(self, client, auth, make_user):
        admin = auth(Role.ADMIN)
        victim = make_user(email="victim@aegis.example", password=PASSWORD, role=Role.GUARD)
        victim_headers = {
            "Authorization": "Bearer "
            + client.post(
                "/api/v1/auth/login",
                json={"email": "victim@aegis.example", "password": PASSWORD},
            ).json()["access_token"]
        }

        assert client.get("/api/v1/auth/me", headers=victim_headers).status_code == 200
        assert client.delete(f"/api/v1/users/{victim.id}", headers=admin).status_code == 200
        assert client.get("/api/v1/auth/me", headers=victim_headers).status_code == 401

    def test_admin_resets_a_password_and_old_sessions_end(self, client, auth, make_user, db):
        admin = auth(Role.ADMIN)
        guard = make_user(email="forgetful@aegis.example", password=PASSWORD, role=Role.GUARD)
        old = client.post("/api/v1/auth/login", json={"email": "forgetful@aegis.example", "password": PASSWORD}).json()

        new_password = "a-brand-new-passphrase"
        assert client.post(f"/api/v1/users/{guard.id}/password", headers=admin, json={"password": new_password}).status_code == 204

        login = lambda pw: client.post("/api/v1/auth/login", json={"email": "forgetful@aegis.example", "password": pw})
        assert login(PASSWORD).status_code == 401
        assert login(new_password).status_code == 200
        # A device that was signed in cannot quietly carry on.
        assert client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]}).status_code == 401
        entry = db.scalar(select(AuditLog).where(AuditLog.action == "user.password_reset"))
        assert new_password not in str(entry.details)

    def test_password_reset_needs_an_admin_and_a_strong_password(self, client, auth, make_user):
        guard_headers = auth(Role.GUARD)
        target = make_user(email="target@aegis.example", password=PASSWORD, role=Role.GUARD)
        url = f"/api/v1/users/{target.id}/password"
        assert client.post(url, headers=guard_headers, json={"password": "a-brand-new-passphrase"}).status_code == 403
        assert client.post(url, headers=auth(Role.ADMIN), json={"password": "short"}).status_code == 422

    def test_permanent_delete_removes_the_account_and_keeps_the_audit_trail(self, client, auth, make_user, db):
        admin = auth(Role.ADMIN)
        victim = make_user(email="leaver@aegis.example", password=PASSWORD, role=Role.GUARD)
        victim_id = victim.id

        assert client.delete(f"/api/v1/users/{victim_id}?permanent=true", headers=admin).status_code == 200

        db.expire_all()
        assert db.get(User, victim_id) is None
        assert client.post("/api/v1/auth/login", json={"email": "leaver@aegis.example", "password": PASSWORD}).status_code == 401
        entry = db.scalar(select(AuditLog).where(AuditLog.action == "user.deleted"))
        assert entry.details["email"] == "leaver@aegis.example"

    def test_a_deleted_guards_decisions_are_kept_without_the_name(self, client, auth, make_user, db):
        admin = auth(Role.ADMIN)
        guard = make_user(email="leaver@aegis.example", password=PASSWORD, role=Role.GUARD)
        token = client.post("/api/v1/auth/login", json={"email": "leaver@aegis.example", "password": PASSWORD}).json()
        recorded = client.post("/api/v1/access-logs", headers={"Authorization": f"Bearer {token['access_token']}"},
                               json={"plate_number": "AB12CDE", "action": "approve"})
        assert recorded.status_code == 201

        assert client.delete(f"/api/v1/users/{guard.id}?permanent=true", headers=admin).status_code == 200

        db.expire_all()
        decision = db.scalar(select(AccessLog).where(AccessLog.plate_number == "AB12CDE"))
        assert decision is not None and decision.action.value == "approve"

    def test_admin_cannot_permanently_delete_themselves(self, client, auth):
        headers = auth(Role.ADMIN, email="boss@aegis.example")
        me = client.get("/api/v1/auth/me", headers=headers).json()
        assert client.delete(f"/api/v1/users/{me['id']}?permanent=true", headers=headers).status_code == 400


class TestVehicles:
    def _create(self, client, headers, plate="AB-12 CD", **kwargs):
        return client.post(
            "/api/v1/vehicles",
            headers=headers,
            json={"plate_number": plate, **kwargs},
        )

    def test_plate_is_normalized(self, client, auth):
        headers = auth(Role.ADMIN)
        created = self._create(client, headers, plate="ab-12 cd").json()

        assert created["plate_number"] == "AB12CD"
        assert created["plate_display"] == "ab-12 cd"

    def test_same_plate_in_a_different_format_conflicts(self, client, auth):
        headers = auth(Role.ADMIN)
        assert self._create(client, headers, plate="AB12CD").status_code == 201
        # Would be a duplicate registration without normalisation.
        assert self._create(client, headers, plate="ab-12 cd").status_code == 409

    def test_plate_without_alphanumerics_is_rejected(self, client, auth):
        headers = auth(Role.ADMIN)
        assert self._create(client, headers, plate="---").status_code == 422

    def test_user_sees_only_their_own_vehicles(self, client, auth, make_user, db):
        admin = auth(Role.ADMIN)
        owner = make_user(email="owner@aegis.example", password=PASSWORD, role=Role.USER)

        self._create(client, admin, plate="MINE1", owner_id=str(owner.id))
        self._create(client, admin, plate="THEIRS1")

        owner_headers = {
            "Authorization": "Bearer "
            + client.post(
                "/api/v1/auth/login",
                json={"email": "owner@aegis.example", "password": PASSWORD},
            ).json()["access_token"]
        }

        visible = client.get("/api/v1/vehicles", headers=owner_headers).json()
        assert [v["plate_number"] for v in visible["vehicles"]] == ["MINE1"]
        assert visible["total"] == 1

    def test_guard_sees_every_vehicle(self, client, auth):
        admin = auth(Role.ADMIN)
        self._create(client, admin, plate="AAA111")
        self._create(client, admin, plate="BBB222")

        guard = auth(Role.GUARD)
        visible = client.get("/api/v1/vehicles", headers=guard).json()
        assert visible["total"] == 2

    def test_reading_vehicles_is_audited(self, client, auth, db):
        headers = auth(Role.ADMIN)
        client.get("/api/v1/vehicles", headers=headers)

        actions = set(db.scalars(select(AuditLog.action)).all())
        assert "vehicle.list" in actions


class TestVehiclePagination:
    """
    The unpaginated endpoint returned every row — a megabyte of JSON at 5 000
    vehicles, measured. No operator reads that and every browser must parse it.
    """

    def _create_many(self, client, headers, count):
        for i in range(count):
            client.post(
                "/api/v1/vehicles", headers=headers, json={"plate_number": f"PG{i:04d}"}
            )

    def test_page_size_is_bounded(self, client, auth):
        headers = auth(Role.ADMIN)
        self._create_many(client, headers, 12)

        page = client.get("/api/v1/vehicles?limit=5", headers=headers).json()

        assert len(page["vehicles"]) == 5
        assert page["total"] == 12
        assert page["total_pages"] == 3

    def test_second_page_returns_different_rows(self, client, auth):
        headers = auth(Role.ADMIN)
        self._create_many(client, headers, 12)

        first = client.get("/api/v1/vehicles?page=1&limit=5", headers=headers).json()
        second = client.get("/api/v1/vehicles?page=2&limit=5", headers=headers).json()

        assert {v["id"] for v in first["vehicles"]}.isdisjoint(
            {v["id"] for v in second["vehicles"]}
        )

    def test_limit_is_capped(self, client, auth):
        """An unbounded limit re-creates the problem pagination solves."""
        headers = auth(Role.ADMIN)
        assert client.get("/api/v1/vehicles?limit=9999", headers=headers).status_code == 422

    def test_search_narrows_by_plate(self, client, auth):
        headers = auth(Role.ADMIN)
        client.post("/api/v1/vehicles", headers=headers, json={"plate_number": "FINDME1"})
        self._create_many(client, headers, 5)

        page = client.get("/api/v1/vehicles?search=findme", headers=headers).json()

        assert page["total"] == 1
        assert page["vehicles"][0]["plate_number"] == "FINDME1"

    def test_search_normalises_the_needle(self, client, auth):
        headers = auth(Role.ADMIN)
        client.post("/api/v1/vehicles", headers=headers, json={"plate_number": "AB12CD"})

        page = client.get("/api/v1/vehicles?search=ab-12", headers=headers).json()
        assert page["total"] == 1

    def test_search_respects_role_scoping(self, client, auth, make_user):
        """Search must not become a way around the per-user scope."""
        admin = auth(Role.ADMIN)
        owner = make_user(email="scoped@aegis.example", password=PASSWORD, role=Role.USER)
        client.post(
            "/api/v1/vehicles",
            headers=admin,
            json={"plate_number": "MINE99", "owner_id": str(owner.id)},
        )
        client.post("/api/v1/vehicles", headers=admin, json={"plate_number": "THEIRS99"})

        token = client.post(
            "/api/v1/auth/login",
            json={"email": "scoped@aegis.example", "password": PASSWORD},
        ).json()["access_token"]

        page = client.get(
            "/api/v1/vehicles?search=99", headers={"Authorization": f"Bearer {token}"}
        ).json()

        assert page["total"] == 1
        assert page["vehicles"][0]["plate_number"] == "MINE99"


class TestAccessLogPagination:
    def test_logs_are_paginated(self, client, auth):
        headers = auth(Role.GUARD)
        for i in range(8):
            client.post(
                "/api/v1/access-logs",
                headers=headers,
                json={"plate_number": f"LOG{i:03d}", "action": "entry"},
            )

        page = client.get("/api/v1/logs?limit=3", headers=headers).json()

        assert len(page["logs"]) == 3
        assert page["total"] == 8
        assert page["total_pages"] == 3

    def test_logs_are_newest_first(self, client, auth):
        headers = auth(Role.GUARD)
        for i in range(3):
            client.post(
                "/api/v1/access-logs",
                headers=headers,
                json={"plate_number": f"ORD{i:03d}", "action": "entry"},
            )

        logs = client.get("/api/v1/logs", headers=headers).json()["logs"]
        timestamps = [entry["timestamp"] for entry in logs]
        assert timestamps == sorted(timestamps, reverse=True)


class TestAccessLogs:
    def test_guard_can_record_a_decision(self, client, auth, db):
        headers = auth(Role.GUARD)
        response = client.post(
            "/api/v1/access-logs",
            headers=headers,
            json={"plate_number": "xy-99 zz", "action": "approve"},
        )

        assert response.status_code == 201
        assert response.json()["plate_number"] == "XY99ZZ"
        assert db.scalar(select(AccessLog)) is not None

    def test_offline_timestamp_is_preserved(self, client, auth, db):
        headers = auth(Role.GUARD)
        earlier = datetime.now(timezone.utc) - timedelta(hours=6)

        client.post(
            "/api/v1/access-logs",
            headers=headers,
            json={
                "plate_number": "QUEUED1",
                "action": "deny",
                "timestamp": earlier.isoformat(),
            },
        )

        entry = db.scalar(select(AccessLog))
        stored = entry.timestamp
        if stored.tzinfo is None:
            stored = stored.replace(tzinfo=timezone.utc)
        # The queued decision keeps its original time, not the upload time.
        assert abs((stored - earlier).total_seconds()) < 2

    def test_log_links_to_a_known_vehicle(self, client, auth, db):
        admin = auth(Role.ADMIN)
        client.post(
            "/api/v1/vehicles", headers=admin, json={"plate_number": "LINK99"}
        )

        guard = auth(Role.GUARD)
        client.post(
            "/api/v1/access-logs",
            headers=guard,
            json={"plate_number": "link-99", "action": "entry"},
        )

        entry = db.scalar(select(AccessLog))
        vehicle = db.scalar(select(Vehicle))
        assert entry.vehicle_id == vehicle.id

    def test_plain_user_cannot_record_a_decision(self, client, auth):
        headers = auth(Role.USER)
        response = client.post(
            "/api/v1/access-logs",
            headers=headers,
            json={"plate_number": "NOPE1", "action": "approve"},
        )
        assert response.status_code == 403


class TestAlerts:
    def test_unregistered_plate_is_flagged(self, client, auth, db):
        headers = auth(Role.GUARD)
        client.post(
            "/api/v1/alerts",
            headers=headers,
            json={"plate_number": "GHOST1", "detected_type": "sedan"},
        )

        alert = db.scalar(select(Alert))
        assert alert.mismatch_type == MismatchType.UNREGISTERED

    def test_matching_vehicle_produces_no_mismatch(self, client, auth, db):
        admin = auth(Role.ADMIN)
        client.post(
            "/api/v1/vehicles",
            headers=admin,
            json={"plate_number": "MATCH1", "vehicle_type": "sedan", "color": "blue"},
        )

        guard = auth(Role.GUARD)
        client.post(
            "/api/v1/alerts",
            headers=guard,
            json={
                "plate_number": "MATCH1",
                "detected_type": "sedan",
                "detected_color": "blue",
            },
        )

        alert = db.scalar(select(Alert))
        assert alert.mismatch_type == MismatchType.NONE

    @pytest.mark.parametrize(
        ("registered", "detected", "expected"),
        [
            # A general-purpose detector reports coarse classes; they are
            # compared against the registered type's family.
            ("suv", "car", MismatchType.NONE),
            ("hatchback", "car", MismatchType.NONE),
            ("sedan", "truck", MismatchType.TYPE),  # a car's plate on a truck
            ("sedan", "motorcycle", MismatchType.TYPE),
            ("bus", "car", MismatchType.TYPE),
            # Detectors split vans and pickups between car and truck.
            ("van", "car", MismatchType.NONE),
            ("van", "truck", MismatchType.NONE),
            ("pickup", "truck", MismatchType.NONE),
            # A detector reporting fine types is still compared exactly.
            ("van", "sedan", MismatchType.TYPE),
        ],
    )
    def test_type_is_compared_by_family_for_coarse_detections(
        self, client, auth, db, registered, detected, expected
    ):
        admin = auth(Role.ADMIN)
        client.post(
            "/api/v1/vehicles",
            headers=admin,
            json={"plate_number": "FAM1", "vehicle_type": registered},
        )

        guard = auth(Role.GUARD)
        client.post(
            "/api/v1/alerts",
            headers=guard,
            json={"plate_number": "FAM1", "detected_type": detected},
        )

        assert db.scalar(select(Alert)).mismatch_type == expected

    def test_colour_mismatch_is_detected(self, client, auth, db):
        admin = auth(Role.ADMIN)
        client.post(
            "/api/v1/vehicles",
            headers=admin,
            json={"plate_number": "COLOR1", "vehicle_type": "sedan", "color": "blue"},
        )

        guard = auth(Role.GUARD)
        client.post(
            "/api/v1/alerts",
            headers=guard,
            json={
                "plate_number": "COLOR1",
                "detected_type": "sedan",
                "detected_color": "red",
            },
        )

        alert = db.scalar(select(Alert))
        assert alert.mismatch_type == MismatchType.COLOR

    def test_an_allow_rule_suppresses_the_mismatch(self, client, auth, db):
        admin = auth(Role.ADMIN)
        client.post(
            "/api/v1/vehicles",
            headers=admin,
            json={"plate_number": "GREY1", "color": "grey"},
        )
        # Declare silver and grey equivalent.
        client.post(
            "/api/v1/attribute-mismatch-rules",
            headers=admin,
            json={"attribute": "color", "allowed_pair": ["silver", "grey"]},
        )

        guard = auth(Role.GUARD)
        client.post(
            "/api/v1/alerts",
            headers=guard,
            json={"plate_number": "GREY1", "detected_color": "Silver"},
        )

        alert = db.scalar(select(Alert))
        assert alert.mismatch_type == MismatchType.NONE

    def test_registered_attributes_are_snapshotted(self, client, auth, db):
        """Editing a vehicle later must not rewrite why an alert fired."""
        admin = auth(Role.ADMIN)
        vehicle = client.post(
            "/api/v1/vehicles",
            headers=admin,
            json={"plate_number": "SNAP1", "color": "blue"},
        ).json()

        guard = auth(Role.GUARD)
        client.post(
            "/api/v1/alerts",
            headers=guard,
            json={"plate_number": "SNAP1", "detected_color": "red"},
        )

        client.patch(
            f"/api/v1/vehicles/{vehicle['id']}", headers=admin, json={"color": "red"}
        )

        alert = db.scalar(select(Alert))
        assert alert.registered_color == "blue"

    def test_listing_is_paginated(self, client, auth):
        guard = auth(Role.GUARD)
        for i in range(25):
            client.post(
                "/api/v1/alerts", headers=guard, json={"plate_number": f"PLATE{i:03d}"}
            )

        page = client.get("/api/v1/alerts?page=1&limit=20", headers=guard).json()
        assert len(page["alerts"]) == 20
        assert page["total"] == 25
        assert page["total_pages"] == 2

    def test_assign_moves_an_open_alert_into_progress(self, client, auth, make_user):
        guard = auth(Role.GUARD)
        assignee = make_user(email="who@aegis.example", password=PASSWORD, role=Role.GUARD)
        alert = client.post(
            "/api/v1/alerts", headers=guard, json={"plate_number": "ASSIGN1"}
        ).json()

        updated = client.post(
            f"/api/v1/alerts/{alert['id']}/assign",
            headers=guard,
            json={"user_id": str(assignee.id)},
        ).json()

        assert updated["assigned_to"] == str(assignee.id)
        assert updated["status"] == "in_progress"

    def test_assigning_an_unknown_user_is_rejected(self, client, auth):
        guard = auth(Role.GUARD)
        alert = client.post(
            "/api/v1/alerts", headers=guard, json={"plate_number": "ASSIGN2"}
        ).json()

        response = client.post(
            f"/api/v1/alerts/{alert['id']}/assign",
            headers=guard,
            json={"user_id": "00000000-0000-0000-0000-000000000000"},
        )
        assert response.status_code == 422

    def test_closing_stamps_resolution_time_once(self, client, auth, db):
        guard = auth(Role.GUARD)
        alert = client.post(
            "/api/v1/alerts", headers=guard, json={"plate_number": "CLOSE1"}
        ).json()

        client.post(
            f"/api/v1/alerts/{alert['id']}/status",
            headers=guard,
            json={"status": "closed", "feedback_status": "investigated"},
        )
        first = db.scalar(select(Alert.resolved_at))

        # Reopening then closing again must not reset the original stamp.
        client.post(
            f"/api/v1/alerts/{alert['id']}/status", headers=guard, json={"status": "open"}
        )
        client.post(
            f"/api/v1/alerts/{alert['id']}/status", headers=guard, json={"status": "closed"}
        )

        assert first is not None

    def test_comments_accumulate_with_authors(self, client, auth):
        guard = auth(Role.GUARD, email="commenter@aegis.example")
        alert = client.post(
            "/api/v1/alerts", headers=guard, json={"plate_number": "TALK1"}
        ).json()

        client.post(
            f"/api/v1/alerts/{alert['id']}/comment",
            headers=guard,
            json={"comment": "Checked the gate"},
        )
        updated = client.post(
            f"/api/v1/alerts/{alert['id']}/comment",
            headers=guard,
            json={"comment": "All clear"},
        ).json()

        assert [c["body"] for c in updated["comments"]] == ["Checked the gate", "All clear"]
        assert updated["comments"][0]["author_email"] == "commenter@aegis.example"

    def test_empty_comment_is_rejected(self, client, auth):
        guard = auth(Role.GUARD)
        alert = client.post(
            "/api/v1/alerts", headers=guard, json={"plate_number": "TALK2"}
        ).json()

        response = client.post(
            f"/api/v1/alerts/{alert['id']}/comment", headers=guard, json={"comment": ""}
        )
        assert response.status_code == 422


class TestRules:
    def test_pair_order_does_not_create_duplicates(self, client, auth):
        headers = auth(Role.ADMIN)
        first = client.post(
            "/api/v1/attribute-mismatch-rules",
            headers=headers,
            json={"attribute": "color", "allowed_pair": ["silver", "grey"]},
        )
        second = client.post(
            "/api/v1/attribute-mismatch-rules",
            headers=headers,
            json={"attribute": "color", "allowed_pair": ["grey", "silver"]},
        )

        assert first.status_code == 201
        assert second.status_code == 409

    def test_identical_values_are_rejected(self, client, auth):
        headers = auth(Role.ADMIN)
        response = client.post(
            "/api/v1/attribute-mismatch-rules",
            headers=headers,
            json={"attribute": "color", "allowed_pair": ["grey", "grey"]},
        )
        assert response.status_code == 422

    def test_unknown_attribute_is_rejected(self, client, auth):
        headers = auth(Role.ADMIN)
        response = client.post(
            "/api/v1/attribute-mismatch-rules",
            headers=headers,
            json={"attribute": "wheels", "allowed_pair": ["4", "6"]},
        )
        assert response.status_code == 422

    def test_delete_removes_the_rule(self, client, auth):
        headers = auth(Role.ADMIN)
        rule = client.post(
            "/api/v1/attribute-mismatch-rules",
            headers=headers,
            json={"attribute": "type", "allowed_pair": ["suv", "crossover"]},
        ).json()

        assert (
            client.delete(
                f"/api/v1/attribute-mismatch-rules/{rule['id']}", headers=headers
            ).status_code
            == 204
        )
        assert client.get("/api/v1/attribute-mismatch-rules", headers=headers).json() == []


class TestAnalytics:
    @pytest.fixture
    def seeded(self, client, auth):
        guard = auth(Role.GUARD)
        admin = auth(Role.ADMIN)

        for i in range(4):
            client.post(
                "/api/v1/alerts",
                headers=guard,
                json={
                    "plate_number": f"AN{i:03d}",
                    "detected_type": "sedan",
                    "plate_confidence": 0.9,
                    "type_confidence": 0.8,
                },
            )

        alerts = client.get("/api/v1/alerts", headers=guard).json()["alerts"]
        client.post(
            f"/api/v1/alerts/{alerts[0]['id']}/status",
            headers=guard,
            json={"status": "closed", "feedback_status": "escalated"},
        )
        client.post(
            f"/api/v1/alerts/{alerts[1]['id']}/status",
            headers=guard,
            json={"status": "closed", "feedback_status": "false_alarm"},
        )
        return admin

    def test_confidence_averages(self, client, seeded):
        body = client.get("/api/v1/analytics/average-confidence", headers=seeded).json()
        assert body["average_plate_confidence"] == pytest.approx(0.9, abs=0.01)
        assert body["average_type_confidence"] == pytest.approx(0.8, abs=0.01)

    def test_feedback_breakdown(self, client, seeded):
        body = client.get("/api/v1/analytics/feedback-stats", headers=seeded).json()
        assert body["escalated"] == 1
        assert body["false_alarms"] == 1
        assert body["pending"] == 2

    def test_escalation_rate(self, client, seeded):
        body = client.get("/api/v1/analytics/escalation-rate", headers=seeded).json()
        assert body["escalation_rate_percent"] == pytest.approx(25.0, abs=0.01)

    def test_mismatches_series_has_one_point_per_day(self, client, seeded):
        body = client.get("/api/v1/analytics/mismatches", headers=seeded).json()
        assert len(body) == 1
        assert body[0]["count"] == 4

    def test_common_mismatches_groups_by_reason(self, client, seeded):
        body = client.get("/api/v1/analytics/common-mismatches", headers=seeded).json()
        assert body == [{"type": "unregistered", "count": 4}]

    def test_time_to_resolution_covers_only_closed_alerts(self, client, seeded):
        body = client.get("/api/v1/analytics/time-to-resolution", headers=seeded).json()
        assert body["average_time_to_resolution_minutes"] >= 0

    def test_time_to_resolution_is_the_mean_of_closed_alerts(self, client, seeded, db):
        created = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
        alerts = db.scalars(select(Alert).order_by(Alert.status)).all()
        closed = [a for a in alerts if a.status == AlertStatus.CLOSED]
        still_open = next(a for a in alerts if a.status != AlertStatus.CLOSED)
        for alert, minutes in zip(closed, (10, 30)):
            alert.created_at = created
            alert.resolved_at = created + timedelta(minutes=minutes)
        # A stamp left on an open (reopened) alert must not count.
        still_open.created_at = created
        still_open.resolved_at = created + timedelta(minutes=500)
        db.commit()

        body = client.get("/api/v1/analytics/time-to-resolution", headers=seeded).json()
        assert body["average_time_to_resolution_minutes"] == 20.0

    def test_endpoints_are_safe_when_there_is_no_data(self, client, auth):
        headers = auth(Role.ADMIN)
        assert client.get("/api/v1/analytics/mismatches", headers=headers).json() == []
        assert (
            client.get("/api/v1/analytics/average-confidence", headers=headers).json()
            == {"average_plate_confidence": 0.0, "average_type_confidence": 0.0}
        )
        assert (
            client.get("/api/v1/analytics/escalation-rate", headers=headers).json()[
                "escalation_rate_percent"
            ]
            == 0.0
        )
        assert (
            client.get("/api/v1/analytics/time-to-resolution", headers=headers).json()[
                "average_time_to_resolution_minutes"
            ]
            == 0.0
        )

    def test_date_window_excludes_older_alerts(self, client, seeded):
        future = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
        body = client.get(
            f"/api/v1/analytics/mismatches?from={future}", headers=seeded
        ).json()
        assert body == []
