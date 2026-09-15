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

  // Broadcast state updates to dev_server or Firestore room
  async function broadcastAosState() {
    if (!matchId || isSpectator) return;
    const state = getAosState();
    if (!state) return;

    try {
      // 1. Write to local dev_server / Firestore API
      await fetch(`/api/tracker/${encodeURIComponent(matchId)}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: matchId,
          game_system: 'aos',
          version: Date.now(),
          state
        })
      });
    } catch (e) {
      // Offline fallback
    }
  }

  // Poll remote room if spectator
  if (matchId && isSpectator) {
    setInterval(async () => {
      try {
        const resp = await fetch(`/api/tracker/${encodeURIComponent(matchId)}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.state) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data.state));
            window.dispatchEvent(new Event('storage'));
          }
        }
      } catch (e) {}
    }, 2500);
  }

  // Listen to state mutations
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      broadcastAosState();
    }
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
      backdrop-filter: blur(8px); padding: 6px 16px;
      display: flex; justify-content: space-between; align-items: center;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #f0f4fc;
    `;

    hud.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="color:#f59e0b; font-weight:800;">⚡ AOS ROOM:</span>
        <span style="color:#38bdf8; font-weight:700;">${matchId}</span>
        ${isSpectator ? '<span style="background:rgba(239,68,68,0.2); color:#ef4444; padding:1px 6px; border-radius:4px; font-weight:700;">LIVE SPECTATOR</span>' : '<span style="background:rgba(16,185,129,0.2); color:#10b981; padding:1px 6px; border-radius:4px; font-weight:700;">LIVE SYNC</span>'}
      </div>
      <div>
        <a href="/app" style="color:#94a3b8; text-decoration:none; margin-right:8px;">← App Hub</a>
        <a href="/scorecard/${encodeURIComponent(matchId)}" target="_blank" style="color:#f59e0b; text-decoration:none; font-weight:700;">📄 Live Scorecard</a>
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
