/**
 * URL safety helpers — guard against SSRF on webhook URLs and other
 * outbound requests built from user/admin input.
 *
 * Rejects:
 *   - non-http(s) schemes
 *   - hostnames that resolve to loopback / private / link-local /
 *     CGNAT / multicast / reserved IP ranges (literal IP form only;
 *     DNS-rebinding attacks would require runtime resolution)
 *   - common metadata service IPs (169.254.169.254 etc.)
 *
 * NOTE: This validates literal hostnames at parse time. For full SSRF
 * defence, also pin DNS resolution at fetch time (not done here).
 */

import net from 'net'

export interface UrlSafetyOptions {
  /** Whether to allow http:// (defaults to true for dev; set false in prod). */
  allowHttp?: boolean
}

/** Parse and validate a webhook URL. Returns null on success, error message otherwise. */
export function validateWebhookUrl(input: string, opts: UrlSafetyOptions = {}): string | null {
  if (typeof input !== 'string' || input.length === 0) return 'URL 不能为空'
  if (input.length > 2048) return 'URL 过长'

  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return 'URL 格式无效'
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return '仅支持 http/https 协议'
  }
  if (parsed.protocol === 'http:' && opts.allowHttp === false) {
    return '仅支持 https 协议'
  }

  if (parsed.username || parsed.password) {
    return 'URL 不能包含 userinfo'
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return 'URL 缺少主机名'

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return '禁止指向本地主机'
  }

  const ipVersion = net.isIP(host)
  if (ipVersion === 4 && isPrivateOrReservedIPv4(host)) {
    return '禁止指向内网或保留 IP'
  }
  if (ipVersion === 6 && isPrivateOrReservedIPv6(host)) {
    return '禁止指向内网或保留 IPv6'
  }

  return null
}

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true
  }
  const [a, b] = parts
  if (a === 10) return true                              // 10.0.0.0/8
  if (a === 127) return true                             // loopback
  if (a === 0) return true                               // 0.0.0.0/8
  if (a === 169 && b === 254) return true                // link-local + AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true       // 172.16.0.0/12
  if (a === 192 && b === 168) return true                // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true      // CGNAT 100.64.0.0/10
  if (a >= 224) return true                              // multicast + reserved
  return false
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fe80:')) return true   // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique-local fc00::/7
  if (lower.startsWith('ff')) return true      // multicast
  // ::ffff:a.b.c.d (IPv4-mapped, dotted form) — reuse v4 check
  if (lower.startsWith('::ffff:')) {
    const tail = lower.slice(7)
    if (net.isIP(tail) === 4) return isPrivateOrReservedIPv4(tail)
    // Hex form like ::ffff:7f00:1 (canonical IPv4-mapped) — reconstruct dotted quad
    const hextets = tail.split(':')
    if (hextets.length === 2) {
      const high = parseInt(hextets[0], 16)
      const low = parseInt(hextets[1], 16)
      if (!Number.isNaN(high) && !Number.isNaN(low)) {
        const dotted = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
        return isPrivateOrReservedIPv4(dotted)
      }
    }
  }
  return false
}
