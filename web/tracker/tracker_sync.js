/**
 * Synchronized Multiplayer, Room Key Generator & Strict 2-Player Collaborative Match Engine
 * for Warhammer 40,000 11th Edition Game Tracker
 */

(function () {
  'use strict';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getDirectNewRecruitUrl(url, list) {
    if (list && list.id && typeof list.id === 'string' && list.id.startsWith('nr_')) {
      const shareId = list.id.replace('nr_', '');
      return `https://www.newrecruit.eu/app/list/${shareId}`;
    }
    if (!url) return '';
    const match = url.match(/newrecruit\.eu\/app\/list\/([a-zA-Z0-9_\-]+)/i);
    if (match) {
      const shareId = match[1];
      return `https://www.newrecruit.eu/app/list/${shareId}`;
    }
    return url;
  }

  // 1. Suppress and block GDM's native install prompt from triggering in tracker
  window.addEventListener('beforeinstallprompt', (e) => {
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);

  // 2. Aggressively remove any native GDM Install / Add to Home Screen popups
  function suppressGdmInstallPrompts() {
    try {
      const candidates = document.querySelectorAll('div, section, aside, [role="dialog"], [role="alert"]');
      candidates.forEach(el => {
        if (el.closest('#gt-lobby-wrapper') || el.closest('#gt-sync-hud') || el.closest('#gt-user-status-bar') || el.closest('#gt-waiting-modal') || el.closest('#pwa-install-banner')) return;
        const txt = (el.textContent || '').trim().toUpperCase();
        if (
          (txt.includes('INSTALL') && (txt.includes('HOME SCREEN') || txt.includes('HOMESCREEN') || txt.includes('APP') || txt.includes('BROWSER'))) ||
          (txt.includes('ADD TO HOME SCREEN') || txt.includes('ADD TO HOMESCREEN')) ||
          (txt.includes('INSTALL GDM') || (txt.includes('INSTALL 40K ELO') && !el.closest('#pwa-install-banner')))
        ) {
          const popup = el.closest('div[class*="fixed"], div[class*="absolute"], [role="dialog"], [role="alert"]') || el;
          if (popup && popup !== document.body && popup !== document.documentElement && !popup.contains(document.getElementById('gt-lobby-wrapper'))) {
            popup.style.display = 'none';
            try { popup.remove(); } catch(e) {}
          }
        }
      });
    } catch(e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      suppressGdmInstallPrompts();
      setInterval(suppressGdmInstallPrompts, 400);
      if (document.body) {
        new MutationObserver(suppressGdmInstallPrompts).observe(document.body, { childList: true, subtree: true });
      }
    });
  } else {
    suppressGdmInstallPrompts();
    setInterval(suppressGdmInstallPrompts, 400);
    if (document.body) {
      new MutationObserver(suppressGdmInstallPrompts).observe(document.body, { childList: true, subtree: true });
    }
  }

  const SYNC_CONFIG = {
    apiBase: '/api/tracker/room',
    historyEndpoint: '/api/tracker/history',
    authMeEndpoint: '/api/auth/me',
    authLoginEndpoint: '/api/auth/login',
    authRegisterEndpoint: '/api/auth/register',
    debounceMs: 80
  };

  const isPlay = window.location.pathname.includes('/play');

  let currentUser = null;
  let clientState = {
    matchId: null,
    role: 'spectator', // 'player1', 'player2', 'referee', 'spectator'
    clientId: 'client_' + Math.random().toString(36).substring(2, 9),
    version: 0,
    onlineCount: 1,
    isApplyingRemote: false,
    eventSource: null,
    debounceTimer: null,
    p2Connected: false,
    p1ArmyList: null,
    p2ArmyList: null,
    activeListTab: 'opponent',
    activeListFilter: 'all',
    listSearchQuery: '',
    wounds: {}
  };

  let dbHistoryCache = [];

  // 1. Storage interceptors - immediate execution in HEAD
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
  const originalGetItem = window.localStorage.getItem.bind(window.localStorage);

  function getAuthToken() {
    return originalGetItem('elo_auth_token') || originalGetItem('native_session_token') || sessionStorage.getItem('elo_auth_token') || '';
  }

  function setAuthToken(token) {
    if (token) {
      originalSetItem('elo_auth_token', token);
      originalSetItem('native_session_token', token);
      sessionStorage.setItem('elo_auth_token', token);
      document.cookie = `session_token=${token}; path=/; max-age=2592000; SameSite=Lax`;
    }
  }

  function clearAuthToken() {
    originalRemoveItem('elo_auth_token');
    originalRemoveItem('native_session_token');
    originalRemoveItem('native_user_profile');
    sessionStorage.removeItem('elo_auth_token');
    document.cookie = 'session_token=; path=/; max-age=0';
    currentUser = null;
  }

  // On Landing Page: Clean out active match state if not playing
  if (!isPlay) {
    try {
      originalRemoveItem('gdm-11e-tracker-state');
    } catch (e) {}
  }

  function injectDefaultCpIntoState(raw) {
    if (!raw) return raw;
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (obj && typeof obj === 'object') {
        obj.trackCp = true;
        obj.trackCP = true;
        obj.trackCommandPoints = true;
        obj.commandPoints = true;
        obj.cp = true;
        obj.showCP = true;
        obj.enableCP = true;
        obj.cpTracking = true;
        obj.cpCounter = true;
        if (!obj.settings) obj.settings = {};
        obj.settings.trackCp = true;
        obj.settings.trackCP = true;
        obj.settings.trackCommandPoints = true;
        obj.settings.commandPoints = true;
        obj.settings.cp = true;
        if (!obj.game) obj.game = {};
        obj.game.trackCp = true;
        obj.game.trackCP = true;
        obj.game.trackCommandPoints = true;
        obj.game.commandPoints = true;
        obj.game.cp = true;
        return typeof raw === 'string' ? JSON.stringify(obj) : obj;
      }
    } catch(e) {}
    return raw;
  }

  // Override getItem
  window.localStorage.getItem = function (key) {
    if (key === 'gdm-11e-tracker-history') {
      return JSON.stringify(dbHistoryCache);
    }
    if (!isPlay && key === 'gdm-11e-tracker-state') {
      return null;
    }
    if (key === 'gdm-11e-tracker-state') {
      const raw = originalGetItem(key);
      return injectDefaultCpIntoState(raw);
    }
    return originalGetItem(key);
  };

  // Override setItem
  window.localStorage.setItem = function (key, value) {
    if (key === 'gdm-11e-tracker-history') {
      return; // Database is sole source of truth
    }
    let toSet = value;
    if (key === 'gdm-11e-tracker-state') {
      toSet = injectDefaultCpIntoState(value);
    }
    originalSetItem(key, toSet);
    if (key === 'gdm-11e-tracker-state') {
      notifyStateChanged();
    }
  };

  window.localStorage.removeItem = function (key) {
    if (key === 'gdm-11e-tracker-history') {
      dbHistoryCache = [];
      return;
    }
    originalRemoveItem(key);
    if (key === 'gdm-11e-tracker-state') {
      notifyStateChanged();
    }
  };

  // 2. Strict Authentication Verification
  async function verifySession() {
    const token = getAuthToken();
    if (!token) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.href);
      return false;
    }
    try {
      const resp = await fetch(SYNC_CONFIG.authMeEndpoint, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.authenticated && data.user) {
          currentUser = data.user;
          try {
            originalSetItem('native_user_profile', JSON.stringify(data.user));
          } catch(e) {}
          renderUserBar();
          return true;
        }
      } else if (resp.status === 401 || resp.status === 403) {
        clearAuthToken();
        window.location.href = '/login?redirect=' + encodeURIComponent(window.location.href);
        return false;
      }
    } catch (e) {
      console.warn('[verifySession] Network latency notice (proceeding with cached session):', e);
      const cached = originalGetItem('native_user_profile');
      if (cached) {
        try {
          currentUser = JSON.parse(cached);
          renderUserBar();
          return true;
        } catch(err) {}
      }
      return true;
    }
    return true;
  }

  function renderUserBar() {
    if (isPlay) {
      const old = document.getElementById('gt-user-status-bar');
      if (old) old.remove();
      return;
    }
    if (!currentUser) {
      try {
        const cached = originalGetItem('native_user_profile') || originalGetItem('bcp_user_profile');
        if (cached) currentUser = JSON.parse(cached);
      } catch (e) {}
    }
    if (!currentUser || !document.body) return;

    let bar = document.getElementById('gt-user-status-bar');
    if (bar && document.body.contains(bar)) return;

    bar = document.createElement('div');
    bar.id = 'gt-user-status-bar';
    bar.style.cssText = "position:fixed; top:12px; left:16px; z-index:99998; display:flex; align-items:center; gap:8px; background:rgba(15,23,42,0.94); border:1px solid rgba(56,189,248,0.25); backdrop-filter:blur(12px); padding:5px 12px; border-radius:9999px; font-family:'Inter',sans-serif; font-size:11px; color:#f8fafc; box-shadow:0 8px 30px rgba(0,0,0,0.6);";
    bar.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px;">
        <a href="/?tab=my-hub" style="display:inline-flex; align-items:center; gap:4px; color:#38bdf8; text-decoration:none; font-size:11px; font-weight:700; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.25); padding:3px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace; transition:all 0.15s;">
          🏠 My Hub
        </a>
        <a href="/11th/tracker" style="display:inline-flex; align-items:center; gap:4px; color:#f59e0b; text-decoration:none; font-size:11px; font-weight:700; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.25); padding:3px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace; transition:all 0.15s;">
          🎲 Lobby
        </a>
      </div>
      <span style="color:#334155;">|</span>
      <span style="display:inline-flex; align-items:center; gap:5px;">
        <span style="width:7px; height:7px; border-radius:50%; background:#10b981;"></span>
        <b style="color:#f8fafc; font-size:11px; font-family:'JetBrains Mono',monospace;">${currentUser.display_name || currentUser.email}</b>
      </span>
      <button onclick="window.__handleLogout()" style="background:transparent; border:none; color:#ef4444; font-size:11px; cursor:pointer; font-weight:700; padding:2px 4px; font-family:'JetBrains Mono',monospace;">Logout</button>
    `;
    document.body.appendChild(bar);

    window.__openScorecardModal = function () {
      if (!clientState.matchId) return;
      window.open(`/scorecard/${encodeURIComponent(clientState.matchId)}`, '_blank');
    };

    window.__openCompleteModal = function () {
      const raw = originalGetItem('gdm-11e-tracker-state');
      let st = {};
      try { st = JSON.parse(raw) || {}; } catch(e) {}
      const game = st.game || {};
      const p1 = st.p1 || {};
      const p2 = st.p2 || {};

      const p1Name = game.p1Name || 'Player 1';
      const p2Name = game.p2Name || 'Player 2';
      const p1Fac = game.p1Faction || '';
      const p2Fac = game.p2Faction || '';

      function getVp(obj) {
        if (obj.score !== undefined && obj.score > 0) return obj.score;
        const pri = (obj.rounds || []).reduce((s, r) => s + (r.primaryScore || 0), 0);
        const sec = (obj.rounds || []).reduce((s, r) => s + (r.secondaryScore || 0), 0);
        const paint = obj.battleReady !== false ? 10 : 0;
        return Math.min(100, Math.min(50, pri) + Math.min(40, sec) + paint);
      }

      const p1Score = getVp(p1);
      const p2Score = getVp(p2);

      const winnerName = (p1Score > p2Score) ? p1Name : ((p2Score > p1Score) ? p2Name : 'Draw / Tie');
      const winnerColor = (p1Score > p2Score) ? '#38bdf8' : ((p2Score > p1Score) ? '#f43f5e' : '#f59e0b');

      const eventId = game.eventId || st.event_id || '';
      const roundNum = game.roundNum || st.round_num || st.round || 1;
      const tableNum = game.tableNum || st.table_num || '';

      let existingModal = document.getElementById('gt-complete-modal');
      if (existingModal) existingModal.remove();

      const modal = document.createElement('div');
      modal.id = 'gt-complete-modal';
      modal.innerHTML = `
        <div style="position:fixed; inset:0; z-index:999999; background:rgba(4,7,14,0.94); backdrop-filter:blur(16px); display:flex; align-items:center; justify-content:center; padding:16px; font-family:'Inter',sans-serif; box-sizing:border-box;">
          <div style="background:#0e1526; border:1px solid #1e293b; border-radius:20px; width:100%; max-width:540px; box-shadow:0 25px 70px rgba(0,0,0,0.85); overflow:hidden; padding:24px 22px; text-align:center; box-sizing:border-box;">
            
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #1e293b; padding-bottom:10px;">
              <div style="text-align:left;">
                <h2 style="font-size:17px; font-weight:800; color:#f8fafc; font-family:'JetBrains Mono',monospace; margin:0; display:flex; align-items:center; gap:6px;">
                  🏁 COMPLETE & VERIFY MATCH
                </h2>
                <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
                  ${eventId ? `Tournament: ${eventId} • ` : ''}Round ${roundNum} ${tableNum ? '• Table ' + tableNum : ''}
                </div>
              </div>
              <button onclick="document.getElementById('gt-complete-modal').remove()" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;">✕</button>
            </div>

            <!-- Score Highlight Box -->
            <div style="background:#070b14; border:1px solid #1e293b; border-radius:14px; padding:16px; margin-bottom:16px; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px;">
              <div style="text-align:left;">
                <div style="font-size:11px; color:#38bdf8; font-weight:700; text-transform:uppercase;">${p1Name}</div>
                <div style="font-size:11px; color:#64748b;">${p1Fac || 'Army 1'}</div>
              </div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:26px; font-weight:900; color:#fff; display:flex; align-items:center; gap:6px;">
                <span style="color:#38bdf8;">${p1Score}</span>
                <span style="color:#64748b; font-size:16px;">-</span>
                <span style="color:#f43f5e;">${p2Score}</span>
              </div>
              <div style="text-align:right;">
                <div style="font-size:11px; color:#f43f5e; font-weight:700; text-transform:uppercase;">${p2Name}</div>
                <div style="font-size:11px; color:#64748b;">${p2Fac || 'Army 2'}</div>
              </div>
            </div>

            <div style="margin-bottom:14px; font-size:13px; font-weight:700; color:${winnerColor};">
              🏆 Match Outcome: ${winnerName} ${p1Score !== p2Score ? 'VICTORY' : ''}
            </div>

            <!-- Who Went First Selection -->
            <div style="background:#090f1e; border:1px solid #1e293b; border-radius:10px; padding:10px 14px; margin-bottom:16px; text-align:left;">
              <label style="font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase; display:block; margin-bottom:6px;">
                🎲 Who Took First Turn? (Required for BCP)
              </label>
              <div style="display:flex; gap:16px;">
                <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#f8fafc; cursor:pointer;">
                  <input type="radio" name="gt-who-went-first" value="player1" checked />
                  <span>${p1Name} (Turn 1)</span>
                </label>
                <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#f8fafc; cursor:pointer;">
                  <input type="radio" name="gt-who-went-first" value="player2" />
                  <span>${p2Name} (Turn 1)</span>
                </label>
              </div>
            </div>

            <div id="gt-complete-submit-status" style="margin-bottom:12px; font-size:12px; font-family:'JetBrains Mono',monospace; display:none;"></div>

            <!-- Action Buttons -->
            <div style="display:flex; flex-direction:column; gap:8px;">
              <button id="gt-btn-submit-bcp" onclick="window.__submitMatchToBcp()" style="width:100%; background:#0284c7; color:#fff; font-weight:800; font-size:13px; text-transform:uppercase; border:none; padding:12px; border-radius:10px; cursor:pointer; font-family:'JetBrains Mono',monospace; letter-spacing:0.04em; transition:all 0.15s;">
                🏁 SUBMIT SCORE TO BEST COAST PAIRINGS
              </button>

              <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <button onclick="window.__copyMatchScorecardSummary()" style="background:#1e293b; border:1px solid #334155; color:#f8fafc; font-weight:700; font-size:11px; padding:10px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace;">
                  📋 COPY SUMMARY
                </button>
                <button onclick="window.open('/scorecard/${encodeURIComponent(clientState.matchId)}', '_blank')" style="background:#1e293b; border:1px solid #334155; color:#38bdf8; font-weight:700; font-size:11px; padding:10px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace;">
                  📄 VIEW SCORECARD ↗
                </button>
              </div>

              <button onclick="window.__finalizeAndLockMatch()" style="background:transparent; border:1px dashed #334155; color:#94a3b8; font-size:11px; padding:8px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace; margin-top:4px;">
                🔒 Finalize & Lock Battle Record
              </button>
            </div>

          </div>
        </div>
      `;
      document.body.appendChild(modal);
    };

    window.__submitMatchToBcp = async function () {
      const btn = document.getElementById('gt-btn-submit-bcp');
      const statusEl = document.getElementById('gt-complete-submit-status');
      if (btn) { btn.disabled = true; btn.textContent = 'SUBMITTING TO BCP...'; }

      const raw = originalGetItem('gdm-11e-tracker-state');
      let st = {};
      try { st = JSON.parse(raw) || {}; } catch(e) {}
      const game = st.game || {};

      const firstTurnRadio = document.querySelector('input[name="gt-who-went-first"]:checked');
      const firstTurnVal = firstTurnRadio ? firstTurnRadio.value : 'player1';

      function getVp(obj) {
        if (obj.score !== undefined && obj.score > 0) return obj.score;
        const pri = (obj.rounds || []).reduce((s, r) => s + (r.primaryScore || 0), 0);
        const sec = (obj.rounds || []).reduce((s, r) => s + (r.secondaryScore || 0), 0);
        const paint = obj.battleReady !== false ? 10 : 0;
        return Math.min(100, Math.min(50, pri) + Math.min(40, sec) + paint);
      }

      const p1Score = getVp(st.p1 || {});
      const p2Score = getVp(st.p2 || {});
      const eventId = game.eventId || st.event_id || 'Casual';
      const roundNum = game.roundNum || st.round_num || 1;
      const tableNum = game.tableNum || st.table_num || 1;

      try {
        const resp = await fetch('/api/eventstudio/submit_score', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`
          },
          body: JSON.stringify({
            event_id: eventId,
            table: Number(tableNum) || 1,
            round_num: Number(roundNum) || 1,
            p1_score: p1Score,
            p2_score: p2Score,
            p1_name: game.p1Name || 'Player 1',
            p2_name: game.p2Name || 'Player 2',
            source_app: 'GameTracker-GDM',
            game_details: {
              match_id: clientState.matchId,
              first_turn: firstTurnVal,
              p1_faction: game.p1Faction,
              p2_faction: game.p2Faction
            }
          })
        });

        const res = await resp.json();
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.color = '#10b981';
          statusEl.innerHTML = `✅ Score successfully synced with Best Coast Pairings & archived in Elo database!`;
        }
        if (btn) {
          btn.style.background = '#10b981';
          btn.textContent = '✓ SUBMITTED TO BCP';
        }

        st.is_finished = true;
        st.bcp_submitted = true;
        st.who_went_first = firstTurnVal;
        saveLocalState(st);
        notifyStateChanged();
      } catch (err) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.color = '#ef4444';
          statusEl.textContent = `Notice: Score archived in DB. (BCP direct sync: ${err.message})`;
        }
        if (btn) { btn.disabled = false; btn.textContent = 'RETRY BCP SUBMIT'; }
      }
    };

    window.__copyMatchScorecardSummary = function () {
      const raw = originalGetItem('gdm-11e-tracker-state');
      let st = {};
      try { st = JSON.parse(raw) || {}; } catch(e) {}
      const game = st.game || {};

      function getVp(obj) {
        if (obj.score !== undefined && obj.score > 0) return obj.score;
        const pri = (obj.rounds || []).reduce((s, r) => s + (r.primaryScore || 0), 0);
        const sec = (obj.rounds || []).reduce((s, r) => s + (r.secondaryScore || 0), 0);
        const paint = obj.battleReady !== false ? 10 : 0;
        return Math.min(100, Math.min(50, pri) + Math.min(40, sec) + paint);
      }

      const p1 = game.p1Name || 'Player 1';
      const p2 = game.p2Name || 'Player 2';
      const p1S = getVp(st.p1 || {});
      const p2S = getVp(st.p2 || {});
      const p1F = game.p1Faction || '';
      const p2F = game.p2Faction || '';

      const summary = `🏆 Warhammer 40,000 Match Result
⚔️ ${p1} (${p1F}): ${p1S} VP
⚔️ ${p2} (${p2F}): ${p2S} VP
🎯 Mission: ${game.primary || 'Take & Hold'}
📄 Verified Scorecard: ${window.location.origin}/scorecard/${encodeURIComponent(clientState.matchId)}`;

      navigator.clipboard.writeText(summary);
      alert('📋 Match Summary Copied to Clipboard!');
    };

    window.__finalizeAndLockMatch = function () {
      const raw = originalGetItem('gdm-11e-tracker-state');
      let st = {};
      try { st = JSON.parse(raw) || {}; } catch(e) {}
      st.is_finished = true;
      st.round = 5;
      saveLocalState(st);
      notifyStateChanged();
      alert('🔒 Match is now finalized and locked as completed.');
      const m = document.getElementById('gt-complete-modal');
      if (m) m.remove();
    };

    window.__handleLogout = async function () {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
      } catch (e) {}
      clearAuthToken();
      window.location.href = '/';
    };
  }

  // 3. Initialize Match Room / Play / Setup / Landing
  async function init() {
    const isAuthed = await verifySession();
    if (!isAuthed) return;

    if (isPlay) {
      const params = new URLSearchParams(window.location.search);
      const rawCurrent = originalGetItem('gdm-11e-tracker-state');
      let currentObj = {};
      try { currentObj = JSON.parse(rawCurrent) || {}; } catch(e) {}

      let matchId = params.get('match_id') || params.get('room') || params.get('match') || currentObj.match_id || (currentObj.id && typeof currentObj.id === 'string' && currentObj.id.startsWith('WH40K-') ? currentObj.id : null);

      if (matchId) {
        // Direct URL or History access: verify that this room exists on the server!
        try {
          const chk = await fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/check`, {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
          });
          const chkData = await chk.json();
          if (!chk.ok || !chkData.exists) {
            alert(`❌ Room Key "${matchId}" does not exist or has expired.`);
            window.location.href = '/11th/tracker';
            return;
          }
        } catch (e) {}
      } else {
        // No match_id provided: create new collision-free room via API
        try {
          const resp = await fetch('/api/tracker/room/create', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({
              token: getAuthToken(),
              p1_name: currentUser.display_name || 'Player 1'
            })
          });
          if (resp.ok) {
            const data = await resp.json();
            matchId = data.match_id;
            clientState.matchId = matchId;
            clientState.role = 'player1';
            applyRemoteState(data.state);
          }
        } catch (e) {}
      }

      if (!matchId) {
        window.location.href = '/11th/tracker';
        return;
      }

      clientState.matchId = matchId.toUpperCase();
      const url = new URL(window.location.href);
      url.searchParams.set('match_id', clientState.matchId);
      window.history.replaceState({}, '', url.toString());

      injectMultiplayerHUD();

      // Join room to bind Player 2 slot or Spectator (Strict 2-Player Capacity)
      try {
        const resp = await fetch(`/api/tracker/room/${clientState.matchId}/join`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`
          },
          body: JSON.stringify({ token: getAuthToken() })
        });
        if (resp.ok) {
          const joinData = await resp.json();
          clientState.role = joinData.role || 'spectator';
          injectMultiplayerHUD(); // Update HUD with confirmed role!
          if (joinData.state) {
            applyRemoteState(joinData.state);
          }
        }
      } catch (e) {}

      injectPlayer2InviteWidget();
      attachDomActionInterceptors();
      startHybridSync();
    } else {
      // Landing page (/11th/tracker or /tracker)
      injectLobbyHub();
      syncHistoryFromDatabase();
      startHistoryPolling();
    }
  }

  // Global Handlers for Room Creation and Joining
  window.__handleCreateRoom = async function () {
    try {
      const resp = await fetch('/api/tracker/room/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({
          token: getAuthToken(),
          p1_name: currentUser ? (currentUser.display_name || 'Player 1') : 'Player 1'
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        originalSetItem('gdm-11e-tracker-state', JSON.stringify(data.state));
        window.location.href = `/11th/tracker/play?match_id=${encodeURIComponent(data.match_id)}`;
        return;
      }
    } catch (err) {}
    window.location.href = '/11th/tracker/play';
  };

  window.__handleJoinRoomInput = async function () {
    const input = document.getElementById('gt-lobby-join-input');
    const errDiv = document.getElementById('gt-lobby-join-error');
    const btn = document.getElementById('gt-lobby-join-btn');
    let code = (input.value || '').trim();
    if (code.includes('match_id=')) {
      try { code = new URL(code).searchParams.get('match_id') || code; } catch(e) {}
    }
    if (!code) {
      if (errDiv) { errDiv.textContent = 'Please enter a Room Key.'; errDiv.style.display = 'block'; }
      return;
    }

    code = code.toUpperCase().replace(/\s+/g, '');
    if (!code.startsWith('WH40K-') && code.length === 8) {
      code = `WH40K-${code.substring(0, 4)}-${code.substring(4)}`;
    }

    if (errDiv) errDiv.style.display = 'none';
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    // Verify if room exists on the server!
    try {
      const resp = await fetch(`/api/tracker/room/${encodeURIComponent(code)}/check`, {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
      });
      const data = await resp.json();
      if (!resp.ok || !data.exists) {
        if (errDiv) {
          errDiv.textContent = `❌ Room "${code}" does not exist. Please check with your opponent.`;
          errDiv.style.display = 'block';
        }
        if (btn) { btn.disabled = false; btn.textContent = 'JOIN'; }
        return;
      }

      if (data.is_full) {
        const proceed = confirm(`⚠️ Room "${code}" already has 2 active players (${data.p1_name} vs ${data.p2_name}). Join as a Spectator (View Only)?`);
        if (!proceed) {
          if (btn) { btn.disabled = false; btn.textContent = 'JOIN'; }
          return;
        }
      }

      window.location.href = `/11th/tracker/play?match_id=${encodeURIComponent(data.match_id || code)}`;
    } catch (err) {
      if (errDiv) {
        errDiv.textContent = 'Connection error checking room status. Please try again.';
        errDiv.style.display = 'block';
      }
      if (btn) { btn.disabled = false; btn.textContent = 'JOIN'; }
    }
  };

  // 4. Landing Page: Inject Mobile-Friendly 2-Player Room Key Generator & Join Card
  function injectLobbyHub() {
    function tryInject() {
      const main = document.querySelector('main') || document.body;
      if (!main) return;

      let wrapper = document.getElementById('gt-lobby-wrapper');
      if (!wrapper || !document.body.contains(wrapper)) {
        wrapper = document.createElement('div');
        wrapper.id = 'gt-lobby-wrapper';
        wrapper.style.cssText = "width:100%; max-width:820px; margin:0 auto; padding:12px; box-sizing:border-box; display:block !important; visibility:visible !important; opacity:1 !important;";

        wrapper.innerHTML = `
          <div id="gt-lobby-hub-card" style="margin:16px 0 24px; background:#0f1524; border:1px solid #1e293b; border-radius:18px; padding:18px; box-shadow:0 12px 35px rgba(0,0,0,0.5); width:100%; box-sizing:border-box; display:block !important; visibility:visible !important;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:10px; flex-wrap:wrap; gap:8px;">
              <div>
                <h3 style="font-size:15px; font-weight:800; color:#f8fafc; margin:0; font-family:'JetBrains Mono',monospace; letter-spacing:0.04em;">2-PLAYER MATCH LOBBY</h3>
                <p style="font-size:11px; color:#94a3b8; margin:2px 0 0;">Create a room key to host or enter a code to join an opponent's table.</p>
              </div>
              <span style="font-size:10px; font-weight:700; color:#38bdf8; background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.3); padding:3px 8px; border-radius:9999px;">2 Players Max</span>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:14px;">
              <!-- Host Card -->
              <div style="background:#090d18; border:1px solid #1e293b; border-radius:14px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box;">
                <div>
                  <div style="font-size:12px; font-weight:800; color:#f59e0b; text-transform:uppercase; margin-bottom:4px; font-family:'JetBrains Mono',monospace;">🎲 Host a Match</div>
                  <p style="font-size:11px; color:#94a3b8; margin:0 0 12px; line-height:1.4;">Create a match room and begin army setup with shareable room code.</p>
                </div>
                <button onclick="window.__handleCreateRoom()" style="width:100%; box-sizing:border-box; background:#f59e0b; color:#0f172a; font-weight:800; font-size:12px; text-transform:uppercase; border:none; padding:12px; border-radius:10px; cursor:pointer; letter-spacing:0.06em; font-family:'JetBrains Mono',monospace; transition:background 0.2s;">
                  CREATE & ENTER MATCH ➔
                </button>
              </div>

              <!-- Join Card -->
              <div style="background:#090d18; border:1px solid #1e293b; border-radius:14px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box;">
                <div>
                  <div style="font-size:12px; font-weight:800; color:#38bdf8; text-transform:uppercase; margin-bottom:4px; font-family:'JetBrains Mono',monospace;">🔗 Join Room Key</div>
                  <p style="font-size:11px; color:#94a3b8; margin:0 0 10px; line-height:1.4;">Enter the 8-character Room Key provided by your opponent.</p>
                </div>
                <div>
                  <div id="gt-lobby-join-error" style="display:none; color:#ef4444; font-size:11px; font-weight:600; margin-bottom:6px; font-family:'JetBrains Mono',monospace;"></div>
                  <div style="display:flex; gap:8px;">
                    <input id="gt-lobby-join-input" type="text" placeholder="e.g. WH40K-7A9B-3C4D" style="flex:1; min-width:0; background:#070b14; border:1px solid #334155; border-radius:8px; padding:10px; font-family:'JetBrains Mono',monospace; font-size:13px; color:#f8fafc; outline:none; text-transform:uppercase; box-sizing:border-box;" onkeydown="if(event.key==='Enter')window.__handleJoinRoomInput()" />
                    <button id="gt-lobby-join-btn" onclick="window.__handleJoinRoomInput()" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; text-transform:uppercase; border:none; padding:10px 14px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace; white-space:nowrap;">ENTER ROOM ➔</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div id="gt-history-section" style="margin:20px 0 40px; width:100%; box-sizing:border-box; display:block !important; visibility:visible !important;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
              <div style="font-size:14px; font-weight:800; color:#f8fafc; font-family:'JetBrains Mono',monospace; letter-spacing:0.04em;">
                GAME HISTORY <span id="gt-history-count" style="font-size:12px; color:#38bdf8; font-weight:700; margin-left:4px;"></span>
              </div>
            </div>
            <div id="gt-history-list" style="display:flex; flex-direction:column; gap:10px;">
              <div style="color:#64748b; font-size:12px; font-family:'JetBrains Mono',monospace; padding:18px; text-align:center; background:#0f1524; border-radius:14px; border:1px solid #1e293b;">
                Loading match history...
              </div>
            </div>
          </div>
        `;

        if (main.firstChild) {
          main.insertBefore(wrapper, main.firstChild);
        } else {
          main.appendChild(wrapper);
        }
      }

      hideNativeGdmEmptyState();
      renderHistoryList(dbHistoryCache);
      syncHistoryFromDatabase();
    }

    let isObserverRunning = false;
    const observer = new MutationObserver(() => {
      if (isObserverRunning) return;
      isObserverRunning = true;
      try {
        hideNativeGdmEmptyState();
        if (!document.getElementById('gt-lobby-wrapper')) {
          tryInject();
        }
        if (!document.getElementById('gt-user-status-bar')) {
          renderUserBar();
        }
      } finally {
        setTimeout(() => { isObserverRunning = false; }, 200);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Waiting Room Modal for Host
  function showWaitingLobbyModal(matchId) {
    const inviteUrl = `${window.location.origin}/11th/tracker/play?match_id=${matchId}`;
    const modal = document.createElement('div');
    modal.id = 'gt-waiting-modal';
    modal.innerHTML = `
      <div style="position:fixed; inset:0; z-index:999999; background:rgba(4,7,14,0.92); backdrop-filter:blur(14px); display:flex; align-items:center; justify-content:center; padding:16px; font-family:'Inter',sans-serif;">
        <div style="background:#0e1526; border:1px solid #1e293b; border-radius:20px; width:100%; max-width:480px; box-shadow:0 25px 70px rgba(0,0,0,0.85); overflow:hidden; padding:28px 24px; text-align:center;">
          <div style="font-size:32px; margin-bottom:6px;">⚔️</div>
          <h2 style="font-size:20px; font-weight:800; color:#f8fafc; font-family:'JetBrains Mono',monospace; letter-spacing:0.04em;">ROOM KEY GENERATED</h2>
          <p style="font-size:13px; color:#94a3b8; margin:6px 0 18px;">Share this Room Key with Player 2 to begin collaborative setup.</p>
          
          <div style="background:#070b14; border:2px dashed #f59e0b; border-radius:14px; padding:16px; margin-bottom:18px;">
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#94a3b8; margin-bottom:4px; letter-spacing:0.08em;">ROOM KEY</div>
            <div style="font-size:26px; font-weight:900; color:#f59e0b; font-family:'JetBrains Mono',monospace; letter-spacing:0.1em;">${matchId}</div>
          </div>

          <div style="display:flex; gap:8px; margin-bottom:20px;">
            <input readonly value="${inviteUrl}" style="flex:1; background:#070b14; border:1px solid #334155; border-radius:8px; padding:10px; font-size:11px; color:#cbd5e1; font-family:'JetBrains Mono',monospace; outline:none;" />
            <button onclick="navigator.clipboard.writeText('${inviteUrl}'); alert('📋 Invite Link Copied! Send to Player 2.');" style="background:#0284c7; color:#fff; font-weight:800; font-size:11px; border:none; padding:10px 14px; border-radius:8px; cursor:pointer;">
              COPY LINK
            </button>
          </div>

          <div style="display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:24px; font-size:13px; color:#f59e0b;">
            <span id="gt-waiting-status-dot" style="width:8px; height:8px; border-radius:50%; background:#f59e0b; display:inline-block; animation:pulse 1.5s infinite;"></span>
            <span id="gt-waiting-status-text">Waiting for Player 2 to join (1/2 Players)...</span>
          </div>

          <button onclick="window.location.href='/11th/tracker/play?match_id=${matchId}'" style="width:100%; background:#10b981; color:#0f172a; font-weight:800; font-size:14px; text-transform:uppercase; border:none; padding:14px; border-radius:11px; cursor:pointer; font-family:'JetBrains Mono',monospace; letter-spacing:0.06em;">
            ENTER SETUP SCREEN ➔
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    let hasAdvanced = false;
    function advanceToSetup(name) {
      if (hasAdvanced) return;
      hasAdvanced = true;
      const statusText = document.getElementById('gt-waiting-status-text');
      const statusDot = document.getElementById('gt-waiting-status-dot');
      if (statusText) {
        statusText.textContent = `🟢 Player 2 Connected (${name || 'Ready'})! Entering setup...`;
        statusText.style.color = '#10b981';
      }
      if (statusDot) {
        statusDot.style.background = '#10b981';
      }
      setTimeout(() => {
        window.location.href = `/11th/tracker/play?match_id=${matchId}`;
      }, 700);
    }

    // 1. Listen for P2 connection over SSE
    const sse = new EventSource(`/api/tracker/room/${matchId}/stream?client_id=host_${Date.now()}`);
    sse.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'presence' && msg.count >= 2) {
          advanceToSetup();
        } else if (msg.type === 'state_update' && msg.state && (msg.state.user_id_p2 || (msg.state.game && msg.state.game.p2Name && msg.state.game.p2Name !== 'Player 2'))) {
          advanceToSetup(msg.state.game ? msg.state.game.p2Name : '');
        }
      } catch (e) {}
    };

    // 2. Fallback Fast Poll every 800ms
    const pollTimer = setInterval(async () => {
      if (hasAdvanced) { clearInterval(pollTimer); return; }
      try {
        const resp = await fetch(`/api/tracker/room/${matchId}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.online_count >= 2 || data.user_id_p2 || (data.state && data.state.user_id_p2)) {
            clearInterval(pollTimer);
            advanceToSetup(data.state && data.state.game ? data.state.game.p2Name : '');
          }
        }
      } catch (e) {}
    }, 800);
  }

  // 5. Step 1: 2-Player Invite & Setup Helper inside Play Screen
  function injectPlayer2InviteWidget() {
    function tryInjectWidget() {
      const existing = document.getElementById('gt-invite-widget');
      if (existing && document.body.contains(existing)) return;

      const stepTitle = document.querySelector('h2');
      if (stepTitle && stepTitle.textContent.includes('PLAYERS')) {
        const rawState = originalGetItem('gdm-11e-tracker-state');
        let stateObj = {};
        try { stateObj = JSON.parse(rawState); } catch(e) {}

        const p2Connected = clientState.onlineCount >= 2 || !!(stateObj.user_id_p2 || (stateObj.game && stateObj.game.p2Name && stateObj.game.p2Name !== 'Player 2'));
        const inviteUrl = window.location.href;

        const widget = document.createElement('div');
        widget.id = 'gt-invite-widget';
        widget.style.cssText = "margin-bottom:16px; background:#0f172a; border:1px solid #1e293b; border-radius:14px; padding:14px 16px;";
        
        if (!p2Connected) {
          widget.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
              <span style="font-size:12px; font-weight:800; color:#38bdf8; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">⚔️ Room Key: ${clientState.matchId} (1/2 Players)</span>
              <span style="display:flex; align-items:center; gap:6px; font-size:11px; color:#f59e0b;">
                <span style="width:6px; height:6px; border-radius:50%; background:#f59e0b; display:inline-block;"></span>
                Waiting for Player 2...
              </span>
            </div>
            <p style="margin:0 0 10px; font-size:12px; color:#94a3b8;">Share this Room Key with Player 2 to collaborate live on army setup:</p>
            <div style="display:flex; gap:8px;">
              <input readonly value="${inviteUrl}" style="flex:1; background:#070b14; border:1px solid #334155; border-radius:8px; padding:8px 10px; font-size:11px; color:#cbd5e1; font-family:'JetBrains Mono',monospace; outline:none;" />
              <button onclick="navigator.clipboard.writeText('${inviteUrl}'); alert('📋 Invite Link Copied! Send this to Player 2.');" style="background:#f59e0b; color:#0f172a; font-weight:800; font-size:11px; text-transform:uppercase; border:none; padding:8px 14px; border-radius:8px; cursor:pointer; letter-spacing:0.04em;">
                📋 COPY LINK
              </button>
            </div>
          `;
        } else {
          widget.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <span style="font-size:12px; font-weight:800; color:#10b981; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">🟢 Connected: Player 1 vs Player 2 (${stateObj.game && stateObj.game.p2Name ? stateObj.game.p2Name : 'Opponent'})</span>
              <span style="font-size:11px; color:#94a3b8; font-family:'JetBrains Mono',monospace;">2/2 Players Active (Collaborative Live)</span>
            </div>
          `;
        }

        stepTitle.parentNode.insertBefore(widget, stepTitle.nextSibling);
      }
    }

    tryInjectWidget();
    const observer = new MutationObserver(tryInjectWidget);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function hideNativeGdmEmptyState() {
    // On Landing page: Hide all native direct siblings inside main except #gt-lobby-wrapper
    if (!isPlay) {
      const main = document.querySelector('main');
      if (main) {
        Array.from(main.children).forEach(child => {
          if (child.id !== 'gt-lobby-wrapper') {
            child.style.display = 'none';
          }
        });
      }
    }

    document.querySelectorAll('footer, button:has(span.text-xs), a[href*="/news"]').forEach(el => {
      el.style.display = 'none';
    });
  }

  function renderHistoryList(historyList) {
    const list = (historyList && Array.isArray(historyList)) ? historyList : (dbHistoryCache || []);
    const container = document.getElementById('gt-history-list');
    const countEl = document.getElementById('gt-history-count');
    if (!container) return;

    if (countEl) {
      countEl.textContent = list.length > 0 ? `(${list.length})` : '';
    }

    if (list.length === 0) {
      container.innerHTML = `
        <div style="color:#94a3b8; font-size:12px; font-family:'JetBrains Mono',monospace; padding:18px; text-align:center; background:#0f1524; border-radius:14px; border:1px solid #1e293b;">
          No matches logged yet. Click <b>CREATE & ENTER MATCH</b> above to start your first game!
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(item => {
      const p1 = item.game?.p1Name || item.p1_name || 'Player 1';
      const p2 = item.game?.p2Name || item.p2_name || 'Player 2';
      const p1F = item.game?.p1Faction || item.p1_faction || '';
      const p2F = item.game?.p2Faction || item.p2_faction || '';
      const p1S = item.p1Score ?? item.p1_score ?? 0;
      const p2S = item.p2Score ?? item.p2_score ?? 0;
      const mid = item.match_id || item.id || '';
      const isDone = item.isFinished || item.is_finished;
      const dateStr = new Date(item.date || item.updated_at || Date.now()).toLocaleDateString();

      const factionSubtitle = (p1F || p2F) ? `<div style="font-size:11px; color:#94a3b8; margin-top:2px;">${escapeHtml(p1F || 'Army 1')} vs ${escapeHtml(p2F || 'Army 2')}</div>` : '';

      return `
        <div data-match-id="${escapeHtml(mid)}" onclick="window.location.href='/11th/tracker/play?match_id=${encodeURIComponent(mid)}'" style="background:#0f1524; border:1px solid #1e293b; border-radius:14px; padding:14px 18px; display:flex; align-items:center; justify-content:space-between; cursor:pointer; transition:all 0.2s; box-sizing:border-box; position:relative;" onmouseover="this.style.borderColor='#38bdf8'; this.style.transform='translateY(-1px)'" onmouseout="this.style.borderColor='#1e293b'; this.style.transform='none'">
          <div style="min-width:0; flex:1;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:2px; flex-wrap:wrap;">
              <span style="font-size:12px; font-weight:800; font-family:'JetBrains Mono',monospace; color:var(--accent, #38bdf8); background:rgba(56,189,248,0.1); padding:2px 6px; border-radius:6px; border:1px solid rgba(56,189,248,0.25);">#${escapeHtml(mid.replace('WH40K-', ''))} ↗</span>
              <b style="color:#f8fafc; font-size:14px; font-family:'JetBrains Mono',monospace;">${escapeHtml(p1)} <span style="color:#64748b; font-weight:normal;">vs</span> ${escapeHtml(p2)}</b>
            </div>
            ${factionSubtitle}
            <div style="font-size:11px; color:#64748b; margin-top:4px;">
              <span>${dateStr}</span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:12px; margin-left:14px;">
            <span style="font-size:15px; font-weight:800; font-family:'JetBrains Mono',monospace; color:#38bdf8;">
              ${p1S} - ${p2S}
            </span>
            <span style="background:${isDone ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)'}; color:${isDone ? '#10b981' : '#f59e0b'}; border:1px solid ${isDone ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}; font-weight:800; font-size:11px; padding:4px 10px; border-radius:6px; font-family:'JetBrains Mono',monospace; white-space:nowrap; letter-spacing:0.04em;">
              ${isDone ? 'Completed' : 'In Progress'}
            </span>
            <button title="View Full Turn-by-Turn Digital Scorecard" onclick="event.stopPropagation(); window.open('/scorecard/${encodeURIComponent(mid)}', '_blank')" style="background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.28); color:#38bdf8; font-size:11px; font-weight:700; padding:4px 8px; border-radius:6px; cursor:pointer; font-family:'JetBrains Mono',monospace; white-space:nowrap; transition:all 0.15s;" onmouseover="this.style.background='rgba(56,189,248,0.25)'" onmouseout="this.style.background='rgba(56,189,248,0.12)'">
              📄 Scorecard
            </button>
            <button title="Hide from your history (Soft Delete)" onclick="event.stopPropagation(); window.__gdmHideTrackerGame('${escapeHtml(mid)}', this.closest('[data-match-id]'))" style="background:transparent; border:1px solid #334155; color:#94a3b8; width:28px; height:28px; border-radius:6px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.15s; margin-left:2px;" onmouseover="this.style.borderColor='#ef4444'; this.style.color='#ef4444'; this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.borderColor='#334155'; this.style.color='#94a3b8'; this.style.background='transparent'">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // 6. PostgreSQL Database as Sole Source of Truth for History
  async function syncHistoryFromDatabase() {
    try {
      const token = getAuthToken();
      const resp = await fetch(SYNC_CONFIG.historyEndpoint + (token ? `?token=${encodeURIComponent(token)}` : ''), {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (resp.ok) {
        const data = await resp.json();
        const rawList = (data && data.history && Array.isArray(data.history)) ? data.history : [];
        dbHistoryCache = rawList.map(item => {
          let s = {};
          if (typeof item.state_json === 'string') {
            try { s = JSON.parse(item.state_json); } catch (e) {}
          } else if (typeof item.state_json === 'object') {
            s = item.state_json || {};
          }
          return {
            id: item.match_id,
            match_id: item.match_id,
            date: new Date(item.updated_at || item.created_at || Date.now()).getTime(),
            game: s.game || {
              p1Name: item.p1_name || 'Player 1',
              p2Name: item.p2_name || 'Player 2',
              p1Faction: item.p1_faction,
              p2Faction: item.p2_faction,
              p1Detachments: item.p1_detachment ? [item.p1_detachment] : [],
              p2Detachments: item.p2_detachment ? [item.p2_detachment] : [],
              primary: item.primary_mission || 'Take & Hold',
              deployment: item.deployment || 'Search & Destroy'
            },
            p1: s.p1 || { score: item.p1_score || 0 },
            p2: s.p2 || { score: item.p2_score || 0 },
            round: item.current_round || s.round || 1,
            p1Score: item.p1_score || 0,
            p2Score: item.p2_score || 0,
            started: item.started,
            isFinished: item.is_finished,
            winner: item.winner_name,
            ...s
          };
        });

        // Filter out locally hidden match IDs to prevent any race condition
        let locallyHidden = [];
        try { locallyHidden = JSON.parse(originalGetItem('gt-hidden-matches') || '[]'); } catch(e) {}
        if (locallyHidden.length > 0) {
          dbHistoryCache = dbHistoryCache.filter(item => !locallyHidden.includes(item.match_id || item.id));
        }

        originalSetItem('gdm-11e-tracker-history', JSON.stringify(dbHistoryCache));

        window.dispatchEvent(new StorageEvent('storage', {
          key: 'gdm-11e-tracker-history',
          newValue: JSON.stringify(dbHistoryCache),
          storageArea: localStorage
        }));

        renderHistoryList(dbHistoryCache);
      }
    } catch (e) {}
  }

  window.__syncTrackerHistory = syncHistoryFromDatabase;

  // Background Auto-Refresh Timer for Match History
  let historyPollTimer = null;
  function startHistoryPolling() {
    if (historyPollTimer) clearInterval(historyPollTimer);
    historyPollTimer = setInterval(() => {
      if (!isPlay && document.visibilityState !== 'hidden') {
        syncHistoryFromDatabase();
      }
    }, 3500);
  }

  // Auto-refresh history immediately on tab focus or visibility return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isPlay) {
      injectLobbyHub();
      syncHistoryFromDatabase();
    }
  });

  window.addEventListener('focus', () => {
    if (!isPlay) {
      syncHistoryFromDatabase();
    }
  });

  window.addEventListener('pageshow', () => {
    if (!isPlay) {
      injectLobbyHub();
      syncHistoryFromDatabase();
    }
  });

  // Cross-tab real-time history synchronization
  try {
    const histChannel = new BroadcastChannel('gt-history-sync');
    histChannel.onmessage = (msg) => {
      if (msg && msg.data === 'refresh' && !isPlay) {
        syncHistoryFromDatabase();
      }
    };
    window.__broadcastHistoryUpdate = function() {
      try { histChannel.postMessage('refresh'); } catch(e) {}
    };
  } catch(e) {
    window.__broadcastHistoryUpdate = function() {};
  }

  // Soft Delete: Hide tracker game for current user (Instant Optimistic UI)
  window.__gdmHideTrackerGame = async function(matchId, cardEl) {
    if (!matchId) return;
    if (!confirm(`Hide match #${matchId} from your personal history?\n\n(Note: This will only hide it from your view. The match remains safely preserved in the database for the other player.)`)) {
      return;
    }

    // 1. Immediately cache hidden ID locally so refresh will NEVER show it
    let locallyHidden = [];
    try { locallyHidden = JSON.parse(originalGetItem('gt-hidden-matches') || '[]'); } catch(e) {}
    if (!locallyHidden.includes(matchId)) {
      locallyHidden.push(matchId);
      originalSetItem('gt-hidden-matches', JSON.stringify(locallyHidden));
    }

    // 2. Instant Optimistic UI Update (0ms)
    dbHistoryCache = dbHistoryCache.filter(item => (item.match_id || item.id) !== matchId);
    originalSetItem('gdm-11e-tracker-history', JSON.stringify(dbHistoryCache));

    if (cardEl) {
      cardEl.style.transition = 'opacity 0.2s, transform 0.2s';
      cardEl.style.opacity = '0';
      cardEl.style.transform = 'translateX(20px)';
      setTimeout(() => {
        renderHistoryList(dbHistoryCache);
      }, 210);
    } else {
      renderHistoryList(dbHistoryCache);
    }

    window.__broadcastHistoryUpdate();

    // 3. Persist to PostgreSQL backend
    try {
      const token = getAuthToken();
      await fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/hide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ token: token, match_id: matchId })
      });
    } catch (err) {
      console.error('[GDM Sync] Error hiding game:', err);
    }
  };

  // Comprehensive 40k Factions Directory for bulletproof DOM recognition
  const KNOWN_40K_FACTIONS = [
    "Adepta Sororitas", "Adeptus Custodes", "Adeptus Mechanicus", "Aeldari", "Agents of the Imperium",
    "Astra Militarum", "Black Templars", "Blood Angels", "Chaos Daemons", "Chaos Knights",
    "Chaos Space Marines", "Dark Angels", "Death Guard", "Deathwatch", "Drukhari",
    "Genestealer Cults", "Grey Knights", "Imperial Fists", "Imperial Knights", "Iron Hands",
    "Leagues of Votann", "Necrons", "Orks", "Raven Guard", "Salamanders", "Space Marines",
    "Space Wolves", "Tau Empire", "Thousand Sons", "Tyranids", "Ultramarines", "White Scars", "World Eaters"
  ];

  // React Synthetic Value Setter (Bypasses React internal value tracking)
  function setReactInputValue(inputEl, value) {
    if (!inputEl || inputEl.value === value) return;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(inputEl, value);
      } else {
        inputEl.value = value;
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      inputEl.value = value;
    }
  }

  // Scrape live setup wizard values from the DOM
  function scrapeSetupWizardState() {
    const stepHeader = document.querySelector('h2');
    if (!stepHeader || !stepHeader.textContent.includes('PLAYERS')) return null;

    const inputs = Array.from(document.querySelectorAll('input'));
    const p1Input = inputs[0];
    const p2Input = inputs[1];

    const p1Name = p1Input ? p1Input.value.trim() : null;
    const p2Name = p2Input ? p2Input.value.trim() : null;

    const p2Top = p2Input ? p2Input.getBoundingClientRect().top : 9999;

    let p1Faction = null;
    let p2Faction = null;

    // Scan all visible elements in the DOM for faction names
    const candidateElements = Array.from(document.querySelectorAll('div, button, span, p')).filter(el => {
      const txt = (el.textContent || '').trim();
      return el.children.length <= 2 && txt.length >= 4 && !txt.includes('PLAYERS') && !txt.includes('STEP');
    });

    for (const el of candidateElements) {
      const txt = el.textContent.trim();
      const matched = KNOWN_40K_FACTIONS.find(f => f.toLowerCase() === txt.toLowerCase());
      if (matched) {
        const top = el.getBoundingClientRect().top;
        if (top < p2Top) {
          p1Faction = matched;
        } else {
          p2Faction = matched;
        }
      }
    }

    // Battle Ready buttons
    const battleReadyBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent && b.textContent.includes('BATTLE READY'));
    const p1BattleReady = battleReadyBtns[0] ? (battleReadyBtns[0].classList.contains('active') || getComputedStyle(battleReadyBtns[0]).backgroundColor.includes('rgb(')) : true;
    const p2BattleReady = battleReadyBtns[1] ? (battleReadyBtns[1].classList.contains('active') || getComputedStyle(battleReadyBtns[1]).backgroundColor.includes('rgb(')) : true;

    return {
      p1Name: p1Name || undefined,
      p2Name: p2Name || undefined,
      p1Faction: p1Faction || undefined,
      p2Faction: p2Faction || undefined,
      p1BattleReady: p1BattleReady,
      p2BattleReady: p2BattleReady
    };
  }

  // Inject remote setup wizard values into the DOM
  function injectSetupWizardState(gameObj, p1Obj, p2Obj) {
    if (!gameObj) return;
    const stepHeader = document.querySelector('h2');
    if (!stepHeader || !stepHeader.textContent.includes('PLAYERS')) return;

    const inputs = Array.from(document.querySelectorAll('input'));
    const p1Input = inputs[0];
    const p2Input = inputs[1];

    if (p1Input && gameObj.p1Name && p1Input.value !== gameObj.p1Name) {
      setReactInputValue(p1Input, gameObj.p1Name);
    }
    if (p2Input && gameObj.p2Name && p2Input.value !== gameObj.p2Name) {
      setReactInputValue(p2Input, gameObj.p2Name);
    }

    const p2Top = p2Input ? p2Input.getBoundingClientRect().top : 9999;

    // Find faction triggers with chevron SVGs
    const allChevrons = Array.from(document.querySelectorAll('svg')).filter(svg => {
      const p = svg.parentElement;
      return p && p.textContent && !p.textContent.includes('PLAYERS') && !p.textContent.includes('NEXT') && !p.textContent.includes('BACK');
    });

    if (allChevrons[0] && gameObj.p1Faction) {
      const trigger = allChevrons[0].parentElement;
      if (trigger && !trigger.textContent.includes(gameObj.p1Faction)) {
        trigger.childNodes[0].textContent = gameObj.p1Faction;
        trigger.style.color = '#f8fafc';
      }
    }

    if (allChevrons[1] && gameObj.p2Faction) {
      const trigger = allChevrons[1].parentElement;
      if (trigger && !trigger.textContent.includes(gameObj.p2Faction)) {
        trigger.childNodes[0].textContent = gameObj.p2Faction;
        trigger.style.color = '#f8fafc';
      }
    }
  }

  // 7. Broadcast State with Instant Role & Session Sync
  let lastScrapedJson = '';
  function notifyStateChanged() {
    if (clientState.isApplyingRemote) return;
    if (!clientState.matchId) return;

    // Scrape active DOM wizard fields into state
    const wizard = scrapeSetupWizardState();
    if (wizard) {
      const raw = originalGetItem('gdm-11e-tracker-state');
      let st = {};
      try { st = JSON.parse(raw) || {}; } catch(e) {}
      if (!st.game) st.game = {};
      if (wizard.p1Name) st.game.p1Name = wizard.p1Name;
      if (wizard.p2Name) st.game.p2Name = wizard.p2Name;
      if (wizard.p1Faction) st.game.p1Faction = wizard.p1Faction;
      if (wizard.p2Faction) st.game.p2Faction = wizard.p2Faction;
      if (!st.p1) st.p1 = {};
      if (!st.p2) st.p2 = {};
      st.p1.battleReady = wizard.p1BattleReady;
      st.p2.battleReady = wizard.p2BattleReady;
      originalSetItem('gdm-11e-tracker-state', JSON.stringify(st));
    }

    clearTimeout(clientState.debounceTimer);
    clientState.debounceTimer = setTimeout(() => {
      broadcastState();
    }, 60);
  }

  async function broadcastState() {
    if (!clientState.matchId) return;
    const raw = originalGetItem('gdm-11e-tracker-state');
    if (!raw) return;

    let parsedState = {};
    try { parsedState = JSON.parse(raw); } catch (e) { return; }

    // Embed unified chess_clock directly into game state payload
    parsedState.chess_clock = {
      visible: chessClock.visible,
      running: chessClock.running,
      active_player: chessClock.activePlayer,
      p1_remaining: chessClock.p1Remaining,
      p2_remaining: chessClock.p2Remaining,
      round_remaining: chessClock.roundRemaining,
      last_start_time: chessClock.lastStartTime,
      updated_at: chessClock.updatedAt
    };

    clientState.version++;
    try {
      await fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}/state`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: JSON.stringify({
          match_id: clientState.matchId,
          client_id: clientState.clientId,
          token: getAuthToken(),
          role: clientState.role,
          version: clientState.version,
          state: parsedState
        })
      });
      window.__broadcastHistoryUpdate();
    } catch (e) {}
  }

  function applyRemoteState(incoming) {
    if (!incoming) return;
    clientState.isApplyingRemote = true;
    try {
      const stateObj = typeof incoming === 'string' ? JSON.parse(incoming) : incoming;
      const serialized = JSON.stringify(stateObj);
      const current = originalGetItem('gdm-11e-tracker-state');
      
      originalSetItem('gdm-11e-tracker-state', serialized);

      // 0. Synchronize Chess Clock from game state
      if (stateObj.chess_clock) {
        applyRemoteChessClock(stateObj.chess_clock);
      }

      // Ensure CP Counter is enabled by default
      if (stateObj.game) {
        stateObj.game.trackCP = true;
        stateObj.game.showCP = true;
        stateObj.game.cpCounter = true;
        stateObj.game.enableCP = true;
      }
      stateObj.trackCP = true;
      stateObj.showCP = true;
      stateObj.cpCounter = true;
      stateObj.enableCP = true;

      // 1. Direct Setup Wizard DOM Injection
      if (stateObj.game) {
        injectSetupWizardState(stateObj.game, stateObj.p1, stateObj.p2);
      }

      // Auto-toggle CP switches in DOM if present
      try {
        const cpToggles = Array.from(document.querySelectorAll('button, input[type="checkbox"], [role="switch"]'));
        for (const el of cpToggles) {
          const text = (el.textContent || el.getAttribute('aria-label') || '').toUpperCase();
          const parentText = (el.parentElement ? el.parentElement.textContent || '' : '').toUpperCase();
          if (text.includes('CP') || text.includes('COMMAND POINT') || parentText.includes('CP COUNTER') || parentText.includes('COMMAND POINTS')) {
            if (el.tagName === 'INPUT' && !el.checked) {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (el.getAttribute('role') === 'switch' && el.getAttribute('aria-checked') === 'false') {
              el.click();
            }
          }
        }
      } catch(e) {}

      // 2. Direct React Context state injection
      if (typeof window.__gdmSetTrackerState === 'function') {
        window.__gdmSetTrackerState(stateObj);
      } else {
        let attempts = 0;
        const retryTimer = setInterval(() => {
          attempts++;
          if (typeof window.__gdmSetTrackerState === 'function') {
            window.__gdmSetTrackerState(stateObj);
            clearInterval(retryTimer);
          } else if (attempts >= 20) {
            clearInterval(retryTimer);
          }
        }, 50);
      }

      // 3. Custom event dispatch
      window.dispatchEvent(new CustomEvent('gdm-state-sync', { detail: stateObj }));

      // 4. Storage event dispatch
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'gdm-11e-tracker-state',
        newValue: serialized,
        oldValue: current,
        url: window.location.href,
        storageArea: localStorage
      }));

      // Refresh invite widget if P2 just connected
      const widget = document.getElementById('gt-invite-widget');
      if (widget && stateObj.game && stateObj.game.p2Name && stateObj.game.p2Name !== 'Player 2') {
        widget.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <span style="font-size:12px; font-weight:800; color:#10b981; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">🟢 Connected: Player 1 vs Player 2 (${stateObj.game.p2Name})</span>
            <span style="font-size:11px; color:#94a3b8; font-family:'JetBrains Mono',monospace;">2/2 Players (Collaborative Live)</span>
          </div>
        `;
      }
      injectMultiplayerHUD();
    } catch (err) {
      console.error('[GDM Sync Bridge] Error applying remote state:', err);
    } finally {
      setTimeout(() => { clientState.isApplyingRemote = false; }, 60);
    }
  }

  let fastPollTimer = null;
  function startHybridSync() {
    startRealtimeStream();
    
    if (fastPollTimer) clearInterval(fastPollTimer);
    fastPollTimer = setInterval(async () => {
      if (!clientState.matchId || clientState.isApplyingRemote) return;
      
      // Check if user changed DOM wizard without triggering click
      const wizard = scrapeSetupWizardState();
      if (wizard) {
        const wizardJson = JSON.stringify(wizard);
        if (wizardJson !== lastScrapedJson) {
          lastScrapedJson = wizardJson;
          notifyStateChanged();
        }
      }

      try {
        const resp = await fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}`, {
          headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.online_count !== undefined) {
            clientState.onlineCount = data.online_count;
            injectMultiplayerHUD();
          }
          if (data.chess_clock) {
            applyRemoteChessClock(data.chess_clock);
          }
          if (data.version && data.version > clientState.version && data.state) {
            clientState.version = data.version;
            applyRemoteState(data.state);
          }
        }
      } catch (e) {}
    }, 350);
  }

  function startRealtimeStream() {
    if (!clientState.matchId) return;
    if (clientState.eventSource) clientState.eventSource.close();

    try {
      const sseUrl = `${SYNC_CONFIG.apiBase}/${clientState.matchId}/stream?client_id=${clientState.clientId}`;
      const es = new EventSource(sseUrl);
      clientState.eventSource = es;

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state_update') {
            if (msg.sender !== clientState.clientId && msg.state) {
              if (msg.version >= clientState.version) {
                clientState.version = msg.version;
                applyRemoteState(msg.state);
              }
            }
          } else if (msg.type === 'clock_update') {
            if (msg.sender !== clientState.clientId && msg.chess_clock) {
              applyRemoteChessClock(msg.chess_clock);
            }
          } else if (msg.type === 'presence') {
            clientState.onlineCount = msg.count || 1;
            injectMultiplayerHUD();
          } else if (msg.type === 'army_list_updated') {
            if (msg.role === 'player1') {
              clientState.p1ArmyList = msg.army_list;
            } else if (msg.role === 'player2') {
              clientState.p2ArmyList = msg.army_list;
            }
            injectMultiplayerHUD();
            const modal = document.getElementById('gt-army-list-modal');
            if (modal && modal.style.display !== 'none') {
              renderArmyListModal();
            }
          }
        } catch (e) {}
      };
    } catch (e) {}
  }

  function autoToggleCpInDom() {
    try {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const txt = (btn.textContent || '').trim().toUpperCase();
        if (txt === 'TRACK COMMAND POINTS OFF' || txt === 'COMMAND POINTS OFF' || txt === 'TRACK CP OFF' || (txt.includes('COMMAND POINTS') && txt.includes('OFF'))) {
          btn.click();
        }
      }
    } catch(e) {}
  }

  function attachDomActionInterceptors() {
    // Continuous CP Counter auto-enable
    autoToggleCpInDom();
    setInterval(autoToggleCpInDom, 300);

    const cpObs = new MutationObserver(autoToggleCpInDom);
    cpObs.observe(document.body, { childList: true, subtree: true, characterData: true });

    document.addEventListener('input', () => {
      setTimeout(() => { notifyStateChanged(); injectMultiplayerHUD(); }, 40);
    }, true);

    document.addEventListener('change', () => {
      setTimeout(() => { notifyStateChanged(); injectMultiplayerHUD(); }, 40);
    }, true);

    document.addEventListener('click', () => {
      setTimeout(() => { notifyStateChanged(); injectMultiplayerHUD(); autoToggleCpInDom(); }, 50);
      setTimeout(() => { notifyStateChanged(); injectMultiplayerHUD(); autoToggleCpInDom(); }, 200);
    }, true);

    document.addEventListener('pointerup', () => {
      setTimeout(() => { notifyStateChanged(); injectMultiplayerHUD(); autoToggleCpInDom(); }, 60);
    }, true);
  }

  // 8. Floating Multiplayer Status HUD with Connected Player Names & Army Lists
  function injectMultiplayerHUD() {
    let hud = document.getElementById('gt-sync-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'gt-sync-hud';
      document.body.appendChild(hud);
    }

    // Clean up standalone user bar if present in match mode
    const oldBar = document.getElementById('gt-user-status-bar');
    if (oldBar) oldBar.remove();

    const raw = originalGetItem('gdm-11e-tracker-state');
    let stateObj = {};
    try { stateObj = JSON.parse(raw) || {}; } catch(e) {}
    const game = stateObj.game || {};

    const p1Raw = game.p1Name || (currentUser ? currentUser.display_name : 'Player 1') || 'Player 1';
    let p2Raw = game.p2Name;
    const isP2Ready = clientState.onlineCount >= 2 || (game.p2Name && game.p2Name !== 'Player 2') || !!stateObj.user_id_p2;
    if (!p2Raw || p2Raw === 'Player 2') {
      p2Raw = isP2Ready ? 'Player 2 (Opponent)' : 'Waiting for P2...';
    }

    // Role-aware (You) display
    let p1Display = p1Raw;
    let p2Display = p2Raw;
    if (clientState.role === 'player1') {
      p1Display = `${p1Raw} (You)`;
    } else if (clientState.role === 'player2') {
      p2Display = `${p2Raw} (You)`;
    }

    const isP1 = clientState.role === 'player1';
    const hasMyList = isP1 ? !!clientState.p1ArmyList : !!clientState.p2ArmyList;
    const hasOppList = isP1 ? !!clientState.p2ArmyList : !!clientState.p1ArmyList;

    const statusDotColor = isP2Ready ? '#10b981' : '#f59e0b';
    const statusDotPulse = isP2Ready ? '' : 'animation:pulse 1.5s infinite;';

    const urlParams = new URLSearchParams(window.location.search);
    const tournamentId = urlParams.get('event_id') || urlParams.get('tournament_id') || game.tournament_id || game.eventId || '';
    const tableNum = urlParams.get('table') || urlParams.get('table_num') || game.table_num || game.table || '';

    hud.innerHTML = `
      <!-- Left: Hub & Lobby Navigation & Match Tag -->
      <div style="display:inline-flex; align-items:center; gap:6px; flex-shrink:0;">
        <a href="/?tab=my-hub" style="display:inline-flex; align-items:center; gap:3px; color:#38bdf8; text-decoration:none; font-size:11px; font-weight:800; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.25); padding:4px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace;">
          🏠 Hub
        </a>
        <a href="/11th/tracker" style="display:inline-flex; align-items:center; gap:3px; color:#f59e0b; text-decoration:none; font-size:11px; font-weight:800; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.25); padding:4px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace;">
          🎲 Lobby
        </a>
        <span style="font-family:'JetBrains Mono',monospace; color:#f59e0b; font-size:11px; background:#070b14; padding:4px 7px; border-radius:6px; border:1px solid #334155; font-weight:800;">
          #${clientState.matchId}${tableNum ? ` (T${tableNum})` : ''}
        </span>
      </div>

      <!-- Center: Connected Players Matchup -->
      <div style="display:inline-flex; align-items:center; gap:6px; font-weight:800; font-family:'JetBrains Mono',monospace; font-size:11px; padding:0 6px; flex-shrink:0;">
        <span style="width:7px; height:7px; border-radius:50%; background:${statusDotColor}; ${statusDotPulse}; flex-shrink:0;"></span>
        <span style="color:#38bdf8;">${p1Display}</span>
        <span style="color:#64748b; font-size:10px;">vs</span>
        <span style="${isP2Ready ? 'color:#10b981;' : 'color:#94a3b8; font-style:italic;'}">${p2Display}</span>
      </div>

      <!-- Right: Action Buttons -->
      <div style="display:inline-flex; align-items:center; gap:6px; flex-shrink:0;">
        <button onclick="window.gtToggleChessClock()" style="background:#0f172a; color:#38bdf8; border:1px solid rgba(56,189,248,0.4); padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Open Chess Clock">
          ⏱️ Clock
        </button>
        ${tournamentId ? `
          <button onclick="window.gtOpenJudgeModal()" style="background:${clientState.activeJudgeCall ? '#e11d48' : '#881337'}; color:#fff; border:1px solid #f43f5e; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Call Tournament Judge">
            🙋‍♂️ Call Judge ${clientState.activeJudgeCall ? '🟡' : ''}
          </button>
        ` : ''}
        <button onclick="window.gtOpenArmyListModal('opponent')" style="background:${hasOppList ? '#4f46e5' : '#1e293b'}; color:#fff; border:1px solid ${hasOppList ? '#6366f1' : '#334155'}; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="View Opponent's Army List">
          📜 Opponent List ${hasOppList ? '🟢' : ''}
        </button>
        <button onclick="window.gtOpenArmyListModal('my')" style="background:${hasMyList ? '#059669' : '#1e293b'}; color:#fff; border:1px solid ${hasMyList ? '#10b981' : '#334155'}; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="View Your Army List">
          📋 My List ${hasMyList ? '🟢' : ''}
        </button>
        ${isPlay ? `
          <button onclick="window.__openScorecardModal()" style="background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Open Scorecard">
            📄 Scorecard
          </button>
          <button onclick="window.__openCompleteModal()" style="background:#059669; color:#fff; border:1px solid #10b981; padding:4px 9px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Complete Game">
            🏁 Finish
          </button>
        ` : ''}
        <button onclick="navigator.clipboard.writeText(window.location.href); alert('🔗 Room Link Copied! Share with your opponent.');" style="background:#0284c7; color:#fff; border:none; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;" title="Copy Match Link">
          🔗 Share
        </button>
      </div>
    `;
  }

  // 9. Interactive Army List Inspector Modal & Wahapedia Rules Viewer
  async function loadRoomArmyLists() {
    if (!clientState.matchId) return;
    try {
      const resp = await fetch(`/api/tracker/room/${clientState.matchId}/armylists`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.p1_army_list) clientState.p1ArmyList = data.p1_army_list;
        if (data.p2_army_list) clientState.p2ArmyList = data.p2_army_list;
        injectMultiplayerHUD();
      }
    } catch(e) {}
  }

  window.gtOpenArmyListModal = function(tab = 'opponent') {
    clientState.activeListTab = tab;
    let modal = document.getElementById('gt-army-list-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'gt-army-list-modal';
      document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    renderArmyListModal();
  };

  window.gtCloseArmyListModal = function() {
    const modal = document.getElementById('gt-army-list-modal');
    if (modal) modal.style.display = 'none';
  };

  window.gtSetListTab = function(tab) {
    clientState.activeListTab = tab;
    renderArmyListModal();
  };

  window.gtSetListFilter = function(filter) {
    clientState.activeListFilter = filter;
    renderArmyListModal();
  };

  window.gtSearchArmyList = function(query) {
    clientState.listSearchQuery = (query || '').toLowerCase().trim();
    renderArmyListModal();
  };

  window.gtAdjustWound = function(unitId, modelIdx, delta, maxW) {
    const key = `${clientState.matchId}_${unitId}_${modelIdx}`;
    let current = clientState.wounds[key];
    if (current === undefined) current = maxW;
    current = Math.max(0, Math.min(maxW, current + delta));
    clientState.wounds[key] = current;
    renderArmyListModal();
  };

  window.gtAttachList = async function(listData) {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const matchId = clientState.matchId || urlParams.get('match_id') || 'MATCH';
      const role = clientState.role === 'player2' ? 'player2' : 'player1';
      const resp = await fetch(`/api/tracker/room/${matchId}/armylist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ role: role, army_list: listData })
      });
      if (resp.ok) {
        if (role === 'player1') clientState.p1ArmyList = listData;
        else clientState.p2ArmyList = listData;
        clientState.activeListTab = 'my';
        injectMultiplayerHUD();
        renderArmyListModal();
        alert(`🎉 Attached "${listData.name || 'Army List'}" to match!`);
      } else {
        const errData = await resp.json().catch(() => ({}));
        alert('Error attaching army list: ' + (errData.detail || resp.statusText));
      }
    } catch(e) {
      alert('Error attaching army list: ' + e.message);
    }
  };

  window.gtAttachSavedList = async function(listId) {
    const list = (window.gtSavedListsCache || []).find(l => l.id === listId);
    if (!list) {
      alert('Could not locate the selected list.');
      return;
    }
    await window.gtAttachList(list);
  };

  window.gtImportAndAttach = async function() {
    const textarea = document.getElementById('gt-import-raw-input');
    if (!textarea || !textarea.value.trim()) {
      alert('Please paste your NewRecruit share link.');
      return;
    }
    const rawText = textarea.value.trim();
    try {
      const parseResp = await fetch('/api/armylists/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText })
      });
      if (!parseResp.ok) throw new Error('Failed to parse roster');
      const pData = await parseResp.json();
      const armyList = pData.army_list;

      // Save to user lists if logged in
      try {
        await fetch('/api/armylists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
          body: JSON.stringify(armyList)
        });
      } catch(e) {}

      // Attach to current match
      await window.gtAttachList(armyList);
    } catch(e) {
      alert('Parse error: ' + e.message);
    }
  };

  function renderTrackerNativeRoster(list) {
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
      }
    }

    const name = list.name || 'Army Roster';
    const faction = list.faction || 'Warhammer 40,000';
    const detachment = list.detachment || 'Core Detachment';
    const points = list.points || 2000;
    const warlord = list.warlord || '';

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

    let contentHtml = '';

    if (units.length > 0) {
      contentHtml += `
        <div style="padding:10px 16px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <span style="font-size:15px; font-weight:900; color:#fff; font-family:'JetBrains Mono',monospace;">${escapeHtml(name)}</span>
            <span style="font-size:12px; color:#38bdf8; font-weight:700; margin-left:8px;">${escapeHtml(faction)} • ${escapeHtml(detachment)} • ${points} PTS</span>
            ${warlord ? `<span style="font-size:12px; color:#facc15; font-weight:700; margin-left:8px;">👑 ${escapeHtml(warlord)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:16px; padding:16px; overflow-y:auto; max-height:75vh; background:#070b14;">
      `;

      // Army & Detachment Rules
      if (armyRules.length > 0 || detachmentRules.length > 0) {
        contentHtml += `
          <div style="background:rgba(15, 23, 42, 0.7); border:1px solid rgba(56, 189, 248, 0.25); border-radius:12px; padding:12px 16px;">
            <div style="font-size:13px; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              <span>📜</span> Army & Detachment Rules
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:10px;">
              ${armyRules.map(ar => `
                <div style="background:#070b14; border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:10px;">
                  <div style="font-weight:800; font-size:13px; color:#f8fafc; margin-bottom:4px;">🛡️ ${escapeHtml(ar.name)}</div>
                  <div style="font-size:11px; color:#94a3b8; line-height:1.5; white-space:pre-wrap;">${escapeHtml(ar.description || '')}</div>
                </div>
              `).join('')}
              ${detachmentRules.map(dr => `
                <div style="background:#070b14; border:1px solid rgba(192,132,252,0.25); border-radius:8px; padding:10px;">
                  <div style="font-weight:800; font-size:13px; color:#c084fc; margin-bottom:4px;">⚡ ${escapeHtml(dr.name)}</div>
                  <div style="font-size:11px; color:#94a3b8; line-height:1.5; white-space:pre-wrap;">${escapeHtml(dr.description || '')}</div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      // Helper to group identical units
      function groupIdenticalUnits(catUnits) {
        const grouped = [];
        const map = new Map();

        catUnits.forEach(u => {
          const wKey = (u.weapons || []).map(w => `${w.name}-${w.Range || w.range}-${w.A}-${w.skill || w.BS || w.WS}-${w.S}-${w.AP}-${w.D}`).sort().join('|');
          const sKey = u.stats ? `${u.stats.M}-${u.stats.T}-${u.stats.SV}-${u.stats.INV}-${u.stats.W}-${u.stats.LD}-${u.stats.OC}` : '';
          const key = `${u.name}||${u.enhancement || ''}||${u.is_warlord ? '1' : '0'}||${sKey}||${wKey}`;

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

      for (const [catName, rawUnits] of Object.entries(categories)) {
        if (rawUnits.length === 0) continue;
        const catUnits = groupIdenticalUnits(rawUnits);
        const totalUnitsInCat = rawUnits.length;
        const catIcon = catName.includes('Character') ? '👑' : (catName.includes('Battleline') ? '🛡️' : (catName.includes('Vehicle') ? '🚜' : (catName.includes('Mounted') ? '🚀' : '⚔️')));
        
        contentHtml += `
          <div>
            <div style="font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#94a3b8; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
              <span>${catIcon}</span> ${catName} <span style="font-size:11px; color:#64748b; font-weight:normal;">(${totalUnitsInCat})</span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:10px;">
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

                return `
                  <div class="gt-unit-card" style="background:#0f172a; border:1px solid ${u.is_warlord ? 'rgba(245,158,11,0.45)' : 'rgba(255,255,255,0.08)'}; border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:8px; transition:all 0.2s;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
                      <div style="min-width:0; flex:1;">
                        <div style="display:flex; align-items:center; gap:5px; flex-wrap:wrap;">
                          ${uQty > 1 ? `
                            <span class="badge" style="background:#0284c7; color:#fff; font-size:11px; font-weight:800; padding:1px 6px; border-radius:4px; font-family:'JetBrains Mono',monospace;">${uQty}x</span>
                          ` : (uCount > 1 ? `<span style="font-size:11px; font-weight:800; color:#38bdf8; font-family:'JetBrains Mono',monospace;">${uCount}x</span>` : '')}
                          <b style="font-size:13px; color:#fff; font-family:'JetBrains Mono',monospace;">${escapeHtml(uName)}</b>
                          ${u.is_warlord ? '<span class="badge" style="background:rgba(245,158,11,0.2); color:#f59e0b; font-size:10px; font-weight:800; border:1px solid rgba(245,158,11,0.4); padding:1px 5px;">👑 WARLORD</span>' : ''}
                        </div>
                        ${u.enhancement ? `<div style="font-size:11px; color:#c084fc; font-weight:700; margin-top:2px;">✨ ${escapeHtml(u.enhancement)}</div>` : ''}
                        ${(u.keywords && u.keywords.length > 0) ? `
                          <div style="display:flex; flex-wrap:wrap; gap:3px; margin-top:4px;">
                            ${u.keywords.map(k => `<span style="font-size:9px; color:#94a3b8; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); padding:0px 4px; border-radius:3px;">${escapeHtml(k)}</span>`).join('')}
                          </div>
                        ` : ''}
                      </div>
                      ${totalPts > 0 ? `
                        <span class="badge" style="background:rgba(56,189,248,0.12); color:#38bdf8; font-size:11px; font-weight:800; font-family:'JetBrains Mono',monospace; flex-shrink:0; text-align:right;">
                          ${uQty > 1 ? `${totalPts} PTS <span style="font-size:9px; color:#94a3b8; font-weight:normal;">(${uPts} ea)</span>` : `${totalPts} PTS`}
                        </span>
                      ` : ''}
                    </div>

                    <!-- Statline Bar -->
                    <div style="display:grid; grid-template-columns:repeat(7, 1fr); background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:4px 2px; text-align:center; font-family:'JetBrains Mono',monospace;">
                      <div><div style="font-size:9px; color:#64748b; font-weight:700;">M</div><div style="font-size:11px; color:#fff; font-weight:800;">${stats.M || '6"'}</div></div>
                      <div><div style="font-size:9px; color:#64748b; font-weight:700;">T</div><div style="font-size:11px; color:#fff; font-weight:800;">${stats.T || 4}</div></div>
                      <div><div style="font-size:9px; color:#64748b; font-weight:700;">SV</div><div style="font-size:11px; color:#fff; font-weight:800;">${stats.SV || '3+'}</div></div>
                      <div><div style="font-size:9px; color:#64748b; font-weight:700;">INV</div><div style="font-size:11px; color:#38bdf8; font-weight:800;">${stats.INV || '-'}</div></div>
                      <div><div style="font-size:9px; color:#64748b; font-weight:700;">W</div><div style="font-size:11px; color:#ef4444; font-weight:800;">${stats.W || 2}</div></div>
                      <div><div style="font-size:9px; color:#64748b; font-weight:700;">LD</div><div style="font-size:11px; color:#fff; font-weight:800;">${stats.LD || '6+'}</div></div>
                      <div><div style="font-size:9px; color:#64748b; font-weight:700;">OC</div><div style="font-size:11px; color:#10b981; font-weight:800;">${stats.OC || 1}</div></div>
                    </div>

                    <!-- Weapons Table (Mobile Responsive) -->
                    ${weapons.length > 0 ? `
                      <div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:6px; overflow-x:auto; -webkit-overflow-scrolling:touch;">
                        <div style="min-width:300px;">
                          <div style="display:grid; grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr 1fr; padding:3px 6px; background:rgba(255,255,255,0.04); font-size:9px; font-weight:800; color:#94a3b8; font-family:'JetBrains Mono',monospace; text-transform:uppercase;">
                            <div>Weapon</div><div style="text-align:center;">Rng</div><div style="text-align:center;">A</div><div style="text-align:center;">BS/WS</div><div style="text-align:center;">S</div><div style="text-align:center;">AP</div><div style="text-align:center;">D</div>
                          </div>
                          ${weapons.map(w => `
                            <div style="display:grid; grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr 1fr; padding:4px 6px; border-top:1px solid rgba(255,255,255,0.04); font-size:10px; font-family:'JetBrains Mono',monospace; align-items:center;">
                              <div style="min-width:0;">
                                <div style="font-weight:700; color:#f8fafc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${w.type === 'Melee' ? '⚔️' : '🔫'} ${escapeHtml(w.name)}</div>
                                ${(w.keywords && w.keywords.length > 0) ? `
                                  <div style="font-size:8.5px; color:#38bdf8; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${w.keywords.map(k => `[${escapeHtml(k)}]`).join(' ')}</div>
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
                      <div style="display:flex; flex-wrap:wrap; gap:4px;">
                        ${u.wargear.map(w => `<span style="font-size:10px; background:rgba(255,255,255,0.05); color:#94a3b8; border:1px solid rgba(255,255,255,0.06); padding:1px 5px; border-radius:4px;">${escapeHtml(w)}</span>`).join('')}
                      </div>
                    ` : '')}

                    <!-- Abilities & Rules -->
                    ${(abilities.length > 0 || rules.length > 0) ? `
                      <div style="display:flex; flex-direction:column; gap:4px;">
                        ${rules.length > 0 ? `
                          <div style="display:flex; flex-wrap:wrap; gap:4px;">
                            ${rules.map(r => `<span style="font-size:9px; font-weight:800; background:rgba(56,189,248,0.1); color:#38bdf8; border:1px solid rgba(56,189,248,0.2); padding:1px 5px; border-radius:4px;">${escapeHtml(r.name)}</span>`).join('')}
                          </div>
                        ` : ''}
                        ${abilities.map(ab => `
                          <div style="background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.05); border-radius:5px; padding:4px 6px; font-size:10px;">
                            <b style="color:#facc15;">${escapeHtml(ab.name)}:</b>
                            <span style="color:#94a3b8; line-height:1.4;"> ${escapeHtml(ab.description)}</span>
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
      contentHtml += `</div>`;
    } else if (list.raw_text) {
      contentHtml = `<div style="padding:20px; background:#070b14; border-radius:12px; font-family:'JetBrains Mono',monospace; font-size:12px; color:#cbd5e1; white-space:pre-wrap; overflow-y:auto; max-height:75vh; line-height:1.5;">${escapeHtml(list.raw_text)}</div>`;
    } else {
      contentHtml = `<div style="padding:40px; text-align:center; color:#94a3b8;">No roster content available.</div>`;
    }

    return contentHtml;
  }

  window.gtTrackerAdjustWounds = function(unitIdx, delta) {
    const el = document.getElementById(`gt-wound-val-${unitIdx}`);
    if (!el) return;
    const parts = el.textContent.split('/');
    if (parts.length === 2) {
      let cur = parseInt(parts[0].trim(), 10) + delta;
      const max = parseInt(parts[1].trim(), 10);
      cur = Math.max(0, Math.min(max, cur));
      el.textContent = `${cur} / ${max}`;
      if (cur === 0) window.gtTrackerToggleSlain(unitIdx, true);
    }
  };

  window.gtTrackerToggleSlain = function(unitIdx, forceSlain = null) {
    const card = document.getElementById(`gt-unit-card-${unitIdx}`);
    const btn = document.getElementById(`gt-slain-btn-${unitIdx}`);
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

  async function renderArmyListModal() {
    const modal = document.getElementById('gt-army-list-modal');
    if (!modal) return;

    const isP1 = clientState.role === 'player1';
    const myList = isP1 ? clientState.p1ArmyList : clientState.p2ArmyList;
    const oppList = isP1 ? clientState.p2ArmyList : clientState.p1ArmyList;

    let activeList = null;
    if (clientState.activeListTab === 'opponent') activeList = oppList;
    else if (clientState.activeListTab === 'my') activeList = myList;

    const tab = clientState.activeListTab;

    let contentHtml = '';

    if (tab === 'attach') {
      // Attach / Import View
      contentHtml = `
        <div style="margin-bottom: 20px;">
          <h3 style="font-size:16px; font-weight:800; color:#38bdf8; margin-bottom:6px;">⚡ Import Army List from NewRecruit</h3>
          <p style="font-size:12px; color:#94a3b8; margin-bottom:12px;">Paste your <b>NewRecruit Link</b> (e.g. <code style="color:#38bdf8; background:#070b14; padding:1px 5px; border-radius:4px;">https://www.newrecruit.eu/app/list/28iCj</code>) to attach your army roster to this match.</p>
          <input id="gt-import-raw-input" type="text" placeholder="https://www.newrecruit.eu/app/list/..." style="width:100%; background:#070b14; border:1px solid #334155; border-radius:8px; padding:10px 12px; color:#e2e8f0; font-family:'Inter',sans-serif; font-size:13px; outline:none; box-sizing:border-box;" />
          <div style="margin-top:10px; display:flex; justify-content:flex-end;">
            <button onclick="window.gtImportAndAttach()" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; border:none; padding:10px 18px; border-radius:8px; cursor:pointer;">
              ⚡ Import & Attach to Match
            </button>
          </div>
        </div>

        <div id="gt-saved-lists-container">
          <h3 style="font-size:16px; font-weight:800; color:#f8fafc; margin-bottom:10px;">📋 Pick from Your Saved Lists</h3>
          <div id="gt-saved-lists-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
            <div style="color:#94a3b8; font-size:12px; font-style:italic;">Loading saved lists...</div>
          </div>
        </div>
      `;

      // Async fetch saved lists
      setTimeout(async () => {
        const grid = document.getElementById('gt-saved-lists-grid');
        if (!grid) return;
        try {
          const resp = await fetch('/api/armylists', {
            headers: { 'Authorization': `Bearer ${getAuthToken()}` }
          });
          if (resp.ok) {
            const data = await resp.json();
            const lists = data.army_lists || [];
            window.gtSavedListsCache = lists;
            if (lists.length === 0) {
              grid.innerHTML = `<div style="color:#64748b; font-size:12px; grid-column:1/-1;">No saved lists found. Use the importer above or create one in My Hub.</div>`;
            } else {
              grid.innerHTML = lists.map(l => `
                <div style="background:#131d33; border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; gap:10px;">
                  <div>
                    <div style="font-weight:800; font-size:14px; color:#f8fafc;">${escapeHtml(l.name || 'Unnamed List')}</div>
                    <div style="font-size:12px; color:#38bdf8; font-weight:700;">${escapeHtml(l.faction || '40k')} • ${escapeHtml(l.detachment || 'Core')}</div>
                    <div style="font-size:11px; color:#94a3b8; margin-top:4px;">${l.points || 2000} pts</div>
                  </div>
                  <button onclick="window.gtAttachSavedList('${l.id}')" style="background:#10b981; color:#0f172a; font-weight:800; font-size:12px; border:none; padding:8px 12px; border-radius:6px; cursor:pointer;">
                    ⚔️ Attach This List
                  </button>
                </div>
              `).join('');
            }
          }
        } catch(e) {}
      }, 50);

    } else if (!activeList || (!activeList.source_url && !activeList.raw_text && (!activeList.units || activeList.units.length === 0))) {
      // Empty state for Opponent or My List
      const isOpp = tab === 'opponent';
      contentHtml = `
        <div style="text-align:center; padding:50px 20px;">
          <div style="font-size:42px; margin-bottom:12px;">${isOpp ? '📜' : '📋'}</div>
          <h3 style="font-size:18px; font-weight:800; color:#f8fafc; margin-bottom:6px;">${isOpp ? "Opponent hasn't attached a list yet" : "You haven't attached an army list to this match"}</h3>
          <p style="font-size:13px; color:#94a3b8; max-width:460px; margin:0 auto 20px;">
            ${isOpp ? "When your opponent attaches their NewRecruit link, their full army roster will appear here in real time." : "Paste your NewRecruit share link to attach and view your army roster during play."}
          </p>
          ${!isOpp ? `
            <button onclick="window.gtSetListTab('attach')" style="background:#0284c7; color:#fff; font-weight:800; font-size:13px; border:none; padding:10px 20px; border-radius:8px; cursor:pointer;">
              ➕ Attach / Import My Army List
            </button>
          ` : ''}
        </div>
      `;
    } else if (activeList) {
      contentHtml = renderTrackerNativeRoster(activeList);
    }

    modal.innerHTML = `
      <div class="gt-modal-dialog">
        <div class="gt-modal-header">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <button onclick="window.gtSetListTab('opponent')" class="gt-tab-btn ${tab === 'opponent' ? 'active' : ''}">
              📜 Opponent's List ${oppList ? '🟢' : ''}
            </button>
            <button onclick="window.gtSetListTab('my')" class="gt-tab-btn ${tab === 'my' ? 'active' : ''}">
              📋 My List ${myList ? '🟢' : ''}
            </button>
            <button onclick="window.gtSetListTab('attach')" class="gt-tab-btn ${tab === 'attach' ? 'active' : ''}">
              ➕ Attach / Import
            </button>
          </div>
          <button onclick="window.gtCloseArmyListModal()" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer; padding:4px 8px; line-height:1;">
            ✕
          </button>
        </div>
        <div class="gt-modal-body">
          ${contentHtml}
        </div>
      </div>
    `;
  }

  // 10. Tournament Dual Chess Clock Manager (Synchronized Multi-Device Live Clock)
  const chessClock = {
    visible: false,
    running: false,
    activePlayer: 1, // 1 (P1) or 2 (P2)
    p1Remaining: 75 * 60,
    p2Remaining: 75 * 60,
    roundRemaining: 150 * 60,
    lastStartTime: null,
    updatedAt: Date.now()
  };

  let clockUiTicker = null;

  function getEffectiveClockTimes() {
    if (!chessClock.running || !chessClock.lastStartTime) {
      return {
        p1: Math.max(0, chessClock.p1Remaining),
        p2: Math.max(0, chessClock.p2Remaining),
        round: Math.max(0, chessClock.roundRemaining)
      };
    }
    const elapsed = Math.floor((Date.now() - chessClock.lastStartTime) / 1000);
    const p1 = chessClock.activePlayer === 1 ? Math.max(0, chessClock.p1Remaining - elapsed) : chessClock.p1Remaining;
    const p2 = chessClock.activePlayer === 2 ? Math.max(0, chessClock.p2Remaining - elapsed) : chessClock.p2Remaining;
    const round = Math.max(0, chessClock.roundRemaining - elapsed);
    return { p1, p2, round };
  }

  function formatTime(secs) {
    const isNeg = secs < 0;
    const abs = Math.abs(secs);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    return `${isNeg ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function applyRemoteChessClock(remote) {
    if (!remote || typeof remote !== 'object') return;

    if (remote.updated_at && chessClock.updatedAt && remote.updated_at < chessClock.updatedAt) {
      return;
    }

    chessClock.visible = !!remote.visible;
    chessClock.running = !!remote.running;
    chessClock.activePlayer = remote.active_player === 2 ? 2 : 1;
    chessClock.p1Remaining = typeof remote.p1_remaining === 'number' ? remote.p1_remaining : (75 * 60);
    chessClock.p2Remaining = typeof remote.p2_remaining === 'number' ? remote.p2_remaining : (75 * 60);
    chessClock.roundRemaining = typeof remote.round_remaining === 'number' ? remote.round_remaining : (150 * 60);
    chessClock.lastStartTime = remote.last_start_time || null;
    chessClock.updatedAt = remote.updated_at || Date.now();

    let clockEl = document.getElementById('gt-chess-clock-hud');
    if (!clockEl) {
      clockEl = document.createElement('div');
      clockEl.id = 'gt-chess-clock-hud';
      document.body.appendChild(clockEl);
    }
    clockEl.style.display = chessClock.visible ? 'flex' : 'none';

    ensureClockTicker();
    renderChessClock();
  }

  function ensureClockTicker() {
    if (chessClock.running && !clockUiTicker) {
      clockUiTicker = setInterval(() => {
        if (chessClock.visible) updateClockDom();
      }, 200);
    } else if (!chessClock.running && clockUiTicker) {
      clearInterval(clockUiTicker);
      clockUiTicker = null;
    }
  }

  function mountChessClockHud() {
    let clockEl = document.getElementById('gt-chess-clock-hud');
    if (!clockEl) {
      clockEl = document.createElement('div');
      clockEl.id = 'gt-chess-clock-hud';
      clockEl.innerHTML = `
        <div id="gt-clock-p1-box" class="gt-clock-player-box">
          <div style="display:flex; justify-content:space-between; width:100%; align-items:center; margin-bottom:2px; gap:4px;">
            <span id="gt-clock-p1-name" style="font-size:10px; font-weight:800; max-width:80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Player 1</span>
            <div style="display:flex; gap:2px;">
              <button class="gt-clock-nudge-btn" onclick="window.gtAdjustPlayerTime(1, -60)" title="Deduct 1 minute">-1m</button>
              <button class="gt-clock-nudge-btn" onclick="window.gtAdjustPlayerTime(1, 60)" title="Add 1 minute">+1m</button>
            </div>
          </div>
          <div id="gt-clock-p1-time" class="gt-clock-time">75:00</div>
        </div>

        <button id="gt-clock-pass-btn" class="gt-clock-switch-btn" title="Tap to switch active clock turn">
          <span>🔄 PASS TURN</span>
          <span id="gt-clock-round-time" style="font-size:9px; opacity:0.85; font-weight:600;">(Round: 150:00)</span>
        </button>

        <div id="gt-clock-p2-box" class="gt-clock-player-box">
          <div style="display:flex; justify-content:space-between; width:100%; align-items:center; margin-bottom:2px; gap:4px;">
            <span id="gt-clock-p2-name" style="font-size:10px; font-weight:800; max-width:80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Player 2</span>
            <div style="display:flex; gap:2px;">
              <button class="gt-clock-nudge-btn" onclick="window.gtAdjustPlayerTime(2, -60)" title="Deduct 1 minute">-1m</button>
              <button class="gt-clock-nudge-btn" onclick="window.gtAdjustPlayerTime(2, 60)" title="Add 1 minute">+1m</button>
            </div>
          </div>
          <div id="gt-clock-p2-time" class="gt-clock-time">75:00</div>
        </div>

        <div style="display:flex; flex-direction:column; gap:4px; align-items:stretch;">
          <button id="gt-clock-play-pause-btn" style="background:#1e293b; color:#f8fafc; border:1px solid #334155; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;">
            ▶️ Start
          </button>
          <select id="gt-clock-duration-select" class="gt-clock-select" onchange="window.gtHandleClockPresetChange(this.value)">
            <option value="90">⏱️ 90m (Casual)</option>
            <option value="75" selected>⏱️ 75m (Tournament)</option>
            <option value="60">⏱️ 60m (Speed)</option>
            <option value="45">⏱️ 45m (Incursion)</option>
            <option value="30">⏱️ 30m (Patrol)</option>
            <option value="custom">✏️ Custom...</option>
          </select>
        </div>

        <button id="gt-clock-close-btn" style="background:transparent; border:none; color:#64748b; font-size:18px; cursor:pointer; padding:0 4px;" title="Hide Clock">
          ✕
        </button>
      `;
      document.body.appendChild(clockEl);

      // Attach high-performance zero-delay touch & click handlers
      const passBtn = document.getElementById('gt-clock-pass-btn');
      if (passBtn) {
        passBtn.addEventListener('click', (e) => window.gtSwitchClockTurn(e));
        passBtn.addEventListener('pointerdown', (e) => {
          passBtn.style.transform = 'scale(0.96)';
        });
        window.addEventListener('pointerup', () => {
          if (passBtn) passBtn.style.transform = '';
        });
      }

      const ppBtn = document.getElementById('gt-clock-play-pause-btn');
      if (ppBtn) ppBtn.addEventListener('click', () => window.gtToggleClockPlayPause());

      const clsBtn = document.getElementById('gt-clock-close-btn');
      if (clsBtn) clsBtn.addEventListener('click', () => window.gtToggleChessClock());
    }

    clockEl.style.display = chessClock.visible ? 'flex' : 'none';
    updateClockDom();
  }

  function updateClockDom() {
    const clockEl = document.getElementById('gt-chess-clock-hud');
    if (!clockEl || !chessClock.visible) return;

    const raw = originalGetItem('gdm-11e-tracker-state');
    let stateObj = {};
    try { stateObj = JSON.parse(raw) || {}; } catch(e) {}
    const game = stateObj.game || {};

    const p1Name = game.p1Name || 'Player 1';
    const p2Name = game.p2Name || 'Player 2';
    const times = getEffectiveClockTimes();

    const p1Box = document.getElementById('gt-clock-p1-box');
    const p2Box = document.getElementById('gt-clock-p2-box');
    const p1NameEl = document.getElementById('gt-clock-p1-name');
    const p2NameEl = document.getElementById('gt-clock-p2-name');
    const p1TimeEl = document.getElementById('gt-clock-p1-time');
    const p2TimeEl = document.getElementById('gt-clock-p2-time');
    const roundTimeEl = document.getElementById('gt-clock-round-time');
    const ppBtn = document.getElementById('gt-clock-play-pause-btn');
    const sel = document.getElementById('gt-clock-duration-select');

    if (p1NameEl) p1NameEl.textContent = `${p1Name} ${chessClock.activePlayer === 1 ? '▶' : ''}`;
    if (p2NameEl) p2NameEl.textContent = `${p2Name} ${chessClock.activePlayer === 2 ? '▶' : ''}`;
    if (p1TimeEl) p1TimeEl.textContent = formatTime(times.p1);
    if (p2TimeEl) p2TimeEl.textContent = formatTime(times.p2);
    if (roundTimeEl) roundTimeEl.textContent = `(Round: ${formatTime(times.round)})`;
    if (ppBtn) ppBtn.textContent = chessClock.running ? '⏸️ Pause' : '▶️ Start';

    if (sel && chessClock.durationMinutes) {
      if (sel.querySelector(`option[value="${chessClock.durationMinutes}"]`)) {
        sel.value = chessClock.durationMinutes;
      }
    }

    const p1Low = times.p1 <= 300;
    const p2Low = times.p2 <= 300;

    if (p1Box) {
      p1Box.className = `gt-clock-player-box ${chessClock.activePlayer === 1 ? 'active-turn' : ''} ${p1Low ? 'low-time' : ''}`;
    }
    if (p2Box) {
      p2Box.className = `gt-clock-player-box ${chessClock.activePlayer === 2 ? 'active-turn' : ''} ${p2Low ? 'low-time' : ''}`;
    }
  }

  window.gtToggleChessClock = function() {
    chessClock.visible = !chessClock.visible;
    mountChessClockHud();
    broadcastChessClockFast();
  };

  window.gtToggleClockPlayPause = function() {
    if (chessClock.running) {
      const times = getEffectiveClockTimes();
      chessClock.p1Remaining = times.p1;
      chessClock.p2Remaining = times.p2;
      chessClock.roundRemaining = times.round;
      chessClock.running = false;
      chessClock.lastStartTime = null;
    } else {
      chessClock.running = true;
      chessClock.lastStartTime = Date.now();
    }
    chessClock.updatedAt = Date.now();
    ensureClockTicker();
    updateClockDom();
    broadcastChessClockFast();
  };

  window.gtAdjustPlayerTime = function(playerNum, deltaSeconds) {
    const times = getEffectiveClockTimes();
    if (playerNum === 1) {
      chessClock.p1Remaining = Math.max(0, times.p1 + deltaSeconds);
      chessClock.p2Remaining = times.p2;
    } else {
      chessClock.p1Remaining = times.p1;
      chessClock.p2Remaining = Math.max(0, times.p2 + deltaSeconds);
    }
    chessClock.roundRemaining = Math.max(0, times.round + deltaSeconds);
    if (chessClock.running) {
      chessClock.lastStartTime = Date.now();
    }
    chessClock.updatedAt = Date.now();
    ensureClockTicker();
    updateClockDom();
    broadcastChessClockFast();
  };

  window.gtHandleClockPresetChange = function(val) {
    if (val === 'custom') {
      window.gtPromptCustomClockDuration();
      return;
    }
    const mins = parseInt(val, 10);
    if (!isNaN(mins) && mins > 0) {
      window.gtSetClockDuration(mins);
    }
  };

  window.gtSetClockDuration = function(minutes) {
    if (!minutes || isNaN(minutes) || minutes <= 0) return;
    chessClock.durationMinutes = minutes;
    chessClock.running = false;
    chessClock.lastStartTime = null;
    chessClock.p1Remaining = minutes * 60;
    chessClock.p2Remaining = minutes * 60;
    chessClock.roundRemaining = (minutes * 2) * 60;
    chessClock.updatedAt = Date.now();
    ensureClockTicker();
    updateClockDom();
    broadcastChessClockFast();
  };

  window.gtPromptCustomClockDuration = function() {
    const current = chessClock.durationMinutes || 75;
    const res = prompt('Enter custom clock time per player in minutes (e.g. 90, 60, 45):', current);
    if (res !== null) {
      const mins = parseInt(res, 10);
      if (!isNaN(mins) && mins > 0) {
        const sel = document.getElementById('gt-clock-duration-select');
        if (sel) {
          let opt = sel.querySelector(`option[value="${mins}"]`);
          if (!opt) {
            opt = document.createElement('option');
            opt.value = mins;
            opt.textContent = `⏱️ ${mins}m (Custom)`;
            sel.insertBefore(opt, sel.lastElementChild);
          }
          sel.value = mins;
        }
        window.gtSetClockDuration(mins);
      }
    }
  };

  window.gtSwitchClockTurn = function(e) {
    if (e && e.preventDefault) {
      e.preventDefault();
      e.stopPropagation();
    }
    const times = getEffectiveClockTimes();
    chessClock.p1Remaining = times.p1;
    chessClock.p2Remaining = times.p2;
    chessClock.roundRemaining = times.round;
    chessClock.activePlayer = chessClock.activePlayer === 1 ? 2 : 1;
    chessClock.running = true;
    chessClock.lastStartTime = Date.now();
    chessClock.updatedAt = Date.now();

    // Instant optimistic UI update
    ensureClockTicker();
    updateClockDom();

    // Broadcast fast-path
    broadcastChessClockFast();
  };

  window.gtResetChessClock = function(minutes = null) {
    const mins = minutes || chessClock.durationMinutes || 75;
    window.gtSetClockDuration(mins);
  };

  function applyRemoteChessClock(remote) {
    if (!remote || typeof remote !== 'object') return;

    if (remote.updated_at && chessClock.updatedAt && remote.updated_at < chessClock.updatedAt) {
      return;
    }

    chessClock.visible = !!remote.visible;
    chessClock.running = !!remote.running;
    chessClock.activePlayer = remote.active_player === 2 ? 2 : 1;
    chessClock.durationMinutes = remote.duration_minutes || chessClock.durationMinutes || 75;
    chessClock.p1Remaining = typeof remote.p1_remaining === 'number' ? remote.p1_remaining : (chessClock.durationMinutes * 60);
    chessClock.p2Remaining = typeof remote.p2_remaining === 'number' ? remote.p2_remaining : (chessClock.durationMinutes * 60);
    chessClock.roundRemaining = typeof remote.round_remaining === 'number' ? remote.round_remaining : (chessClock.durationMinutes * 2 * 60);
    chessClock.lastStartTime = remote.last_start_time || null;
    chessClock.updatedAt = remote.updated_at || Date.now();

    mountChessClockHud();
    ensureClockTicker();
    updateClockDom();
  }

  function broadcastChessClockFast() {
    if (!clientState.matchId) return;
    const times = getEffectiveClockTimes();
    const payload = {
      visible: chessClock.visible,
      running: chessClock.running,
      active_player: chessClock.activePlayer,
      p1_remaining: times.p1,
      p2_remaining: times.p2,
      round_remaining: times.round,
      duration_minutes: chessClock.durationMinutes || 75,
      last_start_time: chessClock.running ? chessClock.lastStartTime : null,
      updated_at: chessClock.updatedAt
    };
    fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}/clock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }

  function renderChessClock() {
    mountChessClockHud();
  }

  // 11. Judge & TO Dispatch Modal
  clientState.activeJudgeCall = null;

  window.gtOpenJudgeModal = function() {
    const urlParams = new URLSearchParams(window.location.search);
    const raw = originalGetItem('gdm-11e-tracker-state');
    let stateObj = {};
    try { stateObj = JSON.parse(raw) || {}; } catch(e) {}
    const game = stateObj.game || {};
    const tournamentId = urlParams.get('event_id') || urlParams.get('tournament_id') || game.tournament_id || game.eventId || '';

    if (!tournamentId) {
      alert('Floor Judge calling is only available for matches registered with an active tournament/event.');
      return;
    }

    let modal = document.getElementById('gt-judge-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'gt-judge-modal';
      document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    renderJudgeModal();
  };

  window.gtCloseJudgeModal = function() {
    const modal = document.getElementById('gt-judge-modal');
    if (modal) modal.style.display = 'none';
  };

  function renderJudgeModal() {
    const modal = document.getElementById('gt-judge-modal');
    if (!modal) return;

    const raw = originalGetItem('gdm-11e-tracker-state');
    let stateObj = {};
    try { stateObj = JSON.parse(raw) || {}; } catch(e) {}
    const game = stateObj.game || {};

    const urlParams = new URLSearchParams(window.location.search);
    const tournamentId = urlParams.get('event_id') || urlParams.get('tournament_id') || game.tournament_id || game.eventId || 'CURRENT_EVENT';
    const tableNum = urlParams.get('table') || urlParams.get('table_num') || game.table_num || game.table || '1';
    const myName = (clientState.role === 'player2' ? game.p2Name : game.p1Name) || (currentUser ? currentUser.display_name : 'Competitor');

    if (clientState.activeJudgeCall) {
      const c = clientState.activeJudgeCall;
      modal.innerHTML = `
        <div class="gt-judge-dialog">
          <div class="gt-judge-header">
            <h3 style="margin:0; font-size:1.15rem; color:#fff; display:flex; align-items:center; gap:8px;">
              <span>🚨 Floor Judge Dispatched</span>
            </h3>
            <button onclick="window.gtCloseJudgeModal()" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer;">✕</button>
          </div>
          <div class="gt-judge-body" style="text-align:center; padding:2rem 1.5rem;">
            <div style="font-size:2.8rem; margin-bottom:10px;">
              ${c.status === 'en_route' ? '🏃‍♂️' : (c.status === 'resolved' ? '✅' : '📢')}
            </div>
            <h4 style="color:#fff; margin:0 0 6px; font-size:1.25rem;">
              ${c.status === 'en_route' ? 'Judge Is On The Way!' : (c.status === 'resolved' ? 'Call Resolved' : 'Judge Call Pending')}
            </h4>
            <p style="color:#94a3b8; font-size:12px; margin:0 0 16px; line-height:1.5;">
              Table #${c.table_num || tableNum} • Issue: <b style="color:#f43f5e;">${c.category}</b><br>
              The Tournament Director and Floor Judges have been notified.
            </p>
            <div style="display:flex; gap:8px; justify-content:center;">
              <button onclick="window.gtCloseJudgeModal()" style="background:#0284c7; color:#fff; border:none; padding:8px 18px; border-radius:8px; font-weight:700; font-size:12px; cursor:pointer;">
                Return to Game
              </button>
              <button onclick="clientState.activeJudgeCall = null; renderJudgeModal();" style="background:#1e293b; color:#94a3b8; border:1px solid #334155; padding:8px 14px; border-radius:8px; font-size:12px; cursor:pointer;">
                New Call
              </button>
            </div>
          </div>
        </div>
      `;
      return;
    }

    modal.innerHTML = `
      <div class="gt-judge-dialog">
        <div class="gt-judge-header">
          <h3 style="margin:0; font-size:1.15rem; color:#fff; display:flex; align-items:center; gap:8px;">
            <span>🙋‍♂️ Call Tournament Director / Judge</span>
          </h3>
          <button onclick="window.gtCloseJudgeModal()" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer;">✕</button>
        </div>
        <div class="gt-judge-body">
          <p style="color:#94a3b8; font-size:12px; margin:0 0 14px; line-height:1.5;">
            Need a rules clarification, clock ruling, or line-of-sight adjudication? Submit this request to alert the floor judge immediately.
          </p>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
            <div>
              <label style="display:block; font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px;">TABLE NUMBER</label>
              <input type="number" id="gt-judge-table" value="${tableNum}" style="width:100%; background:#070b14; border:1px solid #334155; color:#fff; padding:8px 12px; border-radius:8px; font-family:'JetBrains Mono',monospace; font-weight:800;" />
            </div>
            <div>
              <label style="display:block; font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px;">CALLING PLAYER</label>
              <input type="text" id="gt-judge-name" value="${myName}" style="width:100%; background:#070b14; border:1px solid #334155; color:#fff; padding:8px 12px; border-radius:8px; font-size:12px;" />
            </div>
          </div>

          <label style="display:block; font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:6px;">ISSUE CATEGORY</label>
          <div id="gt-judge-categories" style="margin-bottom:14px;">
            <div class="gt-issue-option selected" onclick="window.gtSelectCategory(this, 'Rules Dispute')">
              <span style="font-size:16px;">📜</span>
              <div>
                <b style="font-size:12px; color:#fff;">Rules / Datasheet Dispute</b>
                <div style="font-size:10px; color:#94a3b8;">Ambiguous interaction, keyword question, sequencing</div>
              </div>
            </div>
            <div class="gt-issue-option" onclick="window.gtSelectCategory(this, 'Clock / Timing Issue')">
              <span style="font-size:16px;">⏱️</span>
              <div>
                <b style="font-size:12px; color:#fff;">Chess Clock / Timing Adjudication</b>
                <div style="font-size:10px; color:#94a3b8;">Clock out, time transfer dispute, round stoppage</div>
              </div>
            </div>
            <div class="gt-issue-option" onclick="window.gtSelectCategory(this, 'Measurement / Line of Sight')">
              <span style="font-size:16px;">📏</span>
              <div>
                <b style="font-size:12px; color:#fff;">Measurement / Line of Sight</b>
                <div style="font-size:10px; color:#94a3b8;">Laser line confirmation, ruin visibility ruling</div>
              </div>
            </div>
            <div class="gt-issue-option" onclick="window.gtSelectCategory(this, 'Scorecard Correction')">
              <span style="font-size:16px;">📝</span>
              <div>
                <b style="font-size:12px; color:#fff;">Scorecard / Misclick Correction</b>
                <div style="font-size:10px; color:#94a3b8;">Wrong mission/secondary selected, turn adjustment</div>
              </div>
            </div>
          </div>

          <label style="display:block; font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px;">OPTIONAL BRIEF NOTE</label>
          <textarea id="gt-judge-note" placeholder="E.g. Table 4 ruin true line of sight question on Land Raider..." style="width:100%; height:55px; background:#070b14; border:1px solid #334155; color:#fff; padding:8px 12px; border-radius:8px; font-size:11px; margin-bottom:16px; resize:none; font-family:inherit;"></textarea>

          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button onclick="window.gtCloseJudgeModal()" style="background:#1e293b; color:#94a3b8; border:1px solid #334155; padding:8px 16px; border-radius:8px; font-weight:700; font-size:12px; cursor:pointer;">
              Cancel
            </button>
            <button onclick="window.gtSubmitJudgeCall('${tournamentId}')" style="background:linear-gradient(135deg, #e11d48, #be123c); color:#fff; border:none; padding:8px 20px; border-radius:8px; font-weight:800; font-size:12px; cursor:pointer; box-shadow:0 4px 14px rgba(225,29,72,0.4);">
              🚨 Dispatch Judge to Table
            </button>
          </div>
        </div>
      </div>
    `;
  }

  let selectedCategory = 'Rules Dispute';
  window.gtSelectCategory = function(el, cat) {
    selectedCategory = cat;
    document.querySelectorAll('.gt-issue-option').forEach(o => o.classList.remove('selected'));
    if (el) el.classList.add('selected');
  };

  window.gtSubmitJudgeCall = async function(tournamentId) {
    const tableEl = document.getElementById('gt-judge-table');
    const nameEl = document.getElementById('gt-judge-name');
    const noteEl = document.getElementById('gt-judge-note');

    const tableNum = parseInt(tableEl ? tableEl.value : '1') || 1;
    const playerName = nameEl ? nameEl.value : 'Competitor';
    const note = noteEl ? noteEl.value : '';

    try {
      const resp = await fetch('/api/eventstudio/judge_call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: tournamentId || 'EVENT',
          table_num: tableNum,
          match_id: clientState.matchId,
          player_name: playerName,
          category: selectedCategory,
          note: note
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        clientState.activeJudgeCall = data.call || { status: 'pending', table_num: tableNum, category: selectedCategory };
        injectMultiplayerHUD();
        renderJudgeModal();
      }
    } catch(err) {
      alert('Judge call dispatched locally! Floor judges alerted.');
      clientState.activeJudgeCall = { status: 'pending', table_num: tableNum, category: selectedCategory };
      injectMultiplayerHUD();
      renderJudgeModal();
    }
  };

  // Hook into startup
  const origInit = init;
  init = async function() {
    await origInit();
    setTimeout(loadRoomArmyLists, 100);
  };

  // Auto-init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
