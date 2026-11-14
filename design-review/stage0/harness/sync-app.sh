#!/bin/bash
# Copies the current build (dist + dist-electron) into the sandbox app directory used by launch.sh.
set -euo pipefail
: "${DR_SCRATCH:?set DR_SCRATCH}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
rm -rf "$DR_SCRATCH/app/dist" "$DR_SCRATCH/app/dist-electron"
cp -R "$REPO/dist" "$REPO/dist-electron" "$DR_SCRATCH/app/"
cp "$REPO/package.json" "$DR_SCRATCH/app/"
echo "synced build into $DR_SCRATCH/app"
