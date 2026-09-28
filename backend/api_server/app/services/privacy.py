from __future__ import annotations

import logging
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Text, cast, or_, select
from sqlalchemy.orm import Session

from app.models import (
    AccessLog,
    Alert,
    AlertComment,
    AuditLog,
    User,
    Vehicle,
    normalize_plate,
)

logger = logging.getLogger("aegis.privacy")

# Prefix that marks a value as erased, so an operator reading the database can
# tell "no data" from "data removed on request".
ERASURE_PREFIX = "ERASED-"


def _tombstone() -> str:
    """
    An opaque replacement for an erased plate.

    Deliberately random rather than a hash of the plate. Plate numbers are
    low-entropy — an attacker who obtained hashed plates could enumerate the
    whole plate space and reverse them, which would make the "erasure" cosmetic.
    A random token per erasure keeps rows groupable within one request while
    being irreversible.
    """
    return f"{ERASURE_PREFIX}{secrets.token_hex(8).upper()}"


def _subject(plate: str) -> str:
    """
    The normalised plate, refusing one that normalises to nothing.

    An empty needle matches everything: every audit row would be "about" the
    subject, and scrubbing "" would splice the tombstone between every
    character of every string in the table.
    """
    normalized = normalize_plate(plate)
    if not normalized:
        raise ValueError(f"{plate!r} contains no letters or digits; refusing to act on it")
    return normalized


def _plate_pattern(normalized: str) -> re.Pattern[str]:
    """
    The plate as a whole token, however it was typed ("ab12 cd", "AB-12-CD").

    Bounded by non-alphanumerics on both sides, so erasing "AB12" never bites
    into another subject's "AB12CD".
    """
    body = r"[\s-]*".join(re.escape(ch) for ch in normalized)
    return re.compile(rf"(?<![A-Za-z0-9]){body}(?![A-Za-z0-9])", re.IGNORECASE)


def _mentions(value: Any, pattern: re.Pattern[str]) -> bool:
    if isinstance(value, str):
        return pattern.search(value) is not None
    if isinstance(value, dict):
        return any(_mentions(v, pattern) for v in value.values())
    if isinstance(value, list):
        return any(_mentions(v, pattern) for v in value)
    return False


def _audit_matching(plate: str, alert_ids: list[str]):
    """
    Audit rows that mention a plate, filtered in SQL.

    The plate lives inside a free-form JSON payload whose shape varies by
    action, so this cannot be a simple column comparison. What it must not be
    is a full load into Python: audit_logs records every read of plate data and
    is the fastest-growing table here, so materialising it would turn a subject
    access request into an out-of-memory crash on a busy site.

    A `%value%` match cannot use a btree index. If subject requests become
    frequent, add a trigram index:

        CREATE EXTENSION IF NOT EXISTS pg_trgm;
        CREATE INDEX ix_audit_logs_details_trgm
            ON audit_logs USING gin ((details::text) gin_trgm_ops);
    """
    conditions = [cast(AuditLog.details, Text).like(f"%{plate}%")]
    if alert_ids:
        conditions.append(AuditLog.resource_id.in_(alert_ids))

    return select(AuditLog).where(or_(*conditions)).order_by(AuditLog.created_at)


def export_by_plate(db: Session, plate: str) -> dict[str, Any]:
    """
    Everything held about one vehicle, for a subject access request.

    Audit entries are included: a data subject is entitled to know who looked
    at their data, not merely that it was recorded.
    """
    normalized = _subject(plate)
    pattern = _plate_pattern(normalized)

    vehicle = db.scalar(select(Vehicle).where(Vehicle.plate_number == normalized))
    alerts = list(db.scalars(select(Alert).where(Alert.plate_number == normalized)).all())
    logs = list(
        db.scalars(select(AccessLog).where(AccessLog.plate_number == normalized)).all()
    )

    alert_ids = [str(a.id) for a in alerts]
    # SQL narrows by substring; the token match then drops rows that only
    # contain the plate inside a longer one (another subject's data).
    audit_rows = [
        entry
        for entry in db.scalars(_audit_matching(normalized, alert_ids))
        if entry.resource_id in alert_ids or _mentions(entry.details, pattern)
    ]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "plate_number": normalized,
        "vehicle": _serialize_vehicle(vehicle) if vehicle else None,
        "alerts": [_serialize_alert(a) for a in alerts],
        "access_logs": [_serialize_access_log(entry) for entry in logs],
        "audit_entries": [_serialize_audit(entry) for entry in audit_rows],
        "counts": {
            "alerts": len(alerts),
            "access_logs": len(logs),
            "audit_entries": len(audit_rows),
        },
    }


def erase_by_plate(
    db: Session,
    plate: str,
    actor: User | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    """
    Honour a right-to-erasure request for one vehicle.

    Rows are **anonymised, not deleted**. Deleting them would punch holes in the
    audit trail — the record that a decision was made at a gate at a given time
    is itself a legal artefact, and destroying it to satisfy erasure trades one
    compliance failure for another. The identifying value is replaced; the
    event survives.
    """
    normalized = _subject(plate)
    pattern = _plate_pattern(normalized)
    tombstone = _tombstone()
    now = datetime.now(timezone.utc)

    counts = {
        "vehicles": 0,
        "alerts": 0,
        "access_logs": 0,
        "audit_entries": 0,
        "comments": 0,
    }

    vehicle = db.scalar(select(Vehicle).where(Vehicle.plate_number == normalized))
    if vehicle is not None:
        vehicle.plate_number = tombstone
        vehicle.plate_display = tombstone
        vehicle.owner_id = None
        vehicle.is_active = False
        counts["vehicles"] = 1

    alert_ids = []
    for alert in db.scalars(select(Alert).where(Alert.plate_number == normalized)).all():
        alert.plate_number = tombstone
        if alert.confirmed_plate:
            alert.confirmed_plate = tombstone
        # The image is the plate. Keeping it would make the erasure cosmetic.
        alert.plate_crop = None
        alert_ids.append(alert.id)
        counts["alerts"] += 1

    # Operators write the plate into comments on its alerts.
    if alert_ids:
        for comment in db.scalars(
            select(AlertComment).where(AlertComment.alert_id.in_(alert_ids))
        ).all():
            scrubbed = pattern.sub(tombstone, comment.body)
            if scrubbed != comment.body:
                comment.body = scrubbed
                counts["comments"] += 1

    for entry in db.scalars(
        select(AccessLog).where(AccessLog.plate_number == normalized)
    ).all():
        entry.plate_number = tombstone
        # The detection payload embeds the plate and is free-form; drop it
        # rather than attempt to scrub an unknown shape.
        entry.details = {"erased": True}
        counts["access_logs"] += 1

    # Streamed rather than materialised: this table is audited on every read and
    # is the fastest-growing one in the schema.
    for entry in db.scalars(_audit_matching(normalized, []).execution_options(yield_per=500)):
        if isinstance(entry.details, dict) and _mentions(entry.details, pattern):
            entry.details = _scrub(entry.details, pattern, tombstone)
            counts["audit_entries"] += 1

    record = {
        "erased_at": now.isoformat(),
        "tombstone": tombstone,
        "counts": counts,
        "reason": reason,
    }

    # The erasure itself is auditable, and deliberately does NOT record the
    # plate — writing it here would recreate the data just removed.
    db.add(
        AuditLog(
            actor_id=actor.id if actor else None,
            actor_email=actor.email if actor else None,
            action="privacy.erasure",
            resource_type="plate",
            resource_id=tombstone,
            details=record,
        )
    )
    db.commit()

    logger.info("Erasure completed", extra={"tombstone": tombstone, **counts})
    return record


def _scrub(value: Any, pattern: re.Pattern[str], replacement: str) -> Any:
    """Replace the plate wherever it appears as a token in a nested payload."""
    if isinstance(value, str):
        return pattern.sub(replacement, value)
    if isinstance(value, dict):
        return {key: _scrub(item, pattern, replacement) for key, item in value.items()}
    if isinstance(value, list):
        return [_scrub(item, pattern, replacement) for item in value]
    return value


def _serialize_vehicle(vehicle: Vehicle) -> dict[str, Any]:
    return {
        "id": str(vehicle.id),
        "plate_number": vehicle.plate_number,
        "plate_display": vehicle.plate_display,
        "make": vehicle.make,
        "model": vehicle.model,
        "color": vehicle.color,
        "vehicle_type": vehicle.vehicle_type,
        "owner_id": str(vehicle.owner_id) if vehicle.owner_id else None,
        "created_at": vehicle.created_at.isoformat() if vehicle.created_at else None,
    }


def _serialize_alert(alert: Alert) -> dict[str, Any]:
    return {
        "id": str(alert.id),
        "plate_number": alert.plate_number,
        "detected_type": alert.detected_type,
        "detected_color": alert.detected_color,
        "plate_confidence": alert.plate_confidence,
        "mismatch_type": alert.mismatch_type.value,
        "status": alert.status.value,
        "feedback_status": alert.feedback_status.value,
        "created_at": alert.created_at.isoformat() if alert.created_at else None,
    }


def _serialize_access_log(entry: AccessLog) -> dict[str, Any]:
    return {
        "id": str(entry.id),
        "plate_number": entry.plate_number,
        "action": entry.action.value,
        "timestamp": entry.timestamp.isoformat() if entry.timestamp else None,
        "site_id": str(entry.site_id) if entry.site_id else None,
    }


def _serialize_audit(entry: AuditLog) -> dict[str, Any]:
    return {
        "id": str(entry.id),
        "action": entry.action,
        "actor_email": entry.actor_email,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "details": entry.details,
    }


def resolve_plate_or_uuid(value: str) -> str | uuid.UUID:
    try:
        return uuid.UUID(value)
    except (TypeError, ValueError):
        return normalize_plate(value)
