from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram

# A dedicated registry rather than the global default, so tests can build a
# clean one and metrics from imported libraries do not leak in unnoticed.
registry = CollectorRegistry()

# ---------------------------------------------------------------- HTTP
#
# Labelled by ROUTE TEMPLATE ("/api/v1/alerts/{alert_id}"), never the raw path.
# Labelling by raw path would mint a new time series per UUID and take the
# metrics backend down within a day.

http_requests = Counter(
    "aegis_http_requests_total",
    "HTTP requests handled.",
    labelnames=("method", "route", "status"),
    registry=registry,
)

http_request_duration = Histogram(
    "aegis_http_request_duration_seconds",
    "Time spent handling a request.",
    labelnames=("method", "route"),
    # Tuned for an API where anything over a second is worth investigating.
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
    registry=registry,
)

http_exceptions = Counter(
    "aegis_http_exceptions_total",
    "Requests that ended in an unhandled exception.",
    labelnames=("route",),
    registry=registry,
)

# ---------------------------------------------------------------- auth

login_attempts = Counter(
    "aegis_login_attempts_total",
    "Login attempts by outcome.",
    # Bounded set: succeeded | failed | throttled.
    labelnames=("outcome",),
    registry=registry,
)

# ---------------------------------------------------------------- domain

alerts_created = Counter(
    "aegis_alerts_created_total",
    "Alerts raised, by why they fired and whether a human must confirm them.",
    labelnames=("mismatch_type", "requires_review"),
    registry=registry,
)

alerts_rejected = Counter(
    "aegis_alerts_rejected_total",
    "Detections refused before storage.",
    labelnames=("reason",),
    registry=registry,
)

plate_confirmations = Counter(
    "aegis_plate_confirmations_total",
    "Human verdicts on low-confidence reads.",
    # "corrected" vs "unchanged" is the headline accuracy signal: it is the
    # measured error rate of the detector on the reads it was unsure about.
    labelnames=("outcome",),
    registry=registry,
)

review_queue_depth = Gauge(
    "aegis_review_queue_depth",
    "Alerts awaiting human confirmation.",
    registry=registry,
)

websocket_connections = Gauge(
    "aegis_websocket_connections",
    "Live alert-stream connections on this instance.",
    registry=registry,
)


def observe_alert(mismatch_type: str, requires_review: bool) -> None:
    alerts_created.labels(
        mismatch_type=mismatch_type, requires_review=str(requires_review).lower()
    ).inc()
    if requires_review:
        review_queue_depth.inc()


def observe_confirmation(corrected: bool) -> None:
    plate_confirmations.labels(outcome="corrected" if corrected else "unchanged").inc()
    review_queue_depth.dec()


def set_review_queue_depth(value: int) -> None:
    """
    Reconcile the gauge with the database.

    Counters drift across restarts and rejected writes, so the true depth is
    read from the database when the queue is listed rather than being trusted
    to increment-and-decrement forever.
    """
    review_queue_depth.set(value)
