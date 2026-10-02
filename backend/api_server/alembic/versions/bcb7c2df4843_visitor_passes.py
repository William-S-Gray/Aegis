"""visitor passes

Revision ID: bcb7c2df4843
Revises: c4e1f7a2b9d0
Create Date: 2026-10-02 19:08:55.286942

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'bcb7c2df4843'
down_revision: str | None = 'c4e1f7a2b9d0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('visitor_passes',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('plate_number', sa.String(length=32), nullable=False),
    sa.Column('plate_display', sa.String(length=40), nullable=False),
    sa.Column('visitor_name', sa.String(length=200), nullable=False),
    sa.Column('notes', sa.String(length=500), nullable=True),
    sa.Column('valid_from', sa.DateTime(timezone=True), nullable=False),
    sa.Column('valid_until', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('host_id', sa.Uuid(), nullable=True),
    sa.Column('created_by', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['host_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_visitor_passes_created_at'), 'visitor_passes', ['created_at'], unique=False)
    op.create_index(op.f('ix_visitor_passes_host_id'), 'visitor_passes', ['host_id'], unique=False)
    op.create_index('ix_visitor_passes_plate_window', 'visitor_passes', ['plate_number', 'valid_until'], unique=False)
    op.create_index(op.f('ix_visitor_passes_valid_until'), 'visitor_passes', ['valid_until'], unique=False)
    op.add_column('alerts', sa.Column('visitor_pass_id', sa.Uuid(), nullable=True))
    op.create_index(op.f('ix_alerts_visitor_pass_id'), 'alerts', ['visitor_pass_id'], unique=False)
    op.create_foreign_key('fk_alerts_visitor_pass_id', 'alerts', 'visitor_passes', ['visitor_pass_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_alerts_visitor_pass_id', 'alerts', type_='foreignkey')
    op.drop_index(op.f('ix_alerts_visitor_pass_id'), table_name='alerts')
    op.drop_column('alerts', 'visitor_pass_id')
    op.drop_index(op.f('ix_visitor_passes_valid_until'), table_name='visitor_passes')
    op.drop_index('ix_visitor_passes_plate_window', table_name='visitor_passes')
    op.drop_index(op.f('ix_visitor_passes_host_id'), table_name='visitor_passes')
    op.drop_index(op.f('ix_visitor_passes_created_at'), table_name='visitor_passes')
    op.drop_table('visitor_passes')
