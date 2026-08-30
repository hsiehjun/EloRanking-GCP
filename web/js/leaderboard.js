function switchLeaderboardSubtab(subtab) {
  const btnPlayers = document.getElementById('lead-subtab-players');
  const btnTeams = document.getElementById('lead-subtab-teams');
  const btnFactions = document.getElementById('lead-subtab-factions');
  const btnPredictor = document.getElementById('lead-subtab-predictor');

  const viewPlayers = document.getElementById('lead-view-players');
  const viewTeams = document.getElementById('lead-view-teams');
  const viewFactions = document.getElementById('lead-view-factions');
  const viewPredictor = document.getElementById('lead-view-predictor');

  if (btnPlayers) btnPlayers.classList.toggle('active', subtab === 'players');
  if (btnTeams) btnTeams.classList.toggle('active', subtab === 'teams');
  if (btnFactions) btnFactions.classList.toggle('active', subtab === 'factions');
  if (btnPredictor) btnPredictor.classList.toggle('active', subtab === 'predictor');

  if (viewPlayers) viewPlayers.style.display = (subtab === 'players') ? 'block' : 'none';
  if (viewTeams) viewTeams.style.display = (subtab === 'teams') ? 'block' : 'none';
  if (viewFactions) viewFactions.style.display = (subtab === 'factions') ? 'block' : 'none';
  if (viewPredictor) viewPredictor.style.display = (subtab === 'predictor') ? 'block' : 'none';

  if (subtab === 'teams') {
    loadLeaderboardTeams();
  } else if (subtab === 'factions') {
    if (typeof loadFactionMeta === 'function') loadFactionMeta();
  } else if (subtab === 'predictor') {
    // Predictor ready
  } else {
    loadLeaderboard();
  }
}

let leaderboardData = [];
let leaderboardPagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 };
let leaderboardSortState = { field: 'current_elo', asc: false };

function setLeaderboardPage(newPage) {
  leaderboardPagination.page = newPage;
  loadLeaderboard();
}

function setLeaderboardPageSize(newSize) {
  leaderboardPagination.pageSize = newSize;
  leaderboardPagination.page = 1;
  loadLeaderboard();
}

async function loadLeaderboard() {
  const factionSelect = document.getElementById('leaderboard-faction-filter') || document.getElementById('faction-filter');
  const faction = factionSelect ? factionSelect.value : 'All';
  const tbody = document.getElementById('leaderboard-body');

  if (tbody && (!leaderboardData || leaderboardData.length === 0)) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading leaderboard...</div></td></tr>';
  }

  try {
    const res = await window.api.getLeaderboard(
      faction, leaderboardPagination.page, leaderboardPagination.pageSize,
      leaderboardSortState.field, leaderboardSortState.asc ? 'ASC' : 'DESC'
    );
    if (res && res.items) {
      leaderboardData = res.items;
      leaderboardPagination.total = res.total || 0;
      leaderboardPagination.page = res.page || 1;
      leaderboardPagination.pageSize = res.page_size || 25;
      leaderboardPagination.totalPages = res.total_pages || 1;
    } else {
      leaderboardData = Array.isArray(res) ? res : [];
      leaderboardPagination.total = leaderboardData.length;
    }
    renderLeaderboardRows();
    renderPaginationBar('leaderboard-pagination', leaderboardPagination, 'setLeaderboardPage', 'setLeaderboardPageSize');
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="empty-state" style="color:var(--loss);">Error loading leaderboard: ${err.message}</td></tr>`;
  }
}

function renderLeaderboardRows() {
  const tbody = document.getElementById('leaderboard-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!leaderboardData || leaderboardData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No players found matching filter.</td></tr>';
    return;
  }

  const list = Array.isArray(leaderboardData) ? leaderboardData : (leaderboardData && Array.isArray(leaderboardData.items) ? leaderboardData.items : []);
  list.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = () => openPlayerModal(p.player_id);

    const rank = idx + 1;
    let rankClass = '';
    if (rank === 1) rankClass = 'rank-top-1';
    else if (rank === 2) rankClass = 'rank-top-2';
    else if (rank === 3) rankClass = 'rank-top-3';

    const eloBadgeClass = getEloBadgeClass(p.current_elo);
    const winRate = p.win_rate !== undefined ? p.win_rate : (p.matches_played > 0 ? ((p.wins / p.matches_played) * 100).toFixed(1) : 0);
    const teamHtml = p.team ? `<span class="badge" style="background:rgba(168,85,247,0.12); color:#c084fc; border:1px solid rgba(168,85,247,0.25); font-size:0.68rem; margin-top:0.2rem; cursor:pointer;" onclick="event.stopPropagation(); filterByTeam('${escapeHtml(p.team)}')">🛡️ ${escapeHtml(p.team)}</span>` : '';

    tr.innerHTML = `
      <td class="rank-cell ${rankClass}">#${rank}</td>
      <td>
        <div class="player-name-cell">
          <span class="player-link">${escapeHtml(p.player_name || 'Unknown')}</span>
          ${teamHtml}
        </div>
      </td>
      <td class="elo-badge ${eloBadgeClass}">${Number(p.current_elo).toFixed(1)}</td>
      <td class="col-peak" style="font-family:var(--font-mono); color:var(--text-secondary);">${Number(p.peak_elo || p.current_elo).toFixed(1)}</td>
      <td style="font-family:var(--font-mono); font-size:0.85rem;">
        <span style="color:var(--win); font-weight:600;">${p.wins}W</span> - 
        <span style="color:var(--loss); font-weight:600;">${p.losses}L</span>
        ${p.draws ? ` - <span style="color:var(--draw); font-weight:600;">${p.draws}D</span>` : ''}
      </td>
      <td style="font-family:var(--font-mono); font-weight:600;">
        <span style="color: ${winRate >= 60 ? 'var(--win)' : (winRate >= 45 ? 'var(--accent)' : 'var(--text-secondary)')};">
          ${winRate}%
        </span>
      </td>
      <td class="col-faction">
        <span class="faction-pill" title="${escapeHtml(p.top_faction || 'Various')}">${escapeHtml(p.top_faction || 'Various')}</span>
      </td>
      <td class="col-last-active" style="font-size:0.8rem; color:var(--text-muted); font-family:var(--font-mono);">
        ${(p.last_active_date || '').slice(0, 10) || '-'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadLeaderboardTeams() {
  const minRosterSelect = document.getElementById('lead-teams-min-roster-filter');
  const minRoster = minRosterSelect ? minRosterSelect.value : 2;
  const tbody = document.getElementById('lead-teams-body');
  if (tbody && (!leaderboardTeamsData || leaderboardTeamsData.length === 0)) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading team rankings...</div></td></tr>';
  }

  try {
    const data = await window.api.getLeaderboardTeams(minRoster, 100);
    if (data && data.items) {
      leaderboardTeamsData = data.items;
    } else {
      leaderboardTeamsData = Array.isArray(data) ? data : [];
    }
    renderLeaderboardTeamsRows();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color:var(--loss);">Error loading team rankings: ${err.message}</td></tr>`;
  }
}

function renderLeaderboardTeamsRows() {
  const tbody = document.getElementById('lead-teams-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const list = Array.isArray(leaderboardTeamsData) ? leaderboardTeamsData : (leaderboardTeamsData && Array.isArray(leaderboardTeamsData.items) ? leaderboardTeamsData.items : []);
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No teams found matching roster threshold.</td></tr>';
    return;
  }

  list.forEach((t, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = () => openTeamModal(t.team);

    const rank = idx + 1;
    let rankClass = '';
    if (rank === 1) rankClass = 'rank-top-1';
    else if (rank === 2) rankClass = 'rank-top-2';
    else if (rank === 3) rankClass = 'rank-top-3';

    const pRating = Number(t.power_rating || 0).toFixed(1);
    const avgElo = Number(t.avg_elo || 1500).toFixed(1);
    const topElo = Number(t.top_player_elo || 1500).toFixed(1);
    const wr = Number(t.team_win_rate || 0).toFixed(1);

    tr.innerHTML = `
      <td class="rank-cell ${rankClass}">#${rank}</td>
      <td>
        <div style="font-weight:600; color:#fff; display:flex; align-items:center; gap:0.4rem;">
          <span>🛡️</span>
          <span class="player-link">${escapeHtml(t.team || 'Team')}</span>
        </div>
      </td>
      <td style="font-family:var(--font-mono); font-weight:800; font-size:1.05rem; color:#a855f7;">
        ${pRating}
      </td>
      <td style="font-family:var(--font-mono); font-weight:600; color:var(--accent);">
        ${avgElo}
      </td>
      <td>
        <span class="player-link" style="font-size:0.85rem;" onclick="event.stopPropagation(); openPlayerModal('${t.top_player_id || ''}')">
          ${escapeHtml(t.top_player_name || 'Top Player')}
        </span>
        <span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted); margin-left:0.3rem;">(${topElo})</span>
      </td>
      <td style="font-family:var(--font-mono); font-weight:600;">
        <span class="badge" style="background:var(--bg-primary); border:1px solid var(--border);">${t.roster_count || 1} Players</span>
      </td>
      <td style="font-family:var(--font-mono); font-size:0.85rem;">
        <span style="color:var(--win); font-weight:600;">${t.total_wins || 0}W</span> - 
        <span style="color:var(--loss); font-weight:600;">${t.total_losses || 0}L</span>
        ${t.total_draws ? ` - <span style="color:var(--draw); font-weight:600;">${t.total_draws}D</span>` : ''}
      </td>
      <td style="font-family:var(--font-mono); font-weight:600;">
        <span style="color: ${wr >= 55 ? 'var(--win)' : (wr >= 45 ? 'var(--accent)' : 'var(--text-secondary)')};">
          ${wr}%
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
