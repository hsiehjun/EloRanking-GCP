"""
Google Cloud Firestore Native Engine for Warhammer 40,000 Match Rooms.
Provides real-time collaborative synchronization for live matches.
PostgreSQL is strictly cold storage for finalized verified scorecards.
"""

import os
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone

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
                ref = self.get_room_doc_ref(match_id)
                ref.set(updates, merge=True)
                return True
            except Exception as e:
                logger.error(f"❌ [FIRESTORE] Error updating room {match_id}: {e}")

        if match_id in self._fallback_rooms:
            self._fallback_rooms[match_id].update(updates)
        else:
            self._fallback_rooms[match_id] = updates
        return True

    def discard_room(self, match_id: str) -> bool:
        """Marks a match room as abandoned in Firestore."""
        return self.update_room(match_id, {
            "status": "abandoned",
            "is_abandoned": True
        })

    def finalize_room(self, match_id: str) -> bool:
        """Marks a match room as completed in Firestore."""
        return self.update_room(match_id, {
            "status": "completed",
            "is_finished": True
        })

    def list_active_rooms_for_user(self, user_id: str, user_name: Optional[str] = None) -> List[Dict[str, Any]]:
        """Queries Firestore for active rooms involving this user."""
        if not user_id and not user_name:
            return []
        
        rooms = []
        if self._client:
            try:
                col = self._client.collection("rooms")
                query = col.where("status", "==", "in_progress").limit(20)
                for doc in query.stream():
                    d = doc.to_dict()
                    p1_id = d.get("user_id_p1") or d.get("participants", {}).get("player1", {}).get("uid")
                    p2_id = d.get("user_id_p2") or d.get("participants", {}).get("player2", {}).get("uid")
                    p1_name = d.get("p1_name") or d.get("state", {}).get("game", {}).get("p1Name")
                    p2_name = d.get("p2_name") or d.get("state", {}).get("game", {}).get("p2Name")
                    
                    match = False
                    if user_id and (p1_id == user_id or p2_id == user_id):
                        match = True
                    elif user_name and ((p1_name and user_name.lower() in p1_name.lower()) or (p2_name and user_name.lower() in p2_name.lower())):
                        match = True
                        
                    if match:
                        rooms.append(d)
                return rooms
            except Exception as e:
                logger.warning(f"Notice listing Firestore user rooms: {e}")

        for mid, d in self._fallback_rooms.items():
            if d.get("status") == "in_progress":
                rooms.append(d)
        return rooms

# Singleton instance
_firestore_engine_instance = None

def get_firestore_engine() -> FirestoreRoomEngine:
    global _firestore_engine_instance
    if _firestore_engine_instance is None:
        _firestore_engine_instance = FirestoreRoomEngine(project_id="eloranking-506820")
    return _firestore_engine_instance
