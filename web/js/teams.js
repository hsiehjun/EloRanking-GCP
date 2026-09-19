/* ==========================================================================
   TEAMS.JS - Official Teams & Clubs System (Team Hub, Power Ratings & Roster)
   ========================================================================== */

let currentTeamHubData = null;
let currentTeamHubSubtab = 'roster';
let userTeamAffiliation = null;
let selectedOnboardingTeamId = null;

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

// --------------------------------------------------------------------------
// 1. MAIN TEAMS VIEW ROUTER: TEAM HUB vs. GLOBAL DIRECTORY
// --------------------------------------------------------------------------

async function loadTeamsView(forceTeamId = null) {
  const container = document.getElementById('teams-view-container');
  if (!container) return;

  container.innerHTML = '<div class="empty-state" style="padding: 3.5rem 1rem;"><div class="spinner"></div><div style="margin-top: 0.75rem;">Loading Official Teams Hub...</div></div>';

  try {
    const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';

    // If specific team requested (e.g. clicked from quick modal or link)
    if (forceTeamId && forceTeamId !== 'directory' && forceTeamId !== 'unaffiliated') {
      const hubRes = await window.api.getTeamHub(forceTeamId, sys);
      if (hubRes && hubRes.team) {
        currentTeamHubData = hubRes.team;
        renderTeamHub(currentTeamHubData, true);
        return;
      }
    }

    // Check user affiliation
    let affRes = null;
    try {
      affRes = await window.api.getMyTeam(sys);
    } catch (e) {}

    userTeamAffiliation = affRes && affRes.affiliation ? affRes.affiliation : null;

    if (affRes && affRes.has_team && affRes.team && forceTeamId !== 'directory' && forceTeamId !== 'unaffiliated') {
      currentTeamHubData = affRes.team;
      renderTeamHub(currentTeamHubData, false);
    } else {
      // User is NOT on a team! Show clean unaffiliated empty state with options to Claim / Found / Search!
      renderUnaffiliatedTeamsView();
    }
  } catch (err) {
    console.error('Error loading teams view:', err);
    container.innerHTML = `<div class="empty-state" style="color:var(--loss); padding: 3rem 1rem;">Error loading Teams Hub: ${escapeHtml(err.message)}</div>`;
  }
}

// --------------------------------------------------------------------------
// 2. RENDER THE 6-TAB TEAM HUB (DIGITAL CLUBHOUSE)
// --------------------------------------------------------------------------

let currentProfileTeamId = null;
let previousTabBeforeTeamProfile = 'search';

function renderTeamHub(team, isPublicView = false, targetContainerId = null) {
  const containerId = targetContainerId || (isPublicView ? 'team-profile-container' : 'teams-view-container');
  const container = document.getElementById(containerId) || document.getElementById('teams-view-container');
  if (!container || !team) return;

  const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const isCaptain = (currentUser && (currentUser.player_id === team.owner_player_id || currentUser.id === team.owner_player_id));
  const isMember = (currentUser && team.roster && team.roster.some(p => p.player_id === currentUser.player_id || p.player_id === currentUser.id));

  const winRate = Number(team.team_win_rate || 0);
  const combatFactor = Number(team.combat_factor || 1.0).toFixed(3);
  const activeCount = Number(team.active_roster_count || (team.roster ? team.roster.length : 1));
  const totalRoster = Number(team.roster_count || (team.roster ? team.roster.length : 1));
  const maturityPct = Number(team.maturity_pct || 100);

  let bannerHtml = `
    <div class="team-command-hero" style="background: linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(30,58,138,0.25) 100%); border: 1px solid rgba(56,189,248,0.3); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 20px 45px rgba(0,0,0,0.6);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;">
        
        <!-- Left: Club Identity & Heraldry -->
        <div class="team-hero-brand-wrap" style="display: flex; align-items: center; gap: 1rem;">
          <div style="width: 64px; height: 64px; border-radius: 14px; background: rgba(56,189,248,0.12); border: 2px solid rgba(56,189,248,0.4); display: flex; align-items: center; justify-content: center; font-size: 2.2rem; box-shadow: 0 0 20px rgba(56,189,248,0.2); flex-shrink: 0;">
            🛡️
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <h1 style="font-size: 1.6rem; font-weight: 900; color: #fff; margin: 0; font-family: var(--font-heading); letter-spacing: 0.02em;">
                ${escapeHtml(team.name)}
              </h1>
              <span class="badge" style="background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.3); font-weight: 800; font-size: 0.8rem; padding: 2px 8px; border-radius: 6px;">
                [${escapeHtml(team.short_tag || 'TEAM')}]
              </span>
              <span class="badge" style="background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-size: 0.72rem; padding: 2px 8px; border-radius: 9999px;">
                👑 #${team.rank || 1} Global (${sys.toUpperCase()})
              </span>
            </div>
            <p style="font-size: 0.84rem; color: #94a3b8; margin: 0.25rem 0 0; line-height: 1.4;">
              ${escapeHtml(team.bio || 'Official competitive tabletop club and tournament squad.')}
            </p>
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-top: 0.4rem; font-size: 0.76rem; color: #cbd5e1; flex-wrap: wrap;">
              <span>📍 ${escapeHtml(team.home_city || 'San Diego')}, ${escapeHtml(team.home_state || 'CA')}</span>
              <span>&bull;</span>
              <span>🏪 ${escapeHtml(team.home_venue || 'Local Game Store')}</span>
              <span>&bull;</span>
              <span>👑 Captain: <strong>${escapeHtml(team.captain_name || 'Captain')}</strong></span>
            </div>
          </div>
        </div>

        <!-- Right: Actions & Switchers -->
        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline" onclick="loadTeamsView('directory')" style="font-size: 0.78rem; padding: 0.45rem 0.85rem; border-radius: 8px; border-color: rgba(255,255,255,0.15); color: #cbd5e1;">
            🌐 Browse All Clubs
          </button>
          ${isCaptain ? `
            <button type="button" class="btn btn-primary" onclick="switchTeamHubSubtab('locker')" style="font-size: 0.78rem; font-weight: 800; padding: 0.45rem 1rem; border-radius: 8px;">
              👑 Captain's Locker
            </button>
          ` : (isMember ? `
            <button type="button" class="btn btn-outline" onclick="confirmLeaveTeam()" style="font-size: 0.78rem; padding: 0.45rem 0.85rem; border-radius: 8px; color: #ef4444; border-color: rgba(239,68,68,0.3);">
              🚪 Leave Club
            </button>
          ` : `
            <button type="button" class="btn btn-primary" onclick="alert('Join request sent to the Captain of ' + '${escapeHtml(team.name)}')" style="font-size: 0.78rem; font-weight: 800; padding: 0.45rem 1rem; border-radius: 8px;">
              ✉️ Request to Join
            </button>
          `)}
        </div>
      </div>

      <!-- Vital Stats Strip -->
      <div class="team-stats-strip" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.85rem; margin-top: 1.25rem; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 1.15rem;">
        <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 0.75rem; text-align: center;">
          <div style="font-size: 0.7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Power Rating</div>
          <div style="font-size: 1.45rem; font-weight: 900; color: #c084fc; font-family: var(--font-mono);">${Number(team.power_rating || 0).toFixed(1)}</div>
          <div style="font-size: 0.68rem; color: #38bdf8;">Top Ace: ${Number(team.top_player_elo || 1500).toFixed(1)}</div>
        </div>

        <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 0.75rem; text-align: center;">
          <div style="font-size: 0.7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Starting 5 Avg</div>
          <div style="font-size: 1.45rem; font-weight: 900; color: #38bdf8; font-family: var(--font-mono);">${Number(team.top5_avg || 1500).toFixed(1)}</div>
          <div style="font-size: 0.68rem; color: #94a3b8;">Club Avg: ${Number(team.active_avg_elo || 1500).toFixed(1)}</div>
        </div>

        <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 0.75rem; text-align: center;">
          <div style="font-size: 0.7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Combat Record</div>
          <div style="font-size: 1.45rem; font-weight: 900; color: #10b981; font-family: var(--font-mono);">${winRate}%</div>
          <div style="font-size: 0.68rem; color: #94a3b8;">${team.total_wins || 0}W - ${team.total_losses || 0}L (${combatFactor}x)</div>
        </div>

        <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 0.75rem; text-align: center;">
          <div style="font-size: 0.7rem; font-weight: 700; color: #94a3b8; text-transform: uppercase;">Active Squad</div>
          <div style="font-size: 1.45rem; font-weight: 900; color: #f59e0b; font-family: var(--font-mono);">${activeCount} <span style="font-size:0.85rem; color:#94a3b8;">/ ${totalRoster}</span></div>
          <div style="font-size: 0.68rem; color: #10b981;">${maturityPct}% Roster Maturity</div>
        </div>
      </div>
    </div>
  `;

  let subtabsNav = `
    <div class="team-hub-subtabs-bar" style="display: flex; gap: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 1.25rem; overflow-x: auto; padding-bottom: 0.35rem;">
      <button type="button" class="team-subtab-btn ${currentTeamHubSubtab === 'roster' ? 'active' : ''}" onclick="switchTeamHubSubtab('roster')">
        👥 Starting 5 &amp; Roster
      </button>
      <button type="button" class="team-subtab-btn ${currentTeamHubSubtab === 'feed' ? 'active' : ''}" onclick="switchTeamHubSubtab('feed')">
        ⚔️ Battlefield Feed
      </button>
      <button type="button" class="team-subtab-btn ${currentTeamHubSubtab === 'trajectory' ? 'active' : ''}" onclick="switchTeamHubSubtab('trajectory')">
        📈 Trajectory
      </button>
      <button type="button" class="team-subtab-btn ${currentTeamHubSubtab === 'warroom' ? 'active' : ''}" onclick="switchTeamHubSubtab('warroom')">
        🎯 War Room &amp; Rivalries
      </button>
      <button type="button" class="team-subtab-btn ${currentTeamHubSubtab === 'trophies' ? 'active' : ''}" onclick="switchTeamHubSubtab('trophies')">
        🏆 Trophy Room
      </button>
      <button type="button" class="team-subtab-btn ${currentTeamHubSubtab === 'locker' ? 'active' : ''}" onclick="switchTeamHubSubtab('locker')">
        🔒 Locker Room
      </button>
    </div>
  `;

  let contentHtml = `
    <div id="team-hub-panel-roster" class="team-hub-panel" style="display: ${currentTeamHubSubtab === 'roster' ? 'block' : 'none'};">
      ${renderSubtabRoster(team)}
    </div>
    <div id="team-hub-panel-feed" class="team-hub-panel" style="display: ${currentTeamHubSubtab === 'feed' ? 'block' : 'none'};">
      ${renderSubtabFeed(team)}
    </div>
    <div id="team-hub-panel-trajectory" class="team-hub-panel" style="display: ${currentTeamHubSubtab === 'trajectory' ? 'block' : 'none'};">
      ${renderSubtabTrajectory(team)}
    </div>
    <div id="team-hub-panel-warroom" class="team-hub-panel" style="display: ${currentTeamHubSubtab === 'warroom' ? 'block' : 'none'};">
      ${renderSubtabWarRoom(team)}
    </div>
    <div id="team-hub-panel-trophies" class="team-hub-panel" style="display: ${currentTeamHubSubtab === 'trophies' ? 'block' : 'none'};">
      ${renderSubtabTrophies(team)}
    </div>
    <div id="team-hub-panel-locker" class="team-hub-panel" style="display: ${currentTeamHubSubtab === 'locker' ? 'block' : 'none'};">
      ${renderSubtabLockerRoom(team)}
    </div>
  `;

  let publicBannerHtml = isPublicView ? `
    <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(56,189,248,0.08); border: 1px solid rgba(56,189,248,0.25); border-radius: 12px; padding: 0.65rem 1.15rem; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.2rem;">🛡️</span>
        <span style="font-size: 0.88rem; color: #cbd5e1;">Public Club Profile &bull; <strong style="color: #fff;">${escapeHtml(team.name)}</strong></span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button type="button" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.35rem 0.85rem;" onclick="navigateBackFromTeamProfile()">
          ⬅ Back
        </button>
        <button type="button" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.35rem 0.85rem;" onclick="copyTeamProfileLink('${escapeHtml(team.name)}')">
          🔗 Share Club
        </button>
      </div>
    </div>
  ` : '';

  container.innerHTML = publicBannerHtml + bannerHtml + subtabsNav + contentHtml;

  if (currentTeamHubSubtab === 'trajectory') {
    drawTeamTrajectoryCanvas(team);
  }
}

async function openTeamProfilePage(teamNameOrId, gameSystem = '', options = {}) {
  if (!teamNameOrId) return;

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

  currentProfileTeamId = String(teamNameOrId).trim();

  // Close modals
  if (typeof closeAllModals === 'function') {
    closeAllModals();
  } else if (typeof closeModal === 'function') {
    closeModal('team-modal');
  }

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
  const profPanel = document.getElementById('tab-team-profile');
  if (profPanel) {
    profPanel.style.removeProperty('display');
    profPanel.classList.add('active');
  }

  // Update URL hash
  const cleanPath = (targetSys === 'aos') ? '/aos' : '';
  const targetHash = `#/${targetSys}/team/${encodeURIComponent(currentProfileTeamId)}`;
  if (window.history && window.history.pushState && !options.replaceUrl) {
    window.history.pushState({ teamId: currentProfileTeamId, sys: targetSys }, '', `${cleanPath || ''}${targetHash}`);
  } else if (window.history && window.history.replaceState) {
    window.history.replaceState({ teamId: currentProfileTeamId, sys: targetSys }, '', `${cleanPath || ''}${targetHash}`);
  }

  const container = document.getElementById('team-profile-container');
  if (container) {
    container.innerHTML = '<div class="empty-state" style="padding: 3.5rem 1rem;"><div class="spinner"></div><div style="margin-top: 0.75rem;">Loading Club Profile...</div></div>';
  }

  try {
    let hub = null;
    // 1. Try getTeamHub
    try {
      const hubRes = await window.api.getTeamHub(currentProfileTeamId, targetSys);
      if (hubRes && hubRes.team) {
        hub = hubRes.team;
      }
    } catch (e) {
      console.debug('getTeamHub notice:', e);
    }

    // 2. Fallback to getTeamRoster (matches existing PostgreSQL production endpoint)
    if (!hub) {
      try {
        const rosterData = await window.api.getTeamRoster(currentProfileTeamId, targetSys);
        if (rosterData && (rosterData.team || (rosterData.roster && rosterData.roster.length > 0))) {
          const tmName = rosterData.team || currentProfileTeamId;
          const st = rosterData.stats || {};
          const rList = rosterData.roster || [];
          hub = {
            id: 'team_' + tmName.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
            name: tmName,
            short_tag: tmName.split(' ').map(w => w[0]).join('').slice(0, 4).toUpperCase() || 'TEAM',
            game_system: targetSys,
            home_venue: 'Competitive Tabletop Circuit',
            home_city: 'San Diego',
            home_state: 'CA',
            bio: `${tmName} official competitive tabletop club and tournament squad.`,
            roster: rList,
            roster_count: st.roster_count || rList.length,
            active_roster_count: st.active_roster_count || rList.length,
            power_rating: st.power_rating || 1500.0,
            combat_factor: st.combat_factor || 1.0,
            active_avg_elo: st.avg_elo || 1500.0,
            top5_avg: st.top5_avg_elo || 1500.0,
            top_player_elo: st.top_player_elo || 1500.0,
            top_player_name: (rList[0] && rList[0].player_name) || 'Top Ace',
            total_matches: st.total_matches || 0,
            total_wins: st.total_wins || 0,
            total_losses: st.total_losses || 0,
            total_draws: st.total_draws || 0,
            team_win_rate: st.win_rate || 0.0,
            starting_5: rList.slice(0, 5),
            battlefield_feed: [],
            trophy_room: [],
            war_room: { faction_matchups: [], club_rivalries: [] },
            locker_room: { messages: [], squad_events: [] }
          };
        }
      } catch (e) {
        console.debug('getTeamRoster notice:', e);
      }
    }

    if (!hub) {
      if (container) {
        container.innerHTML = `<div class="empty-state" style="padding: 3.5rem 1rem;">Club "${escapeHtml(currentProfileTeamId)}" not found.<div style="margin-top: 1rem;"><button class="btn btn-outline" onclick="navigateBackFromTeamProfile()">⬅ Back</button></div></div>`;
      }
      return;
    }

    currentTeamHubData = hub;
    renderTeamHub(hub, true, 'team-profile-container');
  } catch (err) {
    console.error('Error loading team profile:', err);
    if (container) {
      container.innerHTML = `<div class="empty-state" style="color:var(--loss); padding: 3rem 1rem;">Error loading Club Profile: ${escapeHtml(err.message)}</div>`;
    }
  }
}
window.openTeamProfilePage = openTeamProfilePage;

function navigateBackFromTeamProfile() {
  const target = previousTabBeforeTeamProfile || 'search';
  if (typeof switchTab === 'function') {
    switchTab(target);
    if (target === 'search') {
      if (typeof switchSearchSubtab === 'function') switchSearchSubtab('teams');
    }
  }
}
window.navigateBackFromTeamProfile = navigateBackFromTeamProfile;

function copyTeamProfileLink(teamId, sys = '') {
  const targetSys = (sys || (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k')).toLowerCase();
  const cleanPath = (targetSys === 'aos') ? '/aos' : '';
  const url = `${window.location.origin}${cleanPath}#/${targetSys}/team/${encodeURIComponent(teamId)}`;
  navigator.clipboard.writeText(url).then(() => {
    if (typeof showToastNotification === 'function') {
      showToastNotification('🔗 Shareable Club Profile link copied to clipboard!', 'success');
    } else {
      alert('Link copied to clipboard: ' + url);
    }
  }).catch(() => {
    prompt('Copy this link:', url);
  });
}
window.copyTeamProfileLink = copyTeamProfileLink;

function switchTeamHubSubtab(subtabId) {
  currentTeamHubSubtab = subtabId;
  document.querySelectorAll('.team-hub-subtabs-bar .team-subtab-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${subtabId}'`)) {
      btn.classList.add('active');
    }
  });
  document.querySelectorAll('.team-hub-panel').forEach(p => p.style.display = 'none');
  const activePanel = document.getElementById(`team-hub-panel-${subtabId}`);
  if (activePanel) activePanel.style.display = 'block';

  if (subtabId === 'trajectory' && currentTeamHubData) {
    setTimeout(() => drawTeamTrajectoryCanvas(currentTeamHubData), 30);
  }
}

// --------------------------------------------------------------------------
// 3. SUBTAB RENDERERS
// --------------------------------------------------------------------------

function renderSubtabRoster(team) {
  const starting5 = team.starting_5 || (team.roster ? team.roster.slice(0, 5) : []);
  const fullRoster = team.roster || [];
  const factions = team.faction_distribution || [];

  return `
    <div style="display: flex; flex-direction: column; gap: 1.5rem;">
      
      <!-- Starting 5 Showcase Cards -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem;">
          <div>
            <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0;">⭐ Tournament Starting 5</h3>
            <div style="font-size: 0.76rem; color: #94a3b8;">Peak tournament squad driving 40% of the club's Power Rating</div>
          </div>
          <span class="badge" style="background: rgba(56,189,248,0.1); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); font-size: 0.72rem;">Active Roster Anchor</span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.85rem;">
          ${starting5.map((p, idx) => `
            <div class="card" style="background: #090f1d; border: 1px solid rgba(56,189,248,0.25); border-radius: 12px; padding: 0.95rem; cursor: pointer; transition: all 0.2s;" onclick="openPlayerModal('${escapeHtml(p.player_id)}', '${escapeHtml(p.player_name)}')">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                <span style="font-size: 0.72rem; font-weight: 800; color: #f59e0b;">#${idx + 1} SQUAD ANCHOR</span>
                <span style="font-size: 0.68rem; color: #10b981; font-weight: 700;">${escapeHtml(p.form || 'Active')}</span>
              </div>
              <div style="font-weight: 800; font-size: 0.98rem; color: #fff; margin-bottom: 0.2rem;">
                ${escapeHtml(p.player_name)}
              </div>
              <div style="font-size: 0.76rem; color: #38bdf8; margin-bottom: 0.5rem;">
                ⚔️ ${escapeHtml(p.faction || 'Space Marines')}
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 0.45rem; font-size: 0.78rem;">
                <span style="color: #94a3b8;">Elo:</span>
                <span style="font-weight: 800; color: #fff; font-family: var(--font-mono);">${Number(p.current_elo || 1500).toFixed(1)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Faction Distribution Strip -->
      ${factions.length > 0 ? `
        <div style="background: rgba(15,23,42,0.4); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 0.85rem 1rem; display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
          <span style="font-size: 0.78rem; font-weight: 700; color: #94a3b8;">Club Faction Diversity:</span>
          ${factions.map(f => `
            <span class="badge" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: #cbd5e1; font-size: 0.74rem; padding: 2px 8px;">
              ${escapeHtml(f.faction)}: <strong>${f.count}</strong>
            </span>
          `).join('')}
        </div>
      ` : ''}

      <!-- Full Club Ladder Table -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
          <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0;">📋 Complete Active Club Ladder (${fullRoster.length})</h3>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            ${(typeof currentUser !== 'undefined' && currentUser && team.roster && team.roster.some(p => (p.player_id === currentUser.player_id || p.player_id === currentUser.id) && p.role !== 'Captain' && currentUser.player_id !== team.owner_player_id && currentUser.id !== team.owner_player_id)) ? `
              <button type="button" class="btn btn-outline" onclick="promptClaimInactiveCaptain('${escapeHtml(team.id)}')" style="font-size: 0.76rem; color: #fbbf24; border-color: rgba(245,158,11,0.4); padding: 0.35rem 0.85rem; border-radius: 6px;" title="Claim Captaincy if the reigning captain is AFK or inactive">
                👑 Claim Inactive Captaincy
              </button>
            ` : ''}
            ${(typeof currentUser !== 'undefined' && currentUser && (currentUser.player_id === team.owner_player_id || currentUser.id === team.owner_player_id || (team.roster && team.roster.some(p => (p.player_id === currentUser.player_id || p.player_id === currentUser.id) && (p.role === 'Captain' || p.role === 'Co-Captain' || p.role === 'Officer'))))) ? `
              <button type="button" class="btn btn-outline" onclick="promptInviteTeammate('${escapeHtml(team.id)}')" style="font-size: 0.76rem; color: #38bdf8; border-color: rgba(56,189,248,0.4); padding: 0.35rem 0.85rem; border-radius: 6px;">
                ✉️ + Invite Teammate
              </button>
            ` : ''}
          </div>
        </div>
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Competitor</th>
                <th>Role</th>
                <th>Status</th>
                <th>Faction</th>
                <th>Current Elo</th>
                <th>Win Rate</th>
                ${(typeof currentUser !== 'undefined' && currentUser && (currentUser.player_id === team.owner_player_id || currentUser.id === team.owner_player_id || (team.roster && team.roster.some(p => (p.player_id === currentUser.player_id || p.player_id === currentUser.id) && (p.role === 'Captain' || p.role === 'Co-Captain' || p.role === 'Officer'))))) ? `<th>High Command</th>` : ''}
              </tr>
            </thead>
            <tbody>
              ${fullRoster.map((p, idx) => {
                const isCapt = (typeof currentUser !== 'undefined' && currentUser && (currentUser.player_id === team.owner_player_id || currentUser.id === team.owner_player_id || (team.roster && team.roster.some(m => (m.player_id === currentUser.player_id || m.player_id === currentUser.id) && m.role === 'Captain'))));
                const canManage = isCapt || (typeof currentUser !== 'undefined' && currentUser && team.roster && team.roster.some(m => (m.player_id === currentUser.player_id || m.player_id === currentUser.id) && (m.role === 'Co-Captain' || m.role === 'Officer')));
                return `
                <tr onclick="openPlayerModal('${escapeHtml(p.player_id)}', '${escapeHtml(p.player_name)}')" style="cursor: pointer;">
                  <td style="font-family: var(--font-mono); font-weight: 700; color: #94a3b8;">#${idx + 1}</td>
                  <td>
                    <span class="player-link" style="font-weight: 700;">${escapeHtml(p.player_name)}</span>
                  </td>
                  <td>
                    <span class="badge" style="font-size: 0.7rem; background: ${p.role === 'Captain' ? 'rgba(245,158,11,0.15)' : (p.role === 'Co-Captain' ? 'rgba(168,85,247,0.15)' : 'rgba(56,189,248,0.1)')}; color: ${p.role === 'Captain' ? '#f59e0b' : (p.role === 'Co-Captain' ? '#c084fc' : '#38bdf8')};">
                      ${escapeHtml(p.role || 'Member')}
                    </span>
                  </td>
                  <td>
                    <span style="font-size: 0.74rem; color: ${p.status === 'confirmed' ? '#10b981' : '#94a3b8'};">
                      ${p.status === 'confirmed' ? '✓ Confirmed' : 'Provisional'}
                    </span>
                  </td>
                  <td style="font-size: 0.82rem; color: #cbd5e1;">${escapeHtml(p.faction || '-')}</td>
                  <td style="font-family: var(--font-mono); font-weight: 800; color: #fff;">${Number(p.current_elo || 1500).toFixed(1)}</td>
                  <td style="font-family: var(--font-mono); color: ${Number(p.win_rate || 0) >= 60 ? '#10b981' : '#cbd5e1'}; font-weight: 700;">
                    ${Number(p.win_rate || 0)}%
                  </td>
                  ${canManage ? `
                    <td onclick="event.stopPropagation();" style="white-space: nowrap;">
                      ${p.player_id !== team.owner_player_id ? `
                        ${isCapt ? `
                          <button type="button" class="btn-sm" onclick="promptTransferCaptain('${escapeHtml(team.id)}', '${escapeHtml(p.player_id)}', '${escapeHtml(p.player_name)}')" style="font-size: 0.68rem; padding: 3px 7px; background: rgba(245,158,11,0.12); color: #fbbf24; border: 1px solid rgba(245,158,11,0.35); border-radius: 4px; cursor: pointer;" title="Transfer Captaincy">
                            👑 Transfer
                          </button>
                        ` : ''}
                        <button type="button" class="btn-sm" onclick="promptUpdateTeammateRole('${escapeHtml(team.id)}', '${escapeHtml(p.player_id)}', '${escapeHtml(p.player_name)}', '${escapeHtml(p.role || 'Member')}')" style="font-size: 0.68rem; padding: 3px 7px; background: rgba(168,85,247,0.12); color: #c084fc; border: 1px solid rgba(168,85,247,0.35); border-radius: 4px; margin-left: 4px; cursor: pointer;" title="Change Squad Role">
                          🎖️ Role
                        </button>
                        <button type="button" class="btn-sm" onclick="promptRemoveTeammate('${escapeHtml(team.id)}', '${escapeHtml(p.player_id)}', '${escapeHtml(p.player_name)}')" style="font-size: 0.68rem; padding: 3px 7px; background: rgba(239,68,68,0.12); color: #ef4444; border: 1px solid rgba(239,68,68,0.35); border-radius: 4px; margin-left: 4px; cursor: pointer;" title="Remove teammate">
                          🚫 Remove
                        </button>
                      ` : '<span style="font-size: 0.72rem; color: #fbbf24; font-weight: 700;">👑 Sovereign Captain</span>'}
                    </td>
                  ` : ''}
                </tr>
              `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderSubtabFeed(team) {
  const feed = team.battlefield_feed || [];
  if (feed.length === 0) {
    return `<div class="empty-state" style="padding: 3rem;">No recent battlefield games recorded under this club banner.</div>`;
  }

  return `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0;">⚔️ Battlefield Feed &amp; Match History</h3>
        <span style="font-size: 0.76rem; color: #94a3b8;">Live matches recorded wearing the club jersey</span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        ${feed.map(m => `
          <div class="card" style="background: #090f1d; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 1rem;">
            ${m.is_team_round ? `
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 1.3rem;">🏆</span>
                  <div>
                    <div style="font-weight: 800; font-size: 0.96rem; color: #f59e0b;">${escapeHtml(m.match_title || 'Team Match')}</div>
                    <div style="font-size: 0.74rem; color: #94a3b8;">${escapeHtml(m.tournament || 'Tournament')} &bull; ${escapeHtml(m.round || '')}</div>
                  </div>
                </div>
                <span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-weight: 800;">
                  ${escapeHtml(m.round_score || 'VICTORY')}
                </span>
              </div>
              ${m.notes ? `<p style="font-size: 0.8rem; color: #cbd5e1; margin: 0.5rem 0 0; line-height: 1.4;">${escapeHtml(m.notes)}</p>` : ''}
            ` : `
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                  <div style="font-size: 0.74rem; color: #94a3b8;">${escapeHtml(m.tournament || 'Tournament')} &bull; ${escapeHtml(m.round || 'Singles')}</div>
                  <div style="font-weight: 800; font-size: 0.95rem; color: #fff; margin-top: 2px;">
                    <span style="color: #38bdf8;">${escapeHtml(m.player_name || 'Teammate')}</span> (${escapeHtml(m.faction || '')}) 
                    <span style="color: #94a3b8; font-weight: 400;">def.</span> 
                    ${escapeHtml(m.opponent_name || 'Opponent')}
                    ${m.opponent_team ? `<span style="color: #94a3b8; font-size: 0.76rem;">[${escapeHtml(m.opponent_team)}]</span>` : ''}
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-family: var(--font-mono); font-weight: 800; color: #fff;">${escapeHtml(m.score || 'Won')}</div>
                  <div style="font-size: 0.72rem; color: #10b981; font-weight: 700;">${escapeHtml(m.elo_delta || '+12 Elo')}</div>
                </div>
              </div>
            `}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSubtabTrajectory(team) {
  const pts = team.trajectory_points || [
    { month: 'Oct 2025', power_rating: 1796, rank: 3, milestone: 'Post-SoCal Open & Chicago Grand Tournament' },
    { month: 'Nov 2025', power_rating: 1854, rank: 2, milestone: 'Mid-Season Roster Expansion & 180-Day Calibration' },
    { month: 'Dec 2025', power_rating: 1913, rank: 2, milestone: 'Pre-LVO Boot Camp & Pariah Nexus Testing' },
    { month: 'Jan 2026', power_rating: team.power_rating || 1952, rank: 1, milestone: 'Las Vegas Open Championship Title' }
  ];

  return `
    <div style="display: flex; flex-direction: column; gap: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0 0 0.25rem;">📈 Power Rating &amp; Global Rank Trajectory</h3>
          <div style="font-size: 0.76rem; color: #94a3b8;">Historical club rating movement and leaderboard standing across tournament phases</div>
        </div>
        <span class="badge" style="background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.3); font-size: 0.72rem; font-weight: 700;">
          👑 Current: #${team.rank || 1} Global (${Number(team.power_rating || 1952).toFixed(1)})
        </span>
      </div>

      <!-- Explanatory Architecture Banner -->
      <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(56,189,248,0.2); border-radius: 10px; padding: 0.85rem 1rem; font-size: 0.78rem; color: #cbd5e1; line-height: 1.5;">
        <strong style="color: #38bdf8;">💡 How Trajectory is Tracked:</strong> OmniTactica snapshots each club's Power Rating at the close of every monthly circuit phase. At each milestone, the engine retroactively evaluates the club's active roster against each player's exact match Elo in the PostgreSQL event ledger, calculating:
        <span style="font-family: var(--font-mono); color: #c084fc;"> Rating(t) = Baseline Roster Strength(t) × Roster Maturity(t) × 180-Day Trailing Combat Factor(t)</span>.
      </div>

      <div style="background: #090f1d; border: 1px solid rgba(56,189,248,0.25); border-radius: 12px; padding: 1.25rem; text-align: center;">
        <canvas id="team-trajectory-canvas" width="800" height="280" style="width: 100%; max-width: 800px; height: 260px; display: block; margin: 0 auto;"></canvas>

        <!-- Seasonal Milestones Table -->
        <div style="margin-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 1rem; text-align: left;">
          <h4 style="font-size: 0.9rem; font-weight: 800; color: #fff; margin: 0 0 0.65rem;">Season Performance Milestones</h4>
          <div class="table-container">
            <table class="table" style="font-size: 0.8rem; width: 100%;">
              <thead>
                <tr>
                  <th>Phase / Period</th>
                  <th>Power Rating</th>
                  <th>Global Rank</th>
                  <th>Circuit Phase &amp; Event Milestone</th>
                </tr>
              </thead>
              <tbody>
                ${pts.map(tp => `
                  <tr>
                    <td style="font-family: var(--font-mono); color: #38bdf8; font-weight: 700;">${escapeHtml(tp.month)}</td>
                    <td style="font-family: var(--font-mono); font-weight: 800; color: #c084fc;">${Number(tp.power_rating).toFixed(1)}</td>
                    <td style="font-family: var(--font-mono); font-weight: 700; color: #10b981;">#${tp.rank || 1}</td>
                    <td style="color: #cbd5e1;">${escapeHtml(tp.milestone || 'Sanctioned GT Circuit Season Record')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function drawTeamTrajectoryCanvas(team) {
  const canvas = document.getElementById('team-trajectory-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const pts = team.trajectory_points || [
    { month: 'Oct 2025', power_rating: 1796 },
    { month: 'Nov 2025', power_rating: 1854 },
    { month: 'Dec 2025', power_rating: 1913 },
    { month: 'Jan 2026', power_rating: team.power_rating || 1952 }
  ];

  const padLeft = 60;
  const padRight = 40;
  const padTop = 40;
  const padBottom = 45;

  const minVal = Math.min(...pts.map(p => p.power_rating)) - 60;
  const maxVal = Math.max(...pts.map(p => p.power_rating)) + 60;

  // Horizontal Grid lines & Y-axis labels
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#64748b';
  ctx.font = '600 10px monospace';
  ctx.textAlign = 'right';

  for (let i = 0; i <= 4; i++) {
    const y = padTop + (h - padTop - padBottom) * (i / 4);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(w - padRight, y);
    ctx.stroke();

    const val = maxVal - (maxVal - minVal) * (i / 4);
    ctx.fillText(Math.round(val), padLeft - 10, y + 4);
  }

  // Draw smooth gradient curve
  const stepX = (w - padLeft - padRight) / (pts.length - 1 || 1);
  const coords = pts.map((p, idx) => {
    const x = padLeft + idx * stepX;
    const norm = (p.power_rating - minVal) / (maxVal - minVal || 1);
    const y = (h - padBottom) - norm * (h - padTop - padBottom);
    return { x, y, p };
  });

  // Gradient fill
  const grad = ctx.createLinearGradient(0, padTop, 0, h - padBottom);
  grad.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
  grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

  ctx.beginPath();
  ctx.moveTo(coords[0].x, h - padBottom);
  coords.forEach(c => ctx.lineTo(c.x, c.y));
  ctx.lineTo(coords[coords.length - 1].x, h - padBottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Stroke line
  ctx.beginPath();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  coords.forEach((c, idx) => {
    if (idx === 0) ctx.moveTo(c.x, c.y);
    else ctx.lineTo(c.x, c.y);
  });
  ctx.stroke();

  // Data nodes & X-axis month labels
  coords.forEach(c => {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#070b14';
    ctx.stroke();

    // Rating Label above
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(Number(c.p.power_rating).toFixed(0), c.x, c.y - 12);

    // Month Label below on X-axis
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 11px sans-serif';
    ctx.fillText(c.p.month || '', c.x, h - padBottom + 22);
  });
}

function renderSubtabWarRoom(team) {
  const warRoom = team.war_room || {};
  const matchups = warRoom.faction_matchups || [];
  const rivalries = warRoom.club_rivalries || [];

  return `
    <div style="display: flex; flex-direction: column; gap: 1.5rem;">
      <!-- Head to Head Club Rivalries -->
      <div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0 0 0.25rem;">⚔️ Head-to-Head Club Rivalries</h3>
        <div style="font-size: 0.76rem; color: #94a3b8; margin-bottom: 0.85rem;">Historical tournament match record against rival wargaming clubs</div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.85rem;">
          ${rivalries.map(r => `
            <div class="card" style="background: #090f1d; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 1rem;">
              <div style="font-weight: 800; font-size: 1rem; color: #fff;">vs. ${escapeHtml(r.rival_team)}</div>
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin: 0.5rem 0;">
                <span style="font-family: var(--font-mono); font-size: 1.35rem; font-weight: 900; color: ${r.win_rate >= 50 ? '#10b981' : '#ef4444'}; font-family: var(--font-mono);">
                  ${r.wins}W - ${r.losses}L
                </span>
                <span style="font-size: 0.82rem; font-weight: 700; color: #38bdf8;">${r.win_rate}% Win%</span>
              </div>
              <div style="font-size: 0.72rem; color: #94a3b8;">Last clash: ${escapeHtml(r.last_played || 'Recent GT')}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Faction Matchups -->
      <div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0 0 0.25rem;">🎯 Club vs. Faction Win Rate Matrix</h3>
        <div style="font-size: 0.76rem; color: #94a3b8; margin-bottom: 0.85rem;">Cumulative record across all club games against target enemy armies</div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem;">
          ${matchups.map(m => `
            <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-weight: 700; font-size: 0.86rem; color: #fff;">${escapeHtml(m.enemy_faction)}</div>
                <div style="font-size: 0.7rem; color: #94a3b8;">${m.wins}W - ${m.losses}L (${m.encounters} games)</div>
              </div>
              <div style="font-family: var(--font-mono); font-weight: 800; font-size: 0.95rem; color: ${m.win_rate >= 60 ? '#10b981' : (m.win_rate >= 45 ? '#38bdf8' : '#ef4444')};">
                ${m.win_rate}%
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderSubtabTrophies(team) {
  const trophies = team.trophy_room || [];
  return `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0;">🏆 Club Trophy Room &amp; Honors</h3>
        <div style="font-size: 0.76rem; color: #94a3b8;">Championship banners, major titles, and certified club milestones</div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem;">
        ${trophies.map(t => `
          <div class="card" style="background: #090f1d; border: 1px solid rgba(245,158,11,0.3); border-radius: 12px; padding: 1.1rem;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 0.5rem;">
              <span style="font-size: 1.8rem;">${escapeHtml(t.icon || '🏆')}</span>
              <div>
                <div style="font-size: 0.7rem; font-weight: 700; color: #f59e0b; text-transform: uppercase;">${escapeHtml(t.category || 'Title')}</div>
                <div style="font-weight: 800; font-size: 1rem; color: #fff;">${escapeHtml(t.title)}</div>
              </div>
            </div>
            <p style="font-size: 0.8rem; color: #cbd5e1; margin: 0.4rem 0 0; line-height: 1.4;">
              ${escapeHtml(t.significance || '')}
            </p>
            <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 0.4rem; text-align: right;">
              ${escapeHtml(t.awarded_date || '')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSubtabLockerRoom(team) {
  const locker = team.locker_room || {};
  const pinned = locker.pinned_message;
  const messages = locker.messages || [];
  const squadEvents = locker.squad_events || [];

  return `
    <div style="display: flex; flex-direction: column; gap: 1.5rem;">
      
      <!-- Pinned Captain Announcement -->
      ${pinned ? `
        <div style="background: linear-gradient(135deg, rgba(30,58,138,0.3) 0%, rgba(15,23,42,0.8) 100%); border: 1px solid rgba(56,189,248,0.4); border-radius: 12px; padding: 1.15rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
            <span style="font-size: 0.74rem; font-weight: 800; color: #38bdf8; text-transform: uppercase;">📌 PINNED CAPTAIN ANNOUNCEMENT</span>
            <span style="font-size: 0.72rem; color: #94a3b8;">${escapeHtml(pinned.sender_name)}</span>
          </div>
          <p style="font-size: 0.88rem; color: #fff; margin: 0; line-height: 1.45;">
            ${escapeHtml(pinned.message)}
          </p>
        </div>
      ` : ''}

      <!-- Squad Travel Calendar -->
      <div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0 0 0.25rem;">📅 Squad Travel &amp; Tournament Coordination</h3>
        <div style="font-size: 0.76rem; color: #94a3b8; margin-bottom: 0.85rem;">Upcoming events where teammates are competing</div>

        <div style="display: flex; flex-direction: column; gap: 0.85rem;">
          ${squadEvents.map(ev => `
            <div class="card" style="background: #090f1d; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 1rem;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                  <div style="font-weight: 800; font-size: 1rem; color: #fff;">${escapeHtml(ev.event_name)}</div>
                  <div style="font-size: 0.76rem; color: #38bdf8; margin-top: 2px;">📍 ${escapeHtml(ev.venue || '')} &bull; 🗓️ ${escapeHtml(ev.event_date || 'Upcoming')}</div>
                </div>
                <button type="button" class="btn btn-primary" onclick="toggleTeamSquadEventAttendance('${escapeHtml(team.id)}', '${escapeHtml(ev.event_id)}')" style="font-size: 0.76rem; padding: 0.4rem 0.85rem; border-radius: 6px;">
                  ✓ I'm Attending
                </button>
              </div>
              <div style="margin-top: 0.65rem; font-size: 0.78rem; color: #cbd5e1;">
                <strong>Attending (${ev.confirmed_attendees ? ev.confirmed_attendees.length : 0}):</strong> ${(ev.confirmed_attendees || []).join(', ')}
              </div>
              ${ev.notes ? `<div style="font-size: 0.74rem; color: #94a3b8; margin-top: 0.35rem;">🚗 ${escapeHtml(ev.notes)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Team Message Board / Locker Room Chat -->
      <div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0 0 0.75rem;">💬 Squad Bulletin Board</h3>
        <div style="background: #090f1d; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; overflow: hidden;">
          <div id="team-locker-messages-list" style="padding: 1.15rem; display: flex; flex-direction: column; gap: 0.85rem; max-height: 320px; overflow-y: auto;">
            ${messages.map(m => `
              <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.75rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                  <span style="font-weight: 800; font-size: 0.82rem; color: #38bdf8;">${escapeHtml(m.sender_name)} <span style="font-size:0.68rem; color:#94a3b8; font-weight:400;">(${escapeHtml(m.role || 'Member')})</span></span>
                  <span style="font-size: 0.68rem; color: #94a3b8;">${new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <p style="font-size: 0.84rem; color: #fff; margin: 0; line-height: 1.4;">${escapeHtml(m.message)}</p>
              </div>
            `).join('')}
          </div>

          <!-- Message input -->
          <div style="padding: 0.85rem 1.15rem; border-top: 1px solid rgba(255,255,255,0.08); background: rgba(15,23,42,0.5); display: flex; gap: 0.5rem;">
            <input type="text" id="team-locker-msg-input" class="search-input" placeholder="Post a tactical update or list question..." style="flex: 1; font-size: 0.84rem;" onkeydown="if(event.key === 'Enter') sendTeamLockerMessage('${escapeHtml(team.id)}')">
            <button type="button" class="btn btn-primary" onclick="sendTeamLockerMessage('${escapeHtml(team.id)}')" style="font-size: 0.8rem; font-weight: 800; padding: 0.45rem 1.1rem;">
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// 4. UNAFFILIATED SQUAD EMPTY STATE & TEAMS DIRECTORY
// --------------------------------------------------------------------------

function renderUnaffiliatedTeamsView() {
  const container = document.getElementById('teams-view-container');
  if (!container) return;

  container.innerHTML = `
    <div class="team-unaffiliated-container" style="max-width: 760px; margin: 2rem auto; text-align: center; padding: 3rem 1.5rem; background: linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(30,58,138,0.2) 100%); border: 1px solid rgba(56,189,248,0.25); border-radius: 20px; box-shadow: 0 20px 45px rgba(0,0,0,0.5);">
      <div style="width: 76px; height: 76px; border-radius: 18px; background: rgba(56,189,248,0.12); border: 2px solid rgba(56,189,248,0.4); display: flex; align-items: center; justify-content: center; font-size: 2.6rem; margin: 0 auto 1.25rem; box-shadow: 0 0 25px rgba(56,189,248,0.25);">
        🛡️
      </div>
      <h2 style="font-size: 1.7rem; font-weight: 900; color: #fff; margin: 0 0 0.65rem; font-family: var(--font-heading);">
        No Team Affiliation
      </h2>
      <p style="font-size: 0.92rem; color: #94a3b8; max-width: 520px; margin: 0 auto 2rem; line-height: 1.6;">
        You currently compete as an <strong style="color: #38bdf8;">Independent</strong> on Global Leaderboards. Compete under an official team banner to participate in squad events, coordinate war rooms, earn Glory honors, and climb the club rankings.
      </p>

      <div style="display: flex; justify-content: center; gap: 0.85rem; flex-wrap: wrap; margin-bottom: 2rem;">
        <button type="button" class="btn btn-primary" onclick="checkAndShowTeamOnboardingModal()" style="font-size: 0.88rem; font-weight: 800; padding: 0.65rem 1.3rem; border-radius: 8px; display: inline-flex; align-items: center; gap: 8px;">
          <span>🛡️</span>
          <span>Select Team from History</span>
        </button>
        <button type="button" class="btn btn-outline" onclick="openCreateTeamModal()" style="font-size: 0.88rem; font-weight: 700; padding: 0.65rem 1.3rem; border-radius: 8px; display: inline-flex; align-items: center; gap: 8px;">
          <span>➕</span>
          <span>Found a Brand New Club</span>
        </button>
        <button type="button" class="btn btn-outline" onclick="switchTab('search'); switchSearchSubtab('teams');" style="font-size: 0.88rem; font-weight: 700; padding: 0.65rem 1.3rem; border-radius: 8px; display: inline-flex; align-items: center; gap: 8px;">
          <span>🔍</span>
          <span>Browse Clubs in Search</span>
        </button>
      </div>

      <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 1.15rem 1.35rem; max-width: 560px; margin: 0 auto; text-align: left; display: flex; align-items: flex-start; gap: 0.85rem;">
        <span style="font-size: 1.3rem; margin-top: 1px;">💡</span>
        <div style="font-size: 0.82rem; color: #cbd5e1; line-height: 1.5;">
          <strong style="color: #fff;">Looking for other teams?</strong>
          Clubs can be explored and searched anytime in the <a href="javascript:void(0)" onclick="switchTab('search'); switchSearchSubtab('teams');" style="color: #38bdf8; font-weight: 700; text-decoration: underline;">Search Tab</a> or on the <a href="javascript:void(0)" onclick="switchTab('leaderboard');" style="color: #38bdf8; font-weight: 700; text-decoration: underline;">Leaderboard</a>. Clicking any club opens its quick roster modal with the option to inspect its full digital clubhouse.
        </div>
      </div>
    </div>
  `;
}

let teamsDirectoryCache = { '40k': null, 'aos': null };

async function loadTeamsDirectory(forceRefresh = false) {
  const queryInput = document.getElementById('teams-search-input');
  const query = (queryInput ? queryInput.value.trim() : '').toLowerCase();
  const minRosterSelect = document.getElementById('teams-min-roster-filter');
  const minRoster = minRosterSelect ? parseInt(minRosterSelect.value, 10) : 1;
  const tbody = document.getElementById('teams-body');
  const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';

  // Fast in-memory filter if cached
  if (!forceRefresh && teamsDirectoryCache[sys] && teamsDirectoryCache[sys].length > 0) {
    filterAndRenderCachedTeams(query, minRoster, sys);
    return;
  }

  if (tbody && (!teamsDirectoryData || teamsDirectoryData.length === 0)) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading teams directory...</div></td></tr>';
  }

  try {
    const res = await window.api.getTeamsDirectory('', 1, 'power_rating', 'DESC', 1, 100, sys);
    const allItems = (res && res.items) ? res.items : (Array.isArray(res) ? res : ((res && res.teams) ? res.teams : []));
    teamsDirectoryCache[sys] = allItems;
    filterAndRenderCachedTeams(query, minRoster, sys);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error loading teams directory: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function filterAndRenderCachedTeams(query, minRoster, sys) {
  let list = teamsDirectoryCache[sys] || [];
  if (query) {
    list = list.filter(t => {
      const name = (t.name || t.team || '').toLowerCase();
      const tag = (t.short_tag || '').toLowerCase();
      const capt = (t.captain_name || '').toLowerCase();
      const city = (t.home_city || '').toLowerCase();
      return name.includes(query) || tag.includes(query) || capt.includes(query) || city.includes(query);
    });
  }
  if (minRoster > 1) {
    list = list.filter(t => (t.roster_count || (t.roster ? t.roster.length : 0)) >= minRoster);
  }

  // Sort
  const field = teamsSortState.field || 'power_rating';
  const asc = teamsSortState.asc;
  list.sort((a, b) => {
    let valA = a[field];
    let valB = b[field];
    if (field === 'team') {
      valA = a.name || a.team || '';
      valB = b.name || b.team || '';
      return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    valA = Number(valA != null ? valA : 0);
    valB = Number(valB != null ? valB : 0);
    return asc ? valA - valB : valB - valA;
  });

  teamsPagination.total = list.length;
  teamsPagination.totalPages = Math.max(1, Math.ceil(list.length / teamsPagination.pageSize));
  if (teamsPagination.page > teamsPagination.totalPages) teamsPagination.page = 1;

  const start = (teamsPagination.page - 1) * teamsPagination.pageSize;
  teamsDirectoryData = list.slice(start, start + teamsPagination.pageSize);

  renderTeamsDirectoryRows();
  if (typeof renderPaginationBar === 'function') {
    renderPaginationBar('teams-pagination', teamsPagination, 'setTeamsPage', 'setTeamsPageSize');
  }
}

function renderTeamsDirectoryRows() {
  const tbody = document.getElementById('teams-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!teamsDirectoryData || teamsDirectoryData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No clubs found matching search criteria.</td></tr>';
    return;
  }

  teamsDirectoryData.forEach(t => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    const teamName = t.name || t.team || '';
    tr.onclick = () => openTeamModal(teamName);

    const winRate = Number(t.team_win_rate || 0);
    const avgElo = Number(t.avg_elo || t.active_avg_elo || 1500).toFixed(1);
    const topPlayerElo = Number(t.top_player_elo || 1500).toFixed(1);
    const topPlayerName = t.top_player_name || 'Top Player';
    const topPlayerId = t.top_player_id || '';

    tr.innerHTML = `
      <td>
        <div style="font-weight: 700; color: #fff; display: flex; align-items: center; gap: 0.45rem;">
          <span>🛡️</span>
          <span class="player-link" style="font-size: 0.92rem;">${escapeHtml(teamName)}</span>
          <span class="badge" style="font-size: 0.68rem; background: rgba(168,85,247,0.12); color: #c084fc;">[${escapeHtml(t.short_tag || 'TEAM')}]</span>
        </div>
        <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">📍 ${escapeHtml(t.home_city || 'San Diego')}</div>
      </td>
      <td>
        <span style="font-family: var(--font-mono); font-weight: 900; font-size: 1.05rem; color: #c084fc;">
          ${Number(t.power_rating || 0).toFixed(1)}
        </span>
      </td>
      <td style="font-family: var(--font-mono); font-weight: 600; color: var(--accent);">
        ${avgElo}
      </td>
      <td>
        <span class="player-link" style="font-size: 0.85rem;" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(topPlayerId)}', '${escapeHtml(topPlayerName)}')">
          ${escapeHtml(topPlayerName)}
        </span>
        <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted); margin-left: 0.3rem;">
          (${topPlayerElo})
        </span>
      </td>
      <td style="font-family: var(--font-mono); font-weight: 600;">
        <span class="badge" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); font-size: 0.75rem;">
          ${t.roster_count || (t.roster ? t.roster.length : 1)} Players
        </span>
      </td>
      <td style="font-family: var(--font-mono); font-size: 0.85rem;">
        <span style="color: var(--win); font-weight: 600;">${t.total_wins || 0}W</span> - 
        <span style="color: var(--loss); font-weight: 600;">${t.total_losses || 0}L</span>
        ${t.total_draws ? ` - <span style="color: var(--draw); font-weight: 600;">${t.total_draws}D</span>` : ''}
      </td>
      <td style="font-family: var(--font-mono); font-weight: 600;">
        <span style="color: ${winRate >= 55 ? 'var(--win)' : (winRate >= 45 ? 'var(--accent)' : 'var(--text-secondary)')};">
          ${winRate}%
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// --------------------------------------------------------------------------
// 5. ONBOARDING MODAL LOGIC ("CLAIM YOUR TEAM")
// --------------------------------------------------------------------------

async function checkAndShowTeamOnboardingModal(forceOpen = false) {
  if (!currentUser) return;

  try {
    const pid = (currentUser && (currentUser.player_id || currentUser.bcp_user_id || currentUser.id)) || '';
    const affRes = await window.api.getMyTeam('', pid);
    if (!forceOpen && affRes && affRes.has_team && affRes.affiliation && affRes.affiliation.confirmed_at && affRes.affiliation.team_id) {
      return; // Already confirmed!
    }

    const modal = document.getElementById('team-onboarding-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    const listEl = document.getElementById('team-onboarding-detected-list');
    if (listEl) {
      listEl.innerHTML = '<div class="empty-state" style="padding: 1.5rem;"><div class="spinner"></div><div style="margin-top:0.5rem;">Scanning tournament records...</div></div>';
    }

    const pname = (currentUser && (currentUser.display_name || currentUser.name)) || '';
    const historyRes = await window.api.getDetectedTeams(pid, pname);
    const detected = (historyRes && Array.isArray(historyRes.detected)) ? historyRes.detected : [];

    if (listEl) {
      if (detected.length === 0) {
        listEl.innerHTML = '<div style="font-size:0.82rem; color:#94a3b8; padding:0.5rem;">No historical tournament team tags detected. Choose an option below:</div>';
      } else {
        listEl.innerHTML = detected.map((d, idx) => `
          <div class="onboarding-team-card" id="onboarding-card-${escapeHtml(d.team_id)}" onclick="selectOnboardingOption('${escapeHtml(d.team_id)}')" style="background: #090f1d; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 0.85rem 1rem; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: all 0.2s;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 1.2rem;">🛡️</span>
              <div>
                <div style="font-weight: 800; font-size: 0.94rem; color: #fff;">
                  ${escapeHtml(d.name)} <span style="font-size:0.74rem; color:#c084fc;">[${escapeHtml(d.short_tag || 'TEAM')}]</span>
                </div>
                <div style="font-size: 0.72rem; color: #94a3b8;">
                  ${d.match_count} Matches recorded &bull; Last played: ${escapeHtml(d.last_played || 'Recent')}
                </div>
              </div>
            </div>
            <span class="onboarding-select-pill badge" style="background: rgba(56,189,248,0.1); color: #38bdf8; font-size: 0.76rem;">
              Select ➔
            </span>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.warn('Notice checking team onboarding modal:', err);
  }
}

function selectOnboardingOption(teamId) {
  selectedOnboardingTeamId = teamId;
  const btn = document.getElementById('btn-confirm-onboarding-team');
  if (btn) {
    btn.disabled = false;
    btn.textContent = (teamId === 'independent') ? 'Confirm as Independent' : 'Confirm My Team';
  }

  document.querySelectorAll('.onboarding-team-card').forEach(c => {
    c.style.borderColor = 'rgba(255,255,255,0.1)';
    c.style.background = '#090f1d';
  });
  const chosenCard = document.getElementById(`onboarding-card-${teamId}`);
  if (chosenCard) {
    chosenCard.style.borderColor = '#38bdf8';
    chosenCard.style.background = 'rgba(56,189,248,0.08)';
  }

  const indepBtn = document.getElementById('btn-onboarding-opt-independent');
  if (indepBtn) {
    if (teamId === 'independent') {
      indepBtn.style.borderColor = '#38bdf8';
      indepBtn.style.background = 'rgba(56,189,248,0.12)';
    } else {
      indepBtn.style.borderColor = 'rgba(255,255,255,0.12)';
      indepBtn.style.background = 'rgba(15,23,42,0.4)';
    }
  }
}

async function submitOnboardingTeamChoice() {
  if (!selectedOnboardingTeamId) return;

  const btn = document.getElementById('btn-confirm-onboarding-team');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Confirming...';
  }

  try {
    const pid = (currentUser && (currentUser.player_id || currentUser.bcp_user_id || currentUser.id)) || '';
    const pname = (currentUser && (currentUser.display_name || currentUser.name)) || '';
    const res = await window.api.confirmTeamAffiliation(selectedOnboardingTeamId, pid, pname);
    closeTeamOnboardingModal();
    if (typeof showToastNotification === 'function') {
      showToastNotification('🛡️ Official Team Affiliation Confirmed!', 'success');
    }
    loadTeamsView(selectedOnboardingTeamId);
  } catch (err) {
    alert(`Error confirming team: ${err.message}`);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Confirm My Team';
    }
  }
}

function closeTeamOnboardingModal() {
  const modal = document.getElementById('team-onboarding-modal');
  if (modal) modal.style.display = 'none';
}

// --------------------------------------------------------------------------
// 6. CREATE TEAM MODAL
// --------------------------------------------------------------------------

function openCreateTeamModal() {
  const modal = document.getElementById('create-team-modal');
  if (modal) modal.style.display = 'flex';
}

function openCreateTeamModalFromOnboarding() {
  closeTeamOnboardingModal();
  openCreateTeamModal();
}

function closeCreateTeamModal() {
  const modal = document.getElementById('create-team-modal');
  if (modal) modal.style.display = 'none';
}

async function submitCreateTeamHub() {
  const nameInput = document.getElementById('create-team-name-input');
  const tagInput = document.getElementById('create-team-tag-input');
  const sysSelect = document.getElementById('create-team-sys-select');
  const venueInput = document.getElementById('create-team-venue-input');
  const cityInput = document.getElementById('create-team-city-input');
  const stateInput = document.getElementById('create-team-state-input');
  const bioInput = document.getElementById('create-team-bio-input');

  const name = nameInput ? nameInput.value.trim() : '';
  const tag = tagInput ? tagInput.value.trim() : '';
  if (!name || !tag) {
    alert('Please provide both a Team Name and a Short Tag.');
    return;
  }

  const payload = {
    name,
    short_tag: tag,
    game_system: sysSelect ? sysSelect.value : '40k',
    home_venue: venueInput ? venueInput.value.trim() : '',
    home_city: cityInput ? cityInput.value.trim() : 'San Diego',
    home_state: stateInput ? stateInput.value.trim() : 'CA',
    bio: bioInput ? bioInput.value.trim() : ''
  };

  try {
    const res = await window.api.createTeam(payload);
    closeCreateTeamModal();
    if (typeof showToastNotification === 'function') {
      showToastNotification(`🛡️ Team Hub Founded: ${name}!`, 'success');
    }
    loadTeamsView(res.team ? res.team.id : name);
  } catch (err) {
    alert(`Error founding team: ${err.message}`);
  }
}

// --------------------------------------------------------------------------
// 7. LOCKER ROOM MESSAGING & SQUAD TRAVEL
// --------------------------------------------------------------------------

async function sendTeamLockerMessage(teamId) {
  const input = document.getElementById('team-locker-msg-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  try {
    await window.api.postTeamMessage(teamId, msg);
    // Reload feed
    const hubRes = await window.api.getTeamHub(teamId);
    if (hubRes && hubRes.team) {
      currentTeamHubData = hubRes.team;
      const listEl = document.getElementById('team-locker-messages-list');
      if (listEl && currentTeamHubData.locker_room) {
        listEl.innerHTML = (currentTeamHubData.locker_room.messages || []).map(m => `
          <div style="background: rgba(15,23,42,0.6); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0.75rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
              <span style="font-weight: 800; font-size: 0.82rem; color: #38bdf8;">${escapeHtml(m.sender_name)}</span>
              <span style="font-size: 0.68rem; color: #94a3b8;">${new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
            <p style="font-size: 0.84rem; color: #fff; margin: 0; line-height: 1.4;">${escapeHtml(m.message)}</p>
          </div>
        `).join('');
        listEl.scrollTop = listEl.scrollHeight;
      }
    }
  } catch (err) {
    alert(`Error posting message: ${err.message}`);
  }
}

async function toggleTeamSquadEventAttendance(teamId, eventId) {
  try {
    const res = await window.api.toggleSquadEventAttendance(teamId, eventId);
    if (typeof showToastNotification === 'function') {
      showToastNotification(res.attending ? '✓ Added to Squad Event Attendee List!' : 'Removed from Attendee List', 'info');
    }
    const hubRes = await window.api.getTeamHub(teamId);
    if (hubRes && hubRes.team) {
      currentTeamHubData = hubRes.team;
      switchTeamHubSubtab('locker');
    }
  } catch (err) {
    alert(`Error updating attendance: ${err.message}`);
  }
}

async function confirmLeaveTeam() {
  if (!confirm('Are you sure you want to leave this club? You will compete as an Independent.')) return;
  try {
    await window.api.leaveTeam();
    if (typeof showToastNotification === 'function') {
      showToastNotification('You are now competing as an Independent.', 'info');
    }
    loadTeamsView('directory');
  } catch (err) {
    alert(`Error leaving team: ${err.message}`);
  }
}

async function promptInviteTeammate(teamId) {
  const name = prompt("Enter player name or BCP username to invite to the squad:");
  if (!name || !name.trim()) return;
  const targetName = name.trim();
  const targetId = "p_" + targetName.toLowerCase().replace(/[^a-z0-9]/g, "_");
  try {
    const res = await window.api.inviteTeamMember(teamId, targetId, targetName);
    if (typeof showToastNotification === 'function') {
      showToastNotification(`✉️ Official squad invitation extended to ${targetName}!`, 'success');
    }
    loadTeamsView(teamId);
  } catch (err) {
    alert(`Error inviting teammate: ${err.message}`);
  }
}

async function promptTransferCaptain(teamId, targetId, targetName) {
  if (!confirm(`👑 Transfer High Command Captaincy of this club to ${targetName}?\n\nYou will step down to Officer, and they will become the new sovereign Team Captain.`)) {
    return;
  }
  try {
    const res = await window.api.transferTeamCaptaincy(teamId, targetId);
    if (typeof showToastNotification === 'function') {
      showToastNotification(`👑 Leadership transferred to ${targetName}!`, 'success');
    }
    loadTeamsView(teamId);
  } catch (err) {
    alert(`Error transferring captaincy: ${err.message}`);
  }
}

async function promptRemoveTeammate(teamId, targetId, targetName) {
  if (!confirm(`🚫 Remove ${targetName} from the official squad roster?\n\nThey will be set to Independent and removed from the active lineup.`)) {
    return;
  }
  try {
    const res = await window.api.removeTeamMember(teamId, targetId);
    if (typeof showToastNotification === 'function') {
      showToastNotification(`🛡️ ${targetName} removed from squad roster.`, 'info');
    }
    loadTeamsView(teamId);
  } catch (err) {
    alert(`Error removing member: ${err.message}`);
  }
}

async function promptClaimInactiveCaptain(teamId) {
  if (!confirm(`👑 Claim Sovereign Team Captaincy?\n\nIf the reigning Team Captain is inactive, AFK, or non-responsive, you may initiate High Command succession. You will assume Team Captaincy and former leadership will transition to Officer.`)) {
    return;
  }
  try {
    const pid = (currentUser && (currentUser.player_id || currentUser.bcp_user_id || currentUser.id)) || '';
    const res = await window.api.claimInactiveCaptaincy(teamId, pid, 'Leadership inactivity');
    if (typeof showToastNotification === 'function') {
      showToastNotification(`👑 Succession confirmed! You are now the Team Captain.`, 'success');
    }
    loadTeamsView(teamId);
  } catch (err) {
    alert(`Error claiming captaincy: ${err.message}`);
  }
}

async function promptUpdateTeammateRole(teamId, targetId, targetName, currentRole) {
  const options = ['Co-Captain', 'Officer', 'Core', 'Member', 'Provisional'];
  const newRole = prompt(`Assign squad rank/role for ${targetName}:\n(Available: ${options.join(', ')})\n\nNote: Co-Captains have full squad invite/kick/governance permissions if the Captain is unavailable.`, currentRole || 'Member');
  if (!newRole || !newRole.trim()) return;
  const cleanRole = newRole.trim();
  const matched = options.find(o => o.toLowerCase() === cleanRole.toLowerCase());
  if (!matched) {
    alert(`Invalid role. Please choose one of: ${options.join(', ')}`);
    return;
  }
  try {
    await window.api.updateTeamMemberRole(teamId, targetId, matched);
    if (typeof showToastNotification === 'function') {
      showToastNotification(`🎖️ ${targetName}'s rank updated to ${matched}!`, 'success');
    }
    loadTeamsView(teamId);
  } catch (err) {
    alert(`Error updating role: ${err.message}`);
  }
}

window.loadTeamsView = loadTeamsView;
window.renderTeamHub = renderTeamHub;
window.renderUnaffiliatedTeamsView = renderUnaffiliatedTeamsView;
window.switchTeamHubSubtab = switchTeamHubSubtab;
window.loadTeamsDirectory = loadTeamsDirectory;
window.renderTeamsDirectoryRows = renderTeamsDirectoryRows;
window.setTeamsPage = setTeamsPage;
window.setTeamsPageSize = setTeamsPageSize;
window.debounceTeamsSearch = debounceTeamsSearch;
window.checkAndShowTeamOnboardingModal = checkAndShowTeamOnboardingModal;
window.selectOnboardingOption = selectOnboardingOption;
window.submitOnboardingTeamChoice = submitOnboardingTeamChoice;
window.closeTeamOnboardingModal = closeTeamOnboardingModal;
window.openCreateTeamModal = openCreateTeamModal;
window.openCreateTeamModalFromOnboarding = openCreateTeamModalFromOnboarding;
window.closeCreateTeamModal = closeCreateTeamModal;
window.submitCreateTeamHub = submitCreateTeamHub;
window.sendTeamLockerMessage = sendTeamLockerMessage;
window.toggleTeamSquadEventAttendance = toggleTeamSquadEventAttendance;
window.promptInviteTeammate = promptInviteTeammate;
window.promptTransferCaptain = promptTransferCaptain;
window.promptRemoveTeammate = promptRemoveTeammate;
window.promptClaimInactiveCaptain = promptClaimInactiveCaptain;
window.promptUpdateTeammateRole = promptUpdateTeammateRole;
window.confirmLeaveTeam = confirmLeaveTeam;
window.openTeamProfilePage = openTeamProfilePage;
window.navigateBackFromTeamProfile = navigateBackFromTeamProfile;
window.copyTeamProfileLink = copyTeamProfileLink;
