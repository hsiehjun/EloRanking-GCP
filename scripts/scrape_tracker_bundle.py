#!/usr/bin/env python3
"""
Synchronized Multiplayer Bundle Scraper & Neutralizer for GDM 11th Tracker.
Downloads static assets from https://gdmissions.app/11th/tracker/play,
strips header/footer, neutralizes service workers, and injects real-time multiplayer overlay.

Usage:
    python3 scripts/scrape_tracker_bundle.py
"""

import os
import re
import urllib.request
from pathlib import Path

BASE_URL = "https://gdmissions.app"
DEST_DIR = Path(__file__).resolve().parent.parent / "web" / "tracker"
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
        print(f"  [!] Failed to download {full_url}: {e}")
        return None

def main():
    print(f"--> [1/4] Scraping GDM 11th Play Tracker from {BASE_URL}/11th/tracker/play to {DEST_DIR}...")
    DEST_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Fetch live Play HTML
    play_html_raw = fetch(f"{BASE_URL}/11th/tracker/play").decode("utf-8")
    
    # Extract all assets from HTML
    asset_patterns = [
        r'src="(/_next/static/[^"]+)"',
        r'href="(/_next/static/[^"]+)"',
        r'href="(/logo[^"]+)"',
        r'src="(/logo[^"]+)"',
        r'"(/_next/static/chunks/[^"]+)"',
        r'"(/_next/static/css/[^"]+)"',
        r'"(/_next/static/media/[^"]+)"',
    ]

    found_assets = set()
    for pattern in asset_patterns:
        matches = re.findall(pattern, play_html_raw)
        for m in matches:
            found_assets.add(m)

    print(f"--> [2/4] Downloading {len(found_assets)} static assets...")
    for asset in sorted(found_assets):
        download_asset(asset)

    # 2. Inspect downloaded JS chunks to find any secondary chunks / fonts
    chunks_dir = DEST_DIR / "_next" / "static" / "chunks"
    if chunks_dir.exists():
        for js_file in list(chunks_dir.glob("**/*.js")):
            try:
                content = js_file.read_text(encoding="utf-8", errors="ignore")
                more_chunks = re.findall(r'static/chunks/[a-zA-Z0-9_\-\.]+\.js', content)
                for chunk in more_chunks:
                    download_asset(f"/_next/{chunk}")
                more_media = re.findall(r'static/media/[a-zA-Z0-9_\-\.]+\.woff2?', content)
                for med in more_media:
                    download_asset(f"/_next/{med}")
            except Exception as e:
                pass

    # 3. Clean HTML: Strip Header, Footer, Analytics & Neutralize Service Workers
    print("--> [3/4] Sanitizing HTML: Removing headers/footers, neutralizing Service Workers...")
    
    pre_seed_script = """
  <!-- PRE-SEED ACTIVE 11TH GAME STATE FOR DIRECT PLAY -->
  <script>
    (function() {
      try {
        var existing = localStorage.getItem('gdm-11e-tracker-state');
        if (!existing || existing === '{}' || existing === 'null') {
          var initDeck = [
            "a-grievous-blow", "a-tempting-target", "assassination", "beacon",
            "behind-enemy-lines", "bring-it-down", "burden-of-trust", "centre-ground",
            "cleanse", "containment", "cull-the-horde", "defend-stronghold",
            "deploy-teleport-homers", "disruption", "engage-on-all-fronts",
            "extend-battle-lines", "marked-for-death", "no-prisoners", "overwhelming-force",
            "raise-banners", "sabotage", "secure-no-mans-land", "storm-hostile-objective"
          ];
          var initialGame = {
            id: "g-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
            game: {
              p1Name: "Player 1",
              p2Name: "Player 2",
              p1Faction: null,
              p2Faction: null,
              p1Detachments: [],
              p2Detachments: [],
              p1Disposition: null,
              p2Disposition: null,
              p1Primary: null,
              p2Primary: null,
              p1Role: "attacker",
              p2Role: "defender",
              p1MissionType: null,
              p2MissionType: null,
              rollOffWinner: 1,
              firstTurn: 1,
              deployment: "search-and-destroy",
              terrainLayout: null
            },
            p1: {
              deck: { available: initDeck.slice() },
              hand: [],
              rounds: [
                { primaryScore: 0 },
                { primaryScore: 0 },
                { primaryScore: 0 },
                { primaryScore: 0 },
                { primaryScore: 0 }
              ],
              cp: 1,
              battleReady: true,
              currentRound: 1
            },
            p2: {
              deck: { available: initDeck.slice() },
              hand: [],
              rounds: [
                { primaryScore: 0 },
                { primaryScore: 0 },
                { primaryScore: 0 },
                { primaryScore: 0 },
                { primaryScore: 0 }
              ],
              cp: 1,
              battleReady: true,
              currentRound: 1
            },
            round: 1,
            started: true
          };
          localStorage.setItem('gdm-11e-tracker-state', JSON.stringify(initialGame));
          localStorage.setItem('gdm-11e-tracker-settings', JSON.stringify({
            defaultName: "",
            defaultFaction: null,
            defaultDetachments: [],
            trackCP: true,
            showScoreGroups: true
          }));
        }
      } catch(e) {
        console.warn('Pre-seed notice:', e);
      }
    })();
  </script>
"""

    sync_injection = """
  <!-- NEUTRALIZE UPSTREAM SERVICE WORKERS -->
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for (let registration of registrations) {
          registration.unregister();
        }
      });
      navigator.serviceWorker.register = function() {
        return Promise.reject(new Error('ServiceWorker neutralized'));
      };
    }
  </script>

  <!-- MULTIPLAYER SYNCHRONIZATION OVERLAY CLIENT -->
  <link rel="stylesheet" href="/tracker/tracker_sync.css?v=2.2">
  <script src="/tracker/tracker_sync.js?v=2.2"></script>
</body>
"""

    cleaned_html = play_html_raw
    # Insert pre_seed_script right after <head>
    cleaned_html = cleaned_html.replace("<head>", "<head>" + pre_seed_script)

    # Remove headers and footers from HTML
    cleaned_html = re.sub(r'<header[^>]*class="[^"]*tac-header[^"]*"[^>]*>.*?</header>', '', cleaned_html, flags=re.DOTALL)
    cleaned_html = re.sub(r'<footer[^>]*class="[^"]*tac-footer[^"]*"[^>]*>.*?</footer>', '', cleaned_html, flags=re.DOTALL)

    # Remove external analytics
    cleaned_html = re.sub(r'<script[^>]*stats\.game-datacards\.eu[^>]*></script>', '', cleaned_html)
    cleaned_html = re.sub(r'<script[^>]*cloudflareinsights[^>]*></script>', '', cleaned_html)

    # Append sync injection before </body>
    cleaned_html = cleaned_html.replace("</body>", sync_injection)

    # Save to index.html and play.html
    print("--> [4/4] Writing sanitized index.html and play.html...")
    (DEST_DIR / "index.html").write_text(cleaned_html, encoding="utf-8")
    (DEST_DIR / "play.html").write_text(cleaned_html, encoding="utf-8")
    print(f"--> [Done] Bundle updated successfully in {DEST_DIR}!")

if __name__ == "__main__":
    main()
