# Aegis — Vehicle Access Management

Role-based vehicle access control with an audited decision trail, live alert
streaming, and a licence-plate recognition pipeline with human review.

## Status

| Component | State |
|---|---|
| API server (FastAPI + PostgreSQL) | Working — auth, RBAC, resources, analytics, audit log |
| Realtime alert streaming | Working — authenticated WebSockets |
| Frontend (React + TypeScript) | Working — admin, guard, user, analytics, plate review |
| Vision pipeline | Working — capture, gating, de-duplication, publishing |
| Plate **detection and reading** | Working, measured on public data — **measure on your cameras** before relying on it |

Plates are found and read by two small ONNX models on a CPU (MIT-licensed,
~11 MB, baked into the image). On public test data they found 96% of plates,
and the confidence gate held back nearly every misread for a human; details in
the [vision README](backend/vision_service/README.md#real-detection). That data
is not your cameras: measure on your own footage with `python -m app.evaluate`
before quoting any accuracy. A deterministic stub remains for development and
is refused outside it.

## Architecture

```
                 ┌───────────────┐
  cameras ─────► │ vision_service│ ── POST /alerts ──────┐
                 └───────────────┘ ── PUT /cameras/…/frame ▼
                                              ┌─────────────┐   WebSocket
  browser ◄──────────── frontend ◄────────────│ api_server  │──────────────► guards
                                              └──────┬──────┘
                                                     │
                                         PostgreSQL ─┴─ Redis
```

- **`backend/api_server`** — FastAPI. Authentication, authorisation, resources,
  analytics, audit log, alert streaming. [README](backend/api_server/README.md)
- **`backend/vision_service`** — capture and plate reading.
  [README](backend/vision_service/README.md)
- **`frontend`** — React + TypeScript + Chakra UI.

PostgreSQL holds the data. Redis holds login throttling and WebSocket tickets
and is **required outside development**.

**Run the API as a single replica.** The live alert stream fans out in-process:
behind several replicas, a guard connected to one never receives alerts raised
on another. Redis makes throttling and tickets replica-safe; it does not make
the alert stream so.

## Run the whole stack

```bash
cp .env.example .env          # set SECRET_KEY (32+ chars), POSTGRES_PASSWORD,
                              # VISION_SERVICE_PASSWORD, METRICS_TOKEN
docker compose up -d --build
docker compose --profile tools run --rm migrate

# First administrator (password is prompted, never a CLI argument)
docker compose exec api python -m app.cli create-user \
  --email admin@example.com --name "Admin" --role admin
```

Frontend on <http://localhost:8080>, API on <http://localhost:8081>.

**Upgrading:** after pulling new code, rebuild everything including the
migration runner, which has its own image, then migrate:

```bash
docker compose up -d --build
docker compose --profile tools run --rm --build migrate
```

Rebuilding only `api` leaves the migration image on the old code, so new
tables are silently not created.

The frontend image reads its API URL at container start rather than at build
time, so one image promotes unchanged from staging to production.

## Local development

```bash
# Dependencies only
cd backend/api_server && docker compose up -d     # PostgreSQL 5435, Redis 6383

# API
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env && .venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000

# Frontend
cd ../../frontend && npm install && npm run dev    # http://localhost:5173
```

## Tests

```bash
cd backend/api_server     && .venv/bin/python -m pytest  # 247 (+21 with PostgreSQL and Redis)
cd backend/vision_service && .venv/bin/python -m pytest  # 64
cd frontend               && npm test                    # 82
```

CI runs all of them plus lint, typecheck, build, a dependency audit, and a
container build on every push — see `.github/workflows/ci.yml`.
`scripts/ci-local.sh` runs the same checks on your machine (~20 minutes), for
when GitHub Actions is unavailable. Setting the repository variable
`CI_RUNNER=self-hosted` runs CI on a self-hosted runner instead of GitHub's,
which uses no Actions minutes; see [docs/operations.md](docs/operations.md#ci-on-a-self-hosted-runner).

## Security posture

- Argon2id password hashing; short-lived access tokens with rotating refresh
  tokens stored only as SHA-256 digests.
- **No credential in browser storage.** The 15-minute access token lives in
  memory. The 7-day refresh token is an httpOnly, Secure, SameSite=Strict
  cookie scoped to `/api/v1/auth`. A cookie-based refresh also needs an
  `X-Aegis-CSRF` header, which a cross-site page cannot send. Scripts and the
  vision service keep body tokens.
- **Authorisation is enforced server-side on every endpoint.** The frontend
  route guard controls rendering only.
- Data is scoped by role, not merely gated: a plain user's queries return only
  their own vehicles and access history.
- WebSockets authenticate with single-use, 30-second tickets, so no bearer
  token ever reaches a URL. Connection identity comes from the ticket, never
  from the path.
- Audit log covers logins, refreshes, resource changes, and **reads of plate
  data** — the GDPR-relevant part.
- Containers run as unprivileged users, the nginx frontend included (CI checks
  every image).
- Login is throttled per account+address and per address, counted atomically
  before the password is checked. The address is the TCP peer unless it is a
  proxy listed in `FORWARDED_ALLOW_IPS`; set that to your reverse proxy, never
  `*`.
- Every page carries a Content-Security-Policy generated from the configured
  API origin, plus frame and sniffing protection.

## Monitoring

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

Prometheus, Alertmanager, and Grafana with a provisioned dashboard and twelve
alert rules, all bound to loopback. Alertmanager sends alerts to Discord
once you save a webhook URL to `monitoring/discord-webhook-url`; send a test
alert before relying on it. See [docs/operations.md](docs/operations.md).

## Operations

Backups, retention, and subject-rights requests are documented in
[docs/operations.md](docs/operations.md). Mounting and connecting gate cameras
is covered in [docs/camera-installation.md](docs/camera-installation.md).

```bash
BACKUP_ENCRYPT_TO=ops@example.com scripts/backup.sh ./backups   # encrypted dump
scripts/verify-backup.sh ./backups/<file>      # prove it restores
python -m app.cli purge --dry-run              # retention preview
python -m app.cli export-subject --plate AB12CD    # access request
python -m app.cli erase-subject --plate AB12CD --confirm AB12CD
```

## Compliance

A drafted DPIA and data map — what personal data the system holds, where it
flows, how long it is kept, and how each risk is controlled — is in
[docs/dpia.md](docs/dpia.md). It is a draft for a DPO to complete; the sections
marked **DECISION** are not engineering questions.

## Before charging a customer

1. **A real detection model.** The long pole. Budget for accuracy work on the
   customer's own footage.
2. **Complete the DPIA** in [docs/dpia.md](docs/dpia.md). It is mandatory here
   under Art 35(3)(c), not optional — the draft records what the system does
   and which risks are already controlled; a DPO settles the rest.
3. **Point the monitoring stack at production** and decide who gets paged.
   The rules and dashboard ship in `monitoring/`; routing alerts to a human is
   a decision only you can make.
4. **Set `BACKUP_ENCRYPT_TO` and `BACKUP_UPLOAD_CMD`**, and store the private
   key somewhere the backup host cannot reach.

Do not quote an accuracy percentage. Quote the pipeline counters: what fraction
is auto-accepted, sent to human review, and discarded as unreadable. That claim
survives contact with a real site.
