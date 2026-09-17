// Rigorous UI and Interaction Test Suite for Pure Icon Heraldry System
// Tests Desktop (1280x950), Tablet (768x1024), and Mobile (Pixel 9, 412x924)

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const PORT = 5177;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = '/usr/local/google/home/hsiehjun/.gemini/jetski/brain/c237be5b-1b61-4ed4-9716-49956da8d5ea';

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

async function runHeraldryTests() {
  console.log('======================================================================');
  console.log('🚀 TESTING HERALDIC INSIGNIA CLUSTER (ICON-ONLY TROPHY RANKS)');
  console.log('======================================================================');

  const chromePort = 9342;
  const chrome = spawn('google-chrome', [
    '--headless=new',
    `--remote-debugging-port=${chromePort}`,
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1280,950',
    '--user-data-dir=/tmp/chrome_heraldry_' + Date.now(),
    'about:blank'
  ]);

  try {
    await sleep(2000);
    const targets = await fetchJson(`http://127.0.0.1:${chromePort}/json`);
    const pageTarget = targets.find(t => t.type === 'page');
    if (!pageTarget) throw new Error('No Chrome page target found');

    const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await client.ready();
    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Runtime.enable');

    console.log('\n🌐 Navigating to My Hub (http://127.0.0.1:5177/app.html#my-hub)...');
    await client.send('Page.navigate', { url: `${BASE_URL}/app.html#my-hub` });
    await sleep(2500);

    // Dismiss any modals
    await client.eval(`
      try {
        localStorage.setItem('omnitactica_commendation_dismissed', 'true');
        localStorage.setItem('seen_commendation', 'true');
        document.querySelectorAll('.high-command-modal, .modal-backdrop, #new-commendations-modal').forEach(m => m.remove());
      } catch (e) {}
    `);
    await sleep(500);

    // ── 1. DESKTOP MY HUB: Hero Insignia Cluster ──
    console.log('\n=== [1/6] Desktop My Hub Hero: Heraldic Insignia Cluster ===');
    const heroClusterCheck = await client.eval(`
      (() => {
        const cluster = document.querySelector('.hero-insignia-cluster');
        const careerBtn = document.querySelector('.hero-insignia-btn.career-crest-btn');
        const seasonBtn = document.querySelector('.hero-insignia-btn.seasonal-seal-btn');
        const oldRankBadge = document.querySelector('.profile-rank-badge');
        const badgesRow = document.querySelector('.profile-badges-row');

        return {
          clusterExists: !!cluster,
          careerBtnExists: !!careerBtn,
          careerTitle: careerBtn ? careerBtn.getAttribute('title') : null,
          seasonBtnExists: !!seasonBtn,
          seasonTitle: seasonBtn ? seasonBtn.getAttribute('title') : null,
          hasOldTextRank: badgesRow ? badgesRow.textContent.includes('Trophy Rank:') : false,
          clusterWidth: cluster ? cluster.offsetWidth : 0,
          clusterHeight: cluster ? cluster.offsetHeight : 0
        };
      })()
    `);
    console.log('  Cluster inspection:', heroClusterCheck);

    await takeScreenshot(client, 'desktop_hero_heraldic_cluster.png', { width: 1280, height: 950, mobile: false });

    // ── 2. TABLET (768x1024) MY HUB: Hero Insignia Cluster ──
    console.log('\n=== [2/6] Tablet (768x1024) My Hub Hero ===');
    await takeScreenshot(client, 'tablet_hero_heraldic_cluster.png', { width: 768, height: 1024, mobile: false });

    // ── 3. MOBILE PIXEL 9 (412x924) MY HUB: Hero Insignia Cluster ──
    console.log('\n=== [3/6] Mobile Pixel 9 (412x924) My Hub Hero ===');
    await takeScreenshot(client, 'mobile_hero_heraldic_cluster.png', { width: 412, height: 924, mobile: true });
    const mobileOverflow = await client.eval(`
      (() => {
        const docEl = document.documentElement;
        const scrollW = Math.max(docEl.scrollWidth, document.body.scrollWidth);
        const innerW = window.innerWidth;
        return {
          scrollWidth: scrollW,
          innerWidth: innerW,
          hasOverflow: scrollW > innerW + 2
        };
      })()
    `);
    console.log('  Mobile layout check:', mobileOverflow);

    // ── 4. CLICK INTERACTION: Tap Seasonal Seal ['26] -> Direct Jump to Season 2026 Scope ──
    console.log('\n=== [4/6] Click Interaction: Tap Seasonal Seal [\'26] ===');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 950, deviceScaleFactor: 1, mobile: false });
    const clickSeasonRes = await client.eval(`
      (() => {
        const seasonBtn = document.querySelector('.hero-insignia-btn.seasonal-seal-btn');
        if (seasonBtn) {
          seasonBtn.click();
          return true;
        }
        return false;
      })()
    `);
    await sleep(1000);

    const postSeasonClickState = await client.eval(`
      (() => {
        const activeScopeBtn = document.querySelector('.trophy-scope-btn.active');
        const bannerTitle = document.querySelector('.trophy-military-title');
        const activeTab = document.querySelector('.profile-subtab-btn.active, .nav-item.active');
        return {
          activeScope: activeScopeBtn ? activeScopeBtn.getAttribute('data-scope') : null,
          bannerTitleText: bannerTitle ? bannerTitle.textContent.trim() : null
        };
      })()
    `);
    console.log('  Post-season-click state (should be seasonal):', postSeasonClickState);
    await takeScreenshot(client, 'heraldry_nav_jump_to_season_2026.png', { width: 1280, height: 950, mobile: false });

    // ── 5. CLICK INTERACTION: Tap Career Crest -> Direct Jump to Career Milestones Scope ──
    console.log('\n=== [5/6] Click Interaction: Tap Career Crest ===');
    await client.eval(`
      (() => {
        const careerBtn = document.querySelector('.hero-insignia-btn.career-crest-btn');
        if (careerBtn) {
          careerBtn.click();
          return true;
        }
        return false;
      })()
    `);
    await sleep(1000);

    const postCareerClickState = await client.eval(`
      (() => {
        const activeScopeBtn = document.querySelector('.trophy-scope-btn.active');
        const bannerTitle = document.querySelector('.trophy-military-title');
        return {
          activeScope: activeScopeBtn ? activeScopeBtn.getAttribute('data-scope') : null,
          bannerTitleText: bannerTitle ? bannerTitle.textContent.trim() : null
        };
      })()
    `);
    console.log('  Post-career-click state (should be career):', postCareerClickState);
    await takeScreenshot(client, 'heraldry_nav_jump_to_career_scope.png', { width: 1280, height: 950, mobile: false });

    // ── 6. PUBLIC PLAYER PROFILE: Desktop & Mobile ──
    console.log('\n=== [6/6] Public Player Profile: Insignia Cluster & Navigation ===');
    await client.eval(`
      if (typeof openPlayerProfilePage === 'function') {
        openPlayerProfilePage('p_dev_commander', '40k');
      } else if (window.PlayerProfile && window.PlayerProfile.showPublicProfile) {
        window.PlayerProfile.showPublicProfile('p_dev_commander', '40k');
      }
    `);
    await sleep(1500);

    const publicProfileCheck = await client.eval(`
      (() => {
        const cluster = document.querySelector('#view-player-profile .hero-insignia-cluster, .profile-hero-card .hero-insignia-cluster');
        const careerBtn = cluster ? cluster.querySelector('.career-crest-btn') : null;
        const seasonBtn = cluster ? cluster.querySelector('.seasonal-seal-btn') : null;
        return {
          clusterExists: !!cluster,
          careerBtnExists: !!careerBtn,
          seasonBtnExists: !!seasonBtn
        };
      })()
    `);
    console.log('  Public profile cluster check:', publicProfileCheck);

    await takeScreenshot(client, 'desktop_public_profile_heraldic_cluster.png', { width: 1280, height: 950, mobile: false });
    await takeScreenshot(client, 'mobile_public_profile_heraldic_cluster.png', { width: 412, height: 924, mobile: true });

    console.log('\n======================================================================');
    console.log('✨ HERALDIC INSIGNIA CLUSTER TESTS & SCREENSHOTS COMPLETED!');
    console.log('======================================================================');

  } finally {
    chrome.kill();
  }
}

runHeraldryTests().catch(err => {
  console.error('HERALDRY TEST ERROR:', err);
  process.exit(1);
});
