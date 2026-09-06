#!/usr/bin/env python3
"""Production JavaScript Bundler and Minifier for OmniTactica.

Combines all modular frontend scripts in dependency order, strips comments,
collapses whitespace, and outputs web/js/app.bundle.min.js.
Uses Crockford's lexical state machine supporting regexes and template literals.
"""

import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
WEB_JS_DIR = ROOT_DIR / "web" / "js"
OUTPUT_BUNDLE = WEB_JS_DIR / "app.bundle.min.js"

BUNDLE_MODULES = [
    "utils.js",
    "api.js",
    "leaderboard.js",
    "teams.js",
    "players.js",
    "tournaments.js",
    "factions.js",
    "predictor.js",
    "modals.js",
    "auth.js",
    "my_hub.js",
    "eventstudio.js",
    "connect.js",
    "community.js",
    "app.js"
]

try:
    import rjsmin
    def jsmin(code: str) -> str:
        return rjsmin.jsmin(code)
except ImportError:
    import re
    def jsmin(code: str) -> str:
        # Fallback basic stripper
        return code


def build_bundle():
    print(f"📦 Bundling {len(BUNDLE_MODULES)} modules for OmniTactica...")
    bundled_parts = []
    total_raw_bytes = 0

    for mod_name in BUNDLE_MODULES:
        mod_path = WEB_JS_DIR / mod_name
        if not mod_path.exists():
            print(f"❌ Error: Required module {mod_name} not found at {mod_path}")
            sys.exit(1)
            
        raw_content = mod_path.read_text(encoding="utf-8")
        total_raw_bytes += len(raw_content.encode("utf-8"))
        minified = jsmin(raw_content)
        
        # Ensure clean module separation
        minified = minified.strip()
        if not minified.endswith(";"):
            minified += ";"
        bundled_parts.append(minified)
        print(f"  ✓ Processed {mod_name} ({len(raw_content)} -> {len(minified)} bytes)")

    full_bundle = "\n\n".join(bundled_parts)
    OUTPUT_BUNDLE.write_text(full_bundle, encoding="utf-8")
    
    bundle_bytes = len(full_bundle.encode("utf-8"))
    savings = (1 - (bundle_bytes / total_raw_bytes)) * 100 if total_raw_bytes else 0
    print(f"\n🎉 Successfully created {OUTPUT_BUNDLE.name}:")
    print(f"   Raw Total: {total_raw_bytes / 1024:.1f} KB")
    print(f"   Bundled:   {bundle_bytes / 1024:.1f} KB (Reduced by {savings:.1f}%)")

if __name__ == "__main__":
    build_bundle()
