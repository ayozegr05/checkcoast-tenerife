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

EXPOSE 8000

# Migra la BD antes de servir: el contenedor es autosuficiente
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
