"""visits and alert direction

Revision ID: 97ee3f72789c
Revises: 98f28641dcb3
Create Date: 2026-10-02 21:32:45.976053

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '97ee3f72789c'
down_revision: str | None = '98f28641dcb3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('visits',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('plate_number', sa.String(length=32), nullable=False),
    sa.Column('entered_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('exited_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('entry_alert_id', sa.Uuid(), nullable=True),
    sa.Column('exit_alert_id', sa.Uuid(), nullable=True),
    sa.Column('vehicle_id', sa.Uuid(), nullable=True),
    sa.Column('visitor_pass_id', sa.Uuid(), nullable=True),
    sa.Column('site_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['entry_alert_id'], ['alerts.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['exit_alert_id'], ['alerts.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['vehicle_id'], ['vehicles.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['visitor_pass_id'], ['visitor_passes.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_visits_created_at'), 'visits', ['created_at'], unique=False)
    op.create_index(op.f('ix_visits_entered_at'), 'visits', ['entered_at'], unique=False)
    op.create_index('ix_visits_plate_open', 'visits', ['plate_number', 'exited_at'], unique=False)
    op.add_column('alerts', sa.Column('direction', sa.String(length=5), nullable=True))


def downgrade() -> None:
    op.drop_column('alerts', 'direction')
    op.drop_index('ix_visits_plate_open', table_name='visits')
    op.drop_index(op.f('ix_visits_entered_at'), table_name='visits')
    op.drop_index(op.f('ix_visits_created_at'), table_name='visits')
    op.drop_table('visits')
