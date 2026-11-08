'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const http = require('node:http')
const https = require('node:https')
const { spawnSync } = require('node:child_process')

const HOST = 'api.citywalkbingo.com'
const NGINX = '/usr/sbin/nginx'
const MAIN = '/etc/nginx/nginx.conf'
const BACKUPS = '/var/backups/binwak-nginx-admin'
const RULE = 'location ~* ^/api/admin { return 403; }'
const ADMIN = ['/api/admin', '/api/ADMIN', '/API/AdMiN', '/api/admin/', '/api/admin/login', '/api/ADMIN/login', '/API/AdMiN/users', '/api/admin?packet=1']
const fail = code => { throw Error(code) }
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const need = (value, code) => { if (!value) fail(code) }

function parse(bytes) {
  const text = bytes.toString('latin1')
  const root = { args: [], entries: [], start: 0, end: text.length }
  const stack = [root]
  let args = [], token = '', start = -1, tokenStart = -1, quote = '', escaped = false, closedQuote = false
  function endToken() {
    if (tokenStart !== -1) { args.push(token); token = ''; tokenStart = -1 }
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (escaped) { token += c; escaped = false; continue }
    if (closedQuote) { need(/[ \t\r\n;{}]/.test(c), 'CONFIG_STRUCTURE_UNSUPPORTED'); closedQuote = false }
    if (c === '\\') { if (tokenStart === -1) tokenStart = i; if (start === -1) start = i; escaped = true; continue }
    if (quote) { if (c === quote) { quote = ''; endToken(); closedQuote = true } else token += c; continue }
    if (c === '"' || c === "'") { need(tokenStart === -1, 'CONFIG_STRUCTURE_UNSUPPORTED'); if (start === -1) start = i; tokenStart = i; quote = c; continue }
    if (/[ \t\r\n]/.test(c)) { endToken(); continue }
    if (c === '#' && tokenStart === -1) { while (i < text.length && text[i] !== '\n') i++; continue }
    if (';{}'.includes(c)) {
      endToken()
      if (c === '}') {
        need(!args.length && stack.length > 1, 'CONFIG_STRUCTURE_UNSUPPORTED')
        stack.pop().end = i + 1
      } else {
        need(args.length > 0 && start !== -1, 'CONFIG_STRUCTURE_UNSUPPORTED')
        const node = { args, start, end: i + 1 }
        stack.at(-1).entries.push(node)
        if (c === '{') { node.entries = []; node.open = i; stack.push(node) }
      }
      args = []; start = -1
      continue
    }
    need(c !== '$' || text[i + 1] !== '{', 'BRACED_VARIABLE_UNSUPPORTED')
    if (start === -1) start = i
    if (tokenStart === -1) tokenStart = i
    token += c
  }
  endToken()
  need(!quote && !escaped && !args.length && stack.length === 1, 'CONFIG_STRUCTURE_UNSUPPORTED')
  return root
}
function walk(node) { return [node, ...(node.entries || []).flatMap(walk)] }
function directives(node, name) { return (node.entries || []).filter(n => !n.entries && n.args[0] === name) }

function sections(dump, readFile = fs.readFileSync) {
  const text = dump.toString('latin1')
  const markers = [...text.matchAll(/^# configuration file (\/[^\r\n]+):\n/gm)]
  need(markers.length > 0 && !text.slice(0, markers[0].index).trim(), 'CONFIG_DUMP_SECTIONS_UNSUPPORTED')
  const seen = new Set()
  return markers.map((match, index) => {
    const source = match[1]
    need(/^\/[A-Za-z0-9_./-]+$/.test(source) && !seen.has(source), 'CONFIG_SOURCE_PATH_UNSUPPORTED')
    seen.add(source)
    const begin = match.index + match[0].length
    const end = index + 1 < markers.length ? markers[index + 1].index : text.length
    const bytes = readFile(source)
    const tail = dump.subarray(begin + bytes.length, end)
    need(dump.subarray(begin, begin + bytes.length).equals(bytes) && /^\n{1,2}$/.test(tail.toString('latin1')), 'CONFIG_DUMP_DISK_MISMATCH')
    return { source, bytes, begin, tree: parse(bytes) }
  })
}
function candidate(dump, readFile = fs.readFileSync, realpath = fs.realpathSync) {
  const files = sections(dump, readFile)
  const matches = files.flatMap(file => walk(file.tree).filter(node => node.entries && node.args.length === 1 && node.args[0] === 'server').map(server => ({ file, server })))
    .filter(({ server }) => directives(server, 'server_name').some(d => d.args.slice(1).includes(HOST)) && directives(server, 'listen').some(d => d.args[1] === '443' && d.args.includes('ssl')))
  need(matches.length === 1, 'TARGET_TLS_SERVER_NOT_UNIQUE')
  const { file, server } = matches[0]
  const names = directives(server, 'server_name').flatMap(d => d.args.slice(1))
  need(names.length === 1 && names[0] === HOST, 'TARGET_SERVER_NAMES_UNSUPPORTED')
  const listeners = directives(server, 'listen')
  need(listeners.length === 1 && listeners[0].args[1] === '443' && listeners[0].args.includes('ssl'), 'TARGET_LISTENERS_UNSUPPORTED')
  const targetPath = realpath(file.source)
  need(/^\/[A-Za-z0-9_./-]+$/.test(targetPath), 'TARGET_CANONICAL_PATH_UNSUPPORTED')
  need(files.filter(f => realpath(f.source) === targetPath).length === 1, 'TARGET_SOURCE_ALIAS_AMBIGUOUS')
  const proxyCount = walk(server).filter(n => n.args[0] === 'proxy_pass' && /^http:\/\/127\.0\.0\.1:3000\/?$/.test(n.args[1] || '')).length
  need(proxyCount > 0, 'TARGET_LOOPBACK_PROXY_NOT_FOUND')
  const locations = server.entries.filter(n => n.entries && n.args[0] === 'location')
  const rules = locations.filter(n => n.args.join(' ') === 'location ~* ^/api/admin' && n.entries.length === 1 && n.entries[0].args.join(' ') === 'return 403' && !n.entries[0].entries)
  const blockers = new Set()
  const safeDirect = new Set(['listen', 'server_name', 'ssl_certificate', 'ssl_certificate_key', 'ssl_protocols', 'ssl_ciphers', 'ssl_prefer_server_ciphers', 'ssl_session_cache', 'ssl_session_timeout', 'ssl_session_tickets', 'ssl_dhparam', 'ssl_stapling', 'ssl_stapling_verify', 'ssl_trusted_certificate', 'resolver', 'resolver_timeout', 'access_log', 'error_log', 'client_max_body_size', 'charset', 'root', 'index'])
  for (const n of server.entries) {
    if (n.entries && n.args[0] !== 'location') blockers.add('SERVER_BLOCK_UNSUPPORTED')
    if (!n.entries && !safeDirect.has(n.args[0])) blockers.add('SERVER_DIRECTIVE_UNSUPPORTED')
  }
  for (const n of walk(server)) {
    if (n.args[0] === 'include') blockers.add('SERVER_INCLUDE_REQUIRES_REVIEW')
    if (n !== server && n.entries && n.args[0] === 'location' && !locations.includes(n)) blockers.add('NESTED_LOCATION_REQUIRES_REVIEW')
  }
  for (const n of locations) {
    if (n.args[1] === '=' || n.args[1] === '^~') blockers.add('LOCATION_PRECEDENCE_REQUIRES_REVIEW')
    if (n.args.length !== 2 && !(n.args.length === 3 && ['~', '~*'].includes(n.args[1]))) blockers.add('LOCATION_SHAPE_UNSUPPORTED')
    if (n.args[1]?.startsWith('@')) blockers.add('NAMED_LOCATION_REQUIRES_REVIEW')
  }
  for (const f of files) for (const n of walk(f.tree)) {
    if (n.args[0] === 'error_page' && n.args.slice(1).includes('403')) blockers.add('ERROR_PAGE_403_REQUIRES_REVIEW')
  }
  if (rules.length > 1) blockers.add('DUPLICATE_DENY_RULE')
  if (rules.length === 1 && locations[0] !== rules[0]) blockers.add('EXISTING_RULE_ORDER_REQUIRES_REVIEW')
  let patched = null, patchedDump = null, insertion = null
  if (!blockers.size && !rules.length) {
    const text = file.bytes.toString('latin1')
    const line = text.lastIndexOf('\n', server.start) + 1
    const base = text.slice(line, server.start)
    need(/^[ \t]*$/.test(base), 'SERVER_FORMAT_UNSUPPORTED')
    const newline = text.includes('\r\n') ? '\r\n' : '\n'
    const first = server.entries[0]
    const firstLine = first ? text.lastIndexOf('\n', first.start) + 1 : -1
    const indent = firstLine >= 0 ? text.slice(firstLine, first.start) : ''
    const padding = /^[ \t]+$/.test(indent) ? indent : base + '    '
    insertion = Buffer.from(newline + padding + RULE, 'ascii')
    const offset = server.open + 1
    patched = Buffer.concat([file.bytes.subarray(0, offset), insertion, file.bytes.subarray(offset)])
    patchedDump = Buffer.concat([dump.subarray(0, file.begin + offset), insertion, dump.subarray(file.begin + offset)])
    need(parse(patched).entries.length === file.tree.entries.length, 'PATCH_STRUCTURE_CHANGED')
    need(patched.subarray(0, offset).equals(file.bytes.subarray(0, offset)) && patched.subarray(offset + insertion.length).equals(file.bytes.subarray(offset)), 'PATCH_NOT_SINGLE_INSERTION')
  }
  return { files, file, server, targetPath, patched, patchedDump, insertion, alreadyPatched: rules.length === 1, blockers: [...blockers], metadata: { host: HOST, listenPort: 443, tls: true, proxy: '127.0.0.1:3000', locationCount: locations.length } }
}
function summary(c, dump, runtimeSha256) {
  return { targetSource: c.file.source, targetPath: c.targetPath, fileSha256: hash(c.file.bytes), fullConfigSha256: hash(dump), patchedFileSha256: c.patched && hash(c.patched), patchedFullConfigSha256: c.patchedDump && hash(c.patchedDump), runtimeSha256, server: c.metadata, alreadyPatched: c.alreadyPatched, blockers: c.blockers, insertion: c.insertion?.toString('ascii') || null }
}
function command(args) {
  const result = spawnSync(NGINX, args, { timeout: 10000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  need(!result.error && result.status === 0, args[0] === '-s' ? 'NGINX_RELOAD_FAILED' : 'NGINX_VALIDATION_FAILED')
  need(!/\[(?:warn|emerg|alert)\]/.test(result.stderr.toString('utf8')), 'NGINX_WARNINGS_REQUIRE_REVIEW')
  return result.stdout
}
function runtime() {
  need(process.platform === 'linux' && process.getuid() === 0 && Number(process.versions.node.split('.')[0]) === 26, 'ROOT_LINUX_NODE26_REQUIRED')
  const built = spawnSync(NGINX, ['-V'], { timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  need(!built.error && built.status === 0 && /^nginx version: nginx\/1\.18\.0(?: \(Ubuntu\))?\r?\n/.test(built.stderr) && /(?:^|\s)--conf-path=\/etc\/nginx\/nginx\.conf(?:\s|$)/.test(built.stderr) && /(?:^|\s)--pid-path=\/run\/nginx\.pid(?:\s|$)/.test(built.stderr), 'NGINX_COMPILED_DEFAULTS_UNREVIEWED')
  const pidText = fs.readFileSync('/run/nginx.pid', 'ascii').trim()
  need(/^[1-9][0-9]*$/.test(pidText), 'NGINX_PID_UNSUPPORTED')
  const pid = Number(pidText)
  const exe = fs.realpathSync(`/proc/${pid}/exe`)
  need(exe === fs.realpathSync(NGINX), 'NGINX_MASTER_BINARY_MISMATCH')
  need(/^Uid:\s+0\s+0\s+0\s+0$/m.test(fs.readFileSync(`/proc/${pid}/status`, 'ascii')), 'NGINX_MASTER_NOT_ROOT')
  const cmd = fs.readFileSync(`/proc/${pid}/cmdline`).toString('utf8').replace(/\0+$/, '').trim()
  need(['nginx: master process /usr/sbin/nginx', 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;'].includes(cmd), 'NGINX_MASTER_COMMAND_UNREVIEWED')
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'ascii')
  const startTime = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
  need(/^[0-9]+$/.test(startTime), 'NGINX_MASTER_IDENTITY_UNSUPPORTED')
  return hash(JSON.stringify({ pid, startTime, cmd, binarySha256: hash(fs.readFileSync(NGINX)) }))
}
function probe(where, pathname) {
  return new Promise(resolve => {
    const tls = where !== 'backend'
    const transport = tls ? https : http
    const request = transport.request({ hostname: where === 'public' ? HOST : '127.0.0.1', port: tls ? 443 : 3000, servername: tls ? HOST : undefined, method: 'HEAD', path: pathname, headers: { Host: HOST }, rejectUnauthorized: true, agent: false }, response => {
      response.resume()
      response.on('end', () => { clearTimeout(timer); resolve({ where, method: 'HEAD', pathname, status: response.statusCode }) })
      response.on('error', () => { clearTimeout(timer); resolve({ where, method: 'HEAD', pathname, status: null }) })
    })
    const timer = setTimeout(() => request.destroy(), 5000)
    request.on('error', () => { clearTimeout(timer); resolve({ where, method: 'HEAD', pathname, status: null }) })
    request.end()
  })
}
async function probes(adminStatus, probeFn = probe) {
  const results = []
  for (const where of ['loopback-tls', 'public', 'backend']) {
    const paths = where === 'backend' || adminStatus === 401 ? ['/api/health', '/api/admin'] : ['/api/health', ...ADMIN]
    for (const pathname of paths) results.push(await probeFn(where, pathname))
  }
  return { ok: results.every(r => r.status === (r.pathname === '/api/health' ? 200 : r.where === 'backend' ? 401 : adminStatus)), results }
}
function metadata(file) {
  const python = `import json, os, sys\np = sys.argv[1]\npaths = [p]\nd = os.path.dirname(p)\nwhile True:\n paths.append(d)\n if d == '/': break\n d = os.path.dirname(d)\nfor root in ['/var', '/var/backups', '/var/backups/binwak-nginx-admin']:\n if os.path.exists(root) and root not in paths: paths.append(root)\nrows = [{'path': x, 'xattrCount': len(os.listxattr(x, follow_symlinks=False)), 'rootSafe': os.lstat(x).st_uid == 0 and not (os.lstat(x).st_mode & 0o022)} for x in paths]\nprint(json.dumps({'entries': rows, 'selinuxMounted': os.path.exists('/sys/fs/selinux/enforce')}))\n`
  const result = spawnSync('/usr/bin/python3', ['-c', python, file], { encoding: 'utf8', timeout: 5000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] })
  need(!result.error && result.status === 0, 'FILE_METADATA_INSPECTION_FAILED')
  let value
  try { value = JSON.parse(result.stdout) } catch { fail('FILE_METADATA_INSPECTION_FAILED') }
  need(Array.isArray(value.entries) && value.entries.length > 1 && value.entries.every(row => Number.isInteger(row.xattrCount) && row.xattrCount === 0 && row.rootSafe === true) && value.selinuxMounted === false, 'EXTENDED_METADATA_REQUIRES_REVIEW')
  return value
}
function trustedFile(file) {
  const stat = fs.lstatSync(file)
  need(stat.isFile() && stat.uid === 0 && !(stat.mode & 0o022) && stat.nlink === 1, 'TARGET_FILE_PERMISSIONS_UNSAFE')
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    const parent = fs.lstatSync(directory)
    need(parent.isDirectory() && parent.uid === 0 && !(parent.mode & 0o022), 'TARGET_DIRECTORY_PERMISSIONS_UNSAFE')
    if (directory === '/') break
  }
  metadata(file)
  return stat
}
function sameFile(file, bytes, stat) {
  const now = fs.lstatSync(file)
  need(now.isFile() && now.dev === stat.dev && now.ino === stat.ino && now.uid === stat.uid && now.gid === stat.gid && now.mode === stat.mode && now.nlink === 1 && fs.readFileSync(file).equals(bytes), 'TARGET_FILE_CHANGED')
}
function atomicWrite(file, bytes, stat) {
  const temporary = path.join(path.dirname(file), `.binwak-nginx-${crypto.randomUUID()}.tmp`)
  let fd
  try {
    fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600)
    fs.writeFileSync(fd, bytes)
    fs.fchownSync(fd, stat.uid, stat.gid)
    fs.fchmodSync(fd, stat.mode & 0o7777)
    fs.fsyncSync(fd)
    fs.closeSync(fd); fd = undefined
    fs.renameSync(temporary, file)
    const directory = fs.openSync(path.dirname(file), 'r')
    try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}
function privateDirectory(directory, create = true) {
  if (create && !fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 })
  const stat = fs.lstatSync(directory)
  need(stat.isDirectory() && stat.uid === 0 && (stat.mode & 0o777) === 0o700, 'BACKUP_DIRECTORY_UNSAFE')
}
function backup(c, binding, stat, base = BACKUPS) {
  privateDirectory(base)
  const directory = path.join(base, binding.fileSha256)
  privateDirectory(directory)
  const file = path.join(directory, 'original.conf')
  const metadata = { targetPath: c.targetPath, fileSha256: binding.fileSha256, fullConfigSha256: binding.fullConfigSha256, patchedFileSha256: binding.patchedFileSha256, patchedFullConfigSha256: binding.patchedFullConfigSha256, uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o7777 }
  if (!fs.existsSync(file)) {
    const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600)
    try { fs.writeFileSync(fd, c.file.bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    const metadataFd = fs.openSync(path.join(directory, 'metadata.json'), fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600)
    try { fs.writeFileSync(metadataFd, JSON.stringify(metadata) + '\n'); fs.fsyncSync(metadataFd) } finally { fs.closeSync(metadataFd) }
    for (const entry of [directory, base, path.dirname(base)]) {
      const directoryFd = fs.openSync(entry, 'r')
      try { fs.fsyncSync(directoryFd) } finally { fs.closeSync(directoryFd) }
    }
  }
  return loadBackup(binding, base)
}
function loadBackup(binding, base = BACKUPS) {
  privateDirectory(base, false)
  const directory = path.join(base, binding.fileSha256)
  privateDirectory(directory, false)
  const file = path.join(directory, 'original.conf')
  for (const entry of [file, path.join(directory, 'metadata.json')]) {
    const stat = fs.lstatSync(entry)
    need(stat.isFile() && stat.uid === 0 && (stat.mode & 0o777) === 0o600 && stat.nlink === 1, 'BACKUP_FILE_UNSAFE')
  }
  const bytes = fs.readFileSync(file)
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json'), 'utf8'))
  for (const key of ['targetPath', 'fileSha256', 'fullConfigSha256', 'patchedFileSha256', 'patchedFullConfigSha256']) need(metadata[key] === binding[key], 'BACKUP_BINDING_MISMATCH')
  need(hash(bytes) === binding.fileSha256, 'BACKUP_HASH_MISMATCH')
  return { file, bytes, metadata }
}
function bindings(args) {
  const [action, targetPath, fileSha256, fullConfigSha256, patchedFileSha256, patchedFullConfigSha256, runtimeSha256, approval] = args
  need(['inspect', 'apply', 'verify', 'rollback'].includes(action), 'ACTION_NOT_ALLOWED')
  if (action === 'inspect') { need(args.length === 1, 'INSPECT_TAKES_NO_BINDINGS'); return { action } }
  need(args.length === 8 && /^\/etc\/nginx\/[A-Za-z0-9_./-]+$/.test(targetPath) && !targetPath.split('/').includes('..'), 'BINDINGS_INVALID')
  for (const digest of [fileSha256, fullConfigSha256, patchedFileSha256, patchedFullConfigSha256, runtimeSha256]) need(/^[a-f0-9]{64}$/.test(digest), 'BINDINGS_INVALID')
  need(fileSha256 !== patchedFileSha256 && fullConfigSha256 !== patchedFullConfigSha256 && approval === 'approved-minimal-admin-deny', 'APPROVAL_REQUIRED')
  return { action, targetPath, fileSha256, fullConfigSha256, patchedFileSha256, patchedFullConfigSha256, runtimeSha256 }
}
function driver() {
  return { capture: () => command(['-T']), validate: () => command(['-t']), reload: () => command(['-s', 'reload']), runtime, probe, atomicWrite, backup, loadBackup, trustedFile, sameFile, read: fs.readFileSync }
}
async function transaction(c, dump, binding, d) {
  need(c.targetPath === binding.targetPath && !c.blockers.length, 'TARGET_NOT_APPROVED')
  const fileDigest = hash(c.file.bytes), fullDigest = hash(dump)
  const state = fileDigest === binding.fileSha256 && fullDigest === binding.fullConfigSha256 ? 'original' : fileDigest === binding.patchedFileSha256 && fullDigest === binding.patchedFullConfigSha256 ? 'patched' : 'unexpected'
  need(state !== 'unexpected', 'EXPECTED_HASH_MISMATCH')
  need(d.runtime() === binding.runtimeSha256, 'NGINX_MASTER_CHANGED')
  if (binding.action === 'verify' || state === 'patched' && binding.action === 'apply') {
    need(state === 'patched' && c.alreadyPatched, 'PATCH_NOT_PRESENT')
    const saved = d.loadBackup(binding)
    const stat = d.trustedFile(c.targetPath)
    need(stat.uid === saved.metadata.uid && stat.gid === saved.metadata.gid && (stat.mode & 0o7777) === saved.metadata.mode, 'BACKUP_MODE_MISMATCH')
    d.validate()
    const observed = await probes(403, d.probe)
    need(observed.ok, 'PATCH_VERIFICATION_FAILED')
    need(hash(d.capture()) === binding.patchedFullConfigSha256 && d.runtime() === binding.runtimeSha256, 'STATE_CHANGED_DURING_VERIFICATION')
    return { result: 'verified', action: binding.action, mutated: false, fullConfigSha256: fullDigest, probes: observed.results }
  }
  if (binding.action === 'apply') need(state === 'original' && c.patched && hash(c.patched) === binding.patchedFileSha256 && hash(c.patchedDump) === binding.patchedFullConfigSha256, 'PATCH_PLAN_MISMATCH')
  else need(binding.action === 'rollback' && state === 'patched', 'ROLLBACK_STATE_UNSUPPORTED')
  if (binding.action === 'apply') {
    const before = await probes(401, d.probe)
    need(before.ok, 'BASELINE_PROBES_FAILED')
  }
  const stat = d.trustedFile(c.targetPath)
  const saved = binding.action === 'apply' ? d.backup(c, binding, stat) : d.loadBackup(binding)
  need(stat.uid === saved.metadata.uid && stat.gid === saved.metadata.gid && (stat.mode & 0o7777) === saved.metadata.mode, 'BACKUP_MODE_MISMATCH')
  const newBytes = binding.action === 'apply' ? c.patched : saved.bytes
  const expectedDump = binding.action === 'apply' ? c.patchedDump : Buffer.concat([dump.subarray(0, c.file.begin), saved.bytes, dump.subarray(c.file.begin + c.file.bytes.length)])
  const expectedHash = binding.action === 'apply' ? binding.patchedFullConfigSha256 : binding.fullConfigSha256
  need(hash(expectedDump) === expectedHash, 'EXPECTED_DUMP_MISMATCH')
  need(hash(d.capture()) === fullDigest && d.runtime() === binding.runtimeSha256, 'STATE_CHANGED_BEFORE_WRITE')
  d.sameFile(c.targetPath, c.file.bytes, stat)
  let written = false, reloadAttempted = false
  try {
    // A write may commit its rename before directory fsync fails.
    written = true
    d.atomicWrite(c.targetPath, newBytes, stat)
    need(d.read(c.targetPath).equals(newBytes), 'WRITE_READBACK_MISMATCH')
    d.validate()
    need(d.capture().equals(expectedDump) && d.runtime() === binding.runtimeSha256, 'GLOBAL_CONFIG_CHANGED')
    reloadAttempted = true
    d.reload()
    let observed
    for (let attempt = 0; attempt < 3; attempt++) {
      observed = await probes(binding.action === 'apply' ? 403 : 401, d.probe)
      if (observed.ok) break
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    need(observed.ok, 'POST_RELOAD_PROBES_FAILED')
    need(hash(d.capture()) === expectedHash && d.runtime() === binding.runtimeSha256, 'STATE_CHANGED_AFTER_RELOAD')
    return { result: binding.action === 'apply' ? 'applied' : 'rolled-back', action: binding.action, mutated: true, backup: saved.file, fullConfigSha256: expectedHash, probes: observed.results }
  } catch (error) {
    let recovery = 'not-written'
    if (written) {
      try {
        const current = d.read(c.targetPath)
        need(current.equals(newBytes) || current.equals(saved.bytes), 'RECOVERY_TARGET_CHANGED')
        d.atomicWrite(c.targetPath, saved.bytes, stat)
        need(d.read(c.targetPath).equals(saved.bytes), 'RECOVERY_READBACK_FAILED')
        d.validate()
        need(hash(d.capture()) === binding.fullConfigSha256, 'RECOVERY_GLOBAL_CONFIG_CHANGED')
        if (reloadAttempted || binding.action === 'rollback') {
          need(d.runtime() === binding.runtimeSha256, 'RECOVERY_MASTER_CHANGED')
          d.reload()
        }
        const recovered = await probes(401, d.probe)
        need(recovered.ok, 'RECOVERY_PROBES_FAILED')
        recovery = 'original-restored-and-verified'
      } catch { recovery = 'failed-operator-required' }
    }
    return { result: 'failed', action: binding.action, mutated: written, error: safeError(error), recovery, backup: saved.file }
  }
}
function safeError(error) { return /^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'NGINX_PACKET_FAILED' }
async function main(args = process.argv.slice(2)) {
  const binding = bindings(args)
  const d = driver()
  const identity = d.runtime()
  const dump = d.capture()
  const c = candidate(dump)
  need(c.files.some(f => f.source === MAIN), 'DEFAULT_MAIN_CONFIG_NOT_FOUND')
  need(c.targetPath.startsWith('/etc/nginx/'), 'TARGET_OUTSIDE_NGINX_CONFIG')
  for (const f of c.files) for (const n of walk(f.tree)) if (n.args[0] === 'pid') need(n.args.length === 2 && n.args[1] === '/run/nginx.pid', 'CUSTOM_NGINX_PID_UNSUPPORTED')
  if (binding.action === 'inspect') {
    const stat = d.trustedFile(c.targetPath)
    const fileMetadata = { uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o7777, linkCount: stat.nlink, extendedMetadataAbsent: true }
    const observed = await probes(c.alreadyPatched ? 403 : 401, d.probe)
    const report = { fileMetadata, result: 'inspected', action: 'inspect', mutated: false, ...summary(c, dump, identity), baselinePassed: observed.ok, probes: observed.results }
    console.log(JSON.stringify(report, null, 2))
    return
  }
  const report = await transaction(c, dump, binding, d)
  console.log(JSON.stringify(report, null, 2))
  if (report.result === 'failed') process.exitCode = 1
}
module.exports = { parse, sections, candidate, summary, hash, bindings, probe, probes, atomicWrite, backup, loadBackup, transaction, main, safeError, RULE, ADMIN }
if (require.main === module || module.id === '[stdin]') main().catch(error => { console.error(safeError(error)); process.exitCode = 1 })
