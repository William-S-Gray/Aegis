import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.deps import require_any_user
from app.database import get_db
from app.models import Role, User, VisitorPass, normalize_plate
from app.schemas import VisitorPassCreate, VisitorPassPublic

router = APIRouter(prefix="/visitor-passes", tags=["visitor-passes"])


def _staff(user: User) -> bool:
    return user.role in (Role.ADMIN, Role.GUARD)


@router.post("", response_model=VisitorPassPublic, status_code=status.HTTP_201_CREATED)
def create_pass(
    payload: VisitorPassCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_user),
) -> VisitorPass:
    """
    Expect a visitor's plate for a time window. A resident always hosts their
    own passes; guards and administrators may issue them for any host.
    """
    host_id = current_user.id
    if payload.host_id and payload.host_id != current_user.id:
        if not _staff(current_user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only host your own visitors")
        if db.get(User, payload.host_id) is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown host_id")
        host_id = payload.host_id

    visitor_pass = VisitorPass(
        plate_number=normalize_plate(payload.plate_number),
        plate_display=payload.plate_number.strip(),
        visitor_name=payload.visitor_name.strip(),
        notes=payload.notes,
        valid_from=payload.valid_from,
        valid_until=payload.valid_until,
        host_id=host_id,
        created_by=current_user.id,
    )
    db.add(visitor_pass)
    db.flush()
    audit.record(
        db,
        action="visitor_pass.created",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="visitor_pass",
        resource_id=str(visitor_pass.id),
        details={"plate_number": visitor_pass.plate_number, "valid_until": payload.valid_until.isoformat()},
    )
    db.commit()
    db.refresh(visitor_pass)
    return visitor_pass


@router.get("", response_model=list[VisitorPassPublic])
def list_passes(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_user),
    include_expired: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[VisitorPass]:
    """Current and upcoming passes; a resident sees only the ones they host."""
    query = select(VisitorPass)
    if not _staff(current_user):
        query = query.where(VisitorPass.host_id == current_user.id)
    if not include_expired:
        query = query.where(
            VisitorPass.valid_until > datetime.now(timezone.utc), VisitorPass.revoked_at.is_(None)
        )
    passes = list(db.scalars(query.order_by(VisitorPass.valid_from).limit(limit)).unique())
    audit.record(
        db,
        action="visitor_pass.list",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="visitor_pass",
        details={"returned": len(passes)},
    )
    db.commit()
    return passes


@router.post("/{pass_id}/revoke", response_model=VisitorPassPublic)
def revoke_pass(
    pass_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_user),
) -> VisitorPass:
    visitor_pass = db.get(VisitorPass, pass_id)
    # A resident cannot tell another host's pass from a missing one.
    if visitor_pass is None or (not _staff(current_user) and visitor_pass.host_id != current_user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visitor pass not found")
    if visitor_pass.revoked_at is None:
        visitor_pass.revoked_at = datetime.now(timezone.utc)
        audit.record(
            db,
            action="visitor_pass.revoked",
            request=request,
            actor_id=current_user.id,
            actor_email=current_user.email,
            resource_type="visitor_pass",
            resource_id=str(visitor_pass.id),
        )
        db.commit()
        db.refresh(visitor_pass)
    return visitor_pass
