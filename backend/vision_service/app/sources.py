from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from pathlib import Path

from app.types import Frame

logger = logging.getLogger(__name__)


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
        patterns = ("*.jpg", "*.jpeg", "*.png", "*.bmp")
        while True:
            paths = sorted(p for pattern in patterns for p in self._directory.glob(pattern))
            if not paths:
                logger.warning("No images found in %s", self._directory)
                return

            for path in paths:
                image = _load_image(path)
                if image is None:
                    continue
                yield Frame(image=image, source=str(path), site_id=self._site_id)

            if not self._loop:
                return


class VideoSource:
    """
    Reads frames from a video file, RTSP stream, or MJPEG endpoint.

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
    ):
        self._uri = uri
        self._site_id = site_id
        self._interval = frame_interval_seconds
        self._reconnect_delay = reconnect_delay_seconds

    def frames(self) -> Iterator[Frame]:
        try:
            import cv2  # noqa: PLC0415 - optional dependency
        except ImportError as exc:  # pragma: no cover - depends on install
            raise RuntimeError(
                "opencv-python is not installed. Install the ML extras with "
                "`pip install -r requirements-ml.txt` to read video sources."
            ) from exc

        while True:
            capture = cv2.VideoCapture(self._uri)
            if not capture.isOpened():
                # Cameras drop out; wait and retry rather than exiting.
                logger.warning("Could not open %s; retrying", self._uri)
                time.sleep(self._reconnect_delay)
                continue

            last_emit = 0.0
            try:
                while True:
                    ok, image = capture.read()
                    if not ok:
                        logger.info("Stream %s ended or stalled", self._uri)
                        break

                    now = time.monotonic()
                    if now - last_emit < self._interval:
                        continue
                    last_emit = now

                    yield Frame(image=image, source=self._uri, site_id=self._site_id)
            finally:
                capture.release()

            time.sleep(self._reconnect_delay)


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
