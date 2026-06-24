/**
 * Admin API routes
 *
 * All routes (except /login) are protected by adminAuthMiddleware.
 */
import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { ensureSystemAdminUser, getDb } from '../db/database'
import { getStorage } from '../services/storage'
import { config } from '../config'
import { prepareImageForStorage, cleanupFiles } from '../services/imageProcessing'
import { imageMulter, upsertIllustration, deleteStorageObjectQuietly } from '../services/imageUpload'
import {
  adminAuthMiddleware,
  getAdminCredentials,
  generateAdminToken,
  verifyAdminPassword,
} from '../middleware/adminAuth'
import type { ApiResponse } from '../../../shared/types'
import { validateIdParam } from '../middleware/validate'
import { validateWebhookUrl } from '../utils/urlSafety'
import { copyIllustrationsToTemplate } from '../services/templateSnapshot'

const router = Router()

// ── POST /api/admin/login ──
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body as { username?: string; password?: string }
  const creds = getAdminCredentials()

  if (!creds.username || (!creds.passwordHash && !creds.passwordPlain)) {
    res.status(503).json({ success: false, error: '管理员账号未配置' } as ApiResponse)
    return
  }

  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ success: false, error: '请输入用户名和密码' } as ApiResponse)
    return
  }

  // Constant-time username comparison
  const usernameMatch = (() => {
    const a = Buffer.from(username.padEnd(64).slice(0, 64))
    const b = Buffer.from(creds.username.padEnd(64).slice(0, 64))
    try { return crypto.timingSafeEqual(a, b) } catch { return false }
  })()
  const passwordMatch = await verifyAdminPassword(password, creds)

  if (!usernameMatch || !passwordMatch) {
    res.status(401).json({ success: false, error: '用户名或密码错误' } as ApiResponse)
    return
  }

  const token = generateAdminToken(username)
  res.json({ success: true, data: { token } } as ApiResponse)
})

// All routes below require admin auth
router.use(adminAuthMiddleware)

// ── GET /api/admin/stats ── Dashboard overview
router.get('/stats', (_req: Request, res: Response): void => {
  const db = getDb()

  const userStats = db.prepare(`
    SELECT
      COUNT(*) as totalUsers,
      COUNT(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 END) as newUsers30d,
      COUNT(CASE WHEN updated_at >= datetime('now', '-7 days') THEN 1 END) as activeUsers7d,
      COUNT(CASE WHEN updated_at >= datetime('now', '-1 day') THEN 1 END) as activeUsers1d
    FROM users
  `).get() as any

  const boardStats = db.prepare(`
    SELECT
      COUNT(*) as totalBoards,
      COUNT(CASE WHEN is_active = 1 THEN 1 END) as activeBoards,
      ROUND(AVG(grid_size), 1) as avgGridSize
    FROM boards
  `).get() as any

  const templateStats = db.prepare(`
    SELECT
      COUNT(CASE WHEN status = 'active' THEN 1 END) as activeTemplates,
      COUNT(CASE WHEN status = 'hidden' THEN 1 END) as hiddenTemplates,
      COUNT(CASE WHEN status = 'deleted' THEN 1 END) as deletedTemplates,
      SUM(CASE WHEN status = 'active' THEN use_count ELSE 0 END) as totalUses,
      SUM(CASE WHEN status = 'active' THEN favorite_count ELSE 0 END) as totalFavorites
    FROM templates
  `).get() as any

  const illustrationStats = db.prepare(`
    SELECT COUNT(*) as totalIllustrations FROM illustrations
  `).get() as any

  // Daily new users (last 30 days)
  const dailyNewUsers = db.prepare(`
    SELECT strftime('%Y-%m-%d', created_at) as date, COUNT(*) as count
    FROM users
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY date
    ORDER BY date
  `).all() as Array<{ date: string; count: number }>

  // Template category distribution
  const categoryDistribution = db.prepare(`
    SELECT category, COUNT(*) as count, SUM(use_count) as totalUses
    FROM templates
    WHERE status = 'active'
    GROUP BY category
    ORDER BY count DESC
  `).all() as Array<{ category: string; count: number; totalUses: number }>

  res.json({
    success: true,
    data: {
      users: userStats,
      boards: boardStats,
      templates: templateStats,
      illustrations: illustrationStats,
      dailyNewUsers,
      categoryDistribution,
    },
  } as ApiResponse)
})

// ── GET /api/admin/users ── User list with pagination & search
router.get('/users', (req: Request, res: Response): void => {
  const db = getDb()
  const page = Math.max(1, parseInt(req.query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
  const offset = (page - 1) * limit
  const search = (req.query.search as string || '').trim()
  const sort = (req.query.sort as string) || 'newest'

  const conditions: string[] = []
  const params: any[] = []

  if (search) {
    conditions.push("(u.nickname LIKE ? OR CAST(u.id AS TEXT) = ?)")
    params.push(`%${search}%`, search)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const orderBy = sort === 'oldest' ? 'u.created_at ASC' : 'u.created_at DESC'

  const { total } = db.prepare(`SELECT COUNT(*) as total FROM users u ${where}`).get(...params) as { total: number }

  const rows = db.prepare(`
    SELECT u.id, u.nickname, u.created_at, u.updated_at,
      (SELECT COUNT(*) FROM boards WHERE user_id = u.id) as boardCount,
      (SELECT COUNT(*) FROM templates WHERE user_id = u.id AND status != 'deleted') as templateCount,
      (SELECT COUNT(*) FROM word_banks WHERE user_id = u.id) as wordCount,
      (SELECT COUNT(*) FROM illustrations WHERE user_id = u.id) as illustrationCount
    FROM users u
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset)

  res.json({ success: true, data: { users: rows, total, page, limit } } as ApiResponse)
})

// ── GET /api/admin/users/:id ── User detail
router.get('/users/:id', (req: Request, res: Response): void => {
  const db = getDb()
  const userId = parseInt(req.params.id as string)
  if (!Number.isFinite(userId) || userId < 1) {
    res.status(400).json({ success: false, error: '无效的用户 ID' } as ApiResponse)
    return
  }

  const user = db.prepare(`
    SELECT id, nickname, created_at, updated_at FROM users WHERE id = ?
  `).get(userId) as any

  if (!user) {
    res.status(404).json({ success: false, error: '用户不存在' } as ApiResponse)
    return
  }

  const boards = db.prepare(`
    SELECT b.id, b.title, b.grid_size, b.theme, b.is_active, b.is_favorite, b.created_at, b.updated_at,
      COUNT(CASE WHEN c.completed = 1 THEN 1 END) as completedCount,
      COUNT(c.id) as totalCells
    FROM boards b
    LEFT JOIN cells c ON b.id = c.board_id
    WHERE b.user_id = ?
    GROUP BY b.id
    ORDER BY b.updated_at DESC
  `).all(userId)

  const templates = db.prepare(`
    SELECT id, title, grid_size, category, status, use_count, favorite_count, is_pinned, created_at
    FROM templates WHERE user_id = ? AND status != 'deleted'
    ORDER BY created_at DESC
  `).all(userId)

  const wordCount = (db.prepare('SELECT COUNT(*) as cnt FROM word_banks WHERE user_id = ?').get(userId) as any).cnt
  const illustrationCount = (db.prepare('SELECT COUNT(*) as cnt FROM illustrations WHERE user_id = ?').get(userId) as any).cnt

  res.json({
    success: true,
    data: { user, boards, templates, wordCount, illustrationCount },
  } as ApiResponse)
})

// ── DELETE /api/admin/users/:id ── 删除用户及其全部数据
router.delete('/users/:id', (req: Request, res: Response): void => {
  const db = getDb()
  const userId = parseInt(req.params.id as string)
  if (!Number.isFinite(userId) || userId < 1) {
    res.status(400).json({ success: false, error: '无效的用户 ID' } as ApiResponse)
    return
  }

  const user = db.prepare('SELECT id, kind FROM users WHERE id = ?').get(userId) as
    | { id: number; kind: string }
    | undefined
  if (!user) {
    res.status(404).json({ success: false, error: '用户不存在' } as ApiResponse)
    return
  }
  // The admin's own backing account (kind='system', see ensureSystemAdminUser)
  // owns shared defaults (e.g. seeded plaza templates); removing it would break
  // the admin site / plaza, so it is protected.
  if (user.kind === 'system') {
    res.status(403).json({ success: false, error: '系统账号不可删除' } as ApiResponse)
    return
  }

  // foreign_keys is ON (database.ts) and every user_id FK is ON DELETE CASCADE,
  // so deleting the user row also clears their boards/cells/templates/
  // template_cells/word_banks/illustrations/favorites/uses. Uploaded image files
  // on disk are intentionally left in place: some storage keys can be shared
  // (e.g. seeded illustrations), and removing them could affect other users —
  // orphaned files are harmless and can be garbage-collected separately.
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(userId)

  res.json({ success: true, data: { deleted: info.changes } } as ApiResponse)
})

// ── GET /api/admin/templates/:id ── Get single template with cells
router.get('/templates/:id', (req: Request, res: Response): void => {
  const db = getDb()
  const id = parseInt(req.params.id as string)

  const tpl = db.prepare(`
    SELECT t.*, u.nickname as authorName
    FROM templates t LEFT JOIN users u ON t.user_id = u.id
    WHERE t.id = ?
  `).get(id) as any

  if (!tpl) {
    res.status(404).json({ success: false, error: '模板不存在' } as ApiResponse)
    return
  }

  const cells = db.prepare('SELECT position, title FROM template_cells WHERE template_id = ? ORDER BY position').all(id)
  tpl.cells = cells

  res.json({ success: true, data: tpl } as ApiResponse)
})

// ── GET /api/admin/templates ── Template list with moderation
router.get('/templates', (req: Request, res: Response): void => {
  const db = getDb()
  const page = Math.max(1, parseInt(req.query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
  const offset = (page - 1) * limit
  const status = req.query.status as string || ''
  const category = req.query.category as string || ''
  const search = (req.query.search as string || '').trim()
  const sort = (req.query.sort as string) || 'newest'

  const conditions: string[] = []
  const params: any[] = []

  if (status) {
    conditions.push('t.status = ?')
    params.push(status)
  }
  if (category) {
    conditions.push('t.category = ?')
    params.push(category)
  }
  if (search) {
    conditions.push('t.title LIKE ?')
    params.push(`%${search}%`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  let orderBy: string
  switch (sort) {
    case 'popular': orderBy = 't.use_count DESC, t.id DESC'; break
    case 'favorites': orderBy = 't.favorite_count DESC, t.id DESC'; break
    case 'oldest': orderBy = 't.created_at ASC, t.id ASC'; break
    default: orderBy = 't.created_at DESC, t.id DESC'
  }

  const { total } = db.prepare(`SELECT COUNT(*) as total FROM templates t ${where}`).get(...params) as { total: number }

  const rows = db.prepare(`
    SELECT t.id, t.title, t.description, t.grid_size, t.category, t.status,
      t.is_pinned, t.favorite_count, t.use_count, t.created_at, t.updated_at,
      u.nickname as authorName
    FROM templates t
    LEFT JOIN users u ON t.user_id = u.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset)

  res.json({ success: true, data: { templates: rows, total, page, limit } } as ApiResponse)
})

// ── PATCH /api/admin/templates/:id/pin ── Toggle pin
router.patch('/templates/:id/pin', (req: Request, res: Response): void => {
  const db = getDb()
  const id = parseInt(req.params.id as string)

  const tpl = db.prepare('SELECT id, is_pinned FROM templates WHERE id = ?').get(id) as any
  if (!tpl) {
    res.status(404).json({ success: false, error: '模板不存在' } as ApiResponse)
    return
  }

  const newVal = tpl.is_pinned ? 0 : 1
  db.prepare('UPDATE templates SET is_pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newVal, id)

  res.json({ success: true, data: { isPinned: !!newVal } } as ApiResponse)
})

// ── PATCH /api/admin/templates/:id/status ── Change status (active/hidden)
router.patch('/templates/:id/status', (req: Request, res: Response): void => {
  const db = getDb()
  const id = parseInt(req.params.id as string)
  const { status } = req.body as { status?: string }

  if (!status || !['active', 'hidden'].includes(status)) {
    res.status(400).json({ success: false, error: 'status 必须为 active 或 hidden' } as ApiResponse)
    return
  }

  const tpl = db.prepare('SELECT id FROM templates WHERE id = ?').get(id) as any
  if (!tpl) {
    res.status(404).json({ success: false, error: '模板不存在' } as ApiResponse)
    return
  }

  db.prepare('UPDATE templates SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id)

  res.json({ success: true, data: { status } } as ApiResponse)
})

// ── GET /api/admin/system ── System info
router.get('/system', (_req: Request, res: Response): void => {
  let dbSize = 0
  try {
    const stat = fs.statSync(config.dbPath)
    dbSize = stat.size
  } catch { /* ignore */ }

  let uploadsSize = 0
  let uploadsCount = 0
  try {
    const walkDir = (dir: string) => {
      if (!fs.existsSync(dir)) return
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walkDir(fullPath)
        } else {
          uploadsSize += fs.statSync(fullPath).size
          uploadsCount++
        }
      }
    }
    walkDir(config.uploadDir)
  } catch { /* ignore */ }

  res.json({
    success: true,
    data: {
      nodeVersion: process.version,
      uptime: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage(),
      dbSizeBytes: dbSize,
      uploadsSizeBytes: uploadsSize,
      uploadsFileCount: uploadsCount,
      storageDriver: config.storage.driver,
    },
  } as ApiResponse)
})

// ── Admin Word Bank Management ──

function getAdminUserId(): number | null {
  try {
    return ensureSystemAdminUser(getDb())
  } catch {
    return null
  }
}

// GET /api/admin/wordbank - list admin's word bank
router.get('/wordbank', (req: Request, res: Response): void => {
  const adminUserId = getAdminUserId()
  if (!adminUserId) {
    res.status(500).json({ success: false, error: '系统用户初始化失败' } as ApiResponse)
    return
  }

  const db = getDb()
  const rows = db
    .prepare('SELECT id, word, sort_order FROM word_banks WHERE user_id = ? ORDER BY sort_order')
    .all(adminUserId) as Array<{ id: number; word: string; sort_order: number }>

  // Also fetch illustrations for these words
  const storageDriver = getStorage()
  const illustRows = db
    .prepare("SELECT word, image_path FROM illustrations WHERE user_id = ?")
    .all(adminUserId) as Array<{ word: string; image_path: string }>

  const illustMap: Record<string, string> = {}
  for (const r of illustRows) {
    if (!illustMap[r.word]) {
      illustMap[r.word] = storageDriver.getImageUrl(r.image_path)
    }
  }

  const words = rows.map((r) => ({
    id: r.id,
    word: r.word,
    sortOrder: r.sort_order,
    illustrationUrl: illustMap[r.word] || null,
  }))

  res.json({ success: true, data: { words, adminUserId } } as ApiResponse)
})

// POST /api/admin/wordbank - add word to admin's bank
router.post('/wordbank', (req: Request, res: Response): void => {
  const adminUserId = getAdminUserId()
  if (!adminUserId) {
    res.status(500).json({ success: false, error: '系统用户初始化失败' } as ApiResponse)
    return
  }

  const db = getDb()
  const { word } = req.body as { word?: string }

  if (!word || !word.trim()) {
    res.status(400).json({ success: false, error: '词语不能为空' } as ApiResponse)
    return
  }

  if (word.trim().length > 80) {
    res.status(400).json({ success: false, error: '词语不能超过 80 字符' } as ApiResponse)
    return
  }

  const maxRow = db
    .prepare('SELECT MAX(sort_order) as max_order FROM word_banks WHERE user_id = ?')
    .get(adminUserId) as { max_order: number | null }
  const nextOrder = (maxRow?.max_order ?? -1) + 1

  try {
    const result = db
      .prepare('INSERT INTO word_banks (user_id, word, sort_order) VALUES (?, ?, ?)')
      .run(adminUserId, word.trim(), nextOrder)

    res.status(201).json({
      success: true,
      data: { id: result.lastInsertRowid, word: word.trim(), sortOrder: nextOrder },
    } as ApiResponse)
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ success: false, error: '词语已存在' } as ApiResponse)
    } else {
      throw err
    }
  }
})

// DELETE /api/admin/wordbank/:id - delete word from admin's bank
router.delete('/wordbank/:id', (req: Request, res: Response): void => {
  const adminUserId = getAdminUserId()
  if (!adminUserId) {
    res.status(500).json({ success: false, error: '系统用户初始化失败' } as ApiResponse)
    return
  }

  const db = getDb()
  const wordId = parseInt(req.params.id as string)
  if (isNaN(wordId)) {
    res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse)
    return
  }

  const result = db
    .prepare('DELETE FROM word_banks WHERE id = ? AND user_id = ?')
    .run(wordId, adminUserId)

  if (result.changes === 0) {
    res.status(404).json({ success: false, error: '词语不存在' } as ApiResponse)
    return
  }

  res.json({ success: true } as ApiResponse)
})

// POST /api/admin/wordbank/batch - batch add words
router.post('/wordbank/batch', (req: Request, res: Response): void => {
  const adminUserId = getAdminUserId()
  if (!adminUserId) {
    res.status(500).json({ success: false, error: '系统用户初始化失败' } as ApiResponse)
    return
  }

  const db = getDb()
  const { words } = req.body as { words?: string[] }

  if (!Array.isArray(words) || words.length === 0) {
    res.status(400).json({ success: false, error: 'words 必须是非空字符串数组' } as ApiResponse)
    return
  }

  const maxRow = db
    .prepare('SELECT MAX(sort_order) as max_order FROM word_banks WHERE user_id = ?')
    .get(adminUserId) as { max_order: number | null }
  let nextOrder = (maxRow?.max_order ?? -1) + 1

  const insert = db.prepare('INSERT OR IGNORE INTO word_banks (user_id, word, sort_order) VALUES (?, ?, ?)')
  let added = 0

  const batchInsert = db.transaction(() => {
    for (const w of words) {
      const trimmed = w?.trim()
      if (!trimmed) continue
      const result = insert.run(adminUserId, trimmed, nextOrder)
      if (result.changes > 0) {
        added++
        nextOrder++
      }
    }
  })
  batchInsert()

  res.json({ success: true, data: { added, total: words.length } } as ApiResponse)
})

// POST /api/admin/templates/generate - Generate template from word bank
router.post('/templates/generate', async (req: Request, res: Response): Promise<void> => {
  const adminUserId = getAdminUserId()
  if (!adminUserId) {
    res.status(500).json({ success: false, error: '系统用户初始化失败' } as ApiResponse)
    return
  }

  const db = getDb()
  const { title, description, words, category } = req.body as {
    title?: string
    description?: string
    words?: string[]
    category?: string
  }

  if (!title || !title.trim()) {
    res.status(400).json({ success: false, error: '标题不能为空' } as ApiResponse)
    return
  }

  if (!words || !Array.isArray(words) || words.length !== 25) {
    res.status(400).json({ success: false, error: '必须选择 25 个词语' } as ApiResponse)
    return
  }

  const uniqueWords = new Set(words.map(w => w.trim()))
  if (uniqueWords.size !== 25) {
    res.status(400).json({ success: false, error: '存在重复词语' } as ApiResponse)
    return
  }

  const validCategory = category || 'creative'

  const insertTemplate = db.prepare(`
    INSERT INTO templates (user_id, title, description, grid_size, category, status)
    VALUES (?, ?, ?, 5, ?, 'active')
  `)

  const insertCell = db.prepare(`
    INSERT INTO template_cells (template_id, position, title)
    VALUES (?, ?, ?)
  `)

  const transaction = db.transaction(() => {
    const result = insertTemplate.run(adminUserId, title.trim(), description?.trim() || '', validCategory)
    const templateId = result.lastInsertRowid as number

    words.forEach((word, idx) => {
      insertCell.run(templateId, idx, word.trim())
    })

    return templateId
  })

  const templateId = transaction()

  // Copy admin's illustrations into template snapshot
  await copyIllustrationsToTemplate(db, templateId, adminUserId, words.map(w => w.trim()))

  res.json({ success: true, data: { templateId } } as ApiResponse)
})

// ── PUT /api/admin/templates/:id ── Update template content
router.put('/templates/:id', async (req: Request, res: Response): Promise<void> => {
  const db = getDb()
  const id = parseInt(req.params.id as string)
  const { title, description, category, cells } = req.body as {
    title?: string
    description?: string
    category?: string
    cells?: Array<{ position: number; title: string }>
  }

  const tpl = db.prepare('SELECT id, grid_size FROM templates WHERE id = ?').get(id) as any
  if (!tpl) {
    res.status(404).json({ success: false, error: '模板不存在' } as ApiResponse)
    return
  }

  if (title !== undefined && !title.trim()) {
    res.status(400).json({ success: false, error: '标题不能为空' } as ApiResponse)
    return
  }

  let oldSnapshotKeys: string[] = []
  if (cells && Array.isArray(cells)) {
    const rows = db.prepare(
      "SELECT image_path FROM template_cells WHERE template_id = ? AND image_path != ''"
    ).all(id) as Array<{ image_path: string }>
    oldSnapshotKeys = [...new Set(rows.map(r => r.image_path).filter(Boolean))]
  }

  const transaction = db.transaction(() => {
    if (title !== undefined) {
      db.prepare('UPDATE templates SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(title.trim(), id)
    }
    if (description !== undefined) {
      db.prepare('UPDATE templates SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(description.trim(), id)
    }
    if (category !== undefined) {
      db.prepare('UPDATE templates SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(category, id)
    }
    if (cells && Array.isArray(cells)) {
      db.prepare('DELETE FROM template_cells WHERE template_id = ?').run(id)
      const insertCell = db.prepare('INSERT INTO template_cells (template_id, position, title) VALUES (?, ?, ?)')
      for (const cell of cells) {
        insertCell.run(id, cell.position, cell.title?.trim() || '')
      }
    }
  })

  transaction()

  if (cells && Array.isArray(cells)) {
    const adminUserId = getAdminUserId()
    if (!adminUserId) {
      res.status(500).json({ success: false, error: '系统用户初始化失败' } as ApiResponse)
      return
    }
    const storage = getStorage()
    for (const key of oldSnapshotKeys) {
      await storage.delete(key).catch(() => {})
    }
    await copyIllustrationsToTemplate(db, id, adminUserId, cells.map(c => c.title?.trim() || ''))
  }
  res.json({ success: true, data: { id } } as ApiResponse)
})

// ── DELETE /api/admin/templates/:id ── Hard delete template
router.delete('/templates/:id', async (req: Request, res: Response): Promise<void> => {
  const db = getDb()
  const id = parseInt(req.params.id as string)

  const tpl = db.prepare('SELECT id FROM templates WHERE id = ?').get(id) as any
  if (!tpl) {
    res.status(404).json({ success: false, error: '模板不存在' } as ApiResponse)
    return
  }

  const snapshotRows = db.prepare(
    "SELECT image_path FROM template_cells WHERE template_id = ? AND image_path != ''"
  ).all(id) as Array<{ image_path: string }>
  const snapshotKeys = [...new Set(snapshotRows.map(r => r.image_path).filter(Boolean))]

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM template_cells WHERE template_id = ?').run(id)
    db.prepare('DELETE FROM template_favorites WHERE template_id = ?').run(id)
    db.prepare('DELETE FROM template_uses WHERE template_id = ?').run(id)
    db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  })

  transaction()
  const storage = getStorage()
  for (const key of snapshotKeys) {
    await storage.delete(key).catch(() => {})
  }
  res.json({ success: true } as ApiResponse)
})

// ── POST /api/admin/templates ── Create template as admin
router.post('/templates', async (req: Request, res: Response): Promise<void> => {
  const adminUserId = getAdminUserId()
  if (!adminUserId) {
    res.status(500).json({ success: false, error: '系统用户初始化失败' } as ApiResponse)
    return
  }

  const db = getDb()
  const { title, description, gridSize, cells, category } = req.body

  if (!title || typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ success: false, error: '标题不能为空' } as ApiResponse)
    return
  }
  if (!gridSize || gridSize < 3 || gridSize > 6) {
    res.status(400).json({ success: false, error: 'gridSize 必须在 3~6 之间' } as ApiResponse)
    return
  }
  const expectedCells = gridSize * gridSize
  if (!cells || !Array.isArray(cells) || cells.length !== expectedCells) {
    res.status(400).json({ success: false, error: `cells 数量必须等于 ${expectedCells}` } as ApiResponse)
    return
  }

  let templateId: number
  const create = db.transaction(() => {
    const result = db.prepare(
      `INSERT INTO templates (user_id, title, description, grid_size, category, status) VALUES (?, ?, ?, ?, ?, 'active')`
    ).run(adminUserId, title.trim(), description?.trim() || null, gridSize, category?.trim() || null)
    templateId = Number(result.lastInsertRowid)

    const insertCell = db.prepare('INSERT INTO template_cells (template_id, position, title) VALUES (?, ?, ?)')
    for (const cell of cells) {
      insertCell.run(templateId, cell.position, cell.title || '')
    }
  })

  create()

  // Sync words to admin word bank
  const maxRow = db.prepare('SELECT MAX(sort_order) as max_order FROM word_banks WHERE user_id = ?').get(adminUserId) as { max_order: number | null }
  let nextOrder = (maxRow?.max_order ?? -1) + 1
  const insertWord = db.prepare('INSERT OR IGNORE INTO word_banks (user_id, word, sort_order) VALUES (?, ?, ?)')
  for (const cell of cells) {
    const word = cell.title?.trim()
    if (!word) continue
    const result = insertWord.run(adminUserId, word, nextOrder)
    if (result.changes > 0) nextOrder++
  }

  await copyIllustrationsToTemplate(db, templateId!, adminUserId, cells.map((c: any) => c.title?.trim() || ''))

  res.status(201).json({ success: true, data: { id: templateId!, title: title.trim() } } as ApiResponse)
})

// ── Admin illustration upload ──

const illustUpload = imageMulter({ maxBytes: 5 * 1024 * 1024 })

// POST /api/admin/wordbank/:wordId/illustration - upload illustration for a word
router.post('/wordbank/:wordId/illustration', illustUpload.single('image'), async (req: Request, res: Response): Promise<void> => {
  const adminUserId = getAdminUserId()
  if (!adminUserId) {
    res.status(500).json({ success: false, error: '系统用户初始化失败' } as ApiResponse)
    return
  }

  if (!req.file) {
    res.status(400).json({ success: false, error: '请上传图片' } as ApiResponse)
    return
  }

  const db = getDb()
  const wordId = parseInt(req.params.wordId as string)
  const wordRow = db.prepare('SELECT word FROM word_banks WHERE id = ? AND user_id = ?').get(wordId, adminUserId) as { word: string } | undefined
  if (!wordRow) {
    res.status(404).json({ success: false, error: '词语不存在' } as ApiResponse)
    return
  }

  const storageDriver = getStorage()
  const tempFilePath = req.file.path || path.join(config.uploadDir, req.file.filename)

  let preparedImage
  try {
    preparedImage = await prepareImageForStorage(tempFilePath, req.file.mimetype)
  } catch {
    await cleanupFiles([tempFilePath])
    res.status(500).json({ success: false, error: '图片处理失败' } as ApiResponse)
    return
  }

  const illustKey = `illustrations/u${adminUserId}/${preparedImage.fileName}`
  try {
    await storageDriver.saveAs(preparedImage.filePath, illustKey)
  } catch {
    await cleanupFiles([preparedImage.filePath, ...preparedImage.cleanupPaths])
    res.status(500).json({ success: false, error: '文件存储失败' } as ApiResponse)
    return
  }

  await cleanupFiles(preparedImage.cleanupPaths)

  // Replace DB reference first; delete the old object only after the DB update.
  let previousKey: string | null
  try {
    ;({ previousKey } = upsertIllustration(db, wordRow.word, adminUserId, illustKey))
  } catch (err) {
    await deleteStorageObjectQuietly(storageDriver, illustKey)
    console.error('[Admin] Illustration DB save error:', err)
    res.status(500).json({ success: false, error: '保存插画记录失败' } as ApiResponse)
    return
  }

  if (previousKey) {
    await deleteStorageObjectQuietly(storageDriver, previousKey)
  }

  const url = storageDriver.getImageUrl(illustKey)
  res.json({ success: true, data: { illustrationUrl: url } } as ApiResponse)
})

// ══════════════════════════════════════════════════════
// Webhook management (for Agent / Bot integration)
// ══════════════════════════════════════════════════════

const VALID_WEBHOOK_EVENTS = new Set([
  '*', 'feedback.created', 'feedback.statusChanged', 'feedback.replied', 'feedback.voted',
])

// ── GET /api/admin/webhooks ── List all webhooks
router.get('/webhooks', (_req: Request, res: Response): void => {
  const db = getDb()
  const rows = db.prepare(
    'SELECT id, url, events, description, active, created_at, updated_at FROM webhooks ORDER BY created_at DESC'
  ).all() as any[]

  res.json({
    success: true,
    data: rows.map(r => ({
      id: r.id,
      url: r.url,
      events: JSON.parse(r.events || '["*"]'),
      description: r.description,
      active: r.active === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  } as ApiResponse)
})

// ── POST /api/admin/webhooks ── Register a new webhook
router.post('/webhooks', (req: Request, res: Response): void => {
  const db = getDb()
  const { url, secret, events, description } = req.body as {
    url?: string; secret?: string; events?: string[]; description?: string
  }

  if (!url || typeof url !== 'string') {
    res.status(400).json({ success: false, error: '请提供有效的 webhook URL' } as ApiResponse)
    return
  }
  const urlErr = validateWebhookUrl(url, { allowHttp: config.nodeEnv !== 'production' })
  if (urlErr) {
    res.status(400).json({ success: false, error: urlErr } as ApiResponse)
    return
  }

  const eventList = events || ['*']
  for (const e of eventList) {
    if (!VALID_WEBHOOK_EVENTS.has(e)) {
      res.status(400).json({ success: false, error: `无效的事件类型: ${e}` } as ApiResponse)
      return
    }
  }

  const result = db.prepare(`
    INSERT INTO webhooks (url, secret, events, description)
    VALUES (?, ?, ?, ?)
  `).run(url, secret || null, JSON.stringify(eventList), description || null)

  const wh = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(result.lastInsertRowid) as any

  res.status(201).json({
    success: true,
    data: {
      id: wh.id,
      url: wh.url,
      events: JSON.parse(wh.events),
      description: wh.description,
      active: wh.active === 1,
      createdAt: wh.created_at,
    },
  } as ApiResponse)
})

// ── PATCH /api/admin/webhooks/:id ── Update webhook
router.patch('/webhooks/:id', (req: Request, res: Response): void => {
  const db = getDb()
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: '无效的 ID 参数' } as ApiResponse)
    return
  }

  const existing = db.prepare('SELECT id FROM webhooks WHERE id = ?').get(id) as any
  if (!existing) {
    res.status(404).json({ success: false, error: 'Webhook 不存在' } as ApiResponse)
    return
  }

  const { url, secret, events, description, active } = req.body as {
    url?: string; secret?: string; events?: string[]; description?: string; active?: boolean
  }

  const updates: string[] = []
  const params: any[] = []

  if (url !== undefined) {
    if (typeof url !== 'string') {
      res.status(400).json({ success: false, error: '请提供有效的 webhook URL' } as ApiResponse)
      return
    }
    const urlErr = validateWebhookUrl(url, { allowHttp: config.nodeEnv !== 'production' })
    if (urlErr) {
      res.status(400).json({ success: false, error: urlErr } as ApiResponse)
      return
    }
    updates.push('url = ?')
    params.push(url)
  }
  if (secret !== undefined) {
    updates.push('secret = ?')
    params.push(secret || null)
  }
  if (events !== undefined) {
    for (const e of events) {
      if (!VALID_WEBHOOK_EVENTS.has(e)) {
        res.status(400).json({ success: false, error: `无效的事件类型: ${e}` } as ApiResponse)
        return
      }
    }
    updates.push('events = ?')
    params.push(JSON.stringify(events))
  }
  if (description !== undefined) {
    updates.push('description = ?')
    params.push(description)
  }
  if (active !== undefined) {
    updates.push('active = ?')
    params.push(active ? 1 : 0)
  }

  if (updates.length === 0) {
    res.status(400).json({ success: false, error: '没有可更新的字段' } as ApiResponse)
    return
  }

  updates.push('updated_at = CURRENT_TIMESTAMP')
  params.push(id)

  db.prepare(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`).run(...params)

  const wh = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as any
  res.json({
    success: true,
    data: {
      id: wh.id,
      url: wh.url,
      events: JSON.parse(wh.events),
      description: wh.description,
      active: wh.active === 1,
      updatedAt: wh.updated_at,
    },
  } as ApiResponse)
})

// ── DELETE /api/admin/webhooks/:id ── Remove webhook
router.delete('/webhooks/:id', (req: Request, res: Response): void => {
  const db = getDb()
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: '无效的 ID 参数' } as ApiResponse)
    return
  }

  const result = db.prepare('DELETE FROM webhooks WHERE id = ?').run(id)
  if (result.changes === 0) {
    res.status(404).json({ success: false, error: 'Webhook 不存在' } as ApiResponse)
    return
  }

  res.json({ success: true, data: null } as ApiResponse)
})

export default router
