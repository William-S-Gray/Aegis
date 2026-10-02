import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.vehicle import PLATE_MAX_LENGTH


class VisitorPass(Base):
    """
    A plate expected at the gate for a limited time: a visitor, contractor or
    delivery that is not in the vehicle register.

    A camera read of the plate inside the window is an "expected visitor"
    rather than an unregistered plate. A guard still decides; a pass is never
    grounds for opening the barrier on its own.
    """

    __tablename__ = "visitor_passes"
    __table_args__ = (Index("ix_visitor_passes_plate_window", "plate_number", "valid_until"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    plate_number: Mapped[str] = mapped_column(String(PLATE_MAX_LENGTH), nullable=False)
    plate_display: Mapped[str] = mapped_column(String(PLATE_MAX_LENGTH + 8), nullable=False)
    visitor_name: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500))

    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    valid_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The person the visitor is coming to see. A resident can only host passes
    # for themselves; guards and administrators can issue them for anyone.
    host_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )

    host = relationship("User", foreign_keys=[host_id], lazy="joined")

    @property
    def host_name(self) -> str | None:
        return self.host.full_name if self.host else None
