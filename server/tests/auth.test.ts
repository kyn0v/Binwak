import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app'
import { createTestUser, createExpiredToken, authHeader } from './helpers'

vi.mock('../src/services/wechat', () => ({
  code2Session: vi.fn().mockRejectedValue(new Error('invalid appid')),
}))

const app = createApp()

describe('Health Check', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.status).toBe('ok')
  })
})

describe('Auth Middleware', () => {
  it('rejects requests without Authorization header', async () => {
    const res = await request(app).get('/api/boards')
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('token')
  })

  it('rejects requests with invalid token', async () => {
    const res = await request(app)
      .get('/api/boards')
      .set('Authorization', 'Bearer invalid-token')
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('rejects requests with expired token', async () => {
    const expiredToken = createExpiredToken()
    const res = await request(app)
      .get('/api/boards')
      .set('Authorization', authHeader(expiredToken))
    expect(res.status).toBe(401)
  })

  it('accepts requests with valid token', async () => {
    const { token } = createTestUser()
    const res = await request(app)
      .get('/api/boards')
      .set('Authorization', authHeader(token))
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

describe('POST /api/auth/login', () => {
  it('returns 400 when code is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('code')
  })

  it('returns 500 when WeChat rejects the login credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ code: 'test-code' })
    expect(res.status).toBe(500)
    expect(res.body.success).toBe(false)
  })
})
