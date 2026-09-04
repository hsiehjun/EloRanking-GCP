"""
Best Coast Pairings (BCP) newapi Decoupled Adapter
Provides typed, reliable, and fault-tolerant interactions with BCP's modern REST API.
"""
import os
import json
import logging
import urllib.request
import urllib.error
from typing import Optional, Dict, Any, Tuple

try:
    from google3.experimental.users.hsiehjun.EloRanking.config import (
        BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT
    )
except ImportError:
    try:
        from experimental.users.hsiehjun.EloRanking.config import (
            BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT
        )
    except ImportError:
        from config import BCP_API_BASE, DEFAULT_HEADERS, BCP_CLIENT_ID, BCP_USER_AGENT

logger = logging.getLogger("BcpAdapter")

class BcpAdapter:
    """
    Adapter for Best Coast Pairings newprod-api endpoints.
    Encapsulates token refresh, error handling, and domain mapping.
    """

    @staticmethod
    def execute_call(
        url: str,
        method: str = "POST",
        json_data: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Executes HTTP call to BCP API with Cognito token management and retry logic.
        """
        from core import get_auth_manager
        auth_mgr = get_auth_manager()

        tok = explicit_token
        if not tok and user_id:
            tok_dict = auth_mgr.get_valid_bcp_tokens(user_id)
            tok = tok_dict.get("access_token") or tok_dict.get("id_token")

        if not tok:
            logger.warning(f"⚠️ [BCP API] No BCP token available for {method} {url}")
            return None, "No BCP authorization token available"

        def _do_request(token_val: str) -> Tuple[Optional[Dict[str, Any]], Optional[int], Optional[str]]:
            clean_tok = token_val.replace("Bearer ", "").replace("bearer ", "").strip()
            headers = DEFAULT_HEADERS.copy()
            headers["Authorization"] = f"Bearer {clean_tok}"
            headers["Content-Type"] = "application/json"

            if json_data is not None:
                body_bytes = json.dumps(json_data).encode("utf-8")
            elif method in ("POST", "PUT", "PATCH", "DELETE"):
                body_bytes = b"{}"
            else:
                body_bytes = None

            req = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)

            try:
                with urllib.request.urlopen(req, timeout=12) as resp:
                    raw = resp.read().decode("utf-8")
                    data = json.loads(raw) if raw else {}
                    logger.info(f"✅ [BCP API SUCCESS {resp.status}] {method} {url}")
                    return data, resp.status, None
            except urllib.error.HTTPError as he:
                err_body = he.read().decode("utf-8", errors="ignore")
                return None, he.code, f"HTTP {he.code}: {err_body}"
            except Exception as e:
                logger.warning(f"⚠️ [BCP API Network Error] {method} {url}: {e}")
                return None, 0, str(e)

        # 1. Primary Request
        data, status, err = _do_request(tok)
        if data is not None:
            return data, None

        # 2. If 401 or 403, retry with alternate token (id_token vs access_token) or force-refresh
        if status in (401, 403) and user_id:
            logger.info(f"🔄 [BCP API] Status {status} on {method} {url}. Attempting token retry / refresh...")
            tok_dict = auth_mgr.get_valid_bcp_tokens(user_id)
            alt_tok = tok_dict.get("id_token") if tok == tok_dict.get("access_token") else tok_dict.get("access_token")
            if alt_tok and alt_tok != tok:
                data, status, err = _do_request(alt_tok)
                if data is not None:
                    return data, None

            fresh_dict = auth_mgr.get_valid_bcp_tokens(user_id, force_refresh=True)
            for cand_tok in [fresh_dict.get("access_token"), fresh_dict.get("id_token")]:
                if cand_tok and cand_tok != tok and cand_tok != alt_tok:
                    data, status, err = _do_request(cand_tok)
                    if data is not None:
                        return data, None

        if err:
            logger.warning(f"⚠️ [BCP API Failed] {method} {url}: {err}")
        return None, err

    @classmethod
    def start_event_or_generate_pairings(
        cls,
        event_id: str,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None,
        is_league: bool = False
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Starts tournament and generates Round 1 Swiss pairings on BCP newapi.
        """
        # 1. Primary endpoint used by new-orgs: POST /v1/events/{id}/generatePairings
        gen_url = f"{BCP_API_BASE}/events/{event_id}/generatePairings"
        data, err = cls.execute_call(gen_url, method="POST", user_id=user_id, explicit_token=explicit_token)
        if data is not None or not err:
            logger.info(f"✅ Successfully generated pairings and started BCP event {event_id} via /generatePairings")
            return True, None, data

        # 2. Fallback for leagues: POST /v1/events/{id}/setCurrentRound
        if is_league:
            round_url = f"{BCP_API_BASE}/events/{event_id}/setCurrentRound"
            data2, err2 = cls.execute_call(round_url, method="POST", json_data={"round": 1}, user_id=user_id, explicit_token=explicit_token)
            if data2 is not None or not err2:
                logger.info(f"✅ Advanced BCP league event {event_id} to round 1 via /setCurrentRound")
                return True, None, data2

        # 3. Fallback: Status update POST /v1/events/{id}
        status_url = f"{BCP_API_BASE}/events/{event_id}"
        status_payload = {
            "set": {"started": True, "status": "active", "activeRound": 1},
            "started": True,
            "status": "active"
        }
        data3, err3 = cls.execute_call(status_url, method="POST", json_data=status_payload, user_id=user_id, explicit_token=explicit_token)
        if data3 is not None or not err3:
            logger.info(f"✅ Updated BCP event {event_id} status to active via /events/{event_id}")
            return True, None, data3

        return False, (err or "Failed to start event on BCP"), None

    @classmethod
    def register_player(
        cls,
        event_id: str,
        player_data: Dict[str, Any],
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None,
        is_team: bool = False
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Registers or adds a player/team to an event roster using BCP's modern /players endpoint.
        """
        endpoint = "teamplayers" if is_team else "players"
        reg_url = f"{BCP_API_BASE}/{endpoint}"

        # Construct BCP payload matching new-orgs schema
        checked_in = bool(player_data.get("checked_in") or player_data.get("checkedIn") or False)
        bcp_user_id = player_data.get("bcp_user_id") or player_data.get("user_id")

        bcp_payload: Dict[str, Any] = {
            "eventId": event_id,
            "checkedIn": checked_in,
        }

        if bcp_user_id:
            bcp_payload["userId"] = str(bcp_user_id)
        else:
            fn = player_data.get("first_name") or player_data.get("firstName") or ""
            ln = player_data.get("last_name") or player_data.get("lastName") or ""
            if not fn and not ln and player_data.get("name"):
                parts = player_data["name"].strip().split(" ", 1)
                fn = parts[0]
                ln = parts[1] if len(parts) > 1 else ""
            bcp_payload["user"] = {
                "firstName": fn or "Competitor",
                "lastName": ln or "",
                "email": player_data.get("email") or ""
            }

        faction = player_data.get("faction") or player_data.get("army")
        if faction:
            bcp_payload["army"] = faction
            bcp_payload["faction"] = faction
        if player_data.get("detachment"):
            bcp_payload["detachment"] = player_data["detachment"]
        if player_data.get("team"):
            bcp_payload["team"] = player_data["team"]
        if player_data.get("army_list") or player_data.get("armyList"):
            bcp_payload["armyList"] = player_data.get("army_list") or player_data.get("armyList")

        # 1. Primary: POST /v1/players (or /teamplayers)
        data, err = cls.execute_call(reg_url, method="POST", json_data=bcp_payload, user_id=user_id, explicit_token=explicit_token)
        if data is not None or not err:
            logger.info(f"✅ Registered competitor to BCP event {event_id} via /{endpoint}")
            return True, None, data

        # 2. Fallback: Nested /events/{id}/players for legacy compatibility
        legacy_url = f"{BCP_API_BASE}/events/{event_id}/{endpoint}"
        data2, err2 = cls.execute_call(legacy_url, method="POST", json_data=bcp_payload, user_id=user_id, explicit_token=explicit_token)
        if data2 is not None or not err2:
            logger.info(f"✅ Registered competitor to BCP event {event_id} via legacy /events/{event_id}/{endpoint}")
            return True, None, data2

        return False, (err or err2 or "BCP roster registration failed"), None

    @classmethod
    def submit_pairing_scores(
        cls,
        pairing_id: str,
        p1_score: int,
        p2_score: int,
        game_data: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str]]:
        """
        Submits match scores to BCP for a specific pairing using newapi submitScores endpoint.
        """
        clean_pid = str(pairing_id or "").strip()
        if not clean_pid:
            return False, "Missing pairing_id for BCP score submission"

        url = f"{BCP_API_BASE}/pairings/{clean_pid}/submitScores"
        payload: Dict[str, Any] = {
            "pairingType": "Pairing",
            "gameData": {
                "player1Score": int(p1_score),
                "player2Score": int(p2_score),
                "metrics": []
            }
        }
        if game_data and isinstance(game_data, dict):
            payload["gameData"].update(game_data)

        data, err = cls.execute_call(url, method="POST", json_data=payload, user_id=user_id, explicit_token=explicit_token)
        if data is not None or not err:
            logger.info(f"✅ Successfully submitted scores to BCP for pairing {clean_pid}")
            return True, None
        return False, err

    @classmethod
    def swap_pairing_players(
        cls,
        pairing_id: str,
        is_player_one: bool,
        player_id: str,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str]]:
        """
        Swaps player between tables using BCP newapi /pairings/{id}/swapPlayers.
        """
        clean_pid = str(pairing_id or "").strip()
        url = f"{BCP_API_BASE}/pairings/{clean_pid}/swapPlayers"
        payload = {
            "pairingType": "Pairing",
            "isPlayerOne": bool(is_player_one),
            "playerId": str(player_id)
        }
        data, err = cls.execute_call(url, method="POST", json_data=payload, user_id=user_id, explicit_token=explicit_token)
        if data is not None or not err:
            return True, None
        return False, err

    @classmethod
    def finalize_round(
        cls,
        event_id: str,
        round_num: int,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str]]:
        """
        Finalizes active round on BCP, advancing to next round.
        """
        url = f"{BCP_API_BASE}/events/{event_id}/finalizeRound"
        data, err = cls.execute_call(url, method="POST", json_data={"round": int(round_num)}, user_id=user_id, explicit_token=explicit_token)
        if data is not None or not err:
            return True, None
        return False, err

# Module-level instance
bcp_adapter = BcpAdapter()
