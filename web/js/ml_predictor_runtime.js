/* ==========================================================================
   ML_PREDICTOR_RUNTIME.JS - Shared Client-Side 2-Mode Calibrated ML Match
   Predictor Runtime (GBDT + Davidson 3-Way Calibration + WTC/VP Normal-CDF)
   Used across: Meta Intel Predictor, Tournament Pairings & Caster Dossiers,
   WTC Team Pairings Game, EventStudio Pairings, and Broadcast Overlays.
   ========================================================================== */

(function () {
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
    'tau': 'tau empire',
    'agents of the imperium': 'imperial agents'
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

  const _specCache = window._mlModelSpecCache || {};
  const _inflightSpecPromises = {};
  window._mlModelSpecCache = _specCache;

  function _mlEsc(val) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(val);
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _normMlFacKey(raw) {
    const s = String(raw || '').trim().toLowerCase()
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s || ['unknown', 'none', 'various', 'all', 'bye', 'unaligned', 'n a', 'na', 'army', 'tbd', 'unassigned'].includes(s)) {
      return '';
    }
    return _ML_FACTION_ALIASES[s] || s;
  }

  function _renderDispositionBadgesHtml(prof) {
    const badges = Array.isArray(prof?.disposition?.badges)
      ? prof.disposition.badges
      : (Array.isArray(prof?.badges) ? prof.badges : []);
    if (!badges.length) return '';
    return badges.slice(0, 2).map(b => {
      const tone = String(b.tone || 'slate').replace(/[^a-z]/g, '');
      const label = _mlEsc(b.label || '');
      const tip = _mlEsc(b.tooltip || '');
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

  function seedMlModelSpecCache(gameSystem, mlClientSpec, competitiveAlpha90d) {
    const sys = String(gameSystem || '40k').trim().toLowerCase() || '40k';
    if (!mlClientSpec) return;
    const prev = _specCache[sys] || {};
    _specCache[sys] = {
      ml_client_spec: mlClientSpec,
      competitive_alpha_90d: competitiveAlpha90d || prev.competitive_alpha_90d || { factions: {}, matchups: {} },
      loadedAt: Date.now()
    };
  }

  function ensureMlModelSpec(gameSystem, onLoaded) {
    const sys = String(gameSystem || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).trim().toLowerCase() || '40k';
    const cached = _specCache[sys];
    if (cached && cached.ml_client_spec && (Date.now() - Number(cached.loadedAt || 0)) < 600000) {
      if (typeof onLoaded === 'function') {
        try { onLoaded(cached); } catch (_) {}
      }
      return Promise.resolve(cached);
    }
    if (_inflightSpecPromises[sys]) {
      return _inflightSpecPromises[sys].then(entry => {
        if (typeof onLoaded === 'function' && entry) {
          try { onLoaded(entry); } catch (_) {}
        }
        return entry;
      });
    }
    const p = fetch(`/api/predict/model-spec?game_system=${encodeURIComponent(sys)}`, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        delete _inflightSpecPromises[sys];
        if (data && data.ml_client_spec) {
          seedMlModelSpecCache(sys, data.ml_client_spec, data.competitive_alpha_90d);
          const entry = _specCache[sys];
          if (typeof onLoaded === 'function') {
            try { onLoaded(entry); } catch (_) {}
          }
          return entry;
        }
        return null;
      })
      .catch(() => {
        delete _inflightSpecPromises[sys];
        return null;
      });
    _inflightSpecPromises[sys] = p;
    return p;
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

  function _wrPctToAlpha(wrPct, games, kPrior) {
    const g = Math.max(0, Number(games || 0));
    if (g <= 0) return 0.0;
    const p = Math.max(0.08, Math.min(0.92, Number(wrPct || 50) / 100.0));
    const shr = g / (g + Math.max(1.0, kPrior));
    return Math.log(p / (1.0 - p)) * shr;
  }

  function computeCalibratedMlMatchupClient(opts = {}) {
    const sys = String(opts.gameSystem || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).trim().toLowerCase() || '40k';
    const cachedEntry = _specCache[sys] || null;
    const spec = opts.mlSpec
      || (cachedEntry && cachedEntry.ml_client_spec)
      || (typeof predLastResponse !== 'undefined' && predLastResponse && predLastResponse.ml_client_spec && (!predLastResponse.game_system || predLastResponse.game_system === sys) ? predLastResponse.ml_client_spec : null)
      || _defaultClientMlSpec(sys);
    const compSnap = opts.competitiveAlpha90d
      || (cachedEntry && cachedEntry.competitive_alpha_90d)
      || (typeof predLastResponse !== 'undefined' && predLastResponse && predLastResponse.competitive_alpha_90d)
      || { factions: {}, matchups: {} };

    const elo1 = Number(opts.elo1 ?? opts.p1Elo ?? opts.p1Prof?.current_elo ?? opts.p1Prof?.elo ?? 1500);
    const elo2 = Number(opts.elo2 ?? opts.p2Elo ?? opts.p2Prof?.current_elo ?? opts.p2Prof?.elo ?? 1500);
    const fac1 = String(opts.fac1 ?? opts.p1Fac ?? opts.p1Prof?.faction ?? '');
    const fac2 = String(opts.fac2 ?? opts.p2Fac ?? opts.p2Prof?.faction ?? '');
    const nk1 = _normMlFacKey(fac1);
    const nk2 = _normMlFacKey(fac2);
    const facMetrics = opts.fac3MoMetrics || {};
    const isMirror = Boolean((nk1 && nk2 && nk1 === nk2) || facMetrics.isMirror);

    const f1AlphaObj = (compSnap.factions && compSnap.factions[nk1]) || null;
    const f2AlphaObj = (compSnap.factions && compSnap.factions[nk2]) || null;
    const fwdMu = (compSnap.matchups && compSnap.matchups[`${nk1}||${nk2}`]) || null;
    const revMu = (nk1 && nk2 && nk1 !== nk2 && compSnap.matchups && compSnap.matchups[`${nk2}||${nk1}`]) || null;

    let f1Alpha = f1AlphaObj ? Number(f1AlphaObj.alpha || 0.0) : _wrPctToAlpha(facMetrics.f1GlobalWr, facMetrics.f1GlobalGames, 80.0);
    let f2Alpha = f2AlphaObj ? Number(f2AlphaObj.alpha || 0.0) : _wrPctToAlpha(facMetrics.f2GlobalWr, facMetrics.f2GlobalGames, 80.0);
    let muAlpha = 0.0;
    let muGames = 0;
    if (!isMirror) {
      if (fwdMu && revMu) {
        muAlpha = 0.5 * (Number(fwdMu.alpha || 0.0) - Number(revMu.alpha || 0.0));
        muGames = Math.max(Number(fwdMu.games || 0), Number(revMu.games || 0));
      } else if (fwdMu) {
        muAlpha = Number(fwdMu.alpha || 0.0);
        muGames = Number(fwdMu.games || 0);
      } else if (revMu) {
        muAlpha = -Number(revMu.alpha || 0.0);
        muGames = Number(revMu.games || 0);
      } else {
        const hF1W = Number(facMetrics.h2hF1Wins || 0);
        const hF2W = Number(facMetrics.h2hF2Wins || 0);
        const hDr = Number(facMetrics.h2hDraws || 0);
        const hTot = hF1W + hF2W + hDr;
        if (hTot > 0) {
          const empWr = ((hF1W + 0.5 * hDr) / hTot) * 100.0;
          muAlpha = _wrPctToAlpha(empWr, hTot, 35.0) - (f1Alpha - f2Alpha) * (hTot / (hTot + 35.0));
          muGames = hTot;
        }
      }
    }

    const p1Prof = opts.p1Prof || {};
    const p2Prof = opts.p2Prof || {};
    const mlf1 = p1Prof.ml_features || {};
    const mlf2 = p2Prof.ml_features || {};
    const disp1 = p1Prof.disposition || {};
    const disp2 = p2Prof.disposition || {};
    const p1Mastery = opts.p1Mastery || {};
    const p2Mastery = opts.p2Mastery || {};

    const ownMap1 = mlf1.own_faction_residuals || {};
    const ownMap2 = mlf2.own_faction_residuals || {};
    const vsMap1 = mlf1.vs_faction_residuals || {};
    const vsMap2 = mlf2.vs_faction_residuals || {};
    const own1 = (nk1 && ownMap1[nk1]) || null;
    const own2 = (nk2 && ownMap2[nk2]) || null;
    const vs1 = (nk2 && vsMap1[nk2]) || null;
    const vs2 = (nk1 && vsMap2[nk1]) || null;

    const fallbackMasteryRes = (mObj, eloVal, gamesField, winsField, drawsField, priorK) => {
      const g = Number(mObj?.[gamesField] || 0);
      if (g <= 0) return 0.0;
      const w = Number(mObj?.[winsField] || 0);
      const d = Number(mObj?.[drawsField] || 0);
      const empShare = (w + 0.5 * d) / g;
      const baseExp = 1.0 / (1.0 + Math.pow(10.0, (1500.0 - eloVal) / 400.0));
      const shrunkExp = 0.5 + 0.45 * (baseExp - 0.5);
      return ((empShare - shrunkExp) * g) / (g + priorK);
    };

    const ownRes1 = own1
      ? Number(own1.shrunk_res !== undefined ? own1.shrunk_res : (own1.residual || 0.0))
      : fallbackMasteryRes(p1Mastery, elo1, 'ownGames', 'ownWins', 'ownDraws', 10.0);
    const ownRes2 = own2
      ? Number(own2.shrunk_res !== undefined ? own2.shrunk_res : (own2.residual || 0.0))
      : fallbackMasteryRes(p2Mastery, elo2, 'ownGames', 'ownWins', 'ownDraws', 10.0);

    const vsRes1 = vs1
      ? Number(vs1.shrunk_res !== undefined ? vs1.shrunk_res : (vs1.residual || 0.0))
      : fallbackMasteryRes(p1Mastery, elo1, 'vsGames', 'vsWins', 'vsDraws', 8.0);
    const vsRes2 = vs2
      ? Number(vs2.shrunk_res !== undefined ? vs2.shrunk_res : (vs2.residual || 0.0))
      : fallbackMasteryRes(p2Mastery, elo2, 'vsGames', 'vsWins', 'vsDraws', 8.0);

    // H2H Elo residual (supports full match list OR summary {p1Wins, p2Wins, draws})
    const expDefault = 1.0 / (1.0 + Math.pow(10.0, (elo2 - elo1) / 400.0));
    let h2hResAb = 0.0;
    const h2hMatches = opts.h2hMatches;
    if (Array.isArray(h2hMatches) && h2hMatches.length > 0) {
      const p1IdL = String(p1Prof.player_id || p1Prof.id || '').trim().toLowerCase();
      const p2IdL = String(p2Prof.player_id || p2Prof.id || '').trim().toLowerCase();
      const p1NmL = String(p1Prof.player_name || p1Prof.full_name || p1Prof.name || '').trim().toLowerCase();
      let h2hResSum = 0.0;
      let h2hCnt = 0;
      h2hMatches.forEach(hm => {
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
      if (h2hCnt > 0) h2hResAb = h2hResSum / (h2hCnt + 5.0);
    } else if (opts.pastH2h && typeof opts.pastH2h === 'object') {
      const w1 = Number(opts.pastH2h.p1Wins || 0);
      const w2 = Number(opts.pastH2h.p2Wins || 0);
      const dr = Number(opts.pastH2h.draws || 0);
      const totH = w1 + w2 + dr;
      if (totH > 0) {
        const obsPoints = w1 + 0.5 * dr;
        h2hResAb = (obsPoints - totH * expDefault) / (totH + 5.0);
      }
    }

    const g1 = Math.max(
      Number(opts.p1Games ?? p1Prof.matches_played ?? 0),
      Number(mlf1.games ?? mlf1.competitive_games ?? 0),
      Number(p1Mastery.ownGames || 0)
    );
    const g2 = Math.max(
      Number(opts.p2Games ?? p2Prof.matches_played ?? 0),
      Number(mlf2.games ?? mlf2.competitive_games ?? 0),
      Number(p2Mastery.ownGames || 0)
    );

    const p1In = {
      elo: elo1,
      games: g1,
      uncSq: Number(mlf1.uncertainty_sq !== undefined ? mlf1.uncertainty_sq : (1.0 / (1.0 + g1 / 12.0))),
      peakGap: Number(mlf1.peak_gap !== undefined ? mlf1.peak_gap : Math.max(0.0, Number(p1Prof.peak_elo || elo1) - elo1)),
      form: Number(mlf1.recent_form_ewma || 0.0),
      ownRes: ownRes1,
      ownGames: Number(own1?.games !== undefined ? own1.games : (p1Mastery.ownGames || 0)),
      vsRes: vsRes1,
      giantSlayer: Number(mlf1.giant_slayer_res ?? disp1.giant_slayer_res ?? 0.0),
      gatekeeper: Number(mlf1.gatekeeper_res ?? disp1.gatekeeper_res ?? 0.0),
      volZ: Number(mlf1.volatility_z ?? disp1.volatility_z ?? 0.0)
    };
    const p2In = {
      elo: elo2,
      games: g2,
      uncSq: Number(mlf2.uncertainty_sq !== undefined ? mlf2.uncertainty_sq : (1.0 / (1.0 + g2 / 12.0))),
      peakGap: Number(mlf2.peak_gap !== undefined ? mlf2.peak_gap : Math.max(0.0, Number(p2Prof.peak_elo || elo2) - elo2)),
      form: Number(mlf2.recent_form_ewma || 0.0),
      ownRes: ownRes2,
      ownGames: Number(own2?.games !== undefined ? own2.games : (p2Mastery.ownGames || 0)),
      vsRes: vsRes2,
      giantSlayer: Number(mlf2.giant_slayer_res ?? disp2.giant_slayer_res ?? 0.0),
      gatekeeper: Number(mlf2.gatekeeper_res ?? disp2.gatekeeper_res ?? 0.0),
      volZ: Number(mlf2.volatility_z ?? disp2.volatility_z ?? 0.0)
    };

    const uncC = Number(spec.uncertainty_c !== undefined ? spec.uncertainty_c : 0.85);
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
    let logitStage4 = 0.0;
    const ln10Over400 = Math.LN10 / 400.0;
    const factorAttributions = stages.map(([key, label, activeIdx]) => {
      const subAb = xAb.map((v, idx) => activeIdx.has(idx) ? v : 0.0);
      const subBa = xBa.map((v, idx) => activeIdx.has(idx) ? v : 0.0);
      const [stLogit, stP1, stDr] = _evalSymmetricDavidson(spec, subAb, subBa, avgVol);
      const stShare = stP1 + 0.5 * stDr;
      const shiftPct = (stShare - prevShare) * 100.0;
      const eloEq = (stLogit - prevLogit) / ln10Over400;
      if (key === 'matchup_edge') logitStage4 = stLogit;
      prevShare = stShare;
      prevLogit = stLogit;
      return {
        key,
        label,
        prob_shift_pct: Number(shiftPct.toFixed(2)),
        elo_equiv: Number(eloEq.toFixed(1))
      };
    });

    // Sub-disaggregate Pilot Mastery & H2H into own_mastery, vs_mastery, past_h2h Elo equivalents
    const maskOwn = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13]);
    const maskOwnVs = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13]);
    const [logitOwn] = _evalSymmetricDavidson(
      spec,
      xAb.map((v, idx) => maskOwn.has(idx) ? v : 0.0),
      xBa.map((v, idx) => maskOwn.has(idx) ? v : 0.0),
      avgVol
    );
    const [logitOwnVs] = _evalSymmetricDavidson(
      spec,
      xAb.map((v, idx) => maskOwnVs.has(idx) ? v : 0.0),
      xBa.map((v, idx) => maskOwnVs.has(idx) ? v : 0.0),
      avgVol
    );
    const ownMasteryEloEquiv = Number(((logitOwn - logitStage4) / ln10Over400).toFixed(1));
    const vsMasteryEloEquiv = Number(((logitOwnVs - logitOwn) / ln10Over400).toFixed(1));
    const pastH2hEloEquiv = Number(((logitFull - logitOwnVs) / ln10Over400).toFixed(1));

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
      sub_elo_equiv: {
        own_mastery: ownMasteryEloEquiv,
        vs_mastery: vsMasteryEloEquiv,
        past_h2h: pastH2hEloEquiv
      },
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
            ${ico} ${_mlEsc(a.label)}
          </div>
          <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 0.35rem; flex-wrap: wrap;">
            <span style="font-family: var(--font-mono); font-size: 0.9rem; font-weight: 900; color: ${col};">${shiftStr}</span>
            <span style="font-family: var(--font-mono); font-size: 0.68rem; color: var(--text-muted);">${eloStr}</span>
          </div>
          <div style="font-size: 0.67rem; font-weight: 700; color: ${col}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${_mlEsc(who)}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="margin-top: 0.95rem; background: rgba(15, 23, 42, 0.68); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 0.75rem 0.9rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.6rem;">
          <div style="font-size: 0.75rem; font-weight: 800; color: #e2e8f0; display: flex; align-items: center; gap: 0.4rem;">
            <span>🧠 Calibrated 5-Pillar Win-Share Attribution</span>
            <span style="font-size: 0.68rem; font-weight: 500; color: var(--text-muted);">(${_mlEsc(fac1)} vs ${_mlEsc(fac2)} • Elo-residualized, zero double-counting)</span>
          </div>
          <span style="font-family: var(--font-mono); font-size: 0.72rem; font-weight: 800; color: ${netCol}; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 2px 8px;">
            ${_mlEsc(netLeader)} (${netSignStr})
          </span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 155px), 1fr)); gap: 0.5rem;">
          ${cardsHtml}
        </div>
      </div>
    `;
  }

  window._normMlFacKey = _normMlFacKey;
  window.renderDispositionBadgesHtml = _renderDispositionBadgesHtml;
  window._renderDispositionBadgesHtml = _renderDispositionBadgesHtml;
  window._defaultClientMlSpec = _defaultClientMlSpec;
  window.seedMlModelSpecCache = seedMlModelSpecCache;
  window.ensureMlModelSpec = ensureMlModelSpec;
  window.computeCalibratedMlMatchupClient = computeCalibratedMlMatchupClient;
  window.buildMlFactorAttributionHtml = buildMlFactorAttributionHtml;
})();
