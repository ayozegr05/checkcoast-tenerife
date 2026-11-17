"""Comparación en seco de extractores sobre artículos reales, sin escribir BD.

--candidate-file permite probar un news_llm.py aún no desplegado frente
al módulo actual. Cada URL se descarga una vez para comparar el mismo texto.
La salida JSONL permite conservar resultados y errores sin repetir llamadas.
"""

import argparse
import importlib.util
import json
import sys
from dataclasses import asdict

from app import news_llm
from app.config import settings
from app.db import SessionLocal
from app.models import NewsItem
from app.news_resolve import resolve_and_fetch
from app.news_sources import RawArticle


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ids", required=True, help="ids separados por comas")
    ap.add_argument("--candidate-file")
    ap.add_argument("--candidate-only", action="store_true")
    ap.add_argument("--model", default=settings.gemini_fallback_model)
    args = ap.parse_args()
    modules = {"baseline": news_llm}
    if args.candidate_file:
        spec = importlib.util.spec_from_file_location(
            "candidate_news_llm", args.candidate_file
        )
        candidate = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = candidate
        spec.loader.exec_module(candidate)
        modules["candidate"] = candidate
        if args.candidate_only:
            modules.pop("baseline")
    else:
        modules = {"candidate": news_llm}
    with SessionLocal() as db:
        for item_id in map(int, args.ids.split(",")):
            row = db.get(NewsItem, item_id)
            if row is None:
                continue
            body = resolve_and_fetch(row.url)
            result = {
                "id": row.id,
                "title": row.title,
                "url": row.url,
                "body_chars": len(body or ""),
                "model": args.model,
            }
            if not body:
                result["error"] = "cuerpo inaccesible; no comparar"
            else:
                art = RawArticle(
                    title=row.title,
                    url=row.url,
                    source=row.source,
                    published_at=row.published_at,
                    body=body,
                )
                for name, module in modules.items():
                    ex = module.GeminiExtractor(
                        api_key=settings.gemini_api_key,
                        model=args.model,
                        **(
                            {"require_evidence": True}
                            if name == "candidate"
                            and hasattr(module, "EVIDENCE_PROMPT")
                            else {}
                        ),
                    )
                    ext = ex.extract(art)
                    result[name] = asdict(ext) if ext else None
                    if ext is None:
                        result[name + "_error"] = getattr(
                            ex, "last_error", "proveedor/parse"
                        )
                    elif hasattr(module, "supported_event"):
                        result[name + "_supported"] = asdict(
                            module.supported_event(ext)
                        )
            print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
