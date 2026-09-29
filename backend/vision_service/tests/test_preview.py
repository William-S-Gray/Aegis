from __future__ import annotations

import httpx
import respx

from app.client import AegisClient
from app.preview import Preview, camera_identity, encode_frame

BASE = "http://api.test/api/v1"
JPEG = b"\xff\xd8\xff\xe0frame"


def test_camera_names_never_carry_stream_credentials():
    assert camera_identity("rtsp://admin:hunter2@10.0.0.5:554/stream1") == (
        "10-0-0-5-stream1",
        "10.0.0.5/stream1",
    )
    assert camera_identity("/data/samples") == ("samples", "samples")


def test_encodes_jpeg_bytes_and_skips_what_it_cannot_encode():
    assert encode_frame(JPEG) == JPEG
    assert encode_frame(b"\x89PNG....") is None


@respx.mock
def test_pushes_at_most_one_frame_per_interval_with_auth_and_type():
    respx.post(f"{BASE}/auth/login").mock(
        return_value=httpx.Response(200, json={"access_token": "tok"})
    )
    route = respx.put(f"{BASE}/cameras/gate-cam/frame").mock(return_value=httpx.Response(204))

    with AegisClient(base_url=BASE, email="v@x.example", password="p") as client:
        preview = Preview(client, interval_seconds=60)
        assert preview.offer("http://gate-cam/", JPEG) is True
        assert preview.offer("http://gate-cam/", JPEG) is False  # throttled

    request = route.calls[0].request
    assert request.headers["Authorization"] == "Bearer tok"
    assert request.headers["Content-Type"] == "image/jpeg"
    assert request.url.params["name"] == "gate-cam"
    assert request.content == JPEG


@respx.mock
def test_an_unreachable_api_costs_only_the_preview():
    respx.post(f"{BASE}/auth/login").mock(side_effect=httpx.ConnectError("down"))
    with AegisClient(base_url=BASE, email="v@x.example", password="p") as client:
        assert Preview(client, interval_seconds=1).offer("http://gate-cam/", JPEG) is False
