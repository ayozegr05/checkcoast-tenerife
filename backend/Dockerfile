FROM python:3.12-slim

WORKDIR /app

# DejaVu: fuentes para componer la og:image (nombre + estado sobre la
# foto satélite) con Pillow
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root: el proceso solo lee código y conecta a Postgres (el
# og:image se compone en memoria — nada escribe en /app)
ENV PYTHONDONTWRITEBYTECODE=1
RUN useradd --system --uid 10001 --no-create-home appuser
USER appuser

EXPOSE 8000

# Migra la BD antes de servir: el contenedor es autosuficiente
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
