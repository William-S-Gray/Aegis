import os

# Must be set before app modules import their settings.
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-outside-tests")
os.environ.setdefault("ENVIRONMENT", "development")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import hash_password
from app.api.v1.cameras import camera_frames, restart_requests
from app.core.state import login_throttle
from app.database import Base, get_db, get_session_factory
from app.main import app
from app.models import Role, User

# SQLite by default for speed. Set TEST_DATABASE_URL to run the same suite on
# PostgreSQL, which enforces what SQLite ignores: VARCHAR lengths, row locks,
# and JSONB (CI does both).
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "sqlite+pysqlite:///:memory:")

if TEST_DATABASE_URL.startswith("sqlite"):
    # StaticPool keeps a single in-memory database alive across connections.
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
else:
    engine = create_engine(TEST_DATABASE_URL)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@pytest.fixture(autouse=True)
def _reset_state():
    Base.metadata.create_all(bind=engine)
    login_throttle.clear()
    camera_frames.clear()
    restart_requests.clear()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    def _override_get_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = _override_get_db
    # WebSocket handlers resolve the factory rather than a session.
    app.dependency_overrides[get_session_factory] = lambda: TestingSessionLocal
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def make_user(db):
    def _make(
        email: str = "user@aegis.example",
        password: str = "correct-horse-battery",
        role: Role = Role.USER,
        is_active: bool = True,
    ) -> User:
        user = User(
            email=email,
            full_name="Test User",
            hashed_password=hash_password(password),
            role=role,
            is_active=is_active,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    return _make
