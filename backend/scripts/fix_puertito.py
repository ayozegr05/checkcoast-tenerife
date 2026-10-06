"""Reparación Puertito (2026-09-30):
1. Borra news_items.id=485 — réplica del artículo eldia.es del 13-may
   ("dos playas de Adeje" = Troya I y II) mal casada al Puertito; la
   misma URL ya está casada bien en los ids 330/331 (playas 12/13).
2. Ingiere por URL directa las noticias reales que Google News no
   trajo: reaperturas del 9-may y 6-jun + cierres del 5-jun.
   Extracción con cuerpo completo → body_verified=True.
"""
import re
import time
from datetime import UTC, datetime

import trafilatura
from curl_cffi import requests as creq

from app.config import settings
from app.db import SessionLocal
from app.models import Beach, NewsItem
from app.news_llm import GeminiExtractor, extract_event
from app.news_matching import match_beaches
from app.news_sources import RawArticle

# (url, fecha real de publicación — el meta og:published_time puede
# diferir; las verifiqué una a una en la web)
URLS = [
    # Reapertura 9-may-2025: Troya I + Puertito
    ("https://www.europapress.es/islas-canarias/noticia-reabiertas-bano-playas-troya-puertito-adeje-tenerife-20250509185255.html",
     datetime(2025, 5, 9, 18, 52, tzinfo=UTC)),
    ("https://diariodeavisos.elespanol.com/2025/05/reabren-el-bano-en-dos-playas-del-sur-de-tenerife-la-calidad-del-agua-es-optima/",
     datetime(2025, 5, 9, tzinfo=UTC)),
    ("https://www.rtvc.es/cerradas-al-bano-las-playas-de-troya-i-y-el-puertito-en-adeje-en-el-sur-de-tenerife/",
     datetime(2025, 5, 9, 16, 40, tzinfo=UTC)),
    # Cierre 5-jun-2025 (el "de nuevo")
    ("https://www.eldiario.es/canariasahora/tenerifeahora/sur/cerrado-nuevo-bano-puertito-adeje-altos-niveles-bacterias-fecales_1_12359734.html",
     datetime(2025, 6, 5, tzinfo=UTC)),
    ("https://diariodeavisos.elespanol.com/2025/06/cerrado-al-bano-una-playa-en-adeje-por-altos-niveles-de-bacterias-fecales/",
     datetime(2025, 6, 5, tzinfo=UTC)),
    ("https://www.atlanticohoy.com/tenerife/dos-playas-mas-prohiben-bano-en-tenerife-por-contaminacion_1546157_102.html",
     datetime(2025, 6, 5, tzinfo=UTC)),
    # Reapertura 6-jun-2025
    ("https://www.eldia.es/tenerife/2025/06/06/ayuntamiento-adeje-reabre-bano-puertito-118328853.html",
     datetime(2025, 6, 6, 15, 43, tzinfo=UTC)),
    ("https://diariodeavisos.elespanol.com/2025/06/reabierta-al-bano-la-playa-de-adeje-tras-las-ultimas-analiticas/",
     datetime(2025, 6, 6, tzinfo=UTC)),
    ("https://eldigitalsur.com/tenerifesur/adeje/adeje-reabre-bano-puertito-calidad-agua/",
     datetime(2025, 6, 6, 10, 8, tzinfo=UTC)),
]

_TITLE_RE = re.compile(r"<title[^>]*>([^<]+)</title>", re.IGNORECASE)


def fetch(url):
    try:
        r = creq.get(url, impersonate="chrome", timeout=20)
        if not r.ok:
            return None, None
    except Exception as e:
        print("   fetch fail:", e)
        return None, None
    body = trafilatura.extract(r.text)
    m = _TITLE_RE.search(r.text)
    title = m.group(1).split("|")[0].strip() if m else url
    return title, body


def main():
    db = SessionLocal()
    # 1. quitar la réplica mal casada (misma URL ya en 330/331)
    row = db.get(NewsItem, 485)
    if row and "117354251" in (row.url or ""):
        print("borrando news_items id=485 (Troya I/II mal casada a 91)")
        db.delete(row)
        db.commit()

    extractor = GeminiExtractor(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        fallback_model=settings.gemini_fallback_model,
    )
    beaches = db.query(Beach).all()
    seen = {u for (u,) in db.query(NewsItem.url).all()}

    for url, pub in URLS:
        if url in seen:
            print("ya en BD:", url[:80])
            continue
        title, body = fetch(url)
        if not body:
            print("sin cuerpo:", url[:80])
            continue
        dom = re.sub(r"^www\.", "", url.split("/")[2])
        source = {
            "europapress.es": "Europa Press",
            "diariodeavisos.elespanol.com": "Diario de Avisos",
            "rtvc.es": "RTVC",
            "eldiario.es": "elDiario.es",
            "atlanticohoy.com": "Atlántico Hoy",
            "eldia.es": "El Día",
            "eldigitalsur.com": "El Digital Sur",
        }.get(dom, dom)
        art = RawArticle(title=title, url=url, source=source,
                         published_at=pub, body=body)
        ext = extract_event(art, extractor)
        time.sleep(2)
        if ext is None:
            print("LLM fail:", url[:80])
            continue
        hits = match_beaches(ext, beaches, title=title) if ext.relevant else []
        print(f"-> {ext.event_type} | {ext.cause} | "
              f"beach={[b.id for b in hits]} | {title[:60]}")
        for beach in hits or [None]:
            db.add(NewsItem(
                url=url, title=title, source=source,
                published_at=pub, relevant=ext.relevant,
                beach_id=beach.id if beach else None,
                event_type=ext.event_type, cause=ext.cause,
                closed_since=ext.closed_since,
                extracted_beach=ext.beach_name,
                extracted_municipality=ext.municipality,
                confidence=ext.confidence,
                body_verified=True,  # extracción sobre cuerpo completo
            ))
        db.commit()


if __name__ == "__main__":
    main()
