# Aegis Vision Service

Reads licence plates from camera frames and publishes them to the Aegis API.

```
frame → detect → read → gate → publish
```

## Status, honestly

The **pipeline is complete and tested**: capture, detection, OCR, confidence
gating, de-duplication, service-account auth, and publishing. What is *not*
done is the part that takes months — a detector accurate enough on your
cameras, in your lighting, with your plate formats.

The detector and reader sit behind protocols (`app/types.py`) with two
implementations each:

| | Stub | Real |
|---|---|---|
| Detector | `detectors/stub.py` | `detectors/yolo.py` (Ultralytics) |
| Reader | `detectors/stub.py` | `ocr/tesseract.py` |

The stub is deterministic, needs no ML stack, and exists so the pipeline and
its integration with the API can be tested. **It fabricates plates.**
`get_settings()` refuses to start with a stub when `VISION_ENVIRONMENT` is not
`development`.

## Quick start (stub, no ML stack)

```bash
cd backend/vision_service
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt

cp .env.example .env      # set VISION_SERVICE_PASSWORD

# Create the service account against a running API:
#   cd ../api_server && .venv/bin/python -m app.cli create-user \
#     --email vision@aegis.example --name "Vision Service" --role service

.venv/bin/python -m app.main
```

## Real detection

```bash
sudo apt install tesseract-ocr
.venv/bin/pip install -r requirements-ml.txt      # ~3 GB
```

```env
VISION_DETECTOR=yolo
VISION_READER=tesseract
VISION_MODEL_PATH=/path/to/plate-weights.pt
VISION_DEVICE=cuda:0
```

**Stock YOLO weights detect cars, not plates.** You need plate-specific
weights. Public plate datasets get you a demo; production accuracy will almost
certainly require fine-tuning on footage from the actual cameras.

## Tests

```bash
.venv/bin/python -m pytest      # 26 tests, no ML stack required
```

## How gating works

Two thresholds, both server-side in the API (`plate_auto_accept_confidence`,
`plate_review_floor_confidence`):

| Combined confidence | Outcome |
|---|---|
| ≥ 0.85 | Acted on automatically |
| 0.50 – 0.85 | Recorded, flagged `requires_review` → human confirms |
| < 0.50 | Refused; counted as a discard, never stored |

Combined confidence is `detection × reading` — a crisp box around unreadable
characters is not a good read.

Low vehicle-type confidence also routes to review, so an attribute mismatch is
never raised on a shaky type classification.

## Why the review queue matters commercially

Do not sell an accuracy number. Sell these, from `PipelineStats`:

```
frames  detections  unreadable  below_floor  deduped  published  rejected_by_api
```

"We auto-accept X%, route Y% to a human, and discard Z% as unreadable" is a
claim that survives contact with a customer's site. "99% accurate" does not.

Every alert carries `detector_name` and `detector_version`, so accuracy can be
attributed to a specific model and compared across versions — which is what
makes the tuning work measurable rather than anecdotal.

When a human corrects a plate, `POST /alerts/{id}/confirm-plate`
**re-classifies it against the register**, because a misread is exactly the
case where an "unregistered" verdict was wrong. Both the machine reading and
the human's are written to the audit log — that record is your training set for
the next model.

## De-duplication

A car waiting at a barrier appears in every frame. `VISION_DEDUPE_WINDOW_SECONDS`
(default 30s) collapses repeat sightings so one arrival is one alert.

## Before production

- Replace the stub; the service refuses to run with it outside development.
- Point `VISION_SOURCES` at RTSP/MJPEG cameras rather than a directory.
- Give the service account the **`service` role**, never `guard`. A service
  account may publish detections and nothing else — it cannot read the vehicle
  register, list alerts, confirm plates, or record an access decision. Camera
  hosts sit at the network edge and are often physically reachable, so this is
  the account most likely to be compromised.
- Run one process per camera, or add a worker pool — the loop is currently
  sequential across sources.
- Build a labelled evaluation set and measure before/after on every model
  change. `ImageDirectorySource` exists for exactly this.
