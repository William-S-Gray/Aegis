import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import (
    AccessAction,
    AlertStatus,
    FeedbackStatus,
    MismatchType,
    ReviewReason,
)

# ---------------------------------------------------------------- sites


class SitePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    address: str | None = None
    is_active: bool


class SiteCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)


# ------------------------------------------------------------- vehicles


class VehiclePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plate_number: str
    plate_display: str
    make: str | None = None
    model: str | None = None
    color: str | None = None
    vehicle_type: str | None = None
    owner_id: uuid.UUID | None = None
    site_id: uuid.UUID | None = None
    is_active: bool


class VehiclePage(BaseModel):
    """
    Paginated vehicles.

    The unpaginated version returned every row: a 1 MB response at 5 000
    vehicles, and proportionally worse at a real site. No operator reads five
    thousand rows, and the browser has to parse all of them.
    """

    vehicles: list[VehiclePublic]
    total: int
    page: int
    total_pages: int


class VehicleCreate(BaseModel):
    plate_number: str = Field(min_length=1, max_length=32)
    make: str | None = Field(default=None, max_length=80)
    model: str | None = Field(default=None, max_length=80)
    color: str | None = Field(default=None, max_length=40)
    vehicle_type: str | None = Field(default=None, max_length=40)
    owner_id: uuid.UUID | None = None
    site_id: uuid.UUID | None = None


class VehicleUpdate(BaseModel):
    make: str | None = Field(default=None, max_length=80)
    model: str | None = Field(default=None, max_length=80)
    color: str | None = Field(default=None, max_length=40)
    vehicle_type: str | None = Field(default=None, max_length=40)
    owner_id: uuid.UUID | None = None
    site_id: uuid.UUID | None = None
    is_active: bool | None = None


# ---------------------------------------------------------- access logs


class AccessLogPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plate_number: str
    action: AccessAction
    timestamp: datetime
    user_id: uuid.UUID | None = None
    vehicle_id: uuid.UUID | None = None
    site_id: uuid.UUID | None = None
    details: dict | None = None


class AccessLogCreate(BaseModel):
    plate_number: str = Field(min_length=1, max_length=32)
    action: AccessAction
    # Optional so a live decision can simply omit it; supplied explicitly when
    # replaying entries queued while the device was offline.
    timestamp: datetime | None = None
    site_id: uuid.UUID | None = None
    details: dict | None = None


class AccessLogPage(BaseModel):
    logs: list[AccessLogPublic]
    total: int
    page: int
    total_pages: int


# ------------------------------------------------------------- comments


class AlertCommentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    author_email: str | None = None
    body: str
    created_at: datetime


class AlertCommentCreate(BaseModel):
    comment: str = Field(min_length=1, max_length=2000)


# --------------------------------------------------------------- alerts


class AlertPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plate_number: str
    detected_type: str | None = None
    detected_color: str | None = None
    registered_type: str | None = None
    registered_color: str | None = None
    plate_confidence: float | None = None
    type_confidence: float | None = None
    mismatch_type: MismatchType
    status: AlertStatus
    feedback_status: FeedbackStatus
    assigned_to: uuid.UUID | None = None
    site_id: uuid.UUID | None = None
    timestamp: datetime
    resolved_at: datetime | None = None

    requires_review: bool = False
    review_reason: ReviewReason | None = None
    confirmed_plate: str | None = None
    reviewed_at: datetime | None = None
    detector_name: str | None = None
    detector_version: str | None = None

    comments: list[AlertCommentPublic] = []


class AlertPage(BaseModel):
    """Paginated envelope the alert-history screen consumes."""

    alerts: list[AlertPublic]
    total: int
    page: int
    total_pages: int


class AlertCreate(BaseModel):
    plate_number: str = Field(min_length=1, max_length=32)
    detected_type: str | None = Field(default=None, max_length=40)
    detected_color: str | None = Field(default=None, max_length=40)
    plate_confidence: float | None = Field(default=None, ge=0, le=1)
    type_confidence: float | None = Field(default=None, ge=0, le=1)
    site_id: uuid.UUID | None = None

    # Supplied by the vision service so accuracy can be attributed to a model
    # version rather than to "the system".
    detector_name: str | None = Field(default=None, max_length=60)
    detector_version: str | None = Field(default=None, max_length=40)


class PlateConfirmation(BaseModel):
    """A human's verdict on a low-confidence read."""

    plate_number: str = Field(min_length=1, max_length=32)


class AlertAssign(BaseModel):
    user_id: uuid.UUID | None = None


class AlertStatusUpdate(BaseModel):
    status: AlertStatus
    feedback_status: FeedbackStatus | None = None


# ---------------------------------------------------------------- rules


class RulePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    attribute: str
    allowed_pair: list[str]


class RuleCreate(BaseModel):
    attribute: str = Field(min_length=1, max_length=40)
    allowed_pair: list[str] = Field(min_length=2, max_length=2)

    @field_validator("attribute")
    @classmethod
    def _known_attribute(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"type", "color"}:
            raise ValueError("attribute must be 'type' or 'color'")
        return normalized

    @field_validator("allowed_pair")
    @classmethod
    def _distinct_values(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip().lower() for item in value]
        if any(not item for item in cleaned):
            raise ValueError("allowed_pair values must not be empty")
        if cleaned[0] == cleaned[1]:
            raise ValueError("allowed_pair values must differ")
        return cleaned


# ------------------------------------------------------------ analytics


class MismatchPoint(BaseModel):
    date: str
    count: int


class CommonMismatch(BaseModel):
    type: str
    count: int


class ConfidenceSummary(BaseModel):
    average_plate_confidence: float
    average_type_confidence: float


class FeedbackSummary(BaseModel):
    false_alarms: int
    investigated: int
    escalated: int
    pending: int


class ResolutionSummary(BaseModel):
    average_time_to_resolution_minutes: float


class EscalationSummary(BaseModel):
    escalation_rate_percent: float
