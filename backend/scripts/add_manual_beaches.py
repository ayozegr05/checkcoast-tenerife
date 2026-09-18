"""Playas añadidas a mano: zonas de baño conocidas que no están en el
censo oficial (MITECO/Náyade) ni etiquetadas `natural=beach` en OSM.

Casos actuales:
- Playa de Almáciga (Santa Cruz, Anaga): existe como caserío/parada de
  bus en OSM pero la playa no tiene tag `natural=beach`.
- El Tablado (Güímar): zona de baño de la costa de Güímar sin elemento
  OSM que la identifique como playa.

Se insertan como `monitored=False` (gris, "sin monitorización oficial")
con `external_id` `manual-<slug>` para upserts idempotentes.

Uso: python -m scripts.add_manual_beaches
"""

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Beach
from scripts.assign_municipalities import assign_municipalities

# (external_id, nombre, lat, lon)
MANUAL_BEACHES: list[tuple[str, str, float, float]] = [
    ("manual-almaciga", "Playa de Almáciga", 28.5725, -16.1918),
    ("manual-el-tablado", "Playa del Tablado", 28.2418, -16.3960),
]

SOURCE_URL = "https://www.openstreetmap.org/copyright"


def add_manual_beaches(db: Session) -> tuple[int, int]:
    """Upsert por external_id. Devuelve (creadas, existentes)."""
    existing = {
        b.external_id
        for b in db.query(Beach.external_id)
        .filter(Beach.external_id.like("manual-%"))
        .all()
    }
    created = skipped = 0
    for external_id, name, lat, lon in MANUAL_BEACHES:
        if external_id in existing:
            skipped += 1
            continue
        db.add(
            Beach(
                external_id=external_id,
                name=name,
                monitored=False,
                geom=f"SRID=4326;POINT({lon} {lat})",
                source_url=SOURCE_URL,
            )
        )
        created += 1
    return created, skipped


def main() -> None:
    db = SessionLocal()
    try:
        created, skipped = add_manual_beaches(db)
        db.flush()  # el UPDATE raw de municipios debe ver los inserts
        assign_municipalities(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    print(f"Playas manuales: {created} creadas, {skipped} ya existían")


if __name__ == "__main__":
    main()
