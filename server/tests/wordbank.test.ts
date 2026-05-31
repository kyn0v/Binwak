import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { createTestUser, authHeader } from './helpers'

const app = createApp()

describe('WordBank API', () => {
  // ── GET /api/wordbank ──
  describe('GET /api/wordbank', () => {
    it('returns empty word list for new user', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .get('/api/wordbank')
        .set('Authorization', authHeader(token))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.words).toEqual([])
    })
  })

  // ── POST /api/wordbank ──
  describe('POST /api/wordbank', () => {
    it('adds a word to the bank', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .post('/api/wordbank')
        .set('Authorization', authHeader(token))
        .send({ word: '咖啡店' })

      expect(res.status).toBe(201)
      expect(res.body.data.word).toBe('咖啡店')
      expect(res.body.data.sortOrder).toBe(0)
    })

    it('trims whitespace from words', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .post('/api/wordbank')
        .set('Authorization', authHeader(token))
        .send({ word: '  咖啡店  ' })

      expect(res.body.data.word).toBe('咖啡店')
    })

    it('returns 400 for empty word', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .post('/api/wordbank')
        .set('Authorization', authHeader(token))
        .send({ word: '   ' })

      expect(res.status).toBe(400)
    })

    it('returns 409 for duplicate word', async () => {
      const { token } = createTestUser()

      await request(app)
        .post('/api/wordbank')
        .set('Authorization', authHeader(token))
        .send({ word: '咖啡店' })

      const res = await request(app)
        .post('/api/wordbank')
        .set('Authorization', authHeader(token))
        .send({ word: '咖啡店' })

      expect(res.status).toBe(409)
      expect(res.body.error).toContain('已存在')
    })

    it('increments sort_order for each new word', async () => {
      const { token } = createTestUser()

      await request(app)
        .post('/api/wordbank')
        .set('Authorization', authHeader(token))
        .send({ word: '第一个' })

      const res = await request(app)
        .post('/api/wordbank')
        .set('Authorization', authHeader(token))
        .send({ word: '第二个' })

      expect(res.body.data.sortOrder).toBe(1)
    })
  })

  // ── POST /api/wordbank/batch ──
  describe('POST /api/wordbank/batch', () => {
    it('replaces entire word bank', async () => {
      const { token } = createTestUser()

      // Add some words first
      await request(app)
        .post('/api/wordbank')
        .set('Authorization', authHeader(token))
        .send({ word: '旧词语' })

      // Replace with new list
      const res = await request(app)
        .post('/api/wordbank/batch')
        .set('Authorization', authHeader(token))
        .send({ words: ['咖啡店', '涂鸦墙', '老建筑'] })

      expect(res.status).toBe(200)
      expect(res.body.data.words).toHaveLength(3)
      expect(res.body.data.words.map((w: any) => w.word)).toEqual(['咖啡店', '涂鸦墙', '老建筑'])
    })

    it('filters out empty words', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .post('/api/wordbank/batch')
        .set('Authorization', authHeader(token))
        .send({ words: ['咖啡店', '', '  ', '涂鸦墙'] })

      expect(res.body.data.words).toHaveLength(2)
    })

    it('returns 400 when words is not an array', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .post('/api/wordbank/batch')
        .set('Authorization', authHeader(token))
        .send({ words: '不是数组' })

      expect(res.status).toBe(400)
    })
  })

  // ── DELETE /api/wordbank/:id ──
  describe('DELETE /api/wordbank/:id', () => {
    it('deletes a word by id', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/wordbank')
        .set('Authorization', authHeader(token))
        .send({ word: '待删除' })

      const wordId = created.body.data.id
      const res = await request(app)
        .delete(`/api/wordbank/${wordId}`)
        .set('Authorization', authHeader(token))

      expect(res.status).toBe(200)

      // Verify it's gone
      const list = await request(app)
        .get('/api/wordbank')
        .set('Authorization', authHeader(token))
      expect(list.body.data.words).toHaveLength(0)
    })

    it('returns 404 for non-existent word', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .delete('/api/wordbank/9999')
        .set('Authorization', authHeader(token))

      expect(res.status).toBe(404)
    })

    it('cannot delete another user\'s word', async () => {
      const user1 = createTestUser('user-wb-1')
      const user2 = createTestUser('user-wb-2')

      const created = await request(app)
        .post('/api/wordbank')
        .set('Authorization', authHeader(user1.token))
        .send({ word: '我的词' })

      const res = await request(app)
        .delete(`/api/wordbank/${created.body.data.id}`)
        .set('Authorization', authHeader(user2.token))

      expect(res.status).toBe(404)
    })
  })
})
