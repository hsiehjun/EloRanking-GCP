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
    FIRESTORE_AVAILABLE = True
except ImportError:
    FIRESTORE_AVAILABLE = False
    logger.warning("google-cloud-firestore package not found locally. Running in in-memory fallback mode.")

class FirestoreRoomEngine:
    """Manages hot ephemeral match rooms in Cloud Firestore ('rooms/{match_id}')."""

    def __init__(self, project_id: str = "eloranking-506820"):
        self.project_id = project_id
        self._client = None
        self._fallback_rooms: Dict[str, Any] = {}
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
                query = col.where("status", "==", "in_progress").limit(limit)
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
                expired_docs = col_ref.where("expiresAt", "<=", now_dt).limit(100).stream()
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
            expired_rooms = rooms_ref.where("expiresAt", "<=", now_ts).limit(100).stream()
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
