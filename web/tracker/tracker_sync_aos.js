/**
 * OmniTactica Age of Sigmar (AoS) Real-time Game Sync & Multiplayer HUD
 * Completely decoupled from 40k. Operates strictly on `omni-aos-tracker-state`.
 * 50 VP scale, Battle Tactics tracking, Priority Roll integration, and BCP AoS Game System ID.
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'omni-aos-tracker-state';
  const HISTORY_KEY = 'omni-aos-tracker-history';
  const AOS_SYSTEM_ID = 'OY8FCPBf6O'; // Best Coast Pairings canonical AoS Game System ID

  const urlParams = new URLSearchParams(window.location.search);
  const matchId = urlParams.get('match_id') || urlParams.get('room') || null;
  const isSpectator = urlParams.get('role') === 'spectator';

  console.log(`⚡ [AoS Tracker Sync] Initialized. Match: ${matchId || 'Local (No Room)'}, Spectator: ${isSpectator}`);

  function getAosState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function calculateAosSummary(state) {
    if (!state || !state.p1 || !state.p2) return null;
    const p1 = state.p1;
    const p2 = state.p2;

    const p1Pri = (p1.rounds || []).reduce((sum, r) => sum + (r.primaryScore || 0), 0);
    const p1Tac = (p1.rounds || []).reduce((sum, r) => sum + (r.tacticScore || 0), 0);
    const p1Score = Math.min(50, p1Pri + p1Tac);
    const p1TacticsDone = (p1.rounds || []).filter(r => r.tacticStatus === 'achieved').length;

    const p2Pri = (p2.rounds || []).reduce((sum, r) => sum + (r.primaryScore || 0), 0);
    const p2Tac = (p2.rounds || []).reduce((sum, r) => sum + (r.tacticScore || 0), 0);
    const p2Score = Math.min(50, p2Pri + p2Tac);
    const p2TacticsDone = (p2.rounds || []).filter(r => r.tacticStatus === 'achieved').length;

    let winner = 'Tie / Draw';
    if (p1Score > p2Score) winner = p1.name;
    else if (p2Score > p1Score) winner = p2.name;

    return {
      matchId: matchId || state.id,
      system: 'aos',
      edition: '4e-ghb24',
      p1Name: p1.name,
      p1Score,
      p1Primary: p1Pri,
      p1Tactics: p1Tac,
      p1TacticsDone,
      p2Name: p2.name,
      p2Score,
      p2Primary: p2Pri,
      p2Tactics: p2Tac,
      p2TacticsDone,
      round: state.round || 1,
      isFinished: Boolean(state.is_finished),
      winner
    };
  }

  let lastBroadcastVersion = 0;
  let currentRemoteVersion = 0;
  let broadcastTimer = null;
  let isRemoteUpdating = false;

  const role = urlParams.get('role') || 'player1';

  let trackerFirestoreDb = null;
  function getTrackerFirestoreDb() {
    if (trackerFirestoreDb) return trackerFirestoreDb;
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      try {
        if (!firebase.apps || !firebase.apps.length) {
          firebase.initializeApp({ projectId: "eloranking-506820" });
        }
        trackerFirestoreDb = firebase.firestore();
        return trackerFirestoreDb;
      } catch (e) {
        console.debug('[AoS Firestore Init] Notice:', e);
      }
    }
    return null;
  }

  // Broadcast state updates to dev_server and Cloud Firestore
  function broadcastAosState() {
    if (!matchId || isSpectator || role === 'player2' || isRemoteUpdating) return;
    if (broadcastTimer) clearTimeout(broadcastTimer);

    broadcastTimer = setTimeout(async () => {
      const state = getAosState();
      if (!state) return;
      const ver = Date.now();
      lastBroadcastVersion = ver;

      // 1. Direct Cloud Firestore broadcast if client SDK is active
      try {
        const db = getTrackerFirestoreDb();
        if (db && matchId) {
          db.collection('rooms').doc(matchId).set({
            match_id: matchId,
            game_system: 'aos',
            version: ver,
            state: state,
            is_finished: !!state.is_finished,
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true }).catch(() => {});
        }
      } catch (e) {}

      // 2. Local REST dev_server & PostgreSQL persistent storage
      try {
        await fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            match_id: matchId,
            game_system: 'aos',
            version: ver,
            state
          })
        });
      } catch (e) {
        // Offline fallback
      }
    }, 60);
  }

  // Direct Firestore real-time onSnapshot listener
  let fsDocUnsub = null;
  let firestoreConnected = false;
  function initFirestoreDirectSync() {
    if (!matchId) return;
    const db = getTrackerFirestoreDb();
    if (db) {
      try {
        if (fsDocUnsub) fsDocUnsub();
        fsDocUnsub = db.collection('rooms').doc(matchId).onSnapshot((snap) => {
          firestoreConnected = true;
          if (!snap || !snap.exists) return;
          const data = snap.data();
          if (data && data.state && (!currentRemoteVersion || (data.version && data.version > currentRemoteVersion))) {
            currentRemoteVersion = data.version || Date.now();
            isRemoteUpdating = true;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data.state));
            window.dispatchEvent(new CustomEvent('aos_remote_sync', { detail: data.state }));
            setTimeout(() => { isRemoteUpdating = false; }, 100);
          }
        }, (err) => {
          firestoreConnected = false;
          console.debug('[AoS Firestore onSnapshot] Notice:', err);
        });
      } catch (e) {
        console.debug('[AoS Firestore Direct Sync] Notice:', e);
      }
    }
  }

  // Poll remote room if spectator or non-host player (HTTP fallback)
  async function syncFromRemote() {
    if (!matchId) return;
    try {
      const resp = await fetch(`/api/tracker/room/${encodeURIComponent(matchId)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.state && (!currentRemoteVersion || (data.version && data.version > currentRemoteVersion))) {
          currentRemoteVersion = data.version || Date.now();
          isRemoteUpdating = true;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data.state));
          window.dispatchEvent(new CustomEvent('aos_remote_sync', { detail: data.state }));
          setTimeout(() => { isRemoteUpdating = false; }, 100);
        }
      }
    } catch (e) {}
  }

  if (matchId) {
    initFirestoreDirectSync();
    if (isSpectator || role === 'player2') {
      syncFromRemote();
      setInterval(() => {
        if (!firestoreConnected) {
          syncFromRemote();
        }
      }, 1000);
    }
  }

  // Listen to state mutations
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      broadcastAosState();
    }
  });
  window.addEventListener('aos_state_change', () => {
    broadcastAosState();
  });

  // Inject AoS Sync HUD
  function injectAosSyncHUD() {
    if (!matchId) return;
    const existing = document.getElementById('aos-sync-hud');
    if (existing) return;

    const hud = document.createElement('div');
    hud.id = 'aos-sync-hud';
    hud.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
      background: rgba(18, 22, 31, 0.95); border-bottom: 1px solid #273042;
      backdrop-filter: blur(8px); padding: 6px 12px;
      display: flex; justify-content: space-between; align-items: center;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #f0f4fc;
      gap: 6px; flex-wrap: nowrap; overflow: hidden;
    `;

    hud.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px; min-width:0; flex-shrink:1; overflow:hidden;">
        <span style="color:#f59e0b; font-weight:800; white-space:nowrap;">⚡ AOS:</span>
        <span style="color:#38bdf8; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${matchId}</span>
        ${isSpectator ? '<span style="background:rgba(239,68,68,0.2); color:#ef4444; padding:1px 5px; border-radius:4px; font-weight:700; font-size:10px; white-space:nowrap;">SPECTATOR</span>' : '<span style="background:rgba(16,185,129,0.2); color:#10b981; padding:1px 5px; border-radius:4px; font-weight:700; font-size:10px; white-space:nowrap;">SYNC</span>'}
      </div>
      <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
        <a href="/app" style="color:#94a3b8; text-decoration:none; font-size:11px; white-space:nowrap;">← Hub</a>
        <a href="/scorecard/${encodeURIComponent(matchId)}" target="_blank" style="color:#f59e0b; text-decoration:none; font-weight:700; font-size:11px; white-space:nowrap; display:inline-flex; align-items:center; gap:2px;">📄 Scorecard</a>
      </div>
    `;

    document.body.prepend(hud);
    document.body.style.paddingTop = '36px';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectAosSyncHUD);
  } else {
    injectAosSyncHUD();
  }

  // Expose global helper for testing
  window.__getAosSummary = () => calculateAosSummary(getAosState());
})();
