/**
 * Synchronized Multiplayer, Role-Based Access Control & PostgreSQL Database Bridge
 * for Warhammer 40,000 11th Edition Game Tracker
 */

(function () {
  'use strict';

  console.log('[GDM Sync Bridge] Initializing Authenticated Multiplayer Engine...');

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
    debounceTimer: null
  };

  let dbHistoryCache = [];

  // 1. Storage interceptors - immediate execution in HEAD
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
  const originalGetItem = window.localStorage.getItem.bind(window.localStorage);

  function getAuthToken() {
    return originalGetItem('elo_auth_token') || sessionStorage.getItem('elo_auth_token') || '';
  }

  function setAuthToken(token) {
    if (token) {
      originalSetItem('elo_auth_token', token);
      sessionStorage.setItem('elo_auth_token', token);
    }
  }

  // On Landing Page: Clear local disk tracker state
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

  // 2. Authentication Check & Seamless Modal
  async function checkAuth() {
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
            updateUserBar();
            return true;
          }
        }
      } catch (e) {}
    }
    showAuthModal();
    return false;
  }

  function showAuthModal() {
    if (document.getElementById('gt-auth-modal-root')) return;

    const modal = document.createElement('div');
    modal.id = 'gt-auth-modal-root';
    modal.innerHTML = `
      <div style="position:fixed; inset:0; z-index:999999; background:rgba(4,7,14,0.88); backdrop-filter:blur(14px); display:flex; align-items:center; justify-content:center; padding:16px; font-family:'Inter',sans-serif;">
        <div style="background:#0e1526; border:1px solid #1e293b; border-radius:18px; width:100%; max-width:420px; box-shadow:0 25px 60px rgba(0,0,0,0.8); overflow:hidden;">
          <div style="padding:24px 24px 16px; text-align:center; border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:26px; margin-bottom:6px;">⚔️</div>
            <h3 style="margin:0; font-size:20px; font-weight:800; color:#f8fafc; font-family:'JetBrains Mono',monospace; letter-spacing:0.04em;">TACTICAL HUB</h3>
            <p style="margin:6px 0 0; font-size:13px; color:#94a3b8;">Sign in to create, collaborate, and track live 11th Edition games.</p>
          </div>
          
          <div style="display:flex; border-bottom:1px solid rgba(255,255,255,0.06); background:#090d18;">
            <button id="gt-tab-login" onclick="window.__switchAuthTab('login')" style="flex:1; padding:12px; font-size:13px; font-weight:700; color:#38bdf8; background:transparent; border:none; border-bottom:2px solid #38bdf8; cursor:pointer;">SIGN IN</button>
            <button id="gt-tab-register" onclick="window.__switchAuthTab('register')" style="flex:1; padding:12px; font-size:13px; font-weight:700; color:#64748b; background:transparent; border:none; border-bottom:2px solid transparent; cursor:pointer;">CREATE ACCOUNT</button>
          </div>

          <form id="gt-auth-form" onsubmit="window.__handleAuthSubmit(event)" style="padding:20px 24px 24px;">
            <div id="gt-auth-error" style="display:none; padding:10px; margin-bottom:14px; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4); border-radius:8px; font-size:12px; color:#fca5a5; text-align:center;"></div>

            <div id="gt-name-group" style="display:none; margin-bottom:14px;">
              <label style="display:block; font-size:11px; font-weight:700; text-transform:uppercase; color:#94a3b8; margin-bottom:6px; letter-spacing:0.05em;">Display Name / Player Handle</label>
              <input id="gt-auth-name" type="text" placeholder="e.g. Captain Titus" style="width:100%; box-sizing:border-box; padding:12px 14px; background:#070b14; border:1px solid #1e293b; border-radius:10px; font-size:14px; color:#f8fafc; outline:none;" />
            </div>

            <div style="margin-bottom:14px;">
              <label style="display:block; font-size:11px; font-weight:700; text-transform:uppercase; color:#94a3b8; margin-bottom:6px; letter-spacing:0.05em;">Email Address</label>
              <input id="gt-auth-email" type="email" required placeholder="player@chapter.com" style="width:100%; box-sizing:border-box; padding:12px 14px; background:#070b14; border:1px solid #1e293b; border-radius:10px; font-size:14px; color:#f8fafc; outline:none;" />
            </div>

            <div style="margin-bottom:20px;">
              <label style="display:block; font-size:11px; font-weight:700; text-transform:uppercase; color:#94a3b8; margin-bottom:6px; letter-spacing:0.05em;">Password</label>
              <input id="gt-auth-password" type="password" required placeholder="••••••••" style="width:100%; box-sizing:border-box; padding:12px 14px; background:#070b14; border:1px solid #1e293b; border-radius:10px; font-size:14px; color:#f8fafc; outline:none;" />
            </div>

            <button id="gt-auth-btn" type="submit" style="width:100%; padding:14px; background:#f59e0b; color:#0f172a; font-weight:800; font-size:14px; border:none; border-radius:11px; cursor:pointer; text-transform:uppercase; letter-spacing:0.08em; transition:background 0.2s;">
              ENTER TRACKER ➔
            </button>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    let activeTab = 'login';
    window.__switchAuthTab = function (tab) {
      activeTab = tab;
      const tabLog = document.getElementById('gt-tab-login');
      const tabReg = document.getElementById('gt-tab-register');
      const nameGroup = document.getElementById('gt-name-group');
      const btn = document.getElementById('gt-auth-btn');
      const err = document.getElementById('gt-auth-error');
      if (err) err.style.display = 'none';

      if (tab === 'login') {
        tabLog.style.color = '#38bdf8';
        tabLog.style.borderBottomColor = '#38bdf8';
        tabReg.style.color = '#64748b';
        tabReg.style.borderBottomColor = 'transparent';
        nameGroup.style.display = 'none';
        btn.textContent = 'ENTER TRACKER ➔';
      } else {
        tabReg.style.color = '#38bdf8';
        tabReg.style.borderBottomColor = '#38bdf8';
        tabLog.style.color = '#64748b';
        tabLog.style.borderBottomColor = 'transparent';
        nameGroup.style.display = 'block';
        btn.textContent = 'CREATE ACCOUNT & ENTER ➔';
      }
    };

    window.__handleAuthSubmit = async function (e) {
      e.preventDefault();
      const email = document.getElementById('gt-auth-email').value.trim();
      const password = document.getElementById('gt-auth-password').value;
      const name = (document.getElementById('gt-auth-name').value || '').trim();
      const errEl = document.getElementById('gt-auth-error');

      errEl.style.display = 'none';

      try {
        let resp, data;
        if (activeTab === 'login') {
          resp = await fetch(SYNC_CONFIG.authLoginEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
          });
        } else {
          resp = await fetch(SYNC_CONFIG.authRegisterEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, display_name: name || email.split('@')[0] })
          });
        }

        data = await resp.json();
        if (!resp.ok || !data.success) {
          errEl.textContent = data.detail || data.error || 'Authentication failed. Please check credentials.';
          errEl.style.display = 'block';
          return;
        }

        setAuthToken(data.session_token || data.token);
        currentUser = data.user;
        modal.remove();
        updateUserBar();

        // Proceed to initialize room or history
        init();
      } catch (err) {
        errEl.textContent = 'Connection error. Please try again.';
        errEl.style.display = 'block';
      }
    };
  }

  function updateUserBar() {
    if (!currentUser) return;
    let bar = document.getElementById('gt-user-status-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'gt-user-status-bar';
      bar.style.cssText = "position:fixed; top:12px; left:16px; z-index:99998; display:flex; align-items:center; gap:8px; background:rgba(15,23,42,0.92); border:1px solid rgba(255,255,255,0.1); backdrop-filter:blur(10px); padding:6px 12px; border-radius:9999px; font-family:'Inter',sans-serif; font-size:12px; color:#f8fafc;";
      document.body.appendChild(bar);
    }
    bar.innerHTML = `
      <span style="width:8px; height:8px; border-radius:50%; background:#38bdf8;"></span>
      <span style="color:#94a3b8;">Player:</span>
      <b style="color:#f8fafc;">${currentUser.display_name || currentUser.email}</b>
    `;
  }

  // 3. Initialize Match Room / Join / Create
  async function init() {
    const isAuthed = await checkAuth();
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

      // Join room to bind Player 2 slot or Spectator
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

      startRealtimeStream();
    } else {
      // Landing page (/11th/tracker or /tracker) -> Pure DB History
      hookNewGameButton();
      syncHistoryFromDatabase();
    }
  }

  // 4. Hook "+ NEW GAME" Button to use Collision-Free Creator API
  function hookNewGameButton() {
    const observer = new MutationObserver(() => {
      const btn = document.querySelector('button:has(svg.lucide-plus), button[class*="New Game"], button');
      if (btn && btn.textContent.includes('New Game') && !btn.__hooked) {
        btn.__hooked = true;
        btn.onclick = async function (e) {
          e.preventDefault();
          e.stopPropagation();
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
              window.location.href = `/11th/tracker/play?match_id=${data.match_id}`;
              return;
            }
          } catch (err) {}
          window.location.href = '/11th/tracker/play';
        };
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // 5. PostgreSQL Database as Sole Source of Truth for History
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

  // 6. Broadcast State with Role & Session Validation
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

  // 7. Floating Multiplayer Status HUD with Role Badge
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
        <button onclick="navigator.clipboard.writeText(window.location.href); alert('🔗 Room Link Copied! Share with your opponent or spectators.');" style="background:#0284c7; color:#fff; border:none; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; margin-left:4px;">
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
