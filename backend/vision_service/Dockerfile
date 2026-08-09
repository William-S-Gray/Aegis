# syntax=docker/dockerfile:1
#
# Build the ML variant with:
#     docker build --build-arg INCLUDE_ML=true -t aegis-vision:ml .
# That adds ~3 GB (torch, ultralytics, opencv) and is only needed for the real
# detector; the default image runs the pipeline with the stub.

FROM python:3.12-slim AS builder

ARG INCLUDE_ML=false

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-ml.txt ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install -r requirements.txt \
    && if [ "$INCLUDE_ML" = "true" ]; then \
         /opt/venv/bin/pip install -r requirements-ml.txt; \
       fi

FROM python:3.12-slim AS runtime

ARG INCLUDE_ML=false

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

# tesseract and the OpenCV shared libraries are only pulled in for the ML build.
RUN apt-get update \
    && if [ "$INCLUDE_ML" = "true" ]; then \
         apt-get install -y --no-install-recommends tesseract-ocr libgl1 libglib2.0-0; \
       fi \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10002 vision

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY --chown=vision:vision app ./app

USER vision

# Long-running capture process; no port is exposed.
CMD ["python", "-m", "app.main"]
