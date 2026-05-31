import { Router, Request, Response } from 'express'
import { getDb } from '../db/database'
import { authMiddleware } from '../middleware/auth'
import { checkText } from '../services/moderation'
import { validateIdParam, WORD_MAX_LEN } from '../middleware/validate'
import type {
  WordBankItem,
  UpdateWordBankRequest,
  ApiResponse,
} from '../../../shared/types'

const router = Router()

router.use(authMiddleware)

// :id param validation
router.param('id', (req, res, next) => validateIdParam(req, res, next))

// Word bank max count
const WORD_BANK_MAX = 500

/**
 * GET /api/wordbank
 */
router.get('/', (req: Request, res: Response): void => {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, word, sort_order FROM word_banks WHERE user_id = ? ORDER BY sort_order')
    .all(req.user!.userId) as Array<{ id: number; word: string; sort_order: number }>

  const words: WordBankItem[] = rows.map((r) => ({
    id: r.id,
    word: r.word,
    sortOrder: r.sort_order,
  }))

  res.json({ success: true, data: { words } } as ApiResponse)
})

/**
 * POST /api/wordbank
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const db = getDb()
  const userId = req.user!.userId
  const { word } = req.body as { word: string }

  if (!word || !word.trim()) {
    res.status(400).json({ success: false, error: '词语不能为空' } as ApiResponse)
    return
  }
  if (word.trim().length > WORD_MAX_LEN) {
    res.status(400).json({ success: false, error: `词语不能超过 ${WORD_MAX_LEN} 字符` } as ApiResponse)
    return
  }

  // ── Content moderation ──
  const modResult = await checkText(req.user!.openid, word.trim(), 2)
  if (!modResult.pass) {
    res.status(400).json({ success: false, error: '内容含违规信息，请修改后重试' } as ApiResponse)
    return
  }

  // Count check
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM word_banks WHERE user_id = ?').get(userId) as { cnt: number }
  if (countRow.cnt >= WORD_BANK_MAX) {
    res.status(400).json({ success: false, error: `词库最多 ${WORD_BANK_MAX} 个词语` } as ApiResponse)
    return
  }

  // Get current max sort_order
  const maxRow = db
    .prepare('SELECT MAX(sort_order) as max_order FROM word_banks WHERE user_id = ?')
    .get(userId) as { max_order: number | null }
  const nextOrder = (maxRow?.max_order ?? -1) + 1

  try {
    const result = db
      .prepare('INSERT INTO word_banks (user_id, word, sort_order) VALUES (?, ?, ?)')
      .run(userId, word.trim(), nextOrder)

    const item: WordBankItem = {
      id: result.lastInsertRowid as number,
      word: word.trim(),
      sortOrder: nextOrder,
    }

    res.status(201).json({ success: true, data: item } as ApiResponse<WordBankItem>)
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      res.status(401).json({ success: false, error: '用户不存在，请重新登录' } as ApiResponse)
    } else if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ success: false, error: '词语已存在' } as ApiResponse)
    } else {
      throw err
    }
  }
})

/**
 * POST /api/wordbank/batch
 * Bulk replace word bank
 */
router.post('/batch', async (req: Request, res: Response): Promise<void> => {
  const db = getDb()
  const userId = req.user!.userId
  const { words } = req.body as UpdateWordBankRequest

  if (!Array.isArray(words)) {
    res.status(400).json({ success: false, error: 'words 必须是字符串数组' } as ApiResponse)
    return
  }
  if (words.length > WORD_BANK_MAX) {
    res.status(400).json({ success: false, error: `词库最多 ${WORD_BANK_MAX} 个词语` } as ApiResponse)
    return
  }
  for (const w of words) {
    if (typeof w === 'string' && w.trim().length > WORD_MAX_LEN) {
      res.status(400).json({ success: false, error: `词语不能超过 ${WORD_MAX_LEN} 字符` } as ApiResponse)
      return
    }
  }

  // ── Content moderation ──
  const allText = words.filter(Boolean).join('\n')
  if (allText.trim()) {
    const modResult = await checkText(req.user!.openid, allText, 2)
    if (!modResult.pass) {
      res.status(400).json({ success: false, error: '内容含违规信息，请修改后重试' } as ApiResponse)
      return
    }
  }

  const replaceAll = db.transaction(() => {
    // Delete old word bank
    db.prepare('DELETE FROM word_banks WHERE user_id = ?').run(userId)

    // Insert new entries
    const insert = db.prepare(
      'INSERT INTO word_banks (user_id, word, sort_order) VALUES (?, ?, ?)'
    )
    words.forEach((word, index) => {
      if (word && word.trim()) {
        insert.run(userId, word.trim(), index)
      }
    })
  })
  try {
    replaceAll()
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      res.status(401).json({ success: false, error: '用户不存在，请重新登录' } as ApiResponse)
      return
    }
    throw err
  }

  // Return updated word bank
  const rows = db
    .prepare('SELECT id, word, sort_order FROM word_banks WHERE user_id = ? ORDER BY sort_order')
    .all(userId) as Array<{ id: number; word: string; sort_order: number }>

  const updatedWords: WordBankItem[] = rows.map((r) => ({
    id: r.id,
    word: r.word,
    sortOrder: r.sort_order,
  }))

  res.json({ success: true, data: { words: updatedWords } } as ApiResponse)
})

/**
 * DELETE /api/wordbank/:id
 */
router.delete('/:id', (req: Request, res: Response): void => {
  const db = getDb()
  const wordId = parseInt(req.params.id)
  const userId = req.user!.userId

  const result = db
    .prepare('DELETE FROM word_banks WHERE id = ? AND user_id = ?')
    .run(wordId, userId)

  if (result.changes === 0) {
    res.status(404).json({ success: false, error: '词语不存在' } as ApiResponse)
    return
  }

  res.json({ success: true } as ApiResponse)
})

export default router
