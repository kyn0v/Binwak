import { describe, it, expect } from 'vitest'
import request from 'supertest'
import path from 'path'
import fs from 'fs'
import { createApp } from '../src/app'
import { createTestUser, authHeader } from './helpers'

const app = createApp()

// Create a minimal test image (1x1 JPEG).
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwh' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR' +
  'CAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAA' +
  'AAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAFBv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhED' +
  'EQA/AKpgA//Z',
  'base64'
)

const TEST_IMAGE_PATH = path.resolve(__dirname, 'test-image.jpg')

describe('Upload API', () => {
  // Create a temporary test image.
  beforeAll(() => {
    fs.writeFileSync(TEST_IMAGE_PATH, TINY_JPEG)
  })

  afterAll(() => {
    // Clean up the test image.
    try { fs.unlinkSync(TEST_IMAGE_PATH) } catch {}
  })

  it('rejects request without auth', async () => {
    const res = await request(app)
      .post('/api/upload')
      .attach('image', TEST_IMAGE_PATH)

    expect(res.status).toBe(401)
  })

  it('uploads an image file', async () => {
    const { token } = createTestUser()
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', authHeader(token))
      .attach('image', TEST_IMAGE_PATH)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.fileName).toMatch(/^photos\/u\d+\/[0-9a-f]{32}\.jpg$/)
    expect(res.body.data.url).toMatch(/^\/uploads\//)
    expect(res.body.data.url).toBe(`/uploads/${res.body.data.fileName}`)

    // Clean up uploaded file — key now includes subdirectories
    const uploadedPath = path.resolve(__dirname, '..', 'uploads', res.body.data.fileName)
    try { fs.unlinkSync(uploadedPath) } catch {}
  })

  it('uploads image and auto-completes cell when boardId + position given', async () => {
    const { token } = createTestUser()

    // Create a board first
    const board = await request(app)
      .post('/api/boards')
      .set('Authorization', authHeader(token))
      .send({ gridSize: 3 })

    const boardId = board.body.data.id

    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', authHeader(token))
      .field('boardId', String(boardId))
      .field('position', '0')
      .attach('image', TEST_IMAGE_PATH)

    expect(res.status).toBe(200)

    // Verify cell is completed
    const detail = await request(app)
      .get(`/api/boards/${boardId}`)
      .set('Authorization', authHeader(token))

    const cell = detail.body.data.cells[0]
    expect(cell.completed).toBe(true)
    expect(cell.imageName).toBe(res.body.data.fileName)
    expect(cell.imageUrl).toBe(res.body.data.url)

    // Clean up
    const uploadedPath = path.resolve(__dirname, '..', 'uploads', res.body.data.fileName)
    try { fs.unlinkSync(uploadedPath) } catch {}
  })

  it('returns 400 when no file is attached', async () => {
    const { token } = createTestUser()
    const res = await request(app)
      .post('/api/upload')
      .set('Authorization', authHeader(token))

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('文件')
  })

  describe('GET /api/upload/presigned', () => {
    it('rejects path traversal in key', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .get('/api/upload/presigned?key=../../etc/passwd')
        .set('Authorization', authHeader(token))
      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })

    it('rejects absolute path key', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .get('/api/upload/presigned?key=/etc/passwd')
        .set('Authorization', authHeader(token))
      expect(res.status).toBe(400)
    })

    it('rejects access to another user namespace', async () => {
      const { token, userId } = createTestUser()
      const otherUserId = userId + 999
      const res = await request(app)
        .get(`/api/upload/presigned?key=photos/u${otherUserId}/abc.jpg`)
        .set('Authorization', authHeader(token))
      expect(res.status).toBe(403)
    })

    it('allows access to own namespace', async () => {
      const { token, userId } = createTestUser()
      const res = await request(app)
        .get(`/api/upload/presigned?key=photos/u${userId}/abc.jpg`)
        .set('Authorization', authHeader(token))
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(typeof res.body.data.url).toBe('string')
    })

    it('rejects missing key', async () => {
      const { token } = createTestUser()
      const res = await request(app)
        .get('/api/upload/presigned')
        .set('Authorization', authHeader(token))
      expect(res.status).toBe(400)
    })
  })
})
