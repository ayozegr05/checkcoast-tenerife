from typing import cast as tcast

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, literal
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Beach, NewsItem, Outfall, OutfallStatus
from app.news_infra import (
    INFRA_TITLE_RE,
    norm_txt,
    outfall_named_patterns,
)
from app.queries import clean_cause_text
from app.schemas import (
    Feature,
    FeatureCollection,
    OutfallNearbyBeachOut,
    OutfallNewsItemOut,
    OutfallNewsOut,
    PointGeometry,
)

_NEARBY_BEACH_RADIUS_M = 1500
_OUTFALL_NEWS_RADIUS_M = 2000
_OUTFALL_NEWS_LIMIT = 10

router = APIRouter(tags=["outfalls"])


@router.get("/outfalls", response_model=FeatureCollection)
def list_outfalls(
    status: OutfallStatus | None = Query(
        None, description="Filtrar por legalidad del vertido"
    ),
    kind: str | None = Query(
        None,
        description="Filtrar por tipo de conducción (p. ej. 'Emisario submarino')",
    ),
    db: Session = Depends(get_db),
) -> FeatureCollection:
    q = db.query(
        Outfall.id,
        Outfall.name,
        Outfall.municipality,
        Outfall.kind,
        Outfall.status,
        Outfall.source_url,
        Outfall.fetched_at,
        Outfall.nature,
        Outfall.continuity,
        Outfall.is_active,
        Outfall.condition,
        Outfall.origin,
        Outfall.entity,
        Outfall.protected_area,
        Outfall.settlement,
        Outfall.location,
        Outfall.zone_desc,
        Outfall.manager,
        Outfall.length_m,
        Outfall.outfall_depth,
        Outfall.start_lon,
        Outfall.start_lat,
        Outfall.shore_m,
        func.ST_X(Outfall.geom).label("lon"),
        func.ST_Y(Outfall.geom).label("lat"),
    )
    if status is not None:
        q = q.filter(Outfall.status == status)
    if kind is not None:
        q = q.filter(Outfall.kind == kind)

    features = [
        Feature(
            id=row.id,
            geometry=PointGeometry(coordinates=[row.lon, row.lat]),
            properties={
                "name": row.name,
                "municipality": row.municipality,
                "kind": row.kind,
                "status": row.status.value,
                "nature": row.nature,
                "continuity": row.continuity,
                "is_active": row.is_active,
                "condition": row.condition,
                "origin": row.origin,
                "entity": row.entity,
                "protected_area": row.protected_area,
                "settlement": row.settlement,
                "location": row.location,
                "zone_desc": row.zone_desc,
                "manager": row.manager,
                "length_m": row.length_m,
                "outfall_depth": row.outfall_depth,
                "start_lon": row.start_lon,
                "start_lat": row.start_lat,
                "shore_m": row.shore_m,
                "source_url": row.source_url,
                "fetched_at": row.fetched_at.isoformat()
                if row.fetched_at
                else None,
            },
        )
        for row in q.all()
    ]
    return FeatureCollection(features=features)


@router.get(
    "/outfalls/{outfall_id}/nearby-beaches",
    response_model=list[OutfallNearbyBeachOut],
)
def outfall_nearby_beaches(
    outfall_id: int, db: Session = Depends(get_db)
) -> list[OutfallNearbyBeachOut]:
    """Playas catalogadas en un radio de 1.5 km del vertido, ordenadas
    por distancia (metros reales, geography). Es proximidad geométrica
    — no implica que Sanidad vincule el vertido a ninguna de ellas."""
    outfall = db.get(Outfall, outfall_id)
    if outfall is None:
        raise HTTPException(status_code=404, detail="Outfall not found")
    # outfall.geom ya está cargado (ORM) — se usa como parámetro en vez
    # de referenciar la tabla outfalls, para que el FROM solo tenga
    # beaches (evita el cartesian product warning de SQLAlchemy)
    outfall_geog = cast(literal(outfall.geom, type_=Geometry), Geography)
    distance = func.ST_Distance(
        Beach.geom.cast(Geography), outfall_geog
    ).label("distance_m")
    rows = (
        db.query(Beach.id, Beach.name, Beach.municipality, distance)
        .filter(
            func.ST_DWithin(
                Beach.geom.cast(Geography),
                outfall_geog,
                _NEARBY_BEACH_RADIUS_M,
            )
        )
        .order_by("distance_m")
        .limit(5)
        .all()
    )
    return [
        OutfallNearbyBeachOut(
            outfall_id=outfall.id,
            beach_id=row.id,
            beach_name=row.name,
            municipality=row.municipality,
            distance_m=row.distance_m,
        )
        for row in rows
    ]


def _outfall_news_out(
    n: NewsItem, beach_name: str | None
) -> OutfallNewsItemOut:
    return OutfallNewsItemOut(
        id=n.id,
        beach_id=tcast(int, n.beach_id),
        title=n.title,
        url=n.url,
        source=n.source,
        published_at=n.published_at,
        event_type=n.event_type,
        cause=clean_cause_text(n.cause),
        beach_name=beach_name,
    )


@router.get("/outfalls/{outfall_id}/news", response_model=OutfallNewsOut)
def outfall_news(
    outfall_id: int, db: Session = Depends(get_db)
) -> OutfallNewsOut:
    """Prensa de infraestructura de vertido en el entorno del punto.

    `named`: titulares que nombran ESTE punto (palabra de instalación
    + topónimo propio del censo, p.ej. "emisario de Punta Brava").
    `zone`: infra de playas a <2 km sin punto concreto nombrado —
    contexto de prensa; la proximidad NO implica causalidad. Las
    noticias que nombran otro punto del clúster se omiten: cada ficha
    habla de lo suyo y de lo genérico, nunca del vecino identificado.
    """
    outfall = db.get(Outfall, outfall_id)
    if outfall is None:
        raise HTTPException(status_code=404, detail="Outfall not found")
    empty = OutfallNewsOut()
    # Solo puntos de residual: pluviales, salmueras y piscinas no son
    # infra de saneamiento — su ficha no lleva sección de prensa
    if "residual" not in (outfall.nature or "").lower():
        return empty
    outfall_geog = cast(literal(outfall.geom, type_=Geometry), Geography)
    beach_rows = (
        db.query(Beach.id, Beach.name)
        .filter(
            func.ST_DWithin(
                Beach.geom.cast(Geography),
                outfall_geog,
                _OUTFALL_NEWS_RADIUS_M,
            )
        )
        .all()
    )
    if not beach_rows:
        return empty
    beach_names = {b.id: b.name for b in beach_rows}
    rows = (
        db.query(NewsItem)
        .filter(
            NewsItem.relevant.is_(True),
            NewsItem.beach_id.in_(beach_names),
        )
        .order_by(NewsItem.published_at.desc().nulls_last())
        .all()
    )
    # El titular debe hablar de la instalación o del suceso
    # (INFRA_TITLE_RE) + dedup por URL — la misma noticia se replica
    # en cada PM de la playa
    seen: set[str] = set()
    items = []
    for n in rows:
        if n.url in seen:
            continue
        if not INFRA_TITLE_RE.search(n.title):
            continue
        seen.add(n.url)
        items.append(n)
    if not items:
        return empty
    own_res, other_res = outfall_named_patterns(
        outfall_id, db.query(Outfall).all()
    )
    named: list[OutfallNewsItemOut] = []
    zone: list[OutfallNewsItemOut] = []
    for n in items:
        text = norm_txt(n.title)
        out = _outfall_news_out(n, beach_names.get(n.beach_id))
        if any(p.search(text) for p in own_res):
            named.append(out)
        elif not any(p.search(text) for p in other_res):
            zone.append(out)
        # nombra otro punto concreto → fuera de esta ficha
    return OutfallNewsOut(
        named=named[:_OUTFALL_NEWS_LIMIT],
        zone=zone[:_OUTFALL_NEWS_LIMIT],
    )
