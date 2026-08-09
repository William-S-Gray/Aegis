from __future__ import annotations

import logging
import time
from threading import Lock
from typing import Protocol

logger = logging.getLogger(__name__)


class SharedStore(Protocol):
    """
    The small amount of cross-request state the API needs.

    Kept behind a protocol because the in-memory implementation is correct for
    a single process and wrong for several: two replicas each enforcing "5
    failed logins" independently allow ten, and a WebSocket ticket issued by
    one replica cannot be redeemed on another.
    """

    def incr(self, key: str, ttl_seconds: int) -> int:
        """Increment a counter, setting its expiry on first write."""

    def count(self, key: str) -> int:
        """Current counter value without mutating it. 0 when absent."""

    def ttl(self, key: str) -> int:
        """Seconds remaining, or 0 when the key is absent."""

    def delete(self, key: str) -> None: ...

    def set_once(self, key: str, value: str, ttl_seconds: int) -> bool:
        """Store a value only if the key is unused. True when stored."""

    def take(self, key: str) -> str | None:
        """Atomically read and delete. None when absent or expired."""

    def clear(self) -> None:
        """Drop everything. Test helper."""


class InMemoryStore:
    """Single-process implementation. Correct for one replica only."""

    def __init__(self) -> None:
        self._values: dict[str, tuple[str, float]] = {}
        self._counters: dict[str, tuple[int, float]] = {}
        self._lock = Lock()

    @staticmethod
    def _expired(expires_at: float, now: float) -> bool:
        return expires_at <= now

    def _purge(self, now: float) -> None:
        for key, (_, expires_at) in list(self._values.items()):
            if self._expired(expires_at, now):
                self._values.pop(key, None)
        for key, (_, expires_at) in list(self._counters.items()):
            if self._expired(expires_at, now):
                self._counters.pop(key, None)

    def incr(self, key: str, ttl_seconds: int) -> int:
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            count, expires_at = self._counters.get(key, (0, now + ttl_seconds))
            count += 1
            # The window starts at the first failure and is not extended by
            # later ones, so a lockout cannot be held open indefinitely.
            self._counters[key] = (count, expires_at)
            return count

    def count(self, key: str) -> int:
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            entry = self._counters.get(key)
            return entry[0] if entry else 0

    def ttl(self, key: str) -> int:
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            entry = self._counters.get(key)
            if entry is None:
                return 0
            return max(0, int(entry[1] - now))

    def delete(self, key: str) -> None:
        with self._lock:
            self._counters.pop(key, None)
            self._values.pop(key, None)

    def set_once(self, key: str, value: str, ttl_seconds: int) -> bool:
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            if key in self._values:
                return False
            self._values[key] = (value, now + ttl_seconds)
            return True

    def take(self, key: str) -> str | None:
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            entry = self._values.pop(key, None)
        if entry is None or self._expired(entry[1], now):
            return None
        return entry[0]

    def clear(self) -> None:
        with self._lock:
            self._values.clear()
            self._counters.clear()


class RedisStore:
    """
    Redis-backed implementation, safe across replicas.

    Every operation is a single atomic Redis command, so two API instances
    racing on the same key cannot both win.
    """

    def __init__(self, url: str, prefix: str = "aegis"):
        try:
            import redis  # noqa: PLC0415 - optional dependency
        except ImportError as exc:  # pragma: no cover - depends on install
            raise RuntimeError(
                "redis is not installed. Add `redis` to requirements.txt to use "
                "the Redis-backed store."
            ) from exc

        self._redis = redis.Redis.from_url(url, decode_responses=True)
        self._prefix = prefix

    def _key(self, key: str) -> str:
        return f"{self._prefix}:{key}"

    def incr(self, key: str, ttl_seconds: int) -> int:
        full = self._key(key)
        pipe = self._redis.pipeline()
        pipe.incr(full)
        # NX so the window is anchored to the first increment.
        pipe.expire(full, ttl_seconds, nx=True)
        count, _ = pipe.execute()
        return int(count)

    def count(self, key: str) -> int:
        raw = self._redis.get(self._key(key))
        try:
            return int(raw) if raw is not None else 0
        except (TypeError, ValueError):
            return 0

    def ttl(self, key: str) -> int:
        remaining = self._redis.ttl(self._key(key))
        return max(0, int(remaining)) if remaining and remaining > 0 else 0

    def delete(self, key: str) -> None:
        self._redis.delete(self._key(key))

    def set_once(self, key: str, value: str, ttl_seconds: int) -> bool:
        return bool(self._redis.set(self._key(key), value, nx=True, ex=ttl_seconds))

    def take(self, key: str) -> str | None:
        # GETDEL is atomic, so a ticket cannot be redeemed twice even if two
        # replicas receive the connection at the same moment.
        return self._redis.getdel(self._key(key))

    def clear(self) -> None:
        keys = list(self._redis.scan_iter(f"{self._prefix}:*"))
        if keys:
            self._redis.delete(*keys)


def build_store(redis_url: str | None, environment: str) -> SharedStore:
    if redis_url:
        logger.info("Using the Redis shared store")
        return RedisStore(redis_url)

    if environment != "development":
        # Failing loudly beats silently running a rate limiter that only
        # protects one of N replicas.
        raise RuntimeError(
            "REDIS_URL must be set outside development: login throttling and "
            "WebSocket tickets are not safe across multiple replicas without it."
        )

    logger.warning("Using the in-memory store — single process only")
    return InMemoryStore()
