import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _enum(enum_cls):
    """String-backed enum column storing values rather than member names."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=20,
        values_callable=lambda cls: [member.value for member in cls],
    )


class AlertStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    CLOSED = "closed"


class FeedbackStatus(str, enum.Enum):
    """Operator's verdict on an alert, and the basis of the analytics."""

    PENDING = "pending"
    FALSE_ALARM = "false_alarm"
    INVESTIGATED = "investigated"
    ESCALATED = "escalated"


class ReviewReason(str, enum.Enum):
    """Why a detection was held back for a human to confirm."""

    LOW_PLATE_CONFIDENCE = "low_plate_confidence"
    LOW_TYPE_CONFIDENCE = "low_type_confidence"
    AMBIGUOUS_PLATE = "ambiguous_plate"
    SMALL_PLATE = "small_plate"
    UNEXPECTED_FORMAT = "unexpected_format"


class MismatchType(str, enum.Enum):
    """Why a detection was flagged."""

    NONE = "none"
    TYPE = "type"
    COLOR = "color"
    UNREGISTERED = "unregistered"
    # Not in the register, but a valid visitor pass covers it.
    VISITOR = "visitor"


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        Index("ix_alerts_site_created", "site_id", "created_at"),
        Index("ix_alerts_feedback_created", "feedback_status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    plate_number: Mapped[str] = mapped_column(String(32), index=True, nullable=False)

    # What the detector reported.
    detected_type: Mapped[str | None] = mapped_column(String(40))
    detected_color: Mapped[str | None] = mapped_column(String(40))
    plate_confidence: Mapped[float | None] = mapped_column(Float)
    type_confidence: Mapped[float | None] = mapped_column(Float)

    # What the register says, captured at detection time so later edits to the
    # vehicle record cannot rewrite the history of why an alert fired.
    registered_type: Mapped[str | None] = mapped_column(String(40))
    registered_color: Mapped[str | None] = mapped_column(String(40))

    mismatch_type: Mapped[MismatchType] = mapped_column(
        _enum(MismatchType), nullable=False, default=MismatchType.NONE, index=True
    )

    status: Mapped[AlertStatus] = mapped_column(
        _enum(AlertStatus), nullable=False, default=AlertStatus.OPEN, index=True
    )
    feedback_status: Mapped[FeedbackStatus] = mapped_column(
        _enum(FeedbackStatus), nullable=False, default=FeedbackStatus.PENDING, index=True
    )

    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vehicles.id", ondelete="SET NULL")
    )
    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sites.id", ondelete="SET NULL"), index=True
    )
    # The pass that covered an otherwise unregistered plate.
    visitor_pass_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("visitor_passes.id", ondelete="SET NULL"), index=True
    )
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )

    # ---- Human review -------------------------------------------------
    # An automated read below the auto-accept threshold is still recorded, but
    # is flagged so an operator confirms the plate before it is trusted. This
    # is what makes the accuracy claim honest: the system reports what it is
    # unsure about rather than silently guessing.
    requires_review: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, index=True
    )
    review_reason: Mapped[ReviewReason | None] = mapped_column(_enum(ReviewReason))
    # Set when a human corrects or confirms the machine reading.
    confirmed_plate: Mapped[str | None] = mapped_column(String(32))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The plate as the camera saw it (JPEG), so a reviewer confirms what they
    # can see rather than re-typing the machine's guess. Deferred: list
    # endpoints never load it. Personal data with its own, shorter retention.
    plate_crop: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    # Lets the UI ask for the image only when there is one, without loading it.
    has_crop: Mapped[bool] = column_property(plate_crop.column.is_not(None))

    # Identifies which detector produced this read, so accuracy can be compared
    # across model versions rather than guessed at.
    detector_name: Mapped[str | None] = mapped_column(String(60))
    detector_version: Mapped[str | None] = mapped_column(String(40))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    # Set when the alert reaches a terminal state; drives time-to-resolution.
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    visitor_pass = relationship("VisitorPass", lazy="joined")

    comments: Mapped[list["AlertComment"]] = relationship(
        back_populates="alert",
        cascade="all, delete-orphan",
        order_by="AlertComment.created_at",
    )

    @property
    def timestamp(self) -> datetime:
        """Alias the frontend's alert-history column expects."""
        return self.created_at


class AlertComment(Base):
    __tablename__ = "alert_comments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    alert_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("alerts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    # Denormalised so the trail survives account deletion.
    author_email: Mapped[str | None] = mapped_column(String(320))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    alert: Mapped[Alert] = relationship(back_populates="comments")
