import threading

import pytest

import app.main as main
from app.config import VisionSettings
from app.types import Frame


class FakeClient:
    def __init__(self, **_kwargs):
        self.alerts = []

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return None

    def create_alert(self, payload):
        self.alerts.append(payload)
        return {"id": str(len(self.alerts))}

    def put_frame(self, *_args):
        return True


class EndlessCamera:
    """A live stream: yields frames until the service stops."""

    def __init__(self, uri, seen):
        self.uri, self.seen = uri, seen

    def frames(self):
        while not main._stop.is_set():
            self.seen.add(self.uri)
            yield Frame(image=b"x", source=self.uri, still=True)
            main._stop.wait(0.01)


@pytest.fixture
def run_with(monkeypatch):
    def run(sources: dict):
        main._stop.clear()
        monkeypatch.setattr(main, "AegisClient", FakeClient)
        monkeypatch.setattr(main, "build_source", lambda uri, _settings: sources[uri])
        settings = VisionSettings(
            service_email="svc@example.com",
            service_password="x",
            sources=",".join(sources),
            preview_interval_seconds=0,
        )
        worker = threading.Thread(target=main.run, args=(settings,), daemon=True)
        worker.start()
        return worker

    yield run
    main._stop.set()


def test_every_camera_is_processed_not_just_the_first(run_with):
    """A live stream never ends, so cameras read in turn left all but the first unread."""
    seen: set[str] = set()
    worker = run_with({"rtsp://a": EndlessCamera("rtsp://a", seen), "rtsp://b": EndlessCamera("rtsp://b", seen)})

    for _ in range(200):
        if seen == {"rtsp://a", "rtsp://b"}:
            break
        main._stop.wait(0.01)
    assert seen == {"rtsp://a", "rtsp://b"}

    main._stop.set()
    worker.join(timeout=5)
    assert not worker.is_alive()


def test_a_failing_camera_does_not_stop_the_others(run_with):
    class Broken:
        def frames(self):
            raise RuntimeError("camera unplugged")
            yield  # pragma: no cover

    seen: set[str] = set()
    worker = run_with({"rtsp://bad": Broken(), "rtsp://good": EndlessCamera("rtsp://good", seen)})

    for _ in range(200):
        if seen:
            break
        main._stop.wait(0.01)
    assert seen == {"rtsp://good"}
    assert worker.is_alive()

    main._stop.set()
    worker.join(timeout=5)


def test_a_tagged_camera_publishes_its_direction(monkeypatch):
    main._stop.clear()
    client = FakeClient()
    monkeypatch.setattr(main, "AegisClient", lambda **_: client)

    class OneFrame:
        def frames(self):
            yield Frame(image=b"x", source="rtsp://in", still=True)
            main._stop.set()

    monkeypatch.setattr(main, "build_source", lambda uri, _settings: OneFrame())
    settings = VisionSettings(
        service_email="svc@example.com", service_password="x", sources="rtsp://in|entry",
        preview_interval_seconds=0, vehicle_model="",
    )

    main.run(settings)

    assert client.alerts and {a["direction"] for a in client.alerts} == {"entry"}
