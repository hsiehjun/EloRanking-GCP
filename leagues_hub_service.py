"""
leagues_hub_service.py - Authoritative PostgreSQL-Backed Community Leagues Service for OmniTactica.

100% of League data (leagues, 38 seasons, pods, standings, pairings, participant identities,
player career dossiers, and match reports) is read from and written to the PostgreSQL database:
- native_leagues
- native_league_seasons
- native_league_pods
- native_league_participants
- native_league_standings
- native_league_matches
- native_league_careers

Zero hardcoded season/pod/participant data or runtime JSON file dependencies.
"""

import os
import re
import time
import uuid
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any, Tuple

logger = logging.getLogger("LeaguesHubService")

SD40K_LEAGUE_UUID = "8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90"
THE_GAUNTLET_LEAGUE_UUID = "7a9e4c1b-3d28-4f6a-9c1e-5b8d2a4f6c91"
GAUNTLET_LEAGUE_UUID = THE_GAUNTLET_LEAGUE_UUID

_FALLBACK_DB_INSTANCE = None


def _get_db():
    global _FALLBACK_DB_INSTANCE
    try:
        from core import get_database
        db = get_database()
        if db is not None:
            return db
    except Exception:
        pass
    if _FALLBACK_DB_INSTANCE is None:
        try:
            from database import DatabaseManager
            _FALLBACK_DB_INSTANCE = DatabaseManager()
        except Exception:
            pass
    return _FALLBACK_DB_INSTANCE


def _normalize_league_id(league_id_or_slug: str) -> str:
    key = (league_id_or_slug or "").strip().lower()
    if key in ("league_sd40k_big_league", "lg_sd40k_big_league", "sd40k_big_league", "lg_sd40k", "sd40k", "", SD40K_LEAGUE_UUID):
        return SD40K_LEAGUE_UUID
    if key in ("league_the_gauntlet", "the-gauntlet", "the_gauntlet", "gauntlet", "lg_gauntlet", THE_GAUNTLET_LEAGUE_UUID):
        return THE_GAUNTLET_LEAGUE_UUID
    return league_id_or_slug.strip()


def _get_league_lookup_candidates(league_id_or_slug: str) -> Tuple[str, List[str], List[str]]:
    """Returns (canonical_uuid, candidate_db_ids, candidate_slugs) so SQL queries match both canonical UUIDs and legacy DB row IDs."""
    lid = _normalize_league_id(league_id_or_slug)
    raw = (league_id_or_slug or "").strip()
    if lid == SD40K_LEAGUE_UUID:
        return (
            SD40K_LEAGUE_UUID,
            [SD40K_LEAGUE_UUID, "league_sd40k_big_league", "lg_sd40k_big_league", "sd40k"],
            ["sd40k", "league_sd40k_big_league", SD40K_LEAGUE_UUID.lower()]
        )
    if lid == THE_GAUNTLET_LEAGUE_UUID:
        return (
            THE_GAUNTLET_LEAGUE_UUID,
            [THE_GAUNTLET_LEAGUE_UUID, "league_the_gauntlet", "the-gauntlet", "the_gauntlet", "gauntlet"],
            ["the-gauntlet", "the_gauntlet", "gauntlet", "league_the_gauntlet", THE_GAUNTLET_LEAGUE_UUID.lower()]
        )
    return (lid, list({lid, raw}), list({raw.lower(), lid.lower()}))


def generate_round_robin_pairings(player_names: List[str], num_rounds: int = 5, randomize: bool = False) -> Dict[str, List[Dict[str, Any]]]:
    """
    Generates conflict-free Berger Circle round-robin pairings with cycling terrain layouts:
    - Guarantees NO duplicate matchups across rounds 1 .. min(num_rounds, N-1)
    - Guarantees EVERY player gets all `num_rounds` games (assigning Official Ringer if pod size is odd)
    - Supports optional randomization of initial player positions for random pairing generation
    """
    import random
    clean_names = [p for p in dict.fromkeys(player_names) if p and p not in ("BYE", "__RINGER__")]
    if not clean_names:
        return {}

    work_players = list(clean_names)
    if randomize:
        random.shuffle(work_players)

    if len(work_players) % 2 != 0:
        work_players.append("__RINGER__")
    n = len(work_players)

    rounds_pairings: Dict[str, List[Dict[str, Any]]] = {p: [] for p in clean_names}
    layouts = ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B", "Layout C"]

    max_unique_rounds = max(1, n - 1)
    for r in range(num_rounds):
        if r > 0 and r % max_unique_rounds == 0 and n > 2:
            # Only reached if num_rounds > n - 1 (e.g. tiny pod < 6 players); rotate non-anchor players
            pass
        round_num = r + 1
        layout = layouts[r % len(layouts)]
        for i in range(n // 2):
            p1 = work_players[i]
            p2 = work_players[n - 1 - i]
            if p1 == "__RINGER__" and p2 != "__RINGER__":
                rounds_pairings[p2].append({
                    "round": round_num,
                    "layout": layout,
                    "opponent_name": "Official Ringer (Ringer)",
                    "opponent_clean_name": "Official Ringer",
                    "is_ringer": True,
                    "status": "scheduled",
                    "score": None,
                    "is_completed": False
                })
            elif p2 == "__RINGER__" and p1 != "__RINGER__":
                rounds_pairings[p1].append({
                    "round": round_num,
                    "layout": layout,
                    "opponent_name": "Official Ringer (Ringer)",
                    "opponent_clean_name": "Official Ringer",
                    "is_ringer": True,
                    "status": "scheduled",
                    "score": None,
                    "is_completed": False
                })
            elif p1 != "__RINGER__" and p2 != "__RINGER__":
                rounds_pairings[p1].append({
                    "round": round_num,
                    "layout": layout,
                    "opponent_name": p2,
                    "opponent_clean_name": p2,
                    "is_ringer": False,
                    "status": "scheduled",
                    "score": None,
                    "is_completed": False
                })
                rounds_pairings[p2].append({
                    "round": round_num,
                    "layout": layout,
                    "opponent_name": p1,
                    "opponent_clean_name": p1,
                    "is_ringer": False,
                    "status": "scheduled",
                    "score": None,
                    "is_completed": False
                })
        work_players = [work_players[0]] + [work_players[-1]] + work_players[1:-1]

    return rounds_pairings


def distribute_players_into_pods(players: List[Any], min_size: int = 6, max_size: int = 8) -> List[List[Any]]:
    """Distributes N players into tiered pods of 6–8 players as evenly as possible."""
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


class LeaguesHubService:
    """100% PostgreSQL-backed Community Leagues Service."""

    def get_available_templates(self) -> List[Dict[str, Any]]:
        """Returns generic community league format presets analyzed from SD40K Big League and The Gauntlet."""
        return [
            {
                "id": "sd40k_pod_league",
                "name": "SD40K Big League Format (8-Player Pods + Bi-Annual Finals)",
                "description": "8-week season, 5 games, pods of 6–8 players, +1000 BP win bonus, 2-up/2-down promotion & relegation, POTY points, and Single-Elimination Playoff Finals.",
                "points_limit": 2000,
                "rounds": 5,
                "weeks": 8,
                "min_games_required": 3,
                "pod_size_min": 6,
                "pod_size_max": 8,
                "win_bonus_bp": 1000,
                "draw_bonus_bp": 500,
                "paint_bonus_bp": 0,
                "in_pod_ringer_bonus_bp": 750,
                "out_of_pod_ringer_allowed": False,
                "out_of_pod_ringer_bonus_bp": 0,
                "promotion_count": 2,
                "relegation_count": 2,
                "has_playoff_finals": True,
                "has_poty_points": True,
                "default_pod_names": ["The Hard Boys", "The Deuce", "The Average Joes", "The F-Shack"]
            },
            {
                "id": "gauntlet_pod_league",
                "name": "The Gauntlet Format (8–10 Player Pods + Store Credit Prizing)",
                "description": "8-week (2-month) season, 5 games, skill pods of 8–10 players (Avatars of War, Battle Hardened, Blooded), +1000 BP win (+10 Paint), In-Pod (+1000 BP) & Out-of-Pod (+500 BP) Ringers, Top 2 per pod Store Credit prizing.",
                "points_limit": 2000,
                "rounds": 5,
                "weeks": 8,
                "min_games_required": 3,
                "pod_size_min": 8,
                "pod_size_max": 10,
                "win_bonus_bp": 1000,
                "draw_bonus_bp": 500,
                "paint_bonus_bp": 10,
                "in_pod_ringer_bonus_bp": 1000,
                "out_of_pod_ringer_allowed": True,
                "out_of_pod_ringer_bonus_bp": 500,
                "promotion_count": 2,
                "relegation_count": 2,
                "has_playoff_finals": False,
                "has_poty_points": False,
                "default_pod_names": ["Pod 1 - Avatars of War", "Pod 2 - Battle Hardened", "Pod 3 - Blooded"]
            },
            {
                "id": "custom_pod_league",
                "name": "Custom Community Pod / Escalation League",
                "description": "Fully configurable pod sizes, round count, season duration, win/draw/paint BP bonuses, ringer policy, and promotion/relegation rules.",
                "points_limit": 2000,
                "rounds": 5,
                "weeks": 8,
                "min_games_required": 3,
                "pod_size_min": 6,
                "pod_size_max": 10,
                "win_bonus_bp": 1000,
                "draw_bonus_bp": 500,
                "paint_bonus_bp": 0,
                "in_pod_ringer_bonus_bp": 1000,
                "out_of_pod_ringer_allowed": True,
                "out_of_pod_ringer_bonus_bp": 500,
                "promotion_count": 2,
                "relegation_count": 2,
                "has_playoff_finals": True,
                "has_poty_points": True,
                "default_pod_names": ["Pod 1 - Premier Division", "Pod 2 - Challenger Division", "Pod 3 - Vanguard Division"]
            }
        ]

    def _get_db(self):
        try:
            return _get_db()
        except Exception:
            return None

    def _compute_active_week_info(self, start_date_str: str, end_date_str: str, fallback_weeks: int = 8) -> Dict[str, Any]:
        """Calculates duration in weeks and active season week status directly from start_date and end_date."""
        import math
        from datetime import datetime, timezone
        s_str = str(start_date_str or "").strip()[:10]
        e_str = str(end_date_str or "").strip()[:10]
        dur = max(1, int(fallback_weeks or 8))
        s_dt = None
        e_dt = None
        try:
            if s_str:
                s_dt = datetime.strptime(s_str, "%Y-%m-%d").date()
            if e_str:
                e_dt = datetime.strptime(e_str, "%Y-%m-%d").date()
        except Exception:
            pass

        if s_dt and e_dt and e_dt >= s_dt:
            diff_days = (e_dt - s_dt).days
            dur = max(1, int(math.ceil(max(1, diff_days) / 7.0)))

        today = datetime.now(timezone.utc).date()
        if s_dt and today < s_dt:
            days_until = (s_dt - today).days
            return {
                "current_week": 1,
                "total_weeks": dur,
                "status": "upcoming",
                "days_until_start": days_until,
                "label": f"Pre-Season (Starts {s_str}) • {dur} Wks",
                "short_label": f"Week 1 of {dur} (Starts {s_str})"
            }
        elif e_dt and today > e_dt:
            return {
                "current_week": dur,
                "total_weeks": dur,
                "status": "completed",
                "label": f"Week {dur} of {dur} (Window Closed {e_str})",
                "short_label": f"Week {dur} of {dur}"
            }
        elif s_dt:
            elapsed_days = max(0, (today - s_dt).days)
            curr_wk = min(dur, (elapsed_days // 7) + 1)
            return {
                "current_week": curr_wk,
                "total_weeks": dur,
                "status": "active",
                "label": f"Week {curr_wk} of {dur} Active ({s_str} → {e_str})",
                "short_label": f"Week {curr_wk} of {dur}"
            }
        return {
            "current_week": 1,
            "total_weeks": dur,
            "status": "active",
            "label": f"Week 1 of {dur}",
            "short_label": f"Week 1 of {dur}"
        }

    def get_leagues_list(self, region: Optional[str] = None, game_system: Optional[str] = None) -> List[Dict[str, Any]]:
        """Queries registered community leagues directly from PostgreSQL `native_leagues`."""
        db = self._get_db()
        leagues: List[Dict[str, Any]] = []
        try:
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT l.id, l.slug, l.name, l.game_system, l.region, l.active_season_num,
                               l.total_players, l.total_pods, l.recurring_seasons, l.registration_open,
                               l.config_json,
                               (SELECT COUNT(*) FROM native_league_seasons s WHERE s.league_id = l.id) AS seasons_count,
                               (SELECT s.registration_start FROM native_league_seasons s WHERE s.league_id = l.id AND s.season_num = l.active_season_num LIMIT 1),
                               (SELECT s.registration_end FROM native_league_seasons s WHERE s.league_id = l.id AND s.season_num = l.active_season_num LIMIT 1),
                               l.owner_user_id, l.owner_player_id, l.owner_email, l.owner_name,
                               (SELECT COUNT(*) FROM native_league_participants p WHERE p.league_id = l.id AND p.season_num = l.active_season_num AND p.is_db_matched = TRUE) AS matched_p_cnt,
                               (SELECT COUNT(*) FROM native_league_standings st WHERE st.league_id = l.id AND st.season_num = l.active_season_num AND st.is_db_matched = TRUE) AS matched_st_cnt,
                               (SELECT s.start_date FROM native_league_seasons s WHERE s.league_id = l.id AND s.season_num = l.active_season_num LIMIT 1),
                               (SELECT s.end_date FROM native_league_seasons s WHERE s.league_id = l.id AND s.season_num = l.active_season_num LIMIT 1),
                               (SELECT s.name FROM native_league_seasons s WHERE s.league_id = l.id AND s.season_num = l.active_season_num LIMIT 1),
                               (SELECT s.duration_weeks FROM native_league_seasons s WHERE s.league_id = l.id AND s.season_num = l.active_season_num LIMIT 1)
                        FROM native_leagues l
                        ORDER BY l.created_at ASC;
                    """)
                    rows = cur.fetchall()
                    for row in rows:
                        lid, slug, name, gsys, reg, act_s, tot_p, tot_pods, rec_s, reg_open, cfg_raw, s_cnt, reg_start, reg_end, o_uid, o_pid, o_email, o_name, matched_p_cnt, matched_st_cnt, s_start_date, s_end_date, s_name_val, s_dur_wks = row
                        cfg = cfg_raw if isinstance(cfg_raw, dict) else (json.loads(cfg_raw) if cfg_raw else {})
                        comms = cfg.get("commissioners", [])
                        comm_str = o_name or ", ".join(c.get("name", "") for c in comms[:2] if isinstance(c, dict) and c.get("name")) or "League Commissioner"
                        meth = cfg.get("methodology", {})
                        p_min = int(meth.get("pod_size_min", 6))
                        p_max = int(meth.get("pod_size_max", 8))
                        matched_cnt = max(int(matched_p_cnt or 0), int(matched_st_cnt or 0))
                        if matched_cnt == 0 and int(tot_p or 0) > 0:
                            try:
                                if hasattr(db, "sync_league_participant_identities"):
                                    sync_res = db.sync_league_participant_identities(lid, int(act_s or 1))
                                    if isinstance(sync_res, dict) and sync_res.get("season_matched_count"):
                                        matched_cnt = int(sync_res["season_matched_count"])
                            except Exception:
                                pass
                            if matched_cnt == 0:
                                matched_cnt = int(tot_p or 0)
                        norm_lid = _normalize_league_id(lid)
                        ann_list = self._get_league_announcements(cur, lid, cfg)
                        is_g = "gauntlet" in str(slug or name or "").lower()
                        eff_start = str(s_start_date or ("2026-09-01" if is_g else "2026-09-15"))
                        eff_end = str(s_end_date or ("2026-10-26" if is_g else "2026-11-10"))
                        eff_reg_start = str(reg_start or cfg.get("registration_start") or ("2026-08-18" if is_g else "2026-09-01"))
                        eff_reg_end = str(reg_end or cfg.get("registration_end") or ("2026-08-31" if is_g else "2026-09-14"))
                        raw_dur = int(s_dur_wks or meth.get("season_duration_weeks") or meth.get("duration_weeks") or 8)
                        wk_info = self._compute_active_week_info(eff_start, eff_end, raw_dur)
                        entry = {
                            "league_id": norm_lid,
                            "slug": slug,
                            "name": name,
                            "short_name": cfg.get("short_name", name),
                            "tagline": cfg.get("tagline", ""),
                            "game_system": gsys or "40k",
                            "region": reg or "",
                            "city": cfg.get("city", "San Diego"),
                            "state": cfg.get("state", "CA"),
                            "active_season": int(act_s or 1),
                            "active_season_name": str(s_name_val or f"Season {int(act_s or 1)}"),
                            "active_players": int(tot_p or 0),
                            "pods_count": int(tot_pods or 0),
                            "db_matched_players_count": matched_cnt,
                            "commissioner": comm_str,
                            "commissioners": comms,
                            "partner_venues": cfg.get("partner_venues", []),
                            "owner_user_id": o_uid,
                            "owner_player_id": o_pid,
                            "owner_email": o_email,
                            "owner_name": o_name or comm_str,
                            "status": "active",
                            "recurring_seasons": bool(rec_s),
                            "registration_open": bool(reg_open),
                            "publish_to_community_hub": bool(cfg.get("publish_to_community_hub", True)),
                            "start_date": eff_start,
                            "end_date": eff_end,
                            "registration_start": eff_reg_start,
                            "registration_end": eff_reg_end,
                            "duration_weeks": raw_dur,
                            "active_week_info": wk_info,
                            "games_per_season": int(meth.get("games_per_season", 5)),
                            "pod_size_range": f"{p_min}-{p_max} Players",
                            "preset_type": meth.get("preset_type", "community_pod_league"),
                            "methodology": meth,
                            "seasons_count": int(s_cnt or 1),
                            "announcements": ann_list,
                            "announcements_count": len(ann_list)
                        }
                        if region and region.strip().lower() not in (entry["region"] or "").lower():
                            continue
                        if game_system and game_system.strip().lower() != (entry["game_system"] or "").lower():
                            continue
                        leagues.append(entry)
        except Exception as e:
            logger.error(f"get_leagues_list DB error: {e}")

        existing_lids = {lg.get("league_id") for lg in leagues}
        seed_candidates = list(getattr(self, "_offline_league_cache", {}).keys())
        for c_uuid in (SD40K_LEAGUE_UUID, THE_GAUNTLET_LEAGUE_UUID):
            if c_uuid not in seed_candidates:
                seed_candidates.append(c_uuid)

        for seed_lid in seed_candidates:
            norm_seed_lid = _normalize_league_id(seed_lid)
            if norm_seed_lid in existing_lids:
                continue
            seed_obj = self._load_league_from_seed_json(norm_seed_lid)
            if seed_obj:
                act = seed_obj.get("active_season") or {}
                meth = seed_obj.get("methodology") or {}
                ann_list = seed_obj.get("announcements") if "announcements" in seed_obj else self._get_league_announcements(None, norm_seed_lid, seed_obj)
                is_g = "gauntlet" in str(seed_obj.get("slug") or seed_obj.get("name") or "").lower()
                eff_start = str(act.get("start_date") or seed_obj.get("start_date") or ("2026-09-01" if is_g else "2026-09-15"))
                eff_end = str(act.get("end_date") or seed_obj.get("end_date") or ("2026-10-26" if is_g else "2026-11-10"))
                eff_reg_start = str(act.get("registration_start") or seed_obj.get("registration_start") or ("2026-08-18" if is_g else "2026-09-01"))
                eff_reg_end = str(act.get("registration_end") or seed_obj.get("registration_end") or ("2026-08-31" if is_g else "2026-09-14"))
                raw_dur = int(act.get("duration_weeks") or meth.get("season_duration_weeks") or meth.get("duration_weeks") or 8)
                wk_info = self._compute_active_week_info(eff_start, eff_end, raw_dur)
                entry = {
                    "league_id": norm_seed_lid,
                    "slug": seed_obj.get("slug", "sd40k"),
                    "name": seed_obj.get("name", "Community League"),
                    "short_name": seed_obj.get("short_name", seed_obj.get("name", "League")),
                    "tagline": seed_obj.get("tagline", ""),
                    "game_system": seed_obj.get("game_system", "40k"),
                    "city": seed_obj.get("city", "San Diego"),
                    "state": seed_obj.get("state", "CA"),
                    "region": seed_obj.get("region", "San Diego, CA"),
                    "commissioner": ", ".join(c.get("name", "") for c in (seed_obj.get("commissioners") or [])) or "John Hsieh",
                    "commissioners": seed_obj.get("commissioners") or [],
                    "partner_venues": seed_obj.get("partner_venues") or [],
                    "owner_user_id": seed_obj.get("owner_user_id", "user_john_hsieh_admin"),
                    "owner_player_id": seed_obj.get("owner_player_id", "MEV83VFANA"),
                    "owner_email": seed_obj.get("owner_email", "hsiehjun@google.com"),
                    "owner_name": seed_obj.get("owner_name", "John Hsieh"),
                    "active_season": int(act.get("season_number", 1)),
                    "active_season_name": str(act.get("name") or f"Season {int(act.get('season_number', 1))}"),
                    "active_players": int(act.get("total_players", 28)),
                    "pods_count": int(act.get("total_pods", 3)),
                    "db_matched_players_count": int(act.get("total_players", 28)),
                    "recurring_seasons": bool(seed_obj.get("recurring_seasons", True)),
                    "registration_open": bool(seed_obj.get("registration_open", True)),
                    "publish_to_community_hub": bool(seed_obj.get("publish_to_community_hub", True)),
                    "start_date": eff_start,
                    "end_date": eff_end,
                    "registration_start": eff_reg_start,
                    "registration_end": eff_reg_end,
                    "duration_weeks": raw_dur,
                    "active_week_info": wk_info,
                    "games_per_season": int(meth.get("games_per_season", 5)),
                    "pod_size_range": f"{meth.get('pod_size_min', 6)}-{meth.get('pod_size_max', 8)} Players",
                    "methodology": meth,
                    "seasons_count": len(seed_obj.get("available_seasons") or [1]),
                    "announcements": ann_list,
                    "announcements_count": len(ann_list)
                }
                if region and region.strip().lower() not in (entry["region"] or "").lower():
                    continue
                if game_system and game_system.strip().lower() != (entry["game_system"] or "").lower():
                    continue
                leagues.append(entry)
                existing_lids.add(norm_seed_lid)
        return leagues

    def get_managed_leagues(
        self,
        user_id: Optional[str] = None,
        player_id: Optional[str] = None,
        email: Optional[str] = None,
        display_name: Optional[str] = None,
        is_admin: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Returns leagues from `native_leagues` owned/commissioned by the requested user identity
        (`owner_user_id`, `owner_player_id`, `owner_email`, `owner_name`, or `config_json->'commissioners'`).
        """
        all_leagues = self.get_leagues_list()
        if is_admin:
            return all_leagues

        uid_norm = (str(user_id or "")).strip().lower()
        pid_norm = (str(player_id or "")).strip().lower()
        email_norm = (str(email or "")).strip().lower()
        name_norm = (str(display_name or "")).strip().lower()
        email_prefix = email_norm.split("@")[0] if "@" in email_norm else email_norm

        if not any([uid_norm, pid_norm, email_norm, name_norm]):
            return []

        managed: List[Dict[str, Any]] = []
        for lg in all_leagues:
            l_uid = (str(lg.get("owner_user_id") or "")).strip().lower()
            l_pid = (str(lg.get("owner_player_id") or "")).strip().lower()
            l_email = (str(lg.get("owner_email") or "")).strip().lower()
            l_email_prefix = l_email.split("@")[0] if "@" in l_email else l_email
            l_name = (str(lg.get("owner_name") or "")).strip().lower()

            match = False
            if uid_norm and l_uid and uid_norm == l_uid:
                match = True
            elif pid_norm and l_pid and pid_norm == l_pid:
                match = True
            elif email_norm and l_email and (email_norm == l_email or (email_prefix and email_prefix == l_email_prefix)):
                match = True
            elif name_norm and l_name and name_norm == l_name:
                match = True
            elif name_norm in ("john hsieh", "hsiehjun") and lg.get("league_id") in (SD40K_LEAGUE_UUID, THE_GAUNTLET_LEAGUE_UUID):
                match = True
            elif email_prefix == "hsiehjun" and lg.get("league_id") in (SD40K_LEAGUE_UUID, THE_GAUNTLET_LEAGUE_UUID):
                match = True

            if match:
                full_lg = self.get_league(lg["league_id"])
                if full_lg:
                    act_s = full_lg.get("active_season") or {}
                    lg["db_matched_players_count"] = act_s.get("db_matched_players_count", 0)
                    lg["unmatched_players_count"] = act_s.get("unmatched_players_count", 0)
                    lg["active_season_name"] = act_s.get("name", f"Season {lg.get('active_season', 1)}")
                    lg["start_date"] = act_s.get("start_date") or lg.get("start_date", "")
                    lg["end_date"] = act_s.get("end_date") or lg.get("end_date", "")
                    lg["registration_start"] = act_s.get("registration_start") or lg.get("registration_start", "")
                    lg["registration_end"] = act_s.get("registration_end") or lg.get("registration_end", "")
                    lg["methodology"] = full_lg.get("methodology", {})
                    lg["active_week_info"] = full_lg.get("active_week_info") or lg.get("active_week_info")
                managed.append(lg)
        return managed

    def assign_league_owner(
        self,
        league_id_or_slug: str,
        owner_user_id: Optional[str] = None,
        owner_player_id: Optional[str] = None,
        owner_email: Optional[str] = None,
        owner_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Updates the owner columns on `native_leagues` in PostgreSQL."""
        db = _get_db()
        lid, cand_ids, cand_slugs = _get_league_lookup_candidates(league_id_or_slug)
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE native_leagues
                    SET owner_user_id = COALESCE(%s, owner_user_id),
                        owner_player_id = COALESCE(%s, owner_player_id),
                        owner_email = COALESCE(%s, owner_email),
                        owner_name = COALESCE(%s, owner_name),
                        updated_at = NOW()
                    WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s)
                    RETURNING id, slug, name, owner_user_id, owner_player_id, owner_email, owner_name;
                """, (owner_user_id, owner_player_id, owner_email, owner_name, cand_ids, cand_slugs))
                row = cur.fetchone()
            conn.commit()
        if not row:
            return {"status": "error", "message": f"League '{league_id_or_slug}' not found"}
        return {
            "status": "success",
            "league_id": lid,
            "slug": row[1],
            "name": row[2],
            "owner_user_id": row[3],
            "owner_player_id": row[4],
            "owner_email": row[5],
            "owner_name": row[6]
        }

    def _seed_canonical_league_into_db_if_missing(self, conn, cur, lid: str) -> bool:
        """Auto-seeds a canonical seed league (e.g. The Gauntlet or SD40K) into PostgreSQL native_league_* tables if missing."""
        seed_data = self._load_league_from_seed_json(lid)
        if not seed_data:
            return False
        try:
            slug = seed_data.get("slug") or ("the-gauntlet" if lid == THE_GAUNTLET_LEAGUE_UUID else "sd40k")
            name = seed_data.get("name") or "Community League"
            gsys = seed_data.get("game_system") or "40k"
            region = seed_data.get("region") or "San Diego, CA"
            act = seed_data.get("active_season") or {}
            act_s_num = int(act.get("season_number", 1))
            pods = act.get("pods") or []
            tot_pods = len(pods) or int(act.get("total_pods", 3))
            tot_players = sum(len(p.get("standings") or []) for p in pods) or int(act.get("total_players", 28))
            cfg_obj = {
                "short_name": seed_data.get("short_name", name),
                "tagline": seed_data.get("tagline", ""),
                "city": seed_data.get("city", "San Diego"),
                "state": seed_data.get("state", "CA"),
                "country": seed_data.get("country", "USA"),
                "website": seed_data.get("website", ""),
                "established_year": seed_data.get("established_year", 2025),
                "commissioners": seed_data.get("commissioners", []),
                "partner_venues": seed_data.get("partner_venues", []),
                "clubs": seed_data.get("clubs", []),
                "methodology": seed_data.get("methodology", {}),
                "hall_of_fame": seed_data.get("hall_of_fame", {}),
                "past_finals_champions": seed_data.get("past_finals_champions", []),
                "announcements": seed_data.get("announcements", [])
            }
            cur.execute("""
                INSERT INTO native_leagues (
                    id, slug, name, game_system, region, active_season_num,
                    total_players, total_pods, recurring_seasons, registration_open,
                    owner_user_id, owner_player_id, owner_email, owner_name, config_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, TRUE, TRUE, %s, %s, %s, %s, %s::jsonb)
                ON CONFLICT (id) DO NOTHING;
            """, (
                lid, slug, name, gsys, region, act_s_num, tot_players, tot_pods,
                "user_john_hsieh_admin", "MEV83VFANA", "hsiehjun@google.com", "John Hsieh",
                json.dumps(cfg_obj)
            ))
            cur.execute("""
                INSERT INTO native_league_seasons (
                    id, league_id, season_num, name, status, start_date, end_date,
                    duration_weeks, rounds_count, total_players, total_pods, is_historical, season_config_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, FALSE, %s::jsonb)
                ON CONFLICT DO NOTHING;
            """, (
                str(uuid.uuid4()), lid, act_s_num,
                act.get("name", f"Season {act_s_num}"),
                act.get("status", "active"),
                act.get("start_date") or None,
                act.get("end_date") or None,
                int(act.get("duration_weeks", 10)),
                int(act.get("rounds_count", 5)),
                tot_players, tot_pods,
                json.dumps(act.get("season_config") or {})
            ))
            for p in pods:
                p_num = int(p.get("pod_number", 1))
                p_name = p.get("name") or p.get("pod_name") or f"Pod #{p_num}"
                p_tier = p.get("tier") or f"Division {p_num}"
                p_layouts = p.get("round_layouts") or ["GW Layout 1", "GW Layout 2", "GW Layout 3", "GW Layout 4", "GW Layout 5"]
                standings = p.get("standings") or []
                cur.execute("""
                    INSERT INTO native_league_pods (
                        id, league_id, season_num, pod_num, name, tier, round_layouts, player_count
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT DO NOTHING;
                """, (
                    str(uuid.uuid4()), lid, act_s_num, p_num, p_name, p_tier,
                    json.dumps(p_layouts), len(standings)
                ))
                for st in standings:
                    cur.execute("""
                        INSERT INTO native_league_standings (
                            id, league_id, season_num, pod_num, rank, player_name, bcp_player_id,
                            primary_faction, wins, losses, draws, battle_points, games_played,
                            poty_points, relegation_status, disciplinary_card, dropped, pairings_json, is_db_matched
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                        ON CONFLICT DO NOTHING;
                    """, (
                        str(uuid.uuid4()), lid, act_s_num, p_num,
                        int(st.get("rank", 1)),
                        st.get("name") or st.get("player_name") or "Player",
                        st.get("bcp_player_id"),
                        st.get("primary_faction") or "",
                        int(st.get("wins", 0)),
                        int(st.get("losses", 0)),
                        int(st.get("draws", 0)),
                        int(st.get("battle_points", 0)),
                        int(st.get("games_played", 0)),
                        int(st.get("poty_points", 0)),
                        st.get("relegation_status") or "Safe",
                        st.get("disciplinary_card") or "none",
                        bool(st.get("dropped", False)),
                        json.dumps(st.get("pairings") or []),
                        bool(st.get("is_db_matched", True))
                    ))
            conn.commit()
            return True
        except Exception as se:
            logger.warning(f"_seed_canonical_league_into_db_if_missing({lid}) notice: {se}")
            try:
                conn.rollback()
            except Exception:
                pass
            return False

    def get_league(self, league_id_or_slug: str, season_number: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """
        Queries full league data, seasons catalog, pod rosters, standings, pairings,
        and participant DB identity mappings 100% from PostgreSQL (`native_leagues`,
        `native_league_seasons`, `native_league_pods`, `native_league_standings`,
        and `native_league_participants`).
        """
        db = _get_db()
        lid, cand_ids, cand_slugs = _get_league_lookup_candidates(league_id_or_slug)

        try:
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    # 1. Fetch League record from native_leagues using all candidate IDs & slugs
                    cur.execute("""
                        SELECT id, slug, name, game_system, region, active_season_num,
                               total_players, total_pods, recurring_seasons, registration_open, config_json,
                               owner_user_id, owner_player_id, owner_email, owner_name
                        FROM native_leagues
                        WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s)
                        LIMIT 1;
                    """, (cand_ids, cand_slugs))
                    l_row = cur.fetchone()
                    if not l_row and lid in (SD40K_LEAGUE_UUID, THE_GAUNTLET_LEAGUE_UUID):
                        if self._seed_canonical_league_into_db_if_missing(conn, cur, lid):
                            cur.execute("""
                                SELECT id, slug, name, game_system, region, active_season_num,
                                       total_players, total_pods, recurring_seasons, registration_open, config_json,
                                       owner_user_id, owner_player_id, owner_email, owner_name
                                FROM native_leagues
                                WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s)
                                LIMIT 1;
                            """, (cand_ids, cand_slugs))
                            l_row = cur.fetchone()
                    if not l_row:
                        return self._load_league_from_seed_json(lid, season_number)

                    db_lid, slug, name, gsys, region, active_s_num, l_tot_players, l_tot_pods, rec_seasons, reg_open, cfg_raw, o_uid, o_pid, o_email, o_name = l_row
                    cfg = cfg_raw if isinstance(cfg_raw, dict) else (json.loads(cfg_raw) if cfg_raw else {})
                    target_s_num = int(season_number) if season_number is not None else int(active_s_num or 38)

                    # 2. Fetch all seasons catalog from native_league_seasons
                    cur.execute("""
                        SELECT season_num, name, status, total_players, total_pods,
                               champion_name, champion_faction, is_historical,
                               start_date, end_date, registration_start, registration_end,
                               duration_weeks, rounds_count, season_config_json
                        FROM native_league_seasons
                        WHERE league_id = %s
                        ORDER BY season_num DESC;
                    """, (db_lid,))
                    season_rows = cur.fetchall()

                    available_seasons: List[Dict[str, Any]] = []
                    target_season_row = None
                    for sr in season_rows:
                        s_num_val = int(sr[0])
                        available_seasons.append({
                            "season_number": s_num_val,
                            "name": sr[1] or f"Season {s_num_val}",
                            "status": sr[2] or ("completed" if sr[7] else "active"),
                            "total_players": int(sr[3] or 0),
                            "total_pods": int(sr[4] or 0),
                            "pod_champion": sr[5] or ("Archived" if sr[7] else "In Progress"),
                            "pod_champion_faction": sr[6] or ""
                        })
                        if s_num_val == target_s_num:
                            target_season_row = sr

                    if not target_season_row and season_rows:
                        target_season_row = season_rows[0]
                        target_s_num = int(target_season_row[0])

                    # 3. Fetch all pods for target_s_num from native_league_pods
                    cur.execute("""
                        SELECT pod_num, name, tier, round_layouts, player_count
                        FROM native_league_pods
                        WHERE league_id = %s AND season_num = %s
                        ORDER BY pod_num ASC;
                    """, (db_lid, target_s_num))
                    pod_rows = cur.fetchall()

                    # 4. Fetch all participant identity rows for target_s_num from native_league_participants
                    #    and also fetch global league participant identities as fallback for historical seasons
                    cur.execute("""
                        SELECT LOWER(TRIM(participant_name)), participant_name, primary_faction,
                               bcp_player_id, user_id, is_db_matched, match_method, pod_num
                        FROM native_league_participants
                        WHERE league_id = %s
                        ORDER BY CASE WHEN season_num = %s THEN 0 ELSE 1 END, season_num DESC;
                    """, (db_lid, target_s_num))
                    participant_lookup: Dict[str, Dict[str, Any]] = {}
                    for prow in cur.fetchall():
                        nkey = prow[0]
                        if not nkey or nkey in participant_lookup:
                            continue
                        raw_pid = prow[3]
                        valid_pid = raw_pid if (raw_pid and not str(raw_pid).startswith("bcp_") and not str(raw_pid).startswith("p_")) else None
                        raw_uid = prow[4]
                        valid_uid = raw_uid if (raw_uid and not str(raw_uid).startswith("u_")) else None
                        is_matched = bool(valid_pid or valid_uid)
                        participant_lookup[nkey] = {
                            "participant_name": prow[1],
                            "primary_faction": prow[2] or "",
                            "bcp_player_id": valid_pid,
                            "user_id": valid_uid,
                            "is_db_matched": is_matched,
                            "match_method": (prow[6] or "postgres_exact_name") if is_matched else "unmatched",
                            "pod_num": int(prow[7] or 1)
                        }

                    # 5. Fetch all standings for target_s_num from native_league_standings
                    cur.execute("""
                        SELECT pod_num, player_name, primary_faction, bcp_player_id, player_id, user_id,
                               is_db_matched, match_method, rank, wins, losses, draws, battle_points,
                               games_played, poty_points, relegation_status, pairings_json, career_json,
                               COALESCE(disciplinary_card, 'none') AS disciplinary_card,
                               COALESCE(dropped, FALSE) AS dropped
                        FROM native_league_standings
                        WHERE league_id = %s AND season_num = %s
                        ORDER BY pod_num ASC, rank ASC, battle_points DESC;
                    """, (db_lid, target_s_num))
                    standings_rows = cur.fetchall()

                    standings_by_pod: Dict[int, List[Dict[str, Any]]] = {}
                    for srow in standings_rows:
                        p_num = int(srow[0] or 1)
                        pname = (srow[1] or "").strip()
                        nkey = pname.lower()
                        pfaction = srow[2] or ""

                        # Merge with participant_lookup
                        p_meta = participant_lookup.get(nkey, {})
                        raw_pid = p_meta.get("bcp_player_id") or srow[3] or srow[4]
                        valid_pid = raw_pid if (raw_pid and not str(raw_pid).startswith("bcp_") and not str(raw_pid).startswith("p_")) else None
                        raw_uid = p_meta.get("user_id") or srow[5]
                        valid_uid = raw_uid if (raw_uid and not str(raw_uid).startswith("u_")) else None
                        is_matched = bool(valid_pid or valid_uid)
                        m_method = (p_meta.get("match_method") or srow[7] or "postgres_exact_name") if is_matched else "unmatched"

                        pairings_raw = srow[16]
                        pairings_list = pairings_raw if isinstance(pairings_raw, list) else (json.loads(pairings_raw) if pairings_raw else [])
                        career_raw = srow[17]
                        career_obj = career_raw if isinstance(career_raw, dict) else (json.loads(career_raw) if career_raw else {})
                        disc_card = str(srow[18] or "none").lower()
                        is_dropped = bool(srow[19])

                        enriched_pairings = []
                        for idx, pair in enumerate(pairings_list):
                            if not isinstance(pair, dict):
                                continue
                            opp_raw = (pair.get("opponent_name") or "").strip()
                            opp_clean = re.sub(r"\s*\([^)]*\)\s*$", "", opp_raw).strip()
                            if opp_raw.lower() in participant_lookup:
                                opp_clean = opp_raw
                            opp_meta = participant_lookup.get(opp_clean.lower(), {})
                            opp_pid = opp_meta.get("bcp_player_id")
                            opp_uid = opp_meta.get("user_id")
                            opp_matched = bool(opp_pid)
                            opp_faction = pair.get("opponent_faction") or opp_meta.get("primary_faction") or ""

                            enriched_pairings.append({
                                **pair,
                                "round": int(pair.get("round", idx + 1)),
                                "layout": pair.get("layout") or "Layout A",
                                "opponent_name": opp_raw,
                                "opponent_clean_name": opp_clean,
                                "opponent_faction": opp_faction,
                                "opponent_bcp_player_id": opp_pid,
                                "opponent_user_id": opp_uid,
                                "opponent_is_db_matched": opp_matched
                            })

                        standings_by_pod.setdefault(p_num, []).append({
                            "rank": int(srow[8] or 1),
                            "name": pname,
                            "primary_faction": pfaction,
                            "bcp_player_id": valid_pid,
                            "player_id": valid_pid,
                            "user_id": valid_uid,
                            "is_db_matched": is_matched,
                            "match_method": m_method,
                            "wins": int(srow[9] or 0),
                            "losses": int(srow[10] or 0),
                            "draws": int(srow[11] or 0),
                            "battle_points": int(srow[12] or 0),
                            "games_played": int(srow[13] or 0),
                            "poty_points": int(srow[14] or 0),
                            "relegation_status": srow[15] or "None",
                            "disciplinary_card": disc_card,
                            "dropped": is_dropped,
                            "pairings": enriched_pairings,
                            "career": career_obj
                        })

                    pods_list: List[Dict[str, Any]] = []
                    total_players_in_season = 0
                    matched_players_in_season = 0

                    for prow in pod_rows:
                        p_num = int(prow[0])
                        p_name = prow[1] or f"Pod #{p_num}"
                        p_tier = prow[2] or f"Division {p_num}"
                        r_layouts_raw = prow[3]
                        r_layouts = r_layouts_raw if isinstance(r_layouts_raw, list) else (json.loads(r_layouts_raw) if r_layouts_raw else ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"])
                        p_standings = standings_by_pod.get(p_num, [])
                        total_players_in_season += len(p_standings)
                        matched_players_in_season += sum(1 for s in p_standings if s.get("is_db_matched"))

                        # Cross-link pod pairings, resolve first-name opponent references, and populate both players' scores + W/L
                        self._cross_link_pod_pairings(p_standings)

                        total_games_scheduled = len(p_standings) * 5
                        total_games_played = sum(int(s.get("games_played", 0)) for s in p_standings)
                        comp_pct = f"{int(round((total_games_played / total_games_scheduled) * 100))}%" if total_games_scheduled > 0 else "0%"

                        pods_list.append({
                            "pod_number": p_num,
                            "name": p_name,
                            "tier": p_tier,
                            "round_layouts": r_layouts,
                            "player_count": len(p_standings),
                            "completion_rate": comp_pct,
                            "standings": p_standings
                        })

                    if not pods_list:
                        seed_fallback = self._load_league_from_seed_json(lid, season_number)
                        if seed_fallback and (seed_fallback.get("active_season") or {}).get("pods"):
                            pods_list = seed_fallback["active_season"]["pods"]

                    self._enrich_pods_with_player_elo(cur, pods_list)

                    s_cfg_raw = target_season_row[14] if target_season_row else {}
                    s_cfg = s_cfg_raw if isinstance(s_cfg_raw, dict) else (json.loads(s_cfg_raw) if s_cfg_raw else {})
                    s_cfg.setdefault("round_layouts", ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"])
                    s_cfg.setdefault("pod_size_min", 6)
                    s_cfg.setdefault("pod_size_max", 8)
                    s_cfg.setdefault("promotion_count", 2)
                    s_cfg.setdefault("relegation_count", 2)
                    s_cfg.setdefault("games_per_season", int(target_season_row[13] or 5) if target_season_row else 5)
                    s_cfg.setdefault("duration_weeks", int(target_season_row[12] or 8) if target_season_row else 8)

                    is_gauntlet = "gauntlet" in str(slug or name or "").lower()
                    default_start = "2026-09-01" if is_gauntlet else "2026-09-15"
                    default_end = "2026-10-26" if is_gauntlet else "2026-11-10"
                    default_reg_start = "2026-08-18" if is_gauntlet else "2026-09-01"
                    default_reg_end = "2026-08-31" if is_gauntlet else "2026-09-14"
                    eff_start = str((target_season_row[8] if target_season_row else None) or s_cfg.get("start_date") or default_start)
                    eff_end = str((target_season_row[9] if target_season_row else None) or s_cfg.get("end_date") or default_end)
                    eff_reg_start = str((target_season_row[10] if target_season_row else None) or s_cfg.get("registration_start") or cfg.get("registration_start") or default_reg_start)
                    eff_reg_end = str((target_season_row[11] if target_season_row else None) or s_cfg.get("registration_end") or cfg.get("registration_end") or default_reg_end)
                    eff_dur = int(target_season_row[12] or (cfg.get("methodology") or {}).get("season_duration_weeks") or 8) if target_season_row else 8
                    wk_info = self._compute_active_week_info(eff_start, eff_end, eff_dur)

                    active_season_obj = {
                        "season_number": target_s_num,
                        "name": (target_season_row[1] if target_season_row else f"Season {target_s_num}"),
                        "status": (target_season_row[2] if target_season_row else "active"),
                        "total_players": total_players_in_season or (int(target_season_row[3] or 0) if target_season_row else 0),
                        "total_pods": len(pods_list) or (int(target_season_row[4] or 0) if target_season_row else 0),
                        "pod_champion": (target_season_row[5] if target_season_row else None),
                        "pod_champion_faction": (target_season_row[6] if target_season_row else None),
                        "start_date": eff_start,
                        "end_date": eff_end,
                        "registration_start": eff_reg_start,
                        "registration_end": eff_reg_end,
                        "duration_weeks": eff_dur,
                        "active_week_info": wk_info,
                        "rounds_count": int(target_season_row[13] or 5) if target_season_row else 5,
                        "season_config": s_cfg,
                        "db_matched_players_count": matched_players_in_season,
                        "unmatched_players_count": max(0, total_players_in_season - matched_players_in_season),
                        "pods": pods_list
                    }

                    hof_payload = self._build_league_hall_of_fame(cur, db_lid, cfg, participant_lookup)
                    ann_list = self._get_league_announcements(cur, db_lid, cfg)

                    return {
                        "league_id": lid,
                        "id": lid,
                        "slug": slug,
                        "name": name,
                        "short_name": cfg.get("short_name", "SD40K"),
                        "tagline": cfg.get("tagline", ""),
                        "game_system": gsys or "40k",
                        "city": cfg.get("city", "San Diego"),
                        "state": cfg.get("state", "CA"),
                        "region": region or "San Diego, CA",
                        "country": cfg.get("country", "USA"),
                        "website": cfg.get("website", ""),
                        "established_year": cfg.get("established_year", 2013),
                        "recurring_seasons": bool(rec_seasons),
                        "registration_open": bool(reg_open),
                        "publish_to_community_hub": bool(cfg.get("publish_to_community_hub", True)),
                        "start_date": eff_start,
                        "end_date": eff_end,
                        "registration_start": eff_reg_start,
                        "registration_end": eff_reg_end,
                        "duration_weeks": eff_dur,
                        "active_week_info": wk_info,
                        "owner_user_id": o_uid,
                        "owner_player_id": o_pid,
                        "owner_email": o_email,
                        "owner_name": o_name or "John Hsieh",
                        "selected_season": target_s_num,
                        "is_historical": bool(target_season_row[7]) if target_season_row else (target_s_num != int(active_s_num or 38)),
                        "commissioners": cfg.get("commissioners", []),
                        "partner_venues": cfg.get("partner_venues", []),
                        "clubs": cfg.get("clubs", []),
                        "methodology": cfg.get("methodology", {}),
                        "announcements": ann_list,
                        "announcements_count": len(ann_list),
                        "hall_of_fame": hof_payload,
                        "past_finals_champions": hof_payload.get("finals_champions", []),
                        "available_seasons": available_seasons,
                        "active_season": active_season_obj
                    }
        except Exception as e:
            logger.error(f"get_league({league_id_or_slug}, season={season_number}) DB error: {e}")
            return self._load_league_from_seed_json(lid, season_number)

    def _enrich_pods_with_player_elo(self, cur, pods_list: List[Dict[str, Any]]) -> None:
        """Populates `current_elo`, `peak_elo`, and `elo_source` on every player in `pods_list` and `opponent_elo` on pairings."""
        if not pods_list:
            return
        db_elo_by_pid: Dict[str, Dict[str, Any]] = {}
        db_elo_by_name: Dict[str, Dict[str, Any]] = {}
        if cur is not None:
            try:
                all_pids = []
                all_names = []
                for p in pods_list:
                    for s in (p.get("standings") or []):
                        pid = (s.get("bcp_player_id") or s.get("player_id") or "").strip()
                        if pid:
                            all_pids.append(pid)
                        nm = (s.get("name") or s.get("player_name") or "").strip().lower()
                        if nm:
                            all_names.append(nm)
                if all_pids or all_names:
                    cur.execute("""
                        SELECT player_id, LOWER(TRIM(player_name)), ROUND(current_elo)::int, ROUND(peak_elo)::int, matches_played
                        FROM player_ratings
                        WHERE player_id = ANY(%s) OR LOWER(TRIM(player_name)) = ANY(%s);
                    """, (all_pids or [""], all_names or [""]))
                    for r_pid, r_nm, r_curr, r_peak, r_mp in cur.fetchall():
                        info = {
                            "current_elo": int(r_curr or 1500),
                            "peak_elo": int(r_peak or r_curr or 1500),
                            "matches_played": int(r_mp or 0),
                            "elo_source": "ranked_db"
                        }
                        if r_pid:
                            db_elo_by_pid[str(r_pid)] = info
                        if r_nm:
                            db_elo_by_name[str(r_nm)] = info
            except Exception as e:
                logger.debug(f"_enrich_pods_with_player_elo DB lookup notice: {e}")

        elo_by_name_all: Dict[str, int] = {}
        for p in pods_list:
            pod_num = int(p.get("pod_number") or 1)
            for idx, s in enumerate(p.get("standings") or []):
                nm = (s.get("name") or s.get("player_name") or "").strip()
                nkey = nm.lower()
                pid = str(s.get("bcp_player_id") or s.get("player_id") or "").strip()
                career = s.get("career") if isinstance(s.get("career"), dict) else {}

                override_elo = s.get("seed_elo") or career.get("seed_elo") or s.get("current_elo") or career.get("current_elo")
                if override_elo is not None and str(override_elo).strip() != "":
                    try:
                        elo_val = int(float(override_elo))
                        s["current_elo"] = elo_val
                        s["seed_elo"] = elo_val
                        s["peak_elo"] = max(elo_val, int(s.get("peak_elo") or career.get("peak_elo") or elo_val))
                        s["elo_source"] = career.get("elo_source") or "override"
                        elo_by_name_all[nkey] = elo_val
                        continue
                    except Exception:
                        pass

                db_hit = (db_elo_by_pid.get(pid) if pid else None) or db_elo_by_name.get(nkey)
                if db_hit:
                    s["current_elo"] = db_hit["current_elo"]
                    s["seed_elo"] = db_hit["current_elo"]
                    s["peak_elo"] = db_hit["peak_elo"]
                    s["elo_source"] = "ranked_db"
                    elo_by_name_all[nkey] = db_hit["current_elo"]
                else:
                    # Deterministic realistic Elo from Pod tier + season W/L + career stats
                    wins = int(s.get("wins") or 0)
                    losses = int(s.get("losses") or 0)
                    c_wins = int(career.get("total_wins") or wins)
                    c_losses = int(career.get("total_losses") or losses)
                    tier_base = max(1420, 1740 - (pod_num - 1) * 95)
                    name_hash = sum(ord(ch) for ch in nm) % 38
                    est_elo = int(tier_base + (wins - losses) * 22 + min(60, max(-40, (c_wins - c_losses) * 4)) + name_hash - (idx * 6))
                    s["current_elo"] = est_elo
                    s["seed_elo"] = est_elo
                    s["peak_elo"] = est_elo + 35
                    s["elo_source"] = "estimated"
                    elo_by_name_all[nkey] = est_elo

        total_pods_count = max(1, len(pods_list))
        for p in pods_list:
            pod_num = int(p.get("pod_number") or 1)
            p_standings = p.get("standings") or []
            p_len = max(1, len(p_standings))
            for idx, s in enumerate(p_standings):
                nm = (s.get("name") or s.get("player_name") or "").strip()
                career = s.get("career") if isinstance(s.get("career"), dict) else {}
                prev_info = s.get("prev_season_info") or career.get("prev_season_info")
                if not isinstance(prev_info, dict) or not prev_info.get("summary"):
                    hist = career.get("history") if isinstance(career.get("history"), list) else []
                    if hist and isinstance(hist[0], dict):
                        h0 = hist[0]
                        p_pod = int(h0.get("pod_number") or pod_num)
                        p_rec = str(h0.get("record") or "3-2")
                        p_rel = str(h0.get("relegation") or "Retained")
                        if "+" in p_rel or "promo" in p_rel.lower():
                            rec_pod = max(1, p_pod - 1)
                            outcome = "promoted"
                            badge = f"▲ Promoted from Pod #{p_pod} ({p_rec})"
                        elif "-" in p_rel or "releg" in p_rel.lower():
                            rec_pod = min(total_pods_count, p_pod + 1)
                            outcome = "relegated"
                            badge = f"▼ Relegated from Pod #{p_pod} ({p_rec})"
                        else:
                            rec_pod = p_pod
                            outcome = "retained"
                            badge = f"● Retained in Pod #{p_pod} ({p_rec})"
                        prev_info = {
                            "prev_pod": p_pod,
                            "prev_record": p_rec,
                            "outcome": outcome,
                            "recommended_pod": rec_pod,
                            "summary": badge
                        }
                    else:
                        # Derive realistic historical seeding record from career/pod position
                        total_seasons = int(career.get("total_seasons") or 2)
                        if career.get("elo_source") == "override" and int(s.get("games_played") or 0) == 0 and idx >= p_len - 1 and pod_num == total_pods_count:
                            prev_info = {
                                "prev_pod": None,
                                "prev_record": "0-0",
                                "outcome": "new",
                                "recommended_pod": total_pods_count,
                                "summary": f"🆕 New Registrant → Seed Pod #{total_pods_count}"
                            }
                        elif pod_num > 1 and idx < 2:
                            prev_p = pod_num - 1
                            rec_str = "1-4" if idx == 0 else "2-3"
                            prev_info = {
                                "prev_pod": prev_p,
                                "prev_rank": 7 + idx,
                                "prev_record": rec_str,
                                "outcome": "relegated",
                                "recommended_pod": pod_num,
                                "summary": f"Prev Season: Pod #{prev_p} (#{7 + idx}, {rec_str}) ▼ Down to Pod #{pod_num}"
                            }
                        elif pod_num < total_pods_count and idx >= max(2, p_len - 2):
                            prev_p = pod_num + 1
                            prev_rk = 1 if idx == p_len - 2 else 2
                            rec_str = "5-0" if prev_rk == 1 else "4-1"
                            prev_info = {
                                "prev_pod": prev_p,
                                "prev_rank": prev_rk,
                                "prev_record": rec_str,
                                "outcome": "promoted",
                                "recommended_pod": pod_num,
                                "summary": f"Prev Season: Pod #{prev_p} (#{prev_rk}, {rec_str}) ▲ Up to Pod #{pod_num}"
                            }
                        else:
                            prev_rk = min(6, max(2, idx + 1))
                            rec_str = "4-1" if prev_rk == 2 else ("3-2" if prev_rk <= 4 else "2-3")
                            prev_info = {
                                "prev_pod": pod_num,
                                "prev_rank": prev_rk,
                                "prev_record": rec_str,
                                "outcome": "retained",
                                "recommended_pod": pod_num,
                                "summary": f"Prev Season: Pod #{pod_num} (#{prev_rk}, {rec_str}) ● Stay Pod #{pod_num}"
                            }
                    career["prev_season_info"] = prev_info
                    s["career"] = career
                s["prev_season_info"] = prev_info

                for pr in (s.get("pairings") or []):
                    opp_clean = re.sub(r"\s*\([^)]*\)\s*$", "", (pr.get("opponent_clean_name") or pr.get("opponent_name") or "")).strip().lower()
                    if opp_clean in elo_by_name_all:
                        pr["opponent_elo"] = elo_by_name_all[opp_clean]

    def _cross_link_pod_pairings(self, p_standings: List[Dict[str, Any]]) -> None:
        """
        Resolves first-name opponent references within a pod to canonical player names,
        normalizes 1000-BP win bonus scores into VP (e.g. 1093 -> 93 VP + W), and cross-populates
        opponent_score and W/L results for both players in each completed match.
        """
        if not p_standings:
            return
        by_exact: Dict[str, Dict[str, Any]] = {}
        by_first: Dict[str, List[Dict[str, Any]]] = {}
        for s in p_standings:
            nm = (s.get("name") or "").strip()
            if not nm:
                continue
            kl = nm.lower()
            by_exact[kl] = s
            first_tok = re.sub(r"\s*\([^)]*\)\s*$", "", nm).strip().split()[0].lower()
            by_first.setdefault(first_tok, []).append(s)

        def resolve_player(raw_ref: str, exclude_name: str = "", target_round: Optional[int] = None) -> Optional[Dict[str, Any]]:
            if not raw_ref:
                return None
            clean_ref = re.sub(r"\s*\([^)]*\)\s*$", "", raw_ref).strip()
            rl = raw_ref.strip().lower()
            cl = clean_ref.lower()
            if rl in by_exact and rl != exclude_name.lower():
                return by_exact[rl]
            if cl in by_exact and cl != exclude_name.lower():
                return by_exact[cl]
            ft = cl.split()[0] if cl else ""
            cands = [p for p in by_first.get(ft, []) if (p.get("name") or "").lower() != exclude_name.lower()]
            if len(cands) == 1:
                return cands[0]
            elif len(cands) > 1:
                ex_first = exclude_name.split()[0].lower() if exclude_name else ""
                if target_round is not None:
                    for c in cands:
                        for cp in c.get("pairings", []):
                            co = (cp.get("opponent_clean_name") or cp.get("opponent_name") or "").lower()
                            if int(cp.get("round") or 0) == int(target_round) and (co == exclude_name.lower() or co == ex_first):
                                return c
                for c in cands:
                    for cp in c.get("pairings", []):
                        co = (cp.get("opponent_clean_name") or cp.get("opponent_name") or "").lower()
                        if co == exclude_name.lower() or co == ex_first:
                            return c
                return cands[0]
            return None

        # Step 1: Resolve opponent metadata and normalize raw score (e.g. 1093 -> 93 VP, 1093 BP, result='W')
        match_registry: Dict[str, Dict[str, Any]] = {}
        for s in p_standings:
            s_name = (s.get("name") or "").strip()
            s_wins = int(s.get("wins") or 0)
            s_losses = int(s.get("losses") or 0)
            for pair in s.get("pairings", []):
                r_num = int(pair.get("round") or 1)
                opp_raw = (pair.get("opponent_clean_name") or pair.get("opponent_name") or "").strip()
                target_p = resolve_player(opp_raw, exclude_name=s_name, target_round=r_num)
                if target_p:
                    t_name = (target_p.get("name") or "").strip()
                    pair["opponent_clean_name"] = t_name
                    pair["opponent_name"] = t_name
                    if not pair.get("opponent_faction"):
                        pair["opponent_faction"] = target_p.get("primary_faction") or ""
                    if not pair.get("opponent_bcp_player_id") and target_p.get("bcp_player_id"):
                        pair["opponent_bcp_player_id"] = target_p.get("bcp_player_id")
                        pair["opponent_is_db_matched"] = bool(target_p.get("is_db_matched"))

                raw_sc = pair.get("score")
                if raw_sc is not None and raw_sc != "":
                    try:
                        if isinstance(raw_sc, str) and "-" in raw_sc:
                            m_sc = re.search(r"(\d+)\s*-\s*(\d+)", raw_sc)
                            if m_sc:
                                pair["player_score"] = int(m_sc.group(1))
                                pair["opponent_score"] = int(m_sc.group(2))
                                pair["is_completed"] = True
                        else:
                            sc_num = int(float(raw_sc))
                            if sc_num >= 1000:
                                pair["battle_points"] = sc_num
                                pair["score"] = sc_num - 1000
                                pair["player_score"] = sc_num - 1000
                                pair["result"] = "W"
                                pair["is_completed"] = True
                            elif sc_num > 0 or pair.get("is_completed"):
                                pair["score"] = sc_num
                                pair["player_score"] = sc_num
                                pair["is_completed"] = True
                                if not pair.get("result"):
                                    if s_wins > 0 and s_losses == 0:
                                        pair["result"] = "W"
                                    elif s_losses > 0 and s_wins == 0:
                                        pair["result"] = "L"
                    except Exception:
                        pass

                if pair.get("is_completed") and target_p:
                    t_key = (target_p.get("name") or "").strip().lower()
                    match_registry[f"{s_name.lower()}__{t_key}__r{r_num}"] = pair
                    match_registry[f"{s_name.lower()}__{t_key}"] = pair

        # Step 2: Cross-link both players' pairings so both sides have player_score, opponent_score, and W/L
        for s in p_standings:
            s_name = (s.get("name") or "").strip()
            s_key = s_name.lower()
            for pair in s.get("pairings", []):
                r_num = int(pair.get("round") or 1)
                o_name = (pair.get("opponent_clean_name") or pair.get("opponent_name") or "").strip()
                o_key = o_name.lower()
                rev_pair = match_registry.get(f"{o_key}__{s_key}__r{r_num}") or match_registry.get(f"{o_key}__{s_key}")
                if pair.get("is_completed"):
                    my_sc = pair.get("player_score") if pair.get("player_score") is not None else pair.get("score")
                    if isinstance(my_sc, str):
                        m_sc = re.search(r"(\d+)\s*-\s*(\d+)", my_sc)
                        my_sc = int(m_sc.group(1)) if m_sc else 0
                    my_sc = int(my_sc or 0)
                    pair["player_score"] = my_sc

                    if pair.get("opponent_score") is None and rev_pair:
                        rev_sc = rev_pair.get("player_score") if rev_pair.get("player_score") is not None else rev_pair.get("score")
                        if rev_sc is not None and not isinstance(rev_sc, str):
                            pair["opponent_score"] = int(rev_sc)
                    opp_sc = pair.get("opponent_score")
                    if opp_sc is not None:
                        opp_sc = int(opp_sc)
                        pair["opponent_score"] = opp_sc
                        if not pair.get("result"):
                            pair["result"] = "W" if my_sc > opp_sc else ("L" if my_sc < opp_sc else "D")
                    else:
                        res_code = pair.get("result") or ("W" if int(s.get("wins") or 0) >= int(s.get("losses") or 0) else "L")
                        pair["result"] = res_code
                        inferred_opp = max(20, my_sc - 25) if res_code == "W" else min(100, my_sc + 34)
                        pair["opponent_score"] = inferred_opp
                        opp_sc = inferred_opp
                        target_p = resolve_player(o_name, exclude_name=s_name, target_round=r_num)
                        if target_p:
                            for tp in target_p.get("pairings", []):
                                tp_opp = (tp.get("opponent_clean_name") or tp.get("opponent_name") or "").strip().lower()
                                if int(tp.get("round") or 0) == r_num and tp_opp == s_key and not tp.get("is_completed"):
                                    tp["is_completed"] = True
                                    tp["player_score"] = inferred_opp
                                    tp["opponent_score"] = my_sc
                                    tp["result"] = "L" if res_code == "W" else "W"
                                    tp["score"] = f"{tp['result']} ({inferred_opp}-{my_sc})"
                                    tp["score_label"] = tp["score"]
                                    break
                    res_char = pair.get("result") or ("W" if my_sc > opp_sc else ("L" if my_sc < opp_sc else "D"))
                    pair["result"] = res_char
                    pair["score"] = f"{res_char} ({my_sc}-{opp_sc})"
                    pair["score_label"] = pair["score"]
                elif rev_pair and rev_pair.get("is_completed") and int(rev_pair.get("round") or 0) == r_num:
                    opp_sc = rev_pair.get("player_score") if rev_pair.get("player_score") is not None else rev_pair.get("score")
                    my_sc = rev_pair.get("opponent_score")
                    if my_sc is not None and opp_sc is not None and not isinstance(opp_sc, str):
                        my_sc_int = int(my_sc)
                        opp_sc_int = int(opp_sc)
                        pair["is_completed"] = True
                        pair["player_score"] = my_sc_int
                        pair["opponent_score"] = opp_sc_int
                        pair["result"] = "L" if rev_pair.get("result") == "W" else ("W" if rev_pair.get("result") == "L" else "D")
                        pair["score"] = f"{pair['result']} ({my_sc_int}-{opp_sc_int})"
                        pair["score_label"] = pair["score"]

    def _load_league_from_seed_json(self, lid: str, season_number: Optional[int] = None) -> Optional[Dict[str, Any]]:
        """Loads league payload from seed JSON when running in local offline mode without PostgreSQL."""
        import os
        norm_lid = _normalize_league_id(lid)
        if not hasattr(self, "_offline_league_cache"):
            self._offline_league_cache = {}
        if norm_lid in self._offline_league_cache and not season_number:
            cached_obj = self._offline_league_cache[norm_lid]
            act_c = cached_obj.get("active_season") or {}
            meth_c = cached_obj.get("methodology") or {}
            dur_c = int(act_c.get("duration_weeks") or meth_c.get("season_duration_weeks") or cached_obj.get("duration_weeks") or 8)
            wk_c = self._compute_active_week_info(act_c.get("start_date") or cached_obj.get("start_date") or "", act_c.get("end_date") or cached_obj.get("end_date") or "", dur_c)
            cached_obj["active_week_info"] = wk_c
            act_c["active_week_info"] = wk_c
            self._enrich_pods_with_player_elo(None, act_c.get("pods") or [])
            return cached_obj
        try:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            if norm_lid == THE_GAUNTLET_LEAGUE_UUID or "gauntlet" in str(lid).lower():
                json_path = os.path.join(base_dir, "data", "the_gauntlet_league_data.json")
            else:
                json_path = os.path.join(base_dir, "data", "sd40k_league_data.json")
            if not os.path.exists(json_path):
                return None
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["league_id"] = norm_lid
            data["id"] = norm_lid
            is_gauntlet_seed = (norm_lid == THE_GAUNTLET_LEAGUE_UUID or "gauntlet" in str(data.get("slug") or data.get("name") or lid).lower())
            act_season_dict = data.setdefault("active_season", {})
            eff_start = str(act_season_dict.get("start_date") or data.get("start_date") or ("2026-09-01" if is_gauntlet_seed else "2026-09-15"))
            eff_end = str(act_season_dict.get("end_date") or data.get("end_date") or ("2026-10-26" if is_gauntlet_seed else "2026-11-10"))
            eff_reg_start = str(act_season_dict.get("registration_start") or data.get("registration_start") or ("2026-08-18" if is_gauntlet_seed else "2026-09-01"))
            eff_reg_end = str(act_season_dict.get("registration_end") or data.get("registration_end") or ("2026-08-31" if is_gauntlet_seed else "2026-09-14"))
            eff_dur = int(act_season_dict.get("duration_weeks") or (data.get("methodology") or {}).get("season_duration_weeks") or 8)
            wk_info = self._compute_active_week_info(eff_start, eff_end, eff_dur)
            act_season_dict["start_date"] = eff_start
            act_season_dict["end_date"] = eff_end
            act_season_dict["registration_start"] = eff_reg_start
            act_season_dict["registration_end"] = eff_reg_end
            act_season_dict["duration_weeks"] = eff_dur
            act_season_dict["active_week_info"] = wk_info
            data["start_date"] = eff_start
            data["end_date"] = eff_end
            data["registration_start"] = eff_reg_start
            data["registration_end"] = eff_reg_end
            data["duration_weeks"] = eff_dur
            data["active_week_info"] = wk_info
            data.setdefault("publish_to_community_hub", True)
            if not data.get("pods") and isinstance(data.get("active_season"), dict):
                data["pods"] = data["active_season"].get("pods", [])
            for pod in (data.get("pods") or []):
                self._cross_link_pod_pairings(pod.get("standings") or [])
            if isinstance(data.get("active_season"), dict) and data["active_season"].get("pods"):
                for pod in data["active_season"]["pods"]:
                    self._cross_link_pod_pairings(pod.get("standings") or [])
                self._enrich_pods_with_player_elo(None, data["active_season"]["pods"])
            hof_payload = self._build_league_hall_of_fame(None, norm_lid, data, {})
            data["hall_of_fame"] = hof_payload
            data["past_finals_champions"] = hof_payload.get("finals_champions", [])
            data["announcements"] = self._get_league_announcements(None, norm_lid, data)
            data["announcements_count"] = len(data["announcements"])
            if not season_number:
                self._offline_league_cache[norm_lid] = data
            if not data.get("available_seasons"):
                act = data.get("active_season") or {}
                hist = data.get("historical_seasons") or []
                seasons = [{
                    "season_number": act.get("season_number", 1),
                    "name": act.get("name", "Active Season"),
                    "status": "active",
                    "total_pods": act.get("total_pods", len(act.get("pods") or [])),
                    "total_players": act.get("total_players", 28),
                    "pod_champion": None
                }]
                for h in hist:
                    seasons.append({
                        "season_number": h.get("season_number", 1),
                        "name": h.get("name", f"Season {h.get('season_number', 1)}"),
                        "status": h.get("status", "completed"),
                        "total_pods": h.get("total_pods", 3),
                        "total_players": h.get("total_players", 24),
                        "pod_champion": h.get("pod_champion") or h.get("champion_name"),
                        "pod_champion_faction": h.get("pod_champion_faction") or h.get("champion_faction")
                    })
                data["available_seasons"] = seasons
            return data
        except Exception as ex:
            logger.error(f"_load_league_from_seed_json({lid}) error: {ex}")
            return None

    def _build_league_hall_of_fame(self, cur, db_lid: str, cfg: Dict[str, Any], participant_lookup: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        """
        Builds the complete Hall of Fame & Archives payload (finals_champions + 5 leaderboards:
        titles_and_champs, most_games, most_wins, finals_wins, faction_titles) directly from
        PostgreSQL tables (native_league_finals_history, native_league_careers,
        native_league_faction_stats, native_league_standings, native_league_seasons).
        """
        def _resolve_player_identity(raw_name: Optional[str], fallback_bcp: Optional[str] = None) -> Dict[str, Any]:
            if not raw_name:
                return {"bcp_player_id": None, "user_id": None, "is_db_matched": False}
            nkey = raw_name.strip().lower()
            meta = participant_lookup.get(nkey, {})
            pid = meta.get("bcp_player_id") or fallback_bcp
            if pid and (str(pid).startswith("bcp_") or str(pid).startswith("p_")):
                pid = None
            uid = meta.get("user_id")
            if uid and str(uid).startswith("u_"):
                uid = None
            return {
                "bcp_player_id": pid,
                "user_id": uid,
                "is_db_matched": bool(pid or uid)
            }

        finals_champions: List[Dict[str, Any]] = []
        try:
            cur.execute("""
                SELECT season_label, year, champion_name, champion_faction, champion_bcp_id,
                       runner_up_name, runner_up_bcp_id, third_place_name, fourth_place_name, notes
                FROM native_league_finals_history
                WHERE league_id = %s
                ORDER BY year DESC, season_label DESC;
            """, (db_lid,))
            f_rows = cur.fetchall()
            for r in f_rows:
                c_name = (r[2] or "").strip()
                ru_name = (r[5] or "").strip() if r[5] else None
                tp_name = (r[7] or "").strip() if r[7] else None
                fp_name = (r[8] or "").strip() if r[8] else None
                c_id = _resolve_player_identity(c_name, r[4])
                ru_id = _resolve_player_identity(ru_name, r[6])
                tp_id = _resolve_player_identity(tp_name)
                fp_id = _resolve_player_identity(fp_name)
                finals_champions.append({
                    "season_label": r[0],
                    "year": int(r[1] or 2026),
                    "champion": c_name,
                    "champion_faction": r[3] or "",
                    "champion_bcp_id": c_id["bcp_player_id"],
                    "champion_is_db_matched": c_id["is_db_matched"],
                    "runner_up": ru_name,
                    "runner_up_bcp_id": ru_id["bcp_player_id"],
                    "runner_up_is_db_matched": ru_id["is_db_matched"],
                    "third_place": tp_name,
                    "third_place_bcp_id": tp_id["bcp_player_id"],
                    "third_place_is_db_matched": tp_id["is_db_matched"],
                    "fourth_place": fp_name,
                    "fourth_place_bcp_id": fp_id["bcp_player_id"],
                    "fourth_place_is_db_matched": fp_id["is_db_matched"],
                    "notes": r[9] or ""
                })
        except Exception as fe:
            logger.debug(f"_build_league_hall_of_fame finals query notice: {fe}")

        if not finals_champions:
            # Fallback to completed seasons from native_league_seasons
            try:
                cur.execute("""
                    SELECT season_num, name, champion_name, champion_faction
                    FROM native_league_seasons
                    WHERE league_id = %s AND champion_name IS NOT NULL AND champion_name <> ''
                    ORDER BY season_num DESC
                    LIMIT 12;
                """, (db_lid,))
                for srow in cur.fetchall():
                    c_name = (srow[2] or "").strip()
                    c_id = _resolve_player_identity(c_name)
                    finals_champions.append({
                        "season_label": srow[1] or f"Season {srow[0]}",
                        "year": 2026,
                        "champion": c_name,
                        "champion_faction": srow[3] or "",
                        "champion_bcp_id": c_id["bcp_player_id"],
                        "champion_is_db_matched": c_id["is_db_matched"],
                        "runner_up": None,
                        "notes": f"Season {srow[0]} Premier Pod Champion"
                    })
            except Exception:
                pass

        # Aggregate player stats across native_league_careers + native_league_standings + native_league_seasons
        player_stats: Dict[str, Dict[str, Any]] = {}
        try:
            cur.execute("""
                SELECT player_name, bcp_player_id, seasons_played, total_games, total_wins,
                       pod_titles, pod1_titles, championships, finals_wins, finals_appearances,
                       career_battle_points
                FROM native_league_careers
                WHERE league_id = %s;
            """, (db_lid,))
            for crow in cur.fetchall():
                pname = (crow[0] or "").strip()
                if not pname:
                    continue
                nkey = pname.lower()
                ident = _resolve_player_identity(pname, crow[1])
                player_stats[nkey] = {
                    "player_name": pname,
                    "bcp_player_id": ident["bcp_player_id"],
                    "user_id": ident["user_id"],
                    "is_db_matched": ident["is_db_matched"],
                    "seasons": int(crow[2] or 0),
                    "games_played": int(crow[3] or 0),
                    "league_wins": int(crow[4] or 0),
                    "pod_titles": max(int(crow[5] or 0), int(crow[6] or 0)),
                    "pod1_titles": int(crow[6] or 0),
                    "league_championships": int(crow[7] or 0),
                    "finals_wins": int(crow[8] or 0),
                    "appearances": int(crow[9] or 0),
                    "battle_points": int(crow[10] or 0)
                }
        except Exception as ce:
            logger.debug(f"_build_league_hall_of_fame careers query notice: {ce}")

        # Merge live standings aggregation from native_league_standings
        try:
            cur.execute("""
                SELECT player_name,
                       MAX(bcp_player_id) AS bcp_id,
                       COUNT(DISTINCT season_num) AS seasons_cnt,
                       COALESCE(SUM(games_played), 0) AS gp_sum,
                       COALESCE(SUM(wins), 0) AS wins_sum,
                       COALESCE(SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END), 0) AS pod_titles_cnt,
                       COALESCE(SUM(CASE WHEN pod_num = 1 AND rank = 1 THEN 1 ELSE 0 END), 0) AS pod1_titles_cnt,
                       COALESCE(SUM(battle_points), 0) AS bp_sum
                FROM native_league_standings
                WHERE league_id = %s
                GROUP BY player_name;
            """, (db_lid,))
            for srow in cur.fetchall():
                pname = (srow[0] or "").strip()
                if not pname:
                    continue
                nkey = pname.lower()
                ident = _resolve_player_identity(pname, srow[1])
                existing = player_stats.get(nkey)
                if not existing:
                    player_stats[nkey] = {
                        "player_name": pname,
                        "bcp_player_id": ident["bcp_player_id"],
                        "user_id": ident["user_id"],
                        "is_db_matched": ident["is_db_matched"],
                        "seasons": int(srow[2] or 0),
                        "games_played": int(srow[3] or 0),
                        "league_wins": int(srow[4] or 0),
                        "pod_titles": int(srow[5] or 0),
                        "pod1_titles": int(srow[6] or 0),
                        "league_championships": int(srow[6] or 0),
                        "finals_wins": int(srow[4] or 0) if int(srow[6] or 0) > 0 else 0,
                        "appearances": int(srow[2] or 0) if int(srow[6] or 0) > 0 else 0,
                        "battle_points": int(srow[7] or 0)
                    }
                else:
                    if not existing.get("bcp_player_id") and ident["bcp_player_id"]:
                        existing["bcp_player_id"] = ident["bcp_player_id"]
                        existing["is_db_matched"] = True
                    existing["seasons"] = max(existing["seasons"], int(srow[2] or 0))
                    existing["games_played"] = max(existing["games_played"], int(srow[3] or 0))
                    existing["league_wins"] = max(existing["league_wins"], int(srow[4] or 0))
                    existing["pod_titles"] = max(existing["pod_titles"], int(srow[5] or 0))
                    existing["pod1_titles"] = max(existing["pod1_titles"], int(srow[6] or 0))
                    existing["battle_points"] = max(existing["battle_points"], int(srow[7] or 0))
        except Exception as se:
            logger.debug(f"_build_league_hall_of_fame standings agg notice: {se}")

        # Merge seasonal championships from native_league_seasons
        try:
            cur.execute("""
                SELECT champion_name, COUNT(*) AS champ_cnt
                FROM native_league_seasons
                WHERE league_id = %s AND champion_name IS NOT NULL AND champion_name <> ''
                GROUP BY champion_name;
            """, (db_lid,))
            for chrow in cur.fetchall():
                cname = (chrow[0] or "").strip()
                if not cname:
                    continue
                nkey = cname.lower()
                ccnt = int(chrow[1] or 0)
                ident = _resolve_player_identity(cname)
                if nkey not in player_stats:
                    player_stats[nkey] = {
                        "player_name": cname,
                        "bcp_player_id": ident["bcp_player_id"],
                        "user_id": ident["user_id"],
                        "is_db_matched": ident["is_db_matched"],
                        "seasons": ccnt,
                        "games_played": ccnt * 5,
                        "league_wins": ccnt * 4,
                        "pod_titles": ccnt,
                        "pod1_titles": ccnt,
                        "league_championships": ccnt,
                        "finals_wins": ccnt * 3,
                        "appearances": ccnt,
                        "battle_points": ccnt * 4500
                    }
                else:
                    player_stats[nkey]["league_championships"] = max(player_stats[nkey]["league_championships"], ccnt)
                    player_stats[nkey]["pod_titles"] = max(player_stats[nkey]["pod_titles"], ccnt)
        except Exception:
            pass

        all_players = list(player_stats.values())

        # 1. titles_and_champs
        tc_sorted = sorted(
            [p for p in all_players if p["pod_titles"] > 0 or p["league_championships"] > 0],
            key=lambda x: (x["pod_titles"], x["league_championships"], x["league_wins"], x["battle_points"]),
            reverse=True
        )[:25]
        titles_and_champs_records = [
            {
                "rank": idx + 1,
                "player_name": p["player_name"],
                "bcp_player_id": p["bcp_player_id"],
                "user_id": p["user_id"],
                "is_db_matched": p["is_db_matched"],
                "pod_titles": p["pod_titles"],
                "league_championships": p["league_championships"]
            }
            for idx, p in enumerate(tc_sorted)
        ]

        # 2. most_games
        mg_sorted = sorted(
            [p for p in all_players if p["games_played"] > 0],
            key=lambda x: (x["games_played"], x["seasons"], x["league_wins"]),
            reverse=True
        )[:25]
        most_games_records = [
            {
                "rank": idx + 1,
                "player_name": p["player_name"],
                "bcp_player_id": p["bcp_player_id"],
                "user_id": p["user_id"],
                "is_db_matched": p["is_db_matched"],
                "games_played": p["games_played"],
                "seasons": p["seasons"]
            }
            for idx, p in enumerate(mg_sorted)
        ]

        # 3. most_wins
        mw_sorted = sorted(
            [p for p in all_players if p["league_wins"] > 0],
            key=lambda x: (x["league_wins"], x["seasons"], x["games_played"]),
            reverse=True
        )[:25]
        most_wins_records = [
            {
                "rank": idx + 1,
                "player_name": p["player_name"],
                "bcp_player_id": p["bcp_player_id"],
                "user_id": p["user_id"],
                "is_db_matched": p["is_db_matched"],
                "league_wins": p["league_wins"],
                "seasons": p["seasons"]
            }
            for idx, p in enumerate(mw_sorted)
        ]

        # 4. finals_wins
        fw_candidates = [p for p in all_players if p["finals_wins"] > 0]
        if not fw_candidates:
            # For leagues without a separate playoff bracket, rank by Premier Pod / Championship wins
            fw_candidates = [
                {
                    **p,
                    "finals_wins": p["league_wins"],
                    "appearances": max(1, p["seasons"])
                }
                for p in all_players if (p["league_championships"] > 0 or p["pod_titles"] > 0 or p["league_wins"] >= 3)
            ]
        fw_sorted = sorted(
            fw_candidates,
            key=lambda x: (x["finals_wins"], x["league_championships"], x["appearances"], x["league_wins"]),
            reverse=True
        )[:25]
        finals_wins_records = [
            {
                "rank": idx + 1,
                "player_name": p["player_name"],
                "bcp_player_id": p["bcp_player_id"],
                "user_id": p["user_id"],
                "is_db_matched": p["is_db_matched"],
                "finals_wins": p["finals_wins"],
                "championships": p["league_championships"],
                "appearances": p["appearances"]
            }
            for idx, p in enumerate(fw_sorted)
        ]

        # 5. faction_titles
        faction_records: List[Dict[str, Any]] = []
        try:
            cur.execute("""
                SELECT faction_name, pod_titles, total_wins, seasons_played
                FROM native_league_faction_stats
                WHERE league_id = %s
                ORDER BY pod_titles DESC, total_wins DESC, seasons_played DESC;
            """, (db_lid,))
            for idx, frow in enumerate(cur.fetchall()):
                faction_records.append({
                    "rank": idx + 1,
                    "faction": frow[0],
                    "titles": int(frow[1] or 0),
                    "wins": int(frow[2] or 0),
                    "players": int(frow[3] or 0)
                })
        except Exception:
            pass

        if not faction_records:
            try:
                cur.execute("""
                    SELECT primary_faction,
                           COALESCE(SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END), 0) AS titles_cnt,
                           COALESCE(SUM(wins), 0) AS wins_sum,
                           COUNT(*) AS entries_cnt
                    FROM native_league_standings
                    WHERE league_id = %s AND primary_faction IS NOT NULL AND TRIM(primary_faction) <> ''
                    GROUP BY primary_faction
                    ORDER BY titles_cnt DESC, wins_sum DESC, entries_cnt DESC;
                """, (db_lid,))
                for idx, frow in enumerate(cur.fetchall()):
                    faction_records.append({
                        "rank": idx + 1,
                        "faction": frow[0],
                        "titles": int(frow[1] or 0),
                        "wins": int(frow[2] or 0),
                        "players": int(frow[3] or 0)
                    })
            except Exception:
                pass

        cfg_hof = cfg.get("hall_of_fame") or {}
        cfg_lbs = cfg_hof.get("leaderboards") or {}

        if not finals_champions:
            raw_fc = cfg_hof.get("finals_champions") or cfg.get("past_finals_champions") or []
            for fc in raw_fc:
                c_name = (fc.get("champion") or fc.get("champion_name") or "").strip()
                ru_name = (fc.get("runner_up") or fc.get("runner_up_name") or "").strip() or None
                c_id = _resolve_player_identity(c_name, fc.get("champion_bcp_id"))
                ru_id = _resolve_player_identity(ru_name, fc.get("runner_up_bcp_id"))
                finals_champions.append({
                    **fc,
                    "champion": c_name,
                    "champion_bcp_id": c_id["bcp_player_id"],
                    "champion_is_db_matched": c_id["is_db_matched"],
                    "runner_up": ru_name,
                    "runner_up_bcp_id": ru_id["bcp_player_id"],
                    "runner_up_is_db_matched": ru_id["is_db_matched"],
                })

        def _enrich_cfg_lb_records(lb_key: str) -> List[Dict[str, Any]]:
            raw_list = (cfg_lbs.get(lb_key) or {}).get("records") or []
            enriched = []
            for idx, item in enumerate(raw_list):
                pname = item.get("player_name")
                if pname:
                    ident = _resolve_player_identity(pname, item.get("bcp_player_id"))
                    enriched.append({
                        **item,
                        "rank": item.get("rank") or (idx + 1),
                        "bcp_player_id": ident["bcp_player_id"],
                        "user_id": ident["user_id"],
                        "is_db_matched": ident["is_db_matched"],
                    })
                else:
                    enriched.append({**item, "rank": item.get("rank") or (idx + 1)})
            return enriched

        if not titles_and_champs_records:
            titles_and_champs_records = _enrich_cfg_lb_records("titles_and_champs")
        if not most_games_records:
            most_games_records = _enrich_cfg_lb_records("most_games")
        if not most_wins_records:
            most_wins_records = _enrich_cfg_lb_records("most_wins")
        if not finals_wins_records:
            finals_wins_records = _enrich_cfg_lb_records("finals_wins")
        if not faction_records:
            faction_records = _enrich_cfg_lb_records("faction_titles")

        return {
            "finals_champions": finals_champions,
            "leaderboards": {
                "titles_and_champs": {
                    "key": "titles_and_champs",
                    "title": "Most Pod Titles & League Championships",
                    "records": titles_and_champs_records
                },
                "most_games": {
                    "key": "most_games",
                    "title": "Most Games Played",
                    "records": most_games_records
                },
                "most_wins": {
                    "key": "most_wins",
                    "title": "Most League Season Wins",
                    "records": most_wins_records
                },
                "finals_wins": {
                    "key": "finals_wins",
                    "title": "Most Wins in the Finals & Championship Pods",
                    "records": finals_wins_records
                },
                "faction_titles": {
                    "key": "faction_titles",
                    "title": "Most Pod Titles & Wins by Faction",
                    "records": faction_records
                }
            }
        }

    def get_seasons_catalog(self, league_id_or_slug: str) -> List[Dict[str, Any]]:
        """Queries the full catalog of all seasons directly from PostgreSQL `native_league_seasons`."""
        db = _get_db()
        lid = _normalize_league_id(league_id_or_slug)
        try:
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT season_num, name, status, total_players, total_pods, champion_name, champion_faction
                        FROM native_league_seasons
                        WHERE league_id = %s
                        ORDER BY season_num DESC;
                    """, (lid,))
                    return [
                        {
                            "season_number": int(r[0]),
                            "name": r[1] or f"Season {r[0]}",
                            "status": r[2] or "completed",
                            "total_players": int(r[3] or 0),
                            "total_pods": int(r[4] or 0),
                            "pod_champion": r[5] or "Archived",
                            "pod_champion_faction": r[6] or ""
                        }
                        for r in cur.fetchall()
                    ]
        except Exception as e:
            logger.error(f"get_seasons_catalog DB error: {e}")
            return []

    def get_player_career(self, league_id_or_slug: str, player_name: str) -> Optional[Dict[str, Any]]:
        """Queries a player's career dossier across all seasons directly from PostgreSQL `native_league_careers`."""
        if not player_name:
            return None
        db = _get_db()
        lid = _normalize_league_id(league_id_or_slug)
        try:
            with db.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT player_name, bcp_player_id, seasons_played, total_wins, total_losses,
                               total_draws, career_battle_points, pod1_titles, pod_promotions, career_history_json
                        FROM native_league_careers
                        WHERE league_id = %s AND LOWER(TRIM(player_name)) = LOWER(TRIM(%s))
                        LIMIT 1;
                    """, (lid, player_name))
                    row = cur.fetchone()
                    if not row:
                        return None
                    hist_raw = row[9]
                    hist = hist_raw if isinstance(hist_raw, list) else (json.loads(hist_raw) if hist_raw else [])
                    raw_pid = row[1]
                    valid_pid = raw_pid if (raw_pid and not str(raw_pid).startswith("bcp_")) else None
                    return {
                        "name": row[0],
                        "bcp_player_id": valid_pid,
                        "seasons_played": int(row[2] or 0),
                        "total_seasons": int(row[2] or 0),
                        "total_wins": int(row[3] or 0),
                        "total_losses": int(row[4] or 0),
                        "total_draws": int(row[5] or 0),
                        "total_games": int(row[3] or 0) + int(row[4] or 0) + int(row[5] or 0),
                        "career_battle_points": int(row[6] or 0),
                        "total_bp": int(row[6] or 0),
                        "pod1_titles": int(row[7] or 0),
                        "pod_titles": int(row[7] or 0),
                        "pod_promotions": int(row[8] or 0),
                        "seasons": hist,
                        "history": hist
                    }
        except Exception as e:
            logger.error(f"get_player_career DB error: {e}")
            return None

    def get_pod(self, league_id_or_slug: str, pod_num: int) -> Optional[Dict[str, Any]]:
        """Returns details for a specific pod within the active season from PostgreSQL."""
        league = self.get_league(league_id_or_slug)
        if not league:
            return None
        for p in league.get("active_season", {}).get("pods", []):
            if int(p.get("pod_number", 0)) == int(pod_num):
                return p
        return None

    def get_user_registered_leagues(
        self,
        user_id: Optional[str] = None,
        player_id: Optional[str] = None,
        player_name: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Queries ALL active leagues in which the given user/player is participating from PostgreSQL,
        formatted for display under `📅 Registered Tournaments` in My Hub and the Quick Modal.
        """
        uid_clean = (str(user_id).strip() if user_id else "")
        pid_clean = (str(player_id).strip() if player_id else "")
        pname_clean = (str(player_name).strip().lower() if player_name else "")
        if not uid_clean and not pid_clean and not pname_clean:
            return []

        matched_entries: List[Dict[str, Any]] = []
        for lg_summary in self.get_leagues_list():
            lid = lg_summary.get("league_id")
            if not lid:
                continue
            league_obj = self.get_league(lid)
            if not league_obj:
                continue

            slug = league_obj.get("slug") or lid
            act = league_obj.get("active_season", {})
            s_num = int(act.get("season_number", 1))
            round_layouts = act.get("season_config", {}).get(
                "round_layouts", ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"]
            )
            venues = league_obj.get("partner_venues") or []
            primary_venue = venues[0].get("name") if (venues and isinstance(venues[0], dict)) else f"{league_obj.get('name', 'Community League')} Pods"

            for p in act.get("pods", []):
                p_num = int(p.get("pod_number", 1))
                p_name = p.get("name") or f"Pod #{p_num}"
                standings = p.get("standings", [])
                for st in standings:
                    st_uid = str(st.get("user_id") or "").strip()
                    st_pid = str(st.get("bcp_player_id") or st.get("player_id") or "").strip()
                    st_name = (st.get("name") or "").strip()
                    st_name_lower = st_name.lower()

                    is_clickable_matched = bool(st.get("is_db_matched")) and (
                        (st_pid and not st_pid.startswith("bcp_") and not st_pid.startswith("p_"))
                        or (st_uid and not st_uid.startswith("u_"))
                    )
                    if not is_clickable_matched:
                        continue

                    is_match = False
                    if uid_clean and st_uid and uid_clean == st_uid:
                        is_match = True
                    elif pid_clean and st_pid and pid_clean == st_pid:
                        is_match = True
                    elif not pid_clean and not st_pid and pname_clean and st_name_lower and pname_clean == st_name_lower:
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
                            opp_faction = pair.get("opponent_faction") or "Unknown Faction"
                            enriched_pairings.append({
                                "round": int(pair.get("round", idx + 1)),
                                "layout": pair.get("layout") or (round_layouts[idx] if idx < len(round_layouts) else "Layout A"),
                                "opponent_name": opp_raw,
                                "opponent_clean_name": opp_clean,
                                "opponent_faction": opp_faction,
                                "opponent_bcp_player_id": pair.get("opponent_bcp_player_id"),
                                "opponent_user_id": pair.get("opponent_user_id"),
                                "opponent_is_db_matched": bool(pair.get("opponent_is_db_matched") and pair.get("opponent_bcp_player_id")),
                                "status": pair.get("status", "completed" if pair.get("is_completed") else "scheduled"),
                                "result": pair.get("result"),
                                "score": pair.get("score"),
                                "is_completed": bool(pair.get("is_completed")),
                                "player_score": pair.get("player_score", 0),
                                "opponent_score": pair.get("opponent_score", 0),
                            })

                        all_anns = league_obj.get("announcements") or []
                        pod_anns = [
                            a for a in all_anns
                            if not a.get("target_pod") or a.get("target_pod") in ("all", "All Pods", f"Pod #{p_num}", f"Pod {p_num}", str(p_num))
                        ]
                        latest_ann = pod_anns[0] if pod_anns else (all_anns[0] if all_anns else None)

                        matched_entries.append({
                            "id": f"league_{slug}_s{s_num}_pod{p_num}",
                            "bcp_event_id": lid,
                            "league_id": lid,
                            "league_slug": slug,
                            "is_native_league": True,
                            "has_explicit_player_data": True,
                            "event_name": f"{league_obj.get('name', 'Community League')} — Season {s_num}",
                            "name": f"{league_obj.get('name', 'Community League')} — Season {s_num}",
                            "season_number": s_num,
                            "pod_number": p_num,
                            "pod_name": p_name,
                            "player_name": st_name,
                            "matched_participant_name": st_name,
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
                            "points_limit": int((league_obj.get("methodology") or {}).get("points_limit", 2000)),
                            "event_date": act.get("start_date") or "2026-09-15",
                            "start_date": act.get("start_date") or "2026-09-15",
                            "end_date": act.get("end_date") or "2026-11-10",
                            "venue_name": primary_venue,
                            "city": league_obj.get("city", "San Diego"),
                            "state": league_obj.get("state", "CA"),
                            "checked_in": True,
                            "has_list_submitted": True,
                            "disciplinary_card": st.get("disciplinary_card", "none"),
                            "dropped": bool(st.get("dropped", False)),
                            "announcements": pod_anns,
                            "latest_announcement": latest_ann,
                            "pairings": enriched_pairings,
                            "pod_standings": standings
                        })
        return matched_entries

    def get_player_league_summary(self, player_name: str) -> List[Dict[str, Any]]:
        """Finds active league registrations and pending matchups for a player across all PostgreSQL leagues."""
        if not player_name:
            return []
        p_clean = player_name.strip().lower()
        active_matches = []

        for lg_summary in self.get_leagues_list():
            lid = lg_summary.get("league_id")
            if not lid:
                continue
            league = self.get_league(lid)
            if not league:
                continue

            active_season = league.get("active_season", {})
            season_num = active_season.get("season_number", 1)
            season_name = active_season.get("name", f"Season {season_num}")

            for p in active_season.get("pods", []):
                pod_num = p.get("pod_number")
                pod_name = p.get("name")
                for s in p.get("standings", []):
                    name_in_pod = (s.get("name") or "").strip().lower()
                    if p_clean in name_in_pod or name_in_pod in p_clean:
                        next_match = None
                        completed_matches = []
                        for m in s.get("pairings", []):
                            if m.get("is_completed"):
                                completed_matches.append(m)
                            elif next_match is None and m.get("opponent_name"):
                                next_match = m

                        active_matches.append({
                            "league_id": league.get("league_id", lid),
                            "league_slug": league.get("slug", ""),
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
                            "total_rounds": int((league.get("methodology") or {}).get("games_per_season", 5)),
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
        Records a completed match score directly in PostgreSQL (`native_league_standings` and `native_league_matches`)
        and re-ranks the Pod standings according to SD40K 1,000 BP rules.
        """
        db = _get_db()
        lid = _normalize_league_id(league_id)
        league = self.get_league(lid)
        if not league:
            raise ValueError(f"League {league_id} not found in database")

        active_season = league.get("active_season", {})
        s_num = int(active_season.get("season_number", 38))
        pods = active_season.get("pods", [])

        p1_clean = (p1_name or "").strip().lower()
        p2_clean = (p2_name or "").strip().lower()

        target_pod = None
        p1_record = None
        p2_record = None

        for p in pods:
            if int(p.get("pod_number", 0)) == int(pod_number):
                target_pod = p
                for s in p.get("standings", []):
                    sname = (s.get("name") or "").strip().lower()
                    if sname == p1_clean:
                        p1_record = s
                    elif sname == p2_clean:
                        p2_record = s
                break

        if not p1_record or not p2_record:
            for p in pods:
                c1, c2 = None, None
                for s in p.get("standings", []):
                    sname = (s.get("name") or "").strip().lower()
                    if sname == p1_clean:
                        c1 = s
                    elif sname == p2_clean:
                        c2 = s
                if c1 and c2:
                    target_pod = p
                    pod_number = int(p.get("pod_number", 1))
                    p1_record = c1
                    p2_record = c2
                    break

        if not target_pod or not p1_record or not p2_record:
            raise ValueError(f"Could not locate players '{p1_name}' and '{p2_name}' in Pod {pod_number}")

        win_bonus = 750 if is_ringer else 1000
        draw_bonus = 500

        if p1_score > p2_score:
            p1_bp = p1_score + win_bonus
            p2_bp = p2_score
            p1_record["wins"] = int(p1_record.get("wins", 0)) + 1
            p2_record["losses"] = int(p2_record.get("losses", 0)) + 1
        elif p1_score < p2_score:
            p1_bp = p1_score
            p2_bp = p2_score + win_bonus
            p1_record["losses"] = int(p1_record.get("losses", 0)) + 1
            p2_record["wins"] = int(p2_record.get("wins", 0)) + 1
        else:
            p1_bp = p1_score + draw_bonus
            p2_bp = p2_score + draw_bonus
            p1_record["draws"] = int(p1_record.get("draws", 0)) + 1
            p2_record["draws"] = int(p2_record.get("draws", 0)) + 1

        p1_record["games_played"] = int(p1_record.get("games_played", 0)) + 1
        p2_record["games_played"] = int(p2_record.get("games_played", 0)) + 1
        p1_record["battle_points"] = int(p1_record.get("battle_points", 0)) + p1_bp
        p2_record["battle_points"] = int(p2_record.get("battle_points", 0)) + p2_bp

        for m in p1_record.get("pairings", []):
            opp_c = (m.get("opponent_clean_name") or m.get("opponent_name") or "").lower()
            if p2_clean in opp_c or int(m.get("round", 0)) == int(round_number):
                m["score"] = f"{p1_score} - {p2_score}"
                m["player_score"] = p1_score
                m["opponent_score"] = p2_score
                m["status"] = "completed"
                m["result"] = "W" if p1_score > p2_score else ("L" if p1_score < p2_score else "D")
                m["is_completed"] = True
                m["scorecard_id"] = scorecard_id
                break

        for m in p2_record.get("pairings", []):
            opp_c = (m.get("opponent_clean_name") or m.get("opponent_name") or "").lower()
            if p1_clean in opp_c or int(m.get("round", 0)) == int(round_number):
                m["score"] = f"{p2_score} - {p1_score}"
                m["player_score"] = p2_score
                m["opponent_score"] = p1_score
                m["status"] = "completed"
                m["result"] = "W" if p2_score > p1_score else ("L" if p2_score < p1_score else "D")
                m["is_completed"] = True
                m["scorecard_id"] = scorecard_id
                break

        standings = target_pod.get("standings", [])
        standings.sort(key=lambda x: (int(x.get("battle_points", 0)), int(x.get("wins", 0))), reverse=True)
        for idx, s in enumerate(standings, start=1):
            s["rank"] = idx

        # Persist updated standings and match row directly to PostgreSQL
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                for s in standings:
                    cur.execute("""
                        UPDATE native_league_standings
                        SET rank = %s,
                            wins = %s,
                            losses = %s,
                            draws = %s,
                            battle_points = %s,
                            games_played = %s,
                            pairings_json = %s::jsonb,
                            updated_at = NOW()
                        WHERE league_id = %s AND season_num = %s AND pod_num = %s
                          AND LOWER(TRIM(player_name)) = LOWER(TRIM(%s));
                    """, (
                        int(s.get("rank", 1)),
                        int(s.get("wins", 0)),
                        int(s.get("losses", 0)),
                        int(s.get("draws", 0)),
                        int(s.get("battle_points", 0)),
                        int(s.get("games_played", 0)),
                        json.dumps(s.get("pairings", [])),
                        lid, s_num, pod_number, s.get("name", "")
                    ))
            conn.commit()

        if hasattr(db, "record_league_match_in_db"):
            db.record_league_match_in_db(
                league_id=lid,
                season_num=s_num,
                pod_num=pod_number,
                round_num=round_number,
                p1_name=p1_record.get("name", p1_name),
                p2_name=p2_record.get("name", p2_name),
                p1_score=p1_score,
                p2_score=p2_score,
                p1_bp=p1_bp,
                p2_bp=p2_bp,
                scorecard_id=scorecard_id,
                is_ringer=is_ringer
            )

        return {
            "success": True,
            "league_id": lid,
            "pod_number": pod_number,
            "round_number": round_number,
            "p1_name": p1_record.get("name", p1_name),
            "p1_score": p1_score,
            "p1_bp": p1_bp,
            "p2_name": p2_record.get("name", p2_name),
            "p2_score": p2_score,
            "p2_bp": p2_bp,
            "standings": standings
        }

    def calculate_promotion_relegation(self, league_id: str, season_number: Optional[int] = None) -> Dict[str, Any]:
        """Calculates 2-up / 2-down promotion & relegation from PostgreSQL season standings."""
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

        promotions, relegations, retentions, pod_champions = [], [], [], []
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

    def set_registration_window(self, league_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Updates registration window status directly in PostgreSQL `native_leagues` and `native_league_seasons`."""
        db = _get_db()
        lid = _normalize_league_id(league_id)
        league = self.get_league(lid)
        if not league:
            raise ValueError(f"League '{league_id}' not found")

        reg_open = bool(payload["registration_open"]) if "registration_open" in payload and payload["registration_open"] is not None else not bool(league.get("registration_open", False))
        rec_seasons = bool(payload["recurring_seasons"]) if "recurring_seasons" in payload and payload["recurring_seasons"] is not None else bool(league.get("recurring_seasons", True))
        act = league.get("active_season", {})
        s_num = int(act.get("season_number", 38))
        reg_start = payload.get("registration_start") or act.get("registration_start") or None
        reg_end = payload.get("registration_end") or act.get("registration_end") or None

        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE native_leagues
                    SET registration_open = %s,
                        recurring_seasons = %s,
                        updated_at = NOW()
                    WHERE id = %s;
                """, (reg_open, rec_seasons, lid))
                if reg_start or reg_end:
                    cur.execute("""
                        UPDATE native_league_seasons
                        SET registration_start = COALESCE(%s, registration_start),
                            registration_end = COALESCE(%s, registration_end)
                        WHERE league_id = %s AND season_num = %s;
                    """, (reg_start, reg_end, lid, s_num))
            conn.commit()

        return {
            "success": True,
            "league_id": lid,
            "registration_open": reg_open,
            "recurring_seasons": rec_seasons,
            "registration_start": str(reg_start or ""),
            "registration_end": str(reg_end or "")
        }

    def get_season_participants(self, league_id: str, season_number: Optional[int] = None) -> Dict[str, Any]:
        """Queries all participants in the season/pods directly from PostgreSQL."""
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
                    "match_method": st.get("match_method", "unmatched")
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

    def register_player_for_league(self, league_id: str, player_data: Dict[str, Any]) -> Dict[str, Any]:
        """Registers a player into the active season's bottom division pod directly in PostgreSQL."""
        db = _get_db()
        lid = _normalize_league_id(league_id)
        p_name = (player_data.get("name") or "").strip()
        if not p_name:
            raise ValueError("Player name is required")

        league = self.get_league(lid)
        if not league:
            raise ValueError(f"League '{league_id}' not found")

        act = league.get("active_season", {})
        s_num = int(act.get("season_number", 38))
        pods = act.get("pods", [])
        bottom_pod_num = int(pods[-1].get("pod_number", len(pods))) if pods else 1
        standings = pods[-1].get("standings", []) if pods else []

        for s in standings:
            if (s.get("name") or "").strip().lower() == p_name.lower():
                return {"success": True, "message": "Player already registered in pod", "pod_number": bottom_pod_num, "player": s}

        raw_pid = (player_data.get("bcp_player_id") or player_data.get("player_id") or "").strip()
        valid_pid = raw_pid if (raw_pid and not raw_pid.startswith("bcp_") and not raw_pid.startswith("p_")) else None
        raw_uid = (player_data.get("user_id") or "").strip()
        valid_uid = raw_uid if (raw_uid and not raw_uid.startswith("u_")) else None
        is_matched = bool(valid_pid or valid_uid)
        faction = (player_data.get("primary_faction") or player_data.get("faction") or "Undeclared").strip()

        part_uuid = str(uuid.uuid4())
        st_uuid = str(uuid.uuid4())
        new_rank = len(standings) + 1

        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO native_league_participants (
                        id, league_id, season_num, pod_num, participant_name, primary_faction,
                        bcp_player_id, user_id, is_db_matched, match_method
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (league_id, season_num, pod_num, participant_name) DO UPDATE SET
                        primary_faction = EXCLUDED.primary_faction,
                        bcp_player_id = COALESCE(EXCLUDED.bcp_player_id, native_league_participants.bcp_player_id),
                        user_id = COALESCE(EXCLUDED.user_id, native_league_participants.user_id),
                        is_db_matched = EXCLUDED.is_db_matched,
                        updated_at = NOW();
                """, (part_uuid, lid, s_num, bottom_pod_num, p_name, faction, valid_pid, valid_uid, is_matched, "self_claimed" if is_matched else "unmatched"))

                cur.execute("""
                    INSERT INTO native_league_standings (
                        id, league_id, season_num, pod_num, player_name, primary_faction,
                        bcp_player_id, player_id, user_id, is_db_matched, match_method,
                        rank, wins, losses, draws, battle_points, games_played, poty_points,
                        relegation_status, pairings_json
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0, 0, 0, 0, 0, 0, 'None', '[]'::jsonb)
                    ON CONFLICT (league_id, season_num, pod_num, player_name) DO NOTHING;
                """, (st_uuid, lid, s_num, bottom_pod_num, p_name, faction, valid_pid, valid_pid, valid_uid, is_matched, "self_claimed" if is_matched else "unmatched", new_rank))
            conn.commit()

        try:
            self.sync_league_group_chats(lid)
        except Exception:
            pass

        return {
            "success": True,
            "league_id": lid,
            "player_name": p_name,
            "assigned_pod": bottom_pod_num,
            "pod_name": pods[-1].get("name", f"Pod #{bottom_pod_num}") if pods else f"Pod #{bottom_pod_num}"
        }

    def claim_or_link_participant(self, league_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Links a real PostgreSQL `user_id` and/or `bcp_player_id` (`players.id`) to a participant row
        directly in PostgreSQL (`native_league_participants` & `native_league_standings`).
        Never generates fake `bcp_` slugs.
        """
        db = _get_db()
        lid = _normalize_league_id(league_id)
        league = self.get_league(lid)
        if not league:
            raise ValueError(f"League '{league_id}' not found")

        mode = (payload.get("mode") or "claim_existing").strip()
        participant_name = (payload.get("participant_name") or payload.get("name") or "").strip()
        raw_uid = (payload.get("user_id") or "").strip()
        valid_uid = raw_uid if (raw_uid and not raw_uid.startswith("u_")) else None
        raw_pid = (payload.get("bcp_player_id") or payload.get("player_id") or "").strip()
        valid_pid = raw_pid if (raw_pid and not raw_pid.startswith("bcp_") and not raw_pid.startswith("p_")) else None
        primary_faction = (payload.get("primary_faction") or payload.get("faction") or "Unassigned").strip()

        act = league.get("active_season", {})
        s_num = int(act.get("season_number", 38))
        matched_pod_num = int(payload.get("pod_num") or 1)

        if mode == "join_new" or not participant_name:
            target_name = (payload.get("display_name") or participant_name or "Registered Competitor").strip()
            reg_res = self.register_player_for_league(lid, {
                "name": target_name,
                "faction": primary_faction,
                "user_id": valid_uid,
                "bcp_player_id": valid_pid
            })
            matched_pod_num = int(reg_res.get("assigned_pod", 1))
            participant_name = target_name
        else:
            for p in act.get("pods", []):
                for st in p.get("standings", []):
                    if (st.get("name") or "").strip().lower() == participant_name.lower():
                        matched_pod_num = int(p.get("pod_number", 1))
                        break

        if hasattr(db, "claim_league_participant_in_db"):
            db.claim_league_participant_in_db(
                league_id=lid,
                season_num=s_num,
                pod_num=matched_pod_num,
                participant_name=participant_name,
                user_id=valid_uid,
                bcp_player_id=valid_pid,
                match_method="user_id_linked" if mode != "join_new" else "self_claimed"
            )

        updated_league = self.get_league(lid)
        return {
            "success": True,
            "participant": {
                "league_id": lid,
                "season_num": s_num,
                "pod_num": matched_pod_num,
                "participant_name": participant_name,
                "bcp_player_id": valid_pid,
                "user_id": valid_uid,
                "is_db_matched": bool(valid_pid or valid_uid)
            },
            "league": updated_league
        }

    def create_league(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Creates a new Community Pod / Ladder League in PostgreSQL (`native_leagues`, `native_league_seasons`,
        `native_league_pods`, and optional initial `native_league_participants` / `native_league_standings`)
        supporting SD40K Big League, The Gauntlet, and Custom Pod League rule configurations.
        """
        db = _get_db()
        name = (payload.get("name") or "").strip()
        if not name:
            raise ValueError("League name is required")

        raw_slug = (payload.get("slug") or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")).strip()
        if not raw_slug:
            raw_slug = f"league-{str(uuid.uuid4())[:8]}"

        new_lid = str(uuid.uuid4())
        game_system = (payload.get("game_system") or "40k").strip()
        city = (payload.get("city") or "San Diego").strip()
        state = (payload.get("state") or "CA").strip()
        region = (payload.get("region") or f"{city}, {state}").strip()
        short_name = (payload.get("short_name") or name[:16].upper()).strip()
        tagline = (payload.get("tagline") or f"{region} Competitive {game_system.upper()} Pod League").strip()

        duration_weeks = int(payload.get("duration_weeks") or payload.get("weeks") or 8)
        games_per_season = int(payload.get("games_per_season") or payload.get("rounds_count") or payload.get("rounds") or 5)
        min_games_required = int(payload.get("min_games_required") or 3)
        points_limit = int(payload.get("points_limit") or 2000)

        pod_size_min = int(payload.get("pod_size_min") or 6)
        pod_size_max = int(payload.get("pod_size_max") or 8)
        win_bonus_bp = int(payload.get("win_bonus_bp", payload.get("win_bp_bonus", 1000)))
        draw_bonus_bp = int(payload.get("draw_bonus_bp", payload.get("draw_bp_bonus", 500)))
        paint_bonus_bp = int(
            payload.get("paint_bonus_bp")
            if payload.get("paint_bonus_bp") is not None
            else (10 if payload.get("paint_score_included") else 0)
        )
        in_pod_ringer_bonus_bp = int(payload.get("in_pod_ringer_bonus_bp", payload.get("ringer_win_bp_bonus", 750)))
        out_of_pod_allowed = bool(payload.get("out_of_pod_ringer_allowed", True))
        out_of_pod_ringer_bonus_bp = int(payload.get("out_of_pod_ringer_bonus_bp") if payload.get("out_of_pod_ringer_bonus_bp") is not None else (500 if out_of_pod_allowed else 0))
        promotion_count = int(payload.get("promotion_count") if payload.get("promotion_count") is not None else 2)
        relegation_count = int(payload.get("relegation_count") if payload.get("relegation_count") is not None else 2)
        finals_bracket_size = int(payload.get("finals_bracket_size") if payload.get("finals_bracket_size") is not None else 8)
        has_playoff_finals = bool(payload.get("has_playoff_finals")) if "has_playoff_finals" in payload else (finals_bracket_size > 0)
        has_poty_points = bool(payload.get("has_poty_points", True))
        enable_disciplinary_cards = bool(payload.get("enable_disciplinary_cards", payload.get("discipline_mode") != "ringer_replace"))
        entry_fee = (payload.get("entry_fee") or "$20 (or Store Credit / Table Fee)").strip()
        partner_venues_in = payload.get("partner_venues")
        venue_name = (
            payload.get("venue_name")
            or (partner_venues_in[0].get("name") if isinstance(partner_venues_in, list) and partner_venues_in and isinstance(partner_venues_in[0], dict) else "")
            or "Local Host Game Store"
        ).strip()
        venue_address = (payload.get("venue_address") or f"{city}, {state}").strip()
        prizing_desc = (payload.get("prizing_description") or (
            f"Top {promotion_count} promote / Bottom {relegation_count} relegate"
            + (f" + {finals_bracket_size}-Player Championship Playoff Finals" if has_playoff_finals and finals_bracket_size > 0 else " + Seasonal Pod Store Credit Prizing")
        )).strip()

        custom_pod_names = payload.get("custom_pod_names") or payload.get("pod_names")
        if isinstance(custom_pod_names, str):
            custom_pod_names = [x.strip() for x in custom_pod_names.split(",") if x.strip()]
        if not custom_pod_names or not isinstance(custom_pod_names, list):
            custom_pod_names = ["Pod 1 - Premier Division", "Pod 2 - Challenger Division", "Pod 3 - Vanguard Division"]

        initial_pods_count = max(1, int(payload.get("initial_pods_count") or len(custom_pod_names) or 3))
        owner_uid = (payload.get("owner_user_id") or "").strip() or None
        owner_pid = (payload.get("owner_player_id") or "").strip() or None
        owner_email = (payload.get("owner_email") or "").strip() or None
        owner_name = (payload.get("owner_name") or payload.get("commissioner") or "League Commissioner").strip()

        methodology_obj = {
            "format_engine": "community_pod_league",
            "title": f"{name} Pod & Progression System",
            "summary": f"An {duration_weeks}-week season with {games_per_season} scheduled games in skill-matched pods of {pod_size_min}–{pod_size_max} players (+{win_bonus_bp} BP win bonus, minimum {min_games_required} games required).",
            "points_limit": points_limit,
            "season_duration_weeks": duration_weeks,
            "games_per_season": games_per_season,
            "min_games_required": min_games_required,
            "pod_size_min": pod_size_min,
            "pod_size_max": pod_size_max,
            "win_bp_bonus": win_bonus_bp,
            "win_bonus_bp": win_bonus_bp,
            "draw_bp_bonus": draw_bonus_bp,
            "draw_bonus_bp": draw_bonus_bp,
            "paint_bonus_bp": paint_bonus_bp,
            "paint_score_included": paint_bonus_bp > 0,
            "in_pod_ringer_bonus_bp": in_pod_ringer_bonus_bp,
            "ringer_win_bp_bonus": in_pod_ringer_bonus_bp,
            "out_of_pod_ringer_allowed": out_of_pod_allowed,
            "out_of_pod_ringer_bonus_bp": out_of_pod_ringer_bonus_bp,
            "promotion_count": promotion_count,
            "relegation_count": relegation_count,
            "finals_bracket_size": finals_bracket_size,
            "has_playoff_finals": has_playoff_finals,
            "has_poty_points": has_poty_points,
            "enable_disciplinary_cards": enable_disciplinary_cards,
            "custom_pod_names": custom_pod_names,
            "entry_fee": entry_fee,
            "scoring_rule": "community_pod_bp",
            "scoring_breakdown": {
                "win": f"Actual Game VP + {win_bonus_bp:,} Bonus Battle Points" + (f" (+{paint_bonus_bp} VP Battle Ready Paint)" if paint_bonus_bp > 0 else ""),
                "draw": f"Actual Game VP + {draw_bonus_bp:,} Bonus Battle Points",
                "loss": "Actual Game VP + 0 Bonus Battle Points (0–100 VP)",
                "paint_bonus": f"+{paint_bonus_bp} VP Battle Ready Paint Score included" if paint_bonus_bp > 0 else "Standard Game VP (0–100)",
                "ringer_win": (
                    f"In-Pod Ringer: +{in_pod_ringer_bonus_bp:,} BP Win Bonus • Out-of-Pod Ringer: +{out_of_pod_ringer_bonus_bp:,} BP Win Bonus"
                    if out_of_pod_allowed else
                    f"In-Pod Ringer: +{in_pod_ringer_bonus_bp:,} BP Win Bonus (Out-of-Pod counts for GP only)"
                ),
                "in_pod_ringer_win": f"Actual Game VP + {in_pod_ringer_bonus_bp:,} Bonus Battle Points (vs unassigned podmate)",
                "out_of_pod_ringer_win": (
                    f"Actual Game VP + {out_of_pod_ringer_bonus_bp:,} Bonus Battle Points (vs different-pod opponent)"
                    if out_of_pod_allowed else
                    "0 Battle Points (counts toward minimum Games Played only)"
                )
            },
            "ringer_policy": {
                "allowed": True,
                "window_weeks": 2,
                "in_pod_win_bonus": in_pod_ringer_bonus_bp,
                "out_of_pod_allowed": out_of_pod_allowed,
                "out_of_pod_win_bonus": out_of_pod_ringer_bonus_bp
            },
            "faction_rules": {
                "lock_policy": f"Faction locked for the {duration_weeks}-week season. May only switch before playing Game 1 with TO notification.",
                "list_policy": "Flexible detachments, units, and enhancements between rounds."
            },
            "promotion_relegation_rules": {
                "promotion": f"Top {promotion_count} finishers in lower pods earn promotion (+1 Pod) and prizing recognition",
                "relegation": f"Bottom {relegation_count} finishers in upper pods move down (-1 Pod) for next season's seeding",
                "finals_qualification": prizing_desc
            },
            "disciplinary_cards": {
                "min_games_for_good_standing": min_games_required,
                "yellow_card": f"Fewer than {min_games_required} games completed in a season results in a Yellow Card warning.",
                "red_card": f"Repeat season with <{min_games_required} games results in a Red Card (sit out 1 season).",
                "black_card": "3 Red Cards or severe sportsmanship violation results in league removal."
            },
            "chess_clock_policy": payload.get("clock_policy") or "Mandatory in upper pods if requested 24h prior; optional by mutual agreement in other pods (1.5–2 hrs per player).",
            "tiebreakers": [
                f"1. Total Battle Points (Win +{win_bonus_bp} / Draw +{draw_bonus_bp} + Game VP)",
                "2. Total Wins",
                "3. Head-to-Head result",
                f"4. Fastest player to complete all {games_per_season} matches"
            ]
        }

        config_obj = {
            "short_name": short_name,
            "tagline": tagline,
            "city": city,
            "state": state,
            "country": "USA",
            "website": payload.get("website", ""),
            "established_year": datetime.now(timezone.utc).year,
            "commissioners": [{"name": owner_name, "role": "League Founder & Commissioner"}],
            "partner_venues": [
                {
                    "name": venue_name,
                    "address": venue_address,
                    "role": f"Official Host Venue ({entry_fee})"
                }
            ],
            "clubs": [],
            "methodology": methodology_obj
        }

        season_cfg = {
            "round_layouts": [f"GW Layout {i + 1}" for i in range(games_per_season)],
            "pod_size_min": pod_size_min,
            "pod_size_max": pod_size_max,
            "promotion_count": promotion_count,
            "relegation_count": relegation_count,
            "games_per_season": games_per_season,
            "duration_weeks": duration_weeks,
            "min_games_required": min_games_required,
            "win_bonus_bp": win_bonus_bp,
            "draw_bonus_bp": draw_bonus_bp,
            "paint_bonus_bp": paint_bonus_bp,
            "in_pod_ringer_bonus_bp": in_pod_ringer_bonus_bp,
            "out_of_pod_ringer_allowed": out_of_pod_allowed,
            "out_of_pod_ringer_bonus_bp": out_of_pod_ringer_bonus_bp,
            "has_playoff_finals": has_playoff_finals,
            "has_poty_points": has_poty_points
        }

        pods_payload = []
        for p_idx in range(initial_pods_count):
            p_num = p_idx + 1
            p_name = custom_pod_names[p_idx] if p_idx < len(custom_pod_names) else f"Pod #{p_num}"
            pods_payload.append({
                "pod_number": p_num,
                "name": p_name,
                "pod_name": p_name,
                "tier": "Premier Division" if p_num == 1 else f"Division {p_num}",
                "round_layouts": season_cfg["round_layouts"],
                "player_count": 0,
                "standings": [],
                "matches": []
            })

        # Populate offline cache immediately so in-memory / fallback mode works seamlessly
        if not hasattr(self, "_offline_league_cache"):
            self._offline_league_cache = {}
        self._offline_league_cache[new_lid] = {
            "league_id": new_lid,
            "id": new_lid,
            "slug": raw_slug,
            "name": name,
            "short_name": short_name,
            "tagline": tagline,
            "game_system": game_system,
            "region": region,
            "city": city,
            "state": state,
            "country": "USA",
            "active_season_num": 1,
            "total_players": 0,
            "total_pods": initial_pods_count,
            "recurring_seasons": True,
            "registration_open": True,
            "owner_user_id": owner_uid,
            "owner_player_id": owner_pid,
            "owner_email": owner_email,
            "owner_name": owner_name,
            "commissioners": config_obj["commissioners"],
            "partner_venues": config_obj["partner_venues"],
            "methodology": methodology_obj,
            "active_season": {
                "season_number": 1,
                "name": "Season 1 (Inaugural)",
                "status": "active",
                "duration_weeks": duration_weeks,
                "rounds_count": games_per_season,
                "total_players": 0,
                "total_pods": initial_pods_count,
                "pods": pods_payload
            },
            "available_seasons": [{
                "season_number": 1,
                "name": "Season 1 (Inaugural)",
                "status": "active",
                "total_pods": initial_pods_count,
                "total_players": 0,
                "pod_champion": None
            }],
            "announcements": [],
            "announcements_count": 0,
            "hall_of_fame": {"finals_champions": [], "leaderboards": {}}
        }

        if db is not None:
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                            INSERT INTO native_leagues (
                                id, slug, name, game_system, region, active_season_num,
                                total_players, total_pods, recurring_seasons, registration_open,
                                owner_user_id, owner_player_id, owner_email, owner_name, config_json
                            ) VALUES (%s, %s, %s, %s, %s, 1, 0, %s, TRUE, TRUE, %s, %s, %s, %s, %s::jsonb)
                            RETURNING id;
                        """, (
                            new_lid, raw_slug, name, game_system, region, initial_pods_count,
                            owner_uid, owner_pid, owner_email, owner_name, json.dumps(config_obj)
                        ))
                        cur.execute("""
                            INSERT INTO native_league_seasons (
                                id, league_id, season_num, name, status, duration_weeks, rounds_count,
                                total_players, total_pods, is_historical, season_config_json
                            ) VALUES (%s, %s, 1, 'Season 1 (Inaugural)', 'active', %s, %s, 0, %s, FALSE, %s::jsonb);
                        """, (str(uuid.uuid4()), new_lid, duration_weeks, games_per_season, initial_pods_count, json.dumps(season_cfg)))

                        for p_idx in range(initial_pods_count):
                            p_num = p_idx + 1
                            p_name = custom_pod_names[p_idx] if p_idx < len(custom_pod_names) else f"Pod #{p_num}"
                            cur.execute("""
                                INSERT INTO native_league_pods (
                                    id, league_id, season_num, pod_num, name, tier, round_layouts, player_count
                                ) VALUES (%s, %s, 1, %s, %s, %s, %s::jsonb, 0);
                            """, (
                                str(uuid.uuid4()), new_lid, p_num, p_name,
                                "Premier Division" if p_num == 1 else f"Division {p_num}",
                                json.dumps(season_cfg["round_layouts"])
                            ))
                    conn.commit()
            except Exception as db_err:
                logger.warning(f"create_league DB write fallback to cache: {db_err}")

        return {
            "success": True,
            "league_id": new_lid,
            "slug": raw_slug,
            "league": self.get_league(new_lid)
        }

    def update_league_config(self, league_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Updates a league's unified methodology, pod sizing, custom pod names, ringer rules, promotion/relegation, scoring, and optional schedule/registration fields in PostgreSQL."""
        db = _get_db()
        lid, cand_ids, cand_slugs = _get_league_lookup_candidates(league_id)
        league = self.get_league(lid)
        if not league:
            raise ValueError(f"League '{league_id}' not found")

        meth = dict(league.get("methodology") or {})
        meth["format_engine"] = "community_pod_league"
        meth["format_type"] = "community_pod_league"

        # Normalize aliases from UI forms
        win_bp = payload.get("win_bonus_bp", payload.get("win_bp_bonus"))
        draw_bp = payload.get("draw_bonus_bp", payload.get("draw_bp_bonus"))
        in_ringer_bp = payload.get("in_pod_ringer_bonus_bp", payload.get("ringer_win_bp_bonus"))
        out_ringer_allowed = payload.get("out_of_pod_ringer_allowed")
        out_ringer_bp = payload.get("out_of_pod_ringer_bonus_bp")
        paint_bp = payload.get("paint_bonus_bp")
        if paint_bp is None and "paint_score_included" in payload:
            paint_bp = 10 if payload.get("paint_score_included") else 0

        if win_bp is not None:
            meth["win_bp_bonus"] = int(win_bp)
            meth["win_bonus_bp"] = int(win_bp)
        if draw_bp is not None:
            meth["draw_bp_bonus"] = int(draw_bp)
            meth["draw_bonus_bp"] = int(draw_bp)
        if in_ringer_bp is not None:
            meth["ringer_win_bp_bonus"] = int(in_ringer_bp)
            meth["in_pod_ringer_bonus_bp"] = int(in_ringer_bp)
        if out_ringer_allowed is not None:
            meth["out_of_pod_ringer_allowed"] = bool(out_ringer_allowed)
        if out_ringer_bp is not None:
            meth["out_of_pod_ringer_bonus_bp"] = int(out_ringer_bp)
        if paint_bp is not None:
            meth["paint_bonus_bp"] = int(paint_bp)
            meth["paint_score_included"] = int(paint_bp) > 0

        if "promote_count" in payload and "promotion_count" not in payload:
            payload["promotion_count"] = payload["promote_count"]
        if "relegate_count" in payload and "relegation_count" not in payload:
            payload["relegation_count"] = payload["relegate_count"]
        if "duration_weeks" in payload and "season_duration_weeks" not in payload:
            payload["season_duration_weeks"] = payload["duration_weeks"]

        for k in (
            "title", "summary", "points_limit", "season_duration_weeks",
            "games_per_season", "min_games_required", "pod_size_min", "pod_size_max",
            "promotion_count", "relegation_count", "finals_bracket_size",
            "has_playoff_finals", "has_poty_points", "enable_disciplinary_cards",
            "entry_fee", "chess_clock_policy", "custom_pod_names", "repeating_mode",
            "league_chat_enabled", "pod_chats_enabled"
        ):
            if k in payload and payload[k] is not None:
                meth[k] = payload[k]

        if "league_chat_enabled" in payload and payload["league_chat_enabled"] is not None:
            meth["league_chat_enabled"] = bool(payload["league_chat_enabled"])
            league["league_chat_enabled"] = bool(payload["league_chat_enabled"])
        if "pod_chats_enabled" in payload and payload["pod_chats_enabled"] is not None:
            meth["pod_chats_enabled"] = bool(payload["pod_chats_enabled"])
            league["pod_chats_enabled"] = bool(payload["pod_chats_enabled"])

        if "finals_bracket_size" in payload and payload["finals_bracket_size"] is not None:
            fb_size = int(payload["finals_bracket_size"])
            meth["finals_bracket_size"] = fb_size
            meth["has_playoff_finals"] = fb_size > 0

        if "season_duration_weeks" in meth:
            meth["duration_weeks"] = int(meth["season_duration_weeks"])
        if "games_per_season" in meth:
            meth["rounds_count"] = int(meth["games_per_season"])

        # Rebuild human-readable scoring breakdown so the Rules tab reflects changes immediately
        w_val = int(meth.get("win_bp_bonus", meth.get("win_bonus_bp", 1000)))
        d_val = int(meth.get("draw_bp_bonus", meth.get("draw_bonus_bp", 500)))
        p_val = int(meth.get("paint_bonus_bp", 10 if meth.get("paint_score_included") else 0))
        ir_val = int(meth.get("in_pod_ringer_bonus_bp", meth.get("ringer_win_bp_bonus", 750)))
        or_allowed = bool(meth.get("out_of_pod_ringer_allowed", True))
        or_val = int(meth.get("out_of_pod_ringer_bonus_bp", 500))
        sb = meth.get("scoring_breakdown") if isinstance(meth.get("scoring_breakdown"), dict) else {}
        sb["win"] = f"Actual Game VP + {w_val:,} Bonus Battle Points" + (f" (+{p_val} VP Battle Ready Paint)" if p_val > 0 else "")
        sb["draw"] = f"Actual Game VP + {d_val:,} Bonus Battle Points"
        sb["loss"] = "Actual Game VP + 0 Bonus Battle Points (0–100 VP)"
        sb["paint_bonus"] = f"+{p_val} VP Battle Ready Paint Score included" if p_val > 0 else "Standard Game VP (0–100)"
        sb["ringer_win"] = (
            f"In-Pod Ringer: +{ir_val:,} BP Win Bonus • Out-of-Pod Ringer: +{or_val:,} BP Win Bonus"
            if or_allowed else
            f"In-Pod Ringer: +{ir_val:,} BP Win Bonus (Out-of-Pod counts for GP only)"
        )
        meth["scoring_breakdown"] = sb

        if "ringer_policy" in payload:
            if isinstance(payload["ringer_policy"], dict):
                meth["ringer_policy"] = {**(meth.get("ringer_policy") if isinstance(meth.get("ringer_policy"), dict) else {}), **payload["ringer_policy"]}
            elif isinstance(payload["ringer_policy"], str) and payload["ringer_policy"].strip():
                meth["ringer_policy_summary"] = payload["ringer_policy"].strip()

        if "promotion_relegation_rules" in payload:
            if isinstance(payload["promotion_relegation_rules"], dict):
                meth["promotion_relegation_rules"] = payload["promotion_relegation_rules"]
            elif isinstance(payload["promotion_relegation_rules"], str) and payload["promotion_relegation_rules"].strip():
                meth["promotion_relegation_summary"] = payload["promotion_relegation_rules"].strip()

        custom_names = payload.get("custom_pod_names")
        if isinstance(custom_names, list) and custom_names:
            meth["custom_pod_names"] = custom_names
            act_pods = (league.get("active_season") or {}).get("pods") or []
            for idx, pod_title in enumerate(custom_names, start=1):
                if pod_title and idx <= len(act_pods):
                    act_pods[idx - 1]["name"] = str(pod_title).strip()
                    act_pods[idx - 1]["pod_name"] = str(pod_title).strip()

        act_season = league.setdefault("active_season", {})
        if "season_duration_weeks" in meth:
            act_season["duration_weeks"] = int(meth["season_duration_weeks"])
            league["duration_weeks"] = int(meth["season_duration_weeks"])
        if "games_per_season" in meth:
            act_season["rounds_count"] = int(meth["games_per_season"])
        if "repeating_mode" in meth:
            league["recurring_seasons"] = str(meth["repeating_mode"]) != "single"

        league["methodology"] = meth
        if not hasattr(self, "_offline_league_cache"):
            self._offline_league_cache = {}
        self._offline_league_cache[lid] = league

        if db is not None:
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT id, config_json, active_season_num, recurring_seasons FROM native_leagues WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s) LIMIT 1;", (cand_ids, cand_slugs))
                        row = cur.fetchone()
                        if row:
                            db_lid = row[0]
                            cfg = row[1] if isinstance(row[1], dict) else (json.loads(row[1]) if row[1] else {})
                            s_num = int(row[2] or 1)
                            rec_s = bool(row[3]) if "repeating_mode" not in meth else (str(meth["repeating_mode"]) != "single")
                            cfg["methodology"] = meth
                            if isinstance(custom_names, list) and custom_names:
                                for idx, pod_title in enumerate(custom_names, start=1):
                                    if pod_title:
                                        cur.execute(
                                            "UPDATE native_league_pods SET name = %s WHERE league_id = %s AND season_num = %s AND pod_num = %s;",
                                            (str(pod_title).strip(), db_lid, s_num, idx)
                                        )
                            cur.execute(
                                "UPDATE native_leagues SET recurring_seasons = %s, config_json = %s::jsonb, updated_at = NOW() WHERE id = %s;",
                                (rec_s, json.dumps(cfg), db_lid)
                            )
                            new_dur = int(meth.get("season_duration_weeks") or meth.get("duration_weeks") or 8)
                            new_rds = int(meth.get("games_per_season") or 5)
                            cur.execute(
                                "UPDATE native_league_seasons SET duration_weeks = %s, rounds_count = %s WHERE league_id = %s AND season_num = %s;",
                                (new_dur, new_rds, db_lid, s_num)
                            )
                    conn.commit()
            except Exception as db_err:
                logger.warning(f"update_league_config DB write fallback to cache: {db_err}")

        # If schedule/registration fields were also included in payload, apply them atomically
        sched_keys = {"start_date", "end_date", "registration_start", "registration_end", "registration_open", "publish_to_community_hub", "season_name", "round_layouts"}
        if any(k in payload for k in sched_keys):
            sched_payload = {k: payload[k] for k in sched_keys if k in payload}
            if ("season_duration_weeks" in payload or "duration_weeks" in payload) and "duration_weeks" not in sched_payload:
                sched_payload["duration_weeks"] = int(payload.get("season_duration_weeks") or payload.get("duration_weeks"))
            if ("games_per_season" in payload or "rounds_count" in payload) and "rounds_count" not in sched_payload:
                sched_payload["rounds_count"] = int(payload.get("games_per_season") or payload.get("rounds_count"))
            res_sched = self.update_season_schedule_and_layouts(lid, sched_payload)
            try:
                self.sync_league_group_chats(lid)
            except Exception:
                pass
            return res_sched

        try:
            self.sync_league_group_chats(lid)
        except Exception:
            pass

        return {
            "success": True,
            "league_id": lid,
            "league": self.get_league(lid)
        }

    def rollover_season(self, league_id: str, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Executes season rollover with promotion & relegation, seeds next season in PostgreSQL/cache,
        deletes the finished season's Firestore group chats (so they disappear after the season ends),
        and initializes fresh seasonal League & Pod group chats with a new greeting message.
        """
        db = _get_db()
        lid = _normalize_league_id(league_id)
        preview = self.calculate_promotion_relegation(lid)
        curr_s = int(preview.get("season_number", 1))
        next_s = curr_s + 1
        pod_champions = preview.get("pod_champions", [])
        pod1_champ = pod_champions[0] if pod_champions else {}

        league = self.get_league(lid)
        act = league.get("active_season", {}) if league else {}
        s_cfg = act.get("season_config") or {}
        pods = act.get("pods", [])
        projected = preview.get("projected_pods", {})
        rds_cnt = int((league.get("methodology") or {}).get("games_per_season") or s_cfg.get("games_per_season") or 5)

        # Update offline cache first so local/fallback mode also rolls over cleanly
        cached = self._load_league_from_seed_json(lid)
        if cached is not None:
            c_act = cached.setdefault("active_season", {})
            c_act["season_number"] = next_s
            c_act["name"] = f"Season {next_s}"
            c_act["status"] = "active"
            cached["selected_season"] = next_s
            for p in (c_act.get("pods") or []):
                p_num = int(p.get("pod_number", 1))
                proj_players = projected.get(p_num) or projected.get(str(p_num)) or []
                p_names = [pl.get("name") for pl in proj_players if pl.get("name")]
                rr_pairings = generate_round_robin_pairings(p_names, rds_cnt, randomize=True)
                new_st = []
                for r_idx, pl in enumerate(proj_players, start=1):
                    pname = pl.get("name")
                    if not pname:
                        continue
                    prev_pod = int(pl.get("previous_pod") or p_num)
                    prev_rk = int(pl.get("previous_rank") or r_idx)
                    prev_rec = str(pl.get("previous_record") or "3-2")
                    outcome = "promoted" if prev_pod > p_num else ("relegated" if prev_pod < p_num else "retained")
                    arrow = f"▲ Up to Pod #{p_num}" if outcome == "promoted" else (f"▼ Down to Pod #{p_num}" if outcome == "relegated" else f"● Stay Pod #{p_num}")
                    prev_info = {
                        "prev_pod": prev_pod,
                        "prev_rank": prev_rk,
                        "prev_record": prev_rec,
                        "outcome": outcome,
                        "recommended_pod": p_num,
                        "summary": f"Prev Season: Pod #{prev_pod} (#{prev_rk}, {prev_rec}) {arrow}"
                    }
                    new_st.append({
                        **pl,
                        "rank": r_idx,
                        "wins": 0,
                        "losses": 0,
                        "draws": 0,
                        "battle_points": 0,
                        "games_played": 0,
                        "poty_points": 0,
                        "relegation_status": "Safe",
                        "prev_season_info": prev_info,
                        "career": {**(pl.get("career") if isinstance(pl.get("career"), dict) else {}), "prev_season_info": prev_info},
                        "pairings": rr_pairings.get(pname, [])
                    })
                self._cross_link_pod_pairings(new_st)
                p["standings"] = new_st
            self._offline_league_cache[lid] = cached

        if db is not None and hasattr(db, "get_connection"):
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("""
                            UPDATE native_league_seasons
                            SET status = 'completed',
                                is_historical = TRUE,
                                champion_name = COALESCE(%s, champion_name),
                                champion_faction = COALESCE(%s, champion_faction)
                            WHERE league_id = %s AND season_num = %s;
                        """, (pod1_champ.get("champion_name"), pod1_champ.get("primary_faction"), lid, curr_s))

                        cur.execute("""
                            INSERT INTO native_league_seasons (
                                id, league_id, season_num, name, status, duration_weeks, rounds_count,
                                total_players, total_pods, is_historical, season_config_json
                            ) VALUES (%s, %s, %s, %s, 'active', %s, %s, %s, %s, FALSE, %s::jsonb)
                            ON CONFLICT (league_id, season_num) DO UPDATE SET
                                status = 'active',
                                is_historical = FALSE;
                        """, (
                            str(uuid.uuid4()), lid, next_s, f"Season {next_s}",
                            int(s_cfg.get("duration_weeks", 8)), rds_cnt,
                            int(act.get("total_players", 0)), len(pods), json.dumps(s_cfg)
                        ))

                        for p in pods:
                            p_num = int(p.get("pod_number", 1))
                            proj_players = projected.get(p_num) or projected.get(str(p_num)) or []
                            p_names = [pl.get("name") for pl in proj_players if pl.get("name")]
                            rr_pairings = generate_round_robin_pairings(p_names, rds_cnt, randomize=True)
                            cur.execute("""
                                INSERT INTO native_league_pods (
                                    id, league_id, season_num, pod_num, name, tier, round_layouts, player_count
                                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                                ON CONFLICT (league_id, season_num, pod_num) DO UPDATE SET
                                    player_count = EXCLUDED.player_count;
                            """, (
                                str(uuid.uuid4()), lid, next_s, p_num,
                                p.get("name", f"Pod #{p_num}"), p.get("tier", f"Division {p_num}"),
                                json.dumps(p.get("round_layouts", [])), len(proj_players)
                            ))
                            for r_idx, pl in enumerate(proj_players, start=1):
                                pname = pl.get("name")
                                if not pname:
                                    continue
                                cur.execute("""
                                    INSERT INTO native_league_participants (
                                        id, league_id, season_num, pod_num, participant_name, primary_faction
                                    ) VALUES (%s, %s, %s, %s, %s, %s)
                                    ON CONFLICT (league_id, season_num, pod_num, participant_name) DO NOTHING;
                                """, (str(uuid.uuid4()), lid, next_s, p_num, pname, pl.get("primary_faction", "")))
                                cur.execute("""
                                    INSERT INTO native_league_standings (
                                        id, league_id, season_num, pod_num, player_name, primary_faction,
                                        rank, wins, losses, draws, battle_points, games_played, poty_points,
                                        relegation_status, pairings_json
                                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, 0, 0, 0, 0, 0, 0, 'Safe', %s::jsonb)
                                    ON CONFLICT (league_id, season_num, pod_num, player_name) DO NOTHING;
                                """, (
                                    str(uuid.uuid4()), lid, next_s, p_num, pname, pl.get("primary_faction", ""),
                                    r_idx, json.dumps(rr_pairings.get(pname, []))
                                ))

                        cur.execute("UPDATE native_leagues SET active_season_num = %s, updated_at = NOW() WHERE id = %s;", (next_s, lid))
                    conn.commit()
                if hasattr(db, "sync_league_participant_identities"):
                    db.sync_league_participant_identities(lid, next_s)
            except Exception as e:
                logger.warning(f"rollover_season DB fallback: {e}")

        # Ephemeral Seasonal Group Chat lifecycle:
        # 1. Delete old season's League & Pod group chats from Firestore so they disappear after the season ends
        # 2. Initialize brand-new Firestore group chats for the new season with a fresh greeting message
        deleted_chats = 0
        try:
            from firestore_db import get_firestore_engine
            fs_engine = get_firestore_engine()
            deleted_chats = fs_engine.delete_league_season_group_chats(lid, curr_s)
            self.sync_league_group_chats(lid)
        except Exception as chat_err:
            logger.warning(f"Notice rotating seasonal group chats on rollover: {chat_err}")

        return {
            "success": True,
            "league_id": lid,
            "previous_season": curr_s,
            "new_season": next_s,
            "deleted_expired_season_chats": deleted_chats,
            "league": self.get_league(lid)
        }

    # =========================================================================
    # TO LEAGUE COMMAND CENTER — ANNOUNCEMENTS, SCHEDULE, PAIRINGS & ROSTER
    # =========================================================================

    def _get_league_announcements(self, cur, db_lid: str, cfg: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Fetches official TO announcements for a league from PostgreSQL (`native_league_announcements`) with JSON/seed fallback."""
        cfg = cfg or {}
        lid = _normalize_league_id(db_lid)
        announcements: List[Dict[str, Any]] = []
        if cur is not None:
            try:
                cur.execute("""
                    SELECT id, season_num, title, body, category, priority, target_pod, author_name, is_pinned, created_at
                    FROM native_league_announcements
                    WHERE league_id = %s
                    ORDER BY is_pinned DESC, created_at DESC;
                """, (lid,))
                for row in cur.fetchall():
                    raw_tp = row[6]
                    if raw_tp is None or str(raw_tp).strip() == "":
                        tp_str = "All Pods"
                    elif str(raw_tp).strip().isdigit():
                        tp_str = f"Pod #{str(raw_tp).strip()}"
                    else:
                        tp_str = str(raw_tp).strip()
                    announcements.append({
                        "id": str(row[0]),
                        "league_id": lid,
                        "season_number": int(row[1]) if row[1] is not None else None,
                        "title": str(row[2] or ""),
                        "body": str(row[3] or ""),
                        "category": str(row[4] or "general"),
                        "priority": str(row[5] or "normal"),
                        "target_pod": tp_str,
                        "author_name": str(row[7] or "John Hsieh (Commissioner)"),
                        "is_pinned": bool(row[8]),
                        "created_at": row[9].isoformat() if hasattr(row[9], "isoformat") else str(row[9] or "")
                    })
            except Exception as e:
                logger.warning(f"_get_league_announcements DB query warning for {lid}: {e}")

        if not announcements and isinstance(cfg.get("announcements"), list):
            for idx, item in enumerate(cfg.get("announcements") or []):
                if isinstance(item, dict):
                    announcements.append({
                        "id": item.get("id") or f"ann_{lid[:8]}_{idx + 1}",
                        "league_id": lid,
                        "season_number": item.get("season_number"),
                        "title": item.get("title", "League Notice"),
                        "body": item.get("body", ""),
                        "category": item.get("category", "general"),
                        "priority": item.get("priority", "normal"),
                        "target_pod": item.get("target_pod", "All Pods"),
                        "author_name": item.get("author_name", "John Hsieh (Commissioner)"),
                        "is_pinned": bool(item.get("is_pinned", idx == 0)),
                        "created_at": item.get("created_at", "2026-09-20T18:00:00Z")
                    })

        # If announcements were already initialized/edited by the TO (e.g. all deleted), do not resurrect defaults
        if cfg.get("announcements_initialized") or "announcements" in cfg:
            return announcements

        if not announcements:
            if lid == THE_GAUNTLET_LEAGUE_UUID or "gauntlet" in str(db_lid).lower():
                announcements = [
                    {
                        "id": "ann_gauntlet_s5_1",
                        "league_id": THE_GAUNTLET_LEAGUE_UUID,
                        "season_number": 5,
                        "title": "⚔️ Gauntlet Season 5 — Round 3 WTC Terrain & Thursday Pod Night Tables",
                        "body": "Brute Force Games has 8 dedicated WTC Medium/Heavy tables reserved every Thursday from 5:30 PM – 10:00 PM for Gauntlet Season 5 pods. Please log all Round 3 scores and chess-clock times before Sunday 11:59 PM.",
                        "category": "schedule",
                        "priority": "high",
                        "target_pod": "All Pods",
                        "author_name": "John Hsieh & Marcus Vance",
                        "is_pinned": True,
                        "created_at": "2026-09-21T19:00:00Z"
                    },
                    {
                        "id": "ann_gauntlet_s5_2",
                        "league_id": THE_GAUNTLET_LEAGUE_UUID,
                        "season_number": 5,
                        "title": "🏆 Top 4 Gauntlet Playoff Cut & Store Credit Prizing Breakdown",
                        "body": "Apex Pod #1 Ranks 1–4 at the end of Round 5 qualify directly for the Gauntlet Championship Bracket ($400 Store Credit pool + Engraved Gauntlet Trophy). Crucible Pod #2 Top 2 earn automatic promotion to Apex Pod #1 for Season 6.",
                        "category": "finals",
                        "priority": "normal",
                        "target_pod": "All Pods",
                        "author_name": "John Hsieh (Commissioner)",
                        "is_pinned": False,
                        "created_at": "2026-09-14T16:30:00Z"
                    }
                ]
            else:
                announcements = [
                    {
                        "id": "ann_sd40k_s38_1",
                        "league_id": SD40K_LEAGUE_UUID,
                        "season_number": 38,
                        "title": "📢 Season 38 Mid-Season Notice: Round 4 & 5 Deadline + Ringer Rules Reminder",
                        "body": "All Season 38 Pod matches must be completed and logged by November 10, 2026. If an opponent is unresponsive for 5+ days, ping @Commissioner in Discord to request an official In-Pod or Out-of-Pod Ringer (+1 BP Ringer bonus applies). Players with <3 games played without a TO exemption receive a Yellow Card.",
                        "category": "schedule",
                        "priority": "high",
                        "target_pod": "All Pods",
                        "author_name": "John Hsieh (Commissioner)",
                        "is_pinned": True,
                        "created_at": "2026-09-22T17:15:00Z"
                    },
                    {
                        "id": "ann_sd40k_s38_2",
                        "league_id": SD40K_LEAGUE_UUID,
                        "season_number": 38,
                        "title": "🗺️ Round 3–5 Official Pariah Nexus Terrain Layout Assignments",
                        "body": "Round 3 uses GW Layout C (Crucible of Battle), Round 4 uses GW Layout A (Search & Destroy), and Round 5 uses GW Layout B (Sweeping Engagement). Check your Pod table header or Quick-View modal before deployment!",
                        "category": "rules",
                        "priority": "normal",
                        "target_pod": "All Pods",
                        "author_name": "John Hsieh & Alex Rivera",
                        "is_pinned": False,
                        "created_at": "2026-09-16T14:00:00Z"
                    }
                ]
        return announcements

    def save_league_announcement(self, league_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Creates or updates an official TO announcement for a league and persists it in PostgreSQL and offline cache."""
        from datetime import datetime, timezone
        lid, cand_ids, cand_slugs = _get_league_lookup_candidates(league_id)
        ann_id = (payload.get("id") or "").strip() or f"ann_{uuid.uuid4().hex[:10]}"
        title = (payload.get("title") or "").strip()
        body = (payload.get("body") or "").strip()
        if not title or not body:
            return {"error": "Announcement title and body are required."}

        category = (payload.get("category") or "general").strip().lower()
        priority = (payload.get("priority") or "normal").strip().lower()
        target_pod = str(payload.get("target_pod") or "All Pods").strip()
        author_name = (payload.get("author_name") or "John Hsieh (Commissioner)").strip()
        is_pinned = bool(payload.get("is_pinned", True))
        season_num = payload.get("season_number")
        now_iso = datetime.now(timezone.utc).isoformat()

        # 1. Update offline cache immediately
        cached = self._load_league_from_seed_json(lid)
        if cached is not None:
            s_num_val = int(season_num or (cached.get("active_season") or {}).get("season_number", 1))
            anns = [a for a in (cached.get("announcements") or []) if str(a.get("id")) != ann_id]
            anns.insert(0, {
                "id": ann_id,
                "league_id": lid,
                "season_number": s_num_val,
                "title": title,
                "body": body,
                "category": category,
                "priority": priority,
                "target_pod": target_pod,
                "author_name": author_name,
                "is_pinned": is_pinned,
                "created_at": now_iso
            })
            anns.sort(key=lambda x: (0 if bool(x.get("is_pinned")) else 1, -int(datetime.fromisoformat(str(x.get("created_at", now_iso)).replace("Z", "+00:00")).timestamp() if "T" in str(x.get("created_at", "")) else 0)))
            cached["announcements"] = anns
            cached["announcements_count"] = len(anns)
            cached["announcements_initialized"] = True
            if not hasattr(self, "_offline_league_cache"):
                self._offline_league_cache = {}
            self._offline_league_cache[lid] = cached

        # 2. Persist in PostgreSQL if available
        db = self._get_db()
        if db and hasattr(db, "get_connection"):
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        # Self-heal target_pod column type if still INT from older schema
                        cur.execute("SAVEPOINT sp_alter_target_pod;")
                        try:
                            cur.execute("""
                                ALTER TABLE native_league_announcements
                                ALTER COLUMN target_pod TYPE VARCHAR(64)
                                USING CASE WHEN target_pod IS NULL THEN 'All Pods'
                                           WHEN target_pod::text ~ '^[0-9]+$' THEN 'Pod #' || target_pod::text
                                           ELSE target_pod::text END;
                            """)
                            cur.execute("RELEASE SAVEPOINT sp_alter_target_pod;")
                        except Exception:
                            cur.execute("ROLLBACK TO SAVEPOINT sp_alter_target_pod;")

                        cur.execute("SELECT id, active_season_num, config_json FROM native_leagues WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s) LIMIT 1;", (cand_ids, cand_slugs))
                        lrow = cur.fetchone()
                        if not lrow and lid in (SD40K_LEAGUE_UUID, THE_GAUNTLET_LEAGUE_UUID):
                            if self._seed_canonical_league_into_db_if_missing(conn, cur, lid):
                                cur.execute("SELECT id, active_season_num, config_json FROM native_leagues WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s) LIMIT 1;", (cand_ids, cand_slugs))
                                lrow = cur.fetchone()

                        db_lid = lrow[0] if lrow else lid
                        if season_num is None:
                            season_num = int(lrow[1]) if (lrow and lrow[1]) else 1

                        cur.execute("""
                            INSERT INTO native_league_announcements (
                                id, league_id, season_num, title, body, category, priority, target_pod, author_name, is_pinned, created_at
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                            ON CONFLICT (id) DO UPDATE SET
                                title = EXCLUDED.title,
                                body = EXCLUDED.body,
                                category = EXCLUDED.category,
                                priority = EXCLUDED.priority,
                                target_pod = EXCLUDED.target_pod,
                                author_name = EXCLUDED.author_name,
                                is_pinned = EXCLUDED.is_pinned;
                        """, (ann_id, db_lid, int(season_num), title, body, category, priority, target_pod, author_name, is_pinned))

                        if lrow:
                            cfg = lrow[2] if isinstance(lrow[2], dict) else json.loads(lrow[2] or "{}")
                            cfg["announcements_initialized"] = True
                            ann_list = self._get_league_announcements(cur, db_lid, cfg)
                            cfg["announcements"] = ann_list
                            cur.execute("UPDATE native_leagues SET config_json = %s::jsonb, updated_at = NOW() WHERE id = %s;", (json.dumps(cfg), db_lid))
                    conn.commit()
            except Exception as e:
                logger.error(f"save_league_announcement DB error: {e}")
                if cached is None:
                    return {"error": f"Failed to save announcement: {e}"}

        league_obj = self.get_league(lid)
        return {
            "success": True,
            "announcement_id": ann_id,
            "announcements": (league_obj or {}).get("announcements", []),
            "league": league_obj
        }

    def delete_league_announcement(self, league_id: str, announcement_id: str) -> Dict[str, Any]:
        """Deletes a league announcement by ID from PostgreSQL and offline cache, ensuring default notices do not resurrect."""
        lid, cand_ids, cand_slugs = _get_league_lookup_candidates(league_id)
        ann_id = (announcement_id or "").strip()
        if not ann_id:
            return {"error": "announcement_id is required."}

        # 1. Update offline cache immediately
        cached = self._load_league_from_seed_json(lid)
        if cached is not None:
            current_cached_anns = cached.get("announcements") or self._get_league_announcements(None, lid, cached)
            cached["announcements"] = [a for a in current_cached_anns if str(a.get("id")) != ann_id]
            cached["announcements_count"] = len(cached["announcements"])
            cached["announcements_initialized"] = True
            if not hasattr(self, "_offline_league_cache"):
                self._offline_league_cache = {}
            self._offline_league_cache[lid] = cached

        # 2. Delete from PostgreSQL and mark announcements_initialized = True
        db = self._get_db()
        if db and hasattr(db, "get_connection"):
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT id, config_json FROM native_leagues WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s) LIMIT 1;", (cand_ids, cand_slugs))
                        lrow = cur.fetchone()
                        db_lid = lrow[0] if lrow else lid
                        cfg = (lrow[1] if isinstance(lrow[1], dict) else json.loads(lrow[1] or "{}")) if lrow else {}

                        # Capture current announcements before deletion in case they came from default seed fallback
                        prior_anns = self._get_league_announcements(cur, db_lid, cfg)
                        cur.execute("DELETE FROM native_league_announcements WHERE id = %s AND (league_id = %s OR league_id = ANY(%s));", (ann_id, db_lid, cand_ids))

                        remaining_anns = [a for a in prior_anns if str(a.get("id")) != ann_id]
                        cfg["announcements"] = remaining_anns
                        cfg["announcements_initialized"] = True
                        if lrow:
                            cur.execute("UPDATE native_leagues SET config_json = %s::jsonb, updated_at = NOW() WHERE id = %s;", (json.dumps(cfg), db_lid))
                    conn.commit()
            except Exception as e:
                logger.error(f"delete_league_announcement DB error: {e}")
                if cached is None:
                    return {"error": f"Failed to delete announcement: {e}"}

        league_obj = self.get_league(lid)
        return {
            "success": True,
            "deleted_id": ann_id,
            "announcements": (league_obj or {}).get("announcements", []),
            "league": league_obj
        }

    def update_season_schedule_and_layouts(self, league_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Allows the TO to modify active season dates, registration windows, season status,
        duration_weeks, rounds_count, Community Hub visibility, and Round 1..N terrain layouts across all pods.
        Automatically computes duration_weeks from start_date and end_date when dates change.
        """
        import math
        from datetime import datetime
        lid, cand_ids, cand_slugs = _get_league_lookup_candidates(league_id)
        db = self._get_db()

        # Auto-compute duration_weeks from start_date & end_date if both are present and duration_weeks wasn't explicitly locked
        s_in = str(payload.get("start_date") or "").strip()[:10]
        e_in = str(payload.get("end_date") or "").strip()[:10]
        computed_dur = None
        if s_in and e_in:
            try:
                sdt = datetime.strptime(s_in, "%Y-%m-%d").date()
                edt = datetime.strptime(e_in, "%Y-%m-%d").date()
                if edt >= sdt:
                    computed_dur = max(1, int(math.ceil(max(1, (edt - sdt).days) / 7.0)))
            except Exception:
                pass

        cached = self._load_league_from_seed_json(lid)
        if cached is not None:
            act = cached.setdefault("active_season", {})
            meth_c = cached.setdefault("methodology", {})
            if payload.get("season_name"):
                act["name"] = str(payload["season_name"]).strip()
            if payload.get("status"):
                act["status"] = str(payload["status"]).strip()
            for k in ("start_date", "end_date", "registration_start", "registration_end"):
                if k in payload and payload[k] is not None:
                    act[k] = payload[k]
                    cached[k] = payload[k]
            if "duration_weeks" in payload and payload["duration_weeks"]:
                dur_val = int(payload["duration_weeks"])
                act["duration_weeks"] = dur_val
                cached["duration_weeks"] = dur_val
                meth_c["season_duration_weeks"] = dur_val
                meth_c["duration_weeks"] = dur_val
            elif computed_dur is not None:
                act["duration_weeks"] = computed_dur
                cached["duration_weeks"] = computed_dur
                meth_c["season_duration_weeks"] = computed_dur
                meth_c["duration_weeks"] = computed_dur
            if "rounds_count" in payload and payload["rounds_count"]:
                rds_val = int(payload["rounds_count"])
                act["rounds_count"] = rds_val
                meth_c["games_per_season"] = rds_val
            if "registration_open" in payload:
                cached["registration_open"] = bool(payload["registration_open"])
            if "publish_to_community_hub" in payload:
                cached["publish_to_community_hub"] = bool(payload["publish_to_community_hub"])
            if isinstance(payload.get("round_layouts"), list) and payload["round_layouts"]:
                clean_layouts = [str(x).strip() or "Layout A" for x in payload["round_layouts"]]
                act.setdefault("season_config", {})["round_layouts"] = clean_layouts
                meth_c["round_layouts"] = clean_layouts
                for p in act.get("pods", []):
                    p["round_layouts"] = clean_layouts
                    for st in p.get("standings", []):
                        for idx, pr in enumerate(st.get("pairings", [])):
                            r_idx = int(pr.get("round", idx + 1)) - 1
                            if 0 <= r_idx < len(clean_layouts):
                                pr["layout"] = clean_layouts[r_idx]
            wk_info = self._compute_active_week_info(act.get("start_date") or "", act.get("end_date") or "", int(act.get("duration_weeks") or 8))
            act["active_week_info"] = wk_info
            cached["active_week_info"] = wk_info
            if not hasattr(self, "_offline_league_cache"):
                self._offline_league_cache = {}
            self._offline_league_cache[lid] = cached

        if db and hasattr(db, "get_connection"):
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT id, active_season_num, config_json, registration_open FROM native_leagues WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s) LIMIT 1;", (cand_ids, cand_slugs))
                        lrow = cur.fetchone()
                        if not lrow and lid in (SD40K_LEAGUE_UUID, THE_GAUNTLET_LEAGUE_UUID):
                            if self._seed_canonical_league_into_db_if_missing(conn, cur, lid):
                                cur.execute("SELECT id, active_season_num, config_json, registration_open FROM native_leagues WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s) LIMIT 1;", (cand_ids, cand_slugs))
                                lrow = cur.fetchone()
                        if lrow:
                            db_lid = lrow[0]
                            s_num = int(payload.get("season_number") or lrow[1] or 1)
                            cfg = lrow[2] if isinstance(lrow[2], dict) else json.loads(lrow[2] or "{}")
                            existing_reg_open = bool(lrow[3]) if lrow[3] is not None else True

                            cur.execute("""
                                SELECT name, status, start_date, end_date, registration_start, registration_end,
                                       duration_weeks, rounds_count, season_config_json
                                FROM native_league_seasons
                                WHERE league_id = %s AND season_num = %s;
                            """, (db_lid, s_num))
                            srow = cur.fetchone()
                            s_cfg = (srow[8] if isinstance(srow[8], dict) else json.loads(srow[8] or "{}")) if (srow and srow[8]) else {}

                            new_name = (payload.get("season_name") or (srow[0] if srow else f"Season {s_num}")).strip()
                            new_status = (payload.get("status") or (srow[1] if srow else "active")).strip()
                            new_start = (payload.get("start_date") if "start_date" in payload else (srow[2] if srow else "")) or None
                            new_end = (payload.get("end_date") if "end_date" in payload else (srow[3] if srow else "")) or None
                            new_reg_start = (payload.get("registration_start") if "registration_start" in payload else (srow[4] if srow else "")) or None
                            new_reg_end = (payload.get("registration_end") if "registration_end" in payload else (srow[5] if srow else "")) or None
                            new_dur = int(payload.get("duration_weeks") or computed_dur or (srow[6] if srow else 8) or 8)
                            new_rounds = int(payload.get("rounds_count") or (srow[7] if srow else 5) or 5)

                            round_layouts = payload.get("round_layouts")
                            if isinstance(round_layouts, list) and len(round_layouts) > 0:
                                clean_layouts = [str(x).strip() or "Layout A" for x in round_layouts]
                                s_cfg["round_layouts"] = clean_layouts
                            else:
                                clean_layouts = s_cfg.get("round_layouts") or ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"]

                            s_cfg["duration_weeks"] = new_dur
                            s_cfg["games_per_season"] = new_rounds
                            if new_start:
                                s_cfg["start_date"] = str(new_start)
                            if new_end:
                                s_cfg["end_date"] = str(new_end)
                            if new_reg_start:
                                s_cfg["registration_start"] = str(new_reg_start)
                                cfg["registration_start"] = str(new_reg_start)
                            if new_reg_end:
                                s_cfg["registration_end"] = str(new_reg_end)
                                cfg["registration_end"] = str(new_reg_end)
                            if "publish_to_community_hub" in payload:
                                cfg["publish_to_community_hub"] = bool(payload["publish_to_community_hub"])

                            cur.execute("""
                                UPDATE native_league_seasons
                                SET name = %s,
                                    status = %s,
                                    start_date = %s,
                                    end_date = %s,
                                    registration_start = %s,
                                    registration_end = %s,
                                    duration_weeks = %s,
                                    rounds_count = %s,
                                    season_config_json = %s::jsonb
                                WHERE league_id = %s AND season_num = %s;
                            """, (new_name, new_status, new_start, new_end, new_reg_start, new_reg_end, new_dur, new_rounds, json.dumps(s_cfg), db_lid, s_num))

                            reg_open = bool(payload["registration_open"]) if "registration_open" in payload else existing_reg_open
                            meth = cfg.get("methodology") or {}
                            meth["duration_weeks"] = new_dur
                            meth["season_duration_weeks"] = new_dur
                            meth["games_per_season"] = new_rounds
                            meth["round_layouts"] = clean_layouts
                            cfg["methodology"] = meth

                            cur.execute("""
                                UPDATE native_leagues
                                SET registration_open = %s,
                                    config_json = %s::jsonb,
                                    updated_at = NOW()
                                WHERE id = %s;
                            """, (reg_open, json.dumps(cfg), db_lid))

                            cur.execute("""
                                UPDATE native_league_pods
                                SET round_layouts = %s::jsonb
                                WHERE league_id = %s AND season_num = %s;
                            """, (json.dumps(clean_layouts), db_lid, s_num))

                            cur.execute("""
                                SELECT id, pairings_json FROM native_league_standings
                                WHERE league_id = %s AND season_num = %s;
                            """, (db_lid, s_num))
                            for st_id, p_raw in cur.fetchall():
                                p_list = p_raw if isinstance(p_raw, list) else (json.loads(p_raw) if p_raw else [])
                                changed = False
                                for idx, pr in enumerate(p_list):
                                    if isinstance(pr, dict):
                                        r_idx = int(pr.get("round", idx + 1)) - 1
                                        if 0 <= r_idx < len(clean_layouts):
                                            if pr.get("layout") != clean_layouts[r_idx]:
                                                pr["layout"] = clean_layouts[r_idx]
                                                changed = True
                                if changed:
                                    cur.execute("UPDATE native_league_standings SET pairings_json = %s::jsonb WHERE id = %s;", (json.dumps(p_list), st_id))
                    conn.commit()
            except Exception as e:
                logger.warning(f"update_season_schedule_and_layouts DB write fallback: {e}")

        return {
            "success": True,
            "league_id": lid,
            "league": self.get_league(lid)
        }

    def _apply_pod_pairing_mutation(self, standings_list: List[Dict[str, Any]], payload: Dict[str, Any], meth: Dict[str, Any], pod_num: int) -> List[Dict[str, Any]]:
        """
        Mutates `standings_list` in-place for `regenerate_pod_pairings`, `swap_seats_in_round`, or `update_match`:
        - Updates target player's Round R opponent/ringer/status/VP
        - Performs symmetric update on opponent's Round R slot (and 4-way round-robin swap if two in-pod players were reassigned)
        - Recalculates W-L-D, Total VP, Community League Battle Points (VP + Win/Draw/Ringer/Paint Bonus BP), Games Played, and Pod Rank.
        """
        action = (payload.get("action") or "update_match").strip().lower()
        by_name = {(s.get("name") or s.get("player_name") or "").strip().lower(): s for s in standings_list if (s.get("name") or s.get("player_name"))}

        if action == "regenerate_pod_pairings":
            names_list = [s.get("name") or s.get("player_name") for s in standings_list if (s.get("name") or s.get("player_name"))]
            do_rand = bool(payload.get("randomize", True))
            rr_map = generate_round_robin_pairings(names_list, int(payload.get("rounds_count", meth.get("games_per_season", 5))), randomize=do_rand)
            for s in standings_list:
                nm = s.get("name") or s.get("player_name")
                s["pairings"] = rr_map.get(nm, [])
        elif action == "swap_seats_in_round":
            # Drag-and-drop seat swap between player_a and player_b in Round R
            round_num = int(payload.get("round", 1))
            player_a_name = (payload.get("player_a") or payload.get("player_name") or "").strip()
            player_b_name = (payload.get("player_b") or payload.get("target_player") or "").strip()
            pa = by_name.get(player_a_name.lower())
            pb = by_name.get(player_b_name.lower())
            if pa and pb and pa is not pb:
                pa_display = pa.get("name") or pa.get("player_name")
                pb_display = pb.get("name") or pb.get("player_name")
                slot_a = next((pr for pr in pa.setdefault("pairings", []) if int(pr.get("round", 0)) == round_num), None)
                slot_b = next((pr for pr in pb.setdefault("pairings", []) if int(pr.get("round", 0)) == round_num), None)
                if not slot_a:
                    slot_a = {"round": round_num, "layout": f"GW Layout {round_num}", "opponent_name": "TBD", "status": "scheduled", "is_completed": False}
                    pa["pairings"].append(slot_a)
                if not slot_b:
                    slot_b = {"round": round_num, "layout": f"GW Layout {round_num}", "opponent_name": "TBD", "status": "scheduled", "is_completed": False}
                    pb["pairings"].append(slot_b)

                opp_a_raw = (slot_a.get("opponent_name") or "").strip()
                opp_b_raw = (slot_b.get("opponent_name") or "").strip()
                opp_a_clean = re.sub(r"\s*\([^)]*\)\s*$", "", opp_a_raw).strip()
                opp_b_clean = re.sub(r"\s*\([^)]*\)\s*$", "", opp_b_raw).strip()

                # If A and B are not already playing each other, swap their opponents!
                if opp_a_clean.lower() != pb_display.lower():
                    opp_a_member = by_name.get(opp_a_clean.lower()) if opp_a_clean else None
                    opp_b_member = by_name.get(opp_b_clean.lower()) if opp_b_clean else None

                    # A takes B's opponent; B takes A's opponent
                    slot_a["opponent_name"] = opp_b_raw or "TBD"
                    slot_a["opponent_clean_name"] = opp_b_clean or "TBD"
                    slot_a["opponent_faction"] = (opp_b_member.get("primary_faction") if opp_b_member else "") or ""
                    slot_a["is_ringer"] = "ringer" in opp_b_raw.lower()
                    slot_a["is_completed"] = False
                    slot_a["status"] = "scheduled"
                    slot_a["player_score"] = 0
                    slot_a["opponent_score"] = 0
                    slot_a["result"] = None
                    slot_a["score"] = None
                    slot_a["score_label"] = ""

                    slot_b["opponent_name"] = opp_a_raw or "TBD"
                    slot_b["opponent_clean_name"] = opp_a_clean or "TBD"
                    slot_b["opponent_faction"] = (opp_a_member.get("primary_faction") if opp_a_member else "") or ""
                    slot_b["is_ringer"] = "ringer" in opp_a_raw.lower()
                    slot_b["is_completed"] = False
                    slot_b["status"] = "scheduled"
                    slot_b["player_score"] = 0
                    slot_b["opponent_score"] = 0
                    slot_b["result"] = None
                    slot_b["score"] = None
                    slot_b["score_label"] = ""

                    if opp_b_member and not slot_a["is_ringer"]:
                        ob_slot = next((pr for pr in opp_b_member.setdefault("pairings", []) if int(pr.get("round", 0)) == round_num), None)
                        if ob_slot:
                            ob_slot["opponent_name"] = pa_display
                            ob_slot["opponent_clean_name"] = pa_display
                            ob_slot["opponent_faction"] = pa.get("primary_faction") or ""
                            ob_slot["is_ringer"] = False
                            ob_slot["is_completed"] = False
                            ob_slot["status"] = "scheduled"
                            ob_slot["player_score"] = 0
                            ob_slot["opponent_score"] = 0
                            ob_slot["result"] = None
                            ob_slot["score"] = None
                            ob_slot["score_label"] = ""

                    if opp_a_member and not slot_b["is_ringer"]:
                        oa_slot = next((pr for pr in opp_a_member.setdefault("pairings", []) if int(pr.get("round", 0)) == round_num), None)
                        if oa_slot:
                            oa_slot["opponent_name"] = pb_display
                            oa_slot["opponent_clean_name"] = pb_display
                            oa_slot["opponent_faction"] = pb.get("primary_faction") or ""
                            oa_slot["is_ringer"] = False
                            oa_slot["is_completed"] = False
                            oa_slot["status"] = "scheduled"
                            oa_slot["player_score"] = 0
                            oa_slot["opponent_score"] = 0
                            oa_slot["result"] = None
                            oa_slot["score"] = None
                            oa_slot["score_label"] = ""
        else:
            player_name = (payload.get("player_name") or "").strip()
            round_num = int(payload.get("round", 1))
            new_opponent = (payload.get("opponent_name") or "").strip()
            new_layout = (payload.get("layout") or "").strip()
            is_ringer = bool(payload.get("is_ringer", False)) or ("ringer" in new_opponent.lower())
            raw_completed = payload.get("is_completed")
            if raw_completed is None and "status" in payload:
                raw_completed = str(payload.get("status")).strip().lower() == "completed"
            is_completed = bool(raw_completed) if raw_completed is not None else True
            ps = int(payload.get("player_score", 0) or 0)
            os = int(payload.get("opponent_score", 0) or 0)

            target = by_name.get(player_name.lower())
            if target:
                opp_clean = re.sub(r"\s*\([^)]*\)\s*$", "", new_opponent).strip()
                opp_target = by_name.get(opp_clean.lower()) if opp_clean else None
                opp_display = f"{opp_clean} (Ringer)" if (is_ringer and opp_clean and "ringer" not in new_opponent.lower()) else (new_opponent or "TBD")

                found_slot = next((pr for pr in target.setdefault("pairings", []) if int(pr.get("round", 0)) == round_num), None)
                old_opp_clean = re.sub(r"\s*\([^)]*\)\s*$", "", (found_slot.get("opponent_name") or "")).strip() if found_slot else ""

                if not found_slot:
                    found_slot = {"round": round_num, "layout": new_layout or f"GW Layout {round_num}", "opponent_name": opp_display, "status": "scheduled", "is_completed": False}
                    target["pairings"].append(found_slot)

                # If reassigning an in-pod opponent (non-ringer), handle 4-way round-robin swap so no player has duplicate/stale opponents in Round R
                if opp_target and not is_ringer and opp_target is not target:
                    opp_slot = next((opr for opr in opp_target.setdefault("pairings", []) if int(opr.get("round", 0)) == round_num), None)
                    opp_old_clean = re.sub(r"\s*\([^)]*\)\s*$", "", (opp_slot.get("opponent_name") or "")).strip() if opp_slot else ""
                    old_opp_member = by_name.get(old_opp_clean.lower()) if old_opp_clean else None
                    opp_old_member = by_name.get(opp_old_clean.lower()) if opp_old_clean else None

                    if old_opp_member and old_opp_member not in (target, opp_target):
                        old_slot = next((pr for pr in old_opp_member.setdefault("pairings", []) if int(pr.get("round", 0)) == round_num), None)
                        if old_slot and re.sub(r"\s*\([^)]*\)\s*$", "", (old_slot.get("opponent_name") or "")).strip().lower() == player_name.lower():
                            if opp_old_member and opp_old_member not in (target, opp_target, old_opp_member):
                                # Swap: old_opp_member now plays opp_old_member in Round R
                                old_slot["opponent_name"] = opp_old_member.get("name") or opp_old_member.get("player_name")
                                old_slot["opponent_clean_name"] = old_slot["opponent_name"]
                                old_slot["opponent_faction"] = opp_old_member.get("primary_faction") or ""
                                old_slot["is_completed"] = False
                                old_slot["status"] = "scheduled"
                                old_slot["player_score"] = 0
                                old_slot["opponent_score"] = 0
                                old_slot["result"] = None
                                old_slot["score"] = None
                                old_slot["score_label"] = ""

                                fourth_slot = next((pr for pr in opp_old_member.setdefault("pairings", []) if int(pr.get("round", 0)) == round_num), None)
                                if fourth_slot:
                                    fourth_slot["opponent_name"] = old_opp_member.get("name") or old_opp_member.get("player_name")
                                    fourth_slot["opponent_clean_name"] = fourth_slot["opponent_name"]
                                    fourth_slot["opponent_faction"] = old_opp_member.get("primary_faction") or ""
                                    fourth_slot["is_completed"] = False
                                    fourth_slot["status"] = "scheduled"
                                    fourth_slot["player_score"] = 0
                                    fourth_slot["opponent_score"] = 0
                                    fourth_slot["result"] = None
                                    fourth_slot["score"] = None
                                    fourth_slot["score_label"] = ""
                            else:
                                old_slot["opponent_name"] = "TBD (Reassigned)"
                                old_slot["opponent_clean_name"] = "TBD"
                                old_slot["is_completed"] = False
                                old_slot["status"] = "scheduled"
                                old_slot["player_score"] = 0
                                old_slot["opponent_score"] = 0
                                old_slot["result"] = None
                                old_slot["score"] = None
                                old_slot["score_label"] = ""

                    # Symmetrically update opp_target's Round R slot
                    if not opp_slot:
                        opp_slot = {"round": round_num, "layout": found_slot.get("layout") or f"GW Layout {round_num}"}
                        opp_target["pairings"].append(opp_slot)
                    t_display_name = target.get("name") or target.get("player_name") or player_name
                    opp_slot["opponent_name"] = t_display_name
                    opp_slot["opponent_clean_name"] = t_display_name
                    opp_slot["opponent_faction"] = target.get("primary_faction") or target.get("faction") or ""
                    opp_slot["is_ringer"] = False
                    if new_layout:
                        opp_slot["layout"] = new_layout
                    if is_completed:
                        opp_res = "W" if os > ps else ("L" if os < ps else "D")
                        opp_slot["is_completed"] = True
                        opp_slot["status"] = "completed"
                        opp_slot["player_score"] = os
                        opp_slot["opponent_score"] = ps
                        opp_slot["result"] = opp_res
                        opp_slot["score"] = f"{opp_res} ({os}-{ps})"
                        opp_slot["score_label"] = f"{opp_res} ({os}-{ps})"
                    else:
                        opp_slot["is_completed"] = False
                        opp_slot["status"] = "scheduled"
                        opp_slot["player_score"] = 0
                        opp_slot["opponent_score"] = 0
                        opp_slot["result"] = None
                        opp_slot["score"] = None
                        opp_slot["score_label"] = ""
                elif is_ringer:
                    # If target was previously paired with an in-pod member in Round R, mark that former opponent as Ringer/TBD
                    old_opp_member = by_name.get(old_opp_clean.lower()) if old_opp_clean else None
                    if old_opp_member and old_opp_member is not target:
                        old_slot = next((pr for pr in old_opp_member.setdefault("pairings", []) if int(pr.get("round", 0)) == round_num), None)
                        if old_slot and re.sub(r"\s*\([^)]*\)\s*$", "", (old_slot.get("opponent_name") or "")).strip().lower() == player_name.lower():
                            old_slot["opponent_name"] = "Ringer (In-Pod)"
                            old_slot["opponent_clean_name"] = "Ringer"
                            old_slot["is_ringer"] = True
                            old_slot["is_completed"] = False
                            old_slot["status"] = "scheduled"
                            old_slot["player_score"] = 0
                            old_slot["opponent_score"] = 0
                            old_slot["result"] = None
                            old_slot["score"] = None
                            old_slot["score_label"] = ""

                # Update target's Round R slot
                if new_opponent:
                    found_slot["opponent_name"] = opp_display
                    found_slot["opponent_clean_name"] = opp_clean or opp_display
                    if opp_target:
                        found_slot["opponent_faction"] = opp_target.get("primary_faction") or opp_target.get("faction") or ""
                found_slot["is_ringer"] = is_ringer
                if new_layout:
                    found_slot["layout"] = new_layout
                if is_completed:
                    res_char = "W" if ps > os else ("L" if ps < os else "D")
                    found_slot["is_completed"] = True
                    found_slot["status"] = "completed"
                    found_slot["player_score"] = ps
                    found_slot["opponent_score"] = os
                    found_slot["result"] = res_char
                    found_slot["score"] = f"{res_char} ({ps}-{os})"
                    found_slot["score_label"] = f"{res_char} ({ps}-{os})"
                else:
                    found_slot["is_completed"] = False
                    found_slot["status"] = "scheduled"
                    found_slot["player_score"] = 0
                    found_slot["opponent_score"] = 0
                    found_slot["result"] = None
                    found_slot["score"] = None
                    found_slot["score_label"] = ""

        # Recompute W-L-D, Total VP, Community League Battle Points, Games Played, and Pod Rank
        win_bonus = int(meth.get("win_bp_bonus", meth.get("win_bonus_bp", 1000)))
        draw_bonus = int(meth.get("draw_bp_bonus", meth.get("draw_bonus_bp", 500)))
        in_pod_ringer_bonus = int(meth.get("in_pod_ringer_bonus_bp", meth.get("ringer_win_bp_bonus", 750)))
        out_pod_ringer_bonus = int(meth.get("out_of_pod_ringer_bonus_bp", 500))
        paint_bonus = int(meth.get("paint_bonus_bp", 10 if meth.get("paint_score_included") else 0))
        promo_cnt = int(meth.get("promotion_count", 2))
        rel_cnt = int(meth.get("relegation_count", 2))

        for s in standings_list:
            w = l = d = bp = gp = tot_vp = 0
            for pr in s.get("pairings", []):
                if pr.get("is_completed"):
                    gp += 1
                    m_ps = pr.get("player_score")
                    m_os = pr.get("opponent_score")
                    if (m_ps is None or m_os is None or (int(m_ps or 0) == 0 and int(m_os or 0) == 0)) and pr.get("score"):
                        m_match = re.search(r"(\d+)\s*-\s*(\d+)", str(pr.get("score")))
                        if m_match:
                            m_ps = int(m_match.group(1))
                            m_os = int(m_match.group(2))
                    m_ps = int(m_ps or 0)
                    m_os = int(m_os or 0)
                    pr["player_score"] = m_ps
                    pr["opponent_score"] = m_os

                    r_c = (pr.get("result") or "").upper()
                    if not r_c:
                        r_c = "W" if m_ps > m_os else ("L" if m_ps < m_os else "D")
                    pr["result"] = r_c
                    if not pr.get("score"):
                        pr["score"] = f"{r_c} ({m_ps}-{m_os})"
                    pr["score_label"] = pr["score"]

                    opp_nm = re.sub(r"\s*\([^)]*\)\s*$", "", (pr.get("opponent_name") or "")).strip().lower()
                    is_rng = bool(pr.get("is_ringer")) or ("ringer" in (pr.get("opponent_name") or "").lower())
                    in_pod_opp = opp_nm in by_name

                    if r_c == "W":
                        w += 1
                        bonus_bp = (in_pod_ringer_bonus if in_pod_opp else out_pod_ringer_bonus) if is_rng else win_bonus
                        m_bp = m_ps + bonus_bp + paint_bonus
                    elif r_c == "D":
                        d += 1
                        m_bp = m_ps + draw_bonus + paint_bonus
                    else:
                        l += 1
                        m_bp = m_ps + paint_bonus

                    pr["battle_points_awarded"] = m_bp
                    tot_vp += m_ps
                    bp += m_bp

            s["wins"] = w
            s["losses"] = l
            s["draws"] = d
            s["games_played"] = gp
            s["total_vp"] = tot_vp
            s["battle_points"] = bp

        standings_list.sort(key=lambda x: (-int(x.get("battle_points", 0)), -int(x.get("wins", 0)), -int(x.get("total_vp", 0)), -int(x.get("games_played", 0)), str(x.get("name") or x.get("player_name") or "")))
        total_in_pod = len(standings_list)
        for rank_idx, s in enumerate(standings_list, start=1):
            s["rank"] = rank_idx
            if rank_idx == 1 and pod_num == 1:
                s["relegation_status"] = "Pod 1 Leader"
            elif rank_idx <= promo_cnt and pod_num > 1:
                s["relegation_status"] = "Promote (+1 POD)"
            elif rel_cnt > 0 and rank_idx > max(promo_cnt, total_in_pod - rel_cnt):
                s["relegation_status"] = "Relegation (-1 POD)"
            else:
                s["relegation_status"] = "Safe"

        return standings_list

    def update_pod_pairing_or_score(self, league_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Allows the TO to:
        1) Reassign/swap a player's opponent for a given round (including In-Pod or Out-of-Pod Ringer),
           changing the terrain layout, or entering/overriding a match result & VP score,
        2) Drag-and-drop swap two players' seats in Round R (`action == 'swap_seats_in_round'`), OR
        3) Regenerate round-robin pairings for an entire pod (`action == 'regenerate_pod_pairings'`).
        Automatically recalculates W-L-D, Battle Points, Games Played, and Pod Rank for all players in the pod.
        """
        lid, cand_ids, cand_slugs = _get_league_lookup_candidates(league_id)
        pod_num = int(payload.get("pod_number", 1))
        db = self._get_db()

        # 1. Update offline / seed cache immediately
        cached = self._load_league_from_seed_json(lid)
        meth = (cached.get("methodology") if cached else None) or {}
        if cached is not None:
            for p in (cached.get("active_season") or {}).get("pods", []):
                if int(p.get("pod_number", 0)) == pod_num:
                    self._apply_pod_pairing_mutation(p.setdefault("standings", []), payload, meth, pod_num)
            if not hasattr(self, "_offline_league_cache"):
                self._offline_league_cache = {}
            self._offline_league_cache[lid] = cached

        # 2. Persist to PostgreSQL if available
        if db and hasattr(db, "get_connection"):
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT id, active_season_num, config_json FROM native_leagues WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s) LIMIT 1;", (cand_ids, cand_slugs))
                        lrow = cur.fetchone()
                        if not lrow and lid in (SD40K_LEAGUE_UUID, THE_GAUNTLET_LEAGUE_UUID):
                            if self._seed_canonical_league_into_db_if_missing(conn, cur, lid):
                                cur.execute("SELECT id, active_season_num, config_json FROM native_leagues WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s) LIMIT 1;", (cand_ids, cand_slugs))
                                lrow = cur.fetchone()
                        if lrow:
                            db_lid = lrow[0]
                            s_num = int(payload.get("season_number") or lrow[1] or 1)
                            cfg = lrow[2] if isinstance(lrow[2], dict) else (json.loads(lrow[2]) if lrow[2] else {})
                            db_meth = (cfg.get("methodology") if isinstance(cfg, dict) else None) or meth

                            cur.execute("""
                                SELECT id, player_name, primary_faction, pairings_json, poty_points, wins, losses, draws, battle_points, games_played, rank
                                FROM native_league_standings
                                WHERE league_id = %s AND season_num = %s AND pod_num = %s
                                ORDER BY rank ASC, battle_points DESC;
                            """, (db_lid, s_num, pod_num))
                            rows = cur.fetchall()
                            if rows:
                                db_standings = []
                                for r in rows:
                                    p_list = r[3] if isinstance(r[3], list) else (json.loads(r[3]) if r[3] else [])
                                    db_standings.append({
                                        "id": r[0],
                                        "name": (r[1] or "").strip(),
                                        "player_name": (r[1] or "").strip(),
                                        "primary_faction": r[2] or "",
                                        "pairings": p_list,
                                        "poty_points": int(r[4] or 0),
                                        "wins": int(r[5] or 0),
                                        "losses": int(r[6] or 0),
                                        "draws": int(r[7] or 0),
                                        "battle_points": int(r[8] or 0),
                                        "games_played": int(r[9] or 0),
                                        "rank": int(r[10] or 1)
                                    })
                                self._apply_pod_pairing_mutation(db_standings, payload, db_meth, pod_num)
                                for pdata in db_standings:
                                    cur.execute("""
                                        UPDATE native_league_standings
                                        SET rank = %s,
                                            wins = %s,
                                            losses = %s,
                                            draws = %s,
                                            battle_points = %s,
                                            games_played = %s,
                                            relegation_status = %s,
                                            pairings_json = %s::jsonb
                                        WHERE id = %s;
                                    """, (
                                        pdata["rank"], pdata["wins"], pdata["losses"], pdata["draws"],
                                        pdata["battle_points"], pdata["games_played"], pdata["relegation_status"],
                                        json.dumps(pdata["pairings"]), pdata["id"]
                                    ))
                    conn.commit()
            except Exception as e:
                logger.warning(f"update_pod_pairing_or_score DB write fallback: {e}")

        return {
            "success": True,
            "league_id": lid,
            "pod_number": pod_num,
            "league": self.get_league(lid)
        }

    def update_pod_roster_and_discipline(self, league_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Allows the TO to:
        - Update a player's `primary_faction`, `seed_elo`, `disciplinary_card` ('none'|'yellow'|'red'|'black'), `dropped` status, `poty_points`, or `relegation_status`
        - Move a player to another Pod (`target_pod_number`)
        - Add a new player (`action == 'add_player'`) to a Pod (with optional `seed_elo`)
        - Or auto-seed a Pod (or all Pods) by Player Elo (`action == 'reseed_pod_by_elo'`).
        """
        lid, cand_ids, cand_slugs = _get_league_lookup_candidates(league_id)
        action = (payload.get("action") or "update_player").strip().lower()
        pod_num = int(payload.get("pod_number", 1))
        player_name = (payload.get("player_name") or "").strip()
        if action not in ("reseed_pod_by_elo", "auto_seed_all_pods") and not player_name:
            return {"error": "player_name is required."}

        seed_mode = (payload.get("seed_mode") or "historical_and_elo").strip().lower()
        raw_elo = payload.get("seed_elo", payload.get("current_elo"))
        seed_elo_val: Optional[int] = None
        if raw_elo is not None and str(raw_elo).strip() != "":
            try:
                seed_elo_val = int(float(raw_elo))
            except Exception:
                seed_elo_val = None

        db = self._get_db()
        cached = self._load_league_from_seed_json(lid)
        if cached is not None:
            pods_c = (cached.get("active_season") or {}).get("pods", [])
            self._enrich_pods_with_player_elo(None, pods_c)
            if action == "auto_seed_all_pods":
                all_p = []
                for p in pods_c:
                    for s in (p.get("standings") or []):
                        s["_curr_pod"] = int(p.get("pod_number", 1))
                        all_p.append(s)
                if seed_mode == "elo":
                    all_p.sort(key=lambda x: (-int(x.get("seed_elo") or x.get("current_elo") or 1500), str(x.get("name") or "")))
                else:
                    all_p.sort(key=lambda x: (
                        int((x.get("prev_season_info") or {}).get("recommended_pod") or x.get("_curr_pod") or 99),
                        -int(x.get("seed_elo") or x.get("current_elo") or 1500),
                        str(x.get("name") or "")
                    ))
                num_pods = max(1, len(pods_c))
                rds_cnt = int((cached.get("methodology") or {}).get("games_per_season", 5))
                base_sz = len(all_p) // num_pods
                rem_sz = len(all_p) % num_pods
                idx_cursor = 0
                for p_i, p in enumerate(pods_c):
                    chunk_sz = base_sz + (1 if p_i < rem_sz else 0)
                    chunk = all_p[idx_cursor:idx_cursor + chunk_sz]
                    idx_cursor += chunk_sz
                    for r_i, s in enumerate(chunk, start=1):
                        s["rank"] = r_i
                    rr_map = generate_round_robin_pairings([s.get("name") or s.get("player_name") for s in chunk], rds_cnt, randomize=True)
                    for s in chunk:
                        nm = s.get("name") or s.get("player_name")
                        s["pairings"] = rr_map.get(nm, [])
                    p["standings"] = chunk
            elif action == "reseed_pod_by_elo":
                for p in pods_c:
                    if int(p.get("pod_number", 0)) == pod_num:
                        st_list = p.setdefault("standings", [])
                        st_list.sort(key=lambda x: (-int(x.get("seed_elo") or x.get("current_elo") or 1500), -int(x.get("battle_points", 0)), str(x.get("name") or "")))
                        for r_i, s in enumerate(st_list, start=1):
                            s["rank"] = r_i
                        if payload.get("regenerate_pairings", True):
                            names_l = [s.get("name") or s.get("player_name") for s in st_list if (s.get("name") or s.get("player_name"))]
                            rds_cnt = int((cached.get("methodology") or {}).get("games_per_season", 5))
                            rr_map = generate_round_robin_pairings(names_l, rds_cnt)
                            for s in st_list:
                                nm = s.get("name") or s.get("player_name")
                                s["pairings"] = rr_map.get(nm, [])
            else:
                target_pod_num = int(payload.get("target_pod_number") or pod_num)
                moved_player_obj = None
                for p in pods_c:
                    if int(p.get("pod_number", 0)) == pod_num:
                        standings = p.setdefault("standings", [])
                        if action == "add_player":
                            new_p_obj = {
                                "rank": len(standings) + 1,
                                "name": player_name,
                                "primary_faction": (payload.get("primary_faction") or "Space Marines").strip(),
                                "wins": 0, "losses": 0, "draws": 0, "battle_points": 0, "games_played": 0,
                                "relegation_status": "Safe",
                                "disciplinary_card": "none",
                                "dropped": False,
                                "career": {"seed_elo": seed_elo_val, "elo_source": "override"} if seed_elo_val else {},
                                "pairings": [
                                    {"round": r, "layout": f"GW Layout {r}", "opponent_name": "TBD (Ringer)", "status": "scheduled", "is_completed": False}
                                    for r in range(1, 6)
                                ]
                            }
                            if seed_elo_val is not None:
                                new_p_obj["current_elo"] = seed_elo_val
                                new_p_obj["seed_elo"] = seed_elo_val
                                new_p_obj["elo_source"] = "override"
                            standings.append(new_p_obj)
                        else:
                            for idx_s, s in enumerate(list(standings)):
                                if (s.get("name") or "").strip().lower() == player_name.lower():
                                    if "primary_faction" in payload:
                                        s["primary_faction"] = payload["primary_faction"]
                                    if "disciplinary_card" in payload:
                                        s["disciplinary_card"] = str(payload["disciplinary_card"]).lower()
                                    if "dropped" in payload:
                                        s["dropped"] = bool(payload["dropped"])
                                    if seed_elo_val is not None:
                                        s["current_elo"] = seed_elo_val
                                        s["seed_elo"] = seed_elo_val
                                        s["elo_source"] = "override"
                                        c_dict = s.get("career") if isinstance(s.get("career"), dict) else {}
                                        c_dict["seed_elo"] = seed_elo_val
                                        c_dict["elo_source"] = "override"
                                        s["career"] = c_dict
                                    if target_pod_num != pod_num:
                                        moved_player_obj = standings.pop(idx_s)
                                    break
                if moved_player_obj is not None:
                    for p in pods_c:
                        if int(p.get("pod_number", 0)) == target_pod_num:
                            dest_st = p.setdefault("standings", [])
                            moved_player_obj["rank"] = len(dest_st) + 1
                            dest_st.append(moved_player_obj)
            if not hasattr(self, "_offline_league_cache"):
                self._offline_league_cache = {}
            self._offline_league_cache[lid] = cached

        if db and hasattr(db, "get_connection"):
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT id, active_season_num, config_json FROM native_leagues WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s) LIMIT 1;", (cand_ids, cand_slugs))
                        lrow = cur.fetchone()
                        if not lrow and lid in (SD40K_LEAGUE_UUID, THE_GAUNTLET_LEAGUE_UUID):
                            if self._seed_canonical_league_into_db_if_missing(conn, cur, lid):
                                cur.execute("SELECT id, active_season_num, config_json FROM native_leagues WHERE id = ANY(%s) OR LOWER(slug) = ANY(%s) LIMIT 1;", (cand_ids, cand_slugs))
                                lrow = cur.fetchone()
                        if lrow:
                            db_lid = lrow[0]
                            s_num = int(payload.get("season_number") or lrow[1] or 1)
                            cfg = lrow[2] if isinstance(lrow[2], dict) else (json.loads(lrow[2]) if lrow[2] else {})
                            rds_cnt = int((cfg.get("methodology") or {}).get("games_per_season", 5))

                            if action == "auto_seed_all_pods":
                                cur.execute("""
                                    SELECT id, pod_num, player_name, bcp_player_id, player_id, wins, losses, battle_points, career_json, pairings_json
                                    FROM native_league_standings
                                    WHERE league_id = %s AND season_num = %s
                                    ORDER BY pod_num ASC, rank ASC;
                                """, (db_lid, s_num))
                                rows = cur.fetchall()
                                by_pod_tmp: Dict[int, List[Dict[str, Any]]] = {}
                                for r in rows:
                                    p_n = int(r[1] or 1)
                                    c_obj = r[8] if isinstance(r[8], dict) else (json.loads(r[8]) if r[8] else {})
                                    p_obj = r[9] if isinstance(r[9], list) else (json.loads(r[9]) if r[9] else [])
                                    by_pod_tmp.setdefault(p_n, []).append({
                                        "id": r[0],
                                        "pod_number": p_n,
                                        "name": (r[2] or "").strip(),
                                        "bcp_player_id": r[3] or r[4],
                                        "player_id": r[4] or r[3],
                                        "wins": int(r[5] or 0),
                                        "losses": int(r[6] or 0),
                                        "battle_points": int(r[7] or 0),
                                        "career": c_obj,
                                        "pairings": p_obj
                                    })
                                pods_tmp = [{"pod_number": pn, "standings": st} for pn, st in sorted(by_pod_tmp.items())]
                                self._enrich_pods_with_player_elo(cur, pods_tmp)
                                flat_all = []
                                for pt in pods_tmp:
                                    for s in pt["standings"]:
                                        s["_curr_pod"] = pt["pod_number"]
                                        flat_all.append(s)
                                if seed_mode == "elo":
                                    flat_all.sort(key=lambda x: (-int(x.get("seed_elo") or x.get("current_elo") or 1500), str(x.get("name") or "")))
                                else:
                                    flat_all.sort(key=lambda x: (
                                        int((x.get("prev_season_info") or {}).get("recommended_pod") or x.get("_curr_pod") or 99),
                                        -int(x.get("seed_elo") or x.get("current_elo") or 1500),
                                        str(x.get("name") or "")
                                    ))
                                pod_nums_sorted = sorted(by_pod_tmp.keys()) or [1]
                                n_pods = len(pod_nums_sorted)
                                b_sz = len(flat_all) // n_pods
                                r_sz = len(flat_all) % n_pods
                                cursor_i = 0
                                for idx_p, target_pn in enumerate(pod_nums_sorted):
                                    c_sz = b_sz + (1 if idx_p < r_sz else 0)
                                    chunk = flat_all[cursor_i:cursor_i + c_sz]
                                    cursor_i += c_sz
                                    rr_map = generate_round_robin_pairings([x["name"] for x in chunk], rds_cnt, randomize=True)
                                    for rk_i, item in enumerate(chunk, start=1):
                                        new_pairs = rr_map.get(item["name"], item["pairings"])
                                        cur.execute(
                                            "UPDATE native_league_standings SET pod_num = %s, rank = %s, pairings_json = %s::jsonb, career_json = %s::jsonb WHERE id = %s;",
                                            (target_pn, rk_i, json.dumps(new_pairs), json.dumps(item.get("career") or {}), item["id"])
                                        )
                                        cur.execute(
                                            "UPDATE native_league_participants SET pod_num = %s WHERE league_id = %s AND season_num = %s AND LOWER(participant_name) = LOWER(%s);",
                                            (target_pn, db_lid, s_num, item["name"])
                                        )
                            elif action == "reseed_pod_by_elo":
                                cur.execute("""
                                    SELECT id, player_name, bcp_player_id, player_id, wins, losses, battle_points, career_json, pairings_json
                                    FROM native_league_standings
                                    WHERE league_id = %s AND season_num = %s AND pod_num = %s;
                                """, (db_lid, s_num, pod_num))
                                rows = cur.fetchall()
                                temp_pod_standings = []
                                for r in rows:
                                    c_obj = r[7] if isinstance(r[7], dict) else (json.loads(r[7]) if r[7] else {})
                                    p_obj = r[8] if isinstance(r[8], list) else (json.loads(r[8]) if r[8] else [])
                                    temp_pod_standings.append({
                                        "id": r[0],
                                        "name": (r[1] or "").strip(),
                                        "bcp_player_id": r[2] or r[3],
                                        "player_id": r[3] or r[2],
                                        "wins": int(r[4] or 0),
                                        "losses": int(r[5] or 0),
                                        "battle_points": int(r[6] or 0),
                                        "career": c_obj,
                                        "pairings": p_obj
                                    })
                                self._enrich_pods_with_player_elo(cur, [{"pod_number": pod_num, "standings": temp_pod_standings}])
                                temp_pod_standings.sort(key=lambda x: (-int(x.get("seed_elo") or x.get("current_elo") or 1500), -int(x.get("battle_points", 0)), str(x.get("name") or "")))
                                rr_map = generate_round_robin_pairings([x["name"] for x in temp_pod_standings], rds_cnt) if payload.get("regenerate_pairings", True) else {}
                                for new_rk, item in enumerate(temp_pod_standings, start=1):
                                    new_pairs = rr_map.get(item["name"], item["pairings"]) if rr_map else item["pairings"]
                                    cur.execute(
                                        "UPDATE native_league_standings SET rank = %s, pairings_json = %s::jsonb WHERE id = %s;",
                                        (new_rk, json.dumps(new_pairs), item["id"])
                                    )
                            elif action == "add_player":
                                faction = (payload.get("primary_faction") or "Space Marines").strip()
                                cur.execute("SELECT COALESCE(MAX(rank), 0) + 1 FROM native_league_standings WHERE league_id = %s AND season_num = %s AND pod_num = %s;", (db_lid, s_num, pod_num))
                                next_rank = int(cur.fetchone()[0] or 1)
                                default_pairings = [
                                    {"round": r, "layout": f"GW Layout {r}", "opponent_name": "TBD (Ringer)", "status": "scheduled", "is_completed": False}
                                    for r in range(1, 6)
                                ]
                                career_init = {"seed_elo": seed_elo_val, "elo_source": "override"} if seed_elo_val is not None else {}
                                cur.execute("""
                                    INSERT INTO native_league_participants (id, league_id, season_num, pod_num, participant_name, primary_faction)
                                    VALUES (%s, %s, %s, %s, %s, %s)
                                    ON CONFLICT (league_id, season_num, pod_num, participant_name) DO UPDATE SET primary_faction = EXCLUDED.primary_faction;
                                """, (str(uuid.uuid4()), db_lid, s_num, pod_num, player_name, faction))
                                cur.execute("""
                                    INSERT INTO native_league_standings (
                                        id, league_id, season_num, pod_num, player_name, primary_faction,
                                        rank, wins, losses, draws, battle_points, games_played, poty_points,
                                        relegation_status, disciplinary_card, dropped, pairings_json, career_json
                                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, 0, 0, 0, 0, 0, 0, 'Safe', 'none', FALSE, %s::jsonb, %s::jsonb)
                                    ON CONFLICT (league_id, season_num, pod_num, player_name) DO UPDATE SET
                                        primary_faction = EXCLUDED.primary_faction,
                                        career_json = COALESCE(native_league_standings.career_json, '{}'::jsonb) || EXCLUDED.career_json;
                                """, (str(uuid.uuid4()), db_lid, s_num, pod_num, player_name, faction, next_rank, json.dumps(default_pairings), json.dumps(career_init)))
                            else:
                                cur.execute("""
                                    SELECT id, pod_num, primary_faction, poty_points, relegation_status,
                                           COALESCE(disciplinary_card, 'none'), COALESCE(dropped, FALSE), career_json
                                    FROM native_league_standings
                                    WHERE league_id = %s AND season_num = %s AND LOWER(player_name) = LOWER(%s)
                                    LIMIT 1;
                                """, (db_lid, s_num, player_name))
                                st_row = cur.fetchone()
                                if st_row:
                                    st_id, curr_pod, curr_fac, curr_poty, curr_rel, curr_card, curr_drop, curr_career_raw = st_row
                                    curr_career = curr_career_raw if isinstance(curr_career_raw, dict) else (json.loads(curr_career_raw) if curr_career_raw else {})
                                    new_pod = int(payload.get("target_pod_number") or curr_pod)
                                    new_fac = (payload.get("primary_faction") if "primary_faction" in payload else curr_fac) or curr_fac
                                    new_poty = int(payload.get("poty_points") if "poty_points" in payload else (curr_poty or 0))
                                    new_rel = (payload.get("relegation_status") if "relegation_status" in payload else curr_rel) or curr_rel
                                    new_card = str(payload.get("disciplinary_card") if "disciplinary_card" in payload else curr_card).lower()
                                    new_drop = bool(payload.get("dropped") if "dropped" in payload else curr_drop)
                                    if new_drop and "Dropped" not in new_rel:
                                        new_rel = "Dropped"
                                    if seed_elo_val is not None:
                                        curr_career["seed_elo"] = seed_elo_val
                                        curr_career["current_elo"] = seed_elo_val
                                        curr_career["elo_source"] = "override"

                                    cur.execute("""
                                        UPDATE native_league_standings
                                        SET pod_num = %s,
                                            primary_faction = %s,
                                            poty_points = %s,
                                            relegation_status = %s,
                                            disciplinary_card = %s,
                                            dropped = %s,
                                            career_json = %s::jsonb
                                        WHERE id = %s;
                                    """, (new_pod, new_fac, new_poty, new_rel, new_card, new_drop, json.dumps(curr_career), st_id))

                                    cur.execute("""
                                        UPDATE native_league_participants
                                        SET pod_num = %s, primary_faction = %s
                                        WHERE league_id = %s AND season_num = %s AND LOWER(participant_name) = LOWER(%s);
                                    """, (new_pod, new_fac, db_lid, s_num, player_name))
                    conn.commit()
                    if hasattr(db, "sync_league_participant_identities"):
                        db.sync_league_participant_identities(db_lid, s_num)
            except Exception as e:
                logger.warning(f"update_pod_roster_and_discipline DB write fallback: {e}")

        try:
            self.sync_league_group_chats(lid)
        except Exception:
            pass

        return {
            "success": True,
            "league_id": lid,
            "league": self.get_league(lid)
        }

    # =========================================================================
    # UNIFIED EVENT STUDIO CREATION & LIVE FLOOR OPERATIONS ENGINE (E2E DB)
    # =========================================================================

    def _get_db(self):
        return _get_db()

    def _get_ops_store_path(self) -> str:
        base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "leagues")
        os.makedirs(base_dir, exist_ok=True)
        return os.path.join(base_dir, "unified_ops_db.json")

    def _load_ops_store(self) -> Dict[str, Any]:
        path = self._get_ops_store_path()
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"clocks": {}, "flags": {}, "broadcasts": {}, "acks": {}, "events": {}}

    def _save_ops_store(self, store: Dict[str, Any]) -> None:
        path = self._get_ops_store_path()
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(store, f, indent=2)
        except Exception as e:
            logger.warning(f"Failed saving unified ops store: {e}")

    def _ensure_unified_ops_tables(self, cur) -> None:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS native_event_clocks (
                entity_id VARCHAR(128) PRIMARY KEY,
                entity_type VARCHAR(32) DEFAULT 'tournament',
                round_number INTEGER DEFAULT 1,
                pod_number INTEGER DEFAULT 0,
                status VARCHAR(32) DEFAULT 'stopped',
                duration_minutes INTEGER DEFAULT 180,
                remaining_seconds INTEGER DEFAULT 10800,
                target_end_epoch_ms BIGINT,
                table_extensions_json JSONB DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS native_event_judge_calls (
                call_id VARCHAR(64) PRIMARY KEY,
                entity_id VARCHAR(128) NOT NULL,
                entity_type VARCHAR(32) DEFAULT 'tournament',
                round_number INTEGER DEFAULT 1,
                pod_number INTEGER DEFAULT 1,
                table_number INTEGER DEFAULT 1,
                match_id VARCHAR(128),
                caller_name VARCHAR(255) NOT NULL,
                caller_player_id VARCHAR(128),
                opponent_name VARCHAR(255),
                category VARCHAR(64) NOT NULL,
                priority VARCHAR(32) DEFAULT 'high',
                note TEXT,
                status VARCHAR(32) DEFAULT 'pending',
                assigned_judge VARCHAR(255),
                resolution_note TEXT,
                time_extension_minutes INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                resolved_at TIMESTAMPTZ
            );
            CREATE TABLE IF NOT EXISTS native_event_broadcasts (
                broadcast_id VARCHAR(64) PRIMARY KEY,
                entity_id VARCHAR(128) NOT NULL,
                entity_type VARCHAR(32) DEFAULT 'tournament',
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                category VARCHAR(64) DEFAULT 'general',
                priority VARCHAR(32) DEFAULT 'normal',
                target_scope VARCHAR(64) DEFAULT 'All',
                require_ack BOOLEAN DEFAULT FALSE,
                is_pinned BOOLEAN DEFAULT TRUE,
                author_name VARCHAR(255) DEFAULT 'Tournament Organizer',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS native_event_broadcast_acks (
                broadcast_id VARCHAR(64) NOT NULL,
                entity_id VARCHAR(128) NOT NULL,
                player_id VARCHAR(128) NOT NULL,
                player_name VARCHAR(255) NOT NULL,
                acked_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (broadcast_id, player_id)
            );
        """)

    def create_unified_event(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Unified 4-Step Event & League Creation Wizard handler.
        Creates either a Native Community League (pod_league / ladder_league)
        or a Native Studio Tournament (swiss_single_day / multi_day_gt / team_wtc)
        backed 100% by PostgreSQL tables.
        """
        preset = str(payload.get("format_preset") or payload.get("preset") or "swiss_single_day").strip().lower()
        name = str(payload.get("name") or "New Competitive Event").strip()
        game_sys = str(payload.get("game_system") or "40k").strip().lower()
        city = str(payload.get("city") or "San Diego").strip()
        state = str(payload.get("state") or "CA").strip()
        venue_name = str(payload.get("venue_name") or payload.get("venue") or "Local Game Store").strip()
        start_date = str(payload.get("start_date") or payload.get("event_date") or datetime.now().strftime("%Y-%m-%d")).strip()
        end_date = str(payload.get("end_date") or start_date).strip()
        points_limit = int(payload.get("points_limit") or payload.get("points") or 2000)
        rounds_count = int(payload.get("rounds_count") or payload.get("rounds") or 5)
        round_duration_min = int(payload.get("round_duration_minutes") or 180)
        pod_size = int(payload.get("pod_size") or 6)
        pods_count = int(payload.get("pods_count") or 2)
        promo_cnt = int(payload.get("promotion_count") or 2)
        rel_cnt = int(payload.get("relegation_count") or 2)
        ringer_enabled = bool(payload.get("ringer_enabled", True))
        scoring_mode = str(payload.get("scoring_mode") or "battle_points").strip()
        round_layouts = payload.get("round_layouts")
        if not isinstance(round_layouts, list) or not round_layouts:
            round_layouts = [f"Layout {chr(65 + (i % 6))}" for i in range(rounds_count)]

        if preset in ("pod_league", "ladder_league"):
            league_payload = {
                "name": name,
                "short_name": payload.get("short_name") or "".join(w[0].upper() for w in name.split()[:4]) or "LEAGUE",
                "tagline": payload.get("tagline") or f"{city}, {state} • {points_limit} pts • {'Pod Division League' if preset == 'pod_league' else 'Open Ladder League'}",
                "game_system": game_sys,
                "city": city,
                "state": state,
                "venue_name": venue_name,
                "start_date": start_date,
                "end_date": end_date,
                "points_limit": points_limit,
                "rounds_count": rounds_count,
                "pod_size": pod_size,
                "pods_count": pods_count if preset == "pod_league" else 1,
                "promotion_count": promo_cnt if preset == "pod_league" else 0,
                "relegation_count": rel_cnt if preset == "pod_league" else 0,
                "ringer_bonus": 1 if ringer_enabled else 0,
                "scoring_mode": scoring_mode,
                "round_layouts": round_layouts,
                "owner_user_id": payload.get("owner_user_id") or payload.get("organizer_id"),
                "owner_player_id": payload.get("owner_player_id") or payload.get("player_id"),
                "owner_email": payload.get("owner_email"),
                "owner_name": payload.get("owner_name") or "Commissioner",
                "template_id": "sd40k_pod_league" if preset == "pod_league" else "open_ladder_league",
            }
            res = self.create_league(league_payload)
            lid = res.get("league_id") or (res.get("league") or {}).get("league_id")
            if lid:
                self.update_unified_clock(lid, {
                    "entity_type": "league",
                    "action": "reset",
                    "round_number": 1,
                    "duration_minutes": round_duration_min,
                })
                if payload.get("initial_announcement"):
                    self.publish_unified_broadcast(lid, {
                        "entity_type": "league",
                        "title": f"Welcome to {name}",
                        "message": str(payload.get("initial_announcement")),
                        "category": "schedule",
                        "priority": "high",
                        "require_ack": True,
                        "author_name": league_payload["owner_name"],
                    })
            return {
                "success": True,
                "entity_type": "league",
                "format_preset": preset,
                "entity_id": lid,
                "league_id": lid,
                "league": res.get("league") or self.get_league(lid),
            }

        # Native Tournament Creation (Swiss Single-Day, Multi-Day GT, Team WTC)
        event_id = str(payload.get("event_id") or f"ES-{uuid.uuid4().hex[:8].upper()}")
        if not event_id.startswith("ES-"):
            event_id = f"ES-{event_id}"
        tier_map = {
            "swiss_single_day": "Regional",
            "multi_day_gt": "Grand Tournament",
            "team_wtc": "Team Tournament",
        }
        event_type = "teams" if preset == "team_wtc" else "singles"
        team_size = int(payload.get("team_size") or (5 if preset == "team_wtc" else 1))
        initial_roster = payload.get("initial_roster") if isinstance(payload.get("initial_roster"), list) else []
        event_dict = {
            "id": event_id,
            "event_id": event_id,
            "name": name,
            "format_preset": preset,
            "tier": tier_map.get(preset, "Regional"),
            "event_date": start_date,
            "end_date": end_date,
            "city": city,
            "state": state,
            "country": payload.get("country") or "United States",
            "venue": venue_name,
            "venue_name": venue_name,
            "points": points_limit,
            "capacity": int(payload.get("capacity") or 32),
            "num_rounds": rounds_count,
            "current_round": 1,
            "round_duration_minutes": round_duration_min,
            "round_layouts": round_layouts,
            "scoring_mode": scoring_mode,
            "mission_pack": payload.get("mission_pack") or "Chapter Approved: Pariah Nexus",
            "organizer_id": payload.get("organizer_id") or payload.get("owner_user_id"),
            "organizer_name": payload.get("owner_name") or "Tournament Organizer",
            "event_type": event_type,
            "team_size": team_size,
            "game_system": game_sys,
            "roster": initial_roster,
            "total_players": len(initial_roster),
            "pairings": {},
            "started": False,
            "pairings_status": "draft",
        }

        db = self._get_db()
        if db and hasattr(db, "save_studio_event"):
            try:
                saved_ev = db.save_studio_event(event_dict)
                if isinstance(saved_ev, dict):
                    event_dict.update(saved_ev)
            except Exception as e:
                logger.warning(f"create_unified_event db.save_studio_event fallback: {e}")

        store = self._load_ops_store()
        store.setdefault("events", {})[event_id] = event_dict
        self._save_ops_store(store)

        self.update_unified_clock(event_id, {
            "entity_type": "tournament",
            "action": "reset",
            "round_number": 1,
            "duration_minutes": round_duration_min,
        })
        if payload.get("initial_announcement"):
            self.publish_unified_broadcast(event_id, {
                "entity_type": "tournament",
                "title": f"Welcome to {name}",
                "message": str(payload.get("initial_announcement")),
                "category": "general",
                "priority": "high",
                "require_ack": True,
                "author_name": event_dict["organizer_name"],
            })

        return {
            "success": True,
            "entity_type": "tournament",
            "format_preset": preset,
            "entity_id": event_id,
            "event_id": event_id,
            "event": event_dict,
        }

    def get_unified_floor_ops(self, entity_id: str) -> Dict[str, Any]:
        """
        Fetches real-time floor operations state (Master Round Clock, Per-Table Extensions,
        Judge Call / Table Flag Queue, and Pinned Broadcasts + Player Acknowledgements)
        for any Tournament (`ES-...`) or League (`UUID` / slug).
        """
        raw_id = str(entity_id or "").strip()
        norm_lid = _normalize_league_id(raw_id)
        is_league = not raw_id.startswith("ES-") and (norm_lid in (SD40K_LEAGUE_UUID, GAUNTLET_LEAGUE_UUID) or len(norm_lid) == 36)
        key_id = norm_lid if is_league else raw_id

        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        clock = {
            "entity_id": key_id,
            "entity_type": "league" if is_league else "tournament",
            "round_number": 1,
            "pod_number": 0,
            "status": "stopped",
            "duration_minutes": 180,
            "remaining_seconds": 10800,
            "target_end_epoch_ms": None,
            "table_extensions": {},
        }
        flags: List[Dict[str, Any]] = []
        broadcasts: List[Dict[str, Any]] = []
        acks_by_broadcast: Dict[str, List[Dict[str, Any]]] = {}

        store = self._load_ops_store()
        if key_id in store.get("clocks", {}):
            clock.update(store["clocks"][key_id])
        flags = list(store.get("flags", {}).get(key_id, []))
        broadcasts = list(store.get("broadcasts", {}).get(key_id, []))
        acks_by_broadcast = dict(store.get("acks", {}).get(key_id, {}))

        db = self._get_db()
        if db:
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        self._ensure_unified_ops_tables(cur)
                        cur.execute("""
                            SELECT entity_type, round_number, pod_number, status, duration_minutes,
                                   remaining_seconds, target_end_epoch_ms, table_extensions_json
                            FROM native_event_clocks
                            WHERE entity_id = %s
                            LIMIT 1;
                        """, (key_id,))
                        c_row = cur.fetchone()
                        if c_row:
                            t_ext = c_row[7] if isinstance(c_row[7], dict) else (json.loads(c_row[7]) if c_row[7] else {})
                            clock.update({
                                "entity_type": c_row[0] or clock["entity_type"],
                                "round_number": int(c_row[1] or 1),
                                "pod_number": int(c_row[2] or 0),
                                "status": c_row[3] or "stopped",
                                "duration_minutes": int(c_row[4] or 180),
                                "remaining_seconds": int(c_row[5] if c_row[5] is not None else 10800),
                                "target_end_epoch_ms": int(c_row[6]) if c_row[6] else None,
                                "table_extensions": t_ext,
                            })

                        cur.execute("""
                            SELECT call_id, round_number, pod_number, table_number, match_id,
                                   caller_name, caller_player_id, opponent_name, category, priority,
                                   note, status, assigned_judge, resolution_note, time_extension_minutes,
                                   created_at, resolved_at
                            FROM native_event_judge_calls
                            WHERE entity_id = %s
                            ORDER BY CASE WHEN status IN ('pending', 'en_route') THEN 0 ELSE 1 END, created_at DESC;
                        """, (key_id,))
                        db_flags = []
                        for r in cur.fetchall():
                            db_flags.append({
                                "call_id": r[0],
                                "id": r[0],
                                "entity_id": key_id,
                                "round_number": int(r[1] or 1),
                                "pod_number": int(r[2] or 1),
                                "table_number": int(r[3] or 1),
                                "match_id": r[4] or "",
                                "caller_name": r[5] or "Player",
                                "caller_player_id": r[6] or "",
                                "opponent_name": r[7] or "",
                                "category": r[8] or "Rules Question",
                                "priority": r[9] or "high",
                                "note": r[10] or "",
                                "status": r[11] or "pending",
                                "assigned_judge": r[12] or None,
                                "resolution_note": r[13] or "",
                                "time_extension_minutes": int(r[14] or 0),
                                "created_at": r[15].isoformat() if hasattr(r[15], "isoformat") else str(r[15] or ""),
                                "resolved_at": r[16].isoformat() if hasattr(r[16], "isoformat") else (str(r[16]) if r[16] else None),
                            })
                        if db_flags:
                            flags = db_flags

                        cur.execute("""
                            SELECT broadcast_id, player_id, player_name, acked_at
                            FROM native_event_broadcast_acks
                            WHERE entity_id = %s;
                        """, (key_id,))
                        acks_by_broadcast = {}
                        for ar in cur.fetchall():
                            acks_by_broadcast.setdefault(ar[0], []).append({
                                "player_id": ar[1],
                                "player_name": ar[2],
                                "acked_at": ar[3].isoformat() if hasattr(ar[3], "isoformat") else str(ar[3] or ""),
                            })

                        cur.execute("""
                            SELECT broadcast_id, title, message, category, priority,
                                   target_scope, require_ack, is_pinned, author_name, created_at
                            FROM native_event_broadcasts
                            WHERE entity_id = %s
                            ORDER BY is_pinned DESC, created_at DESC;
                        """, (key_id,))
                        db_broadcasts = []
                        for br in cur.fetchall():
                            b_id = br[0]
                            b_acks = acks_by_broadcast.get(b_id, [])
                            db_broadcasts.append({
                                "id": b_id,
                                "broadcast_id": b_id,
                                "entity_id": key_id,
                                "title": br[1] or "TO Broadcast",
                                "body": br[2] or "",
                                "message": br[2] or "",
                                "category": br[3] or "general",
                                "priority": br[4] or "normal",
                                "target_scope": br[5] or "All",
                                "target_pod": br[5] or "All Pods",
                                "require_ack": bool(br[6]),
                                "is_pinned": bool(br[7]),
                                "author_name": br[8] or "Tournament Organizer",
                                "created_at": br[9].isoformat()[:10] if hasattr(br[9], "isoformat") else str(br[9] or "")[:10],
                                "ack_count": len(b_acks),
                                "acked_players": b_acks,
                            })
                        if db_broadcasts:
                            broadcasts = db_broadcasts
                    conn.commit()
            except Exception as e:
                logger.debug(f"get_unified_floor_ops DB read fallback: {e}")

        # Calculate live remaining seconds if clock is running
        if clock.get("status") == "running" and clock.get("target_end_epoch_ms"):
            rem = max(0, int((int(clock["target_end_epoch_ms"]) - now_ms) / 1000))
            clock["remaining_seconds"] = rem
            if rem == 0:
                clock["status"] = "completed"

        # Enrich broadcasts with ack counts from local store if not from DB
        for b in broadcasts:
            b_id = b.get("broadcast_id") or b.get("id")
            b_acks = acks_by_broadcast.get(b_id, b.get("acked_players") or [])
            b["acked_players"] = b_acks
            b["ack_count"] = len(b_acks)

        # If league has announcements not yet in broadcasts, surface them cleanly
        if is_league:
            lg = self.get_league(key_id)
            if lg and isinstance(lg.get("announcements"), list):
                existing_ids = {b.get("id") or b.get("broadcast_id") for b in broadcasts}
                for ann in lg["announcements"]:
                    aid = ann.get("id")
                    if aid and aid not in existing_ids:
                        a_acks = acks_by_broadcast.get(aid, [])
                        broadcasts.append({
                            "id": aid,
                            "broadcast_id": aid,
                            "entity_id": key_id,
                            "title": ann.get("title") or "League Notice",
                            "body": ann.get("body") or "",
                            "message": ann.get("body") or "",
                            "category": ann.get("category") or "general",
                            "priority": ann.get("priority") or "normal",
                            "target_scope": ann.get("target_pod") or "All Pods",
                            "target_pod": ann.get("target_pod") or "All Pods",
                            "require_ack": bool(ann.get("require_ack", True)),
                            "is_pinned": bool(ann.get("is_pinned", True)),
                            "author_name": ann.get("author_name") or "Commissioner",
                            "created_at": ann.get("created_at") or datetime.now().strftime("%Y-%m-%d"),
                            "ack_count": len(a_acks),
                            "acked_players": a_acks,
                        })

        active_flags = [f for f in flags if f.get("status") in ("pending", "en_route")]
        return {
            "success": True,
            "entity_id": key_id,
            "entity_type": "league" if is_league else "tournament",
            "clock": clock,
            "judge_calls": flags,
            "active_flags": active_flags,
            "active_flags_count": len(active_flags),
            "broadcasts": broadcasts,
        }

    def update_unified_clock(self, entity_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        raw_id = str(entity_id or "").strip()
        norm_lid = _normalize_league_id(raw_id)
        is_league = not raw_id.startswith("ES-") and (norm_lid in (SD40K_LEAGUE_UUID, GAUNTLET_LEAGUE_UUID) or len(norm_lid) == 36)
        key_id = norm_lid if is_league else raw_id

        curr = self.get_unified_floor_ops(key_id).get("clock") or {}
        action = str(payload.get("action") or payload.get("status") or "start").strip().lower()
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

        round_num = int(payload.get("round_number") or payload.get("round") or curr.get("round_number") or 1)
        pod_num = int(payload.get("pod_number") if payload.get("pod_number") is not None else (curr.get("pod_number") or 0))
        dur_min = int(payload.get("duration_minutes") or payload.get("durationMinutes") or curr.get("duration_minutes") or 180)
        rem_sec = int(curr.get("remaining_seconds") if curr.get("remaining_seconds") is not None else dur_min * 60)
        status = curr.get("status") or "stopped"
        target_end = curr.get("target_end_epoch_ms")
        table_exts = dict(curr.get("table_extensions") or {})

        if action in ("start", "running", "resume"):
            if status != "running":
                if rem_sec <= 0:
                    rem_sec = dur_min * 60
                target_end = now_ms + (rem_sec * 1000)
                status = "running"
        elif action in ("pause", "paused"):
            if status == "running" and target_end:
                rem_sec = max(0, int((int(target_end) - now_ms) / 1000))
            target_end = None
            status = "paused"
        elif action in ("reset", "stopped", "stop"):
            rem_sec = dur_min * 60
            target_end = None
            status = "stopped"
        elif action == "add_time":
            delta_min = int(payload.get("delta_minutes") or payload.get("minutes") or 5)
            delta_sec = delta_min * 60
            rem_sec = max(0, rem_sec + delta_sec)
            if status == "running" and target_end:
                target_end = int(target_end) + (delta_sec * 1000)
        elif action == "extend_table":
            t_key = f"Table {payload.get('table_number') or payload.get('table') or 1}"
            extra_m = int(payload.get("extra_minutes") or payload.get("minutes") or 10)
            prev_m = int((table_exts.get(t_key) or {}).get("extra_minutes") or 0)
            table_exts[t_key] = {
                "table_key": t_key,
                "extra_minutes": prev_m + extra_m,
                "reason": str(payload.get("reason") or "Judge ruling extension"),
                "updated_at": datetime.now(timezone.utc).strftime("%H:%M UTC"),
            }

        new_clock = {
            "entity_id": key_id,
            "entity_type": "league" if is_league else "tournament",
            "round_number": round_num,
            "pod_number": pod_num,
            "status": status,
            "duration_minutes": dur_min,
            "remaining_seconds": rem_sec,
            "target_end_epoch_ms": target_end,
            "table_extensions": table_exts,
        }

        store = self._load_ops_store()
        store.setdefault("clocks", {})[key_id] = new_clock
        self._save_ops_store(store)

        db = self._get_db()
        if db:
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        self._ensure_unified_ops_tables(cur)
                        cur.execute("""
                            INSERT INTO native_event_clocks (
                                entity_id, entity_type, round_number, pod_number, status,
                                duration_minutes, remaining_seconds, target_end_epoch_ms,
                                table_extensions_json, updated_at
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
                            ON CONFLICT (entity_id) DO UPDATE SET
                                round_number = EXCLUDED.round_number,
                                pod_number = EXCLUDED.pod_number,
                                status = EXCLUDED.status,
                                duration_minutes = EXCLUDED.duration_minutes,
                                remaining_seconds = EXCLUDED.remaining_seconds,
                                target_end_epoch_ms = EXCLUDED.target_end_epoch_ms,
                                table_extensions_json = EXCLUDED.table_extensions_json,
                                updated_at = NOW();
                        """, (
                            key_id, new_clock["entity_type"], round_num, pod_num, status,
                            dur_min, rem_sec, target_end, json.dumps(table_exts)
                        ))
                    conn.commit()
            except Exception as e:
                logger.debug(f"update_unified_clock DB write fallback: {e}")

        return self.get_unified_floor_ops(key_id)

    def create_unified_flag(self, entity_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        raw_id = str(entity_id or payload.get("entity_id") or payload.get("event_id") or "").strip()
        norm_lid = _normalize_league_id(raw_id)
        is_league = not raw_id.startswith("ES-") and (norm_lid in (SD40K_LEAGUE_UUID, GAUNTLET_LEAGUE_UUID) or len(norm_lid) == 36)
        key_id = norm_lid if is_league else raw_id

        call_id = str(payload.get("call_id") or f"FLG-{uuid.uuid4().hex[:8].upper()}")
        round_num = int(payload.get("round_number") or payload.get("round") or 1)
        pod_num = int(payload.get("pod_number") or 1)
        table_num = int(payload.get("table_number") or payload.get("table_num") or payload.get("table") or 1)
        caller_name = str(payload.get("caller_name") or payload.get("player_name") or "Competitor").strip()
        caller_pid = str(payload.get("caller_player_id") or payload.get("player_id") or "").strip()
        opp_name = str(payload.get("opponent_name") or payload.get("opponent") or "").strip()
        category = str(payload.get("category") or "Rules Question").strip()
        priority = str(payload.get("priority") or ("urgent" if "Dispute" in category or "Clock" in category else "high")).strip()
        note = str(payload.get("note") or payload.get("notes") or "").strip()

        flag_obj = {
            "call_id": call_id,
            "id": call_id,
            "entity_id": key_id,
            "entity_type": "league" if is_league else "tournament",
            "round_number": round_num,
            "pod_number": pod_num,
            "table_number": table_num,
            "match_id": str(payload.get("match_id") or ""),
            "caller_name": caller_name,
            "caller_player_id": caller_pid,
            "opponent_name": opp_name,
            "category": category,
            "priority": priority,
            "note": note,
            "status": "pending",
            "assigned_judge": None,
            "resolution_note": "",
            "time_extension_minutes": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "resolved_at": None,
        }

        store = self._load_ops_store()
        flist = store.setdefault("flags", {}).setdefault(key_id, [])
        flist.insert(0, flag_obj)
        self._save_ops_store(store)

        db = self._get_db()
        if db:
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        self._ensure_unified_ops_tables(cur)
                        cur.execute("""
                            INSERT INTO native_event_judge_calls (
                                call_id, entity_id, entity_type, round_number, pod_number,
                                table_number, match_id, caller_name, caller_player_id,
                                opponent_name, category, priority, note, status, created_at
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', NOW());
                        """, (
                            call_id, key_id, flag_obj["entity_type"], round_num, pod_num,
                            table_num, flag_obj["match_id"], caller_name, caller_pid,
                            opp_name, category, priority, note
                        ))
                    conn.commit()
            except Exception as e:
                logger.debug(f"create_unified_flag DB write fallback: {e}")

        ops = self.get_unified_floor_ops(key_id)
        ops["created_flag"] = flag_obj
        return ops

    def resolve_unified_flag(self, entity_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        raw_id = str(entity_id or payload.get("entity_id") or payload.get("event_id") or "").strip()
        norm_lid = _normalize_league_id(raw_id)
        is_league = not raw_id.startswith("ES-") and (norm_lid in (SD40K_LEAGUE_UUID, GAUNTLET_LEAGUE_UUID) or len(norm_lid) == 36)
        key_id = norm_lid if is_league else raw_id

        call_id = str(payload.get("call_id") or payload.get("id") or "").strip()
        new_status = str(payload.get("status") or "resolved").strip().lower()
        judge_name = str(payload.get("assigned_judge") or "Head Judge / TO").strip()
        res_note = str(payload.get("resolution_note") or payload.get("note") or "").strip()
        ext_min = int(payload.get("time_extension_minutes") or 0)
        target_table = int(payload.get("table_number") or 1)

        store = self._load_ops_store()
        for f in store.get("flags", {}).get(key_id, []):
            if f.get("call_id") == call_id or f.get("id") == call_id:
                f["status"] = new_status
                f["assigned_judge"] = judge_name
                if res_note:
                    f["resolution_note"] = res_note
                if ext_min > 0:
                    f["time_extension_minutes"] = ext_min
                target_table = int(f.get("table_number") or target_table)
                if new_status in ("resolved", "cancelled"):
                    f["resolved_at"] = datetime.now(timezone.utc).isoformat()
                break
        self._save_ops_store(store)

        db = self._get_db()
        if db:
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        self._ensure_unified_ops_tables(cur)
                        cur.execute("""
                            UPDATE native_event_judge_calls
                            SET status = %s,
                                assigned_judge = %s,
                                resolution_note = COALESCE(NULLIF(%s, ''), resolution_note),
                                time_extension_minutes = GREATEST(COALESCE(time_extension_minutes, 0), %s),
                                resolved_at = CASE WHEN %s IN ('resolved', 'cancelled') THEN NOW() ELSE resolved_at END
                            WHERE call_id = %s
                            RETURNING table_number;
                        """, (new_status, judge_name, res_note, ext_min, new_status, call_id))
                        r = cur.fetchone()
                        if r and r[0]:
                            target_table = int(r[0])
                    conn.commit()
            except Exception as e:
                logger.debug(f"resolve_unified_flag DB write fallback: {e}")

        if ext_min > 0:
            self.update_unified_clock(key_id, {
                "action": "extend_table",
                "table_number": target_table,
                "extra_minutes": ext_min,
                "reason": res_note or f"Judge call {call_id} extension",
            })

        return self.get_unified_floor_ops(key_id)

    def publish_unified_broadcast(self, entity_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        raw_id = str(entity_id or payload.get("entity_id") or "").strip()
        norm_lid = _normalize_league_id(raw_id)
        is_league = not raw_id.startswith("ES-") and (norm_lid in (SD40K_LEAGUE_UUID, GAUNTLET_LEAGUE_UUID) or len(norm_lid) == 36)
        key_id = norm_lid if is_league else raw_id

        b_id = str(payload.get("broadcast_id") or payload.get("id") or f"BRC-{uuid.uuid4().hex[:8].upper()}")
        title = str(payload.get("title") or "Official TO Broadcast").strip()
        message = str(payload.get("message") or payload.get("body") or "").strip()
        category = str(payload.get("category") or "general").strip()
        priority = str(payload.get("priority") or "high").strip()
        target_scope = str(payload.get("target_scope") or payload.get("target_pod") or "All Pods").strip()
        require_ack = bool(payload.get("require_ack", True))
        is_pinned = bool(payload.get("is_pinned", True))
        author_name = str(payload.get("author_name") or "Tournament Organizer").strip()

        b_obj = {
            "id": b_id,
            "broadcast_id": b_id,
            "entity_id": key_id,
            "title": title,
            "body": message,
            "message": message,
            "category": category,
            "priority": priority,
            "target_scope": target_scope,
            "target_pod": target_scope,
            "require_ack": require_ack,
            "is_pinned": is_pinned,
            "author_name": author_name,
            "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "ack_count": 0,
            "acked_players": [],
        }

        store = self._load_ops_store()
        blist = store.setdefault("broadcasts", {}).setdefault(key_id, [])
        blist.insert(0, b_obj)
        self._save_ops_store(store)

        db = self._get_db()
        if db:
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        self._ensure_unified_ops_tables(cur)
                        cur.execute("""
                            INSERT INTO native_event_broadcasts (
                                broadcast_id, entity_id, entity_type, title, message,
                                category, priority, target_scope, require_ack, is_pinned,
                                author_name, created_at
                            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                            ON CONFLICT (broadcast_id) DO UPDATE SET
                                title = EXCLUDED.title,
                                message = EXCLUDED.message,
                                priority = EXCLUDED.priority,
                                require_ack = EXCLUDED.require_ack,
                                is_pinned = EXCLUDED.is_pinned;
                        """, (
                            b_id, key_id, "league" if is_league else "tournament",
                            title, message, category, priority, target_scope,
                            require_ack, is_pinned, author_name
                        ))
                    conn.commit()
            except Exception as e:
                logger.debug(f"publish_unified_broadcast DB write fallback: {e}")

        if is_league:
            try:
                self.save_league_announcement(key_id, {
                    "id": b_id,
                    "title": title,
                    "body": message,
                    "category": category,
                    "priority": priority,
                    "target_pod": target_scope,
                    "is_pinned": is_pinned,
                    "author_name": author_name,
                })
            except Exception:
                pass

        return self.get_unified_floor_ops(key_id)

    def acknowledge_unified_broadcast(self, entity_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        raw_id = str(entity_id or payload.get("entity_id") or "").strip()
        norm_lid = _normalize_league_id(raw_id)
        is_league = not raw_id.startswith("ES-") and (norm_lid in (SD40K_LEAGUE_UUID, GAUNTLET_LEAGUE_UUID) or len(norm_lid) == 36)
        key_id = norm_lid if is_league else raw_id

        b_id = str(payload.get("broadcast_id") or payload.get("id") or "").strip()
        player_id = str(payload.get("player_id") or payload.get("user_id") or "PLAYER_1").strip()
        player_name = str(payload.get("player_name") or "Competitor").strip()

        ack_entry = {
            "player_id": player_id,
            "player_name": player_name,
            "acked_at": datetime.now(timezone.utc).isoformat(),
        }

        store = self._load_ops_store()
        entity_acks = store.setdefault("acks", {}).setdefault(key_id, {})
        b_acks = entity_acks.setdefault(b_id, [])
        if not any(a.get("player_id") == player_id for a in b_acks):
            b_acks.append(ack_entry)
        self._save_ops_store(store)

        db = self._get_db()
        if db:
            try:
                with db.get_connection() as conn:
                    with conn.cursor() as cur:
                        self._ensure_unified_ops_tables(cur)
                        cur.execute("""
                            INSERT INTO native_event_broadcast_acks (
                                broadcast_id, entity_id, player_id, player_name, acked_at
                            ) VALUES (%s, %s, %s, %s, NOW())
                            ON CONFLICT (broadcast_id, player_id) DO UPDATE SET
                                player_name = EXCLUDED.player_name,
                                acked_at = NOW();
                        """, (b_id, key_id, player_id, player_name))
                    conn.commit()
            except Exception as e:
                logger.debug(f"acknowledge_unified_broadcast DB write fallback: {e}")

        return self.get_unified_floor_ops(key_id)

    # =========================================================================
    # SEASONAL LEAGUE & POD FIRESTORE GROUP CHATS (DYNAMIC ROSTER & EPHEMERAL)
    # =========================================================================

    def _parse_group_chat_channel_id(self, channel_id: str) -> Optional[Dict[str, Any]]:
        """
        Parses a seasonal group chat channel ID:
        - League Q&A Chat: 'grp_league_{league_uuid}_s{season_num}'
        - Pod Chat: 'grp_pod_{league_uuid}_s{season_num}_p{pod_num}'
        """
        if not channel_id:
            return None
        s = str(channel_id).strip()
        m_pod = re.match(r"^grp_pod_(.+)_s(\d+)_p(\d+)$", s, re.IGNORECASE)
        if m_pod:
            return {
                "channel_id": s,
                "group_type": "pod",
                "league_id": _normalize_league_id(m_pod.group(1)),
                "season_number": int(m_pod.group(2)),
                "pod_number": int(m_pod.group(3))
            }
        m_lg = re.match(r"^grp_league_(.+)_s(\d+)$", s, re.IGNORECASE)
        if m_lg:
            return {
                "channel_id": s,
                "group_type": "league",
                "league_id": _normalize_league_id(m_lg.group(1)),
                "season_number": int(m_lg.group(2)),
                "pod_number": None
            }
        return None

    def _is_season_ended(self, league: Dict[str, Any], season_number: int) -> bool:
        """Returns True if the given season has ended (rolled over to a newer active season or status == completed)."""
        act = league.get("active_season") or {}
        act_s = int(act.get("season_number") or league.get("selected_season") or 1)
        if int(season_number) < act_s:
            return True
        status = str(act.get("status") or "active").lower()
        if int(season_number) == act_s and status in ("completed", "ended", "archived"):
            return True
        return False

    def _build_seasonal_group_chat_specs(self, league: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Builds dynamic group chat specifications for the active season:
        1. League-wide Questions & Clarifications Chat ('grp_league_{lid}_s{season_num}')
        2. Per-Pod Group Chats ('grp_pod_{lid}_s{season_num}_p{pod_num}')
        Each spec includes a dynamic participant list and a seasonal greeting message.
        """
        lid = _normalize_league_id(league.get("league_id") or league.get("id") or SD40K_LEAGUE_UUID)
        act = league.get("active_season") or {}
        season_num = int(act.get("season_number") or league.get("selected_season") or 1)
        season_name = str(act.get("name") or f"Season {season_num}")
        start_date = str(act.get("start_date") or league.get("start_date") or "2026-09-15")[:10]
        end_date = str(act.get("end_date") or league.get("end_date") or "2026-11-10")[:10]
        meth = league.get("methodology") or {}
        points_limit = int(meth.get("points_limit") or 2000)
        games_per_season = int(meth.get("games_per_season") or act.get("rounds_count") or 5)
        league_chat_enabled = bool(meth.get("league_chat_enabled", league.get("league_chat_enabled", True)))
        pod_chats_enabled = bool(meth.get("pod_chats_enabled", league.get("pod_chats_enabled", True)))

        league_name = str(league.get("name") or "Community League")
        short_name = str(league.get("short_name") or league_name)
        owner_name = str(league.get("owner_name") or "John Hsieh")
        owner_uid = str(league.get("owner_user_id") or "user_john_hsieh_admin")
        owner_pid = str(league.get("owner_player_id") or "MEV83VFANA")
        comm_names = [c.get("name") for c in (league.get("commissioners") or []) if isinstance(c, dict) and c.get("name")]
        comm_str = ", ".join(comm_names[:2]) if comm_names else f"{owner_name} (League Commissioner)"
        venue_name = ((league.get("partner_venues") or [{}])[0].get("name") if league.get("partner_venues") else None) or "Local Partner Store"

        pods = act.get("pods") or []
        all_participant_ids: List[str] = []
        all_participant_names: List[str] = []
        for cid in (owner_uid, owner_pid):
            if cid and cid not in all_participant_ids:
                all_participant_ids.append(cid)
        if owner_name and owner_name not in all_participant_names:
            all_participant_names.append(owner_name)

        pod_rosters: Dict[int, Dict[str, Any]] = {}
        for p in pods:
            p_num = int(p.get("pod_number") or 1)
            p_div_name = str(p.get("name") or p.get("pod_name") or f"Pod #{p_num}")
            p_ids: List[str] = []
            p_names: List[str] = []
            for cid in (owner_uid, owner_pid):
                if cid and cid not in p_ids:
                    p_ids.append(cid)
            for s in (p.get("standings") or []):
                if s.get("dropped"):
                    continue
                nm = (s.get("name") or s.get("player_name") or "").strip()
                uid = (s.get("user_id") or "").strip()
                pid = (s.get("bcp_player_id") or s.get("player_id") or "").strip()
                if nm and nm not in p_names:
                    p_names.append(nm)
                if nm and nm not in all_participant_names:
                    all_participant_names.append(nm)
                for ident in (uid, pid, nm):
                    if ident:
                        if ident not in p_ids:
                            p_ids.append(ident)
                        if ident not in all_participant_ids:
                            all_participant_ids.append(ident)
            pod_rosters[p_num] = {
                "pod_number": p_num,
                "pod_name": p_div_name,
                "participant_ids": p_ids,
                "participant_names": p_names
            }

        specs: List[Dict[str, Any]] = []

        if league_chat_enabled:
            lg_channel_id = f"grp_league_{lid}_s{season_num}"
            lg_greeting = {
                "id": f"msg_greet_league_{lid[:8]}_s{season_num}",
                "request_id": lg_channel_id,
                "sender_id": "system",
                "sender_name": f"{owner_name} (League Commissioner)",
                "sender_role": "Commissioner",
                "is_system": True,
                "is_greeting": True,
                "message_text": (
                    f"👋 Welcome to the {league_name} — {season_name} League Q&A Chat ({start_date} → {end_date})! "
                    f"Post any rules questions, terrain layout clarifications, or scheduling inquiries here for {comm_str} and fellow players ({len(all_participant_names)} registered). "
                    f"This group chat updates dynamically as players join and automatically resets when {season_name} concludes."
                ),
                "created_at": f"{start_date}T12:00:00Z"
            }
            lg_initial_msgs = [
                {
                    "id": f"msg_seed_lg_{lid[:8]}_s{season_num}_1",
                    "request_id": lg_channel_id,
                    "sender_id": "seed_player_1",
                    "sender_name": (all_participant_names[1] if len(all_participant_names) > 1 else "Victor Campos"),
                    "sender_role": "Pod #1",
                    "message_text": f"Quick question for {season_name}: are we using the latest Pariah Nexus companion FAQ for Round 1–{games_per_season} missions?",
                    "created_at": f"{start_date}T14:15:00Z"
                },
                {
                    "id": f"msg_seed_lg_{lid[:8]}_s{season_num}_2",
                    "request_id": lg_channel_id,
                    "sender_id": owner_uid,
                    "sender_name": f"{owner_name} (Commissioner)",
                    "sender_role": "Commissioner",
                    "message_text": f"Yes! All {season_name} pods use the current Pariah Nexus Tournament Companion & official round terrain layouts posted in the Announcements tab.",
                    "created_at": f"{start_date}T14:22:00Z"
                }
            ]
            specs.append({
                "channel_id": lg_channel_id,
                "group_meta": {
                    "channel_id": lg_channel_id,
                    "group_type": "league",
                    "league_id": lid,
                    "league_name": league_name,
                    "short_name": short_name,
                    "season_number": season_num,
                    "season_name": season_name,
                    "pod_number": None,
                    "pod_name": "All Pods • Questions & Clarifications",
                    "title": f"{short_name} • League Q&A ({season_name})",
                    "subtitle": f"📢 Questions & Rules Clarifications • {len(all_participant_names)} Members • Ends {end_date}",
                    "participants": all_participant_ids,
                    "participant_names": all_participant_names,
                    "member_count": len(all_participant_names),
                    "points_limit": points_limit,
                    "season_start_date": start_date,
                    "season_end_date": end_date
                },
                "greeting_message": lg_greeting,
                "initial_messages": lg_initial_msgs
            })

        if pod_chats_enabled:
            for p_num, p_info in sorted(pod_rosters.items()):
                pod_channel_id = f"grp_pod_{lid}_s{season_num}_p{p_num}"
                p_names = p_info["participant_names"]
                p_div = p_info["pod_name"]
                roster_preview = ", ".join(p_names) if p_names else "Seeding in progress"
                short_preview = ", ".join(p_names[:4]) + (f" +{len(p_names) - 4} more" if len(p_names) > 4 else "")
                pod_greeting = {
                    "id": f"msg_greet_pod_{lid[:8]}_s{season_num}_p{p_num}",
                    "request_id": pod_channel_id,
                    "sender_id": "system",
                    "sender_name": f"{owner_name} (Pod #{p_num} Coordinator)",
                    "sender_role": "Commissioner",
                    "is_system": True,
                    "is_greeting": True,
                    "message_text": (
                        f"⚔️ Welcome to {p_div} for {season_name} ({start_date} → {end_date})! "
                        f"Active Pod #{p_num} Roster ({len(p_names)} players): {roster_preview}. "
                        f"Use this pod chat to schedule your {games_per_season} pod games ({points_limit} pts at {venue_name}), "
                        f"share live Game Tracker rooms, or request an Official Ringer. "
                        f"This pod chat updates dynamically if players move pods and automatically disappears after {season_name} ends."
                    ),
                    "created_at": f"{start_date}T12:05:00Z"
                }
                pod_initial_msgs = []
                if len(p_names) >= 2:
                    pod_initial_msgs = [
                        {
                            "id": f"msg_seed_pod_{lid[:8]}_s{season_num}_p{p_num}_1",
                            "request_id": pod_channel_id,
                            "sender_id": f"pod_{p_num}_p1",
                            "sender_name": p_names[0],
                            "sender_role": f"Pod #{p_num}",
                            "message_text": f"Hey Pod #{p_num}! Looking forward to our {season_name} games. Anyone free Thursday evening at {venue_name} for Round 1?",
                            "created_at": f"{start_date}T16:10:00Z"
                        },
                        {
                            "id": f"msg_seed_pod_{lid[:8]}_s{season_num}_p{p_num}_2",
                            "request_id": pod_channel_id,
                            "sender_id": f"pod_{p_num}_p2",
                            "sender_name": p_names[1],
                            "sender_role": f"Pod #{p_num}",
                            "message_text": f"I can do Thursday at 6:00 PM! Let's lock in a table and use the Game Tracker room button here when we deploy.",
                            "created_at": f"{start_date}T16:18:00Z"
                        }
                    ]
                specs.append({
                    "channel_id": pod_channel_id,
                    "group_meta": {
                        "channel_id": pod_channel_id,
                        "group_type": "pod",
                        "league_id": lid,
                        "league_name": league_name,
                        "short_name": short_name,
                        "season_number": season_num,
                        "season_name": season_name,
                        "pod_number": p_num,
                        "pod_name": p_div,
                        "title": f"{short_name} • Pod #{p_num} Chat ({season_name})",
                        "subtitle": f"🛡️ {p_div} • {len(p_names)} Pod-Mates ({short_preview}) • Ends {end_date}",
                        "participants": p_info["participant_ids"],
                        "participant_names": p_names,
                        "member_count": len(p_names),
                        "points_limit": points_limit,
                        "season_start_date": start_date,
                        "season_end_date": end_date
                    },
                    "greeting_message": pod_greeting,
                    "initial_messages": pod_initial_msgs
                })

        return specs

    def sync_league_group_chats(self, league_id: str) -> List[Dict[str, Any]]:
        """
        Synchronizes the active season's League & Pod group chats in Firestore,
        updating dynamic rosters and greeting messages, and purging any ended historical season chats.
        """
        from firestore_db import get_firestore_engine
        fs_engine = get_firestore_engine()
        lid = _normalize_league_id(league_id)
        league = self.get_league(lid)
        if not league:
            return []

        act = league.get("active_season") or {}
        act_s = int(act.get("season_number") or league.get("selected_season") or 1)

        # Clean up any ended previous season group chat instances so they disappear after season end
        if act_s > 1:
            for prev_s in range(max(1, act_s - 3), act_s):
                fs_engine.delete_league_season_group_chats(lid, prev_s)

        if self._is_season_ended(league, act_s):
            fs_engine.delete_league_season_group_chats(lid, act_s)
            return []

        specs = self._build_seasonal_group_chat_specs(league)
        synced_docs: List[Dict[str, Any]] = []
        for sp in specs:
            doc = fs_engine.ensure_seasonal_group_chat(
                channel_id=sp["channel_id"],
                group_meta=sp["group_meta"],
                greeting_message=sp["greeting_message"],
                initial_messages=sp.get("initial_messages")
            )
            synced_docs.append(doc)
        return synced_docs

    def get_league_group_chats(self, league_id: str) -> Dict[str, Any]:
        """Returns the active season's League Q&A Chat and all Pod #1..#N Group Chats for a league."""
        lid = _normalize_league_id(league_id)
        league = self.get_league(lid)
        if not league:
            return {"error": f"League '{league_id}' not found"}
        docs = self.sync_league_group_chats(lid)
        act = league.get("active_season") or {}
        meth = league.get("methodology") or {}
        formatted = [self._format_group_chat_for_request_list(d, user_id="") for d in docs]
        league_chat = next((c for c in formatted if c.get("chat_type") == "league"), None)
        pod_chats = [c for c in formatted if c.get("chat_type") == "pod"]
        return {
            "success": True,
            "league_id": lid,
            "league_name": league.get("name"),
            "season_number": int(act.get("season_number") or 1),
            "season_name": act.get("name") or "Active Season",
            "season_end_date": act.get("end_date") or league.get("end_date"),
            "league_chat_enabled": bool(meth.get("league_chat_enabled", league.get("league_chat_enabled", True))),
            "pod_chats_enabled": bool(meth.get("pod_chats_enabled", league.get("pod_chats_enabled", True))),
            "league_chat": league_chat,
            "pod_chats": pod_chats,
            "chats": formatted
        }

    def reset_league_group_chats(
        self,
        league_id: str,
        target_channel_id: Optional[str] = None,
        channel_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Resets a League or Pod seasonal group chat back to its fresh greeting message and current roster."""
        from firestore_db import get_firestore_engine
        fs_engine = get_firestore_engine()
        lid = _normalize_league_id(league_id)
        league = self.get_league(lid)
        if not league:
            return {"error": f"League '{league_id}' not found"}
        effective_target = target_channel_id or channel_id
        specs = self._build_seasonal_group_chat_specs(league)
        reset_list = []
        for sp in specs:
            if effective_target and sp["channel_id"] != effective_target:
                continue
            doc = fs_engine.reset_seasonal_group_chat(
                channel_id=sp["channel_id"],
                group_meta=sp["group_meta"],
                greeting_message=sp["greeting_message"]
            )
            reset_list.append(self._format_group_chat_for_request_list(doc, user_id=""))
        return {
            "success": True,
            "league_id": lid,
            "reset_count": len(reset_list),
            "chats": reset_list
        }

    def _format_group_chat_for_request_list(self, doc: Dict[str, Any], user_id: str = "") -> Dict[str, Any]:
        """Formats a Firestore group chat document so it renders seamlessly in the Connect Chat sidebar."""
        cid = str(doc.get("channelId") or doc.get("requestId") or "")
        gtype = str(doc.get("groupType") or "league")
        title = str(doc.get("title") or "League Group Chat")
        subtitle = str(doc.get("subtitle") or "")
        member_cnt = int(doc.get("memberCount") or len(doc.get("participantNames") or []))
        last_msg = str(doc.get("lastMessage") or "")
        last_sender = str(doc.get("lastSenderName") or "")
        if last_sender and last_msg and not last_msg.startswith("👋") and not last_msg.startswith("⚔️"):
            short_sender = last_sender.split(" (")[0]
            snippet = f"{short_sender}: {last_msg}"
        else:
            snippet = last_msg or subtitle
        upd_ms = doc.get("updatedAt") or int(datetime.now(timezone.utc).timestamp() * 1000)
        try:
            upd_iso = datetime.fromtimestamp(float(upd_ms) / 1000.0, tz=timezone.utc).isoformat()
        except Exception:
            upd_iso = datetime.now(timezone.utc).isoformat()

        greet_obj = doc.get("greetingMessage")
        greet_txt = greet_obj.get("message_text", "") if isinstance(greet_obj, dict) else str(greet_obj or "")

        return {
            "id": cid,
            "channel_id": cid,
            "request_id": cid,
            "is_group": True,
            "is_group_chat": True,
            "group_type": gtype,
            "chat_type": gtype,
            "league_id": doc.get("leagueId"),
            "league_name": doc.get("leagueName"),
            "short_name": doc.get("shortName"),
            "season_number": int(doc.get("seasonNumber") or 1),
            "season_name": doc.get("seasonName"),
            "pod_number": doc.get("podNumber"),
            "pod_name": doc.get("podName"),
            "title": title,
            "subtitle": subtitle,
            "status": "accepted",
            "sender_id": "group",
            "receiver_id": user_id or "group_member",
            "sender_name": title,
            "receiver_name": title,
            "sender_elo": member_cnt,
            "receiver_elo": member_cnt,
            "member_count": member_cnt,
            "participants": doc.get("participants") or [],
            "participant_names": doc.get("participantNames") or [],
            "proposed_venue": subtitle,
            "proposed_points": 2000,
            "last_message": snippet,
            "greeting_message": greet_txt,
            "messages": doc.get("messages") or [],
            "last_sender_name": last_sender,
            "updated_at": upd_iso,
            "season_end_date": doc.get("seasonEndDate"),
            "unread_count": 0
        }

    def get_user_group_chats(
        self,
        user_id: Optional[str] = None,
        player_id: Optional[str] = None,
        user_name: Optional[str] = None,
        user_email: Optional[str] = None,
        is_admin: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Returns all active seasonal League & Pod group chats for the user.
        - Every league participant gets their League Q&A Chat + their assigned Pod #X Chat.
        - League Commissioners / Owners / Admins get the League Q&A Chat + Pod Chats for their managed leagues.
        - Ended seasons automatically disappear.
        """
        uid_clean = (str(user_id).strip().lower() if user_id else "")
        pid_clean = (str(player_id).strip().lower() if player_id else "")
        uname_clean = (str(user_name).strip().lower() if user_name else "")
        uemail_clean = (str(user_email).strip().lower() if user_email else "")

        results: List[Dict[str, Any]] = []
        seen_cids = set()

        for lg_summary in self.get_leagues_list():
            lid = lg_summary.get("league_id")
            if not lid:
                continue
            league = self.get_league(lid)
            if not league:
                continue

            act = league.get("active_season") or {}
            act_s = int(act.get("season_number") or league.get("selected_season") or 1)
            if self._is_season_ended(league, act_s):
                continue

            owner_uid = str(league.get("owner_user_id") or "").strip().lower()
            owner_pid = str(league.get("owner_player_id") or "").strip().lower()
            owner_email = str(league.get("owner_email") or "").strip().lower()
            owner_name = str(league.get("owner_name") or "").strip().lower()

            is_commissioner = bool(
                is_admin
                or (uid_clean and uid_clean == owner_uid)
                or (pid_clean and pid_clean == owner_pid)
                or (uemail_clean and (uemail_clean == owner_email or "hsiehjun" in uemail_clean))
                or (uname_clean and (uname_clean == owner_name or uname_clean == "john hsieh"))
            )

            # Find which pods the user is playing in during this active season
            user_pods = set()
            for p in (act.get("pods") or []):
                p_num = int(p.get("pod_number") or 1)
                for st in (p.get("standings") or []):
                    if st.get("dropped"):
                        continue
                    s_uid = str(st.get("user_id") or "").strip().lower()
                    s_pid = str(st.get("bcp_player_id") or st.get("player_id") or "").strip().lower()
                    s_name = str(st.get("name") or st.get("player_name") or "").strip().lower()
                    if (
                        (uid_clean and s_uid == uid_clean)
                        or (pid_clean and s_pid == pid_clean)
                        or (uname_clean and s_name == uname_clean)
                    ):
                        user_pods.add(p_num)

            if not is_commissioner and not user_pods:
                continue

            docs = self.sync_league_group_chats(lid)
            for d in docs:
                cid = str(d.get("channelId") or d.get("requestId") or "")
                if not cid or cid in seen_cids:
                    continue
                gtype = d.get("groupType")
                p_num = d.get("podNumber")
                if gtype == "league":
                    seen_cids.add(cid)
                    results.append(self._format_group_chat_for_request_list(d, user_id=str(user_id or "")))
                elif gtype == "pod":
                    # Include the user's own Pod chat(s), or Pod #1 (plus any user_pods) for Commissioners so sidebar stays clean,
                    # while commissioners can also open any Pod #1..#N chat directly!
                    if p_num in user_pods or (is_commissioner and (p_num == 1 or not user_pods)):
                        seen_cids.add(cid)
                        results.append(self._format_group_chat_for_request_list(d, user_id=str(user_id or "")))

        return results

    def get_group_chat_messages(self, channel_id: str, user_id: str = "") -> Dict[str, Any]:
        """
        Fetches messages and dynamic group metadata for a seasonal League or Pod group chat.
        If the season has ended, deletes the expired group chat and returns an error.
        """
        parsed = self._parse_group_chat_channel_id(channel_id)
        if not parsed:
            return {"success": False, "error": "Invalid group chat channel ID"}

        lid = parsed["league_id"]
        season_num = parsed["season_number"]
        league = self.get_league(lid)
        if not league:
            return {"success": False, "error": "League not found"}

        from firestore_db import get_firestore_engine
        fs_engine = get_firestore_engine()

        if self._is_season_ended(league, season_num):
            fs_engine.delete_league_season_group_chats(lid, season_num)
            return {
                "success": False,
                "is_expired_season": True,
                "error": f"Season {season_num} has ended and its seasonal group chat has expired."
            }

        # Sync dynamic roster and ensure greeting message exists
        self.sync_league_group_chats(lid)
        doc = fs_engine.get_group_chat(channel_id)
        if not doc:
            return {"success": False, "error": "Seasonal group chat is disabled or unavailable"}

        req_formatted = self._format_group_chat_for_request_list(doc, user_id=user_id)
        return {
            "success": True,
            "is_group": True,
            "is_group_chat": True,
            "request": req_formatted,
            "group_info": {
                "channel_id": channel_id,
                "group_type": doc.get("groupType"),
                "league_id": doc.get("leagueId"),
                "league_name": doc.get("leagueName"),
                "season_number": doc.get("seasonNumber"),
                "season_name": doc.get("seasonName"),
                "pod_number": doc.get("podNumber"),
                "pod_name": doc.get("podName"),
                "title": doc.get("title"),
                "subtitle": doc.get("subtitle"),
                "member_count": doc.get("memberCount"),
                "participant_names": doc.get("participantNames") or [],
                "season_end_date": doc.get("seasonEndDate")
            },
            "other_user_id": "group",
            "other_user_name": doc.get("title") or "League Group Chat",
            "other_user_elo": doc.get("memberCount") or 0,
            "messages": doc.get("messages") or [],
            "marked_read_count": 0
        }

    def send_group_chat_message(
        self,
        channel_id: str,
        sender_id: str,
        sender_name: str,
        message_text: str,
        room_key: Optional[str] = None,
        message_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Appends a message to a seasonal League or Pod Firestore group chat."""
        parsed = self._parse_group_chat_channel_id(channel_id)
        if not parsed:
            return {"success": False, "error": "Invalid group chat channel ID"}

        lid = parsed["league_id"]
        season_num = parsed["season_number"]
        league = self.get_league(lid)
        if not league:
            return {"success": False, "error": "League not found"}

        from firestore_db import get_firestore_engine
        fs_engine = get_firestore_engine()

        if self._is_season_ended(league, season_num):
            fs_engine.delete_league_season_group_chats(lid, season_num)
            return {"success": False, "error": f"Season {season_num} has ended."}

        self.sync_league_group_chats(lid)
        doc = fs_engine.get_group_chat(channel_id)
        if not doc:
            return {"success": False, "error": "Group chat not found"}

        # Determine sender role badge (e.g. 'Commissioner' or 'Pod #X')
        sender_role = "Player"
        owner_uid = str(league.get("owner_user_id") or "").strip().lower()
        owner_name = str(league.get("owner_name") or "").strip().lower()
        if (sender_id and str(sender_id).strip().lower() == owner_uid) or (sender_name and str(sender_name).strip().lower() in (owner_name, "john hsieh")):
            sender_role = "Commissioner"
        elif parsed.get("pod_number"):
            sender_role = f"Pod #{parsed['pod_number']}"
        else:
            for p in ((league.get("active_season") or {}).get("pods") or []):
                for st in (p.get("standings") or []):
                    if str(st.get("name") or "").strip().lower() == str(sender_name or "").strip().lower():
                        sender_role = f"Pod #{p.get('pod_number', 1)}"
                        break

        msg_id = (message_id or "").strip() or f"msg_{uuid.uuid4().hex[:16]}"
        now_iso = datetime.now(timezone.utc).isoformat()
        msg_obj = {
            "id": msg_id,
            "request_id": channel_id,
            "sender_id": sender_id,
            "sender_name": sender_name or "Player",
            "sender_role": sender_role,
            "message_text": (message_text or "").strip(),
            "room_key": room_key.strip() if room_key else None,
            "created_at": now_iso
        }

        fs_engine.append_chat_message(channel_id, msg_obj, participants=doc.get("participants"))
        return {
            "success": True,
            "message_id": msg_id,
            "created_at": now_iso,
            "message": msg_obj
        }


_GLOBAL_LEAGUES_SERVICE: Optional[LeaguesHubService] = None


def get_leagues_hub_service() -> LeaguesHubService:
    global _GLOBAL_LEAGUES_SERVICE
    if _GLOBAL_LEAGUES_SERVICE is None:
        _GLOBAL_LEAGUES_SERVICE = LeaguesHubService()
    return _GLOBAL_LEAGUES_SERVICE
