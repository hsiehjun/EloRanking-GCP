# ==============================================================================
# PRODUCTION DOCKERFILE FOR GCP CLOUD RUN (FastAPI + Gunicorn + Cloud SQL)
# ==============================================================================
FROM python:3.11-slim

WORKDIR /app

# Install runtime dependencies for psycopg2, health checks, and headless Chromium CDP (Melee.gg live sync)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libpq5 \
    nodejs \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements + offline ML trainer wheels (never imported by web Gunicorn workers)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir "numpy>=1.26.0" "scikit-learn>=1.4.0"

# Copy application codebase
COPY . .

# Run pre-deployment latency instrumentation, index, and ML predictor gate tests
RUN python3 -m unittest tests/test_endpoint_and_db_latency_gate.py tests/test_app_performance_and_query_indexes.py tests/test_ml_match_predictor.py

# Cloud Run dynamic PORT injection
ENV PORT=8080
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3     CMD curl -f http://localhost:${PORT}/health || exit 1

# Production Gunicorn Async Uvicorn Worker Process
CMD ["sh", "-c", "gunicorn -c gunicorn.conf.py server:app"]
