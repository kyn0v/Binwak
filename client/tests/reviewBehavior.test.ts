import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { ref, watch } from 'vue'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { DEFAULT_WORDS } from '../src/pages/index/bingoDefaults'

const ROOT = new URL('../src/pages/index/', import.meta.url).pathname
const backend = vi.hoisted(() => ({
  getBoards: vi.fn(), getBoard: vi.fn(), getProfile: vi.fn(), getWordBank: vi.fn(),
  createBoard: vi.fn(), activateBoard: vi.fn(), updateBoard: vi.fn(), updateCells: vi.fn(),
  replaceWordBank: vi.fn(), uploadImage: vi.fn(), checkContent: vi.fn(), updateImageStorage: vi.fn(),
  principal: 'https://test.invalid|test/account/1', logged: true, epoch: 1,
}))
vi.mock('../src/pages/index/api', () => ({
  ...backend, SERVICE_ID: 'https://test.invalid|test', BASE_URL: 'https://test.invalid',
  isLoggedIn: () => backend.logged, getLastPrincipal: () => backend.principal || null,
  getAuthScope: () => ({ epoch: backend.epoch, principal: backend.principal || null }),
  isAuthScopeCurrent: (scope: { epoch: number }) => scope.epoch === backend.epoch,
  onAuthChange: vi.fn(), resolveApiUrl: (s: string) => s,
}))
vi.mock('../src/pages/index/useCanvasExport', () => ({ preWarmLocalPaths: vi.fn() }))
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const disk = new Map<string, any>()
const toasts: any[] = []
let modal: any
let actionSheet: any
let failSave = false
const detail = (id = 1) => ({ id, userId: 1, title: `Board ${id}`, gridSize: 3, theme: 'mono', isActive: id === 1,
  createdAt: '', updatedAt: '', cells: Array.from({ length: 9 }, (_, position) => ({ position, title: `word ${id}-${position}`, completed: false, imageName: '', imageUrl: '' })) })
const wait = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
async function open(online = true) {
  const sync = (await import('../src/pages/index/useSync')).useSync()
  const board = (await import('../src/pages/index/useBingoBoard')).useBingoBoard()
  const words = (await import('../src/pages/index/useWordBank')).useWordBank()
  if (online) await sync.initialSync()
  return { sync, board, words }
}
// Exercise actual SFC handlers without reproducing their implementations in the test.
function handlers(names: string[], bindings: Record<string, any>, file = ROOT + 'board.vue') {
  const source = fs.readFileSync(file, 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0]
  const tree = ts.createSourceFile('board.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const nodes = tree.statements.filter(s => ts.isFunctionDeclaration(s) && s.name && names.includes(s.name.text))
  expect(nodes).toHaveLength(names.length)
  const js = ts.transpileModule(nodes.map(s => s.getText(tree)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  return new Function(...Object.keys(bindings), js + `\nreturn {${names.join(',')}}`)(...Object.values(bindings))
}
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.resetAllMocks(); disk.clear(); toasts.length = 0; modal = undefined; actionSheet = undefined; failSave = false
  backend.principal = 'https://test.invalid|test/account/1'; backend.logged = true; backend.epoch = 1
  vi.stubGlobal('uni', {
    getStorageSync: (k: string) => disk.has(k) ? copy(disk.get(k)) : '',
    setStorageSync: (k: string, v: unknown) => { if (failSave) throw new Error('quota'); disk.set(k, copy(v)) },
    removeStorageSync: (k: string) => disk.delete(k), showToast: (x: unknown) => toasts.push(x), showModal: (x: unknown) => { modal = x },
    showLoading: vi.fn(), hideLoading: vi.fn(), onNetworkStatusChange: vi.fn(), showActionSheet: (x: unknown) => { actionSheet = x }, setClipboardData: vi.fn(),
  })
  backend.getProfile.mockResolvedValue({ userId: 1, imageStorage: 'local' })
  backend.getBoards.mockResolvedValue([detail(1), detail(2)])
  backend.getBoard.mockImplementation(async (id: number) => detail(id))
  backend.getWordBank.mockResolvedValue({ words: [] })
  backend.activateBoard.mockResolvedValue(undefined); backend.updateBoard.mockResolvedValue(undefined)
  backend.updateCells.mockResolvedValue([]); backend.replaceWordBank.mockResolvedValue({ words: [] })
  backend.checkContent.mockResolvedValue({ pass: true })
  backend.updateImageStorage.mockImplementation(async (imageStorage: string) => ({ userId: 1, imageStorage }))
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('seeds only version defaults for a genuinely uninitialized verified account', async () => {
  backend.principal = ''; backend.logged = false
  const app = await open(false)
  app.words.wordBank.value = ['private guest words']
  backend.logged = true
  await app.sync.initialSync()
  expect(app.words.wordBank.value).toEqual(DEFAULT_WORDS)
  expect(backend.replaceWordBank).toHaveBeenCalledWith(DEFAULT_WORDS)
  expect(app.sync.exportLocalRecovery()).toContain('private guest words')
})
it('keeps a deliberately emptied account empty across hydration and restart', async () => {
  const app = await open()
  app.words.resetWordBank(); await app.sync.flushPending()
  await app.sync.initialSync()
  expect(app.words.wordBank.value).toEqual([])
  vi.clearAllTimers(); vi.resetModules()
  const restarted = await open()
  expect(restarted.words.wordBank.value).toEqual([])
  expect(backend.replaceWordBank.mock.calls.at(-1)?.[0]).toEqual([])
})
it('resumes unstarted manual login retry and waits for selected board before success', async () => {
  backend.principal = ''; backend.logged = false
  const app = await open(false)
  const selected = deferred<ReturnType<typeof detail>>()
  backend.getBoard.mockReturnValueOnce(selected.promise)
  const showMilestone = vi.fn()
  const h = handlers(['showOfflineDetail'], {
    lastSyncError: app.sync.lastSyncError, offlineReason: ref('login failed'),
    ensureLoggedIn: async () => { backend.logged = true; return true }, initialSync: app.sync.initialSync, showMilestone,
  })
  h.showOfflineDetail(); const retry = modal.success({ confirm: true }); await wait()
  expect(showMilestone).not.toHaveBeenCalled()
  expect(app.sync.remoteBoardId.value).toBeNull()
  selected.resolve(detail()); await retry
  expect(app.sync.remoteBoardId.value).toBe(1)
  expect(showMilestone).toHaveBeenCalledWith('🌐', '已恢复在线')
})
it('does not announce online when retry cannot select a board', async () => {
  const app = await open(false)
  backend.getBoards.mockRejectedValue(new Error('offline'))
  const showMilestone = vi.fn()
  const h = handlers(['showOfflineDetail'], { lastSyncError: app.sync.lastSyncError, offlineReason: ref(''), ensureLoggedIn: async () => true, initialSync: app.sync.initialSync, showMilestone })
  h.showOfflineDetail(); await modal.success({ confirm: true })
  expect(showMilestone).not.toHaveBeenCalled()
  expect(toasts.at(-1).title).toBe('offline')
})
it('keeps the old cloud photo suppressed after removing its local replacement', async () => {
  const remote = detail(); remote.cells[0].imageName = 'old.jpg'; remote.cells[0].imageUrl = 'https://cdn.invalid/old.jpg'
  backend.getBoard.mockResolvedValue(remote)
  const { sync, board } = await open()
  expect(await sync.completePhoto(sync.captureCell(0, 'local')!, 'wxfile://saved/replacement')).toBe(true)
  expect(sync.editCell(sync.captureCell(0)!, cell => { cell.imagePath = undefined; cell.completed = false })).toBe(true)
  await sync.flushPending(); await sync.initialSync()
  expect(board.cells.value[0].imagePath).toBeUndefined()
  expect(board.cells.value[0].suppressedImageName).toBe('old.jpg')
  vi.clearAllTimers(); vi.resetModules()
  expect((await open()).board.cells.value[0].imagePath).toBeUndefined()
})
it('restores cloud photo metadata on edit cancel and keeps it through hydration', async () => {
  const remote = detail(); remote.cells[0].imageName = 'old.jpg'; remote.cells[0].imageUrl = 'https://cdn.invalid/old.jpg'
  backend.getBoard.mockResolvedValue(remote)
  const { sync, board } = await open()
  const cellsSnapshot = board.cells.value.map(c => ({ ...c })); const editSelection = sync.captureSelection()
  const picker = (await import('../src/pages/index/useWordPicker')).useWordPicker({ cells: board.cells, wordBank: ref([]), addWord: async () => 'ok', illustCache: new Map([['new word', 'none']]) })
  picker.openWordPicker(0); picker.assignWordToTarget('new word')
  const h = handlers(['cancelEditMode'], { cellsSnapshot, editSelection, selectionCurrent: sync.selectionCurrent, editLocal: sync.editLocal, cells: board.cells, isEditMode: ref(true), preWarmLocalPaths: vi.fn() })
  h.cancelEditMode(); modal.success({ confirm: true })
  expect(board.cells.value[0].imagePath).toBe('https://cdn.invalid/old.jpg')
  expect(board.cells.value[0].suppressedImageName).toBeUndefined()
  await sync.flushPending(); await sync.initialSync()
  expect(board.cells.value[0].imagePath).toBe('https://cdn.invalid/old.jpg')
})
it('commits imported cells, size and name to A without a later server-active rename of B', async () => {
  const { sync, board } = await open()
  board.applyTitles(Array(9).fill('')); await sync.flushPending()
  const held = deferred<any[]>(); backend.getBoards.mockReturnValueOnce(held.promise)
  const milestones = vi.fn()
  const h = handlers(['onApplyShareCode'], {
    captureSelection: sync.captureSelection, selectionCurrent: sync.selectionCurrent, importCodeText: ref('valid'),
    parseShareCode: () => ({ gridSize: 4, titles: Array(16).fill('imported A') }), mergeWords: async () => ({ added: 16, blocked: false }),
    closeSharePanel: vi.fn(), getBoardState: () => 'empty', editLocal: sync.editLocal, changeGridSize: board.changeGridSize,
    applyTitles: board.applyTitles, boardTitle: board.boardTitle, showMilestone: milestones,
  })
  const applying = h.onApplyShareCode(); modal.success({ confirm: true, content: 'Imported name' }); await wait()
  await sync.switchBoard(2)
  held.resolve([{ ...detail(1), isActive: false }, { ...detail(2), isActive: true }]); await applying
  expect(sync.remoteBoardId.value).toBe(2); expect(board.boardTitle.value).toBe('Board 2')
  expect(board.cells.value[0].title).toBe('word 2-0')
  const imported = JSON.parse(sync.exportLocalRecovery()).boards['1'].snapshot
  expect(imported.title).toBe('Imported name'); expect(imported.gridSize).toBe(4)
  expect(imported.cells).toHaveLength(16); expect(imported.cells.every((cell: { title: string }) => cell.title === 'imported A')).toBe(true)
})
it('rolls back all share-import fields and never reports success after a failed local save', async () => {
  const { sync, board } = await open()
  board.applyTitles(Array(9).fill('')); await sync.flushPending()
  const milestones = vi.fn()
  const h = handlers(['onApplyShareCode'], {
    captureSelection: sync.captureSelection, selectionCurrent: sync.selectionCurrent, importCodeText: ref('valid'),
    parseShareCode: () => ({ gridSize: 4, titles: Array(16).fill('imported A') }), mergeWords: async () => ({ added: 16, blocked: false }),
    closeSharePanel: vi.fn(), getBoardState: () => 'empty', editLocal: sync.editLocal, changeGridSize: board.changeGridSize,
    applyTitles: board.applyTitles, boardTitle: board.boardTitle, showMilestone: milestones,
  })
  const applying = h.onApplyShareCode()
  vi.spyOn(uni, 'setStorageSync').mockImplementation((key, value) => {
    if (JSON.stringify(value).includes('Imported name')) throw new Error('quota')
    disk.set(key, copy(value))
  })
  modal.success({ confirm: true, content: 'Imported name' }); await applying
  expect(board.boardTitle.value).toBe('Board 1'); expect(board.gridSize.value).toBe(3)
  expect(board.cells.value.every(cell => cell.title === '')).toBe(true)
  expect(sync.lastSyncError.value).toBe('quota'); expect(milestones).not.toHaveBeenCalled()
})
it('keeps a nonempty-board import on its newly created card when selection changes before the handler resumes', async () => {
  const { sync, board } = await open()
  const created = detail(3); created.gridSize = 4
  created.cells = Array.from({ length: 16 }, (_, position) => ({ position, title: '', completed: false, imageName: '', imageUrl: '' }))
  backend.createBoard.mockResolvedValue(created)
  const h = handlers(['onApplyShareCode'], {
    captureSelection: sync.captureSelection, selectionCurrent: sync.selectionCurrent, importCodeText: ref('valid'),
    parseShareCode: () => ({ gridSize: 4, titles: Array(16).fill('imported new card') }), mergeWords: async () => ({ added: 16, blocked: false }),
    closeSharePanel: vi.fn(), getBoardState: () => 'words-only', currentThemeId: ref('mono'), currentPublishedTemplateId: ref(null),
    createAndSwitchBoard: async (...args: Parameters<typeof sync.createAndSwitchBoard>) => {
      const result = await sync.createAndSwitchBoard(...args)
      await sync.switchBoard(2)
      return result
    },
    applyTitles: board.applyTitles, showMilestone: vi.fn(), resetProgressMilestones: vi.fn(),
  })
  const applying = h.onApplyShareCode(); modal.success({ confirm: true, content: 'Imported new card' }); await applying
  expect(board.cells.value[0].title).toBe('word 2-0')
  const imported = JSON.parse(sync.exportLocalRecovery()).boards['3'].snapshot
  expect(imported.gridSize).toBe(4)
  expect(imported.cells.every((cell: { title: string }) => cell.title === 'imported new card')).toBe(true)
})
it.each(['selection', 'account'])('rejects a recovery confirmation after the %s changed', async change => {
  const { sync } = await open()
  backend.createBoard.mockResolvedValue(detail(3))
  const h = handlers(['onRecoverLocal'], { closeMenu: vi.fn(), importLocalRecovery: sync.importLocalRecovery, captureSelection: sync.captureSelection, selectionCurrent: sync.selectionCurrent })
  h.onRecoverLocal()
  if (change === 'selection') await sync.switchBoard(2)
  else backend.epoch++
  await modal.success({ confirm: true })
  expect(backend.createBoard).not.toHaveBeenCalled()
})
it('does not copy recovery content into a different selected card during creation completion', async () => {
  const { sync, board } = await open()
  await sync.switchBoard(2); await wait(); await sync.switchBoard(1); await wait()
  const created = detail(3); created.gridSize = 5
  created.cells = Array.from({ length: 25 }, (_, position) => ({ position, title: '', completed: false, imageName: '', imageUrl: '' }))
  backend.createBoard.mockResolvedValue(created)
  const stop = watch(sync.remoteBoardId, id => { if (id === 3) void sync.switchBoard(2) }, { flush: 'sync' })
  await sync.importLocalRecovery()
  stop()
  expect(sync.remoteBoardId.value).toBe(2)
  expect(board.cells.value[0].title).toBe('word 2-0')
  expect(board.gridSize.value).toBe(3)
})
it.each(['unchanged', 'guest', 'another-board', 'returned-board', 'replaced-cell', 'replaced-photo', 'account'])('opens a delayed photo preview only for its still-selected captured cell: %s', async change => {
  if (change === 'guest') { backend.logged = false; backend.principal = '' }
  const { sync, board } = await open(change !== 'guest')
  if (change === 'guest') {
    expect(sync.remoteBoardId.value).toBeNull()
    expect(sync.captureSelection().boardId).toBe(0)
    expect(sync.editLocal(() => { board.cells.value[0].title = 'guest task' })).toBe(true)
  }
  const initialTarget = sync.captureCell(0, 'local')
  assert(initialTarget)
  expect(await sync.completePhoto(initialTarget, 'wxfile://saved/card-one')).toBe(true)
  const photoTarget = sync.captureCell(0, 'local')
  assert(photoTarget)
  const cellPreviewIndex = ref<number | null>(null)
  const h = handlers(['handleCellTap', 'previewCellImage'], {
    cells: board.cells, imageMode: ref('local'), captureCell: sync.captureCell,
    targetCurrent: sync.targetCurrent, captureSelection: sync.captureSelection, selectionCurrent: sync.selectionCurrent,
    showBoardSwitcher: ref(false), isEditMode: ref(false), isActionSheetOpen: ref(false), isPickingImage: ref(false),
    cellPreviewIndex, flippedCells: ref({}),
  })
  await h.handleCellTap(0)
  const pending = actionSheet
  if (change === 'another-board' || change === 'returned-board') await sync.switchBoard(2)
  if (change === 'returned-board') await sync.switchBoard(1)
  if (change === 'replaced-cell') sync.editCell(photoTarget, cell => { cell.title = 'replacement task' })
  if (change === 'replaced-photo') await sync.completePhoto(photoTarget, 'wxfile://saved/replacement')
  if (change === 'account') backend.epoch++
  await pending.success({ tapIndex: 0 })
  expect(cellPreviewIndex.value).toBe(change === 'unchanged' || change === 'guest' ? 0 : null)
})
it('keeps captured local privacy and rejects a replaced cloud target', async () => {
  const { sync, board } = await open()
  const local = sync.captureCell(0, 'local')!
  expect(await sync.completePhoto(local, 'wxfile://saved/local')).toBe(true)
  expect(backend.uploadImage).not.toHaveBeenCalled()
  expect(JSON.parse(sync.exportLocalRecovery()).boards['1'].snapshot.cells[0].localPath).toBe('wxfile://saved/local')
  const oldCloud = sync.captureCell(1, 'cloud')!
  board.applyTitles(Array(9).fill('replacement'))
  expect(await sync.completePhoto(oldCloud, 'wxfile://saved/stale')).toBe(false)
  expect(backend.uploadImage).not.toHaveBeenCalled()
})
it.each(['coordinator', 'profile'])('fences older %s profile hydration against a new local-only choice', async reader => {
  backend.getProfile.mockResolvedValueOnce({ userId: 1, imageStorage: 'cloud' })
  const { sync, board } = await open()
  const preference = (await import('../src/pages/index/usePhotoPreference')).usePhotoPreference()
  const older = deferred<any>(); backend.getProfile.mockReturnValueOnce(older.promise)
  const h = handlers(['toggleImageMode', 'fetchProfile'], {
    ...preference, nickname: ref(''), NICKNAME_KEY: 'nickname', safeGet: () => '', safeSet: vi.fn(), getProfile: backend.getProfile,
  }, ROOT + '../profile/profile.vue')
  const fetching = reader === 'coordinator' ? sync.retryPending() : h.fetchProfile()
  h.toggleImageMode(); await actionSheet.success({ tapIndex: 0 })
  older.resolve({ userId: 1, imageStorage: 'cloud' }); await fetching
  expect(preference.imageMode.value).toBe('local')
  const tap = handlers(['handleCellTap'], {
    imageMode: preference.imageMode, cells: board.cells, captureCell: sync.captureCell, showBoardSwitcher: ref(false), isEditMode: ref(false),
    isActionSheetOpen: ref(false), isPickingImage: ref(false), pickImage: (target: Parameters<typeof sync.completePhoto>[0]) => sync.completePhoto(target, 'wxfile://saved/private'),
  })
  await tap.handleCellTap(0); await actionSheet.success({ tapIndex: 0 })
  expect(board.cells.value[0].imagePath).toBe('wxfile://saved/private')
  expect(backend.uploadImage).not.toHaveBeenCalled()
})
it('does not let a GET started during a preference PUT undo the acknowledged local choice', async () => {
  backend.getProfile.mockResolvedValueOnce({ userId: 1, imageStorage: 'cloud' })
  const { sync } = await open()
  const preference = (await import('../src/pages/index/usePhotoPreference')).usePhotoPreference()
  const put = deferred<any>(); backend.updateImageStorage.mockReturnValueOnce(put.promise)
  const choosing = preference.setImageMode('local')
  const older = deferred<any>(); backend.getProfile.mockReturnValueOnce(older.promise)
  const getting = sync.retryPending()
  put.resolve({ userId: 1, imageStorage: 'local' }); expect(await choosing).toBe(true)
  older.resolve({ userId: 1, imageStorage: 'cloud' }); await getting
  expect(preference.imageMode.value).toBe('local')
})
it('keeps a failed explicit local choice through restart instead of accepting cloud hydration', async () => {
  backend.getProfile.mockResolvedValue({ userId: 1, imageStorage: 'cloud' })
  await open()
  const preference = (await import('../src/pages/index/usePhotoPreference')).usePhotoPreference()
  backend.updateImageStorage.mockRejectedValueOnce(new Error('offline'))
  await expect(preference.setImageMode('local')).rejects.toThrow('offline')
  vi.clearAllTimers(); vi.resetModules(); await open()
  expect((await import('../src/pages/index/usePhotoPreference')).usePhotoPreference().imageMode.value).toBe('local')
})
it('ignores a preference completion from another account and rejects invalid response modes', async () => {
  await open()
  const preference = (await import('../src/pages/index/usePhotoPreference')).usePhotoPreference()
  const put = deferred<any>(); backend.updateImageStorage.mockReturnValueOnce(put.promise)
  const setting = preference.setImageMode('cloud')
  backend.epoch++; backend.principal = 'https://test.invalid|test/account/2'
  const other = (await import('../src/pages/index/usePhotoPreference')).usePhotoPreference()
  put.resolve({ userId: 1, imageStorage: 'cloud' })
  expect(await setting).toBe(false); expect(other.imageMode.value).toBe('local')
  backend.updateImageStorage.mockResolvedValueOnce({ userId: 2, imageStorage: 'unexpected' })
  await expect(other.setImageMode('local')).rejects.toThrow('照片偏好响应无效')
  expect(other.imageMode.value).toBe('local')
})
it('explains that exported recovery information contains no photos and cannot be imported', async () => {
  const { sync } = await open()
  const h = handlers(['copyLocalBackup'], { closeMenu: vi.fn(), exportLocalRecovery: sync.exportLocalRecovery })
  h.copyLocalBackup()
  expect(modal.title).toBe('复制恢复信息（不含照片）')
  expect(modal.content).toContain('不能跨设备还原'); expect(modal.content).toContain('不支持导入此 JSON')
  expect(uni.setClipboardData).not.toHaveBeenCalled()
  modal.success({ confirm: true })
  expect(uni.setClipboardData).toHaveBeenCalledWith({ data: sync.exportLocalRecovery() })
})
