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
            self.assertIn("ort.min.js", html)
            self.assertNotIn('id="btnCalibrateBg"', html)

        # Static asset handlers & files on disk
        js_resp = server.serve_dice_tracker_js()
        css_resp = server.serve_dice_tracker_css()
        manifest_resp = server.serve_dice_tracker_manifest()
        onnx_resp = server.serve_dice_tracker_onnx()
        for file_resp, expected_name in [
            (js_resp, "app.js"),
            (css_resp, "styles.css"),
            (manifest_resp, "manifest.json"),
            (onnx_resp, "yolov8n_dice.onnx"),
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

// Test Anti-Flicker: Empty-tray camera shake + transient 1-2 frame noise specks must stay IDLE
app.rollState = 'IDLE';
app.consecutiveDiceFrames = 0;
const statesDuringEmptyShake = [];
for (let f = 0; f < 15; f++) {
  app.stepRollStateMachine(0.06, [], dummyRgba, 640, 480);
  statesDuringEmptyShake.push(app.rollState);
}
// 2 frames of a transient noise blob with motion, followed by empty tray
app.stepRollStateMachine(0.05, [{ x: 200, y: 200, w: 30, h: 30, value: 1 }], dummyRgba, 640, 480);
statesDuringEmptyShake.push(app.rollState);
app.stepRollStateMachine(0.05, [{ x: 200, y: 200, w: 30, h: 30, value: 1 }], dummyRgba, 640, 480);
statesDuringEmptyShake.push(app.rollState);
app.stepRollStateMachine(0.02, [], dummyRgba, 640, 480);
statesDuringEmptyShake.push(app.rollState);
const antiFlickerStayedIdle = statesDuringEmptyShake.every(s => s === 'IDLE');

// 7. Test YOLOv8n ONNX Preprocessor & Decoder (NMS + ROI Filtering + Value Classification)
const onnxTensor = app.preprocessFrameForYoloOnnx(dummyRgba, 640, 480);
const onnxTensorLen = onnxTensor.length;
const onnxPadValOk = Math.abs(onnxTensor[0] - (114.0 / 255.0)) < 1e-4;

// Construct synthetic [1, 10, 8400] YOLOv8n output tensor with:
// - Anchor 100: Die 1 (value=5, class=4, conf=0.80) at (212, 254+80)
// - Anchor 101: Duplicate overlapping anchor on Die 1 (value=5, conf=0.62) -> must be suppressed by NMS!
// - Anchor 200: Die 2 (value=1, class=0, conf=0.83) at (438, 217+80)
// - Anchor 300: Die 3 (value=4, class=3, conf=0.77) at (309, 358+80)
// - Anchor 400: Outside-ROI distractor die (value=6, class=5, conf=0.91) at (12, 18+80) -> must be rejected by ROI!
const numAnchors = 8400;
const fakeYoloOut = new Float32Array(10 * numAnchors);
function setYoloAnchor(idx, cx, cy480, bw, bh, classIdx, conf) {
  fakeYoloOut[0 * numAnchors + idx] = cx;
  fakeYoloOut[1 * numAnchors + idx] = cy480 + 80; // letterbox padTop=80
  fakeYoloOut[2 * numAnchors + idx] = bw;
  fakeYoloOut[3 * numAnchors + idx] = bh;
  fakeYoloOut[(4 + classIdx) * numAnchors + idx] = conf;
}
setYoloAnchor(100, 212, 254, 42, 46, 4, 0.80); // value 5
setYoloAnchor(101, 214, 255, 41, 45, 4, 0.62); // duplicate overlapping anchor -> suppressed by NMS
setYoloAnchor(200, 438, 217, 37, 41, 0, 0.83); // value 1
setYoloAnchor(300, 309, 358, 35, 40, 3, 0.77); // value 4
setYoloAnchor(400, 12, 18, 36, 36, 5, 0.91);   // outside ROI -> rejected

app.roiBox = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
const rx = Math.max(8, Math.floor(640 * app.roiBox.x));
const ry = Math.max(8, Math.floor(480 * app.roiBox.y));
const rw = Math.min(640 - rx - 8, Math.floor(640 * app.roiBox.w));
const rh = Math.min(480 - ry - 8, Math.floor(480 * app.roiBox.h));

const onnxDecoded = app.decodeYoloOnnxOutput(fakeYoloOut, dummyRgba, 640, 480, rx, ry, rw, rh, 0.45);
const onnxCount = onnxDecoded.length;
const onnxSum = onnxDecoded.reduce((a, d) => a + d.value, 0);
const onnxFaces = onnxDecoded.map(d => d.value).sort((a, b) => a - b).join(',');

// 8. Test Real Mobile Un-Squished Camera Feed: 3 Translucent/Colored Dice ([5, 1, 4], sum=10)
// on Grey Neoprene Mat (lum 65..95 with fabric glints up to 118) + Black Tray Rim + Bright Beige Table (lum 192)
const transCamBuf = new Uint8ClampedArray(640 * 480 * 4);
for (let y = 0; y < 480; y++) {
  for (let x = 0; x < 640; x++) {
    const idx = (y * 640 + x) * 4;
    let lum = 72;
    if (x < 145 || x > 495) {
      lum = 192; // Bright beige exterior table
    } else if (x < 172 || x > 470) {
      lum = 28; // Black leather/neoprene tray wall
    } else {
      // Grey neoprene mat with local fabric texture/glints (64..115)
      lum = 68 + ((x * 13 + y * 7) % 18) + (x % 29 === 0 && y % 31 === 0 ? 26 : 0);
    }
    transCamBuf[idx] = lum; transCamBuf[idx+1] = lum; transCamBuf[idx+2] = lum; transCamBuf[idx+3] = 255;
  }
}
function paintTranslucentDie(buf, cx, cy, pips, hasSideShadowPip = false) {
  for (let dy = -15; dy <= 15; dy++) {
    for (let dx = -15; dx <= 15; dx++) {
      const idx = ((cy + dy) * 640 + (cx + dx)) * 4;
      const bodyLum = dy > 13 ? 26 : 168; // 3D shadow edge at bottom
      buf[idx] = bodyLum - 25; buf[idx+1] = bodyLum; buf[idx+2] = bodyLum + 18;
    }
  }
  for (const [ox, oy] of pips) {
    const px = cx + ox, py = cy + oy;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > 16) continue;
        // Subsurface scattering halo (218) + bright white 3x3 core (248..255)
        const lum = d2 === 0 ? 254 : (d2 <= 2 ? 250 : (d2 <= 5 ? 236 : 218));
        const idx = ((py + dy) * 640 + (px + dx)) * 4;
        if (lum > buf[idx+1]) {
          buf[idx] = lum; buf[idx+1] = lum; buf[idx+2] = lum;
        }
      }
    }
  }
  if (hasSideShadowPip) {
    // Dimmer 3D side-face pip right on bottom shadow edge (must be rejected)
    const sx = cx - 8, sy = cy + 13;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const idx = ((sy + dy) * 640 + (sx + dx)) * 4;
        const lum = dx === 0 && dy === 0 ? 221 : 204;
        buf[idx] = lum; buf[idx+1] = lum; buf[idx+2] = lum;
      }
    }
  }
}
// Die A = 5 (rotated 45 deg diamond at 211, 249)
paintTranslucentDie(transCamBuf, 211, 249, [[0,-8],[-8,0],[0,0],[8,0],[0,9]], false);
// Die B = 1 (at 439, 213 with 3D side-face pip on shadow edge)
paintTranslucentDie(transCamBuf, 439, 213, [[0,0]], true);
// Die C = 4 (at 310, 356)
paintTranslucentDie(transCamBuf, 310, 356, [[-6,-7],[5,-7],[-6,6],[5,6]], false);

const transCamDet = app.detectRealDice({ data: transCamBuf, width: 640, height: 480 }, 640, 480);
const transCamSum = transCamDet.reduce((a, d) => a + d.value, 0);
const transCamFaces = transCamDet.map(d => d.value).sort((a, b) => a - b).join(',');

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
  syncedGtFirstSource: syncedGt[0] ? syncedGt[0].source : null,
  antiFlickerStayedIdle,
  onnxTensorLen,
  onnxPadValOk,
  onnxCount,
  onnxSum,
  onnxFaces,
  transCamCount: transCamDet.length,
  transCamSum,
  transCamFaces
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

        # 6. Verify Anti-Flicker (Empty tray shake + transient 1-2 frame specks stay IDLE)
        self.assertTrue(
            result["antiFlickerStayedIdle"],
            "State machine flickered out of IDLE during empty tray shake or 1-2 frame transient noise!",
        )

        # 7. Verify YOLOv8n ONNX Preprocessor & Decoder (NMS + ROI Filtering)
        self.assertEqual(result["onnxTensorLen"], 3 * 640 * 640)
        self.assertTrue(result["onnxPadValOk"])
        self.assertEqual(result["onnxCount"], 3)
        self.assertEqual(result["onnxSum"], 10)
        self.assertEqual(result["onnxFaces"], "1,4,5")

        # 8. Verify Real Mobile Camera Translucent/Colored Dice on Grey Neoprene Mat ([1,4,5], sum=10, 0 false positives)
        self.assertEqual(result["transCamCount"], 3)
        self.assertEqual(result["transCamSum"], 10)
        self.assertEqual(result["transCamFaces"], "1,4,5")

        # 9. Verify Performance (< 15ms per 640x480 frame)
        self.assertLess(
            result["avgFrameMs"],
            15.0,
            f"CV frame detection exceeded 15ms budget: {result['avgFrameMs']:.2f}ms",
        )

    def test_yolov8n_onnx_model_and_dead_code_cleanup(self):
        """Verify yolov8n_dice.onnx model exists and dead/obsolete code was removed from app.js."""
        onnx_path = ROOT_DIR / "web" / "dice_tracker" / "yolov8n_dice.onnx"
        self.assertTrue(onnx_path.is_file(), f"Missing yolov8n_dice.onnx at {onnx_path}")
        self.assertGreater(onnx_path.stat().st_size, 10_000_000, "yolov8n_dice.onnx should be >10MB")

        app_js = (ROOT_DIR / "web" / "dice_tracker" / "app.js").read_text(encoding="utf-8")
        self.assertIn("initOnnxModel", app_js)
        self.assertIn("preprocessFrameForYoloOnnx", app_js)
        self.assertIn("decodeYoloOnnxOutput", app_js)
        self.assertIn("runLiveOnnxPass", app_js)
        self.assertIn("computeRoiGrayAndSat", app_js)
        self.assertIn("sampleDieBodyRgb", app_js)

        # Verify obsolete/dead code is completely removed
        self.assertNotIn("calibrateEmptyTray", app_js)
        self.assertNotIn("emptyTrayBg", app_js)
        self.assertNotIn("btnCalibrateBg", app_js)
        self.assertNotIn("Stage 1C", app_js)
        self.assertNotIn("invInnerArea", app_js)
        self.assertNotIn("invQuadArea", app_js)

    def test_mobile_responsive_layout_and_zero_overflow(self):
        """Verify styles.css uses minmax(0, 1fr), min-width: 0, fixed-height state-machine-bar, and mobile history cards."""
        css_text = (ROOT_DIR / "web" / "dice_tracker" / "styles.css").read_text(encoding="utf-8")
        self.assertEqual(css_text.count("{"), css_text.count("}"), "Unbalanced braces in web/dice_tracker/styles.css")
        self.assertIn("grid-template-columns: minmax(0, 1fr)", css_text)
        self.assertIn("MOBILE CAMERA-FIRST ERGONOMICS", css_text)
        self.assertIn(".vision-card > .viewfinder-container", css_text)
        self.assertIn(".history-table tr.history-row", css_text)
        self.assertIn("height: 54px;", css_text)

        app_js = (ROOT_DIR / "web" / "dice_tracker" / "app.js").read_text(encoding="utf-8")
        self.assertIn("const canvasAspect = this.canvas.width / this.canvas.height;", app_js)
        self.assertIn("const videoAspect = vw / vh;", app_js)

    def test_zero_lag_camera_onnx_roll_lifecycle_and_unobstructed_roi_box(self):
        """
        Verify:
        1. #hudBadge is outside #viewfinder and styled position: static so nothing covers the green ROI box.
        2. Live camera ONNX roll lifecycle runs 0 ONNX passes during IDLE, ROLLING, and LOCKED states,
           and runs exactly 1 ONNX pass when dice finish settling, automatically accumulating each roll set.
        """
        html_text = (ROOT_DIR / "web" / "dice_tracker" / "index.html").read_text(encoding="utf-8")
        css_text = (ROOT_DIR / "web" / "dice_tracker" / "styles.css").read_text(encoding="utf-8")
        viewfinder_idx = html_text.index('id="viewfinder"')
        viewfinder_end = html_text.index("</div>", html_text.index('id="scannerOverlay"')) + 6
        hud_idx = html_text.index('id="hudBadge"')
        self.assertGreater(
            hud_idx,
            viewfinder_end,
            "#hudBadge must be placed outside #viewfinder so it never covers the green ROI box!",
        )
        self.assertIn("position: static;", css_text)

        node_script = r"""
const fs = require('fs');
class DummyCanvas {
  constructor() { this.width = 640; this.height = 480; }
  getContext() {
    return {
      fillRect(){}, strokeRect(){}, beginPath(){}, arc(){}, fill(){}, stroke(){},
      setLineDash(){}, fillText(){}, clearRect(){}, save(){}, restore(){}, moveTo(){}, lineTo(){},
      getImageData() { return { data: new Uint8ClampedArray(640*480*4) }; }
    };
  }
  addEventListener(){}
  getBoundingClientRect() { return { width: 640, height: 480, left: 0, top: 0 }; }
}
function makeEl(id) {
  if (id === 'outputCanvas' || id === 'distributionChart') return new DummyCanvas();
  return {
    id, style: {}, value: id === 'bgFilterSlider' ? '10' : '4', checked: true,
    innerText: '', innerHTML: '', disabled: false,
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, appendChild(){}, querySelectorAll(){ return []; }
  };
}
const els = {};
global.window = { addEventListener(){}, localStorage: { getItem(){ return null; }, setItem(){} } };
global.localStorage = global.window.localStorage;
global.navigator = {};
global.document = {
  getElementById(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; },
  createElement(t) { return t === 'canvas' ? new DummyCanvas() : makeEl(t); },
  addEventListener(){}
};
eval(fs.readFileSync('web/dice_tracker/app.js', 'utf8') + '\nglobal.DiceTrackerApp = DiceTrackerApp;');

(async () => {
  const app = new DiceTrackerApp();
  app.isCameraRunning = true;
  app.onnxReady = true;
  let onnxCalls = 0;
  let nextMockDice = [];
  app.runLiveOnnxPass = async () => {
    onnxCalls++;
    app.latestOnnxDice = nextMockDice;
  };

  const dummyData = new Uint8ClampedArray(640 * 480 * 4);
  // 1. 20 frames of IDLE -> 0 ONNX calls
  for (let i = 0; i < 20; i++) {
    app.stepCameraOnnxRollLifecycle(0.0, dummyData, 640, 480, 50, 40, 540, 400);
  }
  const callsAfterIdle = onnxCalls;

  // 2. Roll #1: 8 frames of ROLLING (motion=0.06) -> 0 ONNX calls while dice are tumbling
  for (let i = 0; i < 8; i++) {
    app.stepCameraOnnxRollLifecycle(0.06, dummyData, 640, 480, 50, 40, 540, 400);
  }
  const callsDuringRolling = onnxCalls;

  // 3. Dice stop rolling: 10 frames of stillness -> triggers exactly 1 ONNX pass on frame 10
  nextMockDice = [
    { x: 150, y: 150, w: 36, h: 36, value: 6, owner: 1 },
    { x: 250, y: 150, w: 36, h: 36, value: 4, owner: 1 },
    { x: 350, y: 150, w: 36, h: 36, value: 2, owner: 1 }
  ];
  for (let i = 0; i < 10; i++) {
    app.stepCameraOnnxRollLifecycle(0.0, dummyData, 640, 480, 50, 40, 540, 400);
  }
  await new Promise(r => setTimeout(r, 10));
  const callsAfterRoll1Lock = onnxCalls;
  const historyAfterRoll1 = app.history.length;

  // 4. 30 frames of LOCKED waiting for next roll -> 0 extra ONNX calls
  for (let i = 0; i < 30; i++) {
    app.stepCameraOnnxRollLifecycle(0.0, dummyData, 640, 480, 50, 40, 540, 400);
  }
  const callsDuringLockedWait = onnxCalls;

  // 5. Roll #2: 5 frames of ROLLING -> 10 frames of stillness -> triggers 1 ONNX pass & adds Roll #2
  nextMockDice = [
    { x: 180, y: 220, w: 36, h: 36, value: 5, owner: 1 },
    { x: 280, y: 220, w: 36, h: 36, value: 6, owner: 1 }
  ];
  for (let i = 0; i < 5; i++) {
    app.stepCameraOnnxRollLifecycle(0.06, dummyData, 640, 480, 50, 40, 540, 400);
  }
  for (let i = 0; i < 10; i++) {
    app.stepCameraOnnxRollLifecycle(0.0, dummyData, 640, 480, 50, 40, 540, 400);
  }
  await new Promise(r => setTimeout(r, 10));
  const callsAfterRoll2Lock = onnxCalls;
  const historyAfterRoll2 = app.history.length;
  const totalCumulativeDice = app.distribution.slice(1).reduce((a, b) => a + b, 0);

  // 6. Single-die roll test: 1 single 36x36px die moving inside 540x400 ROI triggers >0.018 localized patch motion
  //    and is never suppressed by Scoop Guard even when landing near a previous die of the same value!
  const frameA = new Uint8ClampedArray(640 * 480 * 4);
  const frameB = new Uint8ClampedArray(640 * 480 * 4);
  for (let i = 0; i < frameA.length; i += 4) {
    frameA[i] = 35; frameA[i + 1] = 40; frameA[i + 2] = 48; frameA[i + 3] = 255;
    frameB[i] = 35; frameB[i + 1] = 40; frameB[i + 2] = 48; frameB[i + 3] = 255;
  }
  // Draw 1 single 32x32 bone-white die in frameB at (220, 200)
  for (let y = 200; y < 232; y++) {
    for (let x = 220; x < 252; x++) {
      const idx = (y * 640 + x) * 4;
      frameB[idx] = 240; frameB[idx + 1] = 240; frameB[idx + 2] = 240;
    }
  }
  app.lastRoiGray = null;
  const seedMotion = app.computeFastRoiMotionRgba(frameA, 640, 50, 40, 540, 400);
  const singleDieMotion = app.computeFastRoiMotionRgba(frameB, 640, 50, 40, 540, 400);

  // Trigger Roll #3 with 1 single die that has value=5 (same as one of Roll #2's dice) -> Scoop Guard must NOT suppress 1 die!
  nextMockDice = [
    { x: 182, y: 222, w: 36, h: 36, value: 5, owner: 1 }
  ];
  for (let i = 0; i < 4; i++) {
    app.stepCameraOnnxRollLifecycle(singleDieMotion, frameB, 640, 480, 50, 40, 540, 400);
  }
  const stateDuringSingleDieRoll = app.rollState;
  for (let i = 0; i < 10; i++) {
    app.stepCameraOnnxRollLifecycle(0.0, frameB, 640, 480, 50, 40, 540, 400);
  }
  await new Promise(r => setTimeout(r, 10));
  const historyAfterSingleDieRoll = app.history.length;
  const postOnnxLastRoiGrayIsNull = app.lastRoiGray === null;

  console.log(JSON.stringify({
    callsAfterIdle,
    callsDuringRolling,
    callsAfterRoll1Lock,
    historyAfterRoll1,
    callsDuringLockedWait,
    callsAfterRoll2Lock,
    historyAfterRoll2,
    totalCumulativeDice,
    seedMotion,
    singleDieMotion,
    stateDuringSingleDieRoll,
    historyAfterSingleDieRoll,
    postOnnxLastRoiGrayIsNull
  }));
})();
"""
        proc = subprocess.run(
            ["node", "-e", node_script],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True,
            check=True,
        )
        res = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertEqual(res["callsAfterIdle"], 0)
        self.assertEqual(res["callsDuringRolling"], 0)
        self.assertEqual(res["callsAfterRoll1Lock"], 1)
        self.assertEqual(res["historyAfterRoll1"], 1)
        self.assertEqual(res["callsDuringLockedWait"], 1)
        self.assertEqual(res["callsAfterRoll2Lock"], 2)
        self.assertEqual(res["historyAfterRoll2"], 2)
        self.assertEqual(res["totalCumulativeDice"], 5)
        self.assertEqual(res["seedMotion"], 0)
        self.assertGreater(res["singleDieMotion"], 0.018, "Single die moving in tray must exceed MOTION_ENTER (0.018)")
        self.assertEqual(res["stateDuringSingleDieRoll"], "ROLLING")
        self.assertEqual(res["historyAfterSingleDieRoll"], 3, "Single-die roll must lock and append to Roll History")
        self.assertTrue(res["postOnnxLastRoiGrayIsNull"], "lastRoiGray must reset after ONNX pass to prevent frame-gap spike")

    def test_freeform_angled_polygon_roi_and_fast_settle_and_hud_counts(self):
        """
        Verify:
        1. Freeform 4-corner angled polygon ROI (trapezoid perspective) strictly excludes dice
           that lie inside the axis-aligned bounding box (roiBox) but outside the angled polygon edges,
           while accurately detecting all dice inside the angled polygon.
        2. Post-stop motion has zero EMA ghost-trail lag (motion drops to 0 on the very first static frame)
           and locks within 4 settling frames.
        3. HUD badge displays 6s, 5s, 4s, 3s, 2s, 1s and bottom camera-actions bar is removed.
        """
        html_text = (ROOT_DIR / "web" / "dice_tracker" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn('<div class="camera-actions">', html_text)
        for label in ("6s:", "5s:", "4s:", "3s:", "2s:", "1s:"):
            self.assertIn(label, html_text)
        for span_id in (
            "hudCritsCount",
            "hudFivesCount",
            "hudFoursCount",
            "hudThreesCount",
            "hudTwosCount",
            "hudOnesCount",
        ):
            self.assertIn(span_id, html_text)

        node_script = r"""
const fs = require('fs');
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
  getContext() { return this._ctx; }
  addEventListener() {}
  getBoundingClientRect() { return { width: this.width, height: this.height, left: 0, top: 0 }; }
}
class OffscreenContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.lineWidth = 1;
    this._stack = [];
    this._tx = 0; this._ty = 0; this._rot = 0;
    this._path = [];
  }
  save() { this._stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, tx: this._tx, ty: this._ty, rot: this._rot }); }
  restore() { const s = this._stack.pop(); if (s) { this.fillStyle = s.fillStyle; this.strokeStyle = s.strokeStyle; this.lineWidth = s.lineWidth; this._tx = s.tx; this._ty = s.ty; this._rot = s.rot; } }
  translate(x, y) { const cos = Math.cos(this._rot), sin = Math.sin(this._rot); this._tx += x * cos - y * sin; this._ty += x * sin + y * cos; }
  rotate(angle) { this._rot += angle; }
  clearRect() { this.canvas.buf.fill(0); }
  createRadialGradient() { return { addColorStop() {} }; }
  setLineDash() {}
  fillText() {}
  strokeRect() {}
  drawImage(src) { if (src && src.buf) this.canvas.buf.set(src.buf); }
  parseColor(c) {
    if (!c || typeof c !== 'string') return [30, 41, 59, 255];
    c = c.trim();
    if (c.startsWith('#')) {
      const hex = c.slice(1);
      if (hex.length === 3) return [parseInt(hex[0]+hex[0],16), parseInt(hex[1]+hex[1],16), parseInt(hex[2]+hex[2],16), 255];
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
      this.canvas.buf[idx] = rgba[0]; this.canvas.buf[idx+1] = rgba[1]; this.canvas.buf[idx+2] = rgba[2]; this.canvas.buf[idx+3] = 255;
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
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) this._setPixel(px, py, rgba);
      return;
    }
    this.beginPath(); this.roundRect(x, y, w, h, 0); this.fill();
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
            this._setPixel(Math.round(this._tx + lx * cos - ly * sin), Math.round(this._ty + lx * sin + ly * cos), rgba);
          }
        }
      } else if (p.type === 'arc') {
        const r2 = p.r * p.r;
        for (let dy = -p.r; dy <= p.r; dy += 0.5) {
          for (let dx = -p.r; dx <= p.r; dx += 0.5) {
            if (dx*dx + dy*dy <= r2) {
              const lx = p.x + dx, ly = p.y + dy;
              this._setPixel(Math.round(this._tx + lx * cos - ly * sin), Math.round(this._ty + lx * sin + ly * cos), rgba);
            }
          }
        }
      }
    }
  }
  stroke() {}
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(this.canvas.buf), width: w, height: h }; }
}
const defaultValues = { thresholdSlider: '22', bgFilterSlider: '5', minDiceSize: '22', targetSuccess: '4', diceColorMode: 'auto', p1SchemeSelect: 'bone_black', p2SchemeSelect: 'crimson_gold' };
const elCache = {};
function makeEl(id) {
  if (id === 'outputCanvas' || id === 'distributionChart') return new OffscreenCanvas2D(640, 480);
  return { id, style: {}, value: defaultValues[id] || '0', checked: true, innerText: '', textContent: '', innerHTML: '', disabled: false, classList: { add(){}, remove(){}, toggle(){} }, addEventListener(){}, appendChild(){}, getBoundingClientRect() { return { width: 640, height: 480, left: 0, top: 0 }; }, querySelectorAll() { return []; } };
}
global.window = { location: { search: '' }, addEventListener() {}, requestAnimationFrame() {}, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
global.localStorage = global.window.localStorage;
global.navigator = { vibrate() {} };
global.document = {
  getElementById(id) { if (!elCache[id]) elCache[id] = makeEl(id); return elCache[id]; },
  querySelectorAll() { return []; },
  createElement(tag) { return tag === 'canvas' ? new OffscreenCanvas2D(640, 480) : makeEl(tag); },
  addEventListener() {}
};
eval(fs.readFileSync('web/dice_tracker/app.js', 'utf8') + '\nglobal.DiceTrackerApp = DiceTrackerApp;');
(async () => {
  const app = new DiceTrackerApp();
  // Configure a tilted perspective trapezoid ROI:
  // Top edge is narrow (x: 0.30 .. 0.70 at y: 0.10), bottom edge is wide (x: 0.08 .. 0.92 at y: 0.90)
  // Notice the AABB is x: 0.08..0.92 (51..588px), y: 0.10..0.90 (48..432px).
  app.setRoiPolygon([
    { x: 0.30, y: 0.10 },
    { x: 0.70, y: 0.10 },
    { x: 0.92, y: 0.90 },
    { x: 0.08, y: 0.90 }
  ]);

  const sCtx = app.simCtx;
  sCtx.fillStyle = '#18202c';
  sCtx.fillRect(0, 0, 640, 480);

  // Place 1 distractor die at (x=80, y=75) -> INSIDE the AABB (80 > 51, 75 > 48),
  // but OUTSIDE the angled top-left edge of the trapezoid!
  app.drawRealisticDieOnCtx(sCtx, 80, 75, 34, 6, 'bone_black', false, 0);

  // Place 6 valid dice (faces 1..6) inside the angled trapezoid
  const insidePlacements = [
    { x: 235, y: 110, val: 1 },
    { x: 355, y: 110, val: 2 },
    { x: 195, y: 220, val: 3 },
    { x: 310, y: 220, val: 4 },
    { x: 425, y: 220, val: 5 },
    { x: 295, y: 330, val: 6 }
  ];
  for (const d of insidePlacements) {
    app.drawRealisticDieOnCtx(sCtx, d.x, d.y, 34, d.val, 'bone_black', false, 0.18);
  }

  const frameData = sCtx.getImageData(0, 0, 640, 480);
  const detected = app.detectRealDice(frameData, 640, 480);
  const detectedValues = detected.map(d => d.value).sort((a, b) => a - b);

  app.updateLiveHudCounts(detected);
  const hudCounts = {
    c6: Number(document.getElementById('hudCritsCount').innerText),
    c5: Number(document.getElementById('hudFivesCount').innerText),
    c4: Number(document.getElementById('hudFoursCount').innerText),
    c3: Number(document.getElementById('hudThreesCount').innerText),
    c2: Number(document.getElementById('hudTwosCount').innerText),
    c1: Number(document.getElementById('hudOnesCount').innerText)
  };

  // Verify zero post-stop EMA lag:
  // Frame 0: empty tray, Frame 1: dice land in tray (high motion), Frame 2: same static tray -> motion must drop to 0 immediately!
  const emptyTray = new Uint8ClampedArray(640 * 480 * 4);
  for (let i = 0; i < emptyTray.length; i += 4) {
    emptyTray[i] = 24; emptyTray[i + 1] = 32; emptyTray[i + 2] = 44; emptyTray[i + 3] = 255;
  }
  app.lastRoiGray = null;
  const rx = Math.max(8, Math.floor(640 * app.roiBox.x));
  const ry = Math.max(8, Math.floor(480 * app.roiBox.y));
  const rw = Math.min(640 - rx - 8, Math.floor(640 * app.roiBox.w));
  const rh = Math.min(480 - ry - 8, Math.floor(480 * app.roiBox.h));

  app.computeFastRoiMotionRgba(emptyTray, 640, rx, ry, rw, rh);
  const motionOnArrival = app.computeFastRoiMotionRgba(frameData.data, 640, rx, ry, rw, rh);
  const motionFirstStaticFrame = app.computeFastRoiMotionRgba(frameData.data, 640, rx, ry, rw, rh);

  // Verify fast lock within 4 frames in stepCameraOnnxRollLifecycle
  app.isCameraRunning = true;
  app.onnxReady = true;
  app.rollState = 'IDLE';
  app.runLiveOnnxPass = async () => { app.latestOnnxDice = detected; };
  app.stepCameraOnnxRollLifecycle(motionOnArrival, frameData.data, 640, 480, rx, ry, rw, rh);
  const stateOnArrival = app.rollState;
  let framesToLock = 0;
  for (let f = 1; f <= 6; f++) {
    app.stepCameraOnnxRollLifecycle(0.0, frameData.data, 640, 480, rx, ry, rw, rh);
    await new Promise(r => setTimeout(r, 5));
    if (app.rollState === 'LOCKED') {
      framesToLock = f;
      break;
    }
  }

  console.log(JSON.stringify({
    detectedCount: detected.length,
    detectedValues,
    hudCounts,
    motionOnArrival,
    motionFirstStaticFrame,
    stateOnArrival,
    framesToLock
  }));
})();
"""
        proc = subprocess.run(
            ["node", "-e", node_script],
            cwd=str(ROOT_DIR),
            capture_output=True,
            text=True,
            check=True,
        )
        res = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertEqual(res["detectedCount"], 6, "Distractor inside AABB but outside angled trapezoid must be ignored")
        self.assertEqual(res["detectedValues"], [1, 2, 3, 4, 5, 6])
        self.assertEqual(res["hudCounts"], {"c6": 1, "c5": 1, "c4": 1, "c3": 1, "c2": 1, "c1": 1})
        self.assertGreater(res["motionOnArrival"], 0.02)
        self.assertEqual(res["motionFirstStaticFrame"], 0.0, "Motion must drop to 0 immediately when dice stop without EMA ghost trail")
        self.assertEqual(res["stateOnArrival"], "ROLLING")
        self.assertGreaterEqual(res["framesToLock"], 1)
        self.assertLessEqual(res["framesToLock"], 4, f"Expected lock within <= 4 frames, got {res['framesToLock']}")


if __name__ == "__main__":
    unittest.main()




