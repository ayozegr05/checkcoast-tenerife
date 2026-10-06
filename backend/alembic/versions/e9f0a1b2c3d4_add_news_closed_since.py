"""add closed_since to news_items

Revision ID: e9f0a1b2c3d4
Revises: d7e8f9a0b1c2
Create Date: 2026-09-26 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e9f0a1b2c3d4'
down_revision: str | Sequence[str] | None = 'd7e8f9a0b1c2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'news_items',
        sa.Column('closed_since', sa.String(10), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('news_items', 'closed_since')
