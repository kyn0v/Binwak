import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { createTestUser, authHeader } from './helpers'
import { ensureSystemAdminUser, getDb } from '../src/db/database'

const app = createApp()

/** Helper: create a 3×3 template */
function make3x3(overrides: Record<string, any> = {}) {
  return {
    title: '测试模板',
    gridSize: 3,
    cells: Array.from({ length: 9 }, (_, j) => ({ position: j, title: `格子${j}` })),
    ...overrides,
  }
}

describe('Templates API', () => {
  // ── GET /api/templates (public) ──
  describe('GET /api/templates', () => {
    it('returns empty list when no templates exist', async () => {
      const res = await request(app).get('/api/templates')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.templates).toEqual([])
      expect(res.body.data.total).toBe(0)
    })

    it('returns paginated list of templates', async () => {
      const { token } = createTestUser()

      // Create 3 templates
      for (let i = 1; i <= 3; i++) {
        await request(app)
          .post('/api/templates')
          .set('Authorization', authHeader(token))
          .send(make3x3({ title: `模板${i}`, category: 'creative' }))
      }

      const res = await request(app).get('/api/templates?limit=2&page=1')

      expect(res.status).toBe(200)
      expect(res.body.data.templates).toHaveLength(2)
      expect(res.body.data.total).toBe(3)
    })

    it('filters by category', async () => {
      const { token } = createTestUser()

      await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '城市探索', category: 'creative' }))

      await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '运动打卡', category: 'nicetry' }))

      const res = await request(app).get('/api/templates?category=creative')

      expect(res.status).toBe(200)
      expect(res.body.data.templates).toHaveLength(1)
      expect(res.body.data.templates[0].category).toBe('creative')
    })

    it('recommend sort: pinned templates come first', async () => {
      const { token } = createTestUser()
      const db = getDb()

      const a = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '普通模板' }))

      const b = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '置顶模板' }))

      db.prepare('UPDATE templates SET is_pinned = 1 WHERE id = ?').run(b.body.data.id)

      const res = await request(app).get('/api/templates?sort=recommend')

      expect(res.status).toBe(200)
      expect(res.body.data.templates[0].title).toBe('置顶模板')
    })

    it('recommend sort: higher favorite_count ranks higher', async () => {
      const { token } = createTestUser()
      const { token: t2 } = createTestUser('faver2')

      const a = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '普通模板' }))

      const b = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '热门模板' }))

      // Favorite b
      await request(app)
        .post(`/api/templates/${b.body.data.id}/favorite`)
        .set('Authorization', authHeader(t2))

      const res = await request(app).get('/api/templates?sort=recommend')

      expect(res.body.data.templates[0].title).toBe('热门模板')
    })

    it('recommend sort: pinned first, then by favorite count', async () => {
      const { token } = createTestUser()
      const { token: t2 } = createTestUser('faver3')
      const db = getDb()

      // Template A: favorited, not pinned
      const a = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '热门模板' }))
      await request(app)
        .post(`/api/templates/${a.body.data.id}/favorite`)
        .set('Authorization', authHeader(t2))

      // Template B: pinned, not favorited
      const b = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '置顶模板' }))
      db.prepare('UPDATE templates SET is_pinned = 1 WHERE id = ?').run(b.body.data.id)

      const res = await request(app).get('/api/templates?sort=recommend')

      expect(res.body.data.templates[0].title).toBe('置顶模板') // pinned first
      expect(res.body.data.templates[1].title).toBe('热门模板')
    })

    it('searches by keyword', async () => {
      const { token } = createTestUser()

      await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '北京城市探索' }))

      await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '运动健身挑战' }))

      const res = await request(app).get('/api/templates?keyword=城市')

      expect(res.status).toBe(200)
      expect(res.body.data.templates).toHaveLength(1)
      expect(res.body.data.templates[0].title).toBe('北京城市探索')
    })

    it('returns authorName and isFavorite for authenticated users', async () => {
      const { token, userId } = createTestUser()
      const db = getDb()
      db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run('测试作者', userId)

      const createRes = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '作者测试' }))

      // Favorite it
      await request(app)
        .post(`/api/templates/${createRes.body.data.id}/favorite`)
        .set('Authorization', authHeader(token))

      const res = await request(app)
        .get('/api/templates')
        .set('Authorization', authHeader(token))

      const tpl = res.body.data.templates[0]
      expect(tpl.authorName).toBe('测试作者')
      expect(tpl.isFavorite).toBe(true)
      expect(tpl.favoriteCount).toBe(1)
    })

    it('sorts by newest by default', async () => {
      const { token } = createTestUser()

      const res1 = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '旧模板' }))

      const res2 = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '新模板' }))

      const res = await request(app).get('/api/templates?sort=newest')

      expect(res.status).toBe(200)
      expect(res.body.data.templates[0].id).toBe(res2.body.data.id)
      expect(res.body.data.templates[1].id).toBe(res1.body.data.id)
    })

    it('GET /api/templates/mine returns only current user templates', async () => {
      const userA = createTestUser('openid-A')
      const userB = createTestUser('openid-B')

      await request(app).post('/api/templates').set('Authorization', authHeader(userA.token))
        .send(make3x3({ title: 'A 的模板' }))
      await request(app).post('/api/templates').set('Authorization', authHeader(userB.token))
        .send(make3x3({ title: 'B 的模板' }))

      const res = await request(app).get('/api/templates/mine')
        .set('Authorization', authHeader(userA.token))

      expect(res.status).toBe(200)
      expect(res.body.data.templates).toHaveLength(1)
      expect(res.body.data.templates[0].title).toBe('A 的模板')
    })

    it('GET /api/templates/mine requires authentication', async () => {
      const res = await request(app).get('/api/templates/mine')
      expect(res.status).toBe(401)
    })

    it('uses official author name for system templates', async () => {
      const db = getDb()
      const systemUserId = ensureSystemAdminUser(db)
      const result = db.prepare(`
        INSERT INTO templates (user_id, title, description, grid_size, category, status)
        VALUES (?, '系统模板', '', 3, 'creative', 'active')
      `).run(systemUserId)
      const templateId = result.lastInsertRowid as number
      const insertCell = db.prepare('INSERT INTO template_cells (template_id, position, title) VALUES (?, ?, ?)')
      for (let i = 0; i < 9; i++) insertCell.run(templateId, i, `格子${i}`)

      const res = await request(app).get('/api/templates')

      expect(res.status).toBe(200)
      expect(res.body.data.templates[0].authorName).toBe('Binwak')
    })
  })

  // ── GET /api/templates/:id ──
  describe('GET /api/templates/:id', () => {
    it('returns template details with new fields', async () => {
      const { token } = createTestUser()

      const createRes = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '详情测试', description: '这是一个测试模板', category: 'creative' }))

      const res = await request(app).get(`/api/templates/${createRes.body.data.id}`)

      expect(res.status).toBe(200)
      expect(res.body.data.title).toBe('详情测试')
      expect(res.body.data.description).toBe('这是一个测试模板')
      expect(res.body.data.cells).toHaveLength(9)
      expect(res.body.data.category).toBe('creative')
      expect(res.body.data.isPinned).toBe(false)
      expect(res.body.data.favoriteCount).toBe(0)
      expect(res.body.data.isFavorite).toBe(false)
      expect(res.body.data.authorName).toBeDefined()
    })

    it('returns 404 for non-existent template', async () => {
      const res = await request(app).get('/api/templates/99999')

      expect(res.status).toBe(404)
      expect(res.body.success).toBe(false)
    })
  })

  // ── POST /api/templates (create) ──
  describe('POST /api/templates', () => {
    it('requires authentication', async () => {
      const res = await request(app)
        .post('/api/templates')
        .send(make3x3({ title: '无授权模板' }))

      expect(res.status).toBe(401)
    })

    it('creates a template successfully', async () => {
      const { token } = createTestUser()

      const res = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '我的模板', description: '适合周末探索', category: 'creative' }))

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)
      expect(res.body.data.title).toBe('我的模板')
      expect(res.body.data.isPinned).toBe(false)
      expect(res.body.data.favoriteCount).toBe(0)
      expect(res.body.data.useCount).toBe(0)
    })

    it('validates required fields', async () => {
      const { token } = createTestUser()

      const res = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send({ description: '没有标题' })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })

    it('validates gridSize matches cells count', async () => {
      const { token } = createTestUser()

      const res = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send({
          title: '错误格子数',
          gridSize: 3,
          cells: [{ position: 0, title: '只有一个' }],
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('cells')
    })

    it('validates gridSize range (3-7)', async () => {
      const { token } = createTestUser()

      const res = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send({
          title: '太大了',
          gridSize: 10,
          cells: Array.from({ length: 100 }, (_, j) => ({ position: j, title: `格子${j}` })),
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('gridSize')
    })

    it('validates title max length', async () => {
      const { token } = createTestUser()

      const res = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '这是一个超级长的标题用来测试标题长度校验的啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊' }))

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('标题')
    })

    it('validates description max length', async () => {
      const { token } = createTestUser()

      const res = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ description: 'x'.repeat(101) }))

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('描述')
    })
  })

  // ── POST /api/templates/:id/favorite ──
  describe('POST /api/templates/:id/favorite', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/templates/1/favorite')
      expect(res.status).toBe(401)
    })

    it('favorites a template (toggle on)', async () => {
      const { token } = createTestUser()
      const { token: t2 } = createTestUser('faver4')

      const createRes = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '可赞模板' }))

      const res = await request(app)
        .post(`/api/templates/${createRes.body.data.id}/favorite`)
        .set('Authorization', authHeader(t2))

      expect(res.status).toBe(200)
      expect(res.body.data.favorite).toBe(true)
      expect(res.body.data.favoriteCount).toBe(1)
    })

    it('unfavorites a template (toggle off)', async () => {
      const { token } = createTestUser()
      const { token: t2 } = createTestUser('faver5')

      const createRes = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '取赞模板' }))

      // Favorite
      await request(app)
        .post(`/api/templates/${createRes.body.data.id}/favorite`)
        .set('Authorization', authHeader(t2))

      // Unfavorite
      const res = await request(app)
        .post(`/api/templates/${createRes.body.data.id}/favorite`)
        .set('Authorization', authHeader(t2))

      expect(res.body.data.favorite).toBe(false)
      expect(res.body.data.favoriteCount).toBe(0)
    })

    it('multiple users can favorite the same template', async () => {
      const { token } = createTestUser()
      const { token: t2 } = createTestUser('faverA')
      const { token: t3 } = createTestUser('faverB')

      const createRes = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '多赞模板' }))

      await request(app)
        .post(`/api/templates/${createRes.body.data.id}/favorite`)
        .set('Authorization', authHeader(t2))

      const res = await request(app)
        .post(`/api/templates/${createRes.body.data.id}/favorite`)
        .set('Authorization', authHeader(t3))

      expect(res.body.data.favoriteCount).toBe(2)
    })

    it('returns 404 for non-existent template', async () => {
      const { token } = createTestUser()

      const res = await request(app)
        .post('/api/templates/99999/favorite')
        .set('Authorization', authHeader(token))

      expect(res.status).toBe(404)
    })
  })

  // ── POST /api/templates/:id/use ──
  describe('POST /api/templates/:id/use', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/templates/1/use')

      expect(res.status).toBe(401)
    })

    it('creates a new board from template', async () => {
      const { token: creatorToken } = createTestUser('creator')
      const { token: userToken } = createTestUser('user')

      const templateRes = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(creatorToken))
        .send(make3x3({ title: '可用模板' }))

      const useRes = await request(app)
        .post(`/api/templates/${templateRes.body.data.id}/use`)
        .set('Authorization', authHeader(userToken))

      expect(useRes.status).toBe(201)
      expect(useRes.body.data.title).toBe('可用模板')
      expect(useRes.body.data.cells).toHaveLength(9)
      expect(useRes.body.data.cells[0].title).toBe('格子0')
    })

    it('increments useCount on template', async () => {
      const { token: creatorToken } = createTestUser('creator2')
      const { token: userToken } = createTestUser('user2')

      const templateRes = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(creatorToken))
        .send(make3x3({ title: '计数模板' }))

      await request(app)
        .post(`/api/templates/${templateRes.body.data.id}/use`)
        .set('Authorization', authHeader(userToken))

      const detailRes = await request(app).get(`/api/templates/${templateRes.body.data.id}`)

      expect(detailRes.body.data.useCount).toBe(1)
    })

    it('returns 404 for non-existent template', async () => {
      const { token } = createTestUser()

      const res = await request(app)
        .post('/api/templates/99999/use')
        .set('Authorization', authHeader(token))

      expect(res.status).toBe(404)
    })

    it('does not increment useCount when same user uses template again', async () => {
      const { token: creatorToken } = createTestUser('dedup-creator')
      const { token: userToken } = createTestUser('dedup-user')

      const templateRes = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(creatorToken))
        .send(make3x3({ title: '去重模板' }))

      const templateId = templateRes.body.data.id

      // First use — should increment
      await request(app)
        .post(`/api/templates/${templateId}/use`)
        .set('Authorization', authHeader(userToken))

      // Second use by same user — should NOT increment
      await request(app)
        .post(`/api/templates/${templateId}/use`)
        .set('Authorization', authHeader(userToken))

      const detailRes = await request(app).get(`/api/templates/${templateId}`)
      expect(detailRes.body.data.useCount).toBe(1)
    })

    it('increments useCount for different users', async () => {
      const { token: creatorToken } = createTestUser('multi-creator')
      const { token: user1Token } = createTestUser('multi-user1')
      const { token: user2Token } = createTestUser('multi-user2')

      const templateRes = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(creatorToken))
        .send(make3x3({ title: '多用户模板' }))

      const templateId = templateRes.body.data.id

      await request(app)
        .post(`/api/templates/${templateId}/use`)
        .set('Authorization', authHeader(user1Token))

      await request(app)
        .post(`/api/templates/${templateId}/use`)
        .set('Authorization', authHeader(user2Token))

      const detailRes = await request(app).get(`/api/templates/${templateId}`)
      expect(detailRes.body.data.useCount).toBe(2)
    })
  })

  // ── DELETE /api/templates/:id ──
  describe('DELETE /api/templates/:id', () => {
    it('requires authentication', async () => {
      const res = await request(app).delete('/api/templates/1')

      expect(res.status).toBe(401)
    })

    it('deletes own template', async () => {
      const { token } = createTestUser()

      const createRes = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send(make3x3({ title: '待删除' }))

      const deleteRes = await request(app)
        .delete(`/api/templates/${createRes.body.data.id}`)
        .set('Authorization', authHeader(token))

      expect(deleteRes.status).toBe(200)

      const detailRes = await request(app).get(`/api/templates/${createRes.body.data.id}`)
      expect(detailRes.status).toBe(404)
    })

    it('cannot delete other users template', async () => {
      const { token: token1 } = createTestUser('user1')
      const { token: token2 } = createTestUser('user2')

      const createRes = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token1))
        .send(make3x3({ title: '他人的模板' }))

      const deleteRes = await request(app)
        .delete(`/api/templates/${createRes.body.data.id}`)
        .set('Authorization', authHeader(token2))

      expect(deleteRes.status).toBe(403)
    })
  })
})
