import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { createTestUser, authHeader } from './helpers'

const app = createApp()

describe('Boards API', () => {
  // ── GET /api/boards ──
  describe('GET /api/boards', () => {
    it('returns empty list for new user', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .get('/api/boards')
        .set('Authorization', authHeader(token))

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toEqual([])
    })
  })

  // ── POST /api/boards ──
  describe('POST /api/boards', () => {
    it('creates a board with default values', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({})

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)

      const board = res.body.data
      expect(board.title).toBe('Binwak')
      expect(board.gridSize).toBe(3)
      expect(board.theme).toBe('mono')
      expect(board.isActive).toBe(true)
      expect(board.cells).toHaveLength(9) // 3x3
    })

    it('creates a board with custom values', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ title: '测试Bingo卡', gridSize: 3, theme: 'mono' })

      expect(res.status).toBe(201)
      const board = res.body.data
      expect(board.title).toBe('测试Bingo卡')
      expect(board.gridSize).toBe(3)
      expect(board.theme).toBe('mono')
      expect(board.cells).toHaveLength(9) // 3x3
    })

    it('deactivates previous boards when creating new one', async () => {
      const { token } = createTestUser()

      // Create first board
      await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({})

      // Create second board
      await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ title: '第二个' })

      // List boards — first one should be inactive
      const res = await request(app)
        .get('/api/boards')
        .set('Authorization', authHeader(token))

      expect(res.body.data).toHaveLength(2)
      const active = res.body.data.filter((b: any) => b.isActive)
      expect(active).toHaveLength(1)
      expect(active[0].title).toBe('第二个')
    })
  })

  // ── GET /api/boards/:id ──
  describe('GET /api/boards/:id', () => {
    it('returns board detail with cells', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 4 })

      const boardId = created.body.data.id
      const res = await request(app)
        .get(`/api/boards/${boardId}`)
        .set('Authorization', authHeader(token))

      expect(res.status).toBe(200)
      expect(res.body.data.cells).toHaveLength(16) // 4x4
    })

    it('returns 404 for non-existent board', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .get('/api/boards/9999')
        .set('Authorization', authHeader(token))

      expect(res.status).toBe(404)
    })

    it('cannot access another user\'s board', async () => {
      const user1 = createTestUser('user-1')
      const user2 = createTestUser('user-2')

      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(user1.token))
        .send({})

      const res = await request(app)
        .get(`/api/boards/${created.body.data.id}`)
        .set('Authorization', authHeader(user2.token))

      expect(res.status).toBe(404)
    })
  })

  // ── PUT /api/boards/:id ──
  describe('PUT /api/boards/:id', () => {
    it('updates board title and theme', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({})

      const boardId = created.body.data.id
      const res = await request(app)
        .put(`/api/boards/${boardId}`)
        .set('Authorization', authHeader(token))
        .send({ title: '新标题', theme: 'mono' })

      expect(res.status).toBe(200)
      expect(res.body.data.title).toBe('新标题')
      expect(res.body.data.theme).toBe('mono')
    })

    it('returns 404 for non-existent board', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .put('/api/boards/9999')
        .set('Authorization', authHeader(token))
        .send({ title: 'x' })

      expect(res.status).toBe(404)
    })
  })

  // ── DELETE /api/boards/:id ──
  describe('DELETE /api/boards/:id', () => {
    it('deletes a non-active board', async () => {
      const { token } = createTestUser()
      // Create first board (will be active)
      await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({})

      // Create second board (now active, first becomes inactive)
      const created2 = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({})

      // List to find the inactive board
      const list = await request(app)
        .get('/api/boards')
        .set('Authorization', authHeader(token))
      const inactiveBoard = list.body.data.find((b: any) => !b.isActive)

      const del = await request(app)
        .delete(`/api/boards/${inactiveBoard.id}`)
        .set('Authorization', authHeader(token))

      expect(del.status).toBe(200)

      // Verify it's gone
      const get = await request(app)
        .get(`/api/boards/${inactiveBoard.id}`)
        .set('Authorization', authHeader(token))
      expect(get.status).toBe(404)
    })

    it('returns 400 when deleting active board', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({})

      const boardId = created.body.data.id
      const del = await request(app)
        .delete(`/api/boards/${boardId}`)
        .set('Authorization', authHeader(token))

      expect(del.status).toBe(400)
      expect(del.body.error).toContain('活跃')
    })

    it('returns 404 when deleting non-existent board', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .delete('/api/boards/9999')
        .set('Authorization', authHeader(token))
      expect(res.status).toBe(404)
    })
  })

  // ── PUT /api/boards/:id/cells ──
  describe('PUT /api/boards/:id/cells', () => {
    it('batch updates cell titles', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 3 })

      const boardId = created.body.data.id
      const res = await request(app)
        .put(`/api/boards/${boardId}/cells`)
        .set('Authorization', authHeader(token))
        .send({
          cells: [
            { position: 0, title: '咖啡店' },
            { position: 1, title: '涂鸦墙' },
            { position: 2, title: '老建筑' },
          ],
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      const cells = res.body.data
      expect(cells[0].title).toBe('咖啡店')
      expect(cells[1].title).toBe('涂鸦墙')
      expect(cells[2].title).toBe('老建筑')
    })

    it('preserves existing illustration_path when the field is omitted and title is unchanged', async () => {
      const db = (await import('../src/db/database')).getDb()
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 3 })
      const boardId = created.body.data.id

      // Seed a cell with BOTH a title and an illustration (simulates a starter/template board)
      db.prepare("UPDATE cells SET title = '花束', illustration_path = 'illustrations/flower.png' WHERE board_id = ? AND position = 0")
        .run(boardId)

      // Client re-pushes the same title WITHOUT illustrationPath (first sync of a seeded board)
      const res = await request(app)
        .put(`/api/boards/${boardId}/cells`)
        .set('Authorization', authHeader(token))
        .send({ cells: [{ position: 0, title: '花束', completed: false }] })

      expect(res.status).toBe(200)
      // Seeded illustration must survive the title-only update
      const row = db.prepare('SELECT illustration_path FROM cells WHERE board_id = ? AND position = 0')
        .get(boardId) as { illustration_path: string }
      expect(row.illustration_path).toBe('illustrations/flower.png')
    })

    it('clears a stale illustration_path when the field is omitted and the title changed', async () => {
      const db = (await import('../src/db/database')).getDb()
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 3 })
      const boardId = created.body.data.id

      // Cell currently shows '瀑布' with the waterfall illustration
      db.prepare("UPDATE cells SET title = '瀑布', illustration_path = 'illustrations/waterfall.png' WHERE board_id = ? AND position = 0")
        .run(boardId)

      // User reassigns the cell to a word with no illustration → client omits illustrationPath
      const res = await request(app)
        .put(`/api/boards/${boardId}/cells`)
        .set('Authorization', authHeader(token))
        .send({ cells: [{ position: 0, title: '便利店', completed: false }] })

      expect(res.status).toBe(200)
      // The old word's illustration must not linger on the new word
      const row = db.prepare('SELECT illustration_path FROM cells WHERE board_id = ? AND position = 0')
        .get(boardId) as { illustration_path: string }
      expect(row.illustration_path).toBe('')
    })

    it('clears illustration_path when an empty string is explicitly sent', async () => {
      const db = (await import('../src/db/database')).getDb()
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 3 })
      const boardId = created.body.data.id

      db.prepare("UPDATE cells SET title = '瀑布', illustration_path = 'illustrations/flower.png' WHERE board_id = ? AND position = 0")
        .run(boardId)

      const res = await request(app)
        .put(`/api/boards/${boardId}/cells`)
        .set('Authorization', authHeader(token))
        .send({ cells: [{ position: 0, title: '瀑布', illustrationPath: '' }] })

      expect(res.status).toBe(200)
      const row = db.prepare('SELECT illustration_path FROM cells WHERE board_id = ? AND position = 0')
        .get(boardId) as { illustration_path: string }
      expect(row.illustration_path).toBe('')
    })

    it('persists an allowed illustrations/ key supplied by the client', async () => {
      const db = (await import('../src/db/database')).getDb()
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 3 })
      const boardId = created.body.data.id

      const res = await request(app)
        .put(`/api/boards/${boardId}/cells`)
        .set('Authorization', authHeader(token))
        .send({ cells: [{ position: 0, title: '花束', illustrationPath: 'illustrations/u1/abc.jpg' }] })

      expect(res.status).toBe(200)
      const row = db.prepare('SELECT illustration_path FROM cells WHERE board_id = ? AND position = 0')
        .get(boardId) as { illustration_path: string }
      expect(row.illustration_path).toBe('illustrations/u1/abc.jpg')
    })

    it('persists an allowed templates/ snapshot key (seeded starter board)', async () => {
      const db = (await import('../src/db/database')).getDb()
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 3 })
      const boardId = created.body.data.id

      const res = await request(app)
        .put(`/api/boards/${boardId}/cells`)
        .set('Authorization', authHeader(token))
        .send({ cells: [{ position: 0, title: '瀑布', illustrationPath: 'templates/t5/c0.jpg' }] })

      expect(res.status).toBe(200)
      const row = db.prepare('SELECT illustration_path FROM cells WHERE board_id = ? AND position = 0')
        .get(boardId) as { illustration_path: string }
      expect(row.illustration_path).toBe('templates/t5/c0.jpg')
    })

    it("rejects a foreign private photos/ key (no signed-URL leak)", async () => {
      const db = (await import('../src/db/database')).getDb()
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 3 })
      const boardId = created.body.data.id

      const res = await request(app)
        .put(`/api/boards/${boardId}/cells`)
        .set('Authorization', authHeader(token))
        .send({ cells: [{ position: 0, title: '咖啡店', illustrationPath: 'photos/u999/secret.jpg' }] })

      expect(res.status).toBe(200)
      // The foreign private key must not be stored, so it can never be signed.
      const row = db.prepare('SELECT illustration_path FROM cells WHERE board_id = ? AND position = 0')
        .get(boardId) as { illustration_path: string }
      expect(row.illustration_path).toBe('')
      expect(res.body.data[0].illustrationUrl).toBeUndefined()
    })

    it('rejects a path-traversal illustration key without breaking the response', async () => {
      const db = (await import('../src/db/database')).getDb()
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 3 })
      const boardId = created.body.data.id

      const res = await request(app)
        .put(`/api/boards/${boardId}/cells`)
        .set('Authorization', authHeader(token))
        .send({ cells: [{ position: 0, title: '老建筑', illustrationPath: 'illustrations/../../etc/passwd' }] })

      expect(res.status).toBe(200)
      const row = db.prepare('SELECT illustration_path FROM cells WHERE board_id = ? AND position = 0')
        .get(boardId) as { illustration_path: string }
      expect(row.illustration_path).toBe('')
    })

    it('returns 404 for non-existent board', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .put('/api/boards/9999/cells')
        .set('Authorization', authHeader(token))
        .send({ cells: [{ position: 0, title: 'x' }] })

      expect(res.status).toBe(404)
    })

    it('rejects out-of-bounds cell position', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 3 })
      const boardId = created.body.data.id

      // For a 3x3 board, valid positions are 0-8
      const tooLarge = await request(app)
        .put(`/api/boards/${boardId}/cells`)
        .set('Authorization', authHeader(token))
        .send({ cells: [{ position: 9999, title: 'x' }] })
      expect(tooLarge.status).toBe(400)
      expect(tooLarge.body.error).toContain('0~8')

      const negative = await request(app)
        .put(`/api/boards/${boardId}/cells`)
        .set('Authorization', authHeader(token))
        .send({ cells: [{ position: -1, title: 'x' }] })
      expect(negative.status).toBe(400)

      const nonInteger = await request(app)
        .put(`/api/boards/${boardId}/cells`)
        .set('Authorization', authHeader(token))
        .send({ cells: [{ position: 1.5, title: 'x' }] })
      expect(nonInteger.status).toBe(400)
    })
  })

  // ── Input validation ──
  describe('Input validation', () => {
    it('rejects invalid gridSize on create', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 10 })

      expect(res.status).toBe(400)
    })

    it('rejects too-long title on update', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({})

      const boardId = created.body.data.id
      const res = await request(app)
        .put(`/api/boards/${boardId}`)
        .set('Authorization', authHeader(token))
        .send({ title: 'A'.repeat(31) })

      expect(res.status).toBe(400)
    })
  })

  // ── GET /api/boards imageCount ──
  describe('GET /api/boards imageCount', () => {
    it('returns imageCount=0 for a new board', async () => {
      const { token } = createTestUser()
      await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 3 })

      const res = await request(app)
        .get('/api/boards')
        .set('Authorization', authHeader(token))

      expect(res.status).toBe(200)
      expect(res.body.data[0].imageCount).toBe(0)
    })

    it('counts cells with images correctly', async () => {
      const { token, userId } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 3 })

      const boardId = created.body.data.id
      // Simulate uploaded images by directly updating cells in DB
      const db = (await import('../src/db/database')).getDb()
      db.prepare("UPDATE cells SET image_name = 'img1.jpg' WHERE board_id = ? AND position = 0").run(boardId)
      db.prepare("UPDATE cells SET image_name = 'img2.jpg' WHERE board_id = ? AND position = 1").run(boardId)

      const res = await request(app)
        .get('/api/boards')
        .set('Authorization', authHeader(token))

      expect(res.body.data[0].imageCount).toBe(2)
    })
  })

  // ── PATCH /api/boards/:id/publish ──
  describe('PATCH /api/boards/:id/publish', () => {
    it('sets publishedTemplateId on a board', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({ gridSize: 3 })

      const boardId = created.body.data.id

      // Create a template first
      const tplRes = await request(app)
        .post('/api/templates')
        .set('Authorization', authHeader(token))
        .send({
          title: '测试模板',
          gridSize: 3,
          cells: Array.from({ length: 9 }, (_, j) => ({ position: j, title: `格子${j}` })),
        })
      const templateId = tplRes.body.data.id

      const res = await request(app)
        .patch(`/api/boards/${boardId}/publish`)
        .set('Authorization', authHeader(token))
        .send({ publishedTemplateId: templateId })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('clears publishedTemplateId with null', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({})

      const res = await request(app)
        .patch(`/api/boards/${created.body.data.id}/publish`)
        .set('Authorization', authHeader(token))
        .send({ publishedTemplateId: null })

      expect(res.status).toBe(200)
    })

    it('returns 400 for non-existent template', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({})

      const res = await request(app)
        .patch(`/api/boards/${created.body.data.id}/publish`)
        .set('Authorization', authHeader(token))
        .send({ publishedTemplateId: 99999 })

      expect(res.status).toBe(400)
    })

    it('returns 404 for non-existent board', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .patch('/api/boards/9999/publish')
        .set('Authorization', authHeader(token))
        .send({ publishedTemplateId: null })

      expect(res.status).toBe(404)
    })
  })

  // ── PATCH /api/boards/:id/favorite ──
  describe('PATCH /api/boards/:id/favorite', () => {
    it('toggles favorite on', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({})

      const res = await request(app)
        .patch(`/api/boards/${created.body.data.id}/favorite`)
        .set('Authorization', authHeader(token))

      expect(res.status).toBe(200)
      expect(res.body.data.isFavorite).toBe(true)
    })

    it('toggles favorite off', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({})

      // on
      await request(app)
        .patch(`/api/boards/${created.body.data.id}/favorite`)
        .set('Authorization', authHeader(token))

      // off
      const res = await request(app)
        .patch(`/api/boards/${created.body.data.id}/favorite`)
        .set('Authorization', authHeader(token))

      expect(res.status).toBe(200)
      expect(res.body.data.isFavorite).toBe(false)
    })

    it('returns 404 for non-existent board', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .patch('/api/boards/9999/favorite')
        .set('Authorization', authHeader(token))

      expect(res.status).toBe(404)
    })

    it('isFavorite appears in GET /api/boards', async () => {
      const { token } = createTestUser()
      const created = await request(app)
        .post('/api/boards')
        .set('Authorization', authHeader(token))
        .send({})

      // default false
      let list = await request(app).get('/api/boards').set('Authorization', authHeader(token))
      const board = list.body.data.find((b: any) => b.id === created.body.data.id)
      expect(board.isFavorite).toBe(false)

      // toggle on
      await request(app)
        .patch(`/api/boards/${created.body.data.id}/favorite`)
        .set('Authorization', authHeader(token))

      list = await request(app).get('/api/boards').set('Authorization', authHeader(token))
      const updated = list.body.data.find((b: any) => b.id === created.body.data.id)
      expect(updated.isFavorite).toBe(true)
    })
  })
})
