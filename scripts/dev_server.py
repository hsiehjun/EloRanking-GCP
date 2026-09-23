#!/usr/bin/env python3
"""
Lightweight development server for OmniTactica and Warhammer 40k Game Tracker.
Uses only Python standard library (no external dependencies required).
"""

import http.server
import os
import sys
import time
import json
import mimetypes
import urllib.parse
import urllib.request
import secrets
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 5174))
HOST = "0.0.0.0"

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
WEB_DIR = REPO_ROOT / "web"
TRACKER_DIR = WEB_DIR / "tracker"
TRACKER_STATIC_DIR = TRACKER_DIR / "static"

EVENT_LIVESTREAMS_DB = {
    "ev_ongoing_gt_live": [
        {
            "id": "stream-1",
            "event_id": "ev_ongoing_gt_live",
            "table_number": 1,
            "channel": "Wargames Live",
            "platform": "youtube",
            "title": "US Open Atlanta Major 2026 - Day 1 Feature Table Live",
            "stream_url": "https://www.youtube.com/watch?v=live_stream_wgl",
            "embed_url": "https://www.youtube-nocookie.com/embed/jfKfPfyJRdk",
            "is_live": True,
            "viewers": 1420
        },
        {
            "id": "stream-2",
            "event_id": "ev_ongoing_gt_live",
            "table_number": 2,
            "channel": "Art of War 40k",
            "platform": "twitch",
            "title": "Art of War Commentary Desk - Table 2 & Deep Tactics",
            "stream_url": "https://www.twitch.tv/artofwar40k",
            "embed_url": "https://player.twitch.tv/?channel=artofwar40k&parent=localhost&parent=127.0.0.1",
            "is_live": True,
            "viewers": 890
        },
        {
            "id": "stream-3",
            "event_id": "ev_ongoing_gt_live",
            "table_number": 4,
            "channel": "SkaredCast Live",
            "platform": "youtube",
            "title": "Drukhari Archon Battle - Table 4 Feature Match",
            "stream_url": "https://www.youtube.com/watch?v=live_stream_skared",
            "embed_url": "https://www.youtube-nocookie.com/embed/jfKfPfyJRdk",
            "is_live": True,
            "viewers": 620
        }
    ]
}

DEV_EVENT_CACHE = {}

DEV_USERS_LIST = [
    {
        "id": "u_innes",
        "email": "innes.wilson@example.com",
        "display_name": "Innes Wilson",
        "name": "Innes Wilson",
        "role": "player",
        "is_admin": False,
        "created_at": "2026-01-10T12:00:00Z",
        "bcp_user_id": "bcp_innes_01",
        "bcp_linked_at": "2026-02-01T12:00:00Z",
        "matches_played": 34,
        "current_elo": 2185.4
    },
    {
        "id": "u_wargameslive",
        "email": "producer@wargameslive.com",
        "display_name": "Joe / Wargames Live",
        "name": "Joe / Wargames Live",
        "role": "creator",
        "is_admin": False,
        "created_at": "2026-01-15T15:30:00Z",
        "bcp_user_id": "bcp_wgl_01",
        "bcp_linked_at": "2026-02-15T12:00:00Z",
        "matches_played": 12,
        "current_elo": 1750.0
    },
    {
        "id": "u_to_admin",
        "email": "organizer@georgia40k.com",
        "display_name": "Atlanta TO Team",
        "name": "Atlanta TO Team",
        "role": "to",
        "is_admin": False,
        "created_at": "2026-01-05T09:00:00Z",
        "bcp_user_id": "bcp_to_01",
        "bcp_linked_at": "2026-01-05T09:00:00Z",
        "matches_played": 5,
        "current_elo": 1500.0
    },
    {
        "id": "u_head_admin",
        "email": "admin@omnitactica.com",
        "display_name": "Head Admin",
        "name": "Head Admin",
        "role": "admin",
        "is_admin": True,
        "is_superadmin": True,
        "created_at": "2026-01-01T00:00:00Z",
        "bcp_user_id": "bcp_admin_01",
        "bcp_linked_at": "2026-01-01T00:00:00Z",
        "matches_played": 50,
        "current_elo": 2250.0
    }
]

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

DEV_EVENTS_ATTENDED = [
    {
        "event_id": "ev_tacoma_2026",
        "event_name": "US Open Tacoma Major 2026",
        "event_date": "2026-09-02",
        "date": "2026-09-02",
        "num_rounds": 7,
        "rounds": 7,
        "placement": 1,
        "finish": 1,
        "total_players": 128,
        "wins": 7,
        "losses": 0,
        "draws": 0,
        "registered_faction": "Adeptus Custodes",
        "faction": "Adeptus Custodes",
        "is_gt": True
    },
    {
        "event_id": "ev_pnw_gt_2026",
        "event_name": "Pacific Northwest GT 2026",
        "event_date": "2026-06-15",
        "date": "2026-06-15",
        "num_rounds": 5,
        "rounds": 5,
        "placement": 1,
        "finish": 1,
        "total_players": 56,
        "wins": 5,
        "losses": 0,
        "draws": 0,
        "registered_faction": "Necrons",
        "faction": "Necrons",
        "is_gt": True
    },
    {
        "event_id": "ev_dicehead_rtt_2026",
        "event_name": "Dicehead Spring RTT 2026",
        "event_date": "2026-03-22",
        "date": "2026-03-22",
        "num_rounds": 3,
        "rounds": 3,
        "placement": 1,
        "finish": 1,
        "total_players": 24,
        "wins": 3,
        "losses": 0,
        "draws": 0,
        "registered_faction": "Space Marines",
        "faction": "Space Marines",
        "is_gt": False
    },
    {
        "event_id": "ev_active_lvo_2026",
        "event_name": "LVO 2026 Warhammer 40K Champs",
        "event_date": "2026-01-18",
        "date": "2026-01-18",
        "rounds": 5,
        "finish": 4,
        "total_players": 128,
        "is_gt": True
    }
]

DEV_USER = get_persona_user("competitor")
DEV_USER["events_attended"] = DEV_EVENTS_ATTENDED

def _get_dev_user_glory_and_stats():
    """Computes authentic Unified Glory points across 40K and AoS matching the user's Trophy Tab."""
    v = DEV_USER.setdefault("armory_vault", {
        "inventory": {
            "dice_molten_magma": {"id": "dice_molten_magma", "purchased_at": "2026-09-15T12:00:00Z"},
            "dice_sanctified_ceramite": {"id": "dice_sanctified_ceramite", "purchased_at": "2026-09-10T12:00:00Z"},
            "dice_40k_dark_angels": {"id": "dice_40k_dark_angels", "purchased_at": "2026-09-12T12:00:00Z"},
            "dice_dark_angels_caliban": {"id": "dice_40k_dark_angels", "purchased_at": "2026-09-12T12:00:00Z"},
            "frame_peak_high_warlord": {"id": "frame_peak_high_warlord", "purchased_at": "2026-09-14T12:00:00Z"},
            "avatar_dark_angels": {"id": "avatar_dark_angels", "purchased_at": "2026-09-08T12:00:00Z"},
            "title_gt_champion": {"id": "title_gt_champion", "purchased_at": "2026-09-12T12:00:00Z"},
            "frame_astral_holofoil": {"id": "frame_astral_holofoil", "purchased_at": "2026-09-18T12:00:00Z"}
        },
        "equipped": {
            "40k": {
                "active_dice": "dice_40k_dark_angels",
                "active_card_frame": "frame_peak_high_warlord",
                "active_card_finish": "frame_astral_holofoil",
                "active_title": "title_gt_champion",
                "active_avatar": "avatar_dark_angels"
            },
            "aos": {"active_dice": None, "active_card_frame": None, "active_card_finish": None, "active_title": None, "active_avatar": None},
            "active_dice": "dice_40k_dark_angels",
            "active_card_frame": "frame_peak_high_warlord",
            "active_card_finish": "frame_astral_holofoil",
            "active_title": "title_gt_champion",
            "active_avatar": "avatar_dark_angels"
        }
    })
    glory_aos = int(DEV_USER.get("glory_aos") if DEV_USER.get("glory_aos") is not None else 110)
    if DEV_USER.get("total_glory") is not None:
        total_earned = int(DEV_USER["total_glory"])
        glory_40k = max(0, total_earned - glory_aos)
    else:
        glory_40k = int(DEV_USER.get("glory_40k") if DEV_USER.get("glory_40k") is not None else 8780)
        total_earned = glory_40k + glory_aos
    spent = int(DEV_USER.get("glory_spent") if DEV_USER.get("glory_spent") is not None else 8500)
    spendable = max(0, total_earned - spent)
    DEV_USER["total_glory"] = total_earned
    DEV_USER["glory_40k"] = glory_40k
    DEV_USER["glory_balance"] = spendable
    DEV_USER["glory_spent"] = spent
    crest_tier = int(DEV_USER.get("crest_tier", 5))
    peak_elo = float(DEV_USER.get("peak_elo", 1890.0))

    return {
        "vault": v,
        "total_earned": total_earned,
        "total_glory": total_earned,
        "glory_40k": glory_40k,
        "glory_aos": glory_aos,
        "glory_spent": spent,
        "spendable_glory": spendable,
        "glory_balance": spendable,
        "crest_tier": crest_tier,
        "peak_elo": peak_elo
    }


DEV_STUDIO_EVENT = {
    "id": "Xeqy73dRB0LL",
    "name": "Bay Area Open 2026 Grand Tournament",
    "tier": "Grand Tournament",
    "event_date": "2026-09-18",
    "city": "San Jose",
    "state": "CA",
    "country": "USA",
    "venue": "San Jose Convention Center",
    "num_rounds": 5,
    "points": 2000,
    "capacity": 64,
    "current_round": 1,
    "started": False,
    "is_ended": False,
    "bcp_synced": True,
    "bcp_status": "synced",
    "pairings_status": "unpaired",
    "is_published": False,
    "published_round": 1,
    "total_players": 8,
    "roster": [
        {"id": "p_innes", "player_id": "p_innes", "user_id": "u_innes", "name": "Innes Wilson", "faction": "Adeptus Custodes", "team": "Team Scotland", "elo": 1942.5, "checked_in": True, "dropped": False},
        {"id": "p_david", "player_id": "p_david", "user_id": "u_david", "name": "David Gaylard", "faction": "Necrons", "team": "Team UK", "elo": 1890.1, "checked_in": True, "dropped": False},
        {"id": "p_john", "player_id": "p_john", "user_id": "u_john", "name": "John Hsieh", "faction": "Aeldari", "team": "Team Zero Comp", "elo": 1720.4, "checked_in": True, "dropped": False},
        {"id": "p_alex", "player_id": "p_alex", "user_id": "u_alex", "name": "Alex Clark", "faction": "Orks", "team": "Team Zero Comp", "elo": 1705.8, "checked_in": True, "dropped": False},
        {"id": "p_manny", "player_id": "p_manny", "user_id": "u_manny", "name": "Manny Cheema", "faction": "Tyranids", "team": "Team UK", "elo": 1850.0, "checked_in": True, "dropped": False},
        {"id": "p_brad", "player_id": "p_brad", "user_id": "u_brad", "name": "Brad Chester", "faction": "Aeldari", "team": "Art of War", "elo": 1910.2, "checked_in": True, "dropped": False},
        {"id": "p_jack", "player_id": "p_jack", "user_id": "u_jack", "name": "Jack Harpster", "faction": "Blood Angels", "team": "Art of War", "elo": 1885.6, "checked_in": True, "dropped": False},
        {"id": "p_richard", "player_id": "p_richard", "user_id": "u_richard", "name": "Richard Siegler", "faction": "Adeptus Mechanicus", "team": "Art of War", "elo": 1960.0, "checked_in": True, "dropped": False}
    ],
    "pairings": {}
}

def dev_generate_pairings(mode="swiss", target_round=1):
    import random
    roster = [p for p in DEV_STUDIO_EVENT["roster"] if not p.get("dropped")]
    candidates = list(roster)
    if mode == "random":
        random.shuffle(candidates)
    elif mode == "elo_balanced":
        candidates.sort(key=lambda p: float(p.get("elo") or 1500.0), reverse=True)
    else:  # swiss
        candidates.sort(key=lambda p: float(p.get("elo") or 1500.0), reverse=True)
        paired = []
        unpaired = list(candidates)
        while unpaired:
            p1 = unpaired.pop(0)
            best_idx = -1
            for i, p2 in enumerate(unpaired):
                t1 = (p1.get("team") or "").strip().lower()
                t2 = (p2.get("team") or "").strip().lower()
                if not (t1 and t2 and t1 == t2):
                    best_idx = i
                    break
            if best_idx != -1:
                p2 = unpaired.pop(best_idx)
                paired.extend([p1, p2])
            elif unpaired:
                p2 = unpaired.pop(0)
                paired.extend([p1, p2])
            else:
                paired.append(p1)
        candidates = paired

    pairings = []
    table = 1
    idx = 0
    while idx < len(candidates):
        p1 = candidates[idx]
        if idx + 1 < len(candidates):
            p2 = candidates[idx + 1]
            e1 = float(p1.get("elo") or 1500.0)
            e2 = float(p2.get("elo") or 1500.0)
            prob1 = round(1.0 / (1.0 + 10.0 ** ((e2 - e1) / 400.0)) * 100.0, 1)
            prob2 = round(100.0 - prob1, 1)
            t1 = (p1.get("team") or "").strip().lower()
            t2 = (p2.get("team") or "").strip().lower()
            same_team = bool(t1 and t2 and t1 == t2)
            pairings.append({
                "id": f"bcp-pairing-r{target_round}-t{table}",
                "table": table,
                "tableNumber": table,
                "round": target_round,
                "p1_id": str(p1["id"]),
                "p1_name": p1["name"],
                "p1_faction": p1["faction"],
                "p1_team": p1.get("team", ""),
                "p1_elo": e1,
                "p1_win_prob": prob1,
                "p1_score": 0,
                "p2_id": str(p2["id"]),
                "p2_name": p2["name"],
                "p2_faction": p2["faction"],
                "p2_team": p2.get("team", ""),
                "p2_elo": e2,
                "p2_win_prob": prob2,
                "p2_score": 0,
                "is_rematch": False,
                "rematch_rounds": [],
                "same_team": same_team,
                "is_done": False,
                "is_bye": False
            })
            idx += 2
        else:
            pairings.append({
                "id": f"bcp-pairing-r{target_round}-t{table}",
                "table": table,
                "tableNumber": table,
                "round": target_round,
                "p1_id": str(p1["id"]),
                "p1_name": p1["name"],
                "p1_faction": p1["faction"],
                "p1_team": p1.get("team", ""),
                "p1_elo": float(p1.get("elo") or 1500.0),
                "p1_win_prob": 100.0,
                "p1_score": 100,
                "p2_id": "",
                "p2_name": "BYE",
                "p2_faction": "",
                "p2_team": "",
                "p2_elo": 0.0,
                "p2_win_prob": 0.0,
                "p2_score": 0,
                "is_rematch": False,
                "rematch_rounds": [],
                "same_team": False,
                "is_done": True,
                "is_bye": True
            })
            idx += 1
        table += 1
    return pairings

DEV_STUDIO_EVENT["pairings"] = {"1": dev_generate_pairings("swiss", 1)}
DEV_STUDIO_EVENT["pairings_status"] = "staged"

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

def enrich_roster_with_wahapedia_mock(parsed: dict, raw_text: str) -> dict:
    if not parsed or not isinstance(parsed, dict):
        return parsed
    
    import re
    text_lower = (raw_text or '').lower()
    
    # 1. Datasheet lookup table
    waha_datasheets = {
        'chaos lord with jump pack': {
            'name': 'Chaos Lord with Jump Pack',
            'role': 'Character',
            'is_warlord': True,
            'stats': {'M': '12"', 'T': 4, 'SV': '3+', 'INV': '4+', 'W': 5, 'LD': '6+', 'OC': 1},
            'weapons': [
                {'name': 'Daemon hammer', 'type': 'Melee', 'range': 'Melee', 'A': '4', 'skill': '3+', 'S': '8', 'AP': '-2', 'D': '2', 'keywords': ['Devastating Wounds']},
                {'name': 'Plasma pistol - supercharge', 'type': 'Ranged', 'range': '12"', 'A': '1', 'skill': '2+', 'S': '8', 'AP': '-3', 'D': '2', 'keywords': ['Hazardous', 'Pistol']}
            ],
            'abilities': [
                {'name': 'Lord of Chaos', 'description': 'Once per battle round, one unit from your army with this ability can be targeted with a Stratagem for 0CP, even if another unit has already been targeted.'},
                {'name': 'Jump Pack Assault', 'description': 'Each time this model ends a Charge move, roll one D6: on a 2-5, enemy unit suffers D3 mortal wounds; on a 6, enemy unit suffers 3 mortal wounds.'}
            ],
            'keywords': ['Infantry', 'Character', 'Chaos', 'Chaos Space Marines', 'Chaos Lord', 'Jump Pack', 'Fly']
        },
        'dark apostle': {
            'name': 'Dark Apostle',
            'role': 'Character',
            'stats': {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '4+', 'W': 4, 'LD': '5+', 'OC': 1},
            'weapons': [
                {'name': 'Accursed crozius', 'type': 'Melee', 'range': 'Melee', 'A': '5', 'skill': '2+', 'S': '6', 'AP': '-1', 'D': '2', 'keywords': []},
                {'name': 'Bolt pistol', 'type': 'Ranged', 'range': '12"', 'A': '1', 'skill': '3+', 'S': '4', 'AP': '0', 'D': '1', 'keywords': ['Pistol']}
            ],
            'abilities': [
                {'name': 'Dark Zealotry', 'description': 'While this model is leading a unit, each time a model in that unit makes a melee attack, add 1 to the Wound roll.'}
            ],
            'keywords': ['Infantry', 'Character', 'Chaos', 'Dark Apostle']
        },
        'cultist mob': {
            'name': 'Cultist Mob',
            'role': 'Battleline',
            'model_count': 10,
            'stats': {'M': '6"', 'T': 3, 'SV': '6+', 'INV': '-', 'W': 1, 'LD': '7+', 'OC': 1},
            'weapons': [
                {'name': 'Cultist firearm', 'type': 'Ranged', 'range': '24"', 'A': '1', 'skill': '4+', 'S': '3', 'AP': '0', 'D': '1', 'keywords': []},
                {'name': 'Brutal assault weapon', 'type': 'Melee', 'range': 'Melee', 'A': '2', 'skill': '4+', 'S': '3', 'AP': '0', 'D': '1', 'keywords': []}
            ],
            'abilities': [
                {'name': 'For the Dark Gods', 'description': 'If you control an objective marker at the end of your Command phase and this unit is within range, it remains under your control even if you have no models within range.'}
            ],
            'keywords': ['Infantry', 'Battleline', 'Chaos', 'Cultist Mob']
        },
        'legionaries': {
            'name': 'Legionaries',
            'role': 'Battleline',
            'model_count': 5,
            'stats': {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '-', 'W': 2, 'LD': '6+', 'OC': 2},
            'weapons': [
                {'name': 'Astartes chainsword', 'type': 'Melee', 'range': 'Melee', 'A': '4', 'skill': '3+', 'S': '4', 'AP': '-1', 'D': '1', 'keywords': []},
                {'name': 'Heavy melee weapon', 'type': 'Melee', 'range': 'Melee', 'A': '3', 'skill': '3+', 'S': '8', 'AP': '-2', 'D': '2', 'keywords': []}
            ],
            'abilities': [
                {'name': 'Veterans of the Long War', 'description': 'Each time a model in this unit makes a melee attack, re-roll a Wound roll of 1. If targeting an enemy within range of an objective marker, re-roll the Wound roll instead.'}
            ],
            'keywords': ['Infantry', 'Battleline', 'Chaos', 'Legionaries']
        },
        'chaos rhino': {
            'name': 'Chaos Rhino',
            'role': 'Transports & Dedicated',
            'stats': {'M': '12"', 'T': 9, 'SV': '3+', 'INV': '-', 'W': 10, 'LD': '6+', 'OC': 2},
            'weapons': [
                {'name': 'Combi-bolter', 'type': 'Ranged', 'range': '24"', 'A': '2', 'skill': '3+', 'S': '4', 'AP': '0', 'D': '1', 'keywords': ['Rapid Fire 2']},
                {'name': 'Havoc launcher', 'type': 'Ranged', 'range': '48"', 'A': 'D6', 'skill': '3+', 'S': '5', 'AP': '0', 'D': '1', 'keywords': ['Blast', 'Indirect Fire']}
            ],
            'abilities': [
                {'name': 'Self-Repair', 'description': 'At the start of your Command phase, this model regains 1 lost wound.'},
                {'name': 'Dedicated Transport (12)', 'description': 'Can transport up to 12 Chaos Space Marines Infantry models.'}
            ],
            'keywords': ['Vehicle', 'Transport', 'Dedicated Transport', 'Smoke', 'Chaos', 'Chaos Rhino']
        },
        'warp talons': {
            'name': 'Warp Talons',
            'role': 'Mounted & Fast Attack',
            'model_count': 5,
            'stats': {'M': '12"', 'T': 4, 'SV': '3+', 'INV': '5+', 'W': 2, 'LD': '6+', 'OC': 1},
            'weapons': [
                {'name': 'Warp claws', 'type': 'Melee', 'range': 'Melee', 'A': '5', 'skill': '3+', 'S': '5', 'AP': '-2', 'D': '1', 'keywords': ['Twin-linked']}
            ],
            'abilities': [
                {'name': 'Warpflock', 'description': 'At the end of your opponent\'s turn, if this unit is not within Engagement Range, you can place it into Strategic Reserves.'}
            ],
            'keywords': ['Infantry', 'Fly', 'Chaos', 'Daemon', 'Warp Talons']
        },
        'chosen': {
            'name': 'Chosen',
            'role': 'Infantry & Elites',
            'model_count': 5,
            'stats': {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '-', 'W': 3, 'LD': '6+', 'OC': 2},
            'weapons': [
                {'name': 'Paired accursed weapons', 'type': 'Melee', 'range': 'Melee', 'A': '5', 'skill': '3+', 'S': '5', 'AP': '-2', 'D': '1', 'keywords': ['Twin-linked']}
            ],
            'abilities': [
                {'name': 'Chosen Marauders', 'description': 'This unit is eligible to shoot and declare a charge in a turn in which it Advanced or Fell Back.'}
            ],
            'keywords': ['Infantry', 'Chaos', 'Chosen']
        },
        'forgefiend': {
            'name': 'Forgefiend',
            'role': 'Vehicles & Monsters',
            'stats': {'M': '8"', 'T': 10, 'SV': '3+', 'INV': '5+', 'W': 12, 'LD': '6+', 'OC': 4},
            'weapons': [
                {'name': '3x Ectoplasma cannon', 'type': 'Ranged', 'range': '36"', 'A': '3D3', 'skill': '3+', 'S': '10', 'AP': '-3', 'D': '3', 'keywords': ['Blast']}
            ],
            'abilities': [
                {'name': 'Daemon Engine', 'description': 'This model has a 5+ invulnerable save.'},
                {'name': 'Forge Bolts', 'description': 'Each time this model makes a Dark Pact, its ranged weapons gain [DEVASTATING WOUNDS].'}
            ],
            'keywords': ['Vehicle', 'Walker', 'Daemon Engine', 'Chaos', 'Forgefiend']
        },
        'predator destructor': {
            'name': 'Predator Destructor',
            'role': 'Vehicles & Monsters',
            'stats': {'M': '10"', 'T': 10, 'SV': '3+', 'INV': '-', 'W': 11, 'LD': '6+', 'OC': 3},
            'weapons': [
                {'name': 'Predator autocannon', 'type': 'Ranged', 'range': '48"', 'A': '4', 'skill': '3+', 'S': '9', 'AP': '-1', 'D': '3', 'keywords': ['Rapid Fire 2']},
                {'name': '2x Lascannon', 'type': 'Ranged', 'range': '48"', 'A': '2', 'skill': '3+', 'S': '12', 'AP': '-3', 'D': 'D6+1', 'keywords': []}
            ],
            'abilities': [
                {'name': 'Destructor', 'description': 'Each time this model makes a ranged attack targeting an Infantry unit, improve the Armour Penetration characteristic of that attack by 1.'}
            ],
            'keywords': ['Vehicle', 'Smoke', 'Chaos', 'Predator Destructor']
        },
        'trajann valoris': {
            'name': 'Trajann Valoris',
            'role': 'Character',
            'is_warlord': True,
            'stats': {'M': '6"', 'T': 5, 'SV': '2+', 'INV': '4+', 'W': 6, 'LD': '5+', 'OC': 2},
            'weapons': [
                {'name': 'Watcher\'s Axe - strike', 'type': 'Melee', 'range': 'Melee', 'A': '6', 'skill': '2+', 'S': '10', 'AP': '-2', 'D': '3', 'keywords': []},
                {'name': 'Watcher\'s Axe - sweep', 'type': 'Melee', 'range': 'Melee', 'A': '12', 'skill': '2+', 'S': '6', 'AP': '-1', 'D': '1', 'keywords': []}
            ],
            'abilities': [
                {'name': 'Captain-General', 'description': 'While this model is leading a unit, you can ignore any or all modifiers to the characteristics of models in that unit.'},
                {'name': 'Moment Shackle', 'description': 'Once per battle, in the Fight phase, choose 12 attacks, a 2+ invulnerable save, or fight first.'}
            ],
            'keywords': ['Infantry', 'Character', 'Epic Hero', 'Imperium', 'Adeptus Custodes', 'Trajann Valoris']
        },
        'blade champion': {
            'name': 'Blade Champion',
            'role': 'Character',
            'stats': {'M': '6"', 'T': 5, 'SV': '2+', 'INV': '4+', 'W': 6, 'LD': '6+', 'OC': 2},
            'weapons': [
                {'name': 'Vaultswords - strike', 'type': 'Melee', 'range': 'Melee', 'A': '6', 'skill': '2+', 'S': '7', 'AP': '-2', 'D': '2', 'keywords': ['Precision']}
            ],
            'abilities': [
                {'name': 'Martial Inspiration', 'description': 'While this model is leading a unit, you can re-roll Advance and Charge rolls made for that unit.'}
            ],
            'keywords': ['Infantry', 'Character', 'Imperium', 'Blade Champion']
        },
        'custodian guard': {
            'name': 'Custodian Guard',
            'role': 'Battleline',
            'model_count': 4,
            'stats': {'M': '6"', 'T': 6, 'SV': '2+', 'INV': '4+', 'W': 3, 'LD': '6+', 'OC': 2},
            'weapons': [
                {'name': 'Guardian Spear - shooting', 'type': 'Ranged', 'range': '24"', 'A': '2', 'skill': '2+', 'S': '4', 'AP': '-1', 'D': '2', 'keywords': ['Assault']},
                {'name': 'Guardian Spear - melee', 'type': 'Melee', 'range': 'Melee', 'A': '5', 'skill': '2+', 'S': '7', 'AP': '-2', 'D': '2', 'keywords': []}
            ],
            'abilities': [
                {'name': 'Stand Vigil', 'description': 'Each time a model in this unit makes an attack, re-roll a Wound roll of 1. If controlling an objective, re-roll the Wound roll instead.'}
            ],
            'keywords': ['Infantry', 'Battleline', 'Imperium', 'Adeptus Custodes', 'Custodian Guard']
        },
        'lord inquisitor kyria draxus': {
            'name': 'Lord Inquisitor Kyria Draxus',
            'role': 'Character',
            'stats': {'M': '6"', 'T': 3, 'SV': '3+', 'INV': '5+', 'W': 4, 'LD': '6+', 'OC': 1},
            'weapons': [
                {'name': 'Dirgesinger', 'type': 'Ranged', 'range': '18"', 'A': '4', 'skill': '2+', 'S': '4', 'AP': '-1', 'D': '2', 'keywords': ['Devastating Wounds', 'Indirect Fire', 'Anti-Infantry 4+']}
            ],
            'abilities': [
                {'name': 'Psychic Veil', 'description': 'While this model is leading a unit, that unit cannot be targeted by ranged attacks unless the attacker is within 18".'}
            ],
            'keywords': ['Infantry', 'Character', 'Epic Hero', 'Inquisition', 'Kyria Draxus']
        },
        'kaldor draigo': {
            'name': 'Kaldor Draigo',
            'role': 'Character',
            'is_warlord': True,
            'stats': {'M': '5"', 'T': 5, 'SV': '2+', 'INV': '4+', 'W': 6, 'LD': '6+', 'OC': 2},
            'weapons': [
                {'name': 'Scourging', 'type': 'Ranged', 'range': '18"', 'A': 'D6', 'skill': '2+', 'S': '6', 'AP': '-1', 'D': '2', 'keywords': ['Psychic', 'Blast']},
                {'name': 'The Titansword', 'type': 'Melee', 'range': 'Melee', 'A': '6', 'skill': '2+', 'S': '8', 'AP': '-3', 'D': '3', 'keywords': ['Psychic']}
            ],
            'abilities': [
                {'name': 'One With the Warp', 'description': 'Once per battle, when this model\'s unit arrives from Deep Strike, add 3 to charge rolls.'}
            ],
            'keywords': ['Infantry', 'Character', 'Epic Hero', 'Terminator', 'Grey Knights', 'Kaldor Draigo']
        },
        'grand master in nemesis dreadknight': {
            'name': 'Grand Master in Nemesis Dreadknight',
            'role': 'Vehicles & Monsters',
            'stats': {'M': '8"', 'T': 8, 'SV': '2+', 'INV': '4+', 'W': 13, 'LD': '6+', 'OC': 4},
            'weapons': [
                {'name': 'Heavy psycannon', 'type': 'Ranged', 'range': '24"', 'A': '6', 'skill': '2+', 'S': '10', 'AP': '-1', 'D': '3', 'keywords': ['Psychic']},
                {'name': 'Nemesis daemon greathammer - strike', 'type': 'Melee', 'range': 'Melee', 'A': '5', 'skill': '3+', 'S': '14', 'AP': '-3', 'D': 'D6+1', 'keywords': ['Psychic']}
            ],
            'abilities': [
                {'name': 'Surge of Wrath', 'description': 'Each time this model makes an attack targeting a Monster or Vehicle, re-roll the Hit roll, Wound roll and Damage roll.'}
            ],
            'keywords': ['Vehicle', 'Walker', 'Character', 'Grey Knights', 'Nemesis Dreadknight']
        },
        'strike squad': {
            'name': 'Strike Squad',
            'role': 'Battleline',
            'model_count': 5,
            'stats': {'M': '6"', 'T': 4, 'SV': '2+', 'INV': '-', 'W': 2, 'LD': '6+', 'OC': 2},
            'weapons': [
                {'name': 'Storm bolter', 'type': 'Ranged', 'range': '24"', 'A': '2', 'skill': '3+', 'S': '4', 'AP': '0', 'D': '1', 'keywords': ['Rapid Fire 2']},
                {'name': 'Nemesis force weapon', 'type': 'Melee', 'range': 'Melee', 'A': '3', 'skill': '3+', 'S': '6', 'AP': '-2', 'D': '2', 'keywords': ['Psychic']}
            ],
            'abilities': [
                {'name': 'Sanctifying Ritual', 'description': 'If you control an objective marker at the end of your Command phase and this unit is within range, it remains under your control.'}
            ],
            'keywords': ['Infantry', 'Battleline', 'Psyker', 'Grey Knights', 'Strike Squad']
        },
        'nemesis dreadknight': {
            'name': 'Nemesis Dreadknight',
            'role': 'Vehicles & Monsters',
            'stats': {'M': '8"', 'T': 8, 'SV': '2+', 'INV': '4+', 'W': 13, 'LD': '6+', 'OC': 4},
            'weapons': [
                {'name': 'Heavy incinator', 'type': 'Ranged', 'range': '12"', 'A': '2D6', 'skill': 'N/A', 'S': '6', 'AP': '-1', 'D': '1', 'keywords': ['Ignores Cover', 'Torrent']},
                {'name': 'Heavy psycannon', 'type': 'Ranged', 'range': '24"', 'A': '6', 'skill': '3+', 'S': '10', 'AP': '-1', 'D': '3', 'keywords': ['Psychic']}
            ],
            'abilities': [
                {'name': 'Empyric Severance', 'description': 'This model is eligible to shoot and declare a charge in a turn in which it Advanced or Fell Back.'}
            ],
            'keywords': ['Vehicle', 'Walker', 'Psyker', 'Grey Knights', 'Nemesis Dreadknight']
        },
        'grey knights terminator squad': {
            'name': 'Grey Knights Terminator Squad',
            'role': 'Infantry & Elites',
            'model_count': 5,
            'stats': {'M': '5"', 'T': 5, 'SV': '2+', 'INV': '4+', 'W': 3, 'LD': '6+', 'OC': 2},
            'weapons': [
                {'name': 'Storm bolter', 'type': 'Ranged', 'range': '24"', 'A': '2', 'skill': '3+', 'S': '4', 'AP': '0', 'D': '1', 'keywords': ['Rapid Fire 2']},
                {'name': 'Nemesis force weapon', 'type': 'Melee', 'range': 'Melee', 'A': '4', 'skill': '3+', 'S': '6', 'AP': '-2', 'D': '2', 'keywords': ['Psychic']}
            ],
            'abilities': [
                {'name': 'Hammerhand', 'description': 'Each time this unit makes a Charge move, until the end of the turn, melee weapons equipped by models in this unit have [LETHAL HITS].'}
            ],
            'keywords': ['Infantry', 'Terminator', 'Psyker', 'Grey Knights', 'Terminator Squad']
        }
    }
    
    # 2. Assign Faction, Army Rules, Detachment Rules, and Stratagems
    if any(k in text_lower for k in ['chaos space marines', 'chaos', 'csm', 'heretic astartes']):
        parsed['faction'] = 'Chaos Space Marines'
        parsed['detachment'] = parsed.get('detachment') if (parsed.get('detachment') and parsed.get('detachment') != 'Core Detachment') else 'Raiders'
        parsed['army_rules'] = [
            {
                'name': 'Dark Pacts',
                'description': 'If your Army Faction is Chaos Space Marines, each time a unit from your army with this ability is selected to shoot or fight, it can make a Dark Pact. Choose either [LETHAL HITS] or [SUSTAINED HITS 1] for its weapons until the end of the phase. After resolving attacks, that unit must take a Leadership test. If failed, it suffers D3 mortal wounds.'
            }
        ]
        parsed['detachment_rules'] = [
            {
                'name': 'Raiders of the Warp',
                'description': 'Each time a unit from your army makes an Advance or Charge roll while in your deployment zone or targeting an enemy unit within range of an objective marker, re-roll that roll.'
            }
        ]
        parsed['stratagems'] = [
            {
                'name': 'Profane Zeal',
                'cp_cost': '1 CP',
                'type': 'Battle Tactic',
                'phase': 'Shooting or Fight phase',
                'turn': 'Either',
                'description': 'Target one Chaos Space Marines unit from your army. Until the end of the phase, each time a model in your unit makes an attack, re-roll a Hit roll of 1 and re-roll a Wound roll of 1.'
            },
            {
                'name': 'Dark Obscuration',
                'cp_cost': '1 CP',
                'type': 'Strategic Ploy',
                'phase': 'Opponent\'s Shooting phase',
                'turn': 'Opponent\'s',
                'description': 'Target one Chaos Space Marines unit from your army that was selected as the target of ranged attacks. Until the end of the phase, models in that unit have Stealth. If under Dark Pact, can only be targeted within 12".'
            },
            {
                'name': 'Eternal Hate',
                'cp_cost': '2 CP',
                'type': 'Epic Deed',
                'phase': 'Fight phase',
                'turn': 'Either',
                'description': 'Target one Chaos Space Marines model from your army that was just destroyed. That model can fight before being removed from play.'
            }
        ]
    elif any(k in text_lower for k in ['custodes', 'adeptus custodes', 'shield host']):
        parsed['faction'] = 'Adeptus Custodes'
        parsed['detachment'] = parsed.get('detachment') if (parsed.get('detachment') and parsed.get('detachment') != 'Core Detachment') else 'Shield Host'
        parsed['army_rules'] = [
            {
                'name': 'Martial Ka\'tah',
                'description': 'At the start of the Fight phase, select one Ka\'tah Stance to be active for your army: Kaptaris Stance (Enemy models suffer -1 to hit) or Dacatarai Stance (Melee weapons gain [SUSTAINED HITS 1]).'
            }
        ]
        parsed['detachment_rules'] = [
            {
                'name': 'Aegis of the Emperor',
                'description': 'Models in this detachment have a 4+ invulnerable save and a 4+ Feel No Pain against mortal wounds.'
            }
        ]
        parsed['stratagems'] = [
            {
                'name': 'Arcane Genetic Crafting',
                'cp_cost': '1 CP',
                'type': 'Battle Tactic',
                'phase': 'Shooting or Fight phase',
                'turn': 'Either',
                'description': 'Each time an attack is allocated to a model in your unit, subtract 1 from the Damage characteristic of that attack.'
            },
            {
                'name': 'Slayer of Champions',
                'cp_cost': '1 CP',
                'type': 'Battle Tactic',
                'phase': 'Fight phase',
                'turn': 'Either',
                'description': 'Each time a model in your unit makes a melee attack targeting a Monster or Vehicle, add 1 to the Wound roll.'
            },
            {
                'name': 'Vigilance Unending',
                'cp_cost': '1 CP',
                'type': 'Strategic Ploy',
                'phase': 'Command phase',
                'turn': 'Your',
                'description': 'Select one objective marker you control. It remains under your control even if you have no models within range of it.'
            }
        ]
    elif any(k in text_lower for k in ['grey knights', 'kaldor draigo', 'teleport strike force']):
        parsed['faction'] = 'Grey Knights'
        parsed['detachment'] = parsed.get('detachment') if (parsed.get('detachment') and parsed.get('detachment') != 'Core Detachment') else 'Teleport Strike Force'
        parsed['army_rules'] = [
            {
                'name': 'Teleport Assault',
                'description': 'At the end of your opponent\'s turn, select up to 3 Grey Knights units from your army into Strategic Reserves. In your next Reinforcements step, set them up anywhere more than 9" horizontally away from all enemies.'
            }
        ]
        parsed['detachment_rules'] = [
            {
                'name': 'Teleport Shunt',
                'description': 'Each time a unit from your army Advances, do not roll. Instead, that unit gains Fly and has a Move characteristic of 12".'
            }
        ]
        parsed['stratagems'] = [
            {
                'name': 'Mist of Deimos',
                'cp_cost': '1 CP',
                'type': 'Strategic Ploy',
                'phase': 'Opponent\'s Movement phase',
                'turn': 'Opponent\'s',
                'description': 'When an enemy ends a move within 9" of your unit, your unit can make a Normal move of up to 6" or be placed into Strategic Reserves.'
            },
            {
                'name': 'Radiant Strike',
                'cp_cost': '1 CP',
                'type': 'Battle Tactic',
                'phase': 'Fight phase',
                'turn': 'Either',
                'description': 'Melee weapons equipped by models in your unit gain [DEVASTATING WOUNDS] until the end of the phase.'
            },
            {
                'name': 'Haloed in Soulfire',
                'cp_cost': '1 CP',
                'type': 'Strategic Ploy',
                'phase': 'Your Movement phase',
                'turn': 'Your',
                'description': 'When a unit arrives from Deep Strike, enemy models cannot target that unit with ranged attacks unless within 12".'
            }
        ]
    else:
        # Fallback rules
        if not parsed.get('army_rules'):
            parsed['army_rules'] = [{'name': 'Army Faction Doctrine', 'description': 'Standard faction rules and special combat abilities apply to all eligible datasheets.'}]
        if not parsed.get('detachment_rules'):
            parsed['detachment_rules'] = [{'name': 'Detachment Focus', 'description': 'Units in this detachment gain specialized tactical benefits and operational mobility.'}]
        if not parsed.get('stratagems'):
            parsed['stratagems'] = [
                {'name': 'Command Re-roll', 'cp_cost': '1 CP', 'type': 'Battle Tactic', 'phase': 'Any phase', 'turn': 'Either', 'description': 'Re-roll one Hit roll, Wound roll, Damage roll, saving throw, Advance roll or Charge roll.'},
                {'name': 'Counter-offensive', 'cp_cost': '2 CP', 'type': 'Strategic Ploy', 'phase': 'Fight phase', 'turn': 'Either', 'description': 'Select one eligible unit from your army to fight next.'},
                {'name': 'Insane Bravery', 'cp_cost': '1 CP', 'type': 'Epic Deed', 'phase': 'Command phase', 'turn': 'Either', 'description': 'Unit automatically passes Battle-shock test.'}
            ]

    # 3. Enrich Units
    units = parsed.get('units') or []
    for u in units:
        raw_u_name = u.get('name') or ''
        clean = re.sub(r'^\d+x?\s+', '', raw_u_name).strip()
        clean_lower = clean.lower()
        
        # Check matching in lookup
        matched_ds = None
        for k, v in waha_datasheets.items():
            if k in clean_lower or clean_lower in k:
                matched_ds = v
                break
        
        if matched_ds:
            u['name'] = matched_ds['name']
            u['role'] = matched_ds['role']
            u['stats'] = matched_ds['stats']
            u['weapons'] = matched_ds['weapons']
            u['abilities'] = matched_ds['abilities']
            u['keywords'] = matched_ds['keywords']
            if matched_ds.get('is_warlord'):
                u['is_warlord'] = True
            if matched_ds.get('model_count'):
                u['model_count'] = matched_ds['model_count']
        else:
            # Fallback generator
            is_char = any(w in clean_lower for w in ['lord', 'captain', 'leader', 'character', 'apostle', 'champion', 'warlord', 'hero'])
            is_veh = any(w in clean_lower for w in ['tank', 'rhino', 'dreadnought', 'predator', 'fiend', 'vehicle', 'monster', 'walker', 'raider'])
            is_bl = any(w in clean_lower for w in ['cultist', 'guard', 'legionary', 'squad', 'intercessor', 'battleline', 'strike'])
            
            if is_char:
                u['role'] = 'Character'
                u['stats'] = {'M': '6"', 'T': 4, 'SV': '2+', 'INV': '4+', 'W': 5, 'LD': '6+', 'OC': 1}
                u['weapons'] = [
                    {'name': 'Master-crafted Power Weapon', 'type': 'Melee', 'range': 'Melee', 'A': '5', 'skill': '2+', 'S': '5', 'AP': '-2', 'D': '2', 'keywords': []},
                    {'name': 'Combi-weapon', 'type': 'Ranged', 'range': '24"', 'A': '1', 'skill': '3+', 'S': '4', 'AP': '0', 'D': '1', 'keywords': ['Anti-Infantry 4+', 'Devastating Wounds']}
                ]
                u['abilities'] = [{'name': 'Inspiring Leader', 'description': 'While this model is leading a unit, add 1 to the Leadership characteristic of models in that unit.'}]
                u['keywords'] = ['Infantry', 'Character']
            elif is_veh:
                u['role'] = 'Vehicles & Monsters'
                u['stats'] = {'M': '10"', 'T': 10, 'SV': '3+', 'INV': '5+', 'W': 11, 'LD': '6+', 'OC': 3}
                u['weapons'] = [
                    {'name': 'Heavy Battle Cannon', 'type': 'Ranged', 'range': '48"', 'A': 'D6+3', 'skill': '3+', 'S': '10', 'AP': '-2', 'D': '3', 'keywords': ['Blast']},
                    {'name': 'Armoured Tracks', 'type': 'Melee', 'range': 'Melee', 'A': '3', 'skill': '4+', 'S': '6', 'AP': '0', 'D': '1', 'keywords': []}
                ]
                u['abilities'] = [{'name': 'Armoured Hull', 'description': 'Each time an attack is allocated to this model, an unmodified saving throw of 1 always fails.'}]
                u['keywords'] = ['Vehicle']
            elif is_bl:
                u['role'] = 'Battleline'
                u['stats'] = {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '-', 'W': 2, 'LD': '6+', 'OC': 2}
                u['weapons'] = [
                    {'name': 'Standard Bolt Rifle', 'type': 'Ranged', 'range': '24"', 'A': '2', 'skill': '3+', 'S': '4', 'AP': '-1', 'D': '1', 'keywords': ['Assault', 'Heavy']},
                    {'name': 'Close Combat Weapon', 'type': 'Melee', 'range': 'Melee', 'A': '3', 'skill': '3+', 'S': '4', 'AP': '0', 'D': '1', 'keywords': []}
                ]
                u['abilities'] = [{'name': 'Objective Secured', 'description': 'This unit has an Objective Control characteristic of 2.'}]
                u['keywords'] = ['Infantry', 'Battleline']
            else:
                u['role'] = 'Infantry & Elites'
                u['stats'] = {'M': '6"', 'T': 4, 'SV': '3+', 'INV': '-', 'W': 2, 'LD': '6+', 'OC': 1}
                u['weapons'] = [
                    {'name': 'Tactical Firearm', 'type': 'Ranged', 'range': '24"', 'A': '2', 'skill': '3+', 'S': '4', 'AP': '-1', 'D': '1', 'keywords': []},
                    {'name': 'Close Combat Weapon', 'type': 'Melee', 'range': 'Melee', 'A': '3', 'skill': '3+', 'S': '4', 'AP': '0', 'D': '1', 'keywords': []}
                ]
                u['abilities'] = [{'name': 'Combat Squads', 'description': 'Standard tactical doctrine applies.'}]
                u['keywords'] = ['Infantry']

    return parsed

class OmniTacticaDevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_HEAD(self):
        self._handle_request(is_head=True)

    def do_GET(self):
        self._handle_request(is_head=False)

    def do_DELETE(self):
        clean_path = self.path.split("?")[0].strip("/")
        if (clean_path.startswith("api/events/") or clean_path.startswith("api/eventstudio/event/")) and "/livestreams/" in clean_path:
            parts = clean_path.split("/")
            ev_id = parts[2] if clean_path.startswith("api/events/") else parts[3]
            stream_id = parts[4] if clean_path.startswith("api/events/") else parts[5]
            if ev_id in EVENT_LIVESTREAMS_DB:
                EVENT_LIVESTREAMS_DB[ev_id] = [s for s in EVENT_LIVESTREAMS_DB[ev_id] if s.get("id") != stream_id]
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "event_id": ev_id, "deleted_id": stream_id, "livestreams": EVENT_LIVESTREAMS_DB.get(ev_id, [])}).encode("utf-8"))
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        clean_path = self.path.split("?")[0].strip("/")
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else b"{}"

        if clean_path == "api/league/create":
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            try:
                p_data = json.loads(body.decode("utf-8")) if body else {}
                result = l_svc.create_league(p_data)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps(result).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        if clean_path.startswith("api/league/") and clean_path.endswith("/match/report"):
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            parts = clean_path.split("/")
            l_id = parts[2]
            try:
                p_data = json.loads(body.decode("utf-8")) if body else {}
                result = l_svc.report_match(
                    league_id=l_id,
                    pod_number=int(p_data.get("pod_number", 1)),
                    round_number=int(p_data.get("round_number", 1)),
                    p1_name=p_data.get("p1_name", ""),
                    p2_name=p_data.get("p2_name", ""),
                    p1_score=int(p_data.get("p1_score", 0)),
                    p2_score=int(p_data.get("p2_score", 0)),
                    scorecard_id=p_data.get("scorecard_id"),
                    is_ringer=bool(p_data.get("is_ringer", False))
                )
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps(result).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        if clean_path.startswith("api/league/") and clean_path.endswith("/season/rollover"):
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            parts = clean_path.split("/")
            l_id = parts[2]
            try:
                p_data = json.loads(body.decode("utf-8")) if body else {}
                result = l_svc.rollover_season(l_id, options=p_data)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps(result).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        if clean_path.startswith("api/league/") and clean_path.endswith("/register"):
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            parts = clean_path.split("/")
            l_id = parts[2]
            try:
                p_data = json.loads(body.decode("utf-8")) if body else {}
                result = l_svc.register_player_for_league(l_id, player_data=p_data)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps(result).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        if clean_path.startswith("api/league/") and clean_path.endswith("/registration-window"):
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            parts = clean_path.split("/")
            l_id = parts[2]
            try:
                p_data = json.loads(body.decode("utf-8")) if body else {}
                result = l_svc.set_registration_window(l_id, payload=p_data)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps(result).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        if clean_path == "api/armylists/parse":
            try:
                p_load = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                p_load = {}
            raw_text = p_load.get("text") or p_load.get("raw_text") or ""
            source_hint = p_load.get("format")
            from army_list_parser import get_parser
            parser = get_parser()
            parsed = parser.parse(raw_text, source_hint=source_hint)
            parsed = enrich_roster_with_wahapedia_mock(parsed, raw_text)

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "army_list": parsed}).encode("utf-8"))
            return

        if (clean_path.startswith("api/events/") or clean_path.startswith("api/eventstudio/event/")) and clean_path.endswith("/livestreams"):
            parts = clean_path.split("/")
            ev_id = parts[2] if clean_path.startswith("api/events/") else parts[3]
            try:
                p_data = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                p_data = {}
            import re
            s_url = str(p_data.get("stream_url") or p_data.get("streamUrl") or "").strip()
            plat = str(p_data.get("platform") or "").lower()
            if "twitch.tv" in s_url or plat == "twitch":
                chan = s_url.rstrip("/").split("/")[-1].split("?")[0]
                embed = f"https://player.twitch.tv/?channel={chan}&parent=localhost&parent=127.0.0.1&parent=omnitactica.com&muted=true"
                plat = "twitch"
            else:
                plat = "youtube"
                yt_m = re.search(r'(?:v=|\/live\/|youtu\.be\/|\/embed\/)([a-zA-Z0-9_-]{11})', s_url)
                v_id = yt_m.group(1) if yt_m else "jfKfPfyJRdk"
                embed = f"https://www.youtube-nocookie.com/embed/{v_id}?autoplay=1&mute=1"
            
            s_id = p_data.get("id") or f"stream_{secrets.token_hex(4)}"
            raw_t = p_data.get("table_number")
            if raw_t is None:
                raw_t = p_data.get("tableNumber")
            t_num = int(raw_t) if raw_t is not None else 1
            default_t_title = "Main Desk Live Broadcast" if t_num == 0 else f"Table {t_num} Live Broadcast"
            record = {
                "id": s_id,
                "event_id": ev_id,
                "table_number": t_num,
                "channel": p_data.get("channel") or "Feature Stream",
                "platform": plat,
                "title": p_data.get("title") or default_t_title,
                "stream_url": s_url or "https://www.youtube.com/watch?v=live",
                "embed_url": embed,
                "is_live": True,
                "viewers": int(p_data.get("viewers") or 250)
            }
            if ev_id not in EVENT_LIVESTREAMS_DB:
                EVENT_LIVESTREAMS_DB[ev_id] = []
            EVENT_LIVESTREAMS_DB[ev_id] = [s for s in EVENT_LIVESTREAMS_DB[ev_id] if s.get("id") != s_id and int(s.get("table_number", 0)) != t_num]
            EVENT_LIVESTREAMS_DB[ev_id].append(record)
            EVENT_LIVESTREAMS_DB[ev_id].sort(key=lambda s: int(s.get("table_number", 1)))
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "event_id": ev_id, "livestream": record, "livestreams": EVENT_LIVESTREAMS_DB[ev_id]}).encode("utf-8"))
            return

        if clean_path.startswith("api/admin/users/") and clean_path.endswith("/role"):
            parts = clean_path.split("/")
            u_id = parts[3]
            body_data = json.loads(body.decode("utf-8")) if body else {}
            new_role = body_data.get("role", "player")
            for u in DEV_USERS_LIST:
                if u.get("id") == u_id:
                    u["role"] = new_role
                    u["is_admin"] = (new_role == "admin")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "user_id": u_id, "role": new_role}).encode("utf-8"))
            return

        if clean_path in ("api/auth/login", "api/auth/register"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Set-Cookie", "session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax; HttpOnly")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "token": "dev-auth-token-123", **DEV_USER}).encode("utf-8"))
            return

        if clean_path in ("api/user/pin_badges", "api/user/pin_badges/"):
            try:
                p_load = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                p_load = {}
            if "pinned_badges" in p_load:
                DEV_USER["pinned_badges"] = p_load.get("pinned_badges", [])[:3]
            if "badges_celebrated" in p_load:
                DEV_USER["badges_celebrated"] = bool(p_load.get("badges_celebrated"))
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "pinned_badges": DEV_USER.get("pinned_badges", []), "badges_celebrated": DEV_USER.get("badges_celebrated", False)}).encode("utf-8"))
            return

        if clean_path in ("api/user/settings", "api/user/settings/"):
            try:
                p_load = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                p_load = {}
            if "display_name" in p_load and p_load["display_name"]:
                DEV_USER["display_name"] = p_load["display_name"]
            if "pinned_badges" in p_load and isinstance(p_load["pinned_badges"], list):
                DEV_USER["pinned_badges"] = p_load["pinned_badges"][:3]
            if "badges_celebrated" in p_load:
                DEV_USER["badges_celebrated"] = bool(p_load["badges_celebrated"])
            if "acknowledged_badge_ids" in p_load and isinstance(p_load["acknowledged_badge_ids"], list):
                curr_ack = set(DEV_USER.get("acknowledged_badge_ids") or [])
                curr_ack.update(p_load["acknowledged_badge_ids"])
                DEV_USER["acknowledged_badge_ids"] = list(curr_ack)
                DEV_USER["badges_celebrated"] = True
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "user": DEV_USER}).encode("utf-8"))
            return

        if clean_path in ("api/user/acknowledge_badges", "api/user/acknowledge_badges/"):
            try:
                p_load = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                p_load = {}
            new_ids = p_load.get("badge_ids") or p_load.get("acknowledged_badge_ids") or []
            curr_ack = set(DEV_USER.get("acknowledged_badge_ids") or [])
            curr_ack.update(new_ids)
            DEV_USER["acknowledged_badge_ids"] = list(curr_ack)
            DEV_USER["badges_celebrated"] = True
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "acknowledged_badge_ids": DEV_USER["acknowledged_badge_ids"]}).encode("utf-8"))
            return

        if clean_path.startswith("api/armory/"):
            try:
                payload = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                payload = {}

            if clean_path == "api/armory/purchase":
                import armory_catalog
                item_id = (payload.get("item_id") or "").strip()
                item = armory_catalog.get_item_by_id(item_id)
                if not item:
                    self.send_response(404)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps({"detail": f"Item {item_id} not found in catalog"}).encode("utf-8"))
                    return

                glory_state = _get_dev_user_glory_and_stats()
                v = glory_state["vault"]
                inv = v.setdefault("inventory", {})
                cost = item.get("cost_glory", 0)
                total_earned = glory_state["total_earned"]
                spent = glory_state["glory_spent"]
                spendable = glory_state["spendable_glory"]

                if spendable < cost:
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps({"detail": f"Insufficient Glory Honor. Cost {cost}, available {spendable}"}).encode("utf-8"))
                    return

                # Check prerequisite locks (Peak Elo & Career Crest Tier)
                prereq = item.get("prerequisite")
                if prereq:
                    req_tier = prereq.get("career_crest_tier")
                    if req_tier is not None and glory_state["crest_tier"] < req_tier:
                        self.send_response(400)
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                        self.end_headers()
                        self.wfile.write(json.dumps({"detail": prereq.get("label", f"Requires Career Crest Tier {req_tier}+")}).encode("utf-8"))
                        return
                    req_peak = prereq.get("peak_elo")
                    if req_peak is not None and glory_state["peak_elo"] < req_peak:
                        self.send_response(400)
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                        self.end_headers()
                        self.wfile.write(json.dumps({"detail": prereq.get("label", f"Requires All-Time Peak Elo {req_peak:.0f}+")}).encode("utf-8"))
                        return

                if not item.get("is_consumable") and item_id in inv:
                    self.send_response(409)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps({"detail": "You already own this permanent item."}).encode("utf-8"))
                    return

                now_iso = datetime.now(timezone.utc).isoformat()
                if item.get("is_consumable"):
                    existing = inv.get(item_id, {}).get("quantity", 0)
                    inv[item_id] = {
                        "acquired_at": now_iso,
                        "quantity": existing + item.get("bundle_count", 1),
                        "item_name": item["name"],
                        "wing": item["wing"]
                    }
                else:
                    inv[item_id] = {
                        "acquired_at": now_iso,
                        "item_name": item["name"],
                        "wing": item["wing"],
                        "slot": item.get("slot")
                    }

                DEV_USER["glory_spent"] = spent + cost
                new_spendable = max(0, total_earned - DEV_USER["glory_spent"])

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"Successfully requisitioned {item['name']} for {cost} Glory!",
                    "item": item,
                    "vault": v,
                    "glory": {
                        "total_earned": total_earned,
                        "glory_spent": DEV_USER["glory_spent"],
                        "spendable_glory": new_spendable,
                        "crest_tier": glory_state["crest_tier"],
                        "peak_elo": glory_state["peak_elo"]
                    }
                }).encode("utf-8"))
                return

            if clean_path == "api/armory/equip":
                slot = payload.get("slot")
                item_id = payload.get("item_id")
                sys_key = (payload.get("game_system") or "40k").lower().strip()
                if sys_key not in ("40k", "aos"):
                    sys_key = "40k"

                glory_state = _get_dev_user_glory_and_stats()
                v = glory_state["vault"]
                inv = v.setdefault("inventory", {})
                eq = v.setdefault("equipped", {})

                import armory_catalog
                canon_id = getattr(armory_catalog, "ARMORY_ALIASES", {}).get(item_id, item_id)
                if item_id not in inv and canon_id not in inv and not any(getattr(armory_catalog, "ARMORY_ALIASES", {}).get(k) == canon_id for k in inv.keys()):
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps({"detail": f"You do not own item '{item_id}'"}).encode("utf-8"))
                    return

                sys_eq = eq.setdefault(sys_key, {"active_dice": None, "active_card_frame": None, "active_card_finish": None, "active_title": None, "active_avatar": None})
                sys_eq[slot] = item_id
                eq[slot] = item_id
                DEV_USER["armory_vault"] = v

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"Equipped {item_id} to {slot} ({sys_key.upper()})",
                    "slot": slot,
                    "item_id": item_id,
                    "game_system": sys_key,
                    "equipped": eq
                }).encode("utf-8"))
                return

            if clean_path == "api/armory/unequip":
                slot = payload.get("slot")
                sys_key = (payload.get("game_system") or "40k").lower().strip()
                if sys_key not in ("40k", "aos"):
                    sys_key = "40k"

                glory_state = _get_dev_user_glory_and_stats()
                v = glory_state["vault"]
                eq = v.setdefault("equipped", {})
                if isinstance(eq.get(sys_key), dict):
                    eq[sys_key][slot] = None
                eq[slot] = None
                DEV_USER["armory_vault"] = v

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"Unequipped {slot} ({sys_key.upper()})",
                    "slot": slot,
                    "game_system": sys_key,
                    "equipped": eq
                }).encode("utf-8"))
                return

            if clean_path == "api/armory/set_glory":
                DEV_USER["total_glory"] = int(payload.get("total_glory", 50000))
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "total_glory": DEV_USER["total_glory"]}).encode("utf-8"))
                return

            if clean_path == "api/armory/poke":
                try:
                    p_load = json.loads(body.decode("utf-8")) if body else {}
                except Exception:
                    p_load = {}
                poke_id = p_load.get("poke_id", "poke_inquisition_smite")
                target_name = p_load.get("target_name", "Opposing Commander")
                target_pid = p_load.get("target_player_id", "p_rival")

                import armory_catalog
                item = armory_catalog.get_item_by_id(poke_id) or {
                    "name": "Battle Poke",
                    "icon": "👉",
                    "payload": {"toast_message": "Poked rival commander!"}
                }

                glory_state = _get_dev_user_glory_and_stats()
                v = glory_state["vault"]
                inv = v.setdefault("inventory", {})
                entry = inv.setdefault(poke_id, {"quantity": 5, "item_name": item["name"], "wing": "pokes"})
                qty = max(0, entry.get("quantity", 5) - 1)
                entry["quantity"] = qty

                payload = item.get("payload") or {}
                sender_name = DEV_USER.get("display_name") or "Innes Wilson"
                now_dt = datetime.now(timezone.utc)
                duration_hours = int(payload.get("hex_duration_hours", 24))
                expires_dt = now_dt + timedelta(hours=duration_hours)
                now_iso = now_dt.isoformat()
                expires_iso = expires_dt.isoformat()
                toast_msg = payload.get("toast_message", f"{item.get('icon', '👉')} Poked {target_name}!").replace("{target}", target_name)
                banner_desc = payload.get("hex_banner_desc", f"Targeted by rival commander {sender_name}.").replace("{sender}", sender_name)

                poke_event = {
                    "id": f"poke_evt_{secrets.token_hex(5)}",
                    "poke_id": poke_id,
                    "poke_name": item["name"],
                    "icon": item.get("icon", "👉"),
                    "sender_id": DEV_USER.get("id", "user_innes"),
                    "sender_name": sender_name,
                    "target_player_id": target_pid,
                    "target_name": target_name,
                    "created_at": now_iso,
                    "expires_at": expires_iso,
                    "duration_hours": duration_hours,
                    "seen": False,
                    "sign_in_effect": payload.get("sign_in_effect", "spark"),
                    "hex_badge_title": payload.get("hex_badge_title", "Rival Hex"),
                    "hex_banner_desc": banner_desc,
                    "toast_message": toast_msg,
                    "css_glow": payload.get("css_glow", "#38bdf8")
                }

                dispatched = v.setdefault("dispatched_pokes", [])
                dispatched.insert(0, poke_event)
                v["dispatched_pokes"] = dispatched[:30]

                # In dev mode, also record into received_pokes so user can test and experience the sign-in effect
                received = v.setdefault("received_pokes", [])
                received.insert(0, poke_event)
                v["received_pokes"] = [p for p in received[:30] if p.get("expires_at", "") > (now_dt - timedelta(hours=48)).isoformat()]

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "message": f"Successfully poked {target_name} with {item['name']}!",
                    "poke_id": poke_id,
                    "poke_name": item["name"],
                    "sender_name": sender_name,
                    "target_player_id": target_pid,
                    "target_name": target_name,
                    "charges_remaining": qty,
                    "toast_message": toast_msg,
                    "css_glow": payload.get("css_glow", "#38bdf8"),
                    "icon": item.get("icon", "👉"),
                    "duration_hours": duration_hours,
                    "expires_at": expires_iso,
                    "sign_in_effect": payload.get("sign_in_effect", "spark"),
                    "hex_badge_title": payload.get("hex_badge_title", "Rival Hex"),
                    "hex_banner_desc": banner_desc,
                    "poke_event": poke_event
                }).encode("utf-8"))
                return

            if clean_path == "api/armory/poke/acknowledge":
                try:
                    p_load = json.loads(body.decode("utf-8")) if body else {}
                except Exception:
                    p_load = {}
                evt_id = p_load.get("poke_event_id")
                glory_state = _get_dev_user_glory_and_stats()
                v = glory_state["vault"]
                rec = v.get("received_pokes") or []
                for p in rec:
                    if not evt_id or p.get("id") == evt_id:
                        p["seen"] = True
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "acknowledged": True}).encode("utf-8"))
                return

            if clean_path == "api/armory/reset":
                DEV_USER.pop("total_glory", None)
                DEV_USER.pop("glory_40k", None)
                DEV_USER["glory_spent"] = 8500
                DEV_USER.pop("armory_vault", None)
                _get_dev_user_glory_and_stats()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "message": "Armory vault reset successfully"}).encode("utf-8"))
                return

        if clean_path == "api/tracker/room/create":
            try:
                p_load = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                p_load = {}
            is_aos = p_load.get("game_system") == "aos" or str(p_load.get("match_id", "")).startswith("AOS-")
            token = secrets.token_hex(4).upper()
            match_id = p_load.get("match_id") or (f"AOS-{token[:4]}-{token[4:]}" if is_aos else f"WH40K-{token[:4]}-{token[4:]}")
            init_state = {
                "id": match_id,
                "match_id": match_id,
                "game_system": "aos" if is_aos else "40k",
                "round": 1,
                "round_num": 1,
                "game": {
                    "p1Name": p_load.get("p1_name", "Player 1"),
                    "p2Name": p_load.get("p2_name", "Player 2"),
                    "p1Faction": p_load.get("p1_faction"),
                    "p2Faction": p_load.get("p2_faction")
                },
                "p1": {"score": 0},
                "p2": {"score": 0},
                "is_finished": False
            }
            res = {
                "success": True,
                "match_id": match_id,
                "role": "player1",
                "game_system": "aos" if is_aos else "40k",
                "p1_name": p_load.get("p1_name", "Player 1"),
                "p2_name": p_load.get("p2_name", "Player 2"),
                "state": init_state
            }
            ROOMS_DB[match_id] = {
                "match_id": match_id,
                "game_system": "aos" if is_aos else "40k",
                "status": "active",
                "version": 1,
                "online_count": 1,
                "p1_name": p_load.get("p1_name", "Player 1"),
                "p2_name": p_load.get("p2_name", "Player 2"),
                "state": init_state
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

        if "api/eventstudio/" in clean_path:
            try:
                payload = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                payload = {}

            if clean_path.endswith("/reset_dev_state"):
                DEV_STUDIO_EVENT["started"] = False
                DEV_STUDIO_EVENT["current_round"] = 1
                DEV_STUDIO_EVENT["pairings_status"] = "staged"
                DEV_STUDIO_EVENT["pairings"] = {"1": dev_generate_pairings("swiss", 1)}
                DEV_STUDIO_EVENT["is_published"] = False
                DEV_STUDIO_EVENT["published_round"] = 1
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "event": DEV_STUDIO_EVENT,
                    "message": "Dev studio event state reset to staged pre-pairing mode."
                }).encode("utf-8"))
                return

            if clean_path.endswith("/start"):
                DEV_STUDIO_EVENT["started"] = True
                DEV_STUDIO_EVENT["current_round"] = 1
                if "1" not in DEV_STUDIO_EVENT["pairings"]:
                    DEV_STUDIO_EVENT["pairings"]["1"] = dev_generate_pairings("swiss", 1)
                DEV_STUDIO_EVENT["pairings_status"] = "applied"
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "event_id": DEV_STUDIO_EVENT["id"],
                    "started": True,
                    "current_round": 1,
                    "bcp_started": True,
                    "event": DEV_STUDIO_EVENT,
                    "message": "Tournament started successfully! Round 1 pairings generated on Best Coast Pairings."
                }).encode("utf-8"))
                return

            if clean_path.endswith("/pairings/quick_generate"):
                mode = payload.get("mode", "random")
                rnd = int(payload.get("round", 1))
                pairings = dev_generate_pairings(mode, rnd)
                DEV_STUDIO_EVENT["pairings"][str(rnd)] = pairings
                DEV_STUDIO_EVENT["pairings_status"] = "staged"
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "round": rnd,
                    "mode": mode,
                    "pairings": pairings,
                    "pairings_status": "staged",
                    "message": f"Successfully generated {mode.replace('_', ' ').title()} pairings ({len(pairings)} tables staged)."
                }).encode("utf-8"))
                return

            if clean_path.endswith("/pairings/generate"):
                rnd = int(payload.get("round", 1))
                pairings = dev_generate_pairings("swiss", rnd)
                DEV_STUDIO_EVENT["pairings"][str(rnd)] = pairings
                DEV_STUDIO_EVENT["pairings_status"] = "staged"
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "round": rnd,
                    "pairings": pairings,
                    "pairings_status": "staged",
                    "event": DEV_STUDIO_EVENT,
                    "message": f"Generated Round {rnd} Swiss pairings (staged locally)."
                }).encode("utf-8"))
                return

            if clean_path.endswith("/pairings/swap"):
                rnd = int(payload.get("round", 1))
                t1 = int(payload.get("table1", 1))
                t2 = int(payload.get("table2", 2))
                s1 = payload.get("slot1", "p1")
                s2 = payload.get("slot2", "p2")
                pairings = payload.get("pairings") or DEV_STUDIO_EVENT["pairings"].get(str(rnd), [])
                m1 = next((m for m in pairings if m.get("table") == t1), None)
                m2 = next((m for m in pairings if m.get("table") == t2), None)
                if m1 and m2:
                    k1_id, k1_name, k1_fac, k1_team, k1_elo = f"{s1}_id", f"{s1}_name", f"{s1}_faction", f"{s1}_team", f"{s1}_elo"
                    k2_id, k2_name, k2_fac, k2_team, k2_elo = f"{s2}_id", f"{s2}_name", f"{s2}_faction", f"{s2}_team", f"{s2}_elo"
                    for a, b in [(k1_id, k2_id), (k1_name, k2_name), (k1_fac, k2_fac), (k1_team, k2_team), (k1_elo, k2_elo)]:
                        v1, v2 = m1.get(a), m2.get(b)
                        m1[a], m2[b] = v2, v1
                    for m in (m1, m2):
                        e1 = float(m.get("p1_elo") or 1500)
                        e2 = float(m.get("p2_elo") or 1500)
                        p1_prob = round(1.0 / (1.0 + 10.0 ** ((e2 - e1) / 400.0)) * 100.0, 1)
                        m["p1_win_prob"] = p1_prob
                        m["p2_win_prob"] = round(100.0 - p1_prob, 1)
                        t1_name = (m.get("p1_team") or "").strip().lower()
                        t2_name = (m.get("p2_team") or "").strip().lower()
                        m["same_team"] = bool(t1_name and t2_name and t1_name == t2_name)
                DEV_STUDIO_EVENT["pairings"][str(rnd)] = pairings
                DEV_STUDIO_EVENT["pairings_status"] = "staged"
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "round": rnd,
                    "pairings": pairings,
                    "pairings_status": "staged",
                    "message": f"Successfully swapped Table {t1} ({s1.upper()}) and Table {t2} ({s2.upper()})."
                }).encode("utf-8"))
                return

            if clean_path.endswith("/pairings/reorder_tables"):
                rnd = int(payload.get("round", 1))
                pairings = payload.get("pairings", [])
                for idx, p in enumerate(pairings):
                    p["table"] = idx + 1
                    p["tableNumber"] = idx + 1
                DEV_STUDIO_EVENT["pairings"][str(rnd)] = pairings
                DEV_STUDIO_EVENT["pairings_status"] = "staged"
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "round": rnd,
                    "pairings": pairings,
                    "pairings_status": "staged",
                    "message": f"Reordered {len(pairings)} tables successfully."
                }).encode("utf-8"))
                return

            if clean_path.endswith("/pairings/push_to_bcp") or clean_path.endswith("/pairings/apply_bcp"):
                rnd = int(payload.get("round", 1))
                pairings = payload.get("pairings") or DEV_STUDIO_EVENT["pairings"].get(str(rnd), [])
                DEV_STUDIO_EVENT["started"] = True
                DEV_STUDIO_EVENT["pairings"][str(rnd)] = pairings
                DEV_STUDIO_EVENT["pairings_status"] = "applied"
                DEV_STUDIO_EVENT["is_published"] = bool(payload.get("publish_immediately", False))
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "round": rnd,
                    "bcp_started": True,
                    "pairings_count": len(pairings),
                    "published": DEV_STUDIO_EVENT["is_published"],
                    "swaps_performed": 2,
                    "batch_applied": True,
                    "pairings_status": "applied",
                    "event": DEV_STUDIO_EVENT,
                    "message": f"Round {rnd} pairings successfully pushed to Best Coast Pairings ({len(pairings)} tables synced)."
                }).encode("utf-8"))
                return

            if clean_path.endswith("/pairings/publish"):
                DEV_STUDIO_EVENT["is_published"] = True
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "round": int(payload.get("round", 1)),
                    "bcp_published": True,
                    "event": DEV_STUDIO_EVENT,
                    "message": "Round pairings published successfully on Best Coast Pairings."
                }).encode("utf-8"))
                return

            if clean_path.endswith("/pairings/unpublish"):
                DEV_STUDIO_EVENT["is_published"] = False
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "round": int(payload.get("round", 1)),
                    "bcp_unpublished": True,
                    "event": DEV_STUDIO_EVENT,
                    "message": "Round pairings unpublished on Best Coast Pairings."
                }).encode("utf-8"))
                return

        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            payload = {}

        if clean_path == "api/teams/confirm-affiliation":
            import teams_hub_service
            svc = teams_hub_service.get_teams_hub_service()
            p_id = (payload.get("player_id") or DEV_USER["user"].get("player_id") or "p_innes").strip()
            p_name = payload.get("player_name") or DEV_USER["user"].get("display_name") or "Player"
            t_id = (payload.get("team_id") or "").strip()
            try:
                aff = svc.confirm_player_affiliation(p_id, t_id, p_name)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "affiliation": aff}).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"detail": str(e)}).encode("utf-8"))
            return

        if clean_path == "api/teams/leave":
            import teams_hub_service
            svc = teams_hub_service.get_teams_hub_service()
            p_id = (payload.get("player_id") or DEV_USER["user"].get("player_id") or "p_innes").strip()
            aff = svc.set_player_independent(p_id)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "affiliation": aff}).encode("utf-8"))
            return

        if clean_path == "api/teams/create":
            import teams_hub_service
            svc = teams_hub_service.get_teams_hub_service()
            p_id = (payload.get("owner_player_id") or DEV_USER["user"].get("player_id") or "p_innes").strip()
            p_name = payload.get("captain_name") or DEV_USER["user"].get("display_name") or "Captain"
            t_name = (payload.get("name") or "").strip()
            t_tag = (payload.get("short_tag") or "").strip()
            t_sys = (payload.get("game_system") or "40k").strip()
            try:
                new_team = svc.create_team(
                    owner_player_id=p_id,
                    name=t_name,
                    short_tag=t_tag,
                    game_system=t_sys,
                    captain_name=p_name,
                    home_venue=payload.get("home_venue", ""),
                    home_city=payload.get("home_city", "San Diego"),
                    home_state=payload.get("home_state", "CA"),
                    home_country=payload.get("home_country", "USA"),
                    bio=payload.get("bio", ""),
                    discord_url=payload.get("discord_url", "")
                )
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "team": new_team}).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"detail": str(e)}).encode("utf-8"))
            return

        if clean_path.startswith("api/teams/") and clean_path.endswith("/messages"):
            import teams_hub_service
            svc = teams_hub_service.get_teams_hub_service()
            t_id = clean_path.split("/")[2]
            msg_text = (payload.get("message") or "").strip()
            is_pin = bool(payload.get("is_pinned", False))
            p_id = (payload.get("sender_player_id") or DEV_USER["user"].get("player_id") or "p_innes").strip()
            p_name = payload.get("sender_name") or DEV_USER["user"].get("display_name") or "Player"
            role = payload.get("role", "Member")
            try:
                msg_obj = svc.add_team_message(t_id, p_id, p_name, msg_text, role=role, is_pinned=is_pin)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "message": msg_obj}).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"detail": str(e)}).encode("utf-8"))
            return

        if clean_path.startswith("api/teams/") and clean_path.endswith("/squad-events/attend"):
            import teams_hub_service
            svc = teams_hub_service.get_teams_hub_service()
            t_id = clean_path.split("/")[2]
            ev_id = (payload.get("event_id") or "").strip()
            p_name = payload.get("player_name") or DEV_USER["user"].get("display_name") or "Innes Wilson"
            try:
                res_att = svc.toggle_event_attendance(t_id, ev_id, p_name)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, **res_att}).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"detail": str(e)}).encode("utf-8"))
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(b'{"status": "ok"}')

    def _handle_request(self, is_head=False):
        raw_path = self.path.split("?")[0]
        query_str = self.path.split("?")[1] if "?" in self.path else ""
        query_params = urllib.parse.parse_qs(query_str)
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

        if clean_path in ("api/tracker/sessions", "api/tracker/history"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                req_sys = "aos" if "game_system=aos" in query_str else ("40k" if "game_system=40k" in query_str else None)
                active = []
                for rid, rdata in ROOMS_DB.items():
                    if not isinstance(rdata, dict):
                        continue
                    rsys = rdata.get("game_system") or ("aos" if rid.startswith("AOS-") else "40k")
                    if req_sys and rsys != req_sys:
                        continue
                    st = rdata.get("state") or {}
                    game = st.get("game") or {}
                    p1 = st.get("p1") or {}
                    p2 = st.get("p2") or {}
                    active.append({
                        "id": rid,
                        "match_id": rid,
                        "game_system": rsys,
                        "p1_name": game.get("p1Name") or rdata.get("p1_name") or "Player 1",
                        "p2_name": game.get("p2Name") or rdata.get("p2_name") or "Player 2",
                        "p1_score": p1.get("score", 0),
                        "p2_score": p2.get("score", 0),
                        "p1Score": p1.get("score", 0),
                        "p2Score": p2.get("score", 0),
                        "p1_faction": game.get("p1Faction"),
                        "p2_faction": game.get("p2Faction"),
                        "round": st.get("round", 1),
                        "is_finished": bool(rdata.get("is_finished")),
                        "created_at": int(time.time() * 1000),
                        "updated_at": int(time.time() * 1000),
                        "date": "Today",
                        "state": st,
                        "version": rdata.get("version", 1)
                    })
                self.wfile.write(json.dumps({
                    "success": True,
                    "history": active,
                    "active_sessions": active,
                    "completed_history": [],
                    "primary_active": active[0] if active else None,
                    "unfinished_sessions": active[1:] if len(active) > 1 else []
                }).encode("utf-8"))
            return

        if clean_path.endswith("/check"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                check_id = clean_path.replace("api/tracker/room/", "").replace("/check", "").strip("/")
                room_data = ROOMS_DB.get(check_id, {})
                sys_id = room_data.get("game_system") or ("aos" if check_id.startswith("AOS-") else "40k")
                self.wfile.write(json.dumps({
                    "success": True,
                    "exists": True,
                    "match_id": check_id,
                    "game_system": sys_id,
                    "p1_name": room_data.get("p1_name", "Player 1"),
                    "p2_name": room_data.get("p2_name", "Player 2"),
                    "is_full": False,
                    "is_finished": False
                }).encode("utf-8"))
            return

        if clean_path == "api/armory/catalog":
            import armory_catalog
            glory_state = _get_dev_user_glory_and_stats()
            v = glory_state["vault"]
            total_earned = glory_state["total_earned"]
            spent = glory_state["glory_spent"]
            spendable = glory_state["spendable_glory"]
            crest_tier = glory_state["crest_tier"]
            user_peak = glory_state["peak_elo"]

            parsed_url = urllib.parse.urlparse(self.path)
            q_params = urllib.parse.parse_qs(parsed_url.query)
            req_sys = q_params.get("game_system", ["40k"])[0]

            import badges
            dev_champs = badges.extract_tournament_championships(DEV_USER.get("events_attended", []), [], req_sys)
            cat = armory_catalog.get_armory_catalog(
                user_vault=v,
                user_crest_tier=crest_tier,
                game_system=req_sys,
                user_peak_elo=user_peak,
                user_championships=dev_champs
            )
            cat["user_glory"] = {
                "total_earned": total_earned,
                "glory_spent": spent,
                "spendable_glory": spendable,
                "crest_tier": crest_tier,
                "peak_elo": user_peak
            }
            now_iso = datetime.now(timezone.utc).isoformat()
            raw_p = v.get("received_pokes") or []
            act_p = [p for p in raw_p if isinstance(p, dict) and p.get("expires_at", "") > now_iso]
            cat["active_pokes"] = act_p
            cat["unseen_pokes"] = [p for p in act_p if not p.get("seen")]
            cat["user_vault"] = v
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(cat).encode("utf-8"))
            return

        if clean_path == "api/armory/pokes/active":
            glory_state = _get_dev_user_glory_and_stats()
            v = glory_state["vault"]
            now_iso = datetime.now(timezone.utc).isoformat()
            raw_p = v.get("received_pokes") or []
            act_p = [p for p in raw_p if isinstance(p, dict) and p.get("expires_at", "") > now_iso]
            unseen = [p for p in act_p if not p.get("seen")]
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({
                    "success": True,
                    "active_pokes": act_p,
                    "unseen_pokes": unseen,
                    "total_active": len(act_p),
                    "unseen_count": len(unseen)
                }).encode("utf-8"))
            return

        if clean_path == "api/armory/vault":
            glory_state = _get_dev_user_glory_and_stats()
            v = glory_state["vault"]
            res = {
                "success": True,
                "user_id": DEV_USER.get("id", "usr_dev"),
                "vault": v,
                "inventory": v.get("inventory", {}),
                "equipped": v.get("equipped", {}),
                "glory": {
                    "total_earned": glory_state["total_earned"],
                    "glory_spent": glory_state["glory_spent"],
                    "spendable_glory": glory_state["spendable_glory"],
                    "crest_tier": glory_state["crest_tier"],
                    "peak_elo": glory_state["peak_elo"]
                }
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path == "api/armory/transactions":
            glory_state = _get_dev_user_glory_and_stats()
            v = glory_state["vault"]
            inv = v.get("inventory", {})
            import armory_catalog
            debits = []
            for item_id, inv_item in inv.items():
                c_item = armory_catalog.get_item_by_id(item_id) or {}
                cost = int(c_item.get("cost_glory") or c_item.get("cost") or (inv_item.get("cost") if isinstance(inv_item, dict) else 0) or 0)
                debits.append({
                    "id": f"inv_{item_id}",
                    "type": "debit",
                    "item_id": item_id,
                    "name": c_item.get("name") or (inv_item.get("name") if isinstance(inv_item, dict) else item_id),
                    "wing": c_item.get("wing") or (inv_item.get("wing") if isinstance(inv_item, dict) else "Armory Requisition"),
                    "cost": cost,
                    "date": "2026-09-20"
                })
            credits = []
            for ev in DEV_EVENTS_ATTENDED:
                if ev.get('placement') == 1 or ev.get('finish') == 1 or ev.get('wins', 0) >= 3:
                    credits.append({
                        'id': f'champ_{ev.get("event_id")}',
                        'type': 'credit',
                        'category': 'Tournament Silverware',
                        'name': f'🏆 {ev.get("event_name")}',
                        'detail': f'Undefeated Championship ({ev.get("wins", 0)}-0) • {ev.get("rounds", 0)} Rounds',
                        'amount': 500 if ev.get('is_gt') else 150,
                        'date': ev.get('event_date', '')
                    })
            try:
                import badges
                b_eval = badges.evaluate_player_badges(player_data=DEV_USER, history=[], tournaments=DEV_EVENTS_ATTENDED, game_system='40k')
                for b in b_eval.get('badges', []):
                    pts = b.get('glory_points') or b.get('glory') or 0
                    if b.get('unlocked') and pts > 0:
                        credits.append({
                            'id': f'badge_{b.get("id")}',
                            'type': 'credit',
                            'category': 'Battlefield Honor',
                            'name': f'🎖️ {b.get("name")}',
                            'detail': f'{b.get("rarity_label", "Honor")} • {b.get("description", "")}',
                            'amount': pts,
                            'date': b.get('unlocked_at') or '2026-09-01'
                        })
            except Exception as be:
                logger.debug(f"Notice generating badges in dev_server transactions: {be}")
            if glory_state.get("glory_aos", 0) > 0:
                credits.append({
                    "id": "cross_sys_aos",
                    "type": "credit",
                    "category": "Cross-Game System",
                    "name": "⚡ Age of Sigmar Competitive Honor",
                    "detail": "Match play & verified tournament performance in AoS",
                    "amount": int(glory_state["glory_aos"]),
                    "date": ""
                })
            total_earned = glory_state["total_earned"]
            total_spent = glory_state["glory_spent"]
            spendable = glory_state["spendable_glory"]
            res = {
                "success": True,
                "summary": {
                    "total_earned": total_earned,
                    "total_spent": total_spent,
                    "spendable_glory": spendable,
                    "glory_40k": glory_state.get("glory_40k", total_earned),
                    "glory_aos": glory_state.get("glory_aos", 0),
                    "is_balanced": (total_earned - total_spent) == spendable
                },
                "debits": debits,
                "credits": credits
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path in ("api/eventstudio/events", "api/eventstudio/events/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "events": [DEV_STUDIO_EVENT]}).encode("utf-8"))
            return

        if clean_path.startswith("api/eventstudio/event/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "event": DEV_STUDIO_EVENT}).encode("utf-8"))
            return

        if clean_path.startswith("api/player/"):
            import leagues_hub_service
            pid = urllib.parse.unquote(clean_path.replace("api/player/", "").strip("/"))
            req_name = (query_params.get("name", [None])[0] or "").strip().lower()
            if pid == "Te1Q9lp3By" or "junior" in pid.lower() or "aflleje" in pid.lower() or "junior" in req_name or "aflleje" in req_name:
                import badges
                junior_tourneys = [
                    {'event_id': 'ev_lone_star_2026', 'event_name': 'Lone Star Open 2026 - Warhammer 40k Champs', 'event_date': '2026-08-01', 'total_players': 336, 'num_rounds': 6, 'wins': 6, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_lvtt_2026', 'event_name': 'Las Vegas Teams Tournament - LVTT 2026', 'event_date': '2026-02-14', 'total_players': 265, 'num_rounds': 5, 'wins': 5, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_lone_star_2025', 'event_name': 'Lone Star Open 2025 - 40k Champs', 'event_date': '2025-07-20', 'total_players': 322, 'num_rounds': 6, 'wins': 6, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Death Guard'},
                    {'event_id': 'ev_ctc_2025', 'event_name': 'California Team Championships by Best Coast Pairings', 'event_date': '2025-06-15', 'total_players': 215, 'num_rounds': 5, 'wins': 4, 'losses': 0, 'draws': 1, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_ctc_v', 'event_name': 'California Team Championships V by Dicehammer', 'event_date': '2024-06-23', 'total_players': 190, 'num_rounds': 5, 'wins': 5, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_lvtt_2025', 'event_name': 'Frontline Gaming Las Vegas Team Tournament 2025', 'event_date': '2025-01-18', 'total_players': 290, 'num_rounds': 6, 'wins': 6, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_socal_2025', 'event_name': 'SoCal Open 2025 - Warhammer 40k Major', 'event_date': '2025-10-24', 'total_players': 164, 'num_rounds': 6, 'wins': 6, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Space Marines'},
                    {'event_id': 'ev_tacoma_2025', 'event_name': 'US Open Tacoma Major 2025', 'event_date': '2025-08-22', 'total_players': 148, 'num_rounds': 6, 'wins': 6, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_sd_open_2025', 'event_name': 'San Diego Open Major 2025', 'event_date': '2025-04-18', 'total_players': 156, 'num_rounds': 6, 'wins': 6, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_socal_2024', 'event_name': 'SoCal Open 2024 - Warhammer 40k Major', 'event_date': '2024-10-26', 'total_players': 172, 'num_rounds': 6, 'wins': 6, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_flg_lso_gt', 'event_name': 'FLG Lone Star Open 2025 GT', 'event_date': '2025-07-19', 'total_players': 72, 'num_rounds': 5, 'wins': 5, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Space Marines'},
                    {'event_id': 'ev_hammer_bolter_gt', 'event_name': 'Hammer & Bolter GT 2025', 'event_date': '2025-05-11', 'total_players': 48, 'num_rounds': 5, 'wins': 5, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Space Marines'},
                    {'event_id': 'ev_crucible_2024', 'event_name': 'Crucible GT 2024', 'event_date': '2024-09-15', 'total_players': 64, 'num_rounds': 5, 'wins': 5, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_pnw_2025', 'event_name': 'Pacific Northwest GT 2025', 'event_date': '2025-06-14', 'total_players': 58, 'num_rounds': 5, 'wins': 5, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_armory_2024', 'event_name': 'Battle for the Armory GT 2024', 'event_date': '2024-11-10', 'total_players': 52, 'num_rounds': 5, 'wins': 5, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_bugeater_2024', 'event_name': 'Bugeater GT 2024', 'event_date': '2024-06-09', 'total_players': 68, 'num_rounds': 5, 'wins': 5, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_socal_spring_gt', 'event_name': 'SoCal Spring GT 2025', 'event_date': '2025-03-23', 'total_players': 44, 'num_rounds': 5, 'wins': 5, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_cal_winter_gt', 'event_name': 'California Winter GT 2025', 'event_date': '2025-01-12', 'total_players': 46, 'num_rounds': 5, 'wins': 5, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_sd_smackdown', 'event_name': 'SD Summer Smackdown RTT 2025', 'event_date': '2025-08-03', 'total_players': 20, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_flg_rtt_aug_26', 'event_name': 'FLG Monthly 40K RTT - August 2026', 'event_date': '2026-08-15', 'total_players': 18, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_flg_rtt_jul_26', 'event_name': 'FLG Monthly 40K RTT - July 2026', 'event_date': '2026-07-18', 'total_players': 16, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_flg_rtt_jun_26', 'event_name': 'FLG Monthly 40K RTT - June 2026', 'event_date': '2026-06-20', 'total_players': 18, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_flg_rtt_may_26', 'event_name': 'FLG Monthly 40K RTT - May 2026', 'event_date': '2026-05-16', 'total_players': 16, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_sdt_rtt_apr_26', 'event_name': 'San Diego Tabletop RTT - April 2026', 'event_date': '2026-04-18', 'total_players': 14, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_sdt_rtt_mar_26', 'event_name': 'San Diego Tabletop RTT - March 2026', 'event_date': '2026-03-21', 'total_players': 16, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_sdt_rtt_feb_26', 'event_name': 'San Diego Tabletop RTT - February 2026', 'event_date': '2026-02-21', 'total_players': 16, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_aeg_rtt_jan_26', 'event_name': 'At Ease Games RTT - January 2026', 'event_date': '2026-01-17', 'total_players': 18, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_aeg_rtt_dec_25', 'event_name': 'At Ease Games RTT - December 2025', 'event_date': '2025-12-20', 'total_players': 16, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_aeg_rtt_nov_25', 'event_name': 'At Ease Games RTT - November 2025', 'event_date': '2025-11-15', 'total_players': 14, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_sdt_rtt_aug_24', 'event_name': 'San Diego Summer RTT 2024', 'event_date': '2024-08-17', 'total_players': 16, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_sdt_rtt_apr_24', 'event_name': 'San Diego Spring RTT 2024', 'event_date': '2024-04-13', 'total_players': 16, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_tcg_rtt_mar_24', 'event_name': 'TCG Bully 40k RTT 2024', 'event_date': '2024-03-09', 'total_players': 14, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_tcg_rtt_jan_24', 'event_name': 'TCG Bully Winter RTT 2024', 'event_date': '2024-01-20', 'total_players': 16, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_bb_rtt_may_24', 'event_name': 'Battle Brothers RTT 2024', 'event_date': '2024-05-18', 'total_players': 18, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_bb_rtt_sep_24', 'event_name': 'Battle Brothers Fall RTT 2024', 'event_date': '2024-09-21', 'total_players': 16, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_bb_rtt_dec_23', 'event_name': 'Battle Brothers Winter RTT 2023', 'event_date': '2023-12-16', 'total_players': 16, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'},
                    {'event_id': 'ev_bb_rtt_nov_23', 'event_name': 'Battle Brothers November RTT 2023', 'event_date': '2023-11-18', 'total_players': 14, 'num_rounds': 3, 'wins': 3, 'losses': 0, 'draws': 0, 'placement': 1, 'registered_faction': 'Leagues of Votann'}
                ]
                j_champs = badges.extract_tournament_championships(junior_tourneys, [], "40k")
                res = {
                    "player": {
                        "player_id": "Te1Q9lp3By",
                        "player_name": "Junior Aflleje",
                        "team": "Team Zero Comp",
                        "teams_history": ["Team Zero Comp", "San Diego Tabletop", "Battle Brothers"],
                        "top_faction": "Leagues of Votann, Death Guard, Thousand Sons",
                        "current_elo": 2190.8,
                        "peak_elo": 2190.8,
                        "wins": 362,
                        "losses": 68,
                        "draws": 4,
                        "win_rate": 83.4,
                        "total_matches": 434
                    },
                    "has_account": False,
                    "longest_win_streak": 17,
                    "current_streak": 5,
                    "tournaments": junior_tourneys,
                    "events_attended": junior_tourneys,
                    "championships": j_champs,
                    "championship_pill": j_champs.get("championship_pill"),
                    "championship_glory": j_champs.get("championship_glory", 0),
                    "history": [
                        {"match_date": "2026-09-12", "event_name": "FLG Monthly 40K RTT - September", "round": 3, "result": "W", "player_score": 100, "opponent_score": 62, "player_faction": "Leagues of Votann", "opponent_name": "Aurelio Correa", "opponent_faction": "Space Marines", "opponent_elo": 1820.0, "delta_elo": 3.0, "new_elo": 2190.8},
                        {"match_date": "2026-09-12", "event_name": "FLG Monthly 40K RTT - September", "round": 2, "result": "W", "player_score": 83, "opponent_score": 64, "player_faction": "Leagues of Votann", "opponent_name": "Robert Buechele", "opponent_faction": "Imperium", "opponent_elo": 1780.0, "delta_elo": 2.6, "new_elo": 2187.8},
                        {"match_date": "2026-09-12", "event_name": "FLG Monthly 40K RTT - September", "round": 1, "result": "W", "player_score": 91, "opponent_score": 51, "player_faction": "Leagues of Votann", "opponent_name": "Keith French", "opponent_faction": "Chaos", "opponent_elo": 1690.0, "delta_elo": 0.3, "new_elo": 2185.2},
                        {"match_date": "2026-08-01", "event_name": "Lone Star Open 2026 - Warhammer 40k Champs", "round": 6, "result": "W", "player_score": 100, "opponent_score": 69, "player_faction": "Leagues of Votann", "opponent_name": "Thomas Greer", "opponent_faction": "Orks", "opponent_elo": 1940.0, "delta_elo": 10.7, "new_elo": 2184.9},
                        {"match_date": "2026-08-01", "event_name": "Lone Star Open 2026 - Warhammer 40k Champs", "round": 5, "result": "W", "player_score": 91, "opponent_score": 75, "player_faction": "Leagues of Votann", "opponent_name": "Trevor Bauchou", "opponent_faction": "Necrons", "opponent_elo": 1890.0, "delta_elo": 4.5, "new_elo": 2174.2}
                    ]
                }
            elif "lennon" in pid.lower() or "lennon" in req_name:
                res = {
                    "player": {
                        "player_id": "p_john_lennon",
                        "player_name": "John Lennon",
                        "team": "Art of War",
                        "teams_history": ["Art of War", "Team USA"],
                        "top_faction": "Space Marines, Ultramarines, Adeptus Custodes",
                        "current_elo": 2482.5,
                        "peak_elo": 2499.7,
                        "wins": 441,
                        "losses": 49,
                        "draws": 5,
                        "win_rate": 89.1,
                        "total_matches": 495
                    },
                    "has_account": False,
                    "longest_win_streak": 40,
                    "current_streak": 12,
                    "tournaments": [
                        {
                            "event_id": "ev_lvo_2025",
                            "event_name": "Las Vegas Open 2025 - Warhammer 40k Champs",
                            "event_date": "2025-01-26",
                            "tier": "super_major",
                            "tier_title": "Super Major / Worlds",
                            "trophy_type": "astral_obsidian_crown",
                            "total_players": 412,
                            "placement": 1,
                            "wins": 9,
                            "losses": 0,
                            "draws": 0,
                            "record": "9-0",
                            "undefeated": True,
                            "faction": "Ultramarines",
                            "glory_bonus": 3000,
                            "team": "Art of War"
                        },
                        {
                            "event_id": "ev_tacoma_2026",
                            "event_name": "The Challengers Cup 2026",
                            "event_date": "2026-09-11",
                            "tier": "major",
                            "tier_title": "Major Championship",
                            "trophy_type": "winged_chalice",
                            "total_players": 128,
                            "placement": 1,
                            "wins": 6,
                            "losses": 0,
                            "draws": 0,
                            "record": "6-0",
                            "undefeated": True,
                            "faction": "Space Marines",
                            "glory_bonus": 1250,
                            "team": "Art of War"
                        }
                    ],
                    "history": [
                        {"match_date": "2026-09-11", "event_name": "The Challengers Cup 2026", "round": 1, "result": "W", "player_score": 100, "opponent_score": 42, "player_faction": "Space Marines", "opponent_name": "Colin Sherman", "opponent_faction": "Chaos", "opponent_elo": 1910.0, "delta_elo": 10.2, "new_elo": 2482.5, "team": "Art of War"}
                    ]
                }
            elif "hsieh" in pid.lower() or pid == "MEV83VFANA" or pid == "9oEfu25ccjqE" or "hsieh" in req_name or ("john" in req_name and "lennon" not in req_name):
                res = {
                    "player": {
                        "player_id": "MEV83VFANA",
                        "player_name": "John Hsieh",
                        "team": "Team Zero Comp",
                        "teams_history": ["Team Zero Comp"],
                        "top_faction": "Necrons, Dark Angels",
                        "current_elo": 1888.5,
                        "peak_elo": 1888.5,
                        "wins": 62,
                        "losses": 31,
                        "draws": 1,
                        "win_rate": 66.0,
                        "total_matches": 94
                    },
                    "has_account": True,
                    "account_user_id": "u_john_hsieh",
                    "longest_win_streak": 7,
                    "current_streak": 3,
                    "tournaments": [
                        {
                            "event_id": "ev_angron_rtt_march",
                            "event_name": "Angron's Book Club RTT: March",
                            "event_date": "2024-03-15",
                            "tier": "rtt",
                            "tier_title": "Rogue Trader Tournament",
                            "trophy_type": "bronze_laurel_plaque",
                            "total_players": 16,
                            "num_rounds": 3,
                            "placement": 1,
                            "wins": 3,
                            "losses": 0,
                            "draws": 0,
                            "record": "3-0",
                            "undefeated": True,
                            "faction": "Necrons",
                            "glory_bonus": 150
                        },
                        {
                            "event_id": "ev_laughing_dragon_oct",
                            "event_name": "Laughing Dragon 2024 October RTT",
                            "event_date": "2024-10-12",
                            "tier": "rtt",
                            "tier_title": "Rogue Trader Tournament",
                            "trophy_type": "bronze_laurel_plaque",
                            "total_players": 14,
                            "num_rounds": 3,
                            "placement": 1,
                            "wins": 3,
                            "losses": 0,
                            "draws": 0,
                            "record": "3-0",
                            "undefeated": True,
                            "faction": "Necrons",
                            "glory_bonus": 150
                        },
                        {
                            "event_id": "ev_laughing_dragon_apr",
                            "event_name": "Laughing Dragon 2024 April RTT",
                            "event_date": "2024-04-20",
                            "tier": "rtt",
                            "tier_title": "Rogue Trader Tournament",
                            "trophy_type": "bronze_laurel_plaque",
                            "total_players": 16,
                            "num_rounds": 3,
                            "placement": 1,
                            "wins": 3,
                            "losses": 0,
                            "draws": 0,
                            "record": "3-0",
                            "undefeated": True,
                            "faction": "Necrons",
                            "glory_bonus": 150
                        },
                        {
                            "event_id": "ev_laughing_dragon_spring",
                            "event_name": "Laughing Dragon April RTT",
                            "event_date": "2024-04-06",
                            "tier": "rtt",
                            "tier_title": "Rogue Trader Tournament",
                            "trophy_type": "bronze_laurel_plaque",
                            "total_players": 16,
                            "num_rounds": 3,
                            "placement": 1,
                            "wins": 3,
                            "losses": 0,
                            "draws": 0,
                            "record": "3-0",
                            "undefeated": True,
                            "faction": "Necrons",
                            "glory_bonus": 150
                        }
                    ],
                    "history": [
                        {"match_date": "2026-08-20", "event_name": "US Open Tacoma Major", "round": 1, "result": "W", "player_score": 100, "opponent_score": 64, "player_faction": "Necrons", "opponent_name": "Tyler Adams", "opponent_faction": "Space Marines", "opponent_elo": 1720.0, "delta_elo": 11.2, "new_elo": 1888.5},
                        {"match_date": "2026-08-20", "event_name": "US Open Tacoma Major", "round": 2, "result": "W", "player_score": 91, "opponent_score": 77, "player_faction": "Necrons", "opponent_name": "Victor Baker", "opponent_faction": "Aeldari", "opponent_elo": 1750.0, "delta_elo": 10.5, "new_elo": 1877.3},
                        {"match_date": "2026-08-20", "event_name": "US Open Tacoma Major", "round": 3, "result": "W", "player_score": 100, "opponent_score": 75, "player_faction": "Necrons", "opponent_name": "Ryan Scott", "opponent_faction": "Votann", "opponent_elo": 1690.0, "delta_elo": 9.8, "new_elo": 1866.8},
                        {"match_date": "2026-08-20", "event_name": "US Open Tacoma Major", "round": 4, "result": "L", "player_score": 48, "opponent_score": 100, "player_faction": "Necrons", "opponent_name": "Junior Aflleje", "opponent_faction": "Space Marines", "opponent_elo": 2180.0, "delta_elo": -5.2, "new_elo": 1857.0},
                        {"match_date": "2026-08-20", "event_name": "US Open Tacoma Major", "round": 5, "result": "W", "player_score": 91, "opponent_score": 80, "player_faction": "Necrons", "opponent_name": "James Carmona", "opponent_faction": "Custodes", "opponent_elo": 1940.0, "delta_elo": 12.4, "new_elo": 1862.2}
                    ]
                }
            elif leagues_hub_service.get_leagues_hub_service().get_player_career("league_sd40k_big_league", (query_params.get("name", [None])[0] or pid).strip()):
                lookup_name = (query_params.get("name", [None])[0] or pid).strip()
                career = leagues_hub_service.get_leagues_hub_service().get_player_career("league_sd40k_big_league", lookup_name)
                factions_list = career.get("factions") or ["Space Marines"]
                hist_list = career.get("history") or []
                total_w = sum(int(h.get("wins", 0)) for h in hist_list)
                total_l = sum(int(h.get("losses", 0)) for h in hist_list)
                total_d = sum(int(h.get("draws", 0)) for h in hist_list)
                total_g = career.get("total_games") or (total_w + total_l + total_d) or 1
                win_rate_val = round((total_w / max(1, total_g)) * 100, 1)
                history_rows = []
                for s_entry in hist_list[:8]:
                    history_rows.append({
                        "match_date": f"Season {s_entry.get('season_number')}",
                        "event_name": f"SD40K BIG League S{s_entry.get('season_number')} (Pod {s_entry.get('pod_number')}: {s_entry.get('pod_name', 'Pod')})",
                        "round": f"Rank #{s_entry.get('rank', 1)}",
                        "result": "W" if s_entry.get("wins", 0) >= s_entry.get("losses", 0) else "L",
                        "player_score": s_entry.get("battle_points", 380),
                        "opponent_score": s_entry.get("poty_points", 25),
                        "player_faction": s_entry.get("primary_faction") or factions_list[0],
                        "opponent_name": s_entry.get("record", f"{s_entry.get('wins', 0)}W-{s_entry.get('losses', 0)}L"),
                        "opponent_faction": f"Pod #{s_entry.get('pod_number', 1)} Standings",
                        "opponent_elo": 1950.0,
                        "delta_elo": round((s_entry.get("wins", 0) - s_entry.get("losses", 0)) * 6.5, 1),
                        "new_elo": 2120.0
                    })
                res = {
                    "player": {
                        "player_id": f"p_{lookup_name.lower().replace(' ', '_')}",
                        "player_name": career.get("name", lookup_name),
                        "team": "San Diego Force Org (SD40K)",
                        "teams_history": ["San Diego Force Org (SD40K)", "At Ease Games"],
                        "top_faction": ", ".join(factions_list),
                        "current_elo": round(1850.0 + total_w * 4.5, 1),
                        "peak_elo": round(1910.0 + total_w * 4.8, 1),
                        "wins": total_w,
                        "losses": total_l,
                        "draws": total_d,
                        "win_rate": win_rate_val,
                        "total_matches": total_g
                    },
                    "has_account": True,
                    "longest_win_streak": max(5, int(career.get("pod_titles", 0)) * 3 + 4),
                    "history": history_rows
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
            is_self = bool(pid == DEV_USER.get("player_id") or pid == "p_folger_pyles" or pid == DEV_USER.get("id"))
            tournaments_list = (res.get("tournaments") or []) or (DEV_USER.get("events_attended", []) if is_self else [])
            res["tournaments"] = tournaments_list

            import badges
            req_game_sys = query_params.get("game_system", ["40k"])[0].lower() if "query_params" in locals() else "40k"
            b_eval = badges.evaluate_player_badges(
                player_data=res.get("player") or res,
                history=res.get("history") or [],
                tournaments=tournaments_list,
                faction_mastery=res.get("faction_mastery") or [],
                matchup_matrix=res.get("matchup_matrix") or [],
                user_pinned_ids=None,
                game_system=req_game_sys
            )
            if is_self:
                res["armory_vault"] = DEV_USER.get("armory_vault", {})
                res["equipped"] = DEV_USER.get("armory_vault", {}).get("equipped", {})
            else:
                if "equipped" not in res:
                    res["equipped"] = {
                        "active_dice": "dice_cyber_grid",
                        "active_card_frame": "frame_cyber_matrix",
                        "active_title": "title_unbroken",
                        "active_avatar": "avatar_sigil_tau"
                    }
                    res["armory_vault"] = {"equipped": res["equipped"]}

            res.update({
                "armory_vault": res.get("armory_vault", {}),
                "equipped": res.get("equipped", {}),
                "badge_count": b_eval["badge_count"],
                "total_badges": b_eval["total_badges"],
                "completion_pct": b_eval["completion_pct"],
                "glory_score": b_eval["glory_score"],
                "career_glory": glory_state["total_earned"] if is_self else b_eval.get("career_glory", b_eval.get("glory_score", 0)),
                "seasonal_glory": b_eval.get("seasonal_glory", 0),
                "glory_balance": glory_state["spendable_glory"] if is_self else b_eval.get("glory_balance", b_eval.get("glory_score", 0)),
                "spendable_glory": glory_state["spendable_glory"] if is_self else b_eval.get("glory_balance", b_eval.get("glory_score", 0)),
                "total_glory": glory_state["total_earned"] if is_self else b_eval.get("career_glory", 0),
                "glory_spent": glory_state["glory_spent"] if is_self else 0,
                "seasonal": b_eval.get("seasonal", {}),
                "active_season": b_eval.get("active_season", "2026"),
                "rank": b_eval["rank"],
                "pinned_badges": b_eval["pinned_badges"],
                "badges_celebrated": bool(DEV_USER.get("badges_celebrated", False)),
                "badges": b_eval["badges"],
                "categories": b_eval["categories"],
                "championships": b_eval.get("championships", {}),
                "championship_glory": b_eval.get("championship_glory", 0),
                "championship_pill": (b_eval.get("championships") or {}).get("championship_pill")
            })
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path in ("api/community/bcp_majors", "api/community/bcp-majors"):
            req_sys = "aos" if "game_system=aos" in query_str else "40k"
            try:
                from routers.community import fetch_live_bcp_majors
                majors_list = fetch_live_bcp_majors(game_system=req_sys)
            except Exception as e:
                try:
                    from routers.community import get_fallback_majors
                    majors_list = get_fallback_majors(req_sys)
                except Exception:
                    majors_list = []
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({
                    "success": True,
                    "events": majors_list,
                    "count": len(majors_list),
                    "game_system": req_sys
                }).encode("utf-8"))
            return

        if clean_path in ("api/events/recommended", "api/community/overview", "api/community/bcp-upcoming", "api/community/bcp_upcoming"):
            now_dt = datetime.now(timezone.utc)
            today_iso = now_dt.strftime("%Y-%m-%d")
            tomorrow_iso = (now_dt + timedelta(days=1)).strftime("%Y-%m-%d")
            yesterday_iso = (now_dt - timedelta(days=1)).strftime("%Y-%m-%d")
            ongoing_ev = {
                "id": "ev_ongoing_gt_live",
                "event_id": "ev_ongoing_gt_live",
                "name": "Warhammer 40k US Open Series 2026",
                "event_date": yesterday_iso,
                "end_date": tomorrow_iso,
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
            eid = clean_path.replace("api/community/events/", "").replace("/registration", "").strip()
            if eid == "ev_ongoing_gt_live":
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
            else:
                bcp_name = "Tournament"
                event_date = "2026-09-16"
                try:
                    b_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{eid}"
                    b_req = urllib.request.Request(b_url, headers={"client-id": "web-app", "User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(b_req, timeout=4) as b_resp:
                        if b_resp.status == 200:
                            b_json = json.loads(b_resp.read().decode("utf-8"))
                            bcp_name = b_json.get("name") or bcp_name
                            event_date = (b_json.get("eventDate") or event_date)[:10]
                except Exception:
                    pass
                res = {
                    "success": True,
                    "event_id": eid,
                    "event_name": bcp_name,
                    "event_date": event_date,
                    "tier": "free",
                    "ticket_price": 0.0,
                    "ticket_currency": "usd",
                    "can_register_free": True,
                    "can_buy_ticket": False,
                    "requires_external_ticket": False,
                    "is_closed": False,
                    "is_sold_out": False,
                    "is_started": False,
                    "is_ended": False,
                    "is_ongoing": False,
                    "status_label": "Registration Open",
                    "is_registered": False,
                    "player_registration": None,
                    "user_profile": {
                        "logged_in": True,
                        "name": "John Hsieh",
                        "first_name": "John",
                        "last_name": "Hsieh",
                        "email": "hsiehjun@google.com",
                        "bcp_linked": True,
                        "bcp_user_id": "9oEfu25ccjqE"
                    },
                    "army_lists": []
                }
            import badges
            req_game_sys = query_params.get("game_system", ["40k"])[0].lower() if "query_params" in locals() else "40k"
            user_pinned = DEV_USER.get("pinned_badges") if isinstance(DEV_USER, dict) else None
            b_eval = badges.evaluate_player_badges(
                player_data=res.get("player") or res,
                history=res.get("history") or [],
                tournaments=res.get("tournaments") or [],
                faction_mastery=res.get("faction_mastery") or [],
                matchup_matrix=res.get("matchup_matrix") or [],
                user_pinned_ids=user_pinned,
                game_system=req_game_sys
            )
            user_ack = DEV_USER.get("acknowledged_badge_ids") or []
            ack_set = set(user_ack)
            newly_unlocked = [b for b in b_eval["badges"] if b.get("unlocked") and b.get("id") not in ack_set]
            res.update({
                "badge_count": b_eval["badge_count"],
                "total_badges": b_eval["total_badges"],
                "completion_pct": b_eval["completion_pct"],
                "glory_score": b_eval["glory_score"],
                "career_glory": b_eval.get("career_glory", b_eval.get("glory_score", 0)),
                "seasonal_glory": b_eval.get("seasonal_glory", 0),
                "glory_balance": b_eval.get("glory_balance", b_eval.get("glory_score", 0)),
                "seasonal": b_eval.get("seasonal", {}),
                "active_season": b_eval.get("active_season", "2026"),
                "rank": b_eval["rank"],
                "pinned_badges": b_eval["pinned_badges"],
                "badges_celebrated": bool(DEV_USER.get("badges_celebrated", False)),
                "acknowledged_badge_ids": list(ack_set),
                "newly_unlocked_badges": newly_unlocked,
                "badges": b_eval["badges"],
                "categories": b_eval["categories"]
            })
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path == "api/user/registered-tournaments" or clean_path.startswith("api/user/registered-tournaments"):
            res = {
                "success": True,
                "bcp_connected": True,
                "count": 1,
                "tournaments": [
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
                        "rounds": 5,
                        "player_id": "p_innes_wilson"
                    }
                ]
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if (clean_path.startswith("api/events/") or clean_path.startswith("api/eventstudio/event/")) and clean_path.endswith("/livestreams"):
            parts = clean_path.split("/")
            ev_id = parts[2] if clean_path.startswith("api/events/") else parts[3]
            streams = EVENT_LIVESTREAMS_DB.get(ev_id, [])
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "event_id": ev_id, "livestreams": streams}).encode("utf-8"))
            return

        if clean_path in ("api/admin/users", "api/admin/users/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "users": DEV_USERS_LIST}).encode("utf-8"))
            return

        if clean_path in ("api/leagues", "api/leagues/"):
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            leagues_list = l_svc.get_leagues_list()
            templates_list = l_svc.get_available_templates()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({
                    "success": True,
                    "leagues": leagues_list,
                    "count": len(leagues_list),
                    "available_templates": templates_list
                }).encode("utf-8"))
            return

        if clean_path.startswith("api/league/player/"):
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            p_name = urllib.parse.unquote(clean_path.replace("api/league/player/", "").strip("/"))
            summary = l_svc.get_player_league_summary(p_name)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({
                    "success": True,
                    "player_name": p_name,
                    "active_leagues": summary
                }).encode("utf-8"))
            return

        if clean_path.startswith("api/league/") and "/pod/" in clean_path:
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            parts = clean_path.split("/")
            l_id = parts[2]
            pod_num = int(parts[4]) if len(parts) > 4 and parts[4].isdigit() else 1
            pod_data = l_svc.get_pod(l_id, pod_num)
            self.send_response(200 if pod_data else 404)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({
                    "success": bool(pod_data),
                    "pod": pod_data
                } if pod_data else {"success": False, "error": "Pod not found"}).encode("utf-8"))
            return

        if clean_path.startswith("api/league/") and clean_path.endswith("/rollover/preview"):
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            parts = clean_path.split("/")
            l_id = parts[2]
            s_param = query_params.get("season", [None])[0]
            s_num = int(s_param) if s_param and s_param.isdigit() else None
            try:
                preview = l_svc.calculate_promotion_relegation(l_id, season_number=s_num)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                if not is_head:
                    self.wfile.write(json.dumps(preview).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                if not is_head:
                    self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        if clean_path.startswith("api/league/") and clean_path.endswith("/seasons"):
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            parts = clean_path.split("/")
            l_id = parts[2]
            seasons = l_svc.get_seasons_catalog(l_id)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({
                    "success": True,
                    "league_id": l_id,
                    "seasons": seasons,
                    "count": len(seasons)
                }).encode("utf-8"))
            return

        if clean_path.startswith("api/league/") and "/season/" in clean_path:
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            parts = clean_path.split("/")
            l_id = parts[2]
            s_num = int(parts[4]) if len(parts) > 4 and parts[4].isdigit() else 38
            league_data = l_svc.get_league(l_id, season_number=s_num)
            self.send_response(200 if league_data else 404)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({
                    "success": bool(league_data),
                    "league": league_data
                } if league_data else {"success": False, "error": "Season not found"}).encode("utf-8"))
            return

        if clean_path.startswith("api/league/") and "/player/" in clean_path and clean_path.endswith("/history"):
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            parts = clean_path.split("/")
            l_id = parts[2]
            p_name = urllib.parse.unquote(parts[4])
            career = l_svc.get_player_career(l_id, p_name)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({
                    "success": True,
                    "player": career
                }).encode("utf-8"))
            return

        if clean_path.startswith("api/league/"):
            import leagues_hub_service
            l_svc = leagues_hub_service.get_leagues_hub_service()
            l_id = clean_path.replace("api/league/", "").strip("/")
            s_param = query_params.get("season", [None])[0]
            s_num = int(s_param) if s_param and s_param.isdigit() else None
            league_data = l_svc.get_league(l_id, season_number=s_num)
            self.send_response(200 if league_data else 404)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({
                    "success": bool(league_data),
                    "league": league_data
                } if league_data else {"success": False, "error": "League not found"}).encode("utf-8"))
            return

        if clean_path.startswith("api/event/"):
            ev_param = clean_path.replace("api/event/", "")
            if ev_param in DEV_EVENT_CACHE:
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                if not is_head:
                    self.wfile.write(json.dumps(DEV_EVENT_CACHE[ev_param]).encode("utf-8"))
                return

            if len(ev_param) >= 8 and not ev_param.startswith("ev_"):
                try:
                    b_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{ev_param}"
                    b_req = urllib.request.Request(b_url, headers={"client-id": "web-app", "User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(b_req, timeout=4) as b_resp:
                        if b_resp.status == 200:
                            b_json = json.loads(b_resp.read().decode("utf-8"))
                            loc = b_json.get("location") if isinstance(b_json.get("location"), dict) else {}
                            tot_p = int(b_json.get("totalPlayers") or len(b_json.get("players") or []) or 0)
                            ev_name = b_json.get("name") or "BCP Tournament"
                            ev_name_lower = ev_name.lower()
                            resolved_rds = int(b_json.get("numberOfRounds") or b_json.get("numRounds") or 0)

                            res = {
                                "id": ev_param,
                                "name": ev_name,
                                "event_date": (b_json.get("eventDate") or "")[:10],
                                "end_date": (b_json.get("endDate") or "")[:10],
                                "city": b_json.get("city") or loc.get("city") or "",
                                "state": b_json.get("state") or loc.get("state") or "",
                                "country": b_json.get("country") or loc.get("country") or "United States",
                                "venue": b_json.get("venueName") or loc.get("venueName") or loc.get("name") or "",
                                "total_players": tot_p,
                                "num_rounds": resolved_rds,
                                "numberOfRounds": resolved_rds,
                                "current_round": int(b_json.get("currentRound") or 0),
                                "raw_json": b_json,
                            }
                            raw_end_str = str(b_json.get("endDate") or b_json.get("end_date") or "")
                            raw_start_str = str(b_json.get("eventDate") or b_json.get("event_date") or b_json.get("startDate") or "")
                            today_utc_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                            num_rds_val = resolved_rds
                            computed_ended = bool(b_json.get("ended") or b_json.get("isEnded"))
                            if not computed_ended:
                                if raw_end_str and raw_end_str[:10] < today_utc_str:
                                    computed_ended = True
                                elif raw_start_str and raw_start_str[:10] < today_utc_str and (num_rds_val <= 3 or not raw_end_str):
                                    computed_ended = True
                            res["is_ended"] = computed_ended
                            res["ended"] = computed_ended
                            res["started"] = bool(b_json.get("started") or computed_ended)
                            res["status"] = {"ended": computed_ended, "isEnded": computed_ended, "started": bool(b_json.get("started") or computed_ended)}
                            
                            b_players = b_json.get("players") or []
                            if not b_players:
                                try:
                                    p_url = f"https://newprod-api.bestcoastpairings.com/v1/events/{ev_param}/players"
                                    p_req = urllib.request.Request(p_url, headers={"client-id": "web-app", "User-Agent": "Mozilla/5.0"})
                                    with urllib.request.urlopen(p_req, timeout=4) as p_resp:
                                        if p_resp.status == 200:
                                            p_json = json.loads(p_resp.read().decode("utf-8"))
                                            raw_active = p_json.get("active", []) if isinstance(p_json, dict) else (p_json if isinstance(p_json, list) else [])
                                            formatted_p = []
                                            for idx, ap in enumerate(raw_active, 1):
                                                u = ap.get("user") if isinstance(ap.get("user"), dict) else {}
                                                fn = f"{u.get('firstName', '')} {u.get('lastName', '')}".strip() or ap.get("name") or f"Competitor #{idx}"
                                                pid = ap.get("userId") or ap.get("id") or f"p_{idx}"
                                                matched_user = next((du for du in DEV_USERS_LIST if du.get("id") == pid or (du.get("name") and du.get("name").lower() == fn.lower())), None)
                                                p_elo = float(matched_user.get("elo") or 1500.0) if matched_user else (2383.9 if "conan" in fn.lower() else (2375.2 if "innes" in fn.lower() else (2190.8 if "junior" in fn.lower() else (2172.1 if "travis" in fn.lower() else 1500.0))))
                                                formatted_p.append({
                                                    "player_id": pid,
                                                    "full_name": fn,
                                                    "faction": ap.get("armyList") or ap.get("faction") or "-",
                                                    "detachment": "",
                                                    "team": ap.get("teamName") or (ap.get("team", {}).get("name") if isinstance(ap.get("team"), dict) else ""),
                                                    "placement": idx,
                                                    "event_wins": 0,
                                                    "event_losses": 0,
                                                    "event_draws": 0,
                                                    "event_battle_points": 0,
                                                    "current_elo": p_elo,
                                                    "has_list": bool(ap.get("armyListText")),
                                                    "army_list": ap.get("armyListText") or "",
                                                    "checked_in": bool(ap.get("checkedIn"))
                                                })
                                            formatted_p.sort(key=lambda x: x.get("current_elo") or 1500.0, reverse=True)
                                            for rk, fp in enumerate(formatted_p, 1):
                                                fp["placement"] = rk
                                            b_players = formatted_p
                                except Exception:
                                    pass

                            res["players"] = b_players
                            res["matches"] = b_json.get("matches") or []
                            res["team_standings"] = []
                            DEV_EVENT_CACHE[ev_param] = res
                            self.send_response(200)
                            self.send_header("Content-Type", "application/json; charset=utf-8")
                            self.end_headers()
                            if not is_head:
                                self.wfile.write(json.dumps(res).encode("utf-8"))
                            return
                except Exception:
                    pass

            if ev_param == "ev_ongoing_gt_live":
                now_dt = datetime.now(timezone.utc)
                res = {
                    "id": "ev_ongoing_gt_live",
                    "name": "Warhammer 40k US Open Series 2026 - Atlanta Major",
                    "event_date": (now_dt - timedelta(days=1)).strftime("%Y-%m-%d"),
                    "end_date": (now_dt + timedelta(days=1)).strftime("%Y-%m-%d"),
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

            if ev_param == "73q0VFQZIVGo" or "73q0" in ev_param.lower() or "flg" in ev_param.lower():
                res = {
                    "id": "73q0VFQZIVGo",
                    "name": "FLG Monthly 40K RTT - September",
                    "event_date": "2026-09-12",
                    "end_date": "2026-09-12",
                    "city": "Las Vegas",
                    "state": "NV",
                    "country": "United States",
                    "venue": "Frontline Gaming",
                    "total_players": 19,
                    "num_rounds": 3,
                    "current_round": 3,
                    "is_ended": True,
                    "ended": True,
                    "started": True,
                    "status": {"ended": True, "isEnded": True, "started": True},
                    "raw_json": {
                        "ended": False,
                        "isEnded": False,
                        "status": {"ended": False, "isEnded": False, "started": True},
                        "startDate": "2026-09-12T10:00:00",
                        "endDate": "2026-09-12T19:00:00",
                        "numberOfRounds": 3,
                        "currentRound": 3
                    },
                    "matches": [
                        {"id": "m_flg_1_1", "round": 1, "table_number": 1, "table": 1, "player1_id": "p_roberto", "player1_name": "Roberto Medina", "player1_faction": "Adepta Sororitas", "player1_score": 97, "player2_id": "p_tyler_a", "player2_name": "Tyler Adams", "player2_faction": "Imperial Knights", "player2_score": 38, "winner_id": "p_roberto", "is_done": True, "status": "finished"},
                        {"id": "m_flg_1_2", "round": 1, "table_number": 2, "table": 2, "player1_id": "p_junior", "player1_name": "Junior Aflleje", "player1_faction": "Leagues of Votann", "player1_score": 91, "player2_id": "p_brandon", "player2_name": "Brandon White", "player2_faction": "Aeldari", "player2_score": 45, "winner_id": "p_junior", "is_done": True, "status": "finished"},
                        {"id": "m_flg_1_3", "round": 1, "table_number": 3, "table": 3, "player1_id": "p_culham", "player1_name": "Culham Otton", "player1_faction": "Astra Militarum", "player1_score": 89, "player2_id": "p_justin", "player2_name": "Justin Lee", "player2_faction": "Genestealer Cults", "player2_score": 52, "winner_id": "p_culham", "is_done": True, "status": "finished"},
                        {"id": "m_flg_1_4", "round": 1, "table_number": 4, "table": 4, "player1_id": "p_aurelio", "player1_name": "Aurelio Correa", "player1_faction": "Dark Angels", "player1_score": 88, "player2_id": "p_ryan", "player2_name": "Ryan King", "player2_faction": "World Eaters", "player2_score": 40, "winner_id": "p_aurelio", "is_done": True, "status": "finished"},
                        {"id": "m_flg_1_5", "round": 1, "table_number": 5, "table": 5, "player1_id": "p_ramon", "player1_name": "Ramon Ortiz", "player1_faction": "Chaos Space Marines", "player1_score": 85, "player2_id": "p_eric", "player2_name": "Eric Allen", "player2_faction": "Thousand Sons", "player2_score": 45, "winner_id": "p_ramon", "is_done": True, "status": "finished"},
                        {"id": "m_flg_1_6", "round": 1, "table_number": 6, "table": 6, "player1_id": "p_derek", "player1_name": "Derek Williams", "player1_faction": "Necrons", "player1_score": 82, "player2_id": "p_chris_y", "player2_name": "Chris Young", "player2_faction": "Death Guard", "player2_score": 50, "winner_id": "p_derek", "is_done": True, "status": "finished"},
                        {"id": "m_flg_1_7", "round": 1, "table_number": 7, "table": 7, "player1_id": "p_anthony", "player1_name": "Anthony Davis", "player1_faction": "T'au Empire", "player1_score": 80, "player2_id": "p_thomas", "player2_name": "Thomas Hall", "player2_faction": "Adeptus Custodes", "player2_score": 55, "winner_id": "p_anthony", "is_done": True, "status": "finished"},
                        {"id": "m_flg_1_8", "round": 1, "table_number": 8, "table": 8, "player1_id": "p_michael", "player1_name": "Michael Chang", "player1_faction": "Tyranids", "player1_score": 78, "player2_id": "p_jason", "player2_name": "Jason Scott", "player2_faction": "Grey Knights", "player2_score": 60, "winner_id": "p_michael", "is_done": True, "status": "finished"},
                        {"id": "m_flg_1_9", "round": 1, "table_number": 9, "table": 9, "player1_id": "p_brian", "player1_name": "Brian Miller", "player1_faction": "Blood Angels", "player1_score": 75, "player2_id": "p_kevin", "player2_name": "Kevin Wright", "player2_faction": "Space Marines", "player2_score": 65, "winner_id": "p_brian", "is_done": True, "status": "finished"},
                        {"id": "m_flg_2_1", "round": 2, "table_number": 1, "table": 1, "player1_id": "p_roberto", "player1_name": "Roberto Medina", "player1_faction": "Adepta Sororitas", "player1_score": 96, "player2_id": "p_culham", "player2_name": "Culham Otton", "player2_faction": "Astra Militarum", "player2_score": 82, "winner_id": "p_roberto", "is_done": True, "status": "finished"},
                        {"id": "m_flg_2_2", "round": 2, "table_number": 2, "table": 2, "player1_id": "p_junior", "player1_name": "Junior Aflleje", "player1_faction": "Leagues of Votann", "player1_score": 93, "player2_id": "p_aurelio", "player2_name": "Aurelio Correa", "player2_faction": "Dark Angels", "player2_score": 84, "winner_id": "p_junior", "is_done": True, "status": "finished"},
                        {"id": "m_flg_2_3", "round": 2, "table_number": 3, "table": 3, "player1_id": "p_ramon", "player1_name": "Ramon Ortiz", "player1_faction": "Chaos Space Marines", "player1_score": 86, "player2_id": "p_derek", "player2_name": "Derek Williams", "player2_faction": "Necrons", "player2_score": 78, "winner_id": "p_ramon", "is_done": True, "status": "finished"},
                        {"id": "m_flg_2_4", "round": 2, "table_number": 4, "table": 4, "player1_id": "p_anthony", "player1_name": "Anthony Davis", "player1_faction": "T'au Empire", "player1_score": 82, "player2_id": "p_brian", "player2_name": "Brian Miller", "player2_faction": "Blood Angels", "player2_score": 72, "winner_id": "p_anthony", "is_done": True, "status": "finished"},
                        {"id": "m_flg_2_5", "round": 2, "table_number": 5, "table": 5, "player1_id": "p_michael", "player1_name": "Michael Chang", "player1_faction": "Tyranids", "player1_score": 77, "player2_id": "p_david_c", "player2_name": "David Clark", "player2_faction": "Orks", "player2_score": 70, "winner_id": "p_michael", "is_done": True, "status": "finished"},
                        {"id": "m_flg_2_6", "round": 2, "table_number": 6, "table": 6, "player1_id": "p_kevin", "player1_name": "Kevin Wright", "player1_faction": "Space Marines", "player1_score": 71, "player2_id": "p_jason", "player2_name": "Jason Scott", "player2_faction": "Grey Knights", "player2_score": 65, "winner_id": "p_kevin", "is_done": True, "status": "finished"},
                        {"id": "m_flg_3_1", "round": 3, "table_number": 1, "table": 1, "player1_id": "p_roberto", "player1_name": "Roberto Medina", "player1_faction": "Adepta Sororitas", "player1_score": 98, "player2_id": "p_junior", "player2_name": "Junior Aflleje", "player2_faction": "Leagues of Votann", "player2_score": 90, "winner_id": "p_roberto", "is_done": True, "status": "finished"},
                        {"id": "m_flg_3_2", "round": 3, "table_number": 2, "table": 2, "player1_id": "p_culham", "player1_name": "Culham Otton", "player1_faction": "Astra Militarum", "player1_score": 95, "player2_id": "p_ramon", "player2_name": "Ramon Ortiz", "player2_faction": "Chaos Space Marines", "player2_score": 74, "winner_id": "p_culham", "is_done": True, "status": "finished"},
                        {"id": "m_flg_3_3", "round": 3, "table_number": 3, "table": 3, "player1_id": "p_aurelio", "player1_name": "Aurelio Correa", "player1_faction": "Dark Angels", "player1_score": 87, "player2_id": "p_anthony", "player2_name": "Anthony Davis", "player2_faction": "T'au Empire", "player2_score": 73, "winner_id": "p_aurelio", "is_done": True, "status": "finished"},
                        {"id": "m_flg_3_4", "round": 3, "table_number": 4, "table": 4, "player1_id": "p_derek", "player1_name": "Derek Williams", "player1_faction": "Necrons", "player1_score": 80, "player2_id": "p_michael", "player2_name": "Michael Chang", "player2_faction": "Tyranids", "player2_score": 73, "winner_id": "p_derek", "is_done": True, "status": "finished"},
                        {"id": "m_flg_3_5", "round": 3, "table_number": 5, "table": 5, "player1_id": "p_brian", "player1_name": "Brian Miller", "player1_faction": "Blood Angels", "player1_score": 73, "player2_id": "p_david_c", "player2_name": "David Clark", "player2_faction": "Orks", "player2_score": 68, "winner_id": "p_brian", "is_done": True, "status": "finished"},
                        {"id": "m_flg_3_6", "round": 3, "table_number": 6, "table": 6, "player1_id": "p_david_c", "player1_name": "David Clark", "player1_faction": "Orks", "player1_score": 67, "player2_id": "p_thomas", "player2_name": "Thomas Hall", "player2_faction": "Adeptus Custodes", "player2_score": 65, "winner_id": "p_david_c", "is_done": True, "status": "finished"},
                        {"id": "m_flg_3_7", "round": 3, "table_number": 7, "table": 7, "player1_id": "p_jason", "player1_name": "Jason Scott", "player1_faction": "Grey Knights", "player1_score": 65, "player2_id": "p_chris_y", "player2_name": "Chris Young", "player2_faction": "Death Guard", "player2_score": 63, "winner_id": "p_jason", "is_done": True, "status": "finished"}
                    ],
                    "players": [
                        {
                            "player_id": "p_roberto", "full_name": "Roberto Medina", "faction": "Adepta Sororitas", "detachment": "Bringers of Flame",
                            "team": "War Room Gladiator", "placement": 1, "event_wins": 3, "event_losses": 0, "event_draws": 0, "event_battle_points": 291,
                            "current_elo": 1566.4, "event_net_elo": 35.0, "has_list": False
                        },
                        {
                            "player_id": "p_junior", "full_name": "Junior Aflleje", "faction": "Leagues of Votann", "detachment": "Prioritised Target",
                            "team": "Team Zero Comp", "placement": 2, "event_wins": 3, "event_losses": 0, "event_draws": 0, "event_battle_points": 274,
                            "current_elo": 2190.8, "event_net_elo": 5.6, "has_list": True
                        },
                        {
                            "player_id": "p_culham", "full_name": "Culham Otton", "faction": "Astra Militarum", "detachment": "Reconnaissance Patrol",
                            "team": "Optimized Jank", "placement": 3, "event_wins": 2, "event_losses": 1, "event_draws": 0, "event_battle_points": 266,
                            "current_elo": 1659.5, "event_net_elo": -1.9, "has_list": True
                        },
                        {
                            "player_id": "p_aurelio", "full_name": "Aurelio Correa", "faction": "Dark Angels", "detachment": "Reconnaissance Company",
                            "team": "Team Zero Comp", "placement": 4, "event_wins": 2, "event_losses": 1, "event_draws": 0, "event_battle_points": 259,
                            "current_elo": 1788.2, "event_net_elo": 11.5, "has_list": True
                        },
                        {
                            "player_id": "p_ramon", "full_name": "Ramon Ortiz", "faction": "Chaos Space Marines", "detachment": "Raiders",
                            "team": "Vegas Vets", "placement": 5, "event_wins": 2, "event_losses": 1, "event_draws": 0, "event_battle_points": 245,
                            "current_elo": 1710.0, "event_net_elo": 8.2, "has_list": False
                        },
                        {
                            "player_id": "p_derek", "full_name": "Derek Williams", "faction": "Necrons", "detachment": "Canoptek Court",
                            "team": "Vegas Vets", "placement": 6, "event_wins": 2, "event_losses": 1, "event_draws": 0, "event_battle_points": 240,
                            "current_elo": 1620.0, "event_net_elo": 4.1, "has_list": True
                        },
                        {
                            "player_id": "p_anthony", "full_name": "Anthony Davis", "faction": "T'au Empire", "detachment": "Mont'ka",
                            "placement": 7, "event_wins": 2, "event_losses": 1, "event_draws": 0, "event_battle_points": 235,
                            "current_elo": 1580.0, "event_net_elo": 6.0, "has_list": False
                        },
                        {
                            "player_id": "p_michael", "full_name": "Michael Chang", "faction": "Tyranids", "detachment": "Invasion Fleet",
                            "placement": 8, "event_wins": 2, "event_losses": 1, "event_draws": 0, "event_battle_points": 228,
                            "current_elo": 1550.0, "event_net_elo": 3.5, "has_list": True
                        },
                        {
                            "player_id": "p_brian", "full_name": "Brian Miller", "faction": "Blood Angels", "detachment": "Sons of Sanguinius",
                            "placement": 9, "event_wins": 2, "event_losses": 1, "event_draws": 0, "event_battle_points": 220,
                            "current_elo": 1540.0, "event_net_elo": 2.1, "has_list": False
                        },
                        {
                            "player_id": "p_david_c", "full_name": "David Clark", "faction": "Orks", "detachment": "Da Big Hunt",
                            "placement": 10, "event_wins": 1, "event_losses": 2, "event_draws": 0, "event_battle_points": 205,
                            "current_elo": 1510.0, "event_net_elo": -8.0, "has_list": False
                        },
                        {
                            "player_id": "p_kevin", "full_name": "Kevin Wright", "faction": "Space Marines", "detachment": "Ironstorm Spearhead",
                            "placement": 11, "event_wins": 1, "event_losses": 2, "event_draws": 0, "event_battle_points": 198,
                            "current_elo": 1490.0, "event_net_elo": -5.5, "has_list": False
                        },
                        {
                            "player_id": "p_jason", "full_name": "Jason Scott", "faction": "Grey Knights", "detachment": "Teleport Strike Force",
                            "placement": 12, "event_wins": 1, "event_losses": 2, "event_draws": 0, "event_battle_points": 190,
                            "current_elo": 1475.0, "event_net_elo": -7.2, "has_list": False
                        },
                        {
                            "player_id": "p_thomas", "full_name": "Thomas Hall", "faction": "Adeptus Custodes", "detachment": "Shield Host",
                            "placement": 13, "event_wins": 1, "event_losses": 2, "event_draws": 0, "event_battle_points": 185,
                            "current_elo": 1460.0, "event_net_elo": -6.4, "has_list": False
                        },
                        {
                            "player_id": "p_chris_y", "full_name": "Chris Young", "faction": "Death Guard", "detachment": "Plague Company",
                            "placement": 14, "event_wins": 1, "event_losses": 2, "event_draws": 0, "event_battle_points": 178,
                            "current_elo": 1440.0, "event_net_elo": -9.1, "has_list": False
                        },
                        {
                            "player_id": "p_eric", "full_name": "Eric Allen", "faction": "Thousand Sons", "detachment": "Cult of Magic",
                            "placement": 15, "event_wins": 1, "event_losses": 2, "event_draws": 0, "event_battle_points": 170,
                            "current_elo": 1420.0, "event_net_elo": -11.0, "has_list": False
                        },
                        {
                            "player_id": "p_ryan", "full_name": "Ryan King", "faction": "World Eaters", "detachment": "Berzerker Warband",
                            "placement": 16, "event_wins": 0, "event_losses": 3, "event_draws": 0, "event_battle_points": 150,
                            "current_elo": 1390.0, "event_net_elo": -18.5, "has_list": False
                        },
                        {
                            "player_id": "p_justin", "full_name": "Justin Lee", "faction": "Genestealer Cults", "detachment": "Host of Ascension",
                            "placement": 17, "event_wins": 0, "event_losses": 3, "event_draws": 0, "event_battle_points": 142,
                            "current_elo": 1370.0, "event_net_elo": -20.2, "has_list": False
                        },
                        {
                            "player_id": "p_brandon", "full_name": "Brandon White", "faction": "Aeldari", "detachment": "Battle Host",
                            "placement": 18, "event_wins": 0, "event_losses": 3, "event_draws": 0, "event_battle_points": 135,
                            "current_elo": 1350.0, "event_net_elo": -22.0, "has_list": False
                        },
                        {
                            "player_id": "p_tyler_a", "full_name": "Tyler Adams", "faction": "Imperial Knights", "detachment": "Noble Lance",
                            "placement": 19, "event_wins": 0, "event_losses": 3, "event_draws": 0, "event_battle_points": 120,
                            "current_elo": 1320.0, "event_net_elo": -24.0, "has_list": False
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

            is_ctc = "ctc" in ev_param.lower() or "california" in ev_param.lower() or "dicehammer" in ev_param.lower()
            if is_ctc:
                res = {
                    "id": "ev_ctc_v",
                    "name": "California Team Championships V by Dicehammer",
                    "event_date": "2024-06-23",
                    "end_date": "2024-06-24",
                    "city": "Burbank",
                    "state": "CA",
                    "country": "United States",
                    "venue": "Burbank Marriott Convention Center",
                    "total_players": 190,
                    "num_rounds": 5,
                    "current_round": 5,
                    "is_ended": True,
                    "ended": True,
                    "started": True,
                    "status": {"ended": True, "isEnded": True, "started": True},
                    "players": [
                        {
                            "player_id": "Te1Q9lp3By",
                            "full_name": "Junior Aflleje",
                            "faction": "Leagues of Votann",
                            "detachment": "Prioritised Target",
                            "team": "Team Zero Comp",
                            "placement": 1,
                            "event_wins": 5,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_battle_points": 485,
                            "current_elo": 2190.8,
                            "event_net_elo": 32.5,
                            "has_list": True,
                            "army_list": "++ Leagues of Votann - Prioritised Target [2,000 pts] ++\nCharacters:\nKâhl [90 pts]: Appraising Glare (Warlord)\nEinhyr Champion [80 pts]: Grim Demeanour\nBattleline:\n10x Hearthkyn Warriors [100 pts]\n10x Hearthkyn Warriors [100 pts]\nVehicles & Exosuits:\n6x Einhyr Hearthguard [320 pts]: Volkanite disintegrators\n6x Einhyr Hearthguard [320 pts]: Concussion gauntlets\n3x Hernkyn Pioneers [90 pts]\n3x Hernkyn Pioneers [90 pts]\nHekaton Land Fortress [225 pts]: Heavy magna-rail cannon\nHekaton Land Fortress [225 pts]: SP conversion beamer"
                        },
                        {
                            "player_id": "9oEfu25ccjqE",
                            "full_name": "John Hsieh",
                            "faction": "Necrons",
                            "detachment": "Canoptek Court",
                            "team": "Team Zero Comp",
                            "placement": 2,
                            "event_wins": 5,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_battle_points": 472,
                            "current_elo": 1968.4,
                            "event_net_elo": 28.0,
                            "has_list": True
                        },
                        {
                            "player_id": "p_james_c",
                            "full_name": "James Carmona",
                            "faction": "Adeptus Custodes",
                            "detachment": "Shield Host",
                            "team": "Team Zero Comp",
                            "placement": 3,
                            "event_wins": 5,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_battle_points": 465,
                            "current_elo": 1845.0,
                            "event_net_elo": 24.5,
                            "has_list": True
                        },
                        {
                            "player_id": "p_jake_n",
                            "full_name": "Jake Nelson",
                            "faction": "Blood Angels",
                            "detachment": "Sons of Sanguinius",
                            "team": "Team Zero Comp",
                            "placement": 4,
                            "event_wins": 5,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_battle_points": 458,
                            "current_elo": 1820.0,
                            "event_net_elo": 22.0,
                            "has_list": True
                        },
                        {
                            "player_id": "p_jesse_s",
                            "full_name": "Jesse Sell",
                            "faction": "Aeldari",
                            "detachment": "Battle Host",
                            "team": "Team Zero Comp",
                            "placement": 5,
                            "event_wins": 5,
                            "event_losses": 0,
                            "event_draws": 0,
                            "event_battle_points": 450,
                            "current_elo": 1810.0,
                            "event_net_elo": 20.0,
                            "has_list": True
                        }
                    ],
                    "team_standings": [
                        {"team_name": "Team Zero Comp", "placement": 1, "wins": 5, "losses": 0, "draws": 0, "battle_points": 2330},
                        {"team_name": "Art of War", "placement": 2, "wins": 4, "losses": 1, "draws": 0, "battle_points": 2210},
                        {"team_name": "Stat Check", "placement": 3, "wins": 4, "losses": 1, "draws": 0, "battle_points": 2180}
                    ],
                    "matches": [
                        {"id": "m_ctc_1", "round": 5, "table_number": 1, "table": 1, "player1_id": "Te1Q9lp3By", "player1_name": "Junior Aflleje", "player1_faction": "Leagues of Votann", "player1_score": 98, "player2_id": "p_jack_h", "player2_name": "Jack Harpster", "player2_faction": "Blood Angels", "player2_score": 75, "winner_id": "Te1Q9lp3By", "is_done": True, "status": "finished"}
                    ]
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
                    "total_players": 480,
                    "num_rounds": 10,
                    "numberOfRounds": 10,
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

        if clean_path == "api/teams/my-team":
            import teams_hub_service
            svc = teams_hub_service.get_teams_hub_service()
            p_id = (query_params.get("player_id", [None])[0] or DEV_USER["user"].get("player_id") or "p_innes").strip()
            gs = (query_params.get("game_system", [None])[0] or "40k").strip().lower()
            aff = svc.get_player_affiliation(p_id)
            hub = None
            if aff and aff.get("team_id"):
                hub = svc.get_team_hub(aff["team_id"], gs)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({
                    "success": True,
                    "has_team": bool(aff and aff.get("team_id")),
                    "affiliation": aff,
                    "team": hub
                }).encode("utf-8"))
            return

        if clean_path == "api/teams/detected-history":
            import teams_hub_service
            svc = teams_hub_service.get_teams_hub_service()
            p_id = (query_params.get("player_id", [None])[0] or DEV_USER["user"].get("player_id") or "p_innes").strip()
            history = svc.get_player_detected_history(p_id)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "detected": history}).encode("utf-8"))
            return

        if clean_path.startswith("api/teams/") and not clean_path.endswith("/messages") and not clean_path.endswith("/squad-events/attend"):
            import teams_hub_service
            svc = teams_hub_service.get_teams_hub_service()
            t_id = urllib.parse.unquote(clean_path.split("/")[2])
            gs = (query_params.get("game_system", [None])[0] or "40k").strip().lower()
            hub = svc.get_team_hub(t_id, gs)
            if not hub:
                self.send_response(404)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                if not is_head:
                    self.wfile.write(json.dumps({"detail": f"Team {t_id} not found"}).encode("utf-8"))
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"success": True, "team": hub}).encode("utf-8"))
            return

        if clean_path.startswith("api/team/"):
            import teams_hub_service
            svc = teams_hub_service.get_teams_hub_service()
            team_target = urllib.parse.unquote(clean_path.split("/")[2])
            gs = (query_params.get("game_system", [None])[0] or "40k").strip().lower()
            hub = svc.get_team_hub(team_target, gs)
            if not hub:
                res = {"team": team_target, "roster": [], "stats": {}, "game_system": gs}
            else:
                res = {
                    "team": hub["name"],
                    "id": hub.get("id"),
                    "short_tag": hub.get("short_tag"),
                    "captain_name": hub.get("captain_name"),
                    "home_city": hub.get("home_city"),
                    "home_state": hub.get("home_state"),
                    "home_country": hub.get("home_country"),
                    "logo_url": hub.get("logo_url"),
                    "heraldry_tier": hub.get("heraldry_tier"),
                    "starting_5": hub.get("starting_5", []),
                    "battlefield_feed": hub.get("battlefield_feed", []),
                    "championships": hub.get("championships", {}),
                    "roster": hub.get("roster", []),
                    "stats": {
                        "roster_count": hub.get("roster_count", len(hub.get("roster", []))),
                        "active_roster_count": hub.get("active_roster_count", len(hub.get("roster", []))),
                        "power_rating": hub.get("power_rating", 0.0),
                        "combat_factor": hub.get("combat_factor", 1.0),
                        "avg_elo": hub.get("active_avg_elo", 1500.0),
                        "active_avg_elo": hub.get("active_avg_elo", 1500.0),
                        "top5_avg_elo": hub.get("top5_avg", 1500.0),
                        "top_player_elo": hub.get("top_player_elo", 1500.0),
                        "total_matches": hub.get("total_matches", 0),
                        "total_wins": hub.get("total_wins", 0),
                        "total_losses": hub.get("total_losses", 0),
                        "total_draws": hub.get("total_draws", 0),
                        "win_rate": hub.get("team_win_rate", 0.0),
                        "is_qualified": hub.get("is_qualified", True)
                    },
                    "game_system": gs
                }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path in ("api/teams", "api/teams/", "api/leaderboard/teams"):
            import teams_hub_service
            svc = teams_hub_service.get_teams_hub_service()
            p = int(query_params.get("page", [1])[0])
            ps = int(query_params.get("page_size", [25])[0])
            q = query_params.get("query", [None])[0] or query_params.get("search", [None])[0]
            sb = query_params.get("sort_by", ["power_rating"])[0]
            od = query_params.get("order", ["DESC"])[0]
            mr = int(query_params.get("min_roster", [1])[0])
            gs = (query_params.get("game_system", ["40k"])[0]).lower()
            res = svc.get_teams_leaderboard(
                game_system=gs,
                page=p,
                page_size=ps,
                query=q,
                sort_by=sb,
                order=od,
                min_roster=mr
            )
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
                    "matches_played": 137,
                    "win_rate": 87.6,
                    "team": "Art of War",
                    "factions": "Dark Angels, Space Marines (Astartes), Genestealer Cult, Chaos Space Marines, Adeptus Astartes, Tyranids, Aeldari, Blood Angels, Grey Knights, World Eaters, T'au Empire, Legion of the Damned, Elysian Drop Troops, Black Templars, Thousand Sons",
                    "top_faction": "Space Marines, Dark Angels",
                    "last_active": "2026-01-20",
                    "has_account": True
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
                    "matches_played": 166,
                    "win_rate": 87.3,
                    "team": "Art of War",
                    "factions": "Adeptus Custodes, Aeldari, Necrons, Drukhari, Imperial Agents, Chaos Space Marines, Ynnari, Death Guard, World Eaters",
                    "top_faction": "Adeptus Custodes, Aeldari",
                    "last_active": "2026-01-18",
                    "has_account": True
                },
                {
                    "rank": 3,
                    "player_id": "p_david_gaylard",
                    "player_name": "David Gaylard",
                    "current_elo": 2280.4,
                    "peak_elo": 2310.0,
                    "record": "98-18-0",
                    "wins": 98,
                    "losses": 18,
                    "draws": 0,
                    "matches_played": 116,
                    "win_rate": 84.5,
                    "team": "Team Zero Comp",
                    "top_faction": "Necrons, Custodes",
                    "last_active": "2026-01-15",
                    "has_account": False
                },
                {
                    "rank": 4,
                    "player_id": "p_jack_harpster",
                    "player_name": "Jack Harpster",
                    "current_elo": 2240.1,
                    "peak_elo": 2260.0,
                    "record": "85-22-1",
                    "wins": 85,
                    "losses": 22,
                    "draws": 1,
                    "matches_played": 108,
                    "win_rate": 78.7,
                    "team": "Art of War",
                    "top_faction": "Blood Angels",
                    "last_active": "2026-01-14",
                    "has_account": True
                },
                {
                    "rank": 5,
                    "player_id": "p_john_lennon",
                    "player_name": "John Lennon",
                    "current_elo": 2210.8,
                    "peak_elo": 2235.0,
                    "record": "110-28-2",
                    "wins": 110,
                    "losses": 28,
                    "draws": 2,
                    "matches_played": 140,
                    "win_rate": 78.6,
                    "team": "Art of War",
                    "top_faction": "Ultramarines",
                    "last_active": "2026-01-12",
                    "has_account": True
                },
                {
                    "rank": 6,
                    "player_id": "p_richard_siegler",
                    "player_name": "Richard Siegler",
                    "current_elo": 2195.0,
                    "peak_elo": 2240.0,
                    "record": "130-35-3",
                    "wins": 130,
                    "losses": 35,
                    "draws": 3,
                    "matches_played": 168,
                    "win_rate": 77.4,
                    "team": "Art of War",
                    "top_faction": "Adeptus Mechanicus",
                    "last_active": "2026-01-10",
                    "has_account": True
                },
                {
                    "rank": 7,
                    "player_id": "p_manning_feinleib",
                    "player_name": "Manning Feinleib",
                    "current_elo": 2170.2,
                    "peak_elo": 2190.0,
                    "record": "75-21-1",
                    "wins": 75,
                    "losses": 21,
                    "draws": 1,
                    "matches_played": 97,
                    "win_rate": 77.3,
                    "team": "Team Zero Comp",
                    "top_faction": "Tyranids",
                    "last_active": "2026-01-08",
                    "has_account": False
                }
            ]
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps({"players": players_data, "leaderboard": players_data, "items": players_data, "count": len(players_data), "total": len(players_data)}).encode("utf-8"))
            return

        if clean_path == "api/events":
            now_dt = datetime.now(timezone.utc)
            events_list = [
                {
                    "id": "ev_ongoing_gt_live",
                    "name": "Warhammer 40k US Open Series 2026 - Atlanta Major",
                    "event_date": (now_dt - timedelta(days=1)).strftime("%Y-%m-%d"),
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
                    "id": "73q0VFQZIVGo",
                    "name": "FLG Monthly 40K RTT - September",
                    "event_date": "2026-09-12",
                    "city": "Las Vegas",
                    "state": "NV",
                    "country": "United States",
                    "total_players": 19,
                    "num_rounds": 3,
                    "match_count": 22,
                    "is_ended": True,
                    "status": "ended"
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

        if clean_path in ("api/community/feed", "api/notifications/unread-count"):
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
                "tracker_history": [
                    {
                        "session_id": "trk_s26_01",
                        "game_system": "40k",
                        "date": "2026-02-14",
                        "completed": True,
                        "player_score": 92,
                        "opponent_score": 58,
                        "final_round": 5,
                        "rounds_completed": 5,
                        "secondary_points": 38,
                        "mode": "competitive"
                    },
                    {
                        "session_id": "trk_s26_02",
                        "game_system": "40k",
                        "date": "2026-03-05",
                        "completed": True,
                        "player_score": 88,
                        "opponent_score": 72,
                        "final_round": 5,
                        "rounds_completed": 5,
                        "secondary_points": 35,
                        "mode": "competitive"
                    },
                    {
                        "session_id": "trk_s26_03",
                        "game_system": "40k",
                        "date": "2026-04-12",
                        "completed": True,
                        "player_score": 79,
                        "opponent_score": 64,
                        "final_round": 5,
                        "rounds_completed": 5,
                        "secondary_points": 30,
                        "mode": "competitive"
                    }
                ],
                "army_lists": [
                    {
                        "id": "list_s26_01",
                        "name": "2026 Strike Force Vanguard",
                        "game_system": "40k",
                        "faction": "Space Marines",
                        "points": 2000,
                        "created_at": "2026-01-10T12:00:00Z"
                    },
                    {
                        "id": "list_s26_02",
                        "name": "Canoptek Swarm 2026",
                        "game_system": "40k",
                        "faction": "Necrons",
                        "points": 2000,
                        "created_at": "2026-02-01T15:30:00Z"
                    }
                ],
                "active_sessions": [],
                "events_attended": [
                    {
                        "event_id": "ev_tacoma_2026",
                        "event_name": "US Open Tacoma Major 2026",
                        "event_date": "2026-09-02",
                        "date": "2026-09-02",
                        "num_rounds": 7,
                        "rounds": 7,
                        "placement": 1,
                        "finish": 1,
                        "total_players": 128,
                        "wins": 7,
                        "losses": 0,
                        "draws": 0,
                        "registered_faction": "Adeptus Custodes",
                        "faction": "Adeptus Custodes",
                        "is_gt": True
                    },
                    {
                        "event_id": "ev_pnw_gt_2026",
                        "event_name": "Pacific Northwest GT 2026",
                        "event_date": "2026-06-15",
                        "date": "2026-06-15",
                        "num_rounds": 5,
                        "rounds": 5,
                        "placement": 1,
                        "finish": 1,
                        "total_players": 56,
                        "wins": 5,
                        "losses": 0,
                        "draws": 0,
                        "registered_faction": "Necrons",
                        "faction": "Necrons",
                        "is_gt": True
                    },
                    {
                        "event_id": "ev_dicehead_rtt_2026",
                        "event_name": "Dicehead Spring RTT 2026",
                        "event_date": "2026-03-22",
                        "date": "2026-03-22",
                        "num_rounds": 3,
                        "rounds": 3,
                        "placement": 1,
                        "finish": 1,
                        "total_players": 24,
                        "wins": 3,
                        "losses": 0,
                        "draws": 0,
                        "registered_faction": "Space Marines",
                        "faction": "Space Marines",
                        "is_gt": False
                    },
                    {
                        "event_id": "ev_active_lvo_2026",
                        "event_name": "LVO 2026 Warhammer 40K Champs",
                        "event_date": "2026-01-18",
                        "date": "2026-01-18",
                        "rounds": 5,
                        "finish": 4,
                        "total_players": 128,
                        "is_gt": True
                    }
                ],
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
            import badges
            req_game_sys = query_params.get("game_system", ["40k"])[0].lower() if "query_params" in locals() else "40k"
            user_pinned = DEV_USER.get("pinned_badges") if isinstance(DEV_USER, dict) else None
            b_eval = badges.evaluate_player_badges(
                player_data=res.get("player") or res,
                history=res.get("history") or [],
                tournaments=res.get("events_attended") or [],
                faction_mastery=res.get("faction_mastery") or [],
                matchup_matrix=res.get("matchup_matrix") or [],
                user_pinned_ids=user_pinned,
                game_system=req_game_sys,
                tracker_sessions=res.get("tracker_history") or [],
                registered_tournaments=res.get("registered_tournaments") or [],
                armylists=res.get("army_lists") or []
            )
            user_ack = DEV_USER.get("acknowledged_badge_ids") or []
            ack_set = set(user_ack)
            newly_unlocked = [b for b in b_eval["badges"] if b.get("unlocked") and b.get("id") not in ack_set]
            glory_state = _get_dev_user_glory_and_stats()
            glory_40k = glory_state["glory_40k"]
            glory_aos = glory_state["glory_aos"]
            total_earned = glory_state["total_earned"]
            spent = glory_state["glory_spent"]
            spendable = glory_state["spendable_glory"]

            res.update({
                "armory_vault": DEV_USER.get("armory_vault", {}),
                "equipped": DEV_USER.get("armory_vault", {}).get("equipped", {}),
                "badge_count": b_eval["badge_count"],
                "total_badges": b_eval["total_badges"],
                "completion_pct": b_eval["completion_pct"],
                "glory_score": b_eval["glory_score"],
                "career_glory": b_eval.get("career_glory", b_eval.get("glory_score", 0)),
                "glory_balance": spendable,
                "spendable_glory": spendable,
                "unified_glory": spendable,
                "total_glory": total_earned,
                "total_earned": total_earned,
                "glory_40k": glory_40k,
                "glory_aos": glory_aos,
                "glory_spent": spent,
                "seasonal": b_eval.get("seasonal", {}),
                "active_season": b_eval.get("active_season", "2026"),
                "rank": b_eval["rank"],
                "pinned_badges": b_eval["pinned_badges"],
                "badges_celebrated": bool(DEV_USER.get("badges_celebrated", False)),
                "acknowledged_badge_ids": list(ack_set),
                "newly_unlocked_badges": newly_unlocked,
                "badges": b_eval["badges"],
                "categories": b_eval["categories"],
                "championships": b_eval.get("championships", {}),
                "championship_glory": b_eval.get("championship_glory", 0),
                "championship_pill": (b_eval.get("championships") or {}).get("championship_pill")
            })
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        if clean_path in ("api/badges/catalog", "api/badges/catalog/"):
            import badges
            import seasonal_badges
            req_gs = query_params.get("game_system", ["40k"])[0].lower()
            is_aos = req_gs == "aos"
            seasonal_cat = seasonal_badges.SEASON_2026_CATALOG_AOS if is_aos else seasonal_badges.SEASON_2026_CATALOG_40K
            seasonal_cats = seasonal_badges.SEASONAL_CATEGORIES_AOS if is_aos else seasonal_badges.SEASONAL_CATEGORIES_40K
            catalog = {
                "success": True,
                "game_system": req_gs,
                "total": len(badges.get_all_badges_catalog(req_gs)),
                "categories": badges.get_categories(req_gs),
                "ranks": badges.get_ranks(req_gs),
                "badges": badges.get_all_badges_catalog(req_gs),
                "seasonal_catalog": seasonal_cat,
                "seasonal_categories": seasonal_cats,
                "active_season": "2026"
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                self.wfile.write(json.dumps(catalog).encode("utf-8"))
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

            if "sim_no_sub=1" in query_str or "no_sub=1" in query_str or self.headers.get("X-Sim-No-Sub") == "1" or "no_sub" in lid or "sub_req" in lid:
                has_bcp_auth = False
            elif "sim_sub=1" in query_str or "sub=1" in query_str or self.headers.get("X-Sim-Sub") == "1":
                has_bcp_auth = True
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            if not is_head:
                if not has_bcp_auth:
                    self.wfile.write(json.dumps({
                        "success": False,
                        "requires_bcp_link": True,
                        "error": "Best Coast Pairings subscription is required to view this roster",
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
            sys_val = "aos" if "game_system=aos" in query_str else "40k"
            tf_val = "1yr"
            if "timeframe=6mo" in query_str:
                tf_val = "6mo"
            elif "timeframe=all" in query_str:
                tf_val = "all"

            res = {
                "faction": fname,
                "game_system": sys_val,
                "timeframe": tf_val,
                "stats": {
                    "total_recent_sample": 64,
                    "recent_wins": 38,
                    "recent_losses": 24,
                    "recent_draws": 2,
                    "top_player_count": 5
                },
                "top_players": [
                    {"player_id": "p_innes", "player_name": "Innes Wilson", "team": "Art of War", "current_elo": 2185.4, "matches_played": 28, "wins": 24, "losses": 4, "draws": 0, "win_rate": 85.7, "avg_score": 89.2},
                    {"player_id": "p_david", "player_name": "David Gaylard", "team": "Team Zero Comp", "current_elo": 2120.0, "matches_played": 22, "wins": 17, "losses": 5, "draws": 0, "win_rate": 77.3, "avg_score": 83.1},
                    {"player_id": "p_jack", "player_name": "Jack Harpster", "team": "Art of War", "current_elo": 2095.8, "matches_played": 19, "wins": 14, "losses": 5, "draws": 0, "win_rate": 73.7, "avg_score": 81.4},
                    {"player_id": "p_vik", "player_name": "Vik Vijay", "team": "Team Ignite", "current_elo": 2042.1, "matches_played": 16, "wins": 11, "losses": 5, "draws": 0, "win_rate": 68.8, "avg_score": 79.5},
                    {"player_id": "p_liam", "player_name": "Liam Hackett", "team": "Down Under", "current_elo": 1998.0, "matches_played": 14, "wins": 9, "losses": 5, "draws": 0, "win_rate": 64.3, "avg_score": 77.0}
                ],
                "matches": [
                    {"id": "m_fac_1", "event_id": "ev_ongoing_gt_live", "event_name": "Warhammer Championship", "round": 5, "match_date": "2026-09-15", "player_id": "p_innes", "player_name": "Innes Wilson", "player_faction": fname, "player_score": 92, "opponent_id": "p_opp1", "opponent_name": "John Lennon", "opponent_faction": "Ultramarines", "opponent_score": 78, "outcome": "W"},
                    {"id": "m_fac_2", "event_id": "ev_ongoing_gt_live", "event_name": "Warhammer Championship", "round": 4, "match_date": "2026-09-15", "player_id": "p_innes", "player_name": "Innes Wilson", "player_faction": fname, "player_score": 85, "opponent_id": "p_opp2", "opponent_name": "David Gaylard", "opponent_faction": "Necrons", "opponent_score": 72, "outcome": "W"},
                    {"id": "m_fac_3", "event_id": "ev_ongoing_gt_live", "event_name": "Warhammer Championship", "round": 3, "match_date": "2026-09-15", "player_id": "p_innes", "player_name": "Innes Wilson", "player_faction": fname, "player_score": 90, "opponent_id": "p_opp3", "opponent_name": "Manny Cheema", "opponent_faction": "Aeldari", "opponent_score": 68, "outcome": "W"},
                    {"id": "m_fac_4", "event_id": "ev_ongoing_gt_live", "event_name": "Warhammer Championship", "round": 2, "match_date": "2026-09-14", "player_id": "p_david", "player_name": "David Gaylard", "player_faction": fname, "player_score": 65, "opponent_id": "p_opp4", "opponent_name": "Richard Siegler", "opponent_faction": "Adeptus Custodes", "opponent_score": 88, "outcome": "L"},
                    {"id": "m_fac_5", "event_id": "ev_ongoing_gt_live", "event_name": "Warhammer Championship", "round": 1, "match_date": "2026-09-14", "player_id": "p_jack", "player_name": "Jack Harpster", "player_faction": fname, "player_score": 75, "opponent_id": "p_opp5", "opponent_name": "Brad Chester", "opponent_faction": "Genestealer Cults", "opponent_score": 75, "outcome": "D"}
                ],
                "matchups": [
                    {"opponent_faction": "Necrons", "total_matches": 24, "wins": 15, "losses": 9, "draws": 0, "win_rate": 62.5},
                    {"opponent_faction": "Space Marines", "total_matches": 20, "wins": 12, "losses": 8, "draws": 0, "win_rate": 60.0},
                    {"opponent_faction": "Aeldari", "total_matches": 18, "wins": 10, "losses": 7, "draws": 1, "win_rate": 55.6},
                    {"opponent_faction": "Tyranids", "total_matches": 15, "wins": 8, "losses": 7, "draws": 0, "win_rate": 53.3},
                    {"opponent_faction": "Chaos Space Marines", "total_matches": 14, "wins": 7, "losses": 7, "draws": 0, "win_rate": 50.0},
                    {"opponent_faction": "Adeptus Custodes", "total_matches": 12, "wins": 4, "losses": 8, "draws": 0, "win_rate": 33.3}
                ]
            }
            res["stats"]["total_matches"] = sum(m.get("total_matches", 0) for m in res["matchups"])
            res["total_matches"] = res["stats"]["total_matches"]
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

        # 2. Redirects to /11th/tracker/play or Lobby
        if clean_path in ("", "login"):
            target = f"/11th/tracker/play{('?' + query_str) if query_str else ''}"
            self.send_response(302)
            self.send_header("Location", target)
            self.send_header("Set-Cookie", "session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax; HttpOnly")
            self.end_headers()
            return

        if clean_path in ("11th/tracker/lobby", "tracker/lobby", "11th/tracker", "tracker"):
            qp = urllib.parse.parse_qs(query_str)
            if qp.get("match_id") or qp.get("room") or qp.get("id") or qp.get("solo") or qp.get("play") or qp.get("eventId"):
                target = f"/11th/tracker/play{('?' + query_str) if query_str else ''}"
                self.send_response(302)
                self.send_header("Location", target)
                self.send_header("Set-Cookie", "session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax; HttpOnly")
                self.end_headers()
                return
            self._serve_html_with_auth(TRACKER_DIR / "lobby.html", is_head)
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

        # 3b. AoS Game Tracker Play SPA & Lobby
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
            is_play_session = bool(match_id) or bool(qp.get("solo", [None])[0]) or bool(qp.get("play", [None])[0])
            if is_play_session or clean_path == "tracker/aos.html":
                self._serve_html_with_auth(TRACKER_DIR / "aos.html", is_head)
            else:
                self._serve_html_with_auth(TRACKER_DIR / "lobby.html", is_head)
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
            self.send_header("Set-Cookie", "session_token=dev-auth-token-123; path=/; max-age=2592000; SameSite=Lax; HttpOnly")
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

            accept_enc = self.headers.get("Accept-Encoding", "")
            if "gzip" in accept_enc and len(content) > 1000:
                import gzip
                compressed = gzip.compress(content, compresslevel=6)
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(compressed)))
                self.end_headers()
                if not is_head:
                    self.wfile.write(compressed)
            else:
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
