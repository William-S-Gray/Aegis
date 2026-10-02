import pytest
from sqlalchemy import select

from app.models import Alert, AuditLog, MismatchType, Role

PASSWORD = "correct-horse-battery"


@pytest.fixture
def auth(client, make_user):
    def _auth(role: Role = Role.GUARD, email: str | None = None):
        email = email or f"{role.value}@aegis.example"
        make_user(email=email, password=PASSWORD, role=role)
        token = client.post(
            "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
        ).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return _auth


def raise_alert(client, headers, **kwargs):
    return client.post("/api/v1/alerts", headers=headers, json=kwargs)


class TestConfidenceGating:
    def test_high_confidence_is_accepted_without_review(self, client, auth):
        headers = auth()
        body = raise_alert(
            client, headers, plate_number="SURE01", plate_confidence=0.95
        ).json()

        assert body["requires_review"] is False
        assert body["review_reason"] is None

    def test_middling_confidence_goes_to_review(self, client, auth):
        headers = auth()
        body = raise_alert(
            client, headers, plate_number="MAYBE1", plate_confidence=0.70
        ).json()

        assert body["requires_review"] is True
        assert body["review_reason"] == "low_plate_confidence"

    def test_confidence_below_the_floor_is_refused(self, client, auth):
        """Recording unreadable noise would bury real alerts."""
        headers = auth()
        response = raise_alert(
            client, headers, plate_number="NOISE1", plate_confidence=0.20
        )

        assert response.status_code == 422
        assert "review floor" in response.json()["detail"].lower()

    def test_refused_read_is_not_persisted(self, client, auth, db):
        headers = auth()
        raise_alert(client, headers, plate_number="NOISE2", plate_confidence=0.10)

        assert db.scalar(select(Alert).where(Alert.plate_number == "NOISE2")) is None

    def test_low_type_confidence_also_triggers_review(self, client, auth):
        headers = auth()
        body = raise_alert(
            client,
            headers,
            plate_number="TYPE01",
            plate_confidence=0.95,
            type_confidence=0.40,
        ).json()

        assert body["requires_review"] is True
        assert body["review_reason"] == "low_type_confidence"

    def test_a_small_plate_goes_to_review_however_confident(self, client, auth):
        """Measured on video: the reader drops a character from small plates
        (34VY880 for 34VY8802) at confidence 1.0, the same way every frame."""
        headers = auth()
        body = raise_alert(
            client, headers, plate_number="SMALL1", plate_confidence=1.0, plate_width_px=80
        ).json()

        assert body["requires_review"] is True
        assert body["review_reason"] == "small_plate"

    def test_a_plate_at_the_minimum_width_is_accepted(self, client, auth):
        headers = auth()
        body = raise_alert(
            client, headers, plate_number="WIDE01", plate_confidence=1.0, plate_width_px=120
        ).json()

        assert body["requires_review"] is False

    def test_a_read_outside_the_expected_formats_goes_to_review(self, client, auth, monkeypatch):
        """A dropped character breaks the format; the reader stays confident."""
        from app.api.v1 import alerts

        monkeypatch.setattr(alerts.settings, "plate_formats", "[A-Z]{3}[0-9]{4}")
        headers = auth()

        truncated = raise_alert(client, headers, plate_number="AAA532", plate_confidence=1.0).json()
        correct = raise_alert(client, headers, plate_number="AAA5329", plate_confidence=1.0).json()

        assert truncated["review_reason"] == "unexpected_format"
        assert correct["requires_review"] is False

    def test_an_invalid_format_pattern_is_refused_at_startup(self):
        from pydantic import ValidationError

        from app.config import Settings

        with pytest.raises(ValidationError, match="invalid pattern"):
            Settings(plate_formats="[A-Z")

    def test_manual_entry_never_requires_review(self, client, auth):
        """A guard typing a plate has already vouched for it."""
        headers = auth()
        body = raise_alert(client, headers, plate_number="MANUAL1").json()

        assert body["requires_review"] is False

    def test_detector_provenance_is_recorded(self, client, auth):
        headers = auth()
        body = raise_alert(
            client,
            headers,
            plate_number="PROV01",
            plate_confidence=0.95,
            detector_name="yolo",
            detector_version="plates-v3.pt",
        ).json()

        assert body["detector_name"] == "yolo"
        assert body["detector_version"] == "plates-v3.pt"


class TestReviewQueue:
    def test_queue_contains_only_unreviewed_low_confidence_reads(self, client, auth):
        headers = auth()
        raise_alert(client, headers, plate_number="SURE02", plate_confidence=0.95)
        raise_alert(client, headers, plate_number="MAYBE2", plate_confidence=0.70)

        queue = client.get("/api/v1/alerts/review-queue", headers=headers).json()

        assert [a["plate_number"] for a in queue] == ["MAYBE2"]

    def test_queue_requires_a_guard(self, client, auth):
        assert client.get("/api/v1/alerts/review-queue").status_code == 401
        user_headers = auth(Role.USER, email="plain@aegis.example")
        assert (
            client.get("/api/v1/alerts/review-queue", headers=user_headers).status_code
            == 403
        )

    def test_viewing_the_queue_is_audited(self, client, auth, db):
        headers = auth()
        client.get("/api/v1/alerts/review-queue", headers=headers)

        actions = set(db.scalars(select(AuditLog.action)).all())
        assert "alert.review_queue_viewed" in actions


class TestSuggestions:
    def register(self, client, auth, *plates):
        admin = auth(Role.ADMIN, email="admin@aegis.example")
        for plate in plates:
            client.post("/api/v1/vehicles", headers=admin, json={"plate_number": plate})

    def test_a_one_character_misread_suggests_the_registered_plate(self, client, auth):
        """B read as 8, or a character dropped: one click to correct, not retyping."""
        self.register(client, auth, "AB12CD", "ZZ99ZZ")
        guard = auth()
        raise_alert(client, guard, plate_number="A812CD", plate_confidence=0.70)
        raise_alert(client, guard, plate_number="AB12C", plate_confidence=0.70)

        queue = client.get("/api/v1/alerts/review-queue", headers=guard).json()

        assert [a["suggested_plates"] for a in queue] == [["AB12CD"], ["AB12CD"]]

    def test_no_suggestion_when_nothing_is_close(self, client, auth):
        self.register(client, auth, "AB12CD")
        guard = auth()
        raise_alert(client, guard, plate_number="QQ77QQ", plate_confidence=0.70)

        queue = client.get("/api/v1/alerts/review-queue", headers=guard).json()

        assert queue[0]["suggested_plates"] == []

    def test_a_deactivated_vehicle_is_not_suggested(self, client, auth, db):
        from app.models import Vehicle

        self.register(client, auth, "AB12CD")
        db.query(Vehicle).update({"is_active": False})
        db.commit()
        guard = auth()
        raise_alert(client, guard, plate_number="A812CD", plate_confidence=0.70)

        queue = client.get("/api/v1/alerts/review-queue", headers=guard).json()

        assert queue[0]["suggested_plates"] == []


class TestPlateConfirmation:
    def test_confirming_clears_the_review_flag(self, client, auth):
        headers = auth()
        alert = raise_alert(
            client, headers, plate_number="MAYBE3", plate_confidence=0.70
        ).json()

        confirmed = client.post(
            f"/api/v1/alerts/{alert['id']}/confirm-plate",
            headers=headers,
            json={"plate_number": "MAYBE3"},
        ).json()

        assert confirmed["requires_review"] is False
        assert confirmed["reviewed_at"] is not None
        assert confirmed["confirmed_plate"] == "MAYBE3"

    def test_correction_reclassifies_against_the_register(self, client, auth):
        """
        The whole point of review: a misread plate is exactly the case where
        the 'unregistered' verdict was wrong.
        """
        admin = auth(Role.ADMIN)
        client.post(
            "/api/v1/vehicles",
            headers=admin,
            json={"plate_number": "AB12CD", "color": "white"},
        )

        guard = auth(Role.GUARD)
        # OCR misreads B as 8.
        alert = raise_alert(
            client, guard, plate_number="A812CD", plate_confidence=0.70
        ).json()
        assert alert["mismatch_type"] == "unregistered"

        corrected = client.post(
            f"/api/v1/alerts/{alert['id']}/confirm-plate",
            headers=guard,
            json={"plate_number": "ab-12 cd"},
        ).json()

        assert corrected["plate_number"] == "AB12CD"
        assert corrected["mismatch_type"] == "none"
        assert corrected["registered_color"] == "white"

    def test_correction_is_audited_with_both_readings(self, client, auth, db):
        headers = auth()
        alert = raise_alert(
            client, headers, plate_number="A812CD", plate_confidence=0.70
        ).json()

        client.post(
            f"/api/v1/alerts/{alert['id']}/confirm-plate",
            headers=headers,
            json={"plate_number": "AB12CD"},
        )

        entry = db.scalar(
            select(AuditLog).where(AuditLog.action == "alert.plate_confirmed")
        )
        assert entry.details["machine_read"] == "A812CD"
        assert entry.details["confirmed"] == "AB12CD"
        assert entry.details["corrected"] is True

    def test_confirming_an_unchanged_plate_is_not_flagged_as_corrected(
        self, client, auth, db
    ):
        headers = auth()
        alert = raise_alert(
            client, headers, plate_number="SAME01", plate_confidence=0.70
        ).json()

        client.post(
            f"/api/v1/alerts/{alert['id']}/confirm-plate",
            headers=headers,
            json={"plate_number": "SAME01"},
        )

        entry = db.scalar(
            select(AuditLog).where(AuditLog.action == "alert.plate_confirmed")
        )
        assert entry.details["corrected"] is False

    def test_confirmed_alert_leaves_the_queue(self, client, auth):
        headers = auth()
        alert = raise_alert(
            client, headers, plate_number="MAYBE4", plate_confidence=0.70
        ).json()

        client.post(
            f"/api/v1/alerts/{alert['id']}/confirm-plate",
            headers=headers,
            json={"plate_number": "MAYBE4"},
        )

        queue = client.get("/api/v1/alerts/review-queue", headers=headers).json()
        assert queue == []

    def test_empty_plate_is_rejected(self, client, auth):
        headers = auth()
        alert = raise_alert(
            client, headers, plate_number="MAYBE5", plate_confidence=0.70
        ).json()

        response = client.post(
            f"/api/v1/alerts/{alert['id']}/confirm-plate",
            headers=headers,
            json={"plate_number": "---"},
        )
        assert response.status_code == 422

    def test_unknown_alert_is_404(self, client, auth):
        headers = auth()
        response = client.post(
            "/api/v1/alerts/00000000-0000-0000-0000-000000000000/confirm-plate",
            headers=headers,
            json={"plate_number": "AB12CD"},
        )
        assert response.status_code == 404
