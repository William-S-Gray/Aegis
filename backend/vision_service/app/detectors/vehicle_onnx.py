from __future__ import annotations

import logging
from typing import Any

from app.detectors.plate_onnx import _providers
from app.types import BoundingBox

logger = logging.getLogger(__name__)

# COCO classes that are vehicles a plate can belong to. The API compares these
# coarse classes against the registered type's family (a registered "suv" is a
# "car"), so only a plate on the wrong class of vehicle raises a mismatch.
VEHICLE_CLASSES = {"car", "truck", "bus", "motorcycle"}


class OnnxVehicleClassifier:
    """
    Coarse vehicle type (car / truck / bus / motorcycle) for a plate, from
    open-image-models' RF-DETR COCO detector (MIT, ONNX, CPU).

    Measured on 20 hand-labelled vehicles: every car, SUV and hatchback was
    "car"; trucks were "truck". Vans and pickups were "car" too, so the API
    accepts either class for them. Finer types (sedan vs SUV) are beyond it.

    ~0.5 s per image on a laptop CPU, so the pipeline runs it once per
    published vehicle, not on every frame.
    """

    name = "rf-detr-coco"

    def __init__(self, model: str = "rf-detr-nano-384-coco", device: str | None = None):
        try:
            from open_image_models import create_detector  # noqa: PLC0415 - optional dependency
        except ImportError as exc:  # pragma: no cover - depends on install
            raise RuntimeError(
                "open-image-models is not installed. Install the ML extras with "
                "`pip install -r requirements-ml.txt` to classify vehicle types."
            ) from exc

        self._model = create_detector(model, conf_thresh=0.3, providers=_providers(device))
        self.version = model

    def classify(self, image: Any, plate: BoundingBox) -> tuple[str, float] | None:
        """The class of the vehicle carrying this plate, with its confidence."""
        try:
            results = self._model.predict(image)
        except Exception:
            logger.exception("Vehicle classification failed")
            return None
        owner = owning_vehicle(
            plate,
            [
                (r.label, float(r.confidence), (r.bounding_box.x1, r.bounding_box.y1, r.bounding_box.x2, r.bounding_box.y2))
                for r in results
                if r.label in VEHICLE_CLASSES
            ],
        )
        return (owner[0], round(owner[1], 3)) if owner else None


def owning_vehicle(
    plate: BoundingBox, vehicles: list[tuple[str, float, tuple[int, int, int, int]]]
) -> tuple[str, float] | None:
    """
    The vehicle a plate is mounted on: the smallest box that holds the plate's
    centre in its lower part. Smallest, because overlapping vehicles (a car on
    a transporter, a trailer behind a cab) produce nested boxes; lower part,
    because plates are mounted low, so a transporter cab's box does not claim
    the plate of a car loaded above it.
    """
    cx = plate.x + plate.width / 2
    cy = plate.y + plate.height / 2
    candidates = [
        (label, confidence, (x2 - x1) * (y2 - y1))
        for label, confidence, (x1, y1, x2, y2) in vehicles
        if x1 <= cx <= x2 and y1 + 0.4 * (y2 - y1) <= cy <= y2
    ]
    if not candidates:
        return None
    label, confidence, _ = min(candidates, key=lambda c: c[2])
    return label, confidence
