# ==============================================================================
# PRODUCTION DOCKERFILE FOR GCP CLOUD RUN (FastAPI + Gunicorn + Cloud SQL)
# ==============================================================================
FROM python:3.11-slim

WORKDIR /app

# Install runtime dependencies for psycopg2 and health checks
RUN apt-get update && apt-get install -y --no-install-recommends     curl     libpq5     && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application codebase
COPY . .

# Cloud Run dynamic PORT injection
ENV PORT=8080
EXPOSE 8080

# Production ASGI High-Performance Async Server
CMD ["sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --workers 2 --timeout-keep-alive 65"]
