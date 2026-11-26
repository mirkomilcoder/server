#!/usr/bin/env bash
# Copy panel/dist to a server for development (no root needed):
#   ./scripts/deploy.sh [user@host] [port]
# Installs to ~/.local/share/cockpit/mirkomil — Cockpit never caches this location,
# so a browser refresh shows the new build. (System install: sudo mirkomil repair.)
set -euo pipefail
TARGET="${1:-home-server@localhost}"
PORT="${2:-2222}"
cd "$(dirname "$0")/.."
[[ -f dist/manifest.json ]] || { echo "dist/ yo'q — avval: npm run build" >&2; exit 1; }
tar -C dist -cf - . | ssh -p "$PORT" "$TARGET" \
  'set -e; d=~/.local/share/cockpit/mirkomil; rm -rf "$d.new"; mkdir -p "$d.new"; tar -C "$d.new" -xf -; rm -rf "$d"; mv "$d.new" "$d"; echo "deployed: $d"'
