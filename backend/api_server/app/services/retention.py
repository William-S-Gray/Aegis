from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AccessLog, Alert, AuditLog, RefreshToken, Visit, VisitorPass, WatchlistEntry

logger = logging.getLogger("aegis.retention")
settings = get_settings()

# Rows are removed in chunks so a purge of a large backlog does not hold one
# long transaction open and block writes on a live gate.
DEFAULT_BATCH_SIZE = 1000


@dataclass
class PurgePlan:
    """What a purge would remove, per data class."""

    counts: dict[str, int] = field(default_factory=dict)
    cutoffs: dict[str, datetime] = field(default_factory=dict)

    @property
    def total(self) -> int:
        return sum(self.counts.values())

    def as_dict(self) -> dict[str, object]:
        return {
            "total": self.total,
            "counts": dict(self.counts),
            "cutoffs": {k: v.isoformat() for k, v in self.cutoffs.items()},
        }


CROP_LABEL = "plate_images"


def _cutoff(days: int, now: datetime) -> datetime:
    return now - timedelta(days=days)


def _crop_expired(cutoff: datetime) -> tuple:
    return (Alert.created_at < cutoff, Alert.plate_crop.is_not(None))


def _policies(now: datetime) -> list[tuple[str, type, object, datetime]]:
    """
    (label, model, timestamp column, cutoff) for each class.

    Ordered least-to-most sensitive to delete: refresh tokens are disposable,
    audit logs are the compliance record and are kept longest.
    """
    return [
        (
            "refresh_tokens",
            RefreshToken,
            RefreshToken.expires_at,
            _cutoff(settings.retention_refresh_token_days, now),
        ),
        (
            "visitor_passes",
            VisitorPass,
            VisitorPass.valid_until,
            _cutoff(settings.retention_visitor_pass_days, now),
        ),
        (
            # Active entries have no removed_at, so they never match.
            "watchlist_entries",
            WatchlistEntry,
            WatchlistEntry.removed_at,
            _cutoff(settings.retention_watchlist_days, now),
        ),
        ("visits", Visit, Visit.created_at, _cutoff(settings.retention_visit_days, now)),
        (
            "access_logs",
            AccessLog,
            # Server time, never the client-supplied decision timestamp: a
            # future-dated row must not outlive its retention period.
            AccessLog.recorded_at,
            _cutoff(settings.retention_access_log_days, now),
        ),
        ("alerts", Alert, Alert.created_at, _cutoff(settings.retention_alert_days, now)),
        (
            "audit_logs",
            AuditLog,
            AuditLog.created_at,
            _cutoff(settings.retention_audit_log_days, now),
        ),
    ]


def plan(db: Session, now: datetime | None = None) -> PurgePlan:
    """Count what is past its retention period, changing nothing."""
    now = now or datetime.now(timezone.utc)
    result = PurgePlan()

    for label, model, column, cutoff in _policies(now):
        count = db.scalar(select(func.count()).select_from(model).where(column < cutoff)) or 0
        result.counts[label] = count
        result.cutoffs[label] = cutoff

    crop_cutoff = _cutoff(settings.retention_crop_days, now)
    result.counts[CROP_LABEL] = (
        db.scalar(select(func.count()).select_from(Alert).where(*_crop_expired(crop_cutoff))) or 0
    )
    result.cutoffs[CROP_LABEL] = crop_cutoff

    return result


def purge(
    db: Session,
    now: datetime | None = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> PurgePlan:
    """
    Delete everything past its retention period.

    Idempotent: running it twice removes nothing the second time. Each class is
    committed separately so a failure part-way through does not roll back work
    already done.
    """
    now = now or datetime.now(timezone.utc)
    removed = PurgePlan()

    for label, model, column, cutoff in _policies(now):
        removed.cutoffs[label] = cutoff
        deleted_total = 0

        while True:
            # Select a batch of ids, then delete by id: a bare DELETE with a
            # LIMIT is not portable across PostgreSQL and SQLite.
            ids = list(
                db.scalars(select(model.id).where(column < cutoff).limit(batch_size)).all()
            )
            if not ids:
                break

            db.execute(delete(model).where(model.id.in_(ids)))
            db.commit()
            deleted_total += len(ids)

            if len(ids) < batch_size:
                break

        removed.counts[label] = deleted_total
        if deleted_total:
            logger.info(
                "Purged expired rows",
                extra={
                    "data_class": label,
                    "deleted": deleted_total,
                    "cutoff": cutoff.isoformat(),
                },
            )

    # Plate images are cleared, not deleted with the alert: the alert outlives
    # its evidence.
    crop_cutoff = _cutoff(settings.retention_crop_days, now)
    cleared = db.execute(
        update(Alert).where(*_crop_expired(crop_cutoff)).values(plate_crop=None)
    ).rowcount or 0
    db.commit()
    removed.counts[CROP_LABEL] = cleared
    removed.cutoffs[CROP_LABEL] = crop_cutoff

    if removed.total:
        # The purge is itself an auditable event. Written after the deletions
        # so it survives its own cutoff.
        db.add(
            AuditLog(
                action="retention.purged",
                resource_type="retention",
                details=removed.as_dict(),
            )
        )
        db.commit()

    return removed
