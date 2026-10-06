from collections import Counter
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, literal, or_
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.events import (
    PRESS_CLUSTER_GAP,
    RETRO_WINDOW,
    Episode,
    SynthEvent,
    _closed_since_date,
    _in_window,
    _is_structural,
    _min_closed_since,
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
from app.queries import (
    _CAUSE_RANK,
    CONTAMINATION_CAUSES,
    _episode_params,
    _params_in_text,
    _press_cause,
    _short_cause,
    beaches_with_latest_status,
    effective_states,
    is_ungraded_note,
)
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
from app.security import require_admin

router = APIRouter(tags=["beaches"])

_MESES = (
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
)


def _mes(d: date) -> str:
    """Mes abreviado + año para observaciones: jul 2024."""
    return f"{_MESES[d.month - 1]} {d.year}"


def _pm_label(name: str) -> str | None:
    """'PLAYA JARDIN PM4' → 'PM4'; None si no es punto de muestreo."""
    import re

    m = re.search(r"\bPM(\d+)$", name)
    return f"PM{m.group(1)}" if m else None


def _latest_closed(db: Session, beach_id: int) -> bool:
    st = (
        db.query(BeachStatus)
        .filter(BeachStatus.beach_id == beach_id)
        .order_by(BeachStatus.reported_at.desc())
        .first()
    )
    return st is not None and st.status == BeachState.closed


def _sibling_pm_attribution(
    beach: Beach, db: Session, start: date, end: date | None
) -> str | None:
    """PM hermano del arenal con evidencia oficial en la ventana, si
    la playa pedida no tiene ninguna — el episodio de prensa (que se
    replica a todos los PM) es realmente del hermano, no de este
    punto. `end=None` = episodio aún abierto → también vale que el
    hermano siga oficialmente cerrado hoy."""
    if _pm_label(beach.name) is None:
        return None
    end_d = end or date.today()
    own = (
        db.query(BeachIncident)
        .filter(
            BeachIncident.beach_id == beach.id,
            BeachIncident.opened_at <= end_d,
            or_(
                BeachIncident.closed_at.is_(None),
                BeachIncident.closed_at >= start,
            ),
        )
        .first()
    )
    if own or (end is None and _latest_closed(db, beach.id)):
        return None
    sibs = (
        db.query(Beach)
        .filter(
            Beach.id != beach.id,
            Beach.municipality == beach.municipality,
            Beach.name.like(base_name(beach.name) + "%"),
        )
        .all()
    )
    for sib in sibs:
        hit = (
            db.query(BeachIncident)
            .filter(
                BeachIncident.beach_id == sib.id,
                BeachIncident.opened_at <= end_d,
                or_(
                    BeachIncident.closed_at.is_(None),
                    BeachIncident.closed_at >= start,
                ),
            )
            .first()
        )
        if hit or (end is None and _latest_closed(db, sib.id)):
            return _pm_label(sib.name)
    return None


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
    # Estado efectivo (misma matriz que /alerts): un cierre de prensa
    # fresco pone el pin rojo y un oficial rezagado superado por una
    # reapertura de prensa muestra 'open'. 'status_via' conserva la
    # procedencia ('press' cuando la prensa decide lo mostrado)
    eff = effective_states(db)
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
                    "status": eff.get(beach.id, {}).get(
                        "status",
                        status.status.value if status else "unknown",
                    ),
                    "status_via": eff.get(beach.id, {}).get("via"),
                    "alert_cause": (
                        eff[beach.id].get("cause")
                        if eff.get(beach.id, {}).get("alerted")
                        else None
                    ),
                    "cause_via": (
                        eff[beach.id].get("cause_via")
                        if eff.get(beach.id, {}).get("alerted")
                        else None
                    ),
                    "reported_at": (
                        status.reported_at.isoformat() if status else None
                    ),
                    # Cuándo empezó la alerta efectiva (press → fecha de
                    # la noticia, no del scrape): ordena el desplegable
                    "alerted_at": (
                        eff[beach.id]["reported_at"].isoformat()
                        if eff.get(beach.id, {}).get("alerted")
                        and eff[beach.id].get("reported_at")
                        else None
                    ),
                },
            )
            for beach, status, lon, lat in rows
        ]
    )


@router.get("/sampling")
def sampling_summary(db: Session = Depends(get_db)) -> dict:
    """Ritmo de muestreo insular de Náyade: media de muestras/mes en
    temporada (jun-sep) vs temporada baja. Náyade no muestrea toda la
    isla fuera de temporada — solo un subconjunto (~40 vs ~120/mes),
    lo que explica los huecos largos entre mediciones."""
    rows = (
        db.query(
            func.to_char(
                func.date_trunc("month", BeachMeasurement.sampled_at),
                "YYYY-MM",
            ).label("month"),
            func.count(),
        )
        .group_by("month")
        .all()
    )
    season = [c for m, c in rows if 6 <= int(m[5:7]) <= 9]
    off = [c for m, c in rows if not (6 <= int(m[5:7]) <= 9)]
    return {
        "season_per_month": round(sum(season) / len(season)) if season else 0,
        "offseason_per_month": round(sum(off) / len(off)) if off else 0,
        "season_months": len(season),
        "offseason_months": len(off),
    }


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
    # Conteo propio por PM (sin deduplicar entre hermanos): replica la
    # ficha — incidencia con "prohibido" o evento reconstruido =
    # cierre; "Sin Calificar" no cuenta (la ficha la lista aparte)
    own_counts: dict[int, dict[str, int]] = {}
    for beach in beaches:
        own_c = own_w = 0
        inc_c = inc_w = 0  # solo incidencias reales (sin sintéticos)
        for inc in beach.incidents:
            if is_ungraded_note(inc.observations):
                continue  # nota administrativa sin alerta real
            if "prohib" in (inc.observations or "").lower():
                own_c += 1
                inc_c += 1
            else:
                own_w += 1
                inc_w += 1
            press_items = _press_in_window(
                beach, inc.opened_at, inc.closed_at or date.today()
            )
            episodes.append(
                Episode(
                    beach_id=beach.id,
                    base=base_name(beach.name),
                    municipality=beach.municipality,
                    kind=_incident_kind(inc, press_items),
                    start=inc.opened_at,
                    end=inc.closed_at,
                    via="official",
                    ref_id=inc.id,
                    obs=None,
                )
            )
        for ev in synthesize_events(beach):
            own_c += 1  # en la ficha via=press|measurement siempre es cierre
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
        # Episodios de agua (descalifican el récord "impecable"):
        # toda incidencia oficial real — Sanidad solo mide agua — más
        # clústeres de prensa con causa Contaminación FUERA de la
        # ventana de una incidencia (los de dentro ya cuentan vía
        # ella; un clúster = menciones separadas por ≤45 días)
        inc_windows = [
            (inc.opened_at, inc.closed_at or date.today())
            for inc in beach.incidents
            if not is_ungraded_note(inc.observations)
        ]
        press_contam = sorted(
            it.published_at.date()
            for it in beach.news_items
            if it.relevant
            and it.event_type in ("closure", "warning", "pollution")
            and _short_cause(it.cause) in CONTAMINATION_CAUSES
            and it.published_at
            and not any(
                s <= it.published_at.date() <= e for s, e in inc_windows
            )
        )
        press_clusters = 0
        last_d: date | None = None
        for d in press_contam:
            if last_d is None or d - last_d > PRESS_CLUSTER_GAP:
                press_clusters += 1
            last_d = d
        own_counts[beach.id] = {
            "closures": own_c,
            "warnings": own_w,
            "contam": inc_c + inc_w + press_clusters,
        }
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
        non_apta = sum(
            1
            for m in beach.measurements
            if m.evaluation
            and "apta" not in m.evaluation.lower()
            and "sin calificar" not in m.evaluation.lower()
            # "Pendiente Valoración por Administración Sanitaria" =
            # muestra aún sin evaluar, no un veredicto negativo
            and "pendiente" not in m.evaluation.lower()
        )
        latest = beach.measurements[0] if beach.measurements else None
        stats.append(
            BeachStatsOut(
                beach_id=beach.id,
                closures=c["closures"],
                warnings=c["warnings"],
                closures_last_year=c["last_year"],
                bad_samples=bad,
                non_apta_samples=non_apta,
                total_samples=len(beach.measurements),
                latest_evaluation=latest.evaluation if latest else None,
                latest_sampled_at=latest.sampled_at if latest else None,
                reconstructed=c["recon"],
                own_closures=own_counts.get(beach.id, {}).get("closures", 0),
                own_warnings=own_counts.get(beach.id, {}).get("warnings", 0),
                contam_episodes=own_counts.get(beach.id, {}).get("contam", 0),
            )
        )
    return stats


def _dominant_cause(texts: list[str]) -> str | None:
    """Causas crudas (LLM/observaciones) → etiqueta del episodio.
    Gana la más específica (_CAUSE_RANK); la mayoría solo desempata
    dentro del mismo nivel. Si los textos citan los dos parámetros
    fecales, la etiqueta los muestra juntos."""
    counts = Counter(c for c in (_short_cause(t) for t in texts) if c)
    if not counts:
        return None
    params: set[str] = set()
    for t in texts:
        if t:
            params |= _params_in_text(t)
    if params == {"E. coli", "Enterococos"}:
        return "E. coli y enterococos"
    return min(counts, key=lambda c: (_CAUSE_RANK.get(c, 9), -counts[c]))


def _press_in_window(beach: Beach, start: date, end: date) -> list:
    """Noticias relevantes dentro de la ventana oficial (±7 días)."""
    return [
        n
        for n in beach.news_items
        if n.relevant
        and n.published_at
        and start - timedelta(days=7)
        <= n.published_at.date()
        <= end + timedelta(days=7)
    ]


def _news_out(n: NewsItem) -> NewsItemOut:
    return NewsItemOut(
        id=n.id,
        beach_id=n.beach_id,
        title=n.title,
        url=n.url,
        source=n.source,
        published_at=n.published_at,
        event_type=n.event_type,
        cause=n.cause,
    )


def _incident_kind(inc, press_items) -> str:
    """'prohibido' en la observación → cierre. Además, si la prensa de
    la ventana habla de cierre el episodio es un cierre aunque Náyade
    anotara otra cosa: un "Sin Calificar" sobre una playa cerrada por
    el municipio (Gaviotas, talud) es traza administrativa — Sanidad no
    muestrea una playa vallada —, no un aviso de agua."""
    if inc.observations and "prohib" in inc.observations.lower():
        return "closure"
    if any(n.event_type == "closure" for n in press_items):
        return "closure"
    return "warning"


def _synth_observations(ev: SynthEvent) -> str:
    if ev.via == "measurement":
        obs = "Prohibido por analítica del agua — sin incidente oficial en Náyade"
        if ev.press_confirmed:
            obs += (
                f" · {ev.press_count} "
                f"{'noticia' if ev.press_count == 1 else 'noticias'} "
                "de prensa lo recogieron"
            )
        if ev.end_from_press and ev.press_reopening:
            obs += (
                f" · reabierta el "
                f"{ev.press_reopening.strftime('%d/%m/%Y')} según prensa"
            )
        elif ev.press_reopening:
            # El ayuntamiento anunció reapertura pero el laboratorio
            # siguió dando prohibido — la fecha de cierre es la apta
            obs += (
                f" · prensa anunció reapertura el "
                f"{ev.press_reopening.strftime('%d/%m/%Y')}"
            )
        for a, b in ev.sample_gaps:
            # Parada invernal de Náyade: el cierre pudo interrumpirse
            # sin muestra que lo acredite — se declara, no se oculta
            obs += f" · sin muestras entre {_mes(a)} y {_mes(b)}"
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
    beaches = db.query(Beach).filter(Beach.municipality == municipality).all()
    out = _merged_episode_rows(_collect_episodes(beaches, date.today()))
    out.sort(key=lambda r: r.opened_at, reverse=True)
    return out


def _collect_episodes(beaches: list[Beach], today: date) -> list[Episode]:
    """Episodios crudos de un conjunto de playas: incidencias
    oficiales + eventos reconstruidos (analítica/prensa)."""
    episodes: list[Episode] = []
    for beach in beaches:
        for inc in beach.incidents:
            if is_ungraded_note(inc.observations):
                continue  # nota administrativa sin alerta real
            end = inc.closed_at or today
            # Noticias dentro de la ventana oficial (±7 días): la
            # incidencia puede anotar que la prensa también lo recogió
            press_items = _press_in_window(beach, inc.opened_at, end)
            episodes.append(
                Episode(
                    beach_id=inc.beach_id,
                    base=base_name(beach.name),
                    municipality=beach.municipality,
                    kind=_incident_kind(inc, press_items),
                    start=inc.opened_at,
                    end=inc.closed_at,
                    via="official",
                    ref_id=inc.id,
                    obs=inc.observations,
                    press_count=len(press_items),
                    # Náyade no dice la causa: la toma la prensa de la
                    # ventana; si nadie la cubrió, un cierre de Sanidad
                    # es Contaminación por definición (solo mide agua)
                    cause=(
                        _short_cause(inc.observations)
                        or _press_cause(press_items)
                        or "Contaminación"
                    ),
                )
            )
    synth_id = -1
    for beach in beaches:
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
                    ref_id=synth_id,
                    obs=_synth_observations(ev),
                    press_count=(ev.press_count if ev.via == "press" else 0),
                    end_estimated=ev.end_estimated,
                    # prensa: voto de sus causas crudas; measurement:
                    # la analítica prohibida ES contaminación; un
                    # cierre de prensa sin razón extraída → sin causa
                    cause=(
                        _dominant_cause(ev.causes)
                        or (
                            "Contaminación"
                            if ev.via == "measurement"
                            else None
                        )
                    ),
                )
            )
            synth_id -= 1
    return episodes


def _merged_episode_rows(
    episodes: list[Episode],
) -> list[MunicipalityIncidentOut]:
    """Agrupa los episodios por playa base + municipio y los convierte
    en filas de salida (una por episodio real, no por PM)."""
    return [
        MunicipalityIncidentOut(
            id=m.ref_id,
            beach_id=m.beach_id,
            beach_name=m.base,
            municipality=m.municipality,
            kind=m.kind,
            opened_at=m.start,
            closed_at=m.end,
            observations=m.obs,
            via=m.via,
            cause=m.cause,
            end_estimated=m.end_estimated,
        )
        for m in (merged_episode(g) for g in cluster_episodes(episodes))
    ]


@router.get("/episodes", response_model=list[MunicipalityIncidentOut])
def island_episodes(
    db: Session = Depends(get_db),
) -> list[MunicipalityIncidentOut]:
    """Todos los episodios de la isla (oficiales + reconstruidos),
    agrupados por playa base + municipio y más reciente primero.

    Alimenta el resumen anual ("N cierres en 2026"), la sección
    "Resueltas recientemente" del panel de alertas y la vista
    Temporada del ranking municipal."""
    beaches = (
        db.query(Beach)
        .options(
            selectinload(Beach.incidents),
            selectinload(Beach.measurements),
            selectinload(Beach.news_items),
        )
        .all()
    )
    out = _merged_episode_rows(_collect_episodes(beaches, date.today()))
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
    today = date.today()
    out = [
        BeachIncidentOut(
            id=row.id,
            beach_id=row.beach_id,
            opened_at=row.opened_at,
            closed_at=row.closed_at,
            observations=row.observations,
            source_url=row.source_url,
            # Titulares de la ventana ±7 d que corroboran la
            # incidencia oficial — la fila los despliega como
            # evidencia ("según prensa")
            press_items=[
                _news_out(n)
                for n in sorted(
                    _press_in_window(
                        beach, row.opened_at, row.closed_at or today
                    ),
                    key=lambda n: n.published_at,
                    reverse=True,
                )
            ],
        )
        for row in rows
    ]
    synth_id = -1
    live_closed = _latest_closed(db, beach_id)
    for ev in synthesize_events(beach):
        obs = _synth_observations(ev)
        # Prensa aún abierta y Náyade también la da por cerrada: no es
        # "solo prensa" — el cierre tiene respaldo oficial de estado
        # aunque no exista incidencia abierta (Jardín PM4 oct-2026)
        if ev.via == "press" and ev.closed_at is None and live_closed:
            obs = "Cierre vigente — confirmado por estado oficial en Náyade"
        out.append(
            BeachIncidentOut(
                id=synth_id,
                beach_id=beach_id,
                opened_at=ev.opened_at,
                closed_at=ev.closed_at,
                observations=obs,
                source_url=None,
                via=ev.via,
                press_confirmed=ev.press_confirmed,
                end_estimated=ev.end_estimated,
                attributed_pm=(
                    _sibling_pm_attribution(
                        beach, db, ev.opened_at, ev.closed_at
                    )
                    if ev.via == "press"
                    else None
                ),
                press_items=[
                    _news_out(n)
                    for n in sorted(
                        ev.press_items,
                        key=lambda n: n.published_at,
                        reverse=True,
                    )
                ],
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


def _news_cause(items: list[NewsItem]) -> str | None:
    """Causa dominante para mostrar: votan solo categorías reales
    (_press_cause filtra mecanismos como "acceso prohibido" o la
    gestión posterior, "obras de emergencia"); el texto visible es el
    de la noticia más reciente de la categoría ganadora ("riesgo de
    desprendimientos" y no "Desprendimientos" a secas)."""
    cat = _press_cause(items)
    if cat is None:
        return None
    if cat == "E. coli y enterococos":
        # Etiqueta compuesta: muestra el texto del ítem que nombre los
        # dos parámetros (suele llevar la cifra, "E. coli >800 UFC…")
        for it in items:
            if _episode_params([it]) == {"E. coli", "Enterococos"}:
                return it.cause
        return cat
    for it in items:
        if _short_cause(it.cause) == cat:
            return it.cause
    return cat


@router.get(
    "/beaches/{beach_id}/news",
    response_model=BeachNewsOut,
)
def beach_news(beach_id: int, db: Session = Depends(get_db)) -> BeachNewsOut:
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
    # Una reapertura real termina el episodio de cobertura: la
    # cadena no se encadena a través de ella aunque el hueco sea
    # <GAP (Jardín: cierres 12-ago→reapertura 4-sep→cierre 30-sep
    # son TRES episodios; el cierre de hoy no "viene del 12-ago")
    last_reopen = max(
        (
            r.published_at
            for r in rows
            if r.event_type == "reopening" and r.published_at
        ),
        default=None,
    )
    # "Desde cuándo": inicio del episodio ACTUAL, no del titular más
    # viejo — un hueco >PRESS_CLUSTER_GAP entre cierres separa
    # episodios (El Médano: cierres de julio + cierres de septiembre;
    # el banner debe anclar a septiembre, no a julio) y una reapertura
    # entre medios también rompe la cadena (Puertito: cierre 8-may →
    # reapertura 9-may → cierre 5-jun son dos episodios, el "desde" es
    # junio, no mayo)
    reopen_dates = sorted(
        r.published_at
        for r in rows
        if r.event_type == "reopening" and r.published_at
    )

    # Cierre "retrospectivo": publicado DESPUÉS de la reapertura pero
    # relata el episodio ya resuelto — lo delata su propio texto
    # (closed_since ≤ reapertura) o falta de corroboración como suceso
    # nuevo (un medio solo, sin cuerpo verificado). Un "cerrada de
    # nuevo" real llega con varios medios o con fecha propia — un
    # análisis tardío no puede resucitar el episodio (El Socorro:
    # pieza del 25-sep sobre el cierre del miércoles 23, publicada
    # tras la ola de reaperturas)
    closure_rows = [
        r for r in rows if r.event_type == "closure" and r.published_at
    ]
    outlets_by_day: dict[date, set] = {}
    for r in closure_rows:
        outlets_by_day.setdefault(r.published_at.date(), set()).add(
            r.source or ""
        )

    def _is_new_episode_closure(r: NewsItem) -> bool:
        if last_reopen is None or r.published_at <= last_reopen:
            return True
        cs = _closed_since_date(r.closed_since)
        if cs is not None:
            return cs > last_reopen.date()
        # Pasada la ventana retrospectiva, un cierre de 1 solo medio
        # es un suceso nuevo legítimo (Punta Larga). Dentro de ella,
        # sin closed_since que lo sitúe después, hace falta ola de
        # medios — body_verified solo dice que leyó el cuerpo, no que
        # el suceso sea nuevo
        return (
            r.published_at - last_reopen > RETRO_WINDOW
            or len(outlets_by_day.get(r.published_at.date(), set())) >= 2
        )

    dominant_rows = [
        r for r in rows if r.event_type == dominant and r.published_at
    ]
    dates = sorted(r.published_at for r in dominant_rows)
    if dominant == "closure" and last_reopen is not None:
        post_reopen = [
            r.published_at
            for r in dominant_rows
            if r.published_at > last_reopen and _is_new_episode_closure(r)
        ]
        if post_reopen:
            dates = post_reopen
    # Un episodio estructural ABIERTO no se parte por hueco de
    # cobertura: nadie repite la misma noticia mientras dura la obra
    # (Gaviotas: cierre jun-2026 y titular de sep es el mismo episodio
    # vivo, no uno nuevo). El hueco >GAP solo separa cuando la causa
    # es transitoria — ahí el silencio sí sugiere que reabrió sin
    # cobertura
    beach = db.get(Beach, beach_id)
    evs = synthesize_events(beach) if beach else []
    open_structural = dominant == "closure" and any(
        e.via == "press" and e.closed_at is None and _is_structural(e)
        for e in evs
    )
    since = None
    prev = None
    for d in dates:
        boundary = prev is not None and (
            (d - prev > PRESS_CLUSTER_GAP and not open_structural)
            or any(prev < r < d for r in reopen_dates)
        )
        if since is None or boundary:
            since = d
        prev = d
    # El inicio del episodio es la evidencia MÁS ANTIGUA disponible:
    # si una incidencia oficial cubre la ventana, su opened_at manda
    # sobre la primera cobertura de prensa (El Socorro: Náyade dice
    # 21-sep aunque los titulares lleguen el 23 — la prensa llegó
    # tarde). Si la prensa se adelanta, vale su fecha
    official_start = None
    if since is not None and beach is not None:
        for inc in beach.incidents:
            if is_ungraded_note(inc.observations):
                continue
            if _in_window(
                since.date(), inc.opened_at, inc.closed_at, date.today()
            ):
                if official_start is None or inc.opened_at < official_start:
                    official_start = inc.opened_at
                opened = datetime.combine(
                    inc.opened_at, datetime.min.time(), tzinfo=UTC
                )
                if opened < since:
                    since = opened
    # closed_since: el propio texto puede afirmar un inicio real muy
    # anterior a la cobertura (Benijo: "cerrada desde julio de 2024"
    # aunque el titular sea de 2026). Si el episodio sigue abierto la
    # cadena de clústeres es una sola → miramos todos los cierres; si
    # ya se resolvió, solo el último clúster (el episodio del banner)
    closed_since = None
    still_open = dominant == "closure" and any(
        e.via == "press" and e.closed_at is None for e in evs
    )
    if dominant == "closure":
        if still_open:
            # Solo los cierres posteriores a la última reapertura: una
            # playa que reabrió de verdad no puede "seguir cerrada
            # desde" antes de ella — Jardín reabrió en jun-2025 y un
            # cierre de sep-2026 no arrastra el "2024-07" del episodio
            # viejo. Sin reaperturas vale todo (Benijo)
            pool = [
                r
                for r in rows
                if r.event_type == "closure"
                and r.published_at
                and (last_reopen is None or r.published_at > last_reopen)
            ]
        else:
            pool = [
                r
                for r in rows
                if r.event_type == "closure"
                and since is not None
                and r.published_at
                and r.published_at >= since
            ]
        closed_since = _min_closed_since(r.closed_since for r in pool)
        # Un "cerrada desde" anterior a la incidencia oficial que
        # cubre el episodio es imposible: el registro de Náyade
        # habría mostrado la playa cerrada. Es extracción errónea
        # (El Médano/El Socorro sep-2026: Gemini afirmó "2023-09-20"
        # — la playa SÍ cerró en 2023, pero este episodio era el
        # cierre temporal del 23-sep)
        if official_start is not None:
            cs_d = _closed_since_date(closed_since)
            if cs_d is not None and cs_d < official_start:
                closed_since = _min_closed_since(
                    r.closed_since
                    for r in pool
                    if (_d := _closed_since_date(r.closed_since)) is not None
                    and _d >= official_start
                )
    # Titulares del ÚLTIMO episodio de cobertura: clúster encadenado
    # por fecha (hueco >PRESS_CLUSTER_GAP rompe), con cualquier tipo
    # de evento — la reapertura forma parte del episodio que cierra.
    # El banner de la ficha despliega solo estos, no el saco de 30.
    # Si hay un evento nuevo DESPUÉS de la última reapertura, el
    # episodio actual empieza ahí — el clúster anterior ya se resolvió
    # La frontera del último episodio es la última reapertura ANTES
    # del último cierre/aviso: Puertito cerró 5-jun tras reabrir el
    # 9-may → su episodio actual son los titulares de junio; las
    # reaperturas del 6-jun que lo resolvieron también forman parte
    ep_pool = rows
    last_adverse = max(
        (
            r.published_at
            for r in rows
            if r.published_at
            and (
                r.event_type in ("warning", "pollution")
                or (r.event_type == "closure" and _is_new_episode_closure(r))
            )
        ),
        default=None,
    )
    if last_adverse is not None:
        ep_boundary = max(
            (r for r in reopen_dates if r < last_adverse), default=None
        )
        if ep_boundary is not None:
            ep_pool = [
                r
                for r in rows
                if r.published_at and r.published_at > ep_boundary
            ]
    ep_start = None
    prev_d = None
    for d in sorted(r.published_at for r in ep_pool if r.published_at):
        if (
            prev_d is not None
            and d - prev_d > PRESS_CLUSTER_GAP
            and not open_structural
        ):
            ep_start = d
        elif ep_start is None:
            ep_start = d
        prev_d = d
    episode_items = [
        r
        for r in ep_pool
        if r.published_at
        and ep_start is not None
        and r.published_at >= ep_start
    ]
    attributed_pm = None
    if dominant == "closure" and since is not None:
        ep_begin = _closed_since_date(closed_since) or since.date()
        attributed_pm = _sibling_pm_attribution(
            beach, db, ep_begin, None if still_open else date.today()
        )
    return BeachNewsOut(
        summary=NewsSummaryOut(
            event_type=dominant,
            cause=_news_cause(rows),
            items_count=len(rows),
            outlets_count=len({r.source for r in rows if r.source}),
            since=since,
            closed_since=closed_since,
            attributed_pm=attributed_pm,
        ),
        items=[_news_out(row) for row in rows],
        episode_items=[_news_out(r) for r in episode_items],
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
    beach = db.get(Beach, beach_id)
    if beach is None:
        raise HTTPException(status_code=404, detail="Beach not found")
    # beach.geom ya está cargado (ORM) — se usa como parámetro en vez de
    # referenciar la tabla beaches, para que el FROM solo tenga outfalls
    # (evita el cartesian product warning de SQLAlchemy)
    beach_geog = cast(literal(beach.geom, type_=Geometry), Geography)
    distance = func.ST_Distance(
        beach_geog, Outfall.geom.cast(Geography)
    ).label("distance_m")
    rows = (
        db.query(
            Outfall.id,
            Outfall.name,
            Outfall.kind,
            Outfall.status,
            distance,
        )
        .filter(
            func.ST_DWithin(
                beach_geog,
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
    dependencies=[Depends(require_admin)],
)
def set_beach_status(
    beach_id: int, payload: BeachStatusIn, db: Session = Depends(get_db)
) -> BeachStatusOut:
    """Registra manualmente el estado de una playa (respaldo del
    scraping automático y demos). Requiere cabecera `X-Admin-Key`:
    dispara push a todos los dispositivos."""
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
def beach_status(
    beach_id: int, db: Session = Depends(get_db)
) -> BeachStatusOut:
    row = (
        beaches_with_latest_status(db)
        .filter(Beach.id == beach_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Beach not found")

    beach, status = row
    eff = effective_states(db).get(beach.id, {})
    return BeachStatusOut(
        beach_id=beach.id,
        beach_name=beach.name,
        status=eff.get("status", status.status.value if status else "unknown"),
        reported_at=eff.get(
            "reported_at", status.reported_at if status else None
        ),
        source_url=eff.get(
            "source_url",
            status.source_url if status else beach.source_url,
        ),
    )
