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
def test_failed_login_surfaces():
    respx.post(f"{BASE}/auth/login").mock(
        return_value=httpx.Response(401, json={"detail": "Invalid email or password"})
    )

    with make_client() as client, pytest.raises(httpx.HTTPStatusError):
        client.create_alert({"plate_number": "AB12CD"})
