"""Scraper module for Best Coast Pairings Warhammer 40k tournaments, pairings, and matches."""

import json
import logging
import time
from typing import Any, Dict, Generator, List, Optional
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

try:
    from google3.experimental.users.hsiehjun.EloRanking.config import BCP_API_BASE, DEFAULT_HEADERS, DEFAULT_GAME_SYSTEM_ID
    from google3.experimental.users.hsiehjun.EloRanking.database import Database
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.config import BCP_API_BASE, DEFAULT_HEADERS, DEFAULT_GAME_SYSTEM_ID
        from experimental.users.hsiehjun.EloRanking.database import Database
    except ImportError:
        from config import BCP_API_BASE, DEFAULT_HEADERS, DEFAULT_GAME_SYSTEM_ID
        from database import Database, get_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("BCPScraper")


class BestCoastPairingsScraper:
    """Scrapes tournaments, player rosters, and round-by-round pairings from Best Coast Pairings."""

    def __init__(self, db: Optional[Database] = None, request_delay: float = 0.5):
        self.db = db or get_db()
        self.headers = DEFAULT_HEADERS.copy()
        self.request_delay = request_delay

    def _make_request(self, endpoint: str, params: Optional[Dict[str, Any]] = None, max_retries: int = 5) -> Optional[Dict[str, Any]]:
        """Makes an HTTP GET request to BCP API with headers, error handling, and retries."""
        query_str = f"?{urllib.parse.urlencode(params)}" if params else ""
        url = f"{BCP_API_BASE}{endpoint}{query_str}"

        for attempt in range(1, max_retries + 1):
            try:
                time.sleep(self.request_delay)
                req = urllib.request.Request(url, headers=self.headers)
                with urllib.request.urlopen(req, timeout=35) as response:
                    content = response.read().decode("utf-8")
                    return json.loads(content)
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="ignore")
                logger.warning(f"HTTP {e.code} on {endpoint} (Attempt {attempt}/{max_retries}): {body[:150]}")
                if e.code == 429:
                    sleep_time = attempt * 4.0
                    logger.info(f"Rate limited. Backing off for {sleep_time:.1f}s...")
                    time.sleep(sleep_time)
                elif e.code in (404, 409):
                    return None
                else:
                    time.sleep(attempt * 1.5)
            except Exception as e:
                sleep_time = attempt * 2.0
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

    def fetch_event_pairings_for_round(self, event_id: str, round_num: int) -> List[Dict[str, Any]]:
        """Fetches all pairings for a specific round of an event."""
        resp = self._make_request(f"/events/{event_id}/pairings", params={
            "round": round_num,
            "pairingType": "Pairing"
        })
        if not resp:
            return []
        
        # BCP returns pairings in {"active": [...], "deleted": [...]} or {"data": [...]}
        if isinstance(resp, dict):
            if "active" in resp and isinstance(resp["active"], list):
                return resp["active"]
            if "data" in resp and isinstance(resp["data"], list):
                return resp["data"]
        elif isinstance(resp, list):
            return resp
        return []

    def fetch_event_players(self, event_id: str) -> List[Dict[str, Any]]:
        """Fetches registered player roster and official placings for an event from BCP."""
        # 1. Try /events/{event_id}/placings first (contains official BCP tournament standings)
        resp_placings = self._make_request(f"/events/{event_id}/placings", params={"limit": 300})
        players = []
        if resp_placings:
            if isinstance(resp_placings, dict):
                if "data" in resp_placings and isinstance(resp_placings["data"], list):
                    players = resp_placings["data"]
                elif "active" in resp_placings and isinstance(resp_placings["active"], list):
                    players = resp_placings["active"]
                elif "placings" in resp_placings and isinstance(resp_placings["placings"], list):
                    players = resp_placings["placings"]
            elif isinstance(resp_placings, list):
                players = resp_placings

        # 2. If empty, try /events/{event_id}/players
        if not players:
            resp = self._make_request(f"/events/{event_id}/players", params={"limit": 300})
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

        # 3. If still empty, check full event details object
        if not players:
            ev_data = self.fetch_event_details(event_id)
            if ev_data and isinstance(ev_data, dict):
                if "placings" in ev_data and isinstance(ev_data["placings"], list):
                    players = ev_data["placings"]
                elif "players" in ev_data and isinstance(ev_data["players"], list):
                    players = ev_data["players"]
                elif "users" in ev_data and isinstance(ev_data["users"], list):
                    players = ev_data["users"]

        return players

    def parse_and_store_match(self, event_data: Dict[str, Any], pairing: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Extracts structured match details and stores both players and match outcome in DB."""
        match_id = pairing.get("id")
        if not match_id:
            return None

        event_id = event_data.get("id") or event_data.get("objectId") or pairing.get("eventId")
        if not event_id:
            return None

        event_date = event_data.get("eventDate")
        event_name = event_data.get("name", "Tournament")
        round_num = pairing.get("round", 1)
        table_num = pairing.get("table", 1)

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

        is_bye = bool(p2_user_id is None or p2_name == "BYE" or pairing.get("isBye"))

        # Scores and results
        p1_game = pairing.get("player1Game") or {}
        p2_game = pairing.get("player2Game") or {}

        p1_score = p1_game.get("points")
        p2_score = p2_game.get("points")

        p1_result = p1_game.get("result")  # 2: Win, 0: Loss, 1: Draw
        p2_result = p2_game.get("result")

        winner_id = None
        loser_id = None
        is_draw = False

        if is_bye:
            winner_id = p1_user_id
            loser_id = None
        elif p1_result is not None and p2_result is not None:
            if p1_result == 2 and p2_result == 0:
                winner_id = p1_user_id
                loser_id = p2_user_id
            elif p2_result == 2 and p1_result == 0:
                winner_id = p2_user_id
                loser_id = p1_user_id
            elif p1_result == 1 or p2_result == 1 or p1_result == p2_result:
                is_draw = True
        elif p1_score is not None and p2_score is not None:
            if p1_score > p2_score:
                winner_id = p1_user_id
                loser_id = p2_user_id
            elif p2_score > p1_score:
                winner_id = p2_user_id
                loser_id = p1_user_id
            else:
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
        self.db.upsert_event(event_data)

        # Ingest registered participants roster (works even if 0 rounds played yet)
        try:
            enrolled_players = self.fetch_event_players(event_id)
            for p in enrolled_players:
                user = p.get("user") or {}
                user_id = user.get("id") or p.get("userId") or p.get("id")
                if not user_id:
                    continue
                first_name = user.get("firstName") or p.get("firstName") or ""
                last_name = user.get("lastName") or p.get("lastName") or ""
                full_name = f"{first_name} {last_name}".strip() or p.get("name") or "Player"

                faction_obj = p.get("faction") or p.get("parentFaction") or ""
                faction_name = ""
                if isinstance(faction_obj, dict):
                    faction_name = faction_obj.get("name", "")
                elif isinstance(faction_obj, str):
                    faction_name = faction_obj

                # Extract team or gaming club
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

                raw_place = p.get("placing") or p.get("place") or p.get("rank") or p.get("placement") or p.get("ranking")
                placing_num = None
                if raw_place is not None:
                    try:
                        placing_num = int(raw_place)
                    except (ValueError, TypeError):
                        pass

                raw_pts = p.get("points") or p.get("battlePoints") or p.get("totalPoints")
                pts_num = None
                if raw_pts is not None:
                    try:
                        pts_num = int(raw_pts)
                    except (ValueError, TypeError):
                        pass

                self.db.upsert_player(user_id, first_name, last_name, full_name, team=team_name)
                self.db.upsert_event_participant(
                    event_id=event_id,
                    player_id=user_id,
                    first_name=first_name,
                    last_name=last_name,
                    full_name=full_name,
                    faction=faction_name,
                    team=team_name,
                    dropped=bool(p.get("dropped")),
                    checked_in=bool(p.get("checkedIn")),
                    placement=placing_num,
                    battle_points=pts_num
                )
        except Exception as e:
            logger.debug(f"Could not fetch roster for event {event_id}: {e}")

        try:
            raw_rounds = event_data.get("numberOfRounds") or event_data.get("currentRound") or 3
            num_rounds = min(max(1, int(raw_rounds)), 12)
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
        max_events: Optional[int] = None
    ) -> Dict[str, int]:
        """Scrapes all Warhammer 40k events in a given date range and stores their full match histories."""
        events_count = 0
        matches_count = 0

        for event in self.fetch_events(start_date=start_date, end_date=end_date, max_events=max_events):
            event_id = event.get("id") or event.get("objectId")
            if not event_id:
                continue

            events_count += 1
            try:
                matches = self.scrape_event(event_id, fallback_event_data=event)
                matches_count += matches
            except Exception as e:
                logger.error(f"Error scraping event {event_id} ({event.get('name')}): {e}")

        logger.info(f"Finished scraping date range [{start_date} to {end_date}]: {events_count} events, {matches_count} matches.")
        return {"events_scraped": events_count, "matches_scraped": matches_count}

    def sync_upcoming_events(self, max_pages: int = 25) -> int:
        """Fetches live future upcoming tournaments from Best Coast Pairings API and caches them."""
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00.000Z")
        one_year_iso = datetime.fromtimestamp(time.time() + 365 * 86400, tz=timezone.utc).strftime("%Y-%m-%dT23:59:59.999Z")
        
        total_synced = 0
        next_key = None

        for _ in range(max_pages):
            params = {
                "limit": 50,
                "gameSystemId": DEFAULT_GAME_SYSTEM_ID,
                "startDate": now_iso,
                "endDate": one_year_iso
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
                self.db.upsert_event(ev)
                total_synced += 1

            next_key = resp.get("nextKey")
            if not next_key:
                break

        logger.info(f"Successfully synced {total_synced} live upcoming events from BCP API.")
        return total_synced

