"""add technical and route fields to outfalls

Campos del Censo de Vertidos 2025 para la sección técnica y el trazado
de la conducción en la ficha: operador del saneamiento (GestSan),
longitud de la conducción (Longitud, m), cota del punto de vertido
(CotaVert, m — negativo = bajo el mar) y el punto de arranque en tierra
(XArranque/YArranque, guardado ya transformado a WGS84).

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-10-04 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: str | Sequence[str] | None = 'a2b3c4d5e6f7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('outfalls', sa.Column('manager', sa.String(length=160), nullable=True))
    op.add_column('outfalls', sa.Column('length_m', sa.Float(), nullable=True))
    op.add_column('outfalls', sa.Column('outfall_depth', sa.Float(), nullable=True))
    op.add_column('outfalls', sa.Column('start_lon', sa.Float(), nullable=True))
    op.add_column('outfalls', sa.Column('start_lat', sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('outfalls', 'start_lat')
    op.drop_column('outfalls', 'start_lon')
    op.drop_column('outfalls', 'outfall_depth')
    op.drop_column('outfalls', 'length_m')
    op.drop_column('outfalls', 'manager')
