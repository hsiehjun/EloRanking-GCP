import unittest
from unittest.mock import MagicMock, patch
import urllib.error
import io


class TestBackfillAndRebuildFixes(unittest.TestCase):
    def test_topdeck_cursor_advances_when_all_scanned_pages_already_known(self):
        from scripts import sync_topdeck

        def fake_page(lo, hi, cursor, limit):
            # Simulate 2 full pages of already-known tournaments, then 1 final partial page
            if cursor is None:
                return [
                    {
                        "name": f"projects/p/databases/(default)/documents/tournaments/t_{i}",
                        "fields": {
                            "Name": {"stringValue": f"Event {i}"},
                            "Game": {"stringValue": "Magic: The Gathering"},
                            "StartDate": {"integerValue": str(1760000000 - i)},
                            "S1:R1:T1": {
                                "mapValue": {
                                    "fields": {
                                        "Es": {"arrayValue": {"values": [{"integerValue": "1"}, {"integerValue": "2"}]}},
                                        "W": {"integerValue": "1"},
                                    }
                                }
                            },
                        },
                    }
                    for i in range(sync_topdeck.FIRESTORE_PAGE_SIZE)
                ]
            return []

        known_ids = {f"t_{i}" for i in range(sync_topdeck.FIRESTORE_PAGE_SIZE)}
        with patch.object(sync_topdeck, "_firestore_page", side_effect=fake_page):
            cands, exhausted, next_cur = sync_topdeck._scan_firestore(
                lo=1500000000,
                hi=1770000000,
                start_after=None,
                want=50,
                known=known_ids,
                target_sys="all",
                max_pages=1,  # Stop after 1 full page of already-known docs!
                stats={},
            )
            self.assertEqual(cands, [])
            self.assertFalse(exhausted)
            self.assertIsNotNone(next_cur)
            self.assertEqual(next_cur[0], 1760000000 - (sync_topdeck.FIRESTORE_PAGE_SIZE - 1))
            self.assertTrue(next_cur[1].endswith(f"t_{sync_topdeck.FIRESTORE_PAGE_SIZE - 1}"))

    def test_topdeck_bf_key_stable_across_days(self):
        from scripts import sync_topdeck

        with patch.object(sync_topdeck, "_scan_firestore", return_value=([], True, None)):
            p1 = sync_topdeck.discover_topdeck_targets(game_system="all", days=3650, max_events=10)
            p2 = sync_topdeck.discover_topdeck_targets(game_system="all", days=3650, start_date="2016-01-01", max_events=10)
            self.assertEqual(p1["backfill_key"], "all:full_10y")
            self.assertEqual(p2["backfill_key"], "all:from:2016-01-01")

    def test_http_get_text_retries_on_429(self):
        from scripts import sync_multiplatform

        calls = [0]

        class FakeResp:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return b'{"ok": true}'

        def fake_urlopen(req, timeout=15):
            calls[0] += 1
            if calls[0] < 3:
                raise urllib.error.HTTPError(req.full_url, 429, "Too Many Requests", {"Retry-After": "0.01"}, io.BytesIO(b""))
            return FakeResp()

        with patch("urllib.request.urlopen", side_effect=fake_urlopen), patch("time.sleep"):
            txt = sync_multiplatform._http_get_text("https://play.limitlesstcg.com/api/tournaments/abc/details", max_attempts=4)
            self.assertEqual(txt, '{"ok": true}')
            self.assertEqual(calls[0], 3)

    def test_rebuild_strategy_auto_selection(self):
        from scripts.rebuild_ratings import _choose_rebuild_strategy

        def make_mock_db(pr_cnt, max_dt_str, unranked_list):
            db = MagicMock()
            conn = MagicMock()
            cur = MagicMock()
            db.get_connection.return_value.__enter__.return_value = conn
            conn.cursor.return_value.__enter__.return_value = cur
            cur.fetchone.side_effect = [(pr_cnt,), (max_dt_str,), (5,)]
            db.get_unranked_matches.return_value = unranked_list
            return db

        # 1. Zero unranked matches -> skip
        db_skip = make_mock_db(10, "2026-10-27T12:00:00Z", [])
        strat, meta = _choose_rebuild_strategy(db_skip, "pokemon", "auto")
        self.assertEqual(strat, "skip")

        # 2. Recent unranked matches within 14d -> incremental
        db_inc = make_mock_db(10, "2026-10-27T12:00:00Z", [{"id": "m1", "match_date": "2026-10-26T10:00:00Z"}])
        strat2, meta2 = _choose_rebuild_strategy(db_inc, "pokemon", "auto")
        self.assertEqual(strat2, "incremental")

        # 3. Historical out-of-order backfill (>14d older than max_rated_date) -> full
        db_full = make_mock_db(10, "2026-10-27T12:00:00Z", [{"id": "m_old", "match_date": "2024-05-10T10:00:00Z"}])
        strat3, meta3 = _choose_rebuild_strategy(db_full, "mtg", "auto")
        self.assertEqual(strat3, "full")
        self.assertEqual(meta3["reason"], "historical_out_of_order_backfill")


if __name__ == "__main__":
    unittest.main()
