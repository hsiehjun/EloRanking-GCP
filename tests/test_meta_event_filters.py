import asyncio
from contextlib import contextmanager
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from config import is_placeholder_faction
from database import PostgresDatabase
from meta_event_classifier import (
    MetaFilterSpec,
    classify_event_structure_and_format,
    classify_is_online,
    normalize_country_and_region,
    parse_meta_filters,
)
import routers.leaderboard as lb_router
from scripts.local_sqlite_db import LocalSqliteDatabase


class TestEventClassifierAccuracy(unittest.TestCase):
    """Verifies platform-aware event classification across BCP, Melee, Limitless, Longshanks, and TopDeck."""

    def test_online_vs_in_person_classification(self):
        # 1. BCP `showOnline: True` is a UI visibility flag, NOT an online venue
        self.assertFalse(
            classify_is_online(
                name="Lone Star Open 40K GT",
                venue_name="Irving Convention Center",
                city="Irving",
                country="United States",
                latitude=32.8780,
                longitude=-96.9431,
                raw_json={"showOnline": True, "isOnlineEvent": False},
            )
        )
        # 2. Explicit native online boolean
        self.assertTrue(
            classify_is_online(
                name="Monthly Swiss",
                raw_json={"isOnlineEvent": True},
            )
        )
        # 3. Digital simulator / webcam platforms
        for title, venue in [
            ("Tactical Tortoise TTS Major", ""),
            ("Weekly MTGO Modern Challenge", "MTGO"),
            ("Late Night SpellTable cEDH", "Discord"),
            ("PTCG Live Cup #42", ""),
        ]:
            self.assertTrue(
                classify_is_online(name=title, venue_name=venue),
                f"Expected online=True for ({title!r}, {venue!r})",
            )
        # 4. Null Island (0.0, 0.0) with 'Online' in title is online
        self.assertTrue(
            classify_is_online(
                name="Global Online Cup",
                latitude=0.0,
                longitude=0.0,
            )
        )
        # 5. Real physical street address overrides casual mention of 'Online Registration'
        self.assertFalse(
            classify_is_online(
                name="Summer RTT (Online Registration Only)",
                venue_name="Dragon's Lair",
                address="2438 W Anderson Ln, Austin, TX",
                city="Austin",
                country="US",
                latitude=30.3568,
                longitude=-97.7346,
            )
        )

    def test_structure_and_league_classification(self):
        # Club name starting with 'Team' must remain `singles` when 1v1
        s_tag, f_tag, is_lg = classify_event_structure_and_format(
            event_id="bcp_ev_1",
            name="Team Stonehammer Summer RTT",
            event_date="2026-10-10",
            end_date="2026-10-10",
            game_system="40k",
            raw_json={"teamEvent": False, "pointsValue": 2000},
            match_span_days=0,
        )
        self.assertEqual(s_tag, "singles")
        self.assertEqual(f_tag, "standard_2000")
        self.assertFalse(is_lg)

        # 3-day Major weekend (Fri-Sun, span_days=2) is NOT a league
        s_tag, f_tag, is_lg = classify_event_structure_and_format(
            event_id="bcp_ev_major",
            name="Las Vegas Open 40K Champs",
            event_date="2026-10-02",
            end_date="2026-10-04",
            game_system="40k",
            match_span_days=2,
        )
        self.assertEqual(s_tag, "singles")
        self.assertFalse(is_lg)

        # Multi-week store league (span_days=42) IS flagged as a league
        s_tag, _f_tag, is_lg = classify_event_structure_and_format(
            event_id="bcp_ev_lg",
            name="Autumn Store Escalation",
            event_date="2026-09-01",
            end_date="2026-10-13",
            game_system="40k",
            match_span_days=42,
        )
        self.assertEqual(s_tag, "singles")
        self.assertTrue(is_lg)

        # WTC 5v5 / 8v8 Team tournament -> `teams`
        s_tag, _f_tag, _is_lg = classify_event_structure_and_format(
            event_id="bcp_ev_wtc",
            name="ATC 5v5 Team Championship",
            game_system="40k",
            team_size=5,
        )
        self.assertEqual(s_tag, "teams")

        # 2v2 Doubles -> `doubles`
        s_tag, _f_tag, _is_lg = classify_event_structure_and_format(
            event_id="bcp_ev_dbl",
            name="Warhammer 40K 2v2 Doubles Bash",
            game_system="40k",
        )
        self.assertEqual(s_tag, "doubles")

        # 4-Player Commander Pod -> `ffa_pod` + `commander`
        s_tag, f_tag, _is_lg = classify_event_structure_and_format(
            event_id="td:cedh_1",
            name="Silicon Dynasty cEDH",
            game_system="mtg",
            has_ffa_matches=True,
        )
        self.assertEqual(s_tag, "ffa_pod")
        self.assertEqual(f_tag, "commander")

        # 40K / AoS multi-seat game must NEVER get `commander` format tag
        s_w, f_w, _is_lg_w = classify_event_structure_and_format(
            event_id="bcp_ev_mp",
            name="40K Apocalypse Multi-Player Pod",
            game_system="40k",
            points=2000,
            has_ffa_matches=True,
        )
        self.assertEqual(s_w, "ffa_pod")
        self.assertEqual(f_w, "standard_2000")

    def test_multi_system_formats_and_location_normalization(self):
        # 40K 1000pt Incursion
        _s, f_1k, _l = classify_event_structure_and_format(
            name="1000pt Incursion Beginners RTT",
            game_system="40k",
            points=1000,
        )
        self.assertEqual(f_1k, "incursion_1000")

        # MTG formats
        for raw_f, expected in [
            ("Modern", "modern"),
            ("Legacy", "legacy"),
            ("Pioneer", "pioneer"),
            ("Pauper", "pauper"),
            ("Booster Draft", "limited"),
            ("Standard", "standard"),
        ]:
            _s, f_mtg, _l = classify_event_structure_and_format(
                name=f"RCQ {raw_f}",
                game_system="mtg",
                raw_json={"format_name": raw_f},
            )
            self.assertEqual(f_mtg, expected)

        # Pokemon GLC & FaB Blitz & SWU Premier
        self.assertEqual(
            classify_event_structure_and_format(game_system="pokemon", raw_json={"format": "GLC"})[1],
            "glc",
        )
        self.assertEqual(
            classify_event_structure_and_format(game_system="flesh_blood", raw_json={"format": "Blitz"})[1],
            "blitz",
        )
        self.assertEqual(
            classify_event_structure_and_format(game_system="sw_unlimited", raw_json={})[1],
            "premier",
        )

        # Location normalization: UK nations -> GB / UK_IE
        self.assertEqual(
            normalize_country_and_region(country="England", city="London"),
            ("GB", None, "UK_IE"),
        )
        # Longshanks compound city string -> US / WA / NA
        self.assertEqual(
            normalize_country_and_region(city="Washington, United States"),
            ("US", "WA", "NA"),
        )
        # Coordinate bounding box fallback -> AU / OCE
        self.assertEqual(
            normalize_country_and_region(latitude=-33.8688, longitude=151.2093),
            ("AU", None, "OCE"),
        )
        # Online event -> (None, None, "ONLINE")
        self.assertEqual(
            normalize_country_and_region(country="US", state="TX", is_online=True),
            (None, None, "ONLINE"),
        )

    def test_tcg_format_placeholder_hygiene(self):
        for bad_name in ("Custom", "Modern", "Standard", "Legacy", "Pioneer", "Draft", "Sealed", "Registered"):
            self.assertTrue(
                is_placeholder_faction(bad_name, "mtg"),
                f"Expected {bad_name!r} to be flagged as placeholder in config",
            )
            self.assertTrue(
                PostgresDatabase.is_super_or_empty_faction(bad_name),
                f"Expected {bad_name!r} to be flagged as super/empty in PostgresDatabase",
            )


class TestEndToEndFilterParityAndApi(unittest.TestCase):
    """Seeds a multi-system tournament DB and verifies 100% mathematical parity across every filter combination."""

    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls._tmpdir.name, "meta_filter_parity.sqlite")
        cls.db = LocalSqliteDatabase(db_path=cls.db_path)
        cls._seed_dataset()

    @classmethod
    def tearDownClass(cls):
        cls._tmpdir.cleanup()

    @classmethod
    def _seed_dataset(cls):
        conn = cls.db._connect()
        try:
            # Seed players
            players = [
                ("p_sm_vet", "Alex Marine", "40k", 1710.0),
                ("p_ork_vet", "Brok Warboss", "40k", 1680.0),
                ("p_ael_exp", "Cael Farseer", "40k", 1590.0),
                ("p_nec_cas", "Drek Overlord", "40k", 1480.0),
                ("p_tau_uk", "Evan Commander", "40k", 1520.0),
                ("p_tyr_uk", "Finn Hive", "40k", 1510.0),
                ("p_mtg_1", "Grace Mage", "mtg", 1660.0),
                ("p_mtg_2", "Hank Wizard", "mtg", 1655.0),
                ("p_mtg_3", "Iris Sorcerer", "mtg", 1520.0),
            ]
            for pid, pname, gs, elo in players:
                conn.execute(
                    "INSERT INTO players (id, name) VALUES (?, ?);",
                    (pid, pname),
                )
                conn.execute(
                    """
                    INSERT INTO player_ratings (player_id, player_name, game_system, current_elo, peak_elo, matches_played, wins, losses, draws)
                    VALUES (?, ?, ?, ?, ?, 10, 6, 4, 0);
                    """,
                    (pid, pname, gs, elo, elo + 20.0),
                )

            # Seed events across 40k & mtg covering every filter dimension
            events = [
                # 1. 64p 6-round US (TX) In-Person Singles 2000pt GT
                (
                    "ev_gt_us", "Lone Star 40K GT", "2026-10-10", "2026-10-11",
                    "Austin", "TX", "US", "Austin Convention Center",
                    30.2636, -97.7396, 64, 6, 1, "40k", "bcp",
                    json.dumps({"pointsValue": 2000, "teamEvent": False, "isOnlineEvent": False}),
                ),
                # 2. 12p 3-round UK In-Person Singles 1000pt Incursion RTT
                (
                    "ev_rtt_uk", "London 1000pt Incursion RTT", "2026-10-12", "2026-10-12",
                    "London", "England", "United Kingdom", "Bad Moon Cafe",
                    51.5007, -0.0937, 12, 3, 1, "40k", "bcp",
                    json.dumps({"pointsValue": 1000, "teamEvent": False, "isOnlineEvent": False}),
                ),
                # 3. 24p 5-round Online TTS Singles event
                (
                    "ev_tts_onl", "Tactical TTS Cup", "2026-10-14", "2026-10-15",
                    "Online", "", "Global", "Discord / TTS",
                    None, None, 24, 5, 1, "40k", "bcp",
                    json.dumps({"pointsValue": 2000, "isOnlineEvent": True}),
                ),
                # 4. 40p 5-round Continental Europe (DE) In-Person 5v5 Teams event
                (
                    "ev_teams_de", "Berlin 5v5 Team GT", "2026-10-17", "2026-10-18",
                    "Berlin", "", "DE", "Messe Berlin",
                    52.5015, 13.2736, 40, 5, 1, "40k", "bcp",
                    json.dumps({"pointsValue": 2000, "teamEvent": True, "team_size": 5}),
                ),
                # 5. 16p 8-round US (CA) Multi-Week Casual Store League (span=42 days -> is_league=True)
                (
                    "ev_league_ca", "SoCal 8-Week Escalation League", "2026-09-01", "2026-10-13",
                    "San Diego", "CA", "US", "At Ease Games",
                    32.8851, -117.1595, 16, 8, 1, "40k", "bcp",
                    json.dumps({"pointsValue": 2000, "leagueEvent": True}),
                ),
                # 6. MTG 32p 5-round Modern event (US/NY)
                (
                    "melee:mtg_mod", "NYC Modern RCQ", "2026-10-18", "2026-10-18",
                    "New York", "NY", "US", "Bifrost Games",
                    40.7484, -73.9857, 32, 5, 1, "mtg", "melee",
                    json.dumps({"format_name": "Modern", "platform_type": "In-Person"}),
                ),
                # 7. MTG 16p 4-round Pioneer event (JP/ASIA)
                (
                    "melee:mtg_pio", "Tokyo Pioneer Showdown", "2026-10-19", "2026-10-19",
                    "Tokyo", "", "JP", "Hareruya TC",
                    35.7128, 139.7618, 16, 4, 1, "mtg", "melee",
                    json.dumps({"format_name": "Pioneer", "platform_type": "In-Person"}),
                ),
            ]
            for ev in events:
                conn.execute(
                    """
                    INSERT INTO events (
                        id, name, event_date, end_date, city, state, country, venue_name,
                        latitude, longitude, players_count, num_rounds, is_ended,
                        game_system, source_platform, raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    ev,
                )

            # Helper to insert match + symmetric rating_history rows
            cls.raw_matches = []

            def _add_match(
                mid, eid, rnd, mdate, gs,
                p1_id, p1_name, p1_fac, p1_sc, p1_elo,
                p2_id, p2_name, p2_fac, p2_sc, p2_elo,
                winner_idx=1,
            ):
                is_draw = winner_idx == 0
                win_id = None if is_draw else (p1_id if winner_idx == 1 else p2_id)
                conn.execute(
                    """
                    INSERT INTO matches (
                        id, event_id, round, table_number,
                        player1_id, player1_name, player1_faction, player1_score,
                        player2_id, player2_name, player2_faction, player2_score,
                        winner_id, is_draw, is_bye, match_date, game_system, raw_json
                    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, '{}');
                    """,
                    (
                        mid, eid, rnd,
                        p1_id, p1_name, p1_fac, p1_sc,
                        p2_id, p2_name, p2_fac, p2_sc,
                        win_id, 1 if is_draw else 0, mdate, gs,
                    ),
                )
                r1 = "D" if is_draw else ("W" if winner_idx == 1 else "L")
                r2 = "D" if is_draw else ("W" if winner_idx == 2 else "L")
                for pid, _pname, pfac, psc, pelo, oid, oname, ofac, osc, oelo, res in [
                    (p1_id, p1_name, p1_fac, p1_sc, p1_elo, p2_id, p2_name, p2_fac, p2_sc, p2_elo, r1),
                    (p2_id, p2_name, p2_fac, p2_sc, p2_elo, p1_id, p1_name, p1_fac, p1_sc, p1_elo, r2),
                ]:
                    conn.execute(
                        """
                        INSERT INTO rating_history (
                            player_id, match_id, event_id, round,
                            player_faction, opponent_id, opponent_name, opponent_faction,
                            result, player_score, opponent_score,
                            old_elo, new_elo, delta_elo, opponent_elo,
                            match_date, game_system, raw_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10.0, ?, ?, ?, '{}');
                        """,
                        (
                            pid, mid, eid, rnd,
                            pfac, oid, oname, ofac,
                            res, psc, osc,
                            pelo, pelo + (10.0 if res == "W" else -10.0), oelo,
                            mdate, gs,
                        ),
                    )
                cls.raw_matches.append({
                    "mid": mid, "eid": eid, "rnd": rnd, "mdate": mdate, "gs": gs,
                    "p1_id": p1_id, "p1_fac": p1_fac, "p1_sc": p1_sc, "p1_elo": p1_elo,
                    "p2_id": p2_id, "p2_fac": p2_fac, "p2_sc": p2_sc, "p2_elo": p2_elo,
                    "r1": r1, "r2": r2,
                })

            # ev_gt_us: p_sm_vet goes 3-0 (2 games >=1650 Elo, 1 game >=1550 Elo), plus 1 casual game (<1550)
            _add_match("m_gt_1", "ev_gt_us", 1, "2026-10-10", "40k",
                       "p_sm_vet", "Alex Marine", "Space Marines", 90, 1690.0,
                       "p_ork_vet", "Brok Warboss", "Orks", 70, 1670.0, winner_idx=1)
            _add_match("m_gt_2", "ev_gt_us", 2, "2026-10-10", "40k",
                       "p_sm_vet", "Alex Marine", "Space Marines", 85, 1700.0,
                       "p_ork_vet", "Brok Warboss", "Orks", 65, 1660.0, winner_idx=1)
            _add_match("m_gt_3", "ev_gt_us", 3, "2026-10-11", "40k",
                       "p_sm_vet", "Alex Marine", "Space Marines", 88, 1710.0,
                       "p_ael_exp", "Cael Farseer", "Aeldari", 72, 1580.0, winner_idx=1)
            _add_match("m_gt_4", "ev_gt_us", 4, "2026-10-11", "40k",
                       "p_ael_exp", "Cael Farseer", "Aeldari", 92, 1570.0,
                       "p_nec_cas", "Drek Overlord", "Necrons", 55, 1480.0, winner_idx=1)

            # ev_rtt_uk: 12p 3r UK 1000pt Incursion
            _add_match("m_uk_1", "ev_rtt_uk", 1, "2026-10-12", "40k",
                       "p_tau_uk", "Evan Commander", "T'au Empire", 80, 1520.0,
                       "p_tyr_uk", "Finn Hive", "Tyranids", 60, 1510.0, winner_idx=1)
            _add_match("m_uk_2", "ev_rtt_uk", 2, "2026-10-12", "40k",
                       "p_tau_uk", "Evan Commander", "T'au Empire", 75, 1530.0,
                       "p_sm_vet", "Alex Marine", "Space Marines", 82, 1715.0, winner_idx=2)

            # ev_tts_onl: 24p 5r Online TTS
            _add_match("m_onl_1", "ev_tts_onl", 1, "2026-10-14", "40k",
                       "p_ork_vet", "Brok Warboss", "Orks", 95, 1665.0,
                       "p_ael_exp", "Cael Farseer", "Aeldari", 60, 1590.0, winner_idx=1)
            _add_match("m_onl_2", "ev_tts_onl", 2, "2026-10-15", "40k",
                       "p_sm_vet", "Alex Marine", "Space Marines", 70, 1720.0,
                       "p_ork_vet", "Brok Warboss", "Orks", 85, 1675.0, winner_idx=2)

            # ev_teams_de: 40p 5r DE Teams
            _add_match("m_tm_1", "ev_teams_de", 1, "2026-10-17", "40k",
                       "p_sm_vet", "Alex Marine", "Space Marines", 78, 1710.0,
                       "p_ork_vet", "Brok Warboss", "Orks", 78, 1680.0, winner_idx=0)
            _add_match("m_tm_2", "ev_teams_de", 2, "2026-10-18", "40k",
                       "p_ael_exp", "Cael Farseer", "Aeldari", 90, 1600.0,
                       "p_nec_cas", "Drek Overlord", "Necrons", 50, 1490.0, winner_idx=1)

            # ev_league_ca: 16p 8r US/CA League (span 42 days)
            _add_match("m_lg_1", "ev_league_ca", 1, "2026-09-01", "40k",
                       "p_nec_cas", "Drek Overlord", "Necrons", 84, 1475.0,
                       "p_sm_vet", "Alex Marine", "Space Marines", 62, 1680.0, winner_idx=1)
            _add_match("m_lg_2", "ev_league_ca", 8, "2026-10-13", "40k",
                       "p_nec_cas", "Drek Overlord", "Necrons", 91, 1485.0,
                       "p_tyr_uk", "Finn Hive", "Tyranids", 45, 1505.0, winner_idx=1)

            # MTG Modern (including a placeholder 'Custom' vs 'Modern' match that must be stripped!)
            _add_match("m_mtg_1", "melee:mtg_mod", 1, "2026-10-18", "mtg",
                       "p_mtg_1", "Grace Mage", "Boros Energy", 2, 1665.0,
                       "p_mtg_2", "Hank Wizard", "Dimir Murktide", 1, 1655.0, winner_idx=1)
            _add_match("m_mtg_bad", "melee:mtg_mod", 2, "2026-10-18", "mtg",
                       "p_mtg_3", "Iris Sorcerer", "Custom", 2, 1520.0,
                       "p_mtg_2", "Hank Wizard", "Modern", 0, 1650.0, winner_idx=1)

            # MTG Pioneer
            _add_match("m_mtg_2", "melee:mtg_pio", 1, "2026-10-19", "mtg",
                       "p_mtg_1", "Grace Mage", "Rakdos Midrange", 2, 1670.0,
                       "p_mtg_3", "Iris Sorcerer", "Izzet Phoenix", 0, 1515.0, winner_idx=1)

            conn.commit()
        finally:
            conn.close()

    def _ground_truth(self, game_system: str, **filter_kwargs):
        mf = parse_meta_filters(**filter_kwargs)
        ev_props = {
            "ev_gt_us": {"players": 64, "rounds": 6, "online": False, "league": False, "struct": "singles", "fmt": "standard_2000", "cc": "US", "sc": "TX", "rg": "NA"},
            "ev_rtt_uk": {"players": 12, "rounds": 3, "online": False, "league": False, "struct": "singles", "fmt": "incursion_1000", "cc": "GB", "sc": "England", "rg": "UK_IE"},
            "ev_tts_onl": {"players": 24, "rounds": 5, "online": True, "league": False, "struct": "singles", "fmt": "standard_2000", "cc": None, "sc": None, "rg": "ONLINE"},
            "ev_teams_de": {"players": 40, "rounds": 5, "online": False, "league": False, "struct": "teams", "fmt": "standard_2000", "cc": "DE", "sc": None, "rg": "EU"},
            "ev_league_ca": {"players": 16, "rounds": 8, "online": False, "league": True, "struct": "singles", "fmt": "standard_2000", "cc": "US", "sc": "CA", "rg": "NA"},
            "melee:mtg_mod": {"players": 32, "rounds": 5, "online": False, "league": False, "struct": "singles", "fmt": "modern", "cc": "US", "sc": "NY", "rg": "NA"},
            "melee:mtg_pio": {"players": 16, "rounds": 4, "online": False, "league": False, "struct": "singles", "fmt": "pioneer", "cc": "JP", "sc": None, "rg": "ASIA"},
        }
        fac_stats = {}
        matched_eids = set()
        valid_match_ids = set()

        for m in self.raw_matches:
            if m["gs"] != game_system:
                continue
            ep = ev_props[m["eid"]]
            if mf.min_players > 0 and ep["players"] < mf.min_players:
                continue
            if mf.min_rounds > 0 and ep["rounds"] < mf.min_rounds:
                continue
            if mf.exclude_leagues and ep["league"]:
                continue
            if mf.venue_mode == "in_person" and ep["online"]:
                continue
            if mf.venue_mode == "online" and not ep["online"]:
                continue
            if mf.event_structure != "all" and ep["struct"] != mf.event_structure:
                continue
            if mf.event_format != "all" and ep["fmt"] != mf.event_format:
                continue
            if mf.region != "all" and ep["rg"] != mf.region:
                continue
            if mf.country != "all" and ep["cc"] != mf.country:
                continue
            if mf.state != "all" and ep["sc"] != mf.state:
                continue
            if mf.elo_floor > 0 and (m["p1_elo"] < mf.elo_floor or m["p2_elo"] < mf.elo_floor):
                continue

            matched_eids.add(m["eid"])
            for fac, res in [(m["p1_fac"], m["r1"]), (m["p2_fac"], m["r2"])]:
                if is_placeholder_faction(fac, game_system):
                    continue
                valid_match_ids.add(m["mid"])
                st = fac_stats.setdefault(fac, {"matches": 0, "wins": 0, "losses": 0, "draws": 0})
                st["matches"] += 1
                if res == "W":
                    st["wins"] += 1
                elif res == "L":
                    st["losses"] += 1
                else:
                    st["draws"] += 1

        return len(valid_match_ids), len(matched_eids), fac_stats

    def test_all_filter_combinations_and_modal_consistency(self):
        filter_scenarios = [
            ("default_all_events", "40k", {}),
            ("min_players_28", "40k", {"min_players": 28}),
            ("min_players_64", "40k", {"min_players": 64}),
            ("min_rounds_5_with_leagues", "40k", {"min_rounds": 5, "exclude_leagues": False}),
            ("min_rounds_5_excl_leagues", "40k", {"min_rounds": 5, "exclude_leagues": True}),
            ("venue_in_person", "40k", {"venue_mode": "in_person"}),
            ("venue_online", "40k", {"venue_mode": "online"}),
            ("structure_singles", "40k", {"event_structure": "singles"}),
            ("structure_teams", "40k", {"event_structure": "teams"}),
            ("format_incursion_1000", "40k", {"event_format": "incursion_1000"}),
            ("format_standard_2000", "40k", {"event_format": "standard_2000"}),
            ("region_uk_ie", "40k", {"region": "UK_IE"}),
            ("region_eu", "40k", {"region": "EU"}),
            ("country_us_all_states", "40k", {"country": "US"}),
            ("country_us_state_tx", "40k", {"country": "US", "state": "TX"}),
            ("country_us_state_ca", "40k", {"country": "US", "state": "CA"}),
            ("elo_floor_1550", "40k", {"elo_floor": 1550}),
            ("elo_floor_1650", "40k", {"elo_floor": 1650}),
            (
                "compound_gt_us_tx_1550",
                "40k",
                {
                    "min_players": 28,
                    "min_rounds": 5,
                    "exclude_leagues": True,
                    "venue_mode": "in_person",
                    "event_structure": "singles",
                    "country": "US",
                    "state": "TX",
                    "elo_floor": 1550,
                },
            ),
            ("zero_match_narrow_filter", "40k", {"country": "JP"}),
            ("mtg_all_hygiene", "mtg", {}),
            ("mtg_modern_only", "mtg", {"event_format": "modern"}),
            ("mtg_pioneer_only", "mtg", {"event_format": "pioneer"}),
        ]

        with patch.object(lb_router, "get_database", return_value=self.db):
            for label, gs, f_kwargs in filter_scenarios:
                with self.subTest(scenario=label):
                    exp_matches, exp_events, exp_facs = self._ground_truth(gs, **f_kwargs)
                    api_res = asyncio.run(
                        lb_router.api_faction_meta(
                            timeframe="all",
                            game_system=gs,
                            include_trends=False,
                            **f_kwargs,
                        )
                    )
                    kpis = api_res["summary_kpis"]
                    self.assertEqual(kpis["total_matches"], exp_matches, f"[{label}] total_matches mismatch")
                    if f_kwargs:
                        self.assertEqual(kpis["matched_events"], exp_events, f"[{label}] matched_events mismatch")

                    act_facs = {f["faction"]: f for f in api_res["factions"]}
                    self.assertEqual(set(act_facs.keys()), set(exp_facs.keys()), f"[{label}] faction set mismatch")

                    # Verify placeholder archetypes never leak into MTG rankings
                    if gs == "mtg":
                        self.assertNotIn("Custom", act_facs)
                        self.assertNotIn("Modern", act_facs)

                    for fac_name, exp_st in exp_facs.items():
                        act_row = act_facs[fac_name]
                        self.assertEqual(act_row["total_matches"], exp_st["matches"])
                        self.assertEqual(act_row["wins"], exp_st["wins"])
                        self.assertEqual(act_row["losses"], exp_st["losses"])
                        self.assertEqual(act_row["draws"], exp_st["draws"])
                        exp_wr = round(exp_st["wins"] * 100.0 / exp_st["matches"], 1)
                        self.assertEqual(act_row["win_rate"], exp_wr)

                        # Verify Single-Faction Modal (`/api/faction/{name}`) matches Meta Intel 100%
                        modal_res = asyncio.run(
                            lb_router.api_faction_details(
                                faction_name=fac_name,
                                timeframe="all",
                                game_system=gs,
                                **f_kwargs,
                            )
                        )
                        self.assertEqual(modal_res["stats"]["total_matches"], exp_st["matches"])
                        self.assertEqual(modal_res["stats"]["total_wins"], exp_st["wins"])
                        self.assertEqual(modal_res["stats"]["total_losses"], exp_st["losses"])
                        self.assertEqual(modal_res["stats"]["total_draws"], exp_st["draws"])
                        self.assertEqual(modal_res["stats"]["win_rate"], exp_wr)
                        self.assertEqual(len(modal_res["matches"]), exp_st["matches"])

                    # For zero-match narrow filter, modal must also return 0 cleanly without leaking global matches
                    if exp_matches == 0 and gs == "40k":
                        zero_modal = asyncio.run(
                            lb_router.api_faction_details(
                                faction_name="Space Marines",
                                timeframe="all",
                                game_system="40k",
                                **f_kwargs,
                            )
                        )
                        self.assertEqual(zero_modal["stats"]["total_matches"], 0)
                        self.assertEqual(len(zero_modal["matches"]), 0)

            # Verify In-Person + Online == All Events on 40K
            r_all = asyncio.run(lb_router.api_faction_meta(timeframe="all", game_system="40k"))
            r_irl = asyncio.run(lb_router.api_faction_meta(timeframe="all", game_system="40k", venue_mode="in_person"))
            r_onl = asyncio.run(lb_router.api_faction_meta(timeframe="all", game_system="40k", venue_mode="online"))
            self.assertEqual(
                r_irl["summary_kpis"]["total_matches"] + r_onl["summary_kpis"]["total_matches"],
                r_all["summary_kpis"]["total_matches"],
            )

            # Verify `exclude_leagues=True` drops the 8-round casual league from `min_rounds=5`
            r_r5_incl = asyncio.run(lb_router.api_faction_meta(timeframe="all", game_system="40k", min_rounds=5, exclude_leagues=False))
            r_r5_excl = asyncio.run(lb_router.api_faction_meta(timeframe="all", game_system="40k", min_rounds=5, exclude_leagues=True))
            self.assertEqual(r_r5_incl["summary_kpis"]["matched_events"] - r_r5_excl["summary_kpis"]["matched_events"], 1)
            self.assertEqual(r_r5_incl["summary_kpis"]["total_matches"] - r_r5_excl["summary_kpis"]["total_matches"], 2)

            # Verify X-0 undefeated run tracking under `elo_floor=1550` vs `elo_floor=1650`
            # p_sm_vet went 3-0 in ev_gt_us (3 games >=1550 -> 1 X-0 run; only 2 games >=1650 -> 0 X-0 runs because <3 games!)
            r_1550 = asyncio.run(lb_router.api_faction_meta(timeframe="all", game_system="40k", elo_floor=1550))
            r_1650 = asyncio.run(lb_router.api_faction_meta(timeframe="all", game_system="40k", elo_floor=1650))
            sm_1550 = next(f for f in r_1550["factions"] if f["faction"] == "Space Marines")
            sm_1650 = next(f for f in r_1650["factions"] if f["faction"] == "Space Marines")
            self.assertEqual(sm_1550["x0_runs"], 1)
            self.assertEqual(sm_1650["x0_runs"], 0)

            # Verify `/api/factions/meta/filters` returns countries, US states, structures, and formats
            f_opts_40k = asyncio.run(lb_router.api_faction_meta_filters(game_system="40k", timeframe="all"))
            cc_codes = {c["code"] for c in f_opts_40k["countries"]}
            self.assertEqual(cc_codes, {"US", "GB", "DE"})
            us_st_codes = {s["code"] for s in f_opts_40k["us_states"]}
            self.assertEqual(us_st_codes, {"TX", "CA"})
            self.assertEqual(f_opts_40k["online_events"], 1)
            self.assertEqual(f_opts_40k["in_person_events"], 4)


class TestPostgresRollupSqlAndFrontendContract(unittest.TestCase):
    """Verifies PostgreSQL rollup fast-path SQL parameter safety and frontend UI contract."""

    def test_postgres_rollup_fast_path_and_filtered_details_sql_interpolation(self):
        PostgresDatabase.invalidate_all_caches()
        PostgresDatabase._meta_rollup_ready_systems.add("40k")
        db = PostgresDatabase.__new__(PostgresDatabase)
        db.connection_pool = True
        db._is_mock_instance = lambda: False
        executed_queries = []

        class StrictRollupCursor:
            def __init__(self):
                self.connection = object()
                self._last_q = ""

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def execute(self, query, params=None):
                if params is not None:
                    # Strict psycopg2 `%` interpolation check: fails immediately on any unescaped `%`
                    _ = query % tuple(repr(p) for p in params)
                self._last_q = query
                executed_queries.append((query, params))

            def fetchone(self):
                return None

            def fetchall(self):
                if "FROM system_settings WHERE key = ANY" in self._last_q:
                    return [{"key": "meta_event_rollups_v1_40k", "value": "ready"}]
                if "FROM meta_event_matchups" in self._last_q:
                    return [
                        {
                            "is_non_1v1": False,
                            "p1_fac": "Space Marines",
                            "p2_fac": "Orks",
                            "period_date": "2026-10-01",
                            "match_cnt": 40,
                            "p1_wins": 24,
                            "p1_losses": 15,
                            "draws": 1,
                            "p2_wins": 15,
                            "p2_losses": 24,
                            "p1_score_sum": 3200,
                            "p1_score_cnt": 40,
                            "p2_score_sum": 2800,
                            "p2_score_cnt": 40,
                            "p1_margin_sum": 400,
                            "margin_cnt": 40,
                            "matched_events": 18,
                        }
                    ]
                if "FROM meta_event_runs" in self._last_q:
                    return [
                        {
                            "fac": "Space Marines",
                            "unique_pilots": 14,
                            "event_runs_count": 12,
                            "x0_runs": 2,
                            "x1_runs": 4,
                        }
                    ]
                return []

        class MockConn:
            def cursor(self, *args, **kwargs):
                return StrictRollupCursor()

            def rollback(self):
                pass

            def commit(self):
                pass

        @contextmanager
        def _mock_conn():
            yield MockConn()

        mf = parse_meta_filters(
            min_players=28,
            min_rounds=5,
            exclude_leagues=True,
            venue_mode="in_person",
            event_structure="singles",
            country="US",
            state="TX",
            elo_floor=1550,
        )
        with patch.object(PostgresDatabase, "get_connection", new=lambda _self: _mock_conn()):
            res = db.get_faction_meta_stats(
                timeframe="90d",
                game_system="40k",
                meta_filters=mf,
                include_trends=False,
                _force_refresh=True,
            )
            self.assertEqual(res["summary_kpis"]["total_matches"], 40)
            self.assertEqual(res["summary_kpis"]["matched_events"], 18)
            self.assertEqual(res["monthly_trends"], [])
            sm = next(f for f in res["factions"] if f["faction"] == "Space Marines")
            self.assertEqual(sm["win_rate"], 60.0)
            self.assertEqual(sm["x0_runs"], 2)
            self.assertEqual(sm["unique_pilots"], 14)

            # Verify `exp_` rollup columns were queried for `elo_floor=1550`
            rollup_mu_sql = next(q for q, _p in executed_queries if "FROM meta_event_matchups" in q)
            self.assertIn("mu.exp_match_cnt", rollup_mu_sql)
            self.assertIn("JOIN events e ON e.id = mu.event_id", rollup_mu_sql)

            # Verify `get_faction_details` with active filters executes parameterized `EXISTS` clauses cleanly
            det = db.get_faction_details(
                "Space Marines",
                limit=50,
                game_system="40k",
                timeframe="90d",
                include_top_players=True,
                meta_filters=mf,
                _force_refresh=True,
            )
            self.assertEqual(det["filter"]["min_players"], 28)
            self.assertEqual(det["filter"]["elo_floor"], 1550)

    def test_postgres_rollup_pre_eids_pk_and_unnest_hash_regimes(self):
        """Verifies both PK `ANY(%s)` (<=1000 events) and `UNNEST` Hash Join (>1000 events) cold rollup regimes."""
        for ev_count, expected_token in ((12, "mu.event_id = ANY(%s)"), (1205, "JOIN UNNEST(%s::varchar[]) AS fe(eid) ON fe.eid = mu.event_id")):
            PostgresDatabase.invalidate_all_caches()
            PostgresDatabase._meta_rollup_ready_systems.add("40k")
            PostgresDatabase._meta_rollup_status_checked_ts = 9999999999.0
            db = PostgresDatabase.__new__(PostgresDatabase)
            db.connection_pool = True
            db._is_mock_instance = lambda: False
            executed = []

            class PreEidRollupCursor:
                _enable_pre_eids = True

                def __init__(self):
                    self.connection = object()
                    self._last_q = ""

                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    pass

                def execute(self, query, params=None):
                    if params is not None:
                        _ = query % tuple(repr(p) for p in params)
                    self._last_q = query
                    executed.append((query, params))

                def fetchone(self):
                    if "SELECT COUNT(*) AS cnt" in self._last_q:
                        return {"cnt": ev_count}
                    return None

                def fetchall(self):
                    if "SELECT e.id FROM events e" in self._last_q:
                        return [{"id": f"ev_{i}"} for i in range(ev_count)]
                    if "FROM meta_event_matchups" in self._last_q:
                        return [
                            {
                                "is_non_1v1": False,
                                "p1_fac": "Aeldari",
                                "p2_fac": "Necrons",
                                "period_date": None,
                                "match_cnt": 50,
                                "p1_wins": 30,
                                "p1_losses": 20,
                                "draws": 0,
                                "p2_wins": 20,
                                "p2_losses": 30,
                                "p1_score_sum": 4000,
                                "p1_score_cnt": 50,
                                "p2_score_sum": 3500,
                                "p2_score_cnt": 50,
                                "p1_margin_sum": 500,
                                "margin_cnt": 50,
                            }
                        ]
                    if "SUM(r." in self._last_q and "FROM meta_event_runs" in self._last_q:
                        return [
                            {
                                "fac": "Aeldari",
                                "sum_pilots": 25,
                                "event_runs_count": 20,
                                "x0_runs": 4,
                                "x1_runs": 7,
                                "row_cnt": 20 if ev_count <= 1000 else 5000,
                            }
                        ]
                    if "UNNEST(r." in self._last_q:
                        return [{"fac": "Aeldari", "unique_pilots": 22}]
                    return []

            class MockConn2:
                def cursor(self, *args, **kwargs):
                    return PreEidRollupCursor()

                def rollback(self):
                    pass

                def commit(self):
                    pass

            @contextmanager
            def _mc2():
                yield MockConn2()

            mf_sub = parse_meta_filters(min_players=24, exclude_leagues=True)
            with patch.object(PostgresDatabase, "get_connection", new=lambda _self: _mc2()):
                res_sub = db.get_faction_meta_stats(
                    timeframe="90d",
                    game_system="40k",
                    meta_filters=mf_sub,
                    include_trends=False,
                    _force_refresh=True,
                )
                self.assertEqual(res_sub["summary_kpis"]["total_matches"], 50)
                self.assertEqual(res_sub["summary_kpis"]["matched_events"], ev_count)
                ael = next(f for f in res_sub["factions"] if f["faction"] == "Aeldari")
                self.assertEqual(ael["unique_pilots"], 22 if ev_count <= 1000 else 25)
                mu_sql = next(q for q, _p in executed if "FROM meta_event_matchups" in q and "SUM(" in q)
                self.assertIn(expected_token, mu_sql)

    def test_frontend_quadrant_timeline_removed_and_all_events_default(self):
        root = Path(__file__).resolve().parent.parent
        app_html = (root / "web" / "app.html").read_text(encoding="utf-8")
        factions_js = (root / "web" / "js" / "factions.js").read_text(encoding="utf-8")
        modals_js = (root / "web" / "js" / "modals.js").read_text(encoding="utf-8")
        bundle_js = (root / "web" / "js" / "app.bundle.min.js").read_text(encoding="utf-8")

        # Quadrant and Timeline views must be completely removed from HTML and JS
        self.assertNotIn("meta-view-btn-quadrant", app_html)
        self.assertNotIn("meta-view-btn-chart", app_html)
        self.assertNotIn("faction-quadrant-view-container", app_html)
        self.assertNotIn("faction-chart-view-container", app_html)
        self.assertNotIn("renderFactionQuadrantChart", factions_js)
        self.assertNotIn("renderFactionTimelineChart", factions_js)
        self.assertNotIn("renderFactionQuadrantChart", bundle_js)

        # Scope filter bar + modal filter banner must be present and default to All Events
        self.assertIn('id="meta-scope-filter-panel"', app_html)
        self.assertIn('id="faction-modal-filter-banner"', app_html)
        self.assertIn("min_players: 0", factions_js)
        self.assertIn("min_rounds: 0", factions_js)
        self.assertIn("venue_mode: 'all'", factions_js)
        self.assertIn("toggleFactionModalFilterScope", modals_js)
        self.assertIn("setMetaMinPlayers", bundle_js)
        self.assertIn("toggleFactionModalFilterScope", bundle_js)


if __name__ == "__main__":
    unittest.main()
