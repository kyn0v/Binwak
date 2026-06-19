// ============================================
// Binwak — API client
// ============================================
import type {
  ApiResponse,
  LoginResponse,
  ProfileResponse,
  UpdateProfileRequest,
  BoardDetail,
  Board,
  Cell,
  WordBankItem,
  Illustration,
  CreateBoardRequest,
  UpdateBoardRequest,
  UpdateCellsRequest,
  UploadResponse,
  Template,
  TemplateListItem,
  CreateTemplateRequest,
  TemplateCategory,
} from '../../../../shared/types'

// API base URL is configured via env vars (see .env and .env.production)
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
import { STORAGE_KEYS } from '@/config/storageKeys'
import { REQUEST_TIMEOUT } from '@/config/limits'
import { safeGet, safeSet, safeRemove } from '@/utils/safeStorage'

const TOKEN_KEY = STORAGE_KEYS.AUTH_TOKEN
const REFRESH_TOKEN_KEY = STORAGE_KEYS.REFRESH_TOKEN

function isAbsoluteUrl(url: string) {
  return /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')
}

export function resolveApiUrl(url: string): string {
  if (isAbsoluteUrl(url)) return url
  return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`
}

// ---------- Token management ----------

function getToken(): string {
  return safeGet<string>(TOKEN_KEY) || ''
}

function setToken(token: string) {
  safeSet(TOKEN_KEY, token)
}

function getRefreshToken(): string {
  return safeGet<string>(REFRESH_TOKEN_KEY) || ''
}

function setRefreshToken(token: string) {
  safeSet(REFRESH_TOKEN_KEY, token)
}

function setAuthTokens(token: string, refreshToken?: string) {
  setToken(token)
  if (refreshToken) setRefreshToken(refreshToken)
}

function clearToken() {
  safeRemove(TOKEN_KEY)
}

function clearRefreshToken() {
  safeRemove(REFRESH_TOKEN_KEY)
}

function clearAuthTokens() {
  clearToken()
  clearRefreshToken()
  _onLoginStateChange?.(false)
}

// ---------- Login state change callback ----------
// Used by useAuth to keep its loggedIn ref in sync with the token
let _onLoginStateChange: ((loggedIn: boolean) => void) | null = null
let _silentLoginPromise: Promise<void> | null = null

export function onLoginStateChange(cb: (loggedIn: boolean) => void) {
  _onLoginStateChange = cb
}

function normalizeAuthError(err: any): Error {
  const msg = String(err?.errMsg || err?.message || '')
  if (msg.includes('需要重新登录')) {
    return new Error('微信登录态已失效，请在微信开发者工具重新登录后重试')
  }
  if (msg.includes('login:fail')) {
    return new Error('微信登录失败，请重试')
  }
  return err instanceof Error ? err : new Error(msg || '登录失败，请重试')
}

// ---------- Trace ID ----------
// Each request gets a unique trace ID, used to correlate frontend and backend logs

function generateTraceId(): string {
  return Math.random().toString(16).substring(2, 10).padEnd(8, '0')
}

/** Recent API errors (5xx only), auto-attached to bug feedback */
interface RecentError {
  traceId: string
  url: string
  status: number
  time: number
}
const _recentErrors: RecentError[] = []
const MAX_RECENT_ERRORS = 5

function recordError(traceId: string, url: string, status: number) {
  _recentErrors.push({ traceId, url, status, time: Date.now() })
  if (_recentErrors.length > MAX_RECENT_ERRORS) _recentErrors.shift()
}

/** Get recent error trace IDs (for attaching to bug reports) */
export function getRecentErrors(): RecentError[] {
  return [..._recentErrors]
}

/** Get brief device info (no PII) */
export function getDeviceContext(): Record<string, string> {
  try {
    const sys = uni.getSystemInfoSync()
    return {
      platform: sys.platform || '',
      system: sys.system || '',
      appVersion: sys.appVersion || '',
      SDKVersion: (sys as any).SDKVersion || '',
    }
  } catch {
    return {}
  }
}

// ---------- Base request ----------

interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: any
  auth?: boolean
  /** Set false to skip mutation dedup (for read-only POST endpoints). Default: true */
  dedup?: boolean
}

// ---------- Request dedup ----------
// Prevent duplicate mutating requests (rapid double-clicks)
const _inflightMutations = new Set<string>()

function mutationKey(opts: RequestOptions): string {
  return `${opts.method || 'GET'}:${opts.url}`
}

async function request<T>(opts: RequestOptions): Promise<T> {
  const method = opts.method || 'GET'
  const shouldDedup = opts.dedup !== false && method !== 'GET'
  if (shouldDedup) {
    const key = mutationKey(opts)
    if (_inflightMutations.has(key)) {
      return Promise.reject(new Error('请勿重复操作'))
    }
    _inflightMutations.add(key)
    try {
      return await _doRequest<T>(opts, true)
    } finally {
      _inflightMutations.delete(key)
    }
  }
  return _doRequest<T>(opts, true)
}

/**
 * Internal request executor.
 * On 401 with a stored token, clears it, re-logs in, and retries once.
 */
async function _doRequest<T>(opts: RequestOptions, allowRetry: boolean): Promise<T> {
  const traceId = generateTraceId()
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Trace-Id': traceId,
  }

  if (opts.auth !== false) {
    const token = getToken()
    if (token) {
      header['Authorization'] = `Bearer ${token}`
    }
  }

  const fullUrl = `${BASE_URL}${opts.url}`
  const method = (opts.method || 'GET') as UniNamespace.RequestOptions['method']
  console.log(`[API] → ${method} ${fullUrl} [${traceId}]`)

  return new Promise((resolve, reject) => {
    uni.request({
      url: fullUrl,
      method,
      data: opts.data,
      header,
      timeout: REQUEST_TIMEOUT,
      success: async (res) => {
        // Prefer the server-returned traceId
        const resHeaders = res.header || {}
        const serverTraceId = resHeaders['X-Trace-Id'] || resHeaders['x-trace-id'] || traceId
        console.log(`[API] ← ${res.statusCode} ${opts.url} [${serverTraceId}]`)

        // Token expired/invalid → clear, re-login, retry once
        if (res.statusCode === 401 && allowRetry && opts.auth !== false) {
          clearToken()
          _onLoginStateChange?.(false)
          try {
            await _silentLogin()
            const result = await _doRequest<T>(opts, false)
            resolve(result)
          } catch (retryErr) {
            clearAuthTokens()
            reject(normalizeAuthError(retryErr))
          }
          return
        }

        const body = res.data as ApiResponse<T>
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success) {
          resolve(body.data as T)
        } else {
          // 5xx errors: record the trace ID and show a modal to guide the user
          if (res.statusCode >= 500) {
            recordError(serverTraceId, opts.url, res.statusCode)
            _showTraceModal(serverTraceId)
          }
          reject(new Error(body.error || `请求失败 (${res.statusCode})`))
        }
      },
      fail: (err) => {
        console.error(`[API] ✗ ${opts.url} [${traceId}]`, err.errMsg || err)
        const msg = err.errMsg || '网络请求失败'
        const error = new Error(msg) as Error & { _retryable: boolean }
        // timeout / network errors are retryable
        error._retryable = /timeout|request:fail|abort/i.test(msg)
        reject(error)
      },
    })
  })
}

// ---------- Retryable request wrapper ----------

async function requestWithRetry<T>(
  opts: RequestOptions,
  maxRetries = 1,
  delayMs = 2000,
): Promise<T> {
  let lastErr: any
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await request<T>(opts)
    } catch (err: any) {
      lastErr = err
      if (attempt < maxRetries && err._retryable) {
        console.log(`[API] 重试 ${opts.url} (${attempt + 1}/${maxRetries})`)
        await new Promise(r => setTimeout(r, delayMs))
        continue
      }
      break
    }
  }
  throw lastErr
}

// ---------- 5xx trace ID modal ----------
let _traceModalShowing = false

function _showTraceModal(traceId: string) {
  if (_traceModalShowing) return
  _traceModalShowing = true

  uni.showModal({
    title: '操作失败',
    content: `如需反馈系统故障，请截图或复制以下排查码，这能帮助我们快速抓到虫子 🐞\n\n排查码：${traceId}`,
    confirmText: '复制排查码',
    cancelText: '我知道了',
    success: (res) => {
      if (res.confirm) {
        uni.setClipboardData({ data: traceId })
      }
    },
    complete: () => {
      _traceModalShowing = false
    },
  })
}

/** Silent re-login: call wx.login + POST /api/auth/login, save new token */
async function _tryRefreshTokenLogin(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false

  try {
    const data = await _doRequest<{ token: string; refreshToken: string }>(
      {
        url: '/api/auth/refresh',
        method: 'POST',
        data: { refreshToken },
        auth: false,
      },
      false,
    )
    setAuthTokens(data.token, data.refreshToken)
    _onLoginStateChange?.(true)
    return true
  } catch {
    clearRefreshToken()
    return false
  }
}

function _loginWithWxCode(): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (loginRes) => {
        if (!loginRes.code) {
          reject(new Error('wx.login 未返回 code'))
          return
        }
        _doRequest<LoginResponse>(
          { url: '/api/auth/login', method: 'POST', data: { code: loginRes.code }, auth: false },
          false,
        )
          .then((data) => {
            setAuthTokens(data.token, data.refreshToken)
            _onLoginStateChange?.(true)
            resolve()
          })
          .catch((err) => reject(normalizeAuthError(err)))
      },
      fail: (err) => reject(normalizeAuthError(err)),
    })
  })
}

function _silentLogin(): Promise<void> {
  if (_silentLoginPromise) return _silentLoginPromise

  _silentLoginPromise = (async () => {
    const refreshed = await _tryRefreshTokenLogin()
    if (refreshed) return
    await _loginWithWxCode()
  })().finally(() => {
    _silentLoginPromise = null
  })

  return _silentLoginPromise
}

// ---------- Auth ----------

export async function login(): Promise<LoginResponse> {
  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: async (loginRes) => {
        if (!loginRes.code) {
          reject(new Error('wx.login 未返回 code'))
          return
        }
        try {
          const data = await request<LoginResponse>({
            url: '/api/auth/login',
            method: 'POST',
            data: { code: loginRes.code },
            auth: false,
          })
          setAuthTokens(data.token, data.refreshToken)
          resolve(data)
        } catch (err) {
          reject(normalizeAuthError(err))
        }
      },
      fail: (err) => {
        reject(normalizeAuthError(err))
      },
    })
  })
}

export function logout() {
  clearAuthTokens()
}

export function isLoggedIn(): boolean {
  return !!getToken()
}

// ---------- Profile ----------

export async function getProfile(): Promise<ProfileResponse> {
  return request<ProfileResponse>({ url: '/api/auth/profile' })
}

export async function updateNickname(nickname: string): Promise<ProfileResponse> {
  return request<ProfileResponse>({
    url: '/api/auth/profile',
    method: 'PUT',
    data: { nickname } as UpdateProfileRequest,
  })
}

export async function updateImageStorage(imageStorage: 'local' | 'cloud'): Promise<ProfileResponse> {
  return request<ProfileResponse>({
    url: '/api/auth/profile',
    method: 'PUT',
    data: { imageStorage } as UpdateProfileRequest,
  })
}

// ---------- Boards ----------

export async function getBoards(): Promise<Board[]> {
  return request<Board[]>({ url: '/api/boards' })
}

export async function createBoard(data?: CreateBoardRequest): Promise<BoardDetail> {
  return request<BoardDetail>({
    url: '/api/boards',
    method: 'POST',
    data: data || {},
  })
}

export async function getBoard(boardId: number): Promise<BoardDetail> {
  return request<BoardDetail>({ url: `/api/boards/${boardId}` })
}

export async function updateBoard(boardId: number, data: UpdateBoardRequest): Promise<BoardDetail> {
  return request<BoardDetail>({
    url: `/api/boards/${boardId}`,
    method: 'PUT',
    data,
  })
}

export async function deleteBoard(boardId: number): Promise<void> {
  return request<void>({
    url: `/api/boards/${boardId}`,
    method: 'DELETE',
  })
}

export async function resetBoard(boardId: number): Promise<void> {
  return request<void>({
    url: `/api/boards/${boardId}/reset`,
    method: 'POST',
  })
}

export async function favoriteBoard(boardId: number): Promise<{ isFavorite: boolean }> {
  return request<{ isFavorite: boolean }>({
    url: `/api/boards/${boardId}/favorite`,
    method: 'PATCH',
  })
}

export async function activateBoard(boardId: number): Promise<BoardDetail> {
  return request<BoardDetail>({
    url: `/api/boards/${boardId}/activate`,
    method: 'POST',
  })
}

export async function cloneBoard(boardId: number, title: string): Promise<BoardDetail> {
  return request<BoardDetail>({
    url: `/api/boards/${boardId}/clone`,
    method: 'POST',
    data: { title },
  })
}

export async function updateCells(boardId: number, cells: UpdateCellsRequest['cells']): Promise<Cell[]> {
  return request<Cell[]>({
    url: `/api/boards/${boardId}/cells`,
    method: 'PUT',
    data: { cells },
  })
}

// ---------- Word Bank ----------

export async function getWordBank(): Promise<{ words: WordBankItem[] }> {
  return request<{ words: WordBankItem[] }>({ url: '/api/wordbank' })
}

export async function addWordToBank(word: string): Promise<WordBankItem> {
  return request<WordBankItem>({
    url: '/api/wordbank',
    method: 'POST',
    data: { word },
  })
}

export async function replaceWordBank(words: string[]): Promise<{ words: WordBankItem[] }> {
  return request<{ words: WordBankItem[] }>({
    url: '/api/wordbank/batch',
    method: 'POST',
    data: { words },
  })
}

export async function deleteWordFromBank(wordId: number): Promise<void> {
  return request<void>({
    url: `/api/wordbank/${wordId}`,
    method: 'DELETE',
  })
}

// ---------- Upload ----------

export async function getPresignedUrl(key: string): Promise<string> {
  const data = await request<{ url: string }>({
    url: `/api/upload/presigned?key=${encodeURIComponent(key)}`,
  })
  return data.url
}

export async function uploadImage(filePath: string, boardId?: number, position?: number): Promise<UploadResponse> {  return _doUpload(filePath, boardId, position, true)
}

/** Internal upload executor with 401 retry support */
function _doUpload(filePath: string, boardId?: number, position?: number, allowRetry = true): Promise<UploadResponse> {
  const token = getToken()
  const header: Record<string, string> = {}
  if (token) header.Authorization = `Bearer ${token}`

  return new Promise((resolve, reject) => {
    const formData: Record<string, any> = {}
    if (boardId !== undefined) formData.boardId = String(boardId)
    if (position !== undefined) formData.position = String(position)

    uni.uploadFile({
      url: `${BASE_URL}/api/upload`,
      filePath,
      name: 'image',
      formData,
      header,
      success: async (res) => {
        // 401 retry: clear token, re-login, retry once
        if (res.statusCode === 401 && allowRetry) {
          clearToken()
          _onLoginStateChange?.(false)
          try {
            await _silentLogin()
            const result = await _doUpload(filePath, boardId, position, false)
            resolve(result)
          } catch (retryErr) {
            clearAuthTokens()
            reject(normalizeAuthError(retryErr))
          }
          return
        }

        try {
          const body = JSON.parse(res.data) as ApiResponse<UploadResponse>
          if (body.success && body.data) {
            resolve(body.data)
          } else {
            reject(new Error(body.error || '上传失败'))
          }
        } catch {
          reject(new Error('解析上传响应失败'))
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '上传请求失败'))
      },
    })
  })
}

// ---------- Templates ----------

export interface TemplateListResponse {
  templates: TemplateListItem[]
  total: number
  page: number
  limit: number
}

export interface TemplateListParams {
  category?: TemplateCategory
  favorite?: boolean
  keyword?: string
  sort?: 'recommend' | 'popular' | 'newest'
  page?: number
  limit?: number
}

export async function getTemplates(params?: TemplateListParams): Promise<TemplateListResponse> {
  // Build query string manually (URLSearchParams not available in mini program)
  const queryParts: string[] = []
  if (params?.category) queryParts.push(`category=${encodeURIComponent(params.category)}`)
  if (params?.favorite) queryParts.push('favorite=true')
  if (params?.keyword) queryParts.push(`keyword=${encodeURIComponent(params.keyword)}`)
  if (params?.sort) queryParts.push(`sort=${encodeURIComponent(params.sort)}`)
  if (params?.page) queryParts.push(`page=${params.page}`)
  if (params?.limit) queryParts.push(`limit=${params.limit}`)

  const qs = queryParts.join('&')
  return request<TemplateListResponse>({
    url: `/api/templates${qs ? `?${qs}` : ''}`,
  })
}

export async function getTemplate(templateId: number): Promise<Template> {
  return request<Template>({
    url: `/api/templates/${templateId}`,
  })
}

export async function createTemplate(data: CreateTemplateRequest): Promise<Template> {
  return request<Template>({
    url: '/api/templates',
    method: 'POST',
    data,
  })
}

export interface PublishQuota {
  dailyLimit: number
  dailyUsed: number
  dailyRemaining: number
  totalLimit: number
  totalUsed: number
}

export async function getPublishQuota(): Promise<PublishQuota> {
  return request<PublishQuota>({
    url: '/api/templates/publish-quota',
  })
}

export async function favoriteTemplate(templateId: number): Promise<{ favorite: boolean; favoriteCount: number }> {
  return request<{ favorite: boolean; favoriteCount: number }>({
    url: `/api/templates/${templateId}/favorite`,
    method: 'POST',
  })
}

export async function useTemplate(templateId: number, title?: string): Promise<BoardDetail> {
  return request<BoardDetail>({
    url: `/api/templates/${templateId}/use`,
    method: 'POST',
    data: title ? { title } : undefined,
  })
}

export async function deleteTemplate(templateId: number): Promise<void> {
  return request<void>({
    url: `/api/templates/${templateId}`,
    method: 'DELETE',
  })
}

export async function updateBoardPublish(boardId: number, publishedTemplateId: number | null): Promise<void> {
  return request<void>({
    url: `/api/boards/${boardId}/publish`,
    method: 'PATCH',
    data: { publishedTemplateId },
  })
}

export async function getMyTemplates(): Promise<TemplateListResponse> {
  return request<TemplateListResponse>({ url: '/api/templates/mine' })
}

// ---------- Content moderation ----------

export async function checkContent(text: string): Promise<{ pass: boolean; message?: string }> {
  try {
    const res = await request<{ pass: boolean; message?: string }>({
      url: '/api/moderation/check',
      method: 'POST',
      data: { text },
    })
    return res
  } catch {
    // Allow through on network failure (local-first); a later sync will re-moderate
    return { pass: true }
  }
}

// ---------- Exports ----------
export { getToken, setToken, clearToken, getRefreshToken, setRefreshToken, clearRefreshToken, BASE_URL }

// ---------- Illustrations ----------

export async function fetchIllustrations(): Promise<Illustration[]> {
  const data = await request<{ illustrations: Illustration[] }>({
    url: '/api/illustrations',
  })
  return data.illustrations
}

export async function matchIllustrations(words: string[]): Promise<Record<string, { illustrationPath: string; illustrationUrl: string }>> {
  if (words.length === 0) return {}
  const data = await requestWithRetry<{ matches: Record<string, { illustrationPath: string; illustrationUrl: string }> }>({
    url: '/api/illustrations/match',
    method: 'POST',
    data: { words },
    dedup: false, // read-only query, don't dedup
  })
  return data.matches
}

export function uploadIllustration(filePath: string, word: string): Promise<Illustration> {
  return _doIllustUpload(filePath, word, true)
}

function _doIllustUpload(filePath: string, word: string, allowRetry = true): Promise<Illustration> {
  const token = getToken()
  const header: Record<string, string> = {}
  if (token) header.Authorization = `Bearer ${token}`

  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${BASE_URL}/api/illustrations`,
      filePath,
      name: 'image',
      formData: { word },
      header,
      success: async (res) => {
        if (res.statusCode === 401 && allowRetry) {
          clearToken()
          _onLoginStateChange?.(false)
          try {
            await _silentLogin()
            const result = await _doIllustUpload(filePath, word, false)
            resolve(result)
          } catch (retryErr) {
            clearAuthTokens()
            reject(normalizeAuthError(retryErr))
          }
          return
        }
        try {
          const body = JSON.parse(res.data) as ApiResponse<Illustration>
          if (body.success && body.data) {
            resolve(body.data)
          } else {
            reject(new Error(body.error || '上传失败'))
          }
        } catch {
          reject(new Error('解析上传响应失败'))
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '上传请求失败'))
      },
    })
  })
}

export async function deleteIllustration(id: number): Promise<void> {
  await request({ url: `/api/illustrations/${id}`, method: 'DELETE' })
}

// ---------- User feedback ----------

import type {
  CreateFeedbackRequest,
  CreateFeedbackResponse,
  FeedbackIssueItem,
} from '../../../../shared/types'

export async function createFeedback(data: CreateFeedbackRequest): Promise<CreateFeedbackResponse> {
  return request({ url: '/api/feedback', method: 'POST', data })
}

export async function getMyFeedbacks(): Promise<{ issues: FeedbackIssueItem[] }> {
  return request({ url: '/api/feedback/mine', method: 'GET' })
}
