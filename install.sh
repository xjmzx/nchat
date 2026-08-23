#!/bin/bash
# Build nchat and install it to /Applications, then relaunch. macOS only.
#
#   ./install.sh               # build (release) + quit + install + relaunch
#   ./install.sh --skip-build  # reinstall the last build without rebuilding
#
# Or via npm:  npm run install:app
#
# Why this exists rather than `make install`: that target is Linux's — it drops a
# bare binary in ~/.local/bin next to a .desktop entry, and `make build` passes
# --no-bundle to match. On macOS a bare binary has no Info.plist, no icon and no
# bundle identifier, and the identifier is not cosmetic here: the Keychain keys
# its ACLs off code identity, and this app's whole secret-handling design rests
# on the Keychain. So macOS wants the .app bundle, which means a full
# `tauri build`.
set -euo pipefail
cd "$(dirname "$0")"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "install.sh is macOS-only (installs a .app to /Applications)." >&2
  echo "On Linux use: make install" >&2
  exit 1
fi

APP_NAME="nchat.app"
BUILT="src-tauri/target/release/bundle/macos/$APP_NAME"

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "--- Building nchat (release) ---"
  npm run tauri build
fi

if [[ ! -d "$BUILT" ]]; then
  echo "No built app at $BUILT — run without --skip-build first." >&2
  exit 1
fi

echo "--- Quitting running nchat (if any) ---"
osascript -e 'quit app "nchat"' 2>/dev/null || pkill -x nchat 2>/dev/null || true
sleep 1

echo "--- Installing to /Applications ---"
rm -rf "/Applications/$APP_NAME"
cp -R "$BUILT" "/Applications/$APP_NAME"

echo "--- Relaunching ---"
open "/Applications/$APP_NAME"

VER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  "/Applications/$APP_NAME/Contents/Info.plist" 2>/dev/null || echo "?")
echo "Installed + relaunched: /Applications/$APP_NAME (v$VER)"
echo
echo "Note: the app is unsigned, so each rebuild gets a fresh ad-hoc signature."
echo "The Keychain trusts the binary that created an entry, so a rebuilt nchat"
echo "is a different caller and macOS will ask you to authorise access to your"
echo "identities' keys. That is expected in development; 'Always Allow' holds"
echo "until the next rebuild."
