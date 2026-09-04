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
