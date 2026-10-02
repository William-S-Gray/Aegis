"""
Live camera previews for the guard console.

The vision service already reads every camera, so it pushes the frames it
processes here and guards fetch them with their normal session. No camera is
exposed to browsers directly, and nothing reaches a browser without sign-in.

Only the latest frame per camera is kept, in memory: previews are never
written to disk or the database, so they need no retention or erasure path.
In-process state is correct because the API runs as a single replica (R-003).
"""

import re
import time
from dataclasses import dataclass
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from prometheus_client.core import GaugeMetricFamily
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import audit, metrics
from app.core.deps import require_frame_publisher, require_guard
from app.core.state import shared_store
from app.database import get_db
from app.models import User

router = APIRouter(prefix="/cameras", tags=["cameras"])

MAX_FRAME_BYTES = 512 * 1024
MAX_CAMERAS = 32
# A camera that has not sent a frame for this long is shown as offline.
STALE_AFTER_SECONDS = 15.0
# Viewing is audited once per guard and camera in this window, not per frame.
VIEW_AUDIT_WINDOW_SECONDS = 300

_CAMERA_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


@dataclass
class _Frame:
    jpeg: bytes
    name: str
    received_at: float  # wall clock, for display
    received_mono: float  # monotonic, for staleness


class CameraFrames:
    def __init__(self) -> None:
        self._frames: dict[str, _Frame] = {}
        self._lock = Lock()

    def put(self, camera_id: str, name: str, jpeg: bytes) -> bool:
        with self._lock:
            if camera_id not in self._frames and len(self._frames) >= MAX_CAMERAS:
                return False
            self._frames[camera_id] = _Frame(jpeg, name, time.time(), time.monotonic())
            return True

    def get(self, camera_id: str) -> _Frame | None:
        with self._lock:
            return self._frames.get(camera_id)

    def all(self) -> dict[str, _Frame]:
        with self._lock:
            return dict(self._frames)

    def clear(self) -> None:
        with self._lock:
            self._frames.clear()


camera_frames = CameraFrames()


class _CameraAgeCollector:
    """
    Seconds since each camera's last frame, read at scrape time, for the
    camera-offline alerts. Labelled by camera id (host and path, never
    credentials); at most MAX_CAMERAS series.
    """

    def collect(self):
        family = GaugeMetricFamily(
            "aegis_camera_seconds_since_frame",
            "Seconds since the camera last sent a frame.",
            labels=["camera"],
        )
        now = time.monotonic()
        for camera_id, frame in camera_frames.all().items():
            family.add_metric([camera_id], now - frame.received_mono)
        yield family


metrics.registry.register(_CameraAgeCollector())


def _is_online(frame: _Frame) -> bool:
    return time.monotonic() - frame.received_mono < STALE_AFTER_SECONDS


def _valid_id(camera_id: str) -> str:
    if not _CAMERA_ID.match(camera_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown camera")
    return camera_id


class CameraPublic(BaseModel):
    id: str
    name: str
    online: bool
    last_frame_at: float


@router.put("/{camera_id}/frame", status_code=status.HTTP_204_NO_CONTENT)
async def publish_frame(
    camera_id: str,
    request: Request,
    name: str = Query(default="", max_length=60),
    current_user: User = Depends(require_frame_publisher),
) -> Response:
    """Replace a camera's preview with the frame in the body (raw JPEG)."""
    _valid_id(camera_id)
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_FRAME_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_FRAME_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    if not body.startswith(b"\xff\xd8"):
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="JPEG only")
    if not camera_frames.put(camera_id, name.strip() or camera_id, body):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Too many cameras")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=list[CameraPublic])
def list_cameras(current_user: User = Depends(require_guard)) -> list[CameraPublic]:
    return [
        CameraPublic(id=cid, name=f.name, online=_is_online(f), last_frame_at=f.received_at)
        for cid, f in sorted(camera_frames.all().items())
    ]


@router.get("/{camera_id}/frame")
def latest_frame(
    camera_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
) -> Response:
    frame = camera_frames.get(_valid_id(camera_id))
    if frame is None or not _is_online(frame):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera offline")

    # Frames show plates, so viewing them is a read of personal data.
    if shared_store.set_once(
        f"camera-view:{current_user.id}:{camera_id}", "1", VIEW_AUDIT_WINDOW_SECONDS
    ):
        audit.record(
            db,
            action="camera.viewed",
            request=request,
            actor_id=current_user.id,
            actor_email=current_user.email,
            resource_type="camera",
            resource_id=camera_id,
        )
        db.commit()

    return Response(
        content=frame.jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
