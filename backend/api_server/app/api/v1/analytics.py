import uuid
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.deps import require_admin
from app.database import get_db
from app.models import Alert, AlertStatus, FeedbackStatus, MismatchType, User
from app.schemas import (
    CommonMismatch,
    ConfidenceSummary,
    EscalationSummary,
    FeedbackSummary,
    MismatchPoint,
    ResolutionSummary,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _apply_window(
    query: Select,
    date_from: date | None,
    date_to: date | None,
    site_id: uuid.UUID | None,
) -> Select:
    """Apply the shared from/to/site filters used by every analytics endpoint."""
    if date_from:
        query = query.where(
            Alert.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        )
    if date_to:
        # Inclusive of the whole end day.
        query = query.where(
            Alert.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        )
    if site_id:
        query = query.where(Alert.site_id == site_id)
    return query


class Window:
    """Shared query parameters, declared once."""

    def __init__(
        self,
        date_from: date | None = Query(default=None, alias="from"),
        date_to: date | None = Query(default=None, alias="to"),
        site_id: uuid.UUID | None = Query(default=None),
    ):
        self.date_from = date_from
        self.date_to = date_to
        self.site_id = site_id

    def apply(self, query: Select) -> Select:
        return _apply_window(query, self.date_from, self.date_to, self.site_id)


@router.get("/mismatches", response_model=list[MismatchPoint])
def mismatches_over_time(
    window: Window = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[MismatchPoint]:
    day = func.date(Alert.created_at)
    query = window.apply(
        select(day.label("day"), func.count().label("count"))
        .where(Alert.mismatch_type != MismatchType.NONE)
        .group_by(day)
        .order_by(day)
    )
    return [
        MismatchPoint(date=str(row.day), count=row.count) for row in db.execute(query).all()
    ]


@router.get("/common-mismatches", response_model=list[CommonMismatch])
def common_mismatches(
    window: Window = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> list[CommonMismatch]:
    query = window.apply(
        select(Alert.mismatch_type, func.count().label("count"))
        .where(Alert.mismatch_type != MismatchType.NONE)
        .group_by(Alert.mismatch_type)
        .order_by(func.count().desc())
    )
    return [
        CommonMismatch(
            type=row.mismatch_type.value
            if hasattr(row.mismatch_type, "value")
            else str(row.mismatch_type),
            count=row.count,
        )
        for row in db.execute(query).all()
    ]


@router.get("/average-confidence", response_model=ConfidenceSummary)
def average_confidence(
    window: Window = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ConfidenceSummary:
    query = window.apply(
        select(func.avg(Alert.plate_confidence), func.avg(Alert.type_confidence))
    )
    plate_avg, type_avg = db.execute(query).one()
    return ConfidenceSummary(
        average_plate_confidence=round(float(plate_avg), 4) if plate_avg is not None else 0.0,
        average_type_confidence=round(float(type_avg), 4) if type_avg is not None else 0.0,
    )


@router.get("/feedback-stats", response_model=FeedbackSummary)
def feedback_stats(
    window: Window = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> FeedbackSummary:
    query = window.apply(
        select(Alert.feedback_status, func.count()).group_by(Alert.feedback_status)
    )
    counts = {status_value: count for status_value, count in db.execute(query).all()}
    return FeedbackSummary(
        false_alarms=counts.get(FeedbackStatus.FALSE_ALARM, 0),
        investigated=counts.get(FeedbackStatus.INVESTIGATED, 0),
        escalated=counts.get(FeedbackStatus.ESCALATED, 0),
        pending=counts.get(FeedbackStatus.PENDING, 0),
    )


@router.get("/time-to-resolution", response_model=ResolutionSummary)
def time_to_resolution(
    window: Window = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ResolutionSummary:
    """
    Mean minutes from alert creation to closure.

    Computed in Python over resolved rows: the SQL for a portable timestamp
    difference diverges between PostgreSQL and SQLite, and the resolved set is
    small enough that clarity beats a dialect-specific expression. Revisit with
    a dialect-aware aggregate if this table grows large.
    """
    query = window.apply(
        select(Alert.created_at, Alert.resolved_at)
        .where(Alert.resolved_at.is_not(None))
        .where(Alert.status == AlertStatus.CLOSED)
    )

    durations = []
    for created_at, resolved_at in db.execute(query).all():
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        if resolved_at.tzinfo is None:
            resolved_at = resolved_at.replace(tzinfo=timezone.utc)
        durations.append((resolved_at - created_at).total_seconds() / 60)

    average = sum(durations) / len(durations) if durations else 0.0
    return ResolutionSummary(average_time_to_resolution_minutes=round(average, 2))


@router.get("/escalation-rate", response_model=EscalationSummary)
def escalation_rate(
    window: Window = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> EscalationSummary:
    total = db.scalar(window.apply(select(func.count()).select_from(Alert))) or 0
    if total == 0:
        return EscalationSummary(escalation_rate_percent=0.0)

    escalated = (
        db.scalar(
            window.apply(
                select(func.count())
                .select_from(Alert)
                .where(Alert.feedback_status == FeedbackStatus.ESCALATED)
            )
        )
        or 0
    )
    return EscalationSummary(escalation_rate_percent=round(escalated / total * 100, 2))
