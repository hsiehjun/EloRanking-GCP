/* ==========================================================================
   MY_HUB.JS - Competitor Profile Hub & Personal Analytics
   ========================================================================== */

var myHubData = (typeof window !== 'undefined' && window.myHubData) || null;
if (typeof window !== 'undefined') window.myHubData = myHubData;

function buildMyHubShellData(u) {
  if (!u) return null;
  let initialGlory = Number(u.spendable_glory ?? u.glory_balance ?? 0);
  if (!initialGlory && typeof window !== 'undefined' && window.Armory && typeof window.Armory.getGlory === 'function') {
    const g = window.Armory.getGlory();
    if (g && g.spendable_glory != null) initialGlory = Number(g.spendable_glory);
  }
  if (!initialGlory) {
    try { initialGlory = Number(localStorage.getItem('omnitactica_cached_spendable_glory') || 0); } catch (e) {}
  }
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
    spendable_glory: initialGlory,
    glory_balance: initialGlory,
    history: [],
    faction_mastery: [],
    matchup_matrix: [],
    upcoming_events: [],
    registered_tournaments: [],
    active_sessions: [],
    _isSkeleton: true
  };
}

function isTournamentConcluded(ev) {
  if (!ev) return false;
  if (ev.ended === true || ev.is_ended === true) return true;
  if (ev.status && typeof ev.status === 'object' && (ev.status.ended === true || ev.status.is_ended === true)) return true;
  const statusStr = typeof ev.status === 'string' ? ev.status.trim().toLowerCase() : '';
  if (statusStr === 'ended' || statusStr === 'completed' || statusStr === 'finished' || statusStr === 'concluded') return true;
  const evId = String(ev.id || ev.bcp_event_id || '');
  if (ev.is_native_league || evId.startsWith('league_')) return false;
  const evDate = ev.event_date || ev.start_date || ev.eventDate || '';
  const endDate = ev.end_date || ev.eventEndDate || ev.endDate || '';
  const days = computeDaysUntil(evDate);
  if (days !== null && days < 0) {
    const endDays = computeDaysUntil(endDate);
    if (endDays === null || endDays < 0) return true;
  }
  return false;
}

function isValidRegisteredTournament(ev) {
  if (!ev) return false;
  if ((ev.is_organizer || ev.isOwner || ev.isTO) && !ev.player_id && !ev.bcp_player_id && !ev.has_explicit_player_data) return false;
  if (isTournamentConcluded(ev)) return false;
  return true;
}

function formatHubMatchDate(rawVal, fallbackObj = null) {
  let v = rawVal;
  if ((v == null || v === '' || v === '-') && fallbackObj && typeof fallbackObj === 'object') {
    v = fallbackObj.game_date || fallbackObj.date || fallbackObj.updated_at || fallbackObj.created_at;
  }
  if (v == null || v === '' || v === '-') return '-';
  if (typeof v === 'string' && /^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/.test(v.trim())) {
    return v.trim();
  }
  const strV = String(v).trim();
  let dObj = null;
  if (/^\d{10,13}$/.test(strV)) {
    const num = Number(strV);
    dObj = new Date(num > 1e11 ? num : num * 1000);
  } else {
    dObj = new Date(strV);
  }
  if (dObj && !isNaN(dObj.getTime())) {
    return dObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  }
  return strV.length >= 10 ? strV.substring(0, 10) : strV;
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
            edition: item.edition || item.game?.edition || null,
            edition_label: item.edition_label || item.game?.editionLabel || null,
            imported_source: item.imported_source || null,
            imported_app: item.imported_app || null,
            event_id: item.event_id || null,
            round_num: item.round_num || null,
            table_num: item.table_num || null,
            mapped_event_name: item.mapped_event_name || null,
            event_match_locked: Boolean(item.event_match_locked || item.event_id),
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
            game_date: item.game_date || null,
            created_at: item.created_at || item.date || Date.now(),
            date: formatHubMatchDate(item.game_date || item.date || item.created_at, item)
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

var _myHubLoadSeq = 0;

async function loadMyHubDashboard() {
  const container = document.getElementById('my-hub-content');
  if (!container) return;

  const mySeq = ++_myHubLoadSeq;

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
          const hasValidJourneyPlacements = !Array.isArray(parsed.history) || parsed.history.length === 0 || (
            Array.isArray(parsed.events_attended) &&
            parsed.events_attended.length > 0 &&
            !parsed.events_attended.some(ev => Number(ev && ev.wins || 0) === 0 && Number(ev && ev.losses || 0) >= 2 && Number(ev && ev.placement || 0) === 1)
          );
          if (parsed.player && typeof parsed.player === 'object' && parsed._journeySchemaVer === 4 && hasValidJourneyPlacements) {
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

  purgeLegacyHubArmyListCache();

  // Ensure local active and completed tracker matches are instantly reflected in optimistic render
  const localInitial = getLocalTrackerSessions(gs);
  const alreadyMounted = Boolean(document.getElementById('my-hub-container'));
  const bootSplashActive = Boolean(document.getElementById('app-boot-splash'));
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
    if (!alreadyMounted) {
      renderMyHub(cachedData);
    }
    if (typeof prefetchHubTopTournaments === 'function') {
      prefetchHubTopTournaments(cachedData);
    }
  } else if (currentUser) {
    const shell = buildMyHubShellData(currentUser);
    shell.active_sessions = localInitial.active;
    shell.primary_active = localInitial.active[0] || null;
    shell.unfinished_sessions = localInitial.active.slice(1);
    shell.completed_history = localInitial.completed;
    shell.tracker_history = localInitial.completed;
    if (!alreadyMounted) {
      renderMyHub(shell);
    }
  } else if (!bootSplashActive) {
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
    const regPromise = (window.api && typeof window.api.getUserRegisteredTournaments === 'function')
      ? window.api.getUserRegisteredTournaments(false).catch(() => null)
      : Promise.resolve(null);

    const [dashRes, sessRes] = await Promise.allSettled([
      window.api.getUserDashboard(currentUser.player_id),
      fetch(`/api/tracker/sessions?token=${encodeURIComponent(token)}&game_system=${encodeURIComponent(gs)}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      }).then(r => r.ok ? r.json() : null).catch(() => null)
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
    const dashCompleted = Array.isArray(data.tracker_history) ? data.tracker_history.filter(g => g && g.is_finished) : [];
    const authoritativeCompleted = serverCompleted.length > 0 ? serverCompleted : dashCompleted;
    authoritativeCompleted.forEach(m => {
      const mid = (m.match_id || m.id || '').trim();
      if (mid && !hiddenSet.has(mid) && !activeMap.has(mid)) compMap.set(mid, m);
    });
    localFresh.completed.forEach(m => {
      const mid = (m.match_id || m.id || '').trim();
      if (!mid || hiddenSet.has(mid) || activeMap.has(mid)) return;
      if (compMap.has(mid)) {
        const existing = compMap.get(mid);
        if (m.event_match_locked && !existing.event_match_locked) {
          existing.event_match_locked = true;
          existing.event_id = m.event_id || existing.event_id;
          existing.round_num = m.round_num || existing.round_num;
          existing.table_num = m.table_num || existing.table_num;
          existing.mapped_event_name = m.mapped_event_name || existing.mapped_event_name;
        }
        if (m.edition && !existing.edition) existing.edition = m.edition;
        if (m.edition_label && !existing.edition_label) existing.edition_label = m.edition_label;
      } else {
        compMap.set(mid, m);
      }
    });

    data.completed_history = Array.from(compMap.values());
    data.tracker_history = data.completed_history;

    if (Array.isArray(data.registered_tournaments)) {
      data.registered_tournaments = data.registered_tournaments.filter(isValidRegisteredTournament);
    }

    data._gameSystem = gs;
    data._journeySchemaVer = 4;
    myHubData = data;
    try {
      localStorage.setItem(cacheStorageKey, JSON.stringify(data));
      if (gs === '40k') {
        localStorage.setItem('my_hub_cache', JSON.stringify(data));
      }
    } catch (e) {}

    if (mySeq !== _myHubLoadSeq) return;

    await renderMyHub(data);
    if (typeof prefetchHubMappableEventMatches === 'function') {
      prefetchHubMappableEventMatches(gs);
    }
    if (typeof prefetchHubTopTournaments === 'function') {
      prefetchHubTopTournaments(data);
    }
    if (window.Armory && typeof window.Armory.renderActiveRivalHexBanner === 'function') {
      window.Armory.renderActiveRivalHexBanner('my-hub-content');
    }
    if (window.Armory && typeof window.Armory.checkAndTriggerSignInPokeEffect === 'function') {
      window.Armory.checkAndTriggerSignInPokeEffect(data);
    }

    // Background-hydrate live BCP tournament registrations without blocking dashboard render
    regPromise.then(regVal => {
      if (mySeq !== _myHubLoadSeq || !regVal || !Array.isArray(regVal.tournaments)) return;
      const freshRegs = regVal.tournaments.filter(isValidRegisteredTournament);
      data.registered_tournaments = freshRegs;
      myHubData = data;
      try {
        localStorage.setItem(cacheStorageKey, JSON.stringify(data));
        if (gs === '40k') {
          localStorage.setItem('my_hub_cache', JSON.stringify(data));
        }
      } catch (e) {}
      const isBcpConn = Boolean(regVal.bcp_connected || (currentUser && (currentUser.bcp_connected || currentUser.bcp_user_id || currentUser.bcp_token || currentUser.bcp_email)));
      const cardEl = document.getElementById('hub-registered-tournaments-card');
      if (cardEl) {
        const searchEl = document.getElementById('hub-registered-events-search');
        const activeFilter = searchEl ? searchEl.value : '';
        cardEl.outerHTML = renderRegisteredTournamentsCard(freshRegs, isBcpConn);
        if (activeFilter) {
          const newSearchEl = document.getElementById('hub-registered-events-search');
          if (newSearchEl) newSearchEl.value = activeFilter;
          filterHubRegisteredEvents(activeFilter);
        }
      }
      const previewEl = document.getElementById('hub-overview-events-preview');
      if (previewEl) {
        previewEl.outerHTML = renderNextEventOverviewPreview(freshRegs, isBcpConn);
      }
      const activeSubtabCountEl = document.querySelector('#hub-subtabs-bar .profile-subtab-btn[data-tab="active"] .profile-subtab-count');
      if (activeSubtabCountEl) {
        const actLen = (data.active_sessions && data.active_sessions.length) || 0;
        activeSubtabCountEl.textContent = String(actLen + freshRegs.length);
      }
      if (typeof prefetchHubTopTournaments === 'function') {
        prefetchHubTopTournaments(data);
      }
    }).catch(() => {});
  } catch (err) {
    console.warn("Notice updating competitor hub from server:", err);
    if (!cachedData) {
      container.innerHTML = `<div class="empty-state" style="color:var(--loss);">Error loading competitor hub: ${escapeHtml(err.message)}</div>`;
    }
  }
}

var _hubPrefetchTimer = null;
var _prefetchedEventIds = new Set();

function prefetchHubTopTournaments(data) {
  if (!data || !window.api || typeof window.api.getTournamentDetails !== 'function') return;
  if (_hubPrefetchTimer) clearTimeout(_hubPrefetchTimer);
  _hubPrefetchTimer = setTimeout(() => {
    if (document.querySelector('.modal-backdrop.active')) return;
    const candidateIds = [];
    const addId = (rawId) => {
      const eid = String(rawId || '').trim();
      if (!eid || eid.startsWith('g-') || eid.startsWith('game-') || eid.startsWith('league_') || _prefetchedEventIds.has(eid) || candidateIds.includes(eid)) return;
      if (candidateIds.length < 1) candidateIds.push(eid);
    };
    (data.registered_tournaments || []).slice(0, 1).forEach(e => addId(e && (e.bcp_event_id || e.event_id || e.id)));
    if (candidateIds.length === 0) {
      (data.events_attended || []).slice(0, 1).forEach(e => addId(e && (e.event_id || e.bcp_event_id || e.id)));
    }

    candidateIds.forEach((eid) => {
      _prefetchedEventIds.add(eid);
      if (typeof window.getWarmEventModalCache === 'function' && window.getWarmEventModalCache(eid)) {
        return;
      }
      window.api.getTournamentDetails(eid, false).then((ev) => {
        if (ev && !ev.error && typeof window.saveEventModalCache === 'function') {
          window.saveEventModalCache(eid, ev, null);
        }
      }).catch(() => {});
    });
  }, 2500);
}
window.prefetchHubTopTournaments = prefetchHubTopTournaments;

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
      window.Armory.openArmoryModal('backpack', typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
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
  if (typeof window !== 'undefined') {
    window.currentProfilePlayerId = null;
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

window._hubRegEventsActiveTab = 'all';

function switchHubRegisteredEventsTab(tab) {
  window._hubRegEventsActiveTab = tab || 'all';
  const tabBtns = document.querySelectorAll('.hub-reg-events-tab-btn');
  tabBtns.forEach(btn => {
    const isAct = btn.getAttribute('data-reg-tab') === window._hubRegEventsActiveTab;
    btn.classList.toggle('active', isAct);
    btn.style.background = isAct ? 'rgba(56, 189, 248, 0.18)' : 'transparent';
    btn.style.color = isAct ? '#38bdf8' : '#94a3b8';
    btn.style.borderColor = isAct ? 'rgba(56, 189, 248, 0.45)' : 'transparent';
  });
  const searchInput = document.getElementById('hub-registered-events-search');
  filterHubRegisteredEvents(searchInput ? searchInput.value : '');
}
window.switchHubRegisteredEventsTab = switchHubRegisteredEventsTab;

function filterHubRegisteredEvents(query) {
  const q = (query || '').trim().toLowerCase();
  const activeTab = window._hubRegEventsActiveTab || 'all';
  const items = document.querySelectorAll('#hub-registered-events-list .hub-event-item-card');
  let visibleCount = 0;
  items.forEach(el => {
    const cat = el.getAttribute('data-event-category') || 'tournaments';
    const matchesTab = (activeTab === 'all') || (cat === activeTab);
    const text = el.textContent.toLowerCase();
    const matchesQuery = !q || text.includes(q);
    const show = matchesTab && matchesQuery;
    el.style.display = show ? '' : 'none';
    if (show) visibleCount++;
  });
  const emptyEl = document.getElementById('hub-reg-events-empty-tab');
  if (emptyEl) {
    if (visibleCount === 0) {
      const label = activeTab === 'leagues' ? 'registered leagues' : (activeTab === 'tournaments' ? 'registered tournaments' : 'registered events');
      emptyEl.style.display = 'block';
      emptyEl.innerHTML = `<div style="padding: 1.35rem 1rem; text-align: center; color: #94a3b8; font-size: 0.82rem; background: rgba(15,23,42,0.5); border: 1px dashed rgba(148,163,184,0.2); border-radius: 10px;">No ${label} match your filter.</div>`;
    } else {
      emptyEl.style.display = 'none';
    }
  }
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
  window._hubRegisteredEventsCache = events;
  const activeTab = window._hubRegEventsActiveTab || 'all';

  const leaguesCount = events.filter(ev => {
    const evId = ev.id || ev.bcp_event_id || '';
    return Boolean(ev.is_native_league || String(evId).startsWith('league_') || String(evId).includes('8f5e3b2c'));
  }).length;
  const tournamentsCount = events.length - leaguesCount;
  
  if (!isBcpConnected && events.length === 0) {
    return `
      <div class="hub-card" id="hub-registered-tournaments-card" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">📅 Registered Events</h3>
            </div>
          </div>
          <div style="background: rgba(56, 189, 248, 0.05); border: 1px dashed rgba(56, 189, 248, 0.3); border-radius: 12px; padding: 1.75rem 1.25rem; text-align: center;">
            <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔗</div>
            <h4 style="color: #fff; font-size: 1rem; font-weight: 700; margin: 0 0 0.4rem 0;">Connect Best Coast Pairings</h4>
            <p style="color: var(--text-secondary); font-size: 0.82rem; margin: 0 0 1rem 0; line-height: 1.4;">
              Link your BCP account to automatically sync tournaments and leagues you are playing in, track army list submission deadlines, and view roster countdowns.
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
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.7rem; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">📅 Registered Events</h3>
            ${events.length > 0 ? `<span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 0.72rem; padding: 0.15rem 0.5rem;">${events.length} Active</span>` : ''}
          </div>
          <button id="hub-bcp-sync-btn" onclick="syncBcpRegisteredTournaments()" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.7rem; display: inline-flex; align-items: center; gap: 0.35rem;" title="Refresh tournament and league registrations">
            <span id="hub-bcp-sync-icon">🔄</span> Refresh
          </button>
        </div>

        ${events.length > 0 ? `
          <div class="hub-reg-events-tabs" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.35rem; background: rgba(15, 23, 42, 0.75); padding: 0.28rem; border-radius: 10px; border: 1px solid rgba(148, 163, 184, 0.16); margin-bottom: 0.65rem;">
            <button type="button" class="hub-reg-events-tab-btn ${activeTab === 'all' ? 'active' : ''}" data-reg-tab="all" onclick="switchHubRegisteredEventsTab('all')" style="border: 1px solid ${activeTab === 'all' ? 'rgba(56, 189, 248, 0.45)' : 'transparent'}; background: ${activeTab === 'all' ? 'rgba(56, 189, 248, 0.18)' : 'transparent'}; color: ${activeTab === 'all' ? '#38bdf8' : '#94a3b8'}; border-radius: 7px; padding: 0.38rem 0.4rem; font-size: 0.74rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.3rem; white-space: nowrap;">
              <span>All</span>
              <span style="background: rgba(255,255,255,0.1); padding: 1px 6px; border-radius: 999px; font-size: 0.68rem;">${events.length}</span>
            </button>
            <button type="button" class="hub-reg-events-tab-btn ${activeTab === 'tournaments' ? 'active' : ''}" data-reg-tab="tournaments" onclick="switchHubRegisteredEventsTab('tournaments')" style="border: 1px solid ${activeTab === 'tournaments' ? 'rgba(56, 189, 248, 0.45)' : 'transparent'}; background: ${activeTab === 'tournaments' ? 'rgba(56, 189, 248, 0.18)' : 'transparent'}; color: ${activeTab === 'tournaments' ? '#38bdf8' : '#94a3b8'}; border-radius: 7px; padding: 0.38rem 0.4rem; font-size: 0.74rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.3rem; white-space: nowrap;">
              <span>🏆 Tournaments</span>
              <span style="background: rgba(255,255,255,0.1); padding: 1px 6px; border-radius: 999px; font-size: 0.68rem;">${tournamentsCount}</span>
            </button>
            <button type="button" class="hub-reg-events-tab-btn ${activeTab === 'leagues' ? 'active' : ''}" data-reg-tab="leagues" onclick="switchHubRegisteredEventsTab('leagues')" style="border: 1px solid ${activeTab === 'leagues' ? 'rgba(56, 189, 248, 0.45)' : 'transparent'}; background: ${activeTab === 'leagues' ? 'rgba(56, 189, 248, 0.18)' : 'transparent'}; color: ${activeTab === 'leagues' ? '#38bdf8' : '#94a3b8'}; border-radius: 7px; padding: 0.38rem 0.4rem; font-size: 0.74rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.3rem; white-space: nowrap;">
              <span>⚔️ Leagues</span>
              <span style="background: rgba(255,255,255,0.1); padding: 1px 6px; border-radius: 999px; font-size: 0.68rem;">${leaguesCount}</span>
            </button>
          </div>

          <div style="margin-bottom: 0.7rem;">
            <input type="text" id="hub-registered-events-search" class="hub-search-input" placeholder="🔍 Filter registered tournaments & leagues..." oninput="filterHubRegisteredEvents(this.value)">
          </div>
          <div id="hub-reg-events-empty-tab" style="display: none; margin-bottom: 0.5rem;"></div>
          <div id="hub-registered-events-list" class="hub-events-scroll-container">
            ${events.map(ev => {
              const evId = ev.id || ev.bcp_event_id || '';
              const isNativeLeague = Boolean(ev.is_native_league || String(evId).startsWith('league_'));
              const category = isNativeLeague ? 'leagues' : 'tournaments';
              const isHiddenByTab = (activeTab !== 'all' && activeTab !== category);
              const evName = ev.event_name || ev.name || 'Tournament';
              const evDate = ev.event_date || ev.start_date || '';
              const dateDisplay = (evDate ? evDate.substring(0, 10) : 'TBD');

              if (isNativeLeague) {
                const podNum = ev.pod_number || 1;
                const podName = ev.pod_name || `Pod #${podNum}`;
                const rankNum = ev.rank || 1;
                const recordStr = ev.record || `${ev.wins || 0}-${ev.losses || 0}-${ev.draws || 0}`;
                const bpVal = ev.battle_points ?? 0;
                const pairingsCount = (ev.pairings && ev.pairings.length) || ev.rounds || 5;
                const safeEntryId = escapeHtml(String(evId)).replace(/'/g, "\\'");
                const annList = Array.isArray(ev.announcements) ? ev.announcements : [];
                const topAnn = ev.latest_announcement || annList[0] || null;
                return `
                  <div class="hub-event-item-card" data-event-category="leagues" data-native-league-id="${escapeHtml(String(evId))}" style="${isHiddenByTab ? 'display:none;' : ''} cursor: pointer; border: 1px solid rgba(56, 189, 248, 0.38); background: linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(30, 58, 138, 0.22)); padding: 0.85rem 0.95rem; gap: 0.5rem;" onclick="openUserLeagueGamesQuickModal('${safeEntryId}')">
                    <div class="hub-event-badge-row" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.35rem;">
                      <span class="badge" style="background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-size: 0.68rem; padding: 2px 7px; font-weight: 800; letter-spacing: 0.02em;">⚔️ ACTIVE LEAGUE</span>
                      <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                        <span class="badge" style="background: rgba(245, 158, 11, 0.22); color: #fde68a; border: 1px solid rgba(245, 158, 11, 0.45); font-size: 0.68rem; padding: 2px 7px; font-weight: 800;">🔔 ${annList.length || 1} TO Notice${annList.length === 1 ? '' : 's'}</span>
                        <span class="badge" style="background: rgba(16,185,129,0.16); color: #34d399; border: 1px solid rgba(16,185,129,0.35); font-size: 0.69rem; padding: 2px 7px; font-weight: 700;">🟢 Pod #${podNum} • Rank #${rankNum}</span>
                        <span class="badge" style="background: rgba(59,130,246,0.18); color: #93c5fd; border: 1px solid rgba(59,130,246,0.35); font-size: 0.69rem; padding: 2px 7px; font-weight: 700;">${escapeHtml(recordStr)} (${bpVal} VP)</span>
                      </div>
                    </div>

                    <div class="hub-event-title" style="color: #38bdf8; font-size: 0.96rem; font-weight: 800; line-height: 1.35; width: 100%; word-break: break-word;">
                      ${escapeHtml(evName)}
                    </div>

                    ${topAnn ? `
                      <div style="background: rgba(245, 158, 11, 0.12); border-left: 3px solid #f59e0b; border-radius: 5px; padding: 0.35rem 0.55rem; font-size: 0.73rem; color: #fef3c7; line-height: 1.35;">
                        <strong style="color: #fbbf24;">📢 TO Alert:</strong> ${escapeHtml(topAnn.title || '')}
                      </div>
                    ` : ''}

                    <div class="hub-event-meta" style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.45rem 0.7rem; font-size: 0.76rem; color: #cbd5e1;">
                      <span>📅 <b>${escapeHtml(dateDisplay)}</b></span>
                      <span>📍 <b>${escapeHtml(podName)}</b> (${escapeHtml(ev.city || 'San Diego')}, ${escapeHtml(ev.state || 'CA')})</span>
                      <span>⚔️ 2000 pts • ${pairingsCount} Games</span>
                    </div>

                    <div class="hub-event-footer-row" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.45rem; padding-top: 0.45rem; border-top: 1px solid rgba(255,255,255,0.08);">
                      <span style="font-size: 0.76rem; color: #fff; min-width: 0;">
                        🛡️ <b>${escapeHtml(ev.faction || ev.primary_faction || 'Army Unassigned')}</b>
                        ${ev.player_name ? `<span style="color: var(--text-muted);"> (${escapeHtml(ev.player_name)})</span>` : ''}
                      </span>
                      <span class="badge hub-event-cta-pill" style="background: rgba(56,189,248,0.16); color: #38bdf8; border: 1px solid rgba(56,189,248,0.4); font-size: 0.72rem; padding: 6px 10px; font-weight: 800; text-align: center; box-sizing: border-box; width: 100%; max-width: 100%; display: block;">
                        🎯 View My ${pairingsCount} Scheduled Games &amp; TO Alerts →
                      </span>
                    </div>
                  </div>
                `;
              }

              const bcpEvId = ev.bcp_event_id || ev.id || '';
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

              return `
                <div class="hub-event-item-card" data-event-category="tournaments" style="${isHiddenByTab ? 'display:none;' : ''} cursor: pointer; padding: 0.85rem 0.95rem; gap: 0.5rem;" onclick="openEventModal('${encodeURIComponent(bcpEvId)}', false)">
                  <div class="hub-event-badge-row" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.35rem;">
                    <span class="badge" style="background: rgba(56, 189, 248, 0.12); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.3); font-size: 0.68rem; padding: 2px 7px; font-weight: 800;">🏆 TOURNAMENT</span>
                    <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                      ${checkinStatus}
                      ${countdownPill}
                    </div>
                  </div>

                  <div class="hub-event-title" style="color: #f8fafc; font-size: 0.96rem; font-weight: 800; line-height: 1.35; width: 100%; word-break: break-word;">
                    ${escapeHtml(evName)}
                  </div>

                  <div class="hub-event-meta" style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.45rem 0.7rem; font-size: 0.76rem; color: #cbd5e1;">
                    <span>📅 <b>${escapeHtml(dateDisplay)}</b></span>
                    <span>📍 ${escapeHtml(locationStr)}</span>
                    ${ev.points_limit ? `<span>⚔️ ${ev.points_limit} pts${ev.rounds ? ` • ${ev.rounds} Rounds` : ''}</span>` : (ev.rounds ? `<span>⚔️ ${ev.rounds} Rounds</span>` : '')}
                  </div>

                  <div class="hub-event-footer-row" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.45rem; padding-top: 0.45rem; border-top: 1px solid rgba(255,255,255,0.06);">
                    <span style="font-size: 0.76rem; color: #fff; min-width: 0;">
                      🛡️ <b>${escapeHtml(ev.faction || 'Army Unassigned')}</b>
                      ${ev.detachment ? `<span style="color: var(--text-muted);"> (${escapeHtml(ev.detachment)})</span>` : ''}
                    </span>
                    ${listStatus}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : `
          <div style="padding: 2rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
            <div style="font-size: 1.5rem; margin-bottom: 0.4rem;">📅</div>
            <div style="font-weight: 600; color: #cbd5e1; margin-bottom: 0.25rem;">No registered events found</div>
            <div style="font-size: 0.78rem; margin-bottom: 0.75rem;">When you register for tournaments on Best Coast Pairings or join a league, they will automatically appear here!</div>
            <button onclick="syncBcpRegisteredTournaments()" class="btn btn-outline" style="font-size: 0.78rem; padding: 0.35rem 0.8rem;">
              🔄 Refresh Registrations
            </button>
          </div>
        `}
      </div>
    </div>
  `;
}

function closeUserLeagueGamesQuickModal() {
  const existing = document.getElementById('user-league-games-quick-modal');
  if (existing) existing.remove();
}
window.closeUserLeagueGamesQuickModal = closeUserLeagueGamesQuickModal;

async function openUserLeagueGamesQuickModal(entryId) {
  closeUserLeagueGamesQuickModal();
  const cachedList = window._hubRegisteredEventsCache || [];
  let eventIndex = cachedList.findIndex(item => String(item.id || item.bcp_event_id) === String(entryId));
  if (eventIndex === -1) {
    eventIndex = cachedList.findIndex(item => item.is_native_league);
  }
  let ev = eventIndex !== -1 ? cachedList[eventIndex] : null;

  if (!ev) {
    try {
      const resp = await fetch('/api/user/registered-tournaments');
      if (resp.ok) {
        try {
          const json = await resp.json();
          const list = json.tournaments || [];
          window._hubRegisteredEventsCache = list;
          eventIndex = list.findIndex(item => String(item.id || item.bcp_event_id) === String(entryId) || item.is_native_league);
          ev = eventIndex !== -1 ? list[eventIndex] : null;
        } catch (_) {}
      }
    } catch (err) {
      console.warn('[MyHub] Failed to fetch registered league details:', err);
    }
  }
  if (!ev) return;
  if (eventIndex === -1) eventIndex = 0;

  const leagueId = ev.league_id || '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90';
  const podNum = ev.pod_number || 1;
  const podName = ev.pod_name || `Pod #${podNum}`;
  const playerName = ev.player_name || 'Player';
  const playerFaction = ev.faction || ev.primary_faction || 'Warhammer 40K';
  const rankNum = ev.rank || 1;
  const recordStr = ev.record || `${ev.wins || 0}-${ev.losses || 0}-${ev.draws || 0}`;
  const bpVal = ev.battle_points ?? 0;
  const pairings = Array.isArray(ev.pairings) ? ev.pairings : [];

  // Live-fetch latest announcements from PostgreSQL so any newly published TO announcement appears immediately
  let liveAnnouncements = Array.isArray(ev.announcements) ? ev.announcements : [];
  try {
    const annResp = await fetch(`/api/league/${encodeURIComponent(leagueId)}/announcements`);
    if (annResp.ok) {
      const annData = await annResp.json();
      if (Array.isArray(annData.announcements) && annData.announcements.length > 0) {
        liveAnnouncements = annData.announcements.filter(a =>
          !a.target_pod || a.target_pod === 'All Pods' || a.target_pod === `Pod #${podNum}` || a.target_pod === `Pod ${podNum}` || String(a.target_pod) === String(podNum)
        );
      }
    }
  } catch (_) {}

  const modalOverlay = document.createElement('div');
  modalOverlay.id = 'user-league-games-quick-modal';
  modalOverlay.className = 'modal-backdrop active';
  modalOverlay.style.cssText = 'position: fixed; inset: 0; z-index: 10005; background: rgba(2, 6, 23, 0.85); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 0.75rem;';
  modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) closeUserLeagueGamesQuickModal();
  };

  const safePlayerName = escapeHtml(playerName).replace(/'/g, "\\'");
  const safePlayerFaction = escapeHtml(playerFaction).replace(/'/g, "\\'");
  const safeLeagueId = escapeHtml(leagueId).replace(/'/g, "\\'");

  modalOverlay.innerHTML = `
    <style>
      .quick-league-modal-card {
        background: #0f172a;
        border: 1px solid rgba(56, 189, 248, 0.35);
        border-radius: 14px;
        width: 100%;
        max-width: 780px;
        max-height: 92vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 25px 60px rgba(0, 0, 0, 0.75);
        overflow: hidden;
      }
      .quick-league-kpi-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.65rem;
        padding: 0.85rem 1.25rem;
        background: rgba(2, 6, 23, 0.55);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      .quick-league-match-row {
        border-radius: 10px;
        padding: 0.85rem 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
      }
      .quick-league-match-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      .quick-league-actions {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        flex-wrap: wrap;
      }
      @media (max-width: 640px) {
        .quick-league-kpi-grid {
          grid-template-columns: repeat(2, 1fr) !important;
          gap: 0.5rem !important;
          padding: 0.75rem 0.9rem !important;
        }
        .quick-league-header {
          padding: 0.95rem 1rem !important;
        }
        .quick-league-body {
          padding: 0.9rem 1rem !important;
        }
        .quick-league-match-top {
          flex-direction: column;
          align-items: flex-start !important;
        }
        .quick-league-actions {
          width: 100%;
          display: grid !important;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.4rem !important;
        }
        .quick-league-actions button {
          width: 100%;
          justify-content: center;
          padding: 0.45rem 0.35rem !important;
          font-size: 0.72rem !important;
          text-align: center;
        }
      }
    </style>
    <div class="quick-league-modal-card">
      <!-- Modal Header -->
      <div class="quick-league-header" style="padding: 1.15rem 1.35rem; background: linear-gradient(135deg, rgba(30, 58, 138, 0.45), rgba(15, 23, 42, 0.95)); border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.55rem;">
          <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-size: 0.68rem; font-weight: 800; padding: 3px 8px;">🏆 ACTIVE LEAGUE POD SCHEDULE</span>
          <div style="display: flex; align-items: center; gap: 0.45rem; flex-shrink: 0;">
            <button type="button" onclick="closeUserLeagueGamesQuickModal(); if (typeof leagueState !== 'undefined') { leagueState.activePodNumber = ${podNum}; } window.location.hash = '#/40k/league/${safeLeagueId}';" class="btn btn-outline" style="padding: 0.35rem 0.7rem; font-size: 0.74rem; font-weight: 700; border-color: rgba(56, 189, 248, 0.45); color: #38bdf8;">
              🏛️ Full League Hub
            </button>
            <button type="button" onclick="closeUserLeagueGamesQuickModal()" style="background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.14); color: #cbd5e1; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center;">
              ✕
            </button>
          </div>
        </div>
        <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #fff; line-height: 1.3;">
          ${escapeHtml(ev.event_name || 'San Diego Force Org (SD40K) — Season 38')}
        </h3>
        <div style="font-size: 0.84rem; color: #94a3b8; margin-top: 0.3rem; line-height: 1.4;">
          📍 <strong style="color: #38bdf8;">${escapeHtml(podName)}</strong> • Competitor: <strong style="color: #fff;">${escapeHtml(playerName)}</strong> (<span style="color: #cbd5e1;">${escapeHtml(playerFaction)}</span>)
        </div>
      </div>

      <!-- KPI Summary Strip (Responsive 4-col Desktop / 2x2 Mobile) -->
      <div class="quick-league-kpi-grid">
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 0.5rem 0.75rem;">
          <div style="font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8;">Assigned Pod</div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #38bdf8; margin-top: 2px;">Pod #${podNum}</div>
        </div>
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 0.5rem 0.75rem;">
          <div style="font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8;">Pod Standing</div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #fbbf24; margin-top: 2px;">Rank #${rankNum}</div>
        </div>
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 0.5rem 0.75rem;">
          <div style="font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8;">W-L-D Record</div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #34d399; margin-top: 2px;">${escapeHtml(recordStr)}</div>
        </div>
        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 0.5rem 0.75rem;">
          <div style="font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8;">Battle Points</div>
          <div style="font-size: 0.95rem; font-weight: 800; color: #60a5fa; margin-top: 2px;">${bpVal} VP</div>
        </div>
      </div>

      <!-- Modal Body: TO Announcements + 5 Pod Matchups -->
      <div class="quick-league-body" style="padding: 1.15rem 1.35rem; overflow-y: auto; flex: 1;">
        ${liveAnnouncements.length > 0 ? `
          <div id="quick-league-announcements-box" style="margin-bottom: 1rem; padding: 0.8rem 0.95rem; background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(15, 23, 42, 0.95)); border: 1px solid rgba(245, 158, 11, 0.45); border-left: 4px solid #f59e0b; border-radius: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-bottom: 0.45rem;">
              <span style="font-size: 0.75rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.03em;">
                🔔 Commissioner Announcements &amp; Pod #${podNum} Alerts (${liveAnnouncements.length})
              </span>
              <button type="button" onclick="closeUserLeagueGamesQuickModal(); if (typeof leagueState !== 'undefined') { leagueState.activeSubtab = 'announcements'; } window.location.hash = '#/40k/league/${safeLeagueId}';" style="background: none; border: none; color: #38bdf8; font-size: 0.73rem; font-weight: 700; cursor: pointer; text-decoration: underline;">
                Open News Tab →
              </button>
            </div>
            ${liveAnnouncements.slice(0, 2).map(ann => `
              <div style="padding: 0.45rem 0.6rem; background: rgba(2, 6, 23, 0.65); border-radius: 7px; margin-bottom: 0.35rem; border: 1px solid rgba(255,255,255,0.06);">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; flex-wrap: wrap;">
                  <strong style="color: #fff; font-size: 0.82rem;">${escapeHtml(ann.title || 'League Notice')}</strong>
                  <span style="font-size: 0.68rem; color: #94a3b8;">${escapeHtml(ann.target_pod || 'All Pods')} • ${escapeHtml(String(ann.created_at || '').slice(0, 10))}</span>
                </div>
                <div style="font-size: 0.77rem; color: #cbd5e1; margin-top: 0.2rem; line-height: 1.4;">${escapeHtml(ann.body || '')}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
          <h4 style="margin: 0; font-size: 0.95rem; font-weight: 800; color: #fff;">
            ⚔️ Your 5 Pod Opponents
          </h4>
          <div style="display: flex; align-items: center; gap: 0.45rem; font-size: 0.71rem; font-weight: 700;">
            <span style="background: rgba(16, 185, 129, 0.18); border: 1px solid rgba(16, 185, 129, 0.45); color: #34d399; padding: 2px 8px; border-radius: 5px;">🟢 Played</span>
            <span style="background: rgba(56, 189, 248, 0.14); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; padding: 2px 8px; border-radius: 5px;">🔵 Yet to Play</span>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.65rem;">
          ${pairings.map((pair, idx) => {
            const rNum = pair.round || (idx + 1);
            const layoutStr = pair.layout || 'Layout A';
            const oppName = pair.opponent_clean_name || (pair.opponent_name || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || 'TBD';
            const oppFaction = pair.opponent_faction || 'Unknown Faction';
            const oppPid = (pair.opponent_bcp_player_id && !String(pair.opponent_bcp_player_id).startsWith('bcp_')) ? pair.opponent_bcp_player_id : '';
            const oppMatched = Boolean(pair.opponent_is_db_matched && oppPid);
            const safeOppName = escapeHtml(oppName).replace(/'/g, "\\'");
            const safeOppFaction = escapeHtml(oppFaction).replace(/'/g, "\\'");
            const safeOppPid = escapeHtml(oppPid).replace(/'/g, "\\'");
            const safeLayout = escapeHtml(layoutStr).replace(/'/g, "\\'");
            const pScoreVal = pair.player_score ?? 0;
            const oScoreVal = pair.opponent_score ?? 0;
            const isCompleted = pair.status === 'completed' || Boolean(pair.result) || Boolean(pair.is_completed) || (pScoreVal > 0 || oScoreVal > 0);
            const scoreStr = pair.score || `${pScoreVal} - ${oScoreVal}`;
            const drawerId = `quick-score-drawer-${idx}`;

            return `
              <div class="quick-league-match-row" style="background: ${isCompleted ? 'rgba(16, 185, 129, 0.12)' : 'rgba(15, 23, 42, 0.82)'}; border: 1px solid ${isCompleted ? 'rgba(16, 185, 129, 0.48)' : 'rgba(56, 189, 248, 0.32)'};">
                <div class="quick-league-match-top">
                  <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; flex: 1;">
                    <span id="quick-status-badge-${idx}" style="font-size: 0.71rem; font-weight: 800; padding: 3px 8px; border-radius: 5px; background: ${isCompleted ? 'rgba(16, 185, 129, 0.22)' : 'rgba(56, 189, 248, 0.16)'}; color: ${isCompleted ? '#34d399' : '#38bdf8'}; border: 1px solid ${isCompleted ? 'rgba(16, 185, 129, 0.45)' : 'rgba(56, 189, 248, 0.4)'};">
                      ${isCompleted ? `✓ PLAYED (${escapeHtml(scoreStr)})` : 'YET TO PLAY'}
                    </span>
                    ${oppMatched ? `
                      <button type="button" onclick="if (typeof openPlayerModal === 'function') openPlayerModal('${safeOppPid}', '${safeOppName}');" style="background: none; border: none; padding: 0; color: #38bdf8; font-weight: 800; font-size: 0.98rem; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-align: left;">
                        ${escapeHtml(oppName)}
                      </button>
                    ` : `
                      <span style="color: #fff; font-weight: 800; font-size: 0.98rem;">
                        ${escapeHtml(oppName)}
                      </span>
                    `}
                    <span style="background: rgba(245, 158, 11, 0.16); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.38); font-size: 0.74rem; font-weight: 700; padding: 2px 8px; border-radius: 6px;">
                      🛡️ ${escapeHtml(oppFaction)}
                    </span>
                  </div>

                  <div class="quick-league-actions">
                    <button type="button" onclick="closeUserLeagueGamesQuickModal(); if (typeof launchLeagueMatchTracker === 'function') { launchLeagueMatchTracker('${safePlayerName}', '${safeOppName}', '${safePlayerFaction}', '${safeLayout}', ${rNum}, '${safeLeagueId}', ${podNum}, '${safeOppFaction}'); } else { window.location.hash = '#/40k/tracker'; }" class="btn btn-primary" style="padding: 0.4rem 0.75rem; font-size: 0.75rem; font-weight: 700; background: linear-gradient(135deg, #2563eb, #3b82f6); border: none;">
                      🎲 Tracker
                    </button>
                    <button type="button" onclick="toggleQuickModalInlineScore('${drawerId}')" class="btn btn-outline" style="padding: 0.4rem 0.75rem; font-size: 0.75rem; font-weight: 700; border-color: rgba(16, 185, 129, 0.45); color: #34d399; background: rgba(16, 185, 129, 0.08);">
                      📝 Enter Score
                    </button>
                    ${oppMatched ? `
                      <button type="button" onclick="closeUserLeagueGamesQuickModal(); if (typeof openLeagueOpponentChat === 'function') { openLeagueOpponentChat('${safeOppName}', '${safePlayerName}', ${rNum}, ${podNum}, '${safeOppPid}'); }" class="btn btn-outline" style="padding: 0.4rem 0.7rem; font-size: 0.75rem; font-weight: 700; border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;">
                        💬 Message
                      </button>
                    ` : ''}
                  </div>
                </div>

                <!-- Inline Manual Score Entry Drawer -->
                <div id="${drawerId}" style="display: none; padding-top: 0.65rem; border-top: 1px dashed rgba(255, 255, 255, 0.12);">
                  <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.6rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; flex: 1;">
                      <label style="font-size: 0.74rem; color: #cbd5e1; font-weight: 700; display: flex; align-items: center; gap: 0.35rem;">
                        <span>${escapeHtml(playerName)} VP:</span>
                        <input id="${drawerId}-p1" type="number" min="0" max="100" value="${pScoreVal || ''}" placeholder="0-100" style="width: 68px; padding: 0.32rem 0.45rem; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.45); background: #020617; color: #fff; font-weight: 800; font-size: 0.85rem; text-align: center;">
                      </label>
                      <span style="color: #64748b; font-weight: 800; font-size: 0.8rem;">vs</span>
                      <label style="font-size: 0.74rem; color: #cbd5e1; font-weight: 700; display: flex; align-items: center; gap: 0.35rem;">
                        <span>${escapeHtml(oppName)} VP:</span>
                        <input id="${drawerId}-p2" type="number" min="0" max="100" value="${oScoreVal || ''}" placeholder="0-100" style="width: 68px; padding: 0.32rem 0.45rem; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.45); background: #020617; color: #fff; font-weight: 800; font-size: 0.85rem; text-align: center;">
                      </label>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                      <button type="button" id="${drawerId}-save-btn" onclick="submitQuickModalInlineScore('${safeLeagueId}', ${podNum}, ${rNum}, '${safePlayerName}', '${safeOppName}', '${drawerId}', ${idx}, ${eventIndex})" class="btn btn-primary" style="padding: 0.38rem 0.8rem; font-size: 0.75rem; font-weight: 800; background: #10b981; border: none; color: #022c22;">
                        ✓ Save Score
                      </button>
                      <button type="button" onclick="toggleQuickModalInlineScore('${drawerId}')" class="btn btn-outline" style="padding: 0.38rem 0.6rem; font-size: 0.74rem; color: #94a3b8; border-color: rgba(255,255,255,0.15);">
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);
}
window.openUserLeagueGamesQuickModal = openUserLeagueGamesQuickModal;

function toggleQuickModalInlineScore(drawerId) {
  const el = document.getElementById(drawerId);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
window.toggleQuickModalInlineScore = toggleQuickModalInlineScore;

async function submitQuickModalInlineScore(leagueId, podNum, roundNum, player1, player2, drawerId, pairIdx, eventIndex) {
  const p1Input = document.getElementById(`${drawerId}-p1`);
  const p2Input = document.getElementById(`${drawerId}-p2`);
  const saveBtn = document.getElementById(`${drawerId}-save-btn`);
  if (!p1Input || !p2Input) return;

  const score1 = parseInt(p1Input.value, 10);
  const score2 = parseInt(p2Input.value, 10);
  if (isNaN(score1) || isNaN(score2) || score1 < 0 || score2 < 0 || score1 > 100 || score2 > 100) {
    if (typeof showToast === 'function') {
      showToast('Please enter valid Victory Points between 0 and 100 for both players.', 'warning');
    } else {
      alert('Please enter valid Victory Points between 0 and 100 for both players.');
    }
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const res = await fetch(`/api/league/${encodeURIComponent(leagueId || '8f5e3b2c-9a14-5d7e-8b3a-1f2c4e6d8a90')}/match/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pod_number: podNum,
        round_number: roundNum,
        player1: player1,
        player2: player2,
        score1: score1,
        score2: score2,
        source: 'Quick Modal Manual Entry'
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    // Update local state in window._hubRegisteredEventsCache so reopening reflects immediately
    const events = window._hubRegisteredEventsCache || window._hubLeagueParticipatingEvents || [];
    const ev = events[eventIndex] || events.find(item => item.is_native_league) || events[0];
    if (ev && Array.isArray(ev.pairings) && ev.pairings[pairIdx]) {
      ev.pairings[pairIdx].player_score = score1;
      ev.pairings[pairIdx].opponent_score = score2;
      ev.pairings[pairIdx].score = `${score1} - ${score2}`;
      ev.pairings[pairIdx].status = 'completed';
      ev.pairings[pairIdx].is_completed = true;
    }

    const badgeEl = document.getElementById(`quick-status-badge-${pairIdx}`);
    if (badgeEl) {
      badgeEl.textContent = `✓ PLAYED (${score1} - ${score2})`;
      badgeEl.style.background = 'rgba(16, 185, 129, 0.22)';
      badgeEl.style.color = '#34d399';
      badgeEl.style.borderColor = 'rgba(16, 185, 129, 0.45)';
    }
    toggleQuickModalInlineScore(drawerId);

    if (typeof showToast === 'function') {
      showToast(`Score saved: ${player1} (${score1} VP) vs ${player2} (${score2} VP)`, 'success');
    }
  } catch (err) {
    console.error('[submitQuickModalInlineScore] Error:', err);
    if (typeof showToast === 'function') {
      showToast(`Failed to save score: ${err.message}`, 'error');
    } else {
      alert(`Failed to save score: ${err.message}`);
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = '✓ Save Score';
    }
  }
}
window.submitQuickModalInlineScore = submitQuickModalInlineScore;

function renderNextEventOverviewPreview(tournaments, isBcpConnected) {
  if (!isBcpConnected) {
    return `
      <div id="hub-overview-events-preview" class="hub-card" style="border-color: rgba(56,189,248,0.25); background: rgba(56,189,248,0.03);">
        <div style="font-size: 0.72rem; color: #38bdf8; font-weight: 800; font-family: var(--font-mono); margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
          <span>📅 REGISTERED EVENTS</span>
          <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 0.68rem; padding: 0.1rem 0.4rem;">BCP & Leagues</span>
        </div>
        <p style="color: var(--text-secondary); font-size: 0.8rem; margin: 0 0 8px 0;">
          Connect your BCP account to track upcoming tournaments, leagues, and roster deadlines.
        </p>
        <button class="hub-view-all-btn" onclick="openBcpLinkModal()" style="margin-top: 4px;">
          <span>🔗 Connect BCP Account</span>
          <span class="hub-btn-arrow">➔</span>
        </button>
      </div>
    `;
  }

  const events = (tournaments || []).filter(isValidRegisteredTournament);

  if (events.length === 0) return '<div id="hub-overview-events-preview" style="display:none;"></div>';

  const nextEv = events[0];
  const evId = nextEv.bcp_event_id || nextEv.id || '';
  const isNativeLeague = Boolean(nextEv.is_native_league || String(evId).startsWith('league_'));
  const evName = nextEv.event_name || nextEv.name || 'Event';
  const evDate = nextEv.event_date || nextEv.start_date || '';
  const countdownPill = getCountdownBadge(evDate, nextEv.end_date);
  const dateStr = evDate ? evDate.substring(0, 10) : 'Upcoming';
  const venueStr = isNativeLeague
    ? `${nextEv.pod_name || `Pod #${nextEv.pod_number || 1}`} • ${nextEv.city || 'San Diego'}`
    : ([nextEv.venue_name, nextEv.city].filter(Boolean).join(' • ') || 'Tournament');
  const hasList = !!(nextEv.has_list_submitted || nextEv.army_list || nextEv.army_list_name);
  const safeEvId = escapeHtml(String(evId)).replace(/'/g, "\\'");
  const clickHandler = isNativeLeague
    ? `openUserLeagueGamesQuickModal('${safeEvId}')`
    : `openEventModal('${encodeURIComponent(evId)}', false)`;

  return `
    <div id="hub-overview-events-preview" class="hub-card" style="border-color: rgba(56,189,248,0.3); background: rgba(56,189,248,0.04);">
      <div style="font-size: 0.72rem; color: #38bdf8; font-weight: 800; font-family: var(--font-mono); margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px;">
        <span>📅 NEXT REGISTERED EVENT</span>
        ${countdownPill}
      </div>
      <div>
        <b style="color: #fff; font-size: 0.95rem; cursor: pointer; display: block; line-height: 1.35;" onclick="${clickHandler}">
          ${escapeHtml(evName)}
        </b>
        <div style="font-size: 0.76rem; color: var(--text-secondary); margin-top: 3px;">
          📅 ${escapeHtml(dateStr)} • 📍 ${escapeHtml(venueStr)}
        </div>
        <div style="display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap;">
          <span style="font-size: 0.74rem; color: #fff;">🛡️ <b>${escapeHtml(nextEv.faction || nextEv.primary_faction || 'Army Unassigned')}</b></span>
          ${isNativeLeague
            ? `<span class="badge" style="background: rgba(16,185,129,0.15); color: #34d399; font-size: 0.68rem; padding: 1px 6px;">⚔️ Active League</span>`
            : (hasList 
              ? `<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; font-size: 0.68rem; padding: 1px 6px;">✅ List Submitted</span>`
              : `<span class="badge" style="background: rgba(245,158,11,0.15); color: #fbbf24; font-size: 0.68rem; padding: 1px 6px;">⚠️ List Pending</span>`)}
          ${!isNativeLeague ? (nextEv.dropped
            ? `<span class="badge" style="background: rgba(239,68,68,0.15); color: #ef4444; font-size: 0.68rem; padding: 1px 6px;">🚫 Dropped</span>`
            : (nextEv.checked_in
              ? `<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; font-size: 0.68rem; padding: 1px 6px;">✅ Checked In</span>`
              : `<span class="badge" style="background: rgba(245,158,11,0.15); color: #fbbf24; font-size: 0.68rem; padding: 1px 6px;">⚠️ Not Checked In</span>`)) : ''}
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem; margin-top: 8px;">
        <button class="hub-view-all-btn" style="flex: 1; margin-top: 0;" onclick="switchHubMobileTab('events')">
          <span>View All Registered Events (${events.length})</span>
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
      const tournaments = (res.tournaments || []).filter(isValidRegisteredTournament);
      if (typeof showNotification === 'function') {
        showNotification(`Refreshed ${tournaments.length} active registered tournament(s)`, 'success');
      }
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
      const activeSubtabCountEl = document.querySelector('#hub-subtabs-bar .profile-subtab-btn[data-tab="active"] .profile-subtab-count');
      if (activeSubtabCountEl) {
        const actLen = (myHubData && myHubData.active_sessions && myHubData.active_sessions.length) || 0;
        activeSubtabCountEl.textContent = String(actLen + tournaments.length);
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
  window.currentHubData = data;

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
  const registeredTournaments = (data.registered_tournaments || []).filter(isValidRegisteredTournament);
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
  const hubTournamentsMeta = Array.isArray(data.events_attended)
    ? data.events_attended
    : (Array.isArray(data.tournaments) ? data.tournaments : []);
  const hubMetaById = new Map();
  const hubMetaByName = new Map();
  hubTournamentsMeta.forEach(t => {
    if (!t) return;
    const tid = String(t.event_id || t.id || '').trim();
    if (tid) hubMetaById.set(tid, t);
    const tname = String(t.event_name || t.name || '').trim().toLowerCase();
    if (tname && !hubMetaByName.has(tname)) hubMetaByName.set(tname, t);
  });

  const hubEventsMap = new Map();
  sortedHistory.forEach(m => {
    const evKey = m.event_id || m.event_name || 'Tournament Match';
    const evName = (m.event_name || 'Tournament Match').trim();
    const tMeta = (m.event_id && hubMetaById.get(String(m.event_id).trim()))
      || hubMetaByName.get(evName.toLowerCase())
      || null;
    if (!hubEventsMap.has(evKey)) {
      hubEventsMap.set(evKey, {
        event_id: m.event_id || (tMeta && (tMeta.event_id || tMeta.id)) || '',
        event_name: m.event_name || 'Tournament Match',
        date: (m.match_date || m.event_date || (tMeta && tMeta.event_date) || '').substring(0, 10),
        faction: m.player_faction || (tMeta && tMeta.registered_faction !== 'Unknown' ? tMeta.registered_faction : '') || p.top_faction || '',
        placement: Number((tMeta && tMeta.placement) || m.placement || 0),
        total_players: Number((tMeta && tMeta.total_players) || m.total_players || 0),
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
    if (!ev.placement && tMeta && tMeta.placement) ev.placement = Number(tMeta.placement);
    if (!ev.total_players && tMeta && tMeta.total_players) ev.total_players = Number(tMeta.total_players);
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
      const isFlawless = (ev.losses === 0 && (!ev.draws || ev.draws === 0) && ev.wins >= 3);
      const eloDelta = ev.totalEloDelta;
      const eloSign = eloDelta > 0 ? `+${eloDelta.toFixed(1)}` : eloDelta.toFixed(1);
      const eloColor = eloDelta > 0 ? 'var(--win)' : (eloDelta < 0 ? 'var(--loss)' : 'var(--text-muted)');
      const placingPillHtml = typeof window.formatTournamentPlacingBadge === 'function'
        ? window.formatTournamentPlacingBadge(ev.placement, ev.total_players)
        : '';

      const roundsRows = ev.rounds.map((r, rIdx) => {
        const isWin = r.result === 'W';
        const isLoss = r.result === 'L';
        const isBye = Boolean(r.is_bye || (r.opponent_name && r.opponent_name.toUpperCase() === 'BYE'));
        const resColor = isWin ? 'var(--win)' : (isLoss ? 'var(--loss)' : 'var(--draw)');
        const delta = Number(r.delta_elo || 0);
        const deltaStr = delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
        const deltaColor = delta > 0 ? 'var(--win)' : (delta < 0 ? 'var(--loss)' : 'var(--text-muted)');
        const hasScores = (r.player_score !== undefined && r.player_score !== null && r.opponent_score !== undefined && r.opponent_score !== null);
        const scoreStr = hasScores ? `${r.player_score} - ${r.opponent_score}` : '-';
        const roundNum = r.round || (ev.rounds.length - rIdx);
        const tableNum = r.table_number || r.table || '';
        const evId = ev.event_id || r.event_id || '';
        const evName = ev.event_name || r.event_name || 'Tournament Match';
        const matchDate = r.match_date || ev.date || '';
        const myFac = r.player_faction || ev.faction || '';
        const oppId = r.opponent_id || '';
        const oppName = r.opponent_name || 'Opponent';
        const oppFac = r.opponent_faction || '';
        const scorecardMatchId = r.tracker_match_id
          || (r.match_id ? String(r.match_id) : '')
          || (evId && tableNum ? `BCP-${evId}-R${roundNum}-T${tableNum}` : (evId ? `BCP-${evId}-R${roundNum}-P-${playerIdForActions}` : `MATCH-R${roundNum}`));

        const oppBadge = !isBye && r.opponent_elo
          ? (typeof renderEloBadgePill === 'function' ? renderEloBadgePill(r.opponent_elo, null, { size: 'sm', gameSystem: sys }) : `<span class="badge">${Number(r.opponent_elo).toFixed(1)}</span>`)
          : '';

        const scoreCellHtml = (!isBye && hasScores) ? `
          <button type="button" class="journey-scorecard-pill" onclick="event.stopPropagation(); openJourneyScorecardModal('${escapeJsArg(scorecardMatchId)}', '${escapeJsArg(evId)}', '${escapeJsArg(evName)}', '${escapeJsArg(roundNum)}', '${escapeJsArg(tableNum)}', '${escapeJsArg(matchDate)}', '${escapeJsArg(playerIdForActions)}', '${escapeJsArg(competitorName)}', '${escapeJsArg(myFac)}', '${escapeJsArg(r.player_score)}', '${escapeJsArg(oppId)}', '${escapeJsArg(oppName)}', '${escapeJsArg(oppFac)}', '${escapeJsArg(r.opponent_score)}')" title="View match scorecard (${escapeHtml(competitorName)} vs ${escapeHtml(oppName)})">
            <span>📊</span><span>${scoreStr}</span>
          </button>
        ` : scoreStr;

        return `
          <tr>
            <td class="col-rnd" style="font-family: var(--font-mono); font-weight: 700; color: var(--text-secondary);">R${roundNum}</td>
            <td class="col-opp">
              ${isBye ? '<span class="bye-pill">🛡️ TOURNAMENT BYE</span>' : `
                <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                  <span class="player-link" style="font-weight: 600; color: #38bdf8; cursor: pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeJsArg(oppId)}', '${escapeJsArg(oppName)}')" title="Quick scout ${escapeHtml(oppName)}">${escapeHtml(oppName)}</span>
                  ${oppBadge}
                </div>
                <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-top: 2px;">
                  ${oppFac ? `<span style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(oppFac)}</span>` : ''}
                  ${evId ? `
                    <button type="button" class="journey-action-pill journey-roster-pill-sm" onclick="event.stopPropagation(); openJourneyPlayerRosterModal('${escapeJsArg(evId)}', '${escapeJsArg(oppId)}', '${escapeJsArg(oppName)}', '${escapeJsArg(oppFac)}', '${escapeJsArg(evName)}')" title="View ${escapeHtml(oppName)}'s army roster">
                      📋 Roster
                    </button>
                  ` : ''}
                </div>
              `}
            </td>
            <td class="col-res" style="font-family: var(--font-mono); font-weight: 700; color: ${resColor};">${r.result || '-'}</td>
            <td class="col-score" style="font-family: var(--font-mono); white-space: nowrap;">${scoreCellHtml}</td>
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
                  <span class="player-link" style="color: #38bdf8; cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem;" onclick="event.stopPropagation(); openEventModal('${escapeJsArg(ev.event_id)}')" title="Click to view Tournament Standings & Details">
                    <span>${escapeHtml(ev.event_name)}</span>
                    <span style="font-size: 0.72rem; opacity: 0.85;">↗</span>
                  </span>
                ` : `<span>${escapeHtml(ev.event_name)}</span>`}
                ${isFlawless ? '<span class="badge" style="background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3); font-size:0.68rem; margin-left:0.35rem; white-space:nowrap;">🥇 Flawless</span>' : ''}
              </div>
              <div class="profile-event-sub">
                <span>${ev.date || 'Event Record'}</span>
                ${ev.faction ? `<span>· 🛡️ ${escapeHtml(ev.faction)}</span>` : ''}
                ${ev.event_id ? `
                  <button type="button" class="journey-action-pill journey-roster-pill" onclick="event.stopPropagation(); openJourneyPlayerRosterModal('${escapeJsArg(ev.event_id)}', '${escapeJsArg(playerIdForActions)}', '${escapeJsArg(competitorName)}', '${escapeJsArg(ev.faction || '')}', '${escapeJsArg(ev.event_name)}')" title="View your army roster for ${escapeHtml(ev.event_name)}">
                    📋 Roster
                  </button>
                ` : ''}
              </div>
            </div>
            <div class="profile-event-stats">
              ${placingPillHtml}
              <span class="profile-event-record" style="font-family: var(--font-mono); font-weight: 700; font-size: 0.86rem; white-space: nowrap;">${recordStr}</span>
              <span class="profile-event-delta" style="font-family: var(--font-mono); font-weight: 800; font-size: 0.86rem; color: ${eloColor}; min-width: 50px; text-align: right; white-space: nowrap;">${eloSign}</span>
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

  // Resolve equipped cosmetic loadout strictly for the active game system
  const allEq = data.equipped || (data.armory_vault && data.armory_vault.equipped) || (window.Armory && window.Armory.getCurrentVault && window.Armory.getCurrentVault().equipped) || {};
  const myEq = (typeof window.getEquippedForSystem === 'function')
    ? window.getEquippedForSystem(allEq, sys)
    : ((allEq[sys] && typeof allEq[sys] === 'object') ? allEq[sys] : {});

  const activeFrameId = myEq.active_card_frame;
  const frameClass = activeFrameId ? (window.Armory && typeof window.Armory.getFrameCssClass === 'function' ? window.Armory.getFrameCssClass(activeFrameId) : activeFrameId.replace(/_/g, '-')) : '';

  const activeFinishId = myEq.active_card_finish;
  const finishClass = activeFinishId ? (window.Armory && typeof window.Armory.getFinishCssClass === 'function' ? window.Armory.getFinishCssClass(activeFinishId) : (activeFinishId === 'frame_astral_holofoil' || activeFinishId.includes('holofoil') ? 'finish-astral-holofoil' : activeFinishId.replace(/_/g, '-'))) : '';

  const activeTitleId = myEq.active_title;
  let titleHtml = '';
  if (activeTitleId) {
    const tText = activeTitleId.replace(/^title_/, '').replace(/_/g, ' ');
    const tClass = activeTitleId.includes('warp') ? 'title-badge-warp' : (activeTitleId.includes('forge') ? 'title-badge-forge' : (activeTitleId.includes('strategist') ? 'title-badge-strategist' : 'title-badge-unbroken'));
    titleHtml = `<span class="armory-title-chip ${tClass}"><span class="title-chip-icon">🏷️</span> ${escapeHtml(tText.toUpperCase())}</span>`;
  }

  const activeAvatarId = myEq.active_avatar;
  let avatarSigilSvg = '';
  let avatarSigilStyle = '';
  if (activeAvatarId) {
    avatarSigilSvg = typeof window.getArmoryAvatarSvg === 'function' ? window.getArmoryAvatarSvg(activeAvatarId) : '';
    avatarSigilStyle = 'border-color: #38bdf8; box-shadow: 0 0 20px rgba(56,189,248,0.35), inset 0 0 14px rgba(56,189,248,0.15);';
  }

  // Resolve tournament championships laurel badge
  const champs = data.championships || {};
  let champPillHtml = '';
  if (champs && champs.total > 0) {
    const pillText = champs.championship_pill || `🏆 ${champs.total}x Champion`;
    champPillHtml = `<span class="profile-standing-badge champ-laurel-pill" onclick="switchHubSubtab('trophies'); setTimeout(() => { const el = document.getElementById('hall-of-champions-showcase'); if(el) el.scrollIntoView({behavior:'smooth', block:'center'}); }, 100);" title="Verified Tournament Championships (${champs.total} Titles: ${champs.major_wins || 0} Major, ${champs.gt_wins || 0} GT, ${champs.rtt_wins || 0} RTT)">${escapeHtml(pillText)}</span>`;
  }

  let html = `
    <div id="my-hub-container" class="my-hub-container" data-active-tab="${currentHubSubtab || 'active'}">
      <!-- Upgraded 16-Tier Competitor Hero Card with Military Rank Border -->
      <div id="my-hub-hero-card" class="profile-hero-card ${tier.themeClass || ''} ${(data.rank && data.rank.css_class) || ''} ${frameClass} ${finishClass}" style="margin-bottom: 1.25rem;">
        <div class="profile-hero-top">
          <div class="profile-identity-group">
            <div class="profile-rank-crest" title="${escapeHtml(tier.name)}" data-default-icon="${escapeHtml(tier.icon)}" style="${avatarSigilStyle}">
              <span class="hero-crest-default-icon" style="${avatarSigilSvg ? 'display: none;' : ''}">${tier.icon}</span>
              <span class="hero-avatar-sigil-slot" style="${avatarSigilSvg ? 'display: flex;' : 'display: none;'}">${avatarSigilSvg}</span>
            </div>
            <div class="profile-name-meta">
              <div class="profile-badges-row">
                <h1 class="profile-name-title">${escapeHtml(competitorName)}</h1>
                <span class="hero-title-badge-slot" style="${titleHtml ? 'display: inline-flex;' : 'display: none;'}">${titleHtml}</span>
                ${p.player_name && p.player_name !== competitorName && p.player_name.toLowerCase() !== 'competitor' ? `<span style="font-size: 0.8rem; color: #94a3b8; font-weight: 500;">(Ranked as: ${escapeHtml(p.player_name)})</span>` : ''}
                ${rankings.global_rank ? `<span class="tier-badge tier-S" style="font-size: 0.78rem; padding: 0.15rem 0.55rem;">World #${rankings.global_rank}</span>` : ''}
                ${p.top_faction ? `<span class="tier-badge tier-A" style="font-size: 0.78rem; padding: 0.15rem 0.55rem;">${escapeHtml(p.top_faction)}</span>` : ''}
              </div>
              <div class="profile-badges-row" style="margin-top: 0.15rem;">
                ${typeof renderEloBadgePill === 'function' ? renderEloBadgePill(currentEloNum, totalMatches, { showTierName: true, size: 'lg', gameSystem: sys }) : `<span class="badge">${currentElo} Elo</span>`}
                ${Number(peakElo) <= Number(currentEloNum) + 0.5
                  ? `<span class="profile-standing-badge" style="background:rgba(251,191,36,0.12); color:#fbbf24; border:1px solid rgba(251,191,36,0.35); font-weight:700;" title="Currently standing at all-time career peak Elo rating (${currentElo})!">All-Time Peak 👑</span>`
                  : `<span class="profile-standing-badge" title="All-Time Peak Rating: ${peakElo}">Peak: ${peakElo} 👑</span>`
                }
                ${window.BadgesUI ? window.BadgesUI.renderRankBadge(data, 'switchHubSubtab') : ''}
                ${champPillHtml}
                ${p.team ? `<span class="badge" style="background:rgba(168,85,247,0.12); color:#c084fc; border:1px solid rgba(168,85,247,0.25); cursor:pointer;" onclick="if(typeof openTeamModal==='function') openTeamModal('${escapeHtml(p.team)}');" title="Click to view ${escapeHtml(p.team)} roster">🛡️ ${escapeHtml(p.team)} ➔</span>` : `<span class="badge" style="background:rgba(255,255,255,0.06); color:#94a3b8; border:1px solid rgba(255,255,255,0.12); cursor:pointer;" onclick="if(typeof switchTab==='function') switchTab('leaderboard');" title="Find or join a team">⚔️ Independent &bull; Join Club ➔</span>`}
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
            <button type="button" class="btn btn-outline" onclick="openShareProfileModal('${escapeHtml(playerIdForActions)}', '${sys}')" title="Generate shareable profile picture, trading card, or share to other platforms" style="font-weight: 600; font-size: 0.82rem; padding: 0.45rem 0.85rem; border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;">
              🪪 Share Profile
            </button>
          </div>
        </div>

        <!-- Collapsible Career Progression & Full Stats for Mobile -->
        ${(() => {
          const existingDrawer = document.getElementById('hub-career-details-drawer');
          const domExpanded = existingDrawer && existingDrawer.classList.contains('hub-career-drawer-expanded');
          let storedExpanded = false;
          try { storedExpanded = sessionStorage.getItem('omni_hub_career_expanded') === '1'; } catch (e) {}
          const isCareerExpanded = Boolean(window.isHubCareerDrawerExpanded || domExpanded || storedExpanded);
          if (isCareerExpanded) window.isHubCareerDrawerExpanded = true;
          return `
        <button type="button" id="hub-career-toggle-btn" class="hub-career-toggle-btn mobile-only" onclick="toggleHubCareerDetails(event)" aria-expanded="${isCareerExpanded ? 'true' : 'false'}">
          <span style="display:inline-flex; align-items:center; gap:6px;">
            <span>📊</span>
            <span id="hub-career-toggle-text">${isCareerExpanded ? 'Hide Full Stats &amp; Progression' : 'Show Full Stats &amp; Progression'}</span>
          </span>
          <span id="hub-career-toggle-arrow">${isCareerExpanded ? '▲' : '▼'}</span>
        </button>

        <div id="hub-career-details-drawer" class="${isCareerExpanded ? 'hub-career-drawer-expanded' : 'hub-career-drawer-collapsed'}">
          `;
        })()}
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
      ${(() => {
        const armoryGloryObj = (typeof window !== 'undefined' && window.Armory && typeof window.Armory.getGlory === 'function') ? window.Armory.getGlory() : null;
        const armorySpendable = armoryGloryObj && armoryGloryObj.spendable_glory != null ? Number(armoryGloryObj.spendable_glory) : 0;
        const dataSpendable = data.spendable_glory != null ? Number(data.spendable_glory) : (data.glory_balance != null ? Number(data.glory_balance) : 0);
        let cachedSpendable = 0;
        try { cachedSpendable = Number(localStorage.getItem('omnitactica_cached_spendable_glory') || 0); } catch (e) {}
        const effectiveSpendableGlory = armorySpendable > 0 ? armorySpendable : (dataSpendable > 0 ? dataSpendable : cachedSpendable);
        if (effectiveSpendableGlory > 0) {
          try { localStorage.setItem('omnitactica_cached_spendable_glory', String(effectiveSpendableGlory)); } catch (e) {}
        }
        return `
          <button type="button" class="profile-subtab-btn hub-subtab-armory-btn" data-tab="armory" onclick="switchHubSubtab('armory')" title="${effectiveSpendableGlory.toLocaleString()} Spendable Glory Points Remaining">
            <span>🏛️ Armory</span>
            <span class="profile-subtab-count" style="color: #fbbf24; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 800;">💰 <span id="hub-armory-balance-count">${effectiveSpendableGlory.toLocaleString()}</span></span>
          </button>
        `;
      })()}
    </div>

    <!-- TAB PANEL 1: Active Matches, Army Lists & Registered Tournaments -->
    <div id="hub-panel-active" class="profile-tab-panel ${currentHubSubtab === 'active' ? 'active' : ''}">
      <!-- 2-Column Row: Army Lists & Rosters + Registered Tournaments -->
      <div class="hub-grid-2col hub-row-prep">
        <!-- Card: Army Lists & Rosters -->
        <div class="hub-card" id="hub-armylists-card" style="display:flex; flex-direction:column; justify-content:space-between;">
          <div style="display:flex; flex-direction:column; flex:1; min-height:0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">📋 Army Lists & Rosters</h3>
              </div>
              <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                <button id="hub-btn-launch-nr-studio" class="bcp-login-btn" onpointerenter="ensureBackgroundNrStudioWarmup()" ontouchstart="ensureBackgroundNrStudioWarmup()" onclick="openNewRecruitStudioDrawer('/nr/app/Lists')" style="font-size: 0.75rem; padding: 0.32rem 0.8rem; background: var(--accent); color: #0f172a; font-weight: 800; display: inline-flex; align-items: center; gap: 5px; cursor: pointer;">
                  ⚔️ NewRecruit Studio
                </button>
              </div>
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

  // Apply active equipped armory decorations (frames, sigil avatar, titles) scoped to My Hub
  if (window.Armory && typeof window.Armory.applyEquippedDecorations === 'function') {
    window.Armory.applyEquippedDecorations(sys, myEq, container);
  }

  // Render SVG Trajectory & Load Army Lists asynchronously (non-blocking)
  renderHubTrajectory(history);
  if (Array.isArray(hubSavedLists) && hubSavedLists.length > 0) {
    renderHubArmyLists(hubSavedLists);
  }
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

  return Promise.resolve();
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
let hubNrCloudAccount = { connected: false, login: '', last_sync: null };

function purgeLegacyHubArmyListCache(extraKeysToPurgeFromRemote = []) {
  try {
    localStorage.removeItem('my_hub_armylists_cache');
    localStorage.removeItem('omni_deleted_nr_lists');
    localStorage.removeItem('omni_deleted_nr_lists_v2');
    localStorage.removeItem('omni_deleted_nr_lists_v3');
    if (Array.isArray(extraKeysToPurgeFromRemote) && extraKeysToPurgeFromRemote.length > 0) {
      const remRaw = localStorage.getItem('remote-lists-state');
      if (remRaw) {
        const remObj = JSON.parse(remRaw);
        if (remObj && typeof remObj === 'object') {
          let changed = false;
          for (const k of extraKeysToPurgeFromRemote) {
            const cleanK = String(k || '').replace(/^(nr_|list_)/, '').trim();
            if (cleanK && cleanK in remObj) {
              delete remObj[cleanK];
              changed = true;
            }
          }
          if (changed) localStorage.setItem('remote-lists-state', JSON.stringify(remObj));
        }
      }
    }
  } catch (e) {}
}

function markHubListDeletedTombstone(listKey, listName, extraKeys = []) {
  const allKeys = [];
  if (listKey) allKeys.push(listKey);
  if (Array.isArray(extraKeys)) allKeys.push(...extraKeys);
  purgeLegacyHubArmyListCache(allKeys);
}

function clearHubListDeletedTombstone(listKey, listName) {
  purgeLegacyHubArmyListCache();
}

function isHubListTombstoned(item) {
  return false;
}

function getLocalNrCloudAccountFallback() {
  try {
    let access = localStorage.getItem('access') || '';
    let login = '';
    const rawBackup = localStorage.getItem('omni_nr_auth_backup_v1');
    if (rawBackup) {
      const parsed = JSON.parse(rawBackup);
      if (parsed && typeof parsed === 'object') {
        if (!access && parsed.access) access = String(parsed.access);
        if (parsed.user && typeof parsed.user === 'object') {
          login = String(parsed.user.login || parsed.user.username || parsed.user.name || '');
        }
      }
    }
    if (!access) return null;
    if (!login && access.includes('.')) {
      try {
        const b64 = access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(b64));
        if (payload && typeof payload === 'object') {
          login = String(payload.login || payload.username || payload.name || payload.sub || '');
        }
      } catch (e2) {}
    }
    return {
      connected: true,
      login: login || 'NewRecruit',
      last_sync: new Date().toISOString()
    };
  } catch (e) {
    return null;
  }
}

async function readSameOriginNewRecruitIdbRows() {
  const rowsByKey = new Map();
  // 1. Check live NewRecruit Studio iframe Pinia store if open
  try {
    const studioIframe = document.getElementById('hub-nr-studio-iframe');
    const win = studioIframe && studioIframe.contentWindow;
    const st = win && (win.__nr_stores || (win.__omnitacticaNrBridge && win.__omnitacticaNrBridge.getStores && win.__omnitacticaNrBridge.getStores()));
    if (st && st.list && Array.isArray(st.list.listData)) {
      for (const r of st.list.listData) {
        if (r && (r.list_key || r._id) && !r._ephemeral_view && !r.deleted && !r.trashed) {
          const lk = String(r.list_key || r._id).replace(/^(nr_|list_)/, '').trim();
          if (lk) rowsByKey.set(lk, r);
        }
      }
    }
  } catch (e) {}

  // 2. Read from same-origin browser IndexedDB ('nr' -> 'lists')
  try {
    let hasNrDb = true;
    if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases();
      const nrMeta = (dbs || []).find(d => d && d.name === 'nr');
      if (!nrMeta) hasNrDb = false;
    }
    if (hasNrDb && typeof indexedDB !== 'undefined') {
      await new Promise(resolve => {
        let settled = false;
        let dbRef = null;
        const done = () => {
          if (settled) return;
          settled = true;
          if (dbRef) {
            try { dbRef.close(); } catch (e) {}
          }
          resolve();
        };
        setTimeout(done, 800);
        const req = indexedDB.open('nr');
        req.onupgradeneeded = (ev) => {
          try { ev.target.transaction.abort(); } catch (e) {}
          done();
        };
        req.onsuccess = () => {
          const db = req.result;
          dbRef = db;
          if (!db || !db.objectStoreNames || !db.objectStoreNames.contains('lists')) {
            done();
            return;
          }
          try {
            const tx = db.transaction('lists', 'readonly');
            const store = tx.objectStore('lists');
            const allReq = store.getAll();
            allReq.onsuccess = () => {
              const allRows = allReq.result || [];
              for (const r of allRows) {
                if (r && (r.list_key || r._id) && !r._ephemeral_view && !r.deleted && !r.trashed) {
                  const lk = String(r.list_key || r._id).replace(/^(nr_|list_)/, '').trim();
                  if (lk && !rowsByKey.has(lk)) {
                    rowsByKey.set(lk, r);
                  }
                }
              }
              done();
            };
            allReq.onerror = done;
          } catch (e) {
            done();
          }
        };
        req.onerror = done;
        req.onblocked = done;
      });
    }
  } catch (e) {}

  return Array.from(rowsByKey.values());
}
window.readSameOriginNewRecruitIdbRows = readSameOriginNewRecruitIdbRows;

async function writeNrRowToSameOriginIdb(nrRow) {
  if (!nrRow || typeof nrRow !== 'object') return false;
  const lk = String(nrRow.list_key || nrRow._id || '').replace(/^(nr_|list_)/, '').trim();
  if (!lk) return false;
  const cleanRow = Object.assign({}, nrRow, { list_key: lk });
  delete cleanRow._ephemeral_view;

  try {
    if (typeof indexedDB !== 'undefined') {
      await new Promise(resolve => {
        let settled = false;
        let dbRef = null;
        const done = () => {
          if (settled) return;
          settled = true;
          if (dbRef) {
            try { dbRef.close(); } catch (e) {}
          }
          resolve();
        };
        setTimeout(done, 800);
        const req = indexedDB.open('nr');
        req.onupgradeneeded = (ev) => {
          const db = ev.target.result;
          if (db && !db.objectStoreNames.contains('lists')) {
            db.createObjectStore('lists', { keyPath: 'list_key' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          dbRef = db;
          if (!db || !db.objectStoreNames || !db.objectStoreNames.contains('lists')) {
            done();
            return;
          }
          try {
            const tx = db.transaction('lists', 'readwrite');
            const store = tx.objectStore('lists');
            if (store.keyPath) {
              store.put(cleanRow);
            } else {
              store.put(cleanRow, lk);
            }
            tx.oncomplete = done;
            tx.onerror = done;
          } catch (e) {
            done();
          }
        };
        req.onerror = done;
        req.onblocked = done;
      });
    }
  } catch (e) {}

  try {
    const studioIframe = document.getElementById('hub-nr-studio-iframe');
    if (studioIframe && studioIframe.contentWindow) {
      studioIframe.contentWindow.postMessage({
        type: 'OMNITACTICA_NR_COMMAND',
        command: 'upsert_list',
        nr_row: cleanRow
      }, '*');
    }
  } catch (e) {}
  return true;
}
window.writeNrRowToSameOriginIdb = writeNrRowToSameOriginIdb;

function mergeHubNewRecruitLists(localLists, cloudLists) {
  const mergedMap = new Map();
  const addItem = (item) => {
    if (!item || typeof item !== 'object') return;
    const lk = String(item.list_key || (item.nr_row && item.nr_row.list_key) || item.id || '').replace(/^(nr_|list_)/, '').trim();
    if (!lk) return;
    if (!mergedMap.has(lk)) {
      mergedMap.set(lk, item);
    } else {
      const existing = mergedMap.get(lk);
      // Prefer local list if it has more recent edits or units, while preserving Cloud badge if synced
      if (item.source_format && String(item.source_format).includes('Cloud')) {
        existing.source_format = item.source_format;
      }
    }
  };
  (Array.isArray(localLists) ? localLists : []).forEach(addItem);
  (Array.isArray(cloudLists) ? cloudLists : []).forEach(addItem);
  return Array.from(mergedMap.values());
}

async function loadHubArmyLists() {
  const container = document.getElementById('hub-armylists-list-container');
  if (!container) return;

  purgeLegacyHubArmyListCache();

  try {
    const localRows = await readSameOriginNewRecruitIdbRows();
    const [localSyncRes, cloudRes, nrState] = await Promise.all([
      localRows.length > 0 && window.api.syncNewRecruitLists
        ? window.api.syncNewRecruitLists({ action: 'bulk_sync', lists: localRows }).catch(() => null)
        : Promise.resolve({ army_lists: [] }),
      window.api.getArmyLists('all').catch(() => ({ army_lists: [] })),
      window.api.getNewRecruitState ? window.api.getNewRecruitState().catch(() => null) : Promise.resolve(null)
    ]);
    const localLists = (localSyncRes && Array.isArray(localSyncRes.army_lists)) ? localSyncRes.army_lists : [];
    const cloudLists = (cloudRes && Array.isArray(cloudRes.army_lists)) ? cloudRes.army_lists : [];
    const lists = mergeHubNewRecruitLists(localLists, cloudLists);
    hubSavedLists = lists;
    window.hubSavedLists = lists;
    if (Array.isArray(lists) && lists.length > 0 && typeof window.reconcileHubRosterVaultBadge === 'function') {
      window.reconcileHubRosterVaultBadge(lists);
    }
    if (nrState && nrState.cloud_account) {
      if (nrState.cloud_account.connected) {
        hubNrCloudAccount = nrState.cloud_account;
        try {
          if (nrState.cloud_account.access && localStorage.getItem('access') !== nrState.cloud_account.access) {
            localStorage.setItem('access', nrState.cloud_account.access);
          }
          if (nrState.cloud_account.refresh && localStorage.getItem('refresh') !== nrState.cloud_account.refresh) {
            localStorage.setItem('refresh', nrState.cloud_account.refresh);
          }
        } catch (e) {}
      } else if (nrState.cloud_account.disconnected_at) {
        try {
          const rawBak = localStorage.getItem('omni_nr_auth_backup_v1');
          const parsedBak = rawBak ? JSON.parse(rawBak) : null;
          if (!parsedBak || parsedBak.synced_to_server) {
            localStorage.removeItem('omni_nr_auth_backup_v1');
            localStorage.removeItem('access');
            localStorage.removeItem('refresh');
          }
        } catch (e) {}
        hubNrCloudAccount = nrState.cloud_account;
      }
    }
    const localAuthFallback = getLocalNrCloudAccountFallback();
    if ((!hubNrCloudAccount || !hubNrCloudAccount.connected) && localAuthFallback && localAuthFallback.connected) {
      hubNrCloudAccount = localAuthFallback;
    }
    updateHubNrSyncPill();
    renderHubArmyLists(lists);
  } catch(e) {
    container.innerHTML = `<div style="color:var(--loss); font-size:0.85rem; padding:1.5rem; text-align:center;">Error loading army lists: ${e.message}</div>`;
  }
}

function reconcileHubRosterVaultBadge(lists) {
  if (!Array.isArray(lists) || lists.length === 0) return;
  const targets = [typeof myHubData !== 'undefined' ? myHubData : null, window.currentHubData].filter(Boolean);
  let didUnlock = false;
  targets.forEach(data => {
    const sObj = data.seasonal && (data.seasonal[data.active_season || '2026'] || (data.seasonal.badges ? data.seasonal : null));
    const checkList = [];
    if (sObj && Array.isArray(sObj.badges)) checkList.push({ container: sObj, badges: sObj.badges, isSeasonal: true });
    if (Array.isArray(data.badges)) checkList.push({ container: data, badges: data.badges, isSeasonal: false });

    checkList.forEach(({ container, badges, isSeasonal }) => {
      badges.forEach(b => {
        if (!b || !b.id || !String(b.id).includes('roster_in_vault')) return;
        b.description = 'Save at least 1 army roster in NewRecruit Studio or submit a tournament roster.';
        b.progress = { current: 1, target: 1, unit: 'rosters' };
        b.provenance = 'Saved battle roster in NewRecruit Studio';
        if (!b.unlocked) {
          b.unlocked = true;
          didUnlock = true;
          const gloryAdd = Number(b.glory || 25);
          if (isSeasonal) {
            container.unlocked_count = Number(container.unlocked_count || 0) + 1;
            container.total_glory = Number(container.total_glory || 0) + gloryAdd;
            if (container.total_badges) {
              container.completion_pct = Math.round((container.unlocked_count / container.total_badges) * 100);
            }
          } else {
            container.badge_count = Number(container.badge_count || 0) + 1;
          }
        }
      });
    });
  });

  if (didUnlock) {
    const trophySubtabCount = document.querySelector('#hub-subtabs-bar .profile-subtab-btn[data-tab="trophies"] .profile-subtab-count');
    const refData = (typeof myHubData !== 'undefined' && myHubData) || window.currentHubData;
    if (trophySubtabCount && refData) {
      trophySubtabCount.textContent = `${refData.badge_count || 0}/${refData.total_badges || 105}`;
    }
    const trophyPanel = document.getElementById('hub-panel-trophies');
    if (trophyPanel && window.BadgesUI && typeof window.BadgesUI.renderTrophyRoom === 'function' && refData) {
      window.BadgesUI.renderTrophyRoom(trophyPanel, refData, true, refData.player && refData.player.player_id);
    }
  }
}
window.reconcileHubRosterVaultBadge = reconcileHubRosterVaultBadge;

function ensureBackgroundNrStudioWarmup() {
  if (document.getElementById('hub-nr-studio-iframe')) return;
  if (!document.getElementById('hub-armylists-list-container')) return;
  openNewRecruitStudioDrawer('/nr/app/Lists', '', true);
}
window.ensureBackgroundNrStudioWarmup = ensureBackgroundNrStudioWarmup;

function updateHubNrSyncPill() {
  const cloudBtn = document.getElementById('hub-btn-nr-cloud-sync');
  const studioAuthBtn = document.getElementById('hub-btn-nr-studio-auth');
  const localAuthFallback = getLocalNrCloudAccountFallback();
  const effectiveAccount = (hubNrCloudAccount && hubNrCloudAccount.connected)
    ? hubNrCloudAccount
    : (localAuthFallback || hubNrCloudAccount);
  const isConn = Boolean(effectiveAccount && effectiveAccount.connected);
  const loginName = (effectiveAccount && effectiveAccount.login) || '';

  if (cloudBtn && isConn) {
    cloudBtn.innerHTML = `🔄 Cloud Sync`;
  }
  if (studioAuthBtn) {
    if (isConn) {
      studioAuthBtn.innerHTML = `🚪 Logout${loginName ? ` (${escapeHtml(loginName)})` : ''}`;
      studioAuthBtn.style.background = 'rgba(239, 68, 68, 0.16)';
      studioAuthBtn.style.color = '#f87171';
      studioAuthBtn.style.borderColor = 'rgba(239, 68, 68, 0.35)';
    } else {
      studioAuthBtn.innerHTML = `🔑 Login`;
      studioAuthBtn.style.background = 'rgba(56, 189, 248, 0.16)';
      studioAuthBtn.style.color = '#38bdf8';
      studioAuthBtn.style.borderColor = 'rgba(56, 189, 248, 0.35)';
    }
  }
}

const NR_STUDIO_SYSTEMS = {
  827374861: { id: 827374861, gameSystem: '40k', edition: '11th Ed', label: '⚔️ Warhammer 40K — 11th Ed (Latest)' },
  4255553472: { id: 4255553472, gameSystem: 'aos', edition: 'AoS 4.0', label: '⚡ Age of Sigmar — 4.0 (Latest)' },
  2821148162: { id: 2821148162, gameSystem: '40k', edition: '10th Ed', label: '🛡️ Warhammer 40K — 10th Ed' },
  4194757354: { id: 4194757354, gameSystem: 'aos', edition: 'AoS 3.0', label: '🔨 Age of Sigmar — 3.0' }
};

function getDefaultNrStudioSystemIdForGameSystem(sys) {
  const activeSys = String(sys || (typeof currentGameSystem !== 'undefined' && currentGameSystem) || '40k').toLowerCase();
  return activeSys === 'aos' ? 4255553472 : 827374861;
}
window.getDefaultNrStudioSystemIdForGameSystem = getDefaultNrStudioSystemIdForGameSystem;

function resolveHubListGameSystemAndEdition(list) {
  if (!list || typeof list !== 'object') {
    const defSys = (typeof currentGameSystem !== 'undefined' && currentGameSystem === 'aos') ? 'aos' : '40k';
    return {
      gameSystem: defSys,
      edition: defSys === 'aos' ? 'AoS 4.0' : '11th Ed',
      sysId: getDefaultNrStudioSystemIdForGameSystem(defSys)
    };
  }
  const row = (list.nr_row && typeof list.nr_row === 'object') ? list.nr_row : {};
  const sysId = Number(list.id_system || row.id_system || 0);
  const bsidSys = String(list.bsid_system || row.bsid_system || '').trim();

  if (sysId === 4255553472 || bsidSys === 'e51d-b1a3-75fc-dc3g') {
    return { gameSystem: 'aos', edition: 'AoS 4.0', sysId: 4255553472 };
  }
  if (sysId === 4194757354 || bsidSys === 'e51d-b1a3-75fc-dc33') {
    return { gameSystem: 'aos', edition: 'AoS 3.0', sysId: 4194757354 };
  }
  if (sysId === 827374861 || bsidSys === 'sys-352e-adc2-7639-d610') {
    return { gameSystem: '40k', edition: '11th Ed', sysId: 827374861 };
  }
  if (sysId === 2821148162 || bsidSys === 'sys-352e-adc2-7639-d6a9') {
    return { gameSystem: '40k', edition: '10th Ed', sysId: 2821148162 };
  }

  const gsHint = String(list.game_system || row._omnitactica_system_name || '').toLowerCase();
  const edHint = String(list.system_edition || '').trim();
  const facHint = String(list.faction || row._omnitactica_book_name || '').toLowerCase().replace(/-/g, ' ');
  const aosFactionKeywords = [
    'stormcast', 'cities of sigmar', 'daughters of khaine', 'fyreslayers', 'idoneth deepkin',
    'kharadron overlords', 'lumineth', 'seraphon', 'sylvaneth', 'blades of khorne',
    'disciples of tzeentch', 'hedonites of slaanesh', 'maggotkin of nurgle', 'skaven',
    'slaves to darkness', 'helsmiths of hashut', 'beasts of chaos', 'flesh eater courts',
    'nighthaunt', 'ossiarch bonereapers', 'soulblight gravelords', 'gloomspite gitz',
    'ironjawz', 'kruleboyz', 'orruk warclans', 'ogor mawtribes', 'sons of behemat', 'bonesplitterz'
  ];
  const isAosFaction = facHint && aosFactionKeywords.some(k => facHint.includes(k));
  if (gsHint === 'aos' || gsHint.includes('sigmar') || isAosFaction) {
    const is3e = edHint.includes('3') || gsHint.includes('3.0');
    return {
      gameSystem: 'aos',
      edition: edHint || (is3e ? 'AoS 3.0' : 'AoS 4.0'),
      sysId: is3e ? 4194757354 : 4255553472
    };
  }
  const is10e = edHint.includes('10');
  return {
    gameSystem: '40k',
    edition: edHint || (is10e ? '10th Ed' : '11th Ed'),
    sysId: is10e ? 2821148162 : 827374861
  };
}
window.resolveHubListGameSystemAndEdition = resolveHubListGameSystemAndEdition;

function changeNewRecruitStudioSystem(sysId, returnToMyLists = true) {
  const numSysId = Number(sysId) || getDefaultNrStudioSystemIdForGameSystem();
  window._activeNrStudioSystemId = numSysId;
  const selEl = document.getElementById('hub-nr-studio-system-select');
  if (selEl && String(selEl.value) !== String(numSysId)) {
    selEl.value = String(numSysId);
  }
  const meta = NR_STUDIO_SYSTEMS[numSysId];
  const subEl = document.getElementById('hub-nr-studio-subtitle');
  if (subEl && meta) {
    subEl.textContent = `Active System: ${meta.label.replace(/^[^\w]+/, '')} • All lists sync automatically with My Hub`;
  }
  const iframe = document.getElementById('hub-nr-studio-iframe');
  if (iframe && iframe.contentWindow) {
    try {
      iframe.contentWindow.postMessage({
        type: 'OMNITACTICA_NR_COMMAND',
        command: 'select_system',
        id_system: numSysId,
        return_to_mylists: returnToMyLists
      }, '*');
    } catch (e) {}
  }
}
window.changeNewRecruitStudioSystem = changeNewRecruitStudioSystem;

function syncNewRecruitStudioToGameSystem(sys) {
  const targetSysId = getDefaultNrStudioSystemIdForGameSystem(sys);
  window._activeNrStudioSystemId = targetSysId;
  const selEl = document.getElementById('hub-nr-studio-system-select');
  if (selEl) {
    selEl.value = String(targetSysId);
  }
  const iframe = document.getElementById('hub-nr-studio-iframe');
  if (iframe && iframe.contentWindow) {
    changeNewRecruitStudioSystem(targetSysId, false);
  }
}
window.syncNewRecruitStudioToGameSystem = syncNewRecruitStudioToGameSystem;

function triggerNewRecruitStudioCreateList() {
  const iframe = document.getElementById('hub-nr-studio-iframe');
  if (!iframe || !iframe.contentWindow) return;
  const selEl = document.getElementById('hub-nr-studio-system-select');
  const activeSysId = (selEl && Number(selEl.value)) || window._activeNrStudioSystemId || getDefaultNrStudioSystemIdForGameSystem();
  try {
    iframe.contentWindow.postMessage({
      type: 'OMNITACTICA_NR_COMMAND',
      command: 'create_list',
      id_system: activeSysId
    }, '*');
  } catch (e) {}
}
window.triggerNewRecruitStudioCreateList = triggerNewRecruitStudioCreateList;

async function triggerNewRecruitStudioAuth() {
  const iframe = document.getElementById('hub-nr-studio-iframe');
  const localAuthFallback = getLocalNrCloudAccountFallback();
  const isConn = Boolean((hubNrCloudAccount && hubNrCloudAccount.connected) || (localAuthFallback && localAuthFallback.connected));
  if (isConn) {
    try {
      localStorage.removeItem('omni_nr_auth_backup_v1');
      localStorage.removeItem('access');
      localStorage.removeItem('refresh');
    } catch (e) {}
    try {
      if (window.api && typeof window.api.connectNewRecruitCloud === 'function') {
        await window.api.connectNewRecruitCloud({ action: 'disconnect' }).catch(() => {});
      }
    } catch (e) {}
    hubNrCloudAccount = { connected: false, login: '', last_sync: null };
    updateHubNrSyncPill();
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({
          type: 'OMNITACTICA_NR_COMMAND',
          command: 'toggle_auth',
          force_logout: true
        }, '*');
      } catch (e) {}
    }
    return;
  }
  if (iframe && iframe.contentWindow) {
    try {
      iframe.contentWindow.postMessage({
        type: 'OMNITACTICA_NR_COMMAND',
        command: 'toggle_auth'
      }, '*');
    } catch (e) {}
  }
}
window.triggerNewRecruitStudioAuth = triggerNewRecruitStudioAuth;

function extractNrRowTotalCostsPts(row) {
  if (!row || typeof row !== 'object') return 0;
  if (Array.isArray(row.totalCosts)) {
    for (let i = 0; i < row.totalCosts.length; i++) {
      const c = row.totalCosts[i];
      if (c && (c.typeId === 'pts' || c.name === 'pts' || i === 0) && Number(c.value) > 0) {
        return Number(c.value);
      }
    }
  } else if (row.totalCosts && typeof row.totalCosts === 'object' && Number(row.totalCosts.pts) > 0) {
    return Number(row.totalCosts.pts);
  }
  return 0;
}

function resolveHubEffectiveListPoints(l) {
  if (!l || typeof l !== 'object') return 2000;
  const rawId = String(l.list_key || l.nr_list_key || l.id || '');
  const listKey = rawId.replace(/^(nr_|list_)/, '').trim();
  try {
    const studioIframe = document.getElementById('hub-nr-studio-iframe');
    const win = studioIframe && studioIframe.contentWindow;
    const st = win && (win.__nr_stores || (win.__omnitacticaNrBridge && win.__omnitacticaNrBridge.getStores && win.__omnitacticaNrBridge.getStores()));
    if (st && st.list && Array.isArray(st.list.listData) && listKey) {
      const liveRow = st.list.listData.find(r => r && String(r.list_key || '') === listKey);
      if (liveRow) {
        const arrPts = extractNrRowTotalCostsPts(liveRow);
        if (arrPts > 0 && (!liveRow._compiled_by_nr || arrPts >= 1400)) {
          return arrPts;
        }
        const liveTotalCost = Number(liveRow.totalCost) || 0;
        if (liveTotalCost > 0 && (!liveRow._compiled_by_nr || liveTotalCost >= 1400)) {
          return liveTotalCost;
        }
      }
    }
  } catch (e) {}
  if (l.nr_row && typeof l.nr_row === 'object') {
    const rowArrPts = extractNrRowTotalCostsPts(l.nr_row);
    if (rowArrPts > 0 && (!l.nr_row._compiled_by_nr || rowArrPts >= 1400)) {
      return rowArrPts;
    }
  }
  return l.points !== undefined && l.points !== null ? l.points : 2000;
}
window.resolveHubEffectiveListPoints = resolveHubEffectiveListPoints;

function renderHubArmyLists(lists) {
  const container = document.getElementById('hub-armylists-list-container');
  if (!container) return;

  const activeSys = (typeof currentGameSystem !== 'undefined' && currentGameSystem === 'aos') ? 'aos' : '40k';
  const allLists = Array.isArray(lists) ? lists : [];
  const filteredLists = allLists.filter(l => resolveHubListGameSystemAndEdition(l).gameSystem === activeSys);
  const otherSysCount = allLists.length - filteredLists.length;

  const sysDisplayName = activeSys === 'aos' ? 'Age of Sigmar' : 'Warhammer 40K';
  const latestEditionName = activeSys === 'aos' ? 'Age of Sigmar 4.0' : 'Warhammer 40K 11th Edition';
  const otherSysName = activeSys === 'aos' ? 'Warhammer 40K' : 'Age of Sigmar';

  if (filteredLists.length === 0) {
    container.innerHTML = `
      <div style="padding: 1.35rem 1rem 0.65rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        <div style="font-size: 1.75rem; margin-bottom: 0.35rem;">${activeSys === 'aos' ? '⚡' : '⚔️'}</div>
        <div style="font-size: 1rem; font-weight: 800; color: #fff; margin-bottom: 0.3rem;">No ${sysDisplayName} Lists Created Yet</div>
        <div style="font-size: 0.78rem; max-width: 460px; margin: 0 auto 0.95rem; color: #94a3b8; line-height: 1.5;">
          Create, view, and manage your <b>${latestEditionName}</b> rosters — or switch between game systems &amp; editions — directly inside <b>NewRecruit Studio</b>. Your lists persist on this device and sync to My Hub automatically!
          ${otherSysCount > 0 ? `<div style="margin-top: 0.45rem; color: #38bdf8; font-weight: 600;">💡 You also have ${otherSysCount} saved ${otherSysName} ${otherSysCount === 1 ? 'roster' : 'rosters'}.</div>` : ''}
        </div>
        <div style="display: flex; align-items: center; justify-content: center; gap: 0.6rem; flex-wrap: wrap;">
          <button id="hub-empty-launch-nr-studio" class="bcp-login-btn" onpointerenter="ensureBackgroundNrStudioWarmup()" ontouchstart="ensureBackgroundNrStudioWarmup()" onclick="openNewRecruitStudioDrawer('/nr/app/Lists')" style="font-size: 0.82rem; padding: 0.45rem 1rem; background: var(--accent); color: #0f172a; font-weight: 800; display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
            ${activeSys === 'aos' ? '⚡' : '⚔️'} Launch NewRecruit Studio (${activeSys === 'aos' ? 'AoS 4.0' : '11th Ed'})
          </button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
      ${filteredLists.map(l => {
        const pts = resolveHubEffectiveListPoints(l);
        l.points = pts;
        const unitCount = Array.isArray(l.units) ? l.units.length : 0;
        const rawId = String(l.list_key || l.id || '');
        const listKey = rawId.startsWith('nr_') ? rawId.slice(3) : rawId;
        const srcBadge = (l.source_format && l.source_format.includes('Cloud')) ? '☁️ Cloud Synced' : '⚡ NewRecruit';
        const sysMeta = resolveHubListGameSystemAndEdition(l);
        const isAosList = sysMeta.gameSystem === 'aos';
        const editionLabel = sysMeta.edition || (isAosList ? 'AoS 4.0' : '11th Ed');
        const defaultFactionLabel = isAosList ? 'Age of Sigmar' : 'Warhammer 40k';
        const defaultDetLabel = isAosList ? 'Battle Formation' : 'Core Detachment';

        return `
          <div class="hub-rec-card" data-list-id="${escapeHtml(l.id)}" data-list-key="${escapeHtml(listKey)}" data-game-system="${escapeHtml(sysMeta.gameSystem)}" data-system-edition="${escapeHtml(editionLabel)}" style="flex-direction: column; align-items: stretch; gap: 0.65rem; padding: 0.85rem 1rem; background: rgba(19, 29, 51, 0.75); border: 1px solid rgba(56, 189, 248, 0.16); border-radius: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
              <div style="min-width: 0; flex: 1;">
                <div style="display: flex; align-items: center; gap: 0.35rem 0.45rem; flex-wrap: wrap; min-width: 0;">
                  <div style="font-size: 0.98rem; font-weight: 800; color: #fff; font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; min-width: 0; flex: 0 1 auto;">${escapeHtml(l.name || 'NewRecruit Roster')}</div>
                  <span style="font-size: 0.65rem; font-weight: 800; padding: 0.1rem 0.42rem; border-radius: 999px; background: rgba(56, 189, 248, 0.14); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.32); flex-shrink: 0; white-space: nowrap;">
                    ${escapeHtml(editionLabel)}
                  </span>
                  <span style="font-size: 0.65rem; font-weight: 800; padding: 0.1rem 0.42rem; border-radius: 999px; background: rgba(16, 185, 129, 0.12); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.28); flex-shrink: 0; white-space: nowrap;">
                    ${srcBadge}
                  </span>
                </div>
                <div style="font-size: 0.78rem; color: #38bdf8; font-weight: 700; margin-top: 0.18rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${escapeHtml(l.faction || defaultFactionLabel)} • <span style="color: #c084fc;">${escapeHtml(l.detachment || defaultDetLabel)}</span>
                  ${unitCount > 0 ? ` • <span style="color: #94a3b8; font-weight: 600;">${unitCount} ${unitCount === 1 ? 'Unit' : 'Units'}</span>` : ''}
                </div>
              </div>
              <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 800; font-family: var(--font-mono); font-size: 0.72rem; border: 1px solid rgba(245, 158, 11, 0.3); flex-shrink: 0;">
                ${pts} PTS
              </span>
            </div>

            <!-- Action Buttons Row: View, Play, Manage in NewRecruit, Delete -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.45rem; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 0.55rem; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                <button onclick="openViewArmyListModal('${escapeHtml(l.id)}')" class="subtab-btn" style="font-size: 0.74rem; padding: 0.28rem 0.68rem; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); font-weight: 700; cursor: pointer;" title="View interactive datasheets & stratagems in NewRecruit Play Mode">
                  🎮 Play Mode
                </button>
                <button onclick="launchTrackerWithList('${escapeHtml(l.id)}')" class="subtab-btn" style="font-size: 0.74rem; padding: 0.28rem 0.68rem; background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-weight: 700; cursor: pointer;">
                  ⚔️ Play in Tracker
                </button>
              </div>
              <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                <button onclick="openNewRecruitStudioForList('${escapeHtml(l.id)}')" class="subtab-btn" style="font-size: 0.74rem; padding: 0.28rem 0.72rem; background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.35); font-weight: 800; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" title="Modify or delete this list inside NewRecruit Studio">
                  🛠️ Manage in NewRecruit
                </button>
                <button onclick="deleteHubArmyList('${escapeHtml(l.id)}', false)" class="subtab-btn" style="font-size: 0.74rem; padding: 0.28rem 0.55rem; background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.3); font-weight: 800; cursor: pointer;" title="Delete Army List">
                  🗑️
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/* ==========================================================================
   OPTION 3 HYBRID: EMBEDDED NEWRECRUIT STUDIO DRAWER & CLOUD SYNC CONTROLLERS
   ========================================================================== */

let _nrStudioLoadTimer = null;

function showNewRecruitStudioLoading(labelText = '') {
  const overlay = document.getElementById('hub-nr-studio-loading-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'auto';
    if (labelText) {
      const titleEl = document.getElementById('hub-nr-studio-loading-title');
      if (titleEl) titleEl.textContent = labelText;
    }
  }
}

function hideNewRecruitStudioLoading() {
  if (_nrStudioLoadTimer) {
    clearInterval(_nrStudioLoadTimer);
    _nrStudioLoadTimer = null;
  }
  const overlay = document.getElementById('hub-nr-studio-loading-overlay');
  if (overlay && overlay.style.display !== 'none') {
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
    setTimeout(() => {
      if (overlay) overlay.style.display = 'none';
    }, 200);
  }
}

function openNewRecruitStudioForList(listId) {
  const list = (hubSavedLists || []).find(l => l.id === listId || l.list_key === listId);
  let listKey = '';
  if (list) {
    listKey = list.list_key || (String(list.id || '').startsWith('nr_') ? String(list.id).slice(3) : '');
  } else if (String(listId || '').startsWith('nr_')) {
    listKey = String(listId).slice(3);
  }
  const nameParam = list && list.name ? `?name=${encodeURIComponent(list.name)}` : '';
  const targetPath = listKey ? `/nr/app/Lists/${encodeURIComponent(listKey)}${nameParam}` : '/nr/app/Lists';
  const rowToPass = list ? (list.nr_row || { id_system: resolveHubListGameSystemAndEdition(list).sysId }) : null;
  openNewRecruitStudioDrawer(targetPath, list ? list.name : '', false, rowToPass);
}

function startNrStudioLoadWatcher(iframe, isDirectListTarget) {
  if (_nrStudioLoadTimer) clearInterval(_nrStudioLoadTimer);
  const startedAt = Date.now();
  _nrStudioLoadTimer = setInterval(() => {
    if (Date.now() - startedAt > 6500) {
      hideNewRecruitStudioLoading();
      return;
    }
    try {
      const doc = iframe && iframe.contentDocument;
      const win = iframe && iframe.contentWindow;
      if (isDirectListTarget) {
        if (win && win.location && /\/Lists\/[^\/\?\#]+/i.test(win.location.pathname || '')) {
          if (!doc || !doc.documentElement.classList.contains('omnitactica-nr-direct-list-loading')) {
            hideNewRecruitStudioLoading();
          }
        }
        return;
      }
      if (win && win.__nr_stores && win.__nr_stores.list && win.__nr_stores.list.listsInitiated) {
        hideNewRecruitStudioLoading();
        return;
      }
      if (doc && doc.body) {
        const hasRenderedUi = doc.querySelector('.bar, .folder, .listLine, table, button.btn, .system, #__nuxt > div');
        if (hasRenderedUi && (doc.body.innerText || '').trim().length > 20) {
          hideNewRecruitStudioLoading();
        }
      }
    } catch (e) {}
  }, 120);
}

function openNewRecruitStudioDrawer(initialPath = '/nr/app/Lists', listTitle = '', silentWarmup = false, nrRow = null) {
  let modal = document.getElementById('hub-newrecruit-studio-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'hub-newrecruit-studio-modal';
    modal.style.cssText = 'position:fixed; inset:0; z-index:100050; display:flex; align-items:center; justify-content:center; background:rgba(3,7,18,0.9); backdrop-filter:blur(8px); padding:10px; box-sizing:border-box;';
    document.body.appendChild(modal);
  }

  let safePath = initialPath || '/nr/app/Lists';
  if (safePath && !safePath.startsWith('/') && !safePath.startsWith('http')) {
    const cleanKey = safePath.startsWith('nr_') ? safePath.slice(3) : safePath;
    safePath = `/nr/app/Lists/${encodeURIComponent(cleanKey)}`;
  }
  const isDirectListTarget = /\/Lists\/[^\/\?\#]+/i.test(safePath);

  // Default to the latest edition of the active game system (40K 11th Ed or AoS 4.0), unless opening a specific list with its own id_system
  const activeSys = (typeof currentGameSystem !== 'undefined' && currentGameSystem === 'aos') ? 'aos' : '40k';
  const defaultSysId = (nrRow && Number(nrRow.id_system)) || getDefaultNrStudioSystemIdForGameSystem(activeSys);
  window._activeNrStudioSystemId = defaultSysId;
  const activeSysMeta = NR_STUDIO_SYSTEMS[defaultSysId] || NR_STUDIO_SYSTEMS[827374861];

  const subtitle = listTitle
    ? `Editing "${listTitle}" • All changes & deletions sync to My Hub automatically`
    : `Active System: ${activeSysMeta.label.replace(/^[^\w]+/, '')} • All lists sync automatically with My Hub`;

  // If the Studio iframe is already mounted & warm, reuse it without reloading from scratch!
  const existingIframe = document.getElementById('hub-nr-studio-iframe');
  if (existingIframe && existingIframe.contentWindow) {
    if (silentWarmup) return;
    const subEl = document.getElementById('hub-nr-studio-subtitle');
    if (subEl) subEl.textContent = subtitle;
    const selEl = document.getElementById('hub-nr-studio-system-select');
    if (selEl) selEl.value = String(defaultSysId);
    const closeBtn = document.getElementById('hub-btn-close-nr-studio');
    if (closeBtn) {
      closeBtn.disabled = false;
      closeBtn.innerHTML = '✕';
    }
    updateHubNrSyncPill();
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.style.pointerEvents = 'auto';
    modal.style.display = 'flex';
    if (safePath && safePath !== '/nr/app/Lists') {
      showNewRecruitStudioLoading(listTitle ? `Opening "${listTitle}"...` : 'Opening Army Roster...');
      navigateNewRecruitStudio(safePath, listTitle, nrRow, defaultSysId);
      startNrStudioLoadWatcher(existingIframe, isDirectListTarget);
    } else {
      navigateNewRecruitStudio('/nr/app/Lists', '', null, defaultSysId);
      hideNewRecruitStudioLoading();
    }
    return;
  }

  const sysParams = `sys=${encodeURIComponent(activeSys)}&sys_id=${encodeURIComponent(defaultSysId)}&_cb=${Date.now()}`;
  const iframeSrc = safePath + (safePath.includes('?') ? `&${sysParams}` : `?${sysParams}`);
  const isConnected = Boolean(hubNrCloudAccount && hubNrCloudAccount.connected);
  const loginName = (hubNrCloudAccount && hubNrCloudAccount.login) ? String(hubNrCloudAccount.login) : '';

  modal.innerHTML = `
    <style id="hub-nr-studio-responsive-styles">
      .hub-nr-studio-toolbar {
        padding: 8px 14px;
        background: linear-gradient(90deg, #0f172a 0%, #172554 100%);
        border-bottom: 1px solid rgba(56, 189, 248, 0.25);
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        box-sizing: border-box;
        width: 100%;
      }
      .hub-nr-studio-brand {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        flex: 1 1 240px;
      }
      .hub-nr-studio-controls {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-wrap: wrap;
        min-width: 0;
        max-width: 100%;
      }
      .hub-nr-studio-game-label {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: rgba(15, 23, 42, 0.85);
        border: 1px solid rgba(56, 189, 248, 0.4);
        border-radius: 8px;
        padding: 3px 8px;
        font-size: 11.5px;
        font-weight: 800;
        color: #e2e8f0;
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
      }
      .hub-nr-studio-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: nowrap;
        min-width: 0;
        max-width: 100%;
      }
      @media screen and (max-width: 820px) {
        #hub-newrecruit-studio-modal {
          padding: 4px !important;
        }
        .hub-nr-studio-window {
          width: 100% !important;
          height: 96dvh !important;
          border-radius: 10px !important;
        }
        .hub-nr-studio-toolbar {
          padding: 7px 9px !important;
          flex-direction: column !important;
          align-items: stretch !important;
          gap: 6px !important;
        }
        .hub-nr-studio-brand {
          flex: 0 0 auto !important;
          width: 100% !important;
        }
        #hub-nr-studio-subtitle {
          display: none !important;
        }
        .hub-nr-studio-controls {
          flex-direction: column-reverse !important;
          align-items: stretch !important;
          width: 100% !important;
          gap: 6px !important;
        }
        .hub-nr-studio-actions {
          width: 100% !important;
          justify-content: space-between !important;
          gap: 5px !important;
        }
        .hub-nr-studio-actions > button:not(#hub-btn-close-nr-studio) {
          padding: 6px 8px !important;
          font-size: 11.5px !important;
          white-space: nowrap !important;
        }
        #hub-btn-nr-studio-auth {
          flex: 1 1 auto !important;
          min-width: 0 !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          justify-content: center !important;
        }
        .hub-nr-studio-game-label {
          width: 100% !important;
          display: flex !important;
          padding: 4px 8px !important;
        }
        #hub-nr-studio-system-select {
          flex: 1 1 auto !important;
          width: 100% !important;
          min-width: 0 !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
      }
    </style>
    <div class="hub-nr-studio-window" style="background:#0b1120; border:1px solid rgba(56,189,248,0.35); border-radius:14px; width:min(1460px, 100%); height:min(94dvh, 980px); display:flex; flex-direction:column; overflow:hidden; box-shadow:0 30px 90px rgba(0,0,0,0.92); font-family:'Inter',system-ui,sans-serif; color:#f8fafc;">
      <!-- Studio Top Toolbar -->
      <div class="hub-nr-studio-toolbar">
        <div class="hub-nr-studio-brand">
          <span onclick="navigateNewRecruitStudio('/nr/app/Lists')" title="Return to My Lists" style="font-size:18px; flex-shrink:0; cursor:pointer;">⚔️</span>
          <div style="min-width:0; flex:1;">
            <div style="display:flex; align-items:center; gap:7px; flex-wrap:wrap;">
              <h3 onclick="navigateNewRecruitStudio('/nr/app/Lists')" title="Return to My Lists" style="font-size:14.5px; font-weight:900; color:#fff; margin:0; letter-spacing:0.01em; cursor:pointer;">NewRecruit Army Studio</h3>
            </div>
            <div id="hub-nr-studio-subtitle" style="font-size:10.5px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:1px;">
              ${escapeHtml(subtitle)}
            </div>
          </div>
        </div>

        <!-- Studio Header Controls: Game System & Edition Switcher, Back to Lists, Create List, Login/Logout, Close -->
        <div class="hub-nr-studio-controls">
          <label for="hub-nr-studio-system-select" class="hub-nr-studio-game-label" title="Switch Game System &amp; Edition in NewRecruit Army Studio">
            <span style="color:#38bdf8; font-size:10.5px; text-transform:uppercase; letter-spacing:0.04em; flex-shrink:0;">Game:</span>
            <select id="hub-nr-studio-system-select" onchange="changeNewRecruitStudioSystem(this.value)" style="background:transparent; border:none; color:#fff; font-size:11.5px; font-weight:800; outline:none; cursor:pointer; padding:2px 2px; min-width:0;">
              <option value="827374861" ${defaultSysId === 827374861 ? 'selected' : ''} style="background:#0f172a; color:#fff;">⚔️ Warhammer 40K — 11th Ed (Latest)</option>
              <option value="4255553472" ${defaultSysId === 4255553472 ? 'selected' : ''} style="background:#0f172a; color:#fff;">⚡ Age of Sigmar — 4.0 (Latest)</option>
              <option value="2821148162" ${defaultSysId === 2821148162 ? 'selected' : ''} style="background:#0f172a; color:#fff;">🛡️ Warhammer 40K — 10th Ed</option>
              <option value="4194757354" ${defaultSysId === 4194757354 ? 'selected' : ''} style="background:#0f172a; color:#fff;">🔨 Age of Sigmar — 3.0</option>
            </select>
          </label>
          <div class="hub-nr-studio-actions">
            <button id="hub-btn-nr-studio-mylists" onclick="navigateNewRecruitStudio('/nr/app/Lists')" title="View My Army Lists" style="display:inline-flex; align-items:center; gap:5px; background:rgba(56,189,248,0.14); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); border-radius:8px; font-size:12px; font-weight:800; padding:6px 11px; cursor:pointer; transition:all 0.15s ease; flex-shrink:0;">
              📋 Lists
            </button>
            <button id="hub-btn-nr-studio-create" onclick="triggerNewRecruitStudioCreateList()" title="Create a new Army List in the selected Game System &amp; Edition" style="display:inline-flex; align-items:center; gap:5px; background:#10b981; color:#052e16; border:1px solid #34d399; border-radius:8px; font-size:12px; font-weight:900; padding:6px 12px; cursor:pointer; transition:all 0.15s ease; box-shadow:0 2px 8px rgba(16,185,129,0.25); flex-shrink:0;">
              ➕ Create List
            </button>
            <button id="hub-btn-nr-studio-auth" onclick="triggerNewRecruitStudioAuth()" title="${isConnected ? `Signed in as ${escapeHtml(loginName || 'NewRecruit')} • Click to log out` : 'Sign in to your NewRecruit account'}" style="display:inline-flex; align-items:center; gap:5px; background:${isConnected ? 'rgba(239,68,68,0.16)' : 'rgba(56,189,248,0.18)'}; color:${isConnected ? '#fca5a5' : '#38bdf8'}; border:1px solid ${isConnected ? 'rgba(239,68,68,0.38)' : 'rgba(56,189,248,0.4)'}; border-radius:8px; font-size:12px; font-weight:800; padding:6px 12px; cursor:pointer; transition:all 0.15s ease;">
              ${isConnected ? `🚪 Logout${loginName ? ` (${escapeHtml(loginName)})` : ''}` : '🔑 Login'}
            </button>
            <button id="hub-btn-close-nr-studio" onclick="closeNewRecruitStudioDrawer()" title="Close NewRecruit Studio" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:8px; color:#cbd5e1; font-size:16px; font-weight:800; width:32px; height:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; transition:all 0.15s ease;">
              ✕
            </button>
          </div>
        </div>
      </div>

      <!-- Embedded Same-Origin NewRecruit App Iframe + Loading Screen Overlay -->
      <div style="flex:1; position:relative; background:#090d16; overflow:hidden;">
        <div id="hub-nr-studio-loading-overlay" style="position:absolute; inset:0; z-index:20; background:radial-gradient(circle at center, #0f172a 0%, #070b14 100%); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:24px; text-align:center; transition:opacity 0.2s ease;">
          <div class="spinner" style="width:42px; height:42px; border-width:3.5px; border-top-color:#38bdf8;"></div>
          <div id="hub-nr-studio-loading-title" style="font-size:16px; font-weight:900; color:#f8fafc; letter-spacing:0.01em;">
            ${escapeHtml(isDirectListTarget ? (listTitle ? `Opening "${listTitle}"...` : 'Opening Army Roster...') : 'Loading NewRecruit Army Studio...')}
          </div>
          <div style="font-size:12.5px; color:#94a3b8; max-width:420px; line-height:1.5;">
            Initializing faction books, detachment rules &amp; live Hub synchronization...
          </div>
        </div>
        <iframe
          id="hub-nr-studio-iframe"
          src="${escapeHtml(iframeSrc)}"
          title="NewRecruit Army Studio"
          style="width:100%; height:100%; border:none; display:block; background:#090d16;"
          allow="clipboard-read; clipboard-write"
        ></iframe>
      </div>
    </div>
  `;

  updateHubNrSyncPill();

  if (silentWarmup) {
    modal.style.display = 'flex';
    modal.style.visibility = 'hidden';
    modal.style.opacity = '0';
    modal.style.pointerEvents = 'none';
  } else {
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.style.pointerEvents = 'auto';
    modal.style.display = 'flex';
  }

  const iframe = document.getElementById('hub-nr-studio-iframe');
  startNrStudioLoadWatcher(iframe, isDirectListTarget);
}

function navigateNewRecruitStudio(targetPath, listName = '', nrRow = null, sysId = null) {
  const iframe = document.getElementById('hub-nr-studio-iframe');
  if (!iframe) return;
  const effectiveSysId = Number(sysId) || window._activeNrStudioSystemId || getDefaultNrStudioSystemIdForGameSystem();
  const isReturningToLists = !targetPath || /\/(Lists|MyLists)$/i.test(String(targetPath).split('?')[0]);
  const subEl = document.getElementById('hub-nr-studio-subtitle');
  if (subEl) {
    if (listName) {
      subEl.textContent = `Editing "${listName}" • All changes & deletions sync to My Hub automatically`;
    } else if (isReturningToLists) {
      const sysMeta = NR_STUDIO_SYSTEMS[effectiveSysId] || NR_STUDIO_SYSTEMS[827374861];
      subEl.textContent = `Active System: ${sysMeta.label.replace(/^[^\w]+/, '')} • All lists sync automatically with My Hub`;
    }
  }
  try {
    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'OMNITACTICA_NR_COMMAND',
        command: 'navigate',
        path: targetPath,
        list_name: listName || '',
        nr_row: nrRow || null,
        id_system: effectiveSysId
      }, '*');
      return;
    }
    iframe.src = targetPath;
  } catch (e) {
    iframe.src = targetPath;
  }
}

async function closeNewRecruitStudioDrawer() {
  const modal = document.getElementById('hub-newrecruit-studio-modal');
  const iframe = document.getElementById('hub-nr-studio-iframe');
  const closeBtn = document.getElementById('hub-btn-close-nr-studio');
  if (closeBtn) {
    closeBtn.disabled = true;
  }
  if (modal) {
    modal.style.visibility = 'hidden';
    modal.style.opacity = '0';
    modal.style.pointerEvents = 'none';
    modal.style.display = 'none';
  }
  try {
    if (iframe && iframe.contentWindow && iframe.contentWindow.__omnitacticaNrBridge) {
      const syncRes = await iframe.contentWindow.__omnitacticaNrBridge.forceFullSync();
      if (syncRes && Array.isArray(syncRes.army_lists)) {
        hubSavedLists = syncRes.army_lists;
        window.hubSavedLists = hubSavedLists;
        renderHubArmyLists(hubSavedLists);
      }
    } else if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'OMNITACTICA_NR_COMMAND', command: 'force_sync' }, '*');
    }
  } catch (e) {}
  if (closeBtn) {
    closeBtn.disabled = false;
    closeBtn.innerHTML = '✕';
  }
  await loadHubArmyLists();
}

// Listen for real-time IndexedDB sync events from the embedded NewRecruit Studio Bridge
if (!window.__omnitacticaNrParentListenerBound) {
  window.__omnitacticaNrParentListenerBound = true;
  window.addEventListener('message', async function(ev) {
    const msg = ev && ev.data;
    if (!msg || msg.type !== 'OMNITACTICA_NR_SYNC_EVENT') return;

    try {
      const studioIframe = document.getElementById('hub-nr-studio-iframe');
      const studioDoc = studioIframe && studioIframe.contentDocument;
      if (!studioDoc || !studioDoc.documentElement.classList.contains('omnitactica-nr-direct-list-loading')) {
        hideNewRecruitStudioLoading();
      }
    } catch (e) {
      hideNewRecruitStudioLoading();
    }
    if (msg.action === 'loading_progress' && msg.step) {
      if (window.__activeHubPlayModeController && typeof window.__activeHubPlayModeController.updatePlayLoadingStep === 'function') {
        window.__activeHubPlayModeController.updatePlayLoadingStep(msg.step);
      } else {
        const subEl = document.getElementById('hub-nr-play-loading-subtitle');
        if (subEl) subEl.textContent = String(msg.step);
      }
      return;
    }
    if (msg.action === 'ready') {
      const ctrl = window.__activeHubPlayModeController;
      const playIframe = document.getElementById('hub-nr-play-mode-iframe');
      const isFromPlayIframe = Boolean(playIframe && ev && ev.source === playIframe.contentWindow);
      const matchesPlayKey = Boolean(
        !ctrl ||
        !ctrl.listKey ||
        (msg.list_key && String(msg.list_key).replace(/^(nr_|list_)/, '') === String(ctrl.listKey).replace(/^(nr_|list_)/, '')) ||
        (isFromPlayIframe && playIframe.contentWindow && /\/Lists\/[^\/\?\#]+/i.test(playIframe.contentWindow.location.pathname || ''))
      );
      if (matchesPlayKey) {
        const playOv = document.getElementById('hub-nr-play-loading-overlay');
        if (playOv) {
          playOv.style.opacity = '0';
          playOv.style.pointerEvents = 'none';
          playOv.style.display = 'none';
        }
        if (ctrl && typeof ctrl.hidePlayLoading === 'function') {
          ctrl.hidePlayLoading();
        }
      }
      if (Array.isArray(hubSavedLists) && hubSavedLists.length > 0) {
        renderHubArmyLists(hubSavedLists);
      }
      return;
    }
    if (msg.action === 'native_exports' && msg.list_key) {
      const cleanK = String(msg.list_key || '').replace(/^(nr_|list_)/, '').trim();
      const applyExportsToList = (target) => {
        if (!target || typeof target !== 'object') return false;
        const tk = String(target.list_key || target.nr_list_key || target.id || '').replace(/^(nr_|list_)/, '').trim();
        if (!tk || tk !== cleanK) return false;
        if (msg.gw_text) {
          target.gw_text = msg.gw_text;
          target.raw_text = msg.gw_text;
          if (target.nr_row && typeof target.nr_row === 'object') {
            target.nr_row._omnitactica_gw_text = msg.gw_text;
          }
        }
        if (msg.nr_text) {
          target.nr_text = msg.nr_text;
          if (target.nr_row && typeof target.nr_row === 'object') {
            target.nr_row._omnitactica_nr_text = msg.nr_text;
          }
        }
        return true;
      };
      (hubSavedLists || []).forEach(applyExportsToList);
      const updatedActive = applyExportsToList(window._activeViewedRosterList);
      if (updatedActive && window._activeViewedRosterList) {
        const curFmt = String(window.hubCurrentRosterTextFormat || 'gw').toLowerCase() === 'nr' ? 'nr' : 'gw';
        const freshText = generateRawRosterText(window._activeViewedRosterList, curFmt);
        document.querySelectorAll('#hub-raw-roster-content, .hub-raw-roster-content').forEach(preEl => {
          preEl.textContent = freshText;
        });
      }
      return;
    }
    if (msg.action === 'compile_failed') {
      if (window.__activeHubPlayModeController && typeof window.__activeHubPlayModeController.showCompileFailedFallback === 'function') {
        window.__activeHubPlayModeController.showCompileFailedFallback(msg.errors || []);
      }
      return;
    }
    if (msg.action === 'system_status' && msg.id_system) {
      const numSys = Number(msg.id_system);
      if (NR_STUDIO_SYSTEMS[numSys]) {
        window._activeNrStudioSystemId = numSys;
        const selEl = document.getElementById('hub-nr-studio-system-select');
        if (selEl && String(selEl.value) !== String(numSys)) {
          selEl.value = String(numSys);
        }
        const subEl = document.getElementById('hub-nr-studio-subtitle');
        if (subEl && !String(subEl.textContent || '').startsWith('Editing ')) {
          subEl.textContent = `Active System: ${NR_STUDIO_SYSTEMS[numSys].label.replace(/^[^\w]+/, '')} • All lists sync automatically with My Hub`;
        }
      }
      return;
    }
    if (msg.action === 'auth_status' || msg.action === 'route_status') {
      if (typeof msg.logged_in !== 'undefined') {
        hubNrCloudAccount = {
          connected: Boolean(msg.logged_in),
          login: msg.login || '',
          last_sync: new Date().toISOString()
        };
        updateHubNrSyncPill();
      }
      if (msg.path) {
        const cleanRoutePath = String(msg.path).split('?')[0];
        const onMyLists = /\/MyLists$/i.test(cleanRoutePath);
        const myListsBtn = document.getElementById('hub-btn-nr-studio-mylists');
        if (myListsBtn) {
          myListsBtn.style.display = 'inline-flex';
          myListsBtn.style.background = onMyLists ? 'rgba(56,189,248,0.26)' : 'rgba(56,189,248,0.14)';
          myListsBtn.style.borderColor = onMyLists ? 'rgba(56,189,248,0.65)' : 'rgba(56,189,248,0.35)';
        }
        if (onMyLists) {
          const subEl = document.getElementById('hub-nr-studio-subtitle');
          const curSysId = window._activeNrStudioSystemId || getDefaultNrStudioSystemIdForGameSystem();
          const sysMeta = NR_STUDIO_SYSTEMS[curSysId] || NR_STUDIO_SYSTEMS[827374861];
          if (subEl) {
            subEl.textContent = `Active System: ${sysMeta.label.replace(/^[^\w]+/, '')} • All lists sync automatically with My Hub`;
          }
          if (Array.isArray(hubSavedLists) && hubSavedLists.length > 0) {
            renderHubArmyLists(hubSavedLists);
          }
        }
      }
      return;
    }

    if (msg.action === 'upsert' && msg.army_list) {
      clearHubListDeletedTombstone(msg.army_list.list_key || msg.army_list.id, msg.army_list.name);
      const upItem = msg.army_list;
      const upKey = String(upItem.list_key || (upItem.nr_row && upItem.nr_row.list_key) || upItem.id || '').replace(/^(nr_|list_)/, '').trim();
      let replaced = false;
      const nextLists = (Array.isArray(hubSavedLists) ? hubSavedLists : []).map(existing => {
        const exKey = String(existing.list_key || (existing.nr_row && existing.nr_row.list_key) || existing.id || '').replace(/^(nr_|list_)/, '').trim();
        if (upKey && exKey === upKey) {
          replaced = true;
          return upItem;
        }
        return existing;
      });
      if (!replaced) {
        nextLists.unshift(upItem);
      }
      hubSavedLists = nextLists;
      window.hubSavedLists = hubSavedLists;
      renderHubArmyLists(hubSavedLists);
      return;
    } else if (msg.action === 'delete' && msg.list_key) {
      markHubListDeletedTombstone(msg.list_key, '');
      const delKey = String(msg.list_key || '').replace(/^(nr_|list_)/, '').trim();
      hubSavedLists = (Array.isArray(hubSavedLists) ? hubSavedLists : []).filter(existing => {
        const exKey = String(existing.list_key || (existing.nr_row && existing.nr_row.list_key) || existing.id || '').replace(/^(nr_|list_)/, '').trim();
        return !delKey || exKey !== delKey;
      });
      window.hubSavedLists = hubSavedLists;
      renderHubArmyLists(hubSavedLists);
      return;
    }

    if (Array.isArray(msg.army_lists)) {
      const existingCloudOnly = (Array.isArray(hubSavedLists) ? hubSavedLists : []).filter(
        l => l && l.source_format && String(l.source_format).includes('Cloud')
      );
      hubSavedLists = mergeHubNewRecruitLists(msg.army_lists.filter(l => !isHubListTombstoned(l)), existingCloudOnly);
      window.hubSavedLists = hubSavedLists;
      renderHubArmyLists(hubSavedLists);
    } else {
      await loadHubArmyLists();
    }
  });
}

async function openNewRecruitCloudModal() {
  let modal = document.getElementById('hub-newrecruit-cloud-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'hub-newrecruit-cloud-modal';
    modal.style.cssText = 'position:fixed; inset:0; z-index:100060; display:flex; align-items:center; justify-content:center; background:rgba(3,7,18,0.88); backdrop-filter:blur(8px); padding:16px; box-sizing:border-box;';
    document.body.appendChild(modal);
  }

  try {
    const st = await window.api.connectNewRecruitCloud({ action: 'status' });
    if (st && typeof st.connected === 'boolean') {
      hubNrCloudAccount = st;
      updateHubNrSyncPill();
    }
  } catch (e) {}

  const isConnected = Boolean(hubNrCloudAccount && hubNrCloudAccount.connected);
  const connectedLogin = (hubNrCloudAccount && hubNrCloudAccount.login) || '';

  modal.innerHTML = `
    <div style="background:#0b1120; border:1px solid rgba(200,30,60,0.4); border-radius:18px; width:100%; max-width:480px; box-shadow:0 28px 80px rgba(0,0,0,0.92), 0 0 40px rgba(200,30,60,0.12); display:flex; flex-direction:column; overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc;">
      <!-- Authentic NewRecruit Branded Top Banner -->
      <div style="padding:20px 22px 16px; background:linear-gradient(145deg, #162a45 0%, #0f1c2e 65%, #1f1224 100%); border-bottom:1px solid rgba(255,255,255,0.1); position:relative;">
        <button onclick="closeNewRecruitCloudModal()" style="position:absolute; top:14px; right:14px; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.14); color:#cbd5e1; width:30px; height:30px; border-radius:8px; font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center;">✕</button>

        <!-- OAuth App Handshake Row -->
        <div style="display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:12px;">
          <div style="width:52px; height:52px; border-radius:14px; background:#1b3556; border:2px solid rgba(225,29,72,0.55); box-shadow:0 8px 20px rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; overflow:hidden;">
            <img src="/assets/integrations/nr_icon.png" alt="NewRecruit" style="width:44px; height:44px; object-fit:contain;" />
          </div>
          <div style="display:flex; flex-direction:column; align-items:center; color:#94a3b8; font-size:11px; font-weight:800;">
            <span style="color:#fb7185; font-size:15px; line-height:1;">⇄</span>
            <span style="font-size:9px; letter-spacing:0.08em; text-transform:uppercase; color:#64748b; margin-top:2px;">SYNC</span>
          </div>
          <div style="width:48px; height:48px; border-radius:13px; background:#0f172a; border:1px solid rgba(56,189,248,0.4); box-shadow:0 8px 20px rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; overflow:hidden;">
            <img src="/assets/logo-192.png" alt="OmniTactica" style="width:36px; height:36px; object-fit:contain;" />
          </div>
        </div>

        <div style="text-align:center;">
          <h3 style="font-size:1.12rem; font-weight:800; color:#fff; margin:0; letter-spacing:-0.01em;">Sign in with NewRecruit</h3>
          <div style="font-size:0.76rem; color:#cbd5e1; margin-top:3px;">Authorize OmniTactica to sync your cloud army lists &amp; folders</div>
          <div style="display:inline-flex; align-items:center; gap:5px; margin-top:9px; padding:3px 10px; border-radius:999px; background:rgba(2,6,23,0.65); border:1px solid rgba(16,185,129,0.35); font-family:monospace; font-size:0.69rem; color:#34d399;">
            <span>🔒</span> <span>https://www.newrecruit.eu</span>
          </div>
        </div>
      </div>

      <div style="padding:18px 22px 20px; display:flex; flex-direction:column; gap:15px; overflow-y:auto; max-height:78vh;">
        ${isConnected ? `
          <div style="background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.35); border-radius:12px; padding:12px 14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <img src="/assets/integrations/nr_icon.png" alt="" style="width:30px; height:30px; border-radius:7px; background:#1b3556; padding:2px;" />
              <div>
                <div style="font-size:12.5px; font-weight:800; color:#10b981;">🟢 Linked as ${escapeHtml(connectedLogin)}</div>
                <div style="font-size:11px; color:#94a3b8; margin-top:1px;">Cloud rosters automatically sync with My Hub &amp; Studio</div>
              </div>
            </div>
            <div style="display:flex; gap:7px;">
              <button id="hub-btn-nr-cloud-resync" onclick="triggerNewRecruitCloudSync()" style="background:#10b981; color:#052e16; border:none; font-weight:800; font-size:11.5px; padding:7px 12px; border-radius:8px; cursor:pointer;">
                🔄 Sync Now
              </button>
              <button onclick="disconnectNewRecruitCloud()" style="background:rgba(239,68,68,0.14); color:#f87171; border:1px solid rgba(239,68,68,0.3); font-weight:700; font-size:11.5px; padding:7px 10px; border-radius:8px; cursor:pointer;">
                Unlink
              </button>
            </div>
          </div>
        ` : ''}

        <!-- Authentic NewRecruit Sign-In Form Card -->
        <div style="background:#111c2d; border:1px solid rgba(148,163,184,0.18); border-radius:14px; padding:16px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.04);">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:7px;">
              <img src="/assets/integrations/nr_icon.png" alt="" style="width:18px; height:18px; object-fit:contain;" />
              <span style="font-size:0.76rem; font-weight:800; color:#e2e8f0; text-transform:uppercase; letter-spacing:0.04em;">${isConnected ? 'Switch NewRecruit Account' : 'NewRecruit.eu Credentials'}</span>
            </div>
            <span style="font-size:0.66rem; color:#94a3b8; background:rgba(255,255,255,0.06); padding:2px 7px; border-radius:4px;">Direct Auth</span>
          </div>

          <div style="display:flex; flex-direction:column; gap:11px;">
            <div>
              <label for="hub-nr-cloud-login" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">NewRecruit Login or Email</label>
              <div style="position:relative; display:flex; align-items:center;">
                <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">👤</span>
                <input id="hub-nr-cloud-login" type="text" value="${escapeHtml(connectedLogin)}" placeholder="Username or email" autocomplete="username" style="width:100%; background:#080f1a; border:1px solid #2e4361; border-radius:9px; padding:10px 12px 10px 34px; color:#fff; font-size:0.84rem; box-sizing:border-box; outline:none;" />
              </div>
            </div>
            <div>
              <label for="hub-nr-cloud-password" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Password</label>
              <div style="position:relative; display:flex; align-items:center;">
                <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🔑</span>
                <input id="hub-nr-cloud-password" type="password" placeholder="Enter your NewRecruit password" autocomplete="current-password" style="width:100%; background:#080f1a; border:1px solid #2e4361; border-radius:9px; padding:10px 38px 10px 34px; color:#fff; font-size:0.84rem; box-sizing:border-box; outline:none;" onkeydown="if(event.key==='Enter')submitNewRecruitCloudConnect()" />
                <button type="button" onclick="const p=document.getElementById('hub-nr-cloud-password'); if(p){p.type=p.type==='password'?'text':'password'; this.textContent=p.type==='password'?'👁️':'🙈';}" style="position:absolute; right:8px; background:none; border:none; color:#94a3b8; cursor:pointer; font-size:0.85rem; padding:4px;" title="Toggle password visibility">👁️</button>
              </div>
            </div>
            <div id="hub-nr-cloud-status-msg" style="font-size:11.5px; display:none;"></div>
            <button id="hub-btn-nr-cloud-submit" onclick="submitNewRecruitCloudConnect()" style="margin-top:2px; background:linear-gradient(135deg, #be123c 0%, #e11d48 100%); color:#fff; font-weight:800; font-size:0.84rem; border:1px solid rgba(251,113,133,0.4); padding:11px 16px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 6px 18px rgba(225,29,72,0.3);">
              <img src="/assets/integrations/nr_icon.png" alt="" style="width:18px; height:18px; object-fit:contain;" />
              <span>Sign In with NewRecruit &amp; Sync Lists</span>
            </button>
          </div>
        </div>

        <!-- Section 2: Quick Sync by NewRecruit Share Link / List ID -->
        <div style="background:rgba(15,23,42,0.65); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px 14px;">
          <div style="font-size:12px; font-weight:800; color:#e2e8f0; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
            <span>⚡</span> Or Import via NewRecruit Share URL
          </div>
          <div style="display:flex; gap:8px; margin-top:6px;">
            <input id="hub-nr-share-url-input" type="text" placeholder="https://www.newrecruit.eu/app/list/..." style="flex:1; background:#070b14; border:1px solid #334155; border-radius:8px; padding:8px 11px; color:#fff; font-size:12px; box-sizing:border-box; outline:none;" />
            <button id="hub-btn-nr-share-sync" onclick="handleNewRecruitShareUrlSync()" style="background:var(--accent); color:#0f172a; font-weight:800; font-size:12px; border:none; padding:8px 14px; border-radius:8px; cursor:pointer; white-space:nowrap;">
              Sync Link
            </button>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; padding-top:2px; font-size:11px; color:#64748b;">
          <span>🛡️ Direct encrypted session with newrecruit.eu</span>
          <button onclick="closeNewRecruitCloudModal(); openNewRecruitStudioDrawer('/nr/app/Lists');" style="background:transparent; border:none; color:#38bdf8; font-size:11.5px; font-weight:700; cursor:pointer; text-decoration:underline;">
            Open NewRecruit Studio →
          </button>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
}

function closeNewRecruitCloudModal() {
  const modal = document.getElementById('hub-newrecruit-cloud-modal');
  if (modal) modal.style.display = 'none';
}

async function submitNewRecruitCloudConnect() {
  const loginEl = document.getElementById('hub-nr-cloud-login');
  const passEl = document.getElementById('hub-nr-cloud-password');
  const msgEl = document.getElementById('hub-nr-cloud-status-msg');
  const btn = document.getElementById('hub-btn-nr-cloud-submit');
  const login = loginEl ? loginEl.value.trim() : '';
  const password = passEl ? passEl.value.trim() : '';

  if (!login || !password) {
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.color = '#f87171';
      msgEl.textContent = 'Please enter both your NewRecruit username/email and password.';
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Connecting to NewRecruit.eu...';
  }
  if (msgEl) {
    msgEl.style.display = 'none';
  }

  try {
    const res = await window.api.connectNewRecruitCloud({ action: 'connect', login, password });
    if (!res || !res.success) {
      throw new Error((res && res.error) || 'Failed to authenticate with NewRecruit Cloud');
    }
    hubNrCloudAccount = {
      connected: true,
      login: res.login || login,
      last_sync: res.last_sync
    };
    updateHubNrSyncPill();
    await loadHubArmyLists();
    closeNewRecruitCloudModal();
  } catch (e) {
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.color = '#f87171';
      msgEl.textContent = e.message || 'Authentication failed';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔗 Connect & Sync Cloud Lists';
    }
  }
}

async function triggerNewRecruitCloudSync() {
  const btn = document.getElementById('hub-btn-nr-cloud-resync');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Syncing...';
  }
  try {
    const res = await window.api.connectNewRecruitCloud({ action: 'sync' });
    if (res && res.success) {
      await loadHubArmyLists();
      closeNewRecruitCloudModal();
    }
  } catch (e) {
    console.warn('Cloud sync error:', e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Sync Now';
    }
  }
}

async function disconnectNewRecruitCloud() {
  try {
    try {
      localStorage.removeItem('omni_nr_auth_backup_v1');
      localStorage.removeItem('access');
    } catch (e2) {}
    await window.api.connectNewRecruitCloud({ action: 'disconnect' });
    hubNrCloudAccount = { connected: false, login: '', last_sync: null };
    updateHubNrSyncPill();
    await loadHubArmyLists();
    closeNewRecruitCloudModal();
  } catch (e) {}
}

async function handleNewRecruitShareUrlSync() {
  const input = document.getElementById('hub-nr-share-url-input');
  const btn = document.getElementById('hub-btn-nr-share-sync');
  const msgEl = document.getElementById('hub-nr-cloud-status-msg');
  const urlVal = input ? input.value.trim() : '';
  if (!urlVal) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Syncing...';
  }
  try {
    const res = await window.api.connectNewRecruitCloud({ action: 'sync_link', share_url: urlVal });
    if (!res || !res.success) {
      throw new Error((res && res.error) || 'Could not sync NewRecruit link');
    }
    const syncedItem = res.army_list || (Array.isArray(res.army_lists) && res.army_lists[0]);
    if (syncedItem && syncedItem.nr_row) {
      await writeNrRowToSameOriginIdb(syncedItem.nr_row);
    }
    await loadHubArmyLists();
    closeNewRecruitCloudModal();
  } catch (e) {
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.color = '#f87171';
      msgEl.textContent = e.message;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Sync Link';
    }
  }
}

function parseUnitsFromGwTextJS(gwText) {
  const txt = String(gwText || '').trim();
  if (!txt) return [];
  const rawLines = txt.split(/\r?\n/);
  const headerRoles = {
    'CHARACTERS': 'Character',
    'BATTLELINE': 'Battleline',
    'DEDICATED TRANSPORTS': 'Dedicated Transport',
    'OTHER DATASHEETS': 'Other Datasheets',
    'ALLIED UNITS': 'Allied Units',
    'ATTACHED UNITS': 'Character',
    'UNATTACHED UNITS': 'Other Datasheets'
  };
  let startedBody = false;
  let currentRole = 'Other Datasheets';
  let currentUnit = null;
  let currentAttachedGroup = null;
  const attachedGroups = [];
  const parsedUnits = [];

  const isModelBullet = (modelLabel, unitName) => {
    const mLow = String(modelLabel || '').toLowerCase().trim();
    const uLow = String(unitName || '').toLowerCase().trim();
    if (!mLow || !uLow) return false;
    if (mLow === uLow || uLow.includes(mLow) || uLow.startsWith(mLow) || mLow.replace(/s$/, '') === uLow.replace(/s$/, '')) {
      return true;
    }
    return /(sergeant|master|champion|captain|lieutenant|leader|justiciar|destroyer|praetorian|warrior|immortal|warden|guard)$/i.test(mLow);
  };

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const upper = trimmed.toUpperCase();
    if (/^(EXPORTED WITH|CREATED WITH|DATA VERSION:)/i.test(trimmed)) continue;

    if (headerRoles[upper]) {
      startedBody = true;
      currentRole = headerRoles[upper];
      currentUnit = null;
      if (upper === 'ATTACHED UNITS') {
        currentAttachedGroup = [];
        attachedGroups.push(currentAttachedGroup);
      } else {
        currentAttachedGroup = null;
      }
      continue;
    }
    if (/^ATTACHED\s+UNIT(\s+\d+)?$/i.test(trimmed)) {
      startedBody = true;
      currentRole = 'Character';
      currentUnit = null;
      currentAttachedGroup = [];
      attachedGroups.push(currentAttachedGroup);
      continue;
    }
    if (!startedBody) continue;

    const enhMatch = trimmed.match(/^[•◦‣\-*\s]*Enhancements?:\s*(.+?)(?:\s*\((?:Upgrade|\+?([\d,]+)\s*(?:pts?|points?))\))?$/i);
    if (enhMatch && currentUnit) {
      currentUnit.enhancement = enhMatch[1].trim();
      if (enhMatch[2]) currentUnit.enhancement_pts = parseInt(enhMatch[2].replace(/,/g, ''), 10) || 0;
      continue;
    }

    const isBullet = /^[•◦‣\-*]/.test(trimmed) || /^\s{2,}/.test(rawLine);
    if (!isBullet) {
      const uMatch = trimmed.match(/^([^\(\[]+?)\s*\((?:([\d,]+)\s*pts?|([\d,]+)\s*points?)\)$/i);
      if (uMatch) {
        const uName = uMatch[1].trim();
        const uPts = parseInt((uMatch[2] || uMatch[3] || '0').replace(/,/g, ''), 10) || 0;
        currentUnit = {
          name: uName,
          role: currentRole,
          points: uPts,
          model_count: 1,
           _countedModels: false,
          is_warlord: false,
          enhancement: null,
          wargear: []
        };
        parsedUnits.push(currentUnit);
        if (currentAttachedGroup) currentAttachedGroup.push(currentUnit);
        continue;
      }
    }

    if (currentUnit && isBullet) {
      const isSubBullet = /^[◦‣]/.test(trimmed) || /^\s{4,}/.test(rawLine);
      const cleanItem = trimmed.replace(/^[•◦‣\-*\s]+/, '').trim();
      if (!cleanItem) continue;
      if (/^warlord$/i.test(cleanItem)) {
        currentUnit.is_warlord = true;
        continue;
      }
      if (/^attached as:\s*/i.test(cleanItem)) {
        const attRole = cleanItem.replace(/^attached as:\s*/i, '').trim().toLowerCase();
        if (attRole.includes('leader') || attRole.includes('char') || attRole.includes('support')) {
          currentUnit.role = 'Character';
          currentUnit._attachedRole = 'leader';
        } else if (attRole.includes('bodyguard')) {
          if (currentUnit.role === 'Character') currentUnit.role = 'Other Datasheets';
          currentUnit._attachedRole = 'bodyguard';
        }
        continue;
      }
      const cntMatch = cleanItem.match(/^(\d+)x\s+(.+)$/i);
      if (!isSubBullet && cntMatch) {
        const cnt = parseInt(cntMatch[1], 10) || 1;
        const itemLabel = cntMatch[2].trim();
        if (isModelBullet(itemLabel, currentUnit.name)) {
          if (!currentUnit._countedModels) {
            currentUnit.model_count = cnt;
            currentUnit._countedModels = true;
          } else {
            currentUnit.model_count += cnt;
          }
          continue;
        }
      }
      if (!currentUnit.wargear.includes(cleanItem)) {
        currentUnit.wargear.push(cleanItem);
      }
    }
  }

  for (const grp of attachedGroups) {
    if (grp.length >= 2) {
      const bodyguards = grp.filter(u => u._attachedRole === 'bodyguard');
      const leaders = grp.filter(u => u._attachedRole !== 'bodyguard');
      const targetBg = bodyguards.length ? bodyguards[bodyguards.length - 1] : grp[grp.length - 1];
      for (const ldr of (leaders.length ? leaders : grp.slice(0, -1))) {
        if (ldr !== targetBg) {
          ldr.leading = targetBg.name;
          targetBg.attached_to = ldr.name;
        }
      }
    }
  }
  return parsedUnits;
}

function resolveHubRosterList(listId) {
  const cleanKey = String(listId || '').replace(/^(nr_|list_)/, '').trim();
  const active = window._activeViewedRosterList;
  if (active && typeof active === 'object') {
    const activeId = String(active.id || '').trim();
    const activeKey = String(active.list_key || active.nr_list_key || '').replace(/^(nr_|list_)/, '').trim();
    if (!cleanKey || activeId === listId || activeKey === cleanKey || activeId.replace(/^(nr_|list_)/, '') === cleanKey) {
      return active;
    }
  }
  const found = (hubSavedLists || []).find(l => {
    if (!l) return false;
    const lid = String(l.id || '').trim();
    const lkey = String(l.list_key || l.nr_list_key || '').replace(/^(nr_|list_)/, '').trim();
    return lid === listId || l.list_key === listId || (cleanKey && (lkey === cleanKey || lid.replace(/^(nr_|list_)/, '') === cleanKey));
  });
  return found || active || null;
}

function hasPlaceholderZeroPointsText(txt) {
  const s = String(txt || '').trim();
  if (s.length < 20) return true;
  return /\(\s*0\s+(?:Points|pts)\s*\)/i.test(s);
}

const _nrNativeExportRequestedAt = {};

function requestNativeExportsFromNrEngine(list) {
  if (!list || typeof list !== 'object') return;
  const row = (list.nr_row && typeof list.nr_row === 'object') ? list.nr_row : null;
  const hasNrBacking = Boolean(
    row ||
    list.nr_list_key ||
    list.list_key ||
    String(list.id || '').startsWith('nr_') ||
    list.source === 'newrecruit' ||
    list.source === 'newrecruit_link'
  );
  if (!hasNrBacking) return;

  const rowGw = String((row && row._omnitactica_gw_text) || '').trim();
  const rowNr = String((row && row._omnitactica_nr_text) || '').trim();
  const gwCandidate = String(rowGw || list.gw_text || '').trim();
  const nrCandidate = String(rowNr || list.nr_text || '').trim();
  const hasRealNativeExports = row
    ? (!hasPlaceholderZeroPointsText(rowGw) && !hasPlaceholderZeroPointsText(rowNr))
    : (!hasPlaceholderZeroPointsText(gwCandidate) && !hasPlaceholderZeroPointsText(nrCandidate));
  if (hasRealNativeExports) {
    return;
  }

  const listKey = resolveHubNrListKey(list);
  if (!listKey) return;
  const now = Date.now();
  if (_nrNativeExportRequestedAt[listKey] && (now - _nrNativeExportRequestedAt[listKey] < 4000)) {
    return;
  }
  _nrNativeExportRequestedAt[listKey] = now;

  const isSavedInHub = Array.isArray(hubSavedLists) && hubSavedLists.some(l => {
    if (!l) return false;
    const lk = resolveHubNrListKey(l);
    return (list.id && l.id === list.id) || (lk && lk === listKey);
  });
  const isEphemeralList = Boolean(
    list._ephemeral_view ||
    (row && row._ephemeral_view) ||
    !isSavedInHub
  );
  const rowPayload = row
    ? (isEphemeralList ? Object.assign({}, row, { _ephemeral_view: true }) : row)
    : null;

  const cmdPayload = {
    type: 'OMNITACTICA_NR_COMMAND',
    command: 'export_list_texts',
    list_key: listKey,
    ephemeral: isEphemeralList,
    nr_row: rowPayload
  };

  const playIframe = document.getElementById('hub-nr-play-mode-iframe');
  const studioIframe = document.getElementById('hub-nr-studio-iframe');
  let sentToActive = false;

  if (playIframe && playIframe.contentWindow) {
    try {
      playIframe.contentWindow.postMessage(cmdPayload, '*');
      sentToActive = true;
    } catch (e) {}
  }
  if (studioIframe && studioIframe.contentWindow) {
    try {
      studioIframe.contentWindow.postMessage(cmdPayload, '*');
      sentToActive = true;
    } catch (e) {}
  }

  if (!sentToActive) {
    let headlessIframe = document.getElementById('omni-nr-headless-export-iframe');
    if (!headlessIframe) {
      headlessIframe = document.createElement('iframe');
      headlessIframe.id = 'omni-nr-headless-export-iframe';
      headlessIframe.src = '/nr/app/MyLists?embed=hub';
      headlessIframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;opacity:0;pointer-events:none;border:none;';
      document.body.appendChild(headlessIframe);
    }
    const postToHeadless = () => {
      try {
        if (headlessIframe && headlessIframe.contentWindow) {
          headlessIframe.contentWindow.postMessage(cmdPayload, '*');
        }
      } catch (e) {}
    };
    setTimeout(postToHeadless, 400);
    setTimeout(postToHeadless, 1600);
    setTimeout(postToHeadless, 3200);
  }
}

function generateRawRosterText(list, format = null) {
  if (!list || typeof list !== 'object') return '';
  const fmt = String(format || window.hubCurrentRosterTextFormat || 'gw').toLowerCase() === 'nr' ? 'nr' : 'gw';
  const row = (list.nr_row && typeof list.nr_row === 'object') ? list.nr_row : {};
  requestNativeExportsFromNrEngine(list);

  if (fmt === 'nr') {
    const rowNr = String(row._omnitactica_nr_text || '').trim();
    if (rowNr.length > 10 && !hasPlaceholderZeroPointsText(rowNr)) {
      return rowNr;
    }
    const existingNr = String(list.nr_text || rowNr || '').trim();
    if (existingNr.length > 10 && !hasPlaceholderZeroPointsText(existingNr) && (existingNr.startsWith('++++') || existingNr.includes('+ FACTION KEYWORD:') || existingNr.includes('++ '))) {
      return existingNr;
    }
    const rawCandidate = String(list.raw_text || '').trim();
    if (!hasPlaceholderZeroPointsText(rawCandidate) && (rawCandidate.startsWith('++++') || rawCandidate.includes('+ FACTION KEYWORD:'))) {
      return rawCandidate;
    }
    if (existingNr.length > 10 && (existingNr.startsWith('++++') || existingNr.includes('+ FACTION KEYWORD:') || existingNr.includes('++ '))) {
      requestNativeExportsFromNrEngine(list);
      return existingNr;
    }
    const pts = Number(list.points || 2000) || 2000;
    const name = String(list.name || 'Army Roster').trim();
    const faction = String(list.faction || 'Warhammer 40,000').trim();
    const det = String(list.detachment || 'Core Detachment').trim();
    let units = Array.isArray(list.units) ? list.units.filter(Boolean) : [];
    const hasWargear = units.some(u => Array.isArray(u.wargear) && u.wargear.length > 0);
    if (!units.length || !hasWargear) {
      const gwSource = String(list.gw_text || row._omnitactica_gw_text || list.raw_text || '').trim();
      const parsedFromGw = parseUnitsFromGwTextJS(gwSource);
      if (parsedFromGw.length > 0) {
        units = parsedFromGw;
      }
    }

    const chars = [];
    const others = [];
    for (const u of units) {
      if (!u) continue;
      const r = String(u.role || '').toUpperCase();
      if (r.includes('CHAR') || r.includes('HERO') || r.includes('LEADER') || r.includes('EPIC') || u.is_warlord || u.enhancement) {
        chars.push(u);
      } else {
        others.push(u);
      }
    }

    let warlordHeader = '';
    const enhHeaders = [];
    chars.forEach((cUnit, idx) => {
      const cName = String(cUnit.name || 'Unit').replace(/^\d+x\s+/i, '').trim();
      if (cUnit.is_warlord && !warlordHeader) {
        warlordHeader = `Char${idx + 1}: ${cName}`;
      }
      if (cUnit.enhancement) {
        enhHeaders.push(`${cUnit.enhancement} (on Char${idx + 1}: ${cName})`);
      }
    });
    if (!warlordHeader && list.warlord) {
      warlordHeader = String(list.warlord).trim();
    }

    const lines = [
      '+++++++++++++++++++++++++++++++++++++++++++++++',
      `+ ARMY NAME: ${name}`,
      `+ FACTION KEYWORD: ${faction}`
    ];
    if (det && det !== 'Core Detachment' && det !== 'Unknown Detachment') {
      lines.push(`+ DETACHMENT: ${det}`);
    }
    lines.push(`+ TOTAL ARMY POINTS: ${pts}pts`, '+');
    if (warlordHeader) lines.push(`+ WARLORD: ${warlordHeader}`);
    if (enhHeaders.length > 0) {
      lines.push(`+ ENHANCEMENT: ${enhHeaders[0]}`);
      for (let i = 1; i < enhHeaders.length; i++) {
        lines.push(`& ${enhHeaders[i]}`);
      }
    }
    lines.push(`+ NUMBER OF UNITS: ${units.length}`, '+++++++++++++++++++++++++++++++++++++++++++++++', '');

    chars.forEach((cUnit, idx) => {
      const cName = String(cUnit.name || 'Unit').replace(/^\d+x\s+/i, '').trim();
      const cPts = Number(cUnit.points || 0) || 0;
      const cModels = Math.max(1, Number(cUnit.model_count || cUnit.models || 1) || 1);
      const wgParts = [];
      if (cUnit.is_warlord) wgParts.push('Warlord');
      for (const wg of (Array.isArray(cUnit.wargear) ? cUnit.wargear : [])) {
        const wgClean = String(wg || '').replace(/^1x\s+/i, '').trim();
        if (wgClean && wgClean.toLowerCase() !== 'warlord') wgParts.push(wgClean);
      }
      const wgSuffix = wgParts.length ? `: ${wgParts.join(', ')}` : '';
      lines.push(`Char${idx + 1}: ${cModels}x ${cName} (${cPts} pts)${wgSuffix}`);
      if (cUnit.enhancement) {
        const enhPts = cUnit.enhancement_pts ? ` (+${cUnit.enhancement_pts} pts)` : '';
        lines.push(`Enhancement: ${cUnit.enhancement}${enhPts}`);
      }
      if (cUnit.leading) {
        lines.push(`Leading ${String(cUnit.leading).replace(/^Leading\s+/i, '').trim()}`);
      }
      lines.push('');
    });

    for (const oUnit of others) {
      const oName = String(oUnit.name || 'Unit').replace(/^\d+x\s+/i, '').trim();
      const oPts = Number(oUnit.points || 0) || 0;
      const oModels = Math.max(1, Number(oUnit.model_count || oUnit.models || 1) || 1);
      const wgList = (Array.isArray(oUnit.wargear) ? oUnit.wargear : [])
        .map(w => String(w || '').replace(/^1x\s+/i, '').trim())
        .filter(w => w && w.toLowerCase() !== 'warlord');
      let wgSuffix = '';
      if (oModels > 1 && wgList.length) {
        const tokenWg = [];
        const modelWg = [];
        for (const w of wgList) {
          const mCnt = w.match(/^(\d+)x\s+(.*)$/i);
          if (mCnt && parseInt(mCnt[1], 10) !== oModels) {
            tokenWg.push(w);
          } else if (mCnt) {
            modelWg.push(mCnt[2].trim());
          } else {
            modelWg.push(w.replace(/^\d+\s+with\s+/i, '').trim());
          }
        }
        const parts = [...tokenWg];
        if (modelWg.length) parts.push(`${oModels} with ${modelWg.join(', ')}`);
        if (parts.length) wgSuffix = `: ${parts.join(', ')}`;
      } else if (wgList.length) {
        wgSuffix = `: ${wgList.join(', ')}`;
      }
      lines.push(`${oModels}x ${oName} (${oPts} pts)${wgSuffix}`);
      if (oUnit.attached_to) {
        lines.push(`  Attached to ${String(oUnit.attached_to).replace(/^Attached\s+to\s+/i, '').trim()}`);
      }
    }
    lines.push('', 'Created with newrecruit.eu v36.27');
    requestNativeExportsFromNrEngine(list);
    return lines.join('\n').trim();
  }

  // Default: GW Format
  const rowGw = String(row._omnitactica_gw_text || '').trim();
  if (rowGw.length > 10 && !hasPlaceholderZeroPointsText(rowGw) && !rowGw.startsWith('++++') && !rowGw.includes('+ FACTION KEYWORD:')) {
    return rowGw;
  }
  const existingGw = String(list.gw_text || rowGw || '').trim();
  if (existingGw.length > 10 && !hasPlaceholderZeroPointsText(existingGw) && !existingGw.startsWith('++++') && !existingGw.includes('+ FACTION KEYWORD:')) {
    return existingGw;
  }
  const rawCandidate = String(list.raw_text || '').trim();
  if (rawCandidate.length > 10 && !hasPlaceholderZeroPointsText(rawCandidate) && !rawCandidate.startsWith('++++') && !rawCandidate.includes('+ FACTION KEYWORD:')) {
    return rawCandidate;
  }
  if (existingGw.length > 10 && !existingGw.startsWith('++++') && !existingGw.includes('+ FACTION KEYWORD:')) {
    requestNativeExportsFromNrEngine(list);
    return existingGw;
  }

  const pts = Number(list.points || 2000) || 2000;
  const ptsComma = pts.toLocaleString('en-US');
  const name = String(list.name || 'Army Roster').trim();
  const factionRaw = String(list.faction || 'Warhammer 40,000').trim();
  let superfaction = '';
  let subfaction = factionRaw;
  if (factionRaw.includes(' - ')) {
    const parts = factionRaw.split(' - ', 2);
    superfaction = parts[0].trim();
    subfaction = parts[1].trim();
  }
  const det = String(list.detachment || 'Core Detachment').trim();
  const sizeLabel = pts <= 1000 ? `Incursion (${ptsComma} Points)` : (pts <= 2000 ? `Strike Force (${ptsComma} Points)` : `Onslaught (${ptsComma} Points)`);

  const lines = [`${name} (${ptsComma} Points)`, ''];
  if (superfaction && superfaction.toLowerCase() !== subfaction.toLowerCase()) {
    lines.push(superfaction);
  }
  lines.push(subfaction, det, sizeLabel);

  const units = Array.isArray(list.units) ? list.units : [];
  const groups = {
    CHARACTERS: [],
    BATTLELINE: [],
    'DEDICATED TRANSPORTS': [],
    'OTHER DATASHEETS': [],
    'ALLIED UNITS': []
  };
  for (const u of units) {
    if (!u) continue;
    const r = String(u.role || 'Other Datasheets').toUpperCase();
    if (r.includes('CHARACTER') || r.includes('HERO') || r.includes('EPIC')) groups.CHARACTERS.push(u);
    else if (r.includes('BATTLELINE')) groups.BATTLELINE.push(u);
    else if (r.includes('TRANSPORT')) groups['DEDICATED TRANSPORTS'].push(u);
    else if (r.includes('ALLIED') || r.includes('ALLY')) groups['ALLIED UNITS'].push(u);
    else groups['OTHER DATASHEETS'].push(u);
  }

  for (const [sec, uList] of Object.entries(groups)) {
    if (!uList.length) continue;
    lines.push('', sec);
    for (const u of uList) {
      lines.push('', `${u.name || 'Unit'} (${u.points || 0} Points)`);
      if (u.is_warlord) lines.push('  • Warlord');
      if (Array.isArray(u.wargear)) {
        for (const w of u.wargear) {
          if (w) lines.push(`  • ${w}`);
        }
      }
      if (u.enhancement) lines.push(`  • Enhancements: ${u.enhancement}`);
    }
  }
  lines.push('', 'Exported with New Recruit, https://www.newrecruit.eu');
  requestNativeExportsFromNrEngine(list);
  return lines.join('\n').trim();
}

window.generateRawRosterText = generateRawRosterText;

window.setHubRosterTextFormat = function(fmt, listId, btnEl = null) {
  const cleanFmt = String(fmt || 'gw').toLowerCase() === 'nr' ? 'nr' : 'gw';
  window.hubCurrentRosterTextFormat = cleanFmt;
  const list = resolveHubRosterList(listId);
  if (list) requestNativeExportsFromNrEngine(list);
  const newText = list ? generateRawRosterText(list, cleanFmt) : '';

  const localRoot = (btnEl && typeof btnEl.closest === 'function')
    ? btnEl.closest('.hub-roster-text-viewer-root')
    : null;
  const scopes = localRoot ? [localRoot, document] : [document];

  for (const scope of scopes) {
    const preEls = scope.querySelectorAll('#hub-raw-roster-content, .hub-raw-roster-content');
    preEls.forEach(preEl => {
      if (list) preEl.textContent = newText;
    });
    const gwBtns = scope.querySelectorAll('#hub-btn-text-fmt-gw, .hub-btn-text-fmt-gw');
    gwBtns.forEach(gwBtn => {
      gwBtn.style.background = cleanFmt === 'gw' ? '#0284c7' : 'transparent';
      gwBtn.style.color = cleanFmt === 'gw' ? '#fff' : '#94a3b8';
    });
    const nrBtns = scope.querySelectorAll('#hub-btn-text-fmt-nr, .hub-btn-text-fmt-nr');
    nrBtns.forEach(nrBtn => {
      nrBtn.style.background = cleanFmt === 'nr' ? '#0284c7' : 'transparent';
      nrBtn.style.color = cleanFmt === 'nr' ? '#fff' : '#94a3b8';
    });
    const copyBtns = scope.querySelectorAll('#hub-btn-copy-raw-text, .hub-btn-copy-raw-text');
    copyBtns.forEach(copyBtn => {
      copyBtn.setAttribute('data-format', cleanFmt);
      copyBtn.innerHTML = cleanFmt === 'nr' ? '📋 Copy NewRecruit Text' : '📋 Copy GW Text';
    });
  }
};

window.copyHubRawText = function(listId, format = null) {
  const list = resolveHubRosterList(listId);
  if (!list) return;
  const activeFmt = format || window.hubCurrentRosterTextFormat || 'gw';
  const rawText = generateRawRosterText(list, activeFmt);
  const label = String(activeFmt).toLowerCase() === 'nr' ? 'NewRecruit' : 'GW';
  navigator.clipboard.writeText(rawText).then(() => {
    alert(`📋 ${label} Format roster text copied to clipboard!`);
  }).catch(() => {
    prompt(`Copy your ${label} Format roster text below:`, rawText);
  });
};

window.setHubRosterViewMode = function(mode, listId) {
  window.hubCurrentViewMode = mode;
  openViewArmyListModal(listId, mode);
};

function resolveHubNrListKey(list) {
  if (!list) return 'roster';
  const rawKey = String(
    list.nr_list_key ||
    list.list_key ||
    (list.nr_row && list.nr_row.list_key) ||
    list.id ||
    'roster'
  ).trim();
  return rawKey.startsWith('nr_') ? rawKey.slice(3) : rawKey;
}

function renderNonNewRecruitFallbackView(list, options = {}) {
  const units = (list && Array.isArray(list.units)) ? list.units : [];
  const rawText = generateRawRosterText(list || {}, 'gw');
  const switchRawJs = options.onViewRawText || `setHubRosterViewMode('text', '${escapeHtml(list && list.id ? list.id : '')}')`;
  const sourceFmt = (list && list.source_format) ? String(list.source_format) : 'Plain Text';

  const unitCardsHtml = units.length > 0 ? units.map(u => {
    const wg = Array.isArray(u.wargear) && u.wargear.length > 0
      ? `<div style="margin-top:6px; font-size:11px; color:#94a3b8; line-height:1.45;">${u.wargear.map(w => `<div>• ${escapeHtml(w)}</div>`).join('')}</div>`
      : '';
    const enh = u.enhancement
      ? `<div style="margin-top:4px; font-size:11px; color:#c084fc; font-weight:700;">✨ Enhancement: ${escapeHtml(u.enhancement)}</div>`
      : '';
    const modelCnt = u.model_count || u.models || 1;
    return `
      <div style="background:#0f172a; border:1px solid rgba(56,189,248,0.18); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; justify-content:space-between;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <div>
            <div style="font-size:13px; font-weight:800; color:#f8fafc;">
              ${escapeHtml(u.name || 'Unit')}${u.is_warlord ? ' <span style="color:#facc15; font-size:11px;">👑 Warlord</span>' : ''}
            </div>
            <div style="font-size:11px; color:#38bdf8; font-weight:600; margin-top:2px;">
              ${escapeHtml(u.role || 'Unit')}${modelCnt > 1 ? ` • ${modelCnt} Models` : ''}
            </div>
          </div>
          <span style="font-size:12px; font-weight:800; color:#f59e0b; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.3); padding:2px 8px; border-radius:6px; font-family:var(--font-mono); white-space:nowrap;">
            ${u.points || 0} pts
          </span>
        </div>
        ${enh}
        ${wg}
      </div>
    `;
  }).join('') : '';

  return `
    <div id="hub-nr-non-compatible-notice" style="display:flex; flex-direction:column; padding:20px; flex:1; overflow-y:auto; background:#070b14; gap:16px;">
      <div style="background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.35); border-radius:12px; padding:16px 18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div style="display:flex; align-items:flex-start; gap:12px; max-width:780px;">
          <span style="font-size:24px; line-height:1;">⚠️</span>
          <div>
            <div style="font-size:14px; font-weight:900; color:#fbbf24; margin-bottom:4px;">
              List Not Created by NewRecruit
            </div>
            <div style="font-size:12.5px; color:#cbd5e1; line-height:1.5;">
              This army list was submitted in <b>${escapeHtml(sourceFmt)}</b> format rather than exported from NewRecruit, so interactive NewRecruit Play Mode datasheets cannot be generated for this roster. You can inspect the raw list text or parsed unit summary below.
            </div>
          </div>
        </div>
        <button onclick="${switchRawJs}" style="background:#1e293b; color:#38bdf8; border:1px solid rgba(56,189,248,0.35); font-weight:800; font-size:12px; padding:8px 14px; border-radius:8px; cursor:pointer; white-space:nowrap;">
          📄 View Raw List
        </button>
      </div>

      ${units.length > 0 ? `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.22); border-radius:10px; padding:10px 14px;">
          <div style="font-size:12px; color:#cbd5e1;">
            <b style="color:#38bdf8;">📋 Parsed Unit Summary</b> — ${escapeHtml((list && list.faction) || 'Warhammer 40,000')} • ${escapeHtml((list && list.detachment) || 'Detachment')} • <b style="color:#f59e0b;">${(list && list.points) || 0} pts</b> (${units.length} ${units.length === 1 ? 'unit' : 'units'})
          </div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:10px;">
          ${unitCardsHtml}
        </div>
      ` : `
        <pre style="flex:1; margin:0; background:#030712; border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:18px; font-family:'JetBrains Mono',monospace; font-size:12px; color:#e2e8f0; line-height:1.6; white-space:pre-wrap; overflow-y:auto; word-break:break-word;">${escapeHtml(rawText)}</pre>
      `}
    </div>
  `;
}
window.renderNonNewRecruitFallbackView = renderNonNewRecruitFallbackView;

function renderNativeRosterViewer(list, options = {}) {
  const viewMode = (options.mode || window.hubCurrentViewMode) === 'text' ? 'text' : 'play';
  if (list && options.ephemeral) {
    list._ephemeral_view = true;
    if (list.nr_row && typeof list.nr_row === 'object') {
      list.nr_row._ephemeral_view = true;
    }
  }
  window._activeViewedRosterList = list;

  if (viewMode === 'text') {
    const activeFmt = String(options.textFormat || window.hubCurrentRosterTextFormat || 'gw').toLowerCase() === 'nr' ? 'nr' : 'gw';
    window.hubCurrentRosterTextFormat = activeFmt;
    const rawText = generateRawRosterText(list, activeFmt);
    const listIdSafe = escapeHtml((list && (list.id || list.list_key)) || '');
    return `
      <div class="hub-roster-text-viewer-root" style="display:flex; flex-direction:column; padding:20px; flex:1; overflow:hidden; background:#070b14;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <div style="font-size:13px; font-weight:800; color:#38bdf8; display:flex; align-items:center; gap:6px;">
              <span>📄</span> Roster Text Format:
            </div>
            <div style="display:inline-flex; background:rgba(15,23,42,0.9); border:1px solid rgba(56,189,248,0.3); border-radius:8px; padding:2px; gap:2px;">
              <button id="hub-btn-text-fmt-gw" class="hub-btn-text-fmt-gw" type="button" onclick="setHubRosterTextFormat('gw', '${listIdSafe}', this)" style="background:${activeFmt === 'gw' ? '#0284c7' : 'transparent'}; color:${activeFmt === 'gw' ? '#fff' : '#94a3b8'}; border:none; padding:5px 11px; border-radius:6px; font-weight:800; font-size:11.5px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
                🏛️ GW Format
              </button>
              <button id="hub-btn-text-fmt-nr" class="hub-btn-text-fmt-nr" type="button" onclick="setHubRosterTextFormat('nr', '${listIdSafe}', this)" style="background:${activeFmt === 'nr' ? '#0284c7' : 'transparent'}; color:${activeFmt === 'nr' ? '#fff' : '#94a3b8'}; border:none; padding:5px 11px; border-radius:6px; font-weight:800; font-size:11.5px; cursor:pointer; display:inline-flex; align-items:center; gap:5px;">
                ⚔️ NewRecruit Format
              </button>
            </div>
          </div>
          <button id="hub-btn-copy-raw-text" class="hub-btn-copy-raw-text" type="button" data-format="${activeFmt}" onclick="copyHubRawText('${listIdSafe}', this.getAttribute('data-format'))" style="background:#1e293b; color:#38bdf8; border:1px solid rgba(56,189,248,0.3); font-weight:800; font-size:12px; padding:7px 16px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
            ${activeFmt === 'nr' ? '📋 Copy NewRecruit Text' : '📋 Copy GW Text'}
          </button>
        </div>
        <pre id="hub-raw-roster-content" class="hub-raw-roster-content" style="flex:1; margin:0; background:#030712; border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:18px; font-family:'JetBrains Mono',monospace; font-size:12px; color:#e2e8f0; line-height:1.6; white-space:pre-wrap; overflow-y:auto; word-break:break-word;">${escapeHtml(rawText)}</pre>
      </div>
    `;
  }

  const isExplicitlyIncompatible = Boolean(
    options.compileFailed ||
    !list ||
    list.is_newrecruit_compatible === false ||
    (list.nr_row && list.nr_row._is_nr_compatible === false)
  );

  const hasNrBacking = Boolean(
    list && (
      list.nr_row ||
      list.nr_list_key ||
      list.list_key ||
      String(list.id || '').startsWith('nr_') ||
      list.source === 'newrecruit' ||
      list.source === 'newrecruit_link'
    )
  );

  if (isExplicitlyIncompatible || !hasNrBacking) {
    return renderNonNewRecruitFallbackView(list, options);
  }

  const listKey = resolveHubNrListKey(list);
  const isEphemeralView = Boolean(options.ephemeral || list._ephemeral_view || (list.nr_row && list.nr_row._ephemeral_view));
  try {
    if (list.nr_row && window.sessionStorage) {
      const rowToStore = isEphemeralView ? Object.assign({}, list.nr_row, { _ephemeral_view: true }) : list.nr_row;
      window.sessionStorage.setItem('omni_pending_nr_row_' + listKey, JSON.stringify(rowToStore));
    }
  } catch (e) {}

  const ephParam = isEphemeralView ? '&ephemeral=1' : '';
  const nameParam = list.name ? `&name=${encodeURIComponent(list.name)}` : '';
  const iframeUrl = `/nr/app/Lists/${encodeURIComponent(listKey)}?view=play&embed=hub${ephParam}${nameParam}&_cb=${Date.now()}`;

  return `
    <div id="hub-nr-play-mode-wrapper" style="flex:1; width:100%; height:100%; min-height:560px; position:relative; background:#090d16; display:flex; flex-direction:column; overflow:hidden;">
      <div id="hub-nr-play-loading-overlay" style="position:absolute; inset:0; z-index:20; background:radial-gradient(circle at center, #0f172a 0%, #070b14 100%); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:24px; text-align:center; transition:opacity 0.2s ease;">
        <div class="spinner" style="width:38px; height:38px; border-width:3px; border-top-color:#38bdf8;"></div>
        <div style="font-size:15px; font-weight:900; color:#f8fafc;">Opening "${escapeHtml(list.name || 'Army Roster')}" in Play Mode...</div>
        <div id="hub-nr-play-loading-subtitle" style="font-size:12px; color:#94a3b8;">Loading interactive datasheets, weapons &amp; detachment stratagems...</div>
      </div>
      <iframe
        id="hub-nr-play-mode-iframe"
        data-list-key="${escapeHtml(listKey)}"
        src="${iframeUrl}"
        title="NewRecruit Play Mode - Datasheets & Stratagems"
        style="width:100%; height:100%; min-height:560px; flex:1; border:none; display:block; background:#090d16;"
        allow="clipboard-read; clipboard-write"
      ></iframe>
    </div>
  `;
}
window.renderNativeRosterViewer = renderNativeRosterViewer;

function attachHubPlayModeIframeLifecycle(list, containerEl = null, options = {}) {
  const root = containerEl || document;
  const iframe = root.querySelector ? root.querySelector('#hub-nr-play-mode-iframe') : document.getElementById('hub-nr-play-mode-iframe');
  if (!iframe || !list) return;

  const listKey = resolveHubNrListKey(list);
  const isEphemeralView = Boolean(options.ephemeral || list._ephemeral_view || (list.nr_row && list.nr_row._ephemeral_view));
  let settled = false;

  const updatePlayLoadingStep = (stepText) => {
    const subEl = (root.querySelector ? root.querySelector('#hub-nr-play-loading-subtitle') : null) || document.getElementById('hub-nr-play-loading-subtitle');
    if (subEl && stepText) {
      subEl.textContent = String(stepText);
    }
  };

  const hidePlayLoading = () => {
    const ov = (root.querySelector ? root.querySelector('#hub-nr-play-loading-overlay') : null) || document.getElementById('hub-nr-play-loading-overlay');
    if (ov) {
      ov.style.opacity = '0';
      ov.style.pointerEvents = 'none';
      ov.style.display = 'none';
    }
  };

  const showCompileFailedFallback = (errors = []) => {
    if (settled) return;
    settled = true;
    if (playWatcher) clearInterval(playWatcher);
    hidePlayLoading();
    const wrapper = (root.querySelector ? root.querySelector('#hub-nr-play-mode-wrapper') : null) || document.getElementById('hub-nr-play-mode-wrapper') || (iframe && iframe.parentElement);
    if (wrapper) {
      wrapper.outerHTML = renderNonNewRecruitFallbackView(list, Object.assign({}, options, { compileFailed: true, compileErrors: errors }));
    }
  };

  window.__activeHubPlayModeController = {
    listKey,
    list,
    updatePlayLoadingStep,
    hidePlayLoading,
    showCompileFailedFallback
  };

  const startedAt = Date.now();
  const playWatcher = setInterval(() => {
    if (!document.body.contains(iframe)) {
      clearInterval(playWatcher);
      return;
    }
    if (Date.now() - startedAt > 30000) {
      clearInterval(playWatcher);
      hidePlayLoading();
      return;
    }
    try {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (win && win.__omniCompileFailedForKey === listKey) {
        showCompileFailedFallback();
        return;
      }
      if (win && win.__omnitacticaNrBridge && win.location && /\/Lists\/[^\/\?\#]+/i.test(win.location.pathname || '')) {
        const hasPlayDom = Boolean(doc && doc.querySelector && doc.querySelector('.tableList, .listControls, .armyList'));
        if (doc && !doc.documentElement.classList.contains('omnitactica-nr-direct-list-loading') && hasPlayDom) {
          clearInterval(playWatcher);
          hidePlayLoading();
        }
      }
    } catch (e) {}
  }, 80);

  const sendPlayCmd = () => {
    if (settled) return;
    try {
      if (iframe.contentWindow) {
        const nrRowPayload = list.nr_row
          ? (isEphemeralView ? Object.assign({}, list.nr_row, { _ephemeral_view: true, synced: 0 }) : list.nr_row)
          : null;
        iframe.contentWindow.postMessage({
          type: 'OMNITACTICA_NR_COMMAND',
          command: 'open_play_mode',
          list_key: listKey,
          list_name: list.name || '',
          play: true,
          ephemeral: isEphemeralView,
          nr_row: nrRowPayload
        }, '*');
      }
    } catch (e) {}
  };

  iframe.addEventListener('load', () => {
    sendPlayCmd();
  });
}
window.attachHubPlayModeIframeLifecycle = attachHubPlayModeIframeLifecycle;

async function openViewArmyListModal(listId, mode = null) {
  const cleanKey = String(listId || '').replace(/^(nr_|list_)/, '');
  let list = (hubSavedLists || []).find(l =>
    l.id === listId ||
    l.list_key === listId ||
    l.list_key === cleanKey ||
    String(l.id || '').replace(/^(nr_|list_)/, '') === cleanKey
  );
  if (!list || (!list.nr_row && !list.list_key && (!list.units || list.units.length === 0))) {
    try {
      const res = await window.api.getArmyList(listId);
      if (res && res.army_list) list = res.army_list;
    } catch(e) {}
  }
  if (!list) {
    alert('List not found');
    return;
  }

  const activeMode = (mode || window.hubCurrentViewMode) === 'text' ? 'text' : 'play';
  window.hubCurrentViewMode = activeMode;

  let modal = document.getElementById('hub-view-armylist-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'hub-view-armylist-modal';
    document.body.appendChild(modal);
  }
  modal.style.cssText = 'position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; background:rgba(3,7,18,0.92); backdrop-filter:blur(8px); padding:4px; box-sizing:border-box;';

  const bodyHtml = renderNativeRosterViewer(list, { mode: activeMode });

  modal.innerHTML = `
    <div class="modal-window hub-armylist-modal-window" style="background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:12px; width:min(1440px, 100%); height:96dvh; max-height:96dvh; display:flex; flex-direction:column; overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc; box-shadow:0 30px 80px rgba(0,0,0,0.9);">
      <!-- Ultra-Compact Single-Row Play Mode Toolbar -->
      <div class="modal-header hub-armylist-modal-header" style="padding:5px 10px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center; gap:6px; flex-shrink:0; flex-wrap:nowrap; min-height:38px;">
        <div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1; overflow:hidden;">
          <div style="font-size:13.5px; font-weight:900; color:#fff; font-family:var(--font-mono); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(list.name || 'Army Roster')} (${escapeHtml(list.faction || '40k')} • ${escapeHtml(list.detachment || 'Core')})">
            ${escapeHtml(list.name || 'Army Roster')}
          </div>
          <span class="hub-btn-lbl-mob-hide" style="font-size:10.5px; font-weight:800; color:#f59e0b; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.3); padding:1px 6px; border-radius:6px; flex-shrink:0;">
            ${resolveHubEffectiveListPoints(list)} pts
          </span>
        </div>

        <div class="hub-armylist-controls-row" style="display:flex; align-items:center; gap:5px; flex-shrink:0;">
          <div style="display:flex; background:rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:2px; gap:2px;">
            <button onclick="setHubRosterViewMode('play', '${list.id}')" title="Interactive NewRecruit Play Mode (Datasheets & Stratagems)" style="background:${activeMode==='play'?'#0284c7':'transparent'}; color:${activeMode==='play'?'#fff':'#94a3b8'}; border:none; padding:4px 8px; border-radius:4px; font-weight:800; font-size:11px; cursor:pointer; display:inline-flex; align-items:center; gap:3px; white-space:nowrap;">
              🎮 Play
            </button>
            <button onclick="setHubRosterViewMode('text', '${list.id}')" title="Raw Roster Text" style="background:${activeMode==='text'?'#0284c7':'transparent'}; color:${activeMode==='text'?'#fff':'#94a3b8'}; border:none; padding:4px 8px; border-radius:4px; font-weight:800; font-size:11px; cursor:pointer; display:inline-flex; align-items:center; gap:3px; white-space:nowrap;">
              📄 Text
            </button>
          </div>

          <button onclick="launchTrackerWithList('${list.id}')" title="Play in Live Game Tracker" style="background:#10b981; color:#052e16; font-weight:800; font-size:11px; border:none; padding:5px 8px; border-radius:6px; cursor:pointer; white-space:nowrap;">
            ⚔️<span class="hub-btn-lbl-mob-hide"> Tracker</span>
          </button>
          <button onclick="closeViewArmyListModal(); openNewRecruitStudioForList('${list.id}')" title="Edit Roster in NewRecruit Studio" style="background:rgba(168,85,247,0.18); color:#c084fc; border:1px solid rgba(168,85,247,0.38); font-weight:800; font-size:11px; padding:4px 8px; border-radius:6px; cursor:pointer; white-space:nowrap;">
            🛠️<span class="hub-btn-lbl-mob-hide"> Edit</span>
          </button>
          <button onclick="deleteHubArmyList('${list.id}', true)" style="background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.35); font-weight:800; font-size:11px; padding:4px 7px; border-radius:6px; cursor:pointer;" title="Delete Army List">
            🗑️
          </button>
          <button onclick="closeViewArmyListModal()" title="Close" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:6px; color:#cbd5e1; font-size:15px; font-weight:800; width:28px; height:28px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;">
            ✕
          </button>
        </div>
      </div>

      <!-- Native Roster Viewer Body -->
      ${bodyHtml}
    </div>
  `;
  modal.style.display = 'flex';

  if (activeMode === 'play') {
    attachHubPlayModeIframeLifecycle(list, modal);
  }
}

function closeViewArmyListModal() {
  const modal = document.getElementById('hub-view-armylist-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.innerHTML = '';
  }
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

async function removeNrListKeyFromSameOriginIdb(listKey, listName = '') {
  if (!listKey && !listName) return;
  const cleanKey = String(listKey || '').replace(/^(nr_|list_)/, '').trim();
  const cleanNameLow = String(listName || '').trim().toLowerCase();
  const keysToPurge = new Set();
  if (cleanKey) keysToPurge.add(cleanKey);

  // Immediately persist deleted tombstone in localStorage (0ms synchronous)
  markHubListDeletedTombstone(cleanKey, cleanNameLow);

  try {
    let hasNrDb = true;
    if (typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases();
      const nrMeta = (dbs || []).find(d => d && d.name === 'nr');
      if (!nrMeta) hasNrDb = false;
    }
    if (hasNrDb) {
      await new Promise(resolve => {
        let settled = false;
        let dbRef = null;
        const done = () => {
          if (settled) return;
          settled = true;
          if (dbRef) {
            try { dbRef.close(); } catch (e) {}
          }
          resolve();
        };
        setTimeout(done, 800);
        const req = indexedDB.open('nr');
        req.onupgradeneeded = (ev) => {
          try { ev.target.transaction.abort(); } catch (e) {}
          done();
        };
        req.onsuccess = () => {
          const db = req.result;
          dbRef = db;
          if (!db || !db.objectStoreNames || !db.objectStoreNames.contains('lists')) {
            done();
            return;
          }
          try {
            const tx = db.transaction('lists', 'readwrite');
            const store = tx.objectStore('lists');
            const curReq = store.openCursor();
            curReq.onsuccess = (ev) => {
              const cursor = ev.target.result;
              if (cursor) {
                const row = cursor.value;
                if (row) {
                  const rKey = String(row.list_key || '').trim();
                  const rNameLow = String(row.name || '').trim().toLowerCase();
                  const rMigTo = (row.metadata && row.metadata.migrated_to) ? String(row.metadata.migrated_to).trim() : '';
                  const isMatch = (
                    (cleanKey && rKey === cleanKey) ||
                    (rKey && keysToPurge.has(rKey)) ||
                    (rMigTo && (rMigTo === cleanKey || keysToPurge.has(rMigTo))) ||
                    (!cleanKey && cleanNameLow && rNameLow === cleanNameLow)
                  );
                  if (isMatch) {
                    if (rKey) keysToPurge.add(rKey);
                    if (rMigTo) keysToPurge.add(rMigTo);
                    try { cursor.delete(); } catch (e) {}
                  }
                }
                cursor.continue();
              }
            };
            tx.oncomplete = done;
            tx.onerror = done;
          } catch (e) {
            done();
          }
        };
        req.onerror = done;
        req.onblocked = done;
      });
    }
  } catch (e) {}

  const allPurgeKeys = Array.from(keysToPurge);
  markHubListDeletedTombstone(cleanKey, cleanNameLow, allPurgeKeys);

  let delegatedToIframe = false;
  try {
    document.querySelectorAll('iframe[src*="/nr/"], iframe[src*="/newrecruit/"]').forEach(ifr => {
      if (ifr && ifr.contentWindow) {
        ifr.contentWindow.postMessage({
          type: 'OMNITACTICA_NR_COMMAND',
          command: 'delete_list',
          list_key: cleanKey || '',
          list_name: listName || '',
          keys_to_purge: allPurgeKeys
        }, '*');
        if (ifr.id === 'hub-nr-studio-iframe') {
          delegatedToIframe = true;
        }
      }
    });
  } catch (e) {}

  // Directly delete all matched keys from NewRecruit Cloud if signed in
  try {
    const nrAccess = localStorage.getItem('access');
    if (nrAccess && allPurgeKeys.length > 0) {
      await Promise.all(allPurgeKeys.map(k =>
        fetch('/api/rpc?m=deleteList', {
          method: 'POST',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Authorization': nrAccess
          },
          body: JSON.stringify({ method: 'deleteList', params: [k] })
        }).catch(() => {})
      ));
    }
  } catch (e) {}

  if (delegatedToIframe) {
    await new Promise(r => setTimeout(r, 150));
  }
}

async function deleteHubArmyList(listId, fromModal = false) {
  if (!window.__omniSkipDeleteConfirm && !confirm('Are you sure you want to permanently delete this army list?')) return;
  
  if (fromModal) {
    closeViewArmyListModal();
  }

  const targetItem = (hubSavedLists || []).find(l => l.id === listId || l.list_key === listId);
  const listKey = targetItem ? resolveHubNrListKey(targetItem) : (String(listId || '').startsWith('nr_') ? String(listId).slice(3) : String(listId || ''));
  const listName = targetItem && targetItem.name ? String(targetItem.name) : '';

  // 0. Record synchronous tombstone in localStorage immediately so even an instant F5 refresh never resurrects the list
  markHubListDeletedTombstone(listKey, listName);

  // 1. Instant 0ms Optimistic UI Removal
  const prevLists = [...(hubSavedLists || [])];
  hubSavedLists = (hubSavedLists || []).filter(l =>
    l.id !== listId &&
    l.list_key !== listId &&
    (!listKey || resolveHubNrListKey(l) !== listKey)
  );
  window.hubSavedLists = hubSavedLists;
  renderHubArmyLists(hubSavedLists);

  // 2. Perform async deletion in background + purge from same-origin NewRecruit IndexedDB, Studio & Cloud
  try {
    await Promise.all([
      removeNrListKeyFromSameOriginIdb(listKey, listName),
      window.api.deleteArmyList(listId)
    ]);
  } catch(e) {
    console.error('Delete error:', e);
    hubSavedLists = prevLists;
    window.hubSavedLists = hubSavedLists;
    renderHubArmyLists(hubSavedLists);
    alert('Error deleting list: ' + e.message);
  }
}

function launchTrackerWithList(listId) {
  const list = (hubSavedLists || []).find(l => l.id === listId);
  const listSys = list ? resolveHubListGameSystemAndEdition(list).gameSystem : null;
  const isAos = listSys ? (listSys === 'aos') : (typeof currentGameSystem !== 'undefined' && currentGameSystem === 'aos');
  const trackerUrl = isAos ? '/11th/tracker/aos' : '/11th/tracker';
  if (list) {
    try {
      localStorage.setItem('omni_preloaded_list', JSON.stringify(list));
      sessionStorage.setItem('omni_preloaded_list', JSON.stringify(list));
    } catch (e) {}
  }
  window.location.href = trackerUrl;
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
window.openNewRecruitStudioDrawer = openNewRecruitStudioDrawer;
window.openNewRecruitStudioForList = openNewRecruitStudioForList;
window.navigateNewRecruitStudio = navigateNewRecruitStudio;
window.closeNewRecruitStudioDrawer = closeNewRecruitStudioDrawer;
window.openNewRecruitCloudModal = openNewRecruitCloudModal;
window.closeNewRecruitCloudModal = closeNewRecruitCloudModal;
window.submitNewRecruitCloudConnect = submitNewRecruitCloudConnect;
window.triggerNewRecruitCloudSync = triggerNewRecruitCloudSync;
window.disconnectNewRecruitCloud = disconnectNewRecruitCloud;
window.handleNewRecruitShareUrlSync = handleNewRecruitShareUrlSync;
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

function toggleHubCareerDetails(ev) {
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  const drawer = document.getElementById('hub-career-details-drawer');
  const arrow = document.getElementById('hub-career-toggle-arrow');
  const textSpan = document.getElementById('hub-career-toggle-text');
  const btn = document.getElementById('hub-career-toggle-btn');
  if (!drawer) return;
  const isCollapsed = drawer.classList.contains('hub-career-drawer-collapsed');
  window.isHubCareerDrawerExpanded = isCollapsed;
  try { sessionStorage.setItem('omni_hub_career_expanded', isCollapsed ? '1' : '0'); } catch (e) {}
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

// ============================================================================
// COMPLETED GAME IMPORTER MODAL (Tabletop Battles, BattleBase, NewRecruit, ChampionsHub, Milarki)
// ============================================================================
function openTrackerImportModal(defaultTab = 'ttb-sync') {
  const existing = document.getElementById('tracker-import-modal-overlay');
  if (existing) existing.remove();
  const celeb = document.getElementById('badges-celebration-modal');
  if (celeb) celeb.remove();

  const nrDefaultLogin = (typeof hubNrCloudAccount === 'object' && hubNrCloudAccount && hubNrCloudAccount.login) ? String(hubNrCloudAccount.login) : '';

  const overlay = document.createElement('div');
  overlay.id = 'tracker-import-modal-overlay';
  overlay.style.cssText = 'position:fixed; inset:0; z-index:999999; background:rgba(2,6,23,0.88); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; padding:12px; font-family:var(--font-sans, Inter, sans-serif);';
  overlay.onclick = (e) => { if (e.target === overlay) closeTrackerImportModal(); };

  overlay.innerHTML = `
    <div id="tracker-import-modal-card" style="background:#0b1120; border:1px solid rgba(58,193,139,0.4); border-radius:18px; width:100%; max-width:560px; max-height:92vh; display:flex; flex-direction:column; box-shadow:0 28px 80px rgba(0,0,0,0.9), 0 0 40px rgba(58,193,139,0.1); overflow:hidden; color:#f8fafc;">
      <!-- Header -->
      <div style="padding:16px 20px; background:linear-gradient(135deg, #0d1f1d 0%, #0f172a 100%); border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <img src="/assets/integrations/ttb_icon.png" alt="Import Games" style="width:34px; height:34px; border-radius:9px; box-shadow:0 4px 12px rgba(0,0,0,0.4);" />
          <div>
            <div style="font-size:1.05rem; font-weight:800; color:#fff; line-height:1.2;">Import Completed Games</div>
            <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Sync your 40k &amp; Age of Sigmar scorecards from your favorite tracker app</div>
          </div>
        </div>
        <button type="button" onclick="closeTrackerImportModal()" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; width:30px; height:30px; border-radius:8px; cursor:pointer; font-size:0.9rem; flex-shrink:0;">✕</button>
      </div>

      <!-- Score Tracker App Tabs -->
      <div style="display:flex; flex-wrap:wrap; gap:6px; padding:10px 16px; background:#070b14; border-bottom:1px solid rgba(255,255,255,0.07);">
        <button type="button" id="imp-tab-btn-ttb-sync" onclick="switchTrackerImportTab('ttb-sync')" style="flex:1 1 auto; padding:7px 10px; border-radius:8px; font-size:0.73rem; font-weight:800; cursor:pointer; border:1px solid rgba(58,193,139,0.5); background:rgba(58,193,139,0.16); color:#34d399; display:flex; align-items:center; justify-content:center; gap:5px; white-space:nowrap;">
          <img src="/assets/integrations/ttb_icon.png" alt="" style="width:15px; height:15px; border-radius:4px;" />
          <span>Tabletop Battles</span>
        </button>
        <button type="button" id="imp-tab-btn-battlebase" onclick="switchTrackerImportTab('battlebase')" style="flex:1 1 auto; padding:7px 10px; border-radius:8px; font-size:0.73rem; font-weight:800; cursor:pointer; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#94a3b8; display:flex; align-items:center; justify-content:center; gap:5px; white-space:nowrap;">
          <span>⚔️</span>
          <span>BattleBase</span>
        </button>
        <button type="button" id="imp-tab-btn-newrecruit" onclick="switchTrackerImportTab('newrecruit')" style="flex:1 1 auto; padding:7px 10px; border-radius:8px; font-size:0.73rem; font-weight:800; cursor:pointer; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#94a3b8; display:flex; align-items:center; justify-content:center; gap:5px; white-space:nowrap;">
          <span>📋</span>
          <span>NewRecruit</span>
        </button>
        <button type="button" id="imp-tab-btn-championshub" onclick="switchTrackerImportTab('championshub')" style="flex:1 1 auto; padding:7px 10px; border-radius:8px; font-size:0.73rem; font-weight:800; cursor:pointer; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#94a3b8; display:flex; align-items:center; justify-content:center; gap:5px; white-space:nowrap;">
          <span>🏆</span>
          <span>ChampionsHub</span>
        </button>
        <button type="button" id="imp-tab-btn-milarki" onclick="switchTrackerImportTab('milarki')" style="flex:1 1 auto; padding:7px 10px; border-radius:8px; font-size:0.73rem; font-weight:800; cursor:pointer; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#94a3b8; display:flex; align-items:center; justify-content:center; gap:5px; white-space:nowrap;">
          <span>⚡</span>
          <span>Milarki (AoS)</span>
        </button>
      </div>

      <!-- Body -->
      <div style="padding:18px 20px 20px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:14px;">
        <!-- Panel 1: Tabletop Battles (Username/Email + Password only) -->
        <div id="imp-panel-ttb-sync" style="display:flex; flex-direction:column; gap:14px;">
          <div style="background:linear-gradient(160deg, #132226 0%, #0f172a 60%, #111827 100%); border:1px solid rgba(58,193,139,0.32); border-radius:14px; padding:18px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
            <div style="display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:12px;">
              <div style="position:relative; width:52px; height:52px; border-radius:14px; background:#3ac18b; border:2px solid rgba(255,255,255,0.2); box-shadow:0 8px 20px rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center;">
                <img src="/assets/integrations/ttb_icon.png" alt="Tabletop Battles" style="width:48px; height:48px; border-radius:12px; object-fit:cover;" />
                <img src="/assets/integrations/gh_logo.png" alt="Goonhammer" title="Powered by Goonhammer" style="position:absolute; bottom:-5px; right:-5px; width:22px; height:22px; border-radius:50%; border:2px solid #0f172a; object-fit:cover;" />
              </div>
              <div style="display:flex; flex-direction:column; align-items:center;">
                <span style="color:#34d399; font-size:15px; font-weight:800; line-height:1;">⇄</span>
                <span style="font-size:9px; letter-spacing:0.08em; text-transform:uppercase; color:#64748b; font-weight:800; margin-top:2px;">SYNC</span>
              </div>
              <div style="width:48px; height:48px; border-radius:13px; background:#0f172a; border:1px solid rgba(56,189,248,0.4); box-shadow:0 8px 20px rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; overflow:hidden;">
                <img src="/assets/logo-192.png" alt="OmniTactica" style="width:36px; height:36px; object-fit:contain;" />
              </div>
            </div>

            <div style="text-align:center; margin-bottom:14px;">
              <div style="font-size:1.05rem; font-weight:800; color:#fff; letter-spacing:-0.01em;">Sign in to Tabletop Battles</div>
              <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Use your Goonhammer / Administratum account to import completed 40k &amp; AoS games</div>
              <div style="display:inline-flex; align-items:center; gap:5px; margin-top:8px; padding:3px 10px; border-radius:999px; background:rgba(2,6,23,0.7); border:1px solid rgba(58,193,139,0.35); font-family:monospace; font-size:0.68rem; color:#34d399;">
                <span>🔒</span> <span>https://administratum.tabletopbattles.com</span>
              </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:11px;">
              <div>
                <label for="imp-ttb-email" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Email or Username</label>
                <div style="position:relative; display:flex; align-items:center;">
                  <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">✉️</span>
                  <input id="imp-ttb-email" type="text" placeholder="name@example.com" autocomplete="username" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(58,193,139,0.35); border-radius:9px; padding:10px 12px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" />
                </div>
              </div>
              <div>
                <label for="imp-ttb-password" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Password</label>
                <div style="position:relative; display:flex; align-items:center;">
                  <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🔑</span>
                  <input id="imp-ttb-password" type="password" placeholder="Enter your Tabletop Battles password" autocomplete="current-password" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(58,193,139,0.35); border-radius:9px; padding:10px 38px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" onkeydown="if(event.key==='Enter')submitTrackerImport('ttb-sync')" />
                  <button type="button" onclick="const p=document.getElementById('imp-ttb-password'); if(p){p.type=p.type==='password'?'text':'password'; this.textContent=p.type==='password'?'👁️':'🙈';}" style="position:absolute; right:8px; background:none; border:none; color:#94a3b8; cursor:pointer; font-size:0.85rem; padding:4px;" title="Show/Hide Password">👁️</button>
                </div>
              </div>

              <button type="button" id="btn-imp-submit-sync" onclick="submitTrackerImport('ttb-sync')" style="margin-top:4px; width:100%; background:linear-gradient(135deg, #2eb87e 0%, #1f9d68 100%); border:1px solid rgba(110,231,183,0.4); color:#042f1e; font-size:0.86rem; font-weight:800; padding:11px 18px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 6px 18px rgba(46,184,126,0.28);">
                <img src="/assets/integrations/ttb_icon.png" alt="" style="width:20px; height:20px; border-radius:5px;" />
                <span style="color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.35);">Sign In with Tabletop Battles &amp; Sync</span>
              </button>
            </div>

            <div style="font-size:0.7rem; color:#64748b; text-align:center; margin-top:11px; line-height:1.4;">
              🛡️ Authenticates directly via Goonhammer Administratum SRP. Your credentials are used one-time and never stored.
            </div>
          </div>
        </div>

        <!-- Panel 2: BattleBase (battlebase.app) -->
        <div id="imp-panel-battlebase" style="display:none; flex-direction:column; gap:14px;">
          <div style="background:linear-gradient(160deg, #0d1d2a 0%, #0f172a 60%, #111827 100%); border:1px solid rgba(56,189,248,0.35); border-radius:14px; padding:18px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
            <div style="text-align:center; margin-bottom:14px;">
              <div style="font-size:1.05rem; font-weight:800; color:#fff; letter-spacing:-0.01em;">⚔️ Sign in to BattleBase</div>
              <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Import your Warhammer 40,000 turn-by-turn primary, secondary &amp; CP scorecards</div>
              <div style="display:inline-flex; align-items:center; gap:5px; margin-top:8px; padding:3px 10px; border-radius:999px; background:rgba(2,6,23,0.7); border:1px solid rgba(56,189,248,0.35); font-family:monospace; font-size:0.68rem; color:#38bdf8;">
                <span>🔒</span> <span>https://www.battlebase.app/graphql</span>
              </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:11px;">
              <div>
                <label for="imp-bb-username" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Email or BattleBase Username</label>
                <div style="position:relative; display:flex; align-items:center;">
                  <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">👤</span>
                  <input id="imp-bb-username" type="text" placeholder="Email or BattleBase username" autocomplete="username" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(56,189,248,0.35); border-radius:9px; padding:10px 12px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" />
                </div>
              </div>
              <div>
                <label for="imp-bb-password" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Password <span style="color:#64748b; font-weight:500;">(optional if profile battles are public)</span></label>
                <div style="position:relative; display:flex; align-items:center;">
                  <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🔑</span>
                  <input id="imp-bb-password" type="password" placeholder="Enter your BattleBase password" autocomplete="current-password" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(56,189,248,0.35); border-radius:9px; padding:10px 38px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" onkeydown="if(event.key==='Enter')submitTrackerImport('battlebase')" />
                </div>
              </div>

              <button type="button" id="btn-imp-submit-battlebase" onclick="submitTrackerImport('battlebase')" style="margin-top:4px; width:100%; background:linear-gradient(135deg, #0284c7 0%, #0369a1 100%); border:1px solid rgba(125,211,252,0.4); color:#fff; font-size:0.86rem; font-weight:800; padding:11px 18px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 6px 18px rgba(2,132,199,0.28);">
                <span>⚔️</span>
                <span>Sign In with BattleBase &amp; Sync</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Panel 3: NewRecruit (newrecruit.eu) -->
        <div id="imp-panel-newrecruit" style="display:none; flex-direction:column; gap:14px;">
          <div style="background:linear-gradient(160deg, #241b0c 0%, #0f172a 60%, #111827 100%); border:1px solid rgba(245,158,11,0.35); border-radius:14px; padding:18px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
            <div style="text-align:center; margin-bottom:14px;">
              <div style="font-size:1.05rem; font-weight:800; color:#fff; letter-spacing:-0.01em;">📋 Sign in to NewRecruit</div>
              <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Import your 40k &amp; Age of Sigmar Game Assistant match reports and tournament history</div>
              <div style="display:inline-flex; align-items:center; gap:5px; margin-top:8px; padding:3px 10px; border-radius:999px; background:rgba(2,6,23,0.7); border:1px solid rgba(245,158,11,0.35); font-family:monospace; font-size:0.68rem; color:#fbbf24;">
                <span>🔒</span> <span>https://www.newrecruit.eu/api/rpc</span>
              </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:11px;">
              <div>
                <label for="imp-nr-username" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">NewRecruit Username or Email</label>
                <div style="position:relative; display:flex; align-items:center;">
                  <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">👤</span>
                  <input id="imp-nr-username" type="text" value="${escapeHtml(nrDefaultLogin)}" placeholder="NewRecruit username or email" autocomplete="username" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(245,158,11,0.35); border-radius:9px; padding:10px 12px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" />
                </div>
              </div>
              <div>
                <label for="imp-nr-password" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Password</label>
                <div style="position:relative; display:flex; align-items:center;">
                  <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🔑</span>
                  <input id="imp-nr-password" type="password" placeholder="Enter your NewRecruit password" autocomplete="current-password" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(245,158,11,0.35); border-radius:9px; padding:10px 38px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" onkeydown="if(event.key==='Enter')submitTrackerImport('newrecruit')" />
                </div>
              </div>

              <button type="button" id="btn-imp-submit-newrecruit" onclick="submitTrackerImport('newrecruit')" style="margin-top:4px; width:100%; background:linear-gradient(135deg, #d97706 0%, #b45309 100%); border:1px solid rgba(251,191,36,0.4); color:#fff; font-size:0.86rem; font-weight:800; padding:11px 18px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 6px 18px rgba(217,119,6,0.28);">
                <span>📋</span>
                <span>Sign In with NewRecruit &amp; Sync</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Panel 4: ChampionsHub (championshub.app) -->
        <div id="imp-panel-championshub" style="display:none; flex-direction:column; gap:14px;">
          <div style="background:linear-gradient(160deg, #1f122b 0%, #0f172a 60%, #111827 100%); border:1px solid rgba(168,85,247,0.35); border-radius:14px; padding:18px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
            <div style="text-align:center; margin-bottom:14px;">
              <div style="font-size:1.05rem; font-weight:800; color:#fff; letter-spacing:-0.01em;">🏆 Sign in to ChampionsHub</div>
              <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Import your 40k &amp; AoS tournament pairings, Battle VP, WTC points, and army lists</div>
              <div style="display:inline-flex; align-items:center; gap:5px; margin-top:8px; padding:3px 10px; border-radius:999px; background:rgba(2,6,23,0.7); border:1px solid rgba(168,85,247,0.35); font-family:monospace; font-size:0.68rem; color:#c084fc;">
                <span>🔒</span> <span>https://api.championshub.app</span>
              </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:11px;">
              <div>
                <label for="imp-ch-username" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Email or ChampionsHub Player Name</label>
                <div style="position:relative; display:flex; align-items:center;">
                  <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">👤</span>
                  <input id="imp-ch-username" type="text" placeholder="Email or player display name" autocomplete="username" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(168,85,247,0.35); border-radius:9px; padding:10px 12px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" />
                </div>
              </div>
              <div>
                <label for="imp-ch-password" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Password <span style="color:#64748b; font-weight:500;">(optional for public tournament history)</span></label>
                <div style="position:relative; display:flex; align-items:center;">
                  <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🔑</span>
                  <input id="imp-ch-password" type="password" placeholder="Enter your ChampionsHub password" autocomplete="current-password" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(168,85,247,0.35); border-radius:9px; padding:10px 38px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" onkeydown="if(event.key==='Enter')submitTrackerImport('championshub')" />
                </div>
              </div>

              <button type="button" id="btn-imp-submit-championshub" onclick="submitTrackerImport('championshub')" style="margin-top:4px; width:100%; background:linear-gradient(135deg, #9333ea 0%, #7e22ce 100%); border:1px solid rgba(216,180,254,0.4); color:#fff; font-size:0.86rem; font-weight:800; padding:11px 18px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 6px 18px rgba(147,51,234,0.28);">
                <span>🏆</span>
                <span>Sign In with ChampionsHub &amp; Sync</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Panel 5: Milarki (milarki.com — Age of Sigmar) -->
        <div id="imp-panel-milarki" style="display:none; flex-direction:column; gap:14px;">
          <div style="background:linear-gradient(160deg, #28111b 0%, #0f172a 60%, #111827 100%); border:1px solid rgba(244,63,94,0.35); border-radius:14px; padding:18px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
            <div style="text-align:center; margin-bottom:14px;">
              <div style="font-size:1.05rem; font-weight:800; color:#fff; letter-spacing:-0.01em;">⚡ Sync Milarki (Age of Sigmar)</div>
              <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Import round-by-round AoS 4.0 battle tactics, objective points &amp; tournament matches</div>
              <div style="display:inline-flex; align-items:center; gap:5px; margin-top:8px; padding:3px 10px; border-radius:999px; background:rgba(2,6,23,0.7); border:1px solid rgba(244,63,94,0.35); font-family:monospace; font-size:0.68rem; color:#fb7185;">
                <span>🔒</span> <span>https://www.milarki.com/api/v1</span>
              </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:11px;">
              <div>
                <label for="imp-mlk-player-id" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Milarki Player ID (6-character Public ID)</label>
                <div style="position:relative; display:flex; align-items:center;">
                  <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🆔</span>
                  <input id="imp-mlk-player-id" type="text" placeholder="e.g. a1B2c3 (from milarki.com/profile)" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(244,63,94,0.35); border-radius:9px; padding:10px 12px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" />
                </div>
              </div>
              <div>
                <label for="imp-mlk-api-key" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Milarki API Key (<code style="color:#fb7185;">mlk_v1_...</code>)</label>
                <div style="position:relative; display:flex; align-items:center;">
                  <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🔑</span>
                  <input id="imp-mlk-api-key" type="password" placeholder="mlk_v1_... (from milarki.com/developer)" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(244,63,94,0.35); border-radius:9px; padding:10px 38px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" onkeydown="if(event.key==='Enter')submitTrackerImport('milarki')" />
                </div>
              </div>

              <button type="button" id="btn-imp-submit-milarki" onclick="submitTrackerImport('milarki')" style="margin-top:4px; width:100%; background:linear-gradient(135deg, #e11d48 0%, #be123c 100%); border:1px solid rgba(251,113,133,0.4); color:#fff; font-size:0.86rem; font-weight:800; padding:11px 18px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 6px 18px rgba(225,29,72,0.28);">
                <span>⚡</span>
                <span>Sync Milarki Battles</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Status & Imported Games Result Box -->
        <div id="imp-result-box" style="display:none; border-radius:12px; padding:12px 14px; font-size:0.8rem;"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  switchTrackerImportTab(defaultTab);
}

function closeTrackerImportModal() {
  const existing = document.getElementById('tracker-import-modal-overlay');
  if (existing) existing.remove();
}

function switchTrackerImportTab(tabId) {
  const validTabs = ['ttb-sync', 'battlebase', 'newrecruit', 'championshub', 'milarki'];
  const targetTab = validTabs.includes(tabId) ? tabId : 'ttb-sync';
  const activeColors = {
    'ttb-sync': { bg: 'rgba(58,193,139,0.16)', border: 'rgba(58,193,139,0.5)', color: '#34d399' },
    'battlebase': { bg: 'rgba(56,189,248,0.16)', border: 'rgba(56,189,248,0.5)', color: '#38bdf8' },
    'newrecruit': { bg: 'rgba(245,158,11,0.16)', border: 'rgba(245,158,11,0.5)', color: '#fbbf24' },
    'championshub': { bg: 'rgba(168,85,247,0.16)', border: 'rgba(168,85,247,0.5)', color: '#c084fc' },
    'milarki': { bg: 'rgba(244,63,94,0.16)', border: 'rgba(244,63,94,0.5)', color: '#fb7185' }
  };
  validTabs.forEach(t => {
    const panel = document.getElementById(`imp-panel-${t}`);
    const btn = document.getElementById(`imp-tab-btn-${t}`);
    if (panel) panel.style.display = (t === targetTab) ? 'flex' : 'none';
    if (btn) {
      if (t === targetTab) {
        const theme = activeColors[t] || activeColors['ttb-sync'];
        btn.style.background = theme.bg;
        btn.style.borderColor = theme.border;
        btn.style.color = theme.color;
      } else {
        btn.style.background = 'rgba(255,255,255,0.03)';
        btn.style.borderColor = 'rgba(255,255,255,0.1)';
        btn.style.color = '#94a3b8';
      }
    }
  });
}

function fillTrackerImportDemo(kind) {
  if (kind === 'ttb-sync') {
    const em = document.getElementById('imp-ttb-email');
    const pw = document.getElementById('imp-ttb-password');
    if (em) em.value = 'demo@tabletopbattles.com';
    if (pw) pw.value = 'demo1234';
  }
}

async function submitTrackerImport(mode) {
  const resBox = document.getElementById('imp-result-box');
  if (resBox) {
    resBox.style.display = 'block';
    resBox.style.background = 'rgba(56,189,248,0.1)';
    resBox.style.border = '1px solid rgba(56,189,248,0.3)';
    resBox.style.color = '#38bdf8';
    resBox.innerHTML = '⏳ Importing completed games...';
  }

  const token = (window.api && typeof window.api.getAuthToken === 'function' ? window.api.getAuthToken() : '') || localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || '';
  let endpoint = '/api/tracker/import/ttb-sync';
  let bodyObj = {};

  if (mode === 'battlebase') {
    endpoint = '/api/tracker/import/battlebase-sync';
    bodyObj = {
      username: (document.getElementById('imp-bb-username')?.value || '').trim(),
      password: (document.getElementById('imp-bb-password')?.value || '').trim()
    };
  } else if (mode === 'newrecruit') {
    endpoint = '/api/tracker/import/newrecruit-sync';
    bodyObj = {
      username: (document.getElementById('imp-nr-username')?.value || '').trim(),
      password: (document.getElementById('imp-nr-password')?.value || '').trim()
    };
  } else if (mode === 'championshub') {
    endpoint = '/api/tracker/import/championshub-sync';
    bodyObj = {
      username: (document.getElementById('imp-ch-username')?.value || '').trim(),
      password: (document.getElementById('imp-ch-password')?.value || '').trim()
    };
  } else if (mode === 'milarki') {
    endpoint = '/api/tracker/import/milarki-sync';
    bodyObj = {
      player_id: (document.getElementById('imp-mlk-player-id')?.value || '').trim(),
      api_key: (document.getElementById('imp-mlk-api-key')?.value || '').trim()
    };
  } else {
    endpoint = '/api/tracker/import/ttb-sync';
    bodyObj = {
      username: (document.getElementById('imp-ttb-email')?.value || '').trim(),
      password: (document.getElementById('imp-ttb-password')?.value || '').trim()
    };
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(bodyObj)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.success) {
      throw new Error(data.detail || data.error || 'Import failed');
    }

    const games = data.games || [];
    if (resBox) {
      resBox.style.background = 'rgba(16,185,129,0.12)';
      resBox.style.border = '1px solid rgba(16,185,129,0.4)';
      resBox.style.color = '#f8fafc';
      resBox.innerHTML = `
        <div style="font-weight:800; color:#34d399; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between;">
          <span>✅ Imported ${games.length} Completed Game${games.length === 1 ? '' : 's'}!</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          ${games.map(g => {
            const mid = g.match_id || g.id || '';
            const isAosG = (g.game_system === 'aos' || String(mid).startsWith('AOS-'));
            const edBadgeTxt = g.edition_label || (isAosG ? 'AoS 4.0' : '40k 10th Ed');
            const sysBadge = `<span style="background:rgba(245,158,11,0.2); color:#fbbf24; font-size:0.65rem; font-weight:800; padding:1px 6px; border-radius:4px;">${escapeHtml(edBadgeTxt)}</span>`;
            return `
              <div style="background:#070b14; border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:8px 12px; display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                <div>
                  <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    ${sysBadge}
                    <b style="font-size:0.82rem; color:#fff;">${escapeHtml(g.p1_name)} (${g.p1_score}) vs ${escapeHtml(g.p2_name)} (${g.p2_score})</b>
                  </div>
                  <div style="font-size:0.7rem; color:#94a3b8; margin-top:2px;">
                    ${escapeHtml(g.p1_faction || 'Army 1')} vs ${escapeHtml(g.p2_faction || 'Army 2')} • 🎯 ${escapeHtml(g.primary_mission || 'Matched Play')}
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                  <button type="button" onclick="openMapGameToEventModal('${escapeHtml(mid)}', '${isAosG ? 'aos' : '40k'}')" style="background:rgba(245,158,11,0.18); border:1px solid rgba(245,158,11,0.45); color:#fbbf24; font-size:0.73rem; font-weight:800; padding:5px 9px; border-radius:6px; cursor:pointer; white-space:nowrap;">
                    🏆 Map to Event
                  </button>
                  <a href="/scorecard/${encodeURIComponent(mid)}" target="_blank" style="background:rgba(16,185,129,0.2); border:1px solid rgba(16,185,129,0.45); color:#34d399; font-size:0.74rem; font-weight:800; padding:5px 10px; border-radius:6px; text-decoration:none; white-space:nowrap;">
                    📄 Open Scorecard ↗
                  </a>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    try {
      localStorage.removeItem('my_hub_cache_40k');
      localStorage.removeItem('my_hub_cache_aos');
      localStorage.removeItem('my_hub_cache');
    } catch (e) {}

    // Refresh My Hub and/or Tracker Lobby history immediately
    if (typeof loadMyHubDashboard === 'function' && document.getElementById('my-hub-content')) {
      myHubData = null;
      loadMyHubDashboard();
    }
    if (typeof window.__refreshTrackerHistoryAfterImport === 'function') {
      window.__refreshTrackerHistoryAfterImport();
    }
  } catch (err) {
    if (resBox) {
      resBox.style.background = 'rgba(239,68,68,0.14)';
      resBox.style.border = '1px solid rgba(239,68,68,0.4)';
      resBox.style.color = '#f87171';
      resBox.innerHTML = `❌ <b>Import Error:</b> ${escapeHtml(err.message || String(err))}`;
    }
  }
}

let _hubMappableMatchesCache = [];
let _hubActiveMapMatchId = '';
let _hubActiveMapGameSystem = '40k';
let _hubMappableStatusFilter = 'all';
let _hubMappablePrefetchInFlight = {};
if (typeof window !== 'undefined') {
  window.__omniMappableMatchesCacheBySys = window.__omniMappableMatchesCacheBySys || {};
}

const _HUB_FIRST_NAME_EQUIV = {
  joe: 'joseph', joseph: 'joe',
  brad: 'bradford', bradford: 'brad',
  jon: 'jonathan', jonathan: 'jon',
  dan: 'daniel', daniel: 'dan', danny: 'daniel',
  matt: 'matthew', matthew: 'matt',
  mike: 'michael', michael: 'mike',
  alex: 'alexander', alexander: 'alex',
  ben: 'benjamin', benjamin: 'ben',
  tim: 'timothy', timothy: 'tim',
  chris: 'christopher', christopher: 'chris',
  nick: 'nicholas', nicholas: 'nick',
  dave: 'david', david: 'dave',
  rob: 'robert', robert: 'rob', bobby: 'robert', bob: 'robert',
  will: 'william', william: 'will', bill: 'william',
  josh: 'joshua', joshua: 'josh',
  jake: 'jacob', jacob: 'jake',
  drew: 'andrew', andy: 'andrew', andrew: 'andy',
  nate: 'nathan', nathan: 'nate', nathaniel: 'nate',
  zach: 'zachary', zack: 'zachary', zachary: 'zach',
  steve: 'stephen', stephen: 'steve', steven: 'steve',
  greg: 'gregory', gregory: 'greg',
  max: 'maximosugus', maximosugus: 'max'
};

function _hubFirstNamesMatch(fa, fb) {
  if (!fa || !fb) return false;
  if (fa === fb && fa.length >= 2) return true;
  if (_HUB_FIRST_NAME_EQUIV[fa] === fb || _HUB_FIRST_NAME_EQUIV[fb] === fa) return true;
  if (fa.length >= 3 && fb.length >= 3 && (fa.startsWith(fb) || fb.startsWith(fa))) return true;
  return false;
}

function _hubNamesRoughlyMatch(a, b) {
  const ca = String(a || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase();
  const cb = String(b || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase();
  if (!ca || !cb) return false;
  if (['player 1', 'player 2', 'player1', 'player2', 'you', 'opponent', 'unknown', 'bye'].includes(ca)) return false;
  if (['player 1', 'player 2', 'player1', 'player2', 'you', 'opponent', 'unknown', 'bye'].includes(cb)) return false;
  if (ca === cb) return true;
  const pa = ca.split(/\s+/);
  const pb = cb.split(/\s+/);
  if (pa.length >= 2 && pb.length >= 2) {
    return _hubFirstNamesMatch(pa[0], pb[0]) && pa[pa.length - 1] === pb[pb.length - 1];
  }
  if (pa.length === 1 && pb.length >= 1) return _hubFirstNamesMatch(pa[0], pb[0]);
  if (pb.length === 1 && pa.length >= 1) return _hubFirstNamesMatch(pb[0], pa[0]);
  return false;
}

function _getHubCachedMappableMatchesBySys(sys) {
  const s = (sys && String(sys).toLowerCase().includes('aos')) ? 'aos' : '40k';
  if (typeof window !== 'undefined' && window.__omniMappableMatchesCacheBySys && Array.isArray(window.__omniMappableMatchesCacheBySys[s]) && window.__omniMappableMatchesCacheBySys[s].length > 0) {
    return window.__omniMappableMatchesCacheBySys[s];
  }
  try {
    localStorage.removeItem('omni_mappable_matches_v1_' + s);
    const raw = localStorage.getItem('omni_mappable_matches_v2_' + s);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.matches) && (Date.now() - (parsed.ts || 0)) < 600000) {
        if (typeof window !== 'undefined' && window.__omniMappableMatchesCacheBySys) {
          window.__omniMappableMatchesCacheBySys[s] = parsed.matches;
        }
        return parsed.matches;
      }
    }
  } catch (e) {}
  return null;
}

function _setHubCachedMappableMatchesBySys(sys, matches) {
  const s = (sys && String(sys).toLowerCase().includes('aos')) ? 'aos' : '40k';
  if (!Array.isArray(matches)) return;
  if (typeof window !== 'undefined') {
    window.__omniMappableMatchesCacheBySys = window.__omniMappableMatchesCacheBySys || {};
    window.__omniMappableMatchesCacheBySys[s] = matches;
  }
  try {
    localStorage.removeItem('omni_mappable_matches_v1_' + s);
    localStorage.setItem('omni_mappable_matches_v2_' + s, JSON.stringify({ ts: Date.now(), matches }));
  } catch (e) {}
}

function _scoreHubMappableMatches(rawMatches, sourceGame, activeMatchId) {
  if (!Array.isArray(rawMatches)) return [];
  const normMid = String(activeMatchId || '').trim().toUpperCase();
  const sgP1 = sourceGame ? String(sourceGame.p1_name || '') : '';
  const sgP2 = sourceGame ? String(sourceGame.p2_name || '') : '';
  const sgS1 = sourceGame && sourceGame.p1_score != null ? Number(sourceGame.p1_score) : null;
  const sgS2 = sourceGame && sourceGame.p2_score != null ? Number(sourceGame.p2_score) : null;
  const sgDateMs = sourceGame && sourceGame.game_date && sourceGame.game_date !== '-' ? Date.parse(sourceGame.game_date) : NaN;

  const scored = rawMatches.map(m => {
    const copy = Object.assign({}, m);
    const lockedBy = String(copy.locked_by_match_id || '').trim().toUpperCase();
    const isCurr = Boolean(normMid && lockedBy && lockedBy === normMid) || Boolean(copy.is_currently_mapped && (!normMid || lockedBy === normMid));
    copy.is_currently_mapped = isCurr;
    if (isCurr) {
      copy.is_locked = false;
    }
    if (sourceGame) {
      let rel = 0;
      const userNameInEvent = (copy.user_slot === 'player1' ? copy.player1_name : copy.player2_name) || '';
      const oppName = copy.opponent_name || (copy.user_slot === 'player1' ? copy.player2_name : copy.player1_name) || '';

      const p1IsUser = _hubNamesRoughlyMatch(sgP1, userNameInEvent);
      const p2IsUser = _hubNamesRoughlyMatch(sgP2, userNameInEvent);
      let oppMatched = false;
      if (p1IsUser && !p2IsUser) {
        oppMatched = _hubNamesRoughlyMatch(sgP2, oppName);
      } else if (p2IsUser && !p1IsUser) {
        oppMatched = _hubNamesRoughlyMatch(sgP1, oppName);
      } else {
        oppMatched = _hubNamesRoughlyMatch(sgP1, oppName) || _hubNamesRoughlyMatch(sgP2, oppName);
      }
      if (oppMatched) {
        rel += 50;
      }
      if (copy.player1_score != null && copy.player2_score != null && sgS1 != null && sgS2 != null) {
        const ev1 = Number(copy.player1_score);
        const ev2 = Number(copy.player2_score);
        if ((ev1 === sgS1 && ev2 === sgS2) || (ev1 === sgS2 && ev2 === sgS1)) {
          rel += 40;
        }
      }
      const evDateRaw = copy.sort_date || copy.event_date || copy.match_date;
      const evDateMs = evDateRaw ? Date.parse(evDateRaw) : NaN;
      if (!isNaN(sgDateMs) && !isNaN(evDateMs)) {
        const diffDays = Math.abs(sgDateMs - evDateMs) / 86400000;
        if (diffDays <= 4.5) {
          rel += 35;
        }
      }
      copy.relevance = rel;
      copy.recommended = Boolean(rel >= 50 && !copy.is_locked);
    } else {
      copy.recommended = Boolean(copy.recommended && !copy.is_locked);
    }
    return copy;
  });

  scored.sort((a, b) => {
    if (Boolean(a.is_currently_mapped) !== Boolean(b.is_currently_mapped)) {
      return a.is_currently_mapped ? -1 : 1;
    }
    if (Boolean(!a.is_locked) !== Boolean(!b.is_locked)) {
      return !a.is_locked ? -1 : 1;
    }
    if ((b.relevance || 0) !== (a.relevance || 0)) {
      return (b.relevance || 0) - (a.relevance || 0);
    }
    const da = String(a.sort_date || a.match_date || '');
    const db = String(b.sort_date || b.match_date || '');
    if (da !== db) return db.localeCompare(da);
    return (Number(b.round) || 0) - (Number(a.round) || 0);
  });
  return scored;
}

async function prefetchHubMappableEventMatches(gameSystem) {
  const s = (gameSystem && String(gameSystem).toLowerCase().includes('aos')) ? 'aos' : '40k';
  if (_hubMappablePrefetchInFlight[s]) return _hubMappablePrefetchInFlight[s];
  const tok = (window.api && typeof window.api.getAuthToken === 'function' ? window.api.getAuthToken() : '') || localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || localStorage.getItem('omnitactica_id_token') || localStorage.getItem('firebase_id_token') || '';
  if (!tok && !window.location.search.includes('mock_persona')) return null;
  _hubMappablePrefetchInFlight[s] = (async () => {
    try {
      const headers = tok ? { 'Authorization': 'Bearer ' + tok } : {};
      const resp = await fetch(`/api/tracker/mappable_event_matches?game_system=${encodeURIComponent(s)}&limit=500`, { headers });
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        if (data && Array.isArray(data.matches)) {
          _setHubCachedMappableMatchesBySys(s, data.matches);
        }
      }
    } catch (e) {
    } finally {
      _hubMappablePrefetchInFlight[s] = null;
    }
  })();
  return _hubMappablePrefetchInFlight[s];
}

function _findLocalSourceGameForMapModal(matchId) {
  const target = String(matchId || '').trim().toUpperCase();
  if (!target) return null;
  const pools = [];
  if (myHubData && Array.isArray(myHubData.completed_history)) pools.push(...myHubData.completed_history);
  if (typeof window !== 'undefined' && Array.isArray(window.gtCompletedHistory)) pools.push(...window.gtCompletedHistory);
  try {
    ['gdm-11e-tracker-history', 'omni-aos-tracker-history'].forEach(k => {
      const raw = localStorage.getItem(k);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) pools.push(...arr);
      }
    });
  } catch (e) {}
  for (const item of pools) {
    if (!item) continue;
    const mid = String(item.match_id || item.id || '').trim().toUpperCase();
    if (mid === target) {
      return {
        match_id: item.match_id || item.id || matchId,
        p1_name: item.p1_name || item.game?.p1Name || 'Player 1',
        p2_name: item.p2_name || item.game?.p2Name || 'Player 2',
        p1_faction: item.p1_faction || item.game?.p1Faction || 'Army 1',
        p2_faction: item.p2_faction || item.game?.p2Faction || 'Army 2',
        p1_score: item.p1_score ?? item.p1Score ?? 0,
        p2_score: item.p2_score ?? item.p2Score ?? 0,
        primary_mission: item.primary_mission || item.game?.primary || '',
        game_date: formatHubMatchDate(item.game_date || item.date || item.updated_at, item)
      };
    }
  }
  return null;
}

function _renderHubMapSourceGameBanner(sg) {
  const bannerEl = document.getElementById('omni-map-source-banner');
  if (!bannerEl) return;
  if (!sg) {
    bannerEl.innerHTML = '';
    return;
  }
  const p1Name = sg.p1_name || 'Player 1';
  const p2Name = sg.p2_name || 'Player 2';
  const p1Fac = sg.p1_faction || 'Army 1';
  const p2Fac = sg.p2_faction || 'Army 2';
  const p1Score = sg.p1_score ?? 0;
  const p2Score = sg.p2_score ?? 0;
  const mission = sg.primary_mission || '';
  const dateStr = sg.game_date && sg.game_date !== '-' ? sg.game_date : '';

  bannerEl.innerHTML = `
    <div style="background:linear-gradient(135deg, rgba(15,23,42,0.96) 0%, rgba(30,41,59,0.92) 100%); border:1px solid rgba(245,158,11,0.45); border-radius:12px; padding:0.75rem 1rem; margin-bottom:0.85rem; box-shadow:0 8px 20px rgba(0,0,0,0.35);">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.45rem; flex-wrap:wrap;">
        <span style="font-size:0.68rem; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#fbbf24;">📋 Scorecard Being Mapped</span>
        <span style="font-size:0.7rem; color:#94a3b8; font-family:monospace;">${mission ? escapeHtml(mission) + (dateStr ? ' • ' : '') : ''}${escapeHtml(dateStr)}</span>
      </div>
      <div style="display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:0.75rem;">
        <div style="min-width:0;">
          <div style="font-size:0.9rem; font-weight:800; color:#38bdf8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">🟦 ${escapeHtml(p1Name)}</div>
          <div style="font-size:0.72rem; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(p1Fac)}</div>
        </div>
        <div style="background:#020617; border:1px solid #334155; border-radius:10px; padding:0.28rem 0.75rem; font-family:var(--font-mono, monospace); font-size:1.05rem; font-weight:900; color:#fff; white-space:nowrap; box-shadow:inset 0 2px 6px rgba(0,0,0,0.5);">
          <span style="color:#38bdf8;">${p1Score}</span> <span style="color:#64748b; font-weight:600;">-</span> <span style="color:#f43f5e;">${p2Score}</span>
        </div>
        <div style="min-width:0; text-align:right;">
          <div style="font-size:0.9rem; font-weight:800; color:#f43f5e; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">🟥 ${escapeHtml(p2Name)}</div>
          <div style="font-size:0.72rem; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(p2Fac)}</div>
        </div>
      </div>
    </div>
  `;
}

function setHubMappableStatusFilter(mode) {
  _hubMappableStatusFilter = mode || 'all';
  filterHubMappableEventMatches();
}

async function openMapGameToEventModal(matchId, gameSystem) {
  _hubActiveMapMatchId = matchId || '';
  _hubActiveMapGameSystem = gameSystem || (String(matchId || '').startsWith('AOS-') ? 'aos' : '40k');
  _hubMappableStatusFilter = 'all';

  let modal = document.getElementById('omni-map-game-event-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'omni-map-game-event-modal';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(2,6,23,0.85); backdrop-filter:blur(8px); z-index:100005; display:none; align-items:center; justify-content:center; padding:1rem; box-sizing:border-box;';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div style="background:#0f172a; border:1px solid #334155; border-radius:16px; max-width:580px; width:100%; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 25px 65px rgba(0,0,0,0.8); overflow:hidden; font-family:inherit; color:#f8fafc;">
      <div style="padding:0.85rem 1.15rem; background:#1e293b; border-bottom:1px solid #334155; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:800; font-size:1rem; color:#fff;">🏆 Map Scorecard to Tournament Match</div>
        </div>
        <button type="button" onclick="closeMapGameToEventModal()" style="background:transparent; border:none; color:#94a3b8; font-size:1.25rem; cursor:pointer;">✕</button>
      </div>
      <div style="padding:1rem 1.15rem; overflow-y:auto; flex:1;">
        <div id="omni-map-source-banner"></div>
        <div style="font-size:0.78rem; color:#cbd5e1; line-height:1.45; margin-bottom:0.85rem; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.25); padding:0.65rem 0.85rem; border-radius:10px;">
          🔒 <b>Participant-Only &amp; Auto-Aligned:</b> You can only map a scorecard to a tournament or league pairing you participated in. Player 1 and Player 2 columns are automatically aligned to the official pairing and locked once mapped.
        </div>
        <div style="display:flex; gap:0.5rem; margin-bottom:0.55rem;">
          <input id="omni-map-event-search" type="text" placeholder="Search event, league, opponent, faction, or year..." style="flex:1; background:#020617; border:1px solid #334155; color:#fff; padding:0.55rem 0.75rem; border-radius:8px; font-size:0.84rem;" oninput="filterHubMappableEventMatches()">
        </div>
        <div id="omni-map-event-filter-bar" style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.75rem; flex-wrap:wrap;"></div>
        <div id="omni-map-event-status" style="display:none; margin-bottom:0.75rem; padding:0.6rem 0.85rem; border-radius:8px; font-size:0.8rem;"></div>
        <div id="omni-map-event-list" style="display:flex; flex-direction:column; gap:0.55rem;">
          <div style="padding:1.5rem; text-align:center; color:#94a3b8; font-size:0.84rem;">Loading your verified tournament matches...</div>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  const localSg = _findLocalSourceGameForMapModal(_hubActiveMapMatchId);
  _renderHubMapSourceGameBanner(localSg);

  // Instant (0ms) render from prefetched/cached tournament matches if available
  const cachedList = _getHubCachedMappableMatchesBySys(_hubActiveMapGameSystem);
  const hadInstantRender = Boolean(cachedList && cachedList.length > 0);
  if (hadInstantRender) {
    _hubMappableMatchesCache = _scoreHubMappableMatches(cachedList, localSg, _hubActiveMapMatchId);
    filterHubMappableEventMatches();
  }

  try {
    const headers = {};
    const tok = (window.api && typeof window.api.getAuthToken === 'function' ? window.api.getAuthToken() : '') || localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || localStorage.getItem('omnitactica_id_token') || localStorage.getItem('firebase_id_token') || '';
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    const resp = await fetch(`/api/tracker/mappable_event_matches?game_system=${encodeURIComponent(_hubActiveMapGameSystem)}&match_id=${encodeURIComponent(_hubActiveMapMatchId)}&limit=500`, { headers });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (!hadInstantRender) {
        throw new Error(data.detail || 'Please sign in to map scorecards to your tournament matches.');
      }
      return;
    }
    if (data.source_game) _renderHubMapSourceGameBanner(data.source_game);
    const freshMatches = data.matches || [];
    _setHubCachedMappableMatchesBySys(_hubActiveMapGameSystem, freshMatches);
    _hubMappableMatchesCache = _scoreHubMappableMatches(freshMatches, data.source_game || localSg, _hubActiveMapMatchId);
    filterHubMappableEventMatches();
  } catch (err) {
    if (!hadInstantRender) {
      const listEl = document.getElementById('omni-map-event-list');
      if (listEl) {
        listEl.innerHTML = `<div style="padding:1.25rem; text-align:center; color:#fca5a5; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:10px; font-size:0.82rem;">⚠️ ${escapeHtml(err.message)}</div>`;
      }
    }
  }
}

function closeMapGameToEventModal() {
  const modal = document.getElementById('omni-map-game-event-modal');
  if (modal) modal.style.display = 'none';
}

function filterHubMappableEventMatches() {
  const q = (document.getElementById('omni-map-event-search')?.value || '').toLowerCase().trim();
  const allList = Array.isArray(_hubMappableMatchesCache) ? _hubMappableMatchesCache : [];
  const availCount = allList.filter(m => !m.is_locked).length;
  const lockedCount = allList.filter(m => m.is_locked).length;

  let filtered = allList;
  if (_hubMappableStatusFilter === 'available') {
    filtered = filtered.filter(m => !m.is_locked);
  } else if (_hubMappableStatusFilter === 'locked') {
    filtered = filtered.filter(m => m.is_locked);
  }
  if (q) {
    filtered = filtered.filter(m =>
      String(m.event_name || '').toLowerCase().includes(q) ||
      String(m.event_id || '').toLowerCase().includes(q) ||
      String(m.player1_name || '').toLowerCase().includes(q) ||
      String(m.player2_name || '').toLowerCase().includes(q) ||
      String(m.opponent_name || '').toLowerCase().includes(q) ||
      String(m.player1_faction || '').toLowerCase().includes(q) ||
      String(m.player2_faction || '').toLowerCase().includes(q) ||
      String(m.match_date || '').toLowerCase().includes(q) ||
      String(m.sort_date || '').toLowerCase().includes(q)
    );
  }

  const barEl = document.getElementById('omni-map-event-filter-bar');
  if (barEl && allList.length > 0) {
    const btnStyle = (mode) => {
      const active = _hubMappableStatusFilter === mode;
      return `background:${active ? 'rgba(56,189,248,0.2)' : '#090f1e'}; border:1px solid ${active ? '#38bdf8' : '#1e293b'}; color:${active ? '#38bdf8' : '#94a3b8'}; font-size:0.72rem; font-weight:800; padding:3px 9px; border-radius:6px; cursor:pointer;`;
    };
    barEl.innerHTML = `
      <div style="display:flex; gap:0.35rem; align-items:center;">
        <button type="button" onclick="setHubMappableStatusFilter('all')" style="${btnStyle('all')}">All (${allList.length})</button>
        <button type="button" onclick="setHubMappableStatusFilter('available')" style="${btnStyle('available')}">🔓 Available (${availCount})</button>
        <button type="button" onclick="setHubMappableStatusFilter('locked')" style="${btnStyle('locked')}">🔒 Locked (${lockedCount})</button>
      </div>
      <div style="font-size:0.72rem; color:#64748b;">Showing ${filtered.length} of ${allList.length} matches</div>
    `;
  }

  renderHubMappableEventMatches(filtered);
}

function renderHubMappableEventMatches(matches) {
  const listEl = document.getElementById('omni-map-event-list');
  if (!listEl) return;
  if (!matches || matches.length === 0) {
    listEl.innerHTML = '<div style="padding:1.5rem; text-align:center; color:#94a3b8; font-size:0.84rem;">No eligible tournament matches found for your current filter.</div>';
    return;
  }
  listEl.innerHTML = matches.map(m => {
    const isLocked = Boolean(m.is_locked);
    const isCurr = Boolean(m.is_currently_mapped);
    const isLeague = String(m.event_id || '').toUpperCase().startsWith('LEAGUE:');
    const recBadge = (m.recommended && !isLocked) ? '<span style="background:rgba(16,185,129,0.18); color:#34d399; border:1px solid rgba(16,185,129,0.4); font-size:0.68rem; font-weight:800; padding:1px 6px; border-radius:4px;">★ Recommended Pairing</span>' : '';
    const currBadge = isCurr ? '<span style="background:rgba(56,189,248,0.18); color:#38bdf8; border:1px solid rgba(56,189,248,0.4); font-size:0.68rem; font-weight:800; padding:1px 6px; border-radius:4px;">✓ Currently Mapped</span>' : '';
    const actionHtml = isLocked
      ? '<span style="background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.35); font-size:0.7rem; font-weight:800; padding:4px 8px; border-radius:6px;">🔒 Locked</span>'
      : `<button type="button" onclick="confirmMapGameToEventFromHub('${escapeHtml(m.event_id)}', ${Number(m.round || 1)}, ${m.table_number ? Number(m.table_number) : 'null'})" style="background:#0284c7; border:1px solid #38bdf8; color:#fff; font-weight:800; font-size:0.75rem; padding:5px 10px; border-radius:7px; cursor:pointer;">🔗 Map &amp; Lock</button>`;
    const rtLabel = isLeague
      ? `R${m.round || 1}${m.table_number ? ' • Pod ' + m.table_number : ''}`
      : `R${m.round || 1}${m.table_number ? ' • T' + m.table_number : ''}`;
    return `
      <div style="background:#090f1e; border:1px solid ${(m.recommended && !isLocked) ? '#10b981' : (isCurr ? '#38bdf8' : '#1e293b')}; border-radius:10px; padding:0.75rem 0.9rem; display:flex; justify-content:space-between; align-items:center; gap:0.75rem;">
        <div style="min-width:0;">
          <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
            <span style="font-weight:800; color:#f8fafc; font-size:0.86rem;">${isLeague ? '⚔️' : '🏆'} ${escapeHtml(m.event_name || 'Tournament')}</span>
            <span style="font-family:monospace; font-size:0.74rem; color:#38bdf8;">${rtLabel}</span>
            ${currBadge}
            ${recBadge}
          </div>
          <div style="font-size:0.78rem; color:#cbd5e1; margin-top:0.22rem;">
            🟦 ${escapeHtml(m.player1_name)} (${m.player1_score ?? '-'}) <span style="color:#64748b;">vs</span> 🟥 ${escapeHtml(m.player2_name)} (${m.player2_score ?? '-'})
          </div>
          <div style="font-size:0.7rem; color:#64748b; margin-top:0.15rem;">
            ${m.match_date ? new Date(m.match_date).toLocaleDateString() : '-'}
          </div>
        </div>
        <div style="flex-shrink:0;">
          ${actionHtml}
        </div>
      </div>
    `;
  }).join('');
}

async function confirmMapGameToEventFromHub(eventId, roundNum, tableNum) {
  const statusEl = document.getElementById('omni-map-event-status');
  try {
    const headers = { 'Content-Type': 'application/json' };
    const tok = (window.api && typeof window.api.getAuthToken === 'function' ? window.api.getAuthToken() : '') || localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || localStorage.getItem('omnitactica_id_token') || localStorage.getItem('firebase_id_token') || '';
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    const resp = await fetch(`/api/tracker/games/${encodeURIComponent(_hubActiveMapMatchId)}/map_event_match`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event_id: eventId, round_num: roundNum, table_num: tableNum })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.detail || resp.statusText);
    }
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(16,185,129,0.15)';
      statusEl.style.border = '1px solid rgba(16,185,129,0.4)';
      statusEl.style.color = '#34d399';
      statusEl.innerHTML = `✅ Mapped &amp; locked to <b>${escapeHtml(data.event_name || eventId)}</b> (Round ${roundNum}${tableNum ? ' • Table ' + tableNum : ''})${data.swapped_p1_p2 ? ' • Auto-aligned Player 1 / Player 2 columns!' : '!'}`;
    }
    // Update local mappable matches cache immediately so the pairing shows as locked
    const cachedSys = _getHubCachedMappableMatchesBySys(_hubActiveMapGameSystem);
    if (Array.isArray(cachedSys)) {
      const updatedSys = cachedSys.map(item => {
        if (String(item.event_id || '').toLowerCase() === String(eventId || '').toLowerCase() && Number(item.round || item.round_num || 1) === Number(roundNum || 1) && Number(item.table_number || item.table_num || 1) === Number(tableNum || 1)) {
          return Object.assign({}, item, { is_locked: true, locked_by_match_id: _hubActiveMapMatchId });
        }
        return item;
      });
      _setHubCachedMappableMatchesBySys(_hubActiveMapGameSystem, updatedSys);
    }
    try {
      localStorage.removeItem('my_hub_cache_40k');
      localStorage.removeItem('my_hub_cache_aos');
      localStorage.removeItem('my_hub_cache');
      ['gdm-11e-tracker-history', 'omni-aos-tracker-history'].forEach(k => {
        const raw = localStorage.getItem(k);
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          arr.forEach(item => {
            if (String(item.match_id || item.id || '').toUpperCase() === String(_hubActiveMapMatchId).toUpperCase()) {
              item.event_id = data.event_id || eventId;
              item.round_num = data.round_num || roundNum;
              item.table_num = data.table_num || tableNum;
              item.mapped_event_name = data.event_name || eventId;
              item.event_match_locked = true;
              if (data.p1_name) item.p1_name = data.p1_name;
              if (data.p2_name) item.p2_name = data.p2_name;
              if (data.p1_score != null) { item.p1_score = data.p1_score; item.p1Score = data.p1_score; }
              if (data.p2_score != null) { item.p2_score = data.p2_score; item.p2Score = data.p2_score; }
            }
          });
          localStorage.setItem(k, JSON.stringify(arr));
        }
      });
    } catch (e) {}
    if (typeof window !== 'undefined') {
      window.currentEventData = null;
      if (window.api && typeof window.api.clearCache === 'function') {
        window.api.clearCache();
      }
    }
    if (typeof loadMyHubDashboard === 'function' && document.getElementById('my-hub-content')) {
      myHubData = null;
      loadMyHubDashboard();
    }
    if (typeof window.__refreshTrackerHistoryAfterImport === 'function') {
      window.__refreshTrackerHistoryAfterImport();
    }
    setTimeout(() => closeMapGameToEventModal(), 1100);
  } catch (err) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(239,68,68,0.14)';
      statusEl.style.border = '1px solid rgba(239,68,68,0.4)';
      statusEl.style.color = '#f87171';
      statusEl.innerHTML = `⚠️ ${escapeHtml(err.message)}`;
    }
  }
}

window.openTrackerImportModal = openTrackerImportModal;
window.closeTrackerImportModal = closeTrackerImportModal;
window.switchTrackerImportTab = switchTrackerImportTab;
window.fillTrackerImportDemo = fillTrackerImportDemo;
window.submitTrackerImport = submitTrackerImport;
window.openMapGameToEventModal = openMapGameToEventModal;
window.closeMapGameToEventModal = closeMapGameToEventModal;
window.filterHubMappableEventMatches = filterHubMappableEventMatches;
window.setHubMappableStatusFilter = setHubMappableStatusFilter;
window.confirmMapGameToEventFromHub = confirmMapGameToEventFromHub;
window.prefetchHubMappableEventMatches = prefetchHubMappableEventMatches;



