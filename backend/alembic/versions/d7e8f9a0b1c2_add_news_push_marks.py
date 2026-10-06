"""add push_pending/pushed_at to news_items

Revision ID: d7e8f9a0b1c2
Revises: c1f2e3a4b5d6
Create Date: 2026-09-26 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7e8f9a0b1c2"
down_revision: str | Sequence[str] | None = "c1f2e3a4b5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "news_items",
        sa.Column(
            "push_pending",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "news_items",
        sa.Column("pushed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("news_items", "pushed_at")
    op.drop_column("news_items", "push_pending")
