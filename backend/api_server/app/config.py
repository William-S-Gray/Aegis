from functools import lru_cache
from typing import Literal

import re

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from the environment or a .env file."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    environment: Literal["development", "staging", "production"] = "development"

    database_url: str = Field(
        default="postgresql+psycopg://aegis:aegis@localhost:5435/aegis",
        description="SQLAlchemy database URL.",
    )

    @field_validator("database_url")
    @classmethod
    def _use_psycopg(cls, value: str) -> str:
        # Hosts such as Render hand out postgres:// or postgresql:// URLs, which
        # SQLAlchemy maps to psycopg2; only psycopg (3) is installed.
        return re.sub(r"^postgres(ql)?://", "postgresql+psycopg://", value)

    # Signing key for access and refresh tokens. There is deliberately no usable
    # default: a shared fallback secret would let anyone mint valid tokens.
    secret_key: str = Field(default="", min_length=0)

    algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    # The browser's refresh-token cookie is Secure. Browsers accept that on
    # https and on http://localhost; set false only to test over plain http on
    # another host name.
    refresh_cookie_secure: bool = True

    # Comma-separated origins permitted to call the API. Kept as a string
    # because pydantic-settings JSON-parses list fields read from .env before
    # any validator runs. Never use "*" alongside credentials.
    cors_origins: str = "http://localhost:5173"

    # Comma-separated emails of public demo accounts. They can sign in and read
    # everything their role can, but every write is refused (see deps.py), so a
    # shared demo login can't change the demo data or its own password.
    demo_readonly_emails: str = ""

    # Shared state across replicas (login throttling, WebSocket tickets).
    # Required outside development; see app/core/store.py.
    redis_url: str = ""

    # ---- Data retention (days) ------------------------------------------
    # Plate data is personal data. Keeping it indefinitely is a GDPR
    # storage-limitation problem, so each class has an explicit lifetime.
    # These are defaults, not legal advice: set them from your DPIA.
    #
    # Audit logs outlive operational data on purpose — they are the record of
    # who accessed what, and are what you produce when challenged.
    retention_audit_log_days: int = 730
    retention_access_log_days: int = 365
    retention_alert_days: int = 365
    # Plate images are the most identifying thing stored; they exist only to
    # support review, so they go long before the alert row does.
    retention_crop_days: int = 30
    # Revoked and expired refresh tokens have no value after this.
    retention_refresh_token_days: int = 30
    # Days after a visitor pass ends. It names a visitor and is only needed
    # around the visit; the alerts it covered keep their own retention.
    retention_visitor_pass_days: int = 90
    # Days after a watchlist entry is removed. Active entries are kept.
    retention_watchlist_days: int = 365
    # Who was on site and when; kept as long as the alerts they come from.
    retention_visit_days: int = 365

    # ---- Observability --------------------------------------------------
    log_level: str = "INFO"
    # JSON for aggregators; human-readable is easier to read locally.
    log_json: bool = True
    # Scrape endpoint. Bind it to an internal network or set a token: request
    # rates and error counts are useful reconnaissance.
    metrics_enabled: bool = True
    metrics_token: str = ""

    # ---- Plate-read confidence gating ----------------------------------
    # At or above this, an automated read is acted on without human input.
    plate_auto_accept_confidence: float = 0.85
    # Below this, a read is refused outright rather than recorded as noise.
    plate_review_floor_confidence: float = 0.50
    # Vehicle-type confidence below this sends an otherwise-good read to review.
    type_review_confidence: float = 0.60
    # A plate narrower than this many pixels in the image goes to review however
    # confident the reader is. Measured on hand-labelled video: the reader drops
    # a character from small plates (34VY880 for 34VY8802) and stays confident,
    # and repeats the mistake on every frame, so confirmation cannot catch it.
    # At 120 px, wrong auto-accepts fell from 4 to 1 and no correct read was lost
    # (8 went to review instead). 0 turns it off.
    plate_auto_accept_min_width: int = 120
    # Comma-separated regular expressions for the plate formats expected at this
    # site, e.g. "[A-Z]{3}[0-9]{4}" for standard Zimbabwe plates. A machine read
    # that matches none goes to review: a dropped or extra character usually
    # breaks the format, and the reader stays confident when it happens. Add the
    # formats of foreign, diplomatic or government plates the site sees. Empty
    # turns the check off.
    plate_formats: str = ""

    @field_validator("plate_formats")
    @classmethod
    def _formats_compile(cls, value: str) -> str:
        # A typo here would otherwise fail every alert at request time.
        for pattern in (p.strip() for p in value.split(",") if p.strip()):
            try:
                re.compile(pattern)
            except re.error as exc:
                raise ValueError(f"PLATE_FORMATS has an invalid pattern {pattern!r}: {exc}") from None
        return value

    # ---- Automatic barrier ----------------------------------------------
    # Signed POST to the barrier controller/relay for a camera read of an
    # active registered vehicle that matches its registration and needs no
    # review. Empty turns automatic opening off: every vehicle waits for a guard.
    barrier_open_url: str = ""
    # Shared with the relay, which should refuse requests without a valid
    # X-Aegis-Signature (HMAC-SHA256 of the body).
    barrier_secret: str = ""
    barrier_timeout_seconds: float = 3.0

    @model_validator(mode="after")
    def _barrier_needs_a_secret(self) -> "Settings":
        # Without one, the relay cannot tell Aegis from anyone who can reach it.
        if self.barrier_open_url and len(self.barrier_secret) < 16:
            raise ValueError("BARRIER_SECRET (16+ characters) is required when BARRIER_OPEN_URL is set")
        return self

    # Login throttling
    login_max_attempts: int = 5
    login_lockout_seconds: int = 300
    # Attempts from one address across all accounts, which is what password
    # spraying looks like. Counts successes too, so size it above the number of
    # people who sign in from behind one NAT within the lockout window. 0
    # disables it (for deployments where every client shares one address).
    login_ip_max_attempts: int = 100

    # Oldest access decision the offline queue may replay. Older timestamps are
    # refused, because retention and ordering both depend on them.
    access_log_max_age_days: int = 7

    # Pooled connections, and the longest any one API query may run.
    db_pool_size: int = 10
    db_statement_timeout_ms: int = 15000

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def demo_readonly_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.demo_readonly_emails.split(",") if e.strip()}

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.environment == "development":
        if not settings.secret_key:
            # Development convenience only: a per-process random key. Restarting
            # the server invalidates existing tokens, which is the correct
            # trade-off versus shipping a hardcoded secret.
            import secrets

            settings.secret_key = secrets.token_urlsafe(48)
        return settings

    # Staging included: a random per-process key there would silently break
    # every multi-replica deployment, and a short key can be brute-forced
    # offline from any single token.
    if len(settings.secret_key) < 32:
        raise RuntimeError(
            "SECRET_KEY must be set to at least 32 characters outside development. "
            "Generate one with: python -c 'import secrets; print(secrets.token_urlsafe(48))'"
        )
    return settings
