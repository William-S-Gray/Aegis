import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.deps import require_admin, require_guard
from app.database import get_db
from app.models import User, WatchlistEntry, normalize_plate
from app.schemas import WatchlistCreate, WatchlistPublic

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


@router.get("", response_model=list[WatchlistPublic])
def list_watchlist(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
) -> list[WatchlistEntry]:
    """Plates currently flagged on sight. Guards see them so they know what to expect."""
    entries = list(
        db.scalars(
            select(WatchlistEntry)
            .where(WatchlistEntry.removed_at.is_(None))
            .order_by(WatchlistEntry.created_at.desc())
        )
    )
    audit.record(
        db,
        action="watchlist.list",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="watchlist",
        details={"returned": len(entries)},
    )
    db.commit()
    return entries


@router.post("", response_model=WatchlistPublic, status_code=status.HTTP_201_CREATED)
def add_to_watchlist(
    payload: WatchlistCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> WatchlistEntry:
    plate = normalize_plate(payload.plate_number)
    if db.scalar(select(WatchlistEntry).where(WatchlistEntry.plate_number == plate, WatchlistEntry.removed_at.is_(None))):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That plate is already on the watchlist")
    entry = WatchlistEntry(
        plate_number=plate,
        plate_display=payload.plate_number.strip(),
        reason=payload.reason.strip(),
        created_by=current_user.id,
    )
    db.add(entry)
    db.flush()
    audit.record(
        db,
        action="watchlist.added",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="watchlist",
        resource_id=str(entry.id),
        details={"plate_number": plate, "reason": entry.reason},
    )
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/{entry_id}/remove", response_model=WatchlistPublic)
def remove_from_watchlist(
    entry_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> WatchlistEntry:
    """Stops flagging the plate. Kept, not deleted: why it was flagged is history."""
    entry = db.get(WatchlistEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watchlist entry not found")
    if entry.removed_at is None:
        entry.removed_at = datetime.now(timezone.utc)
        entry.removed_by = current_user.id
        audit.record(
            db,
            action="watchlist.removed",
            request=request,
            actor_id=current_user.id,
            actor_email=current_user.email,
            resource_type="watchlist",
            resource_id=str(entry.id),
            details={"plate_number": entry.plate_number},
        )
        db.commit()
        db.refresh(entry)
    return entry
