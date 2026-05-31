#!/usr/bin/env bash
# Quick manual deploy: build locally, sync dist + deps to remote server, restart
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST not set (e.g. user@your-server or ssh-config alias)}"
: "${DEPLOY_REMOTE_DIR:?DEPLOY_REMOTE_DIR not set (e.g. /opt/myapp/server)}"

REMOTE="${DEPLOY_HOST}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR}"

echo "🔨 Building TypeScript locally..."
cd "$(dirname "$0")/.."
(cd server && npm run build)

echo "📦 Syncing build artifacts..."
rsync -az --delete -e ssh server/dist/ "${REMOTE}:${REMOTE_DIR}/dist/"

echo "📋 Syncing package files..."
scp server/package.json server/package-lock.json "${REMOTE}:${REMOTE_DIR}/"

echo "🔧 Installing deps + restarting on remote..."
ssh "${REMOTE}" "cd ${REMOTE_DIR} && \
  npm install --omit=dev --no-audit --no-fund && \
  pm2 restart binwak-api --update-env"

echo "✅ Deploy complete!"
ssh "${REMOTE}" "pm2 logs binwak-api --nostream --lines 3 2>&1 | tail -3"
