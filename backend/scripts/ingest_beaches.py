"""Ingesta del Censo Nacional de Zonas de Aguas de Baño 2025.

Fuente oficial: MITECO / Ministerio de Sanidad (sistema Náyade).
La descarga está protegida por ALTCHA (proof-of-work), que resolvemos
programáticamente antes de pedir el fichero.

Uso: python -m scripts.ingest_beaches
"""

import base64
import hashlib
import io
import json
import re
import time
import zipfile

import requests
import shapefile

from app.db import SessionLocal
from app.models import Beach

BASE = "https://gis.miteco.gob.es/descargas/app/DescargaFichero"
FILENAME = "censoaguasbano_2025.zip"
DATASET_URL = (
    "https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/"
    "agua/censo-aguas-bano.html"
)

USER_AGENT = "CheckCoastBot/0.1 (civic data ingestion; contact: local dev)"

# Bounding box de Tenerife (WGS84)
TENERIFE_BBOX = (
    -17.0,
    27.9,
    -16.0,
    28.7,
)  # lon_min, lat_min, lon_max, lat_max


def _solve_altcha(challenge: dict) -> str:
    """Resuelve el PoW de ALTCHA y devuelve el payload en base64."""
    start = time.time()
    for n in range(challenge["maxnumber"]):
        digest = hashlib.sha256(
            (challenge["salt"] + str(n)).encode()
        ).hexdigest()
        if digest == challenge["challenge"]:
            payload = {
                "algorithm": challenge["algorithm"],
                "challenge": challenge["challenge"],
                "number": n,
                "salt": challenge["salt"],
                "signature": challenge["signature"],
                "took": int((time.time() - start) * 1000),
            }
            return base64.b64encode(json.dumps(payload).encode()).decode()
    raise RuntimeError("ALTCHA: no se encontró solución")


def _download_zip() -> zipfile.ZipFile:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT

    page = s.get(f"{BASE}?f={FILENAME}", timeout=60)
    page.raise_for_status()
    token = re.search(
        r'__RequestVerificationToken[^>]*value="([^"]+)"', page.text
    ).group(1)

    challenge = s.get(f"{BASE}?handler=Altcha", timeout=60).json()
    altcha = _solve_altcha(challenge)

    resp = s.post(
        f"{BASE}?handler=Download",
        data={
            "f": FILENAME,
            "altcha": altcha,
            "__RequestVerificationToken": token,
        },
        timeout=120,
    )
    resp.raise_for_status()
    return zipfile.ZipFile(io.BytesIO(resp.content))


def main() -> None:
    z = _download_zip()
    base = "ProtectedAreaPoint/ProtectedAreaPoint"
    reader = shapefile.Reader(
        shp=io.BytesIO(z.read(f"{base}.shp")),
        shx=io.BytesIO(z.read(f"{base}.shx")),
        dbf=io.BytesIO(z.read(f"{base}.dbf")),
        encoding="latin1",
    )
    fields = [f[0] for f in reader.fields[1:]]

    lon_min, lat_min, lon_max, lat_max = TENERIFE_BBOX
    db = SessionLocal()
    created = updated = 0
    try:
        for sr in reader.iterShapeRecords():
            rec = dict(zip(fields, sr.record))
            lon, lat = float(rec["lon"]), float(rec["lat"])
            if not (lon_min <= lon <= lon_max and lat_min <= lat <= lat_max):
                continue

            external_id = f"zb2025-{rec['localId']}"
            obj = (
                db.query(Beach)
                .filter_by(external_id=external_id)
                .one_or_none()
            )
            if obj is None:
                obj = Beach(external_id=external_id)
                created += 1
            else:
                updated += 1

            obj.name = rec["nameText"]
            obj.geom = f"SRID=4326;POINT({lon} {lat})"
            obj.source_url = DATASET_URL
            db.add(obj)

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print(f"Beaches: {created} creadas, {updated} actualizadas")


if __name__ == "__main__":
    main()
