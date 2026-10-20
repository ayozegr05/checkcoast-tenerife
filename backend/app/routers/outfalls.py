from typing import cast as tcast

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, literal
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Beach, NewsItem, Outfall, OutfallStatus
from app.news_infra import gather_infra_news
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
    named, zone = gather_infra_news(db, outfall)
    return OutfallNewsOut(
        named=[_outfall_news_out(n, b) for n, b in named],
        zone=[_outfall_news_out(n, b) for n, b in zone],
    )
