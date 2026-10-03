"""add shore distance to outfalls

Distancia en línea recta del punto de vertido a la costa más cercana,
calculada en la ingesta contra la línea de costa OSM
(backend/data/tenerife_coastline.geojson). No es dato del censo: se
deriva — sirve para decir "vierte a X m de la orilla" en la ficha y
para el índice de preocupación de la lista.

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-10-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('outfalls', sa.Column('shore_m', sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('outfalls', 'shore_m')
