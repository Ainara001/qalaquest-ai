FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Optional: bake the embedding model into the image (hosts without a persistent volume, e.g. Render)
ARG PRELOAD_EMBEDDING_MODEL=
ARG EMBEDDING_CACHE_DIR=/models
RUN if [ -n "$PRELOAD_EMBEDDING_MODEL" ]; then \
      python -c "import sys; from fastembed import TextEmbedding; TextEmbedding(model_name=sys.argv[1], cache_dir=sys.argv[2])" "$PRELOAD_EMBEDDING_MODEL" "$EMBEDDING_CACHE_DIR"; \
    fi

EXPOSE 8000

# Apply migrations, then start the API (PORT is set by hosts such as Render)
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
