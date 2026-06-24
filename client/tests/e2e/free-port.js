/**
 * Guarantee a clean WeChat DevTools state before an mp-weixin E2E run.
 *
 * WHY THIS EXISTS
 * ---------------
 * jest.e2e.config.js launches DevTools with `launch: true` and tears the run
 * down with `teardown: 'disconnect'` — it intentionally leaves the IDE open
 * after the suite finishes (handy for inspecting state). The side effect is that
 * the launched instance keeps LISTENING on the automation port (9420). A crashed
 * or Ctrl-C'd run leaves the same leftover.
 *
 * On the NEXT run, `launch: true` spawns a SECOND DevTools instance that cannot
 * bind 9420, so the automator connects to the wrong/half-initialised instance
 * and jest hangs forever at `RUNS` (no timeout fires — the stall happens during
 * environment setup, before testTimeout applies).
 *
 * Killing ONLY the process listening on 9420 is NOT enough: DevTools is a group
 * of processes (renderer + helpers) that share a lock in the user-data-dir, so a
 * surviving sibling still blocks a clean relaunch. The reliable fix is to close
 * the WHOLE app gracefully via the DevTools CLI (`cli quit`), then SIGKILL any
 * straggler still holding the port. This script is wired in as `pretest:e2e:mp`
 * so `npm run test:e2e:mp` always runs it first.
 *
 * SAFETY: `cli quit` closes any open DevTools; the port-kill fallback only
 * targets a process actively LISTENING on 9420 (an automation leftover — a
 * normally opened IDE does not listen there). Keep the port in sync with
 * `mp-weixin.port` in jest.e2e.config.js.
 *
 * Override the port with the first CLI arg (defaults to 9420). Override the CLI
 * path with WX_CLI_PATH (same env var jest.e2e.config.js honours).
 */
const { execSync } = require('child_process')

const port = Number(process.argv[2]) || 9420
const WX_CLI =
  process.env.WX_CLI_PATH ||
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

function sleep(ms) {
  // Dependency-free blocking wait (this script runs to completion before jest).
  const until = Date.now() + ms
  while (Date.now() < until) { /* spin */ }
}

function listeningPids(p) {
  try {
    // -t: terse (PID only), -sTCP:LISTEN: only the listener, not clients.
    const out = execSync(`lsof -nP -iTCP:${p} -sTCP:LISTEN -t`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    if (!out) return []
    return [...new Set(out.split(/\s+/).map(Number).filter(Boolean))]
  } catch {
    // lsof exits non-zero when nothing matches — that means the port is free.
    return []
  }
}

if (listeningPids(port).length === 0) {
  console.log(`[free-port] port ${port} already free \u2705`)
  process.exit(0)
}

// 1) Graceful: ask DevTools to quit the whole app (closes all its processes and
//    releases the user-data-dir lock so the next launch starts clean).
console.log(`[free-port] port ${port} busy — asking DevTools to quit…`)
try {
  execSync(`"${WX_CLI}" quit`, { stdio: 'ignore', timeout: 20000 })
} catch (e) {
  console.log(`[free-port] cli quit failed/timed out (${e.code || e.message}) — falling back to kill`)
}
sleep(2000)

// 2) Fallback: SIGKILL any straggler still LISTENING on the port.
let remaining = listeningPids(port)
if (remaining.length) {
  console.log(`[free-port] still held by ${remaining.join(', ')} — SIGKILL`)
  for (const pid of remaining) {
    try {
      process.kill(pid, 'SIGKILL')
      console.log(`[free-port] killed ${pid}`)
    } catch (e) {
      console.log(`[free-port] could not kill ${pid}: ${e.message}`)
    }
  }
  sleep(2000)
}

remaining = listeningPids(port)
if (remaining.length === 0) {
  console.log(`[free-port] port ${port} freed \u2705`)
} else {
  console.log(`[free-port] WARNING: port ${port} still held by ${remaining.join(', ')}`)
}
