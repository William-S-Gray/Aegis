import os
import time
import uuid

import pytest

from app.core.store import InMemoryStore, RedisStore, build_store
from app.core.throttle import LoginThrottle
from app.core.ws_tickets import TicketStore

REDIS_URL = os.environ.get("TEST_REDIS_URL")


def _redis_store():
    """A RedisStore against a live server, or None when unavailable."""
    if not REDIS_URL:
        return None
    try:
        store = RedisStore(REDIS_URL, prefix=f"aegis-test-{uuid.uuid4().hex[:8]}")
        store.count("probe")
        return store
    except Exception:
        return None


@pytest.fixture(params=["memory", "redis"])
def store(request):
    """
    Runs every contract test against both implementations.

    The Redis case is skipped when no server is configured, so the suite stays
    runnable without one — but when Redis is present, both must behave
    identically, which is the whole point of the protocol.
    """
    if request.param == "memory":
        yield InMemoryStore()
        return

    redis_store = _redis_store()
    if redis_store is None:
        pytest.skip("TEST_REDIS_URL not set or Redis unreachable")
    yield redis_store
    redis_store.clear()


class TestStoreContract:
    def test_counter_starts_at_zero(self, store):
        assert store.count("nothing") == 0

    def test_incr_counts_up(self, store):
        assert store.incr("k", 60) == 1
        assert store.incr("k", 60) == 2
        assert store.count("k") == 2

    def test_count_does_not_mutate(self, store):
        store.incr("k", 60)
        store.count("k")
        store.count("k")
        assert store.count("k") == 1

    def test_delete_clears_a_counter(self, store):
        store.incr("k", 60)
        store.delete("k")
        assert store.count("k") == 0

    def test_ttl_is_reported(self, store):
        store.incr("k", 60)
        assert 0 < store.ttl("k") <= 60

    def test_ttl_of_absent_key_is_zero(self, store):
        assert store.ttl("missing") == 0

    def test_set_once_refuses_a_second_write(self, store):
        assert store.set_once("v", "first", 60) is True
        assert store.set_once("v", "second", 60) is False
        assert store.take("v") == "first"

    def test_take_is_single_use(self, store):
        store.set_once("v", "payload", 60)
        assert store.take("v") == "payload"
        assert store.take("v") is None

    def test_take_of_absent_key_is_none(self, store):
        assert store.take("missing") is None

    def test_expired_value_is_gone(self, store):
        store.set_once("v", "payload", 1)
        time.sleep(1.1)
        assert store.take("v") is None


class TestThrottleOverStore:
    def test_lockout_after_the_threshold(self, store):
        throttle = LoginThrottle(store, max_attempts=3, lockout_seconds=60)

        for _ in range(2):
            throttle.record_failure("user@example.com")
        assert throttle.retry_after("user@example.com") == 0

        throttle.record_failure("user@example.com")
        assert throttle.retry_after("user@example.com") > 0

    def test_checking_does_not_extend_the_lockout(self, store):
        """Polling the endpoint must not count as an attempt."""
        throttle = LoginThrottle(store, max_attempts=2, lockout_seconds=60)
        throttle.record_failure("k")

        for _ in range(10):
            throttle.retry_after("k")

        # Still one failure short of the threshold.
        assert throttle.retry_after("k") == 0
        throttle.record_failure("k")
        assert throttle.retry_after("k") > 0

    def test_reset_clears_the_lockout(self, store):
        throttle = LoginThrottle(store, max_attempts=1, lockout_seconds=60)
        throttle.record_failure("k")
        assert throttle.retry_after("k") > 0

        throttle.reset("k")
        assert throttle.retry_after("k") == 0

    def test_keys_are_independent(self, store):
        throttle = LoginThrottle(store, max_attempts=1, lockout_seconds=60)
        throttle.record_failure("a")

        assert throttle.retry_after("a") > 0
        assert throttle.retry_after("b") == 0


class TestTicketsOverStore:
    def test_round_trip(self, store):
        tickets = TicketStore(store)
        user_id = uuid.uuid4()
        raw, ttl = tickets.issue(user_id)

        assert ttl > 0
        assert tickets.redeem(raw) == user_id

    def test_single_use(self, store):
        tickets = TicketStore(store)
        raw, _ = tickets.issue(uuid.uuid4())

        assert tickets.redeem(raw) is not None
        assert tickets.redeem(raw) is None

    def test_garbage_is_rejected(self, store):
        tickets = TicketStore(store)
        assert tickets.redeem("nope") is None
        assert tickets.redeem(None) is None

    def test_corrupt_value_does_not_raise(self, store):
        """A malformed stored value must fail closed, not explode."""
        tickets = TicketStore(store)
        store.set_once("ws-ticket:manual", "not-a-uuid", 60)
        assert tickets.redeem("manual") is None


class TestBuildStore:
    def test_development_falls_back_to_memory(self):
        assert isinstance(build_store(None, "development"), InMemoryStore)

    @pytest.mark.parametrize("environment", ["staging", "production"])
    def test_deployed_environments_require_redis(self, environment):
        """
        Silently running a per-process rate limiter behind a load balancer is
        the kind of failure nobody notices until it is exploited.
        """
        with pytest.raises(RuntimeError, match="REDIS_URL"):
            build_store(None, environment)
