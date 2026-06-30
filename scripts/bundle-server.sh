#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/.build/server"
BINARIES="$ROOT/src-tauri/binaries"
STATIC="$ROOT/src-tauri/server-dist"

rm -rf "$DIST" "$STATIC"
mkdir -p "$DIST" "$BINARIES" "$STATIC"

cp "$ROOT/index.html" "$ROOT/app.js" "$ROOT/styles.css" "$ROOT/workflow-ui.css" "$ROOT/local-app.css" "$ROOT/brand-logo.svg" "$STATIC/"
cp -R "$ROOT/client" "$STATIC/"

npx esbuild "$ROOT/server.js" \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile="$DIST/server.cjs"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)
    PKG_TARGET="node18-macos-arm64"
    TRIPLE="aarch64-apple-darwin"
    ;;
  x86_64)
    PKG_TARGET="node18-macos-x64"
    TRIPLE="x86_64-apple-darwin"
    ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

OUTPUT="$BINARIES/server-$TRIPLE"
npx pkg "$DIST/server.cjs" --targets "$PKG_TARGET" --output "$OUTPUT"
chmod +x "$OUTPUT"

echo "Sidecar binary: $OUTPUT"
echo "Static assets: $STATIC"
