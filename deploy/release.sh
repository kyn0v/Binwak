#!/usr/bin/env bash
#
# release.sh — atomic-ish deploy with automatic rollback, run ON THE SERVER.
#
# Strategy (minimal & safe): only the STATELESS build output is versioned —
# server `dist/`, admin `dist/`, and package.json/package-lock.json. The
# stateful data (SQLite db, uploads/, .env) lives outside dist/ and is NEVER
# touched here, so deploys and rollbacks can never lose user data or rotate
# the JWT secret.
#
# Flow:
#   1. Back up the currently-live dist + package files into releases/<ts>/.
#   2. Swap in the incoming build.
#   3. npm install (prod) + pm2 restart + health check.
#   4. If anything fails, restore the backup and restart (auto-rollback).
#   5. Prune old releases, keeping the most recent $KEEP.
#
# Inputs (env):
#   APP_PATH    : server dir that holds dist/ + package.json (= DEPLOY_SERVER_PATH)
#   HEALTH_URL  : URL to curl for readiness (default http://127.0.0.1:3000/api/health)
#   PM2_NAME    : pm2 process name (default binwak-api)
#   KEEP        : number of releases to retain (default 3)
#
# The CI step uploads the new build to $APP_PATH/.incoming/ before running this.

set -euo pipefail

APP_PATH="${APP_PATH:?APP_PATH is required}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
PM2_NAME="${PM2_NAME:-binwak-api}"
KEEP="${KEEP:-3}"

ADMIN_DIR="$(dirname "$APP_PATH")/admin/dist"
RELEASES="$(dirname "$APP_PATH")/releases"
INCOMING="$APP_PATH/.incoming"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="$RELEASES/$TS"

log() { printf '[release] %s\n' "$*"; }

health_check() {
  for _ in 1 2 3 4 5; do
    if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null; then
      curl -fsS --max-time 10 "$HEALTH_URL" || true
      return 0
    fi
    sleep 2
  done
  return 1
}

# ── 1. Back up current live build (skipped on very first deploy) ──────────────
mkdir -p "$BACKUP"
[ -d "$APP_PATH/dist" ]            && cp -a "$APP_PATH/dist"            "$BACKUP/dist"
[ -d "$ADMIN_DIR" ]               && cp -a "$ADMIN_DIR"               "$BACKUP/admin-dist"
[ -f "$APP_PATH/package.json" ]   && cp -a "$APP_PATH/package.json"   "$BACKUP/"
[ -f "$APP_PATH/package-lock.json" ] && cp -a "$APP_PATH/package-lock.json" "$BACKUP/"
log "Backed up current release to $BACKUP"

restore_backup() {
  log "Rolling back to $BACKUP"
  [ -d "$BACKUP/dist" ]        && rsync -ac --delete "$BACKUP/dist/"        "$APP_PATH/dist/"
  [ -d "$BACKUP/admin-dist" ]  && { mkdir -p "$ADMIN_DIR"; rsync -ac --delete "$BACKUP/admin-dist/" "$ADMIN_DIR/"; }
  [ -f "$BACKUP/package.json" ]      && cp -a "$BACKUP/package.json"      "$APP_PATH/"
  [ -f "$BACKUP/package-lock.json" ] && cp -a "$BACKUP/package-lock.json" "$APP_PATH/"
  ( cd "$APP_PATH" && npm install --omit=dev --no-audit --no-fund || true )
  pm2 restart "$PM2_NAME" --update-env || true
}

# ── 2. Swap in the incoming build ────────────────────────────────────────────
if [ ! -d "$INCOMING/dist" ]; then
  log "ERROR: incoming build not found at $INCOMING/dist"
  exit 1
fi
rsync -ac --delete "$INCOMING/dist/" "$APP_PATH/dist/"
mkdir -p "$ADMIN_DIR"
[ -d "$INCOMING/admin-dist" ] && rsync -ac --delete "$INCOMING/admin-dist/" "$ADMIN_DIR/"
[ -f "$INCOMING/package.json" ]      && cp -a "$INCOMING/package.json"      "$APP_PATH/"
[ -f "$INCOMING/package-lock.json" ] && cp -a "$INCOMING/package-lock.json" "$APP_PATH/"
log "Swapped in incoming build"

# ── 3. Install + restart + health check; rollback on failure ─────────────────
deploy_ok=1
(
  cd "$APP_PATH"
  npm install --omit=dev --no-audit --no-fund
  pm2 restart "$PM2_NAME" --update-env
) && health_check || deploy_ok=0

if [ "$deploy_ok" -ne 1 ]; then
  log "Deploy failed health check — initiating auto-rollback"
  pm2 logs "$PM2_NAME" --lines 80 --nostream || true
  if [ -d "$BACKUP/dist" ]; then
    restore_backup
    if health_check; then
      log "Rollback succeeded — service healthy on previous release"
    else
      log "Rollback completed but health check still failing"
    fi
  else
    log "No previous release to roll back to (first deploy?)"
  fi
  # Clean up incoming and signal failure to CI.
  rm -rf "$INCOMING"
  exit 1
fi

log "Deploy healthy"

# ── 4. Clean up ──────────────────────────────────────────────────────────────
rm -rf "$INCOMING"

# Prune old releases, keeping the most recent $KEEP.
if [ -d "$RELEASES" ]; then
  # shellcheck disable=SC2012
  ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    log "Pruning old release: $old"
    rm -rf "$old"
  done
fi

log "Done. Active release: $TS (kept last $KEEP)"
