/**
 * TDD: content moderation service tests.
 * Covers access_token caching, text moderation, and image moderation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock global fetch before importing the module
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// Mock fs for checkImageSync tests (hoisted to avoid reference error)
const fsMock = vi.hoisted(() => ({
  statSync: vi.fn(() => ({ size: 500 * 1024 })),
  readFileSync: vi.fn(() => Buffer.from('fake-image-data')),
}))
vi.mock('fs', () => ({ default: fsMock, ...fsMock }))

// Must import AFTER stubbing fetch
import {
  getAccessToken,
  checkText,
  checkImage,
  checkImageSync,
  resetTokenCache,
  ContentCheckResult,
} from '../src/services/moderation'

beforeEach(() => {
  fetchMock.mockReset()
  resetTokenCache()
})

// ── access_token ──

describe('getAccessToken', () => {
  it('fetches and returns access_token', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'test-token-123', expires_in: 7200 }),
    })

    const token = await getAccessToken()
    expect(token).toBe('test-token-123')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('cgi-bin/token')
  })

  it('caches token on subsequent calls', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'cached-token', expires_in: 7200 }),
    })

    await getAccessToken()
    const token2 = await getAccessToken()
    expect(token2).toBe('cached-token')
    expect(fetchMock).toHaveBeenCalledTimes(1) // only 1 fetch call
  })

  it('throws on WeChat API error', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ errcode: 40013, errmsg: 'invalid appid' }),
    })

    await expect(getAccessToken()).rejects.toThrow('获取 access_token 失败')
  })

  it('re-fetches after cache reset', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'first', expires_in: 7200 }),
    })
    await getAccessToken()

    resetTokenCache()

    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'second', expires_in: 7200 }),
    })
    const token = await getAccessToken()
    expect(token).toBe('second')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// ── Text moderation ──

describe('checkText', () => {
  function mockTokenThenCheck(checkResult: any) {
    // First call: access_token
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'tok', expires_in: 7200 }),
    })
    // Second call: msg_sec_check
    fetchMock.mockResolvedValueOnce({
      json: async () => checkResult,
    })
  }

  it('returns pass for safe content', async () => {
    mockTokenThenCheck({
      errcode: 0,
      errmsg: 'ok',
      result: { suggest: 'pass', label: 100 },
      detail: [{ strategy: 'content_model', suggest: 'pass', label: 100 }],
    })

    const result = await checkText('openid-1', '美丽的城市风景', 3)
    expect(result.pass).toBe(true)
    expect(result.suggest).toBe('pass')
  })

  it('returns risky for prohibited content', async () => {
    mockTokenThenCheck({
      errcode: 0,
      errmsg: 'ok',
      result: { suggest: 'risky', label: 20001 },
      detail: [{ strategy: 'content_model', suggest: 'risky', label: 20001 }],
    })

    const result = await checkText('openid-1', '违规内容', 3)
    expect(result.pass).toBe(false)
    expect(result.suggest).toBe('risky')
    expect(result.label).toBe(20001)
  })

  it('returns review for borderline content', async () => {
    mockTokenThenCheck({
      errcode: 0,
      errmsg: 'ok',
      result: { suggest: 'review', label: 20006 },
    })

    const result = await checkText('openid-1', '边界内容', 3)
    expect(result.pass).toBe(false)
    expect(result.suggest).toBe('review')
  })

  it('sends correct request body', async () => {
    mockTokenThenCheck({
      errcode: 0,
      result: { suggest: 'pass', label: 100 },
    })

    await checkText('my-openid', '测试文本', 2)

    const checkCall = fetchMock.mock.calls[1]
    expect(checkCall[0]).toContain('msg_sec_check')
    const body = JSON.parse(checkCall[1].body)
    expect(body).toEqual({
      openid: 'my-openid',
      scene: 2,
      version: 2,
      content: '测试文本',
    })
  })

  it('retries once on access_token expired (errcode 40001)', async () => {
    // First: get token
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'old-tok', expires_in: 7200 }),
    })
    // Second: check returns 40001 (token expired)
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ errcode: 40001, errmsg: 'invalid access_token' }),
    })
    // Third: re-fetch token
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'new-tok', expires_in: 7200 }),
    })
    // Fourth: retry check — success
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        errcode: 0,
        result: { suggest: 'pass', label: 100 },
      }),
    })

    const result = await checkText('openid-1', '重试测试', 3)
    expect(result.pass).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('returns pass and logs warning on network error (graceful degradation)', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'tok', expires_in: 7200 }),
    })
    fetchMock.mockRejectedValueOnce(new Error('network timeout'))

    // Should not block user — graceful degradation
    const result = await checkText('openid-1', '网络异常', 3)
    expect(result.pass).toBe(true)
    expect(result.suggest).toBe('pass')
    expect(result.error).toBeTruthy()
  })

  it('passes for empty content', async () => {
    const result = await checkText('openid-1', '', 3)
    expect(result.pass).toBe(true)
  })

  it('passes for whitespace-only content', async () => {
    const result = await checkText('openid-1', '   ', 3)
    expect(result.pass).toBe(true)
  })
})

// ── Image moderation ──

describe('checkImage', () => {
  function mockTokenThenCheck(checkResult: any) {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'tok', expires_in: 7200 }),
    })
    fetchMock.mockResolvedValueOnce({
      json: async () => checkResult,
    })
  }

  it('returns trace_id on successful submission', async () => {
    mockTokenThenCheck({
      errcode: 0,
      errmsg: 'ok',
      trace_id: 'trace-abc-123',
    })

    const result = await checkImage('openid-1', 'https://oss.example.com/img.jpg', 3)
    expect(result.submitted).toBe(true)
    expect(result.traceId).toBe('trace-abc-123')
  })

  it('sends correct request body with media_type 2', async () => {
    mockTokenThenCheck({
      errcode: 0,
      trace_id: 'trace-xyz',
    })

    await checkImage('my-openid', 'https://example.com/photo.jpg', 4)

    const checkCall = fetchMock.mock.calls[1]
    expect(checkCall[0]).toContain('media_check_async')
    const body = JSON.parse(checkCall[1].body)
    expect(body).toEqual({
      openid: 'my-openid',
      scene: 4,
      version: 2,
      media_url: 'https://example.com/photo.jpg',
      media_type: 2,
    })
  })

  it('returns not submitted on API error', async () => {
    mockTokenThenCheck({
      errcode: 87014,
      errmsg: 'risky content',
    })

    const result = await checkImage('openid-1', 'https://example.com/bad.jpg', 3)
    expect(result.submitted).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('handles network failure gracefully', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'tok', expires_in: 7200 }),
    })
    fetchMock.mockRejectedValueOnce(new Error('timeout'))

    const result = await checkImage('openid-1', 'https://example.com/img.jpg', 3)
    expect(result.submitted).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

// ── Synchronous image moderation ──

describe('checkImageSync', () => {
  beforeEach(() => {
    fsMock.statSync.mockReturnValue({ size: 500 * 1024 }) // 500KB
    fsMock.readFileSync.mockReturnValue(Buffer.from('fake-image-data'))
  })

  function mockTokenThenCheck(checkResult: any) {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'tok', expires_in: 7200 }),
    })
    fetchMock.mockResolvedValueOnce({
      json: async () => checkResult,
    })
  }

  it('returns pass for safe image', async () => {
    mockTokenThenCheck({ errcode: 0 })

    const result = await checkImageSync('/tmp/test.jpg')
    expect(result.pass).toBe(true)
    expect(result.suggest).toBe('pass')
  })

  it('returns risky for prohibited image (errcode 87014)', async () => {
    mockTokenThenCheck({ errcode: 87014, errmsg: 'risky content' })

    const result = await checkImageSync('/tmp/bad.jpg')
    expect(result.pass).toBe(false)
    expect(result.suggest).toBe('risky')
  })

  it('rejects images > 1MB', async () => {
    fsMock.statSync.mockReturnValue({ size: 2 * 1024 * 1024 }) // 2MB

    const result = await checkImageSync('/tmp/large.jpg')
    expect(result.pass).toBe(false)
    expect(result.suggest).toBe('risky')
    // No fetch calls for token or check
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends multipart/form-data with correct boundary', async () => {
    mockTokenThenCheck({ errcode: 0 })

    await checkImageSync('/tmp/test.jpg')

    const checkCall = fetchMock.mock.calls[1]
    expect(checkCall[0]).toContain('img_sec_check')
    expect(checkCall[1].headers['Content-Type']).toContain('multipart/form-data')
  })

  it('retries once on access_token expired', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'old', expires_in: 7200 }),
    })
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ errcode: 40001, errmsg: 'expired' }),
    })
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'new', expires_in: 7200 }),
    })
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ errcode: 0 }),
    })

    const result = await checkImageSync('/tmp/test.jpg')
    expect(result.pass).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('graceful degradation on network error', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ access_token: 'tok', expires_in: 7200 }),
    })
    fetchMock.mockRejectedValueOnce(new Error('network error'))

    const result = await checkImageSync('/tmp/test.jpg')
    expect(result.pass).toBe(true)
    expect(result.error).toBeTruthy()
  })
})
