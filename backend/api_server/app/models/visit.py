import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.vehicle import PLATE_MAX_LENGTH


class Visit(Base):
    """
    A vehicle's time on site: an entry read paired with the exit read after it.

    Opened by an alert from a camera tagged "entry", closed by one tagged
    "exit". An exit with no open visit is kept with no entry time ("entry not
    seen"), so a missed entry never makes a vehicle vanish from the record. A
    guard denying the vehicle at the entry cancels the visit: it never came in.
    """

    __tablename__ = "visits"
    __table_args__ = (Index("ix_visits_plate_open", "plate_number", "exited_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    plate_number: Mapped[str] = mapped_column(String(PLATE_MAX_LENGTH), nullable=False)
    entered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    exited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entry_alert_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("alerts.id", ondelete="SET NULL"))
    exit_alert_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("alerts.id", ondelete="SET NULL"))
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("vehicles.id", ondelete="SET NULL"))
    visitor_pass_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("visitor_passes.id", ondelete="SET NULL")
    )
    site_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )

    visitor_pass = relationship("VisitorPass", lazy="joined")
