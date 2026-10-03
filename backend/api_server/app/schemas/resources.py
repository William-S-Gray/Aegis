import base64
import binascii
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import get_settings
from app.models import (
    PLATE_MAX_LENGTH,
    AccessAction,
    AlertStatus,
    FeedbackStatus,
    MismatchType,
    ReviewReason,
    normalize_plate,
)


def _plate(value: str) -> str:
    """Reject a plate that normalises to nothing or overflows the columns.

    Checked here, once, so every write path agrees: an empty plate cannot be
    erased or matched, and an over-long one is a database error rather than a
    validation error.
    """
    normalized = normalize_plate(value)
    if not 1 <= len(normalized) <= PLATE_MAX_LENGTH:
        raise ValueError(
            f"plate_number must contain between 1 and {PLATE_MAX_LENGTH} letters or digits"
        )
    return value


# A plate as typed or read. Routes still normalise it; this only guarantees
# that normalising yields something storable.
PlateStr = Annotated[str, Field(min_length=1, max_length=PLATE_MAX_LENGTH), AfterValidator(_plate)]

# Free-form detail payloads are stored as JSONB and copied into backups and
# subject-access exports, so their size is bounded.
MAX_DETAILS_BYTES = 8192

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
    plate_number: PlateStr
    make: str | None = Field(default=None, max_length=80)
    model: str | None = Field(default=None, max_length=80)
    color: str | None = Field(default=None, max_length=40)
    vehicle_type: str | None = Field(default=None, max_length=40)
    owner_id: uuid.UUID | None = None
    site_id: uuid.UUID | None = None


# Longest a single pass may run. A standing arrangement belongs in the register.
VISITOR_PASS_MAX_DAYS = 30


class VisitorPassCreate(BaseModel):
    plate_number: PlateStr
    visitor_name: str = Field(min_length=1, max_length=200)
    valid_from: datetime
    valid_until: datetime
    notes: str | None = Field(default=None, max_length=500)
    # Guards and administrators only; a resident always hosts their own passes.
    host_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _window(self) -> "VisitorPassCreate":
        if self.valid_from.tzinfo is None or self.valid_until.tzinfo is None:
            raise ValueError("valid_from and valid_until must include a timezone")
        if self.valid_until <= self.valid_from:
            raise ValueError("valid_until must be after valid_from")
        if self.valid_until <= datetime.now(timezone.utc):
            raise ValueError("valid_until is already in the past")
        if self.valid_until - self.valid_from > timedelta(days=VISITOR_PASS_MAX_DAYS):
            raise ValueError(f"A pass may run at most {VISITOR_PASS_MAX_DAYS} days; register the vehicle instead")
        return self


class VisitorPassPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plate_number: str
    plate_display: str
    visitor_name: str
    notes: str | None = None
    valid_from: datetime
    valid_until: datetime
    revoked_at: datetime | None = None
    host_id: uuid.UUID | None = None
    host_name: str | None = None
    created_at: datetime


class VisitorSummary(BaseModel):
    """What a guard needs on an alert: who, for whom, until when."""

    model_config = ConfigDict(from_attributes=True)

    visitor_name: str
    host_name: str | None = None
    valid_until: datetime


class WatchlistCreate(BaseModel):
    plate_number: PlateStr
    # Shown to the guard on a hit: what to do depends on why it is watched.
    reason: str = Field(min_length=1, max_length=200)


class WatchlistPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plate_number: str
    plate_display: str
    reason: str
    created_at: datetime
    removed_at: datetime | None = None


class WatchlistSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    reason: str


class VisitPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plate_number: str
    entered_at: datetime | None = None
    exited_at: datetime | None = None
    vehicle_id: uuid.UUID | None = None
    visitor_pass: VisitorSummary | None = None


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
    plate_number: PlateStr
    action: AccessAction
    # Optional so a live decision can simply omit it; supplied explicitly when
    # replaying entries queued while the device was offline.
    timestamp: datetime | None = None
    site_id: uuid.UUID | None = None
    details: dict | None = None
    # Generated by the client once per decision, so replaying an offline queue
    # (or retrying after a lost response) cannot record the decision twice.
    client_ref: uuid.UUID | None = None

    @field_validator("timestamp")
    @classmethod
    def _plausible_timestamp(cls, value: datetime | None) -> datetime | None:
        """
        The client's clock decides ordering and, through it, retention, so it
        is bounded: an offline replay is at most a few days old, and nothing
        happens in the future.
        """
        if value is None:
            return value
        if value.tzinfo is None:
            raise ValueError("timestamp must include a timezone")
        now = datetime.now(timezone.utc)
        if value > now + timedelta(minutes=5):
            raise ValueError("timestamp is in the future")
        max_age = get_settings().access_log_max_age_days
        if value < now - timedelta(days=max_age):
            raise ValueError(f"timestamp is more than {max_age} days old")
        return value

    @field_validator("details")
    @classmethod
    def _bounded_details(cls, value: dict | None) -> dict | None:
        if value is not None and len(json.dumps(value, default=str)) > MAX_DETAILS_BYTES:
            raise ValueError(f"details must serialise to at most {MAX_DETAILS_BYTES} bytes")
        return value


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
    has_crop: bool = False
    direction: str | None = None
    visitor_pass: VisitorSummary | None = None
    watchlist_entry: WatchlistSummary | None = None
    # Review queue only: registered plates one character from this read.
    suggested_plates: list[str] = []
    # Set on the live notification when the barrier was opened automatically.
    auto_opened: bool = False

    comments: list[AlertCommentPublic] = []


class AlertPage(BaseModel):
    """Paginated envelope the alert-history screen consumes."""

    alerts: list[AlertPublic]
    total: int
    page: int
    total_pages: int


class AlertCreate(BaseModel):
    plate_number: PlateStr
    detected_type: str | None = Field(default=None, max_length=40)
    detected_color: str | None = Field(default=None, max_length=40)
    plate_confidence: float | None = Field(default=None, ge=0, le=1)
    type_confidence: float | None = Field(default=None, ge=0, le=1)
    site_id: uuid.UUID | None = None

    # Supplied by the vision service so accuracy can be attributed to a model
    # version rather than to "the system".
    detector_name: str | None = Field(default=None, max_length=60)
    detector_version: str | None = Field(default=None, max_length=40)

    # The plate crop as base64 JPEG, for the human reviewer. ~64 KB decoded.
    plate_crop_jpeg: str | None = Field(default=None, max_length=90_000)
    # Width of the plate in the camera image, for the small-plate review rule.
    plate_width_px: int | None = Field(default=None, ge=1, le=20_000)
    # From a camera tagged entry or exit; pairs reads into visits.
    direction: Literal["entry", "exit"] | None = None

    @field_validator("plate_crop_jpeg")
    @classmethod
    def _jpeg(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            raw = base64.b64decode(value, validate=True)
        except binascii.Error:
            raise ValueError("plate_crop_jpeg must be base64") from None
        # Served back to browsers as image/jpeg, so only JPEG is accepted.
        if not raw.startswith(b"\xff\xd8\xff"):
            raise ValueError("plate_crop_jpeg must be a JPEG image")
        return value


class PlateConfirmation(BaseModel):
    """A human's verdict on a low-confidence read."""

    plate_number: PlateStr


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
    allowed_pair: list[Annotated[str, Field(max_length=60)]] = Field(min_length=2, max_length=2)

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
