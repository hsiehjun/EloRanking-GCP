/**
 * Synchronized Multiplayer, Room Key Generator & Strict 2-Player Collaborative Match Engine
 * for Warhammer 40,000 11th Edition Game Tracker
 */

(function () {
  'use strict';

  console.log('[GDM Sync Bridge] Initializing 2-Player Room Key & Multiplayer Engine...');

  const SYNC_CONFIG = {
    apiBase: '/api/tracker/room',
    historyEndpoint: '/api/tracker/history',
    authMeEndpoint: '/api/auth/me',
    authLoginEndpoint: '/api/auth/login',
    authRegisterEndpoint: '/api/auth/register',
    debounceMs: 120
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

  // On Landing Page: Clean out any lingering disk storage
  if (!isPlay) {
    try {
      originalRemoveItem('gdm-11e-tracker-state');
      originalRemoveItem('gdm-11e-tracker-history');
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

    window.__handleLogout = function () {
      clearAuthToken();
      window.location.href = '/login';
    };
  }

  // 3. Initialize Match Room / Play / Setup / Landing
  async function init() {
    const isAuthed = await verifySession();
    if (!isAuthed) return;

    if (isPlay) {
      const params = new URLSearchParams(window.location.search);
      let matchId = params.get('match_id') || params.get('room') || params.get('match');

      if (!matchId) {
        // Create new collision-free room via API
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
        matchId = 'WH40K-' + Math.random().toString(36).substring(2, 7).toUpperCase();
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
          if (joinData.state) {
            applyRemoteState(joinData.state);
          }
        }
      } catch (e) {}

      injectPlayer2InviteWidget();
      startRealtimeStream();
    } else {
      // Landing page (/11th/tracker or /tracker)
      injectLobbyHub();
      syncHistoryFromDatabase();
    }
  }

  // 4. Landing Page: Inject 2-Player Room Key Generator & Join Card
  function injectLobbyHub() {
    const observer = new MutationObserver(() => {
      const newGameBtn = document.querySelector('button:has(svg.lucide-plus), button[class*="New Game"]');
      if (newGameBtn && !document.getElementById('gt-lobby-hub-card')) {
        newGameBtn.style.display = 'none'; // Replace with comprehensive 2-player lobby card

        const lobbyCard = document.createElement('div');
        lobbyCard.id = 'gt-lobby-hub-card';
        lobbyCard.style.cssText = "margin:16px 0 24px; background:#0f1524; border:1px solid #1e293b; border-radius:18px; padding:20px 22px; box-shadow:0 12px 35px rgba(0,0,0,0.5);";
        lobbyCard.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:12px;">
            <div>
              <h3 style="font-size:16px; font-weight:800; color:#f8fafc; margin:0; font-family:'JetBrains Mono',monospace; letter-spacing:0.04em;">2-PLAYER MATCH LOBBY</h3>
              <p style="font-size:12px; color:#94a3b8; margin:4px 0 0;">Create a room key to host or enter a code to join an opponent's table.</p>
            </div>
            <span style="font-size:11px; font-weight:700; color:#38bdf8; background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.3); padding:4px 10px; border-radius:9999px;">2 Players Max</span>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
            <!-- Host Card -->
            <div style="background:#090d18; border:1px solid #1e293b; border-radius:14px; padding:16px; display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <div style="font-size:13px; font-weight:800; color:#f59e0b; text-transform:uppercase; margin-bottom:4px; font-family:'JetBrains Mono',monospace;">🎲 Host a Match</div>
                <p style="font-size:11px; color:#94a3b8; margin:0 0 12px;">Generate a unique room key to invite Player 2 for collaborative army setup.</p>
              </div>
              <button onclick="window.__handleCreateRoom()" style="width:100%; background:#f59e0b; color:#0f172a; font-weight:800; font-size:12px; text-transform:uppercase; border:none; padding:12px; border-radius:10px; cursor:pointer; letter-spacing:0.06em; font-family:'JetBrains Mono',monospace; transition:background 0.2s;">
                GENERATE ROOM KEY ➔
              </button>
            </div>

            <!-- Join Card -->
            <div style="background:#090d18; border:1px solid #1e293b; border-radius:14px; padding:16px; display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <div style="font-size:13px; font-weight:800; color:#38bdf8; text-transform:uppercase; margin-bottom:4px; font-family:'JetBrains Mono',monospace;">🔗 Join Room Key</div>
                <p style="font-size:11px; color:#94a3b8; margin:0 0 10px;">Enter the 8-character Room Key provided by your opponent.</p>
              </div>
              <div style="display:flex; gap:8px;">
                <input id="gt-lobby-join-input" type="text" placeholder="e.g. WH40K-7A9B-3C4D" style="flex:1; background:#070b14; border:1px solid #334155; border-radius:8px; padding:10px; font-family:'JetBrains Mono',monospace; font-size:12px; color:#f8fafc; outline:none; text-transform:uppercase;" />
                <button onclick="window.__handleJoinRoomInput()" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; text-transform:uppercase; border:none; padding:10px 14px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace;">JOIN</button>
              </div>
            </div>
          </div>
        `;
        newGameBtn.parentNode.insertBefore(lobbyCard, newGameBtn);

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
              showWaitingLobbyModal(data.match_id);
              return;
            }
          } catch (err) {}
          window.location.href = '/11th/tracker/play';
        };

        window.__handleJoinRoomInput = function () {
          const input = document.getElementById('gt-lobby-join-input');
          let code = (input.value || '').trim();
          if (code.includes('match_id=')) {
            code = new URL(code).searchParams.get('match_id') || code;
          }
          if (code) {
            code = code.toUpperCase();
            if (!code.startsWith('WH40K-') && code.length === 8) {
              code = `WH40K-${code.substring(0, 4)}-${code.substring(4)}`;
            }
            window.location.href = `/11th/tracker/play?match_id=${encodeURIComponent(code)}`;
          }
        };
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
            <span style="width:8px; height:8px; border-radius:50%; background:#f59e0b; display:inline-block; animation:pulse 1.5s infinite;"></span>
            <span id="gt-waiting-status-text">Waiting for Player 2 to join (1/2 Players)...</span>
          </div>

          <button onclick="window.location.href='/11th/tracker/play?match_id=${matchId}'" style="width:100%; background:#10b981; color:#0f172a; font-weight:800; font-size:14px; text-transform:uppercase; border:none; padding:14px; border-radius:11px; cursor:pointer; font-family:'JetBrains Mono',monospace; letter-spacing:0.06em;">
            ENTER SETUP SCREEN ➔
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Listen for P2 connection
    const sse = new EventSource(`/api/tracker/room/${matchId}/stream?client_id=host_${Date.now()}`);
    sse.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'state_update' && msg.state && msg.state.user_id_p2) {
          const statusText = document.getElementById('gt-waiting-status-text');
          if (statusText) {
            statusText.textContent = `🟢 Player 2 Connected! (2/2 Players Ready)`;
            statusText.style.color = '#10b981';
          }
          setTimeout(() => {
            window.location.href = `/11th/tracker/play?match_id=${matchId}`;
          }, 800);
        }
      } catch (e) {}
    };
  }

  // 5. Step 1: 2-Player Invite & Setup Helper inside Play Screen
  function injectPlayer2InviteWidget() {
    const observer = new MutationObserver(() => {
      const stepTitle = document.querySelector('h2');
      if (stepTitle && stepTitle.textContent.includes('PLAYERS') && !document.getElementById('gt-invite-widget')) {
        const rawState = originalGetItem('gdm-11e-tracker-state');
        let stateObj = {};
        try { stateObj = JSON.parse(rawState); } catch(e) {}

        const p2Claimed = !!(stateObj.user_id_p2 || (stateObj.game && stateObj.game.p2Name && stateObj.game.p2Name !== 'Player 2'));
        const inviteUrl = window.location.href;

        const widget = document.createElement('div');
        widget.id = 'gt-invite-widget';
        widget.style.cssText = "margin-bottom:16px; background:#0f172a; border:1px solid #1e293b; border-radius:14px; padding:14px 16px;";
        
        if (!p2Claimed) {
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
              <span style="font-size:12px; font-weight:800; color:#10b981; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">🟢 Connected: Player 1 vs Player 2 (${stateObj.game ? stateObj.game.p2Name : 'Opponent'})</span>
              <span style="font-size:11px; color:#94a3b8; font-family:'JetBrains Mono',monospace;">2/2 Players (Collaborative Live)</span>
            </div>
          `;
        }

        stepTitle.parentNode.insertBefore(widget, stepTitle.nextSibling);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
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
        if (data && data.history && Array.isArray(data.history) && data.history.length > 0) {
          dbHistoryCache = data.history.map(item => {
            let s = {};
            if (typeof item.state_json === 'string') {
              try { s = JSON.parse(item.state_json); } catch (e) {}
            } else if (typeof item.state_json === 'object') {
              s = item.state_json || {};
            }
            return {
              id: item.match_id,
              date: new Date(item.updated_at || item.created_at || Date.now()).getTime(),
              game: {
                p1Name: item.p1_name || 'Player 1',
                p2Name: item.p2_name || 'Player 2',
                p1Faction: item.p1_faction,
                p2Faction: item.p2_faction,
                p1Detachments: item.p1_detachment ? [item.p1_detachment] : [],
                p2Detachments: item.p2_detachment ? [item.p2_detachment] : [],
                primary: item.primary_mission || 'Take & Hold',
                deployment: item.deployment || 'Search & Destroy'
              },
              p1Score: item.p1_score || 0,
              p2Score: item.p2_score || 0,
              started: item.started,
              isFinished: item.is_finished,
              winner: item.winner_name
            };
          });
        } else {
          dbHistoryCache = [];
        }

        window.dispatchEvent(new StorageEvent('storage', {
          key: 'gdm-11e-tracker-history',
          newValue: JSON.stringify(dbHistoryCache),
          storageArea: localStorage
        }));
      }
    } catch (e) {}
  }

  // 7. Broadcast State with Role & Session Validation
  function notifyStateChanged() {
    if (clientState.isApplyingRemote) return;
    if (clientState.role === 'spectator') return;
    if (!clientState.matchId) return;

    clearTimeout(clientState.debounceTimer);
    clientState.debounceTimer = setTimeout(() => {
      broadcastState();
    }, SYNC_CONFIG.debounceMs);
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
    clientState.isApplyingRemote = true;
    try {
      const serialized = typeof incoming === 'string' ? incoming : JSON.stringify(incoming);
      const current = originalGetItem('gdm-11e-tracker-state');
      if (current !== serialized) {
        originalSetItem('gdm-11e-tracker-state', serialized);
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'gdm-11e-tracker-state',
          newValue: serialized,
          oldValue: current,
          url: window.location.href,
          storageArea: localStorage
        }));

        // Refresh invite widget if P2 just connected
        const widget = document.getElementById('gt-invite-widget');
        if (widget && incoming.game && incoming.game.p2Name && incoming.game.p2Name !== 'Player 2') {
          widget.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <span style="font-size:12px; font-weight:800; color:#10b981; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">🟢 Connected: Player 1 vs Player 2 (${incoming.game.p2Name})</span>
              <span style="font-size:11px; color:#94a3b8; font-family:'JetBrains Mono',monospace;">2/2 Players (Collaborative Live)</span>
            </div>
          `;
        }
      }
    } finally {
      setTimeout(() => { clientState.isApplyingRemote = false; }, 50);
    }
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
            const countEl = document.getElementById('gt-hud-online');
            if (countEl) countEl.textContent = `${msg.count || 1} online`;
          }
        } catch (e) {}
      };
    } catch (e) {}
  }

  // 8. Floating Multiplayer Status HUD with Role Badge
  function injectMultiplayerHUD() {
    if (document.getElementById('gt-sync-hud')) return;

    const roleBadgeColor = {
      'player1': '#3b82f6',
      'player2': '#ef4444',
      'referee': '#a855f7',
      'spectator': '#64748b'
    }[clientState.role] || '#38bdf8';

    const roleLabel = {
      'player1': 'PLAYER 1',
      'player2': 'PLAYER 2',
      'referee': 'REFEREE',
      'spectator': 'SPECTATOR'
    }[clientState.role] || clientState.role.toUpperCase();

    const hud = document.createElement('div');
    hud.id = 'gt-sync-hud';
    hud.innerHTML = `
      <div style="position:fixed; top:12px; right:16px; z-index:99999; display:flex; align-items:center; gap:8px; background:rgba(15,23,42,0.92); border:1px solid rgba(56,189,248,0.35); box-shadow:0 8px 30px rgba(0,0,0,0.5); backdrop-filter:blur(10px); padding:6px 12px; border-radius:9999px; font-family:'Inter',sans-serif; font-size:12px; color:#f8fafc;">
        <span style="padding:2px 6px; border-radius:4px; font-size:10px; font-weight:800; background:${roleBadgeColor}; color:#fff; letter-spacing:0.04em;">${roleLabel}</span>
        <b style="font-family:'JetBrains Mono',monospace; color:#38bdf8;">#${clientState.matchId}</b>
        <span style="color:#64748b;">•</span>
        <span id="gt-hud-online" style="color:#94a3b8;">1 online</span>
        <button onclick="navigator.clipboard.writeText(window.location.href); alert('🔗 Room Link Copied! Share with your opponent.');" style="background:#0284c7; color:#fff; border:none; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; margin-left:4px;">
          🔗 Share
        </button>
      </div>
    `;
    document.body.appendChild(hud);
  }

  // Auto-init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
