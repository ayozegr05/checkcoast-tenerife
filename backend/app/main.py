from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import alerts, beaches, devices, outfalls, share


def _sync_beach_statuses() -> None:
    from scripts.ingest_beach_status import run

    try:
        updated, seen = run()
        print(f"[nayade-sync] {updated} estados nuevos ({seen} PMs)")
    except Exception as e:  # el scraper es externo y frágil: no tumbar la API
        print(f"[nayade-sync] error: {e}")


def _sync_news() -> None:
    from scripts.ingest_news import run

    try:
        inserted, processed, rematched = run()
        print(
            f"[news-sync] {inserted} noticias ({processed} procesadas, "
            f"{rematched} recasadas)"
        )
    except Exception as e:  # fuentes externas + LLM: no tumbar la API
        print(f"[news-sync] error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        _sync_beach_statuses,
        "interval",
        seconds=settings.nayade_sync_seconds,
        id="nayade-sync",
    )
    scheduler.add_job(
        _sync_news,
        "interval",
        seconds=settings.news_sync_seconds,
        id="news-sync",
    )
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="CheckCoast Tenerife API",
    description="API cívica para el mapeo de emisarios submarinos y estado de playas en Tenerife.",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(outfalls.router)
app.include_router(beaches.router)
app.include_router(alerts.router)
app.include_router(devices.router)
app.include_router(share.router)

# Iconos PNG (pins del mapa) para la mini-ficha pública de share
app.mount(
    "/icons",
    StaticFiles(directory="app/static/icons"),
    name="icons",
)

# Imágenes de la landing pública (captura de la app, QR al repo)
app.mount(
    "/img",
    StaticFiles(directory="app/static/img"),
    name="img",
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "checkcoast-tenerife"}
