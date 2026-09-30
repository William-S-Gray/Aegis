from __future__ import annotations

import logging
from typing import Any

from app.detectors.plate_onnx import _providers
from app.types import PlateReading

logger = logging.getLogger(__name__)


class FastPlateReader:
    """
    Reads plate characters with fast-plate-ocr (MIT), a recogniser trained on
    plates from many countries rather than on documents.

    On 20 human-labelled plates from Argentina, France, Mexico and Portugal,
    `cct-xs-v2-global-model` read 18 exactly, in ~3 ms per plate on CPU.

    Confidence is the *weakest* character's probability, not the average: one
    wrong character makes the whole plate wrong, and an average hides it. On a
    hand-checked sample, wrong reads scored at most ~0.5 on this measure while
    almost every correct read scored above 0.95, so it is what the review gate
    should act on.
    """

    name = "fast-plate-ocr"

    def __init__(self, model: str = "cct-xs-v2-global-model", device: str | None = None):
        try:
            import cv2  # noqa: PLC0415 - optional dependency
            from fast_plate_ocr import LicensePlateRecognizer  # noqa: PLC0415
        except ImportError as exc:  # pragma: no cover - depends on install
            raise RuntimeError(
                "fast-plate-ocr is not installed. Install the ML extras with "
                "`pip install -r requirements-ml.txt` to use this reader."
            ) from exc

        self._cv2 = cv2
        providers = _providers(device)
        self._ocr = LicensePlateRecognizer(model, **({"providers": providers} if providers else {}))
        # Frames come from OpenCV in BGR; the model wants RGB or grayscale.
        self._color = (
            cv2.COLOR_BGR2RGB if self._ocr.config.image_color_mode == "rgb" else cv2.COLOR_BGR2GRAY
        )
        self.version = model

    def read(self, image: Any) -> PlateReading | None:
        if image is None or not getattr(image, "size", 0):
            return None
        try:
            prediction = self._ocr.run_one(
                self._cv2.cvtColor(image, self._color), return_confidence=True
            )
        except Exception:
            logger.exception("Plate OCR failed on a crop")
            return None

        text = prediction.plate
        if not text:
            return None
        probs = prediction.char_probs.ravel()[: len(text)]
        return PlateReading(text=text, confidence=round(float(min(probs)), 3))
