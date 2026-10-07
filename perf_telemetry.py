"""Production Performance Telemetry & Structured Latency Logging for OmniTactica.

Tracks and logs:
1. Every Server API Call ([API_CALL] / [API_SLOW] / [API_ERROR]) with total latency,
   HTTP status, DB call count, total DB time, and per-call DB breakdown.
2. Every Database Call ([DB_CALL] / [DB_SLOW] / [DB_ERROR]) across PostgresDatabase,
   AuthManager, EloEngine, LeaguesHubService, GloryLedgerService, and direct
   PostgresConnectionContext SQL blocks.
3. Rolling in-memory latency statistics (count, avg_ms, p95_ms, max_ms, slow_count,
   error_count, last_ms) accessible via /api/system/perf-telemetry.
"""

from collections import deque
import contextvars
import functools
import inspect
import logging
import sys
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

perf_logger = logging.getLogger("EloAPI.Perf")

# Thresholds in milliseconds
API_SLOW_THRESHOLD_MS = 1000.0  # >1s is unacceptable for any server endpoint
DB_SLOW_THRESHOLD_MS = 500.0    # >500ms for a single DB call is flagged as slow

# ContextVars for per-request DB call tracing (shared across asyncio.to_thread)
_request_db_calls: contextvars.ContextVar[Optional[List[Tuple[str, float, str]]]] = (
    contextvars.ContextVar("_request_db_calls", default=None)
)
_active_db_method_depth: threading.local = threading.local()


def _get_depth() -> int:
    return getattr(_active_db_method_depth, "depth", 0)


def _inc_depth() -> None:
    _active_db_method_depth.depth = _get_depth() + 1


def _dec_depth() -> None:
    _active_db_method_depth.depth = max(0, _get_depth() - 1)


class _MetricBucket:
    """Thread-safe rolling latency metric bucket."""

    __slots__ = (
        "name",
        "count",
        "error_count",
        "slow_count",
        "total_ms",
        "min_ms",
        "max_ms",
        "last_ms",
        "last_status",
        "last_called_at",
        "samples",
    )

    def __init__(self, name: str, maxlen: int = 200):
        self.name = name
        self.count = 0
        self.error_count = 0
        self.slow_count = 0
        self.total_ms = 0.0
        self.min_ms = float("inf")
        self.max_ms = 0.0
        self.last_ms = 0.0
        self.last_status = "OK"
        self.last_called_at = 0.0
        self.samples: deque = deque(maxlen=maxlen)

    def record(self, duration_ms: float, status: str, is_slow: bool) -> None:
        self.count += 1
        if status != "OK" and not str(status).startswith("2") and not str(status).startswith("3"):
            self.error_count += 1
        if is_slow:
            self.slow_count += 1
        self.total_ms += duration_ms
        if duration_ms < self.min_ms:
            self.min_ms = duration_ms
        if duration_ms > self.max_ms:
            self.max_ms = duration_ms
        self.last_ms = duration_ms
        self.last_status = str(status)
        self.last_called_at = time.time()
        self.samples.append(duration_ms)

    def to_dict(self) -> Dict[str, Any]:
        samples_list = sorted(self.samples)
        n = len(samples_list)
        p50 = samples_list[int(n * 0.50)] if n else 0.0
        p95 = samples_list[min(n - 1, int(n * 0.95))] if n else 0.0
        p99 = samples_list[min(n - 1, int(n * 0.99))] if n else 0.0
        return {
            "name": self.name,
            "count": self.count,
            "error_count": self.error_count,
            "slow_count": self.slow_count,
            "avg_ms": round(self.total_ms / self.count, 2) if self.count else 0.0,
            "min_ms": round(self.min_ms, 2) if self.count else 0.0,
            "p50_ms": round(p50, 2),
            "p95_ms": round(p95, 2),
            "p99_ms": round(p99, 2),
            "max_ms": round(self.max_ms, 2),
            "last_ms": round(self.last_ms, 2),
            "last_status": self.last_status,
            "last_called_at": self.last_called_at,
        }


class PerfTelemetryRegistry:
    """Central registry for API endpoint and DB call latency telemetry."""

    def __init__(self):
        self._lock = threading.Lock()
        self.api_metrics: Dict[str, _MetricBucket] = {}
        self.db_metrics: Dict[str, _MetricBucket] = {}
        self.recent_slow_api: deque = deque(maxlen=100)
        self.recent_slow_db: deque = deque(maxlen=100)
        self.registered_endpoints: List[Dict[str, Any]] = []
        self.registered_db_methods: List[str] = []

    def record_db_call(
        self,
        qualified_name: str,
        duration_ms: float,
        status: str = "OK",
        extra: str = "",
        log_call: bool = True,
    ) -> None:
        is_slow = duration_ms >= DB_SLOW_THRESHOLD_MS
        with self._lock:
            bucket = self.db_metrics.get(qualified_name)
            if bucket is None:
                bucket = _MetricBucket(qualified_name)
                self.db_metrics[qualified_name] = bucket
            bucket.record(duration_ms, status, is_slow)
            if is_slow or status != "OK":
                self.recent_slow_db.append({
                    "fn": qualified_name,
                    "duration_ms": round(duration_ms, 2),
                    "status": status,
                    "extra": extra,
                    "ts": time.time(),
                })

        # Attach to current HTTP request context if present
        req_calls = _request_db_calls.get()
        if req_calls is not None:
            req_calls.append((qualified_name, round(duration_ms, 2), status))

        if log_call:
            tag = "[DB_SLOW]" if is_slow else ("[DB_ERROR]" if status != "OK" else "[DB_CALL]")
            msg = f"{tag} fn={qualified_name} duration_ms={duration_ms:.2f} status={status}"
            if extra:
                msg += f" {extra}"
            if status != "OK":
                perf_logger.error(msg)
            elif is_slow:
                perf_logger.warning(msg)
            else:
                perf_logger.info(msg)

    def record_api_call(
        self,
        method: str,
        route_path: str,
        raw_path: str,
        query_str: str,
        status_code: int,
        duration_ms: float,
        db_calls: List[Tuple[str, float, str]],
    ) -> None:
        key = f"{method.upper()} {route_path}"
        is_slow = duration_ms >= API_SLOW_THRESHOLD_MS
        db_count = len(db_calls)
        db_total_ms = sum(c[1] for c in db_calls)

        with self._lock:
            bucket = self.api_metrics.get(key)
            if bucket is None:
                bucket = _MetricBucket(key)
                self.api_metrics[key] = bucket
            bucket.record(duration_ms, str(status_code), is_slow)
            if is_slow or status_code >= 500:
                self.recent_slow_api.append({
                    "endpoint": key,
                    "path": raw_path + (f"?{query_str}" if query_str else ""),
                    "status": status_code,
                    "duration_ms": round(duration_ms, 2),
                    "db_calls": db_count,
                    "db_ms": round(db_total_ms, 2),
                    "breakdown": [
                        {"fn": fn, "ms": ms, "status": st}
                        for fn, ms, st in db_calls[:15]
                    ],
                    "ts": time.time(),
                })

        # Format compact breakdown for logs
        breakdown_str = ",".join(f"{fn}:{ms:.1f}ms" for fn, ms, _ in db_calls[:10])
        if len(db_calls) > 10:
            breakdown_str += f",+{len(db_calls) - 10}_more"

        full_url = raw_path + (f"?{query_str}" if query_str else "")
        tag = "[API_SLOW]" if is_slow else ("[API_ERROR]" if status_code >= 500 else "[API_CALL]")
        log_msg = (
            f"{tag} {method.upper()} {full_url} route={route_path} "
            f"status={status_code} duration_ms={duration_ms:.2f} "
            f"db_calls={db_count} db_ms={db_total_ms:.2f}"
        )
        if breakdown_str:
            log_msg += f" db_breakdown=[{breakdown_str}]"

        if status_code >= 500:
            perf_logger.error(log_msg)
        elif is_slow:
            perf_logger.warning(log_msg)
        else:
            perf_logger.info(log_msg)

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            api_list = sorted(
                (b.to_dict() for b in self.api_metrics.values()),
                key=lambda x: x["max_ms"],
                reverse=True,
            )
            db_list = sorted(
                (b.to_dict() for b in self.db_metrics.values()),
                key=lambda x: x["max_ms"],
                reverse=True,
            )
            return {
                "thresholds": {
                    "api_slow_threshold_ms": API_SLOW_THRESHOLD_MS,
                    "db_slow_threshold_ms": DB_SLOW_THRESHOLD_MS,
                },
                "registered_endpoints_count": len(self.registered_endpoints),
                "registered_db_methods_count": len(self.registered_db_methods),
                "observed_api_endpoints_count": len(api_list),
                "observed_db_methods_count": len(db_list),
                "api_metrics": api_list,
                "db_metrics": db_list,
                "recent_slow_api": list(self.recent_slow_api),
                "recent_slow_db": list(self.recent_slow_db),
            }


PERF_REGISTRY = PerfTelemetryRegistry()


def start_request_db_trace() -> Tuple[contextvars.Token, List[Tuple[str, float, str]]]:
    trace_list: List[Tuple[str, float, str]] = []
    token = _request_db_calls.set(trace_list)
    return token, trace_list


def end_request_db_trace(token: contextvars.Token) -> None:
    try:
        _request_db_calls.reset(token)
    except Exception:
        pass


def wrap_db_method(qualified_name: str, fn: Callable, log_call: bool = True) -> Callable:
    """Wraps a synchronous or asynchronous DB method with latency logging & telemetry."""
    if getattr(fn, "_is_perf_wrapped", False):
        return fn

    if inspect.iscoroutinefunction(fn):
        @functools.wraps(fn)
        async def _async_wrapper(*args, **kwargs):
            t0 = time.perf_counter()
            status = "OK"
            _inc_depth()
            try:
                return await fn(*args, **kwargs)
            except Exception as exc:
                status = f"ERR:{type(exc).__name__}"
                raise
            finally:
                _dec_depth()
                dt_ms = (time.perf_counter() - t0) * 1000.0
                PERF_REGISTRY.record_db_call(qualified_name, dt_ms, status=status, log_call=log_call)

        _async_wrapper._is_perf_wrapped = True
        return _async_wrapper
    else:
        @functools.wraps(fn)
        def _sync_wrapper(*args, **kwargs):
            t0 = time.perf_counter()
            status = "OK"
            _inc_depth()
            try:
                return fn(*args, **kwargs)
            except Exception as exc:
                status = f"ERR:{type(exc).__name__}"
                raise
            finally:
                _dec_depth()
                dt_ms = (time.perf_counter() - t0) * 1000.0
                PERF_REGISTRY.record_db_call(qualified_name, dt_ms, status=status, log_call=log_call)

        _sync_wrapper._is_perf_wrapped = True
        return _sync_wrapper


def instrument_class_methods(
    cls: type,
    class_label: Optional[str] = None,
    exclude_methods: Optional[set] = None,
    quiet_methods: Optional[set] = None,
) -> List[str]:
    """Instruments all methods on a class with DB latency logging and telemetry."""
    label = class_label or cls.__name__
    excluded = set(exclude_methods or set()) | {
        "__init__",
        "__new__",
        "__repr__",
        "__str__",
        "__enter__",
        "__exit__",
        "__eq__",
        "__hash__",
    }
    quiet = set(quiet_methods or set())
    wrapped_names: List[str] = []

    for attr_name, attr_val in list(cls.__dict__.items()):
        if attr_name in excluded or attr_name.startswith("__"):
            continue
        if isinstance(attr_val, property):
            continue
        if callable(attr_val):
            qname = f"{label}.{attr_name}"
            should_log = attr_name not in quiet
            wrapped = wrap_db_method(qname, attr_val, log_call=should_log)
            setattr(cls, attr_name, wrapped)
            wrapped_names.append(qname)
            if qname not in PERF_REGISTRY.registered_db_methods:
                PERF_REGISTRY.registered_db_methods.append(qname)

    return wrapped_names


def resolve_direct_sql_caller() -> str:
    """Identifies the caller function when `with db.get_connection() as conn:` is used outside a wrapped DB method."""
    try:
        frame = sys._getframe(2)
        while frame is not None:
            code_name = frame.f_code.co_name
            mod_name = frame.f_globals.get("__name__", "unknown")
            if code_name not in ("get_connection", "__enter__", "_sync_wrapper", "_async_wrapper"):
                return f"SQLConn:{mod_name}.{code_name}"
            frame = frame.f_back
    except Exception:
        pass
    return "SQLConn:direct"
