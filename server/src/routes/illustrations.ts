import { Router, Request, Response } from 'express'
import path from 'path'
import { config } from '../config'
import { getDb } from '../db/database'
import { authMiddleware } from '../middleware/auth'
import { getStorage } from '../services/storage'
import { checkImageSync } from '../services/moderation'
import { prepareImageForStorage, cleanupFiles } from '../services/imageProcessing'
import { imageMulter, upsertIllustration, deleteStorageObjectQuietly } from '../services/imageUpload'
import type { ApiResponse, Illustration } from '../../../shared/types'

const router = Router()
router.use(authMiddleware)

// 5MB for illustrations (smaller than user photos)
const upload = imageMulter({ maxBytes: 5 * 1024 * 1024 })

/**
 * GET /api/illustrations
 * List all illustrations for the current user.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId
  const db = getDb()
  const storageDriver = getStorage()

  const rows = db.prepare(`
    SELECT id, word, image_path, created_at
    FROM illustrations
    WHERE user_id = ?
    ORDER BY word ASC
  `).all(userId) as Array<{
    id: number; word: string; image_path: string; created_at: string
  }>

  const illustrations: Illustration[] = rows.map(r => ({
    id: r.id,
    word: r.word,
    imagePath: r.image_path,
    imageUrl: storageDriver.getImageUrl(r.image_path),
    createdAt: r.created_at,
  }))

  res.json({ success: true, data: { illustrations } } as ApiResponse)
})

// ── Shared illustration match logic ──
async function matchWords(req: Request, res: Response, words: string[]): Promise<void> {
  if (words.length === 0) {
    res.json({ success: true, data: { matches: {} } } as ApiResponse)
    return
  }

  const userId = req.user!.userId
  const db = getDb()
  const storageDriver = getStorage()

  const placeholders = words.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT id, word, image_path
    FROM illustrations
    WHERE word IN (${placeholders}) AND user_id = ?
  `).all(...words, userId) as Array<{
    id: number; word: string; image_path: string
  }>

  const matches: Record<string, { illustrationPath: string; illustrationUrl: string }> = {}
  for (const r of rows) {
    if (matches[r.word]) continue
    matches[r.word] = {
      illustrationPath: r.image_path,
      illustrationUrl: storageDriver.getImageUrl(r.image_path),
    }
  }

  res.json({ success: true, data: { matches } } as ApiResponse)
}

/**
 * POST /api/illustrations/match
 * Given a list of words, return matching illustrations for the user.
 * Body: { words: string[] }
 */
router.post('/match', async (req: Request, res: Response): Promise<void> => {
  const words: string[] = Array.isArray(req.body?.words) ? req.body.words : []
  matchWords(req, res, words.map(w => String(w).trim()).filter(Boolean))
})

/**
 * POST /api/illustrations
 * Upload illustration for a word.
 * Form data: image (file), word (string)
 */
router.post('/', upload.single('image'), async (req: Request, res: Response): Promise<void> => {
  const word = (req.body.word || '').trim()
  if (!word) {
    res.status(400).json({ success: false, error: '请提供词语' } as ApiResponse)
    return
  }
  if (!req.file) {
    res.status(400).json({ success: false, error: '请上传图片' } as ApiResponse)
    return
  }

  const userId = req.user!.userId
  const storageDriver = getStorage()
  const tempFilePath = req.file.path || path.join(config.uploadDir, req.file.filename)

  // Process image
  let preparedImage
  try {
    preparedImage = await prepareImageForStorage(tempFilePath, req.file.mimetype)
  } catch (err) {
    console.error('[Illustration] Image processing error:', err)
    await cleanupFiles([tempFilePath])
    res.status(500).json({ success: false, error: '图片处理失败' } as ApiResponse)
    return
  }

  // Moderation check
  const imageCheck = await checkImageSync(preparedImage.filePath)
  if (!imageCheck.pass) {
    await cleanupFiles([preparedImage.filePath, ...preparedImage.cleanupPaths])
    res.status(400).json({ success: false, error: '图片内容不合规，请更换图片' } as ApiResponse)
    return
  }

  // Save with structured key: illustrations/u{userId}/{hash}.ext
  const illustKey = `illustrations/u${userId}/${preparedImage.fileName}`
  let storageResult
  try {
    storageResult = await storageDriver.saveAs(preparedImage.filePath, illustKey)
  } catch (err) {
    console.error('[Illustration] Storage save error:', err)
    await cleanupFiles([preparedImage.filePath, ...preparedImage.cleanupPaths])
    res.status(500).json({ success: false, error: '文件存储失败' } as ApiResponse)
    return
  }

  await cleanupFiles(preparedImage.cleanupPaths)

  const db = getDb()

  // Replace DB reference first; delete the old object only after the DB update.
  let previousKey: string | null
  try {
    ;({ previousKey } = upsertIllustration(db, word, userId, storageResult.key))
  } catch (err) {
    await deleteStorageObjectQuietly(storageDriver, storageResult.key)
    console.error('[Illustration] DB save error:', err)
    res.status(500).json({ success: false, error: '保存插画记录失败' } as ApiResponse)
    return
  }

  if (previousKey) {
    await deleteStorageObjectQuietly(storageDriver, previousKey)
  }

  const row = db.prepare(
    'SELECT id, word, image_path, created_at FROM illustrations WHERE word = ? AND user_id = ?'
  ).get(word, userId) as { id: number; word: string; image_path: string; created_at: string }

  const illustration: Illustration = {
    id: row.id,
    word: row.word,
    imagePath: row.image_path,
    imageUrl: storageDriver.getImageUrl(row.image_path),
    createdAt: row.created_at,
  }

  res.status(201).json({ success: true, data: illustration } as ApiResponse)
})

/**
 * DELETE /api/illustrations/:id
 * Delete user's own illustration.
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id)
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: '无效的 ID' } as ApiResponse)
    return
  }

  const userId = req.user!.userId
  const db = getDb()

  const row = db.prepare(
    'SELECT id, image_path FROM illustrations WHERE id = ? AND user_id = ?'
  ).get(id, userId) as { id: number; image_path: string } | undefined

  if (!row) {
    res.status(404).json({ success: false, error: '插画不存在' } as ApiResponse)
    return
  }

  const storageDriver = getStorage()
  await storageDriver.delete(row.image_path)
  db.prepare('DELETE FROM illustrations WHERE id = ?').run(id)

  res.json({ success: true } as ApiResponse)
})

export default router
