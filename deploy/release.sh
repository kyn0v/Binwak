#!/usr/bin/env bash
# Run on the server after staging dist/ and both package files in .incoming/.
# Only build output and dependency manifests are restored. Database migrations
# and other application side effects are not undone by a code rollback.
# Exit 0 = healthy release, 1 = rejected bundle or healthy rollback,
# 2 = deployment failed and rollback failed or was unavailable.
set -euo pipefail

APP_PATH="${APP_PATH:?APP_PATH is required}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
PM2_NAME="${PM2_NAME:-binwak-api}"
KEEP="${KEEP:-3}"

log() { printf '[release] %s\n' "$*"; }

if [[ ! "$KEEP" =~ ^[1-9][0-9]*$ ]]; then
  log "ERROR: KEEP must be a positive integer"
  exit 1
fi

if [[ "$(node -p 'process.versions.node.split(".")[0]')" != 26 ]]; then
  log "ERROR: Node.js 26 is required, matching .nvmrc and CI; live files unchanged"
  exit 1
fi

RELEASES="$(dirname "$APP_PATH")/releases"
INCOMING="$APP_PATH/.incoming"
for item in dist package.json package-lock.json; do
  if [[ ! -e "$INCOMING/$item" ]]; then
    log "ERROR: incomplete incoming bundle, missing $item"
    exit 1
  fi
done
if [[ ! -d "$INCOMING/dist" || ! -f "$INCOMING/package.json" || ! -f "$INCOMING/package-lock.json" ]]; then
  log "ERROR: incoming bundle has invalid file types"
  exit 1
fi

mkdir -p "$RELEASES"
BACKUP="$(mktemp -d "$RELEASES/$(date +%Y%m%d-%H%M%S)-XXXXXX")"
for item in dist package.json package-lock.json; do
  if [[ -e "$APP_PATH/$item" ]]; then
    cp -a "$APP_PATH/$item" "$BACKUP/"
  fi
done
log "Backed up current release to $BACKUP"

health_check() {
  for _ in 1 2 3 4 5; do
    if curl -fsS --max-time 10 "$HEALTH_URL"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

copy_release() {
  local source="$1"
  rsync -ac --delete "$source/dist/" "$APP_PATH/dist/" || return 1
  cp -a "$source/package.json" "$APP_PATH/" || return 1
  cp -a "$source/package-lock.json" "$APP_PATH/" || return 1
}

start_release() {
  # Functions called from an if/&& context cannot rely on Bash errexit.
  (cd "$APP_PATH" && npm ci --omit=dev --no-audit --no-fund) || return 1
  pm2 restart "$PM2_NAME" --update-env --kill-timeout 35000 || return 1
  health_check
}

if copy_release "$INCOMING" && start_release; then
  log "DEPLOY_OK: release healthy"
else
  log "DEPLOY_FAILED: install, restart, copy, or health check failed"
  pm2 logs "$PM2_NAME" --lines 80 --nostream || true
  if [[ ! -d "$BACKUP/dist" || ! -f "$BACKUP/package.json" || ! -f "$BACKUP/package-lock.json" ]]; then
    log "ROLLBACK_UNAVAILABLE: no complete previous release; manual recovery required"
    exit 2
  fi
  log "Rolling back to $BACKUP"
  if copy_release "$BACKUP" && start_release; then
    log "ROLLBACK_OK: previous release healthy; deployment still failed"
    rm -rf "$INCOMING"
    exit 1
  fi
  log "ROLLBACK_FAILED: service state unknown; manual recovery required; backup retained at $BACKUP"
  exit 2
fi

rm -rf "$INCOMING"
# shellcheck disable=SC2012
ls -1dt "$RELEASES"/*/ | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
  log "Pruning old release: $old"
  rm -rf "$old"
done
log "Done. Active release: $(basename "$BACKUP") (kept last $KEEP)"
