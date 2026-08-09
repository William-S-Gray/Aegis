import uuid

import pytest

from app.core.state import ticket_store
from app.core.store import InMemoryStore
from app.core.ws_tickets import TicketStore
from app.models import Role

PASSWORD = "correct-horse-battery"


@pytest.fixture(autouse=True)
def _clear_tickets():
    ticket_store.clear()
    yield
    ticket_store.clear()


@pytest.fixture
def auth(client, make_user):
    def _auth(role: Role = Role.GUARD, email: str | None = None):
        email = email or f"{role.value}@aegis.example"
        make_user(email=email, password=PASSWORD, role=role)
        body = client.post(
            "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
        ).json()
        return body["access_token"], body["user"]["id"]

    return _auth


class TestTicketStore:
    def test_ticket_is_single_use(self):
        store = TicketStore(InMemoryStore())
        user_id = uuid.uuid4()
        raw, _ = store.issue(user_id)

        assert store.redeem(raw) == user_id
        # Replay must fail even though the TTL has not elapsed.
        assert store.redeem(raw) is None

    def test_expired_ticket_is_rejected(self):
        store = TicketStore(InMemoryStore(), ttl_seconds=0)
        raw, _ = store.issue(uuid.uuid4())
        assert store.redeem(raw) is None

    def test_unknown_and_empty_tickets_are_rejected(self):
        store = TicketStore(InMemoryStore())
        assert store.redeem("never-issued") is None
        assert store.redeem(None) is None
        assert store.redeem("") is None


class TestTicketEndpoint:
    def test_ticket_requires_authentication(self, client):
        assert client.post("/api/v1/auth/ws-ticket").status_code == 401

    def test_plain_user_cannot_get_a_ticket(self, client, auth):
        token, _ = auth(Role.USER)
        response = client.post(
            "/api/v1/auth/ws-ticket", headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 403

    def test_guard_receives_a_ticket(self, client, auth):
        token, _ = auth(Role.GUARD)
        response = client.post(
            "/api/v1/auth/ws-ticket", headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["ticket"]
        assert body["expires_in"] > 0
        # The access token must never be echoed back into the ticket.
        assert token not in body["ticket"]


class TestWebSocketAuth:
    def _ticket(self, client, token: str) -> str:
        return client.post(
            "/api/v1/auth/ws-ticket", headers={"Authorization": f"Bearer {token}"}
        ).json()["ticket"]

    def test_connection_without_a_ticket_is_refused(self, client, auth):
        _, user_id = auth(Role.GUARD)
        with pytest.raises(Exception):
            with client.websocket_connect(f"/api/v1/ws/guard-alerts/{user_id}") as ws:
                ws.receive_json()

    def test_connection_with_a_bogus_ticket_is_refused(self, client, auth):
        _, user_id = auth(Role.GUARD)
        with pytest.raises(Exception):
            with client.websocket_connect(
                f"/api/v1/ws/guard-alerts/{user_id}?ticket=not-a-real-ticket"
            ) as ws:
                ws.receive_json()

    def test_valid_ticket_connects(self, client, auth):
        token, user_id = auth(Role.GUARD)
        ticket = self._ticket(client, token)

        with client.websocket_connect(
            f"/api/v1/ws/guard-alerts/{user_id}?ticket={ticket}"
        ) as ws:
            hello = ws.receive_json()
            assert hello["type"] == "connected"
            assert hello["user_id"] == user_id
            assert hello["role"] == "guard"

    def test_ticket_cannot_be_replayed(self, client, auth):
        token, user_id = auth(Role.GUARD)
        ticket = self._ticket(client, token)

        with client.websocket_connect(
            f"/api/v1/ws/guard-alerts/{user_id}?ticket={ticket}"
        ) as ws:
            ws.receive_json()

        # Second use of the same ticket must be rejected.
        with pytest.raises(Exception):
            with client.websocket_connect(
                f"/api/v1/ws/guard-alerts/{user_id}?ticket={ticket}"
            ) as ws:
                ws.receive_json()

    def test_cannot_stream_another_guards_alerts(self, client, auth):
        """
        The path segment must not grant access.

        Editing the URL to another user's id is the obvious attack; identity
        comes from the ticket, and a mismatch is refused.
        """
        token, _ = auth(Role.GUARD, email="mine@aegis.example")
        ticket = self._ticket(client, token)
        someone_else = str(uuid.uuid4())

        with pytest.raises(Exception):
            with client.websocket_connect(
                f"/api/v1/ws/guard-alerts/{someone_else}?ticket={ticket}"
            ) as ws:
                ws.receive_json()

    def test_deactivated_user_cannot_connect(self, client, auth, make_user, db):
        from app.models import User

        token, user_id = auth(Role.GUARD, email="soon@aegis.example")
        ticket = self._ticket(client, token)

        user = db.get(User, uuid.UUID(user_id))
        user.is_active = False
        db.commit()

        with pytest.raises(Exception):
            with client.websocket_connect(
                f"/api/v1/ws/guard-alerts/{user_id}?ticket={ticket}"
            ) as ws:
                ws.receive_json()


class TestAlertBroadcast:
    def _ticket(self, client, token: str) -> str:
        return client.post(
            "/api/v1/auth/ws-ticket", headers={"Authorization": f"Bearer {token}"}
        ).json()["ticket"]

    def test_new_alert_reaches_a_connected_guard(self, client, auth):
        token, user_id = auth(Role.GUARD)
        ticket = self._ticket(client, token)

        with client.websocket_connect(
            f"/api/v1/ws/guard-alerts/{user_id}?ticket={ticket}"
        ) as ws:
            assert ws.receive_json()["type"] == "connected"

            client.post(
                "/api/v1/alerts",
                headers={"Authorization": f"Bearer {token}"},
                json={"plate_number": "LIVE01", "detected_color": "red"},
            )

            message = ws.receive_json()
            assert message["type"] == "alert"
            assert message["alert"]["plate_number"] == "LIVE01"
            assert message["alert"]["mismatch_type"] == "unregistered"

    def test_broadcast_payload_is_json_serialisable(self, client, auth):
        """UUIDs and datetimes must be encoded, not left as Python objects."""
        token, user_id = auth(Role.GUARD)
        ticket = self._ticket(client, token)

        with client.websocket_connect(
            f"/api/v1/ws/guard-alerts/{user_id}?ticket={ticket}"
        ) as ws:
            ws.receive_json()
            client.post(
                "/api/v1/alerts",
                headers={"Authorization": f"Bearer {token}"},
                json={"plate_number": "JSON01"},
            )

            alert = ws.receive_json()["alert"]
            assert isinstance(alert["id"], str)
            assert isinstance(alert["timestamp"], str)
            assert alert["comments"] == []

    def test_alert_is_persisted_even_with_no_listeners(self, client, auth, db):
        from sqlalchemy import select

        from app.models import Alert

        token, _ = auth(Role.GUARD)
        response = client.post(
            "/api/v1/alerts",
            headers={"Authorization": f"Bearer {token}"},
            json={"plate_number": "NOBODY1"},
        )

        assert response.status_code == 201
        assert db.scalar(select(Alert).where(Alert.plate_number == "NOBODY1")) is not None
