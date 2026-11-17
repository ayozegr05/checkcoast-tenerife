"""Auditoría reanudable de prensa; los cambios de estado son propuestas.

python -m scripts.reextract_news --year 2025 --max 20
python -m scripts.reextract_news --report
python -m scripts.reextract_news --accept ID  # aplica la propuesta guardada
python -m scripts.reextract_news --reject ID  # conserva la clasificación

La campaña depende del prompt, esquema, modelo y versión del proceso.
El progreso y las propuestas viven en PostgreSQL, no en el contenedor.
No llama al rematch global ni aplica cambios de estado automáticamente.
"""

import argparse
import hashlib
import json
from dataclasses import asdict
from datetime import UTC, datetime

from sqlalchemy import extract, or_, text

from app.config import settings
from app.db import SessionLocal
from app.models import Beach, NewsExtractionReview, NewsItem
from app.news_infra import INFRA_EVENT_TYPE
from app.news_llm import (
    EVIDENCE_PROMPT,
    SCHEMA,
    GeminiExtractor,
    extract_event,
    supported_event,
)
from app.news_matching import match_beaches
from app.news_resolve import resolve_and_fetch
from app.news_sources import GUIA_SOURCE, RawArticle
from app.news_zones import narrow_hits_by_zone

TERMINAL = {
    "unchanged",
    "review",
    "locked",
    "unavailable",
    "accepted",
    "rejected",
}
STATE_FIELDS = ("relevant", "event_type", "cause", "scope", "closed_since")
EXTRACTED_FIELDS = (
    *STATE_FIELDS,
    "extracted_beach",
    "extracted_municipality",
    "confidence",
    "body_verified",
    "evidence_quote",
)
SNAPSHOT_FIELDS = (
    "id",
    "beach_id",
    "locked",
    "title",
    "source",
    *EXTRACTED_FIELDS,
)
AUDIT_LOCK = 71400317


def campaign_key(model: str, fallback: str | None) -> str:
    return hashlib.sha256(
        json.dumps(
            ["review-v1", EVIDENCE_PROMPT, SCHEMA, model, fallback],
            sort_keys=True,
        ).encode()
    ).hexdigest()


def snapshot(rows: list[NewsItem]) -> list[dict]:
    return [
        {field: getattr(row, field) for field in SNAPSHOT_FIELDS}
        for row in sorted(rows, key=lambda r: r.id)
    ]


def review_reasons(rows: list[NewsItem], proposal: dict) -> list[str]:
    """Conservar valores revisados, reaperturas, causas y asociaciones."""
    fields = proposal["fields"]
    reasons = []
    if {r.beach_id for r in rows} != set(proposal["beach_ids"]):
        reasons.append("cambio de asociación con playas")
    for field in STATE_FIELDS:
        if any(getattr(row, field) != fields[field] for row in rows):
            reasons.append(f"cambio de {field}")
    for field in ("extracted_beach", "extracted_municipality"):
        if any(getattr(row, field) != fields[field] for row in rows):
            reasons.append(f"cambio de {field}")
    if fields["event_type"] == "reopening" and any(
        row.body_verified != fields["body_verified"] for row in rows
    ):
        reasons.append("cambio de corroboración de reapertura")
    if (
        proposal["raw_event"] in ("closure", "reopening")
        and fields["event_type"] != proposal["raw_event"]
    ):
        reasons.append("cierre/reapertura sin cita literal suficiente")
    return reasons


def make_proposal(
    ext, hits, verified: bool, title: str = "", body: str = ""
) -> dict:
    grounded = supported_event(ext, title, body)
    fields = asdict(grounded)
    fields["extracted_beach"] = fields.pop("beach_name")
    fields["extracted_municipality"] = fields.pop("municipality")
    fields["body_verified"] = verified
    return {
        "fields": fields,
        "beach_ids": sorted({b.id for b in hits}) or [None],
        "raw_event": ext.event_type,
    }


def apply_proposal(db, rows: list[NewsItem], proposal: dict, lock=False):
    """Aplica la propuesta ya revisada, sin volver a llamar al LLM."""
    source = rows[0]
    targets = proposal["beach_ids"]
    # Conserva ids de las réplicas que siguen casadas. Borra primero las
    # sobrantes para respetar UNIQUE(url, beach_id) NULLS NOT DISTINCT.
    keep = {r.beach_id: r for r in rows if r.beach_id in targets}
    for row in rows:
        if row.beach_id not in targets:
            db.delete(row)
    db.flush()
    for bid in targets:
        row = keep.get(bid)
        if row is None:
            row = NewsItem(
                url=source.url,
                title=source.title,
                source=source.source,
                published_at=source.published_at,
                beach_id=bid,
                infra_outfall_id=source.infra_outfall_id,
                infra_checked_at=source.infra_checked_at,
                infra_cause=source.infra_cause,
            )
            db.add(row)
        for field in EXTRACTED_FIELDS:
            setattr(row, field, proposal["fields"][field])
        if lock:
            row.locked = True
        # Una corrección del histórico nunca debe despertar notificaciones.
        if lock:
            row.push_pending = False


def decide(db, review_id: int, accept: bool) -> None:
    review = db.get(NewsExtractionReview, review_id)
    if review is None or review.status != "review" or not review.proposal:
        raise ValueError("La propuesta no existe o ya no está pendiente")
    rows = (
        db.query(NewsItem)
        .filter(NewsItem.url == review.url)
        .order_by(NewsItem.id)
        .with_for_update()
        .all()
    )
    if snapshot(rows) != review.before or any(r.locked for r in rows):
        raise ValueError(
            "La evidencia cambió; no se aplica una propuesta obsoleta"
        )
    if accept:
        apply_proposal(db, rows, review.proposal, lock=True)
        review.status = "accepted"
    else:
        for row in rows:
            row.locked = True
        review.status = "rejected"
    review.updated_at = datetime.now(UTC)
    db.commit()


def audit(db, extractor, args) -> int:
    campaign = campaign_key(args.model, args.fallback)
    print(f"Campaña: {campaign}", flush=True)
    q = db.query(NewsItem).filter(
        NewsItem.source != GUIA_SOURCE,
        or_(
            NewsItem.event_type.is_(None),
            NewsItem.event_type != INFRA_EVENT_TYPE,
        ),
    )
    if not args.all:
        q = q.filter(NewsItem.relevant.is_(True))
    if args.year:
        q = q.filter(extract("year", NewsItem.published_at) == args.year)
    if args.beach:
        q = q.join(Beach).filter(Beach.name.ilike(f"%{args.beach}%"))
    # Orden estable y límite DESPUÉS de excluir URLs ya terminadas/curadas.
    selected = q.order_by(
        NewsItem.published_at.desc().nulls_last(), NewsItem.id
    ).all()
    urls = list(dict.fromkeys(n.url for n in selected))
    records = {
        r.url: r
        for r in db.query(NewsExtractionReview)
        .filter(NewsExtractionReview.campaign == campaign)
        .all()
    }
    beaches = db.query(Beach).all()
    counts = dict(attempted=0, unchanged=0, review=0, locked=0, unavailable=0)
    for url in urls:
        record = records.get(url)
        if record and record.status in TERMINAL:
            continue
        if counts["attempted"] >= args.max:
            break
        rows = (
            db.query(NewsItem)
            .filter(NewsItem.url == url)
            .order_by(NewsItem.id)
            .all()
        )
        before = snapshot(rows)
        if record is None:
            record = NewsExtractionReview(
                campaign=campaign,
                url=url,
                status="pending",
                before=before,
                attempts=0,
            )
        record.before = before
        record.updated_at = datetime.now(UTC)
        record.proposal = None
        record.reason = None
        if any(r.locked for r in rows):
            record.status = "locked"
            counts["locked"] += 1
        else:
            counts["attempted"] += 1
            record.attempts += 1
            # Histórico siempre con cuerpo: el titular solo no debe
            # reemplazar una extracción que pudo basarse en el artículo.
            body = resolve_and_fetch(url)
            if not body:
                record.status = "unavailable"
                record.reason = "Cuerpo inaccesible; requiere revisión manual"
                counts["unavailable"] += 1
            else:
                row = rows[0]
                art = RawArticle(
                    title=row.title,
                    url=url,
                    source=row.source,
                    published_at=row.published_at,
                    body=body,
                )
                ext = extract_event(art, extractor)
                if ext is None:
                    record.status = "failed"
                    record.reason = (
                        extractor.last_error or "Extracción fallida"
                    )
                    if not args.dry_run:
                        db.add(record)
                        db.commit()
                    print(
                        f"STOP proveedor: {record.reason}; URL pendiente, "
                        f"sin cambios. {counts}",
                        flush=True,
                    )
                    return 2
                hits = (
                    match_beaches(ext, beaches, title=art.title)
                    if ext.relevant
                    else []
                )
                hits = narrow_hits_by_zone(
                    hits,
                    ext.beach_name,
                    art.title,
                    body=body,
                    all_beaches=beaches,
                )
                proposal = make_proposal(
                    ext,
                    hits,
                    verified=True,
                    title=art.title,
                    body=art.body or "",
                )
                reasons = review_reasons(rows, proposal)
                # Releer antes de aplicar: la ingesta/curaduría pudo cambiar
                # el artículo mientras esperábamos al proveedor.
                current = (
                    db.query(NewsItem)
                    .filter(NewsItem.url == url)
                    .order_by(NewsItem.id)
                    .populate_existing()
                    .with_for_update()
                    .all()
                )
                if snapshot(current) != before:
                    record.status = "failed"
                    record.reason = "La evidencia cambió durante la extracción"
                    if not args.dry_run:
                        db.add(record)
                        db.commit()
                    return 2
                record.proposal = proposal
                if reasons:
                    record.status = "review"
                    record.reason = "; ".join(reasons)
                    counts["review"] += 1
                else:
                    record.status = "unchanged"
                    counts["unchanged"] += 1
                    if not args.dry_run:
                        apply_proposal(db, current, proposal)
        if not args.dry_run:
            db.add(record)
            db.commit()
        print(
            f"[{record.status}] review={record.id} {rows[0].title[:80]} "
            f"{record.reason or ''}",
            flush=True,
        )
        if args.dry_run:
            db.rollback()
    print(f"Resumen: {counts}", flush=True)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--year", type=int)
    ap.add_argument("--beach")
    ap.add_argument("--max", type=int, default=20)
    ap.add_argument("--all", action="store_true", help="incluir no relevantes")
    ap.add_argument(
        "--dry-run", action="store_true", help="sin escrituras ni progreso"
    )
    ap.add_argument("--model", default=settings.gemini_model)
    ap.add_argument("--fallback", default=settings.gemini_fallback_model)
    decision = ap.add_mutually_exclusive_group()
    decision.add_argument("--accept", type=int, metavar="ID")
    decision.add_argument("--reject", type=int, metavar="ID")
    decision.add_argument("--report", action="store_true")
    args = ap.parse_args()
    if args.max < 1:
        ap.error("--max debe ser positivo")
    if args.dry_run and (args.accept or args.reject):
        ap.error("--dry-run no se combina con decisiones")
    # Lock en conexión dedicada: los commits del trabajo no lo liberan.
    with SessionLocal() as db, db.bind.connect() as lock:
        if not lock.execute(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": AUDIT_LOCK}
        ).scalar():
            print("Ya hay una auditoría en marcha", flush=True)
            return 3
        try:
            if args.report:
                for r in (
                    db.query(NewsExtractionReview)
                    .filter(
                        NewsExtractionReview.status.in_(
                            ["review", "failed", "unavailable"]
                        )
                    )
                    .order_by(NewsExtractionReview.id)
                ):
                    print(
                        json.dumps(
                            {
                                "id": r.id,
                                "status": r.status,
                                "url": r.url,
                                "before": r.before,
                                "proposal": r.proposal,
                                "reason": r.reason,
                            },
                            ensure_ascii=False,
                        )
                    )
                return 0
            if args.accept or args.reject:
                decide(
                    db, args.accept or args.reject, accept=bool(args.accept)
                )
                return 0
            if not settings.gemini_api_key:
                ap.error("GEMINI_API_KEY no configurada")
            extractor = GeminiExtractor(
                api_key=settings.gemini_api_key,
                model=args.model,
                fallback_model=args.fallback,
                require_evidence=True,
            )
            return audit(db, extractor, args)
        finally:
            lock.execute(
                text("SELECT pg_advisory_unlock(:key)"), {"key": AUDIT_LOCK}
            )


if __name__ == "__main__":
    raise SystemExit(main())
