"""End-to-end tests for OmniTactica Native Events Creation & Hosting Platform.

Covers:
1. Event Studio Catalog (23 Wargames + TCGs & 5 format presets) + Native Faction Catalogs.
2. Native Warhammer 40k Singles RTT lifecycle (create by regular player -> private access_code guard ->
   4-player registration -> hide_lists pre-start redaction -> lists_at_checkin guard -> pre-start drop & re-register ->
   ownership 403 guard -> start -> Swiss pairings + ML win% -> score submission -> standings -> end + Elo).
3. Native Magic: The Gathering Best-of-3 Swiss + Single-Elimination Top 4 -> Grand Final bracket lifecycle.
4. Native Commander (cEDH) 4-Player FFA Pods (7-player 4p+3p pod split, 5/1/0 pod points, pod winner + pod draw,
   and idempotent pairwise zero-sum FFA Elo updates via EloEngine.rate_single_event).
5. Strict <1000ms latency assertion on every API call + frontend bundle/HTML integrity.
"""

import asyncio
import copy
import inspect
import json
import os
import re
import sys
import time
import unittest
import urllib.parse
from unittest.mock import patch

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

import core
import server
from elo import EloEngine
from routers import admin, armory, armylists, auth, community, connect, eventstudio, leaderboard, leagues, tracker

try:
    from fastapi.testclient import TestClient
except ImportError:
    TestClient = None


class _CIMap(dict):
    """Case-insensitive header lookup mapping matching Starlette Headers."""

    def __init__(self, initial=None):
        super().__init__()
        for k, v in (initial or {}).items():
            self[str(k).lower()] = v

    def get(self, key, default=None):
        return super().get(str(key).lower(), default)

    def __getitem__(self, key):
        return super().__getitem__(str(key).lower())

    def __contains__(self, key):
        return super().__contains__(str(key).lower())


class _FakeRequest:
    def __init__(self, method: str, url_path: str, headers=None, query_params=None, json_body=None):
        self.method = method.upper()
        self.headers = _CIMap(headers or {})
        self.cookies = {}
        self.query_params = dict(query_params or {})
        self._json_body = json_body
        self.client = type("_Client", (), {"host": "127.0.0.1"})()
        self.url = type("_URL", (), {"path": url_path})()

    async def json(self):
        return {} if self._json_body is None else copy.deepcopy(self._json_body)

    async def body(self):
        return json.dumps(self._json_body or {}).encode("utf-8")


class _FakeResponse:
    def __init__(self, status_code: int, payload, headers=None):
        self.status_code = int(status_code)
        self._payload = payload
        self.headers = dict(headers or {})
        if isinstance(payload, (dict, list)):
            self.text = json.dumps(payload)
        else:
            self.text = str(payload or "")

    def json(self):
        if isinstance(self._payload, (dict, list)):
            return self._payload
        return json.loads(self.text)


class InProcessRouteTestClient:
    """Zero-dependency ASGI/router dispatcher when fastapi.testclient is unavailable locally."""

    def __init__(self, app):
        self.app = app
        self._modules = [
            server,
            eventstudio,
            community,
            leaderboard,
            tracker,
            auth,
            armylists,
            armory,
            leagues,
            connect,
            admin,
        ]
        self._compiled = []
        for entry in getattr(app, "routes", []):
            if isinstance(entry, tuple) and len(entry) == 3:
                method, route_path, fn_name = entry
                fn = self._resolve_handler(fn_name, route_path, method)
                if fn is not None:
                    pattern = "^" + re.sub(r"\{([a-zA-Z0-9_]+)\}", r"(?P<\1>[^/]+)", route_path) + "$"
                    self._compiled.append((method.upper(), route_path, re.compile(pattern), fn))

    def _resolve_handler(self, fn_name: str, route_path: str, method: str):
        # Prefer the router module matching the URL prefix when handler names overlap
        ordered = list(self._modules)
        if route_path.startswith("/api/eventstudio"):
            ordered = [eventstudio] + ordered
        elif route_path.startswith("/api/community"):
            ordered = [community] + ordered
        elif route_path.startswith("/api/tracker"):
            ordered = [tracker] + ordered
        elif route_path.startswith("/api/events") or route_path.startswith("/api/players") or route_path.startswith("/api/leaderboard"):
            ordered = [leaderboard, server] + ordered
        for mod in ordered:
            fn = getattr(mod, fn_name, None)
            if callable(fn):
                return fn
        return None

    @staticmethod
    def _coerce_scalar(val, anno):
        if val is None:
            return None
        origin = getattr(anno, "__origin__", None)
        if origin is not None:
            args = [a for a in getattr(anno, "__args__", ()) if a is not type(None)]
            if len(args) == 1:
                anno = args[0]
        if anno is int:
            return int(val)
        if anno is float:
            return float(val)
        if anno is bool:
            if isinstance(val, bool):
                return val
            return str(val).strip().lower() in ("1", "true", "yes", "on")
        return val

    def request(self, method: str, url: str, headers=None, json=None):
        parsed = urllib.parse.urlsplit(url)
        path = parsed.path
        q_params = {k: v[-1] for k, v in urllib.parse.parse_qs(parsed.query, keep_blank_values=True).items()}
        method_u = method.upper()

        matched_fn = None
        path_params = {}
        # Prefer exact static routes over parameterized routes
        candidates = []
        for m, raw_path, regex, fn in self._compiled:
            if m != method_u:
                continue
            mo = regex.match(path)
            if mo:
                is_param = "{" in raw_path
                candidates.append((1 if is_param else 0, fn, mo.groupdict()))
        if not candidates:
            return _FakeResponse(404, {"detail": f"Route not found: {method_u} {path}"})
        candidates.sort(key=lambda x: x[0])
        _, matched_fn, path_params = candidates[0]

        req = _FakeRequest(method_u, path, headers=headers, query_params=q_params, json_body=json)
        resp_obj = core.Response()
        bg_tasks = core.BackgroundTasks()
        sig = inspect.signature(matched_fn)
        mod_globals = getattr(matched_fn, "__globals__", {})

        kwargs = {}
        for pname, param in sig.parameters.items():
            anno = param.annotation
            if isinstance(anno, str):
                anno = mod_globals.get(anno, anno)
            if pname in ("request", "req") or anno is core.Request:
                kwargs[pname] = req
            elif pname in ("response", "resp") or anno is core.Response:
                kwargs[pname] = resp_obj
            elif pname == "background_tasks" or anno is core.BackgroundTasks:
                kwargs[pname] = bg_tasks
            elif pname in path_params:
                kwargs[pname] = self._coerce_scalar(urllib.parse.unquote(path_params[pname]), anno)
            elif pname in q_params:
                kwargs[pname] = self._coerce_scalar(q_params[pname], anno)
            elif isinstance(anno, type) and issubclass(anno, core.BaseModel):
                kwargs[pname] = anno(**(json or {}))
            elif pname in ("payload", "body", "data") and json is not None:
                kwargs[pname] = copy.deepcopy(json)
            elif param.default is not inspect.Parameter.empty:
                kwargs[pname] = param.default
            else:
                kwargs[pname] = None

        try:
            if inspect.iscoroutinefunction(matched_fn):
                result = asyncio.run(matched_fn(**kwargs))
            else:
                result = matched_fn(**kwargs)
                if inspect.isawaitable(result):
                    result = asyncio.run(result)
        except core.HTTPException as exc:
            return _FakeResponse(exc.status_code, {"detail": exc.detail})

        if isinstance(result, core.JSONResponse):
            return _FakeResponse(result.status_code, result.content, result.headers)
        if isinstance(result, core.Response):
            return _FakeResponse(result.status_code, result.content, result.headers)
        return _FakeResponse(getattr(resp_obj, "status_code", 200) or 200, result, getattr(resp_obj, "headers", None))


class StatefulNativeFakeDB:
    """In-memory stateful fake of PostgresDatabase supporting native ES-* events, participants, matches & Elo."""

    def __init__(self):
        self.events = {}
        self.studio_events = {}
        self.players = {}
        self.event_participants = {}  # (event_id, player_id) -> dict
        self.matches = {}  # match_id -> dict
        self.match_participants = {}  # match_id -> list[dict]
        self.player_ratings = {}  # (player_id, game_system) -> dict
        self.rating_history = {}  # (match_id, player_id) -> dict
        self.user_registrations = {}  # user_id -> dict[event_id -> record]
        self.tracker_games = {}
        self.native_leagues = []

    def get_cached(self, key):
        return None

    def set_cached(self, key, val, ttl=60):
        pass

    def reverse_geocode_coordinates(self, lat, lng):
        return {"city": "San Diego", "state": "CA", "country": "United States"}

    def get_studio_event(self, event_id: str):
        ev = self.studio_events.get(str(event_id))
        return copy.deepcopy(ev) if ev else None

    def list_studio_events(self, organizer_id=None, organizer_bcp_id=None):
        out = []
        for ev in self.studio_events.values():
            if not organizer_id or ev.get("organizer_id") == organizer_id or ev.get("organizer_bcp_id") == organizer_bcp_id:
                out.append(copy.deepcopy(ev))
        return out

    def save_studio_event(self, event_data: dict):
        eid = str(event_data["id"])
        existing = copy.deepcopy(self.studio_events.get(eid) or {})
        merged = {**existing, **copy.deepcopy(event_data)}
        merged.setdefault("roster", [])
        merged.setdefault("pairings", {})
        merged["source_platform"] = "omnitactica" if eid.startswith("ES-") else merged.get("source_platform", "bcp")
        merged["is_native_event"] = eid.startswith("ES-")
        roster = merged.get("roster") or []
        started = bool(merged.get("started") or merged.get("is_ended"))
        if roster or "roster" in event_data:
            merged["total_players"] = (
                len(roster)
                if started
                else len([p for p in roster if isinstance(p, dict) and not p.get("dropped")])
            )
        self.studio_events[eid] = copy.deepcopy(merged)
        self.events[eid] = copy.deepcopy(merged)
        if eid.startswith("ES-") and ("roster" in event_data or "pairings" in event_data or merged.get("roster") or merged.get("pairings")):
            self.sync_native_event_canonical_tables(eid, merged)
        return copy.deepcopy(merged)

    def save_studio_roster(self, event_id: str, roster: list):
        ev = self.get_studio_event(event_id)
        if not ev:
            return roster
        ev["roster"] = copy.deepcopy(roster)
        saved = self.save_studio_event(ev)
        return saved.get("roster", [])

    def delete_studio_event(self, event_id: str) -> bool:
        eid = str(event_id)
        existed = eid in self.studio_events or eid in self.events
        self.studio_events.pop(eid, None)
        self.events.pop(eid, None)
        for k in [k for k in self.event_participants if k[0] == eid]:
            self.event_participants.pop(k, None)
        for mid in [m for m, row in self.matches.items() if row.get("event_id") == eid]:
            self.matches.pop(mid, None)
            self.match_participants.pop(mid, None)
        return existed

    def sync_native_event_canonical_tables(self, event_id: str, event_obj=None):
        ev = event_obj or self.studio_events.get(event_id)
        if not ev:
            return
        gs = str(ev.get("game_system") or "40k")
        roster = ev.get("roster") or []
        active_pids = set()
        for p in roster:
            pid = str(p.get("player_id") or p.get("id") or "").strip()
            if not pid:
                continue
            active_pids.add(pid)
            name = str(p.get("name") or f"{p.get('first_name', '')} {p.get('last_name', '')}").strip() or "Player"
            self.players[pid] = {
                "id": pid,
                "full_name": name,
                "first_name": p.get("first_name") or name.split(" ")[0],
                "last_name": p.get("last_name") or "",
                "team": p.get("team") or "",
            }
            alist = str(p.get("army_list") or p.get("armyList") or "").strip()
            self.event_participants[(event_id, pid)] = {
                "event_id": event_id,
                "player_id": pid,
                "full_name": name,
                "first_name": p.get("first_name") or name.split(" ")[0],
                "last_name": p.get("last_name") or "",
                "faction": p.get("faction") or "Unknown",
                "detachment": p.get("detachment") or "",
                "team": p.get("team") or "",
                "dropped": bool(p.get("dropped", False)),
                "checked_in": bool(p.get("checked_in") or p.get("checkedIn")),
                "army_list": alist,
                "has_list_submitted": bool(alist or p.get("listSubmitted") or p.get("has_list_submitted")),
                "placement": p.get("placement"),
                "battle_points": p.get("battle_points"),
                "wins": p.get("wins", 0),
                "losses": p.get("losses", 0),
                "ties": p.get("draws", 0),
                "game_system": gs,
            }
        for k in [k for k in list(self.event_participants.keys()) if k[0] == event_id and k[1] not in active_pids]:
            self.event_participants.pop(k, None)

        pairings_map = ev.get("pairings") or {}
        valid_mids = set()
        for r_key, r_list in pairings_map.items():
            try:
                r_num = int(r_key)
            except Exception:
                continue
            if not isinstance(r_list, list):
                continue
            for idx, m in enumerate(r_list):
                if m.get("is_bye"):
                    continue
                t_num = int(m.get("table") or (idx + 1))
                mid = str(m.get("match_id") or f"{event_id}-R{r_num}-T{t_num}")
                is_ffa = bool(m.get("is_ffa") or m.get("match_format") == "ffa" or isinstance(m.get("pod_participants"), list))
                is_done = bool(m.get("is_done"))
                if not (ev.get("started") or ev.get("is_ended") or ev.get("is_published") or is_done):
                    continue
                if is_ffa:
                    seats = m.get("pod_participants") or []
                    if len(seats) < 2:
                        continue
                    valid_mids.add(mid)
                    winner_id = str(m.get("winner_id") or "").strip() or None
                    is_draw = bool(m.get("is_draw"))
                    if not winner_id and not is_draw and is_done:
                        for s in seats:
                            if s.get("outcome") == "win" or s.get("placement") == 1:
                                winner_id = str(s.get("player_id") or s.get("id"))
                                break
                    self.matches[mid] = {
                        "id": mid,
                        "event_id": event_id,
                        "round": r_num,
                        "table_number": t_num,
                        "player1_id": str(seats[0].get("player_id") or seats[0].get("id")),
                        "player2_id": str(seats[1].get("player_id") or seats[1].get("id")),
                        "player1_faction": seats[0].get("faction") or "Unknown",
                        "player2_faction": seats[1].get("faction") or "Unknown",
                        "player1_score": 1 if is_draw else (5 if winner_id == str(seats[0].get("player_id") or seats[0].get("id")) else 0),
                        "player2_score": 1 if is_draw else (5 if winner_id == str(seats[1].get("player_id") or seats[1].get("id")) else 0),
                        "winner_id": None if is_draw else winner_id,
                        "is_done": is_done,
                        "match_date": ev.get("event_date") or "2026-11-15",
                        "game_system": gs,
                        "match_meta": {
                            "is_ffa": True,
                            "match_format": "ffa",
                            "is_draw": is_draw,
                            "pod_size": len(seats),
                            "pod_participants": copy.deepcopy(seats),
                        },
                    }
                    self.match_participants[mid] = copy.deepcopy(seats)
                else:
                    p1_id = str(m.get("p1_id") or m.get("player1_id") or "").strip()
                    p2_id = str(m.get("p2_id") or m.get("player2_id") or "").strip()
                    if not p1_id or not p2_id:
                        continue
                    valid_mids.add(mid)
                    s1 = int(m.get("p1_score") or 0)
                    s2 = int(m.get("p2_score") or 0)
                    is_draw = bool(m.get("is_draw")) or (is_done and s1 == s2 and not m.get("winner_id"))
                    w_id = None if (not is_done or is_draw) else (str(m.get("winner_id")) if m.get("winner_id") else (p1_id if s1 > s2 else p2_id))
                    self.matches[mid] = {
                        "id": mid,
                        "event_id": event_id,
                        "round": r_num,
                        "table_number": t_num,
                        "player1_id": p1_id,
                        "player2_id": p2_id,
                        "player1_faction": m.get("p1_faction") or "Unknown",
                        "player2_faction": m.get("p2_faction") or "Unknown",
                        "player1_score": s1,
                        "player2_score": s2,
                        "winner_id": w_id,
                        "is_done": is_done,
                        "match_date": ev.get("event_date") or "2026-11-15",
                        "game_system": gs,
                        "match_meta": {
                            "is_draw": is_draw,
                            "stage": m.get("stage") or "swiss",
                            "bracket_label": m.get("bracket_label") or "",
                            "best_of": m.get("best_of") or ev.get("best_of") or 1,
                        },
                    }
        for mid in [m for m, row in list(self.matches.items()) if row.get("event_id") == event_id and m not in valid_mids]:
            self.matches.pop(mid, None)
            self.match_participants.pop(mid, None)

    def get_event_details(self, event_id: str):
        ev = self.studio_events.get(str(event_id)) or self.events.get(str(event_id))
        if not ev:
            return None
        res = copy.deepcopy(ev)
        res.pop("access_code", None)
        if isinstance(res.get("raw_json"), dict):
            res["raw_json"].pop("access_code", None)
            res["raw_json"].pop("accessCode", None)
        hide_lists_now = bool(res.get("hide_lists") and not res.get("started") and not res.get("is_ended"))
        players_out = []
        for (eid, pid), ep in self.event_participants.items():
            if eid != str(event_id):
                continue
            p_copy = copy.deepcopy(ep)
            r_row = self.player_ratings.get((pid, res.get("game_system") or "40k"))
            p_copy["current_elo"] = r_row["elo"] if r_row else 1500.0
            if hide_lists_now:
                p_copy["army_list"] = ""
            players_out.append(p_copy)
        players_out.sort(key=lambda x: (x.get("placement") or 9999, -(x.get("battle_points") or 0)))
        res["players"] = players_out
        matches_out = [copy.deepcopy(m) for m in self.matches.values() if m.get("event_id") == str(event_id)]
        matches_out.sort(key=lambda x: (x.get("round") or 1, x.get("table_number") or 1))
        for m in matches_out:
            mm = m.get("match_meta") or {}
            if mm.get("is_ffa"):
                m["is_ffa"] = True
                m["match_format"] = "ffa"
                m["pod_participants"] = mm.get("pod_participants", [])
            if mm.get("stage"):
                m["stage"] = mm["stage"]
            if mm.get("bracket_label"):
                m["bracket_label"] = mm["bracket_label"]
        res["matches"] = matches_out
        res["event_url"] = f"/app?event={event_id}#community"
        return res

    def get_player_profile(self, player_id: str, game_system: str = "40k"):
        p = self.players.get(str(player_id))
        r = self.player_ratings.get((str(player_id), game_system))
        if not p and not r:
            return None
        return {
            "id": str(player_id),
            "full_name": (p or {}).get("full_name", "Player"),
            "current_elo": (r or {}).get("elo", 1500.0),
        }

    def get_players_bulk_elos(self, player_ids: list, game_system: str = "40k"):
        out = {}
        for pid in player_ids or []:
            r = self.player_ratings.get((str(pid), game_system))
            out[str(pid)] = float(r["elo"]) if r else 1500.0
        return out

    def get_player_army_lists(self, user_id: str):
        return []

    def get_user_army_lists(self, user_id: str):
        return []

    def add_user_registered_tournament(self, user_id: str, record: dict):
        if not user_id or not isinstance(record, dict):
            return False
        eid = str(record.get("id") or record.get("bcp_event_id") or "")
        if not eid:
            return False
        bucket = self.user_registrations.setdefault(str(user_id), {})
        existing = bucket.get(eid) or {}
        bucket[eid] = {**existing, **copy.deepcopy(record)}
        return True

    def get_user_registered_tournaments(self, user_id: str):
        bucket = self.user_registrations.get(str(user_id)) or {}
        return [copy.deepcopy(v) for v in bucket.values()]

    def save_tracker_game(self, match_id: str, *args, **kwargs):
        self.tracker_games[str(match_id)] = True
        return True

    def get_competitive_faction_alpha_snapshot(self, game_system: str = "40k"):
        return {"factions": {}, "matchups": {}}

    def get_dedicated_ml_predictor_artifact(self, game_system: str = "40k"):
        return None


class FakeAuthManager:
    def __init__(self, users_by_token: dict):
        self.users_by_token = users_by_token

    def validate_session(self, token: str):
        if not token:
            return None
        return copy.deepcopy(self.users_by_token.get(token))

    get_session = validate_session

    def get_valid_bcp_token(self, user_id: str):
        return None

    def get_user_by_id(self, user_id: str):
        for u in self.users_by_token.values():
            if u.get("id") == user_id:
                return copy.deepcopy(u)
        return None


def _rate_fake_db_single_event(fake_db: StatefulNativeFakeDB, event_id: str, game_system: str = None):
    """Deterministic unit-test verification harness mirroring EloEngine.rate_single_event math on StatefulNativeFakeDB."""
    eng = EloEngine.__new__(EloEngine)
    ev = fake_db.events.get(event_id)
    if not ev:
        return {"success": False, "matches_rated": 0}
    gs = game_system or ev.get("game_system") or "40k"
    matches = [
        m for m in sorted(fake_db.matches.values(), key=lambda x: (x.get("round") or 1, x.get("table_number") or 1))
        if m.get("event_id") == event_id and m.get("is_done")
    ]
    rated = 0
    updated_pids = set()
    for m in matches:
        mid = m["id"]
        mm = m.get("match_meta") or {}
        if mm.get("is_ffa"):
            seats = mm.get("pod_participants") or []
            pids = [str(s.get("player_id") or s.get("id")) for s in seats if s.get("player_id") or s.get("id")]
            if any((mid, pid) in fake_db.rating_history for pid in pids):
                continue
            k_pod = 32.0 / max(1.0, len(pids) - 1.0)
            pre = {pid: fake_db.player_ratings.get((pid, gs), {}).get("elo", 1500.0) for pid in pids}
            w_id = m.get("winner_id")
            is_draw = bool(mm.get("is_draw")) or not w_id
            deltas = {pid: 0.0 for pid in pids}
            for i in range(len(pids)):
                for j in range(i + 1, len(pids)):
                    pa, pb = pids[i], pids[j]
                    ea = EloEngine.expected_score(pre[pa], pre[pb])
                    sa = 0.5 if is_draw else (1.0 if pa == w_id else (0.0 if pb == w_id else 0.5))
                    d = k_pod * (sa - ea)
                    deltas[pa] += d
                    deltas[pb] -= d
            for pid in pids:
                new_elo = round(pre[pid] + deltas[pid], 2)
                cur = fake_db.player_ratings.get((pid, gs), {"elo": 1500.0, "matches": 0, "wins": 0, "losses": 0, "ties": 0})
                is_win = (not is_draw and pid == w_id)
                fake_db.player_ratings[(pid, gs)] = {
                    "elo": new_elo,
                    "matches": cur["matches"] + 1,
                    "wins": cur["wins"] + (1 if is_win else 0),
                    "losses": cur["losses"] + (0 if (is_draw or is_win) else 1),
                    "ties": cur["ties"] + (1 if is_draw else 0),
                }
                fake_db.rating_history[(mid, pid)] = {"elo_before": pre[pid], "elo_after": new_elo, "delta": round(deltas[pid], 2)}
                updated_pids.add(pid)
            rated += 1
        else:
            p1, p2 = m["player1_id"], m["player2_id"]
            if (mid, p1) in fake_db.rating_history or (mid, p2) in fake_db.rating_history:
                continue
            r1 = fake_db.player_ratings.get((p1, gs), {"elo": 1500.0, "matches": 0, "wins": 0, "losses": 0, "ties": 0})
            r2 = fake_db.player_ratings.get((p2, gs), {"elo": 1500.0, "matches": 0, "wins": 0, "losses": 0, "ties": 0})
            e1 = EloEngine.expected_score(r1["elo"], r2["elo"])
            w_id = m.get("winner_id")
            a1 = 0.5 if not w_id else (1.0 if w_id == p1 else 0.0)
            d1 = 32.0 * (a1 - e1)
            for pid, cur, delta, actual in [(p1, r1, d1, a1), (p2, r2, -d1, 1.0 - a1)]:
                new_elo = round(cur["elo"] + delta, 2)
                fake_db.player_ratings[(pid, gs)] = {
                    "elo": new_elo,
                    "matches": cur["matches"] + 1,
                    "wins": cur["wins"] + (1 if actual == 1.0 else 0),
                    "losses": cur["losses"] + (1 if actual == 0.0 else 0),
                    "ties": cur["ties"] + (1 if actual == 0.5 else 0),
                }
                fake_db.rating_history[(mid, pid)] = {"elo_before": cur["elo"], "elo_after": new_elo, "delta": round(delta, 2)}
                updated_pids.add(pid)
            rated += 1
    return {"success": True, "event_id": event_id, "game_system": gs, "matches_rated": rated, "players_updated": len(updated_pids)}


class NativeEventsPlatformE2ETest(unittest.TestCase):
    def setUp(self):
        self.fake_db = StatefulNativeFakeDB()
        self.users = {
            "tok_host": {
                "id": "usr_host_1",
                "email": "host@omnitactica.test",
                "display_name": "Alex Host",
                "first_name": "Alex",
                "last_name": "Host",
                "role": "player",  # Standard non-TO player hosting a native event!
                "player_id": "pl_host_1",
            },
            "tok_p1": {
                "id": "usr_p1",
                "email": "p1@omnitactica.test",
                "display_name": "Marcus Vance",
                "first_name": "Marcus",
                "last_name": "Vance",
                "role": "player",
                "player_id": "pl_marcus",
            },
            "tok_p2": {
                "id": "usr_p2",
                "email": "p2@omnitactica.test",
                "display_name": "Elena Rostova",
                "first_name": "Elena",
                "last_name": "Rostova",
                "role": "player",
                "player_id": "pl_elena",
            },
            "tok_p3": {
                "id": "usr_p3",
                "email": "p3@omnitactica.test",
                "display_name": "Darius Thorne",
                "first_name": "Darius",
                "last_name": "Thorne",
                "role": "player",
                "player_id": "pl_darius",
            },
            "tok_p4": {
                "id": "usr_p4",
                "email": "p4@omnitactica.test",
                "display_name": "Sora Takahashi",
                "first_name": "Sora",
                "last_name": "Takahashi",
                "role": "player",
                "player_id": "pl_sora",
            },
            "tok_intruder": {
                "id": "usr_intruder",
                "email": "intruder@omnitactica.test",
                "display_name": "Random Visitor",
                "role": "player",
                "player_id": "pl_intruder",
            },
        }
        self.fake_auth = FakeAuthManager(self.users)

        class FakeEloProxy:
            def __init__(self, db_ref):
                self._db = db_ref

            def rate_single_event(self, event_id: str, game_system: str = None):
                return _rate_fake_db_single_event(self._db, event_id, game_system=game_system)

        self.fake_elo = FakeEloProxy(self.fake_db)

        self.patches = [
            patch("core.get_database", return_value=self.fake_db),
            patch("routers.eventstudio.get_database", return_value=self.fake_db),
            patch("routers.community.get_database", return_value=self.fake_db),
            patch("routers.leaderboard.get_database", return_value=self.fake_db),
            patch("core.get_auth_manager", return_value=self.fake_auth),
            patch("routers.eventstudio.get_auth_manager", return_value=self.fake_auth),
            patch("routers.community.get_auth_manager", return_value=self.fake_auth),
            patch("routers.eventstudio.get_elo_engine", return_value=self.fake_elo),
            patch("core.get_elo_engine", return_value=self.fake_elo),
        ]
        for p in self.patches:
            p.start()

        self.client = (TestClient or InProcessRouteTestClient)(server.app)

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    def _req(self, method: str, path: str, token: str = None, json_body: dict = None, max_ms: float = 1000.0):
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        t0 = time.perf_counter()
        resp = self.client.request(method, path, headers=headers, json=json_body)
        dt_ms = (time.perf_counter() - t0) * 1000.0
        self.assertLess(
            dt_ms,
            max_ms,
            f"{method} {path} exceeded <{max_ms}ms budget: took {dt_ms:.1f}ms",
        )
        return resp

    def test_01_catalog_and_native_factions_sub_50ms(self):
        r = self._req("GET", "/api/eventstudio/catalog", max_ms=250.0)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["success"])
        slugs = {g["slug"] for g in body["games"]}
        for expected in ("40k", "aos", "the_old_world", "mtg", "pokemon", "yugioh", "one_piece", "lorcana", "flesh_blood", "sw_unlimited", "riftbound"):
            self.assertIn(expected, slugs)
        preset_ids = {p["id"] for p in body["presets"]}
        for preset in ("wargame_vp", "wtc_20", "tcg_bo3", "tcg_bo1", "ffa_pods"):
            self.assertIn(preset, preset_ids)

        for gs in ("mtg", "pokemon", "onepiece", "fab", "swu", "dJtT7U0Wv2", "lorcana"):
            fr = self._req("GET", f"/api/community/gamesystems/{gs}/factions", max_ms=50.0)
            self.assertEqual(fr.status_code, 200)
            fdata = fr.json()
            self.assertTrue(fdata["success"])
            self.assertGreaterEqual(len(fdata["factions"]), 6, f"Expected factions for {gs}")

        # 40k & AoS may hydrate from BCP on cold call (<1000ms) and serve from L1 cache (<15ms) on warm call
        for gs in ("40k", "aos"):
            fr_cold = self._req("GET", f"/api/community/gamesystems/{gs}/factions", max_ms=1000.0)
            self.assertEqual(fr_cold.status_code, 200)
            self.assertGreaterEqual(len(fr_cold.json()["factions"]), 6)
            fr_warm = self._req("GET", f"/api/community/gamesystems/{gs}/factions", max_ms=15.0)
            self.assertEqual(fr_warm.status_code, 200)

    def test_02_native_40k_singles_full_lifecycle_and_security_guards(self):
        # 1. Non-TO regular player creates a private native 40k RTT with hide_lists & lists_at_checkin
        create_res = self._req(
            "POST",
            "/api/eventstudio/event/create",
            token="tok_host",
            json_body={
                "name": "SoCal Native 40K RTT",
                "hosting_mode": "native",
                "game_system": "40k",
                "scoring_mode": "wargame_vp",
                "tier": "RTT",
                "event_type": "Singles Event",
                "rounds": 2,
                "capacity": 16,
                "points": 2000,
                "start_date": "2026-11-15",
                "end_date": "2026-11-15",
                "venue": "At Ease Games",
                "city": "San Diego",
                "state": "CA",
                "lat": 32.885,
                "lng": -117.165,
                "private_event": True,
                "access_code": "BOLTER26",
                "hide_lists": True,
                "lists_at_checkin": True,
                "description": "3-round Chapter Approved RTT!",
                "prizes": "Store credit for Top 3",
            },
        )
        self.assertEqual(create_res.status_code, 200, create_res.text)
        ev_id = create_res.json()["event_id"]
        self.assertTrue(ev_id.startswith("ES-"))
        self.assertFalse(create_res.json()["bcp_registered"])

        # 2. Verify access_code is redacted for non-owners on both registration & studio GET
        reg_meta = self._req("GET", f"/api/community/events/{ev_id}/registration", token="tok_p1").json()
        self.assertTrue(reg_meta["is_native_event"])
        self.assertTrue(reg_meta["requires_access_code"])
        self.assertNotIn("BOLTER26", json.dumps(reg_meta))

        studio_non_owner = self._req("GET", f"/api/eventstudio/event/{ev_id}", token="tok_p1").json()
        self.assertNotIn("BOLTER26", json.dumps(studio_non_owner))

        # 3. Wrong access_code -> 403; valid access_code -> 200!
        bad_reg = self._req(
            "POST",
            f"/api/community/events/{ev_id}/register",
            token="tok_p1",
            json_body={"first_name": "Marcus", "last_name": "Vance", "faction": "Orks", "access_code": "WRONG"},
        )
        self.assertEqual(bad_reg.status_code, 403)

        p1_reg = self._req(
            "POST",
            f"/api/community/events/{ev_id}/register",
            token="tok_p1",
            json_body={
                "first_name": "Marcus",
                "last_name": "Vance",
                "faction": "Orks",
                "detachment": "Bully Boyz",
                "access_code": "BOLTER26",
            },
        )
        self.assertEqual(p1_reg.status_code, 200, p1_reg.text)

        # 4. lists_at_checkin guard blocks check-in before list upload, then succeeds after armylist upload!
        blocked_ci = self._req("POST", f"/api/community/events/{ev_id}/checkin", token="tok_p1", json_body={"checked_in": True})
        self.assertEqual(blocked_ci.status_code, 400)

        up_list = self._req(
            "POST",
            f"/api/community/events/{ev_id}/armylist",
            token="tok_p1",
            json_body={"army_list": "Ghazghkull Thraka (235 pts)\n6x Meganobz (210 pts)", "faction": "Orks"},
        )
        self.assertEqual(up_list.status_code, 200)

        ok_ci = self._req("POST", f"/api/community/events/{ev_id}/checkin", token="tok_p1", json_body={"checked_in": True})
        self.assertEqual(ok_ci.status_code, 200)

        # 5. Register players 2, 3, 4 with lists
        for tok, fn, ln, fac, lst in [
            ("tok_p2", "Elena", "Rostova", "Aeldari", "Avatar of Khaine (335 pts)"),
            ("tok_p3", "Darius", "Thorne", "Necrons", "The Silent King (420 pts)"),
            ("tok_p4", "Sora", "Takahashi", "T'au Empire", "Commander Shadowsun (100 pts)"),
        ]:
            r = self._req(
                "POST",
                f"/api/community/events/{ev_id}/register",
                token=tok,
                json_body={"first_name": fn, "last_name": ln, "faction": fac, "army_list": lst, "access_code": "BOLTER26"},
            )
            self.assertEqual(r.status_code, 200, r.text)

        # 6. Verify hide_lists redacts army_list on public event details BEFORE start!
        pub_before = self._req("GET", f"/api/event/{ev_id}", token="tok_intruder").json()
        self.assertEqual(len(pub_before["players"]), 4)
        for p in pub_before["players"]:
            self.assertEqual(p.get("army_list") or "", "")

        # 7. Pre-start drop decrements active total_players, and re-registering restores 4 players
        drop_r = self._req("POST", f"/api/community/events/{ev_id}/drop", token="tok_p4", json_body={"dropped": True})
        self.assertEqual(drop_r.status_code, 200)
        self.assertEqual(self.fake_db.get_studio_event(ev_id)["total_players"], 3)

        undrop_r = self._req("POST", f"/api/community/events/{ev_id}/drop", token="tok_p4", json_body={"dropped": False})
        self.assertEqual(undrop_r.status_code, 200)
        self.assertEqual(self.fake_db.get_studio_event(ev_id)["total_players"], 4)

        # 8. Ownership guard: intruder gets 403 trying to start host's native tournament
        intrude_start = self._req("POST", f"/api/eventstudio/event/{ev_id}/start", token="tok_intruder")
        self.assertEqual(intrude_start.status_code, 403)

        # 9. Host starts event -> Round 1 pairings generated + tracker rooms seeded + army lists revealed publicly!
        start_r = self._req("POST", f"/api/eventstudio/event/{ev_id}/start", token="tok_host")
        self.assertEqual(start_r.status_code, 200, start_r.text)
        ev_after_start = start_r.json()["event"]
        r1_pairings = ev_after_start["pairings"]["1"]
        self.assertEqual(len(r1_pairings), 2)
        self.assertIn("p1_win_prob", r1_pairings[0])
        self.assertIn(f"{ev_id}-R1-T1".upper(), core.TRACKER_ROOMS)

        pub_after_start = self._req("GET", f"/api/event/{ev_id}", token="tok_intruder").json()
        self.assertTrue(any("Ghazghkull" in (p.get("army_list") or "") for p in pub_after_start["players"]))

        # 10. Submit Round 1 scores (Table 1: 88-62 win, Table 2: 75-75 draw)
        for tbl, s1, s2 in [(1, 88, 62), (2, 75, 75)]:
            sr = self._req(
                "POST",
                "/api/eventstudio/submit_score",
                token="tok_host",
                json_body={"event_id": ev_id, "round_num": 1, "table": tbl, "p1_score": s1, "p2_score": s2, "is_draw": s1 == s2},
            )
            self.assertEqual(sr.status_code, 200, sr.text)

        # 11. Finalize Round 1 -> Generate Round 2 Swiss pairings (no rematches!) -> Submit Round 2 scores
        fin_r1 = self._req("POST", f"/api/eventstudio/event/{ev_id}/round/finalize", token="tok_host", json_body={"round": 1})
        self.assertEqual(fin_r1.status_code, 200)

        gen_r2 = self._req("POST", f"/api/eventstudio/event/{ev_id}/pairings/generate", token="tok_host", json_body={"round": 2})
        self.assertEqual(gen_r2.status_code, 200)
        r2_pairings = gen_r2.json()["pairings"]
        self.assertEqual(len(r2_pairings), 2)
        for m in r2_pairings:
            self.assertFalse(m.get("is_rematch"), "Round 2 Swiss should avoid Round 1 rematches")

        for tbl, s1, s2 in [(1, 92, 70), (2, 80, 55)]:
            sr = self._req(
                "POST",
                "/api/eventstudio/submit_score",
                token="tok_host",
                json_body={"event_id": ev_id, "round_num": 2, "table": tbl, "p1_score": s1, "p2_score": s2},
            )
            self.assertEqual(sr.status_code, 200)

        # 12. Check Live Standings & Conclude Tournament (Elo rated!)
        st_res = self._req("GET", f"/api/eventstudio/event/{ev_id}/standings", token="tok_host").json()
        self.assertEqual(len(st_res["standings"]), 4)
        self.assertGreaterEqual(st_res["standings"][0]["opp_win_rate_sos"], 33.0)

        end_r = self._req("POST", f"/api/eventstudio/event/{ev_id}/end", token="tok_host")
        self.assertEqual(end_r.status_code, 200, end_r.text)
        end_body = end_r.json()
        self.assertTrue(end_body["elo_summary"]["success"])
        self.assertEqual(end_body["elo_summary"]["matches_rated"], 4)

        # Verify idempotency: re-running rate_single_event rates 0 duplicate matches
        dup_elo = _rate_fake_db_single_event(self.fake_db, ev_id, "40k")
        self.assertEqual(dup_elo["matches_rated"], 0)

        # Verify official placements stamped 1..4
        final_details = self._req("GET", f"/api/event/{ev_id}", token="tok_host").json()
        placements = [p["placement"] for p in final_details["players"]]
        self.assertEqual(sorted(placements), [1, 2, 3, 4])

    def test_03_native_mtg_bo3_swiss_and_top_4_single_elimination_cut(self):
        create_res = self._req(
            "POST",
            "/api/eventstudio/event/create",
            token="tok_host",
            json_body={
                "name": "Friday Night Modern $1K",
                "hosting_mode": "native",
                "game_system": "mtg",
                "scoring_mode": "tcg_bo3",
                "best_of": 3,
                "top_cut": 4,
                "rounds": 2,
                "capacity": 32,
                "points": 0,
                "start_date": "2026-11-20",
                "venue_mode": "online",
                "online_platform": "MTG Melee / SpellTable",
            },
        )
        self.assertEqual(create_res.status_code, 200, create_res.text)
        ev_id = create_res.json()["event_id"]

        # Add 6 competitors
        archetypes = [
            ("Jace", "Beleren", "Dimir Murktide"),
            ("Chandra", "Nalaar", "Boros Energy"),
            ("Liliana", "Vess", "Golgari Yawgmoth"),
            ("Teferi", "Akosa", "Azorius Control"),
            ("Ajani", "Goldmane", "Domain Zoo"),
            ("Nissa", "Revane", "Amulet Titan"),
        ]
        for fn, ln, arch in archetypes:
            ar = self._req(
                "POST",
                f"/api/eventstudio/event/{ev_id}/register",
                token="tok_host",
                json_body={"name": f"{fn} {ln}", "faction": arch, "checked_in": True},
            )
            self.assertEqual(ar.status_code, 200)

        # Start & play 2 Bo3 Swiss rounds
        self._req("POST", f"/api/eventstudio/event/{ev_id}/start", token="tok_host")
        for tbl, (s1, s2) in [(1, (2, 0)), (2, (2, 1)), (3, (1, 1))]:
            self._req(
                "POST",
                "/api/eventstudio/submit_score",
                token="tok_host",
                json_body={"event_id": ev_id, "round_num": 1, "table": tbl, "p1_score": s1, "p2_score": s2, "is_draw": s1 == s2},
            )
        self._req("POST", f"/api/eventstudio/event/{ev_id}/round/finalize", token="tok_host", json_body={"round": 1})
        self._req("POST", f"/api/eventstudio/event/{ev_id}/pairings/generate", token="tok_host", json_body={"round": 2})
        for tbl, (s1, s2) in [(1, (2, 1)), (2, (2, 0)), (3, (0, 2))]:
            self._req(
                "POST",
                "/api/eventstudio/submit_score",
                token="tok_host",
                json_body={"event_id": ev_id, "round_num": 2, "table": tbl, "p1_score": s1, "p2_score": s2},
            )

        # Cut to Top 4 (#1 vs #4, #2 vs #3) -> Round 3
        cut_r = self._req("POST", f"/api/eventstudio/event/{ev_id}/top_cut", token="tok_host", json_body={"top_cut": 4})
        self.assertEqual(cut_r.status_code, 200, cut_r.text)
        cut_data = cut_r.json()
        self.assertEqual(cut_data["round"], 3)
        self.assertEqual(cut_data["stage"], "top_cut")
        self.assertIn("Top 4", cut_data["bracket_stage"])
        self.assertEqual(len(cut_data["pairings"]), 2)

        # Score Semifinals (Seed #1 wins 2-0, Seed #3 upsets Seed #2 2-1)
        self._req("POST", "/api/eventstudio/submit_score", token="tok_host", json_body={"event_id": ev_id, "round_num": 3, "table": 1, "p1_score": 2, "p2_score": 0})
        self._req("POST", "/api/eventstudio/submit_score", token="tok_host", json_body={"event_id": ev_id, "round_num": 3, "table": 2, "p1_score": 1, "p2_score": 2})

        # Advance Top Cut -> Grand Final on Round 4!
        fin_cut = self._req("POST", f"/api/eventstudio/event/{ev_id}/top_cut", token="tok_host", json_body={"top_cut": 4})
        self.assertEqual(fin_cut.status_code, 200, fin_cut.text)
        self.assertEqual(fin_cut.json()["round"], 4)
        self.assertEqual(fin_cut.json()["stage"], "top_cut")
        self.assertIn("Final", fin_cut.json()["bracket_stage"])
        self.assertEqual(len(fin_cut.json()["pairings"]), 1)

        final_match = fin_cut.json()["pairings"][0]
        champ_id = final_match["p2_id"]  # Seed #3 wins the Grand Final!
        self._req("POST", "/api/eventstudio/submit_score", token="tok_host", json_body={"event_id": ev_id, "round_num": 4, "table": 1, "p1_score": 1, "p2_score": 2})

        # Verify Championship Winner is #1 in final standings!
        st_final = self._req("GET", f"/api/eventstudio/event/{ev_id}/standings", token="tok_host").json()["standings"]
        self.assertEqual(st_final[0]["player_id"], champ_id)
        self.assertEqual(st_final[0]["rank"], 1)

        end_r = self._req("POST", f"/api/eventstudio/event/{ev_id}/end", token="tok_host")
        self.assertEqual(end_r.status_code, 200)
        self.assertEqual(end_r.json()["elo_summary"]["matches_rated"], 9)

    def test_04_native_commander_4p_ffa_pods_and_pairwise_elo(self):
        create_res = self._req(
            "POST",
            "/api/eventstudio/event/create",
            token="tok_host",
            json_body={
                "name": "Mox Pearl cEDH 4-Player Pod Open",
                "hosting_mode": "native",
                "game_system": "mtg",
                "scoring_mode": "ffa_pods",
                "match_format": "ffa",
                "event_type": "Pods Event",
                "rounds": 2,
                "capacity": 32,
                "points": 0,
                "start_date": "2026-11-22",
                "venue": "Mox Boarding House",
                "city": "Bellevue",
                "state": "WA",
            },
        )
        self.assertEqual(create_res.status_code, 200, create_res.text)
        ev_id = create_res.json()["event_id"]

        # Add 7 cEDH players -> must decompose cleanly into 1x 4-player pod + 1x 3-player pod!
        for i in range(1, 8):
            self._req(
                "POST",
                f"/api/eventstudio/event/{ev_id}/register",
                token="tok_host",
                json_body={"name": f"Commander Pilot {i}", "faction": "Commander / cEDH", "checked_in": True},
            )

        start_r = self._req("POST", f"/api/eventstudio/event/{ev_id}/start", token="tok_host")
        self.assertEqual(start_r.status_code, 200, start_r.text)
        pods = start_r.json()["event"]["pairings"]["1"]
        self.assertEqual(len(pods), 2)
        pod_sizes = sorted([len(p["pod_participants"]) for p in pods], reverse=True)
        self.assertEqual(pod_sizes, [4, 3])
        self.assertTrue(all(p["is_ffa"] for p in pods))

        # Pod 1: Seat 1 wins (+5 pts); Pod 2: Timed Draw (+1 pt each)
        pod1_winner = pods[0]["pod_participants"][0]["player_id"]
        r_p1 = self._req(
            "POST",
            "/api/eventstudio/submit_score",
            token="tok_host",
            json_body={"event_id": ev_id, "round_num": 1, "table": 1, "p1_score": 5, "p2_score": 0, "winner_id": pod1_winner, "is_draw": False},
        )
        self.assertEqual(r_p1.status_code, 200)

        r_p2 = self._req(
            "POST",
            "/api/eventstudio/submit_score",
            token="tok_host",
            json_body={"event_id": ev_id, "round_num": 1, "table": 2, "p1_score": 1, "p2_score": 1, "is_draw": True},
        )
        self.assertEqual(r_p2.status_code, 200)

        # Verify 5/1/0 Pod Swiss Points in Standings
        standings = self._req("GET", f"/api/eventstudio/event/{ev_id}/standings", token="tok_host").json()["standings"]
        pts_by_pid = {s["player_id"]: s["swiss_points"] for s in standings}
        self.assertEqual(pts_by_pid[pod1_winner], 5.0)
        for s in pods[0]["pod_participants"][1:]:
            self.assertEqual(pts_by_pid[s["player_id"]], 0.0)
        for s in pods[1]["pod_participants"]:
            self.assertEqual(pts_by_pid[s["player_id"]], 1.0)

        # End tournament -> verify pairwise zero-sum FFA Elo updates!
        end_r = self._req("POST", f"/api/eventstudio/event/{ev_id}/end", token="tok_host")
        self.assertEqual(end_r.status_code, 200)
        self.assertEqual(end_r.json()["elo_summary"]["matches_rated"], 2)

        winner_elo = self.fake_db.player_ratings[(pod1_winner, "mtg")]["elo"]
        self.assertGreater(winner_elo, 1500.0, "Pod 1 winner must gain Elo")
        total_elo_sum = sum(
            self.fake_db.player_ratings[(s["player_id"], "mtg")]["elo"]
            for p in pods
            for s in p["pod_participants"]
        )
        self.assertAlmostEqual(total_elo_sum, 7 * 1500.0, places=0, msg="Pairwise FFA Elo must be zero-sum")

    def test_05_frontend_native_hosting_bundle_integrity(self):
        with open(os.path.join(REPO_ROOT, "web", "app.html"), "r", encoding="utf-8") as f:
            app_html = f.read()
        with open(os.path.join(REPO_ROOT, "web", "eventstudio.html"), "r", encoding="utf-8") as f:
            es_html = f.read()
        with open(os.path.join(REPO_ROOT, "web", "js", "app.bundle.min.js"), "r", encoding="utf-8") as f:
            bundle_js = f.read()

        for marker in (
            'id="comm-btn-host-event"',
            'id="create-event-hosting-mode"',
            'id="create-event-scoring-mode"',
            'id="create-event-top-cut"',
            'id="btn-manage-top-cut"',
            'value="mtg"',
            'value="pokemon"',
            'value="onepiece"',
        ):
            self.assertIn(marker, app_html)
        for marker in ('id="create-event-hosting-mode"', 'id="create-event-scoring-mode"', 'id="create-event-top-cut"', 'value="mtg"'):
            self.assertIn(marker, es_html)
        for js_marker in ("openHostEventWizard", "savePodResult", "triggerStudioTopCut", "generateStudioTopCut"):
            self.assertIn(js_marker, bundle_js)

    def test_06_community_recommendation_engine_surfaces_native_events(self):
        from datetime import datetime, timedelta, timezone
        from routers.community import score_and_categorize_community_events

        future_date = (datetime.now(timezone.utc) + timedelta(days=10)).strftime("%Y-%m-%d")
        native_ev = {
            "id": "ES-NATIVGT1",
            "name": "Pacific Native 40K Grand Tournament",
            "event_date": future_date,
            "end_date": future_date,
            "city": "San Diego",
            "state": "CA",
            "country": "United States",
            "latitude": 32.72,
            "longitude": -117.16,
            "total_players": 44,
            "num_tickets": 64,
            "num_rounds": 5,
            "points": 2000,
            "game_system": "40k",
            "source_platform": "omnitactica",
            "is_native_event": True,
        }
        categorized = score_and_categorize_community_events(
            raw_candidates=[native_ev],
            user_lat=32.7157,
            user_lng=-117.1611,
            local_radius_miles=50.0,
            max_drive_hours=2.0,
        )
        all_items = categorized.get("local_events") or categorized.get("all_events") or []
        matched = [e for e in all_items if e.get("id") == "ES-NATIVGT1"]
        self.assertEqual(len(matched), 1)
        self.assertTrue(matched[0]["is_native_event"])
        self.assertEqual(matched[0]["source_platform"], "omnitactica")
        self.assertEqual(matched[0]["external_url"], "/app?event=ES-NATIVGT1#community")


if __name__ == "__main__":
    unittest.main()
