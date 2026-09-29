from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
from types import FrameType

import json
import uuid
from pathlib import Path

from app.client import AegisClient
from app.config import VisionSettings, get_settings
from app.detectors.stub import StubPlateDetector, StubPlateReader
from app.logging_config import configure_logging, run_id_var, source_var
from app.pipeline import Pipeline
from app.preview import Preview
from app.sources import ImageDirectorySource, VideoSource
from app.types import PlateDetector, PlateReader

logger = logging.getLogger("aegis.vision")

_stop = threading.Event()


def _handle_signal(signum: int, _frame: FrameType | None) -> None:
    logger.info("Received signal %s; finishing the current frame and stopping", signum)
    _stop.set()


def build_detector(settings: VisionSettings) -> tuple[PlateDetector, PlateReader]:
    if settings.detector == "yolo":
        from app.detectors.yolo import YoloPlateDetector

        if not settings.model_path:
            raise RuntimeError("VISION_MODEL_PATH must be set when using the YOLO detector")
        detector = YoloPlateDetector(
            model_path=settings.model_path,
            confidence_threshold=settings.detector_confidence,
            device=settings.device,
        )
    else:
        logger.warning(
            "Using the STUB detector — output is synthetic and must never be "
            "treated as a real plate read."
        )
        detector = StubPlateDetector()

    if settings.reader == "tesseract":
        from app.ocr.tesseract import TesseractPlateReader

        reader: PlateReader = TesseractPlateReader()
    else:
        # The stub reader is paired with the stub detector by construction.
        reader = StubPlateReader(detector if isinstance(detector, StubPlateDetector) else StubPlateDetector())

    return detector, reader


def build_source(uri: str, settings: VisionSettings):
    if uri.startswith(("rtsp://", "http://", "https://")) or uri.endswith(
        (".mp4", ".avi", ".mkv")
    ):
        return VideoSource(
            uri,
            site_id=settings.site_id,
            frame_interval_seconds=settings.frame_interval_seconds,
            stop=_stop,
        )
    return ImageDirectorySource(uri, site_id=settings.site_id)


def run(settings: VisionSettings, once: bool = False) -> int:
    detector, reader = build_detector(settings)

    if not settings.service_email or not settings.service_password:
        logger.error(
            "VISION_SERVICE_EMAIL and VISION_SERVICE_PASSWORD must be set. "
            "Create a dedicated service-role account for this service: "
            "python -m app.cli create-user --role service (never --role guard)."
        )
        return 1

    sources = settings.source_list
    if not sources:
        logger.error("VISION_SOURCES is empty; nothing to process")
        return 1

    with AegisClient(
        base_url=settings.api_url,
        email=settings.service_email,
        password=settings.service_password,
    ) as client:
        pipeline = Pipeline(
            detector,
            reader,
            client,
            site_id=settings.site_id,
            min_publish_confidence=settings.min_publish_confidence,
            dedupe_window_seconds=settings.dedupe_window_seconds,
        )

        preview = Preview(client, settings.preview_interval_seconds)

        run_id = uuid.uuid4().hex[:12]
        run_id_var.set(run_id)

        for uri in sources:
            source_var.set(uri)
            logger.info("Processing source", extra={"uri": uri})
            for frame in build_source(uri, settings).frames():
                if _stop.is_set():
                    break
                pipeline.process(frame)
                preview.offer(uri, frame.image)
                if once:
                    break
            if _stop.is_set() or once:
                break

        stats = pipeline.stats.as_dict()
        # Emitted as structured fields, not an interpolated string, so a log
        # aggregator can chart the accept/review/discard split over time.
        logger.info("Capture run finished", extra={"stats": stats, **stats})

        if settings.stats_path:
            _write_stats(settings.stats_path, run_id, stats)

    return 0


def _write_stats(path: str, run_id: str, stats: dict) -> None:
    """Persist run counters for a metrics sidecar to pick up."""
    try:
        Path(path).write_text(
            json.dumps({"run_id": run_id, **stats}), encoding="utf-8"
        )
    except OSError:
        logger.warning("Could not write stats to %s", path, exc_info=True)


def main() -> int:
    parser = argparse.ArgumentParser(prog="aegis-vision")
    parser.add_argument(
        "--once", action="store_true", help="Process a single frame per source and exit"
    )
    parser.add_argument("--log-level", default="")
    args = parser.parse_args()

    settings = get_settings()
    configure_logging(
        level=args.log_level or settings.log_level, json_output=settings.log_json
    )
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    return run(settings, once=args.once)


if __name__ == "__main__":
    sys.exit(main())
