import asyncio
import logging
import uuid
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

from app.models import Role

logger = logging.getLogger(__name__)

# Longest one socket may take to accept an alert before it is dropped.
_SEND_TIMEOUT_SECONDS = 5


class ConnectionManager:
    """
    Tracks live WebSocket connections and fans alerts out to them.

    Connections are grouped by user so a guard signed in on a phone and a
    desk terminal receives an alert on both, and by role so a broadcast can
    target exactly the people who should see it.

    State is per-process, so the API must run as ONE replica. Behind more than
    one, a guard connected to instance A never receives an alert raised on
    instance B. Redis makes throttling and tickets replica-safe; it does not
    make this. Put Redis pub/sub behind `broadcast` before scaling out.
    """

    def __init__(self) -> None:
        self._by_user: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)
        self._roles: dict[WebSocket, Role] = {}
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Remember the serving loop so sync request handlers can schedule work."""
        self._loop = loop

    async def connect(self, websocket: WebSocket, user_id: uuid.UUID, role: Role) -> None:
        async with self._lock:
            self._by_user[user_id].add(websocket)
            self._roles[websocket] = role

    async def disconnect(self, websocket: WebSocket, user_id: uuid.UUID) -> None:
        async with self._lock:
            sockets = self._by_user.get(user_id)
            if sockets:
                sockets.discard(websocket)
                if not sockets:
                    self._by_user.pop(user_id, None)
            self._roles.pop(websocket, None)

    async def _targets(self, roles: set[Role] | None) -> list[WebSocket]:
        async with self._lock:
            if roles is None:
                return list(self._roles.keys())
            return [ws for ws, role in self._roles.items() if role in roles]

    async def _send(self, websocket: WebSocket, payload: dict[str, Any]) -> bool:
        try:
            await asyncio.wait_for(websocket.send_json(payload), timeout=_SEND_TIMEOUT_SECONDS)
            return True
        except Exception:
            logger.debug("Dropping unwritable websocket", exc_info=True)
            async with self._lock:
                self._roles.pop(websocket, None)
                for sockets in self._by_user.values():
                    sockets.discard(websocket)
            # Close it too: a socket dropped from the registry but left open
            # would look connected to its guard while receiving nothing. The
            # client reconnects and gets a fresh registration.
            try:
                await asyncio.wait_for(websocket.close(), timeout=_SEND_TIMEOUT_SECONDS)
            except Exception:
                pass
            return False

    async def broadcast(self, payload: dict[str, Any], roles: set[Role] | None = None) -> int:
        """
        Send `payload` to every matching connection, concurrently.

        Returns the number of sockets written to. Each send is time-bounded, so
        one guard on a stalled network delays nobody else, and a failed send
        drops that connection rather than aborting the fan-out.
        """
        targets = await self._targets(roles)
        results = await asyncio.gather(*(self._send(ws, payload) for ws in targets))
        return sum(results)

    def broadcast_threadsafe(
        self, payload: dict[str, Any], roles: set[Role] | None = None
    ) -> None:
        """
        Fire-and-forget broadcast callable from a synchronous request handler.

        Route handlers run in a worker thread, so the coroutine is scheduled
        onto the serving loop rather than awaited here. Delivery failures are
        logged, never raised: an alert must still be persisted and returned to
        the caller even if no one is listening.
        """
        if self._loop is None:
            logger.warning("Broadcast requested before the event loop was bound")
            return
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast(payload, roles), self._loop)
        except Exception:
            logger.exception("Failed to schedule websocket broadcast")

    async def connection_count(self) -> int:
        async with self._lock:
            return len(self._roles)


manager = ConnectionManager()
