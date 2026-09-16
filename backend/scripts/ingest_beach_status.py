"""Ingesta del estado actual de las zonas de baño desde Náyade.

Náyade (Ministerio de Sanidad) no ofrece API pública; se scrapea el
acceso ciudadano del portal:

1. POST ciudadanoListaZonaAction.do (CCAA=Canarias, prov=38) -> codZona
   de cada zona de baño de la provincia de Santa Cruz de Tenerife.
2. POST ciudadanoVerZonaAction.do?pestanya=3 -> pestaña "Muestreos" con
   los puntos de muestreo (PM) de la zona y su tabla de incidentes
   (fecha de apertura / fecha de cierre / observaciones).

Un incidente con apertura pero sin cierre = alerta activa:
- "prohibido el baño" -> closed
- cualquier otro incidente abierto -> warning
- sin incidentes abiertos -> open

Los PM se casan con `beaches.name` del censo MITECO (mismo nombre).
Solo se inserta una fila `beach_statuses` cuando el estado cambia
respecto al último conocido.

Uso: python -m scripts.ingest_beach_status
"""

import re
import time
import unicodedata
from datetime import datetime, timezone

import requests
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Beach, BeachState, BeachStatus

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
INCIDENT_BLOCK = ("<!--INFORMACION INCIDENCIA -->", "<!--FIN INFORMACION INCIDENCIA -->")


def _normalize(name: str) -> str:
    """Mayúsculas, sin acentos, espacios colapsados — para casar nombres."""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().upper()


def _fetch_zones(session: requests.Session) -> dict[str, str]:
    """Devuelve {codZona: nombre de zona} de la provincia."""
    resp = session.post(
        f"{BASE}/ciudadanoListaZonaAction.do", data=LIST_BODY, timeout=60
    )
    resp.raise_for_status()
    resp.encoding = "latin1"
    return {m.group(1): m.group(2) for m in RE_ZONE.finditer(resp.text)}


def _parse_zone_status(html: str) -> dict[str, tuple[str, BeachState]]:
    """Devuelve {nombre PM normalizado: (nombre PM raw, estado)} a partir
    de la pestaña Muestreos de la ficha de zona."""
    statuses: dict[str, tuple[str, BeachState]] = {}
    pm_marks = list(RE_PM.finditer(html))

    for i, pm in enumerate(pm_marks):
        end = pm_marks[i + 1].start() if i + 1 < len(pm_marks) else len(html)
        block = html[pm.start() : end]
        raw_name = pm.group(1).strip()

        state = BeachState.open
        if INCIDENT_BLOCK[0] in block:
            inc_html = block.split(INCIDENT_BLOCK[0], 1)[1].split(
                INCIDENT_BLOCK[1], 1
            )[0]
            for m in RE_INCIDENT.finditer(inc_html):
                cierre = m.group(2).strip().replace("&nbsp;", "")
                if cierre:  # incidente ya cerrado
                    continue
                obs = _normalize(m.group(3))
                if "PROHIBIDO" in obs or "PROHIBICION" in obs:
                    state = BeachState.closed
                    break
                state = BeachState.warning

        statuses[_normalize(raw_name)] = (raw_name, state)
    return statuses


def _fetch_zone_status(
    session: requests.Session, cod_zona: str
) -> dict[str, tuple[str, BeachState]]:
    resp = session.post(
        f"{BASE}/ciudadanoVerZonaAction.do",
        data={
            "codZona": cod_zona,
            "pestanya": "3",
            "actionProcedencia": "ciudadanoListaZonaAction",
            "codCCAA": "5",
            "codProvincia": "38",
            "codMunicipio": "",
            "denZona": "",
            "codPlaya": "",
            "provinciaMapa": "",
        },
        timeout=60,
    )
    resp.raise_for_status()
    resp.encoding = "latin1"
    return _parse_zone_status(resp.text)


def _latest_status_map(db: Session) -> dict[int, BeachState]:
    """{beach_id: último BeachState conocido}."""
    result: dict[int, BeachState] = {}
    for beach in db.query(Beach).all():
        if beach.statuses:
            result[beach.id] = beach.statuses[0].status
    return result


def _find_pm(
    beach_name: str, pm_states: dict[str, tuple[str, BeachState]]
) -> tuple[str, BeachState] | None:
    """Casa el nombre de playa con un PM de Náyade.

    El censo MITECO dejó `?` en algunos nombres (problema de encoding del
    shapefile); en ese caso se usa como comodín de un carácter.
    """
    norm = _normalize(beach_name)
    if norm in pm_states:
        return pm_states[norm]
    if "?" in norm:
        pat = re.escape(norm).replace(r"\?", ".")
        for key, val in pm_states.items():
            if re.fullmatch(pat, key):
                return val
    return None


def run() -> tuple[int, int]:
    """Ejecuta una pasada de ingesta. Devuelve (playas actualizadas, PMs vistos)."""
    http = requests.Session()
    http.headers["User-Agent"] = USER_AGENT

    zones = _fetch_zones(http)
    pm_states: dict[str, tuple[str, BeachState]] = {}
    for cod in zones:
        try:
            pm_states.update(_fetch_zone_status(http, cod))
        except requests.RequestException as e:
            print(f"  zona {cod}: error {e}")
        time.sleep(0.3)  # ser amable con el portal

    # Guardamos el nombre original del PM para reparar nombres con `?`
    db = SessionLocal()
    updated = 0
    try:
        latest = _latest_status_map(db)
        for beach in db.query(Beach).all():
            hit = _find_pm(beach.name, pm_states)
            if hit is None:
                continue
            _, state = hit
            if "?" in beach.name:
                beach.name = hit[0]
            if latest.get(beach.id) != state:
                db.add(
                    BeachStatus(
                        beach_id=beach.id,
                        status=state,
                        reported_at=datetime.now(timezone.utc),
                        source_url=SOURCE_URL,
                    )
                )
                updated += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return updated, len(pm_states)


def main() -> None:
    updated, seen = run()
    print(f"BeachStatus: {updated} estados nuevos ({seen} PMs consultados)")


if __name__ == "__main__":
    main()
