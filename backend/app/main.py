from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal, get_db
from app.models import ClientEvent, JobRun
from app.routers import alerts, beaches, devices, outfalls, share

# Un sync sin éxito durante >2× su intervalo se marca `stale` en
# /health — un fallo aislado no degrada el servicio
_JOB_STALE_FACTOR = 2
_JOBS = ("nayade-sync", "news-sync")


def _run_job(job: str, fn: Callable[[], dict]) -> None:
    """Envuelve una pasada del scheduler y la persiste en `job_runs`.

    Sin esto, la salud del pipeline solo viviría en los logs del
    contenedor — un restart las borra y /health no podría decir cuándo
    fue la última sync buena ni si el último run falló."""
    started = datetime.now(UTC)
    try:
        detail = fn()
        ok, error = True, None
    except Exception as e:  # scraper/fuentes/LLM externos: no tumbar la API
        detail, ok, error = None, False, str(e)[:500]
        print(f"[{job}] error: {e}")
    try:
        db = SessionLocal()
        try:
            db.add(
                JobRun(
                    job=job,
                    started_at=started,
                    finished_at=datetime.now(UTC),
                    ok=ok,
                    error=error,
                    detail=detail,
                )
            )
            db.commit()
        finally:
            db.close()
    except Exception as e:  # la DB caída no puede tumbar el scheduler
        print(f"[{job}] no se pudo registrar el run: {e}")


def _sync_beach_statuses() -> None:
    def _run() -> dict:
        from scripts.ingest_beach_status import run

        updated, seen = run()
        print(f"[nayade-sync] {updated} estados nuevos ({seen} PMs)")
        return {"updated": updated, "seen_pms": seen}

    _run_job("nayade-sync", _run)


def _sync_news() -> None:
    def _run() -> dict:
        from scripts.ingest_news import run

        inserted, processed, rematched, llm_errors = run()
        print(
            f"[news-sync] {inserted} noticias ({processed} procesadas, "
            f"{rematched} recasadas, {llm_errors} errores LLM)"
        )
        return {
            "inserted": inserted,
            "processed": processed,
            "rematched": rematched,
            "llm_errors": llm_errors,
        }

    _run_job("news-sync", _run)


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


def _job_health(db: Session, job: str, interval_s: int) -> dict:
    last = db.scalar(
        select(JobRun)
        .where(JobRun.job == job)
        .order_by(JobRun.started_at.desc())
        .limit(1)
    )
    last_ok_at = db.scalar(
        select(func.max(JobRun.finished_at)).where(
            JobRun.job == job,
            JobRun.ok.is_(True),
        )
    )
    stale = last_ok_at is None or (datetime.now(UTC) - last_ok_at) > timedelta(
        seconds=interval_s * _JOB_STALE_FACTOR
    )
    return {
        "last_run_at": last.started_at.isoformat() if last else None,
        "last_ok_at": last_ok_at.isoformat() if last_ok_at else None,
        "last_ok": last.ok if last else None,
        # El error solo viaja si el ÚLTIMO run falló — un fallo ya
        # superado no es una señal activa
        "last_error": last.error if last and not last.ok else None,
        "stale": stale,
    }


@app.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    """Liveness + readiness para el monitor externo (ROADMAP 10.8).

    Siempre responde 200: el healthcheck de Docker solo necesita que el
    proceso conteste, y el estado real lo dice `status` ("ok"/"degraded")
    — un 503 marcaría unhealthy el contenedor por una sync rancia."""
    payload: dict = {"service": "checkcoast-tenerife", "db": "ok"}
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        payload["db"] = "error"
        payload["status"] = "degraded"
        return payload

    jobs = {
        "nayade-sync": _job_health(
            db, "nayade-sync", settings.nayade_sync_seconds
        ),
        "news-sync": _job_health(db, "news-sync", settings.news_sync_seconds),
    }
    since = datetime.now(UTC) - timedelta(hours=24)
    # Errores LLM de la última pasada de cada run (detail.llm_errors):
    # son errores de proveedor — la pasada siguió y quedó ok=true
    llm_errors = sum(
        (detail or {}).get("llm_errors", 0)
        for (detail,) in db.execute(
            select(JobRun.detail).where(
                JobRun.job == "news-sync",
                JobRun.finished_at >= since,
            )
        )
    )
    job_failures = db.scalar(
        select(func.count())
        .select_from(JobRun)
        .where(JobRun.ok.is_(False), JobRun.finished_at >= since)
    )
    client_errors = db.scalar(
        select(func.count())
        .select_from(ClientEvent)
        .where(ClientEvent.created_at >= since)
    )
    payload["jobs"] = jobs
    payload["errors_24h"] = {
        "llm": llm_errors,
        "job_runs": job_failures or 0,
        "client": client_errors or 0,
    }
    payload["status"] = (
        "degraded" if any(j["stale"] for j in jobs.values()) else "ok"
    )
    return payload
