#!/bin/bash
# Usage: launch.sh <profile-name> [KEY=VALUE ...]   (fresh=1 wipes the profile first)
# Starts the sandboxed app. Requires DR_SCRATCH to point at a throwaway directory that
# contains ./app (a copy of dist + dist-electron with the Electron-ABI better-sqlite3).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
: "${DR_SCRATCH:?set DR_SCRATCH}"
NAME="$1"; shift
pkill -f "harness/main.cjs" 2>/dev/null || true
sleep 1
for kv in "$@"; do export "$kv"; done
if [ "${fresh:-0}" = "1" ]; then rm -rf "$DR_SCRATCH/profiles/$NAME"; fi
mkdir -p "$DR_SCRATCH/profiles"
DR_APP_DIR="$DR_SCRATCH/app" DR_PROFILE="$DR_SCRATCH/profiles/$NAME" \
  nohup "$REPO/node_modules/.bin/electron" "$HERE/main.cjs" --remote-debugging-port=9333 \
  > "$DR_SCRATCH/profiles/$NAME.log" 2>&1 &
for i in $(seq 1 40); do curl -s http://127.0.0.1:9333/json >/dev/null 2>&1 && break; sleep 0.25; done
echo "launched $NAME"
