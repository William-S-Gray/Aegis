# Aegis — Security Review of Changes Since the Audit

Date: 2026-10-01 · Reviewed: `main@771dfbb` plus PR #11 · Fixed on branch `fix/onnxruntime-telemetry`

This review follows the [adversarial audit of 2026-09-28](2026-09-28-adversarial-refinement.md).
It covers everything merged since (PRs #3 to #11). Most of the new attack
surface is real plate recognition: third-party models and an inference runtime
that now run on every camera host.

## Method and limits

- **Read:** every non-test file changed since `32aef65`: the vision service
  (detectors, reader, vehicle classifier, pipeline, sources, entry point,
  evaluation tool, Dockerfile), alert classification and schemas in the API,
  compose files, the Alertmanager config, and the frontend files that changed.
  Of those, `AdminDashboard.tsx`, `GuardAlertHistory.jsx`, `Navbar.tsx`,
  `Home.tsx` and `App.tsx` were outside the earlier audit.
- **Verified by execution:** network traffic from ONNX Runtime traced with
  `strace` (connections and DNS lookups) before and after the fix. Model
  checksums were checked in a fresh image build.
- **Not read:** `AdminAnalytics.jsx` and `AdminAttributeRules.jsx` (unchanged,
  and outside both reviews).

## Findings

| ID | Where | Finding | Resolution |
|---|---|---|---|
| F-055 | `onnxruntime` 1.30, every camera host | **ONNX Runtime sends Microsoft telemetry by default on Linux.** It writes a hardware device id (`~/Microsoft/DeveloperTools/.onnxruntime/deviceid`) and reports session and run events to `mobile.events.data.microsoft.com`. Traced: 4 to 6 lookups of that host per run. Its own `disable_telemetry_events()` does **not** stop this. The built image already contained a device id, because the build's model step had run with telemetry on. A third party was learning when and how often each camera host runs inference, and this was not in the DPIA. | **Fixed.** `ORT_DISABLE_TELEMETRY=1` is set by the `app` package before ONNX Runtime can be imported, and in the image `ENV`, which also covers the build. Traced after the fix: 0 lookups. Test: `test_onnx_runtime_telemetry_is_off`. |
| F-056 | `vision_service/Dockerfile` | **Models were downloaded with no integrity check.** A replaced model on the release page, or anywhere on the download path, would not crash anything. It would quietly misread plates or never report one in particular, and the confidence gate would pass it. | **Fixed for the shipped models.** The build checks each file against the SHA-256 of the exact model that was measured, and a mismatch fails the build. Residual: a non-default model named in `VISION_*_MODEL` downloads unverified at runtime (R-010). |

## Reviewed and found sound

- **Alert input.** `detected_type` is bounded to 40 characters, so the new
  coarse classes need no new validation. The crop must be base64 JPEG, and the
  review queue only asks for it when `has_crop` is set.
- **Type families (API).** These are compared only when the detection is a
  coarse class, so fine-grained detections keep exact matching and admin
  equivalence rules still apply. By design, a plate moved between a car and a
  van is not flagged, because detectors cannot tell them apart. This is
  documented in the vision README.
- **Multiple cameras.** Each camera thread has its own pipeline state. The API
  client serialises login and token refresh behind a lock. One camera raising
  an error can no longer stop the others.
- **Discord alerting.** The webhook URL is read from a gitignored file mounted
  read-only. It never enters the repository or the compose config.
- **Frontend.** Route guards match the server's role checks. Editing a user
  never sends a password field. The new requests (`/ready`, `/cameras`, the
  recent-alerts load) use the existing authenticated client or public health
  endpoints. There is no raw HTML rendering anywhere in `src/`.
- **Tokens in localStorage.** Unchanged, and already recorded as R-002.

## Residual risk

| ID | Risk | Likelihood / impact | Mitigation today | Next step |
|---|---|---|---|---|
| R-010 | A model named in `VISION_*_MODEL` other than the defaults downloads at runtime without a checksum | Low / High | Only the measured defaults are baked in and verified; changing models is an operator action | Bake any model you switch to into the image, with its hash, rather than downloading at runtime |
| R-011 | Python dependencies are pinned by version, not by hash, across all services | Low / High | Exact version pins; `npm ci` uses a lockfile with integrity hashes | `pip install --require-hashes` from compiled lock files |
