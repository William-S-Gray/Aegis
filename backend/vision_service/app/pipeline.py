from __future__ import annotations

import base64
import logging
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field, replace
from typing import Any, Protocol

from app.client import AegisClient
from app.types import Frame, Observation, PlateDetector, PlateReader

logger = logging.getLogger(__name__)


class VehicleClassifier(Protocol):
    """Coarse type of the vehicle carrying a plate, e.g. ("car", 0.94)."""

    def classify(self, image: Any, plate: Any) -> tuple[str, float] | None: ...

_NON_ALNUM = re.compile(r"[^A-Z0-9]")

# Below this many characters a "plate" is almost certainly OCR noise picked out
# of a bumper sticker or a reflection.
MIN_PLATE_LENGTH = 4

# Largest encoded crop sent to the API (it accepts up to ~64 KB decoded).
MAX_CROP_BYTES = 60_000


def normalize_plate(text: str) -> str:
    """Match the API's canonical form so both sides agree on identity."""
    return _NON_ALNUM.sub("", text.upper())


def encode_crop(crop) -> str | None:
    """
    The plate crop as base64 JPEG, for the reviewer who confirms the read.

    Best effort: without OpenCV, or for an empty or oversized crop, the alert is
    published without an image rather than not at all.
    """
    if crop is None or not getattr(crop, "size", 0):
        return None
    try:
        import cv2  # noqa: PLC0415 - optional dependency

        ok, buffer = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 80])
    except Exception:
        logger.debug("Could not encode a plate crop", exc_info=True)
        return None
    if not ok or len(buffer) > MAX_CROP_BYTES:
        return None
    return base64.b64encode(buffer.tobytes()).decode("ascii")


@dataclass
class PipelineStats:
    """
    Counters for what the pipeline actually did.

    These are the numbers to quote to a customer — not a single accuracy
    figure. "We auto-accept X%, route Y% to review, and discard Z% as
    unreadable" is a claim that survives contact with their site.
    """

    frames: int = 0
    detections: int = 0
    unreadable: int = 0
    below_floor: int = 0
    unconfirmed: int = 0
    deduped: int = 0
    published: int = 0
    rejected_by_api: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "frames": self.frames,
            "detections": self.detections,
            "unreadable": self.unreadable,
            "below_floor": self.below_floor,
            "unconfirmed": self.unconfirmed,
            "deduped": self.deduped,
            "published": self.published,
            "rejected_by_api": self.rejected_by_api,
        }


@dataclass
class _RecentPlates:
    """
    Suppresses repeat sightings of the same plate.

    A car waiting at a barrier appears in every frame. Without this, one
    arrival becomes fifty alerts and the guard console is unusable.
    """

    window_seconds: float
    _seen: dict[str, float] = field(default_factory=dict)

    def is_duplicate(self, plate: str, now: float) -> bool:
        self._evict(now)
        last = self._seen.get(plate)
        if last is not None and now - last < self.window_seconds:
            # Refresh so a continuously present vehicle stays suppressed.
            self._seen[plate] = now
            return True
        self._seen[plate] = now
        return False

    def _evict(self, now: float) -> None:
        stale = [p for p, t in self._seen.items() if now - t >= self.window_seconds]
        for plate in stale:
            self._seen.pop(plate, None)


class Pipeline:
    """
    frame -> detect -> read -> gate -> publish.

    Each stage is deliberately small and side-effect free apart from the final
    publish, so the whole thing can be exercised in tests with a stub detector
    and a fake client.
    """

    def __init__(
        self,
        detector: PlateDetector,
        reader: PlateReader,
        client: AegisClient | None = None,
        *,
        site_id: str | None = None,
        min_publish_confidence: float = 0.50,
        dedupe_window_seconds: float = 30.0,
        confirm_frames: int = 3,
        confirm_window_frames: int = 5,
        vehicle_classifier: VehicleClassifier | None = None,
        clock=time.monotonic,
    ):
        self._detector = detector
        self._reader = reader
        self._client = client
        self._site_id = site_id
        self._min_publish_confidence = min_publish_confidence
        self._recent = _RecentPlates(dedupe_window_seconds)
        self._confirm_frames = confirm_frames
        self._vehicle_classifier = vehicle_classifier
        # Per camera: the plates read in each of its last few frames.
        self._history: dict[str, deque[set[str]]] = defaultdict(
            lambda: deque(maxlen=max(confirm_window_frames, confirm_frames))
        )
        self._clock = clock
        self.stats = PipelineStats()

    # ------------------------------------------------------------ stages

    def observe(self, frame: Frame) -> list[Observation]:
        """Detect and read every plate in a frame."""
        self.stats.frames += 1
        observations: list[Observation] = []

        for detection in self._detector.detect(frame):
            self.stats.detections += 1

            crop = detection.box.crop(frame.image)
            reader = self._bind_reader(frame)
            reading = reader.read(crop)

            if reading is None or not reading.text:
                self.stats.unreadable += 1
                continue

            plate = normalize_plate(reading.text)
            if len(plate) < MIN_PLATE_LENGTH:
                self.stats.unreadable += 1
                continue

            # The reading's confidence decides, not detection x reading.
            # Detection confidence scores the box, not the characters: measured
            # on real plates it sat at 0.73-0.93 for right and wrong reads
            # alike, and multiplying by it pushed most correct reads under the
            # auto-accept line. Boxes below the detector's own threshold are
            # already dropped, which is the floor that keeps non-plates out.
            confidence = round(reading.confidence, 4)

            observations.append(
                Observation(
                    plate_text=plate,
                    plate_confidence=confidence,
                    detection=detection,
                    frame=frame,
                    detector_name=self._detector.name,
                    detector_version=self._detector.version,
                    crop=crop,
                )
            )

        return observations

    def _bind_reader(self, frame: Frame) -> PlateReader:
        """Give the stub reader the frame it needs; real readers ignore this."""
        bind = getattr(self._reader, "bind", None)
        return bind(frame) if callable(bind) else self._reader

    def _confirmed(self, frame: Frame, observations: list[Observation]) -> list[Observation]:
        """
        Only reads seen in several of a camera's recent frames.

        One blurred frame can misread a plate with high confidence: on a
        webcam test, a plate read correctly 142 times was read once as a
        different plate at 0.92, which would have been auto-accepted. The
        true reading dominates across frames; a misread does not repeat.
        """
        if frame.still or self._confirm_frames <= 1:
            return observations
        history = self._history[frame.source]
        history.append({o.plate_text for o in observations})
        confirmed = []
        for observation in observations:
            if sum(observation.plate_text in seen for seen in history) >= self._confirm_frames:
                confirmed.append(observation)
            else:
                self.stats.unconfirmed += 1
        return confirmed

    def _with_vehicle_type(self, frame: Frame, observation: Observation) -> Observation:
        """
        Add the vehicle's type when the detector did not supply one. Only here,
        once per published vehicle: classification is too slow for every frame.
        """
        if self._vehicle_classifier is None or observation.vehicle_type:
            return observation
        found = self._vehicle_classifier.classify(frame.image, observation.detection.box)
        if found is None:
            return observation
        vehicle_type, confidence = found
        detection = replace(
            observation.detection, vehicle_type=vehicle_type, vehicle_type_confidence=confidence
        )
        return replace(observation, detection=detection)

    def to_payload(self, observation: Observation) -> dict:
        return {
            "plate_number": observation.plate_text,
            "detected_type": observation.vehicle_type,
            "detected_color": observation.vehicle_color,
            "plate_confidence": observation.plate_confidence,
            "type_confidence": observation.type_confidence,
            "site_id": observation.frame.site_id or self._site_id,
            "detector_name": observation.detector_name,
            "detector_version": observation.detector_version,
            "plate_crop_jpeg": encode_crop(observation.crop),
        }

    # ----------------------------------------------------------- publish

    def process(self, frame: Frame) -> list[dict]:
        """Run a frame end to end, returning the alerts the API accepted."""
        published: list[dict] = []
        now = self._clock()

        candidates = []
        for observation in self.observe(frame):
            if observation.plate_confidence < self._min_publish_confidence:
                # Refused locally to save a round trip; the API enforces its
                # own floor independently.
                self.stats.below_floor += 1
                continue
            candidates.append(observation)

        for observation in self._confirmed(frame, candidates):
            if self._recent.is_duplicate(observation.plate_text, now):
                self.stats.deduped += 1
                continue

            observation = self._with_vehicle_type(frame, observation)

            if self._client is None:
                self.stats.published += 1
                continue

            alert = self._client.create_alert(self.to_payload(observation))
            if alert is None:
                self.stats.rejected_by_api += 1
                continue

            self.stats.published += 1
            published.append(alert)

            if alert.get("requires_review"):
                # Identified by alert id, never by plate: stdout is outside
                # every retention and erasure mechanism.
                logger.info(
                    "Detection queued for human review",
                    extra={
                        "alert_id": alert.get("id"),
                        "review_reason": alert.get("review_reason"),
                        "confidence": observation.plate_confidence,
                    },
                )

        return published
