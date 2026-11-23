"""Re-extracción quirúrgica de `closure_not_enforced` en ítems ya
almacenados: busca titulares que afirman que la playa siguió abierta
pese a una prohibición declarada ("no se cerró", "permaneció abierta",
"protocolo fantasma"…) y vuelve a pasar el extractor SOLO sobre esos
ítems, actualizando únicamente la marca (los demás campos no se tocan).

Uso:
    python -m scripts.flag_not_enforced            # aplica
    python -m scripts.flag_not_enforced --dry-run  # solo muestra
    python -m scripts.flag_not_enforced --ids 2585,2586
"""

import argparse
import re
import sys

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import NewsItem
from app.news_llm import GeminiExtractor
from app.news_sources import RawArticle

# Titulares que AFIRMAN no-ejecución del cierre. «Abierta al baño» a
# secas queda fuera a propósito — una reapertura legítima también la
# dice ("Reabierta al baño tras…") y no es cierre de papel
CANDIDATE_RE = re.compile(
    r"sigue abierta|sigui[óo] abierta|permaneci[óo] abierta"
    r"|no se cerr[óo]|no se cerrara|sin que se haya cerrado"
    r"|nunca (la )?cerr[óo]|protocolo fantasma|para no cerrar",
    re.I,
)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--ids", help="ids concretas separadas por coma (salta el regex)"
    )
    ap.add_argument(
        "--full",
        action="store_true",
        help="aplica la extracción completa (event_type, causa, etc.), "
        "no solo la marca — para ítems clasificados antes de que "
        "existiera event_type",
    )
    args = ap.parse_args()

    if not settings.gemini_api_key:
        print("GEMINI_API_KEY no configurada")
        return 2
    extractor = GeminiExtractor(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        fallback_model=settings.gemini_fallback_model,
    )

    db = SessionLocal()
    try:
        q = select(NewsItem).where(NewsItem.relevant.is_(True))
        if args.ids:
            q = q.where(NewsItem.id.in_([int(i) for i in args.ids.split(",")]))
        items = [
            i
            for i in db.scalars(q).all()
            if args.ids or CANDIDATE_RE.search(i.title or "")
        ]
        print(f"{len(items)} ítems candidatos")
        changed = 0
        for it in items:
            art = RawArticle(
                title=it.title or "",
                url=it.url,
                source=it.source,
                published_at=it.published_at,
            )
            ext = extractor.extract(art)
            if ext is None:
                print(f"  id={it.id} extractor falló ({extractor.last_error})")
                continue
            new = bool(ext.closure_not_enforced)
            mark = "OK" if new == bool(it.closure_not_enforced) else "CAMBIA"
            print(
                f"  {mark} id={it.id} playa={it.beach_id} "
                f"{it.closure_not_enforced} -> {new} · "
                f"{(it.title or '')[:80]}"
            )
            if args.full:
                # Re-extracción completa: el ítem viejo gana tipo y
                # causa — sin tipo no se casa a ningún episodio y la
                # marca quedaba huérfana (San Juan PM5)
                changed += 1
                if not args.dry_run:
                    it.event_type = ext.event_type
                    it.cause = ext.cause
                    it.closed_since = ext.closed_since
                    it.scope = ext.scope
                    it.closure_not_enforced = new
                    it.extracted_beach = ext.beach_name
                    it.extracted_municipality = ext.municipality
                    it.confidence = ext.confidence
                    it.evidence_quote = ext.evidence_quote
                    print(f"      tipo={ext.event_type} causa={ext.cause}")
            elif new != bool(it.closure_not_enforced):
                changed += 1
                if not args.dry_run:
                    it.closure_not_enforced = new
        if not args.dry_run:
            db.commit()
        print(
            f"{changed} ítems actualizados"
            + (" (dry)" if args.dry_run else "")
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
