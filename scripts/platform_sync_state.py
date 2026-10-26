"""Small helpers shared by the resumable platform backfill jobs (Longshanks, TopDeck.gg).

* `load_sync_state` / `save_sync_state` persist a compact JSON blob in `system_settings`
  (PostgreSQL via `get_setting`/`set_setting`, SQLite via `get_system_setting`/`set_system_setting`)
  so nightly Cloud Run Job runs can resume where the previous run stopped (per-system backfill
  cursors, ids that were fetched but are not importable, last finalize timings).
* `SyncBudget` tracks the wall-clock budget of a run and reserves time for the final
  Elo / Meta Intel refresh (`finalize_platform_sync`) of every touched game system.
"""

import json
import logging
import time
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Unknown systems are assumed to need this long in `finalize_platform_sync` (Elo rebuild + Meta Intel).
DEFAULT_FINALIZE_ESTIMATE_S = 240.0
MAX_SKIP_IDS = 60000


def _is_mock(obj: Any) -> bool:
    return type(obj).__name__ in ("MagicMock", "Mock", "NonCallableMagicMock", "AsyncMock")


def load_sync_state(db: Any, key: str) -> Dict[str, Any]:
    """Returns the persisted JSON state for `key` (empty dict if missing / unsupported / unreadable)."""
    raw: Any = None
    try:
        getter = getattr(db, "get_system_setting", None)
        if getter is not None and not _is_mock(getter):
            raw = getter(key)
        else:
            getter = getattr(db, "get_setting", None)
            if getter is not None and not _is_mock(getter):
                raw = getter(key)
    except Exception as e:
        logger.warning(f"[sync_state] Could not load {key}: {e}")
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (str, bytes)) and raw:
        try:
            val = json.loads(raw)
            return val if isinstance(val, dict) else {}
        except Exception:
            return {}
    return {}


def save_sync_state(db: Any, key: str, state: Dict[str, Any]) -> bool:
    """Persists `state` as JSON under `system_settings[key]`. Never raises."""
    skip = state.get("skip_ids")
    if isinstance(skip, list) and len(skip) > MAX_SKIP_IDS:
        state["skip_ids"] = skip[-MAX_SKIP_IDS:]
    try:
        payload = json.dumps(state, default=str, separators=(",", ":"))
        setter = getattr(db, "set_system_setting", None)
        if setter is not None and not _is_mock(setter):
            setter(key, payload)
            return True
        setter = getattr(db, "set_setting", None)
        if setter is not None and not _is_mock(setter):
            return bool(setter(key, payload))
    except Exception as e:
        logger.warning(f"[sync_state] Could not save {key}: {e}")
    return False


class SyncBudget:
    """Wall-clock budget for a sync run that keeps enough time for finalizing touched systems."""

    def __init__(
        self,
        total_minutes: float,
        finalize_estimates: Optional[Dict[str, float]] = None,
        safety_seconds: float = 120.0,
        reserve_finalize: bool = True,
    ) -> None:
        self.start = time.time()
        self.total_s = max(60.0, float(total_minutes or 50) * 60.0)
        self.deadline = self.start + self.total_s
        self.finalize_estimates = {k: float(v) for k, v in (finalize_estimates or {}).items() if v}
        self.safety_s = safety_seconds
        self.reserve_finalize = reserve_finalize

    def elapsed(self) -> float:
        return time.time() - self.start

    def remaining(self) -> float:
        return self.deadline - time.time()

    def finalize_estimate(self, systems: Iterable[str]) -> float:
        if not self.reserve_finalize:
            return 0.0
        return sum(self.finalize_estimates.get(s, DEFAULT_FINALIZE_ESTIMATE_S) for s in set(systems))

    def can_continue(self, touched_systems: Iterable[str], extra_system: Optional[str] = None, next_cost_s: float = 0.0) -> bool:
        """True if there is time for `next_cost_s` more work plus finalizing touched (+extra) systems."""
        systems = set(touched_systems)
        if extra_system:
            systems.add(extra_system)
        return self.remaining() - self.safety_s - next_cost_s - self.finalize_estimate(systems) > 0


def budgeted_import(
    db: Any,
    targets: List[Tuple[str, str]],
    import_fn: Callable[..., Dict[str, Any]],
    budget: SyncBudget,
    label: str,
    chunk_size: int = 12,
    initial_event_s: float = 4.0,
    import_kwargs: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Imports `targets` ((system, id) pairs) chunk by chunk with `import_fn(db, chunk, **import_kwargs)`
    (HTTP concurrency lives inside the importer; DB writes stay on this thread), stopping when the
    budget no longer covers the next chunk plus finalizing every touched system. Events of a system
    that has not been touched yet are deferred if there is no time left to also finalize that system.
    Stops immediately when the importer reports `blocked`.
    """
    totals: Dict[str, int] = {"events_imported": 0, "participants_imported": 0, "matches_imported": 0, "pods_imported": 0}
    imported: List[str] = []
    skipped: List[str] = []
    failed: List[str] = []
    touched: set = set()
    deferred = 0
    blocked_reason: Optional[str] = None
    avg_event_s = float(initial_event_s)
    attempted = 0
    t0 = time.time()
    queue = list(targets)

    while queue and not blocked_reason:
        chunk: List[Tuple[str, str]] = []
        chunk_systems = set(touched)
        rest: List[Tuple[str, str]] = []
        out_of_time = False
        for pair in queue:
            if out_of_time or len(chunk) >= chunk_size:
                rest.append(pair)
                continue
            extra = pair[0] if pair[0] not in chunk_systems else None
            if budget.can_continue(chunk_systems, extra_system=extra, next_cost_s=avg_event_s * (len(chunk) + 1)):
                chunk.append(pair)
                chunk_systems.add(pair[0])
            elif extra is None:
                rest.append(pair)  # out of time even for already-touched systems
                out_of_time = True
            else:
                deferred += 1  # not enough time left to also finalize another system this run
        queue = rest
        if not chunk:
            break
        res = import_fn(db, chunk, **(import_kwargs or {})) or {}
        attempted += len(chunk)
        avg_event_s = max(0.3, (time.time() - t0) / max(1, attempted))
        for k in totals:
            totals[k] += int(res.get(k) or 0)
        chunk_imported = res.get("imported_event_ids")
        if chunk_imported is None:  # importer without per-id reporting (e.g. patched in tests)
            if int(res.get("events_imported") or 0) > 0:
                touched |= {s for s, _ in chunk}
        else:
            imported += [str(x) for x in chunk_imported]
            sys_by_id = {str(e): s for s, e in chunk}
            touched |= {sys_by_id[str(e)] for e in chunk_imported if str(e) in sys_by_id}
        skipped += [str(x) for x in (res.get("skipped_event_ids") or [])]
        failed += [str(x) for x in (res.get("failed_event_ids") or [])]
        if res.get("blocked"):
            blocked_reason = res.get("blocked_reason") or "blocked"
        logger.info(
            f"📦 [{label}] Progress: {totals['events_imported']} imported / {len(skipped)} skipped / {len(failed)} failed; "
            f"{len(queue)} queued, {deferred} deferred; elapsed {budget.elapsed() / 60:.1f}m, avg {avg_event_s:.1f}s/event"
        )

    return {
        "totals": totals,
        "imported": imported,
        "skipped": skipped,
        "failed": failed,
        "touched": touched,
        "unprocessed": len(queue) + deferred,
        "blocked_reason": blocked_reason,
        "avg_event_s": round(avg_event_s, 2),
    }


def update_resume_state(
    state: Dict[str, Any],
    imported: List[str],
    skipped: List[str],
    failed: List[str],
    max_fails: int = 3,
) -> set:
    """Updates `skip_ids` / `fail_counts` (ids failing `max_fails` runs are skipped for good); returns processed ids."""
    fail_counts: Dict[str, int] = {str(k): int(v) for k, v in (state.get("fail_counts") or {}).items()}
    for e in failed:
        fail_counts[e] = fail_counts.get(e, 0) + 1
    perm_failed = [e for e, n in fail_counts.items() if n >= max_fails]
    for e in list(imported) + list(skipped) + perm_failed:
        fail_counts.pop(e, None)
    state["skip_ids"] = list(dict.fromkeys([str(x) for x in (state.get("skip_ids") or [])] + list(skipped) + perm_failed))
    state["fail_counts"] = fail_counts
    return set(imported) | set(skipped) | set(perm_failed)


def update_finalize_estimates(state: Dict[str, Any], touched: Iterable[str], finalize_res: Dict[str, Any], finalize_elapsed: float) -> None:
    """Stores measured per-system finalize durations (Elo rebuild elapsed + share of Meta Intel prewarm)."""
    touched = list(touched)
    recon = (finalize_res or {}).get("reconstruction") or {}
    fin_s = dict(state.get("finalize_s") or {})
    known_total = 0.0
    for s in touched:
        r = recon.get(s) if isinstance(recon, dict) else None
        if isinstance(r, dict):
            el = r.get("elapsed_seconds")
            if el is None and r.get("elapsed_ms") is not None:
                el = float(r["elapsed_ms"]) / 1000.0
            if el is not None:
                known_total += float(el)
    overhead = max(0.0, finalize_elapsed - known_total) / max(1, len(touched))
    for s in touched:
        r = recon.get(s) if isinstance(recon, dict) else None
        el = None
        if isinstance(r, dict):
            el = r.get("elapsed_seconds")
            if el is None and r.get("elapsed_ms") is not None:
                el = float(r["elapsed_ms"]) / 1000.0
        if el is None:
            el = finalize_elapsed / max(1, len(touched))
            overhead = 0.0
        fin_s[s] = round(float(el) + overhead + 5.0, 1)
    state["finalize_s"] = fin_s
