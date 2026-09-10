"""Scraper module for Best Coast Pairings Warhammer 40k tournaments, pairings, and matches."""

import json
import logging
import time
from typing import Any, Dict, Generator, List, Optional
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

try:
    from google3.experimental.users.hsiehjun.EloRanking.config import BCP_API_BASE, DEFAULT_HEADERS, DEFAULT_GAME_SYSTEM_ID, AOS_GAME_SYSTEM_ID
    from google3.experimental.users.hsiehjun.EloRanking.database import Database
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.config import BCP_API_BASE, DEFAULT_HEADERS, DEFAULT_GAME_SYSTEM_ID, AOS_GAME_SYSTEM_ID
        from experimental.users.hsiehjun.EloRanking.database import Database
    except ImportError:
        from config import BCP_API_BASE, DEFAULT_HEADERS, DEFAULT_GAME_SYSTEM_ID, AOS_GAME_SYSTEM_ID
        from database import Database, get_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("BCPScraper")


class BestCoastPairingsScraper:
    """Scrapes tournaments, player rosters, and round-by-round pairings from Best Coast Pairings."""

    def __init__(self, db: Optional[Database] = None, request_delay: float = 0.5):
        if db is not None:
            self.db = db
        else:
            try:
                self.db = get_db()
            except Exception:
                self.db = None
        self.headers = DEFAULT_HEADERS.copy()
        self.request_delay = request_delay

    def _make_request(self, endpoint: str, params: Optional[Dict[str, Any]] = None, max_retries: int = 2) -> Optional[Dict[str, Any]]:
        """Makes an HTTP GET request to BCP API with headers, error handling, and retries."""
        self.last_http_code = None
        query_str = f"?{urllib.parse.urlencode(params)}" if params else ""
        url = f"{BCP_API_BASE}{endpoint}{query_str}"

        for attempt in range(1, max_retries + 1):
            try:
                time.sleep(self.request_delay)
                req = urllib.request.Request(url, headers=self.headers)
                with urllib.request.urlopen(req, timeout=10) as response:
                    self.last_http_code = response.status
                    content = response.read().decode("utf-8")
                    return json.loads(content)
            except urllib.error.HTTPError as e:
                self.last_http_code = e.code
                body = e.read().decode("utf-8", errors="ignore")
                logger.warning(f"HTTP {e.code} on {endpoint} (Attempt {attempt}/{max_retries}): {body[:150]}")
                if e.code == 429:
                    sleep_time = attempt * 2.0
                    logger.info(f"Rate limited. Backing off for {sleep_time:.1f}s...")
                    time.sleep(sleep_time)
                elif e.code in (404, 409):
                    return None
                else:
                    time.sleep(attempt * 0.5)
            except Exception as e:
                sleep_time = attempt * 1.0
                logger.warning(f"Connection retry {attempt}/{max_retries} on {endpoint}: {e} (retrying in {sleep_time:.1f}s...)")
                time.sleep(sleep_time)

        logger.error(f"Failed request to {url} after {max_retries} attempts.")
        return None

    def fetch_events(
        self,
        start_date: str,
        end_date: str,
        game_system_id: str = DEFAULT_GAME_SYSTEM_ID,
        limit_per_page: int = 50,
        max_events: Optional[int] = None
    ) -> Generator[Dict[str, Any], None, None]:
        """Paginates through Warhammer 40k events in the given date range."""
        next_key = None
        total_yielded = 0

        logger.info(f"Fetching events from {start_date} to {end_date} for gameSystemId={game_system_id}")

        while True:
            params: Dict[str, Any] = {
                "limit": limit_per_page,
                "gameSystemId": game_system_id,
                "startDate": start_date,
                "endDate": end_date,
            }
            if next_key:
                params["nextKey"] = next_key

            resp = self._make_request("/events", params=params)
            if not resp or "data" not in resp:
                logger.info("No more events returned or error occurred.")
                break

            events = resp.get("data", [])
            if not events:
                break

            for ev in events:
                yield ev
                total_yielded += 1
                if max_events and total_yielded >= max_events:
                    return

            next_key = resp.get("nextKey")
            if not next_key:
                logger.info("Reached end of events pagination.")
                break

    def fetch_event_details(self, event_id: str) -> Optional[Dict[str, Any]]:
        """Fetches full tournament details for a specific event."""
        return self._make_request(f"/events/{event_id}")

    def fetch_event_pairings_for_round(self, event_id: str, round_num: int, pairing_type: str = "Pairing") -> List[Dict[str, Any]]:
        """Fetches all pairings for a specific round of an event. Falls back to TeamPairing if standard Pairing is empty."""
        endpoints = [
            ("/pairings", {"eventId": event_id, "round": round_num, "pairingType": pairing_type, "limit": 500}),
            (f"/events/{event_id}/pairings", {"round": round_num, "pairingType": pairing_type})
        ]
        items = []
        for ep, params in endpoints:
            resp = self._make_request(ep, params=params)
            if isinstance(resp, dict):
                if "data" in resp and isinstance(resp["data"], list) and resp["data"]:
                    items = resp["data"]
                    break
                elif "active" in resp and isinstance(resp["active"], list) and resp["active"]:
                    items = resp["active"]
                    break
            elif isinstance(resp, list) and resp:
                items = resp
                break

        # Fallback to TeamPairing if standard Pairing is empty (e.g. Doubles or Team events)
        if not items and pairing_type == "Pairing":
            team_endpoints = [
                ("/pairings", {"eventId": event_id, "round": round_num, "pairingType": "TeamPairing", "limit": 500}),
                (f"/events/{event_id}/pairings", {"round": round_num, "pairingType": "TeamPairing"})
            ]
            for ep, params in team_endpoints:
                resp_team = self._make_request(ep, params=params)
                if isinstance(resp_team, dict):
                    if "data" in resp_team and isinstance(resp_team["data"], list) and resp_team["data"]:
                        items = resp_team["data"]
                        break
                    elif "active" in resp_team and isinstance(resp_team["active"], list) and resp_team["active"]:
                        items = resp_team["active"]
                        break
                elif isinstance(resp_team, list) and resp_team:
                    items = resp_team
                    break

        return items or []

    def fetch_event_team_pairings_for_round(self, event_id: str, round_num: int) -> List[Dict[str, Any]]:
        """Fetches team-level pairings (Team vs Team) for a team or doubles tournament round."""
        resp = self._make_request(f"/events/{event_id}/pairings", params={
            "round": round_num,
            "pairingType": "TeamPairing"
        })
        if not resp:
            return []
        if isinstance(resp, dict):
            if "active" in resp and isinstance(resp["active"], list):
                return resp["active"]
            if "data" in resp and isinstance(resp["data"], list):
                return resp["data"]
        elif isinstance(resp, list):
            return resp
        return []

    def fetch_event_players(self, event_id: str) -> List[Dict[str, Any]]:
        """Fetches registered player roster for an event from BCP with official placings and tiebreaker metrics.
        Ensures both complete registered roster and official placings are retrieved.
        """
        # 1. Fetch from /events/{event_id}/players with placings=true (supporting super-majors up to 2500 competitors)
        resp = self._make_request(f"/events/{event_id}/players", params={"limit": 2500, "placings": "true"})
        players = []
        if resp:
            if isinstance(resp, dict):
                if "active" in resp and isinstance(resp["active"], list):
                    players = resp["active"]
                elif "data" in resp and isinstance(resp["data"], list):
                    players = resp["data"]
                elif "players" in resp and isinstance(resp["players"], list):
                    players = resp["players"]
            elif isinstance(resp, list):
                players = resp

        # 2. Also fetch complete roster without placings filter to capture all enrolled competitors
        # (BCP excludes unplaced competitors when placings=true is queried)
        roster_resp = self._make_request(f"/events/{event_id}/players", params={"limit": 2500})
        roster_players = []
        if roster_resp:
            if isinstance(roster_resp, dict):
                if "active" in roster_resp and isinstance(roster_resp["active"], list):
                    roster_players = roster_resp["active"]
                elif "data" in roster_resp and isinstance(roster_resp["data"], list):
                    roster_players = roster_resp["data"]
                elif "players" in roster_resp and isinstance(roster_resp["players"], list):
                    roster_players = roster_resp["players"]
            elif isinstance(roster_resp, list):
                roster_players = roster_resp

        if roster_players:
            if players:
                # Merge placing metrics from `players` onto `roster_players`
                plc_map = {}
                for p in players:
                    u = p.get("user") or {}
                    for kid in (u.get("id"), p.get("userId"), p.get("id")):
                        if kid:
                            plc_map[str(kid).strip()] = p

                for rp in roster_players:
                    u = rp.get("user") or {}
                    matched = None
                    for kid in (u.get("id"), rp.get("userId"), rp.get("id")):
                        if kid and str(kid).strip() in plc_map:
                            matched = plc_map[str(kid).strip()]
                            break
                    if matched:
                        for k in ("placing", "manualPlacing", "rank", "place", "placement", "points", "battlePoints", "totalPoints", "metrics", "total_metrics", "podNum"):
                            if matched.get(k) is not None:
                                rp[k] = matched[k]
                return roster_players
            return roster_players

        if players:
            return players

        # 3. If empty, fallback to full event details object
        ev_data = self.fetch_event_details(event_id)
        if ev_data and isinstance(ev_data, dict):
            if "players" in ev_data and isinstance(ev_data["players"], list):
                players = ev_data["players"]
            elif "placings" in ev_data and isinstance(ev_data["placings"], list):
                players = ev_data["placings"]
            elif "users" in ev_data and isinstance(ev_data["users"], list):
                players = ev_data["users"]

        return players

    def fetch_event_teams(self, event_id: str) -> List[Dict[str, Any]]:
        """Fetches registered teams and official team placings from BCP for a team tournament."""
        resp = self._make_request(f"/events/{event_id}/teamplayers", params={"limit": 2500, "placings": "true"})
        teams = []
        if resp:
            if isinstance(resp, dict):
                if "active" in resp and isinstance(resp["active"], list):
                    teams = resp["active"]
                elif "data" in resp and isinstance(resp["data"], list):
                    teams = resp["data"]
                elif "teamplayers" in resp and isinstance(resp["teamplayers"], list):
                    teams = resp["teamplayers"]
            elif isinstance(resp, list):
                teams = resp

        # Also fetch without placings to capture all enrolled teams if placings=true returns empty/fewer
        roster_resp = self._make_request(f"/events/{event_id}/teamplayers", params={"limit": 2500})
        roster_teams = []
        if roster_resp:
            if isinstance(roster_resp, dict):
                if "active" in roster_resp and isinstance(roster_resp["active"], list):
                    roster_teams = roster_resp["active"]
                elif "data" in roster_resp and isinstance(roster_resp["data"], list):
                    roster_teams = roster_resp["data"]
                elif "teamplayers" in roster_resp and isinstance(roster_resp["teamplayers"], list):
                    roster_teams = roster_resp["teamplayers"]
            elif isinstance(roster_resp, list):
                roster_teams = roster_resp

        if teams:
            # If placings=true returned teams, preserve official placement order and rich metrics/games
            if roster_teams:
                seen_ids = set()
                for t in teams:
                    tid = str(t.get("id") or t.get("teamPlayerId") or "").strip()
                    if tid:
                        seen_ids.add(tid)
                for rt in roster_teams:
                    tid = str(rt.get("id") or rt.get("teamPlayerId") or "").strip()
                    if tid and tid not in seen_ids:
                        seen_ids.add(tid)
                        teams.append(rt)
        else:
            teams = roster_teams

        # Sort teams by placing if any placings exist
        if teams:
            has_placings = any(t.get("placing") is not None and not isinstance(t.get("placing"), bool) for t in teams)
            if has_placings:
                teams.sort(key=lambda x: (
                    x.get("placing") is None or isinstance(x.get("placing"), bool),
                    x.get("placing") if x.get("placing") is not None and not isinstance(x.get("placing"), bool) else 999999
                ))

        return teams

    def ingest_event_roster(self, event_id: str, enrolled_players: List[Dict[str, Any]], teams: Optional[List[Dict[str, Any]]] = None) -> int:
        """Parses, deduplicates, links team affiliations, and batch-upserts the participant roster."""
        if not enrolled_players:
            return 0

        # Build team lookup map if teams are provided
        team_name_by_id = {}
        for t in (teams or []):
            t_id = t.get("id") or t.get("teamPlayerId")
            t_name = t.get("name") or t.get("teamName")
            if t_id and t_name:
                team_name_by_id[str(t_id)] = str(t_name).strip()

        active_player_ids = set()
        participants_to_upsert = []

        for p in enrolled_players:
            user = p.get("user") or {}
            canonical_id = user.get("id") or p.get("userId") or p.get("id")
            if not canonical_id:
                continue
            canonical_id = str(canonical_id).strip()

            first_name = user.get("firstName") or p.get("firstName") or ""
            last_name = user.get("lastName") or p.get("lastName") or ""
            full_name = f"{first_name} {last_name}".strip() or p.get("name") or "Player"

            faction_obj = p.get("faction") or p.get("parentFaction") or ""
            faction_name = ""
            if isinstance(faction_obj, dict):
                faction_name = faction_obj.get("name", "")
            elif isinstance(faction_obj, str):
                faction_name = faction_obj

            team_name = (
                p.get("team") or p.get("teamName") or 
                user.get("team") or user.get("teamName") or 
                p.get("club") or user.get("club") or 
                p.get("gamingClub") or user.get("gamingClub") or 
                p.get("clubName") or user.get("clubName") or ""
            )
            if isinstance(team_name, dict):
                team_name = team_name.get("name") or team_name.get("teamName") or ""
            team_name = str(team_name).strip()

            # Resolve team name from teamPlayerId mapping if not directly present on player
            team_player_id = str(p.get("teamPlayerId") or "").strip()
            if not team_name and team_player_id and team_player_id in team_name_by_id:
                team_name = team_name_by_id[team_player_id]

            # Priority:
            # 1. manualPlacing (if explicit positive integer override from TO, ignoring booleans like False)
            # 2. placing (official competitive tournament placing from Swiss + playoff pods)
            # 3. rank / place / placement / ranking (alternate standard ranking keys)
            # 4. overallPlacing (fallback only if competitive placing is absent)
            placing_num = None
            manual_val = p.get("manualPlacing")
            if manual_val is not None and not isinstance(manual_val, bool):
                try:
                    mv = int(manual_val)
                    if mv > 0:
                        placing_num = mv
                except (ValueError, TypeError):
                    pass

            if placing_num is None:
                comp_place = p.get("placing")
                if comp_place is not None and not isinstance(comp_place, bool):
                    try:
                        cp = int(comp_place)
                        if cp > 0:
                            placing_num = cp
                    except (ValueError, TypeError):
                        pass

            if placing_num is None:
                for alt_key in ("place", "rank", "placement", "ranking"):
                    val = p.get(alt_key)
                    if val is not None and not isinstance(val, bool):
                        try:
                            pv = int(val)
                            if pv > 0:
                                placing_num = pv
                                break
                        except (ValueError, TypeError):
                            pass

            if placing_num is None:
                overall = p.get("overallPlacing")
                if overall is not None and not isinstance(overall, bool):
                    try:
                        ov = int(overall)
                        if ov > 0:
                            placing_num = ov
                    except (ValueError, TypeError):
                        pass

            raw_pts = p.get("points") or p.get("battlePoints") or p.get("totalPoints")
            pts_num = None
            if raw_pts is not None:
                try:
                    pts_num = int(raw_pts)
                except (ValueError, TypeError):
                    pass

            if pts_num is None and isinstance(p.get("metrics"), list):
                for m in p["metrics"]:
                    if isinstance(m, dict) and m.get("name") in ("Battle Points", "battlePoints", "points"):
                        try:
                            pts_num = int(m.get("value", 0))
                            break
                        except (ValueError, TypeError):
                            pass

            raw_pod = p.get("podNum") or p.get("pod_num")
            pod_num = None
            if raw_pod is not None:
                try:
                    pod_num = int(raw_pod)
                except (ValueError, TypeError):
                    pass

            active_player_ids.add(canonical_id)
            participants_to_upsert.append({
                "player_id": canonical_id,
                "first_name": first_name,
                "last_name": last_name,
                "full_name": full_name,
                "faction": faction_name,
                "team": team_name,
                "dropped": bool(p.get("dropped")),
                "checked_in": bool(p.get("checkedIn")),
                "placement": placing_num,
                "battle_points": pts_num,
                "pod_num": pod_num
            })

        # Batch upsert participants
        if hasattr(self.db, "upsert_event_participants_batch"):
            self.db.upsert_event_participants_batch(event_id, participants_to_upsert)
        else:
            for part in participants_to_upsert:
                self.db.upsert_player(part["player_id"], part["first_name"], part["last_name"], part["full_name"], team=part["team"])
                self.db.upsert_event_participant(
                    event_id=event_id,
                    player_id=part["player_id"],
                    first_name=part["first_name"],
                    last_name=part["last_name"],
                    full_name=part["full_name"],
                    faction=part["faction"],
                    team=part["team"],
                    dropped=part["dropped"],
                    checked_in=part["checked_in"],
                    placement=part["placement"],
                    battle_points=part["battle_points"],
                    pod_num=part["pod_num"]
                )

        # Prune dropped / unregistered participants and orphaned ghost IDs from DB
        if hasattr(self.db, "prune_event_participants"):
            self.db.prune_event_participants(event_id, active_player_ids)
            # Update total_players count in events to reflect active roster
            try:
                if hasattr(self.db, "get_connection"):
                    with self.db.get_connection() as conn:
                        with conn.cursor() as cursor:
                            cursor.execute("""
                            UPDATE events 
                            SET total_players = (SELECT COUNT(*) FROM event_participants WHERE event_id = %s)
                            WHERE id = %s;
                            """, (event_id, event_id))
                        conn.commit()
            except Exception as e:
                logger.debug(f"Notice updating total_players for event {event_id}: {e}")

        return len(active_player_ids)

    def sync_event_roster(self, event_id: str) -> int:
        """Quickly updates the participant roster, podNum, event placing metrics, and team standings without re-fetching all round matches."""
        ev_data = None
        try:
            ev_data = self.fetch_event_details(event_id)
            if ev_data and isinstance(ev_data, dict):
                ev_data["id"] = ev_data.get("id") or event_id
                self.db.upsert_event(ev_data)
            elif ev_data is None and getattr(self, "last_http_code", None) == 404 and not str(event_id).startswith("ES-"):
                if hasattr(self.db, "has_event_matches") and not self.db.has_event_matches(event_id):
                    logger.info(f"Event {event_id} returned 404 on BCP and has no matches; removing from DB.")
                    if hasattr(self.db, "delete_studio_event"):
                        self.db.delete_studio_event(event_id)
                    return 0
        except Exception as e:
            logger.debug(f"Could not update event metadata in sync_event_roster for {event_id}: {e}")

        is_team_event = False
        if ev_data and isinstance(ev_data, dict):
            is_team_event = bool(
                ev_data.get("teamEvent") or 
                ev_data.get("eventType") == "team" or 
                (isinstance(ev_data.get("raw_json"), dict) and ev_data["raw_json"].get("teamEvent"))
            )

        teams = None
        if is_team_event:
            try:
                teams = self.fetch_event_teams(event_id)
                if teams and hasattr(self.db, "save_event_team_standings"):
                    formatted_team_standings = []
                    for t in teams:
                        metrics = {m.get("name"): m.get("value") for m in t.get("metrics", []) if isinstance(m, dict)}
                        capt = t.get("captain") or {}
                        capt_name = f"{capt.get('firstName', '')} {capt.get('lastName', '')}".strip() if isinstance(capt, dict) else ""
                        t_place = None
                        for pk in ("manualPlacing", "placing", "rank", "place", "placement", "overallPlacing"):
                            pval = t.get(pk)
                            if pval is not None and not isinstance(pval, bool):
                                try:
                                    pv = int(pval)
                                    if pv > 0:
                                        t_place = pv
                                        break
                                except (ValueError, TypeError):
                                    pass
                        formatted_team_standings.append({
                            "id": t.get("id"),
                            "placing": t_place,
                            "name": t.get("name") or "Team",
                            "captain": capt_name,
                            "match_points": metrics.get("Match Points", 0),
                            "game_wins": metrics.get("Game Wins", 0),
                            "battle_points": metrics.get("Battle Points", 0)
                        })
                    formatted_team_standings.sort(key=lambda x: x.get("placing") or 999)
                    self.db.save_event_team_standings(event_id, formatted_team_standings)
            except Exception as te:
                logger.debug(f"Could not fetch team standings for {event_id}: {te}")

        enrolled_players = self.fetch_event_players(event_id)
        return self.ingest_event_roster(event_id, enrolled_players, teams=teams)

    def parse_and_store_match(self, event_data: Dict[str, Any], pairing: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Extracts structured match details and stores both players and match outcome in DB."""
        match_id = pairing.get("id")
        if not match_id:
            return None

        event_id = event_data.get("id") or event_data.get("objectId") or pairing.get("eventId")
        if not event_id:
            return None

        event_date = event_data.get("eventDate") or event_data.get("event_date")
        event_name = event_data.get("name", "Tournament")
        round_num = pairing.get("round", 1)
        table_num = pairing.get("table", 1)

        game_sys_id = event_data.get("gameSystemId") or event_data.get("game_system_id") or pairing.get("gameSystemId")
        raw_gs = (event_data.get("game_system") or pairing.get("game_system") or "").strip().lower()
        if raw_gs:
            game_system = raw_gs
        elif str(game_sys_id) in (str(AOS_GAME_SYSTEM_ID), "23qDprPABN", "OY8FCPBf6O"):
            game_system = "aos"
        else:
            game_system = "40k"

        p1_obj = pairing.get("player1") or {}
        p2_obj = pairing.get("player2") or {}

        # Player 1 details
        p1_user = p1_obj.get("user") or {}
        p1_user_id = p1_user.get("id") or p1_obj.get("id") or pairing.get("player1Id")
        p1_first = p1_user.get("firstName") or ""
        p1_last = p1_user.get("lastName") or ""
        p1_name = f"{p1_first} {p1_last}".strip() or p1_obj.get("name") or "Player 1"
        p1_faction = p1_obj.get("faction") or p1_obj.get("parentFaction") or ""
        if isinstance(p1_faction, dict):
            p1_faction = p1_faction.get("name", "")

        # Player 2 details
        p2_user = p2_obj.get("user") or {}
        p2_user_id = p2_user.get("id") or p2_obj.get("id") or pairing.get("player2Id")
        p2_first = p2_user.get("firstName") or ""
        p2_last = p2_user.get("lastName") or ""
        p2_name = f"{p2_first} {p2_last}".strip() or p2_obj.get("name") or ("Player 2" if p2_user_id else "BYE")
        p2_faction = p2_obj.get("faction") or p2_obj.get("parentFaction") or ""
        if isinstance(p2_faction, dict):
            p2_faction = p2_faction.get("name", "")

        is_bye = bool(
            p2_user_id is None or p2_name == "BYE" or 
            p1_user_id is None or p1_name == "BYE" or 
            pairing.get("isBye")
        )

        # Scores and results
        p1_game = pairing.get("player1Game") or {}
        p2_game = pairing.get("player2Game") or {}
        meta = pairing.get("metaData") or {}

        p1_score = p1_game.get("points")
        if p1_score is None and meta.get("p1-gamePoints") is not None:
            try: p1_score = int(meta.get("p1-gamePoints"))
            except Exception: pass

        p2_score = p2_game.get("points")
        if p2_score is None and meta.get("p2-gamePoints") is not None:
            try: p2_score = int(meta.get("p2-gamePoints"))
            except Exception: pass

        p1_result = p1_game.get("result")  # 2: Win, 0: Loss, 1: Draw
        if p1_result is None and meta.get("p1-gameResult") is not None:
            try: p1_result = int(meta.get("p1-gameResult"))
            except Exception: pass

        p2_result = p2_game.get("result")
        if p2_result is None and meta.get("p2-gameResult") is not None:
            try: p2_result = int(meta.get("p2-gameResult"))
            except Exception: pass

        is_done = bool(pairing.get("isDone", True))
        has_scores = p1_score is not None and p2_score is not None
        has_results = p1_result is not None and p2_result is not None

        # Guard: if match is still in progress and no scores/results entered, avoid treating as premature draw
        is_unplayed = (not is_done) and (
            (not has_scores or (p1_score == 0 and p2_score == 0)) and
            (not has_results or (p1_result == 0 and p2_result == 0))
        )

        winner_id = None
        loser_id = None
        is_draw = False

        if is_bye:
            if p1_name == "BYE" or not p1_user_id:
                winner_id = p2_user_id
            else:
                winner_id = p1_user_id
            loser_id = None
        elif is_unplayed:
            winner_id = None
            loser_id = None
            is_draw = False
        elif has_results:
            if p1_result == 2 and p2_result == 0:
                winner_id = p1_user_id
                loser_id = p2_user_id
            elif p2_result == 2 and p1_result == 0:
                winner_id = p2_user_id
                loser_id = p1_user_id
            elif p1_result == 1 or p2_result == 1 or (p1_result == p2_result and (is_done or has_scores)):
                is_draw = True
        elif has_scores:
            if p1_score > p2_score:
                winner_id = p1_user_id
                loser_id = p2_user_id
            elif p2_score > p1_score:
                winner_id = p2_user_id
                loser_id = p1_user_id
            elif is_done:
                is_draw = True

        # Upsert players into database
        if p1_user_id:
            self.db.upsert_player(p1_user_id, p1_first, p1_last, p1_name)
        if p2_user_id:
            self.db.upsert_player(p2_user_id, p2_first, p2_last, p2_name)

        match_record = {
            "id": match_id,
            "event_id": event_id,
            "event_name": event_name,
            "round": round_num,
            "table_number": table_num,
            "match_date": event_date,
            "player1_id": p1_user_id,
            "player1_name": p1_name,
            "player1_faction": p1_faction,
            "player1_score": p1_score,
            "player2_id": p2_user_id,
            "player2_name": p2_name,
            "player2_faction": p2_faction,
            "player2_score": p2_score,
            "winner_id": winner_id,
            "loser_id": loser_id,
            "is_draw": is_draw,
            "is_bye": is_bye,
            "is_done": pairing.get("isDone", True),
            "game_system": game_system,
            "game_system_id": game_sys_id or (AOS_GAME_SYSTEM_ID if game_system == "aos" else DEFAULT_GAME_SYSTEM_ID),
            "raw_json": pairing,
        }

        try:
            self.db.upsert_match(match_record)
            return match_record
        except Exception as e:
            logger.warning(f"Failed to upsert match {match_id}: {e}")
            return None

    def scrape_event(self, event_id: str, fallback_event_data: Optional[Dict[str, Any]] = None) -> int:
        """Scrapes full event details and all match pairings for an event. Returns count of matches scraped."""
        event_data = self.fetch_event_details(event_id)
        if not event_data or not isinstance(event_data, dict) or ("id" not in event_data and "name" not in event_data):
            if fallback_event_data:
                event_data = fallback_event_data
            else:
                logger.warning(f"Could not retrieve details for event {event_id}")
                return 0

        event_data["id"] = event_data.get("id") or event_data.get("objectId") or event_id
        game_sys_id = event_data.get("gameSystemId") or event_data.get("game_system_id")
        if "game_system" not in event_data:
            event_data["game_system"] = "aos" if str(game_sys_id) in (str(AOS_GAME_SYSTEM_ID), "23qDprPABN", "OY8FCPBf6O") else "40k"
        self.db.upsert_event(event_data)

        # Check team event and fetch team standings
        is_team_event = bool(
            event_data.get("teamEvent") or 
            event_data.get("eventType") == "team" or 
            (isinstance(event_data.get("raw_json"), dict) and event_data["raw_json"].get("teamEvent"))
        )
        teams = None
        if is_team_event:
            try:
                teams = self.fetch_event_teams(event_id)
                if teams and hasattr(self.db, "save_event_team_standings"):
                    formatted_team_standings = []
                    for t in teams:
                        metrics = {m.get("name"): m.get("value") for m in t.get("metrics", []) if isinstance(m, dict)}
                        capt = t.get("captain") or {}
                        capt_name = f"{capt.get('firstName', '')} {capt.get('lastName', '')}".strip() if isinstance(capt, dict) else ""
                        t_place = None
                        for pk in ("manualPlacing", "placing", "rank", "place", "placement", "overallPlacing"):
                            pval = t.get(pk)
                            if pval is not None and not isinstance(pval, bool):
                                try:
                                    pv = int(pval)
                                    if pv > 0:
                                        t_place = pv
                                        break
                                except (ValueError, TypeError):
                                    pass
                        formatted_team_standings.append({
                            "id": t.get("id"),
                            "placing": t_place,
                            "name": t.get("name") or "Team",
                            "captain": capt_name,
                            "match_points": metrics.get("Match Points", 0),
                            "game_wins": metrics.get("Game Wins", 0),
                            "battle_points": metrics.get("Battle Points", 0)
                        })
                    formatted_team_standings.sort(key=lambda x: x.get("placing") or 999)
                    self.db.save_event_team_standings(event_id, formatted_team_standings)
            except Exception as te:
                logger.debug(f"Could not fetch team standings for {event_id}: {te}")

        # Ingest registered participants roster (works even if 0 rounds played yet)
        try:
            enrolled_players = self.fetch_event_players(event_id)
            self.ingest_event_roster(event_id, enrolled_players, teams=teams)
        except Exception as e:
            logger.debug(f"Could not fetch roster for event {event_id}: {e}")

        try:
            rounds_dict = event_data.get("rounds") or {}
            dict_rounds = 0
            if isinstance(rounds_dict, dict):
                dict_rounds = max([int(k) for k in rounds_dict.keys() if str(k).isdigit()] or [0])
            raw_rounds = event_data.get("numberOfRounds") or event_data.get("currentRound") or dict_rounds or 3
            num_rounds = min(max(int(raw_rounds or 3), dict_rounds), 12)
        except Exception:
            num_rounds = 3

        event_name = event_data.get("name", "Unknown Event")
        total_players = event_data.get("totalPlayers") or event_data.get("checkedInPlayers") or 0
        event_date = (event_data.get("eventDate") or event_data.get("eventEndDate") or "")[:10] or "No Date"

        if total_players > 30 or num_rounds > 4:
            logger.info(f"Scraping '{event_name}' ({event_id}) [{event_date}]: {total_players} players, {num_rounds} rounds...")

        total_matches = 0
        consecutive_empty = 0
        actual_rounds = 0

        for r in range(1, num_rounds + 1):
            pairings = self.fetch_event_pairings_for_round(event_id, r)
            if not pairings:
                consecutive_empty += 1
                if consecutive_empty >= 2:
                    break
                continue

            consecutive_empty = 0
            actual_rounds = r
            round_matches = 0
            for p in pairings:
                if self.parse_and_store_match(event_data, p):
                    total_matches += 1
                    round_matches += 1

            if total_players > 30 or num_rounds > 4:
                logger.info(f"  -> Round {r}/{num_rounds}: {round_matches} matches processed.")

        logger.info(f"Scraped '{event_name}' ({event_id}) [{event_date}]: {actual_rounds or num_rounds} rounds, {total_matches} matches total.")
        return total_matches

    def scrape_date_range(
        self,
        start_date: str,
        end_date: str,
        game_system_id: str = DEFAULT_GAME_SYSTEM_ID,
        max_events: Optional[int] = None
    ) -> Dict[str, int]:
        """Scrapes all events in a given date range for the specified game system and stores their full match histories."""
        events_count = 0
        matches_count = 0

        for event in self.fetch_events(start_date=start_date, end_date=end_date, game_system_id=game_system_id, max_events=max_events):
            event_id = event.get("id") or event.get("objectId")
            if not event_id:
                continue

            events_count += 1
            try:
                matches = self.scrape_event(event_id, fallback_event_data=event)
                matches_count += matches
            except Exception as e:
                logger.error(f"Error scraping event {event_id} ({event.get('name')}): {e}")

        logger.info(f"Finished scraping date range [{start_date} to {end_date}] for gameSystemId={game_system_id}: {events_count} events, {matches_count} matches.")
        return {"events_scraped": events_count, "matches_scraped": matches_count}

    def sync_upcoming_events(self, game_system_id: str = DEFAULT_GAME_SYSTEM_ID, max_pages_per_month: int = 15) -> int:
        """Fetches live future upcoming tournaments across multiple monthly windows from Best Coast Pairings API and caches them."""
        now_dt = datetime.now(timezone.utc)
        curr_year = now_dt.year
        curr_month = now_dt.month
        month_windows = []

        # Dynamic rolling monthly windows (next 4 months) to ensure full global coverage without date expiration
        for i in range(4):
            m = curr_month + i
            y = curr_year + (m - 1) // 12
            m = ((m - 1) % 12) + 1
            if i == 0:
                start_dt = now_dt
            else:
                start_dt = datetime(y, m, 1, 0, 0, 0, tzinfo=timezone.utc)

            next_m = m + 1
            next_y = y + (next_m - 1) // 12
            next_m = ((next_m - 1) % 12) + 1
            end_dt = datetime(next_y, next_m, 1, 0, 0, 0, tzinfo=timezone.utc) - timedelta(milliseconds=1)

            month_windows.append((
                start_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                end_dt.strftime("%Y-%m-%dT%H:%M:%S.999Z")
            ))
        
        total_synced = 0

        for start_iso, end_iso in month_windows:
            next_key = None
            for _ in range(max_pages_per_month):
                params = {
                    "limit": 50,
                    "gameSystemId": game_system_id,
                    "startDate": start_iso,
                    "endDate": end_iso
                }
                if next_key:
                    params["nextKey"] = next_key

                resp = self._make_request("/events", params=params)
                if not resp or "data" not in resp:
                    break

                events = resp.get("data", [])
                if not events:
                    break

                for ev in events:
                    if "game_system" not in ev:
                        ev["game_system"] = "aos" if str(game_system_id) in (str(AOS_GAME_SYSTEM_ID), "23qDprPABN", "OY8FCPBf6O") else "40k"
                    self.db.upsert_event(ev)
                    total_synced += 1

                next_key = resp.get("nextKey")
                if not next_key:
                    break

        logger.info(f"Successfully synced {total_synced} live upcoming events across next 3 months for gameSystemId={game_system_id} from BCP API.")
        return total_synced


if __name__ == "__main__":
    from scripts.historical_scrape import main as cli_main
    cli_main()

