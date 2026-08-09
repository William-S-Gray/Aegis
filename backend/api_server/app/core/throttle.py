from app.config import get_settings
from app.core.store import SharedStore

settings = get_settings()


class LoginThrottle:
    """
    Counts consecutive failed logins per key and locks the key out once the
    threshold is reached.

    Backed by the shared store, so the limit holds across API replicas rather
    than being enforced N times independently.
    """

    def __init__(
        self,
        store: SharedStore,
        max_attempts: int | None = None,
        lockout_seconds: int | None = None,
    ):
        self._store = store
        self._max_attempts = max_attempts or settings.login_max_attempts
        self._lockout_seconds = lockout_seconds or settings.login_lockout_seconds

    @staticmethod
    def _key(key: str) -> str:
        return f"login-failures:{key}"

    def retry_after(self, key: str) -> int:
        """
        Seconds the caller must wait, or 0 when not locked out.

        Purely a read: checking whether you are locked out must not itself
        count as an attempt, or a client polling the endpoint would extend its
        own lockout indefinitely.
        """
        namespaced = self._key(key)
        if self._store.count(namespaced) < self._max_attempts:
            return 0
        # At least one second, so a caller never sees "retry after 0".
        return max(1, self._store.ttl(namespaced))

    def record_failure(self, key: str) -> None:
        self._store.incr(self._key(key), self._lockout_seconds)

    def reset(self, key: str) -> None:
        self._store.delete(self._key(key))

    def clear(self) -> None:
        self._store.clear()
