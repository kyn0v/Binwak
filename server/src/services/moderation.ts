/**
 * WeChat content safety moderation service
 *
 * - checkText(): text content safety (msg_sec_check v2)
 * - checkImageSync(): sync image check (imgSecCheck, < 1MB)
 * - checkImage(): async image check (media_check_async v2)
 * - getAccessToken(): fetch and cache access_token
 */
import fs from 'fs'
import path from 'path'
import { config } from '../config'

// ── Types ──

export interface ContentCheckResult {
  pass: boolean
  suggest: 'pass' | 'review' | 'risky'
  label?: number
  error?: string
}

export interface ImageCheckResult {
  submitted: boolean
  traceId?: string
  error?: string
}

// ── Access Token Cache ──

let _cachedToken: string | null = null
let _tokenExpiresAt = 0

export function resetTokenCache() {
  _cachedToken = null
  _tokenExpiresAt = 0
}

export async function getAccessToken(): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiresAt) {
    return _cachedToken
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${config.wx.appId}&secret=${config.wx.secret}`
  const res = await fetch(url)
  const data = (await res.json()) as {
    access_token?: string
    expires_in?: number
    errcode?: number
    errmsg?: string
  }

  if (!data.access_token) {
    throw new Error(`获取 access_token 失败: ${data.errcode} ${data.errmsg}`)
  }

  _cachedToken = data.access_token
  // Expire 5 minutes early to avoid edge cases
  _tokenExpiresAt = Date.now() + (data.expires_in! - 300) * 1000
  return _cachedToken
}

// ── Text Check ──

const TOKEN_EXPIRED_CODES = new Set([40001, 40014, 42001])

export async function checkText(
  openid: string,
  content: string,
  scene: number,
): Promise<ContentCheckResult> {
  // Skip empty content
  if (!content || !content.trim()) {
    return { pass: true, suggest: 'pass' }
  }

  try {
    return await _doCheckText(openid, content, scene, true)
  } catch (err: any) {
    // Graceful degradation: don't block user on API failure
    console.warn('[Moderation] checkText error (graceful pass):', err?.message)
    return { pass: true, suggest: 'pass', error: err?.message || 'unknown error' }
  }
}

async function _doCheckText(
  openid: string,
  content: string,
  scene: number,
  allowRetry: boolean,
): Promise<ContentCheckResult> {
  const token = await getAccessToken()
  const url = `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openid, scene, version: 2, content }),
  })

  const data = (await res.json()) as {
    errcode?: number
    errmsg?: string
    result?: { suggest: 'pass' | 'review' | 'risky'; label: number }
    detail?: any[]
  }

  // Token expired → refresh and retry once
  if (data.errcode && TOKEN_EXPIRED_CODES.has(data.errcode) && allowRetry) {
    resetTokenCache()
    return _doCheckText(openid, content, scene, false)
  }

  if (!data.result) {
    throw new Error(`msg_sec_check failed: ${data.errcode} ${data.errmsg}`)
  }

  return {
    pass: data.result.suggest === 'pass',
    suggest: data.result.suggest,
    label: data.result.label,
  }
}

// ── Image Sync Check (imgSecCheck, < 1MB) ──

export async function checkImageSync(
  filePath: string,
): Promise<ContentCheckResult> {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > 1 * 1024 * 1024) {
      // Images are compressed to 1024px JPEG — should never exceed 1MB
      // If it does, reject as a safety measure
      console.warn('[Moderation] Image > 1MB after compression, rejecting')
      return { pass: false, suggest: 'risky' }
    }
    return await _doCheckImageSync(filePath, true)
  } catch (err: any) {
    console.warn('[Moderation] checkImageSync error (graceful pass):', err?.message)
    return { pass: true, suggest: 'pass', error: err?.message || 'unknown error' }
  }
}

async function _doCheckImageSync(
  filePath: string,
  allowRetry: boolean,
): Promise<ContentCheckResult> {
  const token = await getAccessToken()
  const url = `https://api.weixin.qq.com/wxa/img_sec_check?access_token=${token}`

  const fileBuffer = fs.readFileSync(filePath)
  const boundary = '----FormBoundary' + Date.now().toString(36)
  const fileName = path.basename(filePath)

  // Build multipart/form-data manually
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
  const footer = `\r\n--${boundary}--\r\n`

  const body = Buffer.concat([
    Buffer.from(header),
    fileBuffer,
    Buffer.from(footer),
  ])

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  })

  const data = (await res.json()) as {
    errcode?: number
    errmsg?: string
  }

  // Token expired → retry
  if (data.errcode && TOKEN_EXPIRED_CODES.has(data.errcode) && allowRetry) {
    resetTokenCache()
    return _doCheckImageSync(filePath, false)
  }

  if (data.errcode === 87014) {
    return { pass: false, suggest: 'risky', label: 87014 }
  }

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`img_sec_check: ${data.errcode} ${data.errmsg}`)
  }

  return { pass: true, suggest: 'pass' }
}

// ── Image Check (Async) ──

export async function checkImage(
  openid: string,
  mediaUrl: string,
  scene: number,
): Promise<ImageCheckResult> {
  try {
    return await _doCheckImage(openid, mediaUrl, scene, true)
  } catch (err: any) {
    console.warn('[Moderation] checkImage error:', err?.message)
    return { submitted: false, error: err?.message || 'unknown error' }
  }
}

async function _doCheckImage(
  openid: string,
  mediaUrl: string,
  scene: number,
  allowRetry: boolean,
): Promise<ImageCheckResult> {
  const token = await getAccessToken()
  const url = `https://api.weixin.qq.com/wxa/media_check_async?access_token=${token}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      openid,
      scene,
      version: 2,
      media_url: mediaUrl,
      media_type: 2, // 2 = image
    }),
  })

  const data = (await res.json()) as {
    errcode?: number
    errmsg?: string
    trace_id?: string
  }

  // Token expired → retry
  if (data.errcode && TOKEN_EXPIRED_CODES.has(data.errcode) && allowRetry) {
    resetTokenCache()
    return _doCheckImage(openid, mediaUrl, scene, false)
  }

  if (data.errcode && data.errcode !== 0) {
    return { submitted: false, error: `media_check_async: ${data.errcode} ${data.errmsg}` }
  }

  return { submitted: true, traceId: data.trace_id }
}
