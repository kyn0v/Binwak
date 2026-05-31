import { describe, it, expect } from 'vitest'
import { validateWebhookUrl } from '../src/utils/urlSafety'

describe('validateWebhookUrl', () => {
  it('accepts public https URL', () => {
    expect(validateWebhookUrl('https://example.com/hook')).toBeNull()
  })

  it('rejects non-http schemes', () => {
    expect(validateWebhookUrl('ftp://example.com')).not.toBeNull()
    expect(validateWebhookUrl('file:///etc/passwd')).not.toBeNull()
    expect(validateWebhookUrl('javascript:alert(1)')).not.toBeNull()
  })

  it('rejects http when allowHttp=false', () => {
    expect(validateWebhookUrl('http://example.com', { allowHttp: false })).not.toBeNull()
    expect(validateWebhookUrl('https://example.com', { allowHttp: false })).toBeNull()
  })

  it('rejects localhost variants', () => {
    expect(validateWebhookUrl('http://localhost/hook')).not.toBeNull()
    expect(validateWebhookUrl('http://foo.localhost/hook')).not.toBeNull()
    expect(validateWebhookUrl('http://service.local/hook')).not.toBeNull()
  })

  it('rejects loopback IPv4', () => {
    expect(validateWebhookUrl('http://127.0.0.1/x')).not.toBeNull()
    expect(validateWebhookUrl('http://127.5.5.5/x')).not.toBeNull()
  })

  it('rejects link-local / metadata IP', () => {
    expect(validateWebhookUrl('http://169.254.169.254/latest/meta-data/')).not.toBeNull()
  })

  it('rejects private RFC1918 ranges', () => {
    expect(validateWebhookUrl('http://10.0.0.1/x')).not.toBeNull()
    expect(validateWebhookUrl('http://192.168.1.1/x')).not.toBeNull()
    expect(validateWebhookUrl('http://172.16.0.1/x')).not.toBeNull()
    expect(validateWebhookUrl('http://172.31.255.1/x')).not.toBeNull()
  })

  it('accepts non-private 172.x.x.x', () => {
    expect(validateWebhookUrl('http://172.32.0.1/x')).toBeNull()
    expect(validateWebhookUrl('http://172.15.0.1/x')).toBeNull()
  })

  it('rejects CGNAT 100.64/10', () => {
    expect(validateWebhookUrl('http://100.64.0.1/x')).not.toBeNull()
    expect(validateWebhookUrl('http://100.127.255.1/x')).not.toBeNull()
  })

  it('rejects multicast / 0.0.0.0', () => {
    expect(validateWebhookUrl('http://0.0.0.0/x')).not.toBeNull()
    expect(validateWebhookUrl('http://224.0.0.1/x')).not.toBeNull()
  })

  it('rejects userinfo in URL', () => {
    expect(validateWebhookUrl('https://user:pass@example.com')).not.toBeNull()
  })

  it('rejects loopback IPv6', () => {
    expect(validateWebhookUrl('http://[::1]/x')).not.toBeNull()
    expect(validateWebhookUrl('http://[fe80::1]/x')).not.toBeNull()
    expect(validateWebhookUrl('http://[fd00::1]/x')).not.toBeNull()
  })

  it('rejects IPv4-mapped IPv6 to private space', () => {
    expect(validateWebhookUrl('http://[::ffff:127.0.0.1]/x')).not.toBeNull()
    expect(validateWebhookUrl('http://[::ffff:169.254.169.254]/x')).not.toBeNull()
  })

  it('rejects malformed URL', () => {
    expect(validateWebhookUrl('not a url')).not.toBeNull()
    expect(validateWebhookUrl('')).not.toBeNull()
  })
})
