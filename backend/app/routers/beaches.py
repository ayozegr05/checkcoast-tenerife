import re
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from typing import cast as tcast

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, literal, or_
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.events import (
    PRESS_CLUSTER_GAP,
    Episode,
    SynthEvent,
    _closed_since_date,
    _corroborated_closed_since,
    base_name,
    cluster_episodes,
    fuse_official_episodes,
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
from app.names import pm_label
from app.news_episodes import press_episode_summary
from app.queries import (
    _CAUSE_RANK,
    CONTAMINATION_CAUSES,
    _params_in_text,
    _press_cause,
    _short_cause,
    beaches_with_latest_status,
    clean_cause_text,
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
    return pm_label(name)


def _latest_closed(db: Session, beach_id: int) -> bool:
    st = (
        db.query(BeachStatus)
        .filter(BeachStatus.beach_id == beach_id)
        .order_by(BeachStatus.reported_at.desc())
        .first()
    )
    return st is not None and st.status == BeachState.closed


def _sibling_pm_attribution(
    beach: Beach, db: Session, start: date, end: date, *, live: bool = False
) -> str | None:
    """PM hermano del arenal con evidencia oficial, si la playa
    pedida no tiene ninguna — el episodio de prensa (que se replica
    a todos los PM) es realmente del hermano, no de este punto.

    `live=True` (banner del summary): el hermano debe seguir
    oficialmente cerrado HOY — "la zona 4 sigue cerrada". Un punto
    con episodio propio abierto nunca llega aquí (cierre general:
    cada PM narra el suyo). `live=False` (historial): basta que el
    hermano tuviera la evidencia oficial en la ventana del episodio.
    """
    if _pm_label(beach.name) is None:
        return None
    own = (
        db.query(BeachIncident)
        .filter(
            BeachIncident.beach_id == beach.id,
            BeachIncident.opened_at <= end,
            or_(
                BeachIncident.closed_at.is_(None),
                BeachIncident.closed_at >= start,
            ),
        )
        .first()
    )
    if own or _latest_closed(db, beach.id):
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
        if live:
            # El hermano debe seguir oficialmente cerrado hoy:
            # incidencia abierta o último estado 'closed'
            open_inc = (
                db.query(BeachIncident)
                .filter(
                    BeachIncident.beach_id == sib.id,
                    BeachIncident.closed_at.is_(None),
                )
                .first()
            )
            if open_inc or _latest_closed(db, sib.id):
                return _pm_label(sib.name)
            continue
        hit = (
            db.query(BeachIncident)
            .filter(
                BeachIncident.beach_id == sib.id,
                BeachIncident.opened_at <= end,
                or_(
                    BeachIncident.closed_at.is_(None),
                    BeachIncident.closed_at >= start,
                ),
            )
            .first()
        )
        if hit:
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
                    # Cierre por causa estructural mayoritaria (no la
                    # ganadora por especificidad): pin apagado y sin
                    # pulso en el mapa
                    "alert_structural": eff.get(beach.id, {}).get(
                        "structural", False
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
    # selectinload: incidencias/mediciones/noticias de TODAS las
    # playas en 3 queries — el lazy load por playa era ~600 queries
    beaches = list(
        db.query(Beach).options(
            selectinload(Beach.incidents),
            selectinload(Beach.measurements),
            selectinload(Beach.news_items),
        )
    )
    episodes: list[Episode] = []
    # Conteo propio por PM (sin deduplicar entre hermanos): replica la
    # ficha — incidencia con "prohibido" o cierre de prensa =
    # cierre; analítica prohibida = agua no apta (aparte);
    # "Sin Calificar" no cuenta (la ficha la lista aparte)
    own_counts: dict[int, dict[str, int]] = {}
    for beach in beaches:
        own_c = own_w = own_lab = 0
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
            # Un cierre solo en prensa cuenta como cierre; la
            # analítica prohibida corroborada por prensa también;
            # la muda va aparte — agua no apta no demuestra cierre
            if ev.via == "press" or ev.press_confirmed:
                own_c += 1
            else:
                own_lab += 1
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
                    press_confirmed=ev.press_confirmed,
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
            "lab": own_lab,
            "contam": inc_c + inc_w + press_clusters,
        }
    # Cada clúster se cuenta una vez, en el PM representativo (min id).
    # Solo los que tienen incidencia oficial van a closures/warnings;
    # los con prensa de cierre van a `recon` (evita doble conteo:
    # el frontend suma ambos campos); los puramente de laboratorio
    # van a `lab` — agua no apta no es un cierre demostrado
    rep_counts: dict[int, dict[str, int]] = {}
    for g in cluster_episodes(episodes):
        rep_id = min(e.beach_id for e in g)
        c = rep_counts.setdefault(
            rep_id,
            {
                "closures": 0,
                "warnings": 0,
                "last_year": 0,
                "recon": 0,
                "lab": 0,
            },
        )
        if not any(e.via == "official" for e in g):
            # Prensa de cierre en la ventana = cierre corroborado;
            # solo los episodios de laboratorio MUDOS van aparte
            if any(e.via == "press" or e.press_confirmed for e in g):
                c["recon"] += 1
            else:
                c["lab"] += 1
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
            {
                "closures": 0,
                "warnings": 0,
                "last_year": 0,
                "recon": 0,
                "lab": 0,
            },
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
                lab_episodes=c["lab"],
                own_closures=own_counts.get(beach.id, {}).get("closures", 0),
                own_warnings=own_counts.get(beach.id, {}).get("warnings", 0),
                own_lab=own_counts.get(beach.id, {}).get("lab", 0),
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
        # los llamadores solo sirven ítems casados a una playa
        beach_id=tcast(int, n.beach_id),
        title=n.title,
        url=n.url,
        source=n.source,
        published_at=n.published_at,
        event_type=n.event_type,
        # Sin cifras de laboratorio: el valor vive en la gráfica, en
        # etiquetas y banners solo ensucia
        cause=clean_cause_text(n.cause),
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
        if ev.press_confirmed:
            # La prensa documentó cierre en la ventana y el
            # laboratorio prueba que el agua estaba mala — el
            # episodio escala a cierre con doble fuente
            return "Cierre según prensa · confirmado por analíticas"
        # Mudo: la fila nombra la muestra y aclara que no consta
        # cierre en el registro — no afirma que nunca existiera
        obs = "Laboratorio: muestra no apta · Sin cierre oficial"
        if ev.press_reopening and not ev.end_from_press:
            # El ayuntamiento anunció reapertura pero el laboratorio
            # siguió dando prohibido — la fecha de cierre es la apta
            obs += (
                f" · prensa anunció reapertura el "
                f"{ev.press_reopening.strftime('%d/%m/%Y')}"
            )
        for a, b in ev.sample_gaps:
            # Parada invernal de Náyade: el cierre pudo interrumpirse
            # sin muestra que lo acredite — se declara, no se oculta
            obs += f" · Sin muestras entre {_mes(a)} y {_mes(b)}"
        return obs
    obs = "Cierre según prensa"
    return obs


def _lab_context(
    ev: SynthEvent, neighbors: list[tuple[date, "date | None"]]
) -> str:
    """Contexto de un episodio de laboratorio MUDO respecto a los
    cierres vecinos del mismo punto (oficiales o corroborados por
    prensa):
    - recaída: un episodio cerró ≤35 d antes de que abriera este —
      el agua volvió a salir no apta tras reabrir
    - precedió: un cierre abrió ≤9 sem después del fin de este —
      el laboratorio lo detectó antes que cualquier cierre
    (Punta Brava: recaída oct-2023 tras la reapertura de sep; la
    muda de may-2024 precedió seis semanas al gran cierre de julio)
    """
    relapses = [e for s, e in neighbors if e and e < ev.opened_at]
    prev_end = max(relapses) if relapses else None
    if prev_end and ev.opened_at - prev_end <= timedelta(days=35):
        return (
            f" · recaída tras la reapertura del "
            f"{prev_end.strftime('%d/%m/%Y')}"
        )
    if ev.closed_at is not None:
        starts = [s for s, _e in neighbors if s > ev.closed_at]
        nxt = min(starts) if starts else None
        if nxt and nxt - ev.closed_at <= timedelta(days=63):
            return f" · precedió al cierre del {nxt.strftime('%d/%m/%Y')}"
    return ""


# Náyade escribe sin acentos; la razón tras ":" se conserva en la
# fila y conviene leerla bien escrita
_ACCENT_FIX = {
    "bano": "baño",
    "proliferacion": "proliferación",
    "parametros": "parámetros",
    "microbiologicos": "microbiológicos",
    "limites": "límites",
    "contaminacion": "contaminación",
    "deteccion": "detección",
}


def _fix_accents(text: str) -> str:
    return re.sub(
        r"[a-záéíóúñü]+",
        lambda m: _ACCENT_FIX.get(m.group(0).lower(), m.group(0)),
        text,
    )


def _display_obs(raw: str | None, kind: str) -> str | None:
    """Observación oficial → frase consistente: quién y qué, no la
    redacción del funcionario — Náyade escribe la misma prohibición
    como "Zona donde queda prohibido el baño temporalmente" o
    "Prohibido el bano: proliferacion de algas" y cada variante
    cortaba la fila de una forma. `kind` es el tipo computado del
    episodio: un aviso que la prensa corroboró como cierre lleva
    subtítulo de cierre, no el "recomendación" que anotó Sanidad."""
    if raw is None:
        return None
    low = raw.lower()
    if "prohib" in low:
        obs = "Sanidad prohíbe el baño"
        if ":" in raw:
            reason = raw.split(":", 1)[1].strip().rstrip(".")
            if reason:
                obs += f" · {_fix_accents(reason)}"
        return obs
    if "recomend" in low:
        # Aviso elevado a cierre por la prensa (ej. Punta Brava
        # ago-2026): la fila dice cierre — el tipo manda — y la
        # cláusula nombra la discrepancia en vez de ocultarla
        return (
            "Cierre según prensa · Sanidad recomendó no bañarse"
            if kind == "closure"
            else "Sanidad recomienda no bañarse"
        )
    return raw


@router.get("/incidents", response_model=list[MunicipalityIncidentOut])
def municipality_incidents(
    municipality: str = Query(..., description="Nombre del municipio"),
    db: Session = Depends(get_db),
) -> list[MunicipalityIncidentOut]:
    """Episodios de las playas de un municipio, más reciente primero.
    Alimenta la línea temporal del ranking municipal.

    Además de las incidencias oficiales emite los cierres que solo
    existen en prensa (`via=press`). Las ventanas de analítica
    prohibida sin más fuente (`via=measurement`) NO aparecen: esta
    línea temporal es de cierres/avisos y una analítica mala no
    demuestra que la playa se cerrara (la ficha sí las lista, como
    "Laboratorio: agua no apta").

    Una playa con varios PMs produce UNA fila por episodio (ventanas
    solapadas o a ≤14 días se fusionan sobre el nombre base); `beach_id`
    apunta al PM representativo — al abrir la ficha se ven los demás
    PMs del grupo."""
    beaches = (
        db.query(Beach)
        .options(
            selectinload(Beach.incidents),
            selectinload(Beach.measurements),
            selectinload(Beach.news_items),
        )
        .filter(Beach.municipality == municipality)
        .all()
    )
    out = _merged_episode_rows(
        _collect_episodes(beaches, date.today(), include_measurement=False)
    )
    out.sort(key=lambda r: r.opened_at, reverse=True)
    return out


def _collect_episodes(
    beaches: list[Beach], today: date, include_measurement: bool = True
) -> list[Episode]:
    """Episodios crudos de un conjunto de playas: incidencias
    oficiales + eventos reconstruidos (analítica/prensa).

    `include_measurement=False` omite los episodios de analítica
    prohibida MUDOS (sin prensa de cierre en la ventana) — vistas
    de "cierres" donde una muestra mala sin corroborar no demuestra
    cierre (municipio, isla). Los corroborados sí pasan: cuentan
    como cierres según prensa."""
    episodes: list[Episode] = []
    for beach in beaches:
        # Actas consecutivas que son UNA clausura continua según la
        # prensa cuentan como un solo episodio (Jardín PM4:
        # 28-sep→7-oct fueron dos incidencias de Sanidad)
        for grp in fuse_official_episodes(beach.incidents, beach.news_items):
            inc = grp[-1]  # el acta más reciente: obs y referencia
            if is_ungraded_note(inc.observations):
                continue  # nota administrativa sin alerta real
            end = grp[-1].closed_at or today
            # Noticias dentro de la ventana oficial (±7 días): la
            # incidencia puede anotar que la prensa también lo recogió
            press_items = _press_in_window(beach, grp[0].opened_at, end)
            kind = _incident_kind(inc, press_items)
            obs = _display_obs(inc.observations, kind)
            if len(grp) > 1:
                note = f"Registrada como {len(grp)} incidencias en Sanidad"
                obs = f"{obs} · {note}" if obs else note
            episodes.append(
                Episode(
                    beach_id=inc.beach_id,
                    base=base_name(beach.name),
                    municipality=beach.municipality,
                    kind=kind,
                    start=grp[0].opened_at,
                    end=grp[-1].closed_at,
                    via="official",
                    ref_id=inc.id,
                    obs=obs,
                    press_count=len(press_items),
                    pm_label=_pm_label(beach.name),
                    # Náyade no dice la causa: la toma la prensa de la
                    # ventana; si nadie la cubrió, un cierre de Sanidad
                    # es Contaminación por definición (solo mide agua)
                    cause=(
                        _short_cause(inc.observations)
                        or _press_cause(press_items)
                        or "Contaminación"
                    ),
                    titles=frozenset(n.title for n in press_items if n.title),
                )
            )
    synth_id = -1
    for beach in beaches:
        for ev in synthesize_events(beach):
            if (
                not include_measurement
                and ev.via == "measurement"
                and not ev.press_confirmed
            ):
                continue
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
                    press_confirmed=ev.press_confirmed,
                    pm_label=_pm_label(beach.name),
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
                    titles=frozenset(
                        n.title for n in ev.press_items if n.title
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
            last_leg_start=m.last_leg_start,
            zone_beach_ids=m.zone_beach_ids,
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
    out = _merged_episode_rows(
        _collect_episodes(beaches, date.today(), include_measurement=False)
    )
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
    "Laboratorio: agua no apta" explica el
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
    out = []
    # Actas consecutivas que la prensa demuestra ser UNA clausura
    # continua salen como un solo episodio (Jardín PM4: 28-sep→7-oct
    # con dos incidencias de Sanidad) — la nota lo cuenta
    groups = fuse_official_episodes(rows, beach.news_items)
    for grp in groups:
        row = grp[-1]  # el acta más reciente aporta obs y url
        opened, closed = grp[0].opened_at, row.closed_at
        # Titulares de la ventana ±7 d que corroboran la
        # incidencia oficial — la fila los despliega como
        # evidencia ("según prensa")
        press_rows = sorted(
            _press_in_window(beach, opened, closed or today),
            key=lambda n: n.published_at,
            reverse=True,
        )
        press_items = [_news_out(n) for n in press_rows]
        obs = _display_obs(row.observations, _incident_kind(row, press_items))
        if is_ungraded_note(row.observations) and any(
            n.event_type in ("closure", "reopening", "warning", "pollution")
            for n in press_rows
        ):
            # Nota "Sin calificar" con prensa que documenta el suceso:
            # es el registro oficial del episodio — se narra como lo
            # que es (un cierre según prensa) y empieza donde la
            # prensa corrobora que empezó, no cuando Náyade anotó la
            # muestra (Gaviotas: municipio cerró el 03/06, acta 08/06)
            obs = "Cierre según prensa"
            cs = _closed_since_date(_corroborated_closed_since(press_rows))
            if cs is not None and cs < opened:
                opened = cs
        if len(grp) > 1:
            # Un episodio, varias actas: la nota lo cuenta sin
            # inflar el contador de episodios
            note = f"Registrada como {len(grp)} incidencias en Sanidad"
            obs = f"{obs} · {note}" if obs else note
        out.append(
            BeachIncidentOut(
                id=row.id,
                beach_id=row.beach_id,
                opened_at=opened,
                closed_at=closed,
                observations=obs,
                source_url=row.source_url,
                press_items=press_items,
            )
        )
    synth_id = -1
    live_closed = _latest_closed(db, beach_id)
    # Ventanas oficiales de esta playa: un episodio de prensa que las
    # solapa es el MISMO suceso — una sola fila, la oficial, con los
    # titulares del episodio absorbido sumados a los suyos como
    # corroboración (Jardín PM5: "2 cierres el 22/06 de distinta
    # fuente" era UN suceso — el de prensa retrofechado por
    # closed_since con cobertura hasta agosto)
    # Las notas "Sin calificar" también son posible fila oficial:
    # si la prensa corrobora el evento, el episodio se funde en ella
    # (Gaviotas: la nota del 08/06/2026 ES el registro del cierre
    # vigente por desprendimientos — una fila, no dos)
    official_rows = list(zip((g[-1] for g in groups), out))
    synth_evs = synthesize_events(beach)
    # Ventanas de cierre vecinas del punto (oficiales o corroboradas
    # por prensa): las mudas se anotan como recaída/preludio de ellas
    closure_windows = [
        (e.opened_at, e.closed_at)
        for e in synth_evs
        if e.via == "press" or e.press_confirmed
    ] + [
        (i.opened_at, i.closed_at)
        for i in beach.incidents
        if not is_ungraded_note(i.observations)
    ]

    # A qué fila oficial se funde cada episodio de prensa (mismo
    # suceso = solapa la vida del acta). Un episodio que ABRE al
    # cerrar el acta se funde en ella — cobertura tardía del mismo
    # suceso — SALVO que ese día hubiera reapertura documentada: la
    # reapertura prueba que el acta terminó de verdad y lo que sigue
    # es otro suceso (Jardín: el 7-oct coexisten "vuelve a abrir" y
    # "vuelve a cerrar por cuarta vez" → reabrió y cerró el mismo
    # día, dos episodios; el 3-sep solo hay cierres → el acta 2→3
    # sep y la cobertura 3→4 sep son UN suceso)
    reopen_days = {
        n.published_at.date()
        for n in beach.news_items
        if n.relevant and n.event_type == "reopening" and n.published_at
    }

    def _merge_target(ev: SynthEvent) -> int | None:
        for i, (_inc, o) in enumerate(official_rows):
            if o.opened_at <= (ev.closed_at or today) and (
                o.closed_at is None
                or ev.opened_at < o.closed_at
                or (
                    ev.opened_at == o.closed_at
                    and ev.opened_at not in reopen_days
                )
            ):
                return i
        return None

    ev_target = {
        id(ev): _merge_target(ev) for ev in synth_evs if ev.via == "press"
    }
    # Titulares de episodios que NO se funden en cada fila: fuera de
    # su evidencia — la ventana ±7 d corrobora, no puede colar la
    # ola del episodio vecino (la fila contaba 29 titulares de dos
    # cierres distintos)
    for i, (_inc, o) in enumerate(official_rows):
        foreign = {
            n.id
            for ev in synth_evs
            if ev.via == "press" and ev_target.get(id(ev)) != i
            for n in ev.press_items
        }
        if foreign:
            o.press_items = [p for p in o.press_items if p.id not in foreign]
    for ev in synth_evs:
        if ev.via == "press":
            ti = ev_target.get(id(ev))
            hit = official_rows[ti] if ti is not None else None
            if hit is not None:
                inc2, o = hit
                # Una nota "Sin calificar" que absorbe un episodio de
                # prensa ES el registro oficial del suceso — la obs
                # cuenta lo que pasó, no el detalle administrativo
                if is_ungraded_note(inc2.observations):
                    o.observations = "Cierre según prensa"
                # El inicio mostrado es el más antiguo evidenciado:
                # si la prensa sitúa el episodio antes que el acta
                # (Gaviotas: cerrada desde jul-2025, Náyade anotó la
                # muestra en jun-2026), la fila cuenta el suceso
                # real, no solo el trámite — y cuadra con el banner
                if ev.opened_at < o.opened_at:
                    o.opened_at = ev.opened_at
                if (
                    ev.closed_at is not None
                    and o.closed_at is not None
                    and ev.closed_at > o.closed_at
                ):
                    o.closed_at = ev.closed_at
                have = {p.id for p in o.press_items}
                extra = [
                    _news_out(n) for n in ev.press_items if n.id not in have
                ]
                if extra:
                    o.press_items = sorted(
                        [*o.press_items, *extra],
                        key=lambda p: (
                            p.published_at or datetime.min.replace(tzinfo=UTC)
                        ),
                        reverse=True,
                    )
                continue
        obs = _synth_observations(ev)
        if ev.via == "measurement" and not ev.press_confirmed:
            obs += _lab_context(
                ev,
                [
                    (s, e)
                    for s, e in closure_windows
                    if (s, e) != (ev.opened_at, ev.closed_at)
                ],
            )
        # Prensa aún abierta y Náyade también la da por cerrada: no es
        # "solo prensa" — el cierre tiene respaldo oficial de estado
        # aunque no exista incidencia abierta (Jardín PM4 oct-2026)
        if ev.via == "press" and ev.closed_at is None and live_closed:
            obs = "Cierre vigente — confirmado por estado oficial"
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
                    # Episodio abierto = este punto también está
                    # afectado ahora (cierre general de prensa): la
                    # atribución a hermano solo aplica a episodios
                    # ya resueltos en este punto
                    if ev.via == "press" and ev.closed_at is not None
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


@router.get(
    "/beaches/{beach_id}/news",
    response_model=BeachNewsOut,
)
def beach_news(beach_id: int, db: Session = Depends(get_db)) -> BeachNewsOut:
    """Noticias de prensa ligadas a la playa, más reciente primero,
    más un resumen determinista (evento/causa dominantes + nº medios).

    Contexto "según prensa": nunca altera el estado oficial, que solo
    sale de Náyade. La cadena de episodios vive en
    `news_episodes.press_episode_summary` (pura y testeable); aquí
    solo quedan la query y el ajuste del PM hermano."""
    beach = db.get(Beach, beach_id)
    if beach is None:
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
    summary = press_episode_summary(
        rows, synthesize_events(beach), beach.incidents, date.today()
    )
    attributed_pm = None
    # Solo si este punto NO tiene episodio vivo propio: un cierre
    # general de prensa replica la noticia a todos los PM y cada uno
    # narra SU episodio — "la zona 4 sigue cerrada" solo informa
    # cuando esta zona ya resolvió la suya y la hermana sigue abierta
    if (
        summary.dominant == "closure"
        and summary.since is not None
        and not summary.still_open
    ):
        ep_begin = (
            _closed_since_date(summary.closed_since) or summary.since.date()
        )
        attributed_pm = _sibling_pm_attribution(
            beach, db, ep_begin, date.today(), live=True
        )
        if attributed_pm:
            # El episodio vivo es de la zona hermana: el "desde" que
            # narra el banner es el inicio de SU episodio, no el viejo
            # de este punto (PM1 de Jardín diría "la cala Punta Brava
            # sigue cerrada desde junio" con sus items de verano)
            sib = (
                db.query(Beach)
                .filter(
                    Beach.municipality == beach.municipality,
                    Beach.name == f"{base_name(beach.name)} {attributed_pm}",
                )
                .first()
            )
            if sib is not None:
                live_ev = next(
                    (
                        e
                        for e in synthesize_events(sib)
                        if e.kind == "closure" and e.closed_at is None
                    ),
                    None,
                )
                if live_ev is not None:
                    summary.since = datetime(
                        live_ev.opened_at.year,
                        live_ev.opened_at.month,
                        live_ev.opened_at.day,
                        tzinfo=UTC,
                    )
                    if live_ev.closed_since:
                        summary.closed_since = live_ev.closed_since
                else:
                    # Sin episodio de prensa vivo en la hermana: su
                    # incidencia oficial abierta marca el inicio
                    sib_inc = (
                        db.query(BeachIncident)
                        .filter(
                            BeachIncident.beach_id == sib.id,
                            BeachIncident.closed_at.is_(None),
                        )
                        .order_by(BeachIncident.opened_at)
                        .first()
                    )
                    if sib_inc is not None:
                        summary.since = datetime(
                            sib_inc.opened_at.year,
                            sib_inc.opened_at.month,
                            sib_inc.opened_at.day,
                            tzinfo=UTC,
                        )
    return BeachNewsOut(
        summary=NewsSummaryOut(
            event_type=summary.dominant,
            cause=summary.cause,
            items_count=len(rows),
            outlets_count=len({r.source for r in rows if r.source}),
            since=summary.since,
            closed_since=summary.closed_since,
            attributed_pm=attributed_pm,
        ),
        items=[_news_out(row) for row in rows],
        episode_items=[_news_out(r) for r in summary.episode_items],
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
