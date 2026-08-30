/* ==========================================================================
   APP.JS - Main App Router, Navigation & Initialization (v6.0)
   ========================================================================== */

let activeTab = 'leaderboard';

function switchTab(tabName) {
  activeTab = tabName;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.remove('active');
    if (b.getAttribute('onclick') && b.getAttribute('onclick').includes(`'${tabName}'`)) {
      b.classList.add('active');
    }
  });

  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.remove('active');
  });

  const activePanel = document.getElementById(`tab-${tabName}`);
  if (activePanel) activePanel.classList.add('active');

  // Trigger lazy loading of view data
  if (tabName === 'leaderboard') {
    loadLeaderboard();
  } else if (tabName === 'search') {
    switchSearchSubtab('players');
  } else if (tabName === 'events') {
    loadEvents();
  } else if (tabName === 'event-studio') {
    // Event Studio WIP panel active
  } else if (tabName === 'my-hub') {
    if (!currentUser) {
      window.location.href = '/login?redirect=' + encodeURIComponent('/?tab=my-hub');
      return;
    }
    if (typeof loadMyHubDashboard === 'function') loadMyHubDashboard();
  }
}

function switchSearchSubtab(subtab) {
  const btnPlayers = document.getElementById('search-subtab-players');
  const btnTeams = document.getElementById('search-subtab-teams');
  const viewPlayers = document.getElementById('search-view-players');
  const viewTeams = document.getElementById('search-view-teams');

  if (btnPlayers) btnPlayers.classList.toggle('active', subtab === 'players');
  if (btnTeams) btnTeams.classList.toggle('active', subtab === 'teams');

  if (viewPlayers) viewPlayers.style.display = (subtab === 'players') ? 'block' : 'none';
  if (viewTeams) viewTeams.style.display = (subtab === 'teams') ? 'block' : 'none';

  if (subtab === 'teams') {
    if (typeof loadTeamsDirectory === 'function') loadTeamsDirectory();
  } else {
    if (typeof loadPlayersDirectory === 'function') loadPlayersDirectory();
  }
}

function filterByFaction(faction) {
  switchTab('leaderboard');
  switchLeaderboardSubtab('players');
  const sel = document.getElementById('faction-filter');
  if (sel) {
    sel.value = faction;
    loadLeaderboard();
  }
}

function filterByTeam(team) {
  switchTab('search');
  switchSearchSubtab('teams');
  const input = document.getElementById('teams-search-input');
  if (input) {
    input.value = team;
    loadTeamsDirectory();
  }
}

async function loadGlobalStats() {
  try {
    const stats = await window.api.getStats();
    const elP = document.getElementById('stat-total-players');
    if (elP) elP.innerText = formatNumber(stats.total_players || 0);
    const elM = document.getElementById('stat-total-matches');
    if (elM) elM.innerText = formatNumber(stats.total_matches || 0);
    const elE = document.getElementById('stat-total-events');
    if (elE) elE.innerText = formatNumber(stats.total_events || 0);
    const elTop = document.getElementById('stat-top-player');
    if (elTop) elTop.innerText = stats.top_player_name || '-';
    const elTopElo = document.getElementById('stat-top-elo');
    if (elTopElo) elTopElo.innerText = stats.top_player_elo ? Number(stats.top_player_elo).toFixed(1) : '-';

    // Populate faction filter options
    const factionSelect = document.getElementById('faction-filter');
    const dirFactionSelect = document.getElementById('dir-faction-filter');

    if (stats.factions && stats.factions.length > 0) {
      if (factionSelect) {
        factionSelect.innerHTML = '<option value="All">All Factions</option>';
        stats.factions.forEach(f => {
          const opt = document.createElement('option');
          opt.value = f;
          opt.innerText = f;
          factionSelect.appendChild(opt);
        });
      }
      if (dirFactionSelect) {
        dirFactionSelect.innerHTML = '<option value="All">All Factions</option>';
        stats.factions.forEach(f => {
          const opt = document.createElement('option');
          opt.value = f;
          opt.innerText = f;
          dirFactionSelect.appendChild(opt);
        });
      }
    }
  } catch (err) {
    console.error('Failed to load summary stats:', err);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof initAuth === 'function') {
    await initAuth();
  }
  if (typeof renderHeaderAuth === 'function') {
    renderHeaderAuth();
  }
  loadGlobalStats();

  const params = new URLSearchParams(window.location.search);
  const targetTab = params.get('tab') || (window.location.hash ? window.location.hash.replace('#', '') : null);
  if (targetTab) {
    switchTab(targetTab);
  } else {
    switchTab('leaderboard');
  }
});
