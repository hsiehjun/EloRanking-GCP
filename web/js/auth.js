/* ==========================================================================
   AUTH.JS - Native User Authentication & BCP Account Linking (v5.0)
   ========================================================================== */

var currentUser = (typeof window !== 'undefined' && window.currentUser) || null;
if (typeof window !== 'undefined') window.currentUser = currentUser;

function getCookieToken() {
  const match = document.cookie.match(new RegExp('(^| )session_token=([^;]+)'));
  return match ? match[2] : null;
}

// Clean up any stale dev_persona_override or mock persona state that may have leaked into localStorage
try {
  const cachedProf = localStorage.getItem('native_user_profile');
  const storedPersona = localStorage.getItem('dev_persona_override');
  const urlPersona = (typeof window !== 'undefined' && window.location) ? new URLSearchParams(window.location.search).get('persona') : null;
  if (!urlPersona) {
    if (storedPersona) {
      localStorage.removeItem('dev_persona_override');
    }
    if (cachedProf && (cachedProf.includes('p_innes') || cachedProf.includes('Innes Wilson') || cachedProf.includes('dev_creator_wgl') || cachedProf.includes('dev_to_admin') || cachedProf.includes('viewer_guest_999'))) {
      localStorage.removeItem('native_user_profile');
    }
    const hubCache = localStorage.getItem('my_hub_cache');
    if (hubCache && (hubCache.includes('p_innes') || hubCache.includes('Innes Wilson'))) {
      localStorage.removeItem('my_hub_cache');
      localStorage.removeItem('my_hub_cache_40k');
      localStorage.removeItem('my_hub_cache_aos');
    }
    try {
      document.cookie = 'dev_persona=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT;';
    } catch (e) {}
  }
} catch (e) {}

// Persona override strictly for explicit preview testing when requested via ?persona=
let currentDevPersona = null;
try {
  const urlPersona = (typeof window !== 'undefined' && window.location) ? new URLSearchParams(window.location.search).get('persona') : null;
  if (urlPersona && ['competitor', 'spectator', 'creator', 'to'].includes(urlPersona.toLowerCase())) {
    currentDevPersona = urlPersona.toLowerCase();
    localStorage.setItem('dev_persona_override', currentDevPersona);
    try {
      document.cookie = `dev_persona=${currentDevPersona}; path=/; max-age=2592000; SameSite=Lax`;
    } catch (e) {}
  }
} catch (e) {}
window.currentDevPersona = currentDevPersona;

function getMockUserForPersona(persona) {
  if (persona === 'spectator') {
    return {
      id: 'viewer_guest_999',
      username: 'casual_spectator',
      display_name: 'Casual Spectator',
      role: 'player',
      bcp_connected: false,
      player_id: 'viewer_guest_999',
      first_name: 'Casual',
      last_name: 'Spectator'
    };
  }
  if (persona === 'creator') {
    return {
      id: 'dev_creator_wgl',
      username: 'wargames_live',
      display_name: 'Wargames Live (Caster)',
      role: 'creator',
      is_cc: true,
      can_access_cc: true,
      bcp_connected: true
    };
  }
  if (persona === 'to') {
    return {
      id: 'dev_to_admin',
      username: 'tournament_director',
      display_name: 'Head Tournament Organizer',
      role: 'to',
      is_admin: false,
      can_access_to: true,
      bcp_connected: true
    };
  }
  // Default: Competitor (Innes Wilson)
  return {
    id: 'p_innes',
    username: 'innes_wilson',
    display_name: 'Innes Wilson (Competitor)',
    role: 'player',
    bcp_connected: true,
    player_id: 'p_innes',
    bcp_player_id: 'p_innes',
    first_name: 'Innes',
    last_name: 'Wilson'
  };
}
window.getMockUserForPersona = getMockUserForPersona;

function setDevPersona(persona) {
  currentDevPersona = persona;
  window.currentDevPersona = persona;
  localStorage.setItem('dev_persona_override', persona);
  try {
    document.cookie = `dev_persona=${persona}; path=/; max-age=2592000; SameSite=Lax`;
  } catch (e) {}
  currentUser = getMockUserForPersona(persona);
  localStorage.setItem('native_user_profile', JSON.stringify(currentUser));
  window.currentUser = currentUser;

  if (typeof currentEventRegistration !== 'undefined') {
    currentEventRegistration = null;
  }

  // Update persona buttons UI
  syncPersonaButtons();

  if (typeof openEventHubPage === 'function' && typeof currentOpenEventId !== 'undefined' && currentOpenEventId) {
    const targetSys = typeof currentGameSystem !== 'undefined' ? currentGameSystem : '40k';
    const targetInitialTab = (persona === 'competitor') ? 'player' : (persona === 'creator' ? 'creator' : 'matches');
    openEventHubPage(currentOpenEventId, targetSys, { initialTab: targetInitialTab, forceSync: true });
  } else {
    window.location.reload();
  }
}
window.setDevPersona = setDevPersona;
window.currentDevPersona = currentDevPersona;

function syncPersonaButtons() {
  document.querySelectorAll('.persona-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-persona') === currentDevPersona);
  });
}
window.syncPersonaButtons = syncPersonaButtons;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', syncPersonaButtons);
} else {
  syncPersonaButtons();
}

// Synchronously restore user from real cached session if valid token exists, or mock persona if explicitly requested via ?persona=
var __realSuperadminUser = (typeof window !== 'undefined' && window.__realSuperadminUser) || null;
try {
  const token = localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || getCookieToken();
  const urlPersona = (typeof window !== 'undefined' && window.location) ? new URLSearchParams(window.location.search).get('persona') : null;

  if (urlPersona && ['competitor', 'spectator', 'creator', 'to'].includes(urlPersona.toLowerCase()) && !token) {
    currentDevPersona = urlPersona.toLowerCase();
    currentUser = getMockUserForPersona(currentDevPersona);
  } else {
    const cached = localStorage.getItem('native_user_profile') || localStorage.getItem('bcp_user_profile');
    if (cached && token) {
      const parsed = JSON.parse(cached);
      // Ensure cached profile is not a stale mock persona
      if (parsed && parsed.id !== 'p_innes' && parsed.username !== 'innes_wilson' && parsed.id !== 'dev_creator_wgl' && parsed.id !== 'dev_to_admin' && parsed.id !== 'viewer_guest_999' && !parsed.is_mock_player) {
        const cachedEmail = String(parsed.email || '').trim().toLowerCase();
        if (cachedEmail !== 'swimgeek751@gmail.com') {
          parsed.can_switch_role = false;
          parsed.is_superadmin = false;
          __realSuperadminUser = null;
          try { sessionStorage.removeItem('omni_superadmin_mock_player'); } catch (e) {}
        } else {
          __realSuperadminUser = parsed;
        }
        currentUser = parsed;
        if (__realSuperadminUser && cachedEmail === 'swimgeek751@gmail.com') {
          try {
            const rawMock = sessionStorage.getItem('omni_superadmin_mock_player');
            if (rawMock) {
              const parsedMock = JSON.parse(rawMock);
              if (parsedMock && parsedMock.is_mock_player === true && String(parsedMock.mocked_by_superadmin || '').toLowerCase() === 'swimgeek751@gmail.com') {
                currentUser = parsedMock;
              } else {
                sessionStorage.removeItem('omni_superadmin_mock_player');
              }
            }
          } catch (e) {}
        }
      } else {
        currentUser = null;
      }
    } else {
      currentUser = null;
      __realSuperadminUser = null;
      try { sessionStorage.removeItem('omni_superadmin_mock_player'); } catch (e) {}
    }
  }
} catch (e) {
  currentUser = null;
  __realSuperadminUser = null;
}
if (typeof window !== 'undefined') {
  window.currentUser = currentUser;
  window.__realSuperadminUser = __realSuperadminUser;
}

function isVerifiedSuperadmin() {
  const realUser = (typeof window !== 'undefined' && window.__realSuperadminUser) || __realSuperadminUser;
  if (realUser && String(realUser.email || '').trim().toLowerCase() === 'swimgeek751@gmail.com' && (realUser.is_superadmin === true || realUser.can_switch_role === true)) {
    return true;
  }
  const u = (typeof window !== 'undefined' && window.currentUser) || currentUser;
  if (u && !u.is_mock_player && String(u.email || '').trim().toLowerCase() === 'swimgeek751@gmail.com' && (u.is_superadmin === true || u.can_switch_role === true)) {
    return true;
  }
  return false;
}
window.isVerifiedSuperadmin = isVerifiedSuperadmin;

function getActiveSuperadminMockPlayer() {
  if (!isVerifiedSuperadmin()) {
    try { sessionStorage.removeItem('omni_superadmin_mock_player'); } catch (e) {}
    return null;
  }
  try {
    const raw = sessionStorage.getItem('omni_superadmin_mock_player');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.is_mock_player === true && String(parsed.mocked_by_superadmin || '').toLowerCase() === 'swimgeek751@gmail.com') {
      return parsed;
    }
    sessionStorage.removeItem('omni_superadmin_mock_player');
  } catch (e) {}
  return null;
}
window.getActiveSuperadminMockPlayer = getActiveSuperadminMockPlayer;

function isUserTO(user) {
  if (!user) return false;
  const userRole = String(user.role || 'player').trim().toLowerCase();
  const isAdmin = userRole === 'admin' || userRole === 'superuser' || userRole === 'developer' || userRole === 'owner' || Boolean(user.is_admin);
  const isTO = userRole === 'to' || userRole === 'organizer' || userRole === 'referee' || Boolean(user.can_access_to);
  return isAdmin || isTO;
}
window.isUserTO = isUserTO;

function isUserCC(user) {
  if (!user) return false;
  const userRole = String(user.role || 'player').trim().toLowerCase();
  const isAdmin = userRole === 'admin' || userRole === 'superuser' || userRole === 'developer' || userRole === 'owner' || Boolean(user.is_admin);
  const isCC = userRole === 'cc' || userRole === 'creator' || userRole === 'content_creator' || Boolean(user.is_cc) || Boolean(user.can_access_cc);
  return isAdmin || isCC;
}
window.isUserCC = isUserCC;
if (typeof window.ENABLE_EVENT_STUDIO_TAB === 'undefined') {
  window.ENABLE_EVENT_STUDIO_TAB = false;
}

/**
 * Synchronize mobile navigation dropdown options based on auth status and user role.
 * Note: Mobile Safari (iOS) and Android native select dialogs completely ignore CSS display:none
 * on <option> tags. Therefore, privileged options (such as Event Studio for TO/Admin) and
 * auth-specific options must be physically added or removed from the DOM.
 */
function syncMobileNavDropdown() {
  const select = document.getElementById('mobile-nav-select');
  if (!select) return;

  const isTO = Boolean(window.ENABLE_EVENT_STUDIO_TAB && currentUser && typeof isUserTO === 'function' && isUserTO(currentUser));
  const divider = document.getElementById('mobile-opt-divider') || select.querySelector('option[disabled]');
  let esOpt = document.getElementById('mobile-opt-event-studio');

  // Event Studio Option: Hidden by default (window.ENABLE_EVENT_STUDIO_TAB = false)
  if (isTO) {
    if (!esOpt) {
      esOpt = document.createElement('option');
      esOpt.value = 'event-studio';
      esOpt.id = 'mobile-opt-event-studio';
      esOpt.textContent = '🛠️ Event Studio (TO)';
      if (divider) {
        select.insertBefore(esOpt, divider);
      } else {
        select.appendChild(esOpt);
      }
    }
  } else {
    if (esOpt) {
      if (select.value === 'event-studio') {
        select.value = (typeof activeTab !== 'undefined' && activeTab !== 'event-studio') ? activeTab : 'my-hub';
      }
      esOpt.remove();
    }
  }

  // Auth-state options: dynamically add/remove to ensure compatibility with iOS native pickers
  let loginOpt = document.getElementById('mobile-opt-login');
  let diceTrackerOpt = document.getElementById('mobile-opt-dice-tracker');
  let teamPairingsOpt = document.getElementById('mobile-opt-team-pairings');
  let feedbackOpt = document.getElementById('mobile-opt-feedback');
  let settingsOpt = document.getElementById('mobile-opt-settings');
  let logoutOpt = document.getElementById('mobile-opt-logout');
  const sheetDiceBtn = document.getElementById('mobile-sheet-dice-tracker-btn');
  const sheetPairingsBtn = document.getElementById('mobile-sheet-team-pairings-btn');

  if (currentUser) {
    if (loginOpt) loginOpt.remove();
    const isAdminUser = currentUser.role === 'admin' || Boolean(currentUser.is_admin);
    if (sheetDiceBtn) sheetDiceBtn.style.display = isAdminUser ? '' : 'none';
    if (sheetPairingsBtn) sheetPairingsBtn.style.display = isAdminUser ? '' : 'none';
    if (isAdminUser) {
      if (!diceTrackerOpt) {
        diceTrackerOpt = document.createElement('option');
        diceTrackerOpt.value = 'dice-tracker';
        diceTrackerOpt.id = 'mobile-opt-dice-tracker';
        diceTrackerOpt.textContent = '📹 CV Dice Lab (Admin)';
        select.appendChild(diceTrackerOpt);
      }
      if (!teamPairingsOpt) {
        teamPairingsOpt = document.createElement('option');
        teamPairingsOpt.value = 'team-pairings';
        teamPairingsOpt.id = 'mobile-opt-team-pairings';
        teamPairingsOpt.textContent = '⚔️ Team Pairings (Admin)';
        select.appendChild(teamPairingsOpt);
      }
    } else {
      if (diceTrackerOpt) diceTrackerOpt.remove();
      if (teamPairingsOpt) teamPairingsOpt.remove();
    }

    if (!feedbackOpt) {
      feedbackOpt = document.createElement('option');
      feedbackOpt.value = 'feedback';
      feedbackOpt.id = 'mobile-opt-feedback';
      feedbackOpt.textContent = '💬 Send Feedback';
      select.appendChild(feedbackOpt);
    }
    if (!settingsOpt) {
      settingsOpt = document.createElement('option');
      settingsOpt.value = 'settings';
      settingsOpt.id = 'mobile-opt-settings';
      settingsOpt.textContent = '⚙️ Account Settings';
      select.appendChild(settingsOpt);
    }
    if (!logoutOpt) {
      logoutOpt = document.createElement('option');
      logoutOpt.value = 'logout';
      logoutOpt.id = 'mobile-opt-logout';
      logoutOpt.textContent = '🚪 Sign Out';
      select.appendChild(logoutOpt);
    }
  } else {
    if (sheetDiceBtn) sheetDiceBtn.style.display = 'none';
    if (sheetPairingsBtn) sheetPairingsBtn.style.display = 'none';
    if (diceTrackerOpt) diceTrackerOpt.remove();
    if (teamPairingsOpt) teamPairingsOpt.remove();
    if (feedbackOpt) feedbackOpt.remove();
    if (settingsOpt) settingsOpt.remove();
    if (logoutOpt) logoutOpt.remove();

    if (!loginOpt) {
      loginOpt = document.createElement('option');
      loginOpt.value = 'login';
      loginOpt.id = 'mobile-opt-login';
      loginOpt.textContent = '🔑 Sign In';
      select.appendChild(loginOpt);
    }
  }

  // Temporary dynamic options for deep-routed pages (event-hub & player-profile)
  let playerOpt = document.getElementById('mobile-opt-player-profile');
  if (typeof activeTab !== 'undefined' && activeTab === 'player-profile') {
    if (!playerOpt) {
      playerOpt = document.createElement('option');
      playerOpt.id = 'mobile-opt-player-profile';
      playerOpt.value = 'player-profile';
      playerOpt.textContent = '👤 Competitor Profile';
      select.prepend(playerOpt);
    }
  } else if (playerOpt) {
    playerOpt.remove();
  }

  let eventOpt = document.getElementById('mobile-opt-event-hub');
  if (typeof activeTab !== 'undefined' && activeTab === 'event-hub') {
    if (!eventOpt) {
      eventOpt = document.createElement('option');
      eventOpt.id = 'mobile-opt-event-hub';
      eventOpt.value = 'event-hub';
      eventOpt.textContent = '🏟️ Event Hub';
      select.prepend(eventOpt);
    }
  } else if (eventOpt) {
    eventOpt.remove();
  }

  // Keep dropdown value in sync with activeTab
  if (typeof activeTab !== 'undefined' && activeTab) {
    if (activeTab === 'event-studio' && !isTO) {
      select.value = 'my-hub';
    } else if (select.querySelector(`option[value="${activeTab}"]`)) {
      select.value = activeTab;
    }
  }
}
window.syncMobileNavDropdown = syncMobileNavDropdown;

// Run immediate synchronous cleanup if DOM is already ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncMobileNavDropdown);
  } else {
    syncMobileNavDropdown();
  }
}

function syncAppAuthView() {
  if (typeof window !== 'undefined' && window.__omniUpdatingReloadInProgress) {
    return;
  }
  const landingView = document.getElementById('landing-page-view');
  const appShell = document.getElementById('app-shell');
  const appHeader = document.getElementById('app-header');
  const foucGuard = document.getElementById('auth-fouc-guard');
  const esNavBtn = document.getElementById('nav-btn-event-studio');

  const canAccessTO = Boolean(window.ENABLE_EVENT_STUDIO_TAB && isUserTO(currentUser));
  if (esNavBtn) {
    esNavBtn.style.display = (currentUser && canAccessTO) ? 'flex' : 'none';
  }
  syncMobileNavDropdown();

  const chatWidget = document.getElementById('floating-chat-widget');

  if (currentUser) {
    document.body.classList.add('is-authenticated');
    if (foucGuard) foucGuard.innerHTML = '#landing-page-view { display: none !important; } #app-shell { display: flex !important; flex-direction: column !important; width: 100% !important; } #app-header { display: block !important; width: 100% !important; } #floating-chat-widget { display: block !important; }';
    if (landingView) landingView.style.display = 'none';
    if (appShell) {
      appShell.style.display = 'flex';
      appShell.style.flexDirection = 'column';
      appShell.style.width = '100%';
    }
    if (appHeader) {
      appHeader.style.display = 'block';
      appHeader.style.width = '100%';
    }
    if (chatWidget) chatWidget.style.display = 'block';
    if (typeof renderHeaderAuth === 'function') renderHeaderAuth();
  } else {
    document.body.classList.remove('is-authenticated');
    if (chatWidget) chatWidget.style.display = 'none';
    if (typeof toggleFloatingChat === 'function') toggleFloatingChat(false);

    // If on app.html (no #landing-page-view exists):
    if (!landingView) {
      if (foucGuard) foucGuard.innerHTML = '#floating-chat-widget { display: none !important; }';
      const isStandalone = ('standalone' in window.navigator && window.navigator.standalone) ||
                           (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      const target = isStandalone ? '/login' : '/login?redirect=/app';
      if (!window.location.pathname.startsWith('/login')) {
        window.location.replace(target);
      }
      return;
    }

    // Only if #landing-page-view exists in DOM:
    if (foucGuard) foucGuard.innerHTML = '#landing-page-view { display: block !important; } #app-shell { display: none !important; } #app-header { display: none !important; } #floating-chat-widget { display: none !important; }';
    landingView.style.display = 'block';
    if (appShell) appShell.style.display = 'none';
    if (appHeader) appHeader.style.display = 'none';
  }
}

async function initAuth() {
  const token = localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || getCookieToken();

  // If a session token exists, authenticate against the backend to load the real user profile
  if (token) {
    try {
      const res = await window.api.getAuthMe(token);
      if (typeof window !== 'undefined' && window.__omniUpdatingReloadInProgress) {
        return;
      }
      if (res && res.authenticated === true && res.user) {
        const prevRole = currentUser ? String(currentUser.role || 'player').toLowerCase() : '';
        const prevAdmin = Boolean(currentUser && currentUser.is_admin);
        const verifiedEmail = String(res.user.email || '').trim().toLowerCase();
        const isSuper = Boolean(verifiedEmail === 'swimgeek751@gmail.com' && (res.user.is_superadmin === true || res.user.can_switch_role === true));
        if (isSuper) {
          __realSuperadminUser = res.user;
          if (typeof window !== 'undefined') window.__realSuperadminUser = res.user;
        } else {
          res.user.can_switch_role = false;
          res.user.is_superadmin = false;
          __realSuperadminUser = null;
          if (typeof window !== 'undefined') window.__realSuperadminUser = null;
          try { sessionStorage.removeItem('omni_superadmin_mock_player'); } catch (e) {}
        }
        localStorage.setItem('native_user_profile', JSON.stringify(res.user));
        localStorage.setItem('native_session_token', token);
        localStorage.setItem('elo_auth_token', token);
        const activeMock = isSuper ? getActiveSuperadminMockPlayer() : null;
        currentUser = activeMock || res.user;
        if (typeof window !== 'undefined') window.currentUser = currentUser;
        if (typeof renderSuperadminMockBanner === 'function') renderSuperadminMockBanner();
        if (typeof updateStudioAuthBadge === 'function') updateStudioAuthBadge();
        syncAppAuthView();
        if (typeof syncPersonaButtons === 'function') syncPersonaButtons();
        const nextRole = String(currentUser.role || 'player').toLowerCase();
        const nextAdmin = Boolean(currentUser.is_admin || nextRole === 'admin');
        if (prevRole !== nextRole || prevAdmin !== nextAdmin || activeMock) {
          syncRoleDependentViewsAfterAuthUpdate();
        }
        return;
      }
      const isExplicitlyUnauthenticated = Boolean(
        res &&
        res.authenticated === false &&
        !res.error &&
        !res.aborted &&
        !res.transient_error
      );
      if (isExplicitlyUnauthenticated) {
        currentUser = null;
        if (typeof window !== 'undefined') window.currentUser = null;
        localStorage.removeItem('native_session_token');
        localStorage.removeItem('elo_auth_token');
        localStorage.removeItem('native_user_profile');
        ['session_token', 'elo_auth_token', 'native_session_token'].forEach(c => {
          document.cookie = `${c}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
        });
        if (typeof updateStudioAuthBadge === 'function') updateStudioAuthBadge();
        syncAppAuthView();
        return;
      }
      // Transient network error, server restart, or reload abort: preserve session & cached profile!
      if (!currentUser) {
        try {
          const cached = localStorage.getItem('native_user_profile') || localStorage.getItem('bcp_user_profile');
          if (cached) {
            currentUser = JSON.parse(cached);
            if (typeof window !== 'undefined') window.currentUser = currentUser;
          }
        } catch (e) {}
      }
      if (typeof updateStudioAuthBadge === 'function') updateStudioAuthBadge();
      if (currentUser) {
        syncAppAuthView();
      }
      return;
    } catch (e) {
      console.warn('Session verification error (preserving cached session):', e);
      if (currentUser) {
        syncAppAuthView();
      }
      return;
    }
  }

  // Only if there is NO token and explicit ?persona= URL param was passed, use mock persona
  if (!token && currentDevPersona) {
    currentUser = getMockUserForPersona(currentDevPersona);
    window.currentUser = currentUser;
    if (typeof updateStudioAuthBadge === 'function') updateStudioAuthBadge();
    syncAppAuthView();
    if (typeof syncPersonaButtons === 'function') syncPersonaButtons();
    return;
  }

  currentUser = null;
  syncAppAuthView();
}

let pendingVerifyEmail = "";
let pendingVerifyMode = "register";
let pendingLoginToken = "";

function setAuthCardTab(tab) {
  const btnLogin = document.getElementById('auth-tab-btn-login');
  const btnReg = document.getElementById('auth-tab-btn-register');
  const formLogin = document.getElementById('auth-form-login');
  const formReg = document.getElementById('auth-form-register');
  const formVerify = document.getElementById('auth-form-verify');
  const formForgot = document.getElementById('auth-form-forgot');

  if (btnLogin) btnLogin.classList.toggle('active', tab === 'login');
  if (btnReg) btnReg.classList.toggle('active', tab === 'register');

  if (formLogin) formLogin.style.display = (tab === 'login') ? 'block' : 'none';
  if (formReg) formReg.style.display = (tab === 'register') ? 'block' : 'none';
  if (formVerify) formVerify.style.display = (tab === 'verify') ? 'block' : 'none';
  if (formForgot) formForgot.style.display = (tab === 'forgot') ? 'block' : 'none';

  // Always wipe passwords when switching auth modes
  const passInput = document.getElementById('login-password');
  if (passInput) passInput.value = '';
  const regPass = document.getElementById('reg-password');
  if (regPass) regPass.value = '';

  if (tab === 'verify') {
    const codeInput = document.getElementById('verify-code-input');
    if (codeInput) {
      codeInput.value = '';
      setTimeout(() => codeInput.focus(), 50);
    }
  }
}

async function handleNativeLogin(e) {
  if (e) e.preventDefault();
  const emailInput = document.getElementById('login-email');
  const passInput = document.getElementById('login-password');
  const errorDiv = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit-btn');

  const email = emailInput ? emailInput.value.trim() : '';
  const password = passInput ? passInput.value : '';

  if (!email || !password) {
    if (errorDiv) {
      errorDiv.innerText = 'Please enter your email and password.';
      errorDiv.style.display = 'block';
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = 'Signing In...';
  }
  if (errorDiv) errorDiv.style.display = 'none';

  try {
    const res = await window.api.login(email, password);
    if (res && (res.requires_2fa || res.requires_verification)) {
      pendingVerifyEmail = res.email || email;
      pendingVerifyMode = 'login_2fa';
      pendingLoginToken = res.login_token || '';
      const targetSpan = document.getElementById('verify-email-target');
      if (targetSpan) targetSpan.textContent = pendingVerifyEmail;
      const submitVerifyBtn = document.getElementById('btn-submit-verify');
      if (submitVerifyBtn) submitVerifyBtn.innerText = '✓ Verify Device & Sign In';
      setAuthCardTab('verify');
    } else if (res && res.success && res.session_token) {
      if (passInput) passInput.value = '';
      if (emailInput) emailInput.value = '';
      const loginForm = document.getElementById('auth-form-login');
      if (loginForm) loginForm.reset();
      localStorage.setItem('native_session_token', res.session_token);
      localStorage.setItem('elo_auth_token', res.session_token);
      localStorage.setItem('native_user_profile', JSON.stringify(res.user));
      if (res.device_id) {
        localStorage.setItem('omnitactica_device_id', res.device_id);
        document.cookie = `omni_device_id=${encodeURIComponent(res.device_id)}; path=/; max-age=31536000; SameSite=Lax`;
      }
      currentUser = res.user;
      document.cookie = `session_token=${res.session_token}; path=/; max-age=2592000; SameSite=Lax`;
      if (window.location.pathname !== '/app' && window.location.pathname !== '/app.html') {
        window.location.href = '/app';
        return;
      }
      syncAppAuthView();
      switchTab('my-hub');
    } else {
      if (errorDiv) {
        errorDiv.innerText = (res && res.error) ? res.error : 'Invalid email or password.';
        errorDiv.style.display = 'block';
      }
    }
  } catch (err) {
    if (errorDiv) {
      errorDiv.innerText = 'Login error: ' + err.message;
      errorDiv.style.display = 'block';
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Sign In to OmniTactica';
    }
  }
}

async function handleNativeRegister(e) {
  if (e) e.preventDefault();
  const nameInput = document.getElementById('reg-name');
  const emailInput = document.getElementById('reg-email');
  const passInput = document.getElementById('reg-password');
  const errorDiv = document.getElementById('reg-error');
  const submitBtn = document.getElementById('reg-submit-btn');

  const displayName = nameInput ? nameInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passInput ? passInput.value : '';

  if (!email || !password) {
    if (errorDiv) {
      errorDiv.innerText = 'Please enter your email and a password.';
      errorDiv.style.display = 'block';
    }
    return;
  }
  if (password.length < 6) {
    if (errorDiv) {
      errorDiv.innerText = 'Password must be at least 6 characters.';
      errorDiv.style.display = 'block';
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = 'Sending 2FA Code...';
  }
  if (errorDiv) errorDiv.style.display = 'none';

  try {
    const res = await window.api.register(email, password, displayName);
    if (res && res.requires_verification) {
      pendingVerifyEmail = email;
      pendingVerifyMode = 'register';
      pendingLoginToken = '';
      const targetSpan = document.getElementById('verify-email-target');
      if (targetSpan) targetSpan.textContent = email;
      const submitVerifyBtn = document.getElementById('btn-submit-verify');
      if (submitVerifyBtn) submitVerifyBtn.innerText = '✓ Activate Account & Enter';
      setAuthCardTab('verify');
    } else if (res && res.success && res.session_token) {
      localStorage.setItem('native_session_token', res.session_token);
      localStorage.setItem('elo_auth_token', res.session_token);
      localStorage.setItem('native_user_profile', JSON.stringify(res.user));
      currentUser = res.user;
      document.cookie = `session_token=${res.session_token}; path=/; max-age=2592000; SameSite=Lax`;
      if (window.location.pathname !== '/app' && window.location.pathname !== '/app.html') {
        window.location.href = '/app';
        return;
      }
      syncAppAuthView();
      switchTab('my-hub');
    } else {
      if (errorDiv) {
        errorDiv.innerText = res.error || 'Registration failed.';
        errorDiv.style.display = 'block';
      }
    }
  } catch (err) {
    if (errorDiv) {
      errorDiv.innerText = 'Registration error: ' + err.message;
      errorDiv.style.display = 'block';
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Create Account (Send 2FA Code)';
    }
  }
}

async function handleVerifyRegistrationCode(e) {
  if (e) e.preventDefault();
  const codeInput = document.getElementById('verify-code-input');
  const errorDiv = document.getElementById('verify-error');
  const submitBtn = document.getElementById('btn-submit-verify');
  const isLogin2FA = (pendingVerifyMode === 'login_2fa');

  const code = codeInput ? codeInput.value.trim() : '';
  const email = pendingVerifyEmail || (document.getElementById('reg-email') ? document.getElementById('reg-email').value.trim() : '') || (document.getElementById('login-email') ? document.getElementById('login-email').value.trim() : '');

  if (!code || code.length < 6) {
    if (errorDiv) {
      errorDiv.innerText = 'Please enter the full 6-digit verification code.';
      errorDiv.style.display = 'block';
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = isLogin2FA ? 'Verifying Device...' : 'Activating Account...';
  }
  if (errorDiv) errorDiv.style.display = 'none';

  try {
    const res = isLogin2FA
      ? await window.api.verifyLogin2FA(email, code, pendingLoginToken)
      : await window.api.verifyRegistrationCode(email, code);
    if (res && res.success) {
      localStorage.setItem('native_session_token', res.session_token);
      localStorage.setItem('elo_auth_token', res.session_token);
      localStorage.setItem('native_user_profile', JSON.stringify(res.user));
      if (res.device_id) {
        localStorage.setItem('omnitactica_device_id', res.device_id);
        document.cookie = `omni_device_id=${encodeURIComponent(res.device_id)}; path=/; max-age=31536000; SameSite=Lax`;
      }
      currentUser = res.user;
      document.cookie = `session_token=${res.session_token}; path=/; max-age=2592000; SameSite=Lax`;
      if (window.location.pathname !== '/app' && window.location.pathname !== '/app.html') {
        window.location.href = '/app';
        return;
      }
      syncAppAuthView();
      if (!isLogin2FA) {
        alert('🎉 Welcome to OmniTactica! Your account has been verified successfully.');
      }
      switchTab('my-hub');
    } else {
      if (errorDiv) {
        errorDiv.innerText = res.error || 'Invalid or expired verification code.';
        errorDiv.style.display = 'block';
      }
    }
  } catch (err) {
    if (errorDiv) {
      errorDiv.innerText = 'Verification error: ' + err.message;
      errorDiv.style.display = 'block';
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = isLogin2FA ? '✓ Verify Device & Sign In' : '✓ Activate Account & Enter';
    }
  }
}

async function handleResendVerificationCode() {
  const email = pendingVerifyEmail || (document.getElementById('reg-email') ? document.getElementById('reg-email').value.trim() : '') || (document.getElementById('login-email') ? document.getElementById('login-email').value.trim() : '');
  const btn = document.getElementById('btn-resend-code');
  const errorDiv = document.getElementById('verify-error');
  const isLogin2FA = (pendingVerifyMode === 'login_2fa');
  if (!email) return;

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Resending...';
  }

  try {
    const res = isLogin2FA
      ? await window.api.resendLogin2FA(email, pendingLoginToken)
      : await window.api.resendRegistrationCode(email);
    if (res && res.success) {
      if (errorDiv) {
        errorDiv.style.display = 'block';
        errorDiv.style.color = '#10b981';
        errorDiv.style.background = 'rgba(16,185,129,0.1)';
        errorDiv.style.borderColor = 'rgba(16,185,129,0.25)';
        errorDiv.innerText = '✅ New 6-digit code sent! Please check your email inbox (and spam).';
      }
    } else {
      if (errorDiv) {
        errorDiv.style.display = 'block';
        errorDiv.innerText = res.error || 'Failed to resend code.';
      }
    }
  } catch (e) {
    if (errorDiv) {
      errorDiv.style.display = 'block';
      errorDiv.innerText = e.message || 'Error resending code.';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = 'Resend Code';
    }
  }
}

function openBcpLinkModal() {
  const modal = document.getElementById('bcp-link-modal');
  if (!modal) return;

  const errorDiv = document.getElementById('bcp-link-error');
  if (errorDiv) {
    errorDiv.innerText = '';
    errorDiv.style.display = 'none';
  }

  const isConnected = !!(currentUser && (currentUser.bcp_connected || currentUser.bcp_email || currentUser.bcp_user_id));
  const connectedView = document.getElementById('bcp-connected-view');
  const formView = document.getElementById('bcp-form-credentials');
  const connectedEmail = document.getElementById('bcp-connected-email');

  if (isConnected && connectedView && formView) {
    if (connectedEmail) {
      connectedEmail.innerText = currentUser.bcp_email || currentUser.display_name || 'Linked BCP Account';
    }
    connectedView.style.display = 'block';
    formView.style.display = 'none';
  } else {
    if (connectedView) connectedView.style.display = 'none';
    if (formView) formView.style.display = 'block';
  }

  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  } else {
    modal.classList.add('active');
  }

  // Auto-focus email input so Chrome and password managers immediately detect active credentials
  if (!isConnected || (formView && formView.style.display !== 'none')) {
    setTimeout(() => {
      const emailInput = document.getElementById('bcp-link-email');
      if (emailInput) {
        emailInput.focus();
        if (typeof emailInput.select === 'function' && emailInput.value) {
          emailInput.select();
        }
      }
    }, 100);
  }
}

function closeBcpLinkModal() {
  if (typeof closeModal === 'function') {
    closeModal('bcp-link-modal');
  } else {
    const modal = document.getElementById('bcp-link-modal');
    if (modal) modal.classList.remove('active');
  }
  const passInput = document.getElementById('bcp-link-password');
  if (passInput) passInput.value = '';
}

function showBcpCredentialsForm() {
  const connectedView = document.getElementById('bcp-connected-view');
  const formView = document.getElementById('bcp-form-credentials');
  if (connectedView) connectedView.style.display = 'none';
  if (formView) formView.style.display = 'block';
  setTimeout(() => {
    const emailInput = document.getElementById('bcp-link-email');
    if (emailInput) emailInput.focus();
  }, 100);
}

async function handleConnectBcp(e) {
  if (e) e.preventDefault();
  const emailInput = document.getElementById('bcp-link-email');
  const passInput = document.getElementById('bcp-link-password');
  const errorDiv = document.getElementById('bcp-link-error');
  const submitBtn = document.getElementById('bcp-link-submit-btn');

  const bcpEmail = emailInput ? emailInput.value.trim() : '';
  const bcpPassword = passInput ? passInput.value : '';

  if (!bcpEmail || !bcpPassword) {
    if (errorDiv) {
      errorDiv.innerText = 'Please enter your BCP email and password.';
      errorDiv.style.display = 'block';
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span style="display:inline-block; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; vertical-align:middle; margin-right:6px;"></span> Linking & Computing Elo...';
  }
  if (errorDiv) errorDiv.style.display = 'none';
  if (typeof showToast === 'function') {
    showToast('⚡ Linking account & computing your Elo rating across tournament history...', 'info');
  }

  try {
    const res = await window.api.connectBcpAccount(bcpEmail, bcpPassword);
    if (res && res.success) {
      // Trigger Chrome/Edge Password Manager prompt to save credentials for OmniTactica
      if (window.PasswordCredential && navigator.credentials && navigator.credentials.store) {
        try {
          const cred = new PasswordCredential({
            id: bcpEmail,
            password: bcpPassword,
            name: bcpEmail
          });
          navigator.credentials.store(cred).catch(e => console.debug('Credential store note:', e));
        } catch (err) {
          const formEl = document.getElementById('bcp-form-credentials');
          if (formEl) {
            try {
              const cred = new PasswordCredential(formEl);
              navigator.credentials.store(cred).catch(e2 => console.debug('Credential form store note:', e2));
            } catch (e2) {}
          }
        }
      }

      if (res.user) {
        currentUser = res.user;
        localStorage.setItem('native_user_profile', JSON.stringify(currentUser));
      }
      closeBcpLinkModal();
      await initAuth();
      if (typeof updateStudioAuthBadge === 'function') updateStudioAuthBadge();
      if (typeof loadStudioEvents === 'function' && typeof isUserTO === 'function' && isUserTO(currentUser)) {
        await loadStudioEvents();
      }
      if (typeof loadMyHubDashboard === 'function') loadMyHubDashboard();
      if (typeof loadCommunityHub === 'function') loadCommunityHub();
      const statusMsg = (res.elo_reconstruction && res.elo_reconstruction.status_message)
        ? res.elo_reconstruction.status_message
        : '🎉 Best Coast Pairings account connected & Elo rating computed!';
      if (typeof showToast === 'function') {
        showToast(statusMsg, 'success');
      } else {
        alert(statusMsg);
      }
    } else {
      if (errorDiv) {
        errorDiv.innerText = res?.error || 'Failed to connect BCP account. Please verify credentials.';
        errorDiv.style.display = 'block';
      }
    }
  } catch (err) {
    if (errorDiv) {
      errorDiv.innerText = err.message || 'Connection error occurred.';
      errorDiv.style.display = 'block';
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Connect Best Coast Pairings';
    }
  }
}

async function handleDisconnectBcp() {
  if (!confirm('Are you sure you want to disconnect your Best Coast Pairings account?')) return;
  try {
    await window.api.disconnectBcpAccount();
  } catch (e) {
    console.warn('Disconnect BCP error:', e);
  }
  if (currentUser) {
    currentUser.bcp_connected = false;
    currentUser.bcp_email = null;
    currentUser.bcp_user_id = null;
    localStorage.setItem('native_user_profile', JSON.stringify(currentUser));
  }
  closeBcpLinkModal();
  await initAuth();
  if (typeof updateStudioAuthBadge === 'function') updateStudioAuthBadge();
  if (typeof loadStudioEvents === 'function' && typeof isUserTO === 'function' && isUserTO(currentUser)) {
    await loadStudioEvents();
  }
  if (typeof loadMyHubDashboard === 'function') loadMyHubDashboard();
  if (typeof loadCommunityHub === 'function') loadCommunityHub();
  alert("Best Coast Pairings account disconnected.");
}

function showEloComputationNotice(message, type = 'info') {
  if (typeof document === 'undefined' || !document.body) return;
  let toast = document.getElementById('omni-elo-computation-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'omni-elo-computation-toast';
    toast.style.cssText = 'position:fixed; bottom:24px; right:24px; z-index:20050; max-width:440px; padding:12px 16px; border-radius:10px; font-family:Inter,sans-serif; font-size:0.82rem; font-weight:700; display:flex; align-items:center; gap:10px; box-shadow:0 12px 32px rgba(0,0,0,0.65); transition:all 0.25s ease;';
    document.body.appendChild(toast);
  }
  const isSuccess = type === 'success';
  const isError = type === 'error';
  toast.style.background = isSuccess ? 'rgba(6, 78, 59, 0.96)' : (isError ? 'rgba(127, 29, 29, 0.96)' : 'rgba(15, 23, 42, 0.96)');
  toast.style.border = isSuccess ? '1.5px solid #10b981' : (isError ? '1.5px solid #ef4444' : '1.5px solid #38bdf8');
  toast.style.color = '#f8fafc';
  const icon = isSuccess
    ? '<span style="font-size:1.1rem;">✅</span>'
    : (isError ? '<span style="font-size:1.1rem;">⚠️</span>' : '<span style="display:inline-block; width:14px; height:14px; border:2px solid #38bdf8; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; flex-shrink:0;"></span>');
  toast.innerHTML = `${icon}<div style="line-height:1.35;">${escapeHtml(String(message || ''))}</div>`;
  toast.style.display = 'flex';
  toast.style.opacity = '1';
  if (toast._hideTimer) clearTimeout(toast._hideTimer);
  if (isSuccess || isError) {
    toast._hideTimer = setTimeout(() => {
      if (toast) toast.style.display = 'none';
    }, 6500);
  }
}

if (typeof window !== 'undefined') {
  window.showEloComputationNotice = showEloComputationNotice;
  if (typeof window.showToast !== 'function') {
    window.showToast = showEloComputationNotice;
  }
}

async function linkPlatformAccount(platform, platformPlayerId, playerName = '', userId = '') {
  const platLabel = (typeof getPlatformDisplayName === 'function') ? getPlatformDisplayName(platform) : String(platform || '').toUpperCase();
  showEloComputationNotice(`⚡ Linking ${platLabel} account & computing unified Elo across tournament history...`, 'info');
  try {
    const token = (window.api && typeof window.api.getAuthToken === 'function') ? window.api.getAuthToken() : '';
    const res = await fetch('/api/auth/link-platform', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        platform,
        platform_player_id: platformPlayerId,
        player_name: playerName,
        user_id: userId || (currentUser && currentUser.user_id) || undefined
      })
    });
    const data = await res.json();
    if (res.ok && data && data.success) {
      const recon = data.elo_reconstruction || {};
      const msg = recon.status_message || `Unified ${recon.unified_matches || 0} matches across ${(recon.game_systems_updated || []).length || 1} game systems in ${recon.elapsed_ms || 0}ms!`;
      showEloComputationNotice(msg, 'success');
      return data;
    }
    showEloComputationNotice((data && (data.detail || data.error)) || `Failed to link ${platLabel} account.`, 'error');
    return data;
  } catch (err) {
    showEloComputationNotice(`Error linking ${platLabel}: ${err.message}`, 'error');
    return { success: false, error: err.message };
  }
}
if (typeof window !== 'undefined') {
  window.linkPlatformAccount = linkPlatformAccount;
}

async function handleLogout() {
  try {
    await window.api.logout();
  } catch (e) {}
  currentUser = null;
  if (typeof detachUserSyncSnapshot === 'function') detachUserSyncSnapshot();
  if (typeof detachChatSnapshot === 'function') detachChatSnapshot();
  if (typeof stopChatPolling === 'function') stopChatPolling();

  // 1. Thorough token purge across all storages
  const storageKeys = [
    'native_session_token', 'native_user_profile', 'elo_auth_token', 
    'bcp_session_token', 'bcp_user_profile', 'pending_challenge_target'
  ];
  storageKeys.forEach(k => {
    try { localStorage.removeItem(k); } catch (e) {}
    try { sessionStorage.removeItem(k); } catch (e) {}
  });

  // 2. Thorough cookie wipe across all paths and variations
  const cookieNames = ['session_token', 'elo_auth_token', 'native_session_token'];
  cookieNames.forEach(name => {
    document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    document.cookie = `${name}=; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  });
  
  // 3. Wipe all form inputs and reset auth forms to ensure zero cached credentials
  try {
    const loginForm = document.getElementById('auth-form-login');
    if (loginForm) loginForm.reset();
    const regForm = document.getElementById('auth-form-register');
    if (regForm) regForm.reset();
    ['login-email', 'login-password', 'reg-name', 'reg-email', 'reg-password', 'verify-code-input', 'forgot-email'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  } catch (e) {}

  try {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    window.history.replaceState({}, '', url.pathname);
  } catch (e) {}

  // 4. Standalone PWA vs Regular Browser Detection
  const isStandalone = ('standalone' in window.navigator && window.navigator.standalone) ||
                       (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const targetUrl = isStandalone ? '/login' : '/';

  // 5. Visual feedback: if on app.html, NEVER show an empty black void!
  const appShell = document.getElementById('app-shell');
  if (appShell && !document.getElementById('landing-page-view')) {
    appShell.innerHTML = `
      <div style="min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #94a3b8; font-family: 'Inter', sans-serif; background: #07090e; padding: 24px; text-align: center;">
        <div style="font-size: 2.8rem; margin-bottom: 0.75rem;">🚪</div>
        <div style="font-weight: 800; color: #fff; font-size: 1.25rem; margin-bottom: 0.4rem; font-family: 'Cinzel', serif;">Signed Out</div>
        <div style="font-size: 0.88rem; color: #64748b; margin-bottom: 1.5rem;">Redirecting to ${isStandalone ? 'Sign In' : 'Home'}...</div>
        <a href="${targetUrl}" class="btn btn-primary" style="padding: 10px 22px; font-size: 0.88rem; font-weight: 700; text-decoration: none; border-radius: 8px; box-shadow: 0 4px 16px rgba(56,189,248,0.35);">
          ${isStandalone ? 'Proceed to Sign In' : 'Return to Home'} →
        </a>
      </div>
    `;
  }

  // 6. Single authoritative navigation without conflicting syncAppAuthView or replace calls!
  window.location.replace(targetUrl);
}

function renderHeaderAuth() {
  const container = document.getElementById('header-user-area');
  const feedbackBtn = document.getElementById('nav-btn-feedback');
  const esNavBtn = document.getElementById('nav-btn-event-studio');

  if (feedbackBtn) {
    feedbackBtn.style.display = currentUser ? 'inline-flex' : 'none';
  }

  if (esNavBtn) {
    esNavBtn.style.display = (window.ENABLE_EVENT_STUDIO_TAB && currentUser && isUserTO(currentUser)) ? 'flex' : 'none';
  }

  const mobileProfileBtn = document.getElementById('mobile-btn-more');
  const mobileAvatarIcon = document.getElementById('mobile-top-avatar-icon');
  if (mobileProfileBtn) {
    if (currentUser) {
      mobileProfileBtn.title = `Account Settings (${currentUser.display_name || currentUser.email || 'Player'})`;
      mobileProfileBtn.onclick = () => openUserSettingsModal();
      if (mobileAvatarIcon) mobileAvatarIcon.textContent = currentUser.faction_icon || '👤';
    } else {
      mobileProfileBtn.title = 'Sign In / Account Settings';
      mobileProfileBtn.onclick = () => { window.location.href = '/login'; };
      if (mobileAvatarIcon) mobileAvatarIcon.textContent = '👤';
    }
  }

  syncMobileNavDropdown();

  if (!container) return;

  if (currentUser) {
    const name = currentUser.display_name || currentUser.email || 'Player';
    const isAdmin = currentUser.role === 'admin' || Boolean(currentUser.is_admin);
    const adminLink = isAdmin ? `
      <a href="/admin" style="display:inline-flex; align-items:center; gap:3px; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4); color:#f87171; font-weight:800; font-size:0.7rem; padding:2px 6px; border-radius:6px; text-decoration:none; white-space:nowrap; flex-shrink:0;" title="Admin Governance Dashboard">
        <span>🛡️</span> Admin
      </a>
      <a href="/admin/dice-tracker" id="header-admin-cv-dice-btn" style="display:inline-flex; align-items:center; gap:3px; background:rgba(168,85,247,0.16); border:1px solid rgba(168,85,247,0.45); color:#c084fc; font-weight:800; font-size:0.7rem; padding:2px 6px; border-radius:6px; text-decoration:none; white-space:nowrap; flex-shrink:0;" title="Admin CV Dice Tracker Sandbox">
        <span>📹</span> CV Dice
      </a>
    ` : '';
    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:5px; background:rgba(15,23,42,0.85); border:1px solid var(--border); padding:4px 8px; border-radius:9999px; font-family:'Inter',sans-serif; white-space:nowrap; flex-shrink:0;">
        <span style="width:7px; height:7px; border-radius:50%; background:#10b981; box-shadow:0 0 8px rgba(16,185,129,0.5); flex-shrink:0; display:inline-block;"></span>
        <button onclick="openUserSettingsModal()" style="background:transparent; border:none; color:#f8fafc; font-weight:700; font-size:0.75rem; cursor:pointer; display:inline-flex; align-items:center; gap:4px; padding:0; white-space:nowrap; flex-shrink:0;" title="Account Settings (${escapeHtml(name)})">
          <span style="white-space:nowrap; max-width:115px; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(name)}</span>
          <span style="color:#94a3b8; font-size:11px; display:inline-flex; align-items:center; justify-content:center; line-height:1; vertical-align:middle; transform:translateY(-0.5px);">⚙️</span>
        </button>
        ${adminLink}
        <span style="color:var(--border-color, #334155); font-size:11px;">|</span>
        <button onclick="handleLogout()" style="background:transparent; border:none; color:#ef4444; font-size:0.73rem; font-weight:700; cursor:pointer; padding:0; white-space:nowrap; flex-shrink:0;">Logout</button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <a href="/login?redirect=/" style="background:rgba(56,189,248,0.1); border:1px solid rgba(56,189,248,0.3); color:#38bdf8; font-weight:700; font-size:0.82rem; padding:6px 14px; border-radius:8px; text-decoration:none; display:inline-flex; align-items:center; gap:6px; transition:all 0.2s;" onmouseover="this.style.background='rgba(56,189,248,0.2)'" onmouseout="this.style.background='rgba(56,189,248,0.1)'">
        <span>🔑 Sign In</span>
      </a>
    `;
  }
}

const FACTIONS_40K_DATA = [
  {
    group: 'Imperium',
    factions: [
      'Adepta Sororitas', 'Adeptus Custodes', 'Adeptus Mechanicus', 'Astra Militarum',
      'Grey Knights', 'Imperial Agents', 'Imperial Knights'
    ]
  },
  {
    group: 'Space Marines',
    factions: [
      'Space Marines', 'Black Templars', 'Blood Angels', 'Dark Angels', 'Deathwatch',
      'Imperial Fists', 'Iron Hands', 'Raven Guard', 'Salamanders', 'Space Wolves',
      'Ultramarines', 'White Scars'
    ]
  },
  {
    group: 'Chaos',
    factions: [
      'Chaos Space Marines', 'World Eaters', 'Death Guard', 'Thousand Sons',
      "Emperor's Children", 'Chaos Daemons', 'Chaos Knights'
    ]
  },
  {
    group: 'Xenos',
    factions: [
      'Aeldari', 'Drukhari', 'Genestealer Cults', 'Leagues of Votann',
      'Necrons', 'Orks', "T'au Empire", 'Tyranids'
    ]
  }
];

const FACTIONS_AOS_DATA = [
  {
    group: 'Order',
    factions: [
      'Cities of Sigmar', 'Daughters of Khaine', 'Fyreslayers', 'Idoneth Deepkin',
      'Kharadron Overlords', 'Lumineth Realm-lords', 'Seraphon', 'Stormcast Eternals', 'Sylvaneth'
    ]
  },
  {
    group: 'Chaos',
    factions: [
      'Beasts of Chaos', 'Blades of Khorne', 'Disciples of Tzeentch', 'Hedonites of Slaanesh',
      'Maggotkin of Nurgle', 'Skaven', 'Slaves to Darkness'
    ]
  },
  {
    group: 'Death',
    factions: [
      'Flesh-eater Courts', 'Nighthaunt', 'Ossiarch Bonereapers', 'Soulblight Gravelords'
    ]
  },
  {
    group: 'Destruction',
    factions: [
      'Gloomspite Gitz', 'Ogor Mawtribes', 'Orruk Warclans', 'Sons of Behemat'
    ]
  }
];

const _factionsApiCache = {};

async function fetchDynamicFactions(gameSystem = '40k') {
  const sys = (gameSystem || '40k').toLowerCase().trim();
  if (_factionsApiCache[sys]) return _factionsApiCache[sys];
  try {
    const res = await fetch(`/api/factions?game_system=${encodeURIComponent(sys)}&grouped=true`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        _factionsApiCache[sys] = data;
        return data;
      }
    }
  } catch (e) {
    console.debug('Dynamic factions fetch fallback to local Wahapedia data:', e);
  }
  return null;
}

function renderFactionDropdownOptions(selectEl, dataset, currentVal) {
  if (!selectEl || !Array.isArray(dataset)) return;
  let html = '<option value="">Various / Any Army</option>';
  dataset.forEach(grp => {
    html += `<optgroup label="${escapeHtml(grp.group || grp.label || '')}">`;
    const fList = grp.factions || [];
    fList.forEach(f => {
      const fName = typeof f === 'string' ? f : (f.label || f.name || f.value);
      html += `<option value="${escapeHtml(fName)}">${escapeHtml(fName)}</option>`;
    });
    html += `</optgroup>`;
  });

  if (currentVal) {
    const allKnown = dataset.flatMap(g => (g.factions || []).map(f => typeof f === 'string' ? f : (f.label || f.name || f.value)));
    if (!allKnown.includes(currentVal)) {
      html += `<optgroup label="Other / Saved"><option value="${escapeHtml(currentVal)}">${escapeHtml(currentVal)}</option></optgroup>`;
    }
  }

  selectEl.innerHTML = html;
  if (currentVal) {
    selectEl.value = currentVal;
  }
}

function populateSettingsFactionDropdown(selectedVal = '') {
  const factionSelect = document.getElementById('settings-primary-faction');
  if (!factionSelect) return;

  const currentVal = selectedVal || factionSelect.value || '';
  const isAos = (typeof currentGameSystem !== 'undefined' && currentGameSystem === 'aos');
  const sysKey = (typeof currentGameSystem !== 'undefined' && currentGameSystem) ? currentGameSystem : (isAos ? 'aos' : '40k');
  const localFallback = sysKey === 'aos' ? FACTIONS_AOS_DATA : (sysKey === '40k' ? FACTIONS_40K_DATA : []);
  const cachedData = _factionsApiCache[sysKey];

  // 1. Immediate synchronous render from memory / local Wahapedia dataset
  renderFactionDropdownOptions(factionSelect, cachedData || localFallback, currentVal);

  // 2. Asynchronous background fetch to keep factions dynamically refreshed from Wahapedia API
  if (!cachedData) {
    fetchDynamicFactions(sysKey).then(remoteData => {
      if (remoteData && factionSelect && document.body.contains(factionSelect)) {
        renderFactionDropdownOptions(factionSelect, remoteData, currentVal);
      }
    }).catch(() => {});
  }
}
window.populateSettingsFactionDropdown = populateSettingsFactionDropdown;
function handleMobileProfileClick() {
  if (typeof currentUser !== 'undefined' && currentUser) {
    if (typeof openUserSettingsModal === 'function') {
      openUserSettingsModal();
      return;
    }
  }
  window.location.href = '/login';
}
window.handleMobileProfileClick = handleMobileProfileClick;

function renderSettingsRoleDisplay(userObj) {
  const roleVal = document.getElementById('settings-role-display');
  if (!roleVal || !userObj) return;
  const userEmail = String(userObj.email || '').trim().toLowerCase();
  const isSuper = isVerifiedSuperadmin();
  if (isSuper && userObj.is_mock_player === true) {
    roleVal.innerHTML = `
      <div style="display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
        <span style="background:rgba(245,158,11,0.18); border:1px solid rgba(245,158,11,0.45); color:#fbbf24; font-size:11px; font-weight:800; padding:2px 7px; border-radius:4px;">🎭 MOCK PLAYER</span>
        <button type="button" onclick="closeUserSettingsModal(); openSuperadminMockPlayerModal();" style="background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.4); color:#38bdf8; font-size:11px; font-weight:700; padding:2px 7px; border-radius:4px; cursor:pointer;">🔄 Switch Player</button>
        <button type="button" onclick="exitSuperadminMockPlayer();" style="background:rgba(239,68,68,0.18); border:1px solid rgba(239,68,68,0.45); color:#fca5a5; font-size:11px; font-weight:700; padding:2px 7px; border-radius:4px; cursor:pointer;">✕ Exit Mock</button>
      </div>
    `;
    return;
  }
  const canSwitchOwnRole = Boolean(
    userEmail === 'swimgeek751@gmail.com' &&
    (userObj.can_switch_role === true || userObj.is_superadmin === true)
  );
  const normRole = (() => {
    const r = String(userObj.role || 'player').trim().toLowerCase();
    if (r === 'cc' || r === 'content_creator' || r === 'creator') return 'creator';
    if (r === 'organizer' || r === 'to' || r === 'referee') return 'to';
    if (r === 'admin') return 'admin';
    return 'player';
  })();
  if (canSwitchOwnRole) {
    roleVal.innerHTML = `
      <div style="display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
        <select id="settings-self-role-select" onchange="handleSelfRoleSwitch(this.value)" style="background:rgba(15,23,42,0.92); color:${normRole === 'to' ? '#f59e0b' : (normRole === 'admin' ? '#c084fc' : (normRole === 'creator' ? '#38bdf8' : '#e2e8f0'))}; border:1px solid rgba(56,189,248,0.35); border-radius:6px; padding:3px 8px; font-size:0.78rem; font-weight:700; cursor:pointer;">
          <option value="player" ${normRole === 'player' ? 'selected' : ''}>👤 Player</option>
          <option value="creator" ${normRole === 'creator' ? 'selected' : ''}>🎙️ Creator (CC)</option>
          <option value="to" ${normRole === 'to' ? 'selected' : ''}>🛠️ TO (Organizer)</option>
          <option value="admin" ${normRole === 'admin' ? 'selected' : ''}>🛡️ Admin</option>
        </select>
        <button type="button" id="btn-settings-mock-player" onclick="closeUserSettingsModal(); openSuperadminMockPlayerModal();" style="background:rgba(245,158,11,0.16); border:1px solid rgba(245,158,11,0.45); color:#fbbf24; font-size:11px; font-weight:800; padding:2px 8px; border-radius:4px; cursor:pointer;">🎭 Mock Player</button>
        <a href="/admin" style="background:rgba(168,85,247,0.14); border:1px solid rgba(168,85,247,0.35); color:#c084fc; font-size:11px; font-weight:700; padding:2px 7px; border-radius:4px; text-decoration:none;">🛡️ Admin Panel</a>
      </div>
    `;
  } else if (normRole === 'admin' || userObj.is_admin === true) {
    roleVal.innerHTML = `
      <div style="display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
        <span style="color:#c084fc; font-weight:700;">🛡️ ADMIN</span>
        <a href="/admin" style="background:rgba(168,85,247,0.14); border:1px solid rgba(168,85,247,0.35); color:#c084fc; font-size:11px; font-weight:700; padding:2px 7px; border-radius:4px; text-decoration:none;">🛡️ Admin Panel</a>
      </div>
    `;
  } else {
    const isTO = isUserTO(userObj);
    const roleStr = ((userObj && userObj.role) ? userObj.role : 'player').toUpperCase();
    if (isTO) {
      roleVal.innerHTML = `<span style="color:#10b981; font-weight:700;">🎖️ ${escapeHtml(roleStr)}</span>`;
    } else if (normRole === 'creator') {
      roleVal.innerHTML = `<span style="color:#38bdf8; font-weight:700;">🎙️ CREATOR</span>`;
    } else {
      roleVal.innerHTML = `<span style="color:#94a3b8;">${escapeHtml(roleStr)}</span> <button onclick="closeUserSettingsModal(); if(typeof openRequestToModal === 'function') openRequestToModal();" style="background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.3); color:#f59e0b; font-size:11px; font-weight:600; cursor:pointer; padding:1px 7px; border-radius:4px; margin-left:6px; transition:all 0.15s;">Request TO Access</button>`;
    }
  }
}

function syncRoleDependentViewsAfterAuthUpdate() {
  try {
    renderSettingsRoleDisplay(currentUser);
    if (typeof renderSuperadminMockBanner === 'function') renderSuperadminMockBanner();
    if (typeof syncCreatorHubVisibility === 'function') syncCreatorHubVisibility();
    if (window.currentEventData) {
      const ev = window.currentEventData;
      const evMatches = window.currentEventMatchesData || [];
      if (typeof renderPersonalEventScorecard === 'function') {
        renderPersonalEventScorecard(ev, evMatches);
      } else if (typeof renderPlayerStation === 'function') {
        renderPlayerStation(ev, evMatches);
      }
      if (typeof renderEventMatches === 'function' && evMatches.length) {
        renderEventMatches(evMatches);
      }
    }
  } catch (e) {}
}

function openUserSettingsModal() {
  if (!currentUser) {
    window.location.href = '/login';
    return;
  }
  const modal = document.getElementById('user-settings-modal');
  if (!modal) return;

  populateSettingsFactionDropdown();

  // Populate fields
  const nameInput = document.getElementById('settings-display-name');
  const emailVal = document.getElementById('settings-email-display');
  const bcpVal = document.getElementById('settings-bcp-status');
  const errDiv = document.getElementById('settings-error');
  const successDiv = document.getElementById('settings-success');

  if (errDiv) errDiv.style.display = 'none';
  if (successDiv) successDiv.style.display = 'none';

  if (currentUser) {
    if (nameInput) nameInput.value = currentUser.display_name || '';
    if (emailVal) emailVal.innerText = currentUser.is_mock_player ? 'swimgeek751@gmail.com (Mock Player View)' : (currentUser.email || '-');
    renderSettingsRoleDisplay(currentUser);
    if (bcpVal) {
      if (currentUser.bcp_connected || currentUser.bcp_user_id) {
        const emailLabel = currentUser.bcp_email ? `<div style="color:#94a3b8; font-size:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:210px;" title="${escapeHtml(currentUser.bcp_email)}">(${escapeHtml(currentUser.bcp_email)})</div>` : '';
        bcpVal.innerHTML = `
          <div style="display: flex; align-items: center; gap: 6px; justify-content: flex-end;">
            <span style="color:#10b981; font-weight:700;">🟢 Connected</span>
            <button onclick="closeUserSettingsModal(); openBcpLinkModal();" style="background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.3); color:#38bdf8; font-size:11px; font-weight:600; cursor:pointer; padding:1px 7px; border-radius:4px; transition:all 0.15s;">Manage</button>
          </div>
          ${emailLabel}
        `;
      } else {
        bcpVal.innerHTML = `
          <div style="display: flex; align-items: center; gap: 6px; justify-content: flex-end;">
            <span style="color:#94a3b8; font-size: 0.8rem;">Your BCP: ⚪ Not Linked</span>
            <button onclick="closeUserSettingsModal(); openBcpLinkModal();" style="background:rgba(56,189,248,0.12); border:1px solid rgba(56,189,248,0.3); color:#38bdf8; font-size:11px; font-weight:600; cursor:pointer; padding:1px 7px; border-radius:4px; transition:all 0.15s;">Link now</button>
          </div>
        `;
      }
    }
  }

  // Refresh user role/profile from backend in case an admin updated their role in another tab/window
  const token = localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || getCookieToken();
  if (token && window.api && typeof window.api.getAuthMe === 'function') {
    window.api.getAuthMe(token).then(res => {
      if (res && res.authenticated === true && res.user) {
        const verifiedEmail = String(res.user.email || '').trim().toLowerCase();
        const isSuper = Boolean(verifiedEmail === 'swimgeek751@gmail.com' && (res.user.is_superadmin === true || res.user.can_switch_role === true));
        if (isSuper) {
          __realSuperadminUser = res.user;
          if (typeof window !== 'undefined') window.__realSuperadminUser = res.user;
        } else {
          res.user.can_switch_role = false;
          res.user.is_superadmin = false;
          __realSuperadminUser = null;
          if (typeof window !== 'undefined') window.__realSuperadminUser = null;
          try { sessionStorage.removeItem('omni_superadmin_mock_player'); } catch (e) {}
        }
        localStorage.setItem('native_user_profile', JSON.stringify(res.user));
        const activeMock = isSuper ? getActiveSuperadminMockPlayer() : null;
        if (activeMock) {
          currentUser = activeMock;
          if (typeof window !== 'undefined') window.currentUser = currentUser;
          renderSettingsRoleDisplay(currentUser);
          return;
        }
        const prevRole = currentUser ? String(currentUser.role || 'player').toLowerCase() : '';
        const prevAdmin = Boolean(currentUser && currentUser.is_admin);
        currentUser = res.user;
        if (typeof window !== 'undefined') window.currentUser = currentUser;
        renderSettingsRoleDisplay(currentUser);
        const nextRole = String(currentUser.role || 'player').toLowerCase();
        const nextAdmin = Boolean(currentUser.is_admin || nextRole === 'admin');
        if (prevRole !== nextRole || prevAdmin !== nextAdmin) {
          if (typeof updateStudioAuthBadge === 'function') updateStudioAuthBadge();
          syncAppAuthView();
          if (typeof syncPersonaButtons === 'function') syncPersonaButtons();
          syncRoleDependentViewsAfterAuthUpdate();
        }
      }
    }).catch(() => {});
  }

  loadActiveSessionsList();
  loadUserSettingsLocation();
  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  } else {
    modal.classList.add('active');
  }
}

function closeUserSettingsModal() {
  if (typeof closeModal === 'function') {
    closeModal('user-settings-modal');
  } else {
    const modal = document.getElementById('user-settings-modal');
    if (modal) modal.classList.remove('active');
  }
}

async function handleSelfRoleSwitch(newRole) {
  if (!currentUser) return;
  const errDiv = document.getElementById('settings-error');
  const successDiv = document.getElementById('settings-success');
  const sel = document.getElementById('settings-self-role-select');
  if (errDiv) errDiv.style.display = 'none';
  if (successDiv) successDiv.style.display = 'none';
  if (sel) sel.disabled = true;

  const userEmail = String(currentUser.email || '').trim().toLowerCase();
  if (userEmail !== 'swimgeek751@gmail.com' || !(currentUser.can_switch_role === true || currentUser.is_superadmin === true) || !currentUser.id) {
    if (errDiv) {
      errDiv.innerText = 'Unauthorized: Only the platform owner (swimgeek751@gmail.com) can switch account roles.';
      errDiv.style.display = 'block';
    }
    if (sel) sel.disabled = false;
    return;
  }

  const cleanRole = String(newRole || 'player').trim().toLowerCase();
  try {
    if (!window.api || typeof window.api.setAdminUserRole !== 'function') {
      throw new Error('Role management API unavailable.');
    }
    const res = await window.api.setAdminUserRole(currentUser.id, cleanRole);
    if (!res || res.error || res.success !== true) {
      throw new Error((res && (res.error || res.detail)) || 'Server rejected role change (403 Forbidden).');
    }
    const appliedRole = String(res.role || cleanRole).trim().toLowerCase();
    currentUser.role = appliedRole;
    currentUser.is_admin = (appliedRole === 'admin');
    currentUser.can_access_to = (appliedRole === 'admin' || appliedRole === 'to' || appliedRole === 'organizer' || appliedRole === 'referee');
    currentUser.can_access_cc = (appliedRole === 'admin' || appliedRole === 'creator' || appliedRole === 'cc' || appliedRole === 'content_creator');
    currentUser.is_cc = currentUser.can_access_cc;
    currentUser.can_switch_role = true;
    currentUser.is_superadmin = true;
    window.currentUser = currentUser;
    localStorage.setItem('native_user_profile', JSON.stringify(currentUser));

    renderHeaderAuth();
    syncAppAuthView();
    openUserSettingsModal();

    if (typeof currentEventData !== 'undefined' && currentEventData) {
      if (appliedRole !== 'admin' && typeof currentEventRegistration !== 'undefined' && currentEventRegistration && currentEventRegistration.is_admin_preview) {
        currentEventRegistration = null;
      }
      if (typeof renderPersonalEventScorecard === 'function') {
        renderPersonalEventScorecard(currentEventData, typeof currentEventRegistration !== 'undefined' ? currentEventRegistration : null);
      }
      if (typeof renderPlayerStation === 'function') {
        renderPlayerStation(currentEventData, typeof currentEventRegistration !== 'undefined' ? currentEventRegistration : null);
      }
      if (typeof renderEventPairingsRows === 'function') {
        renderEventPairingsRows();
      }
    }
    if (typeof leagueState !== 'undefined' && leagueState && leagueState.activeLeagueData && typeof renderLeagueDetail === 'function') {
      renderLeagueDetail(leagueState.activeLeagueData);
    }

    if (successDiv) {
      const roleLabels = { player: 'Player', creator: 'Creator (CC)', to: 'Tournament Organizer (TO)', admin: 'Admin' };
      successDiv.innerText = `✓ Active role switched to ${roleLabels[appliedRole] || appliedRole.toUpperCase()}! You are now viewing OmniTactica with ${roleLabels[appliedRole] || appliedRole} permissions.`;
      successDiv.style.display = 'block';
    }
  } catch (err) {
    if (errDiv) {
      errDiv.innerText = 'Failed to switch role: ' + (err.message || 'Unknown error');
      errDiv.style.display = 'block';
    }
  } finally {
    const freshSel = document.getElementById('settings-self-role-select');
    if (freshSel) freshSel.disabled = false;
  }
}
window.handleSelfRoleSwitch = handleSelfRoleSwitch;

async function handleSaveDisplayName(e) {
  if (e) e.preventDefault();
  const nameInput = document.getElementById('settings-display-name');
  const errDiv = document.getElementById('settings-error');
  const successDiv = document.getElementById('settings-success');
  const btn = document.getElementById('btn-save-name');

  if (currentUser && currentUser.is_mock_player) {
    if (errDiv) {
      errDiv.innerText = 'Account mutations are blocked while in Superadmin Mock Player mode. Exit Mock Mode first.';
      errDiv.style.display = 'block';
    }
    return;
  }

  const newName = nameInput ? nameInput.value.trim() : '';
  if (!newName) return;

  if (btn) { btn.disabled = true; btn.innerText = 'Saving...'; }
  if (errDiv) errDiv.style.display = 'none';
  if (successDiv) successDiv.style.display = 'none';

  try {
    const res = await window.api.updateUserSettings(newName, null, null);
    if (res && res.success) {
      currentUser = res.user || { ...currentUser, display_name: newName };
      localStorage.setItem('native_user_profile', JSON.stringify(currentUser));
      renderHeaderAuth();
      if (typeof loadMyHubDashboard === 'function') loadMyHubDashboard();
      if (successDiv) {
        successDiv.innerText = 'Gamer tag updated successfully!';
        successDiv.style.display = 'block';
      }
    } else {
      if (errDiv) {
        errDiv.innerText = res.error || 'Failed to update name.';
        errDiv.style.display = 'block';
      }
    }
  } catch (err) {
    if (errDiv) {
      errDiv.innerText = 'Error: ' + err.message;
      errDiv.style.display = 'block';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = 'Save Name'; }
  }
}

/* --------------------------------------------------------------------------
   USER ACCOUNT SETTINGS: HOME LOCATION & RADAR
   -------------------------------------------------------------------------- */
async function loadUserSettingsLocation() {
  const locInput = document.getElementById('settings-home-location');
  const radSelect = document.getElementById('settings-home-radius');
  const activeSelect = document.getElementById('settings-lfg-active');
  const latEl = document.getElementById('settings-loc-lat');
  const lngEl = document.getElementById('settings-loc-lng');
  const cityEl = document.getElementById('settings-loc-city');
  const stateEl = document.getElementById('settings-loc-state');
  const countryEl = document.getElementById('settings-loc-country');
  const badge = document.getElementById('settings-loc-badge');

  if (!locInput) return;

  // 1. Initial fast populate from window.connectState or localStorage if available
  let profile = (window.connectState && window.connectState.userProfile) ? window.connectState.userProfile : null;
  if (!profile) {
    try {
      const stored = localStorage.getItem('native_user_lfg_profile');
      if (stored) profile = JSON.parse(stored);
    } catch(e) {}
  }

  const applyProfileToUI = (prof) => {
    if (!prof) return;
    const name = prof.home_venue_name || (prof.city ? (prof.state ? `${prof.city}, ${prof.state}` : prof.city) : '');
    if (name) {
      locInput.value = name;
      locInput.dataset.origVal = name;
      locInput.dataset.userEdited = 'false';
      locInput.dataset.placesSelected = 'false';
      delete locInput.dataset.placeLat;
      delete locInput.dataset.placeLng;
      delete locInput.dataset.placeName;
    }
    if (prof.latitude != null && latEl) latEl.value = prof.latitude;
    if (prof.longitude != null && lngEl) lngEl.value = prof.longitude;
    if (prof.city && cityEl) cityEl.value = prof.city;
    if (prof.state && stateEl) stateEl.value = prof.state;
    if (prof.country && countryEl) countryEl.value = prof.country;
    if (prof.radius_miles && radSelect) radSelect.value = String(prof.radius_miles);
    if (prof.is_active !== undefined && activeSelect) activeSelect.value = prof.is_active ? 'true' : 'false';
    const playStyleSelect = document.getElementById('settings-play-style');
    if (prof.play_style && playStyleSelect) playStyleSelect.value = prof.play_style;
    const targetFaction = prof.factions || prof.top_faction || '';
    populateSettingsFactionDropdown(targetFaction);

    if (badge && (prof.latitude != null || name)) {
      badge.textContent = '✓ Saved Location';
      badge.style.background = 'rgba(16,185,129,0.15)';
      badge.style.color = '#10b981';
      badge.style.border = '1px solid rgba(16,185,129,0.3)';
    }
  };

  if (profile) applyProfileToUI(profile);

  // 2. Fetch fresh profile from API
  try {
    const res = await window.api.getConnectProfile();
    if (res && res.success && res.profile) {
      profile = res.profile;
      if (window.connectState) window.connectState.userProfile = profile;
      localStorage.setItem('native_user_lfg_profile', JSON.stringify(profile));
      applyProfileToUI(profile);
    }
  } catch (e) {
    console.warn("Notice: could not load fresh user connect profile:", e);
  }

  // 3. Attach Google Places Autocomplete if available
  setTimeout(attachSettingsPlacesAutocomplete, 100);
}

function attachSettingsPlacesAutocomplete() {
  const locInput = document.getElementById('settings-home-location');
  if (!locInput) return;

  if (!locInput._inputListenerAttached) {
    locInput._inputListenerAttached = true;
    const onUserEdit = () => {
      locInput.dataset.userEdited = 'true';
      locInput.dataset.placesSelected = 'false';
      delete locInput.dataset.placeLat;
      delete locInput.dataset.placeLng;
      delete locInput.dataset.placeName;
      const badge = document.getElementById('settings-loc-badge');
      if (badge) {
        badge.textContent = 'Custom Location';
        badge.style.background = 'rgba(56,189,248,0.1)';
        badge.style.color = '#38bdf8';
        badge.style.border = '1px solid rgba(56,189,248,0.25)';
      }
    };
    locInput.addEventListener('input', onUserEdit);
    locInput.addEventListener('change', onUserEdit);
    locInput.addEventListener('paste', onUserEdit);
  }

  if (typeof google === 'undefined' || !google.maps || !google.maps.places) return;
  if (locInput._autocompleteAttached) return;
  locInput._autocompleteAttached = true;

  try {
    const autocomplete = new google.maps.places.Autocomplete(locInput, {
      types: ['establishment', 'geocode'],
      fields: ['name', 'formatted_address', 'geometry', 'address_components']
    });

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place || !place.geometry || !place.geometry.location) return;

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const name = place.name || locInput.value;

      locInput.dataset.placeLat = String(lat);
      locInput.dataset.placeLng = String(lng);
      locInput.dataset.placeName = name;
      locInput.dataset.placesSelected = 'true';
      locInput.dataset.userEdited = 'false';

      const latEl = document.getElementById('settings-loc-lat');
      const lngEl = document.getElementById('settings-loc-lng');
      const cityEl = document.getElementById('settings-loc-city');
      const stateEl = document.getElementById('settings-loc-state');
      const countryEl = document.getElementById('settings-loc-country');
      const badge = document.getElementById('settings-loc-badge');

      if (latEl) latEl.value = lat;
      if (lngEl) lngEl.value = lng;

      if (place.address_components) {
        for (const comp of place.address_components) {
          const types = comp.types || [];
          if (types.includes('locality') || (!cityEl.value && types.includes('sublocality'))) {
            if (cityEl) cityEl.value = comp.long_name;
          }
          if (types.includes('administrative_area_level_1')) {
            if (stateEl) stateEl.value = comp.short_name || comp.long_name;
          }
          if (types.includes('country')) {
            if (countryEl) countryEl.value = comp.long_name;
          }
        }
      }

      if (badge) {
        badge.textContent = '✓ Places Verified';
        badge.style.background = 'rgba(16,185,129,0.15)';
        badge.style.color = '#10b981';
        badge.style.border = '1px solid rgba(16,185,129,0.3)';
      }
    });
  } catch (e) {
    console.warn("attachSettingsPlacesAutocomplete notice:", e);
  }
}

function detectUserSettingsGPS() {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your device or browser.");
    return;
  }
  const btn = document.getElementById('btn-settings-gps');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> <span>Detecting GPS...</span>';
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      // Unified multi-tier reverse geocoding with instant hub resolution, backend parity, and metro distance checks
      const resolved = (typeof resolveLocationFromCoordinates === 'function')
        ? await resolveLocationFromCoordinates(lat, lng)
        : null;

      const city = resolved?.city || 'Local Area';
      const state = resolved?.state || '';
      const country = resolved?.country || 'United States';
      const venueName = resolved?.formatted || (state ? `${city}, ${state}` : city);

      const locInput = document.getElementById('settings-home-location');
      const latEl = document.getElementById('settings-loc-lat');
      const lngEl = document.getElementById('settings-loc-lng');
      const cityEl = document.getElementById('settings-loc-city');
      const stateEl = document.getElementById('settings-loc-state');
      const countryEl = document.getElementById('settings-loc-country');
      const badge = document.getElementById('settings-loc-badge');

      if (locInput) {
        locInput.value = venueName || `${city}, ${state}`;
        locInput.dataset.placeLat = String(lat);
        locInput.dataset.placeLng = String(lng);
        locInput.dataset.placeName = locInput.value;
        locInput.dataset.placesSelected = 'true';
        locInput.dataset.isGpsLocked = 'true';
        locInput.dataset.userEdited = 'false';
        locInput.dataset.origVal = locInput.value;
      }
      if (latEl) latEl.value = String(lat);
      if (lngEl) lngEl.value = String(lng);
      if (cityEl) cityEl.value = city;
      if (stateEl) stateEl.value = state;
      if (countryEl) countryEl.value = country;
      if (badge) {
        badge.textContent = '✓ GPS Locked';
        badge.style.background = 'rgba(16,185,129,0.15)';
        badge.style.color = '#10b981';
        badge.style.border = '1px solid rgba(16,185,129,0.3)';
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>✓</span> <span>GPS Locked</span>';
      }

      // Immediately sync exact GPS to active community radar
      localStorage.setItem('comm_exact_gps', 'true');
      localStorage.removeItem('comm_manual_override');
      if (typeof updateCommunityLocation === 'function') {
        updateCommunityLocation(lat, lng, locInput ? locInput.value : venueName);
      }
    },
    (err) => {
      console.warn("GPS error:", err);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>🛰️</span> <span>Use Device GPS</span>';
      }
      alert("Could not detect device GPS: " + (err.message || "Permission denied or timeout."));
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

async function handleSaveUserSettingsLocation(e) {
  if (e) e.preventDefault();
  const locInput = document.getElementById('settings-home-location');
  const radSelect = document.getElementById('settings-home-radius');
  const activeSelect = document.getElementById('settings-lfg-active');
  const latEl = document.getElementById('settings-loc-lat');
  const lngEl = document.getElementById('settings-loc-lng');
  const cityEl = document.getElementById('settings-loc-city');
  const stateEl = document.getElementById('settings-loc-state');
  const countryEl = document.getElementById('settings-loc-country');
  const btn = document.getElementById('btn-save-settings-loc');
  const errDiv = document.getElementById('settings-error');
  const successDiv = document.getElementById('settings-success');

  const rawInput = locInput ? locInput.value.trim() : '';
  if (!rawInput) {
    if (errDiv) {
      errDiv.innerText = 'Please enter a home city, game store, or club.';
      errDiv.style.display = 'block';
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.innerText = 'Saving Location...'; }
  if (errDiv) errDiv.style.display = 'none';
  if (successDiv) successDiv.style.display = 'none';

  let targetLat = null;
  let targetLng = null;
  let chosenCity = cityEl ? cityEl.value.trim() : '';
  let chosenState = stateEl ? stateEl.value.trim() : '';
  let chosenCountry = countryEl ? countryEl.value.trim() : 'United States';
  let chosenLocName = rawInput;

  // 0. If GPS was locked via "Use Device GPS" in settings
  const badge = document.getElementById('settings-loc-badge');
  const isGpsLocked = (locInput && locInput.dataset.isGpsLocked === 'true') ||
                      (badge && badge.textContent && badge.textContent.includes('GPS Locked'));

  if (isGpsLocked && latEl && latEl.value && lngEl && lngEl.value && !isNaN(parseFloat(latEl.value)) && !isNaN(parseFloat(lngEl.value))) {
    targetLat = parseFloat(latEl.value);
    targetLng = parseFloat(lngEl.value);
    localStorage.setItem('comm_exact_gps', 'true');
    localStorage.removeItem('comm_manual_override');
  } else if (locInput && locInput.dataset.placesSelected === 'true' && locInput.dataset.placeLat && locInput.dataset.placeLng) {
    targetLat = parseFloat(locInput.dataset.placeLat);
    targetLng = parseFloat(locInput.dataset.placeLng);
  } else if (rawInput && latEl && latEl.value && lngEl && lngEl.value && locInput && locInput.dataset.origVal === rawInput) {
    // 2. Unchanged from initial modal open state
    targetLat = parseFloat(latEl.value);
    targetLng = parseFloat(lngEl.value);
  }

  // 3. User changed or entered new location
  if (targetLat == null && rawInput) {
    // 3a. City coordinates lookup dictionary (instant 0ms)
    const matched = (typeof lookupCityCoordinates === 'function') ? lookupCityCoordinates(rawInput) : null;
    if (matched) {
      targetLat = matched.lat;
      targetLng = matched.lng;
      chosenCity = matched.name ? matched.name.split(',')[0].trim() : rawInput;
      chosenState = (matched.name && matched.name.includes(',')) ? matched.name.split(',')[1].trim() : '';
      chosenLocName = matched.name || rawInput;
    } else {
      // 3. Try Google geocoder if available
      if (typeof google !== 'undefined' && google.maps && google.maps.Geocoder) {
        try {
          const geocoder = new google.maps.Geocoder();
          const gRes = await new Promise((resolve) => {
            geocoder.geocode({ address: rawInput }, (results, status) => {
              if (status === 'OK' && results && results[0] && results[0].geometry) resolve(results[0]);
              else resolve(null);
            });
          });
          if (gRes && gRes.geometry && gRes.geometry.location) {
            targetLat = gRes.geometry.location.lat();
            targetLng = gRes.geometry.location.lng();
            chosenLocName = gRes.formatted_address || rawInput;
            if (gRes.address_components) {
              for (const comp of gRes.address_components) {
                const types = comp.types || [];
                if (types.includes('locality')) chosenCity = comp.long_name;
                if (types.includes('administrative_area_level_1')) chosenState = comp.short_name || comp.long_name;
                if (types.includes('country')) chosenCountry = comp.long_name;
              }
            }
          }
        } catch (e) {
          console.warn("Google geocode lookup error:", e);
        }
      }

      // 4. Nominatim geocode fallback
      if (targetLat == null) {
        try {
          const nRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(rawInput)}&limit=1`, {
            headers: { 'Accept': 'application/json' }
          });
          if (nRes.ok) {
            const items = await nRes.json();
            if (items && items.length > 0) {
              targetLat = parseFloat(items[0].lat);
              targetLng = parseFloat(items[0].lon);
              const displayName = items[0].display_name || '';
              const parts = displayName.split(',').map(s => s.trim());
              if (parts.length > 0) chosenCity = parts[0];
              if (parts.length > 1) chosenState = parts[1];
            }
          }
        } catch (e) {
          console.warn("Nominatim search error:", e);
        }
      }
    }
  }

  // Fallback defaults if San Diego
  if (targetLat == null && rawInput.toLowerCase().includes('san diego')) {
    targetLat = 32.7157;
    targetLng = -117.1611;
    chosenCity = 'San Diego';
    chosenState = 'CA';
  }

  const radius = radSelect ? parseInt(radSelect.value, 10) : 50;
  const isActive = activeSelect ? (activeSelect.value === 'true') : true;
  const playStyleSelect = document.getElementById('settings-play-style');
  const factionSelect = document.getElementById('settings-primary-faction');

  const existing = (window.connectState && window.connectState.userProfile) ? window.connectState.userProfile : {};
  const payload = {
    ...existing,
    is_active: isActive,
    home_venue_name: chosenLocName,
    city: chosenCity || rawInput,
    state: chosenState,
    country: chosenCountry || 'United States',
    latitude: targetLat,
    longitude: targetLng,
    radius_miles: radius,
    play_style: playStyleSelect ? playStyleSelect.value : (existing.play_style || 'Competitive'),
    factions: factionSelect ? factionSelect.value.trim() : (existing.factions || '')
  };

  try {
    const res = await window.api.saveConnectProfile(payload);
    if (res && res.success) {
      if (window.connectState) {
        window.connectState.userProfile = { ...(window.connectState.userProfile || {}), ...payload };
        if (typeof renderTopBarOptions === 'function') renderTopBarOptions(window.connectState.userProfile);
      }
      localStorage.setItem('native_user_lfg_profile', JSON.stringify(payload));
      if (isGpsLocked) {
        localStorage.setItem('comm_exact_gps', 'true');
        localStorage.removeItem('comm_manual_override');
      }
      if (typeof updateCommunityLocation === 'function') {
        updateCommunityLocation(payload.latitude, payload.longitude, payload.home_venue_name || payload.city, payload.radius_miles);
      }
      if (successDiv) {
        successDiv.innerText = `✓ Home location saved as "${chosenLocName}"! Local radar and matchmaking updated.`;
        successDiv.style.display = 'block';
      }
      const badge = document.getElementById('settings-loc-badge');
      if (badge) {
        badge.textContent = '✓ Saved Location';
        badge.style.background = 'rgba(16,185,129,0.15)';
        badge.style.color = '#10b981';
        badge.style.border = '1px solid rgba(16,185,129,0.3)';
      }
    } else {
      if (errDiv) {
        errDiv.innerText = res?.error || 'Failed to save location.';
        errDiv.style.display = 'block';
      }
    }
  } catch (err) {
    if (errDiv) {
      errDiv.innerText = 'Error: ' + err.message;
      errDiv.style.display = 'block';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = 'Save Home Location'; }
  }
}

async function handleSavePassword(e) {
  if (e) e.preventDefault();
  const oldPass = document.getElementById('settings-old-pass').value;
  const newPass = document.getElementById('settings-new-pass').value;
  const confirmPass = document.getElementById('settings-confirm-pass').value;
  const errDiv = document.getElementById('settings-error');
  const successDiv = document.getElementById('settings-success');
  const btn = document.getElementById('btn-save-pass');

  if (newPass !== confirmPass) {
    if (errDiv) {
      errDiv.innerText = 'New passwords do not match.';
      errDiv.style.display = 'block';
    }
    return;
  }
  if (newPass.length < 6) {
    if (errDiv) {
      errDiv.innerText = 'New password must be at least 6 characters.';
      errDiv.style.display = 'block';
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.innerText = 'Updating...'; }
  if (errDiv) errDiv.style.display = 'none';
  if (successDiv) successDiv.style.display = 'none';

  try {
    const res = await window.api.updateUserSettings(null, oldPass, newPass);
    if (res && res.success) {
      document.getElementById('settings-old-pass').value = '';
      document.getElementById('settings-new-pass').value = '';
      document.getElementById('settings-confirm-pass').value = '';
      if (successDiv) {
        successDiv.innerText = 'Password changed successfully!';
        successDiv.style.display = 'block';
      }
    } else {
      if (errDiv) {
        errDiv.innerText = res.error || 'Failed to change password.';
        errDiv.style.display = 'block';
      }
    }
  } catch (err) {
    if (errDiv) {
      errDiv.innerText = 'Error: ' + err.message;
      errDiv.style.display = 'block';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = 'Update Password'; }
  }
}

async function handleForgotPasswordSubmit() {
  const emailInput = document.getElementById('forgot-email');
  const errDiv = document.getElementById('forgot-error');
  const successDiv = document.getElementById('forgot-success');
  const btn = document.getElementById('btn-submit-forgot');

  const email = emailInput ? emailInput.value.trim() : '';
  if (!email) {
    if (errDiv) {
      errDiv.innerText = 'Please enter your account email.';
      errDiv.style.display = 'block';
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.innerText = 'Sending Reset Link...'; }
  if (errDiv) errDiv.style.display = 'none';
  if (successDiv) successDiv.style.display = 'none';

  try {
    const res = await window.api.forgotPassword(email);
    if (res && res.success) {
      if (successDiv) {
        successDiv.innerText = res.message || 'Password reset instructions sent to your email!';
        successDiv.style.display = 'block';
      }
    } else {
      if (errDiv) {
        errDiv.innerText = res?.error || 'Failed to dispatch password reset.';
        errDiv.style.display = 'block';
      }
    }
  } catch (err) {
    if (errDiv) {
      errDiv.innerText = 'Error: ' + err.message;
      errDiv.style.display = 'block';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = 'Send Password Reset Code'; }
  }
}

function formatSessionTime(isoStr) {
  if (!isoStr) return 'Recently';
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diffSec = Math.floor((now - d) / 1000);
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  } catch(e) {
    return 'Recently';
  }
}

async function loadActiveSessionsList() {
  const container = document.getElementById('settings-sessions-list');
  if (!container) return;
  container.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted); padding:4px;">Loading active sessions...</div>';

  try {
    const res = await window.api.getActiveSessions();
    if (!res || !res.sessions || res.sessions.length === 0) {
      container.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted); padding:4px;">No other active sessions.</div>';
      return;
    }

    let html = '';
    res.sessions.forEach(s => {
      const isCurrent = s.is_current;
      const devName = s.device_name || 'Unknown Device';
      const lastActive = formatSessionTime(s.last_active_at);
      const ip = s.ip_address || 'Unknown IP';

      html += `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:7px 10px; background:rgba(255,255,255,0.03); border:1px solid ${isCurrent ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)'}; border-radius:6px;">
          <div>
            <div style="font-size:0.8rem; font-weight:700; color:#fff; display:flex; align-items:center; gap:6px;">
              <span>${escapeHtml(devName)}</span>
              ${isCurrent ? '<span style="font-size:0.68rem; color:#10b981; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.3); padding:1px 5px; border-radius:4px;">🟢 This Device</span>' : ''}
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">
              IP: ${escapeHtml(ip)} • Active ${lastActive}
            </div>
          </div>
          ${!isCurrent ? `
            <button type="button" onclick="handleRevokeSession('${escapeHtml(s.session_token)}', '${escapeHtml(devName)}')" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3); font-size:0.7rem; font-weight:700; padding:3px 8px; border-radius:4px; cursor:pointer;">
              Revoke
            </button>
          ` : ''}
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div style="font-size:0.75rem; color:var(--loss); padding:4px;">Error loading sessions: ${escapeHtml(err.message)}</div>`;
  }
}

async function handleRevokeSession(targetToken, deviceName) {
  if (!confirm(`Revoke session for ${deviceName || 'this device'}? It will be immediately signed out.`)) return;
  try {
    const res = await window.api.revokeSession(targetToken);
    if (res && res.success) {
      await loadActiveSessionsList();
    } else {
      alert(res?.error || 'Failed to revoke session.');
    }
  } catch (err) {
    alert('Error revoking session: ' + err.message);
  }
}

async function handleSignOutAllDevices(keepCurrent = false) {
  const msg = keepCurrent
    ? "Sign out of all other devices? You will remain logged into this device."
    : "Sign out of ALL devices including this one? You will be logged out immediately.";

  if (!confirm(msg)) return;

  try {
    const res = await window.api.logoutAll(keepCurrent);
    if (res && res.success) {
      if (!keepCurrent) {
        alert(res.message || 'Successfully signed out of all devices.');
        closeUserSettingsModal();
        await handleLogout();
      } else {
        alert(res.message || 'Successfully signed out of all other devices.');
        await loadActiveSessionsList();
      }
    } else {
      alert(res?.error || 'Failed to sign out of all devices.');
    }
  } catch (err) {
    alert('Error signing out of all devices: ' + err.message);
  }
}

window.syncAppAuthView = syncAppAuthView;
window.setAuthCardTab = setAuthCardTab;
window.handleNativeLogin = handleNativeLogin;
window.handleNativeRegister = handleNativeRegister;
window.handleVerifyRegistrationCode = handleVerifyRegistrationCode;
window.handleResendVerificationCode = handleResendVerificationCode;
window.handleForgotPasswordSubmit = handleForgotPasswordSubmit;
window.handleLogout = handleLogout;
window.loadActiveSessionsList = loadActiveSessionsList;
window.handleRevokeSession = handleRevokeSession;
window.handleSignOutAllDevices = handleSignOutAllDevices;
window.loadUserSettingsLocation = loadUserSettingsLocation;
window.attachSettingsPlacesAutocomplete = attachSettingsPlacesAutocomplete;
window.detectUserSettingsGPS = detectUserSettingsGPS;
window.handleSaveUserSettingsLocation = handleSaveUserSettingsLocation;

// =========================================================================
// 24-HOUR PLAYER INVITATION PASS
// =========================================================================

let inviteCountdownTimer = null;

function startInviteCountdown(expiresAtIso, fallbackSecs = 86400) {
  if (inviteCountdownTimer) {
    clearInterval(inviteCountdownTimer);
    inviteCountdownTimer = null;
  }

  let targetMs = 0;
  if (expiresAtIso) {
    targetMs = new Date(expiresAtIso).getTime();
  }
  if (!targetMs || isNaN(targetMs)) {
    targetMs = Date.now() + (fallbackSecs * 1000);
  }

  function tick() {
    const timeEl = document.getElementById('invite-time-remaining');
    if (!timeEl) return;

    const remainingMs = targetMs - Date.now();
    const diffSecs = Math.max(0, Math.floor(remainingMs / 1000));

    if (diffSecs <= 0) {
      timeEl.textContent = '⚠️ Pass Expired — Click "Refresh Code" for a new pass';
      timeEl.style.color = '#ef4444';
      if (inviteCountdownTimer) {
        clearInterval(inviteCountdownTimer);
        inviteCountdownTimer = null;
      }
      return;
    }

    const hrs = Math.floor(diffSecs / 3600);
    const mins = Math.floor((diffSecs % 3600) / 60);
    const secs = diffSecs % 60;
    const secStr = secs < 10 ? `0${secs}` : `${secs}`;

    if (hrs > 0) {
      timeEl.textContent = `⏳ Expires in ${hrs}h ${mins}m ${secStr}s`;
    } else {
      timeEl.textContent = `⏳ Expires in ${mins}m ${secStr}s`;
    }

    if (hrs < 1) {
      timeEl.style.color = '#f59e0b';
    } else {
      timeEl.style.color = '#38bdf8';
    }
  }

  tick();
  inviteCountdownTimer = setInterval(tick, 1000);
}

async function openInviteModal() {
  const modal = document.getElementById('invite-players-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  if (typeof bringModalToFront === 'function') {
    bringModalToFront(modal);
  }
  await refreshUserInviteCode(false);
}

function closeInviteModal() {
  if (inviteCountdownTimer) {
    clearInterval(inviteCountdownTimer);
    inviteCountdownTimer = null;
  }
  if (typeof closeModal === 'function') {
    closeModal('invite-players-modal');
  }
  const modal = document.getElementById('invite-players-modal');
  if (modal) modal.style.display = 'none';
}

async function refreshUserInviteCode(forceNew = false) {
  const loading = document.getElementById('invite-modal-loading');
  const body = document.getElementById('invite-modal-body');
  const codeEl = document.getElementById('invite-display-code');
  const timeEl = document.getElementById('invite-time-remaining');
  const countEl = document.getElementById('invite-usage-count');
  const linkEl = document.getElementById('invite-direct-link');

  if (inviteCountdownTimer) {
    clearInterval(inviteCountdownTimer);
    inviteCountdownTimer = null;
  }

  if (loading) {
    loading.textContent = forceNew ? 'Generating fresh 24-hour pass...' : 'Retrieving your 24-hour invite pass...';
    loading.style.color = 'var(--text-muted)';
    loading.style.display = 'block';
  }
  if (body) body.style.display = 'none';

  try {
    const res = forceNew ? await window.api.generateInviteCode() : await window.api.getMyInviteCode();
    if (res && res.success) {
      if (codeEl) codeEl.textContent = res.code;
      
      startInviteCountdown(res.expires_at, res.remaining_seconds);

      if (countEl) {
        countEl.textContent = `${res.use_count || 0} players`;
      }
      
      const origin = window.location.origin;
      const inviteUrl = `${origin}/login?invite=${encodeURIComponent(res.code)}`;
      if (linkEl) linkEl.value = inviteUrl;

      if (loading) loading.style.display = 'none';
      if (body) body.style.display = 'block';
    } else {
      if (loading) {
        loading.textContent = res?.error || 'Registration is currently closed by the administrator.';
        loading.style.color = '#ef4444';
      }
    }
  } catch (err) {
    if (loading) {
      loading.textContent = 'Failed to retrieve invite code: ' + err.message;
      loading.style.color = '#ef4444';
    }
  }
}

function copyInviteLink() {
  const linkEl = document.getElementById('invite-direct-link');
  const btn = document.getElementById('btn-copy-invite');
  if (!linkEl || !linkEl.value) return;

  navigator.clipboard.writeText(linkEl.value).then(() => {
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✓ Copied!';
      btn.style.background = '#10b981';
      setTimeout(() => {
        btn.innerHTML = orig;
        btn.style.background = '';
      }, 2000);
    }
  }).catch(() => {
    linkEl.select();
    document.execCommand('copy');
    if (btn) {
      btn.textContent = '✓ Copied!';
      setTimeout(() => btn.textContent = '📋 Copy Link', 2000);
    }
  });
}

window.openInviteModal = openInviteModal;
window.closeInviteModal = closeInviteModal;
window.refreshUserInviteCode = refreshUserInviteCode;
window.copyInviteLink = copyInviteLink;
window.openBcpLinkModal = openBcpLinkModal;
window.closeBcpLinkModal = closeBcpLinkModal;
window.showBcpCredentialsForm = showBcpCredentialsForm;
window.handleConnectBcp = handleConnectBcp;
window.handleDisconnectBcp = handleDisconnectBcp;

/* ==========================================================================
   SUPERADMIN MOCK PLAYER / USER VIEW (Strictly restricted to swimgeek751@gmail.com)
   ========================================================================== */

function renderSuperadminMockBanner() {
  if (typeof document === 'undefined' || !document.body) return;
  let banner = document.getElementById('omni-superadmin-mock-banner');
  const activeMock = getActiveSuperadminMockPlayer();

  if (!isVerifiedSuperadmin() || !activeMock || !currentUser || !currentUser.is_mock_player) {
    if (banner) banner.remove();
    return;
  }

  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'omni-superadmin-mock-banner';
    banner.style.cssText = 'position:sticky; top:0; left:0; right:0; z-index:9999; background:linear-gradient(90deg, rgba(120,53,15,0.96), rgba(30,41,59,0.98), rgba(120,53,15,0.96)); border-bottom:1.5px solid #f59e0b; padding:6px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; box-shadow:0 4px 16px rgba(0,0,0,0.45); font-size:0.78rem; color:#fef3c7;';
    const appShell = document.getElementById('app-shell');
    if (appShell && appShell.parentNode) {
      appShell.parentNode.insertBefore(banner, appShell);
    } else {
      document.body.insertBefore(banner, document.body.firstChild);
    }
  }

  const mockName = String(activeMock.display_name || activeMock.full_name || 'Player');
  const mockTeam = String(activeMock.team_name || '').trim();
  const mockFac = String(activeMock.faction || '').trim();
  const detailParts = [];
  if (activeMock.is_unregistered_mock) {
    detailParts.push('Unregistered User / Spectator');
  } else {
    if (mockTeam) detailParts.push(`Team: ${mockTeam}`);
    if (mockFac) detailParts.push(mockFac);
    detailParts.push('Role: PLAYER');
  }
  const detailStr = detailParts.join(' • ');

  banner.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0;">
      <span style="background:#f59e0b; color:#090d16; font-weight:900; font-size:0.68rem; padding:2px 7px; border-radius:4px; letter-spacing:0.04em; text-transform:uppercase;">🎭 SUPERADMIN MOCK VIEW</span>
      <span style="color:#fff; font-weight:800;">Viewing as: <strong style="color:#38bdf8;">${escapeHtml(mockName)}</strong></span>
      ${detailStr ? `<span style="color:#fde68a; font-size:0.74rem;">(${escapeHtml(detailStr)})</span>` : ''}
      <span style="color:#94a3b8; font-size:0.7rem;">• Read-only testing mode for swimgeek751@gmail.com</span>
    </div>
    <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
      <button type="button" id="btn-banner-switch-mock-player" onclick="openSuperadminMockPlayerModal()" style="background:rgba(56,189,248,0.18); border:1px solid rgba(56,189,248,0.5); color:#38bdf8; font-weight:800; font-size:0.73rem; padding:3px 9px; border-radius:5px; cursor:pointer;">
        🔄 Switch Player
      </button>
      <button type="button" id="btn-banner-exit-mock-player" onclick="exitSuperadminMockPlayer()" style="background:rgba(239,68,68,0.22); border:1px solid rgba(239,68,68,0.55); color:#fca5a5; font-weight:800; font-size:0.73rem; padding:3px 9px; border-radius:5px; cursor:pointer;">
        ✕ Exit Mock Mode
      </button>
    </div>
  `;
}
window.renderSuperadminMockBanner = renderSuperadminMockBanner;

function collectCurrentEventMockCandidates() {
  const ev = (typeof currentEventData !== 'undefined' && currentEventData) || (typeof window !== 'undefined' && window.currentEventData) || null;
  if (!ev) return { eventName: '', eventId: '', teams: [], players: [] };
  const evId = String(ev.id || ev.event_id || (typeof currentOpenEventId !== 'undefined' ? currentOpenEventId : '') || '');
  const evName = String(ev.name || ev.event_name || 'Current Tournament');
  const rawTeams = (Array.isArray(ev.teams) && ev.teams.length > 0)
    ? ev.teams
    : (Array.isArray(ev.team_standings) ? ev.team_standings : []);
  const teamPairings = Array.isArray(ev.team_pairings) ? ev.team_pairings : [];
  const activePairedTeams = new Set();
  teamPairings.forEach(tp => {
    if (tp.team1_name) activePairedTeams.add(String(tp.team1_name).trim().toLowerCase());
    if (tp.team2_name) activePairedTeams.add(String(tp.team2_name).trim().toLowerCase());
  });

  const playersPool = Array.isArray(ev.players) && ev.players.length > 0
    ? ev.players
    : (typeof eventPlayersCache !== 'undefined' && Array.isArray(eventPlayersCache) ? eventPlayersCache : []);

  const teamsOut = [];
  const seenTeamNames = new Set();

  rawTeams.forEach(t => {
    const tName = String(t.name || t.team_name || '').trim();
    if (!tName) return;
    seenTeamNames.add(tName.toLowerCase());
    const members = Array.isArray(t.members) && t.members.length > 0
      ? t.members
      : playersPool.filter(p => String(p.team || p.team_name || '').trim().toLowerCase() === tName.toLowerCase());
    teamsOut.push({
      name: tName,
      hasActivePairing: activePairedTeams.has(tName.toLowerCase()),
      members: members.map(m => {
        const fullName = String(m.full_name || m.name || `${m.first_name || ''} ${m.last_name || ''}`).trim() || 'Player';
        const pid = String(m.player_id || m.id || m.bcp_event_player_id || m.user_id || fullName).trim();
        return {
          player_id: pid,
          bcp_player_id: String(m.bcp_event_player_id || pid),
          full_name: fullName,
          team_name: tName,
          faction: String(m.faction || m.army_name || 'Unassigned'),
          detachment: String(m.detachment || ''),
          is_captain: Boolean(m.is_captain),
          elo: Math.round(Number(m.elo || m.current_elo || 1500)),
        };
      }),
    });
  });

  // Also include any teams present in team_pairings if not already in rawTeams
  teamPairings.forEach(tp => {
    [
      { name: tp.team1_name, roster: tp.team1_roster },
      { name: tp.team2_name, roster: tp.team2_roster },
    ].forEach(side => {
      const tName = String(side.name || '').trim();
      if (!tName || seenTeamNames.has(tName.toLowerCase())) return;
      seenTeamNames.add(tName.toLowerCase());
      const roster = Array.isArray(side.roster) ? side.roster : [];
      teamsOut.push({
        name: tName,
        hasActivePairing: true,
        members: roster.map(m => {
          const fullName = String(m.full_name || m.name || `${m.first_name || ''} ${m.last_name || ''}`).trim() || 'Player';
          const pid = String(m.player_id || m.id || m.bcp_event_player_id || fullName).trim();
          return {
            player_id: pid,
            bcp_player_id: String(m.bcp_event_player_id || pid),
            full_name: fullName,
            team_name: tName,
            faction: String(m.faction || m.army_name || 'Unassigned'),
            detachment: String(m.detachment || ''),
            is_captain: Boolean(m.is_captain),
            elo: Math.round(Number(m.elo || m.current_elo || 1500)),
          };
        }),
      });
    });
  });

  teamsOut.sort((a, b) => (Number(b.hasActivePairing) - Number(a.hasActivePairing)) || a.name.localeCompare(b.name));

  const flatPlayers = playersPool.map(p => {
    const fullName = String(p.full_name || p.name || `${p.first_name || ''} ${p.last_name || ''}`).trim() || 'Player';
    const pid = String(p.player_id || p.id || p.bcp_event_player_id || p.user_id || fullName).trim();
    return {
      player_id: pid,
      bcp_player_id: String(p.bcp_event_player_id || pid),
      full_name: fullName,
      team_name: String(p.team || p.team_name || '').trim(),
      faction: String(p.faction || p.army_name || 'Unassigned'),
      detachment: String(p.detachment || ''),
      is_captain: Boolean(p.is_captain),
      elo: Math.round(Number(p.current_elo || p.elo || 1500)),
    };
  });

  return { eventName: evName, eventId: evId, teams: teamsOut, players: flatPlayers };
}

function activateSuperadminMockCandidateByIndex(idx) {
  const list = (typeof window !== 'undefined' && Array.isArray(window._superadminMockCandidates)) ? window._superadminMockCandidates : [];
  const item = list[Number(idx)];
  if (!item) return;
  activateSuperadminMockPlayer(item);
}
window.activateSuperadminMockCandidateByIndex = activateSuperadminMockCandidateByIndex;

function renderSuperadminMockPlayerList(searchQuery = '') {
  const listContainer = document.getElementById('superadmin-mock-player-candidates-list');
  if (!listContainer) return;
  const q = String(searchQuery || '').trim().toLowerCase();
  const { eventName, eventId, teams, players } = collectCurrentEventMockCandidates();
  const activeMock = getActiveSuperadminMockPlayer();
  const activeMockPid = String(activeMock?.player_id || '').trim().toLowerCase();
  const activeMockName = String(activeMock?.full_name || activeMock?.display_name || '').trim().toLowerCase();
  const candidatePayloads = [];
  if (typeof window !== 'undefined') window._superadminMockCandidates = candidatePayloads;

  if (teams.length > 0) {
    const filteredTeams = teams.map(t => {
      const tMatches = !q || t.name.toLowerCase().includes(q);
      const matchingMembers = t.members.filter(m =>
        tMatches ||
        m.full_name.toLowerCase().includes(q) ||
        m.faction.toLowerCase().includes(q) ||
        m.detachment.toLowerCase().includes(q)
      );
      return Object.assign({}, t, { members: matchingMembers });
    }).filter(t => t.members.length > 0);

    if (filteredTeams.length === 0) {
      listContainer.innerHTML = `<div style="padding:1rem; text-align:center; color:#94a3b8; font-size:0.8rem;">No teams or players in ${escapeHtml(eventName)} match "${escapeHtml(searchQuery)}".</div>`;
      return;
    }

    listContainer.innerHTML = filteredTeams.map(t => {
      const rows = t.members.map(m => {
        const isCurrentMock = Boolean(
          activeMock && !activeMock.is_unregistered_mock && (
            (activeMockPid && m.player_id.toLowerCase() === activeMockPid) ||
            (activeMockName && m.full_name.toLowerCase() === activeMockName)
          )
        );
        const candIdx = candidatePayloads.length;
        candidatePayloads.push({
          mode: 'player',
          player_id: m.player_id,
          bcp_player_id: m.bcp_player_id,
          full_name: m.full_name,
          team_name: m.team_name,
          faction: m.faction,
          detachment: m.detachment,
          is_captain: m.is_captain,
          elo: m.elo,
          event_id: eventId,
        });
        return `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; border-radius:7px; background:${isCurrentMock ? 'rgba(245,158,11,0.16)' : 'rgba(9,14,26,0.65)'}; border:1px solid ${isCurrentMock ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.06)'};">
            <div style="min-width:0; flex:1;">
              <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                <span style="font-weight:800; font-size:0.82rem; color:#f8fafc;">${escapeHtml(m.full_name)}</span>
                ${m.is_captain ? `<span style="font-size:0.62rem; font-weight:800; padding:1px 5px; border-radius:4px; background:rgba(245,158,11,0.2); color:#fbbf24; border:1px solid rgba(245,158,11,0.4);">👑 CAPTAIN</span>` : ''}
                ${isCurrentMock ? `<span style="font-size:0.62rem; font-weight:900; padding:1px 5px; border-radius:4px; background:#f59e0b; color:#090d16;">ACTIVE MOCK</span>` : ''}
              </div>
              <div style="font-size:0.71rem; color:#94a3b8;">
                ${escapeHtml(m.faction)}${m.detachment ? ` • ${escapeHtml(m.detachment)}` : ''} • <span style="font-family:var(--font-mono); color:#38bdf8;">${m.elo} Elo</span>
              </div>
            </div>
            <button type="button" class="btn-mock-candidate-select" data-candidate-idx="${candIdx}" onclick="activateSuperadminMockCandidateByIndex(${candIdx})" style="background:${isCurrentMock ? 'rgba(16,185,129,0.2)' : 'rgba(56,189,248,0.15)'}; border:1px solid ${isCurrentMock ? 'rgba(16,185,129,0.5)' : 'rgba(56,189,248,0.45)'}; color:${isCurrentMock ? '#34d399' : '#38bdf8'}; font-weight:800; font-size:0.73rem; padding:4px 10px; border-radius:6px; cursor:pointer; white-space:nowrap;">
              ${isCurrentMock ? '✓ Mocking' : '🎭 Mock as Player'}
            </button>
          </div>
        `;
      }).join('');

      return `
        <div style="background:rgba(15,23,42,0.82); border:1px solid rgba(56,189,248,0.25); border-radius:9px; padding:9px 11px; margin-bottom:8px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; padding-bottom:5px; border-bottom:1px solid rgba(255,255,255,0.07);">
            <div style="font-weight:900; font-size:0.86rem; color:#38bdf8;">🛡️ ${escapeHtml(t.name)} <span style="color:#94a3b8; font-weight:600; font-size:0.72rem;">(${t.members.length} Players)</span></div>
            ${t.hasActivePairing ? `<span style="font-size:0.64rem; font-weight:800; padding:2px 6px; border-radius:4px; background:rgba(16,185,129,0.18); color:#34d399; border:1px solid rgba(16,185,129,0.4);">⚔️ Active Team Pairing</span>` : ''}
          </div>
          <div style="display:flex; flex-direction:column; gap:5px;">
            ${rows}
          </div>
        </div>
      `;
    }).join('');
    return;
  }

  if (players.length > 0) {
    const filteredPlayers = players.filter(m =>
      !q ||
      m.full_name.toLowerCase().includes(q) ||
      m.team_name.toLowerCase().includes(q) ||
      m.faction.toLowerCase().includes(q)
    ).slice(0, 60);

    if (filteredPlayers.length === 0) {
      listContainer.innerHTML = `<div style="padding:1rem; text-align:center; color:#94a3b8; font-size:0.8rem;">No players in ${escapeHtml(eventName)} match "${escapeHtml(searchQuery)}".</div>`;
      return;
    }

    listContainer.innerHTML = `<div style="display:flex; flex-direction:column; gap:5px;">` + filteredPlayers.map(m => {
      const candIdx = candidatePayloads.length;
      candidatePayloads.push({
        mode: 'player',
        player_id: m.player_id,
        bcp_player_id: m.bcp_player_id,
        full_name: m.full_name,
        team_name: m.team_name,
        faction: m.faction,
        detachment: m.detachment,
        is_captain: m.is_captain,
        elo: m.elo,
        event_id: eventId,
      });
      return `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; border-radius:7px; background:rgba(15,23,42,0.8); border:1px solid rgba(255,255,255,0.07);">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:800; font-size:0.82rem; color:#f8fafc;">${escapeHtml(m.full_name)} ${m.team_name ? `<span style="color:#38bdf8; font-size:0.72rem;">(${escapeHtml(m.team_name)})</span>` : ''}</div>
            <div style="font-size:0.71rem; color:#94a3b8;">${escapeHtml(m.faction)}${m.detachment ? ` • ${escapeHtml(m.detachment)}` : ''} • <span style="font-family:var(--font-mono); color:#38bdf8;">${m.elo} Elo</span></div>
          </div>
          <button type="button" class="btn-mock-candidate-select" data-candidate-idx="${candIdx}" onclick="activateSuperadminMockCandidateByIndex(${candIdx})" style="background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.45); color:#38bdf8; font-weight:800; font-size:0.73rem; padding:4px 10px; border-radius:6px; cursor:pointer; white-space:nowrap;">
            🎭 Mock as Player
          </button>
        </div>
      `;
    }).join('') + `</div>`;
    return;
  }

  listContainer.innerHTML = `
    <div style="padding:0.9rem; text-align:center; color:#94a3b8; font-size:0.78rem; background:rgba(15,23,42,0.6); border:1px dashed rgba(255,255,255,0.12); border-radius:8px;">
      Open any Tournament Event Hub to pick from its live team/player rosters with 1 click, or enter any player name below.
    </div>
  `;
}
window.renderSuperadminMockPlayerList = renderSuperadminMockPlayerList;

function openSuperadminMockPlayerModal() {
  if (!isVerifiedSuperadmin()) {
    console.warn('SECURITY: Blocked non-superadmin attempt to open Mock Player modal.');
    return;
  }
  let modal = document.getElementById('superadmin-mock-player-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'superadmin-mock-player-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(3,7,18,0.82); backdrop-filter:blur(6px); z-index:10050; display:none; align-items:center; justify-content:center; padding:1rem;';
    document.body.appendChild(modal);
  }

  const { eventName, eventId } = collectCurrentEventMockCandidates();
  const activeMock = getActiveSuperadminMockPlayer();

  modal.innerHTML = `
    <div class="modal-card" onclick="event.stopPropagation()" style="width:100%; max-width:660px; max-height:88vh; overflow-y:auto; background:#0b1120; border:1.5px solid rgba(245,158,11,0.55); border-radius:14px; padding:1.25rem; box-shadow:0 20px 50px rgba(0,0,0,0.75); color:#f8fafc;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; padding-bottom:0.8rem; border-bottom:1px solid rgba(255,255,255,0.08);">
        <div>
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
            <span style="background:rgba(245,158,11,0.2); border:1px solid rgba(245,158,11,0.5); color:#fbbf24; font-size:0.66rem; font-weight:900; padding:2px 7px; border-radius:4px; text-transform:uppercase;">🔒 Superadmin Only (swimgeek751@gmail.com)</span>
          </div>
          <h3 style="margin:0; font-size:1.1rem; font-weight:900; color:#fff;">🎭 Mock as Player / User</h3>
          <p style="margin:3px 0 0 0; font-size:0.76rem; color:#94a3b8;">
            Preview OmniTactica with the exact role, team station, and permissions that a specific player or spectator sees.
          </p>
        </div>
        <button type="button" onclick="closeSuperadminMockPlayerModal()" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; border-radius:6px; padding:4px 9px; cursor:pointer; font-weight:800;">✕</button>
      </div>

      ${activeMock ? `
        <div style="margin-top:0.8rem; padding:0.65rem 0.85rem; border-radius:8px; background:rgba(245,158,11,0.14); border:1px solid rgba(245,158,11,0.45); display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
          <div style="font-size:0.78rem; color:#fef3c7;">
            Currently mocking: <strong style="color:#38bdf8;">${escapeHtml(activeMock.display_name || activeMock.full_name)}</strong>
            ${activeMock.team_name ? `<span>• Team: <strong>${escapeHtml(activeMock.team_name)}</strong></span>` : ''}
          </div>
          <button type="button" onclick="exitSuperadminMockPlayer()" style="background:rgba(239,68,68,0.22); border:1px solid rgba(239,68,68,0.55); color:#fca5a5; font-weight:800; font-size:0.73rem; padding:4px 10px; border-radius:6px; cursor:pointer;">
            ✕ Exit Mock & Restore Superadmin
          </button>
        </div>
      ` : ''}

      <!-- Quick Option 1: Unregistered Player / Spectator -->
      <div style="margin-top:0.85rem; padding:0.7rem 0.9rem; border-radius:9px; background:rgba(15,23,42,0.85); border:1px solid rgba(148,163,184,0.25); display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:800; font-size:0.83rem; color:#e2e8f0;">👤 Unregistered Player / Spectator View</div>
          <div style="font-size:0.72rem; color:#94a3b8;">See what a regular player who is NOT registered in this tournament sees (no My Station / no Team Pairing).</div>
        </div>
        <button type="button" id="btn-mock-unregistered-player" onclick="activateSuperadminMockPlayer({ mode: 'unregistered', event_id: '${escapeHtml(eventId)}' })" style="background:rgba(148,163,184,0.16); border:1px solid rgba(148,163,184,0.45); color:#f1f5f9; font-weight:800; font-size:0.75rem; padding:5px 11px; border-radius:6px; cursor:pointer; white-space:nowrap;">
          👤 Mock Unregistered User
        </button>
      </div>

      <!-- Option 2: Current Tournament Players & Teams -->
      <div style="margin-top:0.95rem;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-bottom:0.5rem;">
          <label style="font-size:0.76rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#38bdf8;">
            ${eventName ? `🛡️ Players & Teams in ${escapeHtml(eventName)}` : '🛡️ Current Event Players'}
          </label>
          <input type="search" id="superadmin-mock-player-search" placeholder="Search player, team, or faction..." oninput="renderSuperadminMockPlayerList(this.value)" style="background:#090d16; border:1px solid rgba(56,189,248,0.35); color:#fff; border-radius:6px; padding:5px 10px; font-size:0.76rem; min-width:220px;">
        </div>
        <div id="superadmin-mock-player-candidates-list" style="max-height:290px; overflow-y:auto; padding-right:2px;"></div>
      </div>

      <!-- Option 3: Custom Player Name / Team -->
      <div style="margin-top:0.95rem; padding-top:0.85rem; border-top:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:0.74rem; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; color:#cbd5e1; margin-bottom:0.45rem;">
          ✏️ Or Mock Custom Player Name / Team
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr auto; gap:8px; align-items:center;">
          <input type="text" id="superadmin-custom-mock-name" placeholder="Player Full Name" style="background:#090d16; border:1px solid rgba(255,255,255,0.16); color:#fff; border-radius:6px; padding:6px 10px; font-size:0.78rem;">
          <input type="text" id="superadmin-custom-mock-team" placeholder="Team Name (optional)" style="background:#090d16; border:1px solid rgba(255,255,255,0.16); color:#fff; border-radius:6px; padding:6px 10px; font-size:0.78rem;">
          <button type="button" id="btn-mock-custom-player-submit" onclick="handleCustomSuperadminMockSubmit('${escapeHtml(eventId)}')" style="background:linear-gradient(135deg, #f59e0b, #d97706); border:1px solid #fbbf24; color:#090d16; font-weight:900; font-size:0.76rem; padding:6px 12px; border-radius:6px; cursor:pointer; white-space:nowrap;">
            🎭 Mock Player
          </button>
        </div>
        <div id="superadmin-mock-error" style="display:none; margin-top:6px; color:#f87171; font-size:0.75rem; font-weight:700;"></div>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
  modal.classList.add('active');
  renderSuperadminMockPlayerList('');
}
window.openSuperadminMockPlayerModal = openSuperadminMockPlayerModal;

function closeSuperadminMockPlayerModal() {
  const modal = document.getElementById('superadmin-mock-player-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}
window.closeSuperadminMockPlayerModal = closeSuperadminMockPlayerModal;

function handleCustomSuperadminMockSubmit(eventId = '') {
  const nameInput = document.getElementById('superadmin-custom-mock-name');
  const teamInput = document.getElementById('superadmin-custom-mock-team');
  const errEl = document.getElementById('superadmin-mock-error');
  const fullName = String(nameInput?.value || '').trim();
  const teamName = String(teamInput?.value || '').trim();
  if (!fullName) {
    if (errEl) {
      errEl.innerText = 'Please enter a player full name to mock.';
      errEl.style.display = 'block';
    }
    return;
  }
  activateSuperadminMockPlayer({
    mode: 'player',
    full_name: fullName,
    team_name: teamName,
    event_id: eventId,
  });
}
window.handleCustomSuperadminMockSubmit = handleCustomSuperadminMockSubmit;

async function activateSuperadminMockPlayer(payload = {}) {
  const errEl = document.getElementById('superadmin-mock-error');
  if (errEl) errEl.style.display = 'none';

  if (!isVerifiedSuperadmin()) {
    try { sessionStorage.removeItem('omni_superadmin_mock_player'); } catch (e) {}
    if (errEl) {
      errEl.innerText = 'Unauthorized: Strictly restricted to swimgeek751@gmail.com.';
      errEl.style.display = 'block';
    }
    return false;
  }

  try {
    if (!window.api || typeof window.api.mockAdminPlayer !== 'function') {
      throw new Error('Mock player API is unavailable.');
    }
    const res = await window.api.mockAdminPlayer(payload);
    if (!res || res.error || res.success !== true || !res.mock_profile) {
      throw new Error((res && (res.detail || res.error)) || 'Server rejected mock-player request (403 Forbidden).');
    }
    const mockProfile = res.mock_profile;
    sessionStorage.setItem('omni_superadmin_mock_player', JSON.stringify(mockProfile));
    currentUser = mockProfile;
    if (typeof window !== 'undefined') window.currentUser = currentUser;

    if (typeof currentEventRegistration !== 'undefined') {
      currentEventRegistration = null;
    }
    if (typeof window !== 'undefined' && window._stationAdminSelectedTeamByEvent) {
      window._stationAdminSelectedTeamByEvent = {};
    }

    closeSuperadminMockPlayerModal();
    renderSuperadminMockBanner();
    renderHeaderAuth();
    syncAppAuthView();

    const ev = (typeof currentEventData !== 'undefined' && currentEventData) || (typeof window !== 'undefined' && window.currentEventData) || null;
    if (ev && typeof synthesizeClientUserEventRegistration === 'function') {
      const synthReg = synthesizeClientUserEventRegistration(ev, null);
      if (typeof currentEventRegistration !== 'undefined') {
        currentEventRegistration = (synthReg && synthReg.is_registered) ? synthReg : null;
      }
      if (typeof renderPlayerStation === 'function') {
        await renderPlayerStation(ev, synthReg);
      }
      if (typeof renderEventHubHeroSection === 'function') {
        renderEventHubHeroSection(ev, synthReg);
      }
      if (typeof renderPersonalEventScorecard === 'function') {
        renderPersonalEventScorecard(ev, synthReg);
      }
      if (typeof renderEventPairingsRows === 'function') {
        renderEventPairingsRows();
      }
      if (synthReg && synthReg.is_registered && typeof switchEventModalTab === 'function') {
        switchEventModalTab('player');
      }
    }
    return true;
  } catch (err) {
    if (errEl) {
      errEl.innerText = 'Failed to activate Mock Player view: ' + (err.message || String(err));
      errEl.style.display = 'block';
    }
    return false;
  }
}
window.activateSuperadminMockPlayer = activateSuperadminMockPlayer;

async function exitSuperadminMockPlayer() {
  try {
    if (window.api && typeof window.api.mockAdminPlayer === 'function' && isVerifiedSuperadmin()) {
      await window.api.mockAdminPlayer({ mode: 'clear' }).catch(() => {});
    }
  } catch (e) {}

  try {
    sessionStorage.removeItem('omni_superadmin_mock_player');
  } catch (e) {}

  const realUser = (typeof window !== 'undefined' && window.__realSuperadminUser) || __realSuperadminUser;
  if (realUser) {
    currentUser = realUser;
  } else {
    try {
      const cached = localStorage.getItem('native_user_profile');
      currentUser = cached ? JSON.parse(cached) : null;
    } catch (e) {
      currentUser = null;
    }
  }
  if (typeof window !== 'undefined') window.currentUser = currentUser;

  if (typeof currentEventRegistration !== 'undefined') {
    currentEventRegistration = null;
  }

  closeSuperadminMockPlayerModal();
  renderSuperadminMockBanner();
  renderHeaderAuth();
  syncAppAuthView();

  const ev = (typeof currentEventData !== 'undefined' && currentEventData) || (typeof window !== 'undefined' && window.currentEventData) || null;
  if (ev) {
    const synthReg = (typeof synthesizeClientUserEventRegistration === 'function')
      ? synthesizeClientUserEventRegistration(ev, null)
      : null;
    if (typeof currentEventRegistration !== 'undefined') {
      currentEventRegistration = (synthReg && synthReg.is_registered) ? synthReg : null;
    }
    if (typeof renderPlayerStation === 'function') {
      await renderPlayerStation(ev, synthReg);
    }
    if (typeof renderEventHubHeroSection === 'function') {
      renderEventHubHeroSection(ev, synthReg);
    }
    if (typeof renderPersonalEventScorecard === 'function') {
      renderPersonalEventScorecard(ev, synthReg);
    }
    if (typeof renderEventPairingsRows === 'function') {
      renderEventPairingsRows();
    }
  }
}
window.exitSuperadminMockPlayer = exitSuperadminMockPlayer;

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderSuperadminMockBanner);
  } else {
    renderSuperadminMockBanner();
  }
}


