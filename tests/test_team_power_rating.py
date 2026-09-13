"""Unit test suite for Streamlined Tri-Anchor Team Power Rating formula and 180-Day Active Window.

Verifies:
1. Team Power Rating formula: Power = Skill Baseline * F_roster(R_active)
   - Skill Baseline = 0.40 * Top 5 Active Avg + 0.40 * All Active Avg + 0.20 * Top Ace
   - F_roster(R_active) = 0.10 + 0.90 * (log10(R_active) / log10(30))^0.65 (capped at 1.00 for R >= 30, 0.10 for R <= 1)
   - True Elo Scale: Ratings naturally sit on the 0 - 2,500+ Elo scale.
2. 180-Day (6-Month) Rolling Window:
   - Inactive players (last played > 180 days ago) do not contribute to R_active.
   - Dormant clubs naturally decline in power rating until members play a tournament.
3. Solo superstars (1 player) are severely curtailed (243.0 Elo) and hidden from the official leaderboard.
4. Deep, active clubs (Art of War, deep regional clubs) lead the rankings (1,900 - 2,200+ Elo).
5. Recruitment is net positive: growing from 5 to 10 members increases power (+233 pts), while club-wide depth gives an extra edge (+80 pts for 10 solid competitors).
6. get_teams_leaderboard defaults to min_members=5 on active roster count.
"""

import sys
import math
from datetime import datetime, date, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

import database
database.psycopg2 = MagicMock()
database.extras = MagicMock()
from database import PostgresDatabase


def make_test_db():
    db = object.__new__(PostgresDatabase)
    db.dsn = "postgresql://mock:mock@localhost:5432/mock"
    return db


def compute_expected_power(active_roster):
    """Computes expected power rating from a list of active player dicts."""
    active_count = len(active_roster)
    if active_count <= 0:
        return 0.0
    sorted_roster = sorted(active_roster, key=lambda x: x["current_elo"], reverse=True)
    top_ace = sorted_roster[0]["current_elo"]
    top5 = sorted_roster[:5]
    top5_avg = sum(p["current_elo"] for p in top5) / len(top5)
    all_avg = sum(p["current_elo"] for p in sorted_roster) / active_count
    skill_baseline = 0.40 * top5_avg + 0.40 * all_avg + 0.20 * top_ace

    if active_count <= 1:
        f_roster = 0.10
    elif active_count >= 30:
        f_roster = 1.00
    else:
        f_roster = 0.10 + 0.90 * ((math.log10(active_count) / math.log10(30.0)) ** 0.65)

    return round(skill_baseline * f_roster, 1)


def test_recruitment_and_depth_advantage():
    """Verify that recruitment is net-positive and club-wide depth gives a distinct advantage."""
    # 5-man elite clique
    squad_5 = [{"current_elo": 2350.0}] + [{"current_elo": 2225.0}] * 4
    pwr_5 = compute_expected_power(squad_5)
    assert pwr_5 == 1483.2, f"Expected 1483.2, got {pwr_5}"

    # Recruits 5 apprentice members (10 total, novices at 1650 Elo)
    squad_10_app = squad_5 + [{"current_elo": 1650.0}] * 5
    pwr_10_app = compute_expected_power(squad_10_app)
    assert pwr_10_app == 1716.6, f"Expected 1716.6, got {pwr_10_app}"
    assert pwr_10_app > pwr_5, f"Recruiting 5 apprentices must increase power! Got {pwr_10_app} vs {pwr_5}"

    # 10 solid competitive members (10 total, 5 @ 2225 + 5 @ 2150)
    squad_10_solid = squad_5 + [{"current_elo": 2150.0}] * 5
    pwr_10_solid = compute_expected_power(squad_10_solid)
    assert pwr_10_solid == 1796.5, f"Expected 1796.5, got {pwr_10_solid}"
    assert pwr_10_solid > pwr_10_app, "Solid club-wide depth must outscore club with novices"

    # Deep 20-member club
    squad_20 = squad_5 + [{"current_elo": 2150.0}] * 15
    pwr_20 = compute_expected_power(squad_20)
    assert pwr_20 > pwr_10_solid, "20-member club should exceed 10-member club"

    print(f"✅ test_recruitment_and_depth_advantage passed! (5: {pwr_5}, 10 Novice: {pwr_10_app} (+{pwr_10_app - pwr_5:.1f}), 10 Solid: {pwr_10_solid} (+{pwr_10_solid - pwr_10_app:.1f} depth))")


def test_solo_vs_club_power_rating():
    """Verify that solo superstars cannot outrank full squads."""
    solo = [{"current_elo": 2430.0}]
    solo_power = compute_expected_power(solo)
    assert solo_power == 243.0, f"Expected solo power 243.0, got {solo_power}"

    squad_5 = [{"current_elo": 2350.0}] + [{"current_elo": 2225.0}] * 4
    squad_5_power = compute_expected_power(squad_5)
    assert squad_5_power > solo_power * 5, "5-man squad must drastically outrank solo player"

    # Art of War: 23 active members
    aow = [{"current_elo": 2495.2}] + [{"current_elo": 2326.2}] * 4 + [{"current_elo": 2130.0}] * 18
    aow_power = compute_expected_power(aow)
    assert aow_power > 2150.0, f"Expected Art of War > 2150, got {aow_power}"
    print(f"✅ test_solo_vs_club_power_rating passed! (Solo: {solo_power}, 5-Man: {squad_5_power}, AoW: {aow_power})")


def test_get_teams_leaderboard_natural_sorting():
    """Verify get_teams_leaderboard defaults to min_members=1, naturally sorting solo squads to the bottom by power rating."""
    db = make_test_db()

    mock_teams = [
        {"team": "Art of War", "roster_count": 25, "active_roster_count": 23, "power_rating": 2207.7},
        {"team": "Team USA", "roster_count": 6, "active_roster_count": 6, "power_rating": 1850.0},
        {"team": "4-Player Squad", "roster_count": 4, "active_roster_count": 4, "power_rating": 1300.0},
        {"team": "Trios Team", "roster_count": 3, "active_roster_count": 3, "power_rating": 1100.0},
        {"team": "Dormant 10-Man Club", "roster_count": 10, "active_roster_count": 2, "power_rating": 911.5},
        {"team": "Duo Squad", "roster_count": 2, "active_roster_count": 2, "power_rating": 800.0},
        {"team": "Solo Squad", "roster_count": 1, "active_roster_count": 1, "power_rating": 243.0},
    ]

    with patch.object(db, "_get_all_teams_list", return_value=mock_teams):
        # Default call (min_members=1): all teams appear, naturally sorted by power rating
        res_default = db.get_teams_leaderboard()
        default_names = [t["team"] for t in res_default["items"]]
        assert len(default_names) == 7, f"Expected all 7 teams, got {len(default_names)}"
        assert default_names[0] == "Art of War", "Top active club must be #1"
        assert default_names[1] == "Team USA", "Solid squad must be #2"
        assert default_names[-1] == "Solo Squad", "Solo player (243.0) must naturally sit at the bottom"

        # Explicit filter when user specifies min_members=5
        res_min5 = db.get_teams_leaderboard(min_members=5)
        min5_names = [t["team"] for t in res_min5["items"]]
        assert "Solo Squad" not in min5_names, "Solo Squad filtered when min_members=5"
        assert "Dormant 10-Man Club" not in min5_names, "Dormant club filtered when min_members=5"
        assert "Team USA" in min5_names, "Team USA included"
        assert "Art of War" in min5_names, "Art of War included"

    print("✅ test_get_teams_leaderboard_natural_sorting passed!")


def test_get_team_roster_180_day_window():
    """Verify get_team_roster filters inactive members with the 180-day window and computes power rating."""
    db = make_test_db()

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    now = datetime.now(timezone.utc)
    recent_date = (now - timedelta(days=30)).strftime("%Y-%m-%d")
    old_date = (now - timedelta(days=220)).strftime("%Y-%m-%d") # > 180 days ago (inactive)

    # 6 players total: 5 active, 1 inactive
    mock_cur.fetchall.return_value = [
        {"player_id": "p1", "player_name": "Ace", "current_elo": 2350.0, "matches_played": 250, "wins": 200, "losses": 40, "draws": 10, "last_active_date": recent_date},
        {"player_id": "p2", "player_name": "Player 2", "current_elo": 2150.0, "matches_played": 250, "wins": 200, "losses": 40, "draws": 10, "last_active_date": recent_date},
        {"player_id": "p3", "player_name": "Player 3", "current_elo": 2050.0, "matches_played": 250, "wins": 200, "losses": 40, "draws": 10, "last_active_date": recent_date},
        {"player_id": "p4", "player_name": "Player 4", "current_elo": 2050.0, "matches_played": 250, "wins": 200, "losses": 40, "draws": 10, "last_active_date": recent_date},
        {"player_id": "p5", "player_name": "Player 5", "current_elo": 2000.0, "matches_played": 250, "wins": 200, "losses": 40, "draws": 10, "last_active_date": recent_date},
        {"player_id": "p6", "player_name": "Player 6 (Inactive)", "current_elo": 2400.0, "matches_played": 100, "wins": 90, "losses": 10, "draws": 0, "last_active_date": old_date},
    ]

    with patch.object(db, "get_connection", return_value=MagicMock(__enter__=MagicMock(return_value=mock_conn), __exit__=MagicMock(return_value=False))), \
         patch.object(PostgresDatabase, "get_cached", return_value=None), \
         patch.object(PostgresDatabase, "set_cached"):

        res = db.get_team_roster("Champions Club", game_system="40k")
        stats = res["stats"]

        assert stats["roster_count"] == 6, f"Expected 6 total roster, got {stats['roster_count']}"
        assert stats["active_roster_count"] == 5, f"Expected 5 active roster, got {stats['active_roster_count']}"
        assert stats["is_qualified"] is True

        # Active roster: p1-p5 (p6 excluded because inactive > 180 days)
        active_list = mock_cur.fetchall.return_value[:5]
        expected_power = compute_expected_power(active_list)
        assert stats["power_rating"] == expected_power, f"Expected {expected_power}, got {stats['power_rating']}"
        expected_top5_avg = round(sum(p["current_elo"] for p in active_list) / 5, 1)
        assert stats["top5_avg_elo"] == expected_top5_avg, f"Expected top5_avg_elo {expected_top5_avg}, got {stats['top5_avg_elo']}"

        # Check player ace / core / active flags
        roster = res["roster"]
        assert roster[0]["is_ace"] is True and roster[0]["is_core"] is True and roster[0]["active_rank"] == 1
        assert roster[1]["is_ace"] is False and roster[1]["is_core"] is True and roster[1]["active_rank"] == 2
        assert roster[4]["is_core"] is True and roster[4]["active_rank"] == 5
        assert roster[5]["is_active"] is False and roster[5]["is_core"] is False and roster[5]["is_ace"] is False

    print("✅ test_get_team_roster_180_day_window passed!")


def test_get_all_teams_list_psycopg2_sql_formatting_and_timeout():
    """Verify _get_all_teams_list executes SQL with psycopg2 % parameter formatting without IndexError and uses SET LOCAL statement_timeout."""
    db = make_test_db()
    PostgresDatabase._all_teams_cache_map = {}

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur

    executed_queries = []

    def simulate_psycopg2_execute(query, vars=None):
        executed_queries.append((query, vars))
        if vars is not None:
            # Exact simulation of psycopg2's C string interpolation (query % vars)
            # If any unescaped % (e.g. 40% or 100%) exists in SQL comments, this raises IndexError/TypeError
            _ = query % tuple(repr(v) for v in vars)
        return None

    mock_cur.execute.side_effect = simulate_psycopg2_execute
    mock_cur.fetchone.return_value = None
    mock_cur.fetchall.return_value = [
        {"team": "Art of War", "roster_count": 25, "active_roster_count": 23, "power_rating": 2207.7}
    ]

    with patch.object(db, "get_connection", return_value=MagicMock(__enter__=MagicMock(return_value=mock_conn), __exit__=MagicMock(return_value=False))):
        teams = db._get_all_teams_list(game_system="40k")
        assert len(teams) == 1
        assert teams[0]["team"] == "Art of War"
        assert teams[0]["rank"] == 1

    # Verify SET LOCAL statement_timeout was used (never non-LOCAL SET statement_timeout)
    set_stmts = [q for q, _ in executed_queries if "statement_timeout" in q]
    assert len(set_stmts) >= 1
    for stmt in set_stmts:
        assert "SET LOCAL statement_timeout" in stmt, f"Expected SET LOCAL statement_timeout, got: {stmt}"

    print("✅ test_get_all_teams_list_psycopg2_sql_formatting_and_timeout passed!")


def test_team_leaderboard_canonical_rank_and_column_sorting():
    """Verify canonical rank is preserved on search/sort and UI columns sort by active_avg_elo / active_roster_count."""
    db = make_test_db()
    mock_teams = [
        {"team": "Alpha Club", "rank": 1, "power_rating": 2100.0, "avg_elo": 1800.0, "active_avg_elo": 1950.0, "roster_count": 30, "active_roster_count": 15, "top_player_elo": 2300.0},
        {"team": "Beta Squad", "rank": 2, "power_rating": 1900.0, "avg_elo": 2050.0, "active_avg_elo": 2050.0, "roster_count": 10, "active_roster_count": 10, "top_player_elo": 2250.0},
        {"team": "Gamma Guild", "rank": 3, "power_rating": 1700.0, "avg_elo": 1750.0, "active_avg_elo": 1700.0, "roster_count": 20, "active_roster_count": 20, "top_player_elo": 2100.0},
    ]

    with patch.object(db, "_get_all_teams_list", return_value=mock_teams):
        # 1. Search filter preserves true rank (#3 Gamma Guild stays rank 3)
        res_search = db.get_teams_leaderboard(query="Gamma")
        assert len(res_search["items"]) == 1
        assert res_search["items"][0]["team"] == "Gamma Guild"
        assert res_search["items"][0]["rank"] == 3

        # 2. Sort by avg_elo sorts by active_avg_elo DESC (Beta 2050 > Alpha 1950 > Gamma 1700), preserving rank
        res_avg = db.get_teams_leaderboard(sort_by="avg_elo", order="DESC")
        assert [t["team"] for t in res_avg["items"]] == ["Beta Squad", "Alpha Club", "Gamma Guild"]
        assert [t["rank"] for t in res_avg["items"]] == [2, 1, 3]

        # 3. Sort by roster_count sorts by active_roster_count DESC (Gamma 20 > Alpha 15 > Beta 10)
        res_roster = db.get_teams_leaderboard(sort_by="roster_count", order="DESC")
        assert [t["team"] for t in res_roster["items"]] == ["Gamma Guild", "Alpha Club", "Beta Squad"]
        assert [t["rank"] for t in res_roster["items"]] == [3, 1, 2]

    print("✅ test_team_leaderboard_canonical_rank_and_column_sorting passed!")


def test_bcp_roster_and_win_path_player_resolution():
    """Verify format_bcp_roster_to_players maps canonical DB player_id and bcp_event_player_id, and get_player_win_path resolves via name/event_participants."""
    from routers.leaderboard import format_bcp_roster_to_players
    from elo import EloEngine

    raw_bcp = [
        {
            "id": "event_reg_999",
            "userId": "bcp_user_123",
            "firstName": "John",
            "lastName": "Lennon",
            "faction": {"name": "Aeldari"},
            "team": {"name": "Art of War"}
        }
    ]
    mock_db = make_test_db()
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cur
    # Return canonical DB player rating row matched by name
    mock_cur.fetchall.return_value = [
        {
            "player_id": "canonical_db_id_777",
            "player_name": "John Lennon",
            "current_elo": 1850.5,
            "peak_elo": 1900.0,
            "top_faction": "Aeldari",
            "team": "Art of War"
        }
    ]

    with patch.object(mock_db, "get_connection", return_value=MagicMock(__enter__=MagicMock(return_value=mock_conn), __exit__=MagicMock(return_value=False))):
        formatted = format_bcp_roster_to_players(raw_bcp, db=mock_db, game_system="40k")
        assert len(formatted) == 1
        p = formatted[0]
        assert p["player_id"] == "canonical_db_id_777", f"Expected canonical_db_id_777, got {p['player_id']}"
        assert p["bcp_event_player_id"] == "event_reg_999"
        assert p["user_id"] == "bcp_user_123"
        assert p["current_elo"] == 1850.5

    # Verify EloEngine.get_player_win_path resolves player when passed event_reg_999 + player_name
    engine = EloEngine(db=mock_db)
    with patch.object(mock_db, "get_player_history", return_value=[]), \
         patch.object(mock_db, "get_player_matches", return_value=[]), \
         patch.object(mock_db, "get_connection", return_value=MagicMock(__enter__=MagicMock(return_value=mock_conn), __exit__=MagicMock(return_value=False))), \
         patch.object(mock_db, "search_players", side_effect=lambda q, limit=10, game_system="40k": (
             [{"player_id": "canonical_db_id_777", "player_name": "John Lennon", "current_elo": 1850.5, "peak_elo": 1900.0, "matches_played": 12, "wins": 9, "losses": 3, "draws": 0, "win_rate": 75.0, "top_faction": "Aeldari", "team": "Art of War"}]
             if q == "John Lennon" else []
         )):
        mock_cur.fetchone.return_value = None
        wp = engine.get_player_win_path("event_reg_999", game_system="40k", player_name="John Lennon")
        assert wp["player_id"] == "canonical_db_id_777"
        assert wp["player_name"] == "John Lennon"
        assert wp["current_elo"] == 1850.5

    print("✅ test_bcp_roster_and_win_path_player_resolution passed!")


import unittest

class TestTeamPowerRatingSuite(unittest.TestCase):
    def test_recruitment_and_depth(self):
        test_recruitment_and_depth_advantage()

    def test_solo_vs_club(self):
        test_solo_vs_club_power_rating()

    def test_leaderboard_sorting(self):
        test_get_teams_leaderboard_natural_sorting()

    def test_roster_180_day_window(self):
        test_get_team_roster_180_day_window()

    def test_sql_formatting_and_timeout(self):
        test_get_all_teams_list_psycopg2_sql_formatting_and_timeout()

    def test_canonical_rank_and_column_sorting(self):
        test_team_leaderboard_canonical_rank_and_column_sorting()

    def test_bcp_roster_and_win_path_resolution(self):
        test_bcp_roster_and_win_path_player_resolution()


if __name__ == "__main__":
    test_recruitment_and_depth_advantage()
    test_solo_vs_club_power_rating()
    test_get_teams_leaderboard_natural_sorting()
    test_get_team_roster_180_day_window()
    test_get_all_teams_list_psycopg2_sql_formatting_and_timeout()
    test_team_leaderboard_canonical_rank_and_column_sorting()
    test_bcp_roster_and_win_path_player_resolution()
    print("\n🎉 All Team Power Rating tests passed!")

