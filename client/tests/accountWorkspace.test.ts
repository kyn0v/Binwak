import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardDetail } from '../../shared/types'

type Request = { url: string; method: string; header: Record<string, string>; data?: { cells?: BoardDetail['cells']; title?: string }; success: (response: unknown) => void; fail: (error: unknown) => void }
const disk = new Map<string, string>()
const calls: Request[] = []
const remote = new Map<number, BoardDetail>()
let holdProfile = false
let heldProfile: Request | undefined
let offline = false
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function success(request: Request, data: unknown) { request.success({ statusCode: 200, data: { success: true, data: data === undefined ? undefined : copy(data) } }) }
function request(request: Request) {
  calls.push({ ...request, data: request.data ? copy(request.data) : undefined })
  const owner = request.header.Authorization?.includes('token-B') ? 2 : 1
  const path = new URL(request.url).pathname
  if (offline) { request.fail({ errMsg: 'request:fail offline' }); return }
  if (path === '/api/auth/profile') {
    if (holdProfile) { heldProfile = request; return }
    success(request, { userId: owner, nickname: '', imageStorage: 'local' }); return
  }
  if (path === '/api/boards') { success(request, [...remote.values()].filter(board => board.userId === owner)); return }
  if (path === '/api/wordbank' || path === '/api/wordbank/batch') { success(request, { words: [] }); return }
  const match = path.match(/^\/api\/boards\/(\d+)(\/cells|\/activate)?$/)
  if (!match) throw new Error(`Unexpected request ${path}`)
  const board = remote.get(Number(match[1]))!
  if (board.userId !== owner) throw new Error('cross-account board request')
  if (match[2] === '/cells') {
    board.cells = board.cells.map((cell, position) => ({ ...cell, ...request.data?.cells?.[position] }))
    success(request, board.cells)
  } else {
    if (request.method === 'PUT' && request.data?.title !== undefined) board.title = request.data.title
    if (match[2] === '/activate') for (const other of remote.values()) if (other.userId === owner) other.isActive = other.id === board.id
    success(request, board)
  }
}
async function open() {
  const api = await import('../src/pages/index/api')
  const sync = (await import('../src/pages/index/useSync')).useSync()
  const board = (await import('../src/pages/index/useBingoBoard')).useBingoBoard()
  return { api, sync, board }
}
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); disk.clear(); calls.length = 0; remote.clear(); holdProfile = false; heldProfile = undefined; offline = false
  for (const id of [1, 2, 3]) remote.set(id, {
    id, userId: id === 3 ? 2 : 1, title: `Board ${id}`, gridSize: 3, theme: 'mono', isActive: id !== 2, createdAt: '', updatedAt: '',
    cells: Array.from({ length: 9 }, (_, position) => ({ position, title: `word ${id}-${position}`, completed: false, imageName: '' })),
  })
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => disk.has(key) ? JSON.parse(disk.get(key)!) : '',
    setStorageSync: (key: string, value: unknown) => disk.set(key, JSON.stringify(value)), removeStorageSync: (key: string) => disk.delete(key),
    request, onNetworkStatusChange: vi.fn(), showToast: vi.fn(), login: vi.fn(),
  })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('account workspace and real transport', () => {
  it('paints the last verified account before profile resolves and drains every pending board after reconnect', async () => {
    const first = await open(); first.api.setToken('token-A'); await first.sync.initialSync()
    await first.sync.switchBoard(2); await first.sync.switchBoard(1)
    offline = true
    first.board.cells.value[0].title = 'offline A'
    await first.sync.switchBoard(2)
    first.board.cells.value[0].title = 'offline B'
    vi.clearAllTimers(); vi.resetModules()
    const restarted = await open()
    expect(restarted.sync.remoteBoardId.value).toBe(2)
    expect(restarted.board.cells.value[0].title).toBe('offline B')
    offline = false; holdProfile = true
    const starting = restarted.sync.initialSync()
    expect(restarted.board.cells.value[0].title).toBe('offline B')
    success(heldProfile!, { userId: 1, nickname: '', imageStorage: 'local' }); holdProfile = false
    await starting
    expect(remote.get(1)!.cells[0].title).toBe('offline A')
    expect(remote.get(2)!.cells[0].title).toBe('offline B')
    expect(remote.get(2)!.isActive).toBe(true)
    expect(uni.login).not.toHaveBeenCalled()
  })

  it('keeps pending A work in A when the verified account changes to B', async () => {
    const app = await open(); app.api.setToken('token-A'); await app.sync.initialSync()
    app.board.cells.value[0].title = 'A pending private text'
    app.api.setToken('token-B'); await app.sync.initialSync()
    expect(app.sync.remoteBoardId.value).toBe(3)
    expect(app.board.cells.value[0].title).toBe('word 3-0')
    expect(calls.some(call => call.header.Authorization === 'Bearer token-B' && (JSON.stringify(call.data) ?? '').includes('A pending private text'))).toBe(false)
    app.api.setToken('token-A'); await app.sync.initialSync()
    expect(app.board.cells.value[0].title).toBe('A pending private text')
    expect(remote.get(1)!.cells[0].title).toBe('A pending private text')
  })

  it('does not initiate login or network work merely by opening local state', async () => {
    const app = await open()
    expect(app.board.cells.value.some(cell => !!cell.title)).toBe(true)
    expect(calls).toHaveLength(0)
    expect(uni.login).not.toHaveBeenCalled()
    await app.sync.retryPending()
    expect(calls).toHaveLength(0)
  })
})
