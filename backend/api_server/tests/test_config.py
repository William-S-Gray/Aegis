import pytest

from app.config import Settings


@pytest.mark.parametrize("given", ["postgres://u:p@h:5432/db", "postgresql://u:p@h:5432/db", "postgresql+psycopg://u:p@h:5432/db"])
def test_a_hosted_database_url_uses_the_installed_driver(given):
    """Render and similar hosts hand out postgres:// URLs; only psycopg 3 is installed."""
    assert Settings(database_url=given).database_url == "postgresql+psycopg://u:p@h:5432/db"
