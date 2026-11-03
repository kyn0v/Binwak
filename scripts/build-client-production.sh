#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$ROOT/scripts/validate-client-api.cjs"
cd "$ROOT/client"
npm run build:mp-weixin -- --mode production
