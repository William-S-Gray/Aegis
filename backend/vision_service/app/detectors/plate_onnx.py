from __future__ import annotations

import logging

from app.types import BoundingBox, Frame, PlateDetection

logger = logging.getLogger(__name__)


class OnnxPlateDetector:
    """
    Licence plate detection with open-image-models' YOLOv9 plate models (MIT).

    Runs on ONNX Runtime, CPU by default, with no torch install. The weights
    (~8 MB) are downloaded on first use to ~/.cache/open-image-models; the
    Docker image fetches them at build time so a camera host needs no internet.

    Measured on 882 held-out images with human-drawn boxes (keremberke test
    split), `yolo-v9-t-640-license-plate-end2end` found 96.2% of plates at
    97.4% precision, ~110 ms per frame on a laptop CPU. That set is not your
    cameras: re-measure on your own footage before trusting either number.
    """

    name = "open-image-models"

    def __init__(
        self,
        model: str = "yolo-v9-t-640-license-plate-end2end",
        confidence_threshold: float = 0.4,
        device: str | None = None,
    ):
        try:
            from open_image_models import create_detector  # noqa: PLC0415 - optional dependency
        except ImportError as exc:  # pragma: no cover - depends on install
            raise RuntimeError(
                "open-image-models is not installed. Install the ML extras with "
                "`pip install -r requirements-ml.txt` to use the ONNX detector."
            ) from exc

        self._model = create_detector(
            model, conf_thresh=confidence_threshold, providers=_providers(device)
        )
        self.version = model

    def detect(self, frame: Frame) -> list[PlateDetection]:
        try:
            results = self._model.predict(frame.image)
        except Exception:
            # A detector failure must not take down the capture loop; the
            # frame is dropped and the next one is attempted.
            logger.exception("Plate detection failed for frame from %s", frame.source)
            return []

        detections = []
        for result in results:
            box = result.bounding_box
            detections.append(
                PlateDetection(
                    box=BoundingBox(
                        x=max(0, box.x1),
                        y=max(0, box.y1),
                        width=max(1, box.x2 - box.x1),
                        height=max(1, box.y2 - box.y1),
                    ),
                    confidence=float(result.confidence),
                )
            )
        return detections


def _providers(device: str | None) -> list[str] | None:
    """ONNX Runtime providers for VISION_DEVICE; None lets the library choose."""
    if not device:
        return None
    if device.startswith("cuda"):
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]
