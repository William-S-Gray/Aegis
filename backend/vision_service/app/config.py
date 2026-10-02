from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class VisionSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", env_prefix="VISION_"
    )

    environment: Literal["development", "staging", "production"] = "development"

    # ---- API integration ------------------------------------------------
    api_url: str = "http://localhost:8000/api/v1"
    # Dedicated account with the `service` role, which may publish detections
    # and nothing else: a leaked camera credential cannot read the register,
    # confirm plates, or record access decisions.
    service_email: str = ""
    service_password: str = ""
    site_id: str | None = None

    # ---- Detector selection ---------------------------------------------
    # Defaults to the stub so an unconfigured deployment produces obviously
    # fake output rather than plausible-looking fabricated plates.
    detector: Literal["stub", "onnx"] = "stub"
    reader: Literal["stub", "onnx"] = "stub"

    # Model names from open-image-models and fast-plate-ocr. The defaults were
    # the best speed/accuracy trade-off measured; see the README.
    detector_model: str = "yolo-v9-t-640-license-plate-end2end"
    reader_model: str = "cct-xs-v2-global-model"
    # "cpu" or "cuda"; empty lets ONNX Runtime pick.
    device: str | None = None
    # Boxes below this are not plates. Measured, 0.4 drops under 1% of reads.
    detector_confidence: float = 0.4
    # Coarse vehicle type (car/truck/bus/motorcycle) for the onnx detector,
    # classified once per published vehicle; empty turns it off.
    vehicle_model: str = "rf-detr-nano-384-coco"

    # ---- Observability ---
    log_level: str = "INFO"
    log_json: bool = True
    # Written after each source completes, for scraping by a sidecar or for
    # shipping straight to a log aggregator.
    stats_path: str = ""

    # ---- Capture --------------------------------------------------------
    sources: str = ""
    frame_interval_seconds: float = 0.25
    # How often each camera's live preview is pushed to the guard console;
    # 0 turns previews off.
    preview_interval_seconds: float = 1.0

    # A plate seen repeatedly in consecutive frames is one event, not many.
    dedupe_window_seconds: float = 30.0

    # A live read is published once the same plate is read in this many of the
    # camera's last `confirm_window_frames` frames; 1 turns this off. At the
    # default frame interval that is under a second of the vehicle in view.
    confirm_frames: int = 3
    confirm_window_frames: int = 5

    # Reads below this are dropped locally without troubling the API. The API
    # enforces its own floor as well; this one just saves a round trip.
    min_publish_confidence: float = 0.50

    @property
    def source_list(self) -> list[str]:
        return [s.strip() for s in self.sources.split(",") if s.strip()]

    @property
    def is_stub(self) -> bool:
        return self.detector == "stub" or self.reader == "stub"


@lru_cache
def get_settings() -> VisionSettings:
    settings = VisionSettings()
    if settings.environment != "development" and settings.is_stub:
        raise RuntimeError(
            "The stub detector/reader must never run outside development. "
            "Set VISION_DETECTOR=onnx and VISION_READER=onnx before deploying."
        )
    return settings
