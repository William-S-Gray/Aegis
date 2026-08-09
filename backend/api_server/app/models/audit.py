import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON

from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# JSONB on PostgreSQL, plain JSON elsewhere so the test suite can run on SQLite.
JsonColumn = JSON().with_variant(JSONB(), "postgresql")


class AuditLog(Base):
    """
    Append-only record of security-relevant actions.

    Built now rather than later: ALPR systems process personal data, and an
    auditable trail of who viewed or changed what is a precondition for selling
    into any organisation with a compliance function. Rows are never updated or
    deleted by application code.
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_actor_created", "actor_id", "created_at"),
        Index("ix_audit_logs_action_created", "action", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    # Nullable: failed logins have no authenticated actor yet.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    actor_email: Mapped[str | None] = mapped_column(String(320))

    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    resource_type: Mapped[str | None] = mapped_column(String(100))
    resource_id: Mapped[str | None] = mapped_column(String(100))

    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(500))

    # Never store credentials or tokens here.
    details: Mapped[dict | None] = mapped_column(JsonColumn)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
