import uuid

from app.core.store import SharedStore

# Long enough to survive a slow page load, short enough that a leaked URL is
# worthless by the time anyone reads it.
TICKET_TTL_SECONDS = 30


class TicketStore:
    """
    Single-use, short-lived handles that authorise one WebSocket upgrade.

    A browser cannot set an Authorization header on a WebSocket, and putting
    the access token in the query string would write a working credential into
    proxy logs, server access logs, and browser history. Instead the client
    exchanges its bearer token for a ticket over ordinary HTTPS and spends the
    ticket on connect.

    Redemption is a single atomic read-and-delete, so a ticket cannot be used
    twice even when two API replicas receive the connection simultaneously.
    """

    def __init__(self, store: SharedStore, ttl_seconds: int = TICKET_TTL_SECONDS):
        self._store = store
        self._ttl = ttl_seconds

    @staticmethod
    def _key(raw: str) -> str:
        return f"ws-ticket:{raw}"

    def issue(self, user_id: uuid.UUID) -> tuple[str, int]:
        raw = uuid.uuid4().hex + uuid.uuid4().hex
        self._store.set_once(self._key(raw), str(user_id), self._ttl)
        return raw, self._ttl

    def redeem(self, raw: str | None) -> uuid.UUID | None:
        """Consume a ticket, returning its user id, or None if invalid/expired."""
        if not raw:
            return None
        value = self._store.take(self._key(raw))
        if value is None:
            return None
        try:
            return uuid.UUID(value)
        except (TypeError, ValueError):
            return None

    def clear(self) -> None:
        self._store.clear()
