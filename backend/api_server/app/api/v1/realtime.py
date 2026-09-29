import asyncio
import logging
import time
import uuid

from fastapi import (
    APIRouter,
    Depends,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import audit, metrics
from app.core.deps import require_guard
from app.core.ws_manager import manager
from app.core.state import ticket_store
from app.database import get_db, get_session_factory
from app.models import Role, User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["realtime"])

# How long to wait for client traffic before sending a keepalive. Idle
# WebSockets are commonly culled by proxies at 60s.
_HEARTBEAT_SECONDS = 25

# How often a live stream re-checks that its user may still receive alerts.
_REVALIDATE_SECONDS = 25

_STREAM_ROLES = {Role.ADMIN, Role.GUARD}


class TicketResponse(BaseModel):
    ticket: str
    expires_in: int


@router.post("/auth/ws-ticket", response_model=TicketResponse)
def issue_ws_ticket(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_guard),
) -> TicketResponse:
    """
    Exchange a bearer token for a single-use WebSocket ticket.

    Called over HTTPS with the normal Authorization header, so the access token
    never reaches a URL.
    """
    ticket, ttl = ticket_store.issue(current_user.id)

    audit.record(
        db,
        action="realtime.ticket_issued",
        request=request,
        actor_id=current_user.id,
        actor_email=current_user.email,
    )
    db.commit()
    return TicketResponse(ticket=ticket, expires_in=ttl)


def _load_user(session_factory, user_id: uuid.UUID) -> User | None:
    """
    Resolve the connecting user on a short-lived session.

    The session is opened and closed immediately: a WebSocket can stay up for
    hours, and holding a pooled connection for that long would exhaust the pool
    under a modest number of guards.
    """
    with session_factory() as db:
        user = db.get(User, user_id)
        if user is None or not user.is_active:
            return None
        # Detach a plain snapshot; the session closes on the next line.
        db.expunge(user)
        return user


@router.websocket("/ws/guard-alerts/{guard_id}")
async def guard_alerts(
    websocket: WebSocket,
    guard_id: str,
    ticket: str | None = Query(default=None),
    session_factory=Depends(get_session_factory),
) -> None:
    """
    Live alert stream for guards and administrators.

    The connection's identity comes from the redeemed ticket, never from
    `guard_id` in the path. Trusting the path would let anyone stream another
    guard's alerts simply by editing the URL; the path segment is kept only for
    URL readability and is checked against the real identity.
    """
    # The store may be Redis: never block the event loop on it.
    user_id = await asyncio.to_thread(ticket_store.redeem, ticket)
    if user_id is None:
        # Reject before completing the handshake.
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid ticket")
        return

    user = await asyncio.to_thread(_load_user, session_factory, user_id)
    if user is None or user.role not in _STREAM_ROLES:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Not authorised")
        return

    # The URL must agree with the authenticated identity.
    if guard_id and guard_id != str(user.id):
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Identity mismatch"
        )
        return

    await websocket.accept()
    await manager.connect(websocket, user.id, user.role)
    metrics.websocket_connections.inc()

    await websocket.send_json(
        {
            "type": "connected",
            "user_id": str(user.id),
            "role": user.role.value,
        }
    )

    last_checked = time.monotonic()
    try:
        while True:
            try:
                # Any inbound frame doubles as a liveness signal.
                await asyncio.wait_for(websocket.receive_text(), timeout=_HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                # Idle: prove the socket is still writable, or fail out.
                await websocket.send_json({"type": "ping"})

            # Deactivation or demotion must end the stream, not just the next
            # HTTP request. Checked on a clock rather than only when idle, so a
            # client that keeps sending frames is re-checked too.
            if time.monotonic() - last_checked >= _REVALIDATE_SECONDS:
                last_checked = time.monotonic()
                current = await asyncio.to_thread(_load_user, session_factory, user.id)
                if current is None or current.role not in _STREAM_ROLES:
                    await websocket.close(
                        code=status.WS_1008_POLICY_VIOLATION, reason="Access revoked"
                    )
                    break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("Websocket closed unexpectedly", exc_info=True)
    finally:
        await manager.disconnect(websocket, user.id)
        metrics.websocket_connections.dec()
