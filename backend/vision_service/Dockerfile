# syntax=docker/dockerfile:1
#
# Includes the real plate detector and reader (ONNX Runtime, ~100 MB, CPU) and
# their models, fetched at build time so a camera host needs no internet. The
# stub is still available for development via VISION_DETECTOR/VISION_READER.

FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

# Installed from the lock: every package, including transitive ones, at an
# exact version with its SHA-256, so a build gets the files that were tested
# and a tampered release fails it. Wheels only: pip does not hash-check what
# it fetches to build from source. See requirements.txt to change a version.
COPY requirements.lock .
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --require-hashes --only-binary :all: -r requirements.lock

FROM python:3.12-slim AS runtime

# ORT_DISABLE_TELEMETRY: no Microsoft telemetry from ONNX Runtime, including
# while the build loads the models; see app/__init__.py.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    ORT_DISABLE_TELEMETRY=1

# OpenCV's shared libraries.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10002 vision

COPY --from=builder /opt/venv /opt/venv

USER vision

# Bake the default models into the vision user's cache, in their own layer so
# a code change does not re-download them (~130 MB, slow from GitHub). Names
# match the VISION_*_MODEL defaults; other models download on first use. The
# libraries download without a timeout, so a stalled connection would hang the
# build forever: fail it after 60 s of silence and retry. Then check each file
# against the exact model that was measured: a swapped model would not crash,
# it would quietly misread or miss plates, so a mismatch fails the build.
RUN for attempt in 1 2 3; do \
      python -c "import socket; socket.setdefaulttimeout(60); \
from open_image_models import create_detector as d; \
from fast_plate_ocr import LicensePlateRecognizer as r; \
d('yolo-v9-t-640-license-plate-end2end'); r('cct-xs-v2-global-model'); d('rf-detr-nano-384-coco')" \
      && break; \
      [ "$attempt" = 3 ] && exit 1; sleep 5; \
    done \
    && cd /home/vision/.cache \
    && printf '%s  %s\n' \
      c3c1026ca7d0585dd88084d68182dd897113712fa734ae1557ca70174440c076 open-image-models/yolo-v9-t-640-license-plate-end2end/yolo-v9-t-640-license-plates-end2end.onnx \
      8031afb5fdc6b4d80462c9d542f1284ebd2cfddf5dbacd62609848d7e2855f44 fast-plate-ocr/cct-xs-v2-global-model/cct_xs_v2_global.onnx \
      0335c74a305173bb6f393efed0fde03cadeaa0b649ed8e19f431016d8232d0a6 fast-plate-ocr/cct-xs-v2-global-model/cct_xs_v2_global_plate_config.yaml \
      fdcdd1c566ed4ab4d3700ca1ce6f03edadfec2a0655432e40e4c2734623feaec open-image-models/rf-detr-nano-384-coco/rf-detr-nano-384-coco.onnx \
      | sha256sum -c -

WORKDIR /app
COPY --chown=vision:vision app ./app

# Long-running capture process; no port is exposed.
CMD ["python", "-m", "app.main"]
