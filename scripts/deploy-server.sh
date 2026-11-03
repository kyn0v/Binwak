#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST not set (e.g. user@your-server or ssh-config alias)}"
: "${DEPLOY_REMOTE_DIR:?DEPLOY_REMOTE_DIR not set (e.g. /opt/myapp/server)}"
REMOTE="$DEPLOY_HOST"
REMOTE_DIR="$DEPLOY_REMOTE_DIR"
if [[ ! "$REMOTE_DIR" =~ ^/[a-zA-Z0-9_./-]+$ || "$REMOTE_DIR" == / ]]; then
  echo "DEPLOY_REMOTE_DIR must be an absolute application path without shell metacharacters" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
(cd server && npm run build)
INCOMING="$REMOTE_DIR/.incoming"
ssh "$REMOTE" "mkdir -p '$INCOMING/dist'"
rsync -az --delete -e ssh server/dist/ "$REMOTE:$INCOMING/dist/"
scp server/package.json server/package-lock.json "$REMOTE:$INCOMING/"
scp deploy/release.sh "$REMOTE:$REMOTE_DIR/release.sh"
ssh "$REMOTE" "APP_PATH='$REMOTE_DIR' bash '$REMOTE_DIR/release.sh'"
