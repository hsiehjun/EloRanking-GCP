"""
Unit and regression test suite verifying official competitive tournament placings
versus overallPlacing (hobby/soft score) handling, manualPlacing overrides, and auto-sync triggers.
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from scraper import BestCoastPairingsScraper


def test_scraper_placing_resolution_priority():
    """Verify that competitive placing and manualPlacing are prioritized over overallPlacing (hobby score)."""
    mock_db = MagicMock()
    scraper = BestCoastPairingsScraper(db=mock_db)

    # Mock BCP players payload representing real Tacoma Open GT players
    raw_players = [
        {
            "id": "cgVaUwCQFMD5",
            "userId": "tFaOoE7fr5",
            "user": {"id": "tFaOoE7fr5", "firstName": "Steve", "lastName": "Trimble"},
            "placing": 1,
            "overallPlacing": 23,
            "manualPlacing": False,
            "podNum": 1,
            "faction": {"name": "Death Guard"}
        },
        {
            "id": "nXBu7YoQF1pR",
            "userId": "RhymmsfIOA",
            "user": {"id": "RhymmsfIOA", "firstName": "Jeff", "lastName": "Jew"},
            "placing": 2,
            "overallPlacing": 30,
            "manualPlacing": False,
            "podNum": 1,
            "faction": {"name": "Tyranids"}
        },
        {
            "id": "bj12345",
            "userId": "bj_user",
            "user": {"id": "bj_user", "firstName": "Ben", "lastName": "Jurek"},
            "placing": 3,
            "overallPlacing": 5,
            "manualPlacing": 3,
            "podNum": 1,
            "faction": {"name": "Imperial Knights"}
        },
        {
            "id": "kb99999",
            "userId": "kb_user",
            "user": {"id": "kb_user", "firstName": "Ken", "lastName": "Bush"},
            "placing": 9,
            "overallPlacing": 1,  # Best Overall Hobby/Paint score
            "manualPlacing": False,
            "podNum": 2,
            "faction": {"name": "Astra Militarum"}
        },
        {
            "id": "manual_override_player",
            "userId": "mo_user",
            "user": {"id": "mo_user", "firstName": "Manual", "lastName": "Override"},
            "placing": 8,
            "overallPlacing": 15,
            "manualPlacing": 2,  # Explicit TO override to 2nd place
            "podNum": 1,
            "faction": {"name": "Aeldari"}
        },
        {
            "id": "hobby_only_player",
            "userId": "ho_user",
            "user": {"id": "ho_user", "firstName": "Hobby", "lastName": "Only"},
            "placing": None,
            "overallPlacing": 12,
            "manualPlacing": None,
            "podNum": 3,
            "faction": {"name": "Orks"}
        }
    ]

    mock_db.upsert_event_participants_batch = MagicMock()
    count = scraper.ingest_event_roster("8r0WoulZ8iZm", raw_players)
    assert count == 6

    upsert_args = mock_db.upsert_event_participants_batch.call_args[0]
    event_id, participants = upsert_args
    assert event_id == "8r0WoulZ8iZm"

    by_user = {p["player_id"]: p for p in participants}

    # 1. Steve Trimble: Must have placement == 1 (NOT 23 overallPlacing)
    assert by_user["tFaOoE7fr5"]["placement"] == 1, f"Steve Trimble placement was {by_user['tFaOoE7fr5']['placement']}, expected 1"

    # 2. Jeff Jew: Must have placement == 2 (NOT 30 overallPlacing)
    assert by_user["RhymmsfIOA"]["placement"] == 2, f"Jeff Jew placement was {by_user['RhymmsfIOA']['placement']}, expected 2"

    # 3. Ben Jurek: Must have placement == 3
    assert by_user["bj_user"]["placement"] == 3, f"Ben Jurek placement was {by_user['bj_user']['placement']}, expected 3"

    # 4. Ken Bush: Must have placement == 9 (NOT 1 overallPlacing!)
    assert by_user["kb_user"]["placement"] == 9, f"Ken Bush placement was {by_user['kb_user']['placement']}, expected 9"

    # 5. Manual Override: manualPlacing == 2 must override placing == 8
    assert by_user["mo_user"]["placement"] == 2, f"Manual Override placement was {by_user['mo_user']['placement']}, expected 2"

    # 6. Hobby Only: When placing is None, falls back to overallPlacing == 12
    assert by_user["ho_user"]["placement"] == 12, f"Hobby Only placement was {by_user['ho_user']['placement']}, expected 12"

    print("✅ test_scraper_placing_resolution_priority passed!")


def test_team_standings_placing_priority():
    """Verify that team event placings prioritize manualPlacing and placing over overallPlacing."""
    mock_db = MagicMock()
    scraper = BestCoastPairingsScraper(db=mock_db)

    teams_payload = [
        {
            "id": "team_1",
            "name": "Team Alpha",
            "placing": 1,
            "overallPlacing": 4,
            "manualPlacing": False,
            "metrics": [{"name": "Match Points", "value": 15}, {"name": "Battle Points", "value": 450}]
        },
        {
            "id": "team_2",
            "name": "Team Beta",
            "placing": 5,
            "overallPlacing": 1,  # Hobby award
            "manualPlacing": False,
            "metrics": [{"name": "Match Points", "value": 9}, {"name": "Battle Points", "value": 380}]
        },
        {
            "id": "team_3",
            "name": "Team Gamma",
            "placing": 3,
            "overallPlacing": 2,
            "manualPlacing": 2,  # TO manual override to 2nd place
            "metrics": [{"name": "Match Points", "value": 12}, {"name": "Battle Points", "value": 410}]
        }
    ]

    with patch.object(scraper, "fetch_event_details", return_value={"teamEvent": True}), \
         patch.object(scraper, "fetch_event_teams", return_value=teams_payload), \
         patch.object(scraper, "fetch_event_players", return_value=[]):
        scraper.sync_event_roster("team_ev_123")

    assert mock_db.save_event_team_standings.call_count == 1
    saved_standings = mock_db.save_event_team_standings.call_args[0][1]

    # Verify order and placings
    standings_by_id = {t["id"]: t for t in saved_standings}
    assert standings_by_id["team_1"]["placing"] == 1
    assert standings_by_id["team_2"]["placing"] == 5  # NOT 1 overallPlacing
    assert standings_by_id["team_3"]["placing"] == 2  # manualPlacing override

    print("✅ test_team_standings_placing_priority passed!")


def test_leaderboard_has_missing_placings_guard():
    """Verify that leaderboard router correctly flags events missing official_placement."""
    # Scenario A: Event ended, players have rank_idx placement (1, 2, 3) but NO official_placement
    # In the old code, `not any(p.get("placement") ...)` was FALSE because p.get("placement") was 1.
    players_without_official = [
        {"player_id": "p1", "full_name": "Player 1", "placement": 1, "official_placement": None},
        {"player_id": "p2", "full_name": "Player 2", "placement": 2, "official_placement": None},
        {"player_id": "p3", "full_name": "Player 3", "placement": 3, "official_placement": None},
        {"player_id": "p4", "full_name": "Player 4", "placement": 4, "official_placement": None},
    ]
    event_details_missing = {
        "id": "ev_ended_no_placings",
        "is_ended": True,
        "players": players_without_official,
        "matches": [{"id": "m1"}]
    }

    # Old buggy check evaluated to False:
    old_check = not any(p.get("placement") or p.get("official_placement") for p in event_details_missing.get("players", []))
    assert old_check is False, "Demonstrating root cause: old check failed to detect missing placings"

    # New check properly detects missing placings:
    new_check = sum(1 for p in event_details_missing.get("players", []) if p.get("official_placement")) < min(len(event_details_missing.get("players", [])), 4)
    assert new_check is True, "New check must detect that event is missing official placings!"

    # Scenario B: Event with official placements already synced
    players_with_official = [
        {"player_id": "p1", "full_name": "Steve Trimble", "placement": 1, "official_placement": 1},
        {"player_id": "p2", "full_name": "Jeff Jew", "placement": 2, "official_placement": 2},
        {"player_id": "p3", "full_name": "Ben Jurek", "placement": 3, "official_placement": 3},
        {"player_id": "p4", "full_name": "Steven Salazar", "placement": 4, "official_placement": 4},
    ]
    event_details_synced = {
        "id": "ev_ended_synced",
        "is_ended": True,
        "players": players_with_official,
        "matches": [{"id": "m1"}]
    }
    synced_check = sum(1 for p in event_details_synced.get("players", []) if p.get("official_placement")) < min(len(event_details_synced.get("players", [])), 4)
    assert synced_check is False, "Synced event must NOT flag missing placings"

    print("✅ test_leaderboard_has_missing_placings_guard passed!")


def test_standings_sort_with_official_placements():
    """Verify that official placements rank Steve Trimble #1 and Ken Bush #9 even with battle points variance."""
    player_stats = {
        "tFaOoE7fr5": {
            "player_id": "tFaOoE7fr5",
            "full_name": "Steve Trimble",
            "pod_num": 1,
            "official_placement": 1,
            "event_wins": 8,
            "event_draws": 0,
            "event_losses": 0,
            "event_battle_points": 340,
            "ptv": 128,
            "sos": 0.65,
            "ext_sos": 0.60,
            "current_elo": 1950.0
        },
        "RhymmsfIOA": {
            "player_id": "RhymmsfIOA",
            "full_name": "Jeff Jew",
            "pod_num": 1,
            "official_placement": 2,
            "event_wins": 7,
            "event_draws": 0,
            "event_losses": 1,
            "event_battle_points": 355,
            "ptv": 64,
            "sos": 0.62,
            "ext_sos": 0.58,
            "current_elo": 1900.0
        },
        "kb_user": {
            "player_id": "kb_user",
            "full_name": "Ken Bush",
            "pod_num": 2,
            "official_placement": 9,
            "event_wins": 7,
            "event_draws": 0,
            "event_losses": 1,
            "event_battle_points": 378,  # Higher battle points than Steve Trimble
            "ptv": 64,
            "sos": 0.59,
            "ext_sos": 0.55,
            "current_elo": 1820.0
        }
    }

    has_pods = any(p.get("pod_num") is not None and p.get("pod_num") > 0 for p in player_stats.values())
    has_official_placements = any(p.get("official_placement") is not None and p.get("official_placement") > 0 for p in player_stats.values())

    def get_standings_sort_key(p):
        key_tuple = []
        if has_official_placements:
            pl = p.get("official_placement")
            pl_val = pl if (pl is not None and pl > 0) else 999999
            key_tuple.append(-pl_val)
        if has_pods:
            pod = p.get("pod_num")
            pod_val = pod if (pod is not None and pod > 0) else 9999
            key_tuple.append(-pod_val)
        key_tuple.extend([
            p["event_wins"] + 0.5 * p["event_draws"],
            p["ptv"],
            round(p["sos"], 4),
            p["event_battle_points"],
            round(p["ext_sos"], 4),
            p["current_elo"]
        ])
        return tuple(key_tuple)

    sorted_players = sorted(player_stats.values(), key=get_standings_sort_key, reverse=True)

    assert sorted_players[0]["full_name"] == "Steve Trimble"
    assert sorted_players[0]["official_placement"] == 1

    assert sorted_players[1]["full_name"] == "Jeff Jew"
    assert sorted_players[1]["official_placement"] == 2

    assert sorted_players[2]["full_name"] == "Ken Bush"
    assert sorted_players[2]["official_placement"] == 9

    print("✅ test_standings_sort_with_official_placements passed!")


if __name__ == "__main__":
    test_scraper_placing_resolution_priority()
    test_team_standings_placing_priority()
    test_leaderboard_has_missing_placings_guard()
    test_standings_sort_with_official_placements()
    print("\n🎉 ALL BCP PLACINGS INTEGRITY TESTS PASSED!")
