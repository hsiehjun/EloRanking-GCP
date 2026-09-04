function switchLeaderboardSubtab(subtab) {
  if (subtab === 'factions' || subtab === 'predictor') {
    if (typeof switchTab === 'function') switchTab('meta-intel');
    if (typeof switchMetaSubtab === 'function') switchMetaSubtab(subtab);
    return;
  }

  const btnPlayers = document.getElementById('lead-subtab-players');
  const btnTeams = document.getElementById('lead-subtab-teams');
  const viewPlayers = document.getElementById('lead-view-players');
  const viewTeams = document.getElementById('lead-view-teams');

  if (btnPlayers) btnPlayers.classList.toggle('active', subtab === 'players');
  if (btnTeams) btnTeams.classList.toggle('active', subtab === 'teams');

  if (viewPlayers) viewPlayers.style.display = (subtab === 'players') ? 'block' : 'none';
  if (viewTeams) viewTeams.style.display = (subtab === 'teams') ? 'block' : 'none';

  if (subtab === 'teams') {
    loadLeaderboardTeams();
  } else {
    loadLeaderboard();
  }
}
window.switchLeaderboardSubtab = switchLeaderboardSubtab;

function switchMetaSubtab(subtab) {
  const btnFactions = document.getElementById('meta-subtab-factions');
  const btnPredictor = document.getElementById('meta-subtab-predictor');
  const viewFactions = document.getElementById('lead-view-factions');
  const viewPredictor = document.getElementById('lead-view-predictor');

  if (btnFactions) btnFactions.classList.toggle('active', subtab === 'factions');
  if (btnPredictor) btnPredictor.classList.toggle('active', subtab === 'predictor');

  if (viewFactions) viewFactions.style.display = (subtab === 'factions') ? 'block' : 'none';
  if (viewPredictor) viewPredictor.style.display = (subtab === 'predictor') ? 'block' : 'none';

  if (subtab === 'factions') {
    if (typeof loadFactionMeta === 'function') loadFactionMeta();
  }
}
window.switchMetaSubtab = switchMetaSubtab;

const leaderboardCache = new Map();
const leaderboardTeamsCache = new Map();
let leaderboardPrefetchTimer = null;

let leaderboardData = [];
let leaderboardTeamsData = [];
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

function prefetchNextLeaderboardPage(faction, nextPage, pageSize, sortState) {
  if (leaderboardPrefetchTimer) clearTimeout(leaderboardPrefetchTimer);
  const cacheKey = `lb_${faction}_${nextPage}_${pageSize}_${sortState.field}_${sortState.asc ? 'ASC' : 'DESC'}`;
  if (leaderboardCache.has(cacheKey)) return;

  leaderboardPrefetchTimer = setTimeout(async () => {
    try {
      const res = await window.api.getLeaderboard(
        faction, nextPage, pageSize,
        sortState.field, sortState.asc ? 'ASC' : 'DESC'
      );
      if (res && res.items) {
        leaderboardCache.set(cacheKey, res);
      }
    } catch (e) {
      // Non-critical background prefetch
    }
  }, 450);
}

async function loadLeaderboard(isPrefetch = false) {
  const faction = 'All';
  const tbody = document.getElementById('leaderboard-body');
  const cacheKey = `lb_${faction}_${leaderboardPagination.page}_${leaderboardPagination.pageSize}_${leaderboardSortState.field}_${leaderboardSortState.asc ? 'ASC' : 'DESC'}`;

  // 1. Stale-While-Revalidate: Instant cache hit rendering
  const cached = leaderboardCache.get(cacheKey);
  if (cached && !isPrefetch) {
    leaderboardData = cached.items || [];
    leaderboardPagination.total = cached.total || 0;
    leaderboardPagination.page = cached.page || leaderboardPagination.page;
    leaderboardPagination.pageSize = cached.page_size || leaderboardPagination.pageSize;
    leaderboardPagination.totalPages = cached.total_pages || 1;

    renderLeaderboardRows();
    renderPaginationBar('leaderboard-pagination', leaderboardPagination, 'setLeaderboardPage', 'setLeaderboardPageSize');
  }

  // 2. Visual indication: if rows exist, dim with opacity instead of blanking out table
  if (!cached && tbody && leaderboardData && leaderboardData.length > 0 && !isPrefetch) {
    tbody.style.opacity = '0.45';
    tbody.style.pointerEvents = 'none';
    tbody.style.transition = 'opacity 0.15s ease';
  } else if (!cached && tbody && (!leaderboardData || leaderboardData.length === 0) && !isPrefetch) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading leaderboard...</div></td></tr>';
  }

  try {
    const res = await window.api.getLeaderboard(
      faction, leaderboardPagination.page, leaderboardPagination.pageSize,
      leaderboardSortState.field, leaderboardSortState.asc ? 'ASC' : 'DESC'
    );
    if (res && res.items) {
      leaderboardCache.set(cacheKey, res);

      if (!isPrefetch) {
        leaderboardData = res.items;
        leaderboardPagination.total = res.total || 0;
        leaderboardPagination.page = res.page || 1;
        leaderboardPagination.pageSize = res.page_size || 25;
        leaderboardPagination.totalPages = res.total_pages || 1;

        if (tbody) {
          tbody.style.opacity = '1';
          tbody.style.pointerEvents = '';
        }
        renderLeaderboardRows();
        renderPaginationBar('leaderboard-pagination', leaderboardPagination, 'setLeaderboardPage', 'setLeaderboardPageSize');
      }
    } else {
      leaderboardData = Array.isArray(res) ? res : [];
      leaderboardPagination.total = leaderboardData.length;
      if (tbody) {
        tbody.style.opacity = '1';
        tbody.style.pointerEvents = '';
      }
      renderLeaderboardRows();
    }

    // 3. Prefetch next page during idle time
    if (!isPrefetch && leaderboardPagination.page < leaderboardPagination.totalPages) {
      prefetchNextLeaderboardPage(faction, leaderboardPagination.page + 1, leaderboardPagination.pageSize, leaderboardSortState);
    }
  } catch (err) {
    if (tbody && !cached) {
      tbody.style.opacity = '1';
      tbody.style.pointerEvents = '';
      tbody.innerHTML = `<tr><td colspan="9" class="empty-state" style="color:var(--loss);">Error loading leaderboard: ${err.message}</td></tr>`;
    }
  }
}

function renderLeaderboardRows() {
  const tbody = document.getElementById('leaderboard-body');
  if (!tbody) return;
  tbody.style.opacity = '1';
  tbody.style.pointerEvents = '';
  tbody.innerHTML = '';

  if (!leaderboardData || leaderboardData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No players found.</td></tr>';
    return;
  }

  const page = (leaderboardPagination && leaderboardPagination.page) ? Math.max(1, Number(leaderboardPagination.page)) : 1;
  const pageSize = (leaderboardPagination && leaderboardPagination.pageSize) ? Number(leaderboardPagination.pageSize) : 25;
  const offset = (page - 1) * pageSize;

  const list = Array.isArray(leaderboardData) ? leaderboardData : (leaderboardData && Array.isArray(leaderboardData.items) ? leaderboardData.items : []);
  list.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = () => openPlayerModal(p.player_id);

    const rank = offset + idx + 1;
    let rankClass = '';
    if (rank === 1) rankClass = 'rank-top-1';
    else if (rank === 2) rankClass = 'rank-top-2';
    else if (rank === 3) rankClass = 'rank-top-3';

    const eloBadgeClass = getEloBadgeClass(p.current_elo);
    const winRate = p.win_rate !== undefined ? p.win_rate : (p.matches_played > 0 ? ((p.wins / p.matches_played) * 100).toFixed(1) : 0);
    const teamHtml = p.team ? `<span class="badge" style="background:rgba(168,85,247,0.12); color:#c084fc; border:1px solid rgba(168,85,247,0.25); font-size:0.68rem; margin-top:0.2rem; cursor:pointer;" onclick="event.stopPropagation(); filterByTeam('${escapeHtml(p.team)}')">🛡️ ${escapeHtml(p.team)}</span>` : '';
    const isSelf = (typeof currentUser !== 'undefined' && currentUser && (currentUser.player_id === p.player_id || currentUser.id === p.account_user_id));
    const chatPill = (p.has_account && !isSelf) ? `
      <button type="button" class="btn-chat-pill" title="Send Chat Request" onclick="event.stopPropagation(); handlePlayerChatClick('${escapeHtml(p.player_id)}', '${escapeHtml(p.player_name || '')}', '${p.account_user_id || ''}')">
        💬 Chat
      </button>
    ` : '';

    tr.innerHTML = `
      <td class="rank-cell ${rankClass}">#${rank}</td>
      <td>
        <div class="player-name-cell">
          <div style="display: inline-flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
            <span class="player-link">${escapeHtml(p.player_name || 'Unknown')}</span>
            ${chatPill}
          </div>
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
        ${(p.top_faction || 'Various').split(',').map(f => `<span class="faction-pill" title="${escapeHtml(f.trim())}" style="margin:2px 3px 2px 0; display:inline-block;">${escapeHtml(f.trim())}</span>`).join('')}
      </td>
      <td class="col-last-active" style="font-size:0.8rem; color:var(--text-muted); font-family:var(--font-mono);">
        ${(p.last_active_date || '').slice(0, 10) || '-'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadLeaderboardTeams() {
  const minRoster = 5;
  const tbody = document.getElementById('lead-teams-body');
  const cacheKey = `lb_teams_${minRoster}_100`;

  const cached = leaderboardTeamsCache.get(cacheKey);
  if (cached) {
    leaderboardTeamsData = cached;
    renderLeaderboardTeamsRows();
  } else if (tbody && leaderboardTeamsData && leaderboardTeamsData.length > 0) {
    tbody.style.opacity = '0.45';
    tbody.style.pointerEvents = 'none';
    tbody.style.transition = 'opacity 0.15s ease';
  } else if (tbody && (!leaderboardTeamsData || leaderboardTeamsData.length === 0)) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading team rankings...</div></td></tr>';
  }

  try {
    const data = await window.api.getLeaderboardTeams(minRoster, 100);
    const items = (data && Array.isArray(data.items)) ? data.items : (Array.isArray(data) ? data : []);
    leaderboardTeamsCache.set(cacheKey, items);
    leaderboardTeamsData = items;
    if (tbody) {
      tbody.style.opacity = '1';
      tbody.style.pointerEvents = '';
    }
    renderLeaderboardTeamsRows();
  } catch (err) {
    console.error('Error loading team rankings:', err);
    if (tbody && !cached) {
      tbody.style.opacity = '1';
      tbody.style.pointerEvents = '';
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color:var(--loss);"><p>Error loading team rankings: ${escapeHtml(err.message)}</p><button class="btn btn-outline" style="margin-top:0.5rem;" onclick="loadLeaderboardTeams()">🔄 Retry</button></td></tr>`;
    }
  }
}

function renderLeaderboardTeamsRows() {
  const tbody = document.getElementById('lead-teams-body');
  if (!tbody) return;
  tbody.style.opacity = '1';
  tbody.style.pointerEvents = '';
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

function handlePlayerChatClick(playerId, playerName, accountUserId) {
  const token = localStorage.getItem('elo_auth_token') || localStorage.getItem('native_session_token');
  if (!token) {
    alert('Please log in or create an account to send chat requests.');
    window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.hash);
    return;
  }
  if (typeof openSendChatRequestModal === 'function') {
    openSendChatRequestModal(playerId, playerName, accountUserId);
  } else if (typeof openProposeMatchModal === 'function') {
    openProposeMatchModal(accountUserId || playerId, playerName);
  }
}
window.handlePlayerChatClick = handlePlayerChatClick;
