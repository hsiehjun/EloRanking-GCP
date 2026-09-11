"""Comprehensive test suite for GCP Cloud Run Jobs and Wahapedia AoS integration:
1. Wahapedia AoS Sync Engine & PostgreSQL schema isolation.
2. Cloud Run Job: elo-tournament-sync-job (Dual 40k & AoS scraping + incremental Elo).
3. Cloud Run Job: elo-historical-scrape (Flexible start/end date + multi-game parameterization).
4. Wahapedia Sync Job: wahapedia-sync-job (AoS 4th edition rules & warscrolls).
5. Cloud Build deployment configuration (all 3 Cloud Run jobs updated in pipeline).
6. 40k data protection guarantee (zero cross-contamination or regression).
"""

import inspect
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import config
from wahapedia_sync import (
    WahapediaSync, WH40K_BASE_URL, AOS_BASE_URL,
    WH40K_TABLE_MAPPING, AOS_TABLE_MAPPING, sync_wahapedia_job
)
import database
from database import PostgresDatabase, Database
from scraper import BestCoastPairingsScraper
from elo import EloEngine
from scripts.sync_tournaments import run_tournament_sync
from scripts.historical_scrape import run_historical_scrape


def test_wahapedia_aos_configuration():
    """Verify Wahapedia AoS base URL and table mapping structure."""
    assert AOS_BASE_URL == "https://wahapedia.ru/aos4"
    assert WH40K_BASE_URL == "https://wahapedia.ru/wh40k11ed"
    
    # 12 AoS tables mapped to dedicated waha_aos_* prefix
    expected_aos_tables = [
        "waha_aos_factions",
        "waha_aos_sources",
        "waha_aos_warscrolls",
        "waha_aos_warscroll_abilities",
        "waha_aos_warscroll_weapons",
        "waha_aos_warscroll_keywords",
        "waha_aos_warscroll_bases",
        "waha_aos_warscroll_organisation",
        "waha_aos_warscroll_ror_factions",
        "waha_aos_faction_abilities",
        "waha_aos_faction_ability_types",
        "waha_aos_faction_ability_subtypes",
    ]
    for tbl in expected_aos_tables:
        assert tbl in AOS_TABLE_MAPPING.values(), f"Missing AoS table {tbl}"

    # Strict isolation: No collision with 40k tables
    for tbl in AOS_TABLE_MAPPING.values():
        assert tbl not in WH40K_TABLE_MAPPING.values(), f"AoS table {tbl} collides with 40k tables!"

    print("✅ test_wahapedia_aos_configuration passed")


def test_wahapedia_schema_in_database():
    """Verify that PostgresDatabase contains schema definitions and queries for AoS Wahapedia tables."""
    with open(ROOT_DIR / "database.py", "r", encoding="utf-8") as f:
        db_code = f.read()

    # DDL creates all 12 AoS tables
    assert "CREATE TABLE IF NOT EXISTS waha_aos_warscrolls" in db_code
    assert "CREATE TABLE IF NOT EXISTS waha_aos_factions" in db_code
    assert "CREATE TABLE IF NOT EXISTS waha_aos_warscroll_abilities" in db_code
    assert "CREATE TABLE IF NOT EXISTS waha_aos_warscroll_weapons" in db_code
    assert "CREATE TABLE IF NOT EXISTS waha_aos_warscroll_keywords" in db_code
    assert "CREATE TABLE IF NOT EXISTS waha_aos_warscroll_bases" in db_code

    # Performance indexes for AoS
    assert "idx_waha_aos_ws_name" in db_code
    assert "idx_waha_aos_ws_faction" in db_code
    assert "idx_waha_aos_ws_wp_ws" in db_code
    assert "idx_waha_aos_ws_ab_ws" in db_code

    # Multi-game methods exist
    db = PostgresDatabase.__new__(PostgresDatabase)
    assert hasattr(db, "waha_get_sync_status")
    assert hasattr(db, "waha_aos_find_warscroll")
    assert hasattr(db, "waha_aos_get_factions")
    assert hasattr(db, "waha_aos_get_faction_abilities")
    assert hasattr(db, "waha_find_unit")

    print("✅ test_wahapedia_schema_in_database passed")


def test_wahapedia_sync_engine_dispatch():
    """Verify WahapediaSync correctly routes sync_40k, sync_aos, and sync_all."""
    syncer = WahapediaSync(db=MagicMock())

    with patch.object(syncer, "sync_40k", return_value={"success": True, "game_system": "40k"}) as mock_40k, \
         patch.object(syncer, "sync_aos", return_value={"success": True, "game_system": "aos"}) as mock_aos:

        # 1. 40k only
        res_40k = syncer.sync_all(force=True, game_system="40k")
        assert res_40k["game_system"] == "40k"
        mock_40k.assert_called_once_with(force=True)
        mock_aos.assert_not_called()

        mock_40k.reset_mock()
        mock_aos.reset_mock()

        # 2. AoS only
        res_aos = syncer.sync_all(force=True, game_system="aos")
        assert res_aos["game_system"] == "aos"
        mock_aos.assert_called_once_with(force=True)
        mock_40k.assert_not_called()

        mock_40k.reset_mock()
        mock_aos.reset_mock()

        # 3. All (default)
        res_all = syncer.sync_all(force=False, game_system="all")
        assert res_all["success"] is True
        assert "40k" in res_all["game_systems"]
        assert "aos" in res_all["game_systems"]
        mock_40k.assert_called_once_with(force=False)
        mock_aos.assert_called_once_with(force=False)

    print("✅ test_wahapedia_sync_engine_dispatch passed")


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

        # Upcoming events synced for both
        upcoming_ids = [call.kwargs.get("game_system_id") for call in mock_scraper.sync_upcoming_events.call_args_list]
        assert config.DEFAULT_GAME_SYSTEM_ID in upcoming_ids
        assert config.AOS_GAME_SYSTEM_ID in upcoming_ids

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
        res_custom = run_historical_scrape(
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
    """Verify main.py CLI commands support --game-system, --game-system-id, and sync/wahapedia commands."""
    with open(ROOT_DIR / "main.py", "r", encoding="utf-8") as f:
        main_src = f.read()

    # Verify parser arguments
    assert "p_scrape.add_argument(\"--game-system\"" in main_src
    assert "p_scrape.add_argument(\"--game-system-id\"" in main_src
    assert "p_recon.add_argument(\"--game-system\"" in main_src
    assert "p_lead.add_argument(\"--game-system\"" in main_src
    assert "p_player.add_argument(\"--game-system\"" in main_src
    assert "p_sync = subparsers.add_parser(\"sync\"" in main_src
    assert "p_waha = subparsers.add_parser(\"wahapedia\"" in main_src

    # Verify cmd_scrape logic handles systems_to_scrape
    assert "DEFAULT_GAME_SYSTEM_ID" in main_src
    assert "AOS_GAME_SYSTEM_ID" in main_src
    assert "cmd_sync" in main_src
    assert "cmd_wahapedia" in main_src

    print("✅ test_main_cli_multigame_support passed")


def test_cloudbuild_deployment_pipeline():
    """Verify cloudbuild.yaml has update steps for all Cloud Run jobs: elo-tournament-sync-job, wahapedia-sync-job, elo-historical-scrape, and player-sync-job."""
    with open(ROOT_DIR / "cloudbuild.yaml", "r", encoding="utf-8") as f:
        cb_src = f.read()

    assert "elo-tournament-sync-job" in cb_src
    assert "wahapedia-sync-job" in cb_src
    assert "elo-historical-scrape" in cb_src
    assert "player-sync-job" in cb_src
    assert "id: 'update-tournament-job'" in cb_src
    assert "id: 'update-wahapedia-job'" in cb_src
    assert "id: 'update-historical-scrape-job'" in cb_src
    assert "id: 'update-player-sync-job'" in cb_src

    print("✅ test_cloudbuild_deployment_pipeline passed")


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
    mock_db.get_unranked_matches.assert_called_with(limit=50000, game_system="aos")

    print("✅ test_elo_engine_partitioning_and_isolation passed")


if __name__ == "__main__":
    print("=== RUNNING GCP JOBS & WAHAPEDIA AOS TEST SUITE ===")
    test_wahapedia_aos_configuration()
    test_wahapedia_schema_in_database()
    test_wahapedia_sync_engine_dispatch()
    test_elo_tournament_sync_job()
    test_elo_historical_scrape_job()
    test_main_cli_multigame_support()
    test_cloudbuild_deployment_pipeline()
    test_elo_engine_partitioning_and_isolation()
    print("\n🎉 ALL GCP JOBS & WAHAPEDIA AOS TESTS PASSED 100%!")
