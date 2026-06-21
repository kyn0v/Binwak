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

  This script will reset the server database. After it finishes, recompile
  in DevTools to see the truly clean first-launch state.

EOF

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Have you cleared the client cache in DevTools? [y/N] " ans
  case "$ans" in
    [yY]|[yY][eE][sS]) ;;
    *) err "Aborted. Clear the client cache first, then re-run."; exit 1 ;;
  esac
fi

# ── Step ②: reset the server database ────────────────────────────────────────
# Deleting the file is cleaner than emptying tables: the backend recreates an
# empty schema + applies migrations on next startup. Also remove the WAL/SHM
# sidecar files so no committed-but-unmerged rows survive.
if [[ -f "$DB" ]]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  BACKUP="$DB.backup-$TS"
  cp "$DB" "$BACKUP"
  log "Backed up current DB → $(basename "$BACKUP")"
  rm -f "$DB" "$DB-wal" "$DB-shm"
  log "Removed server/data/bingo.db (+ WAL/SHM)."
else
  warn "No server/data/bingo.db found — nothing to remove (already clean)."
fi

cat <<'EOF'

  Server database reset.

  Next:
    • If the backend (dev:local) is running, tsx watch will recreate an empty
      DB automatically — no restart needed.
    • In WeChat DevTools, recompile (Cmd/Ctrl + B).

  You should now see the clean first-launch state (empty ticks; the 25 default
  words come from the client's built-in DEFAULT_WORDS — that is expected).

EOF
log "Done."
