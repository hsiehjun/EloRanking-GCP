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
  async getLeaderboardTeams(minRoster = 5, limit = 100) {
    const params = new URLSearchParams({ min_roster: minRoster, limit });
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
  async getRecommendedEvents(playerId = '', query = '', tier = '', lat = null, lng = null, radius = null, limit = 35, state = '', sortBy = 'date') {
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
    return this._fetchJson('/api/eventstudio/event/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },



  // EventStudio: Update Tournament
  async updateStudioEvent(eventId, payload) {
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  },

  // EventStudio: Delete Tournament
  async deleteStudioEvent(eventId) {
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}`, {
      method: 'DELETE'
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

  // EventStudio: Save Roster
  async saveStudioRoster(eventId, payload) {
    return this._fetchJson(`/api/eventstudio/event/${encodeURIComponent(eventId)}/roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  }
};
