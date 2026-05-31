import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock uni global before importing api module
const storage: Record<string, string> = {}
const requestMock = vi.fn()
const loginMock = vi.fn()
const uploadFileMock = vi.fn()

;(globalThis as any).uni = {
  getStorageSync: (key: string) => storage[key] || '',
  setStorageSync: (key: string, val: string) => { storage[key] = val },
  removeStorageSync: (key: string) => { delete storage[key] },
  request: requestMock,
  login: loginMock,
  uploadFile: uploadFileMock,
}

// Now import — api.ts reads BASE_URL at module load
import {
  resolveApiUrl,
  isLoggedIn,
  logout,
  getBoards,
  getProfile,
  getTemplates,
  createBoard,
  deleteBoard,
  favoriteBoard,
  favoriteTemplate,
} from '../src/pages/index/api'

function simulateSuccess(data: any, statusCode = 200) {
  requestMock.mockImplementation((opts: any) => {
    opts.success({ statusCode, data: { success: true, data } })
  })
}

function simulateError(error: string, statusCode = 400) {
  requestMock.mockImplementation((opts: any) => {
    opts.success({ statusCode, data: { success: false, error } })
  })
}

function simulateNetworkFailure() {
  requestMock.mockImplementation((opts: any) => {
    opts.fail({ errMsg: 'request:fail timeout' })
  })
}

beforeEach(() => {
  Object.keys(storage).forEach(k => delete storage[k])
  requestMock.mockReset()
  loginMock.mockReset()
})

// ── resolveApiUrl ──

describe('resolveApiUrl', () => {
  it('returns absolute URLs unchanged', () => {
    expect(resolveApiUrl('https://cdn.example.com/img.png')).toBe('https://cdn.example.com/img.png')
    expect(resolveApiUrl('http://localhost:3000/api')).toBe('http://localhost:3000/api')
  })

  it('prepends BASE_URL for relative paths', () => {
    const result = resolveApiUrl('/uploads/test.png')
    expect(result).toMatch(/\/uploads\/test\.png$/)
  })

  it('handles protocol-relative URLs', () => {
    expect(resolveApiUrl('//cdn.example.com/img.png')).toBe('//cdn.example.com/img.png')
  })
})

// ── Token / Auth state ──

describe('isLoggedIn / logout', () => {
  it('returns false when no token', () => {
    expect(isLoggedIn()).toBe(false)
  })

  it('returns true when token exists', () => {
    storage['binwak-auth-token'] = 'test-token'
    expect(isLoggedIn()).toBe(true)
  })

  it('logout clears tokens', () => {
    storage['binwak-auth-token'] = 'test-token'
    storage['binwak-auth-refresh-token'] = 'refresh-token'
    logout()
    expect(isLoggedIn()).toBe(false)
    expect(storage['binwak-auth-token']).toBeUndefined()
    expect(storage['binwak-auth-refresh-token']).toBeUndefined()
  })
})

// ── Request basics ──

describe('request basics', () => {
  it('GET request resolves with data', async () => {
    simulateSuccess([{ id: 1, title: 'Board 1' }])
    const boards = await getBoards()
    expect(boards).toEqual([{ id: 1, title: 'Board 1' }])
    expect(requestMock).toHaveBeenCalledTimes(1)
    const callOpts = requestMock.mock.calls[0][0]
    expect(callOpts.method).toBe('GET')
    expect(callOpts.url).toContain('/api/boards')
  })

  it('sends Authorization header when token exists', async () => {
    storage['binwak-auth-token'] = 'my-token'
    simulateSuccess({ openid: '123', nickname: 'test' })
    await getProfile()
    const callOpts = requestMock.mock.calls[0][0]
    expect(callOpts.header.Authorization).toBe('Bearer my-token')
  })

  it('rejects on error response', async () => {
    simulateError('Board not found', 404)
    await expect(getBoards()).rejects.toThrow('Board not found')
  })

  it('rejects on network failure', async () => {
    simulateNetworkFailure()
    await expect(getBoards()).rejects.toThrow('request:fail timeout')
  })

  it('sets timeout to 15000', async () => {
    simulateSuccess([])
    await getBoards()
    expect(requestMock.mock.calls[0][0].timeout).toBe(15000)
  })
})

// ── Request dedup ──

describe('request dedup', () => {
  it('rejects duplicate POST while inflight', async () => {
    // First call never resolves immediately — simulate a slow request
    let resolveFirst: (v: any) => void
    requestMock.mockImplementationOnce((opts: any) => {
      // Don't call success yet — leave it pending
      resolveFirst = () => opts.success({ statusCode: 200, data: { success: true, data: { id: 1 } } })
    })

    const first = createBoard({ title: 'test', gridSize: 3 })
    // Second call to same endpoint should be rejected
    await expect(createBoard({ title: 'test2', gridSize: 3 })).rejects.toThrow('请勿重复操作')

    // Resolve first to clean up
    resolveFirst!()
    await first
  })

  it('allows same POST after first completes', async () => {
    simulateSuccess({ id: 1 })
    await createBoard({ title: 'test', gridSize: 3 })

    simulateSuccess({ id: 2 })
    const result = await createBoard({ title: 'test2', gridSize: 3 })
    expect(result).toEqual({ id: 2 })
  })

  it('does not dedup GET requests', async () => {
    let callCount = 0
    requestMock.mockImplementation((opts: any) => {
      callCount++
      opts.success({ statusCode: 200, data: { success: true, data: [] } })
    })
    await Promise.all([getBoards(), getBoards()])
    expect(callCount).toBe(2)
  })
})

// ── Template query string building ──

describe('getTemplates query building', () => {
  it('builds empty query for no params', async () => {
    simulateSuccess({ templates: [], total: 0, page: 1, limit: 20 })
    await getTemplates()
    const url = requestMock.mock.calls[0][0].url
    expect(url).toContain('/api/templates')
    expect(url).not.toContain('?')
  })

  it('builds correct query with all params', async () => {
    simulateSuccess({ templates: [], total: 0, page: 1, limit: 10 })
    await getTemplates({
      category: 'city',
      favorite: true,
      keyword: '美食',
      sort: 'popular',
      page: 2,
      limit: 10,
    })
    const url: string = requestMock.mock.calls[0][0].url
    expect(url).toContain('category=city')
    expect(url).toContain('favorite=true')
    expect(url).toContain('keyword=')
    expect(url).toContain('sort=popular')
    expect(url).toContain('page=2')
    expect(url).toContain('limit=10')
  })

  it('omits unset params', async () => {
    simulateSuccess({ templates: [], total: 0, page: 1, limit: 20 })
    await getTemplates({ sort: 'newest' })
    const url: string = requestMock.mock.calls[0][0].url
    expect(url).toContain('sort=newest')
    expect(url).not.toContain('category')
    expect(url).not.toContain('favorite')
  })
})

// ── Favorite endpoints ──

describe('favorite endpoints', () => {
  it('favoriteBoard sends PATCH', async () => {
    simulateSuccess({ isFavorite: true })
    const result = await favoriteBoard(42)
    expect(result).toEqual({ isFavorite: true })
    const callOpts = requestMock.mock.calls[0][0]
    expect(callOpts.method).toBe('PATCH')
    expect(callOpts.url).toContain('/api/boards/42/favorite')
  })

  it('favoriteTemplate sends POST', async () => {
    simulateSuccess({ favorite: true, favoriteCount: 5 })
    const result = await favoriteTemplate(7)
    expect(result).toEqual({ favorite: true, favoriteCount: 5 })
    const callOpts = requestMock.mock.calls[0][0]
    expect(callOpts.method).toBe('POST')
    expect(callOpts.url).toContain('/api/templates/7/favorite')
  })
})

// ── 401 retry ──

describe('401 auto-retry', () => {
  it('retries with fresh token after 401', async () => {
    storage['binwak-auth-refresh-token'] = 'old-refresh'
    let callNum = 0
    requestMock.mockImplementation((opts: any) => {
      callNum++
      if (callNum === 1) {
        // First call: 401
        opts.success({ statusCode: 401, data: { success: false, error: 'Unauthorized' } })
      } else if (callNum === 2) {
        // Refresh token call
        opts.success({
          statusCode: 200,
          data: { success: true, data: { token: 'new-token', refreshToken: 'new-refresh' } },
        })
      } else {
        // Retry call with new token
        opts.success({
          statusCode: 200,
          data: { success: true, data: [{ id: 1 }] },
        })
      }
    })

    const boards = await getBoards()
    expect(boards).toEqual([{ id: 1 }])
    expect(callNum).toBe(3)
    expect(storage['binwak-auth-token']).toBe('new-token')
  })
})

// ── DELETE ──

describe('deleteBoard', () => {
  it('sends DELETE method', async () => {
    simulateSuccess(undefined)
    await deleteBoard(99)
    const callOpts = requestMock.mock.calls[0][0]
    expect(callOpts.method).toBe('DELETE')
    expect(callOpts.url).toContain('/api/boards/99')
  })
})
