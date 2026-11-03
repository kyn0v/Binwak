import { effectScope, ref, watch } from 'vue'
import * as api from './api'
import type { BoardDetail } from '../../../../shared/types'
import { useBingoBoard, installLocalEdit, installResetAction, createCells, type BingoCell } from './useBingoBoard'
import { useWordBank, installWordEditGuard } from './useWordBank'
import { useTheme } from './useTheme'
import { clone, emptySnapshot, newRecord, openWorkspace, preserveLegacy, retainFiles, saveWorkspace, type BoardSnapshot, type BoardRecord, type SavedCell, type Workspace } from './boardRepository'
import { DEFAULT_WORDS, GRID_SIZE_OPTIONS } from './bingoDefaults'
import { usePhotoPreference } from './usePhotoPreference'

export function defaultBoardTitle(existingTitles: string[] = []): string {
  const d = new Date()
  const base = `${d.getMonth() + 1}月${d.getDate()}日挑战`
  if (!existingTitles.includes(base)) return base
  let i = 2
  while (existingTitles.includes(`${base} #${i}`)) i++
  return `${base} #${i}`
}
const remoteBoardId = ref<number | null>(null)
const syncing = ref(false)
const lastSyncError = ref('')
const recoveryAvailable = ref(false)
const store = useBingoBoard()
const words = useWordBank()
const theme = useTheme()
const photoPreference = usePhotoPreference()
const guestPrincipal = `${api.SERVICE_ID}/guest`
let workspace: Workspace
let initialized = false
const observerScope = effectScope(true)
let blocked = false
let suppressed = 0
let session = 0
let selection = 0
let verified = false
let started = false
let timer: ReturnType<typeof setTimeout> | undefined
let running: Promise<void> | undefined
let activationLane: Promise<unknown> = Promise.resolve()
const lanes = new Map<string, Promise<unknown>>()
const uploading = new Map<string, number>()
const resetting = new Set<string>()
const removing = new Set<string>()
let viewCells: BingoCell[] = []
let viewImagePaths: Array<string | undefined> = []
const urls = new Map<string, string>()
const readEpochs = new Map<string, number>()

function errorMessage(error: unknown) { return error instanceof Error ? error.message : '同步失败，数据保留在本地' }
function report(error: unknown) { lastSyncError.value = errorMessage(error) }
function suppress<T>(work: () => T): T { suppressed++; try { return work() } finally { suppressed-- } }
function activeRecord() { return workspace.boards[String(workspace.activeBoardId)] }
function address(boardId: number) { return `${workspace.principal}/${boardId}` }
function displayCell(cell: SavedCell): BingoCell {
  return { ...cell, imagePath: cell.localPath || (cell.imageName && cell.suppressedImageName !== cell.imageName ? urls.get(cell.imageName) : undefined),
    illustrationPath: cell.illustrationKey ? urls.get(cell.illustrationKey) || api.resolveApiUrl(cell.illustrationKey) : undefined }
}
function paint() {
  suppress(() => {
    remoteBoardId.value = workspace.activeBoardId === 0 ? null : workspace.activeBoardId
    const snapshot = activeRecord()?.snapshot ?? emptySnapshot()
    store.gridSize.value = snapshot.gridSize
    store.boardTitle.value = snapshot.title
    store.cells.value = snapshot.cells.map(displayCell)
    viewCells = [...store.cells.value]
    viewImagePaths = store.cells.value.map(cell => cell.imagePath)
    theme.currentThemeId.value = snapshot.theme
    words.wordBank.value = [...workspace.words.words]
    store.syncLineCount()
  })
}
function save(next: Workspace) { saveWorkspace(next); workspace = next }
function durable(change: (next: Workspace) => void): boolean {
  if (blocked) return false
  try { const next = clone(workspace); change(next); save(next); return true }
  catch (error) { report(error); return false }
}
function snapshotOfView(): BoardSnapshot {
  const previous = activeRecord()?.snapshot
  return { title: store.boardTitle.value, gridSize: store.gridSize.value, theme: theme.currentThemeId.value,
    cells: store.cells.value.map((cell, id) => {
      if (cell.illustrationKey && cell.illustrationPath) urls.set(cell.illustrationKey, cell.illustrationPath)
      if (cell.imageName && cell.imagePath && !cell.localPath) urls.set(cell.imageName, cell.imagePath)
      const old = previous?.cells[id]
      const taskReplaced = old && (old.title !== cell.title || previous.gridSize !== store.gridSize.value)
      const replaced = taskReplaced || viewCells[id] !== cell
      const removed = old && cell.imagePath === undefined && viewImagePaths[id] !== undefined
      const localPath = cell.imagePath === cell.localPath ? cell.localPath : cell.imagePath && !/^https?:|^\/\//.test(cell.imagePath) ? cell.imagePath : undefined
      return { id, title: cell.title, completed: cell.completed,
        generation: replaced || removed ? (old?.generation ?? 0) + 1 : cell.generation ?? old?.generation ?? 0,
        localPath: replaced ? localPath : localPath || (cell.imagePath ? cell.localPath : undefined),
        imageName: cell.imageName,
        suppressedImageName: removed || (taskReplaced && !cell.imagePath) ? old?.imageName || old?.suppressedImageName : cell.suppressedImageName,
        illustrationKey: cell.illustrationPath ? cell.illustrationKey || cell.illustrationPath.split('?')[0] : undefined }
    }) }
}
function persistView(): boolean {
  if (suppressed) return true
  const record = activeRecord()
  if (!record) { paint(); return false }
  const snapshot = snapshotOfView()
  const boardChanged = JSON.stringify(snapshot) !== JSON.stringify(record.snapshot)
  const wordList = [...new Set(words.wordBank.value)]
  const wordsChanged = JSON.stringify(wordList) !== JSON.stringify(workspace.words.words)
  if (!boardChanged && !wordsChanged) return true
  const uploadPosition = uploading.get(address(workspace.activeBoardId!))
  const conflictsWithUpload = uploadPosition !== undefined && (snapshot.gridSize !== record.snapshot.gridSize || JSON.stringify(snapshot.cells[uploadPosition]) !== JSON.stringify(record.snapshot.cells[uploadPosition]))
  if ((boardChanged && (record.deleting || record.deleted || resetting.has(address(workspace.activeBoardId!)))) || conflictsWithUpload) {
    report(new Error('照片上传或删除进行中，请稍后修改此卡'))
    paint(); return false
  }
  const ok = durable(next => {
    if (boardChanged) {
      const entry = next.boards[String(next.activeBoardId)]
      retainFiles(entry, entry.snapshot.cells)
      entry.snapshot = snapshot; entry.recovery = clone(snapshot); entry.revision++
    }
    if (wordsChanged) { next.words.words = wordList; next.words.revision++; next.words.initialized = true }
  })
  if (!ok) {
    paint()
    uni.showToast({ title: '本地保存失败，修改未保存，请释放空间后重试', icon: 'none' })
    return false
  }
  suppress(() => {
    store.cells.value.forEach((cell, id) => Object.assign(cell, snapshot.cells[id]))
    viewCells = [...store.cells.value]
    viewImagePaths = store.cells.value.map(cell => cell.imagePath)
  })
  if (workspace.principal === guestPrincipal) recoveryAvailable.value = true
  wakeSoon()
  return true
}
function editLocal(change: () => void): boolean {
  if (suppressed) { change(); return true }
  try { suppress(change); return persistView() } catch (error) { report(error); paint(); return false }
}
function restoreWorkspace(): boolean {
  try {
    const guest = preserveLegacy(guestPrincipal)
    recoveryAvailable.value = !!guest.legacy || guest.words.revision > 0 || Object.values(guest.boards).some(board => board.revision > 0)
    const principal = api.getLastPrincipal()
    workspace = principal ? openWorkspace(principal) : guest
    blocked = false
    paint()
    lastSyncError.value = ''
    return true
  } catch (error) {
    blocked = true; report(error)
    return false
  }
}
function initialize() {
  if (initialized) return
  initialized = true
  if (!restoreWorkspace()) workspace = { version: 1, principal: guestPrincipal, activeBoardId: null, boards: {}, words: { words: [], revision: 0, acknowledged: 0, initialized: false }, legacyImported: false }
  installLocalEdit(editLocal)
  installWordEditGuard(() => {
    const target = captureSession()
    const bound = !api.isLoggedIn() || target.auth.principal === target.principal
    return () => bound && !blocked && current(target)
  })
  installResetAction(resetRemoteBoard)
  observerScope.run(() => {
    watch(() => JSON.stringify({ snapshot: snapshotOfView(), words: words.wordBank.value }), () => { if (!suppressed) persistView() }, { flush: 'sync' })
  })
  api.onAuthChange(() => {
    session++; selection++; verified = false; running = undefined; syncing.value = false
    if (timer) clearTimeout(timer)
    const principal = api.getLastPrincipal()
    if (!blocked && (!principal || principal !== workspace.principal)) {
      try { workspace = principal ? openWorkspace(principal) : openWorkspace(guestPrincipal); paint() }
      catch (error) { blocked = true; report(error) }
    }
  })
  uni.onNetworkStatusChange?.(({ isConnected }) => { if (isConnected) void retryPending() })
}
function captureSession() { return { session, principal: workspace.principal, auth: api.getAuthScope() } }
function current(target: ReturnType<typeof captureSession>) {
  return target.session === session && target.principal === workspace.principal && api.isAuthScopeCurrent(target.auth)
}
function canSend(target: ReturnType<typeof captureSession>) { return verified && api.isLoggedIn() && current(target) && !blocked }
function inLane<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (lanes.get(key) ?? Promise.resolve()).catch(() => {}).then(action)
  lanes.set(key, result)
  void result.finally(() => { if (lanes.get(key) === result) lanes.delete(key) }).catch(() => {})
  return result
}
function wakeSoon() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = undefined; void flushPending() }, 800)
}
async function sendBoard(boardId: number) {
  const target = captureSession()
  const record = workspace.boards[String(boardId)]
  if (!record || boardId === 0 || record.deleted || record.deleting || record.revision === record.acknowledged || !canSend(target)) return
  const snapshot = clone(record.snapshot)
  const revision = record.revision
  await inLane(address(boardId), async () => {
    if (!canSend(target) || workspace.boards[String(boardId)].acknowledged >= revision || workspace.boards[String(boardId)].deleted) return
    await api.updateBoard(boardId, { title: snapshot.title, gridSize: snapshot.gridSize, theme: snapshot.theme })
    if (!canSend(target)) return
    await api.updateCells(boardId, snapshot.cells.map(c => ({ position: c.id, title: c.title, illustrationPath: c.illustrationKey ?? '', completed: c.completed })))
    if (!canSend(target)) return
    if (!durable(next => { next.boards[String(boardId)].acknowledged = Math.max(next.boards[String(boardId)].acknowledged, revision) })) throw new Error('同步回执未能保存，将保留待同步数据')
  })
}
async function flushPending(): Promise<void> {
  if (running) return running
  const target = captureSession()
  if (!canSend(target)) return
  const hasPending = Object.entries(workspace.boards).some(([id, entry]) => id !== '0' && !entry.deleted && !entry.deleting && entry.revision > entry.acknowledged) || workspace.words.revision > workspace.words.acknowledged
  if (!hasPending) return
  const work = (async () => {
    syncing.value = true
    try {
      let failure: unknown
      async function attemptSnapshot(send: () => Promise<void>) {
        for (let attempt = 0; attempt < 2 && canSend(target); attempt++) {
          try { await send(); return } catch (error) {
            if (attempt || !(typeof error === 'object' && error && '_retryable' in error && error._retryable)) {
              failure = error
              return
            }
            await new Promise(resolve => setTimeout(resolve, 1500))
          }
        }
      }
      for (const id of Object.keys(workspace.boards)) {
        if (!canSend(target)) return
        await attemptSnapshot(() => sendBoard(Number(id)))
      }
      if (canSend(target) && workspace.words.revision !== workspace.words.acknowledged) {
        const sent = clone(workspace.words)
        await attemptSnapshot(async () => {
          await api.replaceWordBank(sent.words)
          if (canSend(target) && !durable(next => { next.words.acknowledged = Math.max(next.words.acknowledged, sent.revision) })) throw new Error('词库同步回执未能保存')
        })
      }
      if (current(target)) {
        if (failure) report(failure)
        else lastSyncError.value = ''
      }
    } finally { if (current(target)) syncing.value = false }
  })()
  running = work
  try { await work } finally {
    if (running === work) running = undefined
    if (canSend(target) && !lastSyncError.value && (Object.values(workspace.boards).some(entry => !entry.deleting && !entry.deleted && entry.revision > entry.acknowledged) || workspace.words.revision > workspace.words.acknowledged)) wakeSoon()
  }
}
function parseRemote(board: BoardDetail, old?: BoardRecord): BoardRecord {
  if (!board || `${api.SERVICE_ID}/account/${board.userId}` !== workspace.principal || !Number.isSafeInteger(board.id) || board.id <= 0 || !GRID_SIZE_OPTIONS.includes(board.gridSize) || typeof board.title !== 'string' || typeof board.theme !== 'string' || !Array.isArray(board.cells) || board.cells.length !== board.gridSize ** 2) throw new Error('服务器卡片格式无效')
  const seen = new Set<number>()
  const cells = board.cells.map(cell => {
    if (!cell || !Number.isInteger(cell.position) || cell.position < 0 || cell.position >= board.gridSize ** 2 || seen.has(cell.position) || typeof cell.title !== 'string' || typeof cell.completed !== 'boolean' || typeof cell.imageName !== 'string') throw new Error('服务器格子格式无效')
    seen.add(cell.position)
    const previous = old?.snapshot.cells[cell.position]
    const same = previous?.title === cell.title && old?.snapshot.gridSize === board.gridSize
    if (cell.imageName && cell.imageUrl) urls.set(cell.imageName, api.resolveApiUrl(cell.imageUrl))
    if (cell.illustrationPath && cell.illustrationUrl) urls.set(cell.illustrationPath, api.resolveApiUrl(cell.illustrationUrl))
    return { id: cell.position, title: cell.title, completed: cell.completed,
      generation: (previous?.generation ?? 0) + (same ? 0 : 1), localPath: same ? previous?.localPath : undefined,
      imageName: cell.imageName || undefined, suppressedImageName: previous?.suppressedImageName,
      illustrationKey: cell.illustrationPath || undefined }
  }).sort((a, b) => a.id - b.id)
  const entry = old ? clone(old) : newRecord(emptySnapshot())
  retainFiles(entry, entry.snapshot.cells)
  entry.snapshot = { title: board.title, gridSize: board.gridSize, theme: board.theme, cells }
  entry.publishedTemplateId = board.publishedTemplateId
  return entry
}
async function readBoard(boardId: number) {
  const target = captureSession()
  const key = address(boardId)
  const readEpoch = (readEpochs.get(key) ?? 0) + 1
  readEpochs.set(key, readEpoch)
  const old = workspace.boards[String(boardId)]
  const revision = old?.revision
  const clean = !old || old.revision === old.acknowledged
  const board = await api.getBoard(boardId)
  if (!canSend(target) || readEpochs.get(key) !== readEpoch) return false
  const now = workspace.boards[String(boardId)]
  if (!clean || now?.revision !== revision || (now && (now.revision !== now.acknowledged || now.deleting || now.deleted))) return !!now
  const entry = parseRemote(board, now)
  if (!durable(next => { next.boards[String(boardId)] = entry })) return false
  if (workspace.activeBoardId === boardId) paint()
  return true
}
function result() {
  const record = activeRecord()
  return record ? { ...clone(record.snapshot), cells: record.snapshot.cells.map(displayCell), publishedTemplateId: record.publishedTemplateId } : null
}
function select(boardId: number) {
  const record = workspace.boards[String(boardId)]
  if (!record || record.deleted || record.deleting) return false
  if (!durable(next => { next.activeBoardId = boardId })) return false
  paint(); return true
}
function activate(boardId: number, intent: number) {
  const target = captureSession()
  const work = activationLane.catch(() => {}).then(async () => {
    if (!canSend(target) || intent !== selection) return false
    await api.activateBoard(boardId)
    return canSend(target) && intent === selection
  })
  activationLane = work
  return work
}
async function verifyIdentity() {
  if (!api.isLoggedIn() || blocked) return false
  const epoch = session
  const preferenceFence = photoPreference.capturePreference()
  const profile = await api.getProfile()
  if (epoch !== session) return false
  const principal = `${api.SERVICE_ID}/account/${profile.userId}`
  if (principal !== workspace.principal) {
    const next = openWorkspace(principal)
    session++; selection++; workspace = next; running = undefined; urls.clear(); paint()
  }
  verified = true
  photoPreference.hydratePreference(profile, preferenceFence)
  return true
}
async function initialSync() {
  initialize()
  started = true
  if (blocked && !restoreWorkspace()) return null
  lastSyncError.value = ''
  try {
    if (!await verifyIdentity()) return null
    await reconcileDeletions()
    const target = captureSession()
    const intent = selection
    const wordRevision = workspace.words.revision
    const wordClean = wordRevision === workspace.words.acknowledged
    const list = await api.getBoards()
    if (!canSend(target) || intent !== selection) return result()
    if (workspace.activeBoardId !== null) {
      try {
        await readBoard(workspace.activeBoardId)
        if (!list.some(board => board.id === workspace.activeBoardId && board.isActive)) await activate(workspace.activeBoardId, intent)
      } catch (error) { report(error) }
    } else if (list.length) {
      const id = (list.find(board => board.isActive) ?? list[0]).id
      if (await readBoard(id) && intent === selection) select(id)
    } else {
      const board = await api.createBoard({ title: defaultBoardTitle(), gridSize: emptySnapshot().gridSize, theme: 'mono' })
      if (!canSend(target) || intent !== selection) return null
      const entry = parseRemote(board)
      if (entry.snapshot.cells.every(c => !c.title)) {
        entry.snapshot.cells.forEach((cell, id) => { cell.title = emptySnapshot().cells[id]?.title ?? '' })
        entry.revision++; entry.recovery = clone(entry.snapshot)
      }
      if (!durable(next => { next.boards[String(board.id)] = entry; next.activeBoardId = board.id })) return null
      paint()
    }
    if (wordClean) {
      try {
        const remote = await api.getWordBank()
        if (!Array.isArray(remote.words) || !remote.words.every(w => typeof w.word === 'string')) throw new Error('词库格式无效')
        if (canSend(target) && workspace.words.revision === wordRevision && workspace.words.acknowledged === wordRevision) {
          if (durable(next => {
            const remoteWords = [...new Set(remote.words.map(w => w.word))]
            const seed = !next.words.initialized && remoteWords.length === 0
            next.words.words = seed ? [...DEFAULT_WORDS] : remoteWords
            next.words.initialized = true
            if (seed) next.words.revision++
          })) paint()
        }
      } catch (error) { report(error) }
    }
    await flushPending()
    return result()
  } catch (error) { report(error); return null }
}
async function retryPending() {
  initialize()
  if (blocked && !restoreWorkspace()) return
  if (!started) return
  if (!activeRecord()) { await initialSync(); return }
  lastSyncError.value = ''
  try {
    if (await verifyIdentity()) {
      await reconcileDeletions()
      if (!activeRecord()) { await initialSync(); return }
      let activationError: unknown
      if (workspace.activeBoardId && !activeRecord()?.deleting) {
        try { await activate(workspace.activeBoardId, selection) } catch (error) { activationError = error }
      }
      await flushPending()
      if (activationError) report(activationError)
    }
  } catch (error) { report(error) }
}
async function switchBoard(boardId: number) {
  initialize()
  const intent = ++selection
  try {
    if (workspace.boards[String(boardId)] && select(boardId)) {
      if (verified) { void activate(boardId, intent).catch(report); void readBoard(boardId).catch(report) }
      return result()
    }
    if (!verified || !await readBoard(boardId) || selection !== intent || !select(boardId)) return null
    void activate(boardId, intent).catch(report)
    return result()
  } catch (error) { report(error); return null }
}
async function createAndSelect(create: () => Promise<BoardDetail>, snapshot?: BoardSnapshot) {
  initialize()
  if (!verified) return null
  const initialSnapshot = snapshot ? clone(snapshot) : undefined
  const target = captureSession(); const intent = ++selection
  try {
    const board = await create()
    if (!canSend(target)) return null
    const entry = parseRemote(board)
    if (initialSnapshot) {
      entry.snapshot = initialSnapshot
      retainFiles(entry, initialSnapshot.cells)
      entry.revision++; entry.recovery = clone(entry.snapshot)
    }
    if (!durable(next => { next.boards[String(board.id)] = entry })) return null
    if (initialSnapshot) wakeSoon()
    if (intent !== selection) {
      if (workspace.activeBoardId) await activate(workspace.activeBoardId, selection)
      return null
    }
    if (!await activate(board.id, intent) || !select(board.id) || intent !== selection || !canSend(target)) return null
    return result()
  } catch (error) { report(error); return null }
}
function createAndSwitchBoard(title: string, gridSize: number, themeId: string, titles?: readonly string[]) {
  if (!GRID_SIZE_OPTIONS.includes(gridSize)) return Promise.resolve(null)
  const snapshot: BoardSnapshot | undefined = titles ? {
    title, gridSize, theme: themeId,
    cells: Array.from({ length: gridSize ** 2 }, (_, id) => ({ id, title: titles[id] ?? '', completed: false, generation: 0 })),
  } : undefined
  return createAndSelect(() => api.createBoard({ title, gridSize, theme: themeId }), snapshot)
}
async function reconcileDeletions() {
  const target = captureSession()
  for (const [id, record] of Object.entries(workspace.boards)) {
    if (!record.deleting || removing.has(address(Number(id)))) continue
    if (!canSend(target)) return
    try {
      const remote = await api.getBoard(Number(id))
      if (!canSend(target)) return
      if (remote.id !== Number(id)) throw new Error('服务器卡片归属无效')
      parseRemote(remote, record)
      if (!durable(next => { next.boards[id].deleting = false })) return
    } catch (error) {
      if (!canSend(target)) return
      if (typeof error === 'object' && error && 'status' in error && error.status === 404) {
        if (!durable(next => {
          next.boards[id].deleting = false; next.boards[id].deleted = true
          if (next.activeBoardId === Number(id)) next.activeBoardId = null
        })) return
        paint()
      } else report(error)
    }
  }
}
async function removeBoard(boardId: number) {
  initialize()
  const target = captureSession()
  const key = address(boardId)
  if (!canSend(target) || removing.has(key)) return false
  removing.add(key)
  let deleteRequested = false
  try {
    if (!workspace.boards[String(boardId)] && !await readBoard(boardId)) return false
    if (!durable(next => { next.boards[String(boardId)].deleting = true })) return false
    const work = activationLane.catch(() => {}).then(async () => {
      if (!canSend(target)) return false
      const list = await api.getBoards()
      if (!canSend(target)) return false
      let replacement = workspace.activeBoardId !== boardId ? workspace.activeBoardId : list.find(b => b.id !== boardId && !workspace.boards[String(b.id)]?.deleting && !workspace.boards[String(b.id)]?.deleted)?.id
      if (!replacement) {
        const board = await api.createBoard({ title: defaultBoardTitle(), gridSize: 3, theme: 'mono' })
        if (!canSend(target) || !durable(next => { next.boards[String(board.id)] = parseRemote(board) })) return false
        replacement = board.id
      }
      if (!workspace.boards[String(replacement)] && !await readBoard(replacement)) return false
      await api.activateBoard(replacement)
      if (!canSend(target)) return false
      if (workspace.activeBoardId === boardId && !select(replacement)) return false
      return inLane(address(boardId), async () => {
        if (!canSend(target)) return false
        deleteRequested = true
        await api.deleteBoard(boardId)
        if (!canSend(target)) return false
        return durable(next => { next.boards[String(boardId)].deleted = true; next.boards[String(boardId)].deleting = false })
      })
    })
    activationLane = work
    return await work
  } catch (error) {
    report(error)
    if (deleteRequested && canSend(target)) {
      try { await api.getBoard(boardId) } catch (detailError) {
        if (canSend(target) && typeof detailError === 'object' && detailError && 'status' in detailError && detailError.status === 404) {
          return durable(next => { next.boards[String(boardId)].deleted = true; next.boards[String(boardId)].deleting = false })
        }
      }
    }
    return false
  } finally {
    removing.delete(key)
    if (!deleteRequested && current(target) && workspace.boards[String(boardId)]?.deleting) {
      durable(next => { next.boards[String(boardId)].deleting = false })
    }
  }
}
export type CellTarget = Readonly<ReturnType<typeof captureSession> & { boardId: number; position: number; generation: number; mode: 'local' | 'cloud' }>
function captureCell(position: number, mode: 'local' | 'cloud' = 'local'): CellTarget | null {
  initialize()
  const cell = activeRecord()?.snapshot.cells[position]
  return cell && workspace.activeBoardId !== null ? { ...captureSession(), boardId: workspace.activeBoardId, position, generation: cell.generation, mode } : null
}
function targetCurrent(target: CellTarget) {
  const record = workspace.boards[String(target.boardId)]
  return current(target) && !!record && !record.deleting && !record.deleted && record.snapshot.cells[target.position]?.generation === target.generation
}
function editCell(target: CellTarget, change: (cell: BingoCell) => void) {
  if (!targetCurrent(target) || workspace.activeBoardId !== target.boardId) return false
  return editLocal(() => { change(store.cells.value[target.position]) })
}
async function completePhoto(target: CellTarget, permanentPath: string): Promise<boolean> {
  if (!targetCurrent(target)) {
    try {
      const owner = target.principal === workspace.principal ? clone(workspace) : openWorkspace(target.principal)
      const entry = owner.boards[String(target.boardId)]
      if (entry) {
        entry.retainedFiles = [...new Set([...entry.retainedFiles, permanentPath])]
        saveWorkspace(owner)
        if (owner.principal === workspace.principal) workspace = owner
      }
    } catch (error) { report(error) }
    return false
  }
  const key = address(target.boardId)
  if (uploading.has(key) || resetting.has(key)) return false
  if (!durable(next => { const entry = next.boards[String(target.boardId)]; entry.retainedFiles = [...new Set([...entry.retainedFiles, permanentPath])] })) return false
  const apply = (imageName?: string, url?: string) => {
    if (!targetCurrent(target)) return false
    if (imageName && url) urls.set(imageName, api.resolveApiUrl(url))
    const ok = durable(next => {
      const entry = next.boards[String(target.boardId)]
      retainFiles(entry, entry.snapshot.cells)
      const cell = entry.snapshot.cells[target.position]
      cell.localPath = permanentPath
      if (imageName) { cell.imageName = imageName; cell.suppressedImageName = undefined }
      cell.completed = true; cell.generation++
      entry.revision++; entry.recovery = clone(entry.snapshot)
    })
    if (ok && workspace.activeBoardId === target.boardId) paint()
    return ok
  }
  if (target.mode === 'local') { const ok = apply(); if (ok) wakeSoon(); return ok }
  if (!canSend(target)) { report(new Error('照片已保留在本地，云端上传未完成')); return false }
  uploading.set(key, target.position)
  try {
    return await inLane(key, async () => {
      if (!canSend(target) || !targetCurrent(target)) return false
      const before = clone(workspace.boards[String(target.boardId)].snapshot)
      await api.updateBoard(target.boardId, { title: before.title, gridSize: before.gridSize, theme: before.theme })
      if (!canSend(target)) return false
      const uploaded = await api.uploadImage(permanentPath, target.boardId, target.position)
      if (!canSend(target) || !apply(uploaded.fileName, uploaded.url)) return false
      const sent = clone(workspace.boards[String(target.boardId)])
      await api.updateBoard(target.boardId, { title: sent.snapshot.title, gridSize: sent.snapshot.gridSize, theme: sent.snapshot.theme })
      if (!canSend(target)) return false
      await api.updateCells(target.boardId, sent.snapshot.cells.map(c => ({ position: c.id, title: c.title, completed: c.completed, illustrationPath: c.illustrationKey ?? '' })))
      if (!canSend(target)) return false
      return durable(next => { next.boards[String(target.boardId)].acknowledged = Math.max(next.boards[String(target.boardId)].acknowledged, sent.revision) })
    })
  } catch (error) { report(new Error(`照片已保留在本地，云端操作未完成：${errorMessage(error)}`)); return false } finally { uploading.delete(key) }
}
async function resetRemoteBoard(): Promise<boolean> {
  const boardId = workspace.activeBoardId
  if (boardId === null || uploading.has(address(boardId)) || resetting.has(address(boardId))) return false
  const target = captureSession()
  if (!editLocal(() => { store.cells.value = createCells(store.gridSize.value) })) return false
  if (boardId === 0 || !canSend(target)) return true
  const key = address(boardId)
  const sent = clone(workspace.boards[String(boardId)])
  resetting.add(key)
  try {
    return await inLane(key, async () => {
      if (!canSend(target)) return false
      await api.resetBoard(boardId)
      if (!canSend(target)) return false
      await api.updateCells(boardId, sent.snapshot.cells.map(cell => ({ position: cell.id, title: cell.title, illustrationPath: '', completed: false })))
      if (!canSend(target)) return false
      return durable(next => { next.boards[String(boardId)].acknowledged = Math.max(next.boards[String(boardId)].acknowledged, sent.revision) })
    })
  } catch (error) { report(error); return false } finally { resetting.delete(key) }
}
async function renameBoard(boardId: number, title: string) {
  if (!workspace.boards[String(boardId)]) { try { if (!await readBoard(boardId)) return false } catch (error) { report(error); return false } }
  if (workspace.boards[String(boardId)].deleting || workspace.boards[String(boardId)].deleted) return false
  const ok = durable(next => { const entry = next.boards[String(boardId)]; entry.snapshot.title = title; entry.revision++; entry.recovery = clone(entry.snapshot) })
  if (ok) { if (workspace.activeBoardId === boardId) paint(); wakeSoon() }
  return ok
}
async function importLocalRecovery() {
  const guest = openWorkspace(guestPrincipal)
  const record = guest.boards[String(guest.activeBoardId)]
  if (!record) return false
  const snapshot = clone(record.snapshot)
  snapshot.title = snapshot.title.trim() || '本地恢复卡'
  return !!await createAndSelect(() => api.createBoard({ title: snapshot.title, gridSize: snapshot.gridSize, theme: snapshot.theme }), snapshot)
}
export function useSync() {
  initialize()
  return {
    remoteBoardId, syncing, lastSyncError, recoveryAvailable, initialSync, retryPending, flushPending,
    switchBoard, createAndSwitchBoard, removeBoard, renameBoard, resetRemoteBoard,
    createFromTemplate: (templateId: number, title: string) => createAndSelect(() => api.useTemplate(templateId, title)),
    captureCell, targetCurrent, editCell, completePhoto, editLocal, importLocalRecovery,
    exportLocalRecovery: () => JSON.stringify({ principal: workspace.principal, boards: workspace.boards, words: workspace.words.words, unowned: openWorkspace(guestPrincipal) }),
    captureSelection: () => ({ ...captureSession(), selection, boardId: workspace.activeBoardId }),
    selectionCurrent: (target: ReturnType<typeof captureSession> & { selection: number; boardId: number | null }) => current(target) && target.selection === selection && target.boardId === workspace.activeBoardId,
    fetchBoards: async () => api.isLoggedIn() ? api.getBoards() : [],
    duplicateBoard: async (boardId: number, title: string) => {
      const target = captureSession()
      try {
        await flushPending()
        const entry = workspace.boards[String(boardId)]
        if (!canSend(target) || (entry && (entry.revision !== entry.acknowledged || entry.deleting || entry.deleted))) return false
        await api.cloneBoard(boardId, title)
        return canSend(target)
      } catch (error) { report(error); return false }
    },
    getBoardSequenceNumber: async () => { try { const list = await api.getBoards(); list.sort((a, b) => a.createdAt.localeCompare(b.createdAt)); return list.findIndex(b => b.id === remoteBoardId.value) + 1 || null } catch { return null } },
    isKnownEmpty: (boardId: number) => { const entry = workspace.boards[String(boardId)]; return !!entry && !entry.deleting && !entry.deleted && entry.snapshot.cells.every(c => !c.title.trim() && !c.localPath && !c.imageName && !c.illustrationKey && !c.completed) },
  }
}
