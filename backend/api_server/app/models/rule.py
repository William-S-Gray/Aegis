import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AttributeMismatchRule(Base):
    """
    An allow-list entry that suppresses a would-be mismatch alert.

    Detectors confuse genuinely similar attributes — "silver" versus "grey",
    "SUV" versus "crossover". Rather than lowering confidence thresholds
    globally, an administrator declares specific pairs equivalent.

    The pair is stored order-independently (sorted on write) so "silver/grey"
    and "grey/silver" cannot both exist.
    """

    __tablename__ = "attribute_mismatch_rules"
    __table_args__ = (
        UniqueConstraint("attribute", "value_a", "value_b", name="uq_rule_attribute_pair"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    # "type" or "color"
    attribute: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    value_a: Mapped[str] = mapped_column(String(60), nullable=False)
    value_b: Mapped[str] = mapped_column(String(60), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    @staticmethod
    def normalize_pair(a: str, b: str) -> tuple[str, str]:
        first, second = sorted([a.strip().lower(), b.strip().lower()])
        return first, second

    @property
    def allowed_pair(self) -> list[str]:
        """Shape the frontend's rules table renders."""
        return [self.value_a, self.value_b]
