/**
 * Test helpers for generating JWT tokens and creating test users.
 */
import jwt from 'jsonwebtoken'
import { config } from '../src/config'
import { getDb } from '../src/db/database'
import type { JwtPayload } from '../src/middleware/auth'

/** Create a test user in the database and return { userId, openid, token }. */
export function createTestUser(openid = 'test-openid-001') {
  const db = getDb()
  const nickname = `测试用户_${openid.slice(-6)}`
  const result = db.prepare('INSERT INTO users (openid, nickname) VALUES (?, ?)').run(openid, nickname)
  const userId = result.lastInsertRowid as number

  const payload: JwtPayload = { userId, openid }
  const token = jwt.sign(payload, config.jwt.secret, { expiresIn: '1h', issuer: 'binwak', audience: 'binwak-client' })

  return { userId, openid, token }
}

/** Generate an expired JWT token. */
export function createExpiredToken(userId = 1, openid = 'test-openid-001') {
  return jwt.sign({ userId, openid }, config.jwt.secret, { expiresIn: '-1s', issuer: 'binwak', audience: 'binwak-client' })
}

/** Authorization header value. */
export function authHeader(token: string) {
  return `Bearer ${token}`
}
