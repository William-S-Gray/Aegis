import uuid
from collections.abc import Callable

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.logging import bind_log_context
from app.core.security import decode_token
from app.database import get_db
from app.models import Role, User

# auto_error=False so a missing header produces our 401 with a WWW-Authenticate
# challenge rather than FastAPI's bare 403.
_bearer = HTTPBearer(auto_error=False)

_UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise _UNAUTHENTICATED

    try:
        payload = decode_token(credentials.credentials, expected_type="access")
        user_id = uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        # Deliberately uniform: never reveal whether a token was expired,
        # malformed, or of the wrong type.
        raise _UNAUTHENTICATED from None

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _UNAUTHENTICATED

    # Every log line emitted for the rest of this request carries the actor,
    # so "who did this" never has to be reconstructed by hand.
    bind_log_context(actor_id=str(user.id), actor_role=user.role.value)
    return user


def require_roles(*roles: Role) -> Callable[[User], User]:
    """
    Route dependency enforcing role membership.

    This is the real authorization boundary. The client-side route guard only
    decides what to render; it can be bypassed by editing local storage, so
    every protected endpoint must depend on this.
    """
    allowed = set(roles)

    def _check(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return user

    return _check


# Convenience aliases for the common cases.
require_admin = require_roles(Role.ADMIN)
require_guard = require_roles(Role.ADMIN, Role.GUARD)
require_any_user = require_roles(Role.ADMIN, Role.GUARD, Role.USER)

# Publishing a detection is the ONLY thing a service account may do. This is
# deliberately a separate alias rather than adding SERVICE to require_guard,
# so widening it later has to be a conscious edit.
require_alert_publisher = require_roles(Role.ADMIN, Role.GUARD, Role.SERVICE)


def client_ip(request: Request) -> str | None:
    """
    Best-effort client IP.

    X-Forwarded-For is only trustworthy when the app sits behind a proxy that
    overwrites it; configure the proxy accordingly before relying on this for
    anything security-critical.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None
