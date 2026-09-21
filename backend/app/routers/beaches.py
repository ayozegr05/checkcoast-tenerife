from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2 import Geography
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.events import (
    Episode,
    SynthEvent,
    base_name,
    cluster_episodes,
    merged_episode,
    synthesize_events,
)
from app.models import (
    Beach,
    BeachIncident,
    BeachMeasurement,
    BeachState,
    BeachStatus,
    NewsItem,
    Outfall,
)
from app.queries import beaches_with_latest_status
from app.schemas import (
    BeachIncidentOut,
    BeachMeasurementOut,
    BeachNearbyOutfallOut,
    BeachNewsOut,
    BeachStatsOut,
    BeachStatusIn,
    BeachStatusOut,
    Feature,
    FeatureCollection,
    MunicipalityIncidentOut,
    NewsItemOut,
    NewsSummaryOut,
    PointGeometry,
)

router = APIRouter(tags=["beaches"])


@router.get("/beaches", response_model=FeatureCollection)
def list_beaches(db: Session = Depends(get_db)) -> FeatureCollection:
    rows = (
        beaches_with_latest_status(db)
        .add_columns(
            func.ST_X(Beach.geom).label("lon"),
            func.ST_Y(Beach.geom).label("lat"),
        )
        .order_by(Beach.name)
        .all()
    )
    return FeatureCollection(
        features=[
            Feature(
                id=beach.id,
                geometry=PointGeometry(coordinates=[lon, lat]),
                properties={
                    "name": beach.name,
                    "municipality": beach.municipality,
                    "monitored": beach.monitored,
                    "source_url": beach.source_url,
                    "status": status.status.value if status else "unknown",
                    "reported_at": (
                        status.reported_at.isoformat() if status else None
                    ),
                },
            )
            for beach, status, lon, lat in rows
        ]
    )


@router.get("/beaches/stats", response_model=list[BeachStatsOut])
def beach_stats(db: Session = Depends(get_db)) -> list[BeachStatsOut]:
    """Agregados por playa para el ranking: episodios (cierres/avisos)
    totales y del último año, muestras no aptas, última evaluación y
    episodios reconstruidos.

    Los episodios se agrupan por playa física (nombre base + municipio,
    ventanas solapadas o a ≤14 días): un cierre que afecta a PM1/PM4/PM5
    a la vez cuenta UNA vez — en el PM de menor id. Las playas no
    monitorizadas solo aportan episodios reconstruidos vía prensa."""
    year_ago = date.today() - timedelta(days=365)
    beaches = list(db.query(Beach))
    episodes: list[Episode] = []
    for beach in beaches:
        for inc in beach.incidents:
            episodes.append(
                Episode(
                    beach_id=beach.id,
                    base=base_name(beach.name),
                    municipality=beach.municipality,
                    kind=(
                        "closure"
                        if inc.observations
                        and "prohib" in inc.observations.lower()
                        else "warning"
                    ),
                    start=inc.opened_at,
                    end=inc.closed_at,
                    via="official",
                    ref_id=inc.id,
                    obs=None,
                )
            )
        for ev in synthesize_events(beach):
            episodes.append(
                Episode(
                    beach_id=beach.id,
                    base=base_name(beach.name),
                    municipality=beach.municipality,
                    kind=ev.kind,
                    start=ev.opened_at,
                    end=ev.closed_at,
                    via=ev.via,
                    ref_id=-1,
                    obs=None,
                )
            )
    # Cada clúster se cuenta una vez, en el PM representativo (min id).
    # Solo los que tienen incidencia oficial van a closures/warnings;
    # los puramente reconstruidos van a `recon` (evita doble conteo:
    # el frontend suma ambos campos)
    rep_counts: dict[int, dict[str, int]] = {}
    for g in cluster_episodes(episodes):
        rep_id = min(e.beach_id for e in g)
        c = rep_counts.setdefault(
            rep_id, {"closures": 0, "warnings": 0, "last_year": 0, "recon": 0}
        )
        if not any(e.via == "official" for e in g):
            c["recon"] += 1
        elif any(e.kind == "closure" for e in g):
            c["closures"] += 1
            if min(e.start for e in g) >= year_ago:
                c["last_year"] += 1
        else:
            c["warnings"] += 1
    stats: list[BeachStatsOut] = []
    for beach in beaches:
        c = rep_counts.get(
            beach.id,
            {"closures": 0, "warnings": 0, "last_year": 0, "recon": 0},
        )
        bad = sum(
            1
            for m in beach.measurements
            if m.evaluation and "prohib" in m.evaluation.lower()
        )
        latest = beach.measurements[0] if beach.measurements else None
        stats.append(
            BeachStatsOut(
                beach_id=beach.id,
                closures=c["closures"],
                warnings=c["warnings"],
                closures_last_year=c["last_year"],
                bad_samples=bad,
                total_samples=len(beach.measurements),
                latest_evaluation=latest.evaluation if latest else None,
                latest_sampled_at=latest.sampled_at if latest else None,
                reconstructed=c["recon"],
            )
        )
    return stats


def _synth_observations(ev: SynthEvent) -> str:
    if ev.via == "measurement":
        obs = "Prohibido por analítica del agua — sin incidente oficial en Náyade"
        if ev.press_confirmed:
            obs += (
                f" · {ev.press_count} "
                f"{'noticia' if ev.press_count == 1 else 'noticias'} "
                "de prensa lo recogieron"
            )
        return obs
    obs = "Cierre según prensa — sin incidente oficial en Náyade"
    if ev.end_estimated:
        obs += " · fin aproximado (última mención)"
    return obs


@router.get("/incidents", response_model=list[MunicipalityIncidentOut])
def municipality_incidents(
    municipality: str = Query(..., description="Nombre del municipio"),
    db: Session = Depends(get_db),
) -> list[MunicipalityIncidentOut]:
    """Episodios de las playas de un municipio, más reciente primero.
    Alimenta la línea temporal del ranking municipal.

    Además de las incidencias oficiales emite eventos reconstruidos:
    ventanas de analítica prohibida sin incidencia (`via=measurement`)
    y cierres que solo existen en prensa (`via=press`).

    Una playa con varios PMs produce UNA fila por episodio (ventanas
    solapadas o a ≤14 días se fusionan sobre el nombre base); `beach_id`
    apunta al PM representativo — al abrir la ficha se ven los demás
    PMs del grupo."""
    beaches = (
        db.query(Beach).filter(Beach.municipality == municipality).all()
    )
    by_id = {b.id: b for b in beaches}
    incidents = (
        db.query(BeachIncident)
        .filter(BeachIncident.beach_id.in_(by_id))
        .all()
    )
    today = date.today()
    episodes: list[Episode] = []
    for inc in incidents:
        beach = by_id[inc.beach_id]
        end = inc.closed_at or today
        # Noticias dentro de la ventana oficial (±7 días): la incidencia
        # puede anotar que la prensa también lo recogió
        press_n = sum(
            1
            for n in beach.news_items
            if n.relevant
            and n.published_at
            and inc.opened_at - timedelta(days=7)
            <= n.published_at.date()
            <= end + timedelta(days=7)
        )
        episodes.append(
            Episode(
                beach_id=inc.beach_id,
                base=base_name(beach.name),
                municipality=municipality,
                kind=(
                    "closure"
                    if inc.observations
                    and "prohib" in inc.observations.lower()
                    else "warning"
                ),
                start=inc.opened_at,
                end=inc.closed_at,
                via="official",
                ref_id=inc.id,
                obs=inc.observations,
                press_count=press_n,
            )
        )
    synth_id = -1
    for beach in beaches:
        for ev in synthesize_events(beach):
            episodes.append(
                Episode(
                    beach_id=beach.id,
                    base=base_name(beach.name),
                    municipality=municipality,
                    kind=ev.kind,
                    start=ev.opened_at,
                    end=ev.closed_at,
                    via=ev.via,
                    ref_id=synth_id,
                    obs=_synth_observations(ev),
                    press_count=(
                        ev.press_count if ev.via == "press" else 0
                    ),
                    end_estimated=ev.end_estimated,
                )
            )
            synth_id -= 1
    out = [
        MunicipalityIncidentOut(
            id=m.ref_id,
            beach_id=m.beach_id,
            beach_name=m.base,
            municipality=municipality,
            kind=m.kind,
            opened_at=m.start,
            closed_at=m.end,
            observations=m.obs,
            via=m.via,
        )
        for m in (merged_episode(g) for g in cluster_episodes(episodes))
    ]
    out.sort(key=lambda r: r.opened_at, reverse=True)
    return out


@router.get(
    "/beaches/{beach_id}/incidents",
    response_model=list[BeachIncidentOut],
)
def beach_incidents(
    beach_id: int, db: Session = Depends(get_db)
) -> list[BeachIncidentOut]:
    """Histórico de incidentes de una playa, más reciente primero.

    Incluye los eventos reconstruidos (`via=measurement|press`) para
    que la ficha muestre su procedencia — una fila del historial con
    "Prohibición por analítica — sin incidencia en Náyade" explica el
    suceso aunque Náyade nunca creara acta."""
    beach = db.get(Beach, beach_id)
    if beach is None:
        raise HTTPException(status_code=404, detail="Beach not found")
    rows = (
        db.query(BeachIncident)
        .filter(BeachIncident.beach_id == beach_id)
        .order_by(BeachIncident.opened_at.desc())
        .all()
    )
    out = [
        BeachIncidentOut(
            id=row.id,
            beach_id=row.beach_id,
            opened_at=row.opened_at,
            closed_at=row.closed_at,
            observations=row.observations,
            source_url=row.source_url,
        )
        for row in rows
    ]
    synth_id = -1
    for ev in synthesize_events(beach):
        out.append(
            BeachIncidentOut(
                id=synth_id,
                beach_id=beach_id,
                opened_at=ev.opened_at,
                closed_at=ev.closed_at,
                observations=_synth_observations(ev),
                source_url=None,
                via=ev.via,
                press_confirmed=ev.press_confirmed,
            )
        )
        synth_id -= 1
    out.sort(key=lambda r: r.opened_at, reverse=True)
    return out


@router.get(
    "/beaches/{beach_id}/quality",
    response_model=list[BeachMeasurementOut],
)
def beach_quality(
    beach_id: int, db: Session = Depends(get_db)
) -> list[BeachMeasurementOut]:
    """Análisis de calidad del agua, más reciente primero."""
    if db.get(Beach, beach_id) is None:
        raise HTTPException(status_code=404, detail="Beach not found")
    rows = (
        db.query(BeachMeasurement)
        .filter(BeachMeasurement.beach_id == beach_id)
        .order_by(BeachMeasurement.sampled_at.desc())
        .all()
    )
    return [
        BeachMeasurementOut(
            id=row.id,
            beach_id=row.beach_id,
            sampled_at=row.sampled_at,
            ecoli=row.ecoli,
            enterococci=row.enterococci,
            evaluation=row.evaluation,
            source_url=row.source_url,
        )
        for row in rows
    ]


def _event_mode(items: list[NewsItem]) -> str | None:
    """Evento dominante: un cierre SIEMPRE gana — la reapertura es la
    resolución del episodio, no el evento (El Médano: 2 titulares de
    reapertura vs 1 de cierre, la noticia era el cierre)."""
    if any(it.event_type == "closure" for it in items):
        return "closure"
    return _news_mode(items, "event_type")


def _news_mode(items: list[NewsItem], attr: str) -> str | None:
    """Valor más frecuente de un campo extraído; en empate gana el del
    titular más reciente (items vienen ordenados desc por fecha)."""
    counts: dict[str, int] = {}
    for it in items:
        v = getattr(it, attr)
        if not v or v == "other":
            continue
        counts[v] = counts.get(v, 0) + 1
    if not counts:
        return None
    best = max(counts.values())
    return next(
        getattr(it, attr)
        for it in items
        if getattr(it, attr) in counts and counts[getattr(it, attr)] == best
    )


@router.get(
    "/beaches/{beach_id}/news",
    response_model=BeachNewsOut,
)
def beach_news(
    beach_id: int, db: Session = Depends(get_db)
) -> BeachNewsOut:
    """Noticias de prensa ligadas a la playa, más reciente primero,
    más un resumen determinista (evento/causa dominantes + nº medios).

    Contexto "según prensa": nunca altera el estado oficial, que solo
    sale de Náyade."""
    if db.get(Beach, beach_id) is None:
        raise HTTPException(status_code=404, detail="Beach not found")
    rows = (
        db.query(NewsItem)
        .filter(
            NewsItem.beach_id == beach_id,
            NewsItem.relevant.is_(True),
        )
        .order_by(NewsItem.published_at.desc().nulls_last())
        .limit(30)
        .all()
    )
    dominant = _event_mode(rows)
    since = min(
        (r.published_at for r in rows
         if r.event_type == dominant and r.published_at),
        default=None,
    )
    return BeachNewsOut(
        summary=NewsSummaryOut(
            event_type=dominant,
            cause=_news_mode(rows, "cause"),
            items_count=len(rows),
            outlets_count=len({r.source for r in rows if r.source}),
            since=since,
        ),
        items=[
            NewsItemOut(
                id=row.id,
                beach_id=row.beach_id,
                title=row.title,
                url=row.url,
                source=row.source,
                published_at=row.published_at,
                event_type=row.event_type,
                cause=row.cause,
            )
            for row in rows
        ],
    )


@router.get(
    "/beaches/{beach_id}/nearby-outfalls",
    response_model=list[BeachNearbyOutfallOut],
)
def beach_nearby_outfalls(
    beach_id: int,
    radius_m: int = Query(
        1000, ge=50, le=10000, description="Radio de búsqueda en metros"
    ),
    db: Session = Depends(get_db),
) -> list[BeachNearbyOutfallOut]:
    """Emisarios catalogados dentro del radio de la playa, ordenados por
    distancia (metros reales, geography). Contextualiza qué vertidos
    amenazan cada zona de baño."""
    if db.get(Beach, beach_id) is None:
        raise HTTPException(status_code=404, detail="Beach not found")
    distance = func.ST_Distance(
        Beach.geom.cast(Geography), Outfall.geom.cast(Geography)
    ).label("distance_m")
    rows = (
        db.query(
            Outfall.id,
            Outfall.name,
            Outfall.kind,
            Outfall.status,
            distance,
        )
        .filter(Beach.id == beach_id)
        .filter(
            func.ST_DWithin(
                Beach.geom.cast(Geography),
                Outfall.geom.cast(Geography),
                radius_m,
            )
        )
        .order_by("distance_m")
        .limit(5)
        .all()
    )
    return [
        BeachNearbyOutfallOut(
            outfall_id=row.id,
            name=row.name,
            kind=row.kind,
            status=row.status.value,
            distance_m=row.distance_m,
        )
        for row in rows
    ]


@router.post(
    "/beaches/{beach_id}/status",
    response_model=BeachStatusOut,
    status_code=201,
)
def set_beach_status(
    beach_id: int, payload: BeachStatusIn, db: Session = Depends(get_db)
) -> BeachStatusOut:
    """Registra manualmente el estado de una playa (respaldo del
    scraping automático y demos)."""
    beach = db.get(Beach, beach_id)
    if beach is None:
        raise HTTPException(status_code=404, detail="Beach not found")

    status = BeachStatus(
        beach_id=beach.id,
        status=BeachState(payload.status),
        source_url=payload.source_url or beach.source_url,
    )
    db.add(status)
    db.commit()
    db.refresh(status)

    from app.notify import notify_beach_status

    notify_beach_status(db, beach, status.status)
    return BeachStatusOut(
        beach_id=beach.id,
        beach_name=beach.name,
        status=status.status.value,
        reported_at=status.reported_at,
        source_url=status.source_url,
    )


@router.get("/beaches/{beach_id}/status", response_model=BeachStatusOut)
def beach_status(beach_id: int, db: Session = Depends(get_db)) -> BeachStatusOut:
    row = (
        beaches_with_latest_status(db)
        .filter(Beach.id == beach_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Beach not found")

    beach, status = row
    return BeachStatusOut(
        beach_id=beach.id,
        beach_name=beach.name,
        status=status.status.value if status else "unknown",
        reported_at=status.reported_at if status else None,
        source_url=status.source_url if status else beach.source_url,
    )
