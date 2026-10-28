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
from typing import Any, Dict, List, Optional, Tuple


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
    execute_args: str = "",
    memory: str = "",
    cpu: str = "",
    no_execute: bool = False,
    task_timeout: str = "30m",
    max_retries: Optional[int] = None,
) -> int:
    resource_flags = []
    if memory:
        resource_flags.append(f"--memory={memory}")
    if cpu:
        resource_flags.append(f"--cpu={cpu}")
    if max_retries is not None:
        resource_flags.append(f"--max-retries={int(max_retries)}")
    exec_cmd = ["gcloud", "run", "jobs", "execute", job_name, f"--region={region}", "--async"]
    if execute_args and str(execute_args).strip():
        exec_cmd.append(f"--args={execute_args.strip()}")

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
                f"--task-timeout={task_timeout}",
                *resource_flags,
            ],
            check=False,
        )
        sys.stdout.write(upd.stdout or "")
        sys.stderr.write(upd.stderr or "")
        if upd.returncode == 0 and not no_execute:
            print(f"🚀 Triggering async execution for updated job '{job_name}'...", flush=True)
            _run_cmd(exec_cmd, check=False)
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
        f"--task-timeout={task_timeout}",
        *resource_flags,
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
    if cr.returncode == 0 and not no_execute:
        print(f"🚀 Triggering initial async execution for newly created job '{job_name}'...", flush=True)
        _run_cmd(exec_cmd, check=False)
    return cr.returncode


def ensure_scheduler_job(
    job_name: str,
    region: str = "us-central1",
    project_id: str = "eloranking-506820",
    schedule: str = "15 0 * * *",
    scheduler_name: str = "",
    description: str = "",
    template_scheduler: str = "elo-scraper-job",
    fallback_sa: str = "",
) -> None:
    """
    Idempotently creates or updates a Cloud Scheduler HTTP job that triggers
    `https://{region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/{project_id}/jobs/{job_name}:run`
    using the same OAuth Service Account and timeZone as `elo-scraper-job`.
    Non-fatal if Cloud Build service account lacks `cloudscheduler.jobs.create`.
    """
    sched_name = scheduler_name or job_name.replace("-sync-job", "-scheduler-job")
    target_uri = f"https://{region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/{project_id}/jobs/{job_name}:run"
    time_zone = "America/Los_Angeles"
    oauth_sa = fallback_sa

    # Inspect template scheduler job (`elo-scraper-job`) to inherit exact OAuth Service Account & timezone
    tmpl_desc = _run_cmd(
        ["gcloud", "scheduler", "jobs", "describe", template_scheduler, f"--location={region}", "--format=json"],
        check=False,
    )
    if tmpl_desc.returncode == 0 and tmpl_desc.stdout:
        try:
            tjson = json.loads(tmpl_desc.stdout)
            tz = str(tjson.get("timeZone") or "").strip()
            if tz:
                time_zone = tz
            sa_email = str(
                ((tjson.get("httpTarget") or {}).get("oauthToken") or {}).get("serviceAccountEmail") or ""
            ).strip()
            if sa_email:
                oauth_sa = sa_email
        except Exception as err:
            print(f"⚠️ Notice parsing template scheduler '{template_scheduler}': {err}", flush=True)

    if not oauth_sa:
        # Fallback: inspect the Cloud Run Job itself for its service account
        jdesc = _run_cmd(
            ["gcloud", "run", "jobs", "describe", job_name, f"--region={region}", "--format=json"],
            check=False,
        )
        if jdesc.returncode == 0 and jdesc.stdout:
            try:
                _, sa_from_job, _, _ = _extract_template_config(json.loads(jdesc.stdout))
                if sa_from_job:
                    oauth_sa = sa_from_job
            except Exception:
                pass

    # Check if the scheduler job already exists
    existing = _run_cmd(
        ["gcloud", "scheduler", "jobs", "describe", sched_name, f"--location={region}", "--format=json"],
        check=False,
    )
    desc_text = description or f"Daily automated sync & Elo recalculation via Cloud Run Job ({job_name})"

    if existing.returncode == 0:
        print(f"🔄 Cloud Scheduler job '{sched_name}' exists; updating schedule & target URI...", flush=True)
        upd_cmd = [
            "gcloud",
            "scheduler",
            "jobs",
            "update",
            "http",
            sched_name,
            f"--location={region}",
            f"--schedule={schedule}",
            f"--time-zone={time_zone}",
            f"--uri={target_uri}",
            "--http-method=POST",
            f"--description={desc_text}",
        ]
        if oauth_sa:
            upd_cmd.append(f"--oauth-service-account-email={oauth_sa}")
        res = _run_cmd(upd_cmd, check=False)
        if res.returncode != 0:
            print(f"⚠️ Notice updating Cloud Scheduler job '{sched_name}' (non-fatal): {res.stderr}", flush=True)
        return

    print(f"🆕 Creating Cloud Scheduler job '{sched_name}' ({schedule} {time_zone}) -> {job_name}...", flush=True)
    create_sched_cmd = [
        "gcloud",
        "scheduler",
        "jobs",
        "create",
        "http",
        sched_name,
        f"--location={region}",
        f"--schedule={schedule}",
        f"--time-zone={time_zone}",
        f"--uri={target_uri}",
        "--http-method=POST",
        f"--description={desc_text}",
    ]
    if oauth_sa:
        create_sched_cmd.append(f"--oauth-service-account-email={oauth_sa}")
    res = _run_cmd(create_sched_cmd, check=False)
    if res.returncode == 0:
        print(f"✅ Successfully created Cloud Scheduler job '{sched_name}'.", flush=True)
    else:
        print(f"⚠️ Notice creating Cloud Scheduler job '{sched_name}' (non-fatal): {res.stderr}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update a standalone platform sync Cloud Run Job and its Cloud Scheduler trigger.")
    parser.add_argument("--job-name", required=True, help="Cloud Run Job name (e.g. elo-melee-sync-job)")
    parser.add_argument("--image", required=True, help="Container image URI")
    parser.add_argument("--region", default="us-central1", help="GCP region (default: us-central1)")
    parser.add_argument("--command", default="python3", help="Container command entrypoint (default: python3)")
    parser.add_argument("--args", dest="script_arg", required=True, help="Script path / args (e.g. scripts/sync_melee.py)")
    parser.add_argument("--execute-args", default="", help="Optional comma-separated args override for immediate execution (e.g. for 10yr backfill)")
    parser.add_argument("--template-job", default="elo-tournament-sync-job", help="Reference job to inherit Cloud SQL & env vars from on initial create")
    parser.add_argument("--schedule", default="", help="Cron schedule in America/Los_Angeles (e.g. '15 0 * * *')")
    parser.add_argument("--scheduler-name", default="", help="Cloud Scheduler job name (e.g. elo-melee-scheduler-job)")
    parser.add_argument("--description", default="", help="Cloud Scheduler job description")
    parser.add_argument("--memory", default="", help="Optional job memory limit (e.g. 2Gi)")
    parser.add_argument("--cpu", default="", help="Optional job CPU count (e.g. 2)")
    parser.add_argument("--task-timeout", default="30m", help="Job task timeout (default 30m)")
    parser.add_argument("--max-retries", type=int, default=None, help="Optional max retries per task")
    parser.add_argument("--no-execute", action="store_true", help="Create/update only; do not trigger an execution")
    args = parser.parse_args()

    rc = deploy_or_update_job(
        job_name=args.job_name,
        image=args.image,
        region=args.region,
        command=args.command,
        script_arg=args.script_arg,
        template_job=args.template_job,
        execute_args=args.execute_args,
        memory=args.memory,
        cpu=args.cpu,
        no_execute=args.no_execute,
        task_timeout=args.task_timeout,
        max_retries=args.max_retries,
    )
    if rc == 0 and args.schedule:
        ensure_scheduler_job(
            job_name=args.job_name,
            region=args.region,
            schedule=args.schedule,
            scheduler_name=args.scheduler_name,
            description=args.description,
        )
    sys.exit(rc)


if __name__ == "__main__":
    main()
