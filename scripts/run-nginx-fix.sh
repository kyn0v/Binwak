#!/usr/bin/env bash
set -euo pipefail
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
case "${PACKET_ACTION:-}" in inspect|apply|verify|rollback) ;; *) fail ACTION_NOT_ALLOWED ;; esac
[[ "${REVIEWED_PACKET_SHA:-}" =~ ^[a-f0-9]{64}$ ]] || fail PACKET_HASH_INVALID
[[ "${DEPLOY_HOST:-}" =~ ^[a-zA-Z0-9][a-zA-Z0-9.:-]*$ ]] || fail SSH_HOST_INVALID
[[ "${DEPLOY_USER:-}" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]] || fail SSH_USER_INVALID
PORT="${DEPLOY_PORT:-22}"
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] || fail SSH_PORT_INVALID
(( 10#$PORT >= 1 && 10#$PORT <= 65535 )) || fail SSH_PORT_INVALID
[[ "${DEPLOY_SERVER_PATH:-}" =~ ^/[a-zA-Z0-9_./-]+$ && "$DEPLOY_SERVER_PATH" != / && "/$DEPLOY_SERVER_PATH/" != */../* && "/$DEPLOY_SERVER_PATH/" != */./* ]] || fail SSH_DIRECTORY_INVALID
if [[ "$PACKET_ACTION" != inspect ]]; then
  [[ "${TARGET_PATH:-}" =~ ^/etc/nginx/[a-zA-Z0-9_./-]+$ && "/$TARGET_PATH/" != */../* && "/$TARGET_PATH/" != */./* ]] || fail TARGET_PATH_INVALID
  for value in "${FILE_SHA:-}" "${FULL_SHA:-}" "${PATCHED_FILE_SHA:-}" "${PATCHED_FULL_SHA:-}" "${RUNTIME_SHA:-}"; do
    [[ "$value" =~ ^[a-f0-9]{64}$ ]] || fail CONFIG_BINDING_INVALID
  done
fi
SOURCE="${PACKET_SOURCE:-scripts/nginx-fix.cjs}"
TEMP=$(mktemp -d)
trap 'rm -rf -- "$TEMP"' EXIT
cp -- "$SOURCE" "$TEMP/packet.cjs"
ACTUAL=$(sha256sum "$TEMP/packet.cjs")
[[ "${ACTUAL%% *}" == "$REVIEWED_PACKET_SHA" ]] || fail TRANSMITTED_PACKET_HASH_MISMATCH
remote() {
  local action="$1" command
  if [[ "$action" == inspect ]]; then
    command="cd '$DEPLOY_SERVER_PATH' && exec ./.runtime/node/bin/node - 'inspect'"
  else
    command="cd '$DEPLOY_SERVER_PATH' && exec ./.runtime/node/bin/node - '$action' '$TARGET_PATH' '$FILE_SHA' '$FULL_SHA' '$PATCHED_FILE_SHA' '$PATCHED_FULL_SHA' '$RUNTIME_SHA' 'approved-minimal-admin-deny'"
  fi
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -p "$PORT" "${DEPLOY_USER}@${DEPLOY_HOST}" "$command" < "$TEMP/packet.cjs" > "$TEMP/result.json" 2> "$TEMP/remote.stderr"
}
report() {
  EXPECTED_ACTION="$1" EXPECTED_RESULT="$2" python3 - "$TEMP/result.json" <<'PY'
import json, os, sys
try:
    with open(sys.argv[1]) as stream:
        result = json.load(stream)
    assert result['action'] == os.environ['EXPECTED_ACTION']
    assert result['result'] == os.environ['EXPECTED_RESULT']
    assert isinstance(result['mutated'], bool)
    print(json.dumps(result, indent=2))
except Exception:
    print('REMOTE_RESULT_INVALID_OR_FAILED', file=sys.stderr)
    sys.exit(1)
PY
}
if ! remote "$PACKET_ACTION"; then
  report "$PACKET_ACTION" failed || true
  fail REMOTE_FAILED_OR_DISCONNECTED_RETAIN_BACKUP_CHECK_RUNTIME
fi
case "$PACKET_ACTION" in
  inspect) report inspect inspected; exit 0 ;;
  apply)
    if ! report apply applied; then report apply verified; fi
    ;;
  verify) report verify verified ;;
  rollback) report rollback rolled-back ;;
esac
public_checks() {
  local expected="$1" pathname status
  local paths=(/api/health /api/admin)
  if [[ "$expected" == 403 ]]; then paths+=(/api/ADMIN /API/AdMiN /api/admin/ /api/admin/login /api/ADMIN/login /API/AdMiN/users '/api/admin?packet=1'); fi
  for pathname in "${paths[@]}"; do
    status=$(curl --silent --head --output /dev/null --write-out '%{http_code}' --max-time 7 --connect-timeout 3 --noproxy '*' --proto '=https' "https://api.citywalkbingo.com$pathname" 2>/dev/null) || status=000
    printf 'runner-public HEAD %s status=%s\n' "$pathname" "$status"
    if [[ "$pathname" == /api/health ]]; then [[ "$status" == 200 ]] || return 1
    else [[ "$status" == "$expected" ]] || return 1; fi
  done
  return 0
}
if [[ "$PACKET_ACTION" == rollback ]]; then public_checks 401 || fail ROLLBACK_EXTERNAL_VERIFICATION_FAILED
elif ! public_checks 403; then
  printf '%s\n' EXTERNAL_VERIFICATION_FAILED_ATTEMPTING_BOUND_ROLLBACK >&2
  remote rollback || fail EXTERNAL_CHECK_ROLLBACK_FAILED_OPERATOR_REQUIRED
  report rollback rolled-back || fail EXTERNAL_CHECK_ROLLBACK_RESULT_FAILED
  public_checks 401 || fail EXTERNAL_CHECK_RECOVERY_FAILED
  fail EXTERNAL_CHECK_FAILED_ORIGINAL_RESTORED
fi
