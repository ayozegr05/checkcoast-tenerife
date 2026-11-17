"""Evidence quotes and persistent historical extraction reviews."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("news_items", sa.Column("evidence_quote", sa.Text()))
    op.create_table(
        "news_extraction_reviews",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("campaign", sa.String(64), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("before", postgresql.JSONB(), nullable=False),
        sa.Column("proposal", postgresql.JSONB()),
        sa.Column("reason", sa.Text()),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "campaign", "url", name="uq_news_review_campaign_url"
        ),
    )
    op.create_index(
        "ix_news_extraction_reviews_campaign",
        "news_extraction_reviews",
        ["campaign"],
    )


def downgrade() -> None:
    op.drop_table("news_extraction_reviews")
    op.drop_column("news_items", "evidence_quote")
