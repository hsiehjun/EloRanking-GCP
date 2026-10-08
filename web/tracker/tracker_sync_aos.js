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

  let role = urlParams.get('role') || 'player1';

  const aosListState = {
    p1ArmyList: null,
    p2ArmyList: null,
    activeListTab: 'my',
    rosterViewMode: 'play',
    attachTargetRole: null
  };
  try {
    const savedP1List = sessionStorage.getItem('omni_aos_p1_army_list');
    if (savedP1List) aosListState.p1ArmyList = JSON.parse(savedP1List);
    const savedP2List = sessionStorage.getItem('omni_aos_p2_army_list');
    if (savedP2List) aosListState.p2ArmyList = JSON.parse(savedP2List);
  } catch (e) {}

  function getAuthToken() {
    return localStorage.getItem('elo_auth_token') || localStorage.getItem('native_session_token') || sessionStorage.getItem('elo_auth_token') || '';
  }

  function getOrCreateGuestId() {
    const GUEST_KEY = 'gt_guest_id';
    let gid = '';
    try {
      gid = localStorage.getItem(GUEST_KEY) || sessionStorage.getItem(GUEST_KEY) || '';
    } catch (e) {}
    if (!gid) {
      try {
        const m = document.cookie.match(/(?:^|;\s*)gt_guest_id=([^;]+)/);
        if (m && m[1]) gid = decodeURIComponent(m[1]);
      } catch (e) {}
    }
    if (!gid) {
      gid = 'guest_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
    }
    try {
      localStorage.setItem(GUEST_KEY, gid);
      sessionStorage.setItem(GUEST_KEY, gid);
      document.cookie = `gt_guest_id=${encodeURIComponent(gid)}; path=/; max-age=2592000; SameSite=Lax`;
    } catch (e) {}
    return gid;
  }

  function getCleanRoomShareUrl(mid) {
    const cleanId = mid || matchId || '';
    if (!cleanId) {
      const u = new URL(window.location.href);
      u.searchParams.delete('role');
      u.searchParams.delete('mode');
      return u.toString();
    }
    return `${window.location.origin}/11th/tracker/aos?match_id=${encodeURIComponent(cleanId)}`;
  }

  window.__copyRoomShareLink = function (mid, btnEl) {
    const shareUrl = getCleanRoomShareUrl(mid);
    navigator.clipboard.writeText(shareUrl).then(() => {
      if (btnEl && btnEl.tagName) {
        const orig = btnEl.innerHTML;
        btnEl.innerHTML = '✅ LINK COPIED!';
        setTimeout(() => { btnEl.innerHTML = orig; }, 1600);
      } else {
        alert('🔗 Room Link Copied! Share with your opponent.');
      }
    }).catch(() => {
      prompt('Copy this Match Room Link to share with your opponent:', shareUrl);
    });
  };

  let _aosShareChatThreadsCache = [];
  let _aosShareUserSearchTimer = null;

  window.__sendRoomInviteToChat = async function (mid, opts, btnEl) {
    const targetMid = mid || matchId;
    if (!targetMid) return;
    const token = getAuthToken();
    if (!token) {
      alert('Please sign in to OmniTactica to send invites in Chat, or use Copy Link above.');
      return;
    }
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = 'Sending...';
    }
    try {
      const resp = await fetch(`/api/tracker/room/${encodeURIComponent(targetMid)}/share_chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          token: token,
          request_id: (opts && opts.requestId) || undefined,
          receiver_id: (opts && opts.receiverId) || undefined
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.success) {
        if (btnEl) {
          btnEl.style.background = '#10b981';
          btnEl.style.color = '#070b14';
          btnEl.style.borderColor = '#10b981';
          btnEl.textContent = '✅ Sent in Chat!';
        }
        const statusBanner = document.getElementById('gt-share-modal-status');
        if (statusBanner) {
          statusBanner.style.display = 'block';
          statusBanner.style.background = 'rgba(16,185,129,0.14)';
          statusBanner.style.border = '1px solid rgba(16,185,129,0.4)';
          statusBanner.style.color = '#34d399';
          statusBanner.innerHTML = `✅ Match Room <b>#${escapeHtml(targetMid)}</b> invite card sent to <b>${escapeHtml((opts && opts.targetLabel) || data.target_label || 'Chat')}</b>!`;
        }
      } else {
        throw new Error(data.detail || 'Could not send invite');
      }
    } catch (err) {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = '📨 Send Invite';
      }
      const statusBanner = document.getElementById('gt-share-modal-status');
      if (statusBanner) {
        statusBanner.style.display = 'block';
        statusBanner.style.background = 'rgba(239,68,68,0.14)';
        statusBanner.style.border = '1px solid rgba(239,68,68,0.4)';
        statusBanner.style.color = '#f87171';
        statusBanner.textContent = `⚠️ ${err.message || 'Error sending chat invite'}`;
      }
    }
  };

  function renderAosShareChatTargets(mid, threads, searchedUsers, queryStr) {
    const listEl = document.getElementById('gt-share-chat-list');
    if (!listEl) return;
    const token = getAuthToken();
    if (!token) {
      listEl.innerHTML = `
        <div style="padding:14px; text-align:center; color:#94a3b8; font-size:12px; background:#070b14; border:1px dashed #334155; border-radius:10px;">
          🔒 Sign in to an OmniTactica account to send interactive room cards in Chat, or use <b>Copy Link</b> above to share with anyone!
        </div>
      `;
      return;
    }

    const q = (queryStr || '').trim().toLowerCase();
    const items = [];
    const seenUserIds = new Set();

    (threads || []).forEach(r => {
      if (!r || r.status === 'declined') return;
      const isGroup = r.is_group || String(r.id || '').startsWith('grp_');
      const name = isGroup
        ? (r.receiver_name || 'Group Chat')
        : (r.receiver_name || r.sender_name || 'Player');
      const sub = isGroup
        ? (r.group_type === 'league' ? '🏆 League Chat' : '⚔️ Pod Group Chat')
        : (r.receiver_factions || r.sender_factions || 'OmniTactica Player Chat');
      if (q && !name.toLowerCase().includes(q) && !sub.toLowerCase().includes(q)) return;
      items.push({
        requestId: r.id,
        receiverId: null,
        name: name,
        subtitle: sub,
        badge: isGroup ? 'GROUP' : 'CHAT'
      });
    });

    (searchedUsers || []).forEach(u => {
      if (!u || !u.id || seenUserIds.has(u.id)) return;
      seenUserIds.add(u.id);
      items.push({
        requestId: null,
        receiverId: u.id,
        name: u.display_name || 'Player',
        subtitle: [u.factions, u.location_name].filter(Boolean).join(' • ') || 'OmniTactica Player',
        badge: 'PLAYER'
      });
    });

    if (items.length === 0) {
      listEl.innerHTML = `
        <div style="padding:14px; text-align:center; color:#94a3b8; font-size:12px; background:#070b14; border:1px solid #1e293b; border-radius:10px;">
          ${q ? `No players or chats matching "${escapeHtml(queryStr)}".` : 'No active chats yet. Type a player name above to search OmniTactica players!'}
        </div>
      `;
      return;
    }

    listEl.innerHTML = items.slice(0, 15).map(item => `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; background:#070b14; border:1px solid #1e293b; border-radius:10px; padding:9px 12px;">
        <div style="min-width:0; text-align:left;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:12.5px; font-weight:800; color:#f8fafc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.name)}</span>
            <span style="font-size:9.5px; font-weight:800; padding:1px 6px; border-radius:4px; font-family:'JetBrains Mono',monospace; background:${item.badge === 'GROUP' ? 'rgba(245,158,11,0.16)' : 'rgba(56,189,248,0.14)'}; color:${item.badge === 'GROUP' ? '#fbbf24' : '#38bdf8'};">${item.badge}</span>
          </div>
          <div style="font-size:11px; color:#64748b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:1px;">${escapeHtml(item.subtitle)}</div>
        </div>
        <button type="button" onclick="window.__sendRoomInviteToChat('${escapeHtml(mid)}', { requestId: '${escapeHtml(item.requestId || '')}', receiverId: '${escapeHtml(item.receiverId || '')}', targetLabel: '${escapeHtml(item.name)}' }, this)" style="background:#0284c7; color:#fff; border:1px solid #38bdf8; border-radius:8px; padding:6px 11px; font-size:11px; font-weight:800; cursor:pointer; font-family:'JetBrains Mono',monospace; white-space:nowrap; flex-shrink:0;">
          📨 Send Invite
        </button>
      </div>
    `).join('');
  }

  window.__openShareRoomModal = async function (mid) {
    const activeMid = mid || matchId || '';
    if (!activeMid) {
      alert('No active Match Room ID found.');
      return;
    }
    const shareUrl = getCleanRoomShareUrl(activeMid);
    const scorecardUrl = `${window.location.origin}/scorecard/${encodeURIComponent(activeMid)}`;

    let modal = document.getElementById('gt-share-room-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'gt-share-room-modal';
    modal.style.cssText = "position:fixed; inset:0; z-index:1000000; background:rgba(4,7,14,0.92); backdrop-filter:blur(14px); display:flex; align-items:center; justify-content:center; padding:14px; font-family:'Inter',sans-serif; box-sizing:border-box;";
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.innerHTML = `
      <div style="background:#0e1526; border:1px solid #1e293b; border-radius:20px; width:100%; max-width:520px; max-height:92vh; display:flex; flex-direction:column; box-shadow:0 25px 70px rgba(0,0,0,0.88); overflow:hidden; color:#f8fafc; box-sizing:border-box;">
        <div style="padding:16px 20px; background:#090f1e; border-bottom:1px solid #1e293b; display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:22px;">🔗</span>
            <div style="text-align:left;">
              <h2 style="font-size:16px; font-weight:800; color:#f8fafc; font-family:'JetBrains Mono',monospace; margin:0; letter-spacing:0.03em;">SHARE MATCH ROOM</h2>
              <div style="font-size:11px; color:#f59e0b; font-family:'JetBrains Mono',monospace;">AoS Room #${escapeHtml(activeMid)} • Guest &amp; Multi-Device Ready</div>
            </div>
          </div>
          <button type="button" onclick="document.getElementById('gt-share-room-modal').remove()" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; width:30px; height:30px; border-radius:8px; cursor:pointer; font-size:15px;">✕</button>
        </div>

        <div style="padding:18px 20px; overflow-y:auto; display:flex; flex-direction:column; gap:16px;">
          <div style="background:#090f1e; border:1px solid rgba(245,158,11,0.35); border-radius:14px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
              <span style="font-size:11.5px; font-weight:800; color:#f59e0b; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">1. Share via Direct Link or Room Key</span>
              <span style="font-size:10px; font-weight:700; color:#10b981; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.3); padding:2px 7px; border-radius:999px;">✓ No Account Required for P2</span>
            </div>
            <p style="font-size:11.5px; color:#94a3b8; margin:0 0 10px; line-height:1.45; text-align:left;">
              Your opponent can open this link in any browser without signing in to join as <b>Player 2 (Guest)</b>. Once both seats are filled, any 3rd+ person opening the link is automatically routed to the <b>Real-Time Spectator Scorecard</b>.
            </p>
            <div style="display:flex; gap:8px; margin-bottom:8px;">
              <input id="gt-share-modal-url-input" readonly value="${shareUrl}" style="flex:1; min-width:0; background:#070b14; border:1px solid #334155; border-radius:8px; padding:9px 10px; font-size:11px; color:#e2e8f0; font-family:'JetBrains Mono',monospace; outline:none;" onclick="this.select()" />
              <button type="button" id="gt-share-copy-link-btn" onclick="window.__copyRoomShareLink('${escapeHtml(activeMid)}', this)" style="background:#f59e0b; color:#090d16; font-weight:800; font-size:11px; border:none; padding:9px 14px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace; white-space:nowrap;">
                📋 COPY LINK
              </button>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" id="gt-share-copy-key-btn" onclick="navigator.clipboard.writeText('${escapeHtml(activeMid)}'); this.innerHTML='✅ KEY COPIED!'; setTimeout(()=>this.innerHTML='🔑 Copy Key (${escapeHtml(activeMid)})', 1600);" style="flex:1; background:#1e293b; color:#f8fafc; border:1px solid #334155; border-radius:8px; padding:7px 10px; font-size:11px; font-weight:700; cursor:pointer; font-family:'JetBrains Mono',monospace;">
                🔑 Copy Key (${escapeHtml(activeMid)})
              </button>
              <button type="button" id="gt-share-copy-spectator-btn" onclick="navigator.clipboard.writeText('${scorecardUrl}'); this.innerHTML='✅ SCORECARD LINK COPIED!'; setTimeout(()=>this.innerHTML='👀 Copy Spectator Scorecard Link', 1600);" style="flex:1; background:#1e293b; color:#38bdf8; border:1px solid rgba(56,189,248,0.35); border-radius:8px; padding:7px 10px; font-size:11px; font-weight:700; cursor:pointer; font-family:'JetBrains Mono',monospace;">
                👀 Copy Spectator Scorecard Link
              </button>
            </div>
          </div>

          <div style="background:#090f1e; border:1px solid rgba(56,189,248,0.35); border-radius:14px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
              <span style="font-size:11.5px; font-weight:800; color:#38bdf8; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">2. Share in OmniTactica Chat</span>
              <span style="font-size:10px; color:#94a3b8;">Direct &amp; League/Pod Chats</span>
            </div>
            <div id="gt-share-modal-status" style="display:none; margin-bottom:10px; padding:8px 11px; border-radius:8px; font-size:11.5px; font-weight:600; text-align:left;"></div>
            <div style="margin-bottom:10px;">
              <input id="gt-share-chat-search" type="text" placeholder="Search opponent name, active chat, or league group..." style="width:100%; box-sizing:border-box; background:#070b14; border:1px solid #334155; border-radius:8px; padding:8px 11px; font-size:12px; color:#f8fafc; outline:none;" />
            </div>
            <div id="gt-share-chat-list" style="display:flex; flex-direction:column; gap:7px; max-height:210px; overflow-y:auto;">
              <div style="padding:12px; text-align:center; color:#94a3b8; font-size:12px;">Loading your OmniTactica chats...</div>
            </div>
          </div>

          <div style="background:rgba(56,189,248,0.07); border:1px solid rgba(56,189,248,0.22); border-radius:10px; padding:10px 12px; font-size:11px; color:#cbd5e1; line-height:1.45; text-align:left;">
            📱 <b>Using an iPad + Phone?</b> Sign into the same OmniTactica account on both devices and open this room. Both devices sync live as <b>your player seat</b> without taking Player 2's slot.
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const token = getAuthToken();
    const searchInput = document.getElementById('gt-share-chat-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value || '';
        renderAosShareChatTargets(activeMid, _aosShareChatThreadsCache, [], q);
        if (_aosShareUserSearchTimer) clearTimeout(_aosShareUserSearchTimer);
        if (q.trim().length >= 1 && token) {
          _aosShareUserSearchTimer = setTimeout(async () => {
            try {
              const uResp = await fetch(`/api/connect/users/search?q=${encodeURIComponent(q.trim())}`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              if (uResp.ok) {
                const uData = await uResp.json();
                renderAosShareChatTargets(activeMid, _aosShareChatThreadsCache, uData.users || [], q);
              }
            } catch (e) {}
          }, 220);
        }
      });
    }

    if (!token) {
      renderAosShareChatTargets(activeMid, [], [], '');
      return;
    }

    try {
      const resp = await fetch('/api/connect/requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        _aosShareChatThreadsCache = (data && data.requests) ? data.requests : [];
      }
    } catch (e) {}
    renderAosShareChatTargets(activeMid, _aosShareChatThreadsCache, [], searchInput ? searchInput.value : '');
  };

  function hideAosLoadingOverlay() {
    if (document.body) {
      document.body.classList.add('gt-role-verified');
    }
    const overlay = document.getElementById('gt-loading-overlay');
    if (overlay) {
      overlay.classList.add('gt-loading-hidden');
      overlay.style.opacity = '0';
      overlay.style.visibility = 'hidden';
      overlay.style.pointerEvents = 'none';
    }
  }

  function updateAosLoadingOverlay(title, subtitle) {
    const tEl = document.getElementById('gt-loading-title');
    const sEl = document.getElementById('gt-loading-subtitle');
    if (tEl && title) tEl.textContent = title;
    if (sEl && subtitle) sEl.textContent = subtitle;
  }

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

      // 1. Direct Cloud Firestore broadcast if client SDK is active (use .update so deleted rooms are never resurrected)
      try {
        const db = getTrackerFirestoreDb();
        if (db && matchId) {
          db.collection('rooms').doc(matchId).update({
            match_id: matchId,
            game_system: 'aos',
            version: ver,
            state: state,
            is_finished: !!state.is_finished,
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
          }).catch(() => {});
        }
      } catch (e) {}

      // 2. Local REST dev_server & PostgreSQL persistent storage
      try {
        const token = getAuthToken();
        const guestId = getOrCreateGuestId();
        await fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/state`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(guestId ? { 'X-Guest-Id': guestId } : {})
          },
          body: JSON.stringify({
            match_id: matchId,
            game_system: 'aos',
            version: ver,
            state,
            guest_id: guestId
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
          if (data) {
            let hudUpdated = false;
            const p1List = data.p1_army_list || (data.rosters && data.rosters.player1);
            const p2List = data.p2_army_list || (data.rosters && data.rosters.player2);
            if (p1List && (!aosListState.p1ArmyList || aosListState.p1ArmyList.list_key !== p1List.list_key)) {
              aosListState.p1ArmyList = p1List;
              hudUpdated = true;
            }
            if (p2List && (!aosListState.p2ArmyList || aosListState.p2ArmyList.list_key !== p2List.list_key)) {
              aosListState.p2ArmyList = p2List;
              hudUpdated = true;
            }
            if (hudUpdated) injectAosSyncHUD();
          }
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
        if (data) {
          let hudUpdated = false;
          if (data.p1_army_list && (!aosListState.p1ArmyList || aosListState.p1ArmyList.list_key !== data.p1_army_list.list_key)) {
            aosListState.p1ArmyList = data.p1_army_list;
            hudUpdated = true;
          }
          if (data.p2_army_list && (!aosListState.p2ArmyList || aosListState.p2ArmyList.list_key !== data.p2_army_list.list_key)) {
            aosListState.p2ArmyList = data.p2_army_list;
            hudUpdated = true;
          }
          if (hudUpdated) injectAosSyncHUD();
        }
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

  async function initAosRoomAccess() {
    if (isSpectator && matchId) {
      updateAosLoadingOverlay('👀 Spectator Mode Detected', 'Opening Live Digital Scorecard...');
      window.location.replace(`/scorecard/${encodeURIComponent(matchId)}`);
      return;
    }

    if (matchId) {
      // Strip &role=... from browser URL bar so copied/shared links only have ?match_id=...
      try {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.set('match_id', matchId);
        cleanUrl.searchParams.delete('role');
        cleanUrl.searchParams.delete('mode');
        window.history.replaceState({}, '', cleanUrl.toString());
      } catch (e) {}

      // Fast-path handoff when arriving directly from Lobby Create/Join Room:
      // Avoid showing a redundant second loading screen or blocking on /check + /join.
      try {
        const rawHandoff = sessionStorage.getItem('gt_room_handoff');
        if (rawHandoff) {
          const handoff = JSON.parse(rawHandoff);
          if (
            handoff &&
            handoff.matchId &&
            handoff.matchId.toUpperCase() === matchId.toUpperCase() &&
            Date.now() - (handoff.ts || 0) < 15000
          ) {
            sessionStorage.removeItem('gt_room_handoff');
            role = handoff.role || 'player1';
            if (handoff.state) {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(handoff.state));
            }
            hideAosLoadingOverlay();
            injectAosSyncHUD();
            injectMobileBottomDock();
            initFirestoreDirectSync();
            loadAosRoomArmyLists();
            setInterval(() => {
              if (!firestoreConnected) {
                syncFromRemote();
              }
            }, 1000);
            return;
          }
        }
      } catch (e) {}

      const token = getAuthToken();
      const guestId = getOrCreateGuestId();
      try {
        const chk = await fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/check?guest_id=${encodeURIComponent(guestId)}`, {
          headers: {
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(guestId ? { 'X-Guest-Id': guestId } : {})
          }
        });
        if (chk.ok) {
          const chkData = await chk.json();
          if (chkData.is_finished || (!chkData.is_referee && chkData.role !== 'referee' && (chkData.is_spectator || chkData.role === 'spectator' || (chkData.is_full && !chkData.is_open_for_p2)))) {
            updateAosLoadingOverlay('👀 Spectator Mode Detected', 'Room has 2 active players — redirecting to Live Digital Scorecard...');
            window.location.replace(`/scorecard/${encodeURIComponent(matchId)}`);
            return;
          }
        }
      } catch (e) {}

      try {
        const joinResp = await fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/join`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(guestId ? { 'X-Guest-Id': guestId } : {})
          },
          body: JSON.stringify({ token: token || undefined, guest_id: guestId || undefined })
        });
        if (joinResp.ok) {
          const joinData = await joinResp.json();
          if (joinData.is_finished || joinData.role === 'spectator') {
            updateAosLoadingOverlay('👀 Spectator Mode Detected', 'Room has 2 active players — redirecting to Live Digital Scorecard...');
            window.location.replace(`/scorecard/${encodeURIComponent(matchId)}`);
            return;
          }
          if (joinData.role) {
            role = joinData.role;
          }
        }
      } catch (e) {}

      initFirestoreDirectSync();
      await syncFromRemote();
      await loadAosRoomArmyLists();
      setInterval(() => {
        if (!firestoreConnected) {
          syncFromRemote();
        }
      }, 1000);
    } else {
      await loadAosRoomArmyLists();
    }

    hideAosLoadingOverlay();
    injectAosSyncHUD();
    injectMobileBottomDock();
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
              let displayVal = die.rolled ? die.val : '•';
              if (die.rolled && die.val === 6) {
                const activeSkin = (window.Armory && typeof window.Armory.getEquipped === 'function' ? window.Armory.getEquipped('active_dice', 'aos') : null) || localStorage.getItem('omnitactica_active_dice_aos');
                const eqItem = (window.Armory && typeof window.Armory.getEquippedItem === 'function' ? (window.Armory.getEquippedItem('active_dice', 'aos') || window.Armory.getEquippedItem(activeSkin, 'aos')) : null) || (window.getFallbackDiceMetadata ? window.getFallbackDiceMetadata(activeSkin) : null);
                const svgId = eqItem && eqItem.payload ? eqItem.payload.six_face_svg_id : null;
                if (svgId && typeof window.getArmoryAvatarSvg === 'function') {
                  const svg = window.getArmoryAvatarSvg(svgId);
                  if (svg) {
                    displayVal = `<span class="gt-die-faction-six-sigil" title="Faction Critical 6: ${escapeHtml((eqItem.payload && eqItem.payload.six_face_label) || 'Faction Sigil')}">${svg}</span>`;
                  }
                }
              }
              return `<span class="gt-die-pip ${cls} ${selCls}" onclick="window.gtToggleDieSelection(${idx})">${displayVal}</span>`;
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
        const token = getAuthToken();
        const guestId = getOrCreateGuestId();
        await fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/finalize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(guestId ? { 'X-Guest-Id': guestId } : {})
          },
          body: JSON.stringify({ state, guest_id: guestId })
        });
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

  // 5. Army Lists Modal (NewRecruit Single Source of Truth + Play Mode)
  const AOS_FACTION_LOOKUP = [
    { id: 'stormcast-eternals', name: 'Stormcast Eternals', grandAlliance: 'Order', aliases: ['stormcast'] },
    { id: 'cities-of-sigmar', name: 'Cities of Sigmar', grandAlliance: 'Order', aliases: ['cities'] },
    { id: 'daughters-of-khaine', name: 'Daughters of Khaine', grandAlliance: 'Order', aliases: ['dok', 'khaine'] },
    { id: 'fyreslayers', name: 'Fyreslayers', grandAlliance: 'Order', aliases: [] },
    { id: 'idoneth-deepkin', name: 'Idoneth Deepkin', grandAlliance: 'Order', aliases: ['idoneth', 'deepkin'] },
    { id: 'kharadron-overlords', name: 'Kharadron Overlords', grandAlliance: 'Order', aliases: ['kharadron'] },
    { id: 'lumineth-realm-lords', name: 'Lumineth Realm-lords', grandAlliance: 'Order', aliases: ['lumineth'] },
    { id: 'seraphon', name: 'Seraphon', grandAlliance: 'Order', aliases: [] },
    { id: 'sylvaneth', name: 'Sylvaneth', grandAlliance: 'Order', aliases: [] },
    { id: 'blades-of-khorne', name: 'Blades of Khorne', grandAlliance: 'Chaos', aliases: ['khorne'] },
    { id: 'disciples-of-tzeentch', name: 'Disciples of Tzeentch', grandAlliance: 'Chaos', aliases: ['tzeentch'] },
    { id: 'hedonites-of-slaanesh', name: 'Hedonites of Slaanesh', grandAlliance: 'Chaos', aliases: ['slaanesh', 'hedonites'] },
    { id: 'maggotkin-of-nurgle', name: 'Maggotkin of Nurgle', grandAlliance: 'Chaos', aliases: ['nurgle', 'maggotkin'] },
    { id: 'skaven', name: 'Skaven', grandAlliance: 'Chaos', aliases: [] },
    { id: 'slaves-to-darkness', name: 'Slaves to Darkness', grandAlliance: 'Chaos', aliases: ['s2d', 'std'] },
    { id: 'beasts-of-chaos', name: 'Beasts of Chaos', grandAlliance: 'Chaos', aliases: ['boc'] },
    { id: 'helsmiths-of-hashut', name: 'Helsmiths of Hashut', grandAlliance: 'Chaos', aliases: ['hashut', 'helsmiths'] },
    { id: 'flesh-eater-courts', name: 'Flesh-eater Courts', grandAlliance: 'Death', aliases: ['fec', 'flesh-eater'] },
    { id: 'nighthaunt', name: 'Nighthaunt', grandAlliance: 'Death', aliases: [] },
    { id: 'ossiarch-bonereapers', name: 'Ossiarch Bonereapers', grandAlliance: 'Death', aliases: ['obr', 'ossiarch'] },
    { id: 'soulblight-gravelords', name: 'Soulblight Gravelords', grandAlliance: 'Death', aliases: ['sbgl', 'soulblight'] },
    { id: 'gloomspite-gitz', name: 'Gloomspite Gitz', grandAlliance: 'Destruction', aliases: ['gitz', 'gloomspite'] },
    { id: 'ironjawz', name: 'Ironjawz', grandAlliance: 'Destruction', aliases: [] },
    { id: 'kruleboyz', name: 'Kruleboyz', grandAlliance: 'Destruction', aliases: [] },
    { id: 'orruk-warclans', name: 'Orruk Warclans', grandAlliance: 'Destruction', aliases: ['big waaagh', 'orruks'] },
    { id: 'bonesplitterz', name: 'Bonesplitterz', grandAlliance: 'Destruction', aliases: [] },
    { id: 'ogor-mawtribes', name: 'Ogor Mawtribes', grandAlliance: 'Destruction', aliases: ['ogors', 'mawtribes'] },
    { id: 'sons-of-behemat', name: 'Sons of Behemat', grandAlliance: 'Destruction', aliases: ['behemat', 'gargants'] }
  ];

  function resolveAosFactionAndFormation(rawFaction, rawDetachment) {
    let facStr = String(rawFaction || '').trim();
    let detStr = String(rawDetachment || '').trim();
    let aorSub = '';
    if (facStr.includes(' - ')) {
      const parts = facStr.split(' - ');
      facStr = parts[0].trim();
      aorSub = parts.slice(1).join(' - ').trim();
    }
    const cleanFac = facStr.toLowerCase().replace(/^(order|chaos|death|destruction)\s*-\s*/i, '').trim();
    const slugFac = cleanFac.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    let matched = AOS_FACTION_LOOKUP.find(f =>
      f.id === slugFac ||
      f.name.toLowerCase() === cleanFac ||
      f.aliases.some(a => cleanFac.includes(a))
    );
    if (!matched) {
      matched = AOS_FACTION_LOOKUP.find(f => cleanFac.includes(f.name.toLowerCase()) || f.name.toLowerCase().includes(cleanFac));
    }
    let finalFormation = detStr;
    if (!finalFormation || finalFormation === 'Core Detachment' || finalFormation === 'Battle Formation' || finalFormation === 'Standard') {
      if (aorSub) finalFormation = aorSub;
    }
    return {
      factionId: matched ? matched.id : null,
      factionName: matched ? matched.name : (facStr || 'Stormcast Eternals'),
      grandAlliance: matched ? matched.grandAlliance : null,
      battleFormation: finalFormation || ''
    };
  }

  function applyAttachedAosListToGameState(targetRole, attachedList) {
    if (!attachedList || typeof attachedList !== 'object') return;
    try {
      const st = getAosState();
      if (!st) return;
      const pKey = targetRole === 'player2' ? 'p2' : 'p1';
      if (!st[pKey]) return;
      const resolved = resolveAosFactionAndFormation(attachedList.faction, attachedList.detachment);
      let changed = false;
      if (resolved.factionId && st[pKey].faction !== resolved.factionId) {
        st[pKey].faction = resolved.factionId;
        changed = true;
      }
      if (resolved.grandAlliance && st[pKey].grandAlliance !== resolved.grandAlliance) {
        st[pKey].grandAlliance = resolved.grandAlliance;
        changed = true;
      }
      if (resolved.battleFormation && st[pKey].battleFormation !== resolved.battleFormation) {
        st[pKey].battleFormation = resolved.battleFormation;
        changed = true;
      }
      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
        window.dispatchEvent(new CustomEvent('aos_remote_sync', { detail: st }));
        broadcastAosState();
      }
    } catch (e) {}
  }

  function isAosListCandidate(item) {
    if (!item || typeof item !== 'object') return false;
    const gs = String(item.game_system || item.gameSystem || '').toLowerCase();
    if (gs === 'aos' || gs.includes('sigmar')) return true;
    const sysId = String((item.nr_row && item.nr_row.id_system) || item.id_system || '');
    if (sysId === '4255553472') return true;
    const resolved = resolveAosFactionAndFormation(item.faction, item.detachment);
    return Boolean(resolved.factionId);
  }

  async function loadAosRoomArmyLists() {
    try {
      if (matchId) {
        const resp = await fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/armylists`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.p1_army_list) {
            aosListState.p1ArmyList = data.p1_army_list;
            try { sessionStorage.setItem('omni_aos_p1_army_list', JSON.stringify(data.p1_army_list)); } catch (e) {}
          }
          if (data.p2_army_list) {
            aosListState.p2ArmyList = data.p2_army_list;
            try { sessionStorage.setItem('omni_aos_p2_army_list', JSON.stringify(data.p2_army_list)); } catch (e) {}
          }
        }
      }
      // Auto-attach preloaded list from My Hub ("⚔️ Play") if current seat has no list yet
      const isP1 = role !== 'player2';
      const myCurrentList = isP1 ? aosListState.p1ArmyList : aosListState.p2ArmyList;
      if (!myCurrentList && !isSpectator) {
        const preloadedRaw = sessionStorage.getItem('omni_preloaded_list') || localStorage.getItem('omni_preloaded_list');
        if (preloadedRaw) {
          try {
            const preloadedList = JSON.parse(preloadedRaw);
            if (preloadedList && (preloadedList.id || preloadedList.list_key || preloadedList.name) && isAosListCandidate(preloadedList)) {
              sessionStorage.removeItem('omni_preloaded_list');
              localStorage.removeItem('omni_preloaded_list');
              await window.gtAttachList(preloadedList, isP1 ? 'player1' : 'player2', { silent: true });
            }
          } catch (err) {}
        }
      }
      injectAosSyncHUD();
    } catch (e) {}
  }

  function resolveTrackerNrListKey(list) {
    if (!list) return 'roster';
    const rawKey = String(
      list.list_key ||
      (list.nr_row && list.nr_row.list_key) ||
      list.id ||
      'roster'
    ).trim();
    return rawKey.startsWith('nr_') ? rawKey.slice(3) : rawKey;
  }

  window.gtOpenArmyListModal = function(tab, targetRoleOverride) {
    const isP1 = role !== 'player2';
    if (targetRoleOverride === 'player1' || targetRoleOverride === 'player2') {
      aosListState.attachTargetRole = targetRoleOverride;
    } else if (!aosListState.attachTargetRole) {
      aosListState.attachTargetRole = isP1 ? 'player1' : 'player2';
    }
    const hasMyList = isP1 ? !!aosListState.p1ArmyList : !!aosListState.p2ArmyList;
    const hasOppList = isP1 ? !!aosListState.p2ArmyList : !!aosListState.p1ArmyList;
    if (!tab) {
      tab = hasMyList ? 'my' : (hasOppList ? 'opponent' : 'attach');
    }
    aosListState.activeListTab = tab;
    let modal = document.getElementById('gt-army-list-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'gt-army-list-modal';
      document.body.appendChild(modal);
    }
    modal.style.cssText = 'position:fixed; inset:0; z-index:100005; background:rgba(2,6,23,0.92); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; padding:3px; box-sizing:border-box;';
    renderArmyListModal();
  };

  window.gtCloseArmyListModal = function() {
    const modal = document.getElementById('gt-army-list-modal');
    if (modal) modal.style.display = 'none';
  };

  window.gtSetListTab = function(tab) {
    aosListState.activeListTab = tab;
    renderArmyListModal();
  };

  window.gtSetAosAttachTarget = function(targetRole) {
    if (targetRole === 'player1' || targetRole === 'player2') {
      aosListState.attachTargetRole = targetRole;
      renderArmyListModal();
    }
  };

  window.gtAttachList = async function(listData, explicitRole, opts = {}) {
    try {
      const effectiveMatchId = matchId || 'AOS-LOCAL';
      const isP1 = role !== 'player2';
      const targetRole = explicitRole || aosListState.attachTargetRole || (isP1 ? 'player1' : 'player2');
      const payloadList = Object.assign({}, listData, {
        game_system: 'aos',
        system_edition: listData.system_edition || 'AoS 4.0'
      });
      const resp = await fetch(`/api/tracker/room/${encodeURIComponent(effectiveMatchId)}/armylist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getAuthToken() ? { 'Authorization': `Bearer ${getAuthToken()}` } : {}),
          ...(getOrCreateGuestId() ? { 'X-Guest-Id': getOrCreateGuestId() } : {})
        },
        body: JSON.stringify({ role: targetRole, army_list: payloadList, guest_id: getOrCreateGuestId() })
      });
      let attachedList = payloadList;
      if (resp.ok) {
        const resData = await resp.json().catch(() => ({}));
        if (resData && resData.army_list) {
          attachedList = resData.army_list;
        }
      }
      if (targetRole === 'player2') {
        aosListState.p2ArmyList = attachedList;
        try { sessionStorage.setItem('omni_aos_p2_army_list', JSON.stringify(attachedList)); } catch (e) {}
      } else {
        aosListState.p1ArmyList = attachedList;
        try { sessionStorage.setItem('omni_aos_p1_army_list', JSON.stringify(attachedList)); } catch (e) {}
      }
      applyAttachedAosListToGameState(targetRole, attachedList);
      const myRole = isP1 ? 'player1' : 'player2';
      aosListState.activeListTab = (targetRole === myRole) ? 'my' : 'opponent';
      aosListState.rosterViewMode = 'play';
      injectAosSyncHUD();
      if (!opts.silent) {
        renderArmyListModal();
      }
    } catch (e) {
      if (!opts.silent) {
        alert('Error attaching army list: ' + e.message);
      }
    }
  };

  window.gtAttachSavedList = async function(listId) {
    const cleanTarget = String(listId || '').replace(/^(nr_|list_)/, '').trim();
    const list = (window.gtSavedListsCache || []).find(l =>
      l && (
        l.id === listId ||
        l.list_key === listId ||
        resolveTrackerNrListKey(l) === cleanTarget
      )
    );
    if (!list) {
      alert('Could not locate the selected list.');
      return;
    }
    await window.gtAttachList(list);
  };

  function generateTrackerRawRosterText(list) {
    if (list.raw_text && list.raw_text.trim().length > 10) {
      return list.raw_text.trim();
    }
    let out = `${list.faction || 'Age of Sigmar'} - ${list.detachment || 'Battle Formation'} (${list.points || 2000} pts)\n\n`;
    const units = list.units || [];
    const groups = {};
    for (const u of units) {
      const roleName = (u.role || 'Warscrolls').toUpperCase();
      if (!groups[roleName]) groups[roleName] = [];
      groups[roleName].push(u);
    }
    for (const [roleName, uList] of Object.entries(groups)) {
      out += `+ ${roleName} +\n`;
      for (const u of uList) {
        const cnt = u.model_count && u.model_count > 1 ? `${u.model_count}x ` : '';
        out += `${cnt}${u.name} [${u.points || 0} pts]`;
        const tags = [];
        if (u.is_warlord) tags.push('General');
        if (u.enhancement) tags.push(`Enhancement: ${u.enhancement}`);
        if (tags.length > 0) out += `: ${tags.join(', ')}`;
        out += '\n';
        if (u.wargear && u.wargear.length > 0) {
          out += `  • Options: ${u.wargear.join(', ')}\n`;
        }
      }
      out += '\n';
    }
    return out.trim();
  }

  window.gtCopyTrackerRawText = function() {
    const isP1 = role !== 'player2';
    const myList = isP1 ? aosListState.p1ArmyList : aosListState.p2ArmyList;
    const oppList = isP1 ? aosListState.p2ArmyList : aosListState.p1ArmyList;
    const activeList = aosListState.activeListTab === 'opponent' ? oppList : myList;
    if (!activeList) return;
    const rawText = generateTrackerRawRosterText(activeList);
    navigator.clipboard.writeText(rawText).then(() => {
      alert('📋 Raw AoS roster text copied to clipboard!');
    }).catch(() => {
      prompt('Copy your AoS roster text below:', rawText);
    });
  };

  window.gtToggleRosterViewMode = function(mode) {
    const prevMode = aosListState.rosterViewMode || 'play';
    aosListState.rosterViewMode = mode;
    const isP1 = role !== 'player2';
    const activeList = aosListState.activeListTab === 'opponent'
      ? (isP1 ? aosListState.p2ArmyList : aosListState.p1ArmyList)
      : (isP1 ? aosListState.p1ArmyList : aosListState.p2ArmyList);
    const iframe = document.getElementById('gt-nr-play-mode-iframe');
    if (
      iframe &&
      activeList &&
      (mode === 'play' || mode === 'edit') &&
      (prevMode === 'play' || prevMode === 'edit') &&
      aosListState.activeListTab !== 'opponent'
    ) {
      const listKey = resolveTrackerNrListKey(activeList);
      if (iframe.getAttribute('data-list-key') === listKey && iframe.contentWindow) {
        iframe.setAttribute('data-play-mode', mode === 'play' ? '1' : '0');
        const playBtn = document.getElementById('gt-mode-btn-play');
        const editBtn = document.getElementById('gt-mode-btn-edit');
        const textBtn = document.getElementById('gt-mode-btn-text');
        if (playBtn) {
          playBtn.style.background = mode === 'play' ? '#0284c7' : 'transparent';
          playBtn.style.color = mode === 'play' ? '#fff' : '#94a3b8';
        }
        if (editBtn) {
          editBtn.style.background = mode === 'edit' ? '#7c3aed' : 'transparent';
          editBtn.style.color = mode === 'edit' ? '#fff' : '#94a3b8';
        }
        if (textBtn) {
          textBtn.style.background = 'transparent';
          textBtn.style.color = '#94a3b8';
        }
        try {
          iframe.contentWindow.postMessage({
            type: 'OMNITACTICA_NR_COMMAND',
            command: 'open_play_mode',
            list_key: listKey,
            list_name: activeList.name || '',
            play: mode === 'play',
            ephemeral: false
          }, '*');
        } catch (e) {}
        return;
      }
    }
    renderArmyListModal();
  };

  async function readTrackerSameOriginNrRows() {
    const rowsByKey = new Map();
    try {
      let hasNrDb = true;
      if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
        const dbs = await indexedDB.databases();
        const nrMeta = (dbs || []).find(d => d && d.name === 'nr');
        if (!nrMeta) hasNrDb = false;
      }
      if (hasNrDb && typeof indexedDB !== 'undefined') {
        await new Promise(resolve => {
          let settled = false;
          let dbRef = null;
          const done = () => {
            if (settled) return;
            settled = true;
            if (dbRef) {
              try { dbRef.close(); } catch (e) {}
            }
            resolve();
          };
          setTimeout(done, 800);
          const req = indexedDB.open('nr');
          req.onupgradeneeded = (ev) => {
            try { ev.target.transaction.abort(); } catch (e) {}
            done();
          };
          req.onsuccess = () => {
            const db = req.result;
            dbRef = db;
            if (!db || !db.objectStoreNames || !db.objectStoreNames.contains('lists')) {
              done();
              return;
            }
            try {
              const tx = db.transaction('lists', 'readonly');
              const store = tx.objectStore('lists');
              const allReq = store.getAll();
              allReq.onsuccess = () => {
                const allRows = allReq.result || [];
                for (const r of allRows) {
                  if (r && (r.list_key || r._id) && !r._ephemeral_view && !r.deleted && !r.trashed) {
                    const lk = String(r.list_key || r._id).replace(/^(nr_|list_)/, '').trim();
                    if (lk && !rowsByKey.has(lk)) {
                      rowsByKey.set(lk, r);
                    }
                  }
                }
                done();
              };
              allReq.onerror = done;
            } catch (e) {
              done();
            }
          };
          req.onerror = done;
          req.onblocked = done;
        });
      }
    } catch (e) {}
    return Array.from(rowsByKey.values());
  }

  async function fetchTrackerAosNewRecruitLists() {
    const mergedMap = new Map();
    const addItem = (item) => {
      if (!item || typeof item !== 'object') return;
      if (!isAosListCandidate(item)) return;
      const lk = String(item.list_key || (item.nr_row && item.nr_row.list_key) || item.id || '').replace(/^(nr_|list_)/, '').trim();
      if (!lk) return;
      if (!mergedMap.has(lk)) {
        mergedMap.set(lk, item);
      } else if (item.source_format && String(item.source_format).includes('Cloud')) {
        mergedMap.get(lk).source_format = item.source_format;
      }
    };
    const authTok = getAuthToken();
    const nrAccess = (typeof localStorage !== 'undefined' && localStorage.getItem('access')) || '';
    const localRows = await readTrackerSameOriginNrRows();
    const [localSyncRes, cloudRes] = await Promise.all([
      localRows.length > 0
        ? fetch('/api/armylists/nr_sync', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authTok ? { 'Authorization': `Bearer ${authTok}` } : {})
            },
            body: JSON.stringify({ action: 'bulk_sync', lists: localRows })
          }).then(r => r.ok ? r.json() : null).catch(() => null)
        : Promise.resolve(null),
      fetch('/api/armylists?game_system=aos', {
        headers: {
          ...(authTok ? { 'Authorization': `Bearer ${authTok}` } : {}),
          ...(nrAccess ? { 'X-NR-Access': nrAccess } : {})
        }
      }).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);
    if (localSyncRes && Array.isArray(localSyncRes.army_lists)) {
      localSyncRes.army_lists.forEach(addItem);
    }
    if (cloudRes && Array.isArray(cloudRes.army_lists)) {
      cloudRes.army_lists.forEach(addItem);
    }
    return Array.from(mergedMap.values());
  }

  window.gtImportAndAttach = async function() {
    const textarea = document.getElementById('gt-import-raw-input');
    if (!textarea || !textarea.value.trim()) {
      alert('Please paste your NewRecruit share link or Age of Sigmar army roster text.');
      return;
    }
    const rawText = textarea.value.trim();
    try {
      const isUrl = /^https?:\/\//i.test(rawText) && rawText.toLowerCase().includes('newrecruit');
      const parseResp = await fetch('/api/armylists/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUrl ? { url: rawText, text: rawText, game_system: 'aos' } : { text: rawText, game_system: 'aos' })
      });
      if (!parseResp.ok) throw new Error('Failed to parse AoS roster');
      const pData = await parseResp.json();
      const armyList = pData.army_list || {};
      armyList.game_system = 'aos';
      armyList.system_edition = armyList.system_edition || 'AoS 4.0';

      await window.gtAttachList(armyList);
    } catch (e) {
      alert('Parse error: ' + e.message);
    }
  };

  function renderSavedListsGridInTracker(lists) {
    const grid = document.getElementById('gt-saved-lists-grid');
    if (!grid) return;
    if (!Array.isArray(lists) || lists.length === 0) {
      grid.innerHTML = `<div style="color:#64748b; font-size:12px; grid-column:1/-1;">No saved Age of Sigmar lists found yet. Paste a NewRecruit link/text below or build one in My Hub's NewRecruit Studio.</div>`;
      return;
    }
    grid.innerHTML = lists.map(l => `
      <div class="gt-saved-list-card" data-list-id="${escapeHtml(l.id)}" style="background:#131d33; border:1px solid rgba(245,158,11,0.25); border-radius:10px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; gap:10px;">
        <div>
          <div style="font-weight:800; font-size:14px; color:#f8fafc;">${escapeHtml(l.name || 'Unnamed AoS List')}</div>
          <div style="font-size:12px; color:#f59e0b; font-weight:700; margin-top:2px;">${escapeHtml(l.faction || 'Age of Sigmar')} • ${escapeHtml(l.detachment || 'Battle Formation')}</div>
          <div style="font-size:11px; color:#94a3b8; margin-top:4px;">${l.points || 2000} pts • 🎮 Play Mode Ready</div>
        </div>
        <button onclick="window.gtAttachSavedList('${escapeHtml(l.id)}')" style="background:#f59e0b; color:#0f172a; font-weight:800; font-size:12px; border:none; padding:8px 12px; border-radius:6px; cursor:pointer;">
          ⚔️ Attach This List
        </button>
      </div>
    `).join('');
  }

  // Listen for live NewRecruit edits/creations/deletions inside AoS Game Tracker
  if (!window.__gtAosNrSyncListenerBound) {
    window.__gtAosNrSyncListenerBound = true;
    window.addEventListener('message', (ev) => {
      const msg = ev && ev.data;
      if (!msg || msg.type !== 'OMNITACTICA_NR_SYNC_EVENT') return;
      if (Array.isArray(msg.army_lists)) {
        const aosOnly = msg.army_lists.filter(isAosListCandidate);
        window.gtSavedListsCache = aosOnly;
        renderSavedListsGridInTracker(aosOnly);
      }
      const updated = msg.army_list;
      if (updated && typeof updated === 'object' && isAosListCandidate(updated)) {
        const uKey = resolveTrackerNrListKey(updated);
        const matchSlot = (slotObj) => {
          if (!slotObj) return false;
          return slotObj.id === updated.id || resolveTrackerNrListKey(slotObj) === uKey;
        };
        const isP1 = role !== 'player2';
        let myMatched = false;
        if (matchSlot(aosListState.p1ArmyList)) {
          const prevDet = aosListState.p1ArmyList?.detachment;
          if (prevDet && prevDet !== 'Battle Formation' && prevDet !== 'Core Detachment' && aosListState.rosterViewMode !== 'edit') {
            updated.detachment = prevDet;
          }
          aosListState.p1ArmyList = updated;
          applyAttachedAosListToGameState('player1', updated);
          if (isP1) myMatched = true;
        }
        if (matchSlot(aosListState.p2ArmyList)) {
          const prevDet = aosListState.p2ArmyList?.detachment;
          if (prevDet && prevDet !== 'Battle Formation' && prevDet !== 'Core Detachment' && aosListState.rosterViewMode !== 'edit') {
            updated.detachment = prevDet;
          }
          aosListState.p2ArmyList = updated;
          applyAttachedAosListToGameState('player2', updated);
          if (!isP1) myMatched = true;
        }
        if (myMatched && matchId && aosListState.rosterViewMode === 'edit') {
          const myRole = isP1 ? 'player1' : 'player2';
          fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/armylist`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(getAuthToken() ? { 'Authorization': `Bearer ${getAuthToken()}` } : {})
            },
            body: JSON.stringify({ role: myRole, army_list: updated })
          }).catch(() => {});
        }
        injectAosSyncHUD();
        const titleEl = document.getElementById('gt-active-roster-title');
        const metaEl = document.getElementById('gt-active-roster-meta');
        const iframeEl = document.getElementById('gt-nr-play-mode-iframe');
        const curActive = aosListState.activeListTab === 'opponent'
          ? (isP1 ? aosListState.p2ArmyList : aosListState.p1ArmyList)
          : (isP1 ? aosListState.p1ArmyList : aosListState.p2ArmyList);
        const targetList = (curActive && matchSlot(curActive))
          ? curActive
          : (iframeEl && iframeEl.getAttribute('data-list-key') === uKey ? updated : null);
        if (targetList) {
          if (titleEl) titleEl.textContent = targetList.name || 'AoS Warscroll Roster';
          if (metaEl) metaEl.textContent = `${targetList.faction || 'Age of Sigmar'} • ${targetList.detachment || 'Battle Formation'} • ${targetList.points || 2000} PTS`;
        }
      }
    });
  }

  // Listen for custom event from AosSetupWizard ("📜 Attach / View P1/P2 NewRecruit List")
  window.addEventListener('aos_open_armylist_modal', (e) => {
    const reqRole = (e && e.detail && e.detail.role) || (role !== 'player2' ? 'player1' : 'player2');
    aosListState.attachTargetRole = reqRole;
    const isP1 = role !== 'player2';
    const hasTargetList = reqRole === 'player2' ? !!aosListState.p2ArmyList : !!aosListState.p1ArmyList;
    if (hasTargetList) {
      const targetTab = (reqRole === (isP1 ? 'player1' : 'player2')) ? 'my' : 'opponent';
      window.gtOpenArmyListModal(targetTab, reqRole);
    } else {
      window.gtOpenArmyListModal('attach', reqRole);
    }
  });

  function renderTrackerNativeRoster(list) {
    const activeMode = (aosListState.rosterViewMode === 'text' || aosListState.rosterViewMode === 'edit')
      ? aosListState.rosterViewMode
      : 'play';

    const name = list.name || 'AoS Warscroll Roster';
    const faction = list.faction || 'Age of Sigmar';
    const detachment = list.detachment || 'Battle Formation';
    const points = list.points || 2000;
    const listKey = resolveTrackerNrListKey(list);

    const hiddenMetaHooks = `
      <span id="gt-active-roster-title" style="display:none;">${escapeHtml(name)}</span>
      <span id="gt-active-roster-meta" style="display:none;">${escapeHtml(faction)} • ${escapeHtml(detachment)} • ${points} PTS</span>
    `;

    if (activeMode === 'text') {
      const rawText = generateTrackerRawRosterText(list);
      return `
        ${hiddenMetaHooks}
        <div style="display:flex; flex-direction:column; padding:12px; background:#070b14; flex:1; overflow:hidden;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
            <span style="font-size:12px; font-weight:800; color:#f59e0b;">${escapeHtml(name)} • ${escapeHtml(faction)} (${points} pts)</span>
            <button onclick="window.gtCopyTrackerRawText()" style="background:#1e293b; color:#f59e0b; border:1px solid rgba(245,158,11,0.3); font-weight:800; font-size:11px; padding:4px 10px; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:5px;">
              📋 Copy Raw Text
            </button>
          </div>
          <pre style="flex:1; margin:0; background:#030712; border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:12px; font-family:'JetBrains Mono',monospace; font-size:11.5px; color:#e2e8f0; line-height:1.55; white-space:pre-wrap; overflow-y:auto; word-break:break-word;">${escapeHtml(rawText)}</pre>
        </div>
      `;
    }

    const isOppTab = aosListState.activeListTab === 'opponent';
    const isEphemeralView = Boolean(isOppTab || list._ephemeral_view || (list.nr_row && list.nr_row._ephemeral_view));
    try {
      if (list.nr_row && window.sessionStorage) {
        const rowToStore = isEphemeralView ? Object.assign({}, list.nr_row, { _ephemeral_view: true }) : list.nr_row;
        window.sessionStorage.setItem('omni_pending_nr_row_' + listKey, JSON.stringify(rowToStore));
      }
    } catch (e) {}

    const ephParam = isEphemeralView ? '&ephemeral=1' : '';
    const nameParam = list.name ? `&name=${encodeURIComponent(list.name)}` : '';
    const iframeUrl = (activeMode === 'edit' && !isOppTab)
      ? `/nr/app/Lists/${encodeURIComponent(listKey)}?embed=tracker${nameParam}`
      : `/nr/app/Lists/${encodeURIComponent(listKey)}?view=play&embed=tracker${ephParam}${nameParam}`;

    return `
      ${hiddenMetaHooks}
      <div style="flex:1; position:relative; background:#090d16; display:flex; flex-direction:column; min-height:0; height:100%; overflow:hidden;">
        <iframe
          id="gt-nr-play-mode-iframe"
          data-list-key="${escapeHtml(listKey)}"
          data-play-mode="${activeMode === 'play' ? '1' : '0'}"
          src="${iframeUrl}"
          title="NewRecruit Play Mode - AoS Warscrolls & Battle Formations"
          style="width:100%; height:100%; flex:1; border:none; display:block; background:#090d16;"
          allow="clipboard-read; clipboard-write"
        ></iframe>
      </div>
    `;
  }

  function renderArmyListModal() {
    const modal = document.getElementById('gt-army-list-modal');
    if (!modal) return;

    const st = getAosState() || {};
    const p1Name = st.p1?.name || 'Player 1';
    const p2Name = st.p2?.name || 'Player 2';
    const isP1 = role !== 'player2';
    const myList = isP1 ? aosListState.p1ArmyList : aosListState.p2ArmyList;
    const oppList = isP1 ? aosListState.p2ArmyList : aosListState.p1ArmyList;

    let activeList = null;
    if (aosListState.activeListTab === 'opponent') activeList = oppList;
    else if (aosListState.activeListTab === 'my') activeList = myList;

    const tab = aosListState.activeListTab;
    const hasActiveRoster = (tab === 'opponent' || tab === 'my') && activeList && (activeList.list_key || activeList.nr_row || activeList.source_url || activeList.raw_text || (activeList.units && activeList.units.length > 0));
    if (tab === 'opponent' && aosListState.rosterViewMode === 'edit') {
      aosListState.rosterViewMode = 'play';
    }
    const activeMode = (aosListState.rosterViewMode === 'text' || (aosListState.rosterViewMode === 'edit' && tab !== 'opponent'))
      ? aosListState.rosterViewMode
      : 'play';

    const targetSlot = aosListState.attachTargetRole || (isP1 ? 'player1' : 'player2');
    let contentHtml = '';

    if (tab === 'attach') {
      contentHtml = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:14px; padding:10px 12px; background:#0f172a; border:1px solid #273042; border-radius:10px;">
          <div style="font-size:12px; font-weight:800; color:#cbd5e1;">
            🎯 Attaching AoS Roster For:
          </div>
          <div style="display:flex; gap:6px;">
            <button type="button" onclick="window.gtSetAosAttachTarget('player1')" style="padding:5px 10px; border-radius:6px; font-size:11px; font-weight:800; border:1px solid ${targetSlot === 'player1' ? '#38bdf8' : '#334155'}; background:${targetSlot === 'player1' ? 'rgba(56,189,248,0.18)' : '#1e293b'}; color:${targetSlot === 'player1' ? '#38bdf8' : '#94a3b8'}; cursor:pointer;">
              ⚔️ ${escapeHtml(p1Name)} (P1)
            </button>
            <button type="button" onclick="window.gtSetAosAttachTarget('player2')" style="padding:5px 10px; border-radius:6px; font-size:11px; font-weight:800; border:1px solid ${targetSlot === 'player2' ? '#f43f5e' : '#334155'}; background:${targetSlot === 'player2' ? 'rgba(244,63,94,0.18)' : '#1e293b'}; color:${targetSlot === 'player2' ? '#f43f5e' : '#94a3b8'}; cursor:pointer;">
              ⚔️ ${escapeHtml(p2Name)} (P2)
            </button>
          </div>
        </div>

        <div id="gt-saved-lists-container" style="margin-bottom: 22px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
            <div>
              <h3 style="font-size:16px; font-weight:800; color:#f8fafc; margin:0;">📋 Pick from Your NewRecruit AoS Lists</h3>
              <div style="font-size:12px; color:#94a3b8; margin-top:2px;">Select any Age of Sigmar 4.0 roster from your NewRecruit Local Storage or NewRecruit Cloud account to attach &amp; sync Battle Formation.</div>
            </div>
          </div>
          <div id="gt-saved-lists-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(270px, 1fr)); gap:12px;">
            <div style="color:#94a3b8; font-size:12px; font-style:italic;">Loading your NewRecruit Age of Sigmar lists...</div>
          </div>
        </div>

        <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:18px;">
          <h3 style="font-size:15px; font-weight:800; color:#f59e0b; margin:0 0 6px 0;">🔗 Or Paste NewRecruit Share Link / AoS Roster Text</h3>
          <p style="font-size:12px; color:#94a3b8; margin:0 0 10px 0;">Paste a <b>NewRecruit share URL</b> or exported Age of Sigmar 4.0 text list to compile it into an interactive NewRecruit Play Mode roster with full warscrolls and Battle Formation abilities.</p>
          <textarea id="gt-import-raw-input" rows="6" placeholder="Paste NewRecruit link (https://www.newrecruit.eu/app/list/...) or AoS 4.0 roster text here... e.g.

Stormcast Eternals - Vanguard Wing (2000 pts)
Battle Formation: Vanguard Wing
General's Regiment
1x Lord-Vigilant on Gryph-stalker (180 pts): General
5x Liberators (100 pts)
3x Prosecutors (140 pts)" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:8px; padding:10px 12px; color:#e2e8f0; font-family:'JetBrains Mono',monospace; font-size:12px; outline:none; box-sizing:border-box; line-height:1.5; resize:vertical;"></textarea>
          <div style="margin-top:10px; display:flex; justify-content:flex-end;">
            <button onclick="window.gtImportAndAttach()" style="background:#f59e0b; color:#0f172a; font-weight:800; font-size:12px; border:none; padding:10px 18px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
              🎮 Attach &amp; Open in Play Mode
            </button>
          </div>
        </div>
      `;

      setTimeout(async () => {
        const grid = document.getElementById('gt-saved-lists-grid');
        if (!grid) return;
        try {
          const lists = await fetchTrackerAosNewRecruitLists();
          window.gtSavedListsCache = lists;
          renderSavedListsGridInTracker(lists);
        } catch (e) {
          renderSavedListsGridInTracker([]);
        }
      }, 50);
    } else if (!hasActiveRoster) {
      const isOpp = tab === 'opponent';
      contentHtml = `
        <div style="text-align:center; padding:50px 20px;">
          <div style="font-size:42px; margin-bottom:12px;">${isOpp ? '📜' : '📋'}</div>
          <h3 style="font-size:18px; font-weight:800; color:#f8fafc; margin-bottom:6px;">${isOpp ? "Opponent hasn't attached an AoS list yet" : "You haven't attached an AoS army list to this match"}</h3>
          <p style="font-size:13px; color:#94a3b8; max-width:480px; margin:0 auto 20px;">
            ${isOpp ? "When your opponent attaches their NewRecruit Age of Sigmar roster, you can inspect their full interactive warscrolls and Battle Formation rules here in NewRecruit Play Mode." : "Attach an Age of Sigmar 4.0 list from your NewRecruit Studio or paste a roster to view interactive warscrolls, Battle Formations, and spell lores in NewRecruit Play Mode."}
          </p>
          <button onclick="window.gtSetAosAttachTarget('${isOpp ? (isP1 ? 'player2' : 'player1') : (isP1 ? 'player1' : 'player2')}'); window.gtSetListTab('attach');" style="background:#f59e0b; color:#0f172a; font-weight:800; font-size:13px; border:none; padding:10px 20px; border-radius:8px; cursor:pointer;">
            ➕ ${isOpp ? 'Attach / Paste Opponent AoS List' : 'Attach / Select My AoS Army List'}
          </button>
        </div>
      `;
    } else if (activeList) {
      contentHtml = renderTrackerNativeRoster(activeList);
    }

    modal.innerHTML = `
      <div class="gt-modal-dialog" style="max-width:${hasActiveRoster ? '1440px' : '960px'}; width:${hasActiveRoster ? '99vw' : '100%'}; height:${hasActiveRoster ? '96dvh' : 'auto'}; max-height:96dvh; border-radius:12px;">
        <div class="gt-modal-header" style="padding:4px 6px; flex-shrink:0; display:flex; align-items:center; justify-content:space-between; gap:4px; flex-wrap:nowrap; min-height:36px;">
          <div style="display:flex; align-items:center; gap:3px; flex-wrap:nowrap; flex-shrink:0;">
            <button onclick="window.gtSetListTab('opponent')" class="gt-tab-btn ${tab === 'opponent' ? 'active' : ''}" style="padding:3px 6px; font-size:10.5px; white-space:nowrap;">
              📜 Opp${oppList ? ' 🟢' : ''}
            </button>
            <button onclick="window.gtSetListTab('my')" class="gt-tab-btn ${tab === 'my' ? 'active' : ''}" style="padding:3px 6px; font-size:10.5px; white-space:nowrap;">
              📋 Mine${myList ? ' 🟢' : ''}
            </button>
            <button onclick="window.gtSetListTab('attach')" class="gt-tab-btn ${tab === 'attach' ? 'active' : ''}" style="padding:3px 6px; font-size:10.5px; white-space:nowrap;">
              ➕ Switch
            </button>
          </div>
          <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
            ${hasActiveRoster ? `
              <div style="display:flex; background:rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:1.5px; gap:1.5px;">
                <button id="gt-mode-btn-play" onclick="window.gtToggleRosterViewMode('play')" title="NewRecruit Play Mode" style="background:${activeMode==='play'?'#0284c7':'transparent'}; color:${activeMode==='play'?'#fff':'#94a3b8'}; border:none; padding:3px 6px; border-radius:4px; font-weight:800; font-size:10px; cursor:pointer; white-space:nowrap;">
                  🎮 Play
                </button>
                ${tab !== 'opponent' ? `
                <button id="gt-mode-btn-edit" onclick="window.gtToggleRosterViewMode('edit')" title="Edit in NewRecruit" style="background:${activeMode==='edit'?'#7c3aed':'transparent'}; color:${activeMode==='edit'?'#fff':'#94a3b8'}; border:none; padding:3px 6px; border-radius:4px; font-weight:800; font-size:10px; cursor:pointer; white-space:nowrap;">
                  🛠️ Edit
                </button>
                ` : ''}
                <button id="gt-mode-btn-text" onclick="window.gtToggleRosterViewMode('text')" title="Raw Roster Text" style="background:${activeMode==='text'?'#0284c7':'transparent'}; color:${activeMode==='text'?'#fff':'#94a3b8'}; border:none; padding:3px 6px; border-radius:4px; font-weight:800; font-size:10px; cursor:pointer; white-space:nowrap;">
                  📄 Text
                </button>
              </div>
            ` : ''}
            <button onclick="window.gtCloseArmyListModal()" title="Close" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:6px; color:#cbd5e1; font-size:14px; font-weight:800; width:25px; height:25px; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; line-height:1;">
              ✕
            </button>
          </div>
        </div>
        <div class="gt-modal-body" style="padding:${hasActiveRoster ? '0' : '16px'}; display:flex; flex-direction:column; flex:1; overflow:${hasActiveRoster ? 'hidden' : 'auto'};">
          ${contentHtml}
        </div>
      </div>
    `;

    if (hasActiveRoster && activeList) {
      const iframe = document.getElementById('gt-nr-play-mode-iframe');
      if (iframe) {
        const listKey = resolveTrackerNrListKey(activeList);
        const isPlayMode = (aosListState.rosterViewMode || 'play') !== 'edit' || tab === 'opponent';
        const isEphemeralOpp = tab === 'opponent' || Boolean(activeList._ephemeral_view || (activeList.nr_row && activeList.nr_row._ephemeral_view));
        const nrRowPayload = activeList.nr_row
          ? (isEphemeralOpp ? Object.assign({}, activeList.nr_row, { _ephemeral_view: true }) : activeList.nr_row)
          : null;
        try {
          if (nrRowPayload && window.sessionStorage) {
            window.sessionStorage.setItem('omni_pending_nr_row_' + listKey, JSON.stringify(nrRowPayload));
          }
        } catch (e) {}
        const sendPlayCmd = () => {
          try {
            if (iframe.contentWindow) {
              iframe.contentWindow.postMessage({
                type: 'OMNITACTICA_NR_COMMAND',
                command: 'open_play_mode',
                list_key: listKey,
                list_name: activeList.name || '',
                play: isPlayMode,
                ephemeral: isEphemeralOpp,
                nr_row: nrRowPayload
              }, '*');
            }
          } catch (e) {}
        };
        iframe.addEventListener('load', () => {
          sendPlayCmd();
        });
      }
    }
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

    const isP1 = role !== 'player2';
    const hasAnyList = Boolean(aosListState.p1ArmyList || aosListState.p2ArmyList);
    const defaultListTab = (isP1 ? aosListState.p1ArmyList : aosListState.p2ArmyList)
      ? 'my'
      : ((isP1 ? aosListState.p2ArmyList : aosListState.p1ArmyList) ? 'opponent' : 'attach');

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
      <button type="button" class="gt-dock-btn" style="background:rgba(56,189,248,0.15); border-color:rgba(56,189,248,0.4); color:#38bdf8;" onclick="window.gtOpenArmyListModal('${defaultListTab}')" title="View Army Lists">
        <span class="gt-dock-icon">📋</span>
        <span class="gt-dock-label">Lists${hasAnyList ? ' 🟢' : ''}</span>
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
      backdrop-filter: blur(8px); padding: 5px 12px;
      display: flex; justify-content: space-between; align-items: center;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #f0f4fc;
      gap: 6px; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none;
    `;

    const st = getAosState() || {};
    const p1Name = st.p1?.name || 'Player 1';
    const p2Name = st.p2?.name || 'Player 2';
    const isP1 = role !== 'player2';
    const myList = isP1 ? aosListState.p1ArmyList : aosListState.p2ArmyList;
    const oppList = isP1 ? aosListState.p2ArmyList : aosListState.p1ArmyList;

    hud.innerHTML = `
      <!-- Left: Hub & Lobby Navigation & Match Tag -->
      <div style="display:inline-flex; align-items:center; gap:6px; flex-shrink:0;">
        <a href="/aos#my-hub" style="display:inline-flex; align-items:center; gap:3px; color:#38bdf8; text-decoration:none; font-size:11px; font-weight:800; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.25); padding:4px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace; cursor:pointer;">
          🏠 Hub
        </a>
        <a href="/11th/tracker/aos" style="display:inline-flex; align-items:center; gap:3px; color:#f59e0b; text-decoration:none; font-size:11px; font-weight:800; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.25); padding:4px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace; cursor:pointer;">
          🎲 Lobby
        </a>
        <span onclick="if(window.__openShareRoomModal) window.__openShareRoomModal('${matchId || ''}'); else window.__copyRoomShareLink('${matchId || ''}');" title="Click to Share Room in Chat or Copy Link" style="font-family:'JetBrains Mono',monospace; color:#f59e0b; font-size:11px; background:#070b14; padding:4px 7px; border-radius:6px; border:1px solid #334155; font-weight:800; cursor:pointer;">
          #${matchId || 'AOS-LOCAL'} 🔗
        </span>
        ${isSpectator ? `
          <span style="font-family:'JetBrains Mono',monospace; color:#cbd5e1; font-size:11px; background:rgba(100,116,139,0.25); border:1px solid rgba(148,163,184,0.3); padding:4px 8px; border-radius:6px; font-weight:800; display:inline-flex; align-items:center; gap:4px;">
            👀 Spectator
          </span>
        ` : ''}
      </div>

      <!-- Center: Connected Players Matchup -->
      <div class="gt-desktop-actions" style="display:inline-flex; align-items:center; gap:6px; font-weight:800; font-family:'JetBrains Mono',monospace; font-size:11px; padding:0 4px; flex-shrink:0;">
        <span style="width:7px; height:7px; border-radius:50%; background:#10b981; flex-shrink:0;"></span>
        <span style="${isP1 ? 'color:#38bdf8; font-weight:700;' : 'color:#cbd5e1;'}">${escapeHtml(p1Name)}</span>
        <span style="color:#64748b; font-size:10px;">vs</span>
        <span style="${!isP1 ? 'color:#f43f5e; font-weight:700;' : 'color:#cbd5e1;'}">${escapeHtml(p2Name)}</span>
      </div>

      <!-- Right: Action Buttons (Desktop / Wide Screen) -->
      <div class="gt-desktop-actions" style="display:inline-flex; align-items:center; gap:5px; flex-shrink:0;">
        <button onclick="window.gtToggleChessClock()" style="background:#0f172a; color:#38bdf8; border:1px solid rgba(56,189,248,0.4); padding:4px 7px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Open Table Chess Clock">
          ⏱️ Table Clock
        </button>
        <button onclick="window.gtToggleDiceRoller()" style="background:#0f172a; color:#f59e0b; border:1px solid rgba(245,158,11,0.4); padding:4px 7px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Open Synchronized Dice Tray">
          🎲 Dice
        </button>
        ${!isSpectator ? `
          <button onclick="window.gtOpenJudgeModal()" style="background:#881337; color:#fff; border:1px solid #f43f5e; padding:4px 7px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Call Tournament Judge">
            🙋‍♂️ Call Judge
          </button>
        ` : ''}
        <button onclick="window.gtOpenArmyListModal('opponent')" style="background:#1e293b; color:#fff; border:1px solid ${oppList ? '#10b981' : '#334155'}; padding:4px 7px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="View Opponent's List">
          📜 Opponent List${oppList ? ' 🟢' : ''}
        </button>
        <button onclick="window.gtOpenArmyListModal('${myList ? 'my' : 'attach'}')" style="background:#1e293b; color:#fff; border:1px solid ${myList ? '#10b981' : '#334155'}; padding:4px 7px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="View Your List">
          📋 My List${myList ? ' 🟢' : ''}
        </button>
        <button onclick="window.__openScorecardModal()" style="background:rgba(245,158,11,0.12); color:#f59e0b; border:1px solid rgba(245,158,11,0.3); padding:4px 7px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Open Scorecard">
          📄 Scorecard
        </button>
        ${!isSpectator ? `
          <button onclick="window.__openCompleteModal()" style="background:#059669; color:#fff; border:1px solid #10b981; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Complete Game">
            🏁 Finish
          </button>
        ` : ''}
        <button id="gt-hud-share-btn" onclick="if(window.__openShareRoomModal) window.__openShareRoomModal('${matchId || ''}'); else window.__copyRoomShareLink('${matchId || ''}');" style="background:#0284c7; color:#fff; border:none; padding:4px 7px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;" title="Share Room in Chat or Copy Link">
          🔗 Share
        </button>
      </div>
    `;

    injectMobileBottomDock();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initAosRoomAccess();
    });
  } else {
    initAosRoomAccess();
  }

  // Expose global helper for testing
  window.__getAosSummary = () => calculateAosSummary(getAosState());
})();
