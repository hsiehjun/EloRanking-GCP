#!/usr/bin/env python3
"""
Lightweight development server for OmniTactica and Warhammer 40k Game Tracker.
Uses only Python standard library (no external dependencies required).
"""

import http.server
import os
import sys
import json
import mimetypes
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 5174))
HOST = "0.0.0.0"

REPO_ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = REPO_ROOT / "web"
TRACKER_DIR = WEB_DIR / "tracker"
TRACKER_STATIC_DIR = TRACKER_DIR / "static"

ROOMS_DB = {}

DEV_USER = {
    "authenticated": True,
    "user": {
        "id": "dev_commander",
        "username": "Commander",
        "display_name": "Commander",
        "email": "commander@omnitactica.com",
        "role": "admin"
    }
}

AUTH_INJECTION = """<script>
  (function() {
    try {
      localStorage.setItem('elo_auth_token', 'dev-auth-token-123');
      localStorage.setItem('native_session_token', 'dev-auth-token-123');
      sessionStorage.setItem('elo_auth_token', 'dev-auth-token-123');
      document.cookie = 'session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax';
    } catch (e) {}
  })();
</script>
"""

class OmniTacticaDevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_HEAD(self):
        self._handle_request(is_head=True)

    def do_GET(self):
        self._handle_request(is_head=False)

    def do_POST(self):
        clean_path = self.path.split("?")[0].strip("/")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else b"{}"

        if clean_path in ("api/auth/login", "api/auth/register"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Set-Cookie", "session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "token": "dev-auth-token-123", **DEV_USER}).encode("utf-8"))
            return

        if clean_path == "api/tracker/room/create":
            match_id = "WH40K-DEV1"
            res = {
                "success": True,
                "match_id": match_id,
                "role": "player1",
                "p1_name": "Player 1",
                "p2_name": "Player 2",
                "state": None
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path.startswith("api/tracker/"):
            try:
                payload = json.loads(body.decode("utf-8"))
            except Exception:
                payload = {}

            room_id = clean_path.replace("api/tracker/", "").replace("room/", "").strip("/")
            if room_id:
                ROOMS_DB[room_id] = payload

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "match_id": room_id or "WH40K-DEV1"}).encode("utf-8"))
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(b'{"status": "ok"}')

    def _handle_request(self, is_head=False):
        raw_path = self.path.split("?")[0]
        query_str = self.path.split("?")[1] if "?" in self.path else ""
        clean_path = raw_path.strip("/")
        import urllib.parse
        query_params = urllib.parse.parse_qs(query_str)

        # 1. API routes
        if clean_path in ("api/auth/me", "api/auth/session"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(DEV_USER).encode("utf-8"))
            return

        if clean_path in ("api/tracker/history",):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "history": []}).encode("utf-8"))
            return

        if clean_path.endswith("/check"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "exists": True, "is_finished": False}).encode("utf-8"))
            return

        if clean_path.startswith("api/player/"):
            import urllib.parse
            pid = urllib.parse.unquote(clean_path.replace("api/player/", "").strip("/"))
            if "john" in pid.lower():
                res = {
                    "player": {
                        "player_id": "p_john_doe",
                        "player_name": "John Doe",
                        "team": "Team Zero Comp",
                        "teams_history": ["Team Zero Comp"],
                        "top_faction": "Adeptus Astartes, Necrons",
                        "current_elo": 1650.0,
                        "peak_elo": 1680.0,
                        "wins": 45,
                        "losses": 20,
                        "draws": 1,
                        "win_rate": 68.2,
                        "total_matches": 66
                    },
                    "has_account": False,
                    "longest_win_streak": 8,
                    "history": []
                }
            else:
                # Default to Folger Pyles profile matching the user's test scenario
                res = {
                    "player": {
                        "player_id": "p_folger_pyles",
                        "player_name": "Folger Pyles",
                        "team": "Art of War",
                        "teams_history": [
                            "Art of War",
                            "Team USA",
                            "Gem Wargaming",
                            "Battle Brothers Wargaming",
                            "Bookery Battle Brothers",
                            "Gemhammer",
                            "Watchers in the dark"
                        ],
                        "top_faction": "Adeptus Custodes, Aeldari, Necrons, Drukhari, Imperial Agents, Chaos Space Marines, Ynnari, Death Guard, World Eaters",
                        "current_elo": 2495.2,
                        "peak_elo": 2495.2,
                        "wins": 290,
                        "losses": 30,
                        "draws": 2,
                        "win_rate": 90.1,
                        "total_matches": 322
                    },
                    "has_account": False,
                    "longest_win_streak": 36,
                    "history": [
                        {
                            "match_date": "2022-04-16",
                            "event_name": "GemHammer RTT April 2022",
                            "round": "R1",
                            "result": "W",
                            "player_score": 69,
                            "opponent_score": 63,
                            "player_faction": "Adeptus Custodes",
                            "opponent_name": "GemHammer RTT April 2022",
                            "opponent_elo": 1820.0,
                            "delta_elo": 12.4,
                            "new_elo": 2495.2
                        },
                        {
                            "match_date": "2022-04-16",
                            "event_name": "GemHammer RTT April 2022",
                            "round": "R2",
                            "result": "L",
                            "player_score": 61,
                            "opponent_score": 72,
                            "player_faction": "Adeptus Custodes",
                            "opponent_name": "Opponent",
                            "opponent_elo": 1900.0,
                            "delta_elo": -8.1,
                            "new_elo": 2487.1
                        }
                    ]
                }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path in ("api/leaderboard", "api/players", "api/events", "api/teams", "api/community/feed", "api/notifications/unread-count"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"players": [], "events": [], "teams": [], "count": 0}).encode("utf-8"))
            return

        if clean_path.startswith("api/predict/faction"):
            f1_val = query_params.get("f1", ["Space Marines"])[0]
            f2_val = query_params.get("f2", ["Aeldari"])[0]
            # Mock Bayesian Prediction data
            res = {
                "f1": {
                    "name": f1_val,
                    "win_rate": 52.4,
                    "tier": "S",
                    "avg_score": 76.8,
                    "total_matches": 1420,
                    "spotlight_prey": {"opponent_faction": "Orks", "win_rate": 68.0, "total_matches": 25, "wins": 17, "losses": 8},
                    "spotlight_nemesis": {"opponent_faction": "Aeldari", "win_rate": 41.5, "total_matches": 31, "wins": 13, "losses": 18}
                },
                "f2": {
                    "name": f2_val,
                    "win_rate": 55.1,
                    "tier": "S",
                    "avg_score": 81.2,
                    "total_matches": 1105,
                    "spotlight_prey": {"opponent_faction": "Imperial Knights", "win_rate": 72.0, "total_matches": 18, "wins": 13, "losses": 5},
                    "spotlight_nemesis": {"opponent_faction": "Adeptus Custodes", "win_rate": 44.0, "total_matches": 22, "wins": 10, "losses": 12}
                },
                "prediction": {
                    "f1_win_prob": 44.2,
                    "f2_win_prob": 55.8,
                    "favorite": f2_val,
                    "advantage_pts": 11.6
                },
                "head_to_head": {
                    "total_games": 31,
                    "f1_wins": 13,
                    "f2_wins": 18,
                    "draws": 0,
                    "f1_actual_win_rate": 41.9,
                    "f2_actual_win_rate": 58.1,
                    "f1_avg_score": 73.5,
                    "f2_avg_score": 82.1,
                    "score_differential": -8.6
                },
                "clashes": [
                    {
                        "id": "m_clash_1",
                        "event_id": "e_lgt_2026",
                        "event_name": "LGT Masters 2026",
                        "round": 5,
                        "match_date": "2026-08-28",
                        "f1_player_id": "p_jack_m",
                        "f1_player_name": "Jack Murphy",
                        "f1_score": 68,
                        "f2_player_id": "p_elena_r",
                        "f2_player_name": "Elena Rostova",
                        "f2_score": 84,
                        "winner_side": "f2"
                    },
                    {
                        "id": "m_clash_2",
                        "event_id": "e_nova_2026",
                        "event_name": "Nova Open 2026",
                        "round": 3,
                        "match_date": "2026-08-15",
                        "f1_player_id": "p_marcus_v",
                        "f1_player_name": "Marcus Vance",
                        "f1_score": 88,
                        "f2_player_id": "p_yriel_s",
                        "f2_player_name": "Yriel Swiftwind",
                        "f2_score": 75,
                        "winner_side": "f1"
                    },
                    {
                        "id": "m_clash_3",
                        "event_id": "e_crucible_2026",
                        "event_name": "Crucible GT 2026",
                        "round": 2,
                        "match_date": "2026-07-20",
                        "f1_player_id": "p_dev_commander",
                        "f1_player_name": "Commander",
                        "f1_score": 52,
                        "f2_player_id": "p_elena_r",
                        "f2_player_name": "Elena Rostova",
                        "f2_score": 78,
                        "winner_side": "f2"
                    }
                ]
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path.startswith("api/predict"):
            p1_id = query_params.get("p1", ["p1"])[0]
            p2_id = query_params.get("p2", ["p2"])[0]
            res = {
                "p1_win_prob": 56.4,
                "p2_win_prob": 43.6,
                "deltas": {
                    "p1_win": 13.8,
                    "p2_win": 18.2,
                    "p1_draw": -2.2,
                    "p2_draw": 2.2
                },
                "head_to_head": []
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path.startswith("api/factions/meta"):
            factions_list = [
                {"faction": "Aeldari", "win_rate": 55.1, "tier": "S", "total_matches": 1105, "avg_score": 81.2},
                {"faction": "Space Marines", "win_rate": 52.4, "tier": "S", "total_matches": 1420, "avg_score": 76.8},
                {"faction": "Necrons", "win_rate": 51.8, "tier": "A", "total_matches": 1280, "avg_score": 78.4},
                {"faction": "Adeptus Custodes", "win_rate": 51.2, "tier": "A", "total_matches": 950, "avg_score": 75.6},
                {"faction": "Chaos Space Marines", "win_rate": 50.5, "tier": "A", "total_matches": 1120, "avg_score": 74.2},
                {"faction": "Tyranids", "win_rate": 49.6, "tier": "B", "total_matches": 980, "avg_score": 72.1},
                {"faction": "Orks", "win_rate": 48.2, "tier": "B", "total_matches": 890, "avg_score": 69.8},
                {"faction": "Imperial Knights", "win_rate": 47.5, "tier": "B", "total_matches": 650, "avg_score": 71.0},
                {"faction": "World Eaters", "win_rate": 46.8, "tier": "C", "total_matches": 540, "avg_score": 68.5},
                {"faction": "Drukhari", "win_rate": 45.9, "tier": "C", "total_matches": 490, "avg_score": 70.2}
            ]
            monthly_trends = []
            for f in factions_list:
                monthly_trends.append({"faction": f["faction"], "matches_in_month": f["total_matches"], "month": "2026-08", "win_rate": f["win_rate"]})
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"factions": factions_list, "monthly_trends": monthly_trends}).encode("utf-8"))
            return

        if clean_path.startswith("api/faction/"):
            raw_fac = clean_path.replace("api/faction/", "").strip("/")
            import urllib.parse
            fac_name = urllib.parse.unquote(raw_fac)
            res = {
                "faction": fac_name,
                "matches": [
                    {
                        "id": "m_fac_1",
                        "event_id": "e_lgt_2026",
                        "event_name": "LGT Masters 2026",
                        "round": 1,
                        "outcome": "W",
                        "player_score": 85,
                        "opponent_score": 52,
                        "match_date": "2026-08-28",
                        "player_name": "Commander",
                        "opponent_name": "Marcus Vance",
                        "opponent_faction": "Orks"
                    },
                    {
                        "id": "m_fac_2",
                        "event_id": "e_nova_2026",
                        "event_name": "Nova Open 2026",
                        "round": 2,
                        "outcome": "L",
                        "player_score": 60,
                        "opponent_score": 84,
                        "match_date": "2026-08-15",
                        "player_name": "Commander",
                        "opponent_name": "Elena Rostova",
                        "opponent_faction": "Aeldari"
                    }
                ],
                "top_players": [
                    {
                        "player_id": "p_dev_commander",
                        "player_name": "Commander",
                        "team": "Iron Hands Veterans",
                        "current_elo": 1845.5,
                        "peak_elo": 1890.0,
                        "wins": 27,
                        "losses": 13,
                        "win_rate": 67.5
                    }
                ],
                "matchups": [
                    {
                        "opponent_faction": "Orks",
                        "total_matches": 25,
                        "wins": 17,
                        "losses": 8,
                        "draws": 0,
                        "win_rate": 68.0
                    },
                    {
                        "opponent_faction": "Necrons",
                        "total_matches": 20,
                        "wins": 13,
                        "losses": 7,
                        "draws": 0,
                        "win_rate": 65.0
                    },
                    {
                        "opponent_faction": "Tyranids",
                        "total_matches": 15,
                        "wins": 9,
                        "losses": 6,
                        "draws": 0,
                        "win_rate": 60.0
                    },
                    {
                        "opponent_faction": "Chaos Space Marines",
                        "total_matches": 18,
                        "wins": 9,
                        "losses": 9,
                        "draws": 0,
                        "win_rate": 50.0
                    },
                    {
                        "opponent_faction": "Adeptus Custodes",
                        "total_matches": 14,
                        "wins": 6,
                        "losses": 8,
                        "draws": 0,
                        "win_rate": 42.9
                    },
                    {
                        "opponent_faction": "Aeldari",
                        "total_matches": 31,
                        "wins": 13,
                        "losses": 18,
                        "draws": 0,
                        "win_rate": 41.9
                    }
                ]
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path in ("api/user/dashboard",):
            res = {
                "player": {
                    "player_id": "p_dev_commander",
                    "player_name": "Commander",
                    "top_faction": "Space Marines",
                    "current_elo": 1845.5,
                    "peak_elo": 1890.0,
                    "win_rate": 67.5,
                    "matches_played": 40,
                    "wins": 27,
                    "losses": 13,
                    "team": "Iron Hands Veterans"
                },
                "rankings": {
                    "global_rank": 142,
                    "faction_rank": 18,
                    "total_ranked_players": 77322
                },
                "matchup_matrix": [
                    {
                        "enemy_faction": "Orks",
                        "total_encounters": 10,
                        "wins": 8,
                        "losses": 2,
                        "draws": 0,
                        "win_rate": 80.0
                    },
                    {
                        "enemy_faction": "Necrons",
                        "total_encounters": 8,
                        "wins": 6,
                        "losses": 2,
                        "draws": 0,
                        "win_rate": 75.0
                    },
                    {
                        "enemy_faction": "Chaos Space Marines",
                        "total_encounters": 7,
                        "wins": 5,
                        "losses": 2,
                        "draws": 0,
                        "win_rate": 71.4
                    },
                    {
                        "enemy_faction": "Tyranids",
                        "total_encounters": 5,
                        "wins": 4,
                        "losses": 1,
                        "draws": 0,
                        "win_rate": 80.0
                    },
                    {
                        "enemy_faction": "Aeldari",
                        "total_encounters": 6,
                        "wins": 1,
                        "losses": 5,
                        "draws": 0,
                        "win_rate": 16.7
                    },
                    {
                        "enemy_faction": "World Eaters",
                        "total_encounters": 3,
                        "wins": 2,
                        "losses": 1,
                        "draws": 0,
                        "win_rate": 66.7
                    },
                    {
                        "enemy_faction": "Imperial Knights",
                        "total_encounters": 1,
                        "wins": 1,
                        "losses": 0,
                        "draws": 0,
                        "win_rate": 100.0
                    }
                ],
                "faction_mastery": [
                    {
                        "faction": "Space Marines",
                        "games": 30,
                        "wins": 21,
                        "losses": 9,
                        "draws": 0,
                        "win_rate": 70.0,
                        "avg_score": 78.5
                    },
                    {
                        "faction": "Adeptus Custodes",
                        "games": 10,
                        "wins": 6,
                        "losses": 4,
                        "draws": 0,
                        "win_rate": 60.0,
                        "avg_score": 72.0
                    }
                ],
                "history": [
                    {
                        "match_date": "2026-05-10",
                        "event_name": "Warhammer Open Atlanta",
                        "round": "R1",
                        "result": "W",
                        "player_score": 85,
                        "opponent_score": 45,
                        "player_faction": "Space Marines",
                        "opponent_name": "Marcus Vance",
                        "opponent_elo": 1720.0,
                        "opponent_faction": "Orks",
                        "delta_elo": 12.0,
                        "new_elo": 1780.0
                    },
                    {
                        "match_date": "2026-06-14",
                        "event_name": "Lone Star Open 2026",
                        "round": "R2",
                        "result": "L",
                        "player_score": 52,
                        "opponent_score": 78,
                        "player_faction": "Space Marines",
                        "opponent_name": "Elena Rostova",
                        "opponent_elo": 1910.0,
                        "opponent_faction": "Aeldari",
                        "delta_elo": -10.5,
                        "new_elo": 1795.0
                    },
                    {
                        "match_date": "2026-07-20",
                        "event_name": "Crucible GT 2026",
                        "round": "R3",
                        "result": "W",
                        "player_score": 90,
                        "opponent_score": 55,
                        "player_faction": "Space Marines",
                        "opponent_name": "Gorgutz 'Eadsplitter",
                        "opponent_elo": 1750.0,
                        "opponent_faction": "Orks",
                        "delta_elo": 14.2,
                        "new_elo": 1815.0
                    },
                    {
                        "match_date": "2026-08-01",
                        "event_name": "Bay Area Cup 2026",
                        "round": "R4",
                        "result": "W",
                        "player_score": 88,
                        "opponent_score": 60,
                        "player_faction": "Space Marines",
                        "opponent_name": "Waaagh Boss Da Boss",
                        "opponent_elo": 1800.0,
                        "opponent_faction": "Orks",
                        "delta_elo": 15.0,
                        "new_elo": 1830.0
                    },
                    {
                        "match_date": "2026-08-15",
                        "event_name": "Nova Open 2026",
                        "round": "R5",
                        "result": "L",
                        "player_score": 45,
                        "opponent_score": 82,
                        "player_faction": "Space Marines",
                        "opponent_name": "Farseer Eldrad",
                        "opponent_elo": 1950.0,
                        "opponent_faction": "Aeldari",
                        "delta_elo": -11.0,
                        "new_elo": 1825.0
                    },
                    {
                        "match_date": "2026-08-28",
                        "event_name": "LGT Masters 2026",
                        "round": "R6",
                        "result": "L",
                        "player_score": 58,
                        "opponent_score": 80,
                        "player_faction": "Space Marines",
                        "opponent_name": "Yriel Swiftwind",
                        "opponent_elo": 1920.0,
                        "opponent_faction": "Aeldari",
                        "delta_elo": -9.5,
                        "new_elo": 1830.5
                    },
                    {
                        "match_date": "2026-09-02",
                        "event_name": "Ironclad Invitational 2026",
                        "round": "R7",
                        "result": "W",
                        "player_score": 95,
                        "opponent_score": 42,
                        "player_faction": "Space Marines",
                        "opponent_name": "Big Mek Ghaz",
                        "opponent_elo": 1810.0,
                        "opponent_faction": "Orks",
                        "delta_elo": 15.0,
                        "new_elo": 1845.5
                    }
                ],
                "tracker_history": [],
                "active_sessions": [],
                "events_attended": [],
                "upcoming_events": []
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path.startswith("api/tracker/"):
            room_id = clean_path.replace("api/tracker/", "").replace("room/", "").strip("/")
            data = ROOMS_DB.get(room_id, {})
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "match_id": room_id or "WH40K-DEV1", "data": data, "state": None}).encode("utf-8"))
            return

        if clean_path in ("app", "app.html"):
            self._serve_html_with_auth(WEB_DIR / "app.html", is_head)
            return

        # 2. Redirects to /11th/tracker/play
        # Ensuring the URL has /play guarantees isPlay=true in tracker_sync.js
        if clean_path in ("", "login", "tracker", "11th/tracker"):
            target = f"/11th/tracker/play{('?' + query_str) if query_str else ''}"
            self.send_response(302)
            self.send_header("Location", target)
            self.send_header("Set-Cookie", "session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax")
            self.end_headers()
            return

        # 3. Game Tracker Play SPA
        if clean_path in ("11th/tracker/play", "tracker/play"):
            self._serve_html_with_auth(TRACKER_DIR / "play.html", is_head)
            return

        if clean_path in ("11th/tracker/lobby", "tracker/lobby"):
            self._serve_html_with_auth(TRACKER_DIR / "lobby.html", is_head)
            return

        # 4. Bundle & Sync Assets
        if clean_path in ("tracker/bundle.js", "11th/tracker/bundle.js", "bundle.js"):
            self._serve_file(TRACKER_DIR / "bundle.js", "application/javascript; charset=utf-8", is_head)
            return

        if clean_path in ("tracker/tracker_sync.js", "11th/tracker/tracker_sync.js"):
            self._serve_file(TRACKER_DIR / "tracker_sync.js", "application/javascript; charset=utf-8", is_head)
            return

        if clean_path in ("tracker/tracker_sync.css", "11th/tracker/tracker_sync.css"):
            self._serve_file(TRACKER_DIR / "tracker_sync.css", "text/css; charset=utf-8", is_head)
            return

        # 5. _next static assets
        if clean_path.startswith("_next/"):
            rel = clean_path.replace("_next/", "")
            target = TRACKER_STATIC_DIR / "_next" / rel
            if target.is_file():
                self._serve_file(target, is_head=is_head)
                return
            fallback = REPO_ROOT.parent / "gdm-tracker-standalone" / "_next" / rel
            if fallback.is_file():
                self._serve_file(fallback, is_head=is_head)
                return

        # 6. Direct file resolution in WEB_DIR
        local_web = WEB_DIR / clean_path
        if local_web.is_file():
            self._serve_file(local_web, is_head=is_head)
            return

        # 7. Check in TRACKER_STATIC_DIR
        local_static = TRACKER_STATIC_DIR / clean_path
        if local_static.is_file():
            self._serve_file(local_static, is_head=is_head)
            return

        # Fallback to play.html
        self._serve_html_with_auth(TRACKER_DIR / "play.html", is_head)

    def _serve_html_with_auth(self, file_path: Path, is_head=False):
        if not file_path.is_file():
            self.send_error(404, f"File Not Found: {file_path.name}")
            return
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

            if "<head>" in content:
                content = content.replace("<head>", f"<head>\n{AUTH_INJECTION}", 1)

            encoded = content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Set-Cookie", "session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax")
            self.end_headers()
            if not is_head:
                self.wfile.write(encoded)
        except Exception as e:
            self.send_error(500, f"Internal Server Error: {e}")

    def _serve_file(self, file_path: Path, content_type: str = None, is_head=False):
        if not file_path.is_file():
            self.send_error(404, f"File Not Found: {file_path.name}")
            return
        
        if not content_type:
            content_type, _ = mimetypes.guess_type(str(file_path))
            if not content_type:
                content_type = "application/octet-stream"

        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            if not is_head:
                self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Internal Server Error: {e}")

class ThreadedHTTPServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

def main():
    print(f"--> Starting OmniTactica Game Tracker dev server on http://{HOST}:{PORT}")
    print(f"    Serving web directory: {WEB_DIR}")
    print(f"    Proxy URL: http://hsiehjun-high-perf-2.c.googlers.com:{PORT}/11th/tracker/play")
    httpd = ThreadedHTTPServer((HOST, PORT), OmniTacticaDevHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("--> Shutting down server.")
    finally:
        httpd.server_close()

if __name__ == "__main__":
    main()
