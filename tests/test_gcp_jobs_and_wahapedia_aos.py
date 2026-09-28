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
    """Verify cloudbuild.yaml has update steps for active Cloud Run jobs: elo-tournament-sync-job, elo-historical-scrape, and player-sync-job."""
    with open(ROOT_DIR / "cloudbuild.yaml", "r", encoding="utf-8") as f:
        cb_src = f.read()

    assert "elo-tournament-sync-job" in cb_src
    assert "elo-historical-scrape" in cb_src
    assert "player-sync-job" in cb_src
    assert "wahapedia-sync-job" not in cb_src
    assert "id: 'update-tournament-job'" in cb_src
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
    print("=== RUNNING GCP JOBS & MULTI-GAME TEST SUITE ===")
    test_faction_groups_and_legacy_wahapedia_removed()
    test_elo_tournament_sync_job()
    test_elo_historical_scrape_job()
    test_main_cli_multigame_support()
    test_cloudbuild_deployment_pipeline()
    test_elo_engine_partitioning_and_isolation()
    print("\n🎉 ALL GCP JOBS & MULTI-GAME TESTS PASSED 100%!")
