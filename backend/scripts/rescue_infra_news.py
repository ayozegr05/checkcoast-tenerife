"""Rescate retroactivo de noticias de infraestructura (Hito 11.2).

Dos clases de candidatas sobre el histórico de `news_items`:

A) Descartadas o sin casar (`relevant=False` o `beach_id=NULL`) cuyo
   titular habla de la instalación/suceso (INFRA_TITLE_RE): se
   re-extraen con PROMPT_INFRA — la misma segunda vía que la cascada
   de la ingesta en vivo. TODA fila procesada queda con
   event_type='infra' (relevant dice el veredicto): la pasada es
   reanudable y reextract_news ya no las degrada. Si el lugar no casa
   con playa, se baja el CUERPO y se escanean topónimos del censo —
   un artículo atribuido a un punto (infra_outfall_id) se sirve en su
   ficha aunque no haya playa casada.

B) Ya casadas a una playa con léxico infra en el titular (INFRA_RE):
   el artículo puede servir a las dos fichas. Se baja el cuerpo y:
   - scan de topónimos → `infra_outfall_id` (el punto que el cuerpo
     nombra; otro punto → la ficha de ese emisario, no de los demás);
   - pasada LLM con PROMPT_INFRA sobre el cuerpo → `infra_cause`
     ("obstrucción por toallitas"), sin pisar `cause` — que sigue
     siendo la causa del evento de playa.
   `infra_checked_at` marca "cuerpo ya escaneado" (reanudable).

Sin push nunca — noticias viejas no despiertan el móvil. Las réplicas
por PM se tratan como un solo artículo (misma URL → mismos campos).

Uso: python -m scripts.rescue_infra_news [--max N] [--year AAAA] [--dry-run]
                                     [--matched] [--discarded]
  --max N      tope de URLs a procesar (defecto 25 — cuota Gemini)
  --year AAAA  solo ítems publicados ese año (p.ej. el backfill 2024)
  --dry-run    lista las candidatas sin llamar al LLM (no hace API key)
  --matched    solo clase B (casadas a playa: cuerpo + atribución)
  --discarded  solo clase A (descartadas/sin casar: PROMPT_INFRA)
"""

import argparse
import sys
import time
from dataclasses import replace
from datetime import UTC, datetime

from sqlalchemy import extract, or_

from app.config import settings
from app.db import SessionLocal
from app.ingest_news import _rematch_pending
from app.models import Beach, NewsItem, Outfall
from app.news_infra import (
    INFRA_EVENT_TYPE,
    INFRA_RE,
    INFRA_TITLE_RE,
    extract_infra_event,
    infra_outfall_for_text,
)
from app.news_llm import GeminiExtractor
from app.news_matching import match_beaches
from app.news_resolve import resolve_and_fetch
from app.news_sources import GUIA_SOURCE, RawArticle
from app.news_zones import narrow_hits_by_zone


def _rows_by_url(db, items) -> dict[str, list[NewsItem]]:
    """Agrupa por URL incluyendo réplicas no seleccionadas — la
    noticia replicada por PM es el mismo artículo."""
    urls = {it.url for it in items}
    by_url: dict[str, list[NewsItem]] = {}
    for it in db.query(NewsItem).filter(NewsItem.url.in_(urls)).all():
        by_url.setdefault(it.url, []).append(it)
    return by_url


def _article(url: str, rows: list[NewsItem]) -> RawArticle:
    return RawArticle(
        title=rows[0].title,
        url=url,
        source=rows[0].source,
        published_at=rows[0].published_at,
    )


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
    ap.add_argument(
        "--matched",
        action="store_true",
        help="solo clase B: ítems ya casados a una playa",
    )
    ap.add_argument(
        "--discarded",
        action="store_true",
        help="solo clase A: descartadas o sin playa",
    )
    args = ap.parse_args()

    db = SessionLocal()
    processed = rescued = enriched = 0
    try:
        base_q = db.query(NewsItem).filter(NewsItem.source != GUIA_SOURCE)
        if args.year:
            base_q = base_q.filter(
                extract("year", NewsItem.published_at) == args.year
            )

        # --- Clase A: la vía de playa no las resolvió ---
        by_url_a: dict[str, list[NewsItem]] = {}
        if not args.matched:
            qa = base_q.filter(
                or_(
                    NewsItem.relevant.is_(False),
                    NewsItem.beach_id.is_(None),
                ),
                or_(
                    NewsItem.event_type.is_(None),
                    NewsItem.event_type != INFRA_EVENT_TYPE,
                ),
            )
            sel_a = [
                n for n in qa.all() if INFRA_TITLE_RE.search(n.title or "")
            ]
            by_url_a = _rows_by_url(db, sel_a)

        # --- Clase B: ya casadas a playa, léxico infra, cuerpo sin
        # escanear ---
        by_url_b: dict[str, list[NewsItem]] = {}
        if not args.discarded:
            qb = base_q.filter(
                NewsItem.relevant.is_(True),
                NewsItem.beach_id.isnot(None),
                NewsItem.infra_checked_at.is_(None),
                or_(
                    NewsItem.event_type.is_(None),
                    NewsItem.event_type != INFRA_EVENT_TYPE,
                ),
            )
            sel_b = [n for n in qb.all() if INFRA_RE.search(n.title or "")]
            by_url_b = _rows_by_url(db, sel_b)

        print(
            f"Candidatas: {len(by_url_a)} URLs descartadas/sin casar, "
            f"{len(by_url_b)} casadas a playa con léxico infra"
        )
        if args.dry_run:
            for _url, rows in list(by_url_a.items())[: args.max]:
                for r in rows:
                    tag = "relevante-sin-playa" if r.relevant else "descartada"
                    print(f"  [A·{tag}] {r.title[:90]}")
            for _url, rows in list(by_url_b.items())[: args.max]:
                for r in rows[:1]:
                    print(f"  [B·dual] {r.title[:90]}")
            return

        if not settings.gemini_api_key:
            sys.exit("GEMINI_API_KEY no configurada")
        extractor = GeminiExtractor(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            fallback_model=settings.gemini_fallback_model,
        )
        beaches = db.query(Beach).all()
        outfalls = db.query(Outfall).all()
        budget = args.max

        # --- Clase A: PROMPT_INFRA sobre el titular ---
        for url, rows in list(by_url_a.items()):
            if budget <= 0:
                break
            art = _article(url, rows)
            ext = extract_infra_event(art, extractor)
            if ext is None:
                continue  # fallo del proveedor: se reintenta la próxima
            budget -= 1
            hits = (
                match_beaches(ext, beaches, title=art.title)
                if ext.relevant
                else []
            )
            hits = narrow_hits_by_zone(
                hits, ext.beach_name, art.title, all_beaches=beaches
            )
            # Atribución al punto: titular gratis; si el lugar no casó
            # con playa se baja el cuerpo — un ítem con punto nombrado
            # se sirve en su ficha aunque no haya playa casada
            oid = infra_outfall_for_text(art.title, outfalls)
            body = None
            if ext.relevant and not hits and oid is None:
                body = resolve_and_fetch(url)
                if body:
                    oid = infra_outfall_for_text(
                        f"{art.title} {body}", outfalls
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
                row.infra_outfall_id = oid
                if body:
                    row.infra_checked_at = datetime.now(UTC)
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
                                    infra_outfall_id=oid,
                                    infra_checked_at=(
                                        datetime.now(UTC) if body else None
                                    ),
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
                f"  [A·{processed}] {rows[0].title[:70]} "
                f"-> relevant={ext.relevant} / {ext.cause} / "
                f"{len(hits)} playa(s) / punto={oid}"
            )
            time.sleep(2)  # free tier de Gemini: respirar entre llamadas

        # --- Clase B: casadas a playa — cuerpo + scan + LLM infra ---
        for url, rows in list(by_url_b.items()):
            if budget <= 0:
                break
            art = _article(url, rows)
            body = resolve_and_fetch(url)
            if not body:
                continue  # sin cuerpo no hay nada que escanear; reintento
            budget -= 1
            oid = infra_outfall_for_text(f"{art.title} {body}", outfalls)
            # Pasada LLM sobre el cuerpo solo si el texto habla de
            # infraestructura — el hecho de infra va a `infra_cause`
            # sin pisar la causa del evento de playa
            cause = None
            if INFRA_RE.search(body):
                ext_i = extract_infra_event(replace(art, body=body), extractor)
                time.sleep(2)
                if ext_i is not None and ext_i.relevant:
                    cause = ext_i.cause
            for row in rows:
                row.infra_outfall_id = oid
                row.infra_checked_at = datetime.now(UTC)
                if cause:
                    row.infra_cause = cause
            db.commit()
            processed += 1
            enriched += 1
            print(
                f"  [B·{processed}] {rows[0].title[:70]} "
                f"-> punto={oid} / causa={cause}"
            )

        rematched = _rematch_pending(db, beaches, {})
        print(
            f"Rescate: {processed} URLs procesadas, {rescued} relevantes, "
            f"{enriched} enriquecidas ({rematched} pendientes recasadas)"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
