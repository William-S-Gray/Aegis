# Aegis Vision Service

Reads licence plates from camera frames and publishes them to the Aegis API.

```
frame → detect → read → gate → publish
```

## Status, honestly

The **pipeline is complete and tested**: capture, detection, OCR, confidence
gating, de-duplication, service-account auth, and publishing. The real
detector and reader have been **measured on public data, not on your
cameras**. Plate appearance varies by country, mounting and lighting, so
measure on your own footage (see [Measuring accuracy](#measuring-accuracy))
before trusting any number here.

The detector and reader sit behind protocols (`app/types.py`) with two
implementations each:

| | Stub | Real (`onnx`) |
|---|---|---|
| Detector | `detectors/stub.py` | `detectors/plate_onnx.py`: open-image-models YOLOv9 plate model (MIT) |
| Reader | `detectors/stub.py` | `ocr/fast_plate.py`: fast-plate-ocr, trained on plates from many countries (MIT) |

Both real models run on ONNX Runtime on a CPU, with no torch or GPU needed.
Together they are ~11 MB of weights, and the Docker image bakes them in.

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
.venv/bin/pip install -r requirements-ml.txt      # ~100 MB, CPU
```

```env
VISION_DETECTOR=onnx
VISION_READER=onnx
# Optional; these are the defaults.
VISION_DETECTOR_MODEL=yolo-v9-t-640-license-plate-end2end
VISION_READER_MODEL=cct-xs-v2-global-model
VISION_DEVICE=            # cpu or cuda; empty lets ONNX Runtime choose
```

The models download to `~/.cache` on first use. The Docker image includes
them, and `docker compose --profile vision` uses them by default.

### Measured (September 2026, laptop CPU)

| | Result |
|---|---|
| Detection, 882 held-out images with human-drawn boxes | 96.2% of plates found, 97.4% precision, ~110 ms/frame |
| Reading, 20 human-labelled plates (AR, FR, MX, PT) | 18 exact; both misses fell below auto-accept |
| Reading, 60 hand-checked hard cases (blurred, two-line, small) | 72% exact; wrong reads scored ≤ 0.52 except 2 |
| OCR time | ~3 ms per plate |

Larger models (`yolo-v9-s-608-…`, `cct-s-v2-global-model`) were measured too.
They were 2–10× slower for at most +0.6% recall and no reading gain.

## Tests

```bash
.venv/bin/python -m pytest      # no ML stack required
```

## How gating works

Two thresholds, both server-side in the API (`plate_auto_accept_confidence`,
`plate_review_floor_confidence`):

| Plate confidence | Outcome |
|---|---|
| ≥ 0.85 | Acted on automatically |
| 0.50 – 0.85 | Recorded, flagged `requires_review` → human confirms |
| < 0.50 | Refused; counted as a discard, never stored |

Plate confidence is the reader's confidence in its **weakest character**. One
wrong character makes the whole plate wrong, and an average would hide it.
Detection confidence is not multiplied in, because it scores the box rather
than the characters: on real plates it sat at 0.73–0.93 for right and wrong
reads alike. Multiplying by it capped most correct reads below 0.85, which
sent them to review for nothing. It acts as a floor instead
(`VISION_DETECTOR_CONFIDENCE`, default 0.4), so a box that is not a plate is
never read.

Low vehicle-type confidence also routes to review, so an attribute mismatch is
never raised on a shaky type classification.

## Why the review queue matters commercially

Do not sell an accuracy number. Sell these, from `PipelineStats`:

```
frames  detections  unreadable  below_floor  unconfirmed  deduped  published  rejected_by_api
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

## Vehicle type

A plate on the wrong kind of vehicle is the classic sign of a cloned or moved
plate. With the `onnx` detector, each published vehicle is classified as
**car, truck, bus or motorcycle** (`detectors/vehicle_onnx.py`, RF-DETR COCO,
MIT). This runs once per vehicle, not per frame, because it takes about 0.5 s on a
CPU. The API compares that coarse class against the registered type's
family: a registered sedan, hatchback or SUV is a "car", and a van or pickup
is accepted as either car or truck, because detectors split them both ways. A
car's plate on a truck raises a type mismatch; a sedan's plate on an SUV does
not. Finer types are beyond this model.

In testing, 21 of 21 vehicle types were right, and 7 registered vehicles (including
a van and a pickup) produced no false mismatch. A fire engine registered as a
sedan was flagged. Low type confidence (< 0.60) sends the read to review
rather than raising a mismatch. `VISION_VEHICLE_MODEL=` (empty) turns it off.

**Colour is not detected from real cameras.** A simple colour estimate was right
on only about 7 of 20 vehicles, because shadows, glass and background skew it. It would raise
false colour mismatches. It needs a classifier trained on your own footage;
the plates guards confirm in the review queue are the start of that set.

## Confirmation across frames

One blurred frame can misread a plate with high confidence. In a webcam test,
a plate read correctly in 142 frames was read once as a different plate at
0.92, which the gate alone would have auto-accepted. The true reading
dominates across frames, and a misread doesn't repeat. So a live camera's read
is published only once the same plate appears in `VISION_CONFIRM_FRAMES` (3)
of that camera's last `VISION_CONFIRM_WINDOW_FRAMES` (5) frames. At the
default `VISION_FRAME_INTERVAL_SECONDS` of 0.5, a vehicle must be in view for
about 1.5 s. Reads that never confirm are counted as `unconfirmed`. Still
images (a directory source, `app.evaluate`) are not confirmed, because each is
its own picture.

## De-duplication

A car waiting at a barrier appears in every frame. `VISION_DEDUPE_WINDOW_SECONDS`
(default 30s) collapses repeat sightings so one arrival is one alert.

## Live preview for guards

Each camera's frames are also pushed to the API (`PUT /cameras/{id}/frame`,
service role only), at most once per `VISION_PREVIEW_INTERVAL_SECONDS`
(default 1; 0 turns previews off). The guard console fetches them with the
guard's own session, so cameras are never exposed to browsers and no view is
possible without signing in. The API keeps only the latest frame per camera, in
memory, and audits a guard's viewing once per camera every five minutes.

Previews run at the capture rate: raise it with `VISION_FRAME_INTERVAL_SECONDS`,
which also raises detection load. The camera's name shown to guards is its
host and path; credentials in a stream URL are never sent. Reading RTSP/MJPEG
needs OpenCV (`requirements-ml.txt`; the Docker image includes it).

## Before production

- Replace the stub; the service refuses to run with it outside development.
- Point `VISION_SOURCES` at RTSP/MJPEG cameras (or a USB camera such as
  `/dev/video0`) rather than a directory.
- Give the service account the **`service` role**, never `guard`. A service
  account may publish detections and nothing else — it cannot read the vehicle
  register, list alerts, confirm plates, or record an access decision. Camera
  hosts sit at the network edge and are often physically reachable, so this is
  the account most likely to be compromised.
- Run one process per camera, or add a worker pool — the loop is currently
  sequential across sources.
- Build a labelled evaluation set from your own cameras and measure
  before/after every model change (below).

## Measuring accuracy

Save a few hundred stills from your own cameras, in all lighting, and a CSV of
what a person reads on each:

```csv
file,plate
gate/0001.jpg,AB12 CDE
gate/0002.jpg,KX71 YTR
```

```bash
VISION_DETECTOR=onnx VISION_READER=onnx .venv/bin/python -m app.evaluate labels.csv
# or, in the image:
docker compose run --rm -v "$PWD/eval:/eval:ro" vision python -m app.evaluate /eval/labels.csv
```

It prints each plate's outcome, then the split that matters for running the
gate: auto-accepted (and how many of those were wrong), sent to review,
discarded, or not found. Keep "auto-accepted but wrong" near zero; if it is
not, raise the API's `plate_auto_accept_confidence` rather than trusting a
model you have not measured.
