from __future__ import annotations

import logging
import threading
import time
from collections.abc import Iterator
from pathlib import Path

from app.types import Frame

logger = logging.getLogger(__name__)


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


class ImageDirectorySource:
    """
    Replays still images from a directory.

    This is the source to use for accuracy work: point it at a folder of
    labelled captures and you can measure a model change against a fixed set
    rather than against whatever happened to drive past.
    """

    def __init__(self, directory: str | Path, site_id: str | None = None, loop: bool = False):
        self._directory = Path(directory)
        self._site_id = site_id
        self._loop = loop

    def frames(self) -> Iterator[Frame]:
        while True:
            # By suffix, any case: phones and cameras write IMG_0001.JPG and
            # .webp, and a glob for "*.jpg" silently skipped both.
            paths = sorted(p for p in self._directory.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
            if not paths:
                logger.warning("No images found in %s", self._directory)
                return

            for path in paths:
                image = _load_image(path)
                if image is None:
                    continue
                yield Frame(image=image, source=str(path), site_id=self._site_id, still=True)

            if not self._loop:
                return


class VideoSource:
    """
    Reads frames from a video file, RTSP stream, MJPEG endpoint, or a local
    camera device such as /dev/video0.

    Requires OpenCV. `frame_interval_seconds` throttles processing: analysing
    every frame of a 30 fps stream is wasted work when a vehicle is present for
    seconds at a time.
    """

    def __init__(
        self,
        uri: str,
        site_id: str | None = None,
        frame_interval_seconds: float = 1.0,
        reconnect_delay_seconds: float = 5.0,
        timeout_seconds: float = 10.0,
        stop: threading.Event | None = None,
        reconnect: threading.Event | None = None,
    ):
        self._uri = uri
        self._site_id = site_id
        self._interval = frame_interval_seconds
        self._reconnect_delay = reconnect_delay_seconds
        self._timeout_ms = int(timeout_seconds * 1000)
        # A live stream that drops is reopened; a file that ends is finished.
        # Reopening a file replays it, re-publishing every plate in it.
        self._live = is_live(uri)
        # Set on shutdown. Waiting on it rather than sleeping means a camera
        # that stays down cannot keep the process from stopping.
        self._stop = stop or threading.Event()
        # Set when a guard asks to restart this camera: drop the connection and
        # reopen now, instead of waiting out a stalled read or a retry delay.
        self._reconnect = reconnect or threading.Event()

    def frames(self) -> Iterator[Frame]:
        try:
            import cv2  # noqa: PLC0415 - optional dependency
        except ImportError as exc:  # pragma: no cover - depends on install
            raise RuntimeError(
                "opencv-python is not installed. Install the ML extras with "
                "`pip install -r requirements-ml.txt` to read video sources."
            ) from exc

        while not self._stop.is_set():
            # Bounded open and read: without these a stalled camera blocks
            # capture.read() forever, and the process never sees SIGTERM.
            if self._uri.startswith("/dev/video"):
                capture = cv2.VideoCapture(self._uri, cv2.CAP_V4L2)
                # USB cameras default to 640x480 raw; most only offer HD as MJPEG,
                # and plates need the pixels. Best effort: the camera picks the
                # nearest mode it supports.
                capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                capture.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            else:
                capture = cv2.VideoCapture(
                    self._uri,
                    cv2.CAP_FFMPEG,
                    [
                        cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, self._timeout_ms,
                        cv2.CAP_PROP_READ_TIMEOUT_MSEC, self._timeout_ms,
                    ],
                )
            if not capture.isOpened():
                if not self._live:
                    logger.error("Could not open %s", self._uri)
                    return
                # Cameras drop out; wait and retry rather than exiting.
                logger.warning("Could not open %s; retrying", self._uri)
                self._wait_before_retry()
                continue

            last_emit = float("-inf")
            try:
                while True:
                    if self._reconnect.is_set():
                        logger.info("Reconnecting %s on request", self._uri)
                        break
                    ok, image = capture.read()
                    if not ok:
                        logger.info("Stream %s ended or stalled", self._uri)
                        break

                    # A file decodes far faster than real time, so pace it by
                    # its own timestamps: on the wall clock a minute of footage
                    # went by in a second and only its first frame was read.
                    now = (
                        time.monotonic()
                        if self._live
                        else capture.get(cv2.CAP_PROP_POS_MSEC) / 1000
                    )
                    if now - last_emit < self._interval:
                        continue
                    last_emit = now

                    yield Frame(image=image, source=self._uri, site_id=self._site_id)
            finally:
                capture.release()

            if not self._live:
                return
            self._wait_before_retry()

    def _wait_before_retry(self) -> None:
        """The usual delay, cut short by a restart request or by shutdown."""
        deadline = time.monotonic() + self._reconnect_delay
        # Short slices: two events cannot be waited on at once, and shutdown
        # must never sit behind a camera that stays down.
        while not (self._stop.is_set() or self._reconnect.is_set()):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            self._stop.wait(min(0.2, remaining))
        self._reconnect.clear()


def is_live(uri: str) -> bool:
    """True for cameras, which are reopened when they drop; a file just ends."""
    return uri.startswith(("rtsp://", "http://", "https://", "/dev/video"))


def _load_image(path: Path):
    try:
        import cv2  # noqa: PLC0415 - optional dependency

        image = cv2.imread(str(path))
        if image is None:
            logger.warning("Unreadable image: %s", path)
        return image
    except ImportError:
        # Without OpenCV the bytes still flow through the pipeline, which is
        # enough for the stub detector and for integration tests.
        return path.read_bytes()
