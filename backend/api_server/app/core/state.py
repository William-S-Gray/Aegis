"""
Process-wide singletons built from configuration.

Kept in one module so the store is constructed exactly once and every consumer
shares it, and so tests can swap the implementation in a single place.
"""

from app.config import get_settings
from app.core.store import build_store
from app.core.throttle import LoginThrottle
from app.core.ws_tickets import TicketStore

settings = get_settings()

shared_store = build_store(settings.redis_url or None, settings.environment)
login_throttle = LoginThrottle(shared_store)
ticket_store = TicketStore(shared_store)
