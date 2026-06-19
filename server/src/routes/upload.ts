import { Router, Request, Response } from 'express'
import path from 'path'
import { config } from '../config'
import { getDb } from '../db/database'
import { authMiddleware } from '../middleware/auth'
import { getStorage, validateStorageKey } from '../services/storage'
import { checkImage, checkImageSync } from '../services/moderation'
import { prepareImageForStorage, cleanupFiles } from '../services/imageProcessing'
import { imageMulter } from '../services/imageUpload'
import type { UploadResponse, ApiResponse } from '../../../shared/types'

const router = Router()

router.use(authMiddleware)

// GET /api/upload/presigned?key=photos/u{userId}/...
// Returns a time-limited signed URL for private OSS object access.
// Only allows access to keys within the caller's own user namespace,
// to prevent leaking other users' object existence.
router.get('/presigned', async (req: Request, res: Response): Promise<void> => {
  const key = req.query.key as string
  if (!key) {
    res.status(400).json({ success: false, error: '缺少 key 参数' } as ApiResponse)
    return
  }

  try {
    validateStorageKey(key)
  } catch {
    res.status(400).json({ success: false, error: 'key 不合法' } as ApiResponse)
    return
  }

  // Enforce per-user namespace: photos/u{userId}/...
  const userId = req.user!.userId
  const allowedPrefix = `photos/u${userId}/`
  if (!key.startsWith(allowedPrefix)) {
    res.status(403).json({ success: false, error: '无权访问该资源' } as ApiResponse)
    return
  }

  const storageDriver = getStorage()
  const url = storageDriver.getImageUrl(key)
  res.json({ success: true, data: { url } } as ApiResponse<{ url: string }>)
})

// Multer storage (always save locally first; OSS mode uploads then deletes local)
const upload = imageMulter({ maxBytes: 10 * 1024 * 1024 })

/**
 * POST /api/upload
 *
 * Form data:
 * - image: image file
 * - boardId: board ID
 * - position: cell position
 */
router.post('/', upload.single('image'), async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ success: false, error: '没有上传文件' } as ApiResponse)
    return
  }

  const storageDriver = getStorage()
  const tempFilePath = req.file.path || path.join(config.uploadDir, req.file.filename)

  let preparedImage
  try {
    preparedImage = await prepareImageForStorage(tempFilePath, req.file.mimetype)
  } catch (err) {
    console.error('[Upload] Image normalization error:', err)
    await cleanupFiles([tempFilePath])
    res.status(500).json({ success: false, error: '图片处理失败' } as ApiResponse)
    return
  }

  // Sync image moderation check (blocking, before storage)
  const imageCheckResult = await checkImageSync(preparedImage.filePath)
  if (!imageCheckResult.pass) {
    console.warn('[Upload] Image rejected by moderation:', imageCheckResult)
    await cleanupFiles([preparedImage.filePath, ...preparedImage.cleanupPaths])
    res.status(400).json({ success: false, error: '图片内容不合规，请更换图片' } as ApiResponse)
    return
  }

  let storageResult
  try {
    // Use structured key: photos/u{userId}/b{boardId}/{hash}.ext or photos/u{userId}/{hash}.ext
    const rawBoardId = req.body.boardId ? parseInt(req.body.boardId) : null
    const boardId = (rawBoardId !== null && Number.isFinite(rawBoardId)) ? rawBoardId : null
    const userId = req.user!.userId
    const photoKey = boardId
      ? `photos/u${userId}/b${boardId}/${preparedImage.fileName}`
      : `photos/u${userId}/${preparedImage.fileName}`
    storageResult = await storageDriver.saveAs(preparedImage.filePath, photoKey)
  } catch (err) {
    console.error('[Upload] Storage save error:', err)
    await cleanupFiles([preparedImage.filePath, ...preparedImage.cleanupPaths])
    res.status(500).json({ success: false, error: '文件存储失败' } as ApiResponse)
    return
  }

  await cleanupFiles(preparedImage.cleanupPaths)

  const { key } = storageResult
  // Always expose a viewable (signed for private OSS) URL — both the WeChat
  // moderation fetch below and the client preview need a URL that actually
  // resolves against a private bucket.
  const url = storageDriver.getImageUrl(key)

  /** Helper: delete uploaded file on failure */
  const removeUploadedFile = async () => {
    await storageDriver.delete(key)
  }

  // If boardId and position provided, update cell automatically
  const rawBoardId2 = req.body.boardId ? parseInt(req.body.boardId) : null
  const rawPosition = req.body.position !== undefined ? parseInt(req.body.position) : null
  const boardId = (rawBoardId2 !== null && Number.isFinite(rawBoardId2)) ? rawBoardId2 : null
  const position = (rawPosition !== null && Number.isFinite(rawPosition)) ? rawPosition : null

  if (boardId !== null && position !== null) {
    const db = getDb()
    // Verify board belongs to current user
    const board = db
      .prepare('SELECT id, grid_size FROM boards WHERE id = ? AND user_id = ?')
      .get(boardId, req.user!.userId) as { id: number; grid_size: number } | undefined

    if (!board) {
      await removeUploadedFile()
      res.status(404).json({ success: false, error: 'Bingo卡不存在' } as ApiResponse)
      return
    }

    // Validate position range
    const maxPos = board.grid_size * board.grid_size
    if (position < 0 || position >= maxPos) {
      await removeUploadedFile()
      res.status(400).json({ success: false, error: `位置必须在 0~${maxPos - 1} 之间` } as ApiResponse)
      return
    }

    // Replace DB reference first; delete the old object only after the DB commit.
    const oldCell = db
      .prepare('SELECT image_name FROM cells WHERE board_id = ? AND position = ?')
      .get(boardId, position) as { image_name: string } | undefined

    try {
      // Store key (not fileName) for OSS compatibility
      db.prepare(
        'UPDATE cells SET completed = 1, image_name = ?, completed_at = CURRENT_TIMESTAMP WHERE board_id = ? AND position = ?'
      ).run(key, boardId, position)

      db.prepare('UPDATE boards SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(boardId)
    } catch (err) {
      await removeUploadedFile().catch(() => {})
      console.error('[Upload] Cell update error:', err)
      res.status(500).json({ success: false, error: '保存图片记录失败' } as ApiResponse)
      return
    }

    if (oldCell?.image_name) {
      await storageDriver.delete(oldCell.image_name).catch(() => {})
    }
  }

  // ── Async image moderation (non-blocking) ──
  checkImage(req.user!.openid, url, 4).catch((err) => {
    console.warn('[Upload] Image moderation submission failed:', err?.message)
  })

  const response: ApiResponse<UploadResponse> = {
    success: true,
    data: { fileName: key, url },
  }
  res.json(response)
})

export default router
