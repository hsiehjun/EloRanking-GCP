/* ==========================================================================
   API.JS - Centralized REST Client for Warhammer 40k Elo Ranking
   ========================================================================== */

window.api = {
  // Session Token Helper
  getAuthToken() {
    return localStorage.getItem('native_session_token') || localStorage.getItem('bcp_session_token') || '';
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
    const res = await fetch(`/api/auth/me?token=${encodeURIComponent(token)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
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
    const res = await fetch(`/api/user/bcp/connect?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ bcp_email: bcpEmail, bcp_password: bcpPassword })
    });
    return res.json();
  },

  // Disconnect BCP Account
  async disconnectBcpAccount() {
    const token = this.getAuthToken();
    const res = await fetch(`/api/user/bcp/disconnect?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
  },

  // Personalized Competitor Hub
  async getUserDashboard(playerId = null) {
    const token = this.getAuthToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const validPid = (playerId && playerId !== 'undefined' && playerId !== 'null') ? playerId : null;
    const url = validPid ? `/api/user/dashboard?player_id=${encodeURIComponent(validPid)}` : `/api/user/dashboard?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { headers });
    return res.json();
  },

  // Global Summary Stats
  async getStats() {
    const res = await fetch('/api/stats');
    return res.json();
  },

  // Leaderboard (Players)
  async getLeaderboard(faction = 'All', page = 1, pageSize = 25, sortBy = 'current_elo', order = 'DESC') {
    const params = new URLSearchParams({ faction, page, page_size: pageSize, sort_by: sortBy, order });
    const res = await fetch(`/api/leaderboard?${params}`);
    return res.json();
  },

  // Leaderboard (Teams)
  async getLeaderboardTeams(minRoster = 2, limit = 100) {
    const params = new URLSearchParams({ min_roster: minRoster, limit });
    const res = await fetch(`/api/teams?${params}`);
    return res.json();
  },

  // Teams Directory
  async getTeamsDirectory(query = '', minRoster = 2, sortBy = 'power_rating', order = 'DESC', page = 1, pageSize = 25) {
    const params = new URLSearchParams({ query, min_roster: minRoster, sort_by: sortBy, order, page, page_size: pageSize });
    const res = await fetch(`/api/teams?${params}`);
    return res.json();
  },

  // Players Directory
  async getPlayersDirectory(query = '', faction = 'All', sortBy = 'current_elo', order = 'DESC', page = 1, pageSize = 25) {
    const params = new URLSearchParams({ query, faction, sort_by: sortBy, order, page, page_size: pageSize });
    const res = await fetch(`/api/players?${params}`);
    return res.json();
  },

  // Tournaments Directory
  async getTournaments(query = '', status = 'all', sortBy = 'event_date', order = 'DESC', page = 1, pageSize = 25) {
    const params = new URLSearchParams({ query, status, sort_by: sortBy, order, page, page_size: pageSize });
    const res = await fetch(`/api/events?${params}`);
    return res.json();
  },

  // Single Player Profile & Win Path
  async getPlayerProfile(playerId) {
    const res = await fetch(`/api/player/${encodeURIComponent(playerId)}`);
    return res.json();
  },

  // Single Team Roster
  async getTeamRoster(teamName) {
    const res = await fetch(`/api/team/${encodeURIComponent(teamName)}`);
    return res.json();
  },

  // Single Tournament Details & Pairings
  async getTournamentDetails(eventId) {
    const res = await fetch(`/api/event/${encodeURIComponent(eventId)}`);
    return res.json();
  },

  // Faction Meta & Dynamic Timeline Trends
  async getFactionMeta(startDate = null, endDate = null) {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    const url = params.toString() ? `/api/factions/meta?${params}` : '/api/factions/meta';
    const res = await fetch(url);
    return res.json();
  },

  // Single Faction Details & Pilots
  async getFactionDetails(factionName) {
    const res = await fetch(`/api/faction/${encodeURIComponent(factionName)}`);
    return res.json();
  },

  // Match Predictor
  async predictMatch(p1Id, p2Id) {
    const params = new URLSearchParams({ p1: p1Id, p2: p2Id });
    const res = await fetch(`/api/predict?${params}`);
    return res.json();
  },

  // Autocomplete Search Players
  async searchPlayers(query, limit = 10) {
    const params = new URLSearchParams({ q: query, limit });
    const res = await fetch(`/api/players/search?${params}`);
    return res.json();
  }
};
