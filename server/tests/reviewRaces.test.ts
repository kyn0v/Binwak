import { afterEach, expect, it, vi } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp } from '../src/app'
import { config } from '../src/config'
import { getDb, ensureSystemAdminUser } from '../src/db/database'
import { getStorage } from '../src/services/storage'
import { upsertIllustration } from '../src/services/imageUpload'
import { checkText } from '../src/services/moderation'
import { generateAdminToken } from '../src/middleware/adminAuth'
import { authHeader, createTestUser } from './helpers'

vi.mock('../src/services/moderation', () => ({
  checkText: vi.fn(async () => ({ pass: true })),
  checkImageSync: vi.fn(async () => ({ pass: true })),
  checkImage: vi.fn(async () => ({ submitted: true })),
}))

const app = createApp()
const adminAuth = authHeader(generateAdminToken('review-races'))
const templateBody = () => ({
  title: 'Snapshot', gridSize: 3,
  cells: Array.from({ length: 9 }, (_, position) => ({ position, title: `word${position}` })),
})

function gate() {
  let resolve = () => {}
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function write(key: string, value: string) {
  const file = path.join(config.storage.localDir, key)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, value)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(checkText).mockReset().mockResolvedValue({ pass: true })
})

it('older snapshot work cannot replace a recreated same-content cell', async () => {
  const db = getDb()
  const owner = ensureSystemAdminUser(db)
  const created = await request(app).post('/api/admin/templates').set('Authorization', adminAuth).send(templateBody()).expect(201)
  const id = created.body.data.id
  await write('illustrations/revision-old.jpg', 'OLD IMAGE')
  await write('illustrations/revision-new.jpg', 'NEW IMAGE')
  upsertIllustration(db, 'word0', owner, 'illustrations/revision-old.jpg')
  const storage = getStorage()
  const copy = storage.copy.bind(storage)
  const firstEntered = gate(), secondEntered = gate(), firstRelease = gate(), secondRelease = gate()
  vi.spyOn(storage, 'copy').mockImplementation(async (src, dest) => {
    await copy(src, dest)
    if (src.endsWith('revision-old.jpg')) { firstEntered.resolve(); await firstRelease.promise }
    if (src.endsWith('revision-new.jpg')) { secondEntered.resolve(); await secondRelease.promise }
  })
  const oldEdit = request(app).put(`/api/admin/templates/${id}`).set('Authorization', adminAuth)
    .send({ cells: templateBody().cells }).then(r => r)
  await firstEntered.promise
  upsertIllustration(db, 'word0', owner, 'illustrations/revision-new.jpg')
  const newEdit = request(app).put(`/api/admin/templates/${id}`).set('Authorization', adminAuth)
    .send({ cells: templateBody().cells }).then(r => r)
  await secondEntered.promise
  try {
    firstRelease.resolve()
    expect((await oldEdit).status).toBe(200)
    secondRelease.resolve()
    expect((await newEdit).status).toBe(200)
    const template = await request(app).get(`/api/templates/${id}`).expect(200)
    const image = await request(app).get(template.body.data.cells[0].imageUrl).expect(200)
    expect(image.body.toString()).toBe('NEW IMAGE')
  } finally {
    firstRelease.resolve(); secondRelease.resolve()
    await Promise.all([oldEdit, newEdit])
  }
})

it.each(['shrink', 'delete'] as const)('rejects the whole cell write if the board changes by %s during moderation', async change => {
  const user = createTestUser()
  const auth = authHeader(user.token)
  const created = await request(app).post('/api/boards').set('Authorization', auth).send({ gridSize: 4 }).expect(201)
  const id = created.body.data.id
  const entered = gate(), release = gate()
  vi.mocked(checkText).mockImplementationOnce(async () => {
    entered.resolve()
    await release.promise
    return { pass: true }
  })
  const saving = request(app).put(`/api/boards/${id}/cells`).set('Authorization', auth)
    .send({ cells: [{ position: 0, title: 'must not partially save' }, { position: 15, title: 'outside after shrink' }] }).then(r => r)
  await entered.promise
  try {
    if (change === 'shrink') {
      await request(app).put(`/api/boards/${id}`).set('Authorization', auth).send({ gridSize: 3 }).expect(200)
    } else {
      await request(app).post('/api/boards').set('Authorization', auth).send({}).expect(201)
      await request(app).delete(`/api/boards/${id}`).set('Authorization', auth).expect(200)
    }
    release.resolve()
    expect((await saving).status).toBe(change === 'shrink' ? 409 : 404)
    const read = await request(app).get(`/api/boards/${id}`).set('Authorization', auth)
    if (change === 'shrink') {
      expect(read.status).toBe(200)
      expect(read.body.data.cells).toEqual(created.body.data.cells.slice(0, 9))
    } else {
      expect(read.status).toBe(404)
    }
  } finally {
    release.resolve()
    await saving
  }
})

it('deleted shareable illustrations remain available for a later successful attachment', async () => {
  const user = createTestUser()
  const auth = authHeader(user.token)
  const key = 'illustrations/retained.jpg'
  await write(key, 'still needed')
  const row = getDb().prepare('INSERT INTO illustrations (word, user_id, image_path) VALUES (?, ?, ?)').run('word0', user.userId, key)
  const board = await request(app).post('/api/boards').set('Authorization', auth).send({}).expect(201)
  await request(app).delete(`/api/illustrations/${row.lastInsertRowid}`).set('Authorization', auth).expect(200)
  await request(app).put(`/api/boards/${board.body.data.id}/cells`).set('Authorization', auth)
    .send({ cells: [{ position: 0, title: 'word0', illustrationPath: key }] }).expect(200)
  const read = await request(app).get(`/api/boards/${board.body.data.id}`).set('Authorization', auth).expect(200)
  const image = await request(app).get(read.body.data.cells[0].illustrationUrl).expect(200)
  expect(image.body.toString()).toBe('still needed')
})

it('commits complete clone cells and pins captured media before awaiting the first photo copy', async () => {
  const user = createTestUser()
  const auth = authHeader(user.token)
  const db = getDb()
  const owner = ensureSystemAdminUser(db)
  await write('illustrations/clone-source.jpg', 'immutable illustration')
  upsertIllustration(db, 'word0', owner, 'illustrations/clone-source.jpg')
  const template = await request(app).post('/api/admin/templates').set('Authorization', adminAuth).send(templateBody()).expect(201)
  const id = template.body.data.id
  const source = await request(app).post(`/api/templates/${id}/use`).set('Authorization', auth).expect(201)
  const boardId = source.body.data.id
  await write('photos/clone-source.jpg', 'captured photo')
  db.prepare("UPDATE cells SET image_name = 'photos/clone-source.jpg', completed = 1 WHERE board_id = ? AND position = 1").run(boardId)
  const storage = getStorage()
  const copy = storage.copy.bind(storage)
  const entered = gate(), release = gate()
  vi.spyOn(storage, 'copy').mockImplementation(async (src, dest) => {
    if (src === 'photos/clone-source.jpg') { entered.resolve(); await release.promise }
    await copy(src, dest)
  })
  const cloning = request(app).post(`/api/boards/${boardId}/clone`).set('Authorization', auth).send({}).then(r => r)
  await entered.promise
  try {
    const list = await request(app).get('/api/boards').set('Authorization', auth).expect(200)
    const clone = list.body.data.find((board: { id: number }) => board.id !== boardId)
    const captured = await request(app).get(`/api/boards/${clone.id}`).set('Authorization', auth).expect(200)
    expect(captured.body.data.cells).toHaveLength(9)
    expect(captured.body.data.cells[0].illustrationPath).toBe(source.body.data.cells[0].illustrationPath)
    expect(captured.body.data.cells[1].imageName).toBe('photos/clone-source.jpg')
    await request(app).put(`/api/boards/${boardId}/cells`).set('Authorization', auth)
      .send({ cells: [{ position: 0, title: 'changed' }] }).expect(200)
    await request(app).post(`/api/boards/${boardId}/reset`).set('Authorization', auth).expect(200)
    await request(app).delete(`/api/admin/templates/${id}`).set('Authorization', adminAuth).expect(200)
    release.resolve()
    const result = await cloning
    expect(result.status).toBe(201)
    const illustration = await request(app).get(result.body.data.cells[0].illustrationUrl).expect(200)
    expect(illustration.body.toString()).toBe('immutable illustration')
    expect(result.body.data.cells[1].imageName).not.toBe('photos/clone-source.jpg')
    const photo = await request(app).get(result.body.data.cells[1].imageUrl).expect(200)
    expect(photo.body.toString()).toBe('captured photo')
  } finally {
    release.resolve()
    await cloning
  }
})

it.each(['reset', 'resize', 'delete'] as const)('does not restore a photo after a concurrent clone %s', async action => {
  const user = createTestUser()
  const auth = authHeader(user.token)
  const source = await request(app).post('/api/boards').set('Authorization', auth).send({ gridSize: 4 }).expect(201)
  const sourceId = source.body.data.id
  await write('photos/clone-edit.jpg', 'photo')
  getDb().prepare("UPDATE cells SET image_name = 'photos/clone-edit.jpg', completed = 1 WHERE board_id = ? AND position = 15").run(sourceId)
  const storage = getStorage()
  const copy = storage.copy.bind(storage)
  const entered = gate(), release = gate()
  let destination = ''
  vi.spyOn(storage, 'copy').mockImplementation(async (src, dest) => {
    destination = dest
    entered.resolve()
    await release.promise
    await copy(src, dest)
  })
  const cloning = request(app).post(`/api/boards/${sourceId}/clone`).set('Authorization', auth).send({}).then(r => r)
  await entered.promise
  try {
    const list = await request(app).get('/api/boards').set('Authorization', auth).expect(200)
    const clone = list.body.data.find((board: { id: number }) => board.id !== sourceId)
    if (action === 'reset') {
      await request(app).post(`/api/boards/${clone.id}/reset`).set('Authorization', auth).expect(200)
    } else if (action === 'resize') {
      await request(app).put(`/api/boards/${clone.id}`).set('Authorization', auth).send({ gridSize: 3 }).expect(200)
    } else {
      await request(app).delete(`/api/boards/${clone.id}`).set('Authorization', auth).expect(200)
    }
    release.resolve()
    const result = await cloning
    expect(result.status).toBe(action === 'delete' ? 404 : 201)
    if (action !== 'delete') {
      expect(result.body.data.cells).toHaveLength(action === 'resize' ? 9 : 16)
      expect(result.body.data.cells.every((cell: { completed: boolean; imageName: string }) => !cell.completed && cell.imageName === '')).toBe(true)
    }
    await expect(fs.access(path.join(config.storage.localDir, destination))).rejects.toThrow()
  } finally {
    release.resolve()
    await cloning
  }
})
