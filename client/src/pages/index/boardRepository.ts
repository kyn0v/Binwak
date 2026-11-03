import { STORAGE_KEYS } from '@/config/storageKeys'
import { DEFAULT_GRID_SIZE, DEFAULT_WORDS, GRID_SIZE_OPTIONS } from './bingoDefaults'

export type SavedCell = {
  id: number
  title: string
  completed: boolean
  generation: number
  localPath?: string
  imageName?: string
  suppressedImageName?: string
  illustrationKey?: string
}
export type BoardSnapshot = { title: string; gridSize: number; theme: string; cells: SavedCell[] }
export type BoardRecord = {
  snapshot: BoardSnapshot
  revision: number
  acknowledged: number
  recovery?: BoardSnapshot
  retainedFiles: string[]
  deleting: boolean
  deleted: boolean
  publishedTemplateId?: number | null
}
export type Workspace = {
  version: 1
  principal: string
  activeBoardId: number | null
  boards: Record<string, BoardRecord>
  words: { words: string[]; revision: number; acknowledged: number; initialized: boolean }
  legacyImported: boolean
  legacy?: Record<string, unknown>
}
export const workspaceKey = (principal: string) => `binwak-workspace-v1/${encodeURIComponent(principal)}`
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) }
export function emptySnapshot(): BoardSnapshot {
  return { title: '', gridSize: DEFAULT_GRID_SIZE, theme: 'mono', cells: Array.from({ length: DEFAULT_GRID_SIZE ** 2 }, (_, id) => ({ id, title: DEFAULT_WORDS[id] ?? '', completed: false, generation: 0 })) }
}
export function newRecord(snapshot: BoardSnapshot): BoardRecord {
  return { snapshot: clone(snapshot), revision: 0, acknowledged: 0, retainedFiles: [], deleting: false, deleted: false }
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function counter(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function optionalString(value: unknown) { return value === undefined || typeof value === 'string' }
function isSnapshot(value: unknown): value is BoardSnapshot {
  if (!object(value) || typeof value.title !== 'string' || typeof value.theme !== 'string' || typeof value.gridSize !== 'number' || !GRID_SIZE_OPTIONS.includes(value.gridSize) || !Array.isArray(value.cells) || value.cells.length !== value.gridSize ** 2) return false
  return value.cells.every((cell, id) => object(cell) && cell.id === id && typeof cell.title === 'string' && typeof cell.completed === 'boolean' && counter(cell.generation) && ['localPath', 'imageName', 'suppressedImageName', 'illustrationKey'].every(key => optionalString(cell[key])))
}
function isWorkspace(value: unknown, principal: string): value is Workspace {
  if (!object(value) || value.version !== 1 || value.principal !== principal || !(value.activeBoardId === null || counter(value.activeBoardId)) || !object(value.boards) || !object(value.words) || typeof value.legacyImported !== 'boolean') return false
  if (typeof value.words.initialized !== 'boolean' || !Array.isArray(value.words.words) || !value.words.words.every(w => typeof w === 'string') || !counter(value.words.revision) || !counter(value.words.acknowledged) || value.words.acknowledged > value.words.revision) return false
  if (!Object.entries(value.boards).every(([id, entry]) => /^\d+$/.test(id) && object(entry) && isSnapshot(entry.snapshot) && (entry.recovery === undefined || isSnapshot(entry.recovery)) && counter(entry.revision) && counter(entry.acknowledged) && entry.acknowledged <= entry.revision && typeof entry.deleting === 'boolean' && typeof entry.deleted === 'boolean' && Array.isArray(entry.retainedFiles) && entry.retainedFiles.every(p => typeof p === 'string'))) return false
  return value.activeBoardId === null || value.boards[String(value.activeBoardId)] !== undefined
}

export function openWorkspace(principal: string): Workspace {
  const saved: unknown = uni.getStorageSync(workspaceKey(principal))
  if (saved !== '' && saved !== undefined && saved !== null) {
    if (object(saved) && object(saved.words) && saved.words.initialized === undefined) {
      saved.words.initialized = (Array.isArray(saved.words.words) && saved.words.words.length > 0) || (counter(saved.words.revision) && saved.words.revision > 0)
    }
    if (!isWorkspace(saved, principal)) throw new Error('本地数据无法读取，已保留原数据，请勿清除缓存')
    return clone(saved)
  }
  return { version: 1, principal, activeBoardId: null, boards: {}, words: { words: [], revision: 0, acknowledged: 0, initialized: false }, legacyImported: false }
}
export function saveWorkspace(workspace: Workspace): void {
  if (!isWorkspace(workspace, workspace.principal)) throw new Error('本地数据格式无效')
  uni.setStorageSync(workspaceKey(workspace.principal), clone(workspace))
}

export function preserveLegacy(guestPrincipal: string): Workspace {
  const guest = openWorkspace(guestPrincipal)
  if (guest.legacyImported) return guest
  const legacy: Record<string, unknown> = {}
  for (const key of [STORAGE_KEYS.BINGO_STATE, STORAGE_KEYS.BOARD_TITLE, STORAGE_KEYS.GRID_SIZE, STORAGE_KEYS.WORD_BANK, STORAGE_KEYS.REMOTE_BOARD_ID, STORAGE_KEYS.THEME]) {
    const value: unknown = uni.getStorageSync(key)
    if (value !== '' && value !== undefined && value !== null) legacy[key] = value
  }
  guest.legacyImported = true
  if (Object.keys(legacy).length) guest.legacy = legacy
  if (guest.activeBoardId === null) {
    const snapshot = emptySnapshot()
    const state = legacy[STORAGE_KEYS.BINGO_STATE]
    const size = legacy[STORAGE_KEYS.GRID_SIZE]
    if (typeof size === 'number' && GRID_SIZE_OPTIONS.includes(size)) snapshot.gridSize = size
    else if (object(state) && typeof state.gridSize === 'number' && GRID_SIZE_OPTIONS.includes(state.gridSize)) snapshot.gridSize = state.gridSize
    snapshot.cells = Array.from({ length: snapshot.gridSize ** 2 }, (_, id) => ({ id, title: DEFAULT_WORDS[id] ?? '', completed: false, generation: 0 }))
    if (object(state) && Array.isArray(state.cells)) {
      snapshot.cells = Array.from({ length: snapshot.gridSize ** 2 }, (_, id) => {
        const cell: unknown = state.cells instanceof Array ? state.cells[id] : undefined
        return { id, title: object(cell) && typeof cell.title === 'string' ? cell.title : '', completed: object(cell) && cell.completed === true, generation: 0,
          localPath: object(cell) && typeof cell.imagePath === 'string' ? cell.imagePath : undefined,
          illustrationKey: object(cell) && typeof cell.illustrationPath === 'string' ? cell.illustrationPath.split('?')[0] : undefined }
      })
    }
    const title = legacy[STORAGE_KEYS.BOARD_TITLE]
    if (typeof title === 'string') snapshot.title = title
    guest.boards['0'] = newRecord(snapshot)
    guest.activeBoardId = 0
    const words = legacy[STORAGE_KEYS.WORD_BANK]
    guest.words.initialized = true
    guest.words.words = Array.isArray(words) && words.every(w => typeof w === 'string') ? [...new Set(words)] : [...DEFAULT_WORDS]
  }
  saveWorkspace(guest)
  return guest
}

export function retainFiles(record: BoardRecord, cells: SavedCell[]) {
  record.retainedFiles = [...new Set([...record.retainedFiles, ...cells.flatMap(c => c.localPath ? [c.localPath] : [])])]
}
