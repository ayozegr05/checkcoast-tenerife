"""Ingesta de contexto de prensa (Hito 8.5): Google News RSS → LLM →
news_items.

Por pasada:
1. fetch_news() → titulares recientes (queries temáticas, dedup por URL)
2. descartar URLs ya vistas (unique), fuentes bloqueadas y sin fecha
3. extract_event() (Gemini) sobre cada titular nuevo, con tope
   `news_max_llm_calls` para acotar el gasto del free tier;
   cuota diaria agotada → salto a `gemini_fallback_model`
3b. segunda pasada híbrida (`_enrich_with_body`): titular sin match o
   sin causa clara → cuerpo del artículo (news_resolve) → re-extraer;
   tope `news_max_body_fetches`
4. match_beach() conservador → beach_id o None
5. insertar NewsItem: se guardan también los no relevantes y los no
   casados (dedup por url + auditoría); la API solo sirve los casados

Uso: python -m scripts.ingest_news
"""

import json
import re
import sys
import time
import unicodedata
from dataclasses import replace
from datetime import UTC, datetime, timedelta

from app.config import settings
from app.db import SessionLocal
from app.models import Beach, BeachState, BeachStatus, NewsItem
from app.news_llm import EventExtraction, GeminiExtractor, extract_event
from app.news_matching import _MIN_NAME_LEN, _press_key, match_beaches
from app.news_resolve import resolve_and_fetch
from app.news_sources import (
    GUIA_SOURCE,
    MEDIA_FEEDS,
    MUNICIPAL_FEEDS,
    RawArticle,
    backfill_geo_terms,
    fetch_backfill,
    fetch_guia_page,
    fetch_guia_sitemap,
    fetch_news,
    source_excluded,
)
from app.queries import _short_cause

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def _norm_key(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


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
    now = datetime.now(UTC)
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


# Causas ya específicas (parámetro medido, sustancia o fenómeno físico
# nombrado): con ellas el cuerpo no añadiría nada al porqué. OJO:
# "fecal" NO es terminal — es la familia; el parámetro real (E. coli /
# enterococos) suele vivir solo en el cuerpo, así que "contaminación
# fecal" a secas SÍ dispara la descarga.
_SPECIFIC_CAUSE_KEYS = (
    "enterococo",
    "coli",
    "gasoil",
    "hidrocarburo",
    "fuel",
    "alga",
    "medusa",
    "desprend",
    "talud",
    "derrumbe",
    "corrimiento",
    "colapso",
    "socav",
)


def _cause_is_generic(cause: str | None) -> bool:
    """La causa dice el "qué" sin el "por qué" específico ("mala calidad
    del agua", "contaminación", "vertido" a secas, "avance del mar") —
    el cuerpo del artículo suele nombrar el parámetro o la sustancia
    real, así que merece la descarga."""
    if not cause:
        return False
    t = "".join(
        c
        for c in unicodedata.normalize("NFD", cause.lower())
        if unicodedata.category(c) != "Mn"
    )
    return not any(k in t for k in _SPECIFIC_CAUSE_KEYS)


def _name_is_ambiguous(
    ext: EventExtraction, hits: list[Beach], beaches: list[Beach]
) -> bool:
    """El nombre extraído también es parte del nombre de otra playa
    distinta a las casadas — el titular pudo nombrar la localidad y
    no la playa ("una playa de El Médano" siendo en realidad Leocadio
    Machado). Merece el cuerpo para desambiguar."""
    target = _press_key(ext.beach_name or "")
    if len(target) < _MIN_NAME_LEN:
        return False
    hit_ids = {b.id for b in hits}
    for b in beaches:
        if b.id in hit_ids:
            continue
        keys = [_press_key(b.name)] + [
            _press_key(a) for a in (getattr(b, "press_aliases", None) or [])
        ]
        if any(target in k and k != target for k in keys):
            return True
    return False


def _enrich_with_body(
    art: RawArticle,
    ext: EventExtraction,
    hits: list[Beach],
    beaches: list[Beach],
    extractor,
    rescue: bool = False,
) -> tuple[EventExtraction | None, list[Beach], bool, bool]:
    """Devuelve (ext, hits, consumió_descarga, verificado_por_cuerpo).
    `verificado_por_cuerpo` es True cuando la extracción devuelta se
    obtuvo del cuerpo completo — distinto de la mera descarga, que
    también ocurre cuando el fetch del cuerpo falla."""
    """Segunda pasada híbrida: titular → cuerpo del artículo.

    Se dispara cuando el titular no basta: noticia relevante que no casó
    con ninguna playa (el cuerpo puede nombrar el municipio), cuya causa
    no está clara (ausente o puramente mecanismo, p.ej. "acceso
    prohibido"), es genérica ("mala calidad del agua"/"contaminación"/
    "vertido" a secas — el cuerpo suele nombrar enterococos, E. coli o
    la sustancia) o es "Obras" — la categoría más tramposa: un
    titular que habla de "materiales de obra"/"obras de emergencia" suele
    describir el mecanismo y el cuerpo revela el vertido o el
    desprendimiento real (Candelaria: "obstrucción por materiales de
    obra" era un vertido).

    Las reaperturas SIEMPRE pasan por cuerpo: es el evento más caro de
    equivocar (marcaría abierta una playa cerrada) y un titular ambiguo
    tipo "agilizan las obras para reabrir" se desmonta leyendo el texto
    — un medio con cuerpo verificado vale como corroboración de episodio.

    `rescue=True` (re-extracción): un ítem guardado como relevante cuya
    nueva lectura del titular dice no-relevante se contrasta con el
    cuerpo antes de degradar — el titular pudo extraerse mal, o la fila
    original se extrajo con cuerpo. ext=None en la salida significa
    "sin evidencia nueva: conservar la fila como estaba"."""
    if not ext.relevant:
        if not rescue:
            return ext, hits, False, False
        body = resolve_and_fetch(art.url)
        if not body:
            return None, hits, True, False
        ext2 = extract_event(replace(art, body=body), extractor)
        time.sleep(2)
        if ext2 is not None and ext2.relevant:
            return (
                ext2,
                match_beaches(ext2, beaches, title=art.title),
                True,
                True,
            )
        if ext2 is None:
            return None, hits, True, False
        return ext, hits, True, False  # el cuerpo confirma: no relevante
    cause = _short_cause(ext.cause)
    if (
        hits
        and ext.event_type != "reopening"
        and cause is not None
        and cause != "Obras"
        and not _cause_is_generic(ext.cause)
        and not _name_is_ambiguous(ext, hits, beaches)
    ):
        return ext, hits, False, False
    body = resolve_and_fetch(art.url)
    if not body:
        return ext, hits, True, False
    ext2 = extract_event(replace(art, body=body), extractor)
    time.sleep(2)  # segunda llamada LLM: respirar igual que la primera
    if ext2 is None or not ext2.relevant:
        # el titular parecía relevante: no degradar por un cuerpo quizá
        # truncado o de paywall
        return ext, hits, True, False
    return ext2, match_beaches(ext2, beaches, title=art.title), True, True


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
        # La URL puede tener ya réplicas casadas a algunos de los hits
        # — solo se asignan playas sin fila, o revienta el unique
        # (url, beach_id)
        existing = {
            r
            for (r,) in db.query(NewsItem.beach_id).filter(
                NewsItem.url == item.url,
                NewsItem.beach_id.isnot(None),
            )
        }
        free_hits = list(
            {b.id: b for b in hits if b.id not in existing}.values()
        )
        if not free_hits:
            continue
        item.beach_id = free_hits[0].id
        for b in free_hits[1:]:  # misma playa, otro PM: replica la noticia
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
                    closed_since=item.closed_since,
                    extracted_beach=item.extracted_beach,
                    extracted_municipality=item.extracted_municipality,
                    confidence=item.confidence,
                    body_verified=item.body_verified,
                )
            )
        rematched += 1
        for b in hits:
            # Las guías evergreen no despiertan push: una ficha
            # actualizada no es una noticia de última hora
            if item.source == GUIA_SOURCE:
                continue
            if _press_push_candidate(
                db, b, item.event_type, item.published_at, exclude_id=item.id
            ):
                item.push_pending = True
                key = _push_key(b, item.event_type)
                to_notify.setdefault(key, (b, item.event_type, []))
                to_notify[key][2].append(item)
    if rematched:
        db.commit()
    return rematched


def _sync_guia(db, beaches: list[Beach], extractor) -> int:
    """Guías evergreen de Guía Islas Canarias (Benijo y el resto).

    No son noticias sino fichas mantenidas que afirman el estado real
    ("acceso cerrado desde julio de 2024") — no despiertan push. El
    sitemap trae `lastmod` por URL: solo se re-descarga/extrae una
    guía cuando su ficha cambió desde la última vez que la guardamos.
    """
    try:
        pages = fetch_guia_sitemap()
    except Exception:
        return 0
    synced = 0
    for url, lastmod in pages:
        if lastmod is None:
            continue
        if synced >= settings.news_max_guia_fetches:
            break  # free tier: el resto de fichas, en la próxima pasada
        rows = (
            db.query(NewsItem)
            .filter(NewsItem.url == url, NewsItem.source == GUIA_SOURCE)
            .all()
        )
        if rows and all(
            r.published_at is not None and r.published_at >= lastmod
            for r in rows
        ):
            continue  # la ficha no cambió desde la última pasada
        fetched = fetch_guia_page(url)
        if fetched is None:
            continue
        title, body = fetched
        art = RawArticle(
            title=title,
            url=url,
            source=GUIA_SOURCE,
            published_at=lastmod,
            body=body,
        )
        ext = extract_event(art, extractor)
        if ext is None:
            continue  # fallo del proveedor: reintento la próxima pasada
        hits = match_beaches(ext, beaches, title=title) if ext.relevant else []
        if rows:
            # Ficha ya vista: actualizamos la extracción en las filas
            # que existan (la misma URL replicada por PM)
            for row in rows:
                row.relevant = ext.relevant
                row.event_type = ext.event_type
                row.cause = ext.cause
                row.closed_since = ext.closed_since
                row.extracted_beach = ext.beach_name
                row.extracted_municipality = ext.municipality
                row.confidence = ext.confidence
                row.title = title
                row.published_at = lastmod
            # Si antes no casó y ahora sí (o casan más PMs), se rellena
            # primero la fila sin playa (si existe) y se crean las que
            # falten — así _rematch_pending no duplica en la próxima
            # pasada
            have = {r.beach_id for r in rows}
            for b in hits:
                if b.id in have:
                    continue
                free = next((r for r in rows if r.beach_id is None), None)
                if free is not None:
                    free.beach_id = b.id
                else:
                    db.add(
                        NewsItem(
                            url=url,
                            title=title,
                            source=GUIA_SOURCE,
                            published_at=lastmod,
                            relevant=ext.relevant,
                            beach_id=b.id,
                            event_type=ext.event_type,
                            cause=ext.cause,
                            closed_since=ext.closed_since,
                            extracted_beach=ext.beach_name,
                            extracted_municipality=ext.municipality,
                            confidence=ext.confidence,
                        )
                    )
                have.add(b.id)
            db.commit()
        else:
            for beach in hits or [None]:
                db.add(
                    NewsItem(
                        url=url,
                        title=title,
                        source=GUIA_SOURCE,
                        published_at=lastmod,
                        relevant=ext.relevant,
                        beach_id=beach.id if beach else None,
                        event_type=ext.event_type,
                        cause=ext.cause,
                        closed_since=ext.closed_since,
                        extracted_beach=ext.beach_name,
                        extracted_municipality=ext.municipality,
                        confidence=ext.confidence,
                    )
                )
            db.commit()
        synced += 1
        time.sleep(2)
    return synced


def _backfill_keys(beaches: list[Beach]) -> list[str]:
    """Claves de prensa base (sin sufijo PM) de cada playa nombrada —
    una query por playa en el backfill."""
    return sorted(
        {
            k
            for b in beaches
            for k in (
                [_press_key(re.sub(r"\s+PM\d+$", "", b.name))]
                + [
                    _press_key(a)
                    for a in (getattr(b, "press_aliases", None) or [])
                ]
            )
            if b.name and len(k) >= _MIN_NAME_LEN
        }
    )


def dump_articles(articles: list[RawArticle], path: str) -> None:
    rows = [
        {
            "title": a.title,
            "url": a.url,
            "source": a.source,
            "published_at": (
                a.published_at.isoformat() if a.published_at else None
            ),
        }
        for a in articles
    ]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)


def load_articles(path: str) -> list[RawArticle]:
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    return [
        RawArticle(
            title=r["title"],
            url=r["url"],
            source=r.get("source"),
            published_at=(
                datetime.fromisoformat(r["published_at"])
                if r.get("published_at")
                else None
            ),
        )
        for r in rows
    ]


def fetch_backfill_for(db, year: int) -> list[RawArticle]:
    beaches = db.query(Beach).all()
    return fetch_backfill(
        year, _backfill_keys(beaches), backfill_geo_terms(beaches)
    )


def run(
    backfill_year: int | None = None, articles_file: str | None = None
) -> tuple[int, int, int]:
    """(relevantes insertadas, titulares procesados, recasadas).

    backfill_year: ingesta histórica de un año concreto vía operadores
    de fecha de Google News. Sin topes de llamadas (el volumen lo acota
    el prefiltro local), sin sweep de guías, sin rematch y SIN push:
    noticias de hace un año no despiertan el móvil.

    articles_file: titulares ya descargados con `--dump` (se salta
    Google News). Reanudable: lo ya guardado en news_items se omite."""
    if not settings.gemini_api_key:
        print("[news] GEMINI_API_KEY no configurada, se omite la ingesta")
        return 0, 0, 0

    backfill = backfill_year is not None
    extractor = GeminiExtractor(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        fallback_model=settings.gemini_fallback_model,
    )

    db = SessionLocal()
    inserted = processed = 0
    to_notify: dict[
        tuple[str, str, str], tuple[Beach, str, list[NewsItem]]
    ] = {}
    try:
        beaches = db.query(Beach).all()
        if backfill and articles_file:
            articles = load_articles(articles_file)
        elif backfill:
            articles = fetch_backfill_for(db, backfill_year)
        else:
            articles = fetch_news()

        seen = {url for (url,) in db.query(NewsItem.url).all()}
        # Mismo artículo por dos vías (redirect Google News + URL directa
        # del feed del medio): dedup extra por (título, medio, día). El
        # source se compara por contención normalizada — Google guarda
        # "diariodeavisos.elespanol.com" y el feed "Diario de Avisos".
        # En backfill se aplica a TODAS las fuentes: el mismo artículo
        # viejo pudo entrar ya por el feed del medio con otra URL
        feed_labels = set(MUNICIPAL_FEEDS) | set(MEDIA_FEEDS)
        seen_triples = {
            (_norm_key(t), _norm_key(s), p.date() if p else None)
            for t, s, p in db.query(
                NewsItem.title, NewsItem.source, NewsItem.published_at
            )
        }
        fresh = []
        for a in articles:
            if not a.url or a.url in seen or source_excluded(a.source):
                continue
            if backfill or a.source in feed_labels:
                tk, sk = _norm_key(a.title), _norm_key(a.source)
                day = a.published_at.date() if a.published_at else None
                if any(
                    et == tk and ed == day and (ek in sk or sk in ek)
                    for et, ek, ed in seen_triples
                ):
                    continue
            fresh.append(a)
        fresh.sort(key=lambda a: a.published_at or _EPOCH, reverse=True)
        # Backfill sin tope de extracciones ni de cuerpos: el prefiltro
        # local ya recortó el grueso del ruido y un límite cortaría
        # episodios al azar según el orden de la lista
        llm_left = len(fresh) if backfill else settings.news_max_llm_calls
        body_left = len(fresh) if backfill else settings.news_max_body_fetches

        for art in fresh[:llm_left]:
            processed += 1
            ext = extract_event(art, extractor)
            if ext is None:
                if extractor.exhausted:
                    processed -= 1
                    print(
                        "[news] cuota diaria de Gemini agotada: se corta "
                        "la pasada; relanza el mismo comando mañana y "
                        "seguirá donde lo dejó"
                    )
                    break
                continue  # fallo del proveedor: se reintenta la próxima pasada
            hits = (
                match_beaches(ext, beaches, title=art.title)
                if ext.relevant
                else []
            )
            verified = False
            if body_left > 0:
                ext, hits, used, verified = _enrich_with_body(
                    art, ext, hits, beaches, extractor
                )
                body_left -= used
            for beach in hits or [None]:  # una fila por PM de la playa
                item = NewsItem(
                    url=art.url,
                    title=art.title,
                    source=art.source,
                    published_at=art.published_at,
                    relevant=ext.relevant,
                    beach_id=beach.id if beach else None,
                    event_type=ext.event_type,
                    cause=ext.cause,
                    closed_since=ext.closed_since,
                    extracted_beach=ext.beach_name,
                    extracted_municipality=ext.municipality,
                    confidence=ext.confidence,
                    body_verified=verified,
                )
                if (
                    not backfill
                    and beach
                    and _press_push_candidate(
                        db, beach, ext.event_type, art.published_at
                    )
                ):
                    item.push_pending = True
                    key = _push_key(beach, ext.event_type)
                    to_notify.setdefault(key, (beach, ext.event_type, []))
                    to_notify[key][2].append(item)
                db.add(item)
            try:
                db.commit()  # por artículo: no perder dedup si revienta
            except Exception:
                db.rollback()  # una fila mala no aborta la pasada
                continue
            inserted += ext.relevant
            time.sleep(2)  # free tier de Gemini: respirar entre llamadas
        rematched = 0
        if not backfill:
            rematched = _rematch_pending(db, beaches, to_notify)
            guia = _sync_guia(db, beaches, extractor)
            if guia:
                print(
                    f"[guia] {guia} fichas de Guía Islas Canarias "
                    f"sincronizadas"
                )
            # Push de alertas de prensa: tras confirmar los inserts
            from app.notify import notify_press_event

            # Reintento: lo que una pasada anterior quiso notificar y
            # no salió (red caída, Expo 5xx, proceso muerto) se vuelve
            # a encolar mientras siga dentro de la ventana de dedup
            queued = {it.id for v in to_notify.values() for it in v[2]}
            stale = (
                db.query(NewsItem)
                .filter(
                    NewsItem.push_pending.is_(True),
                    NewsItem.pushed_at.is_(None),
                    NewsItem.published_at
                    >= datetime.now(UTC) - timedelta(days=_PRESS_PUSH_DAYS),
                )
                .all()
            )
            for it in stale:
                if it.id in queued:
                    continue
                b = it.beach
                if b is None:
                    it.pushed_at = datetime.now(UTC)  # nunca saldrá
                    continue
                key = _push_key(b, it.event_type)
                to_notify.setdefault(key, (b, it.event_type, []))
                to_notify[key][2].append(it)

            now = datetime.now(UTC)
            for beach, ev, items in to_notify.values():
                try:
                    sent = notify_press_event(db, beach, ev)
                except Exception as e:
                    print(f"[push] fallo en {beach.name} ({ev}): {e}")
                    sent = 0
                if sent:
                    for it in items:
                        it.pushed_at = now
                        it.push_pending = False
                    db.commit()
        return inserted, processed, rematched
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _arg(argv: list[str], flag: str) -> str | None:
    return argv[argv.index(flag) + 1] if flag in argv else None


def main() -> None:
    # Uso: python -m scripts.ingest_news
    #        [--backfill AÑO [--dump FICHERO | --from-file FICHERO]]
    # --dump: solo descarga y prefiltra los titulares (sin Gemini, sin
    # escribir en la DB); --from-file: ingesta desde ese volcado
    argv = sys.argv[1:]
    year_arg = _arg(argv, "--backfill")
    year = int(year_arg) if year_arg else None
    dump_path = _arg(argv, "--dump")
    if dump_path:
        if year is None:
            sys.exit("--dump requiere --backfill AÑO")
        with SessionLocal() as db:
            articles = fetch_backfill_for(db, year)
        dump_articles(articles, dump_path)
        print(f"{len(articles)} titulares de {year} volcados en {dump_path}")
        return
    inserted, processed, rematched = run(
        backfill_year=year, articles_file=_arg(argv, "--from-file")
    )
    print(
        f"News: {inserted} relevantes insertadas ({processed} procesados, "
        f"{rematched} recasadas)"
    )


if __name__ == "__main__":
    main()
