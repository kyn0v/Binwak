#!/usr/bin/env bash
#
# reset-local.sh — reset local dev state to a clean "first launch".
#
# This app is local-first, so state lives in TWO independent places:
#   1. Server database  — server/data/bingo.db  (persistent file on disk)
#   2. Client cache     — WeChat Mini Program Storage (ticks, token, word bank)
#
# They re-seed each other: if you clear only one, the other pushes its data
# back on next launch. So a clean reset MUST do both, IN ORDER:
#
#   ① clear the CLIENT cache first (cut off the source that re-pushes data)
#   ② then reset the SERVER database
#
# This script automates step ② and guides you through step ①. The client
# cache can only be cleared from WeChat DevTools (no CLI for it).
#
# Usage:
#   npm run reset:local          # interactive: reminds you to clear client cache first
#   npm run reset:local -- --yes # skip the confirmation prompt (DB only)
#
# Press Ctrl-C any time to abort.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log()  { printf '\033[1;36m[reset]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[reset]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[reset]\033[0m %s\n' "$*" >&2; }

DB="$ROOT/server/data/bingo.db"
ASSUME_YES=0
[[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]] && ASSUME_YES=1

# ── Step ①: remind the user to clear the client cache FIRST ───────────────────
cat <<'EOF'

  This resets local dev state to a clean "first launch".

  IMPORTANT — do the CLIENT cache first, or the app will just re-push its
  cached board (ticks, etc.) back into the fresh database:

    In WeChat DevTools:  Tools → Clear cache → Clear all
    (check Data cache + File cache + Authorization), then DO NOT recompile yet.

  Stop the backend and its watcher before continuing.
  After the reset, restart the backend before recompiling in DevTools.

EOF

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Have you cleared the client cache in DevTools? [y/N] " ans
  case "$ans" in
    [yY]|[yY][eE][sS]) ;;
    *) err "Aborted. Clear the client cache first, then re-run."; exit 1 ;;
  esac
fi

if ! command -v lsof >/dev/null 2>&1; then
  err "lsof is required to verify the backend is stopped. Nothing was removed."
  exit 1
fi

require_unused() {
  local holders status
  if holders="$(lsof -t "$@" 2>&1)"; then
    err "Backend or database is in use (PIDs: $holders). Stop it and its watcher, then retry."
    exit 1
  else
    status=$?
    if [[ "$status" -ne 1 || -n "$holders" ]]; then
      err "Cannot verify stopped backend: $holders. Nothing was removed."
      exit 1
    fi
  fi
}

require_unused -iTCP:3000 -sTCP:LISTEN
require_unused -a -d cwd +d "$ROOT/server"
DB_FILES=()
for file in "$DB" "$DB-wal" "$DB-shm"; do
  [[ ! -e "$file" ]] || DB_FILES+=("$file")
done
if [[ "${#DB_FILES[@]}" -gt 0 ]]; then
  require_unused "${DB_FILES[@]}"
fi

if [[ -f "$DB" ]]; then
  BACKUP="$(mktemp "$DB.backup-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
  node "$ROOT/scripts/backup-local-db.cjs" "$DB" "$BACKUP"
  log "SQLite-consistent backup saved at $BACKUP"
  require_unused -iTCP:3000 -sTCP:LISTEN
  require_unused -a -d cwd +d "$ROOT/server"
  require_unused "$DB"
  rm -f "$DB" "$DB-wal" "$DB-shm"
  log "Removed server/data/bingo.db (+ WAL/SHM)."
else
  warn "No server/data/bingo.db found. Nothing was removed."
fi

cat <<'EOF'

  Server database reset.

  Next:
    • Restart the backend with npm run dev:local or npm run server:dev.
      A fresh process creates the empty schema and applies migrations.
    • Only then recompile in WeChat DevTools (Cmd/Ctrl + B).

  You should now see the clean first-launch state (empty ticks; the 25 default
  words come from the client's built-in DEFAULT_WORDS — that is expected).

EOF
log "Done."
