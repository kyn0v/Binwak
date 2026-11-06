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
#   5. Completes a local-target build into dist/dev/mp-weixin.
#   6. Opens WeChat DevTools, then starts the client watch build.
#
# Usage:
#   cp .env.local.example .env.local   # then fill in WX_APPID / WX_SECRET
#   ./scripts/dev-local.sh             # add --install on first run to npm ci
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

# Exported values take precedence over Vite and dotenv files.
export VITE_API_BASE_URL="http://127.0.0.1:3000"
export PORT=3000
log "Local API target forced to $VITE_API_BASE_URL"

if [[ -z "${WX_APPID:-}" ]]; then
  err "WX_APPID is empty in .env.local"
  exit 1
fi
if [[ -z "${WX_SECRET:-}" ]]; then
  warn "WX_SECRET is empty — login (code2session) will fail. Login-gated pages won't work."
fi

if ! command -v lsof >/dev/null 2>&1; then
  err "lsof is required to verify local port 3000 is unused."
  exit 1
fi
if listeners="$(lsof -t -iTCP:3000 -sTCP:LISTEN 2>&1)"; then
  err "Port 3000 is already in use (PIDs: $listeners). Stop that service or tunnel first."
  exit 1
else
  status=$?
  if [[ "$status" -ne 1 || -n "$listeners" ]]; then
    err "Cannot verify local port 3000: $listeners"
    exit 1
  fi
fi

DEVTOOLS_CLI="${WX_DEVTOOLS_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"
DEV_OUT="$ROOT/client/dist/dev/mp-weixin"
export UNI_OUTPUT_DIR="$DEV_OUT"
MANIFEST="$ROOT/client/src/manifest.json"

# ── optional: install deps ───────────────────────────────────────────────────
if [[ "${1:-}" == "--install" ]]; then
  log "Installing dependencies (client + server)…"
  (cd client && npm ci)
  (cd server && npm ci)
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

backend_ready=0
for _ in $(seq 1 30); do
  if curl --noproxy '*' -fsS --max-time 2 "$VITE_API_BASE_URL/api/health" >/dev/null; then
    backend_ready=1
    break
  fi
  sleep 1
done
if [[ "$backend_ready" -ne 1 ]]; then
  err "Local backend health check failed. Client build was not started."
  exit 1
fi

# app.json can precede JavaScript emission or survive a failed watch build.
# A finite build must succeed before DevTools can import this directory.
log "Building local client before opening DevTools…"
(cd client && npm run build:mp-weixin -- --mode development)
if [[ ! -f "$DEV_OUT/app.json" ]]; then
  err "Completed client build did not produce $DEV_OUT/app.json."
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

# Start the watcher after import so its initial writes cannot race DevTools open.
log "Starting client watch build (mp-weixin → dist/dev/mp-weixin)…"
(cd client && npm run dev:mp-weixin) &
PIDS+=("$!")

log "Backend: http://localhost:3000   |   Client watch: dist/dev/mp-weixin"
log "In DevTools: Details → Local settings → check 'Do not verify domains' for localhost."
log "Press Ctrl-C to stop."
wait
