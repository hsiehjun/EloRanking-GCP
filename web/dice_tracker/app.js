// OmniTactica WarDice CV - 2-Stage Adaptive Die-Face + Dual-Polarity Pip & ONNX Engine (Phase 1 Admin Lab)
// Features:
// 1. Hands-Free Roll Lifecycle State Machine (IDLE -> ROLLING -> SETTLING -> LOCKED -> SCOOP GUARD / REROLL)
// 2. Strict Draggable ROI Tray Box (masks out & ignores 100% of dice/motion outside the tray)
// 3. Fused Single-Pass ROI Gray+SAT & Pre-Allocated TypedArrays (~6-8ms/frame, zero per-frame heap garbage)
// 4. Scale-Bounded Constellation Clustering + Dynamic Inter-Pip Bridge + 45° Euclidean Rotation Invariance
// 5. Stationary-Subset Scoop Guard (prevents false duplicate rolls when scooping failed dice out of tray)
// 6. Dual-Player Attribution (Auto by Calibrated Dice Color / P1 / P2) & OmniTactica History/Distribution Parity

class DiceTrackerApp {
  constructor() {
    this.sessionActive = true;
    this.history = [];
    this.distribution = [0, 0, 0, 0, 0, 0, 0]; // Index 1-6 (filtered by activeStatsFilter)
    this.currentDetectedDice = [];
    this.lockedRollDice = [];
    this.currentRollPhase = "Hit Roll";

    // OmniTactica Dual-Player Attribution & Filter State
    this.rollerAttributionMode = "auto"; // 'auto' | '1' | '2'
    this.activeStatsFilter = "all";      // 'all' | '1' | '2'

    this.stream = null;
    this.isCameraRunning = false;
    this.isSimulationMode = false;
    this.simAnimationId = null;
    this.wakeLock = null;
    this.torchEnabled = false;
    this.cameraZoom = 1.0;

    // Interactive Draggable ROI Box (Dice Tray bounds in normalized 0..1 coordinates)
    this.roiBox = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
    this.draggingRoiCorner = null;

    // Static Empty Tray Reference Frame
    this.emptyTrayBg = null;

    // Pre-Game Player Dice Profiles ("🎯 Set Your Dice")
    this.diceSchemes = {
      bone_black: { label: "Bone White + Black Pips", body: "#f0f4f8", stroke: "#9aa4b0", pip: "#11151c", polarity: "dark_pip" },
      black_white: { label: "Obsidian Black + White Pips", body: "#263142", stroke: "#11161f", pip: "#f8fafc", polarity: "light_pip" },
      crimson_gold: { label: "Blood Angels Red + Gold Pips", body: "#5c161e", stroke: "#320a0f", pip: "#f7d454", polarity: "light_pip" },
      cobalt_white: { label: "Ultramarines Blue + White Pips", body: "#1d3561", stroke: "#0e1b33", pip: "#f8fafc", polarity: "light_pip" },
      odgreen_bone: { label: "Death Guard Green + Bone Pips", body: "#2b3d28", stroke: "#162114", pip: "#f2ebd9", polarity: "light_pip" }
    };
    this.playerDiceProfiles = {
      p1Scheme: "bone_black",
      p1CustomSix: true,
      p2Scheme: "crimson_gold",
      p2CustomSix: true
    };

    // Optional YOLOv8 ONNX Runtime Web Session
    this.onnxSession = null;
    this.onnxBusy = false;
    this.lastOnnxDetections = null;

    // Hands-Free Auto-Roll State Machine: 'IDLE' | 'ROLLING' | 'SETTLING' | 'LOCKED'
    this.rollState = "IDLE";
    this.lastRoiGray = null;
    this.settledFrameCounter = 0;
    this.settlingBuffer = [];
    this.lockedDiceSignature = "";
    this.emptyFramesCount = 0;
    this.motionFramesCount = 0;
    this.consecutiveDiceFrames = 0;

    // UI DOM mutation deduplication & throttling (prevents mobile layout/paint flicker)
    this._lastPerfUiUpdateMs = 0;
    this._lastUiState = "";
    this._lastUiHint = "";
    this._lastUiProgress = -1;
    this._lastHudSig = "";

    // Scoop Guard state: remembers spatial coordinates of locked dice before hand enters tray
    this.lastLockedSpatialDice = [];
    this.hadLockedRollBeforeMotion = false;
    this.isChainedSimRoll = false;

    // Pre-allocated CV TypedArrays for zero per-frame GC pressure (640x480)
    this._bufW = 0;
    this._bufH = 0;
    this._grayBuf = null;
    this._satBuf = null;
    this._visitedBuf = null;
    this._bfsX = new Int16Array(900);
    this._bfsY = new Int16Array(900);

    // Performance telemetry EMA
    this.cvLatencyEmaMs = 0;

    // Offscreen Physics Simulation Canvas (feeds raw pixel frames to the real CV pipeline)
    this.simCanvas = document.createElement("canvas");
    this.simCanvas.width = 640;
    this.simCanvas.height = 480;
    this.simCtx = this.simCanvas.getContext("2d");
    this.simDiceObjects = [];
    this.simDistractorDice = [];
    this.simFramesRemaining = 0;

    // WebAudio context for crisp lock chime
    this.audioCtx = null;

    this.initDOM();
    if (window.innerWidth <= 768) {
      const tuningDetails = document.querySelector(".tuning-panel");
      if (tuningDetails) tuningDetails.removeAttribute("open");
    }
    this.ensureCvBuffers(this.canvas.width, this.canvas.height);
    this.initChart();
    this.bindEvents();
    this.requestWakeLock();
    this.updateStatsUI();
    this.updateStateMachineUI("IDLE", "Ready — Throw dice into tray or click '🎲 Roll 40 Dice (Live CV)'", 0);

    const params = new URLSearchParams(window.location.search);
    if (params.has("autoroll")) {
      const n = parseInt(params.get("autoroll"), 10) || 40;
      setTimeout(() => {
        this.startPhysicsSimRoll(n);
        if (params.get("autoroll_chain") === "1") {
          setTimeout(() => {
            if (!this.btnRerollHits.disabled) {
              this.btnRerollHits.click();
            }
          }, 1200);
        }
        if (params.get("show_conflict") === "1") {
          setTimeout(() => {
            this.playerDiceProfiles.p1Scheme = "black_white";
            this.playerDiceProfiles.p2Scheme = "cobalt_white";
            this.openSetDiceModal();
          }, 1100);
        }
      }, 150);
    }
  }

  ensureCvBuffers(width, height) {
    if (this._bufW === width && this._bufH === height && this._grayBuf) return;
    this._bufW = width;
    this._bufH = height;
    this._grayBuf = new Uint8Array(width * height);
    this._satBuf = new Int32Array((width + 1) * (height + 1));
    this._visitedBuf = new Uint8Array(width * height);
  }

  initDOM() {
    this.video = document.getElementById("webcam");
    this.canvas = document.getElementById("outputCanvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });

    this.btnStartGame = document.getElementById("btnStartGame");
    this.btnEndGame = document.getElementById("btnEndGame");
    this.sessionStatus = document.getElementById("sessionStatus");
    this.engineBadge = document.getElementById("engineBadge");
    this.cvPerfBadge = document.getElementById("cvPerfBadge");
    this.rollPhaseBadge = document.getElementById("rollPhaseBadge");

    this.btnToggleCam = document.getElementById("btnToggleCam");
    this.btnCaptureRoll = document.getElementById("btnCaptureRoll");
    this.btnSimulateRoll = document.getElementById("btnSimulateRoll");
    this.btnRerollHits = document.getElementById("btnRerollHits");
    this.btnRerollCount = document.getElementById("btnRerollCount");
    this.btnSetPlayerDice = document.getElementById("btnSetPlayerDice");
    this.btnCalibrateBg = document.getElementById("btnCalibrateBg");
    this.btnResetRoi = document.getElementById("btnResetRoi");
    this.btnTorchToggle = document.getElementById("btnTorchToggle");
    this.camZoomSlider = document.getElementById("camZoomSlider");
    this.camZoomVal = document.getElementById("camZoomVal");

    this.btnUndoLastRoll = document.getElementById("btnUndoLastRoll");
    this.btnSyncToTracker = document.getElementById("btnSyncToTracker");
    this.syncFeedbackText = document.getElementById("syncFeedbackText");
    this.expectedPerFaceBadge = document.getElementById("expectedPerFaceBadge");

    this.setDiceModal = document.getElementById("setDiceModal");
    this.btnAutoScanTrayDice = document.getElementById("btnAutoScanTrayDice");
    this.btnTestCalibratedRoll = document.getElementById("btnTestCalibratedRoll");
    this.p1SchemeSelect = document.getElementById("p1SchemeSelect");
    this.p2SchemeSelect = document.getElementById("p2SchemeSelect");
    this.p1CustomSix = document.getElementById("p1CustomSix");
    this.p2CustomSix = document.getElementById("p2CustomSix");
    this.p1Swatch = document.getElementById("p1Swatch");
    this.p2Swatch = document.getElementById("p2Swatch");
    this.diceSimilarityAlert = document.getElementById("diceSimilarityAlert");
    this.diceSimilarityText = document.getElementById("diceSimilarityText");
    this.btnAutoFixDiceConflict = document.getElementById("btnAutoFixDiceConflict");
    this.scanCalibrationFeedback = document.getElementById("scanCalibrationFeedback");
    this.btnSaveDiceProfile = document.getElementById("btnSaveDiceProfile");
    this.btnCloseDiceModal = document.getElementById("btnCloseDiceModal");

    this.chkAutoCapture = document.getElementById("chkAutoCapture");
    this.chkScoopGuard = document.getElementById("chkScoopGuard");
    this.chkVoiceReadout = document.getElementById("chkVoiceReadout");
    this.chkSimulation = document.getElementById("chkSimulation");
    this.chkOutsideDistractors = document.getElementById("chkOutsideDistractors");
    this.chkCustomSixSymbol = document.getElementById("chkCustomSixSymbol");
    this.chkRerollOnes = document.getElementById("chkRerollOnes");

    this.cameraSelect = document.getElementById("cameraSelect");
    this.diceColorMode = document.getElementById("diceColorMode");
    this.simDiceCountSelect = document.getElementById("simDiceCountSelect");
    this.wakeLockStatus = document.getElementById("wakeLockStatus");

    this.statePill = document.getElementById("statePill");
    this.settlingProgressBar = document.getElementById("settlingProgressBar");
    this.stateHint = document.getElementById("stateHint");

    this.thresholdSlider = document.getElementById("thresholdSlider");
    this.thresholdVal = document.getElementById("thresholdVal");
    this.bgFilterSlider = document.getElementById("bgFilterSlider");
    this.bgFilterVal = document.getElementById("bgFilterVal");
    this.minDiceSize = document.getElementById("minDiceSize");
    this.minDiceVal = document.getElementById("minDiceVal");
    this.targetSuccess = document.getElementById("targetSuccess");

    this.statTotalRolls = document.getElementById("statTotalRolls");
    this.statTotalDice = document.getElementById("statTotalDice");
    this.statAvgRoll = document.getElementById("statAvgRoll");
    this.statSuccessPct = document.getElementById("statSuccessPct");
    this.lastRollDiceList = document.getElementById("lastRollDiceList");
    this.historyTableBody = document.getElementById("historyTableBody");

    this.hudDiceCount = document.getElementById("hudDiceCount");
    this.hudHitsCount = document.getElementById("hudHitsCount");
    this.hudCritsCount = document.getElementById("hudCritsCount");
    this.hudOnesCount = document.getElementById("hudOnesCount");
    this.hudTargetLabel = document.getElementById("hudTargetLabel");
    this.hudDiceSum = document.getElementById("hudDiceSum");
    this.hudOwnerSplit = document.getElementById("hudOwnerSplit");
    this.scannerOverlay = document.getElementById("scannerOverlay");
    this.scannerText = document.getElementById("scannerText");

    this.editModal = document.getElementById("editModal");
    this.modalDiceContainer = document.getElementById("modalDiceContainer");
    this.btnSaveEdit = document.getElementById("btnSaveEdit");
    this.btnCancelEdit = document.getElementById("btnCancelEdit");

    this.editingRollId = null;
    this.editingValues = [];

    this.canvas.width = 640;
    this.canvas.height = 480;
  }

  bindEvents() {
    this.btnStartGame.addEventListener("click", () => this.startGame());
    this.btnEndGame.addEventListener("click", () => this.endGame());
    this.btnToggleCam.addEventListener("click", () => this.toggleCamera());
    this.btnCaptureRoll.addEventListener("click", () => this.captureCurrentRoll("Manual Lock"));

    this.btnSimulateRoll.addEventListener("click", () => {
      const poolSize = parseInt(this.simDiceCountSelect.value, 10) || 40;
      this.currentRollPhase = "Hit Roll";
      this.rollPhaseBadge.innerText = "Phase: Hit Roll";
      this.isChainedSimRoll = true;
      this.startPhysicsSimRoll(poolSize);
    });

    this.btnRerollHits.addEventListener("click", () => {
      const targetVal = parseInt(this.targetSuccess.value, 10);
      const sourceDice = this.lockedRollDice.length > 0 ? this.lockedRollDice : this.currentDetectedDice;
      const hitsCount = sourceDice.filter(d => d.value >= targetVal).length;
      if (hitsCount > 0) {
        this.currentRollPhase = this.currentRollPhase === "Hit Roll" ? "Wound Roll" : "Save Roll";
        this.rollPhaseBadge.innerText = `Phase: ${this.currentRollPhase}`;
        this.isChainedSimRoll = true;
        this.startPhysicsSimRoll(hitsCount);
      }
    });

    if (this.btnUndoLastRoll) {
      this.btnUndoLastRoll.addEventListener("click", () => this.undoLastRoll());
    }
    if (this.btnSyncToTracker) {
      this.btnSyncToTracker.addEventListener("click", () => this.syncToGameTrackerLocalHistory());
    }

    // Active Roller Attribution buttons
    const rollerGroup = document.getElementById("rollerAttributionGroup");
    if (rollerGroup) {
      rollerGroup.querySelectorAll(".seg-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          this.rollerAttributionMode = btn.getAttribute("data-roller") || "auto";
          rollerGroup.querySelectorAll(".seg-btn").forEach(b => {
            b.className = "seg-btn";
          });
          if (this.rollerAttributionMode === "1") btn.classList.add("active-p1");
          else if (this.rollerAttributionMode === "2") btn.classList.add("active-p2");
          else btn.classList.add("active");
        });
      });
    }

    // Stats View Filter buttons
    const statsGroup = document.getElementById("statsFilterGroup");
    if (statsGroup) {
      statsGroup.querySelectorAll(".seg-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          this.activeStatsFilter = btn.getAttribute("data-filter") || "all";
          statsGroup.querySelectorAll(".seg-btn").forEach(b => {
            b.className = "seg-btn";
          });
          if (this.activeStatsFilter === "1") btn.classList.add("active-p1");
          else if (this.activeStatsFilter === "2") btn.classList.add("active-p2");
          else btn.classList.add("active");
          this.rebuildDistributionFromHistory();
          this.updateStatsUI();
        });
      });
    }

    if (this.btnTorchToggle) {
      this.btnTorchToggle.addEventListener("click", () => this.toggleCameraTorch());
    }
    if (this.camZoomSlider) {
      this.camZoomSlider.addEventListener("input", (e) => {
        const z = parseFloat(e.target.value) || 1.0;
        this.applyCameraZoom(z);
      });
    }

    if (this.btnSetPlayerDice) {
      this.btnSetPlayerDice.addEventListener("click", () => this.openSetDiceModal());
    }
    if (this.btnCloseDiceModal) {
      this.btnCloseDiceModal.addEventListener("click", () => this.setDiceModal.classList.add("hidden"));
    }
    if (this.btnSaveDiceProfile) {
      this.btnSaveDiceProfile.addEventListener("click", () => this.savePlayerDiceProfile(true));
    }
    if (this.btnAutoScanTrayDice) {
      this.btnAutoScanTrayDice.addEventListener("click", () => this.autoScanTrayDiceProfile());
    }
    if (this.btnTestCalibratedRoll) {
      this.btnTestCalibratedRoll.addEventListener("click", () => {
        this.savePlayerDiceProfile(true);
        const poolSize = parseInt(this.simDiceCountSelect.value, 10) || 40;
        this.isChainedSimRoll = true;
        this.startPhysicsSimRoll(poolSize);
      });
    }
    if (this.p1SchemeSelect) {
      this.p1SchemeSelect.addEventListener("change", () => this.updateModalSwatches());
    }
    if (this.p2SchemeSelect) {
      this.p2SchemeSelect.addEventListener("change", () => this.updateModalSwatches());
    }
    if (this.btnAutoFixDiceConflict) {
      this.btnAutoFixDiceConflict.addEventListener("click", () => this.autoFixDiceConflict());
    }

    this.btnCalibrateBg.addEventListener("click", () => this.calibrateEmptyTray());
    this.btnResetRoi.addEventListener("click", () => {
      this.roiBox = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
      this.lastRoiGray = null;
    });

    document.getElementById("btnClearStats").addEventListener("click", () => this.resetStats());

    this.cameraSelect.addEventListener("change", () => {
      if (this.isCameraRunning) this.startCamera();
    });

    this.chkSimulation.addEventListener("change", (e) => {
      if (e.target.checked) {
        const poolSize = parseInt(this.simDiceCountSelect.value, 10) || 40;
        this.startPhysicsSimRoll(poolSize);
      } else {
        this.stopSimulationStream();
      }
    });

    this.thresholdSlider.addEventListener("input", (e) => {
      this.thresholdVal.innerText = e.target.value;
    });

    this.bgFilterSlider.addEventListener("input", (e) => {
      this.bgFilterVal.innerText = e.target.value;
    });

    this.minDiceSize.addEventListener("input", (e) => {
      this.minDiceVal.innerText = e.target.value;
    });

    this.targetSuccess.addEventListener("change", () => {
      this.hudTargetLabel.innerText = `${this.targetSuccess.value}+`;
      this.updateLiveHudCounts(this.currentDetectedDice);
      this.updateStatsUI();
    });

    this.btnSaveEdit.addEventListener("click", () => this.saveEditRoll());
    this.btnCancelEdit.addEventListener("click", () => this.editModal.classList.add("hidden"));

    this.bindCanvasInteractions();

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.requestWakeLock();
    });
  }

  bindCanvasInteractions() {
    const getCanvasCoords = (evt) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
      return {
        x: ((clientX - rect.left) / rect.width) * this.canvas.width,
        y: ((clientY - rect.top) / rect.height) * this.canvas.height
      };
    };

    const onPointerDown = (evt) => {
      const pt = getCanvasCoords(evt);
      const rx1 = this.roiBox.x * this.canvas.width;
      const ry1 = this.roiBox.y * this.canvas.height;
      const rx2 = (this.roiBox.x + this.roiBox.w) * this.canvas.width;
      const ry2 = (this.roiBox.y + this.roiBox.h) * this.canvas.height;
      const handleRadius = 24;

      if (Math.hypot(pt.x - rx1, pt.y - ry1) < handleRadius) {
        this.draggingRoiCorner = "TL";
      } else if (Math.hypot(pt.x - rx2, pt.y - ry1) < handleRadius) {
        this.draggingRoiCorner = "TR";
      } else if (Math.hypot(pt.x - rx1, pt.y - ry2) < handleRadius) {
        this.draggingRoiCorner = "BL";
      } else if (Math.hypot(pt.x - rx2, pt.y - ry2) < handleRadius) {
        this.draggingRoiCorner = "BR";
      } else {
        const hitDie = this.currentDetectedDice.find(
          d => pt.x >= d.x && pt.x <= d.x + d.w && pt.y >= d.y && pt.y <= d.y + d.h
        );
        if (hitDie) {
          hitDie.value = (hitDie.value % 6) + 1;
          hitDie.manualOverride = true;
          this.updateLiveHudCounts(this.currentDetectedDice);
          if (this.history.length > 0 && this.rollState === "LOCKED") {
            const latest = this.history[0];
            latest.values = this.currentDetectedDice.map(d => d.value);
            latest.results = [...latest.values];
            this.recalculateRollEntry(latest);
            this.rebuildDistributionFromHistory();
            this.updateStatsUI();
            this.renderLastRollBadges(latest.values);
          }
        }
      }
    };

    const onPointerMove = (evt) => {
      if (!this.draggingRoiCorner) return;
      evt.preventDefault();
      const pt = getCanvasCoords(evt);
      const nx = Math.max(0.02, Math.min(0.98, pt.x / this.canvas.width));
      const ny = Math.max(0.02, Math.min(0.98, pt.y / this.canvas.height));

      const x2 = this.roiBox.x + this.roiBox.w;
      const y2 = this.roiBox.y + this.roiBox.h;

      if (this.draggingRoiCorner === "TL") {
        this.roiBox.x = Math.min(nx, x2 - 0.2);
        this.roiBox.y = Math.min(ny, y2 - 0.2);
        this.roiBox.w = x2 - this.roiBox.x;
        this.roiBox.h = y2 - this.roiBox.y;
      } else if (this.draggingRoiCorner === "TR") {
        this.roiBox.y = Math.min(ny, y2 - 0.2);
        this.roiBox.w = Math.max(0.2, nx - this.roiBox.x);
        this.roiBox.h = y2 - this.roiBox.y;
      } else if (this.draggingRoiCorner === "BL") {
        this.roiBox.x = Math.min(nx, x2 - 0.2);
        this.roiBox.w = x2 - this.roiBox.x;
        this.roiBox.h = Math.max(0.2, ny - this.roiBox.y);
      } else if (this.draggingRoiCorner === "BR") {
        this.roiBox.w = Math.max(0.2, nx - this.roiBox.x);
        this.roiBox.h = Math.max(0.2, ny - this.roiBox.y);
      }
      this.lastRoiGray = null;
    };

    const onPointerUp = () => {
      this.draggingRoiCorner = null;
    };

    this.canvas.addEventListener("mousedown", onPointerDown);
    this.canvas.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);

    this.canvas.addEventListener("touchstart", onPointerDown, { passive: false });
    this.canvas.addEventListener("touchmove", onPointerMove, { passive: false });
    window.addEventListener("touchend", onPointerUp);
  }

  calibrateEmptyTray() {
    const frameData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const gray = new Uint8Array(frameData.width * frameData.height);
    const data = frameData.data;
    for (let i = 0; i < data.length; i += 4) {
      gray[i >> 2] = (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2]) >> 8;
    }
    this.emptyTrayBg = gray;
    this.rollState = "IDLE";
    this.lockedDiceSignature = "";
    this.lastLockedSpatialDice = [];
    this.hadLockedRollBeforeMotion = false;
    this.updateStateMachineUI("IDLE", "📸 Empty tray calibrated! Throw dice into the tray.", 0);
  }

  // ============================================================================
  // PRE-GAME "SET YOUR DICE" CALIBRATION WIZARD & SIMILARITY CONFLICT DETECTOR
  // ============================================================================
  hexToRgb(hex) {
    const clean = (hex || "#ffffff").replace("#", "");
    const num = parseInt(clean, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  computePerceptualDeltaE(rgb1, rgb2) {
    const rMean = (rgb1.r + rgb2.r) * 0.5;
    const dr = rgb1.r - rgb2.r;
    const dg = rgb1.g - rgb2.g;
    const db = rgb1.b - rgb2.b;
    const wR = 2 + rMean / 256;
    const wG = 4.0;
    const wB = 2 + (255 - rMean) / 256;
    return Math.round(Math.sqrt(wR * dr * dr + wG * dg * dg + wB * db * db) / 3);
  }

  // Classify a single detected die as Player 1 (1) or Player 2 (2) based on calibrated dice profiles
  classifyDieOwner(dieObj, rgba, width, height) {
    const s1 = this.diceSchemes[this.playerDiceProfiles.p1Scheme] || this.diceSchemes.bone_black;
    const s2 = this.diceSchemes[this.playerDiceProfiles.p2Scheme] || this.diceSchemes.crimson_gold;

    // Fast path: if P1 and P2 use opposite pip polarities, polarity immediately distinguishes them!
    if (s1.polarity !== s2.polarity && dieObj.polarity) {
      return dieObj.polarity === s1.polarity ? 1 : 2;
    }

    if (!rgba) return 1;
    const pts = [
      [Math.round(dieObj.x + dieObj.w * 0.15), Math.round(dieObj.y + dieObj.h * 0.5)],
      [Math.round(dieObj.x + dieObj.w * 0.85), Math.round(dieObj.y + dieObj.h * 0.5)],
      [Math.round(dieObj.x + dieObj.w * 0.5), Math.round(dieObj.y + dieObj.h * 0.15)],
      [Math.round(dieObj.x + dieObj.w * 0.5), Math.round(dieObj.y + dieObj.h * 0.85)]
    ];
    let rSum = 0, gSum = 0, bSum = 0, cnt = 0;
    for (let i = 0; i < 4; i++) {
      const px = pts[i][0], py = pts[i][1];
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const off = (py * width + px) * 4;
        rSum += rgba[off];
        gSum += rgba[off + 1];
        bSum += rgba[off + 2];
        cnt++;
      }
    }
    if (cnt === 0) return 1;
    const sampledRgb = { r: rSum / cnt, g: gSum / cnt, b: bSum / cnt };
    const d1 = this.computePerceptualDeltaE(sampledRgb, this.hexToRgb(s1.body));
    const d2 = this.computePerceptualDeltaE(sampledRgb, this.hexToRgb(s2.body));
    return d2 < d1 ? 2 : 1;
  }

  evaluateOpponentDiceSimilarity(schemeKey1, schemeKey2) {
    const s1 = this.diceSchemes[schemeKey1] || this.diceSchemes.bone_black;
    const s2 = this.diceSchemes[schemeKey2] || this.diceSchemes.crimson_gold;

    const bodyRgb1 = this.hexToRgb(s1.body);
    const bodyRgb2 = this.hexToRgb(s2.body);
    const pipRgb1 = this.hexToRgb(s1.pip);
    const pipRgb2 = this.hexToRgb(s2.pip);

    const bodyDeltaE = this.computePerceptualDeltaE(bodyRgb1, bodyRgb2);
    const pipDeltaE = this.computePerceptualDeltaE(pipRgb1, pipRgb2);
    const samePolarity = s1.polarity === s2.polarity;

    const compositeDelta = Math.round(bodyDeltaE * 0.75 + pipDeltaE * 0.25 + (samePolarity ? 0 : 35));
    const similarityPct = Math.max(0, Math.min(100, Math.round(100 - (compositeDelta / 225) * 100)));

    let status = "DISTINCT";
    if (schemeKey1 === schemeKey2 || compositeDelta < 28) {
      status = "CONFLICT";
    } else if (compositeDelta < 75 && samePolarity) {
      status = "CAUTION";
    }

    if (this.diceSimilarityAlert && this.diceSimilarityText) {
      if (status === "CONFLICT") {
        this.diceSimilarityAlert.style.background = "rgba(248, 81, 73, 0.14)";
        this.diceSimilarityAlert.style.borderColor = "rgba(248, 81, 73, 0.55)";
        this.diceSimilarityAlert.style.color = "#ff7b72";
        this.diceSimilarityText.innerHTML =
          `🚨 <strong>DICE CONFLICT (${similarityPct}% Match — ΔE: ${compositeDelta}):</strong> ` +
          `Player 1 &amp; Player 2 registered identical/indistinguishable dice! Mixed rolls or leftover tray dice cannot be told apart.`;
        if (this.btnAutoFixDiceConflict) this.btnAutoFixDiceConflict.classList.remove("hidden");
      } else if (status === "CAUTION") {
        this.diceSimilarityAlert.style.background = "rgba(210, 153, 34, 0.15)";
        this.diceSimilarityAlert.style.borderColor = "rgba(210, 153, 34, 0.55)";
        this.diceSimilarityAlert.style.color = "#e3b341";
        this.diceSimilarityText.innerHTML =
          `⚠️ <strong>TOO CLOSE (${similarityPct}% Similarity — ΔE: ${compositeDelta}):</strong> ` +
          `Both sets use dark bodies with light pips in close shades. Under dim venue lighting they may look similar!`;
        if (this.btnAutoFixDiceConflict) this.btnAutoFixDiceConflict.classList.remove("hidden");
      } else {
        this.diceSimilarityAlert.style.background = "rgba(16, 185, 129, 0.1)";
        this.diceSimilarityAlert.style.borderColor = "rgba(16, 185, 129, 0.35)";
        this.diceSimilarityAlert.style.color = "#34d399";
        this.diceSimilarityText.innerHTML =
          `✅ <strong>Distinct Opponent Dice (${similarityPct}% Similarity — ΔE: ${compositeDelta}):</strong> ` +
          `Player 1 &amp; Player 2 sets have strong color &amp; contrast separation.`;
        if (this.btnAutoFixDiceConflict) this.btnAutoFixDiceConflict.classList.add("hidden");
      }
    }

    return { status, similarityPct, compositeDelta, bodyDeltaE };
  }

  autoFixDiceConflict() {
    const p1Key = this.p1SchemeSelect ? this.p1SchemeSelect.value : "bone_black";
    const s1 = this.diceSchemes[p1Key] || this.diceSchemes.bone_black;
    const rgb1 = this.hexToRgb(s1.body);

    let bestKey = "crimson_gold";
    let bestScore = -1;
    Object.keys(this.diceSchemes).forEach(k => {
      if (k === p1Key) return;
      const cand = this.diceSchemes[k];
      const dE = this.computePerceptualDeltaE(rgb1, this.hexToRgb(cand.body)) +
        (cand.polarity !== s1.polarity ? 50 : 0);
      if (dE > bestScore) {
        bestScore = dE;
        bestKey = k;
      }
    });

    if (this.p2SchemeSelect) {
      this.p2SchemeSelect.value = bestKey;
    }
    this.updateModalSwatches();
  }

  openSetDiceModal() {
    if (!this.setDiceModal) return;
    if (this.p1SchemeSelect) this.p1SchemeSelect.value = this.playerDiceProfiles.p1Scheme;
    if (this.p2SchemeSelect) this.p2SchemeSelect.value = this.playerDiceProfiles.p2Scheme;
    if (this.p1CustomSix) this.p1CustomSix.checked = this.playerDiceProfiles.p1CustomSix;
    if (this.p2CustomSix) this.p2CustomSix.checked = this.playerDiceProfiles.p2CustomSix;
    this.updateModalSwatches();
    this.setDiceModal.classList.remove("hidden");
  }

  updateModalSwatches() {
    const k1 = this.p1SchemeSelect ? this.p1SchemeSelect.value : "bone_black";
    const k2 = this.p2SchemeSelect ? this.p2SchemeSelect.value : "crimson_gold";
    const s1 = this.diceSchemes[k1] || this.diceSchemes.bone_black;
    const s2 = this.diceSchemes[k2] || this.diceSchemes.crimson_gold;
    if (this.p1Swatch) {
      this.p1Swatch.style.background = s1.body;
      this.p1Swatch.style.borderColor = s1.pip;
    }
    if (this.p2Swatch) {
      this.p2Swatch.style.background = s2.body;
      this.p2Swatch.style.borderColor = s2.pip;
    }
    this.evaluateOpponentDiceSimilarity(k1, k2);
  }

  autoScanTrayDiceProfile() {
    if (this.currentDetectedDice.length === 0 && !this.isCameraRunning) {
      this.startPhysicsSimRoll(12);
    }

    const detected = this.currentDetectedDice;
    const lightCount = detected.filter(d => d.polarity === "dark_pip").length;
    const darkCount = detected.filter(d => d.polarity === "light_pip").length;
    const customSixCount = detected.filter(d => d.isCustomSymbol).length;
    const avgSize = detected.length > 0
      ? Math.round(detected.reduce((acc, d) => acc + d.w, 0) / detected.length)
      : 36;

    const tunedMinPx = Math.max(16, Math.min(34, Math.round(avgSize * 0.6)));
    this.minDiceSize.value = tunedMinPx;
    this.minDiceVal.innerText = tunedMinPx;

    if (lightCount > 0 && darkCount > 0) {
      this.diceColorMode.value = "auto";
    } else if (darkCount > 0) {
      this.diceColorMode.value = "dark";
    } else if (lightCount > 0) {
      this.diceColorMode.value = "light";
    }

    if (customSixCount > 0 && this.chkCustomSixSymbol) {
      this.chkCustomSixSymbol.checked = true;
    }

    const frameData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const rgba = frameData.data;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const sampledColors = [];

    detected.forEach(d => {
      const pts = [
        [Math.round(d.x + d.w * 0.15), Math.round(d.y + d.h * 0.5)],
        [Math.round(d.x + d.w * 0.85), Math.round(d.y + d.h * 0.5)],
        [Math.round(d.x + d.w * 0.5), Math.round(d.y + d.h * 0.15)],
        [Math.round(d.x + d.w * 0.5), Math.round(d.y + d.h * 0.85)]
      ];
      let rSum = 0, gSum = 0, bSum = 0, cnt = 0;
      pts.forEach(([px, py]) => {
        if (px >= 0 && px < w && py >= 0 && py < h) {
          const off = (py * w + px) * 4;
          rSum += rgba[off];
          gSum += rgba[off + 1];
          bSum += rgba[off + 2];
          cnt++;
        }
      });
      if (cnt > 0) {
        sampledColors.push({
          r: Math.round(rSum / cnt),
          g: Math.round(gSum / cnt),
          b: Math.round(bSum / cnt),
          polarity: d.polarity
        });
      }
    });

    let maxTrayDeltaE = 0;
    for (let i = 0; i < sampledColors.length; i++) {
      for (let j = i + 1; j < sampledColors.length; j++) {
        const dE = this.computePerceptualDeltaE(sampledColors[i], sampledColors[j]);
        if (dE > maxTrayDeltaE) maxTrayDeltaE = dE;
      }
    }

    this.evaluateOpponentDiceSimilarity(
      this.p1SchemeSelect ? this.p1SchemeSelect.value : this.playerDiceProfiles.p1Scheme,
      this.p2SchemeSelect ? this.p2SchemeSelect.value : this.playerDiceProfiles.p2Scheme
    );

    if (this.scanCalibrationFeedback) {
      if (sampledColors.length >= 2 && maxTrayDeltaE < 28) {
        this.scanCalibrationFeedback.style.color = "#ff7b72";
        this.scanCalibrationFeedback.style.background = "rgba(248, 81, 73, 0.14)";
        this.scanCalibrationFeedback.style.borderColor = "rgba(248, 81, 73, 0.55)";
        this.scanCalibrationFeedback.innerText =
          `🚨 TOO SIMILAR IN TRAY (Measured ΔE=${maxTrayDeltaE}): All ${detected.length} scanned dice have almost identical body color!`;
      } else {
        this.scanCalibrationFeedback.style.color = "#34d399";
        this.scanCalibrationFeedback.style.background = "rgba(16, 185, 129, 0.1)";
        this.scanCalibrationFeedback.style.borderColor = "rgba(16, 185, 129, 0.3)";
        this.scanCalibrationFeedback.innerText =
          `✅ Scanned ${detected.length} tray dice: Avg Die Size ${avgSize}px (Min=${tunedMinPx}px) | ` +
          `Light Dice: ${lightCount}, Dark/Colored Dice: ${darkCount}, Custom 6s: ${customSixCount} | ` +
          `Measured Tray Color Separation ΔE=${maxTrayDeltaE} (Distinct!).`;
      }
    }
  }

  savePlayerDiceProfile(closeModal = true) {
    if (this.p1SchemeSelect) this.playerDiceProfiles.p1Scheme = this.p1SchemeSelect.value;
    if (this.p2SchemeSelect) this.playerDiceProfiles.p2Scheme = this.p2SchemeSelect.value;
    if (this.p1CustomSix) this.playerDiceProfiles.p1CustomSix = this.p1CustomSix.checked;
    if (this.p2CustomSix) this.playerDiceProfiles.p2CustomSix = this.p2CustomSix.checked;

    const s1 = this.diceSchemes[this.playerDiceProfiles.p1Scheme] || this.diceSchemes.bone_black;
    const s2 = this.diceSchemes[this.playerDiceProfiles.p2Scheme] || this.diceSchemes.crimson_gold;
    const simCheck = this.evaluateOpponentDiceSimilarity(
      this.playerDiceProfiles.p1Scheme,
      this.playerDiceProfiles.p2Scheme
    );

    if (s1.polarity === s2.polarity) {
      this.diceColorMode.value = s1.polarity === "dark_pip" ? "light" : "dark";
    } else {
      this.diceColorMode.value = "auto";
    }

    this.chkCustomSixSymbol.checked = Boolean(
      this.playerDiceProfiles.p1CustomSix || this.playerDiceProfiles.p2CustomSix
    );

    if (this.engineBadge) {
      const conflictTag = simCheck.status === "CONFLICT"
        ? " ⚠️ SIMILAR DICE"
        : simCheck.status === "CAUTION"
        ? " ⚠️ CLOSE SHADES"
        : "";
      this.engineBadge.innerText = `Calibrated: ${s1.label.split("+")[0].trim()} & ${s2.label.split("+")[0].trim()}${conflictTag}`;
    }

    const hintMsg = simCheck.status === "CONFLICT"
      ? `⚠️ Warning: Player 1 & Player 2 dice are ${simCheck.similarityPct}% similar (ΔE=${simCheck.compositeDelta})! Cannot distinguish sets in mixed rolls.`
      : simCheck.status === "CAUTION"
      ? `⚠️ Caution: Player 1 & Player 2 dice are close dark shades (${simCheck.similarityPct}% match, ΔE=${simCheck.compositeDelta}).`
      : `🎯 Dice Calibrated (Distinct ΔE=${simCheck.compositeDelta}): [${s1.label}] + [${s2.label}]`;

    this.updateStateMachineUI(
      this.rollState,
      hintMsg,
      this.rollState === "LOCKED" ? 100 : 0
    );

    if (closeModal && this.setDiceModal) {
      this.setDiceModal.classList.add("hidden");
    }
  }

  async requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        this.wakeLock = await navigator.wakeLock.request("screen");
        this.wakeLockStatus.innerText = "🔒 Keep Awake: On";
        this.wakeLockStatus.style.opacity = "1";
      }
    } catch (_err) {
      this.wakeLockStatus.innerText = "🔒 Keep Awake: Auto";
      this.wakeLockStatus.style.opacity = "0.75";
    }
  }

  initChart() {
    this.chartCanvas = document.getElementById("distributionChart");
    this.chart = null;
    this.drawNativeDistributionChart([0, 0, 0, 0, 0, 0]);
    window.addEventListener("resize", () => {
      this.drawNativeDistributionChart(this.distribution.slice(1));
    });
  }

  drawNativeDistributionChart(counts6) {
    if (!this.chartCanvas) return;
    const c = this.chartCanvas;
    const parentW = c.parentElement && c.parentElement.clientWidth ? c.parentElement.clientWidth : (c.clientWidth || 320);
    const parentH = c.parentElement && c.parentElement.clientHeight ? c.parentElement.clientHeight : (c.clientHeight || 180);
    c.width = Math.max(220, parentW);
    c.height = Math.max(140, parentH);
    const ctx = c.getContext("2d");
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);

    const totalDice = counts6.reduce((a, b) => a + b, 0);
    const expectedVal = totalDice / 6;
    const maxVal = Math.max(5, Math.ceil(expectedVal * 1.35), ...counts6);
    const padL = 32, padR = 16, padT = 20, padB = 28;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const colors = ["#ef4444", "#334155", "#334155", "#0284c7", "#0284c7", "#a855f7"];
    const labels = ["⚀ 1", "⚁ 2", "⚂ 3", "⚃ 4", "⚄ 5", "⚅ 6"];

    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const gy = padT + (plotH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(w - padR, gy);
      ctx.stroke();
    }

    const slotW = plotW / 6;
    const barW = Math.min(44, slotW * 0.62);

    for (let i = 0; i < 6; i++) {
      const val = counts6[i] || 0;
      const bh = (val / maxVal) * plotH;
      const bx = padL + i * slotW + (slotW - barW) * 0.5;
      const by = padT + plotH - bh;

      ctx.fillStyle = colors[i];
      ctx.fillRect(bx, by, barW, bh);

      ctx.fillStyle = "#cbd5e1";
      ctx.font = "bold 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(labels[i], bx + barW * 0.5, h - 8);
      if (val > 0) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px JetBrains Mono, monospace";
        ctx.fillText(`${val}`, bx + barW * 0.5, Math.max(13, by - 5));
      }
    }

    // Draw Expected (N/6) reference line when dice have been rolled
    if (totalDice > 0) {
      const expY = padT + plotH - (expectedVal / maxVal) * plotH;
      ctx.save();
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(padL, expY);
      ctx.lineTo(w - padR, expY);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- Session Control ---
  startGame() {
    this.sessionActive = true;
    this.history = [];
    this.distribution = [0, 0, 0, 0, 0, 0, 0];
    this.lockedRollDice = [];
    this.lastLockedSpatialDice = [];
    this.hadLockedRollBeforeMotion = false;
    this.currentRollPhase = "Hit Roll";
    this.rollPhaseBadge.innerText = "Phase: Hit Roll";
    this.sessionStatus.innerText = "Session Active";
    this.sessionStatus.className = "badge status-active";
    this.btnStartGame.disabled = false;
    this.btnEndGame.disabled = false;
    this.btnRerollHits.disabled = true;
    if (this.btnUndoLastRoll) this.btnUndoLastRoll.disabled = true;
    this.updateStatsUI();
    this.renderLastRollBadges([]);
    this.updateFaceSummaryStrip([]);
  }

  endGame() {
    this.sessionActive = false;
    this.sessionStatus.innerText = "Session Paused";
    this.sessionStatus.className = "badge status-inactive";
  }

  resetStats() {
    this.history = [];
    this.distribution = [0, 0, 0, 0, 0, 0, 0];
    this.lockedRollDice = [];
    this.lastLockedSpatialDice = [];
    this.hadLockedRollBeforeMotion = false;
    this.btnRerollHits.disabled = true;
    this.btnRerollCount.innerText = "0";
    if (this.btnUndoLastRoll) this.btnUndoLastRoll.disabled = true;
    this.updateStatsUI();
    this.renderLastRollBadges([]);
    this.updateFaceSummaryStrip([]);
  }

  undoLastRoll() {
    if (this.history.length === 0) return;
    const removed = this.history.shift();
    this.rebuildDistributionFromHistory();
    this.updateStatsUI();
    if (this.history.length > 0) {
      this.renderLastRollBadges(this.history[0].values);
    } else {
      this.renderLastRollBadges([]);
    }
    if (this.btnUndoLastRoll) {
      this.btnUndoLastRoll.disabled = this.history.length === 0;
    }
    this.updateStateMachineUI(
      "IDLE",
      `↩ Undid Roll #${removed.rollNum} (${removed.count} dice). Ready for next roll.`,
      0
    );
  }

  // --- Camera Operations & Hardware Torch / Zoom / Multi-Lens ---
  async toggleCamera() {
    if (this.isCameraRunning) {
      this.stopCamera();
    } else {
      await this.startCamera();
    }
  }

  async enumerateCameraLenses() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(d => d.kind === "videoinput" && d.deviceId);
      if (videoInputs.length <= 1) return;
      const currentVal = this.cameraSelect.value;
      const existingCustom = this.cameraSelect.querySelectorAll("option[data-device-id]");
      existingCustom.forEach(o => o.remove());
      videoInputs.forEach((dev, idx) => {
        const opt = document.createElement("option");
        opt.value = `device:${dev.deviceId}`;
        opt.setAttribute("data-device-id", dev.deviceId);
        opt.textContent = dev.label || `Camera Lens #${idx + 1}`;
        this.cameraSelect.appendChild(opt);
      });
      if (currentVal) this.cameraSelect.value = currentVal;
    } catch (_e) {}
  }

  async startCamera() {
    try {
      this.stopSimulationStream();
      if (this.stream) {
        this.stream.getTracks().forEach(t => t.stop());
      }

      const selectedMode = this.cameraSelect.value;
      const videoConstraint = selectedMode.startsWith("device:")
        ? { deviceId: { exact: selectedMode.slice(7) }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: { ideal: selectedMode }, width: { ideal: 1280 }, height: { ideal: 720 } };

      this.stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
      this.video.srcObject = this.stream;
      await this.video.play();
      await this.enumerateCameraLenses();

      // Check hardware Torch & Zoom capabilities
      const [track] = this.stream.getVideoTracks();
      if (track && typeof track.getCapabilities === "function") {
        const caps = track.getCapabilities() || {};
        if (this.btnTorchToggle) {
          this.btnTorchToggle.classList.toggle("hidden", !caps.torch);
        }
      }

      this.isCameraRunning = true;
      this.btnToggleCam.innerText = "⏹ Stop Camera";
      this.btnToggleCam.className = "btn btn-danger";
      this.scannerOverlay.classList.add("hidden");
      this.btnCaptureRoll.disabled = false;

      this.canvas.width = 640;
      this.canvas.height = 480;
      this.ensureCvBuffers(640, 480);
      this.lastRoiGray = null;
      this.rollState = "IDLE";

      this.requestFrameProcessing();
    } catch (err) {
      console.error("Camera access error:", err);
      this.scannerText.innerText = `Camera error: ${err.message}. Click "🎲 Roll 40 Dice (Live CV)" to test with simulated camera stream!`;
    }
  }

  async toggleCameraTorch() {
    if (!this.stream) return;
    const [track] = this.stream.getVideoTracks();
    if (!track || typeof track.applyConstraints !== "function") return;
    try {
      this.torchEnabled = !this.torchEnabled;
      await track.applyConstraints({ advanced: [{ torch: this.torchEnabled }] });
      if (this.btnTorchToggle) {
        this.btnTorchToggle.className = this.torchEnabled ? "btn btn-sm btn-accent" : "btn btn-sm btn-outline";
      }
    } catch (_e) {
      this.torchEnabled = false;
    }
  }

  async applyCameraZoom(zoomVal) {
    this.cameraZoom = Math.max(1.0, Math.min(3.0, zoomVal));
    if (this.camZoomVal) this.camZoomVal.innerText = `${this.cameraZoom.toFixed(1)}x`;
    if (this.stream) {
      const [track] = this.stream.getVideoTracks();
      if (track && typeof track.getCapabilities === "function" && typeof track.applyConstraints === "function") {
        try {
          const caps = track.getCapabilities() || {};
          if (caps.zoom) {
            const clamped = Math.max(caps.zoom.min || 1, Math.min(caps.zoom.max || 3, this.cameraZoom));
            await track.applyConstraints({ advanced: [{ zoom: clamped }] });
          }
        } catch (_e) {}
      }
    }
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.isCameraRunning = false;
    this.torchEnabled = false;
    if (this.btnTorchToggle) this.btnTorchToggle.classList.add("hidden");
    this.btnToggleCam.innerText = "📷 Start Camera";
    this.btnToggleCam.className = "btn btn-secondary";
    this.btnCaptureRoll.disabled = !this.isSimulationMode;
  }

  requestFrameProcessing() {
    if (!this.isCameraRunning) return;
    const vw = this.video.videoWidth || this.canvas.width;
    const vh = this.video.videoHeight || this.canvas.height;
    if (vw > 0 && vh > 0) {
      // Aspect-preserving object-fit: cover center crop prevents 2.37x portrait mobile squish
      const canvasAspect = this.canvas.width / this.canvas.height;
      const videoAspect = vw / vh;
      let baseW = vw;
      let baseH = vh;
      if (videoAspect > canvasAspect) {
        baseW = vh * canvasAspect;
      } else if (videoAspect < canvasAspect) {
        baseH = vw / canvasAspect;
      }
      const zoom = Math.max(1.0, this.cameraZoom || 1.0);
      const cropW = baseW / zoom;
      const cropH = baseH / zoom;
      const sx = (vw - cropW) * 0.5;
      const sy = (vh - cropH) * 0.5;
      this.ctx.drawImage(this.video, sx, sy, cropW, cropH, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    }
    this.processCurrentCanvasFrame();
    requestAnimationFrame(() => this.requestFrameProcessing());
  }

  // ============================================================================
  // CORE PIPELINE: STRICT ROI MOTION STATE MACHINE + 2-STAGE ADAPTIVE CV ENGINE
  // ============================================================================
  processCurrentCanvasFrame() {
    const t0 = performance.now();
    const width = this.canvas.width;
    const height = this.canvas.height;
    this.ensureCvBuffers(width, height);

    const frameData = this.ctx.getImageData(0, 0, width, height);
    const data = frameData.data;

    // 1. Compute ROI bounds (strictly inside the green Dice Tray Box)
    const rx = Math.max(8, Math.floor(width * this.roiBox.x));
    const ry = Math.max(8, Math.floor(height * this.roiBox.y));
    const rw = Math.min(width - rx - 8, Math.floor(width * this.roiBox.w));
    const rh = Math.min(height - ry - 8, Math.floor(height * this.roiBox.h));

    // 2. Single-pass Fused RGB->Grayscale + Integral Image (SAT) strictly over ROI + surround margin
    const gray = this._grayBuf;
    const sat = this._satBuf;
    const satW = width + 1;
    const rSurround = 10;
    const xStart = Math.max(rSurround + 1, rx + 6);
    const xEnd = Math.min(width - rSurround - 1, rx + rw - 6);
    const yStart = Math.max(rSurround + 1, ry + 6);
    const yEnd = Math.min(height - rSurround - 1, ry + rh - 6);

    const satY0 = Math.max(1, Math.min(ry, yStart - rSurround));
    const satY1 = Math.min(height, Math.max(ry + rh, yEnd + rSurround + 1));
    const satX0 = Math.max(1, Math.min(rx, xStart - rSurround));
    const satX1 = Math.min(width, Math.max(rx + rw, xEnd + rSurround + 1));

    const zeroRowOff = (satY0 - 1) * satW;
    for (let x = satX0 - 1; x <= satX1; x++) {
      sat[zeroRowOff + x] = 0;
    }

    for (let y = satY0; y <= satY1; y++) {
      let rowSum = 0;
      const grayRowOffset = (y - 1) * width;
      const satRowOffset = y * satW;
      const satPrevRowOffset = (y - 1) * satW;
      sat[satRowOffset + satX0 - 1] = 0;
      let rgbaIdx = (grayRowOffset + satX0 - 1) * 4;
      for (let x = satX0; x <= satX1; x++, rgbaIdx += 4) {
        const lum = (77 * data[rgbaIdx] + 150 * data[rgbaIdx + 1] + 29 * data[rgbaIdx + 2]) >> 8;
        gray[grayRowOffset + x - 1] = lum;
        rowSum += lum;
        sat[satRowOffset + x] = sat[satPrevRowOffset + x] + rowSum;
      }
    }

    // 3. Measure motion ONLY inside the Dice Tray ROI (ignores outside table movement)
    const roiMotion = this.computeRoiMotion(gray, width, rx, ry, rw, rh);

    // 4. Run 2-Stage Adaptive Die-Body + Dual-Polarity Pip CV inside ROI
    const rawDetections = this.detectDiceTwoStageAdaptive(gray, data, width, height, rx, ry, rw, rh, true);

    // 5. Update Hands-Free Roll Lifecycle State Machine
    this.stepRollStateMachine(roiMotion, rawDetections, data, width, height);

    const elapsedMs = performance.now() - t0;
    this.cvLatencyEmaMs = this.cvLatencyEmaMs === 0 ? elapsedMs : this.cvLatencyEmaMs * 0.85 + elapsedMs * 0.15;
    if (this.cvPerfBadge && t0 - this._lastPerfUiUpdateMs >= 400) {
      this._lastPerfUiUpdateMs = t0;
      const fpsCap = Math.min(120, Math.round(1000 / Math.max(1, this.cvLatencyEmaMs)));
      this.cvPerfBadge.innerText = `⚡ ${this.cvLatencyEmaMs.toFixed(1)}ms (${fpsCap}fps)`;
    }

    // 6. Render tray mask, draggable ROI handles, and per-die bounding boxes
    this.drawDetectionsOverlay(this.currentDetectedDice, rx, ry, rw, rh);
    this.updateLiveHudCounts(this.currentDetectedDice);
  }

  computeRoiMotion(gray, width, rx, ry, rw, rh) {
    const sampleStep = 4;
    const cols = Math.floor(rw / sampleStep);
    const rows = Math.floor(rh / sampleStep);
    const sampleLen = cols * rows;

    if (!this.lastRoiGray || this.lastRoiGray.length !== sampleLen) {
      this.lastRoiGray = new Uint8Array(sampleLen);
      let k = 0;
      for (let r = 0; r < rows; r++) {
        const y = ry + r * sampleStep;
        for (let c = 0; c < cols; c++) {
          this.lastRoiGray[k++] = gray[y * width + (rx + c * sampleStep)];
        }
      }
      return 0;
    }

    let changedPixels = 0;
    let k = 0;
    // Higher per-pixel luminance threshold (28) + EMA background adaptation suppresses mobile camera grain & micro-shake
    for (let r = 0; r < rows; r++) {
      const y = ry + r * sampleStep;
      for (let c = 0; c < cols; c++) {
        const currVal = gray[y * width + (rx + c * sampleStep)];
        const prevVal = this.lastRoiGray[k];
        if (Math.abs(currVal - prevVal) > 28) {
          changedPixels++;
        }
        this.lastRoiGray[k] = (prevVal + currVal) >> 1;
        k++;
      }
    }

    return sampleLen > 0 ? changedPixels / sampleLen : 0;
  }

  // Stationary-subset "Scoop Guard": returns true if the newly settled dice are simply a stationary
  // subset of the previously locked dice (i.e. player scooped out failed dice without rolling the rest).
  isStationaryScoopSubset(newDice) {
    if (!this.chkScoopGuard || !this.chkScoopGuard.checked) return false;
    if (this.isChainedSimRoll) return false;
    if (!this.hadLockedRollBeforeMotion || !this.lastLockedSpatialDice || this.lastLockedSpatialDice.length === 0) {
      return false;
    }
    if (newDice.length === 0 || newDice.length >= this.lastLockedSpatialDice.length) {
      return false;
    }

    const usedPrev = new Uint8Array(this.lastLockedSpatialDice.length);
    let stationaryMatches = 0;

    for (let i = 0; i < newDice.length; i++) {
      const nd = newDice[i];
      const ncx = nd.x + nd.w * 0.5;
      const ncy = nd.y + nd.h * 0.5;
      const tol = Math.max(14, (nd.w || 32) * 0.42);

      let matchedIdx = -1;
      let bestDist = Infinity;
      for (let j = 0; j < this.lastLockedSpatialDice.length; j++) {
        if (usedPrev[j]) continue;
        const prev = this.lastLockedSpatialDice[j];
        if (prev.value !== nd.value) continue;
        const dist = Math.hypot(ncx - prev.cx, ncy - prev.cy);
        if (dist <= tol && dist < bestDist) {
          bestDist = dist;
          matchedIdx = j;
        }
      }
      if (matchedIdx !== -1) {
        usedPrev[matchedIdx] = 1;
        stationaryMatches++;
      }
    }

    return stationaryMatches / newDice.length >= 0.8;
  }

  stepRollStateMachine(roiMotion, rawDetections, rgba, width, height) {
    const settleFramesRequired = parseInt(this.bgFilterSlider.value, 10) || 12;
    const MOTION_ENTER = 0.032;
    const MOTION_SETTLE = 0.022;

    if (!this.chkAutoCapture.checked) {
      this.currentDetectedDice = rawDetections;
      return;
    }

    if (rawDetections.length > 0) {
      this.consecutiveDiceFrames++;
      this.emptyFramesCount = 0;
    } else {
      this.consecutiveDiceFrames = Math.max(0, this.consecutiveDiceFrames - 1);
      this.emptyFramesCount++;
    }

    if (roiMotion > MOTION_ENTER) {
      this.motionFramesCount++;
    } else if (roiMotion < MOTION_SETTLE) {
      this.motionFramesCount = 0;
    }

    // Case 1: Tray is empty & IDLE — ignore handheld camera motion completely
    if (this.rollState === "IDLE" && rawDetections.length === 0) {
      this.settledFrameCounter = 0;
      this.settlingBuffer = [];
      this.currentDetectedDice = [];
      this.updateStateMachineUI("IDLE", "🟢 Ready — Throw dice into tray", 0);
      return;
    }

    // Pre-gate: While IDLE, require 3+ consecutive frames with dice before changing the UI pill
    // (silently accumulate settling frames so genuine rolls still lock in exact settleFramesRequired)
    if (this.rollState === "IDLE" && this.consecutiveDiceFrames < 3) {
      if (roiMotion <= MOTION_ENTER && rawDetections.length > 0) {
        this.settledFrameCounter++;
        this.settlingBuffer.push(rawDetections);
      } else {
        this.settledFrameCounter = 0;
        this.settlingBuffer = [];
      }
      return;
    }

    // Case 2: Motion detected inside the tray while dice are confirmed present OR unlocking from a LOCKED roll
    const isGenuineMotion =
      roiMotion >= 0.042 ||
      (roiMotion > MOTION_ENTER && (this.motionFramesCount >= 2 || this.rollState === "ROLLING"));

    if (isGenuineMotion && (rawDetections.length > 0 || this.rollState !== "IDLE")) {
      if (this.rollState === "LOCKED" && this.lockedRollDice.length > 0) {
        this.hadLockedRollBeforeMotion = true;
      }
      this.rollState = "ROLLING";
      this.settledFrameCounter = 0;
      this.settlingBuffer = [];
      this.currentDetectedDice = rawDetections;
      this.updateStateMachineUI(
        "ROLLING",
        "🟠 Rolling in tray — waiting for dice to stop...",
        15
      );
      return;
    }

    // Case 3: Tray is still and all dice were scooped out -> return smoothly to IDLE after 8 quiet frames
    if (rawDetections.length === 0) {
      if (this.emptyFramesCount >= 8) {
        this.rollState = "IDLE";
        this.settledFrameCounter = 0;
        this.consecutiveDiceFrames = 0;
        this.settlingBuffer = [];
        this.lockedDiceSignature = "";
        this.lastLockedSpatialDice = [];
        this.hadLockedRollBeforeMotion = false;
        this.currentDetectedDice = [];
        this.updateStateMachineUI("IDLE", "🟢 Tray Empty — Ready for next roll!", 0);
      }
      return;
    }

    // Case 4: Currently LOCKED — stay locked until genuine motion or tray cleared!
    if (this.rollState === "LOCKED") {
      this.currentDetectedDice = this.lockedRollDice;
      return;
    }

    // Case 5: Tray was IDLE/ROLLING/SETTLING with dice present and motion subsided
    if (this.rollState === "IDLE" || this.rollState === "ROLLING" || this.rollState === "SETTLING") {
      this.rollState = "SETTLING";
      this.settledFrameCounter++;
      this.settlingBuffer.push(rawDetections);

      const consensusDice = this.computeTemporalConsensus(this.settlingBuffer);
      this.currentDetectedDice = consensusDice;

      const progressPct = Math.min(100, Math.round((this.settledFrameCounter / settleFramesRequired) * 100));
      // Only update hint text on initial settle frame or every 3rd frame to avoid rapid text jitter
      if (this.settledFrameCounter === 1 || this.settledFrameCounter % 3 === 0 || this.settledFrameCounter === settleFramesRequired) {
        this.updateStateMachineUI(
          "SETTLING",
          `🔵 Locking ${consensusDice.length} dice... (${this.settledFrameCounter}/${settleFramesRequired})`,
          progressPct
        );
      } else if (this.settlingProgressBar) {
        this.settlingProgressBar.style.width = `${progressPct}%`;
      }

      if (this.settledFrameCounter >= settleFramesRequired && consensusDice.length > 0) {
        // Tag each die with Player 1 / Player 2 owner based on calibrated color profiles
        consensusDice.forEach(d => {
          d.owner = this.classifyDieOwner(d, rgba, width, height);
        });

        // Check Scoop Guard before recording a new roll!
        if (this.isStationaryScoopSubset(consensusDice)) {
          this.rollState = "LOCKED";
          this.lockedRollDice = consensusDice.map(d => ({ ...d }));
          this.currentDetectedDice = this.lockedRollDice;
          this.lastLockedSpatialDice = this.lockedRollDice.map(d => ({
            cx: d.x + d.w * 0.5,
            cy: d.y + d.h * 0.5,
            value: d.value,
            w: d.w
          }));
          const targetVal = parseInt(this.targetSuccess.value, 10);
          const hitsLeft = this.lockedRollDice.filter(d => d.value >= targetVal).length;
          this.btnRerollCount.innerText = hitsLeft;
          this.btnRerollHits.disabled = hitsLeft === 0;
          this.updateStateMachineUI(
            "LOCKED",
            `🛡️ Scoop Guard: ${consensusDice.length} stationary dice left (duplicate suppressed)`,
            100
          );
          return;
        }

        this.rollState = "LOCKED";
        this.isChainedSimRoll = false;
        this.lockedRollDice = consensusDice.map(d => ({ ...d }));
        this.currentDetectedDice = this.lockedRollDice;
        this.lockedDiceSignature = this.computePoolSignature(this.lockedRollDice);
        this.lastLockedSpatialDice = this.lockedRollDice.map(d => ({
          cx: d.x + d.w * 0.5,
          cy: d.y + d.h * 0.5,
          value: d.value,
          w: d.w
        }));
        this.hadLockedRollBeforeMotion = true;

        if (!this.sessionActive) {
          this.sessionActive = true;
          this.sessionStatus.innerText = "Session Active";
          this.sessionStatus.className = "badge status-active";
        }

        this.captureCurrentRoll("Auto-Lock");
      }
    }
  }

  computePoolSignature(diceList) {
    const sorted = [...diceList].sort((a, b) => a.value - b.value);
    return `${sorted.length}:${sorted.map(d => d.value).join(",")}`;
  }

  computeTemporalConsensus(buffer) {
    if (buffer.length === 0) return [];
    const latest = buffer[buffer.length - 1];
    if (buffer.length === 1) return latest;

    const recentFrames = buffer.slice(-Math.min(buffer.length, 10));
    const tracks = [];
    const DIST_TOL = 18;

    recentFrames.forEach(frameDice => {
      frameDice.forEach(d => {
        const cx = d.x + d.w / 2;
        const cy = d.y + d.h / 2;
        const existing = tracks.find(t => Math.hypot(t.cx - cx, t.cy - cy) <= DIST_TOL);
        if (existing) {
          existing.cx = (existing.cx * existing.count + cx) / (existing.count + 1);
          existing.cy = (existing.cy * existing.count + cy) / (existing.count + 1);
          existing.w = Math.round((existing.w + d.w) / 2);
          existing.h = Math.round((existing.h + d.h) / 2);
          existing.votes[d.value] = (existing.votes[d.value] || 0) + 1;
          existing.count++;
          existing.polarity = d.polarity;
          existing.isCustomSymbol = existing.isCustomSymbol || d.isCustomSymbol;
          existing.owner = d.owner || existing.owner;
        } else {
          const votes = {};
          votes[d.value] = 1;
          tracks.push({
            cx, cy,
            w: d.w, h: d.h,
            votes,
            count: 1,
            polarity: d.polarity,
            isCustomSymbol: d.isCustomSymbol,
            owner: d.owner || 1
          });
        }
      });
    });

    const minHits = Math.max(1, Math.floor(recentFrames.length * 0.45));
    const consensus = [];

    tracks.forEach(t => {
      if (t.count >= minHits) {
        let bestVal = 1;
        let bestVotes = -1;
        for (let v = 1; v <= 6; v++) {
          if ((t.votes[v] || 0) > bestVotes) {
            bestVotes = t.votes[v] || 0;
            bestVal = v;
          }
        }
        consensus.push({
          x: Math.round(t.cx - t.w / 2),
          y: Math.round(t.cy - t.h / 2),
          w: t.w,
          h: t.h,
          value: bestVal,
          polarity: t.polarity,
          isCustomSymbol: t.isCustomSymbol,
          owner: t.owner || 1
        });
      }
    });

    return consensus;
  }

  // ============================================================================
  // MULTI-SCALE DoG + SADDLE-VALLEY DECOMPOSITION + ADAPTIVE PIP DETECTOR
  // ============================================================================
  detectDiceTwoStageAdaptive(gray, rgba, width, height, rx, ry, rw, rh, satPrecomputed = false) {
    this.ensureCvBuffers(width, height);
    const contrastSensitivity = parseInt(this.thresholdSlider.value, 10) || 22;
    const minDiePx = parseInt(this.minDiceSize.value, 10) || 22;
    const colorMode = this.diceColorMode ? this.diceColorMode.value : "auto";
    const detectCustomSix = this.chkCustomSixSymbol ? this.chkCustomSixSymbol.checked : true;
    const allowLightDice = colorMode === "auto" || colorMode === "light";
    const allowDarkDice = colorMode === "auto" || colorMode === "dark";

    const satW = width + 1;
    const sat = this._satBuf;
    const visited = this._visitedBuf;
    const bfsX = this._bfsX;
    const bfsY = this._bfsY;

    const rSurround = 9;
    const rBg1B = 10;
    const xStart = Math.max(rBg1B + 2, rx + 6);
    const xEnd = Math.min(width - rBg1B - 2, rx + rw - 6);
    const yStart = Math.max(rBg1B + 2, ry + 6);
    const yEnd = Math.min(height - rBg1B - 2, ry + rh - 6);

    if (!satPrecomputed) {
      const satY0 = Math.max(1, yStart - rBg1B - 1);
      const satY1 = Math.min(height, yEnd + rBg1B + 2);
      const satX0 = Math.max(1, xStart - rBg1B - 1);
      const satX1 = Math.min(width, xEnd + rBg1B + 2);
      const zeroRowOff = (satY0 - 1) * satW;
      for (let x = satX0 - 1; x <= satX1; x++) sat[zeroRowOff + x] = 0;
      for (let y = satY0; y <= satY1; y++) {
        let rowSum = 0;
        const grayRowOffset = (y - 1) * width;
        const satRowOffset = y * satW;
        const satPrevRowOffset = (y - 1) * satW;
        sat[satRowOffset + satX0 - 1] = 0;
        for (let x = satX0; x <= satX1; x++) {
          rowSum += gray[grayRowOffset + x - 1];
          sat[satRowOffset + x] = sat[satPrevRowOffset + x] + rowSum;
        }
      }
    }

    visited.fill(0, yStart * width, yEnd * width);

    const candidatePips = [];
    const candidateEmblems = [];
    const invWindowArea = 1 / ((2 * rSurround + 1) * (2 * rSurround + 1));
    const invInnerArea = 1 / 9;
    const invQuadArea = 1 / 49;

    const boxMean = (cx, cy, r) => {
      const x0 = Math.max(0, cx - r);
      const y0 = Math.max(0, cy - r);
      const x1 = Math.min(width, cx + r + 1);
      const y1 = Math.min(height, cy + r + 1);
      return (sat[y1 * satW + x1] - sat[y0 * satW + x1] - sat[y1 * satW + x0] + sat[y0 * satW + x0]) / ((x1 - x0) * (y1 - y0));
    };

    // Stage 1A: High-Contrast Flood-Fill Connected Components (Clean Pips + Custom 6 Emblems)
    for (let y = yStart; y < yEnd; y++) {
      const rowOff = y * width;
      const satTopRow = (y - rSurround - 1) * satW;
      const satBotRow = (y + rSurround) * satW;

      for (let x = xStart; x < xEnd; x++) {
        const idx = rowOff + x;
        if (visited[idx]) continue;

        const pix = gray[idx];
        const xL = x - rSurround - 1;
        const xR = x + rSurround;
        const localMean = (
          sat[satBotRow + xR] -
          sat[satTopRow + xR] -
          sat[satBotRow + xL] +
          sat[satTopRow + xL]
        ) * invWindowArea;
        const delta = pix - localMean;

        let isDarkPip = false;
        if (allowLightDice && delta <= -contrastSensitivity && localMean > 105) {
          if (gray[idx - 2] <= 105 || gray[idx - width * 2] <= 105) continue;
          isDarkPip = true;
        } else if (!(allowDarkDice && delta >= contrastSensitivity && pix > 150 && localMean < 140)) {
          continue;
        }

        let head = 0;
        let tail = 0;
        bfsX[tail] = x;
        bfsY[tail] = y;
        tail++;
        visited[idx] = 1;

        let sumX = 0;
        let sumY = 0;
        let sumLum = 0;
        let peakLum = pix;
        let minBx = x, maxBx = x, minBy = y, maxBy = y;
        const pipThreshLum = isDarkPip
          ? localMean - contrastSensitivity * 0.6
          : localMean + contrastSensitivity * 0.6;

        while (head < tail && tail < 850) {
          const px = bfsX[head];
          const py = bfsY[head];
          head++;

          const pLum = gray[py * width + px];
          sumX += px;
          sumY += py;
          sumLum += pLum;
          if (isDarkPip ? pLum < peakLum : pLum > peakLum) peakLum = pLum;
          if (px < minBx) minBx = px;
          if (px > maxBx) maxBx = px;
          if (py < minBy) minBy = py;
          if (py > maxBy) maxBy = py;

          if (px + 1 < xEnd) {
            const nIdx = py * width + px + 1;
            if (!visited[nIdx] && (isDarkPip ? gray[nIdx] <= pipThreshLum : gray[nIdx] >= pipThreshLum)) {
              visited[nIdx] = 1;
              if (tail < 850) { bfsX[tail] = px + 1; bfsY[tail] = py; tail++; }
            }
          }
          if (px - 1 >= xStart) {
            const nIdx = py * width + px - 1;
            if (!visited[nIdx] && (isDarkPip ? gray[nIdx] <= pipThreshLum : gray[nIdx] >= pipThreshLum)) {
              visited[nIdx] = 1;
              if (tail < 850) { bfsX[tail] = px - 1; bfsY[tail] = py; tail++; }
            }
          }
          if (py + 1 < yEnd) {
            const nIdx = (py + 1) * width + px;
            if (!visited[nIdx] && (isDarkPip ? gray[nIdx] <= pipThreshLum : gray[nIdx] >= pipThreshLum)) {
              visited[nIdx] = 1;
              if (tail < 850) { bfsX[tail] = px; bfsY[tail] = py + 1; tail++; }
            }
          }
          if (py - 1 >= yStart) {
            const nIdx = (py - 1) * width + px;
            if (!visited[nIdx] && (isDarkPip ? gray[nIdx] <= pipThreshLum : gray[nIdx] >= pipThreshLum)) {
              visited[nIdx] = 1;
              if (tail < 850) { bfsX[tail] = px; bfsY[tail] = py - 1; tail++; }
            }
          }
        }

        const area = head;
        const bW = maxBx - minBx + 1;
        const bH = maxBy - minBy + 1;
        const aspect = bW / (bH || 1);
        const fillRatio = area / (bW * bH);
        const cx = sumX / area;
        const cy = sumY / area;

        const ringR = area > 120
          ? Math.max(10, Math.round(Math.max(bW, bH) * 0.72))
          : Math.max(4, Math.min(6, Math.round(Math.min(bW, bH) * 0.75)));
        const diagR = Math.max(3, Math.round(ringR * 0.707));
        const blobMeanLum = sumLum / area;
        const rcx = Math.round(cx);
        const rcy = Math.round(cy);
        const minContrast = contrastSensitivity * 0.75;
        let validRingPts = 0;
        let validRingLumSum = 0;

        for (let rIdx = 0; rIdx < 8; rIdx++) {
          const rxPt = rcx + (rIdx === 0 ? -ringR : rIdx === 1 ? ringR : rIdx < 4 ? 0 : rIdx < 6 ? -diagR : diagR);
          const ryPt = rcy + (rIdx < 2 ? 0 : rIdx === 2 ? -ringR : rIdx === 3 ? ringR : (rIdx & 1) === 0 ? -diagR : diagR);
          if (rxPt >= xStart && rxPt < xEnd && ryPt >= yStart && ryPt < yEnd) {
            const rLum = gray[ryPt * width + rxPt];
            if (isDarkPip) {
              if (rLum - blobMeanLum >= minContrast && rLum > 110) {
                validRingPts++;
                validRingLumSum += rLum;
              }
            } else {
              if (blobMeanLum - rLum >= minContrast && rLum < 135) {
                validRingPts++;
                validRingLumSum += rLum;
              }
            }
          }
        }

        const polarity = isDarkPip ? "dark_pip" : "light_pip";
        const eqDiam = Math.max(bW, bH, Math.sqrt(area / Math.PI) * 2.15);

        if (
          area >= 4 &&
          area <= (isDarkPip ? 155 : 53) &&
          bW >= 2 &&
          bW <= 17 &&
          bH >= 2 &&
          bH <= 17 &&
          aspect >= 0.62 &&
          aspect <= 1.65 &&
          fillRatio >= 0.36 &&
          validRingPts >= 6 &&
          (isDarkPip || (peakLum >= 195 && blobMeanLum >= 165))
        ) {
          candidatePips.push({
            x: cx,
            y: cy,
            size: eqDiam,
            area,
            polarity,
            bodyLum: validRingLumSum / validRingPts,
            peakLum
          });
        } else if (
          detectCustomSix &&
          area >= 156 &&
          area <= 540 &&
          bW >= 12 &&
          bW <= 34 &&
          bH >= 12 &&
          bH <= 34 &&
          aspect >= 0.65 &&
          aspect <= 1.55 &&
          validRingPts >= 7 &&
          (isDarkPip || (peakLum >= 195 && blobMeanLum >= 165))
        ) {
          candidateEmblems.push({
            x: cx,
            y: cy,
            size: Math.max(bW, bH),
            polarity,
            bodyLum: validRingLumSum / validRingPts
          });
        }
      }
    }

    // Stage 1B: Translucent & Colored Physical Dice Crisp White-Pip 5x5 Peak Detector
    // Detects bright white pips (val >= 225, 3x3 core >= 232) on medium-bright colored or
    // translucent dice bodies (bg9 in 95..212) and decomposes subsurface-scattered pip clusters.
    if (allowDarkDice) {
      const brightPeaks = [];
      const minBrightProm = Math.max(32, contrastSensitivity * 1.4);
      const rRing5 = 5;
      const dRing4 = 4;
      const rxOff5 = [-rRing5, rRing5, 0, 0, -dRing4, dRing4, -dRing4, dRing4];
      const ryOff5 = [0, 0, -rRing5, rRing5, -dRing4, -dRing4, dRing4, dRing4];

      for (let y = yStart + 3; y < yEnd - 3; y++) {
        const rowOff = y * width;
        for (let x = xStart + 3; x < xEnd - 3; x++) {
          const idx = rowOff + x;
          const val = gray[idx];
          if (val < 225) continue;

          // Fast 4-cardinal neighbor pre-check before 5x5 loop (skips flat white die bodies in O(1))
          if (
            gray[idx - 1] >= val ||
            gray[idx + 1] > val ||
            gray[idx - width] >= val ||
            gray[idx + width] > val
          ) {
            continue;
          }

          // 5x5 Non-Maximum Suppression with tie-breaking
          let isMax5 = true;
          for (let dy = -2; dy <= 2 && isMax5; dy++) {
            const rOff = (y + dy) * width;
            for (let dx = -2; dx <= 2; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nv = gray[rOff + x + dx];
              if (dy < 0 || (dy === 0 && dx < 0) ? nv >= val : nv > val) {
                isMax5 = false;
                break;
              }
            }
          }
          if (!isMax5) continue;

          const in1 = boxMean(x, y, 1);
          if (in1 < 232) continue;

          const bg9 = boxMean(x, y, 9);
          if (bg9 < 95 || bg9 > 212) continue;

          const prom = in1 - bg9;
          if (prom < minBrightProm) continue;

          let validPts = 0;
          let ringSum = 0;
          for (let k = 0; k < 8; k++) {
            const rl = gray[(y + ryOff5[k]) * width + (x + rxOff5[k])];
            if (val - rl >= 22 && rl >= 95 && rl <= 228) {
              validPts++;
              ringSum += rl;
            }
          }
          if (validPts < 6) continue;

          brightPeaks.push({
            x,
            y,
            size: 5.5,
            area: 24,
            polarity: "light_pip",
            bodyLum: ringSum / validPts,
            peakLum: val,
            val,
            bgMean: bg9,
            prom
          });
        }
      }

      if (brightPeaks.length > 0) {
        brightPeaks.sort((a, b) => b.val - a.val);
        const dedupedBright = [];
        for (let i = 0; i < brightPeaks.length; i++) {
          const p = brightPeaks[i];
          if (candidateEmblems.some(emb => Math.hypot(emb.x - p.x, emb.y - p.y) <= emb.size * 0.75)) {
            continue;
          }
          if (!dedupedBright.some(ex => Math.hypot(ex.x - p.x, ex.y - p.y) < 3.8)) {
            dedupedBright.push(p);
          }
        }

        // Remove any Stage 1A light_pip blob that overlaps a Stage 1B peak
        for (let j = candidatePips.length - 1; j >= 0; j--) {
          const cp = candidatePips[j];
          if (
            cp.polarity === "light_pip" &&
            dedupedBright.some(bp => Math.hypot(cp.x - bp.x, cp.y - bp.y) <= Math.max(6.0, cp.size * 0.85))
          ) {
            candidatePips.splice(j, 1);
          }
        }
        for (let i = 0; i < dedupedBright.length; i++) {
          candidatePips.push(dedupedBright[i]);
        }
      }
    }

    // Stage 1C: Pitch-Dark Room / Low-Exposure Camera Fallback (ONLY when tray median lum <= 22 and no normal pips found)
    if (allowDarkDice && candidatePips.length === 0 && candidateEmblems.length === 0) {
      const sampleLums = [];
      for (let sy = 1; sy <= 5; sy++) {
        const py = Math.round(yStart + ((yEnd - yStart) * sy) / 6);
        for (let sx = 1; sx <= 5; sx++) {
          const px = Math.round(xStart + ((xEnd - xStart) * sx) / 6);
          sampleLums.push(boxMean(px, py, 4));
        }
      }
      sampleLums.sort((a, b) => a - b);
      const trayMedianLum = sampleLums[12] || 60;

      if (trayMedianLum <= 22) {
        const rawPeaks = [];
        const minProm = Math.max(18, contrastSensitivity);
        const invBg1BArea = 1 / ((2 * rBg1B + 1) * (2 * rBg1B + 1));
        const rRing = 10;
        const dRing = 7;
        const rxOff = [-rRing, rRing, 0, 0, -dRing, dRing, -dRing, dRing];
        const ryOff = [0, 0, -rRing, rRing, -dRing, -dRing, dRing, dRing];

        for (let y = yStart + 2; y < yEnd - 2; y++) {
          const rowOff = y * width;
          const satTopRow = (y - rBg1B) * satW;
          const satBotRow = (y + rBg1B + 1) * satW;
          const satInTop = (y - 1) * satW;
          const satInBot = (y + 2) * satW;

          for (let x = xStart + 2; x < xEnd - 2; x++) {
            const idx = rowOff + x;
            const val = gray[idx];
            if (val < 62 || val > 185) continue;

            const rPrev = rowOff - width;
            const rNext = rowOff + width;
            if (
              gray[rPrev + x - 1] >= val ||
              gray[rPrev + x] >= val ||
              gray[rPrev + x + 1] >= val ||
              gray[rowOff + x - 1] >= val ||
              gray[rowOff + x + 1] > val ||
              gray[rNext + x - 1] > val ||
              gray[rNext + x] > val ||
              gray[rNext + x + 1] > val
            ) {
              continue;
            }

            const bgMean = (
              sat[satBotRow + x + rBg1B + 1] -
              sat[satTopRow + x + rBg1B + 1] -
              sat[satBotRow + x - rBg1B] +
              sat[satTopRow + x - rBg1B]
            ) * invBg1BArea;

            if (bgMean > 120 || val < bgMean * 1.45) continue;

            const innerMean = (
              sat[satInBot + x + 2] -
              sat[satInTop + x + 2] -
              sat[satInBot + x - 1] +
              sat[satInTop + x - 1]
            ) * invInnerArea;

            const prom = innerMean - bgMean;
            if (prom < minProm) continue;

            if (
              boxMean(x - 6, y - 6, 3) > 120 ||
              boxMean(x + 6, y - 6, 3) > 120 ||
              boxMean(x - 6, y + 6, 3) > 120 ||
              boxMean(x + 6, y + 6, 3) > 120
            ) {
              continue;
            }

            let darkPts = 0;
            let ringSum = 0;
            for (let k = 0; k < 8; k++) {
              const rl = gray[(y + ryOff[k]) * width + (x + rxOff[k])];
              if (val - rl >= minProm && rl < 130) {
                darkPts++;
                ringSum += rl;
              }
            }
            if (darkPts < 6) continue;

            rawPeaks.push({
              x,
              y,
              size: 3.8,
              area: 9,
              polarity: "light_pip",
              bodyLum: ringSum / darkPts,
              peakLum: val,
              val,
              bgMean,
              prom
            });
          }
        }

        if (rawPeaks.length > 0) {
          rawPeaks.sort((a, b) => b.val - a.val);
          for (let i = 0; i < rawPeaks.length; i++) {
            const p = rawPeaks[i];
            let merged = false;
            for (let j = 0; j < candidatePips.length; j++) {
              const ex = candidatePips[j];
              const d = Math.hypot(ex.x - p.x, ex.y - p.y);
              if (d < 3.2) {
                merged = true;
                break;
              }
              if (d < 7.5) {
                let minLineVal = 255;
                for (let s = 1; s <= 3; s++) {
                  const t = s * 0.25;
                  const lx = Math.round(ex.x + (p.x - ex.x) * t);
                  const ly = Math.round(ex.y + (p.y - ex.y) * t);
                  const lv = gray[ly * width + lx];
                  if (lv < minLineVal) minLineVal = lv;
                }
                if (minLineVal >= Math.min(ex.val, p.val) - 1) {
                  merged = true;
                  break;
                }
              }
            }
            if (!merged) {
              candidatePips.push(p);
            }
          }
        }
      }
    }

    // Stage 2: Scale-Bounded Constellation Clustering + Dynamic Inter-Pip Bridge + 45° Rotation Invariance
    const sortedSizes = candidatePips.map(p => p.size).sort((a, b) => a - b);
    const medianPipSize = sortedSizes.length > 0
      ? sortedSizes[Math.floor(sortedSizes.length / 2)]
      : 6.2;

    const rawEstDieSize = Math.round(medianPipSize * 6.4);
    const estimatedDieSize = Math.max(20, Math.min(68, rawEstDieSize));
    const maxPipPairDist = Math.max(19, Math.round(estimatedDieSize * 0.86));
    const maxSingleDieAxisSpan = Math.max(21, Math.round(estimatedDieSize * 0.82));
    const maxSingleDieDiagSpan = Math.max(23, Math.round(estimatedDieSize * 0.88));

    const used = new Uint8Array(candidatePips.length);
    const detectedDice = [];

    for (let i = 0; i < candidatePips.length; i++) {
      if (used[i]) continue;
      const seed = candidatePips[i];
      const cluster = [seed];
      used[i] = 1;

      let minX = seed.x, maxX = seed.x;
      let minY = seed.y, maxY = seed.y;

      let added = true;
      while (added && cluster.length < 6) {
        added = false;
        let bestIdx = -1;
        let bestDist = Infinity;

        for (let j = 0; j < candidatePips.length; j++) {
          if (used[j]) continue;
          const cand = candidatePips[j];
          if (cand.polarity !== seed.polarity) continue;

          let minDistToCluster = Infinity;
          let maxDistToCluster = 0;
          let nearestClusterPip = cluster[0];
          for (let k = 0; k < cluster.length; k++) {
            const d = Math.hypot(cluster[k].x - cand.x, cluster[k].y - cand.y);
            if (d < minDistToCluster) {
              minDistToCluster = d;
              nearestClusterPip = cluster[k];
            }
            if (d > maxDistToCluster) {
              maxDistToCluster = d;
            }
          }

          if (minDistToCluster <= maxPipPairDist && minDistToCluster < bestDist) {
            const newSpanX = Math.max(maxX, cand.x) - Math.min(minX, cand.x);
            const newSpanY = Math.max(maxY, cand.y) - Math.min(minY, cand.y);

            if (
              newSpanX <= maxSingleDieAxisSpan &&
              newSpanY <= maxSingleDieAxisSpan &&
              maxDistToCluster <= maxSingleDieDiagSpan &&
              this.isSameDieSegment(nearestClusterPip, cand, gray, width)
            ) {
              bestDist = minDistToCluster;
              bestIdx = j;
            }
          }
        }

        if (bestIdx !== -1) {
          const chosen = candidatePips[bestIdx];
          used[bestIdx] = 1;
          cluster.push(chosen);
          minX = Math.min(minX, chosen.x);
          maxX = Math.max(maxX, chosen.x);
          minY = Math.min(minY, chosen.y);
          maxY = Math.max(maxY, chosen.y);
          added = true;
        }
      }

      const pipCount = cluster.length;
      const centerX = (minX + maxX) * 0.5;
      const centerY = (minY + maxY) * 0.5;
      const boxSize = Math.max(minDiePx, estimatedDieSize);
      const dieObj = {
        x: Math.round(centerX - boxSize * 0.5),
        y: Math.round(centerY - boxSize * 0.5),
        w: boxSize,
        h: boxSize,
        value: pipCount,
        polarity: seed.polarity,
        isCustomSymbol: false,
        owner: 1
      };
      dieObj.owner = this.classifyDieOwner(dieObj, rgba, width, height);
      detectedDice.push(dieObj);
    }

    candidateEmblems.forEach(emb => {
      const boxSize = Math.max(minDiePx, estimatedDieSize);
      const overlaps = detectedDice.some(
        d => Math.hypot(d.x + d.w * 0.5 - emb.x, d.y + d.h * 0.5 - emb.y) < boxSize * 0.75
      );
      if (!overlaps) {
        const dieObj = {
          x: Math.round(emb.x - boxSize * 0.5),
          y: Math.round(emb.y - boxSize * 0.5),
          w: boxSize,
          h: boxSize,
          value: 6,
          polarity: emb.polarity,
          isCustomSymbol: true,
          owner: 1
        };
        dieObj.owner = this.classifyDieOwner(dieObj, rgba, width, height);
        detectedDice.push(dieObj);
      }
    });

    return detectedDice;
  }

  isSameDieSegment(p1, p2, gray, width) {
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (dist < 2) return true;
    const tMin = Math.min(0.45, Math.max(0.36, ((p1.size || 6) * 0.60) / dist));
    const tMax = Math.max(0.55, Math.min(0.64, 1.0 - ((p2.size || 6) * 0.60) / dist));
    const localBodyLum = ((p1.bodyLum || 160) + (p2.bodyLum || 160)) * 0.5;
    const minBodyLumDarkDie = Math.max(10, localBodyLum - 32);
    let bodyHits = 0;
    let gapCrossings = 0;
    for (let s = 0; s < 5; s++) {
      const t = tMin + ((tMax - tMin) * s) * 0.25;
      const sx = Math.round(p1.x + (p2.x - p1.x) * t);
      const sy = Math.round(p1.y + (p2.y - p1.y) * t);
      const lum = gray[sy * width + sx];
      if (p1.polarity === "dark_pip") {
        if (lum >= Math.min(135, localBodyLum - 28)) bodyHits++;
        else if (lum < Math.min(95, localBodyLum - 45)) gapCrossings++;
      } else {
        if (lum >= minBodyLumDarkDie && lum <= Math.max(172, localBodyLum + 80)) bodyHits++;
        else if (lum < minBodyLumDarkDie - 2 || lum > Math.max(185, localBodyLum + 95)) gapCrossings++;
      }
    }
    return (gapCrossings === 0 && bodyHits >= 3) || (dist < 16 && bodyHits >= 3 && gapCrossings <= 1);
  }

  // ============================================================================
  // OVERLAY RENDERING: OUTSIDE-TRAY MASK + DRAGGABLE HANDLES + DIE BADGES
  // ============================================================================
  drawDetectionsOverlay(diceList, rx, ry, rw, rh) {
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.fillStyle = "rgba(5, 8, 13, 0.62)";
    this.ctx.fillRect(0, 0, w, ry);
    this.ctx.fillRect(0, ry + rh, w, h - (ry + rh));
    this.ctx.fillRect(0, ry, rx, rh);
    this.ctx.fillRect(rx + rw, ry, w - (rx + rw), rh);

    this.ctx.strokeStyle = this.rollState === "LOCKED" ? "#a855f7" : "#10b981";
    this.ctx.lineWidth = 2.5;
    this.ctx.setLineDash([8, 5]);
    this.ctx.strokeRect(rx, ry, rw, rh);
    this.ctx.setLineDash([]);

    const corners = [
      [rx, ry],
      [rx + rw, ry],
      [rx, ry + rh],
      [rx + rw, ry + rh]
    ];
    this.ctx.fillStyle = this.rollState === "LOCKED" ? "#a855f7" : "#34d399";
    corners.forEach(([cx, cy]) => {
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      this.ctx.fill();
    });

    this.ctx.fillStyle = "rgba(13, 17, 23, 0.85)";
    this.ctx.fillRect(rx + 6, ry + 6, 232, 20);
    this.ctx.fillStyle = "#34d399";
    this.ctx.font = "bold 11px Inter, sans-serif";
    this.ctx.fillText("📦 DICE TRAY ROI (Drag Corners to Resize)", rx + 12, ry + 20);

    const targetVal = parseInt(this.targetSuccess.value, 10);
    const rerollOnes = this.chkRerollOnes && this.chkRerollOnes.checked;

    diceList.forEach(d => {
      const isCrit = d.value === 6;
      const isHit = d.value >= targetVal;
      const isRerollOne = rerollOnes && d.value === 1;

      let strokeColor = "#64748b";
      if (isCrit) strokeColor = "#a855f7";
      else if (isHit) strokeColor = "#10b981";
      else if (isRerollOne) strokeColor = "#f59e0b";

      this.ctx.strokeStyle = strokeColor;
      this.ctx.lineWidth = isCrit ? 3 : 2;
      this.ctx.strokeRect(d.x, d.y, d.w, d.h);

      const tagW = d.isCustomSymbol ? 44 : 30;
      const tagH = 18;
      const tagX = d.x + (d.w - tagW) * 0.5;
      const tagY = Math.max(ry + 2, d.y - tagH - 2);

      this.ctx.fillStyle = isCrit
        ? "rgba(168, 85, 247, 0.92)"
        : isHit
        ? "rgba(16, 185, 129, 0.92)"
        : "rgba(15, 23, 42, 0.92)";
      this.ctx.fillRect(tagX, tagY, tagW, tagH);

      this.ctx.fillStyle = "#ffffff";
      this.ctx.font = "bold 12px JetBrains Mono, sans-serif";
      const label = d.isCustomSymbol ? "★6" : `${d.value}`;
      this.ctx.fillText(label, tagX + (d.isCustomSymbol ? 10 : 10), tagY + 13);
    });
  }

  updateLiveHudCounts(diceList) {
    const targetVal = parseInt(this.targetSuccess.value, 10);
    const sum = diceList.reduce((acc, d) => acc + d.value, 0);
    const hits = diceList.filter(d => d.value >= targetVal).length;
    const crits = diceList.filter(d => d.value === 6).length;
    const ones = diceList.filter(d => d.value === 1).length;
    const p1Count = diceList.filter(d => (d.owner || 1) === 1).length;
    const p2Count = diceList.filter(d => d.owner === 2).length;

    const hudSig = `${diceList.length}:${hits}:${crits}:${ones}:${sum}:${p1Count}:${p2Count}`;
    if (this._lastHudSig === hudSig) return;
    this._lastHudSig = hudSig;

    this.hudDiceCount.innerText = diceList.length;
    this.hudHitsCount.innerText = hits;
    this.hudCritsCount.innerText = crits;
    if (this.hudOnesCount) this.hudOnesCount.innerText = ones;
    this.hudDiceSum.innerText = sum;
    if (this.hudOwnerSplit) {
      this.hudOwnerSplit.innerText = `🔵P1: ${p1Count} | 🔴P2: ${p2Count}`;
    }
  }

  updateStateMachineUI(state, hintText, progressPct) {
    if (this._lastUiHint !== hintText) {
      this._lastUiHint = hintText;
      this.stateHint.innerText = hintText;
    }
    if (this._lastUiProgress !== progressPct) {
      this._lastUiProgress = progressPct;
      this.settlingProgressBar.style.width = `${progressPct}%`;
    }

    const lockedLabel = state === "LOCKED" ? `🟣 LOCKED ✅ (${this.currentDetectedDice.length} Dice)` : "";
    const stateKey = state === "LOCKED" ? `${state}:${lockedLabel}` : state;
    if (this._lastUiState === stateKey) return;
    this._lastUiState = stateKey;

    if (state === "IDLE") {
      this.statePill.className = "state-pill state-idle";
      this.statePill.innerText = "🟢 READY — Waiting for Roll";
    } else if (state === "ROLLING") {
      this.statePill.className = "state-pill state-rolling";
      this.statePill.innerText = "🟠 ROLLING — Motion in Tray";
    } else if (state === "SETTLING") {
      this.statePill.className = "state-pill state-settling";
      this.statePill.innerText = "🔵 SETTLING — Locking Count";
    } else if (state === "LOCKED") {
      this.statePill.className = "state-pill state-locked";
      this.statePill.innerText = lockedLabel;
    }
  }

  // ============================================================================
  // REALISTIC 40-DICE PHYSICS STREAM SIMULATOR (FEEDS RAW PIXELS INTO REAL CV!)
  // ============================================================================
  startPhysicsSimRoll(diceCount = 40) {
    this.stopCamera();
    this.isSimulationMode = true;
    this.chkSimulation.checked = true;
    this.scannerOverlay.classList.add("hidden");
    this.btnCaptureRoll.disabled = false;

    const width = this.canvas.width;
    const height = this.canvas.height;
    const rx = Math.floor(width * this.roiBox.x);
    const ry = Math.floor(height * this.roiBox.y);
    const rw = Math.floor(width * this.roiBox.w);
    const rh = Math.floor(height * this.roiBox.h);

    const cols = diceCount > 24 ? 8 : diceCount > 12 ? 6 : 5;
    const rows = Math.ceil(diceCount / cols);
    const padX = 24;
    const padY = 34;
    const cellW = (rw - padX * 2) / cols;
    const cellH = (rh - padY * 2) / Math.max(3, rows);
    const dieSize = Math.min(40, Math.floor(Math.min(cellW, cellH) * 0.72));

    const colorChoice = this.diceColorMode ? this.diceColorMode.value : "auto";
    const useCustomSix = this.chkCustomSixSymbol && this.chkCustomSixSymbol.checked;

    this.simDiceObjects = [];
    for (let i = 0; i < diceCount; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const jitterX = (Math.random() - 0.5) * (cellW - dieSize - 6);
      const jitterY = (Math.random() - 0.5) * (cellH - dieSize - 6);

      const targetX = Math.round(rx + padX + c * cellW + (cellW - dieSize) * 0.5 + jitterX);
      const targetY = Math.round(ry + padY + r * cellH + (cellH - dieSize) * 0.5 + jitterY);

      const startX = rx + rw * 0.5 + (Math.random() - 0.5) * 160;
      const startY = ry + rh - 20;
      const finalValue = Math.floor(Math.random() * 6) + 1;

      let schemeKey = this.playerDiceProfiles ? this.playerDiceProfiles.p1Scheme : "bone_black";
      let isCustom6Scheme = this.playerDiceProfiles ? this.playerDiceProfiles.p1CustomSix : useCustomSix;
      if (this.rollerAttributionMode === "2") {
        schemeKey = this.playerDiceProfiles ? this.playerDiceProfiles.p2Scheme : "crimson_gold";
        isCustom6Scheme = this.playerDiceProfiles ? this.playerDiceProfiles.p2CustomSix : useCustomSix;
      } else if (this.rollerAttributionMode === "1") {
        schemeKey = this.playerDiceProfiles ? this.playerDiceProfiles.p1Scheme : "bone_black";
      } else if (colorChoice === "dark") {
        schemeKey = this.playerDiceProfiles ? this.playerDiceProfiles.p2Scheme : "crimson_gold";
      } else if (colorChoice === "light") {
        schemeKey = "bone_black";
      } else if (i % 3 === 0) {
        schemeKey = this.playerDiceProfiles ? this.playerDiceProfiles.p2Scheme : "crimson_gold";
        isCustom6Scheme = this.playerDiceProfiles ? this.playerDiceProfiles.p2CustomSix : useCustomSix;
      }

      this.simDiceObjects.push({
        startX,
        startY,
        targetX,
        targetY,
        x: startX,
        y: startY,
        size: dieSize,
        value: finalValue,
        displayValue: Math.floor(Math.random() * 6) + 1,
        style: schemeKey,
        customSix: useCustomSix && isCustom6Scheme && finalValue === 6 && i % 2 === 0
      });
    }

    this.simDistractorDice = [];
    if (this.chkOutsideDistractors && this.chkOutsideDistractors.checked) {
      const outsideSpots = [
        { x: 6, y: 8, val: 6 },
        { x: 6, y: height - 42, val: 5 },
        { x: width - 42, y: 8, val: 4 },
        { x: width - 42, y: height - 42, val: 6 }
      ];
      outsideSpots.forEach(s => {
        this.simDistractorDice.push({
          x: s.x,
          y: s.y,
          size: 32,
          value: s.val,
          style: "bone_black",
          customSix: false
        });
      });
    }

    this.simFramesRemaining = 38;
    this.rollState = "IDLE";
    this.settledFrameCounter = 0;
    this.settlingBuffer = [];

    if (this.simAnimationId) clearTimeout(this.simAnimationId);
    this.stepPhysicsSimLoop();
  }

  stopSimulationStream() {
    if (this.simAnimationId) {
      clearTimeout(this.simAnimationId);
      this.simAnimationId = null;
    }
    this.isSimulationMode = false;
    this.chkSimulation.checked = false;
  }

  stepPhysicsSimLoop() {
    if (!this.isSimulationMode) return;

    const totalTumbleFrames = 14;
    const elapsed = 38 - this.simFramesRemaining;
    const t = Math.min(1, elapsed / totalTumbleFrames);
    const ease = 1 - Math.pow(1 - t, 3);

    this.renderSimTrayFrame(t < 1, ease);
    this.ctx.drawImage(this.simCanvas, 0, 0);

    this.processCurrentCanvasFrame();

    if (this.simFramesRemaining > 0) {
      this.simFramesRemaining--;
      this.simAnimationId = setTimeout(() => this.stepPhysicsSimLoop(), 16);
    }
  }

  renderSimTrayFrame(isTumbling, ease) {
    const w = this.simCanvas.width;
    const h = this.simCanvas.height;
    const sCtx = this.simCtx;

    sCtx.fillStyle = "#161b22";
    sCtx.fillRect(0, 0, w, h);

    const rx = Math.floor(w * this.roiBox.x);
    const ry = Math.floor(h * this.roiBox.y);
    const rw = Math.floor(w * this.roiBox.w);
    const rh = Math.floor(h * this.roiBox.h);

    sCtx.fillStyle = "#1b232d";
    sCtx.fillRect(rx, ry, rw, rh);

    this.simDistractorDice.forEach(d => {
      this.drawRealisticDieOnCtx(sCtx, d.x, d.y, d.size, d.value, d.style, false, d.angle || 0);
    });

    this.simDiceObjects.forEach(d => {
      d.x = Math.round(d.startX + (d.targetX - d.startX) * ease);
      d.y = Math.round(d.startY + (d.targetY - d.startY) * ease);
      const faceVal = isTumbling ? ((d.value + Math.floor(ease * 10)) % 6) + 1 : d.value;
      this.drawRealisticDieOnCtx(sCtx, d.x, d.y, d.size, faceVal, d.style, !isTumbling && d.customSix, d.angle || 0);
    });
  }

  detectRealDice(frameData, width = 640, height = 480) {
    this.ensureCvBuffers(width, height);
    const data = frameData.data;
    const rx = Math.max(8, Math.floor(width * this.roiBox.x));
    const ry = Math.max(8, Math.floor(height * this.roiBox.y));
    const rw = Math.min(width - rx - 8, Math.floor(width * this.roiBox.w));
    const rh = Math.min(height - ry - 8, Math.floor(height * this.roiBox.h));

    const gray = this._grayBuf;
    const sat = this._satBuf;
    const satW = width + 1;
    const rSurround = 10;
    const xStart = Math.max(rSurround + 1, rx + 6);
    const xEnd = Math.min(width - rSurround - 1, rx + rw - 6);
    const yStart = Math.max(rSurround + 1, ry + 6);
    const yEnd = Math.min(height - rSurround - 1, ry + rh - 6);

    const satY0 = Math.max(1, Math.min(ry, yStart - rSurround));
    const satY1 = Math.min(height, Math.max(ry + rh, yEnd + rSurround + 1));
    const satX0 = Math.max(1, Math.min(rx, xStart - rSurround));
    const satX1 = Math.min(width, Math.max(rx + rw, xEnd + rSurround + 1));

    const zeroRowOff = (satY0 - 1) * satW;
    for (let x = satX0 - 1; x <= satX1; x++) {
      sat[zeroRowOff + x] = 0;
    }

    for (let y = satY0; y <= satY1; y++) {
      let rowSum = 0;
      const grayRowOffset = (y - 1) * width;
      const satRowOffset = y * satW;
      const satPrevRowOffset = (y - 1) * satW;
      sat[satRowOffset + satX0 - 1] = 0;
      let rgbaIdx = (grayRowOffset + satX0 - 1) * 4;
      for (let x = satX0; x <= satX1; x++, rgbaIdx += 4) {
        const lum = (77 * data[rgbaIdx] + 150 * data[rgbaIdx + 1] + 29 * data[rgbaIdx + 2]) >> 8;
        gray[grayRowOffset + x - 1] = lum;
        rowSum += lum;
        sat[satRowOffset + x] = sat[satPrevRowOffset + x] + rowSum;
      }
    }

    return this.detectDiceTwoStageAdaptive(gray, data, width, height, rx, ry, rw, rh, true);
  }

  drawRealisticDieOnCtx(sCtx, x, y, size, val, style, isCustomSix, angle = 0) {
    const scheme = (this.diceSchemes && this.diceSchemes[style])
      ? this.diceSchemes[style]
      : style === "dark"
      ? this.diceSchemes.black_white
      : this.diceSchemes.bone_black;

    const cx = x + size * 0.5;
    const cy = y + size * 0.5;
    const half = size * 0.5;

    sCtx.save();
    sCtx.translate(cx, cy);
    if (angle) sCtx.rotate(angle);

    sCtx.fillStyle = scheme.body;
    sCtx.strokeStyle = scheme.stroke;
    sCtx.lineWidth = 1.5;
    sCtx.beginPath();
    sCtx.roundRect(-half, -half, size, size, 6);
    sCtx.fill();
    sCtx.stroke();

    sCtx.fillStyle = scheme.pip;

    if (isCustomSix && val === 6) {
      const r = size * 0.24;
      sCtx.beginPath();
      sCtx.arc(0, 0, r, 0, Math.PI * 2);
      sCtx.fill();
      sCtx.restore();
      return;
    }

    const offset = size * 0.25;
    const pipR = Math.max(2.3, size * 0.085);

    const drawDot = (dx, dy) => {
      sCtx.beginPath();
      sCtx.arc(dx, dy, pipR, 0, Math.PI * 2);
      sCtx.fill();
    };

    if (val % 2 === 1) drawDot(0, 0);
    if (val > 1) {
      drawDot(-offset, -offset);
      drawDot(offset, offset);
    }
    if (val > 3) {
      drawDot(offset, -offset);
      drawDot(-offset, offset);
    }
    if (val === 6) {
      drawDot(-offset, 0);
      drawDot(offset, 0);
    }
    sCtx.restore();
  }

  // ============================================================================
  // AUDIO / VOICE ANNOUNCE & OMNITACTICA-COMPATIBLE ROLL RECORDING
  // ============================================================================
  playLockChime() {
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) this.audioCtx = new AudioContextClass();
      }
      if (this.audioCtx && this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }
      if (this.audioCtx) {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, this.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1320, this.audioCtx.currentTime + 0.09);
        gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.12);
      }
    } catch (_e) {}
  }

  announceRollVoice(count, hits, crits, targetVal) {
    if (!this.chkVoiceReadout || !this.chkVoiceReadout.checked) return;
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const msg = new SpeechSynthesisUtterance(
        `${count} dice. ${hits} hits on ${targetVal} plus, including ${crits} sixes.`
      );
      msg.rate = 1.15;
      window.speechSynthesis.speak(msg);
    } catch (_e) {}
  }

  resolveRollPlayerAttribution(diceList) {
    if (this.rollerAttributionMode === "1") return 1;
    if (this.rollerAttributionMode === "2") return 2;
    let p1Votes = 0;
    let p2Votes = 0;
    diceList.forEach(d => {
      if (d.owner === 2) p2Votes++;
      else p1Votes++;
    });
    return p2Votes > p1Votes ? 2 : 1;
  }

  captureCurrentRoll(triggerSource = "Manual") {
    if (this.currentDetectedDice.length === 0) return;

    const diceValues = this.currentDetectedDice.map(d => d.value);
    const totalSum = diceValues.reduce((a, b) => a + b, 0);
    const avg = totalSum / diceValues.length;
    const targetVal = parseInt(this.targetSuccess.value, 10);
    const successCount = diceValues.filter(v => v >= targetVal).length;
    const failCount = diceValues.length - successCount;
    const critsCount = diceValues.filter(v => v === 6).length;
    const onesCount = diceValues.filter(v => v === 1).length;
    const playerNum = this.resolveRollPlayerAttribution(this.currentDetectedDice);
    const playerName = playerNum === 2 ? "Player 2" : "Player 1";
    const nowIso = new Date().toISOString();

    // Unified OmniTactica + WarDice CV roll object
    const rollObj = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      rollNum: this.history.length + 1,
      player_num: playerNum,
      player_name: playerName,
      mode: this.currentRollPhase === "Hit Roll" ? "cv_roll" : "cv_reroll",
      source: "cv_camera",
      phase: this.currentRollPhase,
      target: targetVal,
      timestamp: nowIso,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      count: diceValues.length,
      dice_count: diceValues.length,
      values: diceValues,
      results: [...diceValues],
      sum: totalSum,
      avg: avg.toFixed(2),
      average: Number(avg.toFixed(2)),
      successCount,
      success_count: successCount,
      fail_count: failCount,
      critsCount,
      crit_count: critsCount,
      one_count: onesCount
    };

    this.history.unshift(rollObj);
    this.rebuildDistributionFromHistory();

    this.lockedRollDice = this.currentDetectedDice.map(d => ({ ...d }));
    this.rollState = "LOCKED";
    if (this.btnUndoLastRoll) this.btnUndoLastRoll.disabled = false;

    const pTag = playerNum === 2 ? "🔴 P2" : "🔵 P1";
    this.updateStateMachineUI(
      "LOCKED",
      `✅ Locked Roll #${rollObj.rollNum} [${pTag} • ${triggerSource}]: ${diceValues.length} dice → ${successCount} Hits (${targetVal}+), ${critsCount} Crits (6s). Scoop dice to roll again!`,
      100
    );

    this.btnRerollCount.innerText = successCount;
    this.btnRerollHits.disabled = successCount === 0;

    this.playLockChime();
    this.announceRollVoice(diceValues.length, successCount, critsCount, targetVal);

    this.updateStatsUI();
    this.renderLastRollBadges(diceValues);
  }

  // Push recorded CV rolls into OmniTactica's Game Tracker localStorage (`gt-dice-history-v2`)
  syncToGameTrackerLocalHistory() {
    try {
      const existingRaw = localStorage.getItem("gt-dice-history-v2");
      let existing = [];
      if (existingRaw) {
        try { existing = JSON.parse(existingRaw) || []; } catch (_e) { existing = []; }
      }
      const existingIds = new Set(existing.map(e => e.id));
      let addedCount = 0;
      const toPrepend = [];
      this.history.forEach(r => {
        if (!existingIds.has(r.id)) {
          toPrepend.push({
            id: r.id,
            timestamp: r.timestamp || new Date().toISOString(),
            player_num: r.player_num || 1,
            player_name: r.player_name || (r.player_num === 2 ? "Player 2" : "Player 1"),
            mode: r.mode || "cv_roll",
            source: "cv_camera",
            target: r.target || parseInt(this.targetSuccess.value, 10) || 4,
            dice_count: r.count,
            results: [...r.values],
            success_count: r.successCount,
            fail_count: r.count - r.successCount,
            crit_count: r.critsCount,
            one_count: r.values.filter(v => v === 1).length,
            sum: r.sum,
            average: Number(r.avg)
          });
          addedCount++;
        }
      });
      const merged = [...toPrepend, ...existing].slice(0, 100);
      localStorage.setItem("gt-dice-history-v2", JSON.stringify(merged));
      if (this.syncFeedbackText) {
        this.syncFeedbackText.innerText = `✅ Synced ${addedCount} new CV roll(s) to Game Tracker (${merged.length} total in gt-dice-history-v2)`;
        setTimeout(() => {
          if (this.syncFeedbackText) this.syncFeedbackText.innerText = "";
        }, 4000);
      }
    } catch (err) {
      console.error("Failed to sync CV rolls to localStorage:", err);
    }
  }

  getFilteredHistory() {
    if (this.activeStatsFilter === "1") {
      return this.history.filter(r => (r.player_num || 1) === 1);
    }
    if (this.activeStatsFilter === "2") {
      return this.history.filter(r => r.player_num === 2);
    }
    return this.history;
  }

  updateFaceSummaryStrip(values) {
    // Also update the cumulative distribution + Expected N/6 Hot/Cold deltas
    const totalDice = this.distribution.slice(1).reduce((a, b) => a + b, 0);
    const expectedPerFace = totalDice / 6;
    if (this.expectedPerFaceBadge) {
      this.expectedPerFaceBadge.innerText = `Expected (N/6): ${expectedPerFace.toFixed(1)}`;
    }

    for (let v = 1; v <= 6; v++) {
      const count = this.distribution[v] || 0;
      const el = document.getElementById(`countFace${v}`);
      if (el) el.innerText = count;

      const deltaEl = document.getElementById(`deltaFace${v}`);
      if (deltaEl) {
        if (totalDice === 0) {
          deltaEl.innerText = "Δ 0.0";
          deltaEl.style.color = "#64748b";
        } else {
          const diff = count - expectedPerFace;
          const sign = diff > 0 ? "+" : "";
          deltaEl.innerText = `Δ ${sign}${diff.toFixed(1)}`;
          if (diff >= 1.5) deltaEl.style.color = "#34d399";
          else if (diff <= -1.5) deltaEl.style.color = "#f87171";
          else deltaEl.style.color = "#94a3b8";
        }
      }
    }
  }

  recalculateRollEntry(roll) {
    const targetVal = parseInt(this.targetSuccess.value, 10);
    roll.count = roll.values.length;
    roll.dice_count = roll.values.length;
    roll.results = [...roll.values];
    roll.sum = roll.values.reduce((a, b) => a + b, 0);
    roll.avg = roll.count > 0 ? (roll.sum / roll.count).toFixed(2) : "0.00";
    roll.average = Number(roll.avg);
    roll.successCount = roll.values.filter(v => v >= targetVal).length;
    roll.success_count = roll.successCount;
    roll.fail_count = roll.count - roll.successCount;
    roll.critsCount = roll.values.filter(v => v === 6).length;
    roll.crit_count = roll.critsCount;
    roll.one_count = roll.values.filter(v => v === 1).length;
  }

  rebuildDistributionFromHistory() {
    this.distribution = [0, 0, 0, 0, 0, 0, 0];
    const filtered = this.getFilteredHistory();
    filtered.forEach(r => {
      r.values.forEach(v => {
        if (v >= 1 && v <= 6) this.distribution[v]++;
      });
    });
  }

  updateStatsUI() {
    this.rebuildDistributionFromHistory();
    const filtered = this.getFilteredHistory();
    const totalRolls = filtered.length;
    const totalDice = this.distribution.slice(1).reduce((a, b) => a + b, 0);
    const totalSum = this.distribution.reduce((acc, count, val) => acc + count * val, 0);
    const grandAvg = totalDice > 0 ? (totalSum / totalDice).toFixed(2) : "0.00";

    const targetVal = parseInt(this.targetSuccess.value, 10);
    let totalSuccesses = 0;
    for (let v = targetVal; v <= 6; v++) {
      totalSuccesses += this.distribution[v];
    }
    const successPct = totalDice > 0 ? ((totalSuccesses / totalDice) * 100).toFixed(1) + "%" : "0%";

    this.statTotalRolls.innerText = totalRolls;
    this.statTotalDice.innerText = totalDice;
    this.statAvgRoll.innerText = grandAvg;
    this.statSuccessPct.innerText = successPct;

    this.updateFaceSummaryStrip();
    this.drawNativeDistributionChart(this.distribution.slice(1));
    this.renderHistoryTable();
  }

  renderLastRollBadges(values) {
    this.lastRollDiceList.innerHTML = "";
    if (!values || values.length === 0) {
      this.lastRollDiceList.innerHTML = '<span class="placeholder-text" style="font-size:0.8rem;color:#64748b;">No rolls recorded yet. Throw dice into the tray!</span>';
      return;
    }

    const sorted = [...values].sort((a, b) => b - a);
    sorted.forEach(v => {
      const badge = document.createElement("span");
      badge.className = `dice-badge dice-${v}`;
      badge.innerText = v;
      badge.title = "Tap to cycle die value (1-6)";
      badge.onclick = () => {
        if (this.history.length > 0) {
          this.openEditModal(this.history[0].id);
        }
      };
      this.lastRollDiceList.appendChild(badge);
    });
  }

  renderHistoryTable() {
    const filtered = this.getFilteredHistory();
    if (filtered.length === 0) {
      this.historyTableBody.innerHTML = `
        <tr>
          <td colspan="11" class="text-center text-muted">No rolls recorded yet. Roll dice in the tray or click "🎲 Roll 40 Dice (Live CV)"!</td>
        </tr>`;
      return;
    }

    this.historyTableBody.innerHTML = "";
    const targetVal = parseInt(this.targetSuccess.value, 10);

    filtered.forEach(r => {
      const tr = document.createElement("tr");
      const sortedVals = [...r.values].sort((a, b) => b - a);
      const badgesHTML = sortedVals
        .map(v => `<span class="dice-badge dice-${v}" style="width:22px;height:22px;font-size:0.72rem">${v}</span>`)
        .join(" ");

      const hitsNow = r.values.filter(v => v >= targetVal).length;
      const critsNow = r.values.filter(v => v === 6).length;
      const onesNow = r.values.filter(v => v === 1).length;
      const pNum = r.player_num || 1;
      const playerPill = pNum === 2
        ? `<span style="color:#fb7185;font-weight:800;font-size:0.74rem;">🔴 P2</span>`
        : `<span style="color:#38bdf8;font-weight:800;font-size:0.74rem;">🔵 P1</span>`;

      tr.className = "history-row";
      tr.innerHTML = `
        <td class="hist-col-num"><strong>#${r.rollNum}</strong></td>
        <td class="hist-col-player">${playerPill}</td>
        <td class="hist-col-phase"><span class="badge status-inactive">${r.phase || "Roll"}</span></td>
        <td class="hist-col-time">${r.time}</td>
        <td class="hist-col-pool"><strong>${r.count}d</strong></td>
        <td class="hist-col-badges"><div class="history-badges-cell">${badgesHTML}</div></td>
        <td class="hist-col-hits"><span class="mobile-stat-lbl">Hits: </span><strong style="color:${hitsNow > 0 ? "#34d399" : "#94a3b8"}">${hitsNow}/${r.count} (${targetVal}+)</strong></td>
        <td class="hist-col-crits"><span class="mobile-stat-lbl">6s: </span><strong style="color:#c084fc">${critsNow}</strong></td>
        <td class="hist-col-ones"><span class="mobile-stat-lbl">1s: </span><strong style="color:#f87171">${onesNow}</strong></td>
        <td class="hist-col-avg"><span class="mobile-stat-lbl">Avg: </span><strong>${r.avg}</strong></td>
        <td class="hist-col-actions">
          <button class="btn btn-sm btn-secondary" onclick="app.openEditModal(${r.id})">✏️</button>
          <button class="btn btn-sm btn-outline" onclick="app.deleteRoll(${r.id})">🗑️</button>
        </td>
      `;
      this.historyTableBody.appendChild(tr);
    });
  }

  openEditModal(rollId) {
    const roll = this.history.find(r => r.id === rollId);
    if (!roll) return;

    this.editingRollId = rollId;
    this.editingValues = [...roll.values];
    this.modalDiceContainer.innerHTML = "";

    this.editingValues.forEach((val, idx) => {
      const btn = document.createElement("button");
      btn.className = `dice-badge dice-${val}`;
      btn.style.width = "36px";
      btn.style.height = "36px";
      btn.innerText = val;
      btn.onclick = () => {
        this.editingValues[idx] = (val % 6) + 1;
        this.openEditModal(rollId);
      };
      this.modalDiceContainer.appendChild(btn);
    });

    this.editModal.classList.remove("hidden");
  }

  saveEditRoll() {
    const roll = this.history.find(r => r.id === this.editingRollId);
    if (roll) {
      roll.values = [...this.editingValues];
      this.recalculateRollEntry(roll);
      this.rebuildDistributionFromHistory();
      this.updateStatsUI();
      if (this.history[0] && this.history[0].id === roll.id) {
        this.renderLastRollBadges(roll.values);
      }
    }
    this.editModal.classList.add("hidden");
  }

  deleteRoll(rollId) {
    const rollIdx = this.history.findIndex(r => r.id === rollId);
    if (rollIdx !== -1) {
      this.history.splice(rollIdx, 1);
      this.rebuildDistributionFromHistory();
      this.updateStatsUI();
      if (this.btnUndoLastRoll) {
        this.btnUndoLastRoll.disabled = this.history.length === 0;
      }
    }
  }
}

let app;
window.addEventListener("DOMContentLoaded", () => {
  app = new DiceTrackerApp();
  window.app = app;
});
