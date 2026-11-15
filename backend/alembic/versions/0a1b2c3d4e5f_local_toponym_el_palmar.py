"""outfalls: 'Palm-Mar' -> 'El Palmar' (topónimo local)

Revision ID: 0a1b2c3d4e5f
Revises: e5f6a7b8c9d0
Create Date: 2026-11-15 12:00:00.000000

"""

import re
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0a1b2c3d4e5f"
down_revision: str | Sequence[str] | None = "e5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLS = ("name", "settlement", "location", "origin", "zone_desc")


# Copia congelada de app.names.local_toponyms a fecha de la migración
def local_toponyms(s: str | None) -> str | None:
    if not s:
        return s
    s = re.sub(
        r"\b(?:el\s+)?palm-?\s?mar\b", "El Palmar", s, flags=re.IGNORECASE
    )
    return re.sub(r"\bdel El\b", "de El", s)


def upgrade() -> None:
    """Reescribe los campos de texto del censo con el topónimo local —
    la ingesta ya lo aplica, esto corrige las filas existentes."""
    conn = op.get_bind()
    where = " OR ".join(f"{c} ILIKE '%palm%mar%'" for c in _COLS)
    rows = conn.execute(
        sa.text(f"SELECT id, {', '.join(_COLS)} FROM outfalls WHERE {where}")
    ).mappings()
    for r in list(rows):
        conn.execute(
            sa.text(
                f"UPDATE outfalls SET {', '.join(f'{c} = :{c}' for c in _COLS)}"
                " WHERE id = :id"
            ),
            {"id": r["id"], **{c: local_toponyms(r[c]) for c in _COLS}},
        )


def downgrade() -> None:
    """Sin vuelta atrás: el nombre comercial no se restaura."""
