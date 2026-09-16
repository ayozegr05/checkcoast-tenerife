"""Ingesta del Censo de Vertidos desde Tierra al Mar 2025.

Fuente oficial: Gobierno de Canarias / SITCAN Open Data (CKAN).
Descarga el shapefile, filtra los puntos de vertido de Tenerife y los
upserta en la tabla `outfalls` (SRID 4326).

Uso: python -m scripts.ingest_outfalls
"""

import io
import zipfile

import requests
import shapefile
from pyproj import Transformer

from app.db import SessionLocal
from app.models import Outfall, OutfallStatus

DATASET_URL = (
    "https://opendata.sitcan.es/dataset/"
    "actualizacion-del-censo-de-vertidos-desde-tierra-al-mar-ano-2025"
)
SHP_URL = (
    "https://opendata.sitcan.es/dataset/"
    "7f9d6edd-4ccb-4c1c-9989-3733513fd1a2/resource/"
    "1afef8bb-ed7d-4177-bf21-0d60c687a8fc/download/censo_vertidos_2025.zip"
)

# El shapefile viene en WGS84 / UTM zona 28N (EPSG:32628)
_to_wgs84 = Transformer.from_crs("EPSG:32628", "EPSG:4326", always_xy=True)

_STATUS_MAP = {
    "Autorizado": OutfallStatus.legal,
    "No autorizado": OutfallStatus.illegal,
}


def _read_zip(url: str) -> zipfile.ZipFile:
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    return zipfile.ZipFile(io.BytesIO(resp.content))


def main() -> None:
    z = _read_zip(SHP_URL)
    reader = shapefile.Reader(
        shp=io.BytesIO(z.read("CensoVertidos.shp")),
        shx=io.BytesIO(z.read("CensoVertidos.shx")),
        dbf=io.BytesIO(z.read("CensoVertidos.dbf")),
        encoding="utf-8",
    )
    fields = [f[0] for f in reader.fields[1:]]

    db = SessionLocal()
    created = updated = skipped = 0
    try:
        for sr in reader.iterShapeRecords():
            rec = dict(zip(fields, sr.record))
            if rec["Isla"] != "Tenerife" or rec["Punto"] != "Vertido":
                continue

            x, y = sr.shape.points[0]
            lon, lat = _to_wgs84.transform(x, y)
            external_id = f"censo2025-{rec['ID']}"

            obj = db.query(Outfall).filter_by(external_id=external_id).one_or_none()
            if obj is None:
                obj = Outfall(external_id=external_id)
                created += 1
            else:
                updated += 1

            obj.name = rec["Denomina"]
            obj.municipality = rec["Municipio"] or None
            obj.kind = rec["TipoCond"]
            obj.status = _STATUS_MAP.get(rec["EstExpVC"], OutfallStatus.unknown)
            obj.geom = f"SRID=4326;POINT({lon} {lat})"
            obj.source_url = DATASET_URL
            db.add(obj)

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print(f"Outfalls: {created} creados, {updated} actualizados, {skipped} omitidos")


if __name__ == "__main__":
    main()
