const { isIP } = require('node:net')

try {
  const value = process.env.VITE_API_BASE_URL
  if (!value || value.trim() !== value) throw new Error('set VITE_API_BASE_URL explicitly')
  const url = new URL(value)
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const ipv4 = isIP(host) === 4
  if (url.protocol !== 'https:' || !host || url.username || url.password || url.hash || url.search) {
    throw new Error('use an HTTPS API URL without credentials, query, or fragment')
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '[::]' ||
      host.startsWith('[::ffff:') || (ipv4 && (host.startsWith('127.') || host.startsWith('0.')))) {
    throw new Error('localhost and loopback API targets cannot be uploaded')
  }
} catch (error) {
  console.error(`Invalid production API target. ${error.message}`)
  process.exitCode = 1
}
