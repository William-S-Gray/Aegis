from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol, runtime_checkable


@dataclass(frozen=True)
class Frame:
    """
    One image to analyse.

    `image` is deliberately untyped: it is a numpy array when OpenCV is
    installed and raw bytes otherwise, and nothing in the pipeline outside a
    detector should look at it.
    """

    image: Any
    source: str
    captured_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    site_id: str | None = None


@dataclass(frozen=True)
class BoundingBox:
    x: int
    y: int
    width: int
    height: int

    def crop(self, image: Any) -> Any:
        """Slice this box out of a numpy-style image; returns None otherwise."""
        try:
            return image[self.y : self.y + self.height, self.x : self.x + self.width]
        except Exception:
            return None


@dataclass(frozen=True)
class PlateDetection:
    """A region the detector believes contains a licence plate."""

    box: BoundingBox
    confidence: float
    vehicle_type: str | None = None
    vehicle_type_confidence: float | None = None
    vehicle_color: str | None = None


@dataclass(frozen=True)
class PlateReading:
    """The characters read from a detected plate."""

    text: str
    confidence: float


@dataclass(frozen=True)
class Observation:
    """A completed read: where the plate was, and what it says."""

    plate_text: str
    plate_confidence: float
    detection: PlateDetection
    frame: Frame
    detector_name: str
    detector_version: str
    # The plate region as captured, for the human reviewer. None when the
    # frame is not an image array (e.g. the stub without OpenCV).
    crop: Any = None

    @property
    def vehicle_type(self) -> str | None:
        return self.detection.vehicle_type

    @property
    def vehicle_color(self) -> str | None:
        return self.detection.vehicle_color

    @property
    def type_confidence(self) -> float | None:
        return self.detection.vehicle_type_confidence


@runtime_checkable
class PlateDetector(Protocol):
    """
    Locates plates in a frame.

    Kept behind a protocol so the model can be swapped — and, more importantly,
    so two models can be run against the same footage and compared. Accuracy
    work is impossible if the detector is welded into the pipeline.
    """

    name: str
    version: str

    def detect(self, frame: Frame) -> list[PlateDetection]: ...


@runtime_checkable
class PlateReader(Protocol):
    """Turns a cropped plate region into characters."""

    name: str
    version: str

    def read(self, image: Any) -> PlateReading | None: ...
