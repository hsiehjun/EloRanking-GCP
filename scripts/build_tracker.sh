#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TRACKER_SRC="$ROOT_DIR/web/tracker/src"
TRACKER_OUT="$ROOT_DIR/web/tracker/bundle.js"
TRACKER_STATIC_OUT="$ROOT_DIR/web/tracker/static/bundle.js"

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

echo "--> Compiling Warhammer 40k Game Tracker from $TRACKER_SRC..."
NODE_PATH="$NODE_MODULES" "$ESBUILD_BIN" "$TRACKER_SRC/index.jsx" \
  --bundle \
  --outfile="$TRACKER_OUT" \
  --loader:.js=jsx \
  --loader:.jsx=jsx \
  --define:process.env.NODE_ENV=\"production\" \
  --minify

mkdir -p "$(dirname "$TRACKER_STATIC_OUT")"
cp "$TRACKER_OUT" "$TRACKER_STATIC_OUT"

echo "--> Build succeeded: $TRACKER_OUT ($(du -h "$TRACKER_OUT" | cut -f1))"
