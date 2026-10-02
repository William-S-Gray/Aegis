"""watchlist

Revision ID: 98f28641dcb3
Revises: bcb7c2df4843
Create Date: 2026-10-02 21:13:28.946303

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '98f28641dcb3'
down_revision: str | None = 'bcb7c2df4843'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('watchlist_entries',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('plate_number', sa.String(length=32), nullable=False),
    sa.Column('plate_display', sa.String(length=40), nullable=False),
    sa.Column('reason', sa.String(length=200), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('removed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('removed_by', sa.Uuid(), nullable=True),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['removed_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_watchlist_entries_plate_number'), 'watchlist_entries', ['plate_number'], unique=False)
    op.create_index(op.f('ix_watchlist_entries_removed_at'), 'watchlist_entries', ['removed_at'], unique=False)
    op.add_column('alerts', sa.Column('watchlist_entry_id', sa.Uuid(), nullable=True))
    op.create_index(op.f('ix_alerts_watchlist_entry_id'), 'alerts', ['watchlist_entry_id'], unique=False)
    op.create_foreign_key('fk_alerts_watchlist_entry_id', 'alerts', 'watchlist_entries', ['watchlist_entry_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_alerts_watchlist_entry_id', 'alerts', type_='foreignkey')
    op.drop_index(op.f('ix_alerts_watchlist_entry_id'), table_name='alerts')
    op.drop_column('alerts', 'watchlist_entry_id')
    op.drop_index(op.f('ix_watchlist_entries_removed_at'), table_name='watchlist_entries')
    op.drop_index(op.f('ix_watchlist_entries_plate_number'), table_name='watchlist_entries')
    op.drop_table('watchlist_entries')
