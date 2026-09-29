from __future__ import annotations

import httpx
import pytest
import respx

from app.client import AegisClient

BASE = "http://api.test/api/v1"


def make_client() -> AegisClient:
    return AegisClient(base_url=BASE, email="vision@aegis.example", password="secret")


@respx.mock
def test_logs_in_and_attaches_the_token():
    respx.post(f"{BASE}/auth/login").mock(
        return_value=httpx.Response(200, json={"access_token": "tok-1"})
    )
    route = respx.post(f"{BASE}/alerts").mock(
        return_value=httpx.Response(201, json={"id": "a1"})
    )

    with make_client() as client:
        client.create_alert({"plate_number": "AB12CD"})

    assert route.calls[0].request.headers["Authorization"] == "Bearer tok-1"


@respx.mock
def test_reauthenticates_once_when_the_token_expires():
    """A capture process runs for days; an expired token must not stop it."""
    respx.post(f"{BASE}/auth/login").mock(
        side_effect=[
            httpx.Response(200, json={"access_token": "old"}),
            httpx.Response(200, json={"access_token": "fresh"}),
        ]
    )
    route = respx.post(f"{BASE}/alerts").mock(
        side_effect=[
            httpx.Response(401, json={"detail": "Not authenticated"}),
            httpx.Response(201, json={"id": "a1"}),
        ]
    )

    with make_client() as client:
        result = client.create_alert({"plate_number": "AB12CD"})

    assert result == {"id": "a1"}
    assert route.calls[1].request.headers["Authorization"] == "Bearer fresh"


@respx.mock
def test_rejection_returns_none_rather_than_raising():
    """The API refusing a weak read is expected, not exceptional."""
    respx.post(f"{BASE}/auth/login").mock(
        return_value=httpx.Response(200, json={"access_token": "tok"})
    )
    respx.post(f"{BASE}/alerts").mock(
        return_value=httpx.Response(422, json={"detail": "below the review floor"})
    )

    with make_client() as client:
        assert client.create_alert({"plate_number": "AB12CD"}) is None


@respx.mock
def test_server_error_returns_none_and_does_not_crash_the_loop():
    respx.post(f"{BASE}/auth/login").mock(
        return_value=httpx.Response(200, json={"access_token": "tok"})
    )
    respx.post(f"{BASE}/alerts").mock(return_value=httpx.Response(500, text="boom"))

    with make_client() as client:
        assert client.create_alert({"plate_number": "AB12CD"}) is None


@respx.mock
def test_a_refused_login_backs_off_instead_of_crashing():
    """A crash used to restart the container, which logged in again at once and
    tripped the API's throttle: a crash loop that locked the account out."""
    login = respx.post(f"{BASE}/auth/login").mock(
        return_value=httpx.Response(401, json={"detail": "Invalid email or password"})
    )

    with make_client() as client:
        assert client.create_alert({"plate_number": "AB12CD"}) is None
        assert client.create_alert({"plate_number": "AB12CD"}) is None

    assert login.call_count == 1


@pytest.fixture
def no_sleep(monkeypatch):
    monkeypatch.setattr("app.client.time.sleep", lambda _seconds: None)


@respx.mock
def test_an_unreachable_api_is_retried(no_sleep):
    """A transport error used to escape and end the capture process."""
    respx.post(f"{BASE}/auth/login").mock(
        return_value=httpx.Response(200, json={"access_token": "tok"})
    )
    route = respx.post(f"{BASE}/alerts").mock(
        side_effect=[
            httpx.ConnectError("connection refused"),
            httpx.Response(503),
            httpx.Response(201, json={"id": "a1"}),
        ]
    )

    with make_client() as client:
        assert client.create_alert({"plate_number": "AB12CD"}) == {"id": "a1"}
    assert route.call_count == 3


@respx.mock
def test_a_prolonged_outage_drops_the_detection_but_not_the_process(no_sleep):
    respx.post(f"{BASE}/auth/login").mock(side_effect=httpx.ConnectError("down"))

    with make_client() as client:
        assert client.create_alert({"plate_number": "AB12CD"}) is None


@respx.mock
def test_an_ambiguous_failure_is_not_resent(no_sleep):
    """After a read timeout the alert may exist; resending would duplicate it."""
    respx.post(f"{BASE}/auth/login").mock(
        return_value=httpx.Response(200, json={"access_token": "tok"})
    )
    route = respx.post(f"{BASE}/alerts").mock(side_effect=httpx.ReadTimeout("slow"))

    with make_client() as client:
        assert client.create_alert({"plate_number": "AB12CD"}) is None
    assert route.call_count == 1
