# Installing a gate camera

Where the camera is mounted matters more than any software setting. Testing
Aegis on hand-labelled video ([vision README](../backend/vision_service/README.md#measured-on-video))
found three things:

- **In gate-like scenes, every plate was read** (9 of 9): a car leaving a car
  park, cars approaching, parked cars.
- **Misses came from plates seen for under a second** from a moving camera.
- **Errors came from small plates.** The reader can drop a character from a
  small plate and stay confident, the same way on every frame. That is why
  Aegis sends any plate narrower than **120 pixels** to a guard for review,
  however confident the read.

So the aim is simple: **every plate fills enough of the picture, sharply, for
about a second.**

## 1. Plate size in the image

Aim for each plate to be **200–400 px wide** in the camera image. Under 120 px,
every read goes to manual review. A plate much wider than the frame's centre
third wastes the camera's view, and the vehicle may leave the frame before it
is confirmed.

Work it out from the width of the scene the camera covers *at the point where
plates are read*:

```
plate width in pixels  ≈  plate width (mm) ÷ scene width (mm) × image width (px)
```

For a 1920 px wide (1080p) camera and a 520 mm plate:

| Scene width at the plate | Plate in image | Result |
|---|---|---|
| 2.5 m (one lane, tight) | ~400 px | Ideal |
| 4 m (one lane, comfortable) | ~250 px | Ideal |
| 6 m | ~165 px | Works; little margin |
| 8 m or more (two lanes, wide view) | ~125 px or less | Most reads go to review |

**One camera per lane.** A single wide camera covering two lanes or a whole
car park makes plates too small. Small square plates (motorcycles, two-line
plates) need the narrower end of the table.

To check after mounting, look at a still from the camera with a car in place.
Measure the plate's width in pixels in any image viewer, or run
`python -m app.evaluate` on a few stills (below).

## 2. Position and angle

- **Where:** at the point every vehicle slows or stops: the barrier, the
  ticket machine, the gate. A stopped or slow vehicle gives the 3 of 5 frames
  needed for confirmation, under a second at the default settings.
- **Angle:** keep the camera within about **30°** of facing the plate straight
  on, both sideways and downwards. Steeper angles squash the characters.
- **Height:** 1–1.5 m is ideal. Mounted higher (up to ~3 m, out of reach),
  move the camera further back so the downward angle stays within 30°.
- **Front or rear plates:** front plates face headlights at night, which
  causes glare (section 4). Rear plates avoid that, but the read happens as
  the vehicle leaves. For an entry gate where the guard decides before the
  barrier opens, read the **front** plate and plan the lighting for it.
- **Nothing in the way:** check the view with a barrier arm up and down,
  queued vehicles, and foliage in summer.

## 3. Camera settings

| Setting | Use | Why |
|---|---|---|
| Resolution | 1920×1080 or higher | Plate size (section 1) |
| Stream | The **main** stream over RTSP, H.264 | The low-resolution sub-stream makes plates too small |
| Frame rate | 10–25 fps | Aegis analyses 4 frames a second; more is wasted bandwidth |
| Shutter | **1/500 s or faster** (1/1000 s if vehicles don't stop) | Motion blur is what turns `MCC699` into `WCC699` |
| Focus | Fixed, on the reading point | Autofocus hunts on passing vehicles |
| WDR / backlight | On | Bright sky or headlights behind dark plates |
| Digital zoom, "smart" encoding, heavy noise reduction | **Off** | Each smears plate characters |

A fast shutter darkens the image, so the camera needs light (section 4).

## 4. Night

- **Infrared:** use a camera with built-in IR, or an IR illuminator aimed at the
  reading point. Plates are retro-reflective and show up bright and readable
  under IR, even when the scene is dark.
- **Headlights:** if reading front plates, use a camera with good WDR or a
  dedicated plate-recognition camera. These are designed to expose for the
  plate, not the headlights. Test it at night with a car's headlights on full
  beam.
- **Night is a separate test.** Check reads at night (section 6), not only by
  day.

## 5. Connecting the camera to Aegis

Add the camera's RTSP address to `VISION_SOURCES` in `.env`. Separate several
cameras with commas; each runs in parallel.

```env
VISION_SOURCES=rtsp://aegis:<password>@192.168.10.21:554/Streaming/Channels/101
```

**Entry and exit:** to know who is on site now and how long vehicles stay,
tag each camera with the direction it watches by adding `|entry` or `|exit`:

```env
VISION_SOURCES=rtsp://aegis:<pw>@192.168.10.21:554/s1|entry,rtsp://aegis:<pw>@192.168.10.22:554/s1|exit
```

Untagged cameras still raise alerts, but they do not open or close visits.

The exact path varies by manufacturer; it is in the camera's manual or web
interface. Then start the vision service:

```bash
docker compose --profile vision up -d vision
```

The camera appears in the guard console's **Live Camera Feeds** within a few
seconds, named by its address and path. The password in the address is never
shown to guards or sent to browsers.

**Security:**

- Give the camera its **own user** with view-only rights, not the admin account.
- Put cameras on a **separate network or VLAN** that only the Aegis host can
  reach. Cameras sit at the edge of the site and are often physically
  accessible.
- Change the camera's default password, and turn off any cloud or P2P service
  it ships with.
- The vision service uses a **service-role** account that may only publish
  detections ([vision README](../backend/vision_service/README.md#before-production)).

## 6. Check it before relying on it

1. **Stills:** take 50–100 stills from the camera over a day and a night, of real
   vehicles at the reading point. Write down each plate in a CSV and run:

   ```bash
   docker compose run --rm -v "$PWD/eval:/eval:ro" vision python -m app.evaluate /eval/labels.csv
   ```

   It reports how many plates were auto-accepted (and how many of those were
   wrong), sent to review, or missed. **Auto-accepted but wrong** must be at or
   near zero. If it is not, raise the API's `plate_auto_accept_confidence`.
2. **Watch the review queue for the first week.** Many reviews with the reason
   **"Plate was small in the image"** mean the camera is too far away or too
   wide: narrow its view (section 1). Many with **"Plate read was uncertain"**
   mean blur or lighting: check the shutter and night settings (sections 3–4).
3. **Re-check after any change** to the camera, its position, or the models.

## Checklist

- [ ] One camera per lane, at the point vehicles slow or stop
- [ ] Plates 200–400 px wide in the image (at least 120 px)
- [ ] Within ~30° of straight-on, sideways and downwards
- [ ] Main stream, 1080p+, shutter 1/500 s or faster, fixed focus, WDR on
- [ ] IR at the reading point; tested at night with headlights on
- [ ] Camera has its own view-only user, its own network, no default password, no cloud service
- [ ] `app.evaluate` on day and night stills: no wrong auto-accepts
- [ ] Review queue checked daily for the first week
