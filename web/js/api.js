/* ==========================================================================
   API.JS - Centralized REST Client for Warhammer 40k Elo Ranking
   ========================================================================== */

window.api = {
  // Safe Fetch Helper
  async _fetchJson(url, options = {}) {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (!res.ok) {
          console.error(`API Error on ${url}:`, json);
          return { error: json.detail || json.error || 'Server error', items: [], total: 0 };
        }
        return json;
      } catch (parseErr) {
        console.error(`Non-JSON response from ${url}:`, text);
        return { error: `Server returned non-JSON response (${res.status})`, items: [], total: 0 };
      }
    } catch (netErr) {
      console.error(`Network error on ${url}:`, netErr);
      return { error: netErr.message, items: [], total: 0 };
    }
  },

  // Session Token Helper
  getAuthToken() {
    const match = document.cookie.match(new RegExp('(^| )session_token=([^;]+)'));
    const cookieToken = match ? match[2] : '';
    return localStorage.getItem('native_session_token') || localStorage.getItem('elo_auth_token') || localStorage.getItem('bcp_session_token') || cookieToken || '';
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
    localStorage.removeItem('native_session_token');
    localStorage.removeItem('native_user_profile');
    localStorage.removeItem('bcp_session_token');
    localStorage.removeItem('bcp_user_profile');
    if (token) {
      await fetch(`/api/auth/logout?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    }
    return { success: true };
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

  // Disconnect BCP Account
  async disconnectBcpAccount() {
    const token = this.getAuthToken();
    return this._fetchJson(`/api/user/bcp/disconnect?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  },

  // Personalized Competitor Hub
  async getUserDashboard(playerId = null) {
    const token = this.getAuthToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const validPid = (playerId && playerId !== 'undefined' && playerId !== 'null') ? playerId : null;
    const url = validPid ? `/api/user/dashboard?player_id=${encodeURIComponent(validPid)}` : `/api/user/dashboard?token=${encodeURIComponent(token)}`;
    return this._fetchJson(url, { headers });
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
  async getLeaderboardTeams(minRoster = 2, limit = 100) {
    const params = new URLSearchParams({ min_roster: minRoster, limit });
    return this._fetchJson(`/api/teams?${params}`);
  },

  // Teams Directory
  async getTeamsDirectory(query = '', minRoster = 2, sortBy = 'power_rating', order = 'DESC', page = 1, pageSize = 25) {
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
  async getRecommendedEvents(playerId = '', query = '', tier = '', lat = null, lng = null, radius = null, limit = 35) {
    const params = new URLSearchParams();
    if (playerId) params.append('player_id', playerId);
    if (query) params.append('query', query);
    if (tier) params.append('tier', tier);
    if (lat !== null && lat !== undefined) params.append('lat', lat);
    if (lng !== null && lng !== undefined) params.append('lng', lng);
    if (radius !== null && radius !== undefined) params.append('radius_miles', radius);
    if (limit) params.append('limit', limit);
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
  }
};
