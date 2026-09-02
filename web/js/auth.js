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

function syncAppAuthView() {
  const landingView = document.getElementById('landing-page-view');
  const appShell = document.getElementById('app-shell');
  const appHeader = document.querySelector('header');

  if (currentUser) {
    if (landingView) landingView.style.display = 'none';
    if (appShell) appShell.style.display = 'block';
    if (appHeader) appHeader.style.display = 'block';
    if (typeof renderHeaderAuth === 'function') renderHeaderAuth();
  } else {
    if (landingView) landingView.style.display = 'block';
    if (appShell) appShell.style.display = 'none';
    if (appHeader) appHeader.style.display = 'none';
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
  localStorage.removeItem('native_session_token');
  localStorage.removeItem('native_user_profile');
  localStorage.removeItem('elo_auth_token');
  localStorage.removeItem('bcp_session_token');
  document.cookie = 'session_token=; path=/; max-age=0';
  
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

  if (feedbackBtn) {
    feedbackBtn.style.display = currentUser ? 'inline-flex' : 'none';
  }

  if (!container) return;

  if (currentUser) {
    const name = currentUser.display_name || currentUser.email || 'Player';
    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; background:rgba(15,23,42,0.85); border:1px solid var(--border); padding:5px 12px; border-radius:9999px; font-family:'Inter',sans-serif;">
        <span style="width:8px; height:8px; border-radius:50%; background:#10b981; box-shadow:0 0 8px rgba(16,185,129,0.5);"></span>
        <button onclick="openUserSettingsModal()" style="background:transparent; border:none; color:#f8fafc; font-weight:700; font-size:0.82rem; cursor:pointer; display:flex; align-items:center; gap:5px; padding:0;" title="Account Settings (Click to change password or gamer tag)">
          <span>${escapeHtml(name)}</span>
          <span style="color:#94a3b8; font-size:11px;">⚙️</span>
        </button>
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
  const bcpVal = document.getElementById('settings-bcp-status');
  const errDiv = document.getElementById('settings-error');
  const successDiv = document.getElementById('settings-success');

  if (errDiv) errDiv.style.display = 'none';
  if (successDiv) successDiv.style.display = 'none';

  if (currentUser) {
    if (nameInput) nameInput.value = currentUser.display_name || '';
    if (emailVal) emailVal.innerText = currentUser.email || '-';
    if (bcpVal) {
      if (currentUser.bcp_connected || currentUser.bcp_user_id) {
        bcpVal.innerHTML = `<span style="color:#10b981; font-weight:700;">🟢 Connected</span> (${escapeHtml(currentUser.bcp_email || 'Linked')})`;
      } else {
        bcpVal.innerHTML = `<span style="color:#94a3b8;">⚪ Not Linked</span> <button onclick="closeUserSettingsModal(); openBcpLinkModal();" style="background:transparent; border:none; color:#38bdf8; font-size:11px; cursor:pointer; text-decoration:underline; margin-left:4px;">Link now</button>`;
      }
    }
  }

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

window.syncAppAuthView = syncAppAuthView;
window.setAuthCardTab = setAuthCardTab;
window.handleNativeLogin = handleNativeLogin;
window.handleNativeRegister = handleNativeRegister;
window.handleVerifyRegistrationCode = handleVerifyRegistrationCode;
window.handleResendVerificationCode = handleResendVerificationCode;
window.handleForgotPasswordSubmit = handleForgotPasswordSubmit;
window.handleLogout = handleLogout;
