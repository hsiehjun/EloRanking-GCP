/* ==========================================================================
   API.JS - Centralized REST Client for Warhammer 40k Elo Ranking
   ========================================================================== */

window.api = {
  // Safe Fetch Helper
  async _fetchJson(url, options = {}) {
    try {
      const token = this.getAuthToken();
      const headers = Object.assign({}, options.headers || {});
      if (token && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      options.headers = headers;
      options.credentials = options.credentials || 'include';

      const res = await fetch(url, options);
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (!res.ok) {
          console.error(`API Error on ${url}:`, json);
          return { error: json.detail || json.error || 'Server error' };
        }
        return json;
      } catch (parseErr) {
        console.error(`Non-JSON response from ${url}:`, text);
        return { error: `Server returned non-JSON response (${res.status})` };
      }
    } catch (netErr) {
      console.error(`Network error on ${url}:`, netErr);
      return { error: netErr.message };
    }
  },

  // Session Token Helper
  getAuthToken() {
    const match = document.cookie.match(new RegExp('(^| )session_token=([^;]+)'));
    const cookieToken = match ? match[2] : '';
    return localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || localStorage.getItem('bcp_session_token') || cookieToken || '';
  },

  clearAuth() {
    localStorage.removeItem('native_session_token');
    localStorage.removeItem('native_user_profile');
    localStorage.removeItem('elo_auth_token');
    localStorage.removeItem('bcp_session_token');
    localStorage.removeItem('bcp_user_profile');
    try { sessionStorage.removeItem('elo_auth_token'); } catch (e) {}
    try { sessionStorage.removeItem('native_session_token'); } catch (e) {}
    document.cookie = 'session_token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    document.cookie = 'session_token=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'session_token=; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  },

  // Native Auth: Register
  async register(email, password, displayName = '') {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, display_name: displayName })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.detail || data.error || 'Registration failed' };
      }
      return data;
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // Native Auth: Verify Registration 2FA Code
  async verifyRegistrationCode(email, code) {
    try {
      const res = await fetch('/api/auth/verify-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.detail || data.error || 'Verification failed' };
      }
      return data;
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // Native Auth: Resend Registration Code
  async resendRegistrationCode(email) {
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.detail || data.error || 'Failed to resend verification code' };
      }
      return data;
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // Native Auth: Login
  async login(email, password) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.detail || data.error || 'Login failed' };
      }
      return data;
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // Request Password Reset via Email
  async forgotPassword(email) {
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.detail || data.error || 'Failed to request password reset' };
      }
      return data;
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // Validate Password Reset Token or Code
  async validateResetToken(token = '', code = '', email = '') {
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    if (code) params.set('code', code);
    if (email) params.set('email', email);
    return this._fetchJson(`/api/auth/reset-password/validate?${params.toString()}`);
  },

  // Reset Password
  async resetPassword(newPassword, token = '', code = '', email = '') {
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: newPassword, token, code, email })
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.detail || data.error || 'Password reset failed' };
      }
      return data;
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // Session Verification
  async getAuthMe() {
    const token = this.getAuthToken();
    if (!token) return { authenticated: false };
    return this._fetchJson(`/api/auth/me?token=${encodeURIComponent(token)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  // Logout
  async logout() {
    const token = this.getAuthToken();
    this.clearAuth();
    if (token) {
      try {
        await fetch(`/api/auth/logout?token=${encodeURIComponent(token)}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch (e) {}
    }
    return { success: true };
  },

  // Sign out of all devices (or all other devices)
  async logoutAll(keepCurrent = false) {
    const token = this.getAuthToken();
    if (!token) return { success: false, error: 'Authentication required' };
    const res = await this._fetchJson(`/api/auth/logout-all?keep_current=${keepCurrent}&token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!keepCurrent) {
      localStorage.removeItem('native_session_token');
      localStorage.removeItem('native_user_profile');
      localStorage.removeItem('bcp_session_token');
      localStorage.removeItem('bcp_user_profile');
    }
    return res;
  },

  // Get active sessions
  async getActiveSessions() {
    const token = this.getAuthToken();
    if (!token) return { success: false, sessions: [] };
    return this._fetchJson(`/api/auth/sessions?token=${encodeURIComponent(token)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  // Revoke specific session
  async revokeSession(targetToken) {
    const token = this.getAuthToken();
    if (!token) return { success: false, error: 'Authentication required' };
    return this._fetchJson(`/api/auth/sessions/${encodeURIComponent(targetToken)}?token=${encodeURIComponent(token)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  // Update User Settings
  async updateUserSettings(displayName = null, oldPassword = null, newPassword = null) {
    const token = this.getAuthToken();
    if (!token) return { success: false, error: 'Authentication required' };
    const payload = {};
    if (displayName !== null) payload.display_name = displayName;
    if (oldPassword) payload.old_password = oldPassword;
    if (newPassword) payload.new_password = newPassword;
    return this._fetchJson(`/api/user/settings?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
  },

  // Connect BCP Account
  async connectBcpAccount(bcpEmail, bcpPassword) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/user/bcp/connect?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bcp_email: bcpEmail, bcp_password: bcpPassword })
    });
  },

  // Connect BCP Token Directly
  async connectBcpToken(bcpToken, bcpRefreshToken = '') {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/user/bcp/connect?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bcp_token: bcpToken, refresh_token: bcpRefreshToken })
    });
  },

  // Disconnect BCP Account
  async disconnectBcpAccount() {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/user/bcp/disconnect?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  // Get or Generate User's 24-hour Invite Code
  async getMyInviteCode() {
    const token = this.getAuthToken();
    if (!token) return { success: false, error: 'Authentication required' };
    return this._fetchJson(`/api/auth/invite/my-code?token=${encodeURIComponent(token)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  async generateInviteCode() {
    const token = this.getAuthToken();
    if (!token) return { success: false, error: 'Authentication required' };
    return this._fetchJson(`/api/auth/invite/generate?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  // Admin Governance Methods
  async getAdminMetrics() {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/admin/metrics?token=${encodeURIComponent(token)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  async getAdminSettings() {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/admin/settings?token=${encodeURIComponent(token)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  async toggleAdminInvites(enabled) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/admin/settings/toggle-invites?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ enabled })
    });
  },

  async getAdminInvites() {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/admin/invites?token=${encodeURIComponent(token)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  async createAdminInvite(code, maxUses = null, expiresInDays = null) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/admin/invites/create?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ code, max_uses: maxUses ? parseInt(maxUses, 10) : null, expires_in_days: expiresInDays ? parseInt(expiresInDays, 10) : null })
    });
  },

  async deleteAdminInvite(code) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/admin/invites/${encodeURIComponent(code)}?token=${encodeURIComponent(token)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  async toggleAdminInvite(code, isActive) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/admin/invites/${encodeURIComponent(code)}/toggle?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ is_active: isActive })
    });
  },

  async getAdminReferrals() {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/admin/referrals?token=${encodeURIComponent(token)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  async getAdminUsers() {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/admin/users?token=${encodeURIComponent(token)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  // Personalized Competitor Hub
  async getUserDashboard(playerId = null) {
    const token = this.getAuthToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const validPid = (playerId && playerId !== 'undefined' && playerId !== 'null') ? playerId : null;
    const params = new URLSearchParams();
    if (validPid) params.append('player_id', validPid);
    if (token) params.append('token', token);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this._fetchJson(`/api/user/dashboard${qs}`, { headers });
  },

  // Global Summary Stats
  async getStats() {
    return this._fetchJson('/api/stats');
  },

  // Leaderboard (Players)
  async getLeaderboard(faction = 'All', page = 1, pageSize = 25, sortBy = 'current_elo', order = 'DESC') {
    const params = new URLSearchParams({ faction, page, page_size: pageSize, sort_by: sortBy, order });
    return this._fetchJson(`/api/leaderboard?${params}`);
  },

  // Leaderboard (Teams)
  async getLeaderboardTeams(minRoster = 1, page = 1, pageSize = 25, sortBy = 'power_rating', order = 'DESC') {
    const params = new URLSearchParams({ min_roster: minRoster, page, page_size: pageSize, sort_by: sortBy, order });
    return this._fetchJson(`/api/teams?${params}`);
  },

  // Teams Directory
  async getTeamsDirectory(query = '', minRoster = 1, sortBy = 'power_rating', order = 'DESC', page = 1, pageSize = 25) {
    const params = new URLSearchParams({ query, min_roster: minRoster, sort_by: sortBy, order, page, page_size: pageSize });
    return this._fetchJson(`/api/teams?${params}`);
  },

  // Players Directory
  async getPlayersDirectory(query = '', faction = 'All', sortBy = 'current_elo', order = 'DESC', page = 1, pageSize = 25) {
    const params = new URLSearchParams({ query, faction, sort_by: sortBy, order, page, page_size: pageSize });
    return this._fetchJson(`/api/players?${params}`);
  },

  // Tournaments Directory
  async getTournaments(query = '', status = 'all', sortBy = 'event_date', order = 'DESC', page = 1, pageSize = 25) {
    const params = new URLSearchParams({ query, status, sort_by: sortBy, order, page, page_size: pageSize });
    return this._fetchJson(`/api/events?${params}`);
  },

  // Recommended Events for User & Geo-Search
  async getRecommendedEvents(playerId = '', query = '', tier = '', lat = null, lng = null, radius = null, limit = 35, state = '', sortBy = 'date', monthsAhead = 2) {
    const params = new URLSearchParams();
    if (playerId) params.append('player_id', playerId);
    if (query) params.append('query', query);
    if (tier) params.append('tier', tier);
    if (state) params.append('state', state);
    if (lat !== null && lat !== undefined && lat !== '') params.append('lat', lat);
    if (lng !== null && lng !== undefined && lng !== '') params.append('lng', lng);
    if (radius !== null && radius !== undefined && radius !== '') params.append('radius_miles', radius);
    if (sortBy) params.append('sort_by', sortBy);
    if (limit) params.append('limit', limit);
    if (monthsAhead) params.append('months_ahead', monthsAhead);
    return this._fetchJson(`/api/events/recommended?${params}`);
  },

  // Single Player Profile & Win Path
  async getPlayerProfile(playerId) {
    return this._fetchJson(`/api/player/${encodeURIComponent(playerId)}`);
  },

  // Single Team Roster
  async getTeamRoster(teamName) {
    return this._fetchJson(`/api/team/${encodeURIComponent(teamName)}`);
  },

  // Single Tournament Details & Pairings
  async getTournamentDetails(eventId, forceSync = false) {
    const query = forceSync ? '?force_sync=true' : '';
    return this._fetchJson(`/api/event/${encodeURIComponent(eventId)}${query}`);
  },

  // Faction Meta & Dynamic Timeline Trends
  async getFactionMeta(startDate = null, endDate = null) {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    const url = params.toString() ? `/api/factions/meta?${params}` : '/api/factions/meta';
    return this._fetchJson(url);
  },

  // Single Faction Details & Pilots
  async getFactionDetails(factionName) {
    return this._fetchJson(`/api/faction/${encodeURIComponent(factionName)}`);
  },

  // Match Predictor
  async predictMatch(p1Id, p2Id) {
    const params = new URLSearchParams({ p1: p1Id, p2: p2Id });
    return this._fetchJson(`/api/predict?${params}`);
  },

  // Autocomplete Search Players
  async searchPlayers(query, limit = 10) {
    const params = new URLSearchParams({ q: query, limit });
    return this._fetchJson(`/api/players/search?${params}`);
  },

  // Digital Match Scorecard
  async getScorecard(matchId) {
    return this._fetchJson(`/api/scorecard/${encodeURIComponent(matchId)}`);
  },


  // Create Tournament Tracker Room
  async createTournamentTrackerRoom(payload) {
    return this._fetchJson('/api/tracker/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },

  // Create / Join Casual or Chat Match Room
  async createTrackerRoom(payload) {
    return this._fetchJson('/api/tracker/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  },

  // Submit Match Score to EventStudio / BCP
  async submitScoreToBcp(payload) {
    return this._fetchJson('/api/eventstudio/submit_score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: List Managed Events
  async getStudioEvents(options = {}) {
    const bcpToken = options.bcp_token || (typeof getBcpToken === 'function' ? getBcpToken() : '');
    const query = bcpToken ? `?bcp_token=${encodeURIComponent(bcpToken)}` : '';
    return this._fetchJson(`/api/eventstudio/events${query}`);
  },

  // EventStudio: Get Event Details
  async getStudioEvent(eventId) {
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}`);
  },

  // EventStudio: Create Tournament
  async createStudioEvent(payload) {
    const token = this.getAuthToken();
    return this._fetchJson('/api/eventstudio/event/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    });
  },



  // EventStudio: Update Tournament
  async updateStudioEvent(eventId, payload) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Delete Tournament
  async deleteStudioEvent(eventId) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
  },

  // EventStudio: Get Available Circuits
  async getStudioCircuits() {
    return this._fetchJson('/api/eventstudio/circuits');
  },

  // EventStudio: Get Event Linked Circuits
  async getStudioEventCircuits(eventId) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/circuits`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  // EventStudio: Submit/Link Event to Circuit
  async submitStudioEventCircuit(eventId, payload) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/circuits/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Save Round Pairings
  async saveStudioPairings(eventId, payload) {
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/pairings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Publish Pairings
  async publishStudioPairings(eventId, payload = {}) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/pairings/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Unpublish Pairings
  async unpublishStudioPairings(eventId, payload = {}) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/pairings/unpublish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Finalize Round & Advance
  async finalizeStudioRound(eventId, payload = {}) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/round/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Reset Round
  async resetStudioRound(eventId, payload = {}) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/round/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: End & Archive Tournament
  async endStudioTournament(eventId) {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/end`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  // EventStudio: Save Roster
  async saveStudioRoster(eventId, payload) {
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },

  // Tournament Registration (Player self-register or TO add competitor)
  async registerForTournament(eventId, payload = {}) {
    const token = this.getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Start Event on OmniTactica and BCP
  async startStudioEvent(eventId) {
    const token = this.getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/start`, {
      method: 'POST',
      headers
    });
  },

  // EventStudio: Swap Table Pairings dynamically before applying
  async swapStudioPairings(eventId, payload) {
    const token = this.getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/pairings/swap`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Apply Staged Pairings to BCP
  async applyStudioPairingsToBcp(eventId, payload = {}) {
    const token = this.getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/pairings/apply_bcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Generate Swiss Pairings
  async generateStudioPairings(eventId, payload = {}) {
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/pairings/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Get Standings
  async getStudioStandings(eventId) {
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/standings`);
  },

  // EventStudio: Submit Score
  async submitStudioScore(payload) {
    return this._fetchJson('/api/eventstudio/submit_score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Create Judge Call (from Game Room)
  async createJudgeCall(payload) {
    return this._fetchJson('/api/eventstudio/judge_call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Get Judge Calls for Tournament
  async getJudgeCalls(eventId, activeOnly = false) {
    return this._fetchJson(`/api/eventstudio/judge_calls?event_id=${encodeURIComponent(eventId)}&active_only=${activeOnly}`);
  },

  // EventStudio: Resolve Judge Call
  async resolveJudgeCall(callId, status = 'resolved') {
    return this._fetchJson('/api/eventstudio/judge_call/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_id: callId, status })
    });
  },

  // EventStudio: Match Predictor
  async getMatchPredictor(p1_id = '', p2_id = '', p1_name = '', p2_name = '', p1_faction = '', p2_faction = '') {
    const params = new URLSearchParams({
      p1_id, p2_id, p1_name, p2_name, p1_faction, p2_faction
    });
    return this._fetchJson(`/api/eventstudio/match_predictor?${params}`);
  },

  // EventStudio: Generate Day 2 Pod Brackets
  async generateDay2Pods(eventId, payload = {}) {
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/pods/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Save WTC Draft
  async saveWtcDraft(payload) {
    return this._fetchJson('/api/eventstudio/wtc_draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Get WTC Draft
  async getWtcDraft(eventId, roundNum) {
    return this._fetchJson(`/api/eventstudio/wtc_draft?event_id=${encodeURIComponent(eventId)}&round_num=${roundNum}`);
  },

  // Army Lists: Get User Lists
  async getArmyLists() {
    return this._fetchJson('/api/armylists', {
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
    });
  },

  // Army Lists: Get Single List
  async getArmyList(listId) {
    return this._fetchJson(`/api/armylists/${encodeURIComponent(listId)}`, {
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
    });
  },

  // Army Lists: Save or Create
  async saveArmyList(listData) {
    return this._fetchJson('/api/armylists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getAuthToken()}` },
      body: JSON.stringify(listData)
    });
  },

  // Army Lists: Delete List
  async deleteArmyList(listId) {
    return this._fetchJson(`/api/armylists/${encodeURIComponent(listId)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
    });
  },

  // Army Lists: Parse Multi-format Text
  async parseArmyList(rawText, formatHint = null) {
    return this._fetchJson('/api/armylists/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: rawText, format: formatHint })
    });
  },

  // Army Lists: Upload and parse .json, .ros, .rosz, .txt
  async uploadArmyListFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    return this._fetchJson('/api/armylists/upload', {
      method: 'POST',
      headers: { 'X-Filename': encodeURIComponent(file.name || '') },
      body: formData
    });
  },

  // Community Hub: Get Profile
  async getConnectProfile() {
    return this._fetchJson('/api/connect/profile', {
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
    });
  },

  // Community Hub: Save Profile
  async saveConnectProfile(profileData) {
    return this._fetchJson('/api/connect/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getAuthToken()}` },
      body: JSON.stringify(profileData)
    });
  },

  // Community Hub: Search Nearby Players
  async searchConnectPlayers(lat = null, lng = null, radius = 50, playStyle = '') {
    const params = new URLSearchParams();
    if (lat !== null && lat !== undefined) params.append('lat', lat);
    if (lng !== null && lng !== undefined) params.append('lng', lng);
    if (radius) params.append('radius_miles', radius);
    if (playStyle && playStyle !== 'all') params.append('play_style', playStyle);
    return this._fetchJson(`/api/connect/players?${params}`, {
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
    });
  },

  // Community Hub: Get Requests & Chats
  async getConnectRequests() {
    return this._fetchJson(`/api/connect/requests?_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` },
      cache: 'no-store'
    });
  },

  // Community Hub: Create Match Request
  async createConnectRequest(receiverId, venue = '', points = 2000, date = '', note = '') {
    return this._fetchJson('/api/connect/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getAuthToken()}` },
      body: JSON.stringify({
        receiver_id: receiverId,
        proposed_venue: venue,
        proposed_points: points,
        proposed_date: date,
        note: note
      })
    });
  },

  // Community Hub: Respond to Request
  async respondConnectRequest(requestId, action, message = '') {
    return this._fetchJson(`/api/connect/request/${encodeURIComponent(requestId)}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getAuthToken()}` },
      body: JSON.stringify({ action: action, message: message })
    });
  },

  // Community Hub: Get Thread Messages
  async getConnectMessages(requestId) {
    return this._fetchJson(`/api/connect/request/${encodeURIComponent(requestId)}/messages?_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` },
      cache: 'no-store'
    });
  },

  // Community Hub: Send Message
  async sendConnectMessage(requestId, text, roomKey = null, messageId = null) {
    return this._fetchJson(`/api/connect/request/${encodeURIComponent(requestId)}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getAuthToken()}` },
      body: JSON.stringify({ message: text, room_key: roomKey, message_id: messageId })
    });
  },

  // Community Hub: Get Unread Count
  async getConnectUnreadCount() {
    return this._fetchJson(`/api/connect/unread-count?_t=${Date.now()}`, {
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` },
      cache: 'no-store'
    });
  },

  // Admin: Update User Role
  async setAdminUserRole(userId, role) {
    return this._fetchJson(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getAuthToken()}` },
      body: JSON.stringify({ role: role })
    });
  },

  // User: Request TO Verification
  async requestToStatus(organization = '', venueOrStore = '', details = '') {
    return this._fetchJson('/api/auth/request-to', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getAuthToken()}` },
      body: JSON.stringify({
        organization: organization,
        venue_or_store: venueOrStore,
        details: details
      })
    });
  },

  // Community Hub: Available Regions
  async getCommunityRegions() {
    return this._fetchJson('/api/community/regions');
  },

  // Community Hub: Reverse Geocode GPS Coordinates to City / Region
  async reverseGeocode(lat, lng) {
    if (lat == null || lng == null) return null;
    return this._fetchJson(`/api/community/reverse_geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
  },

  async getCommunityOverview(lat = null, lng = null, radiusMiles = 100, locationName = '', region = null, includeBcp = false) {
    if (typeof lat === 'string' && lng == null) {
      region = lat;
      lat = null;
    }
    const params = new URLSearchParams();
    if (radiusMiles != null) params.set('radius_miles', radiusMiles);
    if (lat != null && lng != null) {
      params.set('lat', lat);
      params.set('lng', lng);
    }
    if (locationName) params.set('location_name', locationName);
    if (region) params.set('region', region);
    if (includeBcp) params.set('include_bcp', 'true');

    return this._fetchJson(`/api/community/overview?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
    });
  },

  // Community Hub: Live BCP upcoming tournaments (asynchronous)
  async getCommunityBcpUpcoming(lat, lng, radiusMiles = 50, daysAhead = 92) {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius_miles: String(radiusMiles),
      days_ahead: String(daysAhead)
    });
    return this._fetchJson(`/api/community/bcp_upcoming?${params.toString()}`);
  },

  // Community Hub: Local Game Stores for Warhammer 40k
  async getCommunityStores(lat = null, lng = null, radiusMiles = 50, query = '', locationName = '') {
    const params = new URLSearchParams();
    if (radiusMiles != null) params.set('radius_miles', radiusMiles);
    if (lat != null && lng != null) {
      params.set('lat', lat);
      params.set('lng', lng);
    }
    if (query) params.set('query', query);
    if (locationName) params.set('location_name', locationName);

    return this._fetchJson(`/api/community/stores?${params.toString()}`);
  },

  // Community Hub: Store Hosted Tournaments
  async getStoreTournaments(name, lat = null, lng = null, placeId = null) {
    const params = new URLSearchParams();
    if (name) params.set('name', name);
    if (lat != null && lng != null) {
      params.set('lat', lat);
      params.set('lng', lng);
    }
    if (placeId) params.set('place_id', placeId);

    return this._fetchJson(`/api/community/store/tournaments?${params.toString()}`);
  },

  // Community Hub: Store Place Details (official website, phone, Google Maps URL)
  async getStoreDetails(placeId) {
    if (!placeId) return { success: false, error: 'Missing placeId' };
    const params = new URLSearchParams({ place_id: placeId });
    return this._fetchJson(`/api/community/store/details?${params.toString()}`);
  },

  // Community Hub: Asynchronous Field Stats & Live Roster Hydration
  async getEventsFieldStats(eventIds) {
    if (!eventIds || eventIds.length === 0) return { success: true, stats: {} };
    const idsParam = Array.isArray(eventIds) ? eventIds.join(',') : eventIds;
    return this._fetchJson(`/api/community/events/field_stats?event_ids=${encodeURIComponent(idsParam)}`);
  },

  // Community Hub: Chat Messages
  async getCommunityChatMessages(region = 'socal', limit = 50) {
    return this._fetchJson(`/api/community/chat/messages?region=${encodeURIComponent(region || 'socal')}&limit=${limit}`);
  },

  // Community Hub: Send Chat Message
  async sendCommunityChatMessage(region, message) {
    return this._fetchJson('/api/community/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getAuthToken()}` },
      body: JSON.stringify({ region: region, message: message })
    });
  }
};

window.API = window.api;
