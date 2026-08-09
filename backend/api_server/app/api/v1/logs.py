from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.deps import get_current_user, require_guard
from app.database import get_db
from app.models import AccessLog, Role, User, Vehicle, normalize_plate
from app.schemas import AccessLogCreate, AccessLogPublic

router = APIRouter(tags=["access-logs"])


@router.get("/logs", response_model=list[AccessLogPublic])
def list_logs(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = Query(default=200, ge=1, le=1000),
) -> list[AccessLog]:
    """
    Access history. A plain user sees only entries for vehicles they own.
    """
    query = select(AccessLog).order_by(AccessLog.timestamp.desc()).limit(limit)

    if current_user.role == Role.USER:
        owned = select(Vehicle.plate_number).where(Vehicle.owner_id == current_user.id)
        query = query.where(AccessLog.plate_number.in_(owned))

    logs = list(db.scalars(query).all())

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
    return logs


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
