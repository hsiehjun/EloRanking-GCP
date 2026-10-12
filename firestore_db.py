"""
Google Cloud Firestore Native Engine for Warhammer 40,000 Match Rooms.
Provides real-time collaborative synchronization for live matches.
PostgreSQL is strictly cold storage for finalized verified scorecards.
"""

import os
import logging
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timezone, timedelta

logger = logging.getLogger("elo_ranking.firestore")

try:
    from google.cloud import firestore
    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
    except ImportError:
        try:
            from google.cloud.firestore import FieldFilter
        except ImportError:
            FieldFilter = None
    FIRESTORE_AVAILABLE = True
except ImportError:
    FIRESTORE_AVAILABLE = False
    FieldFilter = None
    logger.warning("google-cloud-firestore package not found locally. Running in in-memory fallback mode.")


def _apply_where(target: Any, field_path: str, op_string: str, value: Any) -> Any:
    """Applies where filter using modern FieldFilter keyword syntax when available, avoiding deprecation UserWarning."""
    if FieldFilter is not None:
        return target.where(filter=FieldFilter(field_path, op_string, value))
    return target.where(field_path, op_string, value)


import re

def normalize_tracker_match_id(raw: str) -> str:
    if not raw:
        return ""
    clean = str(raw).strip().replace(" ", "")
    m = re.match(r"^(?:(WH40K-|AOS-))?(BCP|ES)-(.+)-R(\d+)-T(\d+)$", clean, re.IGNORECASE)
    if m:
        prefix = (m.group(1) or "").upper()
        system = m.group(2).upper()
        event_id = m.group(3).strip()
        r_num = m.group(4)
        t_num = m.group(5)
        return f"{prefix}{system}-{event_id}-R{r_num}-T{t_num}"

    s = clean.upper()
    if s.startswith("WH40K-") or s.startswith("BCP-") or s.startswith("ES-") or s.startswith("AOS-"):
        return s
    s_clean = s.replace("-", "")
    if len(s_clean) == 8:
        return f"WH40K-{s_clean[:4]}-{s_clean[4:]}"
    return s


class FirestoreRoomEngine:
    """Manages hot ephemeral match rooms in Cloud Firestore ('rooms/{match_id}')."""

    def __init__(self, project_id: str = "eloranking-506820"):
        self.project_id = project_id
        self._client = None
        self._fallback_rooms: Dict[str, Any] = {}
        self._discarded_rooms: Dict[str, float] = {}
        self._fallback_tournaments: Dict[str, Any] = {}
        self._fallback_judge_calls: Dict[str, Dict[str, Any]] = {}
        self._fallback_pairing_rooms: Dict[str, Dict[str, Any]] = {}
        self._init_client()

    def _init_client(self):
        if FIRESTORE_AVAILABLE:
            try:
                self._client = firestore.Client(project=self.project_id)
                logger.info(f"🔥 Successfully initialized Cloud Firestore Native client (Project: {self.project_id})")
            except Exception as err:
                logger.warning(f"Notice initializing Firestore client: {err}. Operating with fast memory sync.")
                self._client = None
        else:
            self._client = None

    @property
    def is_connected(self) -> bool:
        return self._client is not None

    def is_room_discarded(self, match_id: str) -> bool:
        if not match_id:
            return False
        norm_mid = normalize_tracker_match_id(match_id)
        clean_id = match_id.strip().upper()
        short_id = clean_id.replace("WH40K-", "").replace("AOS-", "")
        return bool(
            norm_mid in self._discarded_rooms
            or clean_id in self._discarded_rooms
            or short_id in self._discarded_rooms
        )

    def get_room_doc_ref(self, match_id: str):
        if not match_id or not self._client:
            return None
        norm_mid = normalize_tracker_match_id(match_id)
        return self._client.collection("rooms").document(norm_mid)

    def create_room(self, match_id: str, room_payload: Dict[str, Any]) -> Dict[str, Any]:
        """Creates or initializes a live match room document in Firestore."""
        norm_mid = normalize_tracker_match_id(match_id)
        clean_id = match_id.strip().upper()
        short_id = clean_id.replace("WH40K-", "").replace("AOS-", "")
        for k in (norm_mid, clean_id, short_id):
            self._discarded_rooms.pop(k, None)

        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        expires_ts = now_ts + (14 * 24 * 60 * 60 * 1000) # 14 days TTL

        data = {
            "roomKey": norm_mid,
            "matchId": norm_mid,
            "status": "in_progress",
            "createdAt": now_ts,
            "updatedAt": now_ts,
            "expiresAt": expires_ts,
            **room_payload
        }

        if self._client:
            try:
                ref = self.get_room_doc_ref(norm_mid)
                ref.set(data, merge=True)
                logger.info(f"🔥 [FIRESTORE] Created/Set rooms/{norm_mid}")
            except Exception as e:
                logger.error(f"❌ [FIRESTORE] Error creating room {norm_mid}: {e}")

        self._fallback_rooms[norm_mid] = data
        return data

    def get_room(self, match_id: str) -> Optional[Dict[str, Any]]:
        """Fetches live match room state from Firestore."""
        if not match_id:
            return None
        norm_mid = normalize_tracker_match_id(match_id)
        clean_id = match_id.strip().upper()
        if self.is_room_discarded(match_id):
            self._fallback_rooms.pop(norm_mid, None)
            self._fallback_rooms.pop(clean_id, None)
            return None

        if self._client:
            try:
                ref = self.get_room_doc_ref(norm_mid)
                snap = ref.get()
                if snap.exists:
                    d = snap.to_dict() or {}
                    if d.get("status") == "abandoned" or d.get("is_abandoned"):
                        self.discard_room(norm_mid)
                        return None
                    # Detect zombie partial doc recreated after deletion (missing status, roomKey, and createdAt)
                    if not d.get("status") and not d.get("roomKey") and not d.get("createdAt") and not d.get("event_id") and not d.get("eventId"):
                        self.discard_room(norm_mid)
                        return None
                    self._fallback_rooms[norm_mid] = d
                    return d
                if norm_mid != clean_id:
                    ref_u = self._client.collection("rooms").document(clean_id)
                    snap_u = ref_u.get()
                    if snap_u.exists:
                        d = snap_u.to_dict() or {}
                        if d.get("status") == "abandoned" or d.get("is_abandoned"):
                            self.discard_room(clean_id)
                            return None
                        if not d.get("status") and not d.get("roomKey") and not d.get("createdAt") and not d.get("event_id") and not d.get("eventId"):
                            self.discard_room(clean_id)
                            return None
                        self._fallback_rooms[norm_mid] = d
                        return d
                # Authoritatively missing in Cloud Firestore -> evict any stale in-memory copy!
                self._fallback_rooms.pop(norm_mid, None)
                self._fallback_rooms.pop(clean_id, None)
                return None
            except Exception as e:
                logger.error(f"❌ [FIRESTORE] Error getting room {norm_mid}: {e}")

        return self._fallback_rooms.get(norm_mid) or self._fallback_rooms.get(clean_id)

    def update_room(self, match_id: str, updates: Dict[str, Any]) -> bool:
        """Applies field updates to live room in Firestore without resurrecting deleted rooms."""
        if not match_id:
            return False
        norm_mid = normalize_tracker_match_id(match_id)
        clean_id = match_id.strip().upper()
        if self.is_room_discarded(match_id):
            return False

        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        updates["updatedAt"] = now_ts

        if self._client:
            try:
                # Automatically prune legacy duplicate fields if present
                for legacy_field in ("clock", "game"):
                    if legacy_field not in updates and hasattr(firestore, "DELETE_FIELD"):
                        updates[legacy_field] = firestore.DELETE_FIELD
                if "active_judge_call" in updates and updates["active_judge_call"] is None and hasattr(firestore, "DELETE_FIELD"):
                    updates["active_judge_call"] = firestore.DELETE_FIELD
                ref = self.get_room_doc_ref(norm_mid)
                snap = ref.get()
                if not snap.exists:
                    # Room was deleted from Firestore! Evict from memory and do NOT resurrect it.
                    self._fallback_rooms.pop(norm_mid, None)
                    self._fallback_rooms.pop(clean_id, None)
                    return False
                ref.set(updates, merge=True)
                return True
            except Exception as e:
                logger.error(f"❌ [FIRESTORE] Error updating room {norm_mid}: {e}")

        if norm_mid in self._fallback_rooms:
            self._fallback_rooms[norm_mid].update(updates)
            self._fallback_rooms[norm_mid].pop("clock", None)
            self._fallback_rooms[norm_mid].pop("game", None)
            if "active_judge_call" in updates and updates["active_judge_call"] is None:
                self._fallback_rooms[norm_mid].pop("active_judge_call", None)
        elif clean_id in self._fallback_rooms:
            self._fallback_rooms[clean_id].update(updates)
            self._fallback_rooms[clean_id].pop("clock", None)
            self._fallback_rooms[clean_id].pop("game", None)
            if "active_judge_call" in updates and updates["active_judge_call"] is None:
                self._fallback_rooms[clean_id].pop("active_judge_call", None)
        else:
            self._fallback_rooms[norm_mid] = updates
        return True

    def discard_room(self, match_id: str) -> bool:
        """Deletes / discards a match room from Firestore and records tombstone so it cannot be resurrected."""
        if not match_id:
            return False
        norm_mid = normalize_tracker_match_id(match_id)
        clean_id = match_id.strip().upper()
        short_id = clean_id.replace("WH40K-", "").replace("AOS-", "")
        keys_to_clear = {norm_mid, clean_id, short_id}
        now_ts = datetime.now(timezone.utc).timestamp()
        for k in keys_to_clear:
            if k:
                self._discarded_rooms[k] = now_ts
                self._fallback_rooms.pop(k, None)

        if self._client:
            for k in keys_to_clear:
                if not k:
                    continue
                try:
                    ref = self._client.collection("rooms").document(k)
                    ref.delete()
                except Exception:
                    pass
            logger.info(f"🗑️ [FIRESTORE] Deleted discarded room rooms/{norm_mid}")

        return True

    def finalize_room(self, match_id: str) -> bool:
        """Marks a match room as completed and removes it from active Firestore."""
        return self.discard_room(match_id)

    def list_active_rooms_for_user(self, user_id: Optional[str] = None, user_name: Optional[str] = None, player_id: Optional[str] = None, limit: int = 150) -> List[Dict[str, Any]]:
        """Queries Firestore for active in_progress rooms involving this user."""
        rooms = []
        seen_keys = set()
        
        valid_ids = {str(x).strip().lower() for x in (user_id, player_id) if x and str(x).strip()}
        target_name = user_name.strip().lower() if user_name and user_name.strip() else None

        def _matches_user(d: Dict[str, Any]) -> bool:
            p1_id = d.get("user_id_p1") or (d.get("state", {}).get("user_id_p1") if isinstance(d.get("state"), dict) else None) or (d.get("participants", {}).get("player1", {}).get("uid") if isinstance(d.get("participants"), dict) else None)
            p2_id = d.get("user_id_p2") or (d.get("state", {}).get("user_id_p2") if isinstance(d.get("state"), dict) else None) or (d.get("participants", {}).get("player2", {}).get("uid") if isinstance(d.get("participants"), dict) else None)
            p1_pid = d.get("p1_id") or (d.get("state", {}).get("game", {}).get("p1Id") if isinstance(d.get("state"), dict) else None)
            p2_pid = d.get("p2_id") or (d.get("state", {}).get("game", {}).get("p2Id") if isinstance(d.get("state"), dict) else None)
            p1_name = (d.get("p1_name") or (d.get("state", {}).get("game", {}).get("p1Name") if isinstance(d.get("state"), dict) else "") or "").strip().lower()
            p2_name = (d.get("p2_name") or (d.get("state", {}).get("game", {}).get("p2Name") if isinstance(d.get("state"), dict) else "") or "").strip().lower()
            if not valid_ids and not target_name:
                return True
            if valid_ids:
                for candidate in (p1_id, p2_id, p1_pid, p2_pid):
                    if candidate and str(candidate).strip().lower() in valid_ids:
                        return True
            if target_name:
                if (p1_name and target_name == p1_name) or (p2_name and target_name == p2_name):
                    return True
            return False

        firestore_query_ok = False
        all_firestore_active_keys = set()
        if self._client:
            try:
                col = self._client.collection("rooms")
                query = _apply_where(col, "status", "==", "in_progress").limit(limit)
                for doc in query.stream():
                    d = doc.to_dict() or {}
                    rkey = (d.get("roomKey") or d.get("matchId") or doc.id or "").strip().upper()
                    if not rkey or rkey in seen_keys or self.is_room_discarded(rkey):
                        continue
                    
                    if d.get("status") in ("abandoned", "completed") or d.get("is_abandoned") or d.get("is_finished"):
                        continue

                    all_firestore_active_keys.add(rkey)
                    self._fallback_rooms[rkey] = d

                    if _matches_user(d):
                        seen_keys.add(rkey)
                        rooms.append(d)
                firestore_query_ok = True
            except Exception as e:
                logger.warning(f"Notice listing Firestore user rooms: {e}")

        if firestore_query_ok:
            # Prune any stale rooms from _fallback_rooms that were deleted in Cloud Firestore
            stale_keys = [
                mid for mid, d in list(self._fallback_rooms.items())
                if isinstance(d, dict)
                and (d.get("status") == "in_progress" or "roomKey" in d or "matchId" in d)
                and (d.get("roomKey") or d.get("matchId") or mid).strip().upper() not in all_firestore_active_keys
            ]
            for k in stale_keys:
                self._fallback_rooms.pop(k, None)
        else:
            # Offline / in-memory fallback mode ONLY when Firestore client is unavailable
            for mid, d in list(self._fallback_rooms.items()):
                if not isinstance(d, dict):
                    continue
                rkey = (d.get("roomKey") or d.get("matchId") or mid or "").strip().upper()
                if (
                    rkey
                    and rkey not in seen_keys
                    and not self.is_room_discarded(rkey)
                    and d.get("status") == "in_progress"
                    and not d.get("is_abandoned")
                    and not d.get("is_finished")
                ):
                    if _matches_user(d):
                        seen_keys.add(rkey)
                        rooms.append(d)

        # Sort rooms by updatedAt descending
        rooms.sort(key=lambda r: r.get("updatedAt") or r.get("updated_at") or 0, reverse=True)
        return rooms

    def get_chat_doc_ref(self, request_id: str):
        if not request_id or not self._client:
            return None
        return self._client.collection("connect_chats").document(request_id.strip())

    def append_chat_message(self, request_id: str, message_data: Dict[str, Any], participants: Optional[List[str]] = None) -> bool:
        """Appends a single message to connect_chats/{request_id} in Firestore."""
        request_id = request_id.strip()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        expires_dt = datetime.now(timezone.utc) + timedelta(days=30)

        doc_data: Dict[str, Any] = {
            "requestId": request_id,
            "lastMessage": message_data.get("message_text") or (f"🎲 Live Game Tracker Room: {message_data.get('room_key')}" if message_data.get("room_key") else ""),
            "lastSenderId": message_data.get("sender_id"),
            "lastSenderName": message_data.get("sender_name"),
            "updatedAt": now_ts,
            "expiresAt": expires_dt
        }
        if participants:
            doc_data["participants"] = participants

        if self._client:
            try:
                ref = self.get_chat_doc_ref(request_id)
                if ref:
                    doc_snap = ref.get()
                    if doc_snap.exists:
                        d = doc_snap.to_dict() or {}
                        existing_msgs = d.get("messages", [])
                        msg_id = message_data.get("id")
                        if msg_id and any(m.get("id") == msg_id for m in existing_msgs):
                            # Already recorded in Firestore
                            return True

                    if FIRESTORE_AVAILABLE and hasattr(firestore, "ArrayUnion"):
                        doc_data["messages"] = firestore.ArrayUnion([message_data])
                    else:
                        existing = (doc_snap.to_dict().get("messages", []) if doc_snap.exists else [])
                        existing.append(message_data)
                        doc_data["messages"] = existing

                    ref.set(doc_data, merge=True)
                    return True
            except Exception as e:
                logger.error(f"❌ [FIRESTORE] Error appending chat message to {request_id}: {e}")

        # In-memory fallback
        if request_id not in self._fallback_rooms:
            self._fallback_rooms[request_id] = {
                "requestId": request_id,
                "participants": participants or [],
                "messages": []
            }
        cache = self._fallback_rooms[request_id]
        cache.update(doc_data)
        if "messages" not in cache or not isinstance(cache["messages"], list):
            cache["messages"] = []
        msg_id = message_data.get("id")
        if not msg_id or not any(m.get("id") == msg_id for m in cache["messages"]):
            cache["messages"].append(message_data)
        return True

    def sync_chat_history(self, request_id: str, messages: List[Dict[str, Any]], request_meta: Optional[Dict[str, Any]] = None) -> bool:
        """Seeds or updates full chat history in Firestore from PostgreSQL."""
        request_id = request_id.strip()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        expires_dt = datetime.now(timezone.utc) + timedelta(days=30)

        participants = []
        if request_meta:
            participants = [p for p in [request_meta.get("sender_id"), request_meta.get("receiver_id")] if p]

        clean_messages = []
        for m in messages:
            msg_dict = dict(m)
            created_at = msg_dict.get("created_at")
            if hasattr(created_at, "isoformat"):
                msg_dict["created_at"] = created_at.isoformat()
            elif created_at is not None:
                msg_dict["created_at"] = str(created_at)

            read_at = msg_dict.get("read_at")
            if hasattr(read_at, "isoformat"):
                msg_dict["read_at"] = read_at.isoformat()
            elif read_at is not None:
                msg_dict["read_at"] = str(read_at)

            clean_messages.append(msg_dict)

        doc_data: Dict[str, Any] = {
            "requestId": request_id,
            "participants": participants,
            "messages": clean_messages,
            "updatedAt": now_ts,
            "expiresAt": expires_dt
        }
        if clean_messages:
            last = clean_messages[-1]
            doc_data["lastMessage"] = last.get("message_text") or (f"🎲 Live Room: {last.get('room_key')}" if last.get("room_key") else "")
            doc_data["lastSenderId"] = last.get("sender_id")
            doc_data["lastSenderName"] = last.get("sender_name")

        if self._client:
            try:
                ref = self.get_chat_doc_ref(request_id)
                if ref:
                    ref.set(doc_data, merge=True)
                    return True
            except Exception as e:
                logger.error(f"❌ [FIRESTORE] Error syncing chat history to {request_id}: {e}")

        self._fallback_rooms[request_id] = doc_data
        return True

    def get_user_sync_doc_ref(self, user_id: str):
        """Returns DocumentReference for connect_user_sync/{user_id}."""
        if not user_id or not self._client:
            return None
        return self._client.collection("connect_user_sync").document(str(user_id).strip())

    def notify_user_requests_updated(self, user_ids: List[str], reason: str = "request_updated") -> bool:
        """Pushes a lightweight real-time timestamp notification to connect_user_sync/{user_id} in Firestore."""
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        expires_dt = datetime.now(timezone.utc) + timedelta(days=30)
        for uid in user_ids:
            if not uid:
                continue
            clean_uid = str(uid).strip()
            doc_data = {
                "userId": clean_uid,
                "updatedAt": now_ts,
                "reason": reason,
                "expiresAt": expires_dt
            }
            if self._client:
                try:
                    ref = self.get_user_sync_doc_ref(clean_uid)
                    if ref:
                        ref.set(doc_data, merge=True)
                except Exception as e:
                    logger.warning(f"Notice pushing user sync to Firestore for {clean_uid}: {e}")
            self._fallback_rooms[f"sync_{clean_uid}"] = doc_data
        return True

    def update_chat_status(self, request_id: str, status: str, participants: Optional[List[str]] = None) -> bool:
        """Updates request status (pending, accepted, declined) in connect_chats/{request_id}."""
        request_id = str(request_id).strip()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        expires_dt = datetime.now(timezone.utc) + timedelta(days=30)
        doc_data: Dict[str, Any] = {
            "requestId": request_id,
            "status": status,
            "updatedAt": now_ts,
            "expiresAt": expires_dt
        }
        if participants:
            doc_data["participants"] = [str(p).strip() for p in participants if p]
        if self._client:
            try:
                ref = self.get_chat_doc_ref(request_id)
                if ref:
                    ref.set(doc_data, merge=True)
                    return True
            except Exception as e:
                logger.error(f"❌ [FIRESTORE] Error updating chat status {request_id}: {e}")

        if request_id in self._fallback_rooms:
            self._fallback_rooms[request_id].update(doc_data)
        else:
            self._fallback_rooms[request_id] = doc_data
        return True

    def _compute_season_expires_dt(self, season_end_date: Optional[str] = None) -> datetime:
        """Computes Firestore TTL expiration datetime based on season_end_date (disappears after season ends)."""
        now_dt = datetime.now(timezone.utc)
        if season_end_date:
            try:
                clean = str(season_end_date).strip()[:10]
                dt = datetime.strptime(clean, "%Y-%m-%d").replace(tzinfo=timezone.utc, hour=23, minute=59, second=59)
                if dt > now_dt:
                    return dt + timedelta(days=1)
            except Exception:
                pass
        return now_dt + timedelta(days=60)

    def ensure_seasonal_group_chat(
        self,
        channel_id: str,
        group_meta: Dict[str, Any],
        greeting_message: Dict[str, Any],
        initial_messages: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Ensures a seasonal Firestore group chat instance ('connect_chats/{channel_id}') exists for a League or Pod,
        dynamically updates its participant roster as people join/move pods, and seeds the seasonal greeting message.
        """
        channel_id = str(channel_id).strip()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        season_end = group_meta.get("season_end_date")
        expires_dt = self._compute_season_expires_dt(season_end)

        existing_doc: Optional[Dict[str, Any]] = None
        if self._client:
            try:
                ref = self.get_chat_doc_ref(channel_id)
                if ref:
                    snap = ref.get()
                    if snap.exists:
                        existing_doc = snap.to_dict() or {}
            except Exception as e:
                logger.warning(f"Notice reading group chat {channel_id} from Firestore: {e}")

        if existing_doc is None and channel_id in self._fallback_rooms:
            existing_doc = self._fallback_rooms.get(channel_id)

        existing_msgs = list((existing_doc or {}).get("messages") or [])
        greet_id = greeting_message.get("id") or f"msg_greet_{channel_id}"
        greeting_message["id"] = greet_id

        # Ensure greeting message is always first and up-to-date with dynamic roster,
        # and strip any legacy mock/seed messages (msg_seed_*) if present.
        found_greet = False
        had_seed_msgs = False
        updated_msgs: List[Dict[str, Any]] = []
        for m in existing_msgs:
            if not isinstance(m, dict):
                continue
            mid = str(m.get("id") or "")
            msender = str(m.get("sender_id") or "")
            msender_name = str(m.get("sender_name") or "").strip().lower()
            mtxt = str(m.get("message_text") or "").strip().lower()
            if (
                mid.startswith("msg_seed_")
                or msender.startswith("seed_player_")
                or (msender.startswith("pod_") and ("_p1" in msender or "_p2" in msender))
                or msender_name in ("john2 hsieh2", "john4 hsieh4")
                or mtxt in ("huh", "uh", "hello", "hell", "but", "lskjdf")
            ):
                had_seed_msgs = True
                continue
            if mid == greet_id or m.get("is_greeting"):
                updated_msgs.append(greeting_message)
                found_greet = True
            else:
                updated_msgs.append(m)

        if not found_greet:
            updated_msgs = [greeting_message] + updated_msgs

        last_msg_obj = updated_msgs[-1] if updated_msgs else greeting_message
        doc_data: Dict[str, Any] = {
            "requestId": channel_id,
            "channelId": channel_id,
            "isGroup": True,
            "groupType": group_meta.get("group_type", "league"),
            "leagueId": group_meta.get("league_id"),
            "leagueName": group_meta.get("league_name"),
            "shortName": group_meta.get("short_name"),
            "seasonNumber": int(group_meta.get("season_number") or 1),
            "seasonName": group_meta.get("season_name") or f"Season {group_meta.get('season_number', 1)}",
            "podNumber": group_meta.get("pod_number"),
            "podName": group_meta.get("pod_name"),
            "title": group_meta.get("title") or "League Group Chat",
            "subtitle": group_meta.get("subtitle") or "",
            "status": "accepted",
            "participants": list(group_meta.get("participants") or []),
            "participantNames": list(group_meta.get("participant_names") or []),
            "memberCount": int(group_meta.get("member_count") or len(group_meta.get("participant_names") or [])),
            "greetingMessage": greeting_message,
            "messages": updated_msgs,
            "lastMessage": last_msg_obj.get("message_text") or "",
            "lastSenderId": last_msg_obj.get("sender_id") or "system",
            "lastSenderName": last_msg_obj.get("sender_name") or "Commissioner",
            "seasonStartDate": group_meta.get("season_start_date"),
            "seasonEndDate": season_end,
            "createdAt": (existing_doc or {}).get("createdAt") or now_ts,
            "updatedAt": (existing_doc or {}).get("updatedAt") or now_ts,
            "expiresAt": expires_dt
        }

        needs_write = (
            existing_doc is None
            or not found_greet
            or had_seed_msgs
            or existing_doc.get("title") != doc_data["title"]
            or existing_doc.get("subtitle") != doc_data["subtitle"]
            or existing_doc.get("participants") != doc_data["participants"]
            or existing_doc.get("participantNames") != doc_data["participantNames"]
            or existing_doc.get("memberCount") != doc_data["memberCount"]
            or (existing_doc.get("greetingMessage") or {}).get("message_text") != greeting_message.get("message_text")
        )

        if self._client and needs_write:
            try:
                ref = self.get_chat_doc_ref(channel_id)
                if ref:
                    ref.set(doc_data, merge=True)
            except Exception as e:
                logger.warning(f"Notice saving seasonal group chat {channel_id} to Firestore: {e}")

        self._fallback_rooms[channel_id] = doc_data
        return doc_data

    def get_group_chat(self, channel_id: str) -> Optional[Dict[str, Any]]:
        """Fetches a seasonal group chat document from Firestore or memory fallback."""
        if not channel_id:
            return None
        channel_id = str(channel_id).strip()
        if self._client:
            try:
                ref = self.get_chat_doc_ref(channel_id)
                if ref:
                    snap = ref.get()
                    if snap.exists:
                        d = snap.to_dict() or {}
                        self._fallback_rooms[channel_id] = d
                        return d
            except Exception as e:
                logger.warning(f"Notice reading group chat {channel_id}: {e}")
        return self._fallback_rooms.get(channel_id)

    def reset_seasonal_group_chat(
        self,
        channel_id: str,
        group_meta: Dict[str, Any],
        greeting_message: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Resets a seasonal group chat to a fresh state with only the greeting message and current roster."""
        channel_id = str(channel_id).strip()
        self._fallback_rooms.pop(channel_id, None)
        if self._client:
            try:
                ref = self.get_chat_doc_ref(channel_id)
                if ref:
                    ref.delete()
            except Exception:
                pass
        return self.ensure_seasonal_group_chat(channel_id, group_meta, greeting_message, initial_messages=[])

    def delete_league_season_group_chats(self, league_id: str, season_number: Optional[int] = None) -> int:
        """
        Deletes League and Pod Firestore group chat instances for an ended season or ended league
        so they disappear once the season concludes, rolls over, or the league ends.
        """
        if not league_id:
            return 0
        lid = str(league_id).strip().lower()
        deleted = 0
        prefixes = (
            [f"grp_league_{lid}_s{int(season_number)}", f"grp_pod_{lid}_s{int(season_number)}_"]
            if season_number is not None
            else [f"grp_league_{lid}_", f"grp_pod_{lid}_"]
        )

        # 1. Remove from in-memory fallback
        for k in list(self._fallback_rooms.keys()):
            kl = str(k).lower()
            if any(kl == p or kl.startswith(p) for p in prefixes):
                self._fallback_rooms.pop(k, None)
                deleted += 1

        # 2. Remove from Cloud Firestore connect_chats
        if self._client:
            try:
                col = self._client.collection("connect_chats")
                query = _apply_where(col, "leagueId", "==", lid)
                for doc in query.stream():
                    d = doc.to_dict() or {}
                    if season_number is not None and int(d.get("seasonNumber") or 0) != int(season_number):
                        continue
                    doc.reference.delete()
                    deleted += 1
            except Exception as e:
                logger.warning(f"Notice deleting seasonal group chats for league {lid} season {season_number}: {e}")
                if season_number is not None:
                    for cid in [f"grp_league_{lid}_s{int(season_number)}"] + [f"grp_pod_{lid}_s{int(season_number)}_p{p}" for p in range(1, 25)]:
                        try:
                            self._client.collection("connect_chats").document(cid).delete()
                        except Exception:
                            pass
        return deleted

    def delete_league_pod_group_chats(self, league_id: str, season_number: Optional[int] = None, keep_pod_numbers: Optional[List[int]] = None) -> int:
        """
        Deletes Pod-specific Firestore group chat instances ('grp_pod_{lid}_...') for a league/season
        (e.g., when a season ends before next season starts, or when pods are not yet populated).
        If keep_pod_numbers is provided, only deletes pod chats whose podNumber is not in keep_pod_numbers.
        """
        if not league_id:
            return 0
        lid = str(league_id).strip().lower()
        keep_set = {int(x) for x in (keep_pod_numbers or [])}
        deleted = 0
        prefix = f"grp_pod_{lid}_s{int(season_number)}_" if season_number is not None else f"grp_pod_{lid}_"

        # 1. Remove from in-memory fallback
        for k in list(self._fallback_rooms.keys()):
            kl = str(k).lower()
            if kl.startswith(prefix):
                if keep_set:
                    doc_c = self._fallback_rooms.get(k) or {}
                    pnum = doc_c.get("podNumber")
                    if pnum is not None and int(pnum) in keep_set:
                        continue
                self._fallback_rooms.pop(k, None)
                deleted += 1

        # 2. Remove from Cloud Firestore connect_chats
        if self._client:
            try:
                col = self._client.collection("connect_chats")
                query = _apply_where(col, "leagueId", "==", lid)
                for doc in query.stream():
                    d = doc.to_dict() or {}
                    if str(d.get("groupType") or "").lower() != "pod" and not str(doc.id).lower().startswith("grp_pod_"):
                        continue
                    if season_number is not None and int(d.get("seasonNumber") or 0) != int(season_number):
                        continue
                    if keep_set and d.get("podNumber") is not None and int(d.get("podNumber")) in keep_set:
                        continue
                    doc.reference.delete()
                    deleted += 1
            except Exception as e:
                logger.warning(f"Notice deleting pod group chats for league {lid} season {season_number}: {e}")
        return deleted


    def _get_fallback_tournament_dict(self, event_id: str, create: bool = False) -> Dict[str, Any]:
        """Resolves tournament fallback dictionary case-insensitively (e.g. BCP mixed-case IDs vs uppercase matchId tokens)."""
        eid = str(event_id or "").strip()
        if not eid:
            return {}
        if eid in self._fallback_tournaments:
            return self._fallback_tournaments[eid]
        eid_low = eid.lower()
        for k, v in self._fallback_tournaments.items():
            if str(k).lower() == eid_low:
                return v
        if create:
            self._fallback_tournaments[eid] = {}
            return self._fallback_tournaments[eid]
        return {}

    def get_tournament_doc_ref(self, event_id: str):
        if not event_id or not self._client:
            return None
        return self._client.collection("tournaments").document(str(event_id).strip())

    def _read_tournament_doc_dict(self, event_id: str) -> Dict[str, Any]:
        """Reads canonical tournaments/{event_id} from Firestore, migrating and deleting any legacy uppercase duplicate."""
        eid = str(event_id or "").strip()
        if not eid or not self._client:
            return {}
        merged: Dict[str, Any] = {}
        try:
            ref = self._client.collection("tournaments").document(eid)
            snap = ref.get()
            if snap.exists:
                data = snap.to_dict() or {}
                if isinstance(data, dict):
                    merged = dict(data)
        except Exception as e:
            logger.warning(f"Notice reading tournament doc {eid} from Firestore: {e}")

        # If eid is mixed-case (e.g. uZ4qxIz8T6a8), check if a legacy uppercase duplicate (UZ4QXIZ8T6A8) exists,
        # merge any missing fields into canonical eid, and delete the legacy uppercase duplicate.
        if eid.upper() != eid:
            upper_id = eid.upper()
            try:
                upper_ref = self._client.collection("tournaments").document(upper_id)
                upper_snap = upper_ref.get()
                if upper_snap.exists:
                    upper_data = upper_snap.to_dict() or {}
                    needs_migrate = False
                    if isinstance(upper_data, dict):
                        for k, v in upper_data.items():
                            if v is not None and (k not in merged or merged.get(k) is None or merged.get(k) == [] or merged.get(k) == {}):
                                merged[k] = v
                                needs_migrate = True
                    if needs_migrate:
                        merged["eventId"] = eid
                        self._client.collection("tournaments").document(eid).set(merged, merge=True)
                    upper_ref.delete()
            except Exception as e:
                logger.debug(f"Notice cleaning up legacy uppercase tournament doc {upper_id}: {e}")
        return merged

    def _write_tournament_doc_dict(self, event_id: str, payload: Dict[str, Any]) -> None:
        """Writes payload ONLY to the single canonical tournaments/{event_id} document in Firestore."""
        eid = str(event_id or "").strip()
        if not eid or not self._client:
            return
        try:
            ref = self._client.collection("tournaments").document(eid)
            ref.set(payload, merge=True)
        except Exception as e:
            logger.warning(f"Notice writing tournament doc {eid} to Firestore: {e}")

        # Automatically purge any legacy uppercase duplicate document if eid is mixed-case
        if eid.upper() != eid:
            try:
                upper_ref = self._client.collection("tournaments").document(eid.upper())
                if upper_ref.get().exists:
                    upper_ref.delete()
            except Exception:
                pass

    def get_tournament_master_clock(self, event_id: str) -> Optional[Dict[str, Any]]:
        """Fetches tournament round master clock from Firestore tournaments/{event_id}."""
        event_id = str(event_id).strip()
        data = self._read_tournament_doc_dict(event_id)
        if data.get("masterClock"):
            return data["masterClock"]
        return self._get_fallback_tournament_dict(event_id).get("masterClock")

    def update_tournament_master_clock(self, event_id: str, clock_data: Dict[str, Any]) -> Dict[str, Any]:
        """Updates tournament master clock in Firestore tournaments/{event_id} and propagates to rooms."""
        event_id = str(event_id).strip()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        clock_data["updatedAt"] = now_ts
        clock_data["updated_at"] = now_ts

        # Ensure round & round_num compatibility
        if "round" in clock_data and "round_num" not in clock_data:
            clock_data["round_num"] = clock_data["round"]
        elif "round_num" in clock_data and "round" not in clock_data:
            clock_data["round"] = clock_data["round_num"]

        # Ensure camelCase & snake_case compatibility
        if "durationMinutes" in clock_data and "duration_minutes" not in clock_data:
            clock_data["duration_minutes"] = clock_data["durationMinutes"]
        elif "duration_minutes" in clock_data and "durationMinutes" not in clock_data:
            clock_data["durationMinutes"] = clock_data["duration_minutes"]

        if "targetEndTime" in clock_data and "target_end_time" not in clock_data:
            clock_data["target_end_time"] = clock_data["targetEndTime"]
        elif "target_end_time" in clock_data and "targetEndTime" not in clock_data:
            clock_data["targetEndTime"] = clock_data["target_end_time"]

        if "remainingSeconds" in clock_data and "remaining_seconds" not in clock_data:
            clock_data["remaining_seconds"] = clock_data["remainingSeconds"]
        elif "remaining_seconds" in clock_data and "remainingSeconds" not in clock_data:
            clock_data["remainingSeconds"] = clock_data["remaining_seconds"]

        # Auto-calculate targetEndTime when status is running so all clients tick identically
        if str(clock_data.get("status") or "").lower() == "running" and not clock_data.get("targetEndTime"):
            rem_s = clock_data.get("remainingSeconds")
            if rem_s is None:
                rem_s = int(clock_data.get("durationMinutes") or 150) * 60
            target_ms = now_ts + int(float(rem_s) * 1000)
            clock_data["targetEndTime"] = target_ms
            clock_data["target_end_time"] = target_ms

        doc_payload = {
            "id": event_id,
            "eventId": event_id,
            "type": "Event",
            "masterClock": clock_data,
            "updatedAt": now_ts
        }

        self._write_tournament_doc_dict(event_id, doc_payload)

        fb = self._get_fallback_tournament_dict(event_id, create=True)
        fb["id"] = event_id
        fb["eventId"] = event_id
        fb["type"] = "Event"
        fb["masterClock"] = clock_data
        fb["updatedAt"] = now_ts

        # Propagate master clock directly to all table rooms for this tournament
        self.propagate_master_clock_to_rooms(event_id, clock_data)
        return clock_data

    def propagate_master_clock_to_rooms(self, event_id: str, clock_data: Dict[str, Any]) -> int:
        """Propagates tournament master clock to all associated table game rooms in Firestore and memory."""
        if not event_id:
            return 0
        event_id = str(event_id).strip()
        clean_id = event_id.replace("bcp_", "").replace("ES-", "").replace("es-", "").strip()
        count = 0
        seen_mids = set()

        prefixes = (
            f"BCP-{event_id}-", f"ES-{event_id}-", f"WH40K-BCP-{event_id}-", f"WH40K-ES-{event_id}-",
            f"BCP-{clean_id}-", f"ES-{clean_id}-", f"WH40K-BCP-{clean_id}-", f"WH40K-ES-{clean_id}-",
            f"{event_id}-R", f"{clean_id}-R",
        )

        if self._client:
            try:
                col = self._client.collection("rooms")
                for field in ("eventId", "event_id", "tournament_id"):
                    for val in (event_id, clean_id, event_id.upper(), clean_id.upper()):
                        if not val:
                            continue
                        try:
                            for doc in col.where(field, "==", val).stream():
                                mid = doc.id
                                if mid not in seen_mids:
                                    seen_mids.add(mid)
                                    doc.reference.set({"masterClock": clock_data}, merge=True)
                                    count += 1
                        except Exception:
                            pass

                for doc in col.stream():
                    mid = doc.id
                    if mid in seen_mids:
                        continue
                    mid_upper = mid.upper()
                    if any(mid_upper.startswith(p.upper()) for p in prefixes):
                        seen_mids.add(mid)
                        doc.reference.set({"masterClock": clock_data}, merge=True)
                        count += 1
            except Exception as e:
                logger.warning(f"Notice propagating master clock to Firestore rooms: {e}")

        # In-memory fallback rooms
        for mid, rdata in self._fallback_rooms.items():
            mid_upper = str(mid).upper()
            if (
                mid in seen_mids or
                any(mid_upper.startswith(p.upper()) for p in prefixes) or
                str(rdata.get("eventId") or "").lower() in (event_id.lower(), clean_id.lower()) or
                str(rdata.get("event_id") or "").lower() in (event_id.lower(), clean_id.lower()) or
                str(rdata.get("tournament_id") or "").lower() in (event_id.lower(), clean_id.lower())
            ):
                rdata["masterClock"] = clock_data
                count += 1
        return count

    def propagate_broadcast_to_rooms(self, event_id: str, broadcast_data: Optional[Dict[str, Any]]) -> int:
        """Propagates pop-up tournament broadcast announcement to all associated table game rooms in Firestore and memory."""
        if not event_id:
            return 0
        event_id = str(event_id).strip()
        clean_id = event_id.replace("bcp_", "").replace("ES-", "").replace("es-", "").strip()
        target_tbl = str((broadcast_data or {}).get("target_table") or "").strip() if isinstance(broadcast_data, dict) else ""
        count = 0
        seen_mids = set()

        def _matches_target_table(mid_str: str, rdata_dict: Optional[Dict[str, Any]]) -> bool:
            if not target_tbl:
                return True
            r_tbl = str((rdata_dict or {}).get("tableNum") or (rdata_dict or {}).get("table_number") or (rdata_dict or {}).get("table") or "").strip()
            mid_u = str(mid_str or "").upper()
            if r_tbl:
                return r_tbl == target_tbl
            return f"-T{target_tbl.upper()}" in mid_u

        prefixes = (
            f"BCP-{event_id}-", f"ES-{event_id}-", f"WH40K-BCP-{event_id}-", f"WH40K-ES-{event_id}-",
            f"BCP-{clean_id}-", f"ES-{clean_id}-", f"WH40K-BCP-{clean_id}-", f"WH40K-ES-{clean_id}-",
            f"{event_id}-R", f"{clean_id}-R",
        )

        if self._client:
            try:
                col = self._client.collection("rooms")
                for field in ("eventId", "event_id", "tournament_id"):
                    for val in (event_id, clean_id, event_id.upper(), clean_id.upper()):
                        if not val:
                            continue
                        try:
                            for doc in col.where(field, "==", val).stream():
                                mid = doc.id
                                if mid not in seen_mids:
                                    seen_mids.add(mid)
                                    if _matches_target_table(mid, doc.to_dict() if hasattr(doc, "to_dict") else None):
                                        doc.reference.set({"broadcast": broadcast_data}, merge=True)
                                        count += 1
                        except Exception:
                            pass

                for doc in col.stream():
                    mid = doc.id
                    if mid in seen_mids:
                        continue
                    mid_upper = mid.upper()
                    if any(mid_upper.startswith(p.upper()) for p in prefixes):
                        seen_mids.add(mid)
                        if _matches_target_table(mid, doc.to_dict() if hasattr(doc, "to_dict") else None):
                            doc.reference.set({"broadcast": broadcast_data}, merge=True)
                            count += 1
            except Exception as e:
                logger.warning(f"Notice propagating broadcast to Firestore rooms: {e}")

        for mid, rdata in self._fallback_rooms.items():
            mid_upper = str(mid).upper()
            if (
                mid in seen_mids or
                any(mid_upper.startswith(p.upper()) for p in prefixes) or
                str(rdata.get("eventId") or "").lower() in (event_id.lower(), clean_id.lower()) or
                str(rdata.get("event_id") or "").lower() in (event_id.lower(), clean_id.lower()) or
                str(rdata.get("tournament_id") or "").lower() in (event_id.lower(), clean_id.lower())
            ):
                if _matches_target_table(mid, rdata):
                    rdata["broadcast"] = broadcast_data
                    count += 1
        return count

    @staticmethod
    def _is_targeted_broadcast(b: Optional[Dict[str, Any]]) -> bool:
        if not isinstance(b, dict):
            return False
        return bool(
            b.get("is_targeted")
            or str(b.get("target_table") or "").strip()
            or str(b.get("target_player_id") or "").strip()
            or str(b.get("target_player_name") or "").strip()
        )

    @classmethod
    def _compute_broadcast_target_key(cls, b: Dict[str, Any]) -> str:
        if not cls._is_targeted_broadcast(b):
            return "general"
        existing_key = str(b.get("target_key") or "").strip()
        if existing_key:
            return existing_key
        pid = str(b.get("target_player_id") or "").strip().lower()
        pname = str(b.get("target_player_name") or "").strip().lower()
        tbl = str(b.get("target_table") or "").strip()
        if pid:
            return f"player_{pid}"
        if pname and " vs " not in pname and " & " not in pname and "," not in pname:
            clean_p = re.sub(r"[^a-z0-9]+", "_", pname).strip("_")
            return f"player_{clean_p}" if not tbl else f"table_{tbl}_player_{clean_p}"
        if tbl:
            return f"table_{tbl}"
        return str(b.get("id") or "targeted")

    def _sync_active_broadcast_index(self, event_id: str, broadcast_data: Optional[Dict[str, Any]], write_firestore: bool = False, index_key: Optional[str] = None) -> None:
        """Updates the global _active_broadcasts index in memory and optionally Firestore so wildcard '*' queries work across all workers."""
        eid = str(event_id or "").strip()
        if not eid or eid == "_active_broadcasts":
            return
        slot_key = str(index_key or eid).strip()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        fb_idx = self._get_fallback_tournament_dict("_active_broadcasts", create=True)
        if not isinstance(fb_idx.get("broadcasts"), dict):
            fb_idx["broadcasts"] = {}
        if isinstance(broadcast_data, dict) and broadcast_data.get("message") and broadcast_data.get("active", True) is not False:
            fb_idx["broadcasts"][slot_key] = dict(broadcast_data)
        else:
            fb_idx["broadcasts"].pop(slot_key, None)
        fb_idx["updatedAt"] = now_ts

        if write_firestore and self._client:
            try:
                ref = self._client.collection("tournaments").document("_active_broadcasts")
                ref.set(
                    {
                        "broadcasts": {
                            slot_key: (dict(broadcast_data) if (isinstance(broadcast_data, dict) and broadcast_data.get("message") and broadcast_data.get("active", True) is not False) else None)
                        },
                        "updatedAt": now_ts,
                    },
                    merge=True,
                )
            except Exception as e:
                logger.debug(f"Notice updating _active_broadcasts in Firestore for {slot_key}: {e}")

    def get_tournament_broadcast(self, event_id: str) -> Optional[Dict[str, Any]]:
        """Fetches active general pop-up broadcast announcement for tournament from Firestore."""
        event_id = str(event_id).strip()
        if not event_id or event_id == "_active_broadcasts":
            return None
        data = self._read_tournament_doc_dict(event_id)
        fb = self._get_fallback_tournament_dict(event_id)
        doc_ts = int(data.get("updatedAt") or 0)
        fb_ts = int(fb.get("updatedAt") or 0)
        if fb_ts > doc_ts and "broadcast" in fb:
            b = fb.get("broadcast")
        else:
            b = data.get("broadcast") if "broadcast" in data else fb.get("broadcast")
        if isinstance(b, dict) and b.get("message") and b.get("active", True) is not False:
            if not self._is_targeted_broadcast(b):
                self._sync_active_broadcast_index(event_id, b, write_firestore=False)
                return b
        return None

    def get_tournament_targeted_broadcasts(self, event_id: str) -> List[Dict[str, Any]]:
        """Fetches active targeted (table/player) live banners for a tournament without colliding with the general broadcast."""
        event_id = str(event_id).strip()
        if not event_id or event_id == "_active_broadcasts":
            return []
        data = self._read_tournament_doc_dict(event_id)
        fb = self._get_fallback_tournament_dict(event_id)
        raw_list = data.get("targeted_broadcasts") if isinstance(data.get("targeted_broadcasts"), list) else (
            fb.get("targeted_broadcasts") if isinstance(fb.get("targeted_broadcasts"), list) else []
        )
        # Migrate legacy targeted broadcast if it was stored in 'broadcast'
        legacy_b = data.get("broadcast") if "broadcast" in data else fb.get("broadcast")
        out: List[Dict[str, Any]] = []
        seen_keys = set()
        for item in raw_list:
            if isinstance(item, dict) and item.get("message") and item.get("active", True) is not False:
                tk = self._compute_broadcast_target_key(item)
                if tk not in seen_keys:
                    seen_keys.add(tk)
                    item_copy = dict(item)
                    item_copy["is_targeted"] = True
                    item_copy["target_key"] = tk
                    out.append(item_copy)
        if isinstance(legacy_b, dict) and legacy_b.get("message") and legacy_b.get("active", True) is not False and self._is_targeted_broadcast(legacy_b):
            tk = self._compute_broadcast_target_key(legacy_b)
            if tk not in seen_keys:
                seen_keys.add(tk)
                item_copy = dict(legacy_b)
                item_copy["is_targeted"] = True
                item_copy["target_key"] = tk
                out.append(item_copy)
        return out

    def publish_tournament_broadcast(self, event_id: str, broadcast_data: Dict[str, Any]) -> Dict[str, Any]:
        """Publishes general or targeted pop-up broadcast announcement to Firestore tournaments/{event_id} and propagates to Game Tracker rooms."""
        event_id = str(event_id).strip()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        import uuid as _uuid
        if not broadcast_data.get("id"):
            broadcast_data["id"] = f"msg_{int(now_ts)}_{_uuid.uuid4().hex[:6]}"
        broadcast_data["eventId"] = event_id
        broadcast_data["event_id"] = event_id
        broadcast_data["active"] = bool(broadcast_data.get("active", True))
        lvl = broadcast_data.get("level") or broadcast_data.get("type") or "info"
        broadcast_data["level"] = lvl
        broadcast_data["type"] = lvl
        auth = broadcast_data.get("author_name") or broadcast_data.get("author") or "Tournament Organizer"
        broadcast_data["author_name"] = auth
        broadcast_data["author"] = auth
        iso_now = datetime.now(timezone.utc).isoformat()
        broadcast_data["timestamp"] = now_ts
        broadcast_data["createdAt"] = now_ts
        broadcast_data["created_at"] = iso_now
        broadcast_data["published_at"] = iso_now

        is_targeted = self._is_targeted_broadcast(broadcast_data)
        broadcast_data["is_targeted"] = is_targeted
        target_key = self._compute_broadcast_target_key(broadcast_data)
        broadcast_data["target_key"] = target_key

        existing_history = []
        d = self._read_tournament_doc_dict(event_id)
        fb = self._get_fallback_tournament_dict(event_id, create=True)
        if isinstance(d.get("announcements"), list):
            existing_history = [a for a in d["announcements"] if isinstance(a, dict) and a.get("id") != broadcast_data["id"]]
        elif isinstance(fb.get("announcements"), list):
            existing_history = [a for a in fb["announcements"] if isinstance(a, dict) and a.get("id") != broadcast_data["id"]]

        existing_history.insert(0, dict(broadcast_data))
        existing_history = existing_history[:30]

        if is_targeted:
            current_targeted = self.get_tournament_targeted_broadcasts(event_id)
            updated_targeted = [
                t for t in current_targeted
                if isinstance(t, dict) and t.get("id") != broadcast_data["id"] and self._compute_broadcast_target_key(t) != target_key
            ]
            updated_targeted.insert(0, dict(broadcast_data))
            updated_targeted = updated_targeted[:25]

            doc_patch: Dict[str, Any] = {
                "eventId": event_id,
                "targeted_broadcasts": updated_targeted,
                "announcements": existing_history,
                "updatedAt": now_ts,
            }
            # If legacy doc had a targeted broadcast sitting in general 'broadcast', clean it up so it doesn't masquerade as general
            if isinstance(d.get("broadcast"), dict) and self._is_targeted_broadcast(d.get("broadcast")):
                doc_patch["broadcast"] = None
                fb["broadcast"] = None

            self._write_tournament_doc_dict(event_id, doc_patch)
            fb["targeted_broadcasts"] = updated_targeted
            fb["announcements"] = existing_history
            fb["updatedAt"] = now_ts

            idx_slot = f"{event_id}__target__{target_key}"
            self._sync_active_broadcast_index(event_id, broadcast_data, write_firestore=True, index_key=idx_slot)
        else:
            self._write_tournament_doc_dict(event_id, {
                "eventId": event_id,
                "broadcast": broadcast_data,
                "announcements": existing_history,
                "updatedAt": now_ts,
            })
            fb["broadcast"] = broadcast_data
            fb["announcements"] = existing_history
            fb["updatedAt"] = now_ts

            self._sync_active_broadcast_index(event_id, broadcast_data, write_firestore=True, index_key=event_id)

        # Propagate pop-up broadcast directly to matching active Game Tracker rooms
        self.propagate_broadcast_to_rooms(event_id, broadcast_data)
        return broadcast_data

    def clear_tournament_broadcast(self, event_id: str, target_id: Optional[str] = None) -> bool:
        """Clears the active general broadcast or a specific targeted broadcast in Firestore while preserving announcement history."""
        event_id = str(event_id).strip()
        clean_target = str(target_id or "").strip()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        fb = self._get_fallback_tournament_dict(event_id)

        if not clean_target or clean_target == "general":
            # Clear general app-wide banner ONLY; preserve active targeted_broadcasts
            self._write_tournament_doc_dict(event_id, {"eventId": event_id, "broadcast": None, "updatedAt": now_ts})
            if fb is not None:
                fb["broadcast"] = None
                fb["updatedAt"] = now_ts
            self._sync_active_broadcast_index(event_id, None, write_firestore=True, index_key=event_id)
            self.propagate_broadcast_to_rooms(event_id, None)
            return True

        current_targeted = self.get_tournament_targeted_broadcasts(event_id)
        if clean_target == "all_targeted":
            for t in current_targeted:
                tk = self._compute_broadcast_target_key(t)
                self._sync_active_broadcast_index(event_id, None, write_firestore=True, index_key=f"{event_id}__target__{tk}")
            self._write_tournament_doc_dict(event_id, {"eventId": event_id, "targeted_broadcasts": [], "updatedAt": now_ts})
            if fb is not None:
                fb["targeted_broadcasts"] = []
                fb["updatedAt"] = now_ts
            return True

        if clean_target == "all":
            for t in current_targeted:
                tk = self._compute_broadcast_target_key(t)
                self._sync_active_broadcast_index(event_id, None, write_firestore=True, index_key=f"{event_id}__target__{tk}")
            self._write_tournament_doc_dict(event_id, {"eventId": event_id, "broadcast": None, "targeted_broadcasts": [], "updatedAt": now_ts})
            if fb is not None:
                fb["broadcast"] = None
                fb["targeted_broadcasts"] = []
                fb["updatedAt"] = now_ts
            self._sync_active_broadcast_index(event_id, None, write_firestore=True, index_key=event_id)
            self.propagate_broadcast_to_rooms(event_id, None)
            return True

        # Clear a specific targeted broadcast by id or target_key
        remaining = []
        removed_items = []
        for t in current_targeted:
            tk = self._compute_broadcast_target_key(t)
            if str(t.get("id") or "") == clean_target or tk == clean_target:
                removed_items.append((tk, t))
            else:
                remaining.append(t)

        for tk, _ in removed_items:
            self._sync_active_broadcast_index(event_id, None, write_firestore=True, index_key=f"{event_id}__target__{tk}")

        doc_patch: Dict[str, Any] = {"eventId": event_id, "targeted_broadcasts": remaining, "updatedAt": now_ts}
        # Also clear general broadcast if its ID matched clean_target
        d = self._read_tournament_doc_dict(event_id)
        gen_b = d.get("broadcast") if "broadcast" in d else (fb.get("broadcast") if fb else None)
        if isinstance(gen_b, dict) and (str(gen_b.get("id") or "") == clean_target or self._is_targeted_broadcast(gen_b)):
            doc_patch["broadcast"] = None
            if fb is not None:
                fb["broadcast"] = None
            self._sync_active_broadcast_index(event_id, None, write_firestore=True, index_key=event_id)

        self._write_tournament_doc_dict(event_id, doc_patch)
        if fb is not None:
            fb["targeted_broadcasts"] = remaining
            fb["updatedAt"] = now_ts
        return True

    def get_event_news_posts(self, event_id: str) -> List[Dict[str, Any]]:
        """Fetches News & Info posts published by the TO for an event from PostgreSQL."""
        event_id = str(event_id).strip()
        try:
            from database import get_db
            db = get_db()
            posts = db.get_event_news_posts(event_id)
            if posts:
                return posts
        except Exception as e:
            logger.debug(f"Notice reading news_posts from PostgreSQL for {event_id}: {e}")

        # Fallback if legacy posts existed in memory/Firestore
        fb_posts = self._get_fallback_tournament_dict(event_id).get("news_posts")
        if isinstance(fb_posts, list):
            valid = [p for p in fb_posts if isinstance(p, dict)]
            valid.sort(key=lambda p: (1 if p.get("pinned") else 0, p.get("createdAt") or 0), reverse=True)
            return valid
        return []

    def save_event_news_post(self, event_id: str, post_data: Dict[str, Any]) -> Dict[str, Any]:
        """Creates or updates a TO News & Info post in PostgreSQL."""
        event_id = str(event_id).strip()
        try:
            from database import get_db
            db = get_db()
            return db.save_event_news_post(event_id, post_data)
        except Exception as e:
            logger.warning(f"Notice saving news_post to PostgreSQL for {event_id}: {e}")
            import uuid as _uuid
            now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
            now_iso = datetime.now(timezone.utc).isoformat()
            existing = self.get_event_news_posts(event_id)
            post_id = str(post_data.get("id") or f"news_{int(now_ts)}_{_uuid.uuid4().hex[:6]}").strip()
            prev = next((p for p in existing if str(p.get("id")) == post_id), None)
            record = {
                "id": post_id,
                "event_id": event_id,
                "title": str(post_data.get("title") or "Event Update").strip(),
                "category": str(post_data.get("category") or "General Info").strip(),
                "body": str(post_data.get("body") or post_data.get("content") or "").strip(),
                "pinned": bool(post_data.get("pinned", False)),
                "author": str(post_data.get("author") or "Tournament Organizer").strip(),
                "createdAt": (prev.get("createdAt") if prev else None) or now_ts,
                "created_at": (prev.get("created_at") if prev else None) or now_iso,
                "updatedAt": now_ts,
                "updated_at": now_iso,
            }
            updated = [p for p in existing if str(p.get("id")) != post_id]
            updated.insert(0, record)
            updated.sort(key=lambda p: (1 if p.get("pinned") else 0, p.get("createdAt") or 0), reverse=True)
            fb = self._get_fallback_tournament_dict(event_id, create=True)
            fb["news_posts"] = updated
            return record

    def delete_event_news_post(self, event_id: str, post_id: str) -> bool:
        """Deletes a TO News & Info post from PostgreSQL."""
        event_id = str(event_id).strip()
        post_id = str(post_id).strip()
        try:
            from database import get_db
            db = get_db()
            db.delete_event_news_post(event_id, post_id)
        except Exception as e:
            logger.warning(f"Notice deleting news_post from PostgreSQL for {event_id}: {e}")
        fb = self._get_fallback_tournament_dict(event_id)
        if fb and isinstance(fb.get("news_posts"), list):
            fb["news_posts"] = [p for p in fb["news_posts"] if str(p.get("id")) != post_id]
        return True

    def get_event_to_hub_state(self, event_id: str) -> Dict[str, Any]:
        """Retrieves real-time Firestore state (masterClock, broadcast, targeted_broadcasts, announcements, judge_calls) + PostgreSQL news_posts."""
        event_id = str(event_id).strip()
        doc_data = self._read_tournament_doc_dict(event_id)
        fb_data = self._get_fallback_tournament_dict(event_id)
        doc_ts = int(doc_data.get("updatedAt") or 0)
        fb_ts = int(fb_data.get("updatedAt") or 0)

        master_clock = (fb_data.get("masterClock") if (fb_ts > doc_ts and "masterClock" in fb_data) else None) or doc_data.get("masterClock") or fb_data.get("masterClock")
        if fb_ts > doc_ts and "broadcast" in fb_data:
            raw_broadcast = fb_data.get("broadcast")
        else:
            raw_broadcast = doc_data.get("broadcast") if "broadcast" in doc_data else fb_data.get("broadcast")
        if isinstance(raw_broadcast, dict) and raw_broadcast.get("active") is False:
            raw_broadcast = None

        # Only non-targeted broadcasts belong in general broadcast / active_broadcast
        general_broadcast = None
        if isinstance(raw_broadcast, dict) and raw_broadcast.get("message") and not self._is_targeted_broadcast(raw_broadcast):
            general_broadcast = raw_broadcast
            self._sync_active_broadcast_index(event_id, general_broadcast, write_firestore=False, index_key=event_id)

        targeted_broadcasts = self.get_tournament_targeted_broadcasts(event_id)
        for tb in targeted_broadcasts:
            tk = self._compute_broadcast_target_key(tb)
            self._sync_active_broadcast_index(event_id, tb, write_firestore=False, index_key=f"{event_id}__target__{tk}")

        announcements = doc_data.get("announcements") if isinstance(doc_data.get("announcements"), list) else (
            fb_data.get("announcements") if isinstance(fb_data.get("announcements"), list) else []
        )
        if not announcements and isinstance(general_broadcast, dict) and general_broadcast.get("message"):
            announcements = [general_broadcast]

        # News & Info posts live in PostgreSQL (with automatic fallback)
        news_posts = self.get_event_news_posts(event_id)
        if not news_posts:
            legacy_posts = doc_data.get("news_posts") if isinstance(doc_data.get("news_posts"), list) else []
            if legacy_posts:
                news_posts = [p for p in legacy_posts if isinstance(p, dict)]
                news_posts.sort(key=lambda p: (1 if p.get("pinned") else 0, p.get("createdAt") or 0), reverse=True)

        judge_calls = self.list_judge_calls(event_id, active_only=False)

        return {
            "event_id": event_id,
            "master_clock": master_clock,
            "clock": master_clock,
            "broadcast": general_broadcast,
            "active_broadcast": general_broadcast,
            "targeted_broadcasts": targeted_broadcasts,
            "announcements": announcements,
            "news_posts": news_posts,
            "judge_calls": judge_calls,
            "sync_backends": {
                "announcements": "firestore",
                "clocks": "firestore",
                "flags": "firestore",
                "news_posts": "postgresql",
            },
        }

    def get_active_broadcasts_for_events(self, event_ids: List[str]) -> List[Dict[str, Any]]:
        """Fetches active general & targeted announcement banners across a list of event IDs (or '*' for all events) for the app-wide banner."""
        results = []
        seen_ids = set()
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

        def _add_candidate(eid_str: str, b_obj: Any) -> None:
            clean_eid = str(eid_str or "").split("__target__")[0].strip()
            if not clean_eid or clean_eid == "_active_broadcasts":
                return
            if not isinstance(b_obj, dict) or not b_obj.get("message") or b_obj.get("active", True) is False:
                return
            exp = b_obj.get("expiresAt") or b_obj.get("expires_at")
            if exp and isinstance(exp, (int, float)) and exp < now_ms:
                return
            bid = str(b_obj.get("id") or f"{clean_eid}_{b_obj.get('target_key') or 'general'}_{b_obj.get('timestamp') or ''}")
            if bid in seen_ids:
                return
            seen_ids.add(bid)
            b_copy = dict(b_obj)
            b_copy["event_id"] = b_copy.get("event_id") or b_copy.get("eventId") or clean_eid
            b_copy["is_targeted"] = self._is_targeted_broadcast(b_copy)
            results.append(b_copy)

        raw_list = [str(x or "").strip() for x in (event_ids or []) if str(x or "").strip()]
        include_wildcard = (not raw_list) or any(x.lower() in ("*", "all") for x in raw_list)

        # 1. Check explicit event IDs first (both general broadcast and targeted_broadcasts)
        checked_eids = set()
        for eid in raw_list:
            if eid.lower() in ("*", "all", "_active_broadcasts") or eid in checked_eids:
                continue
            checked_eids.add(eid)
            b = self.get_tournament_broadcast(eid)
            _add_candidate(eid, b)
            for tb in self.get_tournament_targeted_broadcasts(eid):
                _add_candidate(eid, tb)

        # 2. If wildcard '*' or 'all' is requested, read global _active_broadcasts index from Firestore & memory
        if include_wildcard:
            if self._client:
                try:
                    snap = self._client.collection("tournaments").document("_active_broadcasts").get()
                    if snap.exists:
                        idx_data = snap.to_dict() or {}
                        b_map = idx_data.get("broadcasts")
                        if isinstance(b_map, dict):
                            for k_eid, b_val in b_map.items():
                                _add_candidate(str(k_eid).strip(), b_val)
                except Exception as e:
                    logger.debug(f"Notice reading _active_broadcasts from Firestore: {e}")

            fb_idx = self._get_fallback_tournament_dict("_active_broadcasts")
            if isinstance(fb_idx.get("broadcasts"), dict):
                for k_eid, b_val in list(fb_idx["broadcasts"].items()):
                    _add_candidate(str(k_eid).strip(), b_val)

            for fb_eid, fb_doc in list(self._fallback_tournaments.items()):
                if fb_eid == "_active_broadcasts":
                    continue
                if isinstance(fb_doc, dict):
                    if "broadcast" in fb_doc:
                        _add_candidate(str(fb_eid).strip(), fb_doc.get("broadcast"))
                    if isinstance(fb_doc.get("targeted_broadcasts"), list):
                        for tb in fb_doc["targeted_broadcasts"]:
                            _add_candidate(str(fb_eid).strip(), tb)

        results.sort(key=lambda x: x.get("timestamp") or x.get("createdAt") or 0, reverse=True)
        return results

    @staticmethod
    def _parse_stream_embed(url: str, platform: Optional[str] = None) -> Tuple[str, str]:
        """Parses a YouTube or Twitch stream URL into (platform, embed_url)."""
        import re
        url = str(url or "").strip()
        p = (platform or "").strip().lower()
        if "twitch.tv" in url or p == "twitch":
            chan = url.rstrip("/").split("/")[-1].split("?")[0]
            embed = f"https://player.twitch.tv/?channel={chan}&parent=localhost&parent=127.0.0.1&parent=omnitactica.com&muted=true"
            return "twitch", embed
        # YouTube default
        yt_match = re.search(r'(?:v=|\/live\/|youtu\.be\/|\/embed\/)([a-zA-Z0-9_-]{11})', url)
        video_id = yt_match.group(1) if yt_match else "jfKfPfyJRdk"
        embed = f"https://www.youtube-nocookie.com/embed/{video_id}?autoplay=1&mute=1"
        return "youtube", embed

    def get_event_livestreams(self, event_id: str) -> List[Dict[str, Any]]:
        """Fetches active livestreams for an event."""
        event_id = str(event_id).strip()
        streams = None
        if self._client:
            try:
                ref = self.get_tournament_doc_ref(event_id)
                if ref:
                    snap = ref.get()
                    if snap.exists:
                        data = snap.to_dict() or {}
                        streams = data.get("livestreams")
            except Exception as e:
                logger.warning(f"Notice reading livestreams from Firestore: {e}")
        
        if streams is None:
            streams = self._fallback_tournaments.get(event_id, {}).get("livestreams")

        # Pre-seed default streams for live demo events if none exist
        if streams is None and event_id in ("ev_ongoing_gt_live", "bcp_ongoing_gt"):
            streams = [
                {
                    "id": "stream-1",
                    "event_id": event_id,
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
                    "event_id": event_id,
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
                    "event_id": event_id,
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
            self.set_event_livestreams(event_id, streams)
            
        return streams or []

    def set_event_livestreams(self, event_id: str, streams: List[Dict[str, Any]]):
        """Sets full list of livestreams for an event."""
        event_id = str(event_id).strip()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        if self._client:
            try:
                ref = self.get_tournament_doc_ref(event_id)
                if ref:
                    ref.set({"eventId": event_id, "livestreams": streams, "updatedAt": now_ts}, merge=True)
            except Exception as e:
                logger.warning(f"Notice saving livestreams to Firestore: {e}")

        if event_id not in self._fallback_tournaments:
            self._fallback_tournaments[event_id] = {}
        self._fallback_tournaments[event_id]["livestreams"] = streams
        self._fallback_tournaments[event_id]["updatedAt"] = now_ts

    def save_event_livestream(self, event_id: str, stream_data: Dict[str, Any]) -> Dict[str, Any]:
        """Adds or updates a livestream for a table in an event."""
        import uuid as _uuid
        event_id = str(event_id).strip()
        existing = self.get_event_livestreams(event_id)
        
        channel = str(stream_data.get("channel") or "Feature Stream").strip()
        raw_t = stream_data.get("table_number")
        if raw_t is None:
            raw_t = stream_data.get("tableNumber")
        table_num = int(raw_t) if raw_t is not None else 1
        raw_r = stream_data.get("round_number")
        if raw_r is None:
            raw_r = stream_data.get("roundNumber")
        round_num = int(raw_r) if (raw_r is not None and str(raw_r).isdigit() and int(raw_r) > 0) else None
        default_title = "Main Desk Live Broadcast" if table_num == 0 else f"Table {table_num} Live Broadcast"
        title = str(stream_data.get("title") or default_title).strip()
        url = str(stream_data.get("stream_url") or stream_data.get("streamUrl") or "").strip()
        platform, embed_url = self._parse_stream_embed(url, stream_data.get("platform"))
        now_iso = datetime.now(timezone.utc).isoformat()

        explicit_id = str(stream_data.get("id") or "").strip()
        existing_match = next(
            (
                s for s in existing
                if (explicit_id and str(s.get("id")) == explicit_id)
                or (
                    not explicit_id
                    and str(s.get("channel") or "").strip().lower() == channel.lower()
                    and int(s.get("table_number", -1)) == table_num
                )
            ),
            None,
        )
        stream_id = (
            explicit_id
            or (existing_match.get("id") if existing_match else None)
            or f"stream_{int(datetime.now(timezone.utc).timestamp())}_{_uuid.uuid4().hex[:6]}"
        )
        
        record = {
            "id": stream_id,
            "event_id": event_id,
            "table_number": table_num,
            "round_number": round_num,
            "channel": channel,
            "platform": platform,
            "title": title,
            "stream_url": url or "https://www.youtube.com/watch?v=live",
            "embed_url": stream_data.get("embed_url") or embed_url,
            "is_live": bool(stream_data.get("is_live", True)),
            "viewers": int(stream_data.get("viewers") or 250),
            "created_at": (existing_match.get("created_at") if existing_match else None) or now_iso,
            "updated_at": now_iso,
        }
        
        if existing_match:
            updated = [record if str(s.get("id")) == str(stream_id) else s for s in existing]
        else:
            updated = [record] + [s for s in existing if str(s.get("id")) != str(stream_id)]
        
        self.set_event_livestreams(event_id, updated)
        return record

    def delete_event_livestream(self, event_id: str, stream_id: str) -> bool:
        """Removes a livestream from an event."""
        event_id = str(event_id).strip()
        stream_id = str(stream_id).strip()
        existing = self.get_event_livestreams(event_id)
        updated = [s for s in existing if str(s.get("id")) != stream_id]
        self.set_event_livestreams(event_id, updated)
        return True

    def save_judge_call(self, event_id: str, call_data: Dict[str, Any]) -> Dict[str, Any]:
        """Saves a judge dispatch call to tournaments/{event_id} main documents and subcollections."""
        event_id = str(event_id).strip()
        import uuid as _uuid
        call_id = call_data.get("id") or call_data.get("call_id") or f"JC-{_uuid.uuid4().hex[:8].upper()}"
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        now_iso = datetime.now(timezone.utc).isoformat()

        t_num = call_data.get("tableNum") or call_data.get("table_num") or 1
        m_id = call_data.get("matchId") or call_data.get("match_id")
        p_name = call_data.get("playerName") or call_data.get("player_name") or (call_data.get("caller", {}).get("playerName") if isinstance(call_data.get("caller"), dict) else "Competitor")
        assigned = call_data.get("assignedJudge") or call_data.get("assigned_judge")

        record = {
            "id": call_id,
            "call_id": call_id,
            "eventId": event_id,
            "event_id": event_id,
            "tableNum": t_num,
            "table_num": t_num,
            "matchId": m_id,
            "match_id": m_id,
            "caller": call_data.get("caller") or {"playerName": p_name},
            "player_name": p_name,
            "opponent": call_data.get("opponent"),
            "category": call_data.get("category") or "Rules Dispute",
            "note": call_data.get("note") or call_data.get("notes") or "",
            "status": call_data.get("status") or "pending",
            "assignedJudge": assigned if isinstance(assigned, dict) else ({"name": assigned} if assigned else None),
            "assigned_judge": assigned if isinstance(assigned, str) else (assigned.get("name") if isinstance(assigned, dict) else None),
            "createdAt": call_data.get("createdAt") or now_ts,
            "created_at": now_iso,
            "enRouteAt": call_data.get("enRouteAt"),
            "resolvedAt": call_data.get("resolvedAt")
        }

        target_eid = event_id

        if self._client:
            # 1. Save to subcollection for backward compatibility
            try:
                ref = self._client.collection("tournaments").document(target_eid).collection("judge_calls").document(call_id)
                ref.set(record, merge=True)
            except Exception as e:
                logger.warning(f"Notice saving judge call to Firestore subcollection: {e}")

            # 2. Save directly into single Tournament document arrays (tournaments/{id})
            try:
                doc_ref = self._client.collection("tournaments").document(target_eid)
                snap = doc_ref.get()
                curr_calls = []
                if snap.exists:
                    d = snap.to_dict() or {}
                    raw_list = d.get("judge_calls") or d.get("flags") or []
                    if isinstance(raw_list, list):
                        curr_calls = [c for c in raw_list if isinstance(c, dict) and c.get("id") != call_id and c.get("call_id") != call_id]
                curr_calls.insert(0, record)
                doc_ref.set({
                    "id": target_eid,
                    "eventId": target_eid,
                    "type": "Event",
                    "judge_calls": curr_calls,
                    "flags": curr_calls,
                    "updatedAt": now_ts
                }, merge=True)
            except Exception as e:
                logger.warning(f"Notice updating judge_calls array on Firestore tournaments/{target_eid}: {e}")

        if target_eid not in self._fallback_judge_calls:
            self._fallback_judge_calls[target_eid] = {}
        self._fallback_judge_calls[target_eid][call_id] = record

        if target_eid not in self._fallback_tournaments:
            self._fallback_tournaments[target_eid] = {"id": target_eid, "eventId": target_eid, "type": "Event"}
        fb_calls = self._fallback_tournaments[target_eid].get("judge_calls", [])
        fb_calls = [c for c in fb_calls if c.get("id") != call_id and c.get("call_id") != call_id]
        fb_calls.insert(0, record)
        self._fallback_tournaments[target_eid]["judge_calls"] = fb_calls
        self._fallback_tournaments[target_eid]["flags"] = fb_calls
        self._fallback_tournaments[target_eid]["updatedAt"] = now_ts
        return record

    def update_judge_call_status(
        self,
        event_id: str,
        call_id: str,
        status: str,
        assigned_judge: Optional[Any] = None
    ) -> bool:
        """Updates status of a judge call (en_route, resolved, cancelled) in subcollections and main documents."""
        event_id = str(event_id).strip()
        call_id = str(call_id).strip()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)

        updates: Dict[str, Any] = {"status": status, "updatedAt": now_ts, "updated_at": now_ts}
        if assigned_judge:
            if isinstance(assigned_judge, str):
                updates["assignedJudge"] = {"name": assigned_judge}
                updates["assigned_judge"] = assigned_judge
            elif isinstance(assigned_judge, dict):
                updates["assignedJudge"] = assigned_judge
                updates["assigned_judge"] = assigned_judge.get("name") or assigned_judge.get("displayName") or str(assigned_judge)
        if status == "en_route":
            updates["enRouteAt"] = now_ts
        elif status == "resolved":
            updates["resolvedAt"] = now_ts

        target_event_ids = [event_id]
        if event_id.upper() not in target_event_ids:
            target_event_ids.append(event_id.upper())
        if event_id.lower() not in target_event_ids:
            target_event_ids.append(event_id.lower())

        if self._client:
            for target_eid in target_event_ids:
                # 1. Subcollection update - only if doc exists
                try:
                    ref = self._client.collection("tournaments").document(target_eid).collection("judge_calls").document(call_id)
                    snap = ref.get()
                    if snap.exists:
                        ref.set(updates, merge=True)
                except Exception as e:
                    logger.warning(f"Notice updating judge call in Firestore subcollection: {e}")

                # 2. Main document arrays update (tournaments) - only if doc exists
                try:
                    doc_ref = self._client.collection("tournaments").document(target_eid)
                    snap = doc_ref.get()
                    if snap.exists:
                        d = snap.to_dict() or {}
                        raw_list = d.get("judge_calls") or d.get("flags") or []
                        if isinstance(raw_list, list):
                            found = False
                            for c in raw_list:
                                if isinstance(c, dict) and (c.get("id") == call_id or c.get("call_id") == call_id):
                                    c.update(updates)
                                    found = True
                            if found:
                                doc_ref.set({
                                    "judge_calls": raw_list,
                                    "flags": raw_list,
                                    "updatedAt": now_ts
                                }, merge=True)
                except Exception as e:
                    logger.warning(f"Notice updating judge call status in tournaments/{target_eid}: {e}")

        for target_eid in target_event_ids:
            if target_eid in self._fallback_judge_calls and call_id in self._fallback_judge_calls[target_eid]:
                self._fallback_judge_calls[target_eid][call_id].update(updates)

            if target_eid in self._fallback_tournaments:
                raw_list = self._fallback_tournaments[target_eid].get("judge_calls", [])
                for c in raw_list:
                    if c.get("id") == call_id or c.get("call_id") == call_id:
                        c.update(updates)
                self._fallback_tournaments[target_eid]["flags"] = raw_list
                self._fallback_tournaments[target_eid]["updatedAt"] = now_ts

        return True

    def list_judge_calls(self, event_id: str, active_only: bool = False) -> List[Dict[str, Any]]:
        """Queries judge calls for a tournament from Firestore."""
        event_id = str(event_id).strip()
        calls = []
        seen = set()

        target_event_ids = [event_id]
        if event_id.upper() not in target_event_ids:
            target_event_ids.append(event_id.upper())
        if event_id.lower() not in target_event_ids:
            target_event_ids.append(event_id.lower())

        if self._client:
            for target_eid in target_event_ids:
                # 1. Check the Tournament document arrays first (fastest, single-doc real-time source)
                try:
                    doc_ref = self._client.collection("tournaments").document(target_eid)
                    snap = doc_ref.get()
                    if snap.exists:
                        d = snap.to_dict() or {}
                        arr = d.get("judge_calls") or d.get("flags") or []
                        if isinstance(arr, list):
                            for c in arr:
                                if isinstance(c, dict):
                                    cid = c.get("id") or c.get("call_id")
                                    if cid and cid not in seen:
                                        if active_only and c.get("status") not in ("pending", "en_route"):
                                            continue
                                        seen.add(cid)
                                        calls.append(c)
                except Exception as e:
                    logger.warning(f"Notice reading judge_calls from tournaments/{target_eid}: {e}")

                # 2. Subcollection fallback
                try:
                    col = self._client.collection("tournaments").document(target_eid).collection("judge_calls")
                    for doc in col.stream():
                        d = doc.to_dict() or {}
                        cid = d.get("id") or doc.id
                        if cid in seen:
                            continue
                        if active_only and d.get("status") not in ("pending", "en_route"):
                            continue
                        seen.add(cid)
                        calls.append(d)
                except Exception as e:
                    logger.warning(f"Notice listing judge calls from Firestore: {e}")

        for target_eid in target_event_ids:
            # 3. Fallback tournaments doc
            fb_tourn_calls = self._fallback_tournaments.get(target_eid, {}).get("judge_calls", [])
            for c in fb_tourn_calls:
                cid = c.get("id") or c.get("call_id")
                if cid and cid not in seen:
                    if active_only and c.get("status") not in ("pending", "en_route"):
                        continue
                    seen.add(cid)
                    calls.append(c)

            # 4. Fallback judge calls dictionary
            for cid, d in self._fallback_judge_calls.get(target_eid, {}).items():
                if cid not in seen:
                    if active_only and d.get("status") not in ("pending", "en_route"):
                        continue
                    seen.add(cid)
                    calls.append(d)

        calls.sort(key=lambda c: c.get("createdAt") or 0, reverse=True)
        return calls

    def delete_event_rooms(self, event_id: str) -> int:
        """
        Deletes all table game rooms in Firestore associated with an event.
        Ensures tournament table rooms are managed strictly by the event.
        """
        if not event_id:
            return 0
        event_id = str(event_id).strip()
        clean_id = (
            event_id.replace("bcp_", "")
            .replace("BCP_", "")
            .replace("ES-", "")
            .replace("es-", "")
            .replace("event/", "")
            .strip()
        )
        deleted_count = 0
        seen_mids = set()

        id_variants = {
            event_id,
            event_id.upper(),
            event_id.lower(),
            clean_id,
            clean_id.upper(),
            clean_id.lower(),
            f"ES-{clean_id.upper()}",
            f"es-{clean_id.lower()}",
            f"BCP-{clean_id.upper()}",
            f"bcp_{clean_id}",
            f"BCP_{clean_id}",
            f"event/{clean_id}",
            f"event/{clean_id.lower()}",
        }
        id_variants.discard("")

        prefixes = []
        exacts = []
        for v in id_variants:
            prefixes.extend([
                f"BCP-{v}-", f"ES-{v}-", f"WH40K-BCP-{v}-", f"WH40K-ES-{v}-",
                f"{v}-R", f"MATCH-{v}-"
            ])
            exacts.extend([f"BCP-{v}", f"ES-{v}"])

        if self._client:
            try:
                col = self._client.collection("rooms")
                for field in ("eventId", "event_id", "tournament_id"):
                    for val in id_variants:
                        try:
                            for doc in col.where(field, "==", val).stream():
                                mid = doc.id
                                if mid not in seen_mids:
                                    seen_mids.add(mid)
                                    # Delete any subcollections of the room doc
                                    for sub in ("messages", "dice_history"):
                                        try:
                                            for s_doc in doc.reference.collection(sub).stream():
                                                s_doc.reference.delete()
                                        except Exception:
                                            pass
                                    doc.reference.delete()
                                    deleted_count += 1
                        except Exception:
                            pass

                id_variants_lower = {v.lower() for v in id_variants}
                for doc in col.stream():
                    mid = doc.id
                    if mid in seen_mids:
                        continue
                    mid_upper = mid.upper()
                    is_match = any(mid_upper.startswith(p.upper()) for p in prefixes) or any(mid_upper == x.upper() for x in exacts)

                    if not is_match:
                        try:
                            data = doc.to_dict() or {}
                            st = data.get("state") if isinstance(data.get("state"), dict) else {}
                            game = st.get("game") if isinstance(st.get("game"), dict) else {}
                            doc_eids = {
                                str(data.get("eventId") or "").strip().lower(),
                                str(data.get("event_id") or "").strip().lower(),
                                str(data.get("tournament_id") or "").strip().lower(),
                                str(st.get("event_id") or "").strip().lower(),
                                str(st.get("tournament_id") or "").strip().lower(),
                                str(game.get("eventId") or "").strip().lower(),
                                str(game.get("event_id") or "").strip().lower(),
                                str(game.get("tournament_id") or "").strip().lower(),
                            }
                            doc_eids.discard("")
                            if doc_eids.intersection(id_variants_lower):
                                is_match = True
                        except Exception:
                            pass

                    if is_match:
                        seen_mids.add(mid)
                        for sub in ("messages", "dice_history"):
                            try:
                                for s_doc in doc.reference.collection(sub).stream():
                                    s_doc.reference.delete()
                            except Exception:
                                pass
                        doc.reference.delete()
                        deleted_count += 1
            except Exception as e:
                logger.warning(f"Notice deleting Firestore rooms for event {event_id}: {e}")

        # Clean fallback in-memory rooms
        fallback_to_delete = []
        id_variants_lower = {v.lower() for v in id_variants}
        for mid, rdata in list(self._fallback_rooms.items()):
            mid_upper = str(mid).upper()
            is_match = (
                mid in seen_mids or
                any(mid_upper.startswith(p.upper()) for p in prefixes) or
                any(mid_upper == x.upper() for x in exacts)
            )
            if not is_match and isinstance(rdata, dict):
                st = rdata.get("state") if isinstance(rdata.get("state"), dict) else {}
                game = st.get("game") if isinstance(st.get("game"), dict) else {}
                doc_eids = {
                    str(rdata.get("eventId") or "").strip().lower(),
                    str(rdata.get("event_id") or "").strip().lower(),
                    str(rdata.get("tournament_id") or "").strip().lower(),
                    str(st.get("event_id") or "").strip().lower(),
                    str(st.get("tournament_id") or "").strip().lower(),
                    str(game.get("eventId") or "").strip().lower(),
                    str(game.get("event_id") or "").strip().lower(),
                    str(game.get("tournament_id") or "").strip().lower(),
                }
                doc_eids.discard("")
                if doc_eids.intersection(id_variants_lower):
                    is_match = True
            if is_match:
                fallback_to_delete.append(mid)

        for mid in fallback_to_delete:
            self._fallback_rooms.pop(mid, None)
            deleted_count += 1

        return deleted_count

    def delete_tournament_document(self, event_id: str) -> bool:
        """Deletes tournaments/{event_id} and events/{event_id} and all subcollections from Firestore."""
        if not event_id:
            return False
        event_id = str(event_id).strip()
        clean_id = (
            event_id.replace("bcp_", "")
            .replace("BCP_", "")
            .replace("ES-", "")
            .replace("es-", "")
            .replace("event/", "")
            .strip()
        )

        id_variants = {
            event_id,
            event_id.upper(),
            event_id.lower(),
            clean_id,
            clean_id.upper(),
            clean_id.lower(),
            f"ES-{clean_id.upper()}",
            f"es-{clean_id.lower()}",
            f"BCP-{clean_id.upper()}",
            f"bcp_{clean_id}",
            f"BCP_{clean_id}",
            f"event/{clean_id}",
            f"event/{clean_id.lower()}",
        }
        id_variants.discard("")

        if self._client:
            for col_name in ("tournaments", "events"):
                for eid in id_variants:
                    try:
                        doc_ref = self._client.collection(col_name).document(eid)
                        # Delete all subcollections to prevent orphaned/ghost docs in Firestore
                        for subcol in ("judge_calls", "pairings", "rounds", "messages", "flags", "players", "participants"):
                            try:
                                for s_doc in doc_ref.collection(subcol).stream():
                                    s_doc.reference.delete()
                            except Exception:
                                pass
                        doc_ref.delete()
                    except Exception as e:
                        logger.warning(f"Notice deleting {col_name}/{eid} from Firestore: {e}")

        for v in id_variants:
            self._fallback_tournaments.pop(v, None)
            self._fallback_judge_calls.pop(v, None)
        return True

    def delete_tournament_and_rooms(self, event_id: str) -> Dict[str, Any]:
        """Cascades tournament deletion to all its table game rooms in Firestore."""
        rooms_deleted = self.delete_event_rooms(event_id)
        doc_deleted = self.delete_tournament_document(event_id)
        return {
            "success": True,
            "event_id": event_id,
            "tournament_deleted": doc_deleted,
            "rooms_deleted": rooms_deleted,
        }

    def cleanup_expired_documents(self) -> Dict[str, int]:
        """
        Cleans up expired documents across Firestore collections.
        Acts as programmatic cleanup alongside GCP Firestore native TTL policies.
        """
        deleted_counts = {"connect_user_sync": 0, "connect_chats": 0, "rooms": 0}
        if not self._client:
            return deleted_counts

        now_dt = datetime.now(timezone.utc)
        now_ts = int(now_dt.timestamp() * 1000)

        for col_name in ["connect_user_sync", "connect_chats"]:
            try:
                col_ref = self._client.collection(col_name)
                expired_docs = _apply_where(col_ref, "expiresAt", "<=", now_dt).limit(100).stream()
                batch = self._client.batch()
                count = 0
                for doc in expired_docs:
                    batch.delete(doc.reference)
                    count += 1
                if count > 0:
                    batch.commit()
                    deleted_counts[col_name] += count
            except Exception as e:
                logger.warning(f"Notice during {col_name} cleanup: {e}")

        try:
            rooms_ref = self._client.collection("rooms")
            expired_rooms = _apply_where(rooms_ref, "expiresAt", "<=", now_ts).limit(100).stream()
            batch = self._client.batch()
            count = 0
            for doc in expired_rooms:
                batch.delete(doc.reference)
                count += 1
            if count > 0:
                batch.commit()
                deleted_counts["rooms"] += count
        except Exception as e:
            logger.warning(f"Notice during rooms cleanup: {e}")

        return deleted_counts

    # =========================================================================
    # WARHAMMER 40,000 TEAM PAIRING MINIGAME ROOM ENGINE (WTC 5v5 & 8v8)
    # =========================================================================

    TEAM_PAIRING_PRESETS: Dict[str, Dict[str, Any]] = {
        "art_of_war": {
            "id": "art_of_war",
            "name": "Art of War",
            "short_tag": "AOW",
            "captain_name": "Richard Siegler",
            "roster": [
                {"id": "aow_1", "name": "Richard Siegler", "faction": "Aeldari", "detachment": "Warhost", "elo": 2185, "role": "Blunt / Defender", "win_rate": 82},
                {"id": "aow_2", "name": "John Lennon", "faction": "Space Marines", "detachment": "Gladius Task Force", "elo": 2152, "role": "All-Rounder", "win_rate": 79},
                {"id": "aow_3", "name": "Jack Harpster", "faction": "Blood Angels", "detachment": "Liberator Assault Group", "elo": 2118, "role": "Spear / Slayer", "win_rate": 76},
                {"id": "aow_4", "name": "Nick Nanavati", "faction": "World Eaters", "detachment": "Berzerker Warband", "elo": 2084, "role": "Spear / Slayer", "win_rate": 74},
                {"id": "aow_5", "name": "Brad Chester", "faction": "Chaos Daemons", "detachment": "Daemonic Incursion", "elo": 2061, "role": "Blunt / Defender", "win_rate": 73},
                {"id": "aow_6", "name": "Quinton Johnson", "faction": "Necrons", "detachment": "Starshatter Arsenal", "elo": 2045, "role": "Blunt / Defender", "win_rate": 72},
                {"id": "aow_7", "name": "Alex Macdougall", "faction": "Astra Militarum", "detachment": "Combined Regiment", "elo": 2028, "role": "Blunt / Defender", "win_rate": 71},
                {"id": "aow_8", "name": "Thomas Byrd", "faction": "Drukhari", "detachment": "Skysplinter Assault", "elo": 2012, "role": "Spear / Slayer", "win_rate": 70},
            ],
        },
        "team_zero_comp": {
            "id": "team_zero_comp",
            "name": "Team Zero Comp",
            "short_tag": "TZC",
            "captain_name": "John Hsieh",
            "roster": [
                {"id": "tzc_1", "name": "Junior Aflleje", "faction": "Leagues of Votann", "detachment": "Oathband", "elo": 2191, "role": "Top Ace / Spear", "win_rate": 83},
                {"id": "tzc_2", "name": "David Gaylard", "faction": "Necrons", "detachment": "Starshatter Arsenal", "elo": 2120, "role": "Blunt / Defender", "win_rate": 81},
                {"id": "tzc_3", "name": "James Carmona", "faction": "Adeptus Custodes", "detachment": "Shield Host", "elo": 1940, "role": "Blunt / Defender", "win_rate": 70},
                {"id": "tzc_4", "name": "John Hsieh", "faction": "Necrons", "detachment": "Awakened Dynasty", "elo": 1889, "role": "All-Rounder", "win_rate": 66},
                {"id": "tzc_5", "name": "Jake Nelson", "faction": "Blood Angels", "detachment": "Liberator Assault Group", "elo": 1866, "role": "Spear / Slayer", "win_rate": 73},
                {"id": "tzc_6", "name": "Jesse Sell", "faction": "Aeldari", "detachment": "Warhost", "elo": 1862, "role": "Spear / Slayer", "win_rate": 68},
                {"id": "tzc_7", "name": "Aurelio Correa", "faction": "Dark Angels", "detachment": "Gladius Task Force", "elo": 1848, "role": "All-Rounder", "win_rate": 66},
                {"id": "tzc_8", "name": "Jeremy Larson", "faction": "Astra Militarum", "detachment": "Combined Regiment", "elo": 1834, "role": "Blunt / Defender", "win_rate": 65},
            ],
        },
        "stat_check": {
            "id": "stat_check",
            "name": "Stat Check",
            "short_tag": "STC",
            "captain_name": "Anthony Vanella",
            "roster": [
                {"id": "stc_1", "name": "Anthony Vanella", "faction": "Deathwatch", "detachment": "Black Spear Task Force", "elo": 2135, "role": "All-Rounder", "win_rate": 78},
                {"id": "stc_2", "name": "Cliff Thomas", "faction": "Imperial Knights", "detachment": "Noble Lance", "elo": 2092, "role": "Blunt / Defender", "win_rate": 75},
                {"id": "stc_3", "name": "Sam Pope", "faction": "Tyranids", "detachment": "Invasion Fleet", "elo": 2076, "role": "Blunt / Defender", "win_rate": 74},
                {"id": "stc_4", "name": "Jeremy Atk", "faction": "Dark Angels", "detachment": "Gladius Task Force", "elo": 2058, "role": "Blunt / Defender", "win_rate": 73},
                {"id": "stc_5", "name": "Ben Jurek", "faction": "Genestealer Cults", "detachment": "Host of Ascension", "elo": 2042, "role": "Spear / Slayer", "win_rate": 72},
                {"id": "stc_6", "name": "Colin McDade", "faction": "Adeptus Mechanicus", "detachment": "Skitarii Hunter Cohort", "elo": 2025, "role": "Blunt / Defender", "win_rate": 70},
                {"id": "stc_7", "name": "Trevy", "faction": "T'au Empire", "detachment": "Retaliation Cadre", "elo": 2011, "role": "Spear / Slayer", "win_rate": 69},
                {"id": "stc_8", "name": "Nathan D", "faction": "Grey Knights", "detachment": "Teleport Strike Force", "elo": 1998, "role": "All-Rounder", "win_rate": 68},
            ],
        },
        "team_ignite": {
            "id": "team_ignite",
            "name": "Team Ignite",
            "short_tag": "IGN",
            "captain_name": "Sean Nayden",
            "roster": [
                {"id": "ign_1", "name": "Sean Nayden", "faction": "Aeldari", "detachment": "Aspect Host", "elo": 2128, "role": "Spear / Slayer", "win_rate": 77},
                {"id": "ign_2", "name": "Brian Pullen", "faction": "Leagues of Votann", "detachment": "Oathband", "elo": 2088, "role": "Blunt / Defender", "win_rate": 75},
                {"id": "ign_3", "name": "Folger P", "faction": "Chaos Space Marines", "detachment": "Pactbound Zealots", "elo": 2070, "role": "Spear / Slayer", "win_rate": 74},
                {"id": "ign_4", "name": "Matt Robertson", "faction": "Astra Militarum", "detachment": "Bridgehead Strike", "elo": 2052, "role": "Blunt / Defender", "win_rate": 72},
                {"id": "ign_5", "name": "Mark Perry", "faction": "Black Templars", "detachment": "Righteous Crusaders", "elo": 2038, "role": "Blunt / Defender", "win_rate": 71},
                {"id": "ign_6", "name": "Kyle McCord", "faction": "Orks", "detachment": "Bully Boyz", "elo": 2021, "role": "Spear / Slayer", "win_rate": 70},
                {"id": "ign_7", "name": "Ryan Snyder", "faction": "Tyranids", "detachment": "Vanguard Onslaught", "elo": 2009, "role": "All-Rounder", "win_rate": 69},
                {"id": "ign_8", "name": "Dan Sammons", "faction": "Imperial Knights", "detachment": "Noble Lance", "elo": 1995, "role": "Blunt / Defender", "win_rate": 68},
            ],
        },
    }

    FACTION_MATCHUP_EDGES: Dict[Tuple[str, str], int] = {
        ("Aeldari", "Necrons"): 2,
        ("Aeldari", "Death Guard"): 3,
        ("Aeldari", "Imperial Knights"): 2,
        ("Necrons", "Orks"): 2,
        ("Necrons", "World Eaters"): 2,
        ("Space Marines", "T'au Empire"): 1,
        ("Space Marines", "Orks"): 2,
        ("Blood Angels", "T'au Empire"): 3,
        ("Blood Angels", "Thousand Sons"): 2,
        ("World Eaters", "Adeptus Custodes"): -2,
        ("World Eaters", "T'au Empire"): 3,
        ("World Eaters", "Imperial Knights"): 2,
        ("Adeptus Custodes", "World Eaters"): 2,
        ("Adeptus Custodes", "Blood Angels"): 2,
        ("Adeptus Custodes", "Orks"): 2,
        ("T'au Empire", "Adeptus Custodes"): 2,
        ("T'au Empire", "Death Guard"): 3,
        ("Thousand Sons", "Adeptus Custodes"): 3,
        ("Thousand Sons", "Space Marines"): 2,
        ("Chaos Daemons", "Thousand Sons"): 2,
        ("Chaos Daemons", "Imperial Knights"): 2,
        ("Orks", "Aeldari"): 2,
        ("Orks", "Thousand Sons"): -2,
    }

    @classmethod
    def estimate_wtc_matchup(cls, player_a: Dict[str, Any], player_b: Dict[str, Any]) -> int:
        """Estimates WTC 0-20 points for player_a vs player_b based on faction matchup & Elo."""
        fac_a = str(player_a.get("faction") or "")
        fac_b = str(player_b.get("faction") or "")
        edge = cls.FACTION_MATCHUP_EDGES.get((fac_a, fac_b), 0)
        if edge == 0 and (fac_b, fac_a) in cls.FACTION_MATCHUP_EDGES:
            edge = -cls.FACTION_MATCHUP_EDGES[(fac_b, fac_a)]
        elo_a = float(player_a.get("elo") or 2000)
        elo_b = float(player_b.get("elo") or 2000)
        elo_shift = round((elo_a - elo_b) / 45.0)
        score_a = max(3, min(17, int(10 + edge + elo_shift)))
        return score_a

    def _save_pairing_room_doc(self, room_code: str, room_data: Dict[str, Any]) -> None:
        import threading
        code = str(room_code).strip().upper()
        room_data["updatedAt"] = int(datetime.now(timezone.utc).timestamp() * 1000)
        self._fallback_pairing_rooms[code] = room_data
        if self._client:
            def _bg_sync():
                try:
                    self._client.collection("pairing_rooms").document(code).set(room_data)
                except Exception as err:
                    logger.warning(f"Notice syncing pairing_room {code} to Firestore: {err}")
            threading.Thread(target=_bg_sync, daemon=True).start()

    def get_pairing_room_raw(self, room_code: str) -> Optional[Dict[str, Any]]:
        if not room_code:
            return None
        code = str(room_code).strip().upper()
        if code in self._fallback_pairing_rooms:
            return self._fallback_pairing_rooms[code]
        if self._client:
            try:
                doc = self._client.collection("pairing_rooms").document(code).get(timeout=0.45)
                if doc.exists:
                    data = doc.to_dict() or {}
                    self._fallback_pairing_rooms[code] = data
                    return data
            except Exception as err:
                logger.warning(f"Notice reading pairing_room {code} from Firestore: {err}")
        return None

    def _sync_roster_statuses(self, room: Dict[str, Any]) -> None:
        bench_a = set(room.get("bench_a") or [])
        bench_b = set(room.get("bench_b") or [])
        def_a = room.get("defender_a")
        def_b = room.get("defender_b")
        att_a = set(room.get("attackers_a") or [])
        att_b = set(room.get("attackers_b") or [])
        for p in room.get("team_a", {}).get("roster", []):
            pid = p.get("id")
            if pid == def_a:
                p["status"] = "defender"
            elif pid in att_a:
                p["status"] = "attacker"
            elif pid in bench_a:
                p["status"] = "bench"
            else:
                p["status"] = "paired"
        for p in room.get("team_b", {}).get("roster", []):
            pid = p.get("id")
            if pid == def_b:
                p["status"] = "defender"
            elif pid in att_b:
                p["status"] = "attacker"
            elif pid in bench_b:
                p["status"] = "bench"
            else:
                p["status"] = "paired"

    @staticmethod
    def _clean_primary_faction(raw_fac: Any) -> str:
        """Extracts the primary 40K/AoS faction name from a player_ratings top_faction or faction string."""
        s = str(raw_fac or "").strip()
        if not s or s.lower() in ("unknown", "none", "n/a", "unaligned"):
            return "Space Marines"
        first = s.split(",")[0].strip()
        # Normalize common variants to canonical Retribution Armory faction names
        low = first.lower()
        if "custodes" in low:
            return "Adeptus Custodes"
        if "sororitas" in low or "sisters of battle" in low:
            return "Adepta Sororitas"
        if "mechanicus" in low or "admech" in low:
            return "Adeptus Mechanicus"
        if "tau" in low or "t'au" in low:
            return "T'au Empire"
        if "votann" in low:
            return "Leagues of Votann"
        if "genestealer" in low:
            return "Genestealer Cults"
        if "thousand sons" in low:
            return "Thousand Sons"
        if "world eaters" in low:
            return "World Eaters"
        if "death guard" in low:
            return "Death Guard"
        if "black templars" in low:
            return "Black Templars"
        if "blood angels" in low:
            return "Blood Angels"
        if "dark angels" in low:
            return "Dark Angels"
        if "space wolves" in low:
            return "Space Wolves"
        if "grey knights" in low:
            return "Grey Knights"
        if "deathwatch" in low:
            return "Deathwatch"
        if "imperial knights" in low:
            return "Imperial Knights"
        if "chaos knights" in low:
            return "Chaos Knights"
        if "chaos space marines" in low or low == "csm" or "heretic astartes" in low:
            return "Chaos Space Marines"
        if "chaos daemons" in low or low == "daemons":
            return "Chaos Daemons"
        if "emperor's children" in low or "emperors children" in low:
            return "Emperor's Children"
        if "imperial agents" in low or "agents of the imperium" in low:
            return "Imperial Agents"
        if "astra militarum" in low or "imperial guard" in low:
            return "Astra Militarum"
        if "drukhari" in low:
            return "Drukhari"
        if "aeldari" in low or "eldar" in low or "ynnari" in low or "harlequin" in low:
            return "Aeldari"
        if "necron" in low:
            return "Necrons"
        if "tyranid" in low:
            return "Tyranids"
        if "ork" in low:
            return "Orks"
        if "space marines" in low or "astartes" in low or "ultramarines" in low:
            return "Space Marines"
        return first

    def get_real_team_roster(self, team_name: str, game_system: str = "40k") -> Dict[str, Any]:
        """Queries real team roster players from PostgreSQL player_ratings and teams_hub_service (< 50ms)."""
        import time
        clean_team = str(team_name or "").strip()
        if not clean_team:
            return {"team": "", "short_tag": "", "roster": [], "stats": {}}

        sys_key = str(game_system or "40k").strip().lower()
        cache_key = (sys_key, clean_team.lower())
        now_mono = time.monotonic()
        if not hasattr(self, "_team_roster_fast_cache"):
            self._team_roster_fast_cache: Dict[Tuple[str, str], Tuple[float, Dict[str, Any]]] = {}
        cached_entry = self._team_roster_fast_cache.get(cache_key)
        if cached_entry and (now_mono - cached_entry[0]) < 600.0:
            return cached_entry[1]

        roster_out: List[Dict[str, Any]] = []
        seen_names = set()
        short_tag = ""
        stats: Dict[str, Any] = {}

        # 1. Query live PostgreSQL database with fast single-query lookup (< 25ms)
        try:
            from core import get_database
            db = get_database()
            if db is not None:
                is_mock_db = getattr(db, "_is_mock_instance", lambda: False)() or type(db).__module__.startswith("unittest.mock") or not hasattr(db, "get_connection")
                raw_rows = None
                if not is_mock_db:
                    try:
                        import psycopg2.extras as pg_extras
                        with db.get_connection() as conn:
                            with conn.cursor(cursor_factory=pg_extras.RealDictCursor) as cur:
                                cur.execute("SET LOCAL statement_timeout = '300ms';")
                                cur.execute(
                                    """
                                    SELECT player_id,
                                           COALESCE(player_name, 'Player') AS player_name,
                                           COALESCE(current_elo, 1500.0) AS current_elo,
                                           COALESCE(top_faction, 'Unknown') AS top_faction,
                                           COALESCE(matches_played, 0) AS matches_played,
                                           COALESCE(win_rate, 0.0) AS win_rate
                                    FROM player_ratings
                                    WHERE COALESCE(matches_played, 0) > 0
                                      AND LOWER(TRIM(team)) = LOWER(%s)
                                      AND COALESCE(game_system, '40k') = %s
                                    ORDER BY current_elo DESC NULLS LAST
                                    LIMIT 40;
                                    """,
                                    (clean_team, sys_key),
                                )
                                raw_rows = [dict(r) for r in cur.fetchall()]
                    except Exception as sql_err:
                        logger.debug(f"Fast SQL team roster lookup notice for {clean_team}: {sql_err}")
                elif hasattr(db, "get_team_roster"):
                    db_res = db.get_team_roster(clean_team, game_system=sys_key)
                    if isinstance(db_res, dict) and isinstance(db_res.get("roster"), list):
                        raw_rows = db_res["roster"]
                        stats = db_res.get("stats") or {}

                if raw_rows:
                    for idx, p in enumerate(raw_rows):
                        pname = str(p.get("player_name") or p.get("name") or "").strip()
                        if not pname or pname.lower() in seen_names:
                            continue
                        seen_names.add(pname.lower())
                        fac = self._clean_primary_faction(p.get("top_faction") or p.get("faction"))
                        elo_val = int(round(float(p.get("current_elo") or p.get("elo") or 1800)))
                        role_lbl = "Top Ace / Spear" if idx == 0 else ("Core / All-Rounder" if idx < 5 else "All-Rounder")
                        roster_out.append({
                            "player_id": str(p.get("player_id") or f"p_{idx}"),
                            "name": pname,
                            "player_name": pname,
                            "faction": fac,
                            "top_faction": str(p.get("top_faction") or fac),
                            "elo": elo_val,
                            "current_elo": float(p.get("current_elo") or elo_val),
                            "matches_played": int(p.get("matches_played") or 0),
                            "win_rate": float(p.get("win_rate") or 0.0),
                            "team": clean_team,
                            "is_active": bool(p.get("is_active", True)),
                            "role_tag": role_lbl,
                        })
        except Exception as err:
            logger.debug(f"Notice querying PostgreSQL get_team_roster for {clean_team}: {err}")

        # 2. Enrich / fallback from TeamsHubService (real tournament club rosters, in-memory < 1ms)
        try:
            import teams_hub_service
            svc = teams_hub_service.get_teams_hub_service()
            hub = svc.get_team_hub(clean_team, sys_key)
            if hub and isinstance(hub, dict):
                clean_team = str(hub.get("name") or clean_team)
                short_tag = str(hub.get("short_tag") or short_tag)
                if not stats:
                    stats = {
                        "roster_count": hub.get("roster_count", len(hub.get("roster") or [])),
                        "active_roster_count": hub.get("active_roster_count", len(hub.get("roster") or [])),
                        "power_rating": hub.get("power_rating", 0.0),
                        "avg_elo": hub.get("active_avg_elo", 1800.0),
                    }
                for idx, p in enumerate(hub.get("roster") or []):
                    pname = str(p.get("player_name") or p.get("name") or "").strip()
                    if not pname or pname.lower() in seen_names:
                        continue
                    seen_names.add(pname.lower())
                    fac = self._clean_primary_faction(p.get("top_faction") or p.get("faction"))
                    elo_val = int(round(float(p.get("current_elo") or p.get("elo") or 1800)))
                    role_lbl = str(p.get("role") or ("Top Ace" if idx == 0 else "Core"))
                    roster_out.append({
                        "player_id": str(p.get("player_id") or f"p_{idx}"),
                        "name": pname,
                        "player_name": pname,
                        "faction": fac,
                        "top_faction": str(p.get("top_faction") or fac),
                        "elo": elo_val,
                        "current_elo": float(p.get("current_elo") or elo_val),
                        "matches_played": int(p.get("matches_played") or 0),
                        "win_rate": float(p.get("win_rate") or 0.0),
                        "team": clean_team,
                        "is_active": bool(p.get("is_active", True)),
                        "role_tag": role_lbl,
                    })
        except Exception as err:
            logger.debug(f"Notice querying TeamsHubService for {clean_team}: {err}")

        if not short_tag and clean_team:
            short_tag = "".join(w[0] for w in clean_team.split() if w).upper()[:4] or clean_team[:3].upper()

        result = {
            "ok": True,
            "success": True,
            "team": clean_team,
            "team_name": clean_team,
            "short_tag": short_tag,
            "roster": roster_out,
            "players": roster_out,
            "starting_5": roster_out[:5],
            "stats": stats,
            "game_system": sys_key,
        }
        self._team_roster_fast_cache[cache_key] = (now_mono, result)
        return result

    def search_real_teams_and_players(self, query: str = "", game_system: str = "40k", limit: int = 24) -> Dict[str, Any]:
        """Searches real teams and real players from PostgreSQL player_ratings and teams_hub_service (< 80ms)."""
        import time
        q_raw = str(query or "").strip()
        q_low = q_raw.lower()
        sys_key = str(game_system or "40k").strip().lower()
        lim = max(1, min(60, int(limit or 24)))

        now_mono = time.monotonic()
        if not hasattr(self, "_pairing_search_cache"):
            self._pairing_search_cache: Dict[Tuple[str, str, int], Tuple[float, Dict[str, Any]]] = {}
        cache_key = (sys_key, q_low, lim)
        cached_hit = self._pairing_search_cache.get(cache_key)
        if cached_hit and (now_mono - cached_hit[0]) < 300.0:
            return cached_hit[1]

        teams_out: List[Dict[str, Any]] = []
        players_out: List[Dict[str, Any]] = []
        seen_teams = set()
        seen_players = set()

        # 1. Query live PostgreSQL database with fast bounded queries (< 50ms)
        try:
            from core import get_database
            db = get_database()
            if db is not None:
                is_mock_db = getattr(db, "_is_mock_instance", lambda: False)() or type(db).__module__.startswith("unittest.mock") or not hasattr(db, "get_connection")
                if is_mock_db:
                    if hasattr(db, "get_teams_leaderboard"):
                        t_res = db.get_teams_leaderboard(
                            page=1,
                            page_size=min(lim, 15),
                            min_members=1,
                            query=q_raw if q_raw else None,
                            game_system=sys_key,
                        )
                        for t in (t_res.get("items") or []):
                            tname = str(t.get("team") or t.get("name") or "").strip()
                            if not tname or tname.lower() in seen_teams:
                                continue
                            seen_teams.add(tname.lower())
                            tag = str(t.get("short_tag") or "".join(w[0] for w in tname.split() if w).upper()[:4] or tname[:3].upper())
                            rc = int(t.get("roster_count") or t.get("active_roster_count") or 0)
                            teams_out.append({
                                "team_name": tname,
                                "team": tname,
                                "name": tname,
                                "short_tag": tag,
                                "member_count": rc,
                                "roster_count": rc,
                                "active_roster_count": int(t.get("active_roster_count") or rc),
                                "power_rating": float(t.get("power_rating") or 0.0),
                                "avg_elo": int(round(float(t.get("active_avg_elo") or t.get("avg_elo") or 1800.0))),
                                "top_player_name": str(t.get("top_player_name") or ""),
                            })
                else:
                    # Fast cached team index from player_ratings (< 15ms once per 10 min)
                    if not hasattr(self, "_db_teams_fast_list_cache"):
                        self._db_teams_fast_list_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
                    t_cached = self._db_teams_fast_list_cache.get(sys_key)
                    if t_cached and (now_mono - t_cached[0]) < 600.0:
                        db_teams_list = t_cached[1]
                    else:
                        db_teams_list = []
                        try:
                            import psycopg2.extras as pg_extras
                            with db.get_connection() as conn:
                                with conn.cursor(cursor_factory=pg_extras.RealDictCursor) as cur:
                                    cur.execute("SET LOCAL statement_timeout = '300ms';")
                                    cur.execute(
                                        """
                                        SELECT TRIM(team) AS team,
                                               COUNT(*) AS roster_count,
                                               AVG(COALESCE(current_elo, 1500.0)) AS avg_elo,
                                               MAX(COALESCE(current_elo, 1500.0)) AS top_elo
                                        FROM player_ratings
                                        WHERE COALESCE(game_system, '40k') = %s
                                          AND COALESCE(matches_played, 0) > 0
                                          AND team IS NOT NULL AND TRIM(team) != ''
                                        GROUP BY TRIM(team)
                                        ORDER BY COUNT(*) DESC, AVG(COALESCE(current_elo, 1500.0)) DESC
                                        LIMIT 200;
                                        """,
                                        (sys_key,),
                                    )
                                    for r in cur.fetchall():
                                        tname = str(r.get("team") or "").strip()
                                        if not tname:
                                            continue
                                        rc = int(r.get("roster_count") or 0)
                                        avg_e = int(round(float(r.get("avg_elo") or 1800.0)))
                                        tag = "".join(w[0] for w in tname.split() if w).upper()[:4] or tname[:3].upper()
                                        db_teams_list.append({
                                            "team_name": tname,
                                            "team": tname,
                                            "name": tname,
                                            "short_tag": tag,
                                            "member_count": rc,
                                            "roster_count": rc,
                                            "active_roster_count": rc,
                                            "power_rating": float(avg_e),
                                            "avg_elo": avg_e,
                                            "top_player_name": "",
                                        })
                            self._db_teams_fast_list_cache[sys_key] = (now_mono, db_teams_list)
                        except Exception as t_err:
                            logger.debug(f"Fast SQL teams index notice: {t_err}")

                    for t in db_teams_list:
                        tname = t["team_name"]
                        if q_low and q_low not in tname.lower() and q_low not in t["short_tag"].lower():
                            continue
                        if tname.lower() not in seen_teams:
                            seen_teams.add(tname.lower())
                            teams_out.append(t)
                            if len(teams_out) >= 12:
                                break

                raw_players = []
                if q_raw:
                    if hasattr(db, "search_players"):
                        raw_players.extend(db.search_players(q_raw, limit=lim, game_system=sys_key) or [])
                    if is_mock_db and len(raw_players) < lim and hasattr(db, "get_players_directory"):
                        dir_res = db.get_players_directory(page=1, page_size=lim, query=q_raw, game_system=sys_key)
                        raw_players.extend(dir_res.get("items") or [])
                else:
                    if is_mock_db and hasattr(db, "get_top_ranked_players"):
                        top_res = db.get_top_ranked_players(page=1, page_size=lim, min_matches=1, game_system=sys_key)
                        raw_players.extend(top_res.get("items") or top_res.get("players") or [])
                    elif not is_mock_db:
                        try:
                            import psycopg2.extras as pg_extras
                            with db.get_connection() as conn:
                                with conn.cursor(cursor_factory=pg_extras.RealDictCursor) as cur:
                                    cur.execute("SET LOCAL statement_timeout = '250ms';")
                                    cur.execute(
                                        """
                                        SELECT player_id,
                                               COALESCE(player_name, 'Player') AS player_name,
                                               COALESCE(current_elo, 1500.0) AS current_elo,
                                               COALESCE(top_faction, 'Unknown') AS top_faction,
                                               COALESCE(team, '') AS team,
                                               COALESCE(matches_played, 0) AS matches_played,
                                               COALESCE(win_rate, 0.0) AS win_rate
                                        FROM player_ratings
                                        WHERE COALESCE(game_system, '40k') = %s
                                          AND COALESCE(matches_played, 0) > 0
                                        ORDER BY current_elo DESC NULLS LAST
                                        LIMIT %s;
                                        """,
                                        (sys_key, lim),
                                    )
                                    raw_players.extend(dict(r) for r in cur.fetchall())
                        except Exception as p_err:
                            logger.debug(f"Fast top players query notice: {p_err}")

                for p in raw_players:
                    pname = str(p.get("player_name") or p.get("name") or "").strip()
                    if not pname or pname.lower() in seen_players:
                        continue
                    seen_players.add(pname.lower())
                    fac = self._clean_primary_faction(p.get("top_faction") or p.get("faction"))
                    elo_val = int(round(float(p.get("current_elo") or p.get("elo") or 1800)))
                    t_lbl = str(p.get("team") or "").strip()
                    players_out.append({
                        "player_id": str(p.get("player_id") or ""),
                        "name": pname,
                        "player_name": pname,
                        "faction": fac,
                        "top_faction": str(p.get("top_faction") or fac),
                        "elo": elo_val,
                        "current_elo": float(p.get("current_elo") or elo_val),
                        "team": t_lbl,
                        "team_name": t_lbl,
                        "matches_played": int(p.get("matches_played") or 0),
                        "win_rate": float(p.get("win_rate") or 0.0),
                        "role_tag": "All-Rounder",
                    })
                    if len(players_out) >= lim:
                        break
        except Exception as err:
            logger.debug(f"Notice searching PostgreSQL for team pairings '{q_raw}': {err}")

        # 2. Enrich / fallback from TeamsHubService real tournament clubs & rosters (< 1ms)
        try:
            import teams_hub_service
            svc = teams_hub_service.get_teams_hub_service()
            t_hub_res = svc.get_teams_leaderboard(
                game_system=sys_key,
                page=1,
                page_size=15,
                query=q_raw if q_raw else None,
                min_roster=1,
            )
            for t in (t_hub_res.get("items") or []):
                tname = str(t.get("team") or t.get("name") or "").strip()
                if not tname:
                    continue
                if tname.lower() not in seen_teams:
                    seen_teams.add(tname.lower())
                    tag = str(t.get("short_tag") or "".join(w[0] for w in tname.split() if w).upper()[:4] or tname[:3].upper())
                    rc = int(t.get("roster_count") or t.get("active_roster_count") or 0)
                    teams_out.append({
                        "team_name": tname,
                        "team": tname,
                        "name": tname,
                        "short_tag": tag,
                        "member_count": rc,
                        "roster_count": rc,
                        "active_roster_count": int(t.get("active_roster_count") or rc),
                        "power_rating": float(t.get("power_rating") or 0.0),
                        "avg_elo": int(round(float(t.get("active_avg_elo") or t.get("avg_elo") or 1800.0))),
                        "top_player_name": str(t.get("top_player_name") or ""),
                    })

            if len(players_out) < limit:
                all_hub_teams = svc.get_teams_leaderboard(game_system=game_system, page=1, page_size=50, min_roster=1).get("items") or []
                for t_summary in all_hub_teams:
                    tname = str(t_summary.get("team") or t_summary.get("name") or "").strip()
                    hub = svc.get_team_hub(tname, game_system)
                    if not hub or not isinstance(hub.get("roster"), list):
                        continue
                    for p in hub["roster"]:
                        pname = str(p.get("player_name") or p.get("name") or "").strip()
                        if not pname or pname.lower() in seen_players:
                            continue
                        fac = self._clean_primary_faction(p.get("top_faction") or p.get("faction"))
                        if q_low:
                            haystack = f"{pname} {fac} {tname} {hub.get('short_tag', '')}".lower()
                            if not all(tok in haystack for tok in q_low.split()):
                                continue
                        seen_players.add(pname.lower())
                        elo_val = int(round(float(p.get("current_elo") or p.get("elo") or 1800)))
                        players_out.append({
                            "player_id": str(p.get("player_id") or ""),
                            "name": pname,
                            "player_name": pname,
                            "faction": fac,
                            "top_faction": str(p.get("top_faction") or fac),
                            "elo": elo_val,
                            "current_elo": float(p.get("current_elo") or elo_val),
                            "team": tname,
                            "team_name": tname,
                            "matches_played": int(p.get("matches_played") or 0),
                            "win_rate": float(p.get("win_rate") or 0.0),
                            "role_tag": str(p.get("role") or "All-Rounder"),
                        })
                        if len(players_out) >= limit:
                            break
                    if len(players_out) >= limit:
                        break
        except Exception as err:
            logger.debug(f"Notice searching TeamsHubService for '{q_raw}': {err}")

        # 3. Enrich player search from real SD40K League player careers (data/sd40k_player_careers.json)
        if len(players_out) < limit and game_system == "40k":
            try:
                import json
                from pathlib import Path
                careers_path = Path(__file__).resolve().parent / "data" / "sd40k_player_careers.json"
                if careers_path.exists():
                    if not hasattr(self, "_sd40k_careers_cache") or self._sd40k_careers_cache is None:
                        with open(careers_path, "r", encoding="utf-8") as f:
                            self._sd40k_careers_cache = json.load(f) or {}
                    for pname_key, cdata in (self._sd40k_careers_cache or {}).items():
                        pname = str(cdata.get("name") or pname_key or "").strip()
                        if not pname or pname.lower() in seen_players:
                            continue
                        factions_list = [f for f in (cdata.get("factions") or []) if f and str(f).upper() != "N/A"]
                        fac = self._clean_primary_faction(factions_list[0] if factions_list else "Space Marines")
                        if q_low:
                            haystack = f"{pname} {fac} sd40k san diego".lower()
                            if not all(tok in haystack for tok in q_low.split()):
                                continue
                        seen_players.add(pname.lower())
                        games = int(cdata.get("total_games") or 0)
                        win_pct_str = str(cdata.get("win_pct") or "50%").replace("%", "").strip()
                        try:
                            wr = float(win_pct_str)
                        except ValueError:
                            wr = 50.0
                        elo_est = int(round(1600 + (wr - 50.0) * 6.5 + min(games, 150) * 1.2))
                        players_out.append({
                            "player_id": str(cdata.get("bcp_player_id") or f"sd_{pname.lower().replace(' ', '_')}"),
                            "name": pname,
                            "player_name": pname,
                            "faction": fac,
                            "top_faction": fac,
                            "elo": elo_est,
                            "current_elo": float(elo_est),
                            "team": "SD40K League",
                            "team_name": "SD40K League",
                            "matches_played": games,
                            "win_rate": wr,
                            "role_tag": "All-Rounder",
                        })
                        if len(players_out) >= limit:
                            break
            except Exception as err:
                logger.debug(f"Notice searching sd40k_player_careers.json for '{q_raw}': {err}")

        players_out.sort(key=lambda x: float(x.get("elo") or 0), reverse=True)
        result = {
            "ok": True,
            "success": True,
            "query": q_raw,
            "teams": teams_out[:12],
            "players": players_out[:lim],
        }
        self._pairing_search_cache[cache_key] = (now_mono, result)
        return result

    def create_pairing_room(self, payload: Optional[Dict[str, Any]] = None, **kwargs: Any) -> Dict[str, Any]:
        import copy
        import secrets

        req: Dict[str, Any] = {}
        if isinstance(payload, dict):
            req.update(payload)
        req.update(kwargs)

        fmt = str(req.get("format_size") or req.get("format") or "5v5").strip().lower()
        team_size = 8 if fmt == "8v8" else 5
        fmt = "8v8" if team_size == 8 else "5v5"
        max_cycles = 3 if team_size == 8 else 2

        preset_a_key = str(req.get("team_a_preset") or "art_of_war").strip().lower()
        preset_b_key = str(req.get("team_b_preset") or "team_zero_comp").strip().lower()
        if preset_a_key not in self.TEAM_PAIRING_PRESETS:
            preset_a_key = "art_of_war"
        if preset_b_key not in self.TEAM_PAIRING_PRESETS:
            preset_b_key = "team_zero_comp"

        preset_a = copy.deepcopy(self.TEAM_PAIRING_PRESETS[preset_a_key])
        preset_b = copy.deepcopy(self.TEAM_PAIRING_PRESETS[preset_b_key])

        if isinstance(req.get("team_a_roster"), list) and len(req["team_a_roster"]) >= team_size:
            roster_a = copy.deepcopy(req["team_a_roster"][:team_size])
        else:
            roster_a = preset_a["roster"][:team_size]
        if isinstance(req.get("team_b_roster"), list) and len(req["team_b_roster"]) >= team_size:
            roster_b = copy.deepcopy(req["team_b_roster"][:team_size])
        else:
            roster_b = preset_b["roster"][:team_size]

        # Ensure clean IDs A1..An and B1..Bn
        for idx, p in enumerate(roster_a):
            p["id"] = f"A{idx + 1}"
            p["team"] = "A"
            p["status"] = "bench"
        for idx, p in enumerate(roster_b):
            p["id"] = f"B{idx + 1}"
            p["team"] = "B"
            p["status"] = "bench"

        raw_code = str(req.get("room_code") or "").strip().upper()
        if not raw_code:
            raw_code = f"WTC-{secrets.token_hex(2).upper()}"

        cap_a_token = str(req.get("captain_a_token") or f"capA_{secrets.token_hex(6)}")
        cap_b_token = str(req.get("captain_b_token") or f"capB_{secrets.token_hex(6)}")
        vs_ai = bool(req.get("vs_ai", True))
        is_locked = bool(req.get("is_locked", False))

        creator_uid = str(req.get("user_id") or req.get("guest_id") or req.get("owner_id") or "").strip() or None
        seat_a_locked = bool(req.get("seat_a_locked", bool(creator_uid)))
        seat_b_locked = bool(req.get("seat_b_locked", False))

        now_dt = datetime.now(timezone.utc)
        now_ts = int(now_dt.timestamp() * 1000)
        ts_str = now_dt.strftime("%H:%M:%S")
        team_a_name = str(req.get("team_a_name") or preset_a["name"]).strip()
        team_b_name = str(req.get("team_b_name") or preset_b["name"]).strip()
        tag_a = str(req.get("team_a_tag") or preset_a["short_tag"])
        tag_b = str(req.get("team_b_tag") or preset_b["short_tag"])
        cap_a_name = str(req.get("captain_a_name") or req.get("user_name") or preset_a["captain_name"])
        cap_b_name = str(req.get("captain_b_name") or (f"{preset_b['captain_name']} (AI Bot)" if vs_ai else preset_b["captain_name"]))

        room_data: Dict[str, Any] = {
            "room_code": raw_code,
            "format": fmt,
            "format_size": fmt,
            "team_size": team_size,
            "total_tables": team_size,
            "max_cycles": max_cycles,
            "vs_ai": vs_ai,
            "is_locked": is_locked,
            "owner_id": creator_uid,
            "user_id_cap_a": creator_uid if seat_a_locked else None,
            "user_id_cap_b": None,
            "seat_a_locked": seat_a_locked,
            "seat_b_locked": seat_b_locked,
            "seat_a_owner_name": cap_a_name if seat_a_locked else None,
            "seat_b_owner_name": None,
            "captain_a_token": cap_a_token,
            "captain_b_token": cap_b_token,
            "captain_a_name": cap_a_name,
            "captain_b_name": cap_b_name,
            "captain_a_claimed": True,
            "captain_b_claimed": bool(vs_ai),
            "spectator_count": 0,
            "team_a": {
                "name": team_a_name,
                "tag": tag_a,
                "short_tag": tag_a,
                "captain_name": cap_a_name,
                "roster": roster_a,
            },
            "team_b": {
                "name": team_b_name,
                "tag": tag_b,
                "short_tag": tag_b,
                "captain_name": cap_b_name,
                "roster": roster_b,
            },
            "bench_a": [p["id"] for p in roster_a],
            "bench_b": [p["id"] for p in roster_b],
            "cycle": 1,
            "phase": "STEP_1_DEFENDER",
            "secret_defender_a": None,
            "secret_defender_b": None,
            "defender_a": None,
            "defender_b": None,
            "secret_attackers_a": [],
            "secret_attackers_b": [],
            "attackers_a": [],
            "attackers_b": [],
            "secret_choice_a": None,
            "secret_choice_b": None,
            "locked_a": False,
            "locked_b": False,
            "pairings": [],
            "history_log": [
                f"Room {raw_code} initialized ({fmt} WTC Pairing Protocol): {team_a_name} vs {team_b_name}.",
                "Cycle 1 — Step 1: Both Captains secretly put forward 1 Defender card.",
            ],
            "log": [
                {"ts": ts_str, "msg": f"Room {raw_code} initialized ({fmt} WTC Pairing Protocol): {team_a_name} vs {team_b_name}."},
                {"ts": ts_str, "msg": "Cycle 1 — Step 1: Both Captains secretly put forward 1 Defender card."},
            ],
            "createdAt": now_ts,
            "updatedAt": now_ts,
        }

        self._save_pairing_room_doc(raw_code, room_data)
        return room_data

    def resolve_viewer_role(
        self,
        room: Dict[str, Any],
        role_token: Optional[str] = None,
        force_role: Optional[str] = None,
    ) -> str:
        if force_role in ("captain_a", "captain_b", "spectator"):
            return force_role
        if role_token in ("captain_a", "captain_b", "spectator"):
            return role_token
        tok = (role_token or "").strip()
        if tok and tok == room.get("captain_a_token"):
            return "captain_a"
        if tok and tok == room.get("captain_b_token"):
            return "captain_b"
        return "spectator"

    def mask_pairing_room_for_viewer(
        self,
        room: Dict[str, Any],
        role_token: Optional[str] = None,
        force_role: Optional[str] = None,
    ) -> Dict[str, Any]:
        import copy

        self._sync_roster_statuses(room)
        viewer_role = self.resolve_viewer_role(room, role_token=role_token, force_role=force_role)
        masked = copy.deepcopy(room)
        masked.pop("captain_a_token", None)
        masked.pop("captain_b_token", None)
        masked["viewer_role"] = viewer_role
        masked["can_interact_a"] = viewer_role == "captain_a"
        masked["can_interact_b"] = viewer_role == "captain_b"
        masked["is_locked"] = bool(room.get("is_locked", False))
        masked["seat_a_locked"] = bool(room.get("seat_a_locked", False))
        masked["seat_b_locked"] = bool(room.get("seat_b_locked", False))
        masked["seat_a_owner_name"] = room.get("seat_a_owner_name") or (room.get("captain_a_name") if room.get("seat_a_locked") else None)
        masked["seat_b_owner_name"] = room.get("seat_b_owner_name") or (room.get("captain_b_name") if room.get("seat_b_locked") else None)

        phase = masked.get("phase")
        locked_a = bool(masked.get("locked_a"))
        locked_b = bool(masked.get("locked_b"))

        masked["secret_defender_a_locked"] = locked_a if phase == "STEP_1_DEFENDER" else bool(masked.get("defender_a"))
        masked["secret_defender_b_locked"] = locked_b if phase == "STEP_1_DEFENDER" else bool(masked.get("defender_b"))
        masked["secret_attackers_a_locked"] = locked_a if phase == "STEP_2_ATTACKERS" else bool(masked.get("attackers_a"))
        masked["secret_attackers_b_locked"] = locked_b if phase == "STEP_2_ATTACKERS" else bool(masked.get("attackers_b"))
        masked["secret_choice_a_locked"] = locked_a if phase == "STEP_3_CHOOSE" else False
        masked["secret_choice_b_locked"] = locked_b if phase == "STEP_3_CHOOSE" else False

        def_a_id = masked.get("defender_a")
        def_b_id = masked.get("defender_b")
        masked["active_defender_a"] = copy.deepcopy(self._find_player(room, def_a_id)) if def_a_id else None
        masked["active_defender_b"] = copy.deepcopy(self._find_player(room, def_b_id)) if def_b_id else None
        masked["active_attackers_a"] = [
            copy.deepcopy(self._find_player(room, pid))
            for pid in (masked.get("attackers_a") or [])
            if self._find_player(room, pid)
        ]
        masked["active_attackers_b"] = [
            copy.deepcopy(self._find_player(room, pid))
            for pid in (masked.get("attackers_b") or [])
            if self._find_player(room, pid)
        ]

        if viewer_role != "captain_a":
            masked["secret_defender_a"] = None
            masked["secret_attackers_a"] = []
            masked["secret_choice_a"] = None
        if viewer_role != "captain_b":
            masked["secret_defender_b"] = None
            masked["secret_attackers_b"] = []
            masked["secret_choice_b"] = None

        return masked

    def _find_player(self, room: Dict[str, Any], player_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not player_id:
            return None
        for p in room["team_a"]["roster"]:
            if p["id"] == player_id:
                return p
        for p in room["team_b"]["roster"]:
            if p["id"] == player_id:
                return p
        return None

    def _append_log(self, room: Dict[str, Any], msg: str) -> None:
        ts_str = datetime.now(timezone.utc).strftime("%H:%M:%S")
        room.setdefault("history_log", []).append(msg)
        room.setdefault("log", []).append({"ts": ts_str, "msg": msg})

    def _run_ai_captain_b_decision(self, room: Dict[str, Any]) -> None:
        """Smart AI Captain for Team B: selects and locks Defender, 2 Attackers, or Attacker Choice."""
        if not room.get("vs_ai") or room.get("locked_b") or room.get("phase") == "COMPLETED":
            return

        phase = room.get("phase")
        bench_b_ids = list(room.get("bench_b") or [])
        bench_b_players = [self._find_player(room, pid) for pid in bench_b_ids if self._find_player(room, pid)]

        if phase in ("STEP_1_DEFENDER", "PICK_DEFENDER") and bench_b_players:
            def _def_score(p: Dict[str, Any]) -> float:
                role_bonus = 35.0 if ("Defender" in str(p.get("role", "")) or "Blunt" in str(p.get("role", ""))) else (15.0 if "All-Rounder" in str(p.get("role", "")) else 0.0)
                return float(p.get("elo", 2000)) * 0.05 + role_bonus
            best_def = sorted(bench_b_players, key=_def_score, reverse=True)[0]
            room["secret_defender_b"] = best_def["id"]
            room["locked_b"] = True

        elif phase in ("STEP_2_ATTACKERS", "PICK_ATTACKERS") and len(bench_b_players) >= 2:
            def_a = self._find_player(room, room.get("defender_a"))
            if def_a:
                scored = sorted(
                    bench_b_players,
                    key=lambda pb: (20 - self.estimate_wtc_matchup(def_a, pb), float(pb.get("elo", 2000))),
                    reverse=True,
                )
                room["secret_attackers_b"] = [scored[0]["id"], scored[1]["id"]]
            else:
                room["secret_attackers_b"] = [bench_b_players[0]["id"], bench_b_players[1]["id"]]
            room["locked_b"] = True

        elif phase in ("STEP_3_CHOOSE", "CHOOSE_OPPONENT"):
            def_b = self._find_player(room, room.get("defender_b"))
            att_a_ids = list(room.get("attackers_a") or [])
            att_a_players = [self._find_player(room, pid) for pid in att_a_ids if self._find_player(room, pid)]
            if def_b and att_a_players:
                best_target = sorted(
                    att_a_players,
                    key=lambda pa: (self.estimate_wtc_matchup(pa, def_b), float(pa.get("elo", 2000))),
                )[0]
                room["secret_choice_b"] = best_target["id"]
                room["locked_b"] = True
            elif att_a_players:
                room["secret_choice_b"] = att_a_players[0]["id"]
                room["locked_b"] = True

    def _append_pairing(
        self,
        room: Dict[str, Any],
        player_a_id: str,
        player_b_id: str,
        pairing_type: str,
    ) -> None:
        pa = self._find_player(room, player_a_id) or {"id": player_a_id, "name": player_a_id, "faction": "Unknown", "elo": 2000}
        pb = self._find_player(room, player_b_id) or {"id": player_b_id, "name": player_b_id, "faction": "Unknown", "elo": 2000}
        table_num = len(room["pairings"]) + 1
        est_a = self.estimate_wtc_matchup(pa, pb)
        est_b = 20 - est_a
        room["pairings"].append({
            "table": table_num,
            "table_num": table_num,
            "cycle": room["cycle"],
            "pairing_type": pairing_type,
            "player_a": pa,
            "player_b": pb,
            "est_score_a": est_a,
            "est_score_b": est_b,
            "matchup": {
                "expected_a": est_a,
                "expected_b": est_b,
                "label": f"{est_a} - {est_b}",
            },
        })

    def _advance_phase_if_both_locked(self, room: Dict[str, Any]) -> None:
        if not (room.get("locked_a") and room.get("locked_b")):
            return

        phase = room.get("phase")
        cycle = int(room.get("cycle") or 1)

        if phase in ("STEP_1_DEFENDER", "PICK_DEFENDER"):
            def_a_id = room.get("secret_defender_a")
            def_b_id = room.get("secret_defender_b")
            room["defender_a"] = def_a_id
            room["defender_b"] = def_b_id
            room["secret_defender_a"] = None
            room["secret_defender_b"] = None
            if def_a_id in room["bench_a"]:
                room["bench_a"].remove(def_a_id)
            if def_b_id in room["bench_b"]:
                room["bench_b"].remove(def_b_id)
            room["locked_a"] = False
            room["locked_b"] = False

            pa = self._find_player(room, def_a_id)
            pb = self._find_player(room, def_b_id)
            self._append_log(
                room,
                f"Cycle {cycle} Defenders Revealed: {pa['name'] if pa else def_a_id} ({pa['faction'] if pa else ''}) vs {pb['name'] if pb else def_b_id} ({pb['faction'] if pb else ''}).",
            )

            # Endgame fast-forward: if exactly 2 players remain on each bench (Cycle 2 in 5v5),
            # they automatically step forward as the 2 Attackers!
            if len(room["bench_a"]) == 2 and len(room["bench_b"]) == 2:
                room["attackers_a"] = list(room["bench_a"])
                room["attackers_b"] = list(room["bench_b"])
                room["bench_a"] = []
                room["bench_b"] = []
                room["phase"] = "STEP_3_CHOOSE"
                self._append_log(
                    room,
                    f"Cycle {cycle} Endgame: Remaining 2 bench players on each team automatically step forward as Attackers! Captains now choose 1 Attacker for their Defender.",
                )
            else:
                room["phase"] = "STEP_2_ATTACKERS"
                self._append_log(
                    room,
                    f"Cycle {cycle} — Step 2: Both Captains secretly nominate 2 Attackers to challenge the opponent's Defender.",
                )

        elif phase in ("STEP_2_ATTACKERS", "PICK_ATTACKERS"):
            att_a = list(room.get("secret_attackers_a") or [])
            att_b = list(room.get("secret_attackers_b") or [])
            room["attackers_a"] = att_a
            room["attackers_b"] = att_b
            room["secret_attackers_a"] = []
            room["secret_attackers_b"] = []
            room["bench_a"] = [pid for pid in room["bench_a"] if pid not in att_a]
            room["bench_b"] = [pid for pid in room["bench_b"] if pid not in att_b]
            room["locked_a"] = False
            room["locked_b"] = False
            room["phase"] = "STEP_3_CHOOSE"

            names_a = ", ".join((self._find_player(room, pid) or {}).get("name", pid) for pid in att_a)
            names_b = ", ".join((self._find_player(room, pid) or {}).get("name", pid) for pid in att_b)
            self._append_log(
                room,
                f"Cycle {cycle} Attackers Revealed! {room['team_a']['short_tag']} sends [{names_a}]; {room['team_b']['short_tag']} sends [{names_b}].",
            )

        elif phase in ("STEP_3_CHOOSE", "CHOOSE_OPPONENT"):
            def_a_id = room.get("defender_a")
            def_b_id = room.get("defender_b")
            chosen_b_id = room.get("secret_choice_a")
            chosen_a_id = room.get("secret_choice_b")
            att_b_list = list(room.get("attackers_b") or [])
            att_a_list = list(room.get("attackers_a") or [])

            if chosen_b_id not in att_b_list and att_b_list:
                chosen_b_id = att_b_list[0]
            if chosen_a_id not in att_a_list and att_a_list:
                chosen_a_id = att_a_list[0]

            rejected_b_ids = [pid for pid in att_b_list if pid != chosen_b_id]
            rejected_a_ids = [pid for pid in att_a_list if pid != chosen_a_id]

            # Match 1: Team A Defender vs Chosen Team B Attacker
            self._append_pairing(room, def_a_id, chosen_b_id, f"Cycle {cycle} • {room['team_a']['short_tag']} Defender Choice")
            # Match 2: Chosen Team A Attacker vs Team B Defender
            self._append_pairing(room, chosen_a_id, def_b_id, f"Cycle {cycle} • {room['team_b']['short_tag']} Defender Choice")

            room["defender_a"] = None
            room["defender_b"] = None
            room["attackers_a"] = []
            room["attackers_b"] = []
            room["secret_choice_a"] = None
            room["secret_choice_b"] = None
            room["locked_a"] = False
            room["locked_b"] = False

            # Check WTC 8v8 Cycle 3 Forgotten/Rejected rule (1 player stayed on bench + 1 rejected attacker)
            if len(room["bench_a"]) == 1 and len(room["bench_b"]) == 1 and len(rejected_a_ids) == 1 and len(rejected_b_ids) == 1:
                forgotten_a = room["bench_a"][0]
                forgotten_b = room["bench_b"][0]
                rej_a = rejected_a_ids[0]
                rej_b = rejected_b_ids[0]
                self._append_pairing(room, rej_a, forgotten_b, f"Cycle {cycle} • Rejected vs Forgotten")
                self._append_pairing(room, forgotten_a, rej_b, f"Cycle {cycle} • Forgotten vs Rejected")
                room["bench_a"] = []
                room["bench_b"] = []
                room["phase"] = "COMPLETED"
                self._append_log(room, "All 8 WTC Match Pairings Locked! Final Rejected vs. Forgotten tables assigned.")
                self._sync_roster_statuses(room)
                return

            # Return rejected attackers to bench
            room["bench_a"].extend(rejected_a_ids)
            room["bench_b"].extend(rejected_b_ids)

            # Check 5v5 Endgame Remainder (1 rejected attacker left on each bench -> automatic Match #5)
            if len(room["bench_a"]) == 1 and len(room["bench_b"]) == 1:
                last_a = room["bench_a"][0]
                last_b = room["bench_b"][0]
                self._append_pairing(room, last_a, last_b, f"Cycle {cycle} • Final Remainder (Forsaken)")
                room["bench_a"] = []
                room["bench_b"] = []
                room["phase"] = "COMPLETED"
                self._append_log(
                    room,
                    f"All {len(room['pairings'])} WTC Match Pairings Locked! Final two remaining players automatically paired on Table #{len(room['pairings'])}.",
                )
            elif len(room["bench_a"]) == 0 and len(room["bench_b"]) == 0:
                room["phase"] = "COMPLETED"
                self._append_log(room, "All WTC Match Pairings Locked!")
            else:
                room["cycle"] = cycle + 1
                room["phase"] = "STEP_1_DEFENDER"
                self._append_log(
                    room,
                    f"Cycle {cycle} Pairings Locked! Unchosen attackers returned to bench ({len(room['bench_a'])} players remaining per team). Starting Cycle {cycle + 1} — Pick Defenders.",
                )

        self._sync_roster_statuses(room)

    def apply_pairing_action(
        self,
        room_code: str,
        payload: Optional[Dict[str, Any]] = None,
        *,
        role: Optional[str] = None,
        captain_token: Optional[str] = None,
        action: Optional[str] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """
        Applies a Captain or room action.
        Enforces that ONLY Captain A can interact for Team A and ONLY Captain B can interact for Team B.
        Spectators cannot perform pairing actions (403).
        """
        room = self.get_pairing_room_raw(room_code)
        if not room:
            return {"ok": False, "success": False, "status_code": 404, "error": f"Pairing room '{room_code}' not found."}

        req: Dict[str, Any] = {}
        if isinstance(payload, dict):
            req.update(payload)
            if isinstance(payload.get("payload"), dict):
                req.update(payload["payload"])
        req.update(kwargs)

        act = str(action or req.get("action") or "").strip().lower()
        role_token = str(captain_token if captain_token is not None else (req.get("captain_token") or req.get("role_token") or "")).strip()
        force_role = role or req.get("role") or req.get("force_role")

        if "vs_ai" in req and req["vs_ai"] is not None:
            room["vs_ai"] = bool(req["vs_ai"])

        caller_uid = str(req.get("user_id") or req.get("guest_id") or "").strip()

        if act == "toggle_room_lock":
            desired_lock = bool(req.get("is_locked", not room.get("is_locked", False)))
            room["is_locked"] = desired_lock
            self._save_pairing_room_doc(room["room_code"], room)
            v_role = self.resolve_viewer_role(room, role_token=role_token, force_role=force_role)
            return {
                "ok": True,
                "success": True,
                "status_code": 200,
                "is_locked": desired_lock,
                "room": self.mask_pairing_room_for_viewer(room, force_role=v_role),
            }

        if act in ("unlock_seat", "leave_seat"):
            target_seat = str(req.get("seat") or force_role or "").strip().lower()
            if target_seat == "captain_a":
                room["seat_a_locked"] = False
                room["user_id_cap_a"] = None
                room["seat_a_owner_name"] = None
                room["captain_a_claimed"] = False
            elif target_seat == "captain_b":
                room["seat_b_locked"] = False
                room["user_id_cap_b"] = None
                room["seat_b_owner_name"] = None
                room["captain_b_claimed"] = bool(room.get("vs_ai"))
            self._save_pairing_room_doc(room["room_code"], room)
            return {
                "ok": True,
                "success": True,
                "status_code": 200,
                "role": "spectator",
                "room": self.mask_pairing_room_for_viewer(room, force_role="spectator"),
            }

        if act == "claim_seat":
            seat = str(req.get("seat") or force_role or "spectator").strip().lower()
            cap_name = str(req.get("captain_name") or req.get("user_name") or "").strip()
            has_token_a = bool(role_token and role_token == room.get("captain_a_token"))
            has_token_b = bool(role_token and role_token == room.get("captain_b_token"))

            if seat == "captain_a":
                existing_owner_a = str(room.get("user_id_cap_a") or "").strip()
                if (
                    room.get("seat_a_locked")
                    and existing_owner_a
                    and caller_uid
                    and existing_owner_a != caller_uid
                    and not has_token_a
                ):
                    owner_lbl = room.get("seat_a_owner_name") or room.get("captain_a_name") or "Player 1"
                    return {
                        "ok": False,
                        "success": False,
                        "status_code": 409,
                        "error": f"Team A Captain seat is locked by {owner_lbl}.",
                        "room": self.mask_pairing_room_for_viewer(room, force_role="spectator"),
                    }
                if (
                    room.get("is_locked")
                    and room.get("owner_id")
                    and caller_uid
                    and caller_uid != str(room.get("owner_id"))
                    and caller_uid != existing_owner_a
                    and not has_token_a
                ):
                    return {
                        "ok": False,
                        "success": False,
                        "status_code": 403,
                        "error": "Room is locked by owner. Joining as Spectator.",
                        "role": "spectator",
                        "room": self.mask_pairing_room_for_viewer(room, force_role="spectator"),
                    }
                # Release Seat B if this same caller held Seat B
                if caller_uid and str(room.get("user_id_cap_b") or "") == caller_uid:
                    room["seat_b_locked"] = False
                    room["user_id_cap_b"] = None
                    room["seat_b_owner_name"] = None
                if cap_name:
                    room["captain_a_name"] = cap_name
                    room["team_a"]["captain_name"] = cap_name
                    room["seat_a_owner_name"] = cap_name
                else:
                    room["seat_a_owner_name"] = room.get("seat_a_owner_name") or room.get("captain_a_name")
                room["captain_a_claimed"] = True
                room["seat_a_locked"] = True
                if caller_uid:
                    room["user_id_cap_a"] = caller_uid
                    if not room.get("owner_id"):
                        room["owner_id"] = caller_uid
                self._save_pairing_room_doc(room["room_code"], room)
                return {
                    "ok": True,
                    "success": True,
                    "status_code": 200,
                    "role": "captain_a",
                    "captain_token": room["captain_a_token"],
                    "room": self.mask_pairing_room_for_viewer(room, force_role="captain_a"),
                }
            if seat == "captain_b":
                existing_owner_b = str(room.get("user_id_cap_b") or "").strip()
                if (
                    room.get("seat_b_locked")
                    and existing_owner_b
                    and caller_uid
                    and existing_owner_b != caller_uid
                    and not has_token_b
                ):
                    owner_lbl = room.get("seat_b_owner_name") or room.get("captain_b_name") or "Player 2"
                    return {
                        "ok": False,
                        "success": False,
                        "status_code": 409,
                        "error": f"Team B Captain seat is locked by {owner_lbl}.",
                        "room": self.mask_pairing_room_for_viewer(room, force_role="spectator"),
                    }
                if (
                    room.get("is_locked")
                    and room.get("owner_id")
                    and caller_uid
                    and caller_uid != str(room.get("owner_id"))
                    and caller_uid != existing_owner_b
                    and not has_token_b
                ):
                    return {
                        "ok": False,
                        "success": False,
                        "status_code": 403,
                        "error": "Room is locked by owner. Joining as Spectator.",
                        "role": "spectator",
                        "room": self.mask_pairing_room_for_viewer(room, force_role="spectator"),
                    }
                # Release Seat A if this same caller held Seat A
                if caller_uid and str(room.get("user_id_cap_a") or "") == caller_uid:
                    room["seat_a_locked"] = False
                    room["user_id_cap_a"] = None
                    room["seat_a_owner_name"] = None
                room["vs_ai"] = False
                room["captain_b_claimed"] = True
                room["seat_b_locked"] = True
                if caller_uid:
                    room["user_id_cap_b"] = caller_uid
                if cap_name:
                    room["captain_b_name"] = cap_name
                    room["team_b"]["captain_name"] = cap_name
                    room["seat_b_owner_name"] = cap_name
                else:
                    clean_b = str(room.get("captain_b_name") or "Captain B").replace(" (AI Bot)", "")
                    room["captain_b_name"] = clean_b
                    room["team_b"]["captain_name"] = clean_b
                    room["seat_b_owner_name"] = clean_b
                self._save_pairing_room_doc(room["room_code"], room)
                return {
                    "ok": True,
                    "success": True,
                    "status_code": 200,
                    "role": "captain_b",
                    "captain_token": room["captain_b_token"],
                    "room": self.mask_pairing_room_for_viewer(room, force_role="captain_b"),
                }
            # Spectator seat: release any Captain seat held by this caller
            if caller_uid:
                if str(room.get("user_id_cap_a") or "") == caller_uid:
                    room["seat_a_locked"] = False
                    room["user_id_cap_a"] = None
                    room["seat_a_owner_name"] = None
                if str(room.get("user_id_cap_b") or "") == caller_uid:
                    room["seat_b_locked"] = False
                    room["user_id_cap_b"] = None
                    room["seat_b_owner_name"] = None
            room["spectator_count"] = int(room.get("spectator_count") or 0) + 1
            self._save_pairing_room_doc(room["room_code"], room)
            return {
                "ok": True,
                "success": True,
                "status_code": 200,
                "role": "spectator",
                "captain_token": "",
                "room": self.mask_pairing_room_for_viewer(room, force_role="spectator"),
            }

        viewer_role = self.resolve_viewer_role(room, role_token=role_token, force_role=force_role)
        if viewer_role not in ("captain_a", "captain_b"):
            return {
                "ok": False,
                "success": False,
                "status_code": 403,
                "error": "Spectators are read-only. Only Team A Captain and Team B Captain can submit pairing actions.",
            }

        is_cap_a = viewer_role == "captain_a"
        side_suffix = "a" if is_cap_a else "b"
        phase = room.get("phase")

        if act == "set_team_roster":
            import copy
            team_key = "team_a" if is_cap_a else "team_b"
            id_prefix = "A" if is_cap_a else "B"
            team_size = int(room.get("team_size") or 5)
            raw_roster = req.get("roster") or []
            if not isinstance(raw_roster, list) or len(raw_roster) < 1:
                return {"ok": False, "success": False, "status_code": 400, "error": "Roster must contain at least 1 player."}
            new_roster = []
            for idx, item in enumerate(raw_roster[:team_size]):
                if not isinstance(item, dict):
                    continue
                role_label = str(item.get("role_tag") or item.get("role") or "All-Rounder").strip()
                new_roster.append({
                    "id": f"{id_prefix}{idx + 1}",
                    "name": str(item.get("name") or f"Player {idx + 1}").strip(),
                    "faction": str(item.get("faction") or "Space Marines").strip(),
                    "detachment": str(item.get("detachment") or "Index / Strike Force").strip(),
                    "elo": int(float(item.get("elo") or 2000)),
                    "role": role_label,
                    "role_tag": role_label,
                    "team": id_prefix,
                    "status": "bench",
                })
            # Pad from existing roster if fewer than team_size were provided
            existing_roster = room[team_key].get("roster") or []
            while len(new_roster) < team_size and len(existing_roster) > len(new_roster):
                idx = len(new_roster)
                fallback_p = copy.deepcopy(existing_roster[idx])
                fallback_p["id"] = f"{id_prefix}{idx + 1}"
                fallback_p["team"] = id_prefix
                fallback_p["status"] = "bench"
                new_roster.append(fallback_p)

            if req.get("team_name"):
                room[team_key]["name"] = str(req["team_name"]).strip()
            if req.get("team_tag"):
                tag_val = str(req["team_tag"]).strip().upper()[:4]
                room[team_key]["tag"] = tag_val
                room[team_key]["short_tag"] = tag_val
            if new_roster:
                room[team_key]["captain_name"] = new_roster[0]["name"]
                room[f"captain_{side_suffix}_name"] = new_roster[0]["name"]

            room[team_key]["roster"] = new_roster
            room[f"bench_{side_suffix}"] = [p["id"] for p in new_roster]
            room[f"secret_defender_{side_suffix}"] = None
            room[f"defender_{side_suffix}"] = None
            room[f"secret_attackers_{side_suffix}"] = []
            room[f"attackers_{side_suffix}"] = []
            room[f"secret_choice_{side_suffix}"] = None
            room[f"locked_{side_suffix}"] = False
            self._sync_roster_statuses(room)
            self._save_pairing_room_doc(room["room_code"], room)
            return {
                "ok": True,
                "success": True,
                "status_code": 200,
                "room": self.mask_pairing_room_for_viewer(room, force_role=viewer_role),
            }

        if act == "toggle_ai":
            room["vs_ai"] = bool(req.get("vs_ai", not room.get("vs_ai")))
            if room["vs_ai"]:
                self._run_ai_captain_b_decision(room)
                self._advance_phase_if_both_locked(room)
            self._save_pairing_room_doc(room["room_code"], room)
            return {
                "ok": True,
                "success": True,
                "status_code": 200,
                "room": self.mask_pairing_room_for_viewer(room, force_role=viewer_role),
            }

        if phase == "COMPLETED":
            return {"ok": False, "success": False, "status_code": 400, "error": "All pairings in this room are already finalized."}

        if phase in ("STEP_1_DEFENDER", "PICK_DEFENDER"):
            player_id = str(req.get("player_id") or "").strip()
            bench = room[f"bench_{side_suffix}"]
            if player_id not in bench:
                return {
                    "ok": False,
                    "success": False,
                    "status_code": 400,
                    "error": f"Player '{player_id}' is not available on Team {'A' if is_cap_a else 'B'} bench.",
                }
            room[f"secret_defender_{side_suffix}"] = player_id
            if bool(req.get("lock", True)):
                room[f"locked_{side_suffix}"] = True

        elif phase in ("STEP_2_ATTACKERS", "PICK_ATTACKERS"):
            player_ids = req.get("player_ids") or []
            if not isinstance(player_ids, list):
                player_ids = []
            bench = room[f"bench_{side_suffix}"]
            clean_ids = []
            for pid in player_ids:
                s_pid = str(pid).strip()
                if s_pid in bench and s_pid not in clean_ids:
                    clean_ids.append(s_pid)
            if bool(req.get("lock", True)) and len(clean_ids) != 2:
                return {
                    "ok": False,
                    "success": False,
                    "status_code": 400,
                    "error": "You must select exactly 2 Attackers from your bench before locking in.",
                }
            room[f"secret_attackers_{side_suffix}"] = clean_ids[:2]
            if bool(req.get("lock", True)):
                room[f"locked_{side_suffix}"] = True

        elif phase in ("STEP_3_CHOOSE", "CHOOSE_OPPONENT"):
            player_id = str(req.get("player_id") or "").strip()
            opp_suffix = "b" if is_cap_a else "a"
            opp_attackers = room[f"attackers_{opp_suffix}"]
            if player_id not in opp_attackers:
                return {
                    "ok": False,
                    "success": False,
                    "status_code": 400,
                    "error": f"Player '{player_id}' is not one of the 2 nominated Attackers.",
                }
            room[f"secret_choice_{side_suffix}"] = player_id
            if bool(req.get("lock", True)):
                room[f"locked_{side_suffix}"] = True
        else:
            return {"ok": False, "success": False, "status_code": 400, "error": f"Unsupported action '{act}' in phase '{phase}'."}

        # If vs_ai is enabled, let AI Captain B lock in its decision for the current phase
        if room.get("vs_ai"):
            self._run_ai_captain_b_decision(room)

        # If both captains have locked in, reveal simultaneously and advance phase
        self._advance_phase_if_both_locked(room)

        self._save_pairing_room_doc(room["room_code"], room)
        return {
            "ok": True,
            "success": True,
            "status_code": 200,
            "room": self.mask_pairing_room_for_viewer(room, force_role=viewer_role),
        }


# Singleton instance
_firestore_engine_instance = None

def get_firestore_engine() -> FirestoreRoomEngine:
    global _firestore_engine_instance
    if _firestore_engine_instance is None:
        _firestore_engine_instance = FirestoreRoomEngine(project_id="eloranking-506820")
    return _firestore_engine_instance


def get_event_livestreams(event_id: str) -> List[Dict[str, Any]]:
    return get_firestore_engine().get_event_livestreams(event_id)


def set_event_livestreams(event_id: str, streams: List[Dict[str, Any]]) -> bool:
    return get_firestore_engine().set_event_livestreams(event_id, streams)


def save_event_livestream(
    event_id: str,
    table_number: int,
    channel: str,
    stream_url: str,
    platform: Optional[str] = None,
    title: Optional[str] = None,
    stream_id: Optional[str] = None,
    is_live: bool = True
) -> Dict[str, Any]:
    return get_firestore_engine().save_event_livestream(
        event_id=event_id,
        table_number=table_number,
        channel=channel,
        stream_url=stream_url,
        platform=platform,
        title=title,
        stream_id=stream_id,
        is_live=is_live
    )


def delete_event_livestream(event_id: str, stream_id: str) -> bool:
    return get_firestore_engine().delete_event_livestream(event_id, stream_id)


_parse_stream_embed = FirestoreRoomEngine._parse_stream_embed

