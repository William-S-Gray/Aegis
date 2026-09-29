"""
Live preview frames for the guard console.

Every frame the pipeline reads is also offered here; at most one per camera per
interval is downscaled and pushed to the API, which keeps only the latest.
"""

from __future__ import annotations

import logging
import re
import time
from pathlib import PurePath
from urllib.parse import urlsplit

from app.client import AegisClient

logger = logging.getLogger(__name__)

MAX_WIDTH = 960
MAX_BYTES = 500_000  # the API refuses frames over 512 KiB
_SLUG = re.compile(r"[^a-z0-9]+")


def camera_identity(uri: str) -> tuple[str, str]:
    """
    (id, display name) for a source. Stream URLs are reduced to host and path:
    they often embed credentials (rtsp://user:pass@host/...), and the name is
    shown to every guard.
    """
    parts = urlsplit(uri)
    if parts.scheme and parts.hostname:
        name = f"{parts.hostname}{parts.path}".rstrip("/")
    else:
        name = PurePath(uri).name or uri
    slug = _SLUG.sub("-", name.lower()).strip("-")[:40].strip("-")
    return slug or "camera", name[:60]


def encode_frame(image) -> bytes | None:
    """JPEG bytes for a frame, or None when it cannot be encoded."""
    if isinstance(image, (bytes, bytearray)):
        # Without OpenCV, image sources yield the file's bytes unchanged.
        data = bytes(image)
        return data if data.startswith(b"\xff\xd8") and len(data) <= MAX_BYTES else None
    try:
        import cv2  # noqa: PLC0415 - optional dependency

        height, width = image.shape[:2]
        if width > MAX_WIDTH:
            image = cv2.resize(image, (MAX_WIDTH, int(height * MAX_WIDTH / width)))
        ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 70])
    except Exception:
        logger.debug("Could not encode a preview frame", exc_info=True)
        return None
    return buffer.tobytes() if ok and len(buffer) <= MAX_BYTES else None


class Preview:
    def __init__(self, client: AegisClient, interval_seconds: float):
        self._client = client
        self._interval = interval_seconds
        self._last_sent: dict[str, float] = {}

    def offer(self, uri: str, image) -> bool:
        """Push the frame if this camera's interval has passed. True when sent."""
        if self._interval <= 0:
            return False
        camera_id, name = camera_identity(uri)
        now = time.monotonic()
        if now - self._last_sent.get(camera_id, float("-inf")) < self._interval:
            return False
        jpeg = encode_frame(image)
        if jpeg is None:
            return False
        self._last_sent[camera_id] = now
        return self._client.put_frame(camera_id, name, jpeg)
