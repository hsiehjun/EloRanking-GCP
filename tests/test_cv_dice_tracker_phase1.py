import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import server


class TestCvDiceTrackerPhase1(unittest.TestCase):
    def test_permissions_policy_allows_camera_self(self):
        """Ensure server.py sets Permissions-Policy: camera=(self) so browser getUserMedia works."""
        server_py = (ROOT_DIR / "server.py").read_text(encoding="utf-8")
        self.assertIn(
            'response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=(self)"',
            server_py,
        )
        self.assertNotIn('response.headers["Permissions-Policy"] = "camera=()', server_py)

    def test_admin_dice_tracker_route_blocks_unauthenticated(self):
        """Unauthenticated requests to /admin/dice-tracker or /dice-tracker must redirect to /login."""
        mock_req = MagicMock()
        mock_req.headers = {}
        mock_req.cookies = {}
        mock_auth_mgr = MagicMock()
        mock_auth_mgr.get_session.return_value = None
        with patch.object(server, "get_auth_manager", return_value=mock_auth_mgr):
            resp = server.serve_admin_dice_tracker(mock_req, token=None)
            status_code = getattr(resp, "status_code", None)
            self.assertEqual(status_code, 303)
            url = getattr(resp, "url", None) or (getattr(resp, "headers", {}) or {}).get("location", "")
            self.assertTrue(
                str(url).startswith("/login?redirect="),
                f"Unexpected redirect location: {url}",
            )

    def test_admin_dice_tracker_route_blocks_non_admin_player(self):
        """Authenticated non-admin players must be redirected to /."""
        fake_player = {
            "user_id": "u_player_1",
            "email": "player@example.com",
            "display_name": "Regular Player",
            "role": "player",
            "is_admin": False,
        }
        mock_req = MagicMock()
        mock_req.headers = {}
        mock_req.cookies = {"session_token": "tok_player"}
        mock_auth_mgr = MagicMock()
        mock_auth_mgr.get_session.return_value = fake_player
        with patch.object(server, "get_auth_manager", return_value=mock_auth_mgr):
            resp = server.serve_admin_dice_tracker(mock_req, token=None)
            status_code = getattr(resp, "status_code", None)
            self.assertEqual(status_code, 303)
            url = getattr(resp, "url", None) or (getattr(resp, "headers", {}) or {}).get("location", "")
            self.assertEqual(str(url), "/")

    def test_admin_dice_tracker_route_serves_admin_and_static_assets(self):
        """Authenticated admin user can load /admin/dice-tracker and its static assets."""
        fake_admin = {
            "user_id": "u_admin_1",
            "email": "hsiehjun@gmail.com",
            "display_name": "Admin Hsiehjun",
            "role": "admin",
            "is_admin": True,
        }
        mock_req = MagicMock()
        mock_req.headers = {}
        mock_req.cookies = {"session_token": "tok_admin"}
        mock_auth_mgr = MagicMock()
        mock_auth_mgr.get_session.return_value = fake_admin
        with patch.object(server, "get_auth_manager", return_value=mock_auth_mgr):
            resp = server.serve_admin_dice_tracker(mock_req, token=None)
            dt_path = Path(str(getattr(resp, "path", "")))
            self.assertTrue(dt_path.is_file(), f"Expected FileResponse to index.html, got {dt_path}")
            html = dt_path.read_text(encoding="utf-8")
            self.assertIn("WarDice CV", html)
            self.assertIn('id="outputCanvas"', html)
            self.assertIn('id="chkScoopGuard"', html)
            self.assertIn('id="btnUndoLastRoll"', html)
            self.assertIn('id="btnSyncToTracker"', html)
            self.assertIn('id="rollerAttributionGroup"', html)
            self.assertIn('id="btnTorchToggle"', html)
            self.assertIn('id="camZoomSlider"', html)

        # Static asset handlers & files on disk
        js_resp = server.serve_dice_tracker_js()
        css_resp = server.serve_dice_tracker_css()
        manifest_resp = server.serve_dice_tracker_manifest()
        for file_resp, expected_name in [
            (js_resp, "app.js"),
            (css_resp, "styles.css"),
            (manifest_resp, "manifest.json"),
        ]:
            path_str = str(getattr(file_resp, "path", ""))
            self.assertTrue(path_str.endswith(expected_name), f"Expected {expected_name}, got {path_str}")
            self.assertTrue(Path(path_str).is_file(), f"Missing static asset on disk: {path_str}")

    def test_admin_entry_buttons_wired_in_frontend(self):
        """Verify Admin-only CV Dice Lab buttons exist in auth.js, app.html, admin.html, tracker_sync.js, and dev_server.py."""
        auth_js = (ROOT_DIR / "web" / "js" / "auth.js").read_text(encoding="utf-8")
        self.assertIn("header-admin-cv-dice-btn", auth_js)
        self.assertIn("/admin/dice-tracker", auth_js)
        self.assertIn("mobile-opt-dice-tracker", auth_js)

        app_html = (ROOT_DIR / "web" / "app.html").read_text(encoding="utf-8")
        self.assertIn('id="mobile-opt-dice-tracker"', app_html)
        self.assertIn('id="mobile-sheet-dice-tracker-btn"', app_html)
        self.assertIn("val === 'dice-tracker'", app_html)

        admin_html = (ROOT_DIR / "web" / "admin.html").read_text(encoding="utf-8")
        self.assertIn('href="/admin/dice-tracker"', admin_html)
        self.assertIn("CV Dice Lab", admin_html)

        tracker_sync = (ROOT_DIR / "web" / "tracker" / "tracker_sync.js").read_text(encoding="utf-8")
        self.assertIn("gt-admin-cv-dice-btn", tracker_sync)
        self.assertIn("/admin/dice-tracker", tracker_sync)

        dev_server = (ROOT_DIR / "scripts" / "dev_server.py").read_text(encoding="utf-8")
        self.assertIn("admin/dice-tracker", dev_server)
        self.assertIn("dice-tracker/app.js", dev_server)

    def test_cv_engine_accuracy_and_performance_in_node(self):
        """
        Execute web/dice_tracker/app.js in headless Node to verify:
        1. 100% ExactMatch across 10, 20, 30, 40 dice pools (with 0..45 deg rotations, 5 color schemes,
           standard 6-pip light dice, custom-6 emblems, and outside-tray distractors).
        2. Fix #1: 12 standard 6-pip light dice (customSix=false) -> 100% detected as twelve 6s.
        3. Fix #2: 45-degree rotated dice (faces 2, 3, 4, 5, 6) -> 100% detected without splitting.
        4. Fix #4: Stationary-Subset Scoop Guard suppresses duplicate roll lock when failed dice are removed
           from the tray, and Undo Last Roll cleanly reverts history & distribution counts.
        5. Fix #5: Dual-Player color attribution (P1 vs P2) + Game Tracker localStorage sync.
        6. Performance: Average CV frame time < 15.0 ms on 640x480 frames.
        """
        node_script = r"""
const fs = require('fs');
const { performance } = require('perf_hooks');

class OffscreenCanvas2D {
  constructor(width = 640, height = 480) {
    this.width = width;
    this.height = height;
    this.clientWidth = width;
    this.clientHeight = height;
    this.buf = new Uint8ClampedArray(width * height * 4);
    this.style = {};
    this._ctx = new OffscreenContext2D(this);
  }
  getContext(type) { return this._ctx; }
  addEventListener() {}
  getBoundingClientRect() { return { width: this.width, height: this.height, left: 0, top: 0 }; }
}

class OffscreenContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.lineWidth = 1;
    this.font = '12px sans-serif';
    this.textAlign = 'left';
    this._stack = [];
    this._tx = 0;
    this._ty = 0;
    this._rot = 0;
    this._path = [];
  }
  save() {
    this._stack.push({
      fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth,
      tx: this._tx, ty: this._ty, rot: this._rot
    });
  }
  restore() {
    const s = this._stack.pop();
    if (s) {
      this.fillStyle = s.fillStyle; this.strokeStyle = s.strokeStyle; this.lineWidth = s.lineWidth;
      this._tx = s.tx; this._ty = s.ty; this._rot = s.rot;
    }
  }
  translate(x, y) {
    const cos = Math.cos(this._rot), sin = Math.sin(this._rot);
    this._tx += x * cos - y * sin;
    this._ty += x * sin + y * cos;
  }
  rotate(angle) { this._rot += angle; }
  clearRect(x, y, w, h) { this.canvas.buf.fill(0); }
  createRadialGradient() { return { addColorStop() {} }; }
  setLineDash() {}
  fillText() {}
  strokeRect() {}
  drawImage(srcCanvas) {
    if (srcCanvas && srcCanvas.buf) {
      this.canvas.buf.set(srcCanvas.buf);
    }
  }
  parseColor(c) {
    if (!c || typeof c !== 'string') return [30, 41, 59, 255];
    c = c.trim();
    if (c.startsWith('#')) {
      const hex = c.slice(1);
      if (hex.length === 3) {
        return [parseInt(hex[0]+hex[0],16), parseInt(hex[1]+hex[1],16), parseInt(hex[2]+hex[2],16), 255];
      }
      return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16), 255];
    }
    if (c.startsWith('rgba')) {
      const m = c.match(/[\d.]+/g);
      return m ? [Number(m[0]), Number(m[1]), Number(m[2]), Math.round(Number(m[3])*255)] : [0,0,0,255];
    }
    return [30, 41, 59, 255];
  }
  _setPixel(px, py, rgba) {
    const w = this.canvas.width, h = this.canvas.height;
    if (px < 0 || px >= w || py < 0 || py >= h) return;
    const idx = (py * w + px) * 4;
    const a = rgba[3] / 255;
    if (a >= 0.99) {
      this.canvas.buf[idx] = rgba[0];
      this.canvas.buf[idx+1] = rgba[1];
      this.canvas.buf[idx+2] = rgba[2];
      this.canvas.buf[idx+3] = 255;
    } else if (a > 0) {
      this.canvas.buf[idx] = Math.round(rgba[0]*a + this.canvas.buf[idx]*(1-a));
      this.canvas.buf[idx+1] = Math.round(rgba[1]*a + this.canvas.buf[idx+1]*(1-a));
      this.canvas.buf[idx+2] = Math.round(rgba[2]*a + this.canvas.buf[idx+2]*(1-a));
      this.canvas.buf[idx+3] = 255;
    }
  }
  fillRect(x, y, w, h) {
    const rgba = this.parseColor(this.fillStyle);
    if (this._rot === 0 && this._tx === 0 && this._ty === 0) {
      const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(this.canvas.width, Math.ceil(x + w)), y1 = Math.min(this.canvas.height, Math.ceil(y + h));
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) this._setPixel(px, py, rgba);
      }
      return;
    }
    this.beginPath();
    this.roundRect(x, y, w, h, 0);
    this.fill();
  }
  beginPath() { this._path = []; }
  roundRect(x, y, w, h, r) { this._path.push({ type: 'rect', x, y, w, h, r: r || 0 }); }
  arc(x, y, r) { this._path.push({ type: 'arc', x, y, r }); }
  moveTo(x, y) { this._path.push({ type: 'move', x, y }); }
  lineTo(x, y) { this._path.push({ type: 'line', x, y }); }
  closePath() {}
  fill() {
    const rgba = this.parseColor(this.fillStyle);
    const cos = Math.cos(this._rot), sin = Math.sin(this._rot);
    for (const p of this._path) {
      if (p.type === 'rect') {
        for (let ly = p.y; ly <= p.y + p.h; ly += 0.5) {
          for (let lx = p.x; lx <= p.x + p.w; lx += 0.5) {
            const wx = Math.round(this._tx + lx * cos - ly * sin);
            const wy = Math.round(this._ty + lx * sin + ly * cos);
            this._setPixel(wx, wy, rgba);
          }
        }
      } else if (p.type === 'arc') {
        const r2 = p.r * p.r;
        for (let dy = -p.r; dy <= p.r; dy += 0.5) {
          for (let dx = -p.r; dx <= p.r; dx += 0.5) {
            if (dx*dx + dy*dy <= r2) {
              const lx = p.x + dx, ly = p.y + dy;
              const wx = Math.round(this._tx + lx * cos - ly * sin);
              const wy = Math.round(this._ty + lx * sin + ly * cos);
              this._setPixel(wx, wy, rgba);
            }
          }
        }
      }
    }
  }
  stroke() {
    const rgba = this.parseColor(this.strokeStyle);
    const cos = Math.cos(this._rot), sin = Math.sin(this._rot);
    for (const p of this._path) {
      if (p.type === 'rect') {
        for (let lx = p.x; lx <= p.x + p.w; lx += 1) {
          for (const ly of [p.y, p.y + p.h]) {
            const wx = Math.round(this._tx + lx * cos - ly * sin);
            const wy = Math.round(this._ty + lx * sin + ly * cos);
            this._setPixel(wx, wy, rgba);
          }
        }
        for (let ly = p.y; ly <= p.y + p.h; ly += 1) {
          for (const lx of [p.x, p.x + p.w]) {
            const wx = Math.round(this._tx + lx * cos - ly * sin);
            const wy = Math.round(this._ty + lx * sin + ly * cos);
            this._setPixel(wx, wy, rgba);
          }
        }
      }
    }
  }
  getImageData(x, y, w, h) {
    return { data: new Uint8ClampedArray(this.canvas.buf), width: w, height: h };
  }
}

const defaultValues = {
  thresholdSlider: '22',
  bgFilterSlider: '12',
  minDiceSize: '22',
  targetSuccess: '4',
  diceColorMode: 'auto',
  p1SchemeSelect: 'bone_black',
  p2SchemeSelect: 'crimson_gold'
};

function makeEl(id) {
  if (id === 'outputCanvas' || id === 'distributionChart') return new OffscreenCanvas2D(640, 480);
  return {
    id,
    style: {},
    value: defaultValues[id] || '0',
    checked: true,
    innerText: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){},
    appendChild(){},
    getBoundingClientRect() { return { width: 640, height: 480, left: 0, top: 0 }; },
    querySelectorAll() { return []; }
  };
}

const elCache = {};
const store = {};
global.window = {
  location: { search: '' },
  addEventListener() {},
  requestAnimationFrame() {},
  localStorage: {
    getItem(k) { return store[k] || null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  }
};
global.localStorage = global.window.localStorage;
global.navigator = { vibrate() {} };
global.document = {
  getElementById(id) {
    if (!elCache[id]) elCache[id] = makeEl(id);
    return elCache[id];
  },
  querySelectorAll() { return []; },
  createElement(tag) {
    if (tag === 'canvas') return new OffscreenCanvas2D(640, 480);
    return makeEl(tag);
  },
  addEventListener() {}
};

const appCode = fs.readFileSync('web/dice_tracker/app.js', 'utf8');
eval(appCode + '\nglobal.DiceTrackerApp = DiceTrackerApp;');

const app = new DiceTrackerApp();
app.isSimulationMode = true;

// 1. Multi-pool benchmark (10, 20, 30, 40 dice with rotations, custom6, all 5 color schemes, and distractors)
const poolResults = {};
const schemeCycle = ['bone_black', 'crimson_gold', 'cobalt_white', 'deathguard_green', 'black_white'];
const angleCycle = [0, Math.PI / 12, Math.PI / 6, Math.PI / 4];

let totalTimingMs = 0;
let totalTimingFrames = 0;

for (const poolSize of [10, 20, 30, 40]) {
  const cols = poolSize <= 12 ? 4 : (poolSize <= 24 ? 6 : 8);
  const rows = Math.ceil(poolSize / cols);
  const rx = Math.floor(640 * app.roiBox.x);
  const ry = Math.floor(480 * app.roiBox.y);
  const rw = Math.floor(640 * app.roiBox.w);
  const rh = Math.floor(480 * app.roiBox.h);
  const padX = 24, padY = 30;
  const cellW = (rw - padX * 2) / cols;
  const cellH = (rh - padY * 2) / Math.max(3, rows);
  const dieSize = Math.min(38, Math.floor(Math.min(cellW, cellH) * 0.72));

  app.simDiceObjects = [];
  const gtCounts = {1:0, 2:0, 3:0, 4:0, 5:0, 6:0};
  for (let i = 0; i < poolSize; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const val = (i % 6) + 1;
    gtCounts[val]++;
    const tx = Math.round(rx + padX + c * cellW + (cellW - dieSize) * 0.5);
    const ty = Math.round(ry + padY + r * cellH + (cellH - dieSize) * 0.5);
    app.simDiceObjects.push({
      startX: tx, startY: ty, targetX: tx, targetY: ty, x: tx, y: ty,
      size: dieSize,
      value: val,
      angle: angleCycle[i % angleCycle.length],
      style: schemeCycle[i % schemeCycle.length],
      customSix: (i % 12 === 5)
    });
  }
  // 4 outside-tray distractors
  app.simDistractorDice = [
    { x: 6, y: 8, size: 32, value: 6, style: 'bone_black', customSix: false, angle: 0 },
    { x: 6, y: 438, size: 32, value: 5, style: 'crimson_gold', customSix: false, angle: 0 },
    { x: 598, y: 8, size: 32, value: 4, style: 'cobalt_white', customSix: false, angle: 0 },
    { x: 598, y: 438, size: 32, value: 3, style: 'black_white', customSix: false, angle: 0 }
  ];

  app.renderSimTrayFrame(false, 1.0);
  app.ctx.drawImage(app.simCanvas, 0, 0);
  const frameData = app.ctx.getImageData(0, 0, 640, 480);

  if (poolSize === 10) {
    for (let w = 0; w < 3; w++) app.detectRealDice(frameData, 640, 480);
  }

  const t0 = performance.now();
  let detected = null;
  const iters = 10;
  for (let k = 0; k < iters; k++) {
    detected = app.detectRealDice(frameData, 640, 480);
  }
  const avgMs = (performance.now() - t0) / iters;
  totalTimingMs += avgMs;
  totalTimingFrames += 1;

  const detCounts = {1:0, 2:0, 3:0, 4:0, 5:0, 6:0};
  for (const d of detected) detCounts[d.value]++;
  const exactMatch = [1,2,3,4,5,6].every(v => gtCounts[v] === detCounts[v]);
  poolResults[poolSize] = { detectedCount: detected.length, exactMatch, avgMs, gtCounts, detCounts };
}

// 2. Fix #1: 12 standard 6-pip light dice (customSix: false)
app.simDistractorDice = [];
app.simDiceObjects = [];
for (let i = 0; i < 12; i++) {
  const r = Math.floor(i / 4), c = i % 4;
  const tx = 110 + c * 115, ty = 95 + r * 115;
  app.simDiceObjects.push({
    startX: tx, startY: ty, targetX: tx, targetY: ty, x: tx, y: ty,
    size: 38,
    value: 6,
    angle: angleCycle[i % angleCycle.length],
    style: 'bone_black',
    customSix: false
  });
}
app.renderSimTrayFrame(false, 1.0);
app.ctx.drawImage(app.simCanvas, 0, 0);
const sixesDet = app.detectRealDice(app.ctx.getImageData(0, 0, 640, 480), 640, 480);
const allTwelveSixes = sixesDet.length === 12 && sixesDet.every(d => d.value === 6);

// 3. Fix #2: 45-degree rotated dice across faces 2..6
app.simDiceObjects = [];
const rotExpected = {1:0, 2:0, 3:0, 4:0, 5:0, 6:0};
for (let i = 0; i < 10; i++) {
  const r = Math.floor(i / 4), c = i % 4;
  const val = (i % 5) + 2; // 2, 3, 4, 5, 6
  rotExpected[val]++;
  const tx = 110 + c * 115, ty = 95 + r * 115;
  app.simDiceObjects.push({
    startX: tx, startY: ty, targetX: tx, targetY: ty, x: tx, y: ty,
    size: 38,
    value: val,
    angle: Math.PI / 4, // 45 degrees
    style: schemeCycle[i % schemeCycle.length],
    customSix: false
  });
}
app.renderSimTrayFrame(false, 1.0);
app.ctx.drawImage(app.simCanvas, 0, 0);
const rotDet = app.detectRealDice(app.ctx.getImageData(0, 0, 640, 480), 640, 480);
const rotCounts = {1:0, 2:0, 3:0, 4:0, 5:0, 6:0};
for (const d of rotDet) rotCounts[d.value]++;
const rotExactMatch = [1,2,3,4,5,6].every(v => rotExpected[v] === rotCounts[v]);

// 4. Fix #4 & #5: Scoop Guard + Undo Last Roll + Dual-Player Attribution + Tracker Sync
app.resetStats();
const initialTenDice = [
  { x: 120, y: 100, w: 36, h: 36, value: 6, owner: 1 },
  { x: 220, y: 100, w: 36, h: 36, value: 5, owner: 1 },
  { x: 320, y: 100, w: 36, h: 36, value: 4, owner: 1 },
  { x: 420, y: 100, w: 36, h: 36, value: 6, owner: 1 },
  { x: 120, y: 200, w: 36, h: 36, value: 4, owner: 1 },
  { x: 220, y: 200, w: 36, h: 36, value: 5, owner: 1 },
  // 4 failed dice (1s and 2s) that player will scoop out
  { x: 320, y: 200, w: 36, h: 36, value: 1, owner: 1 },
  { x: 420, y: 200, w: 36, h: 36, value: 2, owner: 1 },
  { x: 120, y: 300, w: 36, h: 36, value: 1, owner: 1 },
  { x: 220, y: 300, w: 36, h: 36, value: 2, owner: 1 }
];

const dummyRgba = new Uint8ClampedArray(640 * 480 * 4);
// Feed 12 frames of stationary initialTenDice to lock Roll #1
app.rollState = 'IDLE';
for (let f = 0; f < 12; f++) {
  app.stepRollStateMachine(0.0, initialTenDice, dummyRgba, 640, 480);
}
const historyAfterRoll1 = app.history.length;

// Simulate hand motion entering tray to scoop out the 4 failed dice
const remainingSixStationary = initialTenDice.slice(0, 6);
app.stepRollStateMachine(0.05, remainingSixStationary, dummyRgba, 640, 480);
const scoopDetected = app.isStationaryScoopSubset(remainingSixStationary);

// Now feed 15 frames of the stationary 6-die subset after hand leaves tray
for (let f = 0; f < 15; f++) {
  app.stepRollStateMachine(0.0, remainingSixStationary, dummyRgba, 640, 480);
}
const historyAfterScoop = app.history.length;

// Now simulate a genuine Roll #2 with 4 P2 dice at new positions
const secondRollP2 = [
  { x: 180, y: 150, w: 36, h: 36, value: 6, owner: 2 },
  { x: 280, y: 150, w: 36, h: 36, value: 6, owner: 2 },
  { x: 380, y: 150, w: 36, h: 36, value: 3, owner: 2 },
  { x: 480, y: 150, w: 36, h: 36, value: 1, owner: 2 }
];
app.currentDetectedDice = secondRollP2;
app.captureCurrentRoll("Auto-Lock");
const historyAfterRoll2 = app.history.length;
const roll2PlayerNum = app.history[0].player_num;
const totalDiceBeforeUndo = app.distribution.slice(1).reduce((a, b) => a + b, 0);

// Test Sync to Game Tracker localStorage ('gt-dice-history-v2')
app.syncToGameTrackerLocalHistory();
const syncedGtRaw = global.localStorage.getItem('gt-dice-history-v2');
const syncedGt = syncedGtRaw ? JSON.parse(syncedGtRaw) : [];

// Test Undo Last Roll
app.undoLastRoll();
const historyAfterUndo = app.history.length;
const totalDiceAfterUndo = app.distribution.slice(1).reduce((a, b) => a + b, 0);

console.log(JSON.stringify({
  poolResults,
  avgFrameMs: totalTimingMs / totalTimingFrames,
  allTwelveSixes,
  rotExactMatch,
  scoopDetected,
  historyAfterRoll1,
  historyAfterScoop,
  historyAfterRoll2,
  roll2PlayerNum,
  totalDiceBeforeUndo,
  historyAfterUndo,
  totalDiceAfterUndo,
  syncedGtCount: syncedGt.length,
  syncedGtFirstSource: syncedGt[0] ? syncedGt[0].source : null
}));
"""
        proc = subprocess.run(
            ["node", "-e", node_script],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True,
            check=True,
        )
        result = json.loads(proc.stdout.strip().splitlines()[-1])

        # 1. Verify 10, 20, 30, 40 dice pools have 100% ExactMatch and 0 distractor leaks
        for size_str in ("10", "20", "30", "40"):
            pool_res = result["poolResults"][size_str]
            self.assertEqual(
                pool_res["detectedCount"],
                int(size_str),
                f"Pool size {size_str} count mismatch: {pool_res}",
            )
            self.assertTrue(
                pool_res["exactMatch"],
                f"Pool size {size_str} face histogram mismatch: {pool_res}",
            )

        # 2. Verify Fix #1 (12 standard 6-pip light dice)
        self.assertTrue(result["allTwelveSixes"], "Standard 6-pip light dice failed 100% 6-detection")

        # 3. Verify Fix #2 (45-deg rotated dice)
        self.assertTrue(result["rotExactMatch"], "45-degree rotated dice failed exact match")

        # 4. Verify Fix #4 (Scoop Guard + Undo Last Roll)
        self.assertTrue(result["scoopDetected"], "isStationaryScoopSubset should detect stationary subset")
        self.assertEqual(result["historyAfterRoll1"], 1)
        self.assertEqual(
            result["historyAfterScoop"],
            1,
            "Scoop Guard failed: scooping failed dice triggered a duplicate roll lock!",
        )
        self.assertEqual(result["historyAfterRoll2"], 2)
        self.assertEqual(result["roll2PlayerNum"], 2)
        self.assertEqual(result["totalDiceBeforeUndo"], 14)
        self.assertEqual(result["historyAfterUndo"], 1)
        self.assertEqual(result["totalDiceAfterUndo"], 10)

        # 5. Verify Fix #5 (Sync to Game Tracker localStorage)
        self.assertEqual(result["syncedGtCount"], 2)
        self.assertEqual(result["syncedGtFirstSource"], "cv_camera")

        # 6. Verify Performance (< 15ms per 640x480 frame)
        self.assertLess(
            result["avgFrameMs"],
            15.0,
            f"CV frame detection exceeded 15ms budget: {result['avgFrameMs']:.2f}ms",
        )


if __name__ == "__main__":
    unittest.main()
