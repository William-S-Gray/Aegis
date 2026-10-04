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

    # Restart requests a guard made, handed out once (see /cameras/commands).
    pending_restarts: list = []

    def restart_requests(self):
        pending, FakeClient.pending_restarts = FakeClient.pending_restarts, []
        return pending


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


def test_a_restart_request_starts_a_camera_that_crashed(run_with, monkeypatch):
    """A camera reader that crashed used to stay down until the whole service restarted."""
    monkeypatch.setattr(main, "COMMAND_POLL_SECONDS", 0.05)
    seen: set[str] = set()
    attempts = []

    class FlakyCamera:
        def frames(self):
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError("camera not ready yet")
            yield from EndlessCamera("rtsp://gate", seen).frames()

    flaky = FlakyCamera()
    worker = run_with({"rtsp://gate": flaky, "rtsp://other": EndlessCamera("rtsp://other", set())})

    for _ in range(100):  # the first start fails
        if attempts:
            break
        main._stop.wait(0.01)
    assert not seen

    FakeClient.pending_restarts = ["gate"]
    for _ in range(300):
        if seen:
            break
        main._stop.wait(0.01)
    assert seen == {"rtsp://gate"}

    main._stop.set()
    worker.join(timeout=5)


def test_restart_reconnects_a_running_camera_and_leaves_others_alone():
    main._stop.clear()
    main._reconnect.clear()
    alive = threading.Thread(target=lambda: main._stop.wait(5), daemon=True)
    alive.start()
    threads = {"rtsp://gate/live": alive, "rtsp://yard/live": alive}

    main._apply_restarts(["gate-live"], threads, start=lambda *_: pytest.fail("nothing should be started"))

    assert main._reconnect["rtsp://gate/live"].is_set()
    assert "rtsp://yard/live" not in main._reconnect
    main._stop.set()


def test_a_waiting_camera_retries_at_once_when_asked():
    from app.sources import VideoSource

    reconnect = threading.Event()
    source = VideoSource("rtsp://gate/live", reconnect_delay_seconds=30, reconnect=reconnect)
    reconnect.set()
    done = threading.Event()
    threading.Thread(target=lambda: (source._wait_before_retry(), done.set()), daemon=True).start()
    assert done.wait(2), "a restart request should end the 30 s retry pause"
    assert not reconnect.is_set()
