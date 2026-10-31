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

function escapeJsArg(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, ' ');
}
window.escapeJsArg = escapeJsArg;

function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  return Number(num).toLocaleString();
}

/**
 * Splits a raw faction string into individual faction pills without breaking
 * MTG Commander / TCG Leader names that contain commas (e.g. "Kinnan, Bonder Prodigy"
 * or "Kraum, Ludevic's Opus / Tymna the Weaver").
 */
function splitFactionPills(rawFaction) {
  if (rawFaction === null || rawFaction === undefined) return [];
  if (Array.isArray(rawFaction)) {
    return rawFaction.map(s => String(s || '').trim()).filter(Boolean);
  }
  const str = String(rawFaction).trim();
  if (!str) return [];
  if (!str.includes(',')) return [str];
  const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem)
    ? String(currentGameSystem).toLowerCase()
    : '40k';
  const tcgSystems = new Set([
    'mtg', 'pokemon', 'one_piece', 'onepiece', 'yugioh', 'lorcana',
    'flesh_blood', 'flesh_and_blood', 'sw_unlimited', 'starwars_unlimited', 'digimon', 'riftbound'
  ]);
  if (str.includes(' / ') || tcgSystems.has(sys)) {
    return [str];
  }
  return str.split(',').map(s => s.trim()).filter(Boolean);
}
window.splitFactionPills = splitFactionPills;

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
  const unitSuffix = (options.size === 'lg' || options.showEloUnit) ? ' Elo' : '';

  if (tier.isUncalibrated) {
    const tooltip = `Aspirant · Uncalibrated (${tier.matchesPlayed}/5 matches completed)`;
    return `<span class="elo-pill ${tier.badgeClass} ${sizeClass}" title="${tooltip}">` +
      `<span class="elo-pill-icon">${tier.icon}</span>` +
      (showTier ? `<span class="elo-pill-tier">${escapeHtml(tier.shortName)}</span><span class="elo-pill-sep">·</span>` : '') +
      `<span class="elo-pill-value">${formattedVal}${unitSuffix}</span>` +
      `</span>`;
  }

  const tooltip = `Competitive Rating: ${formattedVal} Elo · Tier: ${tier.name}`;
  return `<span class="elo-pill ${tier.badgeClass} ${sizeClass}" title="${tooltip}">` +
    `<span class="elo-pill-icon">${tier.icon}</span>` +
    (showTier ? `<span class="elo-pill-tier">${escapeHtml(tier.shortName)}</span><span class="elo-pill-sep">·</span>` : '') +
    `<span class="elo-pill-value">${formattedVal}${unitSuffix}</span>` +
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
  'leaderboard': { field: 'current_elo', asc: false },
  'events': { field: 'event_date', asc: false },
  'teams': { field: 'power_rating', asc: false },
  'lead-teams': { field: 'power_rating', asc: false },
  'lead-itc': { field: 'itc_points', asc: false },
  'players-dir': { field: 'current_elo', asc: false },
  'factions': { field: 'win_rate', asc: false },
  'player-matches': { field: 'match_date', asc: false },
  'event-results': { field: 'placement', asc: true },
  'event-elo': { field: 'current_elo', asc: false },
  'event-pairings': { field: 'round', asc: true },
  'event-factions': { field: 'count', asc: false },
  'h2h': { field: 'match_date', asc: false },
  'team-roster': { field: 'current_elo', asc: false }
};

function sortTable(tableKey, field) {
  const defaultAscFields = new Set([
    'name', 'player_name', 'full_name', 'team', 'faction',
    'round', 'table_number', 'placement', 'rank', 'best_rank'
  ]);
  if (!currentSort[tableKey]) {
    currentSort[tableKey] = { field: field, asc: defaultAscFields.has(field) };
  }
  const config = currentSort[tableKey];
  if (config.field === field) {
    config.asc = !config.asc;
  } else {
    config.field = field;
    config.asc = defaultAscFields.has(field);
  }

  updateHeaderIcons(tableKey, field, config.asc);

  if (tableKey === 'leaderboard') {
    if (typeof leaderboardSortState !== 'undefined') leaderboardSortState = config;
    if (typeof leaderboardPagination !== 'undefined') leaderboardPagination.page = 1;
    if (typeof loadLeaderboard === 'function') loadLeaderboard();
  } else if (tableKey === 'events') {
    if (typeof eventsSortState !== 'undefined') eventsSortState = config;
    loadEvents();
  } else if (tableKey === 'teams') {
    if (typeof teamsSortState !== 'undefined') teamsSortState = config;
    loadTeamsDirectory();
  } else if (tableKey === 'lead-teams') {
    if (typeof leaderboardTeamsSortState !== 'undefined') leaderboardTeamsSortState = config;
    if (typeof leaderboardTeamsPagination !== 'undefined') leaderboardTeamsPagination.page = 1;
    loadLeaderboardTeams();
  } else if (tableKey === 'lead-itc') {
    if (typeof leaderboardItcSortState !== 'undefined') leaderboardItcSortState = config;
    if (typeof leaderboardItcPagination !== 'undefined') leaderboardItcPagination.page = 1;
    if (typeof loadLeaderboardItc === 'function') loadLeaderboardItc();
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
      renderEventResultsRows();
    }
  } else if (tableKey === 'event-elo') {
    if (typeof eventPlayersCache !== 'undefined' && eventPlayersCache) {
      renderEventEloRows();
    }
  } else if (tableKey === 'event-factions') {
    if (typeof renderEventMetaHighlights === 'function') {
      renderEventMetaHighlights(typeof currentEventData !== 'undefined' ? currentEventData : null);
    }
  } else if (tableKey === 'team-roster') {
    if (typeof currentTeamRoster !== 'undefined' && currentTeamRoster) {
      currentTeamRoster = sortClientArray(currentTeamRoster, config.field, config.asc);
      renderTeamRosterRows(currentTeamRoster);
    }
  } else if (tableKey === 'event-pairings') {
    if (typeof eventMatchesCache !== 'undefined' && eventMatchesCache) {
      if (config.field === 'outcome') {
        eventMatchesCache = [...eventMatchesCache].sort((a, b) => {
          const getOut = (m) => (m.winner_id && m.winner_id === m.player1_id) ? '1_p1_win' : ((m.winner_id && m.winner_id === m.player2_id) ? '2_p2_win' : (m.is_draw ? '3_draw' : (m.is_bye ? '4_bye' : '0_pending')));
          const cmp = getOut(a).localeCompare(getOut(b));
          return config.asc ? cmp : -cmp;
        });
      } else {
        eventMatchesCache = sortClientArray(eventMatchesCache, config.field, config.asc);
      }
      renderEventPairingsRows();
    }
  }
}

function updateHeaderIcons(tableKey, field, asc) {
  const tableMap = {
    'leaderboard': 'leaderboard-table',
    'team-roster': 'team-roster-table',
    'events': 'events-table',
    'teams': 'teams-table',
    'lead-teams': 'lead-teams-table',
    'lead-itc': 'lead-itc-table',
    'players-dir': 'players-table',
    'factions': 'faction-meta-table',
    'player-matches': 'player-matches-table',
    'event-results': 'event-results-table',
    'event-elo': 'event-elo-table',
    'event-pairings': 'event-pairings-table',
    'event-factions': 'event-factions-table',
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

  // 4. Final fallback
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

let _globalMapsSdkLoadingPromise = null;

async function loadGoogleMapsSdk(callback) {
  if (typeof google !== 'undefined' && google.maps && google.maps.places) {
    if (typeof initGooglePlaces === 'function') initGooglePlaces();
    if (typeof attachAllPlacesAutocompletes === 'function') attachAllPlacesAutocompletes();
    if (typeof callback === 'function') callback();
    return;
  }
  if (_globalMapsSdkLoadingPromise) {
    if (typeof callback === 'function') {
      _globalMapsSdkLoadingPromise.then(() => callback());
    }
    return _globalMapsSdkLoadingPromise;
  }

  _globalMapsSdkLoadingPromise = (async () => {
    try {
      const res = await fetch('/api/config/maps-key');
      if (!res.ok) return;
      const data = await res.json();
      const apiKey = (data && data.key) ? data.key.trim() : '';
      if (!apiKey) return;
      if (document.querySelector('script[src*="maps.googleapis.com"]')) {
        if (typeof callback === 'function') setTimeout(callback, 200);
        return;
      }

      await new Promise((resolve) => {
        window.__onGoogleMapsSdkReady = () => {
          if (typeof initGooglePlaces === 'function') initGooglePlaces();
          if (typeof attachAllPlacesAutocompletes === 'function') attachAllPlacesAutocompletes();
          if (typeof initStoresGoogleMap === 'function' && document.getElementById('comm-stores-map')) {
            initStoresGoogleMap();
          }
          if (typeof callback === 'function') callback();
          resolve();
        };

        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&callback=__onGoogleMapsSdkReady`;
        script.async = true;
        script.defer = true;
        script.onerror = () => resolve();
        document.head.appendChild(script);
      });
    } catch (err) {
      console.warn('Notice loading Google Maps SDK:', err);
    }
  })();

  return _globalMapsSdkLoadingPromise;
}

function showToast(message, type = 'info') {
  if (!message || typeof document === 'undefined') return;
  let container = document.getElementById('omni-global-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'omni-global-toast-container';
    container.style.cssText = 'position:fixed; top:16px; right:16px; z-index:20000; display:flex; flex-direction:column; gap:8px; max-width:min(420px, calc(100vw - 32px)); pointer-events:none;';
    document.body.appendChild(container);
  }
  const lvl = (type === true || type === 'error' || type === 'danger')
    ? 'error'
    : (type === 'warning' || type === 'warn' ? 'warning' : (type === 'success' ? 'success' : 'info'));
  const palette = {
    success: { bg: 'rgba(6, 78, 59, 0.96)', border: 'rgba(52, 211, 153, 0.65)', text: '#ecfdf5', icon: '✅' },
    warning: { bg: 'rgba(120, 53, 15, 0.96)', border: 'rgba(251, 191, 36, 0.65)', text: '#fffbeb', icon: '⚠️' },
    error:   { bg: 'rgba(127, 29, 29, 0.96)', border: 'rgba(248, 113, 113, 0.65)', text: '#fef2f2', icon: '🚨' },
    info:    { bg: 'rgba(12, 74, 110, 0.96)', border: 'rgba(56, 189, 248, 0.65)', text: '#f0f9ff', icon: '💬' },
  }[lvl];

  const toast = document.createElement('div');
  toast.style.cssText = `pointer-events:auto; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 14px; border-radius:10px; background:${palette.bg}; border:1px solid ${palette.border}; color:${palette.text}; font-size:0.82rem; font-weight:700; box-shadow:0 12px 32px rgba(0,0,0,0.55); backdrop-filter:blur(8px); transition:opacity 0.22s ease, transform 0.22s ease;`;
  toast.innerHTML = `
    <span style="display:flex; align-items:center; gap:8px; line-height:1.35;">
      <span>${palette.icon}</span>
      <span>${escapeHtml(String(message))}</span>
    </span>
    <button type="button" style="background:transparent; border:none; color:${palette.text}; opacity:0.75; cursor:pointer; font-size:0.9rem; padding:0 2px; line-height:1;">✕</button>
  `;
  const closeBtn = toast.querySelector('button');
  const removeToast = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    setTimeout(() => { try { toast.remove(); } catch (_) {} }, 220);
  };
  if (closeBtn) closeBtn.addEventListener('click', removeToast);
  container.appendChild(toast);
  setTimeout(removeToast, 4000);
}

function showNotification(message, type = 'info') {
  showToast(message, type);
}

if (typeof window !== 'undefined') {
  window.GLOBAL_CITY_COORDS = GLOBAL_CITY_COORDS;
  window.CITY_COORDS_MAP = GLOBAL_CITY_COORDS;
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
  window.loadGoogleMapsSdk = loadGoogleMapsSdk;
  window.showToast = showToast;
  window.showNotification = showNotification;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => loadGoogleMapsSdk());
    } else {
      loadGoogleMapsSdk();
    }
  }
}

// ==========================================================================
// MULTI-GAME SYSTEM REGISTRY (120 SYSTEMS SORTED BY POPULARITY)
// ==========================================================================
const BCP_GAME_SYSTEMS_CATALOG = [{"slug": "40k", "bcp_id": "WGMSzfKFYA", "short_name": "40K", "name": "Warhammer 40,000", "bcp_name": "Warhammer 40,000", "manufacturer": "Games Workshop", "icon": "⚔️", "has_tracker": true, "popularity_rank": 1}, {"slug": "aos", "bcp_id": "OY8FCPBf6O", "short_name": "AoS", "name": "Age of Sigmar", "bcp_name": "Age of Sigmar", "manufacturer": "Games Workshop", "icon": "⚡", "has_tracker": true, "popularity_rank": 2}, {"slug": "kill_team", "bcp_id": "kQGCslQaL7", "short_name": "Kill Team", "name": "Warhammer 40K: Kill Team", "bcp_name": "Kill Team", "manufacturer": "Games Workshop", "icon": "🎯", "has_tracker": false, "popularity_rank": 3}, {"slug": "the_old_world", "bcp_id": "pd0PejEmWE", "short_name": "Old World", "name": "Warhammer: The Old World", "bcp_name": "Warhammer The Old World", "manufacturer": "Games Workshop", "icon": "🛡️", "has_tracker": false, "popularity_rank": 4}, {"slug": "horus_heresy", "bcp_id": "pLmYM0zV1m", "short_name": "Horus Heresy", "name": "Warhammer: The Horus Heresy", "bcp_name": "Horus Heresy", "manufacturer": "Games Workshop", "icon": "🦅", "has_tracker": false, "popularity_rank": 5}, {"slug": "spearhead", "bcp_id": "7T4AAHWA8b", "short_name": "Spearhead", "name": "Age of Sigmar: Spearhead", "bcp_name": "Age of Sigmar: Spearhead", "manufacturer": "Games Workshop", "icon": "🗡️", "has_tracker": false, "popularity_rank": 6}, {"slug": "blood_bowl", "bcp_id": "VxekqWJWRW", "short_name": "Blood Bowl", "name": "Blood Bowl", "bcp_name": "Blood Bowl", "manufacturer": "Games Workshop", "icon": "🏈", "has_tracker": false, "popularity_rank": 7}, {"slug": "middle_earth", "bcp_id": "NogdsFot9Q", "short_name": "Middle-earth", "name": "Middle-earth SBG", "bcp_name": "Middle Earth", "manufacturer": "Games Workshop", "icon": "💍", "has_tracker": false, "popularity_rank": 8}, {"slug": "underworlds", "bcp_id": "Z8rcM0GCLw", "short_name": "Underworlds", "name": "Warhammer Underworlds", "bcp_name": "Warhammer Underworlds", "manufacturer": "Games Workshop", "icon": "💎", "has_tracker": false, "popularity_rank": 9}, {"slug": "warcry", "bcp_id": "8pva9b91NJ", "short_name": "Warcry", "name": "Warcry", "bcp_name": "Warcry", "manufacturer": "Games Workshop", "icon": "🔥", "has_tracker": false, "popularity_rank": 10}, {"slug": "necromunda", "bcp_id": "iHOUMbQAPk", "short_name": "Necromunda", "name": "Necromunda", "bcp_name": "Necromunda", "manufacturer": "Games Workshop", "icon": "☣️", "has_tracker": false, "popularity_rank": 11}, {"slug": "legions_imp", "bcp_id": "uSoKBpnzGY", "short_name": "Legions Imp.", "name": "Legions Imperialis", "bcp_name": "Legions Imperialis", "manufacturer": "Games Workshop", "icon": "🏛️", "has_tracker": false, "popularity_rank": 12}, {"slug": "bolt_action", "bcp_id": "UmFqbjCucw", "short_name": "Bolt Action", "name": "Bolt Action", "bcp_name": "Bolt Action", "manufacturer": "Warlord Games", "icon": "🪖", "has_tracker": false, "popularity_rank": 13}, {"slug": "mcp", "bcp_id": "fQjQW821Cd", "short_name": "Crisis Protocol", "name": "Marvel: Crisis Protocol", "bcp_name": "Crisis Protocol", "manufacturer": "Atomic Mass Games", "icon": "🦸", "has_tracker": false, "popularity_rank": 14}, {"slug": "sw_legion", "bcp_id": "WmHfUlqrcl", "short_name": "SW Legion", "name": "Star Wars: Legion", "bcp_name": "Star Wars Legion", "manufacturer": "Fantasy Flight Games", "icon": "🪐", "has_tracker": false, "popularity_rank": 15}, {"slug": "shatterpoint", "bcp_id": "mg9pmmIegg", "short_name": "Shatterpoint", "name": "Star Wars: Shatterpoint", "bcp_name": "Shatterpoint", "manufacturer": "Atomic Mass Games", "icon": "🪐", "has_tracker": false, "popularity_rank": 16}, {"slug": "trench_crusade", "bcp_id": "67392a1b8a704ed13fbdc5ab", "short_name": "Trench Crusade", "name": "Trench Crusade", "bcp_name": "Trench Crusade", "manufacturer": "Trench Crusade", "icon": "✝️", "has_tracker": false, "popularity_rank": 17}, {"slug": "battletech_as", "bcp_id": "6SU00J8VBy", "short_name": "Alpha Strike", "name": "BattleTech: Alpha Strike", "bcp_name": "Battletech Alpha Strike", "manufacturer": "Catalyst", "icon": "🦿", "has_tracker": false, "popularity_rank": 18}, {"slug": "battletech", "bcp_id": "66db51a9a21310856d0273cb", "short_name": "BattleTech", "name": "Classic BattleTech", "bcp_name": "Classic Battletech", "manufacturer": "Catalyst", "icon": "🦿", "has_tracker": false, "popularity_rank": 19}, {"slug": "conquest", "bcp_id": "h3DLVTOPg3", "short_name": "Conquest", "name": "Conquest: Last Argument of Kings", "bcp_name": "Conquest", "manufacturer": "Para Bellum", "icon": "⚔️", "has_tracker": false, "popularity_rank": 20}, {"slug": "warmachine", "bcp_id": "GCj1RjTY6F", "short_name": "Warmachine", "name": "Warmachine", "bcp_name": "Warmachine", "manufacturer": "Steamforged Games", "icon": "⚙️", "has_tracker": false, "popularity_rank": 21}, {"slug": "infinity", "bcp_id": "OMeSULv5Wo", "short_name": "Infinity", "name": "Infinity", "bcp_name": "Infinity", "manufacturer": "Corvus Belli", "icon": "🛰️", "has_tracker": false, "popularity_rank": 22}, {"slug": "malifaux", "bcp_id": "GJ0BZEcHbF", "short_name": "Malifaux", "name": "Malifaux", "bcp_name": "Malifaux", "manufacturer": "Wyrd", "icon": "🎩", "has_tracker": false, "popularity_rank": 23}, {"slug": "asoiaf", "bcp_id": "uHh26WUNJT", "short_name": "ASOIAF", "name": "A Song of Ice and Fire TMG", "bcp_name": "Song of Fire and Ice", "manufacturer": "CMON", "icon": "🐺", "has_tracker": false, "popularity_rank": 24}, {"slug": "flames_of_war", "bcp_id": "HZzH6H8DRI", "short_name": "Flames of War", "name": "Flames of War", "bcp_name": "Flames of War", "manufacturer": "Battlefront Miniatures", "icon": "🎖️", "has_tracker": false, "popularity_rank": 25}, {"slug": "grimdark_opr", "bcp_id": "vuttDt4BsI", "short_name": "Grimdark OPR", "name": "Grimdark Future (OPR)", "bcp_name": "Grim Dark Future", "manufacturer": "One Page Rules", "icon": "🌌", "has_tracker": false, "popularity_rank": 26}, {"slug": "halo_flashpt", "bcp_id": "677b16d926624e31ba8f551c", "short_name": "Halo Flashpoint", "name": "Halo: Flashpoint", "bcp_name": "Halo: Flashpoint", "manufacturer": "Mantic Games", "icon": "🪖", "has_tracker": false, "popularity_rank": 27}, {"slug": "guild_ball", "bcp_id": "ext_guild_ball", "short_name": "Guild Ball", "name": "Guild Ball", "bcp_name": "Guild Ball", "manufacturer": "Steamforged Games", "icon": "⚽", "has_tracker": false, "popularity_rank": 28}, {"slug": "one_piece", "bcp_id": "r5jWPuzwHN", "short_name": "One Piece", "name": "One Piece Card Game", "bcp_name": "One Piece", "manufacturer": "Bandai", "icon": "🏴‍☠️", "has_tracker": false, "popularity_rank": 29}, {"slug": "yugioh", "bcp_id": "mM4pewNtcT", "short_name": "Yu-Gi-Oh!", "name": "Yu-Gi-Oh! TCG", "bcp_name": "Yu-Gi-Oh!", "manufacturer": "Konami", "icon": "🔮", "has_tracker": false, "popularity_rank": 30}, {"slug": "mtg", "bcp_id": "FM1PYUZbsL", "short_name": "MTG", "name": "Magic: The Gathering", "bcp_name": "Magic the Gathering", "manufacturer": "Wizards of the Coast", "icon": "🔥", "has_tracker": false, "popularity_rank": 31}, {"slug": "commander", "bcp_id": "2UgcKy4txd", "short_name": "Commander", "name": "MTG: Commander", "bcp_name": "Commander", "manufacturer": "Wizards of the Coast", "icon": "🧙", "has_tracker": false, "popularity_rank": 32}, {"slug": "pokemon", "bcp_id": "Y9lj1TOc6A", "short_name": "Pokémon", "name": "Pokémon TCG", "bcp_name": "Pokémon", "manufacturer": "Nintendo", "icon": "⚡", "has_tracker": false, "popularity_rank": 33}, {"slug": "lorcana", "bcp_id": "l0vo0C77Ch", "short_name": "Lorcana", "name": "Disney Lorcana", "bcp_name": "Lorcana", "manufacturer": "Ravensburger", "icon": "✨", "has_tracker": false, "popularity_rank": 34}, {"slug": "digimon", "bcp_id": "0O1SPSSzw2", "short_name": "Digimon", "name": "Digimon Card Game", "bcp_name": "Digimon Card Game", "manufacturer": "Bandai", "icon": "🦖", "has_tracker": false, "popularity_rank": 35}, {"slug": "riftbound", "bcp_id": "ext_riftbound", "short_name": "Riftbound", "name": "Riftbound: League of Legends TCG", "bcp_name": "Riftbound", "manufacturer": "Riot Games", "icon": "🌀", "has_tracker": false, "popularity_rank": 36}, {"slug": "gundam_tcg", "bcp_id": "67ae9f34b9bba6cca026e77f", "short_name": "Gundam TCG", "name": "Gundam Card Game", "bcp_name": "Gundam TCG", "manufacturer": "Bandai", "icon": "🤖", "has_tracker": false, "popularity_rank": 37}, {"slug": "flesh_blood", "bcp_id": "oDXFQoeX0M", "short_name": "Flesh & Blood", "name": "Flesh and Blood TCG", "bcp_name": "Flesh And Blood", "manufacturer": "Legend Story Studio", "icon": "🩸", "has_tracker": false, "popularity_rank": 38}, {"slug": "sw_unlimited", "bcp_id": "SImHT3ZR3V", "short_name": "SW Unlimited", "name": "Star Wars: Unlimited", "bcp_name": "Star Wars Unlimited", "manufacturer": "Fantasy Flight Games", "icon": "🪐", "has_tracker": false, "popularity_rank": 39}, {"slug": "generic", "bcp_id": "H1hbQ5G0eY", "short_name": "Generic", "name": "Generic / Other Tabletop", "bcp_name": "Generic", "manufacturer": "Generic", "icon": "🎲", "has_tracker": false, "popularity_rank": 40}, {"slug": "catan_champ", "bcp_id": "VkLBPJ4lQb", "short_name": "CATAN Champ.", "name": "CATAN Championship", "bcp_name": "CATAN Championship", "manufacturer": "CATAN", "icon": "🏆", "has_tracker": false, "popularity_rank": 41}, {"slug": "shard_bugs_tcg", "bcp_id": "6786db6b26624e31ba8f5534", "short_name": "Shard Bugs TCG", "name": "Shard Bugs TCG", "bcp_name": "Shard Bugs TCG", "manufacturer": "Shard Bugs", "icon": "🎴", "has_tracker": false, "popularity_rank": 42}, {"slug": "soul_masters_t", "bcp_id": "67af3471bf62de059769280a", "short_name": "Soul Masters TCG", "name": "Soul Masters TCG", "bcp_name": "Soul Masters TCG", "manufacturer": "Soul Masters", "icon": "🎴", "has_tracker": false, "popularity_rank": 43}, {"slug": "catan", "bcp_id": "ADvcKMDSFy", "short_name": "CATAN", "name": "CATAN", "bcp_name": "CATAN", "manufacturer": "CATAN", "icon": "🏝️", "has_tracker": false, "popularity_rank": 44}, {"slug": "dbs_fusion", "bcp_id": "hrIkLY89ww", "short_name": "DBS Fusion", "name": "Dragon Ball Super: Fusion World", "bcp_name": "DBS Fusion World", "manufacturer": "Bandai", "icon": "🐉", "has_tracker": false, "popularity_rank": 45}, {"slug": "dbs", "bcp_id": "POYzp05n9p", "short_name": "Dragon Ball", "name": "Dragon Ball Super Card Game", "bcp_name": "Dragon Ball Super", "manufacturer": "Bandai", "icon": "🐉", "has_tracker": false, "popularity_rank": 46}, {"slug": "union_arena", "bcp_id": "66eb85e893f18eaacd38a818", "short_name": "Union Arena", "name": "Union Arena TCG", "bcp_name": "Union Arena", "manufacturer": "Bandai", "icon": "🎴", "has_tracker": false, "popularity_rank": 47}, {"slug": "primal_tcg", "bcp_id": "6608f946040ba4024c011a36", "short_name": "Primal TCG", "name": "Primal TCG", "bcp_name": "Primal TCG", "manufacturer": "Dattebayo Labs", "icon": "🎴", "has_tracker": false, "popularity_rank": 48}, {"slug": "final_fantasy_", "bcp_id": "8GFaZ0y25D", "short_name": "Final Fantasy T…", "name": "Final Fantasy TCG", "bcp_name": "Final Fantasy TCG", "manufacturer": "SQUARE ENIX", "icon": "🎴", "has_tracker": false, "popularity_rank": 49}, {"slug": "force_of_will", "bcp_id": "2s24lv1FXr", "short_name": "Force of Will", "name": "Force of Will", "bcp_name": "Force of Will", "manufacturer": "Force of Will", "icon": "🎲", "has_tracker": false, "popularity_rank": 50}, {"slug": "ww3_team_yanke", "bcp_id": "66db52c8fe9b80fb2f18ce94", "short_name": "WW3 Team Yankee", "name": "WW3 Team Yankee", "bcp_name": "WW3 Team Yankee", "manufacturer": "Battlefront Miniatures", "icon": "🎲", "has_tracker": false, "popularity_rank": 51}, {"slug": "aof_opr", "bcp_id": "trBDgd23tVbT", "short_name": "Age of Fantasy", "name": "Age of Fantasy (OPR)", "bcp_name": "Age of Fantasy", "manufacturer": "One Page Rules", "icon": "🐉", "has_tracker": false, "popularity_rank": 52}, {"slug": "battletech_tw", "bcp_id": "66db524e0c1f49d6136c487a", "short_name": "BT Total War", "name": "BattleTech: Total Warfare", "bcp_name": "Battletech Total Warfare", "manufacturer": "Catalyst", "icon": "🦿", "has_tracker": false, "popularity_rank": 53}, {"slug": "cardfight_vang", "bcp_id": "6O28cKLVdN", "short_name": "Cardfight! Vang…", "name": "Cardfight! Vangaurd", "bcp_name": "Cardfight! Vangaurd", "manufacturer": "Bushiroad", "icon": "🎴", "has_tracker": false, "popularity_rank": 54}, {"slug": "marcher_empire", "bcp_id": "kJ5tCtljRK85", "short_name": "Marcher: Empire…", "name": "Marcher: Empires at War", "bcp_name": "Marcher: Empires at War", "manufacturer": "Golden Dragon Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 55}, {"slug": "mordheim", "bcp_id": "ygDIbtGbFg", "short_name": "Mordheim", "name": "Mordheim", "bcp_name": "Mordheim", "manufacturer": "Games Workshop", "icon": "🕯️", "has_tracker": false, "popularity_rank": 56}, {"slug": "saga", "bcp_id": "nhnF6MNV04", "short_name": "SAGA", "name": "SAGA", "bcp_name": "Saga", "manufacturer": "Studio Tomahawk", "icon": "🛡️", "has_tracker": false, "popularity_rank": 57}, {"slug": "team_yankee", "bcp_id": "66bc4103d5b0ec49b6a2dbfb", "short_name": "Team Yankee", "name": "Team Yankee", "bcp_name": "Team Yankee", "manufacturer": "Battlefront Miniatures", "icon": "🎲", "has_tracker": false, "popularity_rank": 58}, {"slug": "ticket_to_ride", "bcp_id": "661e1d2b6d494f1ed7334910", "short_name": "Ticket to Ride", "name": "Ticket to Ride", "bcp_name": "Ticket to Ride", "manufacturer": "Asmodee", "icon": "🎲", "has_tracker": false, "popularity_rank": 59}, {"slug": "wartide", "bcp_id": "6674207e3468bc0bc894ade4", "short_name": "Wartide", "name": "Wartide", "bcp_name": "Wartide", "manufacturer": "Wartide", "icon": "🎲", "has_tracker": false, "popularity_rank": 60}, {"slug": "x_wing", "bcp_id": "bx62OfZBGb", "short_name": "X-Wing", "name": "Star Wars: X-Wing", "bcp_name": "X-Wing", "manufacturer": "Fantasy Flight Games", "icon": "🚀", "has_tracker": false, "popularity_rank": 61}, {"slug": "aeronautica", "bcp_id": "xQ7Nrr30tj", "short_name": "Aeronautica", "name": "Aeronautica Imperialis", "bcp_name": "Aeronautica", "manufacturer": "Games Workshop", "icon": "✈️", "has_tracker": false, "popularity_rank": 62}, {"slug": "age_of_fantasy", "bcp_id": "B8m83OPe8OnU", "short_name": "Age of Fantasy…", "name": "Age of Fantasy Skirmish", "bcp_name": "Age of Fantasy Skirmish", "manufacturer": "One Page Rules", "icon": "🎲", "has_tracker": false, "popularity_rank": 63}, {"slug": "aos_champions", "bcp_id": "5hX6tOfDHv", "short_name": "AoS Champions", "name": "Age of Sigmar: Champions", "bcp_name": "Age of Sigmar: Champions", "manufacturer": "Play Fusion", "icon": "🃏", "has_tracker": false, "popularity_rank": 64}, {"slug": "annapurna", "bcp_id": "Agoe0Asx9M", "short_name": "AnnaPurna", "name": "AnnaPurna", "bcp_name": "AnnaPurna", "manufacturer": "Fiat Lucre", "icon": "🎲", "has_tracker": false, "popularity_rank": 65}, {"slug": "argent_saga", "bcp_id": "X0130kMDD6", "short_name": "Argent Saga", "name": "Argent Saga", "bcp_name": "Argent Saga", "manufacturer": "Amikon Entertainment", "icon": "🎲", "has_tracker": false, "popularity_rank": 66}, {"slug": "batman_tmg", "bcp_id": "v857jmhYSv", "short_name": "Batman : TMG", "name": "Batman : TMG", "bcp_name": "Batman : TMG", "manufacturer": "Knight Models", "icon": "🎲", "has_tracker": false, "popularity_rank": 67}, {"slug": "battle_spirits", "bcp_id": "Z9MvTncufZ", "short_name": "Battle Spirits…", "name": "Battle Spirits Saga", "bcp_name": "Battle Spirits Saga", "manufacturer": "Bandai", "icon": "🎴", "has_tracker": false, "popularity_rank": 68}, {"slug": "beyblade", "bcp_id": "itaOMAgBTWqs", "short_name": "Beyblade", "name": "Beyblade", "bcp_name": "Beyblade", "manufacturer": "Beyblade", "icon": "🎲", "has_tracker": false, "popularity_rank": 69}, {"slug": "bi_ho", "bcp_id": "65fb7934cdaa32a59a1d4b89", "short_name": "Biñho", "name": "Biñho", "bcp_name": "Biñho", "manufacturer": "Binho Board", "icon": "🎲", "has_tracker": false, "popularity_rank": 70}, {"slug": "blkout", "bcp_id": "ro4xyyTWREhF", "short_name": "BLKOUT", "name": "BLKOUT", "bcp_name": "BLKOUT", "manufacturer": "BLKOUT", "icon": "🎲", "has_tracker": false, "popularity_rank": 71}, {"slug": "blood_and_plun", "bcp_id": "66db6045abc0360803e9a3a2", "short_name": "Blood and Plund…", "name": "Blood and Plunder", "bcp_name": "Blood and Plunder", "manufacturer": "Firelock Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 72}, {"slug": "blood_fields", "bcp_id": "MXCAl2xYYG", "short_name": "Blood Fields", "name": "Blood Fields", "bcp_name": "Blood Fields", "manufacturer": "Titan Forge", "icon": "🎲", "has_tracker": false, "popularity_rank": 73}, {"slug": "blood_red_skie", "bcp_id": "wtv9VrjMWt", "short_name": "Blood Red Skies", "name": "Blood Red Skies", "bcp_name": "Blood Red Skies", "manufacturer": "Warlord Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 74}, {"slug": "chrono_core", "bcp_id": "66df997f746f34555ccce16f", "short_name": "Chrono Core", "name": "Chrono Core", "bcp_name": "Chrono Core", "manufacturer": "Chrono Core Studios", "icon": "🎲", "has_tracker": false, "popularity_rank": 75}, {"slug": "chrono_core_tc", "bcp_id": "67bdb7c1bf62de0597692872", "short_name": "Chrono Core TCG", "name": "Chrono Core TCG", "bcp_name": "Chrono Core TCG", "manufacturer": "Chrono Core", "icon": "🎴", "has_tracker": false, "popularity_rank": 76}, {"slug": "doomtown", "bcp_id": "1U5bWEJTWw", "short_name": "Doomtown", "name": "Doomtown", "bcp_name": "Doomtown", "manufacturer": "Pine Box Entertainment", "icon": "🎲", "has_tracker": false, "popularity_rank": 77}, {"slug": "epic", "bcp_id": "kHseS0TYLo", "short_name": "Epic", "name": "Epic", "bcp_name": "Epic", "manufacturer": "White Wizard Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 78}, {"slug": "flex_nba_battl", "bcp_id": "4ugzUcccmW", "short_name": "Flex NBA Battle…", "name": "Flex NBA Battle Series", "bcp_name": "Flex NBA Battle Series", "manufacturer": "Sequoia Games Inc.", "icon": "🎲", "has_tracker": false, "popularity_rank": 79}, {"slug": "future_card_bu", "bcp_id": "7jbbuBKD24", "short_name": "Future Card Bud…", "name": "Future Card Buddyfight", "bcp_name": "Future Card Buddyfight", "manufacturer": "Bushiroad", "icon": "🎴", "has_tracker": false, "popularity_rank": 80}, {"slug": "game_of_throne", "bcp_id": "EdhBk0q4c4", "short_name": "Game of Thrones…", "name": "Game of Thrones the Card Game", "bcp_name": "Game of Thrones the Card Game", "manufacturer": "Fantasy Flight Games", "icon": "🎴", "has_tracker": false, "popularity_rank": 81}, {"slug": "genesis_battle", "bcp_id": "662a8fbc7d069d1a9e33efe9", "short_name": "Genesis: Battle…", "name": "Genesis: Battle of Champtions", "bcp_name": "Genesis: Battle of Champtions", "manufacturer": "Edge of Exile Entertainment Inc.", "icon": "🎲", "has_tracker": false, "popularity_rank": 82}, {"slug": "godsforge", "bcp_id": "0BmDs4dUIi", "short_name": "Godsforge", "name": "Godsforge", "bcp_name": "Godsforge", "manufacturer": "Atlas Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 83}, {"slug": "grand_archive", "bcp_id": "K3me9vfATM", "short_name": "Grand Archive", "name": "Grand Archive", "bcp_name": "Grand Archive", "manufacturer": "Weebs of the Shore", "icon": "🎲", "has_tracker": false, "popularity_rank": 84}, {"slug": "hero_realms", "bcp_id": "s6TAZbwxML", "short_name": "Hero Realms", "name": "Hero Realms", "bcp_name": "Hero Realms", "manufacturer": "White Wizard Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 85}, {"slug": "heroclix", "bcp_id": "mIXqdaGANs", "short_name": "HeroClix", "name": "HeroClix", "bcp_name": "HeroClix", "manufacturer": "Wizkids", "icon": "🎲", "has_tracker": false, "popularity_rank": 86}, {"slug": "imperial_assau", "bcp_id": "5CgWAgFADE", "short_name": "Imperial Assault", "name": "Imperial Assault", "bcp_name": "Imperial Assault", "manufacturer": "Fantasy Flight Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 87}, {"slug": "keyforge", "bcp_id": "Z5J97FvlKe", "short_name": "Keyforge", "name": "Keyforge", "bcp_name": "Keyforge", "manufacturer": "Fantasy Flight Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 88}, {"slug": "king_of_tokyo", "bcp_id": "9kl7L9nldU", "short_name": "King of Tokyo", "name": "King of Tokyo", "bcp_name": "King of Tokyo", "manufacturer": "iello", "icon": "🎲", "has_tracker": false, "popularity_rank": 89}, {"slug": "kings_of_war", "bcp_id": "FQ4DfKKpEU", "short_name": "Kings of War", "name": "Kings of War", "bcp_name": "Kings of War", "manufacturer": "Mantic Games", "icon": "🏰", "has_tracker": false, "popularity_rank": 90}, {"slug": "konflikt_47", "bcp_id": "tQjLdaXhcJ", "short_name": "Konflikt 47", "name": "Konflikt '47", "bcp_name": "Konflict '47", "manufacturer": "Warlord Games", "icon": "☢️", "has_tracker": false, "popularity_rank": 91}, {"slug": "legend_of_the_", "bcp_id": "p8aUEX6mDs", "short_name": "Legend of the F…", "name": "Legend of the Five Rings", "bcp_name": "Legend of the Five Rings", "manufacturer": "Fantasy Flight Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 92}, {"slug": "metazoo", "bcp_id": "9NxxBJf4Na", "short_name": "Metazoo", "name": "Metazoo", "bcp_name": "Metazoo", "manufacturer": "Metazoo Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 93}, {"slug": "monsterpocalyp", "bcp_id": "7uUGktcIRq", "short_name": "Monsterpocalypse", "name": "Monsterpocalypse", "bcp_name": "Monsterpocalypse", "manufacturer": "Privateer Press", "icon": "🎲", "has_tracker": false, "popularity_rank": 94}, {"slug": "naruto", "bcp_id": "PDAuoa5cgK", "short_name": "Naruto", "name": "Naruto", "bcp_name": "Naruto", "manufacturer": "Bandai", "icon": "🎴", "has_tracker": false, "popularity_rank": 95}, {"slug": "onslaught", "bcp_id": "8hN1ihJ8DN", "short_name": "ONSLAUGHT", "name": "ONSLAUGHT", "bcp_name": "ONSLAUGHT", "manufacturer": "Whiz Kids", "icon": "🎲", "has_tracker": false, "popularity_rank": 96}, {"slug": "outward_realms", "bcp_id": "605bcf998226840d4bc00ffe", "short_name": "Outward Realms", "name": "Outward Realms", "bcp_name": "Outward Realms", "manufacturer": "Outward Realms", "icon": "🎲", "has_tracker": false, "popularity_rank": 97}, {"slug": "rivals", "bcp_id": "v6qfejJRUx", "short_name": "Rivals", "name": "Rivals", "bcp_name": "Rivals", "manufacturer": "CATAN", "icon": "🎲", "has_tracker": false, "popularity_rank": 98}, {"slug": "roba", "bcp_id": "NAK4OpT3kT", "short_name": "ROBA", "name": "ROBA", "bcp_name": "ROBA", "manufacturer": "Heel Turn Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 99}, {"slug": "smash_bros", "bcp_id": "WZbaMtGhEr", "short_name": "Smash Bros", "name": "Smash Bros", "bcp_name": "Smash Bros", "manufacturer": "Nintendo", "icon": "🎲", "has_tracker": false, "popularity_rank": 100}, {"slug": "star_realms", "bcp_id": "SOuCmjcwce", "short_name": "Star Realms", "name": "Star Realms", "bcp_name": "Star Realms", "manufacturer": "White Wizard Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 101}, {"slug": "sw_armada", "bcp_id": "gRTgm28uhQ", "short_name": "SW Armada", "name": "Star Wars: Armada", "bcp_name": "Star Wars Armada", "manufacturer": "Fantasy Flight Games", "icon": "🚀", "has_tracker": false, "popularity_rank": 102}, {"slug": "star_wars_dest", "bcp_id": "NPyZIKwtCl", "short_name": "Star Wars Desti…", "name": "Star Wars Destiny", "bcp_name": "Star Wars Destiny", "manufacturer": "Fantasy Flight Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 103}, {"slug": "star_wars_unli", "bcp_id": "maCXHs5gaX", "short_name": "Star Wars Unlim…", "name": "Star Wars Unlimited - Casual", "bcp_name": "Star Wars Unlimited - Casual", "manufacturer": "Fantasy Flight Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 104}, {"slug": "star_wars_unli_2", "bcp_id": "kwl9ZSdevH", "short_name": "Star Wars Unlim…", "name": "Star Wars Unlimited : Twin Suns", "bcp_name": "Star Wars Unlimited : Twin Suns", "manufacturer": "Fantasy Flight Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 105}, {"slug": "starcraft_tabl", "bcp_id": "HqgiM2fMCAoN", "short_name": "StarCraft Table…", "name": "StarCraft Tabletop Miniatures Game", "bcp_name": "StarCraft Tabletop Miniatures Game", "manufacturer": "Archon Studio", "icon": "🎲", "has_tracker": false, "popularity_rank": 106}, {"slug": "steel_rift", "bcp_id": "Ur7ZvRF1wPWq", "short_name": "Steel Rift", "name": "Steel Rift", "bcp_name": "Steel Rift", "manufacturer": "Death Ray Designs", "icon": "🎲", "has_tracker": false, "popularity_rank": 107}, {"slug": "ninth_age", "bcp_id": "jnffUQYAK8", "short_name": "The 9th Age", "name": "The 9th Age", "bcp_name": "The 9th Age", "manufacturer": "The IX Age", "icon": "🛡️", "has_tracker": false, "popularity_rank": 108}, {"slug": "transformers", "bcp_id": "u2P27ZSURD", "short_name": "Transformers", "name": "Transformers", "bcp_name": "Transformers", "manufacturer": "Hasbro", "icon": "🎲", "has_tracker": false, "popularity_rank": 109}, {"slug": "universal_figh", "bcp_id": "JV0A6xP5qy", "short_name": "Universal  Figh…", "name": "Universal  Fighting  System", "bcp_name": "Universal  Fighting  System", "manufacturer": "Jasco Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 110}, {"slug": "universus_my_h", "bcp_id": "QzusTyUknx", "short_name": "Universus: My H…", "name": "Universus: My Hero Academia", "bcp_name": "Universus: My Hero Academia", "manufacturer": "Jasco Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 111}, {"slug": "vanguard_zero", "bcp_id": "VFHr8IArQ0", "short_name": "Vanguard Zero", "name": "Vanguard Zero", "bcp_name": "Vanguard Zero", "manufacturer": "Bushiroad", "icon": "🎴", "has_tracker": false, "popularity_rank": 112}, {"slug": "vibes", "bcp_id": "67b79ae8bf62de0597692833", "short_name": "Vibes", "name": "Vibes", "bcp_name": "Vibes", "manufacturer": "Orange Cap Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 113}, {"slug": "vs_system_2pcg", "bcp_id": "QQrdiF5Kz6", "short_name": "VS System 2PCG", "name": "VS System 2PCG", "bcp_name": "VS System 2PCG", "manufacturer": "Upper Deck", "icon": "🎲", "has_tracker": false, "popularity_rank": 114}, {"slug": "warcaster_neo_", "bcp_id": "vHcENvcLKL", "short_name": "Warcaster: Neo-…", "name": "Warcaster: Neo-Mechanika", "bcp_name": "Warcaster: Neo-Mechanika", "manufacturer": "Privateer Press", "icon": "🎲", "has_tracker": false, "popularity_rank": 115}, {"slug": "warlord_saga_o", "bcp_id": "lBoE1G9nbwVO", "short_name": "Warlord: Saga o…", "name": "Warlord: Saga of the Storm", "bcp_name": "Warlord: Saga of the Storm", "manufacturer": "KingsWood Games", "icon": "🎲", "has_tracker": false, "popularity_rank": 116}, {"slug": "warmaster", "bcp_id": "XBegtc4oDI", "short_name": "Warmaster", "name": "Warmaster Revolution", "bcp_name": "Warmaster Revolution", "manufacturer": "Games Workshop", "icon": "👑", "has_tracker": false, "popularity_rank": 117}, {"slug": "weiss_schwarz", "bcp_id": "dMEhR6bh0o", "short_name": "Weiss Schwarz", "name": "Weiss Schwarz", "bcp_name": "Weiss Schwarz", "manufacturer": "Bushiroad", "icon": "🎴", "has_tracker": false, "popularity_rank": 118}, {"slug": "wixoss", "bcp_id": "3fzaceXdNL", "short_name": "Wixoss", "name": "Wixoss", "bcp_name": "Wixoss", "manufacturer": "Takara Tomy", "icon": "🎲", "has_tracker": false, "popularity_rank": 119}, {"slug": "zenozard", "bcp_id": "LMFB6r3HEU", "short_name": "Zenozard", "name": "Zenozard", "bcp_name": "Zenozard", "manufacturer": "Bandai", "icon": "🎴", "has_tracker": false, "popularity_rank": 120}];

const GAME_SYSTEM_BY_SLUG = {};
const GAME_SYSTEM_BY_BCP_ID = {};
BCP_GAME_SYSTEMS_CATALOG.forEach(item => {
  GAME_SYSTEM_BY_SLUG[item.slug] = item;
  GAME_SYSTEM_BY_BCP_ID[item.bcp_id] = item;
  (item.legacy_bcp_ids || []).forEach(lid => {
    GAME_SYSTEM_BY_BCP_ID[lid] = item;
  });
});

const GAME_SYSTEM_ALIASES_MAP = {
  "40k": "40k",
  "wh40k": "40k",
  "warhammer_40k": "40k",
  "warhammer40k": "40k",
  "aos": "aos",
  "sigmar": "aos",
  "warhammer_aos": "aos",
  "age_of_sigmar": "aos",
  "tow": "the_old_world",
  "old_world": "the_old_world",
  "30k": "horus_heresy",
  "hh": "horus_heresy",
  "kt": "kill_team",
  "killteam": "kill_team",
  "mesbg": "middle_earth",
  "lotr": "middle_earth",
  "mcp": "mcp",
  "marvel_crisis": "mcp",
  "crisis_protocol": "mcp",
  "sw_legion": "sw_legion",
  "star_wars_legion": "sw_legion",
  "starwars_legion": "sw_legion",
  "swl": "sw_legion",
  "legion": "sw_legion",
  "pokemon_tcg": "pokemon",
  "ptcg": "pokemon",
  "one_piece_tcg": "one_piece",
  "onepiece": "one_piece",
  "optcg": "one_piece",
  "fab": "flesh_blood",
  "flesh_and_blood": "flesh_blood",
  "star_wars_unlimited": "sw_unlimited",
  "starwars_unlimited": "sw_unlimited",
  "swu": "sw_unlimited",
  "magic": "mtg",
  "magic_the_gathering": "mtg",
  "yu_gi_oh": "yugioh",
  "ygo": "yugioh",
  "digimon_tcg": "digimon",
  "disney_lorcana": "lorcana",
  "cedh": "commander",
  "edh": "commander",
  "riftbound": "riftbound",
  "riftbound_tcg": "riftbound",
  "guild_ball": "guild_ball",
  "guildball": "guild_ball"
};

const NON_BCP_PREFIXES = ["melee:", "ltcg:", "ls:", "td:", "nr:", "es_", "es-", "manual_", "test_"];

function isBcpEventId(eventId) {
  if (!eventId) return false;
  const s = String(eventId).trim().toLowerCase();
  if (!s) return false;
  return !NON_BCP_PREFIXES.some(p => s.startsWith(p));
}

function getEventPlatform(eventId, ev = null) {
  if (ev && ev.is_native_event) return "omnitactica";
  if (ev && ev.source_platform) {
    const sp = String(ev.source_platform).trim().toLowerCase();
    if (sp === "omnitactica" || sp === "eventstudio" || sp === "native") return "omnitactica";
    return sp;
  }
  const s = String(eventId || (ev && ev.id) || "").trim().toLowerCase();
  if (s.startsWith("melee:")) return "melee";
  if (s.startsWith("ltcg:")) return "limitless";
  if (s.startsWith("ls:")) return "longshanks";
  if (s.startsWith("td:")) return "topdeck";
  if (s.startsWith("es_") || s.startsWith("es-")) return "omnitactica";
  return "bcp";
}

function getPlatformDisplayName(platformOrEventId, ev = null) {
  const plat = ["bcp", "melee", "limitless", "longshanks", "topdeck", "eventstudio", "omnitactica"].includes(String(platformOrEventId || "").toLowerCase())
    ? String(platformOrEventId).toLowerCase()
    : getEventPlatform(platformOrEventId, ev);
  if (plat === "melee") return "Melee.gg";
  if (plat === "limitless") return "Limitless TCG";
  if (plat === "longshanks") return "Longshanks";
  if (plat === "topdeck") return "TopDeck.gg";
  if (plat === "omnitactica" || plat === "eventstudio") return "⚡ OmniTactica";
  return "BCP";
}

function getPlatformExternalEventUrl(eventId, ev = null) {
  if (ev && ev.event_url && String(ev.event_url).startsWith("http")) {
    return String(ev.event_url);
  }
  if (ev && ev.external_url && String(ev.external_url).startsWith("http") && String(eventId || (ev && ev.id) || "").includes(":")) {
    return String(ev.external_url);
  }
  const s = String(eventId || (ev && ev.id) || "").trim();
  if (!s) return "https://www.bestcoastpairings.com";
  const low = s.toLowerCase();
  if (low.startsWith("es-") || low.startsWith("es_") || (ev && (ev.is_native_event || ev.source_platform === "omnitactica"))) {
    return `/app?event=${encodeURIComponent(s)}#community`;
  }
  const extId = (ev && ev.external_event_id) ? String(ev.external_event_id).trim() : (s.includes(":") ? s.split(":", 2)[1] : s);
  if (low.startsWith("melee:")) return `https://melee.gg/Tournament/View/${encodeURIComponent(extId)}`;
  if (low.startsWith("ltcg:")) {
    const subPath = (ev && ev.is_started === false && !ev.is_ended) ? "details" : "standings";
    return `https://play.limitlesstcg.com/tournament/${encodeURIComponent(extId)}/${subPath}`;
  }
  if (low.startsWith("ls:")) return `https://www.longshanks.org/event/${encodeURIComponent(extId)}/`;
  if (low.startsWith("td:")) return `https://topdeck.gg/bracket/${encodeURIComponent(extId)}`;
  return `https://www.bestcoastpairings.com/event/${encodeURIComponent(s)}`;
}

function getPlatformBadgeHtml(platformOrEventId, ev = null) {
  const plat = getEventPlatform(platformOrEventId, ev);
  const label = getPlatformDisplayName(plat, ev);
  const styles = {
    bcp: "background:rgba(56,189,248,0.14); color:#38bdf8; border:1px solid rgba(56,189,248,0.32);",
    limitless: "background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.35);",
    longshanks: "background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.35);",
    topdeck: "background:rgba(168,85,247,0.16); color:#c084fc; border:1px solid rgba(168,85,247,0.38);",
    melee: "background:rgba(244,63,94,0.15); color:#fb7185; border:1px solid rgba(244,63,94,0.35);",
    omnitactica: "background:linear-gradient(135deg, rgba(6,182,212,0.22), rgba(99,102,241,0.22)); color:#67e8f9; border:1px solid rgba(6,182,212,0.48);",
    eventstudio: "background:linear-gradient(135deg, rgba(6,182,212,0.22), rgba(99,102,241,0.22)); color:#67e8f9; border:1px solid rgba(6,182,212,0.48);"
  };
  const st = styles[plat] || styles.bcp;
  return `<span class="badge" style="${st} font-size:0.64rem; font-weight:700; padding:1px 6px; border-radius:4px; white-space:nowrap;">${escapeHtml(label)}</span>`;
}

function getEventFormatBadgeHtml(ev) {
  if (!ev) return "";
  const isFfa = Boolean(ev.is_ffa_event || ev.match_format === "ffa");
  const isDoubles = Boolean(ev.is_doubles_event || ev.match_format === "2v2" || /\bdoubles\b|\b2\s*v\s*2\b/i.test(String(ev.name || ev.event_name || "")));
  const isTeam = Boolean(!isDoubles && (ev.is_team_event || (Number(ev.total_teams || 0) > 0)));
  if (isFfa) {
    return `<span class="badge" style="background:rgba(16,185,129,0.16); color:#34d399; border:1px solid rgba(16,185,129,0.36); font-size:0.64rem; font-weight:800; padding:1px 6px; border-radius:4px; white-space:nowrap;">🎲 4P FFA Pod</span>`;
  }
  if (isDoubles) {
    return `<span class="badge" style="background:rgba(168,85,247,0.16); color:#c084fc; border:1px solid rgba(168,85,247,0.38); font-size:0.64rem; font-weight:800; padding:1px 6px; border-radius:4px; white-space:nowrap;">👥 2v2 Doubles</span>`;
  }
  if (isTeam) {
    return `<span class="badge" style="background:rgba(99,102,241,0.16); color:#818cf8; border:1px solid rgba(99,102,241,0.35); font-size:0.64rem; font-weight:800; padding:1px 6px; border-radius:4px; white-space:nowrap;">🛡️ Team</span>`;
  }
  return "";
}

function buildMatchOpponentCellHtml(r, evId = "", evName = "", oppBadgeHtml = "") {
  if (!r) return "-";
  const isBye = Boolean(r.is_bye || r.result === "BYE" || (r.opponent_name && String(r.opponent_name).toUpperCase() === "BYE"));
  if (isBye) {
    return '<span class="bye-pill">🛡️ TOURNAMENT BYE</span>';
  }
  const is2v2 = Boolean(r.is_2v2 || r.match_format === "2v2" || r.partner_id || r.partner_name || (r.partner && (r.partner.player_id || r.partner.player_name)));
  const rawOppsList = (Array.isArray(r.opponents) && r.opponents.length > 0)
    ? r.opponents
    : (Array.isArray(r.pod_opponents) && r.pod_opponents.length > 0 ? r.pod_opponents : []);
  const isFfa = Boolean(r.is_ffa || r.match_format === "ffa" || (rawOppsList.length >= 2 && !is2v2));
  const oppId = r.opponent_id || "";
  const oppName = r.opponent_name || "Opponent";
  const oppFac = r.opponent_faction || "";

  if (is2v2) {
    const partnerObj = r.partner || ((r.partner_id || r.partner_name) ? { player_id: r.partner_id, player_name: r.partner_name, faction: r.partner_faction } : null);
    const pName = partnerObj ? (partnerObj.player_name || partnerObj.name || "") : "";
    const pId = partnerObj ? (partnerObj.player_id || partnerObj.id || "") : "";
    const pFac = partnerObj ? (partnerObj.faction || "") : "";
    const partnerHtml = pName ? `
      <div style="font-size:0.71rem; color:#c084fc; display:flex; align-items:center; gap:0.3rem; flex-wrap:wrap; margin-bottom:2px;">
        <span class="badge" style="background:rgba(168,85,247,0.18); color:#c084fc; border:1px solid rgba(168,85,247,0.38); font-size:0.62rem; font-weight:800; padding:0px 5px;">👥 2v2</span>
        <span>🤝 w/</span>
        <span class="player-link" style="font-weight:700; color:#e9d5ff; cursor:pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeJsArg(pId)}', '${escapeJsArg(pName)}')">${escapeHtml(pName)}</span>
        ${pFac && pFac !== "Unknown" ? `<span style="color:var(--text-muted);">(${escapeHtml(pFac)})</span>` : ""}
      </div>
    ` : `
      <div style="margin-bottom:2px;">
        <span class="badge" style="background:rgba(168,85,247,0.18); color:#c084fc; border:1px solid rgba(168,85,247,0.38); font-size:0.62rem; font-weight:800; padding:0px 5px;">👥 2v2 Doubles</span>
      </div>
    `;

    const opps = rawOppsList.length > 0
      ? rawOppsList
      : [{ player_id: oppId, player_name: oppName, faction: oppFac }];
    const oppLinksHtml = opps.map(op => {
      const oid = op.player_id || op.id || "";
      const oname = op.player_name || op.name || "Opponent";
      return `<span class="player-link" style="font-weight:600; color:#38bdf8; cursor:pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeJsArg(oid)}', '${escapeJsArg(oname)}')" title="Quick scout ${escapeHtml(oname)}">${escapeHtml(oname)}</span>`;
    }).join('<span style="color:var(--text-muted); margin:0 4px;">&amp;</span>');

    const oppFacs = opps.map(op => op.faction).filter(f => f && f !== "Unknown");
    const facLine = oppFacs.length > 0 ? oppFacs.join(" / ") : oppFac;

    return `
      ${partnerHtml}
      <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
        <span style="font-size:0.7rem; color:var(--text-muted); font-weight:700;">vs</span>
        ${oppLinksHtml}
        ${oppBadgeHtml}
      </div>
      <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap; margin-top:2px;">
        ${facLine ? `<span style="font-size:0.72rem; color:var(--text-muted);">${escapeHtml(facLine)}</span>` : ""}
        ${evId ? `
          <button type="button" class="journey-action-pill journey-roster-pill-sm" onclick="event.stopPropagation(); openJourneyPlayerRosterModal('${escapeJsArg(evId)}', '${escapeJsArg(oppId)}', '${escapeJsArg(oppName)}', '${escapeJsArg(facLine)}', '${escapeJsArg(evName)}')" title="View opposing duo roster">
            📋 Roster
          </button>
        ` : ""}
      </div>
    `;
  }

  if (isFfa) {
    const podSize = Number(r.pod_size || (rawOppsList.length ? rawOppsList.length + 1 : 4)) || 4;
    const placeNum = Number(r.pod_placement || (r.result === "W" ? 1 : 0));
    const placeBadge = r.result === "W"
      ? `<span class="badge" style="background:rgba(34,197,94,0.18); color:#4ade80; border:1px solid rgba(34,197,94,0.38); font-size:0.62rem; font-weight:800; padding:0px 5px;">🏆 1st / ${podSize}</span>`
      : (r.result === "D"
        ? `<span class="badge" style="background:rgba(245,158,11,0.18); color:#fbbf24; border:1px solid rgba(245,158,11,0.38); font-size:0.62rem; font-weight:800; padding:0px 5px;">🤝 Pod Draw (${podSize}P)</span>`
        : `<span class="badge" style="background:rgba(148,163,184,0.14); color:#cbd5e1; border:1px solid rgba(148,163,184,0.28); font-size:0.62rem; font-weight:700; padding:0px 5px;">Seat #${placeNum || "-"} / ${podSize}</span>`);

    const opps = rawOppsList;
    const oppItemsHtml = opps.map(op => {
      const oid = op.player_id || op.id || "";
      const oname = op.player_name || op.name || "Pod Opponent";
      const ofac = (op.faction && op.faction !== "Unknown" && !String(op.faction).startsWith("Pod (")) ? op.faction : "";
      const isPodWinner = Boolean(op.is_winner || op.result === "W" || Number(op.placement) === 1);
      return `
        <span style="display:inline-flex; align-items:center; gap:3px; background:rgba(255,255,255,0.04); border:1px solid ${isPodWinner ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.08)"}; border-radius:4px; padding:1px 6px; font-size:0.72rem;">
          ${isPodWinner ? '<span title="Pod Winner">👑</span>' : ""}
          <span class="player-link" style="font-weight:600; color:${isPodWinner ? "#fbbf24" : "#38bdf8"}; cursor:pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeJsArg(oid)}', '${escapeJsArg(oname)}')">${escapeHtml(oname)}</span>
          ${ofac ? `<span style="font-size:0.65rem; color:var(--text-muted);">(${escapeHtml(ofac)})</span>` : ""}
        </span>
      `;
    }).join("");

    return `
      <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap; margin-bottom:3px;">
        <span class="badge" style="background:rgba(16,185,129,0.16); color:#34d399; border:1px solid rgba(16,185,129,0.35); font-size:0.62rem; font-weight:800; padding:0px 5px;">🎲 ${podSize}P Pod</span>
        ${placeBadge}
        ${oppBadgeHtml}
      </div>
      <div style="display:flex; align-items:center; gap:0.3rem; flex-wrap:wrap;">
        ${oppItemsHtml || `<span style="font-size:0.78rem; color:#38bdf8;">${escapeHtml(oppName)}</span>`}
      </div>
    `;
  }

  return `
    <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
      <span class="player-link" style="font-weight: 600; color: #38bdf8; cursor: pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeJsArg(oppId)}', '${escapeJsArg(oppName)}')" title="Quick scout ${escapeHtml(oppName)}">${escapeHtml(oppName)}</span>
      ${oppBadgeHtml}
    </div>
    <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-top: 2px;">
      ${oppFac ? `<span style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(oppFac)}</span>` : ""}
      ${evId ? `
        <button type="button" class="journey-action-pill journey-roster-pill-sm" onclick="event.stopPropagation(); openJourneyPlayerRosterModal('${escapeJsArg(evId)}', '${escapeJsArg(oppId)}', '${escapeJsArg(oppName)}', '${escapeJsArg(oppFac)}', '${escapeJsArg(evName)}')" title="View ${escapeHtml(oppName)}'s army roster">
          📋 Roster
        </button>
      ` : ""}
    </div>
  `;
}

function normalizeGameSystem(val, defaultSys = "40k") {
  if (!val) return defaultSys;
  const raw = String(val).trim();
  if (!raw) return defaultSys;
  if (GAME_SYSTEM_BY_BCP_ID[raw]) return GAME_SYSTEM_BY_BCP_ID[raw].slug;
  const low = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (GAME_SYSTEM_BY_SLUG[low]) return low;
  if (GAME_SYSTEM_ALIASES_MAP[low]) return GAME_SYSTEM_ALIASES_MAP[low];
  return defaultSys;
}

function getGameSystemMeta(sys) {
  const slug = normalizeGameSystem(sys || (typeof window !== "undefined" && window.currentGameSystem) || "40k");
  return GAME_SYSTEM_BY_SLUG[slug] || GAME_SYSTEM_BY_SLUG["40k"];
}

function getGameSystemLabel(sys) {
  const meta = getGameSystemMeta(sys);
  if (meta.slug === "40k") return "Warhammer 40K";
  if (meta.slug === "aos") return "Age of Sigmar";
  return meta.name || "Warhammer 40K";
}

function getGameSystemShortLabel(sys) {
  const meta = getGameSystemMeta(sys);
  return meta.short_label || meta.short_name || meta.name || "40K";
}

function getGameSystemIcon(sys) {
  const meta = getGameSystemMeta(sys);
  return meta.icon || "⚔️";
}

function hasGameTracker(sys) {
  const slug = normalizeGameSystem(sys || (typeof window !== "undefined" && window.currentGameSystem) || "40k");
  return Boolean(GAME_SYSTEM_BY_SLUG[slug] && GAME_SYSTEM_BY_SLUG[slug].has_tracker);
}

if (typeof window !== "undefined") {
  window.BCP_GAME_SYSTEMS_CATALOG = BCP_GAME_SYSTEMS_CATALOG;
  window.GAME_SYSTEM_BY_SLUG = GAME_SYSTEM_BY_SLUG;
  window.GAME_SYSTEM_BY_BCP_ID = GAME_SYSTEM_BY_BCP_ID;
  window.normalizeGameSystem = normalizeGameSystem;
  window.getGameSystemMeta = getGameSystemMeta;
  window.getGameSystemLabel = getGameSystemLabel;
  window.getGameSystemShortLabel = getGameSystemShortLabel;
  window.getGameSystemIcon = getGameSystemIcon;
  window.hasGameTracker = hasGameTracker;
  window.isBcpEventId = isBcpEventId;
  window.getEventPlatform = getEventPlatform;
  window.getPlatformDisplayName = getPlatformDisplayName;
  window.getPlatformExternalEventUrl = getPlatformExternalEventUrl;
  window.getPlatformBadgeHtml = getPlatformBadgeHtml;
  window.getEventFormatBadgeHtml = getEventFormatBadgeHtml;
  window.buildMatchOpponentCellHtml = buildMatchOpponentCellHtml;
}
