# ==============================================================================
# GUNICORN PRODUCTION CONFIGURATION - MULTI-WORKER ASYNC UVICORN ENGINE
# ==============================================================================
import os

# Server Socket
port = os.environ.get("PORT", "8080")
bind = f"0.0.0.0:{port}"
backlog = 2048

# Worker Processes: 2 async Uvicorn workers for Cloud Run concurrency
workers = int(os.environ.get("GUNICORN_WORKERS", "2"))
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000
timeout = 0
graceful_timeout = 30
keepalive = 65

# Process Naming & Lifecycle
proc_name = "elo_ranking_fastapi"
preload_app = False
max_requests = 5000
max_requests_jitter = 500

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" (%(L)ss)'
