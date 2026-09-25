"""Re-extracción de news_items tras cambios de prompt/pipeline.

Re-corre el LLM sobre ítems ya guardados (titular, y cuerpo cuando el
titular no aclara — misma segunda pasada que la ingesta) y actualiza
relevant/event_type/cause/extracted_* en todas las filas que comparten
URL (la misma noticia replicada por PM se extrae una sola vez). Al
final re-casa los pendientes con los campos nuevos — sin push, las
ventanas temporales ya filtran noticias viejas.

Uso: python -m scripts.reextract_news [--max N] [--all] [--beach TXT]
  --max N      tope de URLs distintas a procesar (defecto 40)
  --all        incluir también las marcadas no relevantes (pueden volver)
  --beach TXT  solo ítems de playas cuyo nombre contiene TXT
"""

import argparse
import sys
import time

from app.config import settings
from app.db import SessionLocal
from app.models import Beach, NewsItem
from app.news_llm import GeminiExtractor, extract_event
from app.news_matching import match_beaches
from app.news_sources import RawArticle
from scripts.ingest_news import _enrich_with_body, _rematch_pending


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=40,
                    help="tope de URLs distintas a procesar")
    ap.add_argument("--all", action="store_true",
                    help="incluir también las no relevantes")
    ap.add_argument("--beach", default=None,
                    help="solo ítems de playas cuyo nombre contiene TXT")
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
        if not args.all:
            q = q.filter(NewsItem.relevant.is_(True))
        if args.beach:
            q = q.join(Beach, NewsItem.beach_id == Beach.id).filter(
                Beach.name.ilike(f"%{args.beach}%")
            )
        by_url: dict[str, list[NewsItem]] = {}
        for it in q.all():
            by_url.setdefault(it.url, []).append(it)
        beaches = db.query(Beach).all()

        for url, rows in list(by_url.items())[: args.max]:
            art = RawArticle(
                title=rows[0].title, url=url, source=rows[0].source,
                published_at=rows[0].published_at,
            )
            ext = extract_event(art, extractor)
            if ext is None:
                continue  # fallo del proveedor: la fila queda como estaba
            hits = (
                match_beaches(ext, beaches, title=art.title)
                if ext.relevant else []
            )
            ext, hits, used = _enrich_with_body(
                art, ext, hits, beaches, extractor
            )
            bodies += used
            for row in rows:
                row.relevant = ext.relevant
                row.event_type = ext.event_type
                row.cause = ext.cause
                row.extracted_beach = ext.beach_name
                row.extracted_municipality = ext.municipality
                row.confidence = ext.confidence
            db.commit()
            updated += 1
            print(
                f"  [{updated}] {rows[0].title[:70]} "
                f"→ {ext.event_type} / {ext.cause}"
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
