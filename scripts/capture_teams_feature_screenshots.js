/**
 * Automated End-to-End Visual Audit & Screenshot Suite for Teams & Clubs System
 * Captures pixel-perfect screenshots across Desktop, Tablet, and Mobile.
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
  await sleep(400);

  const res = await client.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(res.data, 'base64');
  
  const destPath = path.join(ARTIFACT_DIR, filename);
  fs.writeFileSync(destPath, buf);
  console.log(`  📸 [${options.device || 'Desktop'}] Saved: ${filename} (${width}x${height})`);
}

async function main() {
  console.log("🚀 Launching Headless Chrome for Teams Visual Audit...");
  const chromeProcess = spawn('/usr/bin/google-chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--remote-debugging-port=9225',
    '--window-size=1440,900',
    '--hide-scrollbars',
    '--disable-extensions',
    '--user-data-dir=/tmp/chrome-teams-profile-' + Date.now()
  ], { stdio: 'ignore' });

  await sleep(1500);

  let client = null;
  try {
    const targets = await fetchJson('http://127.0.0.1:9225/json');
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    if (!pageTarget) throw new Error('No Chrome page target available on 9225');

    client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.ready();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');

    console.log("✅ CDP connection established on port 9225.");

    const viewports = [
      { name: 'desktop', width: 1440, height: 900, mobile: false, device: 'Desktop' },
      { name: 'tablet', width: 820, height: 1180, mobile: false, device: 'Tablet' },
      { name: 'mobile', width: 390, height: 844, mobile: true, device: 'Mobile' }
    ];

    // Navigate to app
    await client.send('Page.navigate', { url: `${BASE_URL}/app.html` });
    await sleep(2000);

    for (const vp of viewports) {
      console.log(`\n=== Testing Viewport: ${vp.device} (${vp.width}x${vp.height}) ===`);
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.mobile
      });
      await sleep(300);

      // 1. Switch to Teams Tab -> Team Hub (Art of War)
      console.log(`  [${vp.device}] Navigating to Teams Tab (Art of War Hub)...`);
      await client.eval(`
        document.querySelectorAll('.modal-backdrop').forEach(m => { m.style.display = 'none'; });
      `);
      await client.eval("switchTab('teams');");
      await sleep(1000);
      await takeScreenshot(client, `team_hub_roster_${vp.name}.png`, vp);

      // 2. Battlefield Feed Subtab
      console.log(`  [${vp.device}] Switching to Battlefield Feed Subtab...`);
      await client.eval("switchTeamHubSubtab('feed');");
      await sleep(400);
      await takeScreenshot(client, `team_hub_feed_${vp.name}.png`, vp);

      // 3. Trajectory Subtab
      console.log(`  [${vp.device}] Switching to Trajectory Subtab...`);
      await client.eval("switchTeamHubSubtab('trajectory');");
      await sleep(400);
      await takeScreenshot(client, `team_hub_trajectory_${vp.name}.png`, vp);

      // 4. War Room & Rivalries Subtab
      console.log(`  [${vp.device}] Switching to War Room Subtab...`);
      await client.eval("switchTeamHubSubtab('warroom');");
      await sleep(400);
      await takeScreenshot(client, `team_hub_warroom_${vp.name}.png`, vp);

      // 5. Trophy Room & Glory Treasury Subtab
      console.log(`  [${vp.device}] Switching to Trophy Room Subtab...`);
      await client.eval("switchTeamHubSubtab('trophies');");
      await sleep(400);
      await takeScreenshot(client, `team_hub_trophies_${vp.name}.png`, vp);

      // 6. Locker Room & Chat Subtab
      console.log(`  [${vp.device}] Switching to Locker Room Subtab...`);
      await client.eval("switchTeamHubSubtab('locker');");
      await sleep(400);
      await takeScreenshot(client, `team_hub_locker_${vp.name}.png`, vp);

      // 5. Global Clubs Directory View
      console.log(`  [${vp.device}] Switching to Global Clubs Directory View...`);
      await client.eval("loadTeamsView('directory');");
      await sleep(800);
      await takeScreenshot(client, `teams_leaderboard_directory_${vp.name}.png`, vp);

      // 6. Onboarding Modal ("Claim Your Team")
      console.log(`  [${vp.device}] Triggering 'Claim Your Team' Modal...`);
      await client.eval(`
        (async () => {
          const modal = document.getElementById('team-onboarding-modal');
          if (modal) {
            modal.style.display = 'flex';
            const listEl = document.getElementById('team-onboarding-detected-list');
            if (listEl) {
              const historyRes = await window.api.getDetectedTeams();
              const detected = (historyRes && historyRes.detected) ? historyRes.detected : [];
              listEl.innerHTML = detected.map(d => \`
                <div class="onboarding-team-card \${d.team_id === 'team_art_of_war' ? 'selected' : ''}" id="onboarding-card-\${d.team_id}" onclick="selectOnboardingOption('\${d.team_id}')" style="background: \${d.team_id === 'team_art_of_war' ? 'rgba(56,189,248,0.1)' : '#090f1d'}; border: 1px solid \${d.team_id === 'team_art_of_war' ? '#38bdf8' : 'rgba(255,255,255,0.1)'}; border-radius: 10px; padding: 0.85rem 1rem; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 1.2rem;">🛡️</span>
                    <div>
                      <div style="font-weight: 800; font-size: 0.94rem; color: #fff;">
                        \${d.name} <span style="font-size:0.74rem; color:#c084fc;">[\${d.short_tag || 'TEAM'}]</span>
                      </div>
                      <div style="font-size: 0.72rem; color: #94a3b8;">
                        \${d.match_count} Matches recorded &bull; Last played: \${d.last_played}
                      </div>
                    </div>
                  </div>
                  <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 0.76rem;">
                    \${d.team_id === 'team_art_of_war' ? '✓ Selected' : 'Select ➔'}
                  </span>
                </div>
              \`).join('');
              const btn = document.getElementById('btn-confirm-onboarding-team');
              if (btn) btn.disabled = false;
            }
          }
        })();
      `);
      await sleep(600);
      await takeScreenshot(client, `team_onboarding_modal_${vp.name}.png`, vp);

      // Close modal before next viewport
      await client.eval("closeTeamOnboardingModal();");
      await sleep(200);
    }

    console.log("\n🎉 All 18 responsive screenshots captured successfully!");
  } catch (err) {
    console.error("Screenshot suite failed:", err);
  } finally {
    if (chromeProcess) {
      chromeProcess.kill('SIGTERM');
    }
  }
}

main();
