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

WORKDIR /app
COPY --chown=vision:vision app ./app

USER vision

# Bake the default models into the vision user's cache. Other models named via
# VISION_DETECTOR_MODEL / VISION_READER_MODEL download on first use.
RUN python -c "from app.detectors.plate_onnx import OnnxPlateDetector as D; from app.ocr.fast_plate import FastPlateReader as R; D(); R()"

# Long-running capture process; no port is exposed.
CMD ["python", "-m", "app.main"]
