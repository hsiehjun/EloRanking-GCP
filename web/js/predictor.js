/* ==========================================================================
   PREDICTOR.JS - Calibrated ML Match Predictor (Phase 1: Meta Intel),
   Player Disposition Badges, 3-Mo Faction Intel & Commander Dossiers
   ========================================================================== */

let predP1 = null;
let predP2 = null;
let predP1Profile = null;
let predP2Profile = null;
let predP1SelectedFaction = '';
let predP2SelectedFaction = '';
let predFaction3MoSummary = {};
let predH2hMatches = [];
let predLastResponse = null;
let acTimeout = null;

const _ML_FACTION_ALIASES = {
  'genestealer cult': 'genestealer cults',
  'custodes': 'adeptus custodes',
  'admech': 'adeptus mechanicus',
  'mechanicus': 'adeptus mechanicus',
  'csm': 'chaos space marines',
  'heretic astartes': 'chaos space marines',
  'sm': 'space marines',
  'astartes': 'space marines',
  'adeptus astartes': 'space marines',
  'guard': 'astra militarum',
  'imperial guard': 'astra militarum',
  'sisters': 'adepta sororitas',
  'sisters of battle': 'adepta sororitas',
  'daemons': 'chaos daemons',
  'eldar': 'aeldari',
  'craftworlds': 'aeldari',
  'dark eldar': 'drukhari',
  'tau': 'tau empire'
};

const _WTC_40K_DIFF_BANDS = [
  [5.0, 10],
  [10.0, 11],
  [15.0, 12],
  [20.0, 13],
  [25.0, 14],
  [30.0, 15],
  [35.0, 16],
  [40.0, 17],
  [45.0, 18],
  [50.0, 19]
];

function _normMlFacKey(raw) {
  const s = String(raw || '').trim().toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || ['unknown', 'none', 'various', 'all', 'bye', 'unaligned', 'n a', 'na'].includes(s)) {
    return '';
  }
  return _ML_FACTION_ALIASES[s] || s;
}

function _renderDispositionBadgesHtml(prof) {
  const badges = Array.isArray(prof?.disposition?.badges) ? prof.disposition.badges : [];
  if (!badges.length) return '';
  return badges.slice(0, 2).map(b => {
    const tone = String(b.tone || 'slate').replace(/[^a-z]/g, '');
    const label = escapeHtml(b.label || '');
    const tip = escapeHtml(b.tooltip || '');
    return `<span class="pred-disp-pill tone-${tone}" title="${tip}">${label}</span>`;
  }).join('');
}

function _erfApprox(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + 0.3275911 * ax);
  const y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

function _normCdf(x) {
  return 0.5 * (1.0 + _erfApprox(x / Math.SQRT2));
}

function _defaultClientMlSpec(gameSystem) {
  const sys = String(gameSystem || '40k').trim().toLowerCase();
  const isTcg = ['mtg', 'pokemon', 'lorcana', 'sw_unlimited', 'one_piece', 'digimon', 'yugioh', 'flesh_blood', 'riftbound'].includes(sys);
  const isDrawWargame = ['aos', 'the_old_world', 'blood_bowl', 'middle_earth', 'horus_heresy', 'bolt_action', 'kings_of_war'].includes(sys);
  const nu0 = sys === 'blood_bowl' ? 0.28 : (isDrawWargame ? 0.095 : (sys === '40k' ? 0.024 : (isTcg ? 0.018 : 0.030)));
  let scoring = {
    scoring_type: 'generic_pts', score_unit: 'Pts', mean_total_score: 30.0,
    margin_per_logit: 4.2, margin_std: 9.5, min_score: 0.0, max_score: 50.0, has_wtc_matrix: false
  };
  if (sys === '40k') {
    scoring = {
      scoring_type: 'vp_100', score_unit: 'VP', mean_total_score: 146.0,
      margin_per_logit: 16.5, margin_std: 26.0, min_score: 10.0, max_score: 100.0, has_wtc_matrix: true
    };
  } else if (['aos', 'the_old_world', 'horus_heresy'].includes(sys)) {
    scoring = {
      scoring_type: 'vp_wargame', score_unit: 'VP', mean_total_score: sys === 'aos' ? 68.0 : 28.0,
      margin_per_logit: sys === 'aos' ? 7.5 : 4.5, margin_std: sys === 'aos' ? 12.0 : 7.0,
      min_score: 0.0, max_score: sys === 'aos' ? 60.0 : 20.0, has_wtc_matrix: sys === 'aos'
    };
  } else if (isTcg) {
    scoring = {
      scoring_type: 'bo3_games', score_unit: 'Games', mean_total_score: 2.45,
      margin_per_logit: 0.65, margin_std: 1.15, min_score: 0.0, max_score: 2.0, has_wtc_matrix: false
    };
  }
  return {
    game_system: sys,
    mode: 'calibrated_elo',
    model_label: 'Uncertainty-Calibrated Elo',
    uncertainty_c: 0.85,
    linear_weights: [0.0, isTcg ? 0.88 : 0.98, 0.0, 0.03, 0.04, 0.35, isTcg ? 1.35 : 1.10, isTcg ? 1.55 : 1.25, 0.0, 0.85, 0.02, 0.65, 0.75, 0.40],
    trees: [],
    tree_base_score: 0.0,
    calib_scale: 1.0,
    calib_elo_anchor: 0.0,
    draw_nu0: nu0,
    draw_gap_decay: 0.55,
    draw_vol_coef: 0.12,
    scoring
  };
}

function _buildDirectionalMlVector(a, b, macro, h2hResAb, uncC) {
  const eloDiffScaled = (a.elo - b.elo) / 400.0;
  const denom = Math.sqrt(1.0 + Math.max(0.0, uncC) * (Math.max(0.0, a.uncSq) + Math.max(0.0, b.uncSq)));
  const eloAtt = (Math.LN10 * eloDiffScaled) / denom;
  const eloSumC = (a.elo + b.elo - 3000.0) / 800.0;
  const logExpD = Math.log1p(Math.max(0, a.games)) - Math.log1p(Math.max(0, b.games));
  const peakGapD = (a.peakGap - b.peakGap) / 200.0;
  const formD = a.form - b.form;
  const facD = macro.isMirror ? 0.0 : (macro.facAlphaA - macro.facAlphaB);
  const muA = macro.isMirror ? 0.0 : macro.matchupAlphaAb;
  const mirV = macro.isMirror ? 1.0 : 0.0;
  const ownResD = a.ownRes - b.ownRes;
  const ownGD = Math.log1p(Math.max(0, a.ownGames)) - Math.log1p(Math.max(0, b.ownGames));
  const vsResD = a.vsRes - b.vsRes;
  const wUnderdogA = 0.5 * (1.0 + Math.tanh((b.elo - a.elo) / 100.0));
  const dispA = wUnderdogA * a.giantSlayer + (1.0 - wUnderdogA) * a.gatekeeper;
  const dispB = (1.0 - wUnderdogA) * b.giantSlayer + wUnderdogA * b.gatekeeper;
  return [
    eloDiffScaled, eloAtt, eloSumC, logExpD, peakGapD, formD,
    facD, muA, mirV, ownResD, ownGD, vsResD, h2hResAb, dispA - dispB
  ];
}

function _evalMlTree(tree, x) {
  const fArr = tree.f, tArr = tree.t, lArr = tree.l, rArr = tree.r, vArr = tree.v;
  let node = 0;
  for (let depth = 0; depth < 32; depth++) {
    const feat = fArr[node];
    if (feat < 0) return Number(vArr[node]);
    node = (x[feat] <= tArr[node]) ? lArr[node] : rArr[node];
  }
  return Number(vArr[node]);
}

function _evalDirectionalLogit(spec, x) {
  if (spec.mode === 'dedicated_ml' && Array.isArray(spec.trees) && spec.trees.length > 0) {
    let raw = Number(spec.tree_base_score || 0.0);
    for (let i = 0; i < spec.trees.length; i++) {
      raw += _evalMlTree(spec.trees[i], x);
    }
    const scale = Number(spec.calib_scale !== undefined ? spec.calib_scale : 1.0);
    const anchor = Number(spec.calib_elo_anchor || 0.0);
    return scale * raw + anchor * x[1];
  }
  const weights = Array.isArray(spec.linear_weights) ? spec.linear_weights : [];
  let tot = 0.0;
  for (let i = 0; i < weights.length && i < x.length; i++) {
    if (weights[i]) tot += Number(weights[i]) * x[i];
  }
  return tot;
}

function _evalSymmetricDavidson(spec, xAb, xBa, avgVolZ) {
  const gAb = _evalDirectionalLogit(spec, xAb);
  const gBa = _evalDirectionalLogit(spec, xBa);
  const logitSym = Math.max(-8.0, Math.min(8.0, 0.5 * (gAb - gBa)));
  const nu0 = Math.max(0.0, Number(spec.draw_nu0 || 0.0));
  if (nu0 <= 1e-6) {
    const p1 = 1.0 / (1.0 + Math.exp(-logitSym));
    return [logitSym, p1, 0.0, 1.0 - p1];
  }
  const gapDecay = Number(spec.draw_gap_decay !== undefined ? spec.draw_gap_decay : 0.55);
  const volCoef = Number(spec.draw_vol_coef !== undefined ? spec.draw_vol_coef : 0.12);
  const clampedVol = Math.max(-2.0, Math.min(2.0, avgVolZ || 0.0));
  const nu = nu0 * Math.exp(-gapDecay * Math.abs(logitSym) - volCoef * clampedVol);
  const half = 0.5 * logitSym;
  const ePos = Math.exp(half);
  const eNeg = Math.exp(-half);
  const z = ePos + eNeg + nu;
  return [logitSym, ePos / z, nu / z, eNeg / z];
}

function computeCalibratedMlMatchupClient({ p1Prof, p2Prof, elo1, elo2, fac1, fac2, p1Mastery, p2Mastery, h2hMatches }) {
  const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
  const spec = (predLastResponse && predLastResponse.ml_client_spec) ? predLastResponse.ml_client_spec : _defaultClientMlSpec(sys);
  const compSnap = (predLastResponse && predLastResponse.competitive_alpha_90d) || { factions: {}, matchups: {} };
  const nk1 = _normMlFacKey(fac1);
  const nk2 = _normMlFacKey(fac2);
  const isMirror = Boolean(nk1 && nk2 && nk1 === nk2);

  const f1AlphaObj = (compSnap.factions && compSnap.factions[nk1]) || {};
  const f2AlphaObj = (compSnap.factions && compSnap.factions[nk2]) || {};
  const fwdMu = (compSnap.matchups && compSnap.matchups[`${nk1}||${nk2}`]) || null;
  const revMu = (nk1 && nk2 && nk1 !== nk2 && compSnap.matchups && compSnap.matchups[`${nk2}||${nk1}`]) || null;
  let muAlphaObj = {};
  if (fwdMu && revMu) {
    muAlphaObj = {
      alpha: 0.5 * (Number(fwdMu.alpha || 0.0) - Number(revMu.alpha || 0.0)),
      games: Math.max(Number(fwdMu.games || 0), Number(revMu.games || 0))
    };
  } else if (fwdMu) {
    muAlphaObj = fwdMu;
  } else if (revMu) {
    muAlphaObj = { alpha: -Number(revMu.alpha || 0.0), games: Number(revMu.games || 0) };
  }

  const mlf1 = p1Prof?.ml_features || {};
  const mlf2 = p2Prof?.ml_features || {};
  const disp1 = p1Prof?.disposition || {};
  const disp2 = p2Prof?.disposition || {};

  const own1 = (mlf1.own_faction_residuals && mlf1.own_faction_residuals[nk1]) || {};
  const own2 = (mlf2.own_faction_residuals && mlf2.own_faction_residuals[nk2]) || {};
  const vs1 = (mlf1.vs_faction_residuals && mlf1.vs_faction_residuals[nk2]) || {};
  const vs2 = (mlf2.vs_faction_residuals && mlf2.vs_faction_residuals[nk1]) || {};

  // H2H Elo residual
  const p1IdL = String(p1Prof?.player_id || '').trim().toLowerCase();
  const p2IdL = String(p2Prof?.player_id || '').trim().toLowerCase();
  const p1NmL = String(p1Prof?.player_name || '').trim().toLowerCase();
  const expDefault = 1.0 / (1.0 + Math.pow(10.0, (elo2 - elo1) / 400.0));
  let h2hResSum = 0.0;
  let h2hCnt = 0;
  (h2hMatches || []).forEach(hm => {
    if (!hm || hm.is_bye) return;
    h2hCnt++;
    let sVal = 0.5;
    if (!hm.is_draw) {
      const wId = String(hm.winner_id || '').trim().toLowerCase();
      const m1Id = String(hm.player1_id || '').trim().toLowerCase();
      const m1Nm = String(hm.player1_name || '').trim().toLowerCase();
      const isSide1 = (p1IdL && m1Id === p1IdL) || (p1NmL && m1Nm === p1NmL);
      if (wId) {
        if (p1IdL && wId === p1IdL) sVal = 1.0;
        else if (p2IdL && wId === p2IdL) sVal = 0.0;
      } else if (hm.player1_score != null && hm.player2_score != null) {
        const fv1 = Number(hm.player1_score), fv2 = Number(hm.player2_score);
        if (fv1 > fv2) sVal = isSide1 ? 1.0 : 0.0;
        else if (fv2 > fv1) sVal = isSide1 ? 0.0 : 1.0;
      }
    }
    h2hResSum += (sVal - expDefault);
  });
  const h2hResAb = h2hCnt > 0 ? (h2hResSum / (h2hCnt + 5.0)) : 0.0;

  const g1 = Math.max(Number(p1Prof?.matches_played || 0), Number(mlf1.competitive_games || 0));
  const g2 = Math.max(Number(p2Prof?.matches_played || 0), Number(mlf2.competitive_games || 0));

  const p1In = {
    elo: elo1,
    games: g1,
    uncSq: Number(mlf1.uncertainty_sq !== undefined ? mlf1.uncertainty_sq : (1.0 / (1.0 + g1 / 12.0))),
    peakGap: Number(mlf1.peak_gap || 0.0),
    form: Number(mlf1.recent_form_ewma || 0.0),
    ownRes: Number(own1.residual || 0.0),
    ownGames: Number(own1.games !== undefined ? own1.games : (p1Mastery?.ownGames || 0)),
    vsRes: Number(vs1.residual || 0.0),
    giantSlayer: Number(disp1.giant_slayer_res || 0.0),
    gatekeeper: Number(disp1.gatekeeper_res || 0.0),
    volZ: Number(disp1.volatility_z || 0.0)
  };
  const p2In = {
    elo: elo2,
    games: g2,
    uncSq: Number(mlf2.uncertainty_sq !== undefined ? mlf2.uncertainty_sq : (1.0 / (1.0 + g2 / 12.0))),
    peakGap: Number(mlf2.peak_gap || 0.0),
    form: Number(mlf2.recent_form_ewma || 0.0),
    ownRes: Number(own2.residual || 0.0),
    ownGames: Number(own2.games !== undefined ? own2.games : (p2Mastery?.ownGames || 0)),
    vsRes: Number(vs2.residual || 0.0),
    giantSlayer: Number(disp2.giant_slayer_res || 0.0),
    gatekeeper: Number(disp2.gatekeeper_res || 0.0),
    volZ: Number(disp2.volatility_z || 0.0)
  };

  const uncC = Number(spec.uncertainty_c !== undefined ? spec.uncertainty_c : 0.85);
  const f1Alpha = Number(f1AlphaObj.alpha || 0.0);
  const f2Alpha = Number(f2AlphaObj.alpha || 0.0);
  const muAlpha = Number(muAlphaObj.alpha || 0.0);

  const xAb = _buildDirectionalMlVector(p1In, p2In, { isMirror, facAlphaA: f1Alpha, facAlphaB: f2Alpha, matchupAlphaAb: muAlpha }, h2hResAb, uncC);
  const xBa = _buildDirectionalMlVector(p2In, p1In, { isMirror, facAlphaA: f2Alpha, facAlphaB: f1Alpha, matchupAlphaAb: -muAlpha }, -h2hResAb, uncC);
  const avgVol = 0.5 * (p1In.volZ + p2In.volZ);
  const [logitFull, p1Prob, drawProb, p2Prob] = _evalSymmetricDavidson(spec, xAb, xBa, avgVol);

  const stages = [
    ['skill_uncertainty', 'Base Skill & Uncertainty', new Set([0, 1, 2, 3, 4])],
    ['form_disposition', 'Recent Form & Disposition', new Set([0, 1, 2, 3, 4, 5, 13])],
    ['faction_meta', 'Faction Meta Strength', new Set([0, 1, 2, 3, 4, 5, 6, 13])],
    ['matchup_edge', 'Matchup Counter Edge', new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 13])],
    ['pilot_mastery_h2h', 'Pilot Mastery & H2H', new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])]
  ];

  let prevShare = 0.5;
  let prevLogit = 0.0;
  const ln10Over400 = Math.LN10 / 400.0;
  const factorAttributions = stages.map(([key, label, activeIdx]) => {
    const subAb = xAb.map((v, idx) => activeIdx.has(idx) ? v : 0.0);
    const subBa = xBa.map((v, idx) => activeIdx.has(idx) ? v : 0.0);
    const [stLogit, stP1, stDr] = _evalSymmetricDavidson(spec, subAb, subBa, avgVol);
    const stShare = stP1 + 0.5 * stDr;
    const shiftPct = (stShare - prevShare) * 100.0;
    const eloEq = (stLogit - prevLogit) / ln10Over400;
    prevShare = stShare;
    prevLogit = stLogit;
    return {
      key,
      label,
      prob_shift_pct: Number(shiftPct.toFixed(2)),
      elo_equiv: Number(eloEq.toFixed(1))
    };
  });

  // Score & WTC 0-20 normal-CDF projection
  const scoring = spec.scoring || _defaultClientMlSpec(sys).scoring;
  let expMargin = 0.0;
  if (Array.isArray(spec.margin_trees) && spec.margin_trees.length > 0) {
    let mAb = Number(spec.margin_base_score || 0.0);
    let mBa = Number(spec.margin_base_score || 0.0);
    for (let i = 0; i < spec.margin_trees.length; i++) {
      mAb += _evalMlTree(spec.margin_trees[i], xAb);
      mBa += _evalMlTree(spec.margin_trees[i], xBa);
    }
    expMargin = 0.5 * (mAb - mBa);
  } else {
    expMargin = logitFull * Number(scoring.margin_per_logit || 16.0);
  }

  const baseStd = Math.max(1.0, Number(scoring.margin_std || 25.0));
  const effStd = Math.max(0.5 * baseStd, baseStd * (1.0 + 0.16 * Math.max(-1.5, Math.min(2.0, avgVol))));
  const meanTot = Number(scoring.mean_total_score || 146.0);
  const loSc = Number(scoring.min_score || 0.0);
  const hiSc = Number(scoring.max_score || 100.0);
  const s1Raw = Math.max(loSc, Math.min(hiSc, 0.5 * (meanTot + expMargin)));
  const s2Raw = Math.max(loSc, Math.min(hiSc, 0.5 * (meanTot - expMargin)));
  const isBo3 = scoring.scoring_type === 'bo3_games';
  const p1Score = isBo3 ? Number(s1Raw.toFixed(1)) : Math.round(s1Raw);
  const p2Score = isBo3 ? Number(s2Raw.toFixed(1)) : Math.round(s2Raw);

  let expWtc1 = 10.0;
  let tightProb = 0.0;
  let blowoutProb = 0.0;
  if (scoring.has_wtc_matrix) {
    const pTie = _normCdf((5.0 - expMargin) / effStd) - _normCdf((-5.0 - expMargin) / effStd);
    expWtc1 = 10.0 * pTie;
    let prevHi = 5.0;
    for (let i = 1; i < _WTC_40K_DIFF_BANDS.length; i++) {
      const [bandHi, wPts] = _WTC_40K_DIFF_BANDS[i];
      const pPos = _normCdf((bandHi - expMargin) / effStd) - _normCdf((prevHi - expMargin) / effStd);
      const pNeg = _normCdf((-prevHi - expMargin) / effStd) - _normCdf((-bandHi - expMargin) / effStd);
      expWtc1 += wPts * pPos + (20 - wPts) * pNeg;
      prevHi = bandHi;
    }
    expWtc1 += 20.0 * (1.0 - _normCdf((50.0 - expMargin) / effStd));
    tightProb = _normCdf((15.0 - expMargin) / effStd) - _normCdf((-15.0 - expMargin) / effStd);
    blowoutProb = (1.0 - _normCdf((30.0 - expMargin) / effStd)) + _normCdf((-30.0 - expMargin) / effStd);
  } else {
    expWtc1 = 3.0 + 14.0 * (1.0 / (1.0 + Math.exp(-logitFull)));
  }
  const wtcP1 = Math.max(0, Math.min(20, Math.round(expWtc1)));
  const wtcP2 = 20 - wtcP1;

  const muGames = Number(muAlphaObj.games || 0);
  let confTier = 'Provisional';
  if (g1 >= 25 && g2 >= 25 && (isMirror || muGames >= 20)) confTier = 'High';
  else if (g1 >= 8 && g2 >= 8) confTier = 'Medium';

  const p1Pct = Number((p1Prob * 100.0).toFixed(2));
  const drPct = Number((drawProb * 100.0).toFixed(2));
  const p2Pct = Number((100.0 - p1Pct - drPct).toFixed(2));
  const winShare1 = Number(((p1Prob + 0.5 * drawProb) * 100.0).toFixed(1));

  return {
    model_mode: spec.mode || 'calibrated_elo',
    model_label: spec.model_label || 'Uncertainty-Calibrated Elo',
    confidence: confTier,
    p1_win_prob: p1Pct,
    draw_prob: drPct,
    p2_win_prob: p2Pct,
    p1_win_share: winShare1,
    p2_win_share: Number((100.0 - winShare1).toFixed(1)),
    effective_elo_equiv: Number((logitFull / ln10Over400).toFixed(1)),
    factor_attributions: factorAttributions,
    projected: {
      p1_score: p1Score,
      p2_score: p2Score,
      score_unit: scoring.score_unit || 'VP',
      scoring_type: scoring.scoring_type || 'vp_100',
      expected_margin: Number(expMargin.toFixed(1)),
      wtc_p1: wtcP1,
      wtc_p2: wtcP2,
      wtc_p1_exact: Number(expWtc1.toFixed(1)),
      wtc_p2_exact: Number((20.0 - expWtc1).toFixed(1)),
      tight_game_prob: Number((tightProb * 100.0).toFixed(1)),
      blowout_prob: Number((blowoutProb * 100.0).toFixed(1)),
      has_wtc_matrix: Boolean(scoring.has_wtc_matrix)
    }
  };
}

function buildMlFactorAttributionHtml(mlPred, p1Name, p2Name, fac1, fac2) {
  const attrs = Array.isArray(mlPred?.factor_attributions) ? mlPred.factor_attributions : [];
  if (!attrs.length) return '';

  const effElo = Number(mlPred.effective_elo_equiv || 0);
  const netLeader = Math.abs(effElo) < 3.0 ? 'Balanced Toss-Up' : (effElo > 0 ? `${p1Name} Edge` : `${p2Name} Edge`);
  const netCol = Math.abs(effElo) < 3.0 ? '#cbd5e1' : (effElo > 0 ? '#38bdf8' : '#f43f5e');
  const netSignStr = `${effElo >= 0 ? '+' : ''}${Math.abs(effElo).toFixed(1)} Elo`;

  const iconMap = {
    skill_uncertainty: '⚖️',
    form_disposition: '🔥',
    faction_meta: '📊',
    matchup_edge: '⚔️',
    pilot_mastery_h2h: '🎯'
  };

  const cardsHtml = attrs.map(a => {
    const shift = Number(a.prob_shift_pct || 0);
    const eloEq = Number(a.elo_equiv || 0);
    const absShift = Math.abs(shift);
    const isNeutral = absShift < 0.15;
    const col = isNeutral ? '#94a3b8' : (shift > 0 ? '#38bdf8' : '#f43f5e');
    const borderCol = isNeutral ? 'rgba(255,255,255,0.07)' : (shift > 0 ? 'rgba(56,189,248,0.28)' : 'rgba(244,63,94,0.28)');
    const who = isNeutral ? 'Neutral' : (shift > 0 ? p1Name : p2Name);
    const shiftStr = isNeutral ? '0.0%' : `${shift > 0 ? '+' : ''}${shift.toFixed(1)}%`;
    const eloStr = `${eloEq >= 0 ? '+' : ''}${eloEq.toFixed(1)} Elo`;
    const ico = iconMap[a.key] || '🔹';
    return `
      <div style="background: rgba(9, 14, 26, 0.72); border: 1px solid ${borderCol}; border-radius: 8px; padding: 0.52rem 0.65rem; display: flex; flex-direction: column; justify-content: space-between; gap: 3px; min-width: 0;">
        <div style="font-size: 0.66rem; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${ico} ${escapeHtml(a.label)}
        </div>
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 0.35rem; flex-wrap: wrap;">
          <span style="font-family: var(--font-mono); font-size: 0.9rem; font-weight: 900; color: ${col};">${shiftStr}</span>
          <span style="font-family: var(--font-mono); font-size: 0.68rem; color: var(--text-muted);">${eloStr}</span>
        </div>
        <div style="font-size: 0.67rem; font-weight: 700; color: ${col}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(who)}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div style="margin-top: 0.95rem; background: rgba(15, 23, 42, 0.68); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 0.75rem 0.9rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.6rem;">
        <div style="font-size: 0.75rem; font-weight: 800; color: #e2e8f0; display: flex; align-items: center; gap: 0.4rem;">
          <span>🧠 Calibrated 5-Pillar Win-Share Attribution</span>
          <span style="font-size: 0.68rem; font-weight: 500; color: var(--text-muted);">(${escapeHtml(fac1)} vs ${escapeHtml(fac2)} • Elo-residualized, zero double-counting)</span>
        </div>
        <span style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: 800; color: ${netCol}; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 2px 8px;">
          ${escapeHtml(netLeader)} (${netSignStr})
        </span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 155px), 1fr)); gap: 0.5rem;">
        ${cardsHtml}
      </div>
    </div>
  `;
}

const STANDARD_40K_FACTIONS = [
  'Adepta Sororitas', 'Adeptus Custodes', 'Adeptus Mechanicus', 'Aeldari',
  'Agents of the Imperium', 'Astra Militarum', 'Black Templars', 'Blood Angels',
  'Chaos Daemons', 'Chaos Knights', 'Chaos Space Marines', 'Dark Angels',
  'Death Guard', 'Deathwatch', 'Drukhari', "Emperor's Children",
  'Genestealer Cults', 'Grey Knights', 'Imperial Knights', 'Leagues of Votann',
  'Necrons', 'Orks', 'Space Marines (Astartes)', 'Space Wolves',
  "T'au Empire", 'Thousand Sons', 'Tyranids', 'World Eaters'
];

const STANDARD_AOS_FACTIONS = [
  'Blades of Khorne', 'Cities of Sigmar', 'Daughters of Khaine', 'Disciples of Tzeentch',
  'Flesh-eater Courts', 'Fyreslayers', 'Gloomspite Gitz', 'Hedonites of Slaanesh',
  'Helsmiths of Hashut', 'Idoneth Deepkin', 'Ironjawz', 'Kharadron Overlords',
  'Kruleboyz', 'Lumineth Realm-lords', 'Maggotkin of Nurgle', 'Nighthaunt',
  'Ogor Mawtribes', 'Ossiarch Bonereapers', 'Seraphon', 'Skaven',
  'Slaves to Darkness', 'Sons of Behemat', 'Soulblight Gravelords',
  'Stormcast Eternals', 'Sylvaneth'
];

function _normPredFacKey(raw) {
  if (typeof window.normalizeCasterFactionKey === 'function') {
    return window.normalizeCasterFactionKey(raw);
  }
  return String(raw || '').trim().toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _isSamePredFac(fA, fB) {
  if (typeof window.isSameCasterFaction === 'function') {
    return window.isSameCasterFaction(fA, fB);
  }
  const kA = _normPredFacKey(fA);
  const kB = _normPredFacKey(fB);
  return Boolean(kA && kB && kA === kB);
}

function _extractPlayerFactionsList(pObj) {
  if (!pObj) return [];
  const mastery = Array.isArray(pObj.faction_mastery) ? pObj.faction_mastery : [];
  const seen = new Set();
  const list = [];

  mastery.forEach(m => {
    const f = String(m.faction || '').trim();
    const nk = _normPredFacKey(f);
    if (!f || !nk || seen.has(nk)) return;
    seen.add(nk);
    list.push({
      faction: f,
      games: Number(m.games || m.matches || 0),
      wins: Number(m.wins || 0),
      losses: Number(m.losses || 0),
      draws: Number(m.draws || 0),
      win_rate: Number(m.win_rate || 0),
      net_elo: Number(m.net_elo || 0)
    });
  });

  const rawTop = String(pObj.top_faction || pObj.primary_faction || pObj.faction || '').trim();
  if (rawTop) {
    const topParts = (typeof window.splitFactionPills === 'function')
      ? window.splitFactionPills(rawTop)
      : rawTop.split(',').map(s => s.trim()).filter(Boolean);
    topParts.forEach(f => {
      if (f.toLowerCase() === 'various' || f.toLowerCase() === 'unknown') return;
      const nk = _normPredFacKey(f);
      if (!nk || seen.has(nk)) return;
      seen.add(nk);
      list.push({
        faction: f,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        win_rate: 0,
        net_elo: 0
      });
    });
  }
  return list;
}

function searchPlayerAc(colNum) {
  clearTimeout(acTimeout);
  const input = document.getElementById(`p${colNum}-name-input`);
  const query = input ? input.value.trim() : '';
  const dropdown = document.getElementById(`p${colNum}-ac-dropdown`);

  if (!query || query.length < 2) {
    if (dropdown) dropdown.style.display = 'none';
    return;
  }

  acTimeout = setTimeout(async () => {
    try {
      const results = await window.api.searchPlayers(query, 8);
      if (!dropdown) return;
      dropdown.innerHTML = '';
      if (!results || results.length === 0) {
        dropdown.style.display = 'none';
        return;
      }

      results.forEach(p => {
        const item = document.createElement('div');
        item.className = 'ac-item';
        item.onclick = () => selectPredictPlayer(colNum, p);
        item.innerHTML = `
          <div>
            <div style="font-weight:600; color:#fff;">${escapeHtml(p.player_name || p.full_name)}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(p.top_faction || 'Various')}</div>
          </div>
          <div class="elo-badge ${getEloBadgeClass(p.current_elo)}" style="font-size:0.85rem;">
            ${Number(p.current_elo).toFixed(1)}
          </div>
        `;
        dropdown.appendChild(item);
      });
      dropdown.style.display = 'block';
    } catch (err) {
      if (dropdown) dropdown.style.display = 'none';
    }
  }, 200);
}

function selectPredictPlayer(colNum, p) {
  const dropdown = document.getElementById(`p${colNum}-ac-dropdown`);
  if (dropdown) dropdown.style.display = 'none';
  const input = document.getElementById(`p${colNum}-name-input`);
  if (input) input.value = p.player_name || p.full_name;

  const facList = _extractPlayerFactionsList(p);
  const defaultFac = (p.primary_faction && p.primary_faction !== 'Unknown')
    ? p.primary_faction
    : (facList.length > 0 ? facList[0].faction : 'Unknown');

  if (colNum === 1) {
    predP1 = p;
    predP1Profile = p;
    predP1SelectedFaction = defaultFac;
  } else {
    predP2 = p;
    predP2Profile = p;
    predP2SelectedFaction = defaultFac;
  }

  updatePredictCard(colNum, p);
  if (predP1 && predP2) runPrediction();
}

function onPredictorFactionChange(colNum, newFaction) {
  const cleanFac = String(newFaction || '').trim();
  if (!cleanFac) return;
  if (colNum === 1) {
    predP1SelectedFaction = cleanFac;
    updatePredictCard(1, predP1Profile || predP1);
  } else {
    predP2SelectedFaction = cleanFac;
    updatePredictCard(2, predP2Profile || predP2);
  }
  if (predP1 && predP2) {
    recomputeAndRenderPredictorMatchup();
  }
}
window.onPredictorFactionChange = onPredictorFactionChange;

function updatePredictCard(colNum, p) {
  if (!p) return;
  const pName = p.player_name || p.full_name || `Player ${colNum}`;
  const pId = String(p.player_id || p.id || '').trim();
  const safePid = pId.replace(/'/g, "\\'");
  const safeName = String(pName).replace(/'/g, "\\'");
  const accentColor = colNum === 1 ? '#38bdf8' : '#f43f5e';
  const activeFac = (colNum === 1 ? predP1SelectedFaction : predP2SelectedFaction) || p.primary_faction || 'Unknown';

  const nameEl = document.getElementById(`p${colNum}-card-name`);
  if (nameEl) {
    if (pId || (pName && pName !== 'Player 1' && pName !== 'Player 2')) {
      nameEl.innerHTML = `<span class="player-link" onclick="openPlayerModal('${escapeHtml(safePid)}', '${escapeHtml(safeName)}')" style="cursor:pointer; color:#fff; text-decoration:underline; text-decoration-color:${accentColor}; text-underline-offset:3px;" title="View ${escapeHtml(pName)} Quick Profile">${escapeHtml(pName)}</span>`;
    } else {
      nameEl.innerText = pName;
    }
  }

  const quickBtn = document.getElementById(`p${colNum}-quick-profile-btn`);
  if (quickBtn) {
    if (pId || (pName && pName !== 'Player 1' && pName !== 'Player 2')) {
      quickBtn.style.display = 'inline-flex';
      quickBtn.onclick = () => {
        if (typeof openPlayerModal === 'function') openPlayerModal(pId, pName);
      };
    } else {
      quickBtn.style.display = 'none';
    }
  }

  const teamEl = document.getElementById(`p${colNum}-card-team`);
  if (teamEl) {
    if (p.team) {
      teamEl.innerText = `👥 ${p.team}`;
      teamEl.style.display = 'inline-block';
    } else {
      teamEl.innerText = '';
      teamEl.style.display = 'none';
    }
  }

  const facEl = document.getElementById(`p${colNum}-card-faction`);
  if (facEl) {
    facEl.innerText = activeFac && activeFac !== 'Unknown' ? activeFac : (p.top_faction || 'Various');
    facEl.style.display = 'inline-block';
  }
  const dispBadgesEl = document.getElementById(`p${colNum}-disposition-badges`);
  if (dispBadgesEl) {
    dispBadgesEl.innerHTML = _renderDispositionBadgesHtml(p);
  }

  const eloEl = document.getElementById(`p${colNum}-card-elo`);
  if (eloEl) eloEl.innerText = Number(p.current_elo || 1500).toFixed(1);
  const recEl = document.getElementById(`p${colNum}-card-record`);
  if (recEl) recEl.innerText = `${p.wins || 0}W - ${p.losses || 0}L${p.draws ? ` - ${p.draws}D` : ''}`;
  const wr = p.win_rate !== undefined ? p.win_rate : (p.matches_played > 0 ? ((p.wins / p.matches_played) * 100).toFixed(1) : 0);
  const wrEl = document.getElementById(`p${colNum}-card-winrate`);
  if (wrEl) wrEl.innerText = `${wr}%`;
  const peakEl = document.getElementById(`p${colNum}-card-peak`);
  if (peakEl) peakEl.innerText = Number(p.peak_elo || p.current_elo || 1500).toFixed(1);

  // Populate Interactive Faction Selector & Career Faction Chips
  const selRow = document.getElementById(`p${colNum}-faction-selector-row`);
  const selEl = document.getElementById(`p${colNum}-faction-select`);
  const chipsEl = document.getElementById(`p${colNum}-faction-chips`);
  const careerFacs = _extractPlayerFactionsList(p);

  if (selRow && selEl) {
    selRow.style.display = 'block';
    const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
    const catalogFacs = sys === 'aos' ? STANDARD_AOS_FACTIONS : (sys === '40k' ? STANDARD_40K_FACTIONS : []);
    const summaryFacs = Object.keys(predFaction3MoSummary || {});
    const allKnownSet = new Map();
    [...catalogFacs, ...summaryFacs].forEach(fn => {
      const k = _normPredFacKey(fn);
      if (k && !allKnownSet.has(k)) allKnownSet.set(k, fn);
    });

    const careerKeys = new Set(careerFacs.map(cf => _normPredFacKey(cf.faction)));
    const otherFacs = Array.from(allKnownSet.entries())
      .filter(([k]) => !careerKeys.has(k))
      .map(([, fn]) => fn)
      .sort((a, b) => a.localeCompare(b));

    let optHtml = '';
    if (careerFacs.length > 0) {
      optHtml += `<optgroup label="Player's Career Factions">`;
      careerFacs.forEach(cf => {
        const isSel = _isSamePredFac(cf.faction, activeFac);
        const statsSuffix = cf.games > 0 ? ` (${cf.games}G • ${cf.win_rate.toFixed(0)}% WR)` : '';
        optHtml += `<option value="${escapeHtml(cf.faction)}" ${isSel ? 'selected' : ''}>${escapeHtml(cf.faction)}${statsSuffix}</option>`;
      });
      optHtml += `</optgroup>`;
    }
    if (otherFacs.length > 0) {
      const sysLabel = (typeof getGameSystemLabel === 'function') ? getGameSystemLabel(sys) : (sys === 'aos' ? 'Age of Sigmar' : 'Warhammer 40k');
      optHtml += `<optgroup label="All ${escapeHtml(sysLabel)} Factions">`;
      otherFacs.forEach(fn => {
        const isSel = _isSamePredFac(fn, activeFac);
        optHtml += `<option value="${escapeHtml(fn)}" ${isSel ? 'selected' : ''}>${escapeHtml(fn)}</option>`;
      });
      optHtml += `</optgroup>`;
    }
    selEl.innerHTML = optHtml;
  }

  if (chipsEl) {
    if (careerFacs.length > 0) {
      chipsEl.innerHTML = careerFacs.slice(0, 6).map(cf => {
        const isSel = _isSamePredFac(cf.faction, activeFac);
        const safeFac = String(cf.faction).replace(/'/g, "\\'");
        const bg = isSel
          ? (colNum === 1 ? 'rgba(56, 189, 248, 0.22)' : 'rgba(244, 63, 94, 0.22)')
          : 'rgba(255, 255, 255, 0.04)';
        const border = isSel
          ? (colNum === 1 ? 'rgba(56, 189, 248, 0.6)' : 'rgba(244, 63, 94, 0.6)')
          : 'rgba(255, 255, 255, 0.1)';
        const col = isSel ? '#fff' : 'var(--text-secondary)';
        const subTxt = cf.games > 0 ? ` <span style="opacity:0.8; font-family:var(--font-mono); font-size:0.66rem;">${cf.games}G (${cf.win_rate.toFixed(0)}%)</span>` : '';
        return `
          <button type="button" onclick="onPredictorFactionChange(${colNum}, '${escapeHtml(safeFac)}')" style="background:${bg}; border:1px solid ${border}; color:${col}; border-radius:6px; padding:2px 8px; font-size:0.71rem; font-weight:${isSel ? '800' : '600'}; cursor:pointer; transition:all 0.15s ease;">
            🛡️ ${escapeHtml(cf.faction)}${subTxt}
          </button>
        `;
      }).join('');
    } else {
      chipsEl.innerHTML = '';
    }
  }
}

function _lookup3MoFacEntry(facName) {
  const nk = _normPredFacKey(facName);
  if (!nk) return null;
  const entries = Object.values(predFaction3MoSummary || {});
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e && _normPredFacKey(e.faction) === nk) return e;
  }
  const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
  if (window.casterFaction3MoCache) {
    const cached = window.casterFaction3MoCache[`${sys}:${String(facName || '').trim().toLowerCase()}`];
    if (cached && cached.stats) return cached;
  }
  return null;
}

function _computePredictor3MoMetrics(fac1, fac2) {
  const f1Clean = String(fac1 || 'Army').trim();
  const f2Clean = String(fac2 || 'Army').trim();
  const isMirror = _isSamePredFac(f1Clean, f2Clean);
  const f1Data = _lookup3MoFacEntry(f1Clean);
  const f2Data = _lookup3MoFacEntry(f2Clean);

  const f1Stats = f1Data?.stats || {};
  const f2Stats = f2Data?.stats || {};
  const f1GlobalGames = Number(f1Stats.total_matches || 0);
  const f1GlobalWins = Number(f1Stats.total_wins || 0);
  const f1GlobalLosses = Number(f1Stats.total_losses || 0);
  const f1GlobalWr = Number(f1Stats.win_rate || 0);

  const f2GlobalGames = Number(f2Stats.total_matches || 0);
  const f2GlobalWins = Number(f2Stats.total_wins || 0);
  const f2GlobalLosses = Number(f2Stats.total_losses || 0);
  const f2GlobalWr = Number(f2Stats.win_rate || 0);

  let h2hF1Wins = 0;
  let h2hF2Wins = 0;
  let h2hDraws = 0;
  if (!isMirror) {
    const f1Matchups = Array.isArray(f1Data?.matchups) ? f1Data.matchups : [];
    const directMatches1 = f1Matchups.filter(m => _isSamePredFac(m.opponent_faction || m.opponent, f2Clean));
    if (directMatches1.length > 0) {
      directMatches1.forEach(dm => {
        h2hF1Wins += Number(dm.wins || 0);
        h2hF2Wins += Number(dm.losses || 0);
        h2hDraws += Number(dm.draws || 0);
      });
    } else {
      const f2Matchups = Array.isArray(f2Data?.matchups) ? f2Data.matchups : [];
      const directMatches2 = f2Matchups.filter(m => _isSamePredFac(m.opponent_faction || m.opponent, f1Clean));
      directMatches2.forEach(dm => {
        h2hF2Wins += Number(dm.wins || 0);
        h2hF1Wins += Number(dm.losses || 0);
        h2hDraws += Number(dm.draws || 0);
      });
    }
  }
  const h2hTotal = h2hF1Wins + h2hF2Wins + h2hDraws;
  return {
    fac1: f1Clean,
    fac2: f2Clean,
    isMirror,
    hasLoadedF1: Boolean(f1Data),
    hasLoadedF2: Boolean(f2Data),
    f1GlobalGames,
    f1GlobalWins,
    f1GlobalLosses,
    f1GlobalWr,
    f2GlobalGames,
    f2GlobalWins,
    f2GlobalLosses,
    f2GlobalWr,
    h2hF1Wins,
    h2hF2Wins,
    h2hDraws,
    h2hTotal,
    evF1Wins: 0,
    evF2Wins: 0,
    evDraws: 0,
    evTotal: 0
  };
}

function _extractPlayerMasteryVsOpponent(prof, ownFac, oppFac) {
  const fmList = Array.isArray(prof?.faction_mastery) ? prof.faction_mastery : [];
  const mmList = Array.isArray(prof?.matchup_matrix) ? prof.matchup_matrix : [];

  let ownWins = 0, ownLosses = 0, ownDraws = 0, ownNetElo = 0;
  fmList.forEach(m => {
    if (_isSamePredFac(m.faction, ownFac)) {
      ownWins += Number(m.wins || 0);
      ownLosses += Number(m.losses || 0);
      ownDraws += Number(m.draws || 0);
      ownNetElo += Number(m.net_elo || 0);
    }
  });
  const ownGames = ownWins + ownLosses + ownDraws;
  const ownWr = ownGames > 0 ? (ownWins * 100.0) / ownGames : 50.0;

  let vsWins = 0, vsLosses = 0, vsDraws = 0, vsNetElo = 0;
  mmList.forEach(m => {
    if (_isSamePredFac(m.enemy_faction || m.opponent_faction || m.faction, oppFac)) {
      vsWins += Number(m.wins || 0);
      vsLosses += Number(m.losses || 0);
      vsDraws += Number(m.draws || 0);
      vsNetElo += Number(m.net_elo || 0);
    }
  });
  const vsGames = vsWins + vsLosses + vsDraws;
  const vsWr = vsGames > 0 ? (vsWins * 100.0) / vsGames : 50.0;

  return {
    curFac: ownFac,
    oppFac,
    ownWins,
    ownLosses,
    ownDraws,
    ownGames,
    ownNetElo,
    ownWr,
    vsWins,
    vsLosses,
    vsDraws,
    vsGames,
    vsNetElo,
    vsWr
  };
}

function _computePredictorH2hSummary(h2hList, p1Prof, p2Prof) {
  const p1Id = String(p1Prof?.player_id || predP1?.player_id || '').trim().toLowerCase();
  const p2Id = String(p2Prof?.player_id || predP2?.player_id || '').trim().toLowerCase();
  const p1Name = String(p1Prof?.player_name || predP1?.player_name || 'Player 1').trim();
  const p2Name = String(p2Prof?.player_name || predP2?.player_name || 'Player 2').trim();
  const p1NameL = p1Name.toLowerCase();

  let p1Wins = 0, p2Wins = 0, draws = 0;
  (h2hList || []).forEach(m => {
    if (!m || m.is_bye) return;
    if (m.is_draw) {
      draws++;
      return;
    }
    const wId = String(m.winner_id || '').trim().toLowerCase();
    const m1Id = String(m.player1_id || '').trim().toLowerCase();
    const m1Name = String(m.player1_name || '').trim().toLowerCase();
    const isP1Side1 = (p1Id && m1Id === p1Id) || (p1NameL && m1Name === p1NameL);
    if (wId) {
      if (p1Id && wId === p1Id) p1Wins++;
      else if (p2Id && wId === p2Id) p2Wins++;
    } else if (m.player1_score != null && m.player2_score != null) {
      const s1 = Number(m.player1_score);
      const s2 = Number(m.player2_score);
      if (s1 > s2) {
        if (isP1Side1) p1Wins++;
        else p2Wins++;
      } else if (s2 > s1) {
        if (isP1Side1) p2Wins++;
        else p1Wins++;
      }
    }
  });
  const total = p1Wins + p2Wins + draws;
  let summaryText = 'First Career Meeting (0 Prior Games)';
  if (total > 0) {
    if (p1Wins > p2Wins) {
      summaryText = `${escapeHtml(p1Name)} leads ${p1Wins}W - ${p2Wins}L${draws > 0 ? ` - ${draws}D` : ''} (${total} Career ${total === 1 ? 'Game' : 'Games'})`;
    } else if (p2Wins > p1Wins) {
      summaryText = `${escapeHtml(p2Name)} leads ${p2Wins}W - ${p1Wins}L${draws > 0 ? ` - ${draws}D` : ''} (${total} Career ${total === 1 ? 'Game' : 'Games'})`;
    } else {
      summaryText = `Series Tied ${p1Wins}W - ${p2Wins}L${draws > 0 ? ` - ${draws}D` : ''} (${total} Career ${total === 1 ? 'Game' : 'Games'})`;
    }
  }
  return { p1Wins, p2Wins, draws, total, summaryText };
}

function buildPredictorFaction3MoCardHtml(facMetrics) {
  const m = facMetrics;
  const fac1 = m.fac1 || 'Faction 1';
  const fac2 = m.fac2 || 'Faction 2';
  const isMirror = Boolean(m.isMirror);
  const activeTotal = m.h2hTotal;
  const activeF1W = m.h2hF1Wins;
  const activeF2W = m.h2hF2Wins;
  const activeD = m.h2hDraws;

  const f1Wr = activeTotal > 0 ? (activeF1W * 100.0) / activeTotal : 50.0;
  const f2Wr = activeTotal > 0 ? (activeF2W * 100.0) / activeTotal : 50.0;
  const dPct = activeTotal > 0 ? (activeD * 100.0) / activeTotal : 0.0;
  const f1WrStr = f1Wr.toFixed(1);
  const f2WrStr = f2Wr.toFixed(1);

  let headerBadgeText = '90-Day Rolling Meta';
  let headerBadgeStyle = 'background: rgba(56, 189, 248, 0.14); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35);';
  if (isMirror) {
    headerBadgeText = 'Mirror Matchup (50/50 Faction Parity)';
    headerBadgeStyle = 'background: rgba(168, 85, 247, 0.16); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35);';
  } else if (activeTotal > 0) {
    const fav = f1Wr >= f2Wr ? fac1 : fac2;
    const favWr = Math.max(f1Wr, f2Wr).toFixed(1);
    headerBadgeText = `${fav} Favored (${favWr}% in ${activeTotal}G)`;
  }

  const metaGap = m.f1GlobalWr - m.f2GlobalWr;
  const metaGapStr = `${metaGap >= 0 ? '+' : ''}${metaGap.toFixed(1)}%`;

  return `
    <div class="caster-table-section-card" style="background: rgba(15, 23, 42, 0.78); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1.05rem 1.2rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap;">
        <div>
          <h4 style="margin: 0; font-size: 0.95rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.4rem;">
            <span>⚔️ Global Faction Matchup (Past 3 Months): ${escapeHtml(fac1)} vs ${escapeHtml(fac2)}</span>
          </h4>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;">
            How well <strong>${escapeHtml(fac1)}</strong> and <strong>${escapeHtml(fac2)}</strong> perform against each other and in the global tournament meta over the last 90 days.
          </div>
        </div>
        <span class="badge" style="${headerBadgeStyle} font-size: 0.72rem; font-weight: 700; padding: 3px 9px;">
          ${escapeHtml(headerBadgeText)}
        </span>
      </div>

      ${(!isMirror && activeTotal > 0) ? `
        <div style="background: rgba(9, 14, 26, 0.78); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 0.75rem 0.9rem; margin-bottom: 0.7rem;">
          <div class="caster-factions-tug-grid" style="display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
            <div class="caster-factions-tug-f1" style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
              <div style="font-size: 0.8rem; font-weight: 800; color: #38bdf8; overflow-wrap: break-word;">
                🛡️ ${escapeHtml(fac1)}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 900; color: #fff;">
                ${f1WrStr}% <span style="font-size: 0.72rem; font-weight: 600; color: var(--text-secondary);">(${activeF1W}W-${activeF2W}L${activeD > 0 ? `-${activeD}D` : ''})</span>
              </div>
            </div>

            <div class="caster-factions-tug-sample" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 0.22rem 0.55rem; font-family: var(--font-mono); font-size: 0.7rem; font-weight: 800; color: #cbd5e1; text-align: center; white-space: nowrap;">
              ${activeTotal} ${activeTotal === 1 ? 'Game' : 'Games'} (Past 3 Mo)
            </div>

            <div class="caster-factions-tug-f2" style="display: flex; flex-direction: column; align-items: flex-end; text-align: right; gap: 2px; min-width: 0;">
              <div style="font-size: 0.8rem; font-weight: 800; color: #f43f5e; overflow-wrap: break-word;">
                🛡️ ${escapeHtml(fac2)}
              </div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 900; color: #fff;">
                ${f2WrStr}% <span style="font-size: 0.72rem; font-weight: 600; color: var(--text-secondary);">(${activeF2W}W-${activeF1W}L${activeD > 0 ? `-${activeD}D` : ''})</span>
              </div>
            </div>
          </div>

          <div style="width: 100%; height: 8px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; display: flex;">
            <div style="width: ${f1Wr}%; height: 100%; background: linear-gradient(90deg, #0284c7, #38bdf8);"></div>
            ${dPct > 0 ? `<div style="width: ${dPct}%; height: 100%; background: #64748b;"></div>` : ''}
            <div style="width: ${f2Wr}%; height: 100%; background: linear-gradient(90deg, #f43f5e, #e11d48);"></div>
          </div>
        </div>
      ` : (!isMirror ? `
        <div style="background: rgba(9, 14, 26, 0.55); border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 0.65rem 0.85rem; text-align: center; color: var(--text-muted); font-size: 0.77rem; margin-bottom: 0.7rem;">
          📊 No direct global tournament games recorded between <strong>${escapeHtml(fac1)}</strong> and <strong>${escapeHtml(fac2)}</strong> in the past 3 months — see each faction's 90-day overall meta standing below.
        </div>
      ` : '')}

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 0.55rem;">
        <div style="background: rgba(9, 14, 26, 0.65); border: 1px solid rgba(56, 189, 248, 0.22); border-radius: 8px; padding: 0.55rem 0.7rem;">
          <div style="font-size: 0.65rem; font-weight: 800; text-transform: uppercase; color: #38bdf8; letter-spacing: 0.03em;">
            🛡️ ${escapeHtml(fac1)} • 3-Mo Meta Form
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: #fff; margin-top: 2px;">
            ${m.f1GlobalGames > 0
              ? `<span style="color: ${m.f1GlobalWr >= 52 ? '#4ade80' : (m.f1GlobalWr <= 45 ? '#f87171' : '#fbbf24')};">${m.f1GlobalWr.toFixed(1)}% WR</span> <span style="font-size: 0.72rem; color: var(--text-secondary);">(${m.f1GlobalWins}W-${m.f1GlobalLosses}L • ${m.f1GlobalGames}G)</span>`
              : '<span style="color:var(--text-muted);">No 90d global games</span>'}
          </div>
        </div>

        <div style="background: rgba(9, 14, 26, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 0.55rem 0.7rem;">
          <div style="font-size: 0.65rem; font-weight: 800; text-transform: uppercase; color: #c084fc; letter-spacing: 0.03em;">
            ⚖️ 90-Day Meta Win Rate Delta
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: #fff; margin-top: 2px;">
            ${isMirror
              ? 'Mirror Matchup (0.0% Delta)'
              : ((m.f1GlobalGames > 0 && m.f2GlobalGames > 0)
                ? `<span style="color:${metaGap >= 0 ? '#38bdf8' : '#f43f5e'};">${metaGapStr}</span> <span style="font-size:0.71rem; color:var(--text-secondary);">(${escapeHtml(metaGap >= 0 ? fac1 : fac2)} Meta Edge)</span>`
                : '<span style="color:var(--text-muted);">Neutral Meta Standing</span>')}
          </div>
        </div>

        <div style="background: rgba(9, 14, 26, 0.65); border: 1px solid rgba(244, 63, 94, 0.22); border-radius: 8px; padding: 0.55rem 0.7rem;">
          <div style="font-size: 0.65rem; font-weight: 800; text-transform: uppercase; color: #f43f5e; letter-spacing: 0.03em;">
            🛡️ ${escapeHtml(fac2)} • 3-Mo Meta Form
          </div>
          <div style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: #fff; margin-top: 2px;">
            ${m.f2GlobalGames > 0
              ? `<span style="color: ${m.f2GlobalWr >= 52 ? '#4ade80' : (m.f2GlobalWr <= 45 ? '#f87171' : '#fbbf24')};">${m.f2GlobalWr.toFixed(1)}% WR</span> <span style="font-size: 0.72rem; color: var(--text-secondary);">(${m.f2GlobalWins}W-${m.f2GlobalLosses}L • ${m.f2GlobalGames}G)</span>`
              : '<span style="color:var(--text-muted);">No 90d global games</span>'}
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildPredictorSingleDossierCardHtml(colNum, prof, oppProf, ownFac, oppFac, masteryStats, gainOnWin) {
  const accentColor = colNum === 1 ? '#38bdf8' : '#f43f5e';
  const borderAccent = colNum === 1 ? 'rgba(56, 189, 248, 0.35)' : 'rgba(244, 63, 94, 0.35)';
  const pid = String(prof?.player_id || '').trim();
  const pname = String(prof?.player_name || `Player ${colNum}`).trim();
  const safePid = pid.replace(/'/g, "\\'");
  const safeName = pname.replace(/'/g, "\\'");

  const careerElo = Number(prof?.current_elo || 1500);
  const peakElo = Math.max(careerElo, Number(prof?.peak_elo || careerElo));
  const careerWins = Number(prof?.wins || 0);
  const careerLosses = Number(prof?.losses || 0);
  const careerDraws = Number(prof?.draws || 0);
  const careerTotal = Math.max(1, careerWins + careerLosses + careerDraws);
  const careerWr = ((careerWins / careerTotal) * 100).toFixed(1);
  const maxStreak = Number(prof?.longest_win_streak || 0);

  const ownGames = masteryStats.ownGames;
  const ownWins = masteryStats.ownWins;
  const ownLosses = masteryStats.ownLosses;
  const ownDraws = masteryStats.ownDraws;
  const ownNetElo = masteryStats.ownNetElo;
  const ownWrNum = ownGames > 0 ? masteryStats.ownWr : 0;
  const ownWrStr = ownWrNum.toFixed(1);
  const ownNetStr = (ownNetElo >= 0 ? '+' : '') + ownNetElo.toFixed(1);
  const ownBarCol = ownWrNum >= 55 ? '#10b981' : (ownWrNum >= 48 ? accentColor : '#f43f5e');

  const vsGames = masteryStats.vsGames;
  const vsWins = masteryStats.vsWins;
  const vsLosses = masteryStats.vsLosses;
  const vsDraws = masteryStats.vsDraws;
  const vsNetElo = masteryStats.vsNetElo;
  const vsWrNum = vsGames > 0 ? masteryStats.vsWr : 0;
  const vsWrStr = vsWrNum.toFixed(1);
  const vsNetStr = (vsNetElo >= 0 ? '+' : '') + vsNetElo.toFixed(1);
  const vsBarCol = vsGames === 0 ? 'rgba(148,163,184,0.35)' : (vsWrNum >= 55 ? '#10b981' : (vsWrNum >= 48 ? '#fbbf24' : '#f43f5e'));

  const getMasteryTierBadge = (games, wr) => {
    if (games >= 20 && wr >= 60) return { label: '👑 Grandmaster', bg: 'rgba(245, 158, 11, 0.18)', col: '#fbbf24', border: 'rgba(245, 158, 11, 0.45)' };
    if (games >= 10 && wr >= 55) return { label: '🔥 Master', bg: 'rgba(168, 85, 247, 0.18)', col: '#c084fc', border: 'rgba(168, 85, 247, 0.45)' };
    if (games >= 5) return { label: '⚔️ Veteran Specialist', bg: 'rgba(56, 189, 248, 0.15)', col: '#38bdf8', border: 'rgba(56, 189, 248, 0.35)' };
    return { label: '🛡️ Faction Adept', bg: 'rgba(148, 163, 184, 0.15)', col: '#cbd5e1', border: 'rgba(148, 163, 184, 0.3)' };
  };
  const tierBadge = getMasteryTierBadge(ownGames, ownWrNum);

  const recentMatches = Array.isArray(prof?.recent_matches) ? prof.recent_matches : [];
  const recentRowsHtml = recentMatches.slice(0, 6).map(m => {
    const resC = String(m.result || 'D').toUpperCase();
    const mySc = m.player_score != null ? m.player_score : '-';
    const opSc = m.opponent_score != null ? m.opponent_score : '-';
    const hasScores = m.player_score != null && m.opponent_score != null;
    const scoreTxt = hasScores ? ` ${mySc}-${opSc}` : '';
    const pillClass = resC === 'W' ? 'badge-win' : (resC === 'L' ? 'badge-loss' : 'badge-draw');
    const opName = String(m.opponent_name || 'Opponent');
    const opPid = String(m.opponent_id || '');
    const safeOpName = opName.replace(/'/g, "\\'");
    const safeOpPid = opPid.replace(/'/g, "\\'");
    const evId = String(m.event_id || '').trim();
    const safeEvId = evId.replace(/'/g, "\\'");
    const evName = String(m.event_name || 'Tournament');
    const deltaVal = Number(m.delta_elo || 0);
    const deltaStr = `${deltaVal >= 0 ? '+' : ''}${deltaVal.toFixed(1)}`;
    const deltaCol = deltaVal >= 0 ? '#4ade80' : '#f87171';

    return `
      <div class="caster-path-row" style="display: flex; align-items: center; justify-content: space-between; gap: 0.45rem; padding: 0.42rem 0.55rem; background: rgba(0,0,0,0.24); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; font-size: 0.74rem;">
        <div style="display: flex; align-items: center; gap: 0.4rem; min-width: 0; flex: 1;">
          <span class="badge ${pillClass}" style="font-size: 0.65rem; white-space: nowrap; flex-shrink: 0;">${resC}${scoreTxt}</span>
          <div style="min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px;">
            <div style="display: flex; align-items: center; gap: 0.3rem; min-width: 0; flex-wrap: wrap;">
              <span style="color: var(--text-muted); font-size: 0.67rem;">vs</span>
              <span class="player-link" onclick="openPlayerModal('${escapeHtml(safeOpPid)}', '${escapeHtml(safeOpName)}')" style="font-weight: 700; color: #e2e8f0; cursor: pointer; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(opName)}</span>
              ${m.opponent_faction ? `<span style="color: var(--text-muted); font-size: 0.66rem;">(${escapeHtml(m.opponent_faction)})</span>` : ''}
            </div>
            <div style="color: var(--text-muted); font-size: 0.65rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
              ${evId ? `<span class="player-link" onclick="if(typeof openEventModal==='function') openEventModal('${escapeHtml(safeEvId)}', false)" style="cursor:pointer; color:var(--text-secondary);">${escapeHtml(evName)}</span>` : escapeHtml(evName)}
              • R${m.round || 1} • ${escapeHtml(m.match_date || '')}
            </div>
          </div>
        </div>
        <span style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; color: ${deltaCol}; flex-shrink: 0;">${deltaStr}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="caster-dossier-player-card" style="background: rgba(15, 23, 42, 0.78); border: 1px solid ${borderAccent}; border-radius: 10px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; min-width: 0;">
      <!-- Dossier Header -->
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.65rem; flex-wrap: wrap;">
        <div style="min-width: 0; flex: 1;">
          <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
            <span class="player-link" onclick="openPlayerModal('${escapeHtml(safePid)}', '${escapeHtml(safeName)}')" style="font-size: 1.02rem; font-weight: 800; color: #fff; cursor: pointer; text-decoration: underline; text-decoration-color: ${accentColor}; text-underline-offset: 3px;">
              👤 ${escapeHtml(pname)}
            </span>
            <span style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: ${accentColor};">${careerElo.toFixed(1)} Elo</span>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">
            🛡️ Active Faction: <strong style="color: ${accentColor};">${escapeHtml(ownFac)}</strong>
            ${prof?.team ? ` • 👥 ${escapeHtml(prof.team)}` : ''}
          </div>
          ${_renderDispositionBadgesHtml(prof) ? `<div class="pred-disposition-badges" style="margin-top: 0.35rem;">${_renderDispositionBadgesHtml(prof)}</div>` : ''}
        </div>
        <button type="button" class="btn-sm btn-outline" onclick="openPlayerModal('${escapeHtml(safePid)}', '${escapeHtml(safeName)}')" style="font-size: 0.72rem; padding: 3px 9px; color: #f8fafc; border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); cursor: pointer; font-weight: 700;">
          👤 Full Dossier
        </button>
      </div>

      <!-- 3 Career KPI Boxes -->
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem;">
        <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.38rem 0.45rem; min-width: 0;">
          <div style="font-size: 0.58rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Peak Elo 👑</div>
          <div style="font-family: var(--font-mono); font-size: 0.82rem; font-weight: 800; color: #fbbf24;">${peakElo.toFixed(1)}</div>
        </div>
        <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.38rem 0.45rem; min-width: 0;">
          <div style="font-size: 0.58rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Career Record</div>
          <div style="font-family: var(--font-mono); font-size: 0.74rem; font-weight: 800; color: #fff; display: flex; align-items: baseline; gap: 3px; flex-wrap: wrap;">
            <span>${careerWins}W-${careerLosses}L</span>
            <span style="color:#4ade80; font-size:0.65rem;">(${careerWr}%)</span>
          </div>
        </div>
        <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.38rem 0.45rem; min-width: 0;">
          <div style="font-size: 0.58rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Best Streak</div>
          <div style="font-family: var(--font-mono); font-size: 0.76rem; font-weight: 800; color: #fb923c;">🔥 ${maxStreak} Wins</div>
        </div>
      </div>

      <!-- Faction & Matchup Mastery Card -->
      <div style="background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 0.65rem 0.75rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; margin-bottom: 0.55rem; flex-wrap: wrap;">
          <span style="font-size: 0.73rem; font-weight: 800; text-transform: uppercase; color: ${accentColor}; letter-spacing: 0.04em;">
            🛡️ Faction & Matchup Mastery
          </span>
          <span class="badge" style="background: ${tierBadge.bg}; color: ${tierBadge.col}; border: 1px solid ${tierBadge.border}; font-size: 0.67rem; font-weight: 800; padding: 2px 7px;">
            ${tierBadge.label}
          </span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.55rem;">
          <!-- Row 1: Own Faction Proficiency -->
          <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 0.45rem 0.55rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.35rem; flex-wrap: wrap; font-size: 0.75rem;">
              <span style="font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 0.3rem;">
                <span>🛡️ Playing as <strong>${escapeHtml(ownFac)}</strong></span>
                <span style="color: var(--text-muted); font-weight: 600; font-size: 0.68rem;">(${ownGames}G)</span>
              </span>
              ${ownGames > 0 ? `
                <span style="font-family: var(--font-mono); font-size: 0.74rem;">
                  <strong style="color: ${ownBarCol};">${ownWrStr}% WR</strong>
                  <span style="color: var(--text-secondary);">(${ownWins}W-${ownLosses}L${ownDraws ? `-${ownDraws}D` : ''})</span>
                  <span style="color: ${ownNetElo >= 0 ? '#4ade80' : '#f87171'}; margin-left: 3px;">${ownNetStr} Elo</span>
                </span>
              ` : `
                <span style="font-family: var(--font-mono); font-size: 0.71rem; color: var(--text-muted);">
                  0 Recorded Career Games
                </span>
              `}
            </div>
            <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
              <div style="width: ${ownGames > 0 ? Math.min(100, Math.max(4, ownWrNum)) : 0}%; height: 100%; background: ${ownBarCol};"></div>
            </div>
          </div>

          <!-- Row 2: Matchup vs. Opponent's Faction -->
          <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 0.45rem 0.55rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.35rem; flex-wrap: wrap; font-size: 0.75rem;">
              <span style="font-weight: 700; color: #f8fafc; display: flex; align-items: center; gap: 0.3rem;">
                <span>🎯 Playing vs. <strong>${escapeHtml(oppFac)}</strong></span>
                <span style="color: var(--text-muted); font-weight: 600; font-size: 0.68rem;">(${vsGames}G)</span>
              </span>
              ${vsGames > 0 ? `
                <span style="font-family: var(--font-mono); font-size: 0.74rem;">
                  <strong style="color: ${vsBarCol};">${vsWrStr}% WR</strong>
                  <span style="color: var(--text-secondary);">(${vsWins}W-${vsLosses}L${vsDraws ? `-${vsDraws}D` : ''})</span>
                  <span style="color: ${vsNetElo >= 0 ? '#4ade80' : '#f87171'}; margin-left: 3px;">${vsNetStr} Elo</span>
                </span>
              ` : `
                <span style="font-family: var(--font-mono); font-size: 0.71rem; color: var(--text-muted);">
                  No Prior Recorded Games
                </span>
              `}
            </div>
            <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
              <div style="width: ${vsGames > 0 ? Math.min(100, Math.max(4, vsWrNum)) : 0}%; height: 100%; background: ${vsBarCol};"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Tournament History -->
      <div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem; flex-wrap: wrap; gap: 0.25rem;">
          <span style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.04em;">
            ⚔️ Recent Tournament Form (${recentMatches.length} Shown)
          </span>
          <span style="font-size: 0.7rem; font-family: var(--font-mono); color: #4ade80;">Win Stakes: +${gainOnWin.toFixed(1)} Elo</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.3rem; max-height: 230px; overflow-y: auto;">
          ${recentRowsHtml || '<div style="font-size:0.75rem; color:var(--text-muted);">No recent match records available.</div>'}
        </div>
      </div>
    </div>
  `;
}

function recomputeAndRenderPredictorMatchup() {
  if (!predP1 || !predP2) return;
  const p1Prof = predP1Profile || predP1;
  const p2Prof = predP2Profile || predP2;
  const p1Name = p1Prof.player_name || p1Prof.full_name || 'Player 1';
  const p2Name = p2Prof.player_name || p2Prof.full_name || 'Player 2';
  const elo1 = Number(p1Prof.current_elo || predP1.current_elo || 1500.0);
  const elo2 = Number(p2Prof.current_elo || predP2.current_elo || 1500.0);

  const fac1 = predP1SelectedFaction || p1Prof.primary_faction || 'Unknown';
  const fac2 = predP2SelectedFaction || p2Prof.primary_faction || 'Unknown';

  const fac3MoMetrics = _computePredictor3MoMetrics(fac1, fac2);
  const p1Mastery = _extractPlayerMasteryVsOpponent(p1Prof, fac1, fac2);
  const p2Mastery = _extractPlayerMasteryVsOpponent(p2Prof, fac2, fac1);
  const h2hSummary = _computePredictorH2hSummary(predH2hMatches, p1Prof, p2Prof);

  const mlPred = computeCalibratedMlMatchupClient({
    p1Prof,
    p2Prof,
    elo1,
    elo2,
    fac1,
    fac2,
    p1Mastery,
    p2Mastery,
    h2hMatches: predH2hMatches
  });

  const p1Prob = Number(mlPred.p1_win_prob);
  const drawProb = Number(mlPred.draw_prob || 0);
  const p2Prob = Number(mlPred.p2_win_prob);

  const probEl1 = document.getElementById('pred-p1-prob');
  const probDrawEl = document.getElementById('pred-draw-prob');
  const probEl2 = document.getElementById('pred-p2-prob');
  const barEl1 = document.getElementById('pred-bar-p1');
  const barDrawEl = document.getElementById('pred-bar-draw');
  const barEl2 = document.getElementById('pred-bar-p2');

  if (probEl1) probEl1.innerText = `${p1Prob.toFixed(1)}%`;
  if (probDrawEl) {
    if (drawProb >= 0.4) {
      probDrawEl.style.display = 'inline-block';
      probDrawEl.innerText = `Draw ${drawProb.toFixed(1)}%`;
    } else {
      probDrawEl.style.display = 'none';
      probDrawEl.innerText = '';
    }
  }
  if (probEl2) probEl2.innerText = `${p2Prob.toFixed(1)}%`;
  if (barEl1) barEl1.style.width = `${p1Prob}%`;
  if (barDrawEl) barDrawEl.style.width = `${drawProb}%`;
  if (barEl2) barEl2.style.width = `${p2Prob}%`;

  const pureExp1 = 1.0 / (1.0 + Math.pow(10.0, (elo2 - elo1) / 400.0));
  const pureP1Prob = (pureExp1 * 100.0).toFixed(1);
  const pureP2Prob = ((1.0 - pureExp1) * 100.0).toFixed(1);

  const headerBadgesEl = document.getElementById('pred-header-badges');
  const mlEnginePillEl = document.getElementById('pred-ml-engine-pill');
  const eloGapPillEl = document.getElementById('pred-elo-gap-pill');
  const pureEloPillEl = document.getElementById('pred-pure-elo-pill');
  if (headerBadgesEl) headerBadgesEl.style.display = 'flex';
  if (mlEnginePillEl) {
    const isDedicatedMl = mlPred.model_mode === 'dedicated_ml';
    mlEnginePillEl.className = `pred-ml-engine-pill ${isDedicatedMl ? 'mode-ml' : 'mode-elo'}`;
    mlEnginePillEl.innerText = `${isDedicatedMl ? '🤖' : '📐'} ${mlPred.model_label} • ${mlPred.confidence} Conf`;
    mlEnginePillEl.title = isDedicatedMl
      ? 'Symmetrized Monotonic Gradient-Boosted Decision Trees + Davidson 3-Way Calibration trained on clean 1v1 tournament matches'
      : 'Uncertainty-Attenuated Elo + Bayesian-Shrunk Residual Model';
  }
  if (eloGapPillEl) eloGapPillEl.innerText = `±${Math.abs(elo1 - elo2).toFixed(1)} Base Elo Gap`;
  if (pureEloPillEl) pureEloPillEl.innerText = `Pure Elo: ${pureP1Prob}% vs ${pureP2Prob}%`;

  // Render Calibrated 5-Pillar Attribution Strip
  const breakdownEl = document.getElementById('pred-multi-factor-breakdown');
  if (breakdownEl) {
    breakdownEl.innerHTML = buildMlFactorAttributionHtml(mlPred, p1Name, p2Name, fac1, fac2);
  }

  // Render Matchup Context Strip (H2H + 90d Faction + Learned Score / WTC Projection)
  const contextStripEl = document.getElementById('pred-context-strip');
  if (contextStripEl) {
    let facMatchupText = '';
    if (!fac3MoMetrics.isMirror && fac3MoMetrics.h2hTotal > 0) {
      const wr = Math.round((fac3MoMetrics.h2hF1Wins / fac3MoMetrics.h2hTotal) * 100);
      facMatchupText = `${escapeHtml(fac1)} ${wr}% WR vs ${escapeHtml(fac2)} (${fac3MoMetrics.h2hF1Wins}W-${fac3MoMetrics.h2hF2Wins}L${fac3MoMetrics.h2hDraws > 0 ? `-${fac3MoMetrics.h2hDraws}D` : ''}, Past 3 Mo)`;
    } else if (fac3MoMetrics.isMirror) {
      facMatchupText = `${escapeHtml(fac1)} Mirror Matchup`;
    } else {
      facMatchupText = `${escapeHtml(fac1)} vs ${escapeHtml(fac2)} (0 Direct 90d Games)`;
    }
    const proj = mlPred.projected || {};
    const scoreProjHtml = `<div>🎯 <strong>Projected Score:</strong> <span style="font-family:var(--font-mono); font-weight:800; color:#38bdf8;">${proj.p1_score} - ${proj.p2_score} ${escapeHtml(proj.score_unit || 'VP')}</span></div>`;
    const wtcProjHtml = proj.has_wtc_matrix
      ? `<div>🏆 <strong>WTC Matrix (0-20):</strong> <span style="font-family:var(--font-mono); font-weight:800; color:#fbbf24;">${proj.wtc_p1} - ${proj.wtc_p2}</span> <span style="font-size:0.72rem; color:var(--text-muted);">(${proj.wtc_p1_exact}-${proj.wtc_p2_exact} EV • ${proj.tight_game_prob}% ≤15VP)</span></div>`
      : '';
    contextStripEl.style.display = 'flex';
    contextStripEl.innerHTML = `
      <div>⚔️ <strong>Past Head-to-Head:</strong> ${h2hSummary.summaryText}</div>
      <div>📊 <strong>Faction Matchup (3-Mo):</strong> ${facMatchupText}</div>
      ${scoreProjHtml}
      ${wtcProjHtml}
    `;
  }

  // Pure Elo Stakes (strictly unaffected by prediction modifiers)
  const res = predLastResponse || {};
  const dP1Win = Number((res.deltas && res.deltas.p1_win) !== undefined ? res.deltas.p1_win : (32.0 * (1.0 - pureExp1)));
  const dP2Win = Number((res.deltas && res.deltas.p2_win) !== undefined ? res.deltas.p2_win : (32.0 * pureExp1));
  const dP1Draw = Number((res.deltas && res.deltas.p1_draw) !== undefined ? res.deltas.p1_draw : (32.0 * (0.5 - pureExp1)));
  const dP2Draw = Number((res.deltas && res.deltas.p2_draw) !== undefined ? res.deltas.p2_draw : (32.0 * (0.5 - (1.0 - pureExp1))));

  const elDeltaP1Win = document.getElementById('delta-p1-win');
  const elNewP1Win = document.getElementById('new-p1-win-elo');
  const elDeltaP2Loss = document.getElementById('delta-p2-loss');
  const elNewP2Loss = document.getElementById('new-p2-loss-elo');

  if (elDeltaP1Win) elDeltaP1Win.innerText = `+${dP1Win.toFixed(1)}`;
  if (elNewP1Win) elNewP1Win.innerText = `(${(elo1 + dP1Win).toFixed(1)})`;
  if (elDeltaP2Loss) elDeltaP2Loss.innerText = `-${dP1Win.toFixed(1)}`;
  if (elNewP2Loss) elNewP2Loss.innerText = `(${(elo2 - dP1Win).toFixed(1)})`;

  const elDeltaP1Loss = document.getElementById('delta-p1-upset-loss');
  const elNewP1Loss = document.getElementById('new-p1-loss-elo');
  const elDeltaP2Win = document.getElementById('delta-p2-upset-win');
  const elNewP2Win = document.getElementById('new-p2-win-elo');

  if (elDeltaP1Loss) elDeltaP1Loss.innerText = `-${dP2Win.toFixed(1)}`;
  if (elNewP1Loss) elNewP1Loss.innerText = `(${(elo1 - dP2Win).toFixed(1)})`;
  if (elDeltaP2Win) elDeltaP2Win.innerText = `+${dP2Win.toFixed(1)}`;
  if (elNewP2Win) elNewP2Win.innerText = `(${(elo2 + dP2Win).toFixed(1)})`;

  const elDeltaP1Draw = document.getElementById('delta-p1-draw');
  const elDeltaP2Draw = document.getElementById('delta-p2-draw');
  if (elDeltaP1Draw) elDeltaP1Draw.innerText = `${dP1Draw >= 0 ? '+' : ''}${dP1Draw.toFixed(1)}`;
  if (elDeltaP2Draw) elDeltaP2Draw.innerText = `${dP2Draw >= 0 ? '+' : ''}${dP2Draw.toFixed(1)}`;

  // Render Global Faction Matchup (Past 3 Months) Card
  const fac3MoContainer = document.getElementById('pred-faction-3mo-container');
  if (fac3MoContainer) {
    fac3MoContainer.innerHTML = buildPredictorFaction3MoCardHtml(fac3MoMetrics);
  }

  // Render Side-by-Side Commander Dossiers
  const dossiersContainer = document.getElementById('pred-commander-dossiers-container');
  if (dossiersContainer) {
    dossiersContainer.innerHTML = `
      <div class="caster-table-section-card" style="background: rgba(15, 23, 42, 0.78); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 1.15rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <h4 style="margin: 0; font-size: 0.98rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 0.45rem;">
              <span>🎖️ Commander Dossiers: Faction Mastery, Vs-Faction Matrix & Recent Tournament Form</span>
            </h4>
            <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 2px;">
              Switch either player's <strong>Active Faction</strong> above to simulate different army matchups in real time, or click any player or tournament to inspect their full dossier.
            </div>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 1rem;">
          ${buildPredictorSingleDossierCardHtml(1, p1Prof, p2Prof, fac1, fac2, p1Mastery, dP1Win)}
          ${buildPredictorSingleDossierCardHtml(2, p2Prof, p1Prof, fac2, fac1, p2Mastery, dP2Win)}
        </div>
      </div>
    `;
  }

  // Update H2H Summary Badge & Table
  const h2hBadgeEl = document.getElementById('pred-h2h-summary-badge');
  if (h2hBadgeEl) {
    h2hBadgeEl.style.display = 'inline-block';
    if (h2hSummary.total > 0) {
      h2hBadgeEl.style.background = 'rgba(56, 189, 248, 0.14)';
      h2hBadgeEl.style.color = '#38bdf8';
      h2hBadgeEl.style.border = '1px solid rgba(56, 189, 248, 0.35)';
      h2hBadgeEl.innerHTML = `⚔️ ${h2hSummary.summaryText}`;
    } else {
      h2hBadgeEl.style.background = 'rgba(148, 163, 184, 0.12)';
      h2hBadgeEl.style.color = '#94a3b8';
      h2hBadgeEl.style.border = '1px solid rgba(148, 163, 184, 0.25)';
      h2hBadgeEl.innerText = 'First Career Meeting (0 Prior Games)';
    }
  }
  renderHeadToHeadHistory(predH2hMatches);
}

async function runPrediction() {
  if (!predP1 || !predP2) return;
  try {
    const p1Identifier = predP1.player_id || predP1.player_name;
    const p2Identifier = predP2.player_id || predP2.player_name;
    const currentSys = typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k';
    const res = await window.api.predictMatch(
      p1Identifier,
      p2Identifier,
      currentSys,
      predP1SelectedFaction,
      predP2SelectedFaction
    );
    if (!res || res.error) {
      console.error('Prediction API error:', res ? res.error : 'Unknown');
      return;
    }

    predLastResponse = res;
    if (res.faction_3mo_summary && typeof res.faction_3mo_summary === 'object') {
      predFaction3MoSummary = res.faction_3mo_summary;
    }
    if (res.p1_profile && typeof res.p1_profile === 'object') {
      predP1Profile = { ...predP1, ...res.p1_profile };
      if (!predP1SelectedFaction || predP1SelectedFaction === 'Unknown' || predP1SelectedFaction === 'Various') {
        predP1SelectedFaction = predP1Profile.primary_faction || predP1SelectedFaction;
      }
      updatePredictCard(1, predP1Profile);
    }
    if (res.p2_profile && typeof res.p2_profile === 'object') {
      predP2Profile = { ...predP2, ...res.p2_profile };
      if (!predP2SelectedFaction || predP2SelectedFaction === 'Unknown' || predP2SelectedFaction === 'Various') {
        predP2SelectedFaction = predP2Profile.primary_faction || predP2SelectedFaction;
      }
      updatePredictCard(2, predP2Profile);
    }
    predH2hMatches = Array.isArray(res.head_to_head) ? res.head_to_head : [];

    recomputeAndRenderPredictorMatchup();
  } catch (err) {
    console.error('Prediction failed:', err);
  }
}

function renderHeadToHeadHistory(h2h) {
  const tbody = document.getElementById('h2h-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!h2h || h2h.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No previous head-to-head match encounters between these players.</td></tr>';
    return;
  }

  const p1Id = String((predP1Profile || predP1)?.player_id || '');
  const p2Id = String((predP2Profile || predP2)?.player_id || '');
  const p1Name = (predP1Profile || predP1)?.player_name || 'Player 1';
  const p2Name = (predP2Profile || predP2)?.player_name || 'Player 2';

  h2h.forEach(m => {
    const tr = document.createElement('tr');
    const isP1Side1 = String(m.player1_id || '') === p1Id;

    const scoreP1 = isP1Side1
      ? (m.player1_score !== null && m.player1_score !== undefined ? m.player1_score : '-')
      : (m.player2_score !== null && m.player2_score !== undefined ? m.player2_score : '-');
    const scoreP2 = isP1Side1
      ? (m.player2_score !== null && m.player2_score !== undefined ? m.player2_score : '-')
      : (m.player1_score !== null && m.player1_score !== undefined ? m.player1_score : '-');
    const facP1 = isP1Side1 ? (m.player1_faction || '') : (m.player2_faction || '');
    const facP2 = isP1Side1 ? (m.player2_faction || '') : (m.player1_faction || '');

    const winnerId = String(m.winner_id || '');
    const isP1Winner = winnerId === p1Id;
    const isP2Winner = winnerId === p2Id;

    let outcomeText = 'Draw';
    let badgeClass = 'badge-draw';
    if (m.is_draw) {
      outcomeText = 'Draw';
      badgeClass = 'badge-draw';
    } else if (isP1Winner) {
      outcomeText = `${p1Name} Win`;
      badgeClass = 'badge-win';
    } else if (isP2Winner) {
      outcomeText = `${p2Name} Win`;
      badgeClass = 'badge-win';
    } else {
      outcomeText = 'Completed';
      badgeClass = 'badge-win';
    }

    const eventName = m.event_name || 'Tournament';
    const eventId = m.event_id ? String(m.event_id).trim() : '';

    tr.innerHTML = `
      <td style="font-family:var(--font-mono); color:var(--text-muted); font-size:0.85rem;">${(m.match_date || '').slice(0, 10)}</td>
      <td class="h2h-event-cell" style="${eventId ? 'cursor:pointer;' : ''}">
        ${eventId ? `<span class="player-link" style="font-weight:600; cursor:pointer;" title="View Tournament Details">${escapeHtml(eventName)}</span>` : `<span style="font-weight:600; color:#fff;">${escapeHtml(eventName)}</span>`}
      </td>
      <td style="font-family:var(--font-mono);">R${m.round || 1}</td>
      <td>
        <span style="font-family:var(--font-mono); font-weight:700; color:${isP1Winner ? 'var(--win)' : 'var(--text-secondary)'};">${scoreP1}</span>
        ${facP1 ? `<span style="font-size:0.72rem; color:var(--text-muted); margin-left:4px;">(${escapeHtml(facP1)})</span>` : ''}
      </td>
      <td>
        <span style="font-family:var(--font-mono); font-weight:700; color:${isP2Winner ? 'var(--win)' : 'var(--text-secondary)'};">${scoreP2}</span>
        ${facP2 ? `<span style="font-size:0.72rem; color:var(--text-muted); margin-left:4px;">(${escapeHtml(facP2)})</span>` : ''}
      </td>
      <td><span class="badge ${badgeClass}">${escapeHtml(outcomeText)}</span></td>
    `;

    if (eventId) {
      const eventCell = tr.querySelector('.h2h-event-cell');
      if (eventCell) {
        eventCell.onclick = (e) => {
          e.stopPropagation();
          if (typeof openEventModal === 'function') {
            openEventModal(eventId, false);
          }
        };
      }
    }

    tbody.appendChild(tr);
  });
}

function resetPredictorState() {
  predP1 = null;
  predP2 = null;
  predP1Profile = null;
  predP2Profile = null;
  predP1SelectedFaction = '';
  predP2SelectedFaction = '';
  predH2hMatches = [];
  predLastResponse = null;

  [1, 2].forEach(colNum => {
    const inp = document.getElementById(`p${colNum}-name-input`);
    if (inp) inp.value = '';
    const dd = document.getElementById(`p${colNum}-ac-dropdown`);
    if (dd) dd.style.display = 'none';
    const nameEl = document.getElementById(`p${colNum}-card-name`);
    if (nameEl) nameEl.innerText = `Player ${colNum}`;
    const teamEl = document.getElementById(`p${colNum}-card-team`);
    if (teamEl) {
      teamEl.innerText = '';
      teamEl.style.display = 'none';
    }
    const quickBtn = document.getElementById(`p${colNum}-quick-profile-btn`);
    if (quickBtn) quickBtn.style.display = 'none';
    const facEl = document.getElementById(`p${colNum}-card-faction`);
    if (facEl) {
      facEl.innerText = '';
      facEl.style.display = 'none';
    }
    const dispBadgesEl = document.getElementById(`p${colNum}-disposition-badges`);
    if (dispBadgesEl) dispBadgesEl.innerHTML = '';
    const selRow = document.getElementById(`p${colNum}-faction-selector-row`);
    if (selRow) selRow.style.display = 'none';
    const chipsEl = document.getElementById(`p${colNum}-faction-chips`);
    if (chipsEl) chipsEl.innerHTML = '';
    const eloEl = document.getElementById(`p${colNum}-card-elo`);
    if (eloEl) eloEl.innerText = '1500';
    const recEl = document.getElementById(`p${colNum}-card-record`);
    if (recEl) recEl.innerText = '';
    const wrEl = document.getElementById(`p${colNum}-card-winrate`);
    if (wrEl) wrEl.innerText = '';
    const peakEl = document.getElementById(`p${colNum}-card-peak`);
    if (peakEl) peakEl.innerText = '';
  });

  [
    'pred-p1-prob', 'pred-draw-prob', 'pred-p2-prob', 'pred-ml-engine-pill',
    'delta-p1-win', 'new-p1-win-elo', 'delta-p2-loss', 'new-p2-loss-elo',
    'delta-p1-upset-loss', 'new-p1-loss-elo', 'delta-p2-upset-win', 'new-p2-win-elo',
    'delta-p1-draw', 'delta-p2-draw'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = '';
  });
  const probDrawEl = document.getElementById('pred-draw-prob');
  if (probDrawEl) probDrawEl.style.display = 'none';

  const headerBadgesEl = document.getElementById('pred-header-badges');
  if (headerBadgesEl) headerBadgesEl.style.display = 'none';
  const breakdownEl = document.getElementById('pred-multi-factor-breakdown');
  if (breakdownEl) breakdownEl.innerHTML = '';
  const contextStripEl = document.getElementById('pred-context-strip');
  if (contextStripEl) {
    contextStripEl.style.display = 'none';
    contextStripEl.innerHTML = '';
  }
  const fac3MoContainer = document.getElementById('pred-faction-3mo-container');
  if (fac3MoContainer) fac3MoContainer.innerHTML = '';
  const dossiersContainer = document.getElementById('pred-commander-dossiers-container');
  if (dossiersContainer) dossiersContainer.innerHTML = '';
  const h2hBadgeEl = document.getElementById('pred-h2h-summary-badge');
  if (h2hBadgeEl) {
    h2hBadgeEl.style.display = 'none';
    h2hBadgeEl.innerText = '';
  }

  const barEl1 = document.getElementById('pred-bar-p1');
  const barDrawEl = document.getElementById('pred-bar-draw');
  const barEl2 = document.getElementById('pred-bar-p2');
  if (barEl1) barEl1.style.width = '50%';
  if (barDrawEl) barDrawEl.style.width = '0%';
  if (barEl2) barEl2.style.width = '50%';

  const tbody = document.getElementById('h2h-table-body');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Select two players to view past match records.</td></tr>';
  }
}
window.resetPredictorState = resetPredictorState;
window.selectPredictPlayer = selectPredictPlayer;
window.runPrediction = runPrediction;

