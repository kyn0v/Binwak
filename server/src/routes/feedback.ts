import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/auth'
import { checkText } from '../services/moderation'
import { getStorage, validateStorageKey } from '../services/storage'
import { config } from '../config'
import { getDb } from '../db/database'
import type { CreateFeedbackRequest } from '../../../shared/types'

const router = Router()

const TITLE_MAX_LEN = 50
const CONTENT_MAX_LEN = 1000
const MAX_IMAGES = 3
const VALID_TYPES = new Set(['bug', 'feature'])

function resolveImageUrls(imageKeys: string[]): string[] {
  const storage = getStorage()
  return imageKeys.map(k => storage.getImageUrl(k))
}

function validateFeedbackImageKeys(images: unknown, userId: number): { imageList?: string[]; error?: string } {
  if (images === undefined || images === null) return { imageList: [] }
  if (!Array.isArray(images)) return { error: '图片参数格式错误' }
  if (images.length > MAX_IMAGES) return { error: `最多上传 ${MAX_IMAGES} 张图片` }

  const allowedPrefix = `photos/u${userId}/`
  const imageList: string[] = []
  for (const img of images) {
    if (typeof img !== 'string') return { error: '图片参数格式错误' }
    try {
      validateStorageKey(img)
    } catch {
      return { error: '图片参数不合法' }
    }
    if (!img.startsWith(allowedPrefix)) return { error: '无权引用该图片' }
    imageList.push(img)
  }

  return { imageList }
}

router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const { type, title, content, images } = req.body as CreateFeedbackRequest

  if (!type || !VALID_TYPES.has(type)) {
    res.status(400).json({ success: false, error: '无效的反馈类型' })
    return
  }

  if (!title || typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ success: false, error: '请填写标题' })
    return
  }
  if (title.trim().length > TITLE_MAX_LEN) {
    res.status(400).json({ success: false, error: `标题不能超过 ${TITLE_MAX_LEN} 个字符` })
    return
  }

  if (!content || typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ success: false, error: '请填写反馈内容' })
    return
  }
  if (content.trim().length > CONTENT_MAX_LEN) {
    res.status(400).json({ success: false, error: `内容不能超过 ${CONTENT_MAX_LEN} 个字符` })
    return
  }

  const imageValidation = validateFeedbackImageKeys(images, req.user!.userId)
  if (imageValidation.error) {
    res.status(400).json({ success: false, error: imageValidation.error })
    return
  }
  const imageList = imageValidation.imageList || []

  const modResult = await checkText(req.user!.openid, `${title.trim()} ${content.trim()}`, 2)
  if (!modResult.pass) {
    res.status(400).json({ success: false, error: '内容含违规信息，请修改后重新提交' })
    return
  }

  const prefix = type === 'bug' ? '[Bug]' : '[Feature]'
  let body = content.trim()

  if (imageList.length > 0) {
    const urls = resolveImageUrls(imageList)
    body += '\n\n' + urls.map((url, i) => `![image-${i + 1}](${url})`).join('\n')
  }

  const db = getDb()
  const userRow = db.prepare('SELECT nickname FROM users WHERE id = ?').get(req.user!.userId) as { nickname: string } | undefined
  const nickname = userRow?.nickname || '匿名用户'

  const { token, repo } = config.github
  if (!token || !repo) {
    res.status(500).json({ success: false, error: '服务器未配置 GitHub 反馈仓库' })
    return
  }

  let ghRes: globalThis.Response
  try {
    ghRes = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `${prefix} ${title.trim()}`,
        body: body + `\n\n---\nSubmitted by: ${nickname}`,
        labels: [type, `uid:${req.user!.userId}`],
      }),
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    console.error('GitHub API request failed:', err)
    res.status(502).json({ success: false, error: '创建 GitHub Issue 失败，请稍后重试' })
    return
  }

  if (!ghRes.ok) {
    const err = await ghRes.text()
    console.error('GitHub API error:', ghRes.status, err)
    res.status(502).json({ success: false, error: '创建 GitHub Issue 失败，请稍后重试' })
    return
  }

  const issue = await ghRes.json() as { html_url: string; number: number }

  res.status(201).json({
    success: true,
    data: { issueUrl: issue.html_url, issueNumber: issue.number },
  })
})

router.get('/mine', authMiddleware, async (req: Request, res: Response) => {
  const { token, repo } = config.github
  if (!token || !repo) {
    res.status(500).json({ success: false, error: '服务器未配置 GitHub 反馈仓库' })
    return
  }

  // Look up by immutable user id, not the mutable nickname: a reclaimed
  // nickname must never surface a previous owner's feedback issues.
  const q = `repo:${repo} label:"uid:${req.user!.userId}" is:issue`
  let ghRes: globalThis.Response
  try {
    ghRes = await fetch(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=20`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    console.error('GitHub API request failed:', err)
    res.status(502).json({ success: false, error: '查询 GitHub Issues 失败' })
    return
  }

  if (!ghRes.ok) {
    res.status(502).json({ success: false, error: '查询 GitHub Issues 失败' })
    return
  }

  const data = await ghRes.json() as { items: Array<{ number: number; title: string; html_url: string; state: string; created_at: string }> }
  const issues = data.items.map(i => ({
    number: i.number,
    title: i.title,
    url: i.html_url,
    state: i.state,
    createdAt: i.created_at,
  }))

  res.json({ success: true, data: { issues } })
})

export default router
