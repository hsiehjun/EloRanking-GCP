#!/usr/bin/env python3
"""
Comprehensive End-to-End (E2E) User Journey Test Suite for the Community League System.

Exercises the actual FastAPI router endpoints (`routers/leagues.py`, `routers/connect.py`,
`routers/tracker.py`), `LeaguesHubService` (`leagues_hub_service.py`), and `FirestoreEngine`
(`firestore_db.py`) across 10 complete user journeys:

1. League Creation & Pre-Pod Chat Lifecycle:
   - Creating a new league (`POST /api/league/create`) immediately creates the general
     League Q&A Chat (`grp_league_{lid}_s1`).
   - Until pods are created/seeded, there are NO Pod Chats (`pod_chats == []`).
   - Only registered players and the league commissioner see the general League chat;
     non-league users see 0 chats.
2. Registration Window Enforcement & Pre-Pod Player Registration:
   - Closing registration (`POST /api/league/{lid}/registration-window`) blocks new signups.
   - Opening registration allows players to register (`POST /api/league/{lid}/register`)
     into `league["registrations"]` with `assigned_pod = None` before pods exist, dynamically
     adding them to the general League Q&A chat while keeping `pod_chats == []`.
3. Pod Creation / Elo Seeding & Strict Pod-Specific Chat Isolation (Max 2 Chats per League):
   - Creating pods (`POST /api/league/{lid}/pods/create`) seeds registered players by Elo into
     Pod #1..#N, generates round-robin pairings, and creates Pod-specific chats (`grp_pod_{lid}_s1_p{n}`).
   - Each player in Pod #k sees AT MOST 2 chats for the league via `/api/connect/requests`:
     1) General League Q&A chat (`grp_league_{lid}_s1`)
     2) Their own Pod chat (`grp_pod_{lid}_s1_p{k}`) — and NEVER another pod's chat.
4. Updating League Config Reflects Immediately from Player Perspective:
   - Updating config (`PUT /api/league/{lid}/config`) — name, short_name, tagline, venue_name,
     points_limit, win/draw/ringer/paint bonuses, promotion/relegation counts, custom_pod_names,
     round_layouts, start/end dates — immediately reflects in `GET /api/league/{lid}`,
     `GET /api/league/player/{name}`, pairing terrain layouts, and Group Chat titles/subtitles/greetings.
5. Submitting Completed Games from Game Tracker Reflects on League Standings & Pairings:
   - Finalizing a room in Game Tracker (`POST /api/tracker/room/{match_id}/finalize`) — both with
     explicit `league_id` AND via automatic detection of active league pod-mates — records W/L/D,
     VP scores, `scorecard_id`, and configured Battle Points (`VP + win_bonus_bp + paint_bonus_bp`),
     re-ranks the pod, and updates completion rate idempotently.
6. Direct Match Reporting, Draw/Ringer Bonuses & Re-Report Idempotency:
   - Reporting a Draw awards `VP + draw_bonus_bp + paint_bonus_bp`.
   - Re-reporting the same round updates the result/BP in place without double-counting `games_played`.
   - Reporting an In-Pod Ringer win awards `VP + in_pod_ringer_bonus_bp + paint_bonus_bp`.
7. Roster Management, Pod Transfers, Drops, Disciplinary Cards & Pairing Swaps:
   - Assigning Yellow/Red/Black disciplinary cards and overriding `seed_elo`.
   - Moving a player between Pod 2 and Pod 1 dynamically switches their visible Pod chat.
   - Dropping a player removes them from active Pod chat; undropping restores them.
   - Drag-and-drop swapping two players' seats in Round R (`swap_seats_in_round`) updates pairings symmetrically.
8. League Announcements & Live Floor Operations (Master Clock, Judge Calls, Broadcast Acks):
   - Creating, listing, acknowledging, and deleting TO announcements & floor broadcasts.
   - Starting/pausing/extending the Master Round Clock and raising/resolving Judge Calls with table time extensions.
9. Ending a Season Removes All Pod Chats (`POST /api/league/{lid}/season/end`):
   - Ending the active season marks the season `completed` and removes ALL Pod chats (`grp_pod_...`),
     while keeping the general League chat active while the league itself remains active.
10. Repeating a League Season (`POST /api/league/{lid}/season/rollover`) & Ending the League (`POST /api/league/{lid}/end`):
    - Rolling over promotes top N players up (`-1` pod) and relegates bottom N players down (`+1` pod),
      archives Season 1 in `/api/league/{lid}/seasons` and `/api/league/{lid}/season/1`, resets Season 2
      standings to 0-0-0, deletes Season 1 chats, and creates Season 2 League & Pod chats with updated rosters.
    - Ending the league (`POST /api/league/{lid}/end`) removes ALL chats (both general League chat and all Pod chats)
      so 0 chats remain for any user.
"""

import asyncio
import json
import os
import re
import sys
import unittest
import uuid
from pathlib import Path
from typing import Any, Dict, Optional
from unittest.mock import patch

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from core import HTTPException
import routers.leagues as leagues_router
import routers.connect as connect_router
import routers.tracker as tracker_router


class MockRequest:
    """Lightweight Request object compatible with FastAPI router endpoints."""

    def __init__(
        self,
        json_body: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        cookies: Optional[Dict[str, str]] = None,
        mock_user: Optional[Dict[str, Any]] = None,
    ):
        self._json_body = json_body if json_body is not None else {}
        self.headers = headers or {}
        self.cookies = cookies or {}
        self._mock_user = mock_user

    async def json(self) -> Dict[str, Any]:
        return self._json_body


class MockResponseWrapper:
    """HTTP-like response wrapper returned by LeagueE2EClient."""

    def __init__(self, status_code: int, payload: Any):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload, default=str) if isinstance(payload, (dict, list)) else str(payload)

    def json(self) -> Any:
        return self._payload


class LeagueE2EClient:
    """
    In-process E2E client that dispatches HTTP-style requests directly to the async
    FastAPI route handlers in `routers/leagues.py`, `routers/connect.py`, and `routers/tracker.py`.
    """

    def __init__(self):
        self._sessions: Dict[str, Dict[str, Any]] = {}

    def register_mock_user(self, user_id: str, display_name: str, player_id: str = "", email: str = "", is_admin: bool = False) -> str:
        token = f"tok_{user_id}"
        self._sessions[token] = {
            "id": user_id,
            "display_name": display_name,
            "player_id": player_id or user_id,
            "email": email or f"{user_id}@example.com",
            "role": "admin" if is_admin else "player",
            "is_admin": is_admin,
        }
        return token

    def _make_stub_auth(self, user: Optional[Dict[str, Any]] = None):
        class _StubAuth:
            def __init__(self, sessions, default_user):
                self._sessions = sessions
                self._default_user = default_user

            def get_session(self, token):
                if token and token in self._sessions:
                    return self._sessions[token]
                return self._default_user

        return _StubAuth(self._sessions, user)

    def _run_With_auth(self, coro, user: Optional[Dict[str, Any]] = None):
        stub_auth = self._make_stub_auth(user)
        try:
            with patch("routers.connect.get_auth_manager", return_value=stub_auth), \
                 patch("routers.tracker.get_auth_manager", return_value=stub_auth):
                res = asyncio.run(coro) if asyncio.iscoroutine(coro) else coro
                return MockResponseWrapper(200, res)
        except HTTPException as exc:
            return MockResponseWrapper(exc.status_code, {"success": False, "detail": exc.detail, "error": exc.detail})

    def request(
        self,
        method: str,
        path: str,
        json_body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        user: Optional[Dict[str, Any]] = None,
    ) -> MockResponseWrapper:
        stub_auth = self._make_stub_auth(user)
        try:
            with patch("routers.connect.get_auth_manager", return_value=stub_auth), \
                 patch("routers.tracker.get_auth_manager", return_value=stub_auth):
                return self._dispatch_request(method, path, json_body=json_body, params=params, user=user)
        except HTTPException as exc:
            return MockResponseWrapper(exc.status_code, {"success": False, "detail": exc.detail, "error": exc.detail})

    def _dispatch_request(
        self,
        method: str,
        path: str,
        json_body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        user: Optional[Dict[str, Any]] = None,
    ) -> MockResponseWrapper:
        method = method.upper()
        params = params or {}
        headers = {}
        if user and user.get("id"):
            tok = self.register_mock_user(
                user_id=user["id"],
                display_name=user.get("display_name") or user.get("name") or "Player",
                player_id=user.get("player_id") or "",
                email=user.get("email") or "",
                is_admin=bool(user.get("is_admin", False)),
            )
            headers["Authorization"] = f"Bearer {tok}"
        req = MockRequest(json_body=json_body, headers=headers, mock_user=user)

        # --- Connect / Group Chat Endpoints ---
        if method == "GET" and path == "/api/connect/requests":
            return self._run_With_auth(connect_router.api_get_connect_requests(req), user=user)

        m_conn_msgs = re.match(r"^/api/connect/request/([^/]+)/messages$", path)
        if method == "GET" and m_conn_msgs:
            return self._run_With_auth(connect_router.api_get_connect_messages(m_conn_msgs.group(1), req), user=user)

        m_conn_send = re.match(r"^/api/connect/request/([^/]+)/message$", path)
        if method == "POST" and m_conn_send:
            payload = connect_router.ChatMessagePayload(
                message=(json_body or {}).get("message", ""),
                room_key=(json_body or {}).get("room_key"),
                message_id=(json_body or {}).get("message_id"),
            )
            return self._run_With_auth(connect_router.api_send_connect_message(m_conn_send.group(1), payload, req), user=user)

        # --- Game Tracker Endpoints ---
        if method == "POST" and path == "/api/tracker/room/create":
            payload = tracker_router.TrackerCreatePayload(**(json_body or {}))
            return self._run_With_auth(tracker_router.api_tracker_create_room(req, payload), user=user)

        m_trk_fin = re.match(r"^/api/tracker/room/([^/]+)/finalize$", path)
        if method == "POST" and m_trk_fin:
            payload = tracker_router.TrackerActionPayload(**(json_body or {}))
            return self._run_With_auth(tracker_router.api_tracker_finalize_game(m_trk_fin.group(1), req, payload), user=user)

        # --- Community League Endpoints ---
        if method == "GET" and path == "/api/leagues":
            return self._run_With_auth(leagues_router.get_leagues_list(), user=user)

        if method == "GET" and path == "/api/leagues/managed":
            return self._run_With_auth(
                leagues_router.get_managed_leagues_for_user(
                    user_id=params.get("user_id"),
                    player_id=params.get("player_id"),
                    email=params.get("email"),
                    display_name=params.get("display_name"),
                    is_admin=bool(params.get("is_admin", False)),
                ),
                user=user,
            )

        if method == "POST" and path == "/api/league/create":
            return self._run_With_auth(leagues_router.create_community_league(req), user=user)

        if method == "POST" and path == "/api/eventstudio/unified/create":
            return self._run_With_auth(leagues_router.create_unified_event_endpoint(req), user=user)

        m_player_lg = re.match(r"^/api/league/player/([^/]+)$", path)
        if method == "GET" and m_player_lg:
            return self._run_With_auth(leagues_router.get_player_leagues(m_player_lg.group(1)), user=user)

        m_lg_get = re.match(r"^/api/leagues?/([^/]+)$", path)
        if method == "GET" and m_lg_get:
            return self._run_With_auth(leagues_router.get_league_details(m_lg_get.group(1), season=params.get("season")), user=user)

        m_lg_cfg = re.match(r"^/api/league/([^/]+)/config$", path)
        if method in ("POST", "PUT") and m_lg_cfg:
            return self._run_With_auth(leagues_router.update_community_league_config(m_lg_cfg.group(1), req), user=user)

        m_lg_chats = re.match(r"^/api/league/([^/]+)/chats$", path)
        if method == "GET" and m_lg_chats:
            return self._run_With_auth(leagues_router.get_league_group_chats_endpoint(m_lg_chats.group(1)), user=user)

        m_lg_chats_reset = re.match(r"^/api/league/([^/]+)/chats/reset$", path)
        if method == "POST" and m_lg_chats_reset:
            return self._run_With_auth(leagues_router.reset_league_group_chats_endpoint(m_lg_chats_reset.group(1), req), user=user)

        m_lg_reg_win = re.match(r"^/api/league/([^/]+)/registration-window$", path)
        if method == "POST" and m_lg_reg_win:
            return self._run_With_auth(leagues_router.update_league_registration_window(m_lg_reg_win.group(1), req), user=user)

        m_lg_reg = re.match(r"^/api/league/([^/]+)/register$", path)
        if method == "POST" and m_lg_reg:
            return self._run_With_auth(leagues_router.register_player_into_league(m_lg_reg.group(1), req), user=user)

        m_lg_pods_create = re.match(r"^/api/league/([^/]+)/pods/create$", path)
        if method == "POST" and m_lg_pods_create:
            return self._run_With_auth(leagues_router.create_league_pods_endpoint(m_lg_pods_create.group(1), req), user=user)

        m_lg_match_rep = re.match(r"^/api/league/([^/]+)/(?:match/report|report-match)$", path)
        if method == "POST" and m_lg_match_rep:
            return self._run_With_auth(leagues_router.report_league_match(m_lg_match_rep.group(1), req), user=user)

        m_lg_roster = re.match(r"^/api/league/([^/]+)/(?:roster/update|pod/roster)$", path)
        if method == "POST" and m_lg_roster:
            return self._run_With_auth(leagues_router.update_league_pod_roster_endpoint(m_lg_roster.group(1), req), user=user)

        m_lg_pairings = re.match(r"^/api/league/([^/]+)/(?:pairings/update|pod/pairings)$", path)
        if method == "POST" and m_lg_pairings:
            return self._run_With_auth(leagues_router.update_league_pod_pairings_endpoint(m_lg_pairings.group(1), req), user=user)

        m_lg_anns = re.match(r"^/api/league/([^/]+)/announcements$", path)
        if m_lg_anns:
            if method == "GET":
                return self._run_With_auth(leagues_router.get_league_announcements_endpoint(m_lg_anns.group(1)), user=user)
            if method == "POST":
                return self._run_With_auth(leagues_router.save_league_announcement_endpoint(m_lg_anns.group(1), req), user=user)

        m_lg_ann_del = re.match(r"^/api/league/([^/]+)/announcements/([^/]+)$", path)
        if method == "DELETE" and m_lg_ann_del:
            return self._run_With_auth(
                leagues_router.delete_league_announcement_endpoint(m_lg_ann_del.group(1), m_lg_ann_del.group(2)),
                user=user,
            )

        m_lg_preview = re.match(r"^/api/league/([^/]+)/rollover/preview$", path)
        if method == "GET" and m_lg_preview:
            return self._run_With_auth(leagues_router.get_league_rollover_preview(m_lg_preview.group(1), season=params.get("season")), user=user)

        m_lg_roll = re.match(r"^/api/league/([^/]+)/(?:season/rollover|rollover)$", path)
        if method == "POST" and m_lg_roll:
            return self._run_With_auth(leagues_router.execute_league_season_rollover(m_lg_roll.group(1), req), user=user)

        m_lg_s_end = re.match(r"^/api/league/([^/]+)/season/end$", path)
        if method == "POST" and m_lg_s_end:
            return self._run_With_auth(leagues_router.end_league_season_endpoint(m_lg_s_end.group(1), req), user=user)

        m_lg_end = re.match(r"^/api/league/([^/]+)/end$", path)
        if method == "POST" and m_lg_end:
            return self._run_With_auth(leagues_router.end_league_endpoint(m_lg_end.group(1), req), user=user)

        m_lg_seasons = re.match(r"^/api/league/([^/]+)/seasons$", path)
        if method == "GET" and m_lg_seasons:
            return self._run_With_auth(leagues_router.get_league_seasons(m_lg_seasons.group(1)), user=user)

        m_lg_season_n = re.match(r"^/api/league/([^/]+)/season/(\d+)$", path)
        if method == "GET" and m_lg_season_n:
            return self._run_With_auth(leagues_router.get_league_season(m_lg_season_n.group(1), int(m_lg_season_n.group(2))), user=user)

        m_ops_get = re.match(r"^/api/eventstudio/ops/([^/]+)$", path)
        if method == "GET" and m_ops_get:
            return self._run_With_auth(leagues_router.get_unified_ops_endpoint(m_ops_get.group(1)), user=user)

        m_ops_clock = re.match(r"^/api/eventstudio/ops/([^/]+)/clock$", path)
        if method == "POST" and m_ops_clock:
            return self._run_With_auth(leagues_router.update_unified_clock_endpoint(m_ops_clock.group(1), req), user=user)

        m_ops_flag = re.match(r"^/api/eventstudio/ops/([^/]+)/flag$", path)
        if method == "POST" and m_ops_flag:
            return self._run_With_auth(leagues_router.create_unified_flag_endpoint(m_ops_flag.group(1), req), user=user)

        m_ops_flag_res = re.match(r"^/api/eventstudio/ops/([^/]+)/flag/resolve$", path)
        if method == "POST" and m_ops_flag_res:
            return self._run_With_auth(leagues_router.resolve_unified_flag_endpoint(m_ops_flag_res.group(1), req), user=user)

        m_ops_brc = re.match(r"^/api/eventstudio/ops/([^/]+)/broadcast$", path)
        if method == "POST" and m_ops_brc:
            return self._run_With_auth(leagues_router.publish_unified_broadcast_endpoint(m_ops_brc.group(1), req), user=user)

        m_ops_ack = re.match(r"^/api/eventstudio/ops/([^/]+)/broadcast/ack$", path)
        if method == "POST" and m_ops_ack:
            return self._run_With_auth(leagues_router.ack_unified_broadcast_endpoint(m_ops_ack.group(1), req), user=user)

        raise ValueError(f"Unhandled route in LeagueE2EClient: {method} {path}")

    def get(self, path: str, params: Optional[Dict[str, Any]] = None, user: Optional[Dict[str, Any]] = None) -> MockResponseWrapper:
        return self.request("GET", path, params=params, user=user)

    def post(self, path: str, json: Optional[Dict[str, Any]] = None, user: Optional[Dict[str, Any]] = None) -> MockResponseWrapper:
        return self.request("POST", path, json_body=json, user=user)

    def put(self, path: str, json: Optional[Dict[str, Any]] = None, user: Optional[Dict[str, Any]] = None) -> MockResponseWrapper:
        return self.request("PUT", path, json_body=json, user=user)

    def delete(self, path: str, user: Optional[Dict[str, Any]] = None) -> MockResponseWrapper:
        return self.request("DELETE", path, user=user)


def _get_user_league_chats(client: LeagueE2EClient, league_id: str, user_dict: Dict[str, Any]):
    """Fetches `/api/connect/requests` as `user_dict` and filters to group chats belonging to `league_id`."""
    resp = client.get(
        "/api/connect/requests",
        user={
            "id": user_dict["user_id"],
            "display_name": user_dict["name"],
            "player_id": user_dict.get("player_id", ""),
        },
    )
    assert resp.status_code == 200, resp.text
    reqs = resp.json().get("requests") or []
    return [r for r in reqs if r.get("is_group_chat") and r.get("league_id") == league_id]


class TestLeagueE2EUserJourneys(unittest.TestCase):
    """End-to-End Test Suite for all Community League User Journeys."""

    @classmethod
    def setUpClass(cls):
        cls.client = LeagueE2EClient()
        cls.suffix = uuid.uuid4().hex[:6].upper()
        cls.commissioner = {
            "name": f"Commissioner {cls.suffix}",
            "user_id": f"uid_comm_{cls.suffix.lower()}",
            "player_id": f"PID_COMM_{cls.suffix}",
            "email": f"comm.{cls.suffix.lower()}@omnitactica.com",
        }
        cls.players = [
            {"name": f"Alice Vanguard {cls.suffix}", "user_id": f"uid_alice_{cls.suffix.lower()}", "player_id": f"PID_ALICE_{cls.suffix}", "faction": "Aeldari", "elo": 1850},
            {"name": f"Bob Ironhand {cls.suffix}", "user_id": f"uid_bob_{cls.suffix.lower()}", "player_id": f"PID_BOB_{cls.suffix}", "faction": "Space Marines", "elo": 1790},
            {"name": f"Charlie Void {cls.suffix}", "user_id": f"uid_charlie_{cls.suffix.lower()}", "player_id": f"PID_CHARLIE_{cls.suffix}", "faction": "Necrons", "elo": 1720},
            {"name": f"Diana Storm {cls.suffix}", "user_id": f"uid_diana_{cls.suffix.lower()}", "player_id": f"PID_DIANA_{cls.suffix}", "faction": "Astra Militarum", "elo": 1660},
            {"name": f"Evan Hive {cls.suffix}", "user_id": f"uid_evan_{cls.suffix.lower()}", "player_id": f"PID_EVAN_{cls.suffix}", "faction": "Tyranids", "elo": 1590},
            {"name": f"Fiona Warp {cls.suffix}", "user_id": f"uid_fiona_{cls.suffix.lower()}", "player_id": f"PID_FIONA_{cls.suffix}", "faction": "Chaos Daemons", "elo": 1510},
        ]
        cls.outsider = {
            "name": f"Outsider Observer {cls.suffix}",
            "user_id": f"uid_outsider_{cls.suffix.lower()}",
            "player_id": f"PID_OUTSIDER_{cls.suffix}",
        }
        cls.league_id = None

    def test_01_create_league_and_pre_pod_chat_lifecycle(self):
        """
        Journey 1: Creating a new league immediately creates its general League Q&A chat,
        and until pods are created there are 0 Pod chats. Non-members see 0 chats.
        """
        resp = self.client.post(
            "/api/league/create",
            json={
                "name": f"SoCal Premier League {self.suffix}",
                "short_name": f"SCPL-{self.suffix}",
                "tagline": "Competitive 40K Pod League",
                "city": "San Diego",
                "state": "CA",
                "venue_name": "At Ease Games",
                "points_limit": 2000,
                "games_per_season": 3,
                "pod_size": 3,
                "promotion_count": 2,
                "relegation_count": 2,
                "start_date": "2026-09-15",
                "end_date": "2026-11-15",
                "owner_user_id": self.commissioner["user_id"],
                "owner_player_id": self.commissioner["player_id"],
                "owner_name": self.commissioner["name"],
                "owner_email": self.commissioner["email"],
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["success"])
        TestLeagueE2EUserJourneys.league_id = data["league_id"]
        league = data["league"]

        # Until pods are created, pods list is empty
        self.assertEqual(league["status"], "active")
        self.assertEqual(league["active_season"]["season_number"], 1)
        self.assertEqual(league["active_season"]["pods"], [])

        # Verify GET /api/league/{lid}/chats: general League Q&A chat exists, 0 Pod chats exist
        chats_data = self.client.get(f"/api/league/{self.league_id}/chats").json()
        self.assertTrue(chats_data["success"])
        self.assertIsNotNone(chats_data["league_chat"])
        self.assertEqual(chats_data["league_chat"]["channel_id"], f"grp_league_{self.league_id}_s1")
        self.assertEqual(chats_data["pod_chats"], [])
        self.assertEqual(len(chats_data["chats"]), 1)

        # Commissioner sees 1 chat (general League Q&A); Outsider and unregistered Alice see 0 chats
        comm_chats = _get_user_league_chats(self.client, self.league_id, self.commissioner)
        self.assertEqual(len(comm_chats), 1)
        self.assertEqual(comm_chats[0]["channel_id"], f"grp_league_{self.league_id}_s1")

        self.assertEqual(_get_user_league_chats(self.client, self.league_id, self.outsider), [])
        self.assertEqual(_get_user_league_chats(self.client, self.league_id, self.players[0]), [])
        print("✓ Journey 1 passed: New league has general chat only, 0 pod chats before pods are created")

    def test_02_registration_window_and_pre_pod_player_registration(self):
        """
        Journey 2: Closing registration blocks signups; opening registration lets players join
        pre-pod into the general League chat while Pod chats remain 0 until pods are created.
        """
        lid = self.league_id
        # Close registration window
        close_res = self.client.post(f"/api/league/{lid}/registration-window", json={"registration_open": False}).json()
        self.assertFalse(close_res["registration_open"])

        blocked = self.client.post(
            f"/api/league/{lid}/register",
            json={
                "player_name": self.players[0]["name"],
                "user_id": self.players[0]["user_id"],
                "player_id": self.players[0]["player_id"],
                "primary_faction": self.players[0]["faction"],
            },
        ).json()
        self.assertFalse(blocked.get("success"))
        self.assertIn("closed", blocked.get("error", "").lower())

        # Re-open registration window
        open_res = self.client.post(f"/api/league/{lid}/registration-window", json={"registration_open": True}).json()
        self.assertTrue(open_res["registration_open"])

        # Register all 6 players before pods are created
        for p in self.players:
            reg_res = self.client.post(
                f"/api/league/{lid}/register",
                json={
                    "player_name": p["name"],
                    "user_id": p["user_id"],
                    "player_id": p["player_id"],
                    "primary_faction": p["faction"],
                    "seed_elo": p["elo"],
                },
            ).json()
            self.assertTrue(reg_res["success"])
            self.assertIsNone(reg_res["assigned_pod"])

        # Still 0 pod chats, but all 6 registered players are in the general League Q&A chat!
        chats_data = self.client.get(f"/api/league/{lid}/chats").json()
        self.assertEqual(chats_data["pod_chats"], [])
        for p in self.players:
            self.assertIn(p["name"], chats_data["league_chat"]["participant_names"])
            u_chats = _get_user_league_chats(self.client, lid, p)
            self.assertEqual(len(u_chats), 1)
            self.assertEqual(u_chats[0]["channel_id"], f"grp_league_{lid}_s1")

        # Outsider still sees 0 chats
        self.assertEqual(_get_user_league_chats(self.client, lid, self.outsider), [])

        # Registered player can post & read in the general League Q&A chat
        alice_user = {"id": self.players[0]["user_id"], "display_name": self.players[0]["name"], "player_id": self.players[0]["player_id"]}
        send_res = self.client.post(
            f"/api/connect/request/grp_league_{lid}_s1/message",
            json={"message": "Excited for Season 1! When do pods get seeded?"},
            user=alice_user,
        )
        self.assertEqual(send_res.status_code, 200)
        self.assertTrue(send_res.json()["success"])

        hist_res = self.client.get(f"/api/connect/request/grp_league_{lid}_s1/messages", user=alice_user).json()
        self.assertTrue(hist_res["success"])
        self.assertTrue(any("Excited for Season 1!" in m.get("message_text", "") for m in hist_res["messages"]))
        print("✓ Journey 2 passed: Registration window enforced & pre-pod registrants placed in general League chat only")

    def test_03_pod_creation_and_strict_two_chat_isolation(self):
        """
        Journey 3: Creating pods seeds players by Elo, generates round-robin pairings,
        and creates Pod-specific chats. Each player sees AT MOST 2 chats (General + their Pod).
        """
        lid = self.league_id
        res = self.client.post(
            f"/api/league/{lid}/pods/create",
            json={"pods_count": 2, "pod_size": 3, "seed_mode": "elo"},
        )
        self.assertEqual(res.status_code, 200)
        pods = res.json()["league"]["active_season"]["pods"]
        self.assertEqual(len(pods), 2)

        pod1_names = [s["name"] for s in pods[0]["standings"]]
        pod2_names = [s["name"] for s in pods[1]["standings"]]
        self.assertEqual(pod1_names, [self.players[0]["name"], self.players[1]["name"], self.players[2]["name"]])
        self.assertEqual(pod2_names, [self.players[3]["name"], self.players[4]["name"], self.players[5]["name"]])

        # Verify Pod chats now exist
        chats_data = self.client.get(f"/api/league/{lid}/chats").json()
        self.assertEqual(len(chats_data["pod_chats"]), 2)
        pod1_cid = f"grp_pod_{lid}_s1_p1"
        pod2_cid = f"grp_pod_{lid}_s1_p2"
        self.assertEqual([c["channel_id"] for c in chats_data["pod_chats"]], [pod1_cid, pod2_cid])

        # Pod 1 players see ONLY General League chat + Pod 1 chat (2 chats total)
        for p in self.players[:3]:
            u_chats = _get_user_league_chats(self.client, lid, p)
            self.assertEqual(len(u_chats), 2)
            self.assertEqual({c["channel_id"] for c in u_chats}, {f"grp_league_{lid}_s1", pod1_cid})

        # Pod 2 players see ONLY General League chat + Pod 2 chat (2 chats total)
        for p in self.players[3:]:
            u_chats = _get_user_league_chats(self.client, lid, p)
            self.assertEqual(len(u_chats), 2)
            self.assertEqual({c["channel_id"] for c in u_chats}, {f"grp_league_{lid}_s1", pod2_cid})

        # Outsider sees 0 chats
        self.assertEqual(_get_user_league_chats(self.client, lid, self.outsider), [])

        # Pod 1 player sends a message in Pod 1 chat
        alice_user = {"id": self.players[0]["user_id"], "display_name": self.players[0]["name"], "player_id": self.players[0]["player_id"]}
        send_p1 = self.client.post(
            f"/api/connect/request/{pod1_cid}/message",
            json={"message": "Hey Pod 1! Ready for Round 1?"},
            user=alice_user,
        )
        self.assertEqual(send_p1.status_code, 200)
        self.assertTrue(send_p1.json()["success"])
        print("✓ Journey 3 passed: Pods seeded by Elo, Pod chats created, strict 2-chat per player isolation verified")

    def test_04_update_league_config_reflects_from_player_perspective(self):
        """
        Journey 4: Updating league config reflects immediately across League Hub,
        Player Active League Summary, Pod Pairings Layouts, Custom Pod Names, and Group Chats.
        """
        lid = self.league_id
        cfg_resp = self.client.put(
            f"/api/league/{lid}/config",
            json={
                "name": f"Updated SoCal Apex League {self.suffix}",
                "short_name": f"APEX-{self.suffix}",
                "tagline": "Updated 1500pt Tactical Format",
                "venue_name": "Game Empire Pasadena",
                "points_limit": 1500,
                "games_per_season": 3,
                "win_bonus_bp": 1200,
                "draw_bonus_bp": 600,
                "in_pod_ringer_bonus_bp": 800,
                "paint_bonus_bp": 15,
                "out_of_pod_ringer_allowed": True,
                "min_games_required": 3,
                "promotion_count": 1,
                "relegation_count": 1,
                "start_date": "2026-10-01",
                "end_date": "2026-12-20",
                "custom_pod_names": {
                    "1": "Pod #1 — Primarch Division",
                    "2": "Pod #2 — Chapter Master Division",
                },
                "round_layouts": ["WTC Terrain A", "WTC Terrain B", "WTC Terrain C"],
            },
        )
        self.assertEqual(cfg_resp.status_code, 200)
        self.assertTrue(cfg_resp.json()["success"])

        # Check GET /api/league/{lid}
        lg = self.client.get(f"/api/league/{lid}").json()["league"]
        self.assertEqual(lg["name"], f"Updated SoCal Apex League {self.suffix}")
        self.assertEqual(lg["short_name"], f"APEX-{self.suffix}")
        self.assertEqual(lg["tagline"], "Updated 1500pt Tactical Format")
        self.assertEqual(lg["partner_venues"][0]["name"], "Game Empire Pasadena")
        meth = lg["methodology"]
        self.assertEqual(meth["points_limit"], 1500)
        self.assertEqual(meth["win_bonus_bp"], 1200)
        self.assertEqual(meth["draw_bonus_bp"], 600)
        self.assertEqual(meth["in_pod_ringer_bonus_bp"], 800)
        self.assertEqual(meth["paint_bonus_bp"], 15)
        self.assertTrue(meth["out_of_pod_ringer_allowed"])
        self.assertEqual(meth["promotion_count"], 1)
        self.assertEqual(meth["relegation_count"], 1)
        self.assertEqual(meth["round_layouts"], ["WTC Terrain A", "WTC Terrain B", "WTC Terrain C"])

        # Custom pod names & round layouts reflected on pods
        p1, p2 = lg["active_season"]["pods"][0], lg["active_season"]["pods"][1]
        self.assertEqual(p1["name"], "Pod #1 — Primarch Division")
        self.assertEqual(p2["name"], "Pod #2 — Chapter Master Division")
        self.assertEqual([pr["layout"] for pr in p1["standings"][0]["pairings"]], ["WTC Terrain A", "WTC Terrain B", "WTC Terrain C"])

        # Check Player Perspective (/api/league/player/{name})
        player_summary = self.client.get(f"/api/league/player/{self.players[0]['name']}").json()
        alice_lg = next((x for x in player_summary["active_leagues"] if x["league_id"] == lid), None)
        self.assertIsNotNone(alice_lg)
        self.assertEqual(alice_lg["league_name"], f"Updated SoCal Apex League {self.suffix}")
        self.assertEqual(alice_lg["pod_name"], "Pod #1 — Primarch Division")

        # Check Group Chat titles, subtitles, and greeting messages from player perspective
        alice_chats = _get_user_league_chats(self.client, lid, self.players[0])
        pod1_chat = next(c for c in alice_chats if c["chat_type"] == "pod")
        self.assertIn(f"APEX-{self.suffix}", pod1_chat["title"])
        self.assertIn("Pod #1 — Primarch Division", pod1_chat["subtitle"])
        self.assertIn("1500 pts at Game Empire Pasadena", pod1_chat["greeting_message"])
        self.assertIn("2026-12-20", pod1_chat["season_end_date"])
        print("✓ Journey 4 passed: League config updates reflected across player views, pairings, and group chats")

    def test_05_game_tracker_finalization_reflects_on_league(self):
        """
        Journey 5: Submitting completed games from Game Tracker (`POST /api/tracker/room/{id}/finalize`)
        automatically updates League standings, pairings, scorecard_id, and configured Battle Points
        (both with explicit `league_id` and via auto-detected active league pod-mates).
        """
        lid = self.league_id
        lg = self.client.get(f"/api/league/{lid}").json()["league"]
        p1_standings = lg["active_season"]["pods"][0]["standings"]
        alice_name = self.players[0]["name"]
        alice_st = next(s for s in p1_standings if s["name"] == alice_name)
        alice_podmate_pairings = [pr for pr in alice_st["pairings"] if not pr.get("is_ringer")]
        alice_first_pair = alice_podmate_pairings[0]
        alice_r1_opp = alice_first_pair["opponent_name"]
        alice_r1_round = alice_first_pair["round"]
        alice_user = {"id": self.players[0]["user_id"], "display_name": alice_name, "player_id": self.players[0]["player_id"]}

        # 5A: Explicit league_id room in Game Tracker
        room_res = self.client.post(
            "/api/tracker/room/create",
            json={
                "match_id": f"LG-{self.suffix}-P1-R{alice_r1_round}",
                "p1_name": alice_name,
                "p2_name": alice_r1_opp,
                "p1_faction": self.players[0]["faction"],
                "p2_faction": "Space Marines",
            },
            user=alice_user,
        ).json()
        match_id = room_res["match_id"]

        fin_res = self.client.post(
            f"/api/tracker/room/{match_id}/finalize",
            json={
                "state": {
                    "league_id": lid,
                    "pod_number": 1,
                    "round_num": alice_r1_round,
                    "p1_name": alice_name,
                    "p2_name": alice_r1_opp,
                    "p1_score": 88,
                    "p2_score": 64,
                }
            },
            user=alice_user,
        ).json()
        self.assertTrue(fin_res["success"])
        self.assertTrue(fin_res["league_submitted"])
        self.assertEqual(fin_res["league_id"], lid)

        # Verify Pod 1 standings & pairings
        lg_after = self.client.get(f"/api/league/{lid}").json()["league"]
        p1_map = {s["name"]: s for s in lg_after["active_season"]["pods"][0]["standings"]}
        self.assertEqual(p1_map[alice_name]["wins"], 1)
        self.assertEqual(p1_map[alice_name]["games_played"], 1)
        self.assertEqual(p1_map[alice_name]["battle_points"], 88 + 1200 + 15)  # 1303 BP
        self.assertEqual(p1_map[alice_r1_opp]["losses"], 1)
        self.assertEqual(p1_map[alice_r1_opp]["battle_points"], 64 + 15)  # 79 BP

        r1_slot = next(pr for pr in p1_map[alice_name]["pairings"] if pr["round"] == alice_r1_round)
        self.assertTrue(r1_slot["is_completed"])
        self.assertEqual(r1_slot["result"], "W")
        self.assertEqual(r1_slot["scorecard_id"], match_id)

        # 5B: Auto-detected League Match from Game Tracker (no league_id passed in room or state!)
        p2_standings = lg_after["active_season"]["pods"][1]["standings"]
        diana_name = self.players[3]["name"]
        diana_st = next(s for s in p2_standings if s["name"] == diana_name)
        diana_podmate_pairings = [pr for pr in diana_st["pairings"] if not pr.get("is_ringer")]
        diana_r1_opp = diana_podmate_pairings[0]["opponent_name"]
        diana_user = {"id": self.players[3]["user_id"], "display_name": diana_name, "player_id": self.players[3]["player_id"]}

        auto_room = self.client.post(
            "/api/tracker/room/create",
            json={
                "match_id": f"AUTO-TRK-{self.suffix}",
                "p1_name": diana_name,
                "p2_name": diana_r1_opp,
            },
            user=diana_user,
        ).json()
        auto_mid = auto_room["match_id"]

        auto_fin = self.client.post(
            f"/api/tracker/room/{auto_mid}/finalize",
            json={
                "state": {
                    "p1_name": diana_name,
                    "p2_name": diana_r1_opp,
                    "p1_score": 92,
                    "p2_score": 50,
                }
            },
            user=diana_user,
        ).json()
        self.assertTrue(auto_fin["success"])
        self.assertTrue(auto_fin["league_submitted"])
        self.assertEqual(auto_fin["league_id"], lid)

        lg_after_auto = self.client.get(f"/api/league/{lid}").json()["league"]
        p2_map = {s["name"]: s for s in lg_after_auto["active_season"]["pods"][1]["standings"]}
        self.assertEqual(p2_map[diana_name]["wins"], 1)
        self.assertEqual(p2_map[diana_name]["battle_points"], 92 + 1200 + 15)  # 1307 BP
        self.assertEqual(p2_map[diana_r1_opp]["losses"], 1)
        self.assertEqual(p2_map[diana_r1_opp]["battle_points"], 50 + 15)  # 65 BP
        print("✓ Journey 5 passed: Game Tracker finalization (explicit & auto-detected) updates League standings & BP")

    def test_06_direct_match_report_draw_ringer_and_idempotency(self):
        """
        Journey 6: Direct match reporting (`POST /api/league/{lid}/match/report`),
        Draw bonus calculation, and re-reporting idempotency (no double-counting).
        """
        lid = self.league_id
        lg = self.client.get(f"/api/league/{lid}").json()["league"]
        alice_name = self.players[0]["name"]
        alice_st = next(s for s in lg["active_season"]["pods"][0]["standings"] if s["name"] == alice_name)
        alice_podmate_pairings = [pr for pr in alice_st["pairings"] if not pr.get("is_ringer")]
        second_pair = alice_podmate_pairings[1]
        third_p1 = second_pair["opponent_name"]
        second_round = second_pair["round"]

        # Report second podmate match as a 75-75 Draw
        draw_res = self.client.post(
            f"/api/league/{lid}/match/report",
            json={
                "pod_number": 1,
                "round_number": second_round,
                "p1_name": alice_name,
                "p2_name": third_p1,
                "p1_score": 75,
                "p2_score": 75,
                "scorecard_id": f"SC-DRAW-{self.suffix}",
            },
        ).json()
        self.assertTrue(draw_res["success"])
        p1_map = {s["name"]: s for s in draw_res["pod"]["standings"]}
        self.assertEqual(p1_map[alice_name]["draws"], 1)
        self.assertEqual(p1_map[alice_name]["games_played"], 2)
        self.assertEqual(p1_map[alice_name]["battle_points"], 1303 + (75 + 600 + 15))  # 1993 BP

        # Re-report the same match as an Alice 90-70 Win -> games_played stays 2 (idempotent!)
        rereport_res = self.client.post(
            f"/api/league/{lid}/match/report",
            json={
                "pod_number": 1,
                "round_number": second_round,
                "p1_name": alice_name,
                "p2_name": third_p1,
                "p1_score": 90,
                "p2_score": 70,
                "scorecard_id": f"SC-WIN-{self.suffix}",
            },
        ).json()
        p1_map2 = {s["name"]: s for s in rereport_res["pod"]["standings"]}
        self.assertEqual(p1_map2[alice_name]["wins"], 2)
        self.assertEqual(p1_map2[alice_name]["draws"], 0)
        self.assertEqual(p1_map2[alice_name]["games_played"], 2)
        self.assertEqual(p1_map2[alice_name]["battle_points"], 1303 + (90 + 1200 + 15))  # 2608 BP

        # Complete second podmate match in Pod 2 (Diana wins) and Bob vs Charlie in Pod 1 for clear promotion/relegation order
        diana_name = self.players[3]["name"]
        p2_st = lg["active_season"]["pods"][1]["standings"]
        diana_st = next(s for s in p2_st if s["name"] == diana_name)
        diana_podmate_pairings = [pr for pr in diana_st["pairings"] if not pr.get("is_ringer")]
        diana_second_pair = diana_podmate_pairings[1]
        third_p2 = diana_second_pair["opponent_name"]

        self.client.post(
            f"/api/league/{lid}/match/report",
            json={"pod_number": 2, "round_number": diana_second_pair["round"], "p1_name": diana_name, "p2_name": third_p2, "p1_score": 85, "p2_score": 55},
        )
        self.client.post(
            f"/api/league/{lid}/match/report",
            json={"pod_number": 1, "round_number": 1, "p1_name": self.players[1]["name"], "p2_name": self.players[2]["name"], "p1_score": 80, "p2_score": 60},
        )
        print("✓ Journey 6 passed: Direct match report, draw BP bonus, and re-report idempotency verified")

    def test_07_roster_moves_drops_disciplinary_cards_and_seat_swaps(self):
        """
        Journey 7: Disciplinary cards, Seed Elo override, moving a player between pods
        (dynamically updating their Pod chat), dropping/restoring a player, and Round-Robin seat swaps.
        """
        lid = self.league_id
        # 1. Assign Yellow Card & Seed Elo override to Charlie
        card_res = self.client.post(
            f"/api/league/{lid}/roster/update",
            json={
                "action": "update_player",
                "pod_number": 1,
                "player_name": self.players[2]["name"],
                "disciplinary_card": "yellow",
                "seed_elo": 1735,
            },
        ).json()
        charlie_row = next(s for s in card_res["league"]["active_season"]["pods"][0]["standings"] if s["name"] == self.players[2]["name"])
        self.assertEqual(charlie_row["disciplinary_card"], "yellow")
        self.assertEqual(charlie_row["seed_elo"], 1735)

        # 2. Move Fiona from Pod 2 to Pod 1 -> her Pod chat switches to Pod 1; move back to Pod 2 -> switches back
        self.client.post(
            f"/api/league/{lid}/roster/update",
            json={"action": "update_player", "pod_number": 2, "target_pod_number": 1, "player_name": self.players[5]["name"]},
        )
        fiona_chats_p1 = _get_user_league_chats(self.client, lid, self.players[5])
        self.assertEqual({c["channel_id"] for c in fiona_chats_p1}, {f"grp_league_{lid}_s1", f"grp_pod_{lid}_s1_p1"})

        self.client.post(
            f"/api/league/{lid}/roster/update",
            json={"action": "update_player", "pod_number": 1, "target_pod_number": 2, "player_name": self.players[5]["name"]},
        )
        fiona_chats_p2 = _get_user_league_chats(self.client, lid, self.players[5])
        self.assertEqual({c["channel_id"] for c in fiona_chats_p2}, {f"grp_league_{lid}_s1", f"grp_pod_{lid}_s1_p2"})

        # 3. Drop Fiona -> removed from Pod 2 chat; Undrop Fiona -> restored to Pod 2 chat
        self.client.post(
            f"/api/league/{lid}/roster/update",
            json={"action": "update_player", "pod_number": 2, "player_name": self.players[5]["name"], "dropped": True},
        )
        self.assertEqual(_get_user_league_chats(self.client, lid, self.players[5]), [])

        self.client.post(
            f"/api/league/{lid}/roster/update",
            json={"action": "update_player", "pod_number": 2, "player_name": self.players[5]["name"], "dropped": False, "relegation_status": "Safe"},
        )
        self.assertEqual(len(_get_user_league_chats(self.client, lid, self.players[5])), 2)

        # 4. Swap seats in Round 3 of Pod 2 (`swap_seats_in_round`)
        swap_res = self.client.post(
            f"/api/league/{lid}/pairings/update",
            json={
                "action": "swap_seats_in_round",
                "pod_number": 2,
                "round": 3,
                "player_a": self.players[3]["name"],
                "player_b": self.players[4]["name"],
            },
        ).json()
        self.assertTrue(swap_res["success"])
        print("✓ Journey 7 passed: Roster moves, drops, disciplinary cards, seed Elo overrides, and seat swaps verified")

    def test_08_announcements_and_live_floor_operations(self):
        """
        Journey 8: Creating/deleting League Announcements and operating Unified Live Floor Ops
        (Master Round Clock, Table Judge Calls + Time Extensions, and Broadcast Acknowledgements).
        """
        lid = self.league_id
        # Create announcement
        ann_res = self.client.post(
            f"/api/league/{lid}/announcements",
            json={
                "title": "Round 3 Deadline Notice",
                "body": "All Round 3 games must be finalized by Sunday 11:59 PM.",
                "category": "schedule",
                "priority": "high",
                "target_pod": "All Pods",
                "is_pinned": True,
                "author_name": self.commissioner["name"],
            },
        ).json()
        self.assertTrue(ann_res["success"])
        ann_id = ann_res["announcement"]["id"]

        anns_list = self.client.get(f"/api/league/{lid}/announcements").json()["announcements"]
        self.assertTrue(any(a["id"] == ann_id for a in anns_list))

        # Delete announcement
        del_res = self.client.delete(f"/api/league/{lid}/announcements/{ann_id}").json()
        self.assertTrue(del_res["success"])
        anns_after = self.client.get(f"/api/league/{lid}/announcements").json()["announcements"]
        self.assertFalse(any(a["id"] == ann_id for a in anns_after))

        # Live Floor Operations: Start Clock -> Raise Judge Call -> Resolve with +10m Table Extension -> Publish & Ack Broadcast
        clock_res = self.client.post(f"/api/eventstudio/ops/{lid}/clock", json={"action": "start", "round_number": 3, "duration_minutes": 180}).json()
        self.assertEqual(clock_res["clock"]["status"], "running")

        flag_res = self.client.post(
            f"/api/eventstudio/ops/{lid}/flag",
            json={"round_number": 3, "pod_number": 1, "table_number": 2, "caller_name": self.players[0]["name"], "category": "Line of Sight Ruling"},
        ).json()
        call_id = flag_res["created_flag"]["call_id"]
        self.assertEqual(flag_res["active_flags_count"], 1)

        resolve_res = self.client.post(
            f"/api/eventstudio/ops/{lid}/flag/resolve",
            json={"call_id": call_id, "status": "resolved", "assigned_judge": self.commissioner["name"], "resolution_note": "Ruled obscure", "time_extension_minutes": 10},
        ).json()
        self.assertEqual(resolve_res["active_flags_count"], 0)
        self.assertEqual(resolve_res["clock"]["table_extensions"]["Table 2"]["extra_minutes"], 10)

        brc_res = self.client.post(
            f"/api/eventstudio/ops/{lid}/broadcast",
            json={"title": "Pairings Locked", "message": "Pod 1 & Pod 2 pairings are official.", "require_ack": True, "author_name": self.commissioner["name"]},
        ).json()
        brc_id = brc_res["broadcasts"][0]["broadcast_id"]

        ack_res = self.client.post(
            f"/api/eventstudio/ops/{lid}/broadcast/ack",
            json={"broadcast_id": brc_id, "player_id": self.players[0]["player_id"], "player_name": self.players[0]["name"]},
        ).json()
        acked_brc = next(b for b in ack_res["broadcasts"] if b["broadcast_id"] == brc_id)
        self.assertEqual(acked_brc["ack_count"], 1)
        print("✓ Journey 8 passed: Announcements CRUD and Live Floor Ops (Clock, Judge Calls, Broadcast Acks) verified")

    def test_09_ending_season_removes_all_pod_chats(self):
        """
        Journey 9: Once a season ends (`POST /api/league/{lid}/season/end`), all Pod chats
        for that season are removed (`pod_chats == []`), while the general League chat remains
        available until season rollover or league end.
        """
        lid = self.league_id
        end_s_res = self.client.post(f"/api/league/{lid}/season/end", json={}).json()
        self.assertTrue(end_s_res["success"])
        self.assertEqual(end_s_res["ended_season"], 1)
        self.assertTrue(end_s_res["pod_chats_removed"])

        chats_data = self.client.get(f"/api/league/{lid}/chats").json()
        self.assertEqual(chats_data["season_status"], "completed")
        self.assertEqual(chats_data["pod_chats"], [])
        self.assertIsNotNone(chats_data["league_chat"])
        self.assertEqual(chats_data["league_chat"]["channel_id"], f"grp_league_{lid}_s1")

        # Every player now sees only 1 chat (the general League chat) and 0 Pod chats
        for p in self.players:
            p_chats = _get_user_league_chats(self.client, lid, p)
            self.assertEqual(len(p_chats), 1)
            self.assertEqual(p_chats[0]["channel_id"], f"grp_league_{lid}_s1")

        # Attempting to fetch Pod 1 chat messages returns HTTP 400 (expired season)
        alice_user = {"id": self.players[0]["user_id"], "display_name": self.players[0]["name"], "player_id": self.players[0]["player_id"]}
        exp_pod_resp = self.client.get(f"/api/connect/request/grp_pod_{lid}_s1_p1/messages", user=alice_user)
        self.assertEqual(exp_pod_resp.status_code, 400)
        self.assertIn("ended", exp_pod_resp.json().get("error", "").lower())
        print("✓ Journey 9 passed: Ending Season 1 removes all Pod chats while keeping general League chat active")

    def test_10_season_rollover_and_ending_league_removes_all_chats(self):
        """
        Journey 10: Repeating a League Season (`POST /api/league/{lid}/season/rollover`) promotes/relegates
        players, archives Season 1, resets Season 2 standings, and creates Season 2 chats.
        Then ending the League (`POST /api/league/{lid}/end`) removes ALL chats (League + Pod).
        """
        lid = self.league_id
        diana_name = self.players[3]["name"]
        charlie_name = self.players[2]["name"]

        # 1. Preview Promotion & Relegation (1-up / 1-down configured in Journey 4)
        preview = self.client.get(f"/api/league/{lid}/rollover/preview").json()
        self.assertEqual(preview["current_season"], 1)
        self.assertEqual(preview["next_season"], 2)
        self.assertEqual(preview["promotion_count"], 1)
        self.assertEqual(preview["relegation_count"], 1)

        moves = {m["player"]: m for m in preview["movements"]}
        self.assertEqual(moves[diana_name]["movement"], "promoted")
        self.assertEqual(moves[diana_name]["from_pod"], 2)
        self.assertEqual(moves[diana_name]["to_pod"], 1)
        self.assertEqual(moves[charlie_name]["movement"], "relegated")
        self.assertEqual(moves[charlie_name]["from_pod"], 1)
        self.assertEqual(moves[charlie_name]["to_pod"], 2)

        # 2. Execute Rollover to Season 2
        roll_res = self.client.post(
            f"/api/league/{lid}/season/rollover",
            json={"season_name": "Season 2 — Winter Campaign", "start_date": "2027-01-10", "end_date": "2027-03-15"},
        ).json()
        self.assertTrue(roll_res["success"])
        self.assertEqual(roll_res["previous_season"], 1)
        self.assertEqual(roll_res["new_active_season"], 2)

        # Verify Season 2 rosters & reset standings
        lg_s2 = self.client.get(f"/api/league/{lid}").json()["league"]
        self.assertEqual(lg_s2["active_season"]["season_number"], 2)
        self.assertEqual(lg_s2["active_season"]["status"], "active")
        s2_p1_names = [s["name"] for s in lg_s2["active_season"]["pods"][0]["standings"]]
        s2_p2_names = [s["name"] for s in lg_s2["active_season"]["pods"][1]["standings"]]
        self.assertIn(diana_name, s2_p1_names)
        self.assertIn(charlie_name, s2_p2_names)

        for p_obj in lg_s2["active_season"]["pods"]:
            for s in p_obj["standings"]:
                self.assertEqual(s["wins"], 0)
                self.assertEqual(s["losses"], 0)
                self.assertEqual(s["draws"], 0)
                self.assertEqual(s["battle_points"], 0)
                self.assertEqual(s["games_played"], 0)
                self.assertEqual(len(s["pairings"]), 3)
                self.assertTrue(all(not pr["is_completed"] for pr in s["pairings"]))

        # Verify Season 1 is preserved in historical catalog
        seasons_cat = self.client.get(f"/api/league/{lid}/seasons").json()
        self.assertIn(1, [s["season_number"] for s in seasons_cat["seasons"]])
        self.assertIn(2, [s["season_number"] for s in seasons_cat["seasons"]])

        s1_hist = self.client.get(f"/api/league/{lid}/season/1").json()["league"]
        self.assertEqual(s1_hist["active_season"]["season_number"], 1)
        self.assertEqual(s1_hist["active_season"]["status"], "completed")
        s1_alice = next(s for s in s1_hist["active_season"]["pods"][0]["standings"] if s["name"] == self.players[0]["name"])
        self.assertEqual(s1_alice["wins"], 2)
        self.assertEqual(s1_alice["battle_points"], 2608)

        # Verify Season 2 Group Chats reflect promoted/relegated pods (and Season 1 chats are gone)
        diana_s2_chats = _get_user_league_chats(self.client, lid, self.players[3])
        self.assertEqual({c["channel_id"] for c in diana_s2_chats}, {f"grp_league_{lid}_s2", f"grp_pod_{lid}_s2_p1"})

        charlie_s2_chats = _get_user_league_chats(self.client, lid, self.players[2])
        self.assertEqual({c["channel_id"] for c in charlie_s2_chats}, {f"grp_league_{lid}_s2", f"grp_pod_{lid}_s2_p2"})

        # 3. End the Entire League -> ALL Chats (General League Chat + Pod Chats) are Removed!
        end_lg_res = self.client.post(f"/api/league/{lid}/end", json={}).json()
        self.assertTrue(end_lg_res["success"])
        self.assertEqual(end_lg_res["status"], "ended")
        self.assertTrue(end_lg_res["all_chats_removed"])

        chats_after_end = self.client.get(f"/api/league/{lid}/chats").json()
        self.assertEqual(chats_after_end["league_status"], "ended")
        self.assertIsNone(chats_after_end["league_chat"])
        self.assertEqual(chats_after_end["pod_chats"], [])
        self.assertEqual(chats_after_end["chats"], [])

        # Commissioner and all Players see 0 chats for the ended league
        self.assertEqual(_get_user_league_chats(self.client, lid, self.commissioner), [])
        for p in self.players:
            self.assertEqual(_get_user_league_chats(self.client, lid, p), [])

        alice_user = {"id": self.players[0]["user_id"], "display_name": self.players[0]["name"], "player_id": self.players[0]["player_id"]}
        exp_lg_resp = self.client.get(f"/api/connect/request/grp_league_{lid}_s2/messages", user=alice_user)
        self.assertEqual(exp_lg_resp.status_code, 400)
        self.assertIn("ended", exp_lg_resp.json().get("error", "").lower())
        print("✓ Journey 10 passed: Season rollover (promotion/relegation, archival, S2 chats) & League end (all chats removed) verified")


if __name__ == "__main__":
    print("🚀 Running Comprehensive League E2E User Journey Test Suite...")
    unittest.main(verbosity=2)
