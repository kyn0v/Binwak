import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import { getDb } from '../db/database'
import { code2Session } from '../services/wechat'
import { checkText } from '../services/moderation'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import type { LoginRequest, LoginResponse, ProfileResponse, UpdateProfileRequest, ApiResponse } from '../../../shared/types'

const router = Router()

/** Generate access token + refresh token pair */
function generateTokens(userId: number, openid: string) {
  const accessToken = jwt.sign(
    { userId, openid },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn, issuer: 'binwak', audience: 'binwak-client' } as jwt.SignOptions
  )
  const refreshToken = jwt.sign(
    { userId, openid, type: 'refresh' },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn, issuer: 'binwak', audience: 'binwak-client' } as jwt.SignOptions
  )
  return { accessToken, refreshToken }
}

/**
 * POST /api/auth/login
 * Exchange wx.login() code for JWT token
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.body as LoginRequest

    if (!code) {
      res.status(400).json({ success: false, error: '缺少 code 参数' } as ApiResponse)
      return
    }

    // 1. Exchange code for openid
    const wxResult = await code2Session(code)
    const { openid } = wxResult

    // 2. Find or create user
    const db = getDb()
    let user = db.prepare('SELECT id, openid, nickname FROM users WHERE openid = ?').get(openid) as
      | { id: number; openid: string; nickname: string }
      | undefined

    let isNewUser = false
    if (!user) {
      // Generate unique default nickname
      let defaultNickname = ''
      for (let i = 0; i < 10; i++) {
        const suffix = Math.random().toString(36).slice(2, 6)
        const candidate = `Binwak玩家_${suffix}`
        const exists = db.prepare('SELECT 1 FROM users WHERE nickname = ?').get(candidate)
        if (!exists) {
          defaultNickname = candidate
          break
        }
      }
      const result = db.prepare('INSERT INTO users (openid, nickname) VALUES (?, ?)').run(openid, defaultNickname)
      user = { id: result.lastInsertRowid as number, openid, nickname: defaultNickname }
      isNewUser = true
    }

    // 3. Issue access token + refresh token
    const { accessToken, refreshToken } = generateTokens(user.id, user.openid)

    const response: ApiResponse<LoginResponse> = {
      success: true,
      data: { token: accessToken, refreshToken, isNewUser, nickname: user.nickname || '' },
    }
    res.json(response)
  } catch (err) {
    console.error('[Auth] Login error:', err)
    res.status(500).json({
      success: false,
      error: '登录失败，请稍后再试',
    } as ApiResponse)
  }
})

/**
 * POST /api/auth/refresh
 * Exchange refresh token for new token pair
 */
router.post('/refresh', (req: Request, res: Response): void => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string }

    if (!refreshToken) {
      res.status(400).json({ success: false, error: '缺少 refreshToken 参数' } as ApiResponse)
      return
    }

    let payload: any
    try {
      payload = jwt.verify(refreshToken, config.jwt.refreshSecret, {
        issuer: 'binwak',
        audience: 'binwak-client',
      })
    } catch {
      res.status(401).json({ success: false, error: 'refresh token 无效或已过期，请重新登录' } as ApiResponse)
      return
    }

    if (payload.type !== 'refresh') {
      res.status(401).json({ success: false, error: '无效的 token 类型' } as ApiResponse)
      return
    }

    // Verify user still exists
    const db = getDb()
    const user = db.prepare('SELECT id, openid FROM users WHERE id = ?').get(payload.userId) as
      | { id: number; openid: string }
      | undefined

    if (!user) {
      res.status(401).json({ success: false, error: '用户不存在，请重新登录' } as ApiResponse)
      return
    }

    // Issue new token pair (refresh token rotation)
    const tokens = generateTokens(user.id, user.openid)

    res.json({
      success: true,
      data: { token: tokens.accessToken, refreshToken: tokens.refreshToken },
    } as ApiResponse)
  } catch (err) {
    console.error('[Auth] Refresh error:', err)
    res.status(500).json({
      success: false,
      error: '刷新 token 失败',
    } as ApiResponse)
  }
})

/**
 * GET /api/auth/profile
 */
router.get('/profile', authMiddleware, (req: AuthRequest, res: Response): void => {
  try {
    const db = getDb()
    const user = db.prepare('SELECT id, nickname, image_storage FROM users WHERE id = ?').get(req.user!.userId) as
      | { id: number; nickname: string; image_storage: string }
      | undefined

    if (!user) {
      res.status(401).json({ success: false, error: '用户不存在，请重新登录' } as ApiResponse)
      return
    }

    const response: ApiResponse<ProfileResponse> = {
      success: true,
      data: { userId: user.id, nickname: user.nickname || '', imageStorage: (user.image_storage as 'local' | 'cloud') || 'local' },
    }
    res.json(response)
  } catch (err) {
    console.error('[Auth] Get profile error:', err)
    res.status(500).json({
      success: false,
      error: '获取用户信息失败',
    } as ApiResponse)
  }
})

/**
 * PUT /api/auth/profile
 */
router.put('/profile', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { nickname, imageStorage } = req.body as UpdateProfileRequest

    if (nickname === undefined && imageStorage === undefined) {
      res.status(400).json({ success: false, error: '请提供要更新的字段' } as ApiResponse)
      return
    }

    const db = getDb()

    // Update imageStorage if provided
    if (imageStorage !== undefined) {
      if (imageStorage !== 'local' && imageStorage !== 'cloud') {
        res.status(400).json({ success: false, error: '无效的图片存储模式' } as ApiResponse)
        return
      }
      db.prepare('UPDATE users SET image_storage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(imageStorage, req.user!.userId)
    }

    // Update nickname if provided
    if (nickname !== undefined && nickname !== null) {
      const trimmed = String(nickname).trim().slice(0, 20)
      if (!trimmed) {
        res.status(400).json({ success: false, error: '昵称不能为空' } as ApiResponse)
        return
      }

      const modResult = await checkText(req.user!.openid, trimmed, 1)
      if (!modResult.pass) {
        res.status(400).json({ success: false, error: '内容含违规信息，请修改后重试' } as ApiResponse)
        return
      }

      const existing = db.prepare('SELECT id FROM users WHERE nickname = ? AND id != ?').get(trimmed, req.user!.userId) as any
      if (existing) {
        res.status(409).json({ success: false, error: '该昵称已被使用，请换一个' } as ApiResponse)
        return
      }

      try {
        db.prepare('UPDATE users SET nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(trimmed, req.user!.userId)
      } catch (err: any) {
        if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          res.status(409).json({ success: false, error: '该昵称已被使用，请换一个' } as ApiResponse)
          return
        }
        throw err
      }
    }

    const updated = db.prepare('SELECT id, nickname, image_storage FROM users WHERE id = ?').get(req.user!.userId) as
      { id: number; nickname: string; image_storage: string }

    const response: ApiResponse<ProfileResponse> = {
      success: true,
      data: { userId: updated.id, nickname: updated.nickname || '', imageStorage: (updated.image_storage as 'local' | 'cloud') || 'local' },
    }
    res.json(response)
  } catch (err) {
    console.error('[Auth] Update profile error:', err)
    res.status(500).json({
      success: false,
      error: '更新用户信息失败',
    } as ApiResponse)
  }
})

export default router
