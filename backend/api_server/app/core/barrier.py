"""
Open the gate barrier automatically for a registered vehicle that matches.

Off unless BARRIER_OPEN_URL is set. The call is a signed HTTP POST to the
barrier controller or relay; anything other than a quick 2xx counts as
failure, and on failure the guard decides as before, so a broken relay never
leaves a vehicle unseen.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    # A redirect would send the signed request somewhere it was not configured.
    def redirect_request(self, *args, **kwargs):  # noqa: ANN002, ANN003
        return None


_opener = urllib.request.build_opener(_NoRedirects)


def sign(body: bytes, secret: str) -> str:
    """HMAC-SHA256 of the body, so the relay can refuse requests not from Aegis."""
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def open_barrier(url: str, secret: str, timeout: float, *, alert_id: str, plate: str, site_id: str | None) -> bool:
    """True only when the controller answered 2xx within the timeout."""
    # The timestamp is signed with the rest, so the relay can refuse a captured
    # request replayed later; alert_id lets it refuse a replay inside the window.
    body = json.dumps(
        {"action": "open", "alert_id": alert_id, "plate": plate, "site_id": site_id, "timestamp": int(time.time())}
    ).encode()
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "X-Aegis-Signature": sign(body, secret)},
    )
    try:
        with _opener.open(request, timeout=timeout) as response:
            return 200 <= response.status < 300
    except (urllib.error.URLError, OSError, ValueError):
        logger.warning("Barrier controller did not open", exc_info=True)
        return False
