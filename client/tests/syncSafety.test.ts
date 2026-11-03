import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import type { BoardDetail } from '../../shared/types'

const backend = vi.hoisted(() => ({
  getBoards: vi.fn(), getBoard: vi.fn(), createBoard: vi.fn(), updateBoard: vi.fn(),
  updateCells: vi.fn(), activateBoard: vi.fn(), deleteBoard: vi.fn(), uploadImage: vi.fn(),
  getProfile: vi.fn(), getWordBank: vi.fn(), replaceWordBank: vi.fn(), useTemplate: vi.fn(),
  verified: true, epoch: 1,
  checkContent: vi.fn(), resetBoard: vi.fn(),
}))
vi.mock('../src/pages/index/api', () => ({
  ...backend, BASE_URL: 'https://test.invalid', SERVICE_ID: 'https://test.invalid|test',
  isLoggedIn: () => backend.verified,
  getAuthScope: () => ({ epoch: backend.epoch, principal: 'https://test.invalid|test/account/1' }),
  getStoredPrincipal: () => 'https://test.invalid|test/account/1',
  getLastPrincipal: () => 'https://test.invalid|test/account/1',
  isAuthScopeCurrent: (scope: { epoch: number }) => scope.epoch === backend.epoch,
  onAuthChange: () => () => {}, resolveApiUrl: (url: string) => url,
  cloneBoard: vi.fn(),
}))
const disk = new Map<string, string>()
let failSave = false
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
function detail(id: number, title = `Board ${id}`): BoardDetail {
  return { id, userId: 1, title, gridSize: 3, theme: 'mono', isActive: id === 1,
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
    cells: Array.from({ length: 9 }, (_, position) => ({ position, title: `word ${id}-${position}`, imageName: '', completed: false })) }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
async function open() {
  const { useSync } = await import('../src/pages/index/useSync')
  const { useBingoBoard } = await import('../src/pages/index/useBingoBoard')
  return { sync: useSync(), board: useBingoBoard() }
}
async function online() {
  const app = await open()
  await app.sync.initialSync()
  await nextTick()
  return app
}
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks(); disk.clear(); failSave = false
  backend.verified = true; backend.epoch = 1
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => disk.has(key) ? JSON.parse(disk.get(key)!) : '',
    setStorageSync: (key: string, value: unknown) => { if (failSave) throw new Error('quota'); disk.set(key, JSON.stringify(value)) },
    removeStorageSync: (key: string) => disk.delete(key), showToast: vi.fn(),
    onNetworkStatusChange: vi.fn(),
  })
  backend.checkContent.mockResolvedValue({ pass: true })
  backend.getBoards.mockResolvedValue([detail(1), detail(2)])
  backend.getBoard.mockImplementation(async (id: number) => copy(detail(id)))
  backend.activateBoard.mockImplementation(async (id: number) => copy(detail(id)))
  backend.getProfile.mockResolvedValue({ userId: 1, imageStorage: 'local' })
  backend.getWordBank.mockResolvedValue({ words: [] })
  backend.updateBoard.mockResolvedValue(detail(1)); backend.updateCells.mockResolvedValue([])
  backend.replaceWordBank.mockResolvedValue({ words: [] }); backend.deleteBoard.mockResolvedValue(undefined)
  backend.createBoard.mockResolvedValue(detail(3))
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('durable client sync', () => {
  it('keeps the singleton persistence observer after the first view unmounts', async () => {
    const { useSync } = await import('../src/pages/index/useSync')
    const { useBingoBoard } = await import('../src/pages/index/useBingoBoard')
    const viewScope = effectScope()
    const sync = viewScope.run(() => useSync())!
    await sync.initialSync()
    viewScope.stop()
    useBingoBoard().cells.value[0].title = 'edited after remount'
    vi.clearAllTimers(); vi.resetModules()
    const restarted = await open()
    expect(restarted.board.cells.value[0].title).toBe('edited after remount')
  })

  it('keeps a revision pending when its acknowledgement cannot be stored', async () => {
    const { sync, board } = await online()
    board.cells.value[0].title = 'saved before network'
    backend.updateCells.mockImplementationOnce(async () => { failSave = true; return [] })
    await sync.flushPending()
    expect(sync.lastSyncError.value).not.toBe('')
    failSave = false; vi.clearAllTimers(); vi.resetModules()
    const restarted = await online()
    expect(restarted.board.cells.value[0].title).toBe('saved before network')
    expect(backend.updateCells.mock.calls.filter(([, cells]) => cells[0].title === 'saved before network')).toHaveLength(2)
  })

  it('persists a theme-only edit', async () => {
    const themed = detail(1); themed.theme = 'legacy-theme'
    backend.getBoard.mockResolvedValue(themed)
    const { sync } = await online()
    const theme = (await import('../src/pages/index/useTheme')).useTheme()
    theme.setTheme('mono')
    await sync.flushPending()
    expect(backend.updateBoard.mock.calls.at(-1)?.[1].theme).toBe('mono')
  })

  it('does not let an old acknowledgement clear a newer edit', async () => {
    const { sync, board } = await online()
    const held = deferred<BoardDetail>()
    backend.updateBoard.mockReturnValueOnce(held.promise)
    board.cells.value[0].title = 'revision N'
    const sending = sync.flushPending()
    await Promise.resolve()
    board.cells.value[0].title = 'revision N+1'
    held.resolve(detail(1)); await sending
    vi.clearAllTimers(); vi.resetModules()
    const restarted = await online()
    expect(restarted.board.cells.value[0].title).toBe('revision N+1')
    expect(backend.updateCells.mock.calls.at(-1)?.[1][0].title).toBe('revision N+1')
  })

  it('selects the most recent request when uncached GET responses reverse', async () => {
    const { sync } = await online()
    const b = deferred<BoardDetail>(); const c = deferred<BoardDetail>()
    backend.getBoard.mockImplementation((id: number) => id === 2 ? b.promise : c.promise)
    const selectingB = sync.switchBoard(2); const selectingC = sync.switchBoard(3)
    c.resolve(detail(3)); await selectingC
    b.resolve(detail(2)); await selectingB
    expect(sync.remoteBoardId.value).toBe(3)
    await Promise.resolve()
    expect(backend.activateBoard.mock.calls.at(-1)?.[0]).toBe(3)
  })

  it('does not erase an inactive edited board when its old GET finishes', async () => {
    const { sync, board } = await online()
    await sync.switchBoard(2); await sync.switchBoard(1)
    const held = deferred<BoardDetail>()
    backend.getBoard.mockImplementation((id: number) => id === 2 ? held.promise : Promise.resolve(detail(id)))
    await sync.switchBoard(2)
    board.cells.value[0].title = 'new B edit'
    await sync.switchBoard(1)
    held.resolve(detail(2)); await Promise.resolve(); await Promise.resolve()
    await sync.switchBoard(2)
    expect(board.cells.value[0].title).toBe('new B edit')
  })

  it('rolls a compound reassignment and photo save back when storage is full', async () => {
    const { sync, board } = await online()
    const target = sync.captureCell(0)!
    expect(await sync.completePhoto(target, 'wxfile://saved/original')).toBe(true)
    await sync.flushPending(); backend.updateCells.mockClear()
    failSave = true
    expect(sync.editLocal(() => {
      board.cells.value[0].title = 'replacement'
      board.cells.value[0].imagePath = undefined
      board.cells.value[0].completed = false
    })).toBe(false)
    expect(board.cells.value[0].title).toBe('word 1-0')
    expect(board.cells.value[0].imagePath).toBe('wxfile://saved/original')
    expect(await sync.completePhoto(sync.captureCell(0)!, 'wxfile://saved/new')).toBe(false)
    await vi.runAllTimersAsync()
    expect(backend.updateCells).not.toHaveBeenCalled()
  })

  it('rejects a stale photo target and retains its saved file for recovery', async () => {
    const { sync, board } = await online()
    const target = sync.captureCell(0)!
    board.applyTitles(Array(9).fill('replacement'))
    expect(await sync.completePhoto(target, 'wxfile://saved/delayed')).toBe(false)
    expect(board.cells.value[0].imagePath).toBeUndefined()
    expect(sync.exportLocalRecovery()).toContain('wxfile://saved/delayed')
  })

  it('suppresses a removed cloud image after clean hydration', async () => {
    const remote = detail(1)
    remote.cells[0].imageName = 'old.jpg'; remote.cells[0].imageUrl = 'https://cdn.invalid/old.jpg?signature=1'
    backend.getBoard.mockResolvedValue(remote)
    const { sync, board } = await online()
    expect(sync.editCell(sync.captureCell(0)!, cell => { cell.imagePath = undefined; cell.completed = false })).toBe(true)
    await sync.flushPending()
    await sync.initialSync()
    expect(board.cells.value[0].imagePath).toBeUndefined()
  })

  it('refreshes signed URLs without authored writes after nextTick', async () => {
    const remote = detail(1)
    remote.cells[0].imageName = 'photo.jpg'; remote.cells[0].imageUrl = 'https://cdn.invalid/photo?signature=1'
    backend.getBoard.mockResolvedValue(copy(remote))
    const { sync, board } = await online()
    remote.cells[0].imageUrl = 'https://cdn.invalid/photo?signature=2'
    backend.getBoard.mockResolvedValue(copy(remote))
    await sync.initialSync(); await nextTick(); await vi.runAllTimersAsync()
    expect(board.cells.value[0].imagePath).toContain('signature=2')
    expect(backend.updateBoard).not.toHaveBeenCalled()
    expect(backend.updateCells).not.toHaveBeenCalled()
  })

  it('serializes a cloud upload after older cells and sends its completed cells last', async () => {
    const { sync, board } = await online()
    const held = deferred<BoardDetail>()
    backend.updateBoard.mockReturnValueOnce(held.promise)
    board.cells.value[0].title = 'new word'
    const sending = sync.flushPending()
    backend.uploadImage.mockResolvedValue({ fileName: 'new.jpg', url: 'https://cdn.invalid/new.jpg' })
    const photo = sync.completePhoto(sync.captureCell(0, 'cloud')!, 'wxfile://saved/new')
    await Promise.resolve()
    expect(backend.uploadImage).not.toHaveBeenCalled()
    held.resolve(detail(1)); await sending
    expect(await photo).toBe(true)
    expect(backend.updateCells.mock.calls.at(-1)?.[1][0].completed).toBe(true)
    expect(board.cells.value[0].imagePath).toBe('wxfile://saved/new')
  })

  it('does not replay an older queued cells snapshot after an upload has completed', async () => {
    const { sync, board } = await online()
    const upload = deferred<{ fileName: string; url: string }>()
    backend.uploadImage.mockReturnValue(upload.promise)
    const photo = sync.completePhoto(sync.captureCell(0, 'cloud')!, 'wxfile://saved/new')
    await Promise.resolve(); await Promise.resolve()
    board.cells.value[1].title = 'other cell edit'
    const sending = sync.flushPending()
    upload.resolve({ fileName: 'new.jpg', url: 'https://cdn.invalid/new.jpg' })
    expect(await photo).toBe(true)
    await sending
    expect(backend.updateCells.mock.calls.at(-1)?.[1][0].completed).toBe(true)
    expect(backend.updateCells.mock.calls.at(-1)?.[1][1].title).toBe('other cell edit')
  })

  it('does not interpret a missing signed URL after restart as photo removal', async () => {
    const remote = detail(1)
    remote.cells[0].imageName = 'photo.jpg'; remote.cells[0].imageUrl = 'https://cdn.invalid/photo?signature=1'
    backend.getBoard.mockResolvedValue(copy(remote))
    await online(); vi.clearAllTimers(); vi.resetModules(); backend.verified = false
    const restarted = await open()
    restarted.board.saveBoardTitle('offline title')
    backend.verified = true
    await restarted.sync.initialSync()
    const backup = JSON.parse(restarted.sync.exportLocalRecovery())
    expect(backup.boards['1'].snapshot.cells[0].suppressedImageName).toBeUndefined()
    expect(backup.boards['1'].snapshot.cells[0].imageName).toBe('photo.jpg')
  })

  it('retains failed cloud capture without marking complete or automatically replaying POST', async () => {
    const { sync, board } = await online()
    backend.uploadImage.mockRejectedValue(new Error('upload timeout'))
    expect(await sync.completePhoto(sync.captureCell(0, 'cloud')!, 'wxfile://saved/capture')).toBe(false)
    expect(board.cells.value[0].completed).toBe(false)
    expect(board.cells.value[0].imagePath).toBeUndefined()
    await sync.retryPending(); await vi.runAllTimersAsync()
    expect(backend.uploadImage).toHaveBeenCalledTimes(1)
    expect(sync.exportLocalRecovery()).toContain('wxfile://saved/capture')
  })

  it('drains other boards and words when one board fails validation', async () => {
    const { sync, board } = await online()
    board.cells.value[0].title = 'blocked A'
    await sync.switchBoard(2)
    board.cells.value[0].title = 'pending B'
    const words = (await import('../src/pages/index/useWordBank')).useWordBank()
    await words.addWord('pending word')
    backend.updateBoard.mockImplementation(async (id: number) => {
      if (id === 1) throw Object.assign(new Error('validation'), { status: 400 })
      return detail(id)
    })
    await sync.flushPending()
    expect(backend.updateCells.mock.calls.some(([id, cells]) => id === 2 && cells[0].title === 'pending B')).toBe(true)
    expect(backend.replaceWordBank.mock.calls.at(-1)?.[0]).toContain('pending word')
    expect(sync.lastSyncError.value).toBe('validation')
  })

  it('syncs every word mutation independently without dirtying a board', async () => {
    const { sync } = await online()
    const words = (await import('../src/pages/index/useWordBank')).useWordBank()
    words.resetWordBank(); await sync.flushPending(); backend.replaceWordBank.mockClear()
    await words.addWord('A'); await sync.flushPending()
    await words.updateWord(0, 'B'); await sync.flushPending()
    await words.mergeWords(['C', 'C']); await sync.flushPending()
    words.removeWord(0); await sync.flushPending()
    expect(backend.replaceWordBank.mock.calls.map(([list]) => list)).toEqual([['A'], ['B'], ['B', 'C'], ['C']])
    expect(backend.updateCells).not.toHaveBeenCalled()
  })

  it('never sends DELETE when replacement activation fails', async () => {
    const { sync, board } = await online()
    backend.activateBoard.mockRejectedValue(new Error('offline'))
    expect(await sync.removeBoard(1)).toBe(false)
    expect(backend.deleteBoard).not.toHaveBeenCalled()
    expect(board.cells.value[0].title).toBe('word 1-0')
    expect(sync.exportLocalRecovery()).toContain('word 1-0')
  })

  it('keeps the only card when replacement creation fails during explicit deletion', async () => {
    const { sync, board } = await online()
    backend.getBoards.mockResolvedValue([detail(1)])
    backend.createBoard.mockRejectedValue(new Error('creation offline'))
    expect(await sync.removeBoard(1)).toBe(false)
    expect(backend.deleteBoard).not.toHaveBeenCalled()
    expect(board.cells.value[0].title).toBe('word 1-0')
  })

  it('orders a reset before later photos and never blindly retries its POST', async () => {
    const { sync, board } = await online()
    const reset = deferred<void>()
    backend.resetBoard.mockReturnValue(reset.promise)
    const resetting = sync.resetRemoteBoard()
    expect(await sync.completePhoto(sync.captureCell(0)!, 'wxfile://saved/during-reset')).toBe(false)
    reset.resolve(); expect(await resetting).toBe(true)
    expect(board.cells.value.every(cell => !cell.title && !cell.completed)).toBe(true)
    await sync.retryPending(); await vi.runAllTimersAsync()
    expect(backend.resetBoard).toHaveBeenCalledTimes(1)
  })

  it('retains the old snapshot when DELETE fails after activation', async () => {
    const { sync } = await online()
    backend.deleteBoard.mockRejectedValue(new Error('timeout'))
    expect(await sync.removeBoard(1)).toBe(false)
    expect(sync.exportLocalRecovery()).toContain('word 1-0')
    expect(sync.remoteBoardId.value).toBe(2)
  })

  it('applies a template without deleting the old words-only card', async () => {
    const { sync } = await online()
    backend.useTemplate.mockResolvedValue(detail(3, 'Template copy'))
    expect(await sync.createFromTemplate(42, 'Template copy')).not.toBeNull()
    expect(sync.remoteBoardId.value).toBe(3)
    expect(backend.deleteBoard).not.toHaveBeenCalled()
    expect(sync.exportLocalRecovery()).toContain('word 1-0')
  })

  it('does not label words-only or local-photo boards as empty', async () => {
    const { sync, board } = await online()
    expect(sync.isKnownEmpty(1)).toBe(false)
    board.applyTitles(Array(9).fill(''))
    expect(sync.isKnownEmpty(1)).toBe(true)
    await sync.completePhoto(sync.captureCell(0)!, 'wxfile://saved/local')
    expect(sync.isKnownEmpty(1)).toBe(false)
    expect(sync.isKnownEmpty(99)).toBe(false)
  })

  it('creates a starter card online for a verified empty account', async () => {
    backend.getBoards.mockResolvedValue([])
    const starter = detail(3); starter.cells.forEach(cell => { cell.title = '' })
    backend.createBoard.mockResolvedValue(starter)
    const { sync, board } = await online()
    expect(sync.remoteBoardId.value).toBe(3)
    expect(board.cells.value.some(cell => !!cell.title)).toBe(true)
    expect(backend.createBoard).toHaveBeenCalledTimes(1)
  })

  it('retains the latest locally authored recovery copy after clean remote replacement', async () => {
    const { sync, board } = await online()
    board.cells.value[0].title = 'precious authored words'
    await sync.flushPending(); await sync.initialSync()
    expect(sync.exportLocalRecovery()).toContain('precious authored words')
  })
  it('restores an offline edit before network and sends it after restart', async () => {
    const first = await online()
    backend.verified = false
    first.board.cells.value[0].title = 'offline authored word'
    await nextTick()
    vi.resetModules()
    const restarted = await open()
    expect(restarted.board.cells.value[0].title).toBe('offline authored word')
    backend.verified = true
    await restarted.sync.initialSync()
    await vi.runAllTimersAsync()
    expect(restarted.board.cells.value[0].title).toBe('offline authored word')
    expect(backend.updateCells.mock.calls.some(([id, cells]) => id === 1 && cells[0].title === 'offline authored word')).toBe(true)
  })

  it('keeps a delayed settings/cells write addressed to A after switching to B', async () => {
    const { sync, board } = await online()
    const held = deferred<BoardDetail>()
    backend.updateBoard.mockReturnValueOnce(held.promise)
    board.cells.value[0].title = 'edited A'
    const pushing = sync.flushPending()
    await Promise.resolve()
    await sync.switchBoard(2)
    held.resolve(detail(1))
    await pushing
    expect(backend.updateCells.mock.calls.at(-1)?.[0]).toBe(1)
    expect(backend.updateCells.mock.calls.at(-1)?.[1][0].title).toBe('edited A')
  })

  it('retains a permanent local photo through A-B-A and restart hydration', async () => {
    const { sync, board } = await online()
    board.cells.value[0].imagePath = 'wxfile://saved/photo.jpg'
    board.cells.value[0].completed = true
    await nextTick()
    await sync.switchBoard(2)
    await sync.switchBoard(1)
    expect(board.cells.value[0].imagePath).toBe('wxfile://saved/photo.jpg')
    vi.resetModules()
    const restarted = await online()
    expect(restarted.board.cells.value[0].imagePath).toBe('wxfile://saved/photo.jpg')
  })

  it('hydrates without echo after Vue nextTick and persists title and blank edits', async () => {
    const { board, sync } = await online()
    await vi.runAllTimersAsync()
    expect(backend.updateCells).not.toHaveBeenCalled()
    board.saveBoardTitle('only title changed')
    await sync.flushPending()
    expect(backend.updateBoard.mock.calls.at(-1)?.[1].title).toBe('only title changed')
    board.applyTitles(Array(9).fill(''))
    await sync.flushPending()
    expect(backend.updateCells.mock.calls.at(-1)?.[1].every((c: { title: string }) => c.title === '')).toBe(true)
  })

  it('rolls resize back on storage failure without sending invalid state', async () => {
    const { board } = await online()
    failSave = true
    const result = board.changeGridSize(4)
    expect(result).toBe(false)
    expect(board.gridSize.value).toBe(3)
    expect(board.cells.value).toHaveLength(9)
    await vi.runAllTimersAsync()
    expect(backend.updateCells).not.toHaveBeenCalled()
  })

  it('leaves old words and files intact when creation fails', async () => {
    const { sync, board } = await online()
    board.cells.value[0].imagePath = 'wxfile://saved/photo.jpg'
    backend.createBoard.mockRejectedValue(new Error('timeout'))
    expect(await sync.createAndSwitchBoard('new', 3, 'mono')).toBeNull()
    expect(sync.remoteBoardId.value).toBe(1)
    expect(board.cells.value[0].imagePath).toBe('wxfile://saved/photo.jpg')
    expect(backend.deleteBoard).not.toHaveBeenCalled()
  })
})
