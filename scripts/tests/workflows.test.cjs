const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function runBlock(workflow, name) {
  const lines = workflow.split('\n')
  const start = lines.findIndex(line => line.trim() === `- name: ${name}`)
  assert.notEqual(start, -1, `workflow step ${name} exists`)
  const block = []
  for (const line of lines.slice(start + 1)) {
    if (/^      - /.test(line)) break
    block.push(line)
  }
  const run = block.findIndex(line => line.trim() === 'run: |')
  assert.notEqual(run, -1, `workflow step ${name} has a shell block`)
  return block.slice(run + 1).filter(line => line.startsWith('          '))
    .map(line => line.slice(10)).join('\n')
}

test('PR checks cover deployment, scripts, workflows and runtime changes', () => {
  for (const file of ['client', 'server']) {
    const workflow = read(`.github/workflows/${file}.yml`)
    const pr = workflow.split('  pull_request:')[1].split('  workflow_dispatch:')[0]
    assert.doesNotMatch(pr, /^\s+branches(?:-ignore)?:/m, 'stacked PRs must receive the same checks as main PRs')
    for (const glob of ['scripts/**', '.github/workflows/**', 'package.json', '.nvmrc']) {
      assert.ok(pr.includes(`'${glob}'`), `${file} checks ${glob} PRs`)
    }
    if (file === 'server') assert.ok(pr.includes("'deploy/**'"))
    assert.ok(pr.includes("'tools/wechat-upload/**'"), `${file} checks upload tool PRs`)
    assert.doesNotMatch(workflow, /node-version:\s*['"]?20/)
    assert.match(workflow, /node-version-file: '\.nvmrc'/)
  }
  assert.match(read('.github/workflows/client.yml'), /run: npm --prefix client run type-check/)
  assert.match(read('.github/workflows/server.yml'), /run: npm run test:ops/)
})

test('server artifacts are extracted into the directory consumed by deployment', () => {
  const workflow = read('.github/workflows/server.yml')
  const download = workflow.split('uses: actions/download-artifact@v4')[1].split('      - name:')[0]
  const destination = download.match(/^\s+path:\s+([^\n]+)$/m)?.[1].trim() || '.'
  const upload = runBlock(workflow, 'Upload new build to staging area')
  for (const entry of ['dist/', 'package.json', 'package-lock.json']) {
    const source = `server/${entry}`
    assert.ok(upload.includes(source), `deployment consumes ${source}`)
    assert.equal(path.posix.join(destination, entry), source, `downloaded ${entry} reaches the deployment source`)
  }
})

test('runtime declarations agree with release preflight and supported Node 26', () => {
  assert.equal(read('.nvmrc').trim(), '26')
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=26 <27')
  assert.match(read('deploy/release.sh'), /!= 26/)
  assert.match(read('deploy/setup.sh'), /\.nvmrc/)
})

test('deploy builds cannot bypass API validation and PR builds use a non-routable placeholder', () => {
  const workflow = read('.github/workflows/client.yml')
  assert.equal((workflow.match(/run: bash scripts\/build-client-production.sh/g) || []).length, 2)
  const deploy = workflow.split('  deploy:')[1]
  assert.ok(deploy.indexOf('run: node scripts/validate-client-api.cjs') < deploy.indexOf('run: bash scripts/build-client-production.sh'))
  assert.match(workflow, /github.event_name == 'pull_request' && 'https:\/\/api.example.invalid'/)
  assert.equal(JSON.parse(read('package.json')).scripts['client:build'], 'bash scripts/build-client-production.sh')
})

test('upload tool has an independent registry-integrity-locked dependency tree', () => {
  const manifestPath = path.join(root, 'tools/wechat-upload/package.json')
  const lockPath = path.join(root, 'tools/wechat-upload/package-lock.json')
  assert.ok(fs.existsSync(manifestPath), 'dedicated upload manifest exists outside app packages')
  assert.ok(fs.existsSync(lockPath), 'dedicated upload lock exists outside app packages')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  assert.equal(manifest.private, true)
  assert.deepEqual(manifest.dependencies, { 'miniprogram-ci': '2.1.34' })
  assert.equal(lock.lockfileVersion, 3)
  assert.equal(lock.name, manifest.name)
  assert.equal(lock.version, manifest.version)
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies)
  const tool = lock.packages['node_modules/miniprogram-ci']
  assert.ok(tool, 'upload package is locked inside this project, not linked to another directory')
  assert.equal(tool.version, '2.1.34')
  assert.equal(tool.resolved, 'https://registry.npmjs.org/miniprogram-ci/-/miniprogram-ci-2.1.34.tgz')
  assert.equal(tool.integrity, 'sha512-AXDaXJ+t2WTV21SN1G3URcmVenyR672cndBn+uCfOHPZ1fISaoGh8t6aWebG1yU0STFHZFsZdDJ3lxa/0aYcgg==')
  assert.ok(Object.keys(lock.packages).length > 1, 'transitive dependency records exist')
  for (const [location, pkg] of Object.entries(lock.packages)) {
    if (location === '') continue
    assert.ok(location.startsWith('node_modules/'), location)
    assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, location)
    const source = new URL(pkg.resolved)
    assert.equal(source.origin, 'https://registry.npmjs.org', location)
    assert.ok(source.pathname.endsWith(`-${pkg.version}.tgz`), location)
    assert.match(pkg.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/, location)
    assert.equal(Buffer.from(pkg.integrity.slice('sha512-'.length), 'base64').length, 64, location)
    assert.equal(pkg.link, undefined, location)
  }
  for (const app of ['client', 'server']) {
    const appManifest = JSON.parse(read(`${app}/package.json`))
    assert.equal(appManifest.dependencies['miniprogram-ci'], undefined)
    assert.equal(appManifest.devDependencies['miniprogram-ci'], undefined)
  }
})

for (const installStatus of [0, 47]) {
  test(`CI locked upload install ${installStatus === 0 ? 'resolves for actual upload script' : 'failure cannot publish NODE_PATH'}`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binwak-ci-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    const bin = path.join(dir, 'bin')
    const client = path.join(dir, 'client')
    fs.mkdirSync(bin)
    fs.mkdirSync(client)
    const originalLock = '{"fixture":"immutable"}'
    fs.writeFileSync(path.join(client, 'package-lock.json'), originalLock)
    fs.copyFileSync(path.join(root, 'client/upload.js'), path.join(client, 'upload.js'))
    const toolSource = path.join(root, 'tools/wechat-upload')
    fs.mkdirSync(path.join(dir, 'tools/wechat-upload'), { recursive: true })
    for (const file of ['package.json', 'package-lock.json']) {
      fs.copyFileSync(path.join(toolSource, file), path.join(dir, 'tools/wechat-upload', file))
    }
    fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/bash\nset -eu\nprintf "%s\\n" "$*" >> "$TRACE"\nexit ${installStatus}\n`)
    fs.chmodSync(path.join(bin, 'npm'), 0o755)
    const workflow = read('.github/workflows/client.yml')
    const env = {
      PATH: `${bin}:${process.env.PATH}`, HOME: dir, RUNNER_TEMP: path.join(dir, 'runner temp'),
      GITHUB_ENV: path.join(dir, 'github-env'), TRACE: path.join(dir, 'trace'),
      WX_APPID: 'fixture', WX_UPLOAD_KEY: 'fixture', VERSION: 'fixture',
      COMMIT_SUBJECT: 'fixture\nnot in description', RUN_NUMBER: '42', SHORT_SHA: 'abcdefg123',
    }
    const install = spawnSync('/bin/bash', ['-euc', runBlock(workflow, 'Install pinned upload tool outside the client dependency tree')], {
      cwd: dir, env, encoding: 'utf8', timeout: 10000,
    })
    assert.equal(install.status, installStatus, install.stderr)
    assert.equal(fs.readFileSync(path.join(client, 'package-lock.json'), 'utf8'), originalLock)
    if (installStatus !== 0) {
      assert.equal(fs.existsSync(env.GITHUB_ENV), false)
      return
    }
    const args = fs.readFileSync(env.TRACE, 'utf8')
    assert.match(args, /^ci --prefix /)
    assert.ok(args.includes(`--prefix ${env.RUNNER_TEMP}/wechat-upload`))
    assert.doesNotMatch(args, /install|--no-save|--package-lock=false/)
    for (const file of ['package.json', 'package-lock.json']) {
      assert.deepEqual(fs.readFileSync(path.join(env.RUNNER_TEMP, 'wechat-upload', file)), fs.readFileSync(path.join(toolSource, file)))
    }
    const moduleDir = path.join(env.RUNNER_TEMP, 'wechat-upload/node_modules/miniprogram-ci')
    fs.mkdirSync(moduleDir, { recursive: true })
    fs.writeFileSync(path.join(moduleDir, 'index.js'), `
      exports.Project = class { constructor(options) {
        if (options.appid !== 'fixture' || options.privateKey !== 'fixture') throw new Error('unexpected fixture credentials')
      } }
      exports.upload = async options => {
        if (options.desc !== 'CI #42 abcdefg - fixture') throw new Error('unexpected upload description')
        console.log('fixture upload only')
        return { subPackageInfo: [] }
      }
    `)
    const nodePathLine = fs.readFileSync(env.GITHUB_ENV, 'utf8').trim()
    assert.equal(nodePathLine, `NODE_PATH=${env.RUNNER_TEMP}/wechat-upload/node_modules`)
    const upload = spawnSync('/bin/bash', ['-euc', runBlock(workflow, 'Upload to WeChat')], {
      cwd: dir, env: { ...env, NODE_PATH: nodePathLine.slice('NODE_PATH='.length) }, encoding: 'utf8', timeout: 10000,
    })
    assert.equal(upload.status, 0, upload.stdout + upload.stderr)
    assert.match(upload.stdout, /fixture upload only/)
    assert.equal(fs.readFileSync(path.join(client, 'package-lock.json'), 'utf8'), originalLock)
  })
}
