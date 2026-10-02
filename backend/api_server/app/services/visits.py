"""Pair entry and exit reads into visits."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert, Visit


def _open_visit(db: Session, plate: str) -> Visit | None:
    return db.scalar(
        select(Visit)
        .where(Visit.plate_number == plate, Visit.exited_at.is_(None))
        .order_by(Visit.entered_at.desc())
        .limit(1)
    )


def record(db: Session, alert: Alert) -> None:
    """
    Open a visit on an entry read, close the latest open one on an exit read.

    A second entry read while the vehicle is already on site changes nothing:
    it is the same arrival, or an exit the cameras missed, and guessing which
    would be worse than keeping the first entry. An exit with nothing open is
    kept with no entry time, so the vehicle's leaving is still on record.
    """
    if alert.direction not in ("entry", "exit"):
        return
    now = alert.created_at
    current = _open_visit(db, alert.plate_number)
    if alert.direction == "entry":
        if current is None:
            db.add(
                Visit(
                    plate_number=alert.plate_number,
                    entered_at=now,
                    entry_alert_id=alert.id,
                    vehicle_id=alert.vehicle_id,
                    visitor_pass_id=alert.visitor_pass_id,
                    site_id=alert.site_id,
                )
            )
        return
    if current is not None:
        current.exited_at = now
        current.exit_alert_id = alert.id
    else:
        db.add(
            Visit(
                plate_number=alert.plate_number,
                exited_at=now,
                exit_alert_id=alert.id,
                vehicle_id=alert.vehicle_id,
                visitor_pass_id=alert.visitor_pass_id,
                site_id=alert.site_id,
            )
        )


def cancel_denied_entry(db: Session, alert_id: uuid.UUID) -> bool:
    """A guard turned the vehicle away at the entry: it never came in."""
    visit = db.scalar(select(Visit).where(Visit.entry_alert_id == alert_id, Visit.exited_at.is_(None)))
    if visit is None:
        return False
    db.delete(visit)
    return True
