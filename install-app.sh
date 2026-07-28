#!/bin/bash
set -euo pipefail

APP_NAME="Dumka Mail"
TARGET_DIR="/Applications"

restore_host_native_modules() {
    echo "=== Restoring native modules for the host Node.js runtime ==="
    npm rebuild better-sqlite3
}

trap restore_host_native_modules EXIT

echo "=== Step 1: Quitting old version if running ==="
# Quit gracefully using AppleScript
if pgrep -f "${APP_NAME}.app" > /dev/null; then
    echo "App is running. Sending quit command..."
    osascript -e "quit app \"${APP_NAME}\"" 2>/dev/null || true
    
    # Wait for the app to close
    for i in {1..5}; do
        if ! pgrep -f "${APP_NAME}.app" > /dev/null; then
            break
        fi
        sleep 1
    done
    
    # If still running, force kill
    if pgrep -f "${APP_NAME}.app" > /dev/null; then
        echo "App did not quit gracefully. Force killing..."
        pkill -f "${APP_NAME}.app" || true
    else
        echo "App quit successfully."
    fi
else
    echo "App is not running."
fi

echo "=== Step 2: Rebuilding native modules for Electron ==="
./node_modules/.bin/electron-rebuild --force --which-module better-sqlite3

echo "=== Step 3: Building release version ==="
npm run package:mac

echo "=== Step 4: Finding built app bundle ==="
# Find the built Dumka Mail.app under release/
APP_PATH=$(find release -type d -name "${APP_NAME}.app" -print -quit)

if [ -z "$APP_PATH" ]; then
    echo "Error: Built app bundle not found in release/"
    exit 1
fi
echo "Found built bundle: $APP_PATH"

echo "=== Step 5: Installing to ${TARGET_DIR} ==="
if [ -d "${TARGET_DIR}/${APP_NAME}.app" ]; then
    echo "Removing existing installation..."
    rm -rf "${TARGET_DIR}/${APP_NAME}.app"
fi

echo "Copying to ${TARGET_DIR}..."
if cp -R "$APP_PATH" "${TARGET_DIR}/"; then
    echo "Installation successful!"
    echo "=== Step 5.5: Applying ad-hoc code signature for native features (notifications) ==="
    codesign --force --deep --sign - "${TARGET_DIR}/${APP_NAME}.app"
else
    echo "Error: Failed to copy to ${TARGET_DIR}. You might need root privileges."
    echo "Try running: sudo cp -R \"$APP_PATH\" \"${TARGET_DIR}/\""
    exit 1
fi

restore_host_native_modules
trap - EXIT

echo "=== Step 6: Launching the new version ==="
open "${TARGET_DIR}/${APP_NAME}.app"
echo "Done!"
