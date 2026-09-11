"""
Google Cloud Firestore Native Engine for Warhammer 40,000 Match Rooms.
Provides real-time collaborative synchronization for live matches.
PostgreSQL is strictly cold storage for finalized verified scorecards.
"""

import os
import logging
from typing import Dict, Any, Optional, List
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

class FirestoreRoomEngine:
    """Manages hot ephemeral match rooms in Cloud Firestore ('rooms/{match_id}')."""

    def __init__(self, project_id: str = "eloranking-506820"):
        self.project_id = project_id
        self._client = None
        self._fallback_rooms: Dict[str, Any] = {}
        self._fallback_tournaments: Dict[str, Any] = {}
        self._fallback_judge_calls: Dict[str, Dict[str, Any]] = {}
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

    def get_room_doc_ref(self, match_id: str):
        if not match_id or not self._client:
            return None
        return self._client.collection("rooms").document(match_id.strip().upper())

    def create_room(self, match_id: str, room_payload: Dict[str, Any]) -> Dict[str, Any]:
        """Creates or initializes a live match room document in Firestore."""
        match_id = match_id.strip().upper()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        expires_ts = now_ts + (14 * 24 * 60 * 60 * 1000) # 14 days TTL

        data = {
            "roomKey": match_id,
            "matchId": match_id,
            "status": "in_progress",
            "createdAt": now_ts,
            "updatedAt": now_ts,
            "expiresAt": expires_ts,
            **room_payload
        }

        if self._client:
            try:
                ref = self.get_room_doc_ref(match_id)
                ref.set(data, merge=True)
                logger.info(f"🔥 [FIRESTORE] Created/Set rooms/{match_id}")
            except Exception as e:
                logger.error(f"❌ [FIRESTORE] Error creating room {match_id}: {e}")

        self._fallback_rooms[match_id] = data
        return data

    def get_room(self, match_id: str) -> Optional[Dict[str, Any]]:
        """Fetches live match room state from Firestore."""
        match_id = match_id.strip().upper()
        if self._client:
            try:
                ref = self.get_room_doc_ref(match_id)
                snap = ref.get()
                if snap.exists:
                    d = snap.to_dict()
                    self._fallback_rooms[match_id] = d
                    return d
            except Exception as e:
                logger.error(f"❌ [FIRESTORE] Error getting room {match_id}: {e}")

        return self._fallback_rooms.get(match_id)

    def update_room(self, match_id: str, updates: Dict[str, Any]) -> bool:
        """Applies field updates to live room in Firestore."""
        match_id = match_id.strip().upper()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        updates["updatedAt"] = now_ts

        if self._client:
            try:
                # Automatically prune legacy duplicate fields if present
                for legacy_field in ("clock", "game"):
                    if legacy_field not in updates:
                        updates[legacy_field] = firestore.DELETE_FIELD
                ref = self.get_room_doc_ref(match_id)
                ref.set(updates, merge=True)
                return True
            except Exception as e:
                logger.error(f"❌ [FIRESTORE] Error updating room {match_id}: {e}")

        if match_id in self._fallback_rooms:
            self._fallback_rooms[match_id].update(updates)
            self._fallback_rooms[match_id].pop("clock", None)
            self._fallback_rooms[match_id].pop("game", None)
        else:
            self._fallback_rooms[match_id] = updates
        return True

    def discard_room(self, match_id: str) -> bool:
        """Deletes / discards a match room from Firestore."""
        clean_id = match_id.strip().upper()
        short_id = clean_id.replace("WH40K-", "")
        if self._client:
            try:
                ref1 = self.get_room_doc_ref(clean_id)
                if ref1:
                    ref1.delete()
                if short_id != clean_id:
                    ref2 = self.get_room_doc_ref(short_id)
                    if ref2:
                        ref2.delete()
                logger.info(f"🗑️ [FIRESTORE] Deleted discarded room rooms/{clean_id}")
            except Exception as e:
                logger.error(f"Error discarding Firestore room {clean_id}: {e}")

        for key in (clean_id, short_id):
            if key in self._fallback_rooms:
                try:
                    del self._fallback_rooms[key]
                except KeyError:
                    pass
        return True

    def finalize_room(self, match_id: str) -> bool:
        """Marks a match room as completed and removes it from active Firestore."""
        return self.discard_room(match_id)

    def list_active_rooms_for_user(self, user_id: Optional[str] = None, user_name: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """Queries Firestore for active in_progress rooms involving this user."""
        rooms = []
        seen_keys = set()
        
        if self._client:
            try:
                col = self._client.collection("rooms")
                query = _apply_where(col, "status", "==", "in_progress").limit(limit)
                for doc in query.stream():
                    d = doc.to_dict()
                    rkey = d.get("roomKey") or d.get("matchId") or doc.id
                    if not rkey or rkey in seen_keys:
                        continue
                    
                    if d.get("status") in ("abandoned", "completed") or d.get("is_abandoned") or d.get("is_finished"):
                        continue

                    p1_id = d.get("user_id_p1") or (d.get("participants", {}).get("player1", {}).get("uid") if isinstance(d.get("participants"), dict) else None)
                    p2_id = d.get("user_id_p2") or (d.get("participants", {}).get("player2", {}).get("uid") if isinstance(d.get("participants"), dict) else None)
                    p1_name = (d.get("p1_name") or (d.get("state", {}).get("game", {}).get("p1Name") if isinstance(d.get("state"), dict) else "") or "").strip().lower()
                    p2_name = (d.get("p2_name") or (d.get("state", {}).get("game", {}).get("p2Name") if isinstance(d.get("state"), dict) else "") or "").strip().lower()
                    
                    match = False
                    if not user_id and not user_name:
                        match = True
                    elif user_id and (p1_id == user_id or p2_id == user_id):
                        match = True
                    elif user_name:
                        u_lower = user_name.strip().lower()
                        # Strict exact equality matching (no substring containment)
                        if (p1_name and u_lower == p1_name) or (p2_name and u_lower == p2_name):
                            match = True
                            
                    if match:
                        seen_keys.add(rkey)
                        rooms.append(d)
            except Exception as e:
                logger.warning(f"Notice listing Firestore user rooms: {e}")

        for mid, d in self._fallback_rooms.items():
            rkey = d.get("roomKey") or d.get("matchId") or mid
            if rkey not in seen_keys and d.get("status") == "in_progress" and not d.get("is_abandoned") and not d.get("is_finished"):
                p1_id = d.get("user_id_p1") or (d.get("participants", {}).get("player1", {}).get("uid") if isinstance(d.get("participants"), dict) else None)
                p2_id = d.get("user_id_p2") or (d.get("participants", {}).get("player2", {}).get("uid") if isinstance(d.get("participants"), dict) else None)
                p1_name = (d.get("p1_name") or (d.get("state", {}).get("game", {}).get("p1Name") if isinstance(d.get("state"), dict) else "") or "").strip().lower()
                p2_name = (d.get("p2_name") or (d.get("state", {}).get("game", {}).get("p2Name") if isinstance(d.get("state"), dict) else "") or "").strip().lower()
                
                match = False
                if not user_id and not user_name:
                    match = True
                elif user_id and (p1_id == user_id or p2_id == user_id):
                    match = True
                elif user_name:
                    u_lower = user_name.strip().lower()
                    if (p1_name and u_lower == p1_name) or (p2_name and u_lower == p2_name):
                        match = True
                if match:
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

    def get_tournament_doc_ref(self, event_id: str):
        if not event_id or not self._client:
            return None
        return self._client.collection("tournaments").document(str(event_id).strip())

    def get_tournament_master_clock(self, event_id: str) -> Optional[Dict[str, Any]]:
        """Fetches tournament round master clock from tournaments/{event_id}."""
        event_id = str(event_id).strip()
        if self._client:
            try:
                ref = self.get_tournament_doc_ref(event_id)
                if ref:
                    snap = ref.get()
                    if snap.exists:
                        data = snap.to_dict() or {}
                        clock = data.get("masterClock")
                        if clock:
                            return clock
            except Exception as e:
                logger.warning(f"Notice reading master clock from Firestore: {e}")
        return self._fallback_tournaments.get(event_id, {}).get("masterClock")

    def update_tournament_master_clock(self, event_id: str, clock_data: Dict[str, Any]) -> Dict[str, Any]:
        """Updates tournament master clock in tournaments/{event_id} and events/{event_id}."""
        event_id = str(event_id).strip()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        clock_data["updatedAt"] = now_ts
        clock_data["updated_at"] = now_ts

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

        doc_payload = {
            "id": event_id,
            "eventId": event_id,
            "type": "Event",
            "masterClock": clock_data,
            "updatedAt": now_ts
        }

        if self._client:
            for col_name in ("tournaments", "events"):
                try:
                    ref = self._client.collection(col_name).document(event_id)
                    ref.set(doc_payload, merge=True)
                except Exception as e:
                    logger.warning(f"Notice saving master clock to Firestore {col_name}: {e}")

        if event_id not in self._fallback_tournaments:
            self._fallback_tournaments[event_id] = {}
        self._fallback_tournaments[event_id]["id"] = event_id
        self._fallback_tournaments[event_id]["eventId"] = event_id
        self._fallback_tournaments[event_id]["type"] = "Event"
        self._fallback_tournaments[event_id]["masterClock"] = clock_data
        self._fallback_tournaments[event_id]["updatedAt"] = now_ts

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
                    for val in (event_id, clean_id):
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
                rdata.get("eventId") in (event_id, clean_id) or
                rdata.get("event_id") in (event_id, clean_id) or
                rdata.get("tournament_id") in (event_id, clean_id)
            ):
                rdata["masterClock"] = clock_data
                count += 1
        return count

    def get_tournament_broadcast(self, event_id: str) -> Optional[Dict[str, Any]]:
        """Fetches active broadcast announcement for tournament."""
        event_id = str(event_id).strip()
        if self._client:
            try:
                ref = self.get_tournament_doc_ref(event_id)
                if ref:
                    snap = ref.get()
                    if snap.exists:
                        data = snap.to_dict() or {}
                        b = data.get("broadcast")
                        if b:
                            return b
            except Exception as e:
                logger.warning(f"Notice reading broadcast from Firestore: {e}")
        return self._fallback_tournaments.get(event_id, {}).get("broadcast")

    def publish_tournament_broadcast(self, event_id: str, broadcast_data: Dict[str, Any]) -> Dict[str, Any]:
        """Publishes broadcast announcement to tournaments/{event_id}."""
        event_id = str(event_id).strip()
        now_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
        import uuid as _uuid
        if not broadcast_data.get("id"):
            broadcast_data["id"] = f"msg_{int(now_ts)}_{_uuid.uuid4().hex[:6]}"
        broadcast_data["timestamp"] = now_ts
        broadcast_data["createdAt"] = now_ts
        broadcast_data["created_at"] = datetime.now(timezone.utc).isoformat()

        if self._client:
            try:
                ref = self.get_tournament_doc_ref(event_id)
                if ref:
                    ref.set({"eventId": event_id, "broadcast": broadcast_data, "updatedAt": now_ts}, merge=True)
            except Exception as e:
                logger.warning(f"Notice publishing broadcast to Firestore: {e}")

        if event_id not in self._fallback_tournaments:
            self._fallback_tournaments[event_id] = {}
        self._fallback_tournaments[event_id]["broadcast"] = broadcast_data
        self._fallback_tournaments[event_id]["updatedAt"] = now_ts
        return broadcast_data

    def save_judge_call(self, event_id: str, call_data: Dict[str, Any]) -> Dict[str, Any]:
        """Saves a judge dispatch call to tournaments/{event_id} and events/{event_id} main documents and subcollections."""
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

        target_event_ids = [event_id]
        if event_id.upper() not in target_event_ids:
            target_event_ids.append(event_id.upper())
        if event_id.lower() not in target_event_ids:
            target_event_ids.append(event_id.lower())

        if self._client:
            for target_eid in target_event_ids:
                # 1. Save to subcollection for backward compatibility
                try:
                    ref = self._client.collection("tournaments").document(target_eid).collection("judge_calls").document(call_id)
                    ref.set(record, merge=True)
                except Exception as e:
                    logger.warning(f"Notice saving judge call to Firestore subcollection: {e}")

                # 2. Save directly into single Event document arrays (tournaments/{id} and events/{id})
                for col_name in ("tournaments", "events"):
                    try:
                        doc_ref = self._client.collection(col_name).document(target_eid)
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
                        logger.warning(f"Notice updating judge_calls array on Firestore {col_name}/{target_eid}: {e}")

        for target_eid in target_event_ids:
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
                # 1. Subcollection update
                try:
                    ref = self._client.collection("tournaments").document(target_eid).collection("judge_calls").document(call_id)
                    ref.set(updates, merge=True)
                except Exception as e:
                    logger.warning(f"Notice updating judge call in Firestore subcollection: {e}")

                # 2. Main document arrays update (tournaments & events)
                for col_name in ("tournaments", "events"):
                    try:
                        doc_ref = self._client.collection(col_name).document(target_eid)
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
                        logger.warning(f"Notice updating judge call status in {col_name}/{target_eid}: {e}")

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
                # 1. Check the main Event document arrays first (fastest, single-doc real-time source)
                for col_name in ("tournaments", "events"):
                    try:
                        doc_ref = self._client.collection(col_name).document(target_eid)
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
                        logger.warning(f"Notice reading judge_calls from {col_name}/{target_eid}: {e}")

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
        clean_id = event_id.replace("bcp_", "").replace("ES-", "").replace("es-", "").strip()
        deleted_count = 0
        seen_mids = set()

        prefixes = (
            f"BCP-{event_id}-", f"ES-{event_id}-", f"WH40K-BCP-{event_id}-", f"WH40K-ES-{event_id}-",
            f"BCP-{clean_id}-", f"ES-{clean_id}-", f"WH40K-BCP-{clean_id}-", f"WH40K-ES-{clean_id}-",
            f"{event_id}-R", f"{clean_id}-R",
        )
        exacts = (f"BCP-{event_id}", f"ES-{event_id}", f"BCP-{clean_id}", f"ES-{clean_id}")

        if self._client:
            try:
                col = self._client.collection("rooms")
                for field in ("eventId", "event_id", "tournament_id"):
                    for val in (event_id, clean_id):
                        if not val:
                            continue
                        try:
                            for doc in col.where(field, "==", val).stream():
                                mid = doc.id
                                if mid not in seen_mids:
                                    seen_mids.add(mid)
                                    doc.reference.delete()
                                    deleted_count += 1
                        except Exception:
                            pass

                for doc in col.stream():
                    mid = doc.id
                    if mid in seen_mids:
                        continue
                    mid_upper = mid.upper()
                    if any(mid_upper.startswith(p.upper()) for p in prefixes) or any(mid_upper == x.upper() for x in exacts):
                        seen_mids.add(mid)
                        doc.reference.delete()
                        deleted_count += 1
            except Exception as e:
                logger.warning(f"Notice deleting Firestore rooms for event {event_id}: {e}")

        # Clean fallback in-memory rooms
        fallback_to_delete = []
        for mid, rdata in list(self._fallback_rooms.items()):
            mid_upper = str(mid).upper()
            if (
                mid in seen_mids or
                any(mid_upper.startswith(p.upper()) for p in prefixes) or
                any(mid_upper == x.upper() for x in exacts) or
                rdata.get("eventId") in (event_id, clean_id) or
                rdata.get("event_id") in (event_id, clean_id) or
                rdata.get("tournament_id") in (event_id, clean_id) or
                (isinstance(rdata.get("state"), dict) and (
                    rdata["state"].get("event_id") in (event_id, clean_id) or
                    rdata["state"].get("tournament_id") in (event_id, clean_id) or
                    (isinstance(rdata["state"].get("game"), dict) and rdata["state"]["game"].get("eventId") in (event_id, clean_id))
                ))
            ):
                fallback_to_delete.append(mid)

        for mid in fallback_to_delete:
            self._fallback_rooms.pop(mid, None)
            deleted_count += 1

        return deleted_count

    def delete_tournament_document(self, event_id: str) -> bool:
        """Deletes tournaments/{event_id} and all its judge_calls from Firestore."""
        if not event_id:
            return False
        event_id = str(event_id).strip()
        clean_id = event_id.replace("bcp_", "").replace("ES-", "").replace("es-", "").strip()

        if self._client:
            for eid in set([event_id, clean_id]):
                if not eid:
                    continue
                try:
                    doc_ref = self.get_tournament_doc_ref(eid)
                    if doc_ref:
                        # Delete judge_calls subcollection
                        for j_doc in doc_ref.collection("judge_calls").stream():
                            j_doc.reference.delete()
                        doc_ref.delete()
                except Exception as e:
                    logger.warning(f"Notice deleting tournament doc {eid} from Firestore: {e}")

        self._fallback_tournaments.pop(event_id, None)
        self._fallback_tournaments.pop(clean_id, None)
        self._fallback_judge_calls.pop(event_id, None)
        self._fallback_judge_calls.pop(clean_id, None)
        return True

    def delete_tournament_and_rooms(self, event_id: str) -> Dict[str, Any]:
        """Cascades tournament deletion to all its table game rooms in Firestore."""
        rooms_deleted = self.delete_event_rooms(event_id)
        self.delete_tournament_document(event_id)
        return {"success": True, "event_id": event_id, "rooms_deleted": rooms_deleted}

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

# Singleton instance
_firestore_engine_instance = None

def get_firestore_engine() -> FirestoreRoomEngine:
    global _firestore_engine_instance
    if _firestore_engine_instance is None:
        _firestore_engine_instance = FirestoreRoomEngine(project_id="eloranking-506820")
    return _firestore_engine_instance
