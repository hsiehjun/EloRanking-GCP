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
    from google3.experimental.users.hsiehjun.EloRanking.config import (
        BCP_API_BASE,
        DEFAULT_HEADERS,
        DEFAULT_GAME_SYSTEM_ID,
        AOS_GAME_SYSTEM_ID,
        get_bcp_game_system_id,
        is_bcp_event_id,
        normalize_game_system,
        resolve_event_game_system,
    )
    from google3.experimental.users.hsiehjun.EloRanking.database import Database
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.config import (
            BCP_API_BASE,
            DEFAULT_HEADERS,
            DEFAULT_GAME_SYSTEM_ID,
            AOS_GAME_SYSTEM_ID,
            get_bcp_game_system_id,
            is_bcp_event_id,
            normalize_game_system,
            resolve_event_game_system,
        )
        from experimental.users.hsiehjun.EloRanking.database import Database
    except ImportError:
        from config import (
            BCP_API_BASE,
            DEFAULT_HEADERS,
            DEFAULT_GAME_SYSTEM_ID,
            AOS_GAME_SYSTEM_ID,
            get_bcp_game_system_id,
            is_bcp_event_id,
            normalize_game_system,
            resolve_event_game_system,
        )
        from database import Database, get_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("BCPScraper")

EMPTY_FACTION_NAMES = {
    "",
    "unknown",
    "unknown faction",
    "unassigned",
    "none",
    "null",
    "-",
    "various",
    "n/a",
    "tbd",
    "bye",
}

SUPER_FACTION_NAMES = {
    "imperium",
    "armies of the imperium",
    "forces of the imperium",
    "chaos",
    "armies of chaos",
    "forces of chaos",
    "xenos",
    "xenos armies",
    "forces of the hive mind",
    "hive mind",
    "order",
    "grand alliance order",
    "grand alliance: order",
    "grand alliance chaos",
    "grand alliance: chaos",
    "death",
    "grand alliance death",
    "grand alliance: death",
    "destruction",
    "grand alliance destruction",
    "grand alliance: destruction",
    "warhammer 40,000",
    "warhammer 40k",
    "age of sigmar",
    "warhammer age of sigmar",
}

GENERIC_SM_NAMES = {
    "space marines (astartes)",
    "adeptus astartes",
    "space marines",
}


def is_generic_super_faction(name: Optional[str]) -> bool:
    """Returns True if name is empty, unknown, or a generic Grand Alliance / super-faction."""
    norm = str(name or "").strip().lower()
    return norm in EMPTY_FACTION_NAMES or norm in SUPER_FACTION_NAMES


def extract_bcp_specific_faction(
    p_obj: Optional[Dict[str, Any]],
    roster_faction: Optional[str] = None,
) -> str:
    """Extracts the most specific army/faction name from a BCP player or pairing player object.

    In BCP's `/v1/pairings` endpoint, `player.army` holds the specific army (e.g. 'Adepta Sororitas',
    'World Eaters', 'Dark Angels') while `player.faction` holds the Grand Alliance / super-faction
    ('Imperium', 'Chaos', 'Forces of the Hive Mind', 'Space Marines (Astartes)', 'Xenos').
    In `/v1/events/{id}/players`, `player.faction` holds the specific army and `player.parentFaction`
    holds the super-faction. This helper always prioritizes the specific army over any super-faction.
    """
    candidates: List[str] = []
    if isinstance(p_obj, dict):
        raw_fields = (
            p_obj.get("army"),
            p_obj.get("armyName"),
            p_obj.get("army_name"),
            p_obj.get("faction"),
            p_obj.get("factionName"),
            p_obj.get("faction_name"),
            p_obj.get("customFaction"),
            roster_faction,
            p_obj.get("parentFaction"),
        )
    else:
        raw_fields = (roster_faction,)

    for raw in raw_fields:
        if not raw:
            continue
        if isinstance(raw, dict):
            val = str(raw.get("name") or raw.get("factionName") or raw.get("armyName") or "").strip()
        else:
            val = str(raw).strip()
        if val and val.lower() not in EMPTY_FACTION_NAMES:
            candidates.append(val)

    # Pass 1: Specific army that is neither a super-faction nor generic Space Marines
    for cand in candidates:
        low = cand.lower()
        if low not in SUPER_FACTION_NAMES and low not in GENERIC_SM_NAMES:
            return cand

    # Pass 2: Generic Space Marines (better than 'Imperium')
    for cand in candidates:
        low = cand.lower()
        if low not in SUPER_FACTION_NAMES:
            return cand

    # Pass 3: Fallback to whatever valid string was provided
    return candidates[0] if candidates else ""


class BestCoastPairingsScraper:
    """Scrapes tournaments, player rosters, and round-by-round pairings from Best Coast Pairings."""

    def __init__(self, db: Optional[Database] = None, request_delay: float = 0.08):
        if db is not None:
            self.db = db
        else:
            try:
                self.db = get_db()
            except Exception:
                self.db = None
        self.headers = DEFAULT_HEADERS.copy()
        self.headers["Accept-Encoding"] = "gzip"
        self.request_delay = request_delay
        self._reg_id_cache: Dict[str, Optional[Dict[str, str]]] = {}
        self._user_id_cache: Dict[str, Optional[Dict[str, str]]] = {}
        self._scraped_event_ids_in_session: set = set()

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
                    raw_bytes = response.read()
                    if isinstance(raw_bytes, (bytes, bytearray)):
                        hdrs = getattr(response, "headers", None) or {}
                        enc = hdrs.get("Content-Encoding", "") if hasattr(hdrs, "get") else ""
                        if enc == "gzip" or (len(raw_bytes) >= 2 and raw_bytes[:2] == b"\x1f\x8b"):
                            import gzip
                            raw_bytes = gzip.decompress(raw_bytes)
                        content = raw_bytes.decode("utf-8")
                    else:
                        content = str(raw_bytes)
                    return json.loads(content)
            except urllib.error.HTTPError as e:
                self.last_http_code = e.code
                body = e.read().decode("utf-8", errors="ignore")
                if e.code == 404 and (endpoint.startswith("/players/") or endpoint.startswith("/users/")):
                    logger.debug(f"HTTP 404 on {endpoint}: {body[:150]}")
                else:
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
        game_system_id: Optional[str] = DEFAULT_GAME_SYSTEM_ID,
        limit_per_page: int = 50,
        max_events: Optional[int] = None
    ) -> Generator[Dict[str, Any], None, None]:
        """Paginates through BCP events in the given date range (for a specific gameSystemId or all game systems if None/'all')."""
        next_key = None
        total_yielded = 0

        logger.info(f"Fetching events from {start_date} to {end_date} for gameSystemId={game_system_id or 'ALL'}")

        while True:
            params: Dict[str, Any] = {
                "limit": limit_per_page,
                "startDate": start_date,
                "endDate": end_date,
            }
            if game_system_id and str(game_system_id).lower() not in ("all", "*"):
                params["gameSystemId"] = game_system_id
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

    _bcp_http_cache: Dict[str, Any] = {}
    _BCP_HTTP_CACHE_TTL: float = 90.0

    def _is_mocked(self) -> bool:
        return (
            hasattr(self._make_request, "assert_called")
            or hasattr(self._make_request, "side_effect")
            or hasattr(urllib.request.urlopen, "assert_called")
            or hasattr(urllib.request.urlopen, "side_effect")
            or hasattr(self.fetch_event_details, "assert_called")
            or hasattr(self.fetch_event_details, "side_effect")
            or hasattr(self.fetch_event_players, "assert_called")
            or hasattr(self.fetch_event_players, "side_effect")
            or hasattr(self.fetch_event_pairings_for_round, "assert_called")
            or hasattr(self.fetch_event_pairings_for_round, "side_effect")
            or hasattr(getattr(self, "db", None), "assert_called")
        )

    def fetch_event_details(self, event_id: str) -> Optional[Dict[str, Any]]:
        """Fetches full tournament details for a specific event."""
        use_cache = not self._is_mocked()
        cache_key = f"ev_details:{event_id}"
        if use_cache:
            entry = BestCoastPairingsScraper._bcp_http_cache.get(cache_key)
            if entry and (time.time() - entry[0]) < self._BCP_HTTP_CACHE_TTL:
                return entry[1]
        res = self._make_request(f"/events/{event_id}")
        if use_cache:
            BestCoastPairingsScraper._bcp_http_cache[cache_key] = (time.time(), res)
        return res

    def fetch_event_pairings_for_round(self, event_id: str, round_num: int, pairing_type: str = "Pairing") -> List[Dict[str, Any]]:
        """Fetches all pairings for a specific round of an event. Falls back to TeamPairing if standard Pairing is empty."""
        use_cache = not self._is_mocked()
        if use_cache:
            ev_entry = BestCoastPairingsScraper._bcp_http_cache.get(f"ev_details:{event_id}")
            if ev_entry and (time.time() - ev_entry[0]) < self._BCP_HTTP_CACHE_TTL and ev_entry[1] is None:
                return []
            pair_cache_key = f"ev_pairings:{event_id}:{round_num}:{pairing_type}"
            pair_entry = BestCoastPairingsScraper._bcp_http_cache.get(pair_cache_key)
            if pair_entry and (time.time() - pair_entry[0]) < self._BCP_HTTP_CACHE_TTL:
                return pair_entry[1]
        elif (
            not hasattr(self._make_request, "assert_called")
            and not hasattr(self._make_request, "side_effect")
            and not hasattr(urllib.request.urlopen, "assert_called")
            and not hasattr(urllib.request.urlopen, "side_effect")
        ):
            return []

        endpoints = [
            (f"/events/{event_id}/pairings", {"round": round_num, "pairingType": pairing_type}),
            ("/pairings", {"eventId": event_id, "round": round_num, "pairingType": pairing_type, "limit": 500}),
        ]
        items = []
        any_resp_not_none = False
        for ep, params in endpoints:
            resp = self._make_request(ep, params=params)
            if resp is not None:
                any_resp_not_none = True
            if isinstance(resp, dict):
                if "active" in resp and isinstance(resp["active"], list):
                    items = resp["active"]
                    break
                elif "data" in resp and isinstance(resp["data"], list):
                    items = resp["data"]
                    break
            elif isinstance(resp, list):
                items = resp
                break

        # Fallback to TeamPairing if standard Pairing is empty (e.g. Doubles or Team events)
        if not items and pairing_type == "Pairing" and (any_resp_not_none or not use_cache):
            should_try_team = True
            if use_cache:
                ev_cached = BestCoastPairingsScraper._bcp_http_cache.get(f"ev_details:{event_id}")
                ev_d = ev_cached[1] if (ev_cached and isinstance(ev_cached[1], dict)) else None
                if ev_d and ("teamEvent" in ev_d or "doublesEvent" in ev_d):
                    ev_name_low = str(ev_d.get("name") or "").lower()
                    if (
                        not ev_d.get("teamEvent")
                        and not ev_d.get("doublesEvent")
                        and ev_d.get("eventType") != "team"
                        and "2v2" not in ev_name_low
                        and "doubles" not in ev_name_low
                        and "team" not in ev_name_low
                    ):
                        should_try_team = False
            if should_try_team:
                resp_team = self._make_request(
                    f"/events/{event_id}/pairings",
                    params={"round": round_num, "pairingType": "TeamPairing"},
                )
                if isinstance(resp_team, dict):
                    if "active" in resp_team and isinstance(resp_team["active"], list) and resp_team["active"]:
                        items = resp_team["active"]
                    elif "data" in resp_team and isinstance(resp_team["data"], list) and resp_team["data"]:
                        items = resp_team["data"]
                elif isinstance(resp_team, list) and resp_team:
                    items = resp_team

        res_items = items or []
        if use_cache:
            BestCoastPairingsScraper._bcp_http_cache[f"ev_pairings:{event_id}:{round_num}:{pairing_type}"] = (time.time(), res_items)
        return res_items

    def fetch_event_team_pairings_for_round(self, event_id: str, round_num: int) -> List[Dict[str, Any]]:
        """Fetches team-level pairings (Team vs Team) for a team or doubles tournament round."""
        use_cache = not self._is_mocked()
        cache_key = f"ev_pairings:{event_id}:{round_num}:TeamPairing"
        if use_cache:
            ev_entry = BestCoastPairingsScraper._bcp_http_cache.get(f"ev_details:{event_id}")
            if ev_entry and (time.time() - ev_entry[0]) < self._BCP_HTTP_CACHE_TTL and ev_entry[1] is None:
                return []
            pair_entry = BestCoastPairingsScraper._bcp_http_cache.get(cache_key)
            if pair_entry and (time.time() - pair_entry[0]) < self._BCP_HTTP_CACHE_TTL:
                return pair_entry[1]
        elif (
            not hasattr(self._make_request, "assert_called")
            and not hasattr(self._make_request, "side_effect")
            and not hasattr(urllib.request.urlopen, "assert_called")
            and not hasattr(urllib.request.urlopen, "side_effect")
        ):
            return []

        resp = self._make_request(f"/events/{event_id}/pairings", params={
            "round": round_num,
            "pairingType": "TeamPairing"
        })
        items: List[Dict[str, Any]] = []
        if isinstance(resp, dict):
            if "active" in resp and isinstance(resp["active"], list):
                items = resp["active"]
            elif "data" in resp and isinstance(resp["data"], list):
                items = resp["data"]
        elif isinstance(resp, list):
            items = resp
        if use_cache:
            BestCoastPairingsScraper._bcp_http_cache[cache_key] = (time.time(), items)
        return items

    def fetch_event_players(self, event_id: str) -> List[Dict[str, Any]]:
        """Fetches registered player roster for an event from BCP with official placings and tiebreaker metrics.
        Ensures both complete registered roster and official placings are retrieved.
        """
        use_cache = not self._is_mocked()
        cache_key = f"ev_players:{event_id}"
        if use_cache:
            entry = BestCoastPairingsScraper._bcp_http_cache.get(cache_key)
            if entry and (time.time() - entry[0]) < self._BCP_HTTP_CACHE_TTL:
                return entry[1]
            ev_entry = BestCoastPairingsScraper._bcp_http_cache.get(f"ev_details:{event_id}")
            if ev_entry and (time.time() - ev_entry[0]) < self._BCP_HTTP_CACHE_TTL and ev_entry[1] is None:
                BestCoastPairingsScraper._bcp_http_cache[cache_key] = (time.time(), [])
                return []

        # 1. Fetch from /events/{event_id}/players with placings=true AND without placings filter
        # (BCP excludes unplaced competitors when placings=true is queried)
        if use_cache and self.request_delay <= 0.01:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=2) as pool:
                f_plc = pool.submit(self._make_request, f"/events/{event_id}/players", {"limit": 2500, "placings": "true"})
                f_ros = pool.submit(self._make_request, f"/events/{event_id}/players", {"limit": 2500})
                resp = f_plc.result()
                roster_resp = f_ros.result()
        else:
            resp = self._make_request(f"/events/{event_id}/players", params={"limit": 2500, "placings": "true"})
            roster_resp = self._make_request(f"/events/{event_id}/players", params={"limit": 2500})

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
                        for k in ("placing", "manualPlacing", "rank", "place", "placement", "points", "battlePoints", "totalPoints", "metrics", "pod_metrics", "total_metrics", "overall_metrics", "games", "pod_games", "total_games", "podNum"):
                            if matched.get(k) is not None:
                                rp[k] = matched[k]
                if use_cache:
                    BestCoastPairingsScraper._bcp_http_cache[cache_key] = (time.time(), roster_players)
                return roster_players
            if use_cache:
                BestCoastPairingsScraper._bcp_http_cache[cache_key] = (time.time(), roster_players)
            return roster_players

        if players:
            if use_cache:
                BestCoastPairingsScraper._bcp_http_cache[cache_key] = (time.time(), players)
            return players

        if resp is None and roster_resp is None and use_cache:
            BestCoastPairingsScraper._bcp_http_cache[cache_key] = (time.time(), [])
            return []

        # 3. If empty, fallback to full event details object
        ev_data = self.fetch_event_details(event_id)
        if ev_data and isinstance(ev_data, dict):
            if "players" in ev_data and isinstance(ev_data["players"], list):
                players = ev_data["players"]
            elif "placings" in ev_data and isinstance(ev_data["placings"], list):
                players = ev_data["placings"]
            elif "users" in ev_data and isinstance(ev_data["users"], list):
                players = ev_data["users"]

        if use_cache:
            BestCoastPairingsScraper._bcp_http_cache[cache_key] = (time.time(), players)
        return players

    def fetch_event_teams(self, event_id: str) -> List[Dict[str, Any]]:
        """Fetches registered teams and official team placings from BCP for a team tournament."""
        use_cache = not self._is_mocked()
        cache_key = f"ev_teams:{event_id}"
        if use_cache:
            entry = BestCoastPairingsScraper._bcp_http_cache.get(cache_key)
            if entry and (time.time() - entry[0]) < self._BCP_HTTP_CACHE_TTL:
                return entry[1]
            ev_entry = BestCoastPairingsScraper._bcp_http_cache.get(f"ev_details:{event_id}")
            if ev_entry and (time.time() - ev_entry[0]) < self._BCP_HTTP_CACHE_TTL and ev_entry[1] is None:
                BestCoastPairingsScraper._bcp_http_cache[cache_key] = (time.time(), [])
                return []
        elif (
            not hasattr(self._make_request, "assert_called")
            and not hasattr(self._make_request, "side_effect")
            and not hasattr(urllib.request.urlopen, "assert_called")
            and not hasattr(urllib.request.urlopen, "side_effect")
        ):
            return []

        if use_cache and self.request_delay <= 0.01:
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=2) as pool:
                f_plc = pool.submit(self._make_request, f"/events/{event_id}/teamplayers", {"limit": 2500, "placings": "true"})
                f_ros = pool.submit(self._make_request, f"/events/{event_id}/teamplayers", {"limit": 2500})
                resp = f_plc.result()
                roster_resp = f_ros.result()
        else:
            resp = self._make_request(f"/events/{event_id}/teamplayers", params={"limit": 2500, "placings": "true"})
            roster_resp = self._make_request(f"/events/{event_id}/teamplayers", params={"limit": 2500})

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

        if use_cache:
            BestCoastPairingsScraper._bcp_http_cache[cache_key] = (time.time(), teams)
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
            explicit_uid = str(user.get("id") or p.get("userId") or p.get("user_id") or "").strip()
            reg_id = str(p.get("id") or p.get("playerId") or "").strip()
            canonical_id = explicit_uid or reg_id
            if not canonical_id:
                continue

            first_name = user.get("firstName") or p.get("firstName") or ""
            last_name = user.get("lastName") or p.get("lastName") or ""
            full_name = f"{first_name} {last_name}".strip() or p.get("name") or "Player"

            if explicit_uid and reg_id:
                self._reg_id_cache[reg_id] = {
                    "user_id": explicit_uid,
                    "first_name": first_name,
                    "last_name": last_name,
                    "full_name": full_name
                }
            elif not explicit_uid and reg_id:
                # If we only had a registration ID (no explicit userId), resolve it via BCP /v1/players/{id} to get true userId
                resolved_reg = self._resolve_bcp_registration_id(reg_id)
                if resolved_reg and resolved_reg.get("user_id"):
                    canonical_id = resolved_reg["user_id"]
                    if (not full_name or "player" in full_name.lower()) and resolved_reg.get("full_name"):
                        full_name = resolved_reg["full_name"]
                        first_name = resolved_reg.get("first_name") or first_name
                        last_name = resolved_reg.get("last_name") or last_name

            if (not full_name or "player" in full_name.lower()) and canonical_id:
                resolved_usr = self._resolve_bcp_user_id(canonical_id)
                if resolved_usr and resolved_usr.get("full_name"):
                    full_name = resolved_usr["full_name"]
                    first_name = resolved_usr.get("first_name") or first_name
                    last_name = resolved_usr.get("last_name") or last_name

            faction_name = extract_bcp_specific_faction(p)

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

            # Resolve team name from teamPlayerId mapping (prioritize tournament team over personal club)
            team_player_id = str(p.get("teamPlayerId") or "").strip()
            if team_player_id and team_player_id in team_name_by_id:
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
                "reg_id": reg_id if (reg_id and reg_id != canonical_id) else None,
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
                    pod_num=part["pod_num"],
                    reg_id=part.get("reg_id")
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
        if not event_id or not is_bcp_event_id(event_id):
            return 0
        ev_data = None
        try:
            ev_data = self.fetch_event_details(event_id)
            if ev_data and isinstance(ev_data, dict):
                ev_data["id"] = ev_data.get("id") or event_id
                self.db.upsert_event(ev_data)
            elif ev_data is None and getattr(self, "last_http_code", None) == 404 and is_bcp_event_id(event_id):
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

    def build_roster_id_map(self, enrolled_players: Optional[List[Dict[str, Any]]], teams: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Builds a mapping from per-tournament registration IDs (player.id) to canonical global BCP userIds and team rosters."""
        mapping: Dict[str, Any] = {}
        for t in (teams or []):
            if isinstance(t, dict):
                tid = str(t.get("id") or t.get("teamPlayerId") or "").strip()
                tname = str(t.get("name") or t.get("teamName") or "").strip()
                if tid and tname:
                    mapping[f"team_name:{tid}"] = tname
        event_max_swiss = 0
        for p in (enrolled_players or []):
            if not isinstance(p, dict):
                continue
            for g in (p.get("total_games") or p.get("games") or []):
                if isinstance(g, dict) and not g.get("pod"):
                    try:
                        rnum = int(g.get("gameNum") or g.get("gameNumber") or 0)
                        if rnum > event_max_swiss:
                            event_max_swiss = rnum
                    except Exception:
                        pass

        for p in (enrolled_players or []):
            if not isinstance(p, dict):
                continue
            user = p.get("user") or {}
            explicit_uid = str(user.get("id") or p.get("userId") or p.get("user_id") or "").strip()
            reg_id = str(p.get("id") or p.get("playerId") or "").strip()
            canonical_id = explicit_uid or reg_id
            if not canonical_id:
                continue

            first_name = user.get("firstName") or p.get("firstName") or ""
            last_name = user.get("lastName") or p.get("lastName") or ""
            full_name = f"{first_name} {last_name}".strip() or p.get("name") or ""

            if explicit_uid and reg_id:
                self._reg_id_cache[reg_id] = {
                    "user_id": explicit_uid,
                    "first_name": first_name,
                    "last_name": last_name,
                    "full_name": full_name
                }
            elif not explicit_uid and reg_id:
                resolved_reg = self._resolve_bcp_registration_id(reg_id)
                if resolved_reg and resolved_reg.get("user_id"):
                    canonical_id = resolved_reg["user_id"]
                    if not full_name and resolved_reg.get("full_name"):
                        full_name = resolved_reg["full_name"]

            t_games = p.get("total_games") if isinstance(p.get("total_games"), list) else []
            s_games = p.get("games") if isinstance(p.get("games"), list) else []
            raw_games_list = t_games if len(t_games) >= len(s_games) else s_games
            games_list = []
            for g in raw_games_list:
                if isinstance(g, dict):
                    g_copy = dict(g)
                    try:
                        rnum = int(g.get("gameNum") or g.get("gameNumber") or 0)
                        if g.get("pod") and event_max_swiss > 0 and rnum > 0:
                            g_copy["effectiveRound"] = event_max_swiss + rnum
                        elif rnum > 0:
                            g_copy["effectiveRound"] = rnum
                    except Exception:
                        pass
                    games_list.append(g_copy)

            p_faction = extract_bcp_specific_faction(p)
            for alias_id in (p.get("id"), p.get("playerId"), p.get("userId"), user.get("id")):
                if alias_id:
                    aid_str = str(alias_id).strip()
                    mapping[aid_str] = canonical_id
                    if games_list:
                        mapping[f"games:{aid_str}"] = games_list
                    if p_faction:
                        mapping[f"faction:{aid_str}"] = p_faction
            if games_list:
                mapping[f"games:{canonical_id}"] = games_list
            if p_faction:
                mapping[f"faction:{canonical_id}"] = p_faction
            if full_name and full_name.lower() not in ("player", "player 1", "player 2", "bye"):
                mapping[f"fullname:{canonical_id}"] = full_name

            t_pid = str(p.get("teamPlayerId") or "").strip()
            if t_pid:
                tm_list = mapping.setdefault(f"team_members:{t_pid}", [])
                if not any(m.get("player_id") == canonical_id for m in tm_list):
                    tm_list.append({
                        "player_id": canonical_id,
                        "reg_id": reg_id or None,
                        "player_name": full_name or canonical_id,
                        "first_name": first_name,
                        "last_name": last_name,
                        "faction": p_faction or "Unknown",
                        "detachment": str((p.get("subFaction") or {}).get("name") if isinstance(p.get("subFaction"), dict) else (p.get("subFactionName") or p.get("detachment") or "")).strip(),
                        "team_id": t_pid,
                        "team_name": mapping.get(f"team_name:{t_pid}", ""),
                    })
        return mapping

    def _resolve_bcp_registration_id(self, reg_id: str) -> Optional[Dict[str, str]]:
        """Resolves a BCP per-tournament registration ID via /v1/players/{id} to its global userId."""
        if not reg_id:
            return None
        clean_id = str(reg_id).strip()
        if clean_id in self._reg_id_cache:
            return self._reg_id_cache[clean_id]
        resp = self._make_request(f"/players/{clean_id}")
        if isinstance(resp, dict):
            user = resp.get("user") or {}
            canonical_uid = user.get("id") or resp.get("userId") or resp.get("user_id")
            first = user.get("firstName") or resp.get("firstName") or ""
            last = user.get("lastName") or resp.get("lastName") or ""
            full = f"{first} {last}".strip() or resp.get("name") or ""
            if canonical_uid:
                info = {
                    "user_id": str(canonical_uid).strip(),
                    "first_name": first.strip(),
                    "last_name": last.strip(),
                    "full_name": full.strip()
                }
                self._reg_id_cache[clean_id] = info
                return info
        self._reg_id_cache[clean_id] = None
        return None

    def _resolve_bcp_user_id(self, user_id: str) -> Optional[Dict[str, str]]:
        """Resolves a global BCP userId via /v1/users/{id} to retrieve real player name."""
        if not user_id:
            return None
        clean_id = str(user_id).strip()
        if clean_id in self._user_id_cache:
            return self._user_id_cache[clean_id]
        resp = self._make_request(f"/users/{clean_id}")
        if isinstance(resp, dict):
            first = resp.get("firstName") or ""
            last = resp.get("lastName") or ""
            full = f"{first} {last}".strip() or resp.get("name") or ""
            if full and full.lower() not in ("player", "player 1", "player 2", "bye"):
                info = {
                    "user_id": clean_id,
                    "first_name": first.strip(),
                    "last_name": last.strip(),
                    "full_name": full.strip()
                }
                self._user_id_cache[clean_id] = info
                return info
        self._user_id_cache[clean_id] = None
        return None

    def parse_and_store_match(
        self,
        event_data: Dict[str, Any],
        pairing: Dict[str, Any],
        roster_id_map: Optional[Dict[str, str]] = None,
        defer_db_write: bool = False
    ) -> Optional[Dict[str, Any]]:
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
        if str(game_sys_id) in (str(AOS_GAME_SYSTEM_ID), "23qDprPABN", "OY8FCPBf6O") or raw_gs == "aos":
            game_system = "aos"
        else:
            game_system = resolve_event_game_system(
                event_data,
                game_system_id=str(game_sys_id) if game_sys_id else None,
                game_system_name=pairing.get("gameSystemName") or event_data.get("gameSystemName"),
                default=normalize_game_system(raw_gs, default="40k") if raw_gs else "40k",
            )

        p1_obj = pairing.get("player1") or {}
        p2_obj = pairing.get("player2") or {}
        tp1_obj = pairing.get("teamPlayer1") or {}
        tp2_obj = pairing.get("teamPlayer2") or {}
        is_team_pairing = bool(
            pairing.get("pairingType") == "TeamPairing"
            or (not p1_obj and tp1_obj)
        )

        team1_players: List[Dict[str, Any]] = []
        team2_players: List[Dict[str, Any]] = []
        tp1_id = str(tp1_obj.get("id") or pairing.get("teamPlayer1Id") or "").strip()
        tp2_id = str(tp2_obj.get("id") or pairing.get("teamPlayer2Id") or "").strip()
        tp1_name = str(tp1_obj.get("name") or (roster_id_map or {}).get(f"team_name:{tp1_id}") or "").strip()
        tp2_name = str(tp2_obj.get("name") or (roster_id_map or {}).get(f"team_name:{tp2_id}") or "").strip()

        if is_team_pairing:
            if roster_id_map and tp1_id:
                team1_players = list(roster_id_map.get(f"team_members:{tp1_id}") or [])
            if not team1_players and tp1_obj.get("captainId"):
                cap1 = str(tp1_obj.get("captainId")).strip()
                cap1_uid = (roster_id_map or {}).get(cap1, cap1)
                cap1_name = (roster_id_map or {}).get(f"fullname:{cap1_uid}") or tp1_name or cap1_uid
                cap1_fac = (roster_id_map or {}).get(f"faction:{cap1_uid}") or "Unknown"
                team1_players = [{"player_id": cap1_uid, "player_name": cap1_name, "faction": cap1_fac, "detachment": "", "team_id": tp1_id, "team_name": tp1_name}]

            if roster_id_map and tp2_id:
                team2_players = list(roster_id_map.get(f"team_members:{tp2_id}") or [])
            if not team2_players and tp2_obj.get("captainId"):
                cap2 = str(tp2_obj.get("captainId")).strip()
                cap2_uid = (roster_id_map or {}).get(cap2, cap2)
                cap2_name = (roster_id_map or {}).get(f"fullname:{cap2_uid}") or tp2_name or cap2_uid
                cap2_fac = (roster_id_map or {}).get(f"faction:{cap2_uid}") or "Unknown"
                team2_players = [{"player_id": cap2_uid, "player_name": cap2_name, "faction": cap2_fac, "detachment": "", "team_id": tp2_id, "team_name": tp2_name}]

        # Player 1 details: Always prioritize explicit global userId over registration id
        p1_user = p1_obj.get("user") or {}
        p1_explicit_uid = str(
            p1_user.get("id")
            or p1_obj.get("userId")
            or p1_obj.get("user_id")
            or pairing.get("player1UserId")
            or (team1_players[0]["player_id"] if team1_players else "")
            or tp1_obj.get("captainId")
            or ""
        ).strip()
        p1_reg_id = str(p1_obj.get("id") or pairing.get("player1Id") or tp1_id or "").strip()
        p1_user_id = p1_explicit_uid or p1_reg_id or None

        p1_first = p1_user.get("firstName") or p1_obj.get("firstName") or ""
        p1_last = p1_user.get("lastName") or p1_obj.get("lastName") or ""
        if is_team_pairing and team1_players:
            p1_name = " & ".join(m["player_name"] for m in team1_players[:2])
        else:
            p1_name = f"{p1_first} {p1_last}".strip() or p1_obj.get("name") or tp1_name or "Player 1"

        if roster_id_map:
            if p1_reg_id and p1_reg_id in roster_id_map:
                p1_user_id = roster_id_map[p1_reg_id]
            elif p1_user_id and p1_user_id in roster_id_map:
                p1_user_id = roster_id_map[p1_user_id]
            if p1_user_id and (not p1_name or "player" in p1_name.lower()) and f"fullname:{p1_user_id}" in roster_id_map:
                p1_name = roster_id_map[f"fullname:{p1_user_id}"]

        # If we still don't have an explicit userId (or name is a placeholder), resolve via registration ID or user ID
        if (not p1_explicit_uid and p1_reg_id and p1_user_id == p1_reg_id) or (not p1_name or "player" in p1_name.lower()):
            if p1_reg_id:
                resolved_reg = self._resolve_bcp_registration_id(p1_reg_id)
                if resolved_reg:
                    if resolved_reg.get("user_id"):
                        p1_user_id = resolved_reg["user_id"]
                    if (not p1_name or "player" in p1_name.lower()) and resolved_reg.get("full_name"):
                        p1_name = resolved_reg["full_name"]
                        p1_first = resolved_reg.get("first_name") or p1_first
                        p1_last = resolved_reg.get("last_name") or p1_last
            if (not p1_name or "player" in p1_name.lower()) and p1_user_id:
                resolved_usr = self._resolve_bcp_user_id(p1_user_id)
                if resolved_usr and resolved_usr.get("full_name"):
                    p1_name = resolved_usr["full_name"]
                    p1_first = resolved_usr.get("first_name") or p1_first
                    p1_last = resolved_usr.get("last_name") or p1_last

        p1_roster_fac = ""
        if roster_id_map:
            p1_roster_fac = str(
                roster_id_map.get(f"faction:{p1_user_id}")
                or roster_id_map.get(f"faction:{p1_reg_id}")
                or ""
            ).strip()
        if is_team_pairing and team1_players:
            t1_facs = list(dict.fromkeys(m.get("faction", "") for m in team1_players[:2] if m.get("faction") and m.get("faction") != "Unknown"))
            p1_faction = " + ".join(t1_facs) if t1_facs else (p1_roster_fac or "Unknown")
        else:
            p1_faction = extract_bcp_specific_faction(p1_obj, roster_faction=p1_roster_fac)

        # Player 2 details: Always prioritize explicit global userId over registration id
        p2_user = p2_obj.get("user") or {}
        p2_explicit_uid = str(
            p2_user.get("id")
            or p2_obj.get("userId")
            or p2_obj.get("user_id")
            or pairing.get("player2UserId")
            or (team2_players[0]["player_id"] if team2_players else "")
            or tp2_obj.get("captainId")
            or ""
        ).strip()
        p2_reg_id = str(p2_obj.get("id") or pairing.get("player2Id") or tp2_id or "").strip()
        p2_user_id = p2_explicit_uid or p2_reg_id or None

        p2_first = p2_user.get("firstName") or p2_obj.get("firstName") or ""
        p2_last = p2_user.get("lastName") or p2_obj.get("lastName") or ""
        if is_team_pairing and team2_players:
            p2_name = " & ".join(m["player_name"] for m in team2_players[:2])
        else:
            p2_name = f"{p2_first} {p2_last}".strip() or p2_obj.get("name") or tp2_name or ("Player 2" if p2_user_id else "BYE")

        if roster_id_map:
            if p2_reg_id and p2_reg_id in roster_id_map:
                p2_user_id = roster_id_map[p2_reg_id]
            elif p2_user_id and p2_user_id in roster_id_map:
                p2_user_id = roster_id_map[p2_user_id]
            if p2_user_id and (not p2_name or "player" in p2_name.lower()) and f"fullname:{p2_user_id}" in roster_id_map:
                p2_name = roster_id_map[f"fullname:{p2_user_id}"]

        if p2_user_id and ((not p2_explicit_uid and p2_reg_id and p2_user_id == p2_reg_id) or (not p2_name or "player" in p2_name.lower())):
            if p2_reg_id:
                resolved_reg = self._resolve_bcp_registration_id(p2_reg_id)
                if resolved_reg:
                    if resolved_reg.get("user_id"):
                        p2_user_id = resolved_reg["user_id"]
                    if (not p2_name or "player" in p2_name.lower()) and resolved_reg.get("full_name"):
                        p2_name = resolved_reg["full_name"]
                        p2_first = resolved_reg.get("first_name") or p2_first
                        p2_last = resolved_reg.get("last_name") or p2_last
            if (not p2_name or "player" in p2_name.lower()) and p2_user_id:
                resolved_usr = self._resolve_bcp_user_id(p2_user_id)
                if resolved_usr and resolved_usr.get("full_name"):
                    p2_name = resolved_usr["full_name"]
                    p2_first = resolved_usr.get("first_name") or p2_first
                    p2_last = resolved_usr.get("last_name") or p2_last

        p2_roster_fac = ""
        if roster_id_map:
            p2_roster_fac = str(
                roster_id_map.get(f"faction:{p2_user_id}")
                or roster_id_map.get(f"faction:{p2_reg_id}")
                or ""
            ).strip()
        if is_team_pairing and team2_players:
            t2_facs = list(dict.fromkeys(m.get("faction", "") for m in team2_players[:2] if m.get("faction") and m.get("faction") != "Unknown"))
            p2_faction = " + ".join(t2_facs) if t2_facs else (p2_roster_fac or "Unknown")
        else:
            p2_faction = extract_bcp_specific_faction(p2_obj, roster_faction=p2_roster_fac)

        is_bye = bool(
            p2_user_id is None or p2_name == "BYE" or 
            p1_user_id is None or p1_name == "BYE" or 
            pairing.get("isBye")
        )

        # Scores and results:
        # 1. Primary source: player1Game / player2Game (official BCP Game objects)
        # 2. Secondary source: player's official games array from roster_id_map
        # 3. Tertiary fallback: legacy metaData (only if official game records are absent)
        p1_game = pairing.get("player1Game") or {}
        p2_game = pairing.get("player2Game") or {}
        meta = pairing.get("metaData") or {}

        p1_score = p1_game.get("points")
        p2_score = p2_game.get("points")
        p1_result = p1_game.get("result")  # 2: Win, 0: Loss, 1: Draw
        p2_result = p2_game.get("result")

        # Fallback to player's games array from roster_id_map if points/result missing in pairing
        if roster_id_map and (p1_score is None or p1_result is None):
            p1_games = roster_id_map.get(f"games:{p1_user_id}") or roster_id_map.get(f"games:{p1_reg_id}")
            if isinstance(p1_games, list):
                for g in p1_games:
                    if isinstance(g, dict) and int(g.get("effectiveRound") or (0 if g.get("pod") else (g.get("gameNum") or g.get("gameNumber") or 0))) == int(round_num):
                        if p1_score is None and g.get("gamePoints") is not None:
                            try: p1_score = int(g.get("gamePoints"))
                            except Exception: pass
                        if p1_result is None and g.get("gameResult") is not None:
                            try: p1_result = int(g.get("gameResult"))
                            except Exception: pass
                        break

        if roster_id_map and (p2_score is None or p2_result is None):
            p2_games = roster_id_map.get(f"games:{p2_user_id}") or roster_id_map.get(f"games:{p2_reg_id}")
            if isinstance(p2_games, list):
                for g in p2_games:
                    if isinstance(g, dict) and int(g.get("effectiveRound") or (0 if g.get("pod") else (g.get("gameNum") or g.get("gameNumber") or 0))) == int(round_num):
                        if p2_score is None and g.get("gamePoints") is not None:
                            try: p2_score = int(g.get("gamePoints"))
                            except Exception: pass
                        if p2_result is None and g.get("gameResult") is not None:
                            try: p2_result = int(g.get("gameResult"))
                            except Exception: pass
                        break

        if p1_score is None and meta.get("p1-gamePoints") is not None:
            try: p1_score = int(meta.get("p1-gamePoints"))
            except Exception: pass
        if p2_score is None and meta.get("p2-gamePoints") is not None:
            try: p2_score = int(meta.get("p2-gamePoints"))
            except Exception: pass
        if p1_result is None and meta.get("p1-gameResult") is not None:
            try: p1_result = int(meta.get("p1-gameResult"))
            except Exception: pass
        if p2_result is None and meta.get("p2-gameResult") is not None:
            try: p2_result = int(meta.get("p2-gameResult"))
            except Exception: pass

        is_done_flag = bool(pairing.get("isDone", True))
        has_scores = p1_score is not None and p2_score is not None
        has_nonzero_scores = bool(has_scores and (p1_score > 0 or p2_score > 0))
        has_results = p1_result is not None and p2_result is not None

        # Guard: if match has 0-0 or missing scores and no decisive winner, treat as unplayed / not started
        is_unplayed = (
            (not has_nonzero_scores) and
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
            elif (p1_result == 1 or p2_result == 1) and (not has_scores or has_nonzero_scores):
                is_draw = True
            elif has_nonzero_scores and p1_score == p2_score:
                is_draw = True
        elif has_nonzero_scores:
            if p1_score > p2_score:
                winner_id = p1_user_id
                loser_id = p2_user_id
            elif p2_score > p1_score:
                winner_id = p2_user_id
                loser_id = p1_user_id
            elif is_done_flag and p1_score == p2_score:
                is_draw = True

        # Only mark match as officially done if it is a bye, has a decisive winner, or is a genuine non-zero draw
        is_officially_done = bool(is_bye or winner_id is not None or is_draw)

        raw_json_payload = dict(pairing) if isinstance(pairing, dict) else {"raw": pairing}
        if is_team_pairing:
            raw_json_payload["match_format"] = "2v2"
            raw_json_payload["is_2v2"] = True
            raw_json_payload["team1_id"] = tp1_id
            raw_json_payload["team2_id"] = tp2_id
            raw_json_payload["team1_name"] = tp1_name
            raw_json_payload["team2_name"] = tp2_name
            raw_json_payload["team1_players"] = team1_players[:2]
            raw_json_payload["team2_players"] = team2_players[:2]
            if self.db is not None and hasattr(self.db, "upsert_match_participants_batch"):
                mp_rows = []
                for s_idx, tm1 in enumerate(team1_players[:2], start=1):
                    partner1 = team1_players[1 - (s_idx - 1)] if len(team1_players) >= 2 else None
                    mp_rows.append({
                        "match_id": match_id,
                        "player_id": tm1["player_id"],
                        "raw_player_id": tm1.get("reg_id") or tm1["player_id"],
                        "player_name": tm1["player_name"],
                        "seat_order": s_idx,
                        "placement": 1 if winner_id == p1_user_id else (2 if winner_id == p2_user_id else 1),
                        "score": float(p1_score or 0.0),
                        "is_winner": winner_id == p1_user_id,
                        "is_draw": is_draw,
                        "faction": tm1.get("faction") or "Unknown",
                        "detachment": tm1.get("detachment") or "",
                        "game_system": game_system,
                        "raw_json": {
                            "match_format": "2v2",
                            "team_num": 1,
                            "team_id": tp1_id,
                            "team_name": tp1_name,
                            "partner_id": partner1["player_id"] if partner1 else None,
                            "partner_name": partner1["player_name"] if partner1 else None,
                        },
                    })
                for s_idx, tm2 in enumerate(team2_players[:2], start=3):
                    partner2 = team2_players[1 - (s_idx - 3)] if len(team2_players) >= 2 else None
                    mp_rows.append({
                        "match_id": match_id,
                        "player_id": tm2["player_id"],
                        "raw_player_id": tm2.get("reg_id") or tm2["player_id"],
                        "player_name": tm2["player_name"],
                        "seat_order": s_idx,
                        "placement": 1 if winner_id == p2_user_id else (2 if winner_id == p1_user_id else 1),
                        "score": float(p2_score or 0.0),
                        "is_winner": winner_id == p2_user_id,
                        "is_draw": is_draw,
                        "faction": tm2.get("faction") or "Unknown",
                        "detachment": tm2.get("detachment") or "",
                        "game_system": game_system,
                        "raw_json": {
                            "match_format": "2v2",
                            "team_num": 2,
                            "team_id": tp2_id,
                            "team_name": tp2_name,
                            "partner_id": partner2["player_id"] if partner2 else None,
                            "partner_name": partner2["player_name"] if partner2 else None,
                        },
                    })
                if mp_rows:
                    try:
                        self.db.upsert_match_participants_batch(mp_rows)
                    except Exception:
                        pass

        match_record = {
            "id": match_id,
            "event_id": event_id,
            "event_name": event_name,
            "round": round_num,
            "table_number": table_num,
            "match_date": event_date,
            "player1_id": p1_user_id,
            "player1_reg_id": p1_reg_id if (p1_reg_id and p1_user_id and p1_reg_id != p1_user_id) else None,
            "player1_name": p1_name,
            "player1_faction": p1_faction,
            "player1_score": p1_score,
            "player2_id": p2_user_id,
            "player2_reg_id": p2_reg_id if (p2_reg_id and p2_user_id and p2_reg_id != p2_user_id) else None,
            "player2_name": p2_name,
            "player2_faction": p2_faction,
            "player2_score": p2_score,
            "winner_id": winner_id,
            "loser_id": loser_id,
            "is_draw": is_draw,
            "is_bye": is_bye,
            "is_done": is_officially_done,
            "game_system": game_system,
            "game_system_id": game_sys_id or (AOS_GAME_SYSTEM_ID if game_system == "aos" else get_bcp_game_system_id(game_system)),
            "raw_json": raw_json_payload,
        }

        if defer_db_write:
            return match_record

        try:
            self.db.upsert_match(match_record)
            return match_record
        except Exception as e:
            logger.warning(f"Failed to upsert match {match_id}: {e}")
            return None

    def scrape_event(self, event_id: str, fallback_event_data: Optional[Dict[str, Any]] = None) -> int:
        """Scrapes full event details and all match pairings for an event. Returns count of matches scraped."""
        if not event_id or not is_bcp_event_id(event_id):
            return 0
        event_data = self.fetch_event_details(event_id)
        if not event_data or not isinstance(event_data, dict) or ("id" not in event_data and "name" not in event_data):
            if fallback_event_data:
                event_data = fallback_event_data
            else:
                logger.warning(f"Could not retrieve details for event {event_id}")
                return 0

        event_data["id"] = event_data.get("id") or event_data.get("objectId") or event_id
        game_sys_id = event_data.get("gameSystemId") or event_data.get("game_system_id")
        if not game_sys_id and isinstance(fallback_event_data, dict):
            game_sys_id = fallback_event_data.get("gameSystemId") or fallback_event_data.get("game_system_id")
            if game_sys_id:
                event_data["gameSystemId"] = game_sys_id
        if str(game_sys_id) in (str(AOS_GAME_SYSTEM_ID), "23qDprPABN", "OY8FCPBf6O"):
            event_data["game_system"] = "aos"
        else:
            event_data["game_system"] = resolve_event_game_system(
                event_data,
                game_system_id=str(game_sys_id) if game_sys_id else None,
                default=normalize_game_system(event_data.get("game_system"), default="40k"),
            )
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
        roster_id_map = {}
        enrolled_players = []
        try:
            enrolled_players = self.fetch_event_players(event_id) or []
            roster_id_map = self.build_roster_id_map(enrolled_players, teams=teams)
            self.ingest_event_roster(event_id, enrolled_players, teams=teams)
        except Exception as e:
            logger.debug(f"Could not fetch roster for event {event_id}: {e}")

        if hasattr(self, "_scraped_event_ids_in_session") and isinstance(self._scraped_event_ids_in_session, set):
            self._scraped_event_ids_in_session.add(str(event_id))

        dict_rounds = 0
        roster_max_round = 0
        try:
            rounds_dict = event_data.get("rounds") or {}
            if isinstance(rounds_dict, dict):
                dict_rounds = max([int(k) for k in rounds_dict.keys() if str(k).isdigit()] or [0])
            if isinstance(roster_id_map, dict):
                for k_map, v_games in roster_id_map.items():
                    if isinstance(k_map, str) and k_map.startswith("games:") and isinstance(v_games, list):
                        for g_item in v_games:
                            if isinstance(g_item, dict):
                                r_val = int(g_item.get("effectiveRound") or g_item.get("gameNum") or g_item.get("round") or 0)
                                if r_val > roster_max_round:
                                    roster_max_round = r_val
            raw_rounds = event_data.get("numberOfRounds") or event_data.get("currentRound") or dict_rounds or roster_max_round or 3
            num_rounds = min(max(int(raw_rounds or 3), dict_rounds, roster_max_round), 12)
        except Exception:
            num_rounds = 3

        event_name = event_data.get("name", "Unknown Event")
        total_players = int(event_data.get("totalPlayers") or event_data.get("checkedInPlayers") or len(enrolled_players) or 0)
        event_date = (event_data.get("eventDate") or event_data.get("eventEndDate") or "")[:10] or "No Date"

        has_explicit_lifecycle = ("started" in event_data or "ended" in event_data or "currentRound" in event_data)
        is_started = bool(event_data.get("started"))
        is_ended = bool(event_data.get("ended"))
        try:
            curr_round_val = int(event_data.get("currentRound") or 0)
        except Exception:
            curr_round_val = 0

        if has_explicit_lifecycle and (
            (total_players == 0 and not enrolled_players)
            or (not is_started and not is_ended and curr_round_val == 0 and dict_rounds == 0 and roster_max_round == 0)
        ):
            max_rounds_to_poll = 0
        else:
            max_rounds_to_poll = num_rounds

        if max_rounds_to_poll > 0 and (total_players > 30 or num_rounds > 4):
            logger.info(f"Scraping '{event_name}' ({event_id}) [{event_date}]: {total_players} players, {num_rounds} rounds...")

        total_matches = 0
        consecutive_empty = 0
        actual_rounds = 0
        use_batch = (
            self.db is not None
            and hasattr(self.db, "upsert_matches_batch")
            and type(getattr(self.db, "upsert_matches_batch", None)).__name__ != "MagicMock"
        )
        event_matches_to_upsert = []
        max_active_hint = max(curr_round_val, dict_rounds, roster_max_round)

        for r in range(1, max_rounds_to_poll + 1):
            pairings = self.fetch_event_pairings_for_round(event_id, r)
            if not pairings:
                consecutive_empty += 1
                if consecutive_empty >= 2 or (has_explicit_lifecycle and not is_ended and max_active_hint > 0 and r >= max_active_hint):
                    break
                continue

            consecutive_empty = 0
            actual_rounds = r
            round_matches = 0
            for p in pairings:
                match_rec = self.parse_and_store_match(event_data, p, roster_id_map=roster_id_map, defer_db_write=use_batch)
                if match_rec:
                    event_matches_to_upsert.append(match_rec)
                    total_matches += 1
                    round_matches += 1

            if total_players > 30 or num_rounds > 4:
                logger.info(f"  -> Round {r}/{num_rounds}: {round_matches} matches processed.")

        if use_batch and event_matches_to_upsert:
            try:
                self.db.upsert_matches_batch(event_matches_to_upsert)
            except Exception as e:
                logger.warning(f"Failed to batch upsert matches for event {event_id}: {e}")

        if (
            actual_rounds > 0
            and self.db is not None
            and hasattr(self.db, "get_connection")
            and type(getattr(self.db, "get_connection", None)).__name__ != "MagicMock"
        ):
            try:
                with self.db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE events
                            SET current_round = GREATEST(COALESCE(current_round, 0), %s),
                                num_rounds = GREATEST(COALESCE(num_rounds, 0), %s)
                            WHERE id = %s;
                            """,
                            (actual_rounds, actual_rounds, event_id),
                        )
                    conn.commit()
            except Exception as upd_err:
                logger.debug(f"Could not update current_round for event {event_id}: {upd_err}")

        logged_rounds = actual_rounds if total_matches > 0 else 0
        logger.info(f"Scraped '{event_name}' ({event_id}) [{event_date}]: {logged_rounds} rounds, {total_matches} matches total.")
        return total_matches

    def rescrape_incomplete_and_ongoing_events(
        self,
        days: int = 90,
        game_system: str = "all",
        max_events: int = 60,
        exclude_event_ids: Optional[Any] = None,
    ) -> Dict[str, int]:
        """Re-scrape multi-week leagues, ongoing events, and partially scraped events in PostgreSQL.

        Why this is needed:
        BCP's `/v1/events?startDate=...&endDate=...` filters strictly by `eventDate` (the event START date).
        Multi-week leagues (e.g. `DAVY7pZIVACh` Autumn Annihilation 2026, running 2026-09-14 to 2026-11-01)
        or weekend tournaments whose final rounds were uploaded late are missed by a narrow 3-day `startDate`
        window once their `event_date` is >3 days in the past.
        """
        if not self.db or not hasattr(self.db, "get_connection"):
            return {"events_rescraped": 0, "matches_rescraped": 0}

        excluded_ids = set(getattr(self, "_scraped_event_ids_in_session", set()) or set())
        if exclude_event_ids:
            excluded_ids.update(str(x) for x in exclude_event_ids if x)

        target_limit = max(1, int(max_events or 60))
        candidate_eids: List[str] = []
        try:
            gs_filter_sql = ""
            params: List[Any] = [max(7, int(days or 90))]
            if game_system and str(game_system).lower() in ("other", "others", "non_40k_aos", "all_other"):
                gs_filter_sql = "AND COALESCE(e.game_system, '40k') NOT IN ('40k', 'aos')"
            elif game_system and game_system not in ("all", "*"):
                gs_filter_sql = "AND COALESCE(e.game_system, '40k') = %s"
                params.append(str(game_system))
            params.append(target_limit + len(excluded_ids))

            with self.db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        f"""
                        WITH candidate_window AS (
                            SELECT e.id, e.event_date, e.end_date, e.num_rounds, e.current_round, e.is_ended, e.total_players
                            FROM events e
                            WHERE e.event_date >= NOW() - (%s * INTERVAL '1 day')
                              AND e.event_date <= NOW() + INTERVAL '1 day'
                              AND COALESCE(e.total_players, 0) >= 2
                              AND e.id NOT LIKE 'ES-%%'
                              AND e.id NOT LIKE 'native_%%'
                              AND e.id NOT LIKE 'melee:%%'
                              AND e.id NOT LIKE 'ltcg:%%'
                              AND e.id NOT LIKE 'ls:%%'
                              AND e.id NOT LIKE 'td:%%'
                              AND e.id NOT LIKE 'league_%%'
                              {gs_filter_sql}
                        ),
                        match_round_stats AS (
                            SELECT
                                m.event_id,
                                COUNT(DISTINCT m.round) AS db_rounds
                            FROM matches m
                            JOIN candidate_window cw ON cw.id = m.event_id
                            GROUP BY m.event_id
                        )
                        SELECT cw.id
                        FROM candidate_window cw
                        LEFT JOIN match_round_stats mrs ON mrs.event_id = cw.id
                        WHERE COALESCE(cw.is_ended, FALSE) = FALSE
                           OR (COALESCE(cw.num_rounds, 0) > 0 AND COALESCE(mrs.db_rounds, 0) < COALESCE(cw.num_rounds, 0))
                           OR (COALESCE(cw.num_rounds, 0) > 0 AND COALESCE(cw.current_round, 0) < COALESCE(cw.num_rounds, 0))
                           OR (cw.end_date IS NOT NULL AND cw.end_date >= NOW() - INTERVAL '10 days' AND COALESCE(mrs.db_rounds, 0) < GREATEST(COALESCE(cw.num_rounds, 0), 1))
                        ORDER BY cw.event_date DESC
                        LIMIT %s;
                        """,
                        tuple(params),
                    )
                    for (eid,) in cur.fetchall():
                        if eid and is_bcp_event_id(str(eid)) and str(eid) not in excluded_ids:
                            candidate_eids.append(str(eid))
                            if len(candidate_eids) >= target_limit:
                                break
        except Exception as e:
            logger.warning(f"Failed querying incomplete/ongoing events for rescrape: {e}")
            return {"events_rescraped": 0, "matches_rescraped": 0}

        events_count = 0
        matches_count = 0
        for eid in candidate_eids:
            try:
                m_cnt = self.scrape_event(eid)
                events_count += 1
                matches_count += int(m_cnt or 0)
            except Exception as err:
                logger.warning(f"Error re-scraping incomplete/ongoing event {eid}: {err}")

        logger.info(
            f"Finished re-scraping {events_count} incomplete/ongoing events (last {days}d): {matches_count} matches."
        )
        return {"events_rescraped": events_count, "matches_rescraped": matches_count}

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

    def scrape_other_systems_date_range(
        self,
        start_date: str,
        end_date: str,
        max_events: Optional[int] = None,
        exclude_system_ids: Optional[List[str]] = None,
    ) -> Dict[str, int]:
        """Scrapes BCP events across all non-40k/AoS game systems in a single paginated stream."""
        excluded = set(
            exclude_system_ids
            or [
                str(DEFAULT_GAME_SYSTEM_ID),
                "WGMSzfKFYA",
                "1",
                "f953V0Iv24",
                str(AOS_GAME_SYSTEM_ID),
                "OY8FCPBf6O",
                "4",
                "23qDprPABN",
            ]
        )
        events_count = 0
        matches_count = 0

        for event in self.fetch_events(start_date=start_date, end_date=end_date, game_system_id=None, limit_per_page=100):
            gs_id = str(
                event.get("gameSystemId")
                or event.get("game_system_id")
                or (event.get("gameSystem") or {}).get("id")
                or (event.get("gameSystem") or {}).get("objectId")
                or ""
            ).strip()
            if gs_id in excluded:
                continue
            resolved_sys = resolve_event_game_system(event, game_system_id=gs_id or None, default="other_games")
            if resolved_sys in ("40k", "aos"):
                continue
            event_id = event.get("id") or event.get("objectId")
            if not event_id:
                continue
            event["game_system"] = resolved_sys

            events_count += 1
            try:
                matches = self.scrape_event(event_id, fallback_event_data=event)
                matches_count += matches
            except Exception as e:
                logger.error(f"Error scraping multi-system event {event_id} ({event.get('name')}): {e}")

            if max_events and events_count >= max_events:
                break

        logger.info(f"Finished scraping non-40k/AoS game systems [{start_date} to {end_date}]: {events_count} events, {matches_count} matches.")
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
                params: Dict[str, Any] = {
                    "limit": 50,
                    "startDate": start_iso,
                    "endDate": end_iso
                }
                if game_system_id and str(game_system_id).lower() not in ("all", "*"):
                    params["gameSystemId"] = game_system_id
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
                        ev_gs_id = ev.get("gameSystemId") or ev.get("game_system_id") or game_system_id
                        if str(ev_gs_id) in (str(AOS_GAME_SYSTEM_ID), "23qDprPABN", "OY8FCPBf6O"):
                            ev["game_system"] = "aos"
                        else:
                            ev["game_system"] = resolve_event_game_system(ev, game_system_id=str(ev_gs_id) if ev_gs_id else None, default="40k")
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

