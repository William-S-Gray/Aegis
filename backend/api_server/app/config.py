from functools import lru_cache
from typing import Literal

from pydantic import Field
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

    # Signing key for access and refresh tokens. There is deliberately no usable
    # default: a shared fallback secret would let anyone mint valid tokens.
    secret_key: str = Field(default="", min_length=0)

    algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # Comma-separated origins permitted to call the API. Kept as a string
    # because pydantic-settings JSON-parses list fields read from .env before
    # any validator runs. Never use "*" alongside credentials.
    cors_origins: str = "http://localhost:5173"

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
    # Revoked and expired refresh tokens have no value after this.
    retention_refresh_token_days: int = 30

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

    # Login throttling
    login_max_attempts: int = 5
    login_lockout_seconds: int = 300

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if not settings.secret_key:
        if settings.is_production:
            raise RuntimeError(
                "SECRET_KEY must be set in production. Generate one with: "
                "python -c 'import secrets; print(secrets.token_urlsafe(48))'"
            )
        # Development convenience only: a per-process random key. Restarting the
        # server invalidates existing tokens, which is the correct trade-off
        # versus shipping a hardcoded secret that could reach production.
        import secrets

        settings.secret_key = secrets.token_urlsafe(48)
    return settings
