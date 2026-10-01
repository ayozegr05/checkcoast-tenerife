"""add body_verified to news_items

Revision ID: f1a2b3c4d5e6
Revises: e9f0a1b2c3d4
Create Date: 2026-09-30 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'e9f0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'news_items',
        sa.Column('body_verified', sa.Boolean(), server_default='false', nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('news_items', 'body_verified')
