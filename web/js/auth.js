/* ==========================================================================
   AUTH.JS - Native User Authentication & BCP Account Linking (v5.0)
   ========================================================================== */

let currentUser = null;

function getCookieToken() {
  const match = document.cookie.match(new RegExp('(^| )session_token=([^;]+)'));
  return match ? match[2] : null;
}

// Synchronously restore user from localStorage immediately
try {
  const cached = localStorage.getItem('native_user_profile') || localStorage.getItem('bcp_user_profile');
  const token = localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || getCookieToken();
  if (cached && token) {
    currentUser = JSON.parse(cached);
  }
} catch (e) {
  currentUser = null;
}

function isUserTO(user) {
  if (!user) return false;
  const userRole = String(user.role || 'player').trim().toLowerCase();
  const userEmail = String(user.email || '').trim().toLowerCase();
  const isSuperAdmin = userEmail === 'swimgeek751@gmail.com';
  const isAdmin = isSuperAdmin || userRole === 'admin' || userRole === 'superuser' || userRole === 'developer' || userRole === 'owner';
  const isTO = userRole === 'to' || userRole === 'organizer' || userRole === 'referee';
  return isAdmin || isTO;
}
window.isUserTO = isUserTO;

/**
 * Synchronize mobile navigation dropdown options based on auth status and user role.
 * Note: Mobile Safari (iOS) and Android native select dialogs completely ignore CSS display:none
 * on <option> tags. Therefore, privileged options (such as Event Studio for TO/Admin) and
 * auth-specific options must be physically added or removed from the DOM.
 */
function syncMobileNavDropdown() {
  const select = document.getElementById('mobile-nav-select');
  if (!select) return;

  const isTO = Boolean(currentUser && typeof isUserTO === 'function' && isUserTO(currentUser));
  const divider = document.getElementById('mobile-opt-divider') || select.querySelector('option[disabled]');
  let esOpt = document.getElementById('mobile-opt-event-studio');

  // Event Studio Option: STRICTLY restricted to Tournament Organizers (TO) and Platform Admins
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
  let feedbackOpt = document.getElementById('mobile-opt-feedback');
  let settingsOpt = document.getElementById('mobile-opt-settings');
  let logoutOpt = document.getElementById('mobile-opt-logout');

  if (currentUser) {
    if (loginOpt) loginOpt.remove();

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
  const landingView = document.getElementById('landing-page-view');
  const appShell = document.getElementById('app-shell');
  const appHeader = document.getElementById('app-header');
  const foucGuard = document.getElementById('auth-fouc-guard');
  const esNavBtn = document.getElementById('nav-btn-event-studio');

  const canAccessTO = isUserTO(currentUser);
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
    if (foucGuard) foucGuard.innerHTML = '#landing-page-view { display: block !important; } #app-shell { display: none !important; } #app-header { display: none !important; } #floating-chat-widget { display: none !important; }';
    if (landingView) landingView.style.display = 'block';
    if (appShell) appShell.style.display = 'none';
    if (appHeader) appHeader.style.display = 'none';
    if (chatWidget) chatWidget.style.display = 'none';
    if (typeof toggleFloatingChat === 'function') toggleFloatingChat(false);
  }
}

async function initAuth() {
  const token = localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || getCookieToken();
  if (!token) {
    currentUser = null;
    syncAppAuthView();
    return;
  }

  try {
    const res = await window.api.getAuthMe(token);
    if (res && res.authenticated && res.user) {
      currentUser = res.user;
      localStorage.setItem('native_user_profile', JSON.stringify(currentUser));
      localStorage.setItem('native_session_token', token);
      localStorage.setItem('elo_auth_token', token);
      if (typeof updateStudioAuthBadge === 'function') updateStudioAuthBadge();
    } else {
      currentUser = null;
      localStorage.removeItem('native_session_token');
      localStorage.removeItem('elo_auth_token');
      localStorage.removeItem('native_user_profile');
      if (typeof updateStudioAuthBadge === 'function') updateStudioAuthBadge();
    }
  } catch (e) {
    console.warn('Session verification error:', e);
  }
  syncAppAuthView();
}

let pendingVerifyEmail = "";

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
    if (res && res.success) {
      if (passInput) passInput.value = '';
      if (emailInput) emailInput.value = '';
      const loginForm = document.getElementById('auth-form-login');
      if (loginForm) loginForm.reset();
      localStorage.setItem('native_session_token', res.session_token);
      localStorage.setItem('native_user_profile', JSON.stringify(res.user));
      currentUser = res.user;
      syncAppAuthView();
      switchTab('my-hub');
    } else {
      if (errorDiv) {
        errorDiv.innerText = res.error || 'Invalid email or password.';
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
      const targetSpan = document.getElementById('verify-email-target');
      if (targetSpan) targetSpan.textContent = email;
      setAuthCardTab('verify');
    } else if (res && res.success && res.session_token) {
      localStorage.setItem('native_session_token', res.session_token);
      localStorage.setItem('native_user_profile', JSON.stringify(res.user));
      currentUser = res.user;
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

  const code = codeInput ? codeInput.value.trim() : '';
  const email = pendingVerifyEmail || (document.getElementById('reg-email') ? document.getElementById('reg-email').value.trim() : '');

  if (!code || code.length < 6) {
    if (errorDiv) {
      errorDiv.innerText = 'Please enter the full 6-digit verification code.';
      errorDiv.style.display = 'block';
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = 'Activating Account...';
  }
  if (errorDiv) errorDiv.style.display = 'none';

  try {
    const res = await window.api.verifyRegistrationCode(email, code);
    if (res && res.success) {
      localStorage.setItem('native_session_token', res.session_token);
      localStorage.setItem('native_user_profile', JSON.stringify(res.user));
      currentUser = res.user;
      syncAppAuthView();
      alert('🎉 Welcome to OmniTactica! Your account has been verified successfully.');
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
      submitBtn.innerText = '✓ Activate Account & Enter';
    }
  }
}

async function handleResendVerificationCode() {
  const email = pendingVerifyEmail || (document.getElementById('reg-email') ? document.getElementById('reg-email').value.trim() : '');
  const btn = document.getElementById('btn-resend-code');
  const errorDiv = document.getElementById('verify-error');
  if (!email) return;

  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Resending...';
  }

  try {
    const res = await window.api.resendRegistrationCode(email);
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
  if (modal) modal.classList.add('active');
}

function closeBcpLinkModal() {
  const modal = document.getElementById('bcp-link-modal');
  if (modal) modal.classList.remove('active');
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
    submitBtn.innerHTML = '<span style="display:inline-block; width:12px; height:12px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; vertical-align:middle; margin-right:6px;"></span> Logging in to BCP...';
  }
  if (errorDiv) errorDiv.style.display = 'none';

  try {
    const res = await window.api.connectBcpAccount(bcpEmail, bcpPassword);
    if (res && res.success) {
      if (res.user) {
        currentUser = res.user;
        localStorage.setItem('native_user_profile', JSON.stringify(currentUser));
      }
      closeBcpLinkModal();
      await initAuth();
      if (typeof updateStudioAuthBadge === 'function') updateStudioAuthBadge();
      if (typeof loadStudioEvents === 'function') await loadStudioEvents();
      if (typeof loadMyHubDashboard === 'function') loadMyHubDashboard();
      alert("🎉 Best Coast Pairings account connected successfully!");
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
      submitBtn.innerText = 'Connect with BCP Credentials';
    }
  }
}

async function handleDisconnectBcp() {
  if (!confirm('Are you sure you want to disconnect your Best Coast Pairings account?')) return;
  await window.api.disconnectBcpAccount();
  await initAuth();
  if (typeof loadMyHubDashboard === 'function') loadMyHubDashboard();
}

async function handleLogout() {
  try {
    await window.api.logout();
  } catch (e) {}
  currentUser = null;
  if (typeof detachUserSyncSnapshot === 'function') detachUserSyncSnapshot();
  if (typeof detachChatSnapshot === 'function') detachChatSnapshot();
  if (typeof stopChatPolling === 'function') stopChatPolling();
  localStorage.removeItem('native_session_token');
  localStorage.removeItem('native_user_profile');
  localStorage.removeItem('elo_auth_token');
  localStorage.removeItem('bcp_session_token');
  document.cookie = 'session_token=; path=/; max-age=0';
  
  // Wipe all form inputs and reset auth forms to ensure zero cached credentials
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

  renderHeaderAuth();
  syncAppAuthView();
}

function renderHeaderAuth() {
  const container = document.getElementById('header-user-area');
  const feedbackBtn = document.getElementById('nav-btn-feedback');
  const esNavBtn = document.getElementById('nav-btn-event-studio');

  if (feedbackBtn) {
    feedbackBtn.style.display = currentUser ? 'inline-flex' : 'none';
  }

  if (esNavBtn) {
    esNavBtn.style.display = (currentUser && isUserTO(currentUser)) ? 'flex' : 'none';
  }
  syncMobileNavDropdown();

  if (!container) return;

  if (currentUser) {
    const name = currentUser.display_name || currentUser.email || 'Player';
    const isAdmin = currentUser.role === 'admin' && (currentUser.email || '').toLowerCase() === 'swimgeek751@gmail.com';
    const adminLink = isAdmin ? `
      <a href="/admin" style="display:inline-flex; align-items:center; gap:4px; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4); color:#f87171; font-weight:800; font-size:0.75rem; padding:3px 8px; border-radius:6px; text-decoration:none;" title="Admin Governance Dashboard">
        <span>🛡️</span> Admin
      </a>
    ` : '';
    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; background:rgba(15,23,42,0.85); border:1px solid var(--border); padding:5px 12px; border-radius:9999px; font-family:'Inter',sans-serif;">
        <span style="width:8px; height:8px; border-radius:50%; background:#10b981; box-shadow:0 0 8px rgba(16,185,129,0.5);"></span>
        <button onclick="openUserSettingsModal()" style="background:transparent; border:none; color:#f8fafc; font-weight:700; font-size:0.82rem; cursor:pointer; display:flex; align-items:center; gap:5px; padding:0;" title="Account Settings (Click to change password or gamer tag)">
          <span>${escapeHtml(name)}</span>
          <span style="color:#94a3b8; font-size:11px;">⚙️</span>
        </button>
        ${adminLink}
        <span style="color:var(--border-color, #334155); font-size:12px;">|</span>
        <button onclick="handleLogout()" style="background:transparent; border:none; color:#ef4444; font-size:0.78rem; font-weight:700; cursor:pointer; padding:0;">Logout</button>
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

function openUserSettingsModal() {
  const modal = document.getElementById('user-settings-modal');
  if (!modal) return;

  // Populate fields
  const nameInput = document.getElementById('settings-display-name');
  const emailVal = document.getElementById('settings-email-display');
  const roleVal = document.getElementById('settings-role-display');
  const bcpVal = document.getElementById('settings-bcp-status');
  const errDiv = document.getElementById('settings-error');
  const successDiv = document.getElementById('settings-success');

  if (errDiv) errDiv.style.display = 'none';
  if (successDiv) successDiv.style.display = 'none';

  if (currentUser) {
    if (nameInput) nameInput.value = currentUser.display_name || '';
    if (emailVal) emailVal.innerText = currentUser.email || '-';
    if (roleVal) {
      const isTO = isUserTO(currentUser);
      const roleStr = ((currentUser && currentUser.role) ? currentUser.role : 'player').toUpperCase();
      if (isTO) {
        roleVal.innerHTML = `<span style="color:#10b981; font-weight:700;">🎖️ ${escapeHtml(roleStr)}</span>`;
      } else {
        roleVal.innerHTML = `<span style="color:#94a3b8;">${escapeHtml(roleStr)}</span> <button onclick="closeUserSettingsModal(); if(typeof openRequestToModal === 'function') openRequestToModal();" style="background:transparent; border:none; color:#f59e0b; font-size:11px; cursor:pointer; text-decoration:underline; margin-left:6px; font-weight:600;">Request TO Access</button>`;
      }
    }
    if (bcpVal) {
      if (currentUser.bcp_connected || currentUser.bcp_user_id) {
        bcpVal.innerHTML = `<span style="color:#10b981; font-weight:700;">🟢 Connected</span> (${escapeHtml(currentUser.bcp_email || 'Linked')})`;
      } else {
        bcpVal.innerHTML = `<span style="color:#94a3b8;">⚪ Not Linked</span> <button onclick="closeUserSettingsModal(); openBcpLinkModal();" style="background:transparent; border:none; color:#38bdf8; font-size:11px; cursor:pointer; text-decoration:underline; margin-left:4px;">Link now</button>`;
      }
    }
  }

  loadActiveSessionsList();
  loadUserSettingsLocation();
  modal.classList.add('active');
}

function closeUserSettingsModal() {
  const modal = document.getElementById('user-settings-modal');
  if (modal) modal.classList.remove('active');
}

async function handleSaveDisplayName(e) {
  if (e) e.preventDefault();
  const nameInput = document.getElementById('settings-display-name');
  const errDiv = document.getElementById('settings-error');
  const successDiv = document.getElementById('settings-success');
  const btn = document.getElementById('btn-save-name');

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
    const factionSelect = document.getElementById('settings-primary-faction');
    if (prof.play_style && playStyleSelect) playStyleSelect.value = prof.play_style;
    if ((prof.factions || prof.top_faction) && factionSelect) factionSelect.value = prof.factions || prof.top_faction;

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
  await refreshUserInviteCode(false);
}

function closeInviteModal() {
  if (inviteCountdownTimer) {
    clearInterval(inviteCountdownTimer);
    inviteCountdownTimer = null;
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


