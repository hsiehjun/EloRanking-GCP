/**
 * Synchronized Multiplayer Overlay Client for Static Game Tracker
 * Persists and broadcasts local state changes in real time across clients.
 */

(function () {
  'use strict';

  console.log('[Multiplayer Overlay] Initializing Synchronized Multiplayer Engine...');

  const SYNC_CONFIG = {
    apiBase: '/api/tracker/room',
    debounceMs: 150,
    pollIntervalMs: 2500
  };

  let clientState = {
    matchId: null,
    role: 'editor', // 'owner', 'editor', 'spectator'
    clientId: 'client_' + Math.random().toString(36).substring(2, 9),
    version: 0,
    connected: false,
    onlineCount: 1,
    isApplyingRemote: false,
    eventSource: null,
    debounceTimer: null
  };

  // 1. Initialize Match ID & Role from URL
  function initRoomFromUrl() {
    const params = new URLSearchParams(window.location.search);
    let matchId = params.get('match_id') || params.get('room') || params.get('match');
    let role = params.get('role') || 'editor';

    if (!matchId) {
      // Check if previously stored
      matchId = sessionStorage.getItem('gt_active_match_id');
    }

    if (matchId) {
      clientState.matchId = matchId.toUpperCase();
      clientState.role = role.toLowerCase();
      sessionStorage.setItem('gt_active_match_id', clientState.matchId);
      updateUrl(clientState.matchId, clientState.role);
    }
  }

  function updateUrl(matchId, role) {
    const url = new URL(window.location.href);
    url.searchParams.set('match_id', matchId);
    if (role && role !== 'editor') {
      url.searchParams.set('role', role);
    } else {
      url.searchParams.delete('role');
    }
    window.history.replaceState({}, '', url.toString());
  }

  // 2. Intercept localStorage Changes
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
  const originalClear = window.localStorage.clear.bind(window.localStorage);

  function serializeStorageState() {
    const state = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('gdm') || key.startsWith('tracker') || key.startsWith('gtk') || key.includes('game') || key.includes('edition'))) {
        state[key] = localStorage.getItem(key);
      }
    }
    return state;
  }

  function applyRemoteStorageState(remoteState) {
    if (!remoteState || typeof remoteState !== 'object') return;
    clientState.isApplyingRemote = true;

    try {
      for (const [key, val] of Object.entries(remoteState)) {
        if (val !== null && val !== undefined) {
          const currentVal = localStorage.getItem(key);
          if (currentVal !== val) {
            originalSetItem(key, val);
            // Dispatch standard storage event to trigger Next.js / React listener re-renders
            try {
              window.dispatchEvent(new StorageEvent('storage', {
                key: key,
                newValue: val,
                oldValue: currentVal,
                url: window.location.href,
                storageArea: localStorage
              }));
            } catch (e) {}
          }
        }
      }
    } finally {
      setTimeout(() => {
        clientState.isApplyingRemote = false;
      }, 50);
    }
  }

  function notifyLocalStateChanged() {
    if (clientState.isApplyingRemote) return;
    if (clientState.role === 'spectator') {
      console.warn('[Multiplayer Overlay] Local changes suppressed in Spectator mode');
      return;
    }
    if (!clientState.matchId) return;

    clearTimeout(clientState.debounceTimer);
    clientState.debounceTimer = setTimeout(() => {
      broadcastCurrentState();
    }, SYNC_CONFIG.debounceMs);
  }

  window.localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    notifyLocalStateChanged();
  };

  window.localStorage.removeItem = function (key) {
    originalRemoveItem(key);
    notifyLocalStateChanged();
  };

  window.localStorage.clear = function () {
    originalClear();
    notifyLocalStateChanged();
  };

  // 3. Network Broadcast & Real-Time Sync
  async function broadcastCurrentState() {
    if (!clientState.matchId) return;
    const payload = {
      match_id: clientState.matchId,
      client_id: clientState.clientId,
      role: clientState.role,
      version: ++clientState.version,
      state: serializeStorageState()
    };

    setSyncDotState('syncing');

    try {
      const resp = await fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        setSyncDotState('connected');
      }
    } catch (err) {
      console.warn('[Multiplayer Overlay] Broadcast notice:', err);
      setSyncDotState('connected');
    }
  }

  async function fetchRemoteState() {
    if (!clientState.matchId) return;
    try {
      const resp = await fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.state) {
          if (data.version > clientState.version || clientState.version === 0) {
            clientState.version = data.version || 1;
            applyRemoteStorageState(data.state);
          }
        }
      }
    } catch (err) {
      console.warn('[Multiplayer Overlay] Fetch state notice:', err);
    }
  }

  function startRealtimeStream() {
    if (!clientState.matchId) return;

    // Close existing SSE if any
    if (clientState.eventSource) {
      clientState.eventSource.close();
    }

    try {
      const sseUrl = `${SYNC_CONFIG.apiBase}/${clientState.matchId}/stream?client_id=${clientState.clientId}`;
      const es = new EventSource(sseUrl);
      clientState.eventSource = es;

      es.onopen = () => {
        clientState.connected = true;
        setSyncDotState('connected');
        updateHud();
      };

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state_update') {
            if (msg.sender !== clientState.clientId && msg.state) {
              if (msg.version >= clientState.version) {
                clientState.version = msg.version;
                applyRemoteStorageState(msg.state);
              }
            }
          } else if (msg.type === 'presence') {
            clientState.onlineCount = msg.count || 1;
            updateHud();
          }
        } catch (e) {}
      };

      es.onerror = () => {
        clientState.connected = false;
        setSyncDotState('disconnected');
      };
    } catch (e) {
      // Fallback to periodic polling if SSE unsupported
      setInterval(fetchRemoteState, SYNC_CONFIG.pollIntervalMs);
    }
  }

  // 4. Floating Multiplayer HUD UI
  function renderMultiplayerOverlay() {
    if (document.getElementById('gt-sync-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'gt-sync-overlay';
    overlay.innerHTML = `
      <span class="gt-sync-dot ${clientState.connected ? '' : 'disconnected'}" id="gt-sync-dot"></span>
      <span id="gt-sync-label" class="gt-sync-room-tag">
        ${clientState.matchId ? `#${clientState.matchId}` : 'Multiplayer: Off'}
      </span>
      <span class="gt-sync-role-chip ${clientState.role}" id="gt-sync-role-label">
        ${clientState.role.toUpperCase()}
      </span>
      <button class="gt-sync-btn" onclick="window.gtMultiplayer.openShareModal()">
        ${clientState.matchId ? '🔗 Share' : '➕ Host Room'}
      </button>
    `;
    document.body.appendChild(overlay);

    renderShareModal();
  }

  function renderShareModal() {
    if (document.getElementById('gt-sync-modal-backdrop')) return;

    const modal = document.createElement('div');
    modal.id = 'gt-sync-modal-backdrop';
    modal.innerHTML = `
      <div class="gt-sync-modal-box">
        <div class="gt-sync-modal-header">
          <h3>⚡ Synchronized Multiplayer Match</h3>
          <button class="gt-sync-modal-close" onclick="window.gtMultiplayer.closeShareModal()">&times;</button>
        </div>
        
        <p style="font-size: 12px; color: #94a3b8; margin: 0 0 12px 0; line-height: 1.4;">
          Share this live synchronized game with your opponent, club members, or stream spectators. Any score, CP, or card change updates instantly across all connected screens.
        </p>

        <div style="font-size: 11px; font-weight: 700; color: #38bdf8; text-transform: uppercase;">Match Share Link</div>
        <div class="gt-sync-url-box">
          <input type="text" id="gt-sync-share-url" class="gt-sync-url-input" readonly value="">
          <button class="gt-sync-btn" style="padding: 6px 12px;" onclick="window.gtMultiplayer.copyRoomLink()">📋 Copy</button>
        </div>

        <div style="font-size: 11px; font-weight: 700; color: #38bdf8; text-transform: uppercase; margin-bottom: 6px;">Your Match Role</div>
        <div class="gt-sync-role-select-grid">
          <div class="gt-sync-role-option ${clientState.role === 'owner' ? 'selected' : ''}" onclick="window.gtMultiplayer.setRole('owner')">
            <div style="font-size: 13px;">👑 Owner</div>
            <div style="font-size: 10px; color: #94a3b8;">Host & Full Edit</div>
          </div>
          <div class="gt-sync-role-option ${clientState.role === 'editor' ? 'selected' : ''}" onclick="window.gtMultiplayer.setRole('editor')">
            <div style="font-size: 13px;">✏️ Editor</div>
            <div style="font-size: 10px; color: #94a3b8;">Player / Scoring</div>
          </div>
          <div class="gt-sync-role-option ${clientState.role === 'spectator' ? 'selected' : ''}" onclick="window.gtMultiplayer.setRole('spectator')">
            <div style="font-size: 13px;">👀 Spectator</div>
            <div style="font-size: 10px; color: #94a3b8;">Live Read-Only</div>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px;">
          <button class="gt-sync-btn" style="background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.3); color: #ef4444;" onclick="window.gtMultiplayer.leaveRoom()">Disconnect</button>
          <button class="gt-sync-btn" style="padding: 6px 14px;" onclick="window.gtMultiplayer.createNewRoom()">Generate New Room Code</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function setSyncDotState(status) {
    const dot = document.getElementById('gt-sync-dot');
    if (!dot) return;
    dot.className = 'gt-sync-dot ' + (status === 'disconnected' ? 'disconnected' : status === 'syncing' ? 'syncing' : '');
  }

  function updateHud() {
    const label = document.getElementById('gt-sync-label');
    const roleLabel = document.getElementById('gt-sync-role-label');
    if (label) {
      label.textContent = clientState.matchId ? `#${clientState.matchId}` : 'Multiplayer: Off';
    }
    if (roleLabel) {
      roleLabel.textContent = clientState.role.toUpperCase();
      roleLabel.className = `gt-sync-role-chip ${clientState.role}`;
    }
  }

  // 5. Global API & Controls
  window.gtMultiplayer = {
    createNewRoom: function () {
      const newId = 'WH40K-' + Math.random().toString(36).substring(2, 7).toUpperCase();
      clientState.matchId = newId;
      clientState.role = 'owner';
      sessionStorage.setItem('gt_active_match_id', newId);
      updateUrl(newId, clientState.role);
      updateHud();
      startRealtimeStream();
      broadcastCurrentState();
      this.openShareModal();
    },

    openShareModal: function () {
      if (!clientState.matchId) {
        this.createNewRoom();
        return;
      }
      const modal = document.getElementById('gt-sync-modal-backdrop');
      const input = document.getElementById('gt-sync-share-url');
      if (input) {
        input.value = `${window.location.origin}/tracker?match_id=${clientState.matchId}`;
      }
      if (modal) modal.classList.add('active');
    },

    closeShareModal: function () {
      const modal = document.getElementById('gt-sync-modal-backdrop');
      if (modal) modal.classList.remove('active');
    },

    copyRoomLink: function () {
      const input = document.getElementById('gt-sync-share-url');
      if (input) {
        navigator.clipboard.writeText(input.value).then(() => {
          alert('🔗 Multiplayer Room link copied to clipboard!');
        });
      }
    },

    setRole: function (role) {
      clientState.role = role;
      updateUrl(clientState.matchId, role);
      updateHud();
      this.closeShareModal();
    },

    leaveRoom: function () {
      if (clientState.eventSource) clientState.eventSource.close();
      clientState.matchId = null;
      sessionStorage.removeItem('gt_active_match_id');
      const url = new URL(window.location.href);
      url.searchParams.delete('match_id');
      url.searchParams.delete('role');
      window.history.replaceState({}, '', url.toString());
      this.closeShareModal();
      updateHud();
      setSyncDotState('disconnected');
    }
  };

  // Initialize on load
  window.addEventListener('DOMContentLoaded', () => {
    initRoomFromUrl();
    renderMultiplayerOverlay();
    if (clientState.matchId) {
      startRealtimeStream();
      fetchRemoteState();
    }
  });

})();
