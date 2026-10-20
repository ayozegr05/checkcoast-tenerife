"""add infra attribution columns to news_items

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-02 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: str | Sequence[str] | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "news_items",
        sa.Column("infra_outfall_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_news_items_infra_outfall",
        "news_items",
        "outfalls",
        ["infra_outfall_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "news_items",
        sa.Column(
            "infra_checked_at", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.add_column(
        "news_items",
        sa.Column("infra_cause", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("news_items", "infra_cause")
    op.drop_column("news_items", "infra_checked_at")
    op.drop_constraint(
        "fk_news_items_infra_outfall", "news_items", type_="foreignkey"
    )
    op.drop_column("news_items", "infra_outfall_id")
