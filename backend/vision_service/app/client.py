from __future__ import annotations

import logging
import threading
from typing import Any

import httpx

logger = logging.getLogger(__name__)


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

    # ---------------------------------------------------------------- auth

    def login(self) -> None:
        response = self._client.post(
            "/auth/login", json={"email": self._email, "password": self._password}
        )
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
        Publish a detection. Returns the created alert, or None when the API
        rejected it (for example, confidence below the server-side floor).
        """
        response = self._request("POST", "/alerts", json=payload)

        if response.status_code == 201:
            return response.json()

        if response.status_code == 422:
            logger.info(
                "API rejected detection for %s: %s",
                payload.get("plate_number"),
                response.text,
            )
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
