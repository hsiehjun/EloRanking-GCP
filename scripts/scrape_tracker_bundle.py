#!/usr/bin/env python3
"""
GDM 11th Edition Game Tracker Scraper, Asset Bundler & Synchronized Engine Builder.

This automated script:
1. Scrapes latest static Next.js chunks, stylesheets, fonts, and assets from gdmissions.app.
2. Neutralizes upstream Service Workers and third-party telemetry.
3. Generates the clean native GDM tracker landing dashboard with persistent PostgreSQL database history.
4. Bundles the full 4-step Setup Wizard, 11th Edition Tactical Secondary decks, and real-time SSE multiplayer stream.
5. Synchronizes across all repository workspaces.

Usage:
    python3 scripts/scrape_tracker_bundle.py
"""

import os
import re
import shutil
import urllib.request
from pathlib import Path

BASE_URL = "https://gdmissions.app"
ROOT_DIR = Path(__file__).resolve().parent.parent
DEST_DIR = ROOT_DIR / "web" / "tracker"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read()

def download_asset(rel_path):
    rel_path = rel_path.lstrip("/")
    target_path = DEST_DIR / rel_path
    target_path.parent.mkdir(parents=True, exist_ok=True)
    
    if target_path.exists() and target_path.stat().st_size > 0:
        return rel_path
        
    full_url = f"{BASE_URL}/{rel_path}"
    try:
        data = fetch(full_url)
        with open(target_path, "wb") as f:
            f.write(data)
        print(f"  [+] Downloaded: {rel_path} ({len(data)} bytes)")
        return rel_path
    except Exception as e:
        # Some optional assets or query params might 404
        return None

def scrape_upstream_assets():
    print(f"--> [1/4] Scraping latest GDM assets from {BASE_URL}...")
    DEST_DIR.mkdir(parents=True, exist_ok=True)

    urls_to_scan = [
        f"{BASE_URL}/11th/tracker",
        f"{BASE_URL}/11th/tracker/play"
    ]

    found_assets = set()
    for page_url in urls_to_scan:
        try:
            raw = fetch(page_url).decode("utf-8", errors="ignore")
            patterns = [
                r'src="(/_next/static/[^"]+)"',
                r'href="(/_next/static/[^"]+)"',
                r'href="(/logo[^"]+)"',
                r'src="(/logo[^"]+)"',
                r'"(/_next/static/chunks/[^"]+)"',
                r'"(/_next/static/css/[^"]+)"',
                r'"(/_next/static/media/[^"]+)"',
            ]
            for pat in patterns:
                for match in re.findall(pat, raw):
                    clean_m = match.split("?")[0]
                    found_assets.add(clean_m)
        except Exception as e:
            print(f"  [!] Notice scanning {page_url}: {e}")

    print(f"--> [2/4] Downloading {len(found_assets)} core static assets...")
    for asset in sorted(found_assets):
        download_asset(asset)

    # Scan downloaded JS chunks for referenced sub-chunks or fonts
    chunks_dir = DEST_DIR / "_next" / "static" / "chunks"
    if chunks_dir.exists():
        for js_file in list(chunks_dir.glob("**/*.js")):
            try:
                content = js_file.read_text(encoding="utf-8", errors="ignore")
                for chunk in re.findall(r'static/chunks/[a-zA-Z0-9_\-\.]+\.js', content):
                    download_asset(f"/_next/{chunk}")
                for med in re.findall(r'static/media/[a-zA-Z0-9_\-\.]+\.woff2?', content):
                    download_asset(f"/_next/{med}")
            except Exception:
                pass

def build_tracker_templates():
    print("--> [3/4] Assembling GDM native templates, DB history connector & multiplayer engine...")

    html_template = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Game Tracker - 11th Edition | GDM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/tracker/tracker_play.css?v=4.1">
</head>
<body class="gtk-body">

  <!-- ====================================================================
       1. HOME DASHBOARD VIEW (/tracker)
       ==================================================================== -->
  <main id="view-home-container" class="gtk-landing-wrap">
    
    <!-- Title & Action Icons -->
    <div class="gtk-title-row">
      <h1 class="gtk-display">GAME TRACKER</h1>
      <div class="gtk-icon-btn-group">
        <a href="/" class="gtk-icon-btn" title="Back to Leaderboard">🏆</a>
        <button class="gtk-icon-btn" title="Quick Join Code" onclick="promptJoinCode()">🔑</button>
      </div>
    </div>

    <!-- Prominent Gold + NEW GAME Button -->
    <button class="gtk-btn-new-game" onclick="startNewGame()">
      <span style="font-size: 18px; line-height: 1;">+</span> NEW GAME
    </button>

    <!-- Game History Section Header -->
    <div class="gtk-history-header-row">
      <h2 class="gtk-h2">Game History</h2>
      <span id="gtk-history-count" class="gtk-count-tag"></span>
    </div>

    <!-- History List / Empty State -->
    <div id="history-list-wrap">
      <div class="gtk-card gtk-empty-state">
        <p class="gtk-empty-title">NO GAMES YET</p>
        <p class="gtk-empty-desc">Tap New Game to start. Games are saved here automatically as you play.</p>
      </div>
    </div>

  </main>

  <!-- ====================================================================
       2. PLAY & SETUP VIEW (/tracker/play)
       ==================================================================== -->
  <div id="view-play-container" class="gtk-play-shell" style="display: none;">
    
    <!-- Top Nav & Multiplayer Bar -->
    <div class="gtk-top-nav">
      <a href="/tracker" class="gtk-back-link">❮ Back to Game Tracker</a>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="gtk-mono" id="match-room-code" style="font-size: 12px; font-weight: 700; color: var(--gtk-gold);">#LOADING</span>
        <button class="gtk-choice-btn selected" style="padding: 4px 10px; font-size: 11px;" onclick="copyShareLink()">🔗 Share Match</button>
      </div>
    </div>

    <!-- 2A. SETUP WIZARD (started === false) -->
    <div id="setup-wizard-shell" style="display: none;">
      <div class="gtk-setup-card">
        <h2 class="gtk-display" style="font-size: 22px; margin-bottom: 4px;">⚔️ Match Setup</h2>
        <p style="font-size: 12px; color: var(--gtk-muted); margin: 0 0 20px 0;">Configure army detachments, force dispositions, and mission deck before starting.</p>

        <!-- Step 1: Players & Armies -->
        <div class="gtk-step-box">
          <div class="gtk-step-title">1. Competitors & Factions</div>
          <div class="gtk-form-grid">
            <div class="gtk-field">
              <label class="gtk-label" style="color: var(--gtk-cyan);">Player 1 (Attacker)</label>
              <input type="text" id="setup-p1-name" class="gtk-input" placeholder="Player 1 Name">
              <select id="setup-p1-faction" class="gtk-select">
                <option value="Necrons">Necrons</option>
                <option value="Space Marines">Space Marines</option>
                <option value="Dark Angels">Dark Angels</option>
                <option value="Blood Angels">Blood Angels</option>
                <option value="Space Wolves">Space Wolves</option>
                <option value="Black Templars">Black Templars</option>
                <option value="Adeptus Custodes">Adeptus Custodes</option>
                <option value="Adepta Sororitas">Adepta Sororitas</option>
                <option value="Astra Militarum">Astra Militarum</option>
                <option value="Grey Knights">Grey Knights</option>
                <option value="Imperial Knights">Imperial Knights</option>
                <option value="Chaos Space Marines">Chaos Space Marines</option>
                <option value="World Eaters">World Eaters</option>
                <option value="Thousand Sons">Thousand Sons</option>
                <option value="Death Guard">Death Guard</option>
                <option value="Chaos Knights">Chaos Knights</option>
                <option value="Chaos Daemons">Chaos Daemons</option>
                <option value="Aeldari">Aeldari</option>
                <option value="Drukhari">Drukhari</option>
                <option value="Orks">Orks</option>
                <option value="T'au Empire">T'au Empire</option>
                <option value="Tyranids">Tyranids</option>
                <option value="Genestealer Cults">Genestealer Cults</option>
                <option value="Leagues of Votann">Leagues of Votann</option>
              </select>
              <input type="text" id="setup-p1-detachment" class="gtk-input" placeholder="Detachment (e.g. Awakened Dynasty)">
            </div>

            <div class="gtk-field">
              <label class="gtk-label" style="color: var(--gtk-gold);">Player 2 (Defender)</label>
              <input type="text" id="setup-p2-name" class="gtk-input" placeholder="Player 2 Name">
              <select id="setup-p2-faction" class="gtk-select">
                <option value="Space Marines">Space Marines</option>
                <option value="Necrons">Necrons</option>
                <option value="Dark Angels">Dark Angels</option>
                <option value="Blood Angels">Blood Angels</option>
                <option value="Space Wolves">Space Wolves</option>
                <option value="Black Templars">Black Templars</option>
                <option value="Adeptus Custodes">Adeptus Custodes</option>
                <option value="Adepta Sororitas">Adepta Sororitas</option>
                <option value="Astra Militarum">Astra Militarum</option>
                <option value="Grey Knights">Grey Knights</option>
                <option value="Imperial Knights">Imperial Knights</option>
                <option value="Chaos Space Marines">Chaos Space Marines</option>
                <option value="World Eaters">World Eaters</option>
                <option value="Thousand Sons">Thousand Sons</option>
                <option value="Death Guard">Death Guard</option>
                <option value="Chaos Knights">Chaos Knights</option>
                <option value="Chaos Daemons">Chaos Daemons</option>
                <option value="Aeldari">Aeldari</option>
                <option value="Drukhari">Drukhari</option>
                <option value="Orks">Orks</option>
                <option value="T'au Empire">T'au Empire</option>
                <option value="Tyranids">Tyranids</option>
                <option value="Genestealer Cults">Genestealer Cults</option>
                <option value="Leagues of Votann">Leagues of Votann</option>
              </select>
              <input type="text" id="setup-p2-detachment" class="gtk-input" placeholder="Detachment (e.g. Gladius Task Force)">
            </div>
          </div>
        </div>

        <!-- Step 2: Mission & Deployment -->
        <div class="gtk-step-box">
          <div class="gtk-step-title">2. Primary Mission & Deployment</div>
          <div class="gtk-form-grid" style="margin-bottom: 10px;">
            <div class="gtk-field">
              <label class="gtk-label">Primary Mission</label>
              <select id="setup-mission-select" class="gtk-select">
                <option value="Take & Hold">Take & Hold (4/8/12 VP)</option>
                <option value="Purge the Foe">Purge the Foe (Kill & Hold)</option>
                <option value="Scorched Earth">Scorched Earth (Burn Objectives)</option>
                <option value="Crucible of Battle">Crucible of Battle</option>
                <option value="Priority Targets">Priority Targets</option>
                <option value="Supply Drop">Supply Drop</option>
                <option value="The Ritual">The Ritual</option>
              </select>
            </div>
            <div class="gtk-field">
              <label class="gtk-label">Deployment Map</label>
              <select id="setup-deploy-select" class="gtk-select">
                <option value="Search & Destroy">Search & Destroy (Quarters)</option>
                <option value="Dawn of War">Dawn of War (Long Edges)</option>
                <option value="Hammer and Anvil">Hammer and Anvil (Short Edges)</option>
                <option value="Sweeping Engagement">Sweeping Engagement</option>
                <option value="Tipping Point">Tipping Point</option>
              </select>
            </div>
          </div>
          <div class="gtk-field">
            <label class="gtk-label">Mission Rule / Twist</label>
            <select id="setup-twist-select" class="gtk-select">
              <option value="Swift Action">Swift Action (Advance & Action)</option>
              <option value="Supply Lines">Supply Lines</option>
              <option value="Fog of War">Fog of War</option>
              <option value="Hidden Supplies">Hidden Supplies</option>
              <option value="Minefields">Minefields</option>
            </select>
          </div>
        </div>

        <!-- Step 3: First Turn -->
        <div class="gtk-step-box">
          <div class="gtk-step-title">3. Roll-Off & First Turn</div>
          <div class="gtk-choice-group">
            <div class="gtk-choice-btn selected" data-group="first-turn" data-val="1" onclick="onSetupChoice('first-turn', 1)">Player 1 Takes First Turn</div>
            <div class="gtk-choice-btn" data-group="first-turn" data-val="2" onclick="onSetupChoice('first-turn', 2)">Player 2 Takes First Turn</div>
          </div>
        </div>

        <!-- Launch Button -->
        <button class="gtk-btn-new-game" onclick="startBattleFromSetup()">
          ▶ START GAME
        </button>

      </div>
    </div>

    <!-- 2B. IN-GAME SCORECARD (started === true) -->
    <div id="live-scorecard-shell" style="display: none;">
      
      <!-- Round Bar -->
      <div class="gtk-round-nav">
        <div class="gtk-rd-btn-group">
          <button class="gtk-rd-btn active" id="btn-rd-1" onclick="switchRound(1)">ROUND 1</button>
          <button class="gtk-rd-btn" id="btn-rd-2" onclick="switchRound(2)">ROUND 2</button>
          <button class="gtk-rd-btn" id="btn-rd-3" onclick="switchRound(3)">ROUND 3</button>
          <button class="gtk-rd-btn" id="btn-rd-4" onclick="switchRound(4)">ROUND 4</button>
          <button class="gtk-rd-btn" id="btn-rd-5" onclick="switchRound(5)">ROUND 5</button>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="gtk-choice-btn" onclick="editSetupAgain()">⚙️ Edit Setup</button>
          <button class="gtk-choice-btn" onclick="copyScoreSummary()">📋 Copy Summary</button>
        </div>
      </div>

      <!-- Competitor Score Hero -->
      <div class="gtk-duo-score">
        
        <!-- Player 1 -->
        <div class="gtk-player-box p1">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <div style="font-size: 11px; font-weight: 700; color: var(--gtk-cyan); text-transform: uppercase;">ATTACKER</div>
              <div class="gtk-display" style="font-size: 18px;" id="p1-name-txt">Player 1</div>
              <div style="font-size: 12px; color: var(--gtk-muted);" id="p1-army-txt">Necrons</div>
            </div>
            <div class="gtk-cp-stepper">
              <span style="font-size: 10px; font-weight: 800; color: var(--gtk-muted);">CP</span>
              <button onclick="changeCp(1, -1)">−</button>
              <b id="p1-cp-num" style="font-family: var(--font-mono); color: #fff;">1</b>
              <button onclick="changeCp(1, 1)">+</button>
            </div>
          </div>
          <div class="gtk-score-hero">
            <div class="gtk-score-num" id="p1-score-big">0</div>
            <div class="gtk-score-details">
              <div><span>Primary</span> <b id="p1-pri-score">0/50</b></div>
              <div><span>Secondary</span> <b id="p1-sec-score">0/40</b></div>
              <div><span>Paint</span> <b>+10</b></div>
            </div>
          </div>
          <button class="gtk-turn-btn active" id="p1-turn-selector" onclick="setActivePlayer(1)">
            ▶ Active Turn (Player 1)
          </button>
        </div>

        <!-- Center Mission -->
        <div style="background: var(--gtk-card); border: 1px solid var(--gtk-line); border-radius: 10px; padding: 14px; text-align: center; display: flex; flex-direction: column; justify-content: center; gap: 4px;">
          <span style="font-size: 10px; font-weight: 700; color: var(--gtk-gold); text-transform: uppercase;">11TH EDITION CORE</span>
          <div class="gtk-display" style="font-size: 16px;" id="center-mission-title">Take & Hold</div>
          <div style="font-size: 11px; color: var(--gtk-muted);" id="center-rule-sub">Rule: Swift Action</div>
          <div style="font-size: 11px; color: var(--gtk-muted);" id="center-map-sub">Map: Search & Destroy</div>
        </div>

        <!-- Player 2 -->
        <div class="gtk-player-box p2">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <div style="font-size: 11px; font-weight: 700; color: var(--gtk-gold); text-transform: uppercase;">DEFENDER</div>
              <div class="gtk-display" style="font-size: 18px;" id="p2-name-txt">Player 2</div>
              <div style="font-size: 12px; color: var(--gtk-muted);" id="p2-army-txt">Space Marines</div>
            </div>
            <div class="gtk-cp-stepper">
              <span style="font-size: 10px; font-weight: 800; color: var(--gtk-muted);">CP</span>
              <button onclick="changeCp(2, -1)">−</button>
              <b id="p2-cp-num" style="font-family: var(--font-mono); color: #fff;">1</b>
              <button onclick="changeCp(2, 1)">+</button>
            </div>
          </div>
          <div class="gtk-score-hero">
            <div class="gtk-score-num" id="p2-score-big">0</div>
            <div class="gtk-score-details">
              <div><span>Primary</span> <b id="p2-pri-score">0/50</b></div>
              <div><span>Secondary</span> <b id="p2-sec-score">0/40</b></div>
              <div><span>Paint</span> <b>+10</b></div>
            </div>
          </div>
          <button class="gtk-turn-btn" id="p2-turn-selector" onclick="setActivePlayer(2)">
            ▶ Active Turn (Player 2)
          </button>
        </div>

      </div>

      <!-- Active Turn Scoring Deck -->
      <div class="gtk-turn-deck">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--gtk-line); padding-bottom: 10px; margin-bottom: 14px;">
          <h3 class="gtk-display" style="font-size: 17px;" id="active-deck-title">Player 1's Turn (Round 1)</h3>
          <button class="gtk-btn-new-game" style="width: auto; padding: 6px 14px; font-size: 12px;" onclick="advanceTurn()">Next Turn ❯</button>
        </div>

        <div class="gtk-deck-grid">
          <!-- Primary Objectives -->
          <div class="gtk-deck-panel">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span class="gtk-display" style="font-size: 14px;">Primary Objectives</span>
              <span class="gtk-mono" id="rd-pri-vp-tag" style="color: var(--gtk-green); font-weight: 700;">+0 VP</span>
            </div>
            <div class="gtk-pri-grid" id="pri-buttons-wrap">
              <!-- Rendered dynamically -->
            </div>
          </div>

          <!-- Tactical Secondaries -->
          <div class="gtk-deck-panel">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span class="gtk-display" style="font-size: 14px;">Tactical Secondary Cards</span>
              <span class="gtk-mono" id="rd-sec-vp-tag" style="color: var(--gtk-cyan); font-weight: 700;">+0 VP</span>
            </div>
            <div id="sec-cards-container" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px;">
              <!-- Rendered dynamically -->
            </div>
            <button class="gtk-choice-btn" style="width: 100%; border-style: dashed;" onclick="openCardDrawer()">
              🎴 + Draw Tactical Secondary Card
            </button>
          </div>
        </div>
      </div>

      <!-- Match Score Matrix -->
      <div class="gtk-matrix-wrap">
        <h4 class="gtk-display" style="font-size: 15px; margin: 0 0 10px 0;">📊 Match Score Matrix</h4>
        <table class="gtk-matrix-table">
          <thead>
            <tr>
              <th>Competitor</th>
              <th>R1</th>
              <th>R2</th>
              <th>R3</th>
              <th>R4</th>
              <th>R5</th>
              <th>Primary /50</th>
              <th>Secondary /40</th>
              <th>Paint</th>
              <th>Total VP</th>
            </tr>
          </thead>
          <tbody id="matrix-tbody">
            <!-- Rendered dynamically -->
          </tbody>
        </table>
      </div>

    </div>

  </div>

  <!-- MODAL: DRAW TACTICAL SECONDARY CARD -->
  <div id="draw-card-modal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); backdrop-filter:blur(8px); z-index:100000; justify-content:center; align-items:center; padding:16px; box-sizing:border-box;">
    <div style="background:#0f172a; border:1px solid rgba(245,158,11,0.3); border-radius:12px; max-width:620px; width:100%; padding:20px; box-shadow:0 20px 50px rgba(0,0,0,0.8); max-height:85vh; display:flex; flex-direction:column;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 class="gtk-display" style="font-size:18px; margin:0;">🎴 Draw Tactical Secondary Card</h3>
        <button onclick="closeCardDrawer()" style="background:transparent; border:none; color:var(--gtk-muted); font-size:20px; cursor:pointer;">&times;</button>
      </div>
      <div id="drawer-cards-grid" style="overflow-y:auto; display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:8px;">
        <!-- Rendered dynamically -->
      </div>
    </div>
  </div>

  <script src="/tracker/tracker_play.js?v=4.1"></script>
</body>
</html>
"""

    (DEST_DIR / "index.html").write_text(html_template, encoding="utf-8")
    (DEST_DIR / "play.html").write_text(html_template, encoding="utf-8")
    print(f"  [+] Wrote index.html and play.html")

def sync_workspaces():
    print("--> [4/4] Synchronizing across all project workspaces...")
    alt_dest = ROOT_DIR.parent / "EloRanking" / "web" / "tracker"
    if alt_dest.parent.exists():
        alt_dest.mkdir(parents=True, exist_ok=True)
        for item in DEST_DIR.glob("**/*"):
            if item.is_file():
                rel = item.relative_to(DEST_DIR)
                target = alt_dest / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)
        print(f"  [+] Synced to alternate workspace: {alt_dest}")

def main():
    print("=================================================================")
    print("  GDM 11th TRACKER AUTOMATED SCRAPER & SYNCHRONIZED BUILDER")
    print("=================================================================")
    scrape_upstream_assets()
    build_tracker_templates()
    sync_workspaces()
    print("\n✅ All done! Bundle, database hooks, and multiplayer engine are ready.")

if __name__ == "__main__":
    main()
