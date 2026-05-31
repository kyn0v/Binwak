/**
 * TDD: content moderation route integration tests.
 * Verifies text moderation integration with template publishing, word bank,
 * nickname, and related endpoints.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { createTestUser, authHeader } from './helpers'

// Mock the moderation service
vi.mock('../src/services/moderation', () => ({
  checkText: vi.fn(),
  checkImage: vi.fn(),
  getAccessToken: vi.fn(),
  resetTokenCache: vi.fn(),
}))

import { checkText, checkImage } from '../src/services/moderation'
const mockCheckText = vi.mocked(checkText)
const mockCheckImage = vi.mocked(checkImage)

const app = createApp()

beforeEach(() => {
  mockCheckText.mockReset()
  mockCheckImage.mockReset()
  // Default: everything passes
  mockCheckText.mockResolvedValue({ pass: true, suggest: 'pass' as const, label: 100 })
  mockCheckImage.mockResolvedValue({ submitted: true, traceId: 'trace-123' })
})

// ── Template publishing text moderation ──

describe('POST /api/templates — text moderation', () => {
  const validTemplate = {
    title: '城市漫步',
    description: '探索城市角落',
    gridSize: 3,
    cells: Array.from({ length: 9 }, (_, i) => ({ position: i, title: `项目${i}` })),
  }

  it('allows template creation when text passes', async () => {
    const { token } = createTestUser()
    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', authHeader(token))
      .send(validTemplate)

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(mockCheckText).toHaveBeenCalled()
  })

  it('blocks template when title is risky', async () => {
    mockCheckText.mockResolvedValue({ pass: false, suggest: 'risky' as const, label: 20001 })
    const { token } = createTestUser()

    const res = await request(app)
      .post('/api/templates')
      .set('Authorization', authHeader(token))
      .send(validTemplate)

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('内容')
  })

  it('passes openid and scene to checkText', async () => {
    const { token, openid } = createTestUser()

    await request(app)
      .post('/api/templates')
      .set('Authorization', authHeader(token))
      .send(validTemplate)

    expect(mockCheckText).toHaveBeenCalledWith(
      openid,
      expect.any(String),
      expect.any(Number),
    )
  })
})

// ── Word bank text moderation ──

describe('POST /api/wordbank — text moderation', () => {
  it('allows word when text passes', async () => {
    const { token } = createTestUser()
    const res = await request(app)
      .post('/api/wordbank')
      .set('Authorization', authHeader(token))
      .send({ word: '咖啡店' })

    expect(res.status).toBe(201)
    expect(mockCheckText).toHaveBeenCalled()
  })

  it('blocks word when text is risky', async () => {
    mockCheckText.mockResolvedValue({ pass: false, suggest: 'risky' as const, label: 20002 })
    const { token } = createTestUser()

    const res = await request(app)
      .post('/api/wordbank')
      .set('Authorization', authHeader(token))
      .send({ word: '违规词' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('内容')
  })
})

describe('POST /api/wordbank/batch — text moderation', () => {
  it('allows batch update when all words pass', async () => {
    const { token } = createTestUser()
    const res = await request(app)
      .post('/api/wordbank/batch')
      .set('Authorization', authHeader(token))
      .send({ words: ['咖啡', '书店', '公园'] })

    expect(res.status).toBe(200)
    expect(mockCheckText).toHaveBeenCalled()
  })

  it('blocks batch update when any word is risky', async () => {
    mockCheckText.mockResolvedValue({ pass: false, suggest: 'risky' as const, label: 20001 })
    const { token } = createTestUser()

    const res = await request(app)
      .post('/api/wordbank/batch')
      .set('Authorization', authHeader(token))
      .send({ words: ['正常', '违规内容'] })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('内容')
  })
})

// ── Nickname moderation ──

describe('PUT /api/auth/profile — text moderation', () => {
  it('allows nickname when text passes', async () => {
    const { token } = createTestUser()
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', authHeader(token))
      .send({ nickname: '快乐行者' })

    expect(res.status).toBe(200)
    expect(mockCheckText).toHaveBeenCalled()
  })

  it('blocks nickname when text is risky', async () => {
    mockCheckText.mockResolvedValue({ pass: false, suggest: 'risky' as const, label: 20006 })
    const { token } = createTestUser()

    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', authHeader(token))
      .send({ nickname: '违规昵称' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('内容')
  })
})

// ── Board cell text moderation ──

describe('PUT /api/boards/:id/cells — text moderation', () => {
  function createBoardForUser(token: string) {
    return request(app)
      .post('/api/boards')
      .set('Authorization', authHeader(token))
      .send({ title: '测试卡', gridSize: 3 })
  }

  it('allows cell update when text passes', async () => {
    const { token } = createTestUser()
    const boardRes = await createBoardForUser(token)
    const boardId = boardRes.body.data.id

    const cells = Array.from({ length: 9 }, (_, i) => ({
      position: i,
      title: `格子${i}`,
    }))

    const res = await request(app)
      .put(`/api/boards/${boardId}/cells`)
      .set('Authorization', authHeader(token))
      .send({ cells })

    expect(res.status).toBe(200)
    expect(mockCheckText).toHaveBeenCalled()
  })

  it('blocks cell update when text is risky', async () => {
    const { token } = createTestUser()
    const boardRes = await createBoardForUser(token)
    const boardId = boardRes.body.data.id

    mockCheckText.mockResolvedValue({ pass: false, suggest: 'risky' as const, label: 20002 })

    const cells = [{ position: 0, title: '违规内容' }]
    const res = await request(app)
      .put(`/api/boards/${boardId}/cells`)
      .set('Authorization', authHeader(token))
      .send({ cells })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('内容')
  })
})

// ── /api/moderation/check input validation ──

describe('POST /api/moderation/check — input validation', () => {
  it('rejects non-string text with 400', async () => {
    const { token } = createTestUser()
    const res = await request(app)
      .post('/api/moderation/check')
      .set('Authorization', authHeader(token))
      .send({ text: 123 })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  it('rejects text exceeding 2500 chars with 400', async () => {
    const { token } = createTestUser()
    const res = await request(app)
      .post('/api/moderation/check')
      .set('Authorization', authHeader(token))
      .send({ text: 'a'.repeat(2501) })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(mockCheckText).not.toHaveBeenCalled()
  })

  it('passes through valid text', async () => {
    const { token } = createTestUser()
    const res = await request(app)
      .post('/api/moderation/check')
      .set('Authorization', authHeader(token))
      .send({ text: 'hello world' })
    expect(res.status).toBe(200)
    expect(res.body.data.pass).toBe(true)
  })

  it('returns pass=true for empty text without calling moderation', async () => {
    const { token } = createTestUser()
    const res = await request(app)
      .post('/api/moderation/check')
      .set('Authorization', authHeader(token))
      .send({ text: '   ' })
    expect(res.status).toBe(200)
    expect(res.body.data.pass).toBe(true)
    expect(mockCheckText).not.toHaveBeenCalled()
  })
})
