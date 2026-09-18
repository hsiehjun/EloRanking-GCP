/**
 * Comprehensive 40k vs. AoS System Isolation & Responsive Visual Audit Suite
 * Tests 40k and Age of Sigmar across Desktop (1440x900), Tablet (820x1180), and Mobile (390x844).
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5176;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/a6253a1a-ca8f-4466-9cc6-340c885b9577';

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
      console.warn('Eval warning:', JSON.stringify(res.exceptionDetails));
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
  await sleep(250);

  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  });

  const buffer = Buffer.from(result.data, 'base64');
  const targetPath = path.join(ARTIFACT_DIR, filename);
  fs.writeFileSync(targetPath, buffer);
  console.log(`  📸 [${options.device || 'Screen'}] Saved: ${filename} (${width}x${height})`);
  return targetPath;
}

async function runAudit() {
  console.log("🚀 Starting Comprehensive 40k & AoS System Isolation Visual Audit...");

  const chromeProc = spawn('/usr/bin/google-chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--remote-debugging-port=9226',
    '--window-size=1440,900',
    '--hide-scrollbars',
    '--disable-extensions',
    '--user-data-dir=/tmp/chrome-audit-profile-' + Date.now()
  ], { stdio: 'ignore' });

  await sleep(1500);

  let client = null;
  try {
    const targets = await fetchJson('http://127.0.0.1:9226/json');
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    if (!pageTarget) throw new Error('No Chrome page target available on 9226');

    client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.ready();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');

    console.log("✅ CDP connection established on port 9226.");

    const viewports = [
      { name: 'desktop', width: 1440, height: 900, mobile: false, device: 'Desktop' },
      { name: 'tablet', width: 820, height: 1180, mobile: false, device: 'Tablet' },
      { name: 'mobile', width: 390, height: 844, mobile: true, device: 'Mobile' }
    ];

    // Navigate to application
    await client.send('Page.navigate', { url: `${BASE_URL}/app.html` });
    await sleep(2000);

    for (const vp of viewports) {
      console.log(`\n======================================================`);
      console.log(`=== VIEWPORT AUDIT: ${vp.device.toUpperCase()} (${vp.width}x${vp.height}) ===`);
      console.log(`======================================================`);

      // Dismiss any popups
      await client.eval(`
        document.querySelectorAll('.modal-backdrop, .modal-overlay').forEach(m => { m.style.display = 'none'; });
      `);

      // ──────────────────────────────────────────────────────────
      // PART 1: 40K SYSTEM VERIFICATION
      // ──────────────────────────────────────────────────────────
      console.log(`\n[${vp.device}] --- 40K SYSTEM ---`);
      await client.eval("switchGameSystem('40k');");
      await sleep(500);

      // 1. 40k Team Hub: Art of War Roster
      await client.eval("switchTab('teams');");
      await sleep(800);
      await takeScreenshot(client, `audit_40k_team_hub_roster_${vp.name}.png`, vp);

      // 2. 40k Team Hub: Battlefield Feed
      await client.eval("switchTeamHubSubtab('feed');");
      await sleep(350);
      await takeScreenshot(client, `audit_40k_team_hub_feed_${vp.name}.png`, vp);

      // 3. 40k Team Hub: Trajectory Canvas & Milestones
      await client.eval("switchTeamHubSubtab('trajectory');");
      await sleep(350);
      await takeScreenshot(client, `audit_40k_team_hub_trajectory_${vp.name}.png`, vp);

      // 4. 40k Team Hub: War Room & Dual-Format Rivalries
      await client.eval("switchTeamHubSubtab('warroom');");
      await sleep(350);
      await takeScreenshot(client, `audit_40k_team_hub_warroom_${vp.name}.png`, vp);

      // 5. 40k Team Hub: Trophy Room & Glory Treasury
      await client.eval("switchTeamHubSubtab('trophies');");
      await sleep(350);
      await takeScreenshot(client, `audit_40k_team_hub_trophies_${vp.name}.png`, vp);

      // 6. 40k Team Hub: Locker Room & Squad Chat
      await client.eval("switchTeamHubSubtab('locker');");
      await sleep(350);
      await takeScreenshot(client, `audit_40k_team_hub_locker_${vp.name}.png`, vp);

      // 7. 40k Global Teams Directory (Art of War, Zero Comp, Ignite)
      await client.eval("loadTeamsView('directory');");
      await sleep(700);
      await takeScreenshot(client, `audit_40k_teams_directory_${vp.name}.png`, vp);

      // ──────────────────────────────────────────────────────────
      // PART 2: AGE OF SIGMAR (AoS) SYSTEM VERIFICATION & ISOLATION
      // ──────────────────────────────────────────────────────────
      console.log(`\n[${vp.device}] --- AGE OF SIGMAR (AoS) SYSTEM ---`);
      
      // Switch system to AoS
      await client.eval("switchGameSystem('aos');");
      await sleep(700);

      // 8. AoS Global Teams Directory (Hammerhal Vanguard #1, Aqshy Reavers, Shyish Deathlords)
      await client.eval("loadTeamsView('directory');");
      await sleep(800);
      await takeScreenshot(client, `audit_aos_teams_directory_${vp.name}.png`, vp);

      // 9. AoS Team Hub: Hammerhal Vanguard [HVG] Roster
      await client.eval("loadTeamsView('team_hammerhal_vanguard');");
      await sleep(800);
      await takeScreenshot(client, `audit_aos_team_hub_roster_${vp.name}.png`, vp);

      // 10. AoS Team Hub: Battlefield Feed (ETC and LGT AoS results)
      await client.eval("switchTeamHubSubtab('feed');");
      await sleep(350);
      await takeScreenshot(client, `audit_aos_team_hub_feed_${vp.name}.png`, vp);

      // 11. AoS Team Hub: War Room (vs. Slaves to Darkness, Soulblight, Skaven)
      await client.eval("switchTeamHubSubtab('warroom');");
      await sleep(350);
      await takeScreenshot(client, `audit_aos_team_hub_warroom_${vp.name}.png`, vp);

      // 12. AoS Team Hub: Trophy Room (Worlds Team Champions banner)
      await client.eval("switchTeamHubSubtab('trophies');");
      await sleep(350);
      await takeScreenshot(client, `audit_aos_team_hub_trophies_${vp.name}.png`, vp);
    }

    console.log("\n🎉 Comprehensive 40k & AoS System Isolation Visual Audit Complete!");

  } catch (err) {
    console.error("Audit error:", err);
  } finally {
    try { chromeProc.kill(); } catch (e) {}
  }
}

runAudit();
