from fastapi import FastAPI

app = FastAPI(
    title="CheckCoast Tenerife API",
    description="API cívica para el mapeo de emisarios submarinos y estado de playas en Tenerife.",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "checkcoast-tenerife"}
