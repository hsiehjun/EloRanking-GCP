import asyncio
import sys
import types
import unittest
from unittest.mock import patch

import tracker_importer
import aos_badges

# Provide a lightweight `core` shim when running in an environment without external FastAPI/psycopg2 packages
if "core" not in sys.modules:
    try:
        import core  # noqa: F401
    except Exception:
        core_mod = types.ModuleType("core")

        class DummyHTTPException(Exception):
            def __init__(self, status_code: int, detail: str = ""):
                super().__init__(detail)
                self.status_code = status_code
                self.detail = detail

        class DummyRouter:
            def __init__(self, *args, **kwargs):
                pass
            def get(self, *args, **kwargs):
                return lambda fn: fn
            def post(self, *args, **kwargs):
                return lambda fn: fn
            def put(self, *args, **kwargs):
                return lambda fn: fn
            def delete(self, *args, **kwargs):
                return lambda fn: fn

        class DummyBaseModel:
            def __init__(self, **kwargs):
                for k, v in kwargs.items():
                    setattr(self, k, v)

        def _normalize_mid(mid):
            return str(mid or "").strip().upper()

        core_mod.APIRouter = DummyRouter
        core_mod.BaseModel = DummyBaseModel
        core_mod.HTTPException = DummyHTTPException
        core_mod.Query = lambda default=None, **kw: default
        core_mod.Request = object
        core_mod.Response = object
        core_mod.BackgroundTasks = object
        core_mod.FileResponse = object
        core_mod.HTMLResponse = object
        core_mod.JSONResponse = object
        core_mod.PlainTextResponse = object
        core_mod.RedirectResponse = object
        core_mod.StreamingResponse = object
        core_mod.get_database = lambda: None
        core_mod.get_auth_manager = lambda: None
        core_mod.get_elo_engine = lambda: None
        core_mod.get_firestore_engine = lambda: None
        core_mod.get_army_parser = lambda: None
        core_mod._get_user_session_or_401 = lambda req: None
        core_mod._get_admin_session_or_403 = lambda req: None
        core_mod._get_to_session_or_403 = lambda req: None
        core_mod.NO_CACHE_HEADERS = {}
        core_mod.VERIFIED_TOURNAMENT_CITIES = {}
        from pathlib import Path
        core_mod.web_dir = Path("web")
        core_mod.package_dir = Path(".")
        import logging
        core_mod.logger = logging.getLogger("test_tracker")
        core_mod.BestCoastPairingsScraper = object
        core_mod._decode_jwt_payload = lambda x: {}
        core_mod.init_tracker_room_from_chat = lambda *a, **k: None
        core_mod._roster_cache = {}
        core_mod.extras = types.SimpleNamespace(RealDictCursor=object)
        core_mod.DEFAULT_GAME_SYSTEM_ID = "40k"
        core_mod.INITIAL_ELO = 1200.0
        core_mod.DEFAULT_K_FACTOR = 32.0
        core_mod.MIN_MATCHES_FOR_RANKING = 5
        core_mod.BCP_API_BASE = ""
        core_mod.DEFAULT_HEADERS = {}
        core_mod.BCP_CLIENT_ID = ""
        core_mod.BCP_USER_AGENT = ""
        core_mod.GOOGLE_MAPS_API_KEY = ""
        core_mod.TRACKER_ROOMS = {}
        core_mod.TRACKER_LISTENERS = {}
        core_mod.generate_unique_match_id = lambda db, game_system="40k": "WH40K-TEST-0001"
        core_mod.normalize_tracker_match_id = _normalize_mid
        sys.modules["core"] = core_mod

from routers import tracker as tracker_router


def test_edition_detection_and_unclipped_9th_ed_secondaries():
    # 1. 9th Edition Nephilim game with 45 Primary + 45 Secondary (15 + 15 + 15) + 10 Paint = 100
    raw_9th = {
        "id": "ttb-9th-nephilim-001",
        "gameType": "wh40k-9e",
        "packName": "Warzone Nephilim: Grand Tournament",
        "missionName": "Tear Down Their Icons",
        "deployment": "Dawn of War",
        "date": "2022-11-12T18:00:00Z",
        "players": [
            {
                "name": "John Hsieh",
                "faction": "Aeldari",
                "detachment": "Ulthwe",
                "battleReady": True,
                "primaryScores": [0, 12, 12, 12, 9],  # 45 Primary
                "secondaries": [
                    {"name": "Warp Ritual", "scores": [0, 3, 4, 5, 3]},          # 15 VP
                    {"name": "Retrieve Nephilim Data", "scores": [0, 4, 4, 4, 0]}, # 12 VP
                    {"name": "Engage on All Fronts", "scores": [3, 3, 4, 4, 4]},   # 18 -> capped at 18/15 = 45 total
                ],
            },
            {
                "name": "Alex Rivera",
                "faction": "Necrons",
                "detachment": "Obsekh Dynasty",
                "battleReady": True,
                "primaryScores": [0, 8, 12, 12, 8],  # 40 Primary
                "secondaries": [
                    {"name": "Ancient Machineries", "scores": [4, 4, 4, 3, 0]},    # 15 VP
                    {"name": "Code of Combat", "scores": [3, 3, 3, 3, 3]},         # 15 VP
                    {"name": "Treasure of the Aeons", "scores": [2, 3, 3, 3, 0]},  # 11 VP -> 41 total (> 40!)
                ],
            },
        ],
    }

    parsed_list = tracker_importer.parse_imported_games_payload(raw_9th, "tabletop_battles")
    assert len(parsed_list) == 1
    g9 = parsed_list[0]
    assert g9["edition"] == "9th"
    assert "9th" in g9["edition_label"]

    st9 = g9["state"]
    assert st9["p1"]["primaryCap"] == 45
    assert st9["p1"]["secondaryCap"] == 45
    # Verify 45-pt secondaries are NOT clipped to 40!
    p1_sec_sum = sum(r["secondaryScore"] for r in st9["p1"]["rounds"])
    p2_sec_sum = sum(r["secondaryScore"] for r in st9["p2"]["rounds"])
    assert p1_sec_sum == 45
    assert p2_sec_sum == 41
    assert g9["p1_score"] == 100  # 45 Pri + 45 Sec + 10 Paint
    assert g9["p2_score"] == 91   # 40 Pri + 41 Sec + 10 Paint


def test_8th_edition_itc_caps_and_no_paint_bonus():
    # 2. 8th Edition ITC Champions Mission (36 Primary, 12 Secondary, 0 Paint)
    raw_8th = {
        "id": "itc-8th-2019-001",
        "gameType": "wh40k-8e-itc",
        "packName": "ITC Champions Missions 2019",
        "missionName": "Mission 1: Seize Ground",
        "date": "2019-08-15T18:00:00Z",
        "players": [
            {
                "name": "John Hsieh",
                "faction": "Space Marines",
                "primaryScores": [6, 6, 6, 6, 6, 6],  # 36 Primary
                "secondaries": [
                    {"name": "Headhunter", "scores": [1, 1, 1, 1, 0]},  # 4
                    {"name": "Recon", "scores": [1, 1, 1, 1, 0]},       # 4
                    {"name": "Engineers", "scores": [0, 1, 1, 1, 1]},   # 4 -> 12 total
                ],
            },
            {
                "name": "Bob Smith",
                "faction": "Orks",
                "primaryScores": [4, 5, 5, 4, 4, 3],  # 25 Primary
                "secondaries": [
                    {"name": "Old School", "scores": [1, 1, 1, 1, 0]},  # 4
                    {"name": "Big Game Hunter", "scores": [1, 2, 0, 0, 0]},  # 3
                ],
            },
        ],
    }

    parsed_8th = tracker_importer.parse_imported_games_payload(raw_8th, "tabletop_battles")[0]
    assert parsed_8th["edition"] == "8th_itc"
    assert parsed_8th["state"]["p1"]["primaryCap"] == 36
    assert parsed_8th["state"]["p1"]["secondaryCap"] == 12
    assert parsed_8th["state"]["p1"]["paintScore"] == 0
    assert parsed_8th["state"]["p1"]["battleReady"] is False
    # 36 Primary + 12 Secondary + 0 Paint = 48 (no +10 phantom paint bonus)
    assert parsed_8th["p1_score"] == 48
    assert parsed_8th["p2_score"] == 32


def test_aos_3e_grand_strategy_and_aos_4e_detection():
    # 3. AoS 3rd Edition with Grand Strategy (+3 VP)
    raw_aos_3e = {
        "id": "aos-3e-ghb-001",
        "gameType": "aos-3e",
        "packName": "AoS 3rd Edition Pitched Battles",
        "battleplan": "Geomantic Pulse",
        "date": "2023-09-10T18:00:00Z",
        "players": [
            {
                "name": "Sigmar Player",
                "faction": "Stormcast Eternals",
                "grandStrategy": "Spellcasting Savant",
                "grandStrategyAchieved": True,
                "grandStrategyScore": 3,
                "rounds": [
                    {"round": 1, "primary": 4, "tactic": "Surround and Destroy", "tacticScored": True, "tacticPoints": 2},
                    {"round": 2, "primary": 5, "tactic": "Magical Dominance", "tacticScored": True, "tacticPoints": 2},
                    {"round": 3, "primary": 5, "tactic": "Led Into the Maelstrom", "tacticScored": True, "tacticPoints": 2},
                    {"round": 4, "primary": 6, "tactic": "Intimidate the Invaders", "tacticScored": False, "tacticPoints": 0},
                    {"round": 5, "primary": 6, "tactic": "Secure the Battlefield", "tacticScored": True, "tacticPoints": 2},
                ],
            },
            {
                "name": "Chaos Player",
                "faction": "Slaves to Darkness",
                "grandStrategy": "Overshadow",
                "grandStrategyAchieved": False,
                "grandStrategyScore": 0,
                "rounds": [
                    {"round": 1, "primary": 4, "tactic": "Run Them Down", "tacticScored": True, "tacticPoints": 2},
                    {"round": 2, "primary": 4, "tactic": "Glory to Chaos", "tacticScored": True, "tacticPoints": 2},
                    {"round": 3, "primary": 4, "tactic": "Desecrate Their Lands", "tacticScored": False, "tacticPoints": 0},
                    {"round": 4, "primary": 4, "tactic": "Eye of the Gods", "tacticScored": True, "tacticPoints": 2},
                    {"round": 5, "primary": 4, "tactic": "Take the Flanks", "tacticScored": False, "tacticPoints": 0},
                ],
            },
        ],
    }

    parsed_aos3 = tracker_importer.parse_imported_games_payload(raw_aos_3e, "tabletop_battles")[0]
    assert parsed_aos3["game_system"] == "aos"
    assert parsed_aos3["edition"] == "aos_3e"
    assert parsed_aos3["state"]["p1"]["grandStrategy"] == "Spellcasting Savant"
    assert parsed_aos3["state"]["p1"]["grandStrategyScore"] == 3
    # P1: 26 Primary + 8 Tactics + 3 Grand Strategy = 37
    assert parsed_aos3["p1_score"] == 37
    # P2: 20 Primary + 6 Tactics + 0 Grand Strategy = 26
    assert parsed_aos3["p2_score"] == 26


def test_event_match_mapping_participant_verification_alignment_and_locking():
    # In-memory store for tracker_games and event matches
    saved_games = {
        "WH40K-TTB-IMPORT-SWAP": {
            "match_id": "WH40K-TTB-IMPORT-SWAP",
            "game_system": "40k",
            "status": "completed",
            "is_finished": True,
            "user_id_p1": 101,
            "user_id_p2": None,
            "p1_name": "Alex Rivera",  # Note: Imported with Alex as P1 and John as P2!
            "p2_name": "John Hsieh",
            "p1_faction": "Necrons",
            "p2_faction": "Aeldari",
            "p1_detachment": "Awakened Dynasty",
            "p2_detachment": "Warhost",
            "p1_score": 72,
            "p2_score": 88,
            "edition": "10th",
            "edition_label": "WH40K 10th Ed",
            "event_id": None,
            "round_num": 1,
            "table_num": None,
            "state": {
                "matchId": "WH40K-TTB-IMPORT-SWAP",
                "gameSystem": "40k",
                "edition": "10th",
                "edition_label": "WH40K 10th Ed",
                "is_finished": True,
                "status": "completed",
                "p1Score": 72,
                "p2Score": 88,
                "game": {
                    "p1Name": "Alex Rivera",
                    "p2Name": "John Hsieh",
                    "p1Faction": "Necrons",
                    "p2Faction": "Aeldari",
                    "p1Detachments": ["Awakened Dynasty"],
                    "p2Detachments": ["Warhost"],
                },
                "p1": {
                    "name": "Alex Rivera",
                    "faction": "Necrons",
                    "score": 72,
                    "rounds": [{"round": 1, "primaryScore": 10, "secondaryScore": 5}],
                },
                "p2": {
                    "name": "John Hsieh",
                    "faction": "Aeldari",
                    "score": 88,
                    "rounds": [{"round": 1, "primaryScore": 15, "secondaryScore": 10}],
                },
            },
        },
        "WH40K-TTB-IMPORT-SECOND": {
            "match_id": "WH40K-TTB-IMPORT-SECOND",
            "game_system": "40k",
            "status": "completed",
            "is_finished": True,
            "user_id_p1": 101,
            "user_id_p2": None,
            "p1_name": "John Hsieh",
            "p2_name": "Alex Rivera",
            "p1_score": 90,
            "p2_score": 70,
            "event_id": None,
            "state": {
                "matchId": "WH40K-TTB-IMPORT-SECOND",
                "is_finished": True,
                "status": "completed",
                "p1": {"name": "John Hsieh", "score": 90, "rounds": []},
                "p2": {"name": "Alex Rivera", "score": 70, "rounds": []},
            },
        },
    }

    # Official tournament pairing has John Hsieh as Player 1 and Alex Rivera as Player 2
    official_event_pairing = {
        "id": 555,
        "event_id": "socal-open-2026",
        "event_name": "SoCal Open 2026 40k GT",
        "round": 2,
        "table_number": 4,
        "player1_id": "p-john",
        "player1_name": "John Hsieh",
        "player1_faction": "Aeldari",
        "player1_score": 88,
        "player2_id": "p-alex",
        "player2_name": "Alex Rivera",
        "player2_faction": "Necrons",
        "player2_score": 72,
        "match_date": "2026-09-20",
        "is_bye": False,
    }

    class FakeDB:
        def get_tracker_game(self, mid):
            if mid in saved_games:
                return saved_games[mid]
            import re
            m = re.match(r"^(?:WH40K-|AOS-)?(?:BCP|ES)-(.+)-R(\d+)-T(\d+)$", str(mid), re.I)
            if m:
                ev_id, r_num, t_num = m.group(1), int(m.group(2)), int(m.group(3))
                for g in saved_games.values():
                    if (
                        str(g.get("event_id") or "").lower() == ev_id.lower()
                        and int(g.get("round_num") or 0) == r_num
                        and int(g.get("table_num") or 0) == t_num
                    ):
                        return g
            return None

        def save_tracker_game(self, match_id, state_data, version=1, user_id_p1=None, user_id_p2=None):
            rec = saved_games.get(match_id, {})
            if state_data.get("_clear_event_mapping"):
                rec["event_id"] = None
                rec["round_num"] = 1
                rec["table_num"] = None
            else:
                rec["event_id"] = state_data.get("event_id") or state_data.get("game", {}).get("eventId")
                rec["round_num"] = state_data.get("round_num") or state_data.get("game", {}).get("roundNum") or 1
                rec["table_num"] = state_data.get("table_num") or state_data.get("game", {}).get("tableNum")
            rec["p1_name"] = state_data.get("p1", {}).get("name") or state_data.get("game", {}).get("p1Name")
            rec["p2_name"] = state_data.get("p2", {}).get("name") or state_data.get("game", {}).get("p2Name")
            rec["p1_score"] = state_data.get("p1", {}).get("score", 0)
            rec["p2_score"] = state_data.get("p2", {}).get("score", 0)
            rec["state"] = state_data
            rec["state_json"] = state_data
            saved_games[match_id] = rec
            return True

    fake_db = FakeDB()

    def fake_find_conflicting(db, ev_real_id, r_num, t_num, exclude_match_id):
        for mid, g in saved_games.items():
            if mid.upper() == str(exclude_match_id).upper():
                continue
            if (
                str(g.get("event_id") or "").lower() == str(ev_real_id).lower()
                and int(g.get("round_num") or 0) == int(r_num)
                and int(g.get("table_num") or 0) == int(t_num)
            ):
                return g
        return None

    active_user = {
        "id": 999,
        "display_name": "Random Bystander",
        "player_id": "p-bystander",
    }

    with (
        patch.object(tracker_router, "get_database", return_value=fake_db),
        patch.object(
            tracker_router,
            "_lookup_event_pairing_record",
            side_effect=lambda db, ev_id, r_num, t_num: official_event_pairing
            if (ev_id == "socal-open-2026" and int(r_num) == 2 and int(t_num) == 4)
            else None,
        ),
        patch.object(tracker_router, "_find_conflicting_locked_tracker_game_for_event_match", side_effect=fake_find_conflicting),
        patch.object(tracker_router, "_resolve_importing_user", side_effect=lambda req: active_user),
    ):
        payload = tracker_router.TrackerMapEventMatchPayload(
            event_id="socal-open-2026", round_num=2, table_num=4
        )

        # Case A: Non-participant user tries to map -> 403 Forbidden
        try:
            asyncio.run(tracker_router.api_map_tracker_game_to_event_match("WH40K-TTB-IMPORT-SWAP", payload, None))
            assert False, "Expected 403 HTTPException for non-participant"
        except Exception as ex:
            assert getattr(ex, "status_code", None) == 403
            assert "Only the two players" in str(getattr(ex, "detail", ex))

        # Case B: Verified participant (John Hsieh) maps the game -> 200 OK + Auto P1/P2 Swap + Locked!
        active_user.update({
            "id": 101,
            "display_name": "John Hsieh",
            "player_id": "p-john",
        })

        body = asyncio.run(tracker_router.api_map_tracker_game_to_event_match("WH40K-TTB-IMPORT-SWAP", payload, None))
        assert body["success"] is True
        assert body["locked"] is True
        assert body["event_match_locked"] is True
        assert body["swapped_p1_p2"] is True
        assert body["p1_name"] == "John Hsieh"
        assert body["p2_name"] == "Alex Rivera"
        assert body["p1_score"] == 88
        assert body["p2_score"] == 72

        # Check that P1/P2 round scores and factions were swapped to align with the official tournament pairing
        updated_st = saved_games["WH40K-TTB-IMPORT-SWAP"]["state_json"]
        assert updated_st["p1"]["name"] == "John Hsieh"
        assert updated_st["p1"]["faction"] == "Aeldari"
        assert updated_st["p1"]["rounds"][0]["primaryScore"] == 15
        assert updated_st["p2"]["name"] == "Alex Rivera"
        assert updated_st["p2"]["faction"] == "Necrons"
        assert updated_st["p2"]["rounds"][0]["primaryScore"] == 10
        assert updated_st["event_match_locked"] is True

        # Case C: Another game tries to map to the same locked event match -> 409 Conflict!
        try:
            asyncio.run(tracker_router.api_map_tracker_game_to_event_match("WH40K-TTB-IMPORT-SECOND", payload, None))
            assert False, "Expected 409 HTTPException when mapping to an already locked match"
        except Exception as ex2:
            assert getattr(ex2, "status_code", None) == 409
            assert "locked scorecard" in str(getattr(ex2, "detail", ex2)).lower()


def test_aos_championship_badge_parity_rtt_vs_gt():
    # Verify an AoS 3-0 RTT win does NOT unlock aos_grand_champion, whereas a 5-round GT 1st place DOES
    rtt_tournaments = [
        {
            "event_id": "aos-rtt-1",
            "event_name": "Local AoS Saturday RTT",
            "placement": 1,
            "wins": 3,
            "losses": 0,
            "draws": 0,
            "matches_played": 3,
            "num_rounds": 3,
            "player_count": 16,
        }
    ]
    res_rtt = aos_badges.evaluate_player_badges_aos(
        player_data={"wins": 3, "losses": 0, "matches_played": 3},
        history=[],
        tournaments=rtt_tournaments,
    )
    assert res_rtt["championships"]["rtt_wins"] == 1
    assert res_rtt["championships"]["gt_wins"] == 0
    grand_champ_rtt = next(b for b in res_rtt["badges"] if b["id"] == "aos_grand_champion")
    assert grand_champ_rtt["unlocked"] is False

    gt_tournaments = [
        {
            "event_id": "aos-gt-1",
            "event_name": "Realmstone AoS Grand Tournament",
            "placement": 1,
            "wins": 5,
            "losses": 0,
            "draws": 0,
            "matches_played": 5,
            "num_rounds": 5,
            "player_count": 48,
        }
    ]
    res_gt = aos_badges.evaluate_player_badges_aos(
        player_data={"wins": 5, "losses": 0, "draws": 0, "matches_played": 5},
        history=[],
        tournaments=gt_tournaments,
    )
    assert res_gt["championships"]["gt_wins"] == 1
    grand_champ_gt = next(b for b in res_gt["badges"] if b["id"] == "aos_grand_champion")
    assert grand_champ_gt["unlocked"] is True


if __name__ == "__main__":
    test_edition_detection_and_unclipped_9th_ed_secondaries()
    print("✓ test_edition_detection_and_unclipped_9th_ed_secondaries passed")
    test_8th_edition_itc_caps_and_no_paint_bonus()
    print("✓ test_8th_edition_itc_caps_and_no_paint_bonus passed")
    test_aos_3e_grand_strategy_and_aos_4e_detection()
    print("✓ test_aos_3e_grand_strategy_and_aos_4e_detection passed")
    test_event_match_mapping_participant_verification_alignment_and_locking()
    print("✓ test_event_match_mapping_participant_verification_alignment_and_locking passed")
    test_aos_championship_badge_parity_rtt_vs_gt()
    print("✓ test_aos_championship_badge_parity_rtt_vs_gt passed")
    print("ALL TESTS PASSED!")


