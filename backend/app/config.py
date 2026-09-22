from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "postgresql+psycopg2://checkcoast:checkcoast@localhost:5433/checkcoast"
    )
    # Intervalo de refresco del estado de playas desde Náyade (segundos)
    nayade_sync_seconds: int = 3600
    # Contexto de prensa (Hito 8.5): extracción LLM de eventos de playa
    gemini_api_key: str | None = None
    # 2.5-flash: deprecado (nuevos usuarios). 3.6-flash: free tier casi
    # sin cuota hoy. 3.5-flash: estable y con cuota (verificado 2026-09)
    gemini_model: str = "gemini-3.5-flash"
    news_sync_seconds: int = 21600  # 6 h
    news_max_llm_calls: int = 50  # tope de titulares nuevos por pasada
    # SHA-256 del keystore EAS que firma el APK (Android App Links:
    # https://checkcoast.duckdns.org/b/{id} abre la app si instalada)
    android_cert_sha256: str | None = None
    # URL pública HTTPS (og:image y canonical de las landings /b/{id})
    public_url: str = "https://checkcoast.duckdns.org"


settings = Settings()
