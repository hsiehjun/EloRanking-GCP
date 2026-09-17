/* ==========================================================================
   TEAMS.JS - Dedicated Searchable Teams Directory (Paginated)
   ========================================================================== */

let teamsDirectoryData = [];
let teamsPagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 };
let teamsSortState = { field: 'power_rating', asc: false };
let teamsSearchTimeout = null;

function debounceTeamsSearch() {
  clearTimeout(teamsSearchTimeout);
  teamsSearchTimeout = setTimeout(() => {
    teamsPagination.page = 1;
    loadTeamsDirectory();
  }, 250);
}

function setTeamsPage(newPage) {
  teamsPagination.page = newPage;
  loadTeamsDirectory();
}

function setTeamsPageSize(newSize) {
  teamsPagination.pageSize = newSize;
  teamsPagination.page = 1;
  loadTeamsDirectory();
}

async function loadTeamsDirectory() {
  const queryInput = document.getElementById('teams-search-input');
  const query = queryInput ? queryInput.value.trim() : '';
  const minRosterSelect = document.getElementById('teams-min-roster-filter');
  const minRoster = minRosterSelect ? minRosterSelect.value : 1;
  const tbody = document.getElementById('teams-body');

  if (tbody && (!teamsDirectoryData || teamsDirectoryData.length === 0)) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading teams directory...</div></td></tr>';
  }

  try {
    const res = await window.api.getTeamsDirectory(
      query, minRoster, teamsSortState.field, teamsSortState.asc ? 'ASC' : 'DESC',
      teamsPagination.page, teamsPagination.pageSize
    );
    if (res && res.items) {
      teamsDirectoryData = res.items;
      teamsPagination.total = res.total || 0;
      teamsPagination.page = res.page || 1;
      teamsPagination.pageSize = res.page_size || 25;
      teamsPagination.totalPages = res.total_pages || 1;
    } else {
      teamsDirectoryData = Array.isArray(res) ? res : [];
      teamsPagination.total = teamsDirectoryData.length;
    }
    renderTeamsDirectoryRows();
    renderPaginationBar('teams-pagination', teamsPagination, 'setTeamsPage', 'setTeamsPageSize');
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error loading teams directory: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderTeamsDirectoryRows() {
  const tbody = document.getElementById('teams-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!teamsDirectoryData || teamsDirectoryData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No teams found matching search criteria.</td></tr>';
    return;
  }

  const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const list = Array.isArray(teamsDirectoryData) ? teamsDirectoryData : (teamsDirectoryData && Array.isArray(teamsDirectoryData.items) ? teamsDirectoryData.items : []);
  list.forEach((t, idx) => {
    const tr = document.createElement('tr');
    tr.onclick = () => openTeamModal(t.team);
    const safeTopName = String(t.top_player_name || '').replace(/'/g, "\\'");
    const activeAvg = Number(t.active_avg_elo != null ? t.active_avg_elo : (t.avg_elo || 1500));
    const avgBadge = typeof renderEloBadgePill === 'function'
      ? renderEloBadgePill(activeAvg, null, { showTierName: true, size: 'sm', gameSystem: sys })
      : `<span style="font-family:var(--font-mono); font-weight:600; color:var(--accent);">${activeAvg.toFixed(1)}</span>`;
    const topBadge = typeof renderEloBadgePill === 'function'
      ? renderEloBadgePill(t.top_player_elo || 1500, null, { showTierName: false, size: 'sm', gameSystem: sys })
      : `<span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted); margin-left:0.3rem;">(${Number(t.top_player_elo).toFixed(1)})</span>`;

    tr.innerHTML = `
      <td>
        <div style="font-weight:600; color:#fff; display:flex; align-items:center; gap:0.4rem;">
          <span>🛡️</span>
          <span class="player-link">${escapeHtml(t.team)}</span>
        </div>
      </td>
      <td>
        ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(t.power_rating, 10) : `<span style="font-family:var(--font-mono); font-weight:800; font-size:1.05rem; color:#a855f7;">${Number(t.power_rating).toFixed(1)}</span>`}
      </td>
      <td title="${activeAvg.toFixed(1)} Active Club Avg (${Number(t.avg_elo || t.active_avg_elo || 1500).toFixed(1)} All-Time Registered Avg)">
        ${avgBadge}
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
          <span class="player-link" style="font-size:0.85rem; font-weight:600;" onclick="event.stopPropagation(); openPlayerModal('${t.top_player_id || ''}', '${escapeHtml(safeTopName)}')">
            ${escapeHtml(t.top_player_name || 'Top Player')}
          </span>
          ${topBadge}
        </div>
      </td>
      <td>
        <span class="roster-badge" title="${escapeHtml((t.roster_count || 1) + ' Total Registered Competitors (' + (t.active_roster_count != null ? t.active_roster_count : (t.roster_count || 1)) + ' Active in last 180 days)')}">
          <span class="roster-badge-num">${t.active_roster_count != null ? t.active_roster_count : (t.roster_count || 1)}</span> <span class="roster-badge-label">Active</span>
        </span>
      </td>
      <td style="font-family:var(--font-mono); font-size:0.85rem;">
        <span style="color:var(--win); font-weight:600;">${t.total_wins}W</span> - 
        <span style="color:var(--loss); font-weight:600;">${t.total_losses}L</span>
        ${t.total_draws ? ` - <span style="color:var(--draw); font-weight:600;">${t.total_draws}D</span>` : ''}
      </td>
      <td style="font-family:var(--font-mono); font-weight:600;">
        <span style="color: ${t.team_win_rate >= 55 ? 'var(--win)' : (t.team_win_rate >= 45 ? 'var(--accent)' : 'var(--text-secondary)')};">
          ${t.team_win_rate}%
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
