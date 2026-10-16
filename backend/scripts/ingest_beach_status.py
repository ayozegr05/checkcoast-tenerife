"""Entry point CLI: `python -m scripts.ingest_beach_status`.

La lógica vive en `app.ingest_beach_status` — el scheduler de la API la
llama directamente; este shim solo conserva el comando documentado.
"""

from app.ingest_beach_status import main

if __name__ == "__main__":
    main()
