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

function getEloTier(elo, matchesCount = null, gameSystem = '') {
  const val = Number(elo) || 1500;
  const sys = (gameSystem || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).toLowerCase();
  
  // Uncalibrated / Aspirant for < 5 tournament matches
  const hasMatchesCount = (matchesCount !== null && matchesCount !== undefined && !isNaN(Number(matchesCount)));
  const matchesNum = hasMatchesCount ? Number(matchesCount) : null;
  const isUncalibrated = (matchesNum !== null && matchesNum < 5);

  if (isUncalibrated) {
    const needed = Math.max(0, 5 - matchesNum);
    return {
      tierKey: 'aspirant',
      name: 'Aspirant',
      shortName: 'Aspirant',
      icon: '❔',
      badgeClass: 'elo-aspirant',
      accentColor: '#94a3b8',
      minElo: 0,
      maxElo: 1500,
      isUncalibrated: true,
      matchesPlayed: matchesNum,
      matchesNeeded: needed,
      progressPercent: Math.min(100, Math.round((matchesNum / 5) * 100)),
      themeClass: 'profile-theme-aspirant'
    };
  }

  // Apex Tiers (2400+)
  if (val >= 2400) {
    return {
      tierKey: 'everchosen',
      name: 'Everchosen',
      shortName: 'Everchosen',
      icon: '👑',
      badgeClass: 'elo-everchosen',
      accentColor: '#fbbf24',
      minElo: 2400,
      maxElo: 3000,
      isApex: true,
      nextTier: null,
      progressPercent: 100,
      themeClass: 'profile-theme-everchosen'
    };
  }

  // 2350 - 2399
  if (val >= 2350) {
    const progress = (val - 2350) / 50;
    return {
      tierKey: 'godbeast-2',
      name: 'Celestial God-Beast II',
      shortName: 'God-Beast II',
      icon: '🌠',
      badgeClass: 'elo-godbeast-2',
      accentColor: '#ec4899',
      minElo: 2350,
      maxElo: 2400,
      nextTier: { name: 'Everchosen', targetElo: 2400, ptsNeeded: (2400 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-godbeast'
    };
  }

  // 2300 - 2349
  if (val >= 2300) {
    const progress = (val - 2300) / 50;
    return {
      tierKey: 'godbeast-1',
      name: 'Celestial God-Beast I',
      shortName: 'God-Beast I',
      icon: '☀️',
      badgeClass: 'elo-godbeast-1',
      accentColor: '#f59e0b',
      minElo: 2300,
      maxElo: 2350,
      nextTier: { name: 'Celestial God-Beast II', targetElo: 2350, ptsNeeded: (2350 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-godbeast'
    };
  }

  // 2250 - 2299
  if (val >= 2250) {
    const progress = (val - 2250) / 50;
    return {
      tierKey: 'primarch-2',
      name: 'Apex Primarch II',
      shortName: 'Primarch II',
      icon: '🌌',
      badgeClass: 'elo-primarch-2',
      accentColor: '#818cf8',
      minElo: 2250,
      maxElo: 2300,
      nextTier: { name: 'Celestial God-Beast I', targetElo: 2300, ptsNeeded: (2300 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-primarch'
    };
  }

  // 2200 - 2249
  if (val >= 2200) {
    const progress = (val - 2200) / 50;
    return {
      tierKey: 'primarch-1',
      name: 'Apex Primarch I',
      shortName: 'Primarch I',
      icon: '🌌',
      badgeClass: 'elo-primarch-1',
      accentColor: '#38bdf8',
      minElo: 2200,
      maxElo: 2250,
      nextTier: { name: 'Apex Primarch II', targetElo: 2250, ptsNeeded: (2250 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-primarch'
    };
  }

  // 2150 - 2199
  if (val >= 2150) {
    const progress = (val - 2150) / 50;
    return {
      tierKey: 'ascendant-2',
      name: 'Ascendant II',
      shortName: 'Ascendant II',
      icon: '🔱',
      badgeClass: 'elo-ascendant-2',
      accentColor: '#c026d3',
      minElo: 2150,
      maxElo: 2200,
      nextTier: { name: 'Apex Primarch I', targetElo: 2200, ptsNeeded: (2200 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-ascendant'
    };
  }

  // 2100 - 2149
  if (val >= 2100) {
    const progress = (val - 2100) / 50;
    return {
      tierKey: 'ascendant-1',
      name: 'Ascendant I',
      shortName: 'Ascendant I',
      icon: '🔱',
      badgeClass: 'elo-ascendant-1',
      accentColor: '#d946ef',
      minElo: 2100,
      maxElo: 2150,
      nextTier: { name: 'Ascendant II', targetElo: 2150, ptsNeeded: (2150 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-ascendant'
    };
  }

  // 2050 - 2099
  if (val >= 2050) {
    const progress = (val - 2050) / 50;
    return {
      tierKey: 'warmaster-2',
      name: 'Warmaster II',
      shortName: 'Warmaster II',
      icon: '⚡',
      badgeClass: 'elo-warmaster-2',
      accentColor: '#e11d48',
      minElo: 2050,
      maxElo: 2100,
      nextTier: { name: 'Ascendant I', targetElo: 2100, ptsNeeded: (2100 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-warmaster'
    };
  }

  // 2000 - 2049
  if (val >= 2000) {
    const progress = (val - 2000) / 50;
    return {
      tierKey: 'warmaster-1',
      name: 'Warmaster I',
      shortName: 'Warmaster I',
      icon: '⚡',
      badgeClass: 'elo-warmaster-1',
      accentColor: '#f43f5e',
      minElo: 2000,
      maxElo: 2050,
      nextTier: { name: 'Warmaster II', targetElo: 2050, ptsNeeded: (2050 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-warmaster'
    };
  }

  // 1900 - 1999
  if (val >= 1900) {
    const progress = (val - 1900) / 100;
    return {
      tierKey: 'high-warlord',
      name: 'High Warlord',
      shortName: 'High Warlord',
      icon: '🔥',
      badgeClass: 'elo-high-warlord',
      accentColor: '#fb923c',
      minElo: 1900,
      maxElo: 2000,
      nextTier: { name: 'Warmaster I', targetElo: 2000, ptsNeeded: (2000 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-high-warlord'
    };
  }

  // 1800 - 1899
  if (val >= 1800) {
    const progress = (val - 1800) / 100;
    return {
      tierKey: 'grand-marshal',
      name: 'Grand Marshal',
      shortName: 'Grand Marshal',
      icon: '🔮',
      badgeClass: 'elo-grand-marshal',
      accentColor: '#c084fc',
      minElo: 1800,
      maxElo: 1900,
      nextTier: { name: 'High Warlord', targetElo: 1900, ptsNeeded: (1900 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-grand-marshal'
    };
  }

  // 1700 - 1799
  if (val >= 1700) {
    const progress = (val - 1700) / 100;
    const title = (sys === 'aos') ? 'Lord-Celestant' : 'Chapter Master';
    return {
      tierKey: 'commander',
      name: title,
      shortName: title,
      icon: '💠',
      badgeClass: 'elo-commander',
      accentColor: '#38bdf8',
      minElo: 1700,
      maxElo: 1800,
      nextTier: { name: 'Grand Marshal', targetElo: 1800, ptsNeeded: (1800 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-commander'
    };
  }

  // 1600 - 1699
  if (val >= 1600) {
    const progress = (val - 1600) / 100;
    return {
      tierKey: 'captain',
      name: 'Captain',
      shortName: 'Captain',
      icon: '💎',
      badgeClass: 'elo-captain',
      accentColor: '#10b981',
      minElo: 1600,
      maxElo: 1700,
      nextTier: { name: (sys === 'aos') ? 'Lord-Celestant' : 'Chapter Master', targetElo: 1700, ptsNeeded: (1700 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-captain'
    };
  }

  // 1500 - 1599
  if (val >= 1500) {
    const progress = (val - 1500) / 100;
    return {
      tierKey: 'veteran',
      name: 'Veteran',
      shortName: 'Veteran',
      icon: '⚜️',
      badgeClass: 'elo-veteran',
      accentColor: '#facc15',
      minElo: 1500,
      maxElo: 1600,
      nextTier: { name: 'Captain', targetElo: 1600, ptsNeeded: (1600 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-veteran'
    };
  }

  // 1450 - 1499
  if (val >= 1450) {
    const progress = (val - 1450) / 50;
    return {
      tierKey: 'battle-brother',
      name: 'Battle-Brother',
      shortName: 'Battle-Brother',
      icon: '⚔️',
      badgeClass: 'elo-battle-brother',
      accentColor: '#94a3b8',
      minElo: 1450,
      maxElo: 1500,
      nextTier: { name: 'Veteran', targetElo: 1500, ptsNeeded: (1500 - val).toFixed(1) },
      progressPercent: Math.min(100, Math.max(0, Math.round(progress * 100))),
      themeClass: 'profile-theme-battle-brother'
    };
  }

  // < 1450
  return {
    tierKey: 'scout',
    name: 'Scout',
    shortName: 'Scout',
    icon: '🛡️',
    badgeClass: 'elo-scout',
    accentColor: '#64748b',
    minElo: 0,
    maxElo: 1450,
    nextTier: { name: 'Battle-Brother', targetElo: 1450, ptsNeeded: (1450 - val).toFixed(1) },
    progressPercent: Math.min(100, Math.max(0, Math.round((val / 1450) * 100))),
    themeClass: 'profile-theme-scout'
  };
}

function getEloBadgeClass(elo, matchesCount = null, gameSystem = '') {
  const tier = getEloTier(elo, matchesCount, gameSystem);
  return tier.badgeClass;
}

function renderEloBadgePill(elo, matchesCount = null, options = {}) {
  const val = Number(elo) || 1500;
  const gameSys = options.gameSystem || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
  const tier = getEloTier(val, matchesCount, gameSys);
  const showTier = options.showTierName || false;
  const sizeClass = options.size === 'lg' ? 'elo-pill-lg' : (options.size === 'sm' ? 'elo-pill-sm' : '');
  const formattedVal = val.toFixed(1);

  if (tier.isUncalibrated) {
    const tooltip = `Aspirant · Uncalibrated (${tier.matchesPlayed}/5 matches completed)`;
    return `<span class="elo-pill ${tier.badgeClass} ${sizeClass}" title="${tooltip}">` +
      `<span class="elo-pill-icon">${tier.icon}</span>` +
      (showTier ? `<span class="elo-pill-tier">${escapeHtml(tier.shortName)}</span><span class="elo-pill-sep">·</span>` : '') +
      `<span class="elo-pill-value">${formattedVal}</span>` +
      `</span>`;
  }

  const tooltip = `${tier.name} · ${formattedVal} Elo`;
  return `<span class="elo-pill ${tier.badgeClass} ${sizeClass}" title="${tooltip}">` +
    `<span class="elo-pill-icon">${tier.icon}</span>` +
    (showTier ? `<span class="elo-pill-tier">${escapeHtml(tier.shortName)}</span><span class="elo-pill-sep">·</span>` : '') +
    `<span class="elo-pill-value">${formattedVal}</span>` +
    `</span>`;
}

if (typeof window !== 'undefined') {
  window.getEloTier = getEloTier;
  window.renderEloBadgePill = renderEloBadgePill;
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
  'lead-teams': { field: 'power_rating', asc: false },
  'players-dir': { field: 'current_elo', asc: false },
  'factions': { field: 'win_rate', asc: false },
  'player-matches': { field: 'match_date', asc: false },
  'event-results': { field: 'placement', asc: true },
  'event-elo': { field: 'current_elo', asc: false },
  'event-pairings': { field: 'round', asc: true },
  'h2h': { field: 'match_date', asc: false },
  'team-roster': { field: 'current_elo', asc: false }
};

function sortTable(tableKey, field) {
  if (!currentSort[tableKey]) {
    currentSort[tableKey] = { field: field, asc: (field === 'placement' || field === 'rank' || field === 'round') ? true : false };
  }
  const config = currentSort[tableKey];
  if (config.field === field) {
    config.asc = !config.asc;
  } else {
    config.field = field;
    config.asc = (field === 'name' || field === 'player_name' || field === 'full_name' || field === 'team' || field === 'faction' || field === 'round' || field === 'placement' || field === 'rank') ? true : false;
  }

  updateHeaderIcons(tableKey, field, config.asc);

  if (tableKey === 'events') {
    if (typeof eventsSortState !== 'undefined') eventsSortState = config;
    loadEvents();
  } else if (tableKey === 'teams') {
    if (typeof teamsSortState !== 'undefined') teamsSortState = config;
    loadTeamsDirectory();
  } else if (tableKey === 'lead-teams') {
    if (typeof leaderboardTeamsSortState !== 'undefined') leaderboardTeamsSortState = config;
    if (typeof leaderboardTeamsPagination !== 'undefined') leaderboardTeamsPagination.page = 1;
    loadLeaderboardTeams();
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
    'lead-teams': 'lead-teams-table',
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

/**
 * Finds the closest known community hub within maxMiles (default 6.0 miles).
 * Uses spherical haversine formula matching backend database.py reverse_geocode_coordinates.
 */
function findClosestKnownCity(lat, lng, maxMiles = 6.0) {
  if (lat == null || lng == null) return null;
  const numLat = parseFloat(lat);
  const numLng = parseFloat(lng);
  if (isNaN(numLat) || isNaN(numLng)) return null;

  const dict = (typeof window !== 'undefined' && window.GLOBAL_CITY_COORDS) ? window.GLOBAL_CITY_COORDS : GLOBAL_CITY_COORDS;
  let closest = null;
  let minDist = maxMiles;
  const R = 3959.0; // Earth radius in miles

  for (const [key, val] of Object.entries(dict)) {
    if (val.lat != null && val.lng != null) {
      const dLat = (val.lat - numLat) * Math.PI / 180;
      const dLng = (val.lng - numLng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(numLat * Math.PI / 180) * Math.cos(val.lat * Math.PI / 180) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
      const dist = R * c;
      if (dist < minDist) {
        minDist = dist;
        closest = { ...val, key, distMiles: dist };
      }
    }
  }
  return closest;
}

/**
 * Unified reverse geocoder for GPS coordinates.
 * Ensures exact parity between client auto-populate and backend overview resolution:
 * 1. Fast local hub proximity check (< 6 miles, e.g. Poway vs San Diego).
 * 2. Backend authoritative reverse geocode (/api/community/reverse_geocode).
 * 3. Google Maps Geocoder with sublocality prioritization and metropolitan distance check (> 12 miles).
 * 4. Safe fallback to formatted lat/lng.
 */
async function resolveLocationFromCoordinates(lat, lng) {
  if (lat == null || lng == null) {
    return { city: '', state: '', country: 'United States', formatted: 'Current Location', lat: 0, lng: 0 };
  }
  const numLat = parseFloat(lat);
  const numLng = parseFloat(lng);
  if (isNaN(numLat) || isNaN(numLng)) {
    return { city: '', state: '', country: 'United States', formatted: 'Current Location', lat: 0, lng: 0 };
  }

  // 1. Instant local proximity check against known community hubs (< 6 miles)
  const localHub = findClosestKnownCity(numLat, numLng, 6.0);
  let resolvedCity = '';
  let resolvedState = '';
  let resolvedCountry = 'United States';
  let formatted = '';

  if (localHub && localHub.name) {
    formatted = localHub.name;
    const parts = localHub.name.split(',');
    resolvedCity = parts[0]?.trim() || localHub.name;
    resolvedState = parts[1]?.trim() || '';
  }

  // 2. Authoritative backend reverse geocode query (if not resolved by hub)
  if (!formatted && typeof window !== 'undefined' && typeof window.api?.reverseGeocode === 'function') {
    try {
      const rev = await window.api.reverseGeocode(numLat, numLng);
      if (rev && rev.formatted && !rev.formatted.startsWith('GPS (')) {
        formatted = rev.formatted;
        resolvedCity = rev.city || (rev.formatted.split(',')[0]?.trim()) || '';
        resolvedState = rev.state || (rev.formatted.split(',')[1]?.trim()) || '';
        resolvedCountry = rev.country || 'United States';
      }
    } catch (e) {
      console.warn('Backend reverse-geocode notice:', e);
    }
  }

  // 3. Google Maps Geocoder fallback / enrichment with sublocality prioritization
  if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
    try {
      const geocoder = new google.maps.Geocoder();
      const gRes = await new Promise((resolve) => {
        geocoder.geocode({ location: { lat: numLat, lng: numLng } }, (results, status) => {
          if (status === 'OK' && results && results[0]) resolve(results[0]);
          else resolve(null);
        });
      });
      if (gRes && gRes.address_components) {
        let gSublocality = '', gLocality = '', gState = '', gCountry = 'United States';
        for (const comp of gRes.address_components) {
          const types = comp.types || [];
          if (types.includes('sublocality') || types.includes('sublocality_level_1') || types.includes('postal_town')) {
            gSublocality = comp.long_name;
          }
          if (types.includes('locality')) {
            gLocality = comp.long_name;
          }
          if (types.includes('administrative_area_level_1')) {
            gState = comp.short_name || comp.long_name;
          }
          if (types.includes('country')) {
            gCountry = comp.long_name;
          }
        }

        // Check if locality is coarse metropolitan center far away (> 12 miles)
        let isCoarseMetro = false;
        if (gLocality && typeof lookupCityCoordinates === 'function') {
          const metroCoord = lookupCityCoordinates(gLocality);
          if (metroCoord && metroCoord.lat != null) {
            const dlat = (metroCoord.lat - numLat) * 69.0;
            const dlng = (metroCoord.lng - numLng) * 55.0;
            const distMetro = Math.sqrt(dlat * dlat + dlng * dlng);
            if (distMetro > 12.0) {
              isCoarseMetro = true;
            }
          }
        }

        if (!formatted) {
          const chosenCity = (!isCoarseMetro && gSublocality) ? gSublocality :
                             (isCoarseMetro && gSublocality ? gSublocality :
                             (isCoarseMetro ? '' : gLocality));
          if (chosenCity) {
            resolvedCity = chosenCity;
            resolvedState = gState;
            resolvedCountry = gCountry;
            formatted = gState ? `${chosenCity}, ${gState}` : chosenCity;
          }
        }
      }
    } catch (e) {
      console.warn('Google reverse geocode notice:', e);
    }
  }

  // 4. Secondary backend check if Google Geocoder could not resolve
  if (!formatted && typeof window !== 'undefined' && typeof window.api?.reverseGeocode === 'function') {
    try {
      const rev = await window.api.reverseGeocode(numLat, numLng);
      if (rev && rev.formatted && !rev.formatted.startsWith('GPS (')) {
        formatted = rev.formatted;
        resolvedCity = rev.city || (rev.formatted.split(',')[0]?.trim()) || '';
        resolvedState = rev.state || (rev.formatted.split(',')[1]?.trim()) || '';
        resolvedCountry = rev.country || 'United States';
      }
    } catch (e) {
      console.warn('Backend reverse-geocode fallback notice:', e);
    }
  }

  // 5. Final fallback
  if (!formatted) {
    formatted = resolvedCity ? (resolvedState ? `${resolvedCity}, ${resolvedState}` : resolvedCity) : `GPS (${numLat.toFixed(4)}, ${numLng.toFixed(4)})`;
  }

  return {
    city: resolvedCity,
    state: resolvedState,
    country: resolvedCountry,
    formatted: formatted,
    lat: numLat,
    lng: numLng
  };
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

function openDatePicker(id) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  try {
    if (typeof el.showPicker === 'function') {
      el.showPicker();
      return;
    }
  } catch (e) {}
  el.focus();
}

/**
 * Deterministically sorts an array of match history objects in descending chronological order
 * (most recent game first / on top).
 * Preserves a stable tie-breaker if timestamps/rounds are identical by detecting if input was oldest-first.
 */
function sortMatchesNewestFirst(matches) {
  if (!Array.isArray(matches) || matches.length <= 1) {
    return Array.isArray(matches) ? [...matches] : [];
  }

  const firstDate = String(matches[0]?.match_date || matches[0]?.event_date || matches[0]?.date || '').slice(0, 10);
  const lastDate = String(matches[matches.length - 1]?.match_date || matches[matches.length - 1]?.event_date || matches[matches.length - 1]?.date || '').slice(0, 10);
  const inputIsAscending = Boolean(firstDate && lastDate && firstDate <= lastDate);

  return matches
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const mA = a.item;
      const mB = b.item;
      const dateA = String(mA?.match_date || mA?.event_date || mA?.date || '').slice(0, 10);
      const dateB = String(mB?.match_date || mB?.event_date || mB?.date || '').slice(0, 10);

      if (dateA && dateB && dateA !== dateB) {
        return dateB.localeCompare(dateA); // Newest date first
      }
      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;

      // Same date / event: sort by round descending (e.g., Round 5 before Round 4)
      const roundA = Number(mA?.round || 0);
      const roundB = Number(mB?.round || 0);
      if (roundA !== roundB) {
        return roundB - roundA; // Most recent round on top
      }

      // Fallback tie-breaker: if input was ascending (oldest first), reverse original index
      return inputIsAscending ? (b.index - a.index) : (a.index - b.index);
    })
    .map(entry => entry.item);
}

if (typeof window !== 'undefined') {
  window.GLOBAL_CITY_COORDS = GLOBAL_CITY_COORDS;
  window.lookupCityCoordinates = lookupCityCoordinates;
  window.findClosestKnownCity = findClosestKnownCity;
  window.resolveLocationFromCoordinates = resolveLocationFromCoordinates;
  window.escapeHtml = escapeHtml;
  window.formatNumber = formatNumber;
  window.getEloBadgeClass = getEloBadgeClass;
  window.sortClientArray = sortClientArray;
  window.sortMatchesNewestFirst = sortMatchesNewestFirst;
  window.handlePlayerChatClick = handlePlayerChatClick;
  window.openDatePicker = openDatePicker;
}
