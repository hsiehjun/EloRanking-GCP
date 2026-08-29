/* ==========================================================================
   AUTH.JS - Native User Authentication & BCP Account Linking (v5.0)
   ========================================================================== */

let currentUser = null;

// Synchronously restore user from localStorage immediately
try {
  const cached = localStorage.getItem('native_user_profile') || localStorage.getItem('bcp_user_profile');
  const token = localStorage.getItem('native_session_token') || localStorage.getItem('bcp_session_token');
  if (cached && token) {
    currentUser = JSON.parse(cached);
  }
} catch (e) {
  currentUser = null;
}

async function initAuth() {
  const token = localStorage.getItem('native_session_token') || localStorage.getItem('bcp_session_token');
  if (!token) {
    currentUser = null;
    return;
  }

  try {
    const res = await window.api.getAuthMe();
    if (res && res.authenticated && res.user) {
      currentUser = res.user;
      localStorage.setItem('native_user_profile', JSON.stringify(currentUser));
      localStorage.setItem('native_session_token', token);
    } else {
      currentUser = null;
      localStorage.removeItem('native_session_token');
      localStorage.removeItem('native_user_profile');
    }
  } catch (e) {
    console.warn('Session verification error:', e);
  }
}

function setAuthCardTab(tab) {
  const btnLogin = document.getElementById('auth-tab-btn-login');
  const btnReg = document.getElementById('auth-tab-btn-register');
  const formLogin = document.getElementById('auth-form-login');
  const formReg = document.getElementById('auth-form-register');

  if (btnLogin) btnLogin.classList.toggle('active', tab === 'login');
  if (btnReg) btnReg.classList.toggle('active', tab === 'register');
  if (formLogin) formLogin.style.display = (tab === 'login') ? 'block' : 'none';
  if (formReg) formReg.style.display = (tab === 'register') ? 'block' : 'none';
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
      submitBtn.innerText = 'Sign In to My Hub';
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

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = 'Creating Account...';
  }
  if (errorDiv) errorDiv.style.display = 'none';

  try {
    const res = await window.api.register(email, password, displayName);
    if (res && res.success) {
      localStorage.setItem('native_session_token', res.session_token);
      localStorage.setItem('native_user_profile', JSON.stringify(res.user));
      currentUser = res.user;
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
      submitBtn.innerText = 'Create Free Account';
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
    submitBtn.innerText = 'Connecting to BCP...';
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
      if (typeof loadMyHubDashboard === 'function') loadMyHubDashboard();
    } else {
      if (errorDiv) {
        errorDiv.innerText = res.error || 'Failed to connect BCP account.';
        errorDiv.style.display = 'block';
      }
    }
  } catch (err) {
    if (errorDiv) {
      errorDiv.innerText = 'Connection error: ' + err.message;
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
  await window.api.disconnectBcpAccount();
  await initAuth();
  if (typeof loadMyHubDashboard === 'function') loadMyHubDashboard();
}

async function handleLogout() {
  await window.api.logout();
  currentUser = null;
  switchTab('my-hub');
}
