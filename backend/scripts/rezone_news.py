"""Reasigna news_items históricos de complejos multi-cala por zona.

Corrección de datos existentes (backfill del mapa de calas de
`news_zones`): los ítems antiguos se replicaron a todos los PMs del
complejo aunque el texto solo nombrara una cala ("Playa Grande
centro"). Para cada URL casada al complejo se buscan los alias de zona
en el titular y `extracted_beach`; si ninguno nombra zona y el evento
cambia estado (cierre/reapertura/aviso), se resuelve el cuerpo del
artículo (`resolve_and_fetch`, sin LLM) — el bando suele citar las
calas ahí.

- Zona(s) detectada(s) → filas solo en sus PMs: las réplicas sobrantes
  se BORRAN (son copias del mismo artículo; dejarlas con beach_id=NULL
  las devolvería a `_rematch_pending`, que las recasaría a todos los
  PMs por titular genérico). Si un PM nombrado no tiene fila, se crea.
- Ningún texto nombra zona → no se toca nada (conservador: un cierre
  sin zona afecta a todo el complejo).

Por defecto es dry-run: imprime lo que haría. `--apply` ejecuta.

Uso: python -m scripts.rezone_news [--apply] [--max-bodies N]
"""

import argparse
import sys
import time
from collections import defaultdict

from app.db import SessionLocal
from app.models import Beach, NewsItem
from app.news_matching import _norm_muni
from app.news_resolve import resolve_and_fetch
from app.news_zones import _ZONE_GROUPS, narrow_hits_by_zone

_STATE_EVENTS = {"closure", "reopening", "warning"}


def _group_beaches(db, base: str, muni: str) -> list[Beach]:
    out = []
    for b in db.query(Beach).filter(Beach.name.like(f"{base} PM%")).all():
        if _norm_muni(b.municipality) == muni:
            out.append(b)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="ejecuta los cambios")
    ap.add_argument(
        "--max-bodies",
        type=int,
        default=40,
        help="tope de cuerpos a resolver por pasada",
    )
    args = ap.parse_args()

    db = SessionLocal()
    bodies = 0
    try:
        for base, muni in _ZONE_GROUPS:
            beaches = _group_beaches(db, base, muni)
            if len(beaches) < 2:
                continue
            by_id = {b.id: b for b in beaches}
            rows = (
                db.query(NewsItem)
                .filter(
                    NewsItem.beach_id.in_(by_id), NewsItem.relevant.is_(True)
                )
                .all()
            )
            urls: dict[str, list[NewsItem]] = defaultdict(list)
            for r in rows:
                urls[r.url].append(r)
            print(f"== {base} ({muni}): {len(urls)} URLs en {len(beaches)} PMs")

            for url, group in sorted(urls.items()):
                r0 = group[0]
                wanted = narrow_hits_by_zone(
                    beaches, r0.extracted_beach, r0.title
                )
                if len(wanted) == len(beaches) and (
                    r0.event_type in _STATE_EVENTS and bodies < args.max_bodies
                ):
                    body = resolve_and_fetch(url)
                    bodies += 1
                    time.sleep(1)
                    if body:
                        wanted = narrow_hits_by_zone(
                            beaches, r0.extracted_beach, r0.title, body=body
                        )
                wanted_ids = {b.id for b in wanted}
                have_ids = {r.beach_id for r in group}
                if wanted_ids == have_ids:
                    continue
                drop = [r for r in group if r.beach_id not in wanted_ids]
                add = [by_id[i] for i in wanted_ids - have_ids]
                named = " · ".join(by_id[i].name.split()[-1] for i in sorted(wanted_ids))
                print(
                    f"  {'APPLY' if args.apply else 'dry  '} {r0.title[:60]!r}\n"
                    f"       -> {named or '(sin zona)'} "
                    f"(borra {len(drop)}, crea {len(add)})"
                )
                if not args.apply:
                    continue
                for r in drop:
                    db.delete(r)
                for b in add:
                    db.add(
                        NewsItem(
                            url=url,
                            title=r0.title,
                            source=r0.source,
                            published_at=r0.published_at,
                            relevant=True,
                            beach_id=b.id,
                            event_type=r0.event_type,
                            cause=r0.cause,
                            closed_since=r0.closed_since,
                            extracted_beach=r0.extracted_beach,
                            extracted_municipality=r0.extracted_municipality,
                            confidence=r0.confidence,
                            body_verified=r0.body_verified,
                        )
                    )
                db.commit()
        print(f"Fin. {bodies} cuerpos resueltos.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
