/**
 * Event Studio | Tournament Director & BCP Organizer Suite (v15.0)
 * Comprehensive tournament directorship: creation, Swiss pairings, live rosters,
 * scorecards, tiebreakers, and Best Coast Pairings bidirectional sync.
 */

let studioState = {
  activeTab: "events",
  eventsList: [],
  activeTournament: null,
  activeSubtab: "roster",
  currentRoundView: 1,
  timerSeconds: 9000,
  timerInterval: null,
  isTimerRunning: false,
  masterClockTargetEnd: null,
  masterClockStatus: 'stopped',
  tournamentUnsub: null,
  judgeCallsUnsub: null,
  judgeCalls: [],
  resolvedJudgeCalls: [],
  judgeAudioEnabled: (typeof localStorage !== 'undefined' ? localStorage.getItem('studio_judge_audio') : 'true') !== 'false'
};

function getStudioFirestoreDb() {
  if (typeof firebase !== 'undefined' && firebase.firestore) {
    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp({ projectId: "eloranking-506820" });
      }
      return firebase.firestore();
    } catch (e) {
      console.warn("Notice initializing Firestore for Event Studio:", e);
    }
  }
  return null;
}

document.addEventListener("DOMContentLoaded", () => {
  setDefaultEventDates();
  if (typeof activeTab !== 'undefined' && activeTab === 'event-studio') {
    initStudio();
  }
});

function getBcpToken() {
  const tok = localStorage.getItem("bcp_jwt") || 
              localStorage.getItem("bcp_token") || 
              localStorage.getItem("bcp_organizer_token") || 
              localStorage.getItem("bcp_user_token") || "";
  return (tok && tok.split(".").length === 3) ? tok : "";
}

async function initStudio() {
  updateStudioAuthBadge();
  setDefaultEventDates();
  
  let user = typeof currentUser !== "undefined" ? currentUser : null;
  const userRole = ((user && user.role) ? user.role : 'player').toLowerCase();
  const canAccessTO = Boolean(user && (userRole === 'admin' || userRole === 'to' || userRole === 'organizer' || userRole === 'referee' || user.is_admin || (typeof isUserTO === 'function' && isUserTO(user))));

  if (canAccessTO) {
    await loadStudioEvents();
    startStudioPolling();
  }
}

function setDefaultEventDates() {
  const today = new Date().toISOString().split("T")[0];
  const startInput = document.getElementById("create-event-start-date");
  const endInput = document.getElementById("create-event-end-date");
  if (startInput && !startInput.value) startInput.value = today;
  if (endInput && !endInput.value) endInput.value = today;
}

function updateStudioAuthBadge() {
  const banner = document.getElementById("es-bcp-account-banner");
  const dot = document.getElementById("es-bcp-status-dot");
  const statusText = document.getElementById("es-bcp-status-text");
  
  let user = typeof currentUser !== "undefined" ? currentUser : null;
  if (!user) {
    try {
      const cached = localStorage.getItem("native_user_profile") || localStorage.getItem("bcp_user_profile");
      if (cached) user = JSON.parse(cached);
    } catch(e) {}
  }

  const token = getBcpToken();
  const isBcpConnected = !!((user && (user.bcp_connected || user.bcp_user_id || user.bcp_email)) || (token && token.length > 20));
  studioState.bcpConnected = isBcpConnected;

  // Toggle locked gate vs tournament directory/management views
  const lockedGates = document.querySelectorAll("#es-locked-gate");
  const mainViews = document.querySelectorAll("#es-view-events, #es-view-create, #es-view-manage");
  const headerCreateBtns = document.querySelectorAll("#btn-sync-bcp-events, .es-create-tourney-btn");

  const isLoggedIn = !!(user || (token && token.length > 20) || (typeof API !== 'undefined' && API.getAuthToken()));
  const userRole = ((user && user.role) ? user.role : 'player').toLowerCase();
  const isSuperAdmin = Boolean(user && (user.role === 'admin' || user.is_superadmin || user.is_admin));
  const isTO = isSuperAdmin || userRole === 'admin' || userRole === 'to' || userRole === 'organizer' || userRole === 'referee' || Boolean(user && user.can_access_to);

  if (!isLoggedIn) {
    lockedGates.forEach(g => {
      g.style.display = "block";
      g.innerHTML = `
        <div style="font-size: 3rem; margin-bottom: 0.75rem;">🔑</div>
        <h3 style="color: #fff; font-size: 1.35rem; margin: 0 0 0.5rem; font-family: var(--font-heading);">Sign In to OmniTactica</h3>
        <p style="color: var(--text-secondary); font-size: 0.88rem; line-height: 1.6; max-width: 480px; margin: 0 auto 1.5rem;">
          Event Studio is the dedicated Tournament Director suite. Please sign in or create an account to organize tournaments, manage competitor rosters, generate Swiss pairings, and sync match scores.
        </p>
        <div style="display: flex; justify-content: center; gap: 0.75rem; flex-wrap: wrap;">
          <a href="/login?redirect=%2F%23event-studio" class="btn btn-primary" style="font-size: 0.88rem; padding: 0.55rem 1.25rem;">🔑 Sign In / Register</a>
          <button class="btn btn-outline" style="font-size: 0.88rem; padding: 0.55rem 1.15rem;" onclick="typeof switchTab === 'function' ? switchTab('community') : window.location.href='/#community'">👥 Explore Community Hub</button>
        </div>
      `;
    });
    mainViews.forEach(v => { v.style.display = "none"; });
    headerCreateBtns.forEach(b => {
      b.disabled = true;
      b.style.opacity = "0.5";
      b.style.cursor = "not-allowed";
    });
  } else if (!isTO) {
    // User is signed in as standard player without TO permissions
    lockedGates.forEach(g => {
      g.style.display = "block";
      g.innerHTML = `
        <div style="font-size: 3rem; margin-bottom: 0.75rem;">🛡️</div>
        <h3 style="color: #fff; font-size: 1.35rem; margin: 0 0 0.5rem; font-family: var(--font-heading);">Tournament Organizer Access Required</h3>
        <p style="color: var(--text-secondary); font-size: 0.88rem; line-height: 1.6; max-width: 480px; margin: 0 auto 1.25rem;">
          Event Studio is restricted to certified Tournament Organizers and Platform Admins. Your account currently holds the <strong style="color: #38bdf8;">Player</strong> role.
        </p>
        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; text-align: left; font-size: 0.84rem; color: #94a3b8; max-width: 480px; margin-left: auto; margin-right: auto;">
          <div style="font-weight: 700; color: #cbd5e1; margin-bottom: 0.4rem;">Are you a Tournament Organizer?</div>
          <div>If you host local RTTs, Grand Tournaments, or game store leagues, request TO verification to unlock event creation, Swiss pairings, and BCP sync.</div>
        </div>
        <div style="display: flex; justify-content: center; gap: 0.75rem; flex-wrap: wrap;">
          <button class="btn btn-primary" style="font-size: 0.88rem; padding: 0.55rem 1.25rem;" onclick="openRequestToModal()">📝 Request TO Verification</button>
          <button class="btn btn-outline" style="font-size: 0.88rem; padding: 0.55rem 1.15rem;" onclick="typeof switchTab === 'function' ? switchTab('community') : window.location.href='/#community'">👥 Explore Community Hub</button>
        </div>
      `;
    });
    mainViews.forEach(v => { v.style.display = "none"; });
    headerCreateBtns.forEach(b => {
      b.disabled = true;
      b.style.opacity = "0.5";
      b.style.cursor = "not-allowed";
    });
  } else {
    // Certified TO or Admin
    lockedGates.forEach(g => { g.style.display = "none"; });
    headerCreateBtns.forEach(b => {
      b.disabled = false;
      b.style.opacity = "1";
      b.style.cursor = "pointer";
    });
    // If on events tab or unselected, show events directory
    if (studioState.activeTab === 'events' || !studioState.activeTab) {
      const evView = document.getElementById("es-view-events");
      if (evView) evView.style.display = "block";
    }
  }

  if (statusText) {
    if (isBcpConnected && isTO) {
      const email = (user && (user.bcp_email || user.email || user.display_name)) || "BCP Organizer";
      if (banner) {
        banner.style.background = "rgba(16, 185, 129, 0.08)";
        banner.style.borderColor = "rgba(16, 185, 129, 0.25)";
      }
      if (dot) {
        dot.style.background = "#10b981";
        dot.style.boxShadow = "0 0 8px #10b981";
      }
      statusText.innerHTML = `Connected to Best Coast Pairings as <strong style="color: #10b981;">${escapeHtml(email)}</strong> (${userRole.toUpperCase()})`;
    } else if (user && !isTO) {
      if (banner) {
        banner.style.background = "rgba(239, 68, 68, 0.08)";
        banner.style.borderColor = "rgba(239, 68, 68, 0.25)";
      }
      if (dot) {
        dot.style.background = "#ef4444";
        dot.style.boxShadow = "none";
      }
      statusText.innerHTML = `Signed in as <strong style="color: #38bdf8;">${escapeHtml(user.display_name || user.email)}</strong> (${userRole.toUpperCase()}) — <a href="javascript:void(0)" onclick="openRequestToModal()" style="color: #f59e0b; text-decoration: underline; font-weight: 600;">Request TO Verification</a>`;
    } else if (user) {
      if (banner) {
        banner.style.background = "rgba(245, 158, 11, 0.08)";
        banner.style.borderColor = "rgba(245, 158, 11, 0.25)";
      }
      if (dot) {
        dot.style.background = "#f59e0b";
        dot.style.boxShadow = "none";
      }
      statusText.innerHTML = `Signed in as <strong style="color: #38bdf8;">${escapeHtml(user.display_name || user.email)}</strong> (${userRole.toUpperCase()}) — <a href="javascript:void(0)" onclick="openBcpLinkModal()" style="color: #f59e0b; text-decoration: underline; font-weight: 600;">Link BCP Account</a> to unlock Event Studio`;
    } else {
      if (banner) {
        banner.style.background = "rgba(56, 189, 248, 0.05)";
        banner.style.borderColor = "rgba(56, 189, 248, 0.2)";
      }
      if (dot) {
        dot.style.background = "#94a3b8";
        dot.style.boxShadow = "none";
      }
      statusText.innerHTML = `<span style="color: #94a3b8;">Guest Mode</span> — <a href="/login?redirect=%2F%23event-studio" style="color: #38bdf8; text-decoration: underline; font-weight: 600;">Sign In</a> to unlock Event Studio`;
    }
  }
}

function openRequestToModal() {
  const modal = document.getElementById("request-to-modal");
  if (modal) {
    modal.classList.add("active");
    const statusDiv = document.getElementById("req-to-status");
    if (statusDiv) statusDiv.style.display = "none";
  }
}

function closeRequestToModal() {
  const modal = document.getElementById("request-to-modal");
  if (modal) modal.classList.remove("active");
}

async function submitRequestTo(e) {
  if (e) e.preventDefault();
  const orgInput = document.getElementById("req-to-org");
  const venueInput = document.getElementById("req-to-venue");
  const detailsInput = document.getElementById("req-to-details");
  const statusDiv = document.getElementById("req-to-status");
  const submitBtn = document.getElementById("req-to-submit-btn");

  const org = orgInput ? orgInput.value.trim() : "";
  const venue = venueInput ? venueInput.value.trim() : "";
  const details = detailsInput ? detailsInput.value.trim() : "";

  if (!org || !venue) {
    if (statusDiv) {
      statusDiv.textContent = "Please provide your organization/club name and venue location.";
      statusDiv.style.display = "block";
      statusDiv.style.background = "rgba(239,68,68,0.15)";
      statusDiv.style.color = "#ef4444";
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting application...";
  }

  try {
    const res = await API.requestToStatus(org, venue, details);
    if (res && res.success) {
      if (statusDiv) {
        statusDiv.textContent = "🎉 Application submitted successfully! An administrator will review your TO request shortly.";
        statusDiv.style.display = "block";
        statusDiv.style.background = "rgba(16,185,129,0.15)";
        statusDiv.style.color = "#10b981";
      }
      setTimeout(() => {
        closeRequestToModal();
      }, 2000);
    } else {
      if (statusDiv) {
        statusDiv.textContent = res?.error || "Failed to submit request. Please try again.";
        statusDiv.style.display = "block";
        statusDiv.style.background = "rgba(239,68,68,0.15)";
        statusDiv.style.color = "#ef4444";
      }
    }
  } catch (err) {
    if (statusDiv) {
      statusDiv.textContent = err.message || "Network error submitting request.";
      statusDiv.style.display = "block";
      statusDiv.style.background = "rgba(239,68,68,0.15)";
      statusDiv.style.color = "#ef4444";
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Application";
    }
  }
}

async function syncBcpOrganizerEvents() {
  const btns = document.querySelectorAll("#btn-sync-bcp-events");
  btns.forEach(b => {
    b.disabled = true;
    b.textContent = "🔄 Syncing with BCP...";
  });

  try {
    const res = await window.api.getStudioEvents();
    studioState.eventsList = (res && Array.isArray(res.events)) ? res.events : [];
    
    renderEventsDirectory();
    if (typeof loadTournaments === 'function') {
      try { loadTournaments(); } catch(e) {}
    }

    const unlinkedEvents = studioState.eventsList.filter(e => e.bcp_status === "deleted_on_bcp");
    const activeBcpEvents = studioState.eventsList.filter(e => e.id && !e.id.startsWith("ES-") && e.bcp_status !== "deleted_on_bcp");
    
    if (unlinkedEvents.length > 0) {
      alert(`🔄 BCP Sync Complete!\n\n• ${activeBcpEvents.length} active tournament(s) synced with Best Coast Pairings.\n• ⚠️ ${unlinkedEvents.length} tournament(s) were removed on BCP and are now marked as "Unlinked from BCP (Local Only)" in OmniTactica.`);
    } else if (activeBcpEvents.length > 0) {
      alert(`🎉 Synced with Best Coast Pairings! Loaded ${activeBcpEvents.length} active BCP tournament${activeBcpEvents.length === 1 ? '' : 's'}.`);
    } else {
      alert("✅ Sync complete! Your tournament directory is up to date.");
    }
  } catch (err) {
    console.warn("Notice syncing BCP events:", err);
    await loadStudioEvents();
  } finally {
    btns.forEach(b => {
      b.disabled = false;
      b.textContent = "🔄 Sync BCP Events";
    });
  }
}

async function refreshStudioEvents(btn) {
  const refreshBtns = btn ? [btn] : document.querySelectorAll("#btn-refresh-managed-tournaments");
  refreshBtns.forEach(b => {
    b.disabled = true;
    b.innerHTML = '<span class="refresh-icon spinning" style="display:inline-block;">🔄</span> Refreshing...';
  });

  try {
    await loadStudioEvents();
  } catch (err) {
    console.warn("Notice refreshing managed tournaments:", err);
  } finally {
    refreshBtns.forEach(b => {
      b.disabled = false;
      b.innerHTML = '<span class="refresh-icon" style="display:inline-block;">🔄</span> Refresh';
    });
  }
}

async function refreshTournamentWorkspace(btn) {
  const ev = studioState.activeTournament;
  if (!ev || !ev.id) return;
  const refreshBtns = btn ? [btn] : document.querySelectorAll("#btn-refresh-tournament-workspace");
  refreshBtns.forEach(b => {
    b.disabled = true;
    b.innerHTML = '<span class="refresh-icon spinning" style="display:inline-block;">🔄</span> Refreshing...';
  });
  try {
    await loadTournamentWorkspace(ev.id);
  } catch (err) {
    console.warn("Notice refreshing tournament workspace:", err);
  } finally {
    refreshBtns.forEach(b => {
      b.disabled = false;
      b.innerHTML = '<span class="refresh-icon" style="display:inline-block;">🔄</span> Refresh Live';
    });
  }
}

let studioPollTimer = null;
let studioIsPolling = false;
let studioWorkspacePollTick = 0;

function isAnyStudioModalOpen() {
  const modalIds = [
    'modal-swap-players',
    'modal-add-player',
    'modal-studio-broadcast',
    'modal-tournament-register',
    'request-to-modal',
    'bcp-link-modal',
    'edit-tournament-modal'
  ];
  for (const id of modalIds) {
    const el = document.getElementById(id);
    if (el && (el.classList.contains('active') || (el.style.display && el.style.display !== 'none'))) {
      return true;
    }
  }
  return false;
}

function flashLiveSyncIndicator() {
  const dots = document.querySelectorAll("#studio-live-sync-dot");
  dots.forEach(dot => {
    dot.style.transform = "scale(1.4)";
    dot.style.background = "#34d399";
    dot.style.boxShadow = "0 0 10px #34d399";
    setTimeout(() => {
      dot.style.transform = "scale(1)";
      dot.style.background = "#10b981";
      dot.style.boxShadow = "0 0 6px #10b981";
    }, 600);
  });
}

async function pollTournamentWorkspaceQuietly(eventId) {
  if (studioIsPolling || !eventId) return;
  studioIsPolling = true;
  studioWorkspacePollTick += 1;
  try {
    const ev = studioState.activeTournament;
    if (!ev || ev.id !== eventId) return;

    const currentRound = studioState.currentRoundView || ev.current_round || 1;
    const isPairingsSubtab = studioState.activeSubtab === "pairings";

    // Fast-path: When viewing Pairings subtab, perform lightweight single-call for active round
    if (isPairingsSubtab && window.api && typeof window.api.getStudioRoundPairings === "function" && (studioWorkspacePollTick % 4 !== 0)) {
      try {
        const pRes = await window.api.getStudioRoundPairings(eventId, currentRound);
        if (pRes && pRes.success && Array.isArray(pRes.pairings)) {
          if (!studioState.activeTournament.pairings) {
            studioState.activeTournament.pairings = {};
          }
          studioState.activeTournament.pairings[String(currentRound)] = pRes.pairings;
          flashLiveSyncIndicator();

          const activeEl = document.activeElement;
          const isTypingScore = activeEl && activeEl.id && activeEl.id.startsWith("score-");
          if (!isAnyStudioModalOpen() && !isTypingScore) {
            renderPairingsSubtab();
          }
        }
      } catch (pErr) {
        console.debug("Notice during round pairings quiet poll:", pErr);
      }
    } else {
      // Full event workspace poll (syncs roster, check-ins, drops, metadata, and all rounds)
      const res = await window.api.getStudioEvent(eventId);
      const updatedEv = (res && res.event) ? res.event : res;
      if (!updatedEv || !updatedEv.id || updatedEv.id !== studioState.activeTournament?.id) return;

      flashLiveSyncIndicator();
      studioState.activeTournament = updatedEv;

      // Header updates
      const nameEl = document.getElementById("manage-event-name");
      const dateEl = document.getElementById("manage-event-date");
      const locEl = document.getElementById("manage-event-location");
      const roundsPtsEl = document.getElementById("manage-event-rounds-pts");
      const rosterCountEl = document.getElementById("manage-roster-count");

      if (nameEl && updatedEv.name) nameEl.textContent = updatedEv.name;
      const dateStr = updatedEv.event_date ? (String(updatedEv.event_date).split("T")[0]) : "Date TBD";
      const locStr = [updatedEv.venue, updatedEv.city, updatedEv.state].filter(Boolean).join(", ") || "Local Venue";
      const rounds = updatedEv.num_rounds || updatedEv.rounds || 5;
      const pts = updatedEv.points || 2000;
      if (dateEl) dateEl.textContent = dateStr;
      if (locEl) locEl.textContent = locStr;
      if (roundsPtsEl) roundsPtsEl.textContent = `${rounds} Rounds (${pts} pts)`;

      const roster = updatedEv.roster || [];
      if (rosterCountEl) rosterCountEl.textContent = roster.length;

      // Lifecycle badge
      const isEnded = Boolean(updatedEv.is_ended || updatedEv.isEnded);
      const isStarted = Boolean(updatedEv.started || (updatedEv.status === "active") || (updatedEv.current_round && updatedEv.current_round > 1));
      const statusBadges = document.querySelectorAll("#manage-event-status-badge");
      statusBadges.forEach(badge => {
        badge.style.display = "inline-block";
        if (isEnded) {
          badge.className = "badge";
          badge.style.background = "rgba(239, 68, 68, 0.15)";
          badge.style.color = "#f87171";
          badge.style.borderColor = "rgba(239, 68, 68, 0.35)";
          badge.textContent = "🔴 CONCLUDED";
        } else if (isStarted) {
          badge.className = "badge badge-online";
          badge.style.background = "";
          badge.style.color = "";
          badge.style.borderColor = "";
          badge.textContent = `🟢 IN PROGRESS • ROUND ${updatedEv.current_round || 1}`;
        } else {
          badge.className = "badge";
          badge.style.background = "rgba(234, 179, 8, 0.15)";
          badge.style.color = "#facc15";
          badge.style.borderColor = "rgba(234, 179, 8, 0.35)";
          badge.textContent = "🟡 REGISTRATION OPEN";
        }
      });

      const startBtns = document.querySelectorAll("#manage-event-start-btn");
      startBtns.forEach(btn => {
        btn.style.display = (!isStarted && !isEnded) ? "inline-flex" : "none";
      });

      const bcpLinks = document.querySelectorAll("#manage-event-bcp-link");
      const isBcp = updatedEv.id && !String(updatedEv.id).startsWith("ES-");
      const isDeletedOnBcp = updatedEv.bcp_status === "deleted_on_bcp" || updatedEv.bcp_deleted === true;
      bcpLinks.forEach(bLink => {
        if (isDeletedOnBcp || !isBcp) {
          bLink.style.display = "none";
        } else {
          bLink.style.display = "inline-flex";
          const cleanId = String(updatedEv.bcp_id || updatedEv.id).replace(/^event\//, '').trim();
          bLink.href = updatedEv.bcp_url || `https://www.bestcoastpairings.com/event/${encodeURIComponent(cleanId)}`;
        }
      });

      // Guard against interrupting active typing or open studio modals
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
      const isTypingScore = activeEl && activeEl.id && activeEl.id.startsWith("score-");

      if (!isAnyStudioModalOpen()) {
        if (studioState.activeSubtab === "roster") {
          if (!isInputFocused || activeEl.id !== "roster-search-input") {
            const searchInp = document.getElementById("roster-search-input");
            const prevSearch = searchInp ? searchInp.value : "";
            renderRosterSubtab();
            if (prevSearch && searchInp) {
              searchInp.value = prevSearch;
              if (typeof filterRosterTable === 'function') filterRosterTable();
            }
          }
        } else if (studioState.activeSubtab === "pairings") {
          if (!isTypingScore) {
            renderPairingsSubtab();
          }
        } else if (studioState.activeSubtab === "standings") {
          renderStandingsSubtab();
        } else if (studioState.activeSubtab === "meta") {
          renderMetaSubtab();
        }
      }
    }

    // Continuously check active judge calls via REST as fallback to Firestore snapshot
    try {
      if (window.api && typeof window.api.getJudgeCalls === "function") {
        const jRes = await window.api.getJudgeCalls(eventId, false);
        if (jRes && Array.isArray(jRes.calls)) {
          handleStudioJudgeCallsUpdate(jRes.calls);
        }
      }
    } catch (jErr) {
      // Quiet fallback
    }
  } catch (err) {
    console.debug("Notice during quiet workspace poll:", err);
  } finally {
    studioIsPolling = false;
  }
}

async function pollStudioEventsQuietly() {
  const user = (typeof currentUser !== 'undefined') ? currentUser : null;
  const isTO = Boolean(user && typeof isUserTO === 'function' && isUserTO(user));
  if (!isTO) return;
  try {
    const res = await window.api.getStudioEvents();
    if (res && Array.isArray(res.events)) {
      studioState.eventsList = res.events;
      const countEls = document.querySelectorAll("#es-events-count");
      countEls.forEach(el => { el.textContent = studioState.eventsList.length; });
      renderEventsDirectory();
    }
  } catch (e) {
    console.debug("Notice during quiet events poll:", e);
  }
}

function startStudioPolling() {
  stopStudioPolling();
  studioPollTimer = setInterval(async () => {
    if (document.hidden) return;
    if (studioState.activeTab === "manage" && studioState.activeTournament?.id) {
      await pollTournamentWorkspaceQuietly(studioState.activeTournament.id);
    } else if (studioState.activeTab === "events") {
      await pollStudioEventsQuietly();
    }
  }, 10000);
}

function stopStudioPolling() {
  if (studioPollTimer) {
    clearInterval(studioPollTimer);
    studioPollTimer = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && studioState.activeTab === "manage" && studioState.activeTournament?.id) {
    pollTournamentWorkspaceQuietly(studioState.activeTournament.id);
  }
});

window.addEventListener("beforeunload", () => {
  stopStudioPolling();
});

async function loadStudioEvents() {
  const user = (typeof currentUser !== 'undefined') ? currentUser : null;
  const isTO = Boolean(user && typeof isUserTO === 'function' && isUserTO(user));
  if (!isTO) {
    studioState.eventsList = [];
    return;
  }
  try {
    const res = await window.api.getStudioEvents();
    studioState.eventsList = (res && Array.isArray(res.events)) ? res.events : [];
    
    const countEls = document.querySelectorAll("#es-events-count");
    countEls.forEach(el => { el.textContent = studioState.eventsList.length; });

    renderEventsDirectory();
  } catch (err) {
    console.warn("Notice loading studio events:", err);
    studioState.eventsList = [];
    renderEventsDirectory();
  }
}

function switchStudioTab(tabName, eventId = null) {
  if (typeof switchTab === 'function' && typeof activeTab !== 'undefined' && activeTab !== 'event-studio') {
    switchTab('event-studio');
  }

  studioState.activeTab = tabName || 'events';
  const views = ["events", "create", "manage"];

  views.forEach(v => {
    const el = document.getElementById(`es-view-${v}`);
    if (el) {
      el.style.display = (v === studioState.activeTab) ? "block" : "none";
    }
  });

  const lockedGates = document.querySelectorAll("#es-locked-gate");
  lockedGates.forEach(g => { g.style.display = "none"; });

  if (studioState.activeTab === "events") {
    renderEventsDirectory();
    loadStudioEvents(); // Background refresh so latest BCP changes appear without manual reload
    startStudioPolling();
  } else if (studioState.activeTab === "create") {
    if (typeof initGooglePlaces === 'function') {
      setTimeout(initGooglePlaces, 50);
    }
  } else if (studioState.activeTab === "manage") {
    if (eventId) {
      loadTournamentWorkspace(eventId);
    }
    startStudioPolling();
  }
}

function renderEventsDirectory() {
  const containers = document.querySelectorAll("#es-events-list, .es-events-grid");
  if (!containers || containers.length === 0) return;

  const events = studioState.eventsList || [];
  const countEls = document.querySelectorAll("#es-events-count");
  countEls.forEach(el => { el.textContent = events.length; });

  let contentHtml = '';
  if (events.length === 0) {
    contentHtml = `
      <div style="grid-column: 1 / -1; background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius-lg); padding: 3.5rem 1.5rem; text-align: center;">
        <div style="font-size: 2.8rem; margin-bottom: 0.75rem;">⚔️</div>
        <h3 style="color: #fff; margin: 0 0 0.5rem; font-size: 1.3rem;">No Tournaments Directing Yet</h3>
        <p style="color: var(--text-secondary); font-size: 0.9rem; max-width: 520px; margin: 0 auto; line-height: 1.6;">
          Create a new tournament using the top button to publish listings to Best Coast Pairings and manage player registrations.
        </p>
      </div>
    `;
  } else {
    contentHtml = events.map(ev => {
      const rounds = ev.num_rounds || ev.rounds || 5;
      const tier = ev.tier || "Grand Tournament";
      const roster = ev.roster || [];
      const playerCount = (typeof ev.total_players === 'number') ? ev.total_players : (Array.isArray(ev.roster) ? ev.roster.length : 0);
      const capacity = ev.capacity || ev.num_tickets || ev.numTickets || (playerCount > 0 ? playerCount : 32);
      const location = [ev.venue, ev.city, ev.state].filter(Boolean).join(", ") || "Local Venue";
      const dateStr = ev.event_date ? (String(ev.event_date).split("T")[0]) : "Date TBD";
      const isBcp = ev.id && !ev.id.startsWith("ES-");
      const isDeletedOnBcp = ev.bcp_status === "deleted_on_bcp" || ev.bcp_deleted === true;
      const bcpUrl = isBcp ? `https://www.bestcoastpairings.com/event/${encodeURIComponent(ev.id)}` : "#";

      let bcpBadgeHtml = '';
      if (isDeletedOnBcp) {
        bcpBadgeHtml = '<span class="badge" style="font-size: 0.7rem; background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.35);" title="This tournament was removed from Best Coast Pairings but remains preserved locally in OmniTactica.">⚠️ UNLINKED FROM BCP</span>';
      } else if (isBcp) {
        bcpBadgeHtml = '<span class="badge badge-online" style="font-size: 0.7rem;">BCP SYNCED</span>';
      } else {
        bcpBadgeHtml = '<span class="badge" style="font-size: 0.7rem; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3);">LOCAL</span>';
      }

      return `
        <div class="es-event-card" data-event-id="${escapeHtml(ev.id)}" style="background: var(--bg-card); border: 1px solid ${isDeletedOnBcp ? 'rgba(239,68,68,0.35)' : 'var(--border)'}; border-radius: var(--radius-lg); padding: 1.35rem; display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; transition: transform 0.2s ease, border-color 0.2s ease;">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.35rem;">
              <span class="badge badge-accent" style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">${escapeHtml(tier)}</span>
              ${bcpBadgeHtml}
            </div>
            <h4 style="margin: 0 0 0.4rem; color: #fff; font-size: 1.15rem; font-family: var(--font-heading); cursor: pointer;" onclick="switchStudioTab('manage', '${escapeHtml(ev.id)}')">${escapeHtml(ev.name)}</h4>
            <div style="font-size: 0.8rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 0.25rem;">
              <div>📅 ${escapeHtml(dateStr)} • 📍 ${escapeHtml(location)}</div>
              <div>👥 <b>${playerCount} / ${capacity}</b> Players • 🎲 <b>${rounds}</b> Rounds (${ev.points || 2000} pts)</div>
              ${isDeletedOnBcp ? '<div style="color: #ef4444; font-size: 0.75rem; font-weight: 600; margin-top: 0.2rem;">⚠️ Event deleted on BCP — preserved as local</div>' : ''}
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 0.85rem; margin-top: 0.25rem; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn btn-primary" style="font-size: 0.78rem; padding: 0.35rem 0.85rem;" onclick="switchStudioTab('manage', '${escapeHtml(ev.id)}')">👑 Direct Event</button>
            <div style="display: flex; gap: 0.35rem; align-items: center;">
              ${(isBcp && !isDeletedOnBcp) ? `<a href="${bcpUrl}" target="_blank" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.6rem; text-decoration: none;">🔗 BCP</a>` : ''}
              <button class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.6rem; color: #ef4444; border-color: rgba(239,68,68,0.35);" onclick="deleteStudioTournament('${escapeHtml(ev.id)}')">🗑️</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  containers.forEach(c => {
    c.innerHTML = contentHtml;
  });
}

async function submitCreateTournament() {
  const nameInput = document.getElementById("create-event-name");
  const typeInput = document.getElementById("create-event-type");
  const teamSizeInput = document.getElementById("create-event-team-size");
  const gameSystemInput = document.getElementById("create-event-game-system");
  const formatInput = document.getElementById("create-event-format");
  const pairingStyleInput = document.getElementById("create-event-pairing-style");
  const roundsInput = document.getElementById("create-event-rounds");
  const roundLengthInput = document.getElementById("create-event-round-length");
  const startInput = document.getElementById("create-event-start-date");
  const endInput = document.getElementById("create-event-end-date");
  const capacityInput = document.getElementById("create-event-capacity");
  const pointsInput = document.getElementById("create-event-points");
  const venueInput = document.getElementById("create-event-venue");
  const cityStateInput = document.getElementById("create-event-city-state");
  const circuitInput = document.getElementById("create-event-circuit");
  const circuitTokenInput = document.getElementById("create-event-circuit-token");
  const hideListsInput = document.getElementById("create-event-hide-lists");
  const requireListsInput = document.getElementById("create-event-require-lists");
  const passwordlessInput = document.getElementById("create-event-passwordless");
  const hidePlacingsInput = document.getElementById("create-event-hide-placings");

  // BCP Online Registration & Ticketing Options
  const regBcpRadio = document.getElementById("create-event-reg-bcp");
  const usingOnlineReg = regBcpRadio ? regBcpRadio.checked : true;
  const numTicketsInput = document.getElementById("create-event-num-tickets");
  const ticketPriceInput = document.getElementById("create-event-ticket-price");
  const currencyInput = document.getElementById("create-event-currency");
  const allowCheckinInput = document.getElementById("create-event-allow-checkin");
  const privateEventInput = document.getElementById("create-event-private");
  const shipYesRadio = document.getElementById("create-event-ship-yes");
  const listsLockedInput = document.getElementById("create-event-lists-locked");
  const factionsLockedInput = document.getElementById("create-event-factions-locked");
  const hideRosterInput = document.getElementById("create-event-hide-roster");

  const btn = document.getElementById("btn-submit-create-event");
  const status = document.getElementById("create-event-status");

  const name = nameInput ? nameInput.value.trim() : "";
  if (!name) {
    alert("Please enter a tournament name.");
    if (nameInput) nameInput.focus();
    return;
  }

  const selectedCircuitName = circuitInput && circuitInput.selectedIndex >= 0 && circuitInput.value ? circuitInput.options[circuitInput.selectedIndex].text : "";

  const elAddress = document.getElementById("create-event-loc-address");
  const elCity = document.getElementById("create-event-loc-city");
  const elState = document.getElementById("create-event-loc-state");
  const elCountry = document.getElementById("create-event-loc-country");
  const elPostal = document.getElementById("create-event-loc-postal");
  const elLat = document.getElementById("create-event-loc-lat");
  const elLng = document.getElementById("create-event-loc-lng");
  const elPlaceId = document.getElementById("create-event-loc-place-id");
  const verifiedEl = document.getElementById("create-event-loc-verified");

  const venueStr = venueInput ? venueInput.value.trim() : "";
  if (!venueStr) {
    alert("⚠️ Please enter a venue or store location for your tournament.");
    if (venueInput) venueInput.focus();
    return;
  }

  const numTicketsVal = numTicketsInput ? parseInt(numTicketsInput.value, 10) : (capacityInput ? parseInt(capacityInput.value, 10) : 32);
  const ticketPriceVal = ticketPriceInput ? parseFloat(ticketPriceInput.value) || 0 : 0;
  const ticketCurrencyVal = currencyInput ? currencyInput.value : "usd";

  const payload = {
    name: name,
    game_system_id: gameSystemInput ? gameSystemInput.value : "WGMSzfKFYA",
    tier: formatInput ? formatInput.value : "Grand Tournament",
    event_type: typeInput ? typeInput.value : "Singles Event",
    team_size: teamSizeInput ? parseInt(teamSizeInput.value, 10) : 5,
    circuit_id: circuitInput ? circuitInput.value : "",
    circuit_token: circuitTokenInput ? circuitTokenInput.value.trim() : "",
    circuit_name: selectedCircuitName,
    pairing_style: pairingStyleInput ? pairingStyleInput.value : "swiss",
    rounds: roundsInput ? parseInt(roundsInput.value, 10) : 5,
    default_round_length: roundLengthInput ? parseInt(roundLengthInput.value, 10) : 9000,
    start_date: startInput ? startInput.value : "",
    end_date: endInput ? endInput.value : (startInput ? startInput.value : ""),
    capacity: numTicketsVal,
    points: pointsInput ? parseInt(pointsInput.value, 10) : 2000,
    venue: venueStr,
    address: elAddress && elAddress.value ? elAddress.value.trim() : venueStr,
    postal_code: elPostal && elPostal.value ? elPostal.value.trim() : "",
    place_id: elPlaceId && elPlaceId.value ? elPlaceId.value.trim() : "",
    city: elCity && elCity.value ? elCity.value.trim() : (cityStateInput ? cityStateInput.value.trim() : "San Diego"),
    state: elState && elState.value ? elState.value.trim() : "CA",
    country: elCountry && elCountry.value ? elCountry.value.trim() : "United States",
    lat: elLat && elLat.value ? parseFloat(elLat.value) : 32.7157,
    lng: elLng && elLng.value ? parseFloat(elLng.value) : -117.1611,
    location_verified: verifiedEl ? verifiedEl.value === "true" : true,

    // BCP Online Registration & Ticketing
    using_online_reg: usingOnlineReg,
    num_tickets: numTicketsVal,
    ticket_price: ticketPriceVal,
    ticket_currency: ticketCurrencyVal,
    disable_checkin: allowCheckinInput ? !allowCheckinInput.checked : false,
    private_event: privateEventInput ? privateEventInput.checked : false,
    collect_shipping: shipYesRadio ? shipYesRadio.checked : false,
    shipping_mandatory: false,
    shipping_description: "",

    // Rules & Privacy
    hide_lists: hideListsInput ? hideListsInput.checked : true,
    require_lists: requireListsInput ? requireListsInput.checked : true,
    lists_at_checkin: requireListsInput ? requireListsInput.checked : true,
    lists_locked: listsLockedInput ? listsLockedInput.checked : false,
    list_submission_locked: false,
    factions_locked: factionsLockedInput ? factionsLockedInput.checked : false,
    hide_roster: hideRosterInput ? hideRosterInput.checked : false,
    passwordless_scoring: passwordlessInput ? passwordlessInput.checked : true,
    hide_placings: hidePlacingsInput ? hidePlacingsInput.checked : false,
    bcp_token: getBcpToken()
  };

  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Creating & Registering...";
  }
  if (status) {
    status.style.display = "block";
    status.textContent = "Creating tournament and registering listing on Best Coast Pairings...";
  }

  try {
    const res = await window.api.createStudioEvent(payload);
    if (res && res.success) {
      const eventId = res.event_id || res.event?.id;
      const newEvent = res.event || {
        id: eventId,
        name: payload.name,
        tier: payload.tier,
        num_rounds: payload.rounds,
        capacity: payload.capacity,
        points: payload.points,
        venue: payload.venue,
        city: payload.city,
        event_date: payload.start_date
      };

      // Optimistically add and re-render without requiring reload
      studioState.eventsList = [newEvent, ...(studioState.eventsList || []).filter(e => e.id !== eventId)];
      renderEventsDirectory();

      if (typeof loadTournaments === 'function') {
        try { loadTournaments(); } catch(e) {}
      }
      if (typeof loadEvents === 'function') {
        try { loadEvents(); } catch(e) {}
      }
      window.dispatchEvent(new CustomEvent('tournaments-updated', { detail: { eventId, action: 'create', event: newEvent } }));

      if (res.bcp_registered) {
        alert(`🎉 Tournament "${name}" successfully created and registered on Best Coast Pairings!`);
      } else {
        alert(`🎉 Tournament "${name}" created in Event Studio!`);
      }
      if (nameInput) nameInput.value = "";
      if (venueInput) venueInput.value = "";
      if (cityStateInput) cityStateInput.value = "";
      
      switchStudioTab("manage", eventId);
    } else {
      alert(res.message || res.detail || "Failed to create tournament.");
    }
  } catch (err) {
    console.error("Error creating tournament:", err);
    alert(`Creation failed: ${err.message || err}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🚀 Create & Register on BCP";
    }
    if (status) status.style.display = "none";
  }
}

function toggleCreateRegMode() {
  const regBcp = document.getElementById("create-event-reg-bcp");
  const ticketOptions = document.getElementById("create-bcp-ticket-options");
  if (ticketOptions) {
    ticketOptions.style.display = (regBcp && regBcp.checked) ? "block" : "none";
  }
}

/* ==========================================================================
   TOURNAMENT DIRECTOR WORKSPACE (MANAGE EVENT)
   ========================================================================== */

async function loadTournamentWorkspace(eventId) {
  try {
    const res = await window.api.getStudioEvent(eventId);
    const ev = (res && res.event) ? res.event : res;
    if (!ev || !ev.id) {
      alert("Could not load tournament details.");
      switchStudioTab("events");
      return;
    }

    studioState.activeTournament = ev;
    studioState.currentRoundView = ev.current_round || 1;

    // Header population
    const nameEl = document.getElementById("manage-event-name");
    const tierBadge = document.getElementById("manage-event-tier-badge");
    const bcpBadge = document.getElementById("manage-event-bcp-badge");
    const dateEl = document.getElementById("manage-event-date");
    const locEl = document.getElementById("manage-event-location");
    const roundsPtsEl = document.getElementById("manage-event-rounds-pts");
    const bcpLink = document.getElementById("manage-event-bcp-link");
    const rosterCountEl = document.getElementById("manage-roster-count");

    if (nameEl) nameEl.textContent = ev.name || "Tournament";
    if (tierBadge) tierBadge.textContent = (ev.tier || "Grand Tournament").toUpperCase();

    const formatBadge = document.getElementById("manage-event-format-badge");
    if (formatBadge) {
      const et = String(ev.event_type || ev.eventType || "").toLowerCase();
      if (et.includes("doubles")) {
        formatBadge.textContent = "👥 DOUBLES";
        formatBadge.style.display = "inline-block";
      } else if (et.includes("team")) {
        const sz = ev.team_size || ev.teamSize || 5;
        formatBadge.textContent = `🛡️ TEAMS (${sz}-MAN)`;
        formatBadge.style.display = "inline-block";
      } else {
        formatBadge.textContent = "👤 SINGLES";
        formatBadge.style.display = "inline-block";
      }
    }

    const circuitBadgesEl = document.getElementById("manage-event-circuit-badges");
    if (circuitBadgesEl) {
      circuitBadgesEl.innerHTML = "";
      const circuits = Array.isArray(ev.circuits) ? ev.circuits : [];
      circuits.forEach(c => {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.style.background = "rgba(234, 179, 8, 0.15)";
        badge.style.color = "#facc15";
        badge.style.border = "1px solid rgba(234, 179, 8, 0.4)";
        badge.textContent = `🏆 ${c.name || 'Circuit'}`;
        circuitBadgesEl.appendChild(badge);
      });
    }
    
    const isBcp = ev.id && !ev.id.startsWith("ES-");
    const isDeletedOnBcp = ev.bcp_status === "deleted_on_bcp" || ev.bcp_deleted === true;

    if (bcpBadge) {
      if (isDeletedOnBcp) {
        bcpBadge.style.display = "inline-block";
        bcpBadge.className = "badge";
        bcpBadge.style.background = "rgba(239,68,68,0.15)";
        bcpBadge.style.color = "#ef4444";
        bcpBadge.style.borderColor = "rgba(239,68,68,0.35)";
        bcpBadge.textContent = "⚠️ UNLINKED FROM BCP";
      } else if (isBcp) {
        bcpBadge.style.display = "inline-block";
        bcpBadge.className = "badge badge-online";
        bcpBadge.style.background = "";
        bcpBadge.style.color = "";
        bcpBadge.style.borderColor = "";
        bcpBadge.textContent = "BCP SYNCED";
      } else {
        bcpBadge.style.display = "none";
      }
    }
    const bcpLinks = document.querySelectorAll("#manage-event-bcp-link");
    bcpLinks.forEach(bLink => {
      if (isDeletedOnBcp || !isBcp) {
        bLink.style.display = "none";
      } else {
        bLink.style.display = "inline-flex";
        const cleanId = String(ev.bcp_id || ev.id).replace(/^event\//, '').trim();
        bLink.href = ev.bcp_url || `https://www.bestcoastpairings.com/event/${encodeURIComponent(cleanId)}`;
      }
    });

    // Render / update unlinked warning banner inside the workspace
    let warningBanner = document.getElementById("manage-event-unlinked-warning");
    const workspaceViews = document.querySelectorAll("#es-view-manage");
    workspaceViews.forEach(ws => {
      let wb = ws.querySelector("#manage-event-unlinked-warning");
      if (isDeletedOnBcp) {
        if (!wb) {
          wb = document.createElement("div");
          wb.id = "manage-event-unlinked-warning";
          const header = ws.querySelector(".es-manage-header");
          if (header) header.parentNode.insertBefore(wb, header.nextSibling);
        }
        if (wb) {
          wb.style.display = "flex";
          wb.style.alignItems = "center";
          wb.style.justifyContent = "space-between";
          wb.style.background = "rgba(239, 68, 68, 0.08)";
          wb.style.border = "1px solid rgba(239, 68, 68, 0.25)";
          wb.style.borderRadius = "var(--radius-md)";
          wb.style.padding = "0.75rem 1.15rem";
          wb.style.marginBottom = "1.25rem";
          wb.style.fontSize = "0.85rem";
          wb.style.color = "#fca5a5";
          wb.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.65rem;">
              <span style="font-size: 1.2rem;">⚠️</span>
              <span><strong>Notice:</strong> This tournament was deleted or unlinked on Best Coast Pairings. It is preserved in OmniTactica as a local event with all competitor rosters, pairings, and scores intact.</span>
            </div>
          `;
        }
      } else if (wb) {
        wb.style.display = "none";
      }
    });

    const dateStr = ev.event_date ? (String(ev.event_date).split("T")[0]) : "Date TBD";
    const locStr = [ev.venue, ev.city, ev.state].filter(Boolean).join(", ") || "Local Venue";
    const rounds = ev.num_rounds || ev.rounds || 5;
    const pts = ev.points || 2000;

    if (dateEl) dateEl.textContent = dateStr;
    if (locEl) locEl.textContent = locStr;
    if (roundsPtsEl) roundsPtsEl.textContent = `${rounds} Rounds (${pts} pts)`;

    const roster = ev.roster || [];
    if (rosterCountEl) rosterCountEl.textContent = roster.length;

    // Render tournament lifecycle status badge and Start Event button
    const isEnded = Boolean(ev.is_ended || ev.isEnded);
    const isStarted = Boolean(ev.started || (ev.status === "active") || (ev.current_round && ev.current_round > 1));
    const statusBadges = document.querySelectorAll("#manage-event-status-badge");
    statusBadges.forEach(badge => {
      badge.style.display = "inline-block";
      if (isEnded) {
        badge.className = "badge";
        badge.style.background = "rgba(239, 68, 68, 0.15)";
        badge.style.color = "#f87171";
        badge.style.borderColor = "rgba(239, 68, 68, 0.35)";
        badge.textContent = "🔴 CONCLUDED";
      } else if (isStarted) {
        badge.className = "badge badge-online";
        badge.style.background = "";
        badge.style.color = "";
        badge.style.borderColor = "";
        badge.textContent = `🟢 IN PROGRESS • ROUND ${ev.current_round || 1}`;
      } else {
        badge.className = "badge";
        badge.style.background = "rgba(234, 179, 8, 0.15)";
        badge.style.color = "#facc15";
        badge.style.borderColor = "rgba(234, 179, 8, 0.35)";
        badge.textContent = "🟡 REGISTRATION OPEN";
      }
    });

    const startBtns = document.querySelectorAll("#manage-event-start-btn");
    startBtns.forEach(btn => {
      if (!isStarted && !isEnded) {
        btn.style.display = "inline-flex";
      } else {
        btn.style.display = "none";
      }
    });

    // Set default timer
    studioState.timerSeconds = ev.defaultRoundLength || 9000;
    updateTimerDisplay();

    // Attach real-time Firestore listeners for Master Clock, Broadcasts & Floor Judge Radar
    subscribeStudioTournament(ev.id);
    subscribeStudioJudgeCalls(ev.id);

    // Fetch initial active judge calls via REST as immediate fallback
    if (window.api && typeof window.api.getJudgeCalls === 'function') {
      window.api.getJudgeCalls(ev.id, false).then(res => {
        if (res && res.success && Array.isArray(res.calls)) {
          handleStudioJudgeCallsUpdate(res.calls);
        }
      }).catch(e => console.debug("Notice fetching initial judge calls:", e));
    }

    switchManageSubtab(studioState.activeSubtab || "roster");
  } catch (err) {
    console.error("Error loading tournament workspace:", err);
    alert(`Failed to load event: ${err.message || err}`);
  }
}

function switchManageSubtab(subtabName) {
  studioState.activeSubtab = subtabName;
  const subtabs = ["roster", "pairings", "standings", "meta", "settings", "judges"];

  subtabs.forEach(tab => {
    const viewEl = document.getElementById(`manage-subtab-${tab}`);
    const btnEl = document.getElementById(`btn-subtab-${tab}`);
    if (viewEl) viewEl.style.display = (tab === subtabName) ? "block" : "none";
    if (btnEl) {
      if (tab === subtabName) btnEl.classList.add("active");
      else btnEl.classList.remove("active");
    }
  });

  const ev = studioState.activeTournament;
  if (!ev) return;

  if (subtabName === "roster") renderRosterSubtab();
  else if (subtabName === "pairings") {
    renderPairingsSubtab();
    if (ev && ev.id && typeof pollTournamentWorkspaceQuietly === "function") {
      pollTournamentWorkspaceQuietly(ev.id);
    }
  }
  else if (subtabName === "standings") renderStandingsSubtab();
  else if (subtabName === "meta") renderMetaSubtab();
  else if (subtabName === "settings") renderSettingsSubtab();
  else if (subtabName === "judges") renderJudgesSubtab();
}

function renderRosterSubtab() {
  const ev = studioState.activeTournament;
  const tbody = document.getElementById("manage-roster-tbody");
  if (!tbody || !ev) return;

  const roster = ev.roster || [];
  const countEl = document.getElementById("manage-roster-count");
  if (countEl) countEl.textContent = roster.length;

  if (roster.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding: 2.5rem; text-align: center; color: var(--text-muted);">
          No competitors registered yet. Click <strong>"➕ Add Competitor"</strong> to register players.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = roster.map((p, idx) => {
    const pid = p.id || p.player_id || p.name || `P-${idx}`;
    const name = p.name || "Player";
    const faction = p.faction || "Unknown Faction";
    const team = p.team || p.club || "-";
    const isCheckedIn = !!p.checked_in;
    const isDropped = !!p.dropped;

    let statusBadge = isDropped 
      ? '<span class="badge" style="background: rgba(239,68,68,0.2); color: #ef4444; border: 1px solid rgba(239,68,68,0.4);">DROPPED</span>'
      : (isCheckedIn 
          ? '<span class="badge badge-online">CHECKED IN</span>' 
          : '<span class="badge" style="background: rgba(245,158,11,0.2); color: #f59e0b; border: 1px solid rgba(245,158,11,0.4);">REGISTERED</span>');

    return `
      <tr style="border-bottom: 1px solid var(--border); transition: background 0.15s ease;">
        <td style="padding: 0.85rem 1rem;">
          <div style="font-weight: 600; color: #fff;">${escapeHtml(name)}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(pid)}</div>
        </td>
        <td style="padding: 0.85rem 1rem;">
          <span style="color: #38bdf8; font-weight: 500;">${escapeHtml(faction)}</span>
        </td>
        <td style="padding: 0.85rem 1rem; color: var(--text-secondary);">${escapeHtml(team)}</td>
        <td style="padding: 0.85rem 1rem;">${statusBadge}</td>
        <td style="padding: 0.85rem 1rem; text-align: right;">
          <div style="display: inline-flex; gap: 0.35rem;">
            <button class="btn btn-outline" style="font-size: 0.72rem; padding: 0.25rem 0.5rem;" onclick="toggleCheckIn('${escapeHtml(pid)}')">
              ${isCheckedIn ? 'Uncheck' : 'Check In'}
            </button>
            <button class="btn btn-outline" style="font-size: 0.72rem; padding: 0.25rem 0.5rem; color: ${isDropped ? '#10b981' : '#f59e0b'};" onclick="toggleDropPlayer('${escapeHtml(pid)}')">
              ${isDropped ? 'Undrop' : 'Drop'}
            </button>
            <button class="btn btn-outline" style="font-size: 0.72rem; padding: 0.25rem 0.5rem; color: #ef4444;" onclick="removePlayer('${escapeHtml(pid)}')">
              ✕
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function startTournamentEvent() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const isBcp = !String(ev.id || "").startsWith("ES-");
  const roster = (ev.roster || []).filter(p => !p.dropped);
  const activeCount = roster.length > 0 ? roster.length : (ev.total_players || 0);

  if (!isBcp && activeCount < 2) {
    alert("At least 2 active competitors are required to start the tournament.");
    return;
  }

  if (!confirm(`🚀 Start tournament "${ev.name}"? This will officially open Round 1 and generate pairings on Best Coast Pairings.`)) {
    return;
  }

  const startBtns = document.querySelectorAll("#manage-event-start-btn");
  startBtns.forEach(btn => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> Starting & Generating Pairings...';
  });

  try {
    const res = await window.api.startStudioEvent(ev.id);
    if (res && res.success) {
      // If BCP event and pairings status is generating, poll pairingsStatus
      if (isBcp) {
        let pStatus = res.pairings_status?.status || (res.pairings_status?.data && res.pairings_status.data.status) || "";
        let pollCount = 0;
        while (pStatus === "generating" && pollCount < 8) {
          startBtns.forEach(btn => {
            btn.innerHTML = `<span class="spinner" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> Generating Pairings (${pollCount + 1}s)...`;
          });
          await new Promise(r => setTimeout(r, 1200));
          pollCount++;
          try {
            const statusRes = await window.api.getStudioPairingsStatus(ev.id);
            pStatus = statusRes?.data?.status || statusRes?.status || "";
            if (pStatus === "completed" || pStatus === "failed") break;
          } catch (e) {
            console.warn("Notice checking pairings status:", e);
          }
        }
      }

      studioState.activeTournament = res.event || { ...ev, started: true, status: "active", current_round: 1 };
      await loadTournamentWorkspace(ev.id);
      switchManageSubtab("pairings");
      const bcpNote = res.bcp_started ? " Synced with Best Coast Pairings." : "";
      alert(`🎉 Tournament "${ev.name}" started successfully! Round 1 is active.${bcpNote}`);
    } else {
      alert((res && (res.detail || res.message)) || "Failed to start event.");
    }
  } catch (err) {
    console.error("Error starting event:", err);
    alert(`Failed to start event: ${err.message || err}`);
  } finally {
    startBtns.forEach(btn => {
      btn.disabled = false;
      btn.innerHTML = '▶️ Start Event';
    });
  }
}

function renderPairingsSubtab() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const totalRounds = ev.num_rounds || ev.rounds || 5;
  const currentRound = studioState.currentRoundView || ev.current_round || 1;

  // Render Round Pills
  const pillsContainers = document.querySelectorAll("#manage-round-pills");
  pillsContainers.forEach(container => {
    let html = '';
    for (let r = 1; r <= totalRounds; r++) {
      const active = (r === currentRound) ? 'btn-primary' : 'btn-outline';
      html += `<button class="btn ${active}" style="font-size: 0.78rem; padding: 0.35rem 0.75rem;" onclick="selectRoundView(${r})">Round ${r}</button>`;
    }
    container.innerHTML = html;
  });

  // Render Matchups for current round
  const pairingsContainers = document.querySelectorAll("#manage-pairings-list");
  if (!pairingsContainers.length) return;

  const pairingsMap = ev.pairings || {};
  const roundPairings = pairingsMap[String(currentRound)] || [];

  // Update pairing status badge in UI
  const statusBadges = document.querySelectorAll("#manage-pairings-status-badge");
  statusBadges.forEach(statusBadge => {
    if (ev.is_published && ev.published_round === currentRound) {
      statusBadge.className = "badge";
      statusBadge.style.background = "rgba(56, 189, 248, 0.2)";
      statusBadge.style.color = "#38bdf8";
      statusBadge.style.borderColor = "rgba(56, 189, 248, 0.4)";
      statusBadge.textContent = "📢 PUBLISHED LIVE";
    } else if (ev.pairings_status === "applied" || ev.pairings_bcp_synced) {
      statusBadge.className = "badge badge-online";
      statusBadge.style.background = "";
      statusBadge.style.color = "";
      statusBadge.style.borderColor = "";
      statusBadge.textContent = "🟢 APPLIED TO BCP";
    } else if (roundPairings.length > 0) {
      statusBadge.className = "badge";
      statusBadge.style.background = "rgba(234, 179, 8, 0.15)";
      statusBadge.style.color = "#facc15";
      statusBadge.style.borderColor = "rgba(234, 179, 8, 0.35)";
      statusBadge.textContent = "🟡 STAGED PAIRINGS (DRAFT)";
    } else {
      statusBadge.className = "badge";
      statusBadge.style.background = "rgba(255, 255, 255, 0.05)";
      statusBadge.style.color = "var(--text-muted)";
      statusBadge.style.borderColor = "var(--border)";
      statusBadge.textContent = "UNPAIRED";
    }
  });

  // Update Apply to BCP button state/text
  const applyBtns = document.querySelectorAll("#btn-apply-pairings-bcp");
  applyBtns.forEach(btn => {
    if (roundPairings.length === 0) {
      btn.disabled = true;
      btn.style.opacity = "0.5";
    } else {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  });

  if (roundPairings.length === 0) {
    pairingsContainers.forEach(c => {
      c.innerHTML = `
        <div style="grid-column: 1 / -1; background: var(--bg-card); border: 1px dashed var(--border); border-radius: var(--radius-lg); padding: 3rem 1.5rem; text-align: center; color: var(--text-muted);">
          <div style="font-size: 1.1rem; font-weight: 600; color: #fff; margin-bottom: 0.5rem;">⚔️ No Pairings Staged for Round ${currentRound}</div>
          <div>Click <strong>"🎲 Generate Swiss Pairings"</strong> or <strong>"➕ Add Table"</strong> to dynamically construct table matchups on OmniTactica.</div>
          <div style="margin-top: 0.5rem; font-size: 0.8rem; color: var(--text-secondary);">You can inspect win probabilities, swap competitors between tables, and then click <strong>"🚀 Apply Pairings to BCP"</strong>.</div>
        </div>
      `;
    });
    return;
  }

  const cardsHtml = roundPairings.map(match => {
    const table = match.table || 1;
    const p1Name = match.p1_name || match.p1Name || "Player 1";
    const p1Fac = match.p1_faction || match.p1Faction || "";
    const p1Team = match.p1_team || match.p1Team || "";
    const p1Elo = match.p1_elo !== undefined ? match.p1_elo : (match.p1Elo || 1500);
    const p1Prob = match.p1_win_prob !== undefined ? match.p1_win_prob : 50.0;
    const p1Score = match.p1_score !== undefined ? match.p1_score : 0;

    const isBye = Boolean(match.is_bye || match.p2_name === "BYE" || !match.p2_id);
    const p2Name = isBye ? "BYE" : (match.p2_name || match.p2Name || "Player 2");
    const p2Fac = isBye ? "" : (match.p2_faction || match.p2Faction || "");
    const p2Team = isBye ? "" : (match.p2_team || match.p2Team || "");
    const p2Elo = isBye ? 0.0 : (match.p2_elo !== undefined && match.p2_elo !== null ? (match.p2_elo || 1500) : (match.p2Elo || 1500));
    const p2Prob = match.p2_win_prob !== undefined ? match.p2_win_prob : (100.0 - p1Prob);
    const p2Score = match.p2_score !== undefined ? match.p2_score : 0;

    const isRematch = Boolean(match.is_rematch);
    const rematchRounds = Array.isArray(match.rematch_rounds) && match.rematch_rounds.length > 0 ? match.rematch_rounds.join(', ') : '';
    const sameTeam = Boolean(match.same_team);

    const matchId = `BCP-${ev.id}-R${currentRound}-T${table}`;
    const pid = match.id || match.bcp_pairing_id || '';
    const cleanPid = pid && !String(pid).startsWith('bcp-pairing-') ? pid : '';
    const pairingParam = cleanPid ? `&pairing_id=${encodeURIComponent(cleanPid)}` : '';
    const trackerSpectateUrl = `/11th/tracker/play?match_id=${encodeURIComponent(matchId)}&event_id=${encodeURIComponent(ev.id)}&table=${table}&role=spectator${pairingParam}`;

    const activeJudgeCall = (studioState.judgeCalls || []).find(c => {
      const cTable = Number(c.tableNumber || c.table_num || c.table || 0);
      const cRound = Number(c.roundNumber || c.round_num || c.round || 0);
      const cMid = String(c.matchId || c.match_id || '').toUpperCase();
      return (cTable === table && (!cRound || cRound === currentRound)) || (cMid && cMid === matchId);
    });

    const cardBorderStyle = activeJudgeCall ? 'border: 2px solid #ef4444; box-shadow: 0 0 16px rgba(239, 68, 68, 0.45);' : 'border: 1px solid var(--border);';

    return `
      <div class="es-match-card" style="background: var(--bg-card); ${cardBorderStyle} border-radius: var(--radius-lg); padding: 1.15rem; display: flex; flex-direction: column; gap: 0.85rem; position: relative;">
        ${activeJudgeCall ? `
          <div style="background: rgba(239, 68, 68, 0.18); border: 1.5px solid #ef4444; border-radius: 8px; padding: 0.5rem 0.75rem; margin-bottom: 0.25rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; animation: gt-pulse 1.5s infinite;">
            <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: #fca5a5; font-weight: 700;">
              <span style="font-size: 1.1rem;">🚨</span>
              <div>
                <div>JUDGE CALLED: <span style="color: #fff;">${escapeHtml(activeJudgeCall.category || 'Rules Dispute')}</span></div>
                <div style="font-size: 0.72rem; color: #f87171; font-weight: 500;">
                  By ${escapeHtml(activeJudgeCall.callerName || activeJudgeCall.called_by || activeJudgeCall.player_name || (typeof activeJudgeCall.caller === 'string' ? activeJudgeCall.caller : (activeJudgeCall.caller && activeJudgeCall.caller.playerName)) || 'Competitor')}
                  ${activeJudgeCall.status === 'en_route' ? ` • <span style="color: #38bdf8; font-weight: 700;">En Route: ${escapeHtml((activeJudgeCall.assignedJudge && activeJudgeCall.assignedJudge.name) || activeJudgeCall.assignedJudge || 'Judge')}</span>` : ''}
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 0.35rem; align-items: center;">
              ${activeJudgeCall.status === 'pending' ? `
                <button class="btn" style="font-size: 0.72rem; padding: 0.25rem 0.55rem; background: #0284c7; color: #fff; border: 1px solid #38bdf8; font-weight: 700;" onclick="markJudgeCallEnRoute('${escapeHtml(activeJudgeCall.id)}')">🏃 En Route</button>
              ` : ''}
              <button class="btn" style="font-size: 0.72rem; padding: 0.25rem 0.55rem; background: #059669; color: #fff; border: 1px solid #10b981; font-weight: 700;" onclick="markJudgeCallResolved('${escapeHtml(activeJudgeCall.id)}')">✅ Resolve</button>
            </div>
          </div>
        ` : ''}
        <!-- Card Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-weight: 700; font-family: var(--font-heading); color: #38bdf8;">TABLE ${table}</span>
            ${isBye ? '<span class="badge badge-accent">BYE</span>' : '<span style="font-size: 0.72rem; color: var(--text-muted);">Swiss Match</span>'}
          </div>
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <button class="btn btn-outline" style="font-size: 0.7rem; padding: 0.18rem 0.45rem;" onclick="toggleTableBye(${table})" title="Toggle BYE for this table">${isBye ? 'Set Match' : 'Set BYE'}</button>
            <button class="btn btn-outline" style="font-size: 0.7rem; padding: 0.18rem 0.45rem; color: #ef4444;" onclick="removePairingTable(${table})" title="Remove Table">✕</button>
          </div>
        </div>

        <!-- Competitor 1 -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
              <span style="font-weight: 600; color: #fff; font-size: 0.95rem;">${escapeHtml(p1Name)}</span>
              <span class="badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; font-size: 0.72rem; padding: 0.15rem 0.4rem;">⭐ ${Number(p1Elo).toFixed(1)}</span>
            </div>
            <div style="font-size: 0.75rem; color: #38bdf8; margin-top: 0.15rem;">${escapeHtml(p1Fac)}${p1Team ? ` • <span style="color: var(--text-secondary);">${escapeHtml(p1Team)}</span>` : ''}</div>
            ${!isBye ? `<div style="font-size: 0.72rem; color: ${p1Prob >= 50 ? 'var(--win)' : 'var(--text-muted)'}; font-weight: 600; margin-top: 0.2rem;">${p1Prob}% Win Prob</div>` : ''}
          </div>
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <input type="number" id="score-p1-${table}" class="form-input" value="${p1Score}" min="0" max="100" style="width: 65px; text-align: center; font-weight: 700; font-size: 1.05rem;" ${isBye ? 'disabled' : ''}>
            <button class="btn btn-outline" style="font-size: 0.72rem; padding: 0.28rem 0.5rem;" onclick="openSwapModal(${currentRound}, ${table}, 'p1', '${escapeHtml(p1Name)}')" title="Swap Player 1 with another table">⇄ Swap</button>
          </div>
        </div>

        <!-- VS Divider & Warnings -->
        <div style="display: flex; align-items: center; justify-content: center; gap: 0.6rem; margin: -0.2rem 0;">
          <div style="height: 1px; flex: 1; background: var(--border);"></div>
          <span style="color: var(--text-muted); font-size: 0.72rem; font-weight: 700;">VS</span>
          ${isRematch ? `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); font-size: 0.7rem;">⚠️ Rematch${rematchRounds ? ` (R${rematchRounds})` : ''}</span>` : ''}
          ${sameTeam ? `<span class="badge" style="background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.35); font-size: 0.7rem;">⚠️ Same Team</span>` : ''}
          <div style="height: 1px; flex: 1; background: var(--border);"></div>
        </div>

        <!-- Competitor 2 -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
              <span style="font-weight: 600; color: ${isBye ? 'var(--text-muted)' : '#fff'}; font-size: 0.95rem;">${escapeHtml(p2Name)}</span>
              ${!isBye ? `<span class="badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; font-size: 0.72rem; padding: 0.15rem 0.4rem;">⭐ ${Number(p2Elo).toFixed(1)}</span>` : ''}
            </div>
            ${!isBye ? `<div style="font-size: 0.75rem; color: #38bdf8; margin-top: 0.15rem;">${escapeHtml(p2Fac)}${p2Team ? ` • <span style="color: var(--text-secondary);">${escapeHtml(p2Team)}</span>` : ''}</div>` : ''}
            ${!isBye ? `<div style="font-size: 0.72rem; color: ${p2Prob >= 50 ? 'var(--win)' : 'var(--text-muted)'}; font-weight: 600; margin-top: 0.2rem;">${p2Prob}% Win Prob</div>` : ''}
          </div>
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <input type="number" id="score-p2-${table}" class="form-input" value="${p2Score}" min="0" max="100" style="width: 65px; text-align: center; font-weight: 700; font-size: 1.05rem;" ${isBye ? 'disabled' : ''}>
            ${!isBye ? `<button class="btn btn-outline" style="font-size: 0.72rem; padding: 0.28rem 0.5rem;" onclick="openSwapModal(${currentRound}, ${table}, 'p2', '${escapeHtml(p2Name)}')" title="Swap Player 2 with another table">⇄ Swap</button>` : ''}
          </div>
        </div>

        <!-- Card Footer Actions -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.35rem; border-top: 1px dashed var(--border); padding-top: 0.5rem;">
          <a href="${trackerSpectateUrl}" target="_blank" onclick="ensureStudioTrackerRoom(event, '${escapeHtml(ev.id)}', ${currentRound}, ${table}, '${escapeHtml(p1Name)}', '${escapeHtml(p2Name)}', '${escapeHtml(match.p1_id || '')}', '${escapeHtml(match.p2_id || '')}', '${escapeHtml(p1Fac)}', '${escapeHtml(p2Fac)}', '${escapeHtml(cleanPid)}')" style="font-size: 0.75rem; color: #a5b4fc; text-decoration: underline; font-weight: 600;" title="Spectate Table ${table} as Spectator">👁️ Open Game Tracker ↗</a>
          <button class="btn btn-outline" style="font-size: 0.76rem; padding: 0.28rem 0.65rem;" onclick="saveTableScore(${table})">💾 Save Score</button>
        </div>
      </div>
    `;
  }).join("");

  pairingsContainers.forEach(c => {
    c.innerHTML = cardsHtml;
  });
}

async function ensureStudioTrackerRoom(e, eventId, roundNum, tableNum, p1Name, p2Name, p1Id, p2Id, p1Fac, p2Fac, pairingId) {
  const matchId = `BCP-${eventId}-R${roundNum}-T${tableNum}`;
  try {
    if (window.api && typeof window.api.createTournamentTrackerRoom === 'function') {
      await window.api.createTournamentTrackerRoom({
        match_id: matchId,
        event_id: eventId,
        round_num: Number(roundNum) || 1,
        table_num: Number(tableNum) || 1,
        pairing_id: pairingId || null,
        p1_name: p1Name || 'Player 1',
        p2_name: p2Name || 'Player 2',
        p1_id: p1Id || null,
        p2_id: p2Id || null,
        p1_faction: p1Fac || null,
        p2_faction: p2Fac || null
      });
    }
  } catch (err) {
    console.warn("Notice ensuring tracker room before spectator navigation:", err);
  }
}
window.ensureStudioTrackerRoom = ensureStudioTrackerRoom;

function selectRoundView(roundNum) {
  studioState.currentRoundView = roundNum;
  renderPairingsSubtab();
  const ev = studioState.activeTournament;
  if (ev && ev.id && typeof pollTournamentWorkspaceQuietly === "function") {
    pollTournamentWorkspaceQuietly(ev.id);
  }
}

async function triggerGenerateSwissPairings() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const roundNum = studioState.currentRoundView || ev.current_round || 1;
  const roster = (ev.roster || []).filter(p => !p.dropped);

  if (roster.length < 2) {
    alert("At least 2 active competitors are required to generate pairings.");
    return;
  }

  if (!confirm(`Generate Swiss pairings for Round ${roundNum}? Pairings will be staged locally on OmniTactica for inspection and player swapping before pushing to BCP.`)) return;

  try {
    const res = await window.api.generateStudioPairings(ev.id, { round: roundNum });
    if (res && res.success) {
      studioState.activeTournament = res.event;
      renderPairingsSubtab();
      alert(`🎉 Generated Swiss pairings for Round ${roundNum} (Staged locally)! You can swap players or click 'Apply Pairings to BCP'.`);
    } else {
      alert((res && (res.detail || res.message)) || "Failed to generate pairings.");
    }
  } catch (err) {
    console.error("Pairings generation error:", err);
    alert(`Pairings failed: ${err.message || err}`);
  }
}

async function saveTableScore(tableNum) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const currentRound = studioState.currentRoundView || ev.current_round || 1;
  const p1ScoreEl = document.getElementById(`score-p1-${tableNum}`);
  const p2ScoreEl = document.getElementById(`score-p2-${tableNum}`);

  const p1Score = p1ScoreEl ? parseInt(p1ScoreEl.value, 10) : 0;
  const p2Score = p2ScoreEl ? parseInt(p2ScoreEl.value, 10) : 0;

  const pairingsMap = ev.pairings || {};
  const roundPairings = pairingsMap[String(currentRound)] || [];
  const match = roundPairings.find(m => m.table === tableNum);

  if (match) {
    match.p1_score = p1Score;
    match.p2_score = p2Score;
    match.is_done = true;
  }

  try {
    if (!String(ev.id).startsWith("ES-")) {
      const pid = match ? (match.id || match.bcp_pairing_id) : null;
      const cleanPid = pid && !String(pid).startsWith('bcp-pairing-') ? pid : null;
      const res = await window.api.submitStudioScore({
        event_id: ev.id,
        table: Number(tableNum) || 1,
        round_num: Number(currentRound) || 1,
        p1_score: p1Score,
        p2_score: p2Score,
        pairing_id: cleanPid,
        p1_name: match ? (match.p1_name || match.player1_name) : 'Player 1',
        p2_name: match ? (match.p2_name || match.player2_name) : 'Player 2',
        game_details: {
          p1_game_id: match ? (match.player1GameId || match.p1_game_id) : null,
          p2_game_id: match ? (match.player2GameId || match.p2_game_id) : null,
          metaData: match ? (match.metaData || {}) : {}
        },
        source_app: 'EventStudio'
      });
      if (typeof pollTournamentWorkspaceQuietly === 'function') {
        pollTournamentWorkspaceQuietly(ev.id);
      }
      if (res && res.bcp_synced) {
        // Table scores pushed to BCP via backend submitScores endpoint
        alert(`Table ${tableNum} score successfully submitted to Best Coast Pairings!`);
      } else if (res && res.bcp_notice) {
        alert(`BCP notice for Table ${tableNum}: ${res.bcp_notice}`);
      } else {
        alert(`Table ${tableNum} score submitted!`);
      }
    } else {
      await window.api.saveStudioPairings(ev.id, {
        round: currentRound,
        pairings: roundPairings
      });
      if (typeof pollTournamentWorkspaceQuietly === 'function') {
        pollTournamentWorkspaceQuietly(ev.id);
      }
      alert(`Table ${tableNum} score saved!`);
    }
  } catch (err) {
    console.error("Error saving score:", err);
    alert(`Failed to save score: ${err.message || err}`);
  }
}

let currentSwapState = null;

function openSwapModal(roundNum, tableNum, slot, playerName) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const modal = document.getElementById("modal-swap-players");
  if (!modal) return;

  currentSwapState = { round: roundNum, table1: tableNum, slot1: slot };

  const infoEl = document.getElementById("swap-source-info");
  if (infoEl) {
    infoEl.innerHTML = `<strong>Table ${tableNum} (${slot.toUpperCase()}):</strong> ${escapeHtml(playerName)}`;
  }

  const selectEl = document.getElementById("swap-target-select");
  if (selectEl) {
    const pairingsMap = ev.pairings || {};
    const roundPairings = pairingsMap[String(roundNum)] || [];

    let options = '<option value="">-- Choose competitor to swap with --</option>';
    roundPairings.forEach(m => {
      const t = m.table;
      if (t === tableNum && slot === 'p1') {
        if (!m.is_bye && m.p2_name && m.p2_name !== 'BYE') {
          options += `<option value="${t}|p2">Table ${t} (P2) - ${escapeHtml(m.p2_name)} (${escapeHtml(m.p2_faction || 'Faction')})</option>`;
        }
      } else if (t === tableNum && slot === 'p2') {
        if (m.p1_name) {
          options += `<option value="${t}|p1">Table ${t} (P1) - ${escapeHtml(m.p1_name)} (${escapeHtml(m.p1_faction || 'Faction')})</option>`;
        }
      } else {
        if (m.p1_name) {
          options += `<option value="${t}|p1">Table ${t} (P1) - ${escapeHtml(m.p1_name)} (${escapeHtml(m.p1_faction || 'Faction')})</option>`;
        }
        if (!m.is_bye && m.p2_name && m.p2_name !== 'BYE') {
          options += `<option value="${t}|p2">Table ${t} (P2) - ${escapeHtml(m.p2_name)} (${escapeHtml(m.p2_faction || 'Faction')})</option>`;
        }
      }
    });
    selectEl.innerHTML = options;
  }

  modal.style.display = "flex";
}

function closeSwapModal() {
  const modal = document.getElementById("modal-swap-players");
  if (modal) modal.style.display = "none";
  currentSwapState = null;
}

async function submitSwapPlayers() {
  if (!currentSwapState) return;
  const selectEl = document.getElementById("swap-target-select");
  const targetVal = selectEl ? selectEl.value : "";
  if (!targetVal) {
    alert("Please select a competitor to swap with.");
    return;
  }

  const [t2Str, s2] = targetVal.split("|");
  const table2 = parseInt(t2Str, 10);
  const ev = studioState.activeTournament;
  if (!ev) return;

  const payload = {
    round: currentSwapState.round,
    table1: currentSwapState.table1,
    slot1: currentSwapState.slot1,
    table2: table2,
    slot2: s2
  };

  try {
    const res = await window.api.swapStudioPairings(ev.id, payload);
    if (res && res.success) {
      if (res.event) {
        studioState.activeTournament = res.event;
      } else if (res.pairings) {
        ev.pairings = ev.pairings || {};
        ev.pairings[String(payload.round)] = res.pairings;
        ev.pairings_status = "staged";
      }
      closeSwapModal();
      renderPairingsSubtab();
    } else {
      alert((res && (res.detail || res.message)) || "Failed to swap players.");
    }
  } catch (err) {
    console.error("Swap error:", err);
    alert(`Swap error: ${err.message || err}`);
  }
}

async function applyPairingsToBcp() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const currentRound = studioState.currentRoundView || ev.current_round || 1;
  const pairingsMap = ev.pairings || {};
  const roundPairings = pairingsMap[String(currentRound)] || [];

  if (roundPairings.length === 0) {
    alert(`No pairings staged for Round ${currentRound}.`);
    return;
  }

  if (!confirm(`🚀 Apply Round ${currentRound} pairings to Best Coast Pairings? This will push all ${roundPairings.length} table matchups to BCP and sync live game tracker rooms.`)) {
    return;
  }

  const applyBtns = document.querySelectorAll("#btn-apply-pairings-bcp");
  applyBtns.forEach(btn => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> Applying...';
  });

  try {
    const res = await window.api.applyStudioPairingsToBcp(ev.id, { round: currentRound });
    if (res && res.success) {
      if (res.event) {
        studioState.activeTournament = res.event;
      } else {
        ev.pairings_status = "applied";
        ev.pairings_bcp_synced = true;
      }
      renderPairingsSubtab();
      const bcpNote = res.bcp_applied ? " Applied to Best Coast Pairings." : (res.bcp_notice ? ` (Notice: ${res.bcp_notice})` : "");
      alert(`✅ Round ${currentRound} pairings successfully staged and applied!${bcpNote}`);
    } else {
      alert((res && (res.detail || res.message)) || "Failed to apply pairings to BCP.");
    }
  } catch (err) {
    console.error("Apply pairings error:", err);
    alert(`Failed to apply pairings: ${err.message || err}`);
  } finally {
    applyBtns.forEach(btn => {
      btn.disabled = false;
      btn.innerHTML = '🚀 Apply Pairings to BCP';
    });
  }
}

async function addPairingTable() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const currentRound = studioState.currentRoundView || ev.current_round || 1;
  const pairingsMap = ev.pairings || {};
  const roundPairings = pairingsMap[String(currentRound)] || [];

  const nextTable = roundPairings.length + 1;
  const newMatch = {
    table: nextTable,
    p1_id: "",
    p1_name: "Unassigned Player 1",
    p1_faction: "Unassigned",
    p1_team: "",
    p1_elo: 1500,
    p1_win_prob: 50.0,
    p1_score: 0,
    p2_id: "",
    p2_name: "Unassigned Player 2",
    p2_faction: "Unassigned",
    p2_team: "",
    p2_elo: 1500,
    p2_win_prob: 50.0,
    p2_score: 0,
    is_done: false,
    is_bye: false
  };

  roundPairings.push(newMatch);
  pairingsMap[String(currentRound)] = roundPairings;
  ev.pairings = pairingsMap;
  ev.pairings_status = "staged";

  try {
    await window.api.saveStudioPairings(ev.id, { round: currentRound, pairings: roundPairings });
    renderPairingsSubtab();
  } catch (err) {
    alert("Failed to add table: " + (err.message || err));
  }
}

async function toggleTableBye(tableNum) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const currentRound = studioState.currentRoundView || ev.current_round || 1;
  const pairingsMap = ev.pairings || {};
  const roundPairings = pairingsMap[String(currentRound)] || [];
  const match = roundPairings.find(m => m.table === tableNum);
  if (!match) return;

  if (match.is_bye) {
    match.is_bye = false;
    match.p2_id = "";
    match.p2_name = "Player 2";
    match.p2_faction = "";
    match.p1_score = 0;
    match.p2_score = 0;
    match.is_done = false;
  } else {
    match.is_bye = true;
    match.p2_id = null;
    match.p2_name = "BYE";
    match.p2_faction = "";
    match.p1_score = 100;
    match.p2_score = 0;
    match.is_done = true;
  }

  ev.pairings_status = "staged";
  try {
    await window.api.saveStudioPairings(ev.id, { round: currentRound, pairings: roundPairings });
    renderPairingsSubtab();
  } catch (err) {
    alert("Failed to update BYE: " + (err.message || err));
  }
}

async function removePairingTable(tableNum) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  if (!confirm(`Remove Table ${tableNum}?`)) return;

  const currentRound = studioState.currentRoundView || ev.current_round || 1;
  const pairingsMap = ev.pairings || {};
  let roundPairings = (pairingsMap[String(currentRound)] || []).filter(m => m.table !== tableNum);

  roundPairings.forEach((m, idx) => {
    m.table = idx + 1;
  });

  pairingsMap[String(currentRound)] = roundPairings;
  ev.pairings = pairingsMap;
  ev.pairings_status = "staged";

  try {
    await window.api.saveStudioPairings(ev.id, { round: currentRound, pairings: roundPairings });
    renderPairingsSubtab();
  } catch (err) {
    alert("Failed to remove table: " + (err.message || err));
  }
}

function openEditTournamentModal() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const modal = document.getElementById("es-edit-tournament-modal");
  const nameEl = document.getElementById("edit-event-name");
  const sDateEl = document.getElementById("edit-event-start-date");
  const eDateEl = document.getElementById("edit-event-end-date");
  const venueEl = document.getElementById("edit-event-venue");
  const cityEl = document.getElementById("edit-event-city");
  const stateEl = document.getElementById("edit-event-state");
  const roundsEl = document.getElementById("edit-event-rounds");
  const ptsEl = document.getElementById("edit-event-points");
  const capEl = document.getElementById("edit-event-capacity");
  const errEl = document.getElementById("edit-event-error");

  if (errEl) errEl.style.display = "none";
  if (nameEl) nameEl.value = ev.name || "";
  if (sDateEl) sDateEl.value = ev.event_date ? String(ev.event_date).split("T")[0] : "";
  if (eDateEl) eDateEl.value = ev.end_date ? String(ev.end_date).split("T")[0] : (sDateEl ? sDateEl.value : "");
  if (venueEl) venueEl.value = ev.venue || "";
  if (cityEl) cityEl.value = ev.city || "";
  if (stateEl) stateEl.value = ev.state || "";
  if (roundsEl) roundsEl.value = ev.num_rounds || ev.rounds || 5;
  if (ptsEl) ptsEl.value = ev.points || 2000;
  if (capEl) capEl.value = ev.capacity || 32;

  const typeEl = document.getElementById("edit-event-type");
  const teamSizeEl = document.getElementById("edit-event-team-size");
  if (typeEl) {
    const rawEt = String(ev.event_type || ev.eventType || "").toLowerCase();
    if (rawEt.includes("doubles")) typeEl.value = "Doubles Event";
    else if (rawEt.includes("team")) typeEl.value = "Teams Event";
    else typeEl.value = "Singles Event";
  }
  if (teamSizeEl) teamSizeEl.value = ev.team_size || ev.teamSize || 5;
  toggleTeamOptions("edit");

  if (modal) modal.classList.add("active");
}

function closeEditTournamentModal() {
  const modal = document.getElementById("es-edit-tournament-modal");
  if (modal) modal.classList.remove("active");
}

async function saveEditedTournament(e) {
  if (e) e.preventDefault();
  const ev = studioState.activeTournament;
  if (!ev) return;

  const nameEl = document.getElementById("edit-event-name");
  const typeEl = document.getElementById("edit-event-type");
  const teamSizeEl = document.getElementById("edit-event-team-size");
  const sDateEl = document.getElementById("edit-event-start-date");
  const eDateEl = document.getElementById("edit-event-end-date");
  const venueEl = document.getElementById("edit-event-venue");
  const cityEl = document.getElementById("edit-event-city");
  const stateEl = document.getElementById("edit-event-state");
  const roundsEl = document.getElementById("edit-event-rounds");
  const ptsEl = document.getElementById("edit-event-points");
  const capEl = document.getElementById("edit-event-capacity");
  const errEl = document.getElementById("edit-event-error");
  const btn = document.getElementById("edit-event-submit-btn");

  const eventType = typeEl ? typeEl.value : "Singles Event";
  const teamSize = teamSizeEl ? parseInt(teamSizeEl.value, 10) : 5;

  const payload = {
    name: nameEl ? nameEl.value.trim() : ev.name,
    event_type: eventType,
    team_size: teamSize,
    event_date: sDateEl ? sDateEl.value : ev.event_date,
    start_date: sDateEl ? sDateEl.value : ev.event_date,
    end_date: eDateEl ? eDateEl.value : ev.end_date,
    venue: venueEl ? venueEl.value.trim() : ev.venue,
    city: cityEl ? cityEl.value.trim() : ev.city,
    state: stateEl ? stateEl.value.trim() : ev.state,
    num_rounds: roundsEl ? parseInt(roundsEl.value, 10) : (ev.num_rounds || 5),
    points: ptsEl ? parseInt(ptsEl.value, 10) : (ev.points || 2000),
    capacity: capEl ? parseInt(capEl.value, 10) : (ev.capacity || 32)
  };

  if (btn) {
    btn.disabled = true;
    btn.innerText = "Saving Changes...";
  }

  try {
    const res = await window.api.updateStudioEvent(ev.id, payload);
    if (res && res.success) {
      const updated = res.event || payload;
      studioState.activeTournament = { ...ev, ...updated };
      
      // Update in studioState.eventsList
      if (Array.isArray(studioState.eventsList)) {
        const idx = studioState.eventsList.findIndex(e => e.id === ev.id);
        if (idx >= 0) {
          studioState.eventsList[idx] = { ...studioState.eventsList[idx], ...updated };
        }
      }

      // Immediately reflect updated values in the DOM
      const nameHeader = document.getElementById("manage-event-name");
      const locHeader = document.getElementById("manage-event-location");
      const dateHeader = document.getElementById("manage-event-date");
      const roundsPtsHeader = document.getElementById("manage-event-rounds-pts");
      const formatBadge = document.getElementById("manage-event-format-badge");

      if (nameHeader) nameHeader.textContent = updated.name || ev.name;
      if (locHeader) locHeader.textContent = [updated.venue, updated.city, updated.state].filter(Boolean).join(", ") || "Local Venue";
      if (dateHeader) dateHeader.textContent = updated.event_date ? String(updated.event_date).split("T")[0] : (updated.start_date || "Date TBD");
      if (roundsPtsHeader) roundsPtsHeader.textContent = `${updated.num_rounds || 5} Rounds (${updated.points || 2000} pts)`;

      if (formatBadge) {
        const et = String(updated.event_type || updated.eventType || eventType).toLowerCase();
        if (et.includes("doubles")) formatBadge.textContent = "👥 DOUBLES";
        else if (et.includes("team")) formatBadge.textContent = `🛡️ TEAMS (${updated.team_size || teamSize}-MAN)`;
        else formatBadge.textContent = "👤 SINGLES";
      }

      closeEditTournamentModal();
      await loadTournamentWorkspace(ev.id);
      alert("✅ Tournament details updated and synced successfully!");
    } else {
      if (errEl) {
        errEl.innerText = res.error || "Failed to update tournament.";
        errEl.style.display = "block";
      }
    }
  } catch (err) {
    if (errEl) {
      errEl.innerText = "Error: " + err.message;
      errEl.style.display = "block";
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "💾 Save Changes";
    }
  }
}

async function togglePublishPairings() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const currentRound = studioState.currentRoundView || ev.current_round || 1;
  const isCurrentlyPublished = !!ev.is_published;
  const btn = document.getElementById("btn-publish-pairings");

  try {
    if (isCurrentlyPublished) {
      if (!confirm(`Unpublish pairings for Round ${currentRound}? Players will not see matchups until republished.`)) return;
      const res = await window.api.unpublishStudioPairings(ev.id, { round: currentRound });
      if (res && res.success) {
        ev.is_published = false;
        if (btn) {
          btn.innerText = "📢 Publish Pairings";
          btn.className = "btn btn-outline";
        }
        alert(`🔒 Round ${currentRound} pairings unpublished.`);
      }
    } else {
      const res = await window.api.publishStudioPairings(ev.id, { round: currentRound });
      if (res && res.success) {
        ev.is_published = true;
        if (btn) {
          btn.innerText = "🔒 Unpublish Pairings";
          btn.className = "btn btn-primary";
        }
        alert(`📢 Round ${currentRound} pairings published live on BCP and player devices!`);
      }
    }
  } catch (err) {
    alert("Publish toggle error: " + err.message);
  }
}

async function finalizeCurrentRound() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const totalRounds = ev.num_rounds || ev.rounds || 5;
  const currentRound = studioState.currentRoundView || ev.current_round || 1;

  if (!confirm(`Finalize and lock Round ${currentRound}? This will save official match results and advance to Round ${Math.min(currentRound + 1, totalRounds)}.`)) {
    return;
  }

  try {
    const res = await window.api.finalizeStudioRound(ev.id, { round: currentRound });
    if (res && res.success) {
      studioState.activeTournament = res.event;
      studioState.currentRoundView = res.current_round;
      await loadTournamentWorkspace(ev.id);
      renderPairingsSubtab();
      alert(`🏁 Round ${currentRound} finalized! Now on Round ${res.current_round}.`);
    } else {
      alert(res.message || "Failed to finalize round.");
    }
  } catch (err) {
    alert("Finalize round error: " + err.message);
  }
}

async function resetCurrentRound() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const currentRound = studioState.currentRoundView || ev.current_round || 1;
  if (!confirm(`⚠️ Reset Round ${currentRound}? This will allow you to regenerate or modify matchups.`)) {
    return;
  }

  try {
    const res = await window.api.resetStudioRound(ev.id, { round: currentRound });
    if (res && res.success) {
      studioState.activeTournament = res.event;
      renderPairingsSubtab();
      alert(`🔄 Round ${currentRound} reset successfully.`);
    }
  } catch (err) {
    alert("Reset round error: " + err.message);
  }
}

async function endAndArchiveTournament() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  if (!confirm(`🏆 Finalize and End "${ev.name}"? This will lock all final standings and tournament placements.`)) {
    return;
  }

  try {
    const res = await window.api.endStudioTournament(ev.id);
    if (res && res.success) {
      studioState.activeTournament = res.event;
      switchManageSubtab("standings");
      alert(`🏆 "${ev.name}" concluded and archived successfully! Final standings are locked.`);
    } else {
      alert(res.message || "Failed to conclude tournament.");
    }
  } catch (err) {
    alert("End tournament error: " + err.message);
  }
}

async function renderStandingsSubtab() {
  const ev = studioState.activeTournament;
  const tbody = document.getElementById("manage-standings-tbody");
  if (!tbody || !ev) return;

  tbody.innerHTML = `<tr><td colspan="7" style="padding: 2.5rem; text-align: center; color: var(--text-muted);">Calculating Swiss tiebreakers and Strength of Schedule...</td></tr>`;

  try {
    const res = await window.api.getStudioStandings(ev.id);
    const standings = (res && res.standings) ? res.standings : [];

    if (standings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding: 2.5rem; text-align: center; color: var(--text-muted);">No standings computed yet. Enter match scores in the Pairings tab.</td></tr>`;
      return;
    }

    tbody.innerHTML = standings.map(s => {
      const record = `${s.wins}-${s.losses}-${s.draws}`;
      const diff = s.battle_points_diff >= 0 ? `+${s.battle_points_diff}` : `${s.battle_points_diff}`;

      return `
        <tr style="border-bottom: 1px solid var(--border);">
          <td style="padding: 0.75rem 0.85rem; font-weight: 700; font-family: var(--font-heading); color: ${s.rank <= 3 ? '#38bdf8' : '#fff'};">#${s.rank}</td>
          <td style="padding: 0.75rem 1rem; font-weight: 600; color: #fff;">${escapeHtml(s.name)}</td>
          <td style="padding: 0.75rem 1rem; color: #38bdf8;">${escapeHtml(s.faction)}</td>
          <td style="padding: 0.75rem 0.85rem; text-align: center; font-family: var(--font-mono); font-weight: 600;">${record}</td>
          <td style="padding: 0.75rem 0.85rem; text-align: center; font-weight: 700; color: #10b981;">${s.swiss_points}</td>
          <td style="padding: 0.75rem 0.85rem; text-align: center; font-family: var(--font-mono);">${s.opp_win_rate_sos}%</td>
          <td style="padding: 0.75rem 0.85rem; text-align: center; font-family: var(--font-mono);">${s.battle_points} <span style="font-size: 0.75rem; color: var(--text-muted);">(${diff})</span></td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Error loading standings:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="padding: 2rem; text-align: center; color: #ef4444;">Failed to load standings: ${escapeHtml(err.message || err)}</td></tr>`;
  }
}

function renderMetaSubtab() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const roster = ev.roster || [];
  const factionCounts = {};

  roster.forEach(p => {
    const f = p.faction || "Unknown";
    factionCounts[f] = (factionCounts[f] || 0) + 1;
  });

  const sortedFactions = Object.entries(factionCounts).sort((a, b) => b[1] - a[1]);
  const total = Math.max(1, roster.length);

  const barsEl = document.getElementById("meta-faction-bars");
  if (barsEl) {
    if (sortedFactions.length === 0) {
      barsEl.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem;">No competitor factions registered yet.</div>`;
    } else {
      barsEl.innerHTML = sortedFactions.map(([fac, count]) => {
        const pct = Math.round((count / total) * 100);
        return `
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.25rem;">
              <span style="color: #fff; font-weight: 600;">${escapeHtml(fac)}</span>
              <span style="color: var(--text-muted);">${count} (${pct}%)</span>
            </div>
            <div style="background: rgba(255,255,255,0.06); height: 6px; border-radius: 3px; overflow: hidden;">
              <div style="background: #38bdf8; width: ${pct}%; height: 100%;"></div>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  const winrateEl = document.getElementById("meta-winrate-bars");
  if (winrateEl) {
    winrateEl.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem;">Win rate matrix updates as rounds conclude.</div>`;
  }
}

/* ==========================================================================
   SUBTAB 5: TOURNAMENT SETTINGS & BCP REGISTRATION
   ========================================================================== */

function renderSettingsSubtab() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const statusEl = document.getElementById("manage-settings-status");
  if (statusEl) statusEl.style.display = "none";

  // Tournament Information
  const nameEl = document.getElementById("settings-event-name");
  const tierEl = document.getElementById("settings-event-tier");
  const pairStyleEl = document.getElementById("settings-event-pairing-style");
  const roundsEl = document.getElementById("settings-event-rounds");
  const ptsEl = document.getElementById("settings-event-points");
  const roundLenEl = document.getElementById("settings-event-round-length");
  const sDateEl = document.getElementById("settings-event-start-date");
  const eDateEl = document.getElementById("settings-event-end-date");
  const venueEl = document.getElementById("settings-event-venue");

  if (nameEl) nameEl.value = ev.name || "";
  if (tierEl) {
    const tier = ev.tier || ev.format || "Grand Tournament";
    tierEl.value = tier;
    if (!tierEl.value) tierEl.value = "Grand Tournament";
  }
  if (pairStyleEl) {
    const ps = String(ev.pairing_style || ev.pairingStyle || "Swiss");
    pairStyleEl.value = ps.charAt(0).toUpperCase() + ps.slice(1).toLowerCase();
    if (!pairStyleEl.value) pairStyleEl.value = "Swiss";
  }
  if (roundsEl) roundsEl.value = ev.num_rounds || ev.rounds || 5;
  if (ptsEl) ptsEl.value = ev.points || 2000;
  if (roundLenEl) roundLenEl.value = String(ev.default_round_length || ev.defaultRoundLength || 9000);
  if (sDateEl) sDateEl.value = ev.event_date ? String(ev.event_date).split("T")[0] : (ev.start_date ? String(ev.start_date).split("T")[0] : "");
  if (eDateEl) eDateEl.value = ev.end_date ? String(ev.end_date).split("T")[0] : (sDateEl ? sDateEl.value : "");
  if (venueEl) venueEl.value = [ev.venue, ev.address, ev.city, ev.state].filter(Boolean).join(", ") || (ev.venue || "");

  // Registration & Ticketing
  const regBcpRadio = document.getElementById("settings-reg-bcp");
  const regManualRadio = document.getElementById("settings-reg-manual");
  const usingOnlineReg = ev.using_online_reg !== false && ev.usingOnlineReg !== false;
  if (regBcpRadio) regBcpRadio.checked = usingOnlineReg;
  if (regManualRadio) regManualRadio.checked = !usingOnlineReg;

  const numTicketsEl = document.getElementById("settings-event-num-tickets");
  const ticketPriceEl = document.getElementById("settings-event-ticket-price");
  const currencyEl = document.getElementById("settings-event-currency");
  const allowCheckinEl = document.getElementById("settings-event-allow-checkin");
  const privateEventEl = document.getElementById("settings-event-private");
  const shipNoRadio = document.getElementById("settings-ship-no");
  const shipYesRadio = document.getElementById("settings-ship-yes");

  if (numTicketsEl) numTicketsEl.value = ev.num_tickets || ev.numTickets || ev.capacity || 32;
  if (ticketPriceEl) ticketPriceEl.value = ev.ticket_price != null ? ev.ticket_price : (ev.ticketPrice != null ? ev.ticketPrice : 0);
  if (currencyEl) currencyEl.value = (ev.ticket_currency || ev.currency || "usd").toLowerCase();
  if (allowCheckinEl) allowCheckinEl.checked = !(ev.disable_checkin === true || ev.disableCheckin === true);
  if (privateEventEl) privateEventEl.checked = !!(ev.private_event || ev.privateEvent);

  const shippingRequested = !!(
    (ev.shipping_details && ev.shipping_details.requested) ||
    (ev.shippingDetails && ev.shippingDetails.requested) ||
    ev.collect_shipping
  );
  if (shipYesRadio) shipYesRadio.checked = shippingRequested;
  if (shipNoRadio) shipNoRadio.checked = !shippingRequested;

  // Rules & Privacy
  const hideListsEl = document.getElementById("settings-event-hide-lists");
  const requireListsEl = document.getElementById("settings-event-require-lists");
  const listsLockedEl = document.getElementById("settings-event-lists-locked");
  const factionsLockedEl = document.getElementById("settings-event-factions-locked");
  const passwordlessEl = document.getElementById("settings-event-passwordless");
  const hidePlacingsEl = document.getElementById("settings-event-hide-placings");
  const hideRosterEl = document.getElementById("settings-event-hide-roster");
  const rankedTablesEl = document.getElementById("settings-event-ranked-tables");

  if (hideListsEl) hideListsEl.checked = ev.hide_lists !== false && ev.hideLists !== false;
  if (requireListsEl) requireListsEl.checked = !!(ev.require_lists || ev.lists_at_checkin || ev.listsAtCheckin);
  if (listsLockedEl) listsLockedEl.checked = !!(ev.lists_locked || ev.listsLocked);
  if (factionsLockedEl) factionsLockedEl.checked = !!(ev.factions_locked || ev.factionsLocked);
  if (passwordlessEl) passwordlessEl.checked = ev.passwordless_scoring !== false && ev.passwordlessScoring !== false;
  if (hidePlacingsEl) hidePlacingsEl.checked = !!(ev.hide_placings || ev.hidePlacings);
  if (hideRosterEl) hideRosterEl.checked = !!(ev.hide_roster || ev.hideRoster);
  if (rankedTablesEl) rankedTablesEl.checked = !!(ev.ranked_tables || ev.rankedTables);

  toggleSettingsRegMode();
}

function toggleSettingsRegMode() {
  const regBcp = document.getElementById("settings-reg-bcp");
  const ticketOptions = document.getElementById("settings-bcp-ticket-options");
  if (ticketOptions) {
    ticketOptions.style.display = (regBcp && regBcp.checked) ? "block" : "none";
  }
}

async function saveTournamentSettings() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const statusEl = document.getElementById("manage-settings-status");
  const btn = document.getElementById("btn-save-event-settings");

  // Collect values
  const nameEl = document.getElementById("settings-event-name");
  const tierEl = document.getElementById("settings-event-tier");
  const pairStyleEl = document.getElementById("settings-event-pairing-style");
  const roundsEl = document.getElementById("settings-event-rounds");
  const ptsEl = document.getElementById("settings-event-points");
  const roundLenEl = document.getElementById("settings-event-round-length");
  const sDateEl = document.getElementById("settings-event-start-date");
  const eDateEl = document.getElementById("settings-event-end-date");
  const venueEl = document.getElementById("settings-event-venue");

  const regBcpRadio = document.getElementById("settings-reg-bcp");
  const usingOnlineReg = regBcpRadio ? regBcpRadio.checked : true;
  const numTicketsEl = document.getElementById("settings-event-num-tickets");
  const ticketPriceEl = document.getElementById("settings-event-ticket-price");
  const currencyEl = document.getElementById("settings-event-currency");
  const allowCheckinEl = document.getElementById("settings-event-allow-checkin");
  const privateEventEl = document.getElementById("settings-event-private");
  const shipYesRadio = document.getElementById("settings-ship-yes");

  const hideListsEl = document.getElementById("settings-event-hide-lists");
  const requireListsEl = document.getElementById("settings-event-require-lists");
  const listsLockedEl = document.getElementById("settings-event-lists-locked");
  const factionsLockedEl = document.getElementById("settings-event-factions-locked");
  const passwordlessEl = document.getElementById("settings-event-passwordless");
  const hidePlacingsEl = document.getElementById("settings-event-hide-placings");
  const hideRosterEl = document.getElementById("settings-event-hide-roster");
  const rankedTablesEl = document.getElementById("settings-event-ranked-tables");

  const newName = nameEl ? nameEl.value.trim() : ev.name;
  if (!newName) {
    alert("Please enter a tournament name.");
    if (nameEl) nameEl.focus();
    return;
  }

  const numTicketsVal = numTicketsEl ? parseInt(numTicketsEl.value, 10) : (ev.num_tickets || ev.capacity || 32);
  const ticketPriceVal = ticketPriceEl ? parseFloat(ticketPriceEl.value) || 0 : 0;
  const ticketCurrencyVal = currencyEl ? currencyEl.value : "usd";

  const payload = {
    name: newName,
    tier: tierEl ? tierEl.value : (ev.tier || "Grand Tournament"),
    pairing_style: pairStyleEl ? pairStyleEl.value : "Swiss",
    num_rounds: roundsEl ? parseInt(roundsEl.value, 10) : (ev.num_rounds || 5),
    points: ptsEl ? parseInt(ptsEl.value, 10) : (ev.points || 2000),
    default_round_length: roundLenEl ? parseInt(roundLenEl.value, 10) : (ev.default_round_length || 9000),
    start_date: sDateEl ? sDateEl.value : (ev.start_date || ""),
    event_date: sDateEl ? sDateEl.value : (ev.event_date || ""),
    end_date: eDateEl ? eDateEl.value : (sDateEl ? sDateEl.value : ""),
    venue: venueEl ? venueEl.value.trim() : (ev.venue || ""),
    capacity: numTicketsVal,

    // BCP Online Registration & Ticketing
    using_online_reg: usingOnlineReg,
    num_tickets: numTicketsVal,
    ticket_price: ticketPriceVal,
    ticket_currency: ticketCurrencyVal,
    disable_checkin: allowCheckinEl ? !allowCheckinEl.checked : false,
    private_event: privateEventEl ? privateEventEl.checked : false,
    collect_shipping: shipYesRadio ? shipYesRadio.checked : false,

    // Rules & Privacy
    hide_lists: hideListsEl ? hideListsEl.checked : true,
    require_lists: requireListsEl ? requireListsEl.checked : false,
    lists_at_checkin: requireListsEl ? requireListsEl.checked : false,
    lists_locked: listsLockedEl ? listsLockedEl.checked : false,
    factions_locked: factionsLockedEl ? factionsLockedEl.checked : false,
    passwordless_scoring: passwordlessEl ? passwordlessEl.checked : true,
    hide_placings: hidePlacingsEl ? hidePlacingsEl.checked : false,
    hide_roster: hideRosterEl ? hideRosterEl.checked : false,
    ranked_tables: rankedTablesEl ? rankedTablesEl.checked : false
  };

  if (btn) {
    btn.disabled = true;
    btn.innerText = "⏳ Saving & Syncing to BCP...";
  }
  if (statusEl) {
    statusEl.style.display = "block";
    statusEl.style.background = "rgba(56, 189, 248, 0.1)";
    statusEl.style.borderColor = "rgba(56, 189, 248, 0.3)";
    statusEl.style.color = "#38bdf8";
    statusEl.innerHTML = "Saving settings and syncing registration parameters to Best Coast Pairings...";
  }

  try {
    const res = await window.api.updateStudioEvent(ev.id, payload);
    if (res && res.success) {
      const updated = res.event || payload;
      studioState.activeTournament = { ...ev, ...updated, ...payload };

      if (Array.isArray(studioState.eventsList)) {
        const idx = studioState.eventsList.findIndex(e => e.id === ev.id);
        if (idx >= 0) {
          studioState.eventsList[idx] = { ...studioState.eventsList[idx], ...updated, ...payload };
        }
      }

      // Update header DOM
      const nameHeader = document.getElementById("manage-event-name");
      const locHeader = document.getElementById("manage-event-location");
      const dateHeader = document.getElementById("manage-event-date");
      const roundsPtsHeader = document.getElementById("manage-event-rounds-pts");

      if (nameHeader) nameHeader.textContent = payload.name;
      if (locHeader && payload.venue) locHeader.textContent = payload.venue;
      if (dateHeader) dateHeader.textContent = payload.event_date ? String(payload.event_date).split("T")[0] : "Date TBD";
      if (roundsPtsHeader) roundsPtsHeader.textContent = `${payload.num_rounds} Rounds (${payload.points} pts)`;

      if (statusEl) {
        statusEl.style.background = "rgba(16, 185, 129, 0.1)";
        statusEl.style.borderColor = "rgba(16, 185, 129, 0.3)";
        statusEl.style.color = "#10b981";
        const bcpMsg = res.bcp_updated ? " Synced to Best Coast Pairings live!" : "";
        statusEl.innerHTML = `✅ Tournament settings saved successfully!${bcpMsg}`;
      }
    } else {
      if (statusEl) {
        statusEl.style.background = "rgba(239, 68, 68, 0.1)";
        statusEl.style.borderColor = "rgba(239, 68, 68, 0.3)";
        statusEl.style.color = "#ef4444";
        statusEl.innerHTML = `❌ Failed to update settings: ${res?.error || "Unknown error"}`;
      }
    }
  } catch (err) {
    console.error("Save settings error:", err);
    if (statusEl) {
      statusEl.style.background = "rgba(239, 68, 68, 0.1)";
      statusEl.style.borderColor = "rgba(239, 68, 68, 0.3)";
      statusEl.style.color = "#ef4444";
      statusEl.innerHTML = `❌ Error: ${err.message || err}`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "💾 Save & Sync to BCP";
    }
  }
}

/* ==========================================================================
   ROSTER ACTIONS & MODAL
   ========================================================================== */

function openAddPlayerModal() {
  const modal = document.getElementById("modal-add-player");
  if (modal) modal.style.display = "flex";
}

function closeAddPlayerModal() {
  const modal = document.getElementById("modal-add-player");
  if (modal) modal.style.display = "none";
}

async function submitAddPlayer() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const nameInput = document.getElementById("add-player-name");
  const facInput = document.getElementById("add-player-faction");
  const teamInput = document.getElementById("add-player-team");
  const emailInput = document.getElementById("add-player-email");

  const name = nameInput ? nameInput.value.trim() : "";
  const fac = facInput ? facInput.value.trim() : "";
  if (!name || !fac) {
    alert("Please provide player name and faction.");
    return;
  }

  const payload = {
    name: name,
    faction: fac,
    team: teamInput ? teamInput.value.trim() : "",
    email: emailInput ? emailInput.value.trim() : "",
    checked_in: true
  };

  try {
    const res = await window.api.registerForTournament(ev.id, payload);
    if (res && res.success) {
      if (res.event) {
        studioState.activeTournament = res.event;
      } else if (res.player) {
        ev.roster = ev.roster || [];
        const existingIdx = ev.roster.findIndex(p => (p.id || p.player_id) === res.player.id || p.name === res.player.name);
        if (existingIdx >= 0) {
          ev.roster[existingIdx] = res.player;
        } else {
          ev.roster.push(res.player);
        }
        ev.total_players = ev.roster.length;
      }
      closeAddPlayerModal();
      if (nameInput) nameInput.value = "";
      if (facInput) facInput.value = "";
      if (teamInput) teamInput.value = "";
      if (emailInput) emailInput.value = "";
      renderRosterSubtab();
      const bcpNote = res.bcp_registered ? " Synced with Best Coast Pairings." : "";
      alert(`Competitor "${name}" registered successfully!${bcpNote}`);
    } else {
      alert((res && (res.detail || res.message)) || "Failed to register player.");
    }
  } catch (err) {
    console.error("Add player error:", err);
    alert(`Failed to save player: ${err.message || err}`);
  }
}

async function toggleCheckIn(playerId) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const player = (ev.roster || []).find(p => (p.id || p.player_id || p.name) === playerId);
  if (player) {
    player.checked_in = !player.checked_in;
    await window.api.saveStudioRoster(ev.id, { roster: ev.roster });
    renderRosterSubtab();
  }
}

async function toggleDropPlayer(playerId) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const player = (ev.roster || []).find(p => (p.id || p.player_id || p.name) === playerId);
  if (player) {
    player.dropped = !player.dropped;
    await window.api.saveStudioRoster(ev.id, { roster: ev.roster });
    renderRosterSubtab();
  }
}

async function removePlayer(playerId) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  if (!confirm("Are you sure you want to remove this player from the tournament?")) return;

  // Optimistically update local view
  ev.roster = (ev.roster || []).filter(p => (p.id || p.player_id || p.name) !== playerId);
  ev.total_players = ev.roster.length;
  renderRosterSubtab();

  try {
    const res = await window.api.removeStudioPlayer(ev.id, playerId);
    if (res && res.success) {
      await loadTournamentWorkspace(ev.id);
    } else {
      alert(res?.detail || res?.error || res?.message || "Failed to remove competitor.");
      await loadTournamentWorkspace(ev.id);
    }
  } catch (err) {
    console.error("Remove player error:", err);
    alert(`Failed to remove competitor: ${err.message || err}`);
    await loadTournamentWorkspace(ev.id);
  }
}

async function bulkCheckInPlayers() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  (ev.roster || []).forEach(p => p.checked_in = true);
  await window.api.saveStudioRoster(ev.id, { roster: ev.roster });
  renderRosterSubtab();
  alert("All competitors marked checked in!");
}

function filterRosterTable() {
  const query = (document.getElementById("roster-search-input")?.value || "").toLowerCase();
  const rows = document.querySelectorAll("#manage-roster-tbody tr");
  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    r.style.display = text.includes(query) ? "" : "none";
  });
}

/* ==========================================================================
   TOURNAMENT MASTER CLOCK & REAL-TIME OPERATIONS SUITE
   ========================================================================== */

function subscribeStudioTournament(eventId) {
  if (studioState.tournamentUnsub) {
    try { studioState.tournamentUnsub(); } catch(e) {}
    studioState.tournamentUnsub = null;
  }
  const db = getStudioFirestoreDb();
  if (!db || !eventId) return;

  const docIds = [eventId];
  if (eventId.toUpperCase() !== eventId) docIds.push(eventId.toUpperCase());

  const unsubs = [];
  docIds.forEach(did => {
    try {
      const u = db.collection('tournaments').doc(did).onSnapshot(doc => {
        if (!doc || !doc.exists) return;
        const data = doc.data() || {};
        if (data.masterClock) {
          applyRemoteStudioMasterClock(data.masterClock);
        }
        const calls = data.judge_calls || data.flags;
        if (Array.isArray(calls)) {
          handleStudioJudgeCallsUpdate(calls);
        }
      }, err => {
        console.warn("Notice on tournament listener:", err);
      });
      unsubs.push(u);
    } catch (e) {
      console.warn("Notice initializing tournament listener:", e);
    }
  });

  studioState.tournamentUnsub = () => {
    unsubs.forEach(fn => { try { fn(); } catch(e) {} });
  };
}

function applyRemoteStudioMasterClock(clock) {
  if (!clock) return;
  studioState.masterClockStatus = clock.status || 'stopped';
  const btn = document.getElementById("btn-timer-toggle");

  const targetEnd = clock.targetEndTime || clock.target_end_time;
  const remSec = typeof clock.remainingSeconds === 'number' 
    ? clock.remainingSeconds 
    : (typeof clock.remaining_seconds === 'number' ? clock.remaining_seconds : null);

  if (clock.status === 'running' && targetEnd) {
    studioState.masterClockTargetEnd = targetEnd;
    studioState.isTimerRunning = true;
    studioState.timerSeconds = Math.max(0, Math.round((targetEnd - Date.now()) / 1000));
    if (btn) btn.textContent = "⏸️";
    ensureStudioClockTicker();
  } else if (clock.status === 'paused') {
    studioState.isTimerRunning = false;
    studioState.masterClockTargetEnd = null;
    if (typeof remSec === 'number') {
      studioState.timerSeconds = remSec;
    }
    if (btn) btn.textContent = "▶️";
  } else {
    studioState.isTimerRunning = false;
    studioState.masterClockTargetEnd = null;
    if (typeof remSec === 'number') {
      studioState.timerSeconds = remSec;
    }
    if (btn) btn.textContent = "▶️";
  }
  updateTimerDisplay();
}

let studioClockInterval = null;
function ensureStudioClockTicker() {
  if (studioClockInterval) return;
  studioClockInterval = setInterval(() => {
    if (studioState.masterClockStatus === 'running' && studioState.masterClockTargetEnd) {
      const rem = Math.max(0, Math.round((studioState.masterClockTargetEnd - Date.now()) / 1000));
      studioState.timerSeconds = rem;
      updateTimerDisplay();
      if (rem <= 0) {
        studioState.masterClockStatus = 'stopped';
        studioState.isTimerRunning = false;
        const btn = document.getElementById("btn-timer-toggle");
        if (btn) btn.textContent = "▶️";
      }
    }
  }, 1000);
}

function propagateMasterClockToFirestoreRoomsDirectly(eventId, clockPayload) {
  const db = getStudioFirestoreDb();
  const ev = studioState.activeTournament;
  if (!db || !eventId) return;
  try {
    const currentRound = studioState.currentRoundView || (ev ? ev.current_round : 1) || 1;
    const pairingsMap = (ev && ev.pairings) || {};
    const roundPairings = pairingsMap[String(currentRound)] || [];
    const cleanEid = eventId.replace(/^bcp_/i, '').replace(/^es-/i, '').trim().toUpperCase();
    roundPairings.forEach(match => {
      const table = match.table || 1;
      const bcpMid = `BCP-${eventId}-R${currentRound}-T${table}`.toUpperCase();
      const esMid = `ES-${eventId}-R${currentRound}-T${table}`.toUpperCase();
      db.collection('rooms').doc(bcpMid).set({ masterClock: clockPayload, updatedAt: Date.now() }, { merge: true }).catch(() => {});
      db.collection('rooms').doc(esMid).set({ masterClock: clockPayload, updatedAt: Date.now() }, { merge: true }).catch(() => {});
      if (cleanEid) {
        db.collection('rooms').doc(`BCP-${cleanEid}-R${currentRound}-T${table}`).set({ masterClock: clockPayload, updatedAt: Date.now() }, { merge: true }).catch(() => {});
        db.collection('rooms').doc(`ES-${cleanEid}-R${currentRound}-T${table}`).set({ masterClock: clockPayload, updatedAt: Date.now() }, { merge: true }).catch(() => {});
      }
    });
  } catch (e) {
    console.debug("Notice updating room docs with masterClock directly:", e);
  }
}

async function toggleRoundTimer() {
  const ev = studioState.activeTournament;
  const eventId = ev ? ev.id : null;
  const btn = document.getElementById("btn-timer-toggle");

  if (studioState.isTimerRunning || studioState.masterClockStatus === 'running') {
    // Pause clock
    const rem = studioState.masterClockTargetEnd 
      ? Math.max(0, Math.round((studioState.masterClockTargetEnd - Date.now()) / 1000))
      : studioState.timerSeconds;
    studioState.isTimerRunning = false;
    studioState.masterClockStatus = 'paused';
    studioState.masterClockTargetEnd = null;
    studioState.timerSeconds = rem;
    if (btn) btn.textContent = "▶️";
    updateTimerDisplay();

    const clockPayload = {
      status: 'paused',
      round: studioState.currentRoundView || (ev ? ev.current_round : 1) || 1,
      durationMinutes: Math.round(rem / 60) || 150,
      duration_minutes: Math.round(rem / 60) || 150,
      targetEndTime: null,
      target_end_time: null,
      remainingSeconds: rem,
      remaining_seconds: rem,
      updatedAt: Date.now(),
      updated_at: Date.now()
    };

    const db = getStudioFirestoreDb();
    if (db && eventId) {
      try {
        const docPayload = {
          id: eventId,
          eventId: eventId,
          type: "Event",
          masterClock: clockPayload,
          updatedAt: Date.now()
        };
        db.collection('tournaments').doc(eventId).set(docPayload, { merge: true }).catch(() => {});
        db.collection('events').doc(eventId).set(docPayload, { merge: true }).catch(() => {});
      } catch (e) {
        console.warn("Notice saving clock to Firestore:", e);
      }
    }
    propagateMasterClockToFirestoreRoomsDirectly(eventId, clockPayload);
    if (eventId && window.api && typeof window.api.updateStudioMasterClock === 'function') {
      window.api.updateStudioMasterClock(eventId, clockPayload).catch(() => {});
    }
  } else {
    // Start / Resume clock
    if (studioState.timerSeconds <= 0) {
      studioState.timerSeconds = (ev && ev.defaultRoundLength) ? ev.defaultRoundLength : 9000;
    }
    const targetEndTime = Date.now() + (studioState.timerSeconds * 1000);
    studioState.isTimerRunning = true;
    studioState.masterClockStatus = 'running';
    studioState.masterClockTargetEnd = targetEndTime;
    if (btn) btn.textContent = "⏸️";
    ensureStudioClockTicker();
    updateTimerDisplay();

    const clockPayload = {
      status: 'running',
      round: studioState.currentRoundView || (ev ? ev.current_round : 1) || 1,
      durationMinutes: Math.round(studioState.timerSeconds / 60) || 150,
      duration_minutes: Math.round(studioState.timerSeconds / 60) || 150,
      targetEndTime: targetEndTime,
      target_end_time: targetEndTime,
      remainingSeconds: studioState.timerSeconds,
      remaining_seconds: studioState.timerSeconds,
      updatedAt: Date.now(),
      updated_at: Date.now()
    };

    const db = getStudioFirestoreDb();
    if (db && eventId) {
      try {
        const docPayload = {
          id: eventId,
          eventId: eventId,
          type: "Event",
          masterClock: clockPayload,
          updatedAt: Date.now()
        };
        db.collection('tournaments').doc(eventId).set(docPayload, { merge: true }).catch(() => {});
        db.collection('events').doc(eventId).set(docPayload, { merge: true }).catch(() => {});
      } catch (e) {
        console.warn("Notice saving clock to Firestore:", e);
      }
    }
    propagateMasterClockToFirestoreRoomsDirectly(eventId, clockPayload);
    if (eventId && window.api && typeof window.api.updateStudioMasterClock === 'function') {
      window.api.updateStudioMasterClock(eventId, clockPayload).catch(() => {});
    }
  }
}

async function adjustRoundTimer(deltaMinutes) {
  const ev = studioState.activeTournament;
  const eventId = ev ? ev.id : null;
  const deltaSec = deltaMinutes * 60;

  if (studioState.masterClockStatus === 'running' && studioState.masterClockTargetEnd) {
    studioState.masterClockTargetEnd += (deltaSec * 1000);
    studioState.timerSeconds = Math.max(0, Math.round((studioState.masterClockTargetEnd - Date.now()) / 1000));
  } else {
    studioState.timerSeconds = Math.max(0, studioState.timerSeconds + deltaSec);
  }
  updateTimerDisplay();

  if (eventId) {
    const clockPayload = {
      status: studioState.masterClockStatus,
      round: studioState.currentRoundView || (ev ? ev.current_round : 1) || 1,
      durationMinutes: Math.round(studioState.timerSeconds / 60) || 150,
      duration_minutes: Math.round(studioState.timerSeconds / 60) || 150,
      targetEndTime: studioState.masterClockStatus === 'running' ? studioState.masterClockTargetEnd : null,
      target_end_time: studioState.masterClockStatus === 'running' ? studioState.masterClockTargetEnd : null,
      remainingSeconds: studioState.timerSeconds,
      remaining_seconds: studioState.timerSeconds,
      updatedAt: Date.now(),
      updated_at: Date.now()
    };
    const db = getStudioFirestoreDb();
    if (db) {
      try {
        const docPayload = {
          id: eventId,
          eventId: eventId,
          type: "Event",
          masterClock: clockPayload,
          updatedAt: Date.now()
        };
        db.collection('tournaments').doc(eventId).set(docPayload, { merge: true }).catch(() => {});
        db.collection('events').doc(eventId).set(docPayload, { merge: true }).catch(() => {});
      } catch (e) {}
    }
    propagateMasterClockToFirestoreRoomsDirectly(eventId, clockPayload);
    if (window.api && typeof window.api.updateStudioMasterClock === 'function') {
      window.api.updateStudioMasterClock(eventId, clockPayload).catch(() => {});
    }
  }
}

async function resetRoundTimer() {
  const ev = studioState.activeTournament;
  const eventId = ev ? ev.id : null;
  const defSec = (ev && ev.defaultRoundLength) ? ev.defaultRoundLength : 9000;

  studioState.isTimerRunning = false;
  studioState.masterClockStatus = 'stopped';
  studioState.masterClockTargetEnd = null;
  studioState.timerSeconds = defSec;
  const btn = document.getElementById("btn-timer-toggle");
  if (btn) btn.textContent = "▶️";
  updateTimerDisplay();

  if (eventId) {
    const clockPayload = {
      status: 'stopped',
      round: studioState.currentRoundView || (ev ? ev.current_round : 1) || 1,
      durationMinutes: Math.round(defSec / 60) || 150,
      duration_minutes: Math.round(defSec / 60) || 150,
      targetEndTime: null,
      target_end_time: null,
      remainingSeconds: defSec,
      remaining_seconds: defSec,
      updatedAt: Date.now(),
      updated_at: Date.now()
    };
    const db = getStudioFirestoreDb();
    if (db) {
      try {
        const docPayload = {
          id: eventId,
          eventId: eventId,
          type: "Event",
          masterClock: clockPayload,
          updatedAt: Date.now()
        };
        db.collection('tournaments').doc(eventId).set(docPayload, { merge: true }).catch(() => {});
        db.collection('events').doc(eventId).set(docPayload, { merge: true }).catch(() => {});
      } catch (e) {}
    }
    propagateMasterClockToFirestoreRoomsDirectly(eventId, clockPayload);
    if (window.api && typeof window.api.updateStudioMasterClock === 'function') {
      window.api.updateStudioMasterClock(eventId, clockPayload).catch(() => {});
    }
  }
}

function updateTimerDisplay() {
  const clockEl = document.getElementById("manage-round-clock");
  if (!clockEl) return;

  const hrs = Math.floor(studioState.timerSeconds / 3600);
  const mins = Math.floor((studioState.timerSeconds % 3600) / 60);
  const secs = studioState.timerSeconds % 60;

  clockEl.textContent = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  if (studioState.timerSeconds <= 300 && studioState.masterClockStatus === 'running') {
    clockEl.style.color = '#ef4444';
  } else if (studioState.timerSeconds <= 900 && studioState.masterClockStatus === 'running') {
    clockEl.style.color = '#f59e0b';
  } else {
    clockEl.style.color = '#38bdf8';
  }
}

/* ==========================================================================
   BROADCAST ANNOUNCEMENT DISPATCHER
   ========================================================================== */

function openBroadcastModal() {
  const modal = document.getElementById("modal-studio-broadcast");
  if (modal) {
    modal.style.display = "flex";
    const msgEl = document.getElementById("studio-broadcast-message");
    if (msgEl) {
      msgEl.focus();
    }
  }
}

function closeBroadcastModal() {
  const modal = document.getElementById("modal-studio-broadcast");
  if (modal) {
    modal.style.display = "none";
  }
}

function setBroadcastPreset(msg, type) {
  const msgEl = document.getElementById("studio-broadcast-message");
  const typeEl = document.getElementById("studio-broadcast-type");
  if (msgEl) msgEl.value = msg;
  if (typeEl) typeEl.value = type;
}

async function handleSendBroadcast() {
  const ev = studioState.activeTournament;
  if (!ev) {
    alert("Please open a tournament first.");
    return;
  }
  const msgEl = document.getElementById("studio-broadcast-message");
  const typeEl = document.getElementById("studio-broadcast-type");
  const btn = document.getElementById("btn-submit-studio-broadcast");

  const message = (msgEl ? msgEl.value : "").trim();
  const type = typeEl ? typeEl.value : "info";

  if (!message) {
    alert("Please enter a broadcast message.");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "🚀 Broadcasting...";
  }

  const broadcastData = {
    id: "msg_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
    message: message,
    type: type,
    timestamp: Date.now(),
    author: "Tournament Organizer"
  };

  const db = getStudioFirestoreDb();
  if (db) {
    try {
      await db.collection("tournaments").doc(ev.id).set({
        eventId: ev.id,
        broadcast: broadcastData,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.warn("Notice writing broadcast to Firestore:", e);
    }
  }

  if (window.api && typeof window.api.sendStudioBroadcast === "function") {
    try {
      await window.api.sendStudioBroadcast(ev.id, message, type);
    } catch (e) {
      console.warn("Notice calling broadcast REST API:", e);
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = "🚀 Send Broadcast";
  }
  closeBroadcastModal();
  if (msgEl) msgEl.value = "";
  alert("📢 Broadcast sent to all active table rooms!");
}

/* ==========================================================================
   LIVE FLOOR JUDGE RADAR DESK
   ========================================================================== */

function toggleJudgeAudioAlerts() {
  studioState.judgeAudioEnabled = !studioState.judgeAudioEnabled;
  try {
    localStorage.setItem("studio_judge_audio", studioState.judgeAudioEnabled ? "true" : "false");
  } catch(e) {}
  const btn = document.getElementById("btn-toggle-judge-audio");
  if (btn) {
    btn.textContent = studioState.judgeAudioEnabled ? "🔔 Sound: ON" : "🔕 Sound: OFF";
    btn.style.color = studioState.judgeAudioEnabled ? "#38bdf8" : "var(--text-muted)";
  }
}

function playStudioJudgeChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.45);
  } catch (e) {}
}

let lastPendingCallIds = new Set();

const studioDocJudgeCalls = {};

function subscribeStudioJudgeCalls(eventId) {
  if (studioState.judgeCallsUnsub) {
    try { studioState.judgeCallsUnsub(); } catch (e) {}
    studioState.judgeCallsUnsub = null;
  }
  const db = getStudioFirestoreDb();
  if (!db || !eventId) return;

  const docIds = [eventId];
  if (eventId.toUpperCase() !== eventId) docIds.push(eventId.toUpperCase());

  const unsubs = [];
  docIds.forEach(did => {
    try {
      const u = db.collection("tournaments").doc(did).collection("judge_calls")
        .onSnapshot(snap => {
          const calls = [];
          snap.forEach(doc => {
            const d = doc.data() || {};
            if (!d.id) d.id = doc.id;
            calls.push(d);
          });
          studioDocJudgeCalls[did] = calls;
          handleStudioJudgeCallsUpdate();
        }, err => {
          console.warn("Notice on judge calls listener:", err);
        });
      unsubs.push(u);
    } catch (e) {
      console.warn("Notice initializing judge calls listener:", e);
    }
  });

  studioState.judgeCallsUnsub = () => {
    unsubs.forEach(fn => { try { fn(); } catch(e) {} });
  };
}

function handleStudioJudgeCallsUpdate(incomingCalls) {
  if (Array.isArray(incomingCalls)) {
    studioDocJudgeCalls['incoming'] = incomingCalls;
  }

  const mergedMap = new Map();
  (studioState.judgeCalls || []).forEach(c => {
    const cid = c.id || c.call_id;
    if (cid) mergedMap.set(cid, c);
  });
  (studioState.resolvedJudgeCalls || []).forEach(c => {
    const cid = c.id || c.call_id;
    if (cid) mergedMap.set(cid, c);
  });

  Object.values(studioDocJudgeCalls).forEach(arr => {
    if (Array.isArray(arr)) {
      arr.forEach(c => {
        const cid = c.id || c.call_id;
        if (cid) {
          mergedMap.set(cid, Object.assign({}, mergedMap.get(cid) || {}, c));
        }
      });
    }
  });

  const allCalls = Array.from(mergedMap.values());
  const active = [];
  const resolved = [];
  let hasNewPending = false;
  const currentPending = new Set();

  allCalls.forEach(c => {
    if (c.status === "pending" || c.status === "en_route") {
      active.push(c);
      if (c.status === "pending") {
        currentPending.add(c.id);
        if (!lastPendingCallIds.has(c.id)) {
          hasNewPending = true;
        }
      }
    } else {
      resolved.push(c);
    }
  });

  lastPendingCallIds = currentPending;

  if (hasNewPending && studioState.judgeAudioEnabled) {
    playStudioJudgeChime();
  }

  // Sort active: pending first, then by createdAt ascending (oldest first)
  active.sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });

  resolved.sort((a, b) => (b.resolvedAt || b.createdAt || 0) - (a.resolvedAt || a.createdAt || 0));

  studioState.judgeCalls = active;
  studioState.resolvedJudgeCalls = resolved;

  // Update badge
  const badge = document.getElementById("studio-judge-radar-badge");
  if (badge) {
    if (active.length > 0) {
      badge.textContent = active.length;
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }
  }

  // Update metric counters
  const pendingCount = active.filter(c => c.status === "pending").length;
  const enRouteCount = active.filter(c => c.status === "en_route").length;

  const statPending = document.getElementById("stat-pending-judge-calls");
  const statEnRoute = document.getElementById("stat-enroute-judge-calls");
  const statResolved = document.getElementById("stat-resolved-judge-calls");

  if (statPending) statPending.textContent = pendingCount;
  if (statEnRoute) statEnRoute.textContent = enRouteCount;
  if (statResolved) statResolved.textContent = resolved.length;

  // Render urgent top alert banner (visible across all subtabs when any judge call is active)
  const topBanners = document.querySelectorAll("#studio-active-judge-banner");
  topBanners.forEach(topBanner => {
    if (active.length > 0) {
      const topCall = active[0];
      const callTime = topCall.createdAt || topCall.created_at || (typeof topCall.timestamp === 'number' ? topCall.timestamp : null);
      const elapsedMins = callTime ? Math.max(0, Math.floor((Date.now() - (typeof callTime === 'number' ? callTime : new Date(callTime).getTime())) / 60000)) : 0;
      const callTable = topCall.tableNumber || topCall.tableNum || topCall.table_num || topCall.table || '?';
      const callerDisplay = topCall.callerName || topCall.called_by || topCall.player_name || (typeof topCall.caller === 'string' ? topCall.caller : (topCall.caller && topCall.caller.playerName)) || 'Competitor';
      const callNotes = topCall.notes || topCall.note || '';
      topBanner.style.display = "block";
      topBanner.innerHTML = `
        <div style="background: linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(185, 28, 28, 0.35)); border: 2px solid #ef4444; border-radius: var(--radius-lg); padding: 0.85rem 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; box-shadow: 0 4px 20px rgba(239,68,68,0.3); animation: gt-pulse 2s infinite;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="font-size: 1.6rem; animation: bounce 1s infinite;">🚨</div>
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <span style="font-weight: 800; font-size: 1rem; color: #fff; letter-spacing: 0.02em;">FLOOR JUDGE CALL: TABLE #${callTable}</span>
                <span class="badge" style="background: #ef4444; color: #fff; font-weight: 800; font-size: 0.72rem; padding: 0.2rem 0.5rem;">${escapeHtml(topCall.category || 'Rules Dispute')}</span>
                ${active.length > 1 ? `<span class="badge" style="background: rgba(255,255,255,0.2); color: #fff; font-size: 0.7rem;">+${active.length - 1} more awaiting</span>` : ''}
              </div>
              <div style="font-size: 0.8rem; color: #fca5a5; margin-top: 0.15rem;">
                Called by <strong>${escapeHtml(callerDisplay)}</strong> • Waiting <strong>${elapsedMins}m</strong> • ${callNotes ? `<em>"${escapeHtml(callNotes)}"` : (topCall.status === 'en_route' ? `Judge ${escapeHtml((topCall.assignedJudge && topCall.assignedJudge.name) || topCall.assignedJudge || '')} is en route` : 'Awaiting floor judge response')}
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            ${topCall.status === 'pending' ? `
              <button class="btn" style="background: #0284c7; color: #fff; border: 1px solid #38bdf8; font-weight: 700; font-size: 0.78rem; padding: 0.4rem 0.85rem;" onclick="markJudgeCallEnRoute('${escapeHtml(topCall.id)}')">🏃 En Route</button>
            ` : ''}
            <button class="btn" style="background: #059669; color: #fff; border: 1px solid #10b981; font-weight: 700; font-size: 0.78rem; padding: 0.4rem 0.85rem;" onclick="markJudgeCallResolved('${escapeHtml(topCall.id)}')">✅ Resolve</button>
            <button class="btn btn-outline" style="font-size: 0.78rem; padding: 0.4rem 0.85rem; color: #fff; border-color: rgba(255,255,255,0.4);" onclick="switchManageSubtab('judges')">📋 Floor Radar (${active.length})</button>
          </div>
        </div>
      `;
    } else {
      topBanner.style.display = "none";
      topBanner.innerHTML = "";
    }
  });

  // Re-render pairings subtab if open so table cards reflect the updated judge status immediately
  const pairingsContainer = document.getElementById("manage-pairings-list");
  if (pairingsContainer && (studioState.activeSubtab === "pairings" || pairingsContainer.children.length > 0)) {
    const activeEl = document.activeElement;
    const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
    if (!isInputFocused) {
      renderPairingsSubtab();
    }
  }

  renderJudgesSubtab();
}

function renderJudgesSubtab() {
  const container = document.getElementById("studio-judge-calls-container");
  if (!container) return;

  const active = studioState.judgeCalls || [];
  if (active.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem 1.5rem; color: var(--text-muted); background: rgba(0,0,0,0.2); border: 1px dashed var(--border); border-radius: var(--radius-lg);">
        <span style="font-size: 2rem; display: block; margin-bottom: 0.5rem;">🎉</span>
        <strong style="color: #fff; font-size: 0.95rem;">Floor is clear!</strong>
        <div style="font-size: 0.82rem; margin-top: 0.25rem;">No active player judge calls or rules dispute requests.</div>
      </div>
    `;
  } else {
    container.innerHTML = active.map(c => {
      const waitSec = Math.max(0, Math.floor((Date.now() - (c.createdAt || Date.now())) / 1000));
      const waitMins = Math.floor(waitSec / 60);
      const waitRemSec = waitSec % 60;
      const waitStr = `${waitMins}m ${String(waitRemSec).padStart(2, '0')}s`;
      const isUrgentWait = waitSec > 180;

      const isPending = c.status === "pending";
      const statusColor = isPending ? "#ef4444" : "#38bdf8";
      const statusBg = isPending ? "rgba(239, 68, 68, 0.12)" : "rgba(56, 189, 248, 0.12)";
      const borderCol = isPending ? "rgba(239, 68, 68, 0.4)" : "rgba(56, 189, 248, 0.4)";

      const callerName = (c.caller && c.caller.playerName) || c.playerName || "Competitor";
      const callerFaction = (c.caller && c.caller.faction) || "";
      const oppName = (c.opponent && c.opponent.playerName) || "Opponent";
      const oppFaction = (c.opponent && c.opponent.faction) || "";

      const matchId = c.matchId || c.match_id || "";
      const spectateUrl = matchId ? `/11th/tracker/play?match_id=${encodeURIComponent(matchId)}&role=spectator` : "#";

      return `
        <div class="es-judge-call-card" style="background: var(--bg-card); border: 1px solid ${borderCol}; border-radius: var(--radius-lg); padding: 1.15rem; display: flex; flex-direction: column; gap: 0.85rem; box-shadow: 0 4px 20px rgba(0,0,0,0.35);">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 0.6rem; flex-wrap: wrap; gap: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span style="font-family: var(--font-heading); font-size: 1.15rem; font-weight: 800; color: #fff; background: #0f172a; border: 1px solid ${statusColor}; padding: 0.2rem 0.6rem; border-radius: 6px;">
                TABLE ${c.tableNum || c.table_num || 1}
              </span>
              <span class="badge" style="background: ${statusBg}; color: ${statusColor}; border: 1px solid ${statusColor}; font-weight: 700; font-size: 0.75rem;">
                ${isPending ? '🚨 AWAITING DISPATCH' : `🏃‍♂️ EN ROUTE (${c.assignedJudge ? c.assignedJudge.name : 'Judge'})`}
              </span>
              <span style="font-size: 0.76rem; color: ${isUrgentWait ? '#ef4444' : 'var(--text-muted)'}; font-weight: ${isUrgentWait ? '700' : '500'}; font-family: var(--font-mono);">
                ⏱️ Waiting ${waitStr}
              </span>
            </div>

            <div style="display: flex; align-items: center; gap: 0.5rem;">
              ${matchId ? `
                <a href="${spectateUrl}" target="_blank" class="btn btn-outline" style="font-size: 0.75rem; padding: 0.3rem 0.65rem; color: #38bdf8; text-decoration: none;">
                  👀 Open Table Tracker
                </a>
              ` : ''}
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem;">
            <div>
              <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Issue Category</div>
              <div style="font-weight: 700; color: #fff; font-size: 0.9rem; margin-top: 0.15rem;">
                ${escapeHtml(c.category || 'Rules Dispute')}
              </div>
            </div>

            <div>
              <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Matchup</div>
              <div style="font-size: 0.85rem; margin-top: 0.15rem;">
                <span style="color: #38bdf8; font-weight: 600;">${escapeHtml(callerName)}</span> ${callerFaction ? `<span style="color: var(--text-muted); font-size: 0.75rem;">(${escapeHtml(callerFaction)})</span>` : ''}
                <span style="color: var(--text-muted); font-size: 0.75rem;"> vs </span>
                <span style="color: #cbd5e1; font-weight: 600;">${escapeHtml(oppName)}</span> ${oppFaction ? `<span style="color: var(--text-muted); font-size: 0.75rem;">(${escapeHtml(oppFaction)})</span>` : ''}
              </div>
            </div>
          </div>

          ${c.note ? `
            <div style="background: rgba(0,0,0,0.25); border-left: 3px solid #38bdf8; padding: 0.5rem 0.85rem; border-radius: 0 6px 6px 0; font-size: 0.82rem; color: #cbd5e1;">
              <em>"${escapeHtml(c.note)}"</em>
            </div>
          ` : ''}

          <div style="display: flex; justify-content: flex-end; align-items: center; gap: 0.6rem; border-top: 1px solid var(--border); padding-top: 0.65rem; margin-top: 0.2rem;">
            ${isPending ? `
              <button class="btn btn-primary" onclick="markJudgeCallEnRoute('${c.id}')" style="background: linear-gradient(135deg, #0284c7, #0369a1); border-color: #38bdf8; font-size: 0.8rem; padding: 0.4rem 0.9rem;">
                🏃‍♂️ En Route
              </button>
              <button class="btn btn-outline" onclick="markJudgeCallResolved('${c.id}')" style="color: #10b981; border-color: #10b981; font-size: 0.8rem; padding: 0.4rem 0.9rem;">
                ✅ Mark Resolved
              </button>
              <button class="btn btn-outline" onclick="dismissJudgeCall('${c.id}')" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.35); font-size: 0.8rem; padding: 0.4rem 0.75rem;">
                ✕ Dismiss
              </button>
            ` : `
              <button class="btn btn-primary" onclick="markJudgeCallResolved('${c.id}')" style="background: linear-gradient(135deg, #059669, #10b981); border: none; font-size: 0.8rem; padding: 0.4rem 1.1rem; font-weight: 700;">
                ✅ Complete & Resolve Ruling
              </button>
              <button class="btn btn-outline" onclick="dismissJudgeCall('${c.id}')" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.35); font-size: 0.8rem; padding: 0.4rem 0.75rem;">
                ✕ Cancel Call
              </button>
            `}
          </div>
        </div>
      `;
    }).join("");
  }

  // Render History
  const historyContainer = document.getElementById("studio-judge-history-container");
  const historyCountEl = document.getElementById("studio-judge-history-count");
  const resolved = studioState.resolvedJudgeCalls || [];

  if (historyCountEl) historyCountEl.textContent = resolved.length;
  if (historyContainer) {
    if (resolved.length === 0) {
      historyContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); font-style: italic; padding: 0.5rem 0;">No resolved rulings recorded for this session yet.</div>';
    } else {
      historyContainer.innerHTML = resolved.map(c => {
        const timeStr = c.resolvedAt ? new Date(c.resolvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Earlier';
        const judgeName = (c.assignedJudge && c.assignedJudge.name) ? c.assignedJudge.name : 'Judge Staff';
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.15); border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem 0.85rem; font-size: 0.8rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span style="color: #10b981; font-weight: 700;">✅ Table ${c.tableNum || 1}</span>
              <span style="color: #fff; font-weight: 600;">${escapeHtml(c.category || 'Ruling')}</span>
              <span style="color: var(--text-muted);">(${escapeHtml((c.caller && c.caller.playerName) || 'Competitor')})</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span style="color: #38bdf8;">Resolved by ${escapeHtml(judgeName)}</span>
              <span style="color: var(--text-muted); font-family: var(--font-mono); font-size: 0.72rem;">${timeStr}</span>
            </div>
          </div>
        `;
      }).join("");
    }
  }
}

async function markJudgeCallEnRoute(callId) {
  const ev = studioState.activeTournament;
  if (!ev) return;
  const nameInput = document.getElementById("studio-judge-responder-name");
  let judgeName = (nameInput ? nameInput.value : "").trim() || "Floor Judge";

  const call = (studioState.judgeCalls || []).find(c => c.id === callId);
  const matchId = call ? (call.matchId || call.match_id) : null;
  const targetDocIds = [ev.id];
  if (ev.id.toUpperCase() !== ev.id) targetDocIds.push(ev.id.toUpperCase());
  if (call && (call.eventId || call.event_id)) {
    const cEid = String(call.eventId || call.event_id).trim();
    if (cEid && !targetDocIds.includes(cEid)) targetDocIds.push(cEid);
  }

  const db = getStudioFirestoreDb();
  if (db) {
    try {
      for (const dId of targetDocIds) {
        // 1. Update subcollection
        await db.collection("tournaments").doc(dId).collection("judge_calls").doc(callId).set({
          status: "en_route",
          assignedJudge: { name: judgeName },
          assigned_judge: judgeName,
          enRouteAt: Date.now(),
          updatedAt: Date.now()
        }, { merge: true });

        // 2. Update main Event document arrays (tournaments & events)
        const updateDocCalls = async (ref) => {
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
                    status: "en_route",
                    assignedJudge: { name: judgeName },
                    assigned_judge: judgeName,
                    enRouteAt: Date.now(),
                    updatedAt: Date.now()
                  });
                }
                return c;
              });
              if (changed) {
                await ref.set({ judge_calls: list, flags: list, updatedAt: Date.now() }, { merge: true });
              }
            }
          } catch(e) {}
        };
        updateDocCalls(db.collection("tournaments").doc(dId));
        updateDocCalls(db.collection("events").doc(dId));
      }

      // 3. Update table match room
      if (matchId) {
        await db.collection("rooms").doc(matchId).set({
          active_judge_call: {
            id: callId,
            call_id: callId,
            status: "en_route",
            assignedJudge: { name: judgeName },
            assigned_judge: judgeName,
            tableNum: call ? call.tableNum : 1,
            category: call ? call.category : "Rules Dispute"
          }
        }, { merge: true });
      }
    } catch (e) {
      console.warn("Notice updating Firestore judge call:", e);
    }
  }

  if (window.api && typeof window.api.resolveJudgeCall === "function") {
    try {
      await window.api.resolveJudgeCall({
        call_id: callId,
        status: "en_route",
        assigned_judge: judgeName,
        event_id: ev.id,
        match_id: matchId
      });
    } catch (e) {}
  }
}

async function markJudgeCallResolved(callId) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const call = (studioState.judgeCalls || []).find(c => c.id === callId);
  const matchId = call ? (call.matchId || call.match_id) : null;
  const targetDocIds = [ev.id];
  if (ev.id.toUpperCase() !== ev.id) targetDocIds.push(ev.id.toUpperCase());
  if (call && (call.eventId || call.event_id)) {
    const cEid = String(call.eventId || call.event_id).trim();
    if (cEid && !targetDocIds.includes(cEid)) targetDocIds.push(cEid);
  }

  const db = getStudioFirestoreDb();
  if (db) {
    try {
      for (const dId of targetDocIds) {
        // 1. Update subcollection
        await db.collection("tournaments").doc(dId).collection("judge_calls").doc(callId).set({
          status: "resolved",
          resolvedAt: Date.now(),
          updatedAt: Date.now()
        }, { merge: true });

        // 2. Update main Event document arrays
        const updateDocCalls = async (ref) => {
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
                    status: "resolved",
                    resolvedAt: Date.now(),
                    updatedAt: Date.now()
                  });
                }
                return c;
              });
              if (changed) {
                await ref.set({ judge_calls: list, flags: list, updatedAt: Date.now() }, { merge: true });
              }
            }
          } catch(e) {}
        };
        updateDocCalls(db.collection("tournaments").doc(dId));
        updateDocCalls(db.collection("events").doc(dId));
      }

      // 3. Update table match room
      if (matchId) {
        await db.collection("rooms").doc(matchId).set({
          active_judge_call: {
            id: callId,
            call_id: callId,
            status: "resolved",
            resolvedAt: Date.now()
          }
        }, { merge: true });
      }
    } catch (e) {
      console.warn("Notice resolving Firestore judge call:", e);
    }
  }

  if (window.api && typeof window.api.resolveJudgeCall === "function") {
    try {
      await window.api.resolveJudgeCall({
        call_id: callId,
        status: "resolved",
        event_id: ev.id,
        match_id: matchId
      });
    } catch (e) {}
  }
}

async function dismissJudgeCall(callId) {
  const ev = studioState.activeTournament;
  if (!ev) return;

  const call = (studioState.judgeCalls || []).find(c => c.id === callId);
  const matchId = call ? (call.matchId || call.match_id) : null;
  const targetDocIds = [ev.id];
  if (ev.id.toUpperCase() !== ev.id) targetDocIds.push(ev.id.toUpperCase());
  if (call && (call.eventId || call.event_id)) {
    const cEid = String(call.eventId || call.event_id).trim();
    if (cEid && !targetDocIds.includes(cEid)) targetDocIds.push(cEid);
  }

  const db = getStudioFirestoreDb();
  if (db) {
    try {
      for (const dId of targetDocIds) {
        // 1. Update subcollection
        await db.collection("tournaments").doc(dId).collection("judge_calls").doc(callId).set({
          status: "cancelled",
          resolvedAt: Date.now(),
          updatedAt: Date.now()
        }, { merge: true });

        // 2. Update main Event document arrays
        const updateDocCalls = async (ref) => {
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
                    status: "cancelled",
                    resolvedAt: Date.now(),
                    updatedAt: Date.now()
                  });
                }
                return c;
              });
              if (changed) {
                await ref.set({ judge_calls: list, flags: list, updatedAt: Date.now() }, { merge: true });
              }
            }
          } catch(e) {}
        };
        updateDocCalls(db.collection("tournaments").doc(dId));
        updateDocCalls(db.collection("events").doc(dId));
      }

      // 3. Clear match room call
      if (matchId) {
        await db.collection("rooms").doc(matchId).set({
          active_judge_call: null
        }, { merge: true });
      }
    } catch (e) {}
  }

  if (window.api && typeof window.api.resolveJudgeCall === "function") {
    try {
      await window.api.resolveJudgeCall({
        call_id: callId,
        status: "cancelled",
        event_id: ev.id,
        match_id: matchId
      });
    } catch (e) {}
  }
}

async function refreshJudgeCalls() {
  const ev = studioState.activeTournament;
  if (!ev) return;
  if (window.api && typeof window.api.getJudgeCalls === "function") {
    try {
      const res = await window.api.getJudgeCalls(ev.id, false);
      if (res && res.calls) {
        handleStudioJudgeCallsUpdate(res.calls);
      }
    } catch (e) {}
  }
}

window.toggleRoundTimer = toggleRoundTimer;
window.adjustRoundTimer = adjustRoundTimer;
window.resetRoundTimer = resetRoundTimer;
window.openBroadcastModal = openBroadcastModal;
window.closeBroadcastModal = closeBroadcastModal;
window.setBroadcastPreset = setBroadcastPreset;
window.handleSendBroadcast = handleSendBroadcast;
window.toggleJudgeAudioAlerts = toggleJudgeAudioAlerts;
window.refreshJudgeCalls = refreshJudgeCalls;
window.markJudgeCallEnRoute = markJudgeCallEnRoute;
window.markJudgeCallResolved = markJudgeCallResolved;
window.dispatchJudgeEnRoute = markJudgeCallEnRoute;
window.resolveJudgeCall = markJudgeCallResolved;
window.dismissJudgeCall = dismissJudgeCall;
window.renderJudgesSubtab = renderJudgesSubtab;

function exportStandingsCsv() {
  const ev = studioState.activeTournament;
  if (!ev) return;

  window.api.getStudioStandings(ev.id).then(res => {
    const standings = (res && res.standings) ? res.standings : [];
    if (standings.length === 0) {
      alert("No standings to export.");
      return;
    }

    let csv = "Rank,Player Name,Faction,Record,Swiss Points,SoS Opp Win %,Battle Points,Battle Points Diff\n";
    standings.forEach(s => {
      csv += `${s.rank},"${s.name}","${s.faction}",${s.wins}-${s.losses}-${s.draws},${s.swiss_points},${s.opp_win_rate_sos}%,${s.battle_points},${s.battle_points_diff}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${ev.name.replace(/\s+/g, '_')}_Standings.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}

async function deleteStudioTournament(eventId) {
  if (!confirm(`Are you sure you want to delete tournament "${eventId}"? This action cannot be undone.`)) {
    return;
  }

  // 1. Instant Optimistic UI Update: remove tournament immediately from list and DOM
  studioState.eventsList = (studioState.eventsList || []).filter(e => e.id !== eventId);
  renderEventsDirectory();

  // Remove matching cards from DOM immediately
  document.querySelectorAll(`.es-event-card[data-event-id="${eventId}"]`).forEach(el => el.remove());

  if (typeof loadTournaments === 'function') {
    try { loadTournaments(); } catch(e) {}
  }
  if (typeof loadEvents === 'function') {
    try { loadEvents(); } catch(e) {}
  }
  window.dispatchEvent(new CustomEvent('tournaments-updated', { detail: { eventId, action: 'delete' } }));

  // Direct client-side Firestore cleanup if active
  const db = getStudioFirestoreDb();
  if (db && eventId) {
    try {
      db.collection('tournaments').doc(eventId).delete().catch(() => {});
      const cleanEid = eventId.replace(/^bcp_/i, '').replace(/^es-/i, '').trim().toUpperCase();
      const ev = studioState.activeTournament;
      if (ev && (ev.id === eventId || cleanEid)) {
        const totalRounds = ev.num_rounds || ev.rounds || 5;
        for (let r = 1; r <= totalRounds; r++) {
          const roundPairings = (ev.pairings || {})[String(r)] || [];
          roundPairings.forEach(match => {
            const table = match.table || 1;
            db.collection('rooms').doc(`BCP-${eventId}-R${r}-T${table}`.toUpperCase()).delete().catch(() => {});
            db.collection('rooms').doc(`ES-${eventId}-R${r}-T${table}`.toUpperCase()).delete().catch(() => {});
            if (cleanEid) {
              db.collection('rooms').doc(`BCP-${cleanEid}-R${r}-T${table}`).delete().catch(() => {});
              db.collection('rooms').doc(`ES-${cleanEid}-R${r}-T${table}`).delete().catch(() => {});
            }
          });
        }
      }
    } catch (e) {
      console.debug("Notice during client Firestore delete cleanup:", e);
    }
  }

  try {
    const res = await window.api.deleteStudioEvent(eventId);
    if (!res || !res.success) {
      alert(res?.message || "Could not delete tournament from server.");
      await loadStudioEvents();
    }
  } catch (err) {
    console.error("Delete error:", err);
    alert(`Delete failed: ${err.message || err}`);
    await loadStudioEvents();
  }
}

function updateDefaultRounds() {
  const format = document.getElementById("create-event-format");
  const roundsInput = document.getElementById("create-event-rounds");
  if (!format || !roundsInput) return;

  const val = format.value;
  if (val === "RTT") roundsInput.value = "3";
  else if (val === "GT") roundsInput.value = "5";
  else if (val === "Major") roundsInput.value = "6";
  else if (val === "League") roundsInput.value = "4";
}

function onGameSystemChange() {
  const gs = document.getElementById("create-event-game-system");
  const nameInput = document.getElementById("create-event-name");
  const roundLen = document.getElementById("create-event-round-length");
  if (!gs) return;
  if (gs.value === "OY8FCPBf6O" || gs.value === "23qDprPABN") {
    if (nameInput && (!nameInput.value || nameInput.placeholder.includes("40k") || nameInput.placeholder.includes("40K"))) {
      nameInput.placeholder = "e.g. Adepticon Age of Sigmar Grand Tournament 2026";
    }
    if (roundLen && roundLen.value === "9000") {
      roundLen.value = "9900"; // 165 minutes standard AoS
    }
  } else if (gs.value === "WGMSzfKFYA") {
    if (nameInput && nameInput.placeholder.includes("Sigmar")) {
      nameInput.placeholder = "e.g. Pacific Northwest 40K Grand Tournament 2026";
    }
    if (roundLen && roundLen.value === "9900") {
      roundLen.value = "9000"; // 150 minutes standard 40k
    }
  }
}

function escapeHtml(str) {
  if (typeof window !== 'undefined' && typeof window.escapeHtml === 'function' && window.escapeHtml !== escapeHtml) {
    return window.escapeHtml(str);
  }
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Global window bindings for Event Studio
window.initStudio = initStudio;
window.loadStudioEvents = loadStudioEvents;
window.refreshStudioEvents = refreshStudioEvents;
window.refreshTournamentWorkspace = refreshTournamentWorkspace;
window.switchStudioTab = switchStudioTab;
window.renderEventsDirectory = renderEventsDirectory;
window.submitCreateTournament = submitCreateTournament;
window.deleteStudioTournament = deleteStudioTournament;
window.updateDefaultRounds = updateDefaultRounds;
window.onGameSystemChange = onGameSystemChange;
window.loadTournamentWorkspace = loadTournamentWorkspace;
window.switchManageSubtab = switchManageSubtab;
window.triggerGenerateSwissPairings = triggerGenerateSwissPairings;
window.saveTableScore = saveTableScore;
const advanceTournamentRound = (typeof finalizeCurrentRound === 'function') ? finalizeCurrentRound : () => {};
window.advanceTournamentRound = advanceTournamentRound;
window.finalizeCurrentRound = finalizeCurrentRound;
window.resetCurrentRound = resetCurrentRound;
window.selectRoundView = selectRoundView;
window.openAddPlayerModal = openAddPlayerModal;
window.closeAddPlayerModal = closeAddPlayerModal;
window.submitAddPlayer = submitAddPlayer;
window.toggleCheckIn = toggleCheckIn;
window.toggleDropPlayer = toggleDropPlayer;
window.removePlayer = removePlayer;
window.bulkCheckInPlayers = bulkCheckInPlayers;
window.filterRosterTable = filterRosterTable;
window.toggleRoundTimer = toggleRoundTimer;
window.exportStandingsCsv = exportStandingsCsv;
window.openEditTournamentModal = openEditTournamentModal;
window.closeEditTournamentModal = closeEditTournamentModal;
window.saveEditedTournament = saveEditedTournament;
window.toggleTeamOptions = toggleTeamOptions;
window.openCircuitsModal = openCircuitsModal;
window.closeCircuitsModal = closeCircuitsModal;
window.submitLinkCircuitFromModal = submitLinkCircuitFromModal;
window.startTournamentEvent = startTournamentEvent;
window.applyPairingsToBcp = applyPairingsToBcp;
window.openSwapModal = openSwapModal;
window.closeSwapModal = closeSwapModal;
window.submitSwapPlayers = submitSwapPlayers;
window.addPairingTable = addPairingTable;
window.toggleTableBye = toggleTableBye;
window.removePairingTable = removePairingTable;
window.toggleCreateRegMode = toggleCreateRegMode;
window.toggleSettingsRegMode = toggleSettingsRegMode;
window.renderSettingsSubtab = renderSettingsSubtab;
window.saveTournamentSettings = saveTournamentSettings;
window.startStudioPolling = startStudioPolling;
window.stopStudioPolling = stopStudioPolling;
window.pollTournamentWorkspaceQuietly = pollTournamentWorkspaceQuietly;
window.flashLiveSyncIndicator = flashLiveSyncIndicator;

function openStudioPublicListing(event) {
  if (event) {
    try { event.preventDefault(); } catch(e) {}
  }
  const ev = studioState.activeTournament;
  if (!ev) {
    alert("No active tournament is currently loaded.");
    return;
  }
  const bcpId = ev.bcp_id || ev.id;
  if (!bcpId || String(bcpId).startsWith('ES-')) {
    alert("This tournament was created locally in Event Studio and does not have an external Best Coast Pairings public listing.");
    return;
  }
  const cleanId = String(bcpId).replace(/^event\//, '').trim();
  const url = ev.bcp_url || `https://www.bestcoastpairings.com/event/${encodeURIComponent(cleanId)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
window.openStudioPublicListing = openStudioPublicListing;

function toggleTeamOptions(context) {
  const typeEl = document.getElementById(`${context}-event-type`);
  const groupEl = document.getElementById(`${context}-team-size-group`);
  if (!typeEl || !groupEl) return;
  if (typeEl.value === "Teams Event") {
    groupEl.style.display = "block";
  } else {
    groupEl.style.display = "none";
  }
}

async function openCircuitsModal() {
  const ev = studioState.activeTournament;
  if (!ev) return;
  const modal = document.getElementById("es-circuits-modal");
  if (modal) modal.classList.add("active");

  renderActiveCircuitsList();

  // Load latest circuits list from BCP if available
  try {
    const res = await window.api.getStudioCircuits();
    if (res && res.success && Array.isArray(res.circuits)) {
      const select = document.getElementById("modal-circuit-select");
      if (select) {
        select.innerHTML = res.circuits.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
      }
    }
  } catch (e) {
    console.warn("Could not refresh circuits list from BCP:", e);
  }
}

function closeCircuitsModal() {
  const modal = document.getElementById("es-circuits-modal");
  if (modal) modal.classList.remove("active");
}

function renderActiveCircuitsList() {
  const ev = studioState.activeTournament;
  const listEl = document.getElementById("circuits-active-list");
  if (!listEl) return;
  const circuits = Array.isArray(ev?.circuits) ? ev.circuits : [];
  if (circuits.length === 0) {
    listEl.innerHTML = `
      <div style="font-size: 0.82rem; color: var(--text-muted); font-style: italic; padding: 0.75rem; background: rgba(255,255,255,0.02); border-radius: 6px; border: 1px dashed var(--border);">
        No circuits linked yet. Select a circuit below to link this tournament.
      </div>
    `;
    return;
  }
  listEl.innerHTML = circuits.map(c => `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.65rem 0.85rem; background: rgba(234, 179, 8, 0.08); border: 1px solid rgba(234, 179, 8, 0.25); border-radius: 6px;">
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <span style="font-size: 1.1rem;">🏆</span>
        <span style="font-size: 0.85rem; font-weight: 700; color: #facc15;">${c.name || 'Tournament Circuit'}</span>
      </div>
      <span class="badge badge-online" style="font-size: 0.7rem;">LINKED & SYNCED</span>
    </div>
  `).join("");
}

async function submitLinkCircuitFromModal() {
  const ev = studioState.activeTournament;
  if (!ev) return;
  const select = document.getElementById("modal-circuit-select");
  const tokenInput = document.getElementById("modal-circuit-token");
  const btn = document.getElementById("modal-circuit-submit-btn");
  const statusEl = document.getElementById("modal-circuit-status");

  const circuitId = select ? select.value : "";
  if (!circuitId) {
    alert("Please select a circuit to link.");
    return;
  }
  const circuitName = select.options[select.selectedIndex]?.text || "Tournament Circuit";
  const tokenCode = tokenInput ? tokenInput.value.trim() : "";

  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Submitting to BCP Circuit...";
  }
  if (statusEl) {
    statusEl.style.display = "block";
    statusEl.style.background = "rgba(56, 189, 248, 0.1)";
    statusEl.style.color = "#38bdf8";
    statusEl.textContent = `Linking tournament to ${circuitName} on Best Coast Pairings...`;
  }

  try {
    const res = await window.api.submitStudioEventCircuit(ev.id, {
      circuit_id: circuitId,
      token_code: tokenCode,
      circuit_name: circuitName
    });

    if (res && res.success) {
      if (!Array.isArray(ev.circuits)) ev.circuits = [];
      if (!ev.circuits.some(c => c.id === circuitId)) {
        ev.circuits.push({ id: circuitId, name: circuitName });
      }
      renderActiveCircuitsList();

      // Update workspace circuit badges
      const circuitBadgesEl = document.getElementById("manage-event-circuit-badges");
      if (circuitBadgesEl) {
        circuitBadgesEl.innerHTML = "";
        ev.circuits.forEach(c => {
          const badge = document.createElement("span");
          badge.className = "badge";
          badge.style.background = "rgba(234, 179, 8, 0.15)";
          badge.style.color = "#facc15";
          badge.style.border = "1px solid rgba(234, 179, 8, 0.4)";
          badge.textContent = `🏆 ${c.name || 'Circuit'}`;
          circuitBadgesEl.appendChild(badge);
        });
      }

      if (statusEl) {
        statusEl.style.background = "rgba(34, 197, 94, 0.1)";
        statusEl.style.color = "#22c55e";
        statusEl.textContent = `✅ Successfully linked to ${circuitName}!`;
      }
    } else {
      if (statusEl) {
        statusEl.style.background = "rgba(239, 68, 68, 0.1)";
        statusEl.style.color = "#ef4444";
        statusEl.textContent = res?.error || "Failed to link circuit.";
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.style.background = "rgba(239, 68, 68, 0.1)";
      statusEl.style.color = "#ef4444";
      statusEl.textContent = "Error: " + err.message;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🏆 Link Tournament to Circuit";
    }
  }
}

/* ==========================================================================
   EVENT STUDIO: VERIFIED LOCATION AUTOCOMPLETE & GEOCODING
   ========================================================================== */

let studioLocDebounceTimer = null;
let studioLocCurrentMatches = [];

const POPULAR_STUDIO_HUBS = [
  { city: "San Diego", state: "CA", country: "United States", lat: 32.7157, lng: -117.1611, label: "San Diego, CA, United States" },
  { city: "Los Angeles", state: "CA", country: "United States", lat: 34.0522, lng: -118.2437, label: "Los Angeles, CA, United States" },
  { city: "San Francisco", state: "CA", country: "United States", lat: 37.7749, lng: -122.4194, label: "San Francisco, CA, United States" },
  { city: "San Jose", state: "CA", country: "United States", lat: 37.3382, lng: -121.8863, label: "San Jose, CA, United States" },
  { city: "Sacramento", state: "CA", country: "United States", lat: 38.5816, lng: -121.4944, label: "Sacramento, CA, United States" },
  { city: "Austin", state: "TX", country: "United States", lat: 30.2672, lng: -97.7431, label: "Austin, TX, United States" },
  { city: "Dallas", state: "TX", country: "United States", lat: 32.7767, lng: -96.7970, label: "Dallas, TX, United States" },
  { city: "Houston", state: "TX", country: "United States", lat: 29.7604, lng: -95.3698, label: "Houston, TX, United States" },
  { city: "San Antonio", state: "TX", country: "United States", lat: 29.4241, lng: -98.4936, label: "San Antonio, TX, United States" },
  { city: "Fort Worth", state: "TX", country: "United States", lat: 32.7555, lng: -97.3308, label: "Fort Worth, TX, United States" },
  { city: "Seattle", state: "WA", country: "United States", lat: 47.6062, lng: -122.3321, label: "Seattle, WA, United States" },
  { city: "Tacoma", state: "WA", country: "United States", lat: 47.2529, lng: -122.4443, label: "Tacoma, WA, United States" },
  { city: "Portland", state: "OR", country: "United States", lat: 45.5152, lng: -122.6784, label: "Portland, OR, United States" },
  { city: "Chicago", state: "IL", country: "United States", lat: 41.8781, lng: -87.6298, label: "Chicago, IL, United States" },
  { city: "New York", state: "NY", country: "United States", lat: 40.7128, lng: -74.0060, label: "New York, NY, United States" },
  { city: "Brooklyn", state: "NY", country: "United States", lat: 40.6782, lng: -73.9442, label: "Brooklyn, NY, United States" },
  { city: "Atlanta", state: "GA", country: "United States", lat: 33.7490, lng: -84.3880, label: "Atlanta, GA, United States" },
  { city: "Denver", state: "CO", country: "United States", lat: 39.7392, lng: -104.9903, label: "Denver, CO, United States" },
  { city: "Phoenix", state: "AZ", country: "United States", lat: 33.4484, lng: -112.0740, label: "Phoenix, AZ, United States" },
  { city: "Las Vegas", state: "NV", country: "United States", lat: 36.1699, lng: -115.1398, label: "Las Vegas, NV, United States" },
  { city: "Salt Lake City", state: "UT", country: "United States", lat: 40.7608, lng: -111.8910, label: "Salt Lake City, UT, United States" },
  { city: "Orlando", state: "FL", country: "United States", lat: 28.5383, lng: -81.3792, label: "Orlando, FL, United States" },
  { city: "Tampa", state: "FL", country: "United States", lat: 27.9506, lng: -82.4572, label: "Tampa, FL, United States" },
  { city: "Miami", state: "FL", country: "United States", lat: 25.7617, lng: -80.1918, label: "Miami, FL, United States" },
  { city: "Minneapolis", state: "MN", country: "United States", lat: 44.9778, lng: -93.2650, label: "Minneapolis, MN, United States" },
  { city: "Philadelphia", state: "PA", country: "United States", lat: 39.9526, lng: -75.1652, label: "Philadelphia, PA, United States" },
  { city: "Boston", state: "MA", country: "United States", lat: 42.3601, lng: -71.0589, label: "Boston, MA, United States" },
  { city: "Washington", state: "DC", country: "United States", lat: 38.9072, lng: -77.0369, label: "Washington, DC, United States" },
  { city: "Detroit", state: "MI", country: "United States", lat: 42.3314, lng: -83.0458, label: "Detroit, MI, United States" },
  { city: "Columbus", state: "OH", country: "United States", lat: 39.9612, lng: -82.9988, label: "Columbus, OH, United States" },
  { city: "Indianapolis", state: "IN", country: "United States", lat: 39.7684, lng: -86.1581, label: "Indianapolis, IN, United States" },
  { city: "Nashville", state: "TN", country: "United States", lat: 36.1627, lng: -86.7816, label: "Nashville, TN, United States" },
  { city: "Charlotte", state: "NC", country: "United States", lat: 35.2271, lng: -80.8431, label: "Charlotte, NC, United States" },
  { city: "London", state: "Greater London", country: "United Kingdom", lat: 51.5074, lng: -0.1278, label: "London, United Kingdom" },
  { city: "Nottingham", state: "Nottinghamshire", country: "United Kingdom", lat: 52.9548, lng: -1.1581, label: "Nottingham, United Kingdom" },
  { city: "Manchester", state: "Greater Manchester", country: "United Kingdom", lat: 53.4808, lng: -2.2426, label: "Manchester, United Kingdom" },
  { city: "Toronto", state: "ON", country: "Canada", lat: 43.6532, lng: -79.3832, label: "Toronto, ON, Canada" },
  { city: "Vancouver", state: "BC", country: "Canada", lat: 49.2827, lng: -123.1207, label: "Vancouver, BC, Canada" },
  { city: "Montreal", state: "QC", country: "Canada", lat: 45.5017, lng: -73.5673, label: "Montreal, QC, Canada" },
  { city: "Sydney", state: "NSW", country: "Australia", lat: -33.8688, lng: 151.2093, label: "Sydney, NSW, Australia" },
  { city: "Melbourne", state: "VIC", country: "Australia", lat: -37.8136, lng: 144.9631, label: "Melbourne, VIC, Australia" },
  { city: "Paris", state: "Île-de-France", country: "France", lat: 48.8566, lng: 2.3522, label: "Paris, France" },
  { city: "Berlin", state: "Berlin", country: "Germany", lat: 52.5200, lng: 13.4050, label: "Berlin, Germany" }
];

function findLocalHubMatch(text) {
  if (!text) return null;
  const clean = text.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!clean) return null;
  
  // Exact city match
  for (const hub of POPULAR_STUDIO_HUBS) {
    const hubClean = hub.city.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean === hubClean) return hub;
  }
  // Check if query starts with city or city starts with query
  for (const hub of POPULAR_STUDIO_HUBS) {
    const hubClean = hub.city.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.startsWith(hubClean) || hubClean.startsWith(clean)) return hub;
  }
  // Check includes
  for (const hub of POPULAR_STUDIO_HUBS) {
    const hubLabelClean = hub.label.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (hubLabelClean.includes(clean)) return hub;
  }
  return null;
}

let studioLocHighlightedIdx = -1;

function handleStudioLocationFocus() {
  const input = document.getElementById("create-event-city-state");
  if (!input) return;
  const query = (input.value || "").trim();
  studioLocHighlightedIdx = -1;
  if (!query || query === "San Diego, CA, United States") {
    renderStudioLocationDropdown(POPULAR_STUDIO_HUBS.slice(0, 10));
  } else {
    handleStudioLocationInput(query);
  }
}

function handleStudioLocationKeydown(e) {
  const dropdown = document.getElementById("create-event-loc-dropdown");
  if (!dropdown || dropdown.style.display === "none") return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (studioLocCurrentMatches.length === 0) return;
    studioLocHighlightedIdx = (studioLocHighlightedIdx + 1) % studioLocCurrentMatches.length;
    updateStudioDropdownHighlight();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (studioLocCurrentMatches.length === 0) return;
    studioLocHighlightedIdx = (studioLocHighlightedIdx - 1 + studioLocCurrentMatches.length) % studioLocCurrentMatches.length;
    updateStudioDropdownHighlight();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (studioLocCurrentMatches.length > 0) {
      const idx = studioLocHighlightedIdx >= 0 ? studioLocHighlightedIdx : 0;
      selectStudioLocationByIndex(idx);
    }
  } else if (e.key === "Escape") {
    dropdown.style.display = "none";
  }
}

function updateStudioDropdownHighlight() {
  const dropdown = document.getElementById("create-event-loc-dropdown");
  if (!dropdown) return;
  const items = dropdown.querySelectorAll(".es-loc-item");
  items.forEach((el, i) => {
    if (i === studioLocHighlightedIdx) {
      el.style.background = "rgba(56,189,248,0.2)";
      el.style.borderColor = "rgba(56,189,248,0.5)";
      el.scrollIntoView({ block: "nearest" });
    } else {
      el.style.background = "rgba(255,255,255,0.02)";
      el.style.borderColor = "rgba(255,255,255,0.06)";
    }
  });
}

function handleStudioLocationInput(val) {
  const badge = document.getElementById("create-event-loc-badge");
  const verifiedFlag = document.getElementById("create-event-loc-verified");
  const spinner = document.getElementById("create-event-loc-spinner");
  const dropdown = document.getElementById("create-event-loc-dropdown");

  const query = (val || "").trim();
  const qLower = query.toLowerCase();

  // Instant local lookup from 60+ verified tournament hubs
  const localMatches = POPULAR_STUDIO_HUBS.filter(h => 
    h.city.toLowerCase().includes(qLower) || 
    h.label.toLowerCase().includes(qLower)
  );

  // Check direct exact match
  const directMatch = findLocalHubMatch(query);
  if (directMatch && (directMatch.city.toLowerCase() === qLower || directMatch.label.toLowerCase() === qLower)) {
    if (verifiedFlag) verifiedFlag.value = "true";
    const elCity = document.getElementById("create-event-loc-city");
    const elState = document.getElementById("create-event-loc-state");
    const elCountry = document.getElementById("create-event-loc-country");
    const elLat = document.getElementById("create-event-loc-lat");
    const elLng = document.getElementById("create-event-loc-lng");
    if (elCity) elCity.value = directMatch.city;
    if (elState) elState.value = directMatch.state || "";
    if (elCountry) elCountry.value = directMatch.country || "United States";
    if (elLat) elLat.value = directMatch.lat;
    if (elLng) elLng.value = directMatch.lng;
    if (badge) {
      badge.style.background = "rgba(16,185,129,0.15)";
      badge.style.color = "#10b981";
      badge.style.borderColor = "rgba(16,185,129,0.3)";
      badge.textContent = "✓ Verified Location";
    }
  } else {
    if (verifiedFlag) verifiedFlag.value = "false";
    if (badge) {
      badge.style.background = "rgba(245,158,11,0.15)";
      badge.style.color = "#f59e0b";
      badge.style.borderColor = "rgba(245,158,11,0.3)";
      badge.textContent = "📍 Select from Suggestions";
    }
  }

  if (!query) {
    renderStudioLocationDropdown(POPULAR_STUDIO_HUBS.slice(0, 10));
    return;
  }

  // Render local matches instantly without waiting for network
  if (localMatches.length > 0) {
    renderStudioLocationDropdown(localMatches);
  }

  clearTimeout(studioLocDebounceTimer);
  studioLocDebounceTimer = setTimeout(async () => {
    if (spinner) spinner.style.display = "block";

    let remoteMatches = [];
    try {
      const serverResp = await fetch(`/api/eventstudio/locations/search?q=${encodeURIComponent(query)}`);
      if (serverResp.ok) {
        const data = await serverResp.json();
        if (data && data.results && data.results.length > 0) {
          remoteMatches = data.results;
        }
      }
    } catch (e) {
      try {
        const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&osm_tag=place:city&osm_tag=place:town`;
        const resp = await fetch(photonUrl, { headers: { "Accept": "application/json" } });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.features) {
            remoteMatches = data.features.map(f => {
              const p = f.properties || {};
              const city = p.name || p.city || p.town || "";
              const state = p.state || p.county || "";
              const country = p.country || "";
              const coords = (f.geometry && f.geometry.coordinates) || [0, 0];
              const parts = [city, state, country].filter(Boolean);
              return {
                city: city,
                state: state,
                country: country || "United States",
                lat: coords[1],
                lng: coords[0],
                label: parts.join(", ")
              };
            }).filter(m => m.city);
          }
        }
      } catch (err) {}
    }

    // Merge and deduplicate
    const seen = new Set();
    const combined = [];
    for (const m of [...localMatches, ...remoteMatches]) {
      const key = `${m.city.toLowerCase()}_${(m.state || "").toLowerCase()}_${(m.country || "").toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(m);
      }
      if (combined.length >= 10) break;
    }

    if (spinner) spinner.style.display = "none";
    renderStudioLocationDropdown(combined);
  }, 150);
}

function renderStudioLocationDropdown(items) {
  const dropdown = document.getElementById("create-event-loc-dropdown");
  if (!dropdown) return;

  studioLocCurrentMatches = items || [];
  studioLocHighlightedIdx = -1;

  if (!items || items.length === 0) {
    dropdown.innerHTML = `<div style="padding: 12px; font-size: 0.82rem; color: #94a3b8; text-align: center;">No matching locations found. Try typing another city or state name.</div>`;
    dropdown.style.display = "block";
    return;
  }

  let html = `<div style="padding: 6px 10px 6px; font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center;">
    <span>Matching Locations</span>
    <span style="color:#38bdf8; font-size:0.68rem;">Click or press Enter</span>
  </div>`;

  items.forEach((item, idx) => {
    const subText = [item.state, item.country].filter(Boolean).join(", ");
    html += `
      <div class="es-loc-item" data-idx="${idx}"
           onmousedown="event.preventDefault(); window.selectStudioLocationByIndex(${idx})"
           ontouchstart="event.preventDefault(); window.selectStudioLocationByIndex(${idx})"
           onmouseover="studioLocHighlightedIdx = ${idx}; updateStudioDropdownHighlight();"
           style="padding: 8px 12px; cursor: pointer; border-radius: 7px; margin-top: 3px; transition: all 0.15s; display: flex; align-items: center; justify-content: space-between; gap: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);">
        <div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1rem; color: #38bdf8;">📍</span>
          <div style="min-width: 0; flex: 1;">
            <div style="font-size: 0.86rem; font-weight: 700; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(item.city)}
            </div>
            <div style="font-size: 0.72rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(subText)}
            </div>
          </div>
        </div>
        <span style="background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.35); font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 5px; white-space: nowrap;">
          Select
        </span>
      </div>
    `;
  });

  html += `<div style="padding: 6px 10px 2px; font-size: 0.66rem; color: #475569; text-align: right;">Global Places & Tournament Hubs</div>`;

  dropdown.innerHTML = html;
  dropdown.style.display = "block";
}

function selectStudioLocationByIndex(idx) {
  if (idx < 0 || idx >= studioLocCurrentMatches.length) return;
  const item = studioLocCurrentMatches[idx];
  selectStudioVerifiedLocation(item);
}

function selectStudioVerifiedLocation(item) {
  if (!item) return;
  const input = document.getElementById("create-event-city-state");
  const badge = document.getElementById("create-event-loc-badge");
  const dropdown = document.getElementById("create-event-loc-dropdown");

  const elCity = document.getElementById("create-event-loc-city");
  const elState = document.getElementById("create-event-loc-state");
  const elCountry = document.getElementById("create-event-loc-country");
  const elLat = document.getElementById("create-event-loc-lat");
  const elLng = document.getElementById("create-event-loc-lng");
  const elVerified = document.getElementById("create-event-loc-verified");

  const label = item.label || `${item.city}, ${item.state ? item.state + ', ' : ''}${item.country || 'United States'}`;

  if (input) input.value = label;
  if (elCity) elCity.value = item.city || "";
  if (elState) elState.value = item.state || "";
  if (elCountry) elCountry.value = item.country || "United States";
  if (elLat) elLat.value = item.lat;
  if (elLng) elLng.value = item.lng;
  if (elVerified) elVerified.value = "true";

  if (badge) {
    badge.style.background = "rgba(16,185,129,0.15)";
    badge.style.color = "#10b981";
    badge.style.borderColor = "rgba(16,185,129,0.3)";
    badge.textContent = "✓ Verified Location";
  }

  if (dropdown) dropdown.style.display = "none";
}

window.handleStudioLocationInput = handleStudioLocationInput;
window.handleStudioLocationFocus = handleStudioLocationFocus;
window.handleStudioLocationKeydown = handleStudioLocationKeydown;
window.selectStudioLocationByIndex = selectStudioLocationByIndex;
window.selectStudioVerifiedLocation = selectStudioVerifiedLocation;

// Close dropdown on click outside
document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("create-event-loc-dropdown");
  const input = document.getElementById("create-event-city-state");
  if (dropdown && input && !dropdown.contains(e.target) && e.target !== input) {
    dropdown.style.display = "none";
  }
});

/* ==========================================================================
   GOOGLE MAPS PLACES AUTOCOMPLETE INTEGRATION FOR VENUE & COORDINATES
   ========================================================================== */

let googlePlacesAutocomplete = null;

function initGooglePlaces() {
  const venueInput = document.getElementById("create-event-venue");
  if (!venueInput) return;
  if (typeof google === "undefined" || !google.maps || !google.maps.places) {
    console.warn("Google Maps Places API not yet loaded.");
    return;
  }
  if (googlePlacesAutocomplete) {
    return; // Already initialized
  }

  try {
    googlePlacesAutocomplete = new google.maps.places.Autocomplete(venueInput, {
      types: ["establishment", "geocode"],
      fields: ["name", "formatted_address", "geometry", "address_components", "place_id"]
    });

    // Prevent submitting tournament creation form when user presses Enter to choose a prediction
    venueInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const pacContainer = document.querySelector(".pac-container");
        if (pacContainer && pacContainer.style.display !== "none") {
          e.preventDefault();
        }
      }
    });

    googlePlacesAutocomplete.addListener("place_changed", () => {
      const place = googlePlacesAutocomplete.getPlace();
      if (!place || !place.geometry || !place.geometry.location) {
        return;
      }

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const placeName = place.name || venueInput.value;
      const fullAddress = place.formatted_address || "";

      // Fill hidden elements
      const elAddress = document.getElementById("create-event-loc-address");
      const elCity = document.getElementById("create-event-loc-city");
      const elState = document.getElementById("create-event-loc-state");
      const elCountry = document.getElementById("create-event-loc-country");
      const elPostal = document.getElementById("create-event-loc-postal");
      const elLat = document.getElementById("create-event-loc-lat");
      const elLng = document.getElementById("create-event-loc-lng");
      const elPlaceId = document.getElementById("create-event-loc-place-id");
      const elVerified = document.getElementById("create-event-loc-verified");
      const cityStateInput = document.getElementById("create-event-city-state");

      if (elAddress) elAddress.value = fullAddress;
      if (elLat) elLat.value = lat;
      if (elLng) elLng.value = lng;
      if (elPlaceId) elPlaceId.value = place.place_id || "";
      if (elVerified) elVerified.value = "true";

      // Parse address components
      let city = "";
      let state = "";
      let country = "United States";
      let postalCode = "";

      if (place.address_components) {
        for (const comp of place.address_components) {
          const types = comp.types || [];
          if (types.includes("locality")) {
            city = comp.long_name;
          } else if (!city && types.includes("sublocality")) {
            city = comp.long_name;
          } else if (!city && types.includes("postal_town")) {
            city = comp.long_name;
          }
          if (types.includes("administrative_area_level_1")) {
            state = comp.short_name || comp.long_name;
          }
          if (types.includes("country")) {
            country = comp.long_name;
          }
          if (types.includes("postal_code")) {
            postalCode = comp.long_name;
          }
        }
      }

      if (elCity) elCity.value = city;
      if (elState) elState.value = state;
      if (elCountry) elCountry.value = country;
      if (elPostal) elPostal.value = postalCode;

      const displayLoc = [city, state, country].filter(Boolean).join(", ");
      if (cityStateInput) cityStateInput.value = displayLoc;

      // Render verified venue confirmation card
      const card = document.getElementById("create-event-selected-place");
      const pName = document.getElementById("selected-place-name");
      const pAddr = document.getElementById("selected-place-address");
      const pCoords = document.getElementById("selected-place-coords");
      if (card && pName && pAddr && pCoords) {
        pName.textContent = placeName;
        pAddr.textContent = fullAddress || displayLoc;
        pCoords.textContent = `📍 Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}${postalCode ? " • Zip: " + postalCode : ""}`;
        card.style.display = "block";
      }

      const badge = document.getElementById("create-event-loc-badge");
      if (badge) {
        badge.style.background = "rgba(16,185,129,0.15)";
        badge.style.color = "#10b981";
        badge.style.borderColor = "rgba(16,185,129,0.3)";
        badge.textContent = "✓ Coordinates Locked";
      }
    });

    console.log("✅ Google Maps Places Autocomplete attached to Venue input.");
  } catch (err) {
    console.error("Failed to initialize Google Maps Places:", err);
  }
}

window.initGooglePlaces = initGooglePlaces;

let _mapsSdkLoadingPromise = null;

async function loadGoogleMapsSdk(callback) {
  if (typeof google !== "undefined" && google.maps && google.maps.places) {
    if (typeof initGooglePlaces === "function") initGooglePlaces();
    if (typeof attachAllPlacesAutocompletes === "function") attachAllPlacesAutocompletes();
    if (typeof callback === "function") callback();
    return;
  }
  if (_mapsSdkLoadingPromise) {
    if (typeof callback === "function") {
      _mapsSdkLoadingPromise.then(() => callback());
    }
    return _mapsSdkLoadingPromise;
  }

  _mapsSdkLoadingPromise = (async () => {
    try {
      const res = await fetch("/api/config/maps-key");
      if (!res.ok) return;
      const data = await res.json();
      const apiKey = (data && data.key) ? data.key.trim() : "";
      if (!apiKey) return;
      if (document.querySelector('script[src*="maps.googleapis.com"]')) return;

      await new Promise((resolve) => {
        window.__onGoogleMapsSdkReady = () => {
          if (typeof initGooglePlaces === "function") initGooglePlaces();
          if (typeof attachAllPlacesAutocompletes === "function") attachAllPlacesAutocompletes();
          if (typeof initStoresGoogleMap === "function" && document.getElementById("comm-stores-map")) {
            initStoresGoogleMap();
          }
          if (typeof callback === "function") callback();
          resolve();
        };

        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&callback=__onGoogleMapsSdkReady`;
        script.async = true;
        script.defer = true;
        script.onerror = () => resolve();
        document.head.appendChild(script);
      });
    } catch (err) {
      console.warn("Notice loading Google Maps SDK:", err);
    }
  })();

  return _mapsSdkLoadingPromise;
}

window.loadGoogleMapsSdk = loadGoogleMapsSdk;

// Automatically load Google Maps SDK
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => loadGoogleMapsSdk());
} else {
  loadGoogleMapsSdk();
}
