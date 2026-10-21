#!/usr/bin/env python3
"""
Cloud Build Helper: Idempotently creates or updates a standalone Cloud Run Job
(`elo-melee-sync-job`, `elo-limitless-sync-job`, `elo-longshanks-sync-job`, `elo-topdeck-sync-job`).

- If the target Cloud Run Job already exists in GCP, updates its container image,
  entrypoint command (`python3`), and script argument (`scripts/sync_<platform>.py`).
- If the target Cloud Run Job does not exist yet in GCP, inspects `elo-tournament-sync-job`
  to automatically inherit its Cloud SQL connection (`run.googleapis.com/cloudsql-instances`),
  Service Account, and environment variables / Secret Manager references (`DATABASE_URL`, etc.),
  and creates the job ready to execute immediately.
"""

import argparse
import json
import subprocess
import sys
from typing import Any, Dict, List, Tuple


def _run_cmd(cmd: List[str], check: bool = True) -> subprocess.CompletedProcess:
    print(f"+ {' '.join(cmd)}", flush=True)
    return subprocess.run(cmd, check=check, text=True, capture_output=True)


def _extract_template_config(ref_job_json: Dict[str, Any]) -> Tuple[str, str, List[str], List[str]]:
    """
    Extracts (cloudsql_instances, service_account, env_pairs, secret_pairs)
    from `gcloud run jobs describe <template_job> --format=json`.
    """
    spec_tmpl = (
        ((ref_job_json.get("spec") or {}).get("template") or {})
    )
    meta_ann = (spec_tmpl.get("metadata") or {}).get("annotations") or {}
    cloudsql = str(meta_ann.get("run.googleapis.com/cloudsql-instances") or "").strip()

    task_spec = ((spec_tmpl.get("spec") or {}).get("template") or {}).get("spec") or {}
    service_account = str(task_spec.get("serviceAccountName") or "").strip()

    containers = task_spec.get("containers") or []
    c0 = containers[0] if containers else {}
    env_list = c0.get("env") or []

    env_pairs: List[str] = []
    secret_pairs: List[str] = []
    for e in env_list:
        name = str(e.get("name") or "").strip()
        if not name:
            continue
        if "value" in e and e["value"] is not None:
            env_pairs.append(f"{name}={e['value']}")
        elif "valueFrom" in e and isinstance(e["valueFrom"], dict):
            sref = e["valueFrom"].get("secretKeyRef") or {}
            sname = sref.get("name")
            skey = sref.get("key") or "latest"
            if sname:
                secret_pairs.append(f"{name}={sname}:{skey}")

    return cloudsql, service_account, env_pairs, secret_pairs


def deploy_or_update_job(
    job_name: str,
    image: str,
    region: str,
    command: str,
    script_arg: str,
    template_job: str = "elo-tournament-sync-job",
) -> int:
    # 1. Check if the job already exists
    desc = _run_cmd(
        ["gcloud", "run", "jobs", "describe", job_name, f"--region={region}", "--format=json"],
        check=False,
    )
    if desc.returncode == 0:
        print(f"🔄 Cloud Run Job '{job_name}' exists; updating image & entrypoint...", flush=True)
        upd = _run_cmd(
            [
                "gcloud",
                "run",
                "jobs",
                "update",
                job_name,
                f"--image={image}",
                f"--region={region}",
                f"--command={command}",
                f"--args={script_arg}",
            ],
            check=False,
        )
        sys.stdout.write(upd.stdout or "")
        sys.stderr.write(upd.stderr or "")
        return upd.returncode

    print(
        f"🆕 Cloud Run Job '{job_name}' does not exist yet; inspecting '{template_job}' to inherit Cloud SQL & DB config...",
        flush=True,
    )
    create_cmd = [
        "gcloud",
        "run",
        "jobs",
        "create",
        job_name,
        f"--image={image}",
        f"--region={region}",
        f"--command={command}",
        f"--args={script_arg}",
        "--tasks=1",
        "--max-retries=1",
        "--task-timeout=30m",
    ]

    ref_desc = _run_cmd(
        ["gcloud", "run", "jobs", "describe", template_job, f"--region={region}", "--format=json"],
        check=False,
    )
    if ref_desc.returncode == 0 and ref_desc.stdout:
        try:
            ref_json = json.loads(ref_desc.stdout)
            cloudsql, sa, env_pairs, secret_pairs = _extract_template_config(ref_json)
            if cloudsql:
                create_cmd.append(f"--set-cloudsql-instances={cloudsql}")
            if sa:
                create_cmd.append(f"--service-account={sa}")
            if env_pairs:
                # Use ^##^ delimiter in case DATABASE_URL contains commas or special characters
                create_cmd.append("--set-env-vars=^##^" + "##".join(env_pairs))
            if secret_pairs:
                create_cmd.append("--set-secrets=" + ",".join(secret_pairs))
        except Exception as err:
            print(f"⚠️ Warning parsing template job '{template_job}' JSON: {err}", flush=True)

    cr = _run_cmd(create_cmd, check=False)
    sys.stdout.write(cr.stdout or "")
    sys.stderr.write(cr.stderr or "")
    return cr.returncode


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update a standalone platform sync Cloud Run Job.")
    parser.add_argument("--job-name", required=True, help="Cloud Run Job name (e.g. elo-melee-sync-job)")
    parser.add_argument("--image", required=True, help="Container image URI")
    parser.add_argument("--region", default="us-central1", help="GCP region (default: us-central1)")
    parser.add_argument("--command", default="python3", help="Container command entrypoint (default: python3)")
    parser.add_argument("--args", dest="script_arg", required=True, help="Script path / args (e.g. scripts/sync_melee.py)")
    parser.add_argument("--template-job", default="elo-tournament-sync-job", help="Reference job to inherit Cloud SQL & env vars from on initial create")
    args = parser.parse_args()

    rc = deploy_or_update_job(
        job_name=args.job_name,
        image=args.image,
        region=args.region,
        command=args.command,
        script_arg=args.script_arg,
        template_job=args.template_job,
    )
    sys.exit(rc)


if __name__ == "__main__":
    main()
