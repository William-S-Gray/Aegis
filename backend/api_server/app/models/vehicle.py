import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


_NON_PLATE = re.compile(r"[^A-Z0-9]")

# Longest normalised plate the columns hold.
PLATE_MAX_LENGTH = 32


def normalize_plate(plate: str) -> str:
    """
    Canonical plate form used for storage and lookup.

    Plates are compared across OCR output, manual entry, and registration
    records, so they are upper-cased with everything but A-Z and 0-9 stripped.
    Without this, "AB-12 CD" and "ab12cd" would be treated as different
    vehicles.

    ASCII only, and byte-for-byte the same rule as the vision service
    (vision_service/app/pipeline.py). Unicode letters would let a look-alike
    ("АВ12" in Cyrillic) register as a distinct plate that no camera read can
    ever match.
    """
    return _NON_PLATE.sub("", plate.upper())


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    # The normalized form is what we index and match on.
    plate_number: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    # What the operator typed, preserved for display.
    plate_display: Mapped[str] = mapped_column(String(32), nullable=False)

    make: Mapped[str | None] = mapped_column(String(80))
    model: Mapped[str | None] = mapped_column(String(80))
    color: Mapped[str | None] = mapped_column(String(40))
    vehicle_type: Mapped[str | None] = mapped_column(String(40))

    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    # When the current owner took over. An owner sees access history from this
    # point only: a plate's earlier history belongs to the previous owner.
    owner_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sites.id", ondelete="SET NULL"), index=True
    )

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    # Lazy on purpose. VehiclePublic exposes owner_id, not the owner object,
    # so an eager join would hydrate a User per vehicle for nothing.
    owner = relationship("User", lazy="select")
