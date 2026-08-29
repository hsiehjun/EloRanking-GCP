#!/usr/bin/env python3
"""
GDM 11th Edition Game Tracker Scraper & Multiplayer Host Engine.

This script:
1. Scrapes the complete static HTML, Next.js React chunks, fonts, media, and CSS stylesheets from https://gdmissions.app/11th/tracker and /11th/tracker/play.
2. Downloads all Battlefield Terrain Layout PNG map graphics and Force Disposition icons.
3. Removes upstream navigation header/footer and hides game delete buttons on shared games.
4. Neutralizes upstream Service Workers and tracking telemetry.
5. Injects real-time multiplayer SSE overlay client & PostgreSQL database sync.
6. Preserves the full 7-step setup flow, army detachments, force dispositions, terrain layout diagrams, tactical secondary decks, and live scoring.

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
WEB_DIR = ROOT_DIR / "web"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

import ssl

SSL_CTX = ssl._create_unverified_context()

def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, context=SSL_CTX, timeout=15) as resp:
        return resp.read()

def download_asset(rel_path):
    clean = rel_path.replace("\\", "").strip("\"'\t\n ")
    clean = clean.split("?")[0].lstrip("/")
    target = DEST_DIR / clean
    target.parent.mkdir(parents=True, exist_ok=True)
    
    if target.exists() and target.stat().st_size > 0:
        return clean
        
    full_url = f"{BASE_URL}/{clean}"
    try:
        data = fetch(full_url)
        with open(target, "wb") as f:
            f.write(data)
        print(f"  [+] Downloaded: {clean} ({len(data)} bytes)")
        return clean
    except Exception as e:
        return None

def download_map_assets():
    print("--> Downloading Battlefield Terrain Layout graphics and Force Disposition icons...")
    dispos = ['take-and-hold', 'purge-the-foe', 'reconnaissance', 'priority-assets', 'disruption']
    for d in dispos:
        rel = f"assets/11th/force-disposition/{d}.png"
        target = WEB_DIR / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.stat().st_size == 0:
            try:
                data = fetch(f"{BASE_URL}/{rel}")
                target.write_bytes(data)
            except Exception:
                pass

    matchups = [
        'disruption-mirror', 'disruption-vs-priority-assets', 'disruption-vs-purge-the-foe', 'disruption-vs-reconnaissance',
        'priority-assets-mirror', 'priority-assets-vs-reconnaissance', 'purge-the-foe-mirror', 'purge-the-foe-vs-priority-assets',
        'purge-the-foe-vs-reconnaissance', 'reconnaissance-mirror', 'take-and-hold-mirror', 'take-and-hold-vs-disruption',
        'take-and-hold-vs-priority-assets', 'take-and-hold-vs-purge-the-foe', 'take-and-hold-vs-reconnaissance'
    ]

    for m in matchups:
        for num in [1, 2, 3]:
            for mode in ['no-measurements', 'with-measurements']:
                for suffix in ['', '-portrait']:
                    rel = f"assets/11th/layouts/{mode}/{m}-{num}{suffix}.png"
                    target = WEB_DIR / rel
                    if target.exists() and target.stat().st_size > 0:
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        data = fetch(f"{BASE_URL}/{rel}")
                        target.write_bytes(data)
                    except Exception:
                        pass

def process_page(path, dest_filename):
    print(f"--> Processing {BASE_URL}{path} -> {dest_filename}...")
    raw_html = fetch(f"{BASE_URL}{path}").decode("utf-8", errors="ignore")

    for match in re.findall(r'href="(/_next/static/css/[a-zA-Z0-9_\-\.]+\.css)"', raw_html):
        download_asset(match)
    for match in re.findall(r'src="(/_next/static/chunks/[a-zA-Z0-9_\-\.]+\.js)"', raw_html):
        download_asset(match)
    for match in re.findall(r'src="(/logo[^"]+)"', raw_html):
        download_asset(match)
    for match in re.findall(r'href="(/logo[^"]+)"', raw_html):
        download_asset(match)
    for match in re.findall(r'/_next/static/media/[a-zA-Z0-9_\-\.]+\.woff2?', raw_html):
        download_asset(match)

    # 1. Neutralize Service Workers, Suppress Delete Buttons & Inject Sync Bridge in HEAD
    sync_head_injection = """
  <!-- GDM MULTIPLAYER & DATABASE OVERLAY INJECTION -->
  <link rel="stylesheet" href="/tracker/tracker_sync.css?v=7.0">
  <script src="/tracker/tracker_sync.js?v=7.0"></script>
  <style>
    header.tac-header, footer.tac-footer, .tac-header, .tac-footer {
      display: none !important;
    }
    /* Disable delete options on shared multiplayer matches */
    button[aria-label*="Delete"],
    button[aria-label*="delete"],
    button:has(svg.lucide-trash),
    button:has(svg.lucide-trash-2),
    [class*="delete-game"],
    [data-action="delete"] {
      display: none !important;
    }
  </style>
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for (let registration of registrations) { registration.unregister(); }
      });
      navigator.serviceWorker.register = function() {
        return Promise.reject(new Error('ServiceWorker neutralized'));
      };
    }
  </script>
"""

    cleaned_html = raw_html
    cleaned_html = cleaned_html.replace("<head>", "<head>" + sync_head_injection)

    cleaned_html = re.sub(r'<script[^>]*stats\.game-datacards\.eu[^>]*></script>', '', cleaned_html)
    cleaned_html = re.sub(r'<script[^>]*cloudflareinsights[^>]*></script>', '', cleaned_html)

    (DEST_DIR / dest_filename).write_text(cleaned_html, encoding="utf-8")
    print(f"  [+] Wrote {dest_filename}")

def download_sub_chunks():
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

def sync_workspaces():
    print("--> Synchronizing across all project workspaces...")
    alt_dest = ROOT_DIR.parent / "EloRanking" / "web" / "tracker"
    alt_assets = ROOT_DIR.parent / "EloRanking" / "web" / "assets"
    
    if alt_dest.parent.exists():
        alt_dest.mkdir(parents=True, exist_ok=True)
        for item in DEST_DIR.glob("**/*"):
            if item.is_file():
                rel = item.relative_to(DEST_DIR)
                target = alt_dest / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)

    if (WEB_DIR / "assets").exists() and alt_assets.parent.exists():
        alt_assets.mkdir(parents=True, exist_ok=True)
        for item in (WEB_DIR / "assets").glob("**/*"):
            if item.is_file():
                rel = item.relative_to(WEB_DIR / "assets")
                target = alt_assets / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)

def main():
    print("=================================================================")
    print("  GDM 11th TRACKER AUTOMATED SCRAPER & SYNCHRONIZED BUILDER")
    print("=================================================================")
    DEST_DIR.mkdir(parents=True, exist_ok=True)

    # Process Landing page (/11th/tracker) -> index.html
    process_page("/11th/tracker", "index.html")

    # Process Play page (/11th/tracker/play) -> play.html
    process_page("/11th/tracker/play", "play.html")

    # Download layout images
    download_map_assets()

    # Scan for referenced sub-chunks
    download_sub_chunks()

    # Sync
    sync_workspaces()
    print("\n✅ All done! Authentic GDM bundle, maps, and database hooks are ready.")

if __name__ == "__main__":
    main()
