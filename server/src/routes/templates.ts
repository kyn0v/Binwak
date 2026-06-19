/**
 * Template marketplace API routes
 */
import { Router, Request, Response } from 'express'
import { getDb, SYSTEM_ADMIN_DISPLAY_NAME } from '../db/database'
import { authMiddleware, optionalAuth, AuthRequest } from '../middleware/auth'
import { getStorage } from '../services/storage'
import { validateIdParam, isValidCategory, escapeLikePattern, CELL_TITLE_MAX_LEN } from '../middleware/validate'
import { checkText } from '../services/moderation'
import { copyIllustrationsToTemplate } from '../services/templateSnapshot'
import type { Template, TemplateListItem, CreateTemplateRequest, TemplateCategory, ApiResponse } from '../../../shared/types'

const router = Router()

// :id param validation
router.param('id', (req, res, next) => validateIdParam(req, res, next))

// ── Validation constants ──
const GRID_SIZE_MIN = 3
const GRID_SIZE_MAX = 6
const TITLE_MAX_LEN = 30
const DESC_MAX_LEN = 100
const DAILY_PUBLISH_LIMIT = 3
const MAX_TEMPLATES_PER_USER = 30

// ── Helper: read cells from template_cells table ──
function getTemplateCells(db: ReturnType<typeof getDb>, templateId: number): Array<{ position: number; title: string; image_path: string }> {
  return db.prepare(
    'SELECT position, title, image_path FROM template_cells WHERE template_id = ? ORDER BY position'
  ).all(templateId) as Array<{ position: number; title: string; image_path: string }>
}

// ── Helper: batch fetch preview cells ──
function getPreviewCellsBatch(db: ReturnType<typeof getDb>, templateIds: number[]): Map<number, string[]> {
  const result = new Map<number, string[]>()
  if (templateIds.length === 0) return result

  const placeholders = templateIds.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT template_id, position, title FROM template_cells WHERE template_id IN (${placeholders}) AND position < 9 ORDER BY template_id, position`
  ).all(...templateIds) as Array<{ template_id: number; position: number; title: string }>

  // Group by template_id
  const grouped = new Map<number, string[]>()
  for (const r of rows) {
    if (!grouped.has(r.template_id)) grouped.set(r.template_id, [])
    grouped.get(r.template_id)!.push(r.title)
  }

  for (const id of templateIds) {
    if (grouped.has(id)) {
      result.set(id, grouped.get(id)!)
    } else {
      result.set(id, [])
    }
  }

  return result
}

// ── Helper: write template_cells ──
function saveTemplateCells(db: ReturnType<typeof getDb>, templateId: number, cells: Array<{ position: number; title: string; image_path?: string }>) {
  const insertCell = db.prepare('INSERT INTO template_cells (template_id, position, title, image_path) VALUES (?, ?, ?, ?)')
  for (const cell of cells) {
    insertCell.run(templateId, cell.position, cell.title || '', cell.image_path || '')
  }
}

// ── Helper: check if user has favorited ──
function getUserFavoriteSet(db: ReturnType<typeof getDb>, userId: number | undefined, templateIds: number[]): Set<number> {
  if (!userId || templateIds.length === 0) return new Set()
  const placeholders = templateIds.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT template_id FROM template_favorites WHERE user_id = ? AND template_id IN (${placeholders})`
  ).all(userId, ...templateIds) as Array<{ template_id: number }>
  return new Set(rows.map((r) => r.template_id))
}

// ── Helper: get author nickname map ──
function getAuthorNames(db: ReturnType<typeof getDb>, userIds: number[]): Map<number, string> {
  const map = new Map<number, string>()
  if (userIds.length === 0) return map
  const unique = [...new Set(userIds)]
  const placeholders = unique.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT id, nickname, kind FROM users WHERE id IN (${placeholders})`
  ).all(...unique) as Array<{ id: number; nickname: string | null; kind: string }>
  for (const r of rows) {
    map.set(r.id, r.kind === 'system' ? SYSTEM_ADMIN_DISPLAY_NAME : (r.nickname || '匿名用户'))
  }
  return map
}

// ── GET /api/templates/publish-quota ──
router.get('/publish-quota', authMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDb()
  const userId = req.user!.userId

  const todayCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM templates WHERE user_id = ? AND status = 'active' AND created_at >= date('now', 'start of day')"
  ).get(userId) as { cnt: number }

  const totalCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM templates WHERE user_id = ? AND status = 'active'"
  ).get(userId) as { cnt: number }

  res.json({
    success: true,
    data: {
      dailyLimit: DAILY_PUBLISH_LIMIT,
      dailyUsed: todayCount.cnt,
      dailyRemaining: Math.max(0, DAILY_PUBLISH_LIMIT - todayCount.cnt),
      totalLimit: MAX_TEMPLATES_PER_USER,
      totalUsed: totalCount.cnt,
    },
  })
})

// ── GET /api/templates/mine - current user's templates ──
router.get('/mine', authMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDb()
  const userId = req.user!.userId

  const rows = db.prepare(`
    SELECT id, title, description, grid_size, category, is_pinned,
           favorite_count, use_count, created_at
    FROM templates
    WHERE user_id = ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(userId) as any[]

  const templateIds = rows.map((r: any) => r.id)
  const previewMap = getPreviewCellsBatch(db, templateIds)
  const authorNames = getAuthorNames(db, [userId])

  const templates: TemplateListItem[] = rows.map((row: any) => ({
    id: row.id,
    title: row.title,
    description: row.description || undefined,
    gridSize: row.grid_size,
    category: row.category || undefined,
    isPinned: !!row.is_pinned,
    favoriteCount: row.favorite_count,
    isFavorite: false,
    authorName: authorNames.get(userId) || '匿名用户',
    useCount: row.use_count,
    previewCells: previewMap.get(row.id) || [],
    createdAt: row.created_at,
  }))

  res.json({ success: true, data: { templates, total: templates.length } })
})

// ── GET /api/templates - public list ──
router.get('/', optionalAuth, (req: Request, res: Response) => {
  const db = getDb()
  const currentUserId = (req as AuthRequest).user?.userId

  const category = req.query.category as TemplateCategory | undefined
  const keyword = req.query.keyword as string | undefined
  const sort = (req.query.sort as string) || 'newest'
  const page = Math.max(1, parseInt(req.query.page as string) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
  const offset = (page - 1) * limit

  // Build WHERE clause
  const conditions: string[] = ["t.status = 'active'"]
  const params: any[] = []

  if (category) {
    conditions.push('t.category = ?')
    params.push(category)
  }

  const favoriteOnly = req.query.favorite === 'true'
  if (favoriteOnly && currentUserId) {
    conditions.push('EXISTS (SELECT 1 FROM template_favorites tf WHERE tf.template_id = t.id AND tf.user_id = ?)')
    params.push(currentUserId)
  }

  if (keyword && keyword.trim()) {
    conditions.push("t.title LIKE ? ESCAPE '\\'")
    params.push(`%${escapeLikePattern(keyword.trim())}%`)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Sort
  let orderBy: string
  if (sort === 'recommend') {
    // Recommend: pinned first, then by favorites, uses, time
    orderBy = 't.is_pinned DESC, t.favorite_count DESC, t.use_count DESC, t.created_at DESC, t.id DESC'
  } else {
    // newest (default)
    orderBy = 't.created_at DESC, t.id DESC'
  }

  // Count total
  const countSql = `SELECT COUNT(*) as total FROM templates t ${whereClause}`
  const { total } = db.prepare(countSql).get(...params) as { total: number }

  // Fetch list
  const listSql = `
    SELECT t.id, t.user_id, t.title, t.description, t.grid_size, t.category,
           t.is_pinned, t.favorite_count, t.use_count, t.created_at
    FROM templates t
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `
  const rows = db.prepare(listSql).all(...params, limit, offset) as any[]

  // Batch fetch liked set and author names
  const templateIds = rows.map((r) => r.id)
  const userIds = rows.map((r) => r.user_id)
  const favoriteSet = getUserFavoriteSet(db, currentUserId, templateIds)
  const authorNames = getAuthorNames(db, userIds)
  const previewMap = getPreviewCellsBatch(db, templateIds)

  const templates: TemplateListItem[] = rows.map((row) => {
    return {
      id: row.id,
      title: row.title,
      description: row.description || undefined,
      gridSize: row.grid_size,
      category: row.category || undefined,
      isPinned: !!row.is_pinned,
      favoriteCount: row.favorite_count,
      isFavorite: favoriteSet.has(row.id),
      authorName: authorNames.get(row.user_id) || '匿名用户',
      useCount: row.use_count,
      previewCells: previewMap.get(row.id) || [],
      createdAt: row.created_at,
    }
  })

  res.json({ success: true, data: { templates, total, page, limit } })
})

// ── GET /api/templates/:id - template detail (public) ──
router.get('/:id', optionalAuth, (req: Request, res: Response) => {
  const db = getDb()
  const currentUserId = (req as AuthRequest).user?.userId
  const templateId = parseInt(req.params.id as string)

  const row = db.prepare(`
    SELECT * FROM templates WHERE id = ? AND status = 'active'
  `).get(templateId) as any

  if (!row) {
    res.status(404).json({ success: false, error: '模板不存在' })
    return
  }

  const favoriteSet = getUserFavoriteSet(db, currentUserId, [templateId])
  const authorNames = getAuthorNames(db, [row.user_id])
  const rawCells = getTemplateCells(db, templateId)
  const storage = getStorage()
  const cells = rawCells.map(c => ({
    position: c.position,
    title: c.title,
    imageUrl: c.image_path
      ? storage.getImageUrl(c.image_path)
      : undefined,
  }))

  const template: Template = {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description || undefined,
    gridSize: row.grid_size,
    cells,
    category: row.category || undefined,
    isPinned: !!row.is_pinned,
    favoriteCount: row.favorite_count,
    isFavorite: favoriteSet.has(row.id),
    authorName: authorNames.get(row.user_id) || '匿名用户',
    useCount: row.use_count,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }

  res.json({ success: true, data: template })
})

// ── POST /api/templates - create template (auth required) ──
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const db = getDb()
  const userId = req.user!.userId

  // Total limit
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM templates WHERE user_id = ? AND status = 'active'").get(userId) as { cnt: number }
  if (countRow.cnt >= MAX_TEMPLATES_PER_USER) {
    res.status(400).json({ success: false, error: `最多发布 ${MAX_TEMPLATES_PER_USER} 个模板` })
    return
  }

  // Daily publish limit (skip in test environment)
  if (process.env.NODE_ENV !== 'test') {
    const todayCount = db.prepare(
      "SELECT COUNT(*) as cnt FROM templates WHERE user_id = ? AND status = 'active' AND created_at >= date('now', 'start of day')"
    ).get(userId) as { cnt: number }
    if (todayCount.cnt >= DAILY_PUBLISH_LIMIT) {
      res.status(400).json({ success: false, error: `每天最多发布 ${DAILY_PUBLISH_LIMIT} 个模板，明天再来吧` })
      return
    }
  }

  const { title, description, gridSize, cells, category } = req.body as CreateTemplateRequest

  // Validation
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    res.status(400).json({ success: false, error: '标题不能为空' })
    return
  }
  if (title.trim().length > TITLE_MAX_LEN) {
    res.status(400).json({ success: false, error: `标题长度不能超过 ${TITLE_MAX_LEN} 字符` })
    return
  }
  if (description && typeof description === 'string' && description.length > DESC_MAX_LEN) {
    res.status(400).json({ success: false, error: `描述长度不能超过 ${DESC_MAX_LEN} 字符` })
    return
  }

  if (!gridSize || typeof gridSize !== 'number' || !Number.isInteger(gridSize)) {
    res.status(400).json({ success: false, error: 'gridSize 无效' })
    return
  }
  if (gridSize < GRID_SIZE_MIN || gridSize > GRID_SIZE_MAX) {
    res.status(400).json({ success: false, error: `gridSize 必须在 ${GRID_SIZE_MIN}~${GRID_SIZE_MAX} 之间` })
    return
  }

  const expectedCells = gridSize * gridSize
  if (!cells || !Array.isArray(cells) || cells.length !== expectedCells) {
    res.status(400).json({ success: false, error: `cells 数量必须等于 gridSize² (${expectedCells})` })
    return
  }

  // Cell title length validation
  for (const cell of cells) {
    if (cell.title && typeof cell.title === 'string' && cell.title.length > CELL_TITLE_MAX_LEN) {
      res.status(400).json({ success: false, error: `格子标题不能超过 ${CELL_TITLE_MAX_LEN} 字符` })
      return
    }
  }

  // All cells must have content
  const emptyCell = cells.find((c: any) => !c.title || !c.title.trim())
  if (emptyCell) {
    res.status(400).json({ success: false, error: '所有格子都必须填写词语' } as ApiResponse)
    return
  }

  // Duplicate detection
  const cellTitlesList = cells.map((c: any) => c.title.trim())
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const t of cellTitlesList) {
    if (seen.has(t)) duplicates.push(t)
    else seen.add(t)
  }
  if (duplicates.length > 0) {
    res.status(400).json({ success: false, error: `存在重复词语：${[...new Set(duplicates)].join('、')}` } as ApiResponse)
    return
  }

  // category whitelist
  const safeCategory = (category && isValidCategory(category)) ? category : 'other'

  // ── Content moderation ──
  const cellTitles = cells.map((c: any) => c.title || '').filter(Boolean)
  const textToCheck = [title.trim(), description || '', ...cellTitles].filter(Boolean).join('\n')
  const modResult = await checkText(req.user!.openid, textToCheck, 3)
  if (!modResult.pass) {
    res.status(400).json({ success: false, error: '内容含违规信息，请修改后重试' })
    return
  }

  let templateId: number
  try {
    const createTemplate = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO templates (user_id, title, description, grid_size, category)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, title.trim(), description || '', gridSize, safeCategory)

      const id = result.lastInsertRowid as number

      // Insert cells into template_cells table
      saveTemplateCells(db, id, cells)

      return id
    })
    templateId = createTemplate()
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      res.status(401).json({ success: false, error: '用户不存在，请重新登录' })
      return
    }
    throw err
  }

  // Copy author's illustrations into template snapshot
  await copyIllustrationsToTemplate(db, templateId, userId, cells.map(c => c.title))

  // Fetch and return
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId) as any
  const savedCells = getTemplateCells(db, templateId)
  const storage = getStorage()

  const template: Template = {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description || undefined,
    gridSize: row.grid_size,
    cells: savedCells.map(c => ({
      position: c.position,
      title: c.title,
      imageUrl: c.image_path
        ? storage.getImageUrl(c.image_path)
        : undefined,
    })),
    category: row.category || undefined,
    isPinned: false,
    favoriteCount: 0,
    isFavorite: false,
    authorName: '匿名用户',
    useCount: 0,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }

  res.status(201).json({ success: true, data: template })
})

// ── POST /api/templates/:id/favorite - toggle favorite (auth required) ──
router.post('/:id/favorite', authMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDb()
  const userId = req.user!.userId
  const templateId = parseInt(req.params.id as string)

  // Check template exists
  const template = db.prepare(
    "SELECT id FROM templates WHERE id = ? AND status = 'active'"
  ).get(templateId) as any

  if (!template) {
    res.status(404).json({ success: false, error: '模板不存在' })
    return
  }

  // Toggle like in a transaction to keep favorite_count consistent
  const toggleFavorite = db.transaction(() => {
    const existing = db.prepare(
      'SELECT id FROM template_favorites WHERE user_id = ? AND template_id = ?'
    ).get(userId, templateId) as any

    let favorite: boolean
    if (existing) {
      db.prepare('DELETE FROM template_favorites WHERE id = ?').run(existing.id)
      db.prepare('UPDATE templates SET favorite_count = MAX(0, favorite_count - 1) WHERE id = ?').run(templateId)
      favorite = false
    } else {
      db.prepare('INSERT INTO template_favorites (user_id, template_id) VALUES (?, ?)').run(userId, templateId)
      db.prepare('UPDATE templates SET favorite_count = favorite_count + 1 WHERE id = ?').run(templateId)
      favorite = true
    }

    const updated = db.prepare('SELECT favorite_count FROM templates WHERE id = ?').get(templateId) as { favorite_count: number }
    return { favorite, favoriteCount: updated.favorite_count }
  })

  let result: { favorite: boolean; favoriteCount: number }
  try {
    result = toggleFavorite()
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      res.status(401).json({ success: false, error: '用户不存在，请重新登录' })
      return
    }
    throw err
  }

  res.json({ success: true, data: result })
})

// ── POST /api/templates/:id/use - use template to create a board (auth required) ──
router.post('/:id/use', authMiddleware, async (req: AuthRequest, res: Response) => {
  const db = getDb()
  const userId = req.user!.userId
  const templateId = parseInt(req.params.id as string)

  // Board count limit
  const boardCount = db.prepare('SELECT COUNT(*) as cnt FROM boards WHERE user_id = ?').get(userId) as { cnt: number }
  if (boardCount.cnt >= 50) {
    res.status(400).json({ success: false, error: '最多创建 50 个 Bingo 卡' })
    return
  }

  // Get template
  const template = db.prepare(`
    SELECT * FROM templates WHERE id = ? AND status = 'active'
  `).get(templateId) as any

  if (!template) {
    res.status(404).json({ success: false, error: '模板不存在' })
    return
  }

  const cells = getTemplateCells(db, templateId)
  let boardTitle = template.title
  if (req.body?.title !== undefined) {
    if (typeof req.body.title !== 'string') {
      res.status(400).json({ success: false, error: '标题必须是字符串' })
      return
    }
    const trimmedTitle = req.body.title.trim()
    if (trimmedTitle.length > TITLE_MAX_LEN) {
      res.status(400).json({ success: false, error: `标题长度不能超过 ${TITLE_MAX_LEN} 字符` })
      return
    }
    if (trimmedTitle) boardTitle = trimmedTitle
  }

  // Wrap deactivate + create board + create cells + increment use_count in transaction
  const insertCell = db.prepare(`
    INSERT INTO cells (board_id, position, title, illustration_path, completed)
    VALUES (?, ?, ?, ?, 0)
  `)

  const useTemplate = db.transaction(() => {
    // Deactivate user's current boards
    db.prepare('UPDATE boards SET is_active = 0 WHERE user_id = ?').run(userId)

    // Create new board
    const boardResult = db.prepare(`
      INSERT INTO boards (user_id, title, grid_size, theme, is_active)
      VALUES (?, ?, ?, 'mono', 1)
    `).run(userId, boardTitle, template.grid_size)

    const boardId = boardResult.lastInsertRowid as number

    // Create cells with template illustrations
    for (const cell of cells) {
      insertCell.run(boardId, cell.position, cell.title, cell.image_path || '')
    }

    // Increment use_count only if this user hasn't used this template before
    const alreadyUsed = db.prepare(
      'SELECT 1 FROM template_uses WHERE user_id = ? AND template_id = ?'
    ).get(userId, templateId)
    if (!alreadyUsed) {
      db.prepare('INSERT INTO template_uses (user_id, template_id) VALUES (?, ?)').run(userId, templateId)
      db.prepare('UPDATE templates SET use_count = use_count + 1 WHERE id = ?').run(templateId)
    }

    return boardId
  })

  let boardId: number
  try {
    boardId = useTemplate()
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      res.status(401).json({ success: false, error: '用户不存在，请重新登录' })
      return
    }
    throw err
  }

  // Copy template illustrations to user's illustrations table (skip if user already has one)
  const cellsWithImages = cells.filter(c => c.image_path && c.title)
  if (cellsWithImages.length > 0) {
    const storage = getStorage()
    const existingIllust = db.prepare('SELECT 1 FROM illustrations WHERE word = ? AND user_id = ?')
    const insertIllust = db.prepare('INSERT INTO illustrations (word, user_id, image_path) VALUES (?, ?, ?)')
    for (const cell of cellsWithImages) {
      try {
        if (existingIllust.get(cell.title, userId)) continue
        const ext = cell.image_path.split('.').pop() || 'jpg'
        const destKey = `illustrations/u${userId}/${Date.now()}_${cell.position}.${ext}`
        await storage.copy(cell.image_path, destKey)
        try {
          insertIllust.run(cell.title, userId, destKey)
        } catch (err) {
          await storage.delete(destKey).catch(() => {})
          throw err
        }
      } catch {
        // Non-critical: skip if copy fails
      }
    }
  }

  // Fetch board with cells
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId) as any
  const boardCells = db.prepare('SELECT * FROM cells WHERE board_id = ? ORDER BY position').all(boardId) as any[]
  const storage = getStorage()

  res.status(201).json({
    success: true,
    data: {
      id: board.id,
      userId: board.user_id,
      title: board.title,
      gridSize: board.grid_size,
      theme: board.theme,
      isActive: !!board.is_active,
      createdAt: board.created_at,
      updatedAt: board.updated_at,
      cells: boardCells.map((c: any) => ({
        position: c.position,
        title: c.title,
        imageName: c.image_name,
        imageUrl: c.image_name
          ? storage.getImageUrl(c.image_name)
          : undefined,
        illustrationPath: c.illustration_path || undefined,
        illustrationUrl: c.illustration_path
          ? storage.getImageUrl(c.illustration_path)
          : undefined,
        completed: !!c.completed,
        completedAt: c.completed_at,
      })),
    },
  })
})

// ── DELETE /api/templates/:id - delete own template (auth required) ──
router.delete('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  const db = getDb()
  const userId = req.user!.userId
  const templateId = parseInt(req.params.id as string)

  // Check ownership
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId) as any

  if (!template) {
    res.status(404).json({ success: false, error: '模板不存在' })
    return
  }

  if (template.user_id !== userId) {
    res.status(403).json({ success: false, error: '无权删除此模板' })
    return
  }

  // Soft delete (template_cells retained for data integrity, cleaned up if needed)
  db.prepare("UPDATE templates SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(templateId)

  res.json({ success: true })
})

export default router
