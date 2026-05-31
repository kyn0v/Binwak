import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config'

export interface JwtPayload {
  userId: number
  openid: string
}

/** Authenticated request with user info */
export interface AuthRequest extends Request {
  user?: JwtPayload
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: '未提供认证 token' })
    return
  }

  const token = authHeader.slice(7)

  try {
    const payload = jwt.verify(token, config.jwt.secret, {
      issuer: 'binwak',
      audience: 'binwak-client',
    }) as JwtPayload
    req.user = payload
    next()
  } catch {
    res.status(401).json({ success: false, error: 'token 无效或已过期' })
  }
}

/** Optional auth - parses token if present but doesn't require it */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const payload = jwt.verify(token, config.jwt.secret, {
        issuer: 'binwak',
        audience: 'binwak-client',
      }) as JwtPayload
      req.user = payload
    } catch {
      // Invalid token, but we don't fail - just proceed without user
    }
  }
  next()
}
