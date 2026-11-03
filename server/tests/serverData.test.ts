import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createApp } from '../src/app'
import { config } from '../src/config'
import { ensureSystemAdminUser, getDb } from '../src/db/database'
import { generateAdminToken } from '../src/middleware/adminAuth'
import { checkText } from '../src/services/moderation'
import { authHeader, createTestUser } from './helpers'

vi.mock('../src/services/moderation', () => ({
  checkText: vi.fn(async () => ({ pass: true })),
  checkImageSync: vi.fn(async () => ({ pass: true })),
  checkImage: vi.fn(async () => ({ submitted: true })),
}))

let app: ReturnType<typeof createApp>
const adminAuth = authHeader(generateAdminToken('data-regression'))
const originalUploadDir = config.uploadDir
const originalLocalDir = config.storage.localDir
let mediaDir: string

function templateBody() {
  return {
    title: 'Snapshot', gridSize: 3,
    cells: Array.from({ length: 9 }, (_, position) => ({ position, title: `word${position}` })),
  }
}

async function writeMedia(key: string, content: string) {
  const file = path.join(mediaDir, key)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

async function seedSnapshot() {
  const db = getDb()
  const author = ensureSystemAdminUser(db)
  await writeMedia('illustrations/source.jpg', 'original image')
  db.prepare('INSERT INTO illustrations (word, user_id, image_path) VALUES (?, ?, ?)')
    .run('word0', author, 'illustrations/source.jpg')
  const created = await request(app).post('/api/admin/templates').set('Authorization', adminAuth).send(templateBody())
  expect(created.status).toBe(201)
  const id = created.body.data.id
  const cell = db.prepare('SELECT image_path FROM template_cells WHERE template_id = ? AND position = 0')
    .get(id) as { image_path: string }
  expect(cell.image_path).not.toBe('')
  return { id, key: cell.image_path }
}

beforeEach(async () => {
  vi.mocked(checkText).mockClear()
  mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binwak-server-data-'))
  config.uploadDir = mediaDir
  config.storage.localDir = mediaDir
  app = createApp()
})

afterEach(async () => {
  config.uploadDir = originalUploadDir
  config.storage.localDir = originalLocalDir
  await fs.rm(mediaDir, { recursive: true, force: true })
})

describe('durable board media', () => {
  it('replaying an upload to the same object key never deletes the live photo', async () => {
    const user = createTestUser()
    const board = await request(app).post('/api/boards').set('Authorization', authHeader(user.token)).send({})
    const image = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
    const randomBytes = vi.spyOn(crypto, 'randomBytes').mockImplementation(size => Buffer.alloc(size, 7))
    try {
      const upload = () => request(app).post('/api/upload').set('Authorization', authHeader(user.token))
        .field('boardId', String(board.body.data.id)).field('position', '0')
        .attach('image', image, { filename: 'replay.gif', contentType: 'image/gif' })
      const first = await upload()
      expect(first.status).toBe(200)
      const second = await upload()
      expect(second.status).toBe(200)
      expect(second.body.data.fileName).toBe(first.body.data.fileName)
      const served = await request(app).get(second.body.data.url).expect(200)
      expect(served.body).toEqual(image)
      expect(await fs.readFile(path.join(mediaDir, second.body.data.fileName))).toEqual(image)
      const read = await request(app).get(`/api/boards/${board.body.data.id}`).set('Authorization', authHeader(user.token))
      expect(read.body.data.cells[0]).toMatchObject({ imageName: second.body.data.fileName, completed: true })
    } finally {
      randomBytes.mockRestore()
    }
  })

  it('failed upload replay retains a photo already referenced by a live cell', async () => {
    const user = createTestUser()
    const board = await request(app).post('/api/boards').set('Authorization', authHeader(user.token)).send({})
    const image = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
    const randomBytes = vi.spyOn(crypto, 'randomBytes').mockImplementation(size => Buffer.alloc(size, 9))
    try {
      const upload = (position: number) => request(app).post('/api/upload').set('Authorization', authHeader(user.token))
        .field('boardId', String(board.body.data.id)).field('position', String(position))
        .attach('image', image, { filename: 'replay.gif', contentType: 'image/gif' })
      const first = await upload(0)
      expect(first.status).toBe(200)
      expect((await upload(99)).status).toBe(400)
      const served = await request(app).get(first.body.data.url).expect(200)
      expect(served.body).toEqual(image)
    } finally {
      randomBytes.mockRestore()
    }
  })

  it.each(['reset', 'delete', 'resize'])('board %s retains a photo referenced by another board until the last reference is removed', async action => {
    const user = createTestUser()
    const first = await request(app).post('/api/boards').set('Authorization', authHeader(user.token)).send({ gridSize: 4 })
    const second = await request(app).post('/api/boards').set('Authorization', authHeader(user.token)).send({ gridSize: 3 })
    const key = 'photos/shared.jpg'
    await writeMedia(key, 'shared photo')
    getDb().prepare('UPDATE cells SET image_name = ? WHERE board_id = ? AND position = 15').run(key, first.body.data.id)
    getDb().prepare('UPDATE cells SET image_name = ? WHERE board_id = ? AND position = 0').run(key, second.body.data.id)
    const endpoint = `/api/boards/${first.body.data.id}`
    if (action === 'reset') await request(app).post(`${endpoint}/reset`).set('Authorization', authHeader(user.token)).expect(200)
    else if (action === 'delete') await request(app).delete(endpoint).set('Authorization', authHeader(user.token)).expect(200)
    else await request(app).put(endpoint).set('Authorization', authHeader(user.token)).send({ gridSize: 3 }).expect(200)
    expect(await fs.readFile(path.join(mediaDir, key), 'utf8')).toBe('shared photo')
    await request(app).post(`/api/boards/${second.body.data.id}/reset`).set('Authorization', authHeader(user.token)).expect(200)
    await expect(fs.access(path.join(mediaDir, key))).rejects.toThrow()
  })

  it('template edits create new immutable keys and retain an existing board image after edit and deletion', async () => {
    const { id, key } = await seedSnapshot()
    const user = createTestUser()
    const used = await request(app).post(`/api/templates/${id}/use`).set('Authorization', authHeader(user.token))
    expect(used.status).toBe(201)
    expect(used.body.data.cells[0].illustrationPath).toBe(key)
    await writeMedia('illustrations/source.jpg', 'replacement image')
    const edited = await request(app).put(`/api/admin/templates/${id}`).set('Authorization', adminAuth)
      .send({ cells: templateBody().cells })
    expect(edited.status).toBe(200)
    const replacement = getDb().prepare('SELECT image_path FROM template_cells WHERE template_id = ? AND position = 0')
      .get(id) as { image_path: string }
    expect(replacement.image_path).not.toBe(key)
    expect(await fs.readFile(path.join(mediaDir, key), 'utf8')).toBe('original image')
    expect(await fs.readFile(path.join(mediaDir, replacement.image_path), 'utf8')).toBe('replacement image')
    await request(app).delete(`/api/admin/templates/${id}`).set('Authorization', adminAuth).expect(200)
    expect(await fs.readFile(path.join(mediaDir, key), 'utf8')).toBe('original image')
    expect(await fs.readFile(path.join(mediaDir, replacement.image_path), 'utf8')).toBe('replacement image')
    const board = await request(app).get(`/api/boards/${used.body.data.id}`).set('Authorization', authHeader(user.token))
    expect(board.body.data.cells[0].illustrationPath).toBe(key)
    const served = await request(app).get(board.body.data.cells[0].illustrationUrl).expect(200)
    expect(served.body.toString()).toBe('original image')
  })

  it.each(['board', 'local URL board', 'absolute local URL board', 'signed URL board', 'template', 'illustration'] as const)('template deletion retains keys referenced by another %s', async reference => {
    const { id, key } = await seedSnapshot()
    const db = getDb()
    const user = createTestUser()
    if (reference === 'board' || reference === 'local URL board' || reference === 'absolute local URL board' || reference === 'signed URL board') {
      const board = db.prepare('INSERT INTO boards (user_id) VALUES (?)').run(user.userId)
      const storedPath = reference === 'local URL board' ? `/uploads/${key}`
        : reference === 'absolute local URL board' ? `https://api.example/uploads/${key}`
        : reference === 'signed URL board' ? `https://bucket.example/${key}?signature=old` : key
      db.prepare('INSERT INTO cells (board_id, position, illustration_path) VALUES (?, 0, ?)').run(board.lastInsertRowid, storedPath)
    } else if (reference === 'template') {
      const other = db.prepare('INSERT INTO templates (user_id, title, grid_size) VALUES (?, ?, 3)').run(user.userId, 'other')
      db.prepare('INSERT INTO template_cells (template_id, position, image_path) VALUES (?, 0, ?)').run(other.lastInsertRowid, key)
    } else {
      db.prepare('INSERT INTO illustrations (word, user_id, image_path) VALUES (?, ?, ?)').run('shared', user.userId, key)
    }
    await request(app).delete(`/api/admin/templates/${id}`).set('Authorization', adminAuth).expect(200)
    expect(await fs.readFile(path.join(mediaDir, key), 'utf8')).toBe('original image')
  })

  it('illustration replacement and deletion preserve images already used by cells and templates', async () => {
    const user = createTestUser()
    const created = await request(app).post('/api/boards').set('Authorization', authHeader(user.token)).send({})
    const key = 'illustrations/old.gif'
    await writeMedia(key, 'old illustration')
    const db = getDb()
    db.prepare('INSERT INTO illustrations (word, user_id, image_path) VALUES (?, ?, ?)').run('word', user.userId, key)
    db.prepare('UPDATE cells SET illustration_path = ? WHERE board_id = ? AND position = 0').run(key, created.body.data.id)
    const image = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
    const upload = await request(app).post('/api/illustrations').set('Authorization', authHeader(user.token))
      .field('word', 'word').attach('image', image, { filename: 'new.gif', contentType: 'image/gif' })
    expect(upload.status).toBe(201)
    expect(upload.body.data.imagePath).not.toBe(key)
    expect(await fs.readFile(path.join(mediaDir, key), 'utf8')).toBe('old illustration')
    const nextKey = upload.body.data.imagePath
    const tpl = db.prepare('INSERT INTO templates (user_id, title, grid_size) VALUES (?, ?, 3)').run(user.userId, 'shared')
    db.prepare('INSERT INTO template_cells (template_id, position, image_path) VALUES (?, 0, ?)').run(tpl.lastInsertRowid, nextKey)
    await request(app).delete(`/api/illustrations/${upload.body.data.id}`).set('Authorization', authHeader(user.token)).expect(200)
    expect(await fs.readFile(path.join(mediaDir, nextKey))).toEqual(image)
  })

  it('retains a shareable illustration orphan because later attachments can reuse it', async () => {
    const user = createTestUser()
    const key = 'illustrations/orphan.jpg'
    await writeMedia(key, 'unreferenced')
    const row = getDb().prepare('INSERT INTO illustrations (word, user_id, image_path) VALUES (?, ?, ?)').run('orphan', user.userId, key)
    await request(app).delete(`/api/illustrations/${row.lastInsertRowid}`).set('Authorization', authHeader(user.token)).expect(200)
    expect(await fs.readFile(path.join(mediaDir, key), 'utf8')).toBe('unreferenced')
    const served = await request(app).get(`/uploads/${key}`).expect(200)
    expect(served.body.toString()).toBe('unreferenced')
  })

  it('clones illustrations and completion even without a server photo or when copying a photo fails', async () => {
    const user = createTestUser()
    const board = await request(app).post('/api/boards').set('Authorization', authHeader(user.token)).send({})
    getDb().prepare("UPDATE cells SET illustration_path = 'templates/t2/c0.jpg', completed = 1, completed_at = '2026-01-01' WHERE board_id = ? AND position = 0").run(board.body.data.id)
    getDb().prepare("UPDATE cells SET image_name = 'photos/missing.jpg', completed = 1, completed_at = '2026-01-02' WHERE board_id = ? AND position = 1").run(board.body.data.id)
    const clone = await request(app).post(`/api/boards/${board.body.data.id}/clone`).set('Authorization', authHeader(user.token)).send({})
    expect(clone.status).toBe(201)
    expect(clone.body.data.cells[0]).toMatchObject({ illustrationPath: 'templates/t2/c0.jpg', completed: true, completedAt: '2026-01-01' })
    expect(clone.body.data.cells[1]).toMatchObject({ imageName: '', completed: true, completedAt: '2026-01-02' })
  })
})

const invalidCells = [
  null, 'cell', { position: 0, title: 7 }, { position: 0, title: null },
  { position: 0, title: 'word', completed: 'false' }, { position: 0, title: 'word', illustrationPath: {} },
  { position: -1, title: 'word' }, { position: 9, title: 'word' }, { position: 0.5, title: 'word' },
]

describe('write payload validation before side effects', () => {
  it.each(invalidCells)('rejects malformed board cells %j without moderation or writes', async cell => {
    const user = createTestUser()
    const board = await request(app).post('/api/boards').set('Authorization', authHeader(user.token)).send({})
    const response = await request(app).put(`/api/boards/${board.body.data.id}/cells`).set('Authorization', authHeader(user.token)).send({ cells: [cell] })
    expect(response.status).toBe(400)
    expect(checkText).not.toHaveBeenCalled()
    const read = await request(app).get(`/api/boards/${board.body.data.id}`).set('Authorization', authHeader(user.token))
    expect(read.body.data.cells).toEqual(board.body.data.cells)
  })

  it('rejects duplicate board positions while retaining partial updates', async () => {
    const user = createTestUser()
    const board = await request(app).post('/api/boards').set('Authorization', authHeader(user.token)).send({})
    const endpoint = `/api/boards/${board.body.data.id}/cells`
    await request(app).put(endpoint).set('Authorization', authHeader(user.token))
      .send({ cells: [{ position: 0, title: 'a' }, { position: 0, title: 'b' }] }).expect(400)
    expect(checkText).not.toHaveBeenCalled()
    await request(app).put(endpoint).set('Authorization', authHeader(user.token)).send({ cells: [{ position: 0, title: '', completed: false }] }).expect(200)
  })

  const malformedTemplates = [
    [], { title: 1 }, { title: 'x'.repeat(31) }, { description: {} }, { category: [] },
    { gridSize: '3' }, { gridSize: 3.5 }, { cells: [null, ...templateBody().cells.slice(1)] },
    { cells: templateBody().cells.map(c => ({ ...c, position: c.position + 99 })) },
    { cells: templateBody().cells.map(c => ({ ...c, position: 0 })) },
    { cells: templateBody().cells.map(c => ({ ...c, title: 42 })) },
    { cells: templateBody().cells.map(c => ({ ...c, title: 'x'.repeat(51) })) },
  ]

  it.each(['/api/templates', '/api/admin/templates'].flatMap(endpoint => malformedTemplates.map(invalid => ({ endpoint, invalid }))))('$endpoint rejects malformed template fields $invalid before persistence and moderation', async ({ endpoint, invalid }) => {
    const user = createTestUser()
    const body = Array.isArray(invalid) ? invalid : { ...templateBody(), ...invalid }
    const response = await request(app).post(endpoint).set('Authorization', endpoint.includes('/admin/') ? adminAuth : authHeader(user.token)).send(body)
    expect(response.status, JSON.stringify(body)).toBe(400)
    expect(checkText).not.toHaveBeenCalled()
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM templates').get()).toEqual({ n: 0 })
  })

  it('admin edits reject invalid objects, strings and incomplete position coverage without losing existing content', async () => {
    const created = await request(app).post('/api/admin/templates').set('Authorization', adminAuth).send(templateBody())
    for (const body of [[], { title: 5 }, { description: null }, { category: false }, { cells: 'bad' }, { cells: [] }, { cells: templateBody().cells.slice(1) }, { cells: templateBody().cells.map(c => ({ ...c, position: 0 })) }]) {
      const response = await request(app).put(`/api/admin/templates/${created.body.data.id}`).set('Authorization', adminAuth).send(body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM template_cells WHERE template_id = ?').get(created.body.data.id)).toEqual({ n: 9 })
    }
  })

  it('generated admin templates reject non-string words and oversized fields without writing', async () => {
    for (const body of [{ title: 'generated', words: [null, ...Array.from({ length: 24 }, (_, i) => `w${i}`)] }, { title: 'x'.repeat(31), words: Array.from({ length: 25 }, (_, i) => `w${i}`) }]) {
      const response = await request(app).post('/api/admin/templates/generate').set('Authorization', adminAuth).send(body)
      expect(response.status).toBe(400)
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM templates').get()).toEqual({ n: 0 })
    }
  })
})
