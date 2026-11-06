const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createRequire } = require('node:module')
const { execFileSync } = require('node:child_process')

const app = process.cwd()
const requireApp = createRequire(path.join(app, 'package.json'))
const environment = fs.existsSync(path.join(app, '.env'))
  ? requireApp('dotenv').parse(fs.readFileSync(path.join(app, '.env')))
  : {}
const report = { node: process.version, platform: process.platform, architecture: process.arch }

function version(command) {
  try { return execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return 'unavailable' }
}
report.npm = version('npm')
report.runtime = {
  uid: process.getuid(),
  executable: process.execPath,
  searchPath: process.env.PATH,
  home: process.env.HOME,
  freeBytes: Number(fs.statfsSync(app).bavail) * Number(fs.statfsSync(app).bsize),
  appOwner: fs.statSync(app).uid,
  globalBin: ['/usr/local/bin/node', '/usr/local/bin/npm', '/usr/local/bin/npx'].map(file => ({
    file,
    exists: fs.existsSync(file),
  })),
}
const pm2Home = process.env.PM2_HOME || path.join(process.env.HOME, '.pm2')
const dumpPath = path.join(pm2Home, 'dump.pm2')
const daemonPidFile = path.join(pm2Home, 'pm2.pid')
if (fs.existsSync(daemonPidFile)) {
  const pid = fs.readFileSync(daemonPidFile, 'utf8').trim()
  if (/^\d+$/.test(pid)) {
    try {
      const executable = fs.readlinkSync(`/proc/${pid}/exe`)
      report.daemon = {
        pid: Number(pid),
        executable,
        node: path.basename(executable.replace(/ \(deleted\)$/, '')) === 'node' ? version(`/proc/${pid}/exe`) : 'unknown',
      }
    } catch { report.daemon = { pid: Number(pid), available: false } }
  }
}
report.savedProcesses = fs.existsSync(dumpPath)
  ? JSON.parse(fs.readFileSync(dumpPath, 'utf8')).map(entry => ({
    name: entry.name,
    interpreter: entry.exec_interpreter,
    script: entry.pm_exec_path,
    cwd: entry.pm_cwd,
  }))
  : []
report.pm2 = 'unavailable'
for (const directory of (process.env.PATH || '').split(path.delimiter)) {
  try {
    const executable = fs.realpathSync(path.join(directory, 'pm2'))
    const metadata = JSON.parse(fs.readFileSync(path.resolve(path.dirname(executable), '..', 'package.json'), 'utf8'))
    if (metadata.name === 'pm2' && typeof metadata.version === 'string') {
      report.pm2 = metadata.version
      break
    }
  } catch {}
}

const port = Number(environment.PORT || '3000')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Configured port is invalid')
try {
  const pids = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/)
  report.listeners = pids.filter(pid => /^\d+$/.test(pid)).map(pid => {
    const executable = `/proc/${pid}/exe`
    let runningNode = 'unknown'
    try {
      const target = fs.readlinkSync(executable).replace(/ \(deleted\)$/, '')
      if (path.basename(target) === 'node') runningNode = version(executable)
    } catch {}
    return { pid: Number(pid), node: runningNode }
  })
} catch { report.listeners = 'unavailable' }

const dbPath = environment.DB_PATH || path.join(app, 'data/bingo.db')
if (dbPath === ':memory:') throw new Error('Production database is configured in memory')
const Database = requireApp('better-sqlite3')
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
try {
  db.pragma('busy_timeout = 5000')
  report.database = {
    integrity: db.pragma('quick_check', { simple: true }),
    migrations: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
      ? db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version)
      : [],
    userColumns: db.prepare('PRAGMA table_info(users)').all().map(row => row.name),
    templateCellColumns: db.prepare('PRAGMA table_info(template_cells)').all().map(row => row.name),
  }
} finally { db.close() }

const request = http.get({ hostname: '127.0.0.1', port, path: '/api/health', timeout: 5000 }, response => {
  let body = ''
  response.setEncoding('utf8')
  response.on('data', chunk => { body += chunk; if (body.length > 4096) request.destroy(new Error('Health response too large')) })
  response.on('end', () => {
    let ok = false
    try { const health = JSON.parse(body); ok = response.statusCode === 200 && health.success === true && health.data?.status === 'ok' } catch {}
    report.health = { statusCode: response.statusCode, ok }
    console.log(JSON.stringify(report, null, 2))
    if (!ok || report.database.integrity !== 'ok') process.exitCode = 1
  })
})
request.on('timeout', () => request.destroy(new Error('Health request timed out')))
request.on('error', () => {
  report.health = { ok: false }
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = 1
})
