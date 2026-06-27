import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import type { BingoCell } from '../src/pages/index/useBingoBoard'

const matchMock = vi.fn()
vi.mock('../src/pages/index/api', () => ({
  matchIllustrations: (...args: any[]) => matchMock(...args),
}))
vi.mock('../src/pages/index/useCanvasExport', () => ({
  preWarmLocalPaths: vi.fn(),
}))

const toasts: string[] = []
;(globalThis as any).uni = {
  showToast: (o: { title: string }) => { toasts.push(o.title) },
}

import { useWordPicker } from '../src/pages/index/useWordPicker'

function cell(id: number, title = '', extra: Partial<BingoCell> = {}): BingoCell {
  return { id, title, completed: false, ...extra }
}

function setup(opts: {
  cells?: BingoCell[]
  bank?: string[]
  addWord?: any
  cache?: Map<string, string>
} = {}) {
  const cells = ref<BingoCell[]>(opts.cells ?? [cell(0), cell(1)])
  const wordBank = ref<string[]>(opts.bank ?? ['瀑布', '搭档', '作画'])
  const addWord = opts.addWord ?? vi.fn().mockResolvedValue('ok')
  const illustCache = opts.cache ?? new Map<string, string>()
  const wp = useWordPicker({ cells, wordBank, addWord, illustCache })
  return { cells, wordBank, addWord, illustCache, wp }
}

describe('useWordPicker', () => {
  beforeEach(() => {
    toasts.length = 0
    matchMock.mockReset()
    matchMock.mockResolvedValue({})
  })

  it('openWordPicker sets the target and resets inputs', () => {
    const { wp } = setup()
    wp.wordSearch.value = 'stale'
    wp.pickerNewWord.value = 'stale'
    wp.openWordPicker(1)
    expect(wp.showWordPicker.value).toBe(true)
    expect(wp.wordSearch.value).toBe('')
    expect(wp.pickerNewWord.value).toBe('')
  })

  it('openWordPicker pre-fetches illustrations only for uncached bank words', async () => {
    const cache = new Map<string, string>([['瀑布', 'u-pubu']])
    matchMock.mockResolvedValue({ 搭档: { illustrationUrl: 'u-dadang', illustrationPath: 'p' } })
    const { wp } = setup({ cache })
    wp.openWordPicker(0)
    // Awaits the microtask queue for the .then to run.
    await Promise.resolve(); await Promise.resolve()
    expect(matchMock).toHaveBeenCalledWith(['搭档', '作画'])
    expect(cache.get('搭档')).toBe('u-dadang')
    expect(cache.get('作画')).toBe('none')
  })

  it('filteredWordBank filters case-insensitively by search', () => {
    const { wp } = setup({ bank: ['Apple', 'banana', 'Avocado'] })
    expect(wp.filteredWordBank.value).toEqual(['Apple', 'banana', 'Avocado'])
    wp.wordSearch.value = 'a'
    expect(wp.filteredWordBank.value).toEqual(['Apple', 'banana', 'Avocado'])
    wp.wordSearch.value = 'av'
    expect(wp.filteredWordBank.value).toEqual(['Avocado'])
  })

  it('assignWordToTarget writes the word and resets cell state', () => {
    const cells = [cell(0, 'old', { imagePath: '/p.png', illustrationPath: '/i.png', completed: true })]
    const cache = new Map<string, string>([['瀑布', 'u-pubu']])
    const { wp } = setup({ cells, cache })
    wp.openWordPicker(0)
    wp.assignWordToTarget('瀑布')
    expect(cells[0].title).toBe('瀑布')
    expect(cells[0].imagePath).toBeUndefined()
    expect(cells[0].completed).toBe(false)
    // Cached illustration auto-applied.
    expect(cells[0].illustrationPath).toBe('u-pubu')
    expect(wp.showWordPicker.value).toBe(false)
  })

  it('assignWordToTarget does nothing without a target', () => {
    const cells = [cell(0, 'keep')]
    const { wp } = setup({ cells })
    // No openWordPicker → manualAssignTarget is null.
    wp.assignWordToTarget('瀑布')
    expect(cells[0].title).toBe('keep')
  })

  it('assignWordToTarget fetches illustration on cache miss', async () => {
    const cells = [cell(0)]
    const cache = new Map<string, string>()
    matchMock.mockResolvedValue({ 新词: { illustrationUrl: 'u-new', illustrationPath: 'p' } })
    const { wp } = setup({ cells, cache })
    wp.openWordPicker(0)
    await Promise.resolve(); await Promise.resolve() // settle openWordPicker prefetch
    matchMock.mockResolvedValue({ 新词: { illustrationUrl: 'u-new', illustrationPath: 'p' } })
    wp.openWordPicker(0)
    wp.assignWordToTarget('新词')
    await Promise.resolve(); await Promise.resolve()
    expect(cache.get('新词')).toBe('u-new')
    expect(cells[0].illustrationPath).toBe('u-new')
  })

  it('addAndAssignWord rejects empty input', async () => {
    const { wp } = setup()
    wp.openWordPicker(0)
    wp.pickerNewWord.value = '   '
    await wp.addAndAssignWord()
    expect(toasts).toContain('请输入词语')
  })

  it('addAndAssignWord adds then assigns on success', async () => {
    const cells = [cell(0)]
    const addWord = vi.fn().mockResolvedValue('ok')
    const { wp } = setup({ cells, addWord })
    wp.openWordPicker(0)
    wp.pickerNewWord.value = '新词'
    await wp.addAndAssignWord()
    expect(addWord).toHaveBeenCalledWith('新词')
    expect(cells[0].title).toBe('新词')
    expect(wp.pickerNewWord.value).toBe('')
  })

  it('addAndAssignWord surfaces moderation + duplicate errors without assigning', async () => {
    const cells = [cell(0)]
    const addWord = vi.fn().mockResolvedValue('moderation_fail')
    const { wp } = setup({ cells, addWord })
    wp.openWordPicker(0)
    wp.pickerNewWord.value = '脏词'
    await wp.addAndAssignWord()
    expect(toasts).toContain('内容含违规信息，请修改')
    expect(cells[0].title).toBe('')

    const addWord2 = vi.fn().mockResolvedValue('duplicate')
    const s2 = setup({ cells: [cell(0)], addWord: addWord2 })
    s2.wp.openWordPicker(0)
    s2.wp.pickerNewWord.value = '重复'
    await s2.wp.addAndAssignWord()
    expect(toasts).toContain('该词已存在')
  })

  it('closeWordPicker clears all state', () => {
    const { wp } = setup()
    wp.openWordPicker(1)
    wp.wordSearch.value = 'x'
    wp.pickerNewWord.value = 'y'
    wp.closeWordPicker()
    expect(wp.showWordPicker.value).toBe(false)
    expect(wp.wordSearch.value).toBe('')
    expect(wp.pickerNewWord.value).toBe('')
  })
})
