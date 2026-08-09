from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

# Correlation fields for the request currently being served.
#
# The ContextVar holds a MUTABLE dict rather than plain strings. Starlette's
# BaseHTTPMiddleware runs the downstream application in a separate task, which
# gets a *copy* of the context — so a value assigned by a route handler is
# invisible to the middleware that logs the access line. Sharing one dict by
# reference means downstream writes (the authenticated actor, most importantly)
# are visible upstream, which is what makes "who did this" appear on every line.
_log_context: ContextVar[dict[str, Any] | None] = ContextVar("log_context", default=None)


def new_log_context() -> dict[str, Any]:
    """Install a fresh context for one request. Returns the reset token holder."""
    context: dict[str, Any] = {}
    _log_context.set(context)
    return context


def bind_log_context(**fields: Any) -> None:
    """Attach fields to every subsequent log line for this request."""
    context = _log_context.get()
    if context is not None:
        context.update(fields)


def get_log_context() -> dict[str, Any]:
    return _log_context.get() or {}


def clear_log_context() -> None:
    _log_context.set(None)

# Attributes the stdlib puts on every record; anything else was passed as
# `extra` and belongs in the JSON output.
_STANDARD_ATTRS = frozenset(
    """args asctime created exc_info exc_text filename funcName levelname levelno
    lineno module msecs message msg name pathname process processName relativeCreated
    stack_info thread threadName taskName""".split()
)

# Substrings that mark a field as unsafe to log, matched case-insensitively.
_REDACT_KEYS = ("password", "token", "secret", "authorization", "cookie", "api_key")
REDACTED = "[redacted]"


def _redact(key: str, value: Any) -> Any:
    lowered = key.lower()
    if any(marker in lowered for marker in _REDACT_KEYS):
        return REDACTED
    return value


class JsonFormatter(logging.Formatter):
    """
    One JSON object per line, for ingestion by a log aggregator.

    Correlation ids are attached automatically so every line emitted while
    serving a request can be tied back to it without the caller passing them
    through by hand.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        for key, value in get_log_context().items():
            if value is not None:
                payload[key] = value

        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                payload[key] = _redact(key, value)

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


class HumanFormatter(logging.Formatter):
    """Readable single-line output for local development."""

    def __init__(self) -> None:
        super().__init__(
            fmt="%(asctime)s %(levelname)-8s %(name)-28s %(message)s",
            datefmt="%H:%M:%S",
        )

    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        request_id = get_log_context().get("request_id")
        return f"{base}  [req {str(request_id)[:8]}]" if request_id else base


def configure_logging(level: str = "INFO", json_output: bool = True) -> None:
    """
    Install a single stdout handler.

    Logs go to stdout only: in a container, writing files means log rotation
    and disk management the platform already solves.
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if json_output else HumanFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # uvicorn installs its own handlers; let them propagate to ours instead so
    # access and application logs share one format.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True

    # Access logging is handled by our middleware, which knows the route
    # template and the authenticated actor.
    logging.getLogger("uvicorn.access").disabled = True
