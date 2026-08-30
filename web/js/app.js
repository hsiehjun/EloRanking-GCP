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

// PWA Install Prompt Handler on Home Page
let deferredPwaPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPwaPrompt = e;
  window.__deferredPwaPrompt = e;

  const lastDismissed = localStorage.getItem('pwa_install_dismissed');
  if (lastDismissed && (Date.now() - Number(lastDismissed)) < 7 * 24 * 60 * 60 * 1000) {
    return;
  }

  showPwaInstallBanner();
});

function showPwaInstallBanner() {
  if (document.getElementById('pwa-install-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 99999;
    background: rgba(11, 17, 32, 0.96);
    border: 1px solid rgba(56, 189, 248, 0.35);
    border-radius: 16px;
    padding: 14px 18px;
    box-shadow: 0 16px 45px rgba(0,0,0,0.8), 0 0 25px rgba(56,189,248,0.15);
    backdrop-filter: blur(14px);
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: 440px;
    width: calc(100vw - 48px);
    box-sizing: border-box;
    font-family: 'Inter', sans-serif;
  `;

  banner.innerHTML = `
    <img src="/assets/logo.svg" alt="40k Elo" style="width:44px; height:44px; border-radius:10px; border:1px solid #1e293b; flex-shrink:0;">
    <div style="flex:1; min-width:0;">
      <div style="font-size:0.9rem; font-weight:800; color:#fff; font-family:'JetBrains Mono',monospace;">Install 40k Elo App</div>
      <div style="font-size:0.75rem; color:var(--text-muted); line-height:1.35; margin-top:2px;">Get instant access to Elo Rankings, Meta Stats & Game Tracker on your phone or desktop.</div>
    </div>
    <div style="display:flex; align-items:center; gap:8px;">
      <button id="btn-pwa-install" style="background:#0284c7; color:#fff; font-weight:800; font-size:0.75rem; border:none; padding:9px 14px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace; white-space:nowrap; letter-spacing:0.04em;">INSTALL</button>
      <button id="btn-pwa-dismiss" style="background:transparent; border:none; color:var(--text-muted); font-size:1.2rem; cursor:pointer; padding:4px 6px;">✕</button>
    </div>
  `;

  document.body.appendChild(banner);

  document.getElementById('btn-pwa-install').onclick = async () => {
    if (deferredPwaPrompt) {
      deferredPwaPrompt.prompt();
      await deferredPwaPrompt.userChoice;
      deferredPwaPrompt = null;
      window.__deferredPwaPrompt = null;
    }
    banner.remove();
  };

  document.getElementById('btn-pwa-dismiss').onclick = () => {
    localStorage.setItem('pwa_install_dismissed', String(Date.now()));
    banner.remove();
  };
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
