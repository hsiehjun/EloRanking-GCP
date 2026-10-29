#!/usr/bin/env python3
"""
Chronological Point-in-Time ML Match Predictor Trainer & Walk-Forward Benchmark.

Streams clean competitive 1v1 matches per game system in strict chronological order
(`match_date ASC, id ASC`), extracts leak-free pre-match features, evaluates:
  1. Pure Pre-Match Elo
  2. Legacy 6-Factor Heuristic Adjusted Elo
  3. Mode 2: Uncertainty-Calibrated Elo + Davidson 3-Way Draw Head
  4. Mode 1: Symmetrized Monotonic HistGradientBoosting + Platt/Davidson Calibrator + Margin GBDT

Enforces an automatic out-of-time promotion gate: a high-volume system (`N >= 25,000`)
only promotes to `dedicated_ml` if it beats BOTH Pure Elo and Mode 2 Calibrated Elo
on out-of-time Log-Loss and Brier Score. Persists the verified JSON bundle + benchmark
scorecard to Postgres (`ml_predictor_models`) and optionally to `--output` JSON.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from predictor_model import (
    DRAW_HEAVY_WARGAMES,
    FEATURE_NAMES,
    MODEL_SCHEMA_VERSION,
    MONOTONIC_CONSTRAINTS,
    NON_COMPETITIVE_STRUCTURES,
    NON_STANDARD_SMALL_FORMATS,
    TCG_SYSTEMS,
    _eval_single_tree,
    build_directional_feature_vector,
    compute_rating_uncertainty_sq,
    default_mode2_system_spec,
    default_system_scoring_profile,
    eval_symmetric_davidson,
    expected_elo_prob,
    invalidate_model_bundle_cache,
    normalize_faction_key,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("train_match_predictor")


def _export_hgbt_trees(estimator: Any) -> Tuple[float, List[Dict[str, Any]]]:
    """Exports scikit-learn HistGradientBoosting trees into exact IEEE-754 pure-Python/JS JSON arrays."""
    import numpy as np

    baseline = float(np.asarray(estimator._baseline_prediction).ravel()[0])
    trees_out: List[Dict[str, Any]] = []
    for iter_predictors in estimator._predictors:
        tree_pred = iter_predictors[0]
        nodes = tree_pred.nodes
        f_list: List[int] = []
        t_list: List[float] = []
        l_list: List[int] = []
        r_list: List[int] = []
        v_list: List[float] = []
        for nd in nodes:
            if int(nd["is_leaf"]) == 1:
                f_list.append(-1)
                t_list.append(0.0)
                l_list.append(0)
                r_list.append(0)
                v_list.append(float(nd["value"]))
            else:
                f_list.append(int(nd["feature_idx"]))
                t_list.append(float(nd["num_threshold"]))
                l_list.append(int(nd["left"]))
                r_list.append(int(nd["right"]))
                v_list.append(0.0)
        trees_out.append({"f": f_list, "t": t_list, "l": l_list, "r": r_list, "v": v_list})
    return baseline, trees_out


def _verify_exported_trees(estimator: Any, base_score: float, trees: List[Dict[str, Any]], X_sample: Any) -> None:
    import numpy as np

    if len(X_sample) == 0:
        return
    # Verify exact parity after full JSON round-trip serialization
    rt_payload = json.loads(json.dumps({"b": base_score, "t": trees}))
    rt_base = float(rt_payload["b"])
    rt_trees = rt_payload["t"]
    check_n = min(256, len(X_sample))
    sk_raw = np.asarray(estimator._raw_predict(X_sample[:check_n])).ravel()
    max_err = 0.0
    for i in range(check_n):
        row_list = [float(v) for v in X_sample[i]]
        py_raw = rt_base + sum(_eval_single_tree(t, row_list) for t in rt_trees)
        err = abs(py_raw - float(sk_raw[i]))
        if err > max_err:
            max_err = err
    if max_err > 1e-7:
        raise RuntimeError(f"Exported tree verification failed: max_err={max_err:.9f}")


def _compute_metrics(y_outcomes: List[float], p1_win_shares: List[float], p1_3way: Optional[List[Tuple[float, float, float]]] = None) -> Dict[str, float]:
    """
    Computes binary/fractional Win-Share Log-Loss, Brier Score, Accuracy (non-draw),
    and 10-bin Expected Calibration Error (ECE).
    """
    n = len(y_outcomes)
    if n == 0:
        return {"n": 0, "log_loss": 0.69315, "brier": 0.25, "ece": 0.0, "accuracy": 0.5}

    eps = 1e-6
    ll_sum = 0.0
    brier_sum = 0.0
    correct = 0
    decisive_n = 0

    bin_counts = [0] * 10
    bin_pred_sum = [0.0] * 10
    bin_act_sum = [0.0] * 10

    ll_3way_sum = 0.0
    for idx, (y, p_raw) in enumerate(zip(y_outcomes, p1_win_shares)):
        p = max(eps, min(1.0 - eps, float(p_raw)))
        ll_sum += -(y * math.log(p) + (1.0 - y) * math.log(1.0 - p))
        brier_sum += (p - y) ** 2

        if y != 0.5:
            decisive_n += 1
            if (p > 0.5 and y == 1.0) or (p < 0.5 and y == 0.0):
                correct += 1
            elif p == 0.5:
                correct += 0.5

        b_idx = min(9, max(0, int(p * 10.0)))
        bin_counts[b_idx] += 1
        bin_pred_sum[b_idx] += p
        bin_act_sum[b_idx] += y

        if p1_3way is not None:
            pw, pd, pl = p1_3way[idx]
            if y == 1.0:
                ll_3way_sum += -math.log(max(eps, pw))
            elif y == 0.0:
                ll_3way_sum += -math.log(max(eps, pl))
            else:
                ll_3way_sum += -math.log(max(eps, pd if pd > 1e-5 else 0.5 * (pw + pl)))

    ece = 0.0
    for b_i in range(10):
        if bin_counts[b_i] > 0:
            avg_p = bin_pred_sum[b_i] / bin_counts[b_i]
            avg_y = bin_act_sum[b_i] / bin_counts[b_i]
            ece += (bin_counts[b_i] / float(n)) * abs(avg_p - avg_y)

    out = {
        "n": n,
        "log_loss": round(ll_sum / n, 5),
        "brier": round(brier_sum / n, 5),
        "ece": round(ece, 5),
        "accuracy": round((correct / decisive_n) * 100.0, 2) if decisive_n > 0 else 50.0,
    }
    if p1_3way is not None:
        out["log_loss_3way"] = round(ll_3way_sum / n, 5)
    return out


class RollingSystemReplay:
    """Maintains strictly pre-match rolling state during chronological walk-forward replay."""

    def __init__(self, game_system: str, half_life_days: float = 75.0):
        self.game_system = game_system
        self.half_life_days = half_life_days
        self.norm_std = default_system_scoring_profile(game_system)["margin_std"]

        # Per-player state
        self.p_games: Dict[str, int] = {}
        self.p_last_date: Dict[str, date] = {}
        self.p_peak_elo: Dict[str, float] = {}
        self.p_ewma_form: Dict[str, float] = {}
        self.p_own_fac: Dict[Tuple[str, str], List[float]] = {}   # [res_sum, games, wins_equiv]
        self.p_vs_fac: Dict[Tuple[str, str], List[float]] = {}    # [res_sum, games, wins_equiv]
        self.p_underdog: Dict[str, List[float]] = {}              # [res_sum, n]
        self.p_favorite: Dict[str, List[float]] = {}              # [res_sum, n]
        self.p_margin_stats: Dict[str, List[float]] = {}          # [n, mean, m2] Welford
        self.h2h_pair: Dict[Tuple[str, str], List[float]] = {}    # canonical (lo, hi) -> [lo_res_sum, n, lo_wins_diff]

        # Global decayed macro faction & matchup state
        self.macro_last_date: Optional[date] = None
        self.fac_state: Dict[str, List[float]] = {}               # [w_res, w_n, raw_w_wins, raw_w_n]
        self.mu_state: Dict[Tuple[str, str], List[float]] = {}    # canonical (f_lo, f_hi) -> [lo_res, w_n, lo_raw_wins]

        # Empirical score accumulator
        self.score_totals: List[float] = []
        self.score_margins: List[float] = []

    def _decay_macro_to(self, cur_dt: date) -> None:
        if self.macro_last_date is None:
            self.macro_last_date = cur_dt
            return
        delta_days = (cur_dt - self.macro_last_date).days
        if delta_days <= 0:
            return
        factor = math.pow(0.5, float(delta_days) / self.half_life_days)
        for st in self.fac_state.values():
            st[0] *= factor
            st[1] *= factor
            st[2] *= factor
            st[3] *= factor
        for mst in self.mu_state.values():
            mst[0] *= factor
            mst[1] *= factor
            mst[2] *= factor
        self.macro_last_date = cur_dt

    def _player_vol_z(self, pid: str) -> float:
        ms = self.p_margin_stats.get(pid)
        if not ms or ms[0] < 8:
            return 0.0
        var = ms[2] / ms[0]
        std = math.sqrt(max(0.0, var))
        return max(-2.5, min(2.5, (std - 1.0) / 0.28))

    def process_match(
        self,
        m_dt: date,
        p1_id: str,
        p2_id: str,
        r1: float,
        r2: float,
        f1_raw: str,
        f2_raw: str,
        s_outcome: float,
        sc1: Optional[float],
        sc2: Optional[float],
    ) -> Tuple[List[float], List[float], float, float, Optional[float]]:
        """
        Extracts (x_ab, x_ba, avg_vol_z, legacy_6f_prob, raw_margin) strictly BEFORE updating state,
        then updates rolling state with the match outcome.
        """
        self._decay_macro_to(m_dt)

        nk1 = normalize_faction_key(f1_raw)
        nk2 = normalize_faction_key(f2_raw)
        is_mirror = bool(nk1 and nk2 and nk1 == nk2)

        g1 = self.p_games.get(p1_id, 0)
        g2 = self.p_games.get(p2_id, 0)
        d1 = float((m_dt - self.p_last_date[p1_id]).days) if p1_id in self.p_last_date else 45.0
        d2 = float((m_dt - self.p_last_date[p2_id]).days) if p2_id in self.p_last_date else 45.0
        unc1 = compute_rating_uncertainty_sq(g1, max(0.0, d1))
        unc2 = compute_rating_uncertainty_sq(g2, max(0.0, d2))

        pk1 = max(r1, self.p_peak_elo.get(p1_id, r1))
        pk2 = max(r2, self.p_peak_elo.get(p2_id, r2))
        pg1 = r1 - pk1
        pg2 = r2 - pk2

        fm1 = self.p_ewma_form.get(p1_id, 0.0)
        fm2 = self.p_ewma_form.get(p2_id, 0.0)

        fs1 = self.fac_state.get(nk1) if nk1 else None
        fs2 = self.fac_state.get(nk2) if nk2 else None
        f1_alpha = (fs1[0] / (fs1[1] + 75.0)) if fs1 else 0.0
        f2_alpha = (fs2[0] / (fs2[1] + 75.0)) if fs2 else 0.0

        mu_alpha = 0.0
        h2h_f_w1 = 0.0
        h2h_f_tot = 0.0
        if nk1 and nk2 and not is_mirror:
            if nk1 < nk2:
                ms = self.mu_state.get((nk1, nk2))
                if ms:
                    mu_alpha = ms[0] / (ms[1] + 35.0)
                    h2h_f_tot = ms[1]
                    h2h_f_w1 = ms[2]
            else:
                ms = self.mu_state.get((nk2, nk1))
                if ms:
                    mu_alpha = -ms[0] / (ms[1] + 35.0)
                    h2h_f_tot = ms[1]
                    h2h_f_w1 = ms[1] - ms[2]

        ob1 = self.p_own_fac.get((p1_id, nk1)) if nk1 else None
        ob2 = self.p_own_fac.get((p2_id, nk2)) if nk2 else None
        own_res1 = (ob1[0] / (ob1[1] + 12.0)) if ob1 else 0.0
        own_res2 = (ob2[0] / (ob2[1] + 12.0)) if ob2 else 0.0
        own_g1 = int(ob1[1]) if ob1 else 0
        own_g2 = int(ob2[1]) if ob2 else 0

        vb1 = self.p_vs_fac.get((p1_id, nk2)) if nk2 else None
        vb2 = self.p_vs_fac.get((p2_id, nk1)) if nk1 else None
        vs_res1 = (vb1[0] / (vb1[1] + 12.0)) if vb1 else 0.0
        vs_res2 = (vb2[0] / (vb2[1] + 12.0)) if vb2 else 0.0

        if p1_id <= p2_id:
            hp = self.h2h_pair.get((p1_id, p2_id))
            h2h_res = (hp[0] / (hp[1] + 5.0)) if hp else 0.0
            h2h_w_diff = hp[2] if hp else 0.0
            h2h_n = hp[1] if hp else 0.0
        else:
            hp = self.h2h_pair.get((p2_id, p1_id))
            h2h_res = (-hp[0] / (hp[1] + 5.0)) if hp else 0.0
            h2h_w_diff = -hp[2] if hp else 0.0
            h2h_n = hp[1] if hp else 0.0

        ud1 = self.p_underdog.get(p1_id)
        fv1 = self.p_favorite.get(p1_id)
        ud2 = self.p_underdog.get(p2_id)
        fv2 = self.p_favorite.get(p2_id)
        gs1 = (ud1[0] / (ud1[1] + 6.0)) if ud1 else 0.0
        gk1 = (fv1[0] / (fv1[1] + 6.0)) if fv1 else 0.0
        gs2 = (ud2[0] / (ud2[1] + 6.0)) if ud2 else 0.0
        gk2 = (fv2[0] / (fv2[1] + 6.0)) if fv2 else 0.0

        vol1 = self._player_vol_z(p1_id)
        vol2 = self._player_vol_z(p2_id)
        avg_vol = 0.5 * (vol1 + vol2)

        x_ab = build_directional_feature_vector(
            r_a=r1, r_b=r2, games_a=g1, games_b=g2, unc_sq_a=unc1, unc_sq_b=unc2,
            peak_gap_a=pg1, peak_gap_b=pg2, form_a=fm1, form_b=fm2,
            fac_alpha_a=f1_alpha, fac_alpha_b=f2_alpha, matchup_alpha_ab=mu_alpha, is_mirror=is_mirror,
            own_fac_res_a=own_res1, own_fac_res_b=own_res2, own_fac_g_a=own_g1, own_fac_g_b=own_g2,
            vs_fac_res_a=vs_res1, vs_fac_res_b=vs_res2, direct_h2h_res_ab=h2h_res,
            giant_slayer_a=gs1, gatekeeper_a=gk1, giant_slayer_b=gs2, gatekeeper_b=gk2,
        )
        x_ba = build_directional_feature_vector(
            r_a=r2, r_b=r1, games_a=g2, games_b=g1, unc_sq_a=unc2, unc_sq_b=unc1,
            peak_gap_a=pg2, peak_gap_b=pg1, form_a=fm2, form_b=fm1,
            fac_alpha_a=f2_alpha, fac_alpha_b=f1_alpha, matchup_alpha_ab=-mu_alpha, is_mirror=is_mirror,
            own_fac_res_a=own_res2, own_fac_res_b=own_res1, own_fac_g_a=own_g2, own_fac_g_b=own_g1,
            vs_fac_res_a=vs_res2, vs_fac_res_b=vs_res1, direct_h2h_res_ab=-h2h_res,
            giant_slayer_a=gs2, gatekeeper_a=gk2, giant_slayer_b=gs1, gatekeeper_b=gk1,
        )

        # Point-in-time Legacy 6-Factor Heuristic Adjusted Elo for exact head-to-head comparison
        leg_fac_h2h = 0.0
        if not is_mirror and h2h_f_tot > 0.5:
            leg_fac_h2h = max(-75.0, min(75.0, ((h2h_f_w1 - 0.5 * h2h_f_tot) / (h2h_f_tot + 35.0)) * 350.0))
        leg_fac_meta = 0.0
        if not is_mirror and (fs1 or fs2):
            adj1 = 0.5 + (((fs1[2] / fs1[3]) - 0.5) * (fs1[3] / (fs1[3] + 100.0))) if fs1 and fs1[3] > 0 else 0.5
            adj2 = 0.5 + (((fs2[2] / fs2[3]) - 0.5) * (fs2[3] / (fs2[3] + 100.0))) if fs2 and fs2[3] > 0 else 0.5
            leg_fac_meta = max(-40.0, min(40.0, (adj1 - adj2) * 250.0))
        leg_own1 = (((ob1[2] - 0.5 * ob1[1]) / (ob1[1] + 10.0)) * 140.0) if ob1 and ob1[1] > 0 else 0.0
        leg_own2 = (((ob2[2] - 0.5 * ob2[1]) / (ob2[1] + 10.0)) * 140.0) if ob2 and ob2[1] > 0 else 0.0
        leg_own_d = max(-55.0, min(55.0, leg_own1 - leg_own2))
        leg_vs1 = (((vb1[2] - 0.5 * vb1[1]) / (vb1[1] + 10.0)) * 130.0) if vb1 and vb1[1] > 0 else 0.0
        leg_vs2 = (((vb2[2] - 0.5 * vb2[1]) / (vb2[1] + 10.0)) * 130.0) if vb2 and vb2[1] > 0 else 0.0
        leg_vs_d = max(-45.0, min(45.0, leg_vs1 - leg_vs2))
        leg_h2h_d = max(-35.0, min(35.0, (h2h_w_diff / (h2h_n + 4.0)) * 90.0)) if h2h_n > 0 else 0.0
        leg_eff_delta = (r1 - r2) + leg_fac_h2h + leg_fac_meta + leg_own_d + leg_vs_d + leg_h2h_d
        leg_prob = max(0.05, min(0.95, 1.0 / (1.0 + math.pow(10.0, -leg_eff_delta / 400.0))))

        raw_margin: Optional[float] = None
        if sc1 is not None and sc2 is not None:
            tot_sc = sc1 + sc2
            diff_sc = sc1 - sc2
            if 0.0 <= tot_sc <= 300.0 and abs(diff_sc) <= 150.0:
                raw_margin = diff_sc
                if len(self.score_totals) < 120000:
                    self.score_totals.append(tot_sc)
                    self.score_margins.append(diff_sc)

        # ---- UPDATE STATE STRICTLY AFTER FEATURE EXTRACTION ----
        exp1 = expected_elo_prob(r1, r2)
        res1 = s_outcome - exp1
        res2 = -res1

        self.p_games[p1_id] = g1 + 1
        self.p_games[p2_id] = g2 + 1
        self.p_last_date[p1_id] = m_dt
        self.p_last_date[p2_id] = m_dt
        self.p_peak_elo[p1_id] = pk1
        self.p_peak_elo[p2_id] = pk2
        self.p_ewma_form[p1_id] = 0.85 * fm1 + 0.15 * res1
        self.p_ewma_form[p2_id] = 0.85 * fm2 + 0.15 * res2

        if nk1:
            b = self.p_own_fac.setdefault((p1_id, nk1), [0.0, 0.0, 0.0])
            b[0] += res1
            b[1] += 1.0
            b[2] += s_outcome
            fb = self.fac_state.setdefault(nk1, [0.0, 0.0, 0.0, 0.0])
            fb[0] += res1
            fb[1] += 1.0
            fb[2] += s_outcome
            fb[3] += 1.0
        if nk2:
            b = self.p_own_fac.setdefault((p2_id, nk2), [0.0, 0.0, 0.0])
            b[0] += res2
            b[1] += 1.0
            b[2] += (1.0 - s_outcome)
            fb = self.fac_state.setdefault(nk2, [0.0, 0.0, 0.0, 0.0])
            fb[0] += res2
            fb[1] += 1.0
            fb[2] += (1.0 - s_outcome)
            fb[3] += 1.0

        if nk1 and nk2 and not is_mirror:
            # Pure matchup residual net of marginal faction alphas
            pure_mu_res1 = res1 - (f1_alpha - f2_alpha)
            if nk1 < nk2:
                mb = self.mu_state.setdefault((nk1, nk2), [0.0, 0.0, 0.0])
                mb[0] += pure_mu_res1
                mb[1] += 1.0
                mb[2] += s_outcome
            else:
                mb = self.mu_state.setdefault((nk2, nk1), [0.0, 0.0, 0.0])
                mb[0] -= pure_mu_res1
                mb[1] += 1.0
                mb[2] += (1.0 - s_outcome)

        if nk2:
            vb = self.p_vs_fac.setdefault((p1_id, nk2), [0.0, 0.0, 0.0])
            vb[0] += res1
            vb[1] += 1.0
            vb[2] += s_outcome
        if nk1:
            vb = self.p_vs_fac.setdefault((p2_id, nk1), [0.0, 0.0, 0.0])
            vb[0] += res2
            vb[1] += 1.0
            vb[2] += (1.0 - s_outcome)

        if p1_id <= p2_id:
            hb = self.h2h_pair.setdefault((p1_id, p2_id), [0.0, 0.0, 0.0])
            hb[0] += res1
            hb[1] += 1.0
            hb[2] += (2.0 * s_outcome - 1.0)
        else:
            hb = self.h2h_pair.setdefault((p2_id, p1_id), [0.0, 0.0, 0.0])
            hb[0] += res2
            hb[1] += 1.0
            hb[2] += (1.0 - 2.0 * s_outcome)

        if r1 - r2 <= -100.0:
            ub = self.p_underdog.setdefault(p1_id, [0.0, 0.0])
            ub[0] += res1
            ub[1] += 1.0
            fvb = self.p_favorite.setdefault(p2_id, [0.0, 0.0])
            fvb[0] += res2
            fvb[1] += 1.0
        elif r1 - r2 >= 100.0:
            fvb = self.p_favorite.setdefault(p1_id, [0.0, 0.0])
            fvb[0] += res1
            fvb[1] += 1.0
            ub = self.p_underdog.setdefault(p2_id, [0.0, 0.0])
            ub[0] += res2
            ub[1] += 1.0

        if raw_margin is not None:
            for pid, m_val in ((p1_id, raw_margin / self.norm_std), (p2_id, -raw_margin / self.norm_std)):
                ms = self.p_margin_stats.setdefault(pid, [0.0, 0.0, 0.0])
                ms[0] += 1.0
                delta = m_val - ms[1]
                ms[1] += delta / ms[0]
                ms[2] += delta * (m_val - ms[1])

        return x_ab, x_ba, avg_vol, leg_prob, raw_margin


def _fit_platt_scale(raw_sym_logits: Any, y_val: Any, x1_val: Any) -> Tuple[float, float]:
    """Fits temperature scale + optional attenuated-Elo anchor via L2-regularized Newton-Raphson."""
    import numpy as np

    n = len(y_val)
    if n < 50:
        return 1.0, 0.0
    # Design matrix [raw_sym_logits, x1_val] without intercept (preserves exact 0 -> 50% symmetry!)
    Z = np.column_stack([raw_sym_logits, x1_val])
    w = np.array([1.0, 0.0], dtype=np.float64)
    prior_w = np.array([1.0, 0.0], dtype=np.float64)
    reg = 2.0
    for _ in range(18):
        eta = np.clip(Z @ w, -8.0, 8.0)
        p = 1.0 / (1.0 + np.exp(-eta))
        grad = Z.T @ (p - y_val) + reg * (w - prior_w)
        weight_diag = p * (1.0 - p)
        hess = (Z.T * weight_diag) @ Z + reg * np.eye(2)
        try:
            step = np.linalg.solve(hess, grad)
        except np.linalg.LinAlgError:
            break
        w -= step
        if float(np.max(np.abs(step))) < 1e-5:
            break
    scale = float(max(0.25, min(2.0, w[0])))
    anchor = float(max(-0.5, min(0.8, w[1])))
    return round(scale, 5), round(anchor, 5)


def _fit_mode2_linear_weights(X_ab: Any, X_ba: Any, y: Any, is_tcg: bool) -> List[float]:
    """Fits antisymmetric L2-regularized logistic weights for Mode 2 (Uncertainty-Calibrated Elo + Residuals)."""
    import numpy as np

    # Antisymmetric feature differences: 0.5 * (X_ab - X_ba) on active indices [1, 3, 4, 5, 6, 7, 9, 11, 12, 13]
    active_cols = [1, 3, 4, 5, 6, 7, 9, 11, 12, 13]
    D = 0.5 * (X_ab[:, active_cols] - X_ba[:, active_cols])
    prior = np.array([
        0.88 if is_tcg else 0.98,
        0.02, 0.03, 0.30,
        1.25 if is_tcg else 1.05,
        1.45 if is_tcg else 1.20,
        0.75, 0.55, 0.65, 0.35,
    ], dtype=np.float64)
    if len(y) < 300:
        out = [0.0] * 14
        for idx_c, pv in zip(active_cols, prior):
            out[idx_c] = round(float(pv), 5)
        return out

    w = prior.copy()
    reg = 25.0
    for _ in range(20):
        eta = np.clip(D @ w, -8.0, 8.0)
        p = 1.0 / (1.0 + np.exp(-eta))
        grad = D.T @ (p - y) + reg * (w - prior)
        hess = (D.T * (p * (1.0 - p))) @ D + reg * np.eye(len(active_cols))
        try:
            step = np.linalg.solve(hess, grad)
        except np.linalg.LinAlgError:
            break
        w -= step
        if float(np.max(np.abs(step))) < 1e-5:
            break

    # Enforce non-negative monotonic signs on skill/meta/mastery weights
    for k_i in (0, 3, 4, 5, 6, 7, 8, 9):
        w[k_i] = max(0.0, w[k_i])
    w[0] = max(0.45, min(1.45, w[0]))

    full_w = [0.0] * 14
    for idx_c, val in zip(active_cols, w):
        full_w[idx_c] = round(float(val), 5)
    return full_w


def _calibrate_davidson_nu0(logits_val: Any, y_val: Any, gap_decay: float = 0.55) -> float:
    """Matches empirical validation draw rate via Davidson's parameter nu_0."""
    import numpy as np

    if len(y_val) == 0:
        return 0.02
    draw_mask = (np.abs(y_val - 0.5) < 1e-4)
    emp_draw_rate = float(np.mean(draw_mask))
    if emp_draw_rate <= 0.0015:
        return 0.0

    lo, hi = 0.0, 1.5
    abs_l = np.abs(logits_val)
    half_l = 0.5 * logits_val
    two_cosh = np.exp(half_l) + np.exp(-half_l)
    decay_term = np.exp(-gap_decay * abs_l)
    for _ in range(28):
        mid = 0.5 * (lo + hi)
        nu_vec = mid * decay_term
        pred_dr = float(np.mean(nu_vec / (two_cosh + nu_vec)))
        if pred_dr < emp_draw_rate:
            lo = mid
        else:
            hi = mid
    return round(0.5 * (lo + hi), 5)


def train_and_evaluate_system(
    conn: Any,
    game_system: str,
    min_ml_matches: int = 25000,
    max_matches: int = 400000,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Streams chronological matches for `game_system`, trains Mode 2 & Mode 1, and gates promotion."""
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor

    t0 = time.perf_counter()
    sys_norm = game_system.strip().lower()
    is_tcg = sys_norm in TCG_SYSTEMS
    half_life = 55.0 if is_tcg else 75.0

    # Determine cutoff date if system exceeds max_matches (e.g., 40k 12.4M -> modern competitive window)
    min_date_filter = "2016-01-01"
    with conn.cursor() as c_cnt:
        c_cnt.execute("SET LOCAL statement_timeout = '90000ms';")
        if sys_norm == "40k":
            min_date_filter = (datetime.now(timezone.utc).date() - timedelta(days=540)).strftime("%Y-%m-%d")
        elif sys_norm in ("mtg", "lorcana", "pokemon", "sw_unlimited"):
            min_date_filter = (datetime.now(timezone.utc).date() - timedelta(days=730)).strftime("%Y-%m-%d")

    replay = RollingSystemReplay(sys_norm, half_life_days=half_life)

    X_ab_rows: List[List[float]] = []
    X_ba_rows: List[List[float]] = []
    vol_rows: List[float] = []
    y_rows: List[float] = []
    pure_elo_probs: List[float] = []
    legacy_6f_probs: List[float] = []
    margins_raw: List[Optional[float]] = []

    c_name = f"ml_replay_{sys_norm}_{int(time.time()) % 100000}"
    with conn.cursor(name=c_name) as sc:
        sc.itersize = 10000
        sc.execute(
            """
            SELECT
                rh.match_date,
                rh.player_id,
                rh.opponent_id,
                rh.old_elo,
                rh.opponent_elo,
                rh.result,
                rh.player_faction,
                rh.opponent_faction,
                rh.player_score,
                rh.opponent_score,
                rh.round,
                COALESCE(e.is_league, FALSE) AS is_league,
                COALESCE(e.structure_tag, 'singles') AS structure_tag,
                COALESCE(e.format_tag, 'standard') AS format_tag
            FROM rating_history rh
            LEFT JOIN events e ON rh.event_id = e.id
            WHERE COALESCE(rh.game_system, '40k') = %s
              AND rh.match_date >= %s
              AND rh.opponent_id IS NOT NULL
              AND rh.opponent_id <> ''
              AND rh.player_id < rh.opponent_id
            ORDER BY rh.match_date ASC, rh.id ASC;
            """,
            (sys_norm, min_date_filter),
        )
        while True:
            batch = sc.fetchmany(10000)
            if not batch:
                break
            for row in batch:
                (
                    m_dt_raw, p1_id, p2_id, r1_raw, r2_raw, res_raw,
                    f1_raw, f2_raw, sc1_raw, sc2_raw, rnd_raw,
                    is_lg, st_tag, fmt_tag,
                ) = row
                if is_lg:
                    continue
                st_l = str(st_tag or "singles").strip().lower()
                if st_l in NON_COMPETITIVE_STRUCTURES:
                    continue
                fmt_l = str(fmt_tag or "").strip().lower()
                if fmt_l in NON_STANDARD_SMALL_FORMATS:
                    continue

                res_c = str(res_raw or "").strip().upper()
                if res_c == "W":
                    y_val = 1.0
                elif res_c == "L":
                    y_val = 0.0
                elif res_c == "D":
                    y_val = 0.5
                else:
                    continue

                rnd_i = int(rnd_raw or 1)
                sc1_f = float(sc1_raw) if sc1_raw is not None else None
                sc2_f = float(sc2_raw) if sc2_raw is not None else None
                if y_val == 0.5 and rnd_i >= 4 and sc1_f == 0.0 and sc2_f == 0.0:
                    continue

                if isinstance(m_dt_raw, datetime):
                    m_dt = m_dt_raw.date()
                elif isinstance(m_dt_raw, date):
                    m_dt = m_dt_raw
                else:
                    s_d = str(m_dt_raw or "")[:10]
                    try:
                        m_dt = date(int(s_d[0:4]), int(s_d[5:7]), int(s_d[8:10]))
                    except Exception:
                        continue

                r1_f = float(r1_raw if r1_raw is not None else 1500.0)
                r2_f = float(r2_raw if r2_raw is not None else 1500.0)

                x_ab, x_ba, avg_vol, leg_p, raw_m = replay.process_match(
                    m_dt=m_dt,
                    p1_id=str(p1_id),
                    p2_id=str(p2_id),
                    r1=r1_f,
                    r2=r2_f,
                    f1_raw=str(f1_raw or ""),
                    f2_raw=str(f2_raw or ""),
                    s_outcome=y_val,
                    sc1=sc1_f,
                    sc2=sc2_f,
                )
                X_ab_rows.append(x_ab)
                X_ba_rows.append(x_ba)
                vol_rows.append(avg_vol)
                y_rows.append(y_val)
                pure_elo_probs.append(expected_elo_prob(r1_f, r2_f))
                legacy_6f_probs.append(leg_p)
                margins_raw.append(raw_m)

    conn.rollback()

    total_n = len(y_rows)
    if total_n > max_matches:
        # Keep the latest max_matches rows (which already carry full warmed-up rolling state!)
        trim_start = total_n - max_matches
        X_ab_rows = X_ab_rows[trim_start:]
        X_ba_rows = X_ba_rows[trim_start:]
        vol_rows = vol_rows[trim_start:]
        y_rows = y_rows[trim_start:]
        pure_elo_probs = pure_elo_probs[trim_start:]
        legacy_6f_probs = legacy_6f_probs[trim_start:]
        margins_raw = margins_raw[trim_start:]
        total_n = len(y_rows)

    logger.info(f"[{sys_norm}] Replayed {total_n:,} clean competitive 1v1 matches in {(time.perf_counter() - t0):.1f}s")

    scoring_prof = default_system_scoring_profile(sys_norm)
    if len(replay.score_totals) >= 200:
        arr_tot = np.asarray(replay.score_totals, dtype=np.float64)
        arr_mrg = np.asarray(replay.score_margins, dtype=np.float64)
        med_tot = float(np.median(arr_tot))
        std_mrg = float(np.std(arr_mrg))
        if med_tot > 0.5 and std_mrg > 0.2:
            scoring_prof["mean_total_score"] = round(float(np.mean(arr_tot)), 2)
            scoring_prof["margin_std"] = round(std_mrg, 2)
            scoring_prof["margin_per_logit"] = round(std_mrg * 0.62, 2)

    if total_n < 400:
        spec = default_mode2_system_spec(sys_norm)
        spec["scoring"] = scoring_prof
        return spec, {
            "game_system": sys_norm,
            "total_matches": total_n,
            "selected_mode": "calibrated_elo",
            "reason": "insufficient_sample (<400)",
        }

    X_ab_np = np.asarray(X_ab_rows, dtype=np.float64)
    X_ba_np = np.asarray(X_ba_rows, dtype=np.float64)
    vol_np = np.asarray(vol_rows, dtype=np.float64)
    y_np = np.asarray(y_rows, dtype=np.float64)

    n_train = int(total_n * 0.80)
    n_val = int(total_n * 0.90)

    # Fit Mode 2 (Uncertainty-Calibrated Elo + Shrunk Residuals) on Train+Val
    mode2_weights = _fit_mode2_linear_weights(X_ab_np[:n_val], X_ba_np[:n_val], y_np[:n_val], is_tcg=is_tcg)
    mode2_spec = default_mode2_system_spec(sys_norm)
    mode2_spec["linear_weights"] = mode2_weights
    mode2_spec["scoring"] = scoring_prof

    w_vec = np.asarray(mode2_weights, dtype=np.float64)
    mode2_val_logits = 0.5 * ((X_ab_np[n_train:n_val] @ w_vec) - (X_ba_np[n_train:n_val] @ w_vec))
    mode2_nu0 = _calibrate_davidson_nu0(mode2_val_logits, y_np[n_train:n_val])
    mode2_spec["draw_nu0"] = mode2_nu0

    # Evaluate Pure Elo, Legacy 6F, and Mode 2 on Out-of-Time Test Fold [n_val:]
    y_test = y_rows[n_val:]
    pure_test = pure_elo_probs[n_val:]
    leg_test = legacy_6f_probs[n_val:]

    mode2_test_shares: List[float] = []
    mode2_test_3way: List[Tuple[float, float, float]] = []
    for i in range(n_val, total_n):
        _, pw, pd, pl = eval_symmetric_davidson(
            mode2_spec,
            X_ab_rows[i],
            X_ba_rows[i],
            avg_volatility_z=vol_rows[i],
        )
        mode2_test_shares.append(pw + 0.5 * pd)
        mode2_test_3way.append((pw, pd, pl))

    m_pure = _compute_metrics(y_test, pure_test)
    m_leg = _compute_metrics(y_test, leg_test)
    m_mode2 = _compute_metrics(y_test, mode2_test_shares, mode2_test_3way)

    scorecard: Dict[str, Any] = {
        "game_system": sys_norm,
        "total_matches": total_n,
        "test_matches": len(y_test),
        "pure_elo": m_pure,
        "legacy_6factor": m_leg,
        "mode2_calibrated_elo": m_mode2,
    }

    if total_n < min_ml_matches:
        scorecard["selected_mode"] = "calibrated_elo"
        scorecard["reason"] = f"volume_below_threshold ({total_n} < {min_ml_matches})"
        logger.info(
            f"[{sys_norm}] Selected Mode 2 (N={total_n:,} < {min_ml_matches:,}) | "
            f"Test LL: Pure={m_pure['log_loss']:.5f}, Leg6F={m_leg['log_loss']:.5f}, Mode2={m_mode2['log_loss']:.5f}"
        )
        return mode2_spec, scorecard

    # Train Mode 1: Symmetrized Monotonic HistGradientBoostingClassifier on Augmented Train Fold
    # Draws receive two half-weighted (0.5) binary rows (1 and 0) to train exact log-odds in BCE!
    X_tr_list = [X_ab_np[:n_train], X_ba_np[:n_train]]
    y_tr_ab = y_np[:n_train]
    decisive_mask = (np.abs(y_tr_ab - 0.5) > 1e-4)
    draw_mask = ~decisive_mask

    X_aug_parts = [
        X_ab_np[:n_train][decisive_mask],
        X_ba_np[:n_train][decisive_mask],
    ]
    y_aug_parts = [
        (y_tr_ab[decisive_mask] > 0.5).astype(np.int32),
        (y_tr_ab[decisive_mask] < 0.5).astype(np.int32),
    ]
    w_aug_parts = [
        np.ones(int(np.sum(decisive_mask)), dtype=np.float64),
        np.ones(int(np.sum(decisive_mask)), dtype=np.float64),
    ]
    n_draws_tr = int(np.sum(draw_mask))
    if n_draws_tr > 0:
        X_dr_both = np.vstack([X_ab_np[:n_train][draw_mask], X_ba_np[:n_train][draw_mask]])
        X_aug_parts.extend([X_dr_both, X_dr_both])
        y_aug_parts.extend([
            np.ones(len(X_dr_both), dtype=np.int32),
            np.zeros(len(X_dr_both), dtype=np.int32),
        ])
        w_aug_parts.extend([
            np.full(len(X_dr_both), 0.5, dtype=np.float64),
            np.full(len(X_dr_both), 0.5, dtype=np.float64),
        ])

    X_aug = np.vstack(X_aug_parts)
    y_aug = np.concatenate(y_aug_parts)
    w_aug = np.concatenate(w_aug_parts)

    min_leaf = max(120, min(800, int(n_train * 0.0025)))
    clf = HistGradientBoostingClassifier(
        max_iter=95,
        learning_rate=0.045,
        max_leaf_nodes=23,
        max_depth=5,
        min_samples_leaf=min_leaf,
        l2_regularization=8.0,
        monotonic_cst=MONOTONIC_CONSTRAINTS,
        early_stopping=True,
        validation_fraction=0.1,
        n_iter_no_change=12,
        random_state=42,
    )
    clf.fit(X_aug, y_aug, sample_weight=w_aug)

    tree_base, exported_trees = _export_hgbt_trees(clf)
    _verify_exported_trees(clf, tree_base, exported_trees, X_ab_np[n_train:min(n_val, n_train + 256)])

    # Platt + Elo-anchor calibration on Validation Fold [n_train:n_val]
    raw_val_ab = np.asarray(clf._raw_predict(X_ab_np[n_train:n_val])).ravel()
    raw_val_ba = np.asarray(clf._raw_predict(X_ba_np[n_train:n_val])).ravel()
    raw_val_sym = 0.5 * (raw_val_ab - raw_val_ba)
    x1_val_sym = 0.5 * (X_ab_np[n_train:n_val, 1] - X_ba_np[n_train:n_val, 1])

    calib_scale, calib_anchor = _fit_platt_scale(raw_val_sym, y_np[n_train:n_val], x1_val_sym)
    val_cal_logits = calib_scale * raw_val_sym + calib_anchor * x1_val_sym
    ml_nu0 = _calibrate_davidson_nu0(val_cal_logits, y_np[n_train:n_val])

    # Optional score-margin GBDT regressor when >= 5,000 scored matches exist
    margin_base = 0.0
    margin_trees: List[Dict[str, Any]] = []
    valid_m_idx = [i for i in range(n_val) if margins_raw[i] is not None]
    if len(valid_m_idx) >= 5000:
        Xm_pos = X_ab_np[valid_m_idx]
        Xm_neg = X_ba_np[valid_m_idx]
        ym_pos = np.asarray([float(margins_raw[i]) for i in valid_m_idx], dtype=np.float64)
        reg_m = HistGradientBoostingRegressor(
            max_iter=55,
            learning_rate=0.05,
            max_leaf_nodes=15,
            max_depth=4,
            min_samples_leaf=max(100, len(valid_m_idx) // 250),
            l2_regularization=10.0,
            monotonic_cst=MONOTONIC_CONSTRAINTS,
            random_state=42,
        )
        reg_m.fit(np.vstack([Xm_pos, Xm_neg]), np.concatenate([ym_pos, -ym_pos]))
        margin_base, margin_trees = _export_hgbt_trees(reg_m)
        _verify_exported_trees(reg_m, margin_base, margin_trees, Xm_pos[:128])

    ml_spec: Dict[str, Any] = {
        "game_system": sys_norm,
        "mode": "dedicated_ml",
        "model_label": f"Calibrated ML ({sys_norm.upper()} GBDT v1)",
        "uncertainty_c": 0.85,
        "linear_weights": mode2_weights,
        "trees": exported_trees,
        "tree_base_score": tree_base,
        "calib_scale": calib_scale,
        "calib_elo_anchor": calib_anchor,
        "draw_nu0": ml_nu0,
        "draw_gap_decay": 0.55,
        "draw_vol_coef": 0.12,
        "scoring": scoring_prof,
        "margin_norm_std": scoring_prof["margin_std"],
        "margin_base_score": margin_base,
        "margin_trees": margin_trees,
    }

    # Evaluate Mode 1 on untouched Out-of-Time Test Fold [n_val:]
    ml_test_shares: List[float] = []
    ml_test_3way: List[Tuple[float, float, float]] = []
    for i in range(n_val, total_n):
        _, pw, pd, pl = eval_symmetric_davidson(
            ml_spec,
            X_ab_rows[i],
            X_ba_rows[i],
            avg_volatility_z=vol_rows[i],
        )
        ml_test_shares.append(pw + 0.5 * pd)
        ml_test_3way.append((pw, pd, pl))

    m_ml = _compute_metrics(y_test, ml_test_shares, ml_test_3way)
    scorecard["mode1_dedicated_ml"] = m_ml
    scorecard["num_trees"] = len(exported_trees)
    scorecard["num_margin_trees"] = len(margin_trees)

    # Automatic Out-of-Time Holdout Promotion Gate:
    # Must beat Pure Elo & Legacy 6-Factor, and beat or tie Mode 2 within 0.00015 tolerance on Log-Loss & Brier.
    beats_baselines = (
        m_ml["log_loss"] < m_pure["log_loss"]
        and m_ml["log_loss"] < m_leg["log_loss"]
        and m_ml["brier"] <= m_pure["brier"]
        and m_ml["brier"] <= m_leg["brier"]
    )
    beats_or_matches_mode2 = (
        m_ml["log_loss"] <= m_mode2["log_loss"] + 0.00010
        and m_ml["brier"] <= m_mode2["brier"] + 0.00010
    )

    if beats_baselines and beats_or_matches_mode2:
        scorecard["selected_mode"] = "dedicated_ml"
        scorecard["reason"] = "passed_holdout_gate"
        logger.info(
            f"✅ [{sys_norm}] PROMOTED Dedicated ML ({len(exported_trees)} trees, N={total_n:,}) | "
            f"Test LL: ML={m_ml['log_loss']:.5f} vs Pure={m_pure['log_loss']:.5f} vs Leg6F={m_leg['log_loss']:.5f} vs Mode2={m_mode2['log_loss']:.5f} | "
            f"ECE={m_ml['ece']:.4f} | Acc={m_ml['accuracy']:.2f}%"
        )
        return ml_spec, scorecard

    scorecard["selected_mode"] = "calibrated_elo"
    scorecard["reason"] = "holdout_gate_preferred_mode2"
    logger.info(
        f"📐 [{sys_norm}] Kept Mode 2 Calibrated Elo (N={total_n:,}) | "
        f"Test LL: Mode2={m_mode2['log_loss']:.5f} vs ML={m_ml['log_loss']:.5f} vs Pure={m_pure['log_loss']:.5f} vs Leg6F={m_leg['log_loss']:.5f}"
    )
    return mode2_spec, scorecard


def main() -> int:
    parser = argparse.ArgumentParser(description="Train & benchmark point-in-time ML match predictor.")
    parser.add_argument("--game-systems", default="all", help="Comma-separated game systems or 'all'")
    parser.add_argument("--min-ml-matches", type=int, default=25000, help="Minimum clean 1v1 matches for Dedicated ML")
    parser.add_argument("--min-mode2-matches", type=int, default=1500, help="Minimum total rows to fit custom Mode 2 weights")
    parser.add_argument("--max-matches-per-system", type=int, default=250000, help="Cap per system to modern competitive window")
    parser.add_argument("--output", default=str(ROOT_DIR / "models" / "match_predictor_v1.json"), help="Local JSON output path")
    parser.add_argument("--no-db-save", action="store_true", help="Skip saving bundle to Postgres ml_predictor_models")
    args = parser.parse_args()

    from database import Database

    db = Database()
    t_start = time.perf_counter()

    with db.get_connection() as conn:
        if args.game_systems.strip().lower() == "all":
            with conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = '120000ms';")
                cur.execute(
                    """
                    SELECT COALESCE(game_system, '40k') AS sys, COUNT(*) AS row_cnt
                    FROM player_ratings
                    GROUP BY 1
                    HAVING SUM(COALESCE(matches_played, 0)) >= %s
                    ORDER BY SUM(COALESCE(matches_played, 0)) DESC;
                    """,
                    (args.min_mode2_matches * 2,),
                )
                target_systems = [str(r[0]).strip().lower() for r in cur.fetchall() if r and r[0]]
            conn.rollback()
        else:
            target_systems = [s.strip().lower() for s in args.game_systems.split(",") if s.strip()]

    logger.info(f"🚀 Starting Chronological ML Match Predictor Training across {len(target_systems)} systems: {target_systems}")

    systems_bundle: Dict[str, Any] = {}
    benchmark_report: List[Dict[str, Any]] = []

    for sys_code in target_systems:
        try:
            with db.get_connection() as conn:
                spec, sc = train_and_evaluate_system(
                    conn,
                    game_system=sys_code,
                    min_ml_matches=args.min_ml_matches,
                    max_matches=args.max_matches_per_system,
                )
                systems_bundle[sys_code] = spec
                benchmark_report.append(sc)
        except Exception as exc:
            logger.exception(f"Error training system {sys_code}: {exc}")

    bundle = {
        "schema_version": MODEL_SCHEMA_VERSION,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "min_ml_matches": args.min_ml_matches,
        "feature_names": FEATURE_NAMES,
        "systems": systems_bundle,
        "benchmark_summary": benchmark_report,
    }

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(bundle, separators=(",", ":")), encoding="utf-8")
        size_kb = out_path.stat().st_size / 1024.0
        logger.info(f"💾 Wrote {out_path} ({size_kb:.1f} KB, {len(systems_bundle)} systems)")

    if not args.no_db_save and hasattr(db, "save_active_ml_predictor_bundle"):
        db.save_active_ml_predictor_bundle(MODEL_SCHEMA_VERSION, bundle, benchmark_report)
        invalidate_model_bundle_cache()
        logger.info("💾 Saved active ML predictor bundle + benchmark scorecard to Postgres `ml_predictor_models`")

    promoted = [r["game_system"] for r in benchmark_report if r.get("selected_mode") == "dedicated_ml"]
    mode2_only = [r["game_system"] for r in benchmark_report if r.get("selected_mode") == "calibrated_elo"]
    logger.info(
        f"🏁 Training complete in {(time.perf_counter() - t_start):.1f}s | "
        f"Dedicated ML ({len(promoted)}): {promoted} | Mode 2 Calibrated Elo ({len(mode2_only)}): {mode2_only}"
    )
    print("BENCHMARK_SCORECARD_JSON:" + json.dumps(benchmark_report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
