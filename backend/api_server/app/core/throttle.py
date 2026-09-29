from app.config import get_settings
from app.core.store import SharedStore

settings = get_settings()


class LoginThrottle:
    """
    Counts login attempts per key and locks the key out once the threshold is
    reached.

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
        self._max_attempts = (
            settings.login_max_attempts if max_attempts is None else max_attempts
        )
        self._lockout_seconds = lockout_seconds or settings.login_lockout_seconds

    @staticmethod
    def _key(key: str) -> str:
        return f"login-failures:{key}"

    def attempt(self, key: str) -> int:
        """
        Count one attempt and return the seconds the caller must wait (0 = go).

        Increment-then-compare is a single atomic store operation, so N parallel
        requests cannot all observe "one below the limit" and all proceed. The
        window is anchored at the first attempt (the store sets the expiry only
        once), so hammering a locked key cannot extend its own lockout.

        A limit of 0 disables the throttle.
        """
        if not self._max_attempts:
            return 0
        namespaced = self._key(key)
        if self._store.incr(namespaced, self._lockout_seconds) <= self._max_attempts:
            return 0
        # At least one second, so a caller never sees "retry after 0".
        return max(1, self._store.ttl(namespaced))

    def first_rejection(self, key: str) -> bool:
        """True once per lockout window, so a locked key is audited once rather
        than once per request an attacker chooses to send."""
        return self._store.set_once(f"login-throttled:{key}", "1", self._lockout_seconds)

    def reset(self, key: str) -> None:
        self._store.delete(self._key(key))

    def clear(self) -> None:
        self._store.clear()
