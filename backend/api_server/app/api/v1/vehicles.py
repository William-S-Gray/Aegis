import math
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.deps import require_admin, require_any_user
from app.database import get_db
from app.models import Role, User, Vehicle, normalize_plate
from app.schemas import VehicleCreate, VehiclePage, VehiclePublic, VehicleUpdate

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("", response_model=VehiclePage)
def list_vehicles(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_user),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    search: str | None = Query(default=None, description="Partial plate match"),
) -> VehiclePage:
    """
    Plate data is personal data, so the result set is scoped by role rather
    than merely gated: a plain user sees only vehicles they own.

    Paginated. The unpaginated version returned every row — a megabyte of JSON
    at 5 000 vehicles, which no operator reads and every browser must parse.
    `search` exists so the admin UI can find one plate without loading the
    whole register.
    """
    filters = []
    if current_user.role == Role.USER:
        filters.append(Vehicle.owner_id == current_user.id)
    if search:
        needle = normalize_plate(search)
        if needle:
            filters.append(Vehicle.plate_number.like(f"%{needle}%"))

    total = db.scalar(select(func.count()).select_from(Vehicle).where(*filters)) or 0

    vehicles = list(
        db.scalars(
            select(Vehicle)
            .where(*filters)
            .order_by(Vehicle.plate_display)
            .offset((page - 1) * limit)
            .limit(limit)
        ).all()
    )

    audit.record(
        db,
        action="vehicle.list",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="vehicle",
        details={"returned": len(vehicles), "scope": current_user.role.value},
    )
    db.commit()

    return VehiclePage(
        vehicles=[VehiclePublic.model_validate(v) for v in vehicles],
        total=total,
        page=page,
        total_pages=max(1, math.ceil(total / limit)),
    )


@router.post("", response_model=VehiclePublic, status_code=status.HTTP_201_CREATED)
def create_vehicle(
    payload: VehicleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Vehicle:
    # VehicleCreate has already refused plates that normalise to nothing.
    normalized = normalize_plate(payload.plate_number)

    if db.scalar(select(Vehicle).where(Vehicle.plate_number == normalized)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That plate is already registered",
        )

    if payload.owner_id and db.get(User, payload.owner_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown owner_id"
        )

    vehicle = Vehicle(
        plate_number=normalized,
        plate_display=payload.plate_number.strip(),
        make=payload.make,
        model=payload.model,
        color=payload.color,
        vehicle_type=payload.vehicle_type,
        owner_id=payload.owner_id,
        owner_since=datetime.now(timezone.utc) if payload.owner_id else None,
        site_id=payload.site_id,
    )
    db.add(vehicle)
    db.flush()

    audit.record(
        db,
        action="vehicle.created",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="vehicle",
        resource_id=str(vehicle.id),
        details={"plate_number": normalized},
    )
    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.patch("/{vehicle_id}", response_model=VehiclePublic)
def update_vehicle(
    vehicle_id: uuid.UUID,
    payload: VehicleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Vehicle:
    vehicle = db.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")

    changes = payload.model_dump(exclude_unset=True)
    if changes.get("owner_id") and db.get(User, changes["owner_id"]) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown owner_id"
        )

    # A new owner sees history from the transfer onwards, never the previous
    # owner's comings and goings.
    if "owner_id" in changes and changes["owner_id"] != vehicle.owner_id:
        vehicle.owner_since = datetime.now(timezone.utc) if changes["owner_id"] else None

    for field, value in changes.items():
        setattr(vehicle, field, value)

    audit.record(
        db,
        action="vehicle.updated",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="vehicle",
        resource_id=str(vehicle.id),
        details={"fields": sorted(changes.keys())},
    )
    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle(
    vehicle_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> None:
    vehicle = db.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")

    audit.record(
        db,
        action="vehicle.deleted",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="vehicle",
        resource_id=str(vehicle.id),
        details={"plate_number": vehicle.plate_number},
    )
    db.delete(vehicle)
    db.commit()
