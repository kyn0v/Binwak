import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { config } from '../src/config'
import { resetTokenCache } from '../src/services/moderation'
import { authHeader, createTestUser } from './helpers'

// Regression test for outbound-failure handling. The POST /api/feedback handler
// performs an outbound GitHub `fetch` to create an issue. When that fetch
// rejects (network down, DNS failure, timeout), the request must NOT hang and
// must NOT leak a raw stack trace: the handler catches the rejection locally and
// returns a structured 502 (bad upstream gateway). Express 5 would also forward
// an uncaught async rejection to the global errorHandler as a 500, but the
// local catch gives a more accurate status and message for an upstream failure.

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const app = createApp()
const originalGitHubToken = config.github.token
const originalGitHubRepo = config.github.repo

function mockModerationPass() {
  fetchMock
    .mockResolvedValueOnce({
      json: async () => ({ access_token: 'wx-token', expires_in: 7200 }),
    })
    .mockResolvedValueOnce({
      json: async () => ({ errcode: 0, result: { suggest: 'pass', label: 100 } }),
    })
}

describe('async error forwarding', () => {
  beforeEach(() => {
    resetTokenCache()
    fetchMock.mockReset()
    config.github.token = 'test-gh-token'
    config.github.repo = 'test-owner/test-repo'
  })

  afterEach(() => {
    config.github.token = originalGitHubToken
    config.github.repo = originalGitHubRepo
  })

  it('handles an outbound GitHub fetch rejection with a structured 502 (not a hang)', async () => {
    const { token } = createTestUser('async-err-openid')
    mockModerationPass()
    // The GitHub issue-creation fetch rejects: the handler catches it locally
    // and responds with a 502 instead of hanging or leaking a stack trace.
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', authHeader(token))
      .send({ type: 'bug', title: '标题', content: '内容内容' })

    expect(res.status).toBe(502)
    expect(res.body.success).toBe(false)
  })
})
