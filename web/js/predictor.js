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
    const res = await window.api.predictMatch(predP1.player_id, predP2.player_id);
    document.getElementById('pred-p1-prob').innerText = `${res.p1_win_prob}%`;
    document.getElementById('pred-p2-prob').innerText = `${res.p2_win_prob}%`;
    document.getElementById('pred-bar-p1').style.width = `${res.p1_win_prob}%`;
    document.getElementById('pred-bar-p2').style.width = `${res.p2_win_prob}%`;

    const dP1Win = Number(res.deltas.p1_win);
    const dP2Win = Number(res.deltas.p2_win);
    const dP1Draw = Number(res.deltas.p1_draw);
    const dP2Draw = Number(res.deltas.p2_draw);

    const elo1 = Number(predP1.current_elo);
    const elo2 = Number(predP2.current_elo);

    document.getElementById('delta-p1-win').innerText = `+${dP1Win.toFixed(1)}`;
    document.getElementById('new-p1-win-elo').innerText = (elo1 + dP1Win).toFixed(1);
    document.getElementById('delta-p2-loss').innerText = `-${dP1Win.toFixed(1)}`;
    document.getElementById('new-p2-loss-elo').innerText = (elo2 - dP1Win).toFixed(1);

    document.getElementById('delta-p1-upset-loss').innerText = `-${dP2Win.toFixed(1)}`;
    document.getElementById('new-p1-loss-elo').innerText = (elo1 - dP2Win).toFixed(1);
    document.getElementById('delta-p2-upset-win').innerText = `+${dP2Win.toFixed(1)}`;
    document.getElementById('new-p2-win-elo').innerText = (elo2 + dP2Win).toFixed(1);

    document.getElementById('delta-p1-draw').innerText = `${dP1Draw >= 0 ? '+' : ''}${dP1Draw.toFixed(1)}`;
    document.getElementById('delta-p2-draw').innerText = `${dP2Draw >= 0 ? '+' : ''}${dP2Draw.toFixed(1)}`;

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

  h2h.forEach(m => {
    const tr = document.createElement('tr');
    const isP1Win = m.winner_id === predP1.player_id;
    const isP2Win = m.winner_id === predP2.player_id;
    const outcome = isP1Win ? `${predP1.player_name || 'P1'} Win` : (isP2Win ? `${predP2.player_name || 'P2'} Win` : 'Draw');

    tr.innerHTML = `
      <td style="font-family:var(--font-mono); color:var(--text-muted); font-size:0.85rem;">${(m.match_date || '').slice(0, 10)}</td>
      <td style="font-weight:600; color:#fff;">${escapeHtml(m.event_name || 'Tournament')}</td>
      <td style="font-family:var(--font-mono);">R${m.round || 1}</td>
      <td style="font-family:var(--font-mono); font-weight:700; color:${isP1Win ? 'var(--win)' : 'var(--text-secondary)'};">${m.player1_score !== null ? m.player1_score : '-'}</td>
      <td style="font-family:var(--font-mono); font-weight:700; color:${isP2Win ? 'var(--win)' : 'var(--text-secondary)'};">${m.player2_score !== null ? m.player2_score : '-'}</td>
      <td><span class="badge ${isP1Win || isP2Win ? 'badge-win' : 'badge-draw'}">${outcome}</span></td>
    `;
    tbody.appendChild(tr);
  });
}
