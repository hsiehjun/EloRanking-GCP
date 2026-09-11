"""
Test suite verifying:
1. Tournament match ID normalization preserves mixed-case base62 event IDs (e.g., txp2twjjZRGk).
2. Firestore tournament document integrity (no multi-casing fan-out writes creating duplicate documents).
3. BcpAdapter.fetch_event_details implementation.
4. EventStudio canonical event ID resolution against PostgreSQL events table and Firestore.
5. Score submission from both Game Tracker and EventStudio properly integrates with BCP API.
6. Frontend contracts in tracker_sync.js and eventstudio.js (single finalize function invoking BCP submission, no duplicate writes).
"""
import sys
import asyncio
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from core import normalize_tracker_match_id
from bcp_adapter import BcpAdapter
from firestore_db import FirestoreRoomEngine
from routers.eventstudio import (
    _resolve_canonical_event_id,
    api_eventstudio_submit_score,
    SubmitScorePayload,
)


class TestBcpScoreSubmissionAndCanonicalEvent(unittest.TestCase):

    def test_normalize_tracker_match_id_preserves_bcp_event_casing(self):
        """Verify normalize_tracker_match_id preserves exact case for base62 BCP event IDs."""
        mixed_event_id = "txp2twjjZRGk"
        self.assertEqual(normalize_tracker_match_id(f"BCP-{mixed_event_id}-R1-T1"), f"BCP-{mixed_event_id}-R1-T1")
        self.assertEqual(normalize_tracker_match_id(f"WH40K-BCP-{mixed_event_id}-R2-T5"), f"WH40K-BCP-{mixed_event_id}-R2-T5")
        self.assertEqual(normalize_tracker_match_id(f"AOS-BCP-{mixed_event_id}-R3-T10"), f"AOS-BCP-{mixed_event_id}-R3-T10")
        self.assertEqual(normalize_tracker_match_id(f"ES-{mixed_event_id}-R1-T2"), f"ES-{mixed_event_id}-R1-T2")

        # Casual match IDs should still be uppercased and trimmed
        self.assertEqual(normalize_tracker_match_id("casual-room-123"), "CASUAL-ROOM-123")
        self.assertEqual(normalize_tracker_match_id("room_xyz_456"), "ROOM_XYZ_456")

    def test_firestore_save_judge_call_single_document_no_fanout(self):
        """Verify save_judge_call writes ONLY to a single canonical tournament document, preventing duplicates."""
        fs = FirestoreRoomEngine()
        mock_db = MagicMock()
        fs._client = mock_db

        mock_tourn_doc = MagicMock()
        mock_tourn_doc.get.return_value.exists = True
        mock_tourn_doc.get.return_value.to_dict.return_value = {"judge_calls": []}

        mock_call_doc = MagicMock()
        mock_tourn_doc.collection.return_value.document.return_value = mock_call_doc
        mock_db.collection.return_value.document.return_value = mock_tourn_doc

        event_id = "txp2twjjZRGk"
        call_data = {
            "id": "JC-12345",
            "event_id": event_id,
            "table_num": 1,
            "player_name": "Test Player",
            "category": "Rules",
            "status": "pending"
        }

        result = fs.save_judge_call(event_id, call_data)
        self.assertIsNotNone(result)
        self.assertEqual(result["id"], "JC-12345")

        # mock_db.collection('tournaments').document() should be called with ONLY event_id (not .upper() or .lower())
        tournaments_collection_calls = [
            c for c in mock_db.collection.call_args_list if c[0] == ("tournaments",)
        ]
        self.assertGreaterEqual(len(tournaments_collection_calls), 1)

        # Check all document() calls under 'tournaments'
        doc_args = [
            call[0][0] for call in mock_db.collection.return_value.document.call_args_list
        ]
        for doc_id in doc_args:
            self.assertEqual(doc_id, event_id, f"Expected document ID '{event_id}', got '{doc_id}'")

    def test_bcp_adapter_fetch_event_details(self):
        """Verify BcpAdapter has fetch_event_details method and delegates to execute_call."""
        self.assertTrue(hasattr(BcpAdapter, "fetch_event_details"), "BcpAdapter must have fetch_event_details")

        with patch.object(BcpAdapter, "execute_call") as mock_exec:
            mock_exec.return_value = ({"id": "txp2twjjZRGk", "name": "adlskjf"}, None)

            details, err = BcpAdapter.fetch_event_details("txp2twjjZRGk", explicit_token="jwt_token_123")
            self.assertIsNotNone(details)
            self.assertIsNone(err)
            self.assertEqual(details["id"], "txp2twjjZRGk")
            self.assertEqual(details["name"], "adlskjf")

            mock_exec.assert_called_once()
            endpoint, = mock_exec.call_args[0]
            self.assertTrue(endpoint.endswith("/v1/events/txp2twjjZRGk"))

    def test_resolve_canonical_event_id(self):
        """Verify _resolve_canonical_event_id queries the events table and falls back gracefully."""
        mock_db = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_db.get_connection.return_value.__enter__.return_value = mock_conn

        # When database finds canonical casing in events table
        with patch("routers.eventstudio.get_database", return_value=mock_db):
            mock_cur.fetchone.return_value = ("txp2twjjZRGk",)
            resolved = _resolve_canonical_event_id("TXP2TWJJZRGK")
            self.assertEqual(resolved, "txp2twjjZRGk")

            # Verify SQL query targeted events table
            mock_cur.execute.assert_called()
            sql = mock_cur.execute.call_args_list[0][0][0]
            self.assertIn("FROM events", sql)

            # When database doesn't find a match and firestore doesn't either, return original
            mock_cur.fetchone.return_value = None
            resolved2 = _resolve_canonical_event_id("nonexistent_evt")
            self.assertEqual(resolved2, "nonexistent_evt")

    def test_api_eventstudio_submit_score_resolves_to_token_and_submits(self):
        """Verify api_eventstudio_submit_score canonicalizes event_id and submits score to BCP."""
        mock_db = MagicMock()
        mock_auth = MagicMock()
        mock_auth.get_session.return_value = {"id": "to_user_123"}
        mock_auth.get_valid_bcp_tokens.return_value = {"id_token": "to_jwt_secret"}

        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur
        mock_db.get_connection.return_value.__enter__.return_value = mock_conn
        mock_cur.fetchone.return_value = ("txp2twjjZRGk",)

        payload = SubmitScorePayload(
            event_id="TXP2TWJJZRGK",
            table=1,
            round_num=1,
            p1_score=80,
            p2_score=65,
            p1_name="John4 Hsieh4",
            p2_name="John3 Hsieh3",
            pairing_id="pair-abc-123",
            game_details={
                "p1_id": "p1_111",
                "p2_id": "p2_222",
                "p1_game_id": "gid_1",
                "p2_game_id": "gid_2"
            }
        )

        mock_req = MagicMock()
        mock_req.headers = {}
        mock_req.cookies = {"session_token": "valid_session"}

        with patch("routers.eventstudio.get_database", return_value=mock_db),              patch("routers.eventstudio.get_auth_manager", return_value=mock_auth),              patch("routers.eventstudio.bcp_adapter.fetch_event_details", return_value=({"ownerId": "to_user_123"}, None)),              patch("routers.eventstudio.bcp_adapter.submit_pairing_scores", return_value=(True, None)) as mock_submit:

            res = asyncio.run(api_eventstudio_submit_score(payload, mock_req))

            self.assertTrue(res["success"])
            self.assertTrue(res["bcp_synced"])
            self.assertEqual(res["event_id"], "txp2twjjZRGk")

            mock_submit.assert_called_once()
            _, kwargs = mock_submit.call_args
            self.assertEqual(kwargs["explicit_token"], "to_jwt_secret")
            self.assertEqual(kwargs["p1_score"], 80)
            self.assertEqual(kwargs["p2_score"], 65)

    def test_frontend_tracker_sync_js_finalize_and_score_contracts(self):
        """Verify tracker_sync.js has single finalize function, invokes __submitMatchToBcp, and avoids fanout."""
        js_path = root_dir / "web" / "tracker" / "tracker_sync.js"
        self.assertTrue(js_path.exists())
        content = js_path.read_text(encoding="utf-8")

        # 1. Exactly ONE definition of window.__finalizeAndLockMatch
        self.assertEqual(content.count("window.__finalizeAndLockMatch = async function"), 1)

        # 2. window.__finalizeAndLockMatch MUST invoke __submitMatchToBcp
        self.assertIn("await window.__submitMatchToBcp()", content)

        # 3. getActiveMatchId must preserve tournament matchId casing
        self.assertIn("const isTourn = (trimmed.startsWith('BCP-') || trimmed.startsWith('ES-')", content)

        # 4. No fan-out writes to targetTournamentIds with toUpperCase
        self.assertNotIn("targetTournamentIds.push(tournamentId.toUpperCase())", content)

        # 5. Correct document write to db.collection('tournaments').doc(tournamentId)
        self.assertIn("db.collection('tournaments').doc(tournamentId)", content)

    def test_frontend_eventstudio_js_score_submission_contracts(self):
        """Verify eventstudio.js saveTableScore uses loose table comparison and passes enriched metadata."""
        es_path = root_dir / "web" / "js" / "eventstudio.js"
        self.assertTrue(es_path.exists())
        content = es_path.read_text(encoding="utf-8")

        # 1. Loose equality for table lookup
        self.assertIn("m.tableNumber !== undefined ? m.tableNumber : m.table_number", content)
        self.assertIn("t == tableNum || Number(t) === Number(tableNum)", content)

        # 2. Enriched player and game detail payload
        self.assertIn("p1_id: p1Id", content)
        self.assertIn("p2_id: p2Id", content)
        self.assertIn("p1_game_id: p1Gid", content)
        self.assertIn("p2_game_id: p2Gid", content)


if __name__ == "__main__":
    unittest.main()
