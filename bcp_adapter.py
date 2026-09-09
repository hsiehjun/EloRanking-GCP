"""
Best Coast Pairings (BCP) newapi Decoupled Adapter
Provides typed, reliable, and fault-tolerant interactions with BCP's modern REST API.
"""
import os
import time
import json
import logging
import urllib.request
import urllib.error
from typing import Optional, Dict, Any, Tuple, List

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
    _factions_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}

    @staticmethod
    def execute_call(
        url: str,
        method: str = "POST",
        json_data: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None,
        allow_unauthenticated: bool = False
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Executes HTTP call to BCP API with Cognito token management and retry logic.
        """
        tok = explicit_token
        if not tok and user_id:
            try:
                from core import get_auth_manager
                auth_mgr = get_auth_manager()
                tok_dict = auth_mgr.get_valid_bcp_tokens(user_id)
                tok = tok_dict.get("id_token") or tok_dict.get("access_token")
            except Exception as auth_err:
                logger.warning(f"Notice retrieving BCP tokens for user {user_id}: {auth_err}")

        def _do_request(token_val: Optional[str] = None) -> Tuple[Optional[Dict[str, Any]], Optional[int], Optional[str]]:
            headers = DEFAULT_HEADERS.copy()
            if token_val:
                clean_tok = token_val.replace("Bearer ", "").replace("bearer ", "").strip()
                headers["Authorization"] = f"Bearer {clean_tok}"
            headers["Content-Type"] = "application/json"

            if json_data is not None:
                body_bytes = json.dumps(json_data).encode("utf-8")
                headers["Content-Type"] = "application/json"
                headers["Content-Length"] = str(len(body_bytes))
            elif method in ("POST", "PUT", "PATCH"):
                body_bytes = b""
                headers["Content-Type"] = "application/json"
                headers["Content-Length"] = "0"
            else:
                body_bytes = None

            req = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)

            try:
                with urllib.request.urlopen(req, timeout=12) as resp:
                    raw = resp.read().decode("utf-8")
                    data = json.loads(raw) if raw and raw.strip() else {}
                    logger.info(f"✅ [BCP API SUCCESS {resp.status}] {method} {url}")
                    return data, resp.status, None
            except urllib.error.HTTPError as he:
                err_body = he.read().decode("utf-8", errors="ignore")
                return None, he.code, f"HTTP {he.code}: {err_body}"
            except Exception as e:
                logger.warning(f"⚠️ [BCP API Network Error] {method} {url}: {e}")
                return None, 0, str(e)

        if not tok:
            if not allow_unauthenticated:
                logger.warning(f"⚠️ [BCP API] No BCP token available for {method} {url}")
                return None, "No BCP authorization token available"
            data, status, err = _do_request(None)
            if data is not None or status in (200, 201, 204):
                return data if data is not None else {}, None
            if err:
                logger.warning(f"⚠️ [BCP API Failed] {method} {url}: {err}")
            return None, err

        # 1. Primary Request
        data, status, err = _do_request(tok)
        if data is not None or status in (200, 201, 204):
            return data if data is not None else {}, None

        # 2. If 401 or 403, retry with fresh token
        if status in (401, 403) and user_id:
            logger.info(f"🔄 [BCP API] Status {status} on {method} {url}. Attempting token retry / refresh...")
            try:
                from core import get_auth_manager
                auth_mgr = get_auth_manager()
                tok_dict = auth_mgr.get_valid_bcp_tokens(user_id)
                id_tok = tok_dict.get("id_token")
                acc_tok = tok_dict.get("access_token")
                candidates = [t for t in [id_tok, acc_tok] if t and t != tok]
                for cand in candidates:
                    data, status, err = _do_request(cand)
                    if data is not None or status in (200, 201, 204):
                        return data if data is not None else {}, None

                # Force refresh from /oauth/token if initial tokens failed
                fresh_dict = auth_mgr.get_valid_bcp_tokens(user_id, force_refresh=True)
                fresh_id = fresh_dict.get("id_token")
                fresh_acc = fresh_dict.get("access_token")
                for fresh_cand in [fresh_id, fresh_acc]:
                    if fresh_cand and fresh_cand != tok and fresh_cand not in candidates:
                        data, status, err = _do_request(fresh_cand)
                        if data is not None or status in (200, 201, 204):
                            return data if data is not None else {}, None
            except Exception as ref_err:
                logger.warning(f"Notice during token retry / refresh for user {user_id}: {ref_err}")

        # 3. Fallback to unauthenticated if allowed
        if allow_unauthenticated:
            logger.info(f"🔄 [BCP API] Primary request failed ({err}). Falling back to unauthenticated {method} {url}...")
            data_unauth, status_unauth, err_unauth = _do_request(None)
            if data_unauth is not None or status_unauth in (200, 201, 204):
                return data_unauth if data_unauth is not None else {}, None
            if err_unauth:
                err = err_unauth

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
    def get_pairings_status(
        cls,
        event_id: str,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Polls BCP newapi GET /v1/events/{id}/pairingsStatus.
        Returns: (success, error_str, status_dict)
        """
        clean_eid = str(event_id).strip()
        url = f"{BCP_API_BASE}/events/{clean_eid}/pairingsStatus"
        data, err = cls.execute_call(url, method="GET", user_id=user_id, explicit_token=explicit_token, allow_unauthenticated=True)
        if data is not None or not err:
            return True, None, (data or {})
        return False, (err or "Failed to fetch pairings status"), None

    @classmethod
    def fetch_event_pairings(
        cls,
        event_id: str,
        round_num: int = 1,
        pairing_type: str = "Pairing",
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str], List[Dict[str, Any]]]:
        """
        Fetches round pairings from BCP API for a tournament round.
        Returns: (success, error_str, list_of_pairings)
        """
        clean_eid = str(event_id or "").strip()
        if not clean_eid:
            return False, "Missing event_id", []

        url_candidates = [
            f"{BCP_API_BASE}/pairings?eventId={clean_eid}&round={round_num}&pairingType={pairing_type}&limit=500&expand[]=player&expand[]=teamPlayer",
            f"{BCP_API_BASE}/pairings?eventId={clean_eid}&round={round_num}&pairingType={pairing_type}",
            f"{BCP_API_BASE}/events/{clean_eid}/pairings?round={round_num}&pairingType={pairing_type}"
        ]
        for url in url_candidates:
            data, err = cls.execute_call(
                url=url,
                method="GET",
                user_id=user_id,
                explicit_token=explicit_token,
                allow_unauthenticated=True
            )
            if data and isinstance(data, dict):
                active = data.get("data") or data.get("active") or []
                if isinstance(active, list) and active:
                    return True, None, active
            elif isinstance(data, list) and data:
                return True, None, data

        # Fallback to TeamPairing if singles is empty
        if pairing_type == "Pairing":
            url_team_candidates = [
                f"{BCP_API_BASE}/pairings?eventId={clean_eid}&round={round_num}&pairingType=TeamPairing&limit=500&expand[]=player&expand[]=teamPlayer",
                f"{BCP_API_BASE}/pairings?eventId={clean_eid}&round={round_num}&pairingType=TeamPairing",
                f"{BCP_API_BASE}/events/{clean_eid}/pairings?round={round_num}&pairingType=TeamPairing"
            ]
            for url_team in url_team_candidates:
                t_data, t_err = cls.execute_call(
                    url=url_team,
                    method="GET",
                    user_id=user_id,
                    explicit_token=explicit_token,
                    allow_unauthenticated=True
                )
                if t_data and isinstance(t_data, dict):
                    active = t_data.get("data") or t_data.get("active") or []
                    if isinstance(active, list) and active:
                        return True, None, active
                elif isinstance(t_data, list) and t_data:
                    return True, None, t_data

        # Fallback to scraper if execute_call returned empty
        try:
            from scraper import BestCoastPairingsScraper
            scraper = BestCoastPairingsScraper(db=None)
            items = scraper.fetch_event_pairings_for_round(clean_eid, round_num, pairing_type)
            if items:
                return True, None, items
        except Exception:
            pass

        return True, None, []

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
        }
        if checked_in:
            bcp_payload["checkedIn"] = True

        fn = player_data.get("first_name") or player_data.get("firstName") or ""
        ln = player_data.get("last_name") or player_data.get("lastName") or ""
        if not fn and not ln and player_data.get("name"):
            parts = str(player_data["name"]).strip().split(" ", 1)
            fn = parts[0]
            ln = parts[1] if len(parts) > 1 else ""
        bcp_payload["user"] = {
            "firstName": fn or "Competitor",
            "lastName": ln or "",
            "email": player_data.get("email") or ""
        }

        faction = player_data.get("faction") or player_data.get("army")
        if faction and faction not in ("Unassigned", "Unknown"):
            bcp_payload["army"] = faction
            bcp_payload["faction"] = faction
        if player_data.get("detachment"):
            bcp_payload["detachment"] = player_data["detachment"]
        team = player_data.get("team") or player_data.get("teamName")
        if team:
            bcp_payload["team"] = team
            bcp_payload["teamName"] = team
        if player_data.get("army_list") or player_data.get("armyList"):
            bcp_payload["armyList"] = player_data.get("army_list") or player_data.get("armyList")

        system_id = player_data.get("system_id") or player_data.get("systemId") or player_data.get("itc_id") or player_data.get("itcId") or player_data.get("itc_pin")
        if system_id:
            bcp_payload["systemId"] = str(system_id).strip()
            bcp_payload["itcId"] = str(system_id).strip()

        access_code = player_data.get("access_code") or player_data.get("accessCode")
        if access_code:
            code_str = str(access_code).strip()
            if code_str:
                bcp_payload["accessCode"] = code_str
                if "user" in bcp_payload and isinstance(bcp_payload["user"], dict):
                    bcp_payload["user"]["accessCode"] = code_str

        # Check if competitor is already on BCP event roster before calling API
        def _check_already_registered():
            try:
                try:
                    from google3.experimental.users.hsiehjun.EloRanking.scraper import BestCoastPairingsScraper
                except ImportError:
                    try:
                        from experimental.users.hsiehjun.EloRanking.scraper import BestCoastPairingsScraper
                    except ImportError:
                        from scraper import BestCoastPairingsScraper
                from unittest.mock import MagicMock
                try:
                    scraper = BestCoastPairingsScraper()
                except Exception:
                    scraper = BestCoastPairingsScraper(db=MagicMock())
                roster = scraper.fetch_event_players(event_id)
                check_fn = (fn or "").strip().lower()
                check_ln = (ln or "").strip().lower()
                check_name = f"{check_fn} {check_ln}".strip()
                check_email = (player_data.get("email") or "").strip().lower()
                for p in (roster or []):
                    u = p.get("user") or {}
                    p_fn = (u.get("firstName") or p.get("firstName") or "").strip().lower()
                    p_ln = (u.get("lastName") or p.get("lastName") or "").strip().lower()
                    p_name = (p.get("name") or f"{p_fn} {p_ln}").strip().lower()
                    p_email = (u.get("email") or p.get("email") or "").strip().lower()
                    if check_email and p_email and check_email == p_email:
                        return True, p
                    if check_fn and check_ln and p_fn == check_fn and p_ln == check_ln:
                        return True, p
                    if check_name and p_name and check_name == p_name:
                        return True, p
            except Exception as ex:
                logger.debug(f"BCP existing roster check notice: {ex}")
            return False, None

        # 1. Primary: POST /v1/players (or /teamplayers)
        data, err = cls.execute_call(reg_url, method="POST", json_data=bcp_payload, user_id=user_id, explicit_token=explicit_token, allow_unauthenticated=True)
        if data is not None or not err:
            logger.info(f"✅ Registered competitor to BCP event {event_id} via /{endpoint}")
            return True, None, data

        if err and ("already exists" in err.lower() or "already registered" in err.lower()):
            logger.info(f"ℹ️ Competitor already registered in BCP event {event_id}")
            return True, None, {"already_registered": True}

        # 2. Fallback: Nested /events/{id}/players for legacy compatibility
        legacy_url = f"{BCP_API_BASE}/events/{event_id}/{endpoint}"
        data2, err2 = cls.execute_call(legacy_url, method="POST", json_data=bcp_payload, user_id=user_id, explicit_token=explicit_token, allow_unauthenticated=True)
        if data2 is not None or not err2:
            logger.info(f"✅ Registered competitor to BCP event {event_id} via legacy /events/{event_id}/{endpoint}")
            return True, None, data2

        if err2 and ("already exists" in err2.lower() or "already registered" in err2.lower()):
            logger.info(f"ℹ️ Competitor already registered in BCP event {event_id}")
            return True, None, {"already_registered": True}

        # Final check: did the registration succeed despite an error response?
        is_already_after, reg_p_after = _check_already_registered()
        if is_already_after:
            logger.info(f"ℹ️ Competitor {fn} {ln} confirmed registered on BCP event {event_id}")
            return True, None, {"already_registered": True, "player": reg_p_after}

        return False, (err or err2 or "BCP roster registration failed"), None

    @classmethod
    def delete_player(
        cls,
        player_id: str,
        event_id: Optional[str] = None,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None,
        is_team: bool = False
    ) -> Tuple[bool, Optional[str]]:
        """
        Removes a competitor or team from a BCP event roster using DELETE /v1/players/{id}.
        """
        clean_pid = str(player_id or "").strip()
        if not clean_pid:
            return False, "Missing player_id for BCP player removal"

        endpoint = "teamplayers" if is_team else "players"
        url = f"{BCP_API_BASE}/{endpoint}/{clean_pid}"

        # 1. Primary: DELETE /v1/players/{id}
        data, err = cls.execute_call(url, method="DELETE", user_id=user_id, explicit_token=explicit_token)
        if data is not None or not err:
            logger.info(f"✅ Successfully deleted competitor {clean_pid} from BCP via DELETE /{endpoint}/{clean_pid}")
            return True, None

        # 2. Fallback: teamplayers if players failed, or vice versa
        alt_endpoint = "players" if is_team else "teamplayers"
        alt_url = f"{BCP_API_BASE}/{alt_endpoint}/{clean_pid}"
        data2, err2 = cls.execute_call(alt_url, method="DELETE", user_id=user_id, explicit_token=explicit_token)
        if data2 is not None or not err2:
            logger.info(f"✅ Successfully deleted competitor {clean_pid} from BCP via DELETE /{alt_endpoint}/{clean_pid}")
            return True, None

        # 3. Fallback: Legacy /events/{event_id}/{endpoint}/{player_id} if event_id provided
        if event_id:
            clean_eid = str(event_id).strip()
            legacy_url = f"{BCP_API_BASE}/events/{clean_eid}/{endpoint}/{clean_pid}"
            data3, err3 = cls.execute_call(legacy_url, method="DELETE", user_id=user_id, explicit_token=explicit_token)
            if data3 is not None or not err3:
                logger.info(f"✅ Successfully deleted competitor {clean_pid} from BCP via DELETE /events/{clean_eid}/{endpoint}/{clean_pid}")
                return True, None

        return False, (err or err2 or "Failed to remove player from BCP")

    @classmethod
    def fetch_gamesystem_factions(
        cls,
        gamesystem_id: str = "WGMSzfKFYA"
    ) -> Tuple[bool, Optional[str], List[Dict[str, Any]]]:
        """
        Fetches the list of official factions and their subfactions (detachments)
        for a gamesystem from BCP GET /v1/gamesystems/{system_id}/factions.
        Caches in-memory with a 24-hour TTL.
        """
        clean_sid = str(gamesystem_id or "WGMSzfKFYA").strip()
        now = time.time()
        if clean_sid in cls._factions_cache:
            ts, cached_factions = cls._factions_cache[clean_sid]
            if (now - ts) < 86400:
                return True, None, cached_factions

        url = f"{BCP_API_BASE}/gamesystems/{clean_sid}/factions?limit=100&active=true"
        data, err = cls.execute_call(url, method="GET", allow_unauthenticated=True)
        if data is not None or not err:
            items = data.get("data") if isinstance(data, dict) and "data" in data else (
                data if isinstance(data, list) else []
            )
            cls._factions_cache[clean_sid] = (now, items)
            logger.info(f"✅ Fetched and cached {len(items)} factions for gamesystem {clean_sid} from BCP")
            return True, None, items

        return False, (err or f"Failed to fetch factions for gamesystem {clean_sid}"), []

    @classmethod
    def update_player(
        cls,
        player_id: str,
        set_fields: Dict[str, Any],
        unset_fields: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Updates an existing player registration on BCP via POST /v1/players/{player_id}
        using MongoDB-style set and unset maps.
        """
        clean_pid = str(player_id or "").strip()
        if not clean_pid:
            return False, "Missing player_id for player update", None

        url = f"{BCP_API_BASE}/players/{clean_pid}"
        payload: Dict[str, Any] = {
            "set": set_fields or {}
        }
        if unset_fields:
            payload["unset"] = unset_fields

        data, err = cls.execute_call(url, method="POST", json_data=payload, user_id=user_id, explicit_token=explicit_token)
        if data is not None or not err:
            logger.info(f"✅ Successfully updated player {clean_pid} on BCP via POST /players/{clean_pid}")
            return True, None, (data if data is not None else {})

        return False, (err or f"Failed to update player {clean_pid} on BCP"), None

    @classmethod
    def submit_armylist(
        cls,
        player_id: str,
        list_text: str,
        army_id: Optional[str] = None,
        sub_faction_id: Optional[str] = None,
        send_notification: bool = True,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Submits or updates an army list on BCP via POST /v1/armylists.
        """
        clean_pid = str(player_id or "").strip()
        if not clean_pid:
            return False, "Missing player_id for army list submission", None

        url = f"{BCP_API_BASE}/armylists"
        payload: Dict[str, Any] = {
            "playerId": clean_pid,
            "sendNotification": bool(send_notification),
            "listInfo": {
                "listText": str(list_text or "").strip()
            }
        }
        if army_id:
            payload["armyId"] = str(army_id).strip()
        if sub_faction_id:
            payload["subFactionId"] = str(sub_faction_id).strip()

        data, err = cls.execute_call(url, method="POST", json_data=payload, user_id=user_id, explicit_token=explicit_token)
        if data is not None or not err:
            logger.info(f"✅ Successfully submitted army list for player {clean_pid} to BCP via POST /armylists")
            return True, None, (data if data is not None else {})

        return False, (err or "Failed to submit army list to BCP"), None

    @classmethod
    def checkin_player(
        cls,
        player_id: str,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Checks in a competitor to a tournament on BCP via POST /v1/players/{player_id} with {"set": {"checkedIn": True}}.
        """
        clean_pid = str(player_id or "").strip()
        if not clean_pid:
            return False, "Missing player_id for player check-in", None

        # Primary update: set checkedIn = true
        ok, err, data = cls.update_player(clean_pid, set_fields={"checkedIn": True}, user_id=user_id, explicit_token=explicit_token)
        if ok:
            logger.info(f"✅ Checked in player {clean_pid} to BCP")
            return True, None, data

        # Fallback check-in subroute if update returned 404 or method issue
        alt_url = f"{BCP_API_BASE}/players/{clean_pid}/checkin"
        data_alt, err_alt = cls.execute_call(alt_url, method="POST", json_data={}, user_id=user_id, explicit_token=explicit_token)
        if data_alt is not None or not err_alt:
            logger.info(f"✅ Checked in player {clean_pid} via alt /checkin")
            return True, None, (data_alt if data_alt is not None else {})

        return False, (err or err_alt or "BCP check-in failed"), None

    @classmethod
    def drop_player(
        cls,
        player_id: str,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Drops a competitor from a tournament on BCP via POST /v1/players/{player_id} with {"set": {"dropped": True}}.
        """
        clean_pid = str(player_id or "").strip()
        if not clean_pid:
            return False, "Missing player_id for player drop", None

        ok, err, data = cls.update_player(clean_pid, set_fields={"dropped": True}, user_id=user_id, explicit_token=explicit_token)
        if ok:
            logger.info(f"✅ Dropped player {clean_pid} on BCP")
            return True, None, data

        return False, (err or "BCP player drop failed"), None

    @classmethod
    def fetch_armylist(
        cls,
        list_id: str,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Fetches an army list from BCP via GET /v1/armylists/{list_id}.
        Returns (success, error, data).
        """
        clean_lid = str(list_id or "").strip()
        if not clean_lid:
            return False, "Missing list_id", None

        url = f"{BCP_API_BASE}/armylists/{clean_lid}"
        data, err = cls.execute_call(url, method="GET", user_id=user_id, explicit_token=explicit_token, allow_unauthenticated=True)
        if data and isinstance(data, dict):
            return True, None, data
        return False, (err or "Failed to fetch army list from BCP"), None

    @classmethod
    def fetch_event_current_player(
        cls,
        event_id: str,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Fetches the authenticated user's current tournament player registration from BCP
        via GET /v1/events/{event_id}/currentPlayer.
        If listId is present in response, also queries /v1/armylists/{listId} to fetch full armyListText.
        """
        clean_eid = str(event_id or "").strip()
        if not clean_eid:
            return False, "Missing event_id", None

        url = f"{BCP_API_BASE}/events/{clean_eid}/currentPlayer"
        data, err = cls.execute_call(url, method="GET", user_id=user_id, explicit_token=explicit_token)
        if not data or not isinstance(data, dict) or not data.get("id"):
            return False, (err or "No current player found for event"), None

        # If listId is present and armyListText is not yet populated, fetch from /v1/armylists/{listId}
        list_id = str(data.get("listId") or "").strip()
        if list_id and not data.get("armyListText"):
            try:
                ok_list, _, list_data = cls.fetch_armylist(list_id, user_id=user_id, explicit_token=explicit_token)
                if ok_list and list_data and isinstance(list_data, dict):
                    data["armyListText"] = list_data.get("armyListText") or list_data.get("listText") or ""
                    if not data.get("armyId") and list_data.get("armyId"):
                        data["armyId"] = list_data.get("armyId")
                    if not data.get("subFactionId") and list_data.get("subFactionId"):
                        data["subFactionId"] = list_data.get("subFactionId")
            except Exception as ex:
                logger.debug(f"Notice fetching army list {list_id} for current player: {ex}")

        return True, None, data

    @classmethod
    def resolve_event_player_id(
        cls,
        event_id: str,
        user_id: Optional[str] = None,
        candidate_pid: Optional[str] = None,
        explicit_token: Optional[str] = None,
        ignore_candidate: bool = False
    ) -> Optional[str]:
        """
        Resolves the authentic BCP tournament player record ID (e.g. '9oEfu25ccjqE')
        for a specific event, ensuring candidate IDs like event_id or internal user_id are never mistaken for player IDs.
        """
        clean_eid = str(event_id or "").strip()
        clean_cand = str(candidate_pid or "").strip()

        # If candidate_pid looks like a valid BCP player ID (not event_id, not user_id)
        if not ignore_candidate:
            if clean_cand and clean_cand != clean_eid and not clean_cand.startswith("user_") and not clean_cand.startswith("ES-") and len(clean_cand) >= 8:
                return clean_cand

        user_info = None
        auth_mgr = None
        try:
            from core import get_auth_manager
            auth_mgr = get_auth_manager()
            user_info = auth_mgr.get_user_by_id(user_id) if user_id else None
        except Exception as auth_ex:
            logger.debug(f"Notice resolving user in resolve_event_player_id: {auth_ex}")

        bcp_user_id = str((user_info or {}).get("bcp_user_id") or (user_info or {}).get("player_id") or "").strip()
        user_email = str((user_info or {}).get("bcp_email") or (user_info or {}).get("email") or "").lower().strip()
        user_display = str((user_info or {}).get("display_name") or (user_info or {}).get("full_name") or (user_info or {}).get("name") or "").strip()
        parts = user_display.split(" ", 1) if user_display else ["", ""]
        u_fn = parts[0].strip().lower()
        u_ln = (parts[1] if len(parts) > 1 else "").strip().lower()

        tok = explicit_token
        if not tok and user_id and auth_mgr:
            try:
                tok_dict = auth_mgr.get_valid_bcp_tokens(user_id)
                tok = tok_dict.get("access_token") or tok_dict.get("id_token")
            except Exception as ex:
                logger.debug(f"Notice getting token for player resolution: {ex}")

        # Strategy 0: Query /v1/events/{clean_eid}/currentPlayer with auth token
        # This is the dedicated endpoint for the current user's tournament registration
        try:
            succ_cp, _, cp_data = cls.fetch_event_current_player(clean_eid, user_id=user_id, explicit_token=tok)
            if succ_cp and cp_data and cp_data.get("id"):
                cp_id = str(cp_data.get("id")).strip()
                if cp_id and cp_id != clean_eid and not cp_id.startswith("user_"):
                    logger.info(f"✅ Resolved BCP tournament player ID {cp_id} for event {clean_eid} via /currentPlayer")
                    return cp_id
        except Exception as e:
            logger.debug(f"Notice resolving player ID via /currentPlayer: {e}")

        # Strategy 1: Fetch user's registered events from BCP
        # BCP returns the official tournament player record ID in myPlayer.id
        try:
            succ, _, events = cls.fetch_user_registered_events(user_id, explicit_token=tok)
            if succ and events:
                for ev in events:
                    if str(ev.get("bcp_event_id") or ev.get("id") or "").strip() == clean_eid:
                        pid = str(ev.get("player_id") or "").strip()
                        if pid and pid != clean_eid and not pid.startswith("user_"):
                            logger.info(f"✅ Resolved BCP tournament player ID {pid} for event {clean_eid} via fetch_user_registered_events")
                            return pid
        except Exception as e:
            logger.debug(f"Notice resolving player ID via registered events: {e}")

        # Strategy 2: Query event players from BCP /v1/events/{event_id}/players with user auth token
        try:
            url = f"{BCP_API_BASE}/events/{clean_eid}/players?limit=2500"
            data, err = cls.execute_call(url, method="GET", user_id=user_id, explicit_token=tok, allow_unauthenticated=True)
            raw_players = []
            if isinstance(data, dict):
                raw_players = data.get("data") or data.get("players") or data.get("active") or []
            elif isinstance(data, list):
                raw_players = data

            for p in (raw_players or []):
                p_uid = str(p.get("userId") or p.get("user_id") or (p.get("user") or {}).get("id") or "").strip()
                p_em = str((p.get("user") or {}).get("email") or p.get("email") or "").strip().lower()
                p_fn = str((p.get("user") or {}).get("firstName") or p.get("firstName") or "").strip().lower()
                p_ln = str((p.get("user") or {}).get("lastName") or p.get("lastName") or "").strip().lower()

                matches = False
                if bcp_user_id and p_uid and p_uid == bcp_user_id:
                    matches = True
                elif user_email and p_em and p_em == user_email:
                    matches = True
                elif u_fn and u_ln and p_fn == u_fn and p_ln == u_ln:
                    matches = True

                if matches:
                    pid = str(p.get("id") or p.get("_id") or p.get("playerId") or "").strip()
                    if pid and pid != clean_eid:
                        logger.info(f"✅ Resolved BCP tournament player ID {pid} for event {clean_eid} via /events/{clean_eid}/players")
                        return pid
        except Exception as e:
            logger.debug(f"Notice resolving player ID via event players endpoint: {e}")

        # Strategy 3: Query scraper's fetch_event_players
        try:
            from scraper import BestCoastPairingsScraper
            scraper = BestCoastPairingsScraper()
            players = scraper.fetch_event_players(clean_eid)
            for p in (players or []):
                p_uid = str(p.get("userId") or p.get("user_id") or (p.get("user") or {}).get("id") or "").strip()
                p_em = str((p.get("user") or {}).get("email") or p.get("email") or "").strip().lower()
                p_fn = str((p.get("user") or {}).get("firstName") or p.get("firstName") or "").strip().lower()
                p_ln = str((p.get("user") or {}).get("lastName") or p.get("lastName") or "").strip().lower()

                matches = False
                if bcp_user_id and p_uid and p_uid == bcp_user_id:
                    matches = True
                elif user_email and p_em and p_em == user_email:
                    matches = True
                elif u_fn and u_ln and p_fn == u_fn and p_ln == u_ln:
                    matches = True

                if matches:
                    pid = str(p.get("id") or p.get("_id") or p.get("playerId") or "").strip()
                    if pid and pid != clean_eid:
                        logger.info(f"✅ Resolved BCP tournament player ID {pid} for event {clean_eid} via scraper")
                        return pid
        except Exception as e:
            logger.debug(f"Notice resolving player ID via scraper: {e}")

        if not ignore_candidate and clean_cand and clean_cand != clean_eid and not clean_cand.startswith("user_") and not clean_cand.startswith("ES-"):
            return clean_cand
        return None

    @classmethod
    def submit_pairing_scores(
        cls,
        pairing_id: str,
        p1_score: int,
        p2_score: int,
        game_data: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None,
        winner_id: Optional[str] = None
    ) -> Tuple[bool, Optional[str]]:
        """
        Submits match scores to BCP for a specific pairing using newapi submitScores endpoint.
        """
        clean_pid = str(pairing_id or "").strip()
        if not clean_pid or clean_pid.isdigit():
            return False, f"Invalid pairing_id '{clean_pid}' for BCP score submission"

        p1_res = 2 if p1_score > p2_score else (1 if p1_score == p2_score else 0)
        p2_res = 2 if p2_score > p1_score else (1 if p1_score == p2_score else 0)

        url = f"{BCP_API_BASE}/pairings/{clean_pid}/submitScores"
        resolved_winner = winner_id
        if not resolved_winner and game_data and isinstance(game_data, dict):
            resolved_winner = game_data.get("winner_id") or game_data.get("winnerId")

        meta = {
            "p1-gamePoints": str(p1_score),
            "p2-gamePoints": str(p2_score),
            "p1-gameResult": str(p1_res),
            "p2-gameResult": str(p2_res),
            "p1-marginOfVictory": int(p1_score - p2_score),
            "p2-marginOfVictory": int(p2_score - p1_score)
        }
        if isinstance(game_data, dict) and isinstance(game_data.get("metaData"), dict):
            meta.update(game_data["metaData"])

        payload: Dict[str, Any] = {
            "pairingType": "Pairing",
            "isDone": True,
            "player1Score": int(p1_score),
            "player2Score": int(p2_score),
            "player1Points": int(p1_score),
            "player2Points": int(p2_score),
            "player1Result": p1_res,
            "player2Result": p2_res,
            "player1Game": {
                "points": int(p1_score),
                "result": p1_res
            },
            "player2Game": {
                "points": int(p2_score),
                "result": p2_res
            },
            "metaData": meta,
            "gameData": {
                "isDone": True,
                "player1Score": int(p1_score),
                "player2Score": int(p2_score),
                "player1Points": int(p1_score),
                "player2Points": int(p2_score),
                "player1Result": p1_res,
                "player2Result": p2_res,
                "player1Game": {
                    "points": int(p1_score),
                    "result": p1_res
                },
                "player2Game": {
                    "points": int(p2_score),
                    "result": p2_res
                },
                "metaData": meta,
                "metrics": []
            }
        }

        p1_gid = game_data.get("p1_game_id") or game_data.get("player1GameId") if isinstance(game_data, dict) else None
        p2_gid = game_data.get("p2_game_id") or game_data.get("player2GameId") if isinstance(game_data, dict) else None
        p1_id = game_data.get("p1_id") or game_data.get("player1Id") if isinstance(game_data, dict) else None
        p2_id = game_data.get("p2_id") or game_data.get("player2Id") if isinstance(game_data, dict) else None

        if p1_gid:
            payload["player1GameId"] = str(p1_gid)
            payload["player1Game"]["id"] = str(p1_gid)
            payload["gameData"]["player1Game"]["id"] = str(p1_gid)
        if p2_gid:
            payload["player2GameId"] = str(p2_gid)
            payload["player2Game"]["id"] = str(p2_gid)
            payload["gameData"]["player2Game"]["id"] = str(p2_gid)

        if p1_id:
            payload["player1Id"] = str(p1_id)
            payload["gameData"]["player1Id"] = str(p1_id)
        if p2_id:
            payload["player2Id"] = str(p2_id)
            payload["gameData"]["player2Id"] = str(p2_id)

        if resolved_winner:
            payload["winnerId"] = str(resolved_winner)
            payload["gameData"]["winnerId"] = str(resolved_winner)

        if game_data and isinstance(game_data, dict):
            for k, v in game_data.items():
                if k not in payload["gameData"]:
                    payload["gameData"][k] = v

        data, err = cls.execute_call(url, method="POST", json_data=payload, user_id=user_id, explicit_token=explicit_token)
        if data is not None or not err:
            logger.info(f"✅ Successfully submitted scores to BCP for pairing {clean_pid} via submitScores")
            return True, None

        # Fallback to direct PUT /pairings/{clean_pid}
        url_put = f"{BCP_API_BASE}/pairings/{clean_pid}"
        data_put, err_put = cls.execute_call(url_put, method="PUT", json_data=payload, user_id=user_id, explicit_token=explicit_token)
        if data_put is not None or not err_put:
            logger.info(f"✅ Successfully submitted scores to BCP for pairing {clean_pid} via PUT fallback")
            return True, None

        return False, err or err_put

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

    @classmethod
    def fetch_user_registered_events(
        cls,
        user_id: str,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str], List[Dict[str, Any]]]:
        """
        Fetches active tournaments where the user is registered as a player on BCP.
        Uses Tier 1 query with silent token refresh.
        """
        from core import get_auth_manager
        auth_mgr = get_auth_manager()

        tok = explicit_token
        if not tok and user_id:
            tok_dict = auth_mgr.get_valid_bcp_tokens(user_id)
            tok = tok_dict.get("access_token") or tok_dict.get("id_token")

        if not tok:
            return False, "Player is not linked to Best Coast Pairings", []

        # Query official BCP v1 events endpoint used by bestcoastpairings.com/play/my-events
        # Filters events ending after (now - 7 days) to capture active, recent, and upcoming events in 1 single call
        from datetime import datetime, timezone, timedelta
        from urllib.parse import quote

        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        cutoff_str = cutoff.strftime("%Y-%m-%dT%H:%M")
        encoded_cutoff = quote(cutoff_str)

        sync_url = f"{BCP_API_BASE}/events?limit=100&playerEvents=true&toEvents=true&eventEndDateFrom={encoded_cutoff}"

        data, err = cls.execute_call(sync_url, method="GET", user_id=user_id, explicit_token=tok)

        # Fallback without eventEndDateFrom only if date filtering was rejected
        if data is None and err and ("409" in str(err) or "parameter" in str(err).lower()):
            fallback_url = f"{BCP_API_BASE}/events?limit=100&playerEvents=true&toEvents=true"
            data, err = cls.execute_call(fallback_url, method="GET", user_id=user_id, explicit_token=tok)

        if data is None:
            if err is None or "404" in str(err) or "empty" in str(err).lower():
                return True, None, []
            return False, err or "Failed to fetch registered events from BCP", []

        raw_items = []
        if isinstance(data, list):
            raw_items = data
        elif isinstance(data, dict):
            raw_items = data.get("data") if isinstance(data.get("data"), list) else (
                data.get("events") if isinstance(data.get("events"), list) else []
            )

        user_info = auth_mgr.get_user_by_id(user_id) if user_id else None
        bcp_user_id = user_info.get("bcp_user_id") if user_info else None
        user_email = (user_info.get("bcp_email") or (user_info.get("email") if user_info else "") or "").lower().strip()

        events_list = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            ev_id = str(item.get("id") or item.get("_id") or "")
            if not ev_id:
                continue

            loc = item.get("location") if isinstance(item.get("location"), dict) else {}
            venue_name = item.get("venue") or loc.get("venueName") or loc.get("name") or loc.get("venue") or ""
            city = item.get("city") or loc.get("city") or ""
            state = item.get("state") or loc.get("state") or ""
            country = item.get("country") or loc.get("country") or ""

            # Extract player registration info
            p_data = item.get("myPlayer") or item.get("player") or item.get("playerData") or item.get("registration") or item.get("userRegistration") or {}
            if not p_data and item.get("players") and isinstance(item.get("players"), list):
                for p in item.get("players"):
                    p_uid = str(p.get("userId") or p.get("user_id") or "")
                    p_em = str((p.get("user") or {}).get("email") or p.get("email") or "").lower().strip()
                    if (bcp_user_id and p_uid == str(bcp_user_id)) or (user_email and p_em == user_email):
                        p_data = p
                        break

            faction = p_data.get("army") or p_data.get("faction") or p_data.get("armyName") or ""
            detachment = p_data.get("detachment") or ""
            army_list = p_data.get("armyList") or p_data.get("army_list") or p_data.get("listText") or ""
            has_list = bool(p_data.get("hasList") or army_list or p_data.get("listSubmitted") or p_data.get("has_list_submitted") or p_data.get("listId"))
            checked_in = bool(p_data.get("checkedIn") or p_data.get("checked_in") or False)
            dropped = bool(p_data.get("dropped") or False)

            u_obj = p_data.get("user") if isinstance(p_data.get("user"), dict) else {}
            fn = u_obj.get("firstName") or p_data.get("firstName") or ""
            ln = u_obj.get("lastName") or p_data.get("lastName") or ""
            team_obj = p_data.get("team") if isinstance(p_data.get("team"), dict) else {}
            team_name = p_data.get("teamName") or team_obj.get("name") or p_data.get("team") or ""
            pid = str(p_data.get("id") or p_data.get("_id") or p_data.get("playerId") or "").strip()
            army_id = p_data.get("armyId") or p_data.get("army_id") or ""
            sub_faction_id = p_data.get("subFactionId") or p_data.get("sub_faction_id") or ""
            gamesystem_id = item.get("gameSystemId") or item.get("gamesystem") or item.get("systemId") or "WGMSzfKFYA"

            events_list.append({
                "bcp_event_id": ev_id,
                "player_id": pid,
                "bcp_player_id": pid,
                "first_name": fn,
                "last_name": ln,
                "team_name": team_name,
                "army_id": army_id,
                "sub_faction_id": sub_faction_id,
                "dropped": dropped,
                "gamesystem_id": gamesystem_id,
                "event_name": item.get("name") or "Tournament",
                "event_date": item.get("eventDate") or item.get("startDate") or item.get("eventStartDate"),
                "end_date": item.get("endDate") or item.get("eventEndDate"),
                "venue_name": venue_name,
                "city": city,
                "state": state,
                "country": country,
                "faction": faction,
                "detachment": detachment,
                "army_list": army_list,
                "has_list_submitted": has_list,
                "checked_in": checked_in,
                "points_limit": item.get("points") or 2000,
                "rounds": item.get("numberOfRounds") or item.get("numRounds") or 5,
                "total_players": item.get("totalPlayers") or item.get("capacity") or (len(item.get("players")) if isinstance(item.get("players"), list) else 0),
                "bcp_url": f"https://www.bestcoastpairings.com/event/{ev_id}"
            })

        logger.info(f"✅ Fetched {len(events_list)} registered events for user {user_id} from BCP")
        return True, None, events_list

    @classmethod
    def configure_event_registration(
        cls,
        event_id: str,
        settings: Dict[str, Any],
        user_id: Optional[str] = None,
        explicit_token: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
        """
        Configures tournament registration, ticketing, and scoring rules on BCP
        via POST /v1/events/{event_id} with {"set": {...}, "unset": {...}}.
        """
        clean_eid = str(event_id or "").strip()
        if not clean_eid or clean_eid.startswith("ES-"):
            return True, None, None

        url = f"{BCP_API_BASE}/events/{clean_eid}"

        using_online_reg = bool(settings.get("using_online_reg", settings.get("usingOnlineReg", True)))
        num_tickets = int(settings.get("num_tickets") or settings.get("numTickets") or settings.get("capacity") or 32)
        ticket_price = float(settings.get("ticket_price") or settings.get("ticketPrice") or 0.0)
        currency = str(settings.get("ticket_currency") or settings.get("currency") or "usd").lower()

        shipping_req = bool(settings.get("collect_shipping", False))
        shipping_mand = bool(settings.get("shipping_mandatory", False))
        shipping_desc = str(settings.get("shipping_description", ""))
        if isinstance(settings.get("shipping_details"), dict):
            shipping_req = bool(settings["shipping_details"].get("requested", shipping_req))
            shipping_mand = bool(settings["shipping_details"].get("mandatory", shipping_mand))
            shipping_desc = str(settings["shipping_details"].get("description", shipping_desc))
        elif isinstance(settings.get("shippingDetails"), dict):
            shipping_req = bool(settings["shippingDetails"].get("requested", shipping_req))
            shipping_mand = bool(settings["shippingDetails"].get("mandatory", shipping_mand))
            shipping_desc = str(settings["shippingDetails"].get("description", shipping_desc))

        set_dict: Dict[str, Any] = {
            "usingOnlineReg": using_online_reg,
            "numTickets": num_tickets,
            "ticketPrice": ticket_price,
            "amount": ticket_price,
            "currency": currency,
            "ticketCurrency": currency,
            "availableCurrencies": [currency],
            "pricingDict": {currency: ticket_price},
            "playerPaysFees": bool(settings.get("player_pays_fees", settings.get("playerPaysFees", False))),
            "disableCheckin": bool(settings.get("disable_checkin", settings.get("disableCheckin", False))),
            "privateEvent": bool(settings.get("private_event", settings.get("privateEvent", False))),
            "shippingDetails": {
                "requested": shipping_req,
                "mandatory": shipping_mand,
                "description": shipping_desc
            },
            "hideLists": bool(settings.get("hide_lists", settings.get("hideLists", True))),
            "listOptions": {"allowsFiles": True, "allowsText": True, "allowsImages": True},
            "listsLocked": bool(settings.get("lists_locked", settings.get("listsLocked", False))),
            "listSubmissionLocked": bool(settings.get("list_submission_locked", settings.get("listSubmissionLocked", False))),
            "listsAtCheckin": bool(settings.get("lists_at_checkin", settings.get("listsAtCheckin", settings.get("require_lists", False)))),
            "factionsLocked": bool(settings.get("factions_locked", settings.get("factionsLocked", False))),
            "hideRoster": bool(settings.get("hide_roster", settings.get("hideRoster", False))),
            "hidePlacings": bool(settings.get("hide_placings", settings.get("hidePlacings", False))),
            "hidePlayerCount": False,
            "passwordlessScoring": bool(settings.get("passwordless_scoring", settings.get("passwordlessScoring", True))),
            "enablePasswords": True,
            "rankedTables": bool(settings.get("ranked_tables", settings.get("rankedTables", False))),
            "requirePairingPublish": bool(settings.get("require_pairing_publish", settings.get("requirePairingPublish", False)))
        }

        if settings.get("name"):
            set_dict["name"] = settings["name"]
        if settings.get("num_rounds") or settings.get("rounds") or settings.get("numberOfRounds"):
            set_dict["numberOfRounds"] = int(settings.get("num_rounds") or settings.get("rounds") or settings.get("numberOfRounds"))
        if settings.get("default_round_length") or settings.get("defaultRoundLength"):
            set_dict["defaultRoundLength"] = int(settings.get("default_round_length") or settings.get("defaultRoundLength"))
        if settings.get("pairing_style") or settings.get("pairingStyle"):
            set_dict["pairingStyle"] = str(settings.get("pairing_style") or settings.get("pairingStyle")).title()

        payload = {
            "set": set_dict,
            "unset": {
                "placingRecordType": True,
                "eventFormat": True
            }
        }

        data, err = cls.execute_call(url, method="POST", json_data=payload, user_id=user_id, explicit_token=explicit_token)
        if data is not None or not err:
            logger.info(f"✅ Successfully configured BCP registration & settings for event {clean_eid}")
            return True, None, data

        return False, (err or "Failed to configure BCP registration"), None

# Module-level instance
bcp_adapter = BcpAdapter()

