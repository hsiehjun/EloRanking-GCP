function switchLeaderboardSubtab(subtab) {
  if (subtab === 'factions' || subtab === 'predictor') {
    if (typeof switchTab === 'function') switchTab('meta-intel');
    if (typeof switchMetaSubtab === 'function') switchMetaSubtab(subtab);
    return;
  }

  const btnPlayers = document.getElementById('lead-subtab-players');
  const btnTeams = document.getElementById('lead-subtab-teams');
  const btnItc = document.getElementById('lead-subtab-itc');
  const viewPlayers = document.getElementById('lead-view-players');
  const viewTeams = document.getElementById('lead-view-teams');
  const viewItc = document.getElementById('lead-view-itc');

  if (btnPlayers) btnPlayers.classList.toggle('active', subtab === 'players');
  if (btnTeams) btnTeams.classList.toggle('active', subtab === 'teams');
  if (btnItc) btnItc.classList.toggle('active', subtab === 'itc');

  if (viewPlayers) viewPlayers.style.display = (subtab === 'players') ? 'block' : 'none';
  if (viewTeams) viewTeams.style.display = (subtab === 'teams') ? 'block' : 'none';
  if (viewItc) viewItc.style.display = (subtab === 'itc') ? 'block' : 'none';

  if (subtab === 'teams') {
    loadLeaderboardTeams();
  } else if (subtab === 'itc') {
    loadLeaderboardItc();
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
const leaderboardItcCache = new Map();
let leaderboardPrefetchTimer = null;
let leaderboardTeamsPrefetchTimer = null;
let leaderboardItcPrefetchTimer = null;
let leaderboardItcSearchTimer = null;

let leaderboardData = [];
let leaderboardTeamsData = [];
let leaderboardItcData = [];
let leaderboardItcCategory = 'players';
let leaderboardPagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 };
let leaderboardTeamsPagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 };
let leaderboardItcPagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 };
let leaderboardSortState = { field: 'current_elo', asc: false };
let leaderboardTeamsSortState = { field: 'power_rating', asc: false };
let leaderboardItcSortState = { field: 'itc_points', asc: false };

function setLeaderboardPage(newPage) {
  leaderboardPagination.page = newPage;
  loadLeaderboard();
}
window.setLeaderboardPage = setLeaderboardPage;

function setLeaderboardPageSize(newSize) {
  leaderboardPagination.pageSize = newSize;
  leaderboardPagination.page = 1;
  loadLeaderboard();
}
window.setLeaderboardPageSize = setLeaderboardPageSize;

function setLeaderboardTeamsPage(newPage) {
  leaderboardTeamsPagination.page = newPage;
  loadLeaderboardTeams();
}
window.setLeaderboardTeamsPage = setLeaderboardTeamsPage;

function setLeaderboardTeamsPageSize(newSize) {
  leaderboardTeamsPagination.pageSize = newSize;
  leaderboardTeamsPagination.page = 1;
  loadLeaderboardTeams();
}
window.setLeaderboardTeamsPageSize = setLeaderboardTeamsPageSize;

function prefetchNextLeaderboardPage(faction, nextPage, pageSize, sortState) {
  if (leaderboardPrefetchTimer) clearTimeout(leaderboardPrefetchTimer);
  const gs = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const cacheKey = `lb_${gs}_${faction}_${nextPage}_${pageSize}_${sortState.field}_${sortState.asc ? 'ASC' : 'DESC'}`;
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

function prefetchNextLeaderboardTeamsPage(minRoster, nextPage, pageSize, sortState) {
  if (leaderboardTeamsPrefetchTimer) clearTimeout(leaderboardTeamsPrefetchTimer);
  const gs = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const cacheKey = `lb_teams_${gs}_${minRoster}_${nextPage}_${pageSize}_${sortState.field}_${sortState.asc ? 'ASC' : 'DESC'}`;
  if (leaderboardTeamsCache.has(cacheKey)) return;

  leaderboardTeamsPrefetchTimer = setTimeout(async () => {
    try {
      const res = await window.api.getLeaderboardTeams(
        minRoster, nextPage, pageSize,
        sortState.field, sortState.asc ? 'ASC' : 'DESC'
      );
      if (res && res.items) {
        leaderboardTeamsCache.set(cacheKey, res);
      }
    } catch (e) {
      // Non-critical background prefetch
    }
  }, 450);
}

async function loadLeaderboard(isPrefetch = false) {
  const faction = 'All';
  const tbody = document.getElementById('leaderboard-body');
  const gs = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const cacheKey = `lb_${gs}_${faction}_${leaderboardPagination.page}_${leaderboardPagination.pageSize}_${leaderboardSortState.field}_${leaderboardSortState.asc ? 'ASC' : 'DESC'}`;

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
    tbody.innerHTML = '<tr class="loading-row"><td colspan="9" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading leaderboard...</div></td></tr>';
  }

  try {
    const res = await window.api.getLeaderboard(
      faction, leaderboardPagination.page, leaderboardPagination.pageSize,
      leaderboardSortState.field, leaderboardSortState.asc ? 'ASC' : 'DESC'
    );
    if (res && res.error) {
      throw new Error(res.error);
    }
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
      leaderboardData = Array.isArray(res) ? res : (res && Array.isArray(res.players) ? res.players : (res && Array.isArray(res.items) ? res.items : []));
      leaderboardPagination.total = (res && res.total != null) ? res.total : leaderboardData.length;
      leaderboardPagination.totalPages = (res && res.total_pages) ? res.total_pages : Math.max(1, Math.ceil(leaderboardPagination.total / leaderboardPagination.pageSize));
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
      tbody.innerHTML = `<tr class="empty-row"><td colspan="9" class="empty-state" style="color:var(--loss);"><p>Error loading leaderboard: ${escapeHtml(err.message)}</p><button class="btn btn-outline" style="margin-top:0.5rem;" onclick="loadLeaderboard()">🔄 Retry</button></td></tr>`;
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
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty-state">No players found.</td></tr>';
    return;
  }

  const page = (leaderboardPagination && leaderboardPagination.page) ? Math.max(1, Number(leaderboardPagination.page)) : 1;
  const pageSize = (leaderboardPagination && leaderboardPagination.pageSize) ? Number(leaderboardPagination.pageSize) : 25;
  const offset = (page - 1) * pageSize;

  const list = Array.isArray(leaderboardData) ? leaderboardData : (leaderboardData && Array.isArray(leaderboardData.items) ? leaderboardData.items : []);
  list.forEach((p, idx) => {
    const tr = document.createElement('tr');
    const safeName = String(p.player_name || 'Unknown').replace(/'/g, "\\'");
    tr.onclick = (e) => { 
      e.stopPropagation(); 
      openPlayerModal(p.player_id, p.player_name || '');
    };

    const rank = offset + idx + 1;
    let rankClass = '';
    if (rank === 1) rankClass = 'rank-top-1';
    else if (rank === 2) rankClass = 'rank-top-2';
    else if (rank === 3) rankClass = 'rank-top-3';

    const eloBadgeClass = getEloBadgeClass(p.current_elo, p.matches_played);
    const winRate = p.win_rate !== undefined ? p.win_rate : (p.matches_played > 0 ? ((p.wins / p.matches_played) * 100).toFixed(1) : 0);
    const teamHtml = p.team ? `<span class="badge" style="background:rgba(168,85,247,0.12); color:#c084fc; border:1px solid rgba(168,85,247,0.25); font-size:0.68rem; margin-top:0.2rem; cursor:pointer;" onclick="event.stopPropagation(); openTeamModal('${escapeHtml(p.team)}')" title="View ${escapeHtml(p.team)} Roster">🛡️ ${escapeHtml(p.team)}</span>` : '';
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
      <td>
        ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(p.current_elo, p.matches_played) : `<span class="elo-badge ${eloBadgeClass}">${Number(p.current_elo).toFixed(1)}</span>`}
      </td>
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
        ${(() => {
          const rawFacs = (p.top_faction || 'Various').split(',').map(f => f.trim()).filter(Boolean);
          const showCount = 2;
          const visible = rawFacs.slice(0, showCount);
          const remaining = rawFacs.length - visible.length;
          return visible.map(f => `<span class="faction-pill" title="${escapeHtml(f)}" style="margin:2px 3px 2px 0; display:inline-block;">${escapeHtml(f)}</span>`).join('') +
            (remaining > 0 ? `<span class="faction-pill" title="${escapeHtml(rawFacs.slice(showCount).join(', '))}" style="margin:2px 3px 2px 0; display:inline-block; opacity:0.85; font-size:0.72rem; cursor:help;">+${remaining}</span>` : '');
        })()}
      </td>
      <td class="col-last-active" style="font-size:0.8rem; color:var(--text-muted); font-family:var(--font-mono);">
        ${(p.last_active_date || p.last_active || '').slice(0, 10) || '-'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}
window.renderLeaderboardRows = renderLeaderboardRows;

async function loadLeaderboardTeams(isPrefetch = false) {
  const minRoster = 1;
  const tbody = document.getElementById('lead-teams-body');
  const gs = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const cacheKey = `lb_teams_${gs}_${minRoster}_${leaderboardTeamsPagination.page}_${leaderboardTeamsPagination.pageSize}_${leaderboardTeamsSortState.field}_${leaderboardTeamsSortState.asc ? 'ASC' : 'DESC'}`;

  // 1. Stale-While-Revalidate: Instant cache hit rendering
  const cached = leaderboardTeamsCache.get(cacheKey);
  if (cached && !isPrefetch) {
    leaderboardTeamsData = cached.items || [];
    leaderboardTeamsPagination.total = cached.total || 0;
    leaderboardTeamsPagination.page = cached.page || leaderboardTeamsPagination.page;
    leaderboardTeamsPagination.pageSize = cached.page_size || leaderboardTeamsPagination.pageSize;
    leaderboardTeamsPagination.totalPages = cached.total_pages || 1;

    renderLeaderboardTeamsRows();
    renderPaginationBar('lead-teams-pagination', leaderboardTeamsPagination, 'setLeaderboardTeamsPage', 'setLeaderboardTeamsPageSize');
  }

  // 2. Visual indication: if rows exist, dim with opacity instead of blanking out table
  if (!cached && tbody && leaderboardTeamsData && leaderboardTeamsData.length > 0 && !isPrefetch) {
    tbody.style.opacity = '0.45';
    tbody.style.pointerEvents = 'none';
    tbody.style.transition = 'opacity 0.15s ease';
  } else if (!cached && tbody && (!leaderboardTeamsData || leaderboardTeamsData.length === 0) && !isPrefetch) {
    tbody.innerHTML = '<tr class="loading-row"><td colspan="8" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading team standings...</div></td></tr>';
  }

  try {
    const res = await window.api.getLeaderboardTeams(
      minRoster,
      leaderboardTeamsPagination.page,
      leaderboardTeamsPagination.pageSize,
      leaderboardTeamsSortState.field,
      leaderboardTeamsSortState.asc ? 'ASC' : 'DESC'
    );
    if (res && res.error) {
      throw new Error(res.error);
    }
    if (res && res.items) {
      leaderboardTeamsCache.set(cacheKey, res);

      if (!isPrefetch) {
        leaderboardTeamsData = res.items;
        leaderboardTeamsPagination.total = res.total || 0;
        leaderboardTeamsPagination.page = res.page || 1;
        leaderboardTeamsPagination.pageSize = res.page_size || 25;
        leaderboardTeamsPagination.totalPages = res.total_pages || 1;

        if (tbody) {
          tbody.style.opacity = '1';
          tbody.style.pointerEvents = '';
        }
        renderLeaderboardTeamsRows();
        renderPaginationBar('lead-teams-pagination', leaderboardTeamsPagination, 'setLeaderboardTeamsPage', 'setLeaderboardTeamsPageSize');
      }
    } else {
      leaderboardTeamsData = Array.isArray(res) ? res : (res && Array.isArray(res.teams) ? res.teams : (res && Array.isArray(res.items) ? res.items : []));
      leaderboardTeamsPagination.total = (res && res.total != null) ? res.total : leaderboardTeamsData.length;
      leaderboardTeamsPagination.totalPages = (res && res.total_pages) ? res.total_pages : Math.max(1, Math.ceil(leaderboardTeamsPagination.total / leaderboardTeamsPagination.pageSize));
      if (tbody) {
        tbody.style.opacity = '1';
        tbody.style.pointerEvents = '';
      }
      renderLeaderboardTeamsRows();
      renderPaginationBar('lead-teams-pagination', leaderboardTeamsPagination, 'setLeaderboardTeamsPage', 'setLeaderboardTeamsPageSize');
    }

    // 3. Prefetch next page during idle time
    if (!isPrefetch && leaderboardTeamsPagination.page < leaderboardTeamsPagination.totalPages) {
      prefetchNextLeaderboardTeamsPage(minRoster, leaderboardTeamsPagination.page + 1, leaderboardTeamsPagination.pageSize, leaderboardTeamsSortState);
    }
  } catch (err) {
    console.error('Error loading team rankings:', err);
    if (tbody && !cached) {
      tbody.style.opacity = '1';
      tbody.style.pointerEvents = '';
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8" class="empty-state" style="color:var(--loss);"><p>Error loading team rankings: ${escapeHtml(err.message)}</p><button class="btn btn-outline" style="margin-top:0.5rem;" onclick="loadLeaderboardTeams()">🔄 Retry</button></td></tr>`;
    }
  }
}
window.loadLeaderboardTeams = loadLeaderboardTeams;

function renderLeaderboardTeamsRows() {
  const tbody = document.getElementById('lead-teams-body');
  if (!tbody) return;
  tbody.style.opacity = '1';
  tbody.style.pointerEvents = '';
  tbody.innerHTML = '';

  const list = Array.isArray(leaderboardTeamsData) ? leaderboardTeamsData : (leaderboardTeamsData && Array.isArray(leaderboardTeamsData.items) ? leaderboardTeamsData.items : []);
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty-state">No teams found.</td></tr>';
    return;
  }

  const page = (leaderboardTeamsPagination && leaderboardTeamsPagination.page) ? Math.max(1, Number(leaderboardTeamsPagination.page)) : 1;
  const pageSize = (leaderboardTeamsPagination && leaderboardTeamsPagination.pageSize) ? Number(leaderboardTeamsPagination.pageSize) : 25;
  const offset = (page - 1) * pageSize;

  list.forEach((t, idx) => {
    const teamName = t.team || t.name || t.team_name || 'Team';
    const tr = document.createElement('tr');
    tr.onclick = (e) => { e.stopPropagation(); openTeamModal(teamName); };

    const rank = t.rank != null ? Number(t.rank) : (offset + idx + 1);
    let rankClass = '';
    if (rank === 1) rankClass = 'rank-top-1';
    else if (rank === 2) rankClass = 'rank-top-2';
    else if (rank === 3) rankClass = 'rank-top-3';

    const pRating = Number(t.power_rating || 0).toFixed(1);
    const activeAvg = Number(t.active_avg_elo != null ? t.active_avg_elo : (t.avg_elo || t.top5_avg_elo || 1500)).toFixed(1);
    const allAvg = Number(t.avg_elo || t.active_avg_elo || t.top5_avg_elo || 1500).toFixed(1);
    const avgEloTitle = `${activeAvg} Active Club Avg (${allAvg} All-Time Registered Avg)`;
    const topElo = Number(t.top_player_elo || 1500).toFixed(1);
    const wr = Number(t.team_win_rate != null ? t.team_win_rate : (t.win_rate || 0)).toFixed(1);
    const activeCount = t.active_roster_count !== undefined && t.active_roster_count !== null ? t.active_roster_count : (t.roster_count || 1);
    const totalCount = t.roster_count || activeCount || 1;
    const rosterTitle = `${totalCount} Total Registered Competitors (${activeCount} Active in last 180 days)`;
    const safeTopName = String(t.top_player_name || '').replace(/'/g, "\\'");

    tr.innerHTML = `
      <td class="rank-cell ${rankClass}">#${rank}</td>
      <td>
        <div style="font-weight:600; color:#fff; display:flex; align-items:center; gap:0.4rem;">
          <span>🛡️</span>
          <span class="player-link">${escapeHtml(teamName)}</span>
        </div>
      </td>
      <td>
        ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(pRating, 10) : `<span style="font-family:var(--font-mono); font-weight:800; font-size:1.05rem; color:#a855f7;">${pRating}</span>`}
      </td>
      <td title="${escapeHtml(avgEloTitle)}">
        ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(activeAvg, 10) : `<span style="font-family:var(--font-mono); font-weight:600; color:var(--accent);">${activeAvg}</span>`}
      </td>
      <td>
        <div style="display: inline-flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
          <span class="player-link" style="font-size:0.85rem;" onclick="event.stopPropagation(); openPlayerModal('${t.top_player_id || ''}', '${escapeHtml(safeTopName)}')">
            ${escapeHtml(t.top_player_name || 'Top Player')}
          </span>
          ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(topElo, 10) : `<span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted);">(${topElo})</span>`}
        </div>
      </td>
      <td>
        <span class="roster-badge" title="${escapeHtml(rosterTitle)}">
          <span class="roster-badge-num">${activeCount}</span> <span class="roster-badge-label">Active</span>
        </span>
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
window.renderLeaderboardTeamsRows = renderLeaderboardTeamsRows;

/* ==========================================================================
   GLOBAL ITC RANKINGS (INDIVIDUAL & TEAM)
   ========================================================================== */

function setItcLeaderboardCategory(cat) {
  const normalized = (cat === 'teams' || cat === 'team') ? 'teams' : 'players';
  leaderboardItcCategory = normalized;
  leaderboardItcPagination.page = 1;
  leaderboardItcSortState = { field: 'itc_points', asc: false };
  if (typeof currentSort !== 'undefined' && currentSort['lead-itc']) {
    currentSort['lead-itc'] = { field: 'itc_points', asc: false };
  }

  const btnPlayers = document.getElementById('itc-mode-players');
  const btnTeams = document.getElementById('itc-mode-teams');
  if (btnPlayers) btnPlayers.classList.toggle('active', normalized === 'players');
  if (btnTeams) btnTeams.classList.toggle('active', normalized === 'teams');

  const badge = document.getElementById('itc-season-badge');
  if (badge) {
    badge.textContent = normalized === 'teams' ? '2026 Season • Top 10 Events' : '2026 Season • Top 6 Events';
  }

  const searchInput = document.getElementById('itc-search-input');
  if (searchInput) {
    searchInput.placeholder = normalized === 'teams' ? 'Search team or top player...' : 'Search player, team, or faction...';
  }

  renderLeaderboardItcHeader();
  loadLeaderboardItc();
}
window.setItcLeaderboardCategory = setItcLeaderboardCategory;

function debounceItcSearch() {
  if (leaderboardItcSearchTimer) clearTimeout(leaderboardItcSearchTimer);
  leaderboardItcSearchTimer = setTimeout(() => {
    leaderboardItcPagination.page = 1;
    loadLeaderboardItc();
  }, 180);
}
window.debounceItcSearch = debounceItcSearch;

function setLeaderboardItcPage(newPage) {
  leaderboardItcPagination.page = newPage;
  loadLeaderboardItc();
}
window.setLeaderboardItcPage = setLeaderboardItcPage;

function setLeaderboardItcPageSize(newSize) {
  leaderboardItcPagination.pageSize = newSize;
  leaderboardItcPagination.page = 1;
  loadLeaderboardItc();
}
window.setLeaderboardItcPageSize = setLeaderboardItcPageSize;

function renderLeaderboardItcHeader() {
  const thead = document.getElementById('lead-itc-thead');
  if (!thead) return;
  const f = leaderboardItcSortState.field || 'itc_points';
  const cls = (col) => `sortable ${f === col ? (leaderboardItcSortState.asc ? 'sorted-asc' : 'sorted-desc') : ''}`.trim();

  if (leaderboardItcCategory === 'teams') {
    thead.innerHTML = `
      <tr>
        <th class="${cls('rank')}" onclick="sortTable('lead-itc', 'rank')">ITC Rank</th>
        <th class="${cls('team')}" onclick="sortTable('lead-itc', 'team')">Team / Gaming Club</th>
        <th class="${cls('itc_points')}" onclick="sortTable('lead-itc', 'itc_points')">ITC Points</th>
        <th class="${cls('events_scored')}" onclick="sortTable('lead-itc', 'events_scored')">Events Scored</th>
        <th class="${cls('power_rating')}" onclick="sortTable('lead-itc', 'power_rating')">OmniTactica Power</th>
        <th class="${cls('avg_elo')}" onclick="sortTable('lead-itc', 'avg_elo')">Top Rated Player</th>
        <th class="${cls('total_matches')}" onclick="sortTable('lead-itc', 'total_matches')">Season Record (W-L-D)</th>
        <th class="${cls('team_win_rate')}" onclick="sortTable('lead-itc', 'team_win_rate')">Win Rate</th>
      </tr>
    `;
  } else {
    thead.innerHTML = `
      <tr>
        <th class="${cls('rank')}" onclick="sortTable('lead-itc', 'rank')">ITC Rank</th>
        <th class="${cls('player_name')}" onclick="sortTable('lead-itc', 'player_name')">Player</th>
        <th class="${cls('itc_points')}" onclick="sortTable('lead-itc', 'itc_points')">ITC Points</th>
        <th class="${cls('events_scored')}" onclick="sortTable('lead-itc', 'events_scored')">Events Scored</th>
        <th class="${cls('current_elo')}" onclick="sortTable('lead-itc', 'current_elo')">OmniTactica Elo</th>
        <th class="col-faction">Factions</th>
        <th class="${cls('matches_played')}" onclick="sortTable('lead-itc', 'matches_played')">Season Record (W-L-D)</th>
        <th class="${cls('win_rate')}" onclick="sortTable('lead-itc', 'win_rate')">Win Rate</th>
      </tr>
    `;
  }
}
window.renderLeaderboardItcHeader = renderLeaderboardItcHeader;

function prefetchNextLeaderboardItcPage(category, nextPage, pageSize, sortState, queryStr) {
  if (leaderboardItcPrefetchTimer) clearTimeout(leaderboardItcPrefetchTimer);
  const gs = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const cacheKey = `lb_itc_${gs}_${category}_${nextPage}_${pageSize}_${sortState.field}_${sortState.asc ? 'ASC' : 'DESC'}_${queryStr || ''}`;
  if (leaderboardItcCache.has(cacheKey)) return;

  leaderboardItcPrefetchTimer = setTimeout(async () => {
    try {
      const res = await window.api.getItcLeaderboard(
        category, nextPage, pageSize,
        sortState.field, sortState.asc ? 'ASC' : 'DESC',
        queryStr || '', 'All', gs
      );
      if (res && res.items) {
        leaderboardItcCache.set(cacheKey, res);
      }
    } catch (e) {
      // Non-critical background prefetch
    }
  }, 450);
}

async function loadLeaderboardItc(isPrefetch = false) {
  const tbody = document.getElementById('lead-itc-body');
  const searchInput = document.getElementById('itc-search-input');
  const queryStr = searchInput ? (searchInput.value || '').trim() : '';
  const gs = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const cat = leaderboardItcCategory || 'players';
  const cacheKey = `lb_itc_${gs}_${cat}_${leaderboardItcPagination.page}_${leaderboardItcPagination.pageSize}_${leaderboardItcSortState.field}_${leaderboardItcSortState.asc ? 'ASC' : 'DESC'}_${queryStr}`;

  renderLeaderboardItcHeader();

  // 1. Stale-While-Revalidate: Instant cache hit rendering
  const cached = leaderboardItcCache.get(cacheKey);
  if (cached && !isPrefetch) {
    leaderboardItcData = cached.items || [];
    leaderboardItcPagination.total = cached.total || 0;
    leaderboardItcPagination.page = cached.page || leaderboardItcPagination.page;
    leaderboardItcPagination.pageSize = cached.page_size || leaderboardItcPagination.pageSize;
    leaderboardItcPagination.totalPages = cached.total_pages || 1;

    renderLeaderboardItcRows();
    renderPaginationBar('lead-itc-pagination', leaderboardItcPagination, 'setLeaderboardItcPage', 'setLeaderboardItcPageSize');
  }

  // 2. Visual indication while fetching
  if (!cached && tbody && leaderboardItcData && leaderboardItcData.length > 0 && !isPrefetch) {
    tbody.style.opacity = '0.45';
    tbody.style.pointerEvents = 'none';
    tbody.style.transition = 'opacity 0.15s ease';
  } else if (!cached && tbody && (!leaderboardItcData || leaderboardItcData.length === 0) && !isPrefetch) {
    tbody.innerHTML = '<tr class="loading-row"><td colspan="8" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading Global ITC Rankings...</div></td></tr>';
  }

  try {
    const res = await window.api.getItcLeaderboard(
      cat,
      leaderboardItcPagination.page,
      leaderboardItcPagination.pageSize,
      leaderboardItcSortState.field,
      leaderboardItcSortState.asc ? 'ASC' : 'DESC',
      queryStr,
      'All',
      gs
    );
    if (res && res.error) {
      throw new Error(res.error);
    }
    if (res && res.items) {
      leaderboardItcCache.set(cacheKey, res);

      if (!isPrefetch) {
        leaderboardItcData = res.items;
        leaderboardItcPagination.total = res.total || 0;
        leaderboardItcPagination.page = res.page || 1;
        leaderboardItcPagination.pageSize = res.page_size || 25;
        leaderboardItcPagination.totalPages = res.total_pages || 1;

        if (tbody) {
          tbody.style.opacity = '1';
          tbody.style.pointerEvents = '';
        }
        renderLeaderboardItcRows();
        renderPaginationBar('lead-itc-pagination', leaderboardItcPagination, 'setLeaderboardItcPage', 'setLeaderboardItcPageSize');
      }
    }

    if (!isPrefetch && leaderboardItcPagination.page < leaderboardItcPagination.totalPages) {
      prefetchNextLeaderboardItcPage(cat, leaderboardItcPagination.page + 1, leaderboardItcPagination.pageSize, leaderboardItcSortState, queryStr);
    }
  } catch (err) {
    console.error('Error loading Global ITC Rankings:', err);
    if (tbody && !cached) {
      tbody.style.opacity = '1';
      tbody.style.pointerEvents = '';
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8" class="empty-state" style="color:var(--loss);"><p>Error loading Global ITC Rankings: ${escapeHtml(err.message)}</p><button class="btn btn-outline" style="margin-top:0.5rem;" onclick="loadLeaderboardItc()">🔄 Retry</button></td></tr>`;
    }
  }
}
window.loadLeaderboardItc = loadLeaderboardItc;

function renderLeaderboardItcRows() {
  const tbody = document.getElementById('lead-itc-body');
  if (!tbody) return;
  tbody.style.opacity = '1';
  tbody.style.pointerEvents = '';
  tbody.innerHTML = '';

  const list = Array.isArray(leaderboardItcData) ? leaderboardItcData : (leaderboardItcData && Array.isArray(leaderboardItcData.items) ? leaderboardItcData.items : []);
  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8" class="empty-state">No Global ITC ${leaderboardItcCategory === 'teams' ? 'teams' : 'players'} found.</td></tr>`;
    return;
  }

  const page = (leaderboardItcPagination && leaderboardItcPagination.page) ? Math.max(1, Number(leaderboardItcPagination.page)) : 1;
  const pageSize = (leaderboardItcPagination && leaderboardItcPagination.pageSize) ? Number(leaderboardItcPagination.pageSize) : 25;
  const offset = (page - 1) * pageSize;

  list.forEach((item, idx) => {
    const tr = document.createElement('tr');
    const rank = item.rank != null ? Number(item.rank) : (offset + idx + 1);
    let rankClass = '';
    if (rank === 1) rankClass = 'rank-top-1';
    else if (rank === 2) rankClass = 'rank-top-2';
    else if (rank === 3) rankClass = 'rank-top-3';

    const pts = Number(item.itc_points || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const eventsScored = Number(item.events_scored || 0);
    const maxEvents = Number(item.max_events || (leaderboardItcCategory === 'teams' ? 10 : 6));

    if (leaderboardItcCategory === 'teams') {
      const teamName = item.team || item.name || 'Unknown Team';
      tr.onclick = (e) => { e.stopPropagation(); openTeamModal(teamName); };

      const hasPower = item.power_rating != null && Number(item.power_rating) > 0;
      const pRating = hasPower ? Number(item.power_rating).toFixed(1) : null;
      const powerCellHtml = hasPower
        ? (typeof renderEloBadgePill === 'function' ? renderEloBadgePill(pRating, 10) : `<span style="font-family:var(--font-mono); font-weight:800; color:#a855f7;">${pRating}</span>`)
        : `<span class="badge" style="background:rgba(148,163,184,0.1); color:var(--text-muted); border:1px solid rgba(148,163,184,0.2); font-size:0.7rem;">Unrated</span>`;

      const safeTopName = String(item.top_player_name || '').replace(/'/g, "\\'");
      const topPlayerHtml = item.top_player_name
        ? `<div style="display: inline-flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
             <span class="player-link" style="font-size:0.85rem;" onclick="event.stopPropagation(); openPlayerModal('${item.top_player_id || ''}', '${escapeHtml(safeTopName)}')">
               ${escapeHtml(item.top_player_name)}
             </span>
             ${item.top_player_elo ? (typeof renderEloBadgePill === 'function' ? renderEloBadgePill(Number(item.top_player_elo).toFixed(1), 10) : `<span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted);">(${Number(item.top_player_elo).toFixed(1)})</span>`) : ''}
           </div>`
        : `<span style="color:var(--text-muted); font-size:0.8rem;">—</span>`;

      const wr = Number(item.team_win_rate != null ? item.team_win_rate : (item.win_rate || 0)).toFixed(1);

      tr.innerHTML = `
        <td class="rank-cell ${rankClass}">#${rank}</td>
        <td>
          <div style="font-weight:600; color:#fff; display:flex; align-items:center; gap:0.4rem;">
            <span>🛡️</span>
            <span class="player-link">${escapeHtml(teamName)}</span>
          </div>
        </td>
        <td>
          <span class="badge" style="background: rgba(245, 158, 11, 0.14); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-family: var(--font-mono); font-weight: 700; font-size: 0.86rem; padding: 0.25rem 0.6rem;">
            🏆 ${pts}
          </span>
        </td>
        <td>
          <span class="roster-badge" title="${eventsScored} of ${maxEvents} maximum counting events scored">
            <span class="roster-badge-num">${eventsScored}</span> <span class="roster-badge-label">/ ${maxEvents} Events</span>
          </span>
        </td>
        <td>${powerCellHtml}</td>
        <td>${topPlayerHtml}</td>
        <td style="font-family:var(--font-mono); font-size:0.85rem;">
          <span style="color:var(--win); font-weight:600;">${item.total_wins || 0}W</span> - 
          <span style="color:var(--loss); font-weight:600;">${item.total_losses || 0}L</span>
          ${item.total_draws ? ` - <span style="color:var(--draw); font-weight:600;">${item.total_draws}D</span>` : ''}
        </td>
        <td style="font-family:var(--font-mono); font-weight:600;">
          <span style="color: ${wr >= 55 ? 'var(--win)' : (wr >= 45 ? 'var(--accent)' : 'var(--text-secondary)')};">
            ${wr}%
          </span>
        </td>
      `;
    } else {
      const playerName = item.player_name || 'Unknown Player';
      tr.onclick = (e) => {
        e.stopPropagation();
        openPlayerModal(item.player_id, playerName);
      };

      const hasElo = item.current_elo != null && Number(item.current_elo) > 0;
      const eloCellHtml = hasElo
        ? (typeof renderEloBadgePill === 'function' ? renderEloBadgePill(item.current_elo, item.matches_played || 10) : `<span class="elo-badge">${Number(item.current_elo).toFixed(1)}</span>`)
        : `<span class="badge" style="background:rgba(148,163,184,0.1); color:var(--text-muted); border:1px solid rgba(148,163,184,0.2); font-size:0.7rem;">Unrated</span>`;

      const teamHtml = item.team
        ? `<span class="badge" style="background:rgba(168,85,247,0.12); color:#c084fc; border:1px solid rgba(168,85,247,0.25); font-size:0.68rem; margin-top:0.2rem; cursor:pointer;" onclick="event.stopPropagation(); openTeamModal('${escapeHtml(item.team)}')" title="View ${escapeHtml(item.team)} Roster">🛡️ ${escapeHtml(item.team)}</span>`
        : '';

      const wr = Number(item.win_rate || 0).toFixed(1);
      const factionCellHtml = (() => {
        const rawFacs = (item.top_faction || '').split(',').map(f => f.trim()).filter(Boolean);
        if (!rawFacs.length) return `<span style="color:var(--text-muted); font-size:0.8rem;">—</span>`;
        const showCount = 2;
        const visible = rawFacs.slice(0, showCount);
        const remaining = rawFacs.length - visible.length;
        return visible.map(f => `<span class="faction-pill" title="${escapeHtml(f)}" style="margin:2px 3px 2px 0; display:inline-block;">${escapeHtml(f)}</span>`).join('') +
          (remaining > 0 ? `<span class="faction-pill" title="${escapeHtml(rawFacs.slice(showCount).join(', '))}" style="margin:2px 3px 2px 0; display:inline-block; opacity:0.85; font-size:0.72rem; cursor:help;">+${remaining}</span>` : '');
      })();

      tr.innerHTML = `
        <td class="rank-cell ${rankClass}">#${rank}</td>
        <td>
          <div class="player-name-cell">
            <div style="display: inline-flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
              <span class="player-link">${escapeHtml(playerName)}</span>
            </div>
            ${teamHtml}
          </div>
        </td>
        <td>
          <span class="badge" style="background: rgba(245, 158, 11, 0.14); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-family: var(--font-mono); font-weight: 700; font-size: 0.86rem; padding: 0.25rem 0.6rem;">
            🏆 ${pts}
          </span>
        </td>
        <td>
          <span class="roster-badge" title="${eventsScored} of ${maxEvents} maximum counting events scored">
            <span class="roster-badge-num">${eventsScored}</span> <span class="roster-badge-label">/ ${maxEvents} Events</span>
          </span>
        </td>
        <td>${eloCellHtml}</td>
        <td class="col-faction">${factionCellHtml}</td>
        <td style="font-family:var(--font-mono); font-size:0.85rem;">
          <span style="color:var(--win); font-weight:600;">${item.wins || 0}W</span> - 
          <span style="color:var(--loss); font-weight:600;">${item.losses || 0}L</span>
          ${item.draws ? ` - <span style="color:var(--draw); font-weight:600;">${item.draws}D</span>` : ''}
        </td>
        <td style="font-family:var(--font-mono); font-weight:600;">
          <span style="color: ${wr >= 60 ? 'var(--win)' : (wr >= 45 ? 'var(--accent)' : 'var(--text-secondary)')};">
            ${wr}%
          </span>
        </td>
      `;
    }

    tbody.appendChild(tr);
  });
}
window.renderLeaderboardItcRows = renderLeaderboardItcRows;

