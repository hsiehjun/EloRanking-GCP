/* ==========================================================================
   ADMIN_FEEDBACK.JS - Developer Feedback & Bug Management Portal
   ========================================================================== */

let allFeedbacks = [];
let currentCategory = 'all';
let currentStatus = 'all';
let searchQuery = '';
let currentAdminUser = null;

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerText = msg;
  t.style.borderColor = isError ? '#ef4444' : '#38bdf8';
  t.style.display = 'block';
  setTimeout(function() { t.style.display = 'none'; }, 2500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, { 
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch(e) {
    return dateStr;
  }
}

function getCookieToken() {
  const match = document.cookie.match(/(?:^|;\s*)session_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function getAuthToken() {
  return localStorage.getItem('native_session_token') || 
         localStorage.getItem('elo_auth_token') || 
         localStorage.getItem('elo_session_token') || 
         localStorage.getItem('bcp_session_token') || 
         getCookieToken() || '';
}

async function checkAdminAuth() {
  const token = getAuthToken();
  if (!token) {
    try {
      const cached = localStorage.getItem('native_user_profile');
      if (cached) return JSON.parse(cached);
    } catch(e) {}
    return null;
  }

  try {
    const resp = await fetch(`/api/auth/me?token=${encodeURIComponent(token)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (resp.ok) {
      const data = await resp.json();
      const user = (data && data.user) ? data.user : data;
      if (user && user.role) {
        localStorage.setItem('native_user_profile', JSON.stringify(user));
      }
      return user;
    }
  } catch (e) {}

  try {
    const cached = localStorage.getItem('native_user_profile');
    if (cached) return JSON.parse(cached);
  } catch(e) {}
  return null;
}

async function fetchFeedbacks() {
  const container = document.getElementById('feedback-list-container');
  const authGate = document.getElementById('auth-gate-container');
  const mainContent = document.getElementById('admin-main-content');
  const userBadge = document.getElementById('admin-user-badge');

  currentAdminUser = await checkAdminAuth();

  const userRole = currentAdminUser ? (currentAdminUser.role || 'player').toLowerCase() : '';
  const isAdmin = currentAdminUser && ['admin', 'superuser', 'developer', 'owner', 'to', 'referee'].includes(userRole);

  if (!isAdmin) {
    if (authGate) authGate.style.display = 'block';
    if (mainContent) mainContent.style.display = 'none';
    if (userBadge) {
      userBadge.innerHTML = currentAdminUser ? 
        `<span style="color:#ef4444; font-size:12px; font-weight:700;">⛔ ${escapeHtml(currentAdminUser.email)} (Role: ${escapeHtml(userRole)})</span>` : 
        `<a href="/login?redirect=${encodeURIComponent('/admin/feedback')}" class="nav-btn" style="color:#38bdf8;">🔑 Sign In as Admin</a>`;
    }
    return;
  }

  // User is authorized admin
  if (authGate) authGate.style.display = 'none';
  if (mainContent) mainContent.style.display = 'block';
  if (userBadge) {
    userBadge.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); padding:4px 10px; border-radius:9999px; font-size:12px;">
        <span style="width:7px; height:7px; border-radius:50%; background:#10b981;"></span>
        <span style="color:#34d399; font-weight:700;">Admin: ${escapeHtml(currentAdminUser.display_name || currentAdminUser.email)}</span>
      </div>
    `;
  }

  if (container && allFeedbacks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">⌛</div>
        <div>Loading user feedback from database...</div>
      </div>
    `;
  }

  try {
    const token = getAuthToken();
    const resp = await fetch(`/api/admin/feedback?limit=200&token=${encodeURIComponent(token)}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });

    if (!resp.ok) {
      if (resp.status === 403 || resp.status === 401) {
        throw new Error('Access denied. Please log in with your admin account (swimgeek751@gmail.com).');
      }
      throw new Error(`Server returned HTTP ${resp.status}`);
    }

    const data = await resp.json();
    allFeedbacks = data.feedbacks || (Array.isArray(data) ? data : []);
    updateStats();
    renderFeedbacks();
  } catch(err) {
    if (container) {
      container.innerHTML = `
        <div class="empty-state" style="color:#ef4444;">
          <div class="icon">⚠️</div>
          <div>${escapeHtml(err.message)}</div>
          <button onclick="fetchFeedbacks()" class="nav-btn" style="margin-top:12px; cursor:pointer;">Retry</button>
        </div>
      `;
    }
  }
}

function updateStats() {
  const total = allFeedbacks.length;
  const bugs = allFeedbacks.filter(function(f) { 
    return (f.feedback_type === 'bug' || !f.feedback_type) && f.status !== 'resolved' && f.status !== 'archived'; 
  }).length;
  const features = allFeedbacks.filter(function(f) { return f.feedback_type === 'feature'; }).length;
  const resolved = allFeedbacks.filter(function(f) { return f.status === 'resolved'; }).length;

  const elTotal = document.getElementById('stat-total');
  const elBugs = document.getElementById('stat-bugs');
  const elFeatures = document.getElementById('stat-features');
  const elResolved = document.getElementById('stat-resolved');

  if (elTotal) elTotal.innerText = total;
  if (elBugs) elBugs.innerText = bugs;
  if (elFeatures) elFeatures.innerText = features;
  if (elResolved) elResolved.innerText = resolved;
}

function setCategoryFilter(cat, btn) {
  currentCategory = cat;
  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll('.pill-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }
  renderFeedbacks();
}

function setStatusFilter(status, btn) {
  currentStatus = status;
  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll('.pill-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  }
  renderFeedbacks();
}

function handleSearch(query) {
  searchQuery = (query || '').trim().toLowerCase();
  renderFeedbacks();
}

function renderFeedbacks() {
  const container = document.getElementById('feedback-list-container');
  if (!container) return;

  const filtered = allFeedbacks.filter(function(f) {
    if (currentCategory !== 'all' && (f.feedback_type || 'bug') !== currentCategory) return false;
    if (currentStatus !== 'all' && (f.status || 'new') !== currentStatus) return false;
    if (searchQuery) {
      const hay = `${f.message || ''} ${f.user_email || ''} ${f.page_url || ''} ${f.admin_notes || ''}`.toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <div style="font-size:16px; font-weight:700; color:#fff;">No feedback matching criteria</div>
        <div style="margin-top:4px;">Try selecting another filter or clearing your search.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(function(fb) {
    const type = fb.feedback_type || 'bug';
    const typeClass = type === 'feature' ? 'badge-feature' : (type === 'general' ? 'badge-general' : 'badge-bug');
    const typeLabel = type === 'feature' ? '✨ Feature' : (type === 'general' ? '💬 General' : '🐞 Bug Report');
    const status = fb.status || 'new';

    const safeId = escapeHtml(fb.id);
    const userDisplay = fb.user_email ? 
      `<span style="color:#38bdf8; font-weight:600;">👤 ${escapeHtml(fb.user_email)}</span>` : 
      `<span style="color:#64748b; font-style:italic;">👤 Anonymous</span>`;

    const pageUrlDisplay = fb.page_url ? `
      <div>
        🔗 Page: <a href="${escapeHtml(fb.page_url)}" target="_blank" style="color:#38bdf8; text-decoration:underline;">${escapeHtml(fb.page_url)}</a>
      </div>
    ` : '';

    const deviceDisplay = fb.device_info ? `
      <div>💻 Context: <span style="font-family:var(--font-mono); color:#cbd5e1;">${escapeHtml(fb.device_info)}</span></div>
    ` : '';

    const resolveBtn = status !== 'resolved' ? `
      <button onclick="updateStatus('${safeId}', 'resolved')" class="action-btn action-btn-success">
        🟢 Mark Resolved
      </button>
    ` : `
      <button onclick="updateStatus('${safeId}', 'new')" class="action-btn">
        🔄 Reopen
      </button>
    `;

    return `
      <div class="fb-card" id="card-${safeId}">
        <div class="fb-header">
          <div class="fb-badges">
            <span class="badge ${typeClass}">${typeLabel}</span>
            <select class="status-select status-${status}" onchange="updateStatus('${safeId}', this.value)">
              <option value="new" ${status === 'new' ? 'selected' : ''}>🟡 New</option>
              <option value="in_progress" ${status === 'in_progress' ? 'selected' : ''}>🔵 In Progress</option>
              <option value="resolved" ${status === 'resolved' ? 'selected' : ''}>🟢 Resolved</option>
              <option value="archived" ${status === 'archived' ? 'selected' : ''}>⚪ Archived</option>
            </select>
            <span style="font-family:var(--font-mono); font-size:11px; color:#64748b;">#${safeId}</span>
          </div>

          <div class="fb-meta">
            <span>🕒 ${formatDate(fb.created_at)}</span>
            ${userDisplay}
          </div>
        </div>

        <div class="fb-message" id="msg-${safeId}">${escapeHtml(fb.message)}</div>

        <div style="font-size:11.5px; color:#94a3b8; display:flex; flex-wrap:wrap; gap:12px; margin-bottom:8px;">
          ${pageUrlDisplay}
          ${deviceDisplay}
        </div>

        <div class="fb-admin-notes-area">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label style="font-size:11.5px; font-weight:700; color:#38bdf8;">📝 Developer Notes / Fix Details:</label>
            <button onclick="saveAdminNotes('${safeId}')" class="action-btn" style="padding:2px 8px; font-size:11px;">💾 Save Notes</button>
          </div>
          <textarea id="notes-${safeId}" rows="2" placeholder="Add private notes on root cause or fix commit..." style="width:100%; background:#070b14; border:1px solid #334155; border-radius:6px; padding:6px 10px; color:#e2e8f0; font-size:12px; font-family:var(--font-sans); outline:none; resize:vertical;">${escapeHtml(fb.admin_notes || '')}</textarea>
        </div>

        <div class="fb-actions">
          ${resolveBtn}
          <button onclick="deleteFeedback('${safeId}')" class="action-btn action-btn-danger">
            🗑️ Delete
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function updateStatus(id, newStatus) {
  try {
    const token = getAuthToken();
    const resp = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ status: newStatus, token: token })
    });

    if (resp.ok) {
      const item = allFeedbacks.find(function(f) { return f.id === id; });
      if (item) item.status = newStatus;
      updateStats();
      renderFeedbacks();
      showToast(`Status updated to: ${newStatus}`, false);
    } else {
      throw new Error('Failed to update status');
    }
  } catch(err) {
    showToast(err.message, true);
  }
}

async function saveAdminNotes(id) {
  const textarea = document.getElementById(`notes-${id}`);
  if (!textarea) return;
  const notes = textarea.value.trim();

  try {
    const token = getAuthToken();
    const resp = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ admin_notes: notes, token: token })
    });

    if (resp.ok) {
      const item = allFeedbacks.find(function(f) { return f.id === id; });
      if (item) item.admin_notes = notes;
      showToast('Developer notes saved successfully!', false);
    } else {
      throw new Error('Failed to save notes');
    }
  } catch(err) {
    showToast(err.message, true);
  }
}

async function deleteFeedback(id) {
  if (!confirm('Are you sure you want to permanently erase this feedback entry?')) return;

  try {
    const token = getAuthToken();
    const resp = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });

    if (resp.ok) {
      allFeedbacks = allFeedbacks.filter(function(f) { return f.id !== id; });
      updateStats();
      renderFeedbacks();
      showToast('Feedback erased from database.', false);
    } else {
      throw new Error('Failed to delete feedback');
    }
  } catch(err) {
    showToast(err.message, true);
  }
}

document.addEventListener('DOMContentLoaded', fetchFeedbacks);
