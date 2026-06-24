import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { getDb, ensureSystemAdminUser } from '../src/db/database'
import { generateAdminToken } from '../src/middleware/adminAuth'
import { createTestUser } from './helpers'

const app = createApp()

const ORIGINAL = {
  user: process.env.ADMIN_USERNAME,
  pwd: process.env.ADMIN_PASSWORD,
  hash: process.env.ADMIN_PASSWORD_HASH,
}

function restore() {
  process.env.ADMIN_USERNAME = ORIGINAL.user || ''
  process.env.ADMIN_PASSWORD = ORIGINAL.pwd || ''
  process.env.ADMIN_PASSWORD_HASH = ORIGINAL.hash || ''
  if (!ORIGINAL.user) delete process.env.ADMIN_USERNAME
  if (!ORIGINAL.pwd) delete process.env.ADMIN_PASSWORD
  if (!ORIGINAL.hash) delete process.env.ADMIN_PASSWORD_HASH
}

function adminAuth() {
  // generateAdminToken just needs a username; any value works for signing.
  return `Bearer ${generateAdminToken('admin')}`
}

describe('DELETE /api/admin/users/:id', () => {
  afterEach(() => restore())

  it('requires admin auth', async () => {
    const res = await request(app).delete('/api/admin/users/1')
    expect(res.status).toBe(401)
  })

  it('returns 400 for an invalid id', async () => {
    const res = await request(app)
      .delete('/api/admin/users/abc')
      .set('Authorization', adminAuth())
    expect(res.status).toBe(400)
  })

  it('returns 404 when the user does not exist', async () => {
    const res = await request(app)
      .delete('/api/admin/users/99999')
      .set('Authorization', adminAuth())
    expect(res.status).toBe(404)
  })

  it('refuses to delete the system admin account', async () => {
    const systemId = ensureSystemAdminUser(getDb())
    const res = await request(app)
      .delete(`/api/admin/users/${systemId}`)
      .set('Authorization', adminAuth())
    expect(res.status).toBe(403)
    // The system user must still exist.
    const still = getDb().prepare('SELECT id FROM users WHERE id = ?').get(systemId)
    expect(still).toBeTruthy()
  })

  it('deletes a regular user and cascades their data', async () => {
    const db = getDb()
    const { userId } = createTestUser('to-delete-openid')
    // Seed cascading data: a board with a cell, a template, a word.
    const boardId = db
      .prepare('INSERT INTO boards (user_id, title, grid_size) VALUES (?, ?, ?)')
      .run(userId, 'B', 3).lastInsertRowid as number
    db.prepare('INSERT INTO cells (board_id, position, title) VALUES (?, ?, ?)').run(boardId, 0, 'c')
    db.prepare('INSERT INTO templates (user_id, title, grid_size) VALUES (?, ?, ?)').run(userId, 'T', 3)
    db.prepare('INSERT INTO word_banks (user_id, word) VALUES (?, ?)').run(userId, 'w')

    const res = await request(app)
      .delete(`/api/admin/users/${userId}`)
      .set('Authorization', adminAuth())
    expect(res.status).toBe(200)
    expect(res.body.data.deleted).toBe(1)

    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(userId)).toBeUndefined()
    expect(db.prepare('SELECT id FROM boards WHERE user_id = ?').get(userId)).toBeUndefined()
    expect(db.prepare('SELECT id FROM cells WHERE board_id = ?').get(boardId)).toBeUndefined()
    expect(db.prepare('SELECT id FROM templates WHERE user_id = ?').get(userId)).toBeUndefined()
    expect(db.prepare('SELECT id FROM word_banks WHERE user_id = ?').get(userId)).toBeUndefined()
  })
})
