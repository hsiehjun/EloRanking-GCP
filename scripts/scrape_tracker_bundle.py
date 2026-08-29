#!/usr/bin/env python3
"""
Scrapes the static web bundle of https://gdmissions.app/11th/tracker
and prepares it for offline hosting with Service Worker neutralization
and multiplayer synchronization injection.
"""

import os
import re
import urllib.request
import urllib.parse
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
    print(f"--> Scraping GDM 11th Tracker Bundle to {DEST_DIR}...")
    DEST_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Fetch tracker landing and play HTML
    tracker_html_raw = fetch(f"{BASE_URL}/11th/tracker").decode("utf-8")
    
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
        matches = re.findall(pattern, tracker_html_raw)
        for m in matches:
            found_assets.add(m)

    print(f"--> Found {len(found_assets)} static assets in initial HTML. Downloading...")
    for asset in sorted(found_assets):
        download_asset(asset)

    # 2. Inspect downloaded JS chunks to find any secondary chunks / dynamic imports
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

    # 3. Neutralize Service Workers and inject Multiplayer Sync Hook
    print("--> Neutralizing Service Workers and injecting Multiplayer Sync Client...")
    
    # Neutralization and Sync client script
    sync_injection = """
  <!-- NEUTRALIZE UPSTREAM SERVICE WORKERS -->
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for (let registration of registrations) {
          registration.unregister();
        }
      });
      // Stub registration to prevent new workers
      navigator.serviceWorker.register = function() {
        console.log('[Multiplayer Overlay] Neutralized upstream ServiceWorker registration');
        return Promise.reject(new Error('ServiceWorker neutralized for multiplayer overlay'));
      };
    }
  </script>

  <!-- MULTIPLAYER SYNCHRONIZATION OVERLAY CLIENT -->
  <link rel="stylesheet" href="/tracker/tracker_sync.css?v=1.0">
  <script src="/tracker/tracker_sync.js?v=1.0"></script>
</body>
"""

    cleaned_html = tracker_html_raw
    # Remove upstream service worker registration chunks if explicitly in HTML
    cleaned_html = re.sub(r'<script[^>]*src="[^"]*service-worker[^"]*"[^>]*></script>', '', cleaned_html)
    cleaned_html = re.sub(r'<script[^>]*stats\.game-datacards\.eu[^>]*></script>', '', cleaned_html)
    cleaned_html = cleaned_html.replace("</body>", sync_injection)

    # Save to DEST_DIR / index.html
    index_file = DEST_DIR / "index.html"
    with open(index_file, "w", encoding="utf-8") as f:
        f.write(cleaned_html)
    print(f"--> Saved sanitized index.html to {index_file} ({len(cleaned_html)} bytes)")

if __name__ == "__main__":
    main()
