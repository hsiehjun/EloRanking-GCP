/* ==========================================================================
   MODALS.JS - Player Profile Modal, Collapsible Elo Graph & Modals
   ========================================================================== */

let currentPlayerTrajectory = [];
let currentPlayerMatches = [];
let playerModalSearchQuery = '';
let isChartExpanded = false;

var modalZIndexCounter = (typeof window !== 'undefined' && window.modalZIndexCounter) || 10000;
var modalStack = (typeof window !== 'undefined' && Array.isArray(window.modalStack)) ? window.modalStack : [];
if (typeof window !== 'undefined') {
  window.modalStack = modalStack;
  window.modalZIndexCounter = modalZIndexCounter;
}

function bringModalToFront(modal) {
  if (!modal) return;
  if (typeof modal === 'string') modal = document.getElementById(modal);
  if (!modal) return;

  if (!Array.isArray(modalStack)) {
    modalStack = [];
    if (typeof window !== 'undefined') window.modalStack = modalStack;
  }

  // Dynamically inspect any currently active modal backdrops
  let maxZ = 10000;
  const activeBackdrops = document.querySelectorAll('.modal-backdrop.active');
  activeBackdrops.forEach(el => {
    if (el !== modal) {
      const z = parseInt(window.getComputedStyle(el).zIndex, 10);
      if (!isNaN(z) && z > maxZ && z < 100000) {
        maxZ = z;
      }
    }
  });

  modalZIndexCounter = Math.max(modalZIndexCounter + 10, maxZ + 10);
  modal.style.setProperty('z-index', String(modalZIndexCounter), 'important');
  modal.style.display = 'flex';
  modal.classList.add('active');

  modalStack = modalStack.filter(id => id !== modal.id);
  modalStack.push(modal.id);
  if (typeof window !== 'undefined') {
    window.modalStack = modalStack;
    window.modalZIndexCounter = modalZIndexCounter;
  }
}
window.bringModalToFront = bringModalToFront;

function closeModal(modalId) {
  if (!modalId) return;
  if (typeof modalId === 'object' && modalId.id) modalId = modalId.id;

  if (!Array.isArray(modalStack)) {
    modalStack = [];
    if (typeof window !== 'undefined') window.modalStack = modalStack;
  }

  if (modalId === 'event-modal' && typeof stopEventSyncPoll === 'function') {
    stopEventSyncPoll();
  }
  if (modalId === 'event-details-loading-modal' && typeof closeEventDetailsLoadingModal === 'function') {
    closeEventDetailsLoadingModal();
  }
  if (modalId === 'event-reg-loading-modal' && typeof closeEventRegistrationLoadingModal === 'function') {
    closeEventRegistrationLoadingModal();
  }
  if (modalId === 'event-stream-modal') {
    const iframe = document.getElementById('modal-stream-iframe');
    if (iframe) iframe.src = '';
  }

  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
    modal.style.removeProperty('z-index');
  }

  modalStack = modalStack.filter(id => id !== modalId);
  if (typeof window !== 'undefined') window.modalStack = modalStack;

  if (modalStack.length === 0) {
    modalZIndexCounter = 10000;
  } else {
    // If there is an underlying modal on the stack, ensure it remains active and displayed
    const topModalId = modalStack[modalStack.length - 1];
    const topModal = document.getElementById(topModalId);
    if (topModal) {
      topModal.style.display = 'flex';
      topModal.classList.add('active');
    }
  }
  if (typeof window !== 'undefined') window.modalZIndexCounter = modalZIndexCounter;
}
window.closeModal = closeModal;

function closeAllModals() {
  if (!Array.isArray(modalStack)) {
    modalStack = [];
    if (typeof window !== 'undefined') window.modalStack = modalStack;
  }
  const stackCopy = [...modalStack];
  stackCopy.forEach(id => closeModal(id));
  document.querySelectorAll('.modal-backdrop.active').forEach(el => {
    if (el.id) closeModal(el.id);
    else {
      el.classList.remove('active');
      el.style.display = 'none';
    }
  });
  [
    'league-score-modal-backdrop',
    'league-player-modal-backdrop',
    'league-matrix-matchup-modal',
    'league-copy-modal-backdrop',
    'league-config-modal-backdrop',
    'league-hist-archive-modal'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  const staticLeagueScoreModal = document.getElementById('league-score-modal');
  if (staticLeagueScoreModal) {
    staticLeagueScoreModal.classList.remove('active');
    staticLeagueScoreModal.style.display = 'none';
  }
  modalStack = [];
  modalZIndexCounter = 10000;
  if (typeof window !== 'undefined') {
    window.modalStack = modalStack;
    window.modalZIndexCounter = modalZIndexCounter;
  }
}
window.closeAllModals = closeAllModals;

function closeModalOnBackdrop(e) {
  if (e && e.target && e.target.classList && e.target.classList.contains('modal-backdrop')) {
    closeModal(e.target.id);
  }
}
window.closeModalOnBackdrop = closeModalOnBackdrop;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length > 0) {
    const topModalId = modalStack[modalStack.length - 1];
    closeModal(topModalId);
  }
});

let currentModalPlayerId = null;
let currentModalPlayerName = '';
window.currentModalPlayerId = currentModalPlayerId;
window.currentModalPlayerName = currentModalPlayerName;
window._quickPlayerModalCache = window._quickPlayerModalCache || new Map();

function _findPreseededPlayerInMemory(targetId, targetName) {
  const idClean = String(targetId || '').trim().toLowerCase();
  const nameClean = String(targetName || '').trim().toLowerCase();
  const pools = [];
  if (typeof currentPlayersData !== 'undefined' && Array.isArray(currentPlayersData)) {
    pools.push(currentPlayersData);
  }
  if (typeof leaderboardAllCache !== 'undefined' && leaderboardAllCache && typeof leaderboardAllCache === 'object') {
    Object.values(leaderboardAllCache).forEach(entry => {
      if (entry && Array.isArray(entry.data)) pools.push(entry.data);
    });
  }
  if (typeof leaderboardItcCache !== 'undefined' && leaderboardItcCache && typeof leaderboardItcCache === 'object') {
    Object.values(leaderboardItcCache).forEach(entry => {
      if (entry && Array.isArray(entry.data)) pools.push(entry.data);
    });
  }
  for (const list of pools) {
    for (const item of list) {
      if (!item) continue;
      const pid = String(item.player_id || item.id || '').trim().toLowerCase();
      const pname = String(item.player_name || item.full_name || '').trim().toLowerCase();
      if ((idClean && pid === idClean) || (nameClean && pname === nameClean)) {
        return item;
      }
    }
  }
  return null;
}

function renderPlayerModalTelemetryPanels(masteryList, matchupList) {
  const fmListEl = document.getElementById('modal-faction-mastery-list');
  const mmListEl = document.getElementById('modal-matchup-matrix-list');
  const fmBadgeEl = document.getElementById('modal-fm-count-badge');
  const mmBadgeEl = document.getElementById('modal-mm-count-badge');

  if (fmBadgeEl) {
    fmBadgeEl.textContent = masteryList && masteryList.length > 0
      ? `${masteryList.length} ${masteryList.length === 1 ? 'Army' : 'Armies'}`
      : 'Piloted Armies';
  }
  if (mmBadgeEl) {
    mmBadgeEl.textContent = matchupList && matchupList.length > 0
      ? `${matchupList.length} ${matchupList.length === 1 ? 'Faction' : 'Factions'}`
      : 'vs Opponents';
  }

  if (fmListEl) {
    if (!masteryList || masteryList.length === 0) {
      fmListEl.innerHTML = '<div style="font-size:0.78rem; color:var(--text-muted); padding:0.65rem 0; text-align:center;">No recorded faction games yet.</div>';
    } else {
      fmListEl.innerHTML = masteryList.slice(0, 5).map((f, idx) => {
        const g = Number(f.games || f.matches || 0);
        const w = Number(f.wins || 0);
        const l = Number(f.losses || 0);
        const d = Number(f.draws || 0);
        const wr = Number(f.win_rate !== undefined ? f.win_rate : (g > 0 ? (w / g) * 100 : 0));
        const net = Number(f.net_elo || 0);
        const netStr = `${net >= 0 ? '+' : ''}${net.toFixed(1)}`;
        const netColor = net > 0 ? 'var(--win)' : (net < 0 ? 'var(--loss)' : 'var(--text-muted)');
        const wrColor = wr >= 60 ? '#10b981' : (wr >= 50 ? '#38bdf8' : '#f87171');
        const recStr = (w + l + d) > 0 ? `${w}W-${l}L${d ? `-${d}D` : ''}` : `${g} matches`;
        return `
          <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(51, 65, 85, 0.5); border-radius: 8px; padding: 0.45rem 0.6rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;">
              <div style="min-width: 0; flex: 1;">
                <div style="font-size: 0.8rem; font-weight: 700; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(f.faction)}">
                  ${idx === 0 ? '<span title="Signature Army">👑</span> ' : ''}${escapeHtml(f.faction)}
                </div>
                <div style="font-size: 0.69rem; color: var(--text-secondary); font-family: var(--font-mono); margin-top: 1px;">
                  <strong>${g}G</strong> · ${recStr}
                </div>
              </div>
              <div style="text-align: right; flex-shrink: 0;">
                <span style="display: inline-block; font-family: var(--font-mono); font-size: 0.74rem; font-weight: 800; color: ${wrColor}; background: rgba(15,23,42,0.9); border: 1px solid ${wrColor}44; padding: 1px 6px; border-radius: 5px;">
                  ${wr.toFixed(1)}%
                </span>
                <div style="font-family: var(--font-mono); font-size: 0.68rem; font-weight: 700; color: ${netColor}; margin-top: 2px;">
                  ${netStr} Elo
                </div>
              </div>
            </div>
            <div style="height: 3px; background: rgba(51, 65, 85, 0.5); border-radius: 2px; margin-top: 0.35rem; overflow: hidden;">
              <div style="height: 100%; width: ${Math.max(2, Math.min(100, wr))}%; background: ${wrColor}; border-radius: 2px;"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  if (mmListEl) {
    if (!matchupList || matchupList.length === 0) {
      mmListEl.innerHTML = '<div style="font-size:0.78rem; color:var(--text-muted); padding:0.65rem 0; text-align:center;">No opponent faction matchups recorded yet.</div>';
    } else {
      mmListEl.innerHTML = matchupList.slice(0, 5).map(m => {
        const enemy = m.enemy_faction || m.faction || 'Unknown';
        const g = Number(m.total_encounters || m.games || 0);
        const w = Number(m.wins || 0);
        const l = Number(m.losses || 0);
        const d = Number(m.draws || 0);
        const wr = Number(m.win_rate !== undefined ? m.win_rate : (g > 0 ? (w / g) * 100 : 0));
        const net = Number(m.net_elo || 0);
        const netStr = `${net >= 0 ? '+' : ''}${net.toFixed(1)}`;
        const netColor = net > 0 ? 'var(--win)' : (net < 0 ? 'var(--loss)' : 'var(--text-muted)');
        const wrColor = wr >= 60 ? '#10b981' : (wr >= 50 ? '#38bdf8' : '#f87171');
        return `
          <div style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(51, 65, 85, 0.5); border-radius: 8px; padding: 0.45rem 0.6rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;">
              <div style="min-width: 0; flex: 1;">
                <div style="font-size: 0.8rem; font-weight: 700; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="vs ${escapeHtml(enemy)}">
                  <span style="color: var(--text-muted); font-weight: 600;">vs</span> ${escapeHtml(enemy)}
                </div>
                <div style="font-size: 0.69rem; color: var(--text-secondary); font-family: var(--font-mono); margin-top: 1px;">
                  <strong>${g}G</strong> · ${w}W-${l}L${d ? `-${d}D` : ''}
                </div>
              </div>
              <div style="text-align: right; flex-shrink: 0;">
                <span style="display: inline-block; font-family: var(--font-mono); font-size: 0.74rem; font-weight: 800; color: ${wrColor}; background: rgba(15,23,42,0.9); border: 1px solid ${wrColor}44; padding: 1px 6px; border-radius: 5px;">
                  ${wr.toFixed(1)}%
                </span>
                <div style="font-family: var(--font-mono); font-size: 0.68rem; font-weight: 700; color: ${netColor}; margin-top: 2px;">
                  ${netStr} Elo
                </div>
              </div>
            </div>
            <div style="height: 3px; background: rgba(51, 65, 85, 0.5); border-radius: 2px; margin-top: 0.35rem; overflow: hidden;">
              <div style="height: 100%; width: ${Math.max(2, Math.min(100, wr))}%; background: ${wrColor}; border-radius: 2px;"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

function _applyPlayerModalData(data, targetId, targetName) {
  const nameEl = document.getElementById('modal-player-name');
  const chatContainer = document.getElementById('modal-player-chat-container');
  const p = data.player || data || {};
  const resolvedName = (p.player_name && p.player_name !== 'Unknown') ? p.player_name : (p.full_name || targetName || 'Player Profile');
  const resolvedId = p.player_id || p.id || data.player_id || targetId;
  currentModalPlayerName = resolvedName;
  window.currentModalPlayerName = currentModalPlayerName;
  if (resolvedId) {
    currentModalPlayerId = resolvedId;
    window.currentModalPlayerId = currentModalPlayerId;
  }
  if (nameEl) {
    nameEl.innerText = resolvedName;
    nameEl.style.cursor = 'pointer';
    nameEl.onclick = () => openDedicatedPlayerProfileFromModal();
    nameEl.title = 'Click to open full player profile';
  }

  const predictBtn = document.getElementById('btn-modal-scout-predict');
  if (predictBtn) {
    predictBtn.innerHTML = `<span>🔮 Predict Match</span>`;
    predictBtn.title = `Simulate match vs ${escapeHtml(resolvedName)}`;
  }

  // OmniTactica Registered User & Chat Request Handler
  if (chatContainer) {
    chatContainer.innerHTML = '';
    const chatPlayerName = resolvedName !== 'Player Profile' ? resolvedName : 'Player';
    const playerPid = p.player_id || resolvedId;
    const currentUserVal = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;

    if (data.is_self) {
      chatContainer.innerHTML = `
        <span class="oc-badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); font-size: 0.78rem; padding: 0.35rem 0.65rem; border-radius: 6px; display: inline-flex; align-items: center; gap: 0.3rem;">
          👤 You
        </span>
      `;
    } else if (!data.has_account) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline';
      btn.style.cssText = 'font-size: 0.78rem; padding: 0.35rem 0.65rem; border-color: rgba(239, 68, 68, 0.35); color: #f87171; background: rgba(239, 68, 68, 0.08); display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer; border-radius: 6px;';
      btn.title = `${chatPlayerName} has not registered an OmniTactica account yet. Direct chat requests are only available between registered OmniTactica players.`;
      btn.innerHTML = `🔒 Not on OmniTactica`;
      btn.onclick = () => showUnregisteredPlayerAlert(chatPlayerName);
      chatContainer.appendChild(btn);
    } else if (data.existing_request_status === 'accepted') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.style.cssText = 'font-size: 0.78rem; padding: 0.35rem 0.75rem; background: #0284c7; border-color: #0284c7; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 6px; cursor: pointer;';
      btn.innerHTML = `💬 Open Chat`;
      btn.onclick = () => {
        closeModal('player-modal');
        if (typeof openChatWithRequest === 'function') {
          openChatWithRequest(data.existing_request_id);
        } else if (typeof toggleFloatingChat === 'function') {
          toggleFloatingChat(true);
        } else if (typeof switchTab === 'function') {
          switchTab('chat');
        }
      };
      chatContainer.appendChild(btn);
    } else if (data.existing_request_status === 'pending') {
      const isSender = data.existing_request_sender_id === currentUserVal?.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline';
      btn.style.cssText = 'font-size: 0.78rem; padding: 0.35rem 0.75rem; border-color: #f59e0b; color: #fbbf24; background: rgba(245, 158, 11, 0.12); display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600; cursor: pointer; border-radius: 6px;';
      btn.innerHTML = isSender ? `⏳ Request Pending` : `🔔 Chat Request Received`;
      btn.title = isSender ? 'Your chat request is pending their response' : 'They sent you a chat request! Click to view in Messages';
      btn.onclick = () => {
        closeModal('player-modal');
        if (typeof toggleFloatingChat === 'function') {
          toggleFloatingChat(true);
        } else if (typeof switchTab === 'function') {
          switchTab('chat');
        }
      };
      chatContainer.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.style.cssText = 'font-size: 0.78rem; padding: 0.35rem 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; border-radius: 6px; cursor: pointer;';
      btn.innerHTML = `💬 Send Chat Request`;
      btn.title = `Send a direct chat and match request to ${chatPlayerName}`;
      btn.onclick = () => {
        const token = localStorage.getItem('elo_auth_token') || localStorage.getItem('native_session_token');
        if (!token) {
          alert('Please log in or create an account to send chat requests to players.');
          window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.hash);
          return;
        }
        if (typeof openSendChatRequestModal === 'function') {
          openSendChatRequestModal(playerPid, chatPlayerName, data.account_user_id);
        } else if (typeof openProposeMatchModal === 'function') {
          openProposeMatchModal(playerPid, chatPlayerName);
        }
      };
      chatContainer.appendChild(btn);
    }
  }

  const teamDiv = document.getElementById('modal-player-team');
  if (teamDiv) {
    const rawTeams = Array.isArray(p.teams_history) && p.teams_history.length > 0 
      ? p.teams_history 
      : ((p.all_teams || p.team || '').split(',').map(t => t.trim()).filter(Boolean));

    const seenTeams = new Set();
    const teamsList = [];
    rawTeams.forEach(t => {
      const lower = t.toLowerCase();
      if (!seenTeams.has(lower)) {
        seenTeams.add(lower);
        teamsList.push(t);
      }
    });

    const currentTeam = p.team ? p.team.trim() : (teamsList[0] || '');
    const currentIdx = teamsList.findIndex(t => t.toLowerCase() === currentTeam.toLowerCase());
    const activeTeamName = currentIdx >= 0 ? teamsList[currentIdx] : (currentTeam || teamsList[0] || '');

    if (activeTeamName) {
      teamDiv.style.display = 'inline-flex';
      teamDiv.innerHTML = '';

      const badge = document.createElement('span');
      badge.className = 'faction-pill';
      badge.style.cursor = 'pointer';
      badge.style.border = '1px solid #38bdf8';
      badge.style.background = 'rgba(56, 189, 248, 0.12)';
      badge.style.color = '#38bdf8';
      badge.style.fontWeight = '700';
      badge.title = `${activeTeamName} - Click to view team`;
      badge.innerHTML = `🛡️ ${escapeHtml(activeTeamName)}`;
      badge.onclick = (e) => { e.stopPropagation(); openTeamModal(activeTeamName); };
      teamDiv.appendChild(badge);
    } else {
      teamDiv.innerHTML = '';
      teamDiv.style.display = 'none';
    }
  }

  const factionsDiv = document.getElementById('modal-player-factions');
  if (factionsDiv) {
    factionsDiv.innerHTML = '';
    factionsDiv.style.display = 'none';
  }

  const eloMatches = p.matches_played || p.total_matches || data.total_matches || ((p.wins || 0) + (p.losses || 0) + (p.draws || 0));
  const eloEl = document.getElementById('modal-elo');
  if (eloEl) {
    eloEl.innerHTML = typeof renderEloBadgePill === 'function' 
      ? renderEloBadgePill(p.current_elo ?? data.current_elo, eloMatches, { showTierName: true }) 
      : Number(p.current_elo ?? data.current_elo ?? 1500).toFixed(1);
  }
  const peakEl = document.getElementById('modal-peak');
  if (peakEl) {
    peakEl.innerHTML = typeof renderEloBadgePill === 'function'
      ? (renderEloBadgePill(p.peak_elo || p.current_elo || data.peak_elo || data.current_elo, eloMatches, { showTierName: false }) + ' 👑')
      : Number(p.peak_elo || p.current_elo || data.peak_elo || 1500).toFixed(1);
  }
  const winsVal = p.wins ?? data.wins ?? 0;
  const lossesVal = p.losses ?? data.losses ?? 0;
  const drawsVal = p.draws ?? data.draws ?? 0;
  const recEl = document.getElementById('modal-record');
  if (recEl) {
    recEl.innerHTML = `<span style="color:var(--win);">${winsVal}W</span> - <span style="color:var(--loss);">${lossesVal}L</span>${drawsVal ? ` - <span style="color:var(--draw);">${drawsVal}D</span>` : ''}`;
  }
  const totalM = p.total_matches || p.matches_played || data.total_matches || (winsVal + lossesVal + drawsVal) || 0;
  const wr = p.win_rate !== undefined ? p.win_rate : (data.win_rate !== undefined ? data.win_rate : (totalM > 0 ? ((winsVal / totalM) * 100).toFixed(1) : 0));
  const winrateEl = document.getElementById('modal-winrate');
  if (winrateEl) winrateEl.innerText = `${wr}%`;
  const streakEl = document.getElementById('modal-streak');
  if (streakEl) {
    const streakVal = data.longest_win_streak ?? data.max_streak ?? p.peak_streak ?? p.streak;
    streakEl.innerText = streakVal !== undefined ? `${streakVal} Wins` : '-';
  }

  currentPlayerTrajectory = data.trajectory || [];
  const rawMatchesList = data.history || data.win_path || [];
  const matchesList = typeof sortMatchesNewestFirst === 'function'
    ? sortMatchesNewestFirst(rawMatchesList)
    : rawMatchesList;
  currentPlayerMatches = matchesList;

  // Render Recent Form beads (from data.recent_form or matchesList)
  const formBeadsEl = document.getElementById('modal-recent-form-beads');
  const recentForForm = (Array.isArray(data.recent_form) && data.recent_form.length > 0)
    ? data.recent_form
    : matchesList.slice(0, 5);
  if (formBeadsEl) {
    formBeadsEl.innerHTML = '';
    if (recentForForm.length > 0) {
      recentForForm.forEach(m => {
        const bead = document.createElement('span');
        const isW = m.result === 'W';
        const isL = m.result === 'L';
        const cls = isW ? 'win' : (isL ? 'loss' : 'draw');
        bead.className = `scout-form-bead ${cls}`;
        bead.innerText = m.result || '-';
        bead.title = `${m.result || '-'} vs ${m.opponent_name || 'Opponent'} (${(m.match_date || '').slice(0, 10)})`;
        formBeadsEl.appendChild(bead);
      });
    } else {
      formBeadsEl.innerHTML = '<span style="font-size:0.7rem; color:var(--text-muted);">-</span>';
    }
  }

  // Compute & Render Faction Mastery & Matchup Matrix
  const masteryList = typeof computeProfileFactionMastery === 'function'
    ? computeProfileFactionMastery(
        rawMatchesList,
        data.faction_mastery || data.factions_breakdown,
        data.tournaments || data.events_attended,
        data.tracker_history || data.completed_history
      )
    : (data.faction_mastery || data.factions_breakdown || []);
  const matchupList = typeof computeProfileMatchupMatrix === 'function'
    ? computeProfileMatchupMatrix(
        rawMatchesList,
        data.matchup_matrix,
        data.tournaments || data.events_attended,
        data.tracker_history || data.completed_history
      )
    : (data.matchup_matrix || []);

  renderPlayerModalTelemetryPanels(masteryList, matchupList);

  const totalRecordedMatches = Number(data.history_count || matchesList.length || totalM || 0);
  const morePromptEl = document.getElementById('modal-matches-more-prompt');
  const noteEl = document.getElementById('modal-matches-count-note');
  if (totalRecordedMatches > 0) {
    if (noteEl) noteEl.innerText = `${totalRecordedMatches} career match${totalRecordedMatches === 1 ? '' : 'es'}`;
    if (morePromptEl) {
      morePromptEl.style.display = 'flex';
      morePromptEl.innerHTML = `
        <span>Showing Faction Mastery &amp; Matchup Matrix across <strong>${totalRecordedMatches}</strong> career matches</span>
        <span class="scout-more-link" onclick="openDedicatedPlayerProfileFromModal()">View match history in full profile ↗</span>
      `;
    }
  } else {
    if (noteEl) noteEl.innerText = '0 recorded matches';
    if (morePromptEl) morePromptEl.style.display = 'none';
  }
}

async function openPlayerModal(playerId, playerName = '') {
  if (!playerId && !playerName) return;
  const modal = document.getElementById('player-modal');
  if (!modal) return;

  const targetId = String(playerId || '').trim();
  const targetName = String(playerName || '').trim();
  const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
  const cacheKey = `${sys}:${(targetId || targetName).toLowerCase()}`;

  currentModalPlayerId = targetId;
  currentModalPlayerName = targetName;
  window.currentModalPlayerId = currentModalPlayerId;
  window.currentModalPlayerName = currentModalPlayerName;

  bringModalToFront(modal);

  // 1. Check L1 Quick Modal Cache for 0ms instant render
  const cachedEntry = window._quickPlayerModalCache.get(cacheKey);
  if (cachedEntry && (Date.now() - cachedEntry.ts) < 300000) {
    _applyPlayerModalData(cachedEntry.data, targetId, targetName);
    return;
  }

  // 2. Immediately prefill header & core stats from in-memory leaderboard row if available (0ms),
  //    or reset cleanly so previous player's stats never linger
  const preseeded = _findPreseededPlayerInMemory(targetId, targetName);
  const nameEl = document.getElementById('modal-player-name');
  if (nameEl) nameEl.innerText = (preseeded && (preseeded.player_name || preseeded.full_name)) || targetName || 'Player Profile';

  if (preseeded) {
    _applyPlayerModalData(preseeded, targetId, targetName);
  } else {
    ['modal-elo', 'modal-peak', 'modal-record', 'modal-winrate', 'modal-streak'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '-';
    });
    const teamDiv = document.getElementById('modal-player-team');
    if (teamDiv) { teamDiv.innerHTML = ''; teamDiv.style.display = 'none'; }
    const facDiv = document.getElementById('modal-player-factions');
    if (facDiv) { facDiv.innerHTML = ''; facDiv.style.display = 'none'; }
    const beadsEl = document.getElementById('modal-recent-form-beads');
    if (beadsEl) beadsEl.innerHTML = '<span style="font-size:0.7rem; color:var(--text-muted);">...</span>';
  }

  const fmListEl = document.getElementById('modal-faction-mastery-list');
  const mmListEl = document.getElementById('modal-matchup-matrix-list');
  if (fmListEl && (!preseeded || !preseeded.faction_mastery)) {
    fmListEl.innerHTML = '<div style="font-size:0.76rem; color:var(--text-muted); padding:0.5rem 0; text-align:center;">Loading faction mastery...</div>';
  }
  if (mmListEl && (!preseeded || !preseeded.matchup_matrix)) {
    mmListEl.innerHTML = '<div style="font-size:0.76rem; color:var(--text-muted); padding:0.5rem 0; text-align:center;">Loading matchup matrix...</div>';
  }

  const chatContainer = document.getElementById('modal-player-chat-container');
  if (chatContainer) chatContainer.innerHTML = '';

  try {
    const data = typeof window.api.getPlayerQuickProfile === 'function'
      ? await window.api.getPlayerQuickProfile(targetId || 'unknown', sys, targetName)
      : await window.api.getPlayerProfile(targetId || 'unknown', sys, targetName, true);
    if (currentModalPlayerId !== targetId && currentModalPlayerName !== targetName) {
      return; // User switched modal before response returned
    }
    window._quickPlayerModalCache.set(cacheKey, { data, ts: Date.now() });
    if (data && data.player_id) {
      window._quickPlayerModalCache.set(`${sys}:${String(data.player_id).toLowerCase()}`, { data, ts: Date.now() });
    }
    _applyPlayerModalData(data, targetId, targetName);
  } catch (err) {
    if (fmListEl) fmListEl.innerHTML = `<div style="color:var(--loss); font-size:0.78rem; padding:0.5rem;">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function handlePlayerModalSearch(query) {
  playerModalSearchQuery = (query || '').trim().toLowerCase();
  const clearBtn = document.getElementById('player-modal-search-clear');
  if (clearBtn) clearBtn.style.display = playerModalSearchQuery ? 'block' : 'none';

  if (!currentPlayerMatches || currentPlayerMatches.length === 0) return;

  if (!playerModalSearchQuery) {
    const summary = document.getElementById('player-modal-search-summary');
    if (summary) summary.style.display = 'none';
    renderPlayerMatches(currentPlayerMatches);
    return;
  }

  const filtered = currentPlayerMatches.filter(h => {
    const oppName = (h.opponent_name || '').toLowerCase();
    const evName = (h.event_name || '').toLowerCase();
    const myFac = (h.player_faction || '').toLowerCase();
    const oppFac = (h.opponent_faction || '').toLowerCase();
    const oppTeam = (h.opponent_team || h.team || '').toLowerCase();
    return oppName.includes(playerModalSearchQuery) ||
           evName.includes(playerModalSearchQuery) ||
           myFac.includes(playerModalSearchQuery) ||
           oppFac.includes(playerModalSearchQuery) ||
           oppTeam.includes(playerModalSearchQuery);
  });

  const summary = document.getElementById('player-modal-search-summary');
  if (summary) {
    summary.innerText = `Showing ${filtered.length} of ${currentPlayerMatches.length} matches`;
    summary.style.display = 'block';
  }

  renderPlayerMatches(filtered, true);
}

function clearPlayerModalSearch() {
  const input = document.getElementById('player-modal-search');
  if (input) input.value = '';
  handlePlayerModalSearch('');
  if (input) input.focus();
}

window.handlePlayerModalSearch = handlePlayerModalSearch;
window.clearPlayerModalSearch = clearPlayerModalSearch;

function renderPlayerMatches(history, isFiltered = false) {
  const tbody = document.getElementById('modal-matches-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!history || history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state" style="padding: 1.5rem 1rem; color: var(--text-muted);">No match records stored yet.</td></tr>';
    return;
  }

  // Display at most 5 recent matches in the quick scout card
  const scoutPlayerId = currentModalPlayerId || '';
  const scoutPlayerName = currentModalPlayerName || 'Player';
  const previewMatches = history.slice(0, 5);
  previewMatches.forEach((h, mIdx) => {
    const tr = document.createElement('tr');
    const isWin = h.result === 'W';
    const isLoss = h.result === 'L';
    const resClass = isWin ? 'badge-win' : (isLoss ? 'badge-loss' : 'badge-draw');
    const dVal = Number(h.delta_elo || 0);
    const dStr = `${dVal >= 0 ? '+' : ''}${dVal.toFixed(1)}`;
    const dColor = dVal > 0 ? 'var(--win)' : (dVal < 0 ? 'var(--loss)' : 'var(--text-muted)');

    const oppName = h.opponent_name || (h.result === 'BYE' ? 'BYE' : 'Opponent');
    const oppFacStr = h.opponent_faction || '';
    const oppFac = oppFacStr ? `<span class="scout-opp-fac">${escapeHtml(oppFacStr)}</span>` : '';
    const isBye = Boolean(h.is_bye || h.result === 'BYE' || (oppName && oppName.toUpperCase() === 'BYE'));
    const oppId = h.opponent_id || '';
    const canOpenOpp = !isBye && (oppId || (oppName && oppName !== 'Opponent' && oppName !== 'Unknown'));
    const oppLink = canOpenOpp
      ? `<span class="player-link scout-opp-name" style="cursor:pointer;" onclick="event.stopPropagation(); openPlayerModal('${escapeJsArg(oppId)}', '${escapeJsArg(oppName)}')">${escapeHtml(oppName)}</span>`
      : `<span class="scout-opp-name" style="color:#fff;">${escapeHtml(oppName)}</span>`;

    const evId = h.event_id || '';
    const evName = h.event_name || 'Tournament';
    const evDate = (h.match_date || '').slice(0, 10);
    const roundNum = h.round || (previewMatches.length - mIdx);
    const tableNum = h.table_number || h.table || '';
    const myFac = h.player_faction || '';
    const evSub = [evDate, h.round ? `R${h.round}` : ''].filter(Boolean).join(' · ');

    const hasScores = (h.player_score !== null && h.player_score !== undefined && h.opponent_score !== null && h.opponent_score !== undefined);
    const scoreStr = hasScores ? `${h.player_score} - ${h.opponent_score}` : '-';
    const scorecardMatchId = h.tracker_match_id
      || (h.match_id ? String(h.match_id) : '')
      || (evId && tableNum ? `BCP-${evId}-R${roundNum}-T${tableNum}` : (evId ? `BCP-${evId}-R${roundNum}-P-${scoutPlayerId || scoutPlayerName}` : `MATCH-R${roundNum}`));

    const oppRosterBtn = (!isBye && evId) ? `
      <button type="button" class="journey-action-pill journey-roster-pill-sm" onclick="event.stopPropagation(); openJourneyPlayerRosterModal('${escapeJsArg(evId)}', '${escapeJsArg(oppId)}', '${escapeJsArg(oppName)}', '${escapeJsArg(oppFacStr)}', '${escapeJsArg(evName)}')" title="View ${escapeHtml(oppName)}'s army roster">
        📋 Roster
      </button>
    ` : '';

    const myRosterBtn = evId ? `
      <button type="button" class="journey-action-pill journey-roster-pill-sm" onclick="event.stopPropagation(); openJourneyPlayerRosterModal('${escapeJsArg(evId)}', '${escapeJsArg(scoutPlayerId)}', '${escapeJsArg(scoutPlayerName)}', '${escapeJsArg(myFac)}', '${escapeJsArg(evName)}')" title="View ${escapeHtml(scoutPlayerName)}'s army roster">
        📋 Roster
      </button>
    ` : '';

    const scoreCellHtml = (!isBye && hasScores) ? `
      <button type="button" class="journey-scorecard-pill" onclick="event.stopPropagation(); openJourneyScorecardModal('${escapeJsArg(scorecardMatchId)}', '${escapeJsArg(evId)}', '${escapeJsArg(evName)}', '${escapeJsArg(roundNum)}', '${escapeJsArg(tableNum)}', '${escapeJsArg(evDate)}', '${escapeJsArg(scoutPlayerId)}', '${escapeJsArg(scoutPlayerName)}', '${escapeJsArg(myFac)}', '${escapeJsArg(h.player_score)}', '${escapeJsArg(oppId)}', '${escapeJsArg(oppName)}', '${escapeJsArg(oppFacStr)}', '${escapeJsArg(h.opponent_score)}')" title="View match scorecard">
        <span>📊</span><span>${scoreStr}</span>
      </button>
    ` : scoreStr;

    tr.innerHTML = `
      <td style="text-align: center;"><span class="badge ${resClass}" style="font-size: 0.72rem; padding: 0.15rem 0.4rem; min-width: 22px;">${h.result || '-'}</span></td>
      <td>
        <div class="scout-cell-stack">
          ${oppLink}
          <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
            ${oppFac}
            ${oppRosterBtn}
          </div>
        </div>
      </td>
      <td class="scout-col-event">
        <div class="scout-cell-stack">
          <span class="player-link scout-event-name" onclick="event.stopPropagation(); openEventModal('${escapeJsArg(evId)}')" title="${escapeHtml(evName)}">${escapeHtml(evName)}</span>
          <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
            <span class="scout-event-meta">${escapeHtml(evSub)}</span>
            ${myRosterBtn}
          </div>
        </div>
      </td>
      <td style="text-align: center; font-family: var(--font-mono); font-size: 0.82rem; color: #e2e8f0;">
        ${scoreCellHtml}
      </td>
      <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; font-size: 0.85rem; color: ${dColor};">
        ${dStr}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderTrajectoryChart(trajectory) {
  const svg = document.getElementById('trajectory-svg');
  if (!svg || !trajectory || trajectory.length === 0) return;

  const w = svg.clientWidth || 760;
  const h = 200;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = '';

  const elos = trajectory.map(t => Number(t.elo));
  const minElo = Math.floor(Math.min(...elos) - 20);
  const maxElo = Math.ceil(Math.max(...elos) + 20);
  const range = maxElo - minElo || 1;

  const padX = 40;
  const padY = 25;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  const points = trajectory.map((t, idx) => {
    const x = padX + (idx / (trajectory.length - 1 || 1)) * plotW;
    const y = padY + plotH - ((Number(t.elo) - minElo) / range) * plotH;
    return { x, y, elo: Number(t.elo), result: t.result, date: t.date };
  });

  // Grid lines
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const val = minElo + (range / gridLines) * i;
    const y = padY + plotH - (i / gridLines) * plotH;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padX);
    line.setAttribute('y1', y);
    line.setAttribute('x2', w - padX);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', '#1e2533');
    line.setAttribute('stroke-dasharray', '3,3');
    svg.appendChild(line);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padX - 8);
    txt.setAttribute('y', y + 4);
    txt.setAttribute('fill', '#64748b');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('font-family', 'monospace');
    txt.setAttribute('text-anchor', 'end');
    txt.textContent = Math.round(val);
    svg.appendChild(txt);
  }

  // Draw Path Line
  let dStr = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    dStr += ` L ${points[i].x} ${points[i].y}`;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', dStr);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#38bdf8');
  path.setAttribute('stroke-width', '2.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);

  // Draw Points
  points.forEach(pt => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', pt.x);
    circle.setAttribute('cy', pt.y);
    circle.setAttribute('r', '4');
    circle.setAttribute('fill', pt.result === 'W' ? '#22c55e' : (pt.result === 'L' ? '#ef4444' : '#eab308'));
    circle.setAttribute('stroke', '#0a0c10');
    circle.setAttribute('stroke-width', '1.5');
    svg.appendChild(circle);
  });
}

let currentTeamRoster = [];
let currentModalTeamName = '';

function openDedicatedTeamProfileFromModal() {
  if (typeof currentModalTeamName !== 'undefined' && currentModalTeamName) {
    if (typeof closeAllModals === 'function') {
      closeAllModals();
    } else if (typeof closeModal === 'function') {
      closeModal('team-modal');
    }
    if (typeof openTeamProfilePage === 'function') {
      openTeamProfilePage(currentModalTeamName);
    }
  }
}
window.openDedicatedTeamProfileFromModal = openDedicatedTeamProfileFromModal;

async function openTeamModal(teamName) {
  currentModalTeamName = (teamName || '').trim();
  const modal = document.getElementById('team-modal');
  if (!modal) return;
  bringModalToFront(modal);

  const titleEl = document.getElementById('modal-team-title');
  if (titleEl) titleEl.innerText = teamName || 'Team Roster';
  const subEl = document.getElementById('modal-team-subtitle');
  if (subEl) subEl.innerText = 'Loading roster details...';

  const tbody = document.getElementById('team-roster-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Loading team roster...</div></td></tr>';

  try {
    const data = await window.api.getTeamRoster(teamName);
    const stats = data.stats || {};
    const roster = data.roster || [];
    currentTeamRoster = roster;

    if (subEl) subEl.innerText = `Gaming Club / Team • ${roster.length} registered competitors`;
    const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
    const pwrEl = document.getElementById('team-modal-power');
    if (pwrEl) {
      if (stats.power_rating && typeof renderEloBadgePill === 'function') {
        pwrEl.innerHTML = renderEloBadgePill(stats.power_rating, null, { showTierName: true, size: 'md', gameSystem: sys });
      } else {
        pwrEl.innerText = stats.power_rating ? Number(stats.power_rating).toFixed(1) : '-';
      }
    }
    const rosEl = document.getElementById('team-modal-roster');
    if (rosEl) rosEl.innerText = stats.active_roster_count !== undefined && stats.active_roster_count !== null ? `${stats.active_roster_count} Active (${stats.roster_count || roster.length} Total)` : `${stats.roster_count || roster.length} Players`;
    const matEl = document.getElementById('team-modal-matches');
    if (matEl) matEl.innerText = `${stats.total_matches || 0} (${stats.total_wins || 0}W - ${stats.total_losses || 0}L${stats.total_draws ? ' - ' + stats.total_draws + 'D' : ''})`;
    const wrEl = document.getElementById('team-modal-winrate');
    if (wrEl) wrEl.innerText = `${stats.win_rate || 0}%`;

    const top5El = document.getElementById('team-modal-top5-avg');
    const top5Pill = document.getElementById('team-modal-top5-pill');
    let top5Avg = stats.top5_avg_elo;
    if ((top5Avg === undefined || top5Avg === null) && roster.length > 0) {
      const activeCore = roster.filter(p => p.is_active !== false).slice(0, 5);
      if (activeCore.length > 0) {
        top5Avg = (activeCore.reduce((sum, p) => sum + Number(p.current_elo || 1500), 0) / activeCore.length).toFixed(1);
      }
    }
    if (top5El) {
      if (top5Avg && Number(top5Avg) > 0) {
        if (typeof renderEloBadgePill === 'function') {
          top5El.innerHTML = renderEloBadgePill(top5Avg, null, { showTierName: true, size: 'md', gameSystem: sys });
        } else {
          top5El.innerText = Number(top5Avg).toFixed(1);
        }
        if (top5Pill) top5Pill.style.display = 'inline-flex';
      } else {
        if (top5Pill) top5Pill.style.display = 'none';
      }
    }

    renderTeamRosterRows(roster);
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error loading team: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderTeamRosterRows(roster) {
  const tbody = document.getElementById('team-roster-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!roster || roster.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No player records found for this team.</td></tr>';
    return;
  }

  // Determine if current sort is default (current_elo descending)
  const isDefaultSort = !window.currentSort || !window.currentSort['team-roster'] || 
    (window.currentSort['team-roster'].field === 'current_elo' && !window.currentSort['team-roster'].asc);

  function createPlayerRow(p, displayRank) {
    const tr = document.createElement('tr');
    const safeName = p.player_name || p.full_name || 'Player';
    tr.onclick = (e) => { e.stopPropagation(); openPlayerModal(p.player_id, safeName); };

    const sys = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : '40k';
    const totalMatches = Number(p.matches_played || (Number(p.wins || 0) + Number(p.losses || 0) + Number(p.draws || 0)) || 10);
    const eloBadgeHtml = typeof renderEloBadgePill === 'function'
      ? renderEloBadgePill(p.current_elo || 1500, totalMatches, { showTierName: true, size: 'md', gameSystem: sys })
      : `<span class="elo-badge ${getEloBadgeClass(p.current_elo)}">${Number(p.current_elo || 1500).toFixed(1)}</span>`;
    const winRate = p.win_rate !== undefined ? p.win_rate : (p.matches_played > 0 ? ((p.wins / p.matches_played) * 100).toFixed(1) : 0);

    const isAce = p.is_ace === true;
    const isCore = p.is_core === true && !isAce;
    const isInactive = p.is_active === false;

    let rowClass = 'roster-row-standard';
    let rankCellClass = 'rank-cell';
    let rankContent = `#${displayRank}`;
    let badgeHtml = '';

    if (isAce) {
      rowClass = 'roster-row-ace';
      rankCellClass = 'rank-cell rank-top-1';
      rankContent = `#${displayRank} <span class="rank-crown" title="Top Ace">👑</span>`;
      badgeHtml = `<span class="roster-core-badge badge-ace" title="Top Ace — Anchors 20% Ace + 40% Core Avg in Team Power Rating">👑 TOP ACE</span>`;
    } else if (isCore) {
      rowClass = 'roster-row-core';
      rankCellClass = 'rank-cell rank-core';
      badgeHtml = `<span class="roster-core-badge badge-core" title="Core 5 — Primary 5-player squad anchoring 40% of Team Power Rating">🛡️ CORE 5</span>`;
    } else if (isInactive) {
      rowClass = 'roster-row-standard roster-row-inactive';
      badgeHtml = `<span class="roster-inactive-badge" title="Inactive (>180 days without match play) • Excluded from active Core 5 and Power Rating">Inactive</span>`;
    }

    tr.className = rowClass;

    tr.innerHTML = `
      <td class="${rankCellClass}">${rankContent}</td>
      <td>
        <div class="player-name-cell">
          <span class="player-link">${escapeHtml(safeName)}</span>
          ${badgeHtml}
        </div>
      </td>
      <td>
        ${eloBadgeHtml}
      </td>
      <td style="font-family:var(--font-mono); color:var(--text-secondary);">
        ${Number(p.peak_elo || p.current_elo || 1500).toFixed(1)}
      </td>
      <td style="font-family:var(--font-mono); font-size:0.85rem;">
        <span style="color:var(--win); font-weight:600;">${p.wins || 0}W</span> - 
        <span style="color:var(--loss); font-weight:600;">${p.losses || 0}L</span>
        ${p.draws ? ` - <span style="color:var(--draw); font-weight:600;">${p.draws}D</span>` : ''}
      </td>
      <td style="font-family:var(--font-mono); font-weight:600;">
        <span style="color: ${winRate >= 60 ? 'var(--win)' : (winRate >= 45 ? 'var(--accent)' : 'var(--text-secondary)')};">
          ${winRate}%
        </span>
      </td>
      <td>
        <span class="faction-pill">${escapeHtml(p.top_faction || 'Various')}</span>
      </td>
    `;
    return tr;
  }

  if (isDefaultSort) {
    const activePlayers = roster.filter(p => p.is_active !== false).sort((a, b) => Number(b.current_elo || 1500) - Number(a.current_elo || 1500));
    const inactivePlayers = roster.filter(p => p.is_active === false).sort((a, b) => Number(b.current_elo || 1500) - Number(a.current_elo || 1500));

    activePlayers.forEach((p, idx) => {
      p.active_rank = idx + 1;
      p.is_ace = (idx === 0);
      p.is_core = (idx < 5);
      
      const tr = createPlayerRow(p, idx + 1);
      tbody.appendChild(tr);

      // Insert Active Club Depth divider after 5th active player
      if (idx === 4 && activePlayers.length > 5) {
        const remainingActive = activePlayers.length - 5;
        const depthTr = document.createElement('tr');
        depthTr.className = 'roster-divider-row';
        depthTr.innerHTML = `
          <td colspan="7">
            <div class="roster-divider-content">
              <div class="roster-divider-left">
                <span class="roster-divider-icon">👥</span>
                <span class="roster-divider-title">Active Club Depth</span>
                <span class="roster-divider-count">(${remainingActive} additional active ${remainingActive === 1 ? 'competitor' : 'competitors'})</span>
              </div>
              <div class="roster-divider-right">
                <span>Contributes to 40% Club Average</span>
              </div>
            </div>
          </td>
        `;
        tbody.appendChild(depthTr);
      }
    });

    if (inactivePlayers.length > 0) {
      inactivePlayers.forEach(p => {
        p.active_rank = null;
        p.is_ace = false;
        p.is_core = false;
      });

      const inactTr = document.createElement('tr');
      inactTr.className = 'roster-divider-row roster-inactive-divider-row';
      inactTr.innerHTML = `
        <td colspan="7">
          <div class="roster-divider-content">
            <div class="roster-divider-left">
              <span class="roster-divider-icon">💤</span>
              <span class="roster-divider-title">Inactive Roster</span>
              <span class="roster-divider-count">(${inactivePlayers.length} on hiatus • >180 days without match play)</span>
            </div>
            <div class="roster-divider-right">
              <span>Excluded from Team Power Rating</span>
            </div>
          </div>
        </td>
      `;
      tbody.appendChild(inactTr);

      inactivePlayers.forEach((p, idx) => {
        const tr = createPlayerRow(p, activePlayers.length + idx + 1);
        tbody.appendChild(tr);
      });
    }
  } else {
    // Non-default sort: preserve current sort order
    roster.forEach((p, idx) => {
      const tr = createPlayerRow(p, idx + 1);
      tbody.appendChild(tr);
    });
  }
}


let currentFactionName = '';
let currentFactionTimeframe = '1yr';
let currentFactionMatches = [];
let currentFactionPlayers = [];
let currentFactionMatchups = [];

function updateFactionModalTfButtons() {
  ['30d', '3mo', '6mo', '1yr', 'all'].forEach(tf => {
    const btn = document.getElementById(`faction-tf-${tf}`);
    if (btn) {
      const isActive = tf === currentFactionTimeframe;
      btn.classList.toggle('active', isActive);
      btn.style.background = isActive ? 'var(--accent)' : 'transparent';
      btn.style.color = isActive ? '#fff' : 'var(--text-secondary)';
      btn.style.fontWeight = isActive ? '700' : '600';
    }
  });
}

async function changeFactionModalTimeframe(tf) {
  currentFactionTimeframe = tf || '1yr';
  updateFactionModalTfButtons();
  if (currentFactionName) {
    await loadFactionModalData(currentFactionName, currentFactionTimeframe);
  }
}
window.changeFactionModalTimeframe = changeFactionModalTimeframe;

const FACTION_MODAL_STORAGE_KEY = 'omni_faction_modal_cache_v3';
const factionModalDataCache = new Map();
const factionModalInflightPromises = new Map();
let factionModalAbortController = null;

function clearFactionModalClientCache() {
  factionModalDataCache.clear();
  try { sessionStorage.removeItem(FACTION_MODAL_STORAGE_KEY); } catch (e) {}
  try { localStorage.removeItem(FACTION_MODAL_STORAGE_KEY); } catch (e) {}
}
window.clearFactionModalClientCache = clearFactionModalClientCache;

// Hydrate factionModalDataCache from sessionStorage / localStorage on startup
(function hydrateFactionModalCacheFromStorage() {
  try {
    const raw = sessionStorage.getItem(FACTION_MODAL_STORAGE_KEY) || localStorage.getItem(FACTION_MODAL_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    const now = Date.now();
    Object.entries(parsed).forEach(([k, v]) => {
      if (v && v.data && v.timestamp && (now - v.timestamp < 1800000)) { // keep up to 30m for instant stale-while-revalidate
        factionModalDataCache.set(k, { ...v, fromStorage: true });
      }
    });
  } catch (e) {}
})();

function persistFactionModalCacheToStorage() {
  try {
    const entries = Array.from(factionModalDataCache.entries())
      .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0))
      .slice(0, 35);
    const obj = {};
    entries.forEach(([k, v]) => { obj[k] = { timestamp: v.timestamp, data: v.data }; });
    const serialized = JSON.stringify(obj);
    try { sessionStorage.setItem(FACTION_MODAL_STORAGE_KEY, serialized); } catch (e) {}
    try { localStorage.setItem(FACTION_MODAL_STORAGE_KEY, serialized); } catch (e) {}
  } catch (e) {}
}

function setFactionModalCacheEntry(cacheKey, data) {
  const now = Date.now();
  factionModalDataCache.set(cacheKey, { timestamp: now, data, fromStorage: false });
  persistFactionModalCacheToStorage();
}

function deriveFactionModalFromCachedSuperset(factionName, sys, targetTf) {
  const facNorm = (factionName || '').trim().toLowerCase();
  const tfDaysMap = { '30d': 31, '3mo': 92, '6mo': 183, '1yr': 366, 'all': 36500 };
  const targetDays = tfDaysMap[targetTf] || 366;
  const candidateOrder = ['all', '1yr', '6mo', '3mo'];

  for (const candTf of candidateOrder) {
    const candDays = tfDaysMap[candTf] || 0;
    if (candDays < targetDays && !(targetTf === 'all' && candTf === '1yr')) continue;
    const candEntry = factionModalDataCache.get(`${facNorm}_${sys}_${candTf}`);
    if (!candEntry || !candEntry.data) continue;
    const src = candEntry.data;
    const cutoffStr = targetTf === 'all'
      ? ''
      : new Date(Date.now() - targetDays * 86400000).toISOString().substring(0, 10);
    const filteredMatches = cutoffStr
      ? (src.matches || []).filter(m => !m.match_date || String(m.match_date).substring(0, 10) >= cutoffStr)
      : (src.matches || []);

    // Also check if factionMetaClientCache has exact matchup / total_matches stats for this timeframe
    let metaMatchups = null;
    let metaTotalMatches = null;
    try {
      const presetMap = { '30d': '30d', '3mo': '90d', '6mo': '180d', '1yr': '1yr', 'all': 'all' };
      const metaKey = `${sys}_preset_${presetMap[targetTf] || targetTf}`;
      if (typeof factionMetaClientCache !== 'undefined' && factionMetaClientCache.has(metaKey)) {
        const metaData = factionMetaClientCache.get(metaKey).data;
        if (metaData && Array.isArray(metaData.factions)) {
          const foundFac = metaData.factions.find(f => String(f.faction || '').trim().toLowerCase() === facNorm);
          if (foundFac) {
            metaTotalMatches = foundFac.total_matches;
          }
        }
        if (metaData && metaData.matchups_by_faction) {
          const muList = metaData.matchups_by_faction[factionName] || metaData.matchups_by_faction[facNorm];
          if (Array.isArray(muList) && muList.length > 0) {
            metaMatchups = muList.map(m => ({
              opponent_faction: m.opponent_faction,
              total_matches: m.total_matches || m.matches || 0,
              wins: m.wins || 0,
              losses: m.losses || 0,
              draws: m.draws || 0,
              win_rate: m.win_rate || 0
            }));
          }
        }
      }
    } catch (e) {}

    return {
      faction: factionName,
      game_system: sys,
      timeframe: targetTf,
      stats: {
        ...(src.stats || {}),
        total_matches: metaTotalMatches || (targetTf === candTf ? (src.total_matches || filteredMatches.length) : filteredMatches.length)
      },
      total_matches: metaTotalMatches || (targetTf === candTf ? (src.total_matches || filteredMatches.length) : filteredMatches.length),
      top_players: src.top_players || [],
      matches: filteredMatches,
      matchups: metaMatchups || src.matchups || [],
      _derived: true
    };
  }
  return null;
}

function deriveInstantFactionMetaSnapshot(factionName, sys, targetTf) {
  const facNorm = (factionName || '').trim().toLowerCase();
  if (!facNorm) return null;
  const presetMap = { '30d': '30d', '3mo': '90d', '6mo': '180d', '1yr': '1yr', 'all': 'all' };
  const mappedPreset = presetMap[targetTf] || targetTf;
  const metaKey = `${sys}_preset_${mappedPreset}`;

  let metaSource = null;
  try {
    if (typeof factionMetaClientCache !== 'undefined' && factionMetaClientCache.has(metaKey)) {
      metaSource = factionMetaClientCache.get(metaKey).data;
    } else if (typeof factionMetaData !== 'undefined' && factionMetaData && Array.isArray(factionMetaData.factions)) {
      metaSource = factionMetaData;
    }
  } catch (e) {}

  if (!metaSource || !Array.isArray(metaSource.factions)) return null;
  const facEntry = metaSource.factions.find(f => String(f.faction || '').trim().toLowerCase() === facNorm);
  const muDict = metaSource.matchups_by_faction || {};
  let rawMu = muDict[factionName] || muDict[facNorm] || null;
  if (!rawMu) {
    const matchKey = Object.keys(muDict).find(k => String(k).trim().toLowerCase() === facNorm);
    if (matchKey) rawMu = muDict[matchKey];
  }
  if (!facEntry && (!Array.isArray(rawMu) || rawMu.length === 0)) return null;

  const matchups = Array.isArray(rawMu)
    ? rawMu.map(m => ({
        opponent_faction: m.opponent_faction || '',
        total_matches: Number(m.total_matches || m.matches || 0),
        wins: Number(m.wins || 0),
        losses: Number(m.losses || 0),
        draws: Number(m.draws || 0),
        win_rate: Number(m.win_rate || 0),
        avg_margin: Number(m.avg_margin || 0)
      }))
    : [];

  return {
    faction: factionName,
    game_system: sys,
    timeframe: targetTf,
    stats: facEntry ? {
      total_matches: Number(facEntry.total_matches || 0),
      total_wins: Number(facEntry.wins || 0),
      total_losses: Number(facEntry.losses || 0),
      total_draws: Number(facEntry.draws || 0),
      win_rate: Number(facEntry.win_rate || 0),
      non_mirror_win_rate: Number(facEntry.non_mirror_win_rate ?? facEntry.win_rate ?? 0),
      avg_score: Number(facEntry.avg_score || 0),
      avg_opp_score: Number(facEntry.avg_opp_score || 0),
      avg_margin: Number(facEntry.avg_margin || 0),
      meta_share: Number(facEntry.meta_share || 0),
      unique_pilots: Number(facEntry.unique_pilots || 0),
      x0_runs: Number(facEntry.x0_runs || 0),
      x1_runs: Number(facEntry.x1_runs || 0),
      tiwp_rate: Number(facEntry.tiwp_rate || 0),
      over_rep_ratio: Number(facEntry.over_rep_ratio || 0),
      tier: facEntry.tier || '',
      tier_label: facEntry.tier_label || '',
      best_matchup: facEntry.best_matchup || null,
      worst_matchup: facEntry.worst_matchup || null,
      opponent_factions_count: matchups.length
    } : {},
    total_matches: facEntry ? Number(facEntry.total_matches || 0) : 0,
    top_players: [],
    matches: [],
    matchups,
    _instantMetaOnly: true
  };
}

function fetchFactionDetailsShared(factionName, sys, tf) {
  const facNorm = (factionName || '').trim().toLowerCase();
  const cacheKey = `${facNorm}_${sys}_${tf}`;
  if (factionModalInflightPromises.has(cacheKey)) {
    return factionModalInflightPromises.get(cacheKey);
  }
  const p = window.api.getFactionDetails(factionName, 350, sys, tf)
    .then(data => {
      factionModalInflightPromises.delete(cacheKey);
      if (data && !data.error && !data.aborted) {
        setFactionModalCacheEntry(cacheKey, data);
      }
      return data;
    })
    .catch(err => {
      factionModalInflightPromises.delete(cacheKey);
      throw err;
    });
  factionModalInflightPromises.set(cacheKey, p);
  return p;
}

let _lastHoveredFactionPrefetch = '';
function prefetchFactionModalData(factionName, sysOverride = null) {
  if (!factionName) return;
  const sys = sysOverride || (typeof currentGameSystem !== 'undefined' && currentGameSystem ? currentGameSystem : '40k');
  const facNorm = factionName.trim().toLowerCase();
  const activeTf = currentFactionTimeframe || '1yr';
  const hoverKey = `${facNorm}_${sys}_${activeTf}`;
  if (_lastHoveredFactionPrefetch === hoverKey) return;
  _lastHoveredFactionPrefetch = hoverKey;

  const ck = `${facNorm}_${sys}_${activeTf}`;
  const existing = factionModalDataCache.get(ck);
  if (existing && (Date.now() - existing.timestamp < 1800000)) return;
  fetchFactionDetailsShared(factionName, sys, activeTf).catch(() => {});
}
window.prefetchFactionModalData = prefetchFactionModalData;

function prefetchTopFactionsModalCache(factionsList, sysOverride = null) {
  if (!Array.isArray(factionsList) || factionsList.length === 0) return;
  const sys = sysOverride || (typeof currentGameSystem !== 'undefined' && currentGameSystem ? currentGameSystem : '40k');
  setTimeout(async () => {
    for (const fac of factionsList.slice(0, 3)) {
      if (!fac) continue;
      const facNorm = String(fac).trim().toLowerCase();
      const ck = `${facNorm}_${sys}_1yr`;
      const existing = factionModalDataCache.get(ck);
      if (existing && (Date.now() - existing.timestamp < 1800000)) continue;
      try {
        await fetchFactionDetailsShared(fac, sys, '1yr');
      } catch (e) {}
    }
  }, 1200);
}
window.prefetchTopFactionsModalCache = prefetchTopFactionsModalCache;

function prefetchRemainingModalTimeframes(factionName, sys, activeTf) {
  if (!factionName) return;
  const facNorm = factionName.trim().toLowerCase();
  const fallbackTf = activeTf === '1yr' ? '3mo' : '1yr';
  setTimeout(async () => {
    const ck = `${facNorm}_${sys}_${fallbackTf}`;
    const existing = factionModalDataCache.get(ck);
    if (existing && (Date.now() - existing.timestamp < 1800000)) return;
    try {
      await fetchFactionDetailsShared(factionName, sys, fallbackTf);
    } catch (e) {}
  }, 800);
}

let currentFactionStats = {};
let fmodalMatchupVerdictFilter = 'ALL';
let fmodalMatchOutcomeFilter = 'ALL';

function renderFactionTableSkeletons(onlyMatches = false) {
  const matchBody = document.getElementById('faction-matches-body');
  const matchupsBody = document.getElementById('faction-matchups-body');
  const kpiStrip = document.getElementById('faction-modal-kpis');
  const subEl = document.getElementById('modal-faction-subtitle');
  if (subEl && !onlyMatches) subEl.innerText = 'Analyzing competitive meta matchups and recent games...';

  const mCount = document.getElementById('faction-tab-matches-count');
  if (mCount && !onlyMatches) mCount.innerText = '...';
  const muCount = document.getElementById('faction-tab-matchups-count');
  if (muCount && !onlyMatches) muCount.innerText = '...';

  if (kpiStrip && !onlyMatches) {
    kpiStrip.innerHTML = Array.from({ length: 4 }).map(() => `
      <div class="fmodal-kpi-card">
        <div class="skeleton-box" style="width:95px; height:12px; margin-bottom:8px;"></div>
        <div class="skeleton-box" style="width:130px; height:24px; margin-bottom:6px;"></div>
        <div class="skeleton-box" style="width:110px; height:12px;"></div>
      </div>
    `).join('');
  }

  if (matchBody) {
    let mHtml = '';
    for (let i = 0; i < 5; i++) {
      mHtml += `
        <tr class="skeleton-row">
          <td><div class="skeleton-box" style="width:75px;"></div></td>
          <td><div class="skeleton-box" style="width:140px;"></div></td>
          <td><div class="skeleton-box" style="width:110px;"></div></td>
          <td><div class="skeleton-box" style="width:55px;"></div></td>
          <td><div class="skeleton-box" style="width:120px;"></div></td>
          <td><div class="skeleton-box" style="width:60px;"></div></td>
        </tr>
      `;
    }
    matchBody.innerHTML = mHtml;
  }

  if (matchupsBody && !onlyMatches) {
    let muHtml = '';
    for (let i = 0; i < 5; i++) {
      muHtml += `
        <tr class="skeleton-row">
          <td><div class="skeleton-box" style="width:25px;"></div></td>
          <td><div class="skeleton-box" style="width:140px;"></div></td>
          <td><div class="skeleton-box" style="width:85px;"></div></td>
          <td><div class="skeleton-box" style="width:80px;"></div></td>
          <td><div class="skeleton-box" style="width:95px;"></div></td>
        </tr>
      `;
    }
    matchupsBody.innerHTML = muHtml;
  }
}

function renderFactionModalKpis(data, sys, tf) {
  const kpiStrip = document.getElementById('faction-modal-kpis');
  const tierBadge = document.getElementById('modal-faction-tier-badge');
  if (!kpiStrip) return;

  const stats = data.stats || {};
  const matchups = data.matchups || [];
  const matches = data.matches || [];

  const muTotalGames = matchups.reduce((acc, m) => acc + (Number(m.total_matches) || 0), 0);
  const muWins = matchups.reduce((acc, m) => acc + (Number(m.wins) || 0), 0);
  const muLosses = matchups.reduce((acc, m) => acc + (Number(m.losses) || 0), 0);
  const muDraws = matchups.reduce((acc, m) => acc + (Number(m.draws) || 0), 0);

  const sampleWins = matches.filter(m => m.outcome === 'W').length;
  const sampleLosses = matches.filter(m => m.outcome === 'L').length;
  const sampleDraws = matches.filter(m => m.outcome === 'D').length;

  const totalGames = Number(stats.total_matches || data.total_matches || muTotalGames || matches.length || 0);
  const totalWins = Number(stats.total_wins ?? (muTotalGames > 0 ? muWins : sampleWins));
  const totalLosses = Number(stats.total_losses ?? (muTotalGames > 0 ? muLosses : sampleLosses));
  const totalDraws = Number(stats.total_draws ?? (muTotalGames > 0 ? muDraws : sampleDraws));
  const winRate = stats.win_rate !== undefined && stats.win_rate !== null
    ? Number(stats.win_rate)
    : (totalGames > 0 ? (totalWins * 100.0 / totalGames) : 0);
  const nonMirrorWr = stats.non_mirror_win_rate !== undefined && stats.non_mirror_win_rate !== null
    ? Number(stats.non_mirror_win_rate)
    : winRate;

  // Determine Tier & Color
  let tierCode = stats.tier || (winRate >= 55 ? 'S' : (winRate >= 50 ? 'A' : (winRate >= 45 ? 'B' : 'C')));
  let statusShort = winRate >= 55 ? 'Overperforming' : (winRate >= 50 ? 'Balanced High' : (winRate >= 45 ? 'Balanced Low' : 'Underperforming'));
  let wrColor = '#22c55e';
  let tierBg = 'rgba(34, 197, 94, 0.14)';
  let tierBorder = 'rgba(34, 197, 94, 0.35)';
  if (winRate >= 55.0) {
    wrColor = '#f59e0b';
    tierBg = 'rgba(245, 158, 11, 0.15)';
    tierBorder = 'rgba(245, 158, 11, 0.4)';
  } else if (winRate >= 45.0) {
    wrColor = '#22c55e';
    tierBg = 'rgba(34, 197, 94, 0.14)';
    tierBorder = 'rgba(34, 197, 94, 0.35)';
  } else {
    wrColor = '#ef4444';
    tierBg = 'rgba(239, 68, 68, 0.14)';
    tierBorder = 'rgba(239, 68, 68, 0.35)';
  }

  if (tierBadge) {
    tierBadge.style.display = 'inline-flex';
    tierBadge.style.background = tierBg;
    tierBadge.style.color = wrColor;
    tierBadge.style.border = `1px solid ${tierBorder}`;
    tierBadge.innerText = `${tierCode}-Tier • ${winRate.toFixed(1)}% WR`;
  }

  // Compute Avg Score & Margin
  let avgScore = Number(stats.avg_score || 0);
  let avgOppScore = Number(stats.avg_opp_score || 0);
  let avgMargin = Number(stats.avg_margin || 0);
  if (!avgScore && matches.length > 0) {
    const scored = matches.filter(m => (Number(m.player_score) || 0) > 0 || (Number(m.opponent_score) || 0) > 0);
    if (scored.length > 0) {
      avgScore = scored.reduce((s, m) => s + (Number(m.player_score) || 0), 0) / scored.length;
      avgOppScore = scored.reduce((s, m) => s + (Number(m.opponent_score) || 0), 0) / scored.length;
      avgMargin = avgScore - avgOppScore;
    }
  }

  // Best & Worst Matchups
  const minQualGames = totalGames >= 120 ? 5 : (totalGames >= 30 ? 3 : 1);
  const qualMu = matchups.filter(m => (Number(m.total_matches) || 0) >= minQualGames);
  const poolMu = qualMu.length > 0 ? qualMu : matchups;
  const sortedByWrDesc = poolMu.slice().sort((a, b) => (Number(b.win_rate) || 0) - (Number(a.win_rate) || 0) || (Number(b.total_matches) || 0) - (Number(a.total_matches) || 0));
  const sortedByWrAsc = poolMu.slice().sort((a, b) => (Number(a.win_rate) || 0) - (Number(b.win_rate) || 0) || (Number(b.total_matches) || 0) - (Number(a.total_matches) || 0));

  const bestMu = stats.best_matchup || (sortedByWrDesc[0] ? {
    faction: sortedByWrDesc[0].opponent_faction,
    win_rate: sortedByWrDesc[0].win_rate,
    matches: sortedByWrDesc[0].total_matches,
    wins: sortedByWrDesc[0].wins,
    losses: sortedByWrDesc[0].losses
  } : null);

  const worstMu = stats.worst_matchup || (sortedByWrAsc[0] ? {
    faction: sortedByWrAsc[0].opponent_faction,
    win_rate: sortedByWrAsc[0].win_rate,
    matches: sortedByWrAsc[0].total_matches,
    wins: sortedByWrAsc[0].wins,
    losses: sortedByWrAsc[0].losses
  } : null);

  const wPct = totalGames > 0 ? Math.max(0, Math.min(100, (totalWins / totalGames) * 100)) : 50;
  const dPct = totalGames > 0 ? Math.max(0, Math.min(100 - wPct, (totalDraws / totalGames) * 100)) : 0;
  const lPct = Math.max(0, 100 - wPct - dPct);

  const marginSign = avgMargin > 0 ? '+' : '';
  const marginColor = avgMargin > 0 ? 'var(--win)' : (avgMargin < 0 ? 'var(--loss)' : 'var(--text-secondary)');
  const x0Runs = Number(stats.x0_runs || 0);
  const x1Runs = Number(stats.x1_runs || 0);
  const metaShare = Number(stats.meta_share || 0);

  let card2SubHtml = '';
  if (x0Runs > 0 || x1Runs > 0) {
    card2SubHtml = `🏆 <strong>${x0Runs}</strong> Undefeated (X-0) • <strong>${x1Runs}</strong> Podium (X-1)`;
  } else if (metaShare > 0) {
    card2SubHtml = `📊 <strong>${metaShare.toFixed(1)}%</strong> Meta Share • <strong>${matchups.length}</strong> Factions Faced`;
  } else if (matches.length > 0) {
    const recWr = ((sampleWins / matches.length) * 100).toFixed(1);
    card2SubHtml = `🔥 Recent Sample: <strong>${sampleWins}W-${sampleLosses}L${sampleDraws ? `-${sampleDraws}D` : ''}</strong> (${recWr}%)`;
  } else {
    card2SubHtml = `📊 <strong>${matchups.length}</strong> Opponent Factions Tracked`;
  }

  const safeBestJs = bestMu && bestMu.faction ? escapeHtml(String(bestMu.faction).replace(/'/g, "\\'")) : '';
  const safeWorstJs = worstMu && worstMu.faction ? escapeHtml(String(worstMu.faction).replace(/'/g, "\\'")) : '';

  kpiStrip.innerHTML = `
    <div class="fmodal-kpi-card">
      <div class="fmodal-kpi-label">PERIOD WIN RATE &amp; RECORD</div>
      <div class="fmodal-kpi-main-row">
        <span class="fmodal-kpi-big" style="color:${wrColor};">${winRate.toFixed(1)}%</span>
        <span class="fmodal-kpi-tag" style="background:${tierBg}; color:${wrColor}; border:1px solid ${tierBorder};">${escapeHtml(statusShort)}</span>
      </div>
      <div class="fmodal-wdl-bar" title="${totalWins}W - ${totalLosses}L - ${totalDraws}D">
        <div style="width:${wPct.toFixed(1)}%; background:var(--win);"></div>
        <div style="width:${dPct.toFixed(1)}%; background:var(--draw);"></div>
        <div style="width:${lPct.toFixed(1)}%; background:var(--loss);"></div>
      </div>
      <div class="fmodal-kpi-sub">
        <span style="color:var(--win); font-weight:700;">${totalWins.toLocaleString()}W</span> -
        <span style="color:var(--loss); font-weight:700;">${totalLosses.toLocaleString()}L</span>${totalDraws ? ` - <span style="color:var(--draw); font-weight:700;">${totalDraws.toLocaleString()}D</span>` : ''}
        <span style="color:var(--text-muted);">• ${totalGames.toLocaleString()} games (Non-Mirror ${nonMirrorWr.toFixed(1)}%)</span>
      </div>
    </div>

    <div class="fmodal-kpi-card">
      <div class="fmodal-kpi-label">SCORING &amp; TOURNAMENT OUTPUT</div>
      <div class="fmodal-kpi-main-row">
        ${avgScore > 0 ? `
          <span class="fmodal-kpi-big" style="color:#fff;">${avgScore.toFixed(1)} <span style="font-size:0.82rem; font-weight:600; color:var(--text-secondary);">vs ${avgOppScore.toFixed(1)} VP</span></span>
          <span class="fmodal-kpi-tag" style="background:rgba(15,23,42,0.7); color:${marginColor}; border:1px solid var(--border); font-family:var(--font-mono);">${marginSign}${avgMargin.toFixed(1)} VP</span>
        ` : `
          <span class="fmodal-kpi-big" style="color:#fff;">${totalGames.toLocaleString()} <span style="font-size:0.85rem; font-weight:600; color:var(--text-secondary);">Games</span></span>
        `}
      </div>
      <div class="fmodal-kpi-sub" style="margin-top:0.35rem;">
        ${card2SubHtml}
      </div>
    </div>

    <div class="fmodal-kpi-card ${bestMu ? 'clickable' : ''}" ${bestMu ? `onclick="openFactionModal('${safeBestJs}', '${escapeHtml(tf)}')" title="Inspect ${escapeHtml(bestMu.faction)} Meta Dossier"` : ''}>
      <div class="fmodal-kpi-label">🎯 BEST MATCHUP (FAVORITE PREY)</div>
      ${bestMu && bestMu.faction ? `
        <div class="fmodal-kpi-main-row">
          <span class="fmodal-kpi-fac-name">${escapeHtml(bestMu.faction)}</span>
          <span class="fmodal-kpi-wr" style="color:var(--win);">${Number(bestMu.win_rate || 0).toFixed(1)}%</span>
        </div>
        <div class="fmodal-kpi-sub">
          ${bestMu.wins !== undefined ? `<span style="color:var(--win); font-weight:600;">${bestMu.wins}W</span> - <span style="color:var(--loss); font-weight:600;">${bestMu.losses}L</span> • ` : ''}
          <span>${Number(bestMu.matches || 0)} games played</span>
        </div>
      ` : `<div class="fmodal-kpi-sub" style="margin-top:0.5rem;">Insufficient matchup sample in this window</div>`}
    </div>

    <div class="fmodal-kpi-card ${worstMu ? 'clickable' : ''}" ${worstMu ? `onclick="openFactionModal('${safeWorstJs}', '${escapeHtml(tf)}')" title="Inspect ${escapeHtml(worstMu.faction)} Meta Dossier"` : ''}>
      <div class="fmodal-kpi-label">⚠️ TOUGHEST COUNTER (NEMESIS)</div>
      ${worstMu && worstMu.faction ? `
        <div class="fmodal-kpi-main-row">
          <span class="fmodal-kpi-fac-name">${escapeHtml(worstMu.faction)}</span>
          <span class="fmodal-kpi-wr" style="color:var(--loss);">${Number(worstMu.win_rate || 0).toFixed(1)}%</span>
        </div>
        <div class="fmodal-kpi-sub">
          ${worstMu.wins !== undefined ? `<span style="color:var(--win); font-weight:600;">${worstMu.wins}W</span> - <span style="color:var(--loss); font-weight:600;">${worstMu.losses}L</span> • ` : ''}
          <span>${Number(worstMu.matches || 0)} games played</span>
        </div>
      ` : `<div class="fmodal-kpi-sub" style="margin-top:0.5rem;">Insufficient matchup sample in this window</div>`}
    </div>
  `;
}

function applyFactionModalData(data, sys, tf) {
  const matches = data.matches || [];
  const topPlayers = data.top_players || [];
  const matchups = data.matchups || [];

  currentFactionMatches = matches;
  currentFactionPlayers = topPlayers;
  currentFactionMatchups = matchups;
  currentFactionStats = data.stats || {};

  const tfLabels = { '30d': '1 Month', '3mo': '3 Months', '6mo': '6 Months', '1yr': '1 Year', 'all': 'All Time' };
  const sysLabel = sys === 'aos' ? 'Age of Sigmar' : 'Warhammer 40K';

  const totalGamesInMatchups = matchups.reduce((acc, m) => acc + (Number(m.total_matches) || 0), 0);
  const totalMatchesCount = (data.stats && data.stats.total_matches) || data.total_matches || totalGamesInMatchups || matches.length;

  const subEl = document.getElementById('modal-faction-subtitle');
  if (subEl) {
    subEl.innerText = `${sysLabel} Competitive Meta • ${tfLabels[tf] || '1 Year'} Window • ${Number(totalMatchesCount || 0).toLocaleString()} matches analyzed across ${matchups.length} faction matchups`;
  }

  const mCount = document.getElementById('faction-tab-matches-count');
  if (mCount) mCount.innerText = matches.length > 0 ? matches.length.toLocaleString() : (data._instantMetaOnly ? '...' : '0');
  const pCount = document.getElementById('faction-tab-players-count');
  if (pCount) pCount.innerText = topPlayers.length;
  const muCount = document.getElementById('faction-tab-matchups-count');
  if (muCount) muCount.innerText = matchups.length;

  renderFactionModalKpis(data, sys, tf);
  renderFactionMatchupsRows(matchups);
  if (!data._instantMetaOnly) {
    renderFactionMatchesRows(matches);
  }
}

async function loadFactionModalData(factionName, tf = '1yr') {
  const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
  const facNorm = (factionName || '').trim().toLowerCase();
  const cacheKey = `${facNorm}_${sys}_${tf}`;
  const cachedEntry = factionModalDataCache.get(cacheKey);
  const now = Date.now();
  const isFresh = cachedEntry && !cachedEntry.fromStorage && (now - cachedEntry.timestamp < 120000); // 2 min in-session fresh; storage/older entries render in 0ms + background revalidate

  const reqFaction = factionName;
  const reqTf = tf;
  factionModalAbortController = new AbortController();

  const hasExistingData = (currentFactionMatches && currentFactionMatches.length > 0) ||
                          (currentFactionMatchups && currentFactionMatchups.length > 0);

  if (cachedEntry) {
    applyFactionModalData(cachedEntry.data, sys, tf);
    prefetchRemainingModalTimeframes(factionName, sys, tf);
    if (isFresh) {
      return;
    }
  } else {
    const derived = deriveFactionModalFromCachedSuperset(factionName, sys, tf);
    if (derived && derived.matches && derived.matches.length > 0) {
      applyFactionModalData(derived, sys, tf);
    } else {
      const instantMeta = deriveInstantFactionMetaSnapshot(factionName, sys, tf);
      if (instantMeta) {
        applyFactionModalData(instantMeta, sys, tf);
        renderFactionTableSkeletons(true);
      } else if (!hasExistingData) {
        renderFactionTableSkeletons(false);
      } else {
        const subEl = document.getElementById('modal-faction-subtitle');
        if (subEl) {
          const tfLabels = { '30d': '1 Month', '3mo': '3 Months', '6mo': '6 Months', '1yr': '1 Year', 'all': 'All Time' };
          subEl.innerHTML = `Refreshing ${escapeHtml(tfLabels[tf] || tf)} data... <span style="display:inline-block; width:12px; height:12px; border:2px solid var(--accent); border-right-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite; vertical-align:middle; margin-left:6px;"></span>`;
        }
      }
    }
  }

  try {
    const data = await fetchFactionDetailsShared(factionName, sys, tf);
    if (currentFactionName !== reqFaction || currentFactionTimeframe !== reqTf) return;
    if (data && !data.error && !data.aborted) {
      applyFactionModalData(data, sys, tf);
      prefetchRemainingModalTimeframes(factionName, sys, tf);
    } else if (data && data.error) {
      throw new Error(data.error);
    }
  } catch (err) {
    if (currentFactionName !== reqFaction || currentFactionTimeframe !== reqTf) return;
    console.warn("Notice loading faction modal data:", err);
    if (!cachedEntry && !hasExistingData) {
      const errMsg = err && err.message ? err.message : 'Request timed out';
      const retryHtml = `<tr><td colspan="6" class="empty-state" style="color:var(--loss); text-align:center; padding:2rem;">Data unavailable (${escapeHtml(errMsg)}). <button class="btn btn-secondary btn-sm" style="margin-left:8px;" onclick="loadFactionModalData('${escapeHtml(factionName)}', '${escapeHtml(tf)}')">Retry</button></td></tr>`;
      const matchBody = document.getElementById('faction-matches-body');
      if (matchBody) matchBody.innerHTML = retryHtml;
      const matchupsBody = document.getElementById('faction-matchups-body');
      if (matchupsBody) matchupsBody.innerHTML = retryHtml;
    }
  }
}
window.loadFactionModalData = loadFactionModalData;

let currentFactionActiveTab = 'matchups';
let _factionMatchSearchDebounce = null;
let _factionMatchSearchLastKey = '';

async function openFactionModal(factionName, initialTf = null, initialSubtab = null) {
  const modal = document.getElementById('faction-modal');
  if (!modal) return;
  bringModalToFront(modal);

  if (currentFactionName !== factionName) {
    currentFactionMatches = [];
    currentFactionPlayers = [];
    currentFactionMatchups = [];
  }

  fmodalMatchupVerdictFilter = 'ALL';
  fmodalMatchOutcomeFilter = 'ALL';
  _factionMatchSearchLastKey = '';
  if (_factionMatchSearchDebounce) {
    clearTimeout(_factionMatchSearchDebounce);
    _factionMatchSearchDebounce = null;
  }
  const muSearch = document.getElementById('fmodal-mu-search');
  if (muSearch) muSearch.value = '';
  const mSearch = document.getElementById('fmodal-matches-search');
  if (mSearch) mSearch.value = '';
  ['ALL', 'FAVORED', 'EVEN', 'UNFAVORED'].forEach(k => {
    const btn = document.getElementById(`fmodal-mu-filter-${k.toLowerCase()}`);
    if (btn) btn.classList.toggle('active', k === 'ALL');
  });
  ['ALL', 'W', 'L', 'D'].forEach(k => {
    const btn = document.getElementById(`fmodal-match-filter-${k.toLowerCase()}`);
    if (btn) btn.classList.toggle('active', k === 'ALL');
  });

  const targetTab = (initialSubtab === 'matches' || initialSubtab === 'matchups') ? initialSubtab : 'matchups';
  switchFactionModalTab(targetTab);

  let resolvedTf = initialTf;
  if (!resolvedTf && typeof factionTimeframe !== 'undefined') {
    const mapFromMeta = { '30d': '30d', '60d': '3mo', '90d': '3mo', '180d': '6mo', 'ytd': '6mo', '1yr': '1yr', 'all': 'all' };
    resolvedTf = mapFromMeta[factionTimeframe] || '1yr';
  }
  currentFactionName = factionName || '';
  currentFactionTimeframe = resolvedTf || '1yr';
  updateFactionModalTfButtons();

  const titleEl = document.getElementById('modal-faction-title');
  if (titleEl) titleEl.innerText = factionName || 'Faction Meta';

  await loadFactionModalData(currentFactionName, currentFactionTimeframe);
}

function switchFactionModalTab(tabName) {
  const isMatches = tabName === 'matches';
  currentFactionActiveTab = isMatches ? 'matches' : 'matchups';
  const muTab = document.getElementById('faction-subtab-matchups');
  const mTab = document.getElementById('faction-subtab-matches');
  const muView = document.getElementById('faction-view-matchups');
  const mView = document.getElementById('faction-view-matches');
  if (muTab) {
    muTab.classList.toggle('active', !isMatches);
    muTab.setAttribute('aria-selected', !isMatches ? 'true' : 'false');
  }
  if (mTab) {
    mTab.classList.toggle('active', isMatches);
    mTab.setAttribute('aria-selected', isMatches ? 'true' : 'false');
  }
  if (muView) muView.style.display = isMatches ? 'none' : '';
  if (mView) mView.style.display = isMatches ? '' : 'none';
}
window.switchFactionModalTab = switchFactionModalTab;

function setFactionModalMatchupFilter(verdict) {
  fmodalMatchupVerdictFilter = verdict || 'ALL';
  ['ALL', 'FAVORED', 'EVEN', 'UNFAVORED'].forEach(k => {
    const btn = document.getElementById(`fmodal-mu-filter-${k.toLowerCase()}`);
    if (btn) btn.classList.toggle('active', k === fmodalMatchupVerdictFilter);
  });
  renderFactionMatchupsRows(currentFactionMatchups);
}
window.setFactionModalMatchupFilter = setFactionModalMatchupFilter;

function onFactionModalMatchupControlChange() {
  renderFactionMatchupsRows(currentFactionMatchups);
}
window.onFactionModalMatchupControlChange = onFactionModalMatchupControlChange;

function setFactionModalMatchOutcomeFilter(outcome) {
  fmodalMatchOutcomeFilter = outcome || 'ALL';
  ['ALL', 'W', 'L', 'D'].forEach(k => {
    const btn = document.getElementById(`fmodal-match-filter-${k.toLowerCase()}`);
    if (btn) btn.classList.toggle('active', k === fmodalMatchOutcomeFilter);
  });
  renderFactionMatchesRows(currentFactionMatches);
}
window.setFactionModalMatchOutcomeFilter = setFactionModalMatchOutcomeFilter;

function onFactionModalMatchControlChange() {
  renderFactionMatchesRows(currentFactionMatches);

  const searchInput = document.getElementById('fmodal-matches-search');
  const q = searchInput ? String(searchInput.value || '').trim() : '';
  if (_factionMatchSearchDebounce) {
    clearTimeout(_factionMatchSearchDebounce);
    _factionMatchSearchDebounce = null;
  }
  if (q.length < 2 || !currentFactionName) return;

  const sys = (typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k');
  const tf = currentFactionTimeframe || '1yr';
  const reqFac = currentFactionName;
  const searchKey = `${reqFac.toLowerCase()}_${sys}_${tf}_${q.toLowerCase()}`;
  if (_factionMatchSearchLastKey === searchKey) return;

  _factionMatchSearchDebounce = setTimeout(async () => {
    try {
      const res = await window.api.getFactionDetails(reqFac, 350, sys, tf, { search: q });
      if (currentFactionName !== reqFac || currentFactionTimeframe !== tf) return;
      _factionMatchSearchLastKey = searchKey;
      const remoteMatches = (res && Array.isArray(res.matches)) ? res.matches : [];
      if (remoteMatches.length > 0) {
        const byId = new Map();
        (currentFactionMatches || []).forEach(m => {
          if (m && m.id !== undefined) byId.set(String(m.id), m);
        });
        let added = 0;
        remoteMatches.forEach(m => {
          const mid = m && m.id !== undefined ? String(m.id) : `${m.event_id}_${m.round}_${m.player_id}`;
          if (!byId.has(mid)) {
            byId.set(mid, m);
            added++;
          }
        });
        if (added > 0) {
          currentFactionMatches = Array.from(byId.values()).sort((a, b) => {
            const da = String(a.match_date || '');
            const db = String(b.match_date || '');
            if (da !== db) return db.localeCompare(da);
            return (Number(b.round) || 0) - (Number(a.round) || 0);
          });
          renderFactionMatchesRows(currentFactionMatches);
        }
      }
    } catch (e) {}
  }, 180);
}
window.onFactionModalMatchControlChange = onFactionModalMatchControlChange;

function renderFactionMatchesRows(matches) {
  const tbody = document.getElementById('faction-matches-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const allMatches = Array.isArray(matches) ? matches : [];
  const searchInput = document.getElementById('fmodal-matches-search');
  const q = searchInput ? String(searchInput.value || '').trim().toLowerCase() : '';
  const hasActiveFilter = Boolean(q) || fmodalMatchOutcomeFilter !== 'ALL';

  const filtered = allMatches.filter(m => {
    if (fmodalMatchOutcomeFilter !== 'ALL' && m.outcome !== fmodalMatchOutcomeFilter) return false;
    if (q) {
      const hay = `${m.event_name || ''} ${m.player_name || ''} ${m.opponent_name || ''} ${m.opponent_faction || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const mCount = document.getElementById('faction-tab-matches-count');
  if (mCount) {
    mCount.innerText = (hasActiveFilter ? filtered.length : allMatches.length).toLocaleString();
  }

  const summaryEl = document.getElementById('fmodal-recent-summary-pill');
  if (summaryEl) {
    const targetPool = hasActiveFilter ? filtered : allMatches;
    if (targetPool.length > 0) {
      const w = targetPool.filter(m => m.outcome === 'W').length;
      const l = targetPool.filter(m => m.outcome === 'L').length;
      const d = targetPool.filter(m => m.outcome === 'D').length;
      const wr = ((w / targetPool.length) * 100).toFixed(1);
      const labelPrefix = hasActiveFilter ? `Matching Filter (${targetPool.length})` : `Sample Record (${targetPool.length})`;
      summaryEl.innerHTML = `• ${labelPrefix}: <strong style="color:var(--win);">${w}W</strong>-<strong style="color:var(--loss);">${l}L</strong>${d ? `-${d}D` : ''} (<strong>${wr}%</strong>)`;
    } else {
      summaryEl.innerHTML = '';
    }
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No recent games match the selected filter in this timeframe.</td></tr>';
    return;
  }

  filtered.forEach(m => {
    const tr = document.createElement('tr');
    const isWin = m.outcome === 'W';
    const isLoss = m.outcome === 'L';
    const outcomeBadge = isWin 
      ? '<span class="badge badge-win">Victory</span>' 
      : (isLoss ? '<span class="badge badge-loss">Defeat</span>' : '<span class="badge badge-draw">Draw</span>');
    const pScore = m.player_score !== null && m.player_score !== undefined ? Number(m.player_score) : null;
    const oScore = m.opponent_score !== null && m.opponent_score !== undefined ? Number(m.opponent_score) : null;
    const scoreStr = `${pScore !== null ? pScore : '-'} - ${oScore !== null ? oScore : '-'}`;
    const diff = (pScore !== null && oScore !== null && (pScore > 0 || oScore > 0)) ? (pScore - oScore) : null;
    const diffHtml = diff !== null
      ? `<span style="font-size:0.7rem; margin-left:4px; color:${diff > 0 ? 'var(--win)' : (diff < 0 ? 'var(--loss)' : 'var(--text-muted)')};">(${diff > 0 ? '+' : ''}${diff})</span>`
      : '';
    const dateStr = (m.match_date ? (typeof m.match_date === 'string' ? m.match_date.substring(0, 10) : new Date(m.match_date).toISOString().substring(0, 10)) : '');
    const evName = m.event_name || 'Tournament';
    const pName = m.player_name || 'Player';
    const oppName = m.opponent_name || 'Opponent';
    const oppFac = m.opponent_faction || 'Various';

    tr.innerHTML = `
      <td style="font-family:var(--font-mono); font-size:0.78rem; color:var(--text-secondary); white-space:nowrap;">${dateStr || '#'}</td>
      <td style="min-width:0;">
        <div class="fmodal-cell-val" style="display:flex; align-items:center; gap:0.35rem; min-width:0;">
          <span class="player-link" style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(evName)}" onclick="event.stopPropagation(); openEventModal('${m.event_id}')">${escapeHtml(evName)}</span>
          <span style="font-size:0.72rem; color:var(--text-muted); flex-shrink:0;">R${m.round || 1}</span>
        </div>
      </td>
      <td style="min-width:0;">
        <span class="player-link fmodal-cell-val" style="font-weight:600; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(pName)}" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(m.player_id || '')}', '${escapeHtml(String(pName).replace(/'/g, "\\'"))}')">${escapeHtml(pName)}</span>
      </td>
      <td style="font-family:var(--font-mono); font-weight:700; color:#fff; white-space:nowrap;">
        <span class="fmodal-cell-val">${scoreStr}${diffHtml}</span>
      </td>
      <td style="min-width:0;">
        <div class="fmodal-cell-val" style="min-width:0;">
          <div style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <span class="player-link" title="${escapeHtml(oppName)}" onclick="event.stopPropagation(); openPlayerModal('${escapeHtml(m.opponent_id || '')}', '${escapeHtml(String(oppName).replace(/'/g, "\\'"))}')">${escapeHtml(oppName)}</span>
          </div>
          <div style="font-size:0.72rem; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(oppFac)}">${escapeHtml(oppFac)}</div>
        </div>
      </td>
      <td style="white-space:nowrap;"><span class="fmodal-cell-val">${outcomeBadge}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderFactionPlayersRows(players) {
  const tbody = document.getElementById('faction-players-body');
  if (!tbody) return;
  tbody.innerHTML = '';
}

function renderFactionMatchupsRows(matchups) {
  const tbody = document.getElementById('faction-matchups-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const allMatchups = Array.isArray(matchups) ? matchups : [];
  const favCount = allMatchups.filter(m => Number(m.win_rate || 0) >= 55.0).length;
  const evenCount = allMatchups.filter(m => Number(m.win_rate || 0) >= 45.0 && Number(m.win_rate || 0) < 55.0).length;
  const unfavCount = allMatchups.filter(m => Number(m.win_rate || 0) < 45.0).length;

  const spreadEl = document.getElementById('fmodal-matchup-spread-summary');
  if (spreadEl) {
    if (allMatchups.length > 0) {
      spreadEl.innerHTML = `• <span style="color:var(--win); font-weight:600;">${favCount} Favored</span> • <span style="color:var(--accent); font-weight:600;">${evenCount} Even</span> • <span style="color:var(--loss); font-weight:600;">${unfavCount} Tough</span>`;
    } else {
      spreadEl.innerHTML = '';
    }
  }

  const searchEl = document.getElementById('fmodal-mu-search');
  const q = searchEl ? String(searchEl.value || '').trim().toLowerCase() : '';
  const sortEl = document.getElementById('fmodal-mu-sort');
  const sortMode = sortEl ? sortEl.value : 'games_desc';

  let list = allMatchups.filter(m => {
    const wr = Number(m.win_rate || 0);
    if (fmodalMatchupVerdictFilter === 'FAVORED' && wr < 55.0) return false;
    if (fmodalMatchupVerdictFilter === 'EVEN' && (wr < 45.0 || wr >= 55.0)) return false;
    if (fmodalMatchupVerdictFilter === 'UNFAVORED' && wr >= 45.0) return false;
    if (q && !String(m.opponent_faction || '').toLowerCase().includes(q)) return false;
    return true;
  });

  list = list.slice().sort((a, b) => {
    const wrA = Number(a.win_rate || 0);
    const wrB = Number(b.win_rate || 0);
    const gA = Number(a.total_matches || 0);
    const gB = Number(b.total_matches || 0);
    if (sortMode === 'wr_desc') return (wrB - wrA) || (gB - gA);
    if (sortMode === 'wr_asc') return (wrA - wrB) || (gB - gA);
    return (gB - gA) || (wrB - wrA);
  });

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No matchup pairings match the selected filter.</td></tr>';
    return;
  }

  list.forEach((m, idx) => {
    const tr = document.createElement('tr');
    const wr = Number(m.win_rate || 0);
    const games = Number(m.total_matches || 0);
    const margin = Number(m.avg_margin || 0);
    const wrColor = wr >= 55.0 ? 'var(--win)' : (wr >= 45.0 ? 'var(--accent)' : 'var(--loss)');
    const barWidth = Math.max(4, Math.min(100, wr));

    let verdictLabel = '⚖️ Even';
    let verdictStyle = 'background:rgba(56, 189, 248, 0.12); color:var(--accent); border:1px solid rgba(56, 189, 248, 0.3);';
    if (wr >= 60.0) {
      verdictLabel = '🟢 Favored+';
      verdictStyle = 'background:rgba(34, 197, 94, 0.16); color:var(--win); border:1px solid rgba(34, 197, 94, 0.38);';
    } else if (wr >= 55.0) {
      verdictLabel = '🟢 Favored';
      verdictStyle = 'background:rgba(34, 197, 94, 0.12); color:var(--win); border:1px solid rgba(34, 197, 94, 0.28);';
    } else if (wr < 40.0) {
      verdictLabel = '🔴 Counter';
      verdictStyle = 'background:rgba(239, 68, 68, 0.16); color:var(--loss); border:1px solid rgba(239, 68, 68, 0.38);';
    } else if (wr < 45.0) {
      verdictLabel = '🟠 Unfavored';
      verdictStyle = 'background:rgba(239, 68, 68, 0.12); color:var(--loss); border:1px solid rgba(239, 68, 68, 0.28);';
    }

    const oppName = m.opponent_faction || 'Unknown';
    const safeOppJs = escapeHtml(String(oppName).replace(/'/g, "\\'"));
    const facColor = typeof getFactionColor === 'function' ? getFactionColor(oppName) : 'var(--accent)';
    const marginBadge = margin !== 0
      ? `<span style="font-family:var(--font-mono); font-size:0.72rem; color:${margin > 0 ? 'var(--win)' : 'var(--loss)'}; white-space:nowrap;">${margin > 0 ? '+' : ''}${margin.toFixed(1)} VP</span>`
      : '';

    tr.innerHTML = `
      <td class="rank-cell">#${idx + 1}</td>
      <td style="font-weight:700; color:#fff;">
        <div class="fmodal-cell-val" style="display:flex; align-items:center; gap:0.45rem;">
          <span style="width:8px; height:8px; border-radius:50%; background:${facColor}; flex-shrink:0;"></span>
          <span class="player-link" onclick="event.stopPropagation(); openFactionModal('${safeOppJs}', '${escapeHtml(currentFactionTimeframe || '1yr')}')" title="Inspect ${escapeHtml(oppName)}">${escapeHtml(oppName)}</span>
        </div>
      </td>
      <td>
        <div class="fmodal-cell-val" style="display:flex; align-items:center; gap:0.55rem;">
          <span style="font-family:var(--font-mono); font-weight:800; font-size:0.95rem; color:${wrColor}; min-width:48px;">${wr.toFixed(1)}%</span>
          <div class="fmodal-wr-bar-track" title="Win Rate: ${wr.toFixed(1)}% (50% midline)">
            <div class="fmodal-wr-bar-fill" style="width:${barWidth}%; background:${wrColor};"></div>
            <div class="fmodal-wr-bar-midline"></div>
          </div>
        </div>
      </td>
      <td style="font-family:var(--font-mono); font-size:0.84rem; white-space:nowrap;">
        <span class="fmodal-cell-val">
          <span style="color:var(--win); font-weight:600;">${m.wins || 0}W</span> - 
          <span style="color:var(--loss); font-weight:600;">${m.losses || 0}L</span>
          ${m.draws ? ` - <span style="color:var(--draw); font-weight:600;">${m.draws}D</span>` : ''}
        </span>
      </td>
      <td>
        <div class="fmodal-cell-val" style="display:flex; align-items:center; gap:0.35rem; flex-wrap:nowrap; white-space:nowrap;">
          <span class="badge" style="background:var(--bg-primary); border:1px solid var(--border); font-family:var(--font-mono); font-size:0.72rem;" title="${games} Games Played">${games}G</span>
          <span class="badge" style="${verdictStyle} font-size:0.7rem; font-weight:700;">${verdictLabel}</span>
          ${marginBadge}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

let activeScorecardMatchId = null;

function copyCurrentScorecardLink() {
  if (!activeScorecardMatchId) return;
  const url = `${window.location.origin}/scorecard/${encodeURIComponent(activeScorecardMatchId)}`;
  navigator.clipboard.writeText(url);
  alert(`📋 Scorecard Link copied to clipboard:\n${url}`);
}

const MODAL_CARD_NAMES = {
  'cleanse': 'Cleanse',
  'bring-it-down': 'Bring It Down',
  'no-prisoners': 'No Prisoners',
  'assassination': 'Assassination',
  'outflank': 'Outflank',
  'plunder': 'Plunder',
  'centre-ground': 'Centre Ground',
  'forward-position': 'Forward Position',
  'overwhelming-force': 'Overwhelming Force',
  'a-tempting-target': 'A Tempting Target',
  'a-grievous-blow': 'A Grievous Blow',
  'display-of-might': 'Display of Might',
  'sabotage': 'Sabotage',
  'recover-assets': 'Recover Assets',
  'secure-no-mans-land': "Secure No Man's Land",
  'secure-no-man-s-land': "Secure No Man's Land",
  'defend-stronghold': 'Defend Stronghold',
  'area-denial': 'Area Denial',
  'behind-enemy-lines': 'Behind Enemy Lines',
  'storm-hostile-objective': 'Storm Hostile Objective',
  'extend-battle-lines': 'Extend Battle Lines',
  'investigate-signals': 'Investigate Signals',
  'engage-on-all-fronts': 'Engage on All Fronts',
  'marked-for-death': 'Marked for Death',
  'unshakable-will': 'Unshakable Will',
  'cull-the-horde': 'Cull the Horde',
  'deploy-teleport-homers': 'Deploy Teleport Homers',
  'capture-enemy-outpost': 'Capture Enemy Outpost',
  'beacon': 'Beacon',
  'burden-of-trust': 'Burden of Trust'
};

function formatModalCardName(card) {
  if (!card) return 'Secondary Mission';
  if (typeof card === 'string') return MODAL_CARD_NAMES[card] || card;
  const cId = String(card.cardId || card.id || '').toLowerCase();
  if (MODAL_CARD_NAMES[cId]) return MODAL_CARD_NAMES[cId];
  if (card.name) return card.name;
  if (card.title) return card.title;
  return cId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Secondary Mission';
}

function formatModalSecondaryStatusBadge(s, roundNum) {
  if (!s) return '';
  const sc = Number(s.score) || 0;
  const st = String(s.status || '').toLowerCase();
  if (sc > 0) {
    if (s.drawnRound && Number(s.drawnRound) < Number(roundNum) && !s.recurring) {
      return ` <span style="font-size:0.63rem; font-weight:600; color:#94a3b8; background:rgba(148,163,184,0.12); border:1px solid rgba(148,163,184,0.25); padding:1px 5px; border-radius:4px; margin-left:5px;">Drawn R${s.drawnRound}</span>`;
    }
    return '';
  }
  if (st === 'discarded') {
    return ` <span style="font-size:0.63rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:#f87171; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.28); padding:1px 5px; border-radius:4px; margin-left:5px;">Discarded</span>`;
  }
  if (st === 'held') {
    return ` <span style="font-size:0.63rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:#fbbf24; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.28); padding:1px 5px; border-radius:4px; margin-left:5px;">Held</span>`;
  }
  return ` <span style="font-size:0.63rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:#94a3b8; background:rgba(148,163,184,0.12); border:1px solid rgba(148,163,184,0.25); padding:1px 5px; border-radius:4px; margin-left:5px;">0 VP</span>`;
}

function getModalPlayerRoundSecondaries(pObj, rNum) {
  if (!pObj) return [];
  const res = [];
  const seenKeys = new Set();

  function addSecItem(item) {
    if (!item || !item.name) return;
    const key = String(item.cardId || item.name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    res.push(item);
  }

  const r = Array.isArray(pObj.rounds)
    ? (pObj.rounds.find(x => (x && (x.round === rNum || x.battleRound === rNum))) || pObj.rounds[rNum - 1])
    : null;

  if (r && Array.isArray(r.secondaries) && r.secondaries.length > 0) {
    r.secondaries.forEach(s => {
      if (typeof s === 'string') {
        const sc = Number(r.secondaryScore) || 0;
        addSecItem({
          name: formatModalCardName(s),
          cardId: s,
          score: sc,
          status: sc > 0 ? 'scored' : 'unscored'
        });
      } else if (s && typeof s === 'object') {
        const sc = Number(s.score ?? s.points) || 0;
        const rawSt = String(s.status || '').toLowerCase();
        const st = sc > 0
          ? 'scored'
          : (rawSt === 'discarded' || s.wasDiscardedStartOfRound
              ? 'discarded'
              : (rawSt === 'held' ? 'held' : 'unscored'));
        addSecItem({
          name: formatModalCardName(s),
          cardId: s.cardId || s.id,
          score: sc,
          status: st,
          drawnRound: s.drawnRound || (s.drawnInRound !== undefined && s.drawnInRound !== null ? Number(s.drawnInRound) + 1 : null),
          scoredRound: s.scoredRound || null,
          discardedRound: s.discardedRound || (s.discardedInRound !== undefined && s.discardedInRound !== null ? Number(s.discardedInRound) + 1 : null),
          recurring: Boolean(s.recurring)
        });
      }
    });
  }

  const hand = pObj.hand || [];
  if (Array.isArray(hand)) {
    hand.forEach(card => {
      if (!card) return;
      let score = 0;
      let isForThisRound = false;
      let status = String(card.status || '').toLowerCase();

      if (card.recurring) {
        const rScores = card.roundScores || {};
        const rScore = rScores[rNum] !== undefined ? rScores[rNum] : rScores[String(rNum)];
        if (rScore !== undefined && rScore !== null) {
          score = typeof rScore === 'object' ? (Number(rScore.points ?? rScore.score) || 0) : (Number(rScore) || 0);
          isForThisRound = true;
          status = score > 0 ? 'scored' : 'unscored';
        } else if (rNum === 1 && Object.keys(rScores).length === 0 && (Number(card.points) || 0) === 0) {
          score = 0;
          isForThisRound = true;
          status = 'unscored';
        }
      } else {
        const scoredR = Number(card.scoredRound) || 0;
        const drawnR = Number(card.drawnRound) || (card.drawnInRound !== undefined && card.drawnInRound !== null ? Number(card.drawnInRound) + 1 : 0);
        const discR = Number(card.discardedRound) || (card.discardedInRound !== undefined && card.discardedInRound !== null ? Number(card.discardedInRound) + 1 : 0);

        if (scoredR === rNum) {
          score = Number(card.points ?? card.score) || 0;
          isForThisRound = true;
          status = score > 0 ? 'scored' : (status === 'discarded' ? 'discarded' : 'unscored');
        } else if (scoredR > rNum && drawnR > 0 && drawnR <= rNum) {
          score = 0;
          isForThisRound = true;
          status = 'held';
        } else if (scoredR === 0) {
          const startR = drawnR || discR || 0;
          const endR = (discR >= startR && discR > 0) ? discR : startR;
          if (startR > 0 && rNum >= startR && rNum <= endR) {
            score = 0;
            isForThisRound = true;
            if (rNum < endR) {
              status = 'held';
            } else {
              status = (status === 'discarded' || discR > 0 || card.wasDiscardedStartOfRound)
                ? 'discarded'
                : (status === 'held' ? 'held' : 'unscored');
            }
          }
        }
      }

      if (isForThisRound) {
        addSecItem({
          name: formatModalCardName(card),
          cardId: card.cardId || card.id,
          score: score,
          status: status || (score > 0 ? 'scored' : 'unscored'),
          drawnRound: card.drawnRound || (card.drawnInRound !== undefined && card.drawnInRound !== null ? Number(card.drawnInRound) + 1 : null),
          scoredRound: card.scoredRound || null,
          discardedRound: card.discardedRound || (card.discardedInRound !== undefined && card.discardedInRound !== null ? Number(card.discardedInRound) + 1 : null),
          recurring: Boolean(card.recurring)
        });
      }
    });
  }

  if (res.length === 0 && r && Number(r.secondaryScore) > 0) {
    res.push({
      name: 'Tactical / Fixed Secondaries',
      score: Number(r.secondaryScore),
      status: 'scored'
    });
  }

  return res;
}

function toggleModalPlayerSecondaries(rowClass) {
  const rows = document.querySelectorAll(`#modal-scorecard-matrix-body tr.${rowClass}`);
  if (!rows.length) return;
  const anyVisible = Array.from(rows).some(r => r.style.display !== 'none');
  rows.forEach(r => {
    r.style.display = anyVisible ? 'none' : 'table-row';
  });
}

function openJourneyScorecardModal(matchId, eventId, eventName, roundNum, tableNum, matchDate, p1Id, p1Name, p1Fac, p1Score, p2Id, p2Name, p2Fac, p2Score) {
  const fallbackMatchMeta = {
    event_id: eventId || '',
    event_name: eventName || 'Tournament Match',
    round: Number(roundNum || 1),
    table_number: tableNum ? Number(tableNum) : null,
    match_date: matchDate || '',
    player1_id: p1Id || '',
    player1_name: p1Name || 'Player 1',
    player1_faction: p1Fac || 'Warhammer 40k',
    player1_score: (p1Score !== '' && p1Score !== null && p1Score !== undefined && !isNaN(Number(p1Score))) ? Number(p1Score) : null,
    player2_id: p2Id || '',
    player2_name: p2Name || 'Player 2',
    player2_faction: p2Fac || 'Warhammer 40k',
    player2_score: (p2Score !== '' && p2Score !== null && p2Score !== undefined && !isNaN(Number(p2Score))) ? Number(p2Score) : null,
  };
  const resolvedMatchId = matchId || (eventId ? `BCP-${eventId}-R${roundNum || 1}-T${tableNum || 1}` : `MATCH-R${roundNum || 1}`);
  openScorecardModal(resolvedMatchId, fallbackMatchMeta);
}
window.openJourneyScorecardModal = openJourneyScorecardModal;

async function openScorecardModal(matchId) {
  const fallbackMatchMeta = arguments.length > 1 ? arguments[1] : null;
  if (!matchId) return;
  activeScorecardMatchId = matchId;

  const modal = document.getElementById('scorecard-modal');
  if (!modal) {
    window.location.href = `/scorecard/${encodeURIComponent(matchId)}`;
    return;
  }
  bringModalToFront(modal);

  const titleEl = document.getElementById('modal-scorecard-title');
  const subEl = document.getElementById('modal-scorecard-subtitle');
  const badgesEl = document.getElementById('msc-status-badges');
  const winnerBannerEl = document.getElementById('msc-winner-banner');
  const tbody = document.getElementById('modal-scorecard-matrix-body');
  const matchIdEl = document.getElementById('msc-match-id');
  const fullPageLink = document.getElementById('msc-full-page-link');
  const liveLink = document.getElementById('msc-live-link');
  const p1NameEl = document.getElementById('msc-p1-name');
  const p2NameEl = document.getElementById('msc-p2-name');
  const p1FacEl = document.getElementById('msc-p1-faction');
  const p2FacEl = document.getElementById('msc-p2-faction');
  const p1DetEl = document.getElementById('msc-p1-det');
  const p2DetEl = document.getElementById('msc-p2-det');
  const p1SubEl = document.getElementById('msc-p1-sub-breakdown');
  const p2SubEl = document.getElementById('msc-p2-sub-breakdown');
  const p1ScoreEl = document.getElementById('msc-p1-score');
  const p2ScoreEl = document.getElementById('msc-p2-score');

  if (matchIdEl) matchIdEl.innerText = matchId;
  if (fullPageLink) fullPageLink.href = `/scorecard/${encodeURIComponent(matchId)}`;
  if (liveLink) liveLink.href = `/11th/tracker/play?match_id=${encodeURIComponent(matchId)}`;
  if (badgesEl) badgesEl.innerHTML = '';
  if (winnerBannerEl) {
    winnerBannerEl.style.display = 'none';
    winnerBannerEl.innerHTML = '';
  }
  if (p1SubEl) { p1SubEl.innerHTML = ''; p1SubEl.style.display = 'none'; }
  if (p2SubEl) { p2SubEl.innerHTML = ''; p2SubEl.style.display = 'none'; }
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><div class="spinner"></div><div style="margin-top:0.5rem;">Fetching verified battle records...</div></td></tr>';

  const bcpMatch = String(matchId).match(/^(?:BCP|ES)-(.+)-R(\d+)-T(\d+)$/i);
  const parsedEventId = bcpMatch ? bcpMatch[1] : (fallbackMatchMeta && fallbackMatchMeta.event_id ? String(fallbackMatchMeta.event_id) : null);
  const parsedRound = bcpMatch ? parseInt(bcpMatch[2], 10) : (fallbackMatchMeta && fallbackMatchMeta.round ? Number(fallbackMatchMeta.round) : null);
  const parsedTable = bcpMatch ? parseInt(bcpMatch[3], 10) : (fallbackMatchMeta && fallbackMatchMeta.table_number ? Number(fallbackMatchMeta.table_number) : null);

  let evMatch = null;
  let evP1 = null;
  let evP2 = null;
  const cachedModalEntry = (parsedEventId && typeof window.getEventModalCache === 'function')
    ? window.getEventModalCache(parsedEventId)
    : null;
  const rawEvObj = (typeof currentEventData === 'object' && currentEventData)
    ? currentEventData
    : ((typeof window.currentEventData === 'object' && window.currentEventData)
      ? window.currentEventData
      : (cachedModalEntry && cachedModalEntry.ev ? cachedModalEntry.ev : null));
  const isSameCachedEvent = Boolean(
    !parsedEventId ||
    (rawEvObj && String(rawEvObj.event_id || rawEvObj.id || '').trim().toLowerCase() === String(parsedEventId).trim().toLowerCase())
  );
  const evObj = isSameCachedEvent ? rawEvObj : (cachedModalEntry && cachedModalEntry.ev ? cachedModalEntry.ev : null);
  const evMatches = (evObj && Array.isArray(evObj.matches) && evObj.matches.length > 0)
    ? evObj.matches
    : (isSameCachedEvent
      ? ((typeof eventMatchesCache !== 'undefined' && Array.isArray(eventMatchesCache) && eventMatchesCache.length > 0)
        ? eventMatchesCache
        : (Array.isArray(window.eventMatchesCache) ? window.eventMatchesCache : []))
      : []);
  const evPlayers = (evObj && Array.isArray(evObj.players) && evObj.players.length > 0)
    ? evObj.players
    : (isSameCachedEvent
      ? ((typeof eventPlayersCache !== 'undefined' && Array.isArray(eventPlayersCache) && eventPlayersCache.length > 0)
        ? eventPlayersCache
        : (Array.isArray(window.eventPlayersCache) ? window.eventPlayersCache : []))
      : []);

  if (parsedRound !== null && parsedTable !== null && evMatches.length > 0) {
    evMatch = evMatches.find(m => Number(m.round || 1) === parsedRound && Number(m.table_number || m.table || 1) === parsedTable) || null;
  } else if (evMatches.length > 0) {
    evMatch = evMatches.find(m => String(m.tracker_match_id || '') === String(matchId)) || null;
  }
  if (!evMatch && fallbackMatchMeta && typeof fallbackMatchMeta === 'object') {
    evMatch = fallbackMatchMeta;
  }
  if (evMatch && evPlayers.length > 0) {
    const p1Id = String(evMatch.player1_id || '').trim().toLowerCase();
    const p2Id = String(evMatch.player2_id || '').trim().toLowerCase();
    const p1Nm = String(evMatch.player1_name || '').trim().toLowerCase();
    const p2Nm = String(evMatch.player2_name || '').trim().toLowerCase();
    evP1 = evPlayers.find(p => {
      const pid = String(p.player_id || p.id || '').trim().toLowerCase();
      const nm = String(p.full_name || p.name || '').trim().toLowerCase();
      return (p1Id && pid === p1Id) || (p1Nm && nm === p1Nm);
    }) || null;
    evP2 = evPlayers.find(p => {
      const pid = String(p.player_id || p.id || '').trim().toLowerCase();
      const nm = String(p.full_name || p.name || '').trim().toLowerCase();
      return (p2Id && pid === p2Id) || (p2Nm && nm === p2Nm);
    }) || null;
  }

  // Immediately populate the top header, P1 vs P2 strip, AND initial BCP matrix rows if we already know the clicked match,
  // or clear to loading placeholders so stale player names from a previous match never flash.
  if (evMatch) {
    const initRound = evMatch.round || parsedRound || 1;
    const initTable = evMatch.table_number || evMatch.table || parsedTable || null;
    const initEventLabel = evMatch.event_name || (isSameCachedEvent && evObj && evObj.name) || parsedEventId || null;
    const initDate = evMatch.match_date || (isSameCachedEvent && evObj && evObj.event_date) || Date.now();
    const initP1Name = evMatch.player1_name || 'Player 1';
    const initP2Name = evMatch.player2_name || 'Player 2';
    const initP1Fac = evMatch.player1_faction || evP1?.faction || 'Warhammer 40k';
    const initP2Fac = evMatch.player2_faction || evP2?.faction || 'Warhammer 40k';
    const initP1Det = evMatch.player1_detachment || evP1?.detachment || '';
    const initP2Det = evMatch.player2_detachment || evP2?.detachment || '';
    if (titleEl) {
      titleEl.innerHTML = `🏆 ${initEventLabel ? escapeHtml(initEventLabel) + ' • ' : ''}R${initRound}${initTable ? ' • T' + initTable : ''}`;
    }
    if (subEl) {
      subEl.innerText = `${new Date(initDate).toLocaleDateString()}`;
    }
    if (p1NameEl) p1NameEl.innerText = evMatch.player1_name || 'Player 1';
    if (p2NameEl) p2NameEl.innerText = evMatch.player2_name || 'Player 2';
    if (p1FacEl) p1FacEl.innerText = initP1Fac;
    if (p2FacEl) p2FacEl.innerText = initP2Fac;
    if (p1DetEl) p1DetEl.innerText = initP1Det;
    if (p2DetEl) p2DetEl.innerText = initP2Det;
    const hasInitScore = evMatch.player1_score !== null && evMatch.player1_score !== undefined && evMatch.player2_score !== null && evMatch.player2_score !== undefined;
    if (p1ScoreEl) p1ScoreEl.innerText = hasInitScore ? evMatch.player1_score : '-';
    if (p2ScoreEl) p2ScoreEl.innerText = hasInitScore ? evMatch.player2_score : '-';
    if (hasInitScore) {
      const s1 = Number(evMatch.player1_score || 0);
      const s2 = Number(evMatch.player2_score || 0);
      if (s1 > s2 && p1NameEl) p1NameEl.innerText = `🏆 ${initP1Name}`;
      else if (s2 > s1 && p2NameEl) p2NameEl.innerText = `🏆 ${initP2Name}`;
    }
    if (tbody) {
      const isInitAos = Boolean(String(matchId || '').startsWith('AOS-') || window.currentGameSystem === 'aos');
      const initMaxTot = isInitAos ? 50 : 100;
      const p1WonInit = hasInitScore && Number(evMatch.player1_score) > Number(evMatch.player2_score);
      const p2WonInit = hasInitScore && Number(evMatch.player2_score) > Number(evMatch.player1_score);
      const p1BadgeInit = !hasInitScore
        ? '<span class="badge badge-draw" style="margin-right:6px;">PENDING</span>'
        : (p1WonInit ? '<span class="badge badge-win" style="margin-right:6px;">VICTORY</span>' : (p2WonInit ? '<span class="badge badge-loss" style="margin-right:6px;">DEFEAT</span>' : '<span class="badge badge-draw" style="margin-right:6px;">DRAW</span>'));
      const p2BadgeInit = !hasInitScore
        ? '<span class="badge badge-draw" style="margin-right:6px;">PENDING</span>'
        : (p2WonInit ? '<span class="badge badge-win" style="margin-right:6px;">VICTORY</span>' : (p1WonInit ? '<span class="badge badge-loss" style="margin-right:6px;">DEFEAT</span>' : '<span class="badge badge-draw" style="margin-right:6px;">DRAW</span>'));
      const initStatusDesc = hasInitScore ? 'Official BCP Final Battle Points' : 'Official BCP Match Pairing (Awaiting Final Score)';
      const p1TotInit = hasInitScore ? `${escapeHtml(String(evMatch.player1_score))} / ${initMaxTot}` : `- / ${initMaxTot}`;
      const p2TotInit = hasInitScore ? `${escapeHtml(String(evMatch.player2_score))} / ${initMaxTot}` : `- / ${initMaxTot}`;
      tbody.innerHTML = `
        <tr>
          <td style="color:#38bdf8; font-weight:800; text-align:left; white-space:normal;">
            <div>🟦 ${escapeHtml(initP1Name)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted); font-weight:600; margin-top:2px;">${escapeHtml(initP1Fac)}${initP1Det ? ' • ' + escapeHtml(initP1Det) : ''}</div>
          </td>
          <td colspan="5" style="text-align:center; color:var(--text-secondary); font-size:0.78rem; white-space:normal;">
            ${p1BadgeInit}
            ${initStatusDesc}
          </td>
          <td style="font-family:var(--font-mono); font-weight:900; font-size:1.02rem; color:${p1WonInit ? '#4ade80' : '#f8fafc'}; text-align:center; white-space:nowrap;">${p1TotInit}</td>
        </tr>
        <tr>
          <td style="color:#f43f5e; font-weight:800; text-align:left; white-space:normal;">
            <div>🟥 ${escapeHtml(initP2Name)}</div>
            <div style="font-size:0.72rem; color:var(--text-muted); font-weight:600; margin-top:2px;">${escapeHtml(initP2Fac)}${initP2Det ? ' • ' + escapeHtml(initP2Det) : ''}</div>
          </td>
          <td colspan="5" style="text-align:center; color:var(--text-secondary); font-size:0.78rem; white-space:normal;">
            ${p2BadgeInit}
            ${initStatusDesc}
          </td>
          <td style="font-family:var(--font-mono); font-weight:900; font-size:1.02rem; color:${p2WonInit ? '#4ade80' : '#f8fafc'}; text-align:center; white-space:nowrap;">${p2TotInit}</td>
        </tr>
      `;
    }
  } else {
    if (titleEl) titleEl.innerHTML = `🏆 Match Scorecard`;
    if (subEl) subEl.innerText = `Loading match details...`;
    if (p1NameEl) p1NameEl.innerText = 'Loading...';
    if (p2NameEl) p2NameEl.innerText = 'Loading...';
    if (p1FacEl) p1FacEl.innerText = '-';
    if (p2FacEl) p2FacEl.innerText = '-';
    if (p1DetEl) p1DetEl.innerText = '';
    if (p2DetEl) p2DetEl.innerText = '';
    if (p1ScoreEl) p1ScoreEl.innerText = '-';
    if (p2ScoreEl) p2ScoreEl.innerText = '-';
  }

  try {
    let data = {};
    try {
      data = await window.api.getScorecard(matchId);
    } catch (apiErr) {
      if (!evMatch) throw apiErr;
      data = {};
    }
    if (activeScorecardMatchId !== matchId) return;

    const eventEnded = (typeof isEventEnded === 'function' && evObj) ? Boolean(isEventEnded(evObj)) : false;

    const isTrackerScorecard = Boolean(
      data &&
      ((data.source === 'tracker_games' && data.is_finished === true) || (!eventEnded && data.source === 'firestore')) &&
      (data.game_record || data.state)
    );

    const bcpMatchRec = evMatch || data.bcp_match || null;
    if (!isTrackerScorecard && !bcpMatchRec) {
      throw new Error('Scorecard not found for this match.');
    }

    const rec = isTrackerScorecard ? (data.game_record || {}) : {};
    const st = isTrackerScorecard ? (data.state || {}) : {};
    const game = isTrackerScorecard ? (st.game || rec.state_json?.game || {}) : {};

    const resolvedMatchId = String(
      (isTrackerScorecard && (data.match_id || rec.match_id || st.match_id)) || matchId
    ).trim();
    activeScorecardMatchId = resolvedMatchId;
    if (matchIdEl) matchIdEl.innerText = resolvedMatchId;
    if (fullPageLink) fullPageLink.href = `/scorecard/${encodeURIComponent(resolvedMatchId)}`;

    const p1Name = (isTrackerScorecard && (game.p1Name || rec.p1_name || st.p1?.name)) || bcpMatchRec?.player1_name || 'Player 1';
    const p2Name = (isTrackerScorecard && (game.p2Name || rec.p2_name || st.p2?.name)) || bcpMatchRec?.player2_name || 'Player 2';
    const p1Fac = (isTrackerScorecard && (game.p1Faction || rec.p1_faction || st.p1?.faction)) || bcpMatchRec?.player1_faction || evP1?.faction || 'Warhammer 40k';
    const p2Fac = (isTrackerScorecard && (game.p2Faction || rec.p2_faction || st.p2?.faction)) || bcpMatchRec?.player2_faction || evP2?.faction || 'Warhammer 40k';
    const p1Det = (isTrackerScorecard && ((Array.isArray(game.p1Detachments) && game.p1Detachments[0]) || rec.p1_detachment)) || bcpMatchRec?.player1_detachment || evP1?.detachment || '';
    const p2Det = (isTrackerScorecard && ((Array.isArray(game.p2Detachments) && game.p2Detachments[0]) || rec.p2_detachment)) || bcpMatchRec?.player2_detachment || evP2?.detachment || '';

    if (p1NameEl) p1NameEl.innerText = p1Name;
    if (p2NameEl) p2NameEl.innerText = p2Name;
    if (p1FacEl) p1FacEl.innerText = p1Fac;
    if (p2FacEl) p2FacEl.innerText = p2Fac;
    if (p1DetEl) p1DetEl.innerText = p1Det ? `• ${p1Det}` : '';
    if (p2DetEl) p2DetEl.innerText = p2Det ? `• ${p2Det}` : '';

    const isAosModal = Boolean(
      data.game_system === 'aos' ||
      st.gameSystem === 'aos' ||
      String(resolvedMatchId || '').startsWith('AOS-') ||
      (window.currentGameSystem === 'aos' && !isTrackerScorecard)
    );
    if (liveLink) {
      liveLink.href = `/${isAosModal ? 'aos' : '11th'}/tracker/play?match_id=${encodeURIComponent(resolvedMatchId)}`;
    }

    const p1Obj = isTrackerScorecard ? (st.p1 || {}) : {};
    const p2Obj = isTrackerScorecard ? (st.p2 || {}) : {};
    const p1Rounds = p1Obj.rounds || [];
    const p2Rounds = p2Obj.rounds || [];
    const hasTurnData = Boolean(
      isTrackerScorecard && (
        p1Rounds.length > 0 ||
        p2Rounds.length > 0 ||
        p1Obj.score !== undefined ||
        p2Obj.score !== undefined ||
        rec.p1_score !== undefined ||
        rec.p2_score !== undefined
      )
    );

    const missionObj = st.mission || {};
    const rawEd = String(
      st.edition || rec.edition || missionObj.edition || p1Obj.edition || p2Obj.edition || game.edition || ''
    ).toLowerCase().trim();
    const packId = String(missionObj.packId || '').toLowerCase();

    let edCode = isAosModal ? 'aos_4e' : '10th';
    let edBadgeLabel = isAosModal ? 'AoS 4e' : '10th Ed';
    let priCap = isAosModal ? 30 : 50;
    let secCap = isAosModal ? 20 : 40;
    let maxTot = isAosModal ? 50 : 100;
    let hasPaint = !isAosModal;
    let hasGrandStrategy = false;

    if (isAosModal) {
      if (rawEd === 'aos_3e' || rawEd === '3e' || packId.includes('3e') || packId.includes('pitched') || p1Obj.grandStrategy || p2Obj.grandStrategy || Number(p1Obj.grandStrategyScore || 0) > 0 || Number(p2Obj.grandStrategyScore || 0) > 0) {
        edCode = 'aos_3e';
        edBadgeLabel = 'AoS 3e';
        maxTot = 53;
        hasGrandStrategy = true;
      }
    } else if (rawEd === '8th_itc' || rawEd === '8th' || packId.includes('8th') || packId.includes('itc') || Number(p1Obj.primaryCap) === 36) {
      edCode = '8th_itc';
      edBadgeLabel = '8th ITC';
      priCap = 36;
      secCap = 12;
      maxTot = 48;
      hasPaint = false;
    } else if (rawEd === '11th' || rawEd === '11e' || packId.includes('11th') || (!st.imported_source && !rec.imported_source && (p1Obj.deck || p2Obj.deck || game.p1Disposition || game.p2Disposition || !rawEd))) {
      edCode = '11th';
      edBadgeLabel = '11th Ed';
      priCap = 45;
      secCap = 45;
      maxTot = 100;
      hasPaint = true;
    } else if (rawEd === '9th' || rawEd === '9e' || packId.includes('9th') || packId.includes('nephilim') || packId.includes('arks') || Number(p1Obj.primaryCap) === 45 || Number(p1Obj.secondaryCap) === 45) {
      edCode = '9th';
      edBadgeLabel = '9th Ed';
      priCap = 45;
      secCap = 45;
      maxTot = 100;
      hasPaint = true;
    }

    function getRoundSecScore(pObj, rObj, rNum) {
      if (isAosModal) return Number(rObj.tacticScore || 0);
      const secs = getModalPlayerRoundSecondaries(pObj, rNum);
      if (secs.length > 0) {
        return secs.reduce((acc, s) => acc + (Number(s.score) || 0), 0);
      }
      if (typeof rObj.secondaryScore === 'number' && rObj.secondaryScore > 0) return rObj.secondaryScore;
      return 0;
    }

    function getBreakdown(obj, rounds) {
      const pri = Math.min(priCap, rounds.reduce((s, r) => s + Number(r.primaryScore || 0), 0));
      let secRaw = 0;
      for (let i = 1; i <= 5; i++) {
        const rObj = rounds.find(x => (x.round === i || x.battleRound === i)) || rounds[i - 1] || {};
        secRaw += getRoundSecScore(obj, rObj, i);
      }
      const sec = Math.min(secCap, secRaw);
      if (isAosModal) {
        const gs = hasGrandStrategy ? Number(obj.grandStrategyScore || (obj.grandStrategyAchieved ? 3 : 0)) : 0;
        const tacticsCount = rounds.filter(r => r.tacticStatus === 'achieved').length;
        return { pri, sec, paint: 0, gs, tacticsCount, total: Math.min(maxTot, pri + sec + gs) };
      }
      const paint = !hasPaint ? 0 : (typeof obj.paintScore === 'number' ? obj.paintScore : (obj.battleReady !== false ? 10 : 0));
      return { pri, sec, paint, gs: 0, tacticsCount: 0, total: Math.min(maxTot, pri + sec + paint) };
    }

    const hasBcpScore = Boolean(
      bcpMatchRec &&
      bcpMatchRec.player1_score !== null &&
      bcpMatchRec.player1_score !== undefined &&
      bcpMatchRec.player2_score !== null &&
      bcpMatchRec.player2_score !== undefined
    );

    const p1Break = hasTurnData ? getBreakdown(p1Obj, p1Rounds) : null;
    const p2Break = hasTurnData ? getBreakdown(p2Obj, p2Rounds) : null;

    const p1Score = hasTurnData
      ? (p1Break.total || rec.p1_score || 0)
      : (hasBcpScore ? bcpMatchRec.player1_score : 0);
    const p2Score = hasTurnData
      ? (p2Break.total || rec.p2_score || 0)
      : (hasBcpScore ? bcpMatchRec.player2_score : 0);

    if (p1ScoreEl) p1ScoreEl.innerText = (hasTurnData || hasBcpScore) ? p1Score : '-';
    if (p2ScoreEl) p2ScoreEl.innerText = (hasTurnData || hasBcpScore) ? p2Score : '-';

    // Highlight winner directly on the compact player names
    const n1Val = Number(p1Score || 0);
    const n2Val = Number(p2Score || 0);
    if (hasTurnData || hasBcpScore) {
      if (n1Val > n2Val && p1NameEl) {
        p1NameEl.innerText = `🏆 ${p1Name}`;
      } else if (n2Val > n1Val && p2NameEl) {
        p2NameEl.innerText = `🏆 ${p2Name}`;
      }
    }

    if (p1SubEl && p2SubEl) {
      if (hasTurnData && p1Break && p2Break) {
        p1SubEl.style.display = 'inline-block';
        p2SubEl.style.display = 'inline-block';
        if (isAosModal) {
          if (hasGrandStrategy) {
            p1SubEl.innerHTML = `PRI ${p1Break.pri}/${priCap} • TAC ${p1Break.sec}/${secCap} • GS +${p1Break.gs}`;
            p2SubEl.innerHTML = `PRI ${p2Break.pri}/${priCap} • TAC ${p2Break.sec}/${secCap} • GS +${p2Break.gs}`;
          } else {
            p1SubEl.innerHTML = `PRI ${p1Break.pri}/${priCap} • TAC ${p1Break.sec}/${secCap} (${p1Break.tacticsCount}/5)`;
            p2SubEl.innerHTML = `PRI ${p2Break.pri}/${priCap} • TAC ${p2Break.sec}/${secCap} (${p2Break.tacticsCount}/5)`;
          }
        } else if (!hasPaint) {
          p1SubEl.innerHTML = `PRI ${p1Break.pri}/${priCap} • SEC ${p1Break.sec}/${secCap}`;
          p2SubEl.innerHTML = `PRI ${p2Break.pri}/${priCap} • SEC ${p2Break.sec}/${secCap}`;
        } else {
          p1SubEl.innerHTML = `PRI ${p1Break.pri}/${priCap} • SEC ${p1Break.sec}/${secCap} • PNT +${p1Break.paint}`;
          p2SubEl.innerHTML = `PRI ${p2Break.pri}/${priCap} • SEC ${p2Break.sec}/${secCap} • PNT +${p2Break.paint}`;
        }
      } else {
        p1SubEl.style.display = 'none';
        p2SubEl.style.display = 'none';
      }
    }

    const roundNum = (isTrackerScorecard && (rec.round_num || game.roundNum || st.round_num)) || bcpMatchRec?.round || parsedRound || 1;
    const tableNum = (isTrackerScorecard && (rec.table_num || game.tableNum || st.table_num)) || bcpMatchRec?.table_number || bcpMatchRec?.table || parsedTable || null;
    const eventLabel = bcpMatchRec?.event_name || (isTrackerScorecard && (st.mapped_event_name || rec.mapped_event_name)) || (isSameCachedEvent && currentEventData && currentEventData.name) || null;

    if (badgesEl) {
      badgesEl.innerHTML = '';
      badgesEl.style.display = 'none';
    }
    if (winnerBannerEl) {
      winnerBannerEl.style.display = 'none';
      winnerBannerEl.innerHTML = '';
    }

    if (titleEl) {
      titleEl.innerHTML = `🏆 ${eventLabel ? escapeHtml(eventLabel) + ' • ' : ''}R${roundNum}${tableNum ? ' • T' + tableNum : ''}`;
    }
    if (subEl) {
      const dateStr = (isTrackerScorecard && (st.game_date || rec.game_date || rec.updated_at || rec.updatedAt)) || bcpMatchRec?.match_date || (isSameCachedEvent && currentEventData && currentEventData.event_date) || Date.now();
      if (hasTurnData) {
        const liveTag = (data.source === 'firestore' && !data.is_finished) ? '🔴 LIVE • ' : '';
        const missionLabel = isAosModal
          ? `${game.battleplan?.name || st.battleplan?.name || rec.primary_mission || 'Border War'}`
          : `${game.primary || game.p1Primary || st.mission?.primaryName || rec.primary_mission || 'Take & Hold'}`;
        subEl.innerText = `${liveTag}${edBadgeLabel} • ${missionLabel} • ${new Date(dateStr).toLocaleDateString()}`;
      } else {
        subEl.innerText = `${new Date(dateStr).toLocaleDateString()}`;
      }
    }

    // Render Matrix Rows
    if (tbody) {
      tbody.innerHTML = '';

      if (!hasTurnData && bcpMatchRec) {
        const p1Won = hasBcpScore && Number(p1Score) > Number(p2Score);
        const p2Won = hasBcpScore && Number(p2Score) > Number(p1Score);
        const p1Badge = !hasBcpScore
          ? '<span class="badge badge-draw" style="margin-right:6px;">PENDING</span>'
          : (p1Won ? '<span class="badge badge-win" style="margin-right:6px;">VICTORY</span>' : (p2Won ? '<span class="badge badge-loss" style="margin-right:6px;">DEFEAT</span>' : '<span class="badge badge-draw" style="margin-right:6px;">DRAW</span>'));
        const p2Badge = !hasBcpScore
          ? '<span class="badge badge-draw" style="margin-right:6px;">PENDING</span>'
          : (p2Won ? '<span class="badge badge-win" style="margin-right:6px;">VICTORY</span>' : (p1Won ? '<span class="badge badge-loss" style="margin-right:6px;">DEFEAT</span>' : '<span class="badge badge-draw" style="margin-right:6px;">DRAW</span>'));
        const statusDesc = hasBcpScore ? 'Official BCP Final Battle Points' : 'Official BCP Match Pairing (Awaiting Final Score)';
        const p1TotalDisplay = hasBcpScore ? `${escapeHtml(String(p1Score))} / ${maxTot}` : `- / ${maxTot}`;
        const p2TotalDisplay = hasBcpScore ? `${escapeHtml(String(p2Score))} / ${maxTot}` : `- / ${maxTot}`;
        tbody.innerHTML = `
          <tr>
            <td style="color:#38bdf8; font-weight:800; text-align:left; white-space:normal;">
              <div>🟦 ${escapeHtml(p1Name)}</div>
              <div style="font-size:0.72rem; color:var(--text-muted); font-weight:600; margin-top:2px;">${escapeHtml(p1Fac)}${p1Det ? ' • ' + escapeHtml(p1Det) : ''}</div>
            </td>
            <td colspan="5" style="text-align:center; color:var(--text-secondary); font-size:0.78rem; white-space:normal;">
              ${p1Badge}
              ${statusDesc}
            </td>
            <td style="font-family:var(--font-mono); font-weight:900; font-size:1.02rem; color:${p1Won ? '#4ade80' : '#f8fafc'}; text-align:center; white-space:nowrap;">${p1TotalDisplay}</td>
          </tr>
          <tr>
            <td style="color:#f43f5e; font-weight:800; text-align:left; white-space:normal;">
              <div>🟥 ${escapeHtml(p2Name)}</div>
              <div style="font-size:0.72rem; color:var(--text-muted); font-weight:600; margin-top:2px;">${escapeHtml(p2Fac)}${p2Det ? ' • ' + escapeHtml(p2Det) : ''}</div>
            </td>
            <td colspan="5" style="text-align:center; color:var(--text-secondary); font-size:0.78rem; white-space:normal;">
              ${p2Badge}
              ${statusDesc}
            </td>
            <td style="font-family:var(--font-mono); font-weight:900; font-size:1.02rem; color:${p2Won ? '#4ade80' : '#f8fafc'}; text-align:center; white-space:nowrap;">${p2TotalDisplay}</td>
          </tr>
          <tr style="background: rgba(255,255,255,0.02);">
            <td colspan="7" style="text-align:center; padding:0.7rem; font-size:0.76rem; color:var(--text-muted); white-space:normal; line-height:1.4;">
              ℹ️ Final Battle Points synced from Best Coast Pairings. Turn-by-turn primary &amp; secondary breakdown is populated when a game is submitted or mapped via OmniTactica Game Tracker.
            </td>
          </tr>
        `;
        return;
      }

      function buildPrimaryRowModal(title, color, roundsArr, capVal) {
        let cells = '';
        let total = 0;
        for (let i = 1; i <= 5; i++) {
          const r = roundsArr.find(x => (x.round === i || x.battleRound === i)) || roundsArr[i - 1] || {};
          const val = typeof r.primaryScore === 'number' ? r.primaryScore : '-';
          if (typeof val === 'number') total += val;
          cells += `<td style="font-family:var(--font-mono); font-weight:600; text-align:center;">${val}</td>`;
        }
        const cappedTotal = Math.min(capVal, total);
        return `
          <tr>
            <td style="color:${color}; font-weight:700; text-align:left;">${title}</td>
            ${cells}
            <td style="font-family:var(--font-mono); font-weight:800; color:#fff; text-align:center; white-space:nowrap;">${cappedTotal}/${capVal}</td>
          </tr>
        `;
      }

      if (isAosModal) {
        let priorityCells = '';
        for (let i = 1; i <= 5; i++) {
          const rInfo = (st.roundState && st.roundState[i]) || {};
          const winnerStr = rInfo.firstTurn === 'p1' ? 'P1' : (rInfo.firstTurn === 'p2' ? 'P2' : '-');
          const dTurn = rInfo.isDoubleTurn ? '<br><span style="color:#ef4444; font-size:10px;">⚡Double</span>' : '';
          priorityCells += `<td style="font-family:var(--font-mono); font-size:11px; text-align:center;">${winnerStr}${dTurn}</td>`;
        }
        tbody.innerHTML += `
          <tr style="background:rgba(245,158,11,0.04);">
            <td style="color:#f59e0b; font-weight:700; text-align:left;">🎲 Priority Roll &amp; Initiative</td>
            ${priorityCells}
            <td style="font-family:var(--font-mono); font-weight:800; color:#f59e0b; text-align:center;">-</td>
          </tr>
        `;

        function buildAosTacticsSection(pLabel, pColor, subColor, roundsArr, capVal, subClass) {
          let cells = '';
          let total = 0;
          const hasSub = roundsArr.some(r => r.tacticId && r.tacticId !== 'none');
          for (let i = 1; i <= 5; i++) {
            const r = roundsArr.find(x => (x.round === i || x.battleRound === i)) || roundsArr[i - 1] || {};
            const val = r.tacticStatus === 'achieved' ? `+${r.tacticScore || 4}` : (r.tacticStatus === 'failed' ? '0' : (r.tacticStatus === 'forfeited_double_turn' ? 'Forfeit' : (Number(r.tacticScore) > 0 ? `+${r.tacticScore}` : '-')));
            const col = (r.tacticStatus === 'achieved' || Number(r.tacticScore) > 0) ? '#10b981' : (r.tacticStatus === 'failed' ? '#ef4444' : '#94a3b8');
            total += Number(r.tacticScore || 0);
            cells += `<td style="font-family:var(--font-mono); font-weight:700; color:${col}; text-align:center;">${val}</td>`;
          }
          const cappedTotal = Math.min(capVal, total);
          const toggleBtn = hasSub
            ? ` <button type="button" class="btn-modal-toggle-sec" onclick="event.stopPropagation(); toggleModalPlayerSecondaries('${subClass}')" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); color:#94a3b8; font-size:0.65rem; padding:2px 6px; border-radius:4px; cursor:pointer; margin-left:6px;">▼ Details</button>`
            : '';
          let html = `
            <tr ${hasSub ? `onclick="toggleModalPlayerSecondaries('${subClass}')" style="cursor:pointer;"` : ''}>
              <td style="color:${subColor}; font-weight:700; text-align:left;">${pLabel} Battle Tactics${toggleBtn}</td>
              ${cells}
              <td style="font-family:var(--font-mono); font-weight:800; color:#fff; text-align:center; white-space:nowrap;">${cappedTotal}/${capVal}</td>
            </tr>
          `;
          roundsArr.forEach(r => {
            if (r.tacticId && r.tacticId !== 'none') {
              html += `
                <tr class="${subClass}" style="display:table-row; background:rgba(15,23,42,0.7); font-size:0.78rem;">
                  <td style="padding-left:1.5rem; color:#cbd5e1; text-align:left;"><span style="color:${pColor}; font-weight:700;">R${r.round}:</span> ⚡ ${escapeHtml(r.tacticName || r.tacticId)}</td>
                  <td colspan="5" style="color:#94a3b8; font-size:0.72rem; text-align:center;">Status: <strong style="color:${r.tacticStatus === 'achieved' ? '#10b981' : '#ef4444'}">${escapeHtml(r.tacticStatus || 'scored')}</strong></td>
                  <td style="font-family:var(--font-mono); font-weight:700; color:#cbd5e1; text-align:center;">+${r.tacticScore || 0}</td>
                </tr>
              `;
            }
          });
          return html;
        }

        tbody.innerHTML += buildPrimaryRowModal(`🟦 ${escapeHtml(p1Name)} Primary`, '#38bdf8', p1Rounds, priCap);
        tbody.innerHTML += buildAosTacticsSection(`🟦 ${escapeHtml(p1Name)}`, '#38bdf8', '#7dd3fc', p1Rounds, secCap, 'msc-p1-sec-sub');
        tbody.innerHTML += buildPrimaryRowModal(`🟥 ${escapeHtml(p2Name)} Primary`, '#f43f5e', p2Rounds, priCap);
        tbody.innerHTML += buildAosTacticsSection(`🟥 ${escapeHtml(p2Name)}`, '#f43f5e', '#fda4af', p2Rounds, secCap, 'msc-p2-sec-sub');

        if (hasGrandStrategy) {
          const gs1 = Number(p1Obj.grandStrategyScore || (p1Obj.grandStrategyAchieved ? 3 : 0));
          const gs2 = Number(p2Obj.grandStrategyScore || (p2Obj.grandStrategyAchieved ? 3 : 0));
          tbody.innerHTML += `
            <tr style="background: rgba(245,158,11,0.06);">
              <td style="color:#fbbf24; font-weight:700; text-align:left;">👑 Grand Strategy (AoS 3e • +3 VP)</td>
              <td colspan="5" style="text-align:center; font-weight:600; font-size:0.8rem; color:var(--text-secondary);">
                ${escapeHtml(p1Name)}: ${gs1 > 0 ? '+' + gs1 : '0'} &nbsp;|&nbsp; ${escapeHtml(p2Name)}: ${gs2 > 0 ? '+' + gs2 : '0'}
              </td>
              <td style="font-family:var(--font-mono); font-weight:800; color:#fbbf24; text-align:center;">
                +${gs1 + gs2}
              </td>
            </tr>
          `;
        }
      } else {
        function build40kSecondarySection(title, playerColor, rowColor, pObj, roundsArr, capVal, subClass) {
          let cells = '';
          let total = 0;
          let subRowsHtml = '';
          for (let i = 1; i <= 5; i++) {
            const r = roundsArr.find(x => (x.round === i || x.battleRound === i)) || roundsArr[i - 1] || {};
            const secs = getModalPlayerRoundSecondaries(pObj, i);
            const val = secs.length > 0
              ? secs.reduce((acc, s) => acc + (Number(s.score) || 0), 0)
              : (Number(r.secondaryScore) || 0);
            total += val;
            const cellVal = val > 0 ? val : (secs.length > 0 ? '0' : '-');
            const cellColor = val > 0 ? '#e2e8f0' : (secs.length > 0 ? '#94a3b8' : '#475569');
            cells += `<td style="font-family:var(--font-mono); font-weight:600; color:${cellColor}; text-align:center;">${cellVal}</td>`;

            if (secs.length > 0) {
              secs.forEach(s => {
                const scVal = Number(s.score) || 0;
                const isScored = scVal > 0;
                const badgeHtml = formatModalSecondaryStatusBadge(s, i);
                let roundCells = '';
                for (let c = 1; c <= 5; c++) {
                  if (c === i) {
                    if (isScored) {
                      roundCells += `<td style="font-family:var(--font-mono); color:${playerColor}; font-weight:800; background:rgba(56,189,248,0.06); text-align:center;">+${scVal}</td>`;
                    } else {
                      roundCells += `<td style="font-family:var(--font-mono); color:#94a3b8; font-weight:600; background:rgba(148,163,184,0.04); text-align:center;">0</td>`;
                    }
                  } else {
                    roundCells += `<td style="color:#475569; text-align:center;">-</td>`;
                  }
                }
                const totCellText = isScored ? `+${scVal}` : '0';
                const totCellColor = isScored ? '#cbd5e1' : '#64748b';
                subRowsHtml += `
                  <tr class="${subClass}" style="display:table-row; background:rgba(15,23,42,0.7); font-size:0.78rem;">
                    <td style="padding-left:1.5rem; color:${isScored ? '#cbd5e1' : '#94a3b8'}; text-align:left;">
                      <span style="color:${playerColor}; font-weight:700;">R${i}:</span> 🃏 ${escapeHtml(s.name)}${badgeHtml}
                    </td>
                    ${roundCells}
                    <td style="font-family:var(--font-mono); font-weight:${isScored ? '700' : '600'}; color:${totCellColor}; text-align:center;">${totCellText}</td>
                  </tr>
                `;
              });
            }
          }
          const cappedTotal = Math.min(capVal, total);
          const toggleBtn = subRowsHtml
            ? ` <button type="button" class="btn-modal-toggle-sec" onclick="event.stopPropagation(); toggleModalPlayerSecondaries('${subClass}')" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); color:#94a3b8; font-size:0.65rem; padding:2px 6px; border-radius:4px; cursor:pointer; margin-left:6px;">▼ Details</button>`
            : '';
          return `
            <tr ${subRowsHtml ? `onclick="toggleModalPlayerSecondaries('${subClass}')" style="cursor:pointer;"` : ''}>
              <td style="color:${rowColor}; font-weight:700; text-align:left;">${title}${toggleBtn}</td>
              ${cells}
              <td style="font-family:var(--font-mono); font-weight:800; color:#fff; text-align:center; white-space:nowrap;">${cappedTotal}/${capVal}</td>
            </tr>
            ${subRowsHtml}
          `;
        }

        tbody.innerHTML += buildPrimaryRowModal(`🟦 ${escapeHtml(p1Name)} Primary`, '#38bdf8', p1Rounds, priCap);
        tbody.innerHTML += build40kSecondarySection(`🟦 ${escapeHtml(p1Name)} Secondaries`, '#38bdf8', '#7dd3fc', p1Obj, p1Rounds, secCap, 'msc-p1-sec-sub');
        tbody.innerHTML += buildPrimaryRowModal(`🟥 ${escapeHtml(p2Name)} Primary`, '#f43f5e', p2Rounds, priCap);
        tbody.innerHTML += build40kSecondarySection(`🟥 ${escapeHtml(p2Name)} Secondaries`, '#f43f5e', '#fda4af', p2Obj, p2Rounds, secCap, 'msc-p2-sec-sub');

        if (hasPaint) {
          const p1Paint = typeof p1Obj.paintScore === 'number' ? p1Obj.paintScore : (p1Obj.battleReady !== false ? 10 : 0);
          const p2Paint = typeof p2Obj.paintScore === 'number' ? p2Obj.paintScore : (p2Obj.battleReady !== false ? 10 : 0);
          tbody.innerHTML += `
            <tr style="background: rgba(255,255,255,0.02);">
              <td style="color:#10b981; font-weight:700; text-align:left;">🎨 Battle Ready (+10)</td>
              <td colspan="5" style="text-align:center; font-weight:600; font-size:0.8rem; color:var(--text-secondary);">
                ${escapeHtml(p1Name)}: ${p1Paint > 0 ? '✓ +' + p1Paint : '0'} &nbsp;|&nbsp; ${escapeHtml(p2Name)}: ${p2Paint > 0 ? '✓ +' + p2Paint : '0'}
              </td>
              <td style="font-family:var(--font-mono); font-weight:800; color:#10b981; text-align:center;">
                ${p1Paint + p2Paint}
              </td>
            </tr>
          `;
        }
      }
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:var(--loss);">Error loading scorecard: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ==========================================
// FEEDBACK & BUG REPORT MODAL
// ==========================================

let activeFeedbackType = 'bug';

function setFeedbackType(type) {
  activeFeedbackType = type;
  ['bug', 'feature', 'general'].forEach(t => {
    const btn = document.getElementById(`fb-type-btn-${t}`);
    if (btn) {
      if (t === type) {
        btn.style.background = '#0284c7';
        btn.style.color = '#fff';
        btn.style.borderColor = '#38bdf8';
      } else {
        btn.style.background = 'rgba(255,255,255,0.04)';
        btn.style.color = '#94a3b8';
        btn.style.borderColor = 'rgba(255,255,255,0.1)';
      }
    }
  });
}

function openFeedbackModal() {
  let modal = document.getElementById('feedback-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'feedback-modal';
    modal.className = 'modal-backdrop';
    modal.onclick = function(e) { if (e.target === this) closeFeedbackModal(); };
    document.body.appendChild(modal);
  }

  const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;

  if (!user) {
    modal.innerHTML = `
      <div class="modal-window" style="max-width: 440px; background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; box-shadow:0 25px 60px rgba(0,0,0,0.85); overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc; text-align:center; padding: 28px 24px;">
        <div style="font-size: 36px; margin-bottom: 12px;">🔒</div>
        <h3 style="font-size: 18px; font-weight: 800; color: #fff; margin: 0 0 8px;">Sign In to Submit Feedback</h3>
        <p style="font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 20px;">
          Feedback and bug reports are linked to verified player accounts so we can investigate your match data and notify you when your issue is resolved.
        </p>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button onclick="closeFeedbackModal()" style="background:#1e293b; color:#cbd5e1; font-weight:700; font-size:12px; border:none; padding:9px 18px; border-radius:8px; cursor:pointer;">Cancel</button>
          <a href="/login?redirect=/" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; text-decoration:none; padding:9px 20px; border-radius:8px; display:inline-flex; align-items:center; gap:6px;">
            🔑 Sign In / Register
          </a>
        </div>
      </div>
    `;
    modal.classList.add('active');
    return;
  }

  const userEmail = user.email || user.bcp_email || '';
  const userName = user.display_name || userEmail;

  modal.innerHTML = `
    <div class="modal-window" style="max-width: 520px; background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; box-shadow:0 25px 60px rgba(0,0,0,0.85); overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc;">
      <div class="modal-header" style="padding:16px 20px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:22px;">💬</span>
          <div>
            <h3 style="font-size:16px; font-weight:800; color:#fff; margin:0;">Feedback & Bug Report</h3>
            <div style="font-size:11px; color:#10b981; margin-top:2px;">
              Submitting as <strong>${escapeHtml(userName)}</strong> (${escapeHtml(userEmail)})
            </div>
          </div>
        </div>
        <button onclick="closeFeedbackModal()" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer;">✕</button>
      </div>

      <div style="padding:20px;">
        <!-- Category Selector -->
        <label style="display:block; font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:8px;">Category:</label>
        <div style="display:flex; gap:8px; margin-bottom:16px;">
          <button type="button" id="fb-type-btn-bug" onclick="setFeedbackType('bug')" style="flex:1; padding:8px 10px; border-radius:8px; font-size:12px; font-weight:700; border:1px solid #38bdf8; background:#0284c7; color:#fff; cursor:pointer; transition:all 0.2s;">
            🐞 Bug Report
          </button>
          <button type="button" id="fb-type-btn-feature" onclick="setFeedbackType('feature')" style="flex:1; padding:8px 10px; border-radius:8px; font-size:12px; font-weight:700; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:#94a3b8; cursor:pointer; transition:all 0.2s;">
            ✨ Feature Idea
          </button>
          <button type="button" id="fb-type-btn-general" onclick="setFeedbackType('general')" style="flex:1; padding:8px 10px; border-radius:8px; font-size:12px; font-weight:700; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:#94a3b8; cursor:pointer; transition:all 0.2s;">
            💬 General
          </button>
        </div>

        <!-- Description -->
        <label style="display:block; font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:6px;">
          Description / Details: <span style="color:#ef4444;">*</span>
        </label>
        <textarea id="fb-input-message" rows="5" placeholder="Describe the issue you encountered or the feature you'd love to see... (e.g. army list text error, scorecard discrepancy, predictor feedback)" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:8px; padding:10px 12px; color:#e2e8f0; font-size:12.5px; font-family:'Inter',system-ui,sans-serif; outline:none; box-sizing:border-box; line-height:1.5; resize:vertical;"></textarea>

        <!-- Locked Verified User Email -->
        <div style="margin-top:14px;">
          <label style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:6px;">
            <span>Verified Account Email:</span>
            <span style="font-size:10.5px; color:#10b981; font-weight:600;">🔒 Locked to active account</span>
          </label>
          <input type="text" id="fb-input-contact" value="${escapeHtml(userEmail)}" readonly disabled style="width:100%; background:#1e293b; border:1px solid #475569; border-radius:8px; padding:9px 12px; color:#94a3b8; font-size:12px; outline:none; box-sizing:border-box; cursor:not-allowed; opacity:0.85;">
        </div>

        <div id="fb-status-msg" style="display:none; margin-top:12px; padding:10px; border-radius:8px; font-size:12px; font-weight:600;"></div>

        <!-- Action Buttons -->
        <div style="margin-top:18px; display:flex; justify-content:flex-end; gap:8px;">
          <button onclick="closeFeedbackModal()" style="background:#1e293b; color:#cbd5e1; font-weight:700; font-size:12px; border:none; padding:9px 16px; border-radius:8px; cursor:pointer;">Cancel</button>
          <button id="fb-btn-submit" onclick="handleSubmitFeedback()" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; border:none; padding:9px 20px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
            🚀 Submit Feedback
          </button>
        </div>
      </div>
    </div>
  `;

  bringModalToFront(modal);
  modal.style.display = 'flex';
  activeFeedbackType = 'bug';
}

function closeFeedbackModal() {
  closeModal('feedback-modal');
  const modal = document.getElementById('feedback-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

async function handleSubmitFeedback() {
  const msgInput = document.getElementById('fb-input-message');
  const contactInput = document.getElementById('fb-input-contact');
  const statusDiv = document.getElementById('fb-status-msg');
  const btn = document.getElementById('fb-btn-submit');

  const message = msgInput ? msgInput.value.trim() : '';
  const email = contactInput ? contactInput.value.trim() : '';

  if (!message) {
    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.style.background = 'rgba(239,68,68,0.15)';
      statusDiv.style.border = '1px solid rgba(239,68,68,0.4)';
      statusDiv.style.color = '#f87171';
      statusDiv.innerText = 'Please enter your feedback message.';
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px; height:14px; border-width:2px;"></span> Submitting...';
  }

  try {
    const sessionToken = localStorage.getItem('native_session_token') || 
                         localStorage.getItem('elo_auth_token') || 
                         (typeof getCookieToken === 'function' ? getCookieToken() : (localStorage.getItem('elo_session_token') || ''));
    const payload = {
      feedback_type: activeFeedbackType,
      message: message,
      email: email,
      page_url: window.location.href,
      device_info: `${navigator.userAgent} (${window.innerWidth}x${window.innerHeight})`,
      token: sessionToken
    };

    const resp = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {})
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    if (resp.ok && data.success) {
      if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.style.background = 'rgba(16,185,129,0.15)';
        statusDiv.style.border = '1px solid rgba(16,185,129,0.4)';
        statusDiv.style.color = '#34d399';
        statusDiv.innerText = '✅ Thank you! Your feedback has been sent directly to the developer.';
      }
      if (msgInput) msgInput.value = '';
      setTimeout(() => {
        closeFeedbackModal();
      }, 1600);
    } else {
      throw new Error(data.detail || data.error || 'Failed to submit feedback');
    }
  } catch (err) {
    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.style.background = 'rgba(239,68,68,0.15)';
      statusDiv.style.border = '1px solid rgba(239,68,68,0.4)';
      statusDiv.style.color = '#f87171';
      statusDiv.innerText = `Error submitting feedback: ${err.message}`;
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🚀 Submit Feedback';
    }
  }
}

window.openFeedbackModal = openFeedbackModal;
window.closeFeedbackModal = closeFeedbackModal;

function showUnregisteredPlayerAlert(playerName) {
  const name = playerName || 'This player';
  alert(`ℹ️ Chat Unavailable\n\n${name} appears in tournament match records, but has not yet registered an account on OmniTactica.\n\nDirect chat and match requests are only available between registered OmniTactica users. Once they create an account or link their BCP profile, you will be able to send chat requests.`);
}
window.showUnregisteredPlayerAlert = showUnregisteredPlayerAlert;
window.handleSubmitFeedback = handleSubmitFeedback;
window.setFeedbackType = setFeedbackType;

function openPowerRatingInfoModal(event) {
  if (event) {
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
  const modal = document.getElementById('power-rating-info-modal');
  if (modal) {
    bringModalToFront(modal);
  }
}
window.openPowerRatingInfoModal = openPowerRatingInfoModal;

