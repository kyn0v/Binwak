/**
 * Admin authentication middleware
 *
 * Uses separate env-var based credentials (ADMIN_USERNAME / ADMIN_PASSWORD).
 * Issues JWT tokens with audience 'binwak-admin' to distinguish from
 * regular user tokens.
 *
 * Password may be supplied as either:
 *   - ADMIN_PASSWORD_HASH = a bcrypt hash (recommended for production), or
 *   - ADMIN_PASSWORD      = a plaintext password (dev / quick-start only)
 *
 * The well-known placeholder value `change-me-to-a-strong-password`
 * (shipped in .env.example) is rejected so deployments can't accidentally
 * boot with the default.
 */
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { config } from '../config'

export interface AdminPayload {
  role: 'admin'
  username: string
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminPayload
    }
  }
}

const ADMIN_AUDIENCE = 'binwak-admin'
const FORBIDDEN_DEFAULTS = new Set([
  'change-me-to-a-strong-password',
  'changeme',
  'admin',
  'password',
])

export interface AdminCredentials {
  username: string
  passwordHash: string | null
  passwordPlain: string | null
}

export function getAdminCredentials(): AdminCredentials {
  const username = process.env.ADMIN_USERNAME || ''
  const passwordHash = process.env.ADMIN_PASSWORD_HASH || ''
  const passwordPlain = process.env.ADMIN_PASSWORD || ''
  return {
    username,
    passwordHash: passwordHash || null,
    passwordPlain: passwordPlain && !FORBIDDEN_DEFAULTS.has(passwordPlain) ? passwordPlain : null,
  }
}

/** Returns true when the supplied password matches the configured admin secret. */
export async function verifyAdminPassword(input: string, creds: AdminCredentials): Promise<boolean> {
  if (creds.passwordHash) {
    try {
      return await bcrypt.compare(input, creds.passwordHash)
    } catch {
      return false
    }
  }
  if (creds.passwordPlain) {
    // Constant-time compare to defeat timing oracles.
    const a = Buffer.from(input.padEnd(128).slice(0, 128))
    const b = Buffer.from(creds.passwordPlain.padEnd(128).slice(0, 128))
    try {
      return crypto.timingSafeEqual(a, b)
    } catch {
      return false
    }
  }
  return false
}

import crypto from 'crypto'

export function generateAdminToken(username: string): string {
  return jwt.sign(
    { role: 'admin', username } as AdminPayload,
    config.jwt.secret,
    { expiresIn: '8h', issuer: 'binwak', audience: ADMIN_AUDIENCE } as jwt.SignOptions,
  )
}

export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: '未提供管理员 token' })
    return
  }

  const token = authHeader.slice(7)

  try {
    const payload = jwt.verify(token, config.jwt.secret, {
      issuer: 'binwak',
      audience: ADMIN_AUDIENCE,
    }) as AdminPayload

    if (payload.role !== 'admin') {
      res.status(403).json({ success: false, error: '权限不足' })
      return
    }
    req.admin = payload
    next()
  } catch {
    res.status(401).json({ success: false, error: '管理员 token 无效或已过期' })
  }
}
