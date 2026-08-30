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

  console.log('[GDM Sync Bridge] Initializing 2-Player Room Key & Multiplayer Engine...');

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
    p2Connected: false
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

  // Override getItem
  window.localStorage.getItem = function (key) {
    if (key === 'gdm-11e-tracker-history') {
      return JSON.stringify(dbHistoryCache);
    }
    if (!isPlay && key === 'gdm-11e-tracker-state') {
      return null;
    }
    return originalGetItem(key);
  };

  // Override setItem
  window.localStorage.setItem = function (key, value) {
    if (key === 'gdm-11e-tracker-history') {
      return; // Database is sole source of truth
    }
    originalSetItem(key, value);
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
    if (token) {
      try {
        const resp = await fetch(SYNC_CONFIG.authMeEndpoint, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.authenticated && data.user) {
            currentUser = data.user;
            renderUserBar();
            return true;
          }
        }
      } catch (e) {}
    }
    clearAuthToken();
    window.location.href = '/login?redirect=' + encodeURIComponent(window.location.href);
    return false;
  }

  function renderUserBar() {
    if (!currentUser) return;
    let bar = document.getElementById('gt-user-status-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'gt-user-status-bar';
      bar.style.cssText = "position:fixed; top:12px; left:16px; z-index:99998; display:flex; align-items:center; gap:8px; background:rgba(15,23,42,0.92); border:1px solid rgba(255,255,255,0.1); backdrop-filter:blur(10px); padding:6px 12px; border-radius:9999px; font-family:'Inter',sans-serif; font-size:12px; color:#f8fafc;";
      document.body.appendChild(bar);
    }
    bar.innerHTML = `
      <span style="width:8px; height:8px; border-radius:50%; background:#10b981;"></span>
      <span style="color:#94a3b8;">Logged in:</span>
      <b style="color:#f8fafc;">${currentUser.display_name || currentUser.email}</b>
      <button onclick="window.__handleLogout()" style="background:transparent; border:none; color:#ef4444; font-size:11px; cursor:pointer; margin-left:6px; font-weight:700;">Logout</button>
    `;

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
      const existing = document.getElementById('gt-lobby-hub-card');
      if (existing && document.body.contains(existing)) return;

      const buttons = Array.from(document.querySelectorAll('button'));
      const newGameBtn = buttons.find(b => b.textContent && b.textContent.includes('New Game')) || document.querySelector('button:has(svg)');

      if (newGameBtn) {
        newGameBtn.style.display = 'none'; // Replace with comprehensive 2-player lobby card

        let lobbyCard = document.getElementById('gt-lobby-hub-card');
        if (!lobbyCard) {
          lobbyCard = document.createElement('div');
          lobbyCard.id = 'gt-lobby-hub-card';
          lobbyCard.style.cssText = "margin:16px 0 24px; background:#0f1524; border:1px solid #1e293b; border-radius:18px; padding:18px; box-shadow:0 12px 35px rgba(0,0,0,0.5); width:100%; box-sizing:border-box;";
          lobbyCard.innerHTML = `
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
          `;
          newGameBtn.parentNode.insertBefore(lobbyCard, newGameBtn);
        }

        let historySection = document.getElementById('gt-history-section');
        if (!historySection) {
          historySection = document.createElement('div');
          historySection.id = 'gt-history-section';
          historySection.style.cssText = "margin:20px 0 40px; width:100%; box-sizing:border-box;";
          historySection.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
              <div style="font-size:14px; font-weight:800; color:#f8fafc; font-family:'JetBrains Mono',monospace; letter-spacing:0.04em;">
                GAME HISTORY <span id="gt-history-count" style="font-size:12px; color:#38bdf8; font-weight:700; margin-left:4px;"></span>
              </div>
              <button onclick="window.__syncTrackerHistory()" style="background:transparent; border:none; color:#38bdf8; font-size:11px; cursor:pointer; font-family:'JetBrains Mono',monospace; font-weight:700;">🔄 Refresh</button>
            </div>
            <div id="gt-history-list" style="display:flex; flex-direction:column; gap:10px;">
              <div style="color:#64748b; font-size:12px; font-family:'JetBrains Mono',monospace; padding:18px; text-align:center; background:#0f1524; border-radius:14px; border:1px solid #1e293b;">
                Loading match history...
              </div>
            </div>
          `;
          lobbyCard.parentNode.insertBefore(historySection, lobbyCard.nextSibling);
        }

        hideNativeGdmEmptyState();
        renderHistoryList(dbHistoryCache);
        syncHistoryFromDatabase();
      }
    }

    tryInject();
    const observer = new MutationObserver(() => {
      hideNativeGdmEmptyState();
      if (!document.getElementById('gt-lobby-hub-card') || !document.getElementById('gt-history-section')) {
        tryInject();
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
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, div, p, span'));
    for (const el of headings) {
      if (el.closest('#gt-lobby-hub-card') || el.closest('#gt-history-section') || el.closest('#gt-user-badge') || el.closest('#gt-waiting-modal')) continue;
      const txt = (el.textContent || '').trim().toUpperCase();
      if (txt === 'GAME HISTORY' || txt === 'NO GAMES YET' || txt.includes('TAP NEW GAME TO START')) {
        const card = el.closest('div[class*="border"], div[class*="rounded"], section') || el;
        if (card && !card.contains(document.getElementById('gt-lobby-hub-card')) && !card.contains(document.getElementById('gt-history-section'))) {
          card.style.display = 'none';
        }
      }
    }
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

  // Soft Delete: Hide tracker game for current user
  window.__gdmHideTrackerGame = async function(matchId, cardEl) {
    if (!matchId) return;
    if (!confirm(`Hide match #${matchId} from your personal history?\n\n(Note: This will only hide it from your view. The match remains safely preserved in the database for the other player.)`)) {
      return;
    }

    if (cardEl) {
      cardEl.style.transition = 'opacity 0.25s, transform 0.25s';
      cardEl.style.opacity = '0';
      cardEl.style.transform = 'translateX(20px)';
      setTimeout(() => { cardEl.remove(); }, 260);
    }

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

      // Update local cache
      dbHistoryCache = dbHistoryCache.filter(item => (item.match_id || item.id) !== matchId);
      originalSetItem('gdm-11e-tracker-history', JSON.stringify(dbHistoryCache));
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

      // 1. Direct Setup Wizard DOM Injection
      if (stateObj.game) {
        injectSetupWizardState(stateObj.game, stateObj.p1, stateObj.p2);
      }

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
          } else if (msg.type === 'presence') {
            clientState.onlineCount = msg.count || 1;
            injectMultiplayerHUD();
          }
        } catch (e) {}
      };
    } catch (e) {}
  }

  function attachDomActionInterceptors() {
    document.addEventListener('input', () => {
      setTimeout(() => { notifyStateChanged(); injectMultiplayerHUD(); }, 40);
    }, true);

    document.addEventListener('change', () => {
      setTimeout(() => { notifyStateChanged(); injectMultiplayerHUD(); }, 40);
    }, true);

    document.addEventListener('click', () => {
      setTimeout(() => { notifyStateChanged(); injectMultiplayerHUD(); }, 50);
      setTimeout(() => { notifyStateChanged(); injectMultiplayerHUD(); }, 200);
    }, true);

    document.addEventListener('pointerup', () => {
      setTimeout(() => { notifyStateChanged(); injectMultiplayerHUD(); }, 60);
    }, true);
  }

  // 8. Floating Multiplayer Status HUD with Connected Player Names
  function injectMultiplayerHUD() {
    let hud = document.getElementById('gt-sync-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'gt-sync-hud';
      document.body.appendChild(hud);
    }

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

    const statusDotColor = isP2Ready ? '#10b981' : '#f59e0b';
    const statusDotPulse = isP2Ready ? '' : 'animation:pulse 1.5s infinite;';

    hud.innerHTML = `
      <div style="position:fixed; top:10px; right:10px; z-index:99999; display:flex; align-items:center; gap:8px; background:rgba(15,23,42,0.96); border:1px solid rgba(56,189,248,0.35); box-shadow:0 8px 30px rgba(0,0,0,0.65); backdrop-filter:blur(12px); padding:5px 12px; border-radius:9999px; font-family:'Inter',sans-serif; font-size:11px; color:#f8fafc; max-width:calc(100vw - 20px);">
        <span style="display:flex; align-items:center; gap:5px; font-weight:800; font-family:'JetBrains Mono',monospace;">
          <span style="width:7px; height:7px; border-radius:50%; background:${statusDotColor}; ${statusDotPulse}"></span>
          <span style="color:#38bdf8;">${p1Display}</span>
          <span style="color:#64748b; font-size:10px;">vs</span>
          <span style="${isP2Ready ? 'color:#10b981;' : 'color:#94a3b8; font-style:italic;'}">${p2Display}</span>
        </span>
        <b style="font-family:'JetBrains Mono',monospace; color:#f59e0b; font-size:10px; background:#070b14; padding:2px 6px; border-radius:4px; border:1px solid #334155;">#${clientState.matchId}</b>
        <span id="gt-hud-online" style="color:#94a3b8; font-size:10px;">${clientState.onlineCount || 1} online</span>
        <button onclick="navigator.clipboard.writeText(window.location.href); alert('🔗 Room Link Copied! Share with your opponent.');" style="background:#0284c7; color:#fff; border:none; padding:3px 8px; border-radius:4px; font-size:10px; font-weight:700; cursor:pointer;">
          🔗 Share
        </button>
      </div>
    `;
  }

  // Auto-init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
