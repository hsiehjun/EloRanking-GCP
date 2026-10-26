"""Persists Cloud Run Job run summaries into `system_settings` so the web app can report job status.

Cloud Run Job logs are only visible with gcloud credentials; writing a compact summary row
(`job_run_<name>`) lets `/api/admin/job-status` show what each sync / rebuild job did.
"""

import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Dict, Optional

_JOB_STARTED_AT: Dict[str, float] = {}


def _get_db():
    from database import get_database
    return get_database()


def record_job_run(job_key: str, payload: Dict[str, Any], db: Any = None) -> None:
    """Upserts `system_settings[job_run_<job_key>]` with status, timings, args, and result payload."""
    started = _JOB_STARTED_AT.get(job_key)
    now = time.time()
    row = {
        "job": job_key,
        "execution": os.environ.get("CLOUD_RUN_EXECUTION"),
        "task_index": os.environ.get("CLOUD_RUN_TASK_INDEX"),
        "args": sys.argv[1:],
        "started_at": datetime.fromtimestamp(started, tz=timezone.utc).isoformat() if started else None,
        "finished_at": datetime.fromtimestamp(now, tz=timezone.utc).isoformat(),
        "elapsed_seconds": round(now - started, 1) if started else None,
        **payload,
    }
    try:
        target_db = db or _get_db()
        if not hasattr(target_db, "get_connection"):
            return
        with target_db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
                    """,
                    (f"job_run_{job_key}", json.dumps(row, default=str)[:200000]),
                )
            conn.commit()
    except Exception as err:  # Never fail the job because status reporting failed.
        print(f"[job_status] Notice recording job run for {job_key}: {err}", file=sys.stderr)


def install_job_recorder(job_key: str) -> None:
    """Marks the job start (status RUNNING) and records FAILED with a traceback on uncaught exceptions."""
    _JOB_STARTED_AT[job_key] = time.time()
    record_job_run(job_key, {"status": "RUNNING"})
    prev_hook = sys.excepthook

    def _hook(exc_type, exc, tb):
        record_job_run(job_key, {
            "status": "FAILED",
            "error": f"{exc_type.__name__}: {exc}",
            "traceback": "".join(traceback.format_exception(exc_type, exc, tb))[-6000:],
        })
        prev_hook(exc_type, exc, tb)

    sys.excepthook = _hook
