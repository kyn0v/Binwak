import { Router, Request, Response } from 'express'
import path from 'path'
import crypto from 'crypto'
import { getDb } from '../db/database'
import { authMiddleware } from '../middleware/auth'
import { getStorage, validateStorageKey } from '../services/storage'
import { checkText } from '../services/moderation'
import { validateIdParam, isValidTheme, CELL_TITLE_MAX_LEN } from '../middleware/validate'
import type {
  Board,
  Cell,
  BoardDetail,
  CreateBoardRequest,
  UpdateBoardRequest,
  UpdateCellsRequest,
  ApiResponse,
  DEFAULT_WORDS,
} from '../../../shared/types'
import { DEFAULT_WORDS } from '../../../shared/types'

const router = Router()

// All board routes require auth
router.use(authMiddleware)

// :id param validation
router.param('id', (req, res, next) => validateIdParam(req, res, next))

// ---------- Validation constants ----------

const GRID_SIZE_MIN = 3
const GRID_SIZE_MAX = 6
const TITLE_MAX_LEN = 30
const MAX_BOARDS_PER_USER = 50

function validateGridSize(gridSize: unknown): string | null {
  if (gridSize === undefined) return null // optional
  if (typeof gridSize !== 'number' || !Number.isInteger(gridSize)) return '格子尺寸必须为整数'
  if (gridSize < GRID_SIZE_MIN || gridSize > GRID_SIZE_MAX) return `格子尺寸必须在 ${GRID_SIZE_MIN}~${GRID_SIZE_MAX} 之间`
  return null
}

function validateTitle(title: unknown): string | null {
  if (title === undefined) return null // optional
  if (typeof title !== 'string') return '标题必须为字符串'
  if (title.length === 0 || title.length > TITLE_MAX_LEN) return `标题长度须在 1~${TITLE_MAX_LEN} 字符`
  return null
}

// ---------- Helpers ----------

function countCompletedCells(db: ReturnType<typeof getDb>, boardId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM cells WHERE board_id = ? AND completed = 1')
    .get(boardId) as { cnt: number }
  return row.cnt
}

function countImageCells(db: ReturnType<typeof getDb>, boardId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM cells WHERE board_id = ? AND image_name != ''")
    .get(boardId) as { cnt: number }
  return row.cnt
}

/**
 * Extract the storage key from a value that might be:
 * - A clean storage key: "illustrations/flower.png"
 * - A local URL: "/uploads/illustrations/flower.png"
 * - An absolute OSS URL: "https://bucket.oss.aliyuncs.com/illustrations/flower.png?OSSAccessKeyId=..."
 * - A corrupted multi-nested URL (each sync added another layer)
 *
 * Returns just the storage key (e.g. "illustrations/flower.png") or empty string.
 */
function extractStorageKey(pathOrUrl: string): string {
  if (!pathOrUrl) return ''

  let value = pathOrUrl.trim()

  // Local storage: strip /uploads/ prefix
  if (value.startsWith('/uploads/')) {
    return value.slice('/uploads/'.length)
  }

  // Absolute URL: extract the object key from the URL path
  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const parsed = new URL(value)
      // pathname is like "/illustrations/flower.png", strip leading "/"
      let key = decodeURIComponent(parsed.pathname.slice(1))
      // If the key itself is another URL (corrupted nested data), recurse
      if (key.startsWith('http://') || key.startsWith('https://')) {
        return extractStorageKey(key)
      }
      return key
    } catch {
      return ''
    }
  }

  // Already a clean key
  return value
}

/**
 * Sanitize a client-supplied illustration storage key before persisting it.
 *
 * A cell illustration legitimately lives in one of two *shareable* namespaces:
 *  - `illustrations/...` (seeded defaults, user uploads, template-derived copies)
 *  - `templates/...`     (public template snapshots used to seed starter boards)
 *
 * The value is client-controlled and is later handed to `storage.getImageUrl()`,
 * which signs arbitrary object keys on the OSS driver. Without this guard a user
 * could store another user's *private* key (e.g. `photos/u{otherId}/...`) and
 * receive a signed URL for an object they don't own. We also reject path
 * traversal / malformed keys so a bad value can't break the owner's own board
 * fetch later.
 *
 * Returns the clean key when allowed, or '' (no illustration) otherwise.
 */
function sanitizeIllustrationKey(value: string): string {
  const key = extractStorageKey(value || '')
  if (!key) return ''
  try {
    validateStorageKey(key)
  } catch {
    return ''
  }
  if (key.startsWith('illustrations/') || key.startsWith('templates/')) {
    return key
  }
  return ''
}

function getBoardCells(db: ReturnType<typeof getDb>, boardId: number): Cell[] {
  const storage = getStorage()
  const rows = db
    .prepare('SELECT position, title, image_name, illustration_path, completed, completed_at FROM cells WHERE board_id = ? ORDER BY position')
    .all(boardId) as Array<{
    position: number
    title: string
    image_name: string
    illustration_path: string
    completed: number
    completed_at: string | null
  }>

  return rows.map((r) => {
    const illustKey = extractStorageKey(r.illustration_path)

    return {
      position: r.position,
      title: r.title,
      imageName: r.image_name,
      imageUrl: r.image_name
        ? storage.getImageUrl(r.image_name)
        : undefined,
      illustrationPath: illustKey || undefined,
      illustrationUrl: illustKey
        ? storage.getImageUrl(illustKey)
        : undefined,
      completed: r.completed === 1,
      completedAt: r.completed_at || undefined,
    }
  })
}

function boardRowToBoard(row: any): Board {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    gridSize: row.grid_size,
    theme: row.theme,
    isActive: row.is_active === 1,
    isFavorite: row.is_favorite === 1,
    publishedTemplateId: row.published_template_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ---------- Routes ----------

/**
 * GET /api/boards
 */
router.get('/', (req: Request, res: Response): void => {
  const db = getDb()
  const rows = db
    .prepare(`
      SELECT b.*,
        COUNT(CASE WHEN c.completed = 1 THEN 1 END) as completed_count,
        COUNT(CASE WHEN c.image_name != '' THEN 1 END) as image_count
      FROM boards b
      LEFT JOIN cells c ON b.id = c.board_id
      WHERE b.user_id = ?
      GROUP BY b.id
      ORDER BY b.updated_at DESC
    `)
    .all(req.user!.userId)

  const boards: Board[] = (rows as any[]).map((r) => ({
    ...boardRowToBoard(r),
    completedCount: r.completed_count,
    totalCount: r.grid_size * r.grid_size,
    imageCount: r.image_count,
  }))

  res.json({ success: true, data: boards } as ApiResponse<Board[]>)
})

/**
 * POST /api/boards
 */
router.post('/', (req: Request, res: Response): void => {
  const { title = 'Binwak', gridSize = 3, theme = 'mono' } = req.body as CreateBoardRequest
  const userId = req.user!.userId

  // Count limit
  const db = getDb()
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM boards WHERE user_id = ?').get(userId) as { cnt: number }
  if (countRow.cnt >= MAX_BOARDS_PER_USER) {
    res.status(400).json({ success: false, error: `最多创建 ${MAX_BOARDS_PER_USER} 个 Bingo 卡` } as ApiResponse)
    return
  }

  // Input validation
  const titleErr = validateTitle(title)
  if (titleErr) { res.status(400).json({ success: false, error: titleErr } as ApiResponse); return }
  const gsErr = validateGridSize(gridSize)
  if (gsErr) { res.status(400).json({ success: false, error: gsErr } as ApiResponse); return }
  if (!isValidTheme(theme)) { res.status(400).json({ success: false, error: '无效的主题' } as ApiResponse); return }

  // Wrap deactivate + create board + create cells in a single transaction
  const insertCell = db.prepare(
    'INSERT INTO cells (board_id, position, title) VALUES (?, ?, ?)'
  )
  const totalCells = gridSize * gridSize

  const createBoard = db.transaction(() => {
    // Deactivate other boards
    db.prepare('UPDATE boards SET is_active = 0 WHERE user_id = ?').run(userId)

    // Create board
    const result = db
      .prepare('INSERT INTO boards (user_id, title, grid_size, theme, is_active) VALUES (?, ?, ?, ?, 1)')
      .run(userId, title, gridSize, theme)

    const boardId = result.lastInsertRowid as number

    // Create cells pre-filled with default words
    for (let i = 0; i < totalCells; i++) {
      const cellTitle = DEFAULT_WORDS[i] ?? ''
      insertCell.run(boardId, i, cellTitle)
    }

    return boardId
  })

  let boardId: number
  try {
    boardId = createBoard()
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      res.status(401).json({ success: false, error: '用户不存在，请重新登录' } as ApiResponse)
      return
    }
    throw err
  }

  // Return full board
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId)
  const cells = getBoardCells(db, boardId)
  const detail: BoardDetail = { ...boardRowToBoard(board), cells }

  res.status(201).json({ success: true, data: detail } as ApiResponse<BoardDetail>)
})

/**
 * GET /api/boards/:id
 */
router.get('/:id', (req: Request, res: Response): void => {
  const db = getDb()
  const board = db
    .prepare('SELECT * FROM boards WHERE id = ? AND user_id = ?')
    .get(parseInt(req.params.id as string), req.user!.userId) as any

  if (!board) {
    res.status(404).json({ success: false, error: 'Bingo卡不存在' } as ApiResponse)
    return
  }

  const cells = getBoardCells(db, board.id)
  const detail: BoardDetail = { ...boardRowToBoard(board), cells }

  res.json({ success: true, data: detail } as ApiResponse<BoardDetail>)
})

/**
 * POST /api/boards/:id/activate
 */
router.post('/:id/activate', (req: Request, res: Response): void => {
  const db = getDb()
  const boardId = parseInt(req.params.id as string)
  const userId = req.user!.userId

  const board = db
    .prepare('SELECT id FROM boards WHERE id = ? AND user_id = ?')
    .get(boardId, userId)

  if (!board) {
    res.status(404).json({ success: false, error: 'Bingo卡不存在' } as ApiResponse)
    return
  }

  const switchBoard = db.transaction(() => {
    db.prepare('UPDATE boards SET is_active = 0 WHERE user_id = ?').run(userId)
    db.prepare('UPDATE boards SET is_active = 1 WHERE id = ?').run(boardId)
  })
  switchBoard()

  const cells = getBoardCells(db, boardId)
  const updated = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId)
  const detail: BoardDetail = { ...boardRowToBoard(updated), cells }

  res.json({ success: true, data: detail } as ApiResponse<BoardDetail>)
})

/**
 * PUT /api/boards/:id
 */
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const db = getDb()
  const boardId = parseInt(req.params.id as string)
  const userId = req.user!.userId
  const { title, gridSize, theme } = req.body as UpdateBoardRequest

  // Input validation
  const titleErr = validateTitle(title)
  if (titleErr) { res.status(400).json({ success: false, error: titleErr } as ApiResponse); return }
  const gsErr = validateGridSize(gridSize)
  if (gsErr) { res.status(400).json({ success: false, error: gsErr } as ApiResponse); return }
  if (theme !== undefined && !isValidTheme(theme)) { res.status(400).json({ success: false, error: '无效的主题' } as ApiResponse); return }

  // Verify board belongs to current user
  const existing = db
    .prepare('SELECT id, grid_size FROM boards WHERE id = ? AND user_id = ?')
    .get(boardId, userId) as { id: number; grid_size: number } | undefined

  if (!existing) {
    res.status(404).json({ success: false, error: 'Bingo卡不存在' } as ApiResponse)
    return
  }

  // Build update statement dynamically
  const updates: string[] = []
  const values: any[] = []

  if (title !== undefined) {
    updates.push('title = ?')
    values.push(title)
  }
  if (theme !== undefined) {
    updates.push('theme = ?')
    values.push(theme)
  }
  if (gridSize !== undefined) {
    updates.push('grid_size = ?')
    values.push(gridSize)
  }

  const shouldResizeGrid = gridSize !== undefined && gridSize !== existing.grid_size
  const targetGridSize = gridSize ?? existing.grid_size
  const hasBoardFieldUpdates = updates.length > 0
  let imageNamesToDelete: string[] = []

  if (hasBoardFieldUpdates || shouldResizeGrid) {
    const applyBoardUpdates = db.transaction(() => {
      if (hasBoardFieldUpdates) {
        updates.push('updated_at = CURRENT_TIMESTAMP')
        values.push(boardId)
        db.prepare(`UPDATE boards SET ${updates.join(', ')} WHERE id = ?`).run(...values)
      }

      if (shouldResizeGrid) {
        const oldTotal = existing.grid_size * existing.grid_size
        const newTotal = targetGridSize * targetGridSize

        if (newTotal > oldTotal) {
          const insertCell = db.prepare('INSERT INTO cells (board_id, position) VALUES (?, ?)')
          for (let i = oldTotal; i < newTotal; i++) {
            insertCell.run(boardId, i)
          }
        } else if (newTotal < oldTotal) {
          const excessCells = db
            .prepare('SELECT image_name FROM cells WHERE board_id = ? AND position >= ? AND image_name != \'\'')
            .all(boardId, newTotal) as Array<{ image_name: string }>
          imageNamesToDelete = excessCells.map((cell) => cell.image_name)
          db.prepare('DELETE FROM cells WHERE board_id = ? AND position >= ?').run(boardId, newTotal)
        }
      }
    })

    applyBoardUpdates()
  }

  // Clean up files after DB commit to avoid partial state
  const storage = getStorage()
  for (const imageName of imageNamesToDelete) {
    try {
      validateStorageKey(imageName)
    } catch {
      continue
    }
    try { await storage.delete(imageName) } catch { /* ignore cleanup failures */ }
  }

  // Return updated board
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId)
  const cells = getBoardCells(db, boardId)
  const detail: BoardDetail = { ...boardRowToBoard(board), cells }

  res.json({ success: true, data: detail } as ApiResponse<BoardDetail>)
})

/**
 * POST /api/boards/:id/reset
 * Reset board: clear completion state and images, keep titles
 */
router.post('/:id/reset', async (req: Request, res: Response): Promise<void> => {
  const db = getDb()
  const boardId = parseInt(req.params.id as string)
  const userId = req.user!.userId

  const board = db
    .prepare('SELECT id FROM boards WHERE id = ? AND user_id = ?')
    .get(boardId, userId) as { id: number } | undefined

  if (!board) {
    res.status(404).json({ success: false, error: 'Bingo卡不存在' } as ApiResponse)
    return
  }

  // Find images to delete
  const cellImages = db
    .prepare("SELECT image_name FROM cells WHERE board_id = ? AND image_name != ''")
    .all(boardId) as Array<{ image_name: string }>

  // Delete stored images (best-effort)
  const storage = getStorage()
  for (const { image_name } of cellImages) {
    try { await storage.delete(image_name) } catch { /* ignore */ }
  }

  // Reset all cells
  db.prepare(
    "UPDATE cells SET completed = 0, image_name = '', completed_at = NULL WHERE board_id = ?"
  ).run(boardId)

  db.prepare('UPDATE boards SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(boardId)

  res.json({ success: true } as ApiResponse)
})

/**
 * DELETE /api/boards/:id
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const db = getDb()
  const boardId = parseInt(req.params.id as string)
  const userId = req.user!.userId

  // Check board exists
  const board = db
    .prepare('SELECT id, is_active FROM boards WHERE id = ? AND user_id = ?')
    .get(boardId, userId) as { id: number; is_active: number } | undefined

  if (!board) {
    res.status(404).json({ success: false, error: 'Bingo卡不存在' } as ApiResponse)
    return
  }

  // Cannot delete active board
  if (board.is_active === 1) {
    res.status(400).json({ success: false, error: '不能删除当前活跃Bingo卡，请先切换到其他Bingo卡' } as ApiResponse)
    return
  }

  // Clean up associated images via storage driver
  const cellImages = db
    .prepare("SELECT image_name FROM cells WHERE board_id = ? AND image_name != ''")
    .all(boardId) as Array<{ image_name: string }>

  const storage = getStorage()
  for (const { image_name } of cellImages) {
    try { await storage.delete(image_name) } catch { /* ignore */ }
  }

  db.prepare('DELETE FROM boards WHERE id = ?').run(boardId)

  res.json({ success: true } as ApiResponse)
})

/**
 * POST /api/boards/:id/clone
 */
router.post('/:id/clone', async (req: Request, res: Response): Promise<void> => {
  const db = getDb()
  const boardId = parseInt(req.params.id as string)
  const userId = req.user!.userId
  const { title } = req.body as { title?: string }

  // Count limit
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM boards WHERE user_id = ?').get(userId) as { cnt: number }
  if (countRow.cnt >= MAX_BOARDS_PER_USER) {
    res.status(400).json({ success: false, error: `最多创建 ${MAX_BOARDS_PER_USER} 个 Bingo 卡` } as ApiResponse)
    return
  }

  const source = db
    .prepare('SELECT * FROM boards WHERE id = ? AND user_id = ?')
    .get(boardId, userId) as any

  if (!source) {
    res.status(404).json({ success: false, error: 'Bingo卡不存在' } as ApiResponse)
    return
  }

  // Clone title validation
  const titleErr2 = title ? validateTitle(title) : null
  if (titleErr2) { res.status(400).json({ success: false, error: titleErr2 } as ApiResponse); return }
  const cloneTitle = title || `${source.title}_1`

  const doClone = db.transaction(() => {
    // Create new board (inactive)
    const result = db
      .prepare('INSERT INTO boards (user_id, title, grid_size, theme, is_active) VALUES (?, ?, ?, ?, 0)')
      .run(userId, cloneTitle, source.grid_size, source.theme)

    const newBoardId = result.lastInsertRowid as number

    // Read source cells inside transaction for consistent snapshot
    const sourceCells = db
      .prepare('SELECT position, title, image_name, completed, completed_at FROM cells WHERE board_id = ? ORDER BY position')
      .all(boardId) as Array<{ position: number; title: string; image_name: string; completed: number; completed_at: string | null }>

    return { newBoardId, sourceCells }
  })

  let newBoardId: number | undefined
  const copiedImageNames: string[] = []
  try {
    const cloneResult = doClone()
    newBoardId = cloneResult.newBoardId

    const storage = getStorage()
    const clonedCells = [] as Array<{
      position: number
      title: string
      image_name: string
      completed: number
      completed_at: string | null
    }>

    // File I/O outside transaction to avoid blocking DB.
    for (const cell of cloneResult.sourceCells) {
      let newImageName = cell.image_name
      let clonedCompleted = cell.completed
      let clonedCompletedAt = cell.completed_at
      if (cell.image_name) {
        let safeSourceKey = ''
        try {
          validateStorageKey(cell.image_name)
          safeSourceKey = cell.image_name
        } catch {
          // Drop the image reference for malformed/legacy keys; clone proceeds without photo.
        }
        if (safeSourceKey) {
          const ext = path.extname(safeSourceKey)
          newImageName = `photos/u${userId}/b${newBoardId}/${crypto.randomBytes(16).toString('hex')}${ext}`
          try {
            await storage.copy(safeSourceKey, newImageName)
            copiedImageNames.push(newImageName)
          } catch {
            newImageName = ''
          }
        } else {
          newImageName = ''
        }
      }
      if (!newImageName) {
        clonedCompleted = 0
        clonedCompletedAt = null
      }
      clonedCells.push({
        position: cell.position,
        title: cell.title,
        image_name: newImageName,
        completed: clonedCompleted,
        completed_at: clonedCompletedAt,
      })
    }

    const insertCell = db.prepare(
      'INSERT INTO cells (board_id, position, title, image_name, completed, completed_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const insertCells = db.transaction(() => {
      for (const cell of clonedCells) {
        insertCell.run(newBoardId, cell.position, cell.title, cell.image_name, cell.completed, cell.completed_at)
      }
    })
    insertCells()
  } catch (err: any) {
    const storage = getStorage()
    for (const imageName of copiedImageNames) {
      await storage.delete(imageName).catch(() => {})
    }
    if (newBoardId !== undefined) {
      db.prepare('DELETE FROM boards WHERE id = ?').run(newBoardId)
    }
    if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      res.status(401).json({ success: false, error: '用户不存在，请重新登录' } as ApiResponse)
      return
    }
    throw err
  }

  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(newBoardId)
  const cells = getBoardCells(db, newBoardId)
  const detail: BoardDetail = {
    ...boardRowToBoard(board),
    completedCount: countCompletedCells(db, newBoardId),
    totalCount: source.grid_size * source.grid_size,
    cells,
  }

  res.status(201).json({ success: true, data: detail } as ApiResponse<BoardDetail>)
})

/**
 * PATCH /api/boards/:id/publish
 */
router.patch('/:id/publish', (req: Request, res: Response): void => {
  const db = getDb()
  const boardId = parseInt(req.params.id as string)
  const userId = req.user!.userId
  const { publishedTemplateId } = req.body as { publishedTemplateId: number | null }

  const board = db
    .prepare('SELECT id FROM boards WHERE id = ? AND user_id = ?')
    .get(boardId, userId)

  if (!board) {
    res.status(404).json({ success: false, error: 'Bingo卡不存在' } as ApiResponse)
    return
  }

  // Validate template exists and is active (if setting, not clearing)
  if (publishedTemplateId != null) {
    const tpl = db.prepare(
      "SELECT id FROM templates WHERE id = ? AND status = 'active'"
    ).get(publishedTemplateId) as any
    if (!tpl) {
      res.status(400).json({ success: false, error: '模板不存在或已下架' } as ApiResponse)
      return
    }
  }

  db.prepare('UPDATE boards SET published_template_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(publishedTemplateId, boardId)

  res.json({ success: true } as ApiResponse)
})

/**
 * PUT /api/boards/:id/cells
 */
router.put('/:id/cells', async (req: Request, res: Response): Promise<void> => {
  const db = getDb()
  const boardId = parseInt(req.params.id as string)
  const userId = req.user!.userId
  const { cells } = req.body as UpdateCellsRequest

  // Input validation
  if (!Array.isArray(cells)) {
    res.status(400).json({ success: false, error: 'cells 必须为数组' } as ApiResponse)
    return
  }
  // Cell title length + position bounds will be validated after fetching board grid_size below.
  for (const cell of cells) {
    if (cell.title && typeof cell.title === 'string' && cell.title.length > CELL_TITLE_MAX_LEN) {
      res.status(400).json({ success: false, error: `格子标题不能超过 ${CELL_TITLE_MAX_LEN} 字符` } as ApiResponse)
      return
    }
  }

  // ── Content moderation ──
  const allTitles = cells.map(c => c.title || '').filter(Boolean).join('\n')
  if (allTitles.trim()) {
    const modResult = await checkText(req.user!.openid, allTitles, 2)
    if (!modResult.pass) {
      res.status(400).json({ success: false, error: '内容含违规信息，请修改后重试' } as ApiResponse)
      return
    }
  }

  // Verify board belongs to current user
  const board = db
    .prepare('SELECT id, grid_size FROM boards WHERE id = ? AND user_id = ?')
    .get(boardId, userId) as { id: number; grid_size: number } | undefined

  if (!board) {
    res.status(404).json({ success: false, error: 'Bingo卡不存在' } as ApiResponse)
    return
  }

  // Validate cell positions are within bounds (0 ~ gridSize²-1)
  const maxPosition = board.grid_size * board.grid_size - 1
  for (const cell of cells) {
    if (!Number.isInteger(cell.position) || cell.position < 0 || cell.position > maxPosition) {
      res.status(400).json({
        success: false,
        error: `格子位置必须在 0~${maxPosition} 之间`,
      } as ApiResponse)
      return
    }
  }

  // illustration_path handling per cell:
  //  - field present (a key/URL, or '' to clear)  → apply it verbatim
  //  - field omitted (client isn't managing illustrations on this push):
  //      • title unchanged → preserve the existing illustration. This is what
  //        protects a freshly seeded starter board: the client's first cell
  //        sync re-sends the seeded titles without illustrationPath, and the
  //        seeded thumbnails must survive.
  //      • title changed   → clear it, because an illustration tied to the old
  //        word is stale once the word is reassigned.
  const selectCell = db.prepare(
    'SELECT title, illustration_path FROM cells WHERE board_id = ? AND position = ?'
  )
  const updateStmt = db.prepare(
    'UPDATE cells SET title = ?, illustration_path = ?, completed = ? WHERE board_id = ? AND position = ?'
  )
  const updateAll = db.transaction(() => {
    for (const cell of cells) {
      const completed = cell.completed ? 1 : 0
      let illustPath: string
      if (cell.illustrationPath !== undefined) {
        illustPath = sanitizeIllustrationKey(cell.illustrationPath || '')
      } else {
        const existing = selectCell.get(boardId, cell.position) as
          | { title: string; illustration_path: string }
          | undefined
        illustPath =
          existing && existing.title === cell.title ? existing.illustration_path || '' : ''
      }
      updateStmt.run(cell.title, illustPath, completed, boardId, cell.position)
    }
  })
  updateAll()

  // Update board timestamp
  db.prepare('UPDATE boards SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(boardId)

  const updatedCells = getBoardCells(db, boardId)
  res.json({ success: true, data: updatedCells } as ApiResponse<Cell[]>)
})

/**
 * PATCH /api/boards/:id/favorite
 */
router.patch('/:id/favorite', (req: Request, res: Response): void => {
  const db = getDb()
  const boardId = Number(req.params.id)
  const userId = req.user!.userId

  const board = db
    .prepare('SELECT id, is_favorite FROM boards WHERE id = ? AND user_id = ?')
    .get(boardId, userId) as any

  if (!board) {
    res.status(404).json({ success: false, error: 'Bingo卡不存在' } as ApiResponse)
    return
  }

  const newVal = board.is_favorite === 1 ? 0 : 1
  db.prepare('UPDATE boards SET is_favorite = ? WHERE id = ?').run(newVal, boardId)

  res.json({ success: true, data: { isFavorite: newVal === 1 } } as ApiResponse<{ isFavorite: boolean }>)
})

export default router
