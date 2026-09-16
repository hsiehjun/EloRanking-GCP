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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

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
    if (!matchId || isSpectator || isRemoteUpdating) return;
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
    syncFromRemote();
    setInterval(() => {
      if (!firestoreConnected) {
        syncFromRemote();
      }
    }, 1000);
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

  // =========================================================================
  // TOURNAMENT TOOL SUITE: CHESS CLOCK, DICE ROLLER, JUDGE, LISTS, FINISH
  // =========================================================================

  // 1. Table Chess Clock
  const chessClock = {
    visible: false,
    running: false,
    activePlayer: 1,
    p1Remaining: 4500, // 75 mins
    p2Remaining: 4500,
    roundRemaining: 9000,
    lastStartTime: null,
    durationMinutes: 75
  };

  function getEffectiveClockTimes() {
    if (!chessClock.running || !chessClock.lastStartTime) {
      return { p1: chessClock.p1Remaining, p2: chessClock.p2Remaining, round: chessClock.roundRemaining };
    }
    const elapsed = Math.floor((Date.now() - chessClock.lastStartTime) / 1000);
    let p1 = chessClock.p1Remaining;
    let p2 = chessClock.p2Remaining;
    let rnd = Math.max(0, chessClock.roundRemaining - elapsed);
    if (chessClock.activePlayer === 1) p1 = Math.max(0, p1 - elapsed);
    else p2 = Math.max(0, p2 - elapsed);
    return { p1, p2, round: rnd };
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  window.gtToggleChessClock = function() {
    chessClock.visible = !chessClock.visible;
    mountChessClockHud();
  };

  window.gtToggleClockPlayPause = function() {
    if (chessClock.running) {
      const t = getEffectiveClockTimes();
      chessClock.p1Remaining = t.p1;
      chessClock.p2Remaining = t.p2;
      chessClock.roundRemaining = t.round;
      chessClock.running = false;
      chessClock.lastStartTime = null;
    } else {
      chessClock.running = true;
      chessClock.lastStartTime = Date.now();
    }
    updateClockDom();
  };

  window.gtSwitchClockTurn = function(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (chessClock.running) {
      const t = getEffectiveClockTimes();
      chessClock.p1Remaining = t.p1;
      chessClock.p2Remaining = t.p2;
      chessClock.roundRemaining = t.round;
      chessClock.lastStartTime = Date.now();
    }
    chessClock.activePlayer = chessClock.activePlayer === 1 ? 2 : 1;
    updateClockDom();
  };

  window.gtAdjustPlayerTime = function(playerNum, deltaSec) {
    const t = getEffectiveClockTimes();
    if (playerNum === 1) chessClock.p1Remaining = Math.max(0, t.p1 + deltaSec);
    else chessClock.p2Remaining = Math.max(0, t.p2 + deltaSec);
    if (chessClock.running) chessClock.lastStartTime = Date.now();
    updateClockDom();
  };

  window.gtHandlePlayerBoxClick = function(playerNum, e) {
    if (e && e.target && (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'SELECT')) return;
    if (chessClock.activePlayer === playerNum) {
      window.gtSwitchClockTurn(e);
    }
  };

  window.gtHandleClockPresetChange = function(val) {
    const mins = parseInt(val, 10) || 75;
    chessClock.durationMinutes = mins;
    chessClock.p1Remaining = mins * 60;
    chessClock.p2Remaining = mins * 60;
    chessClock.roundRemaining = mins * 120;
    chessClock.running = false;
    chessClock.lastStartTime = null;
    updateClockDom();
  };

  function mountChessClockHud() {
    let clockEl = document.getElementById('gt-chess-clock-hud');
    if (!clockEl) {
      clockEl = document.createElement('div');
      clockEl.id = 'gt-chess-clock-hud';
      clockEl.innerHTML = `
        <div class="gt-clock-header-row">
          <div class="gt-clock-meta-badge">
            <span class="gt-clock-meta-title">⏱️ CLOCK</span>
            <span id="gt-clock-round-time" class="gt-clock-round-time">(Round: 150:00)</span>
          </div>
          <div class="gt-clock-header-controls">
            <button id="gt-clock-play-pause-btn" class="gt-clock-play-pause-btn" onclick="window.gtToggleClockPlayPause()">▶️ Start</button>
            <select id="gt-clock-duration-select" class="gt-clock-select" onchange="window.gtHandleClockPresetChange(this.value)">
              <option value="90">90m</option>
              <option value="75" selected>75m</option>
              <option value="60">60m</option>
              <option value="45">45m</option>
              <option value="30">30m</option>
            </select>
            <button id="gt-clock-close-btn" class="gt-clock-close-btn" onclick="window.gtToggleChessClock()" title="Hide Clock">✕</button>
          </div>
        </div>
        <div class="gt-clock-main-row">
          <div id="gt-clock-p1-box" class="gt-clock-player-box" onclick="window.gtHandlePlayerBoxClick(1, event)" title="Tap to switch turn">
            <div class="gt-clock-player-header">
              <span id="gt-clock-p1-name" class="gt-clock-player-name">Player 1</span>
              <div class="gt-clock-nudge-group">
                <button class="gt-clock-nudge-btn" onclick="event.stopPropagation(); window.gtAdjustPlayerTime(1, -60)">-1m</button>
                <button class="gt-clock-nudge-btn" onclick="event.stopPropagation(); window.gtAdjustPlayerTime(1, 60)">+1m</button>
              </div>
            </div>
            <div id="gt-clock-p1-time" class="gt-clock-time">75:00</div>
          </div>
          <button id="gt-clock-pass-btn" class="gt-clock-switch-btn" onclick="window.gtSwitchClockTurn(event)" title="Tap to switch active clock turn">
            <span class="gt-clock-pass-icon">🔄</span>
            <span class="gt-clock-pass-text">PASS TURN</span>
          </button>
          <div id="gt-clock-p2-box" class="gt-clock-player-box" onclick="window.gtHandlePlayerBoxClick(2, event)" title="Tap to switch turn">
            <div class="gt-clock-player-header">
              <span id="gt-clock-p2-name" class="gt-clock-player-name">Player 2</span>
              <div class="gt-clock-nudge-group">
                <button class="gt-clock-nudge-btn" onclick="event.stopPropagation(); window.gtAdjustPlayerTime(2, -60)">-1m</button>
                <button class="gt-clock-nudge-btn" onclick="event.stopPropagation(); window.gtAdjustPlayerTime(2, 60)">+1m</button>
              </div>
            </div>
            <div id="gt-clock-p2-time" class="gt-clock-time">75:00</div>
          </div>
        </div>
      `;
      document.body.appendChild(clockEl);
    }
    clockEl.style.display = chessClock.visible ? 'flex' : 'none';
    updateClockDom();
  }

  function updateClockDom() {
    const clockEl = document.getElementById('gt-chess-clock-hud');
    if (!clockEl || !chessClock.visible) return;
    const st = getAosState() || {};
    const p1Name = st.p1?.name || 'Player 1';
    const p2Name = st.p2?.name || 'Player 2';
    const times = getEffectiveClockTimes();

    const p1Box = document.getElementById('gt-clock-p1-box');
    const p2Box = document.getElementById('gt-clock-p2-box');
    const p1NameEl = document.getElementById('gt-clock-p1-name');
    const p2NameEl = document.getElementById('gt-clock-p2-name');
    const p1TimeEl = document.getElementById('gt-clock-p1-time');
    const p2TimeEl = document.getElementById('gt-clock-p2-time');
    const roundTimeEl = document.getElementById('gt-clock-round-time');
    const ppBtn = document.getElementById('gt-clock-play-pause-btn');

    if (p1NameEl) p1NameEl.textContent = `${p1Name} ${chessClock.activePlayer === 1 ? '▶' : ''}`;
    if (p2NameEl) p2NameEl.textContent = `${p2Name} ${chessClock.activePlayer === 2 ? '▶' : ''}`;
    if (p1TimeEl) p1TimeEl.textContent = formatTime(times.p1);
    if (p2TimeEl) p2TimeEl.textContent = formatTime(times.p2);
    if (roundTimeEl) roundTimeEl.textContent = `(Round: ${formatTime(times.round)})`;
    if (ppBtn) ppBtn.textContent = chessClock.running ? '⏸️ Pause' : '▶️ Start';

    if (p1Box) p1Box.className = `gt-clock-player-box ${chessClock.activePlayer === 1 ? 'active-turn' : ''} ${times.p1 <= 300 ? 'low-time' : ''}`;
    if (p2Box) p2Box.className = `gt-clock-player-box ${chessClock.activePlayer === 2 ? 'active-turn' : ''} ${times.p2 <= 300 ? 'low-time' : ''}`;
  }

  setInterval(() => {
    if (chessClock.visible && chessClock.running) {
      updateClockDom();
    }
  }, 1000);

  // 2. Interactive Synced Tabletop Dice Roller
  const diceRollerState = {
    visible: false,
    tray: [
      { val: 1, rolled: false, selected: false },
      { val: 2, rolled: false, selected: false },
      { val: 3, rolled: false, selected: false },
      { val: 4, rolled: false, selected: false },
      { val: 5, rolled: false, selected: false }
    ],
    target: 4
  };

  window.gtToggleDiceRoller = function() {
    diceRollerState.visible = !diceRollerState.visible;
    mountDiceRollerModal();
  };

  window.gtAddDice = function(num) {
    for (let i = 0; i < num; i++) {
      if (diceRollerState.tray.length < 100) {
        diceRollerState.tray.push({ val: 1, rolled: false, selected: false });
      }
    }
    renderDiceRollerContent();
  };

  window.gtClearTray = function() {
    diceRollerState.tray = [];
    renderDiceRollerContent();
  };

  window.gtSetDiceTarget = function(t) {
    diceRollerState.target = t;
    renderDiceRollerContent();
  };

  window.gtRollTray = function() {
    diceRollerState.tray.forEach(d => {
      d.val = Math.floor(Math.random() * 6) + 1;
      d.rolled = true;
    });
    renderDiceRollerContent();
  };

  window.gtRerollSelected = function() {
    diceRollerState.tray.forEach(d => {
      if (d.selected) {
        d.val = Math.floor(Math.random() * 6) + 1;
        d.rolled = true;
        d.selected = false;
      }
    });
    renderDiceRollerContent();
  };

  window.gtToggleDieSelection = function(idx) {
    if (diceRollerState.tray[idx]) {
      diceRollerState.tray[idx].selected = !diceRollerState.tray[idx].selected;
      renderDiceRollerContent();
    }
  };

  window.gtSelectAll = function(select) {
    diceRollerState.tray.forEach(d => { d.selected = Boolean(select); });
    renderDiceRollerContent();
  };

  window.gtSelectPass = function() {
    diceRollerState.tray.forEach(d => { d.selected = (d.val >= diceRollerState.target); });
    renderDiceRollerContent();
  };

  window.gtSelectFails = function() {
    diceRollerState.tray.forEach(d => { d.selected = (d.val < diceRollerState.target); });
    renderDiceRollerContent();
  };

  window.gtSelectCrits = function() {
    diceRollerState.tray.forEach(d => { d.selected = (d.val === 6); });
    renderDiceRollerContent();
  };

  window.gtSelectOnes = function() {
    diceRollerState.tray.forEach(d => { d.selected = (d.val === 1); });
    renderDiceRollerContent();
  };

  function mountDiceRollerModal() {
    let modal = document.getElementById('gt-dice-roller-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'gt-dice-roller-modal';
      document.body.appendChild(modal);
    }
    if (!diceRollerState.visible) {
      modal.style.display = 'none';
      return;
    }
    modal.style.display = 'flex';
    renderDiceRollerContent();
  }

  function renderDiceRollerContent() {
    const modal = document.getElementById('gt-dice-roller-modal');
    if (!modal || !diceRollerState.visible) return;

    const tray = diceRollerState.tray || [];
    const totalInTray = tray.length;
    const selectedCount = tray.filter(d => d.selected).length;
    const target = diceRollerState.target;
    const rolledDice = tray.filter(d => d.rolled);
    const hasRolled = rolledDice.length > 0;
    const passCount = target > 0 ? rolledDice.filter(d => d.val >= target).length : rolledDice.length;
    const critCount = rolledDice.filter(d => d.val === 6).length;
    const failCount = target > 0 ? rolledDice.filter(d => d.val < target).length : 0;
    const sum = rolledDice.reduce((a, b) => a + (b.val || 0), 0);

    modal.innerHTML = `
      <div class="gt-dice-header">
        <div style="display:flex; align-items:center; gap:6px; font-weight:800; font-family:'JetBrains Mono',monospace; font-size:12px; color:#f59e0b;">
          <span>🎲</span>
          <span>AOS DICE TRAY</span>
          <span style="background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.3); font-size:9px; padding:1px 5px; border-radius:4px; color:#f59e0b;">SYNCED</span>
        </div>
        <button onclick="window.gtToggleDiceRoller()" style="background:transparent; border:none; color:#94a3b8; font-size:16px; cursor:pointer; padding:0 4px;" title="Close Dice Tray">✕</button>
      </div>
      <div class="gt-dice-body">
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#cbd5e1; font-weight:700;">
            <span>DICE IN TRAY: <b style="color:#f59e0b; font-size:13px; font-family:'JetBrains Mono',monospace;">${totalInTray}</b> <span style="color:#94a3b8; font-size:10px;">(${selectedCount} selected)</span></span>
            <span style="font-size:10px; color:#64748b;">(Max: 100)</span>
          </div>
          <div style="display:flex; gap:4px; align-items:center;">
            <button class="gt-dice-quick-btn" onclick="window.gtAddDice(1)">+1</button>
            <button class="gt-dice-quick-btn" onclick="window.gtAddDice(5)">+5</button>
            <button class="gt-dice-quick-btn" onclick="window.gtAddDice(10)">+10</button>
            <button class="gt-dice-quick-btn" onclick="window.gtAddDice(20)">+20</button>
            <button class="gt-dice-quick-btn" style="color:#ef4444;" onclick="window.gtClearTray()">Clear</button>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="font-size:11px; color:#cbd5e1; font-weight:700;">SUCCESS THRESHOLD:</div>
          <div style="display:flex; gap:4px;">
            ${[2, 3, 4, 5, 6].map(t => `
              <button class="gt-dice-target-pill ${Number(target) === t ? 'active' : ''}" style="flex:1; text-align:center; font-family:'JetBrains Mono',monospace;" onclick="window.gtSetDiceTarget(${t})">
                ${t}+
              </button>
            `).join('')}
            <button class="gt-dice-target-pill ${Number(target) === 0 ? 'active' : ''}" style="flex:1; text-align:center;" onclick="window.gtSetDiceTarget(0)">
              Raw
            </button>
          </div>
        </div>
        <div class="gt-dice-tray">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:4px;">
            <span style="font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase;">DICE (${totalInTray})</span>
            ${totalInTray > 0 ? `
              <div style="display:flex; gap:4px; font-size:9px;">
                <button class="gt-dice-quick-btn" style="padding:1px 5px; font-size:9px;" onclick="window.gtSelectAll(true)">All</button>
                ${hasRolled && target > 0 ? `
                  <button class="gt-dice-quick-btn" style="padding:1px 5px; font-size:9px; color:#10b981;" onclick="window.gtSelectPass()">Pass (${passCount})</button>
                  <button class="gt-dice-quick-btn" style="padding:1px 5px; font-size:9px; color:#ef4444;" onclick="window.gtSelectFails()">Fails (${failCount})</button>
                ` : ''}
                ${hasRolled && rolledDice.some(d => d.val === 6) ? `
                  <button class="gt-dice-quick-btn" style="padding:1px 5px; font-size:9px; color:#f59e0b;" onclick="window.gtSelectCrits()">6s (${critCount})</button>
                ` : ''}
                <button class="gt-dice-quick-btn" style="padding:1px 5px; font-size:9px; color:#94a3b8;" onclick="window.gtSelectAll(false)">None</button>
              </div>
            ` : ''}
          </div>
          ${hasRolled ? `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.35); border-radius:6px; padding:4px 8px; font-size:11px; font-weight:800;">
              ${target > 0 ? `
                <span style="color:#10b981;">✅ ${passCount} Pass (${target}+)</span>
                ${critCount > 0 ? `<span style="color:#f59e0b;">⭐ ${critCount} Crit (6s)</span>` : ''}
                <span style="color:#ef4444;">❌ ${failCount} Fail</span>
              ` : `
                <span style="color:#38bdf8;">🎲 ${rolledDice.length} Rolled (Sum: ${sum})</span>
              `}
            </div>
          ` : ''}
          <div class="gt-dice-grid">
            ${totalInTray === 0 ? `
              <div style="width:100%; text-align:center; color:#64748b; font-size:11px; padding:16px 0;">
                Tray is empty. Tap <b style="color:#f59e0b;">+5</b> or <b style="color:#f59e0b;">+10</b> to add dice.
              </div>
            ` : tray.map((die, idx) => {
              let cls = 'gt-die-unrolled';
              if (die.rolled) {
                if (target > 0) {
                  if (die.val === 6) cls = 'gt-die-crit';
                  else if (die.val >= target) cls = 'gt-die-success';
                  else cls = 'gt-die-fail';
                } else {
                  if (die.val === 6) cls = 'gt-die-crit';
                  else cls = 'gt-die-neutral';
                }
              }
              const selCls = die.selected ? 'selected' : 'unselected';
              return `<span class="gt-die-pip ${cls} ${selCls}" onclick="window.gtToggleDieSelection(${idx})">${die.rolled ? die.val : '•'}</span>`;
            }).join('')}
          </div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="gt-dice-roll-btn" onclick="window.gtRollTray()">🎲 Roll All (${totalInTray})</button>
          ${selectedCount > 0 ? `
            <button class="gt-dice-roll-btn" style="background:#0284c7; flex:0.6;" onclick="window.gtRerollSelected()">🔄 Reroll (${selectedCount})</button>
          ` : ''}
        </div>
      </div>
    `;
  }

  // 3. Tournament Floor Judge Modal
  let activeJudgeCall = null;
  window.gtOpenJudgeModal = function() {
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

  window.gtSubmitJudgeCall = function(reason) {
    activeJudgeCall = {
      id: 'call_' + Date.now(),
      status: 'pending',
      category: reason,
      timestamp: Date.now()
    };
    injectMobileBottomDock();
    injectAosSyncHUD();
    renderJudgeModal();
  };

  window.gtCancelJudgeCall = function() {
    activeJudgeCall = null;
    injectMobileBottomDock();
    injectAosSyncHUD();
    window.gtCloseJudgeModal();
  };

  function renderJudgeModal() {
    const modal = document.getElementById('gt-judge-modal');
    if (!modal) return;
    const st = getAosState() || {};

    if (activeJudgeCall && activeJudgeCall.status === 'pending') {
      modal.innerHTML = `
        <div class="gt-judge-dialog" style="max-width:440px; background:#0f172a; border:1px solid #334155; border-radius:14px; padding:20px; color:#fff; font-family:'Inter',system-ui,sans-serif;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
            <span style="font-size:24px;">🚨</span>
            <h3 style="margin:0; font-size:18px; font-weight:800;">Floor Judge Dispatched</h3>
          </div>
          <p style="font-size:13px; color:#cbd5e1; margin-bottom:16px;">
            A tournament judge has been alerted for <b style="color:#f43f5e;">${escapeHtml(activeJudgeCall.category)}</b>. Please pause play and wait at your table.
          </p>
          <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button onclick="window.gtCancelJudgeCall()" style="background:#334155; color:#fff; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">Cancel Request</button>
            <button onclick="window.gtCloseJudgeModal()" style="background:#0284c7; color:#fff; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">Close</button>
          </div>
        </div>
      `;
      return;
    }

    modal.innerHTML = `
      <div class="gt-judge-dialog" style="max-width:440px; background:#0f172a; border:1px solid #334155; border-radius:14px; padding:20px; color:#fff; font-family:'Inter',system-ui,sans-serif;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:20px;">🙋‍♂️</span>
            <h3 style="margin:0; font-size:18px; font-weight:800;">Call Tournament Judge</h3>
          </div>
          <button onclick="window.gtCloseJudgeModal()" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;">✕</button>
        </div>
        <p style="font-size:13px; color:#94a3b8; margin-bottom:16px;">Select the primary reason for your ruling request:</p>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:20px;">
          ${['Rules / Ability Interpretation', 'Line of Sight / Cover Dispute', 'Measurement / Coherency Check', 'Slow Play / Time Concern', 'Other Floor Dispute'].map(r => `
            <button onclick="window.gtSubmitJudgeCall('${r}')" style="background:#1e293b; color:#f1f5f9; border:1px solid #334155; padding:10px 14px; border-radius:8px; font-size:13px; font-weight:600; text-align:left; cursor:pointer; transition:all 0.15s;" onmouseover="this.style.background='#334155'" onmouseout="this.style.background='#1e293b'">
              ${r} →
            </button>
          `).join('')}
        </div>
        <div style="display:flex; justify-content:flex-end;">
          <button onclick="window.gtCloseJudgeModal()" style="background:transparent; color:#94a3b8; border:none; padding:6px 12px; cursor:pointer;">Close</button>
        </div>
      </div>
    `;
  }

  // 4. Match Completion Modal (50 VP Scale)
  window.__openCompleteModal = function() {
    const state = getAosState() || {};
    const summary = calculateAosSummary(state) || {
      p1Name: 'Player 1', p1Score: 0, p1Primary: 0, p1Tactics: 0,
      p2Name: 'Player 2', p2Score: 0, p2Primary: 0, p2Tactics: 0,
      winner: 'Draw'
    };

    let modal = document.getElementById('gt-complete-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'gt-complete-modal';
      modal.style.cssText = `
        position: fixed; inset: 0; z-index: 100001; background: rgba(3, 7, 18, 0.85);
        backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px;
      `;
      document.body.appendChild(modal);
    }
    modal.style.display = 'flex';

    modal.innerHTML = `
      <div style="max-width:480px; width:100%; background:#0f172a; border:1px solid #334155; border-radius:16px; box-shadow:0 25px 60px rgba(0,0,0,0.9); overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#fff;">
        <div style="background:linear-gradient(135deg, #059669, #047857); padding:16px 20px; display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:22px;">🏁</span>
            <h3 style="margin:0; font-size:18px; font-weight:800; text-transform:uppercase; letter-spacing:0.04em;">Finalize AoS Match</h3>
          </div>
          <button onclick="document.getElementById('gt-complete-modal').style.display='none'" style="background:transparent; border:none; color:#fff; font-size:20px; cursor:pointer;">✕</button>
        </div>
        <div style="padding:20px;">
          <div style="text-align:center; margin-bottom:16px;">
            <div style="font-size:12px; color:#94a3b8; font-weight:700; text-transform:uppercase;">Battle Result</div>
            <div style="font-size:26px; font-weight:900; color:#f59e0b; margin-top:4px;">${escapeHtml(summary.winner)}</div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px;">
            <div style="background:#1e293b; border:1px solid #38bdf8; border-radius:10px; padding:12px; text-align:center;">
              <div style="font-size:13px; font-weight:800; color:#38bdf8;">${escapeHtml(summary.p1Name)}</div>
              <div style="font-size:32px; font-weight:900; font-family:'JetBrains Mono',monospace; color:#fff; margin:4px 0;">${summary.p1Score}</div>
              <div style="font-size:11px; color:#94a3b8;">Pri: ${summary.p1Primary}/30 • Tac: ${summary.p1Tactics}/20</div>
            </div>
            <div style="background:#1e293b; border:1px solid #f43f5e; border-radius:10px; padding:12px; text-align:center;">
              <div style="font-size:13px; font-weight:800; color:#f43f5e;">${escapeHtml(summary.p2Name)}</div>
              <div style="font-size:32px; font-weight:900; font-family:'JetBrains Mono',monospace; color:#fff; margin:4px 0;">${summary.p2Score}</div>
              <div style="font-size:11px; color:#94a3b8;">Pri: ${summary.p2Primary}/30 • Tac: ${summary.p2Tactics}/20</div>
            </div>
          </div>
          <p style="font-size:12px; color:#94a3b8; line-height:1.5; margin-bottom:20px;">
            Submitting will conclude the match, lock the scorecard, and record the outcome into the tournament system.
          </p>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button onclick="document.getElementById('gt-complete-modal').style.display='none'" style="background:#334155; color:#cbd5e1; border:none; padding:10px 18px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer;">
              Return to Match
            </button>
            <button onclick="window.gtFinalizeAosMatch()" style="background:linear-gradient(135deg, #059669, #10b981); color:#fff; border:none; padding:10px 20px; border-radius:8px; font-size:13px; font-weight:800; cursor:pointer;">
              ✓ Confirm & Submit
            </button>
          </div>
        </div>
      </div>
    `;
  };

  window.gtFinalizeAosMatch = async function() {
    const state = getAosState() || {};
    state.is_finished = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent('aos_state_change', { detail: state }));
    if (matchId) {
      try {
        await fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/finalize`, { method: 'POST' });
      } catch(e) {}
    }
    const modal = document.getElementById('gt-complete-modal');
    if (modal) modal.style.display = 'none';
    if (matchId) {
      window.location.replace(`/scorecard/${encodeURIComponent(matchId)}`);
    } else {
      alert('Match completed successfully!');
    }
  };

  // 5. Army Lists Modal
  window.gtOpenArmyListModal = function(tab = 'opponent') {
    let modal = document.getElementById('gt-army-list-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'gt-army-list-modal';
      document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    renderArmyListModal(tab);
  };

  window.gtCloseArmyListModal = function() {
    const modal = document.getElementById('gt-army-list-modal');
    if (modal) modal.style.display = 'none';
  };

  function renderArmyListModal(activeTab = 'opponent') {
    const modal = document.getElementById('gt-army-list-modal');
    if (!modal) return;
    const st = getAosState() || {};
    const p1 = st.p1 || {};
    const p2 = st.p2 || {};

    const isP1 = role === 'player1';
    const myPlayer = isP1 ? p1 : p2;
    const oppPlayer = isP1 ? p2 : p1;
    const activePlayer = activeTab === 'my' ? myPlayer : oppPlayer;

    modal.innerHTML = `
      <div class="gt-modal-dialog" style="max-width:600px; background:#0b1120; border:1px solid #273042; border-radius:16px; overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#fff;">
        <div class="gt-modal-header" style="background:#0f172a; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.08);">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:20px;">📋</span>
            <h3 style="margin:0; font-size:16px; font-weight:800;">Army Warscroll Lists</h3>
          </div>
          <button onclick="window.gtCloseArmyListModal()" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;">✕</button>
        </div>
        <div style="display:flex; border-bottom:1px solid #273042; background:#070b14;">
          <button class="gt-tab-btn ${activeTab === 'opponent' ? 'active' : ''}" onclick="window.gtOpenArmyListModal('opponent')" style="flex:1; padding:12px; font-weight:700; border:none; cursor:pointer;">
            Opponent (${escapeHtml(oppPlayer.name || 'P2')})
          </button>
          <button class="gt-tab-btn ${activeTab === 'my' ? 'active' : ''}" onclick="window.gtOpenArmyListModal('my')" style="flex:1; padding:12px; font-weight:700; border:none; cursor:pointer;">
            My List (${escapeHtml(myPlayer.name || 'P1')})
          </button>
        </div>
        <div class="gt-modal-body" style="padding:20px; max-height:60vh; overflow-y:auto;">
          <div style="margin-bottom:16px;">
            <div style="font-size:16px; font-weight:800; color:#f59e0b;">${escapeHtml(activePlayer.name || 'Player')}</div>
            <div style="font-size:13px; color:#38bdf8; font-family:'JetBrains Mono',monospace;">
              ${escapeHtml(activePlayer.grandAlliance || 'Order')} • ${escapeHtml(activePlayer.faction || 'Faction')}
            </div>
            ${activePlayer.battleFormation ? `<div style="font-size:12px; color:#94a3b8; margin-top:2px;">Battle Formation: <b>${escapeHtml(activePlayer.battleFormation)}</b></div>` : ''}
          </div>
          <div style="background:#12161f; border:1px solid #273042; border-radius:10px; padding:16px; color:#cbd5e1; font-size:13px; line-height:1.6;">
            <p style="margin:0 0 8px 0; color:#94a3b8; font-size:11px; text-transform:uppercase; font-weight:700;">Warscroll Manifest</p>
            <div>Official Age of Sigmar 4th Edition Warscroll & Roster integrated via Best Coast Pairings / NewRecruit.</div>
          </div>
        </div>
      </div>
    `;
  }

  // 6. Scorecard Link
  window.__openScorecardModal = function() {
    if (matchId) {
      window.open(`/scorecard/${encodeURIComponent(matchId)}`, '_blank');
    } else {
      alert('Match ID not found. Please ensure you are inside an active match.');
    }
  };

  // 7. Mobile Bottom Action Dock (Finish, Dice, Judge, Clock, Score, Lists)
  function injectMobileBottomDock() {
    let dock = document.getElementById('gt-mobile-bottom-dock');
    if (!dock) {
      dock = document.createElement('nav');
      dock.id = 'gt-mobile-bottom-dock';
      dock.className = 'gt-mobile-bottom-dock';
      document.body.appendChild(dock);
    }

    document.body.classList.add('has-mobile-dock');
    dock.style.display = 'flex';

    const judgeCall = activeJudgeCall;
    let judgeIcon = '🙋‍♂️';
    let judgeText = 'Judge';
    let judgeExtraClass = '';
    if (judgeCall && judgeCall.status === 'en_route') {
      judgeIcon = '🏃‍♂️';
      judgeText = 'En Route';
      judgeExtraClass = 'en-route';
    } else if (judgeCall && judgeCall.status === 'pending') {
      judgeIcon = '🚨';
      judgeText = 'Pending';
      judgeExtraClass = 'pending';
    } else if (judgeCall && judgeCall.status === 'resolved') {
      judgeIcon = '✅';
      judgeText = 'Resolved';
      judgeExtraClass = 'resolved';
    }

    dock.innerHTML = `
      ${!isSpectator ? `
        <button type="button" class="gt-dock-btn gt-dock-finish" onclick="window.__openCompleteModal()" title="Complete Match">
          <span class="gt-dock-icon">🏁</span>
          <span class="gt-dock-label">Finish</span>
        </button>
      ` : ''}
      <button type="button" class="gt-dock-btn gt-dock-dice" onclick="window.gtToggleDiceRoller()" title="Dice Roller">
        <span class="gt-dock-icon">🎲</span>
        <span class="gt-dock-label">Dice</span>
      </button>
      ${!isSpectator ? `
        <button type="button" class="gt-dock-btn gt-dock-judge ${judgeExtraClass}" onclick="window.gtOpenJudgeModal()" title="Tournament Judge">
          <span class="gt-dock-icon">${judgeIcon}</span>
          <span class="gt-dock-label">${judgeText}</span>
        </button>
      ` : ''}
      <button type="button" class="gt-dock-btn gt-dock-clock" onclick="window.gtToggleChessClock()" title="Table Chess Clock">
        <span class="gt-dock-icon">⏱️</span>
        <span class="gt-dock-label">Clock</span>
      </button>
      <button type="button" class="gt-dock-btn" style="background:rgba(245,158,11,0.15); border-color:rgba(245,158,11,0.4); color:#fbbf24;" onclick="window.__openScorecardModal()" title="View Scorecard">
        <span class="gt-dock-icon">📄</span>
        <span class="gt-dock-label">Score</span>
      </button>
      <button type="button" class="gt-dock-btn" style="background:rgba(56,189,248,0.15); border-color:rgba(56,189,248,0.4); color:#38bdf8;" onclick="window.gtOpenArmyListModal('opponent')" title="View Army Lists">
        <span class="gt-dock-icon">📋</span>
        <span class="gt-dock-label">Lists</span>
      </button>
    `;
  }

  // 8. Inject AoS Sync HUD (Desktop and Mobile)
  function injectAosSyncHUD() {
    let hud = document.getElementById('aos-sync-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'aos-sync-hud';
      hud.className = 'aos-sync-hud';
      document.body.prepend(hud);
      document.body.style.paddingTop = '36px';
    }

    hud.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
      background: rgba(18, 22, 31, 0.95); border-bottom: 1px solid #273042;
      backdrop-filter: blur(8px); padding: 5px 16px;
      display: flex; justify-content: space-between; align-items: center;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #f0f4fc;
      gap: 8px; flex-wrap: nowrap; overflow: hidden;
    `;

    const st = getAosState() || {};
    const p1Name = st.p1?.name || 'Player 1';
    const p2Name = st.p2?.name || 'Player 2';
    const isP1 = role === 'player1';

    hud.innerHTML = `
      <!-- Left: Hub & Lobby Navigation & Match Tag -->
      <div style="display:inline-flex; align-items:center; gap:6px; flex-shrink:0;">
        <a href="/aos#my-hub" style="display:inline-flex; align-items:center; gap:3px; color:#38bdf8; text-decoration:none; font-size:11px; font-weight:800; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.25); padding:4px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace; cursor:pointer;">
          🏠 Hub
        </a>
        <a href="/11th/tracker/aos" style="display:inline-flex; align-items:center; gap:3px; color:#f59e0b; text-decoration:none; font-size:11px; font-weight:800; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.25); padding:4px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace; cursor:pointer;">
          🎲 Lobby
        </a>
        <span style="font-family:'JetBrains Mono',monospace; color:#f59e0b; font-size:11px; background:#070b14; padding:4px 7px; border-radius:6px; border:1px solid #334155; font-weight:800;">
          #${matchId || 'AOS-LOCAL'}
        </span>
        ${isSpectator ? `
          <span style="font-family:'JetBrains Mono',monospace; color:#cbd5e1; font-size:11px; background:rgba(100,116,139,0.25); border:1px solid rgba(148,163,184,0.3); padding:4px 8px; border-radius:6px; font-weight:800; display:inline-flex; align-items:center; gap:4px;">
            👀 Spectator
          </span>
        ` : ''}
      </div>

      <!-- Center: Connected Players Matchup -->
      <div class="gt-desktop-actions" style="display:inline-flex; align-items:center; gap:6px; font-weight:800; font-family:'JetBrains Mono',monospace; font-size:11px; padding:0 6px; flex-shrink:0;">
        <span style="width:7px; height:7px; border-radius:50%; background:#10b981; flex-shrink:0;"></span>
        <span style="${isP1 ? 'color:#38bdf8; font-weight:700;' : 'color:#cbd5e1;'}">${escapeHtml(p1Name)}</span>
        <span style="color:#64748b; font-size:10px;">vs</span>
        <span style="${!isP1 ? 'color:#f43f5e; font-weight:700;' : 'color:#cbd5e1;'}">${escapeHtml(p2Name)}</span>
      </div>

      <!-- Right: Action Buttons (Desktop / Wide Screen) -->
      <div class="gt-desktop-actions" style="display:inline-flex; align-items:center; gap:6px; flex-shrink:0;">
        <button onclick="window.gtToggleChessClock()" style="background:#0f172a; color:#38bdf8; border:1px solid rgba(56,189,248,0.4); padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Open Table Chess Clock">
          ⏱️ Table Clock
        </button>
        <button onclick="window.gtToggleDiceRoller()" style="background:#0f172a; color:#f59e0b; border:1px solid rgba(245,158,11,0.4); padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Open Synchronized Dice Tray">
          🎲 Dice
        </button>
        ${!isSpectator ? `
          <button onclick="window.gtOpenJudgeModal()" style="background:#881337; color:#fff; border:1px solid #f43f5e; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Call Tournament Judge">
            🙋‍♂️ Call Judge
          </button>
        ` : ''}
        <button onclick="window.gtOpenArmyListModal('opponent')" style="background:#1e293b; color:#fff; border:1px solid #334155; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="View Opponent's List">
          📜 Opponent List
        </button>
        <button onclick="window.gtOpenArmyListModal('my')" style="background:#1e293b; color:#fff; border:1px solid #334155; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="View Your List">
          📋 My List
        </button>
        <button onclick="window.__openScorecardModal()" style="background:rgba(245,158,11,0.12); color:#f59e0b; border:1px solid rgba(245,158,11,0.3); padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Open Scorecard">
          📄 Scorecard
        </button>
        ${!isSpectator ? `
          <button onclick="window.__openCompleteModal()" style="background:#059669; color:#fff; border:1px solid #10b981; padding:4px 9px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Complete Game">
            🏁 Finish
          </button>
        ` : ''}
        <button onclick="const shareUrl = window.location.origin + '/11th/tracker/aos?match_id=' + encodeURIComponent('${matchId || ''}') + '&role=player2'; navigator.clipboard.writeText(shareUrl); alert('🔗 Player 2 Invite Link Copied! Share with your opponent.');" style="background:#0284c7; color:#fff; border:none; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;" title="Copy Match Link">
          🔗 Share
        </button>
      </div>

      <!-- Mobile Top Links -->
      <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;" class="md:hidden">
        <a href="/aos#my-hub" style="color:#94a3b8; text-decoration:none; font-size:11px; white-space:nowrap;">← Hub</a>
        <a href="/scorecard/${encodeURIComponent(matchId || '')}" target="_blank" style="color:#f59e0b; text-decoration:none; font-weight:700; font-size:11px; white-space:nowrap; display:inline-flex; align-items:center; gap:2px;">📄 Scorecard</a>
      </div>
    `;

    injectMobileBottomDock();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectAosSyncHUD();
      injectMobileBottomDock();
    });
  } else {
    injectAosSyncHUD();
    injectMobileBottomDock();
  }

  // Expose global helper for testing
  window.__getAosSummary = () => calculateAosSummary(getAosState());
})();
