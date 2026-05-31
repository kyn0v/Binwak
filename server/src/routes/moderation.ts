import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/auth'
import { checkText } from '../services/moderation'

const router = Router()

router.use(authMiddleware)

/**
 * POST /api/moderation/check
 * Text content safety moderation (lightweight endpoint)
 * Body: { text: string }
 * Returns: { pass: boolean, message?: string }
 */
const TEXT_MAX_LEN = 2500 // WeChat msg_sec_check upper bound

router.post('/check', async (req: Request, res: Response): Promise<void> => {
  const { text } = req.body as { text?: unknown }

  if (typeof text !== 'string') {
    res.status(400).json({ success: false, error: 'text 必须为字符串' })
    return
  }

  const trimmed = text.trim()
  if (!trimmed) {
    res.json({ success: true, data: { pass: true } })
    return
  }

  if (trimmed.length > TEXT_MAX_LEN) {
    res.status(400).json({ success: false, error: `text 长度超过 ${TEXT_MAX_LEN} 字符` })
    return
  }

  const result = await checkText(req.user!.openid, trimmed, 2)

  if (!result.pass) {
    res.json({
      success: true,
      data: { pass: false, message: '内容含违规信息，请修改' },
    })
    return
  }

  res.json({ success: true, data: { pass: true } })
})

export default router
