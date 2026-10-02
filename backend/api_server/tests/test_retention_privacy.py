from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models import (
    AccessAction,
    AccessLog,
    Alert,
    AlertComment,
    AuditLog,
    Role,
    Vehicle,
    normalize_plate,
)
from app.services import privacy, retention

PASSWORD = "correct-horse-battery"


def utc_days_ago(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


@pytest.fixture
def seeded(db, make_user):
    """A vehicle with alerts, access logs, and audit entries."""
    owner = make_user(email="owner@aegis.example", password=PASSWORD, role=Role.USER)

    vehicle = Vehicle(
        plate_number="AB12CD",
        plate_display="AB-12 CD",
        make="Toyota",
        color="white",
        owner_id=owner.id,
    )
    db.add(vehicle)

    db.add(Alert(plate_number="AB12CD", detected_color="white"))
    db.add(Alert(plate_number="ZZ99YY", detected_color="black"))
    db.add(
        AccessLog(
            plate_number="AB12CD",
            action=AccessAction.APPROVE,
            timestamp=datetime.now(timezone.utc),
            details={"plate": "AB12CD", "note": "gate opened"},
        )
    )
    db.add(
        AuditLog(
            action="vehicle.created",
            actor_email="admin@aegis.example",
            details={"plate_number": "AB12CD"},
        )
    )
    db.add(AuditLog(action="unrelated.event", details={"plate_number": "ZZ99YY"}))
    db.commit()
    return db


class TestRetentionPlan:
    def test_recent_data_is_not_scheduled_for_deletion(self, seeded):
        assert retention.plan(seeded).total == 0

    def test_old_rows_are_counted(self, seeded):
        seeded.add(
            AccessLog(
                plate_number="OLD001",
                action=AccessAction.ENTRY,
                timestamp=utc_days_ago(400),
                recorded_at=utc_days_ago(400),
            )
        )
        seeded.commit()

        assert retention.plan(seeded).counts["access_logs"] == 1

    def test_plan_changes_nothing(self, seeded):
        seeded.add(
            AccessLog(
                plate_number="OLD002",
                action=AccessAction.ENTRY,
                timestamp=utc_days_ago(400),
                recorded_at=utc_days_ago(400),
            )
        )
        seeded.commit()
        before = seeded.scalar(select(AccessLog).where(AccessLog.plate_number == "OLD002"))

        retention.plan(seeded)

        assert before is not None
        assert (
            seeded.scalar(select(AccessLog).where(AccessLog.plate_number == "OLD002"))
            is not None
        )


class TestPurge:
    def test_expired_rows_are_removed(self, seeded):
        seeded.add(
            AccessLog(
                plate_number="OLD003",
                action=AccessAction.ENTRY,
                timestamp=utc_days_ago(400),
                recorded_at=utc_days_ago(400),
            )
        )
        seeded.commit()

        removed = retention.purge(seeded)

        assert removed.counts["access_logs"] == 1
        assert (
            seeded.scalar(select(AccessLog).where(AccessLog.plate_number == "OLD003"))
            is None
        )

    def test_recent_rows_survive(self, seeded):
        retention.purge(seeded)

        assert (
            seeded.scalar(select(AccessLog).where(AccessLog.plate_number == "AB12CD"))
            is not None
        )

    def test_audit_logs_outlive_operational_data(self, seeded):
        """
        An access log from 400 days ago is expired; an audit entry of the same
        age is not. The audit trail is what you produce when challenged.
        """
        seeded.add(
            AccessLog(
                plate_number="OLD004",
                action=AccessAction.ENTRY,
                timestamp=utc_days_ago(400),
                recorded_at=utc_days_ago(400),
            )
        )
        old_audit = AuditLog(action="ancient.event")
        seeded.add(old_audit)
        seeded.flush()
        old_audit.created_at = utc_days_ago(400)
        seeded.commit()

        retention.purge(seeded)

        assert seeded.scalar(select(AuditLog).where(AuditLog.action == "ancient.event"))
        assert (
            seeded.scalar(select(AccessLog).where(AccessLog.plate_number == "OLD004"))
            is None
        )

    def test_purge_is_idempotent(self, seeded):
        seeded.add(
            AccessLog(
                plate_number="OLD005",
                action=AccessAction.ENTRY,
                timestamp=utc_days_ago(400),
                recorded_at=utc_days_ago(400),
            )
        )
        seeded.commit()

        first = retention.purge(seeded)
        second = retention.purge(seeded)

        assert first.counts["access_logs"] == 1
        assert second.counts["access_logs"] == 0

    def test_batching_removes_everything(self, seeded):
        for i in range(25):
            seeded.add(
                AccessLog(
                    plate_number=f"BULK{i:03d}",
                    action=AccessAction.ENTRY,
                    timestamp=utc_days_ago(400),
                    recorded_at=utc_days_ago(400),
                )
            )
        seeded.commit()

        removed = retention.purge(seeded, batch_size=10)

        assert removed.counts["access_logs"] == 25

    def test_a_purge_that_deletes_is_audited(self, seeded):
        seeded.add(
            AccessLog(
                plate_number="OLD006",
                action=AccessAction.ENTRY,
                timestamp=utc_days_ago(400),
                recorded_at=utc_days_ago(400),
            )
        )
        seeded.commit()

        retention.purge(seeded)

        assert seeded.scalar(select(AuditLog).where(AuditLog.action == "retention.purged"))

    def test_a_no_op_purge_writes_no_audit_noise(self, seeded):
        retention.purge(seeded)

        assert (
            seeded.scalar(select(AuditLog).where(AuditLog.action == "retention.purged"))
            is None
        )


class TestSubjectExport:
    def test_export_gathers_every_data_class(self, seeded):
        payload = privacy.export_by_plate(seeded, "ab-12 cd")

        assert payload["plate_number"] == "AB12CD"
        assert payload["vehicle"]["make"] == "Toyota"
        assert payload["counts"]["alerts"] == 1
        assert payload["counts"]["access_logs"] == 1
        assert payload["counts"]["audit_entries"] >= 1

    def test_export_excludes_other_subjects(self, seeded):
        payload = privacy.export_by_plate(seeded, "AB12CD")

        assert "ZZ99YY" not in str(payload)

    def test_export_accepts_any_plate_formatting(self, seeded):
        assert (
            privacy.export_by_plate(seeded, "ab 12 cd")["counts"]
            == privacy.export_by_plate(seeded, "AB12CD")["counts"]
        )

    def test_unknown_plate_returns_an_empty_report(self, seeded):
        payload = privacy.export_by_plate(seeded, "NOSUCH1")

        assert payload["vehicle"] is None
        assert payload["counts"] == {"alerts": 0, "access_logs": 0, "visitor_passes": 0, "watchlist_entries": 0, "visits": 0, "audit_entries": 0}


class TestErasure:
    def test_plate_is_gone_from_every_table(self, seeded):
        privacy.erase_by_plate(seeded, "AB12CD")

        assert seeded.scalar(select(Vehicle).where(Vehicle.plate_number == "AB12CD")) is None
        assert seeded.scalar(select(Alert).where(Alert.plate_number == "AB12CD")) is None
        assert (
            seeded.scalar(select(AccessLog).where(AccessLog.plate_number == "AB12CD"))
            is None
        )
        for entry in seeded.scalars(select(AuditLog)).all():
            assert "AB12CD" not in str(entry.details or {})

    def test_rows_are_anonymised_not_deleted(self, seeded):
        """Deleting them would punch holes in the audit trail."""
        alerts_before = len(seeded.scalars(select(Alert)).all())
        logs_before = len(seeded.scalars(select(AccessLog)).all())

        privacy.erase_by_plate(seeded, "AB12CD")

        assert len(seeded.scalars(select(Alert)).all()) == alerts_before
        assert len(seeded.scalars(select(AccessLog)).all()) == logs_before

    def test_erased_rows_carry_a_tombstone(self, seeded):
        record = privacy.erase_by_plate(seeded, "AB12CD")

        alert = seeded.scalar(
            select(Alert).where(Alert.plate_number == record["tombstone"])
        )
        assert alert is not None
        assert record["tombstone"].startswith(privacy.ERASURE_PREFIX)

    def test_other_subjects_are_untouched(self, seeded):
        privacy.erase_by_plate(seeded, "AB12CD")

        assert seeded.scalar(select(Alert).where(Alert.plate_number == "ZZ99YY"))

    def test_tombstones_are_not_reversible(self, seeded):
        """
        Plate numbers are low-entropy: a hash would be trivially reversed by
        enumerating the plate space, making the erasure cosmetic.
        """
        first = privacy.erase_by_plate(seeded, "AB12CD")["tombstone"]

        seeded.add(Alert(plate_number="AB12CD"))
        seeded.commit()
        second = privacy.erase_by_plate(seeded, "AB12CD")["tombstone"]

        assert first != second

    def test_the_erasure_is_audited_without_recording_the_plate(self, seeded):
        privacy.erase_by_plate(seeded, "AB12CD", reason="SAR-001")

        entry = seeded.scalar(
            select(AuditLog).where(AuditLog.action == "privacy.erasure")
        )
        assert entry.details["reason"] == "SAR-001"
        # Recording it here would recreate the data just removed.
        assert "AB12CD" not in str(entry.details)

    def test_detection_payloads_are_dropped(self, seeded):
        privacy.erase_by_plate(seeded, "AB12CD")

        for entry in seeded.scalars(select(AccessLog)).all():
            assert "AB12CD" not in str(entry.details or {})

    def test_ownership_link_is_severed(self, seeded):
        record = privacy.erase_by_plate(seeded, "AB12CD")

        vehicle = seeded.scalar(
            select(Vehicle).where(Vehicle.plate_number == record["tombstone"])
        )
        assert vehicle.owner_id is None
        assert vehicle.is_active is False

    def test_erasing_an_unknown_plate_is_harmless(self, seeded):
        record = privacy.erase_by_plate(seeded, "NOSUCH1")

        assert record["counts"] == {
            "vehicles": 0,
            "alerts": 0,
            "access_logs": 0,
            "audit_entries": 0,
            "comments": 0,
            "visitor_passes": 0,
            "watchlist_entries": 0,
            "visits": 0,
        }


class TestAuditQueryIsFilteredInSql:
    """
    Regression guard for a defect in the first version: both privacy functions
    loaded every audit row into Python and filtered there. audit_logs records
    every read of plate data and grows fastest of all the tables, so on a busy
    site that turned a subject access request into an out-of-memory crash.
    """

    def test_query_carries_a_where_clause(self):
        from app.services.privacy import _audit_matching

        sql = str(_audit_matching("AB12CD", []))

        assert "WHERE" in sql
        assert "audit_logs.details" in sql

    def test_alert_ids_are_matched_in_sql_too(self):
        from app.services.privacy import _audit_matching

        sql = str(_audit_matching("AB12CD", ["11111111-1111-1111-1111-111111111111"]))

        assert "resource_id IN" in sql.replace("\n", " ")

    def test_export_does_not_load_unrelated_audit_rows(self, seeded):
        """A thousand unrelated entries must not appear in one subject's export."""
        for i in range(200):
            seeded.add(AuditLog(action="noise.event", details={"plate_number": f"NOISE{i}"}))
        seeded.commit()

        payload = privacy.export_by_plate(seeded, "AB12CD")

        assert payload["counts"]["audit_entries"] <= 5
        assert "NOISE" not in str(payload["audit_entries"])

    def test_erasure_still_finds_every_mention(self, seeded):
        for i in range(50):
            seeded.add(AuditLog(action="noise.event", details={"plate_number": f"NOISE{i}"}))
        seeded.add(AuditLog(action="extra.event", details={"note": "saw AB12CD at gate"}))
        seeded.commit()

        privacy.erase_by_plate(seeded, "AB12CD")

        for entry in seeded.scalars(select(AuditLog)).all():
            assert "AB12CD" not in str(entry.details or {})


class TestNormalisationAgreement:
    @pytest.mark.parametrize("raw", ["ab-12 cd", "AB12CD", " Ab 12 Cd "])
    def test_export_and_erase_agree_on_plate_form(self, raw):
        """A mismatch here would erase a different vehicle than the one shown."""
        assert normalize_plate(raw) == "AB12CD"


class TestErasureBoundaries:
    """Erasure matched by substring: erasing one plate rewrote others that
    contained it, and an input normalising to "" rewrote the whole audit log."""

    def test_a_shorter_plate_does_not_bite_into_a_longer_one(self, seeded):
        privacy.erase_by_plate(seeded, "AB12")

        other = seeded.scalar(select(AuditLog).where(AuditLog.action == "vehicle.created"))
        assert other.details == {"plate_number": "AB12CD"}

    def test_an_empty_plate_is_refused_before_anything_changes(self, seeded):
        before = [entry.details for entry in seeded.scalars(select(AuditLog)).all()]

        with pytest.raises(ValueError):
            privacy.erase_by_plate(seeded, "- -")
        with pytest.raises(ValueError):
            privacy.export_by_plate(seeded, "---")

        assert [entry.details for entry in seeded.scalars(select(AuditLog)).all()] == before

    def test_comments_on_the_subjects_alerts_are_scrubbed(self, seeded):
        alert = seeded.scalar(select(Alert).where(Alert.plate_number == "AB12CD"))
        seeded.add(AlertComment(alert_id=alert.id, body="Driver of ab-12 cd was rude"))
        seeded.commit()

        record = privacy.erase_by_plate(seeded, "AB12CD")

        comment = seeded.scalar(select(AlertComment))
        assert comment.body == f"Driver of {record['tombstone']} was rude"
        assert record["counts"]["comments"] == 1

    def test_the_plate_image_is_erased(self, seeded):
        alert = seeded.scalar(select(Alert).where(Alert.plate_number == "AB12CD"))
        alert.plate_crop = b"\xff\xd8\xffimage"
        seeded.commit()

        privacy.erase_by_plate(seeded, "AB12CD")

        seeded.expire_all()
        assert seeded.get(Alert, alert.id).plate_crop is None


class TestPlateImageRetention:
    def test_old_images_are_cleared_and_the_alert_kept(self, seeded):
        old = Alert(plate_number="OLD001", created_at=utc_days_ago(60), plate_crop=b"x")
        recent = Alert(plate_number="NEW001", plate_crop=b"y")
        seeded.add_all([old, recent])
        seeded.commit()

        assert retention.plan(seeded).counts["plate_images"] == 1
        retention.purge(seeded)

        seeded.expire_all()
        assert seeded.get(Alert, old.id).plate_crop is None
        assert seeded.get(Alert, recent.id).plate_crop == b"y"


class TestRetentionUsesServerTime:
    def test_a_future_dated_decision_is_still_purged(self, seeded):
        seeded.add(
            AccessLog(
                plate_number="FUTURE1",
                action=AccessAction.ENTRY,
                timestamp=datetime.now(timezone.utc) + timedelta(days=3650),
                recorded_at=utc_days_ago(400),
            )
        )
        seeded.commit()

        retention.purge(seeded)

        assert seeded.scalar(select(AccessLog).where(AccessLog.plate_number == "FUTURE1")) is None
