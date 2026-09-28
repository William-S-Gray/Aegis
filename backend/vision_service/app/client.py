from __future__ import annotations

import logging
import threading
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Pauses between attempts when the API cannot be reached.
_RETRY_DELAYS = (0.5, 2.0, 5.0)

# Gateway errors mean the request never reached the application, so resending
# cannot record the detection twice. A 500 can arrive after the alert was
# committed, so it is not retried.
_NOT_DELIVERED = frozenset({502, 503, 504})

# After a refused login, how long to wait before trying again. Retrying at
# frame rate would trip the API's login throttle and lock the account out.
_LOGIN_BACKOFF_SECONDS = 60.0


class LoginRefused(Exception):
    """The API rejected the service account's credentials, or is throttling them."""


class AegisClient:
    """
    Authenticated HTTP client for the Aegis API.

    Holds a service-account session and refreshes it on 401 so a long-running
    capture process survives token expiry without operator intervention.
    """

    def __init__(
        self,
        base_url: str,
        email: str,
        password: str,
        timeout: float = 10.0,
        client: httpx.Client | None = None,
    ):
        self._base_url = base_url.rstrip("/")
        self._email = email
        self._password = password
        self._client = client or httpx.Client(base_url=self._base_url, timeout=timeout)
        self._access_token: str | None = None
        self._lock = threading.Lock()
        self._login_blocked_until = 0.0

    # ---------------------------------------------------------------- auth

    def login(self) -> None:
        if time.monotonic() < self._login_blocked_until:
            raise LoginRefused("Waiting before retrying a refused login")

        response = self._client.post(
            "/auth/login", json={"email": self._email, "password": self._password}
        )
        if response.status_code in (401, 403, 429):
            self._login_blocked_until = time.monotonic() + _LOGIN_BACKOFF_SECONDS
            logger.error(
                "Service account login refused (HTTP %s); retrying in %ss. "
                "Check VISION_SERVICE_EMAIL/PASSWORD and that the account has the service role.",
                response.status_code,
                int(_LOGIN_BACKOFF_SECONDS),
            )
            raise LoginRefused(f"HTTP {response.status_code}")
        response.raise_for_status()
        self._access_token = response.json()["access_token"]

    def _headers(self) -> dict[str, str]:
        if self._access_token is None:
            self.login()
        return {"Authorization": f"Bearer {self._access_token}"}

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        with self._lock:
            headers = self._headers()

        response = self._client.request(method, path, headers=headers, **kwargs)

        if response.status_code == 401:
            # The token expired mid-run; re-authenticate once and retry.
            with self._lock:
                self._access_token = None
                headers = self._headers()
            response = self._client.request(method, path, headers=headers, **kwargs)

        return response

    # ------------------------------------------------------------ commands

    def create_alert(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        """
        Publish a detection. Returns the created alert, or None when it was not
        recorded (rejected by the API, or the API stayed unreachable).

        Never raises: an API deploy or network blip must cost at most the
        detections made during it, never the capture process itself.
        """
        response = None
        for attempt, delay in enumerate((*_RETRY_DELAYS, None), start=1):
            try:
                response = self._request("POST", "/alerts", json=payload)
            except LoginRefused:
                return None
            except (httpx.ConnectError, httpx.ConnectTimeout):
                # Never reached the API, so resending is safe.
                response = None
            except httpx.HTTPError:
                # Sent, but the outcome is unknown (e.g. read timeout). Not
                # retried: the alert may already exist.
                logger.error("Publishing a detection failed mid-request", exc_info=True)
                return None

            if response is not None and response.status_code not in _NOT_DELIVERED:
                break
            if delay is None:
                logger.error("API unreachable; detection dropped after %d attempts", attempt)
                return None
            time.sleep(delay)

        if response.status_code == 201:
            return response.json()

        if response.status_code == 422:
            # The plate itself stays out of logs: it is personal data, and
            # stdout is outside every retention and erasure mechanism.
            logger.info("API rejected a detection: %s", response.text)
            return None

        logger.error(
            "Unexpected response publishing alert (%s): %s",
            response.status_code,
            response.text,
        )
        return None

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "AegisClient":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()
