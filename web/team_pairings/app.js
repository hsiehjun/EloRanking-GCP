/**
 * OmniTactica • Warhammer 40K Team Pairings Minigame (Admin PoC)
 *
 * Implements the WTC Simultaneous Secret Card Pairing Protocol:
 *   Step 1: Put Defender (1 secret card from each Captain's bench) -> Simultaneous Reveal
 *   Step 2: Send 2 Attackers (2 secret cards from each Captain's bench vs opponent's Defender) -> Simultaneous Reveal
 *   Step 3: Defender Picks 1 of the 2 Attackers -> Locks 2 Tables + Returns Rejected Attackers to Bench
 *   Final Cycle: Auto-pairs remaining players (Table 5 in 5v5, Tables 7 & 8 Rejected-vs-Forgotten in 8v8)
 *
 * Access & Role Enforcement:
 *   - Page route (/admin/team-pairings) is Admin-only.
 *   - Inside a Firestore Pairing Room: anyone can join as Spectator (read-only),
 *     while only Captain A (1 player) and Captain B (1 player) can select and lock cards.
 */
(function () {
  'use strict';

  const FACTION_META = {
    'T\'au Empire': { icon: '🎯', color: '#38bdf8' },
    'Adeptus Custodes': { icon: '🦅', color: '#f59e0b' },
    'Aeldari': { icon: '🔮', color: '#a855f7' },
    'World Eaters': { icon: '🩸', color: '#ef4444' },
    'Necrons': { icon: '💀', color: '#10b981' },
    'Astra Militarum': { icon: '🛡️', color: '#84cc16' },
    'Grey Knights': { icon: '⚔️', color: '#94a3b8' },
    'Tyranids': { icon: '🦂', color: '#ec4899' },
    'Chaos Space Marines': { icon: '🔥', color: '#f97316' },
    'Thousand Sons': { icon: '👁️', color: '#6366f1' },
    'Orks': { icon: '🪓', color: '#22c55e' },
    'Space Marines': { icon: '⚡', color: '#3b82f6' },
    'Death Guard': { icon: '☣️', color: '#65a30d' },
    'Blood Angels': { icon: '🩸', color: '#dc2626' },
    'Dark Angels': { icon: '🗡️', color: '#15803d' },
    'Drukhari': { icon: '🕷️', color: '#c026d3' },
    'Sisters of Battle': { icon: '⚜️', color: '#e11d48' },
    'Chaos Daemons': { icon: '👹', color: '#9333ea' },
    'Chaos Knights': { icon: '🤖', color: '#ea580c' },
    'Imperial Knights': { icon: '🏰', color: '#0284c7' },
    'Leagues of Votann': { icon: '⛏️', color: '#eab308' },
    'Adeptus Mechanicus': { icon: '⚙️', color: '#dc2626' },
    'Black Templars': { icon: '✝️', color: '#cbd5e1' },
    'Space Wolves': { icon: '🐺', color: '#60a5fa' },
    'Genestealer Cults': { icon: '🧬', color: '#a21caf' },
  };

  const FACTION_MATCHUP_EDGES = {
    'T\'au Empire': { 'Death Guard': 3, 'World Eaters': 2, 'Aeldari': -2, 'Imperial Knights': 2, 'Orks': 2 },
    'Adeptus Custodes': { 'World Eaters': 3, 'Orks': 2, 'T\'au Empire': -2, 'Thousand Sons': -3, 'Chaos Knights': 2 },
    'Aeldari': { 'T\'au Empire': 2, 'Thousand Sons': 2, 'Astra Militarum': -2, 'Necrons': 2, 'Imperial Knights': 3 },
    'World Eaters': { 'Necrons': 2, 'Chaos Space Marines': 2, 'Adeptus Custodes': -3, 'Blood Angels': 1, 'T\'au Empire': -2 },
    'Necrons': { 'Astra Militarum': 2, 'Space Marines': 2, 'World Eaters': -2, 'Aeldari': -2, 'Tyranids': 2 },
    'Thousand Sons': { 'Adeptus Custodes': 3, 'Death Guard': 3, 'Aeldari': -2, 'Sisters of Battle': 2, 'Grey Knights': -2 },
    'Chaos Space Marines': { 'Space Marines': 2, 'Tyranids': 2, 'World Eaters': -2, 'Astra Militarum': 2 },
    'Orks': { 'Tyranids': 2, 'Drukhari': 3, 'Adeptus Custodes': -2, 'T\'au Empire': -2 },
    'Astra Militarum': { 'Aeldari': 2, 'Chaos Daemons': 2, 'Necrons': -2, 'Chaos Space Marines': -2 },
    'Space Marines': { 'Tyranids': 2, 'Orks': 1, 'Chaos Space Marines': -2, 'Necrons': -2 },
    'Death Guard': { 'World Eaters': 2, 'Orks': 3, 'T\'au Empire': -3, 'Thousand Sons': -3 },
    'Blood Angels': { 'Aeldari': 2, 'Drukhari': 2, 'Death Guard': -2, 'Adeptus Custodes': -2 },
    'Dark Angels': { 'Chaos Daemons': 2, 'World Eaters': 2, 'T\'au Empire': -2 },
    'Drukhari': { 'Imperial Knights': 3, 'Chaos Knights': 3, 'Orks': -3, 'Blood Angels': -2 },
    'Sisters of Battle': { 'Chaos Daemons': 2, 'Grey Knights': 2, 'Thousand Sons': -2 },
    'Chaos Daemons': { 'Imperial Knights': 2, 'Necrons': 2, 'Grey Knights': -3, 'Sisters of Battle': -2 },
    'Grey Knights': { 'Chaos Daemons': 3, 'Thousand Sons': 2, 'Sisters of Battle': -2 },
    'Tyranids': { 'Astra Militarum': 2, 'Genestealer Cults': 2, 'Space Marines': -2, 'Necrons': -2 },
  };

  function getFactionMeta(faction) {
    return FACTION_META[faction] || { icon: '⚔️', color: '#38bdf8' };
  }

  function estimateWtcMatchup(playerA, playerB) {
    if (!playerA || !playerB) {
      return { expected_a: 10, expected_b: 10, label: '10 - 10 (Even)', tier: 'even' };
    }
    const fa = playerA.faction || '';
    const fb = playerB.faction || '';
    let edge = 0;
    if (FACTION_MATCHUP_EDGES[fa] && typeof FACTION_MATCHUP_EDGES[fa][fb] === 'number') {
      edge = FACTION_MATCHUP_EDGES[fa][fb];
    } else if (FACTION_MATCHUP_EDGES[fb] && typeof FACTION_MATCHUP_EDGES[fb][fa] === 'number') {
      edge = -FACTION_MATCHUP_EDGES[fb][fa];
    }
    const eloA = Number(playerA.elo || 1800);
    const eloB = Number(playerB.elo || 1800);
    const eloShift = Math.round((eloA - eloB) / 55);
    const expA = Math.max(4, Math.min(16, 10 + edge + eloShift));
    const expB = 20 - expA;
    let tier = 'even';
    let verdict = 'Even Clash';
    if (expA >= 13) {
      tier = 'favored_a';
      verdict = 'Favored';
    } else if (expA >= 11) {
      tier = 'slight_a';
      verdict = 'Slight Edge';
    } else if (expA <= 7) {
      tier = 'favored_b';
      verdict = 'Rough Matchup';
    } else if (expA <= 9) {
      tier = 'slight_b';
      verdict = 'Disfavored';
    }
    return {
      expected_a: expA,
      expected_b: expB,
      label: `${expA} - ${expB} (${verdict})`,
      tier: tier,
    };
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  class TeamPairingsApp {
    constructor() {
      this.roomState = null;
      this.roomCode = null;
      this.activeRole = 'captain_a'; // 'captain_a' | 'captain_b' | 'spectator'
      this.tokens = {
        captain_a: null,
        captain_b: null,
      };
      this.selectedPlayerIds = [];
      this.pollTimer = null;
      this.isBusy = false;
    }

    async init() {
      this.bindEvents();
      const params = new URLSearchParams(window.location.search);
      const urlRoom = (params.get('room') || '').trim().toUpperCase();
      const urlRole = (params.get('role') || '').trim().toLowerCase();
      if (urlRole === 'captain_a' || urlRole === 'captain_b' || urlRole === 'spectator') {
        this.activeRole = urlRole;
      }

      if (urlRoom) {
        const joinInput = document.getElementById('joinRoomInput');
        if (joinInput) joinInput.value = urlRoom;
        await this.joinRoom(urlRoom);
      } else {
        await this.createNewRoom();
      }

      const demoState = (params.get('demo_state') || '').trim().toLowerCase();
      if (demoState && this.roomState) {
        if (demoState === 'step2') {
          this.toggleCardSelection('A1', 'A', 'bench');
          await this.lockCurrentSelection();
          const benchA = (this.roomState.team_a?.roster || []).filter((p) => p.status === 'bench');
          if (benchA.length >= 2) {
            this.toggleCardSelection(benchA[0].id, 'A', 'bench');
            this.toggleCardSelection(benchA[1].id, 'A', 'bench');
          }
        } else if (demoState === 'step3_spectator') {
          this.toggleCardSelection('A1', 'A', 'bench');
          await this.lockCurrentSelection();
          const benchA = (this.roomState.team_a?.roster || []).filter((p) => p.status === 'bench');
          if (benchA.length >= 2) {
            this.toggleCardSelection(benchA[0].id, 'A', 'bench');
            this.toggleCardSelection(benchA[1].id, 'A', 'bench');
            await this.lockCurrentSelection();
          }
          await this.switchRole('spectator');
        } else if (demoState === 'completed') {
          await this.autoCompleteRemainingPairings();
        }
      }

      this.startRoomSyncTimer();
    }

    bindEvents() {
      const btnNewMatch = document.getElementById('btnNewMatch');
      if (btnNewMatch) {
        btnNewMatch.addEventListener('click', () => this.createNewRoom());
      }

      const btnAutoFinish = document.getElementById('btnAutoFinish');
      if (btnAutoFinish) {
        btnAutoFinish.addEventListener('click', () => this.autoCompleteRemainingPairings());
      }

      const btnJoinRoom = document.getElementById('btnJoinRoom');
      if (btnJoinRoom) {
        btnJoinRoom.addEventListener('click', () => {
          const input = document.getElementById('joinRoomInput');
          const code = (input ? input.value : '').trim().toUpperCase();
          if (code) this.joinRoom(code);
        });
      }

      const btnCopyRoomLink = document.getElementById('btnCopyRoomLink');
      if (btnCopyRoomLink) {
        btnCopyRoomLink.addEventListener('click', () => this.copyShareRoomInfo());
      }

      const btnLockSelection = document.getElementById('btnLockSelection');
      if (btnLockSelection) {
        btnLockSelection.addEventListener('click', () => this.lockCurrentSelection());
      }

      const btnCopyPairings = document.getElementById('btnCopyPairings');
      if (btnCopyPairings) {
        btnCopyPairings.addEventListener('click', () => this.copyPairingsSummary());
      }

      const rolePills = document.querySelectorAll('#roleSelectorPills .role-pill');
      rolePills.forEach((btn) => {
        btn.addEventListener('click', () => {
          const role = btn.getAttribute('data-role') || 'spectator';
          this.switchRole(role);
        });
      });

      const selectFormat = document.getElementById('selectFormat');
      const selectTeamA = document.getElementById('selectTeamA');
      const selectTeamB = document.getElementById('selectTeamB');
      if (selectFormat) selectFormat.addEventListener('change', () => this.createNewRoom());
      if (selectTeamA) selectTeamA.addEventListener('change', () => this.createNewRoom());
      if (selectTeamB) selectTeamB.addEventListener('change', () => this.createNewRoom());
    }

    startRoomSyncTimer() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(async () => {
        if (!this.roomCode || this.isBusy) return;
        if (this.roomState && this.roomState.phase === 'COMPLETED') return;
        // Poll Firestore room state when viewing as Spectator or waiting for the opposing Captain
        const myLocked = this.isCurrentRoleAlreadyLocked();
        if (this.activeRole === 'spectator' || myLocked) {
          await this.fetchRoomState({ silent: true });
        }
      }, 2000);
    }

    getActiveCaptainToken() {
      if (this.activeRole === 'captain_a') return this.tokens.captain_a || '';
      if (this.activeRole === 'captain_b') return this.tokens.captain_b || '';
      return '';
    }

    async switchRole(role) {
      this.activeRole = role;
      this.selectedPlayerIds = [];
      this.updateRoleButtonsUI();
      if (this.roomCode) {
        await this.fetchRoomState({ silent: true });
      } else {
        this.renderAll();
      }
      const roleLabels = {
        captain_a: '👑 Team A Captain (Interactive)',
        captain_b: '👑 Team B Captain (Interactive)',
        spectator: '👁️ Spectator (Read-Only)',
      };
      this.showToast(`Switched seat to ${roleLabels[role] || role}`);
    }

    updateRoleButtonsUI() {
      const rolePills = document.querySelectorAll('#roleSelectorPills .role-pill');
      rolePills.forEach((btn) => {
        const r = btn.getAttribute('data-role');
        btn.classList.toggle('active', r === this.activeRole);
      });
      const spectatorBanner = document.getElementById('spectatorBanner');
      if (spectatorBanner) {
        spectatorBanner.classList.toggle('hidden', this.activeRole !== 'spectator');
      }
    }

    async createNewRoom() {
      if (this.isBusy) return;
      this.isBusy = true;
      try {
        const formatEl = document.getElementById('selectFormat');
        const teamAEl = document.getElementById('selectTeamA');
        const teamBEl = document.getElementById('selectTeamB');
        const vsAiEl = document.getElementById('chkVsAi');

        const formatSize = formatEl ? formatEl.value : '5v5';
        const teamAPreset = teamAEl ? teamAEl.value : 'art_of_war';
        let teamBPreset = teamBEl ? teamBEl.value : 'team_zero_comp';
        if (teamBPreset === teamAPreset) {
          teamBPreset = teamAPreset === 'art_of_war' ? 'team_zero_comp' : 'art_of_war';
          if (teamBEl) teamBEl.value = teamBPreset;
        }
        const vsAi = vsAiEl ? Boolean(vsAiEl.checked) : true;

        const resp = await fetch('/api/team-pairings/room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            format_size: formatSize,
            team_a_preset: teamAPreset,
            team_b_preset: teamBPreset,
            vs_ai: vsAi,
          }),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        this.roomCode = data.room_code;
        this.tokens.captain_a = data.captain_a_token || '';
        this.tokens.captain_b = data.captain_b_token || '';
        this.roomState = data.room;
        this.selectedPlayerIds = [];

        if (this.activeRole !== 'captain_a' && this.activeRole !== 'captain_b' && this.activeRole !== 'spectator') {
          this.activeRole = 'captain_a';
        }
        if (this.activeRole !== 'captain_a') {
          await this.fetchRoomState({ silent: true });
        } else {
          this.renderAll();
        }
        this.showToast(`Created Pairing Room ${this.roomCode} (${formatSize})`);
      } catch (err) {
        console.error('Failed to create pairing room:', err);
        this.showToast('Failed to create pairing room. Check console.');
      } finally {
        this.isBusy = false;
      }
    }

    async joinRoom(roomCode) {
      if (!roomCode) return;
      this.roomCode = roomCode.trim().toUpperCase();
      this.selectedPlayerIds = [];
      await this.fetchRoomState({ silent: false });
    }

    async fetchRoomState({ silent = false } = {}) {
      if (!this.roomCode) return;
      try {
        const token = this.getActiveCaptainToken();
        const qs = new URLSearchParams({
          role: this.activeRole,
        });
        if (token) qs.set('captain_token', token);

        const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}?${qs.toString()}`);
        if (!resp.ok) {
          if (!silent) this.showToast(`Room ${this.roomCode} not found`);
          return;
        }
        const data = await resp.json();
        if (data && data.room) {
          this.roomState = data.room;
          this.renderAll();
        }
      } catch (err) {
        if (!silent) {
          console.error('Error fetching room state:', err);
        }
      }
    }

    getRequiredSelectionCount() {
      if (!this.roomState) return 0;
      const phase = this.roomState.phase;
      if (phase === 'STEP_1_DEFENDER') return 1;
      if (phase === 'STEP_2_ATTACKERS') return 2;
      if (phase === 'STEP_3_CHOOSE') return 1;
      return 0;
    }

    isCurrentRoleAlreadyLocked() {
      if (!this.roomState) return false;
      const phase = this.roomState.phase;
      if (phase === 'COMPLETED') return true;
      if (this.activeRole === 'captain_a') {
        if (phase === 'STEP_1_DEFENDER') return Boolean(this.roomState.secret_defender_a_locked);
        if (phase === 'STEP_2_ATTACKERS') return Boolean(this.roomState.secret_attackers_a_locked);
        if (phase === 'STEP_3_CHOOSE') return Boolean(this.roomState.secret_choice_a_locked);
      } else if (this.activeRole === 'captain_b') {
        if (phase === 'STEP_1_DEFENDER') return Boolean(this.roomState.secret_defender_b_locked);
        if (phase === 'STEP_2_ATTACKERS') return Boolean(this.roomState.secret_attackers_b_locked);
        if (phase === 'STEP_3_CHOOSE') return Boolean(this.roomState.secret_choice_b_locked);
      }
      return false;
    }

    canInteractWithCard(teamSide, contextZone) {
      if (!this.roomState || this.activeRole === 'spectator') return false;
      if (this.isCurrentRoleAlreadyLocked()) return false;
      const phase = this.roomState.phase;
      if (phase === 'STEP_1_DEFENDER' || phase === 'STEP_2_ATTACKERS') {
        if (contextZone !== 'bench') return false;
        if (this.activeRole === 'captain_a' && teamSide === 'A') return true;
        if (this.activeRole === 'captain_b' && teamSide === 'B') return true;
        return false;
      }
      if (phase === 'STEP_3_CHOOSE') {
        if (contextZone !== 'pod_attackers') return false;
        // In Step 3:
        // Captain A's Defender is in Pod A and chooses 1 of Team B's 2 Attackers (in Pod A).
        // Captain B's Defender is in Pod B and chooses 1 of Team A's 2 Attackers (in Pod B).
        if (this.activeRole === 'captain_a' && teamSide === 'B') return true;
        if (this.activeRole === 'captain_b' && teamSide === 'A') return true;
        return false;
      }
      return false;
    }

    toggleCardSelection(playerId, teamSide, contextZone) {
      if (this.activeRole === 'spectator') {
        this.showToast('👁️ Spectator Mode is Read-Only — Only Team Captains can select cards');
        return;
      }
      if (!this.canInteractWithCard(teamSide, contextZone)) {
        return;
      }
      const reqCount = this.getRequiredSelectionCount();
      if (reqCount <= 0) return;

      const idx = this.selectedPlayerIds.indexOf(playerId);
      if (idx >= 0) {
        this.selectedPlayerIds.splice(idx, 1);
      } else {
        if (reqCount === 1) {
          this.selectedPlayerIds = [playerId];
        } else {
          if (this.selectedPlayerIds.length >= reqCount) {
            this.selectedPlayerIds.shift();
          }
          this.selectedPlayerIds.push(playerId);
        }
      }
      this.renderAll();
    }

    async lockCurrentSelection() {
      if (!this.roomState || !this.roomCode || this.isBusy) return;
      if (this.activeRole === 'spectator') {
        this.showToast('👁️ Spectators cannot lock pairings');
        return;
      }
      const reqCount = this.getRequiredSelectionCount();
      if (this.selectedPlayerIds.length !== reqCount) {
        this.showToast(`Select ${reqCount} card${reqCount > 1 ? 's' : ''} before locking in`);
        return;
      }

      const phase = this.roomState.phase;
      let actionType = '';
      const payload = {
        role: this.activeRole,
        captain_token: this.getActiveCaptainToken(),
        vs_ai: Boolean(document.getElementById('chkVsAi')?.checked),
      };

      if (phase === 'STEP_1_DEFENDER') {
        actionType = 'lock_defender';
        payload.action = actionType;
        payload.player_id = this.selectedPlayerIds[0];
      } else if (phase === 'STEP_2_ATTACKERS') {
        actionType = 'lock_attackers';
        payload.action = actionType;
        payload.player_ids = this.selectedPlayerIds.slice(0, 2);
      } else if (phase === 'STEP_3_CHOOSE') {
        actionType = 'lock_choice';
        payload.action = actionType;
        payload.player_id = this.selectedPlayerIds[0];
      } else {
        return;
      }

      this.isBusy = true;
      try {
        const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (!resp.ok) {
          this.showToast(data.error || `Action rejected (${resp.status})`);
          return;
        }
        this.selectedPlayerIds = [];
        this.roomState = data.room;
        this.renderAll();
      } catch (err) {
        console.error('Failed to lock selection:', err);
        this.showToast('Error locking selection');
      } finally {
        this.isBusy = false;
      }
    }

    async autoCompleteRemainingPairings() {
      if (!this.roomState || !this.roomCode || this.isBusy) return;
      if (this.roomState.phase === 'COMPLETED') {
        this.showToast('All match pairings are already set!');
        return;
      }

      // Ensure we act as Captain A with AI Captain B enabled to step through remaining rounds automatically
      if (this.activeRole === 'spectator') {
        this.activeRole = 'captain_a';
        this.updateRoleButtonsUI();
      }
      const chkVsAi = document.getElementById('chkVsAi');
      if (chkVsAi) chkVsAi.checked = true;

      let safetySteps = 0;
      while (this.roomState && this.roomState.phase !== 'COMPLETED' && safetySteps < 12) {
        safetySteps += 1;
        const phase = this.roomState.phase;
        const benchA = (this.roomState.team_a?.roster || []).filter((p) => p.status === 'bench');
        const payload = {
          role: 'captain_a',
          captain_token: this.tokens.captain_a || '',
          vs_ai: true,
        };

        if (phase === 'STEP_1_DEFENDER') {
          if (!benchA.length) break;
          const defPick = benchA.find((p) => p.role.includes('Blunt')) || benchA[0];
          payload.action = 'lock_defender';
          payload.player_id = defPick.id;
        } else if (phase === 'STEP_2_ATTACKERS') {
          if (benchA.length < 2) break;
          const defB = this.roomState.active_defender_b;
          const sorted = benchA.slice().sort((x, y) => {
            const mX = estimateWtcMatchup(x, defB).expected_a;
            const mY = estimateWtcMatchup(y, defB).expected_a;
            return mY - mX;
          });
          payload.action = 'lock_attackers';
          payload.player_ids = [sorted[0].id, sorted[1].id];
        } else if (phase === 'STEP_3_CHOOSE') {
          const attB = this.roomState.active_attackers_b || [];
          if (!attB.length) break;
          const defA = this.roomState.active_defender_a;
          const sorted = attB.slice().sort((x, y) => {
            const mX = estimateWtcMatchup(defA, x).expected_a;
            const mY = estimateWtcMatchup(defA, y).expected_a;
            return mY - mX;
          });
          payload.action = 'lock_choice';
          payload.player_id = sorted[0].id;
        } else {
          break;
        }

        const resp = await fetch(`/api/team-pairings/room/${encodeURIComponent(this.roomCode)}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) break;
        const data = await resp.json();
        this.roomState = data.room;
      }

      this.selectedPlayerIds = [];
      this.renderAll();
      this.showToast('⚡ All Match Pairings Set!');
    }

    renderAll() {
      if (!this.roomState) return;
      this.updateRoleButtonsUI();
      this.renderRoomHeader();
      this.renderPhaseBanner();
      this.renderBenchColumn('A');
      this.renderBenchColumn('B');
      this.renderClashArena();
      this.renderProtocolLog();
      this.renderLockedPairingsTable();
    }

    renderRoomHeader() {
      const r = this.roomState;
      const badge = document.getElementById('roomCodeBadge');
      if (badge) {
        badge.textContent = `ROOM: ${r.room_code || '----'}`;
      }
      const joinInput = document.getElementById('joinRoomInput');
      if (joinInput && !joinInput.value) {
        joinInput.value = r.room_code || '';
      }
    }

    renderPhaseBanner() {
      const r = this.roomState;
      const phase = r.phase;
      const cycleBadge = document.getElementById('cycleBadge');
      if (cycleBadge) {
        if (phase === 'COMPLETED') {
          cycleBadge.textContent = `ALL ${r.total_tables} TABLES SET`;
        } else {
          cycleBadge.textContent = `CYCLE ${r.cycle} OF ${r.max_cycles}`;
        }
      }

      const s1 = document.getElementById('stepPillDefender');
      const s2 = document.getElementById('stepPillAttackers');
      const s3 = document.getElementById('stepPillChoose');
      const s4 = document.getElementById('stepPillComplete');
      [s1, s2, s3, s4].forEach((el) => {
        if (el) el.classList.remove('active', 'done');
      });

      if (phase === 'STEP_1_DEFENDER') {
        if (s1) s1.classList.add('active');
      } else if (phase === 'STEP_2_ATTACKERS') {
        if (s1) s1.classList.add('done');
        if (s2) s2.classList.add('active');
      } else if (phase === 'STEP_3_CHOOSE') {
        if (s1) s1.classList.add('done');
        if (s2) s2.classList.add('done');
        if (s3) s3.classList.add('active');
      } else if (phase === 'COMPLETED') {
        if (s1) s1.classList.add('done');
        if (s2) s2.classList.add('done');
        if (s3) s3.classList.add('done');
        if (s4) s4.classList.add('active', 'done');
      }

      // Captain lock status pills
      const capAPill = document.getElementById('capAStatusPill');
      const capBPill = document.getElementById('capBStatusPill');
      const tagA = r.team_a?.tag || 'Team A';
      const tagB = r.team_b?.tag || 'Team B';
      let lockA = false;
      let lockB = false;
      if (phase === 'STEP_1_DEFENDER') {
        lockA = Boolean(r.secret_defender_a_locked);
        lockB = Boolean(r.secret_defender_b_locked);
      } else if (phase === 'STEP_2_ATTACKERS') {
        lockA = Boolean(r.secret_attackers_a_locked);
        lockB = Boolean(r.secret_attackers_b_locked);
      } else if (phase === 'STEP_3_CHOOSE') {
        lockA = Boolean(r.secret_choice_a_locked);
        lockB = Boolean(r.secret_choice_b_locked);
      } else if (phase === 'COMPLETED') {
        lockA = true;
        lockB = true;
      }

      if (capAPill) {
        capAPill.textContent = `${tagA} Cap: ${lockA ? '🔒 Locked In' : '⏳ Selecting'}`;
        capAPill.classList.toggle('locked', lockA);
      }
      if (capBPill) {
        capBPill.textContent = `${tagB} Cap: ${lockB ? '🔒 Locked In' : '⏳ Selecting'}`;
        capBPill.classList.toggle('locked', lockB);
      }

      // Instructional prompt & lock button
      const promptEl = document.getElementById('phasePromptText');
      const hintBadge = document.getElementById('selectionHintBadge');
      const btnLock = document.getElementById('btnLockSelection');
      const reqCount = this.getRequiredSelectionCount();
      const myLocked = this.isCurrentRoleAlreadyLocked();

      if (promptEl) {
        if (phase === 'STEP_1_DEFENDER') {
          promptEl.innerHTML =
            '<strong>Step 1 — Blind Defender Nomination:</strong> Each Captain secretly selects <strong>1 Defender Card</strong> from their bench. Cards stay face-down until both Captains lock in!';
        } else if (phase === 'STEP_2_ATTACKERS') {
          const oppDef =
            this.activeRole === 'captain_b'
              ? r.active_defender_a?.name || 'Team A Defender'
              : r.active_defender_b?.name || 'Team B Defender';
          promptEl.innerHTML =
            `<strong>Step 2 — Blind Attacker Nomination:</strong> Defenders are revealed! Select <strong>2 Attacker Cards</strong> from your bench to challenge <strong>${escapeHtml(oppDef)}</strong>.`;
        } else if (phase === 'STEP_3_CHOOSE') {
          const podName = this.activeRole === 'captain_b' ? 'Duel Pod B' : 'Duel Pod A';
          promptEl.innerHTML =
            `<strong>Step 3 — Defender's Choice:</strong> Attackers are revealed! Click <strong>1 of the 2 opposing Attacker Cards</strong> inside <strong>${podName}</strong> for your Defender to face.`;
        } else {
          promptEl.innerHTML =
            `<strong>✅ All ${r.total_tables} Match Pairings Locked!</strong> Review the finalized table matchups and projected WTC team score below.`;
        }
      }

      if (hintBadge && btnLock) {
        if (phase === 'COMPLETED') {
          hintBadge.textContent = 'Pairings Complete';
          btnLock.disabled = true;
          btnLock.textContent = '✅ All Pairings Locked';
        } else if (this.activeRole === 'spectator') {
          hintBadge.textContent = 'Spectator (View Only)';
          btnLock.disabled = true;
          btnLock.textContent = '👁️ Captains Only';
        } else if (myLocked) {
          hintBadge.textContent = 'Waiting for Opponent Captain...';
          btnLock.disabled = true;
          btnLock.textContent = '🔒 Selection Locked';
        } else {
          const curCount = this.selectedPlayerIds.length;
          hintBadge.textContent = `Selected: ${curCount} / ${reqCount}`;
          btnLock.disabled = curCount !== reqCount;
          if (phase === 'STEP_1_DEFENDER') {
            btnLock.textContent = '🔒 Lock In Defender (1)';
          } else if (phase === 'STEP_2_ATTACKERS') {
            btnLock.textContent = '🔒 Lock In 2 Attackers';
          } else if (phase === 'STEP_3_CHOOSE') {
            btnLock.textContent = '🔒 Lock In Matchup Choice';
          }
        }
      }
    }

    renderBenchColumn(side) {
      const r = this.roomState;
      const team = side === 'A' ? r.team_a : r.team_b;
      if (!team) return;

      const tagEl = document.getElementById(side === 'A' ? 'teamATagBadge' : 'teamBTagBadge');
      const nameEl = document.getElementById(side === 'A' ? 'teamANameTitle' : 'teamBNameTitle');
      const capEl = document.getElementById(side === 'A' ? 'teamACaptainLabel' : 'teamBCaptainLabel');
      const countEl = document.getElementById(side === 'A' ? 'teamABenchCount' : 'teamBBenchCount');
      const container = document.getElementById(side === 'A' ? 'teamABenchCards' : 'teamBBenchCards');

      if (tagEl) tagEl.textContent = team.tag || side;
      if (nameEl) nameEl.textContent = team.name || `Team ${side}`;
      if (capEl) capEl.textContent = `👑 Captain: ${team.captain_name || 'Captain'}`;

      const roster = team.roster || [];
      const benchPlayers = roster.filter((p) => p.status === 'bench');
      if (countEl) countEl.textContent = `${benchPlayers.length} on Bench`;

      if (!container) return;
      container.innerHTML = '';

      // Determine if we should show contextual Est. WTC matchup badge against opponent's revealed Defender
      let targetDefender = null;
      if (r.phase === 'STEP_2_ATTACKERS') {
        targetDefender = side === 'A' ? r.active_defender_b : r.active_defender_a;
      }

      const canInteract = this.canInteractWithCard(side, 'bench');

      // Show available bench cards first, then paired/active cards below so roster is clear
      const sortedRoster = roster.slice().sort((a, b) => {
        const order = { bench: 0, defender: 1, attacker: 2, paired: 3 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      });

      sortedRoster.forEach((player) => {
        const isBench = player.status === 'bench';
        const isSelected = this.selectedPlayerIds.includes(player.id);
        let matchupObj = null;
        if (isBench && targetDefender) {
          matchupObj = estimateWtcMatchup(player, targetDefender);
        }

        const cardEl = this.createPlayerCardElement(player, {
          teamSide: side,
          isSelected,
          isInteractive: isBench && canInteract,
          isPairedOrBusy: !isBench,
          matchupObj,
          matchupLabelPrefix: targetDefender ? `vs ${targetDefender.name.split(' ')[0]}` : '',
          onClick: () => {
            if (isBench) {
              this.toggleCardSelection(player.id, side, 'bench');
            }
          },
        });
        container.appendChild(cardEl);
      });
    }

    createPlayerCardElement(player, opts = {}) {
      const {
        isSelected = false,
        isInteractive = false,
        isPairedOrBusy = false,
        matchupObj = null,
        matchupLabelPrefix = '',
        statusPillOverride = null,
        onClick = null,
      } = opts;

      const meta = getFactionMeta(player.faction);
      const card = document.createElement('div');
      card.className = 'player-card';
      card.style.setProperty('--faction-color', meta.color);
      card.setAttribute('data-player-id', player.id);

      if (isSelected) card.classList.add('selected');
      if (!isInteractive) card.classList.add('disabled-card');
      if (isPairedOrBusy) card.classList.add('paired-card');

      let roleClass = '';
      const roleLower = (player.role || '').toLowerCase();
      if (roleLower.includes('blunt') || roleLower.includes('defender')) {
        roleClass = 'role-blunt';
      } else if (roleLower.includes('spear') || roleLower.includes('slayer')) {
        roleClass = 'role-spear';
      }

      let statusHtml = '';
      if (statusPillOverride) {
        statusHtml = `<span class="role-tag">${escapeHtml(statusPillOverride)}</span>`;
      } else if (player.status === 'defender') {
        statusHtml = `<span class="role-tag role-blunt">🛡️ ACTIVE DEFENDER</span>`;
      } else if (player.status === 'attacker') {
        statusHtml = `<span class="role-tag role-spear">⚔️ ACTIVE ATTACKER</span>`;
      } else if (player.status === 'paired') {
        statusHtml = `<span class="role-tag">✅ PAIRED</span>`;
      }

      let matchupHtml = '';
      if (matchupObj) {
        const expA = matchupObj.expected_a;
        let cls = 'even';
        if (expA >= 11) cls = 'favored';
        else if (expA <= 9) cls = 'unfavored';
        const prefix = matchupLabelPrefix ? `${escapeHtml(matchupLabelPrefix)}: ` : 'Est. WTC: ';
        matchupHtml = `<span class="matchup-pill ${cls}" title="Projected WTC 0-20 Score">${prefix}${expA}-${matchupObj.expected_b}</span>`;
      }

      card.innerHTML = `
        <div class="card-top-row">
          <div class="player-identity">
            <span class="faction-icon-box">${meta.icon}</span>
            <div class="player-name-wrap">
              <div class="player-name" title="${escapeHtml(player.name)}">${escapeHtml(player.name)}</div>
              <div class="player-faction">${escapeHtml(player.faction)}</div>
            </div>
          </div>
          <span class="elo-pill">${escapeHtml(player.elo)} ELO</span>
        </div>
        <div class="card-bottom-row">
          <span class="detachment-tag" title="${escapeHtml(player.detachment)}">${escapeHtml(player.detachment)}</span>
          <div class="card-badges-right">
            ${statusHtml || `<span class="role-tag ${roleClass}">${escapeHtml(player.role)}</span>`}
            ${matchupHtml}
          </div>
        </div>
      `;

      if (onClick && isInteractive) {
        card.addEventListener('click', onClick);
      }
      return card;
    }

    createMysteryOrEmptySlot({ isLockedSecret = false, title = 'Awaiting Card', subtitle = 'Not yet locked' } = {}) {
      const box = document.createElement('div');
      if (isLockedSecret) {
        box.className = 'mystery-card';
        box.innerHTML = `
          <div class="mystery-icon">🔒</div>
          <div class="mystery-title">${escapeHtml(title)}</div>
          <div class="mystery-sub">${escapeHtml(subtitle)}</div>
        `;
      } else {
        box.className = 'empty-slot-placeholder';
        box.innerHTML = `<div>${escapeHtml(title)}</div>`;
      }
      return box;
    }

    renderClashArena() {
      const r = this.roomState;
      const phase = r.phase;
      const tagA = r.team_a?.tag || 'Team A';
      const tagB = r.team_b?.tag || 'Team B';

      const podALabel = document.getElementById('duelPodALabel');
      const podBLabel = document.getElementById('duelPodBLabel');
      if (podALabel) podALabel.textContent = `${tagA} Defender vs. ${tagB} Attackers`;
      if (podBLabel) podBLabel.textContent = `${tagB} Defender vs. ${tagA} Attackers`;

      const podADefSlot = document.getElementById('podADefenderSlot');
      const podAAttSlot = document.getElementById('podAAttackersSlot');
      const podBDefSlot = document.getElementById('podBDefenderSlot');
      const podBAttSlot = document.getElementById('podBAttackersSlot');

      if (!podADefSlot || !podAAttSlot || !podBDefSlot || !podBAttSlot) return;
      podADefSlot.innerHTML = '';
      podAAttSlot.innerHTML = '';
      podBDefSlot.innerHTML = '';
      podBAttSlot.innerHTML = '';

      if (phase === 'COMPLETED') {
        podADefSlot.appendChild(
          this.createMysteryOrEmptySlot({
            isLockedSecret: false,
            title: `✅ All ${r.total_tables} Match Tables Locked`,
          })
        );
        podAAttSlot.appendChild(
          this.createMysteryOrEmptySlot({
            isLockedSecret: false,
            title: 'See Finalized Match Pairings Table Below',
          })
        );
        podBDefSlot.appendChild(
          this.createMysteryOrEmptySlot({
            isLockedSecret: false,
            title: `✅ All ${r.total_tables} Match Tables Locked`,
          })
        );
        podBAttSlot.appendChild(
          this.createMysteryOrEmptySlot({
            isLockedSecret: false,
            title: 'See Finalized Match Pairings Table Below',
          })
        );
        return;
      }

      // 1. Render Pod A Defender (Team A Defender)
      if (r.active_defender_a) {
        podADefSlot.appendChild(
          this.createPlayerCardElement(r.active_defender_a, {
            isInteractive: false,
            statusPillOverride: '🛡️ DEFENDER',
          })
        );
      } else if (r.secret_defender_a_locked) {
        podADefSlot.appendChild(
          this.createMysteryOrEmptySlot({
            isLockedSecret: true,
            title: `${tagA} DEFENDER LOCKED`,
            subtitle: 'Hidden until both Captains lock in',
          })
        );
      } else {
        podADefSlot.appendChild(
          this.createMysteryOrEmptySlot({
            isLockedSecret: false,
            title: `⏳ Awaiting ${tagA} Defender (Step 1)`,
          })
        );
      }

      // 2. Render Pod B Defender (Team B Defender)
      if (r.active_defender_b) {
        podBDefSlot.appendChild(
          this.createPlayerCardElement(r.active_defender_b, {
            isInteractive: false,
            statusPillOverride: '🛡️ DEFENDER',
          })
        );
      } else if (r.secret_defender_b_locked) {
        podBDefSlot.appendChild(
          this.createMysteryOrEmptySlot({
            isLockedSecret: true,
            title: `${tagB} DEFENDER LOCKED`,
            subtitle: 'Hidden until both Captains lock in',
          })
        );
      } else {
        podBDefSlot.appendChild(
          this.createMysteryOrEmptySlot({
            isLockedSecret: false,
            title: `⏳ Awaiting ${tagB} Defender (Step 1)`,
          })
        );
      }

      // 3. Render Pod A Attackers (Team B's 2 Attackers sent against Team A's Defender)
      const attB = r.active_attackers_b || [];
      if (attB.length > 0) {
        const canCapAPick = this.canInteractWithCard('B', 'pod_attackers');
        attB.forEach((attPlayer) => {
          const isSelected = this.selectedPlayerIds.includes(attPlayer.id);
          const m = r.active_defender_a ? estimateWtcMatchup(r.active_defender_a, attPlayer) : null;
          const cardEl = this.createPlayerCardElement(attPlayer, {
            isSelected,
            isInteractive: canCapAPick,
            matchupObj: m,
            matchupLabelPrefix: `${tagA} Def Est`,
            statusPillOverride: canCapAPick ? '🎯 CLICK TO FACE' : '⚔️ ATTACKER',
            onClick: () => this.toggleCardSelection(attPlayer.id, 'B', 'pod_attackers'),
          });
          podAAttSlot.appendChild(cardEl);
        });
      } else if (r.secret_attackers_b_locked) {
        podAAttSlot.appendChild(
          this.createMysteryOrEmptySlot({
            isLockedSecret: true,
            title: `${tagB} 2 ATTACKERS LOCKED`,
            subtitle: 'Simultaneous reveal pending',
          })
        );
      } else {
        podAAttSlot.appendChild(
          this.createMysteryOrEmptySlot({
            isLockedSecret: false,
            title: `⏳ Awaiting 2 ${tagB} Attackers (Step 2)`,
          })
        );
      }

      // 4. Render Pod B Attackers (Team A's 2 Attackers sent against Team B's Defender)
      const attA = r.active_attackers_a || [];
      if (attA.length > 0) {
        const canCapBPick = this.canInteractWithCard('A', 'pod_attackers');
        attA.forEach((attPlayer) => {
          const isSelected = this.selectedPlayerIds.includes(attPlayer.id);
          const m = r.active_defender_b ? estimateWtcMatchup(r.active_defender_b, attPlayer) : null;
          const cardEl = this.createPlayerCardElement(attPlayer, {
            isSelected,
            isInteractive: canCapBPick,
            matchupObj: m,
            matchupLabelPrefix: `${tagB} Def Est`,
            statusPillOverride: canCapBPick ? '🎯 CLICK TO FACE' : '⚔️ ATTACKER',
            onClick: () => this.toggleCardSelection(attPlayer.id, 'A', 'pod_attackers'),
          });
          podBAttSlot.appendChild(cardEl);
        });
      } else if (r.secret_attackers_a_locked) {
        podBAttSlot.appendChild(
          this.createMysteryOrEmptySlot({
            isLockedSecret: true,
            title: `${tagA} 2 ATTACKERS LOCKED`,
            subtitle: 'Simultaneous reveal pending',
          })
        );
      } else {
        podBAttSlot.appendChild(
          this.createMysteryOrEmptySlot({
            isLockedSecret: false,
            title: `⏳ Awaiting 2 ${tagA} Attackers (Step 2)`,
          })
        );
      }
    }

    renderProtocolLog() {
      const listEl = document.getElementById('protocolLogList');
      if (!listEl || !this.roomState) return;
      const logs = (this.roomState.log || []).slice().reverse();
      listEl.innerHTML = logs
        .map(
          (entry) => `
          <li class="protocol-log-item">
            <span class="log-time">${escapeHtml(entry.ts || '--:--')}</span>
            <span class="log-msg">${escapeHtml(entry.msg || '')}</span>
          </li>
        `
        )
        .join('');
    }

    renderLockedPairingsTable() {
      const r = this.roomState;
      const pairings = r.pairings || [];
      const totalTables = r.total_tables || 5;
      const countLabel = document.getElementById('lockedCountLabel');
      if (countLabel) {
        countLabel.textContent = `${pairings.length} / ${totalTables}`;
      }

      const tbody = document.getElementById('pairingsTableBody');
      const scoreValEl = document.getElementById('projectedScoreValue');
      const verdictEl = document.getElementById('projectedVerdictBadge');

      if (!tbody) return;
      if (pairings.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="empty-pairings-cell">
              No pairings locked yet. Complete Step 1 → Step 2 → Step 3 above (or click <strong>⚡ Auto-Pair Rest</strong>) to lock all ${totalTables} tables!
            </td>
          </tr>
        `;
        if (scoreValEl) scoreValEl.textContent = '0 – 0';
        if (verdictEl) verdictEl.textContent = 'Awaiting Pairings';
        return;
      }

      let sumA = 0;
      let sumB = 0;
      tbody.innerHTML = pairings
        .map((m) => {
          const pa = m.player_a || {};
          const pb = m.player_b || {};
          const metaA = getFactionMeta(pa.faction);
          const metaB = getFactionMeta(pb.faction);
          const est = m.matchup || estimateWtcMatchup(pa, pb);
          const expA = Number(est.expected_a ?? 10);
          const expB = Number(est.expected_b ?? 10);
          sumA += expA;
          sumB += expB;

          let pillCls = 'even';
          if (expA >= 11) pillCls = 'favored';
          else if (expA <= 9) pillCls = 'unfavored';

          return `
            <tr>
              <td><span class="table-num-badge">Table ${escapeHtml(m.table)}</span></td>
              <td><span class="pairing-type-tag">${escapeHtml(m.pairing_type)}</span></td>
              <td>
                <div class="table-player-cell">
                  <span class="faction-icon-box">${metaA.icon}</span>
                  <div>
                    <div class="tp-name">${escapeHtml(pa.name)} <span class="elo-pill">${escapeHtml(pa.elo)}</span></div>
                    <div class="tp-sub">${escapeHtml(pa.faction)} • ${escapeHtml(pa.detachment)}</div>
                  </div>
                </div>
              </td>
              <td><span class="pod-vs-divider">VS</span></td>
              <td>
                <div class="table-player-cell">
                  <span class="faction-icon-box">${metaB.icon}</span>
                  <div>
                    <div class="tp-name">${escapeHtml(pb.name)} <span class="elo-pill">${escapeHtml(pb.elo)}</span></div>
                    <div class="tp-sub">${escapeHtml(pb.faction)} • ${escapeHtml(pb.detachment)}</div>
                  </div>
                </div>
              </td>
              <td>
                <span class="matchup-pill ${pillCls}">${expA} – ${expB}</span>
              </td>
            </tr>
          `;
        })
        .join('');

      if (scoreValEl) {
        scoreValEl.textContent = `${sumA} – ${sumB}`;
      }
      if (verdictEl) {
        const tagA = r.team_a?.tag || 'Team A';
        const tagB = r.team_b?.tag || 'Team B';
        const diff = sumA - sumB;
        if (diff > 5) {
          verdictEl.textContent = `${tagA} Projected Win (+${diff} WTC pts)`;
        } else if (diff < -5) {
          verdictEl.textContent = `${tagB} Projected Win (+${Math.abs(diff)} WTC pts)`;
        } else {
          verdictEl.textContent = `Razor-Close Draw Window (${sumA}-${sumB})`;
        }
      }
    }

    copyShareRoomInfo() {
      if (!this.roomCode) return;
      const shareUrl = `${window.location.origin}/admin/team-pairings?room=${encodeURIComponent(this.roomCode)}&role=spectator`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).catch(() => {});
      }
      this.showToast(`📋 Copied Room Link (${this.roomCode})`);
    }

    copyPairingsSummary() {
      if (!this.roomState || !(this.roomState.pairings || []).length) {
        this.showToast('No locked pairings to copy yet');
        return;
      }
      const r = this.roomState;
      const lines = [
        `=== ${r.team_a?.name} (${r.team_a?.tag}) vs ${r.team_b?.name} (${r.team_b?.tag}) [${r.format_size}] ===`,
      ];
      r.pairings.forEach((m) => {
        const pa = m.player_a || {};
        const pb = m.player_b || {};
        const est = m.matchup || { expected_a: 10, expected_b: 10 };
        lines.push(
          `Table ${m.table} (${m.pairing_type}): ${pa.name} (${pa.faction}) vs ${pb.name} (${pb.faction}) [Est. ${est.expected_a}-${est.expected_b}]`
        );
      });
      const text = lines.join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      this.showToast('📋 Copied Match Pairings to Clipboard!');
    }

    showToast(msg) {
      const toast = document.getElementById('toastNotification');
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.remove('hidden');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        toast.classList.add('hidden');
      }, 2800);
    }
  }

  window.TeamPairingsApp = TeamPairingsApp;
  window.estimateWtcMatchup = estimateWtcMatchup;

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      const app = new TeamPairingsApp();
      window.teamPairingsApp = app;
      app.init();
    });
  }
})();
