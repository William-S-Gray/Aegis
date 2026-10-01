# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- builder
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
