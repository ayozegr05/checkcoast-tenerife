from fastapi import FastAPI

from app.routers import alerts, beaches, outfalls

app = FastAPI(
    title="CheckCoast Tenerife API",
    description="API cívica para el mapeo de emisarios submarinos y estado de playas en Tenerife.",
    version="0.1.0",
)

app.include_router(outfalls.router)
app.include_router(beaches.router)
app.include_router(alerts.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "checkcoast-tenerife"}
