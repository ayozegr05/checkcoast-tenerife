"""Ingesta de playas NO monitorizadas desde OpenStreetMap.

El censo oficial (MITECO/Náyade) solo cubre zonas de baño vigiladas.
OpenStreetMap etiqueta el resto (`natural=beach`): caletas y playas
naturales sin control sanitario oficial. Se insertan como
`beaches.monitored = False` y la app las muestra en gris como
"sin monitorización oficial".

Dedup: se descartan elementos sin nombre y los que casan con una playa
oficial existente (mismo nombre normalizado o a menos de ~400 m de un
punto de muestreo).

Uso: python -m scripts.ingest_osm_beaches
"""

import math
import re
import unicodedata

import requests
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Beach

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "CheckCoastBot/0.1 (civic data ingestion; contact: local dev)"

SOURCE_URL = "https://www.openstreetmap.org/copyright"

# Bounding box de Tenerife (WGS84): sur, oeste, norte, este
TENERIFE_BBOX = (27.9, -17.0, 28.7, -16.0)

# Distancia (m) bajo la cual una playa OSM se considera ya cubierta por
# un punto de muestreo oficial
COVERED_DISTANCE_M = 400.0

QUERY = """
[out:json][timeout:60];
(
  node["natural"="beach"]({s},{w},{n},{e});
  way["natural"="beach"]({s},{w},{n},{e});
);
out center tags;
"""


def _normalize(name: str) -> str:
    """Mayúsculas, sin acentos, sin sufijo PM, espacios colapsados."""
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\s+PM\d+$", "", s)  # las oficiales acaban en PM1, PM4...
    return re.sub(r"\s+", " ", s).strip().upper()


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = (
        math.sin(dp / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


def _fetch_osm_beaches() -> list[dict]:
    """Elementos natural=beach con nombre en el bbox de Tenerife."""
    s, w, n, e = TENERIFE_BBOX
    resp = requests.post(
        OVERPASS_URL,
        data={"data": QUERY.format(s=s, w=w, n=n, e=e)},
        headers={"User-Agent": USER_AGENT},
        timeout=120,
    )
    resp.raise_for_status()
    elements = resp.json()["elements"]

    beaches = []
    for el in elements:
        name = (el.get("tags") or {}).get("name")
        if not name:
            continue  # sin nombre no es mostrable
        if el["type"] == "node":
            lat, lon = el["lat"], el["lon"]
        else:  # way -> centroide calculado por Overpass
            center = el.get("center")
            if not center:
                continue
            lat, lon = center["lat"], center["lon"]
        beaches.append(
            {
                "external_id": f"osm-{el['type']}-{el['id']}",
                "name": name.strip(),
                "lat": lat,
                "lon": lon,
            }
        )
    return beaches


def _is_covered(
    lat: float,
    lon: float,
    name: str,
    officials: list[tuple[float, float, str]],
) -> bool:
    """True si la playa OSM ya está cubierta por el censo oficial."""
    norm = _normalize(name)
    for blat, blon, bname in officials:
        if norm == bname:
            return True
        if _haversine_m(lat, lon, blat, blon) < COVERED_DISTANCE_M:
            return True
    return False


def _official_beaches(db: Session) -> list[tuple[float, float, str]]:
    """(lat, lon, nombre normalizado) de las playas monitorizadas."""
    from sqlalchemy import func

    rows = db.query(
        func.ST_Y(Beach.geom), func.ST_X(Beach.geom), Beach.name
    ).filter(Beach.monitored.is_(True))
    return [(lat, lon, _normalize(name)) for lat, lon, name in rows]


def main() -> None:
    elements = _fetch_osm_beaches()
    db = SessionLocal()
    created = updated = skipped = 0
    try:
        officials = _official_beaches(db)
        existing = {
            b.external_id
            for b in db.query(Beach.external_id)
            .filter(Beach.external_id.like("osm-%"))
            .all()
        }
        for el in elements:
            if _is_covered(el["lat"], el["lon"], el["name"], officials):
                skipped += 1
                continue
            if el["external_id"] in existing:
                updated += 1
                continue
            db.add(
                Beach(
                    external_id=el["external_id"],
                    name=el["name"],
                    monitored=False,
                    geom=f"SRID=4326;POINT({el['lon']} {el['lat']})",
                    source_url=SOURCE_URL,
                )
            )
            created += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print(
        f"OSM beaches: {created} creadas, {updated} ya existían, "
        f"{skipped} cubiertas por el censo oficial"
    )


if __name__ == "__main__":
    main()
