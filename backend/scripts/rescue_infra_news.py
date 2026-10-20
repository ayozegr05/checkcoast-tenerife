"""Rescate retroactivo de noticias de infraestructura (Hito 11.2).

Recorre ítems ya guardados que la vía de playa descartó (no
relevantes o sin playa casada) cuyo titular habla de la instalación
de vertido o del suceso (INFRA_TITLE_RE) y los re-extrae con
PROMPT_INFRA — la misma segunda vía que la cascada de la ingesta en
vivo. Marca TODA fila procesada con event_type='infra' (relevant
dice si la pieza sirvió o no): la pasada es reanudable de serie y
reextract_news ya no degrada esas filas.

Sin push nunca — noticias viejas no despiertan el móvil. El rematch
usa el mismo criterio conservador que la ingesta (match_beaches +
narrow_hits_by_zone) y solo-titular: la pasada de cuerpo es trabajo
de la ingesta en vivo, no de esta cosecha.

Uso: python -m scripts.rescue_infra_news [--max N] [--year AAAA] [--dry-run]
  --max N      tope de URLs distintas a procesar (defecto 25 — cuota Gemini)
  --year AAAA  solo ítems publicados ese año (p.ej. el backfill 2024)
  --dry-run    lista las candidatas sin llamar al LLM (no hace API key)
"""

import argparse
import sys
import time

from sqlalchemy import extract, or_

from app.config import settings
from app.db import SessionLocal
from app.ingest_news import _rematch_pending
from app.models import Beach, NewsItem
from app.news_infra import (
    INFRA_EVENT_TYPE,
    INFRA_TITLE_RE,
    extract_infra_event,
)
from app.news_llm import GeminiExtractor
from app.news_matching import match_beaches
from app.news_sources import GUIA_SOURCE, RawArticle
from app.news_zones import narrow_hits_by_zone


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--max",
        type=int,
        default=25,
        help="tope de URLs distintas a procesar",
    )
    ap.add_argument(
        "--year",
        type=int,
        default=None,
        help="solo ítems publicados en ese año",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="lista las candidatas sin llamar al LLM",
    )
    args = ap.parse_args()

    db = SessionLocal()
    processed = rescued = 0
    try:
        q = db.query(NewsItem).order_by(
            NewsItem.published_at.desc().nulls_last()
        )
        # Candidatas: la vía de playa NO las resolvió (descartadas o
        # sin playa casada) y el titular habla de la instalación/suceso
        q = q.filter(NewsItem.source != GUIA_SOURCE)
        q = q.filter(
            or_(NewsItem.relevant.is_(False), NewsItem.beach_id.is_(None))
        )
        q = q.filter(
            or_(
                NewsItem.event_type.is_(None),
                NewsItem.event_type != INFRA_EVENT_TYPE,
            )
        )
        if args.year:
            q = q.filter(extract("year", NewsItem.published_at) == args.year)
        # Igual que reextract: la URL se procesa con TODAS sus réplicas
        # (la noticia replicada por PM es el mismo artículo)
        sel = [n for n in q.all() if INFRA_TITLE_RE.search(n.title or "")]
        urls = {it.url for it in sel}
        by_url: dict[str, list[NewsItem]] = {}
        for it in (
            db.query(NewsItem).filter(NewsItem.url.in_(urls)).all()
            if urls
            else []
        ):
            by_url.setdefault(it.url, []).append(it)

        print(f"Candidatas: {len(by_url)} URLs distintas")
        if args.dry_run:
            for _url, rows in list(by_url.items())[: args.max]:
                for r in rows:
                    tag = "relevante-sin-playa" if r.relevant else "descartada"
                    print(f"  [{tag}] {r.title[:90]}")
            return

        if not settings.gemini_api_key:
            sys.exit("GEMINI_API_KEY no configurada")
        extractor = GeminiExtractor(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            fallback_model=settings.gemini_fallback_model,
        )
        beaches = db.query(Beach).all()

        for url, rows in list(by_url.items())[: args.max]:
            art = RawArticle(
                title=rows[0].title,
                url=url,
                source=rows[0].source,
                published_at=rows[0].published_at,
            )
            ext = extract_infra_event(art, extractor)
            if ext is None:
                continue  # fallo del proveedor: se reintenta la próxima
            hits = (
                match_beaches(ext, beaches, title=art.title)
                if ext.relevant
                else []
            )
            hits = narrow_hits_by_zone(
                hits, ext.beach_name, art.title, all_beaches=beaches
            )
            for row in rows:
                row.relevant = ext.relevant
                # 'infra' en TODAS las procesadas: marca de reanudación
                # (también las descartadas) — relevant dice el veredicto
                row.event_type = INFRA_EVENT_TYPE
                row.cause = ext.cause
                row.closed_since = ext.closed_since
                row.extracted_beach = ext.beach_name
                row.extracted_municipality = ext.municipality
                row.confidence = ext.confidence
                row.body_verified = False
            # Reasignar a la playa que el lugar extraído identifica —
            # mismo baile de (url, beach_id) que reextract_news
            if ext.relevant:
                hit_ids = {b.id for b in hits}
                if hit_ids != {r.beach_id for r in rows}:
                    free_rows = [r for r in rows if r.beach_id not in hit_ids]
                    for beach in hits:
                        if any(r.beach_id == beach.id for r in rows):
                            continue
                        if free_rows:
                            free_rows.pop(0).beach_id = beach.id
                        else:
                            db.add(
                                NewsItem(
                                    url=url,
                                    title=rows[0].title,
                                    source=rows[0].source,
                                    published_at=rows[0].published_at,
                                    relevant=True,
                                    beach_id=beach.id,
                                    event_type=INFRA_EVENT_TYPE,
                                    cause=ext.cause,
                                    closed_since=ext.closed_since,
                                    extracted_beach=ext.beach_name,
                                    extracted_municipality=ext.municipality,
                                    confidence=ext.confidence,
                                    body_verified=False,
                                )
                            )
                    # Solo una fila libre por URL (unique con NULLS
                    # NOT DISTINCT); el resto de réplicas sobra
                    already_free = any(r.beach_id is None for r in rows)
                    for row in free_rows:
                        if row.beach_id is None:
                            continue
                        if already_free:
                            db.delete(row)
                        else:
                            row.beach_id = None
                            already_free = True
            db.commit()
            processed += 1
            rescued += ext.relevant
            print(
                f"  [{processed}] {rows[0].title[:70]} "
                f"-> relevant={ext.relevant} / {ext.cause} / "
                f"{len(hits)} playa(s)"
            )
            time.sleep(2)  # free tier de Gemini: respirar entre llamadas

        rematched = _rematch_pending(db, beaches, {})
        print(
            f"Rescate: {processed} URLs procesadas, {rescued} relevantes "
            f"({rematched} pendientes recasadas)"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
