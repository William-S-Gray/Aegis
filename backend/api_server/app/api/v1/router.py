from fastapi import APIRouter

from app.api.v1 import (
    alerts,
    analytics,
    auth,
    cameras,
    logs,
    realtime,
    rules,
    sites,
    users,
    vehicles,
    visitor_passes,
    watchlist,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(vehicles.router)
api_router.include_router(sites.router)
api_router.include_router(logs.router)
api_router.include_router(alerts.router)
api_router.include_router(rules.router)
api_router.include_router(analytics.router)
api_router.include_router(realtime.router)
api_router.include_router(cameras.router)
api_router.include_router(visitor_passes.router)
api_router.include_router(watchlist.router)
