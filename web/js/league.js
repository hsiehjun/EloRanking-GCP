/**
 * LEAGUE.JS - Sovereign Community Leagues Engine for OmniTactica.
 * Faithfully implements the San Diego Force Org (SD40K) 38-season battle-tested methodology.
 * Supports Season 38 Pods, Standings, Pairings, Hall of Fame, Rules, and 1-Click Community Duplication.
 */

var leagueState = (typeof window !== 'undefined' && window.leagueState) || {
  activeLeagueId: 'league_sd40k_big_league',
  currentLeagueData: null,
  activeSubtab: 'pods', // 'pods', 'hof', 'methodology'
  activePodNumber: 1,
  activePairingRound: 'all', // 'all', 1, 2, 3, 4, 5
  isLoading: false,
  hofCategory: 'finals_champions' // 'finals_champions', 'titles_and_champs', 'most_games', 'most_wins', 'finals_wins', 'faction_titles'
};
if (typeof window !== 'undefined') window.leagueState = leagueState;

/**
 * Main entry point to navigate to a Detailed League Page (Private via League ID)
 */
async function openLeagueHubPage(leagueId = 'league_sd40k_big_league', gameSystem = '40k', options = {}) {
  if (typeof closeAllModals === 'function') closeAllModals();
  if (typeof closeEditLocationModal === 'function') closeEditLocationModal();
  let rawId = (leagueId || 'league_sd40k_big_league').trim().toLowerCase();
  const cleanId = (rawId === 'sd40k' || rawId === 'lg_sd40k' || rawId === 'league_sd40k_big_league' || rawId === 'lg_sd40k_big_league')
    ? 'league_sd40k_big_league'
    : rawId;
  leagueState.activeLeagueId = cleanId;
  if (options.initialSubtab) {
    leagueState.activeSubtab = options.initialSubtab;
  }
  if (options.pod) {
    leagueState.activePodNumber = parseInt(options.pod, 10) || 1;
  }

  // Switch tab panel to tab-league-hub
  if (typeof switchTab === 'function') {
    activeTab = 'league-hub';
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.remove('active');
      p.style.removeProperty('display');
    });
    const panel = document.getElementById('tab-league-hub');
    if (panel) {
      panel.style.removeProperty('display');
      panel.classList.add('active');
    }
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  }

  // Update URL hash with canonical League ID
  if (options.replaceUrl && window.history && window.history.replaceState) {
    window.history.replaceState(null, '', `/#/40k/league/${cleanId}`);
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
  await loadLeagueData(cleanId);
}

/**
 * Loads league data from /api/league/{id}
 */
async function loadLeagueData(leagueId) {
  const container = document.getElementById('league-hub-container');
  if (!container) return;

  const cleanId = (leagueId || 'sd40k').replace(/^lg_/, '').toLowerCase();
  if (!leagueState._cache) leagueState._cache = {};

  const cached = leagueState._cache[cleanId];
  if (cached && (Date.now() - cached.timestamp < 60000)) {
    leagueState.currentLeagueData = cached.data;
    renderLeagueHub(cached.data);
    return;
  }

  leagueState.isLoading = true;
  container.innerHTML = `
    <div class="empty-state" style="padding: 4rem 1rem; text-align: center;">
      <div class="spinner"></div>
      <div style="margin-top: 1rem; font-weight: 600; color: var(--text-primary);">Loading League Hub for ${escapeHtml(cleanId.toUpperCase())}...</div>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">Fetching Season 38 Pods & Historical Records</div>
    </div>
  `;

  try {
    const res = await fetch(`/api/league/${encodeURIComponent(cleanId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success || !json.league) throw new Error(json.error || 'Failed to load league');
    leagueState.currentLeagueData = json.league;
    leagueState.currentLeagueData.selected_season = 38;
    leagueState.currentLeagueData.is_historical = false;
    leagueState._cache[cleanId] = { data: json.league, timestamp: Date.now() };
    if (!leagueState._seasonCache) leagueState._seasonCache = {};
    leagueState._seasonCache[38] = json.league;
    renderLeagueHub(json.league);
  } catch (err) {
    console.error('Error loading league data:', err);
    container.innerHTML = `
      <div class="empty-state" style="padding: 3rem 1rem; text-align: center;">
        <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🛡️</div>
        <div style="font-size: 1.25rem; font-weight: 700; color: #ef4444; margin-bottom: 0.5rem;">League Hub Not Found</div>
        <div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1.5rem;">Could not load data for league "${escapeHtml(leagueId)}".</div>
        <button onclick="switchTab('community')" class="btn btn-outline">← Back to Community Hub</button>
      </div>
    `;
  } finally {
    leagueState.isLoading = false;
  }
}

/**
 * Renders the entire League Hub interface
 */
function renderLeagueHub(league) {
  const container = document.getElementById('league-hub-container');
  if (!container) return;

  const actSeason = league.active_season || {};
  const pods = actSeason.pods || [];
  const currentPod = pods.find(p => p.pod_number === leagueState.activePodNumber) || pods[0] || {};

  const availableSeasons = (league.available_seasons && league.available_seasons.length > 0)
    ? league.available_seasons
    : Array.from({ length: 38 }, (_, i) => {
        const sNum = 38 - i;
        return {
          season_number: sNum,
          name: `Season ${sNum}` + (sNum === 38 ? ' (Fall 2026)' : (sNum === 37 ? ' (Spring 2026)' : '')),
          status: sNum === 38 ? 'active' : 'completed',
          total_pods: sNum === 38 ? 8 : 7,
          total_players: sNum === 38 ? 68 : 60
        };
      });
  const currentSeasonNum = parseInt(league.selected_season || actSeason.season_number || 38, 10);

  container.innerHTML = `
    <!-- League Hero Banner -->
    <div class="card" style="margin-bottom: 1.25rem; background: linear-gradient(135deg, rgba(30, 58, 138, 0.25) 0%, rgba(15, 23, 42, 0.8) 100%); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px; padding: 1.25rem; position: relative; overflow: hidden;">
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
        <div style="display: flex; align-items: flex-start; gap: 1rem; flex: 1 1 440px; min-width: 0; max-width: 100%; flex-wrap: wrap;">
          <div style="width: 64px; height: 64px; border-radius: 12px; background: linear-gradient(135deg, #2563eb, #1e40af); display: flex; align-items: center; justify-content: center; font-size: 2rem; color: #fff; box-shadow: 0 8px 24px rgba(37, 99, 235, 0.4); flex-shrink: 0; border: 2px solid rgba(255, 255, 255, 0.15);">
            🛡️
          </div>
          <div style="flex: 1 1 220px; min-width: 0; max-width: 100%;">
            <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.35rem; max-width: 100%;">
              <h1 style="margin: 0; font-size: clamp(1.25rem, 3.2vw, 1.65rem); font-weight: 800; color: #fff; letter-spacing: -0.02em; word-break: break-word;">${escapeHtml(league.name)}</h1>
              <span style="background: rgba(16, 185, 129, 0.16); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.38); padding: 3px 9px; border-radius: 999px; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.03em;">
                ⚡ ${escapeHtml(actSeason.name || 'Season 38 (Fall 2026)')} • Current Active Season
              </span>
            </div>
            <div style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 0.5rem; word-break: break-word;">
              ${escapeHtml(league.tagline || 'Southern California Premier 40k Pod League')}
            </div>
            <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap; font-size: 0.78rem; color: #cbd5e1;">
              <span>📍 <strong>${escapeHtml(league.region || league.city || 'San Diego, CA')}</strong></span>
              <span>•</span>
              <span>👔 Commissioners: <strong>${escapeHtml((league.commissioners || []).map(c => c.name.split(' ')[0]).join(' & ') || 'Coop & Ben')}</strong></span>
              <span>•</span>
              <span>🏢 Host Store: <strong>${escapeHtml((league.partner_venues && league.partner_venues[0]?.name) || 'At Ease Games')}</strong></span>
            </div>
          </div>
        </div>

        <!-- External Link Only -->
        <div style="display: flex; align-items: center; justify-content: flex-end; flex-shrink: 0;">
          <a href="https://sd40k.com" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size: 0.8rem; padding: 0.45rem 0.95rem; text-align: center; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;">
            <span>🌐 Official Website (sd40k.com)</span>
          </a>
        </div>
      </div>

      ${window.isEventStudioCommissionerView ? `
      <!-- Commissioner-Only Control Strip (Hidden from public by default; shown in Event Studio or when Commissioner mode is toggled) -->
      <div id="league-commissioner-strip" style="margin-top: 1rem; padding: 0.75rem 1rem; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
        <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap; font-size: 0.8rem; color: #cbd5e1;">
          <span id="league-comm-reg-badge" style="background: ${league.registration_open !== false ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.2)'}; color: ${league.registration_open !== false ? '#34d399' : '#94a3b8'}; border: 1px solid ${league.registration_open !== false ? 'rgba(16, 185, 129, 0.4)' : 'rgba(148, 163, 184, 0.3)'}; padding: 3px 8px; border-radius: 999px; font-weight: 800; font-size: 0.72rem;">
            ${league.registration_open !== false ? '🟢 REGISTRATION OPEN IN SPARRING RADAR' : '🔒 REGISTRATION CLOSED'}
          </span>
          <span>🔁 <strong>Auto-Recurring Seasons:</strong> Enabled (${actSeason.duration_weeks || 8} Wks • ${actSeason.rounds_count || 5} Games)</span>
          <span>•</span>
          <span>⚖️ <strong>Pod Rules:</strong> 6–8 Players / Pod (Evenly Distributed) • Top 2 ▲ Up 1 • Bottom 2 ▼ Down 1 • Middle ● Stay • New Entrants → Bottom Pod</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <button id="league-comm-toggle-reg-btn" onclick="toggleLeagueRegistrationWindow('${escapeHtml(league.league_id || 'league_sd40k_big_league')}')" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; border-color: rgba(16, 185, 129, 0.45); color: #34d399; font-weight: 700;">
            📡 ${league.registration_open !== false ? 'Close Registration Window' : 'Open Registration in Sparring Radar'}
          </button>
          <button onclick="viewLeagueInSparringRadar()" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; border-color: rgba(59, 130, 246, 0.45); color: #60a5fa; font-weight: 700;">
            👀 Preview in Sparring Radar
          </button>
          <button onclick="openLeagueRolloverPreviewModal('${escapeHtml(league.league_id || 'league_sd40k_big_league')}')" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.35rem 0.75rem; border-color: rgba(245, 158, 11, 0.45); color: #fbbf24; font-weight: 700;">
            🔄 Preview Season Rollover
          </button>
        </div>
      </div>
      ` : ''}

      <!-- 4 Generic Season KPI Badges -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.75rem; margin-top: 1rem; border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 1rem;">
        <div style="background: rgba(0, 0, 0, 0.25); padding: 0.6rem 0.85rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);">
          <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Active Players</div>
          <div style="font-size: 1.35rem; font-weight: 800; color: #60a5fa;">${actSeason.total_players || 68}</div>
        </div>
        <div style="background: rgba(0, 0, 0, 0.25); padding: 0.6rem 0.85rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);">
          <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Active Pods</div>
          <div style="font-size: 1.35rem; font-weight: 800; color: #a78bfa;">${actSeason.total_pods || 8} Pods</div>
        </div>
        <div style="background: rgba(0, 0, 0, 0.25); padding: 0.6rem 0.85rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);">
          <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">DB Matched Profiles</div>
          <div style="font-size: 1.35rem; font-weight: 800; color: #34d399;">${actSeason.db_matched_players_count || 62} / ${actSeason.total_players || 68}</div>
        </div>
        <div style="background: rgba(0, 0, 0, 0.25); padding: 0.6rem 0.85rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);">
          <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Historical Legacy</div>
          <div style="font-size: 1.35rem; font-weight: 800; color: #fbbf24;">38 Seasons</div>
        </div>
      </div>
    </div>

    <!-- Main League Subtabs -->
    <div class="subtabs-bar" style="display: flex; gap: 0.5rem; margin-bottom: 1.25rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; overflow-x: auto;">
      <button class="subtab-btn ${leagueState.activeSubtab === 'pods' ? 'active' : ''}" onclick="switchLeagueSubtab('pods')">
        <span>🛡️ ${league.is_historical ? escapeHtml(actSeason.name || `Season ${actSeason.season_number}`) : 'Season 38'} Pods, Standings & Pairings</span>
      </button>
      <button class="subtab-btn ${leagueState.activeSubtab === 'hof' ? 'active' : ''}" onclick="switchLeagueSubtab('hof')">
        <span>🏆 Hall of Fame & 38-Season Historical Archives</span>
      </button>
      <button class="subtab-btn ${leagueState.activeSubtab === 'methodology' ? 'active' : ''}" onclick="switchLeagueSubtab('methodology')">
        <span>📜 Pod Automation & Rules</span>
      </button>
    </div>

    <!-- Subtab Body -->
    <div id="league-subtab-content">
      ${renderLeagueSubtabContent(league, currentPod)}
    </div>
  `;
}

/**
 * Switches the active subtab in League Hub
 */
function switchLeagueSubtab(subtab) {
  leagueState.activeSubtab = subtab;
  const league = leagueState.currentLeagueData;
  if (!league) return;

  document.querySelectorAll('#tab-league-hub .subtab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event?.currentTarget?.classList.add('active');

  const content = document.getElementById('league-subtab-content');
  if (content) {
    const actSeason = league.active_season || {};
    const pods = actSeason.pods || [];
    const currentPod = pods.find(p => p.pod_number === leagueState.activePodNumber) || pods[0] || {};
    content.innerHTML = renderLeagueSubtabContent(league, currentPod);
  }
}

/**
 * Switches active pod
 */
function switchPod(podNumber) {
  leagueState.activePodNumber = parseInt(podNumber, 10) || 1;
  const league = leagueState.currentLeagueData;
  if (!league) return;

  const content = document.getElementById('league-subtab-content');
  if (content) {
    const actSeason = league.active_season || {};
    const pods = actSeason.pods || [];
    const currentPod = pods.find(p => p.pod_number === leagueState.activePodNumber) || pods[0] || {};
    content.innerHTML = renderLeagueSubtabContent(league, currentPod);
  }
}

/**
 * Switches Hall of Fame category
 */
function switchHofCategory(category) {
  leagueState.hofCategory = category;
  const league = leagueState.currentLeagueData;
  if (!league) return;
  const content = document.getElementById('league-subtab-content');
  if (content) {
    content.innerHTML = renderHallOfFameSubtab(league);
  }
}

/**
 * Renders the active subtab content
 */
function renderLeagueSubtabContent(league, currentPod) {
  if (leagueState.activeSubtab === 'pods') {
    return renderPodsSubtab(league, currentPod);
  } else if (leagueState.activeSubtab === 'hof') {
    return renderHallOfFameSubtab(league);
  } else if (leagueState.activeSubtab === 'methodology') {
    return renderMethodologySubtab(league);
  }
  return '';
}

function switchLeaguePairingRound(roundVal) {
  leagueState.activePairingRound = roundVal === 'all' ? 'all' : (parseInt(roundVal, 10) || 'all');
  const league = leagueState.currentLeagueData;
  if (!league) return;
  const content = document.getElementById('league-subtab-content');
  if (content) {
    const actSeason = league.active_season || {};
    const pods = actSeason.pods || [];
    const currentPod = pods.find(p => p.pod_number === leagueState.activePodNumber) || pods[0] || {};
    content.innerHTML = renderLeagueSubtabContent(league, currentPod);
  }
}
window.switchLeaguePairingRound = switchLeaguePairingRound;

/**
 * Renders Pods, Standings & Round 1-5 Pairings Subtab
 */
function renderPodsSubtab(league, currentPod) {
  const actSeason = league.active_season || {};
  const pods = actSeason.pods || [];
  const standings = currentPod.standings || [];
  const layouts = (actSeason.season_config && actSeason.season_config.round_layouts) || currentPod.round_layouts || ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"];
  const nStandings = standings.length;
  const totalPodsCount = pods.length || 8;

  // Build deduplicated Round 1-5 pairings for the selected pod with player DB identity metadata
  const seenPairs = new Set();
  const allPodPairings = [];
  const factionByPlayer = {};
  const identityByPlayer = {};
  standings.forEach(st => {
    if (st.name) {
      const k = st.name.toLowerCase();
      factionByPlayer[k] = st.primary_faction || 'Warhammer 40k';
      identityByPlayer[k] = {
        bcp_player_id: st.bcp_player_id || st.player_id || null,
        user_id: st.user_id || null,
        is_db_matched: Boolean(st.is_db_matched && (st.bcp_player_id || st.player_id))
      };
    }
  });

  standings.forEach(s => {
    const p1Name = s.name || '';
    const p1Faction = s.primary_faction || 'Warhammer 40k';
    const p1Ident = identityByPlayer[p1Name.toLowerCase()] || {};
    (s.pairings || []).forEach(m => {
      const p2Name = m.opponent_name || '';
      if (!p1Name || !p2Name || p2Name === 'BYE') return;
      const rNum = parseInt(m.round, 10) || 1;
      const pairNames = [p1Name.trim().toLowerCase(), p2Name.trim().toLowerCase()].sort();
      const key = `R${rNum}_${pairNames[0]}__${pairNames[1]}`;
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      const p2Ident = identityByPlayer[p2Name.toLowerCase()] || {
        bcp_player_id: m.opponent_bcp_player_id || null,
        user_id: m.opponent_user_id || null,
        is_db_matched: Boolean(m.opponent_is_db_matched && m.opponent_bcp_player_id)
      };
      allPodPairings.push({
        round: rNum,
        layout: m.layout || layouts[(rNum - 1) % layouts.length] || 'Layout A',
        p1_name: p1Name,
        p1_faction: p1Faction,
        p1_bcp_player_id: p1Ident.bcp_player_id,
        p1_is_db_matched: p1Ident.is_db_matched,
        p2_name: p2Name,
        p2_faction: factionByPlayer[p2Name.toLowerCase()] || 'Warhammer 40k',
        p2_bcp_player_id: p2Ident.bcp_player_id,
        p2_is_db_matched: p2Ident.is_db_matched,
        score: m.score || null,
        is_completed: !!m.is_completed
      });
    });
  });

  allPodPairings.sort((a, b) => a.round - b.round);
  const selectedRound = leagueState.activePairingRound || 'all';
  const filteredPairings = selectedRound === 'all'
    ? allPodPairings
    : allPodPairings.filter(m => m.round === selectedRound);

  return `
    <!-- Pod Switcher Pills -->
    <div style="display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.5rem; margin-bottom: 1.25rem;">
      ${pods.map(p => {
        const isAct = p.pod_number === leagueState.activePodNumber;
        return `
          <button onclick="switchPod(${p.pod_number})" style="
            padding: 0.55rem 1rem;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 600;
            white-space: nowrap;
            cursor: pointer;
            transition: all 0.15s ease;
            background: ${isAct ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : 'var(--bg-card)'};
            color: ${isAct ? '#fff' : 'var(--text-secondary)'};
            border: 1px solid ${isAct ? '#3b82f6' : 'var(--border)'};
            box-shadow: ${isAct ? '0 4px 12px rgba(37, 99, 235, 0.3)' : 'none'};
          ">
            <span>Pod #${p.pod_number}</span>
            <span style="opacity: 0.8; font-size: 0.75rem; margin-left: 4px;">(${escapeHtml(p.name.replace(/^POD #\d+ - /, ''))})</span>
          </button>
        `;
      }).join('')}
    </div>

    <!-- Standings Table -->
    <div class="card" style="margin-bottom: 1.5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; overflow: hidden;">
      <div style="padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem;">
        <div style="font-weight: 700; font-size: 1rem; color: #fff;">🏆 Pod #${currentPod.pod_number} Standings &amp; Automated Pod Movement</div>
        <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
          <span style="font-size: 0.78rem; color: var(--text-muted);">Players matched in our DB (<span style="color:#38bdf8;text-decoration:underline;">blue</span>) are clickable</span>
          <button onclick="openLeaguePlayerClaimModal('${escapeHtml(league.league_id || 'league_sd40k_big_league')}')" class="btn btn-outline" style="font-size: 0.74rem; padding: 0.3rem 0.7rem; border-color: rgba(59, 130, 246, 0.45); color: #60a5fa; font-weight: 700;">
            🙋‍♂️ I'm in this League
          </button>
        </div>
      </div>

      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
          <thead>
            <tr style="background: rgba(0, 0, 0, 0.3); border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase;">
              <th style="padding: 0.75rem 1rem; width: 45px;">Rank</th>
              <th style="padding: 0.75rem 1rem;">Player</th>
              <th style="padding: 0.75rem 1rem;">Primary Faction</th>
              <th style="padding: 0.75rem 0.75rem; text-align: center;">Record</th>
              <th style="padding: 0.75rem 0.75rem; text-align: center;">Battle Points</th>
              <th style="padding: 0.75rem 0.75rem; text-align: center;">POTY Pts</th>
              <th style="padding: 0.75rem 1rem; text-align: center;">Automated Pod Trajectory</th>
              <th style="padding: 0.75rem 1rem; text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${standings.map((s, idx) => {
              const rankNum = s.rank || (idx + 1);
              let relBadge = '<span style="background: rgba(148, 163, 184, 0.12); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.25); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.72rem;">● Stay (Pod ' + currentPod.pod_number + ')</span>';
              if (currentPod.pod_number === 1 && rankNum <= 2) {
                relBadge = '<span style="background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.4); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.72rem;">★ Finals Seed (Pod 1)</span>';
              } else if (rankNum <= 2 && currentPod.pod_number > 1) {
                relBadge = `<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.72rem;">▲ +1 Pod → Pod #${currentPod.pod_number - 1}</span>`;
              } else if (rankNum > Math.max(2, nStandings - 2) && currentPod.pod_number < totalPodsCount) {
                relBadge = `<span style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.72rem;">▼ -1 Pod → Pod #${currentPod.pod_number + 1}</span>`;
              }

              const isFirst = rankNum === 1;
              const rowBg = isFirst ? 'rgba(59, 130, 246, 0.05)' : (idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.01)');
              const safePlayerName = escapeHtml(s.name || '').replace(/'/g, "\\'");
              const bcpPlayerId = s.bcp_player_id || s.player_id || '';
              const safeBcpId = escapeHtml(bcpPlayerId || s.name || '').replace(/'/g, "\\'");
              const isDbMatched = Boolean(s.is_db_matched && bcpPlayerId);

              return `
                <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.04); background: ${rowBg};">
                  <td style="padding: 0.75rem 1rem; font-weight: 700; color: ${isFirst ? '#60a5fa' : '#94a3b8'};">
                    #${rankNum}
                  </td>
                  <td style="padding: 0.75rem 1rem; font-weight: 600; color: #fff; white-space: nowrap;">
                    <div style="display: inline-flex; align-items: center; gap: 0.45rem; white-space: nowrap;">
                      ${isDbMatched ? `
                        <button type="button" onclick="openPlayerModal('${safeBcpId}', '${safePlayerName}')" title="Matched in DB (${escapeHtml(bcpPlayerId)})" style="background: none; border: none; padding: 0; color: #38bdf8; font-weight: 700; font-size: 0.88rem; cursor: pointer; text-decoration: underline; text-underline-offset: 3px;">
                          ${escapeHtml(s.name)}
                        </button>
                        <span title="Matched in Players DB (${escapeHtml(s.match_method === 'user_id_linked' ? 'Linked via User ID' : 'Matched by Name Assumption')})" style="background: rgba(16, 185, 129, 0.14); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); font-size: 0.64rem; font-weight: 700; padding: 1px 5px; border-radius: 4px;">
                          ${s.match_method === 'user_id_linked' || s.match_method === 'self_claimed' ? '✓ Linked User' : '✓ DB'}
                        </span>
                      ` : `
                        <span title="Not found in Players DB by name assumption — click 'Match User' to link your existing user_id / bcp_player_id" style="color: #cbd5e1; font-weight: 600; font-size: 0.88rem; cursor: default;">
                          ${escapeHtml(s.name)}
                        </span>
                        <span style="background: rgba(148, 163, 184, 0.12); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25); font-size: 0.64rem; font-weight: 600; padding: 1px 5px; border-radius: 4px;">
                          Unlinked
                        </span>
                      `}
                      ${s.career?.championships ? `<span title="${s.career.championships} All-time Championships" style="cursor: help;">🏆</span>` : ''}
                    </div>
                  </td>
                  <td style="padding: 0.75rem 1rem; color: #cbd5e1;">
                    <span style="background: rgba(255, 255, 255, 0.06); padding: 2px 7px; border-radius: 4px; font-size: 0.78rem;">
                      ${escapeHtml(s.primary_faction || 'Unassigned')}
                    </span>
                  </td>
                  <td style="padding: 0.75rem 0.75rem; text-align: center; font-weight: 600;">
                    <span style="color: #34d399;">${s.wins}W</span> - <span style="color: #f87171;">${s.losses}L</span> - <span style="color: #94a3b8;">${s.draws}D</span>
                  </td>
                  <td style="padding: 0.75rem 0.75rem; text-align: center; font-weight: 800; color: #60a5fa; font-size: 0.95rem;">
                    ${s.battle_points} BP
                  </td>
                  <td style="padding: 0.75rem 0.75rem; text-align: center; color: var(--text-muted);">
                    ${s.poty_points || 0}
                  </td>
                  <td style="padding: 0.75rem 1rem; text-align: center;">
                    ${relBadge}
                  </td>
                  <td style="padding: 0.75rem 1rem; text-align: right; white-space: nowrap;">
                    ${isDbMatched ? `
                      <button onclick="openPlayerModal('${safeBcpId}', '${safePlayerName}')" class="btn btn-outline" style="padding: 0.25rem 0.55rem; font-size: 0.72rem; margin-right: 4px;">
                        👤 Quick Popup
                      </button>
                    ` : `
                      <button onclick="openLeaguePlayerClaimModal('${escapeHtml(league.league_id || 'league_sd40k_big_league')}', '${safePlayerName}', ${currentPod.pod_number})" class="btn btn-outline" style="padding: 0.25rem 0.55rem; font-size: 0.72rem; margin-right: 4px; border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;">
                        🔗 Match User
                      </button>
                    `}
                    <button onclick="openPlayerLeagueModal('${safePlayerName}')" class="btn btn-outline" style="padding: 0.25rem 0.55rem; font-size: 0.72rem; border-color: rgba(245, 158, 11, 0.4); color: #fbbf24;">
                      📜 Career
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Matchup & Pairings Schedule Cards (All 5 Rounds + Game Tracker + Opponent Chat) -->
    <div id="league-pairings-list" class="card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem;">
        <div>
          <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #fff;">⚔️ Pod #${currentPod.pod_number} Pairings — Start Game Tracker &amp; Opponent Chat</h3>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">Start OmniTactica Game Tracker in the same tab or chat directly with your matched opponent</div>
        </div>
        <!-- Round Filter Pills -->
        <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
          ${['all', 1, 2, 3, 4, 5].map(r => {
            const isActR = String(selectedRound) === String(r);
            return `
              <button onclick="switchLeaguePairingRound('${r}')" style="padding: 4px 10px; border-radius: 6px; font-size: 0.76rem; font-weight: 700; cursor: pointer; border: 1px solid ${isActR ? '#3b82f6' : 'var(--border)'}; background: ${isActR ? 'rgba(59, 130, 246, 0.2)' : 'rgba(15, 23, 42, 0.6)'}; color: ${isActR ? '#60a5fa' : 'var(--text-secondary)'};">
                ${r === 'all' ? `All Rounds (${allPodPairings.length})` : `Round ${r}`}
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0.85rem;">
        ${filteredPairings.map(m => {
          const safeP1 = escapeHtml(m.p1_name).replace(/'/g, "\\'");
          const safeP2 = escapeHtml(m.p2_name).replace(/'/g, "\\'");
          const safeP1Id = escapeHtml(m.p1_bcp_player_id || m.p1_name).replace(/'/g, "\\'");
          const safeP2Id = escapeHtml(m.p2_bcp_player_id || m.p2_name).replace(/'/g, "\\'");
          const safeF1 = escapeHtml(m.p1_faction).replace(/'/g, "\\'");
          const safeLayout = escapeHtml(m.layout).replace(/'/g, "\\'");
          return `
            <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid ${m.is_completed ? 'rgba(16, 185, 129, 0.3)' : 'var(--border)'}; border-radius: 8px; padding: 0.85rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.65rem;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-size: 0.74rem; font-weight: 700; color: #60a5fa; background: rgba(59, 130, 246, 0.15); padding: 2px 7px; border-radius: 4px;">
                  Round ${m.round} • ${escapeHtml(m.layout)}
                </span>
                <span style="font-size: 0.72rem; font-weight: 700; color: ${m.is_completed ? '#34d399' : '#fbbf24'};">
                  ${m.is_completed ? `✓ ${escapeHtml(String(m.score || 'Completed'))}` : '⏳ Scheduled (2,000 pts)'}
                </span>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 0.92rem; color: #fff; gap: 0.4rem;">
                <div style="flex: 1; min-width: 0;">
                  ${m.p1_is_db_matched ? `
                    <button type="button" onclick="openPlayerModal('${safeP1Id}', '${safeP1}')" style="background: none; border: none; padding: 0; color: #fff; font-weight: 700; font-size: 0.9rem; cursor: pointer; text-align: left; text-decoration: underline; text-underline-offset: 2px;">
                      ${escapeHtml(m.p1_name)}
                    </button>
                  ` : `
                    <span style="color: #cbd5e1; font-weight: 600; font-size: 0.9rem; cursor: default;">
                      ${escapeHtml(m.p1_name)}
                    </span>
                  `}
                  <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 500;">${escapeHtml(m.p1_faction)}</div>
                </div>
                <span style="color: var(--text-muted); font-size: 0.75rem; font-weight: 800; padding: 0 4px;">VS</span>
                <div style="flex: 1; min-width: 0; text-align: right;">
                  ${m.p2_is_db_matched ? `
                    <button type="button" onclick="openPlayerModal('${safeP2Id}', '${safeP2}')" style="background: none; border: none; padding: 0; color: #93c5fd; font-weight: 700; font-size: 0.9rem; cursor: pointer; text-align: right; text-decoration: underline; text-underline-offset: 2px;">
                      ${escapeHtml(m.p2_name)}
                    </button>
                  ` : `
                    <span style="color: #cbd5e1; font-weight: 600; font-size: 0.9rem; cursor: default;">
                      ${escapeHtml(m.p2_name)}
                    </span>
                  `}
                  <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 500;">${escapeHtml(m.p2_faction)}</div>
                </div>
              </div>
              <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
                <button onclick="launchLeagueMatchTracker('${safeP1}', '${safeP2}', '${safeF1}', '${safeLayout}', ${m.round}, '${escapeHtml(league.league_id || 'league_sd40k_big_league')}')" class="btn btn-primary" style="flex: 1.2; font-size: 0.76rem; padding: 0.4rem 0.5rem; background: linear-gradient(135deg, #2563eb, #3b82f6); border: none; font-weight: 700;">
                  🎲 Start Tracker
                </button>
                <button onclick="openLeagueOpponentChat('${safeP2}', '${safeP1}', ${m.round}, ${currentPod.pod_number})" class="btn btn-outline" style="flex: 1; font-size: 0.76rem; padding: 0.4rem 0.5rem; border-color: rgba(56, 189, 248, 0.4); color: #38bdf8; font-weight: 700;">
                  💬 Chat
                </button>
                <button onclick="openScoreReportingModal('${escapeHtml(league.league_id || 'league_sd40k_big_league')}', ${currentPod.pod_number}, ${m.round}, '${safeP1}', '${safeP2}')" class="btn btn-outline" style="font-size: 0.76rem; padding: 0.4rem 0.55rem;">
                  📝 Score
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

/**
 * Renders Hall of Fame & Archives Subtab
 */
function renderHallOfFameSubtab(league) {
  const hof = league.hall_of_fame || {};
  const finalsChamps = hof.finals_champions || [];
  const leaderboards = hof.leaderboards || {};
  const activeCat = leagueState.hofCategory || 'finals_champions';

  const categories = [
    { id: 'finals_champions', label: '👑 Past Finals Champions', count: finalsChamps.length },
    { id: 'historical_seasons', label: '📜 38-Season Roll of Honor', count: (league.available_seasons || []).length },
    { id: 'titles_and_champs', label: '🏆 Titles & Championships', count: leaderboards.titles_and_champs?.records?.length || 0 },
    { id: 'most_games', label: '⚔️ Most Games Played', count: leaderboards.most_games?.records?.length || 0 },
    { id: 'most_wins', label: '🔥 Most League Wins', count: leaderboards.most_wins?.records?.length || 0 },
    { id: 'finals_wins', label: '🎖️ Wins in the Finals', count: leaderboards.finals_wins?.records?.length || 0 },
    { id: 'faction_titles', label: '🛡️ Faction Win Rates', count: leaderboards.faction_titles?.records?.length || 0 }
  ];

  return `
    <!-- Category Selector -->
    <div style="display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.5rem; margin-bottom: 1.25rem;">
      ${categories.map(c => {
        const isAct = c.id === activeCat;
        return `
          <button onclick="switchHofCategory('${c.id}')" style="
            padding: 0.55rem 0.95rem;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 600;
            white-space: nowrap;
            cursor: pointer;
            transition: all 0.15s ease;
            background: ${isAct ? 'linear-gradient(135deg, #d97706, #b45309)' : 'var(--bg-card)'};
            color: ${isAct ? '#fff' : 'var(--text-secondary)'};
            border: 1px solid ${isAct ? '#f59e0b' : 'var(--border)'};
            box-shadow: ${isAct ? '0 4px 12px rgba(217, 119, 6, 0.3)' : 'none'};
          ">
            <span>${c.label}</span>
          </button>
        `;
      }).join('')}
    </div>

    <!-- Category Content -->
    ${activeCat === 'finals_champions' ? renderFinalsChampionsList(finalsChamps) : (activeCat === 'historical_seasons' ? renderHistoricalSeasonsList(league.available_seasons || []) : renderLeaderboardTable(leaderboards[activeCat]))}
  `;
}

/**
 * Renders Complete 38-Season Roll of Honor
 */
function renderHistoricalSeasonsList(seasons) {
  if (!seasons || !seasons.length) {
    return `
      <div class="empty-state" style="padding: 3rem 1rem; text-align: center;">
        <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">📜</div>
        <div style="color: var(--text-muted);">No historical seasons archive loaded.</div>
      </div>
    `;
  }
  return `
    <div class="card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; overflow: hidden;">
      <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #fff;">📜 Complete 38-Season Roll of Honor</h3>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">San Diego Force Org archival records from Season 1 to Season 38</div>
        </div>
        <span style="font-size: 0.75rem; color: #fbbf24; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 3px 8px; border-radius: 4px; font-weight: 700;">
          38 Seasons Documented
        </span>
      </div>
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
          <thead>
            <tr style="background: rgba(0, 0, 0, 0.3); border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase;">
              <th style="padding: 0.75rem 1rem;">Season</th>
              <th style="padding: 0.75rem 1rem;">Status</th>
              <th style="padding: 0.75rem 1rem;">Pod 1 Champion</th>
              <th style="padding: 0.75rem 1rem; text-align: center;">Pods</th>
              <th style="padding: 0.75rem 1rem; text-align: center;">Players</th>
              <th style="padding: 0.75rem 1rem; text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${seasons.map(s => `
              <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05); transition: background 0.15s ease;" onmouseover="this.style.background='rgba(255, 255, 255, 0.03)'" onmouseout="this.style.background='transparent'">
                <td style="padding: 0.75rem 1rem; font-weight: 700; color: #fff;">
                  ${escapeHtml(s.name)}
                </td>
                <td style="padding: 0.75rem 1rem;">
                  <span style="font-size: 0.72rem; padding: 2px 7px; border-radius: 4px; font-weight: 700; ${s.status === 'active' ? 'background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4);' : 'background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25);'}">
                    ${s.status === 'active' ? '⚡ LIVE ACTIVE' : '✓ COMPLETED'}
                  </span>
                </td>
                <td style="padding: 0.75rem 1rem; color: #fbbf24; font-weight: 600;">
                  ${s.pod_champion ? `👑 ${escapeHtml(s.pod_champion)}` : '—'}
                  ${s.pod_champion_faction ? `<span style="font-size: 0.75rem; color: #94a3b8; margin-left: 4px;">(${escapeHtml(s.pod_champion_faction)})</span>` : ''}
                </td>
                <td style="padding: 0.75rem 1rem; text-align: center; color: #a78bfa; font-weight: 700;">
                  ${s.total_pods} Pods
                </td>
                <td style="padding: 0.75rem 1rem; text-align: center; color: #60a5fa; font-weight: 700;">
                  ${s.total_players}
                </td>
                <td style="padding: 0.75rem 1rem; text-align: right;">
                  <button onclick="openHistoricalSeasonArchiveModal(${s.season_number})" class="btn btn-outline" style="padding: 0.35rem 0.75rem; font-size: 0.78rem; font-weight: 600;">
                    📜 View Historical Archive →
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Renders Past Finals Champions
 */
function renderFinalsChampionsList(champions) {
  return `
    <div class="card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem;">
      <div style="margin-bottom: 1.25rem;">
        <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #fff;">👑 All-Time League Finals Champions</h3>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.25rem;">
          The single-elimination seasonal championship tournament honoring the winningest competitors across 38 seasons.
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 1rem;">
        ${champions.map((c, idx) => `
          <div style="background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 10px; padding: 1rem; position: relative; overflow: hidden;">
            <div style="position: absolute; right: -10px; top: -10px; width: 60px; height: 60px; background: rgba(245, 158, 11, 0.08); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; pointer-events: none;">
              🏆
            </div>
            <div style="font-size: 0.75rem; font-weight: 700; color: #fbbf24; text-transform: uppercase; margin-bottom: 0.25rem;">
              ${escapeHtml(c.season_label || String(c.year))}
            </div>
            <div style="font-size: 1.25rem; font-weight: 800; color: #fff; margin-bottom: 0.25rem;">
              ${escapeHtml(c.champion)}
            </div>
            <div style="font-size: 0.82rem; color: #60a5fa; font-weight: 600; margin-bottom: 0.6rem;">
              🛡️ ${escapeHtml(c.champion_faction)}
            </div>
            ${c.runner_up ? `<div style="font-size: 0.78rem; color: var(--text-muted);">Runner-Up: <span style="color: #cbd5e1;">${escapeHtml(c.runner_up)}</span></div>` : ''}
            ${c.notes ? `<div style="font-size: 0.75rem; color: #94a3b8; margin-top: 0.4rem; font-style: italic;">"${escapeHtml(c.notes)}"</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/**
 * Renders an All-Time Leaderboard table
 */
function renderLeaderboardTable(data) {
  if (!data || !data.records || !data.records.length) {
    return `
      <div class="empty-state" style="padding: 3rem 1rem; text-align: center;">
        <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">📊</div>
        <div style="color: var(--text-muted);">No records found in this category.</div>
      </div>
    `;
  }

  const records = data.records;
  const isFaction = data.key === 'faction_titles';

  return `
    <div class="card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; overflow: hidden;">
      <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border);">
        <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #fff;">${escapeHtml(data.title)}</h3>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">Cumulative records across 38 completed seasons</div>
      </div>

      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
          <thead>
            <tr style="background: rgba(0, 0, 0, 0.3); border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase;">
              <th style="padding: 0.75rem 1rem; width: 45px;">Rank</th>
              <th style="padding: 0.75rem 1rem;">${isFaction ? 'Faction' : 'Player Name'}</th>
              ${isFaction ? `
                <th style="padding: 0.75rem 0.75rem; text-align: center;">Pod Titles Won</th>
                <th style="padding: 0.75rem 0.75rem; text-align: center;">Total Wins</th>
                <th style="padding: 0.75rem 0.75rem; text-align: center;">Players Fielded</th>
              ` : `
                <th style="padding: 0.75rem 0.75rem; text-align: center;">Metric Value</th>
                <th style="padding: 0.75rem 0.75rem; text-align: center;">Seasons / Details</th>
              `}
            </tr>
          </thead>
          <tbody>
            ${records.map((r, idx) => {
              const rankVal = r.rank || (idx + 1);
              const isTop3 = rankVal <= 3;
              const medal = rankVal === 1 ? '🥇 ' : (rankVal === 2 ? '🥈 ' : (rankVal === 3 ? '🥉 ' : ''));
              return `
                <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.04); background: ${idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.01)'};">
                  <td style="padding: 0.75rem 1rem; font-weight: 700; color: ${isTop3 ? '#fbbf24' : '#94a3b8'};">
                    ${medal}#${rankVal}
                  </td>
                  <td style="padding: 0.75rem 1rem; font-weight: 600; color: #fff;">
                    ${escapeHtml(isFaction ? r.faction : r.player_name)}
                  </td>
                  ${isFaction ? `
                    <td style="padding: 0.75rem 0.75rem; text-align: center; font-weight: 800; color: #f59e0b;">
                      ${r.titles} Titles
                    </td>
                    <td style="padding: 0.75rem 0.75rem; text-align: center; color: #34d399; font-weight: 600;">
                      ${r.wins} Wins
                    </td>
                    <td style="padding: 0.75rem 0.75rem; text-align: center; color: var(--text-muted);">
                      ${r.players} Players
                    </td>
                  ` : `
                    <td style="padding: 0.75rem 0.75rem; text-align: center; font-weight: 800; color: #60a5fa;">
                      ${r.league_championships ? `${r.pod_titles} Titles (${r.league_championships} 🏆)` : (r.games_played ? `${r.games_played} Games` : (r.league_wins ? `${r.league_wins} Wins` : (r.finals_wins ? `${r.finals_wins} Finals Wins` : '—')))}
                    </td>
                    <td style="padding: 0.75rem 0.75rem; text-align: center; color: var(--text-muted);">
                      ${r.seasons ? `${r.seasons} Seasons` : (r.appearances ? `${r.appearances} Final Appearances` : '—')}
                    </td>
                  `}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Renders the Methodology & 38-Season Rules Subtab
 */
function renderMethodologySubtab(league) {
  const m = league.methodology || {};
  return `
    <div style="display: flex; flex-direction: column; gap: 1.25rem;">
      <div class="card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 1.5rem;">
        <h2 style="margin: 0 0 0.5rem 0; font-size: 1.35rem; font-weight: 800; color: #fff;">
          The SD40K Pod & Relegation Methodology
        </h2>
        <p style="color: var(--text-muted); font-size: 0.9rem; line-height: 1.6; margin-bottom: 1.25rem;">
          San Diego Force Org has operated for 38 consecutive seasons across multiple editions of Warhammer 40,000.
          Its endurance stems from an elegant structure: balanced 8-player pods, guaranteed games over 8 weeks,
          high-stakes promotion/relegation, and an unmistakable 1,000 Battle Point win bonus that rewards decisive tabletop victory.
        </p>

        <!-- 6 Core Pillars Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
          <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
            <div style="font-size: 1.1rem; font-weight: 700; color: #60a5fa; margin-bottom: 0.4rem;">1. 8-Week Rhythm / 5 Games</div>
            <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5;">
              Players play 5 of their 7 pod companions over an 8-week window. Players can play games in any order, affording a 3-week scheduling cushion for busy work/family schedules.
            </div>
          </div>

          <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
            <div style="font-size: 1.1rem; font-weight: 700; color: #34d399; margin-bottom: 0.4rem;">2. 1,000 BP Scoring Formula</div>
            <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5;">
              • <strong>Win:</strong> Actual Victory Points + 1,000 BP Bonus (e.g. 93 VP = 1,093 BP)<br>
              • <strong>Draw:</strong> Actual VP + 500 BP Bonus<br>
              • <strong>Loss:</strong> Actual VP + 0 BP Bonus (e.g. 51 VP = 51 BP)<br>
              • <strong>Ringer Win:</strong> Actual VP + 750 BP Bonus
            </div>
          </div>

          <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
            <div style="font-size: 1.1rem; font-weight: 700; color: #a78bfa; margin-bottom: 0.4rem;">3. Faction Lock, List Flexibility</div>
            <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5;">
              Players lock their Primary Faction for the season (must field at least 1,001 pts in every game). However, army lists, detachments, and enhancements can be freely adjusted between rounds.
            </div>
          </div>

          <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
            <div style="font-size: 1.1rem; font-weight: 700; color: #f59e0b; margin-bottom: 0.4rem;">4. Promotion & Relegation</div>
            <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5;">
              Tiered pods (Pods 1 to 7) create intense parity. Top 2 in Pods 2–7 promote up (+1 or +2 pods). Bottom 2 in Pods 1–6 face relegation. The crucible keeps games competitive.
            </div>
          </div>

          <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
            <div style="font-size: 1.1rem; font-weight: 700; color: #ec4899; margin-bottom: 0.4rem;">5. The 16-Player Finals</div>
            <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5;">
              The winningest competitors across Pod 1 qualify for a rigorous single-elimination playoff bracket to crown the seasonal League Champion.
            </div>
          </div>

          <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
            <div style="font-size: 1.1rem; font-weight: 700; color: #38bdf8; margin-bottom: 0.4rem;">6. Ringer Match Safeguards</div>
            <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5;">
              If an opponent goes silent or drops, players schedule an in-pod ringer match with one of their unassigned pod companions (+750 BP win bonus), guaranteeing all 5 games get completed.
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 1-Tap Launch of Game Tracker with pre-filled league match room
 */
function launchLeagueMatchTracker(p1Name, p2Name, p1Faction, layout, roundNum = 1, leagueId = 'league_sd40k_big_league') {
  const roomId = `LG-SD40K-R${roundNum || 1}-${Date.now().toString(36).toUpperCase()}`;
  const params = new URLSearchParams({
    match_id: roomId,
    room: roomId,
    p1: p1Name,
    p2: p2Name,
    faction1: p1Faction || 'Warhammer 40k',
    layout: layout || 'Layout A',
    round: String(roundNum || 1),
    league_id: leagueId || 'league_sd40k_big_league',
    system: '40k'
  });
  window.location.href = `/11th/tracker/play?${params.toString()}`;
}

/**
 * Switches the active season viewed in League Hub
 */
async function openHistoricalSeasonArchiveModal(seasonNum) {
  seasonNum = parseInt(seasonNum, 10) || 37;
  const league = leagueState.currentLeagueData;
  const cleanId = league?.league_id || leagueState.activeLeagueId || 'league_sd40k_big_league';
  try {
    const res = await fetch(`/api/league/${encodeURIComponent(cleanId)}?season=${seasonNum}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const histSeason = json.league?.active_season || {};
    const pods = histSeason.pods || [];
    const existing = document.getElementById('league-hist-archive-modal');
    if (existing) existing.remove();

    const podsHtml = pods.map(p => `
      <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 0.85rem; margin-bottom: 0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <strong style="color: #fff; font-size: 0.9rem;">Pod #${p.pod_number} — ${escapeHtml(p.name || '')}</strong>
          <span style="font-size: 0.75rem; color: #94a3b8;">${(p.standings || []).length} Competitors</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 0.4rem;">
          ${(p.standings || []).map((st, idx) => {
            const matched = Boolean(st.is_db_matched && st.bcp_player_id);
            return `
              <div style="padding: 0.35rem 0.55rem; background: rgba(0,0,0,0.28); border-radius: 6px; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center;">
                <span>
                  <strong style="color: ${idx === 0 ? '#fbbf24' : '#94a3b8'}; margin-right: 4px;">#${st.rank || (idx + 1)}</strong>
                  ${matched
                    ? `<a href="javascript:void(0)" onclick="if (typeof openPlayerModal === 'function') openPlayerModal('${escapeHtml(st.bcp_player_id)}', '${escapeHtml(st.name)}');" style="color: #60a5fa; text-decoration: underline; font-weight: 700;">${escapeHtml(st.name)}</a>`
                    : `<span style="color: #e2e8f0;">${escapeHtml(st.name)}</span>`
                  }
                </span>
                <span style="color: #34d399; font-weight: 700;">${st.wins || 0}W-${st.losses || 0}L (${st.battle_points || 0} BP)</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `).join('');

    const modalHtml = `
      <div id="league-hist-archive-modal" class="modal-backdrop" onclick="if(event.target===this)this.remove()" style="position: fixed; inset: 0; background: rgba(0,0,0,0.78); backdrop-filter: blur(6px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 1.25rem;">
        <div class="card" style="width: 100%; max-width: 820px; max-height: 85vh; overflow-y: auto; background: #0f172a; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 14px; padding: 1.35rem; color: #f8fafc;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.75rem;">
            <div>
              <div style="font-size: 0.72rem; color: #fbbf24; text-transform: uppercase; font-weight: 800;">📜 Historical Database Archive (Read-Only)</div>
              <h3 style="margin: 0.2rem 0 0 0; font-size: 1.2rem; font-weight: 800; color: #fff;">${escapeHtml(histSeason.name || `Season ${seasonNum}`)} • ${pods.length} Pods (${histSeason.total_players || 60} Players)</h3>
            </div>
            <button onclick="document.getElementById('league-hist-archive-modal').remove()" class="btn btn-outline" style="padding: 0.3rem 0.65rem;">✕ Close</button>
          </div>
          ${podsHtml}
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  } catch (err) {
    console.error('Error opening historical season archive modal:', err);
  }
}
window.openHistoricalSeasonArchiveModal = openHistoricalSeasonArchiveModal;
window.selectLeagueSeason = openHistoricalSeasonArchiveModal;

/**
 * Modal to view player profile & stats within the league
 */
async function openPlayerLeagueModal(playerName) {
  const league = leagueState.currentLeagueData;
  if (!league) return;

  let playerRecord = null;
  let podNumber = 1;
  const pods = league.active_season?.pods || [];
  for (const p of pods) {
    const found = (p.standings || []).find(s => s.name.toLowerCase() === playerName.toLowerCase());
    if (found) {
      playerRecord = found;
      podNumber = p.pod_number;
      break;
    }
  }

  if (!playerRecord) {
    playerRecord = {
      name: playerName,
      primary_faction: 'Space Marines',
      wins: 0,
      losses: 0,
      draws: 0,
      battle_points: 0,
      poty_points: 0,
      career: {}
    };
  }

  // Fetch full career dossier from authoritative 38-season archive
  let career = playerRecord.career || {};
  let historyRows = [];
  try {
    const cRes = await fetch(`/api/league/sd40k/player/${encodeURIComponent(playerName)}/history`);
    if (cRes.ok) {
      const cJson = await cRes.json();
      if (cJson.success && cJson.player) {
        career = cJson.player;
        historyRows = career.history || [];
      }
    }
  } catch (e) {}

  const modalHtml = `
    <div id="league-player-modal-backdrop" onclick="closeLeagueModal(event)" style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 1rem;">
      <div onclick="event.stopPropagation()" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; width: 100%; max-width: 580px; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5); overflow: hidden;">
        
        <!-- Header -->
        <div style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border); display: flex; align-items: flex-start; justify-content: space-between;">
          <div>
            <div style="font-size: 0.75rem; color: #60a5fa; font-weight: 700; text-transform: uppercase;">
              Pod #${podNumber} Competitor • Season ${league.active_season?.season_number || 38}
            </div>
            <h2 style="margin: 0.2rem 0 0.1rem 0; font-size: 1.45rem; font-weight: 800; color: #fff;">
              ${escapeHtml(playerRecord.name)}
            </h2>
            <div style="color: var(--text-muted); font-size: 0.85rem;">
              Primary Faction: <strong style="color: #cbd5e1;">${escapeHtml(playerRecord.primary_faction)}</strong>
            </div>
          </div>
          <button onclick="document.getElementById('league-player-modal-backdrop').remove()" style="background: none; border: none; font-size: 1.35rem; color: var(--text-muted); cursor: pointer; padding: 0.2rem;">✕</button>
        </div>

        <!-- Scrollable Body -->
        <div style="padding: 1.25rem 1.5rem; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 1.25rem;">
          
          <!-- Career KPI Cards -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(115px, 1fr)); gap: 0.6rem;">
            <div style="background: rgba(0, 0, 0, 0.25); padding: 0.65rem 0.75rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.05);">
              <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">All-Time Win Rate</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #34d399;">${escapeHtml(career.win_pct || '0.0%')}</div>
              <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 1px;">${escapeHtml(career.record || `${playerRecord.wins}W - ${playerRecord.losses}L`)}</div>
            </div>
            <div style="background: rgba(0, 0, 0, 0.25); padding: 0.65rem 0.75rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.05);">
              <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Seasons Played</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #60a5fa;">${career.total_seasons || 1} Sns</div>
              <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 1px;">${career.total_games || playerRecord.games_played || 0} Total Games</div>
            </div>
            <div style="background: rgba(0, 0, 0, 0.25); padding: 0.65rem 0.75rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.05);">
              <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Best Division</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #a78bfa;">${escapeHtml(career.best_pod || `Pod ${podNumber}`)}</div>
              <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 1px;">Career Peak</div>
            </div>
            <div style="background: rgba(0, 0, 0, 0.25); padding: 0.65rem 0.75rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.05);">
              <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Titles & Champs</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #fbbf24;">${career.championships || 0} 🏆 • ${career.pod_titles || 0} 🎖️</div>
              <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 1px;">Hall of Fame</div>
            </div>
          </div>

          <!-- Lifetime Historical Season Ledger -->
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
              <span style="font-size: 0.8rem; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.04em;">
                📜 Career Season-by-Season Ledger (${historyRows.length || 1} Seasons)
              </span>
            </div>

            <div style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden; max-height: 240px; overflow-y: auto;">
              <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.82rem;">
                <thead>
                  <tr style="background: rgba(0, 0, 0, 0.35); border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase;">
                    <th style="padding: 0.55rem 0.75rem;">Season</th>
                    <th style="padding: 0.55rem 0.75rem;">Pod</th>
                    <th style="padding: 0.55rem 0.75rem;">Faction</th>
                    <th style="padding: 0.55rem 0.75rem; text-align: center;">Record</th>
                    <th style="padding: 0.55rem 0.75rem; text-align: center;">BP</th>
                    <th style="padding: 0.55rem 0.75rem; text-align: right;">Finish</th>
                  </tr>
                </thead>
                <tbody>
                  ${historyRows.length > 0 ? historyRows.map(h => `
                    <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.04);">
                      <td style="padding: 0.55rem 0.75rem; font-weight: 700; color: #fff;">
                        S${h.season_number}
                      </td>
                      <td style="padding: 0.55rem 0.75rem; color: #a78bfa; font-weight: 600;">
                        Pod ${h.pod_number}
                      </td>
                      <td style="padding: 0.55rem 0.75rem; color: var(--text-muted);">
                        ${escapeHtml(h.primary_faction)}
                      </td>
                      <td style="padding: 0.55rem 0.75rem; text-align: center; font-weight: 600; color: #34d399;">
                        ${escapeHtml(h.record)}
                      </td>
                      <td style="padding: 0.55rem 0.75rem; text-align: center; color: #60a5fa; font-weight: 700;">
                        ${h.battle_points}
                      </td>
                      <td style="padding: 0.55rem 0.75rem; text-align: right; font-weight: 600; color: ${h.relegation && h.relegation.startsWith('+') ? '#34d399' : (h.relegation && h.relegation.startsWith('-') ? '#f87171' : '#94a3b8')};">
                        ${escapeHtml(h.relegation || 'None')}
                      </td>
                    </tr>
                  `).join('') : `
                    <tr>
                      <td colspan="6" style="padding: 1.5rem; text-align: center; color: var(--text-muted);">
                        Inaugural season in progress.
                      </td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        <!-- Footer -->
        <div style="padding: 1rem 1.5rem; border-top: 1px solid var(--border); display: flex; justify-content: flex-end;">
          <button onclick="document.getElementById('league-player-modal-backdrop').remove()" class="btn btn-primary" style="padding: 0.45rem 1.25rem;">
            Close
          </button>
        </div>

      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * Score reporting modal for league games
 */
function openScoreReportingModal(leagueId, podNum, roundNum, p1Name, p2Name) {
  const modalHtml = `
    <div id="league-score-modal-backdrop" onclick="closeLeagueModal(event)" style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 1rem;">
      <div onclick="event.stopPropagation()" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; width: 100%; max-width: 440px; padding: 1.5rem; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1rem;">
          <div>
            <div style="font-size: 0.75rem; color: #60a5fa; font-weight: 700; text-transform: uppercase;">Pod #${podNum} • Round ${roundNum}</div>
            <h2 style="margin: 0; font-size: 1.3rem; font-weight: 800; color: #fff;">Record Match Score</h2>
          </div>
          <button onclick="document.getElementById('league-score-modal-backdrop').remove()" style="background: none; border: none; font-size: 1.25rem; color: var(--text-muted); cursor: pointer;">✕</button>
        </div>

        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.25rem;">
          Scores are automatically credited with the SD40K +1,000 BP win bonus upon submission.
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.85rem; margin-bottom: 1.25rem;">
          <div>
            <label style="display: block; font-size: 0.8rem; font-weight: 600; color: #fff; margin-bottom: 0.35rem;">
              ${escapeHtml(p1Name)} (Actual VP: 0-100):
            </label>
            <input type="number" id="league-score-p1" min="0" max="100" value="75" class="form-input" style="width: 100%; box-sizing: border-box; font-size: 1rem; font-weight: 700;" />
          </div>
          <div>
            <label style="display: block; font-size: 0.8rem; font-weight: 600; color: #fff; margin-bottom: 0.35rem;">
              ${escapeHtml(p2Name)} (Actual VP: 0-100):
            </label>
            <input type="number" id="league-score-p2" min="0" max="100" value="60" class="form-input" style="width: 100%; box-sizing: border-box; font-size: 1rem; font-weight: 700;" />
          </div>
          <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--text-muted); cursor: pointer;">
            <input type="checkbox" id="league-score-is-ringer" />
            <span>This was an In-Pod Ringer match (+750 BP bonus)</span>
          </label>
        </div>

        <div style="display: flex; gap: 0.5rem;">
          <button onclick="submitLeagueScore('${leagueId}', ${podNum}, ${roundNum}, '${escapeHtml(p1Name)}', '${escapeHtml(p2Name)}')" class="btn btn-primary" style="flex: 1; background: linear-gradient(135deg, #10b981, #059669); border: none; font-weight: 700;">
            ✓ Submit Official Score
          </button>
          <button onclick="document.getElementById('league-score-modal-backdrop').remove()" class="btn btn-outline">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * Submits match score to backend API
 */
async function submitLeagueScore(leagueId, podNum, roundNum, p1Name, p2Name) {
  const p1Val = parseInt(document.getElementById('league-score-p1')?.value, 10) || 0;
  const p2Val = parseInt(document.getElementById('league-score-p2')?.value, 10) || 0;
  const isRinger = !!document.getElementById('league-score-is-ringer')?.checked;

  try {
    const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/match/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pod_number: podNum,
        round_number: roundNum,
        p1_name: p1Name,
        p2_name: p2Name,
        p1_score: p1Val,
        p2_score: p2Val,
        is_ringer: isRinger
      })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to submit score');

    document.getElementById('league-score-modal-backdrop')?.remove();
    alert(`Score Recorded!\n${p1Name}: ${json.p1_score} VP (${json.p1_bp} BP)\n${p2Name}: ${json.p2_score} VP (${json.p2_bp} BP)`);
    await loadLeagueData(leagueId);
  } catch (err) {
    alert(`Error reporting score: ${err.message}`);
  }
}

/**
 * TO Wizard to Create an Automated Recurring Pod League with Registration Window
 */
function openCopyLeagueTemplateModal() {
  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() + 14);
  const startStr = defaultStart.toISOString().split('T')[0];

  const modalHtml = `
    <div id="league-copy-modal-backdrop" onclick="closeLeagueModal(event)" style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 1rem;">
      <div onclick="event.stopPropagation()" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; width: 100%; max-width: 620px; max-height: 90vh; overflow-y: auto; padding: 1.5rem; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 0.85rem;">
          <div>
            <div style="font-size: 0.72rem; color: #f59e0b; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">TO League Automation Studio</div>
            <h2 style="margin: 0.15rem 0 0 0; font-size: 1.35rem; font-weight: 800; color: #fff;">Create Automated Recurring Pod League</h2>
          </div>
          <button onclick="document.getElementById('league-copy-modal-backdrop').remove()" style="background: none; border: none; font-size: 1.25rem; color: var(--text-muted); cursor: pointer;">✕</button>
        </div>

        <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.5;">
          Launch a fully automated pod league. During the registration window before each season, your league is automatically exposed in the <strong>Sparring Radar</strong>. All new entrants start in the bottom pod, pods are evenly balanced to <strong>6–8 players</strong> (5 games/season), and Top 2 move UP 1 pod / Bottom 2 move DOWN 1 pod / Middle stay.
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.8rem; margin-bottom: 1.15rem;">
          <div>
            <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #fff; margin-bottom: 0.3rem;">League Name *</label>
            <input type="text" id="new-league-name" placeholder="e.g. San Diego 40k BIG League @ At Ease Games" class="form-input" style="width: 100%; box-sizing: border-box;" />
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem;">
            <div>
              <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #fff; margin-bottom: 0.3rem;">City / Region *</label>
              <input type="text" id="new-league-region" placeholder="e.g. San Diego, CA" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #fff; margin-bottom: 0.3rem;">TO / Commissioner *</label>
              <input type="text" id="new-league-comm" placeholder="Your Name or Club" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem;">
            <div>
              <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #fff; margin-bottom: 0.3rem;">Host Game Store / Venue</label>
              <input type="text" id="new-league-venue" placeholder="e.g. At Ease Games" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #fff; margin-bottom: 0.3rem;">Season 1 Start Date *</label>
              <input type="date" id="new-league-start-date" value="${startStr}" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem;">
            <div>
              <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #fff; margin-bottom: 0.3rem;">Recurring Season Cadence *</label>
              <select id="new-league-recurring" class="form-input" style="width: 100%; box-sizing: border-box;">
                <option value="true" selected>🔁 Auto-Recurring Seasons (8 Weeks / 5 Games)</option>
                <option value="6_weeks">🔁 Auto-Recurring Seasons (6 Weeks / 5 Games)</option>
                <option value="false">1️⃣ Single Season (Manual Rollover)</option>
              </select>
            </div>
            <div>
              <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #fff; margin-bottom: 0.3rem;">Registration Window (Sparring Radar) *</label>
              <select id="new-league-reg-window" class="form-input" style="width: 100%; box-sizing: border-box;">
                <option value="14" selected>📡 14 Days Before Season (Expose in Radar)</option>
                <option value="21">📡 21 Days Before Season (Expose in Radar)</option>
                <option value="7">📡 7 Days Before Season (Expose in Radar)</option>
              </select>
            </div>
          </div>

          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.28); border-radius: 8px; padding: 0.75rem 0.9rem; font-size: 0.78rem; color: #cbd5e1; line-height: 1.45;">
            <strong style="color: #34d399;">⚙️ Automated Pod &amp; Promotion Rules (Locked):</strong><br/>
            • <strong>Pod Size:</strong> 6–8 players per pod (distributed as evenly as possible) • <strong>5 Games per season</strong><br/>
            • <strong>Movement:</strong> Top 2 move <strong>UP 1 pod</strong> • Bottom 2 move <strong>DOWN 1 pod</strong> • Middle <strong>stay in same pod</strong><br/>
            • <strong>Starting Rule:</strong> Everyone starting off begins in the <strong>bottom pod</strong>
          </div>
        </div>

        <div style="display: flex; gap: 0.5rem;">
          <button onclick="submitNewLeagueCreation()" class="btn btn-primary" style="flex: 1; background: linear-gradient(135deg, #d97706, #b45309); border: 1px solid #f59e0b; font-weight: 700;">
            🚀 Create Automated League &amp; Open Registration
          </button>
          <button onclick="document.getElementById('league-copy-modal-backdrop').remove()" class="btn btn-outline">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * Creates new league via POST /api/league/create
 */
async function submitNewLeagueCreation() {
  const name = document.getElementById('new-league-name')?.value.trim();
  const region = document.getElementById('new-league-region')?.value.trim();
  const commissioner = document.getElementById('new-league-comm')?.value.trim();
  const venue = document.getElementById('new-league-venue')?.value.trim();
  const startDate = document.getElementById('new-league-start-date')?.value || '';
  const recVal = document.getElementById('new-league-recurring')?.value || 'true';
  const regDays = parseInt(document.getElementById('new-league-reg-window')?.value || '14', 10);

  if (!name) {
    alert('Please enter a league name.');
    return;
  }

  try {
    const res = await fetch('/api/league/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        region: region || 'Local Scene',
        commissioner: commissioner || 'Community Organizer',
        partner_venues: venue ? [{ name: venue, role: 'Official Host Store' }] : [],
        start_date: startDate,
        duration_weeks: recVal === '6_weeks' ? 6 : 8,
        rounds_count: 5,
        pod_size: 8,
        recurring_seasons: recVal !== 'false',
        registration_window_days: regDays,
        registration_open: true,
        template_id: 'sd40k_standard_pod_system'
      })
    });
    const json = await res.json();
    if (!json.success || !json.league) throw new Error(json.error || 'Failed to create league');

    document.getElementById('league-copy-modal-backdrop')?.remove();
    renderSparringRadarLeagueRegistrations();
    openLeagueHubPage(json.league.slug, '40k', { replaceUrl: true });
  } catch (err) {
    alert(`Error creating league: ${err.message}`);
  }
}

/**
 * Opens direct opponent chat from a League Pairing Card
 */
function openLeagueOpponentChat(opponentName, myName, roundNum, podNum) {
  if (typeof handlePlayerChatClick === 'function' && window.currentUser) {
    handlePlayerChatClick(null, opponentName);
    return;
  }
  const existing = document.getElementById('league-opponent-chat-modal');
  if (existing) existing.remove();

  const html = `
    <div id="league-opponent-chat-modal" onclick="if(event.target === this) this.remove()" style="position: fixed; inset: 0; background: rgba(0,0,0,0.78); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 99999; padding: 1rem;">
      <div onclick="event.stopPropagation()" style="background: var(--bg-card); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 12px; width: 100%; max-width: 460px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.7);">
        <div style="padding: 1rem 1.25rem; background: linear-gradient(135deg, rgba(30, 58, 138, 0.45), rgba(15, 23, 42, 0.9)); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-size: 0.7rem; font-weight: 800; color: #38bdf8; text-transform: uppercase;">💬 League Matchup Chat • Pod #${podNum} Round ${roundNum}</div>
            <h3 style="margin: 0.15rem 0 0; font-size: 1.15rem; font-weight: 800; color: #fff;">Coordinate with ${escapeHtml(opponentName)}</h3>
          </div>
          <button onclick="document.getElementById('league-opponent-chat-modal').remove()" style="background: none; border: none; font-size: 1.25rem; color: var(--text-muted); cursor: pointer;">✕</button>
        </div>
        <div id="league-chat-messages-box" style="padding: 1rem 1.25rem; max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.65rem; background: rgba(0,0,0,0.2);">
          <div style="align-self: flex-start; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 8px; padding: 0.6rem 0.85rem; font-size: 0.82rem; color: #e2e8f0; max-width: 88%;">
            <div style="font-size: 0.7rem; font-weight: 700; color: #60a5fa; margin-bottom: 2px;">System Match Coordinator</div>
            You are paired with <strong>${escapeHtml(opponentName)}</strong> for <strong>Pod #${podNum} • Round ${roundNum}</strong> (2,000 pts). Send a message below to lock in your table time at At Ease Games!
          </div>
        </div>
        <div style="padding: 0.85rem 1.25rem; border-top: 1px solid var(--border); display: flex; gap: 0.5rem;">
          <input type="text" id="league-chat-input" placeholder="Hey ${escapeHtml(opponentName)}, free this Thursday at At Ease Games?" class="form-input" style="flex: 1;" onkeydown="if(event.key==='Enter') sendLeagueOpponentMessage('${escapeHtml(opponentName).replace(/'/g, "\\'")}')" />
          <button onclick="sendLeagueOpponentMessage('${escapeHtml(opponentName).replace(/'/g, "\\'")}')" class="btn btn-primary" style="background: linear-gradient(135deg, #2563eb, #3b82f6); border: none; font-weight: 700;">Send</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  setTimeout(() => document.getElementById('league-chat-input')?.focus(), 50);
}
window.openLeagueOpponentChat = openLeagueOpponentChat;

function sendLeagueOpponentMessage(opponentName) {
  const inp = document.getElementById('league-chat-input');
  const box = document.getElementById('league-chat-messages-box');
  if (!inp || !box) return;
  const txt = inp.value.trim() || `Hey ${opponentName}, let's schedule our Round match at At Ease Games!`;
  inp.value = '';
  box.insertAdjacentHTML('beforeend', `
    <div style="align-self: flex-end; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; border-radius: 8px; padding: 0.55rem 0.85rem; font-size: 0.82rem; max-width: 85%;">
      <div style="font-size: 0.68rem; opacity: 0.8; font-weight: 700; margin-bottom: 2px;">You • Just now</div>
      ${escapeHtml(txt)}
    </div>
  `);
  box.scrollTop = box.scrollHeight;
}
window.sendLeagueOpponentMessage = sendLeagueOpponentMessage;

/**
 * Toggles Commissioner Mode on the League Page
 */
function toggleLeagueCommissionerMode() {
  window.isEventStudioCommissionerView = !window.isEventStudioCommissionerView;
  if (leagueState.currentLeagueData) {
    renderLeagueHub(leagueState.currentLeagueData);
  }
}
window.toggleLeagueCommissionerMode = toggleLeagueCommissionerMode;

/**
 * Toggles the Registration Window for Sparring Radar exposure
 */
async function toggleLeagueRegistrationWindow(leagueId = 'league_sd40k_big_league') {
  try {
    const currentlyOpen = leagueState.currentLeagueData
      ? (leagueState.currentLeagueData.registration_open !== false)
      : true;
    const targetOpen = !currentlyOpen;
    const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/registration-window`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_open: targetOpen })
    });
    const json = await res.json();
    if (json.success) {
      const nextOpen = Boolean(json.registration_open);
      if (leagueState.currentLeagueData) {
        leagueState.currentLeagueData.registration_open = nextOpen;
        renderLeagueHub(leagueState.currentLeagueData);
      }
      if (typeof syncStudioLeagueCommissionerCard === 'function') {
        syncStudioLeagueCommissionerCard(leagueId);
      }
      renderSparringRadarLeagueRegistrations();
      if (typeof showToast === 'function') {
        showToast(nextOpen ? '🟢 Registration Window OPENED in Sparring Radar' : '🔒 Registration Window CLOSED');
      }
    }
  } catch (e) {
    console.error('Error toggling registration window:', e);
  }
}
window.toggleLeagueRegistrationWindow = toggleLeagueRegistrationWindow;

/**
 * Navigates to Community Hub -> Sparring Radar to view the active League Registration Banner
 */
function viewLeagueInSparringRadar() {
  if (typeof switchTab === 'function') switchTab('community');
  if (typeof switchCommunitySubtab === 'function') {
    setTimeout(() => {
      switchCommunitySubtab('radar');
      renderSparringRadarLeagueRegistrations();
    }, 60);
  }
}
window.viewLeagueInSparringRadar = viewLeagueInSparringRadar;

/**
 * Renders active League Registration banners inside Sparring Radar ONLY when registration is open
 */
async function renderSparringRadarLeagueRegistrations() {
  const container = document.getElementById('radar-active-league-registrations');
  if (!container) return;

  try {
    const res = await fetch('/api/leagues');
    if (!res.ok) return;
    const json = await res.json();
    const openLeagues = (json.leagues || []).filter(l => l.registration_open !== false);
    if (!openLeagues.length) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = openLeagues.map(l => {
      const lid = l.league_id || 'league_sd40k_big_league';
      return `
        <div class="card" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.14) 0%, rgba(15, 23, 42, 0.92) 100%); border: 1px solid rgba(16, 185, 129, 0.45); border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 0.85rem; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.85rem;">
            <div style="flex: 1; min-width: 260px;">
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.3rem;">
                <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.45); font-size: 0.68rem; font-weight: 800; padding: 2px 8px; border-radius: 999px; text-transform: uppercase;">
                  📡 LIVE REGISTRATION OPEN • SPARRING RADAR
                </span>
                <span style="font-size: 0.74rem; color: #fbbf24; font-weight: 700;">
                  🔁 Auto-Recurring 8-Week Seasons • 5 Games / Season
                </span>
              </div>
              <h3 style="margin: 0 0 0.25rem 0; font-size: 1.15rem; font-weight: 800; color: #fff;">
                🛡️ ${escapeHtml(l.name || 'San Diego 40k BIG League @ At Ease Games')}
              </h3>
              <div style="font-size: 0.8rem; color: #cbd5e1; line-height: 1.45;">
                📍 <strong>${escapeHtml(l.region || 'San Diego, CA')}</strong> • <strong>6–8 Players / Pod</strong> (Evenly Distributed) • <strong>Top 2 ▲ Up 1 Pod</strong> • <strong>Bottom 2 ▼ Down 1 Pod</strong> • <strong>New Entrants Start in Bottom Pod</strong>
              </div>
            </div>
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <button onclick="openLeaguePlayerRegistrationModal('${escapeHtml(lid)}', '${escapeHtml(l.name || 'San Diego 40k BIG League')}')" class="btn btn-primary" style="background: linear-gradient(135deg, #10b981, #059669); border: none; font-weight: 700; font-size: 0.8rem; padding: 0.45rem 0.9rem;">
                📝 Register (Starts in Bottom Pod)
              </button>
              <button onclick="openLeagueHubPage('${escapeHtml(lid)}', '40k', { replaceUrl: true })" class="btn btn-outline" style="border-color: rgba(56, 189, 248, 0.45); color: #38bdf8; font-weight: 700; font-size: 0.8rem; padding: 0.45rem 0.9rem;">
                🛡️ View Detailed League Page →
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {}
}
window.renderSparringRadarLeagueRegistrations = renderSparringRadarLeagueRegistrations;

// Automatically populate Sparring Radar league registration cards on load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(renderSparringRadarLeagueRegistrations, 400);
});

/**
 * Opens Modal to Register a New Player into the Bottom Pod
 */
function openLeaguePlayerRegistrationModal(leagueId, leagueName) {
  const existing = document.getElementById('league-reg-player-modal');
  if (existing) existing.remove();
  const defaultName = (window.currentUser && window.currentUser.name) ? window.currentUser.name : '';

  const html = `
    <div id="league-reg-player-modal" onclick="if(event.target === this) this.remove()" style="position: fixed; inset: 0; background: rgba(0,0,0,0.78); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 99999; padding: 1rem;">
      <div onclick="event.stopPropagation()" style="background: var(--bg-card); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 12px; width: 100%; max-width: 460px; padding: 1.5rem; box-shadow: 0 20px 50px rgba(0,0,0,0.7);">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 0.85rem;">
          <div>
            <div style="font-size: 0.72rem; color: #34d399; font-weight: 800; text-transform: uppercase;">Sparring Radar League Registration</div>
            <h3 style="margin: 0.15rem 0 0; font-size: 1.25rem; font-weight: 800; color: #fff;">Join ${escapeHtml(leagueName)}</h3>
          </div>
          <button onclick="document.getElementById('league-reg-player-modal').remove()" style="background: none; border: none; font-size: 1.25rem; color: var(--text-muted); cursor: pointer;">✕</button>
        </div>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.45;">
          Per league rules, all new registrants begin in the <strong>Bottom Pod</strong> and earn promotion up 1 pod per season by finishing in the Top 2 of their pod.
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.8rem; margin-bottom: 1.15rem;">
          <div>
            <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #fff; margin-bottom: 0.3rem;">Competitor Name *</label>
            <input type="text" id="reg-league-player-name" value="${escapeHtml(defaultName)}" placeholder="Enter your player name" class="form-input" style="width: 100%; box-sizing: border-box;" />
          </div>
          <div>
            <label style="display: block; font-size: 0.78rem; font-weight: 700; color: #fff; margin-bottom: 0.3rem;">Locked Primary Faction (Season) *</label>
            <input type="text" id="reg-league-player-faction" placeholder="e.g. Adeptus Custodes, Space Marines, Necrons" class="form-input" style="width: 100%; box-sizing: border-box;" />
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button onclick="submitLeaguePlayerRegistration('${escapeHtml(leagueId)}')" class="btn btn-primary" style="flex: 1; background: linear-gradient(135deg, #10b981, #059669); border: none; font-weight: 700;">
            ✓ Confirm Bottom-Pod Registration
          </button>
          <button onclick="document.getElementById('league-reg-player-modal').remove()" class="btn btn-outline">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}
window.openLeaguePlayerRegistrationModal = openLeaguePlayerRegistrationModal;

async function submitLeaguePlayerRegistration(leagueId) {
  const name = document.getElementById('reg-league-player-name')?.value.trim();
  const faction = document.getElementById('reg-league-player-faction')?.value.trim() || 'Space Marines';
  if (!name) {
    alert('Please enter your player name.');
    return;
  }
  try {
    const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, primary_faction: faction })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Registration failed');
    document.getElementById('league-reg-player-modal')?.remove();
    if (leagueState._cache) delete leagueState._cache[leagueId];
    openLeagueHubPage(leagueId, '40k', { replaceUrl: true, pod: json.assigned_pod });
  } catch (e) {
    alert('Registration error: ' + e.message);
  }
}
window.submitLeaguePlayerRegistration = submitLeaguePlayerRegistration;

/**
 * Preview Automated Season Rollover (Top 2 Up 1 Pod, Bottom 2 Down 1 Pod, Middle Stay, 6-8 Pod Balance)
 */
async function openLeagueRolloverPreviewModal(leagueId = 'league_sd40k_big_league') {
  try {
    const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/rollover/preview`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to compute rollover preview');

    const promos = json.promotions || [];
    const relegs = json.relegations || [];
    const existing = document.getElementById('league-rollover-preview-modal');
    if (existing) existing.remove();

    const html = `
      <div id="league-rollover-preview-modal" onclick="if(event.target === this) this.remove()" style="position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; z-index: 99999; padding: 1rem;">
        <div onclick="event.stopPropagation()" style="background: var(--bg-card); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 12px; width: 100%; max-width: 720px; max-height: 88vh; overflow-y: auto; padding: 1.5rem; box-shadow: 0 20px 50px rgba(0,0,0,0.75);">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem;">
            <div>
              <div style="font-size: 0.72rem; color: #fbbf24; font-weight: 800; text-transform: uppercase;">Automated Season Rollover Engine (Season ${json.season_number} → Season ${json.next_season_number})</div>
              <h2 style="margin: 0.2rem 0 0; font-size: 1.3rem; font-weight: 800; color: #fff;">6–8 Player Pod Balance • Top 2 ▲ Up 1 • Bottom 2 ▼ Down 1</h2>
            </div>
            <button onclick="document.getElementById('league-rollover-preview-modal').remove()" style="background: none; border: none; font-size: 1.3rem; color: var(--text-muted); cursor: pointer;">✕</button>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
            <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 0.85rem;">
              <div style="font-weight: 800; color: #34d399; font-size: 0.85rem; margin-bottom: 0.5rem;">▲ Top 2 Promoted (+1 Pod Up) — ${promos.length} Players</div>
              <div style="max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.78rem;">
                ${promos.map(p => `
                  <div style="display: flex; justify-content: space-between; padding: 4px 6px; background: rgba(0,0,0,0.25); border-radius: 4px;">
                    <strong style="color: #fff;">${escapeHtml(p.name)}</strong>
                    <span style="color: #34d399; font-weight: 700;">Pod #${p.from_pod} → Pod #${p.to_pod}</span>
                  </div>
                `).join('')}
              </div>
            </div>
            <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 0.85rem;">
              <div style="font-weight: 800; color: #f87171; font-size: 0.85rem; margin-bottom: 0.5rem;">▼ Bottom 2 Relegated (-1 Pod Down) — ${relegs.length} Players</div>
              <div style="max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.78rem;">
                ${relegs.map(r => `
                  <div style="display: flex; justify-content: space-between; padding: 4px 6px; background: rgba(0,0,0,0.25); border-radius: 4px;">
                    <strong style="color: #fff;">${escapeHtml(r.name)}</strong>
                    <span style="color: #f87171; font-weight: 700;">Pod #${r.from_pod} → Pod #${r.to_pod}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
            <button onclick="document.getElementById('league-rollover-preview-modal').remove()" class="btn btn-primary" style="padding: 0.45rem 1.25rem;">Close Preview</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  } catch (e) {
    alert('Error loading rollover preview: ' + e.message);
  }
}
window.openLeagueRolloverPreviewModal = openLeagueRolloverPreviewModal;

function closeLeagueModal(e) {
  const backdrop = e.currentTarget;
  if (backdrop) backdrop.remove();
}

// Attach globally
window.openLeagueHubPage = openLeagueHubPage;
window.switchLeagueSubtab = switchLeagueSubtab;
window.switchPod = switchPod;
window.selectLeaguePod = (podNumOrId) => {
  const num = typeof podNumOrId === 'string' ? parseInt(podNumOrId.replace(/\D/g, ''), 10) || 1 : Number(podNumOrId) || 1;
  switchPod(num);
};
window.selectHistoricalLeagueSeason = selectLeagueSeason;
window.previewLeagueSeasonRollover = openLeagueRolloverPreviewModal;
window.openLeaguePlayerCareerModal = openPlayerLeagueModal;
window.switchHofCategory = switchHofCategory;
window.launchLeagueMatchTracker = launchLeagueMatchTracker;
window.openPlayerLeagueModal = openPlayerLeagueModal;
window.openScoreReportingModal = openScoreReportingModal;
window.submitLeagueScore = submitLeagueScore;
window.openCopyLeagueTemplateModal = openCopyLeagueTemplateModal;
window.submitNewLeagueCreation = submitNewLeagueCreation;

/**
 * Opens the "🙋‍♂️ I'm in this League / Link User ID & BCP Player ID" modal.
 * Allows:
 * 1. Linking an unmatched season/pod participant row (that couldn't be matched by name assumption) to an existing `user_id` and `bcp_player_id` (`players.player_id`).
 * 2. Allowing newly registered players to declare "I'm in this league" and join/link with their `user_id` and `bcp_player_id`.
 */
async function openLeaguePlayerClaimModal(leagueId = 'league_sd40k_big_league', preselectedParticipantName = '', preselectedPodNum = null) {
  const existing = document.getElementById('league-player-claim-modal');
  if (existing) existing.remove();

  const currentUser = (window.state && window.state.user) || {
    id: 'u_john_hsieh',
    display_name: 'John Hsieh',
    player_id: 'MEV83VFANA',
    bcp_user_id: 'MEV83VFANA'
  };
  const defaultUserId = currentUser.id || 'u_john_hsieh';
  const defaultBcpId = currentUser.player_id || currentUser.bcp_user_id || 'MEV83VFANA';
  const defaultDisplayName = currentUser.display_name || currentUser.name || 'John Hsieh';

  const league = leagueState.leagueData || {};
  const pods = (league.active_season && league.active_season.pods) || [];
  const unmatchedOptions = [];
  const allOptions = [];
  pods.forEach(p => {
    (p.standings || []).forEach(st => {
      const item = {
        name: st.name,
        pod_num: p.pod_number,
        faction: st.primary_faction || 'Warhammer 40k',
        is_db_matched: Boolean(st.is_db_matched && (st.bcp_player_id || st.player_id))
      };
      allOptions.push(item);
      if (!item.is_db_matched) unmatchedOptions.push(item);
    });
  });

  const targetList = unmatchedOptions.length > 0 ? unmatchedOptions : allOptions;
  const initialMode = 'claim_existing';

  const modalHtml = `
    <div id="league-player-claim-modal" class="modal-backdrop" onclick="if(event.target.id==='league-player-claim-modal') this.remove();" style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.8); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 1rem;">
      <div class="modal-card" style="background: #0f172a; border: 1px solid #334155; border-radius: 12px; max-width: 540px; width: 100%; padding: 1.4rem; color: #f8fafc; box-shadow: 0 20px 50px rgba(0,0,0,0.65);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
          <div>
            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #fff;">🙋‍♂️ I'm in this League — Link User ID &amp; BCP Profile</h3>
            <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 3px;">
              Stored in <code style="color: #38bdf8;">native_league_participants</code> • Links your <code style="color: #34d399;">user_id</code> &amp; <code style="color: #fbbf24;">bcp_player_id</code> (<code style="color: #fbbf24;">players.player_id</code>)
            </div>
          </div>
          <button onclick="document.getElementById('league-player-claim-modal').remove()" style="background: none; border: none; color: #94a3b8; font-size: 1.25rem; cursor: pointer;">✕</button>
        </div>

        <!-- Mode Selector -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1rem;">
          <button type="button" id="claim-mode-existing-btn" onclick="document.getElementById('claim-mode-input').value='claim_existing'; document.getElementById('claim-existing-group').style.display='block'; document.getElementById('claim-mode-existing-btn').style.borderColor='#3b82f6'; document.getElementById('claim-mode-new-btn').style.borderColor='#334155';" style="padding: 0.6rem; border-radius: 8px; border: 2px solid #3b82f6; background: rgba(59, 130, 246, 0.12); color: #fff; font-weight: 700; font-size: 0.8rem; cursor: pointer; text-align: left;">
            🔗 Match Existing Pod Slot
            <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 500; margin-top: 2px;">Couldn't match by name assumption? Link your user_id</div>
          </button>
          <button type="button" id="claim-mode-new-btn" onclick="document.getElementById('claim-mode-input').value='join_new'; document.getElementById('claim-existing-group').style.display='none'; document.getElementById('claim-mode-new-btn').style.borderColor='#3b82f6'; document.getElementById('claim-mode-existing-btn').style.borderColor='#334155';" style="padding: 0.6rem; border-radius: 8px; border: 2px solid #334155; background: rgba(15, 23, 42, 0.6); color: #fff; font-weight: 700; font-size: 0.8rem; cursor: pointer; text-align: left;">
            🆕 Newly Registered Player
            <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 500; margin-top: 2px;">Say "I'm in this league" &amp; add to active season</div>
          </button>
        </div>
        <input type="hidden" id="claim-mode-input" value="${initialMode}" />

        <div id="claim-existing-group" style="margin-bottom: 0.9rem;">
          <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #cbd5e1; text-transform: uppercase; margin-bottom: 4px;">
            Select Unmatched Season / Pod Participant Slot
          </label>
          <select id="claim-participant-select" style="width: 100%; padding: 0.55rem 0.75rem; border-radius: 8px; background: #1e293b; border: 1px solid #475569; color: #fff; font-size: 0.85rem; font-weight: 600;">
            ${targetList.map(opt => `
              <option value="${escapeHtml(opt.name)}" data-pod="${opt.pod_num}" ${opt.name === preselectedParticipantName ? 'selected' : ''}>
                Pod #${opt.pod_num} — ${escapeHtml(opt.name)} (${escapeHtml(opt.faction)}) ${opt.is_db_matched ? '[Matched]' : '[Unlinked in DB]'}
              </option>
            `).join('')}
          </select>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.9rem;">
          <div>
            <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #cbd5e1; text-transform: uppercase; margin-bottom: 4px;">
              Registered User ID (<code style="color:#34d399;">users.id</code>)
            </label>
            <input type="text" id="claim-user-id-input" value="${escapeHtml(defaultUserId)}" style="width: 100%; padding: 0.5rem 0.7rem; border-radius: 8px; background: #1e293b; border: 1px solid #475569; color: #34d399; font-family: monospace; font-size: 0.82rem;" />
          </div>
          <div>
            <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #cbd5e1; text-transform: uppercase; margin-bottom: 4px;">
              BCP Player ID (<code style="color:#fbbf24;">players.player_id</code>)
            </label>
            <input type="text" id="claim-bcp-id-input" value="${escapeHtml(defaultBcpId)}" style="width: 100%; padding: 0.5rem 0.7rem; border-radius: 8px; background: #1e293b; border: 1px solid #475569; color: #fbbf24; font-family: monospace; font-size: 0.82rem;" />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1.1rem;">
          <div>
            <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #cbd5e1; text-transform: uppercase; margin-bottom: 4px;">
              Verified Display Name
            </label>
            <input type="text" id="claim-display-name-input" value="${escapeHtml(defaultDisplayName)}" style="width: 100%; padding: 0.5rem 0.7rem; border-radius: 8px; background: #1e293b; border: 1px solid #475569; color: #fff; font-size: 0.84rem;" />
          </div>
          <div>
            <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #cbd5e1; text-transform: uppercase; margin-bottom: 4px;">
              Primary Faction
            </label>
            <input type="text" id="claim-faction-input" value="Dark Angels" style="width: 100%; padding: 0.5rem 0.7rem; border-radius: 8px; background: #1e293b; border: 1px solid #475569; color: #fff; font-size: 0.84rem;" />
          </div>
        </div>

        <div id="claim-status-msg" style="display: none; margin-bottom: 0.85rem; padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.8rem; font-weight: 600;"></div>

        <div style="display: flex; justify-content: flex-end; gap: 0.6rem;">
          <button type="button" onclick="document.getElementById('league-player-claim-modal').remove()" class="btn btn-outline" style="padding: 0.45rem 0.95rem;">Cancel</button>
          <button type="button" onclick="submitLeagueParticipantClaim('${escapeHtml(leagueId)}')" class="btn btn-primary" style="padding: 0.45rem 1.1rem; background: linear-gradient(135deg, #2563eb, #3b82f6); border: none; font-weight: 700;">
            ✓ Link Profile &amp; Make Clickable
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}
window.openLeaguePlayerClaimModal = openLeaguePlayerClaimModal;

async function submitLeagueParticipantClaim(leagueId = 'league_sd40k_big_league') {
  const mode = document.getElementById('claim-mode-input')?.value || 'claim_existing';
  const selectEl = document.getElementById('claim-participant-select');
  const participantName = selectEl?.value || '';
  const selectedOpt = selectEl?.options[selectEl.selectedIndex];
  const podNum = parseInt(selectedOpt?.getAttribute('data-pod') || '1', 10) || 1;
  const userId = document.getElementById('claim-user-id-input')?.value?.trim() || 'u_john_hsieh';
  const bcpPlayerId = document.getElementById('claim-bcp-id-input')?.value?.trim() || 'MEV83VFANA';
  const displayName = document.getElementById('claim-display-name-input')?.value?.trim() || 'John Hsieh';
  const primaryFaction = document.getElementById('claim-faction-input')?.value?.trim() || 'Dark Angels';
  const msgEl = document.getElementById('claim-status-msg');

  try {
    const res = await fetch(`/api/league/${encodeURIComponent(leagueId)}/claim-participant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        participant_name: participantName,
        pod_num: podNum,
        user_id: userId,
        bcp_player_id: bcpPlayerId,
        display_name: displayName,
        primary_faction: primaryFaction
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || data.detail || 'Failed to link participant');
    }
    if (data.league) {
      leagueState.leagueData = data.league;
      const container = document.getElementById('league-hub-view') || document.getElementById('main-content');
      if (container) {
        renderLeagueHub(container, data.league);
      }
    }
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.background = 'rgba(16, 185, 129, 0.18)';
      msgEl.style.border = '1px solid rgba(16, 185, 129, 0.45)';
      msgEl.style.color = '#34d399';
      msgEl.textContent = `✓ Linked ${participantName || displayName} to user_id=${userId} & bcp_player_id=${bcpPlayerId}! Player is now DB-matched and clickable.`;
    }
    setTimeout(() => {
      document.getElementById('league-player-claim-modal')?.remove();
    }, 900);
  } catch (err) {
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.background = 'rgba(239, 68, 68, 0.18)';
      msgEl.style.border = '1px solid rgba(239, 68, 68, 0.45)';
      msgEl.style.color = '#f87171';
      msgEl.textContent = `Error: ${err.message}`;
    }
  }
}
window.submitLeagueParticipantClaim = submitLeagueParticipantClaim;


