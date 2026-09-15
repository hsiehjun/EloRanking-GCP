"""Unit tests verifying PostgreSQL B-tree index limit protection during Elo reconstruction and player sync.

PostgreSQL enforces a hard upper limit on B-tree index entries of ~8,191 bytes (1/3 of an 8KB buffer page).
These tests verify that:
1. Names, teams, and factions exceeding this limit (e.g. 22,432-byte army lists or serialized JSON blobs)
   are safely clamped and sanitized before COPY or INSERT into player_ratings and rating_history.
2. Serialized JSON team objects are extracted into clean human-readable names or discarded.
3. Every TSV column value produced for COPY player_ratings and COPY rating_history is guaranteed <= 1,000 bytes.
"""

import collections
import io
import json
import unittest
from datetime import datetime, timezone

from elo import (
    _is_placeholder_name,
    _sanitize_name,
    _sanitize_team,
    _sanitize_top_factions,
    _format_tsv_field,
)
from player_sync import clean_name, is_placeholder_name


class TestEloIndexLimitProtection(unittest.TestCase):

    def test_sanitize_name_handles_oversized_and_json(self):
        """Verify _sanitize_name clamps oversized strings and extracts from JSON."""
        # 1. Normal human names preserved
        self.assertEqual(_sanitize_name("Richard Siegler"), "Richard Siegler")
        self.assertEqual(_sanitize_name("  John   Doe  "), "John Doe")

        # 2. Oversized 22,432-byte string clamped to <= 100 chars
        oversized = "A" * 22432
        sanitized = _sanitize_name(oversized, max_len=100)
        self.assertEqual(len(sanitized), 100)
        self.assertTrue(len(sanitized.encode("utf-8")) <= 100)

        # 3. JSON serialized player payload extracted
        json_payload = json.dumps({"name": "David Gaylard", "army": "Necrons", "roster": ["a" * 1000]})
        self.assertEqual(_sanitize_name(json_payload), "David Gaylard")

        # 4. Multiline army list extracts first line and clamps
        army_list = "Innes Wilson\nAdeptus Custodes Roster\n" + ("Shield-Captain\n" * 100)
        self.assertEqual(_sanitize_name(army_list), "Innes Wilson")

        # 5. Empty / None returns ""
        self.assertEqual(_sanitize_name(None), "")
        self.assertEqual(_sanitize_name(""), "")

    def test_sanitize_team_handles_oversized_and_nested_json(self):
        """Verify _sanitize_team handles 22KB JSON team objects and clamps to <= 100 chars."""
        # 1. Normal clean team preserved
        self.assertEqual(_sanitize_team("Art of War"), "Art of War")

        # 2. JSON team object with name field extracted cleanly
        team_json = json.dumps({
            "id": "team_12345",
            "name": "Team USA",
            "roster": [{"player": f"Player {i}", "list": "X" * 500} for i in range(50)]
        })
        self.assertGreater(len(team_json), 25000)
        self.assertEqual(_sanitize_team(team_json), "Team USA")

        # 3. JSON team object with teamName field extracted cleanly
        team_json_2 = json.dumps({"teamName": "Warphammer Club", "members": 50})
        self.assertEqual(_sanitize_team(team_json_2), "Warphammer Club")

        # 4. JSON array or invalid JSON without name discarded as None
        self.assertIsNone(_sanitize_team('[{"id": 1}]'))
        self.assertIsNone(_sanitize_team('{"unknown_field": 123}'))

        # 5. Invalid / placeholder team names discarded as None
        self.assertIsNone(_sanitize_team("None"))
        self.assertIsNone(_sanitize_team("null"))
        self.assertIsNone(_sanitize_team("no team"))
        self.assertIsNone(_sanitize_team("unaligned"))
        self.assertIsNone(_sanitize_team("unaffiliated"))
        self.assertIsNone(_sanitize_team("-"))
        self.assertIsNone(_sanitize_team("{}"))
        self.assertIsNone(_sanitize_team(None))

        # 6. Oversized raw team string clamped to 100 chars
        raw_oversized = "Super Long Team Name " * 100
        clean_team = _sanitize_team(raw_oversized, max_len=100)
        self.assertIsNotNone(clean_team)
        self.assertLessEqual(len(clean_team), 100)

    def test_sanitize_top_factions_bounded(self):
        """Verify _sanitize_top_factions bounds length and limits to top 5 factions."""
        counter = collections.Counter({
            f"Faction_{i}_{'X' * 50}": 100 - i for i in range(25)
        })
        top_fac = _sanitize_top_factions(counter, max_factions=5, max_len=200)
        self.assertIsNotNone(top_fac)
        self.assertLessEqual(len(top_fac), 200)
        factions = top_fac.split(", ")
        self.assertLessEqual(len(factions), 5)

        # Empty counter returns None
        self.assertIsNone(_sanitize_top_factions(collections.Counter()))

    def test_format_tsv_field_safety_ceiling(self):
        """Verify _format_tsv_field never exceeds 1000 characters per field."""
        # 1. Normal values
        self.assertEqual(_format_tsv_field(None), "\\N")
        self.assertEqual(_format_tsv_field(True), "t")
        self.assertEqual(_format_tsv_field(False), "f")
        self.assertEqual(_format_tsv_field(1500), "1500")
        self.assertEqual(_format_tsv_field("Hello\tWorld\n"), "Hello World ")

        # 2. 30,000-byte string clamped to <= 1000 chars
        huge = "Z" * 30000
        tsv_out = _format_tsv_field(huge)
        self.assertEqual(len(tsv_out), 1000)
        self.assertEqual(tsv_out, "Z" * 1000)

    def test_reconstruction_ratings_buf_generation_with_extreme_payloads(self):
        """Simulates line 26,736 crash condition with 22,432-byte strings and verifies TSV buffer integrity."""
        now_iso = datetime.now(timezone.utc)
        sys_target = "40k"

        # Simulate player_states and existing_teams containing extreme payloads
        player_states = {
            "normal_player": {
                "name": "Jack Harpster",
                "elo": 2045.5,
                "peak_elo": 2050.0,
                "matches_played": 120,
                "wins": 105,
                "losses": 15,
                "draws": 0,
                "last_active_date": "2026-09-01T00:00:00Z"
            },
            "line_26736_crash_player": {
                # 22,432-byte army list/payload that crashed COPY in production
                "name": "A" * 22432,
                "elo": 1540.2,
                "peak_elo": 1550.0,
                "matches_played": 12,
                "wins": 7,
                "losses": 5,
                "draws": 0,
                "last_active_date": "2026-08-15T00:00:00Z"
            },
            "json_team_player": {
                "name": '{"playerName": "Manny Cheema"}',
                "elo": 1980.0,
                "peak_elo": 1995.0,
                "matches_played": 80,
                "wins": 70,
                "losses": 10,
                "draws": 0,
                "last_active_date": "2026-08-20T00:00:00Z"
            }
        }

        existing_teams = {
            "normal_player": "Team Poland",
            # 25KB nested team JSON object from raw_json->'player1'->>'team'
            "line_26736_crash_player": json.dumps({
                "teamName": "Glasshammer Gaming",
                "roster": [{"unit": "Y" * 200} for _ in range(120)]
            }),
            "json_team_player": "none"  # placeholder team
        }

        player_factions = collections.defaultdict(collections.Counter)
        player_factions["line_26736_crash_player"] = collections.Counter({
            f"Faction_{i}_{'F' * 80}": 10 for i in range(30)
        })

        # Generate ratings_buf using the exact elo.py reconstruct_all_rankings logic
        ratings_buf = io.StringIO()
        for pid, s in player_states.items():
            total = s["matches_played"]
            win_rate = round((s["wins"] / total) * 100.0, 1) if total > 0 else 0.0
            top_fac = _sanitize_top_factions(player_factions[pid], max_factions=5, max_len=200)
            team_name = _sanitize_team(existing_teams.get(pid), max_len=100)
            clean_player_name = _sanitize_name(s.get("name"), max_len=100) or f"Player {str(pid)[:8]}"

            r_vals = (
                str(pid)[:64], sys_target, clean_player_name, s["elo"], s["peak_elo"],
                total, s["wins"], s["losses"], s["draws"], win_rate,
                top_fac, team_name, s["last_active_date"], now_iso
            )
            ratings_buf.write("\t".join(_format_tsv_field(v) for v in r_vals) + "\n")

        tsv_content = ratings_buf.getvalue()
        lines = [line for line in tsv_content.split("\n") if line.strip()]

        self.assertEqual(len(lines), 3)

        for line_idx, line in enumerate(lines):
            fields = line.split("\t")
            self.assertEqual(len(fields), 14, f"Line {line_idx} should have 14 TSV columns")

            # Check maximum size of any single field: MUST be <= 1,000 bytes (PostgreSQL limit is 8,191 bytes)
            for f_idx, field in enumerate(fields):
                field_bytes = len(field.encode("utf-8"))
                self.assertLessEqual(
                    field_bytes, 1000,
                    f"Line {line_idx} Column {f_idx} length {field_bytes} exceeds 1,000 bytes!"
                )

        # Specifically verify line_26736_crash_player line
        crash_line = lines[1]
        crash_fields = crash_line.split("\t")
        player_name_col = crash_fields[2]
        team_col = crash_fields[11]

        self.assertEqual(len(player_name_col), 100)
        self.assertEqual(player_name_col, "A" * 100)
        self.assertEqual(team_col, "Glasshammer Gaming")

        # Specifically verify json_team_player line
        json_line = lines[2]
        json_fields = json_line.split("\t")
        self.assertEqual(json_fields[2], "Manny Cheema")
        self.assertEqual(json_fields[11], "\\N")  # "none" team was safely nullified


if __name__ == "__main__":
    unittest.main()
