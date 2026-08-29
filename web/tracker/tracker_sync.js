/**
 * Synchronized Multiplayer & PostgreSQL Database Bridge for GDM 11th Edition Game Tracker
 */

(function () {
  'use strict';

  console.log('[GDM Sync Bridge] Initializing real-time multiplayer and database synchronization...');

  const SYNC_CONFIG = {
    apiBase: '/api/tracker/room',
    historyEndpoint: '/api/tracker/history',
    debounceMs: 120
  };

  let clientState = {
    matchId: null,
    role: 'editor',
    clientId: 'client_' + Math.random().toString(36).substring(2, 9),
    version: 0,
    onlineCount: 1,
    isApplyingRemote: false,
    eventSource: null,
    debounceTimer: null
  };

  // 1. Storage interceptors
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);

  // 2. Initialize Match Room on /play
  function initRoom() {
    const params = new URLSearchParams(window.location.search);
    let matchId = params.get('match_id') || params.get('room') || params.get('match');
    let role = params.get('role') || 'editor';

    const isPlay = window.location.pathname.includes('/play');

    if (isPlay) {
      if (!matchId) {
        matchId = sessionStorage.getItem('gt_active_match_id') || ('WH40K-' + Math.random().toString(36).substring(2, 7).toUpperCase());
      }
      clientState.matchId = matchId.toUpperCase();
      clientState.role = role.toLowerCase();
      sessionStorage.setItem('gt_active_match_id', clientState.matchId);

      const url = new URL(window.location.href);
      url.searchParams.set('match_id', clientState.matchId);
      window.history.replaceState({}, '', url.toString());

      injectMultiplayerHUD();
      fetchRemoteState();
      startRealtimeStream();
    } else {
      // Landing page (/11th/tracker or /tracker) -> sync database history
      syncHistoryFromDatabase();
    }
  }

  // 3. Sync Database History to GDM Landing Page
  async function syncHistoryFromDatabase() {
    try {
      const resp = await fetch(SYNC_CONFIG.historyEndpoint);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.history && Array.isArray(data.history)) {
          const gdmHistory = data.history.map(item => {
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

          originalSetItem('gdm-11e-tracker-history', JSON.stringify(gdmHistory));
          window.dispatchEvent(new StorageEvent('storage', {
            key: 'gdm-11e-tracker-history',
            newValue: JSON.stringify(gdmHistory),
            storageArea: localStorage
          }));
        }
      }
    } catch (e) {
      console.debug('History sync notice:', e);
    }
  }

  // 4. Intercept Local State Changes
  function notifyStateChanged() {
    if (clientState.isApplyingRemote) return;
    if (clientState.role === 'spectator') return;
    if (!clientState.matchId) return;

    clearTimeout(clientState.debounceTimer);
    clientState.debounceTimer = setTimeout(() => {
      broadcastState();
    }, SYNC_CONFIG.debounceMs);
  }

  window.localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (key === 'gdm-11e-tracker-state') {
      notifyStateChanged();
    }
  };

  window.localStorage.removeItem = function (key) {
    originalRemoveItem(key);
    if (key === 'gdm-11e-tracker-state') {
      notifyStateChanged();
    }
  };

  // 5. Broadcast & Stream
  async function broadcastState() {
    if (!clientState.matchId) return;
    const raw = localStorage.getItem('gdm-11e-tracker-state');
    if (!raw) return;

    let parsedState = {};
    try { parsedState = JSON.parse(raw); } catch (e) { return; }

    clientState.version++;
    try {
      await fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: clientState.matchId,
          client_id: clientState.clientId,
          role: clientState.role,
          version: clientState.version,
          state: parsedState
        })
      });
    } catch (e) {}
  }

  async function fetchRemoteState() {
    if (!clientState.matchId) return;
    try {
      const resp = await fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.state && Object.keys(data.state).length > 0) {
          if (data.version >= clientState.version) {
            clientState.version = data.version;
            applyRemoteState(data.state);
          }
        }
      }
    } catch (e) {}
  }

  function applyRemoteState(incoming) {
    clientState.isApplyingRemote = true;
    try {
      const serialized = typeof incoming === 'string' ? incoming : JSON.stringify(incoming);
      const current = localStorage.getItem('gdm-11e-tracker-state');
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

  // 6. Floating Multiplayer HUD
  function injectMultiplayerHUD() {
    if (document.getElementById('gt-sync-hud')) return;

    const hud = document.createElement('div');
    hud.id = 'gt-sync-hud';
    hud.innerHTML = `
      <div style="position:fixed; top:12px; right:16px; z-index:99999; display:flex; align-items:center; gap:8px; background:rgba(15,23,42,0.92); border:1px solid rgba(56,189,248,0.35); box-shadow:0 8px 30px rgba(0,0,0,0.5); backdrop-filter:blur(10px); padding:6px 12px; border-radius:9999px; font-family:'Inter',sans-serif; font-size:12px; color:#f8fafc;">
        <span style="width:8px; height:8px; border-radius:50%; background:#10b981; display:inline-block; box-shadow:0 0 8px #10b981;"></span>
        <b style="font-family:'JetBrains Mono',monospace; color:#38bdf8;">#${clientState.matchId}</b>
        <span style="color:#64748b;">•</span>
        <span id="gt-hud-online" style="color:#94a3b8;">1 online</span>
        <button onclick="navigator.clipboard.writeText(window.location.href); alert('🔗 Room Link Copied!');" style="background:#0284c7; color:#fff; border:none; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; margin-left:4px;">
          🔗 Share
        </button>
      </div>
    `;
    document.body.appendChild(hud);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initRoom();
  });

})();
