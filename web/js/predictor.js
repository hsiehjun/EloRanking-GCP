/* ==========================================================================
   PREDICTOR.JS - Match Prediction & Win Odds Simulation
   ========================================================================== */

let predP1 = null;
let predP2 = null;
let acTimeout = null;

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

  if (colNum === 1) predP1 = p;
  else predP2 = p;

  updatePredictCard(colNum, p);
  if (predP1 && predP2) runPrediction();
}

function updatePredictCard(colNum, p) {
  document.getElementById(`p${colNum}-card-name`).innerText = p.player_name || p.full_name;
  document.getElementById(`p${colNum}-card-faction`).innerText = p.top_faction || 'Various';
  document.getElementById(`p${colNum}-card-elo`).innerText = Number(p.current_elo).toFixed(1);
  document.getElementById(`p${colNum}-card-record`).innerText = `${p.wins || 0}W - ${p.losses || 0}L`;
  const wr = p.win_rate !== undefined ? p.win_rate : (p.matches_played > 0 ? ((p.wins / p.matches_played) * 100).toFixed(1) : 0);
  document.getElementById(`p${colNum}-card-winrate`).innerText = `${wr}%`;
  document.getElementById(`p${colNum}-card-peak`).innerText = Number(p.peak_elo || p.current_elo).toFixed(1);
}

async function runPrediction() {
  if (!predP1 || !predP2) return;
  try {
    const p1Identifier = predP1.player_id || predP1.player_name;
    const p2Identifier = predP2.player_id || predP2.player_name;
    const res = await window.api.predictMatch(p1Identifier, p2Identifier);
    if (!res || res.error) {
      console.error('Prediction API error:', res ? res.error : 'Unknown');
      return;
    }

    const p1Prob = res.p1_win_prob !== undefined ? Number(res.p1_win_prob) : (res.player1_win_prob !== undefined ? Number(res.player1_win_prob) : 50.0);
    const p2Prob = res.p2_win_prob !== undefined ? Number(res.p2_win_prob) : (res.player2_win_prob !== undefined ? Number(res.player2_win_prob) : 50.0);

    const probEl1 = document.getElementById('pred-p1-prob');
    const probEl2 = document.getElementById('pred-p2-prob');
    const barEl1 = document.getElementById('pred-bar-p1');
    const barEl2 = document.getElementById('pred-bar-p2');

    if (probEl1) probEl1.innerText = `${p1Prob.toFixed(1)}%`;
    if (probEl2) probEl2.innerText = `${p2Prob.toFixed(1)}%`;
    if (barEl1) barEl1.style.width = `${p1Prob}%`;
    if (barEl2) barEl2.style.width = `${p2Prob}%`;

    const dP1Win = Number((res.deltas && res.deltas.p1_win) !== undefined ? res.deltas.p1_win : 16.0);
    const dP2Win = Number((res.deltas && res.deltas.p2_win) !== undefined ? res.deltas.p2_win : 16.0);
    const dP1Draw = Number((res.deltas && res.deltas.p1_draw) !== undefined ? res.deltas.p1_draw : 0.0);
    const dP2Draw = Number((res.deltas && res.deltas.p2_draw) !== undefined ? res.deltas.p2_draw : 0.0);

    const elo1 = Number(predP1.current_elo || 1500.0);
    const elo2 = Number(predP2.current_elo || 1500.0);

    const elDeltaP1Win = document.getElementById('delta-p1-win');
    const elNewP1Win = document.getElementById('new-p1-win-elo');
    const elDeltaP2Loss = document.getElementById('delta-p2-loss');
    const elNewP2Loss = document.getElementById('new-p2-loss-elo');

    if (elDeltaP1Win) elDeltaP1Win.innerText = `+${dP1Win.toFixed(1)}`;
    if (elNewP1Win) elNewP1Win.innerText = (elo1 + dP1Win).toFixed(1);
    if (elDeltaP2Loss) elDeltaP2Loss.innerText = `-${dP1Win.toFixed(1)}`;
    if (elNewP2Loss) elNewP2Loss.innerText = (elo2 - dP1Win).toFixed(1);

    const elDeltaP1Loss = document.getElementById('delta-p1-upset-loss');
    const elNewP1Loss = document.getElementById('new-p1-loss-elo');
    const elDeltaP2Win = document.getElementById('delta-p2-upset-win');
    const elNewP2Win = document.getElementById('new-p2-win-elo');

    if (elDeltaP1Loss) elDeltaP1Loss.innerText = `-${dP2Win.toFixed(1)}`;
    if (elNewP1Loss) elNewP1Loss.innerText = (elo1 - dP2Win).toFixed(1);
    if (elDeltaP2Win) elDeltaP2Win.innerText = `+${dP2Win.toFixed(1)}`;
    if (elNewP2Win) elNewP2Win.innerText = (elo2 + dP2Win).toFixed(1);

    const elDeltaP1Draw = document.getElementById('delta-p1-draw');
    const elDeltaP2Draw = document.getElementById('delta-p2-draw');
    if (elDeltaP1Draw) elDeltaP1Draw.innerText = `${dP1Draw >= 0 ? '+' : ''}${dP1Draw.toFixed(1)}`;
    if (elDeltaP2Draw) elDeltaP2Draw.innerText = `${dP2Draw >= 0 ? '+' : ''}${dP2Draw.toFixed(1)}`;

    renderHeadToHeadHistory(res.head_to_head || []);
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

  const p1Id = String(predP1.player_id || '');
  const p2Id = String(predP2.player_id || '');

  h2h.forEach(m => {
    const tr = document.createElement('tr');
    
    // Determine which side in the match record is predP1 vs predP2 strictly by player_id
    const isP1Side1 = String(m.player1_id || '') === p1Id;

    const scoreP1 = isP1Side1 ? (m.player1_score !== null && m.player1_score !== undefined ? m.player1_score : '-') : (m.player2_score !== null && m.player2_score !== undefined ? m.player2_score : '-');
    const scoreP2 = isP1Side1 ? (m.player2_score !== null && m.player2_score !== undefined ? m.player2_score : '-') : (m.player1_score !== null && m.player1_score !== undefined ? m.player1_score : '-');

    const winnerId = String(m.winner_id || '');
    const isP1Winner = winnerId === p1Id;
    const isP2Winner = winnerId === p2Id;

    let outcomeText = 'Draw';
    let badgeClass = 'badge-draw';
    if (m.is_draw) {
      outcomeText = 'Draw';
      badgeClass = 'badge-draw';
    } else if (isP1Winner) {
      outcomeText = `${predP1.player_name || 'Player 1'} Win`;
      badgeClass = 'badge-win';
    } else if (isP2Winner) {
      outcomeText = `${predP2.player_name || 'Player 2'} Win`;
      badgeClass = 'badge-win';
    } else {
      outcomeText = 'Completed';
      badgeClass = 'badge-win';
    }

    tr.innerHTML = `
      <td style="font-family:var(--font-mono); color:var(--text-muted); font-size:0.85rem;">${(m.match_date || '').slice(0, 10)}</td>
      <td style="font-weight:600; color:#fff;">${escapeHtml(m.event_name || 'Tournament')}</td>
      <td style="font-family:var(--font-mono);">R${m.round || 1}</td>
      <td style="font-family:var(--font-mono); font-weight:700; color:${isP1Winner ? 'var(--win)' : 'var(--text-secondary)'};">${scoreP1}</td>
      <td style="font-family:var(--font-mono); font-weight:700; color:${isP2Winner ? 'var(--win)' : 'var(--text-secondary)'};">${scoreP2}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(outcomeText)}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

/* ==========================================================================
   FACTION VS FACTION PREDICTOR & HYBRID BAYESIAN SIMULATION
   ========================================================================== */

const STANDARD_FACTIONS = [
  'Adeptus Custodes',
  'Adeptus Mechanicus',
  'Aeldari',
  'Astra Militarum',
  'Black Templars',
  'Blood Angels',
  'Chaos Daemons',
  'Chaos Knights',
  'Chaos Space Marines',
  'Dark Angels',
  'Death Guard',
  'Deathwatch',
  'Drukhari',
  'Emperor\'s Children',
  'Genestealer Cults',
  'Grey Knights',
  'Imperial Agents',
  'Imperial Knights',
  'Leagues of Votann',
  'Necrons',
  'Orks',
  'Sisters of Battle',
  'Space Marines',
  'Space Wolves',
  'T\'au Empire',
  'Thousand Sons',
  'Tyranids',
  'World Eaters',
  'Ynnari'
];

let currentPredictorMode = 'player';
let selectedF1 = 'Space Marines';
let selectedF2 = 'Aeldari';
let factionPredictorInitialized = false;

function switchPredictorMode(mode) {
  currentPredictorMode = mode;
  const btnPlayer = document.getElementById('pred-mode-btn-player');
  const btnFaction = document.getElementById('pred-mode-btn-faction');
  const contPlayer = document.getElementById('pred-player-container');
  const contFaction = document.getElementById('pred-faction-container');

  if (btnPlayer) btnPlayer.classList.toggle('active', mode === 'player');
  if (btnFaction) btnFaction.classList.toggle('active', mode === 'faction');

  if (contPlayer) contPlayer.style.display = (mode === 'player') ? 'block' : 'none';
  if (contFaction) contFaction.style.display = (mode === 'faction') ? 'block' : 'none';

  if (mode === 'faction') {
    initFactionPredictor();
  }
}
window.switchPredictorMode = switchPredictorMode;

function initFactionPredictor() {
  populateFactionDropdowns();
  if (!factionPredictorInitialized) {
    factionPredictorInitialized = true;
    runFactionPrediction();
  }
}

function getAvailablePredictorFactions() {
  const factionSet = new Set(STANDARD_FACTIONS);
  if (window.allAvailableFactions && Array.isArray(window.allAvailableFactions)) {
    window.allAvailableFactions.forEach(f => { if (f) factionSet.add(f); });
  }
  return Array.from(factionSet).sort((a, b) => a.localeCompare(b));
}

function populateFactionDropdowns() {
  const sel1 = document.getElementById('pred-f1-select');
  const sel2 = document.getElementById('pred-f2-select');
  if (!sel1 || !sel2) return;

  const factions = getAvailablePredictorFactions();
  
  // Only rebuild options if empty
  if (sel1.options.length === 0) {
    sel1.innerHTML = factions.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
  }
  if (sel2.options.length === 0) {
    sel2.innerHTML = factions.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
  }

  sel1.value = selectedF1;
  sel2.value = selectedF2;
}

function onFactionPredictorChange(side) {
  const sel = document.getElementById(`pred-${side}-select`);
  if (!sel) return;
  if (side === 'f1') selectedF1 = sel.value;
  else selectedF2 = sel.value;
  runFactionPrediction();
}
window.onFactionPredictorChange = onFactionPredictorChange;

function setFactionPredictorSide(side, faction) {
  if (side === 'f1') selectedF1 = faction;
  else selectedF2 = faction;

  const sel = document.getElementById(`pred-${side}-select`);
  if (sel) sel.value = faction;

  runFactionPrediction();
}
window.setFactionPredictorSide = setFactionPredictorSide;

function swapFactionPredictor() {
  const temp = selectedF1;
  selectedF1 = selectedF2;
  selectedF2 = temp;

  const sel1 = document.getElementById('pred-f1-select');
  const sel2 = document.getElementById('pred-f2-select');
  if (sel1) sel1.value = selectedF1;
  if (sel2) sel2.value = selectedF2;

  runFactionPrediction();
}
window.swapFactionPredictor = swapFactionPredictor;

async function runFactionPrediction() {
  if (!selectedF1 || !selectedF2) return;

  // Visual loading indication
  const verdictEl = document.getElementById('pred-faction-verdict');
  if (verdictEl) {
    verdictEl.innerText = 'Analyzing match dynamics...';
    verdictEl.className = 'matchup-verdict-pill';
  }

  const f1NameLbl = document.getElementById('pred-f1-name-lbl');
  const f2NameLbl = document.getElementById('pred-f2-name-lbl');
  if (f1NameLbl) f1NameLbl.innerText = selectedF1;
  if (f2NameLbl) f2NameLbl.innerText = selectedF2;

  try {
    const data = await window.api.predictFactionMatchup(selectedF1, selectedF2);
    if (!data || data.error) {
      if (verdictEl) verdictEl.innerText = 'Prediction temporarily unavailable';
      return;
    }

    renderFactionPrediction(data);
  } catch (err) {
    console.error('Faction prediction error:', err);
    if (verdictEl) verdictEl.innerText = 'Unable to compute prediction';
  }
}
window.runFactionPrediction = runFactionPrediction;

function renderFactionPrediction(data) {
  const f1 = data.f1 || {};
  const f2 = data.f2 || {};
  const pred = data.prediction || {};
  const h2h = data.head_to_head || {};
  const clashes = data.clashes || [];

  // 1. Update Faction 1 Card
  const f1Name = document.getElementById('f1-card-name');
  const f1Wr = document.getElementById('f1-card-winrate');
  const f1Avg = document.getElementById('f1-card-avg-score');
  const f1Tot = document.getElementById('f1-card-total-matches');
  const f1Tier = document.getElementById('f1-meta-tier-pill');
  const f1Prey = document.getElementById('f1-spot-prey');
  const f1Nem = document.getElementById('f1-spot-nemesis');

  if (f1Name) f1Name.innerText = f1.name || selectedF1;
  if (f1Wr) f1Wr.innerText = `${Number(f1.win_rate || 50.0).toFixed(1)}%`;
  if (f1Avg) f1Avg.innerText = Number(f1.avg_score || 70.0).toFixed(1);
  if (f1Tot) f1Tot.innerText = Number(f1.total_matches || 0).toLocaleString();
  if (f1Tier) {
    f1Tier.innerText = `TIER ${f1.tier || 'B'}`;
    f1Tier.className = `tier-badge tier-${f1.tier || 'B'}`;
  }
  if (f1Prey) {
    const p = f1.spotlight_prey;
    f1Prey.innerText = p ? `${p.opponent_faction} (${Number(p.win_rate).toFixed(1)}%)` : 'None qualified';
  }
  if (f1Nem) {
    const n = f1.spotlight_nemesis;
    f1Nem.innerText = n ? `${n.opponent_faction} (${Number(n.win_rate).toFixed(1)}%)` : 'None qualified';
  }

  // 2. Update Faction 2 Card
  const f2Name = document.getElementById('f2-card-name');
  const f2Wr = document.getElementById('f2-card-winrate');
  const f2Avg = document.getElementById('f2-card-avg-score');
  const f2Tot = document.getElementById('f2-card-total-matches');
  const f2Tier = document.getElementById('f2-meta-tier-pill');
  const f2Prey = document.getElementById('f2-spot-prey');
  const f2Nem = document.getElementById('f2-spot-nemesis');

  if (f2Name) f2Name.innerText = f2.name || selectedF2;
  if (f2Wr) f2Wr.innerText = `${Number(f2.win_rate || 50.0).toFixed(1)}%`;
  if (f2Avg) f2Avg.innerText = Number(f2.avg_score || 70.0).toFixed(1);
  if (f2Tot) f2Tot.innerText = Number(f2.total_matches || 0).toLocaleString();
  if (f2Tier) {
    f2Tier.innerText = `TIER ${f2.tier || 'B'}`;
    f2Tier.className = `tier-badge tier-${f2.tier || 'B'}`;
  }
  if (f2Prey) {
    const p = f2.spotlight_prey;
    f2Prey.innerText = p ? `${p.opponent_faction} (${Number(p.win_rate).toFixed(1)}%)` : 'None qualified';
  }
  if (f2Nem) {
    const n = f2.spotlight_nemesis;
    f2Nem.innerText = n ? `${n.opponent_faction} (${Number(n.win_rate).toFixed(1)}%)` : 'None qualified';
  }

  // 3. Expected Win Probability Bar
  const p1Prob = Number(pred.f1_win_prob || 50.0);
  const p2Prob = Number(pred.f2_win_prob || 50.0);
  const prob1El = document.getElementById('pred-f1-prob');
  const prob2El = document.getElementById('pred-f2-prob');
  const bar1El = document.getElementById('pred-bar-f1');
  const bar2El = document.getElementById('pred-bar-f2');

  if (prob1El) prob1El.innerText = `${p1Prob.toFixed(1)}%`;
  if (prob2El) prob2El.innerText = `${p2Prob.toFixed(1)}%`;
  if (bar1El) bar1El.style.width = `${p1Prob}%`;
  if (bar2El) bar2El.style.width = `${p2Prob}%`;

  // 4. Verdict Pill
  const verdictEl = document.getElementById('pred-faction-verdict');
  if (verdictEl) {
    const diff = Math.abs(p1Prob - p2Prob).toFixed(1);
    if (p1Prob >= 60.0) {
      verdictEl.innerText = `🔥 Major Advantage: ${f1.name || selectedF1} (+${diff}%)`;
      verdictEl.className = 'matchup-verdict-pill verdict-f1-major';
    } else if (p1Prob >= 52.0) {
      verdictEl.innerText = `⚔️ Slight Edge: ${f1.name || selectedF1} (+${diff}%)`;
      verdictEl.className = 'matchup-verdict-pill verdict-f1-slight';
    } else if (p1Prob > 48.0) {
      verdictEl.innerText = `⚖️ Dead Heat / Even Matchup (${p1Prob.toFixed(1)}% - ${p2Prob.toFixed(1)}%)`;
      verdictEl.className = 'matchup-verdict-pill verdict-even';
    } else if (p1Prob > 40.0) {
      verdictEl.innerText = `⚔️ Slight Edge: ${f2.name || selectedF2} (+${diff}%)`;
      verdictEl.className = 'matchup-verdict-pill verdict-f2-slight';
    } else {
      verdictEl.innerText = `🔥 Major Advantage: ${f2.name || selectedF2} (+${diff}%)`;
      verdictEl.className = 'matchup-verdict-pill verdict-f2-major';
    }
  }

  // 5. Clash Metrics Cards
  const recEl = document.getElementById('fmc-h2h-record');
  const recSub = document.getElementById('fmc-h2h-sub');
  const wrEl = document.getElementById('fmc-actual-wr');
  const wrSub = document.getElementById('fmc-actual-wr-sub');
  const diffEl = document.getElementById('fmc-score-diff');
  const diffSub = document.getElementById('fmc-score-diff-sub');
  const confEl = document.getElementById('fmc-confidence');
  const confSub = document.getElementById('fmc-confidence-sub');

  const totalG = Number(h2h.total_games || 0);
  if (recEl) {
    recEl.innerText = totalG > 0 ? `${h2h.f1_wins || 0}W - ${h2h.f2_wins || 0}L${h2h.draws ? ' - ' + h2h.draws + 'D' : ''}` : '0 - 0';
  }
  if (recSub) {
    recSub.innerText = totalG > 0 ? `Across ${totalG} recorded tournament games` : 'No direct matches on record';
  }

  if (wrEl) {
    wrEl.innerText = totalG > 0 ? `${Number(h2h.f1_actual_win_rate || 50.0).toFixed(1)}% vs ${Number(h2h.f2_actual_win_rate || 50.0).toFixed(1)}%` : '50% / 50%';
  }
  if (wrSub) {
    wrSub.innerText = totalG > 0 ? `${f1.name || selectedF1} vs ${f2.name || selectedF2}` : 'Calculated from meta priors';
  }

  const scoreDiff = Number(h2h.score_differential || 0);
  if (diffEl) {
    diffEl.innerText = `${scoreDiff > 0 ? '+' : ''}${scoreDiff.toFixed(1)} pts`;
    diffEl.style.color = scoreDiff > 0 ? 'var(--win)' : (scoreDiff < 0 ? 'var(--loss)' : 'var(--text-secondary)');
  }
  if (diffSub) {
    diffSub.innerText = `Avg: ${Number(h2h.f1_avg_score || 0).toFixed(1)} vs ${Number(h2h.f2_avg_score || 0).toFixed(1)} pts`;
  }

  if (confEl) {
    if (totalG >= 15) {
      confEl.innerText = `High (N=${totalG})`;
      confEl.style.color = 'var(--win)';
    } else if (totalG >= 5) {
      confEl.innerText = `Moderate (N=${totalG})`;
      confEl.style.color = 'var(--accent)';
    } else if (totalG >= 1) {
      confEl.innerText = `Low (N=${totalG})`;
      confEl.style.color = '#f59e0b';
    } else {
      confEl.innerText = `Prior Only (N=0)`;
      confEl.style.color = 'var(--text-muted)';
    }
  }
  if (confSub) {
    confSub.innerText = totalG >= 5 ? 'Strong statistical significance' : 'Macro meta Bayesian weighting';
  }

  // 6. Recent Historical Clashes Table
  renderFactionClashes(clashes, f1.name || selectedF1, f2.name || selectedF2);
}

function renderFactionClashes(clashes, f1Name, f2Name) {
  const tbody = document.getElementById('faction-clashes-table-body');
  const countBadge = document.getElementById('clashes-count-badge');
  if (countBadge) countBadge.innerText = `${(clashes || []).length} Matches`;
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!clashes || clashes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No competitive tournament matches found between these two armies yet.</td></tr>';
    return;
  }

  clashes.forEach(c => {
    const tr = document.createElement('tr');
    const isF1Win = c.winner_side === 'f1';
    const isF2Win = c.winner_side === 'f2';
    const isDraw = c.winner_side === 'draw';

    let verdictBadge = '';
    if (isDraw) {
      verdictBadge = '<span class="badge badge-draw">Draw</span>';
    } else if (isF1Win) {
      verdictBadge = `<span class="badge badge-win">${escapeHtml(f1Name)} Win</span>`;
    } else if (isF2Win) {
      verdictBadge = `<span class="badge" style="background:rgba(244,63,94,0.15); color:#f43f5e; border:1px solid rgba(244,63,94,0.3);">${escapeHtml(f2Name)} Win</span>`;
    } else {
      verdictBadge = '<span class="badge badge-win">Completed</span>';
    }

    const p1Display = c.f1_player_id 
      ? `<span class="player-link" onclick="openPlayerModal('${c.f1_player_id}')">${escapeHtml(c.f1_player_name || 'Pilot 1')}</span>`
      : escapeHtml(c.f1_player_name || 'Pilot 1');

    const p2Display = c.f2_player_id
      ? `<span class="player-link" onclick="openPlayerModal('${c.f2_player_id}')">${escapeHtml(c.f2_player_name || 'Pilot 2')}</span>`
      : escapeHtml(c.f2_player_name || 'Pilot 2');

    const evtDisplay = c.event_id
      ? `<span class="player-link" onclick="openEventModal('${c.event_id}')">${escapeHtml(c.event_name || 'Tournament')}</span>`
      : escapeHtml(c.event_name || 'Tournament');

    tr.innerHTML = `
      <td style="font-family:var(--font-mono); font-size:0.82rem; color:var(--text-muted);">${(c.match_date || '').slice(0, 10)}</td>
      <td style="font-weight:600; color:#fff;">${evtDisplay}</td>
      <td style="font-family:var(--font-mono);">R${c.round || 1}</td>
      <td>${p1Display}</td>
      <td style="font-family:var(--font-mono); font-weight:700; color:${isF1Win ? 'var(--win)' : 'var(--text-secondary)'};">${c.f1_score !== null && c.f1_score !== undefined ? c.f1_score : '-'}</td>
      <td>${p2Display}</td>
      <td style="font-family:var(--font-mono); font-weight:700; color:${isF2Win ? 'var(--win)' : 'var(--text-secondary)'};">${c.f2_score !== null && c.f2_score !== undefined ? c.f2_score : '-'}</td>
      <td>${verdictBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

function openFactionPredictor(f1, f2) {
  if (typeof closeModal === 'function') {
    closeModal('faction-modal');
    closeModal('player-modal');
  }
  if (typeof switchTab === 'function') switchTab('meta-intel');
  if (typeof switchMetaSubtab === 'function') switchMetaSubtab('predictor');
  
  switchPredictorMode('faction');

  if (f1) selectedF1 = f1;
  if (f2) selectedF2 = f2;

  populateFactionDropdowns();
  runFactionPrediction();

  const el = document.getElementById('lead-view-predictor');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.openFactionPredictor = openFactionPredictor;
