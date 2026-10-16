"""Entry point CLI: `python -m scripts.ingest_news [--backfill AÑO]`.

La lógica vive en `app.ingest_news` — el scheduler de la API la llama
directamente; este shim solo conserva el comando documentado.
"""

from app.ingest_news import main

if __name__ == "__main__":
    main()
