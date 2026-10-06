"""Cierre ficticio de Playa de la Viuda para demos/grabaciones.

Inserta (seed) o elimina (clean) un cierre de prensa falso:
  - news_items: titular "Prueba local" (test.local) que alimenta el
    banner "según prensa" y la alerta via="press"
  - beach_statuses: estado manual `closed` (mismo que POST
    /beaches/{id}/status)

Uso en la VM:
  docker exec checkcoast-api python -m scripts.seed_fake_news seed
  docker exec checkcoast-api python -m scripts.seed_fake_news clean
"""

import sys
from datetime import UTC, datetime

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import BeachState, BeachStatus, NewsItem

BEACH_ID = 87  # Playa de la Viuda (Candelaria, no monitorizada)
FAKE_URL = "https://test.local/viuda-cierre-2026-09-21"
FAKE_TITLE = (
    "El Ayuntamiento de Candelaria cierra la Playa de la Viuda por "
    "contaminacion fecal tras un vertido"
)


def seed() -> None:
    with SessionLocal() as db:
        if db.scalar(select(NewsItem.id).where(NewsItem.url == FAKE_URL)):
            print("Ya existe la noticia fake; nada que hacer")
            return
        now = datetime.now(UTC)
        db.add(
            NewsItem(
                url=FAKE_URL,
                title=FAKE_TITLE,
                source="Prueba local",
                published_at=now,
                relevant=True,
                beach_id=BEACH_ID,
                event_type="closure",
                cause="contaminacion fecal",
                extracted_beach="Playa de la Viuda",
                extracted_municipality="Candelaria",
                confidence=0.95,
            )
        )
        db.add(
            BeachStatus(
                beach_id=BEACH_ID,
                status=BeachState.closed,
                reported_at=now,
                source_url="https://www.openstreetmap.org/copyright",
            )
        )
        db.commit()
        print(f"Sembrado: noticia + status closed en beach {BEACH_ID}")


def clean() -> None:
    with SessionLocal() as db:
        n = db.execute(
            delete(NewsItem).where(NewsItem.url == FAKE_URL)
        ).rowcount
        s = db.execute(
            delete(BeachStatus).where(
                BeachStatus.beach_id == BEACH_ID,
                BeachStatus.status == BeachState.closed,
            )
        ).rowcount
        db.commit()
        print(f"Limpiado: {n} noticias + {s} status borrados")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "seed":
        seed()
    elif cmd == "clean":
        clean()
    else:
        print(__doc__)
        sys.exit(1)
