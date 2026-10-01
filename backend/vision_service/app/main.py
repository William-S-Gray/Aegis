from __future__ import annotations

import argparse
import contextvars
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
    if settings.detector == "onnx":
        from app.detectors.plate_onnx import OnnxPlateDetector

        detector = OnnxPlateDetector(
            model=settings.detector_model,
            confidence_threshold=settings.detector_confidence,
            device=settings.device,
        )
    else:
        logger.warning(
            "Using the STUB detector — output is synthetic and must never be "
            "treated as a real plate read."
        )
        detector = StubPlateDetector()

    if settings.reader == "onnx":
        from app.ocr.fast_plate import FastPlateReader

        reader: PlateReader = FastPlateReader(model=settings.reader_model, device=settings.device)
    else:
        # The stub reader is paired with the stub detector by construction.
        reader = StubPlateReader(detector if isinstance(detector, StubPlateDetector) else StubPlateDetector())

    return detector, reader


def build_vehicle_classifier(settings: VisionSettings):
    """Coarse vehicle type for real detections; the stub supplies its own."""
    if settings.detector != "onnx" or not settings.vehicle_model:
        return None
    from app.detectors.vehicle_onnx import OnnxVehicleClassifier

    return OnnxVehicleClassifier(model=settings.vehicle_model, device=settings.device)


def build_source(uri: str, settings: VisionSettings):
    if uri.startswith(("rtsp://", "http://", "https://", "/dev/video")) or uri.endswith(
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
        vehicle_classifier = build_vehicle_classifier(settings)
        preview = Preview(client, settings.preview_interval_seconds)

        run_id = uuid.uuid4().hex[:12]
        run_id_var.set(run_id)

        # One thread per camera: a live stream never ends, so reading sources
        # in turn meant only the first camera was ever processed. Each camera
        # has its own pipeline (confirmation, de-duplication, counters); the
        # models, API client and preview are shared and thread-safe.
        pipelines = {
            uri: Pipeline(
                detector,
                reader,
                client,
                site_id=settings.site_id,
                min_publish_confidence=settings.min_publish_confidence,
                dedupe_window_seconds=settings.dedupe_window_seconds,
                confirm_frames=settings.confirm_frames,
                confirm_window_frames=settings.confirm_window_frames,
                vehicle_classifier=vehicle_classifier,
            )
            for uri in sources
        }
        threads = [
            # copy_context: each thread keeps the run id in its log lines.
            threading.Thread(
                target=contextvars.copy_context().run,
                args=(_capture, uri, settings, pipeline, preview, once),
                name=f"camera-{index}",
                daemon=True,
            )
            for index, (uri, pipeline) in enumerate(pipelines.items())
        ]
        for thread in threads:
            thread.start()
        # Joined with a timeout so the main thread keeps handling SIGTERM.
        while any(thread.is_alive() for thread in threads):
            for thread in threads:
                thread.join(timeout=0.5)

        stats: dict[str, int] = {}
        for pipeline in pipelines.values():
            for key, value in pipeline.stats.as_dict().items():
                stats[key] = stats.get(key, 0) + value
        # Emitted as structured fields, not an interpolated string, so a log
        # aggregator can chart the accept/review/discard split over time.
        logger.info("Capture run finished", extra={"stats": stats, **stats})

        if settings.stats_path:
            _write_stats(settings.stats_path, run_id, stats)

    return 0


def _capture(uri: str, settings: VisionSettings, pipeline: Pipeline, preview: Preview, once: bool) -> None:
    """Read one camera until it ends or the service stops."""
    source_var.set(uri)
    logger.info("Processing source", extra={"uri": uri})
    try:
        for frame in build_source(uri, settings).frames():
            if _stop.is_set():
                break
            pipeline.process(frame)
            preview.offer(uri, frame.image)
            if once:
                break
    except Exception:
        # One failing camera must not take the others down with it.
        logger.exception("Source failed", extra={"uri": uri})


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
