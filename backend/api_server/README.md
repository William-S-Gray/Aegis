# Aegis API Server

FastAPI + PostgreSQL. Week 1 scope: **authentication only** — login, refresh,
logout, `/me`, server-side RBAC, and an append-only audit log.

## Quick start

```bash
cd backend/api_server

python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt

cp .env.example .env          # then set SECRET_KEY
docker compose up -d          # PostgreSQL on 5435, Redis on 6383
.venv/bin/alembic upgrade head

# Create the first administrator (password is prompted, never a CLI argument)
.venv/bin/python -m app.cli create-user \
  --email admin@example.com --name "Admin" --role admin

.venv/bin/uvicorn app.main:app --reload --port 8000
```

Interactive docs at http://localhost:8000/docs (disabled when
`ENVIRONMENT=production`).

## Tests

```bash
.venv/bin/python -m pytest        # 22 tests, runs on in-memory SQLite
```

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | — | Exchange credentials for tokens |
| `POST` | `/api/v1/auth/refresh` | — | Rotate a refresh token |
| `POST` | `/api/v1/auth/logout` | Bearer | Revoke a refresh token |
| `GET`  | `/api/v1/auth/me` | Bearer | Current user |
| `GET`  | `/health` | — | Liveness probe |

Plus resource routes (`/users`, `/vehicles`, `/sites`, `/logs`, `/access-logs`,
`/alerts`, `/attribute-mismatch-rules`, `/analytics/*`), the alert stream
(`/ws/guard-alerts/{id}` + `/auth/ws-ticket`), and the plate review queue
(`GET /alerts/review-queue`, `POST /alerts/{id}/confirm-plate`).

`POST /auth/login` returns:

```json
{
  "access_token": "…",
  "refresh_token": "…",
  "token_type": "bearer",
  "user": { "id": "uuid", "email": "…", "full_name": "…", "role": "admin", "is_active": true }
}
```

## Security decisions

- **Argon2id** password hashing, with transparent rehash when parameters change.
- **Short-lived access tokens** (15 min) plus **rotating refresh tokens** (7 days).
  Refresh tokens are stored only as SHA-256 digests, so a database leak yields
  no usable tokens. Presenting a rotated token fails.
- **Uniform failure responses.** Wrong password, unknown account, and
  deactivated account are indistinguishable, and a dummy hash verification runs
  on unknown emails so response timing does not leak account existence.
- **Login throttling** per email+IP, backed by the shared store. Checking
  whether you are locked out is a pure read, so polling cannot extend your own
  lockout.
- **Token type is enforced**: a refresh token presented as a bearer token is
  rejected.
- **Deactivating a user invalidates their session** on the next request, because
  the user is loaded and checked on every authenticated call.
- **Audit log** records login success/failure, refresh, and logout with IP and
  user agent. Credentials are never written to it.

## Observability

- **Structured JSON logs on stdout**, one object per line. Every line carries
  `request_id`, and authenticated requests also carry `actor_id` and
  `actor_role`.
- `X-Request-ID` is accepted from an upstream proxy and echoed on the response,
  so a trace spans the whole path and a user can quote the id from an error.
- **Credentials are redacted** by field name before serialisation. A password
  reaching stdout is a password in your log aggregator.
- **`GET /metrics`** exposes Prometheus text. Metrics are labelled by route
  *template*, never raw path — labelling by raw path would mint a series per
  UUID and take the metrics backend down.
- Domain metrics worth alerting on: `aegis_login_attempts_total{outcome}`,
  `aegis_alerts_created_total{mismatch_type,requires_review}`,
  `aegis_plate_confirmations_total{outcome}` (corrected vs unchanged is the
  detector's measured error rate), and `aegis_review_queue_depth`.
- Unhandled exceptions are logged with a traceback and return a generic 500
  carrying the request id — the traceback never reaches the caller.

## Authorization

`ProtectedRoute` in the frontend only decides what to render. Every protected
endpoint must depend on `require_roles(...)`:

```python
from app.core.deps import require_admin

@router.get("/users")
def list_users(current_user: User = Depends(require_admin)):
    ...
```

## Roles

| Role | May do |
|---|---|
| `admin` | Everything: users, vehicles, sites, rules, analytics |
| `guard` | Alerts, review queue, access decisions, the alert stream |
| `user` | Read only their own vehicles and access history |
| `service` | **Publish detections and nothing else** — for the vision service |

`service` is deliberately the narrowest role and has its own dependency
(`require_alert_publisher`) rather than being added to `require_guard`, so
widening it later has to be a conscious edit.

## Before production

- Set a real `SECRET_KEY`; the app refuses to boot without one when
  `ENVIRONMENT=production`.
- Terminate TLS in front of the API and set `FORWARDED_ALLOW_IPS` to the
  proxy's address. The app never reads `X-Forwarded-For` itself; uvicorn
  honours it only from those addresses.
- Set `METRICS_TOKEN` (32+ random characters); the server refuses to start
  without it outside development.
- Run a single API replica (the alert stream is in-process).
- Set `REDIS_URL`. The app refuses to start without it outside development,
  because a per-process rate limiter behind a load balancer protects nothing.
- Schedule `python -m app.cli purge` (retention, including plate images after
  `RETENTION_CROP_DAYS`, default 30).
