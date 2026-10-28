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

    def test_topdeck_bf_key_stable_across_days_and_rolling_mode_skips_backfill(self):
        from scripts import sync_topdeck

        with patch.object(sync_topdeck, "_scan_firestore", return_value=([], True, None)) as m_scan:
            p1 = sync_topdeck.discover_topdeck_targets(game_system="all", days=3650, max_events=10)
            p2 = sync_topdeck.discover_topdeck_targets(game_system="all", days=3650, start_date="2016-01-01", max_events=10)
            p_roll = sync_topdeck.discover_topdeck_targets(
                game_system="all", days=14, recent_days=14, max_events=10,
                state={"backfill": {"key": "all:from:2016-01-01", "done": True}},
            )
            self.assertEqual(p1["backfill_key"], "all:full_10y")
            self.assertEqual(p2["backfill_key"], "all:from:2016-01-01")
            self.assertIsNone(p_roll["backfill_key"])
            self.assertTrue(p_roll["backfill_exhausted"])

    def test_longshanks_zero_backfill_systems_disables_historical_scan(self):
        from scripts import sync_longshanks

        with patch.object(sync_longshanks, "_scan_history", return_value=([], True, 1)):
            plan = sync_longshanks.discover_longshanks_targets(
                game_system="mcp,sw_legion",
                days=21,
                recent_days=21,
                max_backfill_systems=0,
                max_events=20,
                state={},
            )
            self.assertEqual(plan["backfill_systems"], [])
            self.assertEqual(plan["backfill"], {})

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

        # 1. Zero unranked matches -> skip (bounded by since_date = max_rated_date - 30d)
        db_skip = make_mock_db(10, "2026-10-27T12:00:00Z", [])
        strat, meta = _choose_rebuild_strategy(db_skip, "pokemon", "auto")
        self.assertEqual(strat, "skip")
        self.assertEqual(meta["since_date"], "2026-09-27T00:00:00+00:00")
        db_skip.get_unranked_matches.assert_called_once_with(
            limit=25001, game_system="pokemon", since_date="2026-09-27T00:00:00+00:00"
        )

        # 2. Recent unranked matches -> incremental with matching since_date
        db_inc = make_mock_db(10, "2026-10-27T12:00:00Z", [{"id": "m1", "match_date": "2026-10-26T10:00:00Z"}])
        strat2, meta2 = _choose_rebuild_strategy(db_inc, "pokemon", "auto")
        self.assertEqual(strat2, "incremental")
        self.assertEqual(meta2["since_date"], "2026-09-27T00:00:00+00:00")

        # 3. Pending historical backfill flagged by sync job -> full
        db_full = make_mock_db(10, "2026-10-27T12:00:00Z", [])
        strat3, meta3 = _choose_rebuild_strategy(db_full, "mtg", "auto", pending_full={"mtg"})
        self.assertEqual(strat3, "full")
        self.assertEqual(meta3["reason"], "pending_historical_backfill")

        # 4. Empty ratings with existing matches -> full
        db_empty = make_mock_db(0, None, [])
        strat4, meta4 = _choose_rebuild_strategy(db_empty, "new_tcg", "auto")
        self.assertEqual(strat4, "full")
        self.assertEqual(meta4["reason"], "sparse_or_empty_ratings")


if __name__ == "__main__":
    unittest.main()
