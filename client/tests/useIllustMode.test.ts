import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import type { BingoCell } from '../src/pages/index/useBingoBoard'

// Mock the API + canvas pre-warm so the composable is testable in isolation.
const matchMock = vi.fn()
vi.mock('../src/pages/index/api', () => ({
  matchIllustrations: (...args: any[]) => matchMock(...args),
}))
vi.mock('../src/pages/index/useCanvasExport', () => ({
  preWarmLocalPaths: vi.fn(),
}))

// In-memory uni storage stub + toast capture.
const store = new Map<string, unknown>()
const toasts: string[] = []
;(globalThis as any).uni = {
  getStorageSync: (k: string) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k: string, v: unknown) => { store.set(k, v) },
  removeStorageSync: (k: string) => { store.delete(k) },
  showToast: (o: { title: string }) => { toasts.push(o.title) },
}

import { useIllustMode } from '../src/pages/index/useIllustMode'

function cell(id: number, title: string, extra: Partial<BingoCell> = {}): BingoCell {
  return { id, title, completed: false, ...extra }
}

const PREFIX = 'binwak-illust-mode-'

describe('useIllustMode', () => {
  beforeEach(() => {
    store.clear()
    toasts.length = 0
    matchMock.mockReset()
  })

  it('loadIllustMode: defaults OFF with no board id', () => {
    const cells = ref<BingoCell[]>([cell(0, 'a', { illustrationPath: '/x.png' })])
    const m = useIllustMode({ cells, remoteBoardId: ref(null), persistState: () => {} })
    m.loadIllustMode()
    expect(m.isIllustMode.value).toBe(false)
  })

  it('loadIllustMode: defaults ON when board has illustration cells and no stored pref', () => {
    const cells = ref<BingoCell[]>([cell(0, 'a', { illustrationPath: '/x.png' })])
    const m = useIllustMode({ cells, remoteBoardId: ref(7), persistState: () => {} })
    m.loadIllustMode()
    expect(m.isIllustMode.value).toBe(true)
  })

  it('loadIllustMode: honors a stored preference', () => {
    store.set(`${PREFIX}7`, false)
    const cells = ref<BingoCell[]>([cell(0, 'a', { illustrationPath: '/x.png' })])
    const m = useIllustMode({ cells, remoteBoardId: ref(7), persistState: () => {} })
    m.loadIllustMode()
    expect(m.isIllustMode.value).toBe(false)
  })

  it('autoPopulateIllustrations: fetches, caches, assigns illustrationPath, persists', async () => {
    matchMock.mockResolvedValue({ 瀑布: { illustrationUrl: 'u-pubu', illustrationPath: 'p' } })
    const cells = ref<BingoCell[]>([cell(0, '瀑布')])
    const persist = vi.fn()
    const m = useIllustMode({ cells, remoteBoardId: ref(7), persistState: persist })

    const ok = await m.autoPopulateIllustrations()
    expect(ok).toBe(true)
    expect(cells.value[0].illustrationPath).toBe('u-pubu')
    expect(m.illustCache.get('瀑布')).toBe('u-pubu')
    expect(persist).toHaveBeenCalled()
  })

  it('autoPopulateIllustrations: caches "none" for unmatched words and does not assign', async () => {
    matchMock.mockResolvedValue({})
    const cells = ref<BingoCell[]>([cell(0, '无图词')])
    const persist = vi.fn()
    const m = useIllustMode({ cells, remoteBoardId: ref(7), persistState: persist })

    const ok = await m.autoPopulateIllustrations()
    expect(ok).toBe(true)
    expect(m.illustCache.get('无图词')).toBe('none')
    expect(cells.value[0].illustrationPath).toBeUndefined()
    expect(persist).not.toHaveBeenCalled()
  })

  it('autoPopulateIllustrations: returns false + toasts on API failure', async () => {
    matchMock.mockRejectedValue(new Error('boom'))
    const cells = ref<BingoCell[]>([cell(0, '瀑布')])
    const m = useIllustMode({ cells, remoteBoardId: ref(7), persistState: () => {} })

    const ok = await m.autoPopulateIllustrations()
    expect(ok).toBe(false)
    expect(toasts).toContain('插画加载失败，请重试')
  })

  it('toggleIllustMode: turns on, persists, populates from cache', async () => {
    matchMock.mockResolvedValue({ 瀑布: { illustrationUrl: 'u', illustrationPath: 'p' } })
    const cells = ref<BingoCell[]>([cell(0, '瀑布')])
    const m = useIllustMode({ cells, remoteBoardId: ref(7), persistState: () => {} })

    await m.toggleIllustMode()
    expect(m.isIllustMode.value).toBe(true)
    expect(store.get(`${PREFIX}7`)).toBe(true)
    expect(cells.value[0].illustrationPath).toBe('u')
  })

  it('toggleIllustMode: falls back to text mode + toasts when no matches', async () => {
    matchMock.mockResolvedValue({})
    const cells = ref<BingoCell[]>([cell(0, '无图词')])
    const m = useIllustMode({ cells, remoteBoardId: ref(7), persistState: () => {} })

    await m.toggleIllustMode()
    expect(m.isIllustMode.value).toBe(false)
    expect(store.get(`${PREFIX}7`)).toBe(false)
    expect(toasts).toContain('当前词语暂无匹配插画')
  })

  it('toggleIllustMode: falls back to text mode on fetch failure', async () => {
    matchMock.mockRejectedValue(new Error('net'))
    const cells = ref<BingoCell[]>([cell(0, '瀑布')])
    const m = useIllustMode({ cells, remoteBoardId: ref(7), persistState: () => {} })

    await m.toggleIllustMode()
    expect(m.isIllustMode.value).toBe(false)
    expect(store.get(`${PREFIX}7`)).toBe(false)
  })
})
