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
  const starting5 = Array.isArray(data.starting_5) && data.starting_5.length > 0
    ? data.starting_5
    : roster.slice(0, 5);

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

    <!-- Symmetrical 3-Column Subtabs Bar (Single clean row on mobile & desktop) -->
    <div class="profile-subtabs-bar team-profile-subtabs-bar" style="margin-bottom: 1.25rem;">
      <button type="button" class="profile-subtab-btn ${currentTeamProfileSubtab === 'overview' ? 'active' : ''}" onclick="switchTeamProfileSubtab('overview')" id="team-subtab-btn-overview">
        <span>🛡️ <span class="tab-label-full">Club Overview</span><span class="tab-label-mobile">Overview</span></span>
      </button>
      <button type="button" class="profile-subtab-btn ${currentTeamProfileSubtab === 'roster' ? 'active' : ''}" onclick="switchTeamProfileSubtab('roster')" id="team-subtab-btn-roster">
        <span>👥 <span class="tab-label-full">Squad Roster</span><span class="tab-label-mobile">Roster</span></span>
        <span class="profile-subtab-count">${roster.length}</span>
      </button>
      <button type="button" class="profile-subtab-btn ${currentTeamProfileSubtab === 'matches' ? 'active' : ''}" onclick="switchTeamProfileSubtab('matches')" id="team-subtab-btn-matches">
        <span>⚔️ <span class="tab-label-full">Tournament Ledger</span><span class="tab-label-mobile">Matches</span></span>
        <span class="profile-subtab-count">${matches > 0 ? matches.toLocaleString() : feed.length}</span>
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

    <!-- Subtab 3: Battlefield Matches Panel -->
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

  ['overview', 'roster', 'matches'].forEach(s => {
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

function navigateToUserTeam() {
  const gs = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  let teamName = null;

  if (window.currentUser && window.currentUser.team && window.currentUser.team.trim()) {
    teamName = window.currentUser.team.trim();
  }

  if (!teamName && window.myHubData && window.myHubData.player && window.myHubData.player.team) {
    teamName = window.myHubData.player.team.trim();
  }

  if (!teamName) {
    try {
      const cached = localStorage.getItem(`my_hub_cache_${gs}`) || localStorage.getItem('my_hub_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        teamName = (parsed?.player?.team || parsed?.team || '').trim();
      }
    } catch (e) {}
  }

  if (!teamName) {
    try {
      const userStr = localStorage.getItem('currentUser');
      if (userStr) {
        const u = JSON.parse(userStr);
        teamName = (u?.team || '').trim();
      }
    } catch (e) {}
  }

  if (!teamName && window.currentProfileData && window.currentProfileData.player && window.currentProfileData.player.team) {
    teamName = window.currentProfileData.player.team.trim();
  }

  if (teamName && typeof openTeamProfilePage === 'function') {
    openTeamProfilePage(teamName, gs);
    return;
  }

  if (typeof openTeamProfilePage === 'function') {
    openTeamProfilePage('Team Zero Comp', gs);
  } else if (typeof switchTab === 'function') {
    switchTab('teams');
  }
}

window.openTeamProfilePage = openTeamProfilePage;
window.renderTeamProfilePage = renderTeamProfilePage;
window.switchTeamProfileSubtab = switchTeamProfileSubtab;
window.copyTeamShareLink = copyTeamShareLink;
window.filterTeamProfileRoster = filterTeamProfileRoster;
window.setTeamProfileRosterStatus = setTeamProfileRosterStatus;
window.navigateBackFromTeamProfile = navigateBackFromTeamProfile;
window.navigateToUserTeam = navigateToUserTeam;
window.filterTeamBattleLedger = filterTeamBattleLedger;


