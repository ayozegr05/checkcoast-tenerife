"""Sondeo puntual: cobertura de prensa de un año por playa.

Solo lectura — no escribe en la DB. Usa el mismo fetcher que el
backfill (queries temáticas + una por clave de prensa base, con
after:/before: y prefiltro local) y luego casa por titular con
match_beaches y extracción vacía — conservador y sin gasto de Gemini.
Los que no casan ninguna playa se listan aparte para revisión manual.

Uso: .venv\\Scripts\\python -m scripts.probe_backfill AÑO
       [--from-file FICHERO]   (volcado de `ingest_news --dump`)
"""

import sys
import unicodedata

from app.db import SessionLocal
from app.models import Beach, NewsItem
from app.news_llm import EventExtraction
from app.news_matching import match_beaches
from app.news_sources import (
    backfill_geo_terms,
    fetch_backfill,
    source_excluded,
)
from scripts.ingest_news import _backfill_keys, load_articles


def _norm_text(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def main() -> None:
    # Consola Windows: titulares con caracteres fuera de cp1252
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    argv = sys.argv[1:]
    year = int(argv[0]) if argv and argv[0].isdigit() else 2025
    dump = (
        argv[argv.index("--from-file") + 1] if "--from-file" in argv else None
    )
    with SessionLocal() as db:
        beaches = db.query(Beach).all()
        known_titles = {
            _norm_text(n.title) for n in db.query(NewsItem.title).all()
        }

    articles = (
        load_articles(dump)
        if dump
        else fetch_backfill(
            year, _backfill_keys(beaches), backfill_geo_terms(beaches)
        )
    )
    print(f"{len(articles)} artículos locales únicos (prefiltro)")

    empty = EventExtraction(relevant=True, confidence=0.0)
    matched: dict[int, list] = {}
    unmatched = []
    undated = 0
    wrong_year = 0
    for a in articles:
        if a.source and source_excluded(a.source):
            continue
        if a.published_at is None:
            undated += 1
            continue
        if a.published_at.year != year:
            wrong_year += 1
            continue
        hits = match_beaches(empty, beaches, title=a.title)
        a.known = _norm_text(a.title) in known_titles
        if hits:
            for b in hits:
                matched.setdefault(b.id, []).append(a)
        else:
            unmatched.append(a)

    print(
        f"{year}: {sum(len(v) for v in matched.values())} casados en "
        f"{len(matched)} playas · {len(unmatched)} sin casar · "
        f"{undated} sin fecha · {wrong_year} fuera de año\n"
    )
    name_of = {b.id: f"{b.name} ({b.municipality})" for b in beaches}
    for bid, items in sorted(
        matched.items(), key=lambda kv: min(i.published_at for i in kv[1])
    ):
        print(f"== {name_of[bid]} ==")
        for a in sorted(items, key=lambda x: x.published_at):
            flag = " [YA EN DB]" if a.known else ""
            print(
                f"  {a.published_at:%Y-%m-%d} · {a.source or '?'} · "
                f"{a.title}{flag}"
            )
        print()

    if unmatched:
        print("== SIN CASAR ==")
        for a in sorted(unmatched, key=lambda x: x.published_at):
            flag = " [YA EN DB]" if a.known else ""
            print(
                f"  {a.published_at:%Y-%m-%d} · {a.source or '?'} · "
                f"{a.title}{flag}"
            )


if __name__ == "__main__":
    main()
