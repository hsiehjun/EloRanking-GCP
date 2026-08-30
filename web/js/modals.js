/* ==========================================================================
   MODALS.JS - Player Profile Modal, Collapsible Elo Graph & Modals
   ========================================================================== */

let currentPlayerTrajectory = [];
let currentPlayerMatches = [];
let isChartExpanded = false;

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

function closeModalOnBackdrop(e) {
  if (e.target && e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('active');
  }
}

function togglePlayerEloChart() {
  const container = document.getElementById('chart-collapsible-content');
  const btn = document.getElementById('toggle-chart-btn');
  const arrow = document.getElementById('toggle-chart-arrow');
  if (!container) return;

  isChartExpanded = !isChartExpanded;
  if (isChartExpanded) {
    container.style.display = 'block';
    if (arrow) arrow.innerText = '▲';
    if (btn) btn.querySelector('span').innerText = '📉 Hide Elo Progression Graph';
    if (currentPlayerTrajectory && currentPlayerTrajectory.length > 0) {
      renderTrajectoryChart(currentPlayerTrajectory);
    }
  } else {
    container.style.display = 'none';
    if (arrow) arrow.innerText = '▼';
    if (btn) btn.querySelector('span').innerText = '📈 View Elo Progression Graph';
  }
}

async function openPlayerModal(playerId) {
  const modal = document.getElementById('player-modal');
  if (!modal) return;
  modal.classList.add('active');

  // Reset chart to collapsed state by default
  isChartExpanded = false;
  const chartContent = document.getElementById('chart-collapsible-content');
  const toggleBtn = document.getElementById('toggle-chart-btn');
  const toggleArrow = document.getElementById('toggle-chart-arrow');
  if (chartContent) chartContent.style.display = 'none';
  if (toggleArrow) toggleArrow.innerText = '▼';
  if (toggleBtn) toggleBtn.querySelector('span').innerText = '📈 View Elo Progression Graph';

  const tbody = document.getElementById('modal-matches-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading match history...</div></td></tr>';

  try {
    const data = await window.api.getPlayerProfile(playerId);
    const p = data.player || data || {};
    document.getElementById('modal-player-name').innerText = p.player_name || p.full_name || 'Player Profile';

    const teamDiv = document.getElementById('modal-player-team');
    if (teamDiv) {
      const teamsList = Array.isArray(p.teams_history) && p.teams_history.length > 0 
        ? p.teams_history 
        : ((p.all_teams || p.team || '').split(',').map(t => t.trim()).filter(Boolean));

      if (teamsList.length > 0) {
        teamDiv.style.display = 'inline-flex';
        teamDiv.style.flexWrap = 'wrap';
        teamDiv.style.gap = '0.4rem';
        teamDiv.style.alignItems = 'center';
        teamDiv.innerHTML = '';

        const currentTeam = p.team ? p.team.trim() : teamsList[0];

        teamsList.forEach((tm, idx) => {
          const isCurrent = (tm.toLowerCase() === currentTeam.toLowerCase()) || (idx === 0);
          const badge = document.createElement('span');
          badge.className = 'faction-pill';
          badge.style.cursor = 'pointer';
          badge.style.border = isCurrent ? '1px solid #38bdf8' : '1px solid #334155';
          badge.style.background = isCurrent ? 'rgba(56, 189, 248, 0.12)' : 'rgba(15, 23, 42, 0.6)';
          badge.style.color = isCurrent ? '#38bdf8' : 'var(--text-secondary)';
          badge.style.fontWeight = isCurrent ? '700' : '500';
          badge.title = isCurrent ? `${tm} (Current Active Team)` : `${tm} (Past Team)`;
          badge.innerHTML = `🛡️ ${escapeHtml(tm)}${isCurrent && teamsList.length > 1 ? ' <span style="font-size:0.68rem; opacity:0.85; margin-left:0.2rem;">(Current)</span>' : ''}`;
          badge.onclick = (e) => { e.stopPropagation(); closeModal('player-modal'); openTeamModal(tm); };
          teamDiv.appendChild(badge);
        });
      } else {
        teamDiv.style.display = 'none';
      }
    }

    const factionsDiv = document.getElementById('modal-player-factions');
    if (factionsDiv) {
      factionsDiv.innerHTML = '';
      const factionsList = (p.top_faction || '').split(',').map(f => f.trim()).filter(Boolean);
      factionsList.forEach(fac => {
        const badge = document.createElement('span');
        badge.className = 'faction-pill';
        badge.innerText = fac;
        factionsDiv.appendChild(badge);
      });
    }

    document.getElementById('modal-elo').innerText = Number(p.current_elo || 1500).toFixed(1);
    document.getElementById('modal-peak').innerText = Number(p.peak_elo || p.current_elo || 1500).toFixed(1);
    document.getElementById('modal-record').innerHTML = `<span style="color:var(--win);">${p.wins || 0}W</span> - <span style="color:var(--loss);">${p.losses || 0}L</span>${p.draws ? ` - <span style="color:var(--draw);">${p.draws}D</span>` : ''}`;
    const totalM = p.total_matches || p.matches_played || (p.wins + p.losses + (p.draws || 0)) || 0;
    const wr = p.win_rate !== undefined ? p.win_rate : (totalM > 0 ? ((p.wins / totalM) * 100).toFixed(1) : 0);
    document.getElementById('modal-winrate').innerText = `${wr}%`;
    document.getElementById('modal-streak').innerText = `${data.longest_win_streak || data.max_streak || 0} Wins`;

    currentPlayerTrajectory = data.trajectory || [];
    const matchesList = data.history || data.win_path || [];
    renderPlayerMatches(matchesList);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="empty-state" style="color:var(--loss);">Error loading profile: ${err.message}</td></tr>`;
  }
}

function renderPlayerMatches(history) {
  const tbody = document.getElementById('modal-matches-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!history || history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No match trajectory records stored.</td></tr>';
    return;
  }

  history.forEach(h => {
    const tr = document.createElement('tr');
    const isWin = h.result === 'W';
    const isLoss = h.result === 'L';
    const resClass = isWin ? 'badge-win' : (isLoss ? 'badge-loss' : 'badge-draw');
    const dVal = Number(h.delta_elo || 0);
    const dStr = `${dVal >= 0 ? '+' : ''}${dVal.toFixed(1)}`;
    const dColor = dVal > 0 ? 'var(--win)' : (dVal < 0 ? 'var(--loss)' : 'var(--text-muted)');

    tr.innerHTML = `
      <td style="font-family:var(--font-mono); color:var(--text-muted); font-size:0.82rem;">${(h.match_date || '').slice(0, 10)}</td>
      <td style="font-weight:600; color:#fff; font-size:0.85rem;" onclick="event.stopPropagation(); openEventModal('${h.event_id}')">
        <span class="player-link">${escapeHtml(h.event_name || 'Tournament')}</span>
      </td>
      <td style="font-family:var(--font-mono);">R${h.round || 1}</td>
      <td><span class="badge ${resClass}">${h.result || '-'}</span></td>
      <td style="font-family:var(--font-mono);">${h.player_score !== null && h.opponent_score !== null ? `${h.player_score} - ${h.opponent_score}` : '-'}</td>
      <td><span class="faction-pill" style="font-size:0.72rem;">${escapeHtml(h.player_faction || '-')}</span></td>
      <td>
        <span class="player-link" style="font-size:0.85rem;" onclick="event.stopPropagation(); openPlayerModal('${h.opponent_id}')">
          ${escapeHtml(h.opponent_name || (h.result === 'BYE' ? 'BYE' : 'Opponent'))}
        </span>
      </td>
      <td style="font-family:var(--font-mono); color:var(--text-secondary); font-size:0.85rem;">${h.opponent_elo ? Number(h.opponent_elo).toFixed(1) : '-'}</td>
      <td style="font-family:var(--font-mono); font-weight:700; color:${dColor};">${dStr}</td>
      <td class="elo-badge ${getEloBadgeClass(h.new_elo)}" style="font-size:0.88rem;">${Number(h.new_elo).toFixed(1)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderTrajectoryChart(trajectory) {
  const svg = document.getElementById('trajectory-svg');
  if (!svg || !trajectory || trajectory.length === 0) return;

  const w = svg.clientWidth || 760;
  const h = 200;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = '';

  const elos = trajectory.map(t => Number(t.elo));
  const minElo = Math.floor(Math.min(...elos) - 20);
  const maxElo = Math.ceil(Math.max(...elos) + 20);
  const range = maxElo - minElo || 1;

  const padX = 40;
  const padY = 25;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  const points = trajectory.map((t, idx) => {
    const x = padX + (idx / (trajectory.length - 1 || 1)) * plotW;
    const y = padY + plotH - ((Number(t.elo) - minElo) / range) * plotH;
    return { x, y, elo: Number(t.elo), result: t.result, date: t.date };
  });

  // Grid lines
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const val = minElo + (range / gridLines) * i;
    const y = padY + plotH - (i / gridLines) * plotH;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padX);
    line.setAttribute('y1', y);
    line.setAttribute('x2', w - padX);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', '#1e2533');
    line.setAttribute('stroke-dasharray', '3,3');
    svg.appendChild(line);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padX - 8);
    txt.setAttribute('y', y + 4);
    txt.setAttribute('fill', '#64748b');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('font-family', 'monospace');
    txt.setAttribute('text-anchor', 'end');
    txt.textContent = Math.round(val);
    svg.appendChild(txt);
  }

  // Draw Path Line
  let dStr = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    dStr += ` L ${points[i].x} ${points[i].y}`;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', dStr);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#38bdf8');
  path.setAttribute('stroke-width', '2.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);

  // Draw Points
  points.forEach(pt => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', pt.x);
    circle.setAttribute('cy', pt.y);
    circle.setAttribute('r', '4');
    circle.setAttribute('fill', pt.result === 'W' ? '#22c55e' : (pt.result === 'L' ? '#ef4444' : '#eab308'));
    circle.setAttribute('stroke', '#0a0c10');
    circle.setAttribute('stroke-width', '1.5');
    svg.appendChild(circle);
  });
}

let currentTeamRoster = [];

async function openTeamModal(teamName) {
  const modal = document.getElementById('team-modal');
  if (!modal) return;
  modal.classList.add('active');

  const titleEl = document.getElementById('modal-team-title');
  if (titleEl) titleEl.innerText = teamName || 'Team Roster';
  const subEl = document.getElementById('modal-team-subtitle');
  if (subEl) subEl.innerText = 'Loading roster details...';

  const tbody = document.getElementById('team-roster-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading team roster...</div></td></tr>';

  try {
    const data = await window.api.getTeamRoster(teamName);
    const stats = data.stats || {};
    const roster = data.roster || [];
    currentTeamRoster = roster;

    if (subEl) subEl.innerText = `Gaming Club / Team • ${roster.length} registered competitors`;
    const pwrEl = document.getElementById('team-modal-power');
    if (pwrEl) pwrEl.innerText = stats.power_rating ? Number(stats.power_rating).toFixed(1) : '-';
    const rosEl = document.getElementById('team-modal-roster');
    if (rosEl) rosEl.innerText = `${stats.roster_count || roster.length} Players`;
    const matEl = document.getElementById('team-modal-matches');
    if (matEl) matEl.innerText = `${stats.total_matches || 0} (${stats.total_wins || 0}W - ${stats.total_losses || 0}L)`;
    const wrEl = document.getElementById('team-modal-winrate');
    if (wrEl) wrEl.innerText = `${stats.win_rate || 0}%`;

    renderTeamRosterRows(roster);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error loading team: ${err.message}</td></tr>`;
  }
}

function renderTeamRosterRows(roster) {
  const tbody = document.getElementById('team-roster-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!roster || roster.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No player records found for this team.</td></tr>';
    return;
  }

  roster.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = () => openPlayerModal(p.player_id);

    const rank = idx + 1;
    const eloBadgeClass = getEloBadgeClass(p.current_elo);
    const winRate = p.win_rate !== undefined ? p.win_rate : (p.matches_played > 0 ? ((p.wins / p.matches_played) * 100).toFixed(1) : 0);

    tr.innerHTML = `
      <td class="rank-cell">#${rank}</td>
      <td>
        <div class="player-name-cell">
          <span class="player-link">${escapeHtml(p.player_name || p.full_name || 'Player')}</span>
        </div>
      </td>
      <td class="elo-badge ${eloBadgeClass}">
        ${Number(p.current_elo || 1500).toFixed(1)}
      </td>
      <td style="font-family:var(--font-mono); color:var(--text-secondary);">
        ${Number(p.peak_elo || p.current_elo || 1500).toFixed(1)}
      </td>
      <td style="font-family:var(--font-mono); font-size:0.85rem;">
        <span style="color:var(--win); font-weight:600;">${p.wins || 0}W</span> - 
        <span style="color:var(--loss); font-weight:600;">${p.losses || 0}L</span>
        ${p.draws ? ` - <span style="color:var(--draw); font-weight:600;">${p.draws}D</span>` : ''}
      </td>
      <td style="font-family:var(--font-mono); font-weight:600;">
        <span style="color: ${winRate >= 60 ? 'var(--win)' : (winRate >= 45 ? 'var(--accent)' : 'var(--text-secondary)')};">
          ${winRate}%
        </span>
      </td>
      <td>
        <span class="faction-pill">${escapeHtml(p.top_faction || 'Various')}</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}


let currentFactionMatches = [];
let currentFactionPlayers = [];
let currentFactionMatchups = [];

async function openFactionModal(factionName) {
  const modal = document.getElementById('faction-modal');
  if (!modal) return;
  modal.classList.add('active');

  const titleEl = document.getElementById('modal-faction-title');
  if (titleEl) titleEl.innerText = factionName || 'Faction Meta';
  const subEl = document.getElementById('modal-faction-subtitle');
  if (subEl) subEl.innerText = 'Loading recorded matches and commander data...';

  switchFactionModalTab('matches');

  const matchBody = document.getElementById('faction-matches-body');
  if (matchBody) matchBody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading faction match history...</div></td></tr>';

  try {
    const data = await window.api.getFactionDetails(factionName, 100);
    const matches = data.matches || [];
    const topPlayers = data.top_players || [];
    const matchups = data.matchups || [];

    currentFactionMatches = matches;
    currentFactionPlayers = topPlayers;
    currentFactionMatchups = matchups;

    if (subEl) subEl.innerText = `Warhammer 40k Competitive Meta • ${matches.length} matches analyzed`;
    const mCount = document.getElementById('faction-tab-matches-count');
    if (mCount) mCount.innerText = matches.length;
    const pCount = document.getElementById('faction-tab-players-count');
    if (pCount) pCount.innerText = topPlayers.length;
    const muCount = document.getElementById('faction-tab-matchups-count');
    if (muCount) muCount.innerText = matchups.length;

    renderFactionMatchesRows(matches);
    renderFactionPlayersRows(topPlayers);
    renderFactionMatchupsRows(matchups);
  } catch (err) {
    if (matchBody) matchBody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error loading faction details: ${err.message}</td></tr>`;
  }
}

function switchFactionModalTab(tabName) {
  ['matches', 'players', 'matchups'].forEach(t => {
    const btn = document.getElementById(`faction-subtab-${t}`);
    const view = document.getElementById(`faction-view-${t}`);
    if (btn) btn.classList.toggle('active', t === tabName);
    if (view) view.style.display = (t === tabName) ? 'block' : 'none';
  });
}

function renderFactionMatchesRows(matches) {
  const tbody = document.getElementById('faction-matches-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!matches || matches.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No match records found for this faction.</td></tr>';
    return;
  }

  matches.forEach((m, idx) => {
    const tr = document.createElement('tr');
    const isWin = m.outcome === 'W';
    const isLoss = m.outcome === 'L';
    const outcomeBadge = isWin 
      ? '<span class="badge badge-win">Victory</span>' 
      : (isLoss ? '<span class="badge badge-loss">Defeat</span>' : '<span class="badge badge-draw">Draw</span>');
    const scoreStr = `${m.player_score !== null && m.player_score !== undefined ? m.player_score : '-'} - ${m.opponent_score !== null && m.opponent_score !== undefined ? m.opponent_score : '-'}`;
    const dateStr = (m.match_date ? (typeof m.match_date === 'string' ? m.match_date.substring(0, 10) : new Date(m.match_date).toISOString().substring(0, 10)) : '');

    tr.innerHTML = `
      <td style="font-family:var(--font-mono); font-size:0.8rem; color:var(--text-secondary);">${dateStr || '#'}</td>
      <td>
        <span class="player-link" style="font-weight:600;" onclick="closeModal('faction-modal'); openEventModal('${m.event_id}')">
          ${escapeHtml(m.event_name || 'Tournament')}
        </span>
        <span style="font-size:0.75rem; color:var(--text-muted); margin-left:0.3rem;">R${m.round || 1}</span>
      </td>
      <td>
        <span class="player-link" style="font-weight:600;" onclick="openPlayerModal('${m.player_id}')">
          ${escapeHtml(m.player_name || 'Player')}
        </span>
      </td>
      <td style="font-family:var(--font-mono); font-weight:700; color:#fff;">
        ${scoreStr}
      </td>
      <td>
        <div style="font-weight:600;">
          <span class="player-link" onclick="openPlayerModal('${m.opponent_id}')">${escapeHtml(m.opponent_name || 'Opponent')}</span>
        </div>
        <div style="font-size:0.75rem; color:var(--text-secondary);">${escapeHtml(m.opponent_faction || 'Various')}</div>
      </td>
      <td>${outcomeBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderFactionPlayersRows(players) {
  const tbody = document.getElementById('faction-players-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!players || players.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No ranked players found for this faction.</td></tr>';
    return;
  }

  players.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = () => openPlayerModal(p.player_id);

    const rank = idx + 1;
    const eloBadgeClass = getEloBadgeClass(p.current_elo);

    tr.innerHTML = `
      <td class="rank-cell">#${rank}</td>
      <td>
        <div class="player-name-cell">
          <span class="player-link">${escapeHtml(p.player_name || 'Player')}</span>
          ${p.team ? `<span class="badge" style="font-size:0.7rem; background:var(--bg-primary); border:1px solid var(--border);">${escapeHtml(p.team)}</span>` : ''}
        </div>
      </td>
      <td class="elo-badge ${eloBadgeClass}">
        ${Number(p.current_elo || 1500).toFixed(1)}
      </td>
      <td style="font-family:var(--font-mono); color:var(--text-secondary);">
        ${Number(p.peak_elo || p.current_elo || 1500).toFixed(1)}
      </td>
      <td style="font-family:var(--font-mono); font-size:0.85rem;">
        <span style="color:var(--win); font-weight:600;">${p.wins || 0}W</span> - 
        <span style="color:var(--loss); font-weight:600;">${p.losses || 0}L</span>
      </td>
      <td style="font-family:var(--font-mono); font-weight:600;">
        <span style="color: ${p.win_rate >= 60 ? 'var(--win)' : (p.win_rate >= 45 ? 'var(--accent)' : 'var(--text-secondary)')};">
          ${Number(p.win_rate || 0).toFixed(1)}%
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderFactionMatchupsRows(matchups) {
  const tbody = document.getElementById('faction-matchups-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!matchups || matchups.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No matchup pairings recorded yet.</td></tr>';
    return;
  }

  matchups.forEach((m, idx) => {
    const tr = document.createElement('tr');
    const wr = Number(m.win_rate || 0);
    const wrColor = wr >= 55.0 ? 'var(--win)' : (wr >= 45.0 ? 'var(--accent)' : 'var(--loss)');

    tr.innerHTML = `
      <td class="rank-cell">#${idx + 1}</td>
      <td style="font-weight:700; color:#fff;">
        ⚔️ vs. ${escapeHtml(m.opponent_faction)}
      </td>
      <td style="font-family:var(--font-mono); font-weight:800; font-size:1.05rem; color:${wrColor};">
        ${wr.toFixed(1)}%
      </td>
      <td style="font-family:var(--font-mono); font-size:0.85rem;">
        <span style="color:var(--win); font-weight:600;">${m.wins || 0}W</span> - 
        <span style="color:var(--loss); font-weight:600;">${m.losses || 0}L</span>
        ${m.draws ? ` - <span style="color:var(--draw); font-weight:600;">${m.draws}D</span>` : ''}
      </td>
      <td style="font-family:var(--font-mono); font-weight:600;">
        <span class="badge" style="background:var(--bg-primary); border:1px solid var(--border);">${m.total_matches} Games</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
