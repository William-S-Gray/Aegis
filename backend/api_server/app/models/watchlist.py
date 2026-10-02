import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.vehicle import PLATE_MAX_LENGTH


class WatchlistEntry(Base):
    """
    A plate to flag on sight: reported stolen, banned from the site, wanted.

    A camera read of a watched plate is a "watchlist" alert, which outranks
    every other verdict, even a registered vehicle that matches. Entries are
    removed, not deleted, so the record of why a plate was flagged survives.
    """

    __tablename__ = "watchlist_entries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    plate_number: Mapped[str] = mapped_column(String(PLATE_MAX_LENGTH), nullable=False, index=True)
    plate_display: Mapped[str] = mapped_column(String(PLATE_MAX_LENGTH + 8), nullable=False)
    reason: Mapped[str] = mapped_column(String(200), nullable=False)

    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    removed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
