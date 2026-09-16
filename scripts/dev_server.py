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
import urllib.parse
import secrets
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 5174))
HOST = "0.0.0.0"

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
WEB_DIR = REPO_ROOT / "web"
TRACKER_DIR = WEB_DIR / "tracker"
TRACKER_STATIC_DIR = TRACKER_DIR / "static"

ROOMS_DB = {
    "WH40K-DEV1": {
        "is_finished": False,
        "status": "active",
        "state": {
            "game": {
                "p1Name": "Innes Wilson",
                "p2Name": "David Gaylard",
                "p1Faction": "Adeptus Custodes",
                "p2Faction": "Necrons",
                "p1Detachments": ["Shield Host"],
                "p2Detachments": ["Canoptek Court"],
                "roundNum": 3,
                "tableNum": 1,
                "eventId": "US Open Atlanta 2026"
            },
            "p1": {
                "battleReady": True,
                "rounds": [
                    {"primaryScore": 8, "round": 1},
                    {"primaryScore": 12, "round": 2},
                    {"primaryScore": 12, "round": 3}
                ],
                "hand": [
                    {"name": "Cleanse", "scoredRound": 1, "points": 4, "score": 4, "state": "scored"},
                    {"name": "Deploy Teleport Homers", "scoredRound": 2, "points": 8, "score": 8, "state": "scored"},
                    {"name": "Assassination", "scoredRound": 3, "points": 5, "score": 5, "state": "scored"}
                ]
            },
            "p2": {
                "battleReady": True,
                "rounds": [
                    {"primaryScore": 8, "round": 1},
                    {"primaryScore": 8, "round": 2},
                    {"primaryScore": 12, "round": 3}
                ],
                "hand": [
                    {"name": "Storm Hostile Objective", "scoredRound": 1, "points": 4, "score": 4, "state": "scored"},
                    {"name": "Establish Locus", "scoredRound": 2, "points": 4, "score": 4, "state": "scored"},
                    {"name": "Extend Battle Lines", "scoredRound": 3, "points": 4, "score": 4, "state": "scored"}
                ]
            }
        }
    },
    "AOS-DEV1": {
        "is_finished": False,
        "status": "active",
        "game_system": "aos",
        "state": {
            "id": "AOS-DEV1",
            "gameSystem": "aos",
            "edition": "4e-ghb24",
            "battleplan": {
                "id": "border-war",
                "name": "Border War",
                "maxPrimaryPerRound": 6
            },
            "round": 3,
            "currentTurnPlayer": "p1",
            "started": True,
            "is_finished": False,
            "roundState": {
                "1": {"priorityWinner": "p1", "firstTurn": "p1", "secondTurn": "p2", "isDoubleTurn": False, "forfeitsBattleTactic": False},
                "2": {"priorityWinner": "p2", "firstTurn": "p2", "secondTurn": "p1", "isDoubleTurn": False, "forfeitsBattleTactic": False},
                "3": {"priorityWinner": "p1", "firstTurn": "p1", "secondTurn": "p2", "isDoubleTurn": False, "forfeitsBattleTactic": False}
            },
            "p1": {
                "name": "Innes Wilson",
                "grandAlliance": "Order",
                "faction": "stormcast-eternals",
                "battleFormation": "Lightning Echelon",
                "cp": 2,
                "rounds": [
                    {"round": 1, "primaryScore": 6, "tacticStatus": "achieved", "tacticScore": 4, "tacticId": "take-the-flanks"},
                    {"round": 2, "primaryScore": 4, "tacticStatus": "achieved", "tacticScore": 4, "tacticId": "seize-the-centre"},
                    {"round": 3, "primaryScore": 4, "tacticStatus": "selected", "tacticScore": 0, "tacticId": "slay-the-warlord"}
                ]
            },
            "p2": {
                "name": "David Gaylard",
                "grandAlliance": "Chaos",
                "faction": "skaven",
                "battleFormation": "Warpcog Convocation",
                "cp": 3,
                "rounds": [
                    {"round": 1, "primaryScore": 4, "tacticStatus": "achieved", "tacticScore": 4, "tacticId": "restless-incursion"},
                    {"round": 2, "primaryScore": 4, "tacticStatus": "failed", "tacticScore": 0, "tacticId": "attack-on-two-fronts"},
                    {"round": 3, "primaryScore": 4, "tacticStatus": "selected", "tacticScore": 0, "tacticId": "surge-of-power"}
                ]
            }
        }
    }
}

def get_persona_user(persona):
    if persona == "spectator":
        return {
            "authenticated": True,
            "user": {
                "id": "viewer_guest_999",
                "username": "casual_spectator",
                "display_name": "Casual Spectator",
                "role": "player",
                "is_admin": False,
                "is_cc": False,
                "can_access_to": False,
                "can_access_cc": False,
                "bcp_connected": False,
                "player_id": "viewer_guest_999"
            }
        }
    if persona == "creator":
        return {
            "authenticated": True,
            "user": {
                "id": "dev_creator_wgl",
                "username": "wargames_live",
                "display_name": "Wargames Live (Caster)",
                "role": "creator",
                "is_admin": False,
                "is_cc": True,
                "can_access_cc": True,
                "can_access_to": False,
                "bcp_connected": True
            }
        }
    if persona == "to":
        return {
            "authenticated": True,
            "user": {
                "id": "dev_to_admin",
                "username": "tournament_director",
                "display_name": "Head Tournament Organizer",
                "role": "to",
                "is_admin": True,
                "can_access_to": True,
                "bcp_connected": True
            }
        }
    # default: competitor (Innes Wilson)
    return {
        "authenticated": True,
        "user": {
            "id": "p_innes",
            "username": "innes_wilson",
            "display_name": "Innes Wilson",
            "role": "player",
            "is_admin": False,
            "is_cc": False,
            "can_access_to": False,
            "can_access_cc": False,
            "bcp_connected": True,
            "player_id": "p_innes",
            "bcp_player_id": "p_innes",
            "first_name": "Innes",
            "last_name": "Wilson"
        }
    }

DEV_USER = get_persona_user("competitor")


AUTH_INJECTION = """<script>
  (function() {
    try {
      localStorage.setItem('elo_auth_token', 'dev-auth-token-123');
      localStorage.setItem('native_session_token', 'dev-auth-token-123');
      sessionStorage.setItem('elo_auth_token', 'dev-auth-token-123');
      localStorage.setItem('pwa_install_dismissed', String(Date.now()));
      document.cookie = 'session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax';
    } catch (e) {}

    window.addEventListener('load', function() {
      var qp = new URLSearchParams(window.location.search);
      var openModal = qp.get('open_modal');
      var action = qp.get('action');
      var subtab = qp.get('subtab');

      setTimeout(function() {
        if (subtab && typeof window.switchCommunitySubtab === 'function') {
          window.switchCommunitySubtab(subtab);
        }
        if (action === 'reset_my_hub') {
          if (typeof window.switchTab === 'function') window.switchTab('my-hub');
          if (typeof window.resetMyHubToProfile === 'function') window.resetMyHubToProfile();
        }
        if (openModal === 'settings' && typeof window.openUserSettingsModal === 'function') {
          window.openUserSettingsModal();
          setTimeout(function() {
            var el = document.getElementById('settings-primary-faction');
            if (el) {
              el.value = "Emperor's Children";
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
          }, 200);
        } else if (openModal === 'event') {
          var eid = qp.get('event_id') || 'ev_ongoing_gt_live';
          if (typeof window.openEventHubPage === 'function') {
            window.openEventHubPage(eid, '40k');
          } else if (typeof window.openEventModal === 'function') {
            window.openEventModal(eid);
          }
        } else if (openModal === 'faction' && typeof window.openFactionModal === 'function') {
          var fname = qp.get('faction') || "Emperor's Children";
          var tf = qp.get('tf') || '1yr';
          window.openFactionModal(fname, tf);
        }
      }, 400);
    });
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
            try:
                p_load = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                p_load = {}
            is_aos = p_load.get("game_system") == "aos" or str(p_load.get("match_id", "")).startswith("AOS-")
            token = secrets.token_hex(4).upper()
            match_id = p_load.get("match_id") or (f"AOS-{token[:4]}-{token[4:]}" if is_aos else f"WH40K-{token[:4]}-{token[4:]}")
            res = {
                "success": True,
                "match_id": match_id,
                "role": "player1",
                "game_system": "aos" if is_aos else "40k",
                "p1_name": p_load.get("p1_name", "Player 1"),
                "p2_name": p_load.get("p2_name", "Player 2"),
                "state": None
            }
            ROOMS_DB[match_id] = {
                "match_id": match_id,
                "game_system": "aos" if is_aos else "40k",
                "status": "active",
                "version": 1,
                "online_count": 1,
                "state": None
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path.startswith("api/tracker/"):
            try:
                payload = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                payload = {}

            tail = clean_path.replace("api/tracker/", "")
            if tail.startswith("room/"):
                tail = tail[5:]
            sub_actions = ["/state", "/join", "/check", "/finalize", "/discard", "/clock", "/dice_tray", "/dice_roll", "/armylist"]
            action = None
            for sa in sub_actions:
                if tail.endswith(sa):
                    tail = tail[:-len(sa)].strip("/")
                    action = sa[1:]
                    break

            room_id = tail.strip("/")
            if room_id:
                if room_id not in ROOMS_DB:
                    ROOMS_DB[room_id] = {
                        "match_id": room_id,
                        "status": "active",
                        "game_system": "aos" if room_id.startswith("AOS-") else "40k",
                        "version": 1,
                        "online_count": 1,
                        "state": None
                    }

                entry = ROOMS_DB[room_id]
                if "state" in payload and payload["state"] is not None:
                    entry["state"] = payload["state"]
                    entry["version"] = payload.get("version", entry.get("version", 1) + 1)
                elif payload and any(k in payload for k in ("p1", "p2", "round", "game")):
                    entry["state"] = payload
                    entry["version"] = entry.get("version", 1) + 1

                if action == "join":
                    entry["online_count"] = entry.get("online_count", 1) + 1
                    res = {
                        "success": True,
                        "match_id": room_id,
                        "role": payload.get("claim_role", "player2"),
                        "online_count": entry["online_count"],
                        "version": entry.get("version", 1),
                        "state": entry.get("state")
                    }
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps(res).encode("utf-8"))
                    return

            res = {
                "success": True,
                "match_id": room_id or "WH40K-DEV1",
                "version": ROOMS_DB.get(room_id, {}).get("version", 1)
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(b'{"status": "ok"}')

    def _handle_request(self, is_head=False):
        raw_path = self.path.split("?")[0]
        query_str = self.path.split("?")[1] if "?" in self.path else ""
        clean_path = raw_path.strip("/")

        # 1. API routes
        if clean_path in ("api/auth/me", "api/auth/session"):
            cookie_hdr = self.headers.get("Cookie", "")
            persona_hdr = self.headers.get("X-Dev-Persona", "")
            persona = "competitor"
            if "dev_persona=spectator" in cookie_hdr or persona_hdr == "spectator" or "persona=spectator" in query_str:
                persona = "spectator"
            elif "dev_persona=creator" in cookie_hdr or persona_hdr == "creator" or "persona=creator" in query_str:
                persona = "creator"
            elif "dev_persona=to" in cookie_hdr or persona_hdr == "to" or "persona=to" in query_str:
                persona = "to"
            elif "dev_persona=competitor" in cookie_hdr or persona_hdr == "competitor" or "persona=competitor" in query_str:
                persona = "competitor"
            resp_user = get_persona_user(persona)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(resp_user).encode("utf-8"))
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
                            "opponent_name": "John Lennon",
                            "opponent_faction": "Ultramarines",
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
                            "opponent_name": "David Gaylard",
                            "opponent_faction": "Necrons",
                            "opponent_elo": 1900.0,
                            "delta_elo": -8.1,
                            "new_elo": 2487.1
                        },
                        {
                            "match_date": "2022-04-16",
                            "event_name": "GemHammer RTT April 2022",
                            "round": "R3",
                            "result": "W",
                            "player_score": 88,
                            "opponent_score": 45,
                            "player_faction": "Adeptus Custodes",
                            "opponent_name": "Manny Cheema",
                            "opponent_faction": "Tyranids",
                            "opponent_elo": 2100.0,
                            "delta_elo": 15.2,
                            "new_elo": 2502.3
                        },
                        {
                            "match_date": "2022-04-16",
                            "event_id": "ev_gemhammer_2022",
                            "event_name": "GemHammer RTT April 2022",
                            "round": 4,
                            "result": "W",
                            "player_score": 95,
                            "opponent_score": 50,
                            "player_faction": "Adeptus Custodes",
                            "opponent_name": "Brad Chester",
                            "opponent_faction": "Aeldari",
                            "opponent_elo": 2150.0,
                            "delta_elo": 14.1,
                            "new_elo": 2450.0
                        },
                        {
                            "match_date": "2026-06-21",
                            "event_id": "ev_tacoma_gt_2026",
                            "event_name": "Battle For The Crown GT 2026",
                            "round": 1,
                            "result": "W",
                            "player_score": 100,
                            "opponent_score": 45,
                            "player_faction": "Aeldari",
                            "opponent_name": "Richard Siegler",
                            "opponent_faction": "Tau Empire",
                            "opponent_elo": 2380.0,
                            "delta_elo": 18.2,
                            "new_elo": 2468.2
                        },
                        {
                            "match_date": "2026-06-21",
                            "event_id": "ev_tacoma_gt_2026",
                            "event_name": "Battle For The Crown GT 2026",
                            "round": 2,
                            "result": "W",
                            "player_score": 92,
                            "opponent_score": 71,
                            "player_faction": "Aeldari",
                            "opponent_name": "Jack Harpster",
                            "opponent_faction": "Blood Angels",
                            "opponent_elo": 2250.0,
                            "delta_elo": 13.5,
                            "new_elo": 2481.7
                        },
                        {
                            "match_date": "2026-06-21",
                            "event_id": "ev_tacoma_gt_2026",
                            "event_name": "Battle For The Crown GT 2026",
                            "round": 3,
                            "result": "W",
                            "player_score": 98,
                            "opponent_score": 60,
                            "player_faction": "Aeldari",
                            "opponent_name": "John Lennon",
                            "opponent_faction": "Ultramarines",
                            "opponent_elo": 2340.5,
                            "delta_elo": 13.5,
                            "new_elo": 2495.2
                        }
                    ]
                }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path in ("api/events/recommended", "api/community/overview", "api/community/bcp-upcoming"):
            ongoing_ev = {
                "id": "ev_ongoing_gt_live",
                "event_id": "ev_ongoing_gt_live",
                "name": "Warhammer 40k US Open Series 2026",
                "event_date": "2026-09-15",
                "end_date": "2026-09-16",
                "city": "Atlanta",
                "state": "GA",
                "country": "US",
                "total_players": 16,
                "num_tickets": 32,
                "ticket_price": 45.0,
                "current_round": 3,
                "matches_count": 24,
                "is_started": True,
                "is_ended": False,
                "active": True,
                "raw_json": {"active": True, "isActive": True, "currentRound": 3, "started": True}
            }
            upcoming_list = [
                ongoing_ev,
                {
                    "id": "ev_upcoming_rtt_sep",
                    "event_id": "ev_upcoming_rtt_sep",
                    "name": "Critical Hit Games September RTT 2026",
                    "event_date": "2026-09-26",
                    "end_date": "2026-09-26",
                    "city": "Seattle",
                    "state": "WA",
                    "country": "US",
                    "total_players": 24,
                    "num_tickets": 32,
                    "ticket_price": 25.0,
                    "current_round": 0,
                    "matches_count": 0,
                    "is_started": False,
                    "is_ended": False,
                    "active": True,
                    "raw_json": {"active": True, "isActive": True, "currentRound": 0, "started": False}
                },
                {
                    "id": "ev_upcoming_gt_oct",
                    "event_id": "ev_upcoming_gt_oct",
                    "name": "Pacific Northwest Autumn GT 2026",
                    "event_date": "2026-10-24",
                    "end_date": "2026-10-25",
                    "city": "Portland",
                    "state": "OR",
                    "country": "US",
                    "total_players": 58,
                    "num_tickets": 64,
                    "ticket_price": 65.0,
                    "current_round": 0,
                    "matches_count": 0,
                    "is_started": False,
                    "is_ended": False,
                    "active": True,
                    "raw_json": {"active": True, "isActive": True, "currentRound": 0, "started": False}
                }
            ]
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({
                    "success": True,
                    "events": upcoming_list,
                    "events_upcoming": upcoming_list,
                    "upcoming_events": upcoming_list,
                    "events_recent": [],
                    "ongoing_events": [ongoing_ev],
                    "past_events": [],
                    "local_leaderboard": [],
                    "team_standings": []
                }).encode("utf-8"))
            return

        if clean_path.startswith("api/community/events/") and "/registration" in clean_path:
            cookie_hdr = self.headers.get("Cookie", "")
            persona_hdr = self.headers.get("X-Dev-Persona", "")
            is_explicit_non_competitor = (
                "dev_persona=spectator" in cookie_hdr or "persona=spectator" in query_str or persona_hdr == "spectator" or
                "dev_persona=creator" in cookie_hdr or "persona=creator" in query_str or persona_hdr == "creator" or
                "dev_persona=to" in cookie_hdr or "persona=to" in query_str or persona_hdr == "to"
            )
            is_explicit_competitor = (
                "dev_persona=competitor" in cookie_hdr or "persona=competitor" in query_str or persona_hdr == "competitor" or
                "innes" in cookie_hdr.lower()
            )
            is_competitor = is_explicit_competitor or not is_explicit_non_competitor
            if is_competitor:
                res = {
                    "is_registered": True,
                    "player_registration": {
                        "player_id": "p_innes",
                        "bcp_player_id": "p_innes",
                        "first_name": "Innes",
                        "last_name": "Wilson",
                        "full_name": "Innes Wilson",
                        "team_name": "Stat Check",
                        "faction": "Adeptus Custodes",
                        "detachment": "Shield Host",
                        "army_id": "fac_custodes",
                        "checked_in": True,
                        "dropped": False,
                        "has_list_submitted": True,
                        "army_list": "++ Adeptus Custodes - Shield Host [2,000 pts] ++\nCharacters:\nTrajann Valoris [145 pts]: Watcher's Axe (Warlord)\nBlade Champion [125 pts]: Panoptispex, Vaultswords\nBattleline:\n4x Custodian Guard [180 pts]: Guardian Spear\n4x Custodian Guard [180 pts]: Praesidium Shield\nVehicles:\nCaladius Grav-tank [215 pts]: Twin iliastus accelerator cannon\nCaladius Grav-tank [215 pts]: Twin heavy blaze cannon"
                    },
                    "army_lists": [
                        {
                            "name": "Adeptus Custodes - Shield Host 2000pts",
                            "faction": "Adeptus Custodes",
                            "detachment": "Shield Host",
                            "points": 2000,
                            "raw_text": "++ Adeptus Custodes - Shield Host [2,000 pts] ++\nCharacters:\nTrajann Valoris [145 pts]: Watcher's Axe (Warlord)\nBlade Champion [125 pts]: Panoptispex, Vaultswords\nBattleline:\n4x Custodian Guard [180 pts]: Guardian Spear\n4x Custodian Guard [180 pts]: Praesidium Shield\nVehicles:\nCaladius Grav-tank [215 pts]: Twin iliastus accelerator cannon\nCaladius Grav-tank [215 pts]: Twin heavy blaze cannon"
                        }
                    ],
                    "user_profile": {
                        "first_name": "Innes",
                        "last_name": "Wilson",
                        "display_name": "Innes Wilson"
                    }
                }
            else:
                res = {"is_registered": False}
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path.startswith("api/event/"):
            ev_param = clean_path.replace("api/event/", "")
            if ev_param == "ev_ongoing_gt_live":
                res = {
                    "id": "ev_ongoing_gt_live",
                    "name": "Warhammer 40k US Open Series 2026 - Atlanta Major",
                    "event_date": "2026-09-15",
                    "end_date": "2026-09-16",
                    "city": "Atlanta",
                    "state": "GA",
                    "country": "United States",
                    "total_players": 12,
                    "num_rounds": 5,
                    "current_round": 3,
                    "is_ended": False,
                    "ended": False,
                    "status": {"ended": False, "started": True},
                    "matches": [
                        # Round 1
                        {"id": "m_1_1", "round": 1, "table_number": 1, "table": 1, "player1_id": "p_innes", "player1_name": "Innes Wilson", "player1_faction": "Adeptus Custodes", "player1_detachment": "Shield Host", "player1_elo": 2375.2, "player1_score": 100, "player2_id": "p_marcus", "player2_name": "Marcus Vance", "player2_faction": "Orks", "player2_detachment": "Da Big Hunt", "player2_elo": 1680.0, "player2_score": 24, "winner_id": "p_innes", "is_draw": False, "status": "finished"},
                        {"id": "m_1_2", "round": 1, "table_number": 2, "table": 2, "player1_id": "p_alex", "player1_name": "Alex Spathopoulos", "player1_faction": "Chaos Space Marines", "player1_detachment": "Raiders", "player1_elo": 2395.2, "player1_score": 92, "player2_id": "p_tyler", "player2_name": "Tyler Stice", "player2_faction": "World Eaters", "player2_detachment": "Berzerker Warband", "player2_elo": 1850.0, "player2_score": 45, "winner_id": "p_alex", "is_draw": False, "status": "finished"},
                        {"id": "m_1_3", "round": 1, "table_number": 3, "table": 3, "player1_id": "p_john", "player1_name": "John Lennon", "player1_faction": "Ultramarines", "player1_detachment": "Gladius Task Force", "player1_elo": 2240.0, "player1_score": 88, "player2_id": "p_chris", "player2_name": "Chris Green", "player2_faction": "Space Marines", "player2_detachment": "Ironstorm Spearhead", "player2_elo": 2097.8, "player2_score": 62, "winner_id": "p_john", "is_draw": False, "status": "finished"},
                        {"id": "m_1_4", "round": 1, "table_number": 4, "table": 4, "player1_id": "p_david", "player1_name": "David Gaylard", "player1_faction": "Necrons", "player1_detachment": "Canoptek Court", "player1_elo": 2150.0, "player1_score": 85, "player2_id": "p_liam", "player2_name": "Liam Hackett", "player2_faction": "T'au Empire", "player2_detachment": "Mont'ka", "player2_elo": 2010.0, "player2_score": 55, "winner_id": "p_david", "is_draw": False, "status": "finished"},
                        {"id": "m_1_5", "round": 1, "table_number": 5, "table": 5, "player1_id": "p_manny", "player1_name": "Manny Cheema", "player1_faction": "Tyranids", "player1_detachment": "Invasion Fleet", "player1_elo": 2210.0, "player1_score": 90, "player2_id": "p_jack", "player2_name": "Jack Harpster", "player2_faction": "Blood Angels", "player2_detachment": "Sons of Sanguinius", "player2_elo": 2185.0, "player2_score": 68, "winner_id": "p_manny", "is_draw": False, "status": "finished"},
                        {"id": "m_1_6", "round": 1, "table_number": 6, "table": 6, "player1_id": "p_folger", "player1_name": "Folger Pyles", "player1_faction": "Adeptus Custodes", "player1_detachment": "Talons of the Emperor", "player1_elo": 2340.5, "player1_score": 94, "player2_id": "p_donovan", "player2_name": "Donovan Sailo", "player2_faction": "Grey Knights", "player2_detachment": "Teleport Strike Force", "player2_elo": 2153.2, "player2_score": 50, "winner_id": "p_folger", "is_draw": False, "status": "finished"},

                        # Round 2
                        {"id": "m_2_1", "round": 2, "table_number": 1, "table": 1, "player1_id": "p_innes", "player1_name": "Innes Wilson", "player1_faction": "Adeptus Custodes", "player1_detachment": "Shield Host", "player1_elo": 2375.2, "player1_score": 95, "player2_id": "p_david", "player2_name": "David Gaylard", "player2_faction": "Necrons", "player2_detachment": "Canoptek Court", "player2_elo": 2150.0, "player2_score": 78, "winner_id": "p_innes", "is_draw": False, "status": "finished"},
                        {"id": "m_2_2", "round": 2, "table_number": 2, "table": 2, "player1_id": "p_alex", "player1_name": "Alex Spathopoulos", "player1_faction": "Chaos Space Marines", "player1_detachment": "Raiders", "player1_elo": 2395.2, "player1_score": 98, "player2_id": "p_john", "player2_name": "John Lennon", "player2_faction": "Ultramarines", "player2_detachment": "Gladius Task Force", "player2_elo": 2240.0, "player2_score": 74, "winner_id": "p_alex", "is_draw": False, "status": "finished"},
                        {"id": "m_2_3", "round": 2, "table_number": 3, "table": 3, "player1_id": "p_marcus", "player1_name": "Marcus Vance", "player1_faction": "Orks", "player1_detachment": "Da Big Hunt", "player1_elo": 1680.0, "player1_score": 88, "player2_id": "p_folger", "player2_name": "Folger Pyles", "player2_faction": "Adeptus Custodes", "player2_detachment": "Talons of the Emperor", "player2_elo": 2340.5, "player2_score": 72, "winner_id": "p_marcus", "is_draw": False, "status": "finished"},
                        {"id": "m_2_4", "round": 2, "table_number": 4, "table": 4, "player1_id": "p_manny", "player1_name": "Manny Cheema", "player1_faction": "Tyranids", "player1_detachment": "Invasion Fleet", "player1_elo": 2210.0, "player1_score": 85, "player2_id": "p_donovan", "player2_name": "Donovan Sailo", "player2_faction": "Grey Knights", "player2_detachment": "Teleport Strike Force", "player2_elo": 2153.2, "player2_score": 48, "winner_id": "p_manny", "is_draw": False, "status": "finished"},
                        {"id": "m_2_5", "round": 2, "table_number": 5, "table": 5, "player1_id": "p_chris", "player1_name": "Chris Green", "player1_faction": "Space Marines", "player1_detachment": "Ironstorm Spearhead", "player1_elo": 2097.8, "player1_score": 82, "player2_id": "p_tyler", "player2_name": "Tyler Stice", "player2_faction": "World Eaters", "player2_detachment": "Berzerker Warband", "player2_elo": 1850.0, "player2_score": 60, "winner_id": "p_chris", "is_draw": False, "status": "finished"},
                        {"id": "m_2_6", "round": 2, "table_number": 6, "table": 6, "player1_id": "p_jack", "player1_name": "Jack Harpster", "player1_faction": "Blood Angels", "player1_detachment": "Sons of Sanguinius", "player1_elo": 2185.0, "player1_score": 80, "player2_id": "p_liam", "player2_name": "Liam Hackett", "player2_faction": "T'au Empire", "player2_detachment": "Mont'ka", "player2_elo": 2010.0, "player2_score": 75, "winner_id": "p_jack", "is_draw": False, "status": "finished"},

                        # Round 3 (Active Live Round in progress!)
                        {"id": "m_3_1", "round": 3, "table_number": 1, "table": 1, "player1_id": "p_innes", "player1_name": "Innes Wilson", "player1_faction": "Adeptus Custodes", "player1_detachment": "Shield Host", "player1_elo": 2375.2, "player1_score": None, "player2_id": "p_alex", "player2_name": "Alex Spathopoulos", "player2_faction": "Chaos Space Marines", "player2_detachment": "Raiders", "player2_elo": 2395.2, "player2_score": None, "winner_id": None, "is_draw": False, "status": "in_progress"},
                        {"id": "m_3_2", "round": 3, "table_number": 2, "table": 2, "player1_id": "p_david", "player1_name": "David Gaylard", "player1_faction": "Necrons", "player1_detachment": "Canoptek Court", "player1_elo": 2150.0, "player1_score": None, "player2_id": "p_manny", "player2_name": "Manny Cheema", "player2_faction": "Tyranids", "player2_detachment": "Invasion Fleet", "player2_elo": 2210.0, "player2_score": None, "winner_id": None, "is_draw": False, "status": "in_progress"},
                        {"id": "m_3_3", "round": 3, "table_number": 3, "table": 3, "player1_id": "p_marcus", "player1_name": "Marcus Vance", "player1_faction": "Orks", "player1_detachment": "Da Big Hunt", "player1_elo": 1680.0, "player1_score": 76, "player2_id": "p_tyler", "player2_name": "Tyler Stice", "player2_faction": "World Eaters", "player2_detachment": "Berzerker Warband", "player2_elo": 1850.0, "player2_score": 75, "winner_id": "p_marcus", "is_draw": False, "status": "finished"},
                        {"id": "m_3_4", "round": 3, "table_number": 4, "table": 4, "player1_id": "p_john", "player1_name": "John Lennon", "player1_faction": "Ultramarines", "player1_detachment": "Gladius Task Force", "player1_elo": 2240.0, "player1_score": None, "player2_id": "p_folger", "player2_name": "Folger Pyles", "player2_faction": "Adeptus Custodes", "player2_detachment": "Talons of the Emperor", "player2_elo": 2340.5, "player2_score": None, "winner_id": None, "is_draw": False, "status": "in_progress"},
                        {"id": "m_3_5", "round": 3, "table_number": 5, "table": 5, "player1_id": "p_liam", "player1_name": "Liam Hackett", "player1_faction": "T'au Empire", "player1_detachment": "Mont'ka", "player1_elo": 2010.0, "player1_score": 85, "player2_id": "p_chris", "player2_name": "Chris Green", "player2_faction": "Space Marines", "player2_detachment": "Ironstorm Spearhead", "player2_elo": 2097.8, "player2_score": 71, "winner_id": "p_liam", "is_draw": False, "status": "finished"},
                        {"id": "m_3_6", "round": 3, "table_number": 6, "table": 6, "player1_id": "p_jack", "player1_name": "Jack Harpster", "player1_faction": "Blood Angels", "player1_detachment": "Sons of Sanguinius", "player1_elo": 2185.0, "player1_score": 47, "player2_id": "p_donovan", "player2_name": "Donovan Sailo", "player2_faction": "Grey Knights", "player2_detachment": "Teleport Strike Force", "player2_elo": 2153.2, "player2_score": 42, "winner_id": "p_jack", "is_draw": False, "status": "finished"}
                    ],
                    "players": [
                        {
                            "player_id": "p_innes", "full_name": "Innes Wilson", "faction": "Adeptus Custodes", "detachment": "Shield Host",
                            "team": "Stat Check", "placement": 1, "event_wins": 2, "event_losses": 0, "event_draws": 0, "event_battle_points": 195,
                            "current_elo": 2375.2, "event_net_elo": 11.2, "has_list": True,
                            "army_list": "++ Adeptus Custodes - Shield Host [2,000 pts] ++\nCharacters:\nTrajann Valoris [145 pts]: Watcher's Axe (Warlord)\nBlade Champion [125 pts]: Panoptispex, Vaultswords\nBattleline:\n4x Custodian Guard [180 pts]: Guardian Spear\n4x Custodian Guard [180 pts]: Praesidium Shield\nVehicles:\nCaladius Grav-tank [215 pts]: Twin iliastus accelerator cannon\nCaladius Grav-tank [215 pts]: Twin heavy blaze cannon"
                        },
                        {
                            "player_id": "p_alex", "full_name": "Alex Spathopoulos", "faction": "Chaos Space Marines", "detachment": "Raiders",
                            "team": "Xenos Petting Zoo", "placement": 2, "event_wins": 2, "event_losses": 1, "event_draws": 0, "event_battle_points": 274,
                            "current_elo": 2395.2, "event_net_elo": 14.2, "has_list": True,
                            "army_list": "++ Chaos Space Marines - Raiders [2,000 pts] ++\nCharacters:\nChaos Lord with Jump Pack [90 pts]: Daemon hammer\nDark Apostle [75 pts]: Accursed crozius\nOther:\n5x Warp Talons [135 pts]: Warp claws\n5x Chosen [125 pts]: Paired accursed weapons\nForgefiend [190 pts]: 3x Ectoplasma cannon\nPredator Destructor [130 pts]: Autocannon, 2x Lascannons"
                        },
                        {
                            "player_id": "p_david", "full_name": "David Gaylard", "faction": "Necrons", "detachment": "Canoptek Court",
                            "team": "Team England", "placement": 3, "event_wins": 2, "event_losses": 1, "event_draws": 0, "event_battle_points": 258,
                            "current_elo": 2150.0, "event_net_elo": 6.5, "has_list": True,
                            "army_list": "++ Necrons - Canoptek Court [2,000 pts] ++\nCharacters:\nIlluminor Szeras [175 pts]\nTechnomancer [85 pts]: Dimensional Sanctum\nBattleline:\n6x Canoptek Wraiths [250 pts]: Particle caster\nMonsters & Vehicles:\nC'tan Shard of the Nightbringer [295 pts]\n3x Canoptek Doomstalker [435 pts]: Doomsday blaster (Tech Choice!)"
                        },
                        {
                            "player_id": "p_manny", "full_name": "Manny Cheema", "faction": "Tyranids", "detachment": "Invasion Fleet",
                            "team": "Team England", "placement": 4, "event_wins": 2, "event_losses": 1, "event_draws": 0, "event_battle_points": 248,
                            "current_elo": 2210.0, "event_net_elo": 4.0, "has_list": True,
                            "army_list": "++ Tyranids - Invasion Fleet [2,000 pts] ++\nCharacters:\nHive Tyrant [235 pts]: Heavy venom cannon\nDeathleaper [80 pts]: Lictor claws\nMonsters:\nMaleceptor [170 pts]\nExocrine [135 pts]\n10x Gargoyles [85 pts]"
                        },
                        {
                            "player_id": "p_john", "full_name": "John Lennon", "faction": "Ultramarines", "detachment": "Gladius Task Force",
                            "team": "Art of War", "placement": 5, "event_wins": 2, "event_losses": 1, "event_draws": 0, "event_battle_points": 242,
                            "current_elo": 2240.0, "event_net_elo": -3.2, "has_list": True,
                            "army_list": "++ Ultramarines - Gladius Task Force [2,000 pts] ++\nCharacters:\nMarneus Calgar [185 pts]: Victrix Honour Guard\nUriel Ventris [75 pts]\nInfantry:\n6x Aggressor Squad [240 pts]: Boltstorm gauntlets\n6x Eradicator Squad [190 pts]: Melta rifles\nTransport:\nLand Raider Redeemer [285 pts]: Flamestorm cannon"
                        },
                        {
                            "player_id": "p_marcus", "full_name": "Marcus Vance", "faction": "Orks", "detachment": "Da Big Hunt",
                            "team": "Da Boyz Club", "placement": 6, "event_wins": 2, "event_losses": 1, "event_draws": 0, "event_battle_points": 230,
                            "current_elo": 1680.0, "event_net_elo": 38.5, "has_list": True,
                            "army_list": "++ Orks - Da Big Hunt [2,000 pts] ++\nCharacters:\nBeastboss on Squigosaur [130 pts]: Headwoppa's Killchoppa\nMozrog Skragbad [165 pts]\nVehicles (Spicy Tech!):\n3x Gorkanaut [840 pts]: Deffstorm mega-shoota, Klaw of Gork\n10x Beast Snagga Boyz [105 pts]"
                        },
                        {
                            "player_id": "p_chris", "full_name": "Chris Green", "faction": "Space Marines", "detachment": "Ironstorm Spearhead",
                            "team": "Ballers on a Budget", "placement": 7, "event_wins": 1, "event_losses": 2, "event_draws": 0, "event_battle_points": 215,
                            "current_elo": 2097.8, "event_net_elo": -12.4, "has_list": True,
                            "army_list": "++ Space Marines - Ironstorm Spearhead [2,000 pts] ++\nCharacters:\nTechmarine [55 pts]: Target Augury Web\nIron Father Feirros [95 pts]: Warlord\nVehicles:\nRedemptor Dreadnought [210 pts]: Macro Plasma\nGladiator Lancer [160 pts]: Laser Destroyer\nRepulsor Executioner [220 pts]: Heavy Laser"
                        },
                        {
                            "player_id": "p_folger", "full_name": "Folger Pyles", "faction": "Adeptus Custodes", "detachment": "Talons of the Emperor",
                            "team": "Art of War", "placement": 8, "event_wins": 1, "event_losses": 2, "event_draws": 0, "event_battle_points": 202,
                            "current_elo": 2340.5, "event_net_elo": -28.5, "has_list": True,
                            "army_list": "++ Adeptus Custodes - Talons of the Emperor [2,000 pts] ++\nCharacters:\nShield-Captain in Allarus Armour [120 pts]\nInfantry:\n3x Allarus Custodians [195 pts]: Castellan axe\n10x Sisters of Silence Witchseekers [125 pts]: Witchseeker flamer"
                        },
                        {
                            "player_id": "p_jack", "full_name": "Jack Harpster", "faction": "Blood Angels", "detachment": "Sons of Sanguinius",
                            "team": "Art of War", "placement": 9, "event_wins": 1, "event_losses": 2, "event_draws": 0, "event_battle_points": 195,
                            "current_elo": 2185.0, "event_net_elo": -16.0, "has_list": True,
                            "army_list": "++ Blood Angels - Sons of Sanguinius [2,000 pts] ++\nCharacters:\nLemartes [120 pts]\nCaptain with Jump Pack [85 pts]\nInfantry:\n10x Death Company with Jump Packs [230 pts]: Power fists\n5x Sanguinary Guard [175 pts]: Encarmine blades"
                        },
                        {
                            "player_id": "p_tyler", "full_name": "Tyler Stice", "faction": "World Eaters", "detachment": "Berzerker Warband",
                            "team": "Dead Gurgler Society", "placement": 10, "event_wins": 1, "event_losses": 2, "event_draws": 0, "event_battle_points": 180,
                            "current_elo": 1850.0, "event_net_elo": -8.0, "has_list": True,
                            "army_list": "++ World Eaters - Berzerker Warband [2,000 pts] ++\nMonsters:\nAngron [415 pts]: Samni'arius and Spinegrinder\nCharacters:\nLord Invocatus [140 pts]\nInfantry:\n6x Eightbound [290 pts]\n10x Khorne Berzerkers [180 pts]"
                        },
                        {
                            "player_id": "p_liam", "full_name": "Liam Hackett", "faction": "T'au Empire", "detachment": "Mont'ka",
                            "team": "The Greater Good", "placement": 11, "event_wins": 1, "event_losses": 2, "event_draws": 0, "event_battle_points": 175,
                            "current_elo": 2010.0, "event_net_elo": -14.2, "has_list": True,
                            "army_list": "++ T'au Empire - Mont'ka [2,000 pts] ++\nCharacters:\nCommander in Coldstar Battlesuit [110 pts]: High-output burst cannon\nInfantry:\n10x Breacher Team [100 pts]: Pulse blasters\nTransport:\nDevilfish [85 pts]\nBattlesuits:\n3x Crisis Sunforge Battlesuits [150 pts]: Fusion blasters"
                        },
                        {
                            "player_id": "p_donovan", "full_name": "Donovan Sailo", "faction": "Grey Knights", "detachment": "Teleport Strike Force",
                            "team": "Making Saves", "placement": 12, "event_wins": 0, "event_losses": 3, "event_draws": 0, "event_battle_points": 140,
                            "current_elo": 2153.2, "event_net_elo": -32.0, "has_list": True,
                            "army_list": "++ Grey Knights - Teleport Strike Force [2,000 pts] ++\nCharacters:\nKaldor Draigo [125 pts]: Titansword\nGrand Master in Nemesis Dreadknight [200 pts]: Nemesis daemon greathammer\nInfantry:\n5x Brotherhood Terminator Squad [210 pts]: Nemesis force weapon"
                        }
                    ],
                    "team_standings": []
                }
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                if not is_head:
                    self.wfile.write(json.dumps(res).encode("utf-8"))
                return

            is_riverside = "riverside" in ev_param.lower() or "tacoma" in ev_param.lower()
            if is_riverside:
                res = {
                    "id": "ev_riverside_2026",
                    "name": "The Riverside Classic by Green Banner Event Co.",
                    "event_date": "2026-03-28",
                    "end_date": "2026-03-29",
                    "city": "Riverside",
                    "state": "CA",
                    "country": "United States",
                    "total_players": 4,
                    "num_rounds": 3,
                    "current_round": 3,
                    "is_ended": True,
                    "ended": True,
                    "status": {"ended": True, "started": True},
                    "players": [
                        {
                            "player_id": "p_alex_spath",
                            "full_name": "Alex Spathopoulos",
                            "faction": "Chaos Space Marines",
                            "detachment": "Reconnaissance",
                            "team": "Xenos Petting Zoo",
                            "placement": 1,
                            "event_wins": 3,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_battle_points": 290,
                            "current_elo": 2395.2,
                            "army_list": "",
                            "list_url": "https://www.bestcoastpairings.com/list/fnC5PtZin8ev",
                            "list_id": "fnC5PtZin8ev",
                            "has_list": True
                        },
                        {
                            "player_id": "p_folger_pyles",
                            "full_name": "Folger Pyles",
                            "faction": "Adeptus Custodes",
                            "detachment": "Shield Host",
                            "team": "Art of War",
                            "placement": 2,
                            "event_wins": 2,
                            "event_losses": 1,
                            "event_draws": 0,
                            "event_battle_points": 265,
                            "current_elo": 2340.5,
                            "army_list": "++ Army Roster ++ (Imperium - Adeptus Custodes) [2,000 pts]\n\nCharacters:\nTrajann Valoris [145 pts]: Watcher's Axe\nBlade Champion [110 pts]: Vaultswords\n\nBattleline:\n4x Custodian Guard [180 pts]: Guardian Spear\n4x Custodian Guard [180 pts]: Sentinel Blade, Praesidium Shield\n\nAllies:\nLord Inquisitor Kyria Draxus [95 pts]",
                            "list_url": "",
                            "has_list": True
                        },
                        {
                            "player_id": "p_john_lennon",
                            "full_name": "John Lennon",
                            "faction": "Ultramarines",
                            "detachment": "Gladius Task Force",
                            "team": "Art of War",
                            "placement": 3,
                            "event_wins": 1,
                            "event_losses": 2,
                            "event_draws": 0,
                            "event_battle_points": 220,
                            "current_elo": 2240.0,
                            "army_list": "",
                            "list_url": "",
                            "has_list": False
                        }
                    ],
                    "team_standings": [],
                    "matches": []
                }
            else:
                res = {
                    "id": "ev_active_lvo_2026",
                    "name": "LVO 2026 - Warhammer 40k Championships - Las Vegas Open",
                    "event_date": "2026-10-02",
                    "end_date": "2026-10-04",
                    "city": "Las Vegas",
                    "state": "NV",
                    "country": "United States",
                    "total_players": 6,
                    "num_rounds": 3,
                    "current_round": 0,
                    "is_ended": False,
                    "ended": False,
                    "status": {"ended": False, "started": False},
                    "players": [
                        {
                            "player_id": "p_innes_wilson",
                            "full_name": "Innes Wilson",
                            "faction": "-",
                            "detachment": "",
                            "team": "Stat Check",
                            "placement": 1,
                            "event_wins": 0,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_battle_points": 0,
                            "current_elo": 2375.2,
                            "army_list": "",
                            "list_url": "",
                            "has_list": False,
                            "checked_in": False
                        },
                        {
                            "player_id": "p_travis_finell",
                            "full_name": "Travis Finell",
                            "faction": "-",
                            "detachment": "",
                            "team": "Smite Club",
                            "placement": 2,
                            "event_wins": 0,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_battle_points": 0,
                            "current_elo": 2168.6,
                            "army_list": "",
                            "list_url": "",
                            "has_list": False,
                            "checked_in": False
                        },
                        {
                            "player_id": "p_donovan_sailo",
                            "full_name": "Donovan Sailo",
                            "faction": "Grey Knights",
                            "detachment": "Teleport Strike Force",
                            "team": "Making Saves",
                            "placement": 3,
                            "event_wins": 0,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_battle_points": 0,
                            "current_elo": 2153.2,
                            "army_list": "",
                            "list_url": "https://www.bestcoastpairings.com/list/BtRNRqITthMM",
                            "list_id": "BtRNRqITthMM",
                            "has_list": True,
                            "checked_in": False
                        },
                        {
                            "player_id": "p_forrest_phanton",
                            "full_name": "Forrest Phanton",
                            "faction": "-",
                            "detachment": "",
                            "team": "Salt Shakers",
                            "placement": 4,
                            "event_wins": 0,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_battle_points": 0,
                            "current_elo": 2124.8,
                            "army_list": "",
                            "list_url": "",
                            "has_list": False,
                            "checked_in": False
                        },
                        {
                            "player_id": "p_chris_green",
                            "full_name": "Chris Green",
                            "faction": "Space Marines (Astartes)",
                            "detachment": "Ironstorm Spearhead",
                            "team": "ballers on a budget",
                            "placement": 5,
                            "event_wins": 0,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_battle_points": 0,
                            "current_elo": 2097.8,
                            "army_list": "++ Space Marines (Astartes) List ++ [2,000 pts]\n\nCharacters:\nTechmarine [55 pts]: Target Augury Web\nIron Father Feirros [95 pts]: Warlord\n\nVehicles:\n1x Redemptor Dreadnought [210 pts]: Macro Plasma Incinerator\n1x Gladiator Lancer [160 pts]: Lancer Laser Destroyer\n1x Repulsor Executioner [220 pts]: Heavy Laser Destroyer",
                            "list_url": "",
                            "has_list": True,
                            "checked_in": False
                        },
                        {
                            "player_id": "p_tyler_stice",
                            "full_name": "Tyler Stice",
                            "faction": "Adeptus Custodes",
                            "detachment": "",
                            "team": "Dead Gurgler's Society",
                            "placement": 6,
                            "event_wins": 0,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_battle_points": 0,
                            "current_elo": 2056.3,
                            "army_list": "",
                            "list_url": "",
                            "has_list": False,
                            "checked_in": False
                        }
                    ],
                    "team_standings": [],
                    "matches": []
                }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if "leaderboard" in clean_path or "players" in clean_path:
            players_data = [
                {
                    "rank": 1,
                    "player_id": "p_innes_wilson",
                    "player_name": "Innes Wilson",
                    "current_elo": 2375.2,
                    "peak_elo": 2390.0,
                    "record": "120-15-2",
                    "wins": 120,
                    "losses": 15,
                    "draws": 2,
                    "win_rate": 87.6,
                    "factions": "Dark Angels, Space Marines (Astartes), Genestealer Cult, Chaos Space Marines, Adeptus Astartes, Tyranids, Aeldari, Blood Angels, Grey Knights, World Eaters, T'au Empire, Legion of the Damned, Elysian Drop Troops, Black Templars, Thousand Sons",
                    "top_faction": "Dark Angels, Space Marines (Astartes), Genestealer Cult, Chaos Space Marines, Adeptus Astartes, Tyranids, Aeldari, Blood Angels, Grey Knights, World Eaters, T'au Empire, Legion of the Damned, Elysian Drop Troops, Black Templars, Thousand Sons",
                    "last_active": "2026-01-20"
                },
                {
                    "rank": 2,
                    "player_id": "p_folger_pyles",
                    "player_name": "Folger Pyles",
                    "current_elo": 2350.0,
                    "peak_elo": 2365.0,
                    "record": "145-20-1",
                    "wins": 145,
                    "losses": 20,
                    "draws": 1,
                    "win_rate": 87.3,
                    "factions": "Adeptus Custodes, Aeldari, Necrons, Drukhari, Imperial Agents, Chaos Space Marines, Ynnari, Death Guard, World Eaters",
                    "top_faction": "Adeptus Custodes, Aeldari, Necrons, Drukhari, Imperial Agents, Chaos Space Marines, Ynnari, Death Guard, World Eaters",
                    "last_active": "2026-01-18"
                }
            ]
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"players": players_data, "leaderboard": players_data, "count": len(players_data), "total": len(players_data)}).encode("utf-8"))
            return

        if clean_path == "api/events":
            events_list = [
                {
                    "id": "ev_ongoing_gt_live",
                    "name": "Warhammer 40k US Open Series 2026 - Atlanta Major",
                    "event_date": "2026-09-15",
                    "city": "Atlanta",
                    "state": "GA",
                    "country": "United States",
                    "total_players": 12,
                    "num_rounds": 5,
                    "match_count": 18,
                    "is_ended": False,
                    "status": "ongoing"
                },
                {
                    "id": "ev_riverside_2026",
                    "name": "The Riverside Classic by Green Banner Event Co.",
                    "event_date": "2026-03-28",
                    "city": "Riverside",
                    "state": "CA",
                    "country": "United States",
                    "total_players": 4,
                    "num_rounds": 3,
                    "match_count": 6,
                    "is_ended": True,
                    "status": "ended"
                },
                {
                    "id": "ev_active_lvo_2026",
                    "name": "LVO 2026 - Warhammer 40k Championships - Las Vegas Open",
                    "event_date": "2026-10-02",
                    "city": "Las Vegas",
                    "state": "NV",
                    "country": "United States",
                    "total_players": 6,
                    "num_rounds": 3,
                    "match_count": 0,
                    "is_ended": False,
                    "status": "upcoming"
                }
            ]
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"items": events_list, "total": len(events_list), "page": 1, "page_size": 25, "total_pages": 1}).encode("utf-8"))
            return

        if clean_path in ("api/teams", "api/community/feed", "api/notifications/unread-count"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"players": [], "events": [], "teams": [], "count": 0}).encode("utf-8"))
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
                    "team": "Iron Hands Veterans",
                    "is_bcp_connected": True
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
                        "event_id": "ev_atlanta_2026",
                        "event_name": "Warhammer Open Atlanta",
                        "round": 1,
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
                        "event_id": "ev_lso_2026",
                        "event_name": "Lone Star Open 2026",
                        "round": 2,
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
                        "event_id": "ev_tacoma_gt_2026",
                        "event_name": "US Open Tacoma GT 2026",
                        "round": 3,
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
                        "event_id": "ev_bayarea_2026",
                        "event_name": "Bay Area Cup 2026",
                        "round": 4,
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
                        "event_id": "ev_nova_2026",
                        "event_name": "Nova Open 2026",
                        "round": 5,
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
                        "event_id": "ev_lgt_2026",
                        "event_name": "LGT Masters 2026",
                        "round": 6,
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
                        "event_id": "ev_tacoma_gt_2026",
                        "event_name": "US Open Tacoma GT 2026",
                        "round": 7,
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
                "upcoming_events": [],
                "bcp_linked": True,
                "is_bcp_connected": True,
                "registered_tournaments": [
                    {
                        "id": "ev_active_lvo_2026",
                        "bcp_event_id": "ev_active_lvo_2026",
                        "event_name": "LVO 2026 Warhammer 40K Champs",
                        "event_date": "2026-01-18",
                        "city": "Las Vegas",
                        "state": "NV",
                        "checked_in": True,
                        "faction": "Necrons",
                        "detachment": "Canoptek Court",
                        "has_list_submitted": True,
                        "points_limit": 2000,
                        "rounds": 5
                    }
                ]
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path.startswith("api/scorecard/"):
            match_id = clean_path.replace("api/scorecard/", "").strip("/")
            room_data = ROOMS_DB.get(match_id, {})
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                st = room_data.get("state") if isinstance(room_data, dict) else None
                sys_id = (room_data.get("game_system") if isinstance(room_data, dict) else None) or (st.get("gameSystem") if isinstance(st, dict) else None) or ("aos" if match_id.startswith("AOS-") else "40k")
                self.wfile.write(json.dumps({
                    "success": True,
                    "match_id": match_id,
                    "game_system": sys_id,
                    "game_record": None,
                    "state": st,
                    "is_finished": bool(room_data.get("is_finished", False)),
                    "status": room_data.get("status", "active")
                }).encode("utf-8"))
            return

        if clean_path.startswith("api/tracker/"):
            tail = clean_path.replace("api/tracker/", "")
            if tail.startswith("room/"):
                tail = tail[5:]
            for sa in ["/check", "/armylists", "/clock", "/state"]:
                if tail.endswith(sa):
                    tail = tail[:-len(sa)].strip("/")
                    break
            room_id = tail.strip("/")
            data = ROOMS_DB.get(room_id, {})
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                st = data.get("state") if isinstance(data, dict) else None
                ver = data.get("version", 1) if isinstance(data, dict) else 1
                online = data.get("online_count", 2) if isinstance(data, dict) else 2
                sys_id = (data.get("game_system") if isinstance(data, dict) else None) or (st.get("gameSystem") if isinstance(st, dict) else None) or ("aos" if room_id.startswith("AOS-") else "40k")
                self.wfile.write(json.dumps({
                    "success": True,
                    "match_id": room_id,
                    "game_system": sys_id,
                    "data": data,
                    "state": st,
                    "version": ver,
                    "online_count": online
                }).encode("utf-8"))
            return

        if clean_path.startswith("api/bcp/armylist/"):
            lid = clean_path.replace("api/bcp/armylist/", "").strip("/")
            mock_armylists = {
                "fnC5PtZin8ev": {
                    "success": True,
                    "list_id": "fnC5PtZin8ev",
                    "name": "Alex Spathopoulos - Chaos Space Marines",
                    "text": "++ Army Roster ++ (Chaos - Chaos Space Marines) [2,000 pts] \n\nDetachment Choice: Raiders\n\nCharacters:\nChaos Lord with Jump Pack [90 pts]: Daemon hammer, Plasma pistol\nDark Apostle [75 pts]: Accursed crozius, Bolt pistol\n\nBattleline:\n10x Cultist Mob [50 pts]: Cultist firearms\n5x Legionaries [90 pts]: Astartes chainsword, Heavy melee weapon\n\nDedicated Transport:\nChaos Rhino [75 pts]: Combi-bolter, Havoc launcher\n\nOther Datasheets:\n5x Warp Talons [135 pts]: Warp claws\n5x Chosen [125 pts]: Paired accursed weapons\nForgefiend [190 pts]: 3x Ectoplasma cannon\nPredator Destructor [130 pts]: Predator autocannon, 2x Lascannon\n\nCreated with Best Coast Pairings"
                },
                "BtRNRqITthMM": {
                    "success": True,
                    "list_id": "BtRNRqITthMM",
                    "name": "Donovan Sailo - Grey Knights",
                    "text": "++ Army Roster ++ (Imperium - Grey Knights) [2,000 pts]\n\nDetachment Choice: Teleport Strike Force\n\nCharacters:\nKaldor Draigo [125 pts]: Scourging, Titansword (Warlord)\nGrand Master in Nemesis Dreadknight [200 pts]: Heavy psycannon, Nemesis daemon greathammer\n\nBattleline:\n5x Strike Squad [120 pts]: Nemesis force weapons, Storm bolters\n5x Strike Squad [120 pts]: Nemesis force weapons, Storm bolters\n\nOther Datasheets:\nNemesis Dreadknight [185 pts]: Heavy incinator, Heavy psycannon\n5x Grey Knights Terminator Squad [210 pts]: Nemesis force weapons\n\nCreated with Best Coast Pairings"
                }
            }
            auth_header = self.headers.get("Authorization", "")
            bcp_header = self.headers.get("X-BCP-Token", "")
            cookie_hdr = self.headers.get("Cookie", "")
            has_bcp_auth = bool(bcp_header or "dev-auth-token" in auth_header or "Bearer " in auth_header or "session_token" in cookie_hdr)
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                if not has_bcp_auth:
                    self.wfile.write(json.dumps({
                        "success": False,
                        "requires_bcp_link": True,
                        "error": "Best Coast Pairings account linking is required to view this roster",
                        "list_id": lid
                    }).encode("utf-8"))
                else:
                    ret = mock_armylists.get(lid, {
                        "success": True,
                        "list_id": lid,
                        "name": "Best Coast Pairings Roster",
                        "text": f"++ Official BCP Army Roster [{lid}] ++\n\nCompetitor roster fetched live from Best Coast Pairings API.\nDetachment: Tournament Standard (2,000 pts)\n\nCreated with Best Coast Pairings"
                    })
                    self.wfile.write(json.dumps(ret).encode("utf-8"))
            return

        if clean_path == "api/factions":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            is_aos = "game_system=aos" in query_str
            is_grouped = "grouped=true" in query_str or "grouped=1" in query_str
            from database import PostgresDatabase
            data = PostgresDatabase.get_factions(game_system="aos" if is_aos else "40k", grouped=is_grouped)
            self.wfile.write(json.dumps(data).encode("utf-8"))
            return

        if clean_path.startswith("api/factions/meta"):
            sys_val = "aos" if "game_system=aos" in query_str else "40k"
            if sys_val == "aos":
                f_list = [
                    {"faction": "Stormcast Eternals", "win_rate": 56.4, "total_matches": 420, "wins": 237, "losses": 183, "draws": 0, "avg_score": 19.8, "tier_label": "S-Tier (>55%)"},
                    {"faction": "Blades of Khorne", "win_rate": 53.1, "total_matches": 310, "wins": 165, "losses": 145, "draws": 0, "avg_score": 18.5, "tier_label": "Balanced (45-55%)"},
                    {"faction": "Skaven", "win_rate": 50.2, "total_matches": 290, "wins": 146, "losses": 144, "draws": 0, "avg_score": 17.9, "tier_label": "Balanced (45-55%)"},
                    {"faction": "Daughters of Khaine", "win_rate": 52.0, "total_matches": 210, "wins": 109, "losses": 101, "draws": 0, "avg_score": 18.2, "tier_label": "Balanced (45-55%)"}
                ]
                trends = [
                    {"month": "2026-06", "faction": "Stormcast Eternals", "win_rate": 55.0, "matches_in_month": 40},
                    {"month": "2026-07", "faction": "Stormcast Eternals", "win_rate": 56.2, "matches_in_month": 42},
                    {"month": "2026-08", "faction": "Stormcast Eternals", "win_rate": 56.4, "matches_in_month": 45}
                ]
            else:
                f_list = [
                    {"faction": "Emperor's Children", "win_rate": 54.8, "total_matches": 580, "wins": 318, "losses": 255, "draws": 7, "avg_score": 79.4, "tier_label": "Balanced (45-55%)"},
                    {"faction": "Necrons", "win_rate": 53.2, "total_matches": 1200, "wins": 638, "losses": 540, "draws": 22, "avg_score": 78.1, "tier_label": "Balanced (45-55%)"},
                    {"faction": "Space Marines", "win_rate": 51.5, "total_matches": 2100, "wins": 1081, "losses": 980, "draws": 39, "avg_score": 76.5, "tier_label": "Balanced (45-55%)"},
                    {"faction": "Aeldari", "win_rate": 49.8, "total_matches": 950, "wins": 473, "losses": 460, "draws": 17, "avg_score": 75.2, "tier_label": "Balanced (45-55%)"}
                ]
                trends = [
                    {"month": "2026-06", "faction": "Emperor's Children", "win_rate": 53.5, "matches_in_month": 80},
                    {"month": "2026-07", "faction": "Emperor's Children", "win_rate": 54.2, "matches_in_month": 95},
                    {"month": "2026-08", "faction": "Emperor's Children", "win_rate": 54.8, "matches_in_month": 110},
                    {"month": "2026-08", "faction": "Necrons", "win_rate": 53.2, "matches_in_month": 150}
                ]

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({
                    "factions": f_list,
                    "monthly_trends": trends,
                    "total_factions_tracked": len(f_list),
                    "filter": {"granularity": "Monthly"}
                }).encode("utf-8"))
            return

        if clean_path.startswith("api/faction/"):
            fname = urllib.parse.unquote(clean_path.replace("api/faction/", "").strip("/"))
            res = {
                "faction": fname,
                "game_system": "aos" if "game_system=aos" in query_str else "40k",
                "timeframe": "1yr",
                "stats": {
                    "total_recent_sample": 45,
                    "recent_wins": 25,
                    "recent_losses": 19,
                    "recent_draws": 1,
                    "top_player_count": 3
                },
                "top_players": [
                    {"player_id": "p_innes", "player_name": "Innes Wilson", "team": "Art of War", "current_elo": 2185.4, "matches_played": 22, "wins": 19, "losses": 3, "draws": 0, "win_rate": 86.4, "avg_score": 88.5},
                    {"player_id": "p_david", "player_name": "David Gaylard", "team": "Team Zero Comp", "current_elo": 2120.0, "matches_played": 15, "wins": 11, "losses": 4, "draws": 0, "win_rate": 73.3, "avg_score": 82.0}
                ],
                "matches": [
                    {"id": "m_fac_1", "event_id": "ev_ongoing_gt_live", "event_name": "Warhammer Championship", "round": 3, "match_date": "2026-09-15", "player_id": "p_innes", "player_name": "Innes Wilson", "player_score": 85, "opponent_id": "p_opp", "opponent_name": "David Gaylard", "opponent_faction": "Necrons", "opponent_score": 72, "outcome": "W"},
                    {"id": "m_fac_2", "event_id": "ev_ongoing_gt_live", "event_name": "Warhammer Championship", "round": 2, "match_date": "2026-09-15", "player_id": "p_innes", "player_name": "Innes Wilson", "player_score": 90, "opponent_id": "p_opp2", "opponent_name": "Manny Cheema", "opponent_faction": "Aeldari", "opponent_score": 68, "outcome": "W"}
                ],
                "matchups": [
                    {"opponent_faction": "Necrons", "total_matches": 18, "wins": 11, "losses": 7, "draws": 0, "win_rate": 61.1},
                    {"opponent_faction": "Space Marines", "total_matches": 15, "wins": 9, "losses": 6, "draws": 0, "win_rate": 60.0},
                    {"opponent_faction": "Aeldari", "total_matches": 12, "wins": 5, "losses": 7, "draws": 0, "win_rate": 41.7}
                ]
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path.startswith("api/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "status": "ok", "data": [], "events": [], "players": [], "lists": [], "count": 0}).encode("utf-8"))
            return

        if clean_path in ("app", "app.html", "aos", "aos/app", "40k", "40k/app"):
            self._serve_html_with_auth(WEB_DIR / "app.html", is_head)
            return

        if clean_path.startswith("scorecard"):
            self._serve_html_with_auth(WEB_DIR / "scorecard.html", is_head)
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
            qp = urllib.parse.parse_qs(query_str)
            role = qp.get("role", [None])[0]
            spectate = qp.get("spectate", [None])[0]
            match_id = qp.get("match_id", [None])[0] or qp.get("room", [None])[0] or qp.get("id", [None])[0]
            if not match_id and qp.get("event_id", [None])[0] and qp.get("table", [None])[0]:
                ev_id = qp.get("event_id", [None])[0]
                r_num = qp.get("round", ["1"])[0]
                t_num = qp.get("table", ["1"])[0]
                match_id = f"BCP-{ev_id}-R{r_num}-T{t_num}"
            if (role == "spectator" or spectate == "true") and match_id:
                self.send_response(302)
                self.send_header("Location", f"/scorecard/{urllib.parse.quote(match_id)}")
                self.end_headers()
                return
            self._serve_html_with_auth(TRACKER_DIR / "play.html", is_head)
            return

        if clean_path in ("11th/tracker/lobby", "tracker/lobby"):
            self._serve_html_with_auth(TRACKER_DIR / "lobby.html", is_head)
            return

        # 3b. AoS Game Tracker Play SPA
        if clean_path in ("11th/tracker/aos", "tracker/aos", "tracker/aos.html", "aos/tracker"):
            qp = urllib.parse.parse_qs(query_str)
            role = qp.get("role", [None])[0]
            spectate = qp.get("spectate", [None])[0]
            match_id = qp.get("match_id", [None])[0] or qp.get("room", [None])[0] or qp.get("id", [None])[0]
            if (role == "spectator" or spectate == "true") and match_id:
                self.send_response(302)
                self.send_header("Location", f"/scorecard/{urllib.parse.quote(match_id)}")
                self.end_headers()
                return
            self._serve_html_with_auth(TRACKER_DIR / "aos.html", is_head)
            return

        # 4. Bundle & Sync Assets
        if clean_path in ("tracker/bundle.js", "11th/tracker/bundle.js", "bundle.js", "tracker/bundle_40k.js"):
            self._serve_file(TRACKER_DIR / "bundle_40k.js", "application/javascript; charset=utf-8", is_head)
            return

        if clean_path in ("tracker/bundle_aos.js", "11th/tracker/bundle_aos.js", "bundle_aos.js"):
            self._serve_file(TRACKER_DIR / "bundle_aos.js", "application/javascript; charset=utf-8", is_head)
            return

        if clean_path in ("tracker/tracker_sync.js", "11th/tracker/tracker_sync.js"):
            self._serve_file(TRACKER_DIR / "tracker_sync.js", "application/javascript; charset=utf-8", is_head)
            return

        if clean_path in ("tracker/tracker_sync_aos.js", "11th/tracker/tracker_sync_aos.js"):
            self._serve_file(TRACKER_DIR / "tracker_sync_aos.js", "application/javascript; charset=utf-8", is_head)
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
