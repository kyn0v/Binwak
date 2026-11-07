'use strict'
const fs = require('node:fs')
const crypto = require('node:crypto')
const http = require('node:http')
const https = require('node:https')
const { execFileSync } = require('node:child_process')

function blocks(text) {
  const root = { header: '', children: [], directives: [] }
  const stack = [root]
  let buffer = '', quote = '', comment = false, escaped = false
  for (const char of text) {
    if (comment) { if (char === '\n') comment = false; continue }
    if (escaped) { buffer += char; escaped = false; continue }
    if (char === '\\') { buffer += char; escaped = true; continue }
    if (quote) { buffer += char; if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") { buffer += char; quote = char; continue }
    if (char === '#') { comment = true; continue }
    if (char === '{') {
      const next = { header: buffer.trim(), children: [], directives: [] }
      stack.at(-1).children.push(next); stack.push(next); buffer = ''
    } else if (char === '}') {
      if (stack.length === 1 || buffer.trim()) throw Error('INVALID_CONFIG_STRUCTURE')
      stack.pop(); buffer = ''
    } else if (char === ';') { stack.at(-1).directives.push(buffer.trim()); buffer = '' }
    else buffer += char
  }
  if (stack.length !== 1 || quote) throw Error('INVALID_CONFIG_STRUCTURE')
  return root
}
function walk(node) { return [node, ...node.children.flatMap(walk)] }
function inventory(text) {
  const servers = walk(blocks(text)).filter(node => node.header === 'server')
  return servers.filter(server => walk(server).some(node => node.directives.some(line => /^proxy_pass\s+http:\/\/(?:127\.0\.0\.1|localhost):3000(?:\/|$)/.test(line)))).map(server => {
    const names = server.directives.filter(line => line.startsWith('server_name ')).flatMap(line => line.slice(12).split(/\s+/)).filter(name => /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(name))
    const listeners = server.directives.filter(line => line.startsWith('listen ')).map(line => {
      const endpoint = line.split(/\s+/)[1]
      const port = Number(endpoint.split(':').at(-1))
      return { port, tls: /(?:^|\s)ssl(?:\s|$)/.test(line), defaultServer: /(?:^|\s)default_server(?:\s|$)/.test(line) }
    }).filter(item => item.port === 80 || item.port === 443)
    const adminRules = walk(server).filter(node => /^location\s/.test(node.header) && /\/api\/admin/i.test(node.header)).map(node => ({
      caseInsensitive: /^location\s+~\*/.test(node.header),
      denyAll: node.directives.includes('deny all'),
      returns403: node.directives.some(line => /^return 403(?:\s|$)/.test(line)),
    }))
    return { names, listeners, adminRules }
  })
}
function probe({ host, port, tls, method, pathname }) {
  return new Promise(resolve => {
    const transport = tls ? https : http
    const request = transport.request({ hostname: '127.0.0.1', port, servername: host, method, path: pathname, headers: { Host: host }, timeout: 5000, rejectUnauthorized: true }, response => {
      response.resume()
      response.on('end', () => resolve({ host, port, tls, method, pathname, status: response.statusCode, redirects: [301, 302, 307, 308].includes(response.statusCode) }))
    })
    request.on('timeout', () => request.destroy(Error('PROBE_TIMEOUT')))
    request.on('error', error => resolve({ host, port, tls, method, pathname, error: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'PROBE_FAILED' }))
    request.end()
  })
}
async function main() {
  let output
  try { output = execFileSync('nginx', ['-T'], { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch { throw Error('NGINX_CONFIG_INSPECTION_FAILED') }
  const servers = inventory(output)
  const report = { configSha256: crypto.createHash('sha256').update(output).digest('hex'), servers, probes: [] }
  if (!servers.length) throw Error('NO_LOOPBACK_BINWAK_PROXY_FOUND')
  if (servers.length > 10) throw Error('TOO_MANY_BINWAK_PROXY_BLOCKS')
  for (const server of servers) {
    const host = server.names[0] || 'localhost'
    for (const listener of server.listeners) {
      for (const pathname of ['/api/health', '/api/admin', '/api/ADMIN', '/API/AdMiN', '/api/admin/login', '/api/ADMIN/login']) {
        report.probes.push(await probe({ host, ...listener, method: 'HEAD', pathname }))
      }
    }
  }
  console.log(JSON.stringify(report, null, 2))
}
module.exports = { blocks, inventory, probe, main }
if (require.main === module || module.id === '[stdin]') main().catch(error => { console.error(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'NGINX_INSPECTION_FAILED'); process.exitCode = 1 })
