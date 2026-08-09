from __future__ import annotations

import logging
import re
from typing import Any

from app.types import PlateReading

logger = logging.getLogger(__name__)

# Plates are alphanumeric; anything else is OCR noise.
_ALLOWED = re.compile(r"[^A-Z0-9]")

# Characters Tesseract routinely confuses on plates. Applied only when the
# surrounding context makes the intent unambiguous is ideal; here we normalise
# the most common pairs and rely on the confidence gate to catch the rest.
_CONFUSIONS = str.maketrans({"O": "0", "I": "1", "Q": "0", "S": "5", "B": "8", "Z": "2"})


class TesseractPlateReader:
    """
    Reads plate characters with Tesseract.

    Requires the `tesseract-ocr` system package plus `pytesseract`. Tesseract is
    a reasonable starting point and a poor finishing point: it was built for
    documents, not for low-resolution plates at an angle in bad light. Expect to
    replace it with a plate-specific recogniser (or a CRNN trained on your own
    crops) before accuracy is good enough to sell on.
    """

    name = "tesseract"

    # Single uniform block of text, restricted alphabet.
    DEFAULT_CONFIG = "--psm 7 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

    def __init__(self, config: str | None = None, apply_confusions: bool = False):
        try:
            import pytesseract  # noqa: PLC0415 - optional dependency
        except ImportError as exc:  # pragma: no cover - depends on install
            raise RuntimeError(
                "pytesseract is not installed. Install the ML extras with "
                "`pip install -r requirements-ml.txt` and the tesseract-ocr "
                "system package to use this reader."
            ) from exc

        self._pytesseract = pytesseract
        self._config = config or self.DEFAULT_CONFIG
        self._apply_confusions = apply_confusions
        try:
            self.version = str(pytesseract.get_tesseract_version())
        except Exception:  # pragma: no cover - depends on install
            self.version = "unknown"

    def read(self, image: Any) -> PlateReading | None:
        if image is None:
            return None
        try:
            data = self._pytesseract.image_to_data(
                image,
                config=self._config,
                output_type=self._pytesseract.Output.DICT,
            )
        except Exception:
            logger.exception("Tesseract failed to read a plate crop")
            return None

        text, confidence = self._best_line(data)
        if not text:
            return None
        return PlateReading(text=text, confidence=confidence)

    def _best_line(self, data: dict) -> tuple[str, float]:
        """
        Combine word-level results into one plate string.

        Tesseract reports -1 for words it could not score; those are excluded
        from the average so a single unscored fragment cannot drag an otherwise
        confident read below the threshold.
        """
        words: list[str] = []
        scores: list[float] = []

        for raw_text, raw_conf in zip(data.get("text", []), data.get("conf", []), strict=False):
            cleaned = _ALLOWED.sub("", (raw_text or "").upper())
            if not cleaned:
                continue
            words.append(cleaned)
            try:
                score = float(raw_conf)
            except (TypeError, ValueError):
                continue
            if score >= 0:
                scores.append(score / 100.0)

        text = "".join(words)
        if self._apply_confusions:
            text = text.translate(_CONFUSIONS)

        confidence = sum(scores) / len(scores) if scores else 0.0
        return text, round(confidence, 3)
