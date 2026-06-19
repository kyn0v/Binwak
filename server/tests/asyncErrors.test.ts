import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { config } from '../src/config'
import { resetTokenCache } from '../src/services/moderation'
import { authHeader, createTestUser } from './helpers'

// Regression test for the Express 4 async-error-forwarding fix.
// An unexpected rejection thrown inside an `async` route handler (here, the
// outbound GitHub `fetch` in POST /api/feedback) must reach the global
// errorHandler and produce a structured 500 — instead of hanging the request.

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

  it('forwards an async handler rejection to the global error handler (500, not a hang)', async () => {
    const { token } = createTestUser('async-err-openid')
    mockModerationPass()
    // The GitHub issue-creation fetch rejects: the handler awaits it with no
    // local try/catch, so the rejection must be caught by errorHandler.
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', authHeader(token))
      .send({ type: 'bug', title: '标题', content: '内容内容' })

    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
  })
})
