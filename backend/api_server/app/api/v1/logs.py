from datetime import datetime, timezone

import math

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.deps import require_any_user, require_guard
from app.database import get_db
from app.models import AccessLog, Role, User, Vehicle, normalize_plate
from app.schemas import AccessLogCreate, AccessLogPage, AccessLogPublic

router = APIRouter(tags=["access-logs"])


@router.get("/logs", response_model=AccessLogPage)
def list_logs(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_user),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, ge=1, le=500),
) -> AccessLogPage:
    """
    Access history, newest first. A plain user sees only entries for vehicles
    they own.
    """
    filters = []
    if current_user.role == Role.USER:
        owned = select(Vehicle.plate_number).where(Vehicle.owner_id == current_user.id)
        filters.append(AccessLog.plate_number.in_(owned))

    total = db.scalar(select(func.count()).select_from(AccessLog).where(*filters)) or 0

    logs = list(
        db.scalars(
            select(AccessLog)
            .where(*filters)
            .order_by(AccessLog.timestamp.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        ).all()
    )

    # Reading plate history is itself a privacy-relevant event.
    audit.record(
        db,
        action="access_log.list",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="access_log",
        details={"returned": len(logs), "scope": current_user.role.value},
    )
    db.commit()

    return AccessLogPage(
        logs=[AccessLogPublic.model_validate(entry) for entry in logs],
        total=total,
        page=page,
        total_pages=max(1, math.ceil(total / limit)),
    )


@router.post(
    "/access-logs", response_model=AccessLogPublic, status_code=status.HTTP_201_CREATED
)
def create_access_log(
    payload: AccessLogCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
) -> AccessLog:
    """
    Record a gate decision.

    The frontend queues these in IndexedDB while offline and replays them on
    reconnect, so `timestamp` may be older than the insertion time; both are
    stored.
    """
    normalized = normalize_plate(payload.plate_number)
    vehicle = db.scalar(select(Vehicle).where(Vehicle.plate_number == normalized))

    entry = AccessLog(
        plate_number=normalized,
        action=payload.action,
        timestamp=payload.timestamp or datetime.now(timezone.utc),
        user_id=current_user.id,
        vehicle_id=vehicle.id if vehicle else None,
        site_id=payload.site_id or (vehicle.site_id if vehicle else None),
        details=payload.details,
    )
    db.add(entry)
    db.flush()

    audit.record(
        db,
        action="access_log.created",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="access_log",
        resource_id=str(entry.id),
        details={"plate_number": normalized, "decision": payload.action.value},
    )
    db.commit()
    db.refresh(entry)
    return entry
