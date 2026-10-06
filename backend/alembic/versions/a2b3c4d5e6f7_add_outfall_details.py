"""add census detail fields to outfalls

Campos del Censo de Vertidos 2025 que la ficha muestra: naturaleza del
vertido (NatVert), continuidad (ContinVert), activo (EstadoFunc),
estado físico (EstadoGral), procedencia (ProcedVert), entidad
responsable (Entidad), espacio protegido (EspProtDet) y la ubicación
legible (NucleoUrb, Localiz, DescrZona).

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-10-02 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2b3c4d5e6f7"
down_revision: str | Sequence[str] | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "outfalls", sa.Column("nature", sa.String(length=120), nullable=True)
    )
    op.add_column(
        "outfalls",
        sa.Column("continuity", sa.String(length=60), nullable=True),
    )
    op.add_column(
        "outfalls", sa.Column("is_active", sa.Boolean(), nullable=True)
    )
    op.add_column(
        "outfalls", sa.Column("condition", sa.String(length=40), nullable=True)
    )
    op.add_column(
        "outfalls", sa.Column("origin", sa.String(length=160), nullable=True)
    )
    op.add_column(
        "outfalls", sa.Column("entity", sa.String(length=160), nullable=True)
    )
    op.add_column(
        "outfalls", sa.Column("protected_area", sa.Text(), nullable=True)
    )
    op.add_column(
        "outfalls",
        sa.Column("settlement", sa.String(length=160), nullable=True),
    )
    op.add_column(
        "outfalls", sa.Column("location", sa.String(length=255), nullable=True)
    )
    op.add_column("outfalls", sa.Column("zone_desc", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("outfalls", "zone_desc")
    op.drop_column("outfalls", "location")
    op.drop_column("outfalls", "settlement")
    op.drop_column("outfalls", "protected_area")
    op.drop_column("outfalls", "entity")
    op.drop_column("outfalls", "origin")
    op.drop_column("outfalls", "condition")
    op.drop_column("outfalls", "is_active")
    op.drop_column("outfalls", "continuity")
    op.drop_column("outfalls", "nature")
