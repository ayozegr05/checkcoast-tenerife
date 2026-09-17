"""Ingesta del estado e incidentes de las zonas de baño desde Náyade.

Náyade (Ministerio de Sanidad) no ofrece API pública; se scrapea el
acceso ciudadano del portal:

1. POST ciudadanoListaZonaAction.do (CCAA=Canarias, prov=38) -> codZona
   de cada zona de baño de la provincia de Santa Cruz de Tenerife.
2. POST ciudadanoVerZonaAction.do?pestanya=1 -> pestaña "Localización":
   isla y municipio. Se descartan las zonas que no sean de Tenerife.
3. POST ciudadanoVerZonaAction.do?pestanya=3 -> pestaña "Muestreos":
   puntos de muestreo (PM) y su tabla de incidentes con fecha de
   apertura / cierre / observaciones.

Un incidente con apertura pero sin cierre = alerta activa:
- "prohibido el baño" -> closed
- cualquier otro incidente abierto -> warning
- sin incidentes abiertos -> open

Los PM se casan con `beaches.name` del censo MITECO (mismo nombre).
Incidentes y estados solo se insertan cuando hay novedad
(dedup por playa + apertura + observaciones / cambio de estado).

Uso: python -m scripts.ingest_beach_status
"""

import re
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

import requests
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Beach, BeachIncident, BeachState, BeachStatus

BASE = "https://nayadeciudadano.sanidad.gob.es/Splayas/ciudadano"
SOURCE_URL = f"{BASE}/indexCiudadanoAction.do"
USER_AGENT = "CheckCoastBot/0.1 (civic data ingestion; contact: local dev)"

# Listado de zonas de la provincia de Santa Cruz de Tenerife
LIST_BODY = {
    "codCCAA": "5",  # Canarias
    "codProvincia": "38",
    "codMunicipio": "",
    "codZona": "",
    "denZona": "",
    "provinciaMapa": "",
}

RE_ZONE = re.compile(r"verZona\('(\d+)'\)[^>]*>([^<]+)</a>")
RE_PM = re.compile(
    r'Punto Muestreo:</td>\s*<td class="nombreCampoNI">([^<]+)</td>'
)
RE_INCIDENT = re.compile(
    r'<td class="valorCampoI">(\d{2}/\d{2}/\d{4})</td>\s*'
    r'<td class="valorCampoI">([^<]*)</td>\s*'
    r'<td class="valorCampoI">([^<]*)</td>'
)
RE_FIELD = (
    lambda label: rf'{label}:</td>\s*'
    r'<td[^>]*class="valorCampoI"[^>]*>([^<]*)</td>'
)
INCIDENT_BLOCK = ("<!--INFORMACION INCIDENCIA -->", "<!--FIN INFORMACION INCIDENCIA -->")


@dataclass
class Incident:
    opened: date
    closed: date | None
    observations: str


@dataclass
class ZoneInfo:
    island: str
    municipality: str
    pms: dict[str, tuple[str, list[Incident]]] = field(default_factory=dict)


def _normalize(name: str) -> str:
    """Mayúsculas, sin acentos, espacios colapsados — para casar nombres."""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().upper()


def _parse_date(s: str) -> date | None:
    s = s.strip().replace("&nbsp;", "")
    if not s or s == "--":  # "--" = incidente aún abierto
        return None
    return datetime.strptime(s, "%d/%m/%Y").date()


def _post(session: requests.Session, action: str, **data) -> str:
    resp = session.post(f"{BASE}/{action}", data=data, timeout=60)
    resp.raise_for_status()
    resp.encoding = "latin1"
    return resp.text


def _fetch_zones(session: requests.Session) -> dict[str, str]:
    """Devuelve {codZona: nombre de zona} de la provincia."""
    html = _post(session, "ciudadanoListaZonaAction.do", **LIST_BODY)
    return {m.group(1): m.group(2) for m in RE_ZONE.finditer(html)}


def _zone_body(cod_zona: str, pestanya: str) -> dict:
    return {
        "codZona": cod_zona,
        "pestanya": pestanya,
        "actionProcedencia": "ciudadanoListaZonaAction",
        "codCCAA": "5",
        "codProvincia": "38",
        "codMunicipio": "",
        "denZona": "",
        "codPlaya": "",
        "provinciaMapa": "",
    }


def _fetch_zone_info(session: requests.Session, cod_zona: str) -> ZoneInfo:
    """Pestaña Localización: isla y municipio de la zona."""
    html = _post(
        session, "ciudadanoVerZonaAction.do", **_zone_body(cod_zona, "1")
    )
    isla = re.search(RE_FIELD("Isla"), html)
    muni = re.search(RE_FIELD("Municipio"), html)
    return ZoneInfo(
        island=(isla.group(1).strip() if isla else ""),
        municipality=(muni.group(1).strip() if muni else ""),
    )


def _parse_incidents(block: str) -> list[Incident]:
    """Incidentes de un bloque de PM (apertura / cierre / observaciones)."""
    if INCIDENT_BLOCK[0] not in block:
        return []
    inc_html = block.split(INCIDENT_BLOCK[0], 1)[1].split(
        INCIDENT_BLOCK[1], 1
    )[0]
    return [
        Incident(
            opened=datetime.strptime(m.group(1), "%d/%m/%Y").date(),
            closed=_parse_date(m.group(2)),
            observations=m.group(3).strip(),
        )
        for m in RE_INCIDENT.finditer(inc_html)
    ]


def _parse_pms(html: str) -> dict[str, tuple[str, list[Incident]]]:
    """Pestaña Muestreos: {PM normalizado: (nombre raw, incidentes)}."""
    pms: dict[str, tuple[str, list[Incident]]] = {}
    marks = list(RE_PM.finditer(html))
    for i, pm in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(html)
        raw_name = pm.group(1).strip()
        pms[_normalize(raw_name)] = (
            raw_name,
            _parse_incidents(html[pm.start() : end]),
        )
    return pms


def _fetch_zone_pms(
    session: requests.Session, cod_zona: str
) -> dict[str, tuple[str, list[Incident]]]:
    html = _post(
        session, "ciudadanoVerZonaAction.do", **_zone_body(cod_zona, "3")
    )
    return _parse_pms(html)


def _state_from_incidents(incidents: list[Incident]) -> BeachState:
    state = BeachState.open
    for inc in incidents:
        if inc.closed is not None:
            continue  # incidente ya resuelto
        obs = _normalize(inc.observations)
        if "PROHIBIDO" in obs or "PROHIBICION" in obs:
            return BeachState.closed
        state = BeachState.warning
    return state


def _latest_status_map(db: Session) -> dict[int, BeachState]:
    """{beach_id: último BeachState conocido}."""
    result: dict[int, BeachState] = {}
    for beach in db.query(Beach).all():
        if beach.statuses:
            result[beach.id] = beach.statuses[0].status
    return result


def _find_beach(
    norm_pm: str, beaches: dict[str, Beach]
) -> Beach | None:
    """Casa el PM de Náyade con una playa de la BD.

    El censo MITECO dejó `?` en algunos nombres (problema de encoding del
    shapefile); en ese caso se usa como comodín de un carácter.
    """
    if norm_pm in beaches:
        return beaches[norm_pm]
    for key, beach in beaches.items():
        if "?" in key and re.fullmatch(re.escape(key).replace(r"\?", "."), norm_pm):
            return beach
    return None


def _persist(
    db: Session,
    beach: Beach,
    raw_pm: str,
    municipality: str,
    incidents: list[Incident],
    latest: dict[int, BeachState],
) -> bool:
    """Actualiza municipio/nombre, upsert de incidentes y estado.
    Devuelve True si el estado cambió."""
    if not beach.municipality and municipality:
        beach.municipality = municipality
    if "?" in beach.name:
        beach.name = raw_pm

    existing = {(i.opened_at, i.observations) for i in beach.incidents}
    for inc in incidents:
        if (inc.opened, inc.observations) not in existing:
            db.add(
                BeachIncident(
                    beach_id=beach.id,
                    opened_at=inc.opened,
                    closed_at=inc.closed,
                    observations=inc.observations,
                    source_url=SOURCE_URL,
                )
            )

    state = _state_from_incidents(incidents)
    if latest.get(beach.id) != state:
        db.add(
            BeachStatus(
                beach_id=beach.id,
                status=state,
                reported_at=datetime.now(timezone.utc),
                source_url=SOURCE_URL,
            )
        )
        return True
    return False


def run() -> tuple[int, int]:
    """Ejecuta una pasada de ingesta. Devuelve (estados nuevos, PMs vistos)."""
    http = requests.Session()
    http.headers["User-Agent"] = USER_AGENT

    db = SessionLocal()
    updated = seen = 0
    try:
        beaches = {_normalize(b.name): b for b in db.query(Beach).all()}
        latest = _latest_status_map(db)

        for cod in _fetch_zones(http):
            try:
                info = _fetch_zone_info(http, cod)
                if _normalize(info.island) != "TENERIFE":
                    continue
                for norm_pm, (raw_pm, incs) in _fetch_zone_pms(
                    http, cod
                ).items():
                    seen += 1
                    beach = _find_beach(norm_pm, beaches)
                    if beach is None:
                        continue
                    if _persist(
                        db, beach, raw_pm, info.municipality, incs, latest
                    ):
                        updated += 1
                        latest[beach.id] = _state_from_incidents(incs)
            except requests.RequestException as e:
                print(f"  zona {cod}: error {e}")
            time.sleep(0.3)  # ser amable con el portal

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return updated, seen


def main() -> None:
    updated, seen = run()
    print(f"BeachStatus: {updated} estados nuevos ({seen} PMs consultados)")


if __name__ == "__main__":
    main()
