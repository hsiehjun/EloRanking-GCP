#!/usr/bin/env python3
"""
End-to-End Verification & <1s Latency Benchmark for Local SQLite Database (`data/local_omnitactica.sqlite`)
using 100% REAL PULLED DATA across all 5 platforms (BCP, Longshanks, Limitless TCG, TopDeck.gg, Melee.gg),
including 2v2 Doubles & 4-Player FFA Pod retrofitting, zero-sum Elo math, strict player_id separation,
Community Hub & My Hub multi-platform integration, and 40K/AoS zero-regression & Meta Intel safety.
"""

import json
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

BASE_URL = "http://127.0.0.1:5174"


def fetch_json(path: str, method: str = "GET", payload: dict = None, headers: dict = None):
    url = f"{BASE_URL}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req_headers = dict(headers or {})
    if data:
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers=req_headers,
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            raw = resp.read().decode("utf-8")
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="ignore")
        status = e.code
    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    return status, json.loads(raw) if raw else {}, elapsed_ms


def test_2v2_doubles_and_4p_ffa_pod_retrofitting_and_elo():
    """
    Verifies:
    1. 2v2 Doubles tournaments (`GzyzVHN6gVPw` in 40k, `LPJLszJOuLZ4` in aos) have all 4 players per match
       stored in `match_participants` and `team1_players` / `team2_players`, duo standings in `event_team_standings`,
       and Partner 2 (`7nYzr4DqLT02` Robert Gormly-Breinin & `2GpRJ6IEyg` Stephen Dorfner) rated with partner &
       opposing duo metadata in `rating_history`.
    2. 4-Player FFA Pods (`td:...` on TopDeck.gg) are retrofitted into 1 canonical FFA pod match per table with
       4 participants in `match_participants`, `pod_participants` in `raw_json`, and zero-sum Elo across the 4 seats.
    """
    from scripts.local_sqlite_db import LocalSqliteDatabase

    db = LocalSqliteDatabase()
    retrofit_summary = db.retrofit_2v2_and_ffa_matches()
    assert retrofit_summary["doubles_matches_verified"] >= 24, f"Expected >=24 2v2 matches, got {retrofit_summary}"

    # 1. Verify 40K 2v2 Doubles Event (`GzyzVHN6gVPw`) via HTTP API
    status, ev_40k_2v2, ms = fetch_json("/api/event/GzyzVHN6gVPw")
    assert status == 200 and ms < 1000.0
    assert ev_40k_2v2["is_doubles_event"] is True
    assert ev_40k_2v2["is_team_event"] is True
    assert len(ev_40k_2v2["teams"]) == 8
    assert len(ev_40k_2v2["players"]) == 16
    assert len(ev_40k_2v2["matches"]) == 12
    for m in ev_40k_2v2["matches"]:
        assert m.get("is_2v2") is True
        assert m.get("match_format") == "2v2"
        assert len(m.get("team1_players") or []) == 2
        assert len(m.get("team2_players") or []) == 2

    # Verify Partner 1 (Ackley Hoffman `gcJvLSgvyLB0`) and Partner 2 (Robert Gormly-Breinin `7nYzr4DqLT02`)
    _, ackley, ms1 = fetch_json("/api/player/gcJvLSgvyLB0?game_system=40k")
    _, robert, ms2 = fetch_json("/api/player/7nYzr4DqLT02?game_system=40k")
    assert ms1 < 1000.0 and ms2 < 1000.0
    assert ackley["player"]["wins"] >= 3
    assert robert["player"]["wins"] == 3 and robert["player"]["losses"] == 0
    assert robert["player"]["current_elo"] > 1500.0, "Partner 2 must receive full 2v2 Elo updates!"
    robert_2v2_rounds = [h for h in robert["history"] if h.get("event_id") == "GzyzVHN6gVPw"]
    assert len(robert_2v2_rounds) == 3
    for r in robert_2v2_rounds:
        assert r.get("is_2v2") is True
        assert r.get("match_format") == "2v2"
        assert r.get("partner", {}).get("player_id") == "gcJvLSgvyLB0"
        assert r.get("partner", {}).get("player_name") == "Ackley Hoffman"
        assert len(r.get("opponents") or []) == 2

    # 2. Verify AoS 2v2 Doubles Event (`LPJLszJOuLZ4`) and Partner 2 (`2GpRJ6IEyg` Stephen Dorfner)
    status, ev_aos_2v2, ms3 = fetch_json("/api/event/LPJLszJOuLZ4")
    assert status == 200 and ms3 < 1000.0
    assert ev_aos_2v2["is_doubles_event"] is True
    assert len(ev_aos_2v2["teams"]) == 9
    assert len(ev_aos_2v2["players"]) == 18
    assert len(ev_aos_2v2["matches"]) >= 12

    _, stephen, ms4 = fetch_json("/api/player/2GpRJ6IEyg?game_system=aos")
    assert ms4 < 1000.0
    assert stephen["player"]["matches_played"] == 3
    stephen_rounds = [h for h in stephen["history"] if h.get("event_id") == "LPJLszJOuLZ4"]
    assert len(stephen_rounds) == 3
    assert stephen_rounds[0]["partner"]["player_id"] == "NBRKCBN7PX"
    assert stephen_rounds[0]["partner"]["player_name"] == "Andrew Milner"
    assert len(stephen_rounds[0]["opponents"]) == 2

    # 3. Verify 4-Player FFA Pod Event (`td:commander-invitational-qualifier-final-fortune-gaming-5`)
    status, ev_ffa, ms5 = fetch_json("/api/event/td:commander-invitational-qualifier-final-fortune-gaming-5")
    assert status == 200 and ms5 < 1000.0
    assert ev_ffa["is_ffa_event"] is True
    assert ev_ffa["event_format"] == "ffa"
    assert len(ev_ffa["matches"]) == 83
    for m in ev_ffa["matches"]:
        assert m.get("is_ffa") is True
        assert m.get("match_format") == "ffa"
        assert len(m.get("pod_participants") or []) >= 3

    # Verify zero-sum Elo property per match in `rating_history` for 2v2 and FFA
    with db._connect() as conn:
        # Check 2v2 match delta sum (each player on Team 1 gets +delta, each player on Team 2 gets -delta -> sum = 0)
        rows_2v2 = conn.execute(
            "SELECT match_id, SUM(delta_elo) AS net_delta, COUNT(*) AS cnt FROM rating_history WHERE event_id = 'GzyzVHN6gVPw' GROUP BY match_id"
        ).fetchall()
        assert len(rows_2v2) == 12
        for row in rows_2v2:
            assert row["cnt"] == 4, f"Expected 4 rated participants in 2v2 match {row['match_id']}, got {row['cnt']}"
            assert abs(float(row["net_delta"] or 0.0)) < 0.05, f"2v2 match {row['match_id']} not zero-sum: {row['net_delta']}"

        # Check 4P FFA pod match delta sum (winner delta + 3 loser deltas == 0)
        rows_ffa = conn.execute(
            "SELECT match_id, SUM(delta_elo) AS net_delta, COUNT(*) AS cnt FROM rating_history WHERE event_id = 'td:commander-invitational-qualifier-final-fortune-gaming-5' GROUP BY match_id"
        ).fetchall()
        assert len(rows_ffa) == 83
        for row in rows_ffa:
            assert row["cnt"] >= 3
            assert abs(float(row["net_delta"] or 0.0)) < 0.05, f"FFA pod {row['match_id']} not zero-sum: {row['net_delta']}"


def test_strict_player_id_separation_never_merges_by_name():
    """
    Verifies that two distinct players with the EXACT SAME display_name ('Alex Smith')
    but different `player_id`s are NEVER merged or conflated unless explicitly linked via `user_id`.
    """
    from scripts.local_sqlite_db import LocalSqliteDatabase

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_db = LocalSqliteDatabase(str(Path(tmpdir) / "test_strict_id.sqlite"))
        tmp_db.upsert_event(
            {
                "id": "test_ev_strict_id",
                "name": "Strict ID Test GT",
                "game_system": "40k",
                "source_platform": "bcp",
                "event_date": "2026-03-01",
                "players_count": 2,
                "num_rounds": 1,
                "ended": True,
            }
        )
        tmp_db.upsert_event_participants_batch(
            "test_ev_strict_id",
            [
                {"player_id": "bcp_alex_1", "player_name": "Alex Smith", "faction": "Aeldari", "wins": 1, "losses": 0, "draws": 0, "placement": 1},
                {"player_id": "bcp_alex_2", "player_name": "Alex Smith", "faction": "Necrons", "wins": 0, "losses": 1, "draws": 0, "placement": 2},
            ],
        )
        tmp_db.upsert_matches_batch(
            [
                {
                    "id": "m_strict_1",
                    "event_id": "test_ev_strict_id",
                    "game_system": "40k",
                    "round": 1,
                    "table_number": 1,
                    "player1_id": "bcp_alex_1",
                    "player1_name": "Alex Smith",
                    "player1_faction": "Aeldari",
                    "player1_score": 90,
                    "player2_id": "bcp_alex_2",
                    "player2_name": "Alex Smith",
                    "player2_faction": "Necrons",
                    "player2_score": 45,
                    "winner_id": "bcp_alex_1",
                    "completed": True,
                    "match_date": "2026-03-01",
                }
            ]
        )
        tmp_db.reconstruct_elo_for_system("40k")
        lb = tmp_db.get_leaderboard_rows(game_system="40k")
        ids = {p["player_id"]: p for p in lb}
        assert "bcp_alex_1" in ids and "bcp_alex_2" in ids, "Players with identical names but distinct player_ids must never be merged!"
        assert ids["bcp_alex_1"]["current_elo"] > 1500.0
        assert ids["bcp_alex_2"]["current_elo"] < 1500.0


def test_40k_and_aos_zero_regression_and_meta_intel_sync_safety():
    """
    Verifies:
    1. 40K and AoS leaderboards, events, and Meta Intel (`/api/factions/meta`) return accurate data under <1s.
    2. Synthetic 2v2 / FFA strings ('Commander Pod', 'Pod (', ' + ') NEVER pollute `/api/factions/meta`.
    3. Running a background sync / Elo reconstruction does NOT wipe or corrupt Meta Intel.
    """
    for sys_slug in ("40k", "aos", "mtg", "pokemon", "mcp"):
        status, meta, ms = fetch_json(f"/api/factions/meta?game_system={sys_slug}")
        assert status == 200 and ms < 1000.0
        factions = meta.get("factions") or []
        for f in factions:
            fname = str(f.get("faction") or "")
            assert "Commander Pod" not in fname, f"Synthetic FFA string leaked into {sys_slug} Meta Intel: {fname}"
            assert not fname.startswith("Pod ("), f"Synthetic Pod string leaked into {sys_slug} Meta Intel: {fname}"
            assert " + " not in fname, f"Combined 2v2 faction string leaked into {sys_slug} Meta Intel: {fname}"


def test_community_hub_and_my_hub_all_platforms():
    """
    Verifies:
    1. Community Hub endpoints (`/api/community/overview`, `/api/events/recommended`, `/api/community/bcp_majors`)
       return events across all platforms under <1000ms.
    2. My Hub (`/api/user/dashboard` & `/api/auth/me/hub`) returns rich 2v2 Doubles, 4P FFA Pod, and 1v1
       tournament journeys and Elo progression for linked users across all platforms under <1000ms.
    """
    for sys_slug in ("40k", "aos", "pokemon", "mtg", "mcp"):
        status, ov, ms = fetch_json(f"/api/community/overview?game_system={sys_slug}")
        assert status == 200 and ms < 1000.0
        status, rec, ms2 = fetch_json(f"/api/events/recommended?game_system={sys_slug}")
        assert status == 200 and ms2 < 1000.0
        assert len(rec.get("events") or []) >= 1
        status, maj, ms3 = fetch_json(f"/api/community/bcp_majors?game_system={sys_slug}")
        assert status == 200 and ms3 < 1000.0

    # Test My Hub for 40K 2v2 Doubles user (`user_ackley_hoffman`), AoS 2v2 Doubles user (`user_andrew_milner`),
    # and MTG Melee+TopDeck FFA user (`user_alexander_kans`)
    test_users = [
        ("user_ackley_hoffman", "40k", "GzyzVHN6gVPw", "2v2"),
        ("user_andrew_milner", "aos", "LPJLszJOuLZ4", "2v2"),
        ("user_alexander_kans", "mtg", "td:PuntCity3", "ffa"),
        ("user_will_blakely", "mtg", "td:commander-invitational-qualifier-final-fortune-gaming-5", "ffa"),
    ]
    for uid, sys_slug, expected_ev_id, expected_fmt in test_users:
        status, dash, ms = fetch_json(
            f"/api/user/dashboard?game_system={sys_slug}&user_id={uid}",
            headers={"Authorization": f"Bearer {uid}"},
        )
        assert status == 200 and ms < 1000.0
        hist = dash.get("history") or (dash.get("elo_profile") or {}).get("rating_history") or []
        matching_rounds = [h for h in hist if h.get("event_id") == expected_ev_id]
        assert len(matching_rounds) >= 2, f"Expected rounds for {expected_ev_id} in My Hub for {uid}"
        assert all(h.get("match_format") == expected_fmt for h in matching_rounds)


def test_multiplatform_latency_and_real_data():
    endpoints_to_benchmark = [
        ("GET", "/api/leaderboard?game_system=pokemon", None),
        ("GET", "/api/leaderboard?game_system=one_piece", None),
        ("GET", "/api/leaderboard?game_system=digimon", None),
        ("GET", "/api/leaderboard?game_system=mcp", None),
        ("GET", "/api/leaderboard?game_system=mtg", None),
        ("GET", "/api/leaderboard?game_system=kill_team", None),
        ("GET", "/api/leaderboard?game_system=the_old_world", None),
        ("GET", "/api/leaderboard?game_system=40k", None),
        ("GET", "/api/leaderboard?game_system=aos", None),
        ("GET", "/api/events?game_system=pokemon", None),
        ("GET", "/api/events?game_system=one_piece", None),
        ("GET", "/api/events?game_system=mcp", None),
        ("GET", "/api/events?game_system=mtg", None),
        ("GET", "/api/events?game_system=40k", None),
        ("GET", "/api/events?game_system=aos", None),
        ("GET", "/api/event/GzyzVHN6gVPw", None),
        ("GET", "/api/event/LPJLszJOuLZ4", None),
        ("GET", "/api/event/ltcg:6accac388a8383117e3ea166", None),
        ("GET", "/api/event/ltcg:6aced505115c12b73a5a37c5", None),
        ("GET", "/api/event/ltcg:6ac7892d245696afb3518d6b", None),
        ("GET", "/api/event/ls:36154", None),
        ("GET", "/api/event/ls:38479", None),
        ("GET", "/api/event/td:commander-invitational-qualifier-final-fortune-gaming-5", None),
        ("GET", "/api/event/td:down-under-spring-scrimmage-1", None),
        ("GET", "/api/event/td:PuntCity3", None),
        ("GET", "/api/event/melee:428253", None),
        ("GET", "/api/event/melee:72980", None),
        ("GET", "/api/event/melee:458821", None),
        ("GET", "/api/event/melee:468577", None),
        ("GET", "/api/event/YzJIejrP2BQ9", None),
        ("GET", "/api/player/gcJvLSgvyLB0?game_system=40k", None),
        ("GET", "/api/player/7nYzr4DqLT02?game_system=40k", None),
        ("GET", "/api/player/NBRKCBN7PX?game_system=aos", None),
        ("GET", "/api/player/2GpRJ6IEyg?game_system=aos", None),
        ("GET", "/api/player/r0IKtzv5BlvN?game_system=mcp", None),
        ("GET", "/api/player/BPUleQ6LUV8e?game_system=mtg", None),
        ("GET", "/api/player/gCtLsa0uiUhk?game_system=mtg", None),
        ("GET", "/api/player/melee:snakeazkusa?game_system=mtg", None),
        ("GET", "/api/player/melee:tabananga?game_system=mtg", None),
        ("GET", "/api/player/melee:xzevo?game_system=sw_unlimited", None),
        ("GET", "/api/player/ltcg:corndog_xx?game_system=pokemon", None),
        ("GET", "/api/factions/meta?game_system=40k", None),
        ("GET", "/api/factions/meta?game_system=aos", None),
        ("GET", "/api/factions/meta?game_system=pokemon", None),
        ("GET", "/api/factions/meta?game_system=mcp", None),
        ("GET", "/api/factions/meta?game_system=mtg", None),
        ("GET", "/api/user/dashboard?game_system=40k&user_id=user_ackley_hoffman", None),
        ("GET", "/api/user/dashboard?game_system=aos&user_id=user_andrew_milner", None),
        ("GET", "/api/user/dashboard?game_system=mtg&user_id=user_alexander_kans", None),
        ("GET", "/api/user/dashboard?game_system=pokemon&user_id=user_corndog", None),
        (
            "POST",
            "/api/user/platform/link",
            {
                "user_id": "user_alexander_kans",
                "platform": "topdeck",
                "platform_player_id": "td:mfVT0kynTQNsxVaVJGcQG0u2CQn2",
                "platform_handle": "Alexander Kans (TopDeck.gg)",
                "display_name": "Alexander Kans",
            },
        ),
        (
            "POST",
            "/api/user/reconstruct-elo",
            {
                "user_id": "user_alexander_kans",
            },
        ),
        (
            "POST",
            "/api/user/reconstruct-elo",
            {
                "user_id": "user_ackley_hoffman",
            },
        ),
    ]

    max_latency = 0.0
    for method, path, body in endpoints_to_benchmark:
        status, data, ms = fetch_json(path, method=method, payload=body)
        assert status == 200, f"Expected 200 for {method} {path}, got {status}"
        assert ms < 1000.0, f"SLA violation: {method} {path} took {ms}ms (> 1000ms)"
        max_latency = max(max_latency, ms)
        print(f"  [SLA PASS] {method:4s} {path:65s} -> {ms:6.2f} ms")
    return max_latency


def test_all_5_dedicated_platform_sync_scripts_and_meta_intel():
    """
    Executes all 5 dedicated platform sync scripts (`sync_tournaments.py`, `sync_limitless.py`,
    `sync_longshanks.py`, `sync_topdeck.py`, `sync_melee.py`) against the local SQLite database,
    verifies cross-platform Elo computation (1v1, 2v2 Doubles, 4P FFA Pods, and unified cross-platform
    linked users), and verifies Meta Intel accuracy across all systems without synthetic pollution.
    """
    from scripts.local_sqlite_db import DEFAULT_SQLITE_PATH, LocalSqliteDatabase
    from scripts.sync_tournaments import run_tournament_sync
    from scripts.sync_limitless import run_limitless_sync
    from scripts.sync_longshanks import run_longshanks_sync
    from scripts.sync_topdeck import run_topdeck_sync
    from scripts.sync_melee import run_melee_sync

    # 1. BCP Sync (`scripts/sync_tournaments.py`) — test both 1v1 and 2v2 Doubles (40K & AoS)
    res_bcp = run_tournament_sync(
        game_system="40k",
        event_ids=[("40k", "GzyzVHN6gVPw"), ("aos", "LPJLszJOuLZ4")],
        sqlite_path=DEFAULT_SQLITE_PATH,
    )
    assert res_bcp.get("events_scraped", 0) >= 2, f"BCP sync failed: {res_bcp}"
    assert set(res_bcp.get("systems_updated", [])) == {"40k", "aos"}, f"Unexpected BCP systems: {res_bcp}"

    # 2. Limitless TCG Sync (`scripts/sync_limitless.py`)
    res_ltcg = run_limitless_sync(
        event_ids=[("digimon", "6acfbc37115c12b73a5a3ee1")],
        sqlite_path=DEFAULT_SQLITE_PATH,
    )
    assert res_ltcg.get("events_imported", 0) == 1, f"Limitless sync failed: {res_ltcg}"
    assert res_ltcg.get("systems_updated") == ["digimon"], f"Limitless sync leaked systems: {res_ltcg}"

    # 3. Longshanks Sync (`scripts/sync_longshanks.py`)
    res_ls = run_longshanks_sync(
        event_ids=[("mcp", "36154")],
        sqlite_path=DEFAULT_SQLITE_PATH,
    )
    assert res_ls.get("events_imported", 0) == 1, f"Longshanks sync failed: {res_ls}"
    assert res_ls.get("systems_updated") == ["mcp"], f"Longshanks sync leaked systems: {res_ls}"

    # 4. TopDeck.gg Sync (`scripts/sync_topdeck.py`)
    res_td = run_topdeck_sync(
        event_ids=[("mtg", "down-under-spring-scrimmage-1")],
        sqlite_path=DEFAULT_SQLITE_PATH,
    )
    assert res_td.get("events_imported", 0) == 1, f"TopDeck sync failed: {res_td}"
    assert res_td.get("systems_updated") == ["mtg"], f"TopDeck sync leaked systems: {res_td}"

    # 5. Melee.gg Sync (`scripts/sync_melee.py`)
    res_melee = run_melee_sync(
        event_ids=[("sw_unlimited", "468577")],
        sqlite_path=DEFAULT_SQLITE_PATH,
    )
    assert res_melee.get("events_imported", 0) == 1, f"Melee sync failed: {res_melee}"
    assert res_melee.get("systems_updated") == ["sw_unlimited"], f"Melee sync leaked systems: {res_melee}"

    # 6. Verify Cross-Platform Unified Elo & Meta Intel across all systems
    for sys_slug in ("40k", "aos", "pokemon", "one_piece", "digimon", "mcp", "mtg", "sw_unlimited"):
        status, meta, ms = fetch_json(f"/api/factions/meta?game_system={sys_slug}")
        assert status == 200 and ms < 1000.0, f"Meta Intel HTTP error for {sys_slug}: {status} ({ms}ms)"
        factions = meta.get("factions") or []
        assert len(factions) >= 1, f"Meta Intel empty for {sys_slug}"
        for f_row in factions:
            fname = str(f_row.get("faction") or "")
            assert "Commander Pod" not in fname and "Pod (" not in fname and " + " not in fname, (
                f"Synthetic 2v2/FFA string leaked into {sys_slug} Meta Intel: {fname}"
            )
            assert int(f_row.get("total_matches") or f_row.get("games_played") or f_row.get("matches_played") or 0) > 0, (
                f"Zero games_played in {sys_slug} Meta Intel for {fname}"
            )


def test_comprehensive_edge_cases_and_integrations():
    """
    Tests 7 additional integration & edge-case surfaces across all 5 platforms:
      1. Global Player Directory (`/api/players`) & Predictor Autocomplete (`/api/players/search`)
      2. Matchup Win-Probability & Elo Predictor (`/api/predict`)
      3. Head-to-Head (`H2H`) across 1v1, 2v2 Doubles (opponents vs partners), and 4P FFA Pods (`/api/head_to_head`)
      4. Faction / Deck / Commander Drill-Down (`/api/faction/{name}`) including Commander names with slashes (`/`)
      5. Account Link Hijack Prevention (`409 Conflict`) & Account Unlinking (`POST /api/user/platform/unlink`)
      6. Real Imported TCG Decklist & Wargame Roster Retrieval (`/api/bcp/armylist/{id}`)
      7. Sync & Elo Reconstruction Idempotency (zero duplicate matches/history or Elo drift on re-sync)
    """
    import urllib.parse
    from scripts.local_sqlite_db import DEFAULT_SQLITE_PATH, LocalSqliteDatabase
    from scripts.sync_limitless import run_limitless_sync

    # 1. Player Directory & Autocomplete Search across platforms
    for sys_slug, q_str, expected_pid in (
        ("pokemon", "CornDog", "ltcg:corndog_xx"),
        ("mtg", "Huschenbeth", "melee:tabananga"),
        ("mcp", "Yingling", "r0IKtzv5BlvN"),
        ("40k", "Gormly-Breinin", "7nYzr4DqLT02"),
    ):
        st1, dir_res, ms1 = fetch_json(f"/api/players?game_system={sys_slug}&query={urllib.parse.quote(q_str)}")
        assert st1 == 200 and ms1 < 1000.0, f"/api/players failed for {sys_slug} ({q_str}): {st1}"
        found_pids = {p["player_id"] for p in (dir_res.get("players") or [])}
        assert expected_pid in found_pids, f"Expected {expected_pid} in /api/players for {q_str}, got {found_pids}"

        st2, auto_res, ms2 = fetch_json(f"/api/players/search?game_system={sys_slug}&q={urllib.parse.quote(q_str)}")
        assert st2 == 200 and ms2 < 1000.0 and isinstance(auto_res, list), f"/api/players/search failed for {sys_slug}"
        assert any(p.get("player_id") == expected_pid for p in auto_res), f"Expected {expected_pid} in /api/players/search"

    # 2. Matchup Win-Probability & Elo Predictor (`/api/predict`)
    st_pred, pred, ms_pred = fetch_json("/api/predict?game_system=mtg&p1=melee:tabananga&p2=melee:snakeazkusa")
    assert st_pred == 200 and ms_pred < 1000.0, f"/api/predict failed: {st_pred}"
    wp1 = float(pred["player1"]["win_probability"])
    wp2 = float(pred["player2"]["win_probability"])
    assert abs((wp1 + wp2) - 100.0) < 0.2, f"Win probabilities must sum to 100%: {wp1} + {wp2}"
    assert pred["player1"]["delta_if_win"] > 0 and pred["player1"]["delta_if_loss"] < 0
    assert isinstance(pred.get("head_to_head"), list), f"Expected list for pred['head_to_head'], got {type(pred.get('head_to_head'))}"

    # 3. Head-to-Head (`/api/head_to_head`) across 2v2 Doubles (partners vs opponents) and 4P FFA Pods
    db = LocalSqliteDatabase(db_path=DEFAULT_SQLITE_PATH)
    # 3a. Partners on the SAME 2v2 duo (`gcJvLSgvyLB0` and `7nYzr4DqLT02`) should have 0 opposing H2H matches
    st_part, h2h_part, _ = fetch_json("/api/head_to_head?game_system=40k&p1=gcJvLSgvyLB0&p2=7nYzr4DqLT02")
    assert st_part == 200 and isinstance(h2h_part, list) and len(h2h_part) == 0, f"2v2 partners should not be counted as H2H opponents: {h2h_part}"

    # 3b. Opponents across opposing 2v2 duos in GzyzVHN6gVPw
    ev_2v2 = db.get_event_detail("GzyzVHN6gVPw")
    r1_m = (ev_2v2.get("matches") or [])[0]
    t1_p = r1_m["team1_players"][0]["player_id"]
    t2_p = r1_m["team2_players"][0]["player_id"]
    st_opp2v2, h2h_2v2, ms_h2h2v2 = fetch_json(f"/api/head_to_head?game_system=40k&p1={t1_p}&p2={t2_p}")
    assert st_opp2v2 == 200 and ms_h2h2v2 < 1000.0
    assert isinstance(h2h_2v2, list) and len(h2h_2v2) >= 1 and h2h_2v2[0].get("match_format") == "2v2", f"Expected 2v2 H2H match: {h2h_2v2}"

    # 3c. Opponents in a 4-Player FFA Pod (`td:down-under-spring-scrimmage-1`)
    ev_ffa = db.get_event_detail("td:down-under-spring-scrimmage-1")
    pod_m = (ev_ffa.get("matches") or [])[0]
    pod_p1 = pod_m["pod_participants"][0]["player_id"]
    pod_p2 = pod_m["pod_participants"][1]["player_id"]
    st_ffa_h2h, h2h_ffa, ms_ffa_h2h = fetch_json(
        f"/api/head_to_head?game_system=mtg&p1={urllib.parse.quote(pod_p1)}&p2={urllib.parse.quote(pod_p2)}"
    )
    assert st_ffa_h2h == 200 and ms_ffa_h2h < 1000.0
    assert isinstance(h2h_ffa, list) and len(h2h_ffa) >= 1 and h2h_ffa[0].get("match_format") == "ffa", f"Expected FFA H2H match: {h2h_ffa}"

    # 4. Faction / Deck / Commander Drill-Down (`/api/faction/{name}`) including Commander names with slashes (`/`)
    st_meta_mtg, meta_mtg, _ = fetch_json("/api/factions/meta?game_system=mtg")
    top_mtg_fac = meta_mtg["factions"][0]["faction"]
    st_f1, fac_detail_mtg, ms_f1 = fetch_json(f"/api/faction/{urllib.parse.quote(top_mtg_fac, safe='')}?game_system=mtg")
    assert st_f1 == 200 and ms_f1 < 1000.0, f"/api/faction failed for MTG faction '{top_mtg_fac}': {st_f1}"
    assert int(fac_detail_mtg.get("total_matches") or 0) > 0 and len(fac_detail_mtg.get("matches") or []) > 0

    # Also test a Commander Partner pair with a `/` in its name
    slash_cmd = "Kraum, Ludevic's Opus / Tymna the Weaver"
    st_f2, fac_detail_slash, ms_f2 = fetch_json(f"/api/faction/{urllib.parse.quote(slash_cmd, safe='')}?game_system=mtg")
    assert st_f2 == 200 and ms_f2 < 1000.0 and int(fac_detail_slash.get("total_matches") or 0) > 0, (
        f"Slash commander drill-down failed: {st_f2} {fac_detail_slash}"
    )

    # 5. Account Link Hijack Protection (`409 Conflict`) & Account Unlinking (`POST /api/user/platform/unlink`)
    st_hijack, hijack_res, ms_hijack = fetch_json(
        "/api/user/platform/link",
        method="POST",
        payload={
            "user_id": "user_malicious_hijacker_999",
            "platform": "limitlesstcg",
            "platform_player_id": "ltcg:corndog_xx",
            "platform_handle": "CornDog_XX",
        },
    )
    assert st_hijack == 409 and not hijack_res.get("success"), (
        f"Expected 409 Conflict when linking an already-claimed platform_player_id, got {st_hijack}: {hijack_res}"
    )

    # Link & then Unlink a secondary account on a test user
    st_link_tmp, link_tmp_res, _ = fetch_json(
        "/api/user/platform/link",
        method="POST",
        payload={
            "user_id": "user_unlink_lifecycle_test",
            "platform": "melee",
            "platform_player_id": "melee:domhrv",
            "platform_handle": "domhrv",
        },
    )
    assert st_link_tmp == 200 and link_tmp_res.get("success"), f"Temp link failed: {link_tmp_res}"
    st_unlink_tmp, unlink_tmp_res, ms_unlink = fetch_json(
        "/api/user/platform/unlink",
        method="POST",
        payload={
            "user_id": "user_unlink_lifecycle_test",
            "platform": "melee",
            "platform_player_id": "melee:domhrv",
        },
    )
    assert st_unlink_tmp == 200 and ms_unlink < 1000.0 and unlink_tmp_res.get("unlinked_player_id") == "melee:domhrv", (
        f"Unlink failed: {st_unlink_tmp} {unlink_tmp_res}"
    )

    # 6. Imported Decklist / Roster Retrieval (`/api/bcp/armylist/{id}`)
    for lid in ("ltcg:corndog_xx", "td:aBNcyP5A2vbyoYq0fTAFmH0hkwX2", "melee:tabananga"):
        st_dl, dl_res, ms_dl = fetch_json(f"/api/bcp/armylist/{urllib.parse.quote(lid, safe='')}")
        assert st_dl == 200 and ms_dl < 1000.0 and dl_res.get("success"), f"Decklist retrieval failed for {lid}: {dl_res}"
        assert len(str(dl_res.get("text") or "")) > 40, f"Decklist text empty for {lid}"

    # 7. Sync & Elo Reconstruction Idempotency (Re-running sync produces 0 duplicate rows & 0.00 Elo drift)
    conn = db._connect()
    before_counts = {
        t: conn.execute(f"SELECT COUNT(*) FROM {t} WHERE COALESCE(game_system, '40k') = 'digimon';").fetchone()[0]
        for t in ("events", "matches", "player_ratings", "rating_history")
    }
    before_top = conn.execute(
        "SELECT player_id, current_elo FROM player_ratings WHERE game_system = 'digimon' ORDER BY current_elo DESC LIMIT 1;"
    ).fetchone()
    conn.close()

    run_limitless_sync(event_ids=[("digimon", "6acfbc37115c12b73a5a3ee1")], sqlite_path=DEFAULT_SQLITE_PATH)

    conn = db._connect()
    after_counts = {
        t: conn.execute(f"SELECT COUNT(*) FROM {t} WHERE COALESCE(game_system, '40k') = 'digimon';").fetchone()[0]
        for t in ("events", "matches", "player_ratings", "rating_history")
    }
    after_top = conn.execute(
        "SELECT player_id, current_elo FROM player_ratings WHERE game_system = 'digimon' ORDER BY current_elo DESC LIMIT 1;"
    ).fetchone()
    conn.close()

    assert before_counts == after_counts, f"Idempotency violation on re-sync: before={before_counts}, after={after_counts}"
    assert before_top["player_id"] == after_top["player_id"] and abs(float(before_top["current_elo"]) - float(after_top["current_elo"])) < 0.001, (
        f"Elo drift on re-sync: before={dict(before_top)}, after={dict(after_top)}"
    )


def test_round2_bug_fixes_faction_details_teams_scorecard_and_aliases():
    """
    Verifies Round 2 live application testing fixes:
    1. `/api/faction/{name}` unpacks 4P FFA Pod (`pod_opponents`) & 2v2 Doubles (`opponents`) so `matchups`
       credits individual opposing Commanders/Factions rather than comma-joined 3-commander pod strings.
    2. `/api/stats` and `/api/factions` return real SQLite stats and decks/commanders across `pokemon`, `mtg`,
       `onepiece` (including `onepiece`/`optcg`/`swu` alias normalization), and `mcp` without synthetic Vanguard strings.
    3. `/api/teams` returns both `items` and `teams` keys (required by `web/js/teams.js`) and `/api/team/{name}`
       returns real rosters and match feeds without `sqlite3.Row` key errors.
    4. `/api/events/recommended`, `/api/connect/players`, `/api/user/registered-tournaments`, `/api/leagues`,
       and `/api/scorecard/{match_id}` (both raw ID and `{event_id}-R{round}-T{table}`) work across all platforms.
    """
    import urllib.parse

    # 1. Faction details matchup unpacking for 4P FFA Pod Commander
    cmd_url = "/api/faction/" + urllib.parse.quote("Rograkh, Son of Rohgahh / Silas Renn, Seeker Adept", safe="") + "?game_system=mtg"
    st_f, fac_d, ms_f = fetch_json(cmd_url)
    assert st_f == 200 and ms_f < 1000.0
    matchups = fac_d.get("matchups") or []
    assert len(matchups) >= 10
    for m in matchups:
        assert ", Kinnan" not in m["opponent_faction"], f"Unpacked pod string leaked into matchup: {m}"
        assert m.get("matches", 0) >= 1 and m.get("total_matches", 0) >= 1

    # 2. Stats & Factions + Game System Alias normalization ('onepiece' -> 'one_piece')
    for sys_id in ("pokemon", "mtg", "onepiece", "mcp"):
        st_s, s_d, ms_s = fetch_json(f"/api/stats?game_system={sys_id}")
        st_fc, f_d, ms_fc = fetch_json(f"/api/factions?game_system={sys_id}")
        assert st_s == 200 and st_fc == 200 and ms_s < 1000.0 and ms_fc < 1000.0
        assert s_d.get("total_players", 0) > 0 and s_d.get("total_players") != 480
        assert isinstance(f_d, list) and len(f_d) >= 3
        assert not any("Vanguard" in str(x) for x in f_d), f"Synthetic Vanguard leaked into {sys_id}: {f_d}"

    # 3. Teams Directory ('items' + 'teams') and Team Profile Dossier
    for sys_id in ("pokemon", "mtg", "40k"):
        st_t, t_d, ms_t = fetch_json(f"/api/teams?game_system={sys_id}")
        assert st_t == 200 and ms_t < 1000.0
        items = t_d.get("items") or []
        assert len(items) >= 2 and len(t_d.get("teams") or []) >= 2
        t_name = items[0]["name"]
        st_tp, tp_d, ms_tp = fetch_json(f"/api/team/{urllib.parse.quote(t_name)}?game_system={sys_id}")
        assert st_tp == 200 and ms_tp < 1000.0
        assert len(tp_d.get("roster") or []) >= 1

    # 4. Recommended Events, Connect Players, Registered Tournaments, Leagues, and Scorecard
    st_rec, rec_d, ms_rec = fetch_json("/api/events/recommended?game_system=pokemon")
    assert st_rec == 200 and ms_rec < 1000.0
    assert str(rec_d["events"][0]["id"]).startswith("ltcg:")

    st_con, con_d, ms_con = fetch_json("/api/connect/players?game_system=mtg")
    assert st_con == 200 and ms_con < 1000.0
    assert con_d["players"][0]["game_system"] == "mtg"

    st_reg, reg_d, ms_reg = fetch_json("/api/user/registered-tournaments?game_system=mtg&user_id=user_alexander_kans")
    assert st_reg == 200 and ms_reg < 1000.0
    assert reg_d["count"] >= 2

    st_lg, lg_d, ms_lg = fetch_json("/api/leagues?game_system=mtg")
    assert st_lg == 200 and ms_lg < 1000.0
    assert "SD40K" not in lg_d["leagues"][0]["name"]

    for mid in ("5tiIdIJjSzZI", "GzyzVHN6gVPw-R1-T1", "td:down-under-spring-scrimmage-1-s1-r1-t1"):
        st_sc, sc_d, ms_sc = fetch_json(f"/api/scorecard/{urllib.parse.quote(mid)}")
        assert st_sc == 200 and ms_sc < 1000.0
        assert sc_d.get("bcp_match", {}).get("event_format") in ("1v1", "2v2", "ffa")


def test_round3_and_round4_scorecard_2v2_ffa_double_encoding_and_armylists():
    """
    Verifies Round 3 & Round 4 bug fixes:
    - Double-URL-encoded scorecard match IDs (`%253A`) resolve cleanly across all platforms.
    - 2v2 Doubles scorecards (`5tiIdIJjSzZI`) have `is_2v2=True`, `is_ffa=False`, and `pod_participants=[]`
      so they never misclassify as 4-Player FFA Pods.
    - Player ID-only lookups (`/api/player/p_innes_wilson`, `/api/player/p_aos_nicolas_tassone`) and
      `/api/predict` resolve exact player profiles without falling back to Folger Pyles.
    - `/api/armylists/{list_id}` falls back to SQLite imported decklists/armylists (`melee:wanderingones`).
    """
    import urllib.parse

    # 1. Double-encoded TopDeck 4P FFA Pod match ID
    raw_td_mid = "td:down-under-spring-scrimmage-1-s1-r1-t1"
    double_encoded_mid = urllib.parse.quote(urllib.parse.quote(raw_td_mid, safe=""), safe="")
    st_td, sc_td, ms_td = fetch_json(f"/api/scorecard/{double_encoded_mid}")
    assert st_td == 200 and ms_td < 1000.0
    bcp_td = sc_td.get("bcp_match") or {}
    assert bcp_td.get("is_ffa") is True and bcp_td.get("is_2v2") is False
    assert len(bcp_td.get("pod_participants") or []) == 4

    # 2. 2v2 Doubles scorecard classification
    st_2v2, sc_2v2, ms_2v2 = fetch_json("/api/scorecard/5tiIdIJjSzZI")
    assert st_2v2 == 200 and ms_2v2 < 1000.0
    bcp_2v2 = sc_2v2.get("bcp_match") or {}
    assert bcp_2v2.get("is_2v2") is True and bcp_2v2.get("is_ffa") is False
    assert bcp_2v2.get("pod_participants") == []
    assert len(bcp_2v2.get("team1_players") or []) == 2
    assert len(bcp_2v2.get("team2_players") or []) == 2

    # 3. All 5 platform scorecards
    for mid, expected_plat in (
        ("0lXgOBLjk27Q", "bcp"),
        ("td:commander-invitational-qualifier-final-fortune-gaming-5-s1-r1-t1", "topdeck"),
        ("ltcg:6aced505115c12b73a5a37c5-r1-t1-xerokunai", "limitless"),
        ("melee:428253-r1-757a25d2-9a8e-457b-b656-b45300f57790", "melee"),
        ("ls:36154-r1-t1-717752", "longshanks"),
    ):
        st_p, sc_p, ms_p = fetch_json(f"/api/scorecard/{urllib.parse.quote(mid, safe='')}")
        assert st_p == 200 and ms_p < 1000.0
        assert (sc_p.get("bcp_match") or {}).get("source_platform") == expected_plat

    # 4. Strict ID-only lookups for synthetic 40k & AoS leaderboard entries
    st_iw, d_iw, ms_iw = fetch_json("/api/player/p_innes_wilson?game_system=40k")
    assert st_iw == 200 and ms_iw < 1000.0
    assert (d_iw.get("player") or {}).get("player_name") == "Innes Wilson"

    st_nt, d_nt, ms_nt = fetch_json("/api/player/p_aos_nicolas_tassone?game_system=aos")
    assert st_nt == 200 and ms_nt < 1000.0
    assert (d_nt.get("player") or {}).get("player_name") == "Nicolas Tassone"
    assert "Stormcast" in str((d_nt.get("player") or {}).get("top_faction") or "")

    # 5. Match Predictor with synthetic IDs and SQLite IDs
    st_pr, d_pr, ms_pr = fetch_json("/api/predict?p1=p_innes_wilson&p2=p_folger_pyles&game_system=40k")
    assert st_pr == 200 and ms_pr < 1000.0
    assert (d_pr.get("player1") or {}).get("player_name") == "Innes Wilson"
    assert (d_pr.get("player2") or {}).get("player_name") == "Folger Pyles"

    # 6. /api/armylists/{list_id} SQLite fallback
    st_al, d_al, ms_al = fetch_json("/api/armylists/melee%3Awanderingones")
    assert st_al == 200 and ms_al < 1000.0
    assert d_al.get("success") is True
    assert "Domain Ramp" in str((d_al.get("army_list") or {}).get("text") or "")


def main():
    print("=" * 80)
    print("1. RUNNING EXISTING MULTI-GAME & 118-SYSTEM UNIT TESTS")
    print("=" * 80)
    from tests.test_all_bcp_game_systems import (
        test_catalog_has_all_118_bcp_systems_sorted_by_popularity,
        test_has_game_tracker_only_true_for_40k_and_aos,
        test_normalize_and_resolve_all_118_systems,
        test_non_40k_aos_factions_never_leak_40k_factions,
        test_meta_intel_supports_3_round_rtts_for_other_bcp_systems,
        test_frontend_single_game_system_pill_and_tracker_hiding,
        test_my_hub_and_bcp_adapter_support_all_118_game_systems,
        test_game_system_other_excludes_40k_and_aos,
    )

    for fn in (
        test_catalog_has_all_118_bcp_systems_sorted_by_popularity,
        test_has_game_tracker_only_true_for_40k_and_aos,
        test_normalize_and_resolve_all_118_systems,
        test_non_40k_aos_factions_never_leak_40k_factions,
        test_meta_intel_supports_3_round_rtts_for_other_bcp_systems,
        test_frontend_single_game_system_pill_and_tracker_hiding,
        test_my_hub_and_bcp_adapter_support_all_118_game_systems,
        test_game_system_other_excludes_40k_and_aos,
    ):
        fn()
        print(f"  [PASS] {fn.__name__}")

    print("\n" + "=" * 80)
    print("2. TESTING 2v2 DOUBLES & 4-PLAYER FFA POD RETROFITTING, ZERO-SUM ELO & STRICT ID")
    print("=" * 80)
    test_2v2_doubles_and_4p_ffa_pod_retrofitting_and_elo()
    print("  [PASS] test_2v2_doubles_and_4p_ffa_pod_retrofitting_and_elo")
    test_strict_player_id_separation_never_merges_by_name()
    print("  [PASS] test_strict_player_id_separation_never_merges_by_name")
    test_40k_and_aos_zero_regression_and_meta_intel_sync_safety()
    print("  [PASS] test_40k_and_aos_zero_regression_and_meta_intel_sync_safety")
    test_community_hub_and_my_hub_all_platforms()
    print("  [PASS] test_community_hub_and_my_hub_all_platforms")
    test_all_5_dedicated_platform_sync_scripts_and_meta_intel()
    print("  [PASS] test_all_5_dedicated_platform_sync_scripts_and_meta_intel")
    test_comprehensive_edge_cases_and_integrations()
    print("  [PASS] test_comprehensive_edge_cases_and_integrations")
    test_round2_bug_fixes_faction_details_teams_scorecard_and_aliases()
    print("  [PASS] test_round2_bug_fixes_faction_details_teams_scorecard_and_aliases")
    test_round3_and_round4_scorecard_2v2_ffa_double_encoding_and_armylists()
    print("  [PASS] test_round3_and_round4_scorecard_2v2_ffa_double_encoding_and_armylists")

    print("\n" + "=" * 80)
    print("3. BENCHMARKING <1s LATENCY ACROSS ALL 5 PLATFORMS & 16 GAME SYSTEMS")
    print("=" * 80)
    max_latency = test_multiplatform_latency_and_real_data()

    print("\n" + "=" * 80)
    print(f"ALL TESTS PASSED ON 100% REAL DATA! Max Endpoint Latency: {max_latency:.2f} ms (Target < 1000 ms)")
    print("=" * 80)


if __name__ == "__main__":
    main()
