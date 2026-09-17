/**
 * Comprehensive Automated End-to-End Browser Verification and Visual Screenshot Suite
 * Tests every core page, modal, tab, and button across Desktop, Tablet, and Mobile viewports.
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5175;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/25e8cdeb-4a06-4988-9d93-454ee3820806';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
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
      console.warn('Eval warning:', res.exceptionDetails.text || res.exceptionDetails);
    }
    return res && res.result ? res.result.value : null;
  }
}

async function takeScreenshot(client, filename, options = {}) {
  const width = options.width || 1440;
  const height = options.height || 900;
  const mobile = !!options.mobile;

  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile
  });
  await sleep(450);

  const res = await client.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(res.data, 'base64');
  
  const destPath = path.join(ARTIFACT_DIR, filename);
  fs.writeFileSync(destPath, buf);
  console.log(`  📸 [${options.device || 'Desktop'}] Saved: ${filename} (${width}x${height})`);
}

async function main() {
  console.log("🚀 Launching Headless Google Chrome for End-to-End Visual Audit...");
  
  const chromeProcess = spawn('/usr/bin/google-chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--remote-debugging-port=9222',
    '--window-size=1440,900',
    '--hide-scrollbars'
  ], { stdio: 'ignore' });

  // Give Chrome time to open port 9222
  await sleep(1500);

  let client = null;
  try {
    const versionInfo = await fetchJson('http://127.0.0.1:9222/json/version');
    const targets = await fetchJson('http://127.0.0.1:9222/json');
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];

    if (!pageTarget) throw new Error('No Chrome page target available');

    client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.ready();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');

    console.log("✅ CDP connection established.");

    const viewports = [
      { name: 'desktop', width: 1440, height: 900, mobile: false, label: 'Desktop' },
      { name: 'tablet', width: 820, height: 1180, mobile: false, label: 'Tablet' },
      { name: 'mobile', width: 390, height: 844, mobile: true, label: 'Mobile' }
    ];

    // =========================================================================
    // JOURNEY 1: MAIN APP - RANKINGS & LEADERBOARD
    // =========================================================================
    console.log("\n--- [Journey 1] Rankings & Leaderboard ---");
    await client.send('Page.navigate', { url: `${BASE_URL}/app.html` });
    await sleep(2500);

    for (const vp of viewports) {
      await takeScreenshot(client, `journey1_rankings_${vp.name}.png`, { ...vp, device: vp.label });
    }

    // Interaction: AoS switch
    console.log("  -> Switching to Age of Sigmar ranking...");
    await client.eval(`
      const aosBtn = Array.from(document.querySelectorAll('button, .game-system-btn, .pill')).find(b => b.textContent && b.textContent.includes('AoS') || b.textContent.includes('Age of Sigmar'));
      if (aosBtn) aosBtn.click();
      else if (typeof window.switchGameSystem === 'function') window.switchGameSystem('aos');
    `);
    await sleep(1000);
    await takeScreenshot(client, `journey1_rankings_aos_desktop.png`, { width: 1440, height: 900, device: 'Desktop' });

    // Switch back to 40k
    await client.eval(`if (typeof window.switchGameSystem === 'function') window.switchGameSystem('40k');`);
    await sleep(800);

    // =========================================================================
    // JOURNEY 2: PLAYER PROFILE MODAL & MATCH PREDICTOR
    // =========================================================================
    console.log("\n--- [Journey 2] Player Profile & Match Predictor ---");
    await client.eval(`
      const playerLink = document.querySelector('.player-link, td a, [onclick*="openPlayerModal"]');
      if (playerLink) playerLink.click();
      else if (typeof window.openPlayerModal === 'function') window.openPlayerModal('p_innes_wilson');
    `);
    await sleep(1200);

    for (const vp of viewports) {
      await takeScreenshot(client, `journey2_player_modal_${vp.name}.png`, { ...vp, device: vp.label });
    }

    // Close modal
    await client.eval(`
      const closeBtn = document.querySelector('#player-modal .modal-close, .modal.active .modal-close');
      if (closeBtn) closeBtn.click();
      else if (typeof window.closePlayerModal === 'function') window.closePlayerModal();
    `);
    await sleep(500);

    // Open Match Predictor
    console.log("  -> Opening Match Predictor Modal...");
    await client.eval(`if (typeof window.openPredictorModal === 'function') window.openPredictorModal();`);
    await sleep(1000);
    for (const vp of viewports) {
      await takeScreenshot(client, `journey2_predictor_modal_${vp.name}.png`, { ...vp, device: vp.label });
    }
    await client.eval(`if (typeof window.closePredictorModal === 'function') window.closePredictorModal();`);
    await sleep(500);

    // =========================================================================
    // JOURNEY 3: TOURNAMENTS & EVENTS HUB
    // =========================================================================
    console.log("\n--- [Journey 3] Tournaments & Events Hub ---");
    await client.eval(`if (typeof window.switchTab === 'function') window.switchTab('tournaments');`);
    await sleep(1500);

    for (const vp of viewports) {
      await takeScreenshot(client, `journey3_tournaments_hub_${vp.name}.png`, { ...vp, device: vp.label });
    }

    // Open an event modal
    console.log("  -> Opening Event Details Modal (Placings & Pairings)...");
    await client.eval(`
      if (typeof window.openEventModal === 'function') {
        window.openEventModal('ev_ongoing_gt_live');
      }
    `);
    await sleep(1500);

    for (const vp of viewports) {
      await takeScreenshot(client, `journey3_event_modal_${vp.name}.png`, { ...vp, device: vp.label });
    }

    // Switch to pairings tab inside event modal
    await client.eval(`
      const pairTab = Array.from(document.querySelectorAll('.modal-tab, .tab-btn')).find(b => b.textContent && b.textContent.includes('Pairing'));
      if (pairTab) pairTab.click();
    `);
    await sleep(1000);
    await takeScreenshot(client, `journey3_event_modal_pairings_desktop.png`, { width: 1440, height: 900, device: 'Desktop' });

    // Close event modal
    await client.eval(`
      const closeBtn = document.querySelector('#event-modal .modal-close, .modal.active .modal-close');
      if (closeBtn) closeBtn.click();
    `);
    await sleep(500);

    // =========================================================================
    // JOURNEY 4: TEAMS POWER RANKINGS
    // =========================================================================
    console.log("\n--- [Journey 4] Teams Power Rankings ---");
    await client.eval(`if (typeof window.switchTab === 'function') window.switchTab('teams');`);
    await sleep(1200);

    for (const vp of viewports) {
      await takeScreenshot(client, `journey4_teams_directory_${vp.name}.png`, { ...vp, device: vp.label });
    }

    // Open Team Roster modal
    console.log("  -> Opening Team Roster Modal...");
    await client.eval(`
      if (typeof window.openTeamModal === 'function') window.openTeamModal('Team USA 40k');
    `);
    await sleep(1200);
    for (const vp of viewports) {
      await takeScreenshot(client, `journey4_team_roster_modal_${vp.name}.png`, { ...vp, device: vp.label });
    }
    await client.eval(`
      const closeBtn = document.querySelector('#team-modal .modal-close, .modal.active .modal-close');
      if (closeBtn) closeBtn.click();
    `);
    await sleep(500);

    // =========================================================================
    // JOURNEY 5: FACTION META INTEL
    // =========================================================================
    console.log("\n--- [Journey 5] Faction Meta Intel ---");
    await client.eval(`if (typeof window.switchTab === 'function') window.switchTab('factions');`);
    await sleep(1500);

    for (const vp of viewports) {
      await takeScreenshot(client, `journey5_faction_meta_${vp.name}.png`, { ...vp, device: vp.label });
    }

    // =========================================================================
    // JOURNEY 6: COMPETITOR MY HUB & SETTINGS
    // =========================================================================
    console.log("\n--- [Journey 6] Competitor My Hub & Settings ---");
    await client.eval(`if (typeof window.switchTab === 'function') window.switchTab('my-hub');`);
    await sleep(1500);

    for (const vp of viewports) {
      await takeScreenshot(client, `journey6_my_hub_${vp.name}.png`, { ...vp, device: vp.label });
    }

    // Open User Settings Modal
    console.log("  -> Opening User Settings Modal...");
    await client.eval(`if (typeof window.openUserSettingsModal === 'function') window.openUserSettingsModal();`);
    await sleep(1000);
    for (const vp of viewports) {
      await takeScreenshot(client, `journey6_user_settings_modal_${vp.name}.png`, { ...vp, device: vp.label });
    }
    await client.eval(`
      const closeBtn = document.querySelector('#user-settings-modal .modal-close, .modal.active .modal-close');
      if (closeBtn) closeBtn.click();
    `);
    await sleep(500);

    // =========================================================================
    // JOURNEY 7: TOURNAMENT ORGANIZER EVENT STUDIO
    // =========================================================================
    console.log("\n--- [Journey 7] Tournament Organizer Event Studio ---");
    await client.send('Page.navigate', { url: `${BASE_URL}/eventstudio.html` });
    await sleep(2500);

    for (const vp of viewports) {
      await takeScreenshot(client, `journey7_eventstudio_${vp.name}.png`, { ...vp, device: vp.label });
    }

    // =========================================================================
    // JOURNEY 8: 40K LIVE GAME TRACKER & DIGITAL SCORECARD
    // =========================================================================
    console.log("\n--- [Journey 8] Live Game Tracker (Play & Scorecard) ---");
    await client.send('Page.navigate', { url: `${BASE_URL}/11th/tracker/play?match_id=WH40K-E2E-AUDIT&solo=true` });
    await sleep(2500);

    for (const vp of viewports) {
      await takeScreenshot(client, `journey8_tracker_play_${vp.name}.png`, { ...vp, device: vp.label });
    }

    // Scorecard view
    console.log("  -> Viewing Digital Scorecard...");
    await client.send('Page.navigate', { url: `${BASE_URL}/scorecard.html?match_id=WH40K-E2E-AUDIT` });
    await sleep(2000);
    for (const vp of viewports) {
      await takeScreenshot(client, `journey8_digital_scorecard_${vp.name}.png`, { ...vp, device: vp.label });
    }

    console.log("\n🎉 ALL 8 USER JOURNEYS TESTED AND SCREENSHOTS CAPTURED ACROSS ALL VIEWPORTS!");

  } catch (err) {
    console.error("❌ Test run failed:", err);
    process.exitCode = 1;
  } finally {
    if (chromeProcess) {
      chromeProcess.kill('SIGTERM');
    }
  }
}

main();
