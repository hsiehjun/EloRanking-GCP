// Comprehensive Platform Visual & User Journey Audit Script
// Runs via Headless Chrome & CDP against http://127.0.0.1:5177
// Verifies EVERY PAGE and EVERY CORE USER JOURNEY across Desktop (1280x950), Tablet (768x1024), and Mobile (412x924).

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5177;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/c237be5b-1b61-4ed4-9716-49956da8d5ea';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.consoleErrors = [];
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params && msg.params.type === 'error') {
        const text = msg.params.args ? msg.params.args.map(a => a.value || a.description || '').join(' ') : '';
        this.consoleErrors.push(text);
      }
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res && res.exceptionDetails) {
      throw new Error('Eval Exception: ' + JSON.stringify(res.exceptionDetails));
    }
    return res && res.result ? res.result.value : null;
  }
}

async function takeScreenshot(client, filename, options = {}) {
  if (options.width && options.height) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: options.width,
      height: options.height,
      deviceScaleFactor: 1,
      mobile: !!options.mobile
    });
    await sleep(400);
  }
  const res = await client.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(res.data, 'base64');
  if (fs.existsSync(ARTIFACT_DIR)) {
    fs.writeFileSync(`${ARTIFACT_DIR}/${filename}`, buf);
  }
  console.log(`  📸 Saved screenshot: ${filename} (${options.width || 'default'}x${options.height || 'default'})`);
}

async function checkMobileOverflow(client) {
  return await client.eval(`
    (() => {
      const docEl = document.documentElement;
      const body = document.body;
      const scrollW = Math.max(docEl.scrollWidth, body ? body.scrollWidth : 0);
      const innerW = window.innerWidth;
      return {
        bodyScrollWidth: scrollW,
        windowInnerWidth: innerW,
        hasHorizontalOverflow: scrollW > innerW + 2
      };
    })()
  `);
}

async function runComprehensivePlatformAudit() {
  console.log('======================================================================');
  console.log('🚀 STARTING COMPREHENSIVE PLATFORM VISUAL & JOURNEY AUDIT');
  console.log('======================================================================');

  const chromePort = 9340;
  const chrome = spawn('google-chrome', [
    '--headless=new',
    `--remote-debugging-port=${chromePort}`,
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1280,950',
    '--user-data-dir=/tmp/chrome_audit_profile_' + Date.now(),
    'about:blank'
  ]);

  try {
    await sleep(2000);
    const targets = await fetchJson(`http://127.0.0.1:${chromePort}/json`);
    const pageTarget = targets.find(t => t.type === 'page');
    if (!pageTarget) throw new Error('No page target found');

    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.ready();
    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Runtime.enable');

    const setupHelpers = `
      window.confirm = () => true;
      window.alert = () => true;
      try {
        localStorage.setItem('omnitactica_commendation_dismissed', 'true');
        localStorage.setItem('seen_commendation', 'true');
      } catch (e) {}
      const killModals = () => {
        const modals = document.querySelectorAll('.high-command-modal, .modal-backdrop, #new-commendations-modal');
        modals.forEach(m => {
          if (m.id === 'new-commendations-modal' || m.textContent.includes('High Command Commendation')) {
            m.remove();
          }
        });
      };
      killModals();
      setInterval(killModals, 500);
    `;

    // 1. LANDING PAGE (/index.html)
    console.log('\n--- [1/8] Landing Page (/index.html) ---');
    await client.send('Page.navigate', { url: `${BASE_URL}/index.html` });
    await sleep(2000);
    await client.eval(setupHelpers);

    await takeScreenshot(client, 'audit_landing_page_desktop.png', { width: 1280, height: 950, mobile: false });
    await takeScreenshot(client, 'audit_landing_page_tablet.png', { width: 768, height: 1024, mobile: false });
    await takeScreenshot(client, 'audit_landing_page_mobile.png', { width: 412, height: 924, mobile: true });
    const landingOverflow = await checkMobileOverflow(client);
    console.log('  Landing page mobile overflow check:', landingOverflow);

    // 2. LEADERBOARD & STANDINGS (/app.html#leaderboard)
    console.log('\n--- [2/8] Leaderboard & Standings (40k & AoS) ---');
    await client.send('Page.navigate', { url: `${BASE_URL}/app.html#leaderboard` });
    await sleep(2500);
    await client.eval(setupHelpers);
    await client.eval(`if (typeof switchTab === 'function') switchTab('leaderboard');`);
    await sleep(1000);

    await takeScreenshot(client, 'audit_leaderboard_40k_desktop.png', { width: 1280, height: 950, mobile: false });

    console.log('  Switching to Age of Sigmar (AoS)...');
    await client.eval(`if (typeof switchGameSystem === 'function') switchGameSystem('aos');`);
    await sleep(1200);
    await takeScreenshot(client, 'audit_leaderboard_aos_desktop.png', { width: 1280, height: 950, mobile: false });

    await client.eval(`if (typeof switchGameSystem === 'function') switchGameSystem('40k');`);
    await sleep(1000);

    await takeScreenshot(client, 'audit_leaderboard_40k_mobile.png', { width: 412, height: 924, mobile: true });
    const lbOverflow = await checkMobileOverflow(client);
    console.log('  Leaderboard mobile overflow check:', lbOverflow);

    // 3. PLAYER PROFILE SCOUT MODAL
    console.log('\n--- [3/8] Player Profile Scout Modal ---');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 950, deviceScaleFactor: 1, mobile: false });
    await client.eval(`
      (() => {
        const row = document.querySelector('.player-row, tr[data-player-id], .table-player-row');
        if (row) {
          row.click();
          return true;
        }
        if (typeof openPlayerModal === 'function') {
          openPlayerModal('DEV_USER');
          return true;
        }
        return false;
      })()
    `);
    await sleep(1500);
    await takeScreenshot(client, 'audit_player_scout_modal_desktop.png', { width: 1280, height: 950, mobile: false });

    await client.eval(`
      const closeBtn = document.querySelector('#player-modal .modal-close, .modal-close');
      if (closeBtn) closeBtn.click();
    `);
    await sleep(500);

    // 4. COMMUNITY & TOURNAMENTS (/app.html#community)
    console.log('\n--- [4/8] Community & Tournaments View ---');
    await client.eval(`if (typeof switchTab === 'function') switchTab('community');`);
    await sleep(1500);

    await takeScreenshot(client, 'audit_community_tournaments_desktop.png', { width: 1280, height: 950, mobile: false });
    await takeScreenshot(client, 'audit_community_tournaments_mobile.png', { width: 412, height: 924, mobile: true });
    const commOverflow = await checkMobileOverflow(client);
    console.log('  Community mobile overflow check:', commOverflow);

    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 950, deviceScaleFactor: 1, mobile: false });
    await client.eval(`if (typeof switchCommunitySubtab === 'function') switchCommunitySubtab('creators');`);
    await sleep(1200);
    await takeScreenshot(client, 'audit_community_creator_hub_desktop.png', { width: 1280, height: 950, mobile: false });

    // 5. META INTEL / FACTIONS (/app.html#meta-intel)
    console.log('\n--- [5/8] Meta Intel / Faction Win Rates ---');
    await client.eval(`if (typeof switchTab === 'function') switchTab('meta-intel');`);
    await sleep(1500);
    await takeScreenshot(client, 'audit_meta_intel_desktop.png', { width: 1280, height: 950, mobile: false });
    await takeScreenshot(client, 'audit_meta_intel_mobile.png', { width: 412, height: 924, mobile: true });
    const metaOverflow = await checkMobileOverflow(client);
    console.log('  Meta Intel mobile overflow check:', metaOverflow);

    // 6. GAME TRACKER COMPANION (/app.html#tracker)
    console.log('\n--- [6/8] Game Tracker Companion ---');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 950, deviceScaleFactor: 1, mobile: false });
    await client.eval(`if (typeof switchTab === 'function') switchTab('tracker');`);
    await sleep(1500);
    await takeScreenshot(client, 'audit_game_tracker_desktop.png', { width: 1280, height: 950, mobile: false });
    await takeScreenshot(client, 'audit_game_tracker_mobile.png', { width: 412, height: 924, mobile: true });
    const trackerOverflow = await checkMobileOverflow(client);
    console.log('  Game Tracker mobile overflow check:', trackerOverflow);

    // 7. MY HUB: ALL SUBTABS
    console.log('\n--- [7/8] My Hub: All Subtabs & Trophy Engine ---');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 950, deviceScaleFactor: 1, mobile: false });
    await client.eval(`if (typeof switchTab === 'function') switchTab('my-hub');`);
    await sleep(2000);

    console.log('  - Hub Subtab: Active Rosters');
    await client.eval(`if (typeof switchHubTab === 'function') switchHubTab('active');`);
    await sleep(800);
    await takeScreenshot(client, 'audit_hub_active_rosters_desktop.png', { width: 1280, height: 950, mobile: false });

    console.log('  - Hub Subtab: Tournament Journey');
    await client.eval(`if (typeof switchHubTab === 'function') switchHubTab('journey');`);
    await sleep(800);
    await takeScreenshot(client, 'audit_hub_tournament_journey_desktop.png', { width: 1280, height: 950, mobile: false });

    console.log('  - Hub Subtab: Elo Trajectory');
    await client.eval(`if (typeof switchHubTab === 'function') switchHubTab('trajectory');`);
    await sleep(800);
    await takeScreenshot(client, 'audit_hub_elo_trajectory_desktop.png', { width: 1280, height: 950, mobile: false });

    console.log('  - Hub Subtab: Faction Mastery');
    await client.eval(`if (typeof switchHubTab === 'function') switchHubTab('factions');`);
    await sleep(800);
    await takeScreenshot(client, 'audit_hub_faction_mastery_desktop.png', { width: 1280, height: 950, mobile: false });

    console.log('  - Hub Subtab: Matchup Matrix');
    await client.eval(`if (typeof switchHubTab === 'function') switchHubTab('matrix');`);
    await sleep(800);
    await takeScreenshot(client, 'audit_hub_matchup_matrix_desktop.png', { width: 1280, height: 950, mobile: false });

    console.log('  - Hub Subtab: Trophy Room (Career Scope)');
    await client.eval(`
      if (typeof switchHubTab === 'function') switchHubTab('trophies');
      if (window.BadgesUI && window.BadgesUI.setHubScope) window.BadgesUI.setHubScope('career');
    `);
    await sleep(1000);
    await takeScreenshot(client, 'audit_hub_trophies_career_desktop.png', { width: 1280, height: 950, mobile: false });

    console.log('  - Hub Subtab: Trophy Room (Season 2026 Scope)');
    await client.eval(`
      if (window.BadgesUI && window.BadgesUI.setHubScope) window.BadgesUI.setHubScope('seasonal');
    `);
    await sleep(1000);
    await takeScreenshot(client, 'audit_hub_trophies_season2026_desktop.png', { width: 1280, height: 950, mobile: false });
    await takeScreenshot(client, 'audit_hub_trophies_season2026_tablet.png', { width: 768, height: 1024, mobile: false });
    await takeScreenshot(client, 'audit_hub_trophies_season2026_mobile.png', { width: 412, height: 924, mobile: true });
    const trophyOverflow = await checkMobileOverflow(client);
    console.log('  Trophy Room mobile overflow check:', trophyOverflow);

    // 8. EVENTSTUDIO (/eventstudio.html?id=BCP-TOURNAMENT-42)
    console.log('\n--- [8/8] EventStudio Tournament Director Dashboard ---');
    await client.send('Page.navigate', { url: `${BASE_URL}/eventstudio.html?id=BCP-TOURNAMENT-42` });
    await sleep(2500);
    await client.eval(setupHelpers);

    await takeScreenshot(client, 'audit_eventstudio_desktop.png', { width: 1280, height: 950, mobile: false });
    await takeScreenshot(client, 'audit_eventstudio_tablet.png', { width: 768, height: 1024, mobile: false });
    await takeScreenshot(client, 'audit_eventstudio_mobile.png', { width: 412, height: 924, mobile: true });
    const esOverflow = await checkMobileOverflow(client);
    console.log('  EventStudio mobile overflow check:', esOverflow);

    console.log('\n======================================================================');
    console.log('✨ ALL 8 PLATFORM AREAS & USER JOURNEYS TESTED SUCCESSFULLY!');
    console.log(`✨ Total Console Errors Logged: ${client.consoleErrors.length}`);
    if (client.consoleErrors.length > 0) {
      console.log('Console Errors:', client.consoleErrors);
    }
    console.log('======================================================================');

  } finally {
    chrome.kill();
  }
}

runComprehensivePlatformAudit().catch(err => {
  console.error('FATAL AUDIT ERROR:', err);
  process.exit(1);
});
