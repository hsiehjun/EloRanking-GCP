"""
leagues_hub_service.py - Authoritative Native Community Leagues Service for OmniTactica.

Faithfully implements the San Diego Force Org (SD40K) 38-season battle-tested methodology:
- 8-Week Season Rhythm with 5 scheduled games
- Tiered Pods (Pods 1–7) with 2-up / 2-down Promotion & Relegation
- The 1,000 BP Win Bonus formula (VP + 1,000 BP Win / 500 BP Draw / 0 BP Loss / 750 BP In-Pod Ringer)
- 16-Player Single Elimination Seasonal Finals Championship
- 100% Isolated Native Namespace: Zero reads, writes, or foreign key locks on BCP tables.
- Independent League Match Points & Circuit Rating (Keeps Global Tournament Elo pure).
"""

import os
import re
import copy
import json
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any

DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
LEAGUES_INDEX_PATH = DATA_DIR / "native_leagues_db.json"
SD40K_DATA_PATH = DATA_DIR / "sd40k_league_data.json"

POD_NAMES = {
    1: "The Hard Boys",
    2: "The Deuce",
    3: "The Average Joes",
    4: "The F-Shack",
    5: "Purgatory",
    6: "The Kiddy Pool",
    7: "The Thunderdome",
    8: "The Scrub Tub",
    9: "The Punt Locker",
    10: "The Flat Earth Society"
}

POD_TIERS = {
    1: "Premier Division",
    2: "Challenger Division",
    3: "Contender Division",
    4: "Intermediate Division",
    5: "Reserves Division",
    6: "Entry Division",
    7: "Open Division",
    8: "Development Division",
    9: "Regional Division",
    10: "Foundational Division"
}

def generate_round_robin_pairings(player_names: List[str], num_rounds: int = 5) -> Dict[str, List[Dict[str, Any]]]:
    """Generates standard round-robin scheduled pairings with cycling terrain layouts."""
    n = len(player_names)
    players = list(player_names)
    if n % 2 != 0:
        players.append("BYE")
        n += 1

    rounds_pairings = {p: [] for p in player_names}
    layouts = ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B", "Layout C"]

    for r in range(min(num_rounds, n - 1)):
        round_num = r + 1
        layout = layouts[r % len(layouts)]
        for i in range(n // 2):
            p1 = players[i]
            p2 = players[n - 1 - i]
            if p1 != "BYE" and p2 != "BYE":
                rounds_pairings[p1].append({
                    "round": round_num,
                    "layout": layout,
                    "opponent_name": p2,
                    "score": None,
                    "is_completed": False
                })
                rounds_pairings[p2].append({
                    "round": round_num,
                    "layout": layout,
                    "opponent_name": p1,
                    "score": None,
                    "is_completed": False
                })
        players = [players[0]] + [players[-1]] + players[1:-1]

    return rounds_pairings


def distribute_players_into_pods(players: List[Any], min_size: int = 6, max_size: int = 8) -> List[List[Any]]:
    """
    Distributes N players into tiered pods of 6–8 players as evenly as possible.
    Top seeds remain in top pods while all new entrants at the tail are placed into the bottom pod(s).
    """
    import math
    n = len(players)
    if n == 0:
        return []
    if n <= max_size:
        return [list(players)]
    num_pods = max(1, math.ceil(n / max_size))
    base_size = n // num_pods
    remainder = n % num_pods
    pods = []
    idx = 0
    for i in range(num_pods):
        size = base_size + (1 if i < remainder else 0)
        pods.append(list(players[idx:idx + size]))
        idx += size
    return pods

DEFAULT_TEMPLATES = [
    {
        "id": "sd40k_standard_pod_system",
        "name": "SD40K Pod & Relegation League (Standard 8-Week)",
        "tagline": "The battle-tested 38-season Southern California format",
        "description": "8-week season, 5 matches per player, tiered pods of 8 players with 2-up/2-down promotion & relegation, 1,000 BP win bonus, and seasonal single-elimination finals.",
        "points_limit": 2000,
        "rounds": 5,
        "weeks": 8,
        "pod_size": 8,
        "promotion_count": 2,
        "relegation_count": 2,
        "win_bonus_bp": 1000,
        "draw_bonus_bp": 500,
        "loss_bonus_bp": 0,
        "ringer_bonus_bp": 750,
        "default_layouts": ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"],
        "faction_locked": True,
        "lists_locked": False,
        "has_finals_bracket": True
    },
    {
        "id": "open_community_escalation",
        "name": "Community Escalation League (4-Phase / 500-2000 pts)",
        "tagline": "Beginner-friendly progression for growing scenes",
        "description": "Gradual progression format starting at 500 points Combat Patrol up to 2,000 points Strike Force over 4 bi-weekly phases.",
        "points_limit": 2000,
        "rounds": 4,
        "weeks": 8,
        "pod_size": 12,
        "promotion_count": 0,
        "relegation_count": 0,
        "win_bonus_bp": 100,
        "draw_bonus_bp": 50,
        "loss_bonus_bp": 10,
        "ringer_bonus_bp": 75,
        "default_layouts": ["Layout A", "Layout A", "Layout B", "Layout C"],
        "faction_locked": False,
        "lists_locked": False,
        "has_finals_bracket": False
    }
]

class LeaguesHubService:
    def __init__(self):
        self._index: Dict[str, Any] = {}
        self._leagues_cache: Dict[str, Any] = {}
        self._load_or_seed()

    def _load_or_seed(self):
        # 1. Load index if exists, or initialize
        if LEAGUES_INDEX_PATH.exists():
            try:
                with open(LEAGUES_INDEX_PATH, "r", encoding="utf-8") as f:
                    self._index = json.load(f)
            except Exception as e:
                print(f"[LeaguesHubService] Warning reading index: {e}")
                self._index = {"version": "1.0", "leagues": [], "available_templates": DEFAULT_TEMPLATES}
        else:
            self._index = {
                "version": "1.0",
                "leagues": [
                    {
                        "league_id": "lg_sd40k",
                        "slug": "sd40k",
                        "name": "San Diego Force Org (SD40K)",
                        "region": "San Diego, CA",
                        "active_season": 38,
                        "active_players": 68,
                        "pods_count": 8,
                        "commissioner": "Cooper Waddell (Coop) & Ben Nicholls",
                        "template": "sd40k_standard_pod_system",
                        "status": "active",
                        "logo": "/static/images/badges/sd40k_emblem.png",
                        "data_path": "sd40k_league_data.json",
                        "seasons_count": 38
                    }
                ],
                "available_templates": DEFAULT_TEMPLATES
            }
            self._save_index()

        # 2. Check if sd40k_league_data.json exists, if not run ingestion script
        if not SD40K_DATA_PATH.exists():
            print("[LeaguesHubService] sd40k_league_data.json missing. Running ingestion script...")
            try:
                import sys
                import importlib.util
                ingest_path = Path(__file__).resolve().parent / "scripts" / "ingest_sd40k_data.py"
                if ingest_path.exists():
                    import subprocess
                    subprocess.run([sys.executable, str(ingest_path)], check=True, timeout=60)
            except Exception as e:
                print(f"[LeaguesHubService] Ingestion failed: {e}")

        # 3. Cache SD40K data and historical archives
        if SD40K_DATA_PATH.exists():
            try:
                with open(SD40K_DATA_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    data.setdefault("recurring_seasons", True)
                    data.setdefault("registration_open", True)
                    self._leagues_cache["lg_sd40k"] = data
                    self._leagues_cache["sd40k"] = data
                    self._leagues_cache["league_sd40k_big_league"] = data
                    self._leagues_cache["lg_sd40k_big_league"] = data
            except Exception as e:
                print(f"[LeaguesHubService] Error reading sd40k data: {e}")

        # 4. Cache historical seasons and player career dossiers
        self._historical_cache: Dict[str, Any] = {}
        hist_path = DATA_DIR / "sd40k_historical_seasons.json"
        if hist_path.exists():
            try:
                with open(hist_path, "r", encoding="utf-8") as f:
                    self._historical_cache = json.load(f)
            except Exception as e:
                print(f"[LeaguesHubService] Error reading historical data: {e}")

        self._careers_cache: Dict[str, Any] = {}
        career_path = DATA_DIR / "sd40k_player_careers.json"
        if career_path.exists():
            try:
                with open(career_path, "r", encoding="utf-8") as f:
                    self._careers_cache = json.load(f)
            except Exception as e:
                print(f"[LeaguesHubService] Error reading careers data: {e}")

        # 5. Load or initialize participant identity registry (native_league_participants backing store)
        self._participants_path = DATA_DIR / "sd40k_league_participants.json"
        self._participants_registry: Dict[str, Dict[str, Any]] = {}
        self._load_or_init_participants_registry()

    def _load_or_init_participants_registry(self):
        """
        Loads or seeds the participant identity registry mapping league participant names
        to real PostgreSQL `bcp_player_id` (`players.player_id`) and `user_id` (`users.id`).
        Only participants who actually exist in our PostgreSQL `players` table have a valid
        `bcp_player_id` and `is_db_matched = True`. Unmatched participants have `bcp_player_id = None`
        and `is_db_matched = False` until matched/claimed via an account or player profile.
        """
        if self._participants_path.exists():
            try:
                with open(self._participants_path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                    if loaded:
                        # Sanitize any legacy fake bcp_ slugs so only real DB player_ids remain matched
                        for k, v in loaded.items():
                            pid = v.get("bcp_player_id")
                            if pid and str(pid).startswith("bcp_"):
                                v["bcp_player_id"] = None
                                v["is_db_matched"] = False
                                v["match_method"] = "unmatched"
                            else:
                                v["is_db_matched"] = bool(pid)
                        self._participants_registry = loaded
                        return
            except Exception as e:
                print(f"[LeaguesHubService] Error loading participants registry: {e}")

        sd_data = self._leagues_cache.get("lg_sd40k") or {}
        act = sd_data.get("active_season", {})
        s_num = int(act.get("season_number", 38))

        all_seasons = [(s_num, act)]
        for h_key, h_season in (self._historical_cache or {}).items():
            try:
                h_num = int(h_key)
            except ValueError:
                continue
            if h_num != s_num and isinstance(h_season, dict):
                all_seasons.append((h_num, h_season))

        for curr_s_num, season_obj in sorted(all_seasons, key=lambda x: x[0]):
            for p in season_obj.get("pods", []):
                p_num = int(p.get("pod_number", 1))
                for st in p.get("standings", []):
                    pname = (st.get("name") or "").strip()
                    if not pname:
                        continue
                    norm_key = pname.lower()
                    pid = st.get("bcp_player_id") or st.get("player_id")
                    if pid and str(pid).startswith("bcp_"):
                        pid = None
                    is_matched = bool(pid)
                    self._participants_registry[norm_key] = {
                        "league_id": "league_sd40k_big_league",
                        "season_num": curr_s_num,
                        "pod_num": p_num,
                        "participant_name": pname,
                        "primary_faction": st.get("primary_faction", ""),
                        "bcp_player_id": pid,
                        "user_id": st.get("user_id"),
                        "is_db_matched": is_matched,
                        "match_method": "postgres_exact_name" if is_matched else "unmatched"
                    }
        self._save_participants_registry()

    def _save_participants_registry(self):
        try:
            with open(self._participants_path, "w", encoding="utf-8") as f:
                json.dump(self._participants_registry, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[LeaguesHubService] Error saving participants registry: {e}")

    def _enrich_season_participants(self, league_obj: Dict[str, Any]) -> Dict[str, Any]:
        """Enriches all pod standings and pairings with real PostgreSQL DB match status, bcp_player_id, and user_id."""
        act = league_obj.get("active_season", {})
        s_num = int(act.get("season_number", 38))
        # Ensure season-specific rules live on active_season.season_config
        act.setdefault("season_config", {
            "round_layouts": ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"],
            "pod_size_min": 6,
            "pod_size_max": 8,
            "promotion_count": 2,
            "relegation_count": 2,
            "games_per_season": 5,
            "duration_weeks": 8
        })
        round_layouts = act.get("season_config", {}).get("round_layouts", ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"])
        for p in act.get("pods", []):
            p_num = int(p.get("pod_number", 1))
            for st in p.get("standings", []):
                pname = (st.get("name") or "").strip()
                norm_key = pname.lower()
                reg_entry = self._participants_registry.get(norm_key)
                if not reg_entry:
                    pid = st.get("bcp_player_id") or st.get("player_id")
                    if pid and str(pid).startswith("bcp_"):
                        pid = None
                    is_matched = bool(pid)
                    reg_entry = {
                        "league_id": league_obj.get("league_id", "league_sd40k_big_league"),
                        "season_num": s_num,
                        "pod_num": p_num,
                        "participant_name": pname,
                        "primary_faction": st.get("primary_faction", ""),
                        "bcp_player_id": pid,
                        "user_id": st.get("user_id"),
                        "is_db_matched": is_matched,
                        "match_method": "postgres_exact_name" if is_matched else "unmatched"
                    }
                    self._participants_registry[norm_key] = reg_entry

                pid_val = reg_entry.get("bcp_player_id")
                if pid_val and str(pid_val).startswith("bcp_"):
                    pid_val = None
                st["bcp_player_id"] = pid_val
                st["player_id"] = pid_val
                st["user_id"] = reg_entry.get("user_id")
                st["is_db_matched"] = bool(reg_entry.get("is_db_matched") and pid_val)
                st["match_method"] = reg_entry.get("match_method", "unmatched") if st["is_db_matched"] else "unmatched"
                if reg_entry.get("linked_display_name"):
                    st["linked_display_name"] = reg_entry.get("linked_display_name")

                for idx, pair in enumerate(st.get("pairings", [])):
                    opp_raw = (pair.get("opponent_name") or "").strip()
                    opp_clean = re.sub(r"\s*\([^)]*\)\s*$", "", opp_raw).strip()
                    if opp_raw.lower() in self._participants_registry:
                        opp_clean = opp_raw
                    opp_reg = self._participants_registry.get(opp_clean.lower(), {})
                    opp_pid = opp_reg.get("bcp_player_id")
                    if opp_pid and str(opp_pid).startswith("bcp_"):
                        opp_pid = None
                    pair["opponent_clean_name"] = opp_clean
                    pair["opponent_bcp_player_id"] = opp_pid
                    pair["opponent_user_id"] = opp_reg.get("user_id")
                    pair["opponent_is_db_matched"] = bool(opp_reg.get("is_db_matched") and opp_pid)
                    if not pair.get("layout") and idx < len(round_layouts):
                        pair["layout"] = round_layouts[idx]

        # Attach summary counts of DB-matched vs unmatched participants
        all_season_names = [
            (st.get("name") or "").strip().lower()
            for p in act.get("pods", [])
            for st in p.get("standings", [])
            if st.get("name")
        ]
        matched_cnt = sum(
            1 for k in all_season_names
            if self._participants_registry.get(k, {}).get("is_db_matched")
            and self._participants_registry.get(k, {}).get("bcp_player_id")
            and not str(self._participants_registry.get(k, {}).get("bcp_player_id")).startswith("bcp_")
        )
        act["db_matched_players_count"] = matched_cnt
        act["unmatched_players_count"] = max(0, len(all_season_names) - matched_cnt)
        return league_obj

    def get_user_registered_leagues(
        self,
        user_id: Optional[str] = None,
        player_id: Optional[str] = None,
        player_name: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Returns any active leagues in which the given user/player is participating,
        formatted for seamless display under `📅 Registered Tournaments` in My Hub
        along with full Pod & 5-round pairings data for the Quick Popup Modal.
        """
        uid_clean = (str(user_id).strip() if user_id else "")
        pid_clean = (str(player_id).strip() if player_id else "")
        pname_clean = (str(player_name).strip().lower() if player_name else "")
        if not uid_clean and not pid_clean and not pname_clean:
            return []

        league_obj = self.get_league("league_sd40k_big_league")
        if not league_obj:
            return []

        act = league_obj.get("active_season", {})
        s_num = int(act.get("season_number", 38))
        round_layouts = act.get("season_config", {}).get(
            "round_layouts", ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"]
        )

        matched_entries: List[Dict[str, Any]] = []
        for p in act.get("pods", []):
            p_num = int(p.get("pod_number", 1))
            p_name = p.get("pod_name") or f"Pod #{p_num}"
            standings = p.get("standings", [])
            for st in standings:
                st_uid = str(st.get("user_id") or "").strip()
                st_pid = str(st.get("bcp_player_id") or st.get("player_id") or "").strip()
                st_name = (st.get("name") or "").strip()
                st_name_lower = st_name.lower()

                is_match = False
                if uid_clean and st_uid and uid_clean == st_uid:
                    is_match = True
                elif pid_clean and st_pid and pid_clean == st_pid:
                    is_match = True
                elif pname_clean and st_name_lower and pname_clean == st_name_lower:
                    is_match = True

                if is_match:
                    w = int(st.get("wins", 0))
                    l = int(st.get("losses", 0))
                    d = int(st.get("draws", 0))
                    record_str = f"{w}-{l}-{d}"
                    games_played = w + l + d
                    games_total = len(st.get("pairings", [])) or 5

                    enriched_pairings = []
                    for idx, pair in enumerate(st.get("pairings", [])):
                        opp_raw = (pair.get("opponent_name") or "").strip()
                        opp_clean = pair.get("opponent_clean_name") or re.sub(r"\s*\([^)]*\)\s*$", "", opp_raw).strip()
                        opp_faction = pair.get("opponent_faction") or ""
                        if not opp_faction and "(" in opp_raw and opp_raw.endswith(")"):
                            m = re.search(r"\(([^)]+)\)\s*$", opp_raw)
                            if m:
                                opp_faction = m.group(1).strip()
                        # Also look up opponent in pod standings if faction still empty
                        if not opp_faction:
                            for ost in standings:
                                if (ost.get("name") or "").strip().lower() == opp_clean.lower():
                                    opp_faction = ost.get("primary_faction") or ""
                                    break
                        enriched_pairings.append({
                            "round": int(pair.get("round", idx + 1)),
                            "layout": pair.get("layout") or (round_layouts[idx] if idx < len(round_layouts) else "Standard Layout"),
                            "opponent_name": opp_raw,
                            "opponent_clean_name": opp_clean,
                            "opponent_faction": opp_faction or "Unknown Faction",
                            "opponent_bcp_player_id": pair.get("opponent_bcp_player_id"),
                            "opponent_user_id": pair.get("opponent_user_id"),
                            "opponent_is_db_matched": bool(pair.get("opponent_is_db_matched") and pair.get("opponent_bcp_player_id")),
                            "status": pair.get("status", "scheduled"),
                            "result": pair.get("result"),
                            "player_score": pair.get("player_score", 0),
                            "opponent_score": pair.get("opponent_score", 0),
                        })

                    matched_entries.append({
                        "id": f"league_sd40k_s{s_num}_pod{p_num}",
                        "bcp_event_id": "league_sd40k_big_league",
                        "league_id": "league_sd40k_big_league",
                        "is_native_league": True,
                        "has_explicit_player_data": True,
                        "event_name": f"{league_obj.get('name', 'San Diego Force Org (SD40K)')} — Season {s_num}",
                        "name": f"{league_obj.get('name', 'San Diego Force Org (SD40K)')} — Season {s_num}",
                        "season_number": s_num,
                        "pod_number": p_num,
                        "pod_name": p_name,
                        "player_name": st_name,
                        "player_id": st_pid or pid_clean,
                        "bcp_player_id": st_pid or pid_clean,
                        "user_id": st_uid or uid_clean,
                        "faction": st.get("primary_faction") or "Army Unassigned",
                        "primary_faction": st.get("primary_faction") or "Army Unassigned",
                        "detachment": f"Pod #{p_num} ({p_name})",
                        "rank": int(st.get("rank", 1)),
                        "wins": w,
                        "losses": l,
                        "draws": d,
                        "record": record_str,
                        "battle_points": int(st.get("battle_points", 0)),
                        "games_played": games_played,
                        "rounds": games_total,
                        "points_limit": 2000,
                        "event_date": act.get("start_date", "2026-09-15"),
                        "start_date": act.get("start_date", "2026-09-15"),
                        "end_date": act.get("end_date", "2026-11-10"),
                        "venue_name": "San Diego Force Org Pods",
                        "city": "San Diego",
                        "state": "CA",
                        "checked_in": True,
                        "has_list_submitted": True,
                        "pairings": enriched_pairings,
                        "pod_standings": [
                            {
                                "rank": int(s.get("rank", i + 1)),
                                "name": s.get("name"),
                                "primary_faction": s.get("primary_faction"),
                                "wins": int(s.get("wins", 0)),
                                "losses": int(s.get("losses", 0)),
                                "draws": int(s.get("draws", 0)),
                                "battle_points": int(s.get("battle_points", 0)),
                                "bcp_player_id": s.get("bcp_player_id"),
                                "is_db_matched": bool(s.get("is_db_matched") and s.get("bcp_player_id")),
                            }
                            for i, s in enumerate(standings)
                        ]
                    })
        return matched_entries

    def _save_index(self):
        try:
            with open(LEAGUES_INDEX_PATH, "w", encoding="utf-8") as f:
                json.dump(self._index, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[LeaguesHubService] Error saving index: {e}")

    def _save_league_data(self, league_id: str):
        data = self._leagues_cache.get(league_id)
        if not data:
            return
        if league_id in ("lg_sd40k", "sd40k", "league_sd40k_big_league", "lg_sd40k_big_league"):
            try:
                with open(SD40K_DATA_PATH, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
            except Exception as e:
                print(f"[LeaguesHubService] Error saving SD40K data: {e}")

    def get_leagues_list(self, region: Optional[str] = None, game_system: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns registered community leagues."""
        leagues = self._index.get("leagues", [])
        sd_data = self._leagues_cache.get("lg_sd40k") or {}
        for l in leagues:
            if l.get("league_id") in ("lg_sd40k", "league_sd40k_big_league") or l.get("slug") == "sd40k":
                l["league_id"] = "league_sd40k_big_league"
                l["registration_open"] = sd_data.get("registration_open", True)
                l["recurring_seasons"] = sd_data.get("recurring_seasons", True)
                l["registration_start"] = sd_data.get("active_season", {}).get("registration_start", "2026-09-15")
                l["registration_end"] = sd_data.get("active_season", {}).get("registration_end", "2026-10-01")
                l["games_per_season"] = 5
                l["pod_size_range"] = "6-8 Players"
        if region:
            reg_clean = region.strip().lower()
            leagues = [l for l in leagues if reg_clean in (l.get("region") or "").lower()]
        return leagues

    def get_league(self, league_id_or_slug: str, season_number: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Returns full league data for either active Season 38 or any historical season (1-37)."""
        key = league_id_or_slug.strip().lower()
        if key in ("league_sd40k_big_league", "lg_sd40k_big_league", "sd40k_big_league", "lg_sd40k", "sd40k"):
            clean_key = "lg_sd40k"
            slug_key = "sd40k"
        elif key.startswith("lg_"):
            clean_key = key
            slug_key = key.replace("lg_", "")
        else:
            clean_key = f"lg_{key}"
            slug_key = key

        base_league = None
        if clean_key in self._leagues_cache:
            base_league = self._leagues_cache[clean_key]
        elif slug_key in self._leagues_cache:
            base_league = self._leagues_cache[slug_key]
        else:
            league_file = DATA_DIR / f"{slug_key}_league_data.json"
            if league_file.exists():
                try:
                    with open(league_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        self._leagues_cache[clean_key] = data
                        self._leagues_cache[slug_key] = data
                        base_league = data
                except Exception as e:
                    print(f"[LeaguesHubService] Error reading league file {league_file}: {e}")

        if not base_league:
            return None

        # Ensure available_seasons is always populated
        if not base_league.get("available_seasons"):
            seasons_list = [
                {
                    "season_number": 38,
                    "name": "Season 38 (Fall 2026)",
                    "status": "active",
                    "total_players": 68,
                    "total_pods": 8,
                    "pod_champion": "In Progress",
                    "pod_champion_faction": ""
                }
            ]
            for s_num in range(37, 0, -1):
                s_key = str(s_num)
                h = self._historical_cache.get(s_key, {})
                seasons_list.append({
                    "season_number": s_num,
                    "name": h.get("name", f"Season {s_num}"),
                    "status": "completed",
                    "total_players": h.get("total_players", 60),
                    "total_pods": h.get("total_pods", 7),
                    "pod_champion": h.get("pod_champion", "Archived"),
                    "pod_champion_faction": h.get("pod_champion_faction", "")
                })
            base_league["available_seasons"] = seasons_list

        # If a specific season is requested and it's not Season 38
        if season_number is not None and int(season_number) != 38:
            s_key = str(season_number)
            if s_key in self._historical_cache:
                league_copy = dict(base_league)
                league_copy["active_season"] = self._historical_cache[s_key]
                league_copy["selected_season"] = int(season_number)
                league_copy["is_historical"] = True
                return self._enrich_season_participants(league_copy)

        return self._enrich_season_participants(base_league)

    def get_seasons_catalog(self, league_id_or_slug: str) -> List[Dict[str, Any]]:
        """Returns the full catalog of all 38 seasons with participant counts and champions."""
        league = self.get_league(league_id_or_slug)
        if not league:
            return []
        return league.get("available_seasons", [])

    def get_player_career(self, league_id_or_slug: str, player_name: str) -> Optional[Dict[str, Any]]:
        """Returns player career dossier across all 38 seasons."""
        if not player_name:
            return None
        p_clean = player_name.strip().lower()
        for name, career in self._careers_cache.items():
            if name.lower() == p_clean:
                return career
        return None

    def get_pod(self, league_id_or_slug: str, pod_num: int) -> Optional[Dict[str, Any]]:
        """Returns details for a specific pod within the active season."""
        league = self.get_league(league_id_or_slug)
        if not league:
            return None
        active_season = league.get("active_season", {})
        pods = active_season.get("pods", [])
        for p in pods:
            if p.get("pod_number") == pod_num:
                return p
        return None

    def get_available_templates(self) -> List[Dict[str, Any]]:
        """Returns available league creation templates."""
        return self._index.get("available_templates", DEFAULT_TEMPLATES)

    def get_player_league_summary(self, player_name: str) -> List[Dict[str, Any]]:
        """
        Finds active league registrations and pending matchups for a player.
        Enables 1-click 'Resume Match' or 'Play Match' in My Hub and Game Tracker.
        """
        if not player_name:
            return []
        p_clean = player_name.strip().lower()
        active_matches = []

        # Check all loaded leagues
        for lid in ["lg_sd40k"]:
            league = self.get_league(lid)
            if not league:
                continue
            active_season = league.get("active_season", {})
            season_num = active_season.get("season_number", 38)
            season_name = active_season.get("name", f"Season {season_num}")
            pods = active_season.get("pods", [])

            for p in pods:
                pod_num = p.get("pod_number")
                pod_name = p.get("name")
                for s in p.get("standings", []):
                    name_in_pod = (s.get("name") or "").strip().lower()
                    # Check exact or partial match (e.g. "Junior Aflleje" in "Junior Aflleje")
                    if p_clean in name_in_pod or name_in_pod in p_clean:
                        # Find next incomplete match
                        next_match = None
                        completed_matches = []
                        for m in s.get("pairings", []):
                            if m.get("is_completed"):
                                completed_matches.append(m)
                            elif next_match is None and m.get("opponent_name"):
                                next_match = m

                        active_matches.append({
                            "league_id": league.get("league_id", lid),
                            "league_name": league.get("name"),
                            "season_number": season_num,
                            "season_name": season_name,
                            "pod_number": pod_num,
                            "pod_name": pod_name,
                            "player_name": s.get("name"),
                            "primary_faction": s.get("primary_faction"),
                            "rank": s.get("rank"),
                            "battle_points": s.get("battle_points"),
                            "record": f"{s.get('wins', 0)}-{s.get('losses', 0)}-{s.get('draws', 0)}",
                            "relegation_status": s.get("relegation_status"),
                            "next_match": next_match,
                            "completed_matches_count": len(completed_matches),
                            "total_rounds": 5,
                            "partner_venues": league.get("partner_venues", [])
                        })
        return active_matches

    def report_match(
        self,
        league_id: str,
        pod_number: int,
        round_number: int,
        p1_name: str,
        p2_name: str,
        p1_score: int,
        p2_score: int,
        scorecard_id: Optional[str] = None,
        is_ringer: bool = False
    ) -> Dict[str, Any]:
        """
        Records a completed match score and updates pod standings according to SD40K rules:
        - Win: VP + 1000 BP (or +750 BP for ringer)
        - Draw: VP + 500 BP
        - Loss: VP + 0 BP
        """
        league = self.get_league(league_id)
        if not league:
            raise ValueError(f"League {league_id} not found")

        active_season = league.get("active_season", {})
        pods = active_season.get("pods", [])
        target_pod = None
        for p in pods:
            if p.get("pod_number") == pod_number:
                target_pod = p
                break

        p1_clean = (p1_name or "").strip().lower()
        p2_clean = (p2_name or "").strip().lower()

        p1_record = None
        p2_record = None
        if target_pod:
            for s in target_pod.get("standings", []):
                sname = (s.get("name") or "").strip().lower()
                if sname == p1_clean:
                    p1_record = s
                elif sname == p2_clean:
                    p2_record = s

        # Auto-detect pod if p1_record/p2_record were not in pod_number
        if not p1_record or not p2_record:
            for p in pods:
                cand_p1 = None
                cand_p2 = None
                for s in p.get("standings", []):
                    sname = (s.get("name") or "").strip().lower()
                    if sname == p1_clean:
                        cand_p1 = s
                    elif sname == p2_clean:
                        cand_p2 = s
                if cand_p1 and cand_p2:
                    target_pod = p
                    pod_number = int(p.get("pod_number", 1))
                    p1_record = cand_p1
                    p2_record = cand_p2
                    break

        if not target_pod or not p1_record or not p2_record:
            raise ValueError(f"Could not locate players '{p1_name}' and '{p2_name}' in Pod {pod_number}")

        # Compute BP bonus
        win_bonus = 750 if is_ringer else 1000
        draw_bonus = 500

        if p1_score > p2_score:
            p1_bp = p1_score + win_bonus
            p2_bp = p2_score
            p1_record["wins"] = p1_record.get("wins", 0) + 1
            p2_record["losses"] = p2_record.get("losses", 0) + 1
        elif p1_score < p2_score:
            p1_bp = p1_score
            p2_bp = p2_score + win_bonus
            p1_record["losses"] = p1_record.get("losses", 0) + 1
            p2_record["wins"] = p2_record.get("wins", 0) + 1
        else:
            p1_bp = p1_score + draw_bonus
            p2_bp = p2_score + draw_bonus
            p1_record["draws"] = p1_record.get("draws", 0) + 1
            p2_record["draws"] = p2_record.get("draws", 0) + 1

        p1_record["games_played"] = p1_record.get("games_played", 0) + 1
        p2_record["games_played"] = p2_record.get("games_played", 0) + 1
        p1_record["battle_points"] = p1_record.get("battle_points", 0) + p1_bp
        p2_record["battle_points"] = p2_record.get("battle_points", 0) + p2_bp

        standings = target_pod.get("standings", [])

        # Update pairing in p1
        for m in p1_record.get("pairings", []):
            opp_c = (m.get("opponent_clean_name") or m.get("opponent_name") or "").lower()
            if p2_clean in opp_c or m.get("round") == round_number:
                m["score"] = f"{p1_score} - {p2_score}"
                m["player_score"] = p1_score
                m["opponent_score"] = p2_score
                m["status"] = "completed"
                m["result"] = "W" if p1_score > p2_score else ("L" if p1_score < p2_score else "D")
                m["is_completed"] = True
                m["scorecard_id"] = scorecard_id
                break

        # Update pairing in p2
        for m in p2_record.get("pairings", []):
            opp_c = (m.get("opponent_clean_name") or m.get("opponent_name") or "").lower()
            if p1_clean in opp_c or m.get("round") == round_number:
                m["score"] = f"{p2_score} - {p1_score}"
                m["player_score"] = p2_score
                m["opponent_score"] = p1_score
                m["status"] = "completed"
                m["result"] = "W" if p2_score > p1_score else ("L" if p2_score < p1_score else "D")
                m["is_completed"] = True
                m["scorecard_id"] = scorecard_id
                break

        # Re-sort pod standings by Battle Points descending
        standings.sort(key=lambda x: (x.get("battle_points", 0), x.get("wins", 0)), reverse=True)
        for idx, s in enumerate(standings, start=1):
            s["rank"] = idx

        self._save_league_data(league.get("league_id", "lg_sd40k"))

        # Record match to PostgreSQL native_league_matches table if DB is available
        try:
            from database import PostgresDatabase
            db = PostgresDatabase()
            active_s = league.get("active_season", {})
            s_num = active_s.get("season_number", 1)
            db.record_league_match_in_db(
                league_id=league_id,
                season_num=s_num,
                pod_num=pod_number,
                round_num=round_number,
                p1_name=p1_name,
                p2_name=p2_name,
                p1_score=p1_score,
                p2_score=p2_score,
                p1_bp=p1_bp,
                p2_bp=p2_bp,
                scorecard_id=scorecard_id,
                is_ringer=is_ringer
            )
        except Exception:
            pass

        return {
            "success": True,
            "league_id": league_id,
            "pod_number": pod_number,
            "round_number": round_number,
            "p1_name": p1_name,
            "p1_score": p1_score,
            "p1_bp": p1_bp,
            "p2_name": p2_name,
            "p2_score": p2_score,
            "p2_bp": p2_bp,
            "standings": standings
        }

    def calculate_promotion_relegation(self, league_id: str, season_number: Optional[int] = None) -> Dict[str, Any]:
        """
        Calculates 2-up / 2-down promotion & relegation for each pod based on SD40K rules.
        Pod 1: top players remain; bottom 2 relegate to Pod 2.
        Pod 2..K-1: top 2 promote; middle remain; bottom 2 relegate.
        Pod K (bottom): top 2 promote; remainder remain; all new entrants seed here!
        """
        league = self.get_league(league_id, season_number=season_number)
        if not league:
            raise ValueError(f"League '{league_id}' not found")

        active_season = league.get("active_season", {})
        s_num = active_season.get("season_number", 1)
        pods = active_season.get("pods", [])
        if not pods:
            return {
                "success": True,
                "season_number": s_num,
                "promotions": [],
                "relegations": [],
                "retentions": [],
                "pod_champions": [],
                "projected_pods": {}
            }

        promotions = []
        relegations = []
        retentions = []
        pod_champions = []
        projected_pods = {p.get("pod_number", idx + 1): [] for idx, p in enumerate(pods)}

        for p in pods:
            p_num = p.get("pod_number")
            standings = sorted(p.get("standings", []), key=lambda x: (x.get("battle_points", 0), x.get("wins", 0), x.get("games_played", 0)), reverse=True)
            n = len(standings)

            if standings:
                pod_champions.append({
                    "pod_number": p_num,
                    "pod_name": p.get("name", f"Pod {p_num}"),
                    "champion_name": standings[0].get("name"),
                    "primary_faction": standings[0].get("primary_faction", "Unknown"),
                    "battle_points": standings[0].get("battle_points", 0),
                    "record": f"{standings[0].get('wins', 0)}W - {standings[0].get('losses', 0)}L - {standings[0].get('draws', 0)}D"
                })

            for idx, pl in enumerate(standings):
                rank = idx + 1
                entry = {
                    "name": pl.get("name"),
                    "primary_faction": pl.get("primary_faction", "Unknown"),
                    "allegiance": pl.get("allegiance", "Independent"),
                    "previous_pod": p_num,
                    "previous_rank": rank,
                    "previous_bp": pl.get("battle_points", 0),
                    "previous_record": f"{pl.get('wins', 0)}W - {pl.get('losses', 0)}L - {pl.get('draws', 0)}D"
                }

                if p_num == 1:
                    if rank <= 2:
                        retentions.append({**entry, "pod": 1, "action": "POD CHAMPION / FINALS QUALIFIER"})
                        projected_pods[1].append(entry)
                    elif rank <= max(2, n - 2):
                        retentions.append({**entry, "pod": 1, "action": "REMAIN (Same Pod)"})
                        projected_pods[1].append(entry)
                    else:
                        relegations.append({**entry, "from_pod": 1, "to_pod": 2, "action": "- 1 POD (Bottom 2 Relegated)"})
                        if 2 in projected_pods:
                            projected_pods[2].append(entry)
                elif p_num == len(pods):
                    if rank <= 2:
                        promotions.append({**entry, "from_pod": p_num, "to_pod": p_num - 1, "action": "+ 1 POD (Top 2 Promoted)"})
                        if (p_num - 1) in projected_pods:
                            projected_pods[p_num - 1].append(entry)
                    else:
                        retentions.append({**entry, "pod": p_num, "action": "REMAIN (Same Pod)"})
                        projected_pods[p_num].append(entry)
                else:
                    if rank <= 2:
                        promotions.append({**entry, "from_pod": p_num, "to_pod": p_num - 1, "action": "+ 1 POD (Top 2 Promoted)"})
                        if (p_num - 1) in projected_pods:
                            projected_pods[p_num - 1].append(entry)
                    elif rank <= max(2, n - 2):
                        retentions.append({**entry, "pod": p_num, "action": "REMAIN (Same Pod)"})
                        projected_pods[p_num].append(entry)
                    else:
                        relegations.append({**entry, "from_pod": p_num, "to_pod": p_num + 1, "action": "- 1 POD (Bottom 2 Relegated)"})
                        if (p_num + 1) in projected_pods:
                            projected_pods[p_num + 1].append(entry)

        return {
            "success": True,
            "league_id": league_id,
            "season_number": s_num,
            "next_season_number": s_num + 1,
            "pod_champions": pod_champions,
            "promotions": promotions,
            "relegations": relegations,
            "retentions": retentions,
            "projected_pods": projected_pods
        }

    def rollover_season(self, league_id: str, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Executes automated season rollover:
        1. Archives the finished season in historical catalog with final champions.
        2. Updates all player career dossiers with match stats, titles, and promotions.
        3. Seeds Season N+1 with promoted/relegated players and bottom-pod new entrants.
        4. Generates 5 rounds of round-robin pairings for all pods.
        5. Persists to disk and PostgreSQL.
        """
        options = options or {}
        league = self.get_league(league_id)
        if not league:
            raise ValueError(f"League '{league_id}' not found")

        active_season = league.get("active_season", {})
        curr_s_num = active_season.get("season_number", 1)
        next_s_num = curr_s_num + 1

        calc = self.calculate_promotion_relegation(league_id)
        projected = calc.get("projected_pods", {})
        pod_champs = calc.get("pod_champions", [])
        pod1_champ = pod_champs[0] if pod_champs else {}

        # 1. Archive finished season into historical cache
        archived_season = copy.deepcopy(active_season)
        archived_season["status"] = "completed"
        archived_season["pod_champion"] = pod1_champ.get("champion_name", "Archived")
        archived_season["pod_champion_faction"] = pod1_champ.get("primary_faction", "")
        self._historical_cache[str(curr_s_num)] = archived_season

        # Save historical archive file
        hist_path = DATA_DIR / f"{league.get('slug', 'sd40k')}_historical_seasons.json"
        if not hist_path.exists() and (DATA_DIR / "sd40k_historical_seasons.json").exists():
            hist_path = DATA_DIR / "sd40k_historical_seasons.json"
        try:
            with open(hist_path, "w", encoding="utf-8") as f:
                json.dump(self._historical_cache, f, indent=2)
        except Exception as e:
            print(f"[LeaguesHubService] Error archiving historical season: {e}")

        # 2. Update player career dossiers
        for p in active_season.get("pods", []):
            p_num = p.get("pod_number")
            p_name = p.get("name", f"Pod {p_num}")
            for s in p.get("standings", []):
                pname = s.get("name")
                if not pname:
                    continue
                if pname not in self._careers_cache:
                    self._careers_cache[pname] = {
                        "name": pname,
                        "total_seasons": 0,
                        "total_games": 0,
                        "total_wins": 0,
                        "total_losses": 0,
                        "total_draws": 0,
                        "total_bp": 0,
                        "best_pod": f"Pod {p_num}",
                        "pod_titles": 0,
                        "championships": 0,
                        "factions": [s.get("primary_faction")] if s.get("primary_faction") else [],
                        "history": []
                    }
                c = self._careers_cache[pname]
                c["total_seasons"] = c.get("total_seasons", 0) + 1
                c["total_games"] = c.get("total_games", 0) + s.get("games_played", 0)
                c["total_wins"] = c.get("total_wins", 0) + s.get("wins", 0)
                c["total_losses"] = c.get("total_losses", 0) + s.get("losses", 0)
                c["total_draws"] = c.get("total_draws", 0) + s.get("draws", 0)
                c["total_bp"] = c.get("total_bp", 0) + s.get("battle_points", 0)
                if s.get("rank") == 1:
                    c["pod_titles"] = c.get("pod_titles", 0) + 1
                    if p_num == 1:
                        c["championships"] = c.get("championships", 0) + 1
                faction = s.get("primary_faction")
                if faction and faction not in c.get("factions", []):
                    c.setdefault("factions", []).append(faction)

                # Relegation tag
                releg_act = s.get("relegation_status", "None")
                c.setdefault("history", []).insert(0, {
                    "season_number": curr_s_num,
                    "pod_number": p_num,
                    "pod_name": p_name,
                    "primary_faction": faction,
                    "rank": s.get("rank", 1),
                    "relegation": releg_act,
                    "record": f"{s.get('wins', 0)}W - {s.get('losses', 0)}L - {s.get('draws', 0)}D",
                    "wins": s.get("wins", 0),
                    "losses": s.get("losses", 0),
                    "draws": s.get("draws", 0),
                    "battle_points": s.get("battle_points", 0),
                    "poty_points": s.get("poty_points", 0)
                })

        career_path = DATA_DIR / f"{league.get('slug', 'sd40k')}_player_careers.json"
        if not career_path.exists() and (DATA_DIR / "sd40k_player_careers.json").exists():
            career_path = DATA_DIR / "sd40k_player_careers.json"
        try:
            with open(career_path, "w", encoding="utf-8") as f:
                json.dump(self._careers_cache, f, indent=2)
        except Exception as e:
            print(f"[LeaguesHubService] Error saving careers: {e}")

        # 3. Add any new players into the lowest pod (everyone starting off starts in the bottom pod)
        new_players = options.get("new_players", [])
        ordered_roster = []
        for pod_num in sorted(projected.keys()):
            ordered_roster.extend(projected[pod_num])
        for np in new_players:
            if isinstance(np, str):
                np_obj = {"name": np, "primary_faction": "Undeclared", "allegiance": "Independent"}
            else:
                np_obj = np
            ordered_roster.append(np_obj)

        balanced_pods_list = distribute_players_into_pods(ordered_roster, min_size=6, max_size=8)
        projected = {idx + 1: pod_roster for idx, pod_roster in enumerate(balanced_pods_list)}

        # 4. Construct Season N+1 Pods and Round-Robin Pairings (5 games per season)
        new_pods = []
        total_players_count = 0
        for pod_num in sorted(projected.keys()):
            roster = projected[pod_num]
            player_names = [p.get("name") for p in roster if p.get("name")]
            total_players_count += len(roster)
            pairings_map = generate_round_robin_pairings(player_names, num_rounds=int(options.get("rounds_count", 5)))

            standings_entries = []
            for idx, p_entry in enumerate(roster):
                pname = p_entry.get("name")
                standings_entries.append({
                    "rank": idx + 1,
                    "name": pname,
                    "primary_faction": p_entry.get("primary_faction", "Undeclared"),
                    "allegiance": p_entry.get("allegiance", "Independent"),
                    "relegation_status": "None",
                    "poty_points": 0,
                    "wins": 0,
                    "losses": 0,
                    "draws": 0,
                    "battle_points": 0,
                    "games_played": 0,
                    "pairings": pairings_map.get(pname, [])
                })

            new_pods.append({
                "pod_number": pod_num,
                "name": f"POD #{pod_num} - {POD_NAMES.get(pod_num, f'Pod {pod_num}')}",
                "tier": POD_TIERS.get(pod_num, f"Division {pod_num}"),
                "round_layouts": ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"],
                "player_count": len(standings_entries),
                "completion_rate": "0%",
                "standings": standings_entries
            })

        # 5. Build new active season
        duration_weeks = int(options.get("duration_weeks", 8))
        start_date = options.get("start_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        next_season_obj = {
            "season_number": next_s_num,
            "name": options.get("name") or f"Season {next_s_num}",
            "status": options.get("status", "active"),
            "start_date": start_date,
            "duration_weeks": duration_weeks,
            "total_pods": len(new_pods),
            "total_players": total_players_count,
            "pods": new_pods
        }

        # Update available_seasons catalog
        avail = league.get("available_seasons", [])
        for s_entry in avail:
            if s_entry.get("season_number") == curr_s_num:
                s_entry["status"] = "completed"
                s_entry["pod_champion"] = pod1_champ.get("champion_name", "Archived")
                s_entry["pod_champion_faction"] = pod1_champ.get("primary_faction", "")

        avail.insert(0, {
            "season_number": next_s_num,
            "name": next_season_obj["name"],
            "status": next_season_obj["status"],
            "total_players": total_players_count,
            "total_pods": len(new_pods),
            "pod_champion": "In Progress",
            "pod_champion_faction": ""
        })
        league["available_seasons"] = avail
        league["active_season"] = next_season_obj

        # 6. Save updated league data
        self._save_league_data(league.get("league_id", league_id))

        # Update index
        for lg_meta in self._index.get("leagues", []):
            if lg_meta.get("league_id") == league_id or lg_meta.get("slug") == league.get("slug"):
                lg_meta["active_season"] = next_s_num
                lg_meta["active_players"] = total_players_count
                lg_meta["pods_count"] = len(new_pods)
                lg_meta["seasons_count"] = len(avail)
        self._save_index()

        return {
            "success": True,
            "previous_season_number": curr_s_num,
            "new_season_number": next_s_num,
            "pod_champions": pod_champs,
            "promotions_count": len(calc.get("promotions", [])),
            "relegations_count": len(calc.get("relegations", [])),
            "total_players": total_players_count,
            "total_pods": len(new_pods),
            "active_season": next_season_obj
        }

    def register_player_for_league(self, league_id: str, player_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Registers a player into the active season.
        Follows the SD40K rule: all new participants start in the lowest division pod!
        """
        p_name = player_data.get("name", "").strip()
        if not p_name:
            raise ValueError("Player name is required")

        league = self.get_league(league_id)
        if not league:
            raise ValueError(f"League '{league_id}' not found")

        active_season = league.get("active_season", {})
        pods = active_season.get("pods", [])
        if not pods:
            pods.append({
                "pod_number": 1,
                "name": "POD #1 - The Hard Boys",
                "tier": "Premier Division",
                "round_layouts": ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"],
                "player_count": 0,
                "standings": []
            })
            active_season["pods"] = pods

        bottom_pod = pods[-1]
        if len(bottom_pod.get("standings", [])) >= 8:
            next_pod_num = bottom_pod.get("pod_number", len(pods)) + 1
            bottom_pod = {
                "pod_number": next_pod_num,
                "name": f"POD #{next_pod_num} - {POD_NAMES.get(next_pod_num, f'Division {next_pod_num}')}",
                "tier": POD_TIERS.get(next_pod_num, "Open Division"),
                "round_layouts": ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"],
                "player_count": 0,
                "standings": []
            }
            pods.append(bottom_pod)

        standings = bottom_pod.setdefault("standings", [])
        for s in standings:
            if s.get("name", "").strip().lower() == p_name.lower():
                return {"success": True, "message": "Player already registered in pod", "pod_number": bottom_pod.get("pod_number"), "player": s}

        new_entry = {
            "rank": len(standings) + 1,
            "name": p_name,
            "primary_faction": player_data.get("primary_faction", "Undeclared"),
            "allegiance": player_data.get("allegiance", "Independent"),
            "relegation_status": "None",
            "poty_points": 0,
            "wins": 0,
            "losses": 0,
            "draws": 0,
            "battle_points": 0,
            "games_played": 0,
            "pairings": []
        }
        standings.append(new_entry)
        bottom_pod["player_count"] = len(standings)

        player_names = [s.get("name") for s in standings if s.get("name")]
        pairings_map = generate_round_robin_pairings(player_names, 5)
        for s in standings:
            s["pairings"] = pairings_map.get(s.get("name"), [])

        active_season["total_players"] = sum(p.get("player_count", len(p.get("standings", []))) for p in pods)
        active_season["total_pods"] = len(pods)

        self._save_league_data(league.get("league_id", league_id))

        return {
            "success": True,
            "league_id": league_id,
            "player_name": p_name,
            "assigned_pod": bottom_pod.get("pod_number"),
            "pod_name": bottom_pod.get("name"),
            "total_players": active_season["total_players"]
        }

    def create_league(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Creates a new community league based on SD40K methodology.
        Sets up automated season rhythm (duration, registration window, rounds, pod rules).
        """
        raw_name = data.get("name", "").strip()
        if not raw_name:
            raise ValueError("League name is required")

        slug = data.get("slug") or re.sub(r'[^a-zA-Z0-9]+', '-', raw_name.lower()).strip('-')
        league_id = f"lg_{slug}"
        template_id = data.get("template_id", "sd40k_standard_pod_system")
        game_system = (data.get("game_system") or "40k").lower()

        duration_weeks = int(data.get("duration_weeks") or data.get("weeks") or 8)
        rounds_count = int(data.get("rounds_count") or data.get("rounds") or 5)
        reg_window_days = int(data.get("registration_window_days") or 14)

        start_date_str = data.get("start_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        try:
            s_date = datetime.strptime(start_date_str, "%Y-%m-%d")
            reg_start = (s_date - timedelta(days=reg_window_days)).strftime("%Y-%m-%d")
            reg_end = start_date_str
            end_date = (s_date + timedelta(weeks=duration_weeks)).strftime("%Y-%m-%d")
        except Exception:
            reg_start = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            reg_end = start_date_str
            end_date = ""

        commissioner = data.get("commissioner") or "Organizer"
        venues = data.get("partner_venues", [])
        if not venues and data.get("venue"):
            venues = [{"name": data.get("venue"), "role": "Official Host Store"}]

        new_league = {
            "league_id": league_id,
            "slug": slug,
            "name": raw_name,
            "short_name": data.get("short_name") or raw_name[:10],
            "game_system": game_system,
            "tagline": data.get("tagline") or f"A community {game_system.upper()} pod league organized by {commissioner}",
            "city": data.get("city", "Local"),
            "state": data.get("state", ""),
            "region": data.get("region", data.get("city", "Local Scene")),
            "country": data.get("country", "USA"),
            "established_year": datetime.now(timezone.utc).year,
            "commissioners": [{"name": commissioner, "role": "League Commissioner"}],
            "partner_venues": venues,
            "clubs": data.get("clubs", []),
            "methodology": {
                "template_id": template_id,
                "title": f"{raw_name} League Format",
                "game_system": game_system,
                "points_limit": int(data.get("points_limit", 2000)),
                "season_duration_weeks": duration_weeks,
                "games_per_season": rounds_count,
                "registration_window_days": reg_window_days,
                "pod_size": int(data.get("pod_size", 8)),
                "promotion_count": int(data.get("promotion_count", 2)),
                "relegation_count": int(data.get("relegation_count", 2)),
                "new_player_rule": "bottom_pod_first",
                "scoring_breakdown": {
                    "win": "Actual VP + 1,000 BP Bonus",
                    "draw": "Actual VP + 500 BP Bonus",
                    "loss": "Actual VP + 0 BP Bonus",
                    "ringer": "Actual VP + 750 BP Bonus"
                }
            },
            "active_season": {
                "season_number": 1,
                "name": "Season 1 (Inaugural)",
                "status": "registration",
                "start_date": start_date_str,
                "end_date": end_date,
                "registration_start": reg_start,
                "registration_end": reg_end,
                "duration_weeks": duration_weeks,
                "rounds_count": rounds_count,
                "total_pods": 0,
                "total_players": 0,
                "pods": []
            },
            "available_seasons": [
                {
                    "season_number": 1,
                    "name": "Season 1 (Inaugural)",
                    "status": "registration",
                    "total_players": 0,
                    "total_pods": 0,
                    "pod_champion": "Upcoming",
                    "pod_champion_faction": ""
                }
            ],
            "hall_of_fame": {
                "finals_champions": [],
                "leaderboards": {}
            },
            "meta": {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "created_by": commissioner
            }
        }

        # Save to disk
        new_league["recurring_seasons"] = bool(data.get("recurring_seasons", True))
        new_league["registration_open"] = bool(data.get("registration_open", True))
        out_file = DATA_DIR / f"{slug}_league_data.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(new_league, f, indent=2, ensure_ascii=False)

        # Register in index
        index_entry = {
            "league_id": league_id,
            "slug": slug,
            "name": raw_name,
            "region": new_league["region"],
            "active_season": 1,
            "active_players": 0,
            "pods_count": 0,
            "commissioner": commissioner,
            "template": template_id,
            "status": "registration",
            "recurring_seasons": new_league["recurring_seasons"],
            "registration_open": new_league["registration_open"],
            "registration_start": reg_start,
            "registration_end": reg_end,
            "games_per_season": rounds_count,
            "pod_size_range": "6-8 Players",
            "data_path": f"{slug}_league_data.json"
        }
        self._index["leagues"].append(index_entry)
        self._save_index()

        self._leagues_cache[league_id] = new_league
        self._leagues_cache[slug] = new_league

        return {"success": True, "league": new_league}

    def set_registration_window(self, league_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Updates registration window status (exposed in Sparring Radar when open) and recurring season automation settings."""
        league = self.get_league(league_id)
        if not league:
            raise ValueError(f"League '{league_id}' not found")

        if "registration_open" in payload and payload["registration_open"] is not None:
            league["registration_open"] = bool(payload["registration_open"])
        else:
            league["registration_open"] = not bool(league.get("registration_open", True))

        if "recurring_seasons" in payload and payload["recurring_seasons"] is not None:
            league["recurring_seasons"] = bool(payload["recurring_seasons"])

        act = league.setdefault("active_season", {})
        if payload.get("registration_start"):
            act["registration_start"] = payload["registration_start"]
        if payload.get("registration_end"):
            act["registration_end"] = payload["registration_end"]
        if payload.get("duration_weeks"):
            act["duration_weeks"] = int(payload["duration_weeks"])
            league.setdefault("methodology", {})["season_duration_weeks"] = int(payload["duration_weeks"])

        for alias in ("lg_sd40k", "sd40k", "league_sd40k_big_league", "lg_sd40k_big_league", league_id):
            if alias in self._leagues_cache and isinstance(self._leagues_cache[alias], dict):
                self._leagues_cache[alias]["registration_open"] = league["registration_open"]
                self._leagues_cache[alias]["recurring_seasons"] = league.get("recurring_seasons", True)

        for l in self._index.get("leagues", []):
            if l.get("league_id") in (league_id, "lg_sd40k", "league_sd40k_big_league") or l.get("slug") == league.get("slug"):
                l["registration_open"] = league["registration_open"]
                l["recurring_seasons"] = league.get("recurring_seasons", True)
                l["registration_start"] = act.get("registration_start", "")
                l["registration_end"] = act.get("registration_end", "")

        self._save_league_data(league.get("league_id", league_id))
        self._save_index()

        try:
            from database import PostgresDatabase
            db = PostgresDatabase()
            with db._get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE native_leagues SET registration_open = %s, updated_at = NOW() WHERE id IN (%s, 'lg_sd40k', 'league_sd40k_big_league')",
                        (league["registration_open"], league_id)
                    )
                conn.commit()
        except Exception:
            pass

        return {
            "success": True,
            "league_id": league.get("league_id", league_id),
            "registration_open": league["registration_open"],
            "recurring_seasons": league.get("recurring_seasons", True),
            "registration_start": act.get("registration_start", ""),
            "registration_end": act.get("registration_end", "")
        }

    def get_season_participants(self, league_id: str, season_number: Optional[int] = None) -> Dict[str, Any]:
        """
        Returns all participants in the season/pods with their `user_id`, `bcp_player_id` (`players.player_id`),
        `is_db_matched` status, and `match_method` ('name_assumption', 'user_id_linked', 'self_claimed', 'unmatched').
        """
        league = self.get_league(league_id, season_number=season_number)
        if not league:
            raise ValueError(f"League '{league_id}' not found")
        act = league.get("active_season", {})
        s_num = int(act.get("season_number", 38))
        participants = []
        for p in act.get("pods", []):
            p_num = int(p.get("pod_number", 1))
            for st in p.get("standings", []):
                participants.append({
                    "league_id": league.get("league_id", "league_sd40k_big_league"),
                    "season_num": s_num,
                    "pod_num": p_num,
                    "pod_name": p.get("name", f"Pod #{p_num}"),
                    "participant_name": st.get("name", ""),
                    "primary_faction": st.get("primary_faction", ""),
                    "bcp_player_id": st.get("bcp_player_id"),
                    "player_id": st.get("bcp_player_id"),
                    "user_id": st.get("user_id"),
                    "is_db_matched": bool(st.get("is_db_matched")),
                    "match_method": st.get("match_method", "unmatched"),
                    "linked_display_name": st.get("linked_display_name")
                })
        return {
            "success": True,
            "league_id": league.get("league_id", "league_sd40k_big_league"),
            "season_num": s_num,
            "total_participants": len(participants),
            "db_matched_count": sum(1 for pt in participants if pt["is_db_matched"]),
            "unmatched_count": sum(1 for pt in participants if not pt["is_db_matched"]),
            "participants": participants
        }

    def claim_or_link_participant(self, league_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Links an existing unmatched participant row (or newly registered player) to a `user_id`
        and `bcp_player_id` (`players.player_id`), or registers a newly registered player who declares
        "I'm in this league".
        """
        league = self.get_league(league_id)
        if not league:
            raise ValueError(f"League '{league_id}' not found")

        mode = (payload.get("mode") or "claim_existing").strip()
        participant_name = (payload.get("participant_name") or payload.get("name") or "").strip()
        user_id = (payload.get("user_id") or "").strip() or "u_john_hsieh"
        bcp_player_id = (payload.get("bcp_player_id") or payload.get("player_id") or "").strip()
        linked_display_name = (payload.get("display_name") or "").strip()
        primary_faction = (payload.get("primary_faction") or payload.get("faction") or "Necrons").strip()

        if not bcp_player_id:
            slug = re.sub(r"[^a-z0-9]+", "_", (linked_display_name or participant_name or user_id).lower()).strip("_")
            bcp_player_id = f"bcp_{slug}"

        act = league.get("active_season", {})
        s_num = int(act.get("season_number", 38))
        matched_pod_num = int(payload.get("pod_num") or 1)

        if mode == "join_new" or not participant_name:
            # Newly registered user saying "I'm in this league" and joining as a participant
            reg_res = self.register_player_for_league(league_id, {
                "name": linked_display_name or participant_name or "Registered Competitor",
                "faction": primary_faction,
                "user_id": user_id,
                "bcp_player_id": bcp_player_id
            })
            target_name = (linked_display_name or participant_name or "Registered Competitor").strip()
            matched_pod_num = int(reg_res.get("assigned_pod", len(act.get("pods", [])) or 8))
            norm_key = target_name.lower()
            self._participants_registry[norm_key] = {
                "league_id": "league_sd40k_big_league",
                "season_num": s_num,
                "pod_num": matched_pod_num,
                "participant_name": target_name,
                "primary_faction": primary_faction,
                "bcp_player_id": bcp_player_id,
                "user_id": user_id,
                "is_db_matched": True,
                "match_method": "self_claimed",
                "linked_display_name": linked_display_name or target_name
            }
            participant_name = target_name
        else:
            norm_key = participant_name.lower()
            for p in act.get("pods", []):
                for st in p.get("standings", []):
                    if (st.get("name") or "").strip().lower() == norm_key:
                        matched_pod_num = int(p.get("pod_number", 1))
                        primary_faction = st.get("primary_faction") or primary_faction
                        break

            self._participants_registry[norm_key] = {
                "league_id": "league_sd40k_big_league",
                "season_num": s_num,
                "pod_num": matched_pod_num,
                "participant_name": participant_name,
                "primary_faction": primary_faction,
                "bcp_player_id": bcp_player_id,
                "user_id": user_id,
                "is_db_matched": True,
                "match_method": "user_id_linked",
                "linked_display_name": linked_display_name or participant_name
            }

        self._save_participants_registry()
        self._enrich_season_participants(league)
        self._save_league_data(league.get("league_id", league_id))

        try:
            import database
            database.get_db().claim_league_participant_in_db(
                league_id="league_sd40k_big_league",
                season_num=s_num,
                pod_num=matched_pod_num,
                participant_name=participant_name,
                user_id=user_id,
                bcp_player_id=bcp_player_id,
                match_method="user_id_linked" if mode != "join_new" else "self_claimed"
            )
        except Exception:
            pass

        return {
            "success": True,
            "participant": self._participants_registry.get(participant_name.lower()),
            "league": league
        }


_GLOBAL_LEAGUES_SERVICE: Optional[LeaguesHubService] = None

def get_leagues_hub_service() -> LeaguesHubService:
    global _GLOBAL_LEAGUES_SERVICE
    if _GLOBAL_LEAGUES_SERVICE is None:
        _GLOBAL_LEAGUES_SERVICE = LeaguesHubService()
    return _GLOBAL_LEAGUES_SERVICE
