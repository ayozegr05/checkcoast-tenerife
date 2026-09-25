"""Ingesta de contexto de prensa (Hito 8.5): Google News RSS → LLM →
news_items.

Por pasada:
1. fetch_news() → titulares recientes (queries temáticas, dedup por URL)
2. descartar URLs ya vistas (unique), fuentes bloqueadas y sin fecha
3. extract_event() (Gemini) sobre cada titular nuevo, con tope
   `news_max_llm_calls` para acotar el gasto del free tier
4. match_beach() conservador → beach_id o None
5. insertar NewsItem: se guardan también los no relevantes y los no
   casados (dedup por url + auditoría); la API solo sirve los casados

Uso: python -m scripts.ingest_news
"""

import re
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.db import SessionLocal
from app.models import Beach, BeachState, BeachStatus, NewsItem
from app.news_llm import EventExtraction, GeminiExtractor, extract_event
from app.news_matching import match_beaches
from app.news_resolve import resolve_and_fetch
from app.news_sources import RawArticle, fetch_news, source_excluded
from app.queries import _short_cause

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

# Solo estos eventos de prensa despiertan el móvil; el resto queda como
# contexto en la ficha
_PRESS_PUSH_EVENTS = {"closure", "warning", "reopening"}
# Ventana de dedup: noticias del mismo evento suelen salir en días
# consecutivos — un push por evento, no por titular
_PRESS_PUSH_DAYS = 7
# Una reapertura solo notifica si cerraba un episodio: alerta de
# prensa reciente (misma ventana que /alerts) o estado oficial no-open
_REOPEN_CLOSURE_DAYS = 21


def _press_push_candidate(
    db, beach: Beach, event_type: str | None, published_at, exclude_id=None
) -> bool:
    """¿Esta noticia abre una alerta de prensa nueva digna de push?

    No si es un eco del mismo evento (otro medio contando lo mismo),
    si la noticia es vieja (recasada de pasadas) o si el estado oficial
    ya la cubre — en ese caso el push oficial ya salió."""
    if event_type not in _PRESS_PUSH_EVENTS or not published_at:
        return False
    now = datetime.now(timezone.utc)
    if now - published_at > timedelta(days=_PRESS_PUSH_DAYS):
        return False
    echo_q = db.query(NewsItem.id).filter(
        NewsItem.beach_id == beach.id,
        NewsItem.event_type == event_type,
        NewsItem.published_at >= now - timedelta(days=_PRESS_PUSH_DAYS),
    )
    if exclude_id is not None:
        echo_q = echo_q.filter(NewsItem.id != exclude_id)
    echo = echo_q.first()
    if echo:
        return False
    latest = (
        db.query(BeachStatus)
        .filter(BeachStatus.beach_id == beach.id)
        .order_by(BeachStatus.reported_at.desc())
        .first()
    )
    if event_type == "reopening":
        # Una reapertura sin cierre previo (ni prensa ni oficial) no
        # cambia nada visible — sería ruido
        had_press_closure = (
            db.query(NewsItem.id)
            .filter(
                NewsItem.beach_id == beach.id,
                NewsItem.event_type == "closure",
                NewsItem.published_at
                >= now - timedelta(days=_REOPEN_CLOSURE_DAYS),
            )
            .first()
            is not None
        )
        officially_closed = latest is not None and latest.status in (
            BeachState.closed,
            BeachState.warning,
        )
        return had_press_closure or officially_closed
    if latest and (
        latest.status == BeachState.closed
        or (event_type == "warning" and latest.status == BeachState.warning)
    ):
        return False
    return True


def _enrich_with_body(
    art: RawArticle,
    ext: EventExtraction,
    hits: list[Beach],
    beaches: list[Beach],
    extractor,
) -> tuple[EventExtraction, list[Beach], bool]:
    """Segunda pasada híbrida: titular → cuerpo del artículo.

    Se dispara cuando el titular no basta: noticia relevante que no casó
    con ninguna playa (el cuerpo puede nombrar el municipio) o cuya causa
    no está clara (ausente o puramente mecanismo, p.ej. "acceso
    prohibido"). Devuelve (ext, hits, consumió_descarga)."""
    if not ext.relevant:
        return ext, hits, False
    if hits and _short_cause(ext.cause) is not None:
        return ext, hits, False
    body = resolve_and_fetch(art.url)
    if not body:
        return ext, hits, True
    ext2 = extract_event(replace(art, body=body), extractor)
    time.sleep(2)  # segunda llamada LLM: respirar igual que la primera
    if ext2 is None or not ext2.relevant:
        # el titular parecía relevante: no degradar por un cuerpo quizá
        # truncado o de paywall
        return ext, hits, True
    return ext2, match_beaches(ext2, beaches, title=art.title), True


def _push_key(beach: Beach, event_type: str) -> tuple[str, str, str]:
    """Playas multi-PM comparten alerta: una sola notificación por playa
    base + municipio + tipo de evento."""
    base = re.sub(r"\s+PM\d+$", "", beach.name, flags=re.IGNORECASE)
    return (base, beach.municipality or "", event_type)


def _rematch_pending(db, beaches: list[Beach], to_notify: dict) -> int:
    """Reintenta casar relevantes sin playa de pasadas anteriores.

    Recupera noticias cuando mejora el matcher o entran playas nuevas —
    sin gasto LLM (usa lo ya extraído)."""
    pending = (
        db.query(NewsItem)
        .filter(NewsItem.relevant.is_(True), NewsItem.beach_id.is_(None))
        .all()
    )
    rematched = 0
    for item in pending:
        ext = EventExtraction(
            relevant=True,
            confidence=item.confidence or 0.0,
            beach_name=item.extracted_beach,
            municipality=item.extracted_municipality,
        )
        hits = match_beaches(ext, beaches, title=item.title)
        if not hits:
            continue
        item.beach_id = hits[0].id
        for b in hits[1:]:  # misma playa, otro PM: replica la noticia
            db.add(
                NewsItem(
                    url=item.url,
                    title=item.title,
                    source=item.source,
                    published_at=item.published_at,
                    relevant=True,
                    beach_id=b.id,
                    event_type=item.event_type,
                    cause=item.cause,
                    extracted_beach=item.extracted_beach,
                    extracted_municipality=item.extracted_municipality,
                    confidence=item.confidence,
                )
            )
        rematched += 1
        for b in hits:
            if _press_push_candidate(
                db, b, item.event_type, item.published_at, exclude_id=item.id
            ):
                to_notify.setdefault(
                    _push_key(b, item.event_type), (b, item.event_type)
                )
    if rematched:
        db.commit()
    return rematched


def run() -> tuple[int, int, int]:
    """(relevantes insertadas, titulares procesados, recasadas)."""
    if not settings.gemini_api_key:
        print("[news] GEMINI_API_KEY no configurada, se omite la ingesta")
        return 0, 0, 0

    articles = fetch_news()
    extractor = GeminiExtractor(
        api_key=settings.gemini_api_key, model=settings.gemini_model
    )

    db = SessionLocal()
    inserted = processed = 0
    to_notify: dict[tuple[str, str, str], tuple[Beach, str]] = {}
    try:
        seen = {url for (url,) in db.query(NewsItem.url).all()}
        fresh = [
            a
            for a in articles
            if a.url
            and a.url not in seen
            and not source_excluded(a.source)
        ]
        fresh.sort(key=lambda a: a.published_at or _EPOCH, reverse=True)
        beaches = db.query(Beach).all()
        body_left = settings.news_max_body_fetches

        for art in fresh[: settings.news_max_llm_calls]:
            processed += 1
            ext = extract_event(art, extractor)
            if ext is None:
                continue  # fallo del proveedor: se reintenta la próxima pasada
            hits = (
                match_beaches(ext, beaches, title=art.title)
                if ext.relevant else []
            )
            if body_left > 0:
                ext, hits, used = _enrich_with_body(
                    art, ext, hits, beaches, extractor
                )
                body_left -= used
            for beach in hits or [None]:  # una fila por PM de la playa
                if beach and _press_push_candidate(
                    db, beach, ext.event_type, art.published_at
                ):
                    to_notify.setdefault(
                        _push_key(beach, ext.event_type),
                        (beach, ext.event_type),
                    )
                db.add(
                    NewsItem(
                        url=art.url,
                        title=art.title,
                        source=art.source,
                        published_at=art.published_at,
                        relevant=ext.relevant,
                        beach_id=beach.id if beach else None,
                        event_type=ext.event_type,
                        cause=ext.cause,
                        extracted_beach=ext.beach_name,
                        extracted_municipality=ext.municipality,
                        confidence=ext.confidence,
                    )
                )
            try:
                db.commit()  # por artículo: no perder dedup si revienta
            except Exception:
                db.rollback()  # una fila mala no aborta la pasada
                continue
            inserted += ext.relevant
            time.sleep(2)  # free tier de Gemini: respirar entre llamadas
        rematched = _rematch_pending(db, beaches, to_notify)
        # Push de alertas de prensa: tras confirmar todos los inserts
        from app.notify import notify_press_event

        for beach, ev in to_notify.values():
            notify_press_event(db, beach, ev)
        return inserted, processed, rematched
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    inserted, processed, rematched = run()
    print(
        f"News: {inserted} relevantes insertadas ({processed} procesados, "
        f"{rematched} recasadas)"
    )


if __name__ == "__main__":
    main()
