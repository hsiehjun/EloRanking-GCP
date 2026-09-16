#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

TRACKER_40K_SRC="$ROOT_DIR/web/tracker/src/40k"
TRACKER_AOS_SRC="$ROOT_DIR/web/tracker/src/aos"

TRACKER_40K_OUT="$ROOT_DIR/web/tracker/bundle_40k.js"
TRACKER_40K_LEGACY_OUT="$ROOT_DIR/web/tracker/bundle.js"
TRACKER_40K_STATIC_OUT="$ROOT_DIR/web/tracker/static/bundle.js"

TRACKER_AOS_OUT="$ROOT_DIR/web/tracker/bundle_aos.js"
TRACKER_AOS_STATIC_OUT="$ROOT_DIR/web/tracker/static/bundle_aos.js"

# Node & Esbuild Discovery
ESBUILD_BIN="$ROOT_DIR/../gdmission-app/node_modules/esbuild/bin/esbuild"
NODE_MODULES="$ROOT_DIR/../gdmission-app/node_modules"

if [ ! -f "$ESBUILD_BIN" ]; then
  if command -v esbuild >/dev/null 2>&1; then
    ESBUILD_BIN="$(command -v esbuild)"
  else
    echo "Error: esbuild binary not found. Please install esbuild."
    exit 1
  fi
fi

# Assert Zero Cross-Directory Imports between 40k and AoS
echo "--> Verifying strict bundle decoupling between 40k and AoS..."
if grep -rn "from.*src/40k" "$TRACKER_AOS_SRC" >/dev/null 2>&1; then
  echo "❌ Error: Forbidden import from 40k into AoS bundle detected!"
  grep -rn "from.*src/40k" "$TRACKER_AOS_SRC"
  exit 1
fi
if grep -rn "from.*src/aos" "$TRACKER_40K_SRC" >/dev/null 2>&1; then
  echo "❌ Error: Forbidden import from AoS into 40k bundle detected!"
  grep -rn "from.*src/aos" "$TRACKER_40K_SRC"
  exit 1
fi
echo "  ✓ Decoupling verification passed: Zero cross-imports."

# 1. Compile Warhammer 40,000 Game Tracker
echo "--> Compiling Warhammer 40k Game Tracker from $TRACKER_40K_SRC..."
NODE_PATH="$NODE_MODULES" "$ESBUILD_BIN" "$TRACKER_40K_SRC/index.jsx" \
  --bundle \
  --outfile="$TRACKER_40K_OUT" \
  --loader:.js=jsx \
  --loader:.jsx=jsx \
  --define:process.env.NODE_ENV=\"production\" \
  --minify

cp "$TRACKER_40K_OUT" "$TRACKER_40K_LEGACY_OUT"
mkdir -p "$(dirname "$TRACKER_40K_STATIC_OUT")"
cp "$TRACKER_40K_OUT" "$TRACKER_40K_STATIC_OUT"
echo "  ✓ 40k Build succeeded: $TRACKER_40K_OUT ($(du -h "$TRACKER_40K_OUT" | cut -f1))"

# 2. Compile Age of Sigmar (AoS) Game Tracker
echo "--> Compiling Age of Sigmar Game Tracker from $TRACKER_AOS_SRC..."
NODE_PATH="$NODE_MODULES" "$ESBUILD_BIN" "$TRACKER_AOS_SRC/index.jsx" \
  --bundle \
  --outfile="$TRACKER_AOS_OUT" \
  --loader:.js=jsx \
  --loader:.jsx=jsx \
  --define:process.env.NODE_ENV=\"production\" \
  --minify

cp "$TRACKER_AOS_OUT" "$TRACKER_AOS_STATIC_OUT"
echo "  ✓ AoS Build succeeded: $TRACKER_AOS_OUT ($(du -h "$TRACKER_AOS_OUT" | cut -f1))"

echo "🎉 All decoupled game tracker bundles compiled successfully!"
