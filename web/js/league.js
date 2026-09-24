/**
 * LEAGUE.JS - Sovereign Community Leagues Engine for OmniTactica.
 * Faithfully implements the San Diego Force Org (SD40K) 38-season battle-tested methodology.
 * Supports Season 38 Pods, Standings, Pairings, Hall of Fame, Rules, and 1-Click Community Duplication.
 */

const SD40K_CANONICAL_UUID = '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90';
const GAUNTLET_CANONICAL_UUID = '7a9e4c1b-3d28-4f6a-9c1e-5b8d2a4f6c91';

function normalizeLeagueIdToUuid(rawId) {
  const s = String(rawId || SD40K_CANONICAL_UUID).trim().toLowerCase().replace(/^lg_/, '');
  if (!s || s === 'sd40k' || s === 'league_sd40k_big_league' || s === 'sd40k_big_league' || s === SD40K_CANONICAL_UUID) {
    return SD40K_CANONICAL_UUID;
  }
  if (s === 'gauntlet' || s === 'the-gauntlet' || s === 'the_gauntlet' || s === 'league_the_gauntlet' || s === 'the_gauntlet_bfg' || s === GAUNTLET_CANONICAL_UUID) {
    return GAUNTLET_CANONICAL_UUID;
  }
  // Check if availableLeagues maps a slug to a UUID
  if (typeof leagueState !== 'undefined' && Array.isArray(leagueState.availableLeagues)) {
    const match = leagueState.availableLeagues.find(
      l => String(l.slug || '').toLowerCase() === s || String(l.league_id || '').toLowerCase() === s
    );
    if (match && match.league_id) return String(match.league_id);
  }
  return s;
}
if (typeof window !== 'undefined') window.normalizeLeagueIdToUuid = normalizeLeagueIdToUuid;

function copyLeagueHubLink(leagueId, gameSystem = '40k') {
  const canonicalUuid = normalizeLeagueIdToUuid(leagueId);
  const sys = String(gameSystem || '40k').toLowerCase();
  const url = `${window.location.origin}/#/${sys}/league/${canonicalUuid}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      if (typeof showToast === 'function') showToast('🔗 League link copied to clipboard!');
      else alert(`Copied League URL:\n${url}`);
    }).catch(() => {
      alert(`League URL:\n${url}`);
    });
  } else {
    alert(`League URL:\n${url}`);
  }
}
if (typeof window !== 'undefined') window.copyLeagueHubLink = copyLeagueHubLink;

var leagueState = (typeof window !== 'undefined' && window.leagueState) || {
  activeLeagueId: SD40K_CANONICAL_UUID,
  currentLeagueData: null,
  activeSubtab: 'pods', // 'pods', 'hof', 'methodology'
  activePodNumber: 1,
  activePairingRound: 'all', // 'all', 1, 2, 3, 4, 5
  isLoading: false,
  hofCategory: 'finals_champions' // 'finals_champions', 'titles_and_champs', 'most_games', 'most_wins', 'finals_wins', 'faction_titles'
};
if (typeof window !== 'undefined') window.leagueState = leagueState;

/**
 * Main entry point to navigate to a Detailed League Page (Always addressed by Unique League UUID)
 */
async function openLeagueHubPage(leagueId = SD40K_CANONICAL_UUID, gameSystem = '40k', options = {}) {
  if (typeof closeAllModals === 'function') closeAllModals();
  if (typeof closeEditLocationModal === 'function') closeEditLocationModal();
  const cleanId = normalizeLeagueIdToUuid(leagueId);
  const targetSys = String(gameSystem || '40k').toLowerCase();

  if (leagueState.activeLeagueId !== cleanId) {
    leagueState.activePodNumber = 1;
    leagueState.activePairingRound = 'all';
  }
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

  // Always update URL hash with canonical League UUID (never a slug like league_sd40k_big_league)
  const targetHash = `/#/${targetSys}/league/${cleanId}`;
  if (window.history && window.history.pushState && !options.replaceUrl) {
    window.history.pushState({ leagueId: cleanId, sys: targetSys }, '', targetHash);
  } else if (window.history && window.history.replaceState) {
    window.history.replaceState({ leagueId: cleanId, sys: targetSys }, '', targetHash);
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
  await loadLeagueData(cleanId);
}

/**
 * Loads league data from /api/league/{uuid}
 */
async function loadLeagueData(leagueId, forceRefresh = false) {
  const container = document.getElementById('league-hub-container');
  if (!container) return;

  const cleanId = normalizeLeagueIdToUuid(leagueId);
  if (!leagueState._cache) leagueState._cache = {};

  if (!leagueState.availableLeagues) {
    fetch('/api/leagues')
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j && Array.isArray(j.leagues) && j.leagues.length) {
          leagueState.availableLeagues = j.leagues;
        }
      })
      .catch(() => {});
  }

  const cached = !forceRefresh && leagueState._cache[cleanId];
  if (cached && (Date.now() - cached.timestamp < 60000)) {
    leagueState.currentLeagueData = cached.data;
    if (cached.data && cached.data.league_id && window.history && window.history.replaceState) {
      window.history.replaceState({ leagueId: cached.data.league_id, sys: '40k' }, '', `/#/40k/league/${cached.data.league_id}`);
    }
    try {
      renderLeagueHub(cached.data);
      return;
    } catch (renderErr) {
      console.error('Cached renderLeagueHub error, refetching:', renderErr);
      delete leagueState._cache[cleanId];
    }
  }

  leagueState.isLoading = true;
  container.innerHTML = `
    <div class="empty-state" style="padding: 4rem 1rem; text-align: center;">
      <div class="spinner"></div>
      <div style="margin-top: 1rem; font-weight: 600; color: var(--text-primary);">Loading Detailed League Hub...</div>
      <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">Fetching Active Season Pods, Standings &amp; Hall of Fame Archives (${escapeHtml(cleanId)})</div>
    </div>
  `;

  try {
    let res = await fetch(`/api/league/${encodeURIComponent(cleanId)}`).catch(() => ({ ok: false }));
    let leagueObj = null;
    if (res && res.ok) {
      try {
        const json = await res.json();
        if (json && json.success && json.league) {
          leagueObj = json.league;
        }
      } catch (_) {}
    }
    if (!leagueObj && cleanId === SD40K_CANONICAL_UUID) {
      const res2 = await fetch(`/api/league/${SD40K_CANONICAL_UUID}`).catch(() => ({ ok: false }));
      if (res2 && res2.ok) {
        try {
          const json2 = await res2.json();
          if (json2 && json2.success && json2.league) {
            leagueObj = json2.league;
          }
        } catch (_) {}
      }
    }
    if (!leagueObj && (cleanId.includes('8f5e3b2c') || cleanId.includes('sd40k') || cleanId.includes('force_org'))) {
      leagueObj = getFallbackSd40kLeagueData();
    }
    if (!leagueObj) throw new Error('League not found');
    const canonicalUuid = normalizeLeagueIdToUuid(leagueObj.league_id || cleanId);
    leagueObj.league_id = canonicalUuid;
    leagueState.activeLeagueId = canonicalUuid;
    if (window.history && window.history.replaceState) {
      window.history.replaceState({ leagueId: canonicalUuid, sys: '40k' }, '', `/#/40k/league/${canonicalUuid}`);
    }
    const activeSeasonNum = parseInt(leagueObj.selected_season || leagueObj.active_season?.season_number || 1, 10) || 1;
    leagueState.currentLeagueData = leagueObj;
    leagueState.currentLeagueData.selected_season = activeSeasonNum;
    leagueState.currentLeagueData.is_historical = false;
    renderLeagueHub(leagueObj);
    leagueState._cache[canonicalUuid] = { data: leagueObj, timestamp: Date.now() };
    if (!leagueState._seasonCache) leagueState._seasonCache = {};
    leagueState._seasonCache[`${canonicalUuid}_${activeSeasonNum}`] = leagueObj;
  } catch (err) {
    console.error('Error loading league data:', err);
    container.innerHTML = `
      <div class="empty-state" style="padding: 3rem 1rem; text-align: center;">
        <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🛡️</div>
        <div style="font-size: 1.25rem; font-weight: 700; color: #ef4444; margin-bottom: 0.5rem;">League Hub Not Found</div>
        <div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1.5rem;">Could not load data for league "${escapeHtml(cleanId)}".</div>
        <button onclick="switchTab('tournaments')" class="btn btn-outline">← Back to Tournaments &amp; Leagues</button>
      </div>
    `;
  } finally {
    leagueState.isLoading = false;
  }
}

function formatLeagueDateShort(rawDate) {
  if (!rawDate) return 'TBD';
  const clean = String(rawDate).trim().slice(0, 10);
  const parts = clean.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dt = new Date(Date.UTC(y, m, d));
    if (!isNaN(dt.getTime())) {
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    }
  }
  return clean;
}
window.formatLeagueDateShort = formatLeagueDateShort;

function getFallbackSd40kLeagueData() {
  return {
    league_id: '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90',
    slug: 'sd40k',
    name: 'San Diego Force Org League',
    short_name: 'SD Force Org',
    tagline: 'Southern California Premier 40k Pod League • Est. 2018 (38 Seasons)',
    region: 'San Diego, CA',
    city: 'San Diego, CA',
    owner_user_id: 'user_john_hsieh_admin',
    owner_player_id: 'MEV83VFANA',
    owner_email: 'hsiehjun@google.com',
    owner_name: 'John Hsieh',
    registration_open: true,
    start_date: '2026-09-15',
    end_date: '2026-11-10',
    registration_start: '2026-09-01',
    registration_end: '2026-09-14',
    commissioners: [
      { name: 'John Hsieh (League Owner)', role: 'Owner & Head Commissioner' },
      { name: 'Coop (San Diego 40k)', role: 'Pod Commissioner' },
      { name: 'Ben (At Ease Games)', role: 'Venue Coordinator' }
    ],
    partner_venues: [
      { name: 'At Ease Games', address: '8990 Miramar Rd, San Diego, CA 92126', tables: 18 }
    ],
    active_season: {
      season_number: 38,
      name: 'Season 38 (Fall 2026)',
      status: 'active',
      start_date: '2026-09-15',
      end_date: '2026-11-10',
      registration_start: '2026-09-01',
      registration_end: '2026-09-14',
      duration_weeks: 8,
      rounds_count: 5,
      total_players: 68,
      total_pods: 8,
      pods: [
        {
          pod_number: 1,
          name: 'POD #1 - Warlord Division',
          pod_name: 'Pod 1 — Warlord Division',
          tier_badge: 'TIER 1 • PREMIER',
          standings: [
            { rank: 1, player_id: 'MEV83VFANA', bcp_player_id: 'MEV83VFANA', name: 'John Hsieh', display_name: 'John Hsieh', primary_faction: 'Dark Angels', faction: 'Dark Angels', detachment: 'Gladius Task Force', wins: 4, losses: 0, draws: 0, games_played: 4, battle_points: 374, vp_diff: '+118', elo: 1845.5, is_db_matched: true, db_matched: true, promotion_zone: 'stay_top', pairings: [{ round: 1, opponent_name: 'Marcus Vance', opponent_faction: 'Aeldari', score: '96 - 78', is_completed: true }, { round: 2, opponent_name: 'Devon Mercer', opponent_faction: 'Necrons', score: '92 - 81', is_completed: true }] },
            { rank: 2, player_id: 'SD40K_P02', bcp_player_id: 'SD40K_P02', name: 'Marcus Vance', display_name: 'Marcus Vance', primary_faction: 'Aeldari', faction: 'Aeldari', detachment: 'Battle Host', wins: 3, losses: 1, draws: 0, games_played: 4, battle_points: 342, vp_diff: '+64', elo: 1790.2, is_db_matched: true, db_matched: true, promotion_zone: 'stay_top', pairings: [] },
            { rank: 3, player_id: 'SD40K_P03', bcp_player_id: 'SD40K_P03', name: 'Devon Mercer', display_name: 'Devon Mercer', primary_faction: 'Necrons', faction: 'Necrons', detachment: 'Hypercrypt Legion', wins: 3, losses: 1, draws: 0, games_played: 4, battle_points: 328, vp_diff: '+41', elo: 1752.0, is_db_matched: true, db_matched: true, promotion_zone: 'safe', pairings: [] },
            { rank: 4, player_id: 'SD40K_P04', bcp_player_id: 'SD40K_P04', name: 'Elena Rostova', display_name: 'Elena Rostova', primary_faction: 'Astra Militarum', faction: 'Astra Militarum', detachment: 'Combined Regiment', wins: 2, losses: 2, draws: 0, games_played: 4, battle_points: 301, vp_diff: '+8', elo: 1718.4, is_db_matched: true, db_matched: true, promotion_zone: 'safe', pairings: [] },
            { rank: 5, player_id: 'SD40K_P05', bcp_player_id: 'SD40K_P05', name: 'Tyler Thorne', display_name: 'Tyler Thorne', primary_faction: 'Thousand Sons', faction: 'Thousand Sons', detachment: 'Cult of Magic', wins: 2, losses: 2, draws: 0, games_played: 4, battle_points: 289, vp_diff: '-12', elo: 1695.0, is_db_matched: true, db_matched: true, promotion_zone: 'safe', pairings: [] },
            { rank: 6, player_id: 'SD40K_P06', bcp_player_id: '', name: 'Ryan Kestrel', display_name: 'Ryan Kestrel', primary_faction: 'World Eaters', faction: 'World Eaters', detachment: 'Berzerker Warband', wins: 1, losses: 3, draws: 0, games_played: 4, battle_points: 264, vp_diff: '-55', elo: 1660.8, is_db_matched: false, db_matched: false, promotion_zone: 'safe', pairings: [] },
            { rank: 7, player_id: 'SD40K_P07', bcp_player_id: '', name: 'Caleb Vance', display_name: 'Caleb Vance', primary_faction: 'Orks', faction: 'Orks', detachment: 'Bully Boyz', wins: 1, losses: 3, draws: 0, games_played: 4, battle_points: 245, vp_diff: '-76', elo: 1632.1, is_db_matched: false, db_matched: false, promotion_zone: 'relegate', pairings: [] },
            { rank: 8, player_id: 'SD40K_P08', bcp_player_id: 'SD40K_P08', name: 'Liam O\'Connor', display_name: 'Liam O\'Connor', primary_faction: 'T\'au Empire', faction: 'T\'au Empire', detachment: 'Retaliation Cadre', wins: 0, losses: 4, draws: 0, games_played: 4, battle_points: 218, vp_diff: '-88', elo: 1604.5, is_db_matched: true, db_matched: true, promotion_zone: 'relegate', pairings: [] }
          ]
        },
        { pod_number: 2, name: 'POD #2 - Warlord Division', pod_name: 'Pod 2 — Primarch Division', tier_badge: 'TIER 2', standings: [] },
        { pod_number: 3, name: 'POD #3 - Chapter Master Division', pod_name: 'Pod 3 — Chapter Master Division', tier_badge: 'TIER 3', standings: [] },
        { pod_number: 4, name: 'POD #4 - Captain Division', pod_name: 'Pod 4 — Captain Division', tier_badge: 'TIER 4', standings: [] },
        { pod_number: 5, name: 'POD #5 - Lieutenant Division', pod_name: 'Pod 5 — Lieutenant Division', tier_badge: 'TIER 5', standings: [] },
        { pod_number: 6, name: 'POD #6 - Veteran Division', pod_name: 'Pod 6 — Veteran Division', tier_badge: 'TIER 6', standings: [] },
        { pod_number: 7, name: 'POD #7 - Battleline Division', pod_name: 'Pod 7 — Battleline Division', tier_badge: 'TIER 7', standings: [] },
        { pod_number: 8, name: 'POD #8 - Scout Division', pod_name: 'Pod 8 — Scout Division', tier_badge: 'TIER 8', standings: [] }
      ]
    }
  };
}

/**
 * Renders the entire Detailed League Hub interface (behaves like a Detailed Event Hub page)
 */
function renderLeagueHub(league) {
  const container = document.getElementById('league-hub-container');
  if (!container) return;

  const actSeason = league.active_season || {};
  const pods = actSeason.pods || [];
  const currentPod = pods.find(p => p.pod_number === leagueState.activePodNumber) || pods[0] || {};
  const methodology = league.methodology || {};

  const availableSeasons = (league.available_seasons && league.available_seasons.length > 0)
    ? league.available_seasons
    : [{
        season_number: actSeason.season_number || 1,
        name: actSeason.name || `Season ${actSeason.season_number || 1}`,
        status: 'active',
        total_pods: pods.length || 1,
        total_players: actSeason.total_players || 8
      }];
  const currentSeasonNum = parseInt(league.selected_season || actSeason.season_number || 1, 10);
  const totalSeasonsCount = availableSeasons.length || currentSeasonNum;
  const canonicalUuid = normalizeLeagueIdToUuid(league.league_id || leagueState.activeLeagueId);
  const activeSlug = (league.slug || canonicalUuid).toLowerCase();
  const isGauntlet = activeSlug.includes('gauntlet') || canonicalUuid === GAUNTLET_CANONICAL_UUID;
  const rawStartDate = String(actSeason.start_date || league.start_date || (isGauntlet ? '2026-09-01' : '2026-09-15')).slice(0, 10);
  const rawEndDate = String(actSeason.end_date || league.end_date || (isGauntlet ? '2026-10-26' : '2026-11-10')).slice(0, 10);
  const prettyStartDate = formatLeagueDateShort(rawStartDate);
  const prettyEndDate = formatLeagueDateShort(rawEndDate);
  const canManageLeague = Boolean(
    window.isEventStudioCommissionerView ||
    (typeof currentUser !== 'undefined' && currentUser && (
      currentUser.is_admin ||
      ['admin', 'superuser', 'developer', 'owner', 'to', 'organizer', 'referee'].includes(String(currentUser.role || '').trim().toLowerCase()) ||
      currentUser.can_access_to
    ))
  );

  container.innerHTML = `
    <!-- League Hero Banner -->
    <div class="card" style="margin-bottom: 1.25rem; background: linear-gradient(135deg, rgba(30, 58, 138, 0.25) 0%, rgba(15, 23, 42, 0.8) 100%); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px; padding: 1.25rem; position: relative; overflow: hidden;">
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
        <div style="display: flex; align-items: flex-start; gap: 1rem; flex: 1 1 440px; min-width: 0; max-width: 100%; flex-wrap: wrap;">
          <div style="width: 64px; height: 64px; border-radius: 12px; background: ${isGauntlet ? 'linear-gradient(135deg, #b91c1c, #7f1d1d)' : 'linear-gradient(135deg, #2563eb, #1e40af)'}; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: #fff; box-shadow: 0 8px 24px rgba(37, 99, 235, 0.4); flex-shrink: 0; border: 2px solid rgba(255, 255, 255, 0.15);">
            ${isGauntlet ? '⚔️' : '🛡️'}
          </div>
          <div style="flex: 1 1 220px; min-width: 0; max-width: 100%;">
            <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.35rem; max-width: 100%;">
              <h1 style="margin: 0; font-size: clamp(1.25rem, 3.2vw, 1.65rem); font-weight: 800; color: #fff; letter-spacing: -0.02em; word-break: break-word;">${escapeHtml(league.name)}</h1>
              <span style="background: rgba(16, 185, 129, 0.16); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.38); padding: 3px 9px; border-radius: 999px; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.03em;">
                ⚡ ${escapeHtml(actSeason.name || `Season ${currentSeasonNum}`)} • Current Active Season
              </span>
              <span id="league-hero-dates-pill" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); padding: 3px 10px; border-radius: 999px; font-size: 0.74rem; font-weight: 800;">
                📅 Started: ${escapeHtml(prettyStartDate)} • Ends: ${escapeHtml(prettyEndDate)}
              </span>
            </div>
            <div style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 0.5rem; word-break: break-word;">
              ${escapeHtml(league.tagline || 'Southern California Premier 40k Pod League')}
            </div>
            <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap; font-size: 0.78rem; color: #cbd5e1;">
              <span>📍 <strong>${escapeHtml(league.region || league.city || 'San Diego, CA')}</strong></span>
              <span>•</span>
              <span>👔 Commissioners: <strong>${escapeHtml((league.commissioners || []).map(c => c.name).join(' & ') || 'Coop & Ben')}</strong></span>
              <span>•</span>
              <span>🏢 Host Store: <strong>${escapeHtml((league.partner_venues && league.partner_venues[0]?.name) || 'At Ease Games')}</strong></span>
              <span>•</span>
              <span style="color: #7dd3fc;">🗓️ <strong>League Schedule:</strong> ${escapeHtml(prettyStartDate)} (${escapeHtml(rawStartDate)}) → ${escapeHtml(prettyEndDate)} (${escapeHtml(rawEndDate)})</span>
            </div>
          </div>
        </div>

        <!-- Back & External Links -->
        <div style="display: flex; align-items: center; justify-content: flex-end; flex-shrink: 0; gap: 0.5rem; flex-wrap: wrap;">
          <button type="button" onclick="if (typeof switchTab === 'function') switchTab('tournaments');" class="btn btn-outline" style="font-size: 0.8rem; padding: 0.45rem 0.85rem; font-weight: 700; color: #e2e8f0; border-color: rgba(255,255,255,0.18);">
            ← All Leagues
          </button>
          ${isGauntlet ? `
            <a href="https://docs.google.com/spreadsheets/d/13BLLEaRpReB5MbPQS-vqd5oMqbCRBf4ca0fX-qm1V0U/edit?usp=sharing" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size: 0.8rem; padding: 0.45rem 0.95rem; text-align: center; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;">
              <span>📊 Official Gauntlet Sheet</span>
            </a>
          ` : `
            <a href="https://sd40k.com" target="_blank" rel="noopener noreferrer" class="btn btn-outline" style="font-size: 0.8rem; padding: 0.45rem 0.95rem; text-align: center; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;">
              <span>🌐 Official Website (sd40k.com)</span>
            </a>
          `}
        </div>
      </div>

      <!-- 5 Season KPI Badges (Including Season Start & End Dates) -->
      <div class="league-hero-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap: 0.65rem; margin-top: 1rem; border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 1rem;">
        <div style="background: rgba(0, 0, 0, 0.25); padding: 0.55rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);">
          <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Active Players</div>
          <div style="font-size: 1.2rem; font-weight: 800; color: #60a5fa;">${actSeason.total_players || 28}</div>
        </div>
        <div style="background: rgba(0, 0, 0, 0.25); padding: 0.55rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);">
          <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Active Pods</div>
          <div style="font-size: 1.2rem; font-weight: 800; color: #a78bfa;">${actSeason.total_pods || pods.length || 3} Pods (${methodology.pod_size_min || 6}–${methodology.pod_size_max || 8}p)</div>
        </div>
        <div style="background: rgba(0, 0, 0, 0.25); padding: 0.55rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);">
          <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Season Format</div>
          <div style="font-size: 1.2rem; font-weight: 800; color: #34d399;">${actSeason.rounds_count || 5} Games / ${actSeason.duration_weeks || 8} Wks</div>
        </div>
        <div id="league-hero-kpi-dates" style="background: rgba(56, 189, 248, 0.1); padding: 0.55rem 0.75rem; border-radius: 8px; border: 1px solid rgba(56, 189, 248, 0.35);">
          <div style="font-size: 0.68rem; color: #7dd3fc; text-transform: uppercase; font-weight: 700;">Season Timeline (Start → End)</div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #f8fafc; margin-top: 2px;">${escapeHtml(prettyStartDate)} → ${escapeHtml(prettyEndDate)}</div>
          <div style="font-size: 0.68rem; color: #94a3b8; margin-top: 1px;">Started: ${escapeHtml(rawStartDate)} • Ends: ${escapeHtml(rawEndDate)}</div>
        </div>
        <div style="background: rgba(0, 0, 0, 0.25); padding: 0.55rem 0.75rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);">
          <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">History</div>
          <div style="font-size: 1.2rem; font-weight: 800; color: #fbbf24;">${totalSeasonsCount} Season${totalSeasonsCount === 1 ? '' : 's'}</div>
        </div>
      </div>
    </div>

    <style>
      @media (max-width: 768px) {
        .league-hero-kpi-grid {
          grid-template-columns: repeat(2, 1fr) !important;
        }
        .league-standings-table th.hide-mob,
        .league-standings-table td.hide-mob {
          display: none !important;
        }
        .league-standings-table th,
        .league-standings-table td {
          padding: 0.55rem 0.5rem !important;
          font-size: 0.78rem !important;
        }
        .league-mob-subinfo {
          display: flex !important;
        }
        .league-5col-schedule-table thead {
          display: none !important;
        }
        .league-5col-schedule-table,
        .league-5col-schedule-table tbody {
          display: block !important;
          width: 100% !important;
        }
        .league-5col-schedule-table tr.league-schedule-row {
          display: grid !important;
          grid-template-columns: repeat(2, 1fr) !important;
          gap: 0.45rem !important;
          background: rgba(15, 23, 42, 0.75) !important;
          border: 1px solid rgba(255, 255, 255, 0.09) !important;
          border-radius: 10px !important;
          padding: 0.7rem !important;
          margin-bottom: 0.65rem !important;
        }
        .league-5col-schedule-table td.league-schedule-player-cell {
          grid-column: 1 / -1 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          background: transparent !important;
          border: none !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
          border-radius: 0 !important;
          padding: 0 0 0.45rem 0 !important;
          margin-bottom: 0.15rem !important;
        }
        .league-5col-schedule-table td.league-schedule-opp-cell {
          display: flex !important;
          flex-direction: column !important;
          justify-content: space-between !important;
          text-align: left !important;
          padding: 0.5rem 0.6rem !important;
        }
      }
    </style>

    <!-- Main League Subtabs -->
    <div class="subtabs-bar" style="display: flex; gap: 0.5rem; margin-bottom: 1.25rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; overflow-x: auto; -webkit-overflow-scrolling: touch;">
      <button class="subtab-btn ${leagueState.activeSubtab === 'pods' ? 'active' : ''}" data-league-subtab="pods" onclick="switchLeagueSubtab('pods')" style="white-space: nowrap;">
        <span>🛡️ ${escapeHtml(actSeason.name || `Season ${currentSeasonNum}`)} Pods &amp; Matchups</span>
      </button>
      <button class="subtab-btn ${leagueState.activeSubtab === 'announcements' ? 'active' : ''}" data-league-subtab="announcements" onclick="switchLeagueSubtab('announcements')" style="white-space: nowrap;">
        <span>📢 News &amp; Announcements (${Array.isArray(league.announcements) ? league.announcements.length : 0})</span>
      </button>
      <button class="subtab-btn ${leagueState.activeSubtab === 'hof' ? 'active' : ''}" data-league-subtab="hof" onclick="switchLeagueSubtab('hof')" style="white-space: nowrap;">
        <span>🏆 Hall of Fame &amp; Archives</span>
      </button>
      <button class="subtab-btn ${leagueState.activeSubtab === 'methodology' ? 'active' : ''}" data-league-subtab="methodology" onclick="switchLeagueSubtab('methodology')" style="white-space: nowrap;">
        <span>📜 Rules &amp; Format</span>
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
    if (btn.getAttribute('data-league-subtab') === subtab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

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
  } else if (leagueState.activeSubtab === 'announcements') {
    return renderAnnouncementsSubtab(league);
  } else if (leagueState.activeSubtab === 'hof') {
    return renderHallOfFameSubtab(league);
  } else if (leagueState.activeSubtab === 'methodology') {
    return renderMethodologySubtab(league);
  }
  return '';
}

function renderAnnouncementsSubtab(league) {
  const annList = Array.isArray(league.announcements) ? league.announcements : [];
  const actSeason = league.active_season || {};
  const layouts = (actSeason.season_config && actSeason.season_config.round_layouts) || ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"];
  const lid = escapeHtml(league.league_id || league.slug || '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90');

  return `
    <div class="card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem; margin-bottom: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem; padding-bottom: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.08);">
        <div>
          <h3 style="margin: 0; font-size: 1.12rem; color: #fff; display: flex; align-items: center; gap: 0.5rem;">
            <span>📢 Official Commissioner Announcements &amp; Season Schedule Bulletin</span>
            <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.45); border-radius: 999px; font-size: 0.72rem; padding: 2px 8px; font-weight: 800;">${annList.length} Active</span>
          </h3>
          <p style="margin: 0.25rem 0 0; font-size: 0.8rem; color: var(--text-muted);">
            Official commissioner updates, midpoint check-ins, and seasonal round schedule.
          </p>
        </div>
      </div>

      <!-- Current Season Dates & Round Layout Summary Bar -->
      <div style="background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; padding: 0.8rem 1rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
        <div style="font-size: 0.8rem; color: #e2e8f0;">
          <strong style="color: #38bdf8;">📅 ${escapeHtml(actSeason.name || 'Active Season')} Window:</strong>
          <span style="margin-left: 0.35rem;">${escapeHtml(actSeason.start_date || '2026-09-15')} → ${escapeHtml(actSeason.end_date || '2026-11-10')} (${Number(actSeason.duration_weeks || 8)} Weeks • ${Number(actSeason.rounds_count || 5)} Rounds)</span>
        </div>
        <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
          ${layouts.map((ly, i) => `
            <span style="background: rgba(56, 189, 248, 0.14); border: 1px solid rgba(56, 189, 248, 0.35); color: #38bdf8; border-radius: 5px; padding: 2px 7px; font-size: 0.72rem; font-weight: 700;">
              R${i + 1}: ${escapeHtml(ly)}
            </span>
          `).join('')}
        </div>
      </div>

      ${annList.length === 0 ? `
        <div style="text-align: center; padding: 2rem; color: #94a3b8; font-size: 0.86rem;">
          No official announcements have been posted for this season yet.
        </div>
      ` : annList.map((ann, idx) => {
        const annId = escapeHtml(String(ann.id || ann.broadcast_id || `ann-${idx + 1}`));
        const ackCount = Number(ann.ack_count || 0);
        return `
        <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid ${ann.is_pinned ? 'rgba(245, 158, 11, 0.5)' : 'rgba(255, 255, 255, 0.09)'}; border-left: 4px solid ${ann.priority === 'high' ? '#ef4444' : '#38bdf8'}; border-radius: 10px; padding: 1rem; margin-bottom: 0.85rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.4rem;">
            <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
              ${ann.is_pinned ? `<span style="background: rgba(245, 158, 11, 0.22); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.45); padding: 2px 8px; border-radius: 4px; font-size: 0.68rem; font-weight: 800;">📌 PINNED</span>` : ''}
              ${ann.priority === 'high' ? `<span style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.45); padding: 2px 8px; border-radius: 4px; font-size: 0.68rem; font-weight: 800;">🔴 HIGH PRIORITY ALERT</span>` : ''}
              <span style="background: rgba(56, 189, 248, 0.16); color: #38bdf8; padding: 2px 8px; border-radius: 4px; font-size: 0.68rem; font-weight: 800; text-transform: uppercase;">${escapeHtml(ann.category || 'general')}</span>
              <span style="background: rgba(16, 185, 129, 0.16); color: #34d399; padding: 2px 8px; border-radius: 4px; font-size: 0.68rem; font-weight: 800;">🎯 ${escapeHtml(ann.target_pod || 'All Pods')}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span style="font-size: 0.74rem; color: #94a3b8;">
                👤 ${escapeHtml(ann.author_name || 'Commissioner')} • 🕒 ${escapeHtml(String(ann.created_at || '').slice(0, 10))}
              </span>
              <button type="button" id="league-ann-ack-btn-${annId}" onclick="acknowledgeLeagueAnnouncement('${lid}', '${annId}', this)" class="btn btn-outline" style="font-size: 0.72rem; padding: 0.25rem 0.65rem; border-color: rgba(16, 185, 129, 0.5); color: #34d399; font-weight: 800;">
                ✓ Acknowledge Notice${ackCount > 0 ? ` (${ackCount})` : ''}
              </button>
            </div>
          </div>
          <h4 style="margin: 0.2rem 0 0.4rem; font-size: 1rem; font-weight: 800; color: #fff;">${escapeHtml(ann.title || 'League Announcement')}</h4>
          <div style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.55; white-space: pre-line;">${escapeHtml(ann.body || '')}</div>
        </div>
      `;}).join('')}
    </div>
  `;
}
window.renderAnnouncementsSubtab = renderAnnouncementsSubtab;

async function acknowledgeLeagueAnnouncement(leagueId, broadcastId, btnEl) {
  const player_name = (typeof currentUser !== 'undefined' && (currentUser?.display_name || currentUser?.name)) || 'Registered Player';
  const player_id = (typeof currentUser !== 'undefined' && (currentUser?.player_id || currentUser?.id)) || 'player_anon';
  try {
    const res = await fetch(`/api/eventstudio/ops/${encodeURIComponent(leagueId)}/broadcast/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcast_id: broadcastId, player_id, player_name })
    });
    const data = await res.json();
    const targetBtn = btnEl || document.getElementById(`league-ann-ack-btn-${broadcastId}`);
    if (targetBtn) {
      const matched = (data?.broadcasts || []).find(b => String(b.broadcast_id || b.id) === String(broadcastId));
      const newCount = matched ? Number(matched.ack_count || 1) : 1;
      targetBtn.textContent = `✓ Acknowledged (${newCount})`;
      targetBtn.style.background = 'rgba(16, 185, 129, 0.25)';
      targetBtn.style.borderColor = '#10b981';
      targetBtn.style.color = '#fff';
    }
    if (typeof showToast === 'function') {
      showToast(`✓ Acknowledged Commissioner Notice (${player_name})`);
    }
  } catch (e) {
    console.error('Error acknowledging league notice:', e);
  }
}
window.acknowledgeLeagueAnnouncement = acknowledgeLeagueAnnouncement;
window.acknowledgeBroadcastNotice = acknowledgeLeagueAnnouncement;

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
 * Renders Pods, Standings & 5-Column Player Matchup Schedule Subtab
 */
function renderPodsSubtab(league, currentPod) {
  const actSeason = league.active_season || {};
  const pods = actSeason.pods || [];
  const standings = currentPod.standings || [];
  const layouts = (actSeason.season_config && actSeason.season_config.round_layouts) || currentPod.round_layouts || ["Layout A", "Layout B", "Layout C", "Layout A", "Layout B"];
  const nStandings = standings.length;
  const totalPodsCount = pods.length || 8;

  const seenPairs = new Set();
  const allPodPairings = [];
  const factionByPlayer = {};
  const identityByPlayer = {};
  const isRealDbPlayerId = (pid) => Boolean(pid && !String(pid).startsWith('bcp_') && !String(pid).startsWith('p_'));
  standings.forEach(st => {
    if (st.name) {
      const k = st.name.trim().toLowerCase();
      const rawPid = st.bcp_player_id || st.player_id || null;
      const validPid = isRealDbPlayerId(rawPid) ? rawPid : null;
      factionByPlayer[k] = st.primary_faction || 'Warhammer 40k';
      identityByPlayer[k] = {
        bcp_player_id: validPid,
        user_id: st.user_id || null,
        is_db_matched: Boolean(st.is_db_matched && validPid)
      };
    }
  });

  standings.forEach(s => {
    const p1Name = (s.name || '').trim();
    const p1Faction = s.primary_faction || 'Warhammer 40k';
    const p1Ident = identityByPlayer[p1Name.toLowerCase()] || {};
    (s.pairings || []).forEach(m => {
      const p2RawName = (m.opponent_name || '').trim();
      const p2Name = (m.opponent_clean_name || p2RawName.replace(/\s*\([^)]*\)\s*$/, '')).trim();
      if (!p1Name || !p2Name || p2Name === 'BYE') return;
      const rNum = parseInt(m.round, 10) || 1;
      const pairNames = [p1Name.toLowerCase(), p2Name.toLowerCase()].sort();
      const key = `R${rNum}_${pairNames[0]}__${pairNames[1]}`;
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      const rawOppPid = m.opponent_bcp_player_id || null;
      const validOppPid = isRealDbPlayerId(rawOppPid) ? rawOppPid : null;
      const p2Ident = identityByPlayer[p2Name.toLowerCase()] || identityByPlayer[p2RawName.toLowerCase()] || {
        bcp_player_id: validOppPid,
        user_id: m.opponent_user_id || null,
        is_db_matched: Boolean(m.opponent_is_db_matched && validOppPid)
      };
      let p2Faction = factionByPlayer[p2Name.toLowerCase()] || factionByPlayer[p2RawName.toLowerCase()] || m.opponent_faction || '';
      if (!p2Faction && p2RawName.includes('(') && p2RawName.endsWith(')')) {
        const matchF = p2RawName.match(/\(([^)]+)\)\s*$/);
        if (matchF) p2Faction = matchF[1].trim();
      }
      const rawP1Score = (m.score !== undefined && m.score !== null && m.score !== '') ? Number(m.score) : null;
      const rawP2Score = (m.opponent_score !== undefined && m.opponent_score !== null && m.opponent_score !== '') ? Number(m.opponent_score) : null;
      const rawRes = String(m.result || '').trim().toUpperCase();
      const rawBp = (m.battle_points !== undefined && m.battle_points !== null) ? Number(m.battle_points) : null;
      allPodPairings.push({
        round: rNum,
        layout: m.layout || layouts[(rNum - 1) % layouts.length] || 'Layout A',
        p1_name: p1Name,
        p1_faction: p1Faction,
        p1_bcp_player_id: p1Ident.bcp_player_id,
        p1_is_db_matched: Boolean(p1Ident.is_db_matched && p1Ident.bcp_player_id),
        p2_name: p2Name,
        p2_faction: p2Faction || 'Warhammer 40k',
        p2_bcp_player_id: p2Ident.bcp_player_id,
        p2_is_db_matched: Boolean(p2Ident.is_db_matched && p2Ident.bcp_player_id),
        p1_score: !isNaN(rawP1Score) ? rawP1Score : null,
        p2_score: !isNaN(rawP2Score) ? rawP2Score : null,
        p1_result: rawRes,
        p1_bp: !isNaN(rawBp) ? rawBp : null,
        score: (m.score !== undefined && m.score !== null) ? m.score : null,
        is_completed: !!m.is_completed
      });
    });
  });

  allPodPairings.sort((a, b) => a.round - b.round);

  return `
    <!-- Pod Switcher Pills -->
    <div style="display: flex; gap: 0.45rem; overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 0.5rem; margin-bottom: 1.15rem;">
      ${pods.map(p => {
        const isAct = p.pod_number === leagueState.activePodNumber;
        return `
          <button onclick="switchPod(${p.pod_number})" style="
            padding: 0.5rem 0.9rem;
            border-radius: 8px;
            font-size: 0.82rem;
            font-weight: 700;
            white-space: nowrap;
            cursor: pointer;
            transition: all 0.15s ease;
            background: ${isAct ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : 'var(--bg-card)'};
            color: ${isAct ? '#fff' : 'var(--text-secondary)'};
            border: 1px solid ${isAct ? '#3b82f6' : 'var(--border)'};
            box-shadow: ${isAct ? '0 4px 12px rgba(37, 99, 235, 0.3)' : 'none'};
          ">
            <span>Pod #${p.pod_number}</span>
            <span style="opacity: 0.8; font-size: 0.72rem; margin-left: 3px;">(${escapeHtml(String(p.name || p.pod_name || '').replace(/^POD #\d+\s*[-—]\s*/i, ''))})</span>
          </button>
        `;
      }).join('')}
    </div>

    <!-- Standings Table -->
    <div class="card" style="margin-bottom: 1.35rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; overflow: hidden;">
      <div style="padding: 0.85rem 1.15rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.65rem;">
        <div style="font-weight: 700; font-size: 0.98rem; color: #fff;">🏆 Pod #${currentPod.pod_number} Standings</div>
        <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
          <button onclick="openLeaguePlayerClaimModal('${escapeHtml(league.league_id || '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90')}')" class="btn btn-outline" style="font-size: 0.74rem; padding: 0.3rem 0.7rem; border-color: rgba(59, 130, 246, 0.45); color: #60a5fa; font-weight: 700;">
            🙋‍♂️ I'm in this League
          </button>
        </div>
      </div>

      <div style="overflow-x: auto;">
        <table class="league-standings-table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
          <thead>
            <tr style="background: rgba(0, 0, 0, 0.3); border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 0.73rem; text-transform: uppercase;">
              <th style="padding: 0.7rem 0.85rem; width: 42px;">#</th>
              <th style="padding: 0.7rem 0.85rem;">Player</th>
              <th class="hide-mob" style="padding: 0.7rem 0.85rem;">Faction</th>
              <th style="padding: 0.7rem 0.65rem; text-align: center;">Record</th>
              <th style="padding: 0.7rem 0.65rem; text-align: center;">Points</th>
              <th class="hide-mob" style="padding: 0.7rem 0.85rem; text-align: center;">Trajectory</th>
              <th class="hide-mob" style="padding: 0.7rem 0.85rem; text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${standings.map((s, idx) => {
              const rankNum = s.rank || (idx + 1);
              let relBadge = '<span style="background: rgba(148, 163, 184, 0.12); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.25); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.7rem;">● Stay (Pod ' + currentPod.pod_number + ')</span>';
              if (currentPod.pod_number === 1 && rankNum <= 2) {
                relBadge = '<span style="background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.4); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.7rem;">★ Finals Seed</span>';
              } else if (rankNum <= 2 && currentPod.pod_number > 1) {
                relBadge = `<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.7rem;">▲ Pod #${currentPod.pod_number - 1}</span>`;
              } else if (rankNum > Math.max(2, nStandings - 2) && currentPod.pod_number < totalPodsCount) {
                relBadge = `<span style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.7rem;">▼ Pod #${currentPod.pod_number + 1}</span>`;
              }

              const isFirst = rankNum === 1;
              const rowBg = isFirst ? 'rgba(59, 130, 246, 0.05)' : (idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.01)');
              const safePlayerName = escapeHtml(s.name || '').replace(/'/g, "\\'");
              const rawBcpPlayerId = s.bcp_player_id || s.player_id || '';
              const bcpPlayerId = (rawBcpPlayerId && !String(rawBcpPlayerId).startsWith('bcp_') && !String(rawBcpPlayerId).startsWith('p_')) ? rawBcpPlayerId : '';
              const safeBcpId = escapeHtml(bcpPlayerId || s.name || '').replace(/'/g, "\\'");
              const isDbMatched = Boolean(s.is_db_matched && bcpPlayerId);
              const discCard = String(s.disciplinary_card || 'none').toLowerCase();
              const cardBadge = discCard === 'yellow'
                ? `<span title="Yellow Card (<3 GP Warning)" style="background:rgba(245,158,11,0.2);color:#fbbf24;border:1px solid rgba(245,158,11,0.45);padding:1px 6px;border-radius:4px;font-size:0.65rem;font-weight:800;">🟨 Yellow Card</span>`
                : discCard === 'red'
                ? `<span title="Red Card (1-Season Suspension)" style="background:rgba(239,68,68,0.2);color:#f87171;border:1px solid rgba(239,68,68,0.45);padding:1px 6px;border-radius:4px;font-size:0.65rem;font-weight:800;">🟥 Red Card</span>`
                : discCard === 'black'
                ? `<span title="Black Card (Expulsion)" style="background:rgba(15,23,42,0.9);color:#e2e8f0;border:1px solid rgba(255,255,255,0.4);padding:1px 6px;border-radius:4px;font-size:0.65rem;font-weight:800;">⬛ Black Card</span>`
                : '';
              const dropBadge = s.dropped
                ? `<span style="background:rgba(239,68,68,0.18);color:#f87171;border:1px solid rgba(239,68,68,0.4);padding:1px 6px;border-radius:4px;font-size:0.65rem;font-weight:800;">Dropped</span>`
                : '';

              return `
                <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.04); background: ${rowBg};">
                  <td style="padding: 0.7rem 0.85rem; font-weight: 700; color: ${isFirst ? '#60a5fa' : '#94a3b8'};">
                    #${rankNum}
                  </td>
                  <td style="padding: 0.7rem 0.85rem; font-weight: 600; color: #fff;">
                    <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                      ${isDbMatched ? `
                        <button type="button" onclick="openPlayerModal('${safeBcpId}', '${safePlayerName}')" style="background: none; border: none; padding: 0; color: #38bdf8; font-weight: 700; font-size: 0.88rem; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-align: left;">
                          ${escapeHtml(s.name)}
                        </button>
                      ` : `
                        <span style="color: #f8fafc; font-weight: 600; font-size: 0.88rem;">
                          ${escapeHtml(s.name)}
                        </span>
                      `}
                      ${s.career?.championships ? `<span title="${s.career.championships} All-time Championships" style="cursor: help;">🏆</span>` : ''}
                      ${cardBadge}
                      ${dropBadge}
                    </div>
                    <div class="league-mob-subinfo" style="display: none; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-top: 3px; font-size: 0.7rem; color: #94a3b8;">
                      <span>${escapeHtml(s.primary_faction || 'Unassigned')}</span>
                      ${!isDbMatched ? `
                        <button type="button" onclick="openLeaguePlayerClaimModal('${escapeHtml(league.league_id || '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90')}', '${safePlayerName}', ${currentPod.pod_number})" style="background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.38); color: #38bdf8; border-radius: 4px; padding: 1px 6px; font-size: 0.66rem; font-weight: 700; cursor: pointer;">
                          🔗 Claim
                        </button>
                      ` : ''}
                    </div>
                  </td>
                  <td class="hide-mob" style="padding: 0.7rem 0.85rem; color: #cbd5e1;">
                    <span style="background: rgba(255, 255, 255, 0.06); padding: 2px 7px; border-radius: 4px; font-size: 0.76rem;">
                      ${escapeHtml(s.primary_faction || 'Unassigned')}
                    </span>
                  </td>
                  <td style="padding: 0.7rem 0.65rem; text-align: center; font-weight: 600; white-space: nowrap;">
                    <span style="color: #34d399;">${s.wins}W</span>-<span style="color: #f87171;">${s.losses}L</span>${s.draws ? `-${s.draws}D` : ''}
                  </td>
                  <td style="padding: 0.7rem 0.65rem; text-align: center; font-weight: 800; color: #60a5fa; font-size: 0.9rem; white-space: nowrap;">
                    ${s.battle_points} BP
                  </td>
                  <td class="hide-mob" style="padding: 0.7rem 0.85rem; text-align: center; white-space: nowrap;">
                    ${relBadge}
                  </td>
                  <td class="hide-mob" style="padding: 0.7rem 0.85rem; text-align: right; white-space: nowrap;">
                    ${!isDbMatched ? `
                      <button onclick="openLeaguePlayerClaimModal('${escapeHtml(league.league_id || '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90')}', '${safePlayerName}', ${currentPod.pod_number})" class="btn btn-outline" style="padding: 0.22rem 0.5rem; font-size: 0.7rem; margin-right: 3px; border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;">
                        🔗 Claim
                      </button>
                    ` : ''}
                    <button onclick="openPlayerLeagueModal('${safePlayerName}')" class="btn btn-outline" style="padding: 0.22rem 0.5rem; font-size: 0.7rem; border-color: rgba(245, 158, 11, 0.4); color: #fbbf24;">
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

    <!-- 5-Column Player Opponent Schedule (Player on Left + 5 Assigned Opponents) -->
    <div id="league-pairings-list" class="card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 1.15rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.95rem; flex-wrap: wrap; gap: 0.65rem;">
        <div>
          <h3 style="margin: 0; font-size: 1.02rem; font-weight: 700; color: #fff;">⚔️ Pod #${currentPod.pod_number} Player Matchups &amp; Scores (5 Games)</h3>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">Each row shows a player and their 5 assigned opponents. Tap any matchup cell to launch Tracker or submit scores.</div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.73rem; font-weight: 700;">
          <span style="display: inline-flex; align-items: center; gap: 4px; background: rgba(16, 185, 129, 0.22); border: 1px solid rgba(16, 185, 129, 0.6); color: #34d399; padding: 3px 8px; border-radius: 6px;">
            🟢 Win (Score)
          </span>
          <span style="display: inline-flex; align-items: center; gap: 4px; background: rgba(239, 68, 68, 0.22); border: 1px solid rgba(239, 68, 68, 0.6); color: #fca5a5; padding: 3px 8px; border-radius: 6px;">
            🔴 Loss (Score)
          </span>
          <span style="display: inline-flex; align-items: center; gap: 4px; background: rgba(56, 189, 248, 0.14); border: 1px solid rgba(56, 189, 248, 0.45); color: #38bdf8; padding: 3px 8px; border-radius: 6px;">
            🔵 Yet to Play
          </span>
        </div>
      </div>

      ${(() => {
        // Build lookup map of matchups between any two players in this Pod
        const pairMap = {};
        allPodPairings.forEach(m => {
          const k1 = (m.p1_name || '').trim().toLowerCase();
          const k2 = (m.p2_name || '').trim().toLowerCase();
          if (!k1 || !k2) return;
          let s1 = (m.p1_score !== undefined && m.p1_score !== null) ? m.p1_score : null;
          let s2 = (m.p2_score !== undefined && m.p2_score !== null) ? m.p2_score : null;
          if ((s1 === null || s2 === null) && m.score && String(m.score).includes('-')) {
            const pts = String(m.score).split('-').map(x => parseInt(x.trim(), 10));
            if (!isNaN(pts[0]) && !isNaN(pts[1])) { s1 = pts[0]; s2 = pts[1]; }
          }
          const done = Boolean(m.is_completed || (s1 !== null && s2 !== null && (s1 > 0 || s2 > 0)));
          const r1 = m.p1_result || (s1 !== null && s2 !== null ? (s1 > s2 ? 'W' : (s1 < s2 ? 'L' : 'D')) : '');
          const r2 = r1 === 'W' ? 'L' : (r1 === 'L' ? 'W' : (r1 === 'D' ? 'D' : ''));
          const p1Label = (s1 !== null && s2 !== null && done)
            ? ((s1 === 0 && m.p1_bp && m.p1_bp >= 1000 && r1 === 'W') ? `${m.p1_bp} - ${s2} BP` : `${s1} - ${s2}`)
            : (m.score !== null && m.score !== undefined ? String(m.score) : '');
          const p2Label = (s1 !== null && s2 !== null && done)
            ? ((s1 === 0 && m.p1_bp && m.p1_bp >= 1000 && r1 === 'W') ? `${s2} - ${m.p1_bp} BP` : `${s2} - ${s1}`)
            : (m.score !== null && m.score !== undefined ? String(m.score) : '');

          pairMap[`${k1}__${k2}`] = {
            round: m.round || 1,
            layout: m.layout || 'Layout A',
            opp_name: m.p2_name,
            opp_faction: m.p2_faction || factionByPlayer[k2] || 'Warhammer 40k',
            opp_bcp_player_id: m.p2_bcp_player_id || identityByPlayer[k2]?.bcp_player_id || '',
            opp_is_db_matched: Boolean(m.p2_is_db_matched || (identityByPlayer[k2]?.is_db_matched && identityByPlayer[k2]?.bcp_player_id)),
            is_completed: done,
            row_score: s1,
            col_score: s2,
            result: r1,
            score_label: p1Label
          };
          pairMap[`${k2}__${k1}`] = {
            round: m.round || 1,
            layout: m.layout || 'Layout A',
            opp_name: m.p1_name,
            opp_faction: m.p1_faction || factionByPlayer[k1] || 'Warhammer 40k',
            opp_bcp_player_id: m.p1_bcp_player_id || identityByPlayer[k1]?.bcp_player_id || '',
            opp_is_db_matched: Boolean(m.p1_is_db_matched || (identityByPlayer[k1]?.is_db_matched && identityByPlayer[k1]?.bcp_player_id)),
            is_completed: done,
            row_score: s2,
            col_score: s1,
            result: r2,
            score_label: p2Label
          };
        });

        return `
          <div style="overflow-x: auto;">
            <table class="league-5col-schedule-table" style="width: 100%; border-collapse: separate; border-spacing: 5px; font-size: 0.82rem;">
              <thead>
                <tr>
                  <th style="text-align: left; padding: 0.6rem 0.85rem; background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #cbd5e1; font-weight: 800; width: 190px;">
                    Player
                  </th>
                  ${[1, 2, 3, 4, 5].map(gNum => `
                    <th style="text-align: left; padding: 0.55rem 0.75rem; background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #94a3b8; font-weight: 800; font-size: 0.73rem; text-transform: uppercase;">
                      Opponent ${gNum}
                    </th>
                  `).join('')}
                </tr>
              </thead>
              <tbody>
                ${standings.map(rowP => {
                  const rowName = (rowP.name || '').trim();
                  const rowKey = rowName.toLowerCase();
                  const rowFaction = rowP.primary_faction || 'Unassigned';
                  const rawRowPid = rowP.bcp_player_id || rowP.player_id || '';
                  const rowPid = (rawRowPid && !String(rawRowPid).startsWith('bcp_') && !String(rawRowPid).startsWith('p_')) ? rawRowPid : '';
                  const rowMatched = Boolean(rowP.is_db_matched && rowPid);
                  const safeRowName = escapeHtml(rowName).replace(/'/g, "\\'");
                  const safeRowPid = escapeHtml(rowPid).replace(/'/g, "\\'");
                  const safeRowFaction = escapeHtml(rowFaction).replace(/'/g, "\\'");

                  // Gather the 5 assigned opponents for this player (from rowP.pairings + pairMap)
                  const oppList = [];
                  const seenOpp = new Set();
                  (rowP.pairings || []).forEach((pItem, idx) => {
                    const rawOpp = (pItem.opponent_clean_name || (pItem.opponent_name || '').replace(/\s*\([^)]*\)\s*$/, '')).trim();
                    if (!rawOpp || rawOpp === 'BYE') return;
                    const oKey = rawOpp.toLowerCase();
                    if (seenOpp.has(oKey)) return;
                    seenOpp.add(oKey);
                    const mapped = pairMap[`${rowKey}__${oKey}`];
                    const oppIdent = identityByPlayer[oKey] || {};
                    const rawItemPid = pItem.opponent_bcp_player_id || oppIdent.bcp_player_id || mapped?.opp_bcp_player_id || '';
                    const validItemPid = (rawItemPid && !String(rawItemPid).startsWith('bcp_') && !String(rawItemPid).startsWith('p_')) ? rawItemPid : '';
                    const itemMatched = Boolean((pItem.opponent_is_db_matched || oppIdent.is_db_matched || mapped?.opp_is_db_matched) && validItemPid);
                    const pScore = (pItem.score !== undefined && pItem.score !== null && pItem.score !== '') ? Number(pItem.score) : (mapped ? mapped.row_score : null);
                    const oScore = (pItem.opponent_score !== undefined && pItem.opponent_score !== null && pItem.opponent_score !== '') ? Number(pItem.opponent_score) : (mapped ? mapped.col_score : null);
                    const itemRes = String(pItem.result || mapped?.result || '').trim().toUpperCase();
                    const itemBp = (pItem.battle_points !== undefined && pItem.battle_points !== null) ? Number(pItem.battle_points) : null;
                    let computedLabel = '';
                    if (pScore !== null && !isNaN(pScore) && oScore !== null && !isNaN(oScore)) {
                      if (pScore === 0 && itemBp && itemBp >= 1000 && itemRes === 'W') {
                        computedLabel = `${itemBp} - ${oScore} BP`;
                      } else {
                        computedLabel = `${pScore} - ${oScore}`;
                      }
                    } else if (mapped && mapped.score_label) {
                      computedLabel = mapped.score_label;
                    } else if (pItem.score !== undefined && pItem.score !== null) {
                      computedLabel = String(pItem.score);
                    }
                    oppList.push({
                      round: pItem.round || mapped?.round || (idx + 1),
                      layout: pItem.layout || mapped?.layout || 'Layout A',
                      opp_name: rawOpp,
                      opp_faction: factionByPlayer[oKey] || pItem.opponent_faction || mapped?.opp_faction || 'Warhammer 40k',
                      opp_bcp_player_id: validItemPid,
                      opp_is_db_matched: itemMatched,
                      is_completed: Boolean(pItem.is_completed || mapped?.is_completed),
                      row_score: !isNaN(pScore) ? pScore : null,
                      col_score: !isNaN(oScore) ? oScore : null,
                      result: itemRes,
                      score_label: computedLabel
                    });
                  });
                  // Fill any remaining matchups from pairMap if < 5
                  Object.keys(pairMap).forEach(pk => {
                    if (oppList.length >= 5) return;
                    if (pk.startsWith(`${rowKey}__`)) {
                      const oKey = pk.split('__')[1];
                      if (!seenOpp.has(oKey)) {
                        seenOpp.add(oKey);
                        oppList.push(pairMap[pk]);
                      }
                    }
                  });
                  oppList.sort((a, b) => (a.round || 1) - (b.round || 1));

                  return `
                    <tr class="league-schedule-row">
                      <td class="league-schedule-player-cell" style="padding: 0.6rem 0.85rem; background: rgba(15, 23, 42, 0.82); border: 1px solid rgba(255,255,255,0.08); border-radius: 7px; white-space: nowrap;">
                        <div>
                          ${rowMatched ? `
                            <button type="button" onclick="openPlayerModal('${safeRowPid}', '${safeRowName}')" style="background: none; border: none; padding: 0; color: #38bdf8; font-weight: 800; font-size: 0.88rem; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; text-align: left;">
                              ${escapeHtml(rowName)}
                            </button>
                          ` : `
                            <span style="color: #f8fafc; font-weight: 700; font-size: 0.88rem;">
                              ${escapeHtml(rowName)}
                            </span>
                          `}
                        </div>
                        <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">
                          ${escapeHtml(rowFaction)}
                        </div>
                      </td>
                      ${[0, 1, 2, 3, 4].map(slotIdx => {
                        const matchInfo = oppList[slotIdx];
                        if (!matchInfo) {
                          return `
                            <td class="league-schedule-opp-cell" style="padding: 0.55rem 0.7rem; background: rgba(15, 23, 42, 0.25); border: 1px solid rgba(255,255,255,0.04); border-radius: 7px; color: #475569;">
                              —
                            </td>
                          `;
                        }
                        const colName = matchInfo.opp_name;
                        const colFaction = matchInfo.opp_faction || 'Unassigned';
                        const colPid = matchInfo.opp_bcp_player_id || '';
                        const colMatched = Boolean(matchInfo.opp_is_db_matched && colPid);
                        const safeColName = escapeHtml(colName).replace(/'/g, "\\'");
                        const safeColPid = escapeHtml(colPid).replace(/'/g, "\\'");
                        const safeColFaction = escapeHtml(colFaction).replace(/'/g, "\\'");
                        const safeLayout = escapeHtml(matchInfo.layout || 'Layout A').replace(/'/g, "\\'");
                        const safeScore = escapeHtml(matchInfo.score_label || '').replace(/'/g, "\\'");
                        const safeLeagueId = escapeHtml(league.league_id || '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90').replace(/'/g, "\\'");

                        const oppNameLabelHtml = colMatched ? `
                          <button type="button" onclick="event.stopPropagation(); if (typeof openPlayerModal === 'function') openPlayerModal('${safeColPid}', '${safeColName}');" title="View ${escapeHtml(colName)}'s quick profile" style="background: none; border: none; padding: 0; color: #38bdf8; font-weight: 800; font-size: 0.83rem; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; text-align: left; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block;">
                            ${escapeHtml(colName)}
                          </button>
                        ` : `
                          <div style="font-weight: 800; font-size: 0.83rem; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${escapeHtml(colName)}
                          </div>
                        `;

                        if (matchInfo.is_completed) {
                          const resCode = String(matchInfo.result || '').toUpperCase();
                          let won = true;
                          let draw = false;
                          if (resCode === 'W') {
                            won = true;
                            draw = false;
                          } else if (resCode === 'L') {
                            won = false;
                            draw = false;
                          } else if (resCode === 'D' || resCode === 'T') {
                            won = false;
                            draw = true;
                          } else if (matchInfo.row_score !== null && matchInfo.col_score !== null) {
                            won = matchInfo.row_score > matchInfo.col_score;
                            draw = matchInfo.row_score === matchInfo.col_score;
                          }
                          const bgCol = draw ? 'rgba(245, 158, 11, 0.22)' : (won ? 'rgba(16, 185, 129, 0.24)' : 'rgba(239, 68, 68, 0.24)');
                          const borderCol = draw ? 'rgba(245, 158, 11, 0.55)' : (won ? 'rgba(16, 185, 129, 0.65)' : 'rgba(239, 68, 68, 0.65)');
                          const scoreCol = draw ? '#fbbf24' : (won ? '#34d399' : '#fca5a5');
                          const outcomePrefix = draw ? '🟡 DRAW' : (won ? '🟢 WIN' : '🔴 LOSS');
                          const displayScoreText = matchInfo.score_label ? `${outcomePrefix} • ${escapeHtml(matchInfo.score_label)}` : outcomePrefix;
                          return `
                            <td class="league-schedule-opp-cell ${won ? 'matrix-cell-win' : (draw ? 'matrix-cell-draw' : 'matrix-cell-loss')}" onclick="openMatrixMatchupModal('${safeRowName}', '${safeColName}', '${safeRowFaction}', '${safeColFaction}', ${matchInfo.round || (slotIdx + 1)}, '${safeLayout}', '${safeScore}', true, ${currentPod.pod_number}, '${safeLeagueId}', '${safeRowPid}', '${safeColPid}')" style="padding: 0.55rem 0.7rem; background: ${bgCol}; border: 1px solid ${borderCol}; border-radius: 7px; cursor: pointer; transition: transform 0.12s;">
                              <div>${oppNameLabelHtml}</div>
                              <div style="font-size: 0.69rem; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">
                                ${escapeHtml(colFaction)}
                              </div>
                              <div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; font-weight: 800; font-size: 0.74rem; color: ${scoreCol};">
                                <span>${displayScoreText}</span>
                              </div>
                            </td>
                          `;
                        }

                        return `
                          <td class="league-schedule-opp-cell matrix-cell-unplayed" onclick="openMatrixMatchupModal('${safeRowName}', '${safeColName}', '${safeRowFaction}', '${safeColFaction}', ${matchInfo.round || (slotIdx + 1)}, '${safeLayout}', '', false, ${currentPod.pod_number}, '${safeLeagueId}', '${safeRowPid}', '${safeColPid}')" style="padding: 0.55rem 0.7rem; background: rgba(56, 189, 248, 0.11); border: 1px solid rgba(56, 189, 248, 0.36); border-radius: 7px; cursor: pointer; transition: transform 0.12s;">
                            <div>${oppNameLabelHtml}</div>
                            <div style="font-size: 0.69rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">
                              ${escapeHtml(colFaction)}
                            </div>
                            <div style="margin-top: 4px; font-weight: 800; font-size: 0.71rem; color: #38bdf8;">
                              🔵 Yet to Play
                            </div>
                          </td>
                        `;
                      }).join('')}
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
      })()}
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
  const seasonsCount = (league.available_seasons || []).length || 1;

  const categories = [
    { id: 'finals_champions', label: `👑 Past Champions (${finalsChamps.length})`, count: finalsChamps.length },
    { id: 'historical_seasons', label: `📜 ${seasonsCount}-Season Roll of Honor (${seasonsCount})`, count: seasonsCount },
    { id: 'titles_and_champs', label: `🏆 Titles & Championships (${leaderboards.titles_and_champs?.records?.length || 0})`, count: leaderboards.titles_and_champs?.records?.length || 0 },
    { id: 'most_games', label: `⚔️ Most Games Played (${leaderboards.most_games?.records?.length || 0})`, count: leaderboards.most_games?.records?.length || 0 },
    { id: 'most_wins', label: `🔥 Most League Wins (${leaderboards.most_wins?.records?.length || 0})`, count: leaderboards.most_wins?.records?.length || 0 },
    { id: 'finals_wins', label: `🎖️ Wins in the Finals (${leaderboards.finals_wins?.records?.length || 0})`, count: leaderboards.finals_wins?.records?.length || 0 },
    { id: 'faction_titles', label: `🛡️ Faction Win Rates (${leaderboards.faction_titles?.records?.length || 0})`, count: leaderboards.faction_titles?.records?.length || 0 }
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
    ${activeCat === 'finals_champions'
      ? renderFinalsChampionsList(finalsChamps, league)
      : (activeCat === 'historical_seasons'
          ? renderHistoricalSeasonsList(league.available_seasons || [], league)
          : renderLeaderboardTable(leaderboards[activeCat], league))}
  `;
}

/**
 * Renders Complete Season Roll of Honor
 */
function renderHistoricalSeasonsList(seasons, league = {}) {
  if (!seasons || !seasons.length) {
    return `
      <div class="empty-state" style="padding: 3rem 1rem; text-align: center;">
        <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">📜</div>
        <div style="color: var(--text-muted);">No historical seasons archive loaded.</div>
      </div>
    `;
  }
  const seasonsCount = seasons.length;
  const leagueName = league.name || 'League';
  return `
    <div class="card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; overflow: hidden;">
      <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #fff;">📜 Complete ${seasonsCount}-Season Roll of Honor</h3>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(leagueName)} archival records across ${seasonsCount} season${seasonsCount === 1 ? '' : 's'}</div>
        </div>
        <span style="font-size: 0.75rem; color: #fbbf24; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); padding: 3px 8px; border-radius: 4px; font-weight: 700;">
          ${seasonsCount} Seasons Documented
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
function renderFinalsChampionsList(champions, league = {}) {
  const seasonsCount = (league.available_seasons || []).length || 1;
  return `
    <div class="card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem;">
      <div style="margin-bottom: 1.25rem;">
        <h3 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #fff;">👑 All-Time League Champions</h3>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.25rem;">
          Official seasonal &amp; finals championship honors across ${seasonsCount} documented season${seasonsCount === 1 ? '' : 's'}. Click any linked player name for their quick profile or Career Dossier.
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 1rem;">
        ${champions.map((c) => {
          const safeChamp = escapeHtml(c.champion || '').replace(/'/g, "\\'");
          const safeFaction = escapeHtml(c.champion_faction || '').replace(/'/g, "\\'");
          const safeChampPid = escapeHtml(c.champion_bcp_id || '').replace(/'/g, "\\'");
          const isChampLinked = Boolean(c.champion_is_db_matched && c.champion_bcp_id && !String(c.champion_bcp_id).startsWith('bcp_'));

          const safeRunner = escapeHtml(c.runner_up || '').replace(/'/g, "\\'");
          const safeRunnerPid = escapeHtml(c.runner_up_bcp_id || '').replace(/'/g, "\\'");
          const isRunnerLinked = Boolean(c.runner_up_is_db_matched && c.runner_up_bcp_id && !String(c.runner_up_bcp_id).startsWith('bcp_'));

          return `
            <div style="background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 10px; padding: 1rem; position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="position: absolute; right: -10px; top: -10px; width: 60px; height: 60px; background: rgba(245, 158, 11, 0.08); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; pointer-events: none;">
                  🏆
                </div>
                <div style="font-size: 0.75rem; font-weight: 700; color: #fbbf24; text-transform: uppercase; margin-bottom: 0.25rem;">
                  ${escapeHtml(c.season_label || String(c.year))}
                </div>
                <div style="font-size: 1.22rem; font-weight: 800; color: #fff; margin-bottom: 0.25rem; display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                  ${isChampLinked
                    ? `<button type="button" onclick="if (typeof openPlayerModal === 'function') openPlayerModal('${safeChampPid}', '${safeChamp}');" title="View ${escapeHtml(c.champion)}'s quick profile" style="background: none; border: none; padding: 0; font-size: 1.22rem; font-weight: 800; color: #38bdf8; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-align: left;">${escapeHtml(c.champion)}</button>`
                    : `<span>${escapeHtml(c.champion)}</span>`
                  }
                  <button type="button" onclick="openPlayerLeagueModal('${safeChamp}', 1, '${safeFaction}')" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); color: #cbd5e1; border-radius: 6px; padding: 2px 7px; font-size: 0.68rem; font-weight: 700; cursor: pointer;">
                    📜 Dossier
                  </button>
                </div>
                <div style="font-size: 0.82rem; color: #60a5fa; font-weight: 600; margin-bottom: 0.6rem;">
                  🛡️ ${escapeHtml(c.champion_faction || 'Warhammer 40k')}
                </div>
                ${c.runner_up ? `
                  <div style="font-size: 0.78rem; color: var(--text-muted);">
                    Runner-Up:
                    ${isRunnerLinked
                      ? `<button type="button" onclick="if (typeof openPlayerModal === 'function') openPlayerModal('${safeRunnerPid}', '${safeRunner}');" style="background: none; border: none; padding: 0; font-size: 0.78rem; font-weight: 700; color: #60a5fa; cursor: pointer; text-decoration: underline;">${escapeHtml(c.runner_up)}</button>`
                      : `<span style="color: #cbd5e1;">${escapeHtml(c.runner_up)}</span>`
                    }
                    ${c.runner_up_faction ? `<span style="color: #94a3b8;"> (${escapeHtml(c.runner_up_faction)})</span>` : ''}
                  </div>
                ` : ''}
                ${c.notes ? `<div style="font-size: 0.75rem; color: #94a3b8; margin-top: 0.4rem; font-style: italic;">"${escapeHtml(c.notes)}"</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

/**
 * Renders an All-Time Leaderboard table
 */
function renderLeaderboardTable(data, league = {}) {
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
  const seasonsCount = (league.available_seasons || []).length || 1;

  return `
    <div class="card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; overflow: hidden;">
      <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #fff;">${escapeHtml(data.title)}</h3>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">Cumulative database records across ${seasonsCount} documented season${seasonsCount === 1 ? '' : 's'}</div>
        </div>
        <span style="font-size: 0.74rem; color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.3); padding: 3px 8px; border-radius: 4px; font-weight: 700;">
          ${records.length} Ranked Entries
        </span>
      </div>

      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
          <thead>
            <tr style="background: rgba(0, 0, 0, 0.3); border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase;">
              <th style="padding: 0.75rem 1rem; width: 55px;">Rank</th>
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
              const isLinked = !isFaction && Boolean(r.is_db_matched && r.bcp_player_id && !String(r.bcp_player_id).startsWith('bcp_'));
              const safeName = escapeHtml(r.player_name || '').replace(/'/g, "\\'");
              const safePid = escapeHtml(r.bcp_player_id || '').replace(/'/g, "\\'");

              let metricDisplay = '—';
              if (!isFaction) {
                if (r.pod_titles !== undefined && r.pod_titles !== null) {
                  metricDisplay = `${r.pod_titles} Pod Titles (${r.league_championships || 0} 🏆)`;
                } else if (r.games_played !== undefined && r.games_played !== null) {
                  metricDisplay = `${r.games_played} Games`;
                } else if (r.league_wins !== undefined && r.league_wins !== null) {
                  metricDisplay = `${r.league_wins} Wins`;
                } else if (r.finals_wins !== undefined && r.finals_wins !== null) {
                  metricDisplay = `${r.finals_wins} Finals Wins`;
                }
              }

              return `
                <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.04); background: ${idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.01)'};">
                  <td style="padding: 0.75rem 1rem; font-weight: 700; color: ${isTop3 ? '#fbbf24' : '#94a3b8'};">
                    ${medal}#${rankVal}
                  </td>
                  <td style="padding: 0.75rem 1rem; font-weight: 600; color: #fff;">
                    ${isFaction ? escapeHtml(r.faction) : `
                      <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        ${isLinked
                          ? `<button type="button" onclick="if (typeof openPlayerModal === 'function') openPlayerModal('${safePid}', '${safeName}');" title="View ${escapeHtml(r.player_name)}'s quick profile" style="background: none; border: none; padding: 0; font-size: 0.86rem; font-weight: 700; color: #38bdf8; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-align: left;">${escapeHtml(r.player_name)}</button>`
                          : `<span>${escapeHtml(r.player_name)}</span>`
                        }
                        <button type="button" onclick="openPlayerLeagueModal('${safeName}', 1, '')" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: #94a3b8; border-radius: 5px; padding: 1px 6px; font-size: 0.67rem; font-weight: 700; cursor: pointer;">
                          📜 Dossier
                        </button>
                      </div>
                    `}
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
                      ${escapeHtml(metricDisplay)}
                    </td>
                    <td style="padding: 0.75rem 0.75rem; text-align: center; color: var(--text-muted);">
                      ${r.seasons ? `${r.seasons} Seasons` : (r.appearances ? `${r.appearances} Finals Appearances` : '—')}
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
 * Renders the Methodology & Rules Subtab dynamically from league.methodology
 */
function renderMethodologySubtab(league) {
  const m = league.methodology || {};
  const actSeason = league.active_season || {};
  const pods = actSeason.pods || [];
  const scoring = m.scoring_breakdown || {};
  const cards = m.disciplinary_cards || {};
  const podMin = m.pod_size_min || 6;
  const podMax = m.pod_size_max || 8;
  const roundsCount = m.games_per_season || actSeason.rounds_count || 5;
  const durationWeeks = m.season_duration_weeks || actSeason.duration_weeks || 8;
  const ptsLimit = m.points_limit || 2000;
  const winBp = m.win_bp_bonus ?? m.win_bonus_bp ?? 1000;
  const drawBp = m.draw_bp_bonus ?? m.draw_bonus_bp ?? 500;
  const paintBp = m.paint_bonus_bp ?? (m.paint_score_included ? 10 : 0);
  const inRingerBp = m.in_pod_ringer_bonus_bp ?? m.ringer_win_bp_bonus ?? 750;
  const outRingerAllowed = m.out_of_pod_ringer_allowed !== false;
  const outRingerBp = m.out_of_pod_ringer_bonus_bp ?? 500;
  const promoCnt = m.promotion_count ?? 2;
  const relCnt = m.relegation_count ?? 2;
  const minGames = m.min_games_required ?? cards.min_games_for_good_standing ?? 3;
  const finalsSize = m.finals_bracket_size ?? (m.has_playoff_finals === false ? 0 : 16);
  const canonicalUuid = normalizeLeagueIdToUuid(league.league_id || leagueState.activeLeagueId);
  const podNamesList = (Array.isArray(m.custom_pod_names) && m.custom_pod_names.length)
    ? m.custom_pod_names
    : pods.map(p => p.name || `Pod #${p.pod_number}`);

  const promoSummary = typeof m.promotion_relegation_rules === 'string'
    ? m.promotion_relegation_rules
    : (m.promotion_relegation_summary || `Top ${promoCnt} in each pod promote UP 1 division (+1). Bottom ${relCnt} in each pod relegate DOWN 1 division (-1). Middle finishers hold their division.`);
  const ringerSummary = typeof m.ringer_policy === 'string'
    ? m.ringer_policy
    : (m.ringer_policy_summary || `In-Pod Ringer win awards +${inRingerBp.toLocaleString()} BP bonus${outRingerAllowed ? `; Out-of-Pod Ringer win awards +${outRingerBp.toLocaleString()} BP bonus` : ''}.`);

  return `
    <div style="display: flex; flex-direction: column; gap: 1.25rem;">
      <div class="card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 1.5rem;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.75rem;">
          <div>
            <div style="font-size: 0.72rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.2rem;">
              Official League Format &amp; Rulebook • ${ptsLimit.toLocaleString()} Pts Matched Play
            </div>
            <h2 style="margin: 0 0 0.35rem 0; font-size: 1.35rem; font-weight: 800; color: #fff;">
              ${escapeHtml(m.title || `${league.name} — Pod & Progression Rules`)}
            </h2>
            <p style="color: var(--text-muted); font-size: 0.9rem; line-height: 1.6; margin: 0;">
              ${escapeHtml(m.summary || `Structured ${durationWeeks}-week seasonal pod league featuring ${roundsCount} scheduled matches per season in ${podMin}–${podMax} player divisions, +${winBp.toLocaleString()} BP win bonus, and ${promoCnt}-up / ${relCnt}-down seasonal promotion & relegation.`)}
            </p>
          </div>
          <button type="button" onclick="openConfigureLeagueModal('${escapeHtml(canonicalUuid)}')" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.45rem 0.9rem; border-color: rgba(56, 189, 248, 0.45); color: #38bdf8; font-weight: 700; flex-shrink: 0;">
            ⚙️ Customize League Rules
          </button>
        </div>

        <!-- 6 Core Pillars Grid -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-top: 1rem;">
          <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
            <div style="font-size: 1.05rem; font-weight: 700; color: #60a5fa; margin-bottom: 0.4rem;">1. ${durationWeeks}-Week Cadence / ${roundsCount} Games (${podMin}–${podMax}p Pods)</div>
            <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5;">
              Players compete in skill-matched <strong>${podMin}–${podMax} player divisions</strong> and play <strong>${roundsCount} games</strong> (${ptsLimit} pts) over a <strong>${durationWeeks}-week</strong> window. Matches can be scheduled in any round order.
            </div>
          </div>

          <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
            <div style="font-size: 1.05rem; font-weight: 700; color: #34d399; margin-bottom: 0.4rem;">2. Battle Point (BP) Scoring Formula</div>
            <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5;">
              • <strong>Win:</strong> ${escapeHtml(scoring.win || `Actual VP + ${winBp.toLocaleString()} BP Bonus`)}${paintBp > 0 && !String(scoring.win || '').includes('Paint') ? ` (+${paintBp} VP Paint)` : ''}<br>
              • <strong>Draw:</strong> ${escapeHtml(scoring.draw || `Actual VP + ${drawBp.toLocaleString()} BP Bonus`)}<br>
              • <strong>Loss:</strong> ${escapeHtml(scoring.loss || 'Actual VP + 0 BP Bonus')}<br>
              • <strong>Ringer Win:</strong> ${escapeHtml(scoring.ringer_win || `In-Pod +${inRingerBp} BP${outRingerAllowed ? ` / Out-of-Pod +${outRingerBp} BP` : ''}`)}
            </div>
          </div>

          <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
            <div style="font-size: 1.05rem; font-weight: 700; color: #a78bfa; margin-bottom: 0.4rem;">3. Faction Lock &amp; List Flexibility</div>
            <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5;">
              Players declare their Primary Faction for the ${durationWeeks}-week season, while detachments, enhancements, and unit compositions may be adjusted between rounds.
            </div>
          </div>

          <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
            <div style="font-size: 1.05rem; font-weight: 700; color: #f59e0b; margin-bottom: 0.4rem;">4. Promotion &amp; Relegation (${promoCnt}▲ / ${relCnt}▼)</div>
            <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5;">
              ${escapeHtml(promoSummary)}
            </div>
          </div>

          <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
            <div style="font-size: 1.05rem; font-weight: 700; color: #38bdf8; margin-bottom: 0.4rem;">5. Ringer &amp; Substitute Match Policy</div>
            <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5;">
              ${escapeHtml(ringerSummary)}
            </div>
          </div>

          <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">
            <div style="font-size: 1.05rem; font-weight: 700; color: #ec4899; margin-bottom: 0.4rem;">6. Minimum ${minGames} Games &amp; Conduct Policy</div>
            <div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.5;">
              ${cards.yellow_card
                ? `• <strong>Yellow Card (&lt;${minGames} GP):</strong> ${escapeHtml(cards.yellow_card)}<br>• <strong>Red Card:</strong> ${escapeHtml(cards.red_card || '1 season suspension')}<br>• <strong>Black Card:</strong> ${escapeHtml(cards.black_card || 'League removal')}`
                : `Players must complete at least <strong>${minGames} of ${roundsCount} scheduled games</strong> per season to remain in good standing for promotion and seasonal prizing.`}
            </div>
          </div>
        </div>
      </div>

      <!-- Active League Parameter Summary Table -->
      <div class="card" style="background: var(--bg-card); border: 1px solid rgba(56, 189, 248, 0.28); border-radius: 10px; padding: 1.35rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.85rem;">
          <div>
            <div style="font-size: 0.72rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em;">Active TO Engine Parameters</div>
            <h3 style="margin: 0.15rem 0 0 0; font-size: 1.1rem; font-weight: 800; color: #fff;">Configured Settings for ${escapeHtml(league.name)}</h3>
          </div>
          <button type="button" onclick="openConfigureLeagueModal('${escapeHtml(canonicalUuid)}')" class="btn btn-outline" style="font-size: 0.76rem; padding: 0.4rem 0.85rem; border-color: rgba(56, 189, 248, 0.45); color: #38bdf8; font-weight: 700;">
            ⚙️ Adjust League Parameters
          </button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; font-size: 0.82rem;">
          <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.75rem;">
            <div style="color: #94a3b8; font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">Pod Sizing &amp; Divisions</div>
            <div style="color: #fff; font-weight: 800; margin-top: 0.25rem;">${podMin}–${podMax} Players per Pod (${pods.length} Active Pods)</div>
            <div style="color: #38bdf8; font-size: 0.74rem; margin-top: 0.2rem;">${escapeHtml(podNamesList.slice(0, 4).join(' • '))}${podNamesList.length > 4 ? ` (+${podNamesList.length - 4} more)` : ''}</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.75rem;">
            <div style="color: #94a3b8; font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">Battle Points &amp; Paint Bonus</div>
            <div style="color: #34d399; font-weight: 800; margin-top: 0.25rem;">Win +${winBp.toLocaleString()} BP • Draw +${drawBp.toLocaleString()} BP</div>
            <div style="color: #cbd5e1; font-size: 0.74rem; margin-top: 0.2rem;">${paintBp > 0 ? `+${paintBp} VP Battle Ready Paint Bonus Included` : '1x Actual Game VP (0–100)'}</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.75rem;">
            <div style="color: #94a3b8; font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">Ringer &amp; Substitute Scoring</div>
            <div style="color: #fbbf24; font-weight: 800; margin-top: 0.25rem;">In-Pod Ringer: +${inRingerBp.toLocaleString()} BP Win</div>
            <div style="color: #cbd5e1; font-size: 0.74rem; margin-top: 0.2rem;">${outRingerAllowed ? `Out-of-Pod Ringer Allowed (+${outRingerBp.toLocaleString()} BP Win)` : 'In-Pod Ringers Only'}</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.75rem;">
            <div style="color: #94a3b8; font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">Promotion, Finals &amp; Activity</div>
            <div style="color: #a78bfa; font-weight: 800; margin-top: 0.25rem;">Top ${promoCnt} ▲ Promote • Bottom ${relCnt} ▼ Relegate</div>
            <div style="color: #cbd5e1; font-size: 0.74rem; margin-top: 0.2rem;">Min ${minGames} Games Required • ${finalsSize > 0 ? `${finalsSize}-Player Playoff Finals` : 'Seasonal Division Prizing'}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 1-Tap Launch of Game Tracker with pre-filled league match room
 */
function launchLeagueMatchTracker(p1Name, p2Name, p1Faction, layout, roundNum = 1, leagueId = '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90', podNum = null, p2Faction = '') {
  const activePod = podNum || (typeof leagueState !== 'undefined' ? leagueState.activePodNumber : 1) || 1;
  const roomId = `LG-SD40K-P${activePod}-R${roundNum || 1}-${Date.now().toString(36).toUpperCase()}`;
  const params = new URLSearchParams({
    match_id: roomId,
    room: roomId,
    p1: p1Name,
    p2: p2Name,
    faction1: p1Faction || 'Warhammer 40k',
    faction2: p2Faction || 'Warhammer 40k',
    layout: layout || 'Layout A',
    round: String(roundNum || 1),
    pod_number: String(activePod),
    league_id: leagueId || '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90',
    system: '40k'
  });
  window.location.href = `/11th/tracker/play?${params.toString()}`;
}

function closeMatrixMatchupModal() {
  const existing = document.getElementById('league-matrix-matchup-modal');
  if (existing) existing.remove();
}
window.closeMatrixMatchupModal = closeMatrixMatchupModal;

function resolveLeaguePlayerIdentity(playerName, podNum = null, fallbackPid = '') {
  const cleanName = String(playerName || '').trim();
  const key = cleanName.toLowerCase();
  const isRealPid = (pid) => Boolean(pid && !String(pid).startsWith('bcp_') && !String(pid).startsWith('p_'));
  let foundPid = isRealPid(fallbackPid) ? String(fallbackPid).trim() : '';
  let foundUid = '';
  let matchedFlag = Boolean(foundPid);

  const league = (typeof leagueState !== 'undefined' && (leagueState.currentLeagueData || leagueState.leagueData)) || null;
  const pods = league?.active_season?.pods || [];
  const orderedPods = podNum
    ? [...pods.filter(p => Number(p.pod_number) === Number(podNum)), ...pods.filter(p => Number(p.pod_number) !== Number(podNum))]
    : pods;

  for (const p of orderedPods) {
    for (const st of (p.standings || [])) {
      if (String(st.name || '').trim().toLowerCase() === key) {
        const rawPid = st.bcp_player_id || st.player_id || '';
        if (!foundPid && isRealPid(rawPid)) foundPid = String(rawPid).trim();
        if (!foundUid && st.user_id && !String(st.user_id).startsWith('u_')) foundUid = String(st.user_id).trim();
        if (st.is_db_matched && (foundPid || foundUid)) matchedFlag = true;
        break;
      }
      for (const pair of (st.pairings || [])) {
        const oppClean = String(pair.opponent_clean_name || (pair.opponent_name || '').replace(/\s*\([^)]*\)\s*$/, '')).trim();
        if (oppClean.toLowerCase() === key) {
          const rawOppPid = pair.opponent_bcp_player_id || '';
          if (!foundPid && isRealPid(rawOppPid)) foundPid = String(rawOppPid).trim();
          if (!foundUid && pair.opponent_user_id && !String(pair.opponent_user_id).startsWith('u_')) foundUid = String(pair.opponent_user_id).trim();
          if (pair.opponent_is_db_matched && (foundPid || foundUid)) matchedFlag = true;
        }
      }
    }
    if (matchedFlag && foundPid) break;
  }

  return {
    name: cleanName,
    bcp_player_id: foundPid,
    user_id: foundUid,
    isMatched: Boolean(matchedFlag && foundPid)
  };
}
window.resolveLeaguePlayerIdentity = resolveLeaguePlayerIdentity;

function openMatrixMatchupModal(p1Name, p2Name, p1Faction, p2Faction, roundNum, layout, scoreLabel, isCompleted, podNum, leagueId, p1PidOpt = '', p2PidOpt = '') {
  closeMatrixMatchupModal();
  const safeP1 = escapeHtml(p1Name || '').replace(/'/g, "\\'");
  const safeP2 = escapeHtml(p2Name || '').replace(/'/g, "\\'");
  const safeF1 = escapeHtml(p1Faction || 'Warhammer 40k').replace(/'/g, "\\'");
  const safeF2 = escapeHtml(p2Faction || 'Warhammer 40k').replace(/'/g, "\\'");
  const safeLayout = escapeHtml(layout || 'Layout A').replace(/'/g, "\\'");
  const safeLeagueId = escapeHtml(leagueId || '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90').replace(/'/g, "\\'");
  const pNum = parseInt(podNum, 10) || (typeof leagueState !== 'undefined' ? leagueState.activePodNumber : 1) || 1;
  const rNum = parseInt(roundNum, 10) || 1;

  const p1Info = resolveLeaguePlayerIdentity(p1Name, pNum, p1PidOpt);
  const p2Info = resolveLeaguePlayerIdentity(p2Name, pNum, p2PidOpt);
  const safeP1Pid = escapeHtml(p1Info.bcp_player_id || '').replace(/'/g, "\\'");
  const safeP2Pid = escapeHtml(p2Info.bcp_player_id || '').replace(/'/g, "\\'");

  const curUser = (typeof window !== 'undefined' && (window.currentUser || window.state?.user)) || null;
  const curNameLower = String(curUser?.display_name || curUser?.name || '').trim().toLowerCase();
  const curPid = String(curUser?.player_id || curUser?.bcp_user_id || '').trim();
  const isP2Self = Boolean(
    (curNameLower && curNameLower === String(p2Name || '').trim().toLowerCase()) ||
    (curPid && p2Info.bcp_player_id && curPid === String(p2Info.bcp_player_id))
  );
  const chatTargetName = isP2Self ? p1Name : p2Name;
  const chatSenderName = isP2Self ? p2Name : p1Name;
  const chatTargetInfo = isP2Self ? p1Info : p2Info;
  const safeChatTarget = escapeHtml(chatTargetName || '').replace(/'/g, "\\'");
  const safeChatSender = escapeHtml(chatSenderName || '').replace(/'/g, "\\'");
  const safeChatTargetPid = escapeHtml(chatTargetInfo.bcp_player_id || '').replace(/'/g, "\\'");
  const safeChatTargetUid = escapeHtml(chatTargetInfo.user_id || '').replace(/'/g, "\\'");
  // Only show Chat if both players in the matchup have a linked account
  const canShowChat = Boolean(p1Info.isMatched && p2Info.isMatched && chatTargetInfo.isMatched);

  const overlay = document.createElement('div');
  overlay.id = 'league-matrix-matchup-modal';
  overlay.className = 'modal-backdrop active';
  overlay.style.cssText = 'position: fixed; inset: 0; z-index: 10005; background: rgba(2, 6, 23, 0.78); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; padding: 1rem;';
  overlay.onclick = (e) => { if (e.target === overlay) closeMatrixMatchupModal(); };

  overlay.innerHTML = `
    <div style="background: #0f172a; border: 1px solid ${isCompleted ? 'rgba(16, 185, 129, 0.45)' : 'rgba(56, 189, 248, 0.45)'}; border-radius: 12px; width: 100%; max-width: 480px; padding: 1.25rem; box-shadow: 0 20px 50px rgba(0,0,0,0.7);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.9rem;">
        <span style="font-size: 0.74rem; font-weight: 800; padding: 3px 9px; border-radius: 6px; background: ${isCompleted ? 'rgba(16, 185, 129, 0.18)' : 'rgba(56, 189, 248, 0.16)'}; color: ${isCompleted ? '#34d399' : '#38bdf8'}; border: 1px solid ${isCompleted ? 'rgba(16, 185, 129, 0.45)' : 'rgba(56, 189, 248, 0.4)'};">
          ${isCompleted ? `🟢 PLAYED • ${escapeHtml(scoreLabel || 'Completed')}` : '🔵 MATCHED — YET TO PLAY'}
        </span>
        <button type="button" onclick="closeMatrixMatchupModal()" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 1.1rem;">✕</button>
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; background: rgba(2, 6, 23, 0.55); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 0.9rem 1rem; margin-bottom: 1rem;">
        <div style="flex: 1; min-width: 0;">
          ${p1Info.isMatched ? `
            <button type="button" onclick="if (typeof openPlayerModal === 'function') openPlayerModal('${safeP1Pid}', '${safeP1}');" title="View ${escapeHtml(p1Name)}'s quick profile" style="background: none; border: none; padding: 0; font-weight: 800; font-size: 1rem; color: #38bdf8; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-align: left;">
              ${escapeHtml(p1Name)}
            </button>
          ` : `
            <div style="font-weight: 800; font-size: 1rem; color: #fff;">${escapeHtml(p1Name)}</div>
          `}
          <div style="font-size: 0.78rem; color: #38bdf8; font-weight: 600; margin-top: 2px;">${escapeHtml(p1Faction)}</div>
        </div>
        <div style="font-weight: 900; font-size: 0.9rem; color: ${isCompleted ? '#34d399' : '#64748b'}; padding: 0 0.5rem; flex-shrink: 0;">
          ${isCompleted && scoreLabel ? escapeHtml(scoreLabel) : 'VS'}
        </div>
        <div style="flex: 1; min-width: 0; text-align: right;">
          ${p2Info.isMatched ? `
            <button type="button" onclick="if (typeof openPlayerModal === 'function') openPlayerModal('${safeP2Pid}', '${safeP2}');" title="View ${escapeHtml(p2Name)}'s quick profile" style="background: none; border: none; padding: 0; font-weight: 800; font-size: 1rem; color: #38bdf8; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-align: right;">
              ${escapeHtml(p2Name)}
            </button>
          ` : `
            <div style="font-weight: 800; font-size: 1rem; color: #fff;">${escapeHtml(p2Name)}</div>
          `}
          <div style="font-size: 0.78rem; color: #93c5fd; font-weight: 600; margin-top: 2px;">${escapeHtml(p2Faction)}</div>
        </div>
      </div>

      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <button type="button" onclick="closeMatrixMatchupModal(); launchLeagueMatchTracker('${safeP1}', '${safeP2}', '${safeF1}', '${safeLayout}', ${rNum}, '${safeLeagueId}', ${pNum}, '${safeF2}')" class="btn btn-primary" style="flex: 1.3; padding: 0.55rem 0.75rem; font-size: 0.82rem; font-weight: 800; background: linear-gradient(135deg, #2563eb, #3b82f6); border: none;">
          🎲 Launch Tracker
        </button>
        <button type="button" onclick="const f = document.getElementById('matrix-inline-score-form'); if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none';" class="btn btn-outline" style="flex: 1.2; padding: 0.55rem 0.75rem; font-size: 0.82rem; font-weight: 700; border-color: rgba(16, 185, 129, 0.45); color: #34d399;">
          ⚔️ Edit Pairing / Score
        </button>
        ${canShowChat ? `
          <button type="button" onclick="closeMatrixMatchupModal(); openLeagueOpponentChat('${safeChatTarget}', '${safeChatSender}', ${rNum}, ${pNum}, '${safeChatTargetPid}', '${safeChatTargetUid}')" class="btn btn-outline" style="flex: 0.9; padding: 0.55rem 0.75rem; font-size: 0.82rem; font-weight: 700; border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;">
            💬 Chat
          </button>
        ` : ''}
      </div>

      <!-- Inline Pairing & Score Entry Drawer -->
      <div id="matrix-inline-score-form" style="display: block; margin-top: 0.9rem; padding-top: 0.9rem; border-top: 1px dashed rgba(255,255,255,0.14);">
        ${(() => {
          const curLg = (typeof leagueState !== 'undefined' && (leagueState.currentLeagueData || leagueState.leagueData)) || {};
          const curPodObj = (curLg.active_season?.pods || []).find(p => Number(p.pod_number) === Number(pNum)) || {};
          const podNames = (curPodObj.standings || []).map(s => s.name).filter(Boolean);
          let initS1 = 85, initS2 = 70;
          if (scoreLabel && String(scoreLabel).includes('-')) {
            const pts = String(scoreLabel).split('-').map(x => parseInt(x.trim(), 10));
            if (!isNaN(pts[0]) && !isNaN(pts[1])) { initS1 = pts[0]; initS2 = pts[1]; }
          }
          return `
            <div style="display: grid; grid-template-columns: 1.3fr 1fr; gap: 0.55rem; margin-bottom: 0.6rem;">
              <div>
                <label style="display: block; font-size: 0.71rem; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">Opponent / Ringer (Round ${rNum})</label>
                <input id="matrix-modal-opponent" list="matrix-modal-opp-list" type="text" value="${escapeHtml(p2Name || '')}" style="width: 100%; padding: 0.44rem 0.55rem; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.45); background: #020617; color: #fff; font-weight: 700; font-size: 0.84rem;">
                <datalist id="matrix-modal-opp-list">
                  ${podNames.map(n => `<option value="${escapeHtml(n)}">`).join('')}
                  <option value="Out-of-Pod Ringer (Ringer)">
                </datalist>
              </div>
              <div>
                <label style="display: block; font-size: 0.71rem; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">Match Status</label>
                <select id="matrix-modal-status" style="width: 100%; padding: 0.44rem 0.55rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: #020617; color: #fff; font-weight: 700; font-size: 0.82rem;">
                  <option value="completed" ${isCompleted ? 'selected' : ''}>✅ Completed (Save Score)</option>
                  <option value="scheduled" ${!isCompleted ? 'selected' : ''}>⏳ Scheduled (Pairing Only)</option>
                </select>
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-bottom: 0.55rem;">
              <div>
                <label style="display: block; font-size: 0.72rem; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">${escapeHtml(p1Name)} VP</label>
                <input id="matrix-score-p1" type="number" min="0" max="100" value="${initS1}" style="width: 100%; padding: 0.45rem 0.6rem; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.45); background: #020617; color: #34d399; font-weight: 800; font-size: 0.9rem;">
              </div>
              <div>
                <label style="display: block; font-size: 0.72rem; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">Opponent VP</label>
                <input id="matrix-score-p2" type="number" min="0" max="100" value="${initS2}" style="width: 100%; padding: 0.45rem 0.6rem; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.45); background: #020617; color: #f87171; font-weight: 800; font-size: 0.9rem;">
              </div>
            </div>
            <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.72rem; color: #fbbf24; margin-bottom: 0.65rem; cursor: pointer;">
              <input id="matrix-modal-ringer" type="checkbox">
              <span>🃏 Official Ringer Match (+750 In-Pod / +500 Out-of-Pod Ringer Bonus BP)</span>
            </label>
          `;
        })()}
        <button type="button" id="matrix-score-save-btn" onclick="submitMatrixMatchupScore('${safeLeagueId}', ${pNum}, ${rNum}, '${safeP1}', '${safeP2}')" class="btn btn-primary" style="width: 100%; padding: 0.55rem; font-size: 0.82rem; font-weight: 800; background: #10b981; border: none; color: #022c22;">
          ✓ Save Pairing &amp; Match Update
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}
window.openMatrixMatchupModal = openMatrixMatchupModal;

async function submitMatrixMatchupScore(leagueId, podNum, roundNum, player1, player2) {
  const p1El = document.getElementById('matrix-score-p1');
  const p2El = document.getElementById('matrix-score-p2');
  const oppEl = document.getElementById('matrix-modal-opponent');
  const statusEl = document.getElementById('matrix-modal-status');
  const ringerEl = document.getElementById('matrix-modal-ringer');
  const btn = document.getElementById('matrix-score-save-btn');
  if (!p1El || !p2El) return;

  const newOpponent = (oppEl ? oppEl.value.trim() : player2) || player2;
  const statusVal = statusEl ? statusEl.value : 'completed';
  const isCompleted = statusVal === 'completed';
  const isRinger = Boolean(ringerEl?.checked);

  const s1 = parseInt(p1El.value, 10) || 0;
  const s2 = parseInt(p2El.value, 10) || 0;
  if (isCompleted && (s1 < 0 || s2 < 0 || s1 > 100 || s2 > 100)) {
    alert('Please enter valid Victory Points between 0 and 100 for both players.');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving Update...';
  }

  try {
    const cleanLid = leagueId || '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90';
    const res = await fetch(`/api/league/${encodeURIComponent(cleanLid)}/pairings/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_match',
        pod_number: podNum,
        round: roundNum,
        player_name: player1,
        opponent_name: newOpponent,
        is_completed: isCompleted,
        is_ringer: isRinger,
        player_score: s1,
        opponent_score: s2
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

    closeMatrixMatchupModal();
    if (data.league && typeof leagueState !== 'undefined') {
      const canonicalUuid = normalizeLeagueIdToUuid(data.league.league_id || cleanLid);
      data.league.league_id = canonicalUuid;
      leagueState.currentLeagueData = data.league;
      leagueState.leagueData = data.league;
      if (!leagueState._cache) leagueState._cache = {};
      leagueState._cache[canonicalUuid] = { data: data.league, timestamp: Date.now() };
      renderLeagueHub(data.league);
    } else {
      await loadLeagueData(cleanLid, true);
    }
    if (typeof renderLeagueDetailView === 'function') {
      renderLeagueDetailView(cleanLid);
    }
    if (typeof showToast === 'function') {
      showToast(`⚔️ Updated Pod #${podNum} Round ${roundNum}: ${player1} vs ${newOpponent}!`);
    }
  } catch (err) {
    alert(`Failed to save pairing/score: ${err.message}`);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✓ Save Pairing & Match Update';
    }
  }
}
window.submitMatrixMatchupScore = submitMatrixMatchupScore;

/**
 * Switches the active season viewed in League Hub
 */
async function openHistoricalSeasonArchiveModal(seasonNum) {
  seasonNum = parseInt(seasonNum, 10) || 37;
  const league = leagueState.currentLeagueData;
  const cleanId = league?.league_id || leagueState.activeLeagueId || '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90';
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
            const matched = Boolean(st.is_db_matched && st.bcp_player_id && !String(st.bcp_player_id).startsWith('bcp_'));
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
 * TO Wizard to Create a New Community League (1 Unified Pod League Format — Fully Parameterized for Any TO)
 */
function openCopyLeagueTemplateModal() {
  const existing = document.getElementById('league-copy-modal-backdrop');
  if (existing) existing.remove();

  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() + 14);
  const startStr = defaultStart.toISOString().split('T')[0];

  const modalHtml = `
    <div id="league-copy-modal-backdrop" onclick="closeLeagueModal(event)" style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 1rem;">
      <div onclick="event.stopPropagation()" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; width: 100%; max-width: 720px; max-height: 92vh; overflow-y: auto; padding: 1.5rem; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 0.85rem;">
          <div>
            <div style="font-size: 0.72rem; color: #f59e0b; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Event Studio • Community Pod League Engine</div>
            <h2 style="margin: 0.15rem 0 0 0; font-size: 1.35rem; font-weight: 800; color: #fff;">Create &amp; Configure Community League</h2>
          </div>
          <button onclick="document.getElementById('league-copy-modal-backdrop').remove()" style="background: none; border: none; font-size: 1.25rem; color: var(--text-muted); cursor: pointer;">✕</button>
        </div>

        <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.5;">
          Configure your league's divisions, seasonal cadence, Battle Point (BP) scoring formula, promotion/relegation rules, ringer policy, and activity requirements. Every league receives a unique UUID and dedicated League Hub page.
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.85rem; margin-bottom: 1.15rem;">
          <!-- 1. Identity & Host Store -->
          <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.85rem;">
            <div style="font-size: 0.74rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; margin-bottom: 0.55rem;">1. Identity, Host Store &amp; Points Limit</div>
            <div style="display: grid; grid-template-columns: 1.4fr 1fr 0.7fr; gap: 0.6rem; margin-bottom: 0.6rem;">
              <div>
                <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">League Name *</label>
                <input type="text" id="new-league-name" placeholder="e.g. North County 40k Crucible League" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">City / Region *</label>
                <input type="text" id="new-league-region" placeholder="e.g. San Diego, CA" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Points Limit *</label>
                <input type="number" id="new-league-points" value="2000" step="250" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.6rem;">
              <div>
                <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">TO / Commissioner *</label>
                <input type="text" id="new-league-comm" placeholder="Your Name or Club" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Host Game Store / Venue</label>
                <input type="text" id="new-league-venue" placeholder="e.g. At Ease Games / Brute Force" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Season 1 Start Date *</label>
                <input type="date" id="new-league-start-date" value="${startStr}" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
            </div>
          </div>

          <!-- 2. Season Cadence & Pod Structure -->
          <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.85rem;">
            <div style="font-size: 0.74rem; font-weight: 800; color: #34d399; text-transform: uppercase; margin-bottom: 0.55rem;">2. Season Cadence, Pod Sizing &amp; Division Names</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 0.6rem; margin-bottom: 0.6rem;">
              <div>
                <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Pod Size (Min–Max)</label>
                <div style="display: flex; align-items: center; gap: 0.3rem;">
                  <input type="number" id="new-league-pod-min" min="4" max="16" value="6" class="form-input" style="width: 100%; box-sizing: border-box;" />
                  <span style="color: #94a3b8;">–</span>
                  <input type="number" id="new-league-pod-max" min="4" max="16" value="8" class="form-input" style="width: 100%; box-sizing: border-box;" />
                </div>
              </div>
              <div>
                <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Season Weeks</label>
                <input type="number" id="new-league-weeks" min="4" max="16" value="8" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Games / Season</label>
                <input type="number" id="new-league-rounds" min="3" max="9" value="5" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Reg Window</label>
                <select id="new-league-reg-window" class="form-input" style="width: 100%; box-sizing: border-box;">
                  <option value="14" selected>14 Days Prior</option>
                  <option value="21">21 Days Prior</option>
                  <option value="7">7 Days Prior</option>
                </select>
              </div>
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Custom Pod / Division Names (comma-separated, ordered Tier 1 → Tier N)</label>
              <input type="text" id="new-league-pod-names" value="Pod 1 - Premier Division, Pod 2 - Challenger Division, Pod 3 - Vanguard Division" placeholder="e.g. Pod 1 - The Hard Boys, Pod 2 - The Deuce, Pod 3 - Blooded" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
          </div>

          <!-- 3. Battle Points, Promotion/Relegation & Ringer Policy -->
          <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.85rem;">
            <div style="font-size: 0.74rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; margin-bottom: 0.55rem;">3. Scoring Formula, Promotion/Relegation, Ringers &amp; Discipline</div>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; margin-bottom: 0.6rem;">
              <div>
                <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Win Bonus BP</label>
                <input type="number" id="new-league-win-bp" value="1000" step="50" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Draw Bonus BP</label>
                <input type="number" id="new-league-draw-bp" value="500" step="50" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">In-Pod Ringer BP</label>
                <input type="number" id="new-league-ringer-bp" value="750" step="50" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Out-of-Pod Ringer BP</label>
                <input type="number" id="new-league-out-ringer-bp" value="500" step="50" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; margin-bottom: 0.6rem;">
              <div>
                <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #34d399; margin-bottom: 0.25rem;">Promote / Pod (▲)</label>
                <input type="number" id="new-league-promo-cnt" min="0" max="6" value="2" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #f87171; margin-bottom: 0.25rem;">Relegate / Pod (▼)</label>
                <input type="number" id="new-league-rel-cnt" min="0" max="6" value="2" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Min Games Req.</label>
                <input type="number" id="new-league-min-games" min="1" max="9" value="3" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
              <div>
                <label style="display: block; font-size: 0.74rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Playoff Finals Size</label>
                <select id="new-league-finals-size" class="form-input" style="width: 100%; box-sizing: border-box;">
                  <option value="0">No Bracket (Pod Prizing)</option>
                  <option value="4">Top 4 Playoff Bracket</option>
                  <option value="8" selected>Top 8 Playoff Bracket</option>
                  <option value="16">Top 16 Playoff Bracket</option>
                </select>
              </div>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 1rem; padding-top: 0.25rem;">
              <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; color: #cbd5e1; cursor: pointer;">
                <input type="checkbox" id="new-league-paint-bonus" />
                <span>Include <strong>+10 VP Battle Ready Paint Bonus</strong></span>
              </label>
              <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; color: #cbd5e1; cursor: pointer;">
                <input type="checkbox" id="new-league-out-ringer-allowed" checked />
                <span>Allow <strong>Out-of-Pod Ringers</strong></span>
              </label>
              <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; color: #cbd5e1; cursor: pointer;">
                <input type="checkbox" id="new-league-cards-enabled" checked />
                <span>Enable <strong>Yellow / Red / Black Card</strong> Activity Policy</span>
              </label>
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 0.5rem;">
          <button onclick="submitNewLeagueCreation()" class="btn btn-primary" style="flex: 1; background: linear-gradient(135deg, #d97706, #b45309); border: 1px solid #f59e0b; font-weight: 700;">
            🚀 Create Community League &amp; Open Registration
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
 * Creates new league via POST /api/league/create and routes to its unique UUID
 */
async function submitNewLeagueCreation() {
  const name = document.getElementById('new-league-name')?.value.trim();
  const region = document.getElementById('new-league-region')?.value.trim();
  const pointsLimit = parseInt(document.getElementById('new-league-points')?.value || '2000', 10) || 2000;
  const commissioner = document.getElementById('new-league-comm')?.value.trim();
  const venue = document.getElementById('new-league-venue')?.value.trim();
  const startDate = document.getElementById('new-league-start-date')?.value || '';
  const durationWeeks = parseInt(document.getElementById('new-league-weeks')?.value || '8', 10) || 8;
  const roundsCount = parseInt(document.getElementById('new-league-rounds')?.value || '5', 10) || 5;
  const regDays = parseInt(document.getElementById('new-league-reg-window')?.value || '14', 10) || 14;
  const podMin = parseInt(document.getElementById('new-league-pod-min')?.value || '6', 10) || 6;
  const podMax = parseInt(document.getElementById('new-league-pod-max')?.value || '8', 10) || 8;
  const podNamesRaw = document.getElementById('new-league-pod-names')?.value || '';
  const customPodNames = podNamesRaw.split(',').map(s => s.trim()).filter(Boolean);
  const winBp = parseInt(document.getElementById('new-league-win-bp')?.value || '1000', 10) || 1000;
  const drawBp = parseInt(document.getElementById('new-league-draw-bp')?.value || '500', 10) || 500;
  const inRingerBp = parseInt(document.getElementById('new-league-ringer-bp')?.value || '750', 10) || 750;
  const outRingerBp = parseInt(document.getElementById('new-league-out-ringer-bp')?.value || '500', 10) || 500;
  const promoCnt = parseInt(document.getElementById('new-league-promo-cnt')?.value || '2', 10) ?? 2;
  const relCnt = parseInt(document.getElementById('new-league-rel-cnt')?.value || '2', 10) ?? 2;
  const minGames = parseInt(document.getElementById('new-league-min-games')?.value || '3', 10) || 3;
  const finalsSize = parseInt(document.getElementById('new-league-finals-size')?.value || '8', 10) || 0;
  const paintBonus = Boolean(document.getElementById('new-league-paint-bonus')?.checked);
  const outRingerAllowed = Boolean(document.getElementById('new-league-out-ringer-allowed')?.checked);
  const cardsEnabled = Boolean(document.getElementById('new-league-cards-enabled')?.checked);

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
        region: region || 'San Diego, CA',
        points_limit: pointsLimit,
        commissioner: commissioner || 'Community Organizer',
        partner_venues: venue ? [{ name: venue, role: 'Official Host Store' }] : [],
        start_date: startDate,
        duration_weeks: durationWeeks,
        rounds_count: roundsCount,
        games_per_season: roundsCount,
        pod_size: podMax,
        pod_size_min: podMin,
        pod_size_max: podMax,
        custom_pod_names: customPodNames,
        win_bp_bonus: winBp,
        draw_bp_bonus: drawBp,
        in_pod_ringer_bonus_bp: inRingerBp,
        ringer_win_bp_bonus: inRingerBp,
        out_of_pod_ringer_allowed: outRingerAllowed,
        out_of_pod_ringer_bonus_bp: outRingerBp,
        promotion_count: promoCnt,
        relegation_count: relCnt,
        finals_bracket_size: finalsSize,
        has_playoff_finals: finalsSize > 0,
        paint_score_included: paintBonus,
        paint_bonus_bp: paintBonus ? 10 : 0,
        min_games_required: minGames,
        enable_disciplinary_cards: cardsEnabled,
        recurring_seasons: true,
        registration_window_days: regDays,
        registration_open: true
      })
    });
    const json = await res.json();
    if (!json.success || !json.league) throw new Error(json.error || 'Failed to create league');

    document.getElementById('league-copy-modal-backdrop')?.remove();
    leagueState.availableLeagues = null;
    renderSparringRadarLeagueRegistrations();
    const newUuid = json.league_id || json.league.league_id;
    openLeagueHubPage(newUuid, '40k', { replaceUrl: true });
  } catch (err) {
    alert(`Error creating league: ${err.message}`);
  }
}

/**
 * Opens modal to configure an existing League's Format & Rules (persisted to PostgreSQL via POST /api/league/{uuid}/config)
 */
function openConfigureLeagueModal(leagueId = SD40K_CANONICAL_UUID) {
  const existing = document.getElementById('league-config-modal-backdrop');
  if (existing) existing.remove();

  const canonicalUuid = normalizeLeagueIdToUuid(leagueId);
  const league = leagueState.currentLeagueData || {};
  const m = league.methodology || {};
  const actSeason = league.active_season || {};
  const pods = actSeason.pods || [];
  const podNamesStr = (Array.isArray(m.custom_pod_names) && m.custom_pod_names.length)
    ? m.custom_pod_names.join(', ')
    : pods.map(p => p.name || `Pod #${p.pod_number}`).join(', ');
  const podMin = m.pod_size_min || 6;
  const podMax = m.pod_size_max || 8;
  const ptsLimit = m.points_limit || 2000;
  const durationWeeks = m.season_duration_weeks || actSeason.duration_weeks || 8;
  const roundsCount = m.games_per_season || actSeason.rounds_count || 5;
  const winBp = m.win_bp_bonus ?? m.win_bonus_bp ?? 1000;
  const drawBp = m.draw_bp_bonus ?? m.draw_bonus_bp ?? 500;
  const paintBp = m.paint_bonus_bp ?? (m.paint_score_included ? 10 : 0);
  const inRingerBp = m.in_pod_ringer_bonus_bp ?? m.ringer_win_bp_bonus ?? 750;
  const outRingerAllowed = m.out_of_pod_ringer_allowed !== false;
  const outRingerBp = m.out_of_pod_ringer_bonus_bp ?? 500;
  const promoCnt = m.promotion_count ?? 2;
  const relCnt = m.relegation_count ?? 2;
  const minGames = m.min_games_required ?? 3;
  const finalsSize = m.finals_bracket_size ?? (m.has_playoff_finals === false ? 0 : 16);

  const html = `
    <div id="league-config-modal-backdrop" onclick="if(event.target === this) this.remove()" style="position: fixed; inset: 0; background: rgba(0,0,0,0.78); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; z-index: 99999; padding: 1rem;">
      <div onclick="event.stopPropagation()" style="background: var(--bg-card); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 12px; width: 100%; max-width: 680px; max-height: 90vh; overflow-y: auto; padding: 1.5rem; box-shadow: 0 20px 50px rgba(0,0,0,0.7);">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 0.85rem;">
          <div>
            <div style="font-size: 0.72rem; color: #38bdf8; font-weight: 800; text-transform: uppercase;">Event Studio • Community League Configuration (${escapeHtml(canonicalUuid)})</div>
            <h2 style="margin: 0.15rem 0 0 0; font-size: 1.3rem; font-weight: 800; color: #fff;">Customize Rules &amp; Format — ${escapeHtml(league.name || canonicalUuid)}</h2>
          </div>
          <button onclick="document.getElementById('league-config-modal-backdrop').remove()" style="background: none; border: none; font-size: 1.25rem; color: var(--text-muted); cursor: pointer;">✕</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.8rem; margin-bottom: 1.15rem;">
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem;">
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Pod Size Min–Max</label>
              <div style="display: flex; align-items: center; gap: 0.3rem;">
                <input type="number" id="cfg-league-pod-min" min="4" max="16" value="${podMin}" class="form-input" style="width: 100%; box-sizing: border-box;" />
                <span style="color: #94a3b8;">–</span>
                <input type="number" id="cfg-league-pod-max" min="4" max="16" value="${podMax}" class="form-input" style="width: 100%; box-sizing: border-box;" />
              </div>
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Points Limit</label>
              <input type="number" id="cfg-league-points" value="${ptsLimit}" step="250" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Season Weeks</label>
              <input type="number" id="cfg-league-weeks" value="${durationWeeks}" min="4" max="16" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Games / Season</label>
              <input type="number" id="cfg-league-rounds" value="${roundsCount}" min="3" max="9" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
          </div>

          <div>
            <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Custom Pod / Division Names (comma-separated, Tier 1 → Tier N)</label>
            <input type="text" id="cfg-league-pod-names" value="${escapeHtml(podNamesStr)}" class="form-input" style="width: 100%; box-sizing: border-box;" />
          </div>

          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem;">
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #34d399; margin-bottom: 0.25rem;">Win Bonus BP</label>
              <input type="number" id="cfg-league-win-bp" value="${winBp}" step="50" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #60a5fa; margin-bottom: 0.25rem;">Draw Bonus BP</label>
              <input type="number" id="cfg-league-draw-bp" value="${drawBp}" step="50" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fbbf24; margin-bottom: 0.25rem;">In-Pod Ringer BP</label>
              <input type="number" id="cfg-league-ringer-bp" value="${inRingerBp}" step="50" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fbbf24; margin-bottom: 0.25rem;">Out-of-Pod Ringer BP</label>
              <input type="number" id="cfg-league-out-ringer-bp" value="${outRingerBp}" step="50" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem;">
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #34d399; margin-bottom: 0.25rem;">Auto-Promote (▲)</label>
              <input type="number" id="cfg-league-promo-cnt" value="${promoCnt}" min="0" max="6" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #f87171; margin-bottom: 0.25rem;">Auto-Relegate (▼)</label>
              <input type="number" id="cfg-league-rel-cnt" value="${relCnt}" min="0" max="6" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Min Games Req.</label>
              <input type="number" id="cfg-league-min-games" value="${minGames}" min="1" max="9" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">Playoff Finals Size</label>
              <input type="number" id="cfg-league-finals-size" value="${finalsSize}" min="0" max="32" class="form-input" style="width: 100%; box-sizing: border-box;" />
            </div>
          </div>

          <div style="display: flex; flex-wrap: wrap; gap: 1rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: #cbd5e1; cursor: pointer;">
              <input type="checkbox" id="cfg-league-paint-bonus" ${paintBp > 0 ? 'checked' : ''} />
              <span>Include explicit <strong>+10 VP Battle Ready Paint Score</strong></span>
            </label>
            <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: #cbd5e1; cursor: pointer;">
              <input type="checkbox" id="cfg-league-out-ringer-allowed" ${outRingerAllowed ? 'checked' : ''} />
              <span>Allow <strong>Out-of-Pod Ringer Matches</strong></span>
            </label>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
          <button type="button" onclick="document.getElementById('league-config-modal-backdrop').remove()" class="btn btn-outline">Cancel</button>
          <button type="button" onclick="submitLeagueConfiguration('${escapeHtml(canonicalUuid)}')" class="btn btn-primary" style="background: linear-gradient(135deg, #2563eb, #1d4ed8); border: none; font-weight: 700;">
            ✓ Save League Configuration to PostgreSQL
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}
window.openConfigureLeagueModal = openConfigureLeagueModal;

async function submitLeagueConfiguration(leagueId) {
  const canonicalUuid = normalizeLeagueIdToUuid(leagueId);
  const podMin = parseInt(document.getElementById('cfg-league-pod-min')?.value || '6', 10) || 6;
  const podMax = parseInt(document.getElementById('cfg-league-pod-max')?.value || '8', 10) || 8;
  const pointsLimit = parseInt(document.getElementById('cfg-league-points')?.value || '2000', 10) || 2000;
  const durationWeeks = parseInt(document.getElementById('cfg-league-weeks')?.value || '8', 10) || 8;
  const roundsCount = parseInt(document.getElementById('cfg-league-rounds')?.value || '5', 10) || 5;
  const winBp = parseInt(document.getElementById('cfg-league-win-bp')?.value || '1000', 10) || 1000;
  const drawBp = parseInt(document.getElementById('cfg-league-draw-bp')?.value || '500', 10) || 500;
  const ringerBp = parseInt(document.getElementById('cfg-league-ringer-bp')?.value || '750', 10) || 750;
  const outRingerBp = parseInt(document.getElementById('cfg-league-out-ringer-bp')?.value || '500', 10) || 500;
  const promoCnt = parseInt(document.getElementById('cfg-league-promo-cnt')?.value || '2', 10) ?? 2;
  const relCnt = parseInt(document.getElementById('cfg-league-rel-cnt')?.value || '2', 10) ?? 2;
  const minGames = parseInt(document.getElementById('cfg-league-min-games')?.value || '3', 10) || 3;
  const finalsSize = parseInt(document.getElementById('cfg-league-finals-size')?.value || '0', 10) || 0;
  const podNames = (document.getElementById('cfg-league-pod-names')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const paintBonus = Boolean(document.getElementById('cfg-league-paint-bonus')?.checked);
  const outRingerAllowed = Boolean(document.getElementById('cfg-league-out-ringer-allowed')?.checked);

  try {
    const res = await fetch(`/api/league/${encodeURIComponent(canonicalUuid)}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pod_size_min: podMin,
        pod_size_max: podMax,
        points_limit: pointsLimit,
        season_duration_weeks: durationWeeks,
        games_per_season: roundsCount,
        win_bp_bonus: winBp,
        draw_bp_bonus: drawBp,
        ringer_win_bp_bonus: ringerBp,
        in_pod_ringer_bonus_bp: ringerBp,
        out_of_pod_ringer_allowed: outRingerAllowed,
        out_of_pod_ringer_bonus_bp: outRingerBp,
        promotion_count: promoCnt,
        relegation_count: relCnt,
        min_games_required: minGames,
        finals_bracket_size: finalsSize,
        has_playoff_finals: finalsSize > 0,
        custom_pod_names: podNames,
        paint_score_included: paintBonus,
        paint_bonus_bp: paintBonus ? 10 : 0
      })
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Failed to save configuration');
    document.getElementById('league-config-modal-backdrop')?.remove();
    await loadLeagueData(canonicalUuid, true);
    if (typeof showToast === 'function') showToast('⚙️ League rules & parameters updated!');
  } catch (err) {
    alert(`Error saving league configuration: ${err.message}`);
  }
}
window.submitLeagueConfiguration = submitLeagueConfiguration;

/**
 * Opens direct opponent chat from a League Pairing Card
 */
function openLeagueOpponentChat(opponentName, myName, roundNum, podNum, opponentPlayerId = '', opponentUserId = '') {
  const resolved = typeof resolveLeaguePlayerIdentity === 'function'
    ? resolveLeaguePlayerIdentity(opponentName, podNum, opponentPlayerId)
    : { bcp_player_id: opponentPlayerId, user_id: opponentUserId };
  const targetPid = opponentPlayerId || resolved.bcp_player_id || null;
  const targetUid = opponentUserId || resolved.user_id || null;

  if (typeof handlePlayerChatClick === 'function' && window.currentUser) {
    handlePlayerChatClick(targetPid, opponentName, targetUid);
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
async function toggleLeagueRegistrationWindow(leagueId = '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90') {
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
      const lid = l.league_id || '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90';
      const isG = String(l.slug || l.name || '').toLowerCase().includes('gauntlet');
      const sDate = formatLeagueDateShort(l.start_date || (isG ? '2026-09-01' : '2026-09-15'));
      const eDate = formatLeagueDateShort(l.end_date || (isG ? '2026-10-26' : '2026-11-10'));
      return `
        <div class="card" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.14) 0%, rgba(15, 23, 42, 0.92) 100%); border: 1px solid rgba(16, 185, 129, 0.45); border-radius: 12px; padding: 1rem 1.25rem; margin-bottom: 0.85rem; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.85rem;">
            <div style="flex: 1; min-width: 260px;">
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.3rem;">
                <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.45); font-size: 0.68rem; font-weight: 800; padding: 2px 8px; border-radius: 999px; text-transform: uppercase;">
                  📡 LIVE REGISTRATION OPEN • SPARRING RADAR
                </span>
                <span style="font-size: 0.74rem; color: #38bdf8; font-weight: 700;">
                  📅 Started: ${escapeHtml(sDate)} • Ends: ${escapeHtml(eDate)}
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
async function openLeagueRolloverPreviewModal(leagueId = '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90') {
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
async function openLeaguePlayerClaimModal(leagueId = '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90', preselectedParticipantName = '', preselectedPodNum = null) {
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
    <div id="league-player-claim-modal" class="modal-backdrop" onclick="if(event.target.id==='league-player-claim-modal') this.remove();" style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.82); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 0.75rem; box-sizing: border-box;">
      <div class="modal-card" style="background: #0f172a; border: 1px solid #334155; border-radius: 12px; max-width: 540px; width: 100%; max-height: 90vh; overflow-y: auto; overflow-x: hidden; padding: 1.15rem; color: #f8fafc; box-shadow: 0 20px 50px rgba(0,0,0,0.65); box-sizing: border-box;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.9rem;">
          <div style="min-width: 0;">
            <h3 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: #fff; line-height: 1.3;">🙋‍♂️ I'm in this League — Link User ID &amp; BCP Profile</h3>
            <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 4px; line-height: 1.35;">
              Stored in <code style="color: #38bdf8;">native_league_participants</code> • Links your <code style="color: #34d399;">user_id</code> &amp; <code style="color: #fbbf24;">bcp_player_id</code> (<code style="color: #fbbf24;">players.player_id</code>)
            </div>
          </div>
          <button onclick="document.getElementById('league-player-claim-modal').remove()" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; width: 30px; height: 30px; flex-shrink: 0; color: #94a3b8; font-size: 1.05rem; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;">✕</button>
        </div>

        <!-- Mode Selector -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 0.5rem; margin-bottom: 0.9rem;">
          <button type="button" id="claim-mode-existing-btn" onclick="document.getElementById('claim-mode-input').value='claim_existing'; document.getElementById('claim-existing-group').style.display='block'; document.getElementById('claim-mode-existing-btn').style.borderColor='#3b82f6'; document.getElementById('claim-mode-new-btn').style.borderColor='#334155';" style="padding: 0.55rem 0.65rem; border-radius: 8px; border: 2px solid #3b82f6; background: rgba(59, 130, 246, 0.12); color: #fff; font-weight: 700; font-size: 0.78rem; cursor: pointer; text-align: left; box-sizing: border-box;">
            🔗 Match Existing Pod Slot
            <div style="font-size: 0.68rem; color: #94a3b8; font-weight: 500; margin-top: 2px; line-height: 1.25;">Couldn't match by name assumption? Link your user_id</div>
          </button>
          <button type="button" id="claim-mode-new-btn" onclick="document.getElementById('claim-mode-input').value='join_new'; document.getElementById('claim-existing-group').style.display='none'; document.getElementById('claim-mode-new-btn').style.borderColor='#3b82f6'; document.getElementById('claim-mode-existing-btn').style.borderColor='#334155';" style="padding: 0.55rem 0.65rem; border-radius: 8px; border: 2px solid #334155; background: rgba(15, 23, 42, 0.6); color: #fff; font-weight: 700; font-size: 0.78rem; cursor: pointer; text-align: left; box-sizing: border-box;">
            🆕 Newly Registered Player
            <div style="font-size: 0.68rem; color: #94a3b8; font-weight: 500; margin-top: 2px; line-height: 1.25;">Say "I'm in this league" &amp; add to active season</div>
          </button>
        </div>
        <input type="hidden" id="claim-mode-input" value="${initialMode}" />

        <div id="claim-existing-group" style="margin-bottom: 0.85rem;">
          <label style="display: block; font-size: 0.72rem; font-weight: 700; color: #cbd5e1; text-transform: uppercase; margin-bottom: 4px;">
            Select Unmatched Season / Pod Participant Slot
          </label>
          <select id="claim-participant-select" style="width: 100%; box-sizing: border-box; padding: 0.55rem 0.7rem; border-radius: 8px; background: #1e293b; border: 1px solid #475569; color: #fff; font-size: 0.83rem; font-weight: 600;">
            ${targetList.map(opt => `
              <option value="${escapeHtml(opt.name)}" data-pod="${opt.pod_num}" ${opt.name === preselectedParticipantName ? 'selected' : ''}>
                Pod #${opt.pod_num} — ${escapeHtml(opt.name)} (${escapeHtml(opt.faction)}) ${opt.is_db_matched ? '[Matched]' : '[Unlinked in DB]'}
              </option>
            `).join('')}
          </select>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0.65rem; margin-bottom: 0.85rem;">
          <div style="min-width: 0;">
            <label style="display: block; font-size: 0.72rem; font-weight: 700; color: #cbd5e1; text-transform: uppercase; margin-bottom: 4px;">
              Registered User ID (<code style="color:#34d399;">users.id</code>)
            </label>
            <input type="text" id="claim-user-id-input" value="${escapeHtml(defaultUserId)}" style="width: 100%; box-sizing: border-box; padding: 0.5rem 0.65rem; border-radius: 8px; background: #1e293b; border: 1px solid #475569; color: #34d399; font-family: monospace; font-size: 0.82rem;" />
          </div>
          <div style="min-width: 0;">
            <label style="display: block; font-size: 0.72rem; font-weight: 700; color: #cbd5e1; text-transform: uppercase; margin-bottom: 4px;">
              BCP Player ID (<code style="color:#fbbf24;">players.player_id</code>)
            </label>
            <input type="text" id="claim-bcp-id-input" value="${escapeHtml(defaultBcpId)}" style="width: 100%; box-sizing: border-box; padding: 0.5rem 0.65rem; border-radius: 8px; background: #1e293b; border: 1px solid #475569; color: #fbbf24; font-family: monospace; font-size: 0.82rem;" />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0.65rem; margin-bottom: 1rem;">
          <div style="min-width: 0;">
            <label style="display: block; font-size: 0.72rem; font-weight: 700; color: #cbd5e1; text-transform: uppercase; margin-bottom: 4px;">
              Verified Display Name
            </label>
            <input type="text" id="claim-display-name-input" value="${escapeHtml(defaultDisplayName)}" style="width: 100%; box-sizing: border-box; padding: 0.5rem 0.65rem; border-radius: 8px; background: #1e293b; border: 1px solid #475569; color: #fff; font-size: 0.84rem;" />
          </div>
          <div style="min-width: 0;">
            <label style="display: block; font-size: 0.72rem; font-weight: 700; color: #cbd5e1; text-transform: uppercase; margin-bottom: 4px;">
              Primary Faction
            </label>
            <input type="text" id="claim-faction-input" value="Dark Angels" style="width: 100%; box-sizing: border-box; padding: 0.5rem 0.65rem; border-radius: 8px; background: #1e293b; border: 1px solid #475569; color: #fff; font-size: 0.84rem;" />
          </div>
        </div>

        <div id="claim-status-msg" style="display: none; margin-bottom: 0.85rem; padding: 0.6rem 0.8rem; border-radius: 8px; font-size: 0.8rem; font-weight: 600;"></div>

        <div style="display: flex; justify-content: flex-end; gap: 0.55rem; flex-wrap: wrap;">
          <button type="button" onclick="document.getElementById('league-player-claim-modal').remove()" class="btn btn-outline" style="padding: 0.48rem 0.9rem; flex: 0 1 auto;">Cancel</button>
          <button type="button" onclick="submitLeagueParticipantClaim('${escapeHtml(leagueId)}')" class="btn btn-primary" style="padding: 0.48rem 1rem; flex: 1 1 auto; background: linear-gradient(135deg, #2563eb, #3b82f6); border: none; font-weight: 700;">
            ✓ Link Profile &amp; Make Clickable
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}
window.openLeaguePlayerClaimModal = openLeaguePlayerClaimModal;

async function submitLeagueParticipantClaim(leagueId = '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90') {
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


