"""Deployment gate tests for API endpoint & DB call latency logging, index coverage, and timeout protection."""
import ast
import glob
import os
import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from perf_telemetry import PERF_REGISTRY, API_SLOW_THRESHOLD_MS, DB_SLOW_THRESHOLD_MS
from database import PostgresDatabase
from elo import EloEngine
from auth import AuthManager
from leagues_hub_service import LeaguesHubService
from glory_ledger_service import GloryLedgerService
import server


class TestEndpointAndDbLatencyGate(unittest.TestCase):
    """Verifies that all server endpoints and DB methods have latency telemetry and sub-second query optimizations."""

    def test_all_db_and_service_classes_instrumented(self):
        """Every DB/service class must have its public DB methods wrapped with perf_telemetry."""
        classes_to_check = [
            (
                PostgresDatabase,
                {
                    "_ensure_pool",
                    "_normalize_dsn",
                    "_sanitize_dsn",
                    "get_connection",
                    "_remap_registration_id_cursor",
                    "_remap_registration_ids_batch_cursor",
                    "_upsert_match_cursor",
                },
            ),
            (EloEngine, {"get_k_factor", "expected_score", "calculate_expected_score"}),
            (AuthManager, set()),
            (
                LeaguesHubService,
                {
                    "_get_db",
                    "_compute_active_week_info",
                    "_enrich_pods_with_player_elo",
                    "_cross_link_pod_pairings",
                    "_load_league_from_seed_json",
                    "_build_league_hall_of_fame",
                    "_get_league_announcements",
                    "_apply_pod_pairing_mutation",
                    "_get_ops_store_path",
                    "_load_ops_store",
                    "_save_ops_store",
                    "_ensure_unified_ops_tables",
                    "_parse_group_chat_channel_id",
                    "_is_league_ended",
                    "_is_season_ended",
                    "_build_seasonal_group_chat_specs",
                    "_format_group_chat_for_request_list",
                },
            ),
            (
                GloryLedgerService,
                {
                    "_get_db",
                    "_bootstrap_wallet_row_locked",
                    "_append_ledger_entry_locked",
                    "_empty_wallet_dict",
                    "_format_wallet_response",
                    "_memory_sync_earned",
                    "_memory_execute_tx",
                    "_memory_audit_user",
                },
            ),
        ]

        total_instrumented = 0
        for cls, excluded in classes_to_check:
            instrumented_count = 0
            for attr_name, attr_val in cls.__dict__.items():
                if attr_name.startswith("__") or attr_name in excluded:
                    continue
                if isinstance(attr_val, (staticmethod, classmethod, property)):
                    continue
                if callable(attr_val):
                    self.assertTrue(
                        getattr(attr_val, "_is_perf_wrapped", False),
                        f"{cls.__name__}.{attr_name} is missing perf_telemetry wrapper (_is_perf_wrapped)",
                    )
                    instrumented_count += 1
            self.assertGreater(
                instrumented_count,
                3,
                f"{cls.__name__} had unexpectedly few instrumented methods ({instrumented_count})",
            )
            total_instrumented += instrumented_count

        self.assertGreaterEqual(
            total_instrumented,
            190,
            f"Expected at least 190 instrumented DB/service methods, found {total_instrumented}",
        )
        self.assertGreaterEqual(len(PERF_REGISTRY.registered_db_methods), 190)

    def test_server_middleware_logs_all_api_endpoints_and_exposes_telemetry(self):
        """Verify server.py logs [API_CALL] / [API_SLOW] for all HTTP routes and exposes /api/system/perf-telemetry."""
        server_src = (ROOT_DIR / "server.py").read_text(encoding="utf-8")
        self.assertIn("record_api_call(", server_src)
        self.assertIn("/api/system/perf-telemetry", server_src)

        perf_src = (ROOT_DIR / "perf_telemetry.py").read_text(encoding="utf-8")
        self.assertIn("[API_CALL]", perf_src)
        self.assertIn("[API_SLOW]", perf_src)
        self.assertIn("[DB_CALL]", perf_src)
        self.assertIn("[DB_SLOW]", perf_src)
        self.assertLessEqual(API_SLOW_THRESHOLD_MS, 1000.0)
        self.assertLessEqual(DB_SLOW_THRESHOLD_MS, 500.0)

        # Enumerate all route decorators across server.py and routers/*.py
        route_files = [ROOT_DIR / "server.py"] + sorted((ROOT_DIR / "routers").glob("*.py"))
        discovered_routes = []
        for rf in route_files:
            tree = ast.parse(rf.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    for dec in node.decorator_list:
                        if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute):
                            if dec.func.attr in ("get", "post", "put", "delete", "patch", "api_route"):
                                if dec.args and isinstance(dec.args[0], ast.Constant):
                                    discovered_routes.append((dec.func.attr.upper(), dec.args[0].value, rf.name))

        route_paths = {p for _, p, _ in discovered_routes}
        self.assertIn("/api/system/perf-telemetry", route_paths)
        self.assertIn("/api/leagues/list", route_paths)
        self.assertIn("/api/leagues/{league_id}/seasons", route_paths)
        self.assertGreaterEqual(len(discovered_routes), 340)

    def test_critical_perf_indexes_and_no_unindexed_casts(self):
        """Verify database.py defines v27 performance indexes and elo.py avoids ep.id::text sequential scans."""
        db_src = (ROOT_DIR / "database.py").read_text(encoding="utf-8")
        required_indexes = [
            "idx_tracker_games_updated_at",
            "idx_pg_ratings_player_name_btree",
            "idx_pg_ratings_player_name_lower",
            "idx_pg_ratings_team_lower_all",
            "idx_pg_matches_p1_fac_lower_date",
            "idx_pg_matches_p2_fac_lower_date",
        ]
        for idx_name in required_indexes:
            self.assertIn(idx_name, db_src, f"Missing critical performance index {idx_name} in database.py")

        elo_src = (ROOT_DIR / "elo.py").read_text(encoding="utf-8")
        self.assertNotIn(
            "ep.id::text = %s",
            elo_src,
            "elo.py must not cast ep.id::text in WHERE clause (causes full sequential scan on event_participants)",
        )

    def test_perf_registry_records_api_and_db_metrics(self):
        """Verify PERF_REGISTRY records API and DB call durations and computes p95/max telemetry."""
        PERF_REGISTRY.record_api_call("GET", "/api/health", "/api/health", "", 200, 1.25, [])
        PERF_REGISTRY.record_db_call("PostgresDatabase.get_summary_stats", 4.50, status="OK", log_call=False)
        snap = PERF_REGISTRY.snapshot()
        self.assertIn("api_metrics", snap)
        self.assertIn("db_metrics", snap)
        api_names = {m["name"] for m in snap["api_metrics"]}
        db_names = {m["name"] for m in snap["db_metrics"]}
        self.assertIn("GET /api/health", api_names)
        self.assertIn("PostgresDatabase.get_summary_stats", db_names)


if __name__ == "__main__":
    unittest.main()
