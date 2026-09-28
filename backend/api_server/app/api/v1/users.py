import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.deps import require_admin, require_guard
from app.core.security import hash_password
from app.database import get_db
from app.models import Role, User
from app.schemas import UserCreate, UserPublic, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserPublic])
def list_users(
    db: Session = Depends(get_db),
    # Guards need the roster to assign alerts, so this is not admin-only.
    current_user: User = Depends(require_guard),
) -> list[User]:
    query = select(User).order_by(User.full_name)
    if current_user.role != Role.ADMIN:
        # Guards need colleagues to assign alerts to, not the service account,
        # plain users, or former staff.
        query = query.where(User.is_active.is_(True), User.role.in_([Role.ADMIN, Role.GUARD]))
    return list(db.scalars(query).all())


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> User:
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email already exists",
        )

    user = User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.flush()

    audit.record(
        db,
        action="user.created",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="user",
        resource_id=str(user.id),
        details={"email": user.email, "role": user.role.value},
    )
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserPublic)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    changes = payload.model_dump(exclude_unset=True)

    # An administrator must not be able to lock themselves out or quietly
    # demote themselves; both would leave the system without an owner.
    if user.id == current_user.id:
        if changes.get("is_active") is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot deactivate your own account",
            )
        if "role" in changes and changes["role"] != Role.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot change your own role",
            )

    if "email" in changes:
        clash = db.scalar(select(User).where(User.email == changes["email"], User.id != user.id))
        if clash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with that email already exists",
            )

    for field, value in changes.items():
        setattr(user, field, value)

    audit.record(
        db,
        action="user.updated",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="user",
        resource_id=str(user.id),
        details={"fields": sorted(changes.keys())},
    )
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", response_model=UserPublic)
def deactivate_user(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> User:
    """
    Deactivate rather than delete.

    Access logs reference the acting user; hard deletion would tear holes in
    the audit trail. Deactivation takes effect immediately because every
    authenticated request re-checks `is_active`.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account",
        )

    user.is_active = False
    audit.record(
        db,
        action="user.deactivated",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="user",
        resource_id=str(user.id),
    )
    db.commit()
    db.refresh(user)
    return user
