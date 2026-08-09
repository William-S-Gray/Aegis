from __future__ import annotations

import logging
from typing import Any

from app.types import BoundingBox, Frame, PlateDetection

logger = logging.getLogger(__name__)


class YoloPlateDetector:
    """
    Plate detection with a YOLO model via Ultralytics.

    Install the optional extras and point `VISION_MODEL_PATH` at your weights:

        pip install -r requirements-ml.txt

    The stock COCO weights do **not** detect licence plates — they detect cars.
    You need plate-specific weights, either a public plate dataset model or one
    fine-tuned on footage from your own cameras. Expect the second option to be
    necessary for production accuracy: plate appearance varies enormously by
    country, mounting position, and camera angle.
    """

    name = "yolo"

    def __init__(
        self,
        model_path: str,
        confidence_threshold: float = 0.25,
        device: str | None = None,
        version: str | None = None,
    ):
        try:
            from ultralytics import YOLO  # noqa: PLC0415 - optional dependency
        except ImportError as exc:  # pragma: no cover - depends on install
            raise RuntimeError(
                "ultralytics is not installed. Install the ML extras with "
                "`pip install -r requirements-ml.txt` to use the YOLO detector."
            ) from exc

        self._model = YOLO(model_path)
        self._confidence_threshold = confidence_threshold
        self._device = device
        # Weights identify the model far better than a hand-maintained string,
        # so alerts can be attributed to exactly what produced them.
        self.version = version or model_path.rsplit("/", 1)[-1]

    def detect(self, frame: Frame) -> list[PlateDetection]:
        try:
            results = self._model.predict(
                frame.image,
                conf=self._confidence_threshold,
                device=self._device,
                verbose=False,
            )
        except Exception:
            # A detector failure must not take down the capture loop; the
            # frame is dropped and the next one is attempted.
            logger.exception("YOLO inference failed for frame from %s", frame.source)
            return []

        detections: list[PlateDetection] = []
        for result in results:
            boxes = getattr(result, "boxes", None)
            if boxes is None:
                continue
            for box in boxes:
                detections.append(self._to_detection(box))
        return [d for d in detections if d is not None]

    @staticmethod
    def _to_detection(box: Any) -> PlateDetection | None:
        try:
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
            confidence = float(box.conf[0].item())
        except Exception:
            logger.debug("Unreadable YOLO box", exc_info=True)
            return None

        return PlateDetection(
            box=BoundingBox(
                x=int(x1),
                y=int(y1),
                width=max(1, int(x2 - x1)),
                height=max(1, int(y2 - y1)),
            ),
            confidence=confidence,
        )
