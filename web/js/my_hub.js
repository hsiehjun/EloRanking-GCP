/* ==========================================================================
   MY_HUB.JS - Competitor Profile Hub & Personal Analytics
   ========================================================================== */

var myHubData = (typeof window !== 'undefined' && window.myHubData) || null;
if (typeof window !== 'undefined') window.myHubData = myHubData;

function buildMyHubShellData(u) {
  if (!u) return null;
  return {
    player: {
      player_name: u.display_name || '',
      current_elo: u.current_elo || 1500.0,
      peak_elo: u.peak_elo || u.current_elo || 1500.0,
      win_rate: u.win_rate || 0.0,
      matches_played: u.matches_played || 0,
      wins: u.wins || 0,
      losses: u.losses || 0,
      top_faction: u.top_faction || '',
      team: u.team || ''
    },
    rankings: {
      global_rank: u.global_rank || null,
      faction_rank: u.faction_rank || null
    },
    history: [],
    faction_mastery: [],
    matchup_matrix: [],
    upcoming_events: [],
    registered_tournaments: [],
    active_sessions: [],
    _isSkeleton: true
  };
}

function isValidRegisteredTournament(ev) {
  if (!ev) return false;
  if ((ev.is_organizer || ev.isOwner || ev.isTO) && !ev.player_id && !ev.bcp_player_id && !ev.has_explicit_player_data) return false;
  return true;
}

function getLocalTrackerSessions(gs = '40k') {
  const isAos = gs === 'aos';
  const historyKey = isAos ? 'omni-aos-tracker-history' : 'gdm-11e-tracker-history';
  const stateKey = isAos ? 'omni-aos-tracker-state' : 'gdm-11e-tracker-state';
  let hidden = [];
  try { hidden = JSON.parse(localStorage.getItem('gt-hidden-matches') || '[]'); } catch (e) {}
  const hiddenSet = new Set(hidden);

  let active = [];
  let completed = [];

  try {
    const rawHistory = localStorage.getItem(historyKey);
    if (rawHistory) {
      const parsed = JSON.parse(rawHistory);
      if (Array.isArray(parsed)) {
        parsed.forEach(item => {
          const mid = (item.match_id || item.id || '').trim();
          if (!mid || hiddenSet.has(mid)) return;
          const isFin = Boolean(item.isFinished || item.is_finished || item.status === 'completed');
          const itemSys = item.game_system || (mid.startsWith('AOS-') ? 'aos' : '40k');
          if (isAos ? (itemSys !== 'aos' && !mid.startsWith('AOS-')) : (itemSys === 'aos' || mid.startsWith('AOS-'))) return;

          const formatted = {
            id: mid,
            match_id: mid,
            game_system: itemSys,
            p1_name: item.p1_name || item.game?.p1Name || 'Player 1',
            p2_name: item.p2_name || item.game?.p2Name || 'Player 2',
            p1_score: item.p1_score ?? item.p1Score ?? 0,
            p2_score: item.p2_score ?? item.p2Score ?? 0,
            p1_faction: item.p1_faction || item.game?.p1Faction || '',
            p2_faction: item.p2_faction || item.game?.p2Faction || '',
            primary_mission: item.primary_mission || item.game?.primary || '',
            current_round: item.current_round || item.round || 1,
            round: item.round || item.current_round || 1,
            is_finished: isFin,
            created_at: item.created_at || item.date || Date.now(),
            date: item.date || item.created_at
          };

          if (!isFin) {
            active.push(formatted);
          } else {
            completed.push(formatted);
          }
        });
      }
    }
  } catch (e) {}

  try {
    const rawState = localStorage.getItem(stateKey);
    if (rawState) {
      const stateObj = JSON.parse(rawState);
      const mid = (stateObj.match_id || stateObj.id || '').trim();
      if (mid && !hiddenSet.has(mid) && !stateObj.is_finished && stateObj.status !== 'completed') {
        const itemSys = stateObj.game_system || (mid.startsWith('AOS-') ? 'aos' : '40k');
        const matchesSys = isAos ? (itemSys === 'aos' || mid.startsWith('AOS-')) : (itemSys !== 'aos' && !mid.startsWith('AOS-'));
        if (matchesSys && !active.some(a => (a.match_id || a.id) === mid)) {
          active.unshift({
            id: mid,
            match_id: mid,
            game_system: itemSys,
            p1_name: stateObj.p1_name || stateObj.game?.p1Name || 'Player 1',
            p2_name: stateObj.p2_name || stateObj.game?.p2Name || 'Player 2',
            p1_score: stateObj.p1?.score ?? stateObj.p1_score ?? stateObj.p1Score ?? 0,
            p2_score: stateObj.p2?.score ?? stateObj.p2_score ?? stateObj.p2Score ?? 0,
            p1_faction: stateObj.p1_faction || stateObj.game?.p1Faction || '',
            p2_faction: stateObj.p2_faction || stateObj.game?.p2Faction || '',
            primary_mission: stateObj.primary_mission || stateObj.game?.primary || '',
            current_round: stateObj.current_round || stateObj.round || 1,
            round: stateObj.round || stateObj.current_round || 1,
            is_finished: false,
            created_at: stateObj.created_at || Date.now()
          });
        }
      }
    }
  } catch (e) {}

  return { active, completed };
}

async function loadMyHubDashboard() {
  const container = document.getElementById('my-hub-content');
  if (!container) return;

  if (!currentUser && (localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || (document.cookie.includes('session_token=')))) {
    if (typeof initAuth === 'function') await initAuth();
  }

  if (!currentUser) {
    window.location.href = '/login?redirect=' + encodeURIComponent('/#my-hub');
    return;
  }

  // 1. Instant optimistic shell render (0ms perceived latency)
  const gs = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const cacheStorageKey = `my_hub_cache_${gs}`;
  let cachedData = (myHubData && myHubData._gameSystem === gs) ? myHubData : null;
  if (!cachedData) {
    try {
      const stored = localStorage.getItem(cacheStorageKey) || (gs === '40k' ? localStorage.getItem('my_hub_cache') : null);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && (!parsed.player_id || parsed.player_id !== 'p_innes')) {
          if (parsed.badge_count !== undefined && parsed.rank) {
            cachedData = parsed;
          } else {
            localStorage.removeItem(cacheStorageKey);
            if (gs === '40k') localStorage.removeItem('my_hub_cache');
          }
        }
      }
      if (cachedData && Array.isArray(cachedData.registered_tournaments)) {
        cachedData.registered_tournaments = cachedData.registered_tournaments.filter(isValidRegisteredTournament);
      }
    } catch (e) {}
  }

  // Ensure local active and completed tracker matches are instantly reflected in optimistic render
  const localInitial = getLocalTrackerSessions(gs);
  if (cachedData) {
    if (Array.isArray(cachedData.active_sessions) && cachedData.active_sessions.length > 1) {
      const serverActiveItems = cachedData.active_sessions.filter(m => {
        const mid = (m.match_id || m.id || '').trim();
        return !mid.startsWith('g-') && !mid.startsWith('game-') && (!mid.startsWith('aos-') || mid.startsWith('AOS-'));
      });
      if (serverActiveItems.length > 0) {
        cachedData.active_sessions = cachedData.active_sessions.filter(m => {
          const mid = (m.match_id || m.id || '').trim();
          const isEphemeral = mid.startsWith('g-') || mid.startsWith('game-') || (mid.startsWith('aos-') && !mid.startsWith('AOS-'));
          if (!isEphemeral) return true;
          const locP1 = (m.p1_name || '').trim().toLowerCase();
          const locP2 = (m.p2_name || '').trim().toLowerCase();
          return !serverActiveItems.some(srv => (srv.p1_name || '').trim().toLowerCase() === locP1 && (srv.p2_name || '').trim().toLowerCase() === locP2);
        });
        cachedData.primary_active = cachedData.active_sessions[0] || null;
        cachedData.unfinished_sessions = cachedData.active_sessions.slice(1);
      }
    }
    if ((!cachedData.active_sessions || cachedData.active_sessions.length === 0) && localInitial.active.length > 0) {
      cachedData.active_sessions = localInitial.active;
      cachedData.primary_active = localInitial.active[0] || null;
      cachedData.unfinished_sessions = localInitial.active.slice(1);
    }
    if ((!cachedData.completed_history || cachedData.completed_history.length === 0) && localInitial.completed.length > 0) {
      cachedData.completed_history = localInitial.completed;
      cachedData.tracker_history = localInitial.completed;
    }
    renderMyHub(cachedData);
  } else if (currentUser) {
    const shell = buildMyHubShellData(currentUser);
    shell.active_sessions = localInitial.active;
    shell.primary_active = localInitial.active[0] || null;
    shell.unfinished_sessions = localInitial.active.slice(1);
    shell.completed_history = localInitial.completed;
    shell.tracker_history = localInitial.completed;
    renderMyHub(shell);
  } else {
    container.innerHTML = `
      <div class="empty-state" style="padding: 3rem 1rem;">
        <div class="spinner"></div>
        <div style="margin-top: 0.75rem;">Loading your personalized competitor hub...</div>
      </div>
    `;
  }

  // 2. Parallel async hydration of dashboard analytics and live tracker sessions
  try {
    const token = window.api ? window.api.getAuthToken() : '';
    const [dashRes, sessRes, regRes] = await Promise.allSettled([
      window.api.getUserDashboard(currentUser.player_id),
      fetch(`/api/tracker/sessions?token=${encodeURIComponent(token)}&game_system=${encodeURIComponent(gs)}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      }).then(r => r.ok ? r.json() : null).catch(() => null),
      (window.api && typeof window.api.getUserRegisteredTournaments === 'function')
        ? window.api.getUserRegisteredTournaments(true)
        : Promise.resolve(null)
    ]);

    if (dashRes.status !== 'fulfilled' || !dashRes.value || dashRes.value.error) {
      throw new Error((dashRes.value && dashRes.value.error) || 'Failed to load competitor data');
    }

    const data = dashRes.value;
    const sessData = (sessRes.status === 'fulfilled' && sessRes.value) ? sessRes.value : null;

    let hidden = [];
    try { hidden = JSON.parse(localStorage.getItem('gt-hidden-matches') || '[]'); } catch (e) {}
    const hiddenSet = new Set(hidden);

    const localFresh = getLocalTrackerSessions(gs);

    const serverActive = (sessData && sessData.success)
      ? (sessData.active_sessions || (sessData.primary_active ? [sessData.primary_active, ...(sessData.unfinished_sessions || [])] : []))
      : [];
    const serverCompleted = (sessData && sessData.success && Array.isArray(sessData.completed_history))
      ? sessData.completed_history
      : [];

    const activeMap = new Map();
    // 1. Authoritative server active sessions
    serverActive.forEach(m => {
      const mid = (m.match_id || m.id || '').trim();
      if (mid && !hiddenSet.has(mid)) activeMap.set(mid, m);
    });

    // 2. Local sessions only if not a duplicate of an active server session
    localFresh.active.forEach(m => {
      const mid = (m.match_id || m.id || '').trim();
      if (!mid || hiddenSet.has(mid)) return;
      if (activeMap.has(mid)) return;

      const isEphemeral = mid.startsWith('g-') || mid.startsWith('game-') || (mid.startsWith('aos-') && !mid.startsWith('AOS-'));
      if (isEphemeral) {
        const locP1 = (m.p1_name || m.game?.p1Name || '').trim().toLowerCase();
        const locP2 = (m.p2_name || m.game?.p2Name || '').trim().toLowerCase();
        const isDupe = Array.from(activeMap.values()).some(srv => {
          const srvP1 = (srv.p1_name || srv.game?.p1Name || '').trim().toLowerCase();
          const srvP2 = (srv.p2_name || srv.game?.p2Name || '').trim().toLowerCase();
          return (srvP1 === locP1 && srvP2 === locP2);
        });
        if (isDupe) {
          try {
            const active40k = JSON.parse(localStorage.getItem('gdm-11e-tracker-state') || '{}');
            if ((active40k.match_id || active40k.id) === mid) {
              localStorage.removeItem('gdm-11e-tracker-state');
            }
          } catch(e) {}
          try {
            const activeAos = JSON.parse(localStorage.getItem('omni-aos-tracker-state') || '{}');
            if ((activeAos.match_id || activeAos.id) === mid) {
              localStorage.removeItem('omni-aos-tracker-state');
            }
          } catch(e) {}
          return;
        }
      }
      activeMap.set(mid, m);
    });

    data.active_sessions = Array.from(activeMap.values());
    data.primary_active = data.active_sessions[0] || null;
    data.unfinished_sessions = data.active_sessions.slice(1);

    const compMap = new Map();
    localFresh.completed.forEach(m => {
      const mid = (m.match_id || m.id || '').trim();
      if (mid && !hiddenSet.has(mid) && !activeMap.has(mid)) compMap.set(mid, m);
    });
    serverCompleted.forEach(m => {
      const mid = (m.match_id || m.id || '').trim();
      if (mid && !hiddenSet.has(mid) && !activeMap.has(mid)) compMap.set(mid, m);
    });

    data.completed_history = Array.from(compMap.values());
    data.tracker_history = data.completed_history;

    if (regRes.status === 'fulfilled' && regRes.value && Array.isArray(regRes.value.tournaments)) {
      data.registered_tournaments = regRes.value.tournaments.filter(isValidRegisteredTournament);
    }

    data._gameSystem = gs;
    myHubData = data;
    try {
      localStorage.setItem(cacheStorageKey, JSON.stringify(data));
      if (gs === '40k') {
        localStorage.setItem('my_hub_cache', JSON.stringify(data));
      }
    } catch (e) {}

    renderMyHub(data);
    if (window.Armory && typeof window.Armory.renderActiveRivalHexBanner === 'function') {
      window.Armory.renderActiveRivalHexBanner('my-hub-content');
    }
    if (window.Armory && typeof window.Armory.checkAndTriggerSignInPokeEffect === 'function') {
      window.Armory.checkAndTriggerSignInPokeEffect(data);
    }
  } catch (err) {
    console.warn("Notice updating competitor hub from server:", err);
    if (!cachedData) {
      container.innerHTML = `<div class="empty-state" style="color:var(--loss);">Error loading competitor hub: ${escapeHtml(err.message)}</div>`;
    }
  }
}

var currentHubSubtab = (typeof window !== 'undefined' && window.currentHubSubtab) || 'active';
if (typeof window !== 'undefined') window.currentHubSubtab = currentHubSubtab;

function switchHubSubtab(tabId) {
  // Map legacy mobile tab names if called
  if (tabId === 'overview' || tabId === 'events') tabId = 'active';
  if (tabId === 'matches') tabId = 'journey';
  if (tabId === 'matrix') tabId = 'matchups';
  if (tabId === 'mastery') tabId = 'factions';

  if (tabId === 'armory') {
    if (window.Armory && typeof window.Armory.openArmoryModal === 'function') {
      window.Armory.openArmoryModal('all', typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
    }
    return;
  }

  currentHubSubtab = tabId || 'active';
  const bar = document.getElementById('hub-subtabs-bar');
  if (bar) {
    bar.querySelectorAll('.profile-subtab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === currentHubSubtab);
    });
  }

  const panels = ['active', 'journey', 'trajectory', 'factions', 'matchups', 'trophies'];
  panels.forEach(id => {
    const el = document.getElementById(`hub-panel-${id}`);
    if (el) {
      el.classList.toggle('active', id === currentHubSubtab);
    }
  });

  if (currentHubSubtab === 'trajectory' && myHubData && myHubData.history) {
    setTimeout(() => renderHubTrajectory(myHubData.history), 20);
  }

  if (currentHubSubtab === 'trophies' && window.BadgesUI && myHubData) {
    const panel = document.getElementById('hub-panel-trophies');
    if (panel) {
      window.BadgesUI.renderTrophyRoom(panel, myHubData, true, myHubData.player && myHubData.player.player_id);
    }
  }
}

function switchHubMobileTab(tab) {
  switchHubSubtab(tab);
}

function resetMyHubToProfile() {
  currentHubSubtab = 'active';

  // 1. Close any open modal dialogs
  if (typeof closeAllModals === 'function') {
    closeAllModals();
  } else if (typeof window.closeAllModals === 'function') {
    window.closeAllModals();
  }

  // 2. Hide subpanels like inspected player profile or event hub
  ['tab-player-profile', 'tab-event-hub'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('active');
      el.style.removeProperty('display');
    }
  });

  // 3. Reset profile inspection pointers
  if (typeof currentProfilePlayerId !== 'undefined') {
    window.currentProfilePlayerId = null;
  }
  if (typeof currentOpenEventId !== 'undefined') {
    window.currentOpenEventId = null;
  }

  // 4. Ensure My Hub panel is active and subtabs switch back to 'active'
  const myHubTab = document.getElementById('tab-my-hub');
  if (myHubTab) {
    myHubTab.classList.add('active');
    myHubTab.style.removeProperty('display');
  }

  const bar = document.getElementById('hub-subtabs-bar');
  if (bar) {
    bar.querySelectorAll('.profile-subtab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === 'active');
    });
  }

  const panels = ['active', 'journey', 'trajectory', 'factions', 'matchups'];
  panels.forEach(id => {
    const el = document.getElementById(`hub-panel-${id}`);
    if (el) {
      el.classList.toggle('active', id === 'active');
    }
  });

  const hubContainer = document.getElementById('my-hub-container');
  if (hubContainer) {
    hubContainer.setAttribute('data-active-tab', 'active');
  }

  // 5. Update URL hash cleanly
  if (window.history && window.history.replaceState) {
    let cleanPath = (window.location.pathname || '').replace(/\/+$/, '');
    if (typeof currentGameSystem !== 'undefined' && currentGameSystem === 'aos') {
      if (!cleanPath.startsWith('/aos')) cleanPath = '/aos';
    } else {
      if (cleanPath.startsWith('/aos')) cleanPath = '';
    }
    window.history.replaceState(null, '', `${cleanPath || '/'}#my-hub`);
  }

  if (typeof syncMobileNavDropdown === 'function') {
    syncMobileNavDropdown();
  }

  // 6. Scroll container and page to top
  const mainEl = document.querySelector('main');
  if (mainEl) mainEl.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

window.switchHubSubtab = switchHubSubtab;
window.switchHubMobileTab = switchHubMobileTab;
window.resetMyHubToProfile = resetMyHubToProfile;

function filterHubHistory(query) {
  const q = (query || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#hub-history-table tbody tr');
  rows.forEach(tr => {
    if (!q) {
      tr.style.display = '';
      return;
    }
    const text = tr.textContent.toLowerCase();
    tr.style.display = text.includes(q) ? '' : 'none';
  });
}

function filterHubMatrix(query) {
  const q = (query || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#hub-matchup-table tbody tr');
  rows.forEach(tr => {
    if (!q) {
      tr.style.display = '';
      return;
    }
    const faction = (tr.getAttribute('data-faction') || tr.textContent).toLowerCase();
    tr.style.display = faction.includes(q) ? '' : 'none';
  });
}

function filterHubFaction(query) {
  const q = (query || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#hub-faction-table tbody tr');
  rows.forEach(tr => {
    if (!q) {
      tr.style.display = '';
      return;
    }
    const faction = (tr.getAttribute('data-faction') || tr.textContent).toLowerCase();
    tr.style.display = faction.includes(q) ? '' : 'none';
  });
}

window.switchHubMobileTab = switchHubMobileTab;
window.filterHubHistory = filterHubHistory;
window.filterHubMatrix = filterHubMatrix;
window.filterHubFaction = filterHubFaction;

function filterHubRegisteredEvents(query) {
  const q = (query || '').trim().toLowerCase();
  const items = document.querySelectorAll('#hub-registered-events-list .hub-event-item-card');
  items.forEach(el => {
    if (!q) {
      el.style.display = '';
      return;
    }
    const text = el.textContent.toLowerCase();
    el.style.display = text.includes(q) ? '' : 'none';
  });
}
window.filterHubRegisteredEvents = filterHubRegisteredEvents;

function computeDaysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  const diffTime = target.setHours(0,0,0,0) - now.setHours(0,0,0,0);
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

function getCountdownBadge(dateStr, endDateStr) {
  const days = computeDaysUntil(dateStr);
  if (days === null) return '';
  if (days < 0) {
    const endDays = computeDaysUntil(endDateStr);
    if (endDays !== null && endDays >= 0) {
      return `<span class="badge" style="background: rgba(16,185,129,0.2); color: #10b981; font-size: 0.7rem; padding: 2px 7px; border: 1px solid rgba(16,185,129,0.4);">🟢 In Progress</span>`;
    }
    return `<span class="badge" style="background: rgba(100,116,139,0.2); color: #94a3b8; font-size: 0.7rem; padding: 2px 7px;">Concluded</span>`;
  }
  if (days === 0) {
    return `<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171; font-size: 0.7rem; padding: 2px 7px; border: 1px solid rgba(239,68,68,0.4); font-weight: 700;">🔥 Starts Today</span>`;
  }
  if (days === 1) {
    return `<span class="badge" style="background: rgba(245,158,11,0.2); color: #fbbf24; font-size: 0.7rem; padding: 2px 7px; border: 1px solid rgba(245,158,11,0.4); font-weight: 700;">⏳ Tomorrow</span>`;
  }
  if (days <= 7) {
    return `<span class="badge" style="background: rgba(56,189,248,0.2); color: #38bdf8; font-size: 0.7rem; padding: 2px 7px; border: 1px solid rgba(56,189,248,0.4); font-weight: 700;">⚡ In ${days} days</span>`;
  }
  return `<span class="badge" style="background: rgba(255,255,255,0.06); color: #cbd5e1; font-size: 0.7rem; padding: 2px 7px; font-family: var(--font-mono);">In ${days} days</span>`;
}

function renderRegisteredTournamentsCard(tournaments, isBcpConnected) {
  const events = (tournaments || []).filter(isValidRegisteredTournament);
  
  if (!isBcpConnected) {
    return `
      <div class="hub-card" id="hub-registered-tournaments-card" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">📅 Registered Tournaments</h3>
            </div>
          </div>
          <div style="background: rgba(56, 189, 248, 0.05); border: 1px dashed rgba(56, 189, 248, 0.3); border-radius: 12px; padding: 1.75rem 1.25rem; text-align: center;">
            <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔗</div>
            <h4 style="color: #fff; font-size: 1rem; font-weight: 700; margin: 0 0 0.4rem 0;">Connect Best Coast Pairings</h4>
            <p style="color: var(--text-secondary); font-size: 0.82rem; margin: 0 0 1rem 0; line-height: 1.4;">
              Link your BCP account to automatically sync tournaments you are playing in, track army list submission deadlines, and view roster countdowns.
            </p>
            <button class="bcp-login-btn" onclick="openBcpLinkModal()" style="padding: 0.5rem 1.2rem; font-size: 0.82rem; font-weight: 700;">
              <span>🔗</span> Connect BCP Account
            </button>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="hub-card" id="hub-registered-tournaments-card" style="display: flex; flex-direction: column; justify-content: space-between;">
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">📅 Registered Tournaments</h3>
            ${events.length > 0 ? `<span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 0.72rem; padding: 0.15rem 0.5rem;">${events.length} Active</span>` : ''}
          </div>
          <button id="hub-bcp-sync-btn" onclick="syncBcpRegisteredTournaments()" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.7rem; display: inline-flex; align-items: center; gap: 0.35rem;" title="Refresh tournament registrations and status from Best Coast Pairings">
            <span id="hub-bcp-sync-icon">🔄</span> Refresh
          </button>
        </div>

        ${events.length > 0 ? `
          <div style="margin-bottom: 0.75rem;">
            <input type="text" class="hub-search-input" placeholder="🔍 Filter registered tournaments..." oninput="filterHubRegisteredEvents(this.value)">
          </div>
          <div id="hub-registered-events-list" class="hub-events-scroll-container">
            ${events.map(ev => {
              const evId = ev.bcp_event_id || ev.id || '';
              const evName = ev.event_name || ev.name || 'Tournament';
              const bcpUrl = ev.bcp_url || `https://www.bestcoastpairings.com/event/${encodeURIComponent(evId)}`;
              const evDate = ev.event_date || ev.start_date || '';
              const dateDisplay = (evDate ? evDate.substring(0, 10) : 'TBD');
              const countdownPill = getCountdownBadge(evDate, ev.end_date);
              const locationStr = [ev.venue_name, ev.city, ev.state].filter(Boolean).join(' • ') || 'Location TBD';
              const hasList = !!(ev.has_list_submitted || ev.army_list || ev.army_list_name);
              const listStatus = hasList
                ? `<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-size: 0.7rem; padding: 2px 7px;">✅ List Submitted</span>`
                : `<span class="badge" style="background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); font-size: 0.7rem; padding: 2px 7px;">⚠️ List Pending</span>`;

              const isCheckedIn = !!ev.checked_in;
              const isDropped = !!ev.dropped;
              let checkinStatus = '';
              if (isDropped) {
                checkinStatus = `<span class="badge" style="background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); font-size: 0.7rem; padding: 2px 7px;">🚫 Dropped</span>`;
              } else if (isCheckedIn) {
                checkinStatus = `<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-size: 0.7rem; padding: 2px 7px;">✅ Checked In</span>`;
              } else {
                checkinStatus = `<span class="badge" style="background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); font-size: 0.7rem; padding: 2px 7px;">⚠️ Not Checked In</span>`;
              }
              const isEnded = Boolean(
                ev.ended === true ||
                ev.is_ended === true ||
                ev.status?.ended === true ||
                ev.raw_json?.ended === true ||
                ev.raw_json?.isEnded === true ||
                ev.raw_json?.status?.ended === true
              );

              return `
                <div class="hub-event-item-card" style="cursor: pointer;" onclick="openEventModal('${encodeURIComponent(evId)}', true)">
                  <div class="hub-event-header">
                    <div style="min-width: 0; flex: 1;">
                      <span class="hub-event-title">
                        ${escapeHtml(evName)}
                      </span>
                    </div>
                    <div style="flex-shrink: 0; display: flex; align-items: center; gap: 0.35rem;">
                      ${checkinStatus}
                      ${countdownPill}
                    </div>
                  </div>

                  <div class="hub-event-meta">
                    <span>📅 <b>${escapeHtml(dateDisplay)}</b></span>
                    <span>📍 ${escapeHtml(locationStr)}</span>
                    ${ev.points_limit ? `<span>⚔️ ${ev.points_limit} pts</span>` : ''}
                    ${ev.rounds ? `<span>• ${ev.rounds} Rounds</span>` : ''}
                  </div>

                  <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.4rem; padding-top: 0.2rem; border-top: 1px solid rgba(255,255,255,0.05);">
                    <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                      <span style="font-size: 0.75rem; color: #fff;">
                        🛡️ <b>${escapeHtml(ev.faction || 'Army Unassigned')}</b>
                        ${ev.detachment ? `<span style="color: var(--text-muted);"> (${escapeHtml(ev.detachment)})</span>` : ''}
                      </span>
                      ${listStatus}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div style="padding: 2rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
            <div style="font-size: 1.5rem; margin-bottom: 0.4rem;">📅</div>
            <div style="font-weight: 600; color: #cbd5e1; margin-bottom: 0.25rem;">No registered tournaments found on BCP</div>
            <div style="font-size: 0.78rem; margin-bottom: 0.75rem;">When you register for tournaments on Best Coast Pairings, they will automatically sync here!</div>
            <button onclick="syncBcpRegisteredTournaments()" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.35rem 0.8rem;">
              🔄 Refresh Registrations
            </button>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderNextEventOverviewPreview(tournaments, isBcpConnected) {
  if (!isBcpConnected) {
    return `
      <div id="hub-overview-events-preview" class="hub-card" style="border-color: rgba(56,189,248,0.25); background: rgba(56,189,248,0.03);">
        <div style="font-size: 0.72rem; color: #38bdf8; font-weight: 800; font-family: var(--font-mono); margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
          <span>📅 REGISTERED TOURNAMENTS</span>
          <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 0.68rem; padding: 0.1rem 0.4rem;">BCP Sync</span>
        </div>
        <p style="color: var(--text-secondary); font-size: 0.8rem; margin: 0 0 8px 0;">
          Connect your BCP account to track upcoming tournaments and roster deadlines.
        </p>
        <button class="hub-view-all-btn" onclick="openBcpLinkModal()" style="margin-top: 4px;">
          <span>🔗 Connect BCP Account</span>
          <span class="hub-btn-arrow">➔</span>
        </button>
      </div>
    `;
  }

  const events = (tournaments || []).filter(isValidRegisteredTournament).filter(e => {
    const dStr = e.event_date || e.start_date;
    const days = computeDaysUntil(dStr);
    return days === null || days >= 0 || (computeDaysUntil(e.end_date) || 0) >= 0;
  });

  if (events.length === 0) return '<div id="hub-overview-events-preview" style="display:none;"></div>';

  const nextEv = events[0];
  const evId = nextEv.bcp_event_id || nextEv.id || '';
  const evName = nextEv.event_name || nextEv.name || 'Tournament';
  const evDate = nextEv.event_date || nextEv.start_date || '';
  const countdownPill = getCountdownBadge(evDate, nextEv.end_date);
  const dateStr = evDate ? evDate.substring(0, 10) : 'Upcoming';
  const venueStr = [nextEv.venue_name, nextEv.city].filter(Boolean).join(' • ') || 'Tournament';
  const hasList = !!(nextEv.has_list_submitted || nextEv.army_list || nextEv.army_list_name);

  return `
    <div id="hub-overview-events-preview" class="hub-card" style="border-color: rgba(56,189,248,0.3); background: rgba(56,189,248,0.04);">
      <div style="font-size: 0.72rem; color: #38bdf8; font-weight: 800; font-family: var(--font-mono); margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
        <span>📅 NEXT REGISTERED TOURNAMENT</span>
        ${countdownPill}
      </div>
      <div>
        <b style="color: #fff; font-size: 0.95rem; cursor: pointer;" onclick="openEventModal('${encodeURIComponent(evId)}', true)">
          ${escapeHtml(evName)}
        </b>
        <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 3px;">
          📅 ${escapeHtml(dateStr)} • 📍 ${escapeHtml(venueStr)}
        </div>
        <div style="display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap;">
          <span style="font-size: 0.74rem; color: #fff;">🛡️ <b>${escapeHtml(nextEv.faction || 'Army Unassigned')}</b></span>
          ${hasList 
            ? `<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; font-size: 0.68rem; padding: 1px 6px;">✅ List Submitted</span>`
            : `<span class="badge" style="background: rgba(245,158,11,0.15); color: #fbbf24; font-size: 0.68rem; padding: 1px 6px;">⚠️ List Pending</span>`}
          ${nextEv.dropped
            ? `<span class="badge" style="background: rgba(239,68,68,0.15); color: #ef4444; font-size: 0.68rem; padding: 1px 6px;">🚫 Dropped</span>`
            : (nextEv.checked_in
              ? `<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; font-size: 0.68rem; padding: 1px 6px;">✅ Checked In</span>`
              : `<span class="badge" style="background: rgba(245,158,11,0.15); color: #fbbf24; font-size: 0.68rem; padding: 1px 6px;">⚠️ Not Checked In</span>`)}
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem; margin-top: 8px;">
        <button class="hub-view-all-btn" style="flex: 1; margin-top: 0;" onclick="switchHubMobileTab('events')">
          <span>View All Registered Tournaments (${events.length})</span>
          <span class="hub-btn-arrow">➔</span>
        </button>
      </div>
    </div>
  `;
}

async function syncBcpRegisteredTournaments() {
  const btn = document.getElementById('hub-bcp-sync-btn');
  const icon = document.getElementById('hub-bcp-sync-icon');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span id="hub-bcp-sync-icon" style="display:inline-block; animation:spin 0.8s linear infinite;">🔄</span> Refreshing...';
  }

  try {
    const res = await window.api.syncUserRegisteredTournaments();
    if (res && res.success) {
      if (typeof showNotification === 'function') {
        showNotification(`Refreshed ${res.count || 0} registered tournament(s)`, 'success');
      }
      const tournaments = (res.tournaments || []).filter(isValidRegisteredTournament);
      if (myHubData) {
        myHubData.registered_tournaments = tournaments;
        try {
          localStorage.setItem('my_hub_cache', JSON.stringify(myHubData));
        } catch (e) {}
      }
      const cardContainer = document.getElementById('hub-registered-tournaments-card');
      if (cardContainer) {
        cardContainer.outerHTML = renderRegisteredTournamentsCard(tournaments, true);
      }
      const previewContainer = document.getElementById('hub-overview-events-preview');
      if (previewContainer) {
        previewContainer.outerHTML = renderNextEventOverviewPreview(tournaments, true);
      }
    } else {
      if (typeof showNotification === 'function') {
        showNotification((res && res.message) || 'Failed to refresh tournaments', 'warning');
      }
    }
  } catch (e) {
    if (typeof showNotification === 'function') {
      showNotification('Notice: ' + e.message, 'warning');
    }
  } finally {
    const updatedBtn = document.getElementById('hub-bcp-sync-btn');
    if (updatedBtn) {
      updatedBtn.disabled = false;
      updatedBtn.innerHTML = '<span id="hub-bcp-sync-icon">🔄</span> Refresh';
    }
  }
}
window.syncBcpRegisteredTournaments = syncBcpRegisteredTournaments;

// Listen for registration/check-in changes from Event Modal or other views to auto-refresh registered tournaments
window.addEventListener('tournaments-updated', () => {
  try {
    localStorage.removeItem('my_hub_cache');
    if (typeof myHubData !== 'undefined' && myHubData) {
      myHubData = null;
    }
  } catch (e) {}
  if (typeof syncBcpRegisteredTournaments === 'function' && document.getElementById('hub-registered-tournaments-card')) {
    syncBcpRegisteredTournaments();
  }
});


function renderMyHub(data) {
  const container = document.getElementById('my-hub-content');
  if (!container || !data) return;

  const p = data.player || {};
  const rankings = data.rankings || {};
  const history = data.history || [];
  const factionMastery = typeof computeProfileFactionMastery === 'function'
    ? computeProfileFactionMastery(history, data.faction_mastery || data.factions_breakdown)
    : (data.faction_mastery || []);
  const matchups = typeof computeProfileMatchupMatrix === 'function'
    ? computeProfileMatchupMatrix(history, data.matchup_matrix)
    : (data.matchup_matrix || []);
  const upcoming = data.upcoming_events || [];
  const registeredTournaments = data.registered_tournaments || [];
  const totalHistoryMatches = history.length;
  const totalFactionGames = factionMastery.reduce((acc, f) => acc + (Number(f.games) || 0), 0);
  const totalMatchupGames = matchups.reduce((acc, m) => acc + (Number(m.total_encounters) || 0), 0);
  const unrecordedFactionGames = Math.max(0, totalHistoryMatches - totalFactionGames);
  const unrecordedMatchupGames = Math.max(0, totalHistoryMatches - totalMatchupGames);

  const activeMatches = (data.active_sessions && Array.isArray(data.active_sessions))
    ? data.active_sessions
    : [data.primary_active, ...(data.unfinished_sessions || [])].filter(Boolean);

  const currentEloNum = Number(p.current_elo || 1500.0);
  const peakEloNum = Number(p.peak_elo || currentEloNum);
  const currentElo = currentEloNum.toFixed(1);
  const peakElo = peakEloNum.toFixed(1);
  const winRate = Number(p.win_rate || 0.0).toFixed(1);
  const totalMatches = Number(p.matches_played || (Number(p.wins || 0) + Number(p.losses || 0) + Number(p.draws || 0)) || 0);
  const isBcpConnected = !!((currentUser && (currentUser.bcp_connected || currentUser.bcp_user_id || currentUser.bcp_token || currentUser.bcp_email)) || (p && p.is_bcp_connected));
  const bcpEmail = (currentUser && currentUser.bcp_email) || (p && p.bcp_email) || '';
  const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
  const sysLabel = sys === 'aos' ? 'Age of Sigmar' : 'Warhammer 40K';

  const competitorName = (currentUser && currentUser.display_name && currentUser.display_name.trim() !== '' && currentUser.display_name.toLowerCase() !== 'competitor')
    ? currentUser.display_name
    : (p.player_name && p.player_name.toLowerCase() !== 'competitor'
        ? p.player_name
        : (currentUser && currentUser.display_name) || (currentUser && currentUser.email ? currentUser.email.split('@')[0] : 'Competitor'));

  const playerIdForActions = p.player_id || (currentUser && currentUser.player_id) || competitorName;

  const tier = typeof getEloTier === 'function' ? getEloTier(currentEloNum, totalMatches, sys) : {
    name: 'Veteran', shortName: 'Veteran', icon: '⚔️', badgeClass: 'tier-veteran',
    themeClass: 'tier-theme-emerald', progressPercent: 50, isUncalibrated: false,
    matchesPlayed: totalMatches, matchesNeeded: 0, isApex: false, nextTier: null, minElo: 1500
  };

  // Compute Peak Streak & Current Streak from history
  let peakStreak = Number(p.peak_streak || p.streak || 0);
  let currentStreak = 0;
  if (history.length > 0) {
    let tempStreak = 0;
    history.forEach(m => {
      if (m.result === 'W') {
        tempStreak++;
        if (tempStreak > peakStreak) peakStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    });
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].result === 'W') currentStreak++;
      else break;
    }
  }

  // Build Milestone XP Bar or Calibration Bar
  let xpSectionHtml = '';
  if (tier.isUncalibrated) {
    xpSectionHtml = `
      <div class="profile-xp-section">
        <div class="profile-xp-header">
          <span>🎯 Calibration Status: ${tier.matchesPlayed} of 5 Matches Completed</span>
          <span style="font-family: var(--font-mono); color: var(--accent);">${tier.progressPercent}%</span>
        </div>
        <div class="profile-xp-track">
          <div class="profile-xp-fill" style="width: ${tier.progressPercent}%;"></div>
        </div>
        <div class="profile-xp-footer">
          <span>Play ${tier.matchesNeeded} more tournament match${tier.matchesNeeded === 1 ? '' : 'es'} to calibrate official rank</span>
          <span>Target: Veteran (1500.0)</span>
        </div>
      </div>
    `;
  } else if (tier.isApex) {
    xpSectionHtml = `
      <div class="profile-xp-section">
        <div class="profile-xp-header">
          <span>👑 Everchosen Apex Milestone</span>
          <span style="color: #fbbf24; font-weight: 700;">Rank Pinnacle Achieved</span>
        </div>
        <div class="profile-xp-track">
          <div class="profile-xp-fill" style="width: 100%;"></div>
        </div>
        <div class="profile-xp-footer">
          <span>2400.0+ Top Tier Bracket</span>
          <span>Sovereign Mastery</span>
        </div>
      </div>
    `;
  } else if (tier.nextTier) {
    xpSectionHtml = `
      <div class="profile-xp-section">
        <div class="profile-xp-header">
          <span>⚔️ Next Elo Tier: <strong style="color:#fff;">${escapeHtml(tier.nextTier.name)}</strong></span>
          <span style="font-family: var(--font-mono); color: var(--accent); font-weight: 700;">${tier.nextTier.ptsNeeded} Elo needed</span>
        </div>
        <div class="profile-xp-track">
          <div class="profile-xp-fill" style="width: ${tier.progressPercent}%;"></div>
        </div>
        <div class="profile-xp-footer">
          <span>${tier.minElo}.0 Elo (${escapeHtml(tier.name)})</span>
          <span>${tier.nextTier.targetElo}.0 Elo (${escapeHtml(tier.nextTier.name)}) · ${tier.progressPercent}%</span>
        </div>
      </div>
    `;
  }

  // Sort matches newest-first deterministically
  const sortedHistory = typeof sortMatchesNewestFirst === 'function'
    ? sortMatchesNewestFirst(history)
    : history.slice().reverse();

  // Recent Form Beads (Latest 8 matches, newest on left)
  let recentFormHtml = '';
  if (sortedHistory.length > 0) {
    const recentMatches = sortedHistory.slice(0, 8);
    const beads = recentMatches.map(m => {
      const res = m.result === 'W' ? 'form-win' : (m.result === 'L' ? 'form-loss' : 'form-draw');
      const score = m.player_score !== undefined && m.opponent_score !== undefined ? `${m.player_score}-${m.opponent_score}` : m.result;
      const tooltip = `vs ${escapeHtml(m.opponent_name || 'Opponent')} (${m.event_name || 'Event'})`;
      return `<span class="form-bead ${res}" title="${tooltip}">${m.result} ${score}</span>`;
    }).join('');

    recentFormHtml = `
      <div class="profile-recent-form">
        <span style="font-size: 0.76rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em; margin-right: 0.25rem;">
          Recent Form:
        </span>
        ${beads}
        ${currentStreak >= 3 ? `<span style="font-size: 0.78rem; font-weight: 700; color: #fb923c; margin-left: 0.4rem;">🔥 ${currentStreak}-Match Streak</span>` : ''}
      </div>
    `;
  }

  // Top Factions pills
  const topFactionsHtml = factionMastery.slice(0, 3).map((f, i) => {
    return `<span class="faction-pill" title="${escapeHtml(f.faction)} (${f.games} matches)">#${i+1} ${escapeHtml(f.faction)} <strong style="color:var(--text-main); margin-left:2px;">${f.games}G</strong></span>`;
  }).join(' ');

  // Build Tournament Journey Accordion for My Hub (defaulted to collapsed all, newest event first)
  const hubEventsMap = new Map();
  sortedHistory.forEach(m => {
    const evKey = m.event_id || m.event_name || 'Tournament Match';
    if (!hubEventsMap.has(evKey)) {
      hubEventsMap.set(evKey, {
        event_id: m.event_id || '',
        event_name: m.event_name || 'Tournament Match',
        date: (m.match_date || m.event_date || '').substring(0, 10),
        faction: m.player_faction || p.top_faction || '',
        wins: 0,
        losses: 0,
        draws: 0,
        totalEloDelta: 0,
        rounds: []
      });
    }
    const ev = hubEventsMap.get(evKey);
    if (m.result === 'W') ev.wins++;
    else if (m.result === 'L') ev.losses++;
    else ev.draws++;
    ev.totalEloDelta += Number(m.delta_elo || 0);
    ev.rounds.push(m);
  });
  const hubEventsList = Array.from(hubEventsMap.values()).sort((a, b) => {
    const dA = a.date || '';
    const dB = b.date || '';
    if (dA !== dB) return dB.localeCompare(dA);
    return 0;
  });

  let hubEventsAccordionHtml = '';
  if (hubEventsList.length === 0) {
    hubEventsAccordionHtml = `
      <div class="empty-state" style="padding: 1.5rem 1rem;">
        <div style="font-size: 1.25rem; margin-bottom: 0.35rem;">📜</div>
        <div style="font-weight: 600; color: var(--text-secondary); font-size: 0.85rem;">No recorded tournament matches in ${sysLabel}</div>
      </div>
    `;
  } else {
    hubEventsAccordionHtml = hubEventsList.map((ev, idx) => {
      const isExpanded = false; // Default collapsed all
      const recordStr = `${ev.wins}W - ${ev.losses}L${ev.draws > 0 ? ` - ${ev.draws}D` : ''}`;
      const isFlawless = (ev.losses === 0 && ev.wins >= 3);
      const eloDelta = ev.totalEloDelta;
      const eloSign = eloDelta > 0 ? `+${eloDelta.toFixed(1)}` : eloDelta.toFixed(1);
      const eloColor = eloDelta > 0 ? 'var(--win)' : (eloDelta < 0 ? 'var(--loss)' : 'var(--text-muted)');

      const roundsRows = ev.rounds.map((r, rIdx) => {
        const isWin = r.result === 'W';
        const isLoss = r.result === 'L';
        const isBye = Boolean(r.is_bye || (r.opponent_name && r.opponent_name.toUpperCase() === 'BYE'));
        const resColor = isWin ? 'var(--win)' : (isLoss ? 'var(--loss)' : 'var(--draw)');
        const delta = Number(r.delta_elo || 0);
        const deltaStr = delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
        const deltaColor = delta > 0 ? 'var(--win)' : (delta < 0 ? 'var(--loss)' : 'var(--text-muted)');
        const scoreStr = (r.player_score !== undefined && r.opponent_score !== undefined) ? `${r.player_score} - ${r.opponent_score}` : '-';
        const oppBadge = !isBye && r.opponent_elo
          ? (typeof renderEloBadgePill === 'function' ? renderEloBadgePill(r.opponent_elo, null, { size: 'sm', gameSystem: sys }) : `<span class="badge">${Number(r.opponent_elo).toFixed(1)}</span>`)
          : '';

        return `
          <tr>
            <td class="col-rnd" style="font-family: var(--font-mono); font-weight: 700; color: var(--text-secondary);">R${r.round || (ev.rounds.length - rIdx)}</td>
            <td class="col-opp">
              ${isBye ? '<span class="bye-pill">🛡️ TOURNAMENT BYE</span>' : `
                <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                  <span class="player-link" style="font-weight: 600; color: #38bdf8; cursor: pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(r.opponent_id || '')}', '${escapeHtml(r.opponent_name || 'Opponent')}')" title="Quick scout ${escapeHtml(r.opponent_name || 'Opponent')}">${escapeHtml(r.opponent_name || 'Opponent')}</span>
                  ${oppBadge}
                </div>
                ${r.opponent_faction ? `<div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 1px;">${escapeHtml(r.opponent_faction)}</div>` : ''}
              `}
            </td>
            <td class="col-res" style="font-family: var(--font-mono); font-weight: 700; color: ${resColor};">${r.result || '-'}</td>
            <td class="col-score" style="font-family: var(--font-mono); white-space: nowrap;">${scoreStr}</td>
            <td class="col-delta" style="font-family: var(--font-mono); font-weight: 700; color: ${deltaColor}; text-align: right; white-space: nowrap;">${deltaStr}</td>
          </tr>
        `;
      }).join('');

      return `
        <div class="profile-event-card ${isExpanded ? 'expanded' : ''}" id="hub-event-card-${idx}">
          <div class="profile-event-header" onclick="toggleProfileEventCard(${idx}, '#hub-events-accordion-container', 'btn-hub-toggle-all-events')">
            <div class="profile-event-title-group">
              <div class="profile-event-name">
                ${ev.event_id ? `
                  <span class="player-link" style="color: #38bdf8; cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem;" onclick="event.stopPropagation(); openEventModal('${escapeHtml(ev.event_id)}')" title="Click to view Tournament Standings & Details">
                    <span>${escapeHtml(ev.event_name)}</span>
                    <span style="font-size: 0.72rem; opacity: 0.85;">↗</span>
                  </span>
                ` : `<span>${escapeHtml(ev.event_name)}</span>`}
                ${isFlawless ? '<span class="badge" style="background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3); font-size:0.68rem; margin-left:0.35rem; white-space:nowrap;">🥇 Flawless</span>' : ''}
              </div>
              <div class="profile-event-sub">
                <span>${ev.date || 'Event Record'}</span>
                ${ev.faction ? `<span>· 🛡️ ${escapeHtml(ev.faction)}</span>` : ''}
              </div>
            </div>
            <div class="profile-event-stats">
              <span style="font-family: var(--font-mono); font-weight: 700; font-size: 0.86rem; white-space: nowrap;">${recordStr}</span>
              <span style="font-family: var(--font-mono); font-weight: 800; font-size: 0.86rem; color: ${eloColor}; min-width: 50px; text-align: right; white-space: nowrap;">${eloSign}</span>
              <span class="profile-event-chevron">▼</span>
            </div>
          </div>
          <div class="profile-event-body">
            <table class="profile-rounds-table">
              <thead>
                <tr>
                  <th class="col-rnd">Rnd</th>
                  <th class="col-opp">Opponent</th>
                  <th class="col-res">Res</th>
                  <th class="col-score">Score</th>
                  <th class="col-delta" style="text-align: right;">Elo Δ</th>
                </tr>
              </thead>
              <tbody>
                ${roundsRows}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');
  }

  let html = `
    <div id="my-hub-container" class="my-hub-container" data-active-tab="${currentHubSubtab || 'active'}">
      <!-- Upgraded 16-Tier Competitor Hero Card with Military Rank Border -->
      <div class="profile-hero-card ${tier.themeClass || ''} ${(data.rank && data.rank.css_class) || ''}" style="margin-bottom: 1.25rem;">
        <div class="profile-hero-top">
          <div class="profile-identity-group">
            <div class="profile-rank-crest" title="${escapeHtml(tier.name)}" data-default-icon="${escapeHtml(tier.icon)}">
              <span class="hero-crest-default-icon">${tier.icon}</span>
              <span class="hero-avatar-sigil-slot" style="display: none;"></span>
            </div>
            <div class="profile-name-meta">
              <div class="profile-badges-row">
                <h1 class="profile-name-title">${escapeHtml(competitorName)}</h1>
                <span class="hero-title-badge-slot" style="display: none;"></span>
                ${p.player_name && p.player_name !== competitorName && p.player_name.toLowerCase() !== 'competitor' ? `<span style="font-size: 0.8rem; color: #94a3b8; font-weight: 500;">(Ranked as: ${escapeHtml(p.player_name)})</span>` : ''}
                ${rankings.global_rank ? `<span class="tier-badge tier-S" style="font-size: 0.78rem; padding: 0.15rem 0.55rem;">World #${rankings.global_rank}</span>` : ''}
                ${rankings.faction_rank ? `<span class="tier-badge tier-A" style="font-size: 0.78rem; padding: 0.15rem 0.55rem;">${escapeHtml(p.top_faction || '')} #${rankings.faction_rank}</span>` : ''}
              </div>
              <div class="profile-badges-row" style="margin-top: 0.15rem;">
                ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(currentEloNum, totalMatches, { showTierName: true, size: 'lg', gameSystem: sys }) : `<span class="badge">${currentElo} Elo</span>`}
                ${Number(peakElo) <= Number(currentEloNum) + 0.5
                  ? `<span class="profile-standing-badge" style="background:rgba(251,191,36,0.12); color:#fbbf24; border:1px solid rgba(251,191,36,0.35); font-weight:700;" title="Currently standing at all-time career peak Elo rating (${currentElo})!">All-Time Peak 👑</span>`
                  : `<span class="profile-standing-badge" title="All-Time Peak Rating: ${peakElo}">Peak: ${peakElo} 👑</span>`
                }
                ${window.BadgesUI ? window.BadgesUI.renderRankBadge(data, 'switchHubSubtab') : ''}
                ${p.team ? `<span class="badge" style="background:rgba(168,85,247,0.12); color:#c084fc; border:1px solid rgba(168,85,247,0.25); cursor:pointer;" onclick="switchTab('teams'); if(typeof loadTeamsView==='function') loadTeamsView('${escapeHtml(p.team)}');" title="Click to open ${escapeHtml(p.team)} Team Hub">🛡️ ${escapeHtml(p.team)} ➔</span>` : `<span class="badge" style="background:rgba(255,255,255,0.06); color:#94a3b8; border:1px solid rgba(255,255,255,0.12); cursor:pointer;" onclick="switchTab('teams')" title="Find or join a team">⚔️ Independent &bull; Join Club ➔</span>`}
              </div>
              <div style="color: var(--text-secondary); font-size: 0.82rem; margin-top: 0.45rem; display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  Primary Army: <b style="color: var(--accent);">${escapeHtml(typeof formatPlayerFaction === 'function' ? formatPlayerFaction(p.top_faction || (window.connectState?.userProfile?.factions) || 'General (Any Army)', 2) : (p.top_faction || 'General (Any Army)'))}</b>
                  <button onclick="openUserSettingsModal()" style="background: transparent; border: none; color: #38bdf8; font-size: 0.74rem; cursor: pointer; text-decoration: underline; font-weight: 600; padding: 0 2px;" title="Set your primary army and sparring preferences">✏️ Edit</button>
                </span>
                ${isBcpConnected ? `
                  <span class="badge badge-win" style="font-size: 0.72rem; padding: 0.18rem 0.55rem; display: inline-flex; align-items: center; gap: 0.3rem;">
                    <span>✅ BCP Linked:</span> <b>${escapeHtml(bcpEmail || 'Active')}</b>
                  </span>
                  <button onclick="handleDisconnectBcp()" style="background:transparent; border:none; color:var(--text-muted); font-size:0.72rem; text-decoration:underline; cursor:pointer;">Unlink</button>
                ` : `
                  <button class="bcp-login-btn" style="padding: 0.2rem 0.65rem; font-size: 0.72rem;" onclick="openBcpLinkModal()">
                    <span>🔗</span> Connect Best Coast Pairings
                  </button>
                `}
              </div>
              ${window.BadgesUI ? window.BadgesUI.renderPinnedMedals(data.pinned_badges, data.badge_count, true, 'switchHubSubtab') : ''}
            </div>
          </div>

          <div class="profile-hero-actions">
            <button type="button" class="btn btn-primary" onclick="openPlayerProfilePage('${escapeHtml(playerIdForActions)}', '${sys}')" style="font-weight: 700; font-size: 0.82rem; padding: 0.45rem 0.9rem;">
              ↗ Public Profile
            </button>
            <button type="button" class="btn btn-outline" onclick="copyPlayerProfileLink('${escapeHtml(playerIdForActions)}', '${sys}')" title="Copy shareable link to your public profile" style="font-weight: 600; font-size: 0.82rem; padding: 0.45rem 0.85rem;">
              🔗 Share Profile
            </button>
          </div>
        </div>

        <!-- Collapsible Career Progression & Full Stats for Mobile -->
        <button type="button" id="hub-career-toggle-btn" class="hub-career-toggle-btn mobile-only" onclick="toggleHubCareerDetails()" aria-expanded="false">
          <span style="display:inline-flex; align-items:center; gap:6px;">
            <span>📊</span>
            <span id="hub-career-toggle-text">Show Full Stats &amp; Progression</span>
          </span>
          <span id="hub-career-toggle-arrow">▼</span>
        </button>

        <div id="hub-career-details-drawer" class="hub-career-drawer-collapsed">
          <!-- Key Metrics Grid -->
          <div class="profile-metrics-grid" style="margin-top: 0.75rem;">
            <div class="profile-metric-box">
              <div class="m-lbl">Record</div>
              <div class="m-val" style="font-size: 1.05rem;">
                <span style="color:var(--win);">${p.wins || 0}W</span> - <span style="color:var(--loss);">${p.losses || 0}L</span>${(p.draws || 0) > 0 ? ` - <span style="color:var(--draw);">${p.draws}D</span>` : ''}
              </div>
            </div>
            <div class="profile-metric-box">
              <div class="m-lbl">Win Rate</div>
              <div class="m-val" style="color: ${Number(winRate) >= 60 ? 'var(--win)' : (Number(winRate) >= 45 ? 'var(--accent)' : '#fff')};">
                ${winRate}%
              </div>
            </div>
            <div class="profile-metric-box">
              <div class="m-lbl">Matches</div>
              <div class="m-val">${totalMatches}</div>
            </div>
            <div class="profile-metric-box">
              <div class="m-lbl">Peak Streak</div>
              <div class="m-val" style="color: var(--win);">${peakStreak} Wins</div>
            </div>
            <div class="profile-metric-box" style="grid-column: span 2;">
              <div class="m-lbl">Top Armies</div>
              <div style="margin-top: 0.25rem; display: flex; gap: 0.35rem; justify-content: center; flex-wrap: wrap;">
                ${topFactionsHtml || `<span style="color:var(--text-muted); font-size:0.8rem;">${escapeHtml(p.top_faction || 'Various')}</span>`}
              </div>
            </div>
          </div>

          <!-- Milestone XP Progress Bar -->
          ${xpSectionHtml}

          <!-- Recent Form Beads -->
          ${recentFormHtml}
        </div>
      </div>



    <!-- Desktop, Tablet & Mobile Sub-Tab Navigation Bar -->
    <div class="profile-subtabs-bar" id="hub-subtabs-bar">
      <button type="button" class="profile-subtab-btn ${currentHubSubtab === 'active' ? 'active' : ''}" data-tab="active" onclick="switchHubSubtab('active')">
        <span>⚡ Active & Rosters</span>
        <span class="profile-subtab-count">${(activeMatches.length || 0) + (registeredTournaments.length || 0)}</span>
      </button>
      <button type="button" class="profile-subtab-btn ${currentHubSubtab === 'journey' ? 'active' : ''}" data-tab="journey" onclick="switchHubSubtab('journey')">
        <span>🏆 <span class="tab-label-full">Tournament </span>Journey</span>
        <span class="profile-subtab-count">${hubEventsList.length}</span>
      </button>
      <button type="button" class="profile-subtab-btn ${currentHubSubtab === 'trajectory' ? 'active' : ''}" data-tab="trajectory" onclick="switchHubSubtab('trajectory')">
        <span>📈 Elo Trajectory</span>
        <span class="profile-subtab-count">${history.length}G</span>
      </button>
      <button type="button" class="profile-subtab-btn ${currentHubSubtab === 'factions' ? 'active' : ''}" data-tab="factions" onclick="switchHubSubtab('factions')">
        <span>🛡️ Faction Mastery</span>
        <span class="profile-subtab-count">${factionMastery.length}</span>
      </button>
      <button type="button" class="profile-subtab-btn ${currentHubSubtab === 'matchups' ? 'active' : ''}" data-tab="matchups" onclick="switchHubSubtab('matchups')">
        <span>🎯 Matchup Matrix</span>
        <span class="profile-subtab-count">${matchups.length}</span>
      </button>
      <button type="button" class="profile-subtab-btn ${currentHubSubtab === 'trophies' ? 'active' : ''}" data-tab="trophies" onclick="switchHubSubtab('trophies')">
        <span>🏆 Trophies</span>
        <span class="profile-subtab-count">${data.badge_count || 0}/${data.total_badges || 105}</span>
      </button>
      <button type="button" class="profile-subtab-btn hub-subtab-armory-btn" data-tab="armory" onclick="switchHubSubtab('armory')">
        <span>🏛️ Armory</span>
        <span class="profile-subtab-count" style="color: #fbbf24; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3);">💰 ${(data.unified_glory || data.glory_balance || 0).toLocaleString()}</span>
      </button>
    </div>

    <!-- TAB PANEL 1: Active Matches, Army Lists & Registered Tournaments -->
    <div id="hub-panel-active" class="profile-tab-panel ${currentHubSubtab === 'active' ? 'active' : ''}">
      <!-- 2-Column Row: Army Lists & Rosters + Registered Tournaments -->
      <div class="hub-grid-2col hub-row-prep">
        <!-- Card: Army Lists & Rosters -->
        <div class="hub-card" id="hub-armylists-card" style="display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">📋 Army Lists & Rosters</h3>
              </div>
              <button class="bcp-login-btn" onclick="openImportArmyListModal()" style="font-size: 0.75rem; padding: 0.3rem 0.75rem; background: var(--accent); color: #0f172a; font-weight: 800;">
                ➕ Import
              </button>
            </div>

            <div id="hub-armylists-list-container" class="hub-armylists-list-container">
              <div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.82rem;">
                <div class="spinner"></div>
                <div style="margin-top: 0.5rem;">Loading your army lists...</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Card: Registered Tournaments (Beside Army Lists) -->
        ${renderRegisteredTournamentsCard(registeredTournaments, isBcpConnected)}
      </div>

      <!-- Full-Width Card: Live Game Tracker & Scorecard History -->
      <div class="hub-row-matches-tracker" style="margin-top: 1.25rem;">
        <div class="hub-card hub-card-tracker">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 0;">🎲 Active Matches & History</h3>
              <span class="badge" style="background: rgba(56,189,248,0.12); color: #38bdf8; font-size: 0.68rem; padding: 0.1rem 0.4rem;">${sys === 'aos' ? 'AoS' : '11th Ed'}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <a href="${(typeof currentGameSystem !== 'undefined' && currentGameSystem === 'aos') ? '/11th/tracker/aos' : '/11th/tracker'}" target="_blank" style="font-size: 0.75rem; color: var(--accent); text-decoration: none; font-weight: 600;">Game Tracker ➔</a>
            </div>
          </div>

          <!-- Active Matches (All in Green Cards) -->
          ${(activeMatches && activeMatches.length > 0) ? `
            <div style="margin-bottom: 14px;">
              <div style="font-size: 0.72rem; color: #10b981; font-weight: 800; font-family: var(--font-mono); margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px;">
                <span>🟢 ACTIVE MATCHES (${activeMatches.length})</span>
                <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: normal;">⏳ Uncompleted games auto-purge after 14 days</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 10px;">
                ${activeMatches.map(m => {
                  const mid = m.match_id || m.id || '';
                  const shortId = mid.replace('WH40K-', '').replace('AOS-', '');
                  const rNum = m.round || m.current_round || 1;
                  const createdDate = m.created_at || m.date || m.timestamp;
                  const dateLabel = createdDate ? new Date(createdDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Recent';
                  const isAosMatch = (m.game_system === 'aos' || mid.startsWith('AOS-') || sys === 'aos');
                  const resumeUrl = isAosMatch ? `/11th/tracker/aos?match_id=${encodeURIComponent(mid)}` : `/11th/tracker/play?match_id=${encodeURIComponent(mid)}`;
                  const p1 = m.p1_name || (m.game && m.game.p1Name) || 'Player 1';
                  const p2 = m.p2_name || (m.game && m.game.p2Name) || 'Player 2';
                  const p1Score = m.p1_score ?? m.p1Score ?? (m.p1 && m.p1.score) ?? 0;
                  const p2Score = m.p2_score ?? m.p2Score ?? (m.p2 && m.p2.score) ?? 0;
                  const p1Fac = m.p1_faction || (m.game && m.game.p1Faction) || 'Army 1';
                  const p2Fac = m.p2_faction || (m.game && m.game.p2Faction) || 'Army 2';
                  const mission = m.primary_mission || (m.game && (m.game.primary || m.game.primaryMission)) || '';
                  return `
                    <div style="background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.3); border-radius: 12px; padding: 12px 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);">
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 4px;">
                        <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.72rem; font-weight: 800; color: #10b981; text-transform: uppercase; font-family: var(--font-mono);">
                          <span style="width: 7px; height: 7px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
                          🟢 Active Match (Round ${rNum})
                        </span>
                        <span style="font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono);">#${escapeHtml(shortId)} • 📅 Created ${dateLabel}</span>
                      </div>
                      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                        <div>
                          <b style="color: #fff; font-size: 0.88rem;">${escapeHtml(p1)} (${p1Score}) <span style="color: var(--text-muted); font-weight: normal;">vs</span> ${escapeHtml(p2)} (${p2Score})</b>
                          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px;">
                            ${escapeHtml(p1Fac)} vs ${escapeHtml(p2Fac)}
                            ${mission ? ` • 🎯 ${escapeHtml(mission)}` : ''}
                          </div>
                        </div>
                        <div style="display: flex; gap: 6px; align-items: center;">
                          <a href="${resumeUrl}" target="_blank" class="btn btn-sm btn-primary" style="font-size: 0.75rem; padding: 5px 12px; text-decoration: none; font-weight: 700;">
                            ▶️ Resume Match
                          </a>
                          ${!(String(mid).toUpperCase().startsWith('BCP-') || String(mid).toUpperCase().startsWith('ES-') || m.event_id || m.tournament_id) ? `
                            <button onclick="discardTrackerSession('${escapeHtml(mid)}')" style="background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; padding: 5px 8px; font-size: 0.75rem; cursor: pointer; font-weight: 700;" title="Discard / Abandon Casual Match">
                              🗑️
                            </button>
                          ` : ''}
                        </div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Verified Match History / Completed Scorecards -->
          ${(data.completed_history && data.completed_history.length > 0) ? `
            <div class="hub-table-wrapper" style="margin-top: 10px;">
              <table id="hub-tracker-history-table" class="hub-table">
                <thead>
                  <tr>
                    <th style="width: 75px;">Match</th>
                    <th style="width: 48%;">Players / Armies</th>
                    <th style="width: 65px; text-align: center;">Score</th>
                    <th style="width: 80px; text-align: right;">Scorecard</th>
                  </tr>
                </thead>
                <tbody>
                  ${data.completed_history.map(th => {
                    const p1 = th.p1_name || 'Player 1';
                    const p2 = th.p2_name || 'Player 2';
                    const p1Score = th.p1_score || 0;
                    const p2Score = th.p2_score || 0;
                    const matchId = th.match_id || '';
                    const shortId = matchId.replace('WH40K-', '');
                    const dateStr = th.date || (th.updated_at ? th.updated_at.substring(5, 10) : '-');

                    return `
                      <tr>
                        <td style="white-space: nowrap;">
                          <a href="/scorecard/${encodeURIComponent(matchId)}" target="_blank" style="font-family:var(--font-mono); font-size:0.75rem; font-weight:700; color:var(--accent); text-decoration:none;">
                            #${escapeHtml(shortId)} ↗
                          </a>
                          <div style="font-size:0.7rem; color:var(--text-muted);">${dateStr}</div>
                        </td>
                        <td class="cell-ellipsis">
                          <div style="color:#fff; font-size:0.8rem; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${escapeHtml(p1)} <span style="color:var(--text-muted); font-weight:normal;">vs</span> ${escapeHtml(p2)}
                          </div>
                          <div style="font-size:0.7rem; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${escapeHtml(th.p1_faction || 'Army 1')} vs ${escapeHtml(th.p2_faction || 'Army 2')}
                          </div>
                        </td>
                        <td style="text-align: center;">
                          <span style="font-weight:700; color:#38bdf8; font-family:var(--font-mono); font-size:0.85rem;">${p1Score} - ${p2Score}</span>
                        </td>
                        <td style="text-align: right;">
                          <a href="/scorecard/${encodeURIComponent(matchId)}" target="_blank" style="display:inline-flex; align-items:center; gap:3px; background:rgba(16,185,129,0.15); color:#10b981; font-size:0.7rem; font-weight:700; padding:0.2rem 0.5rem; border-radius:6px; text-decoration:none; border:1px solid rgba(16,185,129,0.3);">
                            📄 Scorecard ↗
                          </a>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          ` : (activeMatches.length === 0 && (!data.completed_history || data.completed_history.length === 0)) ? `
            <div style="padding: 2.25rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
              <div style="font-size: 1.05rem; margin-bottom: 0.35rem;">🎲 No Live Game Tracker matches logged.</div>
              <div style="font-size: 0.78rem; margin-bottom: 0.75rem;">Track live games with automated scoring & real-time sync!</div>
              <a href="${(typeof currentGameSystem !== 'undefined' && currentGameSystem === 'aos') ? '/11th/tracker/aos' : '/11th/tracker'}" target="_blank" class="bcp-login-btn" style="text-decoration:none; display:inline-block; font-size:0.8rem; padding:0.4rem 0.9rem;">+ Open Game Tracker</a>
            </div>
          ` : ''}
        </div>
      </div>
    </div>

    <!-- TAB PANEL 2: Tournament Journey Accordion -->
    <div id="hub-panel-journey" class="profile-tab-panel ${currentHubSubtab === 'journey' ? 'active' : ''}">
      <div class="hub-card hub-fullwidth-journey profile-journey-section">
        <div class="profile-journey-header">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <h3 class="profile-journey-title" style="font-size: 1.05rem;">
              <span>🏆 My Tournament Journey</span>
              <span class="profile-journey-count">(${hubEventsList.length} Event${hubEventsList.length === 1 ? '' : 's'})</span>
            </h3>
            <span class="profile-journey-subtitle">
              Official tournament history ordered newest first • Click any event title to open Tournament Standings
            </span>
          </div>
          ${hubEventsList.length > 0 ? `
            <button type="button" id="btn-hub-toggle-all-events" class="btn btn-outline btn-sm" onclick="toggleAllProfileEventCards('#hub-events-accordion-container', 'btn-hub-toggle-all-events')" style="font-size: 0.76rem; padding: 0.32rem 0.75rem; border-color: rgba(56,189,248,0.35); color: #38bdf8; background: rgba(56,189,248,0.08); font-weight: 700; white-space: nowrap;">
              ▼ Expand All
            </button>
          ` : ''}
        </div>

        <div id="hub-events-accordion-container">
          ${hubEventsAccordionHtml}
        </div>
      </div>
    </div>

    <!-- TAB PANEL 3: Career Elo Trajectory -->
    <div id="hub-panel-trajectory" class="profile-tab-panel ${currentHubSubtab === 'trajectory' ? 'active' : ''}">
      <div class="hub-card trajectory-card" style="padding: 1.25rem;">
        <div class="trajectory-header-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.75rem;">
          <div>
            <h3 style="font-size: 1.1rem; font-weight: 800; color: #fff; margin: 0;">📈 Career Elo Rating Trajectory</h3>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
              Match-by-match rating progression across ${history.length} official games in ${sysLabel}
            </div>
          </div>
          <div class="trajectory-stats-row" style="display: flex; gap: 0.65rem; flex-wrap: wrap;">
            <div class="trajectory-stat-pill" style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.4rem 0.75rem;">
              <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">Current Elo</div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 800; color: #38bdf8;">${currentElo}</div>
            </div>
            <div class="trajectory-stat-pill" style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.4rem 0.75rem;">
              <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">All-Time Peak</div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 800; color: #fbbf24;">${peakElo} 👑</div>
            </div>
            <div class="trajectory-stat-pill" style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.4rem 0.75rem;">
              <div style="font-size: 0.68rem; color: var(--text-muted); text-transform: uppercase;">Net Career Δ</div>
              <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 800; color: ${(currentEloNum - 1500) >= 0 ? 'var(--win)' : 'var(--loss)'};">${(currentEloNum - 1500) >= 0 ? '+' : ''}${(currentEloNum - 1500).toFixed(1)}</div>
            </div>
          </div>
        </div>
        <div class="trajectory-chart-box" style="background: rgba(10, 14, 23, 0.65); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 1rem; overflow-x: auto;">
          <svg id="hub-trajectory-svg" style="width: 100%; height: 220px; display: block;"></svg>
        </div>
        <div class="trajectory-legend-row" style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem; font-size: 0.75rem; color: var(--text-muted); flex-wrap: wrap; gap: 0.5rem;">
          <span>Tap or hover any data point to inspect match details & rating delta</span>
          <div style="display: flex; align-items: center; gap: 0.85rem;">
            <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span> Win</span>
            <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></span> Loss</span>
            <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #38bdf8;"></span> Starting / Draw</span>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB PANEL 4: Faction Mastery -->
    <div id="hub-panel-factions" class="profile-tab-panel ${currentHubSubtab === 'factions' ? 'active' : ''}">
      ${data._isSkeleton
        ? '<div class="hub-card" style="padding:2rem; text-align:center; color:var(--text-muted);"><div class="spinner"></div><div style="margin-top:0.5rem; font-size:0.8rem;">Loading faction data...</div></div>'
        : (typeof renderFactionMasteryTabContent === 'function'
            ? renderFactionMasteryTabContent(factionMastery, 'hub-faction-table', 'filterHubFaction')
            : '')}
    </div>

    <!-- TAB PANEL 5: Matchup Matrix -->
    <div id="hub-panel-matchups" class="profile-tab-panel ${currentHubSubtab === 'matchups' ? 'active' : ''}">
      ${data._isSkeleton
        ? '<div class="hub-card" style="padding:2rem; text-align:center; color:var(--text-muted);"><div class="spinner"></div><div style="margin-top:0.5rem; font-size:0.8rem;">Loading matchup data...</div></div>'
        : (typeof renderMatchupMatrixTabContent === 'function'
            ? renderMatchupMatrixTabContent(matchups, history, 'hub-matchup-table', 'filterHubMatrix')
            : '')}
    </div>

    <!-- TAB PANEL 6: Trophies & Battle Honors -->
    <div id="hub-panel-trophies" class="profile-tab-panel ${currentHubSubtab === 'trophies' ? 'active' : ''}">
      <!-- Dynamically populated by window.BadgesUI -->
    </div>

  </div> <!-- /my-hub-container -->
  `;

  container.innerHTML = html;

  // Apply active equipped armory decorations (frames, sigil avatar, titles)
  if (window.Armory && typeof window.Armory.applyEquippedDecorations === 'function') {
    window.Armory.applyEquippedDecorations();
  }

  // Render SVG Trajectory & Load Army Lists
  renderHubTrajectory(history);
  loadHubArmyLists();

  // If trophies subtab is active, render Trophy Room immediately
  if (currentHubSubtab === 'trophies' && window.BadgesUI) {
    const trophyPanel = document.getElementById('hub-panel-trophies');
    if (trophyPanel) {
      window.BadgesUI.renderTrophyRoom(trophyPanel, data, true, data.player && data.player.player_id);
    }
  }

  // Check for one-time career commendation celebration (batches all historical honors with zero popup spam)
  if (window.BadgesUI && typeof window.BadgesUI.checkFirstTimeCelebration === 'function') {
    var celebrantId = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.id || currentUser.player_id) : 'guest';
    window.BadgesUI.checkFirstTimeCelebration(data, celebrantId);
  }
}

function renderHubTrajectory(history) {
  if (typeof renderProfileTrajectoryChart === 'function') {
    renderProfileTrajectoryChart(history, 'hub-trajectory-svg');
  }
}


/* ==========================================================================
   MATCHUP SPOTLIGHTS (FAVORITE PREY & NEMESIS ARMY)
   ========================================================================== */

/**
 * Computes Favorite Prey and Nemesis Army with sample size qualification,
 * career win rate differential, and streak tracking.
 */
function computeMatchupSpotlights(matchups, history, careerWinRate) {
  if (!matchups || matchups.length === 0) {
    return { prey: null, nemesis: null };
  }

  const careerRate = Number(careerWinRate || 0);

  function getFactionStreak(factionName, hist) {
    if (!hist || hist.length === 0 || !factionName) return null;
    const fLower = factionName.trim().toLowerCase();
    const matchesAgainst = [];
    for (let i = hist.length - 1; i >= 0; i--) {
      const h = hist[i];
      const oppFaction = (h.opponent_faction || h.enemy_faction || '').trim().toLowerCase();
      if (oppFaction === fLower) {
        matchesAgainst.push(h);
      }
    }
    if (matchesAgainst.length === 0) return null;

    const firstRes = matchesAgainst[0].result;
    if (firstRes !== 'W' && firstRes !== 'L' && firstRes !== 'D') return null;

    let count = 0;
    for (const m of matchesAgainst) {
      if (m.result === firstRes) count++;
      else break;
    }

    if (firstRes === 'W') {
      return { type: 'win', count, shortText: `🔥 ${count}W`, fullText: count >= 2 ? `🔥 ${count}W Streak` : `🔥 Won last` };
    } else if (firstRes === 'L') {
      return { type: 'loss', count, shortText: `💀 ${count}L`, fullText: count >= 2 ? `💀 ${count}L Streak` : `💀 Lost last` };
    } else {
      return { type: 'draw', count, shortText: `🤝 Draw`, fullText: `🤝 Drawn last` };
    }
  }

  function formatSpotlight(m) {
    if (!m) return null;
    const wr = Number(m.win_rate || 0);
    const diff = wr - careerRate;
    const sign = diff > 0 ? '+' : '';
    const diffText = `${sign}${diff.toFixed(1)}% vs avg`;
    const streak = getFactionStreak(m.enemy_faction, history);

    return {
      faction: m.enemy_faction,
      encounters: Number(m.total_encounters) || 0,
      wins: Number(m.wins) || 0,
      losses: Number(m.losses) || 0,
      draws: Number(m.draws) || 0,
      winRate: wr.toFixed(1),
      diff,
      diffText,
      streak,
      recordText: `${m.wins}W - ${m.losses}L${m.draws ? ` - ${m.draws}D` : ''}`
    };
  }

  // Single opponent army edge case
  if (matchups.length === 1) {
    const single = matchups[0];
    const wr = Number(single.win_rate || 0);
    const spot = formatSpotlight(single);

    if (wr >= 50) {
      return { prey: spot, nemesis: null };
    } else {
      return { prey: null, nemesis: spot };
    }
  }

  const totalGames = matchups.reduce((sum, m) => sum + (Number(m.total_encounters) || 0), 0);

  // Dynamic sample threshold:
  // >= 15 total games -> require >= 3 encounters
  // >= 5 total games -> require >= 2 encounters
  // < 5 total games -> require >= 1 encounter
  let minGames = 3;
  if (totalGames < 5) minGames = 1;
  else if (totalGames < 15) minGames = 2;

  let qualified = matchups.filter(m => (Number(m.total_encounters) || 0) >= minGames);
  // Graceful degradation if threshold excludes too many opponents
  if (qualified.length < 2 && minGames > 1) {
    qualified = matchups.filter(m => (Number(m.total_encounters) || 0) >= (minGames - 1));
  }
  if (qualified.length === 0) {
    qualified = matchups.slice();
  }

  // 1. Best Matchup (Favorite Prey)
  // Must have wins > 0
  const preyPool = qualified.filter(m => (Number(m.wins) || 0) > 0);
  let bestCandidate = null;
  if (preyPool.length > 0) {
    preyPool.sort((a, b) => {
      const wrDiff = Number(b.win_rate || 0) - Number(a.win_rate || 0);
      if (Math.abs(wrDiff) > 0.01) return wrDiff;
      const encDiff = (Number(b.total_encounters) || 0) - (Number(a.total_encounters) || 0);
      if (encDiff !== 0) return encDiff;
      return (Number(b.wins) || 0) - (Number(a.wins) || 0);
    });
    bestCandidate = preyPool[0];
  } else {
    // Fallback across all matchups if qualified had 0 wins
    const anyPrey = matchups.filter(m => (Number(m.wins) || 0) > 0);
    if (anyPrey.length > 0) {
      anyPrey.sort((a, b) => (Number(b.win_rate || 0) - Number(a.win_rate || 0)) || ((Number(b.total_encounters) || 0) - (Number(a.total_encounters) || 0)));
      bestCandidate = anyPrey[0];
    }
  }

  // 2. Worst Matchup (Nemesis Army)
  // Exclude bestCandidate
  let nemesisPool = qualified.filter(m => {
    if (bestCandidate && m.enemy_faction === bestCandidate.enemy_faction) {
      return false;
    }
    return (Number(m.losses) || 0) > 0;
  });

  let worstCandidate = null;
  if (nemesisPool.length > 0) {
    nemesisPool.sort((a, b) => {
      const wrDiff = Number(a.win_rate || 0) - Number(b.win_rate || 0);
      if (Math.abs(wrDiff) > 0.01) return wrDiff;
      const encDiff = (Number(b.total_encounters) || 0) - (Number(a.total_encounters) || 0);
      if (encDiff !== 0) return encDiff;
      return (Number(b.losses) || 0) - (Number(a.losses) || 0);
    });
    worstCandidate = nemesisPool[0];
  } else {
    const anyNemesis = matchups.filter(m => {
      if (bestCandidate && m.enemy_faction === bestCandidate.enemy_faction) {
        return false;
      }
      return (Number(m.losses) || 0) > 0;
    });
    if (anyNemesis.length > 0) {
      anyNemesis.sort((a, b) => (Number(a.win_rate || 0) - Number(b.win_rate || 0)) || ((Number(b.total_encounters) || 0) - (Number(a.total_encounters) || 0)));
      worstCandidate = anyNemesis[0];
    }
  }

  return {
    prey: formatSpotlight(bestCandidate),
    nemesis: formatSpotlight(worstCandidate)
  };
}

/**
 * Renders the compact 50/50 Favorite Prey and Nemesis Army cards.
 */
function renderMatchupSpotlightCards(spotlights) {
  if (!spotlights) return '';
  const { prey, nemesis } = spotlights;
  if (!prey && !nemesis) return '';

  const preyHtml = prey ? `
    <div class="hub-spotlight-card spotlight-prey" data-spotlight-target="${escapeHtml(prey.faction)}" onclick="highlightMatchupRow(this.getAttribute('data-spotlight-target'))" role="button" tabindex="0" title="Click to locate ${escapeHtml(prey.faction)} in table">
      <div class="spotlight-header">
        <span class="spotlight-badge prey-badge">
          <span>🎯</span> <span class="badge-label-long">FAVORITE PREY</span><span class="badge-label-short">PREY</span>
        </span>
        ${prey.streak ? `
          <span class="spotlight-streak streak-${prey.streak.type}" title="${escapeHtml(prey.streak.fullText)}">
            <span class="streak-long">${escapeHtml(prey.streak.fullText)}</span>
            <span class="streak-short">${escapeHtml(prey.streak.shortText)}</span>
          </span>` : ''}
      </div>
      <div class="spotlight-body">
        <div class="spotlight-faction-name" title="${escapeHtml(prey.faction)}">${escapeHtml(prey.faction)}</div>
        <div class="spotlight-rate text-win">${prey.winRate}%</div>
      </div>
      <div class="spotlight-footer">
        <span class="spotlight-record">${prey.recordText}</span>
        <span class="spotlight-diff ${prey.diff >= 0 ? 'text-win' : 'text-loss'}">${prey.diff > 0 ? '+' : ''}${prey.diff.toFixed(1)}%<span class="diff-label"> vs avg</span></span>
      </div>
    </div>
  ` : `
    <div class="hub-spotlight-card spotlight-prey spotlight-empty" style="cursor: default; opacity: 0.75;">
      <div class="spotlight-header">
        <span class="spotlight-badge prey-badge">
          <span>🎯</span> <span class="badge-label-long">FAVORITE PREY</span><span class="badge-label-short">PREY</span>
        </span>
      </div>
      <div class="spotlight-body" style="align-items: center; justify-content: center;">
        <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">No Prey Yet</div>
      </div>
      <div class="spotlight-footer" style="justify-content: center;">
        <span style="font-size: 0.68rem; color: var(--text-secondary);">Log wins to unlock</span>
      </div>
    </div>
  `;

  const nemesisHtml = nemesis ? `
    <div class="hub-spotlight-card spotlight-nemesis" data-spotlight-target="${escapeHtml(nemesis.faction)}" onclick="highlightMatchupRow(this.getAttribute('data-spotlight-target'))" role="button" tabindex="0" title="Click to locate ${escapeHtml(nemesis.faction)} in table">
      <div class="spotlight-header">
        <span class="spotlight-badge nemesis-badge">
          <span>⚡</span> <span class="badge-label-long">NEMESIS ARMY</span><span class="badge-label-short">NEMESIS</span>
        </span>
        ${nemesis.streak ? `
          <span class="spotlight-streak streak-${nemesis.streak.type}" title="${escapeHtml(nemesis.streak.fullText)}">
            <span class="streak-long">${escapeHtml(nemesis.streak.fullText)}</span>
            <span class="streak-short">${escapeHtml(nemesis.streak.shortText)}</span>
          </span>` : ''}
      </div>
      <div class="spotlight-body">
        <div class="spotlight-faction-name" title="${escapeHtml(nemesis.faction)}">${escapeHtml(nemesis.faction)}</div>
        <div class="spotlight-rate text-loss">${nemesis.winRate}%</div>
      </div>
      <div class="spotlight-footer">
        <span class="spotlight-record">${nemesis.recordText}</span>
        <span class="spotlight-diff ${nemesis.diff >= 0 ? 'text-win' : 'text-loss'}">${nemesis.diff > 0 ? '+' : ''}${nemesis.diff.toFixed(1)}%<span class="diff-label"> vs avg</span></span>
      </div>
    </div>
  ` : `
    <div class="hub-spotlight-card spotlight-nemesis spotlight-empty" style="cursor: default; opacity: 0.75;">
      <div class="spotlight-header">
        <span class="spotlight-badge nemesis-badge">
          <span>⚡</span> <span class="badge-label-long">NEMESIS ARMY</span><span class="badge-label-short">NEMESIS</span>
        </span>
      </div>
      <div class="spotlight-body" style="align-items: center; justify-content: center;">
        <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">No Nemesis Yet</div>
      </div>
      <div class="spotlight-footer" style="justify-content: center;">
        <span style="font-size: 0.68rem; color: var(--text-secondary);">Undefeated or more games needed</span>
      </div>
    </div>
  `;

  return `
    <div class="hub-spotlight-grid">
      ${preyHtml}
      ${nemesisHtml}
    </div>
  `;
}

/**
 * Smoothly scrolls to and flashes the selected faction row in the Matchup Matrix table.
 */
function highlightMatchupRow(faction) {
  if (!faction) return;
  const targetName = faction.trim().toLowerCase();
  const table = document.getElementById('hub-matchup-table');
  if (!table) return;

  const rows = table.querySelectorAll('tbody tr');
  let targetRow = null;
  for (const r of rows) {
    const dataFaction = r.getAttribute('data-faction');
    if (dataFaction && dataFaction.trim().toLowerCase() === targetName) {
      targetRow = r;
      break;
    }
    const firstCell = r.querySelector('td:first-child');
    if (firstCell && firstCell.textContent.trim().toLowerCase().includes(targetName)) {
      targetRow = r;
      break;
    }
  }

  if (targetRow) {
    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetRow.classList.remove('row-flash');
    void targetRow.offsetWidth; // trigger reflow
    targetRow.classList.add('row-flash');
    setTimeout(() => {
      targetRow.classList.remove('row-flash');
    }, 2200);
  }
}
window.highlightMatchupRow = highlightMatchupRow;


/* ==========================================================================
   FACTION MASTERY SPOTLIGHTS & INTEL
   ========================================================================== */

/**
 * Computes Primary Main and Secondary / Pocket Pick for Faction Mastery card.
 */
function computeFactionMasterySpotlights(factionMastery, history, careerWinRate) {
  if (!factionMastery || factionMastery.length === 0) {
    return null;
  }

  const careerRate = Number(careerWinRate || 0);

  function getArmyStreak(factionName, hist) {
    if (!hist || hist.length === 0 || !factionName) return null;
    const fLower = factionName.trim().toLowerCase();
    const myMatches = [];
    for (let i = hist.length - 1; i >= 0; i--) {
      const h = hist[i];
      const pFac = (h.player_faction || h.faction || '').trim().toLowerCase();
      if (pFac === fLower) {
        myMatches.push(h);
      }
    }
    if (myMatches.length === 0) return null;

    const firstRes = myMatches[0].result;
    if (firstRes !== 'W' && firstRes !== 'L' && firstRes !== 'D') return null;

    let count = 0;
    for (const m of myMatches) {
      if (m.result === firstRes) count++;
      else break;
    }

    if (firstRes === 'W') {
      return { type: 'win', count, shortText: `🔥 ${count}W`, fullText: count >= 2 ? `🔥 ${count}W Streak` : `🔥 Won last` };
    } else if (firstRes === 'L') {
      return { type: 'loss', count, shortText: `💀 ${count}L`, fullText: count >= 2 ? `💀 ${count}L Streak` : `💀 Lost last` };
    } else {
      return { type: 'draw', count, shortText: `🤝 Draw`, fullText: `🤝 Drawn last` };
    }
  }

  const primary = factionMastery[0];
  const pWr = Number(primary.win_rate || 0);
  const pDiff = pWr - careerRate;
  const pStreak = getArmyStreak(primary.faction, history);

  const primarySpot = {
    faction: primary.faction,
    games: primary.games,
    winRate: pWr.toFixed(1),
    diff: pDiff,
    recordText: `${primary.wins}W - ${primary.losses}L`,
    streak: pStreak
  };

  let secondarySpot = null;
  if (factionMastery.length > 1) {
    const sec = factionMastery[1];
    const sWr = Number(sec.win_rate || 0);
    const sDiff = sWr - careerRate;
    const sStreak = getArmyStreak(sec.faction, history);
    secondarySpot = {
      faction: sec.faction,
      games: sec.games,
      winRate: sWr.toFixed(1),
      diff: sDiff,
      recordText: `${sec.wins}W - ${sec.losses}L`,
      streak: sStreak
    };
  }

  return { primary: primarySpot, secondary: secondarySpot };
}

/**
 * Renders the compact 50/50 Primary Main and Secondary / Pocket Pick spotlight cards.
 */
function renderFactionMasterySpotlightCards(spotlights) {
  if (!spotlights || !spotlights.primary) return '';
  const { primary, secondary } = spotlights;

  const primaryHtml = `
    <div class="hub-spotlight-card spotlight-main" data-spotlight-target="${escapeHtml(primary.faction)}" onclick="highlightFactionRow(this.getAttribute('data-spotlight-target'))" role="button" tabindex="0" title="Click to locate ${escapeHtml(primary.faction)} in table">
      <div class="spotlight-header">
        <span class="spotlight-badge main-badge">
          <span>👑</span> <span class="badge-label-long">PRIMARY MAIN</span><span class="badge-label-short">MAIN</span>
        </span>
        ${primary.streak ? `
          <span class="spotlight-streak streak-${primary.streak.type}" title="${escapeHtml(primary.streak.fullText)}">
            <span class="streak-long">${escapeHtml(primary.streak.fullText)}</span>
            <span class="streak-short">${escapeHtml(primary.streak.shortText)}</span>
          </span>` : ''}
      </div>
      <div class="spotlight-body">
        <div class="spotlight-faction-name" title="${escapeHtml(primary.faction)}">${escapeHtml(primary.faction)}</div>
        <div class="spotlight-rate text-win">${primary.winRate}%</div>
      </div>
      <div class="spotlight-footer">
        <span class="spotlight-record">${primary.recordText}</span>
        <span class="spotlight-diff ${primary.diff >= 0 ? 'text-win' : 'text-loss'}">${primary.diff > 0 ? '+' : ''}${primary.diff.toFixed(1)}%<span class="diff-label"> vs avg</span></span>
      </div>
    </div>
  `;

  const secondaryHtml = secondary ? `
    <div class="hub-spotlight-card spotlight-secondary" data-spotlight-target="${escapeHtml(secondary.faction)}" onclick="highlightFactionRow(this.getAttribute('data-spotlight-target'))" role="button" tabindex="0" title="Click to locate ${escapeHtml(secondary.faction)} in table">
      <div class="spotlight-header">
        <span class="spotlight-badge secondary-badge">
          <span>🗡️</span> <span class="badge-label-long">POCKET PICK</span><span class="badge-label-short">PICK</span>
        </span>
        ${secondary.streak ? `
          <span class="spotlight-streak streak-${secondary.streak.type}" title="${escapeHtml(secondary.streak.fullText)}">
            <span class="streak-long">${escapeHtml(secondary.streak.fullText)}</span>
            <span class="streak-short">${escapeHtml(secondary.streak.shortText)}</span>
          </span>` : `<span class="spotlight-streak streak-win">${secondary.games} Games</span>`}
      </div>
      <div class="spotlight-body">
        <div class="spotlight-faction-name" title="${escapeHtml(secondary.faction)}">${escapeHtml(secondary.faction)}</div>
        <div class="spotlight-rate ${Number(secondary.winRate) >= 50 ? 'text-win' : 'text-loss'}">${secondary.winRate}%</div>
      </div>
      <div class="spotlight-footer">
        <span class="spotlight-record">${secondary.recordText}</span>
        <span class="spotlight-diff ${secondary.diff >= 0 ? 'text-win' : 'text-loss'}">${secondary.diff > 0 ? '+' : ''}${secondary.diff.toFixed(1)}%<span class="diff-label"> vs avg</span></span>
      </div>
    </div>
  ` : `
    <div class="hub-spotlight-card spotlight-secondary" style="cursor: default; opacity: 0.85;">
      <div class="spotlight-header">
        <span class="spotlight-badge" style="background: rgba(168,85,247,0.16); color: #c084fc; border: 1px solid rgba(168,85,247,0.35);">
          <span>🛡️</span> <span class="badge-label-long">MONO FACTION</span><span class="badge-label-short">LOYAL</span>
        </span>
      </div>
      <div class="spotlight-body">
        <div class="spotlight-faction-name">Specialist</div>
        <div class="spotlight-rate" style="color: #c084fc;">100%</div>
      </div>
      <div class="spotlight-footer">
        <span class="spotlight-record">Single Army Focus</span>
        <span class="spotlight-diff" style="color: var(--text-muted);">Dedicated</span>
      </div>
    </div>
  `;

  return `
    <div class="hub-spotlight-grid">
      ${primaryHtml}
      ${secondaryHtml}
    </div>
  `;
}

/**
 * Smoothly scrolls to and flashes the selected faction row in the Faction Mastery table.
 */
function highlightFactionRow(faction) {
  if (!faction) return;
  const targetName = faction.trim().toLowerCase();
  const table = document.getElementById('hub-faction-table');
  if (!table) return;

  const rows = table.querySelectorAll('tbody tr');
  let targetRow = null;
  for (const r of rows) {
    const dataFaction = r.getAttribute('data-faction');
    if (dataFaction && dataFaction.trim().toLowerCase() === targetName) {
      targetRow = r;
      break;
    }
    const firstCell = r.querySelector('td:first-child');
    if (firstCell && firstCell.textContent.trim().toLowerCase().includes(targetName)) {
      targetRow = r;
      break;
    }
  }

  if (targetRow) {
    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetRow.classList.remove('row-flash');
    void targetRow.offsetWidth; // trigger reflow
    targetRow.classList.add('row-flash');
    setTimeout(() => {
      targetRow.classList.remove('row-flash');
    }, 2200);
  }
}
window.highlightFactionRow = highlightFactionRow;

/**
 * Computes recent form and tournament milestones for the player's primary army.
 */
function computeFactionIntel(primaryFaction, history, eventsAttended) {
  if (!primaryFaction) return null;
  const pLower = primaryFaction.trim().toLowerCase();

  // 1. Recent form with primary army
  const myMatches = (history || []).filter(h => {
    const fac = (h.player_faction || h.faction || '').trim().toLowerCase();
    return fac === pLower;
  });

  if (myMatches.length === 0) return null;

  const recent = myMatches.slice(-10);
  const rWins = recent.filter(m => m.result === 'W').length;
  const rLosses = recent.filter(m => m.result === 'L').length;
  const rDraws = recent.filter(m => m.result === 'D').length;
  const rWinRate = ((rWins * 100) / Math.max(1, recent.length)).toFixed(1);

  // 2. Best tournament outing with this faction (minimum 3 games)
  let bestEvent = null;
  const qualifiedEvents = (eventsAttended || []).filter(e => {
    const eFac = (e.registered_faction || '').trim().toLowerCase();
    return (eFac === pLower || (!eFac && myMatches.length > 0)) && (Number(e.matches_played) || 0) >= 3;
  });

  if (qualifiedEvents.length > 0) {
    qualifiedEvents.sort((a, b) => {
      const aWr = (Number(a.wins) || 0) / Math.max(1, Number(a.matches_played) || 1);
      const bWr = (Number(b.wins) || 0) / Math.max(1, Number(b.matches_played) || 1);
      if (Math.abs(bWr - aWr) > 0.01) return bWr - aWr;
      return (Number(b.wins) || 0) - (Number(a.wins) || 0);
    });
    bestEvent = qualifiedEvents[0];
  }

  return {
    faction: primaryFaction,
    recentCount: recent.length,
    recentWins: rWins,
    recentLosses: rLosses,
    recentDraws: rDraws,
    recentWinRate: rWinRate,
    recentMatches: recent,
    bestEvent: bestEvent
  };
}

/**
 * Renders the mini-dashboard milestone grid below the Faction Mastery table.
 */
function renderFactionIntelPanel(intel) {
  if (!intel) return '';

  const pillsHtml = intel.recentMatches.map(m => {
    const res = (m.result || 'W').toUpperCase();
    const cls = res === 'W' ? 'form-dot-w' : (res === 'L' ? 'form-dot-l' : 'form-dot-d');
    const dateStr = (m.match_date || '').slice(0, 10);
    const opp = m.opponent_name || 'Opponent';
    return `<span class="form-dot ${cls}" title="${res} vs ${escapeHtml(opp)} (${dateStr})">${res}</span>`;
  }).join('');

  const bestEventHtml = intel.bestEvent ? `
    <div class="hub-milestone-panel">
      <div class="milestone-label">🏆 BEST TOURNAMENT OUTING</div>
      <div class="milestone-title" title="${escapeHtml(intel.bestEvent.event_name)}">${escapeHtml(intel.bestEvent.event_name)}</div>
      <div class="milestone-desc">
        <b style="color:var(--win); font-family:var(--font-mono);">${intel.bestEvent.wins}W – ${intel.bestEvent.losses}L</b>
        ${intel.bestEvent.draws ? ` – <span style="color:var(--draw);">${intel.bestEvent.draws}D</span>` : ''}
        · <span style="color:#fff;">${escapeHtml(intel.faction)}</span>
      </div>
    </div>
  ` : `
    <div class="hub-milestone-panel">
      <div class="milestone-label">🏆 CAREER MILESTONE</div>
      <div class="milestone-title">${escapeHtml(intel.faction)} Veteran</div>
      <div class="milestone-desc">${intel.recentWins + intel.recentLosses} verified matches recorded</div>
    </div>
  `;

  return `
    <div class="hub-milestone-grid">
      <div class="hub-milestone-panel">
        <div class="milestone-label">📈 RECENT FORM (${escapeHtml(intel.faction)})</div>
        <div class="milestone-title">Last ${intel.recentCount} Matches: <b style="color:var(--win); font-family:var(--font-mono);">${intel.recentWins}W – ${intel.recentLosses}L</b> <span style="font-size:0.75rem; color:var(--text-muted); font-family:var(--font-mono);">(${intel.recentWinRate}%)</span></div>
        <div class="milestone-pills">${pillsHtml}</div>
      </div>
      ${bestEventHtml}
    </div>
  `;
}


/* ==========================================================================
   HUB TOURNAMENT RECOMMENDATIONS & SEARCH CONTROLLERS
   ========================================================================== */

let hubEventsSearchTimeout = null;

function switchHubTourneyTab(tabName) {
  const btnReg = document.getElementById('hub-btn-tab-registered');
  const btnRec = document.getElementById('hub-btn-tab-recommended');
  const viewReg = document.getElementById('hub-tourney-view-registered');
  const viewRec = document.getElementById('hub-tourney-view-recommended');
  const countBadge = document.getElementById('hub-tourney-tab-count');

  if (!btnReg || !btnRec || !viewReg || !viewRec) return;

  btnReg.classList.remove('active');
  btnRec.classList.remove('active');
  viewReg.style.display = 'none';
  viewRec.style.display = 'none';

  if (tabName === 'registered') {
    btnReg.classList.add('active');
    viewReg.style.display = 'block';
    if (countBadge && myHubData && myHubData.upcoming_events) {
      countBadge.textContent = `${myHubData.upcoming_events.length} registered`;
    }
  } else if (tabName === 'recommended') {
    btnRec.classList.add('active');
    viewRec.style.display = 'block';
    if (countBadge) countBadge.textContent = '📍 Nearby Events';
    loadHubRecommendedEvents();
  }
}

let customUserLocation = null;

// Reference shared GLOBAL_CITY_COORDS from utils.js
const HUB_CITY_COORDS = (typeof window !== 'undefined' && window.GLOBAL_CITY_COORDS) ? window.GLOBAL_CITY_COORDS : {
  'san diego': { name: 'San Diego, CA', lat: 32.7157, lng: -117.1611 },
  'los angeles': { name: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437 },
  'san francisco': { name: 'San Francisco, CA', lat: 37.7749, lng: -122.4194 },
  'seattle': { name: 'Seattle, WA', lat: 47.6062, lng: -122.3321 }
};

function openLocationPickerModal() {
  if (typeof bringModalToFront === 'function') {
    bringModalToFront('hub-location-picker-modal');
  } else {
    const modal = document.getElementById('hub-location-picker-modal');
    if (modal) {
      modal.style.zIndex = '1300';
      modal.classList.add('active');
    }
  }
}

function closeLocationPickerModal() {
  if (typeof closeModal === 'function') {
    closeModal('hub-location-picker-modal');
  } else {
    const modal = document.getElementById('hub-location-picker-modal');
    if (modal) modal.classList.remove('active');
  }
}

function setPresetLocation(cityKey) {
  if (cityKey === 'gps') {
    customUserLocation = null;
    userDeviceGeo = null;
    try {
      sessionStorage.removeItem('omni_user_custom_loc');
      sessionStorage.removeItem('omni_user_geo');
    } catch (e) {}
    closeLocationPickerModal();
    requestUserDeviceLocationPrompt();
    return;
  }
  const dict = (typeof window !== 'undefined' && window.GLOBAL_CITY_COORDS) ? window.GLOBAL_CITY_COORDS : HUB_CITY_COORDS;
  const loc = dict[cityKey.toLowerCase()];
  if (loc) {
    customUserLocation = { name: loc.name, lat: loc.lat, lng: loc.lng };
    try { sessionStorage.setItem('omni_user_custom_loc', JSON.stringify(customUserLocation)); } catch (e) {}
    closeLocationPickerModal();
    loadHubRecommendedEvents();
  }
}

async function searchCustomLocationInput() {
  const input = document.getElementById('custom-location-search-input');
  if (!input) return;
  const q = input.value.trim();
  if (!q) return;

  const qLower = q.toLowerCase();
  const dict = (typeof window !== 'undefined' && window.GLOBAL_CITY_COORDS) ? window.GLOBAL_CITY_COORDS : HUB_CITY_COORDS;
  for (const [key, val] of Object.entries(dict)) {
    if (key.includes(qLower) || val.name.toLowerCase().includes(qLower)) {
      customUserLocation = { name: val.name, lat: val.lat, lng: val.lng };
      try { sessionStorage.setItem('omni_user_custom_loc', JSON.stringify(customUserLocation)); } catch (e) {}
      closeLocationPickerModal();
      loadHubRecommendedEvents();
      return;
    }
  }

  // Fallback client-side geocoding via OpenStreetMap Nominatim
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`);
    const data = await resp.json();
    if (data && data.length > 0) {
      const item = data[0];
      const displayName = item.display_name.split(',').slice(0, 2).join(',');
      customUserLocation = {
        name: displayName,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon)
      };
      try { sessionStorage.setItem('omni_user_custom_loc', JSON.stringify(customUserLocation)); } catch (e) {}
      closeLocationPickerModal();
      loadHubRecommendedEvents();
      return;
    }
  } catch (err) {
    console.warn('Geocoding notice:', err);
  }

  alert(`Could not find coordinates for "${q}". Please try a nearby major city.`);
}

window.openLocationPickerModal = openLocationPickerModal;
window.closeLocationPickerModal = closeLocationPickerModal;
window.setPresetLocation = setPresetLocation;
window.searchCustomLocationInput = searchCustomLocationInput;

let userDeviceGeo = null;

function getDeviceCoordinates() {
  return new Promise((resolve) => {
    if (userDeviceGeo) {
      return resolve(userDeviceGeo);
    }
    try {
      const savedLat = localStorage.getItem('comm_lat');
      const savedLng = localStorage.getItem('comm_lng');
      if (savedLat && savedLng) {
        userDeviceGeo = {
          lat: Number(parseFloat(savedLat).toFixed(4)),
          lng: Number(parseFloat(savedLng).toFixed(4))
        };
        return resolve(userDeviceGeo);
      }
    } catch (e) {}
    try {
      const cached = sessionStorage.getItem('omni_user_geo');
      if (cached) {
        userDeviceGeo = JSON.parse(cached);
        return resolve(userDeviceGeo);
      }
    } catch (e) {}

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      let resolved = false;
      const safety = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 8500);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(safety);
          userDeviceGeo = {
            lat: Number(pos.coords.latitude.toFixed(4)),
            lng: Number(pos.coords.longitude.toFixed(4))
          };
          try {
            sessionStorage.setItem('omni_user_geo', JSON.stringify(userDeviceGeo));
            localStorage.setItem('comm_lat', String(userDeviceGeo.lat));
            localStorage.setItem('comm_lng', String(userDeviceGeo.lng));
          } catch (e) {}
          resolve(userDeviceGeo);
        },
        () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(safety);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    } else {
      resolve(null);
    }
  });
}

function requestUserDeviceLocationPrompt() {
  const errBox = document.getElementById('hub-loc-error-msg');
  const btn = document.getElementById('hub-enable-loc-btn');
  if (errBox) errBox.style.display = 'none';

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    if (errBox) {
      errBox.innerHTML = '⚠️ Geolocation is not supported by your browser. Please select your city below.';
      errBox.style.display = 'block';
    }
    openLocationPickerModal();
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; margin-right:6px; vertical-align:middle;"></span> Requesting Location...';
  }

  let hasFinished = false;

  // Strict 12s race timeout
  const safetyTimeout = setTimeout(() => {
    if (hasFinished) return;
    hasFinished = true;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '📍 Enable Location Sharing';
    }
    showHelpfulError(
      '📍 Location request timed out. On iPhone/iPad, check <b>Settings &gt; Privacy &gt; Location Services &gt; Safari</b>, or tap your city below!'
    );
  }, 12500);

  function handleSuccess(pos) {
    if (hasFinished) return;
    hasFinished = true;
    clearTimeout(safetyTimeout);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '📍 Enable Location Sharing';
    }
    const lat = Number(pos.coords.latitude.toFixed(4));
    const lng = Number(pos.coords.longitude.toFixed(4));
    userDeviceGeo = { lat, lng };
    try {
      sessionStorage.setItem('omni_user_geo', JSON.stringify(userDeviceGeo));
      localStorage.setItem('comm_lat', String(lat));
      localStorage.setItem('comm_lng', String(lng));
    } catch (e) {}
    // Reverse geocode to update true city name
    if (typeof window.api?.reverseGeocode === 'function') {
      window.api.reverseGeocode(lat, lng).then(rev => {
        if (rev && rev.formatted) {
          localStorage.setItem('comm_loc_name', rev.formatted);
          const label = document.getElementById('hub-rec-location-label');
          if (label) {
            label.innerHTML = `📍 <b>${escapeHtml(rev.formatted)}</b> <button class="hub-location-btn" onclick="openLocationPickerModal()">✏️ Change Location</button>`;
          }
        }
      }).catch(() => {});
    }
    loadHubRecommendedEvents();
  }

  function handleError(err) {
    if (hasFinished) return;
    hasFinished = true;
    clearTimeout(safetyTimeout);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '📍 Enable Location Sharing';
    }
    let msg = 'Could not acquire GPS coordinates. Please select your city below.';
    if (err && err.code === 1) {
      msg = '📍 Location access was denied in browser settings. To enable GPS, go to <b>Settings &gt; Privacy &gt; Location Services &gt; Safari</b> and set to <i>"While Using"</i>, or select your city below.';
    } else if (err && err.code === 2) {
      msg = '📍 GPS signal unavailable. Please select your city below.';
    } else if (err && err.code === 3) {
      msg = '📍 GPS request timed out. Please select your city below.';
    }
    showHelpfulError(msg);
  }

  function showHelpfulError(msg) {
    if (errBox) {
      errBox.innerHTML = msg;
      errBox.style.display = 'block';
    }
    openLocationPickerModal();
  }

  try {
    navigator.geolocation.getCurrentPosition(
      handleSuccess,
      handleError,
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  } catch (e) {
    if (!hasFinished) {
      hasFinished = true;
      clearTimeout(safetyTimeout);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '📍 Enable Location Sharing';
      }
      showHelpfulError('📍 Location access error. Please select your city below.');
    }
  }
}
window.requestUserDeviceLocationPrompt = requestUserDeviceLocationPrompt;

async function loadHubRecommendedEvents() {
  const container = document.getElementById('hub-recommended-list');
  const tierSelect = document.getElementById('hub-rec-tier-select');
  const radiusSelect = document.getElementById('hub-rec-radius-select');
  const label = document.getElementById('hub-rec-location-label');
  if (!container) return;

  container.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0;"><div class="spinner"></div></div>';

  const searchInput = document.getElementById('hub-rec-search-input');
  const sortSelect = document.getElementById('hub-rec-sort-select');
  const query = searchInput ? searchInput.value.trim() : '';
  const playerId = (currentUser && currentUser.player_id) ? currentUser.player_id : '';
  const selectedTier = tierSelect ? tierSelect.value : '';
  const selectedRadius = radiusSelect && radiusSelect.value ? Number(radiusSelect.value) : 50;
  const selectedSort = sortSelect ? sortSelect.value : 'date';

  // Determine coordinates: Custom chosen location > Live device GPS > Competitor Home fallback
  let userLat = null;
  let userLng = null;
  let locName = null;
  let geo = null;

  try {
    const savedLoc = sessionStorage.getItem('omni_user_custom_loc');
    if (savedLoc && !customUserLocation) {
      customUserLocation = JSON.parse(savedLoc);
    }
  } catch (e) {}

  if (customUserLocation) {
    userLat = customUserLocation.lat;
    userLng = customUserLocation.lng;
    locName = customUserLocation.name;
  } else {
    geo = await getDeviceCoordinates();
    if (geo) {
      userLat = geo.lat;
      userLng = geo.lng;
      locName = localStorage.getItem('comm_loc_name') || 'Live GPS Location';
    }
  }

  try {
    const data = await window.api.getRecommendedEvents(playerId, query, selectedTier, userLat, userLng, selectedRadius, 40, '', selectedSort);
    const events = data.events || [];
    
    if (label) {
      const activeName = (locName && locName !== 'Live GPS Location')
        ? locName
        : ([data.detected_city, data.detected_state].filter(Boolean).join(', ') || locName || 'Your Location');
      label.innerHTML = `📍 <b>${escapeHtml(activeName)}</b> <button class="hub-location-btn" onclick="openLocationPickerModal()">✏️ Change Location</button>`;

      if (userLat != null && userLng != null && (activeName === 'Live GPS Location' || activeName === 'Your Location')) {
        if (typeof window.api?.reverseGeocode === 'function') {
          window.api.reverseGeocode(userLat, userLng).then(rev => {
            if (rev && rev.formatted) {
              localStorage.setItem('comm_loc_name', rev.formatted);
              label.innerHTML = `📍 <b>${escapeHtml(rev.formatted)}</b> <button class="hub-location-btn" onclick="openLocationPickerModal()">✏️ Change Location</button>`;
            }
          }).catch(() => {});
        }
      }
    }

    // If no GPS, no custom location, and no detected history, show prompt to enable location sharing
    if (!geo && !customUserLocation && !data.detected_state && !data.detected_city && !query) {
      container.innerHTML = `
        <div style="padding: 2.5rem 1.5rem; text-align: center; color: var(--text-secondary); max-width: 520px; margin: 0 auto; grid-column: 1 / -1;">
          <div style="font-size: 2.2rem; margin-bottom: 0.6rem;">📍</div>
          <h4 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin-bottom: 0.4rem;">Enable Location Sharing to Discover Tournaments</h4>
          <p style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 1.15rem;">
            Allow device location access to automatically find tournaments within 100 miles of your current location.
          </p>

          <div id="hub-loc-error-msg" style="display:none; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.35); border-radius:8px; padding:0.75rem 1rem; margin-bottom:1.15rem; font-size:0.82rem; color:#f59e0b; text-align:left; line-height:1.45;"></div>

          <div style="display:flex; justify-content:center; gap:0.6rem; flex-wrap:wrap; margin-bottom:1.5rem;">
            <button id="hub-enable-loc-btn" class="bcp-login-btn" style="font-size: 0.85rem; padding: 0.55rem 1.35rem; font-weight: 700;" onclick="requestUserDeviceLocationPrompt()">
              📍 Enable Location Sharing
            </button>
            <button class="bcp-login-btn" style="font-size: 0.85rem; padding: 0.55rem 1.35rem; font-weight: 700; background:#1e293b; color:#38bdf8; border:1px solid rgba(56,189,248,0.3);" onclick="openLocationPickerModal()">
              ✏️ Search Any City
            </button>
          </div>

          <div style="padding-top: 1.15rem; border-top: 1px solid var(--border);">
            <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.65rem; text-transform: uppercase; letter-spacing: 0.5px;">Or Quick Select Popular Hubs:</div>
            <div style="display:flex; justify-content:center; gap:0.4rem; flex-wrap:wrap;">
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('san diego')">🌴 San Diego</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('los angeles')">🎬 Los Angeles</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('austin')">🤠 Austin</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('dallas')">⭐ Dallas</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('chicago')">🏙️ Chicago</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('new york')">🗽 New York</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('seattle')">🌲 Seattle</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem;" onclick="setPresetLocation('london')">☕ London</button>
              <button class="hub-loc-chip" style="font-size:0.78rem; padding:0.35rem 0.75rem; background:rgba(56,189,248,0.1); color:#38bdf8; border-color:rgba(56,189,248,0.3);" onclick="openLocationPickerModal()">🔍 More Cities...</button>
            </div>
          </div>
        </div>
      `;
      return;
    }

    if (events.length === 0) {
      container.innerHTML = `
        <div style="padding: 2rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.84rem; grid-column: 1 / -1;">
          <div style="font-size: 1.2rem; margin-bottom: 0.35rem;">🔍 No upcoming tournaments found for this area.</div>
          <div style="margin-top: 0.35rem; font-size: 0.78rem;">Try expanding your radius (e.g. 100 or 250 miles) or selecting "All States / Global"!</div>
        </div>
      `;
      return;
    }

    container.innerHTML = events.map(ev => renderHubEventCard(ev)).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:var(--loss); font-size:0.8rem; padding:1rem;">Error loading recommendations: ${escapeHtml(err.message)}</div>`;
  }
}

function debounceHubEventsSearch() {
  clearTimeout(hubEventsSearchTimeout);
  hubEventsSearchTimeout = setTimeout(() => {
    loadHubRecommendedEvents();
  }, 300);
}

async function executeHubEventsSearch() {
  const container = document.getElementById('hub-search-results-list');
  const input = document.getElementById('hub-events-search-input');
  const stateSelect = document.getElementById('hub-search-state-filter');
  if (!container) return;

  const query = input ? input.value.trim() : '';
  const state = stateSelect ? stateSelect.value : '';

  container.innerHTML = '<div class="empty-state" style="padding: 1.5rem 0;"><div class="spinner"></div></div>';

  try {
    const data = await window.api.getRecommendedEvents('', query, '', null, null, null, 30, state);
    const events = data.events || [];

    if (events.length === 0) {
      container.innerHTML = `
        <div style="padding: 1.5rem 0; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
          <div>No tournaments matched "${escapeHtml(query || state)}".</div>
          <div style="margin-top: 0.35rem; font-size: 0.78rem;">Try searching with a broader keyword or different state.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = events.map(ev => renderHubEventCard(ev)).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:var(--loss); font-size:0.8rem; padding:1rem;">Search failed: ${escapeHtml(err.message)}</div>`;
  }
}

function renderHubEventCard(ev) {
  const evDate = ev.event_date ? ev.event_date.substring(0, 10) : 'TBD';
  
  // Clean location string (remove trailing United States for cleaner cards)
  let locParts = [ev.city, ev.state].filter(Boolean);
  if (ev.country && ev.country.trim() !== 'United States' && ev.country.trim() !== 'US') {
    locParts.push(ev.country);
  }
  const cleanLoc = locParts.join(', ') || 'Online / Global';

  const tierBadge = ev.tier_badge || 'tier-B';
  const tierName = ev.tier || 'Tournament';
  const timeLabel = ev.time_label || 'Upcoming';
  const isNearby = ev.is_nearby;
  const enrolled = ev.enrolled_count !== undefined ? ev.enrolled_count : (ev.total_players || 0);
  const capacity = ev.capacity_cap !== undefined ? ev.capacity_cap : (ev.max_capacity !== undefined ? ev.max_capacity : enrolled);
  const hasTicketCap = ev.has_ticket_cap !== undefined ? ev.has_ticket_cap : (capacity > enrolled);
  const spotsOpen = capacity > enrolled ? (capacity - enrolled) : 0;
  
  let capacityText = `👥 <b>${enrolled}</b> Enrolled`;
  if (capacity > 0 && capacity > enrolled && hasTicketCap) {
    capacityText = `👥 <b>${enrolled} / ${capacity}</b> Spots <span style="color:#10b981; font-size:0.75rem;">(${spotsOpen} open)</span>`;
  } else if (capacity > 0 && capacity <= enrolled && hasTicketCap) {
    capacityText = `👥 <b>${enrolled} / ${capacity}</b> <span style="color:#f59e0b; font-size:0.75rem;">(Sold Out)</span>`;
  }

  const avgElo = ev.avg_elo_display ? Math.round(ev.avg_elo_display) : (ev.avg_field_elo ? Math.round(ev.avg_field_elo) : 1550);
  const myElo = (typeof currentUser !== 'undefined' && (currentUser?.current_elo || currentUser?.elo)) ||
                (typeof myHubData !== 'undefined' && (myHubData?.player?.current_elo || myHubData?.player?.elo)) ||
                (typeof connectState !== 'undefined' && (connectState.userProfile?.current_elo || connectState.userProfile?.elo)) ||
                ev.user_elo ||
                null;

  let deltaLabel = '';
  let deltaBadge = 'badge-match-prime';

  if (myElo) {
    const delta = avgElo - Math.round(myElo);
    const sign = delta > 0 ? `+${delta}` : (delta < 0 ? `${delta}` : `±0`);
    deltaLabel = `${sign} vs My Elo`;
    if (delta > 75) {
      deltaBadge = 'badge-match-extreme';
    } else if (delta > 25) {
      deltaBadge = 'badge-match-hard';
    } else if (delta < -25) {
      deltaBadge = 'badge-match-favorable';
    } else {
      deltaBadge = 'badge-match-prime';
    }
  } else if (ev.skill_match_label && !ev.skill_match_label.includes('Field Avg')) {
    deltaLabel = ev.skill_match_label;
    deltaBadge = ev.skill_match_badge || 'badge-match-prime';
  } else {
    deltaLabel = '⚔️ Open Field';
    deltaBadge = 'badge-match-prime';
  }

  return `
    <div class="hub-event-card-pro" onclick="openEventModal('${ev.id}', false)">
      <div>
        <!-- Card Header: Title & Badges -->
        <div class="hub-card-header">
          <h4 class="hub-card-title">${escapeHtml(ev.name)}</h4>
          <div class="hub-card-badges">
            ${isNearby ? '<span class="hub-rec-badge-nearby" style="font-size:0.7rem;">📍 Nearby</span>' : ''}
            <span class="tier-badge ${tierBadge}" style="font-size:0.7rem; padding:0.15rem 0.5rem;">${tierName}</span>
          </div>
        </div>

        <!-- Meta Row: Date & Location & Proximity Distance -->
        <div class="hub-card-meta-row" style="margin-top: 0.5rem;">
          <span class="hub-meta-item">
            <span style="color:var(--accent);">📅</span> <b>${evDate}</b>${(timeLabel && timeLabel !== 'Upcoming') ? ` <span style="color:var(--text-muted);">(${timeLabel})</span>` : ''}
          </span>
          <span>•</span>
          <span class="hub-meta-item">
            <span style="color:#a855f7;">📍</span> ${ev.distance_miles !== undefined && ev.distance_miles !== null ? `<b style="color:#38bdf8;">${ev.distance_miles} mi away</b> • ` : ''}${escapeHtml(cleanLoc)}
          </span>
        </div>
      </div>

      <!-- Tactical Analytics Bar -->
      <div class="hub-card-analytics-bar">
        <div style="display:flex; align-items:center; gap:0.4rem;">
          <span style="color:#f59e0b;">⭐</span>
          <span>Field Avg: <b style="color:#fff; font-family:var(--font-mono);">${avgElo}</b> Elo</span>
        </div>
        <span class="badge ${deltaBadge}" style="font-size:0.72rem; padding:0.2rem 0.55rem; font-weight:700;">
          ${escapeHtml(deltaLabel)}
        </span>
      </div>

      <!-- Footer Action Row -->
      <div class="hub-card-footer">
        <div class="hub-capacity-badge">
          ${capacityText}
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span style="color:var(--text-muted); font-size:0.75rem;">View Roster & Pairings ⚔️</span>
          <a href="https://www.bestcoastpairings.com/event/${ev.id}" target="_blank" onclick="event.stopPropagation()" class="hub-card-action-btn">
            BCP ↗
          </a>
        </div>
      </div>
    </div>
  `;
}

window.switchHubTourneyTab = switchHubTourneyTab;
window.loadHubRecommendedEvents = loadHubRecommendedEvents;
window.debounceHubEventsSearch = debounceHubEventsSearch;
window.executeHubEventsSearch = executeHubEventsSearch;

/* ==========================================================================
   ARMY LISTS & ROSTER STUDIO CONTROLLERS
   ========================================================================== */

let hubSavedLists = [];

async function loadHubArmyLists() {
  const container = document.getElementById('hub-armylists-list-container');
  if (!container) return;

  try {
    const res = await window.api.getArmyLists();
    const lists = res.army_lists || [];
    hubSavedLists = lists;
    renderHubArmyLists(lists);
  } catch(e) {
    container.innerHTML = `<div style="color:var(--loss); font-size:0.85rem; padding:1.5rem; text-align:center;">Error loading army lists: ${e.message}</div>`;
  }
}

function renderHubArmyLists(lists) {
  const container = document.getElementById('hub-armylists-list-container');
  if (!container) return;

  if (!lists || lists.length === 0) {
    container.innerHTML = `
      <div style="padding: 1.25rem 1rem 0.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        <div style="font-size: 1.6rem; margin-bottom: 0.35rem;">📋</div>
        <div style="font-size: 1rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">No Army Lists Imported Yet</div>
        <div style="font-size: 0.78rem; max-width: 440px; margin: 0 auto 0.85rem; color: #94a3b8; line-height: 1.45;">
          Import your rosters from <b>NewRecruit</b> using a share link to view your units and launch into Game Tracker!
        </div>
        <button class="bcp-login-btn" onclick="openImportArmyListModal()" style="font-size: 0.82rem; padding: 0.4rem 0.95rem; background: var(--accent); color: #0f172a; font-weight: 800;">
          ➕ Import from NewRecruit
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
      ${lists.map(l => {
        const pts = l.points || 2000;

        return `
          <div class="hub-rec-card" style="flex-direction: column; align-items: stretch; gap: 0.65rem; padding: 0.85rem 1rem; background: rgba(19, 29, 51, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
              <div style="min-width: 0; flex: 1;">
                <div style="font-size: 0.98rem; font-weight: 800; color: #fff; font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(l.name || 'NewRecruit Roster')}</div>
                <div style="font-size: 0.78rem; color: #38bdf8; font-weight: 700; margin-top: 0.15rem;">
                  ${escapeHtml(l.faction || 'Warhammer 40k')} • <span style="color: #c084fc;">${escapeHtml(l.detachment || 'Core Detachment')}</span>
                </div>
              </div>
              <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 800; font-family: var(--font-mono); font-size: 0.72rem; border: 1px solid rgba(245, 158, 11, 0.3); flex-shrink: 0;">
                ${pts} PTS
              </span>
            </div>

            <!-- Action Buttons Row -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 0.55rem; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                <button onclick="openViewArmyListModal('${l.id}')" class="subtab-btn" style="font-size: 0.74rem; padding: 0.25rem 0.65rem; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); font-weight: 700;">
                  👁️ View
                </button>
                <button onclick="launchTrackerWithList('${l.id}')" class="subtab-btn" style="font-size: 0.74rem; padding: 0.25rem 0.65rem; background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-weight: 700;">
                  ⚔️ Play
                </button>
                ${l.source_url ? `
                  <a href="${escapeHtml(l.source_url)}" target="_blank" class="subtab-btn" style="font-size: 0.74rem; padding: 0.25rem 0.65rem; background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.3); text-decoration: none; display: inline-flex; align-items: center; gap: 3px; font-weight: 700;" title="Edit roster on NewRecruit">
                    ✏️ Edit ↗
                  </a>
                ` : ''}
              </div>
              <button onclick="deleteHubArmyList('${l.id}')" style="background: transparent; border: none; color: #ef4444; font-size: 0.85rem; cursor: pointer; padding: 0.2rem 0.3rem;" title="Delete List">
                🗑️
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function openImportArmyListModal() {
  let modal = document.getElementById('hub-import-armylist-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'hub-import-armylist-modal';
    modal.style.cssText = 'position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; background:rgba(3,7,18,0.85); backdrop-filter:blur(8px); padding:16px;';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; width:100%; max-width:600px; box-shadow:0 25px 60px rgba(0,0,0,0.85); display:flex; flex-direction:column; overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc;">
      <!-- Header -->
      <div style="padding:16px 20px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:22px;">📋</span>
          <div>
            <h3 style="font-size:16px; font-weight:800; color:#fff; margin:0;">Import Army Roster</h3>
            <div style="font-size:11px; color:#38bdf8; margin-top:2px;">Paste text from NewRecruit or Official 40k App for full Wahapedia enrichment</div>
          </div>
        </div>
        <button onclick="closeImportArmyListModal()" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer;">✕</button>
      </div>

      <!-- Paste Text Content -->
      <div style="padding:20px;">
        <!-- Recommended Exporter Options Guide -->
        <div style="background:rgba(2,132,199,0.08); border:1px solid rgba(56,189,248,0.25); border-radius:8px; padding:10px 14px; margin-bottom:12px; font-size:11.5px; color:#cbd5e1; line-height:1.45;">
          <div style="font-weight:700; color:#38bdf8; margin-bottom:4px; display:flex; align-items:center; gap:5px;">
            <span>💡</span> Supported & Recommended Exporters:
          </div>
          <div style="color:#e2e8f0;">• <b>NewRecruit Text Export:</b> Options <code>Tournament, GW</code> &bull; Checked: <code>[✓] Constant selections</code> &bull; <code>[✓] Header</code></div>
          <div style="color:#e2e8f0; margin-top:2px;">• <b>Official Warhammer 40k App:</b> Share / Export text list directly</div>
          <div style="color:#94a3b8; font-size:11px; margin-top:5px; border-top:1px dashed rgba(255,255,255,0.1); padding-top:4px;">
            ⚠️ <i>Note: Other formats (BattleScribe, raw JSON, or BCP plain text) might not have full Wahapedia stats/rules enrichment.</i>
          </div>
        </div>

        <label style="display:block; font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:8px;">
          Paste Army List Text:
        </label>
        <textarea id="hub-import-text-input" rows="10" placeholder="Paste your army roster text here... (e.g. Space Marines - Gladius Task Force, Units, Enhancements, Points)" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:10px; padding:12px 14px; font-family:'JetBrains Mono',monospace; font-size:12px; color:#e2e8f0; outline:none; box-sizing:border-box; resize:vertical; line-height:1.5;"></textarea>

        <div style="margin-top:12px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
          <div style="font-size:11px; color:#94a3b8;">
            ✨ Automatically enriches with <b>11th Edition Wahapedia</b> datasheets & stratagems.
          </div>
          <div style="display:flex; gap:8px;">
            <button onclick="closeImportArmyListModal()" style="background:#1e293b; color:#cbd5e1; font-weight:700; font-size:12px; border:none; padding:9px 16px; border-radius:8px; cursor:pointer;">Cancel</button>
            <button id="hub-btn-do-import-text" onclick="handleHubParseAndSaveText()" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; border:none; padding:9px 20px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
              ⚡ Import & Enrich Roster
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
}

async function handleHubParseAndSaveText() {
  const input = document.getElementById('hub-import-text-input');
  const btn = document.getElementById('hub-btn-do-import-text');
  if (!input || !input.value.trim()) {
    alert('Please paste your army roster text.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; margin-right:6px; vertical-align:middle;"></span> Enriching with Wahapedia...';

  try {
    const raw = input.value.trim();
    const parseRes = await window.api.parseArmyList(raw);
    if (parseRes.error || !parseRes.army_list) throw new Error(parseRes.error || 'Failed to parse text');

    const armyList = parseRes.army_list;
    const saveRes = await window.api.saveArmyList(armyList);
    if (saveRes.error) throw new Error(saveRes.error);

    closeImportArmyListModal();
    alert(`🎉 Successfully imported and enriched "${armyList.name}" (${armyList.points} pts, ${armyList.units?.length || 0} units)!`);
    await loadHubArmyLists();
    openViewArmyListModal(armyList.id);
  } catch(e) {
    alert('Error importing roster: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Import & Enrich Roster';
  }
}

function closeImportArmyListModal() {
  const modal = document.getElementById('hub-import-armylist-modal');
  if (modal) modal.style.display = 'none';
}

function generateRawRosterText(list) {
  if (list.raw_text && list.raw_text.trim().length > 10) {
    return list.raw_text.trim();
  }
  let out = `${list.faction || 'Warhammer 40,000'} - ${list.detachment || 'Core Detachment'} (${list.points || 2000} pts)\n\n`;
  const units = list.units || [];
  const groups = {};
  for (const u of units) {
    const role = (u.role || 'Other Datasheets').toUpperCase();
    if (!groups[role]) groups[role] = [];
    groups[role].push(u);
  }
  for (const [role, uList] of Object.entries(groups)) {
    out += `+ ${role} +\n`;
    for (const u of uList) {
      const cnt = u.model_count && u.model_count > 1 ? `${u.model_count}x ` : '';
      out += `${cnt}${u.name} [${u.points || 0} pts]`;
      const tags = [];
      if (u.is_warlord) tags.push('Warlord');
      if (u.enhancement) tags.push(`Enhancement: ${u.enhancement}`);
      if (tags.length > 0) out += `: ${tags.join(', ')}`;
      out += '\n';
      if (u.wargear && u.wargear.length > 0) {
        out += `  • Wargear: ${u.wargear.join(', ')}\n`;
      }
    }
    out += '\n';
  }
  return out.trim();
}

window.generateRawRosterText = generateRawRosterText;

window.copyHubRawText = function(listId) {
  const list = (hubSavedLists || []).find(l => l.id === listId);
  if (!list) return;
  const rawText = generateRawRosterText(list);
  navigator.clipboard.writeText(rawText).then(() => {
    alert('📋 Raw roster text copied to clipboard!');
  }).catch(() => {
    prompt('Copy your roster text below:', rawText);
  });
};

window.setHubRosterViewMode = function(mode, listId) {
  window.hubCurrentViewMode = mode;
  openViewArmyListModal(listId, mode);
};

function renderNativeRosterViewer(list, options = {}) {
  const viewMode = options.mode || window.hubCurrentViewMode || 'enriched';

  if (viewMode === 'text') {
    const rawText = generateRawRosterText(list);
    return `
      <div style="display:flex; flex-direction:column; padding:20px; flex:1; overflow:hidden; background:#070b14;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <div style="font-size:13px; font-weight:800; color:#38bdf8; display:flex; align-items:center; gap:6px;">
            <span>📄</span> Raw Roster Text (Monospaced / Copy-Friendly)
          </div>
          <button onclick="copyHubRawText('${list.id}')" style="background:#1e293b; color:#38bdf8; border:1px solid rgba(56,189,248,0.3); font-weight:800; font-size:12px; padding:7px 16px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
            📋 Copy Raw Text
          </button>
        </div>
        <pre id="hub-raw-roster-content" style="flex:1; margin:0; background:#030712; border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:18px; font-family:'JetBrains Mono',monospace; font-size:12px; color:#e2e8f0; line-height:1.6; white-space:pre-wrap; overflow-y:auto; word-break:break-word;">${escapeHtml(rawText)}</pre>
      </div>
    `;
  }

  let units = list.units || [];
  let armyRules = list.army_rules || [];
  let detachmentRules = list.detachment_rules || [];

  if ((!units || units.length === 0) && list.list_data) {
    let ld = list.list_data;
    if (typeof ld === 'string') {
      try { ld = JSON.parse(ld); } catch(e) {}
    }
    if (ld && typeof ld === 'object') {
      if (ld.units && ld.units.length > 0) units = ld.units;
      if (ld.army_rules && ld.army_rules.length > 0) armyRules = ld.army_rules;
      if (ld.detachment_rules && ld.detachment_rules.length > 0) detachmentRules = ld.detachment_rules;
      if (ld.stratagems && ld.stratagems.length > 0) stratagems = ld.stratagems;
    }
  }

  let stratagems = list.stratagems || [];
  if (stratagems.length === 0 && list.list_data) {
    try {
      const ld = typeof list.list_data === 'string' ? JSON.parse(list.list_data) : list.list_data;
      if (ld && ld.stratagems) stratagems = ld.stratagems;
    } catch(e) {}
  }

  const name = list.name || 'Army Roster';
  const faction = list.faction || 'Warhammer 40,000';
  const detachment = list.detachment || 'Core Detachment';
  const points = list.points || 2000;
  const warlord = list.warlord || '';

  function formatWahaText(text) {
    if (!text) return '';
    if (typeof text !== 'string') text = String(text);
    let formatted = text
      .replace(/<span class=["']?kwb["']?>\s*([^<]+?)\s*<\/span>/gi, '<span class="kwb-badge">$1</span>')
      .replace(/<span class=["']?tooltip[^"']*["']?>\s*([^<]+?)\s*<\/span>/gi, '$1')
      .replace(/<a [^>]*>([^<]+)<\/a>/gi, '$1');
    formatted = formatted.replace(/<\/?(script|iframe|object|embed|style|form|input|button)[^>]*>/gi, '');

    // Normalize Wahapedia tables: strip inline widths and wrap in responsive horizontal scrolling container
    if (formatted.includes('<table')) {
      formatted = formatted.replace(/<table\b([^>]*)>/gi, (match, attrs) => {
        const cleanedAttrs = (attrs || '')
          .replace(/\b(?:width|height)\s*=\s*["'][^"']*?["']/gi, '')
          .replace(/\bstyle\s*=\s*["'][^"']*?(?:width|min-width|max-width)[^"']*?["']/gi, '');
        return `<div class="waha-table-wrap"><table class="waha-responsive-table" ${cleanedAttrs}>`;
      });
      formatted = formatted.replace(/<\/table>/gi, '</table></div>');
    }

    return formatted;
  }

  let contentHtml = `<div class="roster-viewer-body" style="display:flex; flex-direction:column; gap:1.25rem; padding:1.25rem; overflow-y:auto; flex:1; background:#070b14; width:100%; box-sizing:border-box;">`;

  // 1. Army & Detachment Rules Banner
  if (armyRules.length > 0 || detachmentRules.length > 0) {
    contentHtml += `
      <div class="roster-rules-card" style="background:rgba(15, 23, 42, 0.7); border:1px solid rgba(56, 189, 248, 0.25); border-radius:12px; padding:12px 14px; width:100%; box-sizing:border-box;">
        <div style="font-size:13px; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
          <span>📜</span> Army & Detachment Rules
        </div>
        <div class="roster-rules-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 290px), 1fr)); gap:10px; width:100%; box-sizing:border-box;">
          ${armyRules.map(ar => `
            <div class="roster-rule-item" style="background:#070b14; border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:10px 12px; min-width:0; width:100%; box-sizing:border-box; overflow:hidden;">
              <div style="font-weight:800; font-size:13px; color:#f8fafc; margin-bottom:6px; display:flex; align-items:center; gap:6px;">🛡️ ${escapeHtml(ar.name)}</div>
              <div class="waha-rich-text">${formatWahaText(ar.description || '')}</div>
            </div>
          `).join('')}
          ${detachmentRules.map(dr => `
            <div class="roster-rule-item" style="background:#070b14; border:1px solid rgba(192,132,252,0.25); border-radius:8px; padding:10px 12px; min-width:0; width:100%; box-sizing:border-box; overflow:hidden;">
              <div style="font-weight:800; font-size:13px; color:#c084fc; margin-bottom:6px; display:flex; align-items:center; gap:6px;">⚡ ${escapeHtml(dr.name)}</div>
              <div class="waha-rich-text">${formatWahaText(dr.description || '')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // 2. Detachment Stratagems Banner
  if (stratagems.length > 0) {
    contentHtml += `
      <div class="roster-stratagems-card" style="background:rgba(15, 23, 42, 0.7); border:1px solid rgba(239, 68, 68, 0.25); border-radius:12px; padding:12px 14px; width:100%; box-sizing:border-box;">
        <div style="font-size:13px; font-weight:800; color:#f87171; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
          <span>⚔️</span> Detachment Stratagems <span style="font-size:11px; color:#94a3b8; font-weight:normal;">(${stratagems.length})</span>
        </div>
        <div class="roster-stratagems-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 270px), 1fr)); gap:10px; width:100%; box-sizing:border-box;">
          ${stratagems.map(st => `
            <div class="roster-stratagem-item" style="background:#070b14; border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:6px; min-width:0; width:100%; box-sizing:border-box; overflow:hidden;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                <b style="font-size:12px; color:#fff; font-family:'JetBrains Mono',monospace; overflow-wrap:break-word; word-break:break-word;">${escapeHtml(st.name)}</b>
                <span class="badge" style="background:rgba(239,68,68,0.2); color:#ef4444; font-size:10px; font-weight:800; border:1px solid rgba(239,68,68,0.4); padding:1px 5px; flex-shrink:0;">${escapeHtml(st.cp_cost || '1 CP')}</span>
              </div>
              <div style="display:flex; flex-wrap:wrap; gap:4px; font-size:9.5px;">
                ${st.type ? `<span style="color:#38bdf8; background:rgba(56,189,248,0.1); padding:1px 4px; border-radius:3px;">${escapeHtml(st.type)}</span>` : ''}
                ${st.phase ? `<span style="color:#facc15; background:rgba(250,204,21,0.1); padding:1px 4px; border-radius:3px;">🕒 ${escapeHtml(st.phase)}</span>` : ''}
                ${st.turn ? `<span style="color:#a855f7; background:rgba(168,85,247,0.1); padding:1px 4px; border-radius:3px;">${escapeHtml(st.turn)}</span>` : ''}
              </div>
              <div class="waha-rich-text">${formatWahaText(st.description || '')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Group units by category/role
  const categories = {
    'Epic Heroes & Characters': [],
    'Battleline': [],
    'Infantry & Elites': [],
    'Mounted & Fast Attack': [],
    'Vehicles & Monsters': [],
    'Transports & Dedicated': [],
    'Other Datasheets': []
  };

  units.forEach((u, idx) => {
    const role = (u.role || '').toLowerCase();
    if (u.is_warlord || role.includes('character') || role.includes('epic hero') || role.includes('leader')) {
      categories['Epic Heroes & Characters'].push({ ...u, _idx: idx });
    } else if (role.includes('battleline')) {
      categories['Battleline'].push({ ...u, _idx: idx });
    } else if (role.includes('mounted') || role.includes('biker') || role.includes('cavalry')) {
      categories['Mounted & Fast Attack'].push({ ...u, _idx: idx });
    } else if (role.includes('vehicle') || role.includes('monster') || role.includes('walker') || role.includes('dreadnought')) {
      categories['Vehicles & Monsters'].push({ ...u, _idx: idx });
    } else if (role.includes('transport')) {
      categories['Transports & Dedicated'].push({ ...u, _idx: idx });
    } else if (role.includes('infantry') || role.includes('elites')) {
      categories['Infantry & Elites'].push({ ...u, _idx: idx });
    } else {
      categories['Other Datasheets'].push({ ...u, _idx: idx });
    }
  });

  // Helper to group identical units
  function groupIdenticalUnits(catUnits) {
    const grouped = [];
    const map = new Map();

    catUnits.forEach(u => {
      const wKey = (u.weapons || []).map(w => `${w.name}-${w.Range || w.range}-${w.A}-${w.skill || w.BS || w.WS}-${w.S}-${w.AP}-${w.D}`).sort().join('|');
      const aKey = (u.abilities || []).map(a => `${a.name}`).sort().join('|');
      const sKey = u.stats ? `${u.stats.M}-${u.stats.T}-${u.stats.SV}-${u.stats.INV}-${u.stats.W}-${u.stats.LD}-${u.stats.OC}` : '';
      const key = `${u.name}||${u.enhancement || ''}||${u.is_warlord ? '1' : '0'}||${sKey}||${wKey}||${aKey}`;

      if (map.has(key)) {
        const existing = map.get(key);
        existing.quantity = (existing.quantity || 1) + (u.quantity || 1);
        existing.totalPoints += (u.points || 0);
        existing._indices.push(u._idx);
      } else {
        const entry = {
          ...u,
          quantity: u.quantity || 1,
          unitPoints: u.points || 0,
          totalPoints: u.points || 0,
          _indices: [u._idx]
        };
        map.set(key, entry);
        grouped.push(entry);
      }
    });

    return grouped;
  }

  if (units.length > 0) {
    for (const [catName, rawUnits] of Object.entries(categories)) {
      if (rawUnits.length === 0) continue;
      const catUnits = groupIdenticalUnits(rawUnits);
      const totalUnitsInCat = rawUnits.length;
      const catIcon = catName.includes('Character') ? '👑' : (catName.includes('Battleline') ? '🛡️' : (catName.includes('Vehicle') ? '🚜' : (catName.includes('Mounted') ? '🚀' : '⚔️')));
      
      contentHtml += `
        <div>
          <div style="font-size:0.85rem; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:0.6rem; display:flex; align-items:center; gap:0.4rem;">
            <span>${catIcon}</span> ${catName} <span style="font-size:0.75rem; color:#64748b; font-weight:normal;">(${totalUnitsInCat})</span>
          </div>
          <div class="roster-units-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap:0.85rem; width:100%; box-sizing:border-box;">
            ${catUnits.map(u => {
              const uName = u.name || 'Unit';
              const uPts = u.unitPoints || u.points || 0;
              const totalPts = u.totalPoints || uPts;
              const uQty = u.quantity || 1;
              const uCount = u.model_count || 1;
              const stats = u.stats || { M: '6"', T: 4, SV: '3+', INV: '-', W: 2, LD: '6+', OC: 1 };
              const weapons = u.weapons || [];
              const abilities = u.abilities || [];
              const rules = u.rules || [];

              const enhName = (u.enhancement_detail && u.enhancement_detail.name) || u.enhancement || '';
              const enhDetail = u.enhancement_detail || (list.available_enhancements || []).find(e => e.name && e.name.toLowerCase() === enhName.toLowerCase()) || {};
              const enhDesc = enhDetail.description || '';
              const enhCost = enhDetail.cost || enhDetail.points || (u.enhancement_pts ? `+${u.enhancement_pts} pts` : '');

              return `
                <div class="gt-unit-card" style="background:rgba(15, 23, 42, 0.9); border:1px solid ${u.is_warlord ? 'rgba(245,158,11,0.45)' : (enhName ? 'rgba(192,132,252,0.4)' : 'rgba(255,255,255,0.08)')}; border-radius:12px; padding:0.85rem; display:flex; flex-direction:column; gap:0.65rem; transition:all 0.2s; min-width:0; width:100%; box-sizing:border-box; overflow:hidden;">
                  <!-- Top Row: Unit Name & Points -->
                  <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.4rem;">
                    <div style="min-width:0; flex:1;">
                      <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
                        ${uQty > 1 ? `
                          <span class="badge" style="background:#0284c7; color:#fff; font-size:0.75rem; font-weight:800; padding:1px 6px; border-radius:4px; font-family:var(--font-mono);">${uQty}x</span>
                        ` : (uCount > 1 ? `<span style="font-size:0.8rem; font-weight:800; color:#38bdf8; font-family:var(--font-mono);">${uCount}x</span>` : '')}
                        <b style="font-size:0.95rem; color:#fff; font-family:var(--font-mono); overflow-wrap:break-word; word-break:break-word;">${escapeHtml(uName)}</b>
                        ${u.is_warlord ? '<span class="badge" style="background:rgba(245,158,11,0.2); color:#f59e0b; font-size:0.65rem; font-weight:800; border:1px solid rgba(245,158,11,0.4); padding:0.1rem 0.35rem; white-space:nowrap;">👑 WARLORD</span>' : ''}
                      </div>
                      ${enhName ? `<div style="font-size:0.75rem; color:#c084fc; font-weight:700; margin-top:0.2rem; overflow-wrap:break-word;">✨ ${escapeHtml(enhName)} ${enhCost ? `(${escapeHtml(String(enhCost))})` : ''}</div>` : ''}
                      ${(u.keywords && u.keywords.length > 0) ? `
                        <div style="display:flex; flex-wrap:wrap; gap:3px; margin-top:4px;">
                          ${u.keywords.map(k => `<span style="font-size:0.62rem; color:#94a3b8; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); padding:0px 5px; border-radius:3px;">${escapeHtml(k)}</span>`).join('')}
                        </div>
                      ` : ''}
                    </div>
                    ${totalPts > 0 ? `
                      <span class="badge" style="background:rgba(56,189,248,0.12); color:#38bdf8; font-size:0.75rem; font-weight:800; font-family:var(--font-mono); flex-shrink:0; text-align:right;">
                        ${uQty > 1 ? `${totalPts} PTS <span style="font-size:0.62rem; color:#94a3b8; font-weight:normal;">(${uPts} ea)</span>` : `${totalPts} PTS`}
                      </span>
                    ` : ''}
                  </div>

                  <!-- Tactical Statline Bar -->
                  <div style="display:grid; grid-template-columns:repeat(7, 1fr); background:rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:0.4rem 0.15rem; text-align:center; font-family:var(--font-mono); width:100%; box-sizing:border-box;">
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">M</div><div style="font-size:0.8rem; color:#fff; font-weight:800;">${stats.M || '6"'}</div></div>
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">T</div><div style="font-size:0.8rem; color:#fff; font-weight:800;">${stats.T || 4}</div></div>
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">SV</div><div style="font-size:0.8rem; color:#fff; font-weight:800;">${stats.SV || '3+'}</div></div>
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">INV</div><div style="font-size:0.8rem; color:#38bdf8; font-weight:800;">${stats.INV || '-'}</div></div>
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">W</div><div style="font-size:0.8rem; color:#ef4444; font-weight:800;">${stats.W || 2}</div></div>
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">LD</div><div style="font-size:0.8rem; color:#fff; font-weight:800;">${stats.LD || '6+'}</div></div>
                    <div><div style="font-size:0.6rem; color:#64748b; font-weight:700;">OC</div><div style="font-size:0.8rem; color:#10b981; font-weight:800;">${stats.OC || 1}</div></div>
                  </div>

                  <!-- Weapons Table (Mobile Responsive) -->
                  ${weapons.length > 0 ? `
                    <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:8px; overflow-x:auto; -webkit-overflow-scrolling:touch; width:100%; box-sizing:border-box;">
                      <div style="min-width:320px;">
                        <div style="display:grid; grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr 1fr; padding:4px 8px; background:rgba(255,255,255,0.04); font-size:0.62rem; font-weight:800; color:#94a3b8; font-family:var(--font-mono); text-transform:uppercase;">
                          <div>Weapon</div><div style="text-align:center;">Rng</div><div style="text-align:center;">A</div><div style="text-align:center;">BS/WS</div><div style="text-align:center;">S</div><div style="text-align:center;">AP</div><div style="text-align:center;">D</div>
                        </div>
                        ${weapons.map(w => `
                          <div style="display:grid; grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr 1fr; padding:5px 8px; border-top:1px solid rgba(255,255,255,0.04); font-size:0.7rem; font-family:var(--font-mono); align-items:center;">
                            <div style="min-width:0;">
                              <div style="font-weight:700; color:#f8fafc; font-size:0.72rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${w.type === 'Melee' ? '⚔️' : '🔫'} ${escapeHtml(w.name)}</div>
                              ${(w.keywords && w.keywords.length > 0) ? `
                                <div style="font-size:0.6rem; color:#38bdf8; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${w.keywords.map(k => `[${escapeHtml(k)}]`).join(' ')}</div>
                              ` : ''}
                            </div>
                            <div style="text-align:center; color:#cbd5e1;">${w.range || '-'}</div>
                            <div style="text-align:center; color:#cbd5e1; font-weight:700;">${w.A || '-'}</div>
                            <div style="text-align:center; color:#38bdf8; font-weight:700;">${w.skill || '-'}</div>
                            <div style="text-align:center; color:#cbd5e1;">${w.S || '-'}</div>
                            <div style="text-align:center; color:#ef4444; font-weight:700;">${w.AP || '0'}</div>
                            <div style="text-align:center; color:#10b981; font-weight:700;">${w.D || '1'}</div>
                          </div>
                        `).join('')}
                      </div>
                    </div>
                  ` : ((u.wargear && u.wargear.length > 0) ? `
                    <div style="display:flex; flex-wrap:wrap; gap:0.25rem;">
                      ${u.wargear.map(w => `<span style="font-size:0.68rem; background:rgba(255,255,255,0.05); color:#94a3b8; border:1px solid rgba(255,255,255,0.06); padding:0.1rem 0.35rem; border-radius:4px;">${escapeHtml(w)}</span>`).join('')}
                    </div>
                  ` : '')}

                  <!-- Abilities, Enhancement Details & Rules -->
                  ${(abilities.length > 0 || rules.length > 0 || enhName) ? `
                    <div style="display:flex; flex-direction:column; gap:4px; width:100%; box-sizing:border-box;">
                      ${rules.length > 0 ? `
                        <div style="display:flex; flex-wrap:wrap; gap:4px;">
                          ${rules.map(r => `<span style="font-size:0.62rem; font-weight:800; background:rgba(56,189,248,0.1); color:#38bdf8; border:1px solid rgba(56,189,248,0.2); padding:1px 5px; border-radius:4px;">${escapeHtml(r.name)}</span>`).join('')}
                        </div>
                      ` : ''}
                      ${enhName ? `
                        <div style="background:rgba(192,132,252,0.12); border:1px solid rgba(192,132,252,0.3); border-radius:6px; padding:6px 8px; font-size:0.7rem; min-width:0; width:100%; box-sizing:border-box;">
                          <b style="color:#c084fc; font-size:0.72rem;">✨ Enhancement: ${escapeHtml(enhName)} ${enhCost ? `(${escapeHtml(String(enhCost))})` : ''}:</b>
                          ${enhDesc ? `<div class="waha-rich-text" style="color:#e2e8f0; margin-top:2px;">${formatWahaText(enhDesc)}</div>` : '<div style="color:#94a3b8; font-style:italic; margin-top:2px;">Detachment enhancement assigned to this character</div>'}
                        </div>
                      ` : ''}
                      ${abilities.map(ab => `
                        <div style="background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.05); border-radius:6px; padding:6px 8px; font-size:0.7rem; min-width:0; width:100%; box-sizing:border-box;">
                          <b style="color:#facc15; font-size:0.72rem;">${escapeHtml(ab.name)}:</b>
                          <div class="waha-rich-text" style="margin-top:2px;">${formatWahaText(ab.description)}</div>
                        </div>
                      `).join('')}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }
  } else if (list.raw_text) {
    contentHtml += `
      <div style="padding:1.5rem; overflow-y:auto; flex:1; font-family:var(--font-mono); font-size:0.82rem; color:#cbd5e1; white-space:pre-wrap; line-height:1.6;">
        ${escapeHtml(list.raw_text)}
      </div>
    `;
  } else {
    contentHtml += `
      <div style="padding:3rem 1rem; text-align:center; color:#94a3b8;">
        <div style="font-size:1.8rem; margin-bottom:0.5rem;">📋</div>
        <div style="font-weight:700; color:#fff; font-size:1.05rem; margin-bottom:0.35rem;">No unit datasheets found</div>
        <div style="font-size:0.82rem; color:#64748b; margin-bottom:1rem;">Click below to re-fetch and extract datasheets.</div>
        ${(list.source_url || list.raw_text || list.id) ? `
          <button onclick="window.gtRefreshRoster('${list.id}')" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; border:none; padding:8px 16px; border-radius:8px; cursor:pointer;">
            🔄 Refresh / Re-parse Roster
          </button>
        ` : ''}
      </div>
    `;
  }

  contentHtml += `</div>`;
  return contentHtml;
}

window.gtRefreshRoster = async function(listId) {
  let list = hubSavedLists.find(l => l.id === listId);
  if (!list) {
    try {
      const res = await window.api.getArmyList(listId);
      if (res && res.army_list) list = res.army_list;
    } catch(e) {}
  }
  if (!list) return;

  const parseSource = list.source_url || list.raw_text;
  if (!parseSource) {
    alert('No source URL or text available to re-parse.');
    return;
  }

  try {
    const parseRes = await window.api.parseArmyList(parseSource);
    if (parseRes && parseRes.army_list) {
      const updated = { ...list, ...parseRes.army_list, id: list.id };
      await window.api.saveArmyList(updated);
      await loadHubArmyLists();
      openViewArmyListModal(listId);
    }
  } catch(e) {
    alert('Error re-parsing list: ' + e.message);
  }
};

window.gtAdjustWounds = function(unitIdx, delta) {
  const el = document.getElementById(`wound-val-${unitIdx}`);
  if (!el) return;
  const parts = el.textContent.split('/');
  if (parts.length === 2) {
    let cur = parseInt(parts[0].trim(), 10) + delta;
    const max = parseInt(parts[1].trim(), 10);
    cur = Math.max(0, Math.min(max, cur));
    el.textContent = `${cur} / ${max}`;
    if (cur === 0) {
      window.gtToggleSlain(unitIdx, true);
    }
  }
};

window.gtToggleSlain = function(unitIdx, forceSlain = null) {
  const card = document.getElementById(`unit-card-${unitIdx}`);
  const btn = document.getElementById(`slain-btn-${unitIdx}`);
  if (!card || !btn) return;
  const isSlain = forceSlain !== null ? forceSlain : !btn.textContent.includes('SLAIN');
  if (isSlain) {
    card.style.opacity = '0.45';
    btn.textContent = '💀 SLAIN';
    btn.style.background = 'rgba(239,68,68,0.2)';
    btn.style.borderColor = 'rgba(239,68,68,0.5)';
    btn.style.color = '#ef4444';
  } else {
    card.style.opacity = '1';
    btn.textContent = '⚔️ ACTIVE';
    btn.style.background = 'rgba(255,255,255,0.04)';
    btn.style.borderColor = 'rgba(255,255,255,0.1)';
    btn.style.color = '#94a3b8';
  }
};

async function openViewArmyListModal(listId, mode = null) {
  let list = (hubSavedLists || []).find(l => l.id === listId);
  if (!list || !list.units || list.units.length === 0) {
    try {
      const res = await window.api.getArmyList(listId);
      if (res && res.army_list) list = res.army_list;
    } catch(e) {}
  }
  if (!list) {
    alert('List not found');
    return;
  }

  const activeMode = mode || window.hubCurrentViewMode || 'enriched';
  window.hubCurrentViewMode = activeMode;

  // Auto-heal if list is missing units and has a source_url or raw_text
  if ((!list.units || list.units.length === 0) && (list.source_url || list.raw_text)) {
    try {
      const parseSource = list.source_url || list.raw_text;
      const parseRes = await window.api.parseArmyList(parseSource);
      if (parseRes && parseRes.army_list && parseRes.army_list.units && parseRes.army_list.units.length > 0) {
        list = { ...list, ...parseRes.army_list, id: list.id };
        await window.api.saveArmyList(list);
        await loadHubArmyLists();
      }
    } catch(err) {
      console.warn('Auto re-parsing on view:', err);
    }
  }

  let modal = document.getElementById('hub-view-armylist-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'hub-view-armylist-modal';
    modal.style.cssText = 'position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; background:rgba(3,7,18,0.88); backdrop-filter:blur(8px); padding:16px;';
    document.body.appendChild(modal);
  }

  const units = list.units || [];
  const warlord = list.warlord || '';
  const bodyHtml = renderNativeRosterViewer(list, { mode: activeMode });

  modal.innerHTML = `
    <div class="modal-window hub-armylist-modal-window" style="background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; width:100%; max-width:1100px; height:88vh; display:flex; flex-direction:column; overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc; box-shadow:0 30px 80px rgba(0,0,0,0.9);">
      <!-- Header -->
      <div class="modal-header hub-armylist-modal-header" style="padding:12px 18px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; width:100%; gap:10px;">
          <div style="min-width:0; flex:1;">
            <div style="font-size:16px; font-weight:900; color:#fff; font-family:var(--font-mono); line-height:1.3; overflow-wrap:break-word; word-break:break-word;">${escapeHtml(list.name || 'Army Roster')}</div>
            <div style="font-size:12px; color:#38bdf8; font-weight:700; margin-top:2px; line-height:1.35; overflow-wrap:break-word; word-break:break-word;">
              ${escapeHtml(list.faction || '40k')} • <span style="color:#a855f7;">${escapeHtml(list.detachment || 'Core Detachment')}</span> • <span style="color:#f59e0b;">${list.points || 2000} PTS</span>
              ${warlord ? ` • <span style="color:#facc15;">👑 ${escapeHtml(warlord)}</span>` : ''}
            </div>
          </div>
          <button onclick="closeViewArmyListModal()" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#94a3b8; font-size:18px; width:34px; height:34px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; transition:all 0.15s ease;">✕</button>
        </div>

        <div class="hub-armylist-controls-row" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; width:100%;">
          <!-- Mode Toggle Segmented Control -->
          <div style="display:flex; background:rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:3px; gap:4px; flex:1; min-width:240px; box-sizing:border-box;">
            <button onclick="setHubRosterViewMode('enriched', '${list.id}')" style="flex:1; background:${activeMode==='enriched'?'#0284c7':'transparent'}; color:${activeMode==='enriched'?'#fff':'#94a3b8'}; border:none; padding:6px 12px; border-radius:6px; font-weight:800; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px; text-align:center;">
              ⚡ Enriched Datasheets
            </button>
            <button onclick="setHubRosterViewMode('text', '${list.id}')" style="flex:1; background:${activeMode==='text'?'#0284c7':'transparent'}; color:${activeMode==='text'?'#fff':'#94a3b8'}; border:none; padding:6px 12px; border-radius:6px; font-weight:800; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px; text-align:center;">
              📄 Raw Roster Text
            </button>
          </div>

          <div class="hub-armylist-actions" style="display:flex; align-items:center; gap:8px;">
            <button onclick="launchTrackerWithList('${list.id}')" style="background:#10b981; color:#0f172a; font-weight:800; font-size:12px; border:none; padding:6px 14px; border-radius:6px; cursor:pointer;">
              ⚔️ Play in Tracker
            </button>
            <button onclick="deleteHubArmyList('${list.id}', true)" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3); font-weight:800; font-size:12px; padding:6px 12px; border-radius:6px; cursor:pointer;">
              🗑️ Delete
            </button>
          </div>
        </div>
      </div>

      <!-- Native Roster Viewer Body -->
      ${bodyHtml}
    </div>
  `;
  modal.style.display = 'flex';
}

function closeViewArmyListModal() {
  const modal = document.getElementById('hub-view-armylist-modal');
  if (modal) modal.style.display = 'none';
}

function exportArmyListToBcp(listId) {
  const list = hubSavedLists.find(l => l.id === listId);
  if (!list) return;

  const units = list.units || [];
  let out = `${list.faction || 'Warhammer 40,000'} - ${list.detachment || 'Detachment'} (${list.points || 2000} pts)\n\n`;

  // Group by role
  const groups = {};
  for (const u of units) {
    const role = (u.role || 'OTHER DATASHEETS').toUpperCase();
    if (!groups[role]) groups[role] = [];
    groups[role].push(u);
  }

  for (const [role, uList] of Object.entries(groups)) {
    out += `${role}\n`;
    for (const u of uList) {
      out += `${u.name} (${u.points || 0} pts)\n`;
      if (u.is_warlord) out += `  • Warlord\n`;
      if (u.enhancement) out += `  • Enhancement: ${u.enhancement}\n`;
      if (u.weapons && u.weapons.length > 0) {
        out += `  • Wargear: ${u.weapons.map(w => w.name).join(', ')}\n`;
      }
    }
    out += '\n';
  }

  navigator.clipboard.writeText(out).then(() => {
    alert('📋 BCP Tournament Roster copied to clipboard!');
  }).catch(() => {
    prompt('Copy your BCP list text below:', out);
  });
}

async function deleteHubArmyList(listId, fromModal = false) {
  if (!confirm('Are you sure you want to permanently delete this army list?')) return;
  
  if (fromModal) {
    closeViewArmyListModal();
  }

  // 1. Instant 0ms Optimistic UI Removal
  const prevLists = [...(hubSavedLists || [])];
  hubSavedLists = (hubSavedLists || []).filter(l => l.id !== listId);
  renderHubArmyLists(hubSavedLists);

  // 2. Perform async deletion in background
  try {
    const res = await window.api.deleteArmyList(listId);
    if (res && res.error) {
      console.warn('Delete army list warning:', res.error);
      // Revert if server returned an error
      hubSavedLists = prevLists;
      renderHubArmyLists(hubSavedLists);
      alert('Error deleting list: ' + res.error);
    }
  } catch(e) {
    console.error('Delete error:', e);
    hubSavedLists = prevLists;
    renderHubArmyLists(hubSavedLists);
    alert('Error deleting list: ' + e.message);
  }
}

function launchTrackerWithList(listId) {
  const list = hubSavedLists.find(l => l.id === listId);
  // Launch tracker with preloaded state
  const trackerUrl = (typeof currentGameSystem !== 'undefined' && currentGameSystem === 'aos') ? '/11th/tracker/aos' : '/11th/tracker';
  window.open(trackerUrl, '_blank');
}

function discardTrackerSession(matchId) {
  if (!matchId) return;
  const cleanId = String(matchId).toUpperCase();
  if (cleanId.startsWith('BCP-') || cleanId.startsWith('ES-') || cleanId.startsWith('WH40K-BCP-') || cleanId.startsWith('WH40K-ES-')) {
    alert("Tournament match rooms are managed by the event organizer (TO) and cannot be deleted by players.");
    return;
  }
  if (!confirm('Are you sure you want to discard this unfinished session? (Will not count towards your Elo or battle record)')) return;

  // 1. Instant 0ms Optimistic UI removal from DOM
  const cards = document.querySelectorAll(`[onclick*="${matchId}"]`);
  cards.forEach(c => {
    const parentRow = c.closest('div[style*="background"], tr');
    if (parentRow) {
      parentRow.remove();
    }
  });

  // 2. In-memory data update (so re-renders or tabs will not bring it back)
  if (window.myHubData) {
    if (window.myHubData.active_sessions) {
      window.myHubData.active_sessions = window.myHubData.active_sessions.filter(m => (m.match_id || m.id) !== matchId);
    }
    if (window.myHubData.primary_active && (window.myHubData.primary_active.match_id === matchId || window.myHubData.primary_active.id === matchId)) {
      window.myHubData.primary_active = (window.myHubData.active_sessions && window.myHubData.active_sessions.length > 0) ? window.myHubData.active_sessions[0] : null;
    }
    if (window.myHubData.completed_history) {
      window.myHubData.completed_history = window.myHubData.completed_history.filter(m => (m.match_id || m.id) !== matchId);
    }
    if (window.myHubData.tracker_history) {
      window.myHubData.tracker_history = window.myHubData.tracker_history.filter(m => (m.match_id || m.id) !== matchId);
    }
  }

  // 3. Cache hidden match ID immediately in localStorage & purge local state
  try {
    let hidden = JSON.parse(localStorage.getItem('gt-hidden-matches') || '[]');
    if (!hidden.includes(matchId)) {
      hidden.push(matchId);
      localStorage.setItem('gt-hidden-matches', JSON.stringify(hidden));
    }
    // Purge from 40k & AoS history cache
    let localCache40k = JSON.parse(localStorage.getItem('gdm-11e-tracker-history') || '[]');
    localCache40k = localCache40k.filter(item => (item.match_id || item.id) !== matchId);
    localStorage.setItem('gdm-11e-tracker-history', JSON.stringify(localCache40k));

    let localCacheAos = JSON.parse(localStorage.getItem('omni-aos-tracker-history') || '[]');
    localCacheAos = localCacheAos.filter(item => (item.match_id || item.id) !== matchId);
    localStorage.setItem('omni-aos-tracker-history', JSON.stringify(localCacheAos));

    // If active session matches, clear active state
    try {
      const active40k = JSON.parse(localStorage.getItem('gdm-11e-tracker-state') || '{}');
      if ((active40k.match_id || active40k.id) === matchId) {
        localStorage.removeItem('gdm-11e-tracker-state');
      }
    } catch (e) {}
    try {
      const activeAos = JSON.parse(localStorage.getItem('omni-aos-tracker-state') || '{}');
      if ((activeAos.match_id || activeAos.id) === matchId) {
        localStorage.removeItem('omni-aos-tracker-state');
      }
    } catch (e) {}
  } catch(e) {}

  // 4. Direct Firestore SDK deletion if loaded
  if (typeof firebase !== 'undefined' && firebase.firestore) {
    try {
      const db = firebase.firestore();
      db.collection('rooms').doc(matchId).delete();
    } catch(e) {}
  }

  // 5. Background server-side discard (non-blocking)
  try {
    const token = window.api ? window.api.getAuthToken() : null;
    fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/discard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      body: JSON.stringify({ token: token, match_id: matchId })
    }).catch(() => {});
  } catch(e) {}
}

window.loadHubArmyLists = loadHubArmyLists;
window.openImportArmyListModal = openImportArmyListModal;
window.closeImportArmyListModal = closeImportArmyListModal;
window.handleHubParseAndSaveText = handleHubParseAndSaveText;
window.openViewArmyListModal = openViewArmyListModal;
window.closeViewArmyListModal = closeViewArmyListModal;
window.exportArmyListToBcp = exportArmyListToBcp;
window.deleteHubArmyList = deleteHubArmyList;
window.launchTrackerWithList = launchTrackerWithList;
window.discardTrackerSession = discardTrackerSession;
window.renderNativeRosterViewer = renderNativeRosterViewer;
window.resetMyHubState = function() {
  myHubData = null;
  window.myHubData = null;
  hubSavedLists = [];
};

function toggleHubCareerDetails() {
  const drawer = document.getElementById('hub-career-details-drawer');
  const arrow = document.getElementById('hub-career-toggle-arrow');
  const textSpan = document.getElementById('hub-career-toggle-text');
  const btn = document.getElementById('hub-career-toggle-btn');
  if (!drawer) return;
  const isCollapsed = drawer.classList.contains('hub-career-drawer-collapsed');
  if (isCollapsed) {
    drawer.classList.remove('hub-career-drawer-collapsed');
    drawer.classList.add('hub-career-drawer-expanded');
    if (arrow) arrow.textContent = '▲';
    if (textSpan) textSpan.textContent = 'Hide Full Stats & Progression';
    if (btn) btn.setAttribute('aria-expanded', 'true');
  } else {
    drawer.classList.remove('hub-career-drawer-expanded');
    drawer.classList.add('hub-career-drawer-collapsed');
    if (arrow) arrow.textContent = '▼';
    if (textSpan) textSpan.textContent = 'Show Full Stats & Progression';
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
}
window.toggleHubCareerDetails = toggleHubCareerDetails;


