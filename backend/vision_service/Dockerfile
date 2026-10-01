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

COPY requirements.txt requirements-ml.txt ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install -r requirements.txt -r requirements-ml.txt

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

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
# build forever: fail it after 60 s of silence and retry.
RUN for attempt in 1 2 3; do \
      python -c "import socket; socket.setdefaulttimeout(60); \
from open_image_models import create_detector as d; \
from fast_plate_ocr import LicensePlateRecognizer as r; \
d('yolo-v9-t-640-license-plate-end2end'); r('cct-xs-v2-global-model'); d('rf-detr-nano-384-coco')" \
      && break; \
      [ "$attempt" = 3 ] && exit 1; sleep 5; \
    done

WORKDIR /app
COPY --chown=vision:vision app ./app

# Long-running capture process; no port is exposed.
CMD ["python", "-m", "app.main"]
