/**
 * Synchronized Multiplayer, Room Key Generator & Strict 2-Player Collaborative Match Engine
 * for Warhammer 40,000 11th Edition Game Tracker
 */

(function () {
  'use strict';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getDirectNewRecruitUrl(url, list) {
    if (list && list.id && typeof list.id === 'string' && list.id.startsWith('nr_')) {
      const shareId = list.id.replace('nr_', '');
      return `https://www.newrecruit.eu/app/list/${shareId}`;
    }
    if (!url) return '';
    const match = url.match(/newrecruit\.eu\/app\/list\/([a-zA-Z0-9_\-]+)/i);
    if (match) {
      const shareId = match[1];
      return `https://www.newrecruit.eu/app/list/${shareId}`;
    }
    return url;
  }

  // Suppress browser default PWA install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);


  const SYNC_CONFIG = {
    apiBase: '/api/tracker/room',
    historyEndpoint: '/api/tracker/history',
    authMeEndpoint: '/api/auth/me',
    authLoginEndpoint: '/api/auth/login',
    authRegisterEndpoint: '/api/auth/register',
    debounceMs: 80
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
    p2Connected: false,
    p1ArmyList: null,
    p2ArmyList: null,
    activeListTab: 'opponent',
    activeListFilter: 'all',
    listSearchQuery: '',
    wounds: {},
    firestoreConnected: false,
    hasRealtimeStream: false,
    activeJudgeCall: null,
    tournamentId: null,
    tableNum: null
  };
  window.__gtGetClientState = () => clientState;

  function getTrackerTournamentId() {
    if (clientState.tournamentId) return clientState.tournamentId;
    if (typeof window !== 'undefined' && window.location) {
      const urlParams = new URLSearchParams(window.location.search);
      let eid = urlParams.get('event_id') || urlParams.get('tournament_id') || '';
      if (!eid && clientState.matchId) {
        const m = clientState.matchId.match(/^(?:WH40K-)?(?:BCP|ES)-([A-Za-z0-9_-]+)-R\d+/i);
        if (m && m[1]) eid = m[1];
      }
      if (!eid && clientState.eventId) eid = clientState.eventId;
      if (!eid && clientState.state && clientState.state.event_id) eid = clientState.state.event_id;
      if (!eid && clientState.state && clientState.state.game && clientState.state.game.eventId) eid = clientState.state.game.eventId;
      if (eid) {
        clientState.tournamentId = eid;
        return eid;
      }
    }
    return '';
  }

  function getTrackerTableNum() {
    if (clientState.tableNum) return clientState.tableNum;
    if (typeof window !== 'undefined' && window.location) {
      const urlParams = new URLSearchParams(window.location.search);
      let t = urlParams.get('table') || urlParams.get('table_num') || '';
      if (!t && clientState.matchId) {
        const m = clientState.matchId.match(/-T(\d+)$/i);
        if (m && m[1]) t = m[1];
      }
      if (t) {
        clientState.tableNum = t;
        return t;
      }
    }
    return '1';
  }

  function updateSpectatorModeUI() {
    if (typeof document !== 'undefined' && document.body) {
      if (clientState.role === 'spectator') {
        document.body.classList.add('is-spectator-mode');
        if (isPlay && clientState.matchId) {
          window.location.replace(`/scorecard/${encodeURIComponent(clientState.matchId)}`);
        }
      } else {
        document.body.classList.remove('is-spectator-mode');
      }
    }
  }

  let dbHistoryCache = [];
  let isHistoryLoading = true;

  // 1. Storage interceptors - immediate execution in HEAD
  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  const originalRemoveItem = window.localStorage.removeItem.bind(window.localStorage);
  const originalGetItem = window.localStorage.getItem.bind(window.localStorage);

  // Hydrate cached history immediately so Lobby renders in 0ms without flashing empty state
  try {
    const rawCachedHistory = originalGetItem('gdm-11e-tracker-history');
    if (rawCachedHistory) {
      const parsedHist = JSON.parse(rawCachedHistory);
      if (Array.isArray(parsedHist) && parsedHist.length > 0) {
        let locallyHidden = [];
        try { locallyHidden = JSON.parse(originalGetItem('gt-hidden-matches') || '[]'); } catch (e) {}
        const hiddenSet = new Set(locallyHidden);
        dbHistoryCache = parsedHist.filter(it => !hiddenSet.has(it.match_id || it.id));
        window.gtCompletedHistory = dbHistoryCache.filter(it => it.isFinished || it.is_finished);
        window.gtActiveMatches = dbHistoryCache.filter(it => !(it.isFinished || it.is_finished) && it.status !== 'completed');
        if (dbHistoryCache.length > 0) {
          isHistoryLoading = false;
        }
      }
    }
  } catch (e) {}

  function getAuthToken() {
    return originalGetItem('elo_auth_token') || originalGetItem('native_session_token') || sessionStorage.getItem('elo_auth_token') || '';
  }

  function getOrCreateGuestId() {
    try {
      let gid = originalGetItem('gt_guest_id') || sessionStorage.getItem('gt_guest_id');
      if (!gid && typeof document !== 'undefined' && document.cookie) {
        const m = document.cookie.match(/(?:^|;\s*)gt_guest_id=([^;]+)/);
        if (m && m[1]) gid = decodeURIComponent(m[1]);
      }
      if (!gid && typeof window !== 'undefined' && typeof window.name === 'string' && window.name.includes('gt_gid:')) {
        const nm = window.name.match(/gt_gid:(guest_[A-Za-z0-9_-]+)/);
        if (nm && nm[1]) gid = nm[1];
      }
      if (!gid || !String(gid).startsWith('guest_')) {
        gid = 'guest_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
      }
      try { originalSetItem('gt_guest_id', gid); } catch (e) {}
      try { sessionStorage.setItem('gt_guest_id', gid); } catch (e) {}
      try { document.cookie = `gt_guest_id=${encodeURIComponent(gid)}; path=/; max-age=2592000; SameSite=Lax`; } catch (e) {}
      try {
        if (typeof window !== 'undefined' && typeof window.name === 'string' && !window.name.includes('gt_gid:')) {
          window.name = (window.name ? window.name + ';' : '') + `gt_gid:${gid}`;
        }
      } catch (e) {}
      return gid;
    } catch (e) {
      return 'guest_fallback_' + Math.random().toString(36).substring(2, 9);
    }
  }
  window.__getGtGuestId = getOrCreateGuestId;

  function getSavedRoomSeat(matchId) {
    if (!matchId) return '';
    const normMid = String(matchId).trim().toUpperCase();
    try {
      const p = new URLSearchParams(window.location.search);
      const urlRole = (p.get('role') || p.get('seat') || p.get('claim_role') || '').trim().toLowerCase();
      if (urlRole === 'player2' || urlRole === 'p2') return 'player2';
      if (urlRole === 'player1' || urlRole === 'p1') return 'player1';
      if (urlRole === 'spectator') return 'spectator';
    } catch (e) {}
    const key = `gt_seat_${normMid}`;
    try {
      const saved = originalGetItem(key) || sessionStorage.getItem(key);
      if (saved === 'player1' || saved === 'player2') return saved;
    } catch (e) {}
    try {
      if (typeof document !== 'undefined' && document.cookie) {
        const safeKey = key.replace(/[^A-Za-z0-9_-]/g, '_');
        const re = new RegExp(`(?:^|;\\s*)${safeKey}=([^;]+)`);
        const m = document.cookie.match(re);
        if (m && (m[1] === 'player1' || m[1] === 'player2')) return m[1];
      }
    } catch (e) {}
    try {
      if (typeof window !== 'undefined' && typeof window.name === 'string') {
        const re = new RegExp(`${normMid}:(player1|player2)`);
        const m = window.name.match(re);
        if (m && m[1]) return m[1];
      }
    } catch (e) {}
    return '';
  }

  function saveRoomSeat(matchId, role) {
    if (!matchId || (role !== 'player1' && role !== 'player2')) return;
    const normMid = String(matchId).trim().toUpperCase();
    const key = `gt_seat_${normMid}`;
    try { originalSetItem(key, role); } catch (e) {}
    try { sessionStorage.setItem(key, role); } catch (e) {}
    try {
      const safeKey = key.replace(/[^A-Za-z0-9_-]/g, '_');
      document.cookie = `${safeKey}=${role}; path=/; max-age=604800; SameSite=Lax`;
    } catch (e) {}
    try {
      if (typeof window !== 'undefined' && typeof window.name === 'string' && !window.name.includes(`${normMid}:`)) {
        window.name = (window.name ? window.name + ';' : '') + `${normMid}:${role}`;
      }
    } catch (e) {}
  }

  function promptGuestRejoinOrSpectate(matchId, chkData) {
    return new Promise((resolve) => {
      if (typeof window.__hideGtLoadingOverlay === 'function') {
        window.__hideGtLoadingOverlay(true);
      }
      const existing = document.getElementById('gt-guest-rejoin-modal');
      if (existing) existing.remove();

      const p1Name = (chkData && chkData.p1_name) ? chkData.p1_name : 'Player 1';
      const p2Name = (chkData && chkData.p2_name) ? chkData.p2_name : 'Player 2';
      const canReclaimP2 = Boolean(chkData && chkData.can_reclaim_guest_p2);
      const canReclaimP1 = Boolean(chkData && chkData.can_reclaim_guest_p1);
      const targetRole = canReclaimP2 ? 'player2' : (canReclaimP1 ? 'player1' : 'player2');
      const targetLabel = targetRole === 'player2' ? `${p2Name} (Player 2)` : `${p1Name} (Player 1)`;

      const modal = document.createElement('div');
      modal.id = 'gt-guest-rejoin-modal';
      modal.style.cssText = 'position:fixed; inset:0; z-index:9999999; background:rgba(4,7,17,0.92); backdrop-filter:blur(10px); display:flex; align-items:center; justify-content:center; padding:16px; font-family:Inter,system-ui,sans-serif;';
      modal.innerHTML = `
        <div style="background:#0e1526; border:1px solid rgba(56,189,248,0.35); border-radius:20px; width:100%; max-width:440px; padding:22px 20px; box-shadow:0 25px 70px rgba(0,0,0,0.9); color:#f8fafc; text-align:center;">
          <div style="font-size:32px; margin-bottom:8px;">⚔️</div>
          <h2 style="font-size:17px; font-weight:800; margin:0 0 6px; font-family:'JetBrains Mono',monospace; color:#f8fafc;">
            MATCH IN PROGRESS
          </h2>
          <div style="font-size:12px; color:#38bdf8; font-family:'JetBrains Mono',monospace; font-weight:700; margin-bottom:12px;">
            Room #${escapeHtml(matchId)} • ${escapeHtml(p1Name)} vs ${escapeHtml(p2Name)}
          </div>
          <p style="font-size:12.5px; color:#cbd5e1; line-height:1.5; margin:0 0 18px;">
            This match already has an active Guest seat for <b>${escapeHtml(targetLabel)}</b>. Did you lose connection / switch browsers, or are you here to watch?
          </p>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <button type="button" id="gt-rejoin-guest-seat-btn" style="width:100%; background:linear-gradient(135deg,#10b981,#059669); color:#04130d; font-weight:800; font-size:13px; border:none; border-radius:12px; padding:13px 16px; cursor:pointer; font-family:'JetBrains Mono',monospace; box-shadow:0 6px 20px rgba(16,185,129,0.3);">
              ⚔️ REJOIN AS ${escapeHtml(targetLabel.toUpperCase())}
            </button>
            <button type="button" id="gt-spectate-match-btn" style="width:100%; background:#1e293b; color:#38bdf8; font-weight:700; font-size:12.5px; border:1px solid rgba(56,189,248,0.4); border-radius:12px; padding:12px 16px; cursor:pointer; font-family:'JetBrains Mono',monospace;">
              👀 WATCH LIVE SCORECARD (SPECTATOR)
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('gt-rejoin-guest-seat-btn').onclick = () => {
        modal.remove();
        resolve(targetRole);
      };
      document.getElementById('gt-spectate-match-btn').onclick = () => {
        modal.remove();
        resolve('spectator');
      };
    });
  }

  function hasSharedMatchParams() {
    try {
      const p = new URLSearchParams(window.location.search);
      if (
        p.get('match_id') ||
        p.get('room') ||
        p.get('match') ||
        p.get('id') ||
        ((p.get('eventId') || p.get('event_id')) && (p.get('table') || p.get('table_num')))
      ) {
        return true;
      }
      const raw = originalGetItem('gdm-11e-tracker-state');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.match_id || (typeof parsed.id === 'string' && (parsed.id.startsWith('WH40K-') || parsed.id.startsWith('AOS-'))))) {
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
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
    originalRemoveItem('bcp_session_token');
    originalRemoveItem('bcp_user_profile');
    try { sessionStorage.removeItem('elo_auth_token'); } catch (e) {}
    try { sessionStorage.removeItem('native_session_token'); } catch (e) {}
    document.cookie = 'session_token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    document.cookie = 'session_token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'session_token=; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    currentUser = null;
  }

  function saveLocalState(st) {
    if (!st) return;
    try {
      if (typeof st === 'object' && clientState.matchId) {
        st.id = clientState.matchId;
        st.match_id = clientState.matchId;
      }
      const serialized = typeof st === 'string' ? st : JSON.stringify(st);
      originalSetItem('gdm-11e-tracker-state', serialized);
    } catch (e) {}
  }

  // On Landing Page: Clean out active match state if not playing
  if (!isPlay) {
    try {
      originalRemoveItem('gdm-11e-tracker-state');
    } catch (e) {}
  }

  function computeTrackerPlayerBreakdown(pObj, st) {
    if (!pObj || typeof pObj !== 'object') {
      return { pri: 0, priCap: 45, sec: 0, secCap: 45, paint: 0, total: 0, maxTotal: 100, isAos: false, roundSecTotals: [0, 0, 0, 0, 0] };
    }
    const stateObj = (st && typeof st === 'object') ? st : {};
    const gameObj = (stateObj.game && typeof stateObj.game === 'object') ? stateObj.game : {};
    const midStr = String(stateObj.match_id || stateObj.id || '').toUpperCase();
    const isAos = Boolean(
      String(stateObj.game_system || stateObj.gameSystem || '').toLowerCase() === 'aos' ||
      midStr.startsWith('AOS-') ||
      (typeof window !== 'undefined' && window.location && window.location.pathname.includes('/aos'))
    );
    const rounds = Array.isArray(pObj.rounds) ? pObj.rounds : [];

    if (isAos) {
      const rawPri = rounds.reduce((s, r) => s + (Number(r && r.primaryScore) || 0), 0);
      const roundSecTotals = [1, 2, 3, 4, 5].map(rNum => {
        const r = rounds.find(x => x && (x.round === rNum || x.battleRound === rNum)) || rounds[rNum - 1];
        return Number(r && (r.tacticScore ?? r.secondaryScore)) || 0;
      });
      const rawTac = roundSecTotals.reduce((a, b) => a + b, 0);
      const rawEd = String(pObj.edition || stateObj.edition || gameObj.edition || '').toLowerCase();
      const isAos3e = rawEd.includes('3') || pObj.grandStrategyScore !== undefined;
      if (isAos3e) {
        const gs = Number(pObj.grandStrategyScore) || 0;
        const calcTot = rawPri + rawTac + gs;
        const total = calcTot > 0 ? calcTot : (Number(pObj.score ?? pObj.totalScore) || 0);
        return { pri: rawPri, priCap: 30, sec: rawTac, secCap: 20, paint: gs, total, maxTotal: 60, isAos: true, roundSecTotals };
      }
      const pri = Math.min(30, rawPri);
      const sec = Math.min(20, rawTac);
      const calcTot = Math.min(50, pri + sec);
      const total = calcTot > 0 ? calcTot : (Number(pObj.score ?? pObj.totalScore) || 0);
      return { pri, priCap: 30, sec, secCap: 20, paint: 0, total, maxTotal: 50, isAos: true, roundSecTotals };
    }

    const rawEd = String(pObj.edition || stateObj.edition || gameObj.edition || '').trim().toLowerCase();
    const isNative11th = Boolean(
      !stateObj.imported_source &&
      (pObj.deck || gameObj.p1Disposition || gameObj.p2Disposition || !rawEd || rawEd === '11th' || rawEd === '11e')
    );

    let priCap = 45;
    let secCap = 45;
    let maxTotal = 100;
    let hasPaint = true;
    if (rawEd === '8th' || rawEd === '8e' || rawEd === '8th_itc' || rawEd === 'itc' || Number(pObj.primaryCap) === 36) {
      priCap = 36;
      secCap = 12;
      maxTotal = 48;
      hasPaint = false;
    } else if (!isNative11th && (rawEd === '10th' || rawEd === '10e' || (stateObj.imported_source && rawEd !== '9th' && rawEd !== '9e' && Number(pObj.primaryCap) !== 45 && Number(pObj.secondaryCap) !== 45))) {
      priCap = Number(pObj.primaryCap) || 50;
      secCap = Number(pObj.secondaryCap) || 40;
      maxTotal = 100;
      hasPaint = true;
    } else {
      priCap = Number(pObj.primaryCap) || 45;
      secCap = Number(pObj.secondaryCap) || 45;
      maxTotal = 100;
      hasPaint = true;
    }

    let rawPri = rounds.reduce((s, r) => s + (Number(r && r.primaryScore) || 0), 0);
    if (rawPri === 0 && Number(pObj.primaryScore) > 0) {
      rawPri = Number(pObj.primaryScore);
    }
    const pri = Math.min(priCap, rawPri);

    const hand = Array.isArray(pObj.hand) ? pObj.hand : [];
    const roundSecTotals = [1, 2, 3, 4, 5].map(rNum => {
      const seenKeys = new Set();
      let rSecSum = 0;

      // 1. Inspect hand (Tactical & Fixed secondary cards in Live 11th Ed Tracker)
      hand.forEach(card => {
        if (!card || typeof card !== 'object') return;
        let pts = 0;
        let matched = false;
        if (card.recurring) {
          const rScores = card.roundScores || {};
          const entry = rScores[rNum] !== undefined ? rScores[rNum] : rScores[String(rNum)];
          if (entry !== undefined && entry !== null) {
            pts = (typeof entry === 'object') ? (Number(entry.points ?? entry.score) || 0) : (Number(entry) || 0);
            matched = true;
          }
        } else if (Number(card.scoredRound) === rNum) {
          pts = Number(card.points ?? card.score) || 0;
          matched = true;
        }
        if (matched) {
          const key = String(card.instanceId || card.cardId || card.id || card.name || '').toLowerCase();
          if (key) seenKeys.add(key);
          rSecSum += pts;
        }
      });

      // 2. Inspect round's explicit secondaries array or numeric secondaryScore fallback
      const r = rounds.find(x => x && (x.round === rNum || x.battleRound === rNum)) || rounds[rNum - 1];
      if (r && Array.isArray(r.secondaries) && r.secondaries.length > 0) {
        r.secondaries.forEach(s => {
          if (!s) return;
          if (typeof s === 'object') {
            const key = String(s.instanceId || s.cardId || s.id || s.name || '').toLowerCase();
            if (key && seenKeys.has(key)) return;
            if (key) seenKeys.add(key);
            rSecSum += Number(s.score ?? s.points) || 0;
          }
        });
      }
      if (rSecSum === 0 && r && Number(r.secondaryScore) > 0 && (hand.length === 0 || stateObj.imported_source)) {
        rSecSum = Number(r.secondaryScore) || 0;
      }
      return rSecSum;
    });

    let rawSec = roundSecTotals.reduce((a, b) => a + b, 0);
    if (rawSec === 0 && hand.length > 0) {
      rawSec = hand.reduce((tot, card) => {
        if (!card || typeof card !== 'object') return tot;
        if (card.recurring) {
          return tot + Object.values(card.roundScores || {}).reduce((acc, v) => acc + (typeof v === 'object' && v ? (Number(v.points ?? v.score) || 0) : (Number(v) || 0)), 0);
        }
        return tot + (card.scoredRound != null ? (Number(card.points ?? card.score) || 0) : 0);
      }, 0);
    }
    if (rawSec === 0 && Number(pObj.secondaryScore) > 0 && (hand.length === 0 || stateObj.imported_source)) {
      rawSec = Number(pObj.secondaryScore) || 0;
    }
    const sec = Math.min(secCap, rawSec);

    const paint = !hasPaint
      ? (Number(pObj.paintScore) || 0)
      : (typeof pObj.paintScore === 'number' ? pObj.paintScore : (pObj.battleReady !== false ? 10 : 0));

    const hasDetailData = Boolean(
      rounds.some(r => r && (Number(r.primaryScore) > 0 || Number(r.secondaryScore) > 0 || (Array.isArray(r.secondaries) && r.secondaries.length > 0))) ||
      hand.length > 0 ||
      pObj.battleReady !== undefined ||
      pObj.deck !== undefined
    );
    const calcTot = Math.min(maxTotal, pri + sec + paint);
    const total = (!hasDetailData && Number(pObj.score ?? pObj.totalScore) > 0)
      ? Number(pObj.score ?? pObj.totalScore)
      : calcTot;

    return { pri, priCap, sec, secCap, paint, total, maxTotal, isAos: false, roundSecTotals };
  }

  function computeTrackerPlayerVp(pObj, st) {
    return computeTrackerPlayerBreakdown(pObj, st).total;
  }

  window.__computeTrackerPlayerBreakdown = computeTrackerPlayerBreakdown;
  window.__computeTrackerPlayerVp = computeTrackerPlayerVp;
  window.__injectDefaultCpIntoState = injectDefaultCpIntoState;

  function injectDefaultCpIntoState(raw) {
    if (!raw) return raw;
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (obj && typeof obj === 'object') {
        // Sanitize p1 & p2 rounds arrays and synchronize computed Primary, Secondary (from hand) & Total scores
        ['p1', 'p2'].forEach(pKey => {
          if (obj[pKey] && typeof obj[pKey] === 'object') {
            if (!obj[pKey].rounds || !Array.isArray(obj[pKey].rounds)) {
              obj[pKey].rounds = [
                { round: 1, battleRound: 1, primaryScore: 0, secondaryScore: 0, secondaries: [] },
                { round: 2, battleRound: 2, primaryScore: 0, secondaryScore: 0, secondaries: [] },
                { round: 3, battleRound: 3, primaryScore: 0, secondaryScore: 0, secondaries: [] },
                { round: 4, battleRound: 4, primaryScore: 0, secondaryScore: 0, secondaries: [] },
                { round: 5, battleRound: 5, primaryScore: 0, secondaryScore: 0, secondaries: [] }
              ];
            } else {
              obj[pKey].rounds = obj[pKey].rounds.map((r, idx) => {
                if (!r || typeof r !== 'object') {
                  return {
                    round: idx + 1,
                    battleRound: idx + 1,
                    primaryScore: 0,
                    secondaryScore: 0,
                    secondaries: []
                  };
                }
                if (typeof r.primaryScore !== 'number') r.primaryScore = 0;
                if (typeof r.secondaryScore !== 'number') r.secondaryScore = 0;
                if (!Array.isArray(r.secondaries) && !r.secondaries) r.secondaries = [];
                return r;
              });
            }

            const bd = computeTrackerPlayerBreakdown(obj[pKey], obj);
            const hasHand = Array.isArray(obj[pKey].hand) && obj[pKey].hand.length > 0;
            if (!obj.imported_source && (hasHand || obj[pKey].deck)) {
              obj[pKey].rounds.forEach((r, idx) => {
                if (r && typeof r === 'object') {
                  r.secondaryScore = bd.roundSecTotals[idx] || 0;
                }
              });
            }
            obj[pKey].primaryScore = bd.pri;
            obj[pKey].secondaryScore = bd.sec;
            obj[pKey].score = bd.total;
            obj[pKey].totalScore = bd.total;
            if (pKey === 'p1') {
              obj.p1Score = bd.total;
              obj.p1_score = bd.total;
            } else {
              obj.p2Score = bd.total;
              obj.p2_score = bd.total;
            }
          }
        });

        obj.trackCp = true;
        obj.trackCP = true;
        obj.trackCommandPoints = true;
        obj.commandPoints = true;
        obj.cp = true;
        obj.showCP = true;
        obj.enableCP = true;
        obj.cpTracking = true;
        obj.cpCounter = true;
        if (!obj.settings) obj.settings = {};
        obj.settings.trackCp = true;
        obj.settings.trackCP = true;
        obj.settings.trackCommandPoints = true;
        obj.settings.commandPoints = true;
        obj.settings.cp = true;
        if (!obj.game) obj.game = {};
        obj.game.trackCp = true;
        obj.game.trackCP = true;
        obj.game.trackCommandPoints = true;
        obj.game.commandPoints = true;
        obj.game.cp = true;
        return typeof raw === 'string' ? JSON.stringify(obj) : obj;
      }
    } catch(e) {}
    return raw;
  }

  // Override getItem
  window.localStorage.getItem = function (key) {
    if (key === 'gdm-11e-tracker-history') {
      return JSON.stringify(dbHistoryCache);
    }
    if (!isPlay && key === 'gdm-11e-tracker-state') {
      return null;
    }
    if (key === 'gdm-11e-tracker-state') {
      const raw = originalGetItem(key);
      return injectDefaultCpIntoState(raw);
    }
    return originalGetItem(key);
  };

  // Override setItem
  window.localStorage.setItem = function (key, value) {
    if (key === 'gdm-11e-tracker-history') {
      return; // Database is sole source of truth
    }
    let toSet = value;
    if (key === 'gdm-11e-tracker-state') {
      toSet = injectDefaultCpIntoState(value);
      if (clientState.matchId) {
        try {
          const parsed = typeof toSet === 'string' ? JSON.parse(toSet) : toSet;
          if (parsed && typeof parsed === 'object') {
            parsed.id = clientState.matchId;
            parsed.match_id = clientState.matchId;
            toSet = JSON.stringify(parsed);
          }
        } catch(e) {}
      }
    }
    originalSetItem(key, toSet);
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

  // 2. Authentication & Guest Seat Verification
  async function verifySession() {
    const token = getAuthToken();
    const canJoinAsGuest = isPlay && hasSharedMatchParams();
    if (!token) {
      if (canJoinAsGuest) {
        clientState.isGuest = true;
        clientState.guestId = getOrCreateGuestId();
        return true;
      }
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.href);
      return false;
    }
    try {
      const resp = await fetch(SYNC_CONFIG.authMeEndpoint, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        const userObj = data && (data.user || ((data.id || data.email) ? data : null));
        if (data && data.authenticated !== false && userObj) {
          currentUser = userObj;
          clientState.isGuest = false;
          clientState.guestId = getOrCreateGuestId();
          try {
            originalSetItem('native_user_profile', JSON.stringify(userObj));
          } catch(e) {}
          renderUserBar();
          return true;
        } else if (data && data.authenticated === false) {
          clearAuthToken();
          if (canJoinAsGuest) {
            clientState.isGuest = true;
            clientState.guestId = getOrCreateGuestId();
            return true;
          }
          window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
          return false;
        }
      } else if (resp.status === 401 || resp.status === 403) {
        clearAuthToken();
        if (canJoinAsGuest) {
          clientState.isGuest = true;
          clientState.guestId = getOrCreateGuestId();
          return true;
        }
        window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
        return false;
      }
    } catch (e) {
      console.warn('[verifySession] Network latency notice (proceeding with cached session):', e);
      const cached = originalGetItem('native_user_profile');
      if (cached) {
        try {
          currentUser = JSON.parse(cached);
          renderUserBar();
          return true;
        } catch(err) {}
      }
      return true;
    }
    return true;
  }

  function renderUserBar() {
    if (isPlay) {
      const old = document.getElementById('gt-user-status-bar');
      if (old) old.remove();
      return;
    }
    const isAosMode = window.location.pathname.includes('/aos') ||
      window.location.search.includes('game_system=aos') ||
      window.location.search.includes('system=aos');
    if (!currentUser) {
      try {
        const cached = originalGetItem('native_user_profile') || originalGetItem('bcp_user_profile');
        if (cached) currentUser = JSON.parse(cached);
      } catch (e) {}
    }
    if (!currentUser || !document.body) return;

    let bar = document.getElementById('gt-user-status-bar');
    if (bar && document.body.contains(bar)) return;

    const hubHref = isAosMode ? '/aos#my-hub' : '/#my-hub';
    const lobbyHref = isAosMode ? '/11th/tracker/aos' : '/11th/tracker';
    const lobbyLabel = isAosMode ? '⚡ AoS Lobby' : '🎲 Lobby';
    const isAdminUser = Boolean(
      currentUser &&
      (currentUser.is_admin || ['admin', 'superuser', 'developer', 'owner'].includes(String(currentUser.role || '').trim().toLowerCase()))
    );

    bar = document.createElement('div');
    bar.id = 'gt-user-status-bar';
    bar.style.cssText = "position:fixed; top:max(12px, calc(6px + env(safe-area-inset-top, 0px))); left:max(16px, env(safe-area-inset-left, 0px)); z-index:99998; display:flex; align-items:center; gap:8px; background:rgba(15,23,42,0.94); border:1px solid rgba(56,189,248,0.25); backdrop-filter:blur(12px); padding:5px 12px; border-radius:9999px; font-family:'Inter',sans-serif; font-size:11px; color:#f8fafc; box-shadow:0 8px 30px rgba(0,0,0,0.6);";
    bar.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px;">
        <a href="${hubHref}" style="display:inline-flex; align-items:center; gap:4px; color:#38bdf8; text-decoration:none; font-size:11px; font-weight:700; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.25); padding:3px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace; transition:all 0.15s;">
          🏠 My Hub
        </a>
        <a href="${lobbyHref}" style="display:inline-flex; align-items:center; gap:4px; color:#f59e0b; text-decoration:none; font-size:11px; font-weight:700; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.25); padding:3px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace; transition:all 0.15s;">
          ${lobbyLabel}
        </a>
        ${isAdminUser ? `
          <a href="/admin/dice-tracker" id="gt-admin-cv-dice-btn" style="display:inline-flex; align-items:center; gap:4px; color:#c084fc; text-decoration:none; font-size:11px; font-weight:700; background:rgba(168,85,247,0.14); border:1px solid rgba(168,85,247,0.35); padding:3px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace; transition:all 0.15s;" title="Open Standalone CV Dice Lab (Admin)">
            📹 CV Dice Lab
          </a>
        ` : ''}
      </div>
      <span style="color:#334155;">|</span>
      <span style="display:inline-flex; align-items:center; gap:5px;">
        <span style="width:7px; height:7px; border-radius:50%; background:#10b981;"></span>
        <b style="color:#f8fafc; font-size:11px; font-family:'JetBrains Mono',monospace;">${currentUser.display_name || currentUser.email}</b>
      </span>
      <button onclick="window.__handleLogout()" style="background:transparent; border:none; color:#ef4444; font-size:11px; cursor:pointer; font-weight:700; padding:2px 4px; font-family:'JetBrains Mono',monospace;">Logout</button>
    `;
    document.body.appendChild(bar);
  }

  function getActiveMatchId() {
    if (clientState && clientState.matchId) return clientState.matchId;
    const urlParams = new URLSearchParams(window.location.search);
    const m = urlParams.get('match_id') || urlParams.get('room') || urlParams.get('id');
    if (m) {
      const trimmed = m.trim();
      const isTourn = (trimmed.startsWith('BCP-') || trimmed.startsWith('ES-') || /^(?:WH40K-|AOS-)?(?:BCP|ES)-/i.test(trimmed));
      return isTourn ? trimmed : trimmed.toUpperCase();
    }
    try {
      const raw = originalGetItem('gdm-11e-tracker-state');
      const st = JSON.parse(raw);
      if (st && st.match_id) {
        const trimmed = st.match_id.trim();
        const isTourn = (trimmed.startsWith('BCP-') || trimmed.startsWith('ES-') || /^(?:WH40K-|AOS-)?(?:BCP|ES)-/i.test(trimmed));
        return isTourn ? trimmed : trimmed.toUpperCase();
      }
    } catch (e) {}
    return '';
  }

  window.__openScorecardModal = function () {
    const matchId = getActiveMatchId();
    if (!matchId) {
      alert('Match ID not found. Please ensure you are inside a match.');
      return;
    }
    window.open(`/scorecard/${encodeURIComponent(matchId)}`, '_blank');
  };

  window.__openCompleteModal = function () {
    const matchId = getActiveMatchId();
    const raw = originalGetItem('gdm-11e-tracker-state');
    let st = {};
    try { st = JSON.parse(raw) || {}; } catch(e) {}
    const game = st.game || {};
    const p1 = st.p1 || {};
    const p2 = st.p2 || {};

    const p1Name = game.p1Name || st.p1_name || 'Player 1';
    const p2Name = game.p2Name || st.p2_name || 'Player 2';
    const p1Fac = game.p1Faction || st.p1_faction || '';
    const p2Fac = game.p2Faction || st.p2_faction || '';

    const p1Bd = computeTrackerPlayerBreakdown(p1, st);
    const p2Bd = computeTrackerPlayerBreakdown(p2, st);
    const p1Score = p1Bd.total;
    const p2Score = p2Bd.total;
    const p1SubLine = p1Bd.isAos
      ? `PRI: ${p1Bd.pri}/${p1Bd.priCap} • TAC: ${p1Bd.sec}/${p1Bd.secCap}`
      : `PRI: ${p1Bd.pri}/${p1Bd.priCap} • SEC: ${p1Bd.sec}/${p1Bd.secCap} • PAINT: +${p1Bd.paint}`;
    const p2SubLine = p2Bd.isAos
      ? `PRI: ${p2Bd.pri}/${p2Bd.priCap} • TAC: ${p2Bd.sec}/${p2Bd.secCap}`
      : `PRI: ${p2Bd.pri}/${p2Bd.priCap} • SEC: ${p2Bd.sec}/${p2Bd.secCap} • PAINT: +${p2Bd.paint}`;

    const winnerName = (p1Score > p2Score) ? p1Name : ((p2Score > p1Score) ? p2Name : 'Draw / Tie');
    const winnerColor = (p1Score > p2Score) ? '#38bdf8' : ((p2Score > p1Score) ? '#f43f5e' : '#f59e0b');

    const urlParams = new URLSearchParams(window.location.search);
    let eventId = game.eventId || st.event_id || urlParams.get('event_id') || '';
    let roundNum = game.roundNum || st.round_num || st.round || urlParams.get('round_num') || 1;
    let tableNum = game.tableNum || st.table_num || urlParams.get('table_num') || '';

    if ((!eventId || eventId === 'Casual') && matchId) {
      const bcpMatch = matchId.match(/(?:WH40K-)?(?:BCP-)?([a-zA-Z0-9_-]+)-R(\d+)-T(\d+)/i);
      if (bcpMatch) {
        eventId = bcpMatch[1];
        if (!roundNum || roundNum === 1) roundNum = parseInt(bcpMatch[2], 10);
        if (!tableNum) tableNum = parseInt(bcpMatch[3], 10);
      }
    }

    let existingModal = document.getElementById('gt-complete-modal');
    if (existingModal) existingModal.remove();

    const isBcpTournament = !!eventId && eventId !== 'Casual' && eventId !== 'casual';
    const defaultFirstTurn = (game.firstTurn === 'player2' || game.rollOffWinner === 'player2' || st.who_went_first === 'player2') ? 'player2' : 'player1';
    let currentLayout = game.terrainLayout ? (typeof game.terrainLayout === 'number' ? `Layout ${game.terrainLayout}` : String(game.terrainLayout)) : (st.terrain_layout || 'Layout A');
    if (currentLayout === 'Layout 1') currentLayout = 'Layout A';
    else if (currentLayout === 'Layout 2') currentLayout = 'Layout B';
    else if (currentLayout === 'Layout 3') currentLayout = 'Layout C';
    else if (currentLayout === 'Layout 4') currentLayout = 'Layout D';
    else if (currentLayout === 'Layout 5') currentLayout = 'Layout E';

    const modal = document.createElement('div');
    modal.id = 'gt-complete-modal';
    modal.innerHTML = `
      <div style="position:fixed; inset:0; z-index:999999; background:rgba(4,7,14,0.94); backdrop-filter:blur(16px); display:flex; align-items:center; justify-content:center; padding:16px; font-family:'Inter',sans-serif; box-sizing:border-box;">
        <div style="background:#0e1526; border:1px solid #1e293b; border-radius:20px; width:100%; max-width:540px; box-shadow:0 25px 70px rgba(0,0,0,0.85); overflow:hidden; padding:24px 22px; text-align:center; box-sizing:border-box;">
          
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #1e293b; padding-bottom:10px;">
            <div style="text-align:left;">
              <h2 style="font-size:17px; font-weight:800; color:#f8fafc; font-family:'JetBrains Mono',monospace; margin:0; display:flex; align-items:center; gap:6px;">
                🏁 CONCLUDE & VERIFY MATCH
              </h2>
              <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
                ${isBcpTournament ? `Tournament: ${escapeHtml(eventId)} • ` : 'Casual Battle • '}Round ${roundNum} ${tableNum ? '• Table ' + escapeHtml(tableNum) : ''}
              </div>
            </div>
            <button onclick="document.getElementById('gt-complete-modal').remove()" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer;">✕</button>
          </div>

          <!-- Score Highlight Box -->
          <div style="background:#070b14; border:1px solid #1e293b; border-radius:14px; padding:16px; margin-bottom:16px; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px;">
            <div style="text-align:left;">
              <div style="font-size:11px; color:#38bdf8; font-weight:700; text-transform:uppercase;">${escapeHtml(p1Name)}</div>
              <div style="font-size:11px; color:#64748b;">${escapeHtml(p1Fac || 'Army 1')}</div>
              <div style="font-size:10px; color:#94a3b8; font-family:'JetBrains Mono',monospace; margin-top:3px;">${escapeHtml(p1SubLine)}</div>
            </div>
            <div style="font-family:'JetBrains Mono',monospace; font-size:26px; font-weight:900; color:#fff; display:flex; align-items:center; gap:6px;">
              <span style="color:#38bdf8;">${p1Score}</span>
              <span style="color:#64748b; font-size:16px;">-</span>
              <span style="color:#f43f5e;">${p2Score}</span>
            </div>
            <div style="text-align:right;">
              <div style="font-size:11px; color:#f43f5e; font-weight:700; text-transform:uppercase;">${escapeHtml(p2Name)}</div>
              <div style="font-size:11px; color:#64748b;">${escapeHtml(p2Fac || 'Army 2')}</div>
              <div style="font-size:10px; color:#94a3b8; font-family:'JetBrains Mono',monospace; margin-top:3px;">${escapeHtml(p2SubLine)}</div>
            </div>
          </div>

          <div style="margin-bottom:14px; font-size:13px; font-weight:700; color:${winnerColor};">
            🏆 Match Outcome: ${escapeHtml(winnerName)} ${p1Score !== p2Score ? 'VICTORY' : ''}
          </div>

          <!-- Who Went First Selection -->
          <div style="background:#090f1e; border:1px solid #1e293b; border-radius:10px; padding:10px 14px; margin-bottom:12px; text-align:left;">
            <label style="font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase; display:block; margin-bottom:6px;">
              🎲 Who Took First Turn?
            </label>
            <div style="display:flex; gap:16px;">
              <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#f8fafc; cursor:pointer;">
                <input type="radio" name="gt-who-went-first" value="player1" ${defaultFirstTurn === 'player1' ? 'checked' : ''} />
                <span>${escapeHtml(p1Name)} (Turn 1)</span>
              </label>
              <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#f8fafc; cursor:pointer;">
                <input type="radio" name="gt-who-went-first" value="player2" ${defaultFirstTurn === 'player2' ? 'checked' : ''} />
                <span>${escapeHtml(p2Name)} (Turn 1)</span>
              </label>
            </div>
          </div>

          <!-- Terrain Layout Selection -->
          <div style="background:#090f1e; border:1px solid #1e293b; border-radius:10px; padding:10px 14px; margin-bottom:16px; text-align:left;">
            <label style="font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase; display:block; margin-bottom:6px;">
              🗺️ Terrain Layout
            </label>
            <select id="gt-match-layout" style="width:100%; background:#070b14; border:1px solid #334155; color:#fff; padding:8px 12px; border-radius:8px; font-size:12px; font-family:inherit;">
              ${[
                'Layout A', 'Layout B', 'Layout C', 'Layout D', 'Layout E',
                'Layout 1', 'Layout 2', 'Layout 3', 'Layout 4', 'Layout 5', 'Layout 6', 'Layout 7', 'Layout 8',
                'GW Layout 1', 'GW Layout 2', 'GW Layout 3', 'GW Layout 4',
                'WTC Layout 1', 'WTC Layout 2', 'WTC Layout 3', 'WTC Layout 4', 'WTC Layout 5',
                'Custom / Other'
              ].map(opt => `<option value="${opt}" ${currentLayout === opt ? 'selected' : ''}>${opt}</option>`).join('')}
            </select>
          </div>

          <div id="gt-complete-submit-status" style="margin-bottom:12px; font-size:12px; font-family:'JetBrains Mono',monospace; display:none;"></div>

          <!-- Action Buttons -->
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${isBcpTournament ? `
              <!-- Primary Tournament Action: Submit to BCP & Finish Match -->
              <button id="gt-btn-conclude" onclick="window.__finalizeAndLockMatch()" style="width:100%; background:#0284c7; color:#fff; font-weight:800; font-size:13px; text-transform:uppercase; border:none; padding:12px; border-radius:10px; cursor:pointer; font-family:'JetBrains Mono',monospace; letter-spacing:0.04em; transition:all 0.15s; box-shadow:0 4px 14px rgba(2,132,199,0.35);">
                🏆 SUBMIT SCORE TO BCP & FINISH MATCH
              </button>

              <button id="gt-btn-submit-bcp" onclick="window.__submitMatchToBcp()" style="width:100%; background:rgba(2,132,199,0.18); border:1px solid #0284c7; color:#38bdf8; font-weight:700; font-size:12px; text-transform:uppercase; border:none; padding:9px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace; letter-spacing:0.03em; transition:all 0.15s;">
                📤 SUBMIT SCORE TO BCP ONLY
              </button>

              <button onclick="window.__finalizeAndLockMatch(true)" style="width:100%; background:transparent; border:1px dashed #334155; color:#94a3b8; font-weight:600; font-size:11px; text-transform:uppercase; padding:7px; border-radius:6px; cursor:pointer; font-family:'JetBrains Mono',monospace; letter-spacing:0.03em;">
                🏁 FINISH & ARCHIVE (OFFLINE ONLY)
              </button>
            ` : `
              <!-- Casual Battle Action -->
              <button id="gt-btn-conclude" onclick="window.__finalizeAndLockMatch()" style="width:100%; background:#059669; color:#fff; font-weight:800; font-size:13px; text-transform:uppercase; border:none; padding:12px; border-radius:10px; cursor:pointer; font-family:'JetBrains Mono',monospace; letter-spacing:0.04em; transition:all 0.15s;">
                🏁 CONCLUDE & SAVE MATCH
              </button>
            `}

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <button onclick="window.__copyMatchScorecardSummary()" style="background:#1e293b; border:1px solid #334155; color:#f8fafc; font-weight:700; font-size:11px; padding:10px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace;">
                📋 COPY SUMMARY
              </button>
              <button onclick="window.open('/scorecard/' + encodeURIComponent('${escapeHtml(matchId)}'), '_blank')" style="background:#1e293b; border:1px solid #334155; color:#38bdf8; font-weight:700; font-size:11px; padding:10px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace;">
                📄 VIEW SCORECARD ↗
              </button>
            </div>
          </div>

        </div>
      </div>
    `;
    document.body.appendChild(modal);
  };

  window.__finalizeAndLockMatch = async function (skipBcp) {
    const btn = document.getElementById('gt-btn-conclude');
    const statusEl = document.getElementById('gt-complete-submit-status');

    const matchId = getActiveMatchId();
    const raw = injectDefaultCpIntoState(originalGetItem('gdm-11e-tracker-state'));
    let st = {};
    try { st = JSON.parse(raw) || {}; } catch(e) {}
    const game = st.game || {};
    const urlParams = new URLSearchParams(window.location.search);
    let eventId = game.eventId || st.event_id || urlParams.get('event_id') || '';
    if ((!eventId || eventId === 'Casual') && matchId) {
      const bcpMatch = matchId.match(/(?:WH40K-)?(?:BCP-)?([a-zA-Z0-9_-]+)-R(\d+)-T(\d+)/i);
      if (bcpMatch) eventId = bcpMatch[1];
    }
    const isBcpTournament = !!eventId && eventId !== 'Casual' && eventId !== 'casual';

    const firstTurnRadio = document.querySelector('input[name="gt-who-went-first"]:checked');
    if (firstTurnRadio) {
      st.who_went_first = firstTurnRadio.value;
      if (st.game) st.game.firstTurn = firstTurnRadio.value;
    }
    const layoutEl = document.getElementById('gt-match-layout');
    if (layoutEl && layoutEl.value) {
      st.terrain_layout = layoutEl.value;
      if (st.game) st.game.terrainLayout = layoutEl.value;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = (isBcpTournament && !skipBcp) ? 'SUBMITTING TO BCP & SAVING...' : 'SAVING MATCH...';
    }

    if (isBcpTournament && !skipBcp) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#38bdf8';
        statusEl.textContent = 'Submitting score to Best Coast Pairings...';
      }
      try {
        const bcpRes = await window.__submitMatchToBcp();
        if (bcpRes && bcpRes.bcp_synced) {
          if (statusEl) {
            statusEl.style.color = '#10b981';
            statusEl.textContent = '✅ Score synced to Best Coast Pairings! Finalizing battle record...';
          }
        }
      } catch (err) {
        console.warn('Notice submitting to BCP during conclusion:', err);
      }
    }

    clientState.isFinalizing = true;
    clearTimeout(clientState.debounceTimer);
    if (fsDocUnsub) {
      try { fsDocUnsub(); fsDocUnsub = null; } catch(e) {}
    }

    st.is_finished = true;
    st.started = true;
    st.round = 5;
    st = injectDefaultCpIntoState(st) || st;

    saveLocalState(st);

    // 1. Mark room completed in Firestore first so connected opponent tabs see status='completed' before deletion
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      try {
        const db = firebase.firestore();
        db.collection('rooms').doc(matchId).update({
          status: 'completed',
          is_finished: true,
          updatedAt: Date.now()
        }).catch(() => {});
      } catch(e) {}
    }

    // 1b. Auto-submit score to League Scoring System if this is a League Match
    const leagueId = urlParams.get('league_id') || st.league_id || game.leagueId || ((matchId && (matchId.includes('LG-') || matchId.includes('SD40K'))) ? 'league_sd40k_big_league' : '');
    if (leagueId) {
      try {
        const p1Score = computeTrackerPlayerVp(st.p1, st) || Number(st.p1_score ?? st.p1Score ?? 0);
        const p2Score = computeTrackerPlayerVp(st.p2, st) || Number(st.p2_score ?? st.p2Score ?? 0);
        const p1Name = urlParams.get('p1') || game.p1Name || st.p1_name || '';
        const p2Name = urlParams.get('p2') || game.p2Name || st.p2_name || '';
        const podNum = parseInt(urlParams.get('pod_number') || st.pod_number || game.podNumber || '0', 10) || 1;
        const roundNum = parseInt(urlParams.get('round') || st.round_num || game.roundNum || '1', 10) || 1;
        if (p1Name && p2Name) {
          await fetch(`/api/league/${encodeURIComponent(leagueId)}/match/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pod_number: podNum,
              round_number: roundNum,
              p1_name: p1Name,
              p2_name: p2Name,
              p1_score: p1Score,
              p2_score: p2Score,
              scorecard_id: matchId
            })
          });
        }
      } catch (lgErr) {
        console.warn('Notice auto-submitting league score:', lgErr);
      }
    }

    // 2. Server-side finalize (persists in PostgreSQL and removes from active Firestore)
    try {
      const token = getAuthToken();
      const guestId = getOrCreateGuestId();
      const resp = await fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          'X-Guest-Id': guestId
        },
        body: JSON.stringify({ token: token, guest_id: guestId, match_id: matchId, state: st })
      });
      if (resp.ok) {
        if (typeof firebase !== 'undefined' && firebase.firestore) {
          try {
            const db = firebase.firestore();
            db.collection('rooms').doc(matchId).delete().catch(() => {});
          } catch(e) {}
        }
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.color = '#10b981';
          statusEl.innerHTML = leagueId
            ? `✅ League score auto-submitted &amp; Pod standings updated! Redirecting to League Hub...`
            : `✅ Battle record archived permanently! Redirecting to lobby...`;
        }
        if (btn) {
          btn.style.background = '#10b981';
          btn.textContent = '✓ MATCH CONCLUDED';
        }
        try { originalRemoveItem('gdm-11e-tracker-state'); } catch(e) {}
        setTimeout(() => {
          const m = document.getElementById('gt-complete-modal');
          if (m) m.remove();
          window.location.href = leagueId ? `/app.html#/40k/league/${encodeURIComponent(leagueId)}` : (clientState.isGuest && matchId ? `/scorecard/${encodeURIComponent(matchId)}` : '/11th/tracker');
        }, 700);
        return;
      }
    } catch (e) {}

    // Fallback if offline or network error
    if (btn) { btn.textContent = '✓ SAVED LOCALLY'; }
    try { originalRemoveItem('gdm-11e-tracker-state'); } catch(e) {}
    setTimeout(() => {
      const m = document.getElementById('gt-complete-modal');
      if (m) m.remove();
      window.location.href = (clientState.isGuest && matchId) ? `/scorecard/${encodeURIComponent(matchId)}` : '/11th/tracker';
    }, 600);
  };

  window.__submitMatchToBcp = async function () {
    const btn = document.getElementById('gt-btn-submit-bcp');
    const statusEl = document.getElementById('gt-complete-submit-status');
    if (btn) { btn.disabled = true; btn.textContent = 'SUBMITTING TO BCP...'; }

    const matchId = getActiveMatchId();
    const raw = injectDefaultCpIntoState(originalGetItem('gdm-11e-tracker-state'));
    let st = {};
    try { st = JSON.parse(raw) || {}; } catch(e) {}
    const game = st.game || {};

    const firstTurnRadio = document.querySelector('input[name="gt-who-went-first"]:checked');
    const firstTurnVal = firstTurnRadio ? firstTurnRadio.value : (st.who_went_first || game.firstTurn || 'player1');
    const layoutEl = document.getElementById('gt-match-layout');
    const layoutVal = (layoutEl ? layoutEl.value : '') || (game.terrainLayout ? (typeof game.terrainLayout === 'number' ? `Layout ${game.terrainLayout}` : String(game.terrainLayout)) : (st.terrain_layout || 'Layout A'));

    const urlParams = new URLSearchParams(window.location.search);
    const p1Score = computeTrackerPlayerVp(st.p1 || {}, st);
    const p2Score = computeTrackerPlayerVp(st.p2 || {}, st);
    let eventId = game.eventId || st.event_id || urlParams.get('event_id') || 'Casual';
    let roundNum = game.roundNum || st.round_num || urlParams.get('round_num') || 1;
    let tableNum = game.tableNum || st.table_num || urlParams.get('table_num') || 1;
    let pairingId = game.pairingId || st.pairing_id || (st.game && st.game.pairingId) || urlParams.get('pairing_id') || null;

    if ((!eventId || eventId === 'Casual' || !roundNum || !tableNum) && matchId) {
      const bcpMatch = matchId.match(/(?:WH40K-)?(?:BCP-)?([a-zA-Z0-9_-]+)-R(\d+)-T(\d+)/i);
      if (bcpMatch) {
        if (!eventId || eventId === 'Casual') eventId = bcpMatch[1];
        if (!roundNum || roundNum === 1) roundNum = parseInt(bcpMatch[2], 10);
        if (!tableNum || tableNum === 1) tableNum = parseInt(bcpMatch[3], 10);
      }
    }

    const p1Id = game.p1Id || st.p1_id || game.p1_id || st.player1Id || null;
    const p2Id = game.p2Id || st.p2_id || game.p2_id || st.player2Id || null;
    const p1GameId = game.p1GameId || st.p1_game_id || game.p1_game_id || st.player1GameId || null;
    const p2GameId = game.p2GameId || st.p2_game_id || game.p2_game_id || st.player2GameId || null;
    const resolvedWinnerId = p1Score > p2Score ? p1Id : (p2Score > p1Score ? p2Id : null);

    const bcpTok = (typeof window.getBcpToken === 'function' ? window.getBcpToken() : '') || (window.api && typeof window.api.getBcpToken === 'function' ? window.api.getBcpToken() : '') || localStorage.getItem('bcp_jwt') || localStorage.getItem('bcp_token') || null;

    let resData = {};
    try {
      const resp = await fetch('/api/eventstudio/submit_score', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`,
          ...(bcpTok ? { 'X-BCP-Token': bcpTok } : {})
        },
        body: JSON.stringify({
          event_id: eventId,
          table: Number(tableNum) || 1,
          round_num: Number(roundNum) || 1,
          pairing_id: pairingId,
          p1_score: p1Score,
          p2_score: p2Score,
          p1_id: p1Id,
          p2_id: p2Id,
          p1_name: game.p1Name || st.p1_name || 'Player 1',
          p2_name: game.p2Name || st.p2_name || 'Player 2',
          winner_id: resolvedWinnerId,
          source_app: 'GameTracker-OmniTactica',
          bcp_token: bcpTok,
          first_turn: firstTurnVal,
          layout: layoutVal,
          terrain_layout: layoutVal,
          game_details: {
            match_id: matchId,
            first_turn: firstTurnVal,
            firstTurn: firstTurnVal,
            layout: layoutVal,
            terrain_layout: layoutVal,
            terrainLayout: layoutVal,
            p1_id: p1Id,
            p2_id: p2Id,
            p1_game_id: p1GameId,
            p2_game_id: p2GameId,
            player1GameId: p1GameId,
            player2GameId: p2GameId,
            p1_faction: game.p1Faction || st.p1_faction,
            p2_faction: game.p2Faction || st.p2_faction,
            winner_id: resolvedWinnerId
          }
        })
      });

      resData = await resp.json().catch(() => ({}));
      if (!resp.ok || resData.success === false) {
        throw new Error(resData.error || resData.detail || 'Score submission failed');
      }

      // Direct client-side submission fallback if server was unable to sync with BCP but browser has token
      const cleanTok = bcpTok ? bcpTok.replace(/^Bearer\s+/i, '').trim() : '';
      const targetPid = (resData && resData.pairing_id) || pairingId;
      if (!resData.bcp_synced && cleanTok && targetPid && !String(targetPid).startsWith('bcp-pairing-')) {
        try {
          const p1Res = p1Score > p2Score ? 2 : (p1Score === p2Score ? 1 : 0);
          const p2Res = p2Score > p1Score ? 2 : (p2Score === p1Score ? 1 : 0);
          const resolvedP1Gid = (resData && resData.p1_game_id) || p1GameId;
          const resolvedP2Gid = (resData && resData.p2_game_id) || p2GameId;
          const resolvedP1Id = (resData && resData.p1_id) || p1Id;
          const resolvedP2Id = (resData && resData.p2_id) || p2Id;
          const resolvedWinnerId = (p1Score > p2Score ? resolvedP1Id : (p2Score > p1Score ? resolvedP2Id : null)) || (resData && resData.winner_id) || null;
          const cleanTargetPid = String(targetPid).trim();

          const directPayload = {
            pairingType: "Pairing",
            isDone: true,
            player1Score: p1Score,
            player2Score: p2Score,
            player1Points: p1Score,
            player2Points: p2Score,
            player1Result: p1Res,
            player2Result: p2Res,
            player1Game: {
              points: p1Score,
              result: p1Res,
              ...(resolvedP1Gid ? { id: resolvedP1Gid } : {})
            },
            player2Game: {
              points: p2Score,
              result: p2Res,
              ...(resolvedP2Gid ? { id: resolvedP2Gid } : {})
            },
            ...(resolvedP1Gid ? { player1GameId: resolvedP1Gid } : {}),
            ...(resolvedP2Gid ? { player2GameId: resolvedP2Gid } : {}),
            ...(resolvedP1Id ? { player1Id: resolvedP1Id } : {}),
            ...(resolvedP2Id ? { player2Id: resolvedP2Id } : {}),
            ...(resolvedWinnerId ? { winnerId: resolvedWinnerId } : {}),
            metaData: {
              "p1-gamePoints": String(p1Score),
              "p2-gamePoints": String(p2Score),
              "p1-gameResult": String(p1Res),
              "p2-gameResult": String(p2Res),
              "p1-marginOfVictory": p1Score - p2Score,
              "p2-marginOfVictory": p2Score - p1Score
            }
          };

          let directResp = await fetch(`https://newprod-api.bestcoastpairings.com/v1/pairings/${encodeURIComponent(cleanTargetPid)}/submitScores`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cleanTok}`,
              'client-id': 'web-app',
              'env': 'bcp'
            },
            body: JSON.stringify(directPayload)
          });

          if (!directResp.ok) {
            directResp = await fetch(`https://newprod-api.bestcoastpairings.com/v1/pairings/${encodeURIComponent(cleanTargetPid)}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cleanTok}`,
                'client-id': 'web-app',
                'env': 'bcp'
              },
              body: JSON.stringify(directPayload)
            });
          }

          if (directResp.ok) {
            resData.bcp_synced = true;
            resData.bcp_notice = null;
          }
        } catch (de) {
          console.warn("Direct client BCP submit error:", de);
        }
      }

      if (statusEl) {
        statusEl.style.display = 'block';
        if (resData.bcp_synced) {
          statusEl.style.color = '#10b981';
          statusEl.innerHTML = `✅ Score successfully submitted and synced with Best Coast Pairings!`;
        } else if (resData.bcp_notice) {
          statusEl.style.color = '#f59e0b';
          statusEl.innerHTML = `⚠️ Best Coast Pairings sync notice: ${resData.bcp_notice}`;
        } else {
          statusEl.style.color = '#10b981';
          statusEl.innerHTML = `✅ Score successfully submitted!`;
        }
      }
      if (btn) {
        btn.style.background = resData.bcp_synced ? '#10b981' : '#f59e0b';
        btn.textContent = resData.bcp_synced ? '✓ SUBMITTED TO BCP' : 'RETRY BCP SUBMIT';
        if (resData.bcp_synced) {
          btn.disabled = true;
        } else {
          btn.disabled = false;
        }
      }

      st.is_finished = true;
      st.bcp_submitted = Boolean(resData.bcp_synced);
      st.who_went_first = firstTurnVal;
      st.terrain_layout = layoutVal;
      if (st.game) {
        st.game.terrainLayout = layoutVal;
        st.game.firstTurn = firstTurnVal;
      }
      saveLocalState(st);
      notifyStateChanged();

      return resData;

    } catch (err) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#ef4444';
        statusEl.textContent = `Error submitting to Best Coast Pairings: ${err.message}`;
      }
      if (btn) { btn.disabled = false; btn.textContent = 'RETRY BCP SUBMIT'; }
      return resData;
    }
  };

  window.__copyMatchScorecardSummary = function () {
    const matchId = getActiveMatchId();
    const raw = injectDefaultCpIntoState(originalGetItem('gdm-11e-tracker-state'));
    let st = {};
    try { st = JSON.parse(raw) || {}; } catch(e) {}
    const game = st.game || {};

    const p1 = game.p1Name || st.p1_name || 'Player 1';
    const p2 = game.p2Name || st.p2_name || 'Player 2';
    const p1S = computeTrackerPlayerVp(st.p1 || {}, st);
    const p2S = computeTrackerPlayerVp(st.p2 || {}, st);
    const p1F = game.p1Faction || st.p1_faction || '';
    const p2F = game.p2Faction || st.p2_faction || '';

    const summary = `🏆 Warhammer 40,000 Match Result
⚔️ ${p1} (${p1F}): ${p1S} VP
⚔️ ${p2} (${p2F}): ${p2S} VP
🎯 Mission: ${game.primary || st.primary_mission || 'Take & Hold'}
📄 Verified Scorecard: ${window.location.origin}/scorecard/${encodeURIComponent(matchId)}`;

    navigator.clipboard.writeText(summary);
    alert('📋 Match Summary Copied to Clipboard!');
  };

  window.__handleLogout = async function () {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
      });
    } catch (e) {}
    clearAuthToken();
    const isStandalone = ('standalone' in window.navigator && window.navigator.standalone) ||
                         (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    window.location.replace(isStandalone ? '/login' : '/');
  };

  let isNavigatingToRoom = false;

  window.__showGtLoadingOverlay = function (title, subtitle, lockNavigation) {
    if (lockNavigation) {
      isNavigatingToRoom = true;
    }
    let overlay = document.getElementById('gt-loading-overlay');
    if (!overlay && document.body) {
      overlay = document.createElement('div');
      overlay.id = 'gt-loading-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:999990;background:radial-gradient(circle at 50% 35%, rgba(18, 26, 44, 0.96), rgba(7, 11, 20, 0.99));backdrop-filter:blur(12px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;transition:opacity 0.28s ease, visibility 0.28s ease;';
      overlay.innerHTML = `
        <div style="background: rgba(18, 22, 31, 0.92); border: 1px solid rgba(56, 189, 248, 0.28); border-radius: 20px; padding: 32px 28px; max-width: 380px; width: 100%; text-align: center; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75), 0 0 40px rgba(56, 189, 248, 0.08);">
          <div style="position: relative; width: 58px; height: 58px; margin: 0 auto 18px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; inset: 0; border-radius: 50%; border: 3px solid rgba(56, 189, 248, 0.16); border-top-color: #38bdf8; border-right-color: #f59e0b; animation: gtLobbySpin 0.9s linear infinite;"></div>
            <span style="font-size: 24px;">🎲</span>
          </div>
          <div id="gt-loading-title" style="font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 800; color: #f8fafc; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 8px;"></div>
          <div id="gt-loading-subtitle" style="font-size: 12px; color: #94a3b8; line-height: 1.45;"></div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    if (overlay) {
      const tEl = document.getElementById('gt-loading-title');
      const sEl = document.getElementById('gt-loading-subtitle');
      if (tEl && title) tEl.textContent = title;
      if (sEl && subtitle) sEl.textContent = subtitle;
      overlay.classList.remove('gt-loading-hidden');
      overlay.style.opacity = '1';
      overlay.style.visibility = 'visible';
      overlay.style.pointerEvents = 'auto';
    }
  };

  window.__hideGtLoadingOverlay = function (force) {
    if (isNavigatingToRoom && !force) {
      return;
    }
    if (force) {
      isNavigatingToRoom = false;
    }
    const overlay = document.getElementById('gt-loading-overlay');
    if (overlay) {
      overlay.classList.add('gt-loading-hidden');
      overlay.style.opacity = '0';
      overlay.style.visibility = 'hidden';
      overlay.style.pointerEvents = 'none';
    }
  };

  function getCleanRoomShareUrl(mid) {
    const targetId = mid || (clientState && clientState.matchId) || getActiveMatchId() || '';
    const isAos = window.location.pathname.includes('/aos') || String(targetId).toUpperCase().startsWith('AOS-');
    const basePath = isAos ? '/11th/tracker/aos' : '/11th/tracker/play';
    return targetId
      ? `${window.location.origin}${basePath}?match_id=${encodeURIComponent(targetId)}`
      : `${window.location.origin}${basePath}`;
  }

  window.__copyRoomShareLink = function (mid, silentBtn) {
    const shareUrl = getCleanRoomShareUrl(mid);
    try {
      navigator.clipboard.writeText(shareUrl);
    } catch (e) {}
    if (silentBtn && silentBtn.tagName) {
      const orig = silentBtn.innerHTML;
      silentBtn.innerHTML = '✅ COPIED!';
      setTimeout(() => { silentBtn.innerHTML = orig; }, 1800);
      return;
    }
    alert('🔗 Room Link Copied! Share with your opponent (no account needed to join as Player 2).');
  };

  let _shareChatThreadsCache = [];
  let _shareUserSearchTimer = null;

  window.__sendRoomInviteToChat = async function (matchId, opts, btnEl) {
    const targetMid = matchId || (clientState && clientState.matchId) || getActiveMatchId();
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

  function renderShareChatTargets(matchId, threads, searchedUsers, queryStr) {
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
    const myUid = currentUser ? currentUser.id : '';
    const items = [];
    const seenUserIds = new Set();

    (threads || []).forEach(r => {
      if (!r || r.status === 'declined') return;
      const isGroup = r.is_group || String(r.id || '').startsWith('grp_');
      const isOut = r.sender_id === myUid;
      const peerId = isGroup ? null : (isOut ? r.receiver_id : r.sender_id);
      if (peerId) seenUserIds.add(peerId);
      const name = isGroup
        ? (r.receiver_name || 'Group Chat')
        : ((isOut ? r.receiver_name : r.sender_name) || 'Player');
      const sub = isGroup
        ? (r.group_type === 'league' ? '🏆 League Chat' : '⚔️ Pod Group Chat')
        : ((isOut ? r.receiver_factions : r.sender_factions) || 'OmniTactica Player Chat');
      if (q && !name.toLowerCase().includes(q) && !sub.toLowerCase().includes(q)) return;
      items.push({
        requestId: r.id,
        receiverId: peerId,
        name: name,
        subtitle: sub,
        badge: isGroup ? 'GROUP' : 'CHAT'
      });
    });

    (searchedUsers || []).forEach(u => {
      if (!u || !u.id || u.id === myUid || seenUserIds.has(u.id)) return;
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
        <button type="button" onclick="window.__sendRoomInviteToChat('${escapeHtml(matchId)}', { requestId: '${escapeHtml(item.requestId || '')}', receiverId: '${escapeHtml(item.receiverId || '')}', targetLabel: '${escapeHtml(item.name)}' }, this)" style="background:#0284c7; color:#fff; border:1px solid #38bdf8; border-radius:8px; padding:6px 11px; font-size:11px; font-weight:800; cursor:pointer; font-family:'JetBrains Mono',monospace; white-space:nowrap; flex-shrink:0;">
          📨 Send Invite
        </button>
      </div>
    `).join('');
  }

  window.__openShareRoomModal = async function (mid) {
    const matchId = mid || (clientState && clientState.matchId) || getActiveMatchId() || '';
    if (!matchId) {
      alert('No active Match Room ID found.');
      return;
    }
    const shareUrl = getCleanRoomShareUrl(matchId);
    const scorecardUrl = `${window.location.origin}/scorecard/${encodeURIComponent(matchId)}`;

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
              <div style="font-size:11px; color:#38bdf8; font-family:'JetBrains Mono',monospace;">Room #${escapeHtml(matchId)} • Guest &amp; Multi-Device Ready</div>
            </div>
          </div>
          <button type="button" onclick="document.getElementById('gt-share-room-modal').remove()" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; width:30px; height:30px; border-radius:8px; cursor:pointer; font-size:15px;">✕</button>
        </div>

        <div style="padding:18px 20px; overflow-y:auto; display:flex; flex-direction:column; gap:16px;">
          <!-- Option 1: Share via Link / Room Key (No Account Needed) -->
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
              <button type="button" id="gt-share-copy-link-btn" onclick="window.__copyRoomShareLink('${escapeHtml(matchId)}', this)" style="background:#f59e0b; color:#090d16; font-weight:800; font-size:11px; border:none; padding:9px 14px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace; white-space:nowrap;">
                📋 COPY LINK
              </button>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" id="gt-share-copy-key-btn" onclick="navigator.clipboard.writeText('${escapeHtml(matchId)}'); this.innerHTML='✅ KEY COPIED!'; setTimeout(()=>this.innerHTML='🔑 Copy Key (${escapeHtml(matchId)})', 1600);" style="flex:1; background:#1e293b; color:#f8fafc; border:1px solid #334155; border-radius:8px; padding:7px 10px; font-size:11px; font-weight:700; cursor:pointer; font-family:'JetBrains Mono',monospace;">
                🔑 Copy Key (${escapeHtml(matchId)})
              </button>
              <button type="button" id="gt-share-copy-spectator-btn" onclick="navigator.clipboard.writeText('${scorecardUrl}'); this.innerHTML='✅ SCORECARD LINK COPIED!'; setTimeout(()=>this.innerHTML='👀 Copy Spectator Scorecard Link', 1600);" style="flex:1; background:#1e293b; color:#38bdf8; border:1px solid rgba(56,189,248,0.35); border-radius:8px; padding:7px 10px; font-size:11px; font-weight:700; cursor:pointer; font-family:'JetBrains Mono',monospace;">
                👀 Copy Spectator Scorecard Link
              </button>
            </div>
          </div>

          <!-- Option 2: Share in OmniTactica Chat -->
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

          <!-- Multi-Device Same-Player Info Banner -->
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
        renderShareChatTargets(matchId, _shareChatThreadsCache, [], q);
        if (_shareUserSearchTimer) clearTimeout(_shareUserSearchTimer);
        if (q.trim().length >= 1 && token) {
          _shareUserSearchTimer = setTimeout(async () => {
            try {
              const uResp = await fetch(`/api/connect/users/search?q=${encodeURIComponent(q.trim())}`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              if (uResp.ok) {
                const uData = await uResp.json();
                renderShareChatTargets(matchId, _shareChatThreadsCache, uData.users || [], q);
              }
            } catch (e) {}
          }, 220);
        }
      });
    }

    if (!token) {
      renderShareChatTargets(matchId, [], [], '');
      return;
    }

    try {
      const resp = await fetch('/api/connect/requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        _shareChatThreadsCache = (data && data.requests) ? data.requests : [];
      }
    } catch (e) {}
    renderShareChatTargets(matchId, _shareChatThreadsCache, [], searchInput ? searchInput.value : '');
  };

  // 3. Initialize Match Room / Play / Setup / Landing
  async function init() {
    let initialHistoryPromise = null;
    if (!isPlay) {
      setTimeout(() => {
        if (typeof window.__hideGtLoadingOverlay === 'function') {
          window.__hideGtLoadingOverlay();
        }
      }, 2200);
      injectLobbyHub();
      initialHistoryPromise = syncHistoryFromDatabase();
    } else {
      // Fast-path handoff when arriving directly from Lobby Create/Join Room:
      // Avoid showing a redundant second loading screen or re-fetching /check + /join.
      try {
        const params = new URLSearchParams(window.location.search);
        const urlMid = params.get('match_id') || params.get('room') || params.get('match') || '';
        const isSpec = params.get('role') === 'spectator' || params.get('spectate') === 'true';
        const rawHandoff = sessionStorage.getItem('gt_room_handoff');
        if (rawHandoff && urlMid && !isSpec) {
          const handoff = JSON.parse(rawHandoff);
          if (
            handoff &&
            handoff.matchId &&
            handoff.matchId.toUpperCase() === urlMid.toUpperCase() &&
            Date.now() - (handoff.ts || 0) < 15000
          ) {
            sessionStorage.removeItem('gt_room_handoff');
            if (handoff.user) {
              currentUser = handoff.user;
            }
            const isTournMatch = (urlMid.startsWith('BCP-') || urlMid.startsWith('ES-') || /^(?:WH40K-|AOS-)?(?:BCP|ES)-/i.test(urlMid));
            clientState.matchId = isTournMatch ? urlMid : urlMid.toUpperCase();
            clientState.role = handoff.role || 'player1';
            saveRoomSeat(clientState.matchId, clientState.role);
            if (typeof diceRollerState !== 'undefined') {
              diceRollerState.history = [];
              diceRollerState.tray = [];
            }
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.set('match_id', clientState.matchId);
            cleanUrl.searchParams.delete('mode');
            cleanUrl.searchParams.delete('role');
            if (!getAuthToken() && (clientState.role === 'player1' || clientState.role === 'player2')) {
              cleanUrl.searchParams.set('seat', clientState.role === 'player2' ? 'p2' : 'p1');
            }
            window.history.replaceState({}, '', cleanUrl.toString());

            updateSpectatorModeUI();
            if (handoff.state) {
              applyRemoteState(handoff.state);
            }
            if (document.body) {
              document.body.classList.add('gt-role-verified');
            }
            window.__hideGtLoadingOverlay(true);
            injectMultiplayerHUD();
            injectPlayer2InviteWidget();
            attachDomActionInterceptors();
            startHybridSync();
            // Verify session quietly in background
            verifySession().then((ok) => {
              if (ok) {
                injectMultiplayerHUD();
              }
            }).catch(() => {});
            return;
          }
        }
      } catch (e) {}
    }

    const isAuthed = await verifySession();
    if (!isAuthed) {
      window.__hideGtLoadingOverlay();
      return;
    }

    if (isPlay) {
      const params = new URLSearchParams(window.location.search);
      const rawCurrent = originalGetItem('gdm-11e-tracker-state');
      let currentObj = {};
      try { currentObj = JSON.parse(rawCurrent) || {}; } catch(e) {}

      let matchId = params.get('match_id') || params.get('room') || params.get('match') || currentObj.match_id || (currentObj.id && typeof currentObj.id === 'string' && currentObj.id.startsWith('WH40K-') ? currentObj.id : null);
      if (!matchId && (params.get('eventId') || params.get('event_id')) && (params.get('table') || params.get('table_num'))) {
        const evId = params.get('eventId') || params.get('event_id');
        const rNum = params.get('round') || params.get('round_num') || 1;
        const tNum = params.get('table') || params.get('table_num') || 1;
        matchId = `BCP-${evId}-R${rNum}-T${tNum}`;
      }

      const rawExplicitRole = (params.get('role') || params.get('seat') || params.get('claim_role') || '').trim().toLowerCase();
      let resolvedClaimRole = (rawExplicitRole === 'p2' || rawExplicitRole === 'player2')
        ? 'player2'
        : ((rawExplicitRole === 'p1' || rawExplicitRole === 'player1') ? 'player1' : (rawExplicitRole || getSavedRoomSeat(matchId)));
      const isSpectatorExplicit = rawExplicitRole === 'spectator' || params.get('spectate') === 'true';
      if (isSpectatorExplicit && matchId) {
        window.__showGtLoadingOverlay(
          '👀 Spectator Mode Detected',
          'Opening Live Digital Scorecard...',
          true
        );
        window.location.replace(`/scorecard/${encodeURIComponent(matchId)}`);
        return;
      }

      let chkData = {};
      const guestId = getOrCreateGuestId();

      if (matchId) {
        window.__showGtLoadingOverlay(
          '⚔️ Entering Tabletop Room',
          `Verifying player seat for Room #${matchId}...`
        );
        // Direct URL or History access: verify room and determine if player or spectator during loading screen!
        try {
          const chk = await fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/check?guest_id=${encodeURIComponent(guestId)}`, {
            headers: {
              'Authorization': `Bearer ${getAuthToken()}`,
              'X-Guest-Id': guestId
            }
          });
          chkData = await chk.json();
          if (chkData.user_id_p1) clientState.userIdP1 = chkData.user_id_p1;
          if (chkData.user_id_p2) clientState.userIdP2 = chkData.user_id_p2;
          if (!chk.ok || !chkData.exists) {
            alert(`❌ Room Key "${matchId}" does not exist or has expired.`);
            window.location.href = clientState.isGuest ? '/' : '/11th/tracker';
            return;
          }
          if (chkData.is_finished) {
            window.__showGtLoadingOverlay(
              '🏁 Match Concluded',
              'Opening Verified Final Digital Scorecard...',
              true
            );
            window.location.replace(`/scorecard/${encodeURIComponent(matchId)}`);
            return;
          }
          const wouldBeSpectator = Boolean(
            !chkData.is_referee &&
            chkData.role !== 'referee' &&
            (chkData.is_spectator || chkData.role === 'spectator' || (chkData.is_full && !chkData.is_open_for_p2 && chkData.role !== 'player1' && chkData.role !== 'player2'))
          );
          if (wouldBeSpectator) {
            const canAutoReclaimSavedGuestSeat = Boolean(
              (resolvedClaimRole === 'player2' && chkData.can_reclaim_guest_p2) ||
              (resolvedClaimRole === 'player1' && chkData.can_reclaim_guest_p1)
            );
            if (!canAutoReclaimSavedGuestSeat && (chkData.can_reclaim_guest_p2 || chkData.can_reclaim_guest_p1)) {
              const choice = await promptGuestRejoinOrSpectate(matchId, chkData);
              if (choice === 'spectator') {
                window.__showGtLoadingOverlay(
                  '👀 Spectator Mode Detected',
                  'Opening Live Digital Scorecard...',
                  true
                );
                window.location.replace(`/scorecard/${encodeURIComponent(matchId)}`);
                return;
              }
              resolvedClaimRole = choice;
            } else if (!canAutoReclaimSavedGuestSeat) {
              // Both seats are held by registered users -> route 3rd user to Digital Scorecard
              window.__showGtLoadingOverlay(
                '👀 Spectator Mode Detected',
                'Room has 2 active players — redirecting to Live Digital Scorecard...',
                true
              );
              window.location.replace(`/scorecard/${encodeURIComponent(matchId)}`);
              return;
            }
          }
        } catch (e) {}
      } else {
        // No match_id provided: create new collision-free room via API
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
            matchId = data.match_id;
            clientState.matchId = matchId;
            clientState.role = data.role || 'player1';
            saveRoomSeat(matchId, clientState.role);
            updateSpectatorModeUI();
            if (clientState.role === 'spectator') return;
            applyRemoteState(data.state);
          }
        } catch (e) {}
      }

      if (!matchId) {
        window.location.href = '/11th/tracker';
        return;
      }

      const isTournMatch = (matchId.startsWith('BCP-') || matchId.startsWith('ES-') || /^(?:WH40K-|AOS-)?(?:BCP|ES)-/i.test(matchId));
      if (isTournMatch) {
        clientState.matchId = matchId;
      } else {
        clientState.matchId = matchId.toUpperCase();
      }
      if (typeof diceRollerState !== 'undefined') {
        diceRollerState.history = [];
        diceRollerState.tray = [];
      }

      // Join room during loading screen to bind Player 1 / Player 2 slot or detect 3rd-user Spectator (Strict 2-Player Capacity)
      try {
        const myName = currentUser ? (currentUser.display_name || (currentUser.email ? currentUser.email.split('@')[0] : '')) : '';
        const resp = await fetch(`/api/tracker/room/${clientState.matchId}/join`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`,
            'X-Guest-Id': guestId
          },
          body: JSON.stringify({
            token: getAuthToken(),
            guest_id: guestId,
            player_name: myName || undefined,
            claim_role: isSpectatorExplicit ? 'spectator' : (resolvedClaimRole || undefined)
          })
        });
        if (resp.ok) {
          const joinData = await resp.json();
          if (joinData.is_finished || joinData.role === 'spectator') {
            window.__showGtLoadingOverlay(
              joinData.is_finished ? '🏁 Match Concluded' : '👀 Spectator Mode Detected',
              joinData.is_finished
                ? 'Opening Verified Final Digital Scorecard...'
                : 'Room has 2 active players — redirecting to Live Digital Scorecard...',
              true
            );
            window.location.replace(`/scorecard/${encodeURIComponent(clientState.matchId)}`);
            return;
          }
          clientState.role = joinData.role || 'player2';
          saveRoomSeat(clientState.matchId, clientState.role);
          if (joinData.user_id_p1) clientState.userIdP1 = joinData.user_id_p1;
          if (joinData.user_id_p2) clientState.userIdP2 = joinData.user_id_p2;
          if (joinData.version) clientState.version = Math.max(clientState.version || 0, Number(joinData.version) || 1);
          updateSpectatorModeUI();
          if (joinData.state) {
            applyRemoteState(joinData.state);
          }
        }
      } catch (e) {}

      // Clean URL bar: keep match_id (and ?seat=p2 for Guests so refreshing or tab recovery always retains their seat)
      const url = new URL(window.location.href);
      url.searchParams.set('match_id', clientState.matchId);
      url.searchParams.delete('mode');
      url.searchParams.delete('role');
      if (!getAuthToken() && (clientState.role === 'player1' || clientState.role === 'player2')) {
        url.searchParams.set('seat', clientState.role === 'player2' ? 'p2' : 'p1');
      }
      window.history.replaceState({}, '', url.toString());

      if (clientState.role === 'spectator') {
        window.__showGtLoadingOverlay(
          '👀 Spectator Mode Detected',
          'Room has 2 active players — redirecting to Live Digital Scorecard...',
          true
        );
        window.location.replace(`/scorecard/${encodeURIComponent(clientState.matchId)}`);
        return;
      }

      // Role verified as active player/referee — reveal Game Tracker UI and dismiss loading overlay
      if (document.body) {
        document.body.classList.add('gt-role-verified');
      }
      injectMultiplayerHUD();
      injectPlayer2InviteWidget();
      attachDomActionInterceptors();
      startHybridSync();
      window.__hideGtLoadingOverlay(true);
    } else {
      // Landing page (/11th/tracker or /tracker)
      renderUserBar();
      if (!initialHistoryPromise) {
        await syncHistoryFromDatabase();
      } else {
        await initialHistoryPromise;
        renderHistoryList(dbHistoryCache);
      }
      startHistoryPolling();
      window.__hideGtLoadingOverlay();
    }
  }

  // Global Handlers for Room Creation and Joining
  window.__handleCreateRoom = async function (gameSystemOverride) {
    const isAosMode = (gameSystemOverride === 'aos') ||
      window.location.pathname.includes('/aos') ||
      window.location.search.includes('game_system=aos') ||
      window.location.search.includes('system=aos');
    const sysId = isAosMode ? 'aos' : '40k';
    const loadingTitle = isAosMode ? '⚡ Creating Age of Sigmar Room' : '🎲 Creating Match Room';
    const loadingSubtitle = 'Allocating tabletop room key & initializing mission setup...';
    isNavigatingToRoom = true;
    window.__showGtLoadingOverlay(loadingTitle, loadingSubtitle, true);
    try {
      const resp = await fetch('/api/tracker/room/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`,
          'X-Game-System': sysId
        },
        body: JSON.stringify({
          token: getAuthToken(),
          game_system: sysId,
          p1_name: currentUser ? (currentUser.display_name || 'Player 1') : 'Player 1'
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        const mid = data.match_id || '';
        const isAosMatch = isAosMode || mid.startsWith('AOS-') || data.game_system === 'aos';
        if (data.state && mid) {
          data.state.id = mid;
          data.state.match_id = mid;
        }
        try {
          sessionStorage.setItem('gt_room_handoff', JSON.stringify({
            matchId: mid,
            role: data.role || 'player1',
            gameSystem: isAosMatch ? 'aos' : '40k',
            state: data.state || null,
            user: currentUser || null,
            loadingTitle: loadingTitle,
            loadingSubtitle: loadingSubtitle,
            ts: Date.now()
          }));
        } catch (e) {}
        if (isAosMatch) {
          if (data.state) {
            originalSetItem('omni-aos-tracker-state', JSON.stringify(data.state));
          }
          window.location.href = `/11th/tracker/aos?match_id=${encodeURIComponent(mid)}`;
        } else {
          if (data.state) {
            originalSetItem('gdm-11e-tracker-state', JSON.stringify(data.state));
          }
          window.location.href = `/11th/tracker/play?match_id=${encodeURIComponent(mid)}`;
        }
        return;
      }
    } catch (err) {}
    if (isAosMode) {
      window.location.href = '/11th/tracker/aos?solo=true';
    } else {
      window.location.href = '/11th/tracker/play';
    }
  };

  window.__handleJoinRoomInput = async function () {
    const isAosMode = window.location.pathname.includes('/aos') ||
      window.location.search.includes('game_system=aos') ||
      window.location.search.includes('system=aos');
    const input = document.getElementById('gt-lobby-join-input');
    const errDiv = document.getElementById('gt-lobby-join-error');
    const btn = document.getElementById('gt-lobby-join-btn');
    let code = (input.value || '').trim();
    if (code.includes('match_id=')) {
      try { code = new URL(code).searchParams.get('match_id') || code; } catch(e) {}
    }
    if (!code) {
      if (errDiv) { errDiv.textContent = 'Please enter a Room Key.'; errDiv.style.display = 'block'; }
      return;
    }

    code = code.toUpperCase().replace(/\s+/g, '');
    if (!code.startsWith('WH40K-') && !code.startsWith('AOS-') && code.length === 8) {
      code = (isAosMode ? 'AOS-' : 'WH40K-') + `${code.substring(0, 4)}-${code.substring(4)}`;
    }

    if (errDiv) errDiv.style.display = 'none';
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    const loadingTitle = '🔗 Joining Tabletop Room';
    const loadingSubtitle = `Connecting to Room #${code}...`;
    isNavigatingToRoom = true;
    window.__showGtLoadingOverlay(loadingTitle, loadingSubtitle, true);

    // Verify if room exists on the server!
    const guestId = getOrCreateGuestId();
    try {
      const resp = await fetch(`/api/tracker/room/${encodeURIComponent(code)}/check?guest_id=${encodeURIComponent(guestId)}`, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`,
          'X-Guest-Id': guestId,
          'X-Game-System': isAosMode ? 'aos' : '40k'
        }
      });
      const data = await resp.json();
      if (!resp.ok || !data.exists) {
        window.__hideGtLoadingOverlay(true);
        if (errDiv) {
          errDiv.textContent = `❌ Room "${code}" does not exist. Please check with your opponent.`;
          errDiv.style.display = 'block';
        }
        if (btn) { btn.disabled = false; btn.textContent = 'JOIN'; }
        return;
      }

      const isAosMatch = isAosMode || code.startsWith('AOS-') || data.game_system === 'aos';
      const playBaseUrl = isAosMatch ? '/11th/tracker/aos' : '/11th/tracker/play';
      const targetMid = data.match_id || code;
      let lobbyClaimRole = getSavedRoomSeat(targetMid) || undefined;

      if (data.is_full && !data.is_open_for_p2 && !data.is_referee && data.role !== 'player1' && data.role !== 'player2') {
        if (!data.is_finished && (data.can_reclaim_guest_p2 || data.can_reclaim_guest_p1)) {
          const choice = await promptGuestRejoinOrSpectate(targetMid, data);
          if (choice === 'spectator') {
            window.location.href = `/scorecard/${encodeURIComponent(targetMid)}`;
            return;
          }
          lobbyClaimRole = choice;
          window.__showGtLoadingOverlay(loadingTitle, `Reconnecting to Room #${targetMid} as ${choice === 'player2' ? 'Player 2' : 'Player 1'}...`, true);
        } else {
          window.__hideGtLoadingOverlay(true);
          const proceed = confirm(`⚠️ Room "${code}" already has 2 active players (${data.p1_name} vs ${data.p2_name}). View Scorecard as Spectator?`);
          if (!proceed) {
            if (btn) { btn.disabled = false; btn.textContent = 'JOIN'; }
            return;
          }
          window.location.href = `/scorecard/${encodeURIComponent(targetMid)}`;
          return;
        }
      }

      // Pre-join room during Lobby overlay so play.html/aos.html opens with zero second loading screen
      try {
        const myName = currentUser ? (currentUser.display_name || (currentUser.email ? currentUser.email.split('@')[0] : '')) : '';
        const joinResp = await fetch(`/api/tracker/room/${encodeURIComponent(targetMid)}/join`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`,
            'X-Guest-Id': guestId
          },
          body: JSON.stringify({
            token: getAuthToken(),
            guest_id: guestId,
            player_name: myName || undefined,
            claim_role: lobbyClaimRole
          })
        });
        if (joinResp.ok) {
          const joinData = await joinResp.json();
          if (joinData.is_finished || joinData.role === 'spectator') {
            window.location.href = `/scorecard/${encodeURIComponent(targetMid)}`;
            return;
          }
          saveRoomSeat(targetMid, joinData.role || 'player2');
          if (joinData.state) {
            joinData.state.id = targetMid;
            joinData.state.match_id = targetMid;
            originalSetItem(isAosMatch ? 'omni-aos-tracker-state' : 'gdm-11e-tracker-state', JSON.stringify(joinData.state));
          }
          sessionStorage.setItem('gt_room_handoff', JSON.stringify({
            matchId: targetMid,
            role: joinData.role || 'player2',
            gameSystem: isAosMatch ? 'aos' : '40k',
            state: joinData.state || null,
            user: currentUser || null,
            loadingTitle: loadingTitle,
            loadingSubtitle: loadingSubtitle,
            ts: Date.now()
          }));
        }
      } catch (e) {}

      const seatSuffix = (!getAuthToken() && (lobbyClaimRole === 'player2' || lobbyClaimRole === 'player1'))
        ? `&seat=${lobbyClaimRole === 'player2' ? 'p2' : 'p1'}`
        : '';
      window.location.href = `${playBaseUrl}?match_id=${encodeURIComponent(targetMid)}${seatSuffix}`;
    } catch (err) {
      window.__hideGtLoadingOverlay(true);
      if (errDiv) {
        errDiv.textContent = 'Connection error checking room status. Please try again.';
        errDiv.style.display = 'block';
      }
      if (btn) { btn.disabled = false; btn.textContent = 'JOIN'; }
    }
  };

  // 4. Landing Page: Inject Mobile-Friendly 2-Player Room Key Generator & Join Card
  function injectLobbyHub() {
    function tryInject() {
      const main = document.querySelector('main') || document.body;
      if (!main) return;

      const isAosMode = window.location.pathname.includes('/aos') ||
        window.location.search.includes('game_system=aos') ||
        window.location.search.includes('system=aos');

      let wrapper = document.getElementById('gt-lobby-wrapper');
      if (!wrapper || !document.body.contains(wrapper)) {
        wrapper = document.createElement('div');
        wrapper.id = 'gt-lobby-wrapper';
        wrapper.style.cssText = "width:100%; max-width:820px; margin:0 auto; padding:12px; box-sizing:border-box; display:block !important; visibility:visible !important; opacity:1 !important;";

        const lobbyTitle = isAosMode ? '⚡ AGE OF SIGMAR 2-PLAYER MATCH LOBBY' : '2-PLAYER MATCH LOBBY';
        const lobbyBadge = isAosMode
          ? `<span style="font-size:10px; font-weight:700; color:#f59e0b; background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3); padding:3px 8px; border-radius:9999px; font-family:'JetBrains Mono',monospace;">⚡ Age of Sigmar</span>`
          : `<span style="font-size:10px; font-weight:700; color:var(--accent, #38bdf8); background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.3); padding:3px 8px; border-radius:9999px; font-family:'JetBrains Mono',monospace;">2 Players Max</span>`;

        const hostTitle = isAosMode ? '⚡ Host an AoS Match' : '🎲 Host a Match';
        const hostDesc = isAosMode
          ? 'Create a match room and begin battleplan & army setup with shareable room code.'
          : 'Create a match room and begin army setup with shareable room code.';
        const hostBtnText = isAosMode ? 'CREATE & ENTER AOS MATCH ➔' : 'CREATE & ENTER MATCH ➔';
        const hostBtnCall = isAosMode ? "window.__handleCreateRoom('aos')" : "window.__handleCreateRoom('40k')";

        const joinTitle = isAosMode ? '🔗 Join AoS Room Key' : '🔗 Join Room Key';
        const joinPlaceholder = isAosMode ? 'e.g. AOS-7A9B-3C4D' : 'e.g. WH40K-7A9B-3C4D';
        const joinBtnColor = isAosMode ? '#f59e0b' : 'var(--accent, #38bdf8)';

        wrapper.innerHTML = `
          <div id="gt-lobby-hub-card" style="margin:16px 0 24px; background:var(--bg-secondary, #12161f); border:1px solid var(--border, #273042); border-radius:18px; padding:18px; box-shadow:0 12px 35px rgba(0,0,0,0.5); width:100%; box-sizing:border-box; display:block !important; visibility:visible !important;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; border-bottom:1px solid var(--border, #273042); padding-bottom:10px; flex-wrap:wrap; gap:8px;">
              <div>
                <h3 style="font-size:15px; font-weight:800; color:var(--text-primary, #f0f4fc); margin:0; font-family:'JetBrains Mono',monospace; letter-spacing:0.04em;">${lobbyTitle}</h3>
                <p style="font-size:11px; color:var(--text-secondary, #94a3b8); margin:2px 0 0;">Create a room key to host or enter a code to join an opponent's table.</p>
              </div>
              ${lobbyBadge}
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:14px;">
              <!-- Host Card -->
              <div style="background:var(--bg-card, #181d28); border:1px solid var(--border, #273042); border-radius:14px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box;">
                <div>
                  <div style="font-size:12px; font-weight:800; color:#f59e0b; text-transform:uppercase; margin-bottom:4px; font-family:'JetBrains Mono',monospace;">${hostTitle}</div>
                  <p style="font-size:11px; color:var(--text-secondary, #94a3b8); margin:0 0 12px; line-height:1.4;">${hostDesc}</p>
                </div>
                <div>
                  <button onclick="${hostBtnCall}" style="width:100%; box-sizing:border-box; background:#f59e0b; color:#0a0c10; font-weight:800; font-size:12px; text-transform:uppercase; border:none; padding:12px; border-radius:10px; cursor:pointer; letter-spacing:0.06em; font-family:'JetBrains Mono',monospace; transition:opacity 0.2s;">
                    ${hostBtnText}
                  </button>
                </div>
              </div>

              <!-- Join Card -->
              <div style="background:var(--bg-card, #181d28); border:1px solid var(--border, #273042); border-radius:14px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box;">
                <div>
                  <div style="font-size:12px; font-weight:800; color:${joinBtnColor}; text-transform:uppercase; margin-bottom:4px; font-family:'JetBrains Mono',monospace;">${joinTitle}</div>
                  <p style="font-size:11px; color:var(--text-secondary, #94a3b8); margin:0 0 10px; line-height:1.4;">Enter the 8-character Room Key provided by your opponent.</p>
                </div>
                <div>
                  <div id="gt-lobby-join-error" style="display:none; color:var(--loss, #ef4444); font-size:11px; font-weight:600; margin-bottom:6px; font-family:'JetBrains Mono',monospace;"></div>
                  <div style="display:flex; gap:8px;">
                    <input id="gt-lobby-join-input" type="text" placeholder="${joinPlaceholder}" style="flex:1; min-width:0; background:var(--bg-primary, #0a0c10); border:1px solid var(--border, #273042); border-radius:8px; padding:10px; font-family:'JetBrains Mono',monospace; font-size:13px; color:var(--text-primary, #f0f4fc); outline:none; text-transform:uppercase; box-sizing:border-box;" onkeydown="if(event.key==='Enter')window.__handleJoinRoomInput()" />
                    <button id="gt-lobby-join-btn" onclick="window.__handleJoinRoomInput()" style="background:${joinBtnColor}; color:#0a0c10; font-weight:800; font-size:12px; text-transform:uppercase; border:none; padding:10px 14px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace; white-space:nowrap;">ENTER ROOM ➔</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div id="gt-history-section" style="margin:20px 0 40px; width:100%; box-sizing:border-box; display:block !important; visibility:visible !important;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
              <div style="font-size:14px; font-weight:800; color:var(--text-primary, #f0f4fc); font-family:'JetBrains Mono',monospace; letter-spacing:0.04em;">
                ${isAosMode ? 'AOS MATCH HISTORY' : 'GAME HISTORY'} <span id="gt-history-count" style="font-size:12px; color:var(--accent, #38bdf8); font-weight:700; margin-left:4px;"></span>
              </div>
              <button id="gt-btn-import-games" type="button" onclick="window.openTrackerImportModal && window.openTrackerImportModal()" style="background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.35); color:#38bdf8; font-size:11px; font-weight:800; padding:6px 12px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace; display:inline-flex; align-items:center; gap:5px;">
                📥 IMPORT GAMES
              </button>
            </div>
            <div id="gt-history-list" style="display:flex; flex-direction:column; gap:10px;">
              <div style="color:var(--text-muted, #64748b); font-size:12px; font-family:'JetBrains Mono',monospace; padding:18px; text-align:center; background:var(--bg-secondary, #12161f); border-radius:14px; border:1px solid var(--border, #273042);">
                Loading match history...
              </div>
            </div>
          </div>
        `;

        if (main.firstChild) {
          main.insertBefore(wrapper, main.firstChild);
        } else {
          main.appendChild(wrapper);
        }
      }

      hideNativeGdmEmptyState();
      renderHistoryList(dbHistoryCache);
      if (typeof window.__hideGtLoadingOverlay === 'function') {
        window.__hideGtLoadingOverlay();
      }
    }

    // Immediately render the Lobby Hub and User Bar so it never waits on a DOM mutation!
    tryInject();
    renderUserBar();

    let isObserverRunning = false;
    const observer = new MutationObserver(() => {
      if (isObserverRunning) return;
      isObserverRunning = true;
      try {
        hideNativeGdmEmptyState();
        if (!document.getElementById('gt-lobby-wrapper')) {
          tryInject();
        }
        if (!document.getElementById('gt-user-status-bar')) {
          renderUserBar();
        }
      } finally {
        setTimeout(() => { isObserverRunning = false; }, 200);
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
          <p style="font-size:13px; color:#94a3b8; margin:6px 0 18px;">Share this Room Key with Player 2 to begin collaborative setup (no account required for Player 2).</p>
          
          <div style="background:#070b14; border:2px dashed #f59e0b; border-radius:14px; padding:16px; margin-bottom:18px;">
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#94a3b8; margin-bottom:4px; letter-spacing:0.08em;">ROOM KEY</div>
            <div style="font-size:26px; font-weight:900; color:#f59e0b; font-family:'JetBrains Mono',monospace; letter-spacing:0.1em;">${matchId}</div>
          </div>

          <div style="display:flex; gap:8px; margin-bottom:10px;">
            <input readonly value="${inviteUrl}" style="flex:1; background:#070b14; border:1px solid #334155; border-radius:8px; padding:10px; font-size:11px; color:#cbd5e1; font-family:'JetBrains Mono',monospace; outline:none;" />
            <button onclick="window.__copyRoomShareLink('${escapeHtml(matchId)}', this)" style="background:#0284c7; color:#fff; font-weight:800; font-size:11px; border:none; padding:10px 14px; border-radius:8px; cursor:pointer;">
              COPY LINK
            </button>
          </div>
          <div style="margin-bottom:18px;">
            <button onclick="window.__openShareRoomModal('${escapeHtml(matchId)}')" style="width:100%; background:rgba(56,189,248,0.14); color:#38bdf8; border:1px solid rgba(56,189,248,0.4); font-weight:800; font-size:12px; padding:9px 14px; border-radius:8px; cursor:pointer; font-family:'JetBrains Mono',monospace;">
              💬 SHARE IN OMNITACTICA CHAT
            </button>
          </div>

          <div style="display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:24px; font-size:13px; color:#f59e0b;">
            <span id="gt-waiting-status-dot" style="width:8px; height:8px; border-radius:50%; background:#f59e0b; display:inline-block; animation:pulse 1.5s infinite;"></span>
            <span id="gt-waiting-status-text">Waiting for Player 2 to join (1/2 Players)...</span>
          </div>

          <button onclick="window.location.href='/11th/tracker/play?match_id=${matchId}'" style="width:100%; background:#10b981; color:#0f172a; font-weight:800; font-size:14px; text-transform:uppercase; border:none; padding:14px; border-radius:11px; cursor:pointer; font-family:'JetBrains Mono',monospace; letter-spacing:0.06em;">
            ENTER SETUP SCREEN ➔
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    let hasAdvanced = false;
    let sse = null;
    let pollTimer = null;

    function advanceToSetup(name) {
      if (hasAdvanced) return;
      hasAdvanced = true;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      if (sse) { try { sse.close(); } catch(e) {} sse = null; }
      const statusText = document.getElementById('gt-waiting-status-text');
      const statusDot = document.getElementById('gt-waiting-status-dot');
      if (statusText) {
        statusText.textContent = `🟢 Player 2 Connected (${name || 'Ready'})! Entering setup...`;
        statusText.style.color = '#10b981';
      }
      if (statusDot) {
        statusDot.style.background = '#10b981';
      }
      setTimeout(() => {
        window.location.href = `/11th/tracker/play?match_id=${matchId}`;
      }, 700);
    }

    function startP2FallbackPolling() {
      if (pollTimer || hasAdvanced) return;
      pollTimer = setInterval(async () => {
        if (hasAdvanced) { clearInterval(pollTimer); pollTimer = null; return; }
        if (document.hidden) return;
        try {
          const resp = await fetch(`/api/tracker/room/${matchId}`);
          if (resp.ok) {
            const data = await resp.json();
            if (data.user_id_p2 || (data.state && data.state.user_id_p2) || (data.state && data.state.game && data.state.game.p2Name && data.state.game.p2Name !== 'Player 2')) {
              advanceToSetup(data.state && data.state.game ? data.state.game.p2Name : '');
            }
          }
        } catch (e) {}
      }, 3000);
    }

    // 1. Listen for P2 connection over SSE in real time
    try {
      sse = new EventSource(`/api/tracker/room/${matchId}/stream?client_id=host_${Date.now()}`);
      sse.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state_update' && msg.state && (msg.state.user_id_p2 || (msg.state.game && msg.state.game.p2Name && msg.state.game.p2Name !== 'Player 2'))) {
            advanceToSetup(msg.state.game ? msg.state.game.p2Name : '');
          }
        } catch (e) {}
      };

      sse.onerror = () => {
        // SSE disconnected or blocked: start slow fallback polling
        startP2FallbackPolling();
      };
    } catch (e) {
      startP2FallbackPolling();
    }
  }

  // 5. Step 1: 2-Player Invite & Setup Helper inside Play Screen
  function injectPlayer2InviteWidget() {
    if (clientState.role === 'spectator') return;
    function tryInjectWidget() {
      const existing = document.getElementById('gt-invite-widget');
      if (existing && document.body.contains(existing)) return;

      const stepTitle = document.querySelector('h2');
      if (stepTitle && stepTitle.textContent.includes('PLAYERS')) {
        const rawState = originalGetItem('gdm-11e-tracker-state');
        let stateObj = {};
        try { stateObj = JSON.parse(rawState); } catch(e) {}

        const p2Connected = Boolean(clientState.userIdP2 || stateObj.user_id_p2 || (stateObj.game && stateObj.game.p2Name && stateObj.game.p2Name !== 'Player 2') || clientState.role === 'player2');
        const inviteUrl = getCleanRoomShareUrl(clientState.matchId);

        const widget = document.createElement('div');
        widget.id = 'gt-invite-widget';
        widget.style.cssText = "margin-bottom:16px; background:#0f172a; border:1px solid #1e293b; border-radius:14px; padding:14px 16px;";
        
        if (!p2Connected) {
          widget.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
              <span style="font-size:12px; font-weight:800; color:#38bdf8; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">⚔️ Room Key: ${clientState.matchId} (1/2 Players)</span>
              <span style="display:flex; align-items:center; gap:6px; font-size:11px; color:#f59e0b;">
                <span style="width:6px; height:6px; border-radius:50%; background:#f59e0b; display:inline-block;"></span>
                Waiting for Player 2...
              </span>
            </div>
            <p style="margin:0 0 10px; font-size:12px; color:#94a3b8;">Share this link or invite via OmniTactica Chat (no account needed for Player 2 to join as Guest):</p>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <input readonly value="${inviteUrl}" style="flex:1; min-width:180px; background:#070b14; border:1px solid #334155; border-radius:8px; padding:8px 10px; font-size:11px; color:#cbd5e1; font-family:'JetBrains Mono',monospace; outline:none;" />
              <button onclick="window.__copyRoomShareLink('${escapeHtml(clientState.matchId)}', this);" style="background:#f59e0b; color:#0f172a; font-weight:800; font-size:11px; text-transform:uppercase; border:none; padding:8px 14px; border-radius:8px; cursor:pointer; letter-spacing:0.04em; white-space:nowrap;">
                📋 COPY LINK
              </button>
              <button onclick="window.__openShareRoomModal('${escapeHtml(clientState.matchId)}');" style="background:#0284c7; color:#fff; font-weight:800; font-size:11px; text-transform:uppercase; border:none; padding:8px 14px; border-radius:8px; cursor:pointer; letter-spacing:0.04em; white-space:nowrap;">
                💬 SHARE IN CHAT
              </button>
            </div>
          `;
        } else {
          widget.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
              <span style="font-size:12px; font-weight:800; color:#10b981; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">🟢 Connected: Player 1 vs Player 2 (${escapeHtml(stateObj.game && stateObj.game.p2Name ? stateObj.game.p2Name : 'Opponent')})</span>
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:11px; color:#94a3b8; font-family:'JetBrains Mono',monospace;">2/2 Players Active (Live Sync)</span>
                <button onclick="window.__openShareRoomModal('${escapeHtml(clientState.matchId)}');" style="background:rgba(56,189,248,0.14); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); border-radius:6px; padding:4px 9px; font-size:10.5px; font-weight:800; cursor:pointer; font-family:'JetBrains Mono',monospace;">
                  🔗 Share / Spectator Link
                </button>
              </div>
            </div>
          `;
        }

        stepTitle.parentNode.insertBefore(widget, stepTitle.nextSibling);
      }
    }

    tryInjectWidget();
    const observer = new MutationObserver(tryInjectWidget);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function hideNativeGdmEmptyState() {
    if (!isPlay) {
      // 1. Maintain body class
      if (!document.body.classList.contains('is-tracker-lobby')) {
        document.body.classList.add('is-tracker-lobby');
      }
      document.body.classList.remove('is-tracker-play');
    }
  }

  function renderHistoryList(historyList) {
    const list = (historyList && Array.isArray(historyList)) ? historyList : (dbHistoryCache || []);
    const container = document.getElementById('gt-history-list');
    const countEl = document.getElementById('gt-history-count');
    if (!container) return;

    const isAosMode = window.location.pathname.includes('/aos') ||
      window.location.search.includes('game_system=aos') ||
      window.location.search.includes('system=aos');

    // 1. Authoritative Completed Matches from PostgreSQL (prefer normalized dbHistoryCache items when available)
    const normalizedFinished = list.filter(it => it && (it.isFinished || it.is_finished));
    const completedHistory = normalizedFinished.length > 0
      ? normalizedFinished
      : ((window.gtCompletedHistory && window.gtCompletedHistory.length > 0) ? window.gtCompletedHistory : []);

    const completedIds = new Set(completedHistory.map(c => (c.match_id || c.id || '').trim().toUpperCase()));

    // 2. Active Matches are strictly those NOT finished in PostgreSQL
    const rawActive = (window.gtActiveMatches && Array.isArray(window.gtActiveMatches))
      ? window.gtActiveMatches
      : [];

    const activeList = rawActive.filter(a => {
      const mid = (a.match_id || a.id || '').trim().toUpperCase();
      return mid && !completedIds.has(mid) && !a.is_finished && a.status !== 'completed' && a.status !== 'abandoned' && !a.is_abandoned;
    });

    const activeIds = new Set(activeList.map(a => (a.match_id || a.id || '').trim().toUpperCase()));

    const completed = completedHistory.filter(item => {
      const mid = (item.match_id || item.id || '').trim().toUpperCase();
      return mid && !activeIds.has(mid);
    });

    const filterBySystem = (items) => {
      return items.filter(it => {
        const mid = (it.match_id || it.id || '').trim().toUpperCase();
        const itSys = it.game_system || (mid.startsWith('AOS-') ? 'aos' : '40k');
        return isAosMode ? (itSys === 'aos' || mid.startsWith('AOS-')) : (itSys !== 'aos' && !mid.startsWith('AOS-'));
      });
    };

    const scopedActiveList = filterBySystem(activeList);
    const scopedCompleted = filterBySystem(completed);

    const totalCount = scopedActiveList.length + scopedCompleted.length;
    if (countEl) {
      countEl.textContent = totalCount > 0 ? `(${totalCount})` : '';
    }

    if (scopedActiveList.length === 0 && scopedCompleted.length === 0) {
      if (isHistoryLoading) {
        container.innerHTML = `
          <div style="color:var(--text-muted, #64748b); font-size:12px; font-family:'JetBrains Mono',monospace; padding:18px; text-align:center; background:var(--bg-secondary, #12161f); border-radius:14px; border:1px solid var(--border, #273042);">
            Loading match history...
          </div>
        `;
        return;
      }
      const emptyMsg = isAosMode
        ? 'No Age of Sigmar matches logged yet. Click <b>CREATE & ENTER AOS MATCH</b> above to start your first game!'
        : 'No matches logged yet. Click <b>CREATE & ENTER MATCH</b> above to start your first game!';
      container.innerHTML = `
        <div style="color:var(--text-secondary, #94a3b8); font-size:12px; font-family:'JetBrains Mono',monospace; padding:18px; text-align:center; background:var(--bg-secondary, #12161f); border-radius:14px; border:1px solid var(--border, #273042);">
          ${emptyMsg}
        </div>
      `;
      return;
    }

    let outHtml = '';

    // 1. Active Matches Section (All in Green Cards)
    if (scopedActiveList.length > 0) {
      outHtml += `
        <div style="margin-bottom:18px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-family:'JetBrains Mono',monospace; flex-wrap:wrap; gap:4px;">
            <span style="font-size:11px; font-weight:800; color:var(--win, #22c55e); text-transform:uppercase;">🟢 Active Matches (${scopedActiveList.length})</span>
            <span style="font-size:10px; color:var(--text-secondary, #94a3b8);">⏳ Uncompleted games auto-purge after 14 days</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${scopedActiveList.map(m => {
              const p1 = m.game?.p1Name || m.p1_name || 'Player 1';
              const p2 = m.game?.p2Name || m.p2_name || 'Player 2';
              const p1F = m.game?.p1Faction || m.p1_faction || '';
              const p2F = m.game?.p2Faction || m.p2_faction || '';
              const p1S = m.p1Score ?? m.p1_score ?? 0;
              const p2S = m.p2Score ?? m.p2_score ?? 0;
              const mid = m.match_id || m.id || '';
              const shortId = String(mid).replace('WH40K-', '').replace('AOS-', '');
              const rNum = m.round || m.current_round || 1;
              const createdDate = m.created_at || m.date || m.timestamp;
              const dateLabel = createdDate ? new Date(createdDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';

              const uId = currentUser ? currentUser.id : null;
              const uName = currentUser ? (currentUser.display_name || currentUser.name || '').trim().toLowerCase() : '';
              const p1Uid = m.user_id_p1 || (m.participants && m.participants.player1 && m.participants.player1.uid);
              const p2Uid = m.user_id_p2 || (m.participants && m.participants.player2 && m.participants.player2.uid);
              const p1NameStr = (m.game?.p1Name || m.p1_name || '').trim().toLowerCase();
              const p2NameStr = (m.game?.p2Name || m.p2_name || '').trim().toLowerCase();
              const isRegisteredPlayer = !currentUser || (uId && (uId === p1Uid || uId === p2Uid)) || (uName && (uName === p1NameStr || uName === p2NameStr));

              const isAosGame = isAosMode || String(mid).toUpperCase().startsWith('AOS-') || m.game_system === 'aos';
              const resumeUrl = isAosGame
                ? `/11th/tracker/aos?match_id=${encodeURIComponent(mid)}`
                : `/11th/tracker/play?match_id=${encodeURIComponent(mid)}`;

              return `
                <div data-active-match-id="${escapeHtml(mid)}" style="background:var(--win-bg, rgba(34,197,94,0.08)); border:1px solid rgba(34,197,94,0.3); border-radius:14px; padding:14px 18px; box-sizing:border-box;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:4px;">
                    <span style="display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:800; color:var(--win, #22c55e); text-transform:uppercase; font-family:'JetBrains Mono',monospace;">
                      <span style="width:7px; height:7px; border-radius:50%; background:var(--win, #22c55e); display:inline-block;"></span>
                      Active Match (Round ${rNum})
                    </span>
                    <span style="font-size:11px; color:var(--text-secondary, #94a3b8); font-family:'JetBrains Mono',monospace;">📅 Created ${dateLabel}</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                    <div>
                      <b style="color:var(--text-primary, #f0f4fc); font-size:14px; font-family:'JetBrains Mono',monospace;">${escapeHtml(p1)} (${p1S}) <span style="color:var(--text-muted, #64748b); font-weight:normal;">vs</span> ${escapeHtml(p2)} (${p2S})</b>
                      <div style="font-size:11px; color:var(--text-secondary, #94a3b8); margin-top:2px;">
                        ${escapeHtml(p1F || 'Army 1')} vs ${escapeHtml(p2F || 'Army 2')}
                        ${m.primary_mission ? ` • 🎯 ${escapeHtml(m.primary_mission)}` : ''}
                      </div>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                      <a href="${resumeUrl}" style="background:var(--accent, #38bdf8); color:#0a0c10; font-weight:800; font-size:12px; padding:8px 14px; border-radius:8px; text-decoration:none; font-family:'JetBrains Mono',monospace; display:inline-flex; align-items:center; gap:4px;">
                        ▶️ Resume Match
                      </a>
                      ${isRegisteredPlayer && !(String(mid).toUpperCase().startsWith('BCP-') || String(mid).toUpperCase().startsWith('ES-') || m.event_id || m.tournament_id) ? `
                        <button onclick="window.__gdmHideTrackerGame('${escapeHtml(mid)}', this.closest('div[style*=\\'background\\']'))" style="background:var(--loss-bg, rgba(239,68,68,0.15)); color:var(--loss, #ef4444); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:6px 10px; font-size:12px; cursor:pointer;" title="Discard / Abandon Session">
                          🗑️
                        </button>
                      ` : ''}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // 2. Completed Match History (All in Grey Cards with Edition Filter Bar)
    if (scopedCompleted.length > 0) {
      const normalizeTrackerEditionCode = (item) => {
        let rawEd = item.edition || item.edition_label || item.game?.edition || '';
        if (!rawEd && item.state_json) {
          try {
            const st = typeof item.state_json === 'string' ? JSON.parse(item.state_json) : item.state_json;
            rawEd = st?.edition || st?.edition_label || st?.game?.edition || '';
          } catch (e) {}
        }
        const s = String(rawEd || (isAosMode ? 'aos_4e' : '10th')).toLowerCase().trim();
        if (s.includes('8th') || s.includes('itc')) return '8th_itc';
        if (s.includes('9th') || s === '9e') return '9th';
        if (s.includes('11th') || s === '11e') return '11th';
        if (s.includes('10th') || s === '10e') return '10th';
        if (s.includes('aos') && (s.includes('3') || s.includes('3e'))) return 'aos_3e';
        if (s.includes('aos') || s.includes('4e')) return 'aos_4e';
        return s;
      };
      window.__gtSetEditionFilter = function(edKey) {
        window.__gtHistoryEditionFilter = edKey || 'all';
        renderHistoryList(dbHistoryCache);
      };
      const activeEdFilter = window.__gtHistoryEditionFilter || 'all';
      const edCounts = { all: scopedCompleted.length };
      scopedCompleted.forEach(item => {
        const ec = normalizeTrackerEditionCode(item);
        edCounts[ec] = (edCounts[ec] || 0) + 1;
      });
      const edDefs = isAosMode
        ? [
            { code: 'all', label: 'All Editions', icon: '📚' },
            { code: 'aos_4e', label: 'AoS 4e', icon: '⚡' },
            { code: 'aos_3e', label: 'AoS 3e', icon: '⚔️' }
          ]
        : [
            { code: 'all', label: 'All Editions', icon: '📚' },
            { code: '11th', label: '11th Ed', icon: '🚀' },
            { code: '10th', label: '10th Ed', icon: '🦅' },
            { code: '9th', label: '9th Ed', icon: '📜' },
            { code: '8th_itc', label: '8th ITC', icon: '🏛️' }
          ];
      const filteredCompleted = activeEdFilter === 'all'
        ? scopedCompleted
        : scopedCompleted.filter(item => normalizeTrackerEditionCode(item) === activeEdFilter);

      const filterPillsHtml = edDefs
        .filter(d => d.code === 'all' || (edCounts[d.code] || 0) > 0 || d.code === activeEdFilter)
        .map(d => {
          const cnt = edCounts[d.code] || 0;
          const isSel = activeEdFilter === d.code;
          return `<button type="button" onclick="window.__gtSetEditionFilter('${d.code}')" style="background:${isSel ? 'rgba(56,189,248,0.2)' : 'rgba(15,23,42,0.65)'}; color:${isSel ? '#38bdf8' : '#94a3b8'}; border:1px solid ${isSel ? 'rgba(56,189,248,0.55)' : 'rgba(148,163,184,0.22)'}; border-radius:999px; padding:4px 11px; font-size:11px; font-weight:800; font-family:'JetBrains Mono',monospace; cursor:pointer; display:inline-flex; align-items:center; gap:5px; transition:all 0.15s;">${d.icon} ${escapeHtml(d.label)} <span style="opacity:0.85;">(${cnt})</span></button>`;
        })
        .join('');

      outHtml += `
        <div style="margin-top:14px;">
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
            <div style="font-size:11px; font-weight:800; color:var(--text-secondary, #94a3b8); text-transform:uppercase; font-family:'JetBrains Mono',monospace;">
              📜 Completed Matches (${filteredCompleted.length}${activeEdFilter !== 'all' ? ' of ' + scopedCompleted.length : ''})
            </div>
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              ${filterPillsHtml}
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${filteredCompleted.map(item => {
              const p1 = item.game?.p1Name || item.p1_name || 'Player 1';
              const p2 = item.game?.p2Name || item.p2_name || 'Player 2';
              const p1F = item.game?.p1Faction || item.p1_faction || '';
              const p2F = item.game?.p2Faction || item.p2_faction || '';
              const p1S = item.p1Score ?? item.p1_score ?? 0;
              const p2S = item.p2Score ?? item.p2_score ?? 0;
              const mid = item.match_id || item.id || '';
              const rawDate = item.game_date || item.date || item.updated_at;
              let dateStr = 'Completed';
              if (rawDate) {
                try {
                  const sRaw = String(rawDate).trim();
                  let dObj;
                  if (/^\d{9,16}(?:\.\d+)?$/.test(sRaw)) {
                    const num = parseFloat(sRaw);
                    dObj = new Date(num > 1e11 ? num : num * 1000);
                  } else {
                    dObj = new Date(rawDate);
                  }
                  dateStr = !isNaN(dObj.getTime()) ? dObj.toLocaleDateString() : sRaw;
                } catch (e) { dateStr = String(rawDate); }
              }
              const factionSubtitle = `<div class="gt-history-factions">${escapeHtml(p1F || 'Army 1')} vs ${escapeHtml(p2F || 'Army 2')}</div>`;
              const edCode = normalizeTrackerEditionCode(item);
              const edShort = edCode === '8th_itc' ? '🏛️ 8th ITC' : (edCode === '9th' ? '📜 9th Ed' : (edCode === '11th' ? '🚀 11th Ed' : (edCode === 'aos_3e' ? '⚔️ AoS 3e' : (edCode === 'aos_4e' ? '⚡ AoS 4e' : (edCode === '10th' ? '🦅 10th Ed' : '')))));
              const edStyleMap = {
                '11th': 'background:rgba(56,189,248,0.14); color:#38bdf8; border:1px solid rgba(56,189,248,0.35);',
                '10th': 'background:rgba(45,212,191,0.14); color:#2dd4bf; border:1px solid rgba(45,212,191,0.35);',
                '9th': 'background:rgba(251,191,36,0.14); color:#fbbf24; border:1px solid rgba(251,191,36,0.35);',
                '8th_itc': 'background:rgba(192,132,252,0.14); color:#c084fc; border:1px solid rgba(192,132,252,0.35);',
                'aos_4e': 'background:rgba(245,158,11,0.14); color:#f59e0b; border:1px solid rgba(245,158,11,0.35);',
                'aos_3e': 'background:rgba(251,146,60,0.14); color:#fb923c; border:1px solid rgba(251,146,60,0.35);'
              };
              const edCss = edStyleMap[edCode] || edStyleMap['10th'];
              const edBadge = edShort
                ? `<span class="gt-history-ed-badge" style="${edCss}">${escapeHtml(edShort)}</span>`
                : '';
              const isLockedEvent = Boolean(item.event_match_locked || item.event_id);
              const sysStr = item.game_system || (String(mid).startsWith('AOS-') || isAosMode ? 'aos' : '40k');
              const evTitleText = item.mapped_event_name || 'Tournament';
              const evRoundText = `R${item.round_num || 1}${item.table_num ? ' T' + item.table_num : ''}`;
              const eventMetaSlot = isLockedEvent
                ? `<span class="gt-history-event-badge" title="🏆 ${escapeHtml(evTitleText)} • ${escapeHtml(evRoundText)}"><span class="gt-history-event-icon">🏆</span><span class="gt-history-event-name">${escapeHtml(evTitleText)}</span><span class="gt-history-event-round">${escapeHtml(evRoundText)}</span></span>`
                : `<button type="button" class="gt-history-map-pill" title="Map & Lock Scorecard to Official Tournament Pairing" onclick="event.stopPropagation(); window.openMapGameToEventModal('${escapeHtml(mid)}', '${escapeHtml(sysStr)}')">🏆 Map to Event</button>`;

              return `
                <div class="gt-history-card" data-match-id="${escapeHtml(mid)}" data-edition="${escapeHtml(edCode)}" onclick="window.location.href='/scorecard/${encodeURIComponent(mid)}'">
                  <div class="gt-history-main">
                    <div class="gt-history-players">${escapeHtml(p1)} <span class="gt-history-vs">vs</span> ${escapeHtml(p2)}</div>
                    ${factionSubtitle}
                    <div class="gt-history-meta">
                      <span class="gt-history-date">📅 ${escapeHtml(dateStr)}</span>
                      ${edBadge}${eventMetaSlot}
                    </div>
                  </div>
                  <div class="gt-history-right">
                    <span class="gt-history-score-pill">
                      <span class="gt-score-val gt-score-p1">${p1S}</span>
                      <span class="gt-score-sep">-</span>
                      <span class="gt-score-val gt-score-p2">${p2S}</span>
                    </span>
                    <div class="gt-history-actions">
                      <button type="button" class="gt-history-scorecard-btn" title="View Full Turn-by-Turn Digital Scorecard" onclick="event.stopPropagation(); window.open('/scorecard/${encodeURIComponent(mid)}', '_blank')">
                        📄 Scorecard
                      </button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = outHtml;
  }

  // Real-time Firestore listener for Active Matches on the Lobby page
  const lobbyRoomUnsubs = {};
  function watchLobbyActiveMatches() {
    if (isPlay) return;
    const db = getTrackerFirestoreDb();
    if (!db) return;

    const activeMatches = Array.isArray(window.gtActiveMatches) ? window.gtActiveMatches : [];
    const activeIds = new Set(
      activeMatches
        .map(m => (m.match_id || m.id || '').trim().toUpperCase())
        .filter(Boolean)
    );

    // Unsubscribe rooms no longer in activeIds
    Object.keys(lobbyRoomUnsubs).forEach(mid => {
      if (!activeIds.has(mid)) {
        try { lobbyRoomUnsubs[mid](); } catch (e) {}
        delete lobbyRoomUnsubs[mid];
      }
    });

    activeIds.forEach(mid => {
      if (lobbyRoomUnsubs[mid]) return;
      try {
        lobbyRoomUnsubs[mid] = db.collection('rooms').doc(mid).onSnapshot((snap) => {
          if (!snap || !snap.exists) {
            // Room was deleted/discarded or finalized in Firestore!
            if (lobbyRoomUnsubs[mid]) {
              try { lobbyRoomUnsubs[mid](); } catch (e) {}
              delete lobbyRoomUnsubs[mid];
            }
            window.gtActiveMatches = (window.gtActiveMatches || []).filter(item => (item.match_id || item.id || '').trim().toUpperCase() !== mid);
            window.gtPrimaryActive = window.gtActiveMatches[0] || null;
            window.gtUnfinishedSessions = window.gtActiveMatches.slice(1);
            dbHistoryCache = (dbHistoryCache || []).filter(item => {
              const itemMid = (item.match_id || item.id || '').trim().toUpperCase();
              if (itemMid !== mid) return true;
              return Boolean(item.isFinished || item.is_finished);
            });
            try { originalSetItem('gdm-11e-tracker-history', JSON.stringify(dbHistoryCache)); } catch (e) {}
            renderHistoryList(dbHistoryCache);
            syncHistoryFromDatabase();
            return;
          }

          const data = snap.data() || {};
          const isZombiePartial = !data.status && !data.roomKey && !data.createdAt && !data.created_at;
          if (data.status === 'abandoned' || data.is_abandoned || isZombiePartial) {
            if (lobbyRoomUnsubs[mid]) {
              try { lobbyRoomUnsubs[mid](); } catch (e) {}
              delete lobbyRoomUnsubs[mid];
            }
            window.gtActiveMatches = (window.gtActiveMatches || []).filter(item => (item.match_id || item.id || '').trim().toUpperCase() !== mid);
            window.gtPrimaryActive = window.gtActiveMatches[0] || null;
            window.gtUnfinishedSessions = window.gtActiveMatches.slice(1);
            dbHistoryCache = (dbHistoryCache || []).filter(item => (item.match_id || item.id || '').trim().toUpperCase() !== mid);
            try { originalSetItem('gdm-11e-tracker-history', JSON.stringify(dbHistoryCache)); } catch (e) {}
            renderHistoryList(dbHistoryCache);
            return;
          }

          if (data.status === 'completed' || data.is_finished || (data.state && data.state.is_finished)) {
            syncHistoryFromDatabase();
            return;
          }

          // Live update of active match scores/round/player names on the Lobby card
          const st = data.state || {};
          const game = st.game || {};
          let changed = false;
          const updateMatchItem = (item) => {
            const itemMid = (item.match_id || item.id || '').trim().toUpperCase();
            if (itemMid !== mid) return item;
            const newRound = st.round || item.round || item.current_round || 1;
            const newP1S = st.p1 ? computeTrackerPlayerVp(st.p1, st) : (item.p1Score ?? item.p1_score ?? 0);
            const newP2S = st.p2 ? computeTrackerPlayerVp(st.p2, st) : (item.p2Score ?? item.p2_score ?? 0);
            const newP1Name = data.p1_name || game.p1Name || item.p1_name || 'Player 1';
            const newP2Name = data.p2_name || game.p2Name || item.p2_name || 'Player 2';
            const newP1Fac = game.p1Faction || item.p1_faction || '';
            const newP2Fac = game.p2Faction || item.p2_faction || '';
            if (
              item.round !== newRound ||
              item.p1Score !== newP1S ||
              item.p2Score !== newP2S ||
              item.p1_name !== newP1Name ||
              item.p2_name !== newP2Name ||
              item.p1_faction !== newP1Fac ||
              item.p2_faction !== newP2Fac
            ) {
              changed = true;
              return Object.assign({}, item, {
                round: newRound,
                current_round: newRound,
                p1Score: newP1S,
                p1_score: newP1S,
                p2Score: newP2S,
                p2_score: newP2S,
                p1_name: newP1Name,
                p2_name: newP2Name,
                p1_faction: newP1Fac,
                p2_faction: newP2Fac,
                game: Object.assign({}, item.game || {}, game, {
                  p1Name: newP1Name,
                  p2Name: newP2Name,
                  p1Faction: newP1Fac,
                  p2Faction: newP2Fac
                })
              });
            }
            return item;
          };

          window.gtActiveMatches = (window.gtActiveMatches || []).map(updateMatchItem);
          dbHistoryCache = (dbHistoryCache || []).map(updateMatchItem);
          if (changed) {
            try { originalSetItem('gdm-11e-tracker-history', JSON.stringify(dbHistoryCache)); } catch (e) {}
            renderHistoryList(dbHistoryCache);
          }
        }, () => {});
      } catch (e) {}
    });
  }

  // 6. PostgreSQL Database as Sole Source of Truth for History
  let syncHistoryInFlight = null;
  async function syncHistoryFromDatabase() {
    if (syncHistoryInFlight) return syncHistoryInFlight;
    syncHistoryInFlight = (async () => {
      try {
        const isAosMode = window.location.pathname.includes('/aos') ||
          window.location.search.includes('game_system=aos') ||
          window.location.search.includes('system=aos');
        const token = getAuthToken();
        const params = new URLSearchParams();
        if (token) params.set('token', token);
        params.set('game_system', isAosMode ? 'aos' : '40k');
        const resp = await fetch(`/api/tracker/sessions?${params.toString()}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.success) {
            window.gtActiveMatches = data.active_sessions || (data.primary_active ? [data.primary_active, ...(data.unfinished_sessions || [])] : []);
            window.gtPrimaryActive = window.gtActiveMatches[0] || null;
            window.gtUnfinishedSessions = window.gtActiveMatches.slice(1);
            window.gtCompletedHistory = data.completed_history || [];

            const rawList = [
              ...(window.gtActiveMatches || []),
              ...(data.completed_history || [])
            ];

            dbHistoryCache = rawList.map(item => {
              let s = {};
              if (typeof item.state_json === 'string') {
                try { s = JSON.parse(item.state_json); } catch (e) {}
              } else if (typeof item.state_json === 'object') {
                s = item.state_json || {};
              } else if (typeof item.state === 'object') {
                s = item.state || {};
              }
              const rawGdVal = item.game_date || s.game_date || item.updated_at || item.created_at || null;
              let parsedDateMs = Date.now();
              if (rawGdVal) {
                const sGd = String(rawGdVal).trim();
                if (/^\d{9,16}(?:\.\d+)?$/.test(sGd)) {
                  const numGd = parseFloat(sGd);
                  parsedDateMs = numGd > 1e11 ? numGd : numGd * 1000;
                } else {
                  const tMs = new Date(rawGdVal).getTime();
                  if (!isNaN(tMs)) parsedDateMs = tMs;
                }
              }
              const calcP1S = (s.p1 && typeof s.p1 === 'object') ? computeTrackerPlayerVp(s.p1, s) : 0;
              const calcP2S = (s.p2 && typeof s.p2 === 'object') ? computeTrackerPlayerVp(s.p2, s) : 0;
              const resolvedP1S = calcP1S > 0 ? calcP1S : (item.p1_score ?? item.p1Score ?? 0);
              const resolvedP2S = calcP2S > 0 ? calcP2S : (item.p2_score ?? item.p2Score ?? 0);
              return {
                ...s,
                id: item.match_id,
                match_id: item.match_id,
                game_system: item.game_system || s.gameSystem || (String(item.match_id || '').startsWith('AOS-') ? 'aos' : '40k'),
                edition: item.edition || s.edition || null,
                edition_label: item.edition_label || s.edition_label || null,
                event_id: item.event_id || s.event_id || null,
                round_num: item.round_num || s.round_num || null,
                table_num: item.table_num || s.table_num || null,
                mapped_event_name: item.mapped_event_name || s.mapped_event_name || null,
                event_match_locked: Boolean(item.event_match_locked || s.event_match_locked || item.event_id || s.event_id),
                imported_source: item.imported_source || s.imported_source || null,
                imported_app: item.imported_app || s.imported_app || null,
                game_date: rawGdVal ? new Date(parsedDateMs).toISOString() : null,
                date: parsedDateMs,
                p1_name: item.p1_name || s.game?.p1Name || 'Player 1',
                p2_name: item.p2_name || s.game?.p2Name || 'Player 2',
                p1_faction: item.p1_faction || s.game?.p1Faction || '',
                p2_faction: item.p2_faction || s.game?.p2Faction || '',
                game: s.game || {
                  p1Name: item.p1_name || 'Player 1',
                  p2Name: item.p2_name || 'Player 2',
                  p1Faction: item.p1_faction,
                  p2Faction: item.p2_faction,
                  p1Detachments: item.p1_detachment ? [item.p1_detachment] : [],
                  p2Detachments: item.p2_detachment ? [item.p2_detachment] : [],
                  primary: item.primary_mission || 'Take & Hold',
                  deployment: item.deployment || 'Search & Destroy'
                },
                p1: s.p1 ? Object.assign({}, s.p1, { score: resolvedP1S }) : { score: resolvedP1S },
                p2: s.p2 ? Object.assign({}, s.p2, { score: resolvedP2S }) : { score: resolvedP2S },
                round: item.current_round || s.round || 1,
                p1Score: resolvedP1S,
                p2Score: resolvedP2S,
                started: item.started,
                isFinished: item.is_finished,
                winner: item.winner_name
              };
            });

            // Filter out locally hidden match IDs to prevent any race condition
            let locallyHidden = [];
            try { locallyHidden = JSON.parse(originalGetItem('gt-hidden-matches') || '[]'); } catch(e) {}
            if (locallyHidden.length > 0) {
              const hiddenSet = new Set(locallyHidden);
              window.gtActiveMatches = (window.gtActiveMatches || []).filter(item => !hiddenSet.has(item.match_id || item.id));
              window.gtPrimaryActive = window.gtActiveMatches[0] || null;
              window.gtUnfinishedSessions = window.gtActiveMatches.slice(1);
              window.gtCompletedHistory = (window.gtCompletedHistory || []).filter(item => !hiddenSet.has(item.match_id || item.id));
              dbHistoryCache = dbHistoryCache.filter(item => !hiddenSet.has(item.match_id || item.id));
            }

            const wasLoading = isHistoryLoading;
            isHistoryLoading = false;
            originalSetItem('gdm-11e-tracker-history', JSON.stringify(dbHistoryCache));

            window.dispatchEvent(new StorageEvent('storage', {
              key: 'gdm-11e-tracker-history',
              newValue: JSON.stringify(dbHistoryCache),
              storageArea: localStorage
            }));

            const newFp = dbHistoryCache.map(x => `${x.match_id}:${x.p1Score}:${x.p2Score}:${x.round}:${x.isFinished}:${x.event_match_locked}:${x.edition}`).join('|');
            if (wasLoading || newFp !== window.__gtLastHistoryFp || !document.getElementById('gdm-history-cards')) {
              window.__gtLastHistoryFp = newFp;
              renderHistoryList(dbHistoryCache);
            }
            watchLobbyActiveMatches();
            if (!isPlay && typeof window.__prefetchLobbyMappableEventMatches === 'function') {
              window.__prefetchLobbyMappableEventMatches(isAosMode ? 'aos' : '40k');
            }
          }
        }
      } catch (e) {
      } finally {
        if (isHistoryLoading) {
          isHistoryLoading = false;
          renderHistoryList(dbHistoryCache);
        }
        syncHistoryInFlight = null;
      }
    })();
    return syncHistoryInFlight;
  }

  window.__syncTrackerHistory = syncHistoryFromDatabase;

  // Background Auto-Refresh Timer for Match History (30s fallback + real-time Firestore listeners on active matches)
  let historyPollTimer = null;
  function startHistoryPolling() {
    if (historyPollTimer) clearInterval(historyPollTimer);
    watchLobbyActiveMatches();
    historyPollTimer = setInterval(() => {
      if (!isPlay && document.visibilityState !== 'hidden') {
        syncHistoryFromDatabase();
      }
    }, 30000);
  }

  // Auto-refresh history immediately on tab focus or visibility return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isPlay) {
      injectLobbyHub();
      syncHistoryFromDatabase();
    }
  });

  window.addEventListener('focus', () => {
    if (!isPlay) {
      syncHistoryFromDatabase();
    }
  });

  window.addEventListener('pageshow', () => {
    if (!isPlay) {
      injectLobbyHub();
      syncHistoryFromDatabase();
    }
  });

  // Cross-tab real-time history synchronization
  try {
    const histChannel = new BroadcastChannel('gt-history-sync');
    histChannel.onmessage = (msg) => {
      if (msg && msg.data === 'refresh' && !isPlay) {
        syncHistoryFromDatabase();
      }
    };
    window.__broadcastHistoryUpdate = function() {
      try { histChannel.postMessage('refresh'); } catch(e) {}
    };
  } catch(e) {
    window.__broadcastHistoryUpdate = function() {};
  }

  // Instant (0ms) Optimistic Discard & Deletion for Active/Unfinished Match Session
  window.__gdmHideTrackerGame = function(matchId, cardEl) {
    if (!matchId) return;
    const cleanId = String(matchId).toUpperCase();
    if (cleanId.startsWith('BCP-') || cleanId.startsWith('ES-') || cleanId.startsWith('WH40K-BCP-') || cleanId.startsWith('WH40K-ES-')) {
      alert("Tournament match rooms are managed by the event organizer (TO) and cannot be deleted by competitors.");
      return;
    }
    if (!confirm(`Discard & delete match #${matchId.replace('WH40K-', '')}?\n\n(This will remove it from your active sessions with zero Elo penalty.)`)) {
      return;
    }

    // 1. Immediately cache hidden ID locally so refresh will NEVER show it
    let locallyHidden = [];
    try { locallyHidden = JSON.parse(originalGetItem('gt-hidden-matches') || '[]'); } catch(e) {}
    if (!locallyHidden.includes(matchId)) {
      locallyHidden.push(matchId);
      originalSetItem('gt-hidden-matches', JSON.stringify(locallyHidden));
    }

    // 2. Instant 0ms Optimistic UI Update in Memory
    window.gtActiveMatches = (window.gtActiveMatches || []).filter(item => (item.match_id || item.id) !== matchId);
    window.gtPrimaryActive = window.gtActiveMatches[0] || null;
    window.gtUnfinishedSessions = window.gtActiveMatches.slice(1);
    window.gtCompletedHistory = (window.gtCompletedHistory || []).filter(item => (item.match_id || item.id) !== matchId);
    dbHistoryCache = dbHistoryCache.filter(item => (item.match_id || item.id) !== matchId);
    originalSetItem('gdm-11e-tracker-history', JSON.stringify(dbHistoryCache));

    // 3. Instant Synchronous DOM removal
    if (cardEl) {
      cardEl.remove();
    }
    renderHistoryList(dbHistoryCache);
    window.__broadcastHistoryUpdate();

    // 4. Instant direct Firestore delete if Firebase client SDK is active
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      try {
        const db = firebase.firestore();
        db.collection('rooms').doc(matchId).delete();
      } catch(e) {}
    }

    // 5. Server-side deletion in background (non-blocking)
    try {
      const token = getAuthToken();
      fetch(`/api/tracker/room/${encodeURIComponent(matchId)}/discard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ token: token, match_id: matchId })
      }).catch(() => {});
    } catch (err) {}
  };

  // Comprehensive 40k Factions Directory for bulletproof DOM recognition
  const KNOWN_40K_FACTIONS = [
    "Adepta Sororitas", "Adeptus Custodes", "Adeptus Mechanicus", "Aeldari", "Agents of the Imperium",
    "Astra Militarum", "Black Templars", "Blood Angels", "Chaos Daemons", "Chaos Knights",
    "Chaos Space Marines", "Dark Angels", "Death Guard", "Deathwatch", "Drukhari",
    "Genestealer Cults", "Grey Knights", "Imperial Fists", "Imperial Knights", "Iron Hands",
    "Leagues of Votann", "Necrons", "Orks", "Raven Guard", "Salamanders", "Space Marines",
    "Space Wolves", "Tau Empire", "Thousand Sons", "Tyranids", "Ultramarines", "White Scars", "World Eaters"
  ];

  // React Synthetic Value Setter (Bypasses React internal value tracking)
  function setReactInputValue(inputEl, value) {
    if (!inputEl || inputEl.value === value) return;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(inputEl, value);
      } else {
        inputEl.value = value;
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      inputEl.value = value;
    }
  }

  // Scrape live setup wizard values from the DOM
  function scrapeSetupWizardState() {
    const stepHeader = document.querySelector('h2');
    if (!stepHeader || !stepHeader.textContent.includes('PLAYERS')) return null;

    const inputs = Array.from(document.querySelectorAll('input'));
    const p1Input = inputs[0];
    const p2Input = inputs[1];

    const p1Name = p1Input ? p1Input.value.trim() : null;
    const p2Name = p2Input ? p2Input.value.trim() : null;

    const p2Top = p2Input ? p2Input.getBoundingClientRect().top : 9999;

    let p1Faction = null;
    let p2Faction = null;

    // Scan all visible elements in the DOM for faction names
    const candidateElements = Array.from(document.querySelectorAll('div, button, span, p')).filter(el => {
      const txt = (el.textContent || '').trim();
      return el.children.length <= 2 && txt.length >= 4 && !txt.includes('PLAYERS') && !txt.includes('STEP');
    });

    for (const el of candidateElements) {
      const txt = el.textContent.trim();
      const matched = KNOWN_40K_FACTIONS.find(f => f.toLowerCase() === txt.toLowerCase());
      if (matched) {
        const top = el.getBoundingClientRect().top;
        if (top < p2Top) {
          p1Faction = matched;
        } else {
          p2Faction = matched;
        }
      }
    }

    // Battle Ready buttons
    const battleReadyBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent && b.textContent.includes('BATTLE READY'));
    const p1BattleReady = battleReadyBtns[0] ? (battleReadyBtns[0].classList.contains('active') || getComputedStyle(battleReadyBtns[0]).backgroundColor.includes('rgb(')) : true;
    const p2BattleReady = battleReadyBtns[1] ? (battleReadyBtns[1].classList.contains('active') || getComputedStyle(battleReadyBtns[1]).backgroundColor.includes('rgb(')) : true;

    return {
      p1Name: p1Name || undefined,
      p2Name: p2Name || undefined,
      p1Faction: p1Faction || undefined,
      p2Faction: p2Faction || undefined,
      p1BattleReady: p1BattleReady,
      p2BattleReady: p2BattleReady
    };
  }

  // Inject remote setup wizard values into the DOM
  function injectSetupWizardState(gameObj, p1Obj, p2Obj) {
    if (!gameObj) return;
    const stepHeader = document.querySelector('h2');
    if (!stepHeader || !stepHeader.textContent.includes('PLAYERS')) return;

    const inputs = Array.from(document.querySelectorAll('input'));
    const p1Input = inputs[0];
    const p2Input = inputs[1];

    if (p1Input && gameObj.p1Name && p1Input.value !== gameObj.p1Name) {
      setReactInputValue(p1Input, gameObj.p1Name);
    }
    if (p2Input && gameObj.p2Name && p2Input.value !== gameObj.p2Name) {
      setReactInputValue(p2Input, gameObj.p2Name);
    }

    const p2Top = p2Input ? p2Input.getBoundingClientRect().top : 9999;

    // Find faction triggers with chevron SVGs
    const allChevrons = Array.from(document.querySelectorAll('svg')).filter(svg => {
      const p = svg.parentElement;
      return p && p.textContent && !p.textContent.includes('PLAYERS') && !p.textContent.includes('NEXT') && !p.textContent.includes('BACK');
    });

    if (allChevrons[0] && gameObj.p1Faction) {
      const trigger = allChevrons[0].parentElement;
      if (trigger && !trigger.textContent.includes(gameObj.p1Faction)) {
        trigger.childNodes[0].textContent = gameObj.p1Faction;
        trigger.style.color = '#f8fafc';
      }
    }

    if (allChevrons[1] && gameObj.p2Faction) {
      const trigger = allChevrons[1].parentElement;
      if (trigger && !trigger.textContent.includes(gameObj.p2Faction)) {
        trigger.childNodes[0].textContent = gameObj.p2Faction;
        trigger.style.color = '#f8fafc';
      }
    }
  }

  // 7. Broadcast State with Instant Role & Session Sync
  let lastScrapedJson = '';
  function notifyStateChanged() {
    if (clientState.isApplyingRemote) return;
    if (!clientState.matchId) return;
    if (clientState.role === 'spectator') return;

    // Scrape active DOM wizard fields into state
    const wizard = scrapeSetupWizardState();
    if (wizard) {
      const raw = originalGetItem('gdm-11e-tracker-state');
      let st = {};
      try { st = JSON.parse(raw) || {}; } catch(e) {}
      if (!st.game) st.game = {};
      if (wizard.p1Name) st.game.p1Name = wizard.p1Name;
      if (wizard.p2Name) st.game.p2Name = wizard.p2Name;
      if (wizard.p1Faction) st.game.p1Faction = wizard.p1Faction;
      if (wizard.p2Faction) st.game.p2Faction = wizard.p2Faction;
      if (!st.p1) st.p1 = {};
      if (!st.p2) st.p2 = {};
      st.p1.battleReady = wizard.p1BattleReady;
      st.p2.battleReady = wizard.p2BattleReady;
      originalSetItem('gdm-11e-tracker-state', JSON.stringify(st));
    }

    clearTimeout(clientState.debounceTimer);
    clientState.debounceTimer = setTimeout(() => {
      broadcastState();
    }, 60);
  }

  function handleRemoteMatchFinalized() {
    if (clientState.isFinalizing) return;
    clientState.isFinalizing = true;
    clearTimeout(clientState.debounceTimer);
    if (fastPollTimer) { clearInterval(fastPollTimer); fastPollTimer = null; }
    if (wizardScrapeTimer) { clearInterval(wizardScrapeTimer); wizardScrapeTimer = null; }
    if (fsDocUnsub) {
      try { fsDocUnsub(); fsDocUnsub = null; } catch(e) {}
    }
    clientState.firestoreConnected = false;
    clientState.hasRealtimeStream = false;
    if (clientState.eventSource) {
      try { clientState.eventSource.close(); clientState.eventSource = null; } catch(e) {}
    }
    try { originalRemoveItem('gdm-11e-tracker-state'); } catch(e) {}

    let overlay = document.getElementById('gt-finalized-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'gt-finalized-overlay';
      overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(7,11,20,0.92);
        z-index: 999999; display: flex; flex-direction: column;
        align-items: center; justify-content: center; text-align: center;
        padding: 20px; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      `;
      overlay.innerHTML = `
        <div style="background:#0f172a; border:1px solid #10b981; border-radius:16px; padding:2rem; max-width:440px; box-shadow:0 20px 50px rgba(0,0,0,0.8);">
          <div style="font-size:3rem; margin-bottom:1rem;">🏁</div>
          <h2 style="font-size:1.4rem; font-weight:800; color:#10b981; margin:0 0 0.5rem 0;">Match Concluded!</h2>
          <p style="font-size:0.9rem; color:#94a3b8; line-height:1.5; margin:0 0 1.5rem 0;">
            The battle record has been permanently saved and archived. Redirecting to the verified scorecard...
          </p>
          <a href="/scorecard/${encodeURIComponent(clientState.matchId)}" style="background:#0284c7; color:#fff; padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:700; font-size:0.9rem; display:inline-block;">
            📄 View Scorecard Now
          </a>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    setTimeout(() => {
      window.location.href = `/scorecard/${encodeURIComponent(clientState.matchId)}`;
    }, 1000);
  }

  function handleRemoteMatchDiscarded() {
    if (clientState.isFinalizing || clientState.isDiscarded) return;
    clientState.isDiscarded = true;
    clientState.isFinalizing = true;
    const discardedMatchId = clientState.matchId;
    clearTimeout(clientState.debounceTimer);
    if (fastPollTimer) { clearInterval(fastPollTimer); fastPollTimer = null; }
    if (wizardScrapeTimer) { clearInterval(wizardScrapeTimer); wizardScrapeTimer = null; }
    if (fsDocUnsub) {
      try { fsDocUnsub(); fsDocUnsub = null; } catch(e) {}
    }
    clientState.firestoreConnected = false;
    clientState.hasRealtimeStream = false;
    if (clientState.eventSource) {
      try { clientState.eventSource.close(); clientState.eventSource = null; } catch(e) {}
    }
    try { originalRemoveItem('gdm-11e-tracker-state'); } catch(e) {}
    try {
      const localRaw = originalGetItem('gdm-11e-tracker-history');
      if (localRaw && discardedMatchId) {
        let localArr = JSON.parse(localRaw);
        if (Array.isArray(localArr)) {
          localArr = localArr.filter(g => String(g.id || g.match_id) !== String(discardedMatchId));
          originalSetItem('gdm-11e-tracker-history', JSON.stringify(localArr));
        }
      }
    } catch(e) {}

    let overlay = document.getElementById('gt-discarded-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'gt-discarded-overlay';
      overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(7,11,20,0.92);
        z-index: 999999; display: flex; flex-direction: column;
        align-items: center; justify-content: center; text-align: center;
        padding: 20px; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      `;
      overlay.innerHTML = `
        <div style="background:#0f172a; border:1px solid #ef4444; border-radius:16px; padding:2rem; max-width:440px; box-shadow:0 20px 50px rgba(0,0,0,0.8);">
          <div style="font-size:3rem; margin-bottom:1rem;">🗑️</div>
          <h2 style="font-size:1.4rem; font-weight:800; color:#ef4444; margin:0 0 0.5rem 0;">Match Discarded</h2>
          <p style="font-size:0.9rem; color:#94a3b8; line-height:1.5; margin:0 0 1.5rem 0;">
            This match room was deleted by the other player and is no longer active. Returning to the Game Tracker lobby...
          </p>
          <a href="/11th/tracker" style="background:#334155; color:#fff; padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:700; font-size:0.9rem; display:inline-block;">
            🏠 Return to Lobby
          </a>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    setTimeout(() => {
      window.location.href = '/11th/tracker';
    }, 1200);
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
        console.debug('[Firestore Init] Notice:', e);
      }
    }
    return null;
  }

  let fsDocUnsub = null;
  function initFirestoreDirectSync() {
    if (!clientState.matchId) return;
    const db = getTrackerFirestoreDb();
    if (db) {
      try {
        const docRef = db.collection('rooms').doc(clientState.matchId);
        if (fsDocUnsub) fsDocUnsub();
        
        fsDocUnsub = docRef.onSnapshot((snap) => {
          clientState.firestoreConnected = true;
          if (!snap || !snap.exists) {
            // Room was either finalized or discarded by opponent!
            if (clientState.hasJoinedRoom && !clientState.isFinalizing && !clientState.isDiscarded) {
              const mid = clientState.matchId;
              fetch(`/api/tracker/room/${encodeURIComponent(mid)}/check`)
                .then(r => r.ok ? r.json() : null)
                .then(chk => {
                  if (chk && (chk.is_finished || chk.status === 'completed')) {
                    handleRemoteMatchFinalized();
                  } else {
                    handleRemoteMatchDiscarded();
                  }
                })
                .catch(() => {
                  handleRemoteMatchDiscarded();
                });
            }
            return;
          }
          clientState.hasJoinedRoom = true;
          const data = snap.data();
          if (data) {
            if (data.status === 'abandoned' || data.is_abandoned) {
              handleRemoteMatchDiscarded();
              return;
            }
            if (data.status === 'completed' || data.is_finished || (data.state && data.state.is_finished)) {
              handleRemoteMatchFinalized();
              return;
            }
            if (data.chess_clock || data.clock) {
              applyRemoteChessClock(data.chess_clock || data.clock);
            }
            if (data.masterClock) {
              applyRemoteMasterClock(data.masterClock);
            }
            if (data.broadcast) {
              applyRemoteBroadcast(data.broadcast);
            }
            if (data.active_judge_call !== undefined && data.active_judge_call !== null) {
              applyRemoteJudgeCall(data.active_judge_call);
            } else if (clientState.activeJudgeCall) {
              applyRemoteJudgeCall(null);
            }
            const docTournId = data.eventId || data.event_id || data.tournament_id;
            if (docTournId && !clientState.tournamentId) {
              clientState.tournamentId = docTournId;
              initTournamentDirectSync(docTournId);
              startTournamentClockFallbackPoll(docTournId);
            }
            const remoteHist = data.dice_history || (data.state && data.state.dice_history) || [];
            const remoteTrays = data.dice_trays || (data.state && data.state.dice_trays) || null;
            applyRemoteDiceTray(
              data.dice_tray || (data.state && data.state.dice_tray),
              data.dice_target !== undefined ? data.dice_target : (data.state ? data.state.dice_target : undefined),
              remoteHist,
              remoteTrays
            );
            if (data.user_id_p1) clientState.userIdP1 = data.user_id_p1;
            if (data.user_id_p2) clientState.userIdP2 = data.user_id_p2;
            if (data.rosters) {
              if (data.rosters.player1) clientState.p1ArmyList = data.rosters.player1;
              if (data.rosters.player2) clientState.p2ArmyList = data.rosters.player2;
              injectMultiplayerHUD();
            }
            if (data.version && data.version > clientState.version && data.state && !clientState.isApplyingRemote) {
              clientState.version = data.version;
              applyRemoteState(data.state);
            } else if (data.user_id_p2) {
              injectMultiplayerHUD();
            }
          }
        }, (err) => {
          clientState.firestoreConnected = false;
          console.debug('[Firestore onSnapshot] Native fallback:', err);
        });

        // Initialize tournament master clock and broadcast listener
        const tournamentId = getTrackerTournamentId();
        if (tournamentId) {
          initTournamentDirectSync(tournamentId);
          startTournamentClockFallbackPoll(tournamentId);
        }
      } catch(e) {
        console.debug('[Firestore Init] Notice:', e);
      }
    }
  }

  /* ==========================================================================
     TOURNAMENT MASTER CLOCK & BROADCAST BRIDGE (Event Studio -> Tables)
     ========================================================================== */
  const tournamentMasterClock = {
    status: 'stopped',
    round: 1,
    durationMinutes: 150,
    remainingSeconds: 9000,
    targetEndTime: null,
    updatedAt: 0
  };

  let fsTournUnsub = null;
  let tournClockPollTimer = null;
  let globalBroadcastPollTimer = null;
  function startTournamentClockFallbackPoll(tournamentId) {
    if (tournClockPollTimer || !tournamentId) return;
    const fetchClockAndBroadcast = async () => {
      if (!tournamentId || document.hidden) return;
      try {
        const resp = await fetch(`/api/events/${encodeURIComponent(tournamentId)}/to-hub`);
        if (resp.ok) {
          const cData = await resp.json();
          const clk = cData && (cData.clock || cData.master_clock || cData.masterClock);
          if (clk) {
            const hasEnd = Boolean(clk.targetEndTime || clk.target_end_time);
            if (!(tournamentMasterClock.status === 'running' && !hasEnd && clk.status !== 'running')) {
              applyRemoteMasterClock(clk);
            }
          }
          if (cData && ('active_broadcast' in cData || 'broadcast' in cData || 'targeted_broadcasts' in cData)) {
            applyRemoteBroadcastBundle(cData);
          }
          return;
        }
      } catch (e) {}

      // Fallback to direct clock endpoint
      if (clientState.firestoreConnected && tournamentMasterClock.status === 'running' && tournamentMasterClock.targetEndTime) {
        return;
      }
      try {
        const resp = await fetch(`/api/eventstudio/event/${encodeURIComponent(tournamentId)}/clock`);
        if (resp.ok) {
          const cData = await resp.json();
          const clk = cData && (cData.clock || cData.masterClock);
          if (clk) {
            const hasEnd = Boolean(clk.targetEndTime || clk.target_end_time);
            if (tournamentMasterClock.status === 'running' && !hasEnd && clk.status !== 'running') {
              return;
            }
            applyRemoteMasterClock(clk);
          }
        }
      } catch (e) {}
    };
    fetchClockAndBroadcast();
    tournClockPollTimer = setInterval(fetchClockAndBroadcast, 4000);
  }

  function startGlobalActiveAnnouncementPoll() {
    if (globalBroadcastPollTimer) return;
    const pollActive = async () => {
      if (document.hidden) return;
      const tid = getTrackerTournamentId();
      const queryIds = tid ? `${encodeURIComponent(tid)},*` : '*';
      try {
        const resp = await fetch(`/api/events/active-announcements?event_ids=${queryIds}`);
        if (resp.ok) {
          const data = await resp.json();
          const list = (data && Array.isArray(data.announcements)) ? data.announcements : [];
          if (list.length > 0) {
            applyRemoteBroadcastList(list);
          } else if (!tid) {
            applyRemoteBroadcast(null);
          }
        }
      } catch (e) {}
    };
    pollActive();
    globalBroadcastPollTimer = setInterval(pollActive, 6000);
  }

  function initTournamentDirectSync(tournamentId) {
    if (!tournamentId) return;
    startTournamentClockFallbackPoll(tournamentId);
    if (fsTournUnsub) return;
    const db = getTrackerFirestoreDb();
    if (!db) return;

    try {
      fsTournUnsub = db.collection('tournaments').doc(tournamentId).onSnapshot((doc) => {
        if (!doc || !doc.exists) return;
        const data = doc.data() || {};
        if (data.masterClock) {
          applyRemoteMasterClock(data.masterClock);
        }
        if ('broadcast' in data || 'targeted_broadcasts' in data) {
          applyRemoteBroadcastBundle(data);
        }
        const calls = data.judge_calls || data.flags;
        if (Array.isArray(calls)) {
          const rawState = originalGetItem('gdm-11e-tracker-state');
          let stObj = {};
          try { stObj = JSON.parse(rawState) || {}; } catch(e) {}
          const myTable = getTrackerTableNum() || (stObj.settings && stObj.settings.tableNum);
          const myMatchId = clientState.matchId;

          const activeForMe = calls.find(c => {
            const matchMatches = myMatchId && (c.matchId === myMatchId || c.match_id === myMatchId);
            const tableMatches = myTable && (String(c.tableNum) === String(myTable) || String(c.table_num) === String(myTable) || String(c.tableNumber) === String(myTable));
            const isActive = c.status === 'pending' || c.status === 'en_route';
            return (matchMatches || tableMatches) && isActive;
          });

          if (activeForMe) {
            applyRemoteJudgeCall(activeForMe);
          } else if (clientState.activeJudgeCall && (clientState.activeJudgeCall.status === 'pending' || clientState.activeJudgeCall.status === 'en_route')) {
            const resolvedForMe = calls.find(c => {
              const idMatches = c.id === clientState.activeJudgeCall.call_id || c.call_id === clientState.activeJudgeCall.call_id || c.id === clientState.activeJudgeCall.id;
              const matchMatches = myMatchId && (c.matchId === myMatchId || c.match_id === myMatchId);
              return idMatches || matchMatches;
            });
            if (resolvedForMe && (resolvedForMe.status === 'resolved' || resolvedForMe.status === 'cancelled')) {
              applyRemoteJudgeCall(null);
            }
          }
        }
      }, (err) => {
        console.debug('[Firestore Tournament Sync] Notice:', err);
      });
    } catch (e) {
      console.debug('[Firestore Tournament Init] Notice:', e);
    }
  }

  function applyRemoteMasterClock(remote) {
    if (!remote || typeof remote !== 'object') return;
    const targetEnd = remote.targetEndTime || remote.target_end_time || null;
    const remSec = typeof remote.remainingSeconds === 'number' 
      ? remote.remainingSeconds 
      : (typeof remote.remaining_seconds === 'number' ? remote.remaining_seconds : 9000);
    const status = remote.status || 'stopped';
    const round = remote.round || remote.round_num || 1;
    const durMin = remote.durationMinutes || remote.duration_minutes || 150;
    const upAt = remote.updatedAt || remote.updated_at || Date.now();

    // Guard against uninitialized reset when local clock is already running:
    if (tournamentMasterClock.status === 'running' && status === 'stopped' && !targetEnd && (!remote.updatedAt && !remote.updated_at)) {
      return;
    }
    if (tournamentMasterClock.updatedAt && upAt && upAt < tournamentMasterClock.updatedAt) {
      return;
    }

    tournamentMasterClock.status = status;
    tournamentMasterClock.round = round;
    tournamentMasterClock.durationMinutes = durMin;
    tournamentMasterClock.targetEndTime = targetEnd;
    tournamentMasterClock.remainingSeconds = remSec;
    tournamentMasterClock.updatedAt = upAt;

    updateMasterClockDom();
    ensureMasterClockTicker();
  }

  let masterClockTicker = null;
  function ensureMasterClockTicker() {
    if (masterClockTicker) return;
    masterClockTicker = setInterval(() => {
      updateMasterClockDom();
    }, 1000);
  }

  function getMasterClockRemainingSeconds() {
    if (tournamentMasterClock.status === 'running' && tournamentMasterClock.targetEndTime) {
      return Math.max(0, Math.round((tournamentMasterClock.targetEndTime - Date.now()) / 1000));
    }
    return tournamentMasterClock.remainingSeconds;
  }

  function updateMasterClockDom() {
    const clockPill = document.getElementById('gt-master-clock-pill');
    const timeEl = document.getElementById('gt-master-clock-time');
    const roundEl = document.getElementById('gt-master-clock-round');
    if (!clockPill || !timeEl) return;

    const status = String(tournamentMasterClock.status || 'stopped').toLowerCase();
    if (status !== 'running' && status !== 'paused') {
      clockPill.style.display = 'none';
      return;
    }
    clockPill.style.display = 'inline-flex';

    const rem = getMasterClockRemainingSeconds();
    const hrs = Math.floor(rem / 3600);
    const mins = Math.floor((rem % 3600) / 60);
    const secs = rem % 60;
    const timeStr = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    timeEl.textContent = timeStr;
    if (roundEl) roundEl.textContent = tournamentMasterClock.round || 1;

    if (rem === 0 && status === 'running') {
      clockPill.style.background = '#e11d48';
      clockPill.style.color = '#fff';
      clockPill.style.borderColor = '#f43f5e';
      timeEl.textContent = "TIME EXPIRED";
    } else if (rem <= 300 && status === 'running') {
      clockPill.style.background = 'rgba(239, 68, 68, 0.2)';
      clockPill.style.color = '#ef4444';
      clockPill.style.borderColor = 'rgba(239, 68, 68, 0.6)';
    } else if (rem <= 900 && status === 'running') {
      clockPill.style.background = 'rgba(245, 158, 11, 0.2)';
      clockPill.style.color = '#f59e0b';
      clockPill.style.borderColor = 'rgba(245, 158, 11, 0.6)';
    } else if (status === 'paused') {
      clockPill.style.background = 'rgba(100, 116, 139, 0.2)';
      clockPill.style.color = '#94a3b8';
      clockPill.style.borderColor = '#475569';
    } else {
      clockPill.style.background = 'rgba(56, 189, 248, 0.12)';
      clockPill.style.color = '#38bdf8';
      clockPill.style.borderColor = 'rgba(56, 189, 248, 0.35)';
    }
  }

  let lastReceivedBroadcastId = null;
  const seenBroadcastIds = new Set();

  function isTargetedBroadcastForThisTable(b) {
    if (!b || (!b.target_table && !b.target_player_id && !b.target_player_name && !b.is_targeted)) {
      return false;
    }
    const rawState = originalGetItem('gdm-11e-tracker-state');
    let stObj = {};
    try { stObj = JSON.parse(rawState) || {}; } catch (e) {}
    const myTable = String(getTrackerTableNum() || (stObj.settings && stObj.settings.tableNum) || '').trim();
    if (b.target_table && myTable) {
      return String(b.target_table).trim() === myTable;
    }
    const p1Name = String((stObj.p1 && stObj.p1.name) || '').trim().toLowerCase();
    const p2Name = String((stObj.p2 && stObj.p2.name) || '').trim().toLowerCase();
    const targetName = String(b.target_player_name || '').trim().toLowerCase();
    if (targetName && ((p1Name && targetName.includes(p1Name)) || (p2Name && targetName.includes(p2Name)))) {
      return true;
    }
    // If tracker doesn't have a specific table configured yet, still allow targeted broadcasts for the active tournament
    return !myTable;
  }

  function applyRemoteBroadcastBundle(dataObj) {
    if (!dataObj || typeof dataObj !== 'object') return;
    const candidates = [];
    if (Array.isArray(dataObj.targeted_broadcasts)) {
      for (const tb of dataObj.targeted_broadcasts) {
        if (tb && tb.active !== false && tb.message && isTargetedBroadcastForThisTable(tb)) {
          candidates.push(tb);
        }
      }
    }
    const gen = dataObj.active_broadcast || dataObj.broadcast || null;
    if (gen && gen.active !== false && gen.message) {
      if (!gen.target_table && !gen.target_player_id && !gen.target_player_name && !gen.is_targeted) {
        candidates.push(gen);
      } else if (isTargetedBroadcastForThisTable(gen)) {
        candidates.push(gen);
      }
    }
    applyRemoteBroadcastList(candidates);
  }

  function applyRemoteBroadcastList(list) {
    const valid = (Array.isArray(list) ? list : []).filter(b => {
      if (!b || b.active === false || !b.message) return false;
      const isTargeted = Boolean(b.target_table || b.target_player_id || b.target_player_name || b.is_targeted);
      if (isTargeted && !isTargetedBroadcastForThisTable(b)) return false;
      return true;
    });
    if (valid.length === 0) {
      applyRemoteBroadcast(null);
      return;
    }
    // Prefer the newest unseen broadcast so a newly pushed targeted or general alert always pops immediately
    const unseen = valid.find(b => {
      const bId = b.id || `${b.event_id || ''}_${b.message}`;
      return !seenBroadcastIds.has(bId);
    });
    applyRemoteBroadcast(unseen || valid[0]);
  }

  function applyRemoteBroadcast(broadcast) {
    if (!broadcast || broadcast.active === false || !broadcast.message) {
      lastReceivedBroadcastId = null;
      const existingBanner = document.getElementById('gt-broadcast-banner');
      if (existingBanner) existingBanner.style.display = 'none';
      return;
    }
    const bId = broadcast.id || `${broadcast.event_id || ''}_${broadcast.message}`;
    if (bId === lastReceivedBroadcastId || seenBroadcastIds.has(bId)) return;
    lastReceivedBroadcastId = bId;
    seenBroadcastIds.add(bId);

    // Play chime sound via synthesized Web Audio
    playBroadcastAudioChime();

    // Show slide-in banner
    showBroadcastBanner(broadcast);
  }

  function playBroadcastAudioChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    } catch (e) {}
  }

  let broadcastBannerTimeout = null;
  function showBroadcastBanner(broadcast) {
    let banner = document.getElementById('gt-broadcast-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'gt-broadcast-banner';
      banner.style.position = 'fixed';
      banner.style.top = '12px';
      banner.style.left = '50%';
      banner.style.transform = 'translateX(-50%)';
      banner.style.zIndex = '999999';
      banner.style.maxWidth = '680px';
      banner.style.width = 'calc(100% - 24px)';
      banner.style.borderRadius = '12px';
      banner.style.boxShadow = '0 12px 40px rgba(0,0,0,0.85), 0 0 20px rgba(245,158,11,0.3)';
      banner.style.padding = '12px 16px';
      banner.style.fontFamily = "'Inter', system-ui, sans-serif";
      banner.style.transition = 'all 0.3s ease';
      document.body.appendChild(banner);
    }

    const type = broadcast.type || broadcast.level || 'info';
    let bg = 'linear-gradient(135deg, #0284c7, #0369a1)';
    let border = '1px solid #38bdf8';
    let icon = '📢';

    if (type === 'warning') {
      bg = 'linear-gradient(135deg, #b45309, #92400e)';
      border = '1px solid #f59e0b';
      icon = '⚠️';
    } else if (type === 'urgent') {
      bg = 'linear-gradient(135deg, #be123c, #9f1239)';
      border = '1px solid #f43f5e';
      icon = '🚨';
    } else if (type === 'final') {
      bg = 'linear-gradient(135deg, #991b1b, #7f1d1d)';
      border = '2px solid #ef4444';
      icon = '🛑';
    }

    banner.style.background = bg;
    banner.style.border = border;
    banner.style.display = 'block';

    const isTargeted = Boolean(broadcast.target_table || broadcast.target_player_name || broadcast.is_targeted);
    const headerLabel = isTargeted
      ? `🎯 Targeted TO Alert${broadcast.target_table ? ` • Table ${escapeHtml(String(broadcast.target_table))}` : ''}${broadcast.target_player_name ? ` • ${escapeHtml(String(broadcast.target_player_name))}` : ''}`
      : 'Tournament Announcement';

    banner.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <div style="display:flex; align-items:flex-start; gap:10px;">
          <span style="font-size:22px; flex-shrink:0;">${icon}</span>
          <div>
            <div style="font-size:11px; font-weight:800; color:rgba(255,255,255,0.85); text-transform:uppercase; letter-spacing:0.05em;">
              ${headerLabel}
            </div>
            <div style="font-size:14px; font-weight:700; color:#fff; margin-top:2px; line-height:1.4;">
              ${escapeHtml(broadcast.message || '')}
            </div>
          </div>
        </div>
        <button onclick="document.getElementById('gt-broadcast-banner').style.display='none'" style="background:transparent; border:none; color:#fff; font-size:18px; cursor:pointer; padding:0 4px; line-height:1; opacity:0.8;">✕</button>
      </div>
    `;

    if (broadcastBannerTimeout) clearTimeout(broadcastBannerTimeout);
    broadcastBannerTimeout = setTimeout(() => {
      if (banner) banner.style.display = 'none';
    }, 20000);
  }

  function applyRemoteJudgeCall(remoteCall) {
    if (!remoteCall || remoteCall.status === 'resolved' || remoteCall.status === 'cancelled') {
      const wasActive = Boolean(clientState.activeJudgeCall);
      clientState.activeJudgeCall = null;
      if (wasActive) {
        if (remoteCall && remoteCall.status === 'resolved') {
          playBroadcastAudioChime();
          const banner = document.getElementById('mp-broadcast-banner');
          if (banner) {
            banner.innerHTML = `<span style="font-size:18px;">✅</span> <strong>Judge Call Resolved</strong>: Floor judge marked this call as resolved.`;
            banner.style.display = 'block';
            banner.style.borderLeftColor = '#10b981';
            banner.style.background = 'linear-gradient(90deg, rgba(16, 185, 129, 0.2) 0%, rgba(15, 23, 42, 0.95) 100%)';
            setTimeout(() => { if (banner) banner.style.display = 'none'; }, 8000);
          }
        }
        injectMultiplayerHUD();
        renderJudgeModal();
      }
      return;
    }

    const prevStatus = clientState.activeJudgeCall ? clientState.activeJudgeCall.status : null;
    clientState.activeJudgeCall = remoteCall;

    if (remoteCall.status === 'en_route' && prevStatus === 'pending') {
      playBroadcastAudioChime();
    }

    injectMultiplayerHUD();
    renderJudgeModal();
  }

  async function broadcastState() {
    if (!clientState.matchId || clientState.isFinalizing || clientState.isDiscarded) return;
    if (clientState.role === 'spectator') return;
    const raw = originalGetItem('gdm-11e-tracker-state');
    if (!raw) return;

    let parsedState = {};
    try { parsedState = JSON.parse(raw); } catch (e) { return; }
    if (parsedState.is_finished) return;

    clientState.version++;

    // 1. Direct write to Cloud Firestore if client SDK is loaded (use .update so deleted rooms are never resurrected)
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      try {
        const db = firebase.firestore();
        db.collection('rooms').doc(clientState.matchId).update({
          state: parsedState,
          version: clientState.version,
          updatedAt: Date.now()
        }).catch(() => {});
      } catch(e) {}
    }

    // 2. Broadcast via API
    try {
      const guestId = getOrCreateGuestId();
      const resp = await fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}/state`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`,
          'X-Guest-Id': guestId
        },
        body: JSON.stringify({
          match_id: clientState.matchId,
          client_id: clientState.clientId,
          token: getAuthToken(),
          guest_id: guestId,
          role: clientState.role,
          version: clientState.version,
          state: parsedState
        })
      });
      if (resp.ok) {
        const resData = await resp.json();
        if (resData.version) {
          clientState.version = Math.max(clientState.version || 0, Number(resData.version));
        }
        if (resData.is_abandoned || resData.status === 'abandoned') {
          handleRemoteMatchDiscarded();
          return;
        }
        if (resData.is_finished || resData.status === 'finalized') {
          handleRemoteMatchFinalized();
          return;
        }
      }
      window.__broadcastHistoryUpdate();
    } catch (e) {}
  }

  function applyRemoteState(incoming) {
    if (!incoming) return;
    clientState.isApplyingRemote = true;
    try {
      const sanitized = injectDefaultCpIntoState(incoming);
      const stateObj = typeof sanitized === 'string' ? JSON.parse(sanitized) : sanitized;
      if (clientState.matchId && stateObj && typeof stateObj === 'object') {
        stateObj.id = clientState.matchId;
        stateObj.match_id = clientState.matchId;
        if (stateObj.user_id_p1) clientState.userIdP1 = stateObj.user_id_p1;
        if (stateObj.user_id_p2) clientState.userIdP2 = stateObj.user_id_p2;
      }
      const oldState = originalGetItem('gdm-11e-tracker-state');
      const serialized = JSON.stringify(stateObj);
      originalSetItem('gdm-11e-tracker-state', serialized);

      // 0. Synchronize Chess Clock and Dice Tray from game state
      if (stateObj.chess_clock) {
        applyRemoteChessClock(stateObj.chess_clock);
      }
      if (stateObj.dice_tray || stateObj.dice_trays) {
        applyRemoteDiceTray(stateObj.dice_tray, stateObj.dice_target, stateObj.dice_history, stateObj.dice_trays);
      }

      // Ensure CP Counter is enabled by default
      if (stateObj.game) {
        stateObj.game.trackCP = true;
        stateObj.game.showCP = true;
        stateObj.game.cpCounter = true;
        stateObj.game.enableCP = true;
      }
      stateObj.trackCP = true;
      stateObj.showCP = true;
      stateObj.cpCounter = true;
      stateObj.enableCP = true;

      // 1. Direct Setup Wizard DOM Injection
      if (stateObj.game) {
        injectSetupWizardState(stateObj.game, stateObj.p1, stateObj.p2);
      }

      // Auto-toggle CP switches in DOM if present
      try {
        const cpToggles = Array.from(document.querySelectorAll('button, input[type="checkbox"], [role="switch"]'));
        for (const el of cpToggles) {
          const text = (el.textContent || el.getAttribute('aria-label') || '').toUpperCase();
          const parentText = (el.parentElement ? el.parentElement.textContent || '' : '').toUpperCase();
          if (text.includes('CP') || text.includes('COMMAND POINT') || parentText.includes('CP COUNTER') || parentText.includes('COMMAND POINTS')) {
            if (el.tagName === 'INPUT' && !el.checked) {
              el.checked = true;
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (el.getAttribute('role') === 'switch' && el.getAttribute('aria-checked') === 'false') {
              el.click();
            }
          }
        }
      } catch(e) {}

      // 2. Direct React Context state injection
      if (typeof window.__gdmSetTrackerState === 'function') {
        window.__gdmSetTrackerState(stateObj);
      } else {
        let attempts = 0;
        const retryTimer = setInterval(() => {
          attempts++;
          if (typeof window.__gdmSetTrackerState === 'function') {
            window.__gdmSetTrackerState(stateObj);
            clearInterval(retryTimer);
          } else if (attempts >= 20) {
            clearInterval(retryTimer);
          }
        }, 50);
      }

      // 3. Custom event dispatch
      window.dispatchEvent(new CustomEvent('gdm-state-sync', { detail: stateObj }));

      // 4. Storage event dispatch
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'gdm-11e-tracker-state',
        newValue: serialized,
        oldValue: oldState,
        url: window.location.href,
        storageArea: localStorage
      }));

      // Refresh invite widget if P2 just connected
      const widget = document.getElementById('gt-invite-widget');
      const p2ReadyNow = Boolean(clientState.userIdP2 || stateObj.user_id_p2 || (stateObj.game && stateObj.game.p2Name && stateObj.game.p2Name !== 'Player 2') || clientState.role === 'player2');
      if (widget && p2ReadyNow) {
        widget.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
            <span style="font-size:12px; font-weight:800; color:#10b981; text-transform:uppercase; font-family:'JetBrains Mono',monospace;">🟢 Connected: Player 1 vs Player 2 (${escapeHtml((stateObj.game && stateObj.game.p2Name) || 'Opponent')})</span>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:11px; color:#94a3b8; font-family:'JetBrains Mono',monospace;">2/2 Players Active (Live Sync)</span>
              <button onclick="window.__openShareRoomModal('${escapeHtml(clientState.matchId)}');" style="background:rgba(56,189,248,0.14); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); border-radius:6px; padding:4px 9px; font-size:10.5px; font-weight:800; cursor:pointer; font-family:'JetBrains Mono',monospace;">
                🔗 Share / Spectator Link
              </button>
            </div>
          </div>
        `;
      }
      injectMultiplayerHUD();
    } catch (err) {
      console.error('[OmniTactica Sync Bridge] Error applying remote state:', err);
    } finally {
      setTimeout(() => { clientState.isApplyingRemote = false; }, 60);
    }
  }

  let fastPollTimer = null;
  let wizardScrapeTimer = null;

  function startHybridSync() {
    initFirestoreDirectSync();
    startRealtimeStream();
    const tournamentId = getTrackerTournamentId();
    if (tournamentId) {
      startTournamentClockFallbackPoll(tournamentId);
    }
    
    // 1. Local DOM wizard state scraper (0 network overhead)
    if (wizardScrapeTimer) clearInterval(wizardScrapeTimer);
    wizardScrapeTimer = setInterval(() => {
      if (!clientState.matchId || clientState.isApplyingRemote || clientState.isFinalizing || clientState.isDiscarded) return;
      const wizard = scrapeSetupWizardState();
      if (wizard) {
        const wizardJson = JSON.stringify(wizard);
        if (wizardJson !== lastScrapedJson) {
          lastScrapedJson = wizardJson;
          notifyStateChanged();
        }
      }
    }, 500);

    // 2. Network Fallback Poller: ONLY executes if BOTH Firestore and SSE are unavailable
    if (fastPollTimer) clearInterval(fastPollTimer);
    fastPollTimer = setInterval(async () => {
      if (!clientState.matchId || clientState.isApplyingRemote || clientState.isFinalizing || clientState.isDiscarded) return;
      if (document.hidden) return;

      // When Firestore direct sync or SSE stream is active, ZERO HTTP polling needed!
      const isRealtimeActive = Boolean(
        clientState.firestoreConnected ||
        (clientState.eventSource && clientState.eventSource.readyState === EventSource.OPEN)
      );
      if (isRealtimeActive) return;

      try {
        const resp = await fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}`, {
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`,
            'X-Guest-Id': getOrCreateGuestId()
          }
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.user_id_p1) clientState.userIdP1 = data.user_id_p1;
          if (data.user_id_p2) clientState.userIdP2 = data.user_id_p2;
          if (data.online_count !== undefined) {
            clientState.onlineCount = data.online_count;
            injectMultiplayerHUD();
          }
          if (data.chess_clock) {
            applyRemoteChessClock(data.chess_clock);
          }
          if (data.masterClock) {
            applyRemoteMasterClock(data.masterClock);
          }
          if (data.broadcast) {
            applyRemoteBroadcast(data.broadcast);
          }
          if (data.active_judge_call !== undefined && data.active_judge_call !== null) {
            applyRemoteJudgeCall(data.active_judge_call);
          } else if (clientState.activeJudgeCall) {
            applyRemoteJudgeCall(null);
          }
          const docTournId = data.eventId || data.event_id || data.tournament_id;
          if (docTournId && !clientState.tournamentId) {
            clientState.tournamentId = docTournId;
            initTournamentDirectSync(docTournId);
            startTournamentClockFallbackPoll(docTournId);
          }
          if (data.version && data.version > clientState.version && data.state) {
            clientState.version = data.version;
            applyRemoteState(data.state);
          }
        }
      } catch (e) {}
    }, 3000);

    // 3. Automatic Reconnect & Guest Seat Rebind on Phone Wake / Network Switch (Wi-Fi <-> 5G)
    if (!window.__gtReconnectListenersBound) {
      window.__gtReconnectListenersBound = true;
      const handleWakeReconnect = async () => {
        if (!clientState.matchId || clientState.isFinalizing || clientState.isDiscarded) return;
        if (document.hidden) return;
        try {
          if (!clientState.eventSource || clientState.eventSource.readyState === EventSource.CLOSED) {
            startRealtimeStream();
          }
          if (clientState.role === 'player1' || clientState.role === 'player2') {
            saveRoomSeat(clientState.matchId, clientState.role);
            await fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}/join`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`,
                'X-Guest-Id': getOrCreateGuestId()
              },
              body: JSON.stringify({
                match_id: clientState.matchId,
                token: getAuthToken(),
                guest_id: getOrCreateGuestId(),
                claim_role: clientState.role
              })
            }).catch(() => {});
          }
          const resp = await fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}`, {
            headers: {
              'Authorization': `Bearer ${getAuthToken()}`,
              'X-Guest-Id': getOrCreateGuestId()
            }
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data.user_id_p1) clientState.userIdP1 = data.user_id_p1;
            if (data.user_id_p2) clientState.userIdP2 = data.user_id_p2;
            if (data.chess_clock) applyRemoteChessClock(data.chess_clock);
            if (data.version && data.version > clientState.version && data.state) {
              clientState.version = data.version;
              applyRemoteState(data.state);
            }
          }
        } catch (e) {}
      };
      window.addEventListener('online', handleWakeReconnect);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') handleWakeReconnect();
      });
    }
  }

  function startRealtimeStream() {
    if (!clientState.matchId) return;
    if (clientState.eventSource) clientState.eventSource.close();

    try {
      const sseUrl = `${SYNC_CONFIG.apiBase}/${clientState.matchId}/stream?client_id=${clientState.clientId}`;
      const es = new EventSource(sseUrl);
      clientState.eventSource = es;
      es.onopen = () => {
        clientState.hasRealtimeStream = true;
      };
      es.onerror = () => {
        clientState.hasRealtimeStream = false;
      };

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'room_discarded' || msg.status === 'abandoned' || msg.is_abandoned) {
            handleRemoteMatchDiscarded();
            return;
          }
          if (msg.type === 'match_finalized' || msg.status === 'completed' || msg.is_finished) {
            handleRemoteMatchFinalized();
            return;
          }
          if (msg.type === 'state_update') {
            if (msg.user_id_p1) clientState.userIdP1 = msg.user_id_p1;
            if (msg.user_id_p2) clientState.userIdP2 = msg.user_id_p2;
            if (msg.sender !== clientState.clientId && msg.state) {
              if (msg.version >= clientState.version) {
                clientState.version = msg.version;
                applyRemoteState(msg.state);
              }
            }
          } else if (msg.type === 'clock_update') {
            if (msg.sender !== clientState.clientId && msg.chess_clock) {
              applyRemoteChessClock(msg.chess_clock);
            }
          } else if (msg.type === 'master_clock_update') {
            const clk = msg.master_clock || msg.masterClock;
            if (clk) {
              applyRemoteMasterClock(clk);
            }
          } else if (msg.type === 'broadcast_update') {
            if ('broadcast' in msg) {
              applyRemoteBroadcast(msg.broadcast);
            }
          } else if (msg.type === 'judge_call_update') {
            const callVal = (msg.active_judge_call !== undefined) ? msg.active_judge_call : msg.judge_call;
            applyRemoteJudgeCall(callVal);
          } else if (msg.type === 'dice_roll') {
            if (msg.roll) {
              applyRemoteDiceRoll(msg.roll, msg.sender === clientState.clientId);
            }
            if ((msg.tray || msg.trays) && msg.sender !== clientState.clientId) {
              applyRemoteDiceTray(msg.tray, msg.target, msg.history, msg.trays);
            }
          } else if (msg.type === 'dice_tray') {
            if (msg.sender !== clientState.clientId && (msg.tray || msg.trays)) {
              applyRemoteDiceTray(msg.tray, msg.target, msg.history, msg.trays);
            }
          } else if (msg.type === 'presence') {
            clientState.onlineCount = msg.count || 1;
            injectMultiplayerHUD();
          } else if (msg.type === 'army_list_updated') {
            if (msg.role === 'player1') {
              clientState.p1ArmyList = msg.army_list;
            } else if (msg.role === 'player2') {
              clientState.p2ArmyList = msg.army_list;
            }
            injectMultiplayerHUD();
            const modal = document.getElementById('gt-army-list-modal');
            if (modal && modal.style.display !== 'none') {
              const myRole = clientState.role === 'player2' ? 'player2' : 'player1';
              const oppRole = myRole === 'player1' ? 'player2' : 'player1';
              const activeTabRole = clientState.activeListTab === 'opponent' ? oppRole : (clientState.activeListTab === 'my' ? myRole : null);
              if (!activeTabRole || msg.role !== activeTabRole) {
                const oppTabBtn = modal.querySelector('button[onclick*="gtSetListTab(\'opponent\')"]');
                const myTabBtn = modal.querySelector('button[onclick*="gtSetListTab(\'my\')"]');
                const isP1Now = clientState.role !== 'player2';
                const myNow = isP1Now ? clientState.p1ArmyList : clientState.p2ArmyList;
                const oppNow = isP1Now ? clientState.p2ArmyList : clientState.p1ArmyList;
                if (oppTabBtn) oppTabBtn.innerHTML = `📜 Opp${oppNow ? ' 🟢' : ''}`;
                if (myTabBtn) myTabBtn.innerHTML = `📋 Mine${myNow ? ' 🟢' : ''}`;
              } else {
                const existingIframe = document.getElementById('gt-nr-play-mode-iframe');
                const existingKey = existingIframe ? existingIframe.getAttribute('data-list-key') : null;
                const incomingKey = msg.army_list ? resolveTrackerNrListKey(msg.army_list) : null;
                if (existingIframe && msg.army_list && (existingKey === incomingKey || (clientState.rosterViewMode === 'edit' && clientState.activeListTab === 'my'))) {
                  const titleEl = document.getElementById('gt-active-roster-title');
                  const metaEl = document.getElementById('gt-active-roster-meta');
                  if (titleEl) titleEl.textContent = msg.army_list.name || 'Army Roster';
                  if (metaEl) metaEl.textContent = `${msg.army_list.faction || 'Warhammer 40,000'} • ${msg.army_list.detachment || 'Core Detachment'} • ${msg.army_list.points || 2000} PTS`;
                } else {
                  renderArmyListModal();
                }
              }
            }
          }
        } catch (e) {}
      };
    } catch (e) {}
  }

  function autoToggleCpInDom() {
    if (clientState.role === 'spectator') return;
    try {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const txt = (btn.textContent || '').trim().toUpperCase();
        if (txt === 'TRACK COMMAND POINTS OFF' || txt === 'COMMAND POINTS OFF' || txt === 'TRACK CP OFF' || (txt.includes('COMMAND POINTS') && txt.includes('OFF'))) {
          btn.click();
        }
      }
    } catch(e) {}
  }

  let stateDebounceTimer = null;
  function scheduleNotifyStateChanged() {
    if (clientState.role === 'spectator') return;
    if (stateDebounceTimer) clearTimeout(stateDebounceTimer);
    stateDebounceTimer = setTimeout(() => {
      notifyStateChanged();
    }, 150);
  }

  function attachDomActionInterceptors() {
    // Continuous CP Counter auto-enable
    autoToggleCpInDom();
    setInterval(autoToggleCpInDom, 500);

    const cpObs = new MutationObserver(autoToggleCpInDom);
    cpObs.observe(document.body, { childList: true, subtree: true, characterData: true });

    document.addEventListener('input', (e) => {
      if (clientState.role === 'spectator') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.target && e.target.closest && (e.target.closest('#gt-sync-hud') || e.target.closest('#gt-complete-modal') || e.target.closest('#gt-army-list-modal') || e.target.closest('#gt-share-room-modal') || e.target.closest('#gt-user-status-bar'))) return;
      scheduleNotifyStateChanged();
    }, true);

    document.addEventListener('change', (e) => {
      if (clientState.role === 'spectator') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.target && e.target.closest && (e.target.closest('#gt-sync-hud') || e.target.closest('#gt-complete-modal') || e.target.closest('#gt-army-list-modal') || e.target.closest('#gt-share-room-modal') || e.target.closest('#gt-user-status-bar'))) return;
      scheduleNotifyStateChanged();
    }, true);

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!target) return;

      if (clientState.role === 'spectator') {
        if (target.closest && target.closest('#root')) {
          const interactive = target.closest('button, input, select, textarea, [role="button"]');
          if (interactive) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
      }

      // Intercept Game Tracker "Return to games" summary button to trigger conclusion & save
      const btnOrLink = target.closest ? target.closest('button, a') : null;
      if (btnOrLink) {
        const txt = (btnOrLink.textContent || '').trim().toLowerCase();
        if (txt.includes('return to games') || txt.includes('return to game')) {
          e.preventDefault();
          e.stopPropagation();
          window.__openCompleteModal();
          return;
        }
      }

      if (target.closest && (target.closest('#gt-sync-hud') || target.closest('#gt-complete-modal') || target.closest('#gt-army-list-modal') || target.closest('#gt-share-room-modal') || target.closest('#gt-user-status-bar'))) return;
      scheduleNotifyStateChanged();
      autoToggleCpInDom();
    }, true);
  }

  // 8. Floating Multiplayer Status HUD with Connected Player Names & Army Lists
  function injectMultiplayerHUD() {
    let hud = document.getElementById('gt-sync-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'gt-sync-hud';
      document.body.appendChild(hud);
    }

    // Clean up standalone user bar if present in match mode
    const oldBar = document.getElementById('gt-user-status-bar');
    if (oldBar) oldBar.remove();

    const raw = originalGetItem('gdm-11e-tracker-state');
    let stateObj = {};
    try { stateObj = JSON.parse(raw) || {}; } catch(e) {}
    const game = stateObj.game || {};

    const p1Raw = game.p1Name || (currentUser && clientState.role === 'player1' ? currentUser.display_name : 'Player 1') || 'Player 1';
    let p2Raw = game.p2Name;
    const isP2Ready = Boolean(clientState.userIdP2 || stateObj.user_id_p2 || (game.p2Name && game.p2Name !== 'Player 2') || clientState.role === 'player2');
    if (!p2Raw || p2Raw === 'Player 2') {
      p2Raw = isP2Ready ? (clientState.isGuest && clientState.role === 'player2' ? 'Player 2 (Guest)' : 'Player 2 (Opponent)') : 'Waiting for P2...';
    }

    // Role-aware (You) display
    let p1Display = p1Raw;
    let p2Display = p2Raw;
    if (clientState.role === 'player1') {
      p1Display = `${p1Raw} (You)`;
    } else if (clientState.role === 'player2') {
      p2Display = `${p2Raw} (You)`;
    }

    const isP1 = clientState.role === 'player1';
    const isSpectator = clientState.role === 'spectator';
    const hasMyList = isP1 ? !!clientState.p1ArmyList : !!clientState.p2ArmyList;
    const hasOppList = isP1 ? !!clientState.p2ArmyList : !!clientState.p1ArmyList;

    const statusDotColor = isP2Ready ? '#10b981' : '#f59e0b';
    const statusDotPulse = isP2Ready ? '' : 'animation:pulse 1.5s infinite;';

    const urlParams = new URLSearchParams(window.location.search);
    const tournamentId = getTrackerTournamentId();
    const tableNum = getTrackerTableNum();

    // Signature memoization to prevent clobbering DOM on active user clicks
    const judgeCallSig = clientState.activeJudgeCall ? (clientState.activeJudgeCall.id || clientState.activeJudgeCall.status || 'pending') : 'none';
    const masterClockSig = `${tournamentMasterClock.status}_${tournamentMasterClock.round}`;
    const sig = `${clientState.matchId}_${clientState.role}_${p1Display}_${p2Display}_${isP2Ready}_${hasMyList}_${hasOppList}_${tournamentId}_${tableNum}_${judgeCallSig}_${masterClockSig}`;
    injectMobileBottomDock();
    if (hud.dataset.sig === sig) {
      updateMasterClockDom();
      return;
    }
    hud.dataset.sig = sig;

    const isMobileHud = window.innerWidth <= 480;
    const rawMatchStr = String(clientState.matchId || '').replace(/^(WH40K-|AOS-)/i, '');
    const compactMatchId = isMobileHud
      ? (rawMatchStr.split('-').pop() || rawMatchStr.slice(-6))
      : clientState.matchId;

    const compactName = (nameStr) => {
      if (!isMobileHud || !nameStr) return nameStr;
      const clean = String(nameStr).replace(/\s*\(You\)/i, '').trim();
      if (/^waiting/i.test(clean)) return 'P2...';
      const parts = clean.split(/\s+/);
      if (parts.length >= 2 && clean.length > 10) {
        return `${parts[0]} ${parts[parts.length - 1][0]}.`;
      }
      return clean.length > 11 ? clean.slice(0, 10) + '…' : clean;
    };
    const hudP1Display = isMobileHud ? compactName(p1Display) : p1Display;
    const hudP2Display = isMobileHud ? compactName(p2Display) : p2Display;

    hud.innerHTML = `
      <!-- Left: Hub & Lobby Navigation & Match Tag -->
      <div style="display:inline-flex; align-items:center; gap:5px; flex-shrink:0;">
        <a href="/#my-hub" style="display:inline-flex; align-items:center; gap:3px; color:#38bdf8; text-decoration:none; font-size:11px; font-weight:800; background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.25); padding:4px 7px; border-radius:6px; font-family:'JetBrains Mono',monospace; cursor:pointer;">
          🏠 Hub
        </a>
        <a href="/11th/tracker" onclick="if(window.__showGtLoadingOverlay) window.__showGtLoadingOverlay('🎲 Entering Game Tracker Lobby', 'Loading active tabletop rooms & match history...');" style="display:inline-flex; align-items:center; gap:3px; color:#f59e0b; text-decoration:none; font-size:11px; font-weight:800; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.25); padding:4px 7px; border-radius:6px; font-family:'JetBrains Mono',monospace; cursor:pointer;">
          🎲 Lobby
        </a>
        <span onclick="window.__openShareRoomModal()" title="Tap to Share Match Room (Link or OmniTactica Chat)" style="font-family:'JetBrains Mono',monospace; color:#f59e0b; font-size:10.5px; background:#070b14; padding:4px 6px; border-radius:6px; border:1px solid #334155; font-weight:800; white-space:nowrap; cursor:pointer;">
          #${compactMatchId}${tableNum ? ` (T${tableNum})` : ''} 🔗
        </span>
        ${isSpectator ? `
          <span style="font-family:'JetBrains Mono',monospace; color:#cbd5e1; font-size:11px; background:rgba(100,116,139,0.25); border:1px solid rgba(148,163,184,0.3); padding:4px 8px; border-radius:6px; font-weight:800; display:inline-flex; align-items:center; gap:4px;">
            👀 Spectator Mode (Read-Only)
          </span>
        ` : ''}
        ${clientState.role === 'referee' ? `
          <span style="font-family:'JetBrains Mono',monospace; color:#38bdf8; font-size:11px; background:rgba(56,189,248,0.18); border:1px solid rgba(56,189,248,0.4); padding:4px 8px; border-radius:6px; font-weight:800; display:inline-flex; align-items:center; gap:4px;">
            ⚖️ Tournament Referee / TO
          </span>
        ` : ''}
        ${tournamentId ? `
          <div id="gt-master-clock-pill" style="display:${(tournamentMasterClock.status === 'running' || tournamentMasterClock.status === 'paused') ? 'inline-flex' : 'none'}; align-items:center; gap:5px; background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.35); padding:4px 8px; border-radius:6px; font-size:11px; font-weight:800; font-family:'JetBrains Mono',monospace;" title="Tournament Round Master Clock (Synchronized with TO)">
            <span>⏱️ Round Clock:</span>
            <span id="gt-master-clock-time">02:30:00</span>
          </div>
        ` : ''}
      </div>

      <!-- Center: Connected Players Matchup -->
      <div style="display:inline-flex; align-items:center; gap:4px; font-weight:800; font-family:'JetBrains Mono',monospace; font-size:10.5px; padding:0 2px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
        <span style="width:7px; height:7px; border-radius:50%; background:${statusDotColor}; ${statusDotPulse}; flex-shrink:0;"></span>
        <span style="color:#38bdf8; overflow:hidden; text-overflow:ellipsis;">${hudP1Display}</span>
        <span style="color:#64748b; font-size:10px;">vs</span>
        <span style="${isP2Ready ? 'color:#10b981;' : 'color:#94a3b8; font-style:italic;'} overflow:hidden; text-overflow:ellipsis;">${hudP2Display}</span>
      </div>

      <!-- Right: Action Buttons (Desktop / Wide Screen) -->
      <div class="gt-desktop-actions" style="display:inline-flex; align-items:center; gap:6px; flex-shrink:0;">
        <button onclick="window.gtToggleChessClock()" style="background:#0f172a; color:#38bdf8; border:1px solid rgba(56,189,248,0.4); padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Open Table Chess Clock (Independent)">
          ⏱️ Table Clock
        </button>
        <button onclick="window.gtToggleDiceRoller()" style="background:#0f172a; color:#f59e0b; border:1px solid rgba(245,158,11,0.4); padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Open Synchronized Dice Roller">
          🎲 Dice
        </button>
        ${tournamentId && !isSpectator ? `
          ${clientState.activeJudgeCall && clientState.activeJudgeCall.status === 'en_route' ? `
            <button onclick="window.gtOpenJudgeModal()" style="background:linear-gradient(135deg, #0284c7, #0369a1); color:#fff; border:1px solid #38bdf8; padding:4px 9px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:4px; box-shadow:0 0 12px rgba(56,189,248,0.5);" title="Floor judge is en route!">
              🏃‍♂️ ${(clientState.activeJudgeCall.assignedJudge && clientState.activeJudgeCall.assignedJudge.name) || 'Judge'} En Route!
            </button>
          ` : clientState.activeJudgeCall && clientState.activeJudgeCall.status === 'pending' ? `
            <button onclick="window.gtOpenJudgeModal()" style="background:linear-gradient(135deg, #e11d48, #be123c); color:#fff; border:1px solid #f43f5e; padding:4px 9px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:4px; box-shadow:0 0 12px rgba(225,29,72,0.6);" title="Floor judge dispatch pending">
              🚨 Judge Pending
            </button>
          ` : clientState.activeJudgeCall && clientState.activeJudgeCall.status === 'resolved' ? `
            <button onclick="window.gtOpenJudgeModal()" style="background:linear-gradient(135deg, #059669, #10b981); color:#fff; border:1px solid #10b981; padding:4px 9px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Judge call resolved">
              ✅ Judge Resolved
            </button>
          ` : `
            <button onclick="window.gtOpenJudgeModal()" style="background:#881337; color:#fff; border:1px solid #f43f5e; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Call Tournament Judge">
              🙋‍♂️ Call Judge
            </button>
          `}
        ` : ''}
        <button onclick="window.gtOpenArmyListModal('opponent')" style="background:${hasOppList ? '#4f46e5' : '#1e293b'}; color:#fff; border:1px solid ${hasOppList ? '#6366f1' : '#334155'}; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="View Opponent's Army List">
          📜 Opponent List ${hasOppList ? '🟢' : ''}
        </button>
        <button onclick="window.gtOpenArmyListModal('my')" style="background:${hasMyList ? '#059669' : '#1e293b'}; color:#fff; border:1px solid ${hasMyList ? '#10b981' : '#334155'}; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="View Your Army List">
          📋 My List ${hasMyList ? '🟢' : ''}
        </button>
        ${isPlay && !isSpectator ? `
          <button onclick="window.__openScorecardModal()" style="background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Open Scorecard">
            📄 Scorecard
          </button>
          <button onclick="window.__openCompleteModal()" style="background:#059669; color:#fff; border:1px solid #10b981; padding:4px 9px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Complete Game">
            🏁 Finish
          </button>
        ` : (isPlay ? `
          <button onclick="window.__openScorecardModal()" style="background:rgba(56,189,248,0.12); color:#38bdf8; border:1px solid rgba(56,189,248,0.25); padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Open Scorecard">
            📄 Scorecard
          </button>
        ` : '')}
        <button id="gt-hud-share-btn" onclick="window.__openShareRoomModal()" style="background:#0284c7; color:#fff; border:none; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;" title="Share Match Room (Link or OmniTactica Chat)">
          🔗 Share
        </button>
        <button onclick="window.gtOpenFeedbackModal()" style="background:rgba(255,255,255,0.06); color:#94a3b8; border:1px solid rgba(255,255,255,0.12); padding:4px 8px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="Send Feedback or Report an Issue">
          💬 Feedback
        </button>
      </div>
    `;

    injectMobileBottomDock();
    updateMasterClockDom();

    if (typeof mountDiceRollerModal === 'function' && typeof diceRollerState !== 'undefined' && diceRollerState.visible) {
      mountDiceRollerModal();
    }
  }

  // 8b. Mobile Bottom Action Dock (Finish, Dice, Judge, Clock, Scorecard, Lists)
  function injectMobileBottomDock() {
    let dock = document.getElementById('gt-mobile-bottom-dock');
    if (!dock) {
      dock = document.createElement('nav');
      dock.id = 'gt-mobile-bottom-dock';
      dock.className = 'gt-mobile-bottom-dock';
      document.body.appendChild(dock);
    }

    document.body.classList.add('has-mobile-dock');

    const isSpectator = clientState.role === 'spectator';
    const isP1 = clientState.role === 'player1';
    const hasMyList = isP1 ? !!clientState.p1ArmyList : !!clientState.p2ArmyList;
    const hasOppList = isP1 ? !!clientState.p2ArmyList : !!clientState.p1ArmyList;

    const judgeCall = clientState.activeJudgeCall;
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

    const dockSig = `${clientState.role}_${judgeText}_${hasOppList}_${hasMyList}`;
    if (dock.dataset.sig === dockSig) return;
    dock.dataset.sig = dockSig;

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
      <button type="button" class="gt-dock-btn" style="background:rgba(79,70,229,0.15); border-color:rgba(99,102,241,0.4); color:#a5b4fc;" onclick="window.__openScorecardModal()" title="View Scorecard">
        <span class="gt-dock-icon">📄</span>
        <span class="gt-dock-label">Card</span>
      </button>
      <button type="button" class="gt-dock-btn" style="background:${hasOppList || hasMyList ? 'rgba(16,185,129,0.15)' : 'rgba(30,41,59,0.5)'}; border-color:${hasOppList || hasMyList ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.1)'}; color:${hasOppList || hasMyList ? '#34d399' : '#94a3b8'};" onclick="window.gtOpenArmyListModal('${hasMyList ? 'my' : (hasOppList ? 'opponent' : 'attach')}')" title="View Army Lists">
        <span class="gt-dock-icon">📋</span>
        <span class="gt-dock-label">Lists ${hasOppList || hasMyList ? '•' : ''}</span>
      </button>
    `;
  }
  window.injectMobileBottomDock = injectMobileBottomDock;

  // 9. Interactive Army List Inspector Modal & NewRecruit Play Mode Viewer
  async function loadRoomArmyLists() {
    if (!clientState.matchId) return;
    try {
      const resp = await fetch(`/api/tracker/room/${clientState.matchId}/armylists`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.p1_army_list) clientState.p1ArmyList = data.p1_army_list;
        if (data.p2_army_list) clientState.p2ArmyList = data.p2_army_list;
      }
      // Auto-attach preloaded list from My Hub ("⚔️ Play") if current seat has no list yet
      const isP1 = clientState.role !== 'player2';
      const myCurrentList = isP1 ? clientState.p1ArmyList : clientState.p2ArmyList;
      if (!myCurrentList && clientState.role !== 'spectator') {
        const preloadedRaw = sessionStorage.getItem('omni_preloaded_list') || localStorage.getItem('omni_preloaded_list');
        if (preloadedRaw) {
          try {
            const preloadedList = JSON.parse(preloadedRaw);
            if (preloadedList && (preloadedList.id || preloadedList.list_key || preloadedList.name)) {
              const role = clientState.role === 'player2' ? 'player2' : 'player1';
              const guestId = getOrCreateGuestId();
              const attachResp = await fetch(`/api/tracker/room/${clientState.matchId}/armylist`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}`, 'X-Guest-Id': guestId },
                body: JSON.stringify({ role: role, army_list: preloadedList, guest_id: guestId })
              });
              if (attachResp.ok) {
                const attachData = await attachResp.json().catch(() => ({}));
                const savedList = attachData.army_list || preloadedList;
                if (role === 'player1') clientState.p1ArmyList = savedList;
                else clientState.p2ArmyList = savedList;
              }
            }
          } catch (err) {}
        }
      }
      injectMultiplayerHUD();
    } catch(e) {}
  }

  window.gtOpenArmyListModal = function(tab) {
    const isP1 = clientState.role !== 'player2';
    const hasMyList = isP1 ? !!clientState.p1ArmyList : !!clientState.p2ArmyList;
    const hasOppList = isP1 ? !!clientState.p2ArmyList : !!clientState.p1ArmyList;
    if (!tab) {
      tab = hasMyList ? 'my' : (hasOppList ? 'opponent' : 'attach');
    }
    clientState.activeListTab = tab;
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
    clientState.activeListTab = tab;
    renderArmyListModal();
  };

  window.gtSetListFilter = function(filter) {
    clientState.activeListFilter = filter;
    renderArmyListModal();
  };

  window.gtSearchArmyList = function(query) {
    clientState.listSearchQuery = (query || '').toLowerCase().trim();
    renderArmyListModal();
  };

  window.gtAdjustWound = function(unitId, modelIdx, delta, maxW) {
    const key = `${clientState.matchId}_${unitId}_${modelIdx}`;
    let current = clientState.wounds[key];
    if (current === undefined) current = maxW;
    current = Math.max(0, Math.min(maxW, current + delta));
    clientState.wounds[key] = current;
    renderArmyListModal();
  };

  window.gtAttachList = async function(listData) {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const matchId = clientState.matchId || urlParams.get('match_id') || 'MATCH';
      const role = clientState.role === 'player2' ? 'player2' : 'player1';
      const guestId = getOrCreateGuestId();
      const resp = await fetch(`/api/tracker/room/${matchId}/armylist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}`, 'X-Guest-Id': guestId },
        body: JSON.stringify({ role: role, army_list: listData, guest_id: guestId })
      });
      if (resp.ok) {
        const resData = await resp.json().catch(() => ({}));
        const attachedList = resData.army_list || listData;
        if (role === 'player1') clientState.p1ArmyList = attachedList;
        else clientState.p2ArmyList = attachedList;
        clientState.activeListTab = 'my';
        clientState.rosterViewMode = 'play';
        injectMultiplayerHUD();
        renderArmyListModal();
      } else {
        const errData = await resp.json().catch(() => ({}));
        alert('Error attaching army list: ' + (errData.detail || resp.statusText));
      }
    } catch(e) {
      alert('Error attaching army list: ' + e.message);
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
    let out = `${list.faction || 'Warhammer 40,000'} - ${list.detachment || 'Core Detachment'} (${list.points || 2000} pts)\n\n`;
    const units = list.units || [];
    const groups = {};
    for (const u of units) {
      const role = (u.role || 'Other Datasheets').toUpperCase();
      if (!groups[role]) groups[role] = [];
      groups[role].push(u);
    }
    for (const [role, uList] of Object.entries(groups)) {
      out += `+ ${role} +\n`;
      for (const u of uList) {
        const cnt = u.model_count && u.model_count > 1 ? `${u.model_count}x ` : '';
        out += `${cnt}${u.name} [${u.points || 0} pts]`;
        const tags = [];
        if (u.is_warlord) tags.push('Warlord');
        if (u.enhancement) tags.push(`Enhancement: ${u.enhancement}`);
        if (tags.length > 0) out += `: ${tags.join(', ')}`;
        out += '\n';
        if (u.wargear && u.wargear.length > 0) {
          out += `  • Wargear: ${u.wargear.join(', ')}\n`;
        }
      }
      out += '\n';
    }
    return out.trim();
  }

  window.gtCopyTrackerRawText = function() {
    const isP1 = clientState.role !== 'player2';
    const myList = isP1 ? clientState.p1ArmyList : clientState.p2ArmyList;
    const oppList = isP1 ? clientState.p2ArmyList : clientState.p1ArmyList;
    const activeList = clientState.activeListTab === 'opponent' ? oppList : myList;
    if (!activeList) return;
    const rawText = generateTrackerRawRosterText(activeList);
    navigator.clipboard.writeText(rawText).then(() => {
      alert('📋 Raw roster text copied to clipboard!');
    }).catch(() => {
      prompt('Copy your roster text below:', rawText);
    });
  };

  window.gtToggleRosterViewMode = function(mode) {
    const prevMode = clientState.rosterViewMode || 'play';
    clientState.rosterViewMode = mode;
    const isP1 = clientState.role !== 'player2';
    const activeList = clientState.activeListTab === 'opponent'
      ? (isP1 ? clientState.p2ArmyList : clientState.p1ArmyList)
      : (isP1 ? clientState.p1ArmyList : clientState.p2ArmyList);
    const iframe = document.getElementById('gt-nr-play-mode-iframe');
    if (
      iframe &&
      activeList &&
      (mode === 'play' || mode === 'edit') &&
      (prevMode === 'play' || prevMode === 'edit') &&
      clientState.activeListTab !== 'opponent'
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

  async function fetchTrackerNewRecruitLists() {
    const mergedMap = new Map();
    const addItem = (item) => {
      if (!item || typeof item !== 'object') return;
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
      fetch('/api/armylists?game_system=all', {
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
      alert('Please paste your NewRecruit share link or army roster text.');
      return;
    }
    const rawText = textarea.value.trim();
    try {
      const isUrl = /^https?:\/\//i.test(rawText) && rawText.toLowerCase().includes('newrecruit');
      const parseResp = await fetch('/api/armylists/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUrl ? { url: rawText, text: rawText } : { text: rawText })
      });
      if (!parseResp.ok) throw new Error('Failed to parse roster');
      const pData = await parseResp.json();
      const armyList = pData.army_list;

      // Attach directly to current match room (never saving to backend user_army_lists DB)
      await window.gtAttachList(armyList);
    } catch(e) {
      alert('Parse error: ' + e.message);
    }
  };

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

  function renderSavedListsGridInTracker(lists) {
    const grid = document.getElementById('gt-saved-lists-grid');
    if (!grid) return;
    if (!Array.isArray(lists) || lists.length === 0) {
      grid.innerHTML = `<div style="color:#64748b; font-size:12px; grid-column:1/-1;">No saved lists found yet. Paste a NewRecruit link/text below or build one in My Hub's NewRecruit Studio.</div>`;
      return;
    }
    grid.innerHTML = lists.map(l => `
      <div class="gt-saved-list-card" data-list-id="${escapeHtml(l.id)}" style="background:#131d33; border:1px solid rgba(56,189,248,0.18); border-radius:10px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; gap:10px;">
        <div>
          <div style="font-weight:800; font-size:14px; color:#f8fafc;">${escapeHtml(l.name || 'Unnamed List')}</div>
          <div style="font-size:12px; color:#38bdf8; font-weight:700; margin-top:2px;">${escapeHtml(l.faction || '40k')} • ${escapeHtml(l.detachment || 'Core')}</div>
          <div style="font-size:11px; color:#94a3b8; margin-top:4px;">${l.points || 2000} pts • 🎮 Play Mode Ready</div>
        </div>
        <button onclick="window.gtAttachSavedList('${escapeHtml(l.id)}')" style="background:#10b981; color:#0f172a; font-weight:800; font-size:12px; border:none; padding:8px 12px; border-radius:6px; cursor:pointer;">
          ⚔️ Attach This List
        </button>
      </div>
    `).join('');
  }

  // Listen for live NewRecruit edits/creations/deletions inside Game Tracker
  if (!window.__gtNrSyncListenerBound) {
    window.__gtNrSyncListenerBound = true;
    window.addEventListener('message', (ev) => {
      const msg = ev && ev.data;
      if (!msg || msg.type !== 'OMNITACTICA_NR_SYNC_EVENT') return;
      if (Array.isArray(msg.army_lists)) {
        window.gtSavedListsCache = msg.army_lists;
        renderSavedListsGridInTracker(msg.army_lists);
      }
      const updated = msg.army_list;
      if (updated && typeof updated === 'object') {
        const uKey = resolveTrackerNrListKey(updated);
        const matchSlot = (slotObj) => {
          if (!slotObj) return false;
          return slotObj.id === updated.id || resolveTrackerNrListKey(slotObj) === uKey;
        };
        const isP1 = clientState.role !== 'player2';
        let myMatched = false;
        if (matchSlot(clientState.p1ArmyList)) {
          clientState.p1ArmyList = updated;
          if (isP1) myMatched = true;
        }
        if (matchSlot(clientState.p2ArmyList)) {
          clientState.p2ArmyList = updated;
          if (!isP1) myMatched = true;
        }
        if (myMatched && clientState.matchId && clientState.rosterViewMode === 'edit') {
          const role = isP1 ? 'player1' : 'player2';
          fetch(`/api/tracker/room/${clientState.matchId}/armylist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
            body: JSON.stringify({ role: role, army_list: updated })
          }).catch(() => {});
        }
        injectMultiplayerHUD();
        const titleEl = document.getElementById('gt-active-roster-title');
        const metaEl = document.getElementById('gt-active-roster-meta');
        const iframeEl = document.getElementById('gt-nr-play-mode-iframe');
        const curActive = clientState.activeListTab === 'opponent'
          ? (isP1 ? clientState.p2ArmyList : clientState.p1ArmyList)
          : (isP1 ? clientState.p1ArmyList : clientState.p2ArmyList);
        const targetList = (curActive && matchSlot(curActive))
          ? curActive
          : (iframeEl && iframeEl.getAttribute('data-list-key') === uKey ? updated : null);
        if (targetList) {
          if (titleEl) titleEl.textContent = targetList.name || 'Army Roster';
          if (metaEl) metaEl.textContent = `${targetList.faction || 'Warhammer 40,000'} • ${targetList.detachment || 'Core Detachment'} • ${targetList.points || 2000} PTS`;
        }
      }
    });
  }

  function renderTrackerNativeRoster(list) {
    const activeMode = (clientState.rosterViewMode === 'text' || clientState.rosterViewMode === 'edit')
      ? clientState.rosterViewMode
      : 'play';

    const name = list.name || 'Army Roster';
    const faction = list.faction || 'Warhammer 40,000';
    const detachment = list.detachment || 'Core Detachment';
    const points = list.points || 2000;
    const listKey = resolveTrackerNrListKey(list);

    // Preserve DOM hooks for live SSE updates without consuming vertical space in Play/Edit mode
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
            <span style="font-size:12px; font-weight:800; color:#38bdf8;">${escapeHtml(name)} • ${escapeHtml(faction)} (${points} pts)</span>
            <button onclick="window.gtCopyTrackerRawText()" style="background:#1e293b; color:#38bdf8; border:1px solid rgba(56,189,248,0.3); font-weight:800; font-size:11px; padding:4px 10px; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:5px;">
              📋 Copy Raw Text
            </button>
          </div>
          <pre style="flex:1; margin:0; background:#030712; border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:12px; font-family:'JetBrains Mono',monospace; font-size:11.5px; color:#e2e8f0; line-height:1.55; white-space:pre-wrap; overflow-y:auto; word-break:break-word;">${escapeHtml(rawText)}</pre>
        </div>
      `;
    }

    const isOppTab = clientState.activeListTab === 'opponent';
    const isEphemeralView = Boolean(isOppTab || list._ephemeral_view || (list.nr_row && list.nr_row._ephemeral_view));
    try {
      if (list.nr_row && window.sessionStorage) {
        const rowToStore = isEphemeralView ? Object.assign({}, list.nr_row, { _ephemeral_view: true }) : list.nr_row;
        window.sessionStorage.setItem('omni_pending_nr_row_' + listKey, JSON.stringify(rowToStore));
      }
    } catch (e) {}

    const ephParam = isEphemeralView ? '&ephemeral=1' : '';
    const nameParam = list.name ? `&name=${encodeURIComponent(list.name)}` : '';
    const cbParam = `&_cb=${Date.now()}`;
    const iframeUrl = (activeMode === 'edit' && !isOppTab)
      ? `/nr/app/Lists/${encodeURIComponent(listKey)}?embed=tracker${nameParam}${cbParam}`
      : `/nr/app/Lists/${encodeURIComponent(listKey)}?view=play&embed=tracker${ephParam}${nameParam}${cbParam}`;

    return `
      ${hiddenMetaHooks}
      <div style="flex:1; position:relative; background:#090d16; display:flex; flex-direction:column; min-height:0; height:100%; overflow:hidden;">
        <iframe
          id="gt-nr-play-mode-iframe"
          data-list-key="${escapeHtml(listKey)}"
          data-play-mode="${activeMode === 'play' ? '1' : '0'}"
          src="${iframeUrl}"
          title="NewRecruit Play Mode - Datasheets & Stratagems"
          style="width:100%; height:100%; flex:1; border:none; display:block; background:#090d16;"
          allow="clipboard-read; clipboard-write"
        ></iframe>
      </div>
    `;
  }

  async function renderArmyListModal() {
    const modal = document.getElementById('gt-army-list-modal');
    if (!modal) return;

    const isP1 = clientState.role !== 'player2';
    const myList = isP1 ? clientState.p1ArmyList : clientState.p2ArmyList;
    const oppList = isP1 ? clientState.p2ArmyList : clientState.p1ArmyList;

    let activeList = null;
    if (clientState.activeListTab === 'opponent') activeList = oppList;
    else if (clientState.activeListTab === 'my') activeList = myList;

    const tab = clientState.activeListTab;
    const hasActiveRoster = (tab === 'opponent' || tab === 'my') && activeList && (activeList.list_key || activeList.nr_row || activeList.source_url || activeList.raw_text || (activeList.units && activeList.units.length > 0));
    if (tab === 'opponent' && clientState.rosterViewMode === 'edit') {
      clientState.rosterViewMode = 'play';
    }
    const activeMode = (clientState.rosterViewMode === 'text' || (clientState.rosterViewMode === 'edit' && tab !== 'opponent'))
      ? clientState.rosterViewMode
      : 'play';

    let contentHtml = '';

    if (tab === 'attach') {
      // Attach / Import View
      contentHtml = `
        <div id="gt-saved-lists-container" style="margin-bottom: 22px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
            <div>
              <h3 style="font-size:16px; font-weight:800; color:#f8fafc; margin:0;">📋 Pick from Your NewRecruit Lists</h3>
              <div style="font-size:12px; color:#94a3b8; margin-top:2px;">Select any roster from your NewRecruit Local Storage or NewRecruit Cloud account to attach &amp; share with your opponent.</div>
            </div>
          </div>
          <div id="gt-saved-lists-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(270px, 1fr)); gap:12px;">
            <div style="color:#94a3b8; font-size:12px; font-style:italic;">Loading your NewRecruit lists...</div>
          </div>
        </div>

        <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:18px;">
          <h3 style="font-size:15px; font-weight:800; color:#38bdf8; margin:0 0 6px 0;">🔗 Or Paste NewRecruit Share Link / Roster Text</h3>
          <p style="font-size:12px; color:#94a3b8; margin:0 0 10px 0;">Paste a <b>NewRecruit share URL</b> or exported text list to compile it into an interactive NewRecruit Play Mode roster with full datasheets and stratagems.</p>
          <textarea id="gt-import-raw-input" rows="6" placeholder="Paste NewRecruit link (https://www.newrecruit.eu/app/list/...) or army roster text here... e.g.

Space Marines - Gladius Task Force (2000 pts)
1x Captain in Gravis Armour (80 pts): Warlord
10x Intercessor Squad (160 pts)
5x Terminator Squad (175 pts)" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:8px; padding:10px 12px; color:#e2e8f0; font-family:'JetBrains Mono',monospace; font-size:12px; outline:none; box-sizing:border-box; line-height:1.5; resize:vertical;"></textarea>
          <div style="margin-top:10px; display:flex; justify-content:flex-end;">
            <button onclick="window.gtImportAndAttach()" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; border:none; padding:10px 18px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
              🎮 Attach & Open in Play Mode
            </button>
          </div>
        </div>
      `;

      // Async fetch lists directly from NewRecruit Local Storage (IndexedDB) + NewRecruit Cloud
      setTimeout(async () => {
        const grid = document.getElementById('gt-saved-lists-grid');
        if (!grid) return;
        try {
          const lists = await fetchTrackerNewRecruitLists();
          window.gtSavedListsCache = lists;
          renderSavedListsGridInTracker(lists);
        } catch(e) {
          renderSavedListsGridInTracker([]);
        }
      }, 50);

    } else if (!hasActiveRoster) {
      // Empty state for Opponent or My List
      const isOpp = tab === 'opponent';
      contentHtml = `
        <div style="text-align:center; padding:50px 20px;">
          <div style="font-size:42px; margin-bottom:12px;">${isOpp ? '📜' : '📋'}</div>
          <h3 style="font-size:18px; font-weight:800; color:#f8fafc; margin-bottom:6px;">${isOpp ? "Opponent hasn't attached a list yet" : "You haven't attached an army list to this match"}</h3>
          <p style="font-size:13px; color:#94a3b8; max-width:480px; margin:0 auto 20px;">
            ${isOpp ? "When your opponent attaches their NewRecruit roster, you can inspect their full interactive datasheets and stratagems here in NewRecruit Play Mode." : "Attach a list from your NewRecruit Studio or paste a roster to view interactive datasheets, stratagems, and wound tracking in NewRecruit Play Mode."}
          </p>
          ${!isOpp ? `
            <button onclick="window.gtSetListTab('attach')" style="background:#0284c7; color:#fff; font-weight:800; font-size:13px; border:none; padding:10px 20px; border-radius:8px; cursor:pointer;">
              ➕ Attach / Select My Army List
            </button>
          ` : ''}
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

    // Post activeList.nr_row to embedded NewRecruit Play Mode iframe so opponent & local lists open immediately
    if (hasActiveRoster && activeList) {
      const iframe = document.getElementById('gt-nr-play-mode-iframe');
      if (iframe) {
        const listKey = resolveTrackerNrListKey(activeList);
        const isPlayMode = (clientState.rosterViewMode || 'play') !== 'edit' || tab === 'opponent';
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

  // 10. Tournament Dual Chess Clock Manager (Synchronized Multi-Device Live Clock)
  const chessClock = {
    visible: false,
    running: false,
    activePlayer: 1, // 1 (P1) or 2 (P2)
    p1Remaining: 75 * 60,
    p2Remaining: 75 * 60,
    roundRemaining: 150 * 60,
    lastStartTime: null,
    updatedAt: Date.now()
  };

  let clockUiTicker = null;

  function getEffectiveClockTimes() {
    if (!chessClock.running || !chessClock.lastStartTime) {
      return {
        p1: Math.max(0, chessClock.p1Remaining),
        p2: Math.max(0, chessClock.p2Remaining),
        round: Math.max(0, chessClock.roundRemaining)
      };
    }
    const elapsed = Math.floor((Date.now() - chessClock.lastStartTime) / 1000);
    const p1 = chessClock.activePlayer === 1 ? Math.max(0, chessClock.p1Remaining - elapsed) : chessClock.p1Remaining;
    const p2 = chessClock.activePlayer === 2 ? Math.max(0, chessClock.p2Remaining - elapsed) : chessClock.p2Remaining;
    const round = Math.max(0, chessClock.roundRemaining - elapsed);
    return { p1, p2, round };
  }

  function formatTime(secs) {
    const isNeg = secs < 0;
    const abs = Math.abs(secs);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    return `${isNeg ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function ensureClockTicker() {
    if (chessClock.running && !clockUiTicker) {
      clockUiTicker = setInterval(() => {
        if (chessClock.visible) updateClockDom();
      }, 200);
    } else if (!chessClock.running && clockUiTicker) {
      clearInterval(clockUiTicker);
      clockUiTicker = null;
    }
  }

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
            <button id="gt-clock-play-pause-btn" class="gt-clock-play-pause-btn">▶️ Start</button>
            <select id="gt-clock-duration-select" class="gt-clock-select" onchange="window.gtHandleClockPresetChange(this.value)">
              <option value="90">90m</option>
              <option value="75" selected>75m</option>
              <option value="60">60m</option>
              <option value="45">45m</option>
              <option value="30">30m</option>
              <option value="custom">Custom...</option>
            </select>
            <button id="gt-clock-close-btn" class="gt-clock-close-btn" title="Hide Clock">✕</button>
          </div>
        </div>

        <div class="gt-clock-main-row">
          <div id="gt-clock-p1-box" class="gt-clock-player-box" onclick="window.gtHandlePlayerBoxClick(1, event)" title="Tap to switch turn">
            <div class="gt-clock-player-header">
              <span id="gt-clock-p1-name" class="gt-clock-player-name">Player 1</span>
              <div class="gt-clock-nudge-group">
                <button class="gt-clock-nudge-btn" onclick="event.stopPropagation(); window.gtAdjustPlayerTime(1, -60)" title="Deduct 1 minute">-1m</button>
                <button class="gt-clock-nudge-btn" onclick="event.stopPropagation(); window.gtAdjustPlayerTime(1, 60)" title="Add 1 minute">+1m</button>
              </div>
            </div>
            <div id="gt-clock-p1-time" class="gt-clock-time">75:00</div>
          </div>

          <button id="gt-clock-pass-btn" class="gt-clock-switch-btn" title="Tap to switch active clock turn">
            <span class="gt-clock-pass-icon">🔄</span>
            <span class="gt-clock-pass-text">PASS TURN</span>
          </button>

          <div id="gt-clock-p2-box" class="gt-clock-player-box" onclick="window.gtHandlePlayerBoxClick(2, event)" title="Tap to switch turn">
            <div class="gt-clock-player-header">
              <span id="gt-clock-p2-name" class="gt-clock-player-name">Player 2</span>
              <div class="gt-clock-nudge-group">
                <button class="gt-clock-nudge-btn" onclick="event.stopPropagation(); window.gtAdjustPlayerTime(2, -60)" title="Deduct 1 minute">-1m</button>
                <button class="gt-clock-nudge-btn" onclick="event.stopPropagation(); window.gtAdjustPlayerTime(2, 60)" title="Add 1 minute">+1m</button>
              </div>
            </div>
            <div id="gt-clock-p2-time" class="gt-clock-time">75:00</div>
          </div>
        </div>
      `;
      document.body.appendChild(clockEl);

      // Attach high-performance zero-delay touch & click handlers
      const passBtn = document.getElementById('gt-clock-pass-btn');
      if (passBtn) {
        passBtn.addEventListener('click', (e) => window.gtSwitchClockTurn(e));
        passBtn.addEventListener('pointerdown', () => {
          passBtn.style.transform = 'scale(0.95)';
        });
        window.addEventListener('pointerup', () => {
          if (passBtn) passBtn.style.transform = '';
        });
      }

      const ppBtn = document.getElementById('gt-clock-play-pause-btn');
      if (ppBtn) ppBtn.addEventListener('click', () => window.gtToggleClockPlayPause());

      const clsBtn = document.getElementById('gt-clock-close-btn');
      if (clsBtn) clsBtn.addEventListener('click', () => window.gtToggleChessClock());
    }

    clockEl.style.display = chessClock.visible ? 'flex' : 'none';
    updateClockDom();
  }

  window.gtHandlePlayerBoxClick = function(playerNum, e) {
    if (e && e.target && (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'SELECT')) return;
    if (chessClock.activePlayer === playerNum) {
      window.gtSwitchClockTurn(e);
    }
  };

  function updateClockDom() {
    const clockEl = document.getElementById('gt-chess-clock-hud');
    if (!clockEl || !chessClock.visible) return;

    const raw = originalGetItem('gdm-11e-tracker-state');
    let stateObj = {};
    try { stateObj = JSON.parse(raw) || {}; } catch(e) {}
    const game = stateObj.game || {};

    const p1Name = game.p1Name || 'Player 1';
    const p2Name = game.p2Name || 'Player 2';
    const times = getEffectiveClockTimes();

    const p1Box = document.getElementById('gt-clock-p1-box');
    const p2Box = document.getElementById('gt-clock-p2-box');
    const p1NameEl = document.getElementById('gt-clock-p1-name');
    const p2NameEl = document.getElementById('gt-clock-p2-name');
    const p1TimeEl = document.getElementById('gt-clock-p1-time');
    const p2TimeEl = document.getElementById('gt-clock-p2-time');
    const roundTimeEl = document.getElementById('gt-clock-round-time');
    const ppBtn = document.getElementById('gt-clock-play-pause-btn');
    const sel = document.getElementById('gt-clock-duration-select');

    if (p1NameEl) p1NameEl.textContent = `${p1Name} ${chessClock.activePlayer === 1 ? '▶' : ''}`;
    if (p2NameEl) p2NameEl.textContent = `${p2Name} ${chessClock.activePlayer === 2 ? '▶' : ''}`;
    if (p1TimeEl) p1TimeEl.textContent = formatTime(times.p1);
    if (p2TimeEl) p2TimeEl.textContent = formatTime(times.p2);
    if (roundTimeEl) roundTimeEl.textContent = `(Round: ${formatTime(times.round)})`;
    if (ppBtn) ppBtn.textContent = chessClock.running ? '⏸️ Pause' : '▶️ Start';

    if (sel && chessClock.durationMinutes) {
      if (sel.querySelector(`option[value="${chessClock.durationMinutes}"]`)) {
        sel.value = chessClock.durationMinutes;
      }
    }

    const p1Low = times.p1 <= 300;
    const p2Low = times.p2 <= 300;

    if (p1Box) {
      p1Box.className = `gt-clock-player-box ${chessClock.activePlayer === 1 ? 'active-turn' : ''} ${p1Low ? 'low-time' : ''}`;
    }
    if (p2Box) {
      p2Box.className = `gt-clock-player-box ${chessClock.activePlayer === 2 ? 'active-turn' : ''} ${p2Low ? 'low-time' : ''}`;
    }
  }

  window.gtToggleChessClock = function() {
    chessClock.visible = !chessClock.visible;
    mountChessClockHud();
    broadcastChessClockFast();
  };

  window.gtToggleClockPlayPause = function() {
    if (chessClock.running) {
      const times = getEffectiveClockTimes();
      chessClock.p1Remaining = times.p1;
      chessClock.p2Remaining = times.p2;
      chessClock.roundRemaining = times.round;
      chessClock.running = false;
      chessClock.lastStartTime = null;
    } else {
      chessClock.running = true;
      chessClock.lastStartTime = Date.now();
    }
    chessClock.updatedAt = Date.now();
    ensureClockTicker();
    updateClockDom();
    broadcastChessClockFast();
  };

  window.gtAdjustPlayerTime = function(playerNum, deltaSeconds) {
    const times = getEffectiveClockTimes();
    if (playerNum === 1) {
      chessClock.p1Remaining = Math.max(0, times.p1 + deltaSeconds);
      chessClock.p2Remaining = times.p2;
    } else {
      chessClock.p1Remaining = times.p1;
      chessClock.p2Remaining = Math.max(0, times.p2 + deltaSeconds);
    }
    chessClock.roundRemaining = Math.max(0, times.round + deltaSeconds);
    if (chessClock.running) {
      chessClock.lastStartTime = Date.now();
    }
    chessClock.updatedAt = Date.now();
    ensureClockTicker();
    updateClockDom();
    broadcastChessClockFast();
  };

  window.gtHandleClockPresetChange = function(val) {
    if (val === 'custom') {
      window.gtPromptCustomClockDuration();
      return;
    }
    const mins = parseInt(val, 10);
    if (!isNaN(mins) && mins > 0) {
      window.gtSetClockDuration(mins);
    }
  };

  window.gtSetClockDuration = function(minutes) {
    if (!minutes || isNaN(minutes) || minutes <= 0) return;
    chessClock.durationMinutes = minutes;
    chessClock.running = false;
    chessClock.lastStartTime = null;
    chessClock.p1Remaining = minutes * 60;
    chessClock.p2Remaining = minutes * 60;
    chessClock.roundRemaining = (minutes * 2) * 60;
    chessClock.updatedAt = Date.now();
    ensureClockTicker();
    updateClockDom();
    broadcastChessClockFast();
  };

  window.gtPromptCustomClockDuration = function() {
    const current = chessClock.durationMinutes || 75;
    const res = prompt('Enter custom clock time per player in minutes (e.g. 90, 60, 45):', current);
    if (res !== null) {
      const mins = parseInt(res, 10);
      if (!isNaN(mins) && mins > 0) {
        const sel = document.getElementById('gt-clock-duration-select');
        if (sel) {
          let opt = sel.querySelector(`option[value="${mins}"]`);
          if (!opt) {
            opt = document.createElement('option');
            opt.value = mins;
            opt.textContent = `⏱️ ${mins}m (Custom)`;
            sel.insertBefore(opt, sel.lastElementChild);
          }
          sel.value = mins;
        }
        window.gtSetClockDuration(mins);
      }
    }
  };

  window.gtSwitchClockTurn = function(e) {
    if (e && e.preventDefault) {
      e.preventDefault();
      e.stopPropagation();
    }
    const times = getEffectiveClockTimes();
    chessClock.p1Remaining = times.p1;
    chessClock.p2Remaining = times.p2;
    chessClock.roundRemaining = times.round;
    chessClock.activePlayer = chessClock.activePlayer === 1 ? 2 : 1;
    chessClock.running = true;
    chessClock.lastStartTime = Date.now();
    chessClock.updatedAt = Date.now();

    // Instant optimistic UI update
    ensureClockTicker();
    updateClockDom();

    // Broadcast fast-path
    broadcastChessClockFast();
  };

  window.gtResetChessClock = function(minutes = null) {
    const mins = minutes || chessClock.durationMinutes || 75;
    window.gtSetClockDuration(mins);
  };

  function applyRemoteChessClock(remote) {
    if (!remote || typeof remote !== 'object') return;

    if (remote.updated_at && chessClock.updatedAt && remote.updated_at < chessClock.updatedAt) {
      return;
    }

    chessClock.visible = !!remote.visible;
    chessClock.running = !!remote.running;
    chessClock.activePlayer = remote.active_player === 2 ? 2 : 1;
    chessClock.durationMinutes = remote.duration_minutes || chessClock.durationMinutes || 75;
    chessClock.p1Remaining = typeof remote.p1_remaining === 'number' ? remote.p1_remaining : (chessClock.durationMinutes * 60);
    chessClock.p2Remaining = typeof remote.p2_remaining === 'number' ? remote.p2_remaining : (chessClock.durationMinutes * 60);
    chessClock.roundRemaining = typeof remote.round_remaining === 'number' ? remote.round_remaining : (chessClock.durationMinutes * 2 * 60);
    chessClock.lastStartTime = remote.last_start_time || null;
    chessClock.updatedAt = remote.updated_at || Date.now();

    mountChessClockHud();
    ensureClockTicker();
    updateClockDom();
  }

  function broadcastChessClockFast() {
    if (!clientState.matchId || clientState.role === 'spectator' || clientState.isFinalizing || clientState.isDiscarded) return;
    const times = getEffectiveClockTimes();
    const payload = {
      visible: chessClock.visible,
      running: chessClock.running,
      active_player: chessClock.activePlayer,
      p1_remaining: times.p1,
      p2_remaining: times.p2,
      round_remaining: times.round,
      duration_minutes: chessClock.durationMinutes || 75,
      last_start_time: chessClock.running ? chessClock.lastStartTime : null,
      updated_at: chessClock.updatedAt,
      guest_id: getOrCreateGuestId(),
      role: clientState.role
    };
    if (typeof firebase !== 'undefined' && firebase.firestore) {
      try {
        const db = firebase.firestore();
        db.collection('rooms').doc(clientState.matchId).update({
          chess_clock: payload,
          updatedAt: Date.now()
        }).catch(() => {});
      } catch(e) {}
    }
    fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}/clock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`,
        'X-Guest-Id': getOrCreateGuestId()
      },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }

  function renderChessClock() {
    mountChessClockHud();
  }

  // ==========================================================================
  // 10.5. Interactive Synchronized Dual-Player Live Dice Roller
  // ==========================================================================
  const diceRollerState = {
    visible: localStorage.getItem('gt-dice-visible') === 'true',
    minimized: false,
    activePlayerTab: 1,
    target: 0,
    distExpanded: { 1: false, 2: false },
    historyExpanded: { 1: false, 2: false },
    p1: {
      tray: [], // Array of { id: number, val: number, selected: boolean, rolled: boolean }
      skin: localStorage.getItem('gt-dice-skin-p1') || ''
    },
    p2: {
      tray: [],
      skin: localStorage.getItem('gt-dice-skin-p2') || ''
    },
    history: [], // Array of roll entries across the match
    get tray() {
      return this.p1.tray;
    },
    set tray(val) {
      this.p1.tray = Array.isArray(val) ? val : [];
    }
  };
  window.diceRollerState = diceRollerState;

  window.gtToggleDiceSection = function(section, playerNum = null) {
    const pNum = playerNum ? (Number(playerNum) === 2 ? 2 : 1) : (diceRollerState.activePlayerTab || 1);
    if (section === 'dist') {
      diceRollerState.distExpanded = diceRollerState.distExpanded || { 1: false, 2: false };
      diceRollerState.distExpanded[pNum] = !diceRollerState.distExpanded[pNum];
    } else if (section === 'history') {
      diceRollerState.historyExpanded = diceRollerState.historyExpanded || { 1: false, 2: false };
      diceRollerState.historyExpanded[pNum] = !diceRollerState.historyExpanded[pNum];
    }
    renderDiceRollerContent();
  };

  // Restore saved dice trays from localStorage
  try {
    const savedTrays = localStorage.getItem('gt-dice-trays-v2');
    if (savedTrays) {
      const parsed = JSON.parse(savedTrays);
      if (parsed && parsed.p1 && Array.isArray(parsed.p1.tray)) diceRollerState.p1.tray = parsed.p1.tray;
      if (parsed && parsed.p2 && Array.isArray(parsed.p2.tray)) diceRollerState.p2.tray = parsed.p2.tray;
      if (parsed && parsed.p1 && parsed.p1.skin) diceRollerState.p1.skin = parsed.p1.skin;
      if (parsed && parsed.p2 && parsed.p2.skin) diceRollerState.p2.skin = parsed.p2.skin;
    } else {
      const legacyTray = localStorage.getItem('gt-dice-tray');
      if (legacyTray) {
        const parsedLegacy = JSON.parse(legacyTray);
        if (Array.isArray(parsedLegacy)) diceRollerState.p1.tray = parsedLegacy;
      }
    }
    const savedHist = localStorage.getItem('gt-dice-history-v2');
    if (savedHist) {
      const parsedHist = JSON.parse(savedHist);
      if (Array.isArray(parsedHist)) diceRollerState.history = parsedHist;
    }
  } catch(e) {}

  function getPlayerBucket(playerNum) {
    return Number(playerNum) === 2 ? diceRollerState.p2 : diceRollerState.p1;
  }

  function resolvePlayerDiceSkin(playerNum) {
    const pNum = Number(playerNum) === 2 ? 2 : 1;
    const bucket = getPlayerBucket(pNum);
    const armoryEquipped = (window.Armory && typeof window.Armory.getEquipped === 'function'
      ? (window.Armory.getEquipped('active_dice', '40k') || window.Armory.getEquipped('active_dice', 'aos'))
      : null) || localStorage.getItem('omnitactica_active_dice') || localStorage.getItem('omnitactica_active_dice_40k') || localStorage.getItem('omnitactica_active_dice_aos') || '';

    if (pNum === 1) {
      return bucket.skin || localStorage.getItem('gt-dice-skin-p1') || armoryEquipped || 'dice_warpfire_plasma';
    } else {
      if (clientState && clientState.clientRole === 'player2' && armoryEquipped && !bucket.skin) {
        return armoryEquipped;
      }
      return bucket.skin || localStorage.getItem('gt-dice-skin-p2') || 'dice_molten_magma';
    }
  }

  function getMatchPlayerNames() {
    const raw = originalGetItem('gdm-11e-tracker-state');
    let stateObj = {};
    try { stateObj = JSON.parse(raw) || {}; } catch(e) {}
    const game = stateObj.game || {};
    const p1Name = (game.p1Name || stateObj.p1_name || 'Player 1').trim() || 'Player 1';
    const p2Name = (game.p2Name || stateObj.p2_name || 'Player 2').trim() || 'Player 2';
    return { p1Name, p2Name };
  }

  function saveDiceTray(shouldBroadcast = true) {
    try {
      const traysPayload = {
        p1: { tray: diceRollerState.p1.tray, skin: resolvePlayerDiceSkin(1) },
        p2: { tray: diceRollerState.p2.tray, skin: resolvePlayerDiceSkin(2) }
      };
      localStorage.setItem('gt-dice-trays-v2', JSON.stringify(traysPayload));
      localStorage.setItem('gt-dice-tray', JSON.stringify(diceRollerState.p1.tray));
      localStorage.setItem('gt-dice-count', diceRollerState.p1.tray.length);
      localStorage.setItem('gt-dice-history-v2', JSON.stringify(diceRollerState.history));
    } catch(e) {}

    if (shouldBroadcast) {
      broadcastDiceTray();
    }
  }

  function broadcastDiceTray() {
    if (!clientState.matchId || clientState.isFinalizing || clientState.isDiscarded) return;
    clearTimeout(diceRollerState.syncTimer);
    diceRollerState.syncTimer = setTimeout(() => {
      if (clientState.isFinalizing || clientState.isDiscarded) return;
      const traysPayload = {
        p1: { tray: diceRollerState.p1.tray, skin: resolvePlayerDiceSkin(1) },
        p2: { tray: diceRollerState.p2.tray, skin: resolvePlayerDiceSkin(2) }
      };
      if (typeof firebase !== 'undefined' && firebase.firestore) {
        try {
          const db = firebase.firestore();
          db.collection('rooms').doc(clientState.matchId).update({
            dice_tray: diceRollerState.p1.tray,
            dice_trays: traysPayload,
            dice_target: 0,
            dice_history: diceRollerState.history,
            updatedAt: Date.now()
          }).catch(() => {});
        } catch(e) {}
      }

      fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}/dice_tray`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`,
          'X-Guest-Id': getOrCreateGuestId()
        },
        body: JSON.stringify({
          client_id: clientState.clientId,
          guest_id: getOrCreateGuestId(),
          tray: diceRollerState.p1.tray,
          trays: traysPayload,
          target: 0,
          history: diceRollerState.history
        })
      }).catch(() => {});
    }, 120);
  }

  function applyRemoteDiceTray(remoteTray, remoteTarget, remoteHistory, remoteTrays) {
    if (remoteTrays && typeof remoteTrays === 'object') {
      if (remoteTrays.p1 && Array.isArray(remoteTrays.p1.tray)) diceRollerState.p1.tray = remoteTrays.p1.tray;
      if (remoteTrays.p1 && remoteTrays.p1.skin) diceRollerState.p1.skin = remoteTrays.p1.skin;
      if (remoteTrays.p2 && Array.isArray(remoteTrays.p2.tray)) diceRollerState.p2.tray = remoteTrays.p2.tray;
      if (remoteTrays.p2 && remoteTrays.p2.skin) diceRollerState.p2.skin = remoteTrays.p2.skin;
    } else if (Array.isArray(remoteTray)) {
      diceRollerState.p1.tray = remoteTray;
    }
    if (Array.isArray(remoteHistory)) {
      diceRollerState.history = remoteHistory;
    }
    saveDiceTray(false);
    if (diceRollerState.visible) {
      renderDiceRollerContent();
    }
  }

  window.gtToggleDiceRoller = function() {
    const existingModal = document.getElementById('gt-dice-roller-modal');
    const isActuallyOpen = diceRollerState.visible && existingModal && existingModal.style.display !== 'none';
    if (isActuallyOpen && diceRollerState.minimized) {
      diceRollerState.minimized = false;
    } else if (isActuallyOpen) {
      diceRollerState.visible = false;
    } else {
      diceRollerState.visible = true;
      diceRollerState.minimized = false;
    }
    try { localStorage.setItem('gt-dice-visible', diceRollerState.visible); } catch(e) {}
    mountDiceRollerModal();
  };

  window.gtMinimizeDiceRoller = function(minimize = true) {
    diceRollerState.minimized = Boolean(minimize);
    if (!diceRollerState.visible) {
      diceRollerState.visible = true;
      try { localStorage.setItem('gt-dice-visible', 'true'); } catch(e) {}
    }
    mountDiceRollerModal();
  };

  window.gtSwitchDicePlayerTab = function(playerNum) {
    diceRollerState.activePlayerTab = Number(playerNum) === 2 ? 2 : 1;
    renderDiceRollerContent();
  };

  window.gtSetPlayerDiceSkin = function(playerNum, skinId) {
    const pNum = Number(playerNum) === 2 ? 2 : 1;
    const bucket = getPlayerBucket(pNum);
    bucket.skin = skinId || 'dice_warpfire_plasma';
    try {
      localStorage.setItem(`gt-dice-skin-p${pNum}`, bucket.skin);
      if (pNum === 1) {
        localStorage.setItem('omnitactica_active_dice', bucket.skin);
        localStorage.setItem('omnitactica_active_dice_40k', bucket.skin);
      }
    } catch(e) {}
    saveDiceTray(true);
    renderDiceRollerContent();
  };

  function mountDiceRollerModal() {
    let modal = document.getElementById('gt-dice-roller-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'gt-dice-roller-modal';
      document.body.appendChild(modal);
    }

    if (!window.__gtDiceOutsideBound) {
      window.__gtDiceOutsideBound = true;
      document.addEventListener('pointerdown', (e) => {
        if (!diceRollerState.visible || diceRollerState.minimized) return;
        const m = document.getElementById('gt-dice-roller-modal');
        if (!m || m.style.display === 'none') return;
        if (m.contains(e.target)) return;
        const toggleBtn = e.target && e.target.closest && e.target.closest('[onclick*="gtToggleDiceRoller"], [onclick*="gtMinimizeDiceRoller"], #gt-btn-dice, .gt-dice-toggle-btn');
        if (toggleBtn) return;
        diceRollerState.visible = false;
        try { localStorage.setItem('gt-dice-visible', 'false'); } catch(err) {}
        mountDiceRollerModal();
      });
    }

    if (!diceRollerState.visible) {
      modal.style.display = 'none';
      modal.classList.remove('is-minimized');
      return;
    }

    modal.style.display = 'flex';
    if (diceRollerState.minimized) {
      modal.classList.add('is-minimized');
    } else {
      modal.classList.remove('is-minimized');
    }
    renderDiceRollerContent();
  }

  const FACTION_DICE_METADATA = {
    'dice_40k_dark_angels': { name: 'Dark Angels Caliban Dice', die_bg: 'linear-gradient(135deg, #022c22 0%, #064e3b 100%)', pip_color: '#fef08a', six_face_svg_id: 'avatar_dark_angels', six_face_label: 'Winged Sword' },
    'dice_dark_angels_caliban': { name: 'Dark Angels Caliban Dice', die_bg: 'linear-gradient(135deg, #022c22 0%, #064e3b 100%)', pip_color: '#fef08a', six_face_svg_id: 'avatar_dark_angels', six_face_label: 'Winged Sword' },
    'dice_dark_angels': { name: 'Dark Angels Caliban Dice', die_bg: 'linear-gradient(135deg, #022c22 0%, #064e3b 100%)', pip_color: '#fef08a', six_face_svg_id: 'avatar_dark_angels', six_face_label: 'Winged Sword' },
    'dice_40k_ultramarines': { name: 'Ultramarines Macragge Dice', die_bg: 'linear-gradient(135deg, #1e3a8a 0%, #172554 100%)', pip_color: '#fde047', six_face_svg_id: 'avatar_adeptus_astartes', six_face_label: 'Imperial Aquila' },
    'dice_40k_necrons': { name: 'Necron Dynastic Gauss Dice', die_bg: 'linear-gradient(135deg, #022c22 0%, #052e16 100%)', pip_color: '#4ade80', six_face_svg_id: 'avatar_necrons', six_face_label: 'Triarch Ankh' },
    'dice_40k_chaos': { name: 'Chaos Undivided Warp Dice', die_bg: 'linear-gradient(135deg, #450a0a 0%, #1c1917 100%)', pip_color: '#f87171', six_face_svg_id: 'avatar_chaos_space_marines', six_face_label: 'Chaos Star' },
    'dice_40k_orks': { name: "Ork WAAAGH! Krumpin' Dice", die_bg: 'linear-gradient(135deg, #14532d 0%, #365314 100%)', pip_color: '#facc15', six_face_svg_id: 'avatar_orks', six_face_label: 'Iron Gob' },
    'dice_40k_blood_angels': { name: 'Blood Angels Baal Crimson Dice', die_bg: 'linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)', pip_color: '#fef08a', six_face_svg_id: 'avatar_blood_angels', six_face_label: 'Winged Blood Drop' },
    'dice_40k_black_templars': { name: 'Black Templars Crusade Dice', die_bg: 'linear-gradient(135deg, #0f172a 0%, #020617 100%)', pip_color: '#ffffff', six_face_svg_id: 'avatar_black_templars', six_face_label: 'Maltese Cross' },
    'dice_40k_custodes': { name: 'Adeptus Custodes Auramite Dice', die_bg: 'linear-gradient(135deg, #78350f 0%, #451a03 100%)', pip_color: '#fde047', six_face_svg_id: 'avatar_adeptus_custodes', six_face_label: 'Custodes Raptor' },
    'dice_40k_space_wolves': { name: 'Space Wolves Fenrisian Frost Dice', die_bg: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', pip_color: '#93c5fd', six_face_svg_id: 'avatar_space_wolves', six_face_label: 'Iron Wolf' },
    'dice_40k_tyranids': { name: 'Tyranid Hive Mind Synapse Dice', die_bg: 'linear-gradient(135deg, #3b0764 0%, #1e1b4b 100%)', pip_color: '#e9d5ff', six_face_svg_id: 'avatar_tyranids', six_face_label: 'Synapse Carapace' },
    'dice_40k_tau': { name: "T'au Empire Sept Enclave Dice", die_bg: 'linear-gradient(135deg, #7c2d12 0%, #431407 100%)', pip_color: '#fed7aa', six_face_svg_id: 'avatar_tau_empire', six_face_label: 'Fire Caste Mark' },
    'dice_40k_aeldari': { name: 'Aeldari Spirit-Stone Amber Dice', die_bg: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)', pip_color: '#fde047', six_face_svg_id: 'avatar_aeldari', six_face_label: 'Rune of Ulthwé' },
    'dice_40k_mechanicus': { name: 'Adeptus Mechanicus Mars Cog Dice', die_bg: 'linear-gradient(135deg, #881337 0%, #4c0519 100%)', pip_color: '#ffffff', six_face_svg_id: 'avatar_adeptus_mechanicus', six_face_label: 'Opus Machina' },
    'dice_40k_death_guard': { name: 'Death Guard Plague Rot Dice', die_bg: 'linear-gradient(135deg, #365314 0%, #1a2e05 100%)', pip_color: '#d9f99d', six_face_svg_id: 'avatar_death_guard', six_face_label: 'Corroded Helm' },
    'dice_40k_world_eaters': { name: 'World Eaters Skull-Brass Dice', die_bg: 'linear-gradient(135deg, #450a0a 0%, #1c1917 100%)', pip_color: '#fbbf24', six_face_svg_id: 'avatar_world_eaters', six_face_label: 'Khorne Skull Maw' },
    'dice_40k_grey_knights': { name: 'Grey Knights Sanctified Silver Dice', die_bg: 'linear-gradient(135deg, #334155 0%, #1e293b 100%)', pip_color: '#38bdf8', six_face_svg_id: 'avatar_grey_knights', six_face_label: 'Nemesis Sword & Tome' },
    'dice_40k_sororitas': { name: 'Adepta Sororitas Fleur-de-Lis Dice', die_bg: 'linear-gradient(135deg, #0f172a 0%, #020617 100%)', pip_color: '#ef4444', six_face_svg_id: 'avatar_adepta_sororitas', six_face_label: 'Sacred Fleur-de-lis' },
    'dice_40k_astramilitarum': { name: 'Astra Militarum Cadia Green Dice', die_bg: 'linear-gradient(135deg, #14532d 0%, #052e16 100%)', pip_color: '#ffffff', six_face_svg_id: 'avatar_astra_militarum', six_face_label: 'Cadian Gate' },
    'dice_40k_votann': { name: 'Leagues of Votann Magma Core Dice', die_bg: 'linear-gradient(135deg, #451a03 0%, #1c1917 100%)', pip_color: '#fb923c', six_face_svg_id: 'avatar_leagues_of_votann', six_face_label: 'Ancestor Core' },
    'dice_40k_drukhari': { name: 'Drukhari Soul-Flayer Dice', die_bg: 'linear-gradient(135deg, #134e4a 0%, #042f2e 100%)', pip_color: '#2dd4bf', six_face_svg_id: 'avatar_drukhari', six_face_label: 'Soul-Talon Blade' },
    'dice_40k_genestealercults': { name: 'Genestealer Cults Wyrm Hazard Dice', die_bg: 'linear-gradient(135deg, #3b0764 0%, #1e1b4b 100%)', pip_color: '#facc15', six_face_svg_id: 'avatar_genestealer_cults', six_face_label: 'Wyrm Claw' },
    'dice_40k_thousandsons': { name: 'Thousand Sons Rubric Sorcery Dice', die_bg: 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)', pip_color: '#fde047', six_face_svg_id: 'avatar_thousand_sons', six_face_label: 'Eye of Magnus' },
    'dice_aos_stormcast': { name: 'Stormcast Eternals Azyrite Dice', die_bg: 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)', pip_color: '#fbbf24', six_face_svg_id: 'avatar_stormcast_eternals', six_face_label: 'Twin-Tailed Comet' },
    'dice_aos_khorne': { name: 'Blades of Khorne Blood-Brass Dice', die_bg: 'linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)', pip_color: '#fde047', six_face_svg_id: 'avatar_khorne_bloodbound', six_face_label: 'Khorne Skull Rune' },
    'dice_aos_gloomspite': { name: 'Gloomspite Gitz Bad Moon Dice', die_bg: 'linear-gradient(135deg, #14532d 0%, #1e1b4b 100%)', pip_color: '#facc15', six_face_svg_id: 'avatar_gloomspite_gitz', six_face_label: 'Grinning Bad Moon' },
    'dice_aos_soulblight': { name: 'Soulblight Gravelords Blood Dice', die_bg: 'linear-gradient(135deg, #450a0a 0%, #18181b 100%)', pip_color: '#f87171', six_face_svg_id: 'avatar_soulblight_gravelords', six_face_label: 'Crimson Bat Crest' },
    'dice_aos_sylvaneth': { name: 'Sylvaneth Wyldwood Bark Dice', die_bg: 'linear-gradient(135deg, #14532d 0%, #052e16 100%)', pip_color: '#86efac', six_face_svg_id: 'avatar_sylvaneth', six_face_label: 'Spirit-Pod Heart' },
    'dice_aos_skaven': { name: 'Skaven Warpstone Toxic Dice', die_bg: 'linear-gradient(135deg, #14532d 0%, #022c22 100%)', pip_color: '#22c55e', six_face_svg_id: 'avatar_skaven', six_face_label: 'Horned Rat Rune' },
    'dice_aos_bonereapers': { name: 'Ossiarch Nadirite Legion Dice', die_bg: 'linear-gradient(135deg, #44403c 0%, #1c1917 100%)', pip_color: '#38bdf8', six_face_svg_id: 'avatar_ossiarch_bonereapers', six_face_label: 'Nadirite Seal' },
    'dice_aos_seraphon': { name: 'Seraphon Solar Star-Glyph Dice', die_bg: 'linear-gradient(135deg, #0e7490 0%, #155e75 100%)', pip_color: '#fde047', six_face_svg_id: 'avatar_seraphon', six_face_label: 'Solar Sun-Glyph' },
    'dice_aos_maggotkin': { name: 'Maggotkin of Nurgle Slime Dice', die_bg: 'linear-gradient(135deg, #3f6212 0%, #1a2e05 100%)', pip_color: '#bef264', six_face_svg_id: 'avatar_maggotkin_of_nurgle', six_face_label: 'Tri-Globe Crest' },
    'dice_aos_ironjawz': { name: 'Ironjawz Megaboss Yellow Dice', die_bg: 'linear-gradient(135deg, #ca8a04 0%, #713f12 100%)', pip_color: '#fef08a', six_face_svg_id: 'avatar_orruk_warclans', six_face_label: 'Iron Jaw Tusk' },
    'dice_aos_slavestodarkness': { name: 'Slaves to Darkness Iron Star Dice', die_bg: 'linear-gradient(135deg, #18181b 0%, #09090b 100%)', pip_color: '#ef4444', six_face_svg_id: 'avatar_slaves_to_darkness', six_face_label: 'Chaos Ascendant Star' },
    'dice_aos_nighthaunt': { name: 'Nighthaunt Spectral Mist Dice', die_bg: 'linear-gradient(135deg, #0f766e 0%, #042f2e 100%)', pip_color: '#99f6e4', six_face_svg_id: 'avatar_nighthaunt', six_face_label: 'Spectral Veiled Skull' },
    'dice_aos_daughtersofkhaine': { name: 'Daughters of Khaine Dagger Dice', die_bg: 'linear-gradient(135deg, #831843 0%, #500724 100%)', pip_color: '#fbcfe8', six_face_svg_id: 'avatar_daughters_of_khaine', six_face_label: 'Khaine Sacrifice Dagger' },
    'dice_aos_citiesofsigmar': { name: 'Cities of Sigmar Freeguild Dice', die_bg: 'linear-gradient(135deg, #1e3a8a 0%, #1e1b4b 100%)', pip_color: '#fbbf24', six_face_svg_id: 'avatar_cities_of_sigmar', six_face_label: 'Freeguild Lion' },
    'dice_aos_kharadron': { name: 'Kharadron Aether-Gold Dice', die_bg: 'linear-gradient(135deg, #854d0e 0%, #451a03 100%)', pip_color: '#fef08a', six_face_svg_id: 'avatar_kharadron_overlords', six_face_label: 'Aether Compass' },
    'dice_aos_fyreslayers': { name: 'Fyreslayers Ur-Gold Forge Dice', die_bg: 'linear-gradient(135deg, #9a3412 0%, #431407 100%)', pip_color: '#fdba74', six_face_svg_id: 'avatar_fyreslayers', six_face_label: 'Grimnir Greataxe' },
    'dice_aos_idoneth': { name: 'Idoneth Deepkin Abyssal Pearl Dice', die_bg: 'linear-gradient(135deg, #0369a1 0%, #082f49 100%)', pip_color: '#e0f2fe', six_face_svg_id: 'avatar_idoneth_deepkin', six_face_label: 'Isharann Wave' },
    'dice_aos_lumineth': { name: 'Lumineth Sunmetal Prism Dice', die_bg: 'linear-gradient(135deg, #f8fafc 0%, #cbd5e1 100%)', pip_color: '#0284c7', six_face_svg_id: 'avatar_lumineth_realm_lords', six_face_label: 'Twin Sun Crescent' },
    'dice_aos_flesheater': { name: 'Flesh-eater Courts Bone Chalice Dice', die_bg: 'linear-gradient(135deg, #450a0a 0%, #262626 100%)', pip_color: '#fecdd3', six_face_svg_id: 'avatar_flesh_eater_courts', six_face_label: 'Bone Chalice' }
  };

  const ARMORY_DICE_SKIN_OPTIONS = [
    { id: 'dice_warpfire_plasma', label: '🟢 Warpfire Plasma Dice' },
    { id: 'dice_molten_magma', label: '🟠 Molten Magma Dice' },
    { id: 'dice_ceramite_white', label: '⚪ Imperial Ceramite Dice' },
    { id: 'dice_40k_dark_angels', label: '⚔️ Dark Angels Caliban Dice' },
    { id: 'dice_40k_ultramarines', label: '🦅 Ultramarines Macragge Dice' },
    { id: 'dice_40k_necrons', label: '🟢 Necron Dynastic Gauss Dice' },
    { id: 'dice_40k_aeldari', label: '✨ Aeldari Spirit-Stone Dice' },
    { id: 'dice_40k_world_eaters', label: '💀 World Eaters Skull-Brass Dice' },
    { id: 'dice_40k_blood_angels', label: '🩸 Blood Angels Baal Crimson Dice' },
    { id: 'dice_40k_black_templars', label: '✝️ Black Templars Crusade Dice' },
    { id: 'dice_40k_custodes', label: '👑 Adeptus Custodes Auramite Dice' },
    { id: 'dice_40k_space_wolves', label: '🐺 Space Wolves Fenrisian Dice' },
    { id: 'dice_40k_orks', label: "💚 Ork WAAAGH! Krumpin' Dice" },
    { id: 'dice_40k_chaos', label: '🔥 Chaos Undivided Warp Dice' },
    { id: 'dice_40k_tyranids', label: '🟣 Tyranid Hive Mind Synapse Dice' },
    { id: 'dice_40k_tau', label: "🟠 T'au Empire Sept Enclave Dice" },
    { id: 'dice_40k_death_guard', label: '☣️ Death Guard Plague Rot Dice' },
    { id: 'dice_40k_thousandsons', label: '🧿 Thousand Sons Rubric Dice' },
    { id: 'dice_40k_grey_knights', label: '🛡️ Grey Knights Silver Dice' },
    { id: 'dice_40k_sororitas', label: '⚜️ Adepta Sororitas Dice' },
    { id: 'dice_40k_astramilitarum', label: '🎖️ Astra Militarum Cadia Dice' },
    { id: 'dice_40k_mechanicus', label: '⚙️ Adeptus Mechanicus Mars Dice' },
    { id: 'dice_40k_votann', label: '⛏️ Leagues of Votann Magma Dice' },
    { id: 'dice_40k_drukhari', label: '🗡️ Drukhari Soul-Flayer Dice' },
    { id: 'dice_40k_genestealercults', label: '🧬 Genestealer Cults Dice' },
    { id: 'dice_aos_stormcast', label: '⚡ Stormcast Eternals Azyrite Dice' },
    { id: 'dice_aos_khorne', label: '🩸 Blades of Khorne Brass Dice' },
    { id: 'dice_aos_skaven', label: '🐀 Skaven Warpstone Toxic Dice' },
    { id: 'dice_aos_soulblight', label: '🦇 Soulblight Gravelords Dice' },
    { id: 'dice_aos_sylvaneth', label: '🌿 Sylvaneth Wyldwood Dice' },
    { id: 'dice_aos_seraphon', label: '☀️ Seraphon Solar Star-Glyph Dice' },
    { id: 'dice_aos_gloomspite', label: '🌙 Gloomspite Gitz Bad Moon Dice' },
    { id: 'dice_aos_nighthaunt', label: '👻 Nighthaunt Spectral Mist Dice' },
    { id: 'dice_aos_slaves_to_darkness', label: '⚔️ Slaves to Darkness Iron Dice' }
  ];

  function getFallbackDiceMetadata(skinId) {
    if (!skinId) return null;
    const entry = FACTION_DICE_METADATA[skinId];
    if (entry) {
      return {
        id: skinId,
        name: entry.name,
        payload: entry
      };
    }
    return null;
  }

  function computePlayerDiceDistribution(playerNum) {
    const pNum = Number(playerNum) === 2 ? 2 : 1;
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    let totalRolled = 0;
    let totalSum = 0;
    let rollEvents = 0;

    (diceRollerState.history || []).forEach(h => {
      const hPlayer = Number(h.player_num || 1);
      if (hPlayer !== pNum) return;
      const res = Array.isArray(h.results) ? h.results : [];
      if (res.length > 0) {
        rollEvents++;
        res.forEach(val => {
          const v = parseInt(val, 10);
          if (v >= 1 && v <= 6) {
            counts[v] = (counts[v] || 0) + 1;
            totalRolled++;
            totalSum += v;
          }
        });
      }
    });

    const avg = totalRolled > 0 ? (totalSum / totalRolled) : 0;
    const maxFaceCount = Math.max(1, counts[1], counts[2], counts[3], counts[4], counts[5], counts[6]);
    return {
      counts,
      totalRolled,
      totalSum,
      rollEvents,
      avg,
      maxFaceCount
    };
  }
  window.computePlayerDiceDistribution = computePlayerDiceDistribution;

  function renderPlayerDicePanel(playerNum, pName) {
    const pNum = Number(playerNum) === 2 ? 2 : 1;
    const bucket = getPlayerBucket(pNum);
    const tray = bucket.tray || [];
    const totalInTray = tray.length;
    const selectedCount = tray.filter(d => d.selected).length;
    const rolledDice = tray.filter(d => d.rolled);
    const hasRolled = rolledDice.length > 0;
    const sum = rolledDice.reduce((a, b) => a + (b.val || 0), 0);
    const selectedSum = tray.filter(d => d.rolled && d.selected).reduce((a, b) => a + (b.val || 0), 0);

    const activeSkinId = resolvePlayerDiceSkin(pNum);
    let skinClass = 'skin-warpfire-plasma';
    let customStyle = '';
    let isCustom = false;
    let eqItem = null;

    if (activeSkinId === 'dice_molten_magma') {
      skinClass = 'skin-molten-magma';
    } else if (activeSkinId === 'dice_ceramite_white') {
      skinClass = 'skin-ceramite-white';
    } else if (activeSkinId === 'dice_warpfire_plasma') {
      skinClass = 'skin-warpfire-plasma';
    } else if (activeSkinId) {
      eqItem = (window.Armory && typeof window.Armory.getEquippedItem === 'function'
        ? (window.Armory.getEquippedItem('active_dice', '40k') || window.Armory.getEquippedItem(activeSkinId, '40k'))
        : null) || getFallbackDiceMetadata(activeSkinId);
      if (eqItem && eqItem.payload) {
        skinClass = 'skin-faction-custom';
        isCustom = true;
        const bg = eqItem.payload.die_bg || '#1e293b';
        const pip = eqItem.payload.pip_color || '#ffffff';
        customStyle = ` style="--custom-die-bg:${bg}; --custom-pip-color:${pip};"`;
      }
    }

    // Count faces in current tray
    const trayFaceCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    rolledDice.forEach(d => {
      if (d.val >= 1 && d.val <= 6) trayFaceCounts[d.val]++;
    });

    // Check which face buttons are fully selected
    const isFaceFullySelected = (f) => {
      const matching = rolledDice.filter(d => d.val === f);
      return matching.length > 0 && matching.every(d => d.selected);
    };

    const dist = computePlayerDiceDistribution(pNum);
    const playerHistory = (diceRollerState.history || []).filter(h => Number(h.player_num || 1) === pNum);
    const accentColor = pNum === 2 ? '#f43f5e' : '#38bdf8';
    const isMobileHidden = diceRollerState.activePlayerTab !== pNum ? 'mobile-hidden' : '';
    const isDistOpen = Boolean(diceRollerState.distExpanded && diceRollerState.distExpanded[pNum]);
    const isHistOpen = Boolean(diceRollerState.historyExpanded && diceRollerState.historyExpanded[pNum]);

    return `
      <div class="gt-player-dice-card player-${pNum} ${isMobileHidden}" id="gt-dice-panel-p${pNum}" data-player="${pNum}">
        <!-- 1. Add Dice & Clear Bar -->
        <div style="display:flex; flex-direction:column; gap:5px; flex-shrink:0;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#cbd5e1; font-weight:700;">
            <span style="display:inline-flex; align-items:center; flex-wrap:wrap; gap:4px;">
              <span class="gt-desktop-player-pill" style="display:inline-flex; align-items:center; gap:5px; margin-right:2px;">
                <span style="width:8px; height:8px; border-radius:50%; background:${accentColor}; box-shadow:0 0 6px ${accentColor}; flex-shrink:0;"></span>
                <span style="color:#fff; font-weight:900;">${escapeHtml(pName)}</span>
                <span style="color:#475569;">&bull;</span>
              </span>
              <span>DICE IN TRAY: <b id="${pNum === 1 ? 'gt-dice-count-display' : 'gt-dice-count-display-p2'}" style="color:#f59e0b; font-size:13px; font-family:'JetBrains Mono',monospace;">${totalInTray}</b> <span style="color:#38bdf8; font-size:10.5px;">(${selectedCount} selected)</span></span>
            </span>
            <span style="font-size:10px; color:#64748b;">Max 100</span>
          </div>
          <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
            <input type="number" id="${pNum === 1 ? 'gt-dice-input' : 'gt-dice-input-p2'}" value="${totalInTray}" min="0" max="100" class="form-input" style="width:54px; height:30px; padding:2px 6px; font-size:12px; font-weight:800; font-family:'JetBrains Mono',monospace; text-align:center; background:#070b14; border:1px solid #334155; color:#fff; border-radius:7px;" onchange="window.gtSetDiceCount(parseInt(this.value, 10), ${pNum})">
            <button type="button" class="gt-dice-quick-btn" onclick="window.gtAddDice(1, ${pNum})">+1</button>
            <button type="button" class="gt-dice-quick-btn" onclick="window.gtAddDice(5, ${pNum})">+5</button>
            <button type="button" class="gt-dice-quick-btn" onclick="window.gtAddDice(10, ${pNum})">+10</button>
            <button type="button" class="gt-dice-quick-btn" onclick="window.gtAddDice(20, ${pNum})">+20</button>
            <button type="button" class="gt-dice-quick-btn" style="color:#f87171; border-color:rgba(239,68,68,0.35); margin-left:auto;" onclick="window.gtClearTray(${pNum})">Clear</button>
          </div>
        </div>

        <!-- 2. Select Dice in Tray Bar (Toggle All, 6, 5, 4, 3, 2, 1) -->
        <div style="display:flex; flex-direction:column; gap:5px; flex-shrink:0;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:10.5px; color:#94a3b8; font-weight:800; text-transform:uppercase; letter-spacing:0.04em;">
            <span>Select Dice in Tray:</span>
            <span style="font-size:10px; color:#64748b; font-weight:600; text-transform:none;">Tap numbers or individual dice</span>
          </div>
          <div class="gt-dice-select-bar">
            <button type="button" class="gt-dice-sel-btn ${totalInTray > 0 && selectedCount === totalInTray ? 'active' : ''}" onclick="window.gtToggleSelectAll(${pNum})" title="Toggle select/unselect all dice in tray">All</button>
            ${[6, 5, 4, 3, 2, 1].map(face => {
              const c = trayFaceCounts[face] || 0;
              const isSel = isFaceFullySelected(face);
              return `
                <button type="button" class="gt-dice-sel-btn ${isSel ? 'active' : ''}" onclick="window.gtToggleSelectFace(${face}, ${pNum})" title="Toggle ${face}s in tray">
                  <span>${face}</span>
                  ${hasRolled ? `<span style="font-size:9.5px; opacity:0.75; color:${c > 0 ? '#fbbf24' : '#475569'};">(${c})</span>` : ''}
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <!-- 3. Clickable Dice Tray (Expanded to take up main screen real estate) -->
        <div class="gt-dice-tray">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:5px; font-size:10.5px; flex-wrap:wrap; gap:4px; flex-shrink:0;">
            <span style="font-weight:800; color:#cbd5e1;">TRAY (${totalInTray} DICE)</span>
            ${hasRolled ? `
              <div style="display:flex; gap:8px; align-items:center; font-family:'JetBrains Mono',monospace; font-size:10.5px; font-weight:800;">
                <span style="color:#f59e0b;">⚅ 6s: ${trayFaceCounts[6]}</span>
                <span style="color:#ef4444;">⚀ 1s: ${trayFaceCounts[1]}</span>
                <span style="color:#94a3b8;">Sum: ${sum}</span>
                ${selectedCount > 0 ? `<span style="color:#38bdf8;">Sel Sum: ${selectedSum}</span>` : ''}
              </div>
            ` : `<span style="color:#64748b; font-size:10px;">Ready to roll</span>`}
          </div>

          <div class="gt-dice-grid ${skinClass}" id="${pNum === 1 ? 'gt-dice-grid-p1' : 'gt-dice-grid-p2'}" data-dice-skin="${activeSkinId}" data-custom-dice="${isCustom}"${customStyle}>
            ${totalInTray === 0 ? `
              <div style="width:100%; text-align:center; color:#64748b; font-size:11.5px; padding:24px 0;">
                Tray is empty. Tap <b style="color:#f59e0b;">+1</b>, <b style="color:#f59e0b;">+5</b>, <b style="color:#f59e0b;">+10</b>, or <b style="color:#f59e0b;">+20</b> above to add dice.
              </div>
            ` : tray.map((die, idx) => {
              let cls = 'gt-die-unrolled';
              if (die.rolled) {
                if (die.val === 6) cls = 'gt-die-crit';
                else if (die.val === 1) cls = 'gt-die-fail';
                else cls = 'gt-die-neutral';
              }
              let selStateCls = 'ready';
              if (selectedCount > 0) {
                selStateCls = die.selected ? 'selected' : 'unselected';
              }
              let displayVal = die.rolled ? die.val : '•';
              if (die.rolled && die.val === 6) {
                const svgId = eqItem && eqItem.payload ? eqItem.payload.six_face_svg_id : null;
                if (svgId && typeof window.getArmoryAvatarSvg === 'function') {
                  const svg = window.getArmoryAvatarSvg(svgId);
                  if (svg) {
                    displayVal = `<span class="gt-die-faction-six-sigil" title="Faction Critical 6: ${escapeHtml((eqItem.payload && eqItem.payload.six_face_label) || 'Faction Sigil')}">${svg}</span>`;
                  }
                }
              }
              return `
                <span class="gt-die-pip ${cls} ${selStateCls}" onclick="window.gtToggleDieSelection(${idx}, ${pNum})" title="Click to ${die.selected ? 'unselect' : 'select'} (Die #${idx + 1}: ${die.rolled ? die.val : 'Unrolled'})">
                  ${displayVal}
                </span>
              `;
            }).join('')}
          </div>
        </div>

        <!-- 4. Roll Action Buttons -->
        <div style="display:flex; gap:8px; flex-wrap:wrap; flex-shrink:0;">
          ${(selectedCount > 0 && selectedCount < totalInTray && hasRolled) ? `
            <button type="button" id="${pNum === 1 ? 'btn-main-roll-dice' : 'btn-main-roll-dice-p2'}" onclick="window.gtExecuteDiceRoll(${pNum}, 'selected_only')" style="flex:1.25; min-width:160px; background:linear-gradient(135deg, #f59e0b, #d97706); color:#090d16; border:none; padding:10px 12px; border-radius:9px; font-size:13px; font-weight:900; cursor:pointer; box-shadow:0 4px 14px rgba(245,158,11,0.35); display:flex; justify-content:center; align-items:center; gap:6px;">
              🎲 Roll ${selectedCount} Selected
            </button>
            <button type="button" id="btn-reroll-in-place-p${pNum}" onclick="window.gtExecuteDiceRoll(${pNum}, 'reroll_in_place')" style="flex:1; min-width:140px; background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.45); padding:10px 12px; border-radius:9px; font-size:12px; font-weight:800; cursor:pointer; display:flex; justify-content:center; align-items:center; gap:5px;" title="Reroll the ${selectedCount} selected dice while keeping the other ${totalInTray - selectedCount} dice in the tray">
              🔄 Reroll ${selectedCount} in Tray
            </button>
          ` : `
            <button type="button" id="${pNum === 1 ? 'btn-main-roll-dice' : 'btn-main-roll-dice-p2'}" onclick="window.gtExecuteDiceRoll(${pNum}, 'all')" style="width:100%; background:linear-gradient(135deg, #f59e0b, #d97706); color:#090d16; border:none; padding:10px 14px; border-radius:9px; font-size:13.5px; font-weight:900; cursor:pointer; box-shadow:0 4px 14px rgba(245,158,11,0.35); display:flex; justify-content:center; align-items:center; gap:6px; ${totalInTray === 0 ? 'opacity:0.6;' : ''}">
              🎲 ${totalInTray > 0 ? `Roll ${selectedCount > 0 ? selectedCount : totalInTray} Dice` : 'Add Dice Above to Roll'}
            </button>
          `}
        </div>

        <!-- 5. Cumulative Dice Distribution (Minimized by Default, Click to Expand) -->
        <div class="gt-dice-dist-box ${isDistOpen ? 'is-open' : 'is-collapsed'}" id="gt-dice-dist-p${pNum}" style="flex-shrink:0;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap; cursor:pointer; user-select:none;" onclick="window.gtToggleDiceSection('dist', ${pNum})" title="Tap to ${isDistOpen ? 'minimize' : 'expand'} Dice Distribution">
            <span style="font-size:10.5px; font-weight:800; color:#cbd5e1; text-transform:uppercase; letter-spacing:0.04em; display:inline-flex; align-items:center; gap:5px;">
              <span>📊 Dice Distribution</span> <span style="color:#38bdf8;">(${dist.totalRolled} Rolled)</span>
            </span>
            <div style="display:flex; align-items:center; gap:8px; font-size:10.5px; font-family:'JetBrains Mono',monospace;">
              <span style="color:${dist.totalRolled > 0 ? (dist.avg >= 3.5 ? '#10b981' : '#f59e0b') : '#64748b'}; font-weight:800;">
                Avg: ${dist.totalRolled > 0 ? dist.avg.toFixed(2) : '—'} <span style="color:#64748b; font-weight:600;">(Exp 3.50)</span>
              </span>
              <span style="color:#94a3b8; font-size:10px;">${isDistOpen ? '▾' : '▸'}</span>
            </div>
          </div>
          <div class="gt-dice-dist-bars" style="display:${isDistOpen ? 'grid' : 'none'};">
            ${[1, 2, 3, 4, 5, 6].map(face => {
              const count = dist.counts[face] || 0;
              const pct = dist.totalRolled > 0 ? Math.round((count / dist.totalRolled) * 100) : 0;
              const heightPct = dist.totalRolled > 0 ? Math.max(count > 0 ? 12 : 0, Math.round((count / dist.maxFaceCount) * 100)) : 0;
              const barColor = face === 6 ? '#f59e0b' : (face >= 4 ? '#10b981' : (face >= 2 ? '#38bdf8' : '#ef4444'));
              const pips = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
              return `
                <div class="gt-dice-dist-col">
                  <div style="font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:800; color:#e2e8f0;">
                    ${count} <span style="font-size:8.5px; color:#64748b;">(${pct}%)</span>
                  </div>
                  <div class="gt-dice-dist-track">
                    <div class="gt-dice-dist-fill" style="height:${heightPct}%; background:${barColor};"></div>
                  </div>
                  <div style="font-family:'JetBrains Mono',monospace; font-size:10.5px; font-weight:800; color:${barColor};">
                    ${pips[face]} ${face}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- 6. Player Roll History (Minimized by Default, Click to Expand) -->
        <div class="gt-dice-history-box ${isHistOpen ? 'is-open' : 'is-collapsed'}" style="background:rgba(9,13,22,0.75); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:7px 10px; display:flex; flex-direction:column; gap:5px; flex-shrink:0;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#94a3b8; font-weight:800; cursor:pointer; user-select:none;" onclick="window.gtToggleDiceSection('history', ${pNum})" title="Tap to ${isHistOpen ? 'minimize' : 'expand'} Roll History">
            <span>📜 ${escapeHtml(pName.toUpperCase())} ROLL HISTORY (${playerHistory.length})</span>
            <div style="display:flex; align-items:center; gap:8px;">
              ${isHistOpen && playerHistory.length > 0 ? `<button type="button" onclick="event.stopPropagation(); window.gtClearDiceHistory(${pNum})" style="background:transparent; border:none; color:#f87171; font-size:9.5px; font-weight:700; cursor:pointer;">Clear History</button>` : ''}
              <span style="color:#94a3b8; font-size:10px;">${isHistOpen ? '▾' : '▸'}</span>
            </div>
          </div>
          <div id="gt-dice-history-list-p${pNum}" style="display:${isHistOpen ? 'flex' : 'none'}; flex-direction:column; gap:4px; max-height:95px; overflow-y:auto;">
            ${playerHistory.length === 0 ? `
              <div style="font-size:10px; color:#475569; text-align:center; padding:6px 0;">No rolls recorded yet.</div>
            ` : playerHistory.slice(-12).reverse().map((h, i) => {
              const res = Array.isArray(h.results) ? h.results : [];
              const fc = { 6:0, 5:0, 4:0, 3:0, 2:0, 1:0 };
              res.forEach(v => { if (fc[v] !== undefined) fc[v]++; });
              const breakdown = [6,5,4,3,2,1].filter(f => fc[f] > 0).map(f => `<span style="color:${f===6?'#fbbf24':(f===1?'#f87171':'#cbd5e1')};">${f}×${fc[f]}</span>`).join(' ');
              const rollAvg = res.length > 0 ? (res.reduce((a,b)=>a+b,0) / res.length).toFixed(1) : '0.0';
              const isReroll = h.mode === 'reroll';
              return `
                <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:4px 7px; font-size:10px; display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
                  <div style="display:flex; align-items:center; gap:5px;">
                    <span style="font-weight:800; color:${isReroll ? '#38bdf8' : '#f59e0b'};">${isReroll ? '🔄 Reroll' : '🎲 Roll'} ${h.dice_count}D6:</span>
                    <span style="font-family:'JetBrains Mono',monospace; font-size:9.5px;">${breakdown}</span>
                  </div>
                  <span style="font-weight:700; font-family:'JetBrains Mono',monospace; color:#94a3b8; font-size:9.5px;">
                    Avg ${rollAvg} &bull; Sum ${h.sum}
                  </span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderDiceRollerContent() {
    const modal = document.getElementById('gt-dice-roller-modal');
    if (!modal || !diceRollerState.visible) return;

    const { p1Name, p2Name } = getMatchPlayerNames();
    const p1Count = (diceRollerState.p1.tray || []).length;
    const p2Count = (diceRollerState.p2.tray || []).length;
    const dist1 = computePlayerDiceDistribution(1);
    const dist2 = computePlayerDiceDistribution(2);

    if (diceRollerState.minimized) {
      modal.classList.add('is-minimized');
      modal.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 12px; background:rgba(15,23,42,0.98); width:100%; box-sizing:border-box;">
          <div style="display:flex; align-items:center; gap:7px; flex:1; min-width:0; cursor:pointer;" onclick="window.gtMinimizeDiceRoller(false)" title="Tap to expand Dice Roller">
            <span style="font-size:15px; flex-shrink:0;">🎲</span>
            <div style="font-size:11.5px; font-weight:800; color:#f8fafc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              <span style="color:#38bdf8;">${escapeHtml(p1Name)}: ${p1Count}d (${dist1.totalRolled})</span>
              <span style="color:#475569; margin:0 4px;">|</span>
              <span style="color:#fb7185;">${escapeHtml(p2Name)}: ${p2Count}d (${dist2.totalRolled})</span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:5px; flex-shrink:0;">
            <button type="button" class="gt-dice-header-btn" style="background:#f59e0b; color:#090d16; border-color:#f59e0b; padding:4px 9px; flex-shrink:0;" onclick="window.gtMinimizeDiceRoller(false)">
              ⤢ Expand
            </button>
            <button type="button" class="gt-dice-header-btn close-btn" style="padding:4px 8px; flex-shrink:0;" onclick="window.gtToggleDiceRoller()" title="Close Dice Roller">
              ✕
            </button>
          </div>
        </div>
      `;
      return;
    }

    const isAdminForDiceLab = Boolean(
      currentUser &&
      (currentUser.is_admin || ['admin', 'superuser', 'developer', 'owner'].includes(String(currentUser.role || '').trim().toLowerCase()))
    );

    modal.classList.remove('is-minimized');
    modal.innerHTML = `
      <div class="gt-dice-header">
        <div style="display:flex; align-items:center; gap:8px; font-weight:800; font-family:'JetBrains Mono',monospace; font-size:12px; color:#f59e0b; flex-wrap:wrap;">
          <span>🎲</span>
          <span>DUAL TABLETOP DICE ROLLER</span>
          <span style="background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.3); font-size:9.5px; padding:2px 6px; border-radius:4px; color:#f59e0b;">LIVE SYNC</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          ${isAdminForDiceLab ? `
            <a href="/admin/dice-tracker" class="gt-dice-header-btn" style="background:rgba(168,85,247,0.18); border:1px solid rgba(168,85,247,0.45); color:#c084fc; text-decoration:none;" title="Open Standalone Camera CV Dice Lab (Admin)">
              <span>📹 CV Lab (Admin)</span>
            </a>
          ` : ''}
          <button type="button" class="gt-dice-header-btn" onclick="window.gtMinimizeDiceRoller(true)" title="Minimize Dice Roller to enter scores">
            <span>— Minimize</span>
          </button>
          <button type="button" class="gt-dice-header-btn close-btn" onclick="window.gtToggleDiceRoller()" title="Close Dice Roller">
            <span>✕ Close</span>
          </button>
        </div>
      </div>

      <div class="gt-dice-body">
        <!-- Mobile Player Switcher Tabs (Visible on Mobile <= 767px) -->
        <div class="gt-dice-mobile-tabs">
          <button type="button" class="gt-dice-mobile-tab ${diceRollerState.activePlayerTab === 1 ? 'active-p1' : ''}" onclick="window.gtSwitchDicePlayerTab(1)">
            🔵 ${escapeHtml(p1Name)} (${p1Count}d &bull; ${dist1.totalRolled} rolled)
          </button>
          <button type="button" class="gt-dice-mobile-tab ${diceRollerState.activePlayerTab === 2 ? 'active-p2' : ''}" onclick="window.gtSwitchDicePlayerTab(2)">
            🔴 ${escapeHtml(p2Name)} (${p2Count}d &bull; ${dist2.totalRolled} rolled)
          </button>
        </div>

        <!-- Dual Player Rollers Grid (Side-by-Side on Desktop/Tablet, Tabbed on Mobile) -->
        <div class="gt-dice-dual-grid">
          ${renderPlayerDicePanel(1, p1Name)}
          ${renderPlayerDicePanel(2, p2Name)}
        </div>
      </div>
    `;
  }

  window.gtSetDiceCount = function(count, playerNum = null) {
    const pNum = playerNum ? (Number(playerNum) === 2 ? 2 : 1) : (diceRollerState.activePlayerTab || 1);
    const bucket = getPlayerBucket(pNum);
    const targetCount = Math.min(100, Math.max(0, isNaN(count) ? 0 : count));
    const current = bucket.tray || [];

    if (targetCount === 0) {
      bucket.tray = [];
    } else if (targetCount > current.length) {
      const diff = targetCount - current.length;
      for (let i = 0; i < diff; i++) {
        bucket.tray.push({
          id: Date.now() + Math.random(),
          val: 0,
          selected: true,
          rolled: false
        });
      }
    } else if (targetCount < current.length) {
      bucket.tray = current.slice(0, targetCount);
    }

    saveDiceTray();
    renderDiceRollerContent();
  };

  window.gtAddDice = function(delta, playerNum = null) {
    const pNum = playerNum ? (Number(playerNum) === 2 ? 2 : 1) : (diceRollerState.activePlayerTab || 1);
    const bucket = getPlayerBucket(pNum);
    const current = bucket.tray || [];
    const newTotal = Math.min(100, current.length + delta);
    const toAdd = newTotal - current.length;

    for (let i = 0; i < toAdd; i++) {
      bucket.tray.push({
        id: Date.now() + Math.random(),
        val: 0,
        selected: true,
        rolled: false
      });
    }

    saveDiceTray();
    renderDiceRollerContent();
  };

  window.gtClearTray = function(playerNum = null) {
    const pNum = playerNum ? (Number(playerNum) === 2 ? 2 : 1) : (diceRollerState.activePlayerTab || 1);
    const bucket = getPlayerBucket(pNum);
    bucket.tray = [];
    saveDiceTray();
    renderDiceRollerContent();
  };

  window.gtSetDiceTarget = function(target) {
    // Maintained as a no-op for legacy test callers
    diceRollerState.target = 0;
    renderDiceRollerContent();
  };

  window.gtToggleDieSelection = function(index, playerNum = null) {
    const pNum = playerNum ? (Number(playerNum) === 2 ? 2 : 1) : (diceRollerState.activePlayerTab || 1);
    const bucket = getPlayerBucket(pNum);
    const tray = bucket.tray || [];
    if (tray[index]) {
      tray[index].selected = !tray[index].selected;
      saveDiceTray();
      renderDiceRollerContent();
    }
  };

  window.gtSelectAll = function(selectAll = 'toggle', playerNum = null) {
    const pNum = playerNum ? (Number(playerNum) === 2 ? 2 : 1) : (diceRollerState.activePlayerTab || 1);
    const bucket = getPlayerBucket(pNum);
    const tray = bucket.tray || [];
    if (selectAll === 'toggle') {
      const allSel = tray.length > 0 && tray.every(d => d.selected);
      tray.forEach(d => { d.selected = !allSel; });
    } else {
      tray.forEach(d => { d.selected = Boolean(selectAll); });
    }
    saveDiceTray();
    renderDiceRollerContent();
  };

  window.gtToggleSelectAll = function(playerNum = null) {
    window.gtSelectAll('toggle', playerNum);
  };

  window.gtToggleSelectFace = function(faceVal, playerNum = null) {
    const pNum = playerNum ? (Number(playerNum) === 2 ? 2 : 1) : (diceRollerState.activePlayerTab || 1);
    const face = parseInt(faceVal, 10);
    const bucket = getPlayerBucket(pNum);
    const tray = bucket.tray || [];
    const rolled = tray.filter(d => d.rolled);
    if (rolled.length === 0) return;

    const matching = rolled.filter(d => d.val === face);
    if (matching.length === 0) return;

    // Pure toggle: if all dice of this face are currently selected, unselect them (keeping other faces intact);
    // otherwise select all dice of this face (adding to any existing selection).
    const isFaceAllSelected = matching.every(d => d.selected);
    matching.forEach(d => {
      d.selected = !isFaceAllSelected;
    });

    saveDiceTray();
    renderDiceRollerContent();
  };

  window.gtExecuteDiceRoll = function(playerNum = null, rollMode = 'selected_only') {
    const pNum = playerNum ? (Number(playerNum) === 2 ? 2 : 1) : (diceRollerState.activePlayerTab || 1);
    const bucket = getPlayerBucket(pNum);
    let tray = bucket.tray || [];

    if (tray.length === 0) {
      alert("Please add dice to the tray (+1, +5, +10, +20) before rolling!");
      return;
    }

    let selectedIndices = [];
    tray.forEach((d, idx) => {
      if (d.selected) selectedIndices.push(idx);
    });

    // If no dice are selected (or rollMode is 'all'), roll all dice in the tray
    const isPartialSelection = selectedIndices.length > 0 && selectedIndices.length < tray.length;
    if (selectedIndices.length === 0 || rollMode === 'all') {
      selectedIndices = tray.map((_, idx) => idx);
    }

    const rollCount = selectedIndices.length;
    const array = new Uint32Array(rollCount);
    window.crypto.getRandomValues(array);
    const newValues = [];
    for (let i = 0; i < rollCount; i++) {
      newValues.push((array[i] % 6) + 1);
    }
    newValues.sort((a, b) => b - a);

    let effectiveMode = 'roll';
    if (isPartialSelection && rollMode === 'reroll_in_place') {
      // Reroll only the selected dice in place and keep the unselected dice in the tray
      effectiveMode = 'reroll';
      selectedIndices.forEach((idx, i) => {
        tray[idx].val = newValues[i];
        tray[idx].rolled = true;
      });
    } else if (isPartialSelection && rollMode === 'selected_only') {
      // Roll only the selected dice (keeping just the selected dice in the tray)
      effectiveMode = 'reroll';
      tray = newValues.map(v => ({
        id: Date.now() + Math.random(),
        val: v,
        selected: false,
        rolled: true
      }));
    } else {
      // Roll all dice in the tray
      effectiveMode = tray.some(d => d.rolled) ? 'reroll' : 'roll';
      tray = newValues.map(v => ({
        id: Date.now() + Math.random(),
        val: v,
        selected: false,
        rolled: true
      }));
    }

    // Sort tray descending by face value and clear selection so user can cleanly select next faces
    tray.sort((a, b) => (b.val || 0) - (a.val || 0));
    tray.forEach(d => { d.selected = false; });
    bucket.tray = tray;

    const { p1Name, p2Name } = getMatchPlayerNames();
    const playerName = pNum === 2 ? p2Name : p1Name;
    const rollSum = newValues.reduce((a, b) => a + b, 0);
    const critCount = newValues.filter(v => v === 6).length;
    const oneCount = newValues.filter(v => v === 1).length;

    const rollPayload = {
      id: `roll_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      client_id: clientState.clientId,
      player_name: playerName,
      player_num: pNum,
      mode: effectiveMode,
      dice_count: rollCount,
      die_type: 'D6',
      target: 0,
      results: newValues,
      tray: diceRollerState.p1.tray,
      trays: {
        p1: { tray: diceRollerState.p1.tray, skin: resolvePlayerDiceSkin(1) },
        p2: { tray: diceRollerState.p2.tray, skin: resolvePlayerDiceSkin(2) }
      },
      success_count: rollCount - oneCount,
      fail_count: oneCount,
      crit_count: critCount,
      sum: rollSum,
      timestamp: Date.now()
    };

    diceRollerState.history.push(rollPayload);
    if (diceRollerState.history.length > 200) diceRollerState.history.shift();

    saveDiceTray(false);
    renderDiceRollerContent();
    broadcastDiceRoll(rollPayload);
  };

  window.gtClearDiceHistory = function(playerNum = null) {
    if (playerNum === 1 || playerNum === 2) {
      diceRollerState.history = (diceRollerState.history || []).filter(h => Number(h.player_num || 1) !== Number(playerNum));
    } else {
      diceRollerState.history = [];
    }
    saveDiceTray(true);
    renderDiceRollerContent();
  };

  function broadcastDiceRoll(rollData) {
    if (!clientState.matchId || clientState.isFinalizing || clientState.isDiscarded) return;

    const traysPayload = {
      p1: { tray: diceRollerState.p1.tray, skin: resolvePlayerDiceSkin(1) },
      p2: { tray: diceRollerState.p2.tray, skin: resolvePlayerDiceSkin(2) }
    };

    if (typeof firebase !== 'undefined' && firebase.firestore) {
      try {
        const db = firebase.firestore();
        db.collection('rooms').doc(clientState.matchId).update({
          dice_tray: diceRollerState.p1.tray,
          dice_trays: traysPayload,
          dice_target: 0,
          dice_history: diceRollerState.history,
          updatedAt: Date.now()
        }).catch(() => {});
      } catch(e) {}
    }

    fetch(`${SYNC_CONFIG.apiBase}/${clientState.matchId}/dice_roll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`,
        'X-Guest-Id': getOrCreateGuestId()
      },
      body: JSON.stringify(Object.assign({}, rollData, { guest_id: getOrCreateGuestId() }))
    }).catch(() => {});
  }

  function applyRemoteDiceRoll(remoteRoll, isSelf) {
    if (!remoteRoll) return;

    if (!diceRollerState.history.some(h => h.id === remoteRoll.id)) {
      diceRollerState.history.push(remoteRoll);
      if (diceRollerState.history.length > 200) diceRollerState.history.shift();
      saveDiceTray(false);
    }

    if (diceRollerState.visible) {
      renderDiceRollerContent();
    }
  }

  // 11. Judge & TO Dispatch Modal
  clientState.activeJudgeCall = null;

  window.gtOpenJudgeModal = function() {
    const urlParams = new URLSearchParams(window.location.search);
    const raw = originalGetItem('gdm-11e-tracker-state');
    let stateObj = {};
    try { stateObj = JSON.parse(raw) || {}; } catch(e) {}
    const game = stateObj.game || {};
    const tournamentId = urlParams.get('event_id') || urlParams.get('tournament_id') || game.tournament_id || game.eventId || '';

    if (!tournamentId) {
      alert('Floor Judge calling is only available for matches registered with an active tournament/event.');
      return;
    }

    if (clientState.activeJudgeCall && (clientState.activeJudgeCall.status === 'resolved' || clientState.activeJudgeCall.status === 'cancelled')) {
      clientState.activeJudgeCall = null;
    }

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

  window.applyRemoteMasterClock = applyRemoteMasterClock;
  window.applyRemoteJudgeCall = applyRemoteJudgeCall;
  window.applyRemoteBroadcast = applyRemoteBroadcast;

  function renderJudgeModal() {
    const modal = document.getElementById('gt-judge-modal');
    if (!modal) return;

    const raw = originalGetItem('gdm-11e-tracker-state');
    let stateObj = {};
    try { stateObj = JSON.parse(raw) || {}; } catch(e) {}
    const game = stateObj.game || {};

    const tournamentId = getTrackerTournamentId() || 'CURRENT_EVENT';
    const tableNum = getTrackerTableNum() || '1';
    const myName = (clientState.role === 'player2' ? game.p2Name : game.p1Name) || (currentUser ? currentUser.display_name : 'Competitor');

    if (clientState.activeJudgeCall) {
      const c = clientState.activeJudgeCall;
      const isEnRoute = c.status === 'en_route';
      const isResolved = c.status === 'resolved';
      const isCancelled = c.status === 'cancelled';
      const isPending = !isEnRoute && !isResolved && !isCancelled;

      let statusIcon = '🚨';
      let statusTitle = 'Judge Call Dispatched';
      let statusSub = `Table #${c.table_num || tableNum} • Issue: <b style="color:#f43f5e;">${escapeHtml(c.category || 'Dispute')}</b>`;
      let statusDesc = 'The Tournament Director and Floor Judges have been notified and will respond shortly.';

      if (isEnRoute) {
        statusIcon = '🏃‍♂️';
        statusTitle = 'Floor Judge Is On The Way!';
        statusDesc = c.assigned_judge 
          ? `Judge <b style="color:#38bdf8;">${escapeHtml(c.assigned_judge)}</b> has taken the call and is en route to Table #${c.table_num || tableNum}.`
          : `A floor judge has answered your call and is walking to Table #${c.table_num || tableNum} now.`;
      } else if (isResolved) {
        statusIcon = '✅';
        statusTitle = 'Judge Call Resolved';
        statusDesc = c.assigned_judge 
          ? `Resolved by ${escapeHtml(c.assigned_judge)}.`
          : 'This request has been marked as resolved.';
      }

      modal.innerHTML = `
        <div class="gt-judge-dialog" style="max-width:440px; background:#0f172a; border:1px solid #334155; border-radius:14px; box-shadow:0 20px 50px rgba(0,0,0,0.85); overflow:hidden; font-family:'Inter',system-ui,sans-serif;">
          <div class="gt-judge-header" style="background:#1e293b; padding:12px 18px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155;">
            <h3 style="margin:0; font-size:1.1rem; color:#fff; display:flex; align-items:center; gap:8px;">
              <span>🚨 Live Floor Judge Dispatch</span>
            </h3>
            <button onclick="window.gtCloseJudgeModal()" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer;">✕</button>
          </div>
          <div class="gt-judge-body" style="text-align:center; padding:1.75rem 1.5rem;">
            <div style="font-size:3rem; margin-bottom:10px;">
              ${statusIcon}
            </div>
            <h4 style="color:#fff; margin:0 0 6px; font-size:1.25rem; font-weight:800;">
              ${statusTitle}
            </h4>
            <p style="color:#94a3b8; font-size:13px; margin:0 0 10px; line-height:1.5;">
              ${statusSub}
            </p>
            <p style="color:#cbd5e1; font-size:12px; margin:0 0 18px; line-height:1.5; background:rgba(15,23,42,0.6); border:1px solid rgba(51,65,85,0.6); padding:10px 14px; border-radius:8px;">
              ${statusDesc}
            </p>
            <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
              <button onclick="window.gtCloseJudgeModal()" style="background:#0284c7; color:#fff; border:none; padding:8px 18px; border-radius:8px; font-weight:700; font-size:12px; cursor:pointer;">
                Return to Game
              </button>
              ${isResolved ? `
                <button onclick="clientState.activeJudgeCall = null; renderJudgeModal();" style="background:#1e293b; color:#94a3b8; border:1px solid #334155; padding:8px 14px; border-radius:8px; font-size:12px; cursor:pointer;">
                  New Call
                </button>
              ` : `
                <button onclick="window.gtCancelJudgeCall()" style="background:#450a0a; color:#fca5a5; border:1px solid #991b1b; padding:8px 14px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer;">
                  Cancel Request
                </button>
              `}
            </div>
          </div>
        </div>
      `;
      return;
    }

    modal.innerHTML = `
      <div class="gt-judge-dialog" style="max-width:480px; background:#0f172a; border:1px solid #334155; border-radius:14px; box-shadow:0 20px 50px rgba(0,0,0,0.85); overflow:hidden; font-family:'Inter',system-ui,sans-serif;">
        <div class="gt-judge-header" style="background:#1e293b; padding:12px 18px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #334155;">
          <h3 style="margin:0; font-size:1.1rem; color:#fff; display:flex; align-items:center; gap:8px;">
            <span>🙋‍♂️ Call Tournament Director / Floor Judge</span>
          </h3>
          <button onclick="window.gtCloseJudgeModal()" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer;">✕</button>
        </div>
        <div class="gt-judge-body" style="padding:16px 20px;">
          <p style="color:#94a3b8; font-size:12px; margin:0 0 14px; line-height:1.5;">
            Need a rules clarification, clock ruling, or line-of-sight adjudication? Submit this request to alert the floor judges immediately.
          </p>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
            <div>
              <label style="display:block; font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.05em;">Table Number</label>
              <input type="number" id="gt-judge-table" value="${tableNum}" style="width:100%; box-sizing:border-box; background:#070b14; border:1px solid #334155; color:#fff; padding:8px 12px; border-radius:8px; font-family:'JetBrains Mono',monospace; font-weight:800; font-size:14px;" />
            </div>
            <div>
              <label style="display:block; font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.05em;">Calling Player</label>
              <input type="text" id="gt-judge-name" value="${escapeHtml(myName)}" style="width:100%; box-sizing:border-box; background:#070b14; border:1px solid #334155; color:#fff; padding:8px 12px; border-radius:8px; font-size:13px;" />
            </div>
          </div>

          <label style="display:block; font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.05em;">Issue Category</label>
          <div id="gt-judge-categories" style="margin-bottom:14px; display:flex; flex-direction:column; gap:6px;">
            <div class="gt-issue-option selected" onclick="window.gtSelectCategory(this, 'Rules Dispute')">
              <span style="font-size:16px;">📜</span>
              <div>
                <b style="font-size:12px; color:#fff;">Rules / Datasheet Dispute</b>
                <div style="font-size:10px; color:#94a3b8;">Ambiguous interaction, keyword question, sequencing</div>
              </div>
            </div>
            <div class="gt-issue-option" onclick="window.gtSelectCategory(this, 'Clock / Timing Issue')">
              <span style="font-size:16px;">⏱️</span>
              <div>
                <b style="font-size:12px; color:#fff;">Chess Clock / Timing Adjudication</b>
                <div style="font-size:10px; color:#94a3b8;">Clock out, time transfer dispute, round stoppage</div>
              </div>
            </div>
            <div class="gt-issue-option" onclick="window.gtSelectCategory(this, 'Measurement / Line of Sight')">
              <span style="font-size:16px;">📏</span>
              <div>
                <b style="font-size:12px; color:#fff;">Measurement / Line of Sight</b>
                <div style="font-size:10px; color:#94a3b8;">Laser line confirmation, ruin visibility ruling</div>
              </div>
            </div>
            <div class="gt-issue-option" onclick="window.gtSelectCategory(this, 'Scorecard Correction')">
              <span style="font-size:16px;">📝</span>
              <div>
                <b style="font-size:12px; color:#fff;">Scorecard / Misclick Correction</b>
                <div style="font-size:10px; color:#94a3b8;">Wrong mission/secondary selected, turn adjustment</div>
              </div>
            </div>
          </div>

          <label style="display:block; font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.05em;">Optional Brief Note</label>
          <textarea id="gt-judge-note" placeholder="E.g. Table 4 ruin true line of sight question on Land Raider..." style="width:100%; box-sizing:border-box; height:55px; background:#070b14; border:1px solid #334155; color:#fff; padding:8px 12px; border-radius:8px; font-size:12px; margin-bottom:16px; resize:none; font-family:inherit;"></textarea>

          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button onclick="window.gtCloseJudgeModal()" style="background:#1e293b; color:#94a3b8; border:1px solid #334155; padding:8px 16px; border-radius:8px; font-weight:700; font-size:12px; cursor:pointer;">
              Cancel
            </button>
            <button id="gt-btn-dispatch-judge" onclick="window.gtSubmitJudgeCall('${tournamentId}')" style="background:linear-gradient(135deg, #e11d48, #be123c); color:#fff; border:none; padding:8px 20px; border-radius:8px; font-weight:800; font-size:12px; cursor:pointer; box-shadow:0 4px 14px rgba(225,29,72,0.4);">
              🚨 Dispatch Judge to Table
            </button>
          </div>
        </div>
      </div>
    `;
  }

  let selectedCategory = 'Rules Dispute';
  window.gtSelectCategory = function(el, cat) {
    selectedCategory = cat;
    document.querySelectorAll('.gt-issue-option').forEach(o => o.classList.remove('selected'));
    if (el) el.classList.add('selected');
  };

  window.gtSubmitJudgeCall = async function(paramTournamentId) {
    const tableEl = document.getElementById('gt-judge-table');
    const nameEl = document.getElementById('gt-judge-name');
    const noteEl = document.getElementById('gt-judge-note');
    const btn = document.getElementById('gt-btn-dispatch-judge');

    const tournamentId = paramTournamentId || getTrackerTournamentId() || 'CURRENT_EVENT';
    const tableNum = parseInt(tableEl ? tableEl.value : getTrackerTableNum()) || 1;
    const raw = originalGetItem('gdm-11e-tracker-state');
    let stateObj = {};
    try { stateObj = JSON.parse(raw) || {}; } catch(e) {}
    const game = stateObj.game || {};

    const playerName = (nameEl && nameEl.value.trim()) || (clientState.role === 'player2' ? game.p2Name : game.p1Name) || 'Competitor';
    const opponentName = (clientState.role === 'player2' ? game.p1Name : game.p2Name) || '';
    const note = noteEl ? noteEl.value.trim() : '';

    if (btn) {
      btn.disabled = true;
      btn.textContent = '🚨 Dispatching...';
    }

    const callId = 'call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const callData = {
      id: callId,
      call_id: callId,
      callId: callId,
      eventId: tournamentId,
      event_id: tournamentId,
      tableNum: tableNum,
      table_num: tableNum,
      tableNumber: tableNum,
      table: tableNum,
      matchId: clientState.matchId || '',
      match_id: clientState.matchId || '',
      playerName: playerName,
      player_name: playerName,
      caller: playerName,
      callerName: playerName,
      opponent: opponentName,
      category: selectedCategory,
      note: note,
      notes: note,
      status: 'pending',
      createdAt: Date.now(),
      created_at: Date.now()
    };

    // 1. Direct Firestore write to main Event documents (instant ~20ms dispatch & EventStudio onSnapshot trigger)
    const db = getTrackerFirestoreDb();
    if (db && tournamentId) {
      try {
        const updateMainEventDoc = async (ref) => {
          try {
            const snap = await ref.get();
            let list = [];
            if (snap && snap.exists) {
              const d = snap.data() || {};
              list = Array.isArray(d.judge_calls) ? d.judge_calls.slice() : (Array.isArray(d.flags) ? d.flags.slice() : []);
            }
            list = list.filter(c => c.id !== callId && c.call_id !== callId);
            list.unshift(callData);
            await ref.set({
              id: tournamentId,
              eventId: tournamentId,
              type: "Event",
              judge_calls: list,
              flags: list,
              updatedAt: Date.now()
            }, { merge: true });
          } catch (e) {
            console.debug('[Firestore Judge Dispatch] Event doc update notice:', e);
          }
        };

        updateMainEventDoc(db.collection('tournaments').doc(tournamentId));
        db.collection('tournaments').doc(tournamentId).collection('judge_calls').doc(callId).set(callData, { merge: true }).catch(() => {});
        if (clientState.matchId) {
          db.collection('rooms').doc(clientState.matchId).update({ active_judge_call: callData }).catch(() => {});
        }
      } catch (err) {
        console.debug('[Firestore Judge Dispatch] Native write exception:', err);
      }
    }

    // 2. REST API fallback & SQLite synchronization
    try {
      const resp = await fetch('/api/eventstudio/judge_call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callData)
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.call) {
          clientState.activeJudgeCall = data.call;
        } else {
          clientState.activeJudgeCall = callData;
        }
      } else {
        clientState.activeJudgeCall = callData;
      }
    } catch (err) {
      console.warn('Judge dispatch network notice (relying on Firestore/local):', err);
      clientState.activeJudgeCall = callData;
    } finally {
      injectMultiplayerHUD();
      renderJudgeModal();
    }
  };

  window.gtCancelJudgeCall = async function() {
    const call = clientState.activeJudgeCall;
    if (!call) return;
    const tournamentId = getTrackerTournamentId() || call.event_id || call.eventId || 'CURRENT_EVENT';
    const callId = call.call_id || call.id || call.callId;

    // 1. Direct Firestore cancel
    const db = getTrackerFirestoreDb();
    if (db && tournamentId && callId) {
      try {
        const cancelInDoc = async (ref) => {
          try {
            const snap = await ref.get();
            if (snap && snap.exists) {
              const d = snap.data() || {};
              let list = Array.isArray(d.judge_calls) ? d.judge_calls.slice() : (Array.isArray(d.flags) ? d.flags.slice() : []);
              let changed = false;
              list = list.map(c => {
                if (c.id === callId || c.call_id === callId) {
                  changed = true;
                  return Object.assign({}, c, {
                    status: 'cancelled',
                    resolved_at: Date.now(),
                    resolvedAt: Date.now()
                  });
                }
                return c;
              });
              if (changed) {
                await ref.set({
                  judge_calls: list,
                  flags: list,
                  updatedAt: Date.now()
                }, { merge: true });
              }
            }
          } catch(e) {}
        };

        cancelInDoc(db.collection('tournaments').doc(tournamentId));
        db.collection('tournaments').doc(tournamentId).collection('judge_calls').doc(callId).update({
          status: 'cancelled',
          resolved_at: Date.now(),
          resolvedAt: Date.now()
        }).catch(() => {});

        if (clientState.matchId) {
          db.collection('rooms').doc(clientState.matchId).update({
            active_judge_call: firebase.firestore.FieldValue.delete()
          }).catch(() => {});
        }
      } catch (e) {}
    }

    // 2. REST API fallback
    try {
      await fetch('/api/eventstudio/judge_call/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call_id: callId,
          status: 'cancelled',
          event_id: tournamentId,
          match_id: clientState.matchId
        })
      });
    } catch (e) {}

    clientState.activeJudgeCall = null;
    injectMultiplayerHUD();
    renderJudgeModal();
  };

  // Feedback Modal for Match Tracker
  let gtFeedbackType = 'bug';
  window.gtSetFeedbackType = function(type) {
    gtFeedbackType = type;
    ['bug', 'feature', 'general'].forEach(t => {
      const btn = document.getElementById(`gt-fb-type-btn-${t}`);
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
  };

  window.gtOpenFeedbackModal = function() {
    let modal = document.getElementById('gt-feedback-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'gt-feedback-modal';
      modal.className = 'gt-modal-backdrop';
      modal.onclick = function(e) { if (e.target === this) window.gtCloseFeedbackModal(); };
      document.body.appendChild(modal);
    }

    const userEmail = (currentUser && currentUser.email) ? currentUser.email : '';

    modal.innerHTML = `
      <div class="gt-modal-window" style="max-width: 500px; background:#0b1120; border:1px solid rgba(56,189,248,0.3); border-radius:16px; box-shadow:0 25px 60px rgba(0,0,0,0.85); overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc;">
        <div class="gt-modal-header" style="padding:14px 18px; background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:20px;">💬</span>
            <div>
              <h3 style="font-size:15px; font-weight:800; color:#fff; margin:0;">Game Tracker Feedback</h3>
              <div style="font-size:11px; color:#38bdf8; margin-top:2px;">Report bug or suggest improvement for Match #${clientState.matchId || 'Live'}</div>
            </div>
          </div>
          <button onclick="window.gtCloseFeedbackModal()" style="background:transparent; border:none; color:#94a3b8; font-size:20px; cursor:pointer;">✕</button>
        </div>

        <div style="padding:18px;">
          <!-- Category Selector -->
          <label style="display:block; font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:6px;">Category:</label>
          <div style="display:flex; gap:6px; margin-bottom:14px;">
            <button type="button" id="gt-fb-type-btn-bug" onclick="window.gtSetFeedbackType('bug')" style="flex:1; padding:7px 8px; border-radius:8px; font-size:11.5px; font-weight:700; border:1px solid #38bdf8; background:#0284c7; color:#fff; cursor:pointer; transition:all 0.2s;">
              🐞 Bug Report
            </button>
            <button type="button" id="gt-fb-type-btn-feature" onclick="window.gtSetFeedbackType('feature')" style="flex:1; padding:7px 8px; border-radius:8px; font-size:11.5px; font-weight:700; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:#94a3b8; cursor:pointer; transition:all 0.2s;">
              ✨ Feature Idea
            </button>
            <button type="button" id="gt-fb-type-btn-general" onclick="window.gtSetFeedbackType('general')" style="flex:1; padding:7px 8px; border-radius:8px; font-size:11.5px; font-weight:700; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04); color:#94a3b8; cursor:pointer; transition:all 0.2s;">
              💬 General
            </button>
          </div>

          <!-- Description -->
          <label style="display:block; font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:6px;">
            Description / Details: <span style="color:#ef4444;">*</span>
          </label>
          <textarea id="gt-fb-input-message" rows="4" placeholder="Describe the issue or suggestion... (e.g. scorecard sync, list importer, clock error)" style="width:100%; background:#070b14; border:1px solid #334155; border-radius:8px; padding:10px 12px; color:#e2e8f0; font-size:12px; font-family:'Inter',system-ui,sans-serif; outline:none; box-sizing:border-box; line-height:1.5; resize:vertical;"></textarea>

          <!-- Locked Verified User Email -->
          <div style="margin-top:12px;">
            <label style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:700; color:#cbd5e1; margin-bottom:6px;">
              <span>Verified Account Email:</span>
              <span style="font-size:10.5px; color:#10b981; font-weight:600;">🔒 Locked to active account</span>
            </label>
            <input type="text" id="gt-fb-input-contact" value="${escapeHtml(userEmail)}" readonly disabled style="width:100%; background:#1e293b; border:1px solid #475569; border-radius:8px; padding:8px 12px; color:#94a3b8; font-size:12px; outline:none; box-sizing:border-box; cursor:not-allowed; opacity:0.85;">
          </div>

          <div id="gt-fb-status-msg" style="display:none; margin-top:12px; padding:9px 12px; border-radius:8px; font-size:12px; font-weight:600;"></div>

          <!-- Action Buttons -->
          <div style="margin-top:16px; display:flex; justify-content:flex-end; gap:8px;">
            <button onclick="window.gtCloseFeedbackModal()" style="background:#1e293b; color:#cbd5e1; font-weight:700; font-size:12px; border:none; padding:8px 14px; border-radius:8px; cursor:pointer;">Cancel</button>
            <button id="gt-fb-btn-submit" onclick="window.gtSubmitFeedback()" style="background:#0284c7; color:#fff; font-weight:800; font-size:12px; border:none; padding:8px 18px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px;">
              🚀 Submit Feedback
            </button>
          </div>
        </div>
      </div>
    `;

    modal.classList.add('active');
    modal.style.display = 'flex';
    gtFeedbackType = 'bug';
  };

  window.gtCloseFeedbackModal = function() {
    const modal = document.getElementById('gt-feedback-modal');
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
    }
  };

  window.gtSubmitFeedback = async function() {
    const msgInput = document.getElementById('gt-fb-input-message');
    const contactInput = document.getElementById('gt-fb-input-contact');
    const statusDiv = document.getElementById('gt-fb-status-msg');
    const btn = document.getElementById('gt-fb-btn-submit');

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
      btn.innerHTML = 'Submitting...';
    }

    try {
      const token = getAuthToken();
      const payload = {
        feedback_type: gtFeedbackType,
        message: message,
        email: email,
        page_url: window.location.href,
        device_info: `Match #${clientState.matchId || 'None'} | Role: ${clientState.role} | ${navigator.userAgent}`,
        token: token
      };

      const resp = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
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
          statusDiv.innerText = '✅ Thank you! Feedback recorded.';
        }
        if (msgInput) msgInput.value = '';
        setTimeout(() => {
          window.gtCloseFeedbackModal();
        }, 1500);
      } else {
        throw new Error(data.detail || data.error || 'Failed to submit feedback');
      }
    } catch (err) {
      if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.style.background = 'rgba(239,68,68,0.15)';
        statusDiv.style.border = '1px solid rgba(239,68,68,0.4)';
        statusDiv.style.color = '#f87171';
        statusDiv.innerText = `Error: ${err.message}`;
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🚀 Submit Feedback';
      }
    }
  };

  window.__refreshTrackerHistoryAfterImport = async function () {
    syncHistoryInFlight = null;
    await syncHistoryFromDatabase();
    renderHistoryList(dbHistoryCache);
  };

  if (typeof window.openTrackerImportModal !== 'function') {
    window.openTrackerImportModal = function (defaultTab = 'ttb-sync') {
      const existing = document.getElementById('tracker-import-modal-overlay');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'tracker-import-modal-overlay';
      overlay.style.cssText = "position:fixed; inset:0; z-index:999999; background:rgba(2,6,23,0.88); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; padding:12px; font-family:'Inter', sans-serif;";
      overlay.onclick = (e) => { if (e.target === overlay) window.closeTrackerImportModal(); };

      overlay.innerHTML = `
        <div id="tracker-import-modal-card" style="background:#0b1120; border:1px solid rgba(58,193,139,0.4); border-radius:18px; width:100%; max-width:560px; max-height:92vh; display:flex; flex-direction:column; box-shadow:0 28px 80px rgba(0,0,0,0.9), 0 0 40px rgba(58,193,139,0.1); overflow:hidden; color:#f8fafc;">
          <div style="padding:16px 20px; background:linear-gradient(135deg, #0d1f1d 0%, #0f172a 100%); border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center; gap:12px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <img src="/assets/integrations/ttb_icon.png" alt="Import Games" style="width:34px; height:34px; border-radius:9px; box-shadow:0 4px 12px rgba(0,0,0,0.4);" />
              <div>
                <div style="font-size:1.05rem; font-weight:800; color:#fff; line-height:1.2;">Import Completed Games</div>
                <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Sync your 40k &amp; Age of Sigmar scorecards from your favorite tracker app</div>
              </div>
            </div>
            <button type="button" onclick="window.closeTrackerImportModal()" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; width:30px; height:30px; border-radius:8px; cursor:pointer; font-size:0.9rem; flex-shrink:0;">✕</button>
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:6px; padding:10px 16px; background:#070b14; border-bottom:1px solid rgba(255,255,255,0.07);">
            <button type="button" id="imp-tab-btn-ttb-sync" onclick="window.switchTrackerImportTab('ttb-sync')" style="flex:1 1 auto; padding:7px 10px; border-radius:8px; font-size:0.73rem; font-weight:800; cursor:pointer; border:1px solid rgba(58,193,139,0.5); background:rgba(58,193,139,0.16); color:#34d399; display:flex; align-items:center; justify-content:center; gap:5px; white-space:nowrap;">
              <img src="/assets/integrations/ttb_icon.png" alt="" style="width:15px; height:15px; border-radius:4px;" />
              <span>Tabletop Battles</span>
            </button>
            <button type="button" id="imp-tab-btn-battlebase" onclick="window.switchTrackerImportTab('battlebase')" style="flex:1 1 auto; padding:7px 10px; border-radius:8px; font-size:0.73rem; font-weight:800; cursor:pointer; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#94a3b8; display:flex; align-items:center; justify-content:center; gap:5px; white-space:nowrap;">
              <span>⚔️</span>
              <span>BattleBase</span>
            </button>
            <button type="button" id="imp-tab-btn-newrecruit" onclick="window.switchTrackerImportTab('newrecruit')" style="flex:1 1 auto; padding:7px 10px; border-radius:8px; font-size:0.73rem; font-weight:800; cursor:pointer; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#94a3b8; display:flex; align-items:center; justify-content:center; gap:5px; white-space:nowrap;">
              <span>📋</span>
              <span>NewRecruit</span>
            </button>
            <button type="button" id="imp-tab-btn-championshub" onclick="window.switchTrackerImportTab('championshub')" style="flex:1 1 auto; padding:7px 10px; border-radius:8px; font-size:0.73rem; font-weight:800; cursor:pointer; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#94a3b8; display:flex; align-items:center; justify-content:center; gap:5px; white-space:nowrap;">
              <span>🏆</span>
              <span>ChampionsHub</span>
            </button>
            <button type="button" id="imp-tab-btn-milarki" onclick="window.switchTrackerImportTab('milarki')" style="flex:1 1 auto; padding:7px 10px; border-radius:8px; font-size:0.73rem; font-weight:800; cursor:pointer; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.03); color:#94a3b8; display:flex; align-items:center; justify-content:center; gap:5px; white-space:nowrap;">
              <span>⚡</span>
              <span>Milarki (AoS)</span>
            </button>
          </div>

          <div style="padding:18px 20px 20px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:14px;">
            <!-- Panel 1: Tabletop Battles -->
            <div id="imp-panel-ttb-sync" style="display:flex; flex-direction:column; gap:14px;">
              <div style="background:linear-gradient(160deg, #132226 0%, #0f172a 60%, #111827 100%); border:1px solid rgba(58,193,139,0.32); border-radius:14px; padding:18px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
                <div style="display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:12px;">
                  <div style="position:relative; width:52px; height:52px; border-radius:14px; background:#3ac18b; border:2px solid rgba(255,255,255,0.2); box-shadow:0 8px 20px rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center;">
                    <img src="/assets/integrations/ttb_icon.png" alt="Tabletop Battles" style="width:48px; height:48px; border-radius:12px; object-fit:cover;" />
                    <img src="/assets/integrations/gh_logo.png" alt="Goonhammer" title="Powered by Goonhammer" style="position:absolute; bottom:-5px; right:-5px; width:22px; height:22px; border-radius:50%; border:2px solid #0f172a; object-fit:cover;" />
                  </div>
                  <div style="display:flex; flex-direction:column; align-items:center;">
                    <span style="color:#34d399; font-size:15px; font-weight:800; line-height:1;">⇄</span>
                    <span style="font-size:9px; letter-spacing:0.08em; text-transform:uppercase; color:#64748b; font-weight:800; margin-top:2px;">SYNC</span>
                  </div>
                  <div style="width:48px; height:48px; border-radius:13px; background:#0f172a; border:1px solid rgba(56,189,248,0.4); box-shadow:0 8px 20px rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; overflow:hidden;">
                    <img src="/assets/logo-192.png" alt="OmniTactica" style="width:36px; height:36px; object-fit:contain;" />
                  </div>
                </div>

                <div style="text-align:center; margin-bottom:14px;">
                  <div style="font-size:1.05rem; font-weight:800; color:#fff; letter-spacing:-0.01em;">Sign in to Tabletop Battles</div>
                  <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Use your Goonhammer / Administratum account to import completed 40k &amp; AoS games</div>
                  <div style="display:inline-flex; align-items:center; gap:5px; margin-top:8px; padding:3px 10px; border-radius:999px; background:rgba(2,6,23,0.7); border:1px solid rgba(58,193,139,0.35); font-family:monospace; font-size:0.68rem; color:#34d399;">
                    <span>🔒</span> <span>https://administratum.tabletopbattles.com</span>
                  </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:11px;">
                  <div>
                    <label for="imp-ttb-email" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Email or Username</label>
                    <div style="position:relative; display:flex; align-items:center;">
                      <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">✉️</span>
                      <input id="imp-ttb-email" type="text" placeholder="name@example.com" autocomplete="username" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(58,193,139,0.35); border-radius:9px; padding:10px 12px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" />
                    </div>
                  </div>
                  <div>
                    <label for="imp-ttb-password" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Password</label>
                    <div style="position:relative; display:flex; align-items:center;">
                      <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🔑</span>
                      <input id="imp-ttb-password" type="password" placeholder="Enter your Tabletop Battles password" autocomplete="current-password" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(58,193,139,0.35); border-radius:9px; padding:10px 38px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" onkeydown="if(event.key==='Enter')window.submitTrackerImport('ttb-sync')" />
                      <button type="button" onclick="const p=document.getElementById('imp-ttb-password'); if(p){p.type=p.type==='password'?'text':'password'; this.textContent=p.type==='password'?'👁️':'🙈';}" style="position:absolute; right:8px; background:none; border:none; color:#94a3b8; cursor:pointer; font-size:0.85rem; padding:4px;" title="Show/Hide Password">👁️</button>
                    </div>
                  </div>

                  <button type="button" id="btn-imp-submit-sync" onclick="window.submitTrackerImport('ttb-sync')" style="margin-top:4px; width:100%; background:linear-gradient(135deg, #2eb87e 0%, #1f9d68 100%); border:1px solid rgba(110,231,183,0.4); color:#042f1e; font-size:0.86rem; font-weight:800; padding:11px 18px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 6px 18px rgba(46,184,126,0.28);">
                    <img src="/assets/integrations/ttb_icon.png" alt="" style="width:20px; height:20px; border-radius:5px;" />
                    <span style="color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.35);">Sign In with Tabletop Battles &amp; Sync</span>
                  </button>
                </div>

                <div style="font-size:0.7rem; color:#64748b; text-align:center; margin-top:11px; line-height:1.4;">
                  🛡️ Authenticates directly via Goonhammer Administratum SRP. Your credentials are used one-time and never stored.
                </div>
              </div>
            </div>

            <!-- Panel 2: BattleBase -->
            <div id="imp-panel-battlebase" style="display:none; flex-direction:column; gap:14px;">
              <div style="background:linear-gradient(160deg, #0d1d2a 0%, #0f172a 60%, #111827 100%); border:1px solid rgba(56,189,248,0.35); border-radius:14px; padding:18px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
                <div style="text-align:center; margin-bottom:14px;">
                  <div style="font-size:1.05rem; font-weight:800; color:#fff; letter-spacing:-0.01em;">⚔️ Sign in to BattleBase</div>
                  <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Import your Warhammer 40,000 turn-by-turn primary, secondary &amp; CP scorecards</div>
                  <div style="display:inline-flex; align-items:center; gap:5px; margin-top:8px; padding:3px 10px; border-radius:999px; background:rgba(2,6,23,0.7); border:1px solid rgba(56,189,248,0.35); font-family:monospace; font-size:0.68rem; color:#38bdf8;">
                    <span>🔒</span> <span>https://www.battlebase.app/graphql</span>
                  </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:11px;">
                  <div>
                    <label for="imp-bb-username" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Email or BattleBase Username</label>
                    <div style="position:relative; display:flex; align-items:center;">
                      <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">👤</span>
                      <input id="imp-bb-username" type="text" placeholder="Email or BattleBase username" autocomplete="username" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(56,189,248,0.35); border-radius:9px; padding:10px 12px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" />
                    </div>
                  </div>
                  <div>
                    <label for="imp-bb-password" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Password <span style="color:#64748b; font-weight:500;">(optional if profile battles are public)</span></label>
                    <div style="position:relative; display:flex; align-items:center;">
                      <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🔑</span>
                      <input id="imp-bb-password" type="password" placeholder="Enter your BattleBase password" autocomplete="current-password" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(56,189,248,0.35); border-radius:9px; padding:10px 38px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" onkeydown="if(event.key==='Enter')window.submitTrackerImport('battlebase')" />
                    </div>
                  </div>

                  <button type="button" id="btn-imp-submit-battlebase" onclick="window.submitTrackerImport('battlebase')" style="margin-top:4px; width:100%; background:linear-gradient(135deg, #0284c7 0%, #0369a1 100%); border:1px solid rgba(125,211,252,0.4); color:#fff; font-size:0.86rem; font-weight:800; padding:11px 18px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 6px 18px rgba(2,132,199,0.28);">
                    <span>⚔️</span>
                    <span>Sign In with BattleBase &amp; Sync</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Panel 3: NewRecruit -->
            <div id="imp-panel-newrecruit" style="display:none; flex-direction:column; gap:14px;">
              <div style="background:linear-gradient(160deg, #241b0c 0%, #0f172a 60%, #111827 100%); border:1px solid rgba(245,158,11,0.35); border-radius:14px; padding:18px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
                <div style="text-align:center; margin-bottom:14px;">
                  <div style="font-size:1.05rem; font-weight:800; color:#fff; letter-spacing:-0.01em;">📋 Sign in to NewRecruit</div>
                  <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Import your 40k &amp; Age of Sigmar Game Assistant match reports and tournament history</div>
                  <div style="display:inline-flex; align-items:center; gap:5px; margin-top:8px; padding:3px 10px; border-radius:999px; background:rgba(2,6,23,0.7); border:1px solid rgba(245,158,11,0.35); font-family:monospace; font-size:0.68rem; color:#fbbf24;">
                    <span>🔒</span> <span>https://www.newrecruit.eu/api/rpc</span>
                  </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:11px;">
                  <div>
                    <label for="imp-nr-username" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">NewRecruit Username or Email</label>
                    <div style="position:relative; display:flex; align-items:center;">
                      <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">👤</span>
                      <input id="imp-nr-username" type="text" placeholder="NewRecruit username or email" autocomplete="username" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(245,158,11,0.35); border-radius:9px; padding:10px 12px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" />
                    </div>
                  </div>
                  <div>
                    <label for="imp-nr-password" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Password</label>
                    <div style="position:relative; display:flex; align-items:center;">
                      <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🔑</span>
                      <input id="imp-nr-password" type="password" placeholder="Enter your NewRecruit password" autocomplete="current-password" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(245,158,11,0.35); border-radius:9px; padding:10px 38px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" onkeydown="if(event.key==='Enter')window.submitTrackerImport('newrecruit')" />
                    </div>
                  </div>

                  <button type="button" id="btn-imp-submit-newrecruit" onclick="window.submitTrackerImport('newrecruit')" style="margin-top:4px; width:100%; background:linear-gradient(135deg, #d97706 0%, #b45309 100%); border:1px solid rgba(251,191,36,0.4); color:#fff; font-size:0.86rem; font-weight:800; padding:11px 18px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 6px 18px rgba(217,119,6,0.28);">
                    <span>📋</span>
                    <span>Sign In with NewRecruit &amp; Sync</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Panel 4: ChampionsHub -->
            <div id="imp-panel-championshub" style="display:none; flex-direction:column; gap:14px;">
              <div style="background:linear-gradient(160deg, #1f122b 0%, #0f172a 60%, #111827 100%); border:1px solid rgba(168,85,247,0.35); border-radius:14px; padding:18px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
                <div style="text-align:center; margin-bottom:14px;">
                  <div style="font-size:1.05rem; font-weight:800; color:#fff; letter-spacing:-0.01em;">🏆 Sign in to ChampionsHub</div>
                  <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Import your 40k &amp; AoS tournament pairings, Battle VP, WTC points, and army lists</div>
                  <div style="display:inline-flex; align-items:center; gap:5px; margin-top:8px; padding:3px 10px; border-radius:999px; background:rgba(2,6,23,0.7); border:1px solid rgba(168,85,247,0.35); font-family:monospace; font-size:0.68rem; color:#c084fc;">
                    <span>🔒</span> <span>https://api.championshub.app</span>
                  </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:11px;">
                  <div>
                    <label for="imp-ch-username" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Email or ChampionsHub Player Name</label>
                    <div style="position:relative; display:flex; align-items:center;">
                      <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">👤</span>
                      <input id="imp-ch-username" type="text" placeholder="Email or player display name" autocomplete="username" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(168,85,247,0.35); border-radius:9px; padding:10px 12px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" />
                    </div>
                  </div>
                  <div>
                    <label for="imp-ch-password" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Password <span style="color:#64748b; font-weight:500;">(optional for public tournament history)</span></label>
                    <div style="position:relative; display:flex; align-items:center;">
                      <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🔑</span>
                      <input id="imp-ch-password" type="password" placeholder="Enter your ChampionsHub password" autocomplete="current-password" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(168,85,247,0.35); border-radius:9px; padding:10px 38px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" onkeydown="if(event.key==='Enter')window.submitTrackerImport('championshub')" />
                    </div>
                  </div>

                  <button type="button" id="btn-imp-submit-championshub" onclick="window.submitTrackerImport('championshub')" style="margin-top:4px; width:100%; background:linear-gradient(135deg, #9333ea 0%, #7e22ce 100%); border:1px solid rgba(216,180,254,0.4); color:#fff; font-size:0.86rem; font-weight:800; padding:11px 18px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 6px 18px rgba(147,51,234,0.28);">
                    <span>🏆</span>
                    <span>Sign In with ChampionsHub &amp; Sync</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Panel 5: Milarki -->
            <div id="imp-panel-milarki" style="display:none; flex-direction:column; gap:14px;">
              <div style="background:linear-gradient(160deg, #28111b 0%, #0f172a 60%, #111827 100%); border:1px solid rgba(244,63,94,0.35); border-radius:14px; padding:18px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.05);">
                <div style="text-align:center; margin-bottom:14px;">
                  <div style="font-size:1.05rem; font-weight:800; color:#fff; letter-spacing:-0.01em;">⚡ Sync Milarki (Age of Sigmar)</div>
                  <div style="font-size:0.74rem; color:#94a3b8; margin-top:2px;">Import round-by-round AoS 4.0 battle tactics, objective points &amp; tournament matches</div>
                  <div style="display:inline-flex; align-items:center; gap:5px; margin-top:8px; padding:3px 10px; border-radius:999px; background:rgba(2,6,23,0.7); border:1px solid rgba(244,63,94,0.35); font-family:monospace; font-size:0.68rem; color:#fb7185;">
                    <span>🔒</span> <span>https://www.milarki.com/api/v1</span>
                  </div>
                </div>

                <div style="display:flex; flex-direction:column; gap:11px;">
                  <div>
                    <label for="imp-mlk-player-id" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Milarki Player ID (6-character Public ID)</label>
                    <div style="position:relative; display:flex; align-items:center;">
                      <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🆔</span>
                      <input id="imp-mlk-player-id" type="text" placeholder="e.g. a1B2c3 (from milarki.com/profile)" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(244,63,94,0.35); border-radius:9px; padding:10px 12px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" />
                    </div>
                  </div>
                  <div>
                    <label for="imp-mlk-api-key" style="display:block; font-size:0.73rem; font-weight:700; color:#cbd5e1; margin-bottom:5px;">Milarki API Key (<code style="color:#fb7185;">mlk_v1_...</code>)</label>
                    <div style="position:relative; display:flex; align-items:center;">
                      <span style="position:absolute; left:11px; color:#64748b; font-size:0.85rem; pointer-events:none;">🔑</span>
                      <input id="imp-mlk-api-key" type="password" placeholder="mlk_v1_... (from milarki.com/developer)" style="width:100%; box-sizing:border-box; background:#070c16; border:1px solid rgba(244,63,94,0.35); border-radius:9px; padding:10px 38px 10px 34px; color:#fff; font-size:0.84rem; outline:none;" onkeydown="if(event.key==='Enter')window.submitTrackerImport('milarki')" />
                    </div>
                  </div>

                  <button type="button" id="btn-imp-submit-milarki" onclick="window.submitTrackerImport('milarki')" style="margin-top:4px; width:100%; background:linear-gradient(135deg, #e11d48 0%, #be123c 100%); border:1px solid rgba(251,113,133,0.4); color:#fff; font-size:0.86rem; font-weight:800; padding:11px 18px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 6px 18px rgba(225,29,72,0.28);">
                    <span>⚡</span>
                    <span>Sync Milarki Battles</span>
                  </button>
                </div>
              </div>
            </div>

            <div id="imp-result-box" style="display:none; border-radius:12px; padding:12px 14px; font-size:0.8rem;"></div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      window.switchTrackerImportTab(defaultTab);
    };

    window.closeTrackerImportModal = function () {
      const existing = document.getElementById('tracker-import-modal-overlay');
      if (existing) existing.remove();
    };

    window.switchTrackerImportTab = function (tabId) {
      const validTabs = ['ttb-sync', 'battlebase', 'newrecruit', 'championshub', 'milarki'];
      const targetTab = validTabs.includes(tabId) ? tabId : 'ttb-sync';
      const activeColors = {
        'ttb-sync': { bg: 'rgba(58,193,139,0.16)', border: 'rgba(58,193,139,0.5)', color: '#34d399' },
        'battlebase': { bg: 'rgba(56,189,248,0.16)', border: 'rgba(56,189,248,0.5)', color: '#38bdf8' },
        'newrecruit': { bg: 'rgba(245,158,11,0.16)', border: 'rgba(245,158,11,0.5)', color: '#fbbf24' },
        'championshub': { bg: 'rgba(168,85,247,0.16)', border: 'rgba(168,85,247,0.5)', color: '#c084fc' },
        'milarki': { bg: 'rgba(244,63,94,0.16)', border: 'rgba(244,63,94,0.5)', color: '#fb7185' }
      };
      validTabs.forEach(t => {
        const panel = document.getElementById(`imp-panel-${t}`);
        const btn = document.getElementById(`imp-tab-btn-${t}`);
        if (panel) panel.style.display = (t === targetTab) ? 'flex' : 'none';
        if (btn) {
          if (t === targetTab) {
            const theme = activeColors[t] || activeColors['ttb-sync'];
            btn.style.background = theme.bg;
            btn.style.borderColor = theme.border;
            btn.style.color = theme.color;
          } else {
            btn.style.background = 'rgba(255,255,255,0.03)';
            btn.style.borderColor = 'rgba(255,255,255,0.1)';
            btn.style.color = '#94a3b8';
          }
        }
      });
    };

    window.fillTrackerImportDemo = function (kind) {
      if (kind === 'ttb-sync') {
        const em = document.getElementById('imp-ttb-email');
        const pw = document.getElementById('imp-ttb-password');
        if (em) em.value = 'demo@tabletopbattles.com';
        if (pw) pw.value = 'demo1234';
      }
    };

    window.submitTrackerImport = async function (mode) {
      const resBox = document.getElementById('imp-result-box');
      if (resBox) {
        resBox.style.display = 'block';
        resBox.style.background = 'rgba(56,189,248,0.1)';
        resBox.style.border = '1px solid rgba(56,189,248,0.3)';
        resBox.style.color = '#38bdf8';
        resBox.innerHTML = '⏳ Importing completed games...';
      }

      const token = getAuthToken();
      let endpoint = '/api/tracker/import/ttb-sync';
      let bodyObj = {};

      if (mode === 'battlebase') {
        endpoint = '/api/tracker/import/battlebase-sync';
        bodyObj = {
          username: (document.getElementById('imp-bb-username')?.value || '').trim(),
          password: (document.getElementById('imp-bb-password')?.value || '').trim()
        };
      } else if (mode === 'newrecruit') {
        endpoint = '/api/tracker/import/newrecruit-sync';
        bodyObj = {
          username: (document.getElementById('imp-nr-username')?.value || '').trim(),
          password: (document.getElementById('imp-nr-password')?.value || '').trim()
        };
      } else if (mode === 'championshub') {
        endpoint = '/api/tracker/import/championshub-sync';
        bodyObj = {
          username: (document.getElementById('imp-ch-username')?.value || '').trim(),
          password: (document.getElementById('imp-ch-password')?.value || '').trim()
        };
      } else if (mode === 'milarki') {
        endpoint = '/api/tracker/import/milarki-sync';
        bodyObj = {
          player_id: (document.getElementById('imp-mlk-player-id')?.value || '').trim(),
          api_key: (document.getElementById('imp-mlk-api-key')?.value || '').trim()
        };
      } else {
        endpoint = '/api/tracker/import/ttb-sync';
        bodyObj = {
          username: (document.getElementById('imp-ttb-email')?.value || '').trim(),
          password: (document.getElementById('imp-ttb-password')?.value || '').trim()
        };
      }

      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify(bodyObj)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) {
          throw new Error(data.detail || data.error || 'Import failed');
        }

        const games = data.games || [];
        if (resBox) {
          resBox.style.background = 'rgba(16,185,129,0.12)';
          resBox.style.border = '1px solid rgba(16,185,129,0.4)';
          resBox.style.color = '#f8fafc';
          resBox.innerHTML = `
            <div style="font-weight:800; color:#34d399; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between;">
              <span>✅ Imported ${games.length} Completed Game${games.length === 1 ? '' : 's'}!</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${games.map(g => {
                const mid = g.match_id || g.id || '';
                const isAosG = (g.game_system === 'aos' || String(mid).startsWith('AOS-'));
                const edLabel = g.edition_label || (isAosG ? 'AoS 4.0' : '40k 10th Ed');
                const sysBadge = `<span style="background:rgba(245,158,11,0.2); color:#fbbf24; font-size:0.65rem; font-weight:800; padding:1px 6px; border-radius:4px;">${escapeHtml(edLabel)}</span>`;
                return `
                  <div style="background:#070b14; border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:8px 12px; display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
                    <div>
                      <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                        ${sysBadge}
                        <b style="font-size:0.82rem; color:#fff;">${escapeHtml(g.p1_name)} (${g.p1_score}) vs ${escapeHtml(g.p2_name)} (${g.p2_score})</b>
                      </div>
                      <div style="font-size:0.7rem; color:#94a3b8; margin-top:2px;">
                        ${escapeHtml(g.p1_faction || 'Army 1')} vs ${escapeHtml(g.p2_faction || 'Army 2')} • 🎯 ${escapeHtml(g.primary_mission || 'Matched Play')}
                      </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px;">
                      <button type="button" onclick="window.openMapGameToEventModal('${escapeHtml(mid)}', '${isAosG ? 'aos' : '40k'}')" style="background:rgba(245,158,11,0.18); border:1px solid rgba(245,158,11,0.45); color:#fbbf24; font-size:0.73rem; font-weight:800; padding:5px 9px; border-radius:6px; cursor:pointer; white-space:nowrap;">
                        🏆 Map to Event
                      </button>
                      <a href="/scorecard/${encodeURIComponent(mid)}" target="_blank" style="background:rgba(16,185,129,0.2); border:1px solid rgba(16,185,129,0.45); color:#34d399; font-size:0.74rem; font-weight:800; padding:5px 10px; border-radius:6px; text-decoration:none; white-space:nowrap;">
                        📄 Open Scorecard ↗
                      </a>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `;
        }

        try {
          originalRemoveItem('my_hub_cache_40k');
          originalRemoveItem('my_hub_cache_aos');
          originalRemoveItem('my_hub_cache');
        } catch (e) {}

        if (typeof window.__refreshTrackerHistoryAfterImport === 'function') {
          await window.__refreshTrackerHistoryAfterImport();
        }
      } catch (err) {
        if (resBox) {
          resBox.style.background = 'rgba(239,68,68,0.14)';
          resBox.style.border = '1px solid rgba(239,68,68,0.4)';
          resBox.style.color = '#f87171';
          resBox.innerHTML = `❌ <b>Import Error:</b> ${escapeHtml(err.message || String(err))}`;
        }
      }
    };

    let _lobbyMappableMatchesCache = [];
    let _lobbyActiveMapMatchId = '';
    let _lobbyActiveMapGameSystem = '40k';
    window.__omniMappableMatchesCacheBySys = window.__omniMappableMatchesCacheBySys || {};
    let _lobbyMappablePrefetchInFlight = {};

    function _namesRoughlyMatchClient(a, b) {
      const na = String(a || '').trim().toLowerCase();
      const nb = String(b || '').trim().toLowerCase();
      if (!na || !nb) return false;
      if (['player 1', 'player 2', 'player1', 'player2', 'you', 'opponent', 'unknown'].includes(na)) return false;
      if (['player 1', 'player 2', 'player1', 'player2', 'you', 'opponent', 'unknown'].includes(nb)) return false;
      if (na === nb) return true;
      const pa = na.split(/\s+/);
      const pb = nb.split(/\s+/);
      if (pa.length >= 2 && pb.length >= 2 && pa[0] === pb[0] && pa[pa.length - 1] === pb[pb.length - 1]) return true;
      if (pa.length === 1 && pb.length >= 1 && pa[0].length >= 3 && pa[0] === pb[0]) return true;
      if (pb.length === 1 && pa.length >= 1 && pb[0].length >= 3 && pb[0] === pa[0]) return true;
      return false;
    }

    function _getCachedMappableMatchesBySys(sys) {
      const s = (sys && String(sys).toLowerCase().includes('aos')) ? 'aos' : '40k';
      if (Array.isArray(window.__omniMappableMatchesCacheBySys[s]) && window.__omniMappableMatchesCacheBySys[s].length > 0) {
        return window.__omniMappableMatchesCacheBySys[s];
      }
      try {
        const raw = originalGetItem('omni_mappable_matches_v1_' + s);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.matches) && (Date.now() - (parsed.ts || 0)) < 600000) {
            window.__omniMappableMatchesCacheBySys[s] = parsed.matches;
            return parsed.matches;
          }
        }
      } catch (e) {}
      return null;
    }

    function _setCachedMappableMatchesBySys(sys, matches) {
      const s = (sys && String(sys).toLowerCase().includes('aos')) ? 'aos' : '40k';
      if (!Array.isArray(matches)) return;
      window.__omniMappableMatchesCacheBySys[s] = matches;
      try {
        originalSetItem('omni_mappable_matches_v1_' + s, JSON.stringify({ ts: Date.now(), matches }));
      } catch (e) {}
    }

    function _scoreLobbyMappableMatches(rawMatches, sourceGame, activeMatchId) {
      if (!Array.isArray(rawMatches)) return [];
      const normMid = String(activeMatchId || '').trim().toUpperCase();
      const sgP1 = sourceGame ? String(sourceGame.p1_name || '') : '';
      const sgP2 = sourceGame ? String(sourceGame.p2_name || '') : '';
      const sgS1 = sourceGame && sourceGame.p1_score != null ? Number(sourceGame.p1_score) : null;
      const sgS2 = sourceGame && sourceGame.p2_score != null ? Number(sourceGame.p2_score) : null;

      const scored = rawMatches.map(m => {
        const copy = Object.assign({}, m);
        const lockedBy = String(copy.locked_by_match_id || '').trim().toUpperCase();
        const isCurr = Boolean(normMid && lockedBy && lockedBy === normMid) || Boolean(copy.is_currently_mapped && (!normMid || lockedBy === normMid));
        copy.is_currently_mapped = isCurr;
        if (isCurr) {
          copy.is_locked = false;
        }
        if (sourceGame) {
          let rel = 0;
          const oppName = copy.opponent_name || (copy.user_slot === 'player1' ? copy.player2_name : copy.player1_name) || '';
          if (_namesRoughlyMatchClient(sgP1, oppName) || _namesRoughlyMatchClient(sgP2, oppName)) {
            rel += 50;
          }
          if (copy.player1_score != null && copy.player2_score != null && sgS1 != null && sgS2 != null) {
            const ev1 = Number(copy.player1_score);
            const ev2 = Number(copy.player2_score);
            if ((ev1 === sgS1 && ev2 === sgS2) || (ev1 === sgS2 && ev2 === sgS1)) {
              rel += 40;
            }
          }
          copy.relevance = rel;
          copy.recommended = rel >= 50;
        }
        return copy;
      });

      scored.sort((a, b) => {
        if (Boolean(a.is_currently_mapped) !== Boolean(b.is_currently_mapped)) {
          return a.is_currently_mapped ? -1 : 1;
        }
        if (Boolean(!a.is_locked) !== Boolean(!b.is_locked)) {
          return !a.is_locked ? -1 : 1;
        }
        return (b.relevance || 0) - (a.relevance || 0);
      });
      return scored;
    }

    window.__prefetchLobbyMappableEventMatches = async function(gameSystem) {
      const s = (gameSystem && String(gameSystem).toLowerCase().includes('aos')) ? 'aos' : '40k';
      if (_lobbyMappablePrefetchInFlight[s]) return _lobbyMappablePrefetchInFlight[s];
      const tok = originalGetItem('native_session_token') || originalGetItem('elo_auth_token') || originalGetItem('omnitactica_id_token') || originalGetItem('firebase_id_token') || '';
      if (!tok && !window.location.search.includes('mock_persona')) return null;
      _lobbyMappablePrefetchInFlight[s] = (async () => {
        try {
          const headers = tok ? { 'Authorization': 'Bearer ' + tok } : {};
          const resp = await fetch(`/api/tracker/mappable_event_matches?game_system=${encodeURIComponent(s)}`, { headers });
          if (resp.ok) {
            const data = await resp.json().catch(() => ({}));
            if (data && Array.isArray(data.matches)) {
              _setCachedMappableMatchesBySys(s, data.matches);
            }
          }
        } catch (e) {
        } finally {
          _lobbyMappablePrefetchInFlight[s] = null;
        }
      })();
      return _lobbyMappablePrefetchInFlight[s];
    };

    function _findLobbySourceGame(matchId) {
      const target = String(matchId || '').trim().toUpperCase();
      if (!target) return null;
      const pools = [
        ...(Array.isArray(window.gtCompletedHistory) ? window.gtCompletedHistory : []),
        ...(Array.isArray(dbHistoryCache) ? dbHistoryCache : [])
      ];
      for (const item of pools) {
        if (!item) continue;
        const mid = String(item.match_id || item.id || '').trim().toUpperCase();
        if (mid === target) {
          return {
            match_id: item.match_id || item.id || matchId,
            p1_name: item.p1_name || item.game?.p1Name || 'Player 1',
            p2_name: item.p2_name || item.game?.p2Name || 'Player 2',
            p1_faction: item.p1_faction || item.game?.p1Faction || 'Army 1',
            p2_faction: item.p2_faction || item.game?.p2Faction || 'Army 2',
            p1_score: item.p1_score ?? item.p1Score ?? 0,
            p2_score: item.p2_score ?? item.p2Score ?? 0,
            primary_mission: item.primary_mission || item.game?.primary || ''
          };
        }
      }
      return null;
    }

    function _renderLobbyMapSourceBanner(sg) {
      const bannerEl = document.getElementById('omni-map-source-banner');
      if (!bannerEl) return;
      if (!sg) {
        bannerEl.innerHTML = '';
        return;
      }
      const p1Name = sg.p1_name || 'Player 1';
      const p2Name = sg.p2_name || 'Player 2';
      const p1Fac = sg.p1_faction || 'Army 1';
      const p2Fac = sg.p2_faction || 'Army 2';
      const p1Score = sg.p1_score ?? 0;
      const p2Score = sg.p2_score ?? 0;
      const mission = sg.primary_mission || '';

      bannerEl.innerHTML = `
        <div style="background:linear-gradient(135deg, rgba(15,23,42,0.96) 0%, rgba(30,41,59,0.92) 100%); border:1px solid rgba(245,158,11,0.45); border-radius:12px; padding:0.75rem 1rem; margin-bottom:0.85rem; box-shadow:0 8px 20px rgba(0,0,0,0.35);">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.45rem; flex-wrap:wrap;">
            <span style="font-size:0.68rem; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; color:#fbbf24;">📋 Scorecard Being Mapped</span>
            <span style="font-size:0.7rem; color:#94a3b8; font-family:monospace;">${escapeHtml(mission)}</span>
          </div>
          <div style="display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:0.75rem;">
            <div style="min-width:0;">
              <div style="font-size:0.9rem; font-weight:800; color:#38bdf8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">🟦 ${escapeHtml(p1Name)}</div>
              <div style="font-size:0.72rem; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(p1Fac)}</div>
            </div>
            <div style="background:#020617; border:1px solid #334155; border-radius:10px; padding:0.28rem 0.75rem; font-family:'JetBrains Mono',monospace; font-size:1.05rem; font-weight:900; color:#fff; white-space:nowrap; box-shadow:inset 0 2px 6px rgba(0,0,0,0.5);">
              <span style="color:#38bdf8;">${p1Score}</span> <span style="color:#64748b; font-weight:600;">-</span> <span style="color:#f43f5e;">${p2Score}</span>
            </div>
            <div style="min-width:0; text-align:right;">
              <div style="font-size:0.9rem; font-weight:800; color:#f43f5e; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">🟥 ${escapeHtml(p2Name)}</div>
              <div style="font-size:0.72rem; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(p2Fac)}</div>
            </div>
          </div>
        </div>
      `;
    }

    if (typeof window.openMapGameToEventModal !== 'function') {
      window.openMapGameToEventModal = async function(matchId, gameSystem) {
        _lobbyActiveMapMatchId = matchId || '';
        _lobbyActiveMapGameSystem = gameSystem || (String(matchId || '').startsWith('AOS-') || window.location.pathname.includes('/aos') ? 'aos' : '40k');

        let modal = document.getElementById('omni-map-game-event-modal');
        if (!modal) {
          modal = document.createElement('div');
          modal.id = 'omni-map-game-event-modal';
          modal.style.cssText = 'position:fixed; inset:0; background:rgba(2,6,23,0.85); backdrop-filter:blur(8px); z-index:100005; display:none; align-items:center; justify-content:center; padding:1rem; box-sizing:border-box;';
          document.body.appendChild(modal);
        }

        modal.innerHTML = `
          <div style="background:#0f172a; border:1px solid #334155; border-radius:16px; max-width:580px; width:100%; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 25px 65px rgba(0,0,0,0.8); overflow:hidden; font-family:'Inter',system-ui,sans-serif; color:#f8fafc;">
            <div style="padding:0.9rem 1.25rem; background:#1e293b; border-bottom:1px solid #334155; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div style="font-weight:800; font-size:1.02rem; color:#fff;">🏆 Map Scorecard to Tournament Match</div>
              </div>
              <button type="button" onclick="document.getElementById('omni-map-game-event-modal').style.display='none'" style="background:transparent; border:none; color:#94a3b8; font-size:1.25rem; cursor:pointer;">✕</button>
            </div>
            <div style="padding:1.1rem 1.25rem; overflow-y:auto; flex:1;">
              <div id="omni-map-source-banner"></div>
              <div style="font-size:0.78rem; color:#cbd5e1; line-height:1.45; margin-bottom:0.85rem; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.25); padding:0.65rem 0.85rem; border-radius:10px;">
                🔒 <b>Participant-Only &amp; Auto-Aligned:</b> You can only map a scorecard to a tournament pairing you participated in. Player 1 and Player 2 columns are automatically aligned to the official pairing and locked once mapped.
              </div>
              <div style="display:flex; gap:0.5rem; margin-bottom:0.85rem;">
                <input id="omni-map-event-search" type="text" placeholder="Search event name or opponent..." style="flex:1; background:#020617; border:1px solid #334155; color:#fff; padding:0.55rem 0.75rem; border-radius:8px; font-size:0.84rem;" oninput="window.__filterLobbyMappableEventMatches()">
              </div>
              <div id="omni-map-event-status" style="display:none; margin-bottom:0.75rem; padding:0.6rem 0.85rem; border-radius:8px; font-size:0.8rem;"></div>
              <div id="omni-map-event-list" style="display:flex; flex-direction:column; gap:0.55rem;">
                <div style="padding:1.5rem; text-align:center; color:#94a3b8; font-size:0.84rem;">Loading your verified tournament matches...</div>
              </div>
            </div>
          </div>
        `;
        modal.style.display = 'flex';
        const localSg = _findLobbySourceGame(_lobbyActiveMapMatchId);
        _renderLobbyMapSourceBanner(localSg);

        // Instant (0ms) render from prefetched/cached tournament matches if available
        const cachedList = _getCachedMappableMatchesBySys(_lobbyActiveMapGameSystem);
        const hadInstantRender = Boolean(cachedList && cachedList.length > 0);
        if (hadInstantRender) {
          _lobbyMappableMatchesCache = _scoreLobbyMappableMatches(cachedList, localSg, _lobbyActiveMapMatchId);
          window.__renderLobbyMappableEventMatches(_lobbyMappableMatchesCache);
        }

        try {
          const tok = originalGetItem('native_session_token') || originalGetItem('elo_auth_token') || originalGetItem('omnitactica_id_token') || originalGetItem('firebase_id_token') || '';
          const headers = tok ? { 'Authorization': 'Bearer ' + tok } : {};
          const resp = await fetch(`/api/tracker/mappable_event_matches?game_system=${encodeURIComponent(_lobbyActiveMapGameSystem)}&match_id=${encodeURIComponent(_lobbyActiveMapMatchId)}`, { headers });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            if (!hadInstantRender) {
              throw new Error(data.detail || 'Please sign in to map scorecards to your tournament matches.');
            }
            return;
          }
          if (data.source_game) _renderLobbyMapSourceBanner(data.source_game);
          const freshMatches = data.matches || [];
          _setCachedMappableMatchesBySys(_lobbyActiveMapGameSystem, freshMatches);
          _lobbyMappableMatchesCache = _scoreLobbyMappableMatches(freshMatches, data.source_game || localSg, _lobbyActiveMapMatchId);
          window.__filterLobbyMappableEventMatches();
        } catch (err) {
          if (!hadInstantRender) {
            const listEl = document.getElementById('omni-map-event-list');
            if (listEl) {
              listEl.innerHTML = `<div style="padding:1.25rem; text-align:center; color:#fca5a5; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:10px; font-size:0.82rem;">⚠️ ${escapeHtml(err.message)}</div>`;
            }
          }
        }
      };

      window.__filterLobbyMappableEventMatches = function() {
        const q = (document.getElementById('omni-map-event-search')?.value || '').toLowerCase().trim();
        if (!q) {
          window.__renderLobbyMappableEventMatches(_lobbyMappableMatchesCache);
          return;
        }
        const filtered = _lobbyMappableMatchesCache.filter(m =>
          String(m.event_name || '').toLowerCase().includes(q) ||
          String(m.event_id || '').toLowerCase().includes(q) ||
          String(m.player1_name || '').toLowerCase().includes(q) ||
          String(m.player2_name || '').toLowerCase().includes(q)
        );
        window.__renderLobbyMappableEventMatches(filtered);
      };

      window.__renderLobbyMappableEventMatches = function(matches) {
        const listEl = document.getElementById('omni-map-event-list');
        if (!listEl) return;
        if (!matches || matches.length === 0) {
          listEl.innerHTML = '<div style="padding:1.5rem; text-align:center; color:#94a3b8; font-size:0.84rem;">No eligible tournament matches found for your player profile.</div>';
          return;
        }
        listEl.innerHTML = matches.map(m => {
          const isLocked = Boolean(m.is_locked);
          const recBadge = m.recommended ? '<span style="background:rgba(16,185,129,0.18); color:#34d399; border:1px solid rgba(16,185,129,0.4); font-size:0.68rem; font-weight:800; padding:1px 6px; border-radius:4px;">★ Recommended Pairing</span>' : '';
          const actionHtml = isLocked
            ? '<span style="background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.35); font-size:0.7rem; font-weight:800; padding:4px 8px; border-radius:6px;">🔒 Locked</span>'
            : `<button type="button" onclick="window.__confirmMapGameToEventFromLobby('${escapeHtml(m.event_id)}', ${Number(m.round || 1)}, ${m.table_number ? Number(m.table_number) : 'null'})" style="background:#0284c7; border:1px solid #38bdf8; color:#fff; font-weight:800; font-size:0.75rem; padding:5px 10px; border-radius:7px; cursor:pointer;">🔗 Map &amp; Lock</button>`;
          return `
            <div style="background:#090f1e; border:1px solid ${m.recommended ? '#10b981' : '#1e293b'}; border-radius:10px; padding:0.75rem 0.9rem; display:flex; justify-content:space-between; align-items:center; gap:0.75rem;">
              <div style="min-width:0;">
                <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                  <span style="font-weight:800; color:#f8fafc; font-size:0.86rem;">🏆 ${escapeHtml(m.event_name || m.event_id)}</span>
                  <span style="font-family:monospace; font-size:0.74rem; color:#38bdf8;">R${m.round || 1}${m.table_number ? ' • T' + m.table_number : ''}</span>
                  ${recBadge}
                </div>
                <div style="font-size:0.78rem; color:#cbd5e1; margin-top:0.22rem;">
                  🟦 ${escapeHtml(m.player1_name)} (${m.player1_score ?? '-'}) <span style="color:#64748b;">vs</span> 🟥 ${escapeHtml(m.player2_name)} (${m.player2_score ?? '-'})
                </div>
                <div style="font-size:0.7rem; color:#64748b; margin-top:0.15rem;">
                  📅 ${m.match_date ? new Date(m.match_date).toLocaleDateString() : '-'}
                </div>
              </div>
              <div style="flex-shrink:0;">
                ${actionHtml}
              </div>
            </div>
          `;
        }).join('');
      };

      window.__confirmMapGameToEventFromLobby = async function(eventId, roundNum, tableNum) {
        const statusEl = document.getElementById('omni-map-event-status');
        try {
          const tok = originalGetItem('native_session_token') || originalGetItem('elo_auth_token') || originalGetItem('omnitactica_id_token') || originalGetItem('firebase_id_token') || '';
          const headers = Object.assign({ 'Content-Type': 'application/json' }, tok ? { 'Authorization': 'Bearer ' + tok } : {});
          const resp = await fetch(`/api/tracker/games/${encodeURIComponent(_lobbyActiveMapMatchId)}/map_event_match`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ event_id: eventId, round_num: roundNum, table_num: tableNum })
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            throw new Error(data.detail || resp.statusText);
          }
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.background = 'rgba(16,185,129,0.15)';
            statusEl.style.border = '1px solid rgba(16,185,129,0.4)';
            statusEl.style.color = '#34d399';
            statusEl.innerHTML = `✅ Mapped &amp; locked to <b>${escapeHtml(data.event_name || eventId)}</b> (Round ${roundNum}${tableNum ? ' • Table ' + tableNum : ''})${data.swapped_p1_p2 ? ' • Auto-aligned Player 1 / Player 2 columns!' : '!'}`;
          }
          // Update local mappable matches cache immediately so the pairing shows as locked
          const cachedSys = _getCachedMappableMatchesBySys(_lobbyActiveMapGameSystem);
          if (Array.isArray(cachedSys)) {
            const updatedSys = cachedSys.map(item => {
              if (String(item.event_id || '').toLowerCase() === String(eventId || '').toLowerCase() && Number(item.round || item.round_num || 1) === Number(roundNum || 1) && Number(item.table_number || item.table_num || 1) === Number(tableNum || 1)) {
                return Object.assign({}, item, { is_locked: true, locked_by_match_id: _lobbyActiveMapMatchId });
              }
              return item;
            });
            _setCachedMappableMatchesBySys(_lobbyActiveMapGameSystem, updatedSys);
          }
          try {
            originalRemoveItem('my_hub_cache_40k');
            originalRemoveItem('my_hub_cache_aos');
            originalRemoveItem('my_hub_cache');
          } catch (e) {}
          if (typeof window.__refreshTrackerHistoryAfterImport === 'function') {
            await window.__refreshTrackerHistoryAfterImport();
          }
          setTimeout(() => {
            const modal = document.getElementById('omni-map-game-event-modal');
            if (modal) modal.style.display = 'none';
          }, 1100);
        } catch (err) {
          if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.background = 'rgba(239,68,68,0.14)';
            statusEl.style.border = '1px solid rgba(239,68,68,0.4)';
            statusEl.style.color = '#f87171';
            statusEl.innerHTML = `⚠️ ${escapeHtml(err.message)}`;
          }
        }
      };
    }
  }

  // Real-time Armory Dice Skin Sync Listener
  if (typeof window !== 'undefined') {
    window.addEventListener('omnitactica:armory-loadout-changed', function(e) {
      if (typeof renderDiceRollerContent === 'function') {
        renderDiceRollerContent();
      }
    });
    window.addEventListener('storage', function(e) {
      if (e.key === 'omnitactica_active_dice_40k' || e.key === 'omnitactica_active_dice') {
        if (typeof renderDiceRollerContent === 'function') {
          renderDiceRollerContent();
        }
      }
    });
  }

  // Hook into startup
  const origInit = init;
  init = async function() {
    await origInit();
    startGlobalActiveAnnouncementPoll();
    setTimeout(loadRoomArmyLists, 100);
    if (window.Armory && typeof window.Armory.loadArmoryData === 'function') {
      window.Armory.loadArmoryData('40k').then(function() {
        if (typeof renderDiceRollerContent === 'function') {
          renderDiceRollerContent();
        }
      });
    }
  };

  // Auto-init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
