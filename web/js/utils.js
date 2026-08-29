/* ==========================================================================
   UTILS.JS - Helper Utilities, Formatters, Escaping & Global Sort Engine
   ========================================================================== */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  return Number(num).toLocaleString();
}

function getEloBadgeClass(elo) {
  const val = Number(elo) || 1500;
  if (val >= 1800) return 'elo-grandmaster'; // Mythic Gold
  if (val >= 1700) return 'elo-master';      // Epic Purple
  if (val >= 1600) return 'elo-diamond';     // Diamond Blue
  if (val >= 1500) return 'elo-platinum';    // Emerald Green
  return 'elo-silver';                       // Slate Silver
}

function sortClientArray(arr, field, asc = true) {
  return [...arr].sort((a, b) => {
    let vA = a[field];
    let vB = b[field];
    if (vA === null || vA === undefined) return asc ? 1 : -1;
    if (vB === null || vB === undefined) return asc ? -1 : 1;

    const numA = Number(vA);
    const numB = Number(vB);
    if (!isNaN(numA) && !isNaN(numB) && typeof vA !== 'boolean' && typeof vB !== 'boolean' && String(vA).trim() !== '' && String(vB).trim() !== '') {
      return asc ? (numA - numB) : (numB - numA);
    }

    if (typeof vA === 'string' && typeof vB === 'string') {
      return asc ? vA.localeCompare(vB) : vB.localeCompare(vA);
    }
    return asc ? (vA > vB ? 1 : -1) : (vA < vB ? 1 : -1);
  });
}

// Global sort states
const currentSort = {
  'events': { field: 'event_date', asc: false },
  'teams': { field: 'power_rating', asc: false },
  'players-dir': { field: 'current_elo', asc: false },
  'factions': { field: 'win_rate', asc: false },
  'player-matches': { field: 'match_date', asc: false },
  'event-results': { field: 'event_wins', asc: false },
  'event-elo': { field: 'current_elo', asc: false },
  'event-pairings': { field: 'round', asc: true },
  'h2h': { field: 'match_date', asc: false },
  'team-roster': { field: 'current_elo', asc: false }
};

function sortTable(tableKey, field) {
  if (!currentSort[tableKey]) {
    currentSort[tableKey] = { field: field, asc: false };
  }
  const config = currentSort[tableKey];
  if (config.field === field) {
    config.asc = !config.asc;
  } else {
    config.field = field;
    config.asc = (field === 'name' || field === 'player_name' || field === 'full_name' || field === 'team' || field === 'faction' || field === 'round') ? true : false;
  }

  updateHeaderIcons(tableKey, field, config.asc);

  if (tableKey === 'events') {
    if (typeof eventsSortState !== 'undefined') eventsSortState = config;
    loadEvents();
  } else if (tableKey === 'teams') {
    if (typeof teamsSortState !== 'undefined') teamsSortState = config;
    loadTeamsDirectory();
  } else if (tableKey === 'players-dir') {
    if (typeof playersSortState !== 'undefined') playersSortState = config;
    loadPlayersDirectory();
  } else if (tableKey === 'factions') {
    if (typeof factionMetaData !== 'undefined' && factionMetaData && factionMetaData.factions) {
      factionMetaData.factions = sortClientArray(factionMetaData.factions, config.field, config.asc);
      renderFactionMeta();
    }
  } else if (tableKey === 'player-matches') {
    if (typeof currentPlayerMatches !== 'undefined' && currentPlayerMatches) {
      const sorted = sortClientArray(currentPlayerMatches, config.field, config.asc);
      renderPlayerMatches(sorted);
    }
  } else if (tableKey === 'event-results') {
    if (typeof eventPlayersCache !== 'undefined' && eventPlayersCache) {
      eventPlayersCache = sortClientArray(eventPlayersCache, config.field, config.asc);
      renderEventResultsRows();
    }
  } else if (tableKey === 'event-elo') {
    if (typeof eventPlayersCache !== 'undefined' && eventPlayersCache) {
      renderEventEloRows();
    }
  } else if (tableKey === 'team-roster') {
    if (typeof currentTeamRoster !== 'undefined' && currentTeamRoster) {
      currentTeamRoster = sortClientArray(currentTeamRoster, config.field, config.asc);
      renderTeamRosterRows(currentTeamRoster);
    }
  } else if (tableKey === 'event-pairings') {
    if (typeof eventMatchesCache !== 'undefined' && eventMatchesCache) {
      eventMatchesCache = sortClientArray(eventMatchesCache, config.field, config.asc);
      renderEventPairingsRows();
    }
  }
}

function updateHeaderIcons(tableKey, field, asc) {
  const tableMap = {
    'team-roster': 'team-roster-table',
    'events': 'events-table',
    'teams': 'teams-table',
    'players-dir': 'players-table',
    'factions': 'faction-meta-table',
    'player-matches': 'player-matches-table',
    'event-results': 'event-results-table',
    'event-elo': 'event-elo-table',
    'event-pairings': 'event-pairings-table',
  };
  const tableId = tableMap[tableKey];
  if (!tableId) return;
  const tbl = document.getElementById(tableId);
  if (!tbl) return;

  tbl.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    const onclick = th.getAttribute('onclick') || '';
    if (onclick.includes(`'${field}'`) || onclick.includes(`"${field}"`)) {
      th.classList.add(asc ? 'sorted-asc' : 'sorted-desc');
    }
  });
}


function renderPaginationBar(containerId, pagination, onPageChange, onPageSizeChange) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const total = pagination.total || 0;
  const page = pagination.page || 1;
  const pageSize = pagination.pageSize || 25;
  const totalPages = pagination.totalPages || Math.max(1, Math.ceil(total / pageSize));

  if (total === 0) {
    container.innerHTML = '';
    return;
  }

  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(total, page * pageSize);

  // Generate page numbers window (max 5 visible buttons)
  let pages = [];
  const maxButtons = 5;
  let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }
  for (let p = startPage; p <= endPage; p++) {
    pages.push(p);
  }

  let html = `
    <div class="pagination-info">
      Showing <b>${startItem.toLocaleString()}</b>–<b>${endItem.toLocaleString()}</b> of <b>${total.toLocaleString()}</b>
      <div class="page-size-selector" style="margin-left: 0.5rem;">
        <span>Rows:</span>
        <select class="page-size-select" onchange="${onPageSizeChange}(Number(this.value))">
          <option value="25" ${pageSize === 25 ? 'selected' : ''}>25</option>
          <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
          <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
        </select>
      </div>
    </div>
    <div class="pagination-controls">
      <button class="pagination-btn" ${page <= 1 ? 'disabled' : ''} onclick="${onPageChange}(1)" title="First Page">«</button>
      <button class="pagination-btn" ${page <= 1 ? 'disabled' : ''} onclick="${onPageChange}(${page - 1})" title="Previous Page">‹ Prev</button>
  `;

  if (startPage > 1) {
    html += `<button class="pagination-btn" onclick="${onPageChange}(1)">1</button>`;
    if (startPage > 2) html += `<span style="color:var(--text-muted); padding:0 0.2rem;">…</span>`;
  }

  pages.forEach(p => {
    html += `<button class="pagination-btn ${p === page ? 'active' : ''}" onclick="${onPageChange}(${p})">${p}</button>`;
  });

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span style="color:var(--text-muted); padding:0 0.2rem;">…</span>`;
    html += `<button class="pagination-btn" onclick="${onPageChange}(${totalPages})">${totalPages}</button>`;
  }

  html += `
      <button class="pagination-btn" ${page >= totalPages ? 'disabled' : ''} onclick="${onPageChange}(${page + 1})" title="Next Page">Next ›</button>
      <button class="pagination-btn" ${page >= totalPages ? 'disabled' : ''} onclick="${onPageChange}(${totalPages})" title="Last Page">»</button>
    </div>
  `;

  container.innerHTML = html;
}
