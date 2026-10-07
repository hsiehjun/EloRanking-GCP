import unittest
from unittest.mock import MagicMock
import inspect
from database import PostgresDatabase
import routers.eventstudio as eventstudio_router
import routers.leaderboard as leaderboard_router
import routers.community as community_router
import leagues_hub_service


class TestAppPerformanceAndQueryIndexes(unittest.TestCase):
    """Regression tests ensuring hot database queries use indexes, avoid full table scans, and never query non-existent columns."""

    def test_no_invalid_total_matches_column_on_player_ratings(self):
        """Ensure neither database.py nor routers/eventstudio.py queries non-existent total_matches column on player_ratings."""
        db_src = inspect.getsource(PostgresDatabase.get_event_details)
        self.assertNotIn("ORDER BY total_matches", db_src)
        self.assertIn("ORDER BY matches_played DESC NULLS LAST", db_src)

        es_src = inspect.getsource(eventstudio_router)
        self.assertNotIn("SELECT current_elo, total_matches FROM player_ratings", es_src)
        self.assertIn("SELECT current_elo, matches_played AS total_matches FROM player_ratings", es_src)

    def test_get_events_field_stats_avoids_or_lower_join_scan(self):
        """Ensure get_events_field_stats uses indexed player_id join instead of OR LOWER(pr.player_name) = LOWER(ep.full_name)."""
        src = inspect.getsource(PostgresDatabase.get_events_field_stats)
        self.assertNotIn("OR (pr.player_name IS NOT NULL AND LOWER(pr.player_name) = LOWER(ep.full_name))", src)
        self.assertIn("ON ep.player_id = pr.player_id", src)

    def test_get_community_overview_paginates_before_users_join(self):
        """Ensure get_community_overview groups and limits top_comp before joining users via LATERAL."""
        src = inspect.getsource(PostgresDatabase.get_community_overview)
        self.assertIn("WITH top_comp AS", src)
        self.assertIn("LEFT JOIN LATERAL", src)
        self.assertNotIn("GROUP BY e.id, e.name, e.event_date, e.end_date, e.city, e.state, e.country, e.total_players, e.num_rounds, e.current_round, e.is_ended, e.raw_json", inspect.getsource(PostgresDatabase.get_recommended_events))

    def test_batch_player_ratings_lookups_use_indexed_player_name(self):
        """Ensure leaderboard, community, and leagues_hub_service avoid unindexed OR LOWER(player_name) = ANY(%s) full table scans."""
        lb_src = inspect.getsource(leaderboard_router)
        self.assertNotIn("OR LOWER(player_name) = ANY(%s)", lb_src)

        comm_src = inspect.getsource(community_router)
        self.assertNotIn("LOWER(player_name) = ANY(%s)", comm_src)

        lh_src = inspect.getsource(leagues_hub_service)
        self.assertNotIn("OR LOWER(TRIM(player_name)) = ANY(%s)", lh_src)

    def test_get_players_directory_paginates_before_users_join(self):
        """Ensure get_players_directory paginates player_ratings inside WITH page_ratings AS (... LIMIT %s OFFSET %s) before joining users."""
        src = inspect.getsource(PostgresDatabase.get_players_directory)
        self.assertIn("WITH page_ratings AS", src)
        self.assertIn("LEFT JOIN LATERAL", src)

    def test_get_all_teams_list_uses_window_function_instead_of_array_agg(self):
        """Ensure _get_all_teams_list uses window function overall_rn instead of ARRAY_AGG sorts."""
        src = inspect.getsource(PostgresDatabase._get_all_teams_list)
        self.assertNotIn("ARRAY_AGG", src)
        self.assertIn("overall_rn", src)

    def test_init_db_defines_coalesce_functional_indexes_and_skips_full_table_updates(self):
        """Ensure init_db creates functional expression indexes for COALESCE(game_system, '40k') and skips boot-time full table UPDATEs."""
        src = inspect.getsource(PostgresDatabase.init_db)
        self.assertIn("idx_pg_ratings_coal_sys_elo", src)
        self.assertIn("idx_pg_ratings_coal_sys_pid", src)
        self.assertIn("idx_pg_ratings_coal_sys_team", src)
        self.assertIn("idx_pg_events_coal_sys_date", src)
        self.assertIn("idx_pg_history_coal_sys_pid", src)
        self.assertNotIn("UPDATE player_ratings SET game_system = '40k'", src)

    def test_get_player_tournaments_avoids_full_event_fanout(self):
        """Ensure get_player_tournaments filters strictly by player_id without OR te.needs_full_rank = TRUE fan-out."""
        src = inspect.getsource(PostgresDatabase.get_player_tournaments)
        self.assertNotIn("OR te.needs_full_rank = TRUE", src)

    def test_get_community_overview_bounds_event_dates_and_avoids_not_exists_team_subquery(self):
        """Ensure get_community_overview bounds events_filtered by date and avoids correlated NOT EXISTS subqueries."""
        src = inspect.getsource(PostgresDatabase.get_community_overview)
        self.assertIn("INTERVAL '180 days'", src)
        self.assertNotIn("SELECT 1 FROM event_participants ep2", src)

    def test_get_events_list_enforces_status_filter(self):
        """Ensure get_events_list applies SQL filtering for completed, upcoming, and live statuses."""
        src = inspect.getsource(PostgresDatabase.get_events_list)
        self.assertIn('s_norm == "completed"', src)
        self.assertIn('s_norm == "upcoming"', src)


if __name__ == "__main__":
    unittest.main()
