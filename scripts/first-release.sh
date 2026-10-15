#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# First release of sessionpipe-gui and its themes, end to end, from this machine.
# Needs: the themes repo checked out beside this one, an npm account that owns the
# `sessionpipe-gui` org (https://www.npmjs.com/org/create, free) and a GitHub push credential.
# Re-runnable: every step skips what is already done.
set -euo pipefail
GUI="$(cd "$(dirname "$0")/.." && pwd)"
THEMES="${THEMES:-$GUI/../sessionpipe-gui-themes}"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1/6 push both repos"
git -C "$GUI" push -u origin main
git -C "$THEMES" push -u origin main

say "2/6 npm login (opens the browser once)"
npm whoami >/dev/null 2>&1 || npm login

say "3/6 themes: install, build, test, publish in dependency order"
( cd "$THEMES" && npm ci && npm run build && npm test && node scripts/publish-all.mjs --yes )

say "4/6 gui: install, publish (prepublishOnly builds with Canvas and Office bundled)"
( cd "$GUI" && npm ci && npm publish --access public )

say "5/6 smoke test from the registry"
TMP="$(mktemp -d)"
npm install -g --prefix "$TMP" sessionpipe-gui >/dev/null
"$TMP/bin/sessionpipe-gui" --version
"$TMP/bin/sessionpipe-gui" --port 7499 --state "$TMP/state" --no-outbox --demo --quiet &
PID=$!; sleep 6
curl -s http://127.0.0.1:7499/api/ui/themes | grep -q '"id":"office"' && echo "bundled views: ok"
"$TMP/bin/sessionpipe-gui" --state "$TMP/state" extras add all && echo "extras: ok"
kill $PID; rm -rf "$TMP"

say "6/6 tag the release so the workflows take over from here"
V="$(node -p "require('$GUI/package.json').version")"
git -C "$GUI" tag -a "v$V" -m "v$V" 2>/dev/null || true
git -C "$THEMES" tag -a "v$V" -m "v$V" 2>/dev/null || true
git -C "$GUI" push origin "v$V"; git -C "$THEMES" push origin "v$V"
say "done · npx sessionpipe-gui works for everyone now. Next: per package, npmjs.com → Settings → Trusted Publisher (RELEASING.md §Automation)."
