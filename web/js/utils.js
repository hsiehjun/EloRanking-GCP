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

/* ==========================================================================
   GLOBAL CITY COORDINATES & SMART LOCATION RESOLVER
   ========================================================================== */
const GLOBAL_CITY_COORDS = {
  'san diego': { name: 'San Diego, CA', lat: 32.7157, lng: -117.1611 },
  'los angeles': { name: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437 },
  'orange county': { name: 'Orange County, CA', lat: 33.7175, lng: -117.8311 },
  'temecula': { name: 'Temecula, CA', lat: 33.4936, lng: -117.1484 },
  'murrieta': { name: 'Murrieta, CA', lat: 33.5539, lng: -117.2139 },
  'menifee': { name: 'Menifee, CA', lat: 33.6803, lng: -117.1859 },
  'fallbrook': { name: 'Fallbrook, CA', lat: 33.3764, lng: -117.2511 },
  'oceanside': { name: 'Oceanside, CA', lat: 33.1959, lng: -117.3795 },
  'carlsbad': { name: 'Carlsbad, CA', lat: 33.1581, lng: -117.3506 },
  'vista': { name: 'Vista, CA', lat: 33.2000, lng: -117.2425 },
  'san marcos': { name: 'San Marcos, CA', lat: 33.1434, lng: -117.1661 },
  'escondido': { name: 'Escondido, CA', lat: 33.1192, lng: -117.0864 },
  'encinitas': { name: 'Encinitas, CA', lat: 33.0370, lng: -117.2920 },
  'poway': { name: 'Poway, CA', lat: 32.9628, lng: -117.0359 },
  'lake elsinore': { name: 'Lake Elsinore, CA', lat: 33.6681, lng: -117.3273 },
  'corona': { name: 'Corona, CA', lat: 33.8753, lng: -117.5664 },
  'hemet': { name: 'Hemet, CA', lat: 33.7475, lng: -116.9720 },
  'palm springs': { name: 'Palm Springs, CA', lat: 33.8303, lng: -116.5453 },
  'chula vista': { name: 'Chula Vista, CA', lat: 32.6401, lng: -117.0842 },
  'el cajon': { name: 'El Cajon, CA', lat: 32.7948, lng: -116.9625 },
  'pasadena': { name: 'Pasadena, CA', lat: 34.1478, lng: -118.1445 },
  'burbank': { name: 'Burbank, CA', lat: 34.1808, lng: -118.3090 },
  'anaheim': { name: 'Anaheim, CA', lat: 33.8366, lng: -117.9143 },
  'long beach': { name: 'Long Beach, CA', lat: 33.7701, lng: -118.1937 },
  'irvine': { name: 'Irvine, CA', lat: 33.6846, lng: -117.8265 },
  'riverside': { name: 'Riverside, CA', lat: 33.9806, lng: -117.3755 },
  'san francisco': { name: 'San Francisco, CA', lat: 37.7749, lng: -122.4194 },
  'san jose': { name: 'San Jose, CA', lat: 37.3382, lng: -121.8863 },
  'sacramento': { name: 'Sacramento, CA', lat: 38.5816, lng: -121.4944 },
  'seattle': { name: 'Seattle, WA', lat: 47.6062, lng: -122.3321 },
  'bellevue': { name: 'Bellevue, WA', lat: 47.6101, lng: -122.2015 },
  'portland': { name: 'Portland, OR', lat: 45.5152, lng: -122.6784 },
  'phoenix': { name: 'Phoenix, AZ', lat: 33.4484, lng: -112.0740 },
  'las vegas': { name: 'Las Vegas, NV', lat: 36.1699, lng: -115.1398 },
  'denver': { name: 'Denver, CO', lat: 39.7392, lng: -104.9903 },
  'austin': { name: 'Austin, TX', lat: 30.2672, lng: -97.7431 },
  'dallas': { name: 'Dallas, TX', lat: 32.7767, lng: -96.7970 },
  'houston': { name: 'Houston, TX', lat: 29.7604, lng: -95.3698 },
  'san antonio': { name: 'San Antonio, TX', lat: 29.4241, lng: -98.4936 },
  'chicago': { name: 'Chicago, IL', lat: 41.8781, lng: -87.6298 },
  'minneapolis': { name: 'Minneapolis, MN', lat: 44.9778, lng: -93.2650 },
  'new york': { name: 'New York, NY', lat: 40.7128, lng: -74.0060 },
  'philadelphia': { name: 'Philadelphia, PA', lat: 39.9526, lng: -75.1652 },
  'boston': { name: 'Boston, MA', lat: 42.3601, lng: -71.0589 },
  'atlanta': { name: 'Atlanta, GA', lat: 33.7490, lng: -84.3880 },
  'orlando': { name: 'Orlando, FL', lat: 28.5383, lng: -81.3792 },
  'miami': { name: 'Miami, FL', lat: 25.7617, lng: -80.1918 },
  'charlotte': { name: 'Charlotte, NC', lat: 35.2271, lng: -80.8431 },
  'columbus': { name: 'Columbus, OH', lat: 39.9612, lng: -82.9988 },
  'toronto': { name: 'Toronto, Canada', lat: 43.6532, lng: -79.3832 },
  'vancouver': { name: 'Vancouver, Canada', lat: 49.2827, lng: -123.1207 },
  'london': { name: 'London, UK', lat: 51.5074, lng: -0.1278 },
  'manchester': { name: 'Manchester, UK', lat: 53.4808, lng: -2.2426 },
  'paris': { name: 'Paris, France', lat: 48.8566, lng: 2.3522 },
  'sydney': { name: 'Sydney, Australia', lat: -33.8688, lng: 151.2093 },
  'melbourne': { name: 'Melbourne, Australia', lat: -37.8136, lng: 144.9631 }
};

function lookupCityCoordinates(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const q = raw.trim().toLowerCase();
  if (!q) return null;

  const dict = (typeof window !== 'undefined' && window.GLOBAL_CITY_COORDS) ? window.GLOBAL_CITY_COORDS : GLOBAL_CITY_COORDS;
  
  if (dict[q]) return dict[q];

  const firstToken = q.split(',')[0].trim();
  if (dict[firstToken]) return dict[firstToken];

  for (const [key, val] of Object.entries(dict)) {
    if (q.includes(key) || key.includes(q) || (val.name && val.name.toLowerCase().includes(q))) {
      return val;
    }
  }

  // Common aliases
  const aliases = {
    'socal': dict['san diego'],
    'norcal': dict['san francisco'],
    'bay area': dict['san francisco'],
    'pnw': dict['seattle'],
    'texas': dict['austin'],
    'midwest': dict['chicago'],
    'northeast': dict['new york'],
    'nyc': dict['new york'],
    'southeast': dict['atlanta'],
    'uk': dict['london']
  };
  if (aliases[q]) return aliases[q];
  if (aliases[firstToken]) return aliases[firstToken];

  return null;
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

if (typeof window !== 'undefined') {
  window.GLOBAL_CITY_COORDS = GLOBAL_CITY_COORDS;
  window.lookupCityCoordinates = lookupCityCoordinates;
  window.escapeHtml = escapeHtml;
  window.formatNumber = formatNumber;
  window.getEloBadgeClass = getEloBadgeClass;
  window.sortClientArray = sortClientArray;
  window.handlePlayerChatClick = handlePlayerChatClick;
}
