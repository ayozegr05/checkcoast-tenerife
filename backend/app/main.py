from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI

from app.config import settings
from app.routers import alerts, beaches, devices, outfalls


def _sync_beach_statuses() -> None:
    from scripts.ingest_beach_status import run

    try:
        updated, seen = run()
        print(f"[nayade-sync] {updated} estados nuevos ({seen} PMs)")
    except Exception as e:  # el scraper es externo y frágil: no tumbar la API
        print(f"[nayade-sync] error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        _sync_beach_statuses,
        "interval",
        seconds=settings.nayade_sync_seconds,
        id="nayade-sync",
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


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "checkcoast-tenerife"}
