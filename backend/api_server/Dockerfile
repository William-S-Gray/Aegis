# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- builder
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

# argon2-cffi and psycopg need a compiler; the toolchain stays in this stage
# and never reaches the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install -r requirements.txt

# ---------------------------------------------------------------- runtime
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/* \
    # Run as an unprivileged user: a container escape should not start as root.
    && useradd --create-home --uid 10001 aegis

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY --chown=aegis:aegis alembic.ini ./
COPY --chown=aegis:aegis alembic ./alembic
COPY --chown=aegis:aegis app ./app

USER aegis
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# Migrations are deliberately NOT run here: with several replicas they would
# race. Run `alembic upgrade head` as a separate deploy step.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
