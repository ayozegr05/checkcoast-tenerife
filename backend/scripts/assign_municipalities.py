"""Asignación geográfica de municipio a playas que llegan sin él.

Las playas oficiales (censo MITECO/Náyade) traen el municipio en el
nombre de la zona, pero las ingeridas desde OpenStreetMap no. Este
script carga los límites municipales de Tenerife
(`scripts/data/tenerife_municipalities.geojson`, extraídos de OSM vía
Nominatim) y asigna a cada playa sin municipio el polígono municipal
más cercano — los nodos OSM de `natural=beach` suelen caer unos metros
mar adentro, así que se usa distancia (≤500 m) y no ST_Within.

Los nombres OSM ("La Orotava") se normalizan a la grafía del censo
oficial ("Orotava (La)") cuando ya existe ese municipio en la tabla.

Uso: python -m scripts.assign_municipalities
"""

import json
import re
import unicodedata
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import SessionLocal

GEOJSON_PATH = (
    Path(__file__).parent / "data" / "tenerife_municipalities.geojson"
)

# Distancia máxima (m) playa→límite municipal para aceptar la asignación.
# Cubre nodos OSM dibujados unos metros mar adentro.
MAX_DISTANCE_M = 500.0

_ARTICLES = ("EL", "LA", "LOS", "LAS")


def _canon(name: str) -> str:
    """Forma canónica para casar grafías OSM y censo.

    "Orotava (La)" y "La Orotava" → "LA OROTAVA"; sin acentos, mayúsculas.
    """
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\s+", " ", s.strip().upper())
    m = re.match(r"^(.*) \((EL|LA|LOS|LAS)\)$", s)
    if m:
        s = f"{m.group(2)} {m.group(1)}"
    # "EL SAUZAL" ya empieza por artículo; nada más que hacer
    return s


def _db_municipality_names(db: Session) -> dict[str, str]:
    """canon → grafía real usada en beaches.municipality."""
    rows = db.execute(
        text(
            "SELECT DISTINCT municipality FROM beaches "
            "WHERE municipality IS NOT NULL"
        )
    ).scalars()
    return {_canon(n): n for n in rows}


def _load_municipalities(db_name_map: dict[str, str]) -> list[dict]:
    """(nombre a persistir, GeoJSON) por municipio."""
    fc = json.loads(GEOJSON_PATH.read_text(encoding="utf-8"))
    out = []
    for feat in fc["features"]:
        osm_name = feat["properties"]["name"]
        name = db_name_map.get(_canon(osm_name), osm_name)
        out.append({"name": name, "geojson": json.dumps(feat["geometry"])})
    return out


def assign_municipalities(db: Session) -> int:
    """Rellena municipality de las playas sin él. Devuelve nº asignadas."""
    munis = _load_municipalities(_db_municipality_names(db))

    db.execute(
        text(
            "CREATE TEMP TABLE IF NOT EXISTS tmp_muni ("
            "  name text PRIMARY KEY, geom geometry(MultiPolygon, 4326)"
            ") ON COMMIT DROP"
        )
    )
    db.execute(text("DELETE FROM tmp_muni"))
    for m in munis:
        db.execute(
            text(
                "INSERT INTO tmp_muni (name, geom) VALUES ("
                "  :name,"
                "  ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(:gj), 4326)))"
            ),
            {"name": m["name"], "gj": m["geojson"]},
        )

    # Municipio más cercano a ≤ MAX_DISTANCE_M de cada playa sin asignar
    result = db.execute(
        text(
            "UPDATE beaches b SET municipality = m.name "
            "FROM ("
            "  SELECT DISTINCT ON (b2.id) b2.id, m.name"
            "  FROM beaches b2"
            "  JOIN tmp_muni m ON ST_DWithin("
            "    b2.geom::geography, m.geom::geography, :max_m)"
            "  ORDER BY b2.id,"
            "    ST_Distance(b2.geom::geography, m.geom::geography)"
            ") m "
            "WHERE b.id = m.id AND b.municipality IS NULL"
        ),
        {"max_m": MAX_DISTANCE_M},
    )
    return result.rowcount


def main() -> None:
    db = SessionLocal()
    try:
        assigned = assign_municipalities(db)
        db.commit()
        remaining = db.execute(
            text(
                "SELECT count(*) FROM beaches WHERE municipality IS NULL"
            )
        ).scalar()
        print(
            f"Municipios asignados: {assigned}; "
            f"siguen sin municipio: {remaining}"
        )
        if remaining:
            rows = db.execute(
                text(
                    "SELECT id, name FROM beaches "
                    "WHERE municipality IS NULL ORDER BY name"
                )
            ).fetchall()
            for r in rows:
                print("  -", r.id, r.name)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
