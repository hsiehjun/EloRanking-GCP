/* ==========================================================================
   PLAYERS.JS - Dedicated Searchable Players Directory (Paginated)
   ========================================================================== */

let playersDirectoryData = [];
let playersPagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 };
let playersSortState = { field: 'current_elo', asc: false };
let playersSearchTimeout = null;

function debouncePlayersSearch() {
  clearTimeout(playersSearchTimeout);
  playersSearchTimeout = setTimeout(() => {
    playersPagination.page = 1;
    loadPlayersDirectory();
  }, 250);
}

function setPlayersPage(newPage) {
  playersPagination.page = newPage;
  loadPlayersDirectory();
}

function setPlayersPageSize(newSize) {
  playersPagination.pageSize = newSize;
  playersPagination.page = 1;
  loadPlayersDirectory();
}

async function loadPlayersDirectory() {
  const queryInput = document.getElementById('directory-search-input');
  const query = queryInput ? queryInput.value.trim() : '';
  const factionSelect = document.getElementById('dir-faction-filter');
  const faction = factionSelect ? factionSelect.value : 'All';
  const minMatchesSelect = document.getElementById('dir-min-matches-filter');
  const minMatches = minMatchesSelect ? parseInt(minMatchesSelect.value, 10) : 0;
  const tbody = document.getElementById('players-dir-body');

  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading player directory...</div></td></tr>';
  }

  try {
    const res = await window.api.getPlayersDirectory(
      query, faction, playersSortState.field, playersSortState.asc ? 'ASC' : 'DESC',
      playersPagination.page, playersPagination.pageSize
    );
    if (res && res.items) {
      playersDirectoryData = res.items;
      playersPagination.total = res.total || 0;
      playersPagination.page = res.page || 1;
      playersPagination.pageSize = res.page_size || 25;
      playersPagination.totalPages = res.total_pages || 1;
    } else {
      playersDirectoryData = Array.isArray(res) ? res : [];
      playersPagination.total = playersDirectoryData.length;
    }
    renderPlayersDirectoryRows();
    renderPaginationBar('players-pagination', playersPagination, 'setPlayersPage', 'setPlayersPageSize');
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color:var(--loss);">Error loading player directory: ${err.message}</td></tr>`;
  }
}

function renderPlayersDirectoryRows() {
  const tbody = document.getElementById('players-dir-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!playersDirectoryData || playersDirectoryData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No players found matching search criteria.</td></tr>';
    return;
  }

  playersDirectoryData.forEach(p => {
    const tr = document.createElement('tr');
    tr.onclick = () => openPlayerModal(p.player_id);

    const eloBadgeClass = getEloBadgeClass(p.current_elo);
    const winRate = p.win_rate !== undefined ? p.win_rate : (p.matches_played > 0 ? ((p.wins / p.matches_played) * 100).toFixed(1) : 0);
    const teamHtml = p.team ? `<span class="badge" style="background:rgba(168,85,247,0.12); color:#c084fc; border:1px solid rgba(168,85,247,0.25); font-size:0.68rem; margin-top:0.2rem; cursor:pointer;" onclick="event.stopPropagation(); openTeamModal('${escapeHtml(p.team)}')">🛡️ ${escapeHtml(p.team)}</span>` : '';
    const isSelf = (typeof currentUser !== 'undefined' && currentUser && (currentUser.player_id === p.player_id || currentUser.id === p.account_user_id));
    const chatPill = (p.has_account && !isSelf) ? `
      <button type="button" class="btn-chat-pill" title="Send Chat Request" onclick="event.stopPropagation(); handlePlayerChatClick('${escapeHtml(p.player_id)}', '${escapeHtml(p.player_name || p.full_name || '')}', '${p.account_user_id || ''}')">
        💬 Chat
      </button>
    ` : '';

    tr.innerHTML = `
      <td>
        <div class="player-name-cell">
          <div style="display: inline-flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
            <span class="player-link">${escapeHtml(p.player_name || p.full_name || 'Unknown')}</span>
            ${chatPill}
          </div>
          ${teamHtml}
        </div>
      </td>
      <td class="col-faction">
        ${(p.top_faction || 'Various').split(',').map(f => `<span class="faction-pill" title="${escapeHtml(f.trim())}" style="margin:2px 3px 2px 0; display:inline-block;">${escapeHtml(f.trim())}</span>`).join('')}
      </td>
      <td class="elo-badge ${eloBadgeClass}">
        ${Number(p.current_elo || 1500).toFixed(1)}
      </td>
      <td class="col-peak" style="font-family:var(--font-mono); color:var(--text-secondary);">
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
      <td class="col-games" style="font-family:var(--font-mono); color:var(--text-secondary);">
        ${p.matches_played || 0}
      </td>
      <td class="col-last-active" style="font-size:0.8rem; color:var(--text-muted); font-family:var(--font-mono);">
        ${(p.last_active_date || '').slice(0, 10) || '-'}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

if (typeof window.handlePlayerChatClick === 'undefined') {
  window.handlePlayerChatClick = function(playerId, playerName, accountUserId) {
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
  };
}
