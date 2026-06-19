#!/usr/bin/env bash
#
# dev-local.sh — one-command local dev for Binwak (mp-weixin)
#
# What it does:
#   1. Loads WX_APPID / WX_SECRET from .env.local (gitignored).
#   2. Ensures server/.env exists and injects the WeChat credentials.
#   3. Temporarily injects your AppID into client/src/manifest.json so the
#      generated WeChat project is associated with it (restored on exit).
#   4. Starts the backend (tsx watch, :3000).
#   5. Starts the client watch build (uni -p mp-weixin -> dist/dev/mp-weixin).
#   6. Opens WeChat DevTools on the built project for live debugging.
#
# Usage:
#   cp .env.local.example .env.local   # then fill in WX_APPID / WX_SECRET
#   ./scripts/dev-local.sh             # add --install on first run to npm install
#
# Press Ctrl-C to stop everything; manifest.json is restored automatically.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── helpers ──────────────────────────────────────────────────────────────────
log()  { printf '\033[1;36m[dev]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[dev]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[dev]\033[0m %s\n' "$*" >&2; }

# ── load .env.local ──────────────────────────────────────────────────────────
if [[ ! -f .env.local ]]; then
  err "Missing .env.local. Run: cp .env.local.example .env.local  then fill it in."
  exit 1
fi
set -a; source .env.local; set +a

if [[ -z "${WX_APPID:-}" ]]; then
  err "WX_APPID is empty in .env.local"
  exit 1
fi
if [[ -z "${WX_SECRET:-}" ]]; then
  warn "WX_SECRET is empty — login (code2session) will fail. Login-gated pages won't work."
fi

DEVTOOLS_CLI="${WX_DEVTOOLS_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"
DEV_OUT="$ROOT/client/dist/dev/mp-weixin"
MANIFEST="$ROOT/client/src/manifest.json"

# ── optional: install deps ───────────────────────────────────────────────────
if [[ "${1:-}" == "--install" ]]; then
  log "Installing dependencies (client + server)…"
  (cd client && npm install)
  (cd server && npm install)
fi

# ── server/.env: create + inject WeChat creds ────────────────────────────────
if [[ ! -f server/.env ]]; then
  log "Creating server/.env from server/.env.example"
  cp server/.env.example server/.env
fi
upsert_env() { # file key value
  local file="$1" key="$2" val="$3"
  if grep -qE "^${key}=" "$file"; then
    # portable in-place edit (BSD/GNU sed)
    sed -i.bak -E "s|^${key}=.*|${key}=${val}|" "$file" && rm -f "${file}.bak"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$file"
  fi
}
upsert_env server/.env WX_APPID "$WX_APPID"
[[ -n "${WX_SECRET:-}" ]] && upsert_env server/.env WX_SECRET "$WX_SECRET"
log "server/.env updated with WX_APPID${WX_SECRET:+ + WX_SECRET}"

# ── inject AppID into manifest (restored on exit) ────────────────────────────
# manifest.json is JSONC (has comments), so we do a targeted text replace of the
# mp-weixin appid placeholder, mirroring the CI step. The original is restored
# on exit via the trap below.
MANIFEST_BACKUP="$(mktemp)"
cp "$MANIFEST" "$MANIFEST_BACKUP"
if grep -q "YOUR_WX_APPID" "$MANIFEST"; then
  sed -i.bak "s/YOUR_WX_APPID/${WX_APPID}/g" "$MANIFEST" && rm -f "${MANIFEST}.bak"
  log "manifest mp-weixin.appid = ${WX_APPID}"
else
  warn "Placeholder YOUR_WX_APPID not found in manifest; leaving appid as-is."
fi

# ── cleanup on exit ──────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  log "Shutting down…"
  for pid in "${PIDS[@]:-}"; do
    [[ -n "${pid:-}" ]] && kill "$pid" 2>/dev/null || true
  done
  if [[ -f "$MANIFEST_BACKUP" ]]; then
    cp "$MANIFEST_BACKUP" "$MANIFEST"
    rm -f "$MANIFEST_BACKUP"
    log "Restored client/src/manifest.json"
  fi
}
trap cleanup EXIT INT TERM

# ── start backend ────────────────────────────────────────────────────────────
log "Starting backend (server: tsx watch on :3000)…"
(cd server && npm run dev) &
PIDS+=("$!")

# ── start client watch build ─────────────────────────────────────────────────
log "Starting client watch build (mp-weixin → dist/dev/mp-weixin)…"
(cd client && npm run dev:mp-weixin) &
PIDS+=("$!")

# ── wait for first build, then open DevTools ─────────────────────────────────
log "Waiting for first client build…"
for _ in $(seq 1 120); do
  [[ -f "$DEV_OUT/app.json" ]] && break
  sleep 1
done
if [[ ! -f "$DEV_OUT/app.json" ]]; then
  err "Client build did not produce $DEV_OUT in time. Check the logs above."
  exit 1
fi
log "Client build ready at $DEV_OUT"

if [[ -x "$DEVTOOLS_CLI" ]]; then
  log "Opening WeChat DevTools…"
  "$DEVTOOLS_CLI" open --project "$DEV_OUT" || \
    warn "DevTools 'open' failed. In DevTools enable: Settings → Security → Service Port (CLI/HTTP)."
else
  warn "WeChat DevTools CLI not found at: $DEVTOOLS_CLI"
  warn "Open DevTools manually and import: $DEV_OUT"
  warn "(Override path via WX_DEVTOOLS_CLI in .env.local.)"
fi

log "Backend: http://localhost:3000   |   Client watch: dist/dev/mp-weixin"
log "In DevTools: Details → Local settings → check 'Do not verify domains' for localhost."
log "Press Ctrl-C to stop."
wait
