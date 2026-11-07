import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/pages/index/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/pages/index/api')>(),
  checkContent: vi.fn().mockResolvedValue({ pass: true }),
}))
let words: ReturnType<typeof import('../src/pages/index/useWordBank')['useWordBank']>
let api: typeof import('../src/pages/index/api')
const disk = new Map<string, string>()
let failSave = false
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); disk.clear(); failSave = false
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => disk.has(key) ? JSON.parse(disk.get(key)!) : '',
    setStorageSync: (key: string, value: unknown) => { if (failSave) throw new Error('quota'); disk.set(key, JSON.stringify(value)) },
    removeStorageSync: (key: string) => disk.delete(key), showToast: vi.fn(), onNetworkStatusChange: vi.fn(),
  })
  const { useSync } = await import('../src/pages/index/useSync')
  useSync()
  words = (await import('../src/pages/index/useWordBank')).useWordBank()
  api = await import('../src/pages/index/api')
  vi.mocked(api.checkContent).mockResolvedValue({ pass: true })
  words.wordBank.value = []
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('word bank edits', () => {
  it('adds trimmed words at the front', async () => {
    words.wordBank.value = ['old']
    expect(await words.addWord('  new  ')).toBe('ok')
    expect(words.wordBank.value).toEqual(['new', 'old'])
  })
  it('rejects empty words', async () => { expect(await words.addWord('  ')).toBe('empty') })
  it('rejects duplicate words', async () => {
    words.wordBank.value = ['old']
    expect(await words.addWord('old')).toBe('duplicate')
  })
  it('honors the word limit', async () => {
    words.wordBank.value = Array.from({ length: 500 }, (_, i) => `word ${i}`)
    expect(await words.addWord('extra')).toBe('full')
  })
  it('does not add moderated words', async () => {
    vi.mocked(api.checkContent).mockResolvedValue({ pass: false })
    expect(await words.addWord('blocked')).toBe('moderation_fail')
    expect(words.wordBank.value).toEqual([])
  })
  it('updates one word', async () => {
    words.wordBank.value = ['A', 'B']
    expect(await words.updateWord(1, 'C')).toBe('ok')
    expect(words.wordBank.value).toEqual(['A', 'C'])
  })
  it('does not create duplicates when editing', async () => {
    words.wordBank.value = ['A', 'B']
    expect(await words.updateWord(1, 'A')).toBe('duplicate')
    expect(words.wordBank.value).toEqual(['A', 'B'])
  })
  it('does not update moderated words', async () => {
    words.wordBank.value = ['A']
    vi.mocked(api.checkContent).mockResolvedValue({ pass: false })
    expect(await words.updateWord(0, 'blocked')).toBe('moderation_fail')
    expect(words.wordBank.value).toEqual(['A'])
  })
  it('removes one word and rejects an absent position', () => {
    words.wordBank.value = ['A', 'B']
    expect(words.removeWord(0)).toBe('A')
    expect(words.wordBank.value).toEqual(['B'])
    expect(words.removeWord(5)).toBeNull()
  })
  it('deduplicates within a batch and against current words', async () => {
    words.wordBank.value = ['A']
    expect(await words.mergeWords(['A', 'B', ' B ', 'C', 'C'])).toEqual({ added: 2, blocked: false })
    expect(words.wordBank.value).toEqual(['A', 'B', 'C'])
  })
  it('rejects a moderated batch', async () => {
    vi.mocked(api.checkContent).mockResolvedValue({ pass: false })
    expect(await words.mergeWords(['blocked'])).toEqual({ added: 0, blocked: true })
    expect(words.wordBank.value).toEqual([])
  })
  it('restores all edit kinds after restart', async () => {
    await words.addWord('A'); await words.addWord('B'); await words.updateWord(0, 'C')
    await words.mergeWords(['D', 'D']); words.removeWord(1)
    vi.resetModules()
    ;(await import('../src/pages/index/useSync')).useSync()
    expect((await import('../src/pages/index/useWordBank')).useWordBank().wordBank.value).toEqual(['C', 'D'])
  })
  it('returns failure and restores words when storage is full', async () => {
    words.wordBank.value = ['A']; failSave = true
    expect(await words.addWord('B')).toBe('save_failed')
    expect(words.wordBank.value).toEqual(['A'])
    expect(words.removeWord(0)).toBeNull()
    expect(words.wordBank.value).toEqual(['A'])
  })
  it('rejects moderation completed under another login', async () => {
    let finish!: (value: { pass: boolean }) => void
    vi.mocked(api.checkContent).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const adding = words.addWord('old account')
    api.setToken('another-account-token')
    finish({ pass: true })
    expect(await adding).toBe('stale')
    expect(words.wordBank.value).not.toContain('old account')
  })
})
