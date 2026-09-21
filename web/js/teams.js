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
  const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';

  // Instant in-memory cache check
  const dirCacheKey = `teams_dir_${sys}_${query}_${minRoster}_${teamsSortState.field}_${teamsSortState.asc}_${teamsPagination.page}_${teamsPagination.pageSize}`;
  window._teamsDirCache = window._teamsDirCache || {};
  const cachedDir = window._teamsDirCache[dirCacheKey];
  if (cachedDir && (Date.now() - cachedDir.time < 300000)) { // 5-minute cache
    const res = cachedDir.data;
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
    return;
  }

  if (tbody && (!teamsDirectoryData || teamsDirectoryData.length === 0)) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading teams directory...</div></td></tr>';
  }

  try {
    const res = await window.api.getTeamsDirectory(
      query, minRoster, teamsSortState.field, teamsSortState.asc ? 'ASC' : 'DESC',
      teamsPagination.page, teamsPagination.pageSize
    );
    window._teamsDirCache[dirCacheKey] = { data: res, time: Date.now() };
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

/* ==========================================================================
   DEDICATED PUBLIC TEAM PROFILE PAGE
   ========================================================================== */

let currentProfileTeamName = null;
let currentProfileTeamData = null;
let previousTabBeforeTeamProfile = 'leaderboard';
let currentTeamProfileSubtab = 'overview';
let currentTeamProfileRosterStatus = 'all';

function getCleanPreviousTab(tab) {
  if (!tab) return 'leaderboard';
  const clean = String(tab).trim().toLowerCase().replace(/^(?:40k|aos)\//, '').replace(/^#\/?(?:40k|aos)\//, '').replace(/^#\/?/, '');
  if (clean.includes('search')) return 'search';
  if (clean.includes('leaderboard')) return 'leaderboard';
  if (clean.includes('community')) return 'community';
  if (clean.includes('my-hub') || clean.includes('hub')) return 'my-hub';
  if (clean.includes('meta')) return 'meta-intel';
  if (clean.includes('player')) return 'player-profile';
  if (clean.includes('event')) return 'event-hub';
  return 'leaderboard';
}

function formatPreviousTabName(tab) {
  const t = getCleanPreviousTab(tab);
  if (t === 'search') return 'Directory';
  if (t === 'leaderboard') return 'Leaderboard';
  if (t === 'community') return 'Tournaments';
  if (t === 'my-hub') return 'My Hub';
  if (t === 'meta-intel') return 'Meta Intel';
  if (t === 'player-profile') return 'Player Profile';
  if (t === 'event-hub') return 'Event Hub';
  return 'Leaderboard';
}

function navigateBackFromTeamProfile() {
  const target = getCleanPreviousTab(previousTabBeforeTeamProfile);
  if (typeof switchTab === 'function') {
    switchTab(target);
  }
}

/**
 * Open the dedicated, full-screen team profile page
 */
async function openTeamProfilePage(teamName, gameSystem = '', options = {}) {
  if (!teamName) return;

  const safeName = String(teamName).trim();
  const targetSys = (gameSystem || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).toLowerCase();
  if (typeof currentGameSystem !== 'undefined' && targetSys !== currentGameSystem) {
    if (typeof applyGameSystem === 'function') {
      applyGameSystem(targetSys, false);
    }
  }

  // Remember previous tab to return cleanly on back navigation
  if (typeof activeTab !== 'undefined' && activeTab !== 'team-profile') {
    previousTabBeforeTeamProfile = activeTab;
  }

  currentProfileTeamName = safeName;

  // Switch view to team-profile tab
  if (typeof switchTab === 'function') {
    switchTab('team-profile');
  } else {
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.remove('active');
      p.style.removeProperty('display');
    });
    const panel = document.getElementById('tab-team-profile');
    if (panel) {
      panel.style.removeProperty('display');
      panel.classList.add('active');
    }
  }
  const teamPanel = document.getElementById('tab-team-profile');
  if (teamPanel) {
    teamPanel.style.removeProperty('display');
    teamPanel.classList.add('active');
  }

  // Update URL hash
  const cleanPath = (targetSys === 'aos') ? '/aos' : '';
  const targetHash = `#/${targetSys}/team/${encodeURIComponent(safeName)}`;
  if (window.history && window.history.pushState && !options.replaceUrl) {
    window.history.pushState({ teamName: safeName, sys: targetSys }, '', `${cleanPath || ''}${targetHash}`);
  } else if (window.history && window.history.replaceState) {
    window.history.replaceState({ teamName: safeName, sys: targetSys }, '', `${cleanPath || ''}${targetHash}`);
  }

  // Instant in-memory cache check
  const dossierCacheKey = `team_dossier_${targetSys}_${safeName.toLowerCase()}`;
  window._teamDossierCache = window._teamDossierCache || {};
  const cachedDossier = window._teamDossierCache[dossierCacheKey];
  if (cachedDossier && (Date.now() - cachedDossier.time < 600000)) { // 10 min cache
    currentProfileTeamData = cachedDossier.data;
    renderTeamProfilePage(cachedDossier.data, targetSys);
    return;
  }

  const container = document.getElementById('team-profile-container');
  if (container) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 4rem 1rem;">
        <div class="spinner"></div>
        <div style="margin-top: 1rem; font-weight: 600; color: var(--text-secondary);">Loading club dossier for ${escapeHtml(safeName)}...</div>
      </div>
    `;
  }

  try {
    const data = await window.api.getTeamRoster(safeName, targetSys);
    window._teamDossierCache[dossierCacheKey] = { data: data, time: Date.now() };
    currentProfileTeamData = data;
    renderTeamProfilePage(data, targetSys);
  } catch (err) {
    if (container) {
      container.innerHTML = `
        <div class="profile-hero-card" style="text-align: center; padding: 3rem 1.5rem;">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🛡️</div>
          <h2 style="font-size: 1.4rem; font-weight: 800; color: #fff; margin-bottom: 0.5rem;">Club Not Found</h2>
          <p style="color: var(--text-secondary); max-width: 500px; margin: 0 auto 1.5rem;">
            Unable to load roster records for "${escapeHtml(safeName)}" under ${targetSys.toUpperCase()}.
          </p>
          <button type="button" class="btn btn-primary" onclick="navigateBackFromTeamProfile()">
            ← Return to ${formatPreviousTabName(previousTabBeforeTeamProfile)}
          </button>
        </div>
      `;
    }
  }
}

function renderTeamProfilePage(data, sys) {
  const container = document.getElementById('team-profile-container');
  if (!container) return;

  const teamName = data.team || currentProfileTeamName || 'Club Profile';
  const stats = data.stats || {};
  const roster = Array.isArray(data.roster) ? data.roster : [];
  const feed = Array.isArray(data.battlefield_feed) ? data.battlefield_feed : [];

  // Starting 5 MUST strictly only include ACTIVE competitors carrying the club banner!
  const activeRoster = roster.filter(p => p.is_active === true || p.is_active === 'true' || p.is_active === 1)
    .sort((a, b) => Number(b.current_elo || 1500) - Number(a.current_elo || 1500));
  const candidateStarting5 = (Array.isArray(data.starting_5) && data.starting_5.length > 0)
    ? data.starting_5.filter(p => p.is_active !== false && p.is_active !== 'false' && p.is_active !== 0)
    : [];
  const starting5 = (candidateStarting5.length >= 5 || (activeRoster.length < 5 && candidateStarting5.length > 0))
    ? candidateStarting5.slice(0, 5)
    : (activeRoster.length > 0 ? activeRoster.slice(0, 5) : roster.slice(0, 5));

  const activeCount = stats.active_roster_count != null ? stats.active_roster_count : roster.length;
  const totalCount = stats.roster_count || roster.length;
  const powerRating = stats.power_rating || 0;
  const top5Avg = stats.top5_avg_elo || stats.top5_avg || 1500;
  const winRate = stats.win_rate != null ? stats.win_rate : (stats.total_matches > 0 ? ((stats.total_wins / stats.total_matches) * 100).toFixed(1) : 0);
  const matches = stats.total_matches || 0;
  const wins = stats.total_wins || 0;
  const losses = stats.total_losses || 0;
  const draws = stats.total_draws || 0;
  const isAos = sys === 'aos';
  const systemLabel = isAos ? '⚡ Age of Sigmar' : '⚔️ Warhammer 40,000';
  const tierName = isAos ? '💠 LORD-CELESTANT' : '🔥 HIGH WARLORD';
  const championships = data.championships || { total: 0, items: [], top_champions: [], factions_distribution: [] };
  const champCount = championships.total || (Array.isArray(championships.items) ? championships.items.length : 0);

  const formattedMatchCount = matches >= 1000 ? (matches / 1000).toFixed(1) + 'k' : (matches > 0 ? matches : feed.length);

  container.innerHTML = `
    <!-- Cohesive Hero Card -->
    <div class="profile-hero-card team-hero-card" style="margin-bottom: 1.25rem;">
      <div class="profile-hero-top team-hero-top">
        <div class="profile-identity-group team-hero-identity">
          <div class="profile-rank-crest team-rank-crest" style="background: rgba(15, 23, 42, 0.95); border: 2px solid ${isAos ? 'rgba(245, 158, 11, 0.45)' : 'rgba(56, 189, 248, 0.45)'}; box-shadow: 0 0 20px ${isAos ? 'rgba(245, 158, 11, 0.2)' : 'rgba(56, 189, 248, 0.2)'};">
            <span>🛡️</span>
          </div>
          <div class="profile-name-meta">
            <div class="profile-badges-row" style="margin-bottom: 0.35rem;">
              <span class="badge" style="background: ${isAos ? 'rgba(245, 158, 11, 0.16)' : 'rgba(56, 189, 248, 0.15)'}; color: ${isAos ? '#fbbf24' : '#38bdf8'}; border: 1px solid ${isAos ? 'rgba(245, 158, 11, 0.35)' : 'rgba(56, 189, 248, 0.35)'}; font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">
                ${systemLabel}
              </span>
              <span class="badge" style="background: rgba(168, 85, 247, 0.14); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); font-size: 0.72rem; font-weight: 700;">
                OFFICIAL CLUB
              </span>
            </div>
            <h1 class="profile-name-title" style="font-size: 1.6rem; margin: 0 0 0.35rem 0;">${escapeHtml(teamName)}</h1>
            <div class="profile-badges-row" style="font-size: 0.84rem; color: var(--text-secondary); gap: 0.6rem;">
              <span>👥 <strong style="color: #10b981;">${activeCount} Active Competitors</strong></span>
              <span>•</span>
              <span style="color: var(--text-muted);">${totalCount} Total Registered</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 4 Native KPI Cards (Number-first, uncluttered, fits all screens) -->
      <div class="profile-kpi-grid team-kpi-grid" style="margin-top: 1.25rem;">
        <div class="profile-kpi-card team-kpi-card-pr">
          <div class="profile-kpi-label" style="display: flex; align-items: center; justify-content: space-between;">
            <span>🛡️ Power Rating</span>
            <button class="info-circle-btn" onclick="openPowerRatingInfoModal(event)" title="How Team Power Rating is computed" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 0.82rem; padding: 0;">ⓘ</button>
          </div>
          <div class="profile-kpi-value" style="margin-top: 0.2rem;">
            <span style="font-family: var(--font-mono); font-size: 1.35rem; font-weight: 800; color: var(--accent);">${Number(powerRating).toFixed(1)}</span>
          </div>
          <div class="profile-kpi-sub">${isAos ? '💠 Lord-Celestant' : '🔥 High Warlord'} · Verified</div>
        </div>

        <div class="profile-kpi-card team-kpi-card-top5">
          <div class="profile-kpi-label">⭐ Starting 5 Avg</div>
          <div class="profile-kpi-value" style="margin-top: 0.2rem;">
            <span style="font-family: var(--font-mono); font-size: 1.35rem; font-weight: 800; color: #facc15;">${Number(top5Avg).toFixed(1)}</span>
          </div>
          <div class="profile-kpi-sub">Top 5 Anchor Average</div>
        </div>

        <div class="profile-kpi-card team-kpi-card-record">
          <div class="profile-kpi-label">⚔️ Sanctioned Record</div>
          <div class="profile-kpi-value profile-kpi-value-record" style="font-family: var(--font-mono); font-size: 1.05rem; font-weight: 800; margin-top: 0.25rem; white-space: nowrap;">
            <span style="color: var(--win);">${wins.toLocaleString()}W</span> - <span style="color: var(--loss);">${losses.toLocaleString()}L</span>
          </div>
          <div class="profile-kpi-sub">${matches.toLocaleString()} Sanctioned Games</div>
        </div>

        <div class="profile-kpi-card team-kpi-card-winrate">
          <div class="profile-kpi-label">🏆 Club Win Rate</div>
          <div class="profile-kpi-value" style="font-family: var(--font-mono); font-size: 1.35rem; font-weight: 800; color: ${Number(winRate) >= 55 ? 'var(--win)' : (Number(winRate) >= 45 ? 'var(--accent)' : '#fff')}; margin-top: 0.2rem;">
            ${Number(winRate).toFixed(1)}%
          </div>
          <div class="profile-kpi-sub">Combat Factor: ${stats.combat_factor ? Number(stats.combat_factor).toFixed(2) + 'x' : '1.00x'}</div>
        </div>
      </div>
    </div>

    <!-- Symmetrical 4-Column Subtabs Bar (Single clean row on mobile & desktop) -->
    <div class="profile-subtabs-bar team-profile-subtabs-bar" style="margin-bottom: 1.25rem;">
      <button type="button" class="profile-subtab-btn ${currentTeamProfileSubtab === 'overview' ? 'active' : ''}" onclick="switchTeamProfileSubtab('overview')" id="team-subtab-btn-overview">
        <span>🛡️ <span class="tab-label-full">Club Overview</span><span class="tab-label-mobile">Overview</span></span>
      </button>
      <button type="button" class="profile-subtab-btn ${currentTeamProfileSubtab === 'roster' ? 'active' : ''}" onclick="switchTeamProfileSubtab('roster')" id="team-subtab-btn-roster">
        <span>👥 <span class="tab-label-full">Squad Roster</span><span class="tab-label-mobile">Roster</span></span>
        <span class="profile-subtab-count">${roster.length}</span>
      </button>
      <button type="button" class="profile-subtab-btn ${currentTeamProfileSubtab === 'trophies' ? 'active' : ''}" onclick="switchTeamProfileSubtab('trophies')" id="team-subtab-btn-trophies">
        <span>🏆 <span class="tab-label-full">Hall of Champions</span><span class="tab-label-mobile">Titles</span></span>
        <span class="profile-subtab-count">${champCount}</span>
      </button>
      <button type="button" class="profile-subtab-btn ${currentTeamProfileSubtab === 'matches' ? 'active' : ''}" onclick="switchTeamProfileSubtab('matches')" id="team-subtab-btn-matches">
        <span>⚔️ <span class="tab-label-full">Tournament Ledger</span><span class="tab-label-mobile">Ledger</span></span>
        <span class="profile-subtab-count">${formattedMatchCount}</span>
      </button>
    </div>

    <!-- Subtab 1: Overview Panel -->
    <div id="team-panel-overview" class="profile-tab-panel ${currentTeamProfileSubtab === 'overview' ? 'active' : ''}">
      <!-- Starting 5 Core Anchors Showcase -->
      <div class="profile-hero-card" style="padding: 1.25rem; margin-bottom: 1.25rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 0; display: flex; align-items: center; gap: 0.5rem;">
              <span>⭐</span>
              <span>The Starting 5 (Club Anchors)</span>
            </h3>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.2rem;">
              The top 5 active competitors carrying the club's banner into major tournament competition.
            </div>
          </div>
          <button type="button" class="btn btn-outline btn-sm" onclick="switchTeamProfileSubtab('roster')" style="font-size: 0.76rem; font-weight: 700; padding: 0.35rem 0.75rem;">
            View Full Roster (${roster.length}) →
          </button>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.75rem;">
          ${renderStarting5Cards(starting5, sys)}
        </div>
      </div>

      <!-- Power Rating Calibration & Maturity -->
      <div class="profile-hero-card" style="padding: 1.25rem; margin-bottom: 0;">
        <h4 style="font-size: 0.95rem; font-weight: 700; color: #fff; margin: 0 0 0.85rem 0; display: flex; align-items: center; gap: 0.45rem;">
          <span>⚖️</span>
          <span>Power Rating Calibration & Maturity Curve</span>
        </h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; font-size: 0.82rem;">
          <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.85rem 1rem;">
            <div style="color: var(--text-secondary); font-size: 0.72rem; font-weight: 700; text-transform: uppercase; margin-bottom: 0.25rem;">Skill Baseline (Weighted)</div>
            <div style="font-size: 1.15rem; font-weight: 800; color: var(--accent); font-family: var(--font-mono);">${stats.skill_baseline ? Number(stats.skill_baseline).toFixed(1) : (stats.top5_avg_elo ? Number(stats.top5_avg_elo).toFixed(1) : '-')}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.2rem;">40% Top 5 Core + 40% Active + 20% Top Ace</div>
          </div>
          <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.85rem 1rem;">
            <div style="color: var(--text-secondary); font-size: 0.72rem; font-weight: 700; text-transform: uppercase; margin-bottom: 0.25rem;">Active Roster Maturity</div>
            <div style="font-size: 1.15rem; font-weight: 800; color: #fff; font-family: var(--font-mono);">${activeCount >= 30 ? '100% (30+ Full Cap)' : Math.min(100, Math.round((activeCount / 30) * 100)) + '%'}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.2rem;">${activeCount} competitors active in last 180 days</div>
          </div>
          <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.85rem 1rem;">
            <div style="color: var(--text-secondary); font-size: 0.72rem; font-weight: 700; text-transform: uppercase; margin-bottom: 0.25rem;">Combat Record Factor</div>
            <div style="font-size: 1.15rem; font-weight: 800; color: #10b981; font-family: var(--font-mono);">${stats.combat_factor ? Number(stats.combat_factor).toFixed(3) + 'x' : '1.000x'}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.2rem;">Performance multiplier based on win rate</div>
          </div>
          <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.85rem 1rem;">
            <div style="color: var(--text-secondary); font-size: 0.72rem; font-weight: 700; text-transform: uppercase; margin-bottom: 0.25rem;">Sovereign Club Rating</div>
            <div style="font-size: 1.15rem; font-weight: 800; color: #fff; font-family: var(--font-mono);">${Number(powerRating).toFixed(1)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.2rem;">Official leaderboard sorting metric</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Subtab 2: Full Roster Panel -->
    <div id="team-panel-roster" class="profile-tab-panel ${currentTeamProfileSubtab === 'roster' ? 'active' : ''}">
      <div class="profile-hero-card" style="padding: 1.25rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem;">
          <div>
            <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 0;">Squad Roster Ladder</h3>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.2rem;">
              <strong style="color: #10b981;">${activeCount} Active</strong> • <strong style="color: #fbbf24;">${totalCount - activeCount} Inactive</strong> • ${totalCount} Registered Competitors
            </div>
          </div>
          <div class="team-roster-controls" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <div class="team-roster-status-tabs" style="display: inline-flex; background: rgba(0,0,0,0.35); border-radius: 6px; padding: 2px; border: 1px solid rgba(255,255,255,0.08);">
              <button type="button" class="team-status-tab-btn ${currentTeamProfileRosterStatus === 'all' ? 'active' : ''}" onclick="setTeamProfileRosterStatus('all')" id="team-roster-filter-all">
                All (${totalCount})
              </button>
              <button type="button" class="team-status-tab-btn ${currentTeamProfileRosterStatus === 'active' ? 'active' : ''}" onclick="setTeamProfileRosterStatus('active')" id="team-roster-filter-active">
                Active (${activeCount})
              </button>
              <button type="button" class="team-status-tab-btn ${currentTeamProfileRosterStatus === 'inactive' ? 'active' : ''}" onclick="setTeamProfileRosterStatus('inactive')" id="team-roster-filter-inactive">
                Inactive (${totalCount - activeCount})
              </button>
            </div>
            <div class="team-roster-filter-container" style="display: flex; align-items: center; gap: 0.5rem; width: 100%; max-width: 220px;">
              <input type="text" id="team-roster-filter-input" placeholder="Search members or factions..." oninput="filterTeamProfileRoster(this.value)" style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 0.45rem 0.8rem; border-radius: 6px; font-size: 0.8rem; width: 100%;" />
            </div>
          </div>
        </div>

        <!-- Desktop View Table (> 768px) -->
        <div class="table-container desktop-only" style="max-height: 600px; overflow-y: auto;">
          <table class="table" style="width: 100%;">
            <thead>
              <tr>
                <th style="width: 45px; text-align: center;">#</th>
                <th>Competitor</th>
                <th>Elo Rating</th>
                <th>Status</th>
                <th>Primary Faction</th>
                <th>Matches</th>
                <th>Win Rate</th>
              </tr>
            </thead>
            <tbody id="team-profile-roster-tbody">
              ${renderTeamProfileRosterRows(roster, sys)}
            </tbody>
          </table>
        </div>

        <!-- Mobile View Competitor Cards (<= 768px) -->
        <div id="team-profile-mobile-roster" class="mobile-only" style="display: flex; flex-direction: column; gap: 0.5rem;">
          ${renderMobileRosterCards(roster, sys)}
        </div>
      </div>
    </div>

    <!-- Subtab 3: Consolidated Hall of Champions Panel -->
    <div id="team-panel-trophies" class="profile-tab-panel ${currentTeamProfileSubtab === 'trophies' ? 'active' : ''}">
      ${renderTeamTrophiesPanel(data, sys)}
    </div>

    <!-- Subtab 4: Battlefield Matches Panel -->
    <div id="team-panel-matches" class="profile-tab-panel ${currentTeamProfileSubtab === 'matches' ? 'active' : ''}">
      <div class="profile-hero-card" style="padding: 1.25rem;">
        <div style="margin-bottom: 1rem;">
          <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 0; display: flex; align-items: center; gap: 0.5rem;">
            <span>⚔️</span>
            <span>Tournament Battle Ledger</span>
          </h3>
          <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 0.2rem;">
            Sanctioned match outcomes and round results for ${escapeHtml(teamName)} competitors.
            <span style="color: var(--accent); font-weight: 600;">(Showing ${feed.length} verified tournament matches of ${matches > 0 ? matches.toLocaleString() : feed.length} total club games)</span>
          </div>
          <div style="margin-top: 0.75rem;">
            <input type="text" id="team-matches-filter-input" class="form-control" placeholder="Search matches by competitor, opponent, tournament, or faction..." oninput="filterTeamBattleLedger(this.value)" style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0.45rem 0.85rem; font-size: 0.8rem; color: #fff; width: 100%; max-width: 460px;">
          </div>
        </div>

        <!-- Desktop View Table (> 768px) -->
        <div class="desktop-only">
          ${renderTeamBattleLedger(feed)}
        </div>

        <!-- Mobile View Clean Match Cards (<= 768px) -->
        <div class="mobile-only" style="display: flex; flex-direction: column; gap: 0.5rem;">
          ${renderMobileMatchesCards(feed)}
        </div>
      </div>
    </div>
  `;
}

function renderStarting5Cards(players, sys) {
  if (!players || players.length === 0) {
    return `<div style="grid-column: 1 / -1; padding: 1.5rem; text-align: center; color: var(--text-muted);">No core anchor records available.</div>`;
  }
  return players.map((p, idx) => {
    const safeName = p.player_name || p.full_name || 'Competitor';
    const cleanJsName = String(safeName).replace(/'/g, "\\'");
    const elo = Number(p.current_elo || 1500);
    const badgeHtml = (typeof renderEloBadgePill === 'function')
      ? renderEloBadgePill(elo, Number(p.matches_played || 10), { showTierName: false, size: 'sm', gameSystem: sys })
      : `<span style="font-family: var(--font-mono); font-weight: 700; color: var(--accent);">${elo.toFixed(1)}</span>`;
    const faction = p.top_faction || p.faction || 'Unassigned';
    const cleanFaction = faction.split(',')[0].trim();
    const rankLabel = idx === 0 ? '👑 Top Ace' : `#${idx + 1} Anchor`;

    return `
      <div class="profile-spotlight-card" style="cursor: pointer; transition: transform 0.15s ease, border-color 0.15s ease;" onclick="openPlayerModal('${escapeHtml(p.player_id || '')}', '${cleanJsName}')" onmouseover="this.style.borderColor='rgba(56,189,248,0.5)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.08)'" title="Scout ${escapeHtml(safeName)}">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
          <span style="font-size: 0.68rem; font-weight: 800; color: ${idx === 0 ? '#f59e0b' : '#94a3b8'}; text-transform: uppercase;">${rankLabel}</span>
          ${badgeHtml}
        </div>
        <div style="font-size: 0.95rem; font-weight: 700; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(safeName)}
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 0.4rem; font-size: 0.74rem; color: var(--text-secondary); gap: 0.5rem;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">🛡️ ${escapeHtml(cleanFaction)}</span>
          <span style="font-family: var(--font-mono); font-weight: 600; color: ${Number(p.win_rate || 0) >= 55 ? 'var(--win)' : '#94a3b8'}; flex-shrink: 0;">${Number(p.win_rate || 0).toFixed(0)}% WR</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderTeamProfileRosterRows(roster, sys, statusFilter = null) {
  if (!roster || roster.length === 0) {
    return '<tr><td colspan="7" class="empty-state">No competitor records registered under this club.</td></tr>';
  }

  const effectiveFilter = statusFilter || currentTeamProfileRosterStatus || 'all';

  function createPlayerRow(p, displayRank, isInactive = false) {
    const safeName = p.player_name || p.full_name || 'Competitor';
    const cleanJsName = String(safeName).replace(/'/g, "\\'");
    const elo = Number(p.current_elo || 1500);
    const matches = Number(p.matches_played || (Number(p.wins || 0) + Number(p.losses || 0) + Number(p.draws || 0)) || 0);
    const badgeHtml = (typeof renderEloBadgePill === 'function')
      ? renderEloBadgePill(elo, matches, { showTierName: true, size: 'sm', gameSystem: sys })
      : `<span style="font-family: var(--font-mono); font-weight: 700; color: var(--accent);">${elo.toFixed(1)}</span>`;

    const faction = p.top_faction || p.faction || 'Unassigned';
    const cleanFaction = faction.split(',')[0].trim();
    const winRate = Number(p.win_rate != null ? p.win_rate : (matches > 0 ? ((Number(p.wins || 0) / matches) * 100) : 0));

    const isAce = !isInactive && displayRank === 1;
    const isCore = !isInactive && displayRank <= 5;

    let statusBadge = isInactive
      ? `<span class="roster-inactive-badge" title="Inactive (>180 days without match play) • Excluded from Team Power Rating">Inactive</span>`
      : `<span class="badge" style="background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-size: 0.68rem; font-weight: 700;">Active</span>`;

    return `
      <tr class="${isInactive ? 'roster-row-inactive' : ''}" style="cursor: pointer; ${isInactive ? 'opacity: 0.72;' : ''}" onclick="openPlayerModal('${escapeHtml(p.player_id || '')}', '${cleanJsName}')" title="Click to scout ${escapeHtml(safeName)}">
        <td style="text-align: center; font-weight: 700; color: ${isCore ? 'var(--accent)' : 'var(--text-muted)'}; font-family: var(--font-mono); font-size: 0.82rem;">
          #${displayRank}
        </td>
        <td>
          <div style="font-weight: 700; color: #fff; display: flex; align-items: center; gap: 0.4rem;">
            <span class="player-link">${escapeHtml(safeName)}</span>
            ${isAce ? '<span title="Club Top Ace" style="font-size: 0.75rem;">👑</span>' : ''}
          </div>
        </td>
        <td>${badgeHtml}</td>
        <td>${statusBadge}</td>
        <td>
          <span style="color: var(--text-secondary); font-size: 0.82rem;">🛡️ ${escapeHtml(cleanFaction)}</span>
        </td>
        <td style="font-family: var(--font-mono); font-size: 0.82rem;">
          <span style="color: #fff; font-weight: 600;">${matches}</span>
          <span style="color: var(--text-muted); font-size: 0.75rem;">(${p.wins || 0}W-${p.losses || 0}L)</span>
        </td>
        <td style="font-family: var(--font-mono); font-weight: 700; font-size: 0.84rem; color: ${winRate >= 55 ? 'var(--win)' : (winRate >= 45 ? 'var(--accent)' : 'var(--text-secondary)')};">
          ${winRate.toFixed(1)}%
        </td>
      </tr>
    `;
  }

  const activePlayers = roster.filter(p => p.is_active !== false).sort((a, b) => Number(b.current_elo || 1500) - Number(a.current_elo || 1500));
  const inactivePlayers = roster.filter(p => p.is_active === false).sort((a, b) => Number(b.current_elo || 1500) - Number(a.current_elo || 1500));

  if (effectiveFilter === 'active') {
    if (activePlayers.length === 0) return '<tr><td colspan="7" class="empty-state">No active competitors currently registered in this club.</td></tr>';
    return activePlayers.map((p, idx) => createPlayerRow(p, idx + 1, false)).join('');
  }

  if (effectiveFilter === 'inactive') {
    if (inactivePlayers.length === 0) return '<tr><td colspan="7" class="empty-state">No inactive competitors on hiatus in this club.</td></tr>';
    return inactivePlayers.map((p, idx) => createPlayerRow(p, idx + 1, true)).join('');
  }

  // 'all' mode: Group active competitors first with Active Depth divider, then Inactive divider & players
  let html = activePlayers.map((p, idx) => {
    let rowHtml = createPlayerRow(p, idx + 1, false);
    if (idx === 4 && activePlayers.length > 5) {
      const remainingActive = activePlayers.length - 5;
      rowHtml += `
        <tr class="roster-divider-row">
          <td colspan="7">
            <div class="roster-divider-content">
              <div class="roster-divider-left">
                <span class="roster-divider-icon">👥</span>
                <span class="roster-divider-title">Active Club Depth</span>
                <span class="roster-divider-count">(${remainingActive} additional active competitors)</span>
              </div>
              <div class="roster-divider-right">
                <span>Contributes to 40% Club Average</span>
              </div>
            </div>
          </td>
        </tr>
      `;
    }
    return rowHtml;
  }).join('');

  if (inactivePlayers.length > 0) {
    html += `
      <tr class="roster-divider-row roster-inactive-divider-row">
        <td colspan="7">
          <div class="roster-divider-content">
            <div class="roster-divider-left">
              <span class="roster-divider-icon">💤</span>
              <span class="roster-divider-title">Inactive Roster</span>
              <span class="roster-divider-count">(${inactivePlayers.length} on hiatus • >180 days without match play)</span>
            </div>
            <div class="roster-divider-right">
              <span>Excluded from Team Power Rating</span>
            </div>
          </div>
        </td>
      </tr>
    `;
    html += inactivePlayers.map((p, idx) => createPlayerRow(p, activePlayers.length + idx + 1, true)).join('');
  }

  return html;
}

function renderMobileRosterCards(roster, sys, statusFilter = null) {
  if (!roster || roster.length === 0) {
    return '<div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted);">No competitor records registered under this club.</div>';
  }

  const effectiveFilter = statusFilter || currentTeamProfileRosterStatus || 'all';

  function createMobileCard(p, displayRank, isInactive = false) {
    const safeName = p.player_name || p.full_name || 'Competitor';
    const cleanJsName = String(safeName).replace(/'/g, "\\'");
    const elo = Number(p.current_elo || 1500);
    const matches = Number(p.matches_played || (Number(p.wins || 0) + Number(p.losses || 0) + Number(p.draws || 0)) || 0);
    const faction = p.top_faction || p.faction || 'Unassigned';
    const cleanFaction = faction.split(',')[0].trim();
    const winRate = Number(p.win_rate != null ? p.win_rate : (matches > 0 ? ((Number(p.wins || 0) / matches) * 100) : 0));
    const isTop5 = !isInactive && displayRank <= 5;

    return `
      <div class="mobile-competitor-card ${isTop5 ? 'top5' : ''} ${isInactive ? 'mobile-card-inactive' : ''}" onclick="openPlayerModal('${escapeHtml(p.player_id || '')}', '${cleanJsName}')" style="${isInactive ? 'opacity: 0.72; border-color: rgba(255,255,255,0.05);' : ''}">
        <!-- Row 1: Rank, Name, Badges, Elo -->
        <div class="mobile-roster-row-top">
          <div class="mobile-roster-player-info">
            <span class="mobile-roster-rank ${isTop5 ? 'top5' : ''}">#${displayRank}</span>
            <span class="mobile-roster-name">${escapeHtml(safeName)}</span>
            ${!isInactive && displayRank === 1 ? '<span class="mobile-roster-crown" title="Club Top Ace">👑</span>' : ''}
            ${isInactive ? '<span class="mobile-roster-reserve-badge">Inactive</span>' : ''}
          </div>
          <div class="mobile-roster-rating">
            <span class="mobile-roster-elo-num" style="${isInactive ? 'color: var(--text-muted);' : ''}">${elo.toFixed(1)}</span>
          </div>
        </div>

        <!-- Row 2: Faction & Tactical Record -->
        <div class="mobile-roster-row-bottom">
          <div class="mobile-roster-faction">
            <span>🛡️ ${escapeHtml(cleanFaction)}</span>
          </div>
          <div class="mobile-roster-stats">
            <span class="mobile-roster-wr ${winRate >= 55 ? 'win' : ''}">${winRate.toFixed(0)}% WR</span>
            <span class="mobile-roster-sep">·</span>
            <span class="mobile-roster-games">${matches} Games</span>
          </div>
        </div>
      </div>
    `;
  }

  const activePlayers = roster.filter(p => p.is_active !== false).sort((a, b) => Number(b.current_elo || 1500) - Number(a.current_elo || 1500));
  const inactivePlayers = roster.filter(p => p.is_active === false).sort((a, b) => Number(b.current_elo || 1500) - Number(a.current_elo || 1500));

  if (effectiveFilter === 'active') {
    if (activePlayers.length === 0) return '<div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted);">No active competitors registered under this club.</div>';
    return activePlayers.map((p, idx) => createMobileCard(p, idx + 1, false)).join('');
  }

  if (effectiveFilter === 'inactive') {
    if (inactivePlayers.length === 0) return '<div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted);">No inactive competitors on hiatus in this club.</div>';
    return inactivePlayers.map((p, idx) => createMobileCard(p, idx + 1, true)).join('');
  }

  let html = activePlayers.map((p, idx) => createMobileCard(p, idx + 1, false)).join('');

  if (inactivePlayers.length > 0) {
    html += `
      <div class="mobile-roster-divider mobile-roster-inactive-divider">
        <div class="mobile-roster-divider-left">
          <span style="font-size: 1.15rem;">💤</span>
          <div>
            <div style="font-weight: 800; color: #fbbf24; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em;">Inactive Roster (${inactivePlayers.length})</div>
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 1px;">Hiatus • >180 days without match play</div>
          </div>
        </div>
        <span class="mobile-roster-divider-tag" style="font-size: 0.65rem; color: #94a3b8; background: rgba(255,255,255,0.06); padding: 0.15rem 0.45rem; border-radius: 4px; white-space: nowrap;">Excluded from PR</span>
      </div>
    `;
    html += inactivePlayers.map((p, idx) => createMobileCard(p, activePlayers.length + idx + 1, true)).join('');
  }

  return html;
}

function renderTeamBattleLedger(feed) {
  if (!feed || feed.length === 0) {
    return `
      <div style="padding: 3rem 1rem; text-align: center;">
        <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">⚔️</div>
        <div style="font-size: 0.95rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">No Sanctioned Matches Recorded</div>
        <div style="font-size: 0.8rem; color: var(--text-muted); max-width: 440px; margin: 0 auto;">
          Battlefield matches will appear here automatically when club members participate in verified tournaments.
        </div>
      </div>
    `;
  }

  return `
    <div class="table-container" style="max-height: 600px; overflow-x: auto; overflow-y: auto;">
      <table class="table team-ledger-table" style="width: 100%; min-width: 820px;">
        <thead>
          <tr>
            <th style="width: 100px;">Date</th>
            <th style="min-width: 200px;">Tournament Event</th>
            <th style="width: 120px;">Round</th>
            <th style="min-width: 140px;">Club Competitor</th>
            <th style="min-width: 140px;">Opponent</th>
            <th style="text-align: center; width: 80px;">Score</th>
            <th style="text-align: center; width: 90px;">Result</th>
            <th style="text-align: right; width: 85px;">Delta</th>
          </tr>
        </thead>
        <tbody>
          ${feed.map(item => {
            const isWin = item.result === 'win';
            const resultColor = isWin ? 'var(--win)' : 'var(--loss)';
            const resultLabel = isWin ? 'VICTORY' : 'DEFEAT';
            const formattedDate = item.date ? new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
            const delta = item.elo_delta || '';
            const isPositive = delta.startsWith('+');

            return `
              <tr>
                <td style="color: var(--text-muted); font-size: 0.76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${formattedDate}</td>
                <td style="overflow: hidden; text-overflow: ellipsis;">
                  <div style="font-weight: 700; color: #fff; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(item.tournament || '')}">${escapeHtml(item.tournament || 'Tournament Match')}</div>
                  ${item.notes ? `<div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(item.notes)}">${escapeHtml(item.notes)}</div>` : ''}
                </td>
                <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  <span class="badge" style="font-size: 0.68rem; background: rgba(255,255,255,0.06); color: var(--text-secondary); border: 1px solid rgba(255,255,255,0.1); white-space: nowrap;">
                    ${escapeHtml(item.round || 'Sanctioned')}
                  </span>
                </td>
                <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  <strong style="color: #fff; font-size: 0.84rem;">${escapeHtml(item.player_name || 'Club Member')}</strong>
                  ${item.faction ? `<div style="color: var(--text-secondary); font-size: 0.74rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.faction)}</div>` : ''}
                </td>
                <td style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  <span style="color: var(--text-secondary); font-size: 0.84rem;">${escapeHtml(item.opponent_name || 'Opponent')}</span>
                  ${item.opponent_team ? `<div style="margin-top: 2px;"><span class="badge" style="background: rgba(168,85,247,0.1); color: #c084fc; border: 1px solid rgba(168,85,247,0.25); font-size: 0.65rem;">🛡️ ${escapeHtml(item.opponent_team)}</span></div>` : ''}
                </td>
                <td style="text-align: center; font-family: var(--font-mono); font-weight: 700; color: #fff; font-size: 0.84rem; white-space: nowrap;">
                  ${escapeHtml(item.score || '-')}
                </td>
                <td style="text-align: center; white-space: nowrap;">
                  <span class="badge" style="background: ${isWin ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}; color: ${resultColor}; border: 1px solid ${isWin ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}; font-size: 0.72rem; font-weight: 800;">
                    ${resultLabel}
                  </span>
                </td>
                <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; font-size: 0.84rem; color: ${isPositive ? 'var(--win)' : 'var(--loss)'}; white-space: nowrap;">
                  ${escapeHtml(delta || '-')}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderMobileMatchesCards(feed) {
  if (!feed || feed.length === 0) {
    return '<div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted);">No recent sanctioned tournament matches recorded for this club.</div>';
  }

  return feed.map(item => {
    const isWin = item.result === 'win';
    const resBadge = isWin ? 'VICTORY' : 'DEFEAT';
    const dateStr = item.date ? new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
    const delta = item.elo_delta || '';
    const scoreParts = String(item.score || '').split('-').map(s => s.trim());
    const clubScore = scoreParts[0] || '-';
    const oppScore = scoreParts[1] || '-';

    return `
      <div class="mobile-match-card ${isWin ? 'match-win' : 'match-loss'}">
        <!-- Top: Event Name, Round, Date -->
        <div class="mobile-match-header">
          <div class="mobile-match-event" title="${escapeHtml(item.tournament || '')}">
            <span class="mobile-match-tourney">${escapeHtml(item.tournament || 'Sanctioned Tournament')}</span>
            <span class="mobile-match-round-pill">${escapeHtml(item.round || 'Round')}</span>
          </div>
          <span class="mobile-match-date">${dateStr}</span>
        </div>

        <!-- Competitors 2-Row Scoreboard -->
        <div class="mobile-match-scoreboard">
          <div class="mobile-match-team-row ${isWin ? 'winner' : ''}">
            <div class="mobile-match-player-meta">
              <span class="mobile-match-marker">🛡️</span>
              <span class="mobile-match-player-name">${escapeHtml(item.player_name || 'Club Member')}</span>
              ${item.faction ? `<span class="mobile-match-faction-tag">${escapeHtml(item.faction)}</span>` : ''}
            </div>
            <div class="mobile-match-score-num">${escapeHtml(clubScore)}</div>
          </div>

          <div class="mobile-match-team-row ${!isWin ? 'winner' : ''}">
            <div class="mobile-match-player-meta">
              <span class="mobile-match-marker">⚔️</span>
              <span class="mobile-match-player-name">${escapeHtml(item.opponent_name || 'Opponent')}</span>
              ${item.opponent_team ? `<span class="mobile-match-opp-team-tag">${escapeHtml(item.opponent_team)}</span>` : ''}
            </div>
            <div class="mobile-match-score-num">${escapeHtml(oppScore)}</div>
          </div>
        </div>

        <!-- Footer: Outcome Badge, Delta, Notes -->
        <div class="mobile-match-footer">
          <div class="mobile-match-badges-left">
            <span class="mobile-match-result-pill ${isWin ? 'win' : 'loss'}">${resBadge}</span>
            ${delta ? `
              <span class="mobile-match-delta ${delta.startsWith('+') ? 'positive' : 'negative'}">
                ${delta.startsWith('+') ? '📈' : '📉'} ${escapeHtml(delta)}
              </span>
            ` : ''}
          </div>
          ${item.notes ? `
            <div class="mobile-match-notes" title="${escapeHtml(item.notes)}">
              ${escapeHtml(item.notes)}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function switchTeamProfileSubtab(subtab) {
  currentTeamProfileSubtab = subtab;
  document.querySelectorAll('.team-profile-subtabs-bar .profile-subtab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(`team-subtab-btn-${subtab}`);
  if (activeBtn) activeBtn.classList.add('active');

  ['overview', 'roster', 'trophies', 'matches'].forEach(s => {
    const p = document.getElementById(`team-panel-${s}`);
    if (p) {
      p.classList.toggle('active', s === subtab);
      p.style.display = s === subtab ? 'block' : 'none';
    }
  });
}

function copyTeamShareLink() {
  const url = window.location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      if (typeof showToast === 'function') {
        showToast('Club profile link copied to clipboard!');
      } else {
        alert('Club profile link copied to clipboard!');
      }
    });
  }
}

function filterTeamProfileRoster(query) {
  if (!currentProfileTeamData) return;
  const q = (query || '').trim().toLowerCase();
  const roster = currentProfileTeamData.roster || [];
  const tbody = document.getElementById('team-profile-roster-tbody');
  const mobList = document.getElementById('team-profile-mobile-roster');
  const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';

  let filtered = roster;
  if (q) {
    filtered = filtered.filter(p => {
      const name = (p.player_name || p.full_name || '').toLowerCase();
      const faction = (p.top_faction || p.faction || '').toLowerCase();
      return name.includes(q) || faction.includes(q);
    });
  }

  if (tbody) tbody.innerHTML = renderTeamProfileRosterRows(filtered, sys, currentTeamProfileRosterStatus);
  if (mobList) mobList.innerHTML = renderMobileRosterCards(filtered, sys, currentTeamProfileRosterStatus);
}

function setTeamProfileRosterStatus(status) {
  currentTeamProfileRosterStatus = status || 'all';
  document.querySelectorAll('.team-status-tab-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(`team-roster-filter-${currentTeamProfileRosterStatus}`);
  if (activeBtn) activeBtn.classList.add('active');
  const input = document.getElementById('team-roster-filter-input');
  filterTeamProfileRoster(input ? input.value : '');
}

function filterTeamBattleLedger(query) {
  const q = (query || '').trim().toLowerCase();
  const rows = document.querySelectorAll('.team-ledger-table tbody tr');
  rows.forEach(r => {
    const text = r.innerText.toLowerCase();
    r.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
  const cards = document.querySelectorAll('#team-panel-matches .mobile-match-card');
  cards.forEach(c => {
    const text = c.innerText.toLowerCase();
    c.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
}

function detectTeamFromMatchHistory(gs = '40k') {
  // 1. Inspect window.myHubData
  if (window.myHubData) {
    const p = window.myHubData.player;
    if (p) {
      if (p.team && p.team.trim()) return p.team.trim();
      if (Array.isArray(p.teams_history) && p.teams_history.length > 0 && p.teams_history[0]) {
        return String(p.teams_history[0]).trim();
      }
    }
    const events = window.myHubData.events_attended || window.myHubData.tournaments || [];
    for (const ev of events) {
      const t = (ev.team || ev.team_name || ev.player_team || '').trim();
      if (t) return t;
    }
    const matches = window.myHubData.history || [];
    for (const m of matches) {
      const t = (m.team || m.team_name || m.player_team || '').trim();
      if (t) return t;
    }
  }

  // 2. Inspect localStorage cached my_hub
  try {
    const cached = localStorage.getItem(`my_hub_cache_${gs}`) || localStorage.getItem('my_hub_cache');
    if (cached) {
      const parsed = JSON.parse(cached);
      const p = parsed?.player;
      if (p?.team && p.team.trim()) return p.team.trim();
      if (Array.isArray(p?.teams_history) && p.teams_history[0]) return String(p.teams_history[0]).trim();
      const events = parsed?.events_attended || parsed?.tournaments || [];
      for (const ev of events) {
        const t = (ev.team || ev.team_name || ev.player_team || '').trim();
        if (t) return t;
      }
    }
  } catch (e) {}

  // 3. Inspect active profile if viewing self
  if (window.currentProfileData && window.currentProfileData.is_self && window.currentProfileData.player) {
    const p = window.currentProfileData.player;
    if (p.team && p.team.trim()) return p.team.trim();
    if (Array.isArray(p.teams_history) && p.teams_history[0]) return String(p.teams_history[0]).trim();
  }

  return null;
}

function resolveUserTeamName(gs = '40k') {
  // Priority 1: Direct currentUser team
  if (window.currentUser) {
    if (window.currentUser.team && window.currentUser.team.trim()) {
      return window.currentUser.team.trim();
    }
    if (Array.isArray(window.currentUser.teams_history) && window.currentUser.teams_history.length > 0 && window.currentUser.teams_history[0]) {
      return String(window.currentUser.teams_history[0]).trim();
    }
  }

  // Priority 2: Stored in localStorage
  try {
    const userStr = localStorage.getItem('currentUser') || localStorage.getItem('native_user_profile');
    if (userStr) {
      const u = JSON.parse(userStr);
      if (u.team && u.team.trim()) return u.team.trim();
      if (u.claimed_team && u.claimed_team.trim()) return u.claimed_team.trim();
      if (Array.isArray(u.teams_history) && u.teams_history.length > 0 && u.teams_history[0]) {
        return String(u.teams_history[0]).trim();
      }
    }
  } catch (e) {}

  // Priority 3: Match history / My Hub detection
  const detected = detectTeamFromMatchHistory(gs);
  if (detected) return detected;

  return null;
}

function navigateToUserTeam(gameSystem = '') {
  const gs = (gameSystem || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).toLowerCase();
  const teamName = resolveUserTeamName(gs);

  if (teamName && typeof openTeamProfilePage === 'function') {
    openTeamProfilePage(teamName, gs);
    return;
  }

  // If user has no active team, render the informative "How Teams Work & How to Join" section!
  renderUnaffiliatedTeamHub(gs);
}

function confirmAndSetActiveTeam(teamName, gs = '40k') {
  if (!teamName) return;
  const safeName = String(teamName).trim();
  if (window.currentUser) {
    window.currentUser.team = safeName;
  }
  try {
    const userStr = localStorage.getItem('currentUser') || localStorage.getItem('native_user_profile');
    const u = userStr ? JSON.parse(userStr) : {};
    u.team = safeName;
    localStorage.setItem('currentUser', JSON.stringify(u));
    localStorage.setItem('native_user_profile', JSON.stringify(u));
  } catch (e) {}

  if (typeof showToastNotification === 'function') {
    showToastNotification(`🛡️ Team set to ${safeName}!`, 'success');
  }
  openTeamProfilePage(safeName, gs);
}

function promptManualTeamJoin(gs = '40k') {
  const current = (window.currentUser && window.currentUser.team) || '';
  const chosen = prompt('Enter your club or team name (as registered on BCP):', current);
  if (chosen && chosen.trim()) {
    confirmAndSetActiveTeam(chosen.trim(), gs);
  }
}

function renderUnaffiliatedTeamHub(gameSystem = '40k') {
  const gs = (gameSystem || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).toLowerCase();

  // Switch to team-profile tab view
  if (typeof switchTab === 'function') {
    switchTab('team-profile');
  } else {
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.remove('active');
      p.style.removeProperty('display');
    });
    const panel = document.getElementById('tab-team-profile');
    if (panel) {
      panel.classList.add('active');
      panel.style.display = 'block';
    }
  }

  // Update URL to bare team route without hardcoding any specific team
  try {
    history.replaceState(null, '', `/#/${gs}/team/`);
  } catch (e) {}

  // Update top and mobile nav items active states
  document.querySelectorAll('.nav-btn, .mobile-nav-item').forEach(b => {
    if (b.id === 'nav-btn-team' || b.getAttribute('data-tab') === 'team') {
      b.classList.add('active');
    }
  });

  const container = document.getElementById('team-profile-container');
  if (!container) return;

  const detectedTeam = detectTeamFromMatchHistory(gs);

  const featuredClubs = [
    {
      name: 'Art of War',
      tag: 'AOW',
      captain: 'Jack Harpster',
      tier: 'Everchosen Apex',
      powerRating: 2465.0,
      rosterCount: 16,
      championshipsCount: 49,
      icon: '👑',
      accent: '#c084fc',
      desc: 'World Champions and premier tactical coaching squad fielding Everchosen competitors across international circuits.'
    },
    {
      name: 'Team Zero Comp',
      tag: 'TZC',
      captain: 'John Hsieh',
      tier: 'High Warlord',
      powerRating: 1949.5,
      rosterCount: 29,
      championshipsCount: 51,
      icon: '🛡️',
      accent: '#38bdf8',
      desc: 'California competitive powerhouse dominating West Coast circuits, Lone Star Open, and Las Vegas Open.'
    },
    {
      name: 'Stat Check',
      tag: 'STAT',
      captain: 'Innes Wilson',
      tier: 'High Warlord',
      powerRating: 2185.0,
      rosterCount: 14,
      championshipsCount: 28,
      icon: '📊',
      accent: '#f59e0b',
      desc: 'Elite competitive analytics, statistical modeling, and international tournament circuit contenders.'
    },
    {
      name: 'Team USA',
      tag: 'USA',
      captain: 'National Squad',
      tier: 'Everchosen Apex',
      powerRating: 2420.0,
      rosterCount: 20,
      championshipsCount: 65,
      icon: '🦅',
      accent: '#ef4444',
      desc: 'United States national representative squad competing in the World Championships of Warhammer.'
    }
  ];

  const clubsCardsHtml = featuredClubs.map(c => `
    <div class="profile-hero-card" style="padding: 1.15rem; display: flex; flex-direction: column; justify-content: space-between; border-left: 3.5px solid ${c.accent};">
      <div>
        <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 0.65rem;">
          <div style="display: flex; align-items: center; gap: 0.6rem;">
            <div style="width: 40px; height: 40px; border-radius: 8px; background: rgba(15,23,42,0.8); border: 1.5px solid ${c.accent}; display: flex; align-items: center; justify-content: center; font-size: 1.3rem;">
              ${c.icon}
            </div>
            <div>
              <h4 style="font-size: 0.98rem; font-weight: 800; color: #fff; margin: 0;">${escapeHtml(c.name)}</h4>
              <span style="font-size: 0.7rem; color: ${c.accent}; font-weight: 700; text-transform: uppercase;">${escapeHtml(c.tier)} • ${escapeHtml(c.tag)}</span>
            </div>
          </div>
          <span class="badge" style="background: rgba(56,189,248,0.12); color: #38bdf8; font-size: 0.72rem; font-weight: 700;">
            🏆 ${c.championshipsCount} Titles
          </span>
        </div>
        <p style="font-size: 0.78rem; color: var(--text-secondary); line-height: 1.45; margin: 0 0 0.85rem;">
          ${escapeHtml(c.desc)}
        </p>
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.06);">
        <div>
          <span style="font-size: 0.68rem; color: var(--text-muted); display: block;">Starting 5 Rating</span>
          <strong style="font-size: 0.95rem; color: #fff; font-family: var(--font-mono);">${c.powerRating.toFixed(1)}</strong>
        </div>
        <button type="button" class="btn btn-outline btn-sm" onclick="openTeamProfilePage('${escapeHtml(c.name)}', '${gs}')" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; font-weight: 700;">
          <span>Inspect Club Hub &rarr;</span>
        </button>
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    <!-- Top Hero Banner: Unaffiliated Competitor / Clubs & Squads -->
    <div class="team-command-hero" style="margin-bottom: 1.25rem;">
      <div class="team-hero-identity">
        <div class="team-crest-shield heraldry-tier-rookie" style="width: 72px; height: 72px; font-size: 2.2rem; display: flex; align-items: center; justify-content: center; background: rgba(15,23,42,0.9); border: 2px dashed rgba(148,163,184,0.4); border-radius: 12px; flex-shrink: 0;">
          🛡️
        </div>
        <div class="team-hero-titles">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span class="badge" style="background: rgba(148,163,184,0.15); color: #94a3b8; font-weight: 700; font-size: 0.72rem; padding: 0.2rem 0.55rem; border-radius: 6px;">
              ${gs.toUpperCase()} CLUBS & SQUADS
            </span>
            <span class="badge" style="background: rgba(245,158,11,0.15); color: #fbbf24; font-weight: 700; font-size: 0.72rem; padding: 0.2rem 0.55rem; border-radius: 6px;">
              ⚠️ No Active Club Affiliation
            </span>
          </div>
          <h1 style="font-size: 1.55rem; font-weight: 900; color: #fff; margin: 0.25rem 0 0.35rem;">Tabletop Teams & Wargaming Clubs</h1>
          <div style="font-size: 0.84rem; color: var(--text-secondary); max-width: 680px; line-height: 1.45;">
            Compete under a unified club banner, aggregate tournament silverware into your club reliquary, establish your Starting 5 Power Rating, and climb the seasonal circuit leaderboard.
          </div>
        </div>
      </div>
    </div>

    <!-- Interactive Auto-Affiliation & Join Card -->
    <div class="profile-hero-card" style="margin-bottom: 1.25rem; border: 1.5px solid rgba(56,189,248,0.3); background: linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.85) 100%); padding: 1.25rem;">
      <div style="display: flex; align-items: flex-start; gap: 0.85rem; flex-wrap: wrap;">
        <div style="font-size: 2rem; line-height: 1;">⚡</div>
        <div style="flex: 1; min-width: 260px;">
          <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0 0 0.35rem;">How Team Affiliation Works</h3>
          <p style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5; margin: 0 0 0.85rem;">
            In sanctioned tournament play (via Best Coast Pairings), your club affiliation is <strong>automatically captured from your latest match submission</strong> and the team name listed on your event registration roster.
          </p>

          ${detectedTeam ? `
            <!-- Detected Team from Match Record -->
            <div style="background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.35); border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 0.85rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.65rem;">
              <div>
                <div style="font-size: 0.72rem; color: var(--accent); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;">Recent Team Found in Tournament History</div>
                <div style="font-size: 1.1rem; font-weight: 800; color: #fff;">🛡️ ${escapeHtml(detectedTeam)}</div>
              </div>
              <button type="button" class="btn btn-primary btn-sm" onclick="confirmAndSetActiveTeam('${escapeHtml(detectedTeam)}', '${gs}')" style="font-weight: 700;">
                <span>🛡️ Set As My Active Team</span>
              </button>
            </div>
          ` : `
            <!-- Action buttons for user without detected team -->
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
              <button type="button" class="btn btn-primary btn-sm" onclick="openBcpLinkModal()" style="font-size: 0.78rem; font-weight: 700;">
                <span>🔗 Link BCP Account to Auto-Detect Team</span>
              </button>
              <button type="button" class="btn btn-outline btn-sm" onclick="promptManualTeamJoin('${gs}')" style="font-size: 0.78rem;">
                <span>✏️ Set Club Name Manually</span>
              </button>
            </div>
          `}
        </div>
      </div>
    </div>

    <!-- How Clubs Work: 4 Highlight Features -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.85rem; margin-bottom: 1.25rem;">
      <div class="profile-hero-card" style="padding: 1rem;">
        <div style="font-size: 1.5rem; margin-bottom: 0.35rem;">🛡️</div>
        <h4 style="font-size: 0.92rem; font-weight: 800; color: #fff; margin: 0 0 0.3rem;">The Starting 5 & Power Rating</h4>
        <p style="font-size: 0.78rem; color: var(--text-secondary); line-height: 1.45; margin: 0;">
          Clubs field full active rosters. The top 5 ranked active competitors form the squad's "Starting 5", whose average Elo establishes the team's official Power Rating on the circuit.
        </p>
      </div>

      <div class="profile-hero-card" style="padding: 1rem;">
        <div style="font-size: 1.5rem; margin-bottom: 0.35rem;">🏆</div>
        <h4 style="font-size: 0.92rem; font-weight: 800; color: #fff; margin: 0 0 0.3rem;">Silverware Reliquary</h4>
        <p style="font-size: 0.78rem; color: var(--text-secondary); line-height: 1.45; margin: 0;">
          Every 1st place championship victory across Worlds, Majors, GTs, and RTTs won by any squad member is automatically consolidated into the club's trophy reliquary and honors ledger.
        </p>
      </div>

      <div class="profile-hero-card" style="padding: 1rem;">
        <div style="font-size: 1.5rem; margin-bottom: 0.35rem;">⚔️</div>
        <h4 style="font-size: 0.92rem; font-weight: 800; color: #fff; margin: 0 0 0.3rem;">Live Battlefield Ledger</h4>
        <p style="font-size: 0.78rem; color: var(--text-secondary); line-height: 1.45; margin: 0;">
          Every tournament round played by any squad member streams into a live team ledger, tracking match records, opponent ratings, victory margins, and faction matchups.
        </p>
      </div>

      <div class="profile-hero-card" style="padding: 1rem;">
        <div style="font-size: 1.5rem; margin-bottom: 0.35rem;">👑</div>
        <h4 style="font-size: 0.92rem; font-weight: 800; color: #fff; margin: 0 0 0.3rem;">Club Leaderboards & Circuit</h4>
        <p style="font-size: 0.78rem; color: var(--text-secondary); line-height: 1.45; margin: 0;">
          Clubs compete for seasonal circuit podium honors, regional wargaming dominance, and the #1 Team in the World trophy.
        </p>
      </div>
    </div>

    <!-- Explore Top Registered Clubs Showcase -->
    <div class="profile-hero-card" style="padding: 1.25rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">Explore Registered Clubs & Squads</h3>
          <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 0.2rem;">
            Inspect active team dossiers, member rosters, silverware reliquaries, and battlefield ledgers.
          </div>
        </div>
        <button type="button" class="btn btn-outline btn-sm" onclick="switchTab('leaderboard'); if (typeof switchLeaderboardSubtab === 'function') switchLeaderboardSubtab('teams');" style="font-size: 0.76rem;">
          <span>🏆 View Full Team Leaderboard &rarr;</span>
        </button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.85rem;">
        ${clubsCardsHtml}
      </div>
    </div>
  `;
}

/* ==========================================================================
   CONSOLIDATED TEAM HALL OF CHAMPIONS
   ========================================================================== */

let teamReliquaryState = {
  filter: 'all',
  sort: 'tier_desc', // 'tier_desc', 'date_desc', 'players_desc', 'player_asc'
  searchQuery: '',
  currentPage: 1,
  pageSize: 12,
  isPaginated: true,
  isMvpExpanded: false,
  isMvpSectionCollapsed: false,
  isReliquaryCollapsed: false
};

function toggleTeamMvpSection() {
  teamReliquaryState.isMvpSectionCollapsed = !teamReliquaryState.isMvpSectionCollapsed;
  const body = document.getElementById('team-mvp-section-body');
  const btn = document.getElementById('team-mvp-section-toggle-btn');
  if (body) body.style.display = teamReliquaryState.isMvpSectionCollapsed ? 'none' : 'block';
  if (btn) {
    btn.innerHTML = `<span>${teamReliquaryState.isMvpSectionCollapsed ? '▶ Expand Section' : '─ Collapse Section'}</span>`;
  }
}

function toggleTeamMvpExpand() {
  teamReliquaryState.isMvpExpanded = !teamReliquaryState.isMvpExpanded;
  const extraCards = document.querySelectorAll('#team-mvp-grid .team-mvp-extra-card');
  extraCards.forEach(c => {
    c.style.display = teamReliquaryState.isMvpExpanded ? 'block' : 'none';
  });
  const btn = document.getElementById('team-mvp-expand-btn');
  if (btn) {
    const totalCount = document.querySelectorAll('#team-mvp-grid .profile-spotlight-card').length;
    btn.innerHTML = `<span>${teamReliquaryState.isMvpExpanded ? '▲ Show Top 3 Only' : `▼ View All ${totalCount} Decorated Champions (${totalCount - 3} More)`}</span>`;
  }
}

function toggleTeamReliquarySection() {
  teamReliquaryState.isReliquaryCollapsed = !teamReliquaryState.isReliquaryCollapsed;
  const body = document.getElementById('team-reliquary-section-body');
  const btn = document.getElementById('team-reliquary-section-toggle-btn');
  if (body) body.style.display = teamReliquaryState.isReliquaryCollapsed ? 'none' : 'block';
  if (btn) {
    btn.innerHTML = `<span>${teamReliquaryState.isReliquaryCollapsed ? '▶ Expand Reliquary' : '─ Collapse Reliquary'}</span>`;
  }
}

function setTeamSilverwareFilter(tier) {
  teamReliquaryState.filter = tier;
  teamReliquaryState.currentPage = 1;
  const filterBtns = ['all', 'major', 'gt', 'rtt'];
  filterBtns.forEach(f => {
    const btn = document.getElementById(`team-trophy-filter-btn-${f}`);
    if (btn) {
      const isActive = f === tier;
      btn.classList.toggle('active', isActive);
      btn.style.background = isActive ? 'rgba(56,189,248,0.2)' : 'rgba(255,255,255,0.04)';
      btn.style.color = isActive ? '#38bdf8' : '#94a3b8';
      btn.style.borderColor = isActive ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.1)';
    }
  });
  renderTeamReliquaryGridAndPagination();
}

function setTeamSilverwareSort(sortMode) {
  teamReliquaryState.sort = sortMode;
  teamReliquaryState.currentPage = 1;
  renderTeamReliquaryGridAndPagination();
}

function setTeamSilverwarePage(pageNum) {
  teamReliquaryState.currentPage = pageNum;
  renderTeamReliquaryGridAndPagination();
  const reliquarySection = document.getElementById('team-reliquary-section-body');
  if (reliquarySection && reliquarySection.getBoundingClientRect().top < 0) {
    reliquarySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function toggleTeamSilverwarePagination() {
  teamReliquaryState.isPaginated = !teamReliquaryState.isPaginated;
  teamReliquaryState.currentPage = 1;
  const toggleBtn = document.getElementById('team-trophies-page-toggle-btn');
  if (toggleBtn) {
    toggleBtn.innerHTML = `<span>${teamReliquaryState.isPaginated ? '📄 12 Per Page' : '📜 Showing All'}</span>`;
  }
  renderTeamReliquaryGridAndPagination();
}

function filterTeamSilverwareGrid() {
  const searchInput = document.getElementById('team-trophies-search-input');
  teamReliquaryState.searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
  teamReliquaryState.currentPage = 1;
  renderTeamReliquaryGridAndPagination();
}

function getFilteredAndSortedTeamSilverware(items) {
  let list = Array.isArray(items) ? items.slice() : [];

  // Strict qualification: ONLY undefeated runs with zero draws qualify (no 4-0-1 or 3-0-2)
  list = list.filter(c => {
    const d = Number(c.draws || 0);
    const l = Number(c.losses || 0);
    const rec = String(c.record || '');
    if (d > 0 || l > 0) return false;
    if (rec.includes('-0-1') || rec.includes('-0-2') || rec.includes('-1-') || rec.includes('-2-')) return false;
    if (c.undefeated === false) return false;
    return true;
  });

  // 1. Tier filter
  if (teamReliquaryState.filter === 'major') {
    list = list.filter(c => c.tier === 'major' || c.tier === 'super_major');
  } else if (teamReliquaryState.filter === 'gt') {
    list = list.filter(c => c.tier === 'gt');
  } else if (teamReliquaryState.filter === 'rtt') {
    list = list.filter(c => c.tier === 'rtt');
  }

  // 2. Search filter
  if (teamReliquaryState.searchQuery) {
    const q = teamReliquaryState.searchQuery;
    list = list.filter(c => {
      const ev = (c.event_name || '').toLowerCase();
      const pl = (c.player_name || '').toLowerCase();
      const fa = (c.faction || '').toLowerCase();
      return ev.includes(q) || pl.includes(q) || fa.includes(q);
    });
  }

  // 3. Sorting
  const tierWeights = { 'super_major': 4, 'major': 3, 'gt': 2, 'rtt': 1 };
  if (teamReliquaryState.sort === 'tier_desc') {
    list.sort((a, b) => {
      const wa = tierWeights[a.tier] || 0;
      const wb = tierWeights[b.tier] || 0;
      if (wb !== wa) return wb - wa;
      return String(b.event_date || '').localeCompare(String(a.event_date || ''));
    });
  } else if (teamReliquaryState.sort === 'date_desc') {
    list.sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || '')));
  } else if (teamReliquaryState.sort === 'players_desc') {
    list.sort((a, b) => (Number(b.total_players || 0) - Number(a.total_players || 0)) || (Number(b.num_rounds || 0) - Number(a.num_rounds || 0)));
  } else if (teamReliquaryState.sort === 'player_asc') {
    list.sort((a, b) => String(a.player_name || '').localeCompare(String(b.player_name || '')));
  }

  return list;
}

function renderSingleTrophyCardHtml(item) {
  const tierClass = 'tier-' + (item.tier || 'rtt').replace(/_/g, '-');
  const ribbonHtml = item.undefeated
    ? '<div class="champ-trophy-ribbon" title="Flawless Undefeated Championship Run">⭐ UNDEFEATED</div>'
    : '';
  const trophySvg = (window.BadgesUI && window.BadgesUI.getTrophySvg)
    ? window.BadgesUI.getTrophySvg(item.trophy_type || 'bronze_laurel_plaque')
    : '🏆';
  const itemEncoded = encodeURIComponent(JSON.stringify(item));
  const cleanPlayer = item.player_name || 'Squad Member';
  const tierTitle = (item.tier_title || (item.tier === 'super_major' ? 'Super Major / Worlds' : (item.tier === 'major' ? 'Major Championship' : (item.tier === 'gt' ? 'Grand Tournament' : 'Rogue Trader Tournament')))).toUpperCase();
  const shortTierName = item.tier === 'super_major' ? 'WORLDS' : (item.tier === 'major' ? 'MAJOR' : (item.tier === 'gt' ? 'GT' : 'RTT'));

  // Nice date format (e.g. "Sep 2026")
  let formattedDate = '';
  if (item.event_date) {
    try {
      const parts = String(item.event_date).split('-');
      if (parts.length >= 2) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const mIdx = parseInt(parts[1], 10) - 1;
        formattedDate = (months[mIdx] || parts[1]) + ' ' + parts[0];
      }
    } catch (e) {
      formattedDate = String(item.event_date).substring(0, 7);
    }
  }

  const safeEventName = escapeHtml(item.event_name || '').replace(/'/g, "\\'");

  return `
    <div class="champ-trophy-card ${tierClass} team-trophy-card" data-chronicle="${itemEncoded}" data-tier="${escapeHtml(item.tier || 'rtt')}" data-undefeated="${item.undefeated ? 'true' : 'false'}" data-player="${escapeHtml(cleanPlayer.toLowerCase())}" data-event="${escapeHtml((item.event_name || '').toLowerCase())}" data-faction="${escapeHtml((item.faction || '').toLowerCase())}" onclick="window.BadgesUI.openVictoryChronicleFromElement(this)" title="Click to inspect Victory Chronicle for ${escapeHtml(item.event_name)}">
      
      <!-- DESKTOP PRESENTATION (>= 769px) -->
      <div class="champ-trophy-desktop-view desktop-only" style="width: 100%; display: flex; flex-direction: column; align-items: center;">
        ${ribbonHtml}
        <div class="champ-trophy-icon-wrap">${trophySvg}</div>
        <div class="champ-trophy-tier-tag">${escapeHtml(tierTitle)}</div>
        <div class="champ-trophy-name" onclick="event.stopPropagation(); window.openEventModalFromChampionship('${escapeHtml(item.event_id || '')}', '${safeEventName}')" title="Click to view Tournament Standings for ${escapeHtml(item.event_name)}" style="cursor: pointer; text-decoration: underline; text-decoration-color: rgba(56,189,248,0.4); text-underline-offset: 2px;">${escapeHtml(item.event_name)} <span style="font-size: 0.72rem; color: #38bdf8;">↗</span></div>
        <div class="champ-trophy-player-pill" style="font-size:0.75rem; color:#38bdf8; font-weight:700; margin: 0.2rem 0 0.35rem; display: flex; align-items: center; justify-content: center; gap: 0.25rem;">
          <span>👤</span>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Won by ${escapeHtml(cleanPlayer)}</span>
        </div>
        <div class="champ-trophy-meta">
          <span class="champ-meta-record">${escapeHtml(item.record || '')}</span>
          <span class="champ-meta-dot">&bull;</span>
          <span class="champ-meta-players">${item.total_players ? `${item.total_players} Players` : `${item.num_rounds || 3} Rnds`}</span>
        </div>
        <div class="champ-trophy-footer">
          <span class="champ-meta-faction" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">🛡️ ${escapeHtml(item.faction || 'General')}</span>
          <span class="champ-meta-glory">+${item.glory_bonus || 0} Glory</span>
        </div>
      </div>

      <!-- MOBILE PRESENTATION (<= 768px): Compact Sleek Tournament Win Row -->
      <div class="champ-trophy-mobile-view mobile-only" style="width: 100%; display: flex; align-items: center; gap: 0.7rem; text-align: left;">
        <!-- Left: 44px Glowing Emblem -->
        <div class="champ-mob-icon-wrap ${tierClass}">
          <div class="champ-mob-trophy-svg">${trophySvg}</div>
          ${item.undefeated ? '<div class="champ-mob-star-badge" title="Undefeated Champion">★</div>' : ''}
        </div>

        <!-- Center: Tournament Details & Winner -->
        <div class="champ-mob-content" style="flex: 1; min-width: 0;">
          <div class="champ-mob-topline">
            <span class="champ-mob-tier-pill ${tierClass}">${escapeHtml(shortTierName)}</span>
            ${formattedDate ? `<span class="champ-mob-date">${escapeHtml(formattedDate)}</span>` : ''}
            ${item.undefeated ? '<span class="champ-mob-undefeated-badge">⭐ Undefeated</span>' : ''}
          </div>
          <div class="champ-mob-name" onclick="event.stopPropagation(); window.openEventModalFromChampionship('${escapeHtml(item.event_id || '')}', '${safeEventName}')" title="Click to view Tournament Standings for ${escapeHtml(item.event_name)}" style="cursor: pointer; text-decoration: underline; text-decoration-color: rgba(56,189,248,0.4); text-underline-offset: 2px;">${escapeHtml(item.event_name)} <span style="font-size: 0.72rem; color: #38bdf8;">↗</span></div>
          <div class="champ-mob-byline">
            <span class="champ-mob-player">👤 ${escapeHtml(cleanPlayer)}</span>
            <span class="champ-mob-dot">&bull;</span>
            <span class="champ-mob-faction">🛡️ ${escapeHtml(item.faction || 'General')}</span>
          </div>
        </div>

        <!-- Right: Record Pill, Field Size & Action Arrow -->
        <div class="champ-mob-meta">
          <div class="champ-mob-record">${escapeHtml(item.record || '')}</div>
          <div class="champ-mob-players">${item.total_players ? `${item.total_players}p` : `${item.num_rounds || 3}r`}</div>
          <div class="champ-mob-glory">+${item.glory_bonus || 0}</div>
          <div class="champ-mob-chevron">›</div>
        </div>
      </div>

    </div>
  `;
}

function renderTeamReliquaryGridAndPagination() {
  if (!currentProfileTeamData) return;
  const championships = currentProfileTeamData.championships || { items: [] };
  const allItems = Array.isArray(championships.items) ? championships.items : [];
  const filtered = getFilteredAndSortedTeamSilverware(allItems);

  const grid = document.getElementById('team-trophies-grid');
  const emptyMsg = document.getElementById('team-trophies-empty-filter');
  const pagin = document.getElementById('team-trophies-pagination');
  if (!grid) return;

  if (filtered.length === 0) {
    grid.innerHTML = '';
    if (emptyMsg) emptyMsg.style.display = 'block';
    if (pagin) pagin.style.display = 'none';
    return;
  }
  if (emptyMsg) emptyMsg.style.display = 'none';

  const pageSize = teamReliquaryState.pageSize || 12;
  const totalPages = Math.ceil(filtered.length / pageSize);
  if (teamReliquaryState.currentPage > totalPages) {
    teamReliquaryState.currentPage = Math.max(1, totalPages);
  }
  const currentPage = teamReliquaryState.currentPage;

  const startIdx = teamReliquaryState.isPaginated ? (currentPage - 1) * pageSize : 0;
  const endIdx = teamReliquaryState.isPaginated ? Math.min(startIdx + pageSize, filtered.length) : filtered.length;
  const pageItems = filtered.slice(startIdx, endIdx);

  grid.innerHTML = pageItems.map(item => renderSingleTrophyCardHtml(item)).join('\n');

  if (pagin) {
    if (!teamReliquaryState.isPaginated || totalPages <= 1) {
      pagin.style.display = 'flex';
      pagin.innerHTML = `
        <div style="font-size: 0.78rem; color: var(--text-secondary); width: 100%; text-align: center; padding: 0.5rem 0;">
          Showing all <strong style="color: var(--accent);">${filtered.length}</strong> of ${allItems.length} trophies
        </div>
      `;
    } else {
      pagin.style.display = 'flex';
      let pagePills = '';
      for (let p = 1; p <= totalPages; p++) {
        const isCurrent = p === currentPage;
        pagePills += `
          <button type="button" class="btn ${isCurrent ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="setTeamSilverwarePage(${p})" style="font-size: 0.74rem; padding: 0.25rem 0.6rem; min-width: 32px; ${isCurrent ? 'font-weight: 800;' : ''}">
            ${p}
          </button>
        `;
      }

      pagin.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; flex-wrap: wrap; gap: 0.75rem; padding-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.06); margin-top: 0.5rem;">
          <div style="font-size: 0.78rem; color: var(--text-secondary);">
            Showing <strong style="color: #fff;">${startIdx + 1}–${endIdx}</strong> of <strong style="color: var(--accent);">${filtered.length}</strong> Trophies (Page ${currentPage} of ${totalPages})
          </div>
          <div style="display: flex; align-items: center; gap: 0.35rem;">
            <button type="button" class="btn btn-outline btn-sm" onclick="setTeamSilverwarePage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''} style="font-size: 0.74rem; padding: 0.25rem 0.65rem;">
              « Prev
            </button>
            ${pagePills}
            <button type="button" class="btn btn-outline btn-sm" onclick="setTeamSilverwarePage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''} style="font-size: 0.74rem; padding: 0.25rem 0.65rem;">
              Next »
            </button>
          </div>
        </div>
      `;
    }
  }
}

function renderTeamTrophiesPanel(data, sys) {
  const teamName = data.team || currentProfileTeamName || 'Club';
  const championships = data.championships || { total: 0, items: [], top_champions: [], factions_distribution: [] };
  const rawItems = Array.isArray(championships.items) ? championships.items : [];
  // Strict qualification: ONLY undefeated runs with zero draws qualify
  const items = rawItems.filter(c => {
    const d = Number(c.draws || 0);
    const l = Number(c.losses || 0);
    const rec = String(c.record || '');
    if (d > 0 || l > 0) return false;
    if (rec.includes('-0-1') || rec.includes('-0-2') || rec.includes('-1-') || rec.includes('-2-')) return false;
    if (c.undefeated === false) return false;
    return true;
  });
  const topChamps = Array.isArray(championships.top_champions) ? championships.top_champions : [];
  const factionsDist = Array.isArray(championships.factions_distribution) ? championships.factions_distribution : [];

  const totalTitles = items.length;
  const majorWins = items.filter(c => c.tier === 'major' || c.tier === 'super_major').length;
  const gtWins = items.filter(c => c.tier === 'gt').length;
  const rttWins = items.filter(c => c.tier === 'rtt').length;

  const topAce = topChamps.length > 0 ? topChamps[0] : null;

  if (totalTitles === 0) {
    return `
      <div class="profile-hero-card" style="padding: 3.5rem 1.5rem; text-align: center;">
        <div style="font-size: 3rem; margin-bottom: 0.75rem;">🏛️</div>
        <h3 style="font-size: 1.25rem; font-weight: 800; color: #fff; margin-bottom: 0.35rem;">Sanctioned Reliquary Empty</h3>
        <p style="color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.25rem; font-size: 0.88rem; line-height: 1.5;">
          No verified tournament championships have been recorded yet for ${escapeHtml(teamName)}.
          When squad competitors place 1st in official RTTs, GTs, or Majors, their trophies will be enshrined here automatically.
        </p>
      </div>
    `;
  }

  // 4 Core KPI Cards (Real, authentic tournament wargaming metrics)
  const rosterCount = (data.roster && data.roster.length) || 29;
  const champsCount = topChamps.length;
  const champsPct = rosterCount > 0 ? Math.round((champsCount / rosterCount) * 100) : 0;
  const topFactionsSummary = factionsDist.slice(0, 3).map(f => f.faction).join(', ') + (factionsDist.length > 3 ? ` +${factionsDist.length - 3} more` : '');

  const kpisHtml = `
    <div class="profile-kpi-grid team-kpi-grid" style="margin-bottom: 1.25rem;">
      <!-- KPI 1: Total Championships -->
      <div class="profile-kpi-card" style="border-color: rgba(245, 158, 11, 0.4); background: radial-gradient(circle at top, rgba(245, 158, 11, 0.12), rgba(15, 23, 42, 0.95));">
        <div class="profile-kpi-label">🏆 Total Championships</div>
        <div class="profile-kpi-value" style="font-family: var(--font-mono); font-size: 1.45rem; font-weight: 800; color: #fbbf24; margin-top: 0.2rem;">
          ${totalTitles} <span style="font-size: 0.82rem; font-weight: 700; color: #fef08a;">Titles</span>
        </div>
        <div class="profile-kpi-sub" style="color: #cbd5e1;">${majorWins > 0 ? `${majorWins} Major${majorWins > 1 ? 's' : ''} • ` : ''}${gtWins} GTs • ${rttWins} RTTs</div>
      </div>

      <!-- KPI 2: Squad Champion Breadth (replacing Flawless Undefeated) -->
      <div class="profile-kpi-card" style="border-color: rgba(168, 85, 247, 0.4); background: radial-gradient(circle at top, rgba(168, 85, 247, 0.12), rgba(15, 23, 42, 0.95));">
        <div class="profile-kpi-label">🎖️ Titled Champions</div>
        <div class="profile-kpi-value" style="font-family: var(--font-mono); font-size: 1.45rem; font-weight: 800; color: #c084fc; margin-top: 0.2rem;">
          ${champsCount} <span style="font-size: 0.82rem; font-weight: 700; color: #e9d5ff;">Winners</span>
        </div>
        <div class="profile-kpi-sub" style="color: #cbd5e1;">${champsPct}% of Squad Decorated (${champsCount} of ${rosterCount} Competitors)</div>
      </div>

      <!-- KPI 3: Winning Army Factions (replacing Squad Glory Harvest) -->
      <div class="profile-kpi-card" style="border-color: rgba(56, 189, 248, 0.4); background: radial-gradient(circle at top, rgba(56, 189, 248, 0.12), rgba(15, 23, 42, 0.95));">
        <div class="profile-kpi-label">🛡️ Winning Armies</div>
        <div class="profile-kpi-value" style="font-family: var(--font-mono); font-size: 1.45rem; font-weight: 800; color: #38bdf8; margin-top: 0.2rem;">
          ${factionsDist.length} <span style="font-size: 0.82rem; font-weight: 700; color: #bae6fd;">Factions</span>
        </div>
        <div class="profile-kpi-sub" style="color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(topFactionsSummary)}">${escapeHtml(topFactionsSummary)}</div>
      </div>

      <!-- KPI 4: All-Time Trophy Leader -->
      <div class="profile-kpi-card" style="border-color: rgba(234, 179, 8, 0.4); background: radial-gradient(circle at top, rgba(234, 179, 8, 0.12), rgba(15, 23, 42, 0.95));">
        <div class="profile-kpi-label">👑 Squad Trophy Leader</div>
        <div class="profile-kpi-value" style="font-size: 1.15rem; font-weight: 800; color: #fde047; margin-top: 0.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${topAce ? escapeHtml(topAce.player_name) : '-'}
        </div>
        <div class="profile-kpi-sub" style="color: #cbd5e1;">${topAce ? `${topAce.titles_count} Championships Won • ${escapeHtml(topAce.role || 'Top Ace')}` : 'Squad Anchors'}</div>
      </div>
    </div>
  `;

  // Top Champions Podium / MVP Ranking
  let podiumHtml = '';
  if (topChamps.length > 0) {
    const podiumCards = topChamps.map((tc, idx) => {
      const cleanJsName = String(tc.player_name || '').replace(/'/g, "\\'");
      const rankIcon = idx === 0 ? '👑' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `#${idx + 1}`));
      const borderGlow = idx === 0 ? 'border: 1.5px solid rgba(245, 158, 11, 0.6); box-shadow: 0 0 16px rgba(245, 158, 11, 0.18);' : 'border: 1px solid rgba(255, 255, 255, 0.08);';
      const breakdown = [];
      if (tc.majors > 0) breakdown.push(`<span style="color: #fbbf24; font-weight: 700;">${tc.majors} Major${tc.majors > 1 ? 's' : ''}</span>`);
      if (tc.gts > 0) breakdown.push(`<span style="color: #e2e8f0; font-weight: 700;">${tc.gts} GT${tc.gts > 1 ? 's' : ''}</span>`);
      if (tc.rtts > 0) breakdown.push(`<span style="color: #d97706; font-weight: 700;">${tc.rtts} RTT${tc.rtts > 1 ? 's' : ''}</span>`);

      const isExtra = idx >= 3;
      const extraClass = isExtra ? 'team-mvp-extra-card' : '';
      const extraStyle = isExtra ? (teamReliquaryState.isMvpExpanded ? 'display: block;' : 'display: none;') : '';

      return `
        <div class="profile-spotlight-card ${extraClass}" style="${extraStyle} cursor: pointer; ${borderGlow} transition: transform 0.15s ease, border-color 0.15s ease; padding: 0.85rem 1rem;" onclick="openPlayerModal('${escapeHtml(tc.player_id || '')}', '${cleanJsName}')" onmouseover="this.style.borderColor='rgba(56,189,248,0.5)'" onmouseout="this.style.borderColor='${idx === 0 ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.08)'}'" title="Scout ${escapeHtml(tc.player_name)}">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <span style="font-size: 1.05rem;">${rankIcon}</span>
              <span style="font-size: 0.72rem; font-weight: 800; color: ${idx === 0 ? '#fbbf24' : '#94a3b8'}; text-transform: uppercase; letter-spacing: 0.04em;">${escapeHtml(tc.role || 'Competitor')}</span>
            </div>
            <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.72rem; font-weight: 800; font-family: var(--font-mono);">
              🏆 ${tc.titles_count} ${tc.titles_count === 1 ? 'Title' : 'Titles'}
            </span>
          </div>
          <div style="font-size: 1rem; font-weight: 800; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 0.25rem;">
            ${escapeHtml(tc.player_name)}
          </div>
          <div style="font-size: 0.74rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
            ${breakdown.join(' • ')}
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.74rem; color: #94a3b8; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 0.35rem; margin-top: 0.2rem;">
            <span>🛡️ ${escapeHtml(tc.primary_faction || 'General')}</span>
            <span style="color: #38bdf8; font-weight: 700;">Scout Profile →</span>
          </div>
        </div>
      `;
    }).join('');

    const hasMoreThan3 = topChamps.length > 3;
    const expandBtnHtml = hasMoreThan3 ? `
      <div style="text-align: center; margin-top: 0.85rem;">
        <button type="button" class="btn btn-outline btn-sm" onclick="toggleTeamMvpExpand()" id="team-mvp-expand-btn" style="font-size: 0.78rem; font-weight: 700; padding: 0.4rem 1.1rem; border-color: rgba(255,255,255,0.15); border-radius: 6px;">
          <span>${teamReliquaryState.isMvpExpanded ? '▲ Show Top 3 Only' : `▼ View All ${topChamps.length} Decorated Champions (${topChamps.length - 3} More)`}</span>
        </button>
      </div>
    ` : '';

    podiumHtml = `
      <div class="profile-hero-card" style="padding: 1.25rem; margin-bottom: 1.25rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <h4 style="font-size: 0.98rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 0.45rem;">
              <span>👑</span>
              <span>Club MVP Champions (Most Titles Won)</span>
            </h4>
            <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 0.2rem;">
              Competitors who have brought the most tournament silverware home to the clubhouse.
            </div>
          </div>
          <div>
            <button type="button" class="btn btn-ghost btn-sm" onclick="toggleTeamMvpSection()" id="team-mvp-section-toggle-btn" style="font-size: 0.76rem; padding: 0.3rem 0.65rem; color: #94a3b8; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;">
              <span>${teamReliquaryState.isMvpSectionCollapsed ? '▶ Expand Section' : '─ Collapse Section'}</span>
            </button>
          </div>
        </div>

        <div id="team-mvp-section-body" style="${teamReliquaryState.isMvpSectionCollapsed ? 'display: none;' : 'display: block;'}">
          <div id="team-mvp-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 0.75rem;">
            ${podiumCards}
          </div>
          ${expandBtnHtml}
        </div>
      </div>
    `;
  }

  // Silverware Reliquary Section
  // Silverware Reliquary Section
  const reliquaryHtml = `
    <div class="profile-hero-card team-reliquary-container" style="padding: 1.25rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 0.5rem;">
            <span>🏛️</span>
            <span>Silverware Reliquary</span>
            <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 12px; margin-left: 0.2rem;">${items.length} Wins</span>
          </h3>
          <div class="desktop-only" style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 0.2rem;">
            All sanctioned tournament victories and 1st place finishes claimed under the club banner.
            <span style="color: var(--accent); font-weight: 600;">(Click any trophy to inspect the official chronicle)</span>
          </div>
        </div>

        <div>
          <button type="button" class="btn btn-ghost btn-sm" onclick="toggleTeamReliquarySection()" id="team-reliquary-section-toggle-btn" style="font-size: 0.74rem; padding: 0.28rem 0.6rem; color: #94a3b8; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;">
            <span>${teamReliquaryState.isReliquaryCollapsed ? '▶ Expand' : '─ Collapse'}</span>
          </button>
        </div>
      </div>

      <div id="team-reliquary-section-body" style="${teamReliquaryState.isReliquaryCollapsed ? 'display: none;' : 'display: block;'}">
        <!-- Control Bar: Search, Sort Selector & View Mode Toggle -->
        <div class="team-trophies-control-bar" style="margin-bottom: 0.75rem;">
          <div class="team-trophies-controls-inner">
            <div class="team-trophies-search-wrap" style="position: relative; width: 100%; max-width: 380px;">
              <span style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); font-size: 0.85rem; color: #64748b; pointer-events: none; line-height: 1;">🔍</span>
              <input type="text" id="team-trophies-search-input" class="form-control" placeholder="Search tournaments, players, armies..." oninput="filterTeamSilverwareGrid()" style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 0.45rem 0.8rem 0.45rem 2.2rem; font-size: 0.8rem; color: #fff; width: 100%;" />
            </div>

            <div class="team-trophies-actions-row" style="display: flex; align-items: center; gap: 0.5rem;">
              <div style="display: flex; align-items: center; gap: 0.3rem; flex: 1;">
                <span class="desktop-only" style="font-size: 0.74rem; color: var(--text-muted); white-space: nowrap;">Sort:</span>
                <select id="team-trophies-sort-select" onchange="setTeamSilverwareSort(this.value)" class="form-control" style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.12); color: #fff; border-radius: 6px; padding: 0.4rem 0.6rem; font-size: 0.78rem; cursor: pointer; width: 100%;">
                  <option value="tier_desc" ${teamReliquaryState.sort === 'tier_desc' ? 'selected' : ''}>⭐ Highest Tier</option>
                  <option value="date_desc" ${teamReliquaryState.sort === 'date_desc' ? 'selected' : ''}>📅 Most Recent</option>
                  <option value="players_desc" ${teamReliquaryState.sort === 'players_desc' ? 'selected' : ''}>👥 Largest Events</option>
                  <option value="player_asc" ${teamReliquaryState.sort === 'player_asc' ? 'selected' : ''}>👤 Player Name (A-Z)</option>
                </select>
              </div>

              <button type="button" class="btn btn-outline btn-sm" onclick="toggleTeamSilverwarePagination()" id="team-trophies-page-toggle-btn" style="font-size: 0.76rem; padding: 0.4rem 0.7rem; border-color: rgba(255,255,255,0.12); white-space: nowrap; flex-shrink: 0;">
                <span>${teamReliquaryState.isPaginated ? '📄 12 / pg' : '📜 All'}</span>
              </button>
            </div>
          </div>

          <!-- Quick Tier Filter Chips -->
          <div class="team-trophy-filters" style="display: flex; align-items: center; gap: 0.4rem; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; padding-bottom: 0.4rem; margin-top: 0.65rem;">
            <button type="button" class="badge team-trophy-filter-chip ${teamReliquaryState.filter === 'all' ? 'active' : ''}" id="team-trophy-filter-btn-all" onclick="setTeamSilverwareFilter('all')">
              All (${items.length})
            </button>
            ${majorWins > 0 ? `
              <button type="button" class="badge team-trophy-filter-chip ${teamReliquaryState.filter === 'major' ? 'active' : ''}" id="team-trophy-filter-btn-major" onclick="setTeamSilverwareFilter('major')">
                🥇 Majors (${majorWins})
              </button>
            ` : ''}
            ${gtWins > 0 ? `
              <button type="button" class="badge team-trophy-filter-chip ${teamReliquaryState.filter === 'gt' ? 'active' : ''}" id="team-trophy-filter-btn-gt" onclick="setTeamSilverwareFilter('gt')">
                🥈 GTs (${gtWins})
              </button>
            ` : ''}
            ${rttWins > 0 ? `
              <button type="button" class="badge team-trophy-filter-chip ${teamReliquaryState.filter === 'rtt' ? 'active' : ''}" id="team-trophy-filter-btn-rtt" onclick="setTeamSilverwareFilter('rtt')">
                🥉 RTTs (${rttWins})
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Trophies Grid -->
        <div id="team-trophies-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 0.85rem;"></div>

        <!-- Empty Filter State -->
        <div id="team-trophies-empty-filter" style="display: none; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
          No tournament silverware matches your search filter.
        </div>

        <!-- Pagination Bar -->
        <div id="team-trophies-pagination" style="margin-top: 1rem;"></div>
      </div>
    </div>
  `;

  // Delayed rendering of grid and pagination after DOM is ready
  setTimeout(() => {
    renderTeamReliquaryGridAndPagination();
  }, 10);

  return `
    <!-- Top 4 KPI Stats Grid -->
    ${kpisHtml}

    <!-- MVP Champions Podium (Expandable / Collapsible) -->
    ${podiumHtml}

    <!-- Silverware Reliquary (Paginated / Sortable / Collapsible) -->
    ${reliquaryHtml}
  `;
}

window.openTeamProfilePage = openTeamProfilePage;
window.renderTeamProfilePage = renderTeamProfilePage;
window.switchTeamProfileSubtab = switchTeamProfileSubtab;
window.copyTeamShareLink = copyTeamShareLink;
window.filterTeamProfileRoster = filterTeamProfileRoster;
window.setTeamProfileRosterStatus = setTeamProfileRosterStatus;
window.navigateBackFromTeamProfile = navigateBackFromTeamProfile;
window.navigateToUserTeam = navigateToUserTeam;
window.resolveUserTeamName = resolveUserTeamName;
window.detectTeamFromMatchHistory = detectTeamFromMatchHistory;
window.renderUnaffiliatedTeamHub = renderUnaffiliatedTeamHub;
window.confirmAndSetActiveTeam = confirmAndSetActiveTeam;
window.promptManualTeamJoin = promptManualTeamJoin;
window.filterTeamBattleLedger = filterTeamBattleLedger;
window.renderTeamTrophiesPanel = renderTeamTrophiesPanel;
window.setTeamSilverwareFilter = setTeamSilverwareFilter;
window.setTeamSilverwareSort = setTeamSilverwareSort;
window.setTeamSilverwarePage = setTeamSilverwarePage;
window.toggleTeamSilverwarePagination = toggleTeamSilverwarePagination;
window.toggleTeamMvpExpand = toggleTeamMvpExpand;
window.toggleTeamMvpSection = toggleTeamMvpSection;
window.toggleTeamReliquarySection = toggleTeamReliquarySection;
window.filterTeamSilverwareGrid = filterTeamSilverwareGrid;
window.renderTeamReliquaryGridAndPagination = renderTeamReliquaryGridAndPagination;





