import json
import logging
import uuid

import pytest

from app.core.logging import (
    REDACTED,
    HumanFormatter,
    JsonFormatter,
    bind_log_context,
    clear_log_context,
    new_log_context,
)
from app.core.middleware import REQUEST_ID_HEADER
from app.models import Role

PASSWORD = "correct-horse-battery"


def make_record(msg: str = "hello", **extra) -> logging.LogRecord:
    record = logging.LogRecord(
        name="test", level=logging.INFO, pathname=__file__, lineno=1, msg=msg, args=(), exc_info=None
    )
    for key, value in extra.items():
        setattr(record, key, value)
    return record


@pytest.fixture(autouse=True)
def _clear_context():
    clear_log_context()
    yield
    clear_log_context()


class TestJsonFormatter:
    def test_emits_one_json_object(self):
        payload = json.loads(JsonFormatter().format(make_record()))

        assert payload["message"] == "hello"
        assert payload["level"] == "INFO"
        assert payload["logger"] == "test"
        assert "timestamp" in payload

    def test_extra_fields_are_included(self):
        payload = json.loads(JsonFormatter().format(make_record(route="/x", status=200)))

        assert payload["route"] == "/x"
        assert payload["status"] == 200

    def test_correlation_ids_are_attached_automatically(self):
        new_log_context()
        bind_log_context(request_id="req-123", actor_id="user-456")

        payload = json.loads(JsonFormatter().format(make_record()))

        assert payload["request_id"] == "req-123"
        assert payload["actor_id"] == "user-456"

    def test_ids_are_absent_when_unset(self):
        payload = json.loads(JsonFormatter().format(make_record()))
        assert "request_id" not in payload
        assert "actor_id" not in payload

    @pytest.mark.parametrize(
        "field",
        ["password", "hashed_password", "access_token", "refresh_token", "secret_key",
         "authorization", "cookie", "api_key"],
    )
    def test_sensitive_fields_are_redacted(self, field):
        """A credential reaching stdout is a credential in the log aggregator."""
        payload = json.loads(JsonFormatter().format(make_record(**{field: "hunter2"})))

        assert payload[field] == REDACTED
        assert "hunter2" not in json.dumps(payload)

    def test_exceptions_are_serialised(self):
        try:
            raise ValueError("boom")
        except ValueError:
            import sys

            record = make_record()
            record.exc_info = sys.exc_info()
            payload = json.loads(JsonFormatter().format(record))

        assert "ValueError: boom" in payload["exception"]

    def test_unserialisable_values_do_not_crash_logging(self):
        payload = json.loads(JsonFormatter().format(make_record(obj=object())))
        assert "obj" in payload


class TestHumanFormatter:
    def test_appends_a_short_request_id(self):
        new_log_context()
        bind_log_context(request_id="abcdef1234567890")
        assert "[req abcdef12]" in HumanFormatter().format(make_record())

    def test_omits_the_id_when_unset(self):
        assert "[req" not in HumanFormatter().format(make_record())


class TestRequestContext:
    def test_every_response_carries_a_request_id(self, client):
        response = client.get("/health")
        assert response.headers[REQUEST_ID_HEADER]

    def test_an_upstream_id_is_preserved(self):
        """A trace must span the proxy, not restart at the app."""
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as c:
            response = c.get("/health", headers={REQUEST_ID_HEADER: "trace-from-proxy"})

        assert response.headers[REQUEST_ID_HEADER] == "trace-from-proxy"

    def test_an_absurdly_long_id_is_truncated(self):
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as c:
            response = c.get("/health", headers={REQUEST_ID_HEADER: "x" * 500})

        assert len(response.headers[REQUEST_ID_HEADER]) == 64

    def test_ids_differ_between_requests(self, client):
        first = client.get("/health").headers[REQUEST_ID_HEADER]
        second = client.get("/health").headers[REQUEST_ID_HEADER]
        assert first != second


class TestActorAttribution:
    def test_authenticated_requests_log_the_actor(self, client, make_user, caplog):
        """
        Regression guard for a subtle one: Starlette runs the route in a
        separate task context, so an actor set by a dependency is invisible to
        the access-log middleware unless the context is shared by reference.
        """
        make_user(email="who@aegis.example", password=PASSWORD, role=Role.GUARD)
        token = client.post(
            "/api/v1/auth/login", json={"email": "who@aegis.example", "password": PASSWORD}
        ).json()["access_token"]

        captured = {}

        import logging as _logging

        class Capture(_logging.Handler):
            def emit(self, record):
                from app.core.logging import get_log_context

                if record.name == "aegis.access":
                    captured.update(get_log_context())

        handler = Capture()
        access_logger = _logging.getLogger("aegis.access")
        access_logger.addHandler(handler)
        try:
            client.get(
                "/api/v1/alerts/review-queue",
                headers={"Authorization": f"Bearer {token}"},
            )
        finally:
            access_logger.removeHandler(handler)

        assert captured.get("actor_id")
        assert captured.get("actor_role") == "guard"
        assert captured.get("request_id")


class TestMetricsEndpoint:
    def test_exposes_prometheus_text(self, client):
        response = client.get("/metrics")

        assert response.status_code == 200
        assert "aegis_http_requests_total" in response.text

    def test_requests_are_counted(self, client):
        client.get("/health")
        body = client.get("/metrics").text

        assert 'aegis_http_requests_total{method="GET",route="/health",status="200"}' in body

    def test_routes_are_labelled_by_template_not_raw_path(self, client, make_user):
        """
        Labelling by raw path would mint a series per UUID and take the
        metrics backend down.
        """
        make_user(email="m@aegis.example", password=PASSWORD, role=Role.GUARD)
        token = client.post(
            "/api/v1/auth/login", json={"email": "m@aegis.example", "password": PASSWORD}
        ).json()["access_token"]

        for _ in range(3):
            client.post(
                f"/api/v1/alerts/{uuid.uuid4()}/assign",
                headers={"Authorization": f"Bearer {token}"},
                json={"user_id": None},
            )

        body = client.get("/metrics").text
        assert "/api/v1/alerts/{alert_id}/assign" in body
        # No raw UUID should appear as a label value.
        assert "/api/v1/alerts/00000000" not in body

    def test_unmatched_paths_share_one_label(self, client):
        for i in range(3):
            client.get(f"/definitely-not-a-route-{i}")

        body = client.get("/metrics").text
        assert 'route="unmatched"' in body
        assert "definitely-not-a-route" not in body

    def test_login_outcomes_are_counted(self, client, make_user):
        make_user(email="counted@aegis.example", password=PASSWORD)
        client.post(
            "/api/v1/auth/login",
            json={"email": "counted@aegis.example", "password": PASSWORD},
        )
        client.post(
            "/api/v1/auth/login",
            json={"email": "counted@aegis.example", "password": "wrong"},
        )

        body = client.get("/metrics").text
        assert 'aegis_login_attempts_total{outcome="succeeded"}' in body
        assert 'aegis_login_attempts_total{outcome="failed"}' in body

    def test_alert_metrics_record_the_review_decision(self, client, make_user):
        make_user(email="g@aegis.example", password=PASSWORD, role=Role.GUARD)
        token = client.post(
            "/api/v1/auth/login", json={"email": "g@aegis.example", "password": PASSWORD}
        ).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        client.post(
            "/api/v1/alerts",
            headers=headers,
            json={"plate_number": "SURE99", "plate_confidence": 0.95},
        )
        client.post(
            "/api/v1/alerts",
            headers=headers,
            json={"plate_number": "MAYBE9", "plate_confidence": 0.70},
        )

        body = client.get("/metrics").text
        assert 'requires_review="false"' in body
        assert 'requires_review="true"' in body

    def test_rejected_detections_are_counted(self, client, make_user):
        make_user(email="g@aegis.example", password=PASSWORD, role=Role.GUARD)
        token = client.post(
            "/api/v1/auth/login", json={"email": "g@aegis.example", "password": PASSWORD}
        ).json()["access_token"]

        client.post(
            "/api/v1/alerts",
            headers={"Authorization": f"Bearer {token}"},
            json={"plate_number": "NOISE9", "plate_confidence": 0.1},
        )

        body = client.get("/metrics").text
        assert 'aegis_alerts_rejected_total{reason="below_review_floor"}' in body

    def test_confirmation_outcomes_are_counted(self, client, make_user):
        """corrected vs unchanged is the detector's measured error rate."""
        make_user(email="g@aegis.example", password=PASSWORD, role=Role.GUARD)
        token = client.post(
            "/api/v1/auth/login", json={"email": "g@aegis.example", "password": PASSWORD}
        ).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        alert = client.post(
            "/api/v1/alerts",
            headers=headers,
            json={"plate_number": "A812CD", "plate_confidence": 0.7},
        ).json()
        client.post(
            f"/api/v1/alerts/{alert['id']}/confirm-plate",
            headers=headers,
            json={"plate_number": "AB12CD"},
        )

        body = client.get("/metrics").text
        assert 'aegis_plate_confirmations_total{outcome="corrected"}' in body
