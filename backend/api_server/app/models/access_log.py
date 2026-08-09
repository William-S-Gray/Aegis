import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.audit import JsonColumn


class AccessAction(str, enum.Enum):
    APPROVE = "approve"
    DENY = "deny"
    ENTRY = "entry"
    EXIT = "exit"
    OVERRIDE = "override"


class AccessLog(Base):
    """
    A record of an access decision at a gate.

    This is the operational history of the system and part of its audit
    surface, so rows are written once and never mutated.
    """

    __tablename__ = "access_logs"
    __table_args__ = (
        Index("ix_access_logs_plate_timestamp", "plate_number", "timestamp"),
        Index("ix_access_logs_site_timestamp", "site_id", "timestamp"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    plate_number: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    action: Mapped[AccessAction] = mapped_column(
        Enum(
            AccessAction,
            native_enum=False,
            length=20,
            values_callable=lambda cls: [member.value for member in cls],
        ),
        nullable=False,
    )

    # When the decision happened. Supplied by the client for queued offline
    # entries, so it can differ from the row's insertion time.
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # The guard who made the call.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vehicles.id", ondelete="SET NULL"), index=True
    )
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sites.id", ondelete="SET NULL"), index=True
    )

    # Detection payload as received. Shape varies by detector version.
    details: Mapped[dict | None] = mapped_column(JsonColumn)
