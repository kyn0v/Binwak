#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ "$#" != 1 || ! "$1" =~ ^(check|prepare|activate|rollback|verify)$ ]]; then
  printf '%s\n' '[runtime-upgrade] STOP INVALID_ACTION' >&2
  exit 2
fi
if [[ "$EUID" != 0 ]]; then
  printf '%s\n' '[runtime-upgrade] STOP ROOT_REQUIRED' >&2
  exit 2
fi
if [[ "${BINWAK_REVIEWED_PAYLOAD_SHA256:-}" != '314e95df0a412f24abc395a8907d63d7385ba6b7b9dae2c80e4a5f7e479b79f7' ]]; then
  printf '%s\n' '[runtime-upgrade] STOP EXACT_PAYLOAD_REVIEW_REQUIRED' >&2
  exit 2
fi
temporary=$(mktemp -d /tmp/binwak-runtime-payload.XXXXXXXXXX)
payload="$temporary/runtime-upgrade.cjs"
trap 'rm -f -- "$payload"; rmdir -- "$temporary"' EXIT
cat > "$payload" <<'BINWAK_RUNTIME_JAVASCRIPT'
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const http = require('node:http')
const { execFileSync } = require('node:child_process')

const VERSION = '26.8.2'
const ARCHIVE = `node-v${VERSION}-linux-x64.tar.xz`
const ARCHIVE_SHA256 = '40e1d3225c1c9ae9a2671c98ecb9857e4d5555026394f348645676798840d5c5'
const OLD_NODE = '/usr/bin/node'
const NAME = 'binwak-api'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function guard(condition, code) { if (!condition) throw new Error(code) }
function lstat(file) { try { return fs.lstatSync(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
function exists(file) { return Boolean(lstat(file)) }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function writeJson(file, value) {
  const temporary = `${file}.tmp`
  const fd = fs.openSync(temporary, 'w', 0o600)
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temporary, file)
  const directory = fs.openSync(path.dirname(file), 'r')
  try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
}
function plainDirectory(file) {
  guard(lstat(file)?.isDirectory() && fs.realpathSync(file) === file, 'UNEXPECTED_OR_SYMLINKED_DIRECTORY')
}
function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env },
      timeout: options.timeout || 30000, maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim()
  } catch { throw new Error(options.error || 'SUBPROCESS_FAILED') }
}
function backupHashes(directory, prefix = '') {
  const hashes = {}
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name), file = path.join(directory, entry.name)
    if (entry.isDirectory()) Object.assign(hashes, backupHashes(file, relative))
    else { guard(entry.isFile(), 'UNREVIEWED_BACKUP_ENTRY'); hashes[relative] = hash(file) }
  }
  return hashes
}
function sameDirectory(file, identity) {
  const stat = fs.statSync(file)
  guard(identity && stat.dev === identity.dev && stat.ino === identity.ino, 'DEPENDENCY_IDENTITY_CHANGED')
}
function exchangeModules(app, state) {
  const live = path.join(app, 'node_modules'), old = path.join(state.root, 'node_modules.node20')
  guard(!exists(old), 'OLD_DEPENDENCIES_ALREADY_EXIST')
  plainDirectory(live); sameDirectory(live, state.originalModules)
  plainDirectory(path.join(state.stage, 'node_modules'))
  fs.renameSync(live, old)
  fs.renameSync(path.join(state.stage, 'node_modules'), live)
}
function restoreModules(app, state) {
  const live = path.join(app, 'node_modules'), old = path.join(state.root, 'node_modules.node20')
  const rejected = path.join(state.attempt, 'node_modules.node26-rejected')
  if (!exists(old)) { plainDirectory(live); sameDirectory(live, state.originalModules); return }
  sameDirectory(old, state.originalModules)
  if (exists(live)) {
    guard(!exists(rejected), 'REJECTED_DEPENDENCIES_ALREADY_EXIST')
    plainDirectory(live); fs.renameSync(live, rejected)
  }
  fs.renameSync(old, live)
}
async function rollbackTransaction(state, ops) {
  const recovery = ops.recovery
  if (state?.phase === 'rolled-back') {
    await recovery.verifyOld(); await recovery.saveOld(); ops.write('rolled-back')
    return state.persistenceIssue ? 'rolled-back-persistence-issue' : 'rolled-back'
  }
  guard(['switching', 'active', 'rolling-back'].includes(state?.phase), 'NOTHING_TO_ROLL_BACK')
  await recovery.beforeRollback()
  ops.write('rolling-back')
  await recovery.stop()
  recovery.restoreModules()
  await recovery.restartOld()
  await recovery.verifyOld()
  await recovery.saveOld()
  ops.write('rolled-back')
  return state.persistenceIssue ? 'rolled-back-persistence-issue' : 'rolled-back'
}
async function activateTransaction(state, ops) {
  if (state?.phase === 'active') { await ops.verifyNew(); await ops.verifySavedNew(); return 'already-active' }
  if (['switching', 'rolling-back'].includes(state?.phase)) {
    const result = await rollbackTransaction(state, ops)
    return result === 'rolled-back' ? 'interrupted-switch-recovered' : 'interrupted-switch-recovered-persistence-issue'
  }
  guard(state?.phase === 'prepared', 'NOT_PREPARED')
  await ops.beforeSwitch()
  ops.write('switching')
  try {
    await ops.ensureTimeout()
    await ops.stop()
    ops.exchangeModules()
    await ops.restartNew()
    await ops.verifyNew()
    await ops.saveNew()
    ops.write('active')
    return 'active'
  } catch {
    const result = await rollbackTransaction(state, ops)
    return result === 'rolled-back' ? 'activation-failed-rolled-back' : 'activation-failed-rolled-back-persistence-issue'
  }
}

const NATIVE_SMOKE = `
const {createRequire}=require('node:module'); const path=require('node:path');
const r=createRequire(path.join(process.argv[1],'package.json'));
(async()=>{ const D=r('better-sqlite3'); const db=new D(':memory:');
if(db.prepare('select 42 as value').get().value!==42) throw Error(); db.close();
const b=r('bcrypt'); const h=b.hashSync('binwak-runtime-fixture',4); if(!b.compareSync('binwak-runtime-fixture',h)) throw Error();
const bytes=await r('sharp')({create:{width:1,height:1,channels:3,background:'#ffffff'}}).png().toBuffer();
if(!bytes.length) throw Error(); console.log('native-ok')
})().catch(()=>process.exitCode=1)
`
const SQLITE_CHECK = `
const {createRequire}=require('node:module');const path=require('node:path');
const D=createRequire(path.join(process.argv[1],'package.json'))('better-sqlite3');
const db=new D(process.argv[2],{readonly:true,fileMustExist:true});
try{if(db.pragma('integrity_check',{simple:true})!=='ok')throw Error();console.log('integrity-ok')}finally{db.close()}
`
const SQLITE_BACKUP = `
const {createRequire}=require('node:module');const path=require('node:path');
const D=createRequire(path.join(process.argv[1],'package.json'))('better-sqlite3');
(async()=>{const db=new D(process.argv[2],{readonly:true,fileMustExist:true});
try{db.pragma('busy_timeout=10000');if(db.pragma('quick_check',{simple:true})!=='ok')throw Error();await db.backup(process.argv[3])}finally{db.close()}
const copy=new D(process.argv[3],{readonly:true,fileMustExist:true});
try{if(copy.pragma('integrity_check',{simple:true})!=='ok')throw Error();console.log('backup-ok')}finally{copy.close()}
})().catch(()=>process.exitCode=1)
`
// Direct RPC cannot auto-start or replace the shared daemon when its socket disappears.
const PM2_RPC = `
const {createRequire}=require('node:module');const r=createRequire(process.argv[1]);
const sock=r('pm2-axon').socket('req');const client=new (r('pm2-axon-rpc').Client)(sock);
const timer=setTimeout(()=>{sock.close();process.exitCode=1},55000);
sock.on('error',()=>{clearTimeout(timer);sock.close();process.exitCode=1});
sock.connect(process.argv[2]);
client.call(process.argv[3],JSON.parse(process.argv[4]),(error,result)=>{
clearTimeout(timer);sock.close();if(error)process.exitCode=1;else console.log(JSON.stringify(result));
});
`
function pm2Rpc(node, pm2File, socket, method, argument) {
  guard(['getMonitorData', 'getVersion', 'restartProcessId', 'stopProcessId'].includes(method), 'UNSAFE_PM2_METHOD')
  return JSON.parse(run(node, ['-e', PM2_RPC, pm2File, socket, method, JSON.stringify(argument)], { timeout: 60000, error: 'PM2_RPC_FAILED' }))
}
function peerSnapshot(list) {
  return list.filter(entry => entry.name !== NAME).map(entry => {
    const env = { ...entry.pm2_env }
    for (const key of Object.keys(env)) if (key.startsWith('axm_')) delete env[key]
    return { name: entry.name, pid: entry.pid, id: entry.pm_id, env }
  }).sort((a, b) => a.id - b.id)
}
function configurationHash(env) {
  const fields = ['env', 'args', 'node_args', 'exec_interpreter', 'pm_exec_path', 'pm_cwd', 'exec_mode', 'uid', 'gid', 'kill_timeout', 'autorestart', 'watch', 'ignore_watch', 'cron_restart', 'max_memory_restart', 'restart_delay', 'min_uptime', 'max_restarts', 'instances', 'pm_out_log_path', 'pm_err_log_path', 'pm_log_path', 'merge_logs', 'log_date_format', 'namespace']
  const snapshot = { ...env, instances: Number(env.instances || 1) }
  return crypto.createHash('sha256').update(stableJson(Object.fromEntries(fields.filter(key => snapshot[key] !== undefined).map(key => [key, snapshot[key]])))).digest('hex')
}
async function ensureStopTimeout(entry, restart, verifyOld) {
  if (Number(entry.pm2_env.kill_timeout) >= 35000) return
  await restart({ kill_timeout: 35000 })
  await verifyOld()
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function updateSavedTarget(dump, expectedHash, fields) {
  guard(lstat(dump)?.isFile() && hash(dump) === expectedHash, 'SAVED_DUMP_CHANGED')
  const rows = loadJson(dump), entries = rows.filter(entry => entry.name === NAME)
  guard(entries.length === 1, 'AMBIGUOUS_SAVED_PROCESS')
  for (const [key, value] of Object.entries(fields)) {
    guard(['exec_interpreter', 'kill_timeout'].includes(key), 'UNSAFE_SAVED_FIELD')
    if (value === null || value === undefined) delete entries[0][key]
    else entries[0][key] = value
  }
  writeJson(dump, rows)
}
function fingerprint(app, dbPath) {
  const output = Object.fromEntries(['package.json', 'package-lock.json', '.env'].map(name => [name, hash(path.join(app, name))]))
  output.build = run('/usr/bin/find', [path.join(app, 'dist'), '-type', 'f', '-exec', 'sha256sum', '{}', '+']).split('\n').sort()
  output.dbPath = dbPath
  return output
}
function health(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/api/health', timeout: 5000 }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk; if (body.length > 4096) request.destroy(new Error('HEALTH_TOO_LARGE')) })
      response.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          guard(response.statusCode === 200 && parsed.success === true && parsed.data?.status === 'ok', 'HEALTH_REJECTED')
          resolve()
        } catch { reject(new Error('HEALTH_REJECTED')) }
      })
    })
    request.on('timeout', () => request.destroy(new Error('HEALTH_TIMEOUT')))
    request.on('error', () => reject(new Error('HEALTH_FAILED')))
  })
}

function makeDriver(app, root) {
  const install = path.join(app, '.runtime/node'), newNode = path.join(install, 'bin/node')
  const stateFile = path.join(root, 'state.json')
  let state = exists(stateFile) ? loadJson(stateFile) : null
  if (state) {
    guard(state.app === app && state.root === root, 'JOURNAL_PATH_MISMATCH')
    guard(path.dirname(state.attempt) === root && path.basename(state.attempt).startsWith('attempt-'), 'JOURNAL_ATTEMPT_MISMATCH')
    if (state.stage) guard(state.stage === path.join(state.attempt, 'dependencies'), 'JOURNAL_STAGE_MISMATCH')
    if (state.backupDb) guard(state.backupDb === path.join(state.attempt, 'backup/bingo.db'), 'JOURNAL_BACKUP_MISMATCH')
  }
  const oldModules = path.join(root, 'node_modules.node20')
  const environment = require(path.join(exists(oldModules) ? oldModules : path.join(app, 'node_modules'), 'dotenv')).parse(fs.readFileSync(path.join(app, '.env')))
  const port = Number(environment.PORT || '3000'), dbPath = path.resolve(app, environment.DB_PATH || 'data/bingo.db')
  guard(Number.isInteger(port) && port > 0 && port < 65536, 'INVALID_PORT')
  guard(environment.DB_PATH !== ':memory:' && dbPath === path.join(app, 'data/bingo.db'), 'UNREVIEWED_DATABASE_LOCATION')
  const pm2File = fs.realpathSync(run('/usr/bin/which', ['pm2']))
  guard(loadJson(path.resolve(path.dirname(pm2File), '..', 'package.json')).version === '6.0.14', 'PM2_VERSION_CHANGED')
  const pm2Home = process.env.PM2_HOME || path.join(process.env.HOME, '.pm2'), dump = path.join(pm2Home, 'dump.pm2')
  plainDirectory(pm2Home)
  guard(fs.statSync(pm2Home).uid === 0 && (fs.statSync(pm2Home).mode & 0o022) === 0, 'UNSAFE_PM2_HOME')
  const pidFile = path.join(pm2Home, 'pm2.pid'), socket = path.join(pm2Home, 'rpc.sock')
  const daemonPid = fs.readFileSync(pidFile, 'utf8').trim()
  guard(/^\d+$/.test(daemonPid), 'INVALID_DAEMON_PID')
  const daemonIdentity = fs.readFileSync(`/proc/${daemonPid}/stat`, 'utf8').split(') ')[1].split(' ')[19]
  const daemonExecutable = fs.readlinkSync(`/proc/${daemonPid}/exe`)
  guard(daemonExecutable.replace(/ \(deleted\)$/, '') === OLD_NODE, 'UNREVIEWED_DAEMON_EXECUTABLE')
  function assertHost() {
    if (state?.daemonPid) guard(state.daemonPid === daemonPid && state.daemonIdentity === daemonIdentity && state.daemonExecutable === daemonExecutable, 'PM2_DAEMON_CHANGED')
    guard(fs.readFileSync(pidFile, 'utf8').trim() === daemonPid && exists(socket), 'PM2_DAEMON_CHANGED')
    guard(fs.readlinkSync(`/proc/${daemonPid}/exe`) === daemonExecutable && fs.readFileSync(`/proc/${daemonPid}/stat`, 'utf8').split(') ')[1].split(' ')[19] === daemonIdentity, 'PM2_DAEMON_CHANGED')
    guard(run('/usr/bin/which', ['node']) === OLD_NODE && run(OLD_NODE, ['--version']) === 'v20.20.2', 'DEFAULT_NODE20_CHANGED')
    for (const file of ['node', 'npm', 'npx']) guard(!exists(`/usr/local/bin/${file}`), 'GLOBAL_ALIAS_CHANGED')
  }
  function rpc(method, args) { assertHost(); const result = pm2Rpc(OLD_NODE, pm2File, socket, method, args); assertHost(); return result }
  guard(rpc('getVersion', {}) === '6.0.14', 'DAEMON_VERSION_CHANGED')
  function processes() { return rpc('getMonitorData', {}) }
  function target() {
    const list = processes().filter(entry => entry.name === NAME)
    guard(list.length === 1, 'AMBIGUOUS_PM2_PROCESS')
    const entry = list[0], env = entry.pm2_env
    if (state?.pm2Id !== undefined) guard(entry.pm_id === state.pm2Id, 'PM2_PROCESS_ID_CHANGED')
    guard(env.pm_cwd === app && env.pm_exec_path === path.join(app, 'dist/server/src/index.js'), 'PM2_PATH_MISMATCH')
    guard(env.exec_mode === 'fork_mode' && !env.watch && Number(env.instances || 1) === 1 && !env.cron_restart, 'UNSAFE_PM2_PROCESS_MODE')
    guard(!env.DB_PATH || path.resolve(app, env.DB_PATH) === dbPath, 'PM2_DATABASE_OVERRIDE')
    guard(!env.PORT || Number(env.PORT) === port, 'PM2_PORT_OVERRIDE')
    if (state) {
      guard([state.originalInterpreter, newNode].includes(env.exec_interpreter), 'TARGET_CONFIGURATION_CHANGED')
      guard([state.originalTimeout, 35000].includes(env.kill_timeout ?? null), 'TARGET_CONFIGURATION_CHANGED')
      guard(configurationHash({ ...env, exec_interpreter: state.originalInterpreter, kill_timeout: state.originalTimeout ?? undefined }) === state.originalConfiguration, 'TARGET_CONFIGURATION_CHANGED')
    }
    return entry
  }
  function assertPeers() {
    assertHost()
    guard(lstat(dump)?.isFile(), 'SAVED_DUMP_CHANGED')
    guard(stableJson(peerSnapshot(processes())) === stableJson(state.peers), 'OTHER_PM2_PROCESS_CHANGED')
    guard(stableJson(loadJson(dump).filter(entry => entry.name !== NAME)) === stableJson(state.savedPeers), 'SAVED_PEER_CHANGED')
  }
  function savedFields(useNew) {
    return useNew ? { exec_interpreter: newNode, kill_timeout: 35000 } : state.savedOriginal
  }
  function verifySaved(useNew) {
    if (useNew) assertPeers()
    const row = loadJson(dump).filter(entry => entry.name === NAME)
    guard(row.length === 1 && row[0].pm_cwd === app, 'SAVED_TARGET_CHANGED')
    for (const [key, value] of Object.entries(savedFields(useNew))) guard((row[0][key] ?? null) === value, 'SAVED_TARGET_CHANGED')
  }
  function save(useNew) {
    if (useNew) assertPeers()
    guard(lstat(dump)?.isFile(), 'SAVED_DUMP_CHANGED')
    const expectedHash = hash(dump), current = loadJson(dump), baseline = loadJson(path.join(state.backup, 'dump.pm2'))
    const original = baseline.filter(entry => entry.name === NAME)
    guard(original.length === 1, 'AMBIGUOUS_SAVED_PROCESS')
    const active = [{ ...original[0], ...savedFields(true) }], selected = current.filter(entry => entry.name === NAME)
    guard(stableJson(selected) === stableJson(original) || stableJson(selected) === stableJson(active), 'SAVED_TARGET_CHANGED')
    updateSavedTarget(dump, expectedHash, savedFields(useNew))
    verifySaved(useNew)
  }
  function observeRecoveryPeers() {
    assertHost()
    const live = stableJson(peerSnapshot(processes())) !== stableJson(state.peers)
    let saved = true
    try { saved = !lstat(dump)?.isFile() || stableJson(loadJson(dump).filter(entry => entry.name !== NAME)) !== stableJson(state.savedPeers) } catch {}
    state.recoveryPeerDrift = { live: live || Boolean(state.recoveryPeerDrift?.live), saved: saved || Boolean(state.recoveryPeerDrift?.saved) }
    if (live || saved) console.error('[runtime-upgrade] NOTICE RECOVERY_PEER_DRIFT')
  }
  async function saveRecovered() {
    observeRecoveryPeers()
    try { save(false); delete state.persistenceIssue } catch (error) {
      state.persistenceIssue = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'SAVED_STATE_UNREADABLE'
      console.error(`[runtime-upgrade] NOTICE SERVICE_RESTORED_SAVED_STATE_ISSUE ${state.persistenceIssue}`)
    }
  }
  async function verify(interpreter, version, stable = true, requirePeers = true) {
    let last = 'SERVICE_VERIFICATION_FAILED'
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const entry = target()
        guard(entry.pm2_env.status === 'online' && Number.isInteger(entry.pid) && entry.pid > 0, 'PM2_NOT_ONLINE')
        const listeners = [...new Set(run('/usr/bin/lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN']).split(/\s+/).map(Number))]
        guard(listeners.length === 1 && listeners[0] === entry.pid, 'LISTENER_PM2_PID_MISMATCH')
        guard(fs.realpathSync(`/proc/${entry.pid}/exe`) === interpreter && run(`/proc/${entry.pid}/exe`, ['--version']) === version, 'LISTENER_RUNTIME_MISMATCH')
        guard(entry.pm2_env.exec_interpreter === interpreter || (interpreter === OLD_NODE && entry.pm2_env.exec_interpreter === 'node'), 'PM2_INTERPRETER_MISMATCH')
        await health(port)
        if (stable) {
          await sleep(12000)
          const after = target()
          guard(after.pid === entry.pid && after.pm2_env.restart_time === entry.pm2_env.restart_time, 'UNSTABLE_PROCESS')
          await health(port)
        }
        guard(run(interpreter, ['-e', SQLITE_CHECK, app, dbPath], { timeout: 60000 }) === 'integrity-ok', 'DATABASE_INTEGRITY_FAILED')
        if (state && requirePeers) assertPeers()
        return
      } catch (error) { last = error.message; await sleep(1000) }
    }
    throw new Error(last)
  }
  function write(phase) { state.phase = phase; writeJson(stateFile, state) }
  function assertSource() {
    guard(stableJson(fingerprint(app, dbPath)) === stableJson(state.fingerprint), 'LIVE_SOURCE_OR_CONFIG_CHANGED')
    guard(fs.statSync(app).dev === fs.statSync(root).dev, 'CROSS_FILESYSTEM_DEPENDENCY_SWAP')
    target()
  }
  function restart(config, advance = true) {
    assertSource(); if (advance) assertPeers()
    const entry = target(); rpc('restartProcessId', { id: entry.pm_id, env: { current_conf: config } })
  }
  async function stop(advance = true) {
    assertSource()
    let entry = target()
    if (entry.pm2_env.status === 'online' && !(Number(entry.pm2_env.kill_timeout) >= 35000)) {
      restart({ kill_timeout: 35000 }, advance); entry = target()
    }
    guard(entry.pm2_env.status === 'stopped' || Number(entry.pm2_env.kill_timeout) >= 35000, 'UNSAFE_STOP_TIMEOUT')
    if (advance) assertPeers()
    rpc('stopProcessId', entry.pm_id)
    guard(target().pm2_env.status === 'stopped', 'STOP_FAILED')
  }
  const ops = {
    write,
    beforeSwitch: async () => {
      assertSource(); assertPeers()
      guard(hash(state.backupDb) === state.backupHash, 'BACKUP_CHANGED')
      guard(hash(path.join(state.backup, 'hashes.json')) === state.backupManifestHash, 'BACKUP_CHANGED')
      for (const [file, digest] of Object.entries(loadJson(path.join(state.backup, 'hashes.json')))) guard(hash(path.join(state.backup, file)) === digest, 'BACKUP_CHANGED')
      guard(run(newNode, ['--version']) === `v${VERSION}`, 'NEW_RUNTIME_CHANGED')
      guard(run(newNode, ['-e', NATIVE_SMOKE, state.stage], { timeout: 60000 }) === 'native-ok', 'STAGED_NATIVE_SMOKE_FAILED')
      await verify(OLD_NODE, 'v20.20.2')
    },
    ensureTimeout: () => ensureStopTimeout(target(), restart, async () => {
      guard(target().pm2_env.kill_timeout === 35000, 'TIMEOUT_UPDATE_FAILED')
      await verify(OLD_NODE, 'v20.20.2')
    }),
    stop: () => stop(),
    exchangeModules: () => exchangeModules(app, state),
    restartNew: async () => restart({ exec_interpreter: newNode, kill_timeout: 35000 }),
    verifyNew: async () => { guard(target().pm2_env.kill_timeout === 35000, 'TIMEOUT_CHANGED'); await verify(newNode, `v${VERSION}`) },
    verifyOld: async () => {
      guard(lstat(dump)?.isFile(), 'SAVED_DUMP_CHANGED')
      await verify(OLD_NODE, 'v20.20.2')
      if (state && state.phase !== 'prepared') guard((target().pm2_env.kill_timeout ?? null) === state.originalTimeout, 'ORIGINAL_TIMEOUT_NOT_RESTORED')
    },
    verifySavedNew: async () => verifySaved(true),
    saveNew: async () => save(true),
    recovery: {
      beforeRollback: async () => { assertSource(); observeRecoveryPeers() },
      stop: () => stop(false),
      restoreModules: () => { assertSource(); restoreModules(app, state) },
      restartOld: async () => {
        guard(target().pm2_env.status === 'stopped', 'RESTORE_TIMEOUT_ONLY_WHILE_STOPPED')
        restart({ exec_interpreter: state.originalInterpreter, kill_timeout: state.originalTimeout ?? 'null' }, false)
      },
      verifyOld: async () => {
        assertSource()
        await verify(OLD_NODE, 'v20.20.2', true, false)
        guard((target().pm2_env.kill_timeout ?? null) === state.originalTimeout, 'ORIGINAL_TIMEOUT_NOT_RESTORED')
      },
      saveOld: saveRecovered,
    },
  }
  async function prepare() {
    guard(lstat(dump)?.isFile(), 'SAVED_DUMP_CHANGED')
    if (state?.phase === 'prepared') { await ops.beforeSwitch(); return 'already-prepared' }
    guard(!state || ['preparing', 'rolled-back'].includes(state.phase), 'PREVIOUS_TRANSACTION_REQUIRES_REVIEW')
    await verify(OLD_NODE, 'v20.20.2', false)
    const baseline = fingerprint(app, dbPath), initial = target(), savedRows = loadJson(dump)
    const saved = savedRows.filter(entry => entry.name === NAME)
    guard(saved.length === 1 && saved[0].pm_cwd === app && saved[0].pm_exec_path === initial.pm2_env.pm_exec_path, 'SAVED_TARGET_MISMATCH')
    guard(['node', OLD_NODE].includes(saved[0].exec_interpreter), 'SAVED_OLD_INTERPRETER_MISMATCH')
    guard(run('/usr/bin/find', [path.join(app, 'dist'), '-type', 'l', '-print']) === '', 'UNREVIEWED_BUILD_SYMLINK')
    const metadata = loadJson(path.join(app, 'package.json'))
    guard(!['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare'].some(name => metadata.scripts?.[name]), 'UNREVIEWED_ROOT_NPM_LIFECYCLE')
    const bytes = item => exists(item) ? Number(run('/usr/bin/du', ['-sk', item]).split(/\s+/)[0]) * 1024 : 0
    const statfs = fs.statfsSync(app)
    guard(Number(statfs.bavail) * Number(statfs.bsize) > Math.max(4 * 1024 ** 3, bytes(path.join(app, 'node_modules')) * 3 + bytes(path.join(app, 'uploads')) * 2 + bytes(dbPath) * 3 + 512 * 1024 ** 2), 'INSUFFICIENT_DISK_SPACE')
    const attempt = fs.mkdtempSync(path.join(root, 'attempt-'))
    state = { app, root, attempt, phase: 'preparing', fingerprint: baseline, peers: peerSnapshot(processes()),
      savedPeers: savedRows.filter(entry => entry.name !== NAME), pm2Id: initial.pm_id, daemonPid, daemonIdentity, daemonExecutable,
      originalInterpreter: initial.pm2_env.exec_interpreter, originalTimeout: initial.pm2_env.kill_timeout ?? null,
      originalConfiguration: configurationHash(initial.pm2_env),
      savedOriginal: { exec_interpreter: saved[0].exec_interpreter, kill_timeout: saved[0].kill_timeout ?? null } }
    write('preparing')
    const stage = path.join(attempt, 'dependencies')
    const backup = path.join(attempt, 'backup'), backupDb = path.join(backup, 'bingo.db')
    fs.mkdirSync(backup, { mode: 0o700 })
    guard(run(OLD_NODE, ['-e', SQLITE_BACKUP, app, dbPath, backupDb], { timeout: 120000 }) === 'backup-ok', 'SQLITE_ONLINE_BACKUP_FAILED')
    fs.chmodSync(backupDb, 0o600)
    for (const file of ['package.json', 'package-lock.json', '.env', 'dist']) fs.cpSync(path.join(app, file), path.join(backup, file), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
    fs.copyFileSync(OLD_NODE, path.join(backup, 'node20'))
    guard(hash(path.join(backup, 'node20')) === hash(OLD_NODE), 'NODE20_BACKUP_MISMATCH')
    run('/usr/bin/tar', ['-cf', path.join(backup, 'node_modules.node20.tar'), '-C', app, 'node_modules'], { timeout: 120000 })
    run('/usr/bin/tar', ['-tf', path.join(backup, 'node_modules.node20.tar')], { timeout: 30000 })
    run('/usr/bin/tar', ['-df', path.join(backup, 'node_modules.node20.tar'), '-C', app], { timeout: 120000 })
    if (exists(path.join(app, 'uploads'))) {
      plainDirectory(path.join(app, 'uploads'))
      run('/usr/bin/tar', ['-cf', path.join(backup, 'uploads.tar'), '-C', app, 'uploads'], { timeout: 120000 })
      run('/usr/bin/tar', ['-tf', path.join(backup, 'uploads.tar')], { timeout: 30000 })
      run('/usr/bin/tar', ['-df', path.join(backup, 'uploads.tar'), '-C', app], { timeout: 120000 })
    }
    fs.copyFileSync(dump, path.join(backup, 'dump.pm2'))
    writeJson(path.join(backup, 'live-processes.json'), processes())
    const originalModules = fs.statSync(path.join(app, 'node_modules'))
    Object.assign(state, { stage, backup, backupDb, backupHash: hash(backupDb), originalModules: { dev: originalModules.dev, ino: originalModules.ino } })
    const copied = fingerprint(backup, dbPath)
    copied.build = copied.build.map(line => line.replace(path.join(backup, 'dist'), path.join(app, 'dist')))
    guard(stableJson(copied) === stableJson(baseline), 'BACKUP_SOURCE_MISMATCH')
    const hashes = backupHashes(backup)
    writeJson(path.join(backup, 'hashes.json'), hashes)
    for (const [file, digest] of Object.entries(hashes)) guard(hash(path.join(backup, file)) === digest, 'BACKUP_CHANGED')
    state.backupManifestHash = hash(path.join(backup, 'hashes.json'))
    assertSource(); assertPeers()
    write('preparing')
    const archive = path.join(attempt, ARCHIVE)
    run('/usr/bin/curl', ['--proto', '=https', '--tlsv1.2', '-fSs', '--connect-timeout', '20', '--max-time', '300', '-o', archive, `https://nodejs.org/dist/v${VERSION}/${ARCHIVE}`], { timeout: 310000, error: 'NODE_DOWNLOAD_FAILED' })
    guard(hash(archive) === ARCHIVE_SHA256, 'NODE_CHECKSUM_MISMATCH')
    const runtimeRoot = path.dirname(install)
    if (!exists(runtimeRoot)) { fs.mkdirSync(runtimeRoot); fs.chmodSync(runtimeRoot, 0o755) }
    plainDirectory(runtimeRoot)
    guard(fs.statSync(runtimeRoot).uid === 0 && (fs.statSync(runtimeRoot).mode & 0o022) === 0, 'UNSAFE_PRIVATE_RUNTIME_ROOT')
    if (!exists(install)) {
      const extraction = fs.mkdtempSync(path.join(runtimeRoot, '.extract-'))
      const previousMask = process.umask(0o022)
      try { run('/usr/bin/tar', ['-xJf', archive, '-C', extraction, '--no-same-owner'], { timeout: 60000 }) } finally { process.umask(previousMask) }
      const extracted = path.join(extraction, `node-v${VERSION}-linux-x64`)
      writeJson(path.join(extracted, '.binwak-runtime.json'), { archive: ARCHIVE_SHA256, node: hash(path.join(extracted, 'bin/node')) })
      fs.renameSync(extracted, install)
    }
    plainDirectory(install)
    const marker = loadJson(path.join(install, '.binwak-runtime.json'))
    guard(marker.archive === ARCHIVE_SHA256 && marker.node === hash(newNode) && run(newNode, ['--version']) === `v${VERSION}`, 'UNREVIEWED_PRIVATE_RUNTIME')
    fs.mkdirSync(stage)
    for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(app, file), path.join(stage, file))
    const previousMask = process.umask(0o022)
    try {
      const output = run(newNode, [path.join(install, 'lib/node_modules/npm/bin/npm-cli.js'), 'ci', '--omit=dev', '--no-audit', '--no-fund'], {
        cwd: stage, env: { PATH: `${install}/bin:${process.env.PATH}`, NODE_ENV: 'production' }, timeout: 600000, error: 'STAGED_NPM_INSTALL_FAILED' })
      fs.writeFileSync(path.join(attempt, 'npm-install.log'), output, { mode: 0o600 })
    } finally { process.umask(previousMask) }
    guard(run(newNode, ['-e', NATIVE_SMOKE, stage], { timeout: 60000 }) === 'native-ok', 'NATIVE_SMOKE_FAILED')
    assertSource(); assertPeers()
    write('prepared')
    await verify(OLD_NODE, 'v20.20.2', false)
    return 'prepared'
  }
  return { prepare, ops, get state() { return state } }
}

async function main() {
  const action = process.argv[2] || 'check'
  guard(['check', 'prepare', 'activate', 'rollback', 'verify'].includes(action), 'INVALID_ACTION')
  guard(process.platform === 'linux' && process.arch === 'x64', 'LINUX_X64_REQUIRED')
  guard(process.getuid() === 0, 'REVIEWED_ROOT_TOPOLOGY_REQUIRED')
  guard(process.env.BINWAK_LOCK_HELD === 'yes', 'USE_LOCKED_BUNDLE_ENTRYPOINT')
  guard(process.execPath === OLD_NODE && process.version === 'v20.20.2', 'RUN_WITH_PRESERVED_NODE20')
  guard(process.env.BINWAK_TOPOLOGY_REVIEWED === 'cc5c713-run42237141183-private-runtime', 'TOPOLOGY_NOT_REVIEWED')
  guard(process.env.BINWAK_RELEASE_186 === 'failed-before-live-release', 'RELEASE_186_OUTCOME_REQUIRED')
  guard(process.env.BINWAK_DEPLOYMENTS_PAUSED === 'yes', 'DEPLOYMENT_EXCLUSION_REQUIRED')
  guard(process.env.BINWAK_INDEPENDENT_REVIEW === 'approved-v3', 'INDEPENDENT_REVIEW_REQUIRED')
  process.umask(0o077)
  const app = process.cwd()
  guard(/^\/[a-zA-Z0-9_./-]+$/.test(app) && app !== '/', 'UNSAFE_APP_PATH')
  plainDirectory(app)
  guard(fs.statSync(app).uid === 501, 'APP_OWNER_CHANGED')
  for (const file of ['package.json', 'package-lock.json', '.env', 'data/bingo.db', 'dist/server/src/index.js']) guard(lstat(path.join(app, file))?.isFile(), 'REQUIRED_FILE_MISSING_OR_SYMLINKED')
  plainDirectory(path.join(app, 'data'))
  const root = path.join(app, '.runtime-upgrade-node26')
  plainDirectory(exists(path.join(root, 'node_modules.node20')) ? path.join(root, 'node_modules.node20') : path.join(app, 'node_modules'))
  if (!exists(root)) fs.mkdirSync(root, { mode: 0o700 })
  plainDirectory(root)
  guard(fs.statSync(root).uid === 0 && (fs.statSync(root).mode & 0o077) === 0, 'UNSAFE_PRIVATE_DIRECTORY')
  const driver = makeDriver(app, root)
  let result
  if (action === 'check') { guard(!driver.state, 'TRANSACTION_ALREADY_EXISTS'); await driver.ops.verifyOld(); result = 'preconditions-ok' }
  if (action === 'prepare') result = await driver.prepare()
  if (action === 'activate') result = await activateTransaction(driver.state, driver.ops)
  if (action === 'rollback') result = await rollbackTransaction(driver.state, driver.ops)
  if (action === 'verify') { guard(driver.state?.phase === 'active', 'NOT_ACTIVE'); await driver.ops.verifyNew(); await driver.ops.verifySavedNew(); result = 'verified-active' }
  console.log(`[runtime-upgrade] ${result}`)
  if (result !== 'rolled-back' && /rolled-back|recovered/.test(result)) process.exitCode = 1
}
module.exports = { guard, exists, hash, writeJson, exchangeModules, restoreModules, activateTransaction, rollbackTransaction, health, SQLITE_BACKUP, SQLITE_CHECK, NATIVE_SMOKE, pm2Rpc, peerSnapshot, configurationHash, ensureStopTimeout, stableJson, updateSavedTarget, main }
if (require.main === module) main().catch(error => {
  const code = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'UNEXPECTED_FAILURE_DETAILS_SUPPRESSED'
  console.error(`[runtime-upgrade] STOP ${code}`)
  if (code === 'UNEXPECTED_FAILURE_DETAILS_SUPPRESSED') {
    const kind = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'UNCLASSIFIED'
    const line = /runtime-upgrade\.cjs:(\d+):\d+/.exec(error.stack || '')?.[1] || 'unknown'
    console.error(`[runtime-upgrade] ERROR_SITE ${kind} line=${line}`)
  }
  process.exitCode = 2
})
BINWAK_RUNTIME_JAVASCRIPT
actual=$(/usr/bin/sha256sum "$payload")
if [[ "${actual%% *}" != "$BINWAK_REVIEWED_PAYLOAD_SHA256" ]]; then
  printf '%s\n' '[runtime-upgrade] STOP EXTRACTED_PAYLOAD_SHA256_MISMATCH' >&2
  exit 2
fi
LOCK=/run/lock/binwak-runtime-upgrade.lock
if [[ -L "$LOCK" || ( -e "$LOCK" && ( ! -f "$LOCK" || ! -O "$LOCK" ) ) ]]; then
  printf '%s\n' '[runtime-upgrade] STOP UNSAFE_LOCK_FILE' >&2
  exit 2
fi
if [[ ! -e "$LOCK" ]]; then
  (set -o noclobber; : > "$LOCK")
fi
chmod 600 "$LOCK"
export BINWAK_LOCK_HELD=yes
/usr/bin/flock --nonblock "$LOCK" /usr/bin/node "$payload" "$1"
