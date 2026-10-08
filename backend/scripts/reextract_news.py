"""Re-extracción de news_items tras cambios de prompt/pipeline.

Re-corre el LLM sobre ítems ya guardados (titular, y cuerpo cuando el
titular no aclara — misma segunda pasada que la ingesta) y actualiza
relevant/event_type/cause/extracted_* en todas las filas que comparten
URL (la misma noticia replicada por PM se extrae una sola vez). Al
final re-casa los pendientes con los campos nuevos — sin push, las
ventanas temporales ya filtran noticias viejas.

Uso: python -m scripts.reextract_news [--max N] [--all] [--beach TXT] [--year AAAA]
  --max N      tope de URLs distintas a procesar (defecto 40)
  --all        incluir también las marcadas no relevantes (pueden volver)
  --beach TXT  solo ítems de playas cuyo nombre contiene TXT
  --year AAAA  solo ítems publicados ese año (p.ej. rehacer el backfill 2024)
"""

import argparse
import sys
import time

from sqlalchemy import extract

from app.config import settings
from app.db import SessionLocal
from app.models import Beach, NewsItem
from app.news_llm import GeminiExtractor, extract_event
from app.news_matching import match_beaches
from app.news_sources import GUIA_SOURCE, RawArticle
from app.news_zones import narrow_hits_by_zone
from scripts.ingest_news import _enrich_with_body, _rematch_pending


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--max", type=int, default=40, help="tope de URLs distintas a procesar"
    )
    ap.add_argument(
        "--all", action="store_true", help="incluir también las no relevantes"
    )
    ap.add_argument(
        "--beach",
        default=None,
        help="solo ítems de playas cuyo nombre contiene TXT",
    )
    ap.add_argument(
        "--year",
        type=int,
        default=None,
        help="solo ítems publicados en ese año",
    )
    args = ap.parse_args()

    if not settings.gemini_api_key:
        sys.exit("GEMINI_API_KEY no configurada")
    extractor = GeminiExtractor(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        fallback_model=settings.gemini_fallback_model,
    )

    db = SessionLocal()
    updated = bodies = 0
    try:
        q = db.query(NewsItem).order_by(
            NewsItem.published_at.desc().nulls_last()
        )
        # Las fichas de la Guía se extraen siempre con cuerpo en
        # _sync_guia (cuando cambia lastmod); re-extraerlas solo con
        # el titular las degradaría a "no relevante"
        q = q.filter(NewsItem.source != GUIA_SOURCE)
        if not args.all:
            q = q.filter(NewsItem.relevant.is_(True))
        if args.beach:
            q = q.join(Beach, NewsItem.beach_id == Beach.id).filter(
                Beach.name.ilike(f"%{args.beach}%")
            )
        if args.year:
            q = q.filter(extract("year", NewsItem.published_at) == args.year)
        # El filtro por playa elige QUÉ URLs se procesan, pero cada
        # URL se actualiza con TODAS sus réplicas (la misma noticia
        # casada a varios PMs/playas) — si solo cargáramos las filas
        # filtradas, el re-match pisaría réplicas ajenas y violaría
        # el unique (url, beach_id)
        sel = q.all()
        urls = {it.url for it in sel}
        by_url: dict[str, list[NewsItem]] = {}
        for it in (
            db.query(NewsItem).filter(NewsItem.url.in_(urls)).all()
            if urls
            else []
        ):
            by_url.setdefault(it.url, []).append(it)
        beaches = db.query(Beach).all()

        for url, rows in list(by_url.items())[: args.max]:
            art = RawArticle(
                title=rows[0].title,
                url=url,
                source=rows[0].source,
                published_at=rows[0].published_at,
            )
            ext = extract_event(art, extractor)
            if ext is None:
                continue  # fallo del proveedor: la fila queda como estaba
            hits = (
                match_beaches(ext, beaches, title=art.title)
                if ext.relevant
                else []
            )
            ext, hits, used, verified = _enrich_with_body(
                art,
                ext,
                hits,
                beaches,
                extractor,
                rescue=any(r.relevant for r in rows),
            )
            bodies += used
            if ext is not None:
                # Complejo multi-cala: solo los PMs cuya zona aparece
                hits = narrow_hits_by_zone(hits, ext.beach_name, art.title)
            if ext is None:
                print(
                    f"  [keep] {rows[0].title[:70]} "
                    f"(titular no relevante, cuerpo inaccesible)"
                )
                continue
            for row in rows:
                row.relevant = ext.relevant
                row.event_type = ext.event_type
                row.cause = ext.cause
                row.closed_since = ext.closed_since
                row.extracted_beach = ext.beach_name
                row.extracted_municipality = ext.municipality
                row.confidence = ext.confidence
                row.body_verified = verified
            # Re-casar filas ya casadas: el cuerpo puede corregir la
            # playa ("una playa de El Médano" era Leocadio Machado) —
            # extracted_beach nuevo sin beach_id nuevo es el bug que
            # dejaba la noticia en la playa equivocada
            if ext.relevant:
                hit_ids = {b.id for b in hits}
                if hit_ids != {r.beach_id for r in rows}:
                    # Reasignar sin violar (url, beach_id): las filas ya
                    # bien casadas se quedan; solo las que perdieron su
                    # playa se mueven a hits sin fila o quedan libres
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
                                    event_type=ext.event_type,
                                    cause=ext.cause,
                                    closed_since=ext.closed_since,
                                    extracted_beach=ext.beach_name,
                                    extracted_municipality=ext.municipality,
                                    confidence=ext.confidence,
                                    body_verified=verified,
                                )
                            )
                    for row in free_rows:
                        row.beach_id = None
            db.commit()
            updated += 1
            print(
                f"  [{updated}] {rows[0].title[:70]} "
                f"-> {ext.event_type} / {ext.cause} / cs={ext.closed_since}"
            )
            time.sleep(2)

        rematched = _rematch_pending(db, beaches, {})
        print(
            f"Re-extracción: {updated} URLs procesadas "
            f"({bodies} con cuerpo), {rematched} recasadas"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
