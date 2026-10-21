"""Comprehensive test suite for GCP Cloud Run Jobs and Multi-Game (40k & AoS) integration:
1. 40k & AoS Faction Grouping & Clean Legacy Wahapedia Removal.
2. Cloud Run Job: elo-tournament-sync-job (Dual 40k & AoS scraping + incremental Elo).
3. Cloud Run Job: elo-historical-scrape (Flexible start/end date + multi-game parameterization).
4. Cloud Build deployment configuration (all active Cloud Run jobs updated in pipeline).
5. 40k & AoS Elo Engine partitioning and data isolation guarantee.
"""

import inspect
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import config
from database import PostgresDatabase
from elo import EloEngine
from scripts.sync_tournaments import run_tournament_sync
from scripts.historical_scrape import run_historical_scrape


def test_faction_groups_and_legacy_wahapedia_removed():
    """Verify 40k and AoS faction groups in PostgresDatabase and confirm legacy Wahapedia code is removed."""
    groups_40k = PostgresDatabase.get_factions(game_system="40k", grouped=True)
    groups_aos = PostgresDatabase.get_factions(game_system="aos", grouped=True)

    assert len(groups_40k) == 4
    assert {g["group"] for g in groups_40k} == {"Imperium", "Space Marines", "Chaos", "Xenos"}
    assert len(groups_aos) == 4
    assert {g["group"] for g in groups_aos} == {"Order", "Chaos", "Death", "Destruction"}

    with open(ROOT_DIR / "database.py", "r", encoding="utf-8") as f:
        db_code = f.read()

    assert "CREATE TABLE IF NOT EXISTS waha_" not in db_code
    assert not hasattr(PostgresDatabase, "waha_find_unit")
    assert not hasattr(PostgresDatabase, "waha_get_sync_status")
    assert not (ROOT_DIR / "wahapedia_sync.py").exists()
    assert not (ROOT_DIR / "scripts" / "sync_wahapedia.py").exists()

    print("✅ test_faction_groups_and_legacy_wahapedia_removed passed")


def test_elo_tournament_sync_job():
    """Verify elo-tournament-sync-job (scripts/sync_tournaments.py) scrapes both 40k & AoS and recalculates Elo."""
    mock_db = MagicMock()
    mock_scraper = MagicMock()
    mock_scraper.scrape_date_range.return_value = {"events_scraped": 5, "matches_scraped": 30}
    mock_engine = MagicMock()
    mock_engine.reconstruct_incremental.return_value = {
        "game_system": "all",
        "total_new_matches": 60,
        "players_updated": 40
    }

    with patch("scripts.sync_tournaments.get_database", return_value=mock_db), \
         patch("scripts.sync_tournaments.BestCoastPairingsScraper", return_value=mock_scraper), \
         patch("scripts.sync_tournaments.get_elo_engine", return_value=mock_engine), \
         patch("firestore_db.get_firestore_engine", side_effect=Exception("No Firestore in test")):

        # Run with default game_system="all"
        res = run_tournament_sync(game_system="all", days=3, max_events=50)

        # Scraped 40k tournaments using DEFAULT_GAME_SYSTEM_ID
        assert any(
            call.kwargs.get("game_system_id") == config.DEFAULT_GAME_SYSTEM_ID
            for call in mock_scraper.scrape_date_range.call_args_list
        ), "40k events were not scraped with DEFAULT_GAME_SYSTEM_ID"

        # Scraped AoS tournaments using AOS_GAME_SYSTEM_ID
        assert any(
            call.kwargs.get("game_system_id") == config.AOS_GAME_SYSTEM_ID
            for call in mock_scraper.scrape_date_range.call_args_list
        ), "AoS events were not scraped with AOS_GAME_SYSTEM_ID"

        # Upcoming events are not synced during elo-tournament-sync-job (queried live from BCP instead)
        mock_scraper.sync_upcoming_events.assert_not_called()

        # Elo incremental recalculated for "all"
        mock_engine.reconstruct_incremental.assert_called_once_with(game_system="all")
        assert res["events_scraped"] == 10
        assert res["matches_scraped"] == 60

    print("✅ test_elo_tournament_sync_job passed")


def test_elo_historical_scrape_job():
    """Verify elo-historical-scrape (scripts/historical_scrape.py) accepts game system and date range."""
    mock_db = MagicMock()
    mock_scraper = MagicMock()
    mock_scraper.scrape_date_range.return_value = {"events_scraped": 8, "matches_scraped": 48}
    mock_engine = MagicMock()

    with patch("scripts.historical_scrape.get_database", return_value=mock_db), \
         patch("scripts.historical_scrape.BestCoastPairingsScraper", return_value=mock_scraper), \
         patch("scripts.historical_scrape.get_elo_engine", return_value=mock_engine):

        # 1. Scrape AoS only for a custom date range
        res_aos = run_historical_scrape(
            start_date="2026-07-01",
            end_date="2026-07-31",
            game_system="aos",
            reconstruct=True
        )
        assert res_aos["game_system"] == "aos"
        assert res_aos["events_scraped"] == 8
        assert mock_scraper.scrape_date_range.call_count == 1
        assert mock_scraper.scrape_date_range.call_args[1]["game_system_id"] == config.AOS_GAME_SYSTEM_ID
        mock_engine.reconstruct_incremental.assert_called_once_with(game_system="aos")

        mock_scraper.reset_mock()
        mock_engine.reset_mock()

        # 2. Scrape with custom game_system_id override
        custom_id = "CUSTOM_AOS_LEAGUE_123"
        run_historical_scrape(
            start_date="2026-08-01",
            end_date="2026-08-10",
            game_system="aos",
            game_system_id=custom_id,
            reconstruct=False
        )
        assert mock_scraper.scrape_date_range.call_args[1]["game_system_id"] == custom_id

        mock_scraper.reset_mock()
        mock_engine.reset_mock()

        # 3. Scrape 'all'
        res_all = run_historical_scrape(
            start_date="2026-08-01",
            end_date="2026-08-10",
            game_system="all",
            reconstruct=False
        )
        assert res_all["game_system"] == "all"
        assert mock_scraper.scrape_date_range.call_count == 2
        call_system_ids = [c[1]["game_system_id"] for c in mock_scraper.scrape_date_range.call_args_list]
        assert config.DEFAULT_GAME_SYSTEM_ID in call_system_ids
        assert config.AOS_GAME_SYSTEM_ID in call_system_ids

    print("✅ test_elo_historical_scrape_job passed")


def test_main_cli_multigame_support():
    """Verify main.py CLI commands support --game-system, --game-system-id, and sync/sync-players commands."""
    with open(ROOT_DIR / "main.py", "r", encoding="utf-8") as f:
        main_src = f.read()

    # Verify parser arguments
    assert "p_scrape.add_argument(\"--game-system\"" in main_src
    assert "p_scrape.add_argument(\"--game-system-id\"" in main_src
    assert "p_recon.add_argument(\"--game-system\"" in main_src
    assert "p_lead.add_argument(\"--game-system\"" in main_src
    assert "p_player.add_argument(\"--game-system\"" in main_src
    assert "p_sync = subparsers.add_parser(\"sync\"" in main_src
    assert "cmd_wahapedia" not in main_src

    # Verify cmd_scrape logic handles systems_to_scrape
    assert "DEFAULT_GAME_SYSTEM_ID" in main_src
    assert "AOS_GAME_SYSTEM_ID" in main_src
    assert "cmd_sync" in main_src
    assert "cmd_player_sync" in main_src

    print("✅ test_main_cli_multigame_support passed")


def test_cloudbuild_deployment_pipeline():
    """Verify cloudbuild.yaml has update steps for all active Cloud Run jobs including separate platform sync jobs."""
    with open(ROOT_DIR / "cloudbuild.yaml", "r", encoding="utf-8") as f:
        cb_src = f.read()

    assert "elo-tournament-sync-job" in cb_src
    assert "elo-historical-scrape" in cb_src
    assert "player-sync-job" in cb_src
    assert "elo-melee-sync-job" in cb_src
    assert "elo-limitless-sync-job" in cb_src
    assert "elo-longshanks-sync-job" in cb_src
    assert "elo-topdeck-sync-job" in cb_src
    assert "scripts/sync_melee.py" in cb_src
    assert "scripts/sync_limitless.py" in cb_src
    assert "scripts/sync_longshanks.py" in cb_src
    assert "scripts/sync_topdeck.py" in cb_src
    assert "wahapedia-sync-job" not in cb_src
    assert "cleanup-nr-relay" not in cb_src
    assert "id: 'update-tournament-job'" in cb_src
    assert "id: 'update-historical-scrape-job'" in cb_src
    assert "id: 'update-player-sync-job'" in cb_src
    assert "id: 'update-melee-sync-job'" in cb_src
    assert "id: 'update-limitless-sync-job'" in cb_src
    assert "id: 'update-longshanks-sync-job'" in cb_src
    assert "id: 'update-topdeck-sync-job'" in cb_src

    print("✅ test_cloudbuild_deployment_pipeline passed")


def test_separate_platform_cloud_run_jobs():
    """Verify standalone Cloud Run Job scripts (sync_melee, sync_limitless, sync_longshanks, sync_topdeck) and deploy_platform_job."""
    from scripts.sync_melee import run_melee_sync
    from scripts.sync_limitless import run_limitless_sync
    from scripts.sync_longshanks import run_longshanks_sync
    from scripts.sync_topdeck import run_topdeck_sync
    from scripts.deploy_platform_job import _extract_template_config

    mock_db = MagicMock()
    with patch("scripts.sync_melee.get_sync_db", return_value=mock_db), \
         patch("scripts.sync_melee.import_live_melee_tournaments", return_value={"events_imported": 2, "participants_imported": 100, "matches_imported": 300}) as m_melee, \
         patch("scripts.sync_melee.finalize_platform_sync", return_value={"systems_updated": ["mtg"], "reconstruction": {}}) as f_melee:
        res_m = run_melee_sync(game_system="mtg", max_events=2)
        assert res_m["platform"] == "melee"
        assert res_m["events_imported"] == 2
        m_melee.assert_called_once()
        f_melee.assert_called_once_with(mock_db, ["mtg"], platform_name="Melee.gg")

    with patch("scripts.sync_limitless.get_sync_db", return_value=mock_db), \
         patch("scripts.sync_limitless.import_live_limitless_tournaments", return_value={"events_imported": 3, "participants_imported": 150, "matches_imported": 450}) as m_ltcg, \
         patch("scripts.sync_limitless.finalize_platform_sync", return_value={"systems_updated": ["pokemon"], "reconstruction": {}}) as f_ltcg:
        res_l = run_limitless_sync(game_system="pokemon", max_events=3)
        assert res_l["platform"] == "limitless"
        assert res_l["events_imported"] == 3
        m_ltcg.assert_called_once()
        f_ltcg.assert_called_once_with(mock_db, ["pokemon"], platform_name="LimitlessTCG")

    with patch("scripts.sync_longshanks.get_sync_db", return_value=mock_db), \
         patch("scripts.sync_longshanks.import_live_longshanks_tournaments", return_value={"events_imported": 2, "participants_imported": 56, "matches_imported": 168}) as m_ls, \
         patch("scripts.sync_longshanks.finalize_platform_sync", return_value={"systems_updated": ["mcp"], "reconstruction": {}}) as f_ls:
        res_ls = run_longshanks_sync(game_system="mcp", max_events=2)
        assert res_ls["platform"] == "longshanks"
        assert res_ls["events_imported"] == 2
        m_ls.assert_called_once()
        f_ls.assert_called_once_with(mock_db, ["mcp"], platform_name="Longshanks")

    with patch("scripts.sync_topdeck.get_sync_db", return_value=mock_db), \
         patch("scripts.sync_topdeck.import_live_topdeck_tournaments", return_value={"events_imported": 3, "participants_imported": 284, "pods_imported": 404, "matches_imported": 404}) as m_td, \
         patch("scripts.sync_topdeck.finalize_platform_sync", return_value={"systems_updated": ["mtg"], "reconstruction": {}}) as f_td:
        res_td = run_topdeck_sync(game_system="mtg", max_events=3)
        assert res_td["platform"] == "topdeck"
        assert res_td["events_imported"] == 3
        m_td.assert_called_once()
        f_td.assert_called_once_with(mock_db, ["mtg"], platform_name="TopDeck.gg")

    # Verify deploy_platform_job template extraction
    sample_job_json = {
        "spec": {
            "template": {
                "metadata": {
                    "annotations": {
                        "run.googleapis.com/cloudsql-instances": "eloranking-506820:us-central1:elo-postgres"
                    }
                },
                "spec": {
                    "template": {
                        "spec": {
                            "serviceAccountName": "elo-sa@eloranking-506820.iam.gserviceaccount.com",
                            "containers": [
                                {
                                    "env": [
                                        {"name": "DATABASE_URL", "value": "postgresql://user:pass@/db?host=/cloudsql/inst"},
                                        {"name": "BCP_SECRET", "valueFrom": {"secretKeyRef": {"name": "bcp-sec", "key": "1"}}},
                                    ]
                                }
                            ],
                        }
                    }
                },
            }
        }
    }
    csql, sa, envs, secrets = _extract_template_config(sample_job_json)
    assert csql == "eloranking-506820:us-central1:elo-postgres"
    assert sa == "elo-sa@eloranking-506820.iam.gserviceaccount.com"
    assert envs == ["DATABASE_URL=postgresql://user:pass@/db?host=/cloudsql/inst"]
    assert secrets == ["BCP_SECRET=bcp-sec:1"]

    print("✅ test_separate_platform_cloud_run_jobs passed")


def test_elo_engine_partitioning_and_isolation():
    """Verify EloEngine methods isolate ratings between 40k and AoS."""
    mock_db = MagicMock()
    engine = EloEngine(db=mock_db)

    # 1. reconstruct_incremental signature & delegation
    sig_recon_inc = inspect.signature(engine.reconstruct_incremental)
    assert "game_system" in sig_recon_inc.parameters
    assert sig_recon_inc.parameters["game_system"].default == "40k"

    # 2. reconstruct_all_rankings signature & delegation
    sig_recon_all = inspect.signature(engine.reconstruct_all_rankings)
    assert "game_system" in sig_recon_all.parameters
    assert sig_recon_all.parameters["game_system"].default == "40k"

    # 3. get_player_win_path signature & parameterization
    sig_win_path = inspect.signature(engine.get_player_win_path)
    assert "game_system" in sig_win_path.parameters
    assert sig_win_path.parameters["game_system"].default == "40k"

    # 4. In incremental mode with zero new matches, returns UP_TO_DATE for specific game system
    mock_db.get_unranked_matches.return_value = []
    res = engine.reconstruct_incremental(game_system="aos")
    assert res["status"] == "UP_TO_DATE"
    assert res["game_system"] == "aos"
    mock_db.get_unranked_matches.assert_called_with(limit=50000, game_system="aos", since_date=None)

    print("✅ test_elo_engine_partitioning_and_isolation passed")


def test_pwa_and_browser_auto_update_and_sw_killer():
    """Verify /worker.js serves a self-unregistering Service Worker killer and all HTML shells unregister stale SWs."""
    nr_src = (ROOT_DIR / "newrecruit_integration.py").read_text(encoding="utf-8")
    assert "navigator.serviceWorker.register = function()" in nr_src
    assert "window.caches.delete('newrecruit')" in nr_src
    assert '"/worker.js"' not in nr_src

    armylists_src = (ROOT_DIR / "routers" / "armylists.py").read_text(encoding="utf-8")
    assert "def api_kill_stale_service_worker()" in armylists_src
    assert "self.registration.unregister()" in armylists_src

    build_src = (ROOT_DIR / "scripts" / "build_bundle.py").read_text(encoding="utf-8")
    assert '"newrecruit_integration.py"' in build_src
    assert '"army_list_parser.py"' in build_src

    for html_rel in (
        "web/app.html",
        "web/index.html",
        "web/eventstudio.html",
        "web/scorecard.html",
        "web/tracker/lobby.html",
        "web/tracker/play.html",
        "web/tracker/aos.html",
        "web/tracker/login.html",
    ):
        html_src = (ROOT_DIR / html_rel).read_text(encoding="utf-8")
        assert "r.unregister()" in html_src, f"Missing r.unregister() in {html_rel}"
        assert "window.caches.delete('newrecruit')" in html_src, f"Missing newrecruit cache cleanup in {html_rel}"

    print("✅ test_pwa_and_browser_auto_update_and_sw_killer passed")


def test_armory_40k_and_aos_equipped_isolation():
    """Verify 40K equipped Armory cosmetics never bleed into AoS and vice versa."""
    import armory_catalog

    # 1. Legacy vault with only flat 40K keys and missing 'aos' sub-dict
    legacy_vault = {
        "inventory": {
            "dice_40k_dark_angels": {"id": "dice_40k_dark_angels"},
            "frame_peak_high_warlord": {"id": "frame_peak_high_warlord"},
            "frame_astral_holofoil": {"id": "frame_astral_holofoil"},
            "title_gt_champion": {"id": "title_gt_champion"},
            "avatar_dark_angels": {"id": "avatar_dark_angels"},
        },
        "equipped": {
            "40k": {
                "active_dice": "dice_40k_dark_angels",
                "active_card_frame": "frame_peak_high_warlord",
                "active_card_finish": "frame_astral_holofoil",
                "active_title": "title_gt_champion",
                "active_avatar": "avatar_dark_angels",
            },
            "active_dice": "dice_40k_dark_angels",
            "active_card_frame": "frame_peak_high_warlord",
            "active_card_finish": "frame_astral_holofoil",
            "active_title": "title_gt_champion",
            "active_avatar": "avatar_dark_angels",
        },
    }

    norm = armory_catalog.normalize_armory_vault(legacy_vault)
    assert set(norm["equipped"].keys()) == {"40k", "aos"}
    assert norm["equipped"]["40k"]["active_dice"] == "dice_40k_dark_angels"
    assert norm["equipped"]["40k"]["active_card_frame"] == "frame_peak_high_warlord"
    assert all(v is None for v in norm["equipped"]["aos"].values()), f"Expected empty AoS loadout, got {norm['equipped']['aos']}"

    # 2. Cross-contaminated vault where a 40K item was accidentally stored in 'aos'
    contaminated = {
        "inventory": {},
        "equipped": {
            "40k": {"active_dice": None, "active_card_frame": None, "active_card_finish": None, "active_title": None, "active_avatar": None},
            "aos": {"active_dice": "dice_40k_chaos", "active_card_frame": "frame_peak_high_warlord", "active_card_finish": None, "active_title": None, "active_avatar": "avatar_stormcast_eternals"},
        },
    }
    norm2 = armory_catalog.normalize_armory_vault(contaminated)
    assert norm2["equipped"]["aos"]["active_dice"] is None
    assert norm2["equipped"]["aos"]["active_card_frame"] is None
    assert norm2["equipped"]["aos"]["active_avatar"] == "avatar_stormcast_eternals"
    assert norm2["equipped"]["40k"]["active_dice"] == "dice_40k_chaos"
    assert norm2["equipped"]["40k"]["active_card_frame"] == "frame_peak_high_warlord"

    # 3. Catalog for AoS must have 0 equipped items when only 40K items are equipped
    cat_aos = armory_catalog.get_armory_catalog(user_vault=legacy_vault, game_system="aos")
    equipped_aos = [i["id"] for i in cat_aos["items"] if i.get("is_equipped")]
    assert equipped_aos == [], f"Expected 0 equipped AoS items, got {equipped_aos}"

    cat_40k = armory_catalog.get_armory_catalog(user_vault=legacy_vault, game_system="40k")
    equipped_40k = [i["id"] for i in cat_40k["items"] if i.get("is_equipped")]
    assert len(equipped_40k) == 5, f"Expected 5 equipped 40K items, got {equipped_40k}"

    print("✅ test_armory_40k_and_aos_equipped_isolation passed")


def test_active_public_tables_and_obsolete_pruning():
    """Verify ACTIVE_PUBLIC_TABLES matches all runtime CREATE TABLE statements 1:1 and prunes legacy tables."""
    import os
    import re
    import glob
    from database import PostgresDatabase

    created = set()
    for p in glob.glob(str(ROOT_DIR / "**/*.py"), recursive=True):
        rel = os.path.relpath(p, ROOT_DIR)
        if rel.startswith("tests/") or rel.startswith("scripts/"):
            continue
        with open(p, "r", encoding="utf-8") as f:
            src = f.read()
        for m in re.findall(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)", src, re.I):
            created.add(m.lower())

    assert created == PostgresDatabase.ACTIVE_PUBLIC_TABLES, (
        f"Mismatch between runtime CREATE TABLE ({created ^ PostgresDatabase.ACTIVE_PUBLIC_TABLES}) and ACTIVE_PUBLIC_TABLES"
    )
    assert len(PostgresDatabase.ACTIVE_PUBLIC_TABLES) == 42
    assert "match_participants" in PostgresDatabase.ACTIVE_PUBLIC_TABLES
    assert "user_platform_links" in PostgresDatabase.ACTIVE_PUBLIC_TABLES
    assert "user_army_lists" not in PostgresDatabase.ACTIVE_PUBLIC_TABLES
    assert "native_league_matches" not in PostgresDatabase.ACTIVE_PUBLIC_TABLES
    assert "native_studio_events" not in PostgresDatabase.ACTIVE_PUBLIC_TABLES
    assert not any(t.startswith("waha") for t in PostgresDatabase.ACTIVE_PUBLIC_TABLES)

    print("✅ test_active_public_tables_and_obsolete_pruning passed")


def test_sync_jobs_varchar64_bounding_and_transaction_resilience():
    """Verify >64-char IDs are deterministically bounded to 64 chars and reconstruct_incremental survives match_participants errors."""
    from database import _bound_id as db_bound_id, PostgresDatabase
    from elo import _bound_id as elo_bound_id, EloEngine
    from scripts.sync_multiplatform import _bound_id as sync_bound_id

    long_mid = "td:commander-invitational-qualifier-final-fortune-gaming-5-s1-r1-t1"
    assert len(long_mid) == 67
    b1 = db_bound_id(long_mid)
    b2 = elo_bound_id(long_mid)
    b3 = sync_bound_id(long_mid)
    assert len(b1) == 64
    assert b1 == b2 == b3
    assert b1.startswith("td:commander-invitational-qualifier-final-fortune-g_")

    # Short IDs <= 64 chars remain untouched
    short_id = "td:commander-invitational-qualifier-final-fortune-gaming-5"
    assert len(short_id) == 58
    assert db_bound_id(short_id) == short_id

    # Verify EloEngine.reconstruct_incremental rolls back cleanly if match_participants query raises
    # and still rates FFA pods via raw_json.pod_participants with integer rating_history scores
    mock_db = MagicMock()
    mock_conn = MagicMock()
    mock_db.get_connection.return_value.__enter__.return_value = mock_conn

    mock_db.get_unranked_matches.return_value = [
        {
            "id": long_mid,
            "event_id": short_id,
            "round": 1,
            "table_number": 1,
            "match_date": "2026-10-15T12:00:00",
            "player1_id": "td:p1",
            "player1_name": "Alice",
            "player1_faction": "Tymna / Kraum",
            "player1_score": 5.0,
            "player2_id": "td:p2",
            "player2_name": "Pod (Bob, Charlie, Dave)",
            "player2_faction": "Commander Pod",
            "player2_score": 0.0,
            "winner_id": "td:p1",
            "is_draw": False,
            "is_bye": False,
            "game_system": "mtg",
            "raw_json": {
                "match_format": "ffa",
                "is_ffa": True,
                "pod_participants": [
                    {"player_id": "td:p1", "player_name": "Alice", "faction": "Tymna / Kraum", "score": 5.0, "is_winner": True},
                    {"player_id": "td:p2", "player_name": "Bob", "faction": "Kinnan", "score": 0.0, "is_winner": False},
                    {"player_id": "td:p3", "player_name": "Charlie", "faction": "Sisay", "score": 0.0, "is_winner": False},
                    {"player_id": "td:p4", "player_name": "Dave", "faction": "Rograkh / Silas", "score": 0.0, "is_winner": False},
                ],
            },
        }
    ]

    captured_batches = []

    def _cursor_side_effect(*args, **kwargs):
        cur = MagicMock()
        def _exec(sql, params=None):
            if "FROM match_participants" in str(sql) and "SELECT match_id" in str(sql):
                raise RuntimeError('relation "match_participants" does not exist')
            if "INSERT INTO rating_history" in str(sql) and isinstance(params, list):
                captured_batches.append(params)
        cur.execute.side_effect = _exec
        cur.fetchall.return_value = []
        cm = MagicMock()
        cm.__enter__.return_value = cur
        return cm

    mock_conn.cursor.side_effect = _cursor_side_effect

    engine = EloEngine(db=mock_db)
    res = engine.reconstruct_incremental(game_system="mtg", skip_stale_check=True)
    assert res["total_new_matches"] == 1
    assert res["players_updated"] == 4
    assert res["history_points_saved"] == 4
    assert mock_conn.rollback.called, "Expected conn.rollback() when match_participants query fails"
    assert mock_conn.commit.called, "Expected conn.commit() after rating_history & player_ratings upsert"

    # Inspect inserted rating_history rows: match_id must be <= 64 chars and scores must be ints
    assert len(captured_batches) == 1
    hist_rows = captured_batches[0]
    assert len(hist_rows) == 4
    for hr in hist_rows:
        assert len(hr[1]) == 64, f"Expected 64-char bounded match_id, got {len(hr[1])}: {hr[1]}"
        assert isinstance(hr[14], int), f"Expected int player_score, got {type(hr[14])}: {hr[14]}"
        assert isinstance(hr[15], int), f"Expected int opponent_score, got {type(hr[15])}: {hr[15]}"

    print("✅ test_sync_jobs_varchar64_bounding_and_transaction_resilience passed")


if __name__ == "__main__":
    print("=== RUNNING GCP JOBS & MULTI-GAME TEST SUITE ===")
    test_faction_groups_and_legacy_wahapedia_removed()
    test_elo_tournament_sync_job()
    test_elo_historical_scrape_job()
    test_main_cli_multigame_support()
    test_cloudbuild_deployment_pipeline()
    test_separate_platform_cloud_run_jobs()
    test_elo_engine_partitioning_and_isolation()
    test_pwa_and_browser_auto_update_and_sw_killer()
    test_armory_40k_and_aos_equipped_isolation()
    test_active_public_tables_and_obsolete_pruning()
    test_sync_jobs_varchar64_bounding_and_transaction_resilience()
    print("\n🎉 ALL GCP JOBS & MULTI-GAME TESTS PASSED 100%!")

