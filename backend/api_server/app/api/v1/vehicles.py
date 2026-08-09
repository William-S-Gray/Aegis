import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.deps import get_current_user, require_admin
from app.database import get_db
from app.models import Role, User, Vehicle, normalize_plate
from app.schemas import VehicleCreate, VehiclePublic, VehicleUpdate

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


@router.get("", response_model=list[VehiclePublic])
def list_vehicles(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Vehicle]:
    """
    Plate data is personal data, so the result set is scoped by role rather
    than merely gated: a plain user sees only vehicles they own.
    """
    query = select(Vehicle).order_by(Vehicle.plate_display)
    if current_user.role == Role.USER:
        query = query.where(Vehicle.owner_id == current_user.id)

    vehicles = list(db.scalars(query).all())

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
    return vehicles


@router.post("", response_model=VehiclePublic, status_code=status.HTTP_201_CREATED)
def create_vehicle(
    payload: VehicleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Vehicle:
    normalized = normalize_plate(payload.plate_number)
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="plate_number must contain at least one alphanumeric character",
        )

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
