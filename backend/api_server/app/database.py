from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    # SQLite (used by the test suite) needs this to share an in-memory database
    # across connections; it is ignored by PostgreSQL.
    connect_args={"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {},
)

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
