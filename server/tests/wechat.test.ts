import { afterEach, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config'
import { code2Session } from '../src/services/wechat'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

describe('code2Session', () => {
  afterEach(() => {
    fetchMock.mockReset()
  })

  it('URL-encodes the client-supplied code so it cannot inject query params', async () => {
    const originalAppId = config.wx.appId
    config.wx.appId = 'wx-app-id'
    fetchMock.mockResolvedValueOnce({ json: async () => ({ openid: 'o123', session_key: 'k' }) })

    try {
      await code2Session('evil&secret=leak#frag')
    } finally {
      config.wx.appId = originalAppId
    }

    const calledUrl = fetchMock.mock.calls[0][0] as string
    const parsed = new URL(calledUrl)
    // The whole hostile string must land in js_code, not bleed into other params.
    expect(parsed.searchParams.get('js_code')).toBe('evil&secret=leak#frag')
    expect(parsed.searchParams.get('grant_type')).toBe('authorization_code')
    expect(calledUrl).not.toContain('js_code=evil&secret=leak')
  })
})
