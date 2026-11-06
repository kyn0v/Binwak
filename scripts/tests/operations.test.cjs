const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')

const root = path.resolve(__dirname, '../..')
const Database = createRequire(path.join(root, 'server/package.json'))('better-sqlite3')

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binwak-ops-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  function write(file, content) {
    const target = path.join(dir, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    return target
  }
  function copy(file) {
    write(file, fs.readFileSync(path.join(root, file)))
  }
  fs.mkdirSync(path.join(dir, 'bin'))
  const trace = write('trace', '')
  function stub(name, body) {
    const file = write(`bin/${name}`, `#!/bin/bash\nset -eu\nprintf '%s\\n' '${name} '"$*" >> "$TRACE"\n${body}\n`)
    fs.chmodSync(file, 0o755)
  }
  for (const command of ['ssh', 'scp', 'curl', 'npm', 'pm2', 'rsync', 'lsof']) {
    stub(command, 'echo "Unexpected external command" >&2; exit 99')
  }
  stub('sleep', 'exit 0')
  const env = {
    PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
    HOME: dir,
    TRACE: trace,
    TMPDIR: dir,
    APP_PATH: path.join(dir, 'app'),
    HEALTH_URL: 'http://127.0.0.1:3000/api/health',
    PM2_NAME: 'fixture-only',
  }
  function run(file, args = [], overrides = {}) {
    return spawnSync(file.endsWith('.sh') ? '/bin/bash' : process.execPath,
      [path.join(dir, file), ...args], { cwd: dir, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10000 })
  }
  return { dir, write, copy, stub, run, trace: () => fs.readFileSync(trace, 'utf8') }
}

function releaseFixture(t, failures = {}) {
  const f = fixture(t)
  f.copy('deploy/release.sh')
  for (const [location, version] of [['app', 'old'], ['app/.incoming', 'new']]) {
    f.write(`${location}/dist/version`, version)
    f.write(`${location}/package.json`, JSON.stringify({ version }))
    f.write(`${location}/package-lock.json`, JSON.stringify({ lockfileVersion: 3, version }))
  }
  f.write('app/data/bingo.db', 'untouched data')
  f.write('app/.env', 'untouched secret')
  f.stub('rsync', 'src="${@: -2:1}"; dst="${@: -1}"; mkdir -p "$dst"; /bin/cp -R "$src". "$dst"')
  f.stub('npm', `version="$(<dist/version)"; case "$version" in new) exit ${failures.installNew || 0};; old) exit ${failures.installOld || 0};; esac`)
  f.stub('pm2', `if [ "$1" = logs ]; then exit 0; fi; version="$(<"$APP_PATH/dist/version")"; case "$version" in new) exit ${failures.restartNew || 0};; old) exit ${failures.restartOld || 0};; esac`)
  f.stub('curl', `version="$(<"$APP_PATH/dist/version")"; case "$version" in new) exit ${failures.healthNew || 0};; old) exit ${failures.healthOld || 0};; esac`)
  return f
}

function assertStateUntouched(f) {
  assert.equal(fs.readFileSync(path.join(f.dir, 'app/data/bingo.db'), 'utf8'), 'untouched data')
  assert.equal(fs.readFileSync(path.join(f.dir, 'app/.env'), 'utf8'), 'untouched secret')
}

test('release install failure cannot be hidden by restart or health', (t) => {
  const f = releaseFixture(t, { installNew: 17 })
  const result = f.run('deploy/release.sh')
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(fs.readFileSync(path.join(f.dir, 'app/dist/version'), 'utf8'), 'old')
  assert.equal((f.trace().match(/pm2 restart/g) || []).length, 1, 'only rollback may restart')
  assert.match(f.trace(), /npm ci --omit=dev/)
  assert.doesNotMatch(f.trace(), /npm install/)
  assertStateUntouched(f)
})

test('release restart failure cannot be hidden by successful health', (t) => {
  const f = releaseFixture(t, { restartNew: 18 })
  const result = f.run('deploy/release.sh')
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(fs.readFileSync(path.join(f.dir, 'app/dist/version'), 'utf8'), 'old')
  assertStateUntouched(f)
})

for (const [failure, options] of Object.entries({
  install: { installOld: 21 }, restart: { restartOld: 22 }, health: { healthOld: 23 },
})) {
  test(`release reports failed rollback ${failure} even when later commands could pass`, (t) => {
    const f = releaseFixture(t, { healthNew: 1, ...options })
    const result = f.run('deploy/release.sh')
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.match(result.stdout, /ROLLBACK_FAILED/)
    assert.doesNotMatch(result.stdout, /Rollback succeeded/)
    assertStateUntouched(f)
  })
}

test('release validates a complete incoming bundle before mutating live files', (t) => {
  const f = releaseFixture(t)
  fs.unlinkSync(path.join(f.dir, 'app/.incoming/package-lock.json'))
  const result = f.run('deploy/release.sh')
  assert.notEqual(result.status, 0)
  assert.equal(fs.readFileSync(path.join(f.dir, 'app/dist/version'), 'utf8'), 'old')
  assert.doesNotMatch(f.trace(), /npm |pm2 |curl /)
})

test('first deployment failure explicitly reports unavailable rollback', (t) => {
  const f = releaseFixture(t, { installNew: 17 })
  fs.rmSync(path.join(f.dir, 'app/dist'), { recursive: true })
  const result = f.run('deploy/release.sh')
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.match(result.stdout, /ROLLBACK_UNAVAILABLE/)
  assert.doesNotMatch(f.trace(), /pm2 restart|curl /)
})

test('release rejects an incompatible runtime before mutating live files', (t) => {
  const f = releaseFixture(t)
  f.stub('node', 'printf "20\\n"')
  const result = f.run('deploy/release.sh')
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(fs.readFileSync(path.join(f.dir, 'app/dist/version'), 'utf8'), 'old')
  assert.doesNotMatch(f.trace(), /rsync |npm |pm2 |curl /)
})

test('release uses its private Node runtime without changing the host runtime', (t) => {
  const f = releaseFixture(t)
  f.stub('node', 'printf "20\\n"')
  const hostNode = fs.readFileSync(path.join(f.dir, 'bin/node'))
  const privateNode = path.join(f.dir, 'app/.runtime/node/bin/node')
  fs.mkdirSync(path.dirname(privateNode), { recursive: true })
  fs.symlinkSync(process.execPath, privateNode)
  f.stub('npm', '[ "$(command -v node)" = "$APP_PATH/.runtime/node/bin/node" ]')
  const result = f.run('deploy/release.sh')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(f.trace().includes(`--interpreter ${privateNode}`), 'PM2 receives the verified private interpreter')
  assert.deepEqual(fs.readFileSync(path.join(f.dir, 'bin/node')), hostNode)
  assertStateUntouched(f)
})

test('release rejects an incompatible private runtime rather than using the host runtime', (t) => {
  const f = releaseFixture(t)
  const privateNode = f.write('app/.runtime/node/bin/node', '#!/bin/sh\nprintf "24\\n"\n')
  fs.chmodSync(privateNode, 0o755)
  const result = f.run('deploy/release.sh')
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(fs.readFileSync(path.join(f.dir, 'app/dist/version'), 'utf8'), 'old')
  assert.doesNotMatch(f.trace(), /rsync |npm |pm2 |curl /)
})

test('PM2 initial start allows the full 30-second application drain plus margin', () => {
  const config = require(path.join(root, 'deploy/ecosystem.config.js'))
  const app = config.apps.find(app => app.name === 'binwak-api')
  assert.equal(app.kill_timeout, 35000)
})

for (const rollback of [false, true]) {
  test(`release sets the shutdown timeout before each ${rollback ? 'deployment and rollback' : 'deployment'} restart`, (t) => {
    const f = releaseFixture(t, rollback ? { healthNew: 1 } : {})
    const result = f.run('deploy/release.sh')
    assert.equal(result.status, rollback ? 1 : 0, result.stdout + result.stderr)
    const restarts = f.trace().split('\n').filter(line => line.startsWith('pm2 restart '))
    assert.equal(restarts.length, rollback ? 2 : 1)
    for (const command of restarts) {
      assert.match(command, /--kill-timeout(?:=| )35000(?: |$)/)
      assert.match(command, /--update-env/)
    }
    assertStateUntouched(f)
  })
}

test('healthy release installs locked dependencies and preserves all state', (t) => {
  const f = releaseFixture(t)
  const result = f.run('deploy/release.sh')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(f.trace(), /npm ci --omit=dev/)
  assert.equal(fs.readFileSync(path.join(f.dir, 'app/dist/version'), 'utf8'), 'new')
  assert.equal(fs.existsSync(path.join(f.dir, 'app/.incoming')), false)
  assertStateUntouched(f)
})

function resetFixture(t) {
  const f = fixture(t)
  f.copy('scripts/reset-local.sh')
  f.copy('scripts/backup-local-db.cjs')
  f.write('server/package.json', '{}')
  fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(f.dir, 'server/node_modules'), 'dir')
  f.stub('lsof', 'exit 1')
  const dbPath = f.write('server/data/bingo.db', '')
  const db = new Database(dbPath)
  db.exec('CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES (\'committed\')')
  db.close()
  return { ...f, dbPath }
}

for (const kind of ['listener', 'database holder', 'watcher working directory']) {
  test(`reset refuses a running backend detected by ${kind}`, (t) => {
    const f = resetFixture(t)
    const selector = { listener: '-iTCP:3000', 'database holder': 'bingo.db', 'watcher working directory': '+d' }[kind]
    f.stub('lsof', `if [[ "$*" == *${selector}* ]]; then echo 12345; exit 0; fi; exit 1`)
    const before = fs.readFileSync(f.dbPath)
    const result = f.run('scripts/reset-local.sh', ['--yes'])
    assert.notEqual(result.status, 0, result.stdout + result.stderr)
    assert.deepEqual(fs.readFileSync(f.dbPath), before)
    assert.doesNotMatch(f.trace(), /kill /)
  })
}

test('reset refuses when process inspection fails', (t) => {
  const f = resetFixture(t)
  f.stub('lsof', 'exit 2')
  const result = f.run('scripts/reset-local.sh', ['--yes'])
  assert.notEqual(result.status, 0)
  assert.ok(fs.existsSync(f.dbPath))
})

test('reset keeps the database when SQLite backup cannot complete', (t) => {
  const f = resetFixture(t)
  fs.writeFileSync(f.dbPath, 'not a SQLite database')
  const result = f.run('scripts/reset-local.sh', ['--yes'])
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  assert.equal(fs.readFileSync(f.dbPath, 'utf8'), 'not a SQLite database')
})

test('reset backs up committed WAL rows before removing only fixture database files', (t) => {
  const f = resetFixture(t)
  const db = new Database(f.dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('wal_autocheckpoint = 0')
  const reader = new Database(f.dbPath, { readonly: true })
  reader.exec('BEGIN; SELECT * FROM proof')
  db.exec("INSERT INTO proof VALUES ('committed in WAL')")
  db.close()
  reader.close()
  // Preserve the crash-like WAL fixture without keeping a process alive during reset.
  const walDb = new Database(f.dbPath)
  walDb.pragma('journal_mode = WAL')
  walDb.pragma('wal_autocheckpoint = 0')
  walDb.exec("INSERT INTO proof VALUES ('last WAL row')")
  const wal = fs.readFileSync(`${f.dbPath}-wal`)
  const main = fs.readFileSync(f.dbPath)
  walDb.close()
  fs.writeFileSync(f.dbPath, main)
  fs.writeFileSync(`${f.dbPath}-wal`, wal)
  const result = f.run('scripts/reset-local.sh', ['--yes'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(fs.existsSync(f.dbPath), false)
  const backups = fs.readdirSync(path.dirname(f.dbPath)).filter(name => name.startsWith('bingo.db.backup-'))
  assert.equal(backups.length, 1)
  const backup = new Database(path.join(path.dirname(f.dbPath), backups[0]), { readonly: true })
  assert.deepEqual(backup.prepare('SELECT value FROM proof').all(), [
    { value: 'committed' }, { value: 'committed in WAL' }, { value: 'last WAL row' },
  ])
  backup.close()
  assert.match(result.stdout, /restart|Restart/)
  assert.doesNotMatch(result.stdout, /no restart needed/)
})

for (const failure of ['occupied port', 'health check']) {
  test(`dev-local refuses an unverified backend after ${failure} failure`, (t) => {
    const f = fixture(t)
    f.copy('scripts/dev-local.sh')
    f.write('.env.local', 'WX_APPID=wxFixture\nWX_SECRET=fixture\n')
    f.write('server/.env', 'WX_APPID=\n')
    const original = '{"appid":"YOUR_WX_APPID"}'
    f.write('client/src/manifest.json', original)
    f.stub('lsof', failure === 'occupied port' ? 'echo 12345; exit 0' : 'exit 1')
    f.stub('npm', 'exit 0')
    f.stub('curl', 'exit 1')
    const bashEnv = f.write('bash-env', 'kill() { :; }\n')
    const result = f.run('scripts/dev-local.sh', [], { BASH_ENV: bashEnv })
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.doesNotMatch(f.trace(), /npm run dev:mp-weixin/)
    assert.equal(fs.readFileSync(path.join(f.dir, 'client/src/manifest.json'), 'utf8'), original)
    assert.equal(fs.existsSync(path.join(f.dir, 'client/.env.development')), false)
    if (failure === 'occupied port') assert.doesNotMatch(f.trace(), /npm |curl /)
  })
}

function devFixture(t) {
  const f = fixture(t)
  f.copy('scripts/dev-local.sh')
  const devtools = f.write('bin/devtools', `#!/bin/bash
set -eu
printf 'devtools open\\n' >> "$TRACE"
test -f "$HOME/build-finished"
test ! -f "$HOME/watch-started"
grep -q 'http://127.0.0.1:3000' "$HOME/client/dist/dev/mp-weixin/common/vendor.js"
if grep -q 'production.invalid' "$HOME/client/dist/dev/mp-weixin/common/vendor.js"; then exit 88; fi
printf 'devtools verified local bundle\\n' >> "$TRACE"
`)
  fs.chmodSync(devtools, 0o755)
  f.write('.env.local', `WX_APPID=wxFixture\nWX_SECRET=fixture\nVITE_API_BASE_URL=https://production.invalid\nPORT=9999\nWX_DEVTOOLS_CLI="${devtools}"\n`)
  f.write('server/.env', 'WX_APPID=\n')
  const original = '{"appid":"YOUR_WX_APPID"}'
  f.write('client/src/manifest.json', original)
  f.write('client/dist/dev/mp-weixin/app.json', '{}')
  f.write('client/dist/dev/mp-weixin/common/vendor.js', 'const api="https://production.invalid"')
  f.stub('curl', 'exit 0')
  f.stub('lsof', 'exit 1')
  const bashEnv = f.write('bash-env', 'kill() { :; }\n')
  return { ...f, original, overrides: { BASH_ENV: bashEnv, VITE_API_BASE_URL: 'https://inherited.invalid' } }
}

for (const partialBuild of [false, true]) {
  test(`dev-local never opens stale production output when the fresh compile fails${partialBuild ? ' after writing app.json' : ''}`, (t) => {
    const f = devFixture(t)
    f.stub('npm', `
if [[ "$*" == 'run dev' ]]; then exit 0; fi
${partialBuild ? 'printf "{}" > "$HOME/client/dist/dev/mp-weixin/app.json"' : ':'}
exit 31
`)
    const result = f.run('scripts/dev-local.sh', [], f.overrides)
    assert.equal(result.status, 31, result.stdout + result.stderr)
    assert.doesNotMatch(f.trace(), /devtools open/)
    assert.doesNotMatch(f.trace(), /npm run dev:mp-weixin/)
    assert.equal(fs.readFileSync(path.join(f.dir, 'client/src/manifest.json'), 'utf8'), f.original)
  })
}

for (const delay of [0, 100, 250]) {
  test(`dev-local waits for completed local compilation before import and watch, delayed vendor ${delay}ms`, (t) => {
    const f = devFixture(t)
    f.stub('npm', `
printf 'target=%s port=%s output=%s\\n' "$VITE_API_BASE_URL" "$PORT" "\${UNI_OUTPUT_DIR:-missing}" >> "$TRACE"
if [[ "$*" == 'run dev' ]]; then exit 0; fi
if [[ "$*" == 'run dev:mp-weixin' ]]; then
  touch "$HOME/watch-started"
  grep -q 'devtools verified local bundle' "$TRACE"
  exit
fi
if [[ "$*" != 'run build:mp-weixin -- --mode development' ]]; then exit 89; fi
test "$UNI_OUTPUT_DIR" = "$HOME/client/dist/dev/mp-weixin"
printf '{}' > "$UNI_OUTPUT_DIR/app.json"
node -e 'setTimeout(() => {}, ${delay})'
printf 'const api="%s"' "$VITE_API_BASE_URL" > "$UNI_OUTPUT_DIR/common/vendor.js"
touch "$HOME/build-finished"
printf 'build complete\\n' >> "$TRACE"
`)
    const result = f.run('scripts/dev-local.sh', [], f.overrides)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(f.trace(), /devtools verified local bundle/)
    assert.match(f.trace(), /npm run dev:mp-weixin/)
    assert.ok(f.trace().indexOf('build complete') < f.trace().indexOf('devtools open'))
    assert.ok(f.trace().indexOf('devtools verified local bundle') < f.trace().indexOf('npm run dev:mp-weixin'))
    assert.match(f.trace(), /target=http:\/\/127\.0\.0\.1:3000 port=3000/)
    assert.doesNotMatch(f.trace(), /target=https:/)
    assert.equal(fs.existsSync(path.join(f.dir, 'client/.env.development')), false)
    assert.equal(fs.readFileSync(path.join(f.dir, 'client/src/manifest.json'), 'utf8'), f.original)
  })
}

function productionFixture(t) {
  const f = fixture(t)
  f.copy('scripts/build-client-production.sh')
  f.copy('scripts/validate-client-api.cjs')
  f.write('client/package.json', '{}')
  f.stub('npx', 'exit 0')
  f.stub('npm', 'echo "target=${VITE_API_BASE_URL:-missing}" >> "$TRACE"')
  return f
}

for (const target of ['', 'http://api.example.test', 'https://localhost:3000', 'https://LOCALHOST.',
  'https://dev.localhost', 'https://127.10.2.3', 'https://[::1]', 'https://0.0.0.0', 'garbage']) {
  test(`production build rejects ${JSON.stringify(target)} before invoking npm`, (t) => {
    const f = productionFixture(t)
    const result = f.run('scripts/build-client-production.sh', [], { VITE_API_BASE_URL: target })
    assert.notEqual(result.status, 0)
    assert.equal(f.trace(), '')
  })
}

test('production build forwards an explicit HTTPS destination', (t) => {
  const f = productionFixture(t)
  const result = f.run('scripts/build-client-production.sh', [], { VITE_API_BASE_URL: 'https://api.example.test' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(f.trace(), /npm run build:mp-weixin -- --mode production/)
  assert.match(f.trace(), /target=https:\/\/api.example.test/)
})

test('manual deployment stages artifacts and propagates release failure without direct live writes', (t) => {
  const f = fixture(t)
  f.copy('scripts/deploy-server.sh')
  f.write('server/package.json', '{}')
  f.stub('npm', 'exit 0')
  f.stub('rsync', 'exit 0')
  f.stub('scp', 'exit 0')
  f.stub('ssh', 'if [[ "$*" == *release.sh* ]]; then exit 27; fi; exit 0')
  const result = f.run('scripts/deploy-server.sh', [], {
    DEPLOY_HOST: 'fixture.invalid', DEPLOY_REMOTE_DIR: '/fixture/server',
  })
  assert.equal(result.status, 27, result.stdout + result.stderr)
  assert.match(f.trace(), /fixture.invalid:\/fixture\/server\/\.incoming\/dist\//)
  assert.doesNotMatch(f.trace(), /fixture.invalid:\/fixture\/server\/dist\//)
  assert.match(f.trace(), /APP_PATH='\/fixture\/server' bash '\/fixture\/server\/release.sh'/)
})

test('manual deployment never contacts a remote after a failed build', (t) => {
  const f = fixture(t)
  f.copy('scripts/deploy-server.sh')
  f.write('server/package.json', '{}')
  f.stub('npm', 'exit 19')
  const result = f.run('scripts/deploy-server.sh', [], {
    DEPLOY_HOST: 'fixture.invalid', DEPLOY_REMOTE_DIR: '/fixture/server',
  })
  assert.equal(result.status, 19, result.stdout + result.stderr)
  assert.doesNotMatch(f.trace(), /ssh |scp |rsync /)
})

test('server setup refuses an incompatible preinstalled runtime without touching services', (t) => {
  const f = fixture(t)
  f.copy('deploy/setup.sh')
  f.copy('.nvmrc')
  f.stub('sudo', 'exit 0')
  f.stub('node', 'printf "20\\n"')
  const result = f.run('deploy/setup.sh')
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /Expected Node.js 26/)
  assert.doesNotMatch(f.trace(), /pm2 |systemctl|curl /)
})

for (const config of ['deploy/nginx-ip.conf', 'deploy/nginx-https.conf']) {
  test(`${config} denies all case variants of the public admin prefix`, () => {
    const text = fs.readFileSync(path.join(root, config), 'utf8')
    const match = text.match(/location\s+~\*\s+(\S+)\s*\{\s*deny all;/)
    assert.ok(match, 'case-insensitive deny location is required')
    const rule = new RegExp(match[1], 'i')
    for (const request of ['/api/admin', '/API/ADMIN/login', '/Api/AdMiN', '/api/administrator']) assert.ok(rule.test(request), request)
    for (const request of ['/api/boards', '/uploads/api/admin.png']) assert.equal(rule.test(request), false, request)
  })
}
