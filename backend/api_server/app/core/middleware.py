from __future__ import annotations

import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core import metrics
from app.core.logging import bind_log_context, clear_log_context, new_log_context

logger = logging.getLogger("aegis.access")

REQUEST_ID_HEADER = "X-Request-ID"

# Health and metrics are scraped constantly; logging them buries real traffic.
_QUIET_PATHS = frozenset({"/health", "/metrics"})


def _route_template(request: Request) -> str:
    """
    The parameterised path, e.g. "/api/v1/alerts/{alert_id}".

    Using the raw path here would create one metric series per UUID.
    """
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    if path:
        return path
    # No route matched (404, or a malformed path). Bucketing these under a
    # single label keeps an endpoint scanner from exploding cardinality.
    return "unmatched"


class RequestContextMiddleware(BaseHTTPMiddleware):
    """
    Assigns a correlation id, records an access log line, and updates metrics.

    The id is echoed in the response header so a user reporting a problem can
    quote it and land directly on the relevant logs.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Trust an upstream id when present so a trace spans the proxy, but
        # bound its length: it is echoed back and lands in logs.
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = incoming[:64] if incoming else uuid.uuid4().hex

        new_log_context()
        bind_log_context(request_id=request_id)
        started = time.perf_counter()

        try:
            try:
                response = await call_next(request)
            except Exception:
                duration = time.perf_counter() - started
                route = _route_template(request)
                metrics.http_exceptions.labels(route=route).inc()
                metrics.http_requests.labels(
                    method=request.method, route=route, status="500"
                ).inc()
                metrics.http_request_duration.labels(
                    method=request.method, route=route
                ).observe(duration)

                logger.exception(
                    "Unhandled exception",
                    extra={
                        "method": request.method,
                        "route": route,
                        "path": request.url.path,
                        "duration_ms": round(duration * 1000, 2),
                    },
                )
                # Never leak a traceback to the caller; give them the id so
                # support can find the entry above.
                return JSONResponse(
                    status_code=500,
                    content={
                        "detail": "Internal server error",
                        "request_id": request_id,
                    },
                    headers={REQUEST_ID_HEADER: request_id},
                )

            duration = time.perf_counter() - started
            route = _route_template(request)

            metrics.http_requests.labels(
                method=request.method, route=route, status=str(response.status_code)
            ).inc()
            metrics.http_request_duration.labels(
                method=request.method, route=route
            ).observe(duration)

            if request.url.path not in _QUIET_PATHS:
                logger.info(
                    "%s %s %s",
                    request.method,
                    request.url.path,
                    response.status_code,
                    extra={
                        "method": request.method,
                        "route": route,
                        "path": request.url.path,
                        "status": response.status_code,
                        "duration_ms": round(duration * 1000, 2),
                        "client_ip": request.client.host if request.client else None,
                    },
                )

            response.headers[REQUEST_ID_HEADER] = request_id
            return response
        finally:
            clear_log_context()
