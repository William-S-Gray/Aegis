"""access log idempotency, vehicle ownership start, plate crop evidence

Revision ID: c4e1f7a2b9d0
Revises: abd9b123964f
Create Date: 2026-09-28 12:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = 'c4e1f7a2b9d0'
down_revision: str | None = 'abd9b123964f'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('access_logs', sa.Column('client_ref', sa.Uuid(), nullable=True))
    op.create_unique_constraint('uq_access_logs_client_ref', 'access_logs', ['client_ref'])
    # Retention now purges by server time.
    op.create_index(op.f('ix_access_logs_recorded_at'), 'access_logs', ['recorded_at'], unique=False)

    op.add_column('vehicles', sa.Column('owner_since', sa.DateTime(timezone=True), nullable=True))
    # Nothing records when existing owners took over, so they keep seeing the
    # history they could see before. Transfers from here on start afresh.
    op.execute("UPDATE vehicles SET owner_since = created_at WHERE owner_id IS NOT NULL")

    op.add_column('alerts', sa.Column('plate_crop', sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column('alerts', 'plate_crop')
    op.drop_column('vehicles', 'owner_since')
    op.drop_index(op.f('ix_access_logs_recorded_at'), table_name='access_logs')
    op.drop_constraint('uq_access_logs_client_ref', 'access_logs', type_='unique')
    op.drop_column('access_logs', 'client_ref')
