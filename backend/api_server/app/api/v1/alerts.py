import base64
import math
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core import audit, metrics
from app.core.deps import require_alert_publisher, require_guard
from app.core.ws_manager import manager
from app.database import get_db
from app.models import (
    Alert,
    AlertComment,
    AlertStatus,
    AttributeMismatchRule,
    FeedbackStatus,
    MismatchType,
    ReviewReason,
    Role,
    User,
    Vehicle,
    VisitorPass,
    normalize_plate,
)
from app.schemas import (
    AlertAssign,
    AlertCommentCreate,
    AlertCreate,
    AlertPage,
    AlertPublic,
    AlertStatusUpdate,
    PlateConfirmation,
)

from app.config import get_settings

settings = get_settings()

router = APIRouter(prefix="/alerts", tags=["alerts"])

# Terminal states stamp resolved_at, which drives time-to-resolution.
_TERMINAL_STATUSES = {AlertStatus.CLOSED}


def _load(db: Session, alert_id: uuid.UUID) -> Alert:
    alert = db.scalar(
        select(Alert).options(selectinload(Alert.comments)).where(Alert.id == alert_id)
    )
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    return alert


def _registered_vehicle(db: Session, plate: str) -> Vehicle | None:
    """
    The active register entry for a plate.

    A deactivated vehicle is not registered: revoking a vehicle must revoke
    its "matches register" verdict, or revocation changes nothing at the gate.
    """
    return db.scalar(
        select(Vehicle).where(Vehicle.plate_number == plate, Vehicle.is_active.is_(True))
    )


def _pending_depth(db: Session) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Alert)
            .where(Alert.requires_review.is_(True), Alert.reviewed_at.is_(None))
        )
        or 0
    )


def _pair_allowed(db: Session, attribute: str, a: str | None, b: str | None) -> bool:
    """True when an administrator has declared these two values equivalent."""
    if not a or not b:
        return False
    first, second = AttributeMismatchRule.normalize_pair(a, b)
    if first == second:
        return True
    return (
        db.scalar(
            select(AttributeMismatchRule).where(
                AttributeMismatchRule.attribute == attribute,
                AttributeMismatchRule.value_a == first,
                AttributeMismatchRule.value_b == second,
            )
        )
        is not None
    )


# The coarse classes a general-purpose vehicle detector reports, and the
# registered types each is consistent with. Detectors split vans and pickups
# between "car" and "truck", so either class matches them.
TYPE_FAMILIES: dict[str, set[str]] = {
    "car": {
        "car", "sedan", "saloon", "hatchback", "suv", "crossover", "coupe", "convertible",
        "estate", "wagon", "mpv", "minivan", "van", "pickup",
    },
    "truck": {"truck", "lorry", "hgv", "van", "pickup"},
    "bus": {"bus", "coach", "minibus"},
    "motorcycle": {"motorcycle", "motorbike", "scooter", "moped"},
}


def _type_consistent(detected: str, registered: str) -> bool:
    """
    A coarse detection ("car") matches any registered type in its family
    ("suv"). A detector that reports fine types is compared exactly, as before.
    """
    family = TYPE_FAMILIES.get(detected.strip().lower())
    return family is not None and registered.strip().lower() in family


def _valid_pass(db: Session, plate: str) -> VisitorPass | None:
    """A pass covering this plate right now, if any (the latest-ending one)."""
    now = datetime.now(timezone.utc)
    return db.scalar(
        select(VisitorPass)
        .where(
            VisitorPass.plate_number == plate,
            VisitorPass.valid_from <= now,
            VisitorPass.valid_until > now,
            VisitorPass.revoked_at.is_(None),
        )
        .order_by(VisitorPass.valid_until.desc())
        .limit(1)
    )


def classify_mismatch(db: Session, alert: Alert, vehicle: Vehicle | None) -> MismatchType:
    """
    Decide why (or whether) a detection deserves attention.

    An unregistered plate outranks an attribute mismatch: it is the stronger
    signal and the one a guard must act on first.
    """
    if vehicle is None:
        visitor_pass = _valid_pass(db, alert.plate_number)
        alert.visitor_pass_id = visitor_pass.id if visitor_pass else None
        return MismatchType.VISITOR if visitor_pass else MismatchType.UNREGISTERED

    if alert.detected_type and vehicle.vehicle_type:
        if not (
            _type_consistent(alert.detected_type, vehicle.vehicle_type)
            or _pair_allowed(db, "type", alert.detected_type, vehicle.vehicle_type)
        ):
            return MismatchType.TYPE

    if alert.detected_color and vehicle.color:
        if not _pair_allowed(db, "color", alert.detected_color, vehicle.color):
            return MismatchType.COLOR

    return MismatchType.NONE


def _matches_expected_format(plate: str) -> bool:
    """True when no formats are configured, or the plate matches one of them."""
    patterns = [p.strip() for p in settings.plate_formats.split(",") if p.strip()]
    return not patterns or any(re.fullmatch(p, plate) for p in patterns)


def _review_decision(payload: AlertCreate) -> tuple[bool, ReviewReason | None]:
    """
    Decide whether a machine read is trustworthy enough to stand on its own.

    Reads above the auto-accept threshold are acted on directly. Reads between
    the two thresholds are recorded but flagged for a human to confirm — that
    band is the difference between a system that is honest about uncertainty
    and one that quietly invents plate numbers. Anything below the review floor
    is rejected outright by the caller.
    """
    confidence = payload.plate_confidence
    if confidence is None:
        # Manual entry by a guard: a person already vouched for it.
        return False, None
    if confidence < settings.plate_auto_accept_confidence:
        return True, ReviewReason.LOW_PLATE_CONFIDENCE
    if payload.plate_width_px is not None and payload.plate_width_px < settings.plate_auto_accept_min_width:
        return True, ReviewReason.SMALL_PLATE
    if not _matches_expected_format(payload.plate_number):
        return True, ReviewReason.UNEXPECTED_FORMAT
    if (
        payload.type_confidence is not None
        and payload.type_confidence < settings.type_review_confidence
    ):
        return True, ReviewReason.LOW_TYPE_CONFIDENCE
    return False, None


def _one_edit_apart(a: str, b: str) -> bool:
    """True when b is a with one character changed, missing or added."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long = (a, b) if len(a) < len(b) else (b, a)
    return any(long[:i] + long[i + 1:] == short for i in range(len(long)))


def _suggest_plates(db: Session, alerts: list[Alert]) -> None:
    """
    For each read not in the register, the registered plates one character
    away, so a guard can correct a misread with a click rather than retyping.
    Guards can already list the whole register, so this exposes nothing new.
    """
    pending = [a for a in alerts if a.mismatch_type == MismatchType.UNREGISTERED]
    registered = (
        list(db.scalars(select(Vehicle.plate_number).where(Vehicle.is_active.is_(True))))
        if pending
        else []
    )
    for alert in alerts:
        alert.suggested_plates = (
            sorted(p for p in registered if _one_edit_apart(alert.plate_number, p))[:3]
            if alert in pending
            else []
        )


@router.get("/review-queue", response_model=list[AlertPublic])
def review_queue(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[Alert]:
    """Low-confidence reads awaiting human confirmation, oldest first."""
    alerts = list(
        db.scalars(
            select(Alert)
            .options(selectinload(Alert.comments))
            .where(Alert.requires_review.is_(True), Alert.reviewed_at.is_(None))
            .order_by(Alert.created_at)
            .limit(limit)
        ).all()
    )

    _suggest_plates(db, alerts)

    # Reconcile the gauge with the database. Counted, not len(alerts): the page
    # is capped by `limit`, and a gauge that cannot exceed the page size never
    # shows the backlog it exists to alert on.
    metrics.set_review_queue_depth(_pending_depth(db))
    audit.record(
        db,
        action="alert.review_queue_viewed",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        details={"returned": len(alerts)},
    )
    db.commit()
    return alerts


@router.get("/{alert_id}/crop")
def plate_crop(
    alert_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
) -> Response:
    """The captured plate image, so a reviewer confirms what they can see."""
    crop = db.scalar(select(Alert.plate_crop).where(Alert.id == alert_id))
    if crop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No image for this alert")

    # Viewing a plate image is a read of personal data.
    audit.record(
        db,
        action="alert.crop_viewed",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="alert",
        resource_id=str(alert_id),
    )
    db.commit()
    return Response(
        content=crop,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.post("/{alert_id}/confirm-plate", response_model=AlertPublic)
def confirm_plate(
    alert_id: uuid.UUID,
    payload: PlateConfirmation,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
) -> Alert:
    """
    Record a human's reading of a plate the detector was unsure about.

    The corrected plate is re-classified against the register, because a
    misread is exactly the case where an "unregistered" flag was wrong.
    """
    # Locked so two reviewers cannot both confirm the same read; the second
    # waits, then sees it is no longer pending.
    alert = db.scalar(select(Alert).where(Alert.id == alert_id).with_for_update())
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    if not alert.requires_review or alert.reviewed_at is not None:
        # Confirmation corrects an uncertain read once. It is not a way to
        # rewrite the plate on an accepted or already-reviewed alert.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This alert is not awaiting review"
        )

    corrected = normalize_plate(payload.plate_number)
    was = alert.plate_number
    alert.confirmed_plate = corrected
    alert.plate_number = corrected
    alert.requires_review = False
    alert.reviewed_by = current_user.id
    alert.reviewed_at = datetime.now(timezone.utc)

    vehicle = _registered_vehicle(db, corrected)
    alert.vehicle_id = vehicle.id if vehicle else None
    alert.registered_type = vehicle.vehicle_type if vehicle else None
    alert.registered_color = vehicle.color if vehicle else None
    alert.mismatch_type = classify_mismatch(db, alert, vehicle)

    metrics.observe_confirmation(corrected=was != corrected)
    audit.record(
        db,
        action="alert.plate_confirmed",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="alert",
        resource_id=str(alert.id),
        details={
            "machine_read": was,
            "confirmed": corrected,
            "corrected": was != corrected,
            "mismatch": alert.mismatch_type.value,
        },
    )
    db.commit()
    return _load(db, alert_id)


@router.get("", response_model=AlertPage)
def list_alerts(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    feedback_status: FeedbackStatus | None = None,
    site_id: uuid.UUID | None = None,
) -> AlertPage:
    filters = []
    if feedback_status is not None:
        filters.append(Alert.feedback_status == feedback_status)
    if site_id is not None:
        filters.append(Alert.site_id == site_id)

    total = db.scalar(select(func.count()).select_from(Alert).where(*filters)) or 0

    alerts = list(
        db.scalars(
            select(Alert)
            .options(selectinload(Alert.comments))
            .where(*filters)
            .order_by(Alert.created_at.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        ).all()
    )

    audit.record(
        db,
        action="alert.list",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="alert",
        details={"returned": len(alerts), "page": page},
    )
    db.commit()

    return AlertPage(
        alerts=[AlertPublic.model_validate(a) for a in alerts],
        total=total,
        page=page,
        total_pages=max(1, math.ceil(total / limit)),
    )


@router.post("", response_model=AlertPublic, status_code=status.HTTP_201_CREATED)
def create_alert(
    payload: AlertCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_alert_publisher),
) -> Alert:
    """
    Raise an alert from a detection.

    The vision service will call this once it exists; until then it backs
    manual entry from the guard console.
    """
    if current_user.role == Role.SERVICE:
        # "No confidence" means a person typed the plate, which skips review.
        # A machine read must say how sure it is.
        if payload.plate_confidence is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="plate_confidence is required for automated detections",
            )
        if settings.environment != "development" and (payload.detector_name or "").startswith("stub"):
            # Defence in depth behind the vision service's own check: the stub
            # fabricates plates and must never reach a real register.
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The stub detector is not accepted outside development",
            )

    if (
        payload.plate_confidence is not None
        and payload.plate_confidence < settings.plate_review_floor_confidence
    ):
        # Too weak to be actionable. Recording it would bury real alerts under
        # noise, so it is refused and the caller counts it as a discard.
        metrics.alerts_rejected.labels(reason="below_review_floor").inc()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Plate confidence below the review floor "
                f"({settings.plate_review_floor_confidence})"
            ),
        )

    normalized = normalize_plate(payload.plate_number)
    vehicle = _registered_vehicle(db, normalized)

    alert = Alert(
        plate_number=normalized,
        detected_type=payload.detected_type,
        detected_color=payload.detected_color,
        plate_confidence=payload.plate_confidence,
        type_confidence=payload.type_confidence,
        # Snapshot the register now so later edits cannot rewrite history.
        registered_type=vehicle.vehicle_type if vehicle else None,
        registered_color=vehicle.color if vehicle else None,
        vehicle_id=vehicle.id if vehicle else None,
        site_id=payload.site_id or (vehicle.site_id if vehicle else None),
        detector_name=payload.detector_name,
        detector_version=payload.detector_version,
        plate_crop=base64.b64decode(payload.plate_crop_jpeg) if payload.plate_crop_jpeg else None,
    )
    alert.mismatch_type = classify_mismatch(db, alert, vehicle)

    requires_review, review_reason = _review_decision(payload)
    alert.requires_review = requires_review
    alert.review_reason = review_reason

    db.add(alert)
    db.flush()

    audit.record(
        db,
        action="alert.created",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="alert",
        resource_id=str(alert.id),
        details={"plate_number": normalized, "mismatch": alert.mismatch_type.value},
    )
    db.commit()
    metrics.observe_alert(alert.mismatch_type.value, requires_review)

    created = _load(db, alert.id)
    # Push to every connected guard and administrator. Delivery is best effort:
    # the alert is already durable, and a missed socket must not fail the write.
    manager.broadcast_threadsafe(
        {
            "type": "alert",
            "alert": AlertPublic.model_validate(created).model_dump(mode="json"),
        },
        roles={Role.ADMIN, Role.GUARD},
    )
    return created


@router.post("/{alert_id}/assign", response_model=AlertPublic)
def assign_alert(
    alert_id: uuid.UUID,
    payload: AlertAssign,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
) -> Alert:
    alert = _load(db, alert_id)

    if payload.user_id is not None:
        assignee = db.get(User, payload.user_id)
        if assignee is None or not assignee.is_active:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Unknown or inactive assignee",
            )

    alert.assigned_to = payload.user_id
    if payload.user_id and alert.status == AlertStatus.OPEN:
        alert.status = AlertStatus.IN_PROGRESS

    audit.record(
        db,
        action="alert.assigned",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="alert",
        resource_id=str(alert.id),
        details={"assigned_to": str(payload.user_id) if payload.user_id else None},
    )
    db.commit()
    return _load(db, alert_id)


@router.post("/{alert_id}/status", response_model=AlertPublic)
def update_alert_status(
    alert_id: uuid.UUID,
    payload: AlertStatusUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
) -> Alert:
    alert = _load(db, alert_id)

    alert.status = payload.status
    if payload.feedback_status is not None:
        alert.feedback_status = payload.feedback_status

    if payload.status in _TERMINAL_STATUSES:
        # Only stamp the first time, so reopening and reclosing does not
        # silently reset the resolution clock.
        if alert.resolved_at is None:
            alert.resolved_at = datetime.now(timezone.utc)
    else:
        alert.resolved_at = None

    audit.record(
        db,
        action="alert.status_changed",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="alert",
        resource_id=str(alert.id),
        details={
            "status": alert.status.value,
            "feedback_status": alert.feedback_status.value,
        },
    )
    db.commit()
    return _load(db, alert_id)


@router.post("/{alert_id}/comment", response_model=AlertPublic)
def add_comment(
    alert_id: uuid.UUID,
    payload: AlertCommentCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
) -> Alert:
    alert = _load(db, alert_id)

    db.add(
        AlertComment(
            alert_id=alert.id,
            author_id=current_user.id,
            author_email=current_user.email,
            body=payload.comment.strip(),
        )
    )

    audit.record(
        db,
        action="alert.commented",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
        resource_type="alert",
        resource_id=str(alert.id),
    )
    db.commit()
    return _load(db, alert_id)
