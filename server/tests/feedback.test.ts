import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { config } from '../src/config'
import { resetTokenCache } from '../src/services/moderation'
import { authHeader, createTestUser } from './helpers'

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

describe('Feedback API', () => {
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

  it('rejects feedback images outside the current user namespace', async () => {
    const { token, userId } = createTestUser('feedback-user-a')

    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', authHeader(token))
      .send({
        type: 'bug',
        title: '图片归属测试',
        content: '不能引用别人的图片',
        images: [`photos/u${userId + 1}/abc.jpg`],
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('无权')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects feedback image path traversal keys', async () => {
    const { token } = createTestUser('feedback-user-b')

    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', authHeader(token))
      .send({
        type: 'bug',
        title: '非法 key 测试',
        content: '路径穿越应该被拒绝',
        images: ['photos/u1/../../secret.jpg'],
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('不合法')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects more than three feedback images', async () => {
    const { token, userId } = createTestUser('feedback-user-c')

    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', authHeader(token))
      .send({
        type: 'feature',
        title: '图片数量测试',
        content: '最多只能提交三张图',
        images: [1, 2, 3, 4].map((n) => `photos/u${userId}/${n}.jpg`),
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('最多')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits feedback with current user image keys', async () => {
    const { token, userId } = createTestUser('feedback-user-d')
    mockModerationPass()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ html_url: 'https://github.com/test-owner/test-repo/issues/123', number: 123 }),
    })

    const imageKey = `photos/u${userId}/abc.jpg`
    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', authHeader(token))
      .send({
        type: 'bug',
        title: '合法反馈',
        content: '带自己的图片提交反馈',
        images: [imageKey],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.issueNumber).toBe(123)

    const githubCall = fetchMock.mock.calls[2]
    expect(githubCall[0]).toContain('api.github.com')
    expect(JSON.parse(githubCall[1].body).body).toContain(`/uploads/${imageKey}`)
  })
})
