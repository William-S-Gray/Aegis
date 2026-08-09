import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Header, Response, status
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.api.v1.router import api_router
from app.config import get_settings
from app.core import metrics
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.core.ws_manager import manager

settings = get_settings()
configure_logging(level=settings.log_level, json_output=settings.log_json)

logger = logging.getLogger("aegis.startup")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Synchronous route handlers run in a worker thread; capturing the serving
    # loop here is what lets them schedule WebSocket broadcasts.
    manager.bind_loop(asyncio.get_running_loop())
    logger.info(
        "Aegis API starting",
        extra={"environment": settings.environment, "metrics": settings.metrics_enabled},
    )
    yield
    logger.info("Aegis API stopping")


app = FastAPI(
    title="Aegis API",
    version="0.3.0",
    description="Vehicle access management API.",
    lifespan=lifespan,
    # The interactive docs expose the full surface; keep them off in production.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

# Ordering matters: this must wrap CORS so that even a rejected preflight is
# counted and carries a request id.
app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    """Liveness only: deliberately does not touch the database, so a slow
    query cannot cause the orchestrator to kill an otherwise healthy pod."""
    return {"status": "ok"}


def _authorize_metrics(authorization: str | None = Header(default=None)) -> None:
    if not settings.metrics_token:
        return
    expected = f"Bearer {settings.metrics_token}"
    if authorization != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authorised")


@app.get("/metrics", tags=["meta"], dependencies=[Depends(_authorize_metrics)])
def prometheus_metrics() -> Response:
    if not settings.metrics_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return Response(generate_latest(metrics.registry), media_type=CONTENT_TYPE_LATEST)


app.include_router(api_router)
