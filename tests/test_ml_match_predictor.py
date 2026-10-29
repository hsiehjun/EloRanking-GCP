import datetime
import math
import os
import subprocess
import unittest
from unittest.mock import MagicMock

from elo import EloEngine
from predictor_model import (
    build_directional_feature_vector,
    compute_h2h_elo_residual,
    compute_rating_uncertainty_sq,
    default_mode2_system_spec,
    eval_symmetric_davidson,
    extract_player_disposition_and_residuals,
    is_clean_competitive_1v1_match,
    predict_1v1_matchup,
)


class TestCalibratedMlMatchPredictor(unittest.TestCase):
    def _synthetic_ml_spec(self, game_system: str = "40k"):
        spec = default_mode2_system_spec(game_system)
        spec["mode"] = "dedicated_ml"
        spec["model_label"] = "Calibrated GBDT Ensemble"
        # Deliberately include an asymmetric raw tree bias (+0.18 on root) to verify
        # that `0.5 * (g(x_AB) - g(x_BA))` enforces exact mathematical antisymmetry!
        spec["tree_base_score"] = 0.18
        spec["calib_scale"] = 0.92
        spec["calib_elo_anchor"] = 0.12
        spec["trees"] = [
            {
                # Split on elo_attenuated_logit (idx 1), then matchup_alpha (idx 7) / own_fac_res_diff (idx 9)
                "f": [1, 7, 9, -1, -1, -1, -1],
                "t": [0.05, -0.02, 0.03, 0.0, 0.0, 0.0, 0.0],
                "l": [1, 3, 5, -1, -1, -1, -1],
                "r": [2, 4, 6, -1, -1, -1, -1],
                "v": [0.0, 0.0, 0.0, -0.42, -0.11, 0.19, 0.54],
            },
            {
                # Split on fac_alpha_diff (idx 6) and disposition_upset_diff (idx 13)
                "f": [6, 13, 5, -1, -1, -1, -1],
                "t": [0.0, 0.0, 0.02, 0.0, 0.0, 0.0, 0.0],
                "l": [1, 3, 5, -1, -1, -1, -1],
                "r": [2, 4, 6, -1, -1, -1, -1],
                "v": [0.0, 0.0, 0.0, -0.22, -0.04, 0.08, 0.29],
            },
        ]
        spec["margin_base_score"] = 2.5  # Deliberate bias cancelled by symmetrization
        spec["margin_trees"] = [
            {
                "f": [1, -1, -1],
                "t": [0.0, 0.0, 0.0],
                "l": [1, -1, -1],
                "r": [2, -1, -1],
                "v": [0.0, -9.5, 11.5],
            }
        ]
        return spec

    def test_exact_antisymmetry_and_probability_simplex_both_modes(self):
        p1 = {
            "elo": 1845.0,
            "games": 64,
            "uncertainty_sq": compute_rating_uncertainty_sq(64, 7.0),
            "peak_gap": -22.0,
            "recent_form_ewma": 0.08,
            "own_fac_res": 0.065,
            "own_fac_games": 28,
            "vs_fac_res": 0.04,
            "giant_slayer_res": 0.03,
            "gatekeeper_res": 0.07,
            "volatility_z": 0.45,
        }
        p2 = {
            "elo": 1710.0,
            "games": 39,
            "uncertainty_sq": compute_rating_uncertainty_sq(39, 21.0),
            "peak_gap": -65.0,
            "recent_form_ewma": -0.03,
            "own_fac_res": 0.02,
            "own_fac_games": 14,
            "vs_fac_res": -0.02,
            "giant_slayer_res": 0.09,
            "gatekeeper_res": -0.01,
            "volatility_z": -0.30,
        }
        macro_ab = {
            "is_mirror": False,
            "f1_alpha": 0.042,
            "f2_alpha": -0.018,
            "matchup_alpha": 0.055,
            "matchup_games": 85,
        }
        macro_ba = {
            "is_mirror": False,
            "f1_alpha": -0.018,
            "f2_alpha": 0.042,
            "matchup_alpha": -0.055,
            "matchup_games": 85,
        }

        for spec in (default_mode2_system_spec("40k"), self._synthetic_ml_spec("40k"), default_mode2_system_spec("aos")):
            res_ab = predict_1v1_matchup(spec, p1, p2, macro_ab, direct_h2h_res=0.05, direct_h2h_games=3)
            res_ba = predict_1v1_matchup(spec, p2, p1, macro_ba, direct_h2h_res=-0.05, direct_h2h_games=3)

            # Sum to 100.0%
            self.assertAlmostEqual(
                res_ab["p1_win_prob"] + res_ab["draw_prob"] + res_ab["p2_win_prob"],
                100.0,
                places=5,
            )
            # Exact antisymmetry when swapping P1 <-> P2
            self.assertAlmostEqual(res_ab["logit"], -res_ba["logit"], places=7)
            self.assertAlmostEqual(res_ab["draw_prob"], res_ba["draw_prob"], places=5)
            self.assertAlmostEqual(res_ab["p1_win_prob"], res_ba["p2_win_prob"], places=1)
            self.assertAlmostEqual(res_ab["p1_win_share"], res_ba["p2_win_share"], places=5)
            self.assertEqual(res_ab["projected"]["wtc_p1"] + res_ab["projected"]["wtc_p2"], 20)
            self.assertEqual(res_ab["projected"]["wtc_p1"], res_ba["projected"]["wtc_p2"])

    def test_elo_residualized_mastery_eliminates_strength_of_schedule_bias(self):
        ref_date = datetime.date(2026, 10, 29)
        # Elite 2050 pilot going 5-5 against 2150 apex opponents (expected ~0.36 -> strong positive residual!)
        elite_rows = []
        for i in range(10):
            elite_rows.append({
                "match_date": f"2026-09-{10 + i:02d}",
                "round": (i % 5) + 1,
                "result": "W" if i < 5 else "L",
                "old_elo": 2050.0,
                "opponent_elo": 2150.0,
                "player_faction": "Aeldari",
                "opponent_faction": "Orks",
                "player_score": 82,
                "opponent_score": 76,
                "is_league": False,
                "structure_tag": "singles",
                "format_tag": "strike_force_2000",
            })

        # Mid-table 1350 pilot going 7-3 against 1100 beginners (expected ~0.81 -> negative residual despite 70% raw WR!)
        padded_rows = []
        for i in range(10):
            padded_rows.append({
                "match_date": f"2026-09-{10 + i:02d}",
                "round": (i % 5) + 1,
                "result": "W" if i < 7 else "L",
                "old_elo": 1350.0,
                "opponent_elo": 1100.0,
                "player_faction": "Aeldari",
                "opponent_faction": "Orks",
                "player_score": 85,
                "opponent_score": 45,
                "is_league": False,
                "structure_tag": "singles",
                "format_tag": "strike_force_2000",
            })

        elite_ext = extract_player_disposition_and_residuals(
            elite_rows, current_elo=2050.0, peak_elo=2080.0, matches_played=10, game_system="40k", reference_date=ref_date
        )
        padded_ext = extract_player_disposition_and_residuals(
            padded_rows, current_elo=1350.0, peak_elo=1365.0, matches_played=10, game_system="40k", reference_date=ref_date
        )

        elite_res = elite_ext["own_faction_residuals"]["aeldari"]["residual"]
        padded_res = padded_ext["own_faction_residuals"]["aeldari"]["residual"]
        self.assertGreater(elite_res, 0.0)
        self.assertLess(padded_res, 0.0)
        self.assertGreater(elite_res, padded_res)

    def test_provisional_rating_uncertainty_shrinkage(self):
        spec = default_mode2_system_spec("40k")
        neutral_macro = {"is_mirror": True, "f1_alpha": 0.0, "f2_alpha": 0.0, "matchup_alpha": 0.0, "matchup_games": 0}
        base_fields = {
            "peak_gap": 0.0, "recent_form_ewma": 0.0,
            "own_fac_res": 0.0, "own_fac_games": 5, "vs_fac_res": 0.0,
            "giant_slayer_res": 0.0, "gatekeeper_res": 0.0, "volatility_z": 0.0,
        }
        prov_p1 = {**base_fields, "elo": 1680.0, "games": 3, "uncertainty_sq": compute_rating_uncertainty_sq(3, 180.0)}
        prov_p2 = {**base_fields, "elo": 1500.0, "games": 3, "uncertainty_sq": compute_rating_uncertainty_sq(3, 180.0)}

        vet_p1 = {**base_fields, "elo": 1680.0, "games": 160, "uncertainty_sq": compute_rating_uncertainty_sq(160, 7.0)}
        vet_p2 = {**base_fields, "elo": 1500.0, "games": 160, "uncertainty_sq": compute_rating_uncertainty_sq(160, 7.0)}

        res_prov = predict_1v1_matchup(spec, prov_p1, prov_p2, neutral_macro)
        res_vet = predict_1v1_matchup(spec, vet_p1, vet_p2, neutral_macro)

        # Provisional 3-game ratings must be attenuated significantly closer to 50% than 160-game veterans
        self.assertLess(res_prov["p1_win_share"], res_vet["p1_win_share"])
        self.assertEqual(res_prov["confidence"], "Provisional")
        self.assertEqual(res_vet["confidence"], "High")

    def test_competitive_match_hygiene_filters_casual_and_non_singles(self):
        clean_row = {
            "opponent_name": "John Lennon",
            "is_bye": False,
            "is_league": False,
            "structure_tag": "singles",
            "format_tag": "strike_force_2000",
            "result": "W",
            "round": 5,
            "player_score": 88,
            "opponent_score": 74,
        }
        self.assertTrue(is_clean_competitive_1v1_match(clean_row, "40k"))
        self.assertFalse(is_clean_competitive_1v1_match({**clean_row, "is_league": True}, "40k"))
        self.assertFalse(is_clean_competitive_1v1_match({**clean_row, "structure_tag": "teams"}, "40k"))
        self.assertFalse(is_clean_competitive_1v1_match({**clean_row, "structure_tag": "doubles"}, "40k"))
        self.assertFalse(is_clean_competitive_1v1_match({**clean_row, "structure_tag": "ffa_pod"}, "mtg"))
        self.assertFalse(is_clean_competitive_1v1_match({**clean_row, "format_tag": "incursion_small"}, "40k"))
        self.assertFalse(is_clean_competitive_1v1_match({**clean_row, "format_tag": "commander_cedh"}, "mtg"))
        # Round 5 0-0 intentional draw excluded; genuine 72-72 draw retained!
        self.assertFalse(
            is_clean_competitive_1v1_match(
                {**clean_row, "result": "D", "round": 5, "player_score": 0, "opponent_score": 0}, "mtg"
            )
        )
        self.assertTrue(
            is_clean_competitive_1v1_match(
                {**clean_row, "result": "D", "round": 5, "player_score": 72, "opponent_score": 72}, "40k"
            )
        )

    def test_disposition_badge_sample_gate_and_earn_criteria(self):
        ref_date = datetime.date(2026, 10, 29)
        rows = []
        for i in range(30):
            # 12 games as heavy underdog (-150 Elo) winning 9 of them -> Giant-Slayer!
            is_underdog = i < 12
            rows.append({
                "match_date": f"2026-08-{(i % 28) + 1:02d}",
                "round": (i % 5) + 1,
                "result": ("W" if i < 9 else "L") if is_underdog else ("W" if i % 2 == 0 else "L"),
                "old_elo": 1650.0,
                "opponent_elo": 1810.0 if is_underdog else 1650.0,
                "player_faction": "Orks",
                "opponent_faction": "Necrons",
                "player_score": 95 if i % 2 == 0 else 35,
                "opponent_score": 40 if i % 2 == 0 else 92,
                "is_league": False,
                "structure_tag": "singles",
                "format_tag": "strike_force_2000",
            })

        # Under 25 competitive games -> strictly 0 badges
        under_gate = extract_player_disposition_and_residuals(
            rows[:20], current_elo=1650.0, peak_elo=1690.0, matches_played=20, game_system="40k", reference_date=ref_date
        )
        self.assertEqual(under_gate["disposition"]["badges"], [])

        # >= 25 competitive games -> earns Giant-Slayer, capped at max 2 badges
        over_gate = extract_player_disposition_and_residuals(
            rows, current_elo=1650.0, peak_elo=1690.0, matches_played=30, game_system="40k", reference_date=ref_date
        )
        badges = over_gate["disposition"]["badges"]
        self.assertGreaterEqual(len(badges), 1)
        self.assertLessEqual(len(badges), 2)
        badge_ids = {b["id"] for b in badges}
        self.assertIn("giant_slayer", badge_ids)

    def test_telescoping_attributions_sum_to_win_share_shift(self):
        spec = self._synthetic_ml_spec("40k")
        p1 = {
            "elo": 1910.0, "games": 80, "uncertainty_sq": 0.13, "peak_gap": -10.0,
            "recent_form_ewma": 0.09, "own_fac_res": 0.08, "own_fac_games": 35,
            "vs_fac_res": 0.05, "giant_slayer_res": 0.02, "gatekeeper_res": 0.06, "volatility_z": 0.2,
        }
        p2 = {
            "elo": 1740.0, "games": 50, "uncertainty_sq": 0.19, "peak_gap": -40.0,
            "recent_form_ewma": -0.04, "own_fac_res": -0.02, "own_fac_games": 12,
            "vs_fac_res": -0.03, "giant_slayer_res": 0.04, "gatekeeper_res": 0.0, "volatility_z": -0.1,
        }
        macro = {"is_mirror": False, "f1_alpha": 0.05, "f2_alpha": -0.03, "matchup_alpha": 0.06, "matchup_games": 60}
        res = predict_1v1_matchup(spec, p1, p2, macro, direct_h2h_res=0.04, direct_h2h_games=4)
        total_shift = sum(a["prob_shift_pct"] for a in res["factor_attributions"])
        expected_shift = res["p1_win_share"] - 50.0
        self.assertAlmostEqual(total_shift, expected_shift, delta=0.25)

    def test_phase2_universal_rollout_across_all_prediction_surfaces(self):
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

        # 1. Verify shared client-side ML runtime & integration across all 5 web apps
        with open(os.path.join(repo_root, "web", "js", "ml_predictor_runtime.js"), "r", encoding="utf-8") as f:
            runtime_js = f.read()
        self.assertIn("computeCalibratedMlMatchupClient", runtime_js)
        self.assertIn("ensureMlModelSpec", runtime_js)
        self.assertIn("buildMlFactorAttributionHtml", runtime_js)

        for rel_path in [
            ("web", "js", "predictor.js"),
            ("web", "js", "tournaments.js"),
            ("web", "js", "eventstudio.js"),
            ("web", "team_pairings", "app.js"),
            ("web", "overlay.html"),
        ]:
            with open(os.path.join(repo_root, *rel_path), "r", encoding="utf-8") as f:
                content = f.read()
            self.assertIn("computeCalibratedMlMatchupClient", content, f"Missing ML runtime call in {rel_path}")

        with open(os.path.join(repo_root, "web", "team_pairings", "index.html"), "r", encoding="utf-8") as f:
            tp_html = f.read()
        self.assertIn("/js/ml_predictor_runtime.js", tp_html)

        # 2. Verify EloEngine.predict_matchup promotes ML win-shares while keeping Elo Stakes pure Elo
        eng = EloEngine(MagicMock())
        quick_res = eng.predict_matchup(1850.0, 1650.0, game_system="40k", p1_faction="Aeldari", p2_faction="Orks")
        self.assertAlmostEqual(quick_res["p1_win_prob"] + quick_res["p2_win_prob"], 100.0, places=1)
        self.assertIn("ml_prediction", quick_res)
        self.assertIn("projected", quick_res)
        pure_e1 = 1.0 / (1.0 + 10.0 ** ((1650.0 - 1850.0) / 400.0))
        self.assertAlmostEqual(quick_res["deltas"]["p1_win"], round(32.0 * (1.0 - pure_e1), 1), places=1)

        # 3. Verify WTC Team Pairings Engine (FirestoreRoomEngine.predict_matchup_outcome) antisymmetry & ML schema
        from firestore_db import FirestoreRoomEngine
        pa = {"id": "A1", "name": "Alpha", "faction": "Aeldari", "elo": 1920, "matches_played": 40}
        pb = {"id": "B1", "name": "Bravo", "faction": "Astra Militarum", "elo": 1760, "matches_played": 35}
        wtc_ab = FirestoreRoomEngine.predict_matchup_outcome(pa, pb)
        wtc_ba = FirestoreRoomEngine.predict_matchup_outcome(pb, pa)
        self.assertEqual(wtc_ab["wtc_score_a"] + wtc_ab["wtc_score_b"], 20)
        self.assertEqual(wtc_ab["wtc_score_a"], wtc_ba["wtc_score_b"])
        self.assertEqual(wtc_ab["win_prob_a"] + wtc_ab["win_prob_b"], 100)
        self.assertIn("model_mode", wtc_ab)
        self.assertIn("factor_attributions", wtc_ab)
        self.assertEqual(len(wtc_ab["factor_attributions"]), 5)

        # 4. Verify Batch Pairing Predictor & EventStudio pairing enrichment
        from predictor_model import predict_batch_matchups
        batch_pairs = [
            {"p1_id": "", "p2_id": "", "p1_elo": 1800, "p2_elo": 1600, "p1_faction": "Orks", "p2_faction": "Necrons"},
            {"p1_id": "", "p2_id": "", "p1_elo": 1550, "p2_elo": 0, "is_bye": True},
        ]
        batch_preds = predict_batch_matchups(None, batch_pairs, game_system="40k")
        self.assertEqual(len(batch_preds), 2)
        self.assertGreater(batch_preds[0]["p1_win_share"], 55.0)
        self.assertTrue(batch_preds[1]["is_bye"])
        self.assertEqual(batch_preds[1]["p1_win_share"], 100.0)

    def test_elo_engine_predict_match_attaches_ml_prediction_and_disposition(self):
        mock_db = MagicMock()
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_db.get_connection.return_value.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value.__enter__.return_value = mock_cur

        p1_row = {
            "player_id": "p1_id",
            "player_name": "Jun Hsieh",
            "current_elo": 1820.0,
            "peak_elo": 1850.0,
            "matches_played": 32,
            "wins": 22,
            "losses": 10,
            "draws": 0,
            "win_rate": 68.8,
            "top_faction": "Aeldari",
            "team": "Team SD",
        }
        p2_row = {
            "player_id": "p2_id",
            "player_name": "Rival Pilot",
            "current_elo": 1690.0,
            "peak_elo": 1730.0,
            "matches_played": 28,
            "wins": 16,
            "losses": 12,
            "draws": 0,
            "win_rate": 57.1,
            "top_faction": "Orks",
            "team": "Rivals",
        }
        mock_cur.fetchone.side_effect = [p1_row, p2_row]

        hist_rows = []
        for i in range(28):
            hist_rows.append({
                "player_id": "p1_id",
                "match_id": f"m_{i}",
                "event_id": f"ev_{i // 5}",
                "round": (i % 5) + 1,
                "match_date": f"2026-09-{(i % 28) + 1:02d}",
                "result": "W" if i < 20 else "L",
                "old_elo": 1760.0,
                "opponent_elo": 1880.0 if i < 10 else 1740.0,
                "delta_elo": 16.0 if i < 20 else -12.0,
                "player_score": 88,
                "opponent_score": 64,
                "player_faction": "Aeldari",
                "opponent_id": f"opp_{i}",
                "opponent_name": f"Opp {i}",
                "opponent_faction": "Orks",
                "event_name": "SoCal Open",
                "is_league": False,
                "structure_tag": "singles",
                "format_tag": "strike_force_2000",
            })
        mock_cur.fetchall.return_value = hist_rows
        mock_db.get_head_to_head.return_value = []
        mock_db.get_faction_meta_stats.return_value = {
            "factions": [
                {"faction": "Aeldari", "total_matches": 400, "total_wins": 220, "total_losses": 175, "total_draws": 5, "win_rate": 55.0},
                {"faction": "Orks", "total_matches": 500, "total_wins": 255, "total_losses": 240, "total_draws": 5, "win_rate": 51.0},
            ]
        }
        mock_db.get_faction_details.side_effect = [
            {
                "stats": {"total_matches": 400, "total_wins": 220, "total_losses": 175, "total_draws": 5, "win_rate": 55.0},
                "matchups": [{"opponent_faction": "Orks", "matches_played": 45, "wins": 27, "losses": 17, "draws": 1}],
            },
            {
                "stats": {"total_matches": 500, "total_wins": 255, "total_losses": 240, "total_draws": 5, "win_rate": 51.0},
                "matchups": [{"opponent_faction": "Aeldari", "matches_played": 45, "wins": 17, "losses": 27, "draws": 1}],
            },
        ]

        engine = EloEngine(mock_db)
        out = engine.predict_match_outcome("p1_id", "p2_id", game_system="40k")

        self.assertIn("ml_prediction", out)
        self.assertIn("ml_client_spec", out)
        self.assertIn("competitive_alpha_90d", out)
        self.assertIn("multi_factor_prediction", out)  # Legacy payload preserved
        ml = out["ml_prediction"]
        self.assertAlmostEqual(ml["p1_win_prob"] + ml["draw_prob"] + ml["p2_win_prob"], 100.0, places=4)
        self.assertGreater(ml["p1_win_prob"], ml["p2_win_prob"])
        self.assertEqual(len(ml["factor_attributions"]), 5)
        self.assertIn("disposition", out["p1_profile"])
        self.assertIn("ml_features", out["p1_profile"])
        self.assertGreaterEqual(len(out["p1_profile"]["disposition"]["badges"]), 1)


if __name__ == "__main__":
    unittest.main()
