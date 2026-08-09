from __future__ import annotations

import hashlib
import random

from app.types import BoundingBox, Frame, PlateDetection


class StubPlateDetector:
    """
    A deterministic stand-in for a real detector.

    Its purpose is not to detect anything: it exists so the pipeline, the
    confidence gating, the review queue, and the API integration can all be
    exercised and tested without a 3 GB model download or a GPU. Output is
    seeded from the frame source so a given input always yields the same
    result, which keeps tests meaningful.

    Never enable this outside development. `VisionSettings.detector` defaults
    to it precisely so a misconfigured deployment fails loudly rather than
    silently reporting fabricated plates.
    """

    name = "stub"
    version = "0.1.0"

    def __init__(self, plates: list[str] | None = None, confidence: float | None = None):
        self._plates = plates or ["AB12CD", "XY99ZZ", "GHOST1", "TEST123"]
        self._fixed_confidence = confidence

    def _rng(self, frame: Frame) -> random.Random:
        seed = hashlib.sha256(frame.source.encode("utf-8")).hexdigest()
        return random.Random(int(seed[:16], 16))

    def detect(self, frame: Frame) -> list[PlateDetection]:
        rng = self._rng(frame)
        confidence = (
            self._fixed_confidence
            if self._fixed_confidence is not None
            else round(rng.uniform(0.45, 0.99), 3)
        )
        return [
            PlateDetection(
                box=BoundingBox(x=10, y=10, width=120, height=40),
                confidence=confidence,
                vehicle_type=rng.choice(["sedan", "van", "suv"]),
                vehicle_type_confidence=round(rng.uniform(0.5, 0.98), 3),
                vehicle_color=rng.choice(["white", "grey", "black", "red"]),
            )
        ]

    def plate_for(self, frame: Frame) -> str:
        """The plate text the paired stub reader should return for this frame."""
        return self._rng(frame).choice(self._plates)


class StubPlateReader:
    """Returns the plate the stub detector decided this frame contains."""

    name = "stub-ocr"
    version = "0.1.0"

    def __init__(self, detector: StubPlateDetector, frame: Frame | None = None):
        self._detector = detector
        self._frame = frame

    def bind(self, frame: Frame) -> "StubPlateReader":
        return StubPlateReader(self._detector, frame)

    def read(self, image):  # noqa: ANN001 - image is ignored by design
        from app.types import PlateReading

        if self._frame is None:
            return None
        return PlateReading(text=self._detector.plate_for(self._frame), confidence=1.0)
