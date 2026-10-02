import statistics
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.deps import require_admin, require_guard
from app.database import get_db
from app.models import User, Visit
from app.schemas import VisitPublic

router = APIRouter(prefix="/visits", tags=["visits"])


class VisitHistory(BaseModel):
    visits: list[VisitPublic]
    total: int
    # Over visits with both an entry and an exit in the period.
    median_minutes: float | None


@router.get("/on-site", response_model=list[VisitPublic])
def on_site(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
) -> list[Visit]:
    """Vehicles that entered and have not left, longest on site first."""
    visits = list(
        db.scalars(
            select(Visit)
            .where(Visit.entered_at.is_not(None), Visit.exited_at.is_(None))
            .order_by(Visit.entered_at)
        ).unique()
    )
    audit.record(
        db,
        action="visit.on_site_viewed",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="visit",
        details={"returned": len(visits)},
    )
    db.commit()
    return visits


@router.get("", response_model=VisitHistory)
def history(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
    days: int = Query(default=7, ge=1, le=90),
    limit: int = Query(default=500, ge=1, le=2000),
) -> VisitHistory:
    """Recent visits with how long each lasted, newest first."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    visits = list(
        db.scalars(
            select(Visit).where(Visit.created_at >= since).order_by(Visit.created_at.desc()).limit(limit)
        ).unique()
    )
    durations = [
        (v.exited_at - v.entered_at).total_seconds() / 60 for v in visits if v.entered_at and v.exited_at
    ]
    audit.record(
        db,
        action="visit.history_viewed",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="visit",
        details={"returned": len(visits), "days": days},
    )
    db.commit()
    return VisitHistory(
        visits=[VisitPublic.model_validate(v) for v in visits],
        total=len(visits),
        median_minutes=round(statistics.median(durations), 1) if durations else None,
    )
