import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openWorkspace, preserveLegacy, saveWorkspace, workspaceKey } from '../src/pages/index/boardRepository'
import { STORAGE_KEYS } from '../src/config/storageKeys'

const disk = new Map<string, string>()
let failedWrite = -1
let writes = 0
const guest = 'https://service.invalid|test/guest'
beforeEach(() => {
  disk.clear(); writes = 0; failedWrite = -1
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => disk.has(key) ? JSON.parse(disk.get(key)!) : '',
    setStorageSync: (key: string, value: unknown) => { if (++writes === failedWrite) throw new Error('interrupted'); disk.set(key, JSON.stringify(value)) },
  })
  disk.set(STORAGE_KEYS.GRID_SIZE, JSON.stringify(3))
  disk.set(STORAGE_KEYS.BINGO_STATE, JSON.stringify({ cells: Array.from({ length: 9 }, (_, id) => ({ id, title: `legacy ${id}`, completed: id === 0, imagePath: id === 0 ? 'wxfile://saved/legacy' : undefined })) }))
  disk.set(STORAGE_KEYS.WORD_BANK, JSON.stringify(['legacy words']))
})

describe('workspace storage boundary', () => {
  it('keeps source data if the atomic migration write is interrupted', () => {
    failedWrite = 1
    expect(() => preserveLegacy(guest)).toThrow('interrupted')
    expect(disk.has(workspaceKey(guest))).toBe(false)
    expect(JSON.parse(disk.get(STORAGE_KEYS.BINGO_STATE)!).cells[0].imagePath).toBe('wxfile://saved/legacy')
    failedWrite = -1
    const restored = preserveLegacy(guest)
    expect(restored.boards['0'].snapshot.cells[0].localPath).toBe('wxfile://saved/legacy')
  })

  it('commits provenance with data and never overwrites subsequent guest edits', () => {
    const migrated = preserveLegacy(guest)
    expect(writes).toBe(1)
    migrated.boards['0'].snapshot.cells[0].title = 'new guest edit'
    saveWorkspace(migrated)
    const reopened = preserveLegacy(guest)
    expect(writes).toBe(2)
    expect(reopened.boards['0'].snapshot.cells[0].title).toBe('new guest edit')
    expect(reopened.legacy).toHaveProperty(STORAGE_KEYS.BINGO_STATE)
    expect(disk.has(STORAGE_KEYS.BINGO_STATE)).toBe(true)
  })

  it('does not import unowned legacy content into an account', () => {
    preserveLegacy(guest)
    const account = openWorkspace('https://service.invalid|test/account/1')
    expect(account.boards).toEqual({})
    expect(account.words.words).toEqual([])
    expect(account.words.initialized).toBe(false)
    expect(account.activeBoardId).toBeNull()
  })

  it('recognizes a previously authored empty word bank when reading envelopes without the new marker', () => {
    const principal = 'https://service.invalid|test/account/1'
    const saved = openWorkspace(principal)
    saved.words.revision = 1; saved.words.acknowledged = 1
    disk.set(workspaceKey(principal), JSON.stringify({ ...saved, words: { words: [], revision: 1, acknowledged: 1 } }))
    const reopened = openWorkspace(principal)
    expect(reopened.words.initialized).toBe(true)
    expect(reopened.words.words).toEqual([])
    saveWorkspace(reopened)
    expect(JSON.parse(disk.get(workspaceKey(principal))!).words.initialized).toBe(true)
  })

  it('does not treat corrupt or unsupported storage as absent', () => {
    const corrupt = { version: 99, precious: 'leave this alone' }
    disk.set(workspaceKey(guest), JSON.stringify(corrupt))
    expect(() => openWorkspace(guest)).toThrow()
    expect(() => preserveLegacy(guest)).toThrow()
    expect(JSON.parse(disk.get(workspaceKey(guest))!)).toEqual(corrupt)
    expect(writes).toBe(0)
  })

  it('does not turn a failed read into a new workspace', () => {
    vi.stubGlobal('uni', { getStorageSync: () => { throw new Error('storage unavailable') } })
    expect(() => openWorkspace(guest)).toThrow('storage unavailable')
  })

  it('returns serialization copies rather than live mutable storage references', () => {
    const original = preserveLegacy(guest)
    original.boards['0'].snapshot.cells[0].title = 'uncommitted'
    expect(openWorkspace(guest).boards['0'].snapshot.cells[0].title).toBe('legacy 0')
  })
})
