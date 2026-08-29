# ==============================================================================
# GUNICORN PRODUCTION CONFIGURATION - MULTI-WORKER ASYNC UVICORN ENGINE
# ==============================================================================
import multiprocessing
import os

# Server Socket
port = os.environ.get("PORT", "8080")
bind = os.environ.get("GUNICORN_BIND", f"0.0.0.0:{port}")
backlog = 2048

# Worker Processes: (2 * cores) + 1 capped for memory efficiency
cores = multiprocessing.cpu_count()
workers = int(os.environ.get("GUNICORN_WORKERS", min(max(2 * cores + 1, 4), 8)))
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000
timeout = 60
keepalive = 5

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
