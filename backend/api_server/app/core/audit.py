import uuid

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.deps import client_ip
from app.models import AuditLog


def record(
    db: Session,
    *,
    action: str,
    request: Request | None = None,
    actor_id: uuid.UUID | None = None,
    actor_email: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    details: dict | None = None,
) -> AuditLog:
    """
    Append an audit entry. The caller commits.

    Never pass passwords, tokens, or other credentials in `details`.
    """
    entry = AuditLog(
        actor_id=actor_id,
        actor_email=actor_email,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=client_ip(request) if request else None,
        user_agent=(request.headers.get("user-agent")[:500] if request and request.headers.get("user-agent") else None),
        details=details,
    )
    db.add(entry)
    return entry
