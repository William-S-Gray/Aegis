from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

if settings.database_url.startswith("sqlite"):
    # SQLite (used by the test suite) needs this to share an in-memory database
    # across connections.
    _engine_options: dict = {"connect_args": {"check_same_thread": False}}
else:
    _engine_options = {
        "pool_size": settings.db_pool_size,
        "max_overflow": settings.db_pool_size,
        # Fail a request quickly rather than queue it forever behind an
        # exhausted pool.
        "pool_timeout": 10,
        "connect_args": {
            "connect_timeout": 5,
            # One runaway query is cut off instead of pinning a connection.
            # 0 disables it (the CLI does, for erasure and purge).
            "options": f"-c statement_timeout={settings.db_statement_timeout_ms}",
        },
    }

engine = create_engine(settings.database_url, pool_pre_ping=True, **_engine_options)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_session_factory() -> sessionmaker:
    """
    Dependency yielding the session *factory* rather than a session.

    Long-lived connections (WebSockets) must not hold a request-scoped session
    open for their whole lifetime, but they still need a way to reach the
    database that tests can redirect.
    """
    return SessionLocal


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
