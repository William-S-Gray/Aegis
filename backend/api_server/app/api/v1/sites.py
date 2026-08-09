from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.deps import require_admin, require_guard
from app.database import get_db
from app.models import Site, User
from app.schemas import SiteCreate, SitePublic

router = APIRouter(prefix="/sites", tags=["sites"])


@router.get("", response_model=list[SitePublic])
def list_sites(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
) -> list[Site]:
    return list(db.scalars(select(Site).order_by(Site.name)).all())


@router.post("", response_model=SitePublic, status_code=status.HTTP_201_CREATED)
def create_site(
    payload: SiteCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Site:
    if db.scalar(select(Site).where(Site.name == payload.name)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A site with that name already exists"
        )

    site = Site(name=payload.name, address=payload.address)
    db.add(site)
    db.flush()

    audit.record(
        db,
        action="site.created",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="site",
        resource_id=str(site.id),
    )
    db.commit()
    db.refresh(site)
    return site
