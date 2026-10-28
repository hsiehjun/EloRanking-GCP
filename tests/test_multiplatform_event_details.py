"""Regression tests for rich multi-platform event details across popup & Event Hub."""

import json
import os
import unittest
from unittest.mock import MagicMock, patch

from scripts.melee_client import parse_tournament_view
import scripts.platform_discovery as pd_mod


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


SAMPLE_MELEE_HTML = """<!DOCTYPE html>
<html>
<head><title>CardCosmos FL Weekly Play | Melee</title></head>
<body>
  <p id="tournament-headline-organization">Organization: <a href="/Hub/View/41022">CardCosmos Flensburg</a></p>
  <p id="tournament-headline-venue">Event Venue: <a href="/Venue/View/88">CardCosmos Store Flensburg</a></p>
  <p id="tournament-headline-platform">Tournament Type: Tabletop</p>
  <span id="tournament-headline-start-date-field">
    <span data-toggle="datetime" data-value="4/15/2026 3:30:00 PM"></span>
  </span>
  <p id="tournament-headline-registration">
    Free to Play | <i class="fa fa-info-circle"></i> Registration | Format: FreeForm | <i class="fa fa-user"></i> 4 of 24 Enrolled Players | Open Registration
  </p>
  <input id="DecklistEnabled" type="hidden" value="false" />
  <span id="tournament-headline-game">Game: Disney Lorcana</span>
  <div id="tournament-description-tab" class="tab-pane active">
    <div class="card"><div class="card-body"><p>Weekly Lorcana League in Flensburg! Bring your favorite deck.</p></div></div>
  </div>
  <div id="tournament-prizes-tab" class="tab-pane">
    <div class="card"><div class="card-body"><p>1 Booster per entry + Promo cards!</p></div></div>
  </div>
  <div id="standings-round-selector-container">
    <button class="round-selector" data-id="9001" data-name="Round 1" data-is-started="False">Round 1</button>
  </div>
</body>
</html>
"""


SAMPLE_LTCG_DETAILS_HTML = """<!DOCTYPE html>
<html>
<head>
  <title>Details: Weekly Lorcana Showdown | Limitless</title>
  <meta name="description" content="2026-04-20 - Core Constructed format - Ravensburger Community">
</head>
<body>
  <a href="/tournaments?game=LORCANA">Lorcana</a>
  <div data-time="1776708000000"></div>
  <table>
    <tr class="organizer"><td>Organizer</td><td><a href="/organizer/551">Ravensburger Community</a></td></tr>
    <tr class="format"><td>Format</td><td>Core Constructed format</td></tr>
    <tr><td><img class="platform" src="/img/online.png"></td><td>Pixelborn / Webcam</td></tr>
  </table>
  <a href="https://discord.gg/lorcanatest">Join Discord</a>
  <div class="description"><p>Best of 3 Swiss rounds, open decklists!</p></div></div></div>
</body>
</html>
"""


SAMPLE_LTCG_REGISTRATIONS_HTML = """<!DOCTYPE html>
<html>
<body>
  <div>2 registrations</div>
  <table>
    <tr data-uid="alice99">
      <td><a href="/player/alice99">Alice Wonder [US]</a></td>
      <td></td>
      <td data-tooltip="Yes">✓</td>
      <td data-tooltip="Yes">📋</td>
    </tr>
    <tr data-uid="bob77">
      <td><a href="/player/bob77">Bob Builder [DE]</a></td>
      <td></td>
      <td data-tooltip="No">-</td>
      <td data-tooltip="No">-</td>
    </tr>
  </table>
</body>
</html>
"""


SAMPLE_LS_EVENT_HTML = """<!DOCTYPE html>
<html>
<head><title>Wroclaw Shatterpoint GT • Longshanks</title></head>
<body>
  <a href="https://shatterpoint.longshanks.org">Shatterpoint</a>
  <img src="/systems/shatterpoint/logo.png" title="Star Wars: Shatterpoint" />
  <div class="dates">2026-05-02</div>
  <table>
    <tr><td><img src="/img/event_size.png"></td><td>18 of 24 players</td></tr>
    <tr><td><img src="/img/event_location.png"></td><td>Bolter Cafe<br />Wroclaw, Poland <div class="flag" title="Wroclaw, Poland"></div></td></tr>
    <tr><td><img src="/img/event_host.png"></td><td><a class="player_link" href="/user/12">Mateusz Malys <span class="nickname">Mati</span></a></td></tr>
  </table>
  <div class="event_type_icon"></div><div class="text">Premier Showdown</div>
  <div class="event_status_icon"></div><div class="text">Registration Open</div>
  <table>
    <tr><th>Pairing method</th><td>Swiss</td></tr>
    <tr><th>1st</th><td>Wins</td></tr>
    <tr><th>2nd</th><td>SOS</td></tr>
  </table>
</body>
</html>
"""


SAMPLE_LS_STANDINGS_HTML = """
<div class="player" id="player_501">
  <a onclick="pop_user(501,1);">Jan Kowalski <span class="nickname">JK</span></a>
  <a onclick="pop_community(88);">Bolter Team</a>
  <img src="/systems/shatterpoint/factions/mandalorians.png" title="Mandalorians" />
</div>
"""


class TestMultiplatformEventDetails(unittest.TestCase):
    def setUp(self):
        pd_mod._preview_cache.clear()

    def test_parse_melee_tournament_view_extracts_rich_metadata(self):
        meta = parse_tournament_view(SAMPLE_MELEE_HTML, "482066")
        self.assertEqual(meta["title"], "CardCosmos FL Weekly Play")
        self.assertEqual(meta["organization_name"], "CardCosmos Flensburg")
        self.assertEqual(meta["organization_url"], "https://melee.gg/Hub/View/41022")
        self.assertEqual(meta["venue_name"], "CardCosmos Store Flensburg")
        self.assertEqual(meta["platform_type"], "Tabletop")
        self.assertEqual(meta["format_name"], "FreeForm")
        self.assertEqual(meta["entry_fee"], "Free to Play")
        self.assertEqual(meta["registration_type"], "Open Registration")
        self.assertFalse(meta["decklists_enabled"])
        self.assertEqual(meta["enrolled_players"], 4)
        self.assertEqual(meta["player_cap"], 24)
        self.assertEqual(meta["game_name"], "Disney Lorcana")
        self.assertIn("Weekly Lorcana League in Flensburg", meta["description_html"])
        self.assertIn("1 Booster per entry", meta["prizes_html"])
        self.assertIn("Weekly Lorcana League in Flensburg", meta["description"])
        self.assertIn("<h4>Prizes</h4>", meta["description"])

    def test_limitless_preview_fetches_details_and_registrations_with_elo(self):
        tid = "6adb521e91617679e849ed1b"

        def fake_get(url, timeout=4.5):
            if url.endswith("/details"):
                return SAMPLE_LTCG_DETAILS_HTML
            if url.endswith("/registrations"):
                return SAMPLE_LTCG_REGISTRATIONS_HTML
            raise AssertionError(f"Unexpected URL: {url}")

        with patch.object(pd_mod, "_http_get_text", side_effect=fake_get), patch.object(
            pd_mod,
            "_lookup_existing_player_ratings",
            return_value={"ltcg:alice99": 1642.5},
        ):
            ev = pd_mod.fetch_live_multiplatform_event_preview(f"ltcg:{tid}", db=MagicMock(), force_refresh=True)

        self.assertIsNotNone(ev)
        self.assertEqual(ev["game_system"], "lorcana")
        self.assertEqual(ev["organizer_name"], "Ravensburger Community")
        self.assertEqual(ev["organizer_url"], "https://play.limitlesstcg.com/organizer/551")
        self.assertEqual(ev["format_name"], "Core Constructed")
        self.assertEqual(ev["platform_type"], "Pixelborn / Webcam")
        self.assertEqual(ev["discord_url"], "https://discord.gg/lorcanatest")
        self.assertIn("Best of 3 Swiss rounds", ev["description"])
        self.assertEqual(ev["total_players"], 2)
        self.assertEqual(len(ev["players"]), 2)
        # Sorted descending by Elo
        self.assertEqual(ev["players"][0]["player_id"], "ltcg:alice99")
        self.assertEqual(ev["players"][0]["full_name"], "Alice Wonder")
        self.assertEqual(ev["players"][0]["team"], "US")
        self.assertEqual(ev["players"][0]["current_elo"], 1642.5)
        self.assertTrue(ev["players"][0]["checked_in"])
        self.assertTrue(ev["players"][0]["has_list"])

    def test_topdeck_preview_extracts_scoring_rules_and_commander(self):
        fs_payload = {
            "fields": {
                "Name": {"stringValue": "Saturday cEDH Showdown"},
                "Game": {"stringValue": "Magic: The Gathering"},
                "Format": {"stringValue": "EDH"},
                "StartDate": {"integerValue": "1777000000"},
                "C:RoundTime": {"integerValue": "80"},
                "C:BestOf": {"integerValue": "1"},
                "C:WinPoints": {"integerValue": "5"},
                "C:DrawPoints": {"integerValue": "1"},
                "S1:R1:C:Type": {"stringValue": "Pods"},
                "MaxPlayers": {"integerValue": "64"},
                "Description": {"stringValue": "Proxy-friendly cEDH 80-minute rounds!"},
                "X:hub123": {"mapValue": {"fields": {"role": {"stringValue": "owner"}}}},
                "E1:P1": {"stringValue": "u_td_1"},
            }
        }
        pdata_payload = {
            "u_td_1": {
                "name": "Commander Pilot",
                "decklist": "~~Commanders~~\n1 Tymna the Weaver\n1 Krailin\n~~Mainboard~~\n1 Sol Ring\n",
            }
        }

        def fake_get(url, timeout=4.0):
            if "/tournaments/" in url:
                return json.dumps(fs_payload)
            if "/PublicPData/" in url:
                return json.dumps(pdata_payload)
            raise AssertionError(f"Unexpected URL: {url}")

        with patch.object(pd_mod, "_http_get_text", side_effect=fake_get), patch.object(
            pd_mod, "get_topdeck_hubs_map", return_value={"hub123": {"name": "Mox Boarding House", "venue": "Mox Seattle", "city": "Seattle", "state": "WA"}}
        ), patch.object(pd_mod, "_lookup_existing_player_ratings", return_value={"td:u_td_1": 1588.0}):
            ev = pd_mod.fetch_live_multiplatform_event_preview("td:cedhTest1", db=MagicMock(), force_refresh=True)

        self.assertIsNotNone(ev)
        self.assertTrue(ev["is_ffa_event"])
        self.assertEqual(ev["organizer_name"], "Mox Boarding House")
        self.assertEqual(ev["venue_name"], "Mox Seattle")
        self.assertEqual(ev["player_cap"], 64)
        self.assertEqual(ev["round_time_minutes"], 80)
        self.assertIn("80m Rounds", ev["scoring_summary"])
        self.assertIn("Win 5 pts / Draw 1 pts", ev["scoring_summary"])
        self.assertEqual(ev["description"], "Proxy-friendly cEDH 80-minute rounds!")
        self.assertEqual(len(ev["players"]), 1)
        self.assertEqual(ev["players"][0]["current_elo"], 1588.0)
        self.assertIn("Tymna the Weaver", ev["players"][0]["faction"])

    def test_longshanks_preview_parses_venue_host_and_preregistered_players(self):
        def fake_ls_get(url, timeout=5.0, retries=1):
            if "/event/37867/" in url:
                return SAMPLE_LS_EVENT_HTML
            if "panel_standings.php" in url:
                return SAMPLE_LS_STANDINGS_HTML
            raise AssertionError(f"Unexpected URL: {url}")

        with patch("scripts.sync_multiplatform._ls_get_text", side_effect=fake_ls_get), patch.object(
            pd_mod, "_lookup_existing_player_ratings", return_value={"ls:501": 1615.0}
        ):
            ev = pd_mod.fetch_live_multiplatform_event_preview("ls:37867", db=MagicMock(), force_refresh=True)

        self.assertIsNotNone(ev)
        self.assertEqual(ev["game_system"], "shatterpoint")
        self.assertEqual(ev["venue_name"], "Bolter Cafe")
        self.assertEqual(ev["city"], "Wroclaw")
        self.assertEqual(ev["country"], "Poland")
        self.assertEqual(ev["organizer_name"], "Mateusz Malys")
        self.assertEqual(ev["player_cap"], 24)
        self.assertEqual(ev["total_players"], 18)
        self.assertIn("Premier Showdown • Swiss", ev["format_name"])
        self.assertIn("Tiebreakers:", ev["description"])
        self.assertEqual(len(ev["players"]), 1)
        self.assertEqual(ev["players"][0]["player_id"], "ls:501")
        self.assertEqual(ev["players"][0]["full_name"], "Jan Kowalski")
        self.assertEqual(ev["players"][0]["team"], "Bolter Team")
        self.assertEqual(ev["players"][0]["current_elo"], 1615.0)

    def test_sync_api_event_details_enriches_completed_multiplatform_event(self):
        import routers.leaderboard as lb

        lb._event_details_cache.pop("melee:490752", None)

        class _FakeProdDb:
            def get_event_details(self, eid):
                return {
                    "id": eid,
                    "name": "Common Grounds Lorcana Set Champs",
                    "event_date": "2026-04-10T18:00:00Z",
                    "venue_name": "Melee.gg",
                    "venue": "Melee.gg",
                    "game_system": "lorcana",
                    "is_ended": True,
                    "num_rounds": 4,
                    "total_players": 1,
                    "players": [
                        {
                            "player_id": "melee:champ1",
                            "full_name": "Champ One",
                            "faction": "Ruby / Amethyst",
                            "current_elo": 1620.0,
                            "placement": 1,
                            "event_wins": 4,
                            "event_losses": 0,
                            "event_draws": 0,
                        }
                    ],
                    "matches": [
                        {
                            "match_id": "m1",
                            "round": 1,
                            "player1_id": "melee:champ1",
                            "player2_id": "melee:opp1",
                            "winner_id": "melee:champ1",
                        }
                    ],
                    "raw_json": {"platform": "melee", "id": "490752"},
                }

        fake_db = _FakeProdDb()
        enriched_preview = {
            "id": "melee:490752",
            "venue_name": "Common Grounds LGS",
            "venue": "Common Grounds LGS",
            "organizer_name": "Common Grounds Gaming",
            "organizer_url": "https://melee.gg/Hub/View/999",
            "format_name": "Core",
            "platform_type": "Tabletop",
            "entry_fee": "$15.00",
            "player_cap": 32,
            "description": "<p>Set Championship event details!</p>",
            "raw_json": {
                "organization_name": "Common Grounds Gaming",
                "format_name": "Core",
                "platform_type": "Tabletop",
                "description": "<p>Set Championship event details!</p>",
            },
        }

        with patch("routers.leaderboard.get_database", return_value=fake_db), patch(
            "scripts.platform_discovery.fetch_live_multiplatform_event_preview",
            return_value=enriched_preview,
        ) as mock_prev:
            res = lb._sync_api_event_details("melee:490752", force_sync=False, bypass_cache=True)

        mock_prev.assert_called_once()
        # Because DB already has players, include_standings must be False for fast single-GET metadata fetch
        self.assertFalse(mock_prev.call_args.kwargs.get("include_standings", True))
        self.assertEqual(res["venue_name"], "Common Grounds LGS")
        self.assertEqual(res["organizer_name"], "Common Grounds Gaming")
        self.assertEqual(res["format_name"], "Core")
        self.assertEqual(res["platform_type"], "Tabletop")
        self.assertEqual(res["entry_fee"], "$15.00")
        self.assertEqual(res["player_cap"], 32)
        self.assertIn("Set Championship event details!", res["description"])
        self.assertEqual(res["event_url"], "https://melee.gg/Tournament/View/490752")

    def test_database_and_frontend_multiplatform_details_wiring(self):
        with open(os.path.join(REPO_ROOT, "database.py"), "r", encoding="utf-8") as f:
            db_src = f.read()
        self.assertIn("WHEN id LIKE '%:%' AND raw_json IS NOT NULL", db_src)

        with open(os.path.join(REPO_ROOT, "web", "js", "tournaments.js"), "r", encoding="utf-8") as f:
            t_js = f.read()
        self.assertIn("function extractEventRichDetails(", t_js)
        self.assertIn("function buildEventRichDetailsCardHtml(", t_js)
        self.assertNotIn("Synced from Best Coast Pairings", t_js)
        self.assertNotIn("🔗 BCP Event Page ↗", t_js)

        with open(os.path.join(REPO_ROOT, "web", "version.json"), "r", encoding="utf-8") as f:
            ver = json.load(f)["version"]
        with open(os.path.join(REPO_ROOT, "web", "app.html"), "r", encoding="utf-8") as f:
            app_html = f.read()
        self.assertIn(f"app.bundle.min.js?v={ver}", app_html)


if __name__ == "__main__":
    unittest.main()
