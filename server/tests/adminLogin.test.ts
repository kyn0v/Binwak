import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcrypt'
import { createApp } from '../src/app'

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

describe('Admin login', () => {
  beforeEach(() => {
    delete process.env.ADMIN_USERNAME
    delete process.env.ADMIN_PASSWORD
    delete process.env.ADMIN_PASSWORD_HASH
  })
  afterEach(() => restore())

  it('returns 503 when no credentials configured', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'x' })
    expect(res.status).toBe(503)
  })

  it('rejects the placeholder default password from .env.example', async () => {
    process.env.ADMIN_USERNAME = 'admin'
    process.env.ADMIN_PASSWORD = 'change-me-to-a-strong-password'
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'change-me-to-a-strong-password' })
    expect(res.status).toBe(503)
  })

  it('accepts plaintext ADMIN_PASSWORD when configured', async () => {
    process.env.ADMIN_USERNAME = 'admin'
    process.env.ADMIN_PASSWORD = 'real-secret-pwd'
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'real-secret-pwd' })
    expect(res.status).toBe(200)
    expect(res.body.data.token).toBeDefined()
  })

  it('rejects wrong plaintext password', async () => {
    process.env.ADMIN_USERNAME = 'admin'
    process.env.ADMIN_PASSWORD = 'real-secret-pwd'
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('accepts ADMIN_PASSWORD_HASH (bcrypt) when configured', async () => {
    process.env.ADMIN_USERNAME = 'opsuser'
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('hashed-secret', 4)
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'opsuser', password: 'hashed-secret' })
    expect(res.status).toBe(200)
    expect(res.body.data.token).toBeDefined()
  })

  it('rejects wrong password against bcrypt hash', async () => {
    process.env.ADMIN_USERNAME = 'opsuser'
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('hashed-secret', 4)
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'opsuser', password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('prefers ADMIN_PASSWORD_HASH over ADMIN_PASSWORD when both set', async () => {
    process.env.ADMIN_USERNAME = 'admin'
    process.env.ADMIN_PASSWORD = 'plaintext-only'
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('hash-wins', 4)
    const ok = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'hash-wins' })
    expect(ok.status).toBe(200)
    const fail = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'plaintext-only' })
    expect(fail.status).toBe(401)
  })
})
