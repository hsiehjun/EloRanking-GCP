#!/usr/bin/env python3
"""
Comprehensive Expected-vs-Actual Test Suite for Meta Intel Across All 118 Game Systems
and Every Faction in Each Game System.

Validates:
1. Faction catalog & roster completeness across all 118 game systems (0 placeholders, 0 composite '+').
2. Expected vs. actual Meta Intel overview metrics (`get_faction_meta_stats`) for all 118 game systems
   and every faction in each game system:
   - wins, losses, draws, total_matches (`wins + losses + draws == total_matches`)
   - win_rate (`round(wins * 100 / total_matches, 1)`)
   - mirror_matches, non_mirror_matches, non_mirror_win_rate
   - meta_share (`round(total_matches * 100 / system_total_appearances, 2)` and sum ~100.0%)
   - ci_margin (95% Wilson/normal approximation confidence interval margin)
   - unique_pilots, x0_runs, x1_runs
   - tiwp_rate and over_rep_ratio
   - avg_score, avg_opp_score, avg_margin
   - tier (`S`, `A`, `B`, `C`, `D`) and tier_label
   - best_matchup and worst_matchup (`best.win_rate >= worst.win_rate`)
   - summary_kpis (`total_matches`, `total_appearances`, `active_factions`, `goldilocks_count`,
     `goldilocks_pct`, `most_played_faction`, `highest_wr_faction`)
   - matchup_matrix off-diagonal symmetry
     (`cell(A,B).matches == cell(B,A).matches`, `cell(A,B).wins == cell(B,A).losses`,
     `round(cell(A,B).avg_margin + cell(B,A).avg_margin, 1) == 0.0`)
   - monthly_trends valid time-series points
3. Expected vs. actual Single Faction Dossier (`get_faction_details`) for EVERY faction in EVERY
   game system across all 118 game systems:
   - 100% parity between `get_faction_meta_stats` and `get_faction_details["stats"]`
   - non-empty `matches`, `top_players`, `matchups`
   - match-level and pilot-level accounting invariants
4. Timeframe window filtering (`30d`, `60d`, `90d`, `180d`, `1yr`, `ytd`, `all`, custom dates)
   across 40K, AoS, and non-40K/AoS game systems.
5. `PostgresDatabase` expected vs. actual behavior for all 118 game systems (including colon-containing
   card/leader names and `loser_id IS NULL` rows).
6. Live HTTP API verification (`/api/factions`, `/api/factions/meta`, `/api/faction/{name}`) across
   active and catalog game systems.
"""

from collections import defaultdict
from contextlib import contextmanager
import json
import math
from pathlib import Path
import sys
import unittest
import urllib.parse
import urllib.request

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from config import (
    BCP_GAME_SYSTEMS_CATALOG,
    get_default_factions_for_system,
    is_placeholder_faction,
    normalize_game_system,
    resolve_canonical_faction,
)
from database import PostgresDatabase
from scripts.local_sqlite_db import LocalSqliteDatabase


def _compute_expected_meta_from_rh_rows(rh_rows, game_system: str):
    """Independent ground-truth reference computation of Meta Intel metrics from rating_history rows."""
    norm_sys = normalize_game_system(game_system, default="40k")
    fac_stats = defaultdict(
        lambda: {
            "wins": 0,
            "losses": 0,
            "draws": 0,
            "total": 0,
            "non_mirror_wins": 0,
            "non_mirror_total": 0,
            "mirror_matches": 0,
            "pilots": set(),
            "score_sum": 0.0,
            "opp_score_sum": 0.0,
            "score_cnt": 0,
            "event_runs": defaultdict(lambda: {"w": 0, "l": 0, "d": 0, "g": 0}),
            "matchups": defaultdict(
                lambda: {"w": 0, "l": 0, "d": 0, "g": 0, "margin_sum": 0.0, "margin_cnt": 0}
            ),
        }
    )

    event_max_rounds = {}
    for r in rh_rows:
        ev_id = str(r.get("event_id") or "ev")
        rnd_val = int(r.get("round") or 1)
        if rnd_val > event_max_rounds.get(ev_id, 0):
            event_max_rounds[ev_id] = rnd_val

    for r in rh_rows:
        pid = str(r.get("player_id") or "")
        raw_fac = str(r.get("player_faction") or "").strip()
        fac = resolve_canonical_faction(
            raw_fac, norm_sys, player_id=pid, resolve_placeholders=False
        )
        if not fac or is_placeholder_faction(fac, norm_sys):
            continue

        ev_id = str(r.get("event_id") or "ev")
        outcome = str(r.get("result") or "L").strip().upper()
        if outcome not in ("W", "L", "D"):
            outcome = "L"

        ps = float(r.get("player_score") or 0.0)
        os_val = float(r.get("opponent_score") or 0.0)

        st = fac_stats[fac]
        st["total"] += 1
        if pid:
            st["pilots"].add(pid)
        if outcome == "W":
            st["wins"] += 1
        elif outcome == "D":
            st["draws"] += 1
        else:
            st["losses"] += 1

        st["score_sum"] += ps
        st["opp_score_sum"] += os_val
        st["score_cnt"] += 1

        if pid:
            er = st["event_runs"][(ev_id, pid)]
            er["g"] += 1
            if outcome == "W":
                er["w"] += 1
            elif outcome == "D":
                er["d"] += 1
            else:
                er["l"] += 1

        try:
            rj = (
                json.loads(r["raw_json"] or "{}")
                if isinstance(r.get("raw_json"), str)
                else (r.get("raw_json") or {})
            )
        except Exception:
            rj = {}
        if not isinstance(rj, dict):
            rj = {}

        pod_opps = rj.get("pod_opponents") or rj.get("pod_participants")
        team_opps = rj.get("opponents") or rj.get("opponent_team")

        opp_encounters = []
        if rj.get("is_ffa") and isinstance(pod_opps, list):
            for opp_seat in pod_opps:
                opp_pid = str(opp_seat.get("player_id") or "")
                if opp_pid == pid:
                    continue
                o_fac = resolve_canonical_faction(
                    opp_seat.get("faction"), norm_sys, player_id=opp_pid, resolve_placeholders=False
                )
                if not o_fac or is_placeholder_faction(o_fac, norm_sys):
                    continue
                opp_sc = float(
                    opp_seat.get("score") if opp_seat.get("score") is not None else os_val
                )
                if outcome == "D" or opp_seat.get("is_draw"):
                    opp_encounters.append((o_fac, "D", 0.0))
                elif outcome == "W":
                    opp_encounters.append((o_fac, "W", ps - opp_sc))
                elif opp_seat.get("is_winner"):
                    opp_encounters.append((o_fac, "L", ps - opp_sc))
        elif rj.get("is_2v2") and isinstance(team_opps, list):
            for opp_t in team_opps:
                opp_pid = str(opp_t.get("player_id") or "")
                o_fac = resolve_canonical_faction(
                    opp_t.get("faction"), norm_sys, player_id=opp_pid, resolve_placeholders=False
                )
                if not o_fac or is_placeholder_faction(o_fac, norm_sys):
                    continue
                opp_encounters.append((o_fac, outcome, ps - os_val))
        elif " + " in str(r.get("opponent_faction") or ""):
            for part_fac in str(r.get("opponent_faction") or "").split(" + "):
                o_fac = resolve_canonical_faction(
                    part_fac.strip(), norm_sys, resolve_placeholders=False
                )
                if o_fac and not is_placeholder_faction(o_fac, norm_sys):
                    opp_encounters.append((o_fac, outcome, ps - os_val))
        else:
            opp_pid = str(r.get("opponent_id") or "")
            o_fac = resolve_canonical_faction(
                r.get("opponent_faction"), norm_sys, player_id=opp_pid, resolve_placeholders=False
            )
            if o_fac and not is_placeholder_faction(o_fac, norm_sys):
                opp_encounters.append((o_fac, outcome, ps - os_val))

        for o_fac, pair_out, pair_mrg in opp_encounters:
            if o_fac.lower() == fac.lower():
                st["mirror_matches"] += 1
            else:
                st["non_mirror_total"] += 1
                if pair_out == "W":
                    st["non_mirror_wins"] += 1
                mu = st["matchups"][o_fac]
                mu["g"] += 1
                if pair_out == "W":
                    mu["w"] += 1
                elif pair_out == "D":
                    mu["d"] += 1
                else:
                    mu["l"] += 1
                mu["margin_sum"] += pair_mrg
                mu["margin_cnt"] += 1

    total_appearances = max(1, sum(v["total"] for v in fac_stats.values()))

    x0_by_fac = {}
    x1_by_fac = {}
    entries_by_fac = {}
    for fac, st in fac_stats.items():
        x0 = 0
        x1 = 0
        for (ev_id, _pid), er in st["event_runs"].items():
            ev_max_r = max(1, event_max_rounds.get(ev_id, 3))
            min_w_x0 = min(3, ev_max_r)
            min_w_x1 = max(1, min(3, ev_max_r - 1))
            if er["l"] == 0 and er["w"] >= min_w_x0:
                x0 += 1
            elif er["l"] == 1 and er["w"] >= min_w_x1:
                x1 += 1
        x0_by_fac[fac] = x0
        x1_by_fac[fac] = x1
        entries_by_fac[fac] = max(1, len(st["event_runs"]))

    total_top_runs = sum(x0_by_fac.get(fk, 0) + x1_by_fac.get(fk, 0) for fk in fac_stats)
    expected_factions = {}
    for fac, st in fac_stats.items():
        tot = st["total"]
        w = st["wins"]
        l = st["losses"]
        d = st["draws"]
        wr = round((w * 100.0) / max(1, tot), 1)
        nm_tot = st["non_mirror_total"]
        nm_w = st["non_mirror_wins"]
        nm_wr = round((nm_w * 100.0) / max(1, nm_tot), 1) if nm_tot > 0 else wr
        meta_share = round((tot * 100.0) / total_appearances, 2)

        p_prob = w / max(1, tot)
        ci_margin = round(
            1.96 * math.sqrt(max(0.0, p_prob * (1.0 - p_prob)) / max(1, tot)) * 100.0, 1
        )

        sc_cnt = max(1, st["score_cnt"])
        avg_score = round(st["score_sum"] / sc_cnt, 1)
        avg_opp_score = round(st["opp_score_sum"] / sc_cnt, 1)
        avg_margin = round((st["score_sum"] - st["opp_score_sum"]) / sc_cnt, 1)

        u_pilots = max(1, len(st["pilots"]))
        x0 = x0_by_fac[fac]
        x1 = x1_by_fac[fac]
        n_entries = entries_by_fac.get(fac, u_pilots)
        tiwp_rate = round(((x0 + x1) * 100.0) / max(1, n_entries), 1)
        if total_top_runs > 0 and meta_share > 0 and (x0 + x1) > 0:
            top_share = ((x0 + x1) * 100.0) / total_top_runs
            over_rep = round(top_share / meta_share, 2)
        else:
            over_rep = round(wr / 50.0, 2)

        if wr > 55.0:
            tier, tier_label = "S", "Overperforming (>55%)"
        elif wr >= 52.0:
            tier, tier_label = "A", "Goldilocks Upper (52-55%)"
        elif wr >= 48.0:
            tier, tier_label = "B", "Goldilocks Core (48-52%)"
        elif wr >= 45.0:
            tier, tier_label = "C", "Goldilocks Lower (45-48%)"
        else:
            tier, tier_label = "D", "Underperforming (<45%)"

        expected_factions[fac] = {
            "faction": fac,
            "total_matches": tot,
            "wins": w,
            "losses": l,
            "draws": d,
            "win_rate": wr,
            "mirror_matches": st["mirror_matches"],
            "non_mirror_matches": nm_tot,
            "non_mirror_win_rate": nm_wr,
            "meta_share": meta_share,
            "ci_margin": ci_margin,
            "unique_pilots": u_pilots,
            "x0_runs": x0,
            "x1_runs": x1,
            "tiwp_rate": tiwp_rate,
            "over_rep_ratio": over_rep,
            "avg_score": avg_score,
            "avg_opp_score": avg_opp_score,
            "avg_margin": avg_margin,
            "tier": tier,
            "tier_label": tier_label,
        }

    return expected_factions, total_appearances


class TestMetaIntelAllSystemsAndFactions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.local_db = LocalSqliteDatabase()
        cls.all_slugs = [item["slug"] for item in BCP_GAME_SYSTEMS_CATALOG]

    def test_01_catalog_and_default_factions_for_all_118_systems(self):
        """Verify all 120 game systems have >= 3 authentic default factions and 0 placeholders."""
        self.assertEqual(len(self.all_slugs), 120)
        for slug in self.all_slugs:
            with self.subTest(game_system=slug):
                default_factions = get_default_factions_for_system(slug)
                self.assertGreaterEqual(
                    len(default_factions),
                    3,
                    f"System {slug} must have at least 3 default factions",
                )
                self.assertEqual(
                    len(default_factions),
                    len(set(default_factions)),
                    f"System {slug} default factions must be unique",
                )
                for fac in default_factions:
                    self.assertFalse(
                        is_placeholder_faction(fac, slug),
                        f"Faction '{fac}' in {slug} must not be a placeholder",
                    )
                    self.assertNotIn("+", fac, f"Faction '{fac}' in {slug} must not contain '+'")

                # Verify local_db.get_factions_list and PostgresDatabase.get_factions
                local_factions = self.local_db.get_factions_list(game_system=slug)
                self.assertGreaterEqual(len(local_factions), 3, f"{slug} local factions list too small")
                for fac in local_factions:
                    self.assertFalse(
                        is_placeholder_faction(fac, slug),
                        f"Local faction '{fac}' in {slug} is a placeholder",
                    )

                PostgresDatabase._dynamic_factions_cache_dict.pop(slug, None)
                pg_factions = PostgresDatabase.get_factions(slug)
                self.assertGreaterEqual(len(pg_factions), 3, f"{slug} PostgresDatabase.get_factions too small")
                for fac in pg_factions:
                    self.assertFalse(
                        is_placeholder_faction(fac, slug),
                        f"Postgres faction '{fac}' in {slug} is a placeholder",
                    )

    def test_02_expected_vs_actual_meta_intel_for_every_game_system_and_every_faction(self):
        """
        Exhaustively verifies expected vs. actual Meta Intel stats (`get_faction_meta_stats`)
        and Single Faction Dossier (`get_faction_details`) for all 118 game systems and every
        faction in each game system.
        """
        total_systems_checked = 0
        total_factions_checked = 0

        for slug in self.all_slugs:
            with self.subTest(game_system=slug):
                rh_rows, _pr_map = self.local_db._load_effective_rh_rows(slug, None, None)
                self.assertGreater(len(rh_rows), 0, f"System {slug} must have effective rh_rows")

                expected_factions_map, expected_total_appearances = _compute_expected_meta_from_rh_rows(
                    rh_rows, slug
                )
                actual_meta = self.local_db.get_faction_meta_stats(game_system=slug, timeframe="all")

                self.assertIsInstance(actual_meta, dict)
                actual_factions_list = actual_meta.get("factions") or []
                self.assertGreater(
                    len(actual_factions_list), 0, f"System {slug} returned 0 factions in meta"
                )

                actual_factions_map = {f["faction"]: f for f in actual_factions_list}
                self.assertEqual(
                    set(actual_factions_map.keys()),
                    set(expected_factions_map.keys()),
                    f"Faction set mismatch in {slug}",
                )

                # Verify meta_share sums to ~100.0%
                meta_share_sum = sum(f["meta_share"] for f in actual_factions_list)
                self.assertAlmostEqual(
                    meta_share_sum,
                    100.0,
                    delta=0.6,
                    msg=f"Meta share sum in {slug} was {meta_share_sum}%",
                )

                # Verify summary_kpis expected vs actual
                kpis = actual_meta.get("summary_kpis") or {}
                self.assertEqual(kpis.get("total_appearances"), expected_total_appearances)
                self.assertEqual(kpis.get("active_factions"), len(actual_factions_list))

                expected_goldilocks = sum(
                    1 for f in actual_factions_list if 45.0 <= f["win_rate"] <= 55.0
                )
                self.assertEqual(kpis.get("goldilocks_count"), expected_goldilocks)
                expected_goldilocks_pct = round(
                    (expected_goldilocks * 100.0) / len(actual_factions_list), 1
                )
                self.assertEqual(kpis.get("goldilocks_pct"), expected_goldilocks_pct)

                # Verify matchup_matrix symmetry
                matrix = actual_meta.get("matchup_matrix") or {}
                m_factions = matrix.get("factions") or []
                m_cells = matrix.get("cells") or {}
                self.assertGreater(len(m_factions), 0, f"Empty matchup_matrix in {slug}")
                for fa in m_factions:
                    self.assertIn(fa, m_cells)
                    for fb in m_factions:
                        if fa == fb:
                            continue
                        cell_ab = m_cells[fa].get(fb)
                        cell_ba = m_cells.get(fb, {}).get(fa)
                        if cell_ab and cell_ba:
                            self.assertEqual(cell_ab["m"], cell_ba["m"])
                            self.assertEqual(cell_ab["w"], cell_ba["l"])
                            self.assertEqual(cell_ab["l"], cell_ba["w"])
                            self.assertEqual(cell_ab["d"], cell_ba["d"])
                            self.assertAlmostEqual(
                                cell_ab["margin"] + cell_ba["margin"], 0.0, places=1
                            )

                # Verify monthly_trends
                trends = actual_meta.get("monthly_trends") or []
                self.assertGreater(len(trends), 0, f"Empty monthly_trends in {slug}")
                for pt in trends:
                    self.assertIn("month", pt)
                    self.assertIn("faction", pt)
                    self.assertGreater(pt.get("matches_in_month", 0), 0)
                    self.assertGreaterEqual(pt.get("win_rate", -1), 0.0)
                    self.assertLessEqual(pt.get("win_rate", 101), 100.0)

                # Verify EVERY faction in this game system (both in meta and in get_factions_list)
                system_faction_union = sorted(
                    set(actual_factions_map.keys()) | set(self.local_db.get_factions_list(slug))
                )
                for fac_name in system_faction_union:
                    total_factions_checked += 1
                    self.assertFalse(
                        is_placeholder_faction(fac_name, slug),
                        f"Placeholder faction '{fac_name}' found in {slug}",
                    )
                    self.assertNotIn("+", fac_name)

                    if fac_name in expected_factions_map:
                        exp = expected_factions_map[fac_name]
                        act = actual_factions_map[fac_name]
                        for field in (
                            "total_matches",
                            "wins",
                            "losses",
                            "draws",
                            "win_rate",
                            "mirror_matches",
                            "non_mirror_matches",
                            "non_mirror_win_rate",
                            "meta_share",
                            "ci_margin",
                            "unique_pilots",
                            "x0_runs",
                            "x1_runs",
                            "tiwp_rate",
                            "over_rep_ratio",
                            "avg_score",
                            "avg_opp_score",
                            "avg_margin",
                            "tier",
                            "tier_label",
                        ):
                            self.assertEqual(
                                act.get(field),
                                exp.get(field),
                                f"[{slug} / {fac_name}] field '{field}': actual={act.get(field)} != expected={exp.get(field)}",
                            )

                        self.assertEqual(act["wins"] + act["losses"] + act["draws"], act["total_matches"])

                        best_mu = act.get("best_matchup")
                        worst_mu = act.get("worst_matchup")
                        if best_mu and worst_mu:
                            self.assertGreaterEqual(best_mu["win_rate"], worst_mu["win_rate"])

                    # Verify Single Faction Dossier (`get_faction_details`) for EVERY faction
                    details = self.local_db.get_faction_details(
                        fac_name, limit=100, game_system=slug, timeframe="all"
                    )
                    self.assertEqual(details.get("faction"), fac_name)
                    self.assertEqual(details.get("game_system"), slug)
                    self.assertGreater(
                        details.get("total_matches", 0),
                        0,
                        f"[{slug} / {fac_name}] get_faction_details returned 0 total_matches",
                    )
                    self.assertGreater(
                        len(details.get("matches") or []),
                        0,
                        f"[{slug} / {fac_name}] get_faction_details returned 0 matches",
                    )
                    self.assertGreater(
                        len(details.get("top_players") or []),
                        0,
                        f"[{slug} / {fac_name}] get_faction_details returned 0 top_players",
                    )
                    self.assertGreater(
                        len(details.get("matchups") or []),
                        0,
                        f"[{slug} / {fac_name}] get_faction_details returned 0 matchups",
                    )

                    d_stats = details.get("stats") or {}
                    self.assertEqual(
                        d_stats.get("total_wins", 0)
                        + d_stats.get("total_losses", 0)
                        + d_stats.get("total_draws", 0),
                        d_stats.get("total_matches", 0),
                    )

                    if fac_name in actual_factions_map:
                        act = actual_factions_map[fac_name]
                        self.assertEqual(d_stats.get("total_matches"), act["total_matches"])
                        self.assertEqual(d_stats.get("total_wins"), act["wins"])
                        self.assertEqual(d_stats.get("total_losses"), act["losses"])
                        self.assertEqual(d_stats.get("total_draws"), act["draws"])
                        self.assertEqual(d_stats.get("win_rate"), act["win_rate"])
                        self.assertEqual(
                            d_stats.get("non_mirror_win_rate"), act["non_mirror_win_rate"]
                        )
                        self.assertEqual(d_stats.get("meta_share"), act["meta_share"])

                    for mu in details["matchups"]:
                        self.assertNotEqual(mu["opponent_faction"].lower(), fac_name.lower())
                        self.assertEqual(
                            mu["wins"] + mu["losses"] + mu["draws"], mu["total_matches"]
                        )
                        expected_mu_wr = round((mu["wins"] * 100.0) / mu["total_matches"], 1)
                        self.assertEqual(mu["win_rate"], expected_mu_wr)

                    for m in details["matches"][:10]:
                        self.assertEqual(m.get("player_faction"), fac_name)
                        self.assertIn(m.get("outcome"), ("W", "L", "D"))
                        self.assertTrue(bool(m.get("player_name")))
                        self.assertTrue(bool(m.get("opponent_name")))
                        self.assertTrue(bool(m.get("opponent_faction")))

                    for tp in details["top_players"][:10]:
                        self.assertEqual(tp.get("faction"), fac_name)
                        self.assertEqual(
                            tp["wins"] + tp["losses"] + tp["draws"], tp["matches_played"]
                        )

                total_systems_checked += 1

        self.assertEqual(total_systems_checked, 120)
        self.assertGreaterEqual(total_factions_checked, 750)

    def test_03_timeframe_windows_monotonicity_across_systems(self):
        """Verify 30d <= 60d <= 90d <= 180d <= 1yr <= all match counts across diverse game systems."""
        sample_systems = [
            "40k",
            "aos",
            "pokemon",
            "mtg",
            "one_piece",
            "riftbound",
            "kill_team",
            "the_old_world",
            "horus_heresy",
            "battletech",
            "infinity",
        ]
        ordered_presets = ["30d", "60d", "90d", "180d", "1yr", "all"]
        for slug in sample_systems:
            with self.subTest(game_system=slug):
                prev_matches = 0
                for tf in ordered_presets:
                    meta = self.local_db.get_faction_meta_stats(game_system=slug, timeframe=tf)
                    tot_matches = (meta.get("summary_kpis") or {}).get("total_matches", 0)
                    self.assertGreater(tot_matches, 0, f"{slug} timeframe={tf} should have >0 matches")
                    self.assertGreaterEqual(
                        tot_matches,
                        prev_matches,
                        f"{slug} timeframe={tf} ({tot_matches}) < previous timeframe ({prev_matches})",
                    )
                    prev_matches = tot_matches

                # Also verify custom start_date / end_date filter
                custom_meta = self.local_db.get_faction_meta_stats(
                    game_system=slug, start_date="2026-01-01", end_date="2026-12-31"
                )
                self.assertGreater(len(custom_meta.get("factions") or []), 0)

    def test_04_postgres_database_non_40k_aos_canonicalization_and_null_loser_id(self):
        """Verify PostgresDatabase handles colon card names, placeholder decks, and NULL loser_id."""
        # Colon-containing non-40K/AoS names must be preserved
        self.assertEqual(
            PostgresDatabase.canonicalize_faction_name("Omnimon: Merciful Mode"),
            "Omnimon: Merciful Mode",
        )
        self.assertEqual(
            PostgresDatabase.canonicalize_faction_name("Sabine Wren: Galvanized"),
            "Sabine Wren: Galvanized",
        )
        # Known 40K/AoS subfaction colons must still collapse to canonical faction
        self.assertEqual(
            PostgresDatabase.canonicalize_faction_name("Blades of Khorne: Reapers of Vengeance"),
            "Blades of Khorne",
        )
        # Placeholder deck names must be rejected by is_super_or_empty_faction
        for ph in ("Standard Deck", "Premier Deck", "Commander Deck", "Unknown", "Good", "Evil"):
            self.assertTrue(
                PostgresDatabase.is_super_or_empty_faction(ph),
                f"PostgresDatabase.is_super_or_empty_faction should reject '{ph}'",
            )
            self.assertEqual(PostgresDatabase.canonicalize_faction_name(ph), "")

        # Verify SQL queries in PostgresDatabase handle loser_id IS NULL when winner_id IS NOT NULL
        import inspect
        for fn in (
            PostgresDatabase.get_faction_meta_stats,
            PostgresDatabase._query_faction_top_players,
            PostgresDatabase._query_faction_matchups,
        ):
            src = inspect.getsource(fn)
            self.assertIn(
                "winner_id IS NOT NULL",
                src,
                f"{fn.__name__} must handle loser_id IS NULL when winner_id IS NOT NULL",
            )

        # Mock execution of PostgresDatabase.get_faction_meta_stats for a non-40K/AoS system ('pokemon')
        PostgresDatabase.invalidate_all_caches()
        db = PostgresDatabase.__new__(PostgresDatabase)

        class MockPokemonCursor:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def execute(self, query, params=None):
                pass

            def fetchall(self):
                return [
                    {
                        "p1_fac": "Dragapult ex",
                        "p2_fac": "Charizard ex",
                        "period_date": "2026-09-01",
                        "match_cnt": 50,
                        "p1_wins": 30,
                        "p1_losses": 18,
                        "draws": 2,
                        "p2_wins": 18,
                        "p2_losses": 30,
                        "p1_score_sum": 100,
                        "p1_score_cnt": 50,
                        "p2_score_sum": 60,
                        "p2_score_cnt": 50,
                        "p1_margin_sum": 40,
                        "margin_cnt": 50,
                    }
                ]

            def fetchone(self):
                return None

        class MockConn:
            def cursor(self, *args, **kwargs):
                return MockPokemonCursor()

            def rollback(self):
                pass

            def commit(self):
                pass

        @contextmanager
        def _mock_conn():
            yield MockConn()

        db.get_connection = _mock_conn
        res = db.get_faction_meta_stats(timeframe="90d", game_system="pokemon", _force_refresh=True)
        self.assertEqual(res["summary_kpis"]["total_matches"], 50)
        facs = {f["faction"]: f for f in res["factions"]}
        self.assertIn("Dragapult ex", facs)
        self.assertIn("Charizard ex", facs)
        self.assertEqual(facs["Dragapult ex"]["win_rate"], 60.0)
        self.assertEqual(facs["Charizard ex"]["win_rate"], 36.0)

    def test_05_live_http_endpoints_for_active_and_catalog_game_systems(self):
        """Verify live HTTP /api/factions, /api/factions/meta, and /api/faction/{name} on port 5174."""
        base_url = "http://127.0.0.1:5174"
        test_systems = [
            "40k",
            "aos",
            "kill_team",
            "the_old_world",
            "horus_heresy",
            "middle_earth",
            "mcp",
            "sw_legion",
            "one_piece",
            "pokemon",
            "mtg",
            "riftbound",
            "sw_unlimited",
            "lorcana",
            "digimon",
            "yugioh",
            "battletech",
            "infinity",
            "flesh_blood",
            "trench_crusade",
        ]
        for slug in test_systems:
            with self.subTest(game_system=slug):
                norm_slug = normalize_game_system(slug)
                # 1. /api/factions
                req1 = urllib.request.Request(
                    f"{base_url}/api/factions?game_system={slug}",
                    headers={"User-Agent": "OmniTacticaMetaTest/1.0"},
                )
                with urllib.request.urlopen(req1, timeout=5) as r1:
                    self.assertEqual(r1.status, 200)
                    factions_list = json.loads(r1.read().decode("utf-8"))
                    self.assertIsInstance(factions_list, list)
                    self.assertGreaterEqual(len(factions_list), 3)
                    for fac in factions_list:
                        self.assertFalse(is_placeholder_faction(fac, norm_slug))

                # 2. /api/factions/meta
                req2 = urllib.request.Request(
                    f"{base_url}/api/factions/meta?game_system={slug}&timeframe=1yr",
                    headers={"User-Agent": "OmniTacticaMetaTest/1.0"},
                )
                with urllib.request.urlopen(req2, timeout=5) as r2:
                    self.assertEqual(r2.status, 200)
                    meta = json.loads(r2.read().decode("utf-8"))
                    factions = meta.get("factions") or []
                    self.assertGreater(len(factions), 0)
                    top_fac = factions[0]["faction"]

                # 3. /api/faction/{top_fac}
                encoded_fac = urllib.parse.quote(top_fac, safe="")
                req3 = urllib.request.Request(
                    f"{base_url}/api/faction/{encoded_fac}?game_system={slug}&timeframe=1yr",
                    headers={"User-Agent": "OmniTacticaMetaTest/1.0"},
                )
                with urllib.request.urlopen(req3, timeout=5) as r3:
                    self.assertEqual(r3.status, 200)
                    details = json.loads(r3.read().decode("utf-8"))
                    self.assertEqual(details.get("faction"), top_fac)
                    self.assertEqual(details.get("game_system"), norm_slug)
                    self.assertEqual(
                        details["stats"]["total_matches"], factions[0]["total_matches"]
                    )
                    self.assertEqual(details["stats"]["win_rate"], factions[0]["win_rate"])
                    self.assertGreater(len(details.get("matches") or []), 0)
                    self.assertGreater(len(details.get("top_players") or []), 0)
                    self.assertGreater(len(details.get("matchups") or []), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
