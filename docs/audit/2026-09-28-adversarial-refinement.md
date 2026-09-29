# Aegis — Adversarial Audit and Remediation

Date: 2026-09-28 · Audited: `main@11ed97b` · Remediated on branch `hardening/adversarial-audit`

This is the resolution record. For each finding it gives the fix and the test
that now guards it, followed by the weaknesses found while attacking the fixes
themselves and the risk that remains.

## Method and limits

- **Read:** every backend, vision, configuration, CI, compose, and monitoring file, plus the
  frontend's auth, API client, offline queue, guard console, review queue, user portal,
  nginx, and build config (about 80 of 170 tracked files).
- **Not read:** `AdminDashboard.tsx`, `AdminAnalytics.jsx`, `AdminAttributeRules.jsx`,
  `GuardAlertHistory.jsx`, `Home/Login/NotFound/Unauthorized.tsx`, `App.tsx`,
  `Navbar.tsx`, `ErrorBoundary.tsx`, `docs/dpia.md`, `docs/operations.md`,
  `scripts/restore.sh`, `scripts/verify-backup.sh`, `tools/seed_loadtest.py`. A finding
  absent from these files means they were not examined, not that they are clean.
- **Verified by execution:**
  - API suite on SQLite: 231 passed. On PostgreSQL 16 + Redis 7: 252 passed.
  - Vision: 36 passed. Frontend: 73 passed, plus lint, typecheck, and build.
  - Migrations upgrade, `alembic check`, downgrade to base, and re-upgrade on PostgreSQL.
  - Built API and frontend images: non-root user, response headers, CSP, and
    startup refusal of unsafe configuration.
- **Not verified:** a browser session against the running stack, and a real camera with
  the YOLO/Tesseract stack.

## Stack, in one paragraph

A FastAPI + SQLAlchemy API runs on PostgreSQL, with Redis for login throttling and
WebSocket tickets. The vision worker publishes detections using a `service`-role account.
The frontend is a React 19 + Chakra single-page app, served by nginx, with a Dexie
offline queue. Deployment is Docker Compose, CI is GitHub Actions, and Prometheus,
Alertmanager, and Grafana handle monitoring. Authentication uses 15-minute JWT access
tokens with rotating 7-day refresh tokens. There are four roles: admin, guard, user,
and service.

---

## Findings and resolutions

Status legend: **Fixed** (the fix is in the branch and a test guards it), **Mitigated**
(the risk is reduced and the rest is recorded in the risk register), **Open** (not
changed; see the risk register).

### Critical

| ID | Where | Issue | Resolution | Guarded by |
|---|---|---|---|---|
| F-001 | `core/deps.py` `client_ip` | The client address came from a header any caller can set, so the login throttle could be sidestepped and audit IPs were unreliable | **Fixed.** Uses the TCP peer only. uvicorn applies `X-Forwarded-For` only from `FORWARDED_ALLOW_IPS` (compose default `127.0.0.1`) | `test_hardening.py::TestLoginThrottle` (two tests) |
| F-019 | `GuardDashboard.tsx` | "Emergency Protocol" reported *activated* but did nothing. Report, Settings and Refresh were also fakes | **Fixed.** All removed. The console offers no control that pretends to act | `GuardDashboard.test.tsx::offers no controls that pretend to act` |

### High

| ID | Where | Issue | Resolution | Guarded by |
|---|---|---|---|---|
| F-002 | `auth.py`, `throttle.py` | Check-then-increment race: concurrent attempts all passed | **Fixed.** `LoginThrottle.attempt()` increments and compares atomically, before the password check | `test_store.py::test_parallel_attempts_cannot_exceed_the_limit` |
| F-003 | `auth.py` | The only limit was per (email, address); nothing capped one address across many accounts | **Fixed.** Adds a per-address limit (`LOGIN_IP_MAX_ATTEMPTS`, default 100 per 5 min) | `test_one_address_cannot_spray_many_accounts` |
| F-005 | `realtime.py` | A deactivated or demoted user kept the live alert stream | **Fixed.** Re-checks the account every 25 s on a clock, and closes with 1008 | `test_a_deactivated_guard_is_disconnected` |
| F-006 | `AuthContext.tsx`, nginx | Tokens in localStorage with no CSP | **Mitigated.** A strict CSP is generated from the runtime origins (`script-src 'self'`). Tokens remain in localStorage (R-002) | CI step "Frontend serves security headers on app routes" |
| F-009 | `api/index.ts` | No token refresh: users were sent to the login page every 15 min, losing decisions made at that moment | **Fixed.** Single-flight refresh with retry, safe across tabs, and full sign-out on failure | `api.test.ts` "token refresh" (4 tests) |
| F-013 | `docker-compose.yml` | The vision service defaulted to `development`, which let the stub run against production | **Fixed.** Defaults to `production`, and the API also refuses stub detections outside development | CI "Compose defaults are production"; `test_the_stub_is_refused_outside_development` |
| F-017 | `alerts.py` | A deactivated vehicle still showed as "Matches register" | **Fixed.** `_registered_vehicle()` only matches active vehicles | `test_a_deactivated_vehicle_is_not_a_match` |
| F-018 | `GuardDashboard.tsx` | A new alert replaced the one on screen, so Approve could apply to the wrong vehicle | **Fixed.** Alerts wait in a FIFO. A decision is bound to the head of the queue and carries `alert_id` | `an alert arriving mid-decision does not change which vehicle is approved` |
| F-020 | `GuardDashboard.tsx`, `OfflineSyncService.js` | Server rejections were queued as "offline", and one rejected entry blocked the queue forever | **Fixed.** Only network failures are queued. Permanent rejections are parked with the server's reason | `a decision the server refuses is reported…`; `OfflineSyncService.test.ts` |
| F-021 | `db.ts`, sync | Queued decisions were replayed as whoever was signed in, so they were attributed to the wrong guard | **Fixed.** Entries carry `user_id`, and only the owner's entries sync. Pre-upgrade entries are parked (R-009) | `never replays another guard's decisions` |
| F-027 | `services/privacy.py`, `cli.py` | Erasure matched substrings (erasing one plate altered longer plates), and an input that normalised to nothing matched and rewrote every audit row | **Fixed.** Token-boundary matching; an empty plate is refused in the service and the CLI | `TestErasureBoundaries` (4 tests) |
| F-030 | `ReviewQueue.tsx`, alert model | Plates were "reviewed" without an image, with the machine's guess pre-filled | **Fixed.** Vision sends a JPEG crop (≤ 60 KB). The API stores it deferred and serves it to guards with an audit entry. The review box starts empty | `TestPlateImage` (4 tests); `ReviewQueue.test.tsx` |
| F-032 | vision `client.py` | API errors crashed capture or silently dropped detections, and a refused login caused a crash loop | **Fixed.** Retries only requests that never reached the API (connect errors and 502/503/504), never raises, and backs off 60 s after a refused login | `test_client.py` (4 new tests) |

### Medium

| ID | Where | Issue | Resolution | Guarded by |
|---|---|---|---|---|
| F-004 | `models/audit.py` | An overlong client-supplied address overflowed `String(45)` and caused 500s | **Fixed.** The header is no longer read, and the value is truncated defensively | PG suite run |
| F-007 | `nginx.conf` | Security headers were silently dropped on every page because of `add_header` inheritance | **Fixed.** A shared `security-headers.conf` is included in every block that sets headers | CI header step (checks `/guard`) |
| F-008 | `api/index.ts` | The refresh token survived sign-out on a 401 | **Fixed.** `clearSession()` removes all three keys | `clears every credential…` |
| F-010 | `main.py`, compose | `/metrics` was open on the public port, with a non-constant-time compare | **Fixed.** The server refuses to start outside development without `METRICS_TOKEN`; the compare uses `hmac.compare_digest`; Prometheus scrapes with a token file | Image startup check |
| F-011 | `users.py` | Guards received every account | **Fixed.** Guards see only active admins and guards | `TestRoster` |
| F-012 | vision `main.py`, `config.py` | Guidance told operators to use the guard role | **Fixed.** Guidance now says the service role | — (text) |
| F-022 | sync, `logs.py` | Replays and overlapping sync runs duplicated decisions | **Fixed.** `client_ref` idempotency key (unique), handles concurrent inserts, and allows one sync run at a time | `test_a_replayed_decision_is_recorded_once` |
| F-023 | `resources.py`, `retention.py` | Unbounded client timestamp, which also drove retention | **Fixed.** Must be timezone-aware, ≤ 5 min ahead and ≤ `ACCESS_LOG_MAX_AGE_DAYS` (7) old; retention keys on server `recorded_at` | `test_implausible_timestamps_are_refused`; `test_a_future_dated_decision_is_still_purged` |
| F-024 | `alerts.py` | Any alert's plate could be rewritten repeatedly, with no lock | **Fixed.** Only pending reviews, `SELECT … FOR UPDATE`, 409 otherwise; the frontend drops the row on 409 | `TestReviewIntegrity` |
| F-025 | `alerts.py`, `logs.py` | Plates that normalise to nothing were stored | **Fixed.** A shared `PlateStr` type rejects them | `test_unstorable_plates_are_refused` |
| F-026 | `models/vehicle.py` | Unicode normalisation diverged from the vision service; look-alikes and overflow | **Fixed.** ASCII `[A-Z0-9]`, identical to the vision service; length ≤ 32 after normalisation | same |
| F-028 | `privacy.py`, vision logs | Erasure missed comments and plate images; vision logged plates | **Fixed.** Comments on the subject's alerts are scrubbed, crops cleared, and plates removed from vision logs | `test_comments_…`, `test_the_plate_image_is_erased` |
| F-029 | `logs.py` | A new owner saw the previous owner's history for the plate | **Fixed.** Scoped by `vehicle_id` and `owner_since` (new column, backfilled) | `test_a_new_owner_does_not_see…` |
| F-031 | `alerts.py` | The queue-depth gauge was capped at the page size | **Fixed.** Counted in SQL | `test_the_queue_gauge_counts_beyond_one_page` |
| F-033 | vision `sources.py` | Video files replayed forever; reads could stall with no timeout | **Fixed.** Files end at EOF; open and read timeouts of 10 s | `TestSourceKind` |
| F-034 | `alerts.py` | The service account could skip review by omitting confidence | **Fixed.** Confidence is required for `service` | `test_a_machine_read_must_state_its_confidence` |
| F-035 | `ws_manager.py` | Sequential fan-out without timeouts | **Fixed.** Concurrent sends with 5 s timeouts; dropped sockets are also closed | existing realtime suite |
| F-036 | `realtime.py`, `store.py` | Sync Redis calls on the event loop, with no timeouts | **Fixed.** Ticket redemption runs via `to_thread`; Redis socket timeouts of 2 s | existing suite |
| F-038 | `auth.py` | Unauthenticated callers could grow the audit log without bound | **Fixed.** A throttled address is audited once per window | `test_a_locked_address_is_audited_once` |
| F-039 | `ws_manager.py`, README | The README implied Redis made the API multi-replica safe | **Mitigated.** Docs now require a single replica (R-003) | — |
| F-041 | migration `abd9b123964f` | The downgrade could not run | **Fixed.** Names the FK | CI now runs downgrade to base and back |
| F-043 | frontend `Dockerfile`, CI | nginx ran as root, with a CI exemption for it | **Fixed.** `nginx-unprivileged` (uid 101); exemption removed | CI non-root step |
| F-044 | `vite.config.ts` | The service worker precached `config.js`; runtime cache pattern was dead | **Fixed.** `globIgnores: ['config.js']`; API caching removed | build output check |
| F-049 | `GuardDashboard.tsx` | Fabricated statistics; a 1,530-line component | **Fixed.** Fabricated figures removed (935 lines) | test above |
| F-050 | `UserPortal.tsx` | Crashed on a vehicle with no colour | **Fixed** | `UserPortal.test.tsx` |
| F-051 | `tests/conftest.py` | Tests ran only on SQLite | **Fixed.** `TEST_DATABASE_URL`; CI runs the suite on PostgreSQL + Redis | CI |
| F-052 | tests | No coverage of the highest-risk paths | **Fixed.** Suites grew from 193→231 (API, SQLite), 26→36 (vision), and 58→73 (frontend), including a route-coverage test that fails if any route lacks authentication | `TestEveryRouteIsAuthenticated` |

### Low

| ID | Where | Issue | Resolution |
|---|---|---|---|
| F-014 | `config.py` | Weak or missing `SECRET_KEY` accepted outside production | **Fixed.** At least 32 characters required everywhere except development |
| F-015 | `scripts/backup.sh` | DB password visible in the process list during `pg_dump` | **Fixed** (2026-09-30). `scripts/pg-url.sh` moves the password into `PGPASSWORD` for backup, verify, and restore; restore no longer prints it |
| F-016, F-048 | repo root, `backend/test_camera.py` | Orphan manifests with a vulnerable `xlsx`; a script with a private LAN address | **Fixed.** Deleted |
| F-037 | `analytics.py` | Time-to-resolution computed in Python | **Fixed** (2026-09-30). Averaged in SQL (`extract(epoch)` on PostgreSQL, `julianday` on SQLite); `test_time_to_resolution_is_the_mean_of_closed_alerts` |
| F-040 | `database.py` | No pool, connect, or statement timeouts | **Fixed.** Pool 10+10, `pool_timeout` 10 s, connect 5 s, `statement_timeout` 15 s (0 for the CLI, migrate, and purge) |
| F-042 | `alembic/env.py` | `%` in a DB password broke migrations | **Fixed** |
| F-045 | compose | The CORS default was the API's own origin | **Fixed.** Now `http://localhost:8080` |
| F-046 | requirements | Test tools shipped in production images | **Fixed.** `requirements-dev.txt` split for both services; verified pytest is absent from the image |
| F-047 | `main.py` | No readiness probe | **Fixed.** `/ready` checks the DB (and deliberately not Redis) |
| F-053 | `resources.py` | Unbounded `details` on access logs | **Fixed.** ≤ 8 KB |
| F-054 | `resources.py` | Rule values overflowed `String(60)` | **Fixed** |

Also fixed, found during remediation: `frontend/package-lock.json` did not satisfy
`npm ci` inside `node:22-alpine`, so **the frontend image could not be built on
`main`**. The lockfile was regenerated in that image; only transitive dependencies
changed (`picomatch`, `@types/node`).

---

## Adversarial passes over the fixes

Each fix was attacked again before it was accepted. These are the weaknesses the
passes found, and what changed as a result.

**Pass 1: individual fixes**

| Weakness | Fix it attacked | Outcome |
|---|---|---|
| Re-checking only on idle timeout meant a client that kept sending frames was never re-checked | WS revocation | The check now runs on a monotonic clock regardless of traffic |
| Two tabs refreshing with the same rotating refresh token would sign one tab out | Token refresh | If another tab already stored a newer token, it is reused |
| A socket dropped from the registry stayed open, so the guard looked connected but received nothing | Concurrent fan-out | Failed sockets are also closed, so the client reconnects |
| Retrying after a read timeout or a 500 could duplicate an alert | Vision retries | Only undelivered requests are retried |
| Retrying a refused login at frame rate would lock out the service account | Vision login | 60 s backoff |
| `max_attempts or default` treated `0` as unset, so the documented "0 disables" setting could not work | Throttle | Explicit `None` check, with a test |

**Pass 2: fixes interacting with each other**

| Conflict | Outcome |
|---|---|
| Requiring `METRICS_TOKEN` in `get_settings()` would stop the migrate and purge containers, which never serve `/metrics` | The check moved to the server module only |
| The new 15 s statement timeout would cut off erasure and purge on a large audit table | The CLI sets `statement_timeout = 0`; migrate and purge set `DB_STATEMENT_TIMEOUT_MS=0` |
| `crypto.randomUUID` (the idempotency key) is missing on plain-http LAN consoles, which would crash every decision | `newClientRef()` falls back to `getRandomValues` |
| Plate crops are new personal data | Crops are cleared by erasure and after `RETENTION_CROP_DAYS` (30), deferred from list queries, and viewing one is audited |
| A readiness probe that checked Redis would turn a Redis outage into a total API outage | `/ready` checks only the DB |
| The 7-day replay bound will reject very old queued decisions | They are parked with the reason rather than lost; see R-009 |

**Pass 3: load, a hostile insider, and a new developer**

- **An external dependency is down.** With Redis down, login and WebSocket tickets fail
  closed, and existing sessions and refresh keep working (refresh does not use Redis).
  With the API down, vision retries briefly and then drops detections; capture survives
  (R-006).
- **A hostile guard.** A guard cannot escalate: every admin route requires admin, and the
  route-coverage test enforces authentication on every route. A guard can still see all
  sites (R-008) and raise manual alerts without review, which is by design and audited.
- **A new developer.** A route added without `require_roles` fails CI. A new nginx
  `location` that forgets the include fails the header check. Nothing yet stops blocking
  I/O inside an `async` route (R-014).

**Pass 4: the hardest remaining assumption.** The system treats plate text as vehicle
identity. A cloned plate on a vehicle of the same type and colour is indistinguishable
from the real one, and shows "Matches register". No amount of software hardening
removes this (R-001).

---

## Residual risk register

| ID | Risk | Likelihood / Severity | Why it remains | Partial mitigation | Acceptance rationale |
|---|---|---|---|---|---|
| R-001 | Cloned plates match the register | Medium / Critical | Inherent to plate recognition | Type and colour mismatch checks; human review | Product limitation. It must be stated to customers and in the DPIA, not engineered away |
| R-002 | Tokens in localStorage are readable by any script that bypasses the CSP | Low / High | Moving to httpOnly cookies needs a CSRF design and same-site hosting decisions | Strict `script-src 'self'`; 15-min access tokens; sign-out clears all | Worth doing as its own change; the CSP closes the practical injection paths today |
| R-003 | Alert stream is lost across multiple API replicas | Medium if scaled / High | Needs Redis pub/sub fan-out | Documented single-replica requirement | Compose deploys one replica; one replica handles a site's load comfortably |
| R-004 | Every client behind one NAT shares the per-address login budget; a wrong `FORWARDED_ALLOW_IPS` collapses all clients into one address | Medium / Medium | Address-based limits cannot tell people apart behind NAT | Default 100/5 min; `LOGIN_IP_MAX_ATTEMPTS=0` disables it; documented | Denying spraying outweighs occasional throttling during mass sign-in |
| R-005 | Someone on the same address can lock a colleague's login for 5 min | Low / Low | Any lockout can be triggered by others | The key includes the address, so remote actors cannot lock a user | Standard trade-off |
| R-006 | Detections made during a long API outage are lost | Medium / Medium | No durable on-host buffer | Short retries; the drop is logged and counted | A buffer is a feature with its own retention questions |
| R-007 | No refresh-token reuse detection (token families) | Low / Medium | Needs a family column and a revoke-all path | Rotation; 7-day expiry | Next auth iteration |
| R-008 | Guards see every site's alerts | Medium / Low | No site membership model exists | Audited reads | Single-site deployments are the target today |
| R-009 | Decisions queued before this release are parked, not synced | Certain once / Low | They carry no owner and cannot be attributed honestly | Visible in IndexedDB with a reason | No admin UI yet; drain the queues before upgrading consoles |
| R-010 | The guard console's camera feed (`MEDIA_URL/video_feed`) is unauthenticated | Deployment-dependent / Medium | **Closed 2026-09-30** | The vision service pushes previews to the API; guards fetch them with their session, viewing is audited, and the CSP allows no external image origin | — |
| R-011 | A service account can upload any JPEG, which guards will see | Low / Low | Content cannot be verified | JPEG magic check; size cap; audited | The service host is already trusted to report plates |
| R-012 | Backup script exposes the DB password in `ps` (F-015) | Low / Medium | **Closed 2026-09-30** | Password passed via `PGPASSWORD` | — |
| R-013 | Time-to-resolution analytics are computed in Python (F-037) | Low / Low | **Closed 2026-09-30** | Aggregated in SQL | — |
| R-014 | Blocking I/O can be added to an `async` route unnoticed | Medium / Medium | No lint rule exists for it | Both known cases fixed | Revisit if async routes grow |
| R-015 | Files listed under "Not read" were not audited | — | Scope | — | Audit them before relying on this report for those areas |

---

## Deployment notes

1. **Migration** `c4e1f7a2b9d0` adds `access_logs.client_ref` (unique),
   `ix_access_logs_recorded_at`, `vehicles.owner_since` (backfilled from `created_at`
   for owned vehicles), and `alerts.plate_crop`. Run
   `docker compose --profile tools run --rm migrate`.
2. **New or now-required environment variables:**
   - `METRICS_TOKEN` (required outside development). Also write it to
     `monitoring/metrics-token` for Prometheus.
   - `FORWARDED_ALLOW_IPS` (your reverse proxy).
   - Optional: `LOGIN_IP_MAX_ATTEMPTS`, `ACCESS_LOG_MAX_AGE_DAYS`,
     `RETENTION_CROP_DAYS`, `DB_POOL_SIZE`, `DB_STATEMENT_TIMEOUT_MS`.
3. `SECRET_KEY` must be at least 32 characters in staging and production.
4. Before upgrading guard consoles, let offline queues drain (R-009).
5. The vision service refuses to start without `ENVIRONMENT=development` when using the
   stub.
