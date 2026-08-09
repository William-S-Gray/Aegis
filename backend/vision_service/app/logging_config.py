from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

# Identifies which capture run and source a line came from, so logs from
# several cameras in one aggregator stay separable.
run_id_var: ContextVar[str | None] = ContextVar("run_id", default=None)
source_var: ContextVar[str | None] = ContextVar("source", default=None)

_STANDARD_ATTRS = frozenset(
    """args asctime created exc_info exc_text filename funcName levelname levelno
    lineno module msecs message msg name pathname process processName relativeCreated
    stack_info thread threadName taskName""".split()
)

_REDACT_KEYS = ("password", "token", "secret", "authorization", "api_key")
REDACTED = "[redacted]"


def _redact(key: str, value: Any) -> Any:
    if any(marker in key.lower() for marker in _REDACT_KEYS):
        return REDACTED
    return value


class JsonFormatter(logging.Formatter):
    """One JSON object per line, matching the API server's log shape."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "service": "vision",
        }

        run_id = run_id_var.get()
        if run_id:
            payload["run_id"] = run_id
        source = source_var.get()
        if source:
            payload["source"] = source

        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                payload[key] = _redact(key, value)

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO", json_output: bool = True) -> None:
    handler = logging.StreamHandler(sys.stdout)
    if json_output:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s %(levelname)-8s %(name)-22s %(message)s",
                datefmt="%H:%M:%S",
            )
        )

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # httpx logs a line per request at INFO, which drowns the pipeline's own
    # output on a busy camera.
    logging.getLogger("httpx").setLevel(logging.WARNING)
