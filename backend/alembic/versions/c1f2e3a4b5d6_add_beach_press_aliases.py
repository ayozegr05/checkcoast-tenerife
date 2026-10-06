"""add press_aliases to beaches

Revision ID: c1f2e3a4b5d6
Revises: a8a38d692bd7
Create Date: 2026-09-21 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c1f2e3a4b5d6'
down_revision: str | Sequence[str] | None = 'a8a38d692bd7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'beaches',
        sa.Column('press_aliases', sa.ARRAY(sa.Text()), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('beaches', 'press_aliases')
