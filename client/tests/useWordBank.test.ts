import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the uni platform API before importing useWordBank.
vi.stubGlobal('uni', {
  getStorageSync: vi.fn(() => undefined),
  setStorageSync: vi.fn(),
})

// mock checkContent API — default: pass
vi.mock('../src/pages/index/api', () => ({
  checkContent: vi.fn().mockResolvedValue({ pass: true }),
}))

import { useWordBank } from '../src/pages/index/useWordBank'
import { checkContent } from '../src/pages/index/api'

describe('useWordBank', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkContent).mockResolvedValue({ pass: true })
  })

  // ── addWord ──

  describe('addWord', () => {
    it('添加词语到开头', async () => {
      const { wordBank, addWord } = useWordBank()
      wordBank.value = ['已有词']
      const ok = await addWord('新词')
      expect(ok).toBe('ok')
      expect(wordBank.value[0]).toBe('新词')
      expect(wordBank.value).toHaveLength(2)
    })

    it('空字符串返回 empty', async () => {
      const { addWord } = useWordBank()
      expect(await addWord('')).toBe('empty')
      expect(await addWord('   ')).toBe('empty')
    })

    it('自动 trim 空格', async () => {
      const { wordBank, addWord } = useWordBank()
      wordBank.value = []
      await addWord('  前后空格  ')
      expect(wordBank.value[0]).toBe('前后空格')
    })

    it('词库满时返回 full', async () => {
      const { wordBank, addWord } = useWordBank()
      wordBank.value = Array.from({ length: 500 }, (_, i) => `词${i}`)
      expect(await addWord('超出')).toBe('full')
    })

    it('添加后自动持久化', async () => {
      const { wordBank, addWord } = useWordBank()
      wordBank.value = []
      await addWord('测试')
      expect(uni.setStorageSync).toHaveBeenCalled()
    })

    it('审核不通过返回 moderation_fail', async () => {
      vi.mocked(checkContent).mockResolvedValue({ pass: false, message: '违规' })
      const { wordBank, addWord } = useWordBank()
      wordBank.value = []
      const result = await addWord('违禁词')
      expect(result).toBe('moderation_fail')
      expect(wordBank.value).toHaveLength(0)
    })

    it('重复词返回 duplicate', async () => {
      const { wordBank, addWord } = useWordBank()
      wordBank.value = ['已有词']
      const result = await addWord('已有词')
      expect(result).toBe('duplicate')
      expect(checkContent).not.toHaveBeenCalled()
    })
  })

  // ── updateWord ──

  describe('updateWord', () => {
    it('更新指定位置的词', async () => {
      const { wordBank, updateWord } = useWordBank()
      wordBank.value = ['A', 'B', 'C']
      const ok = await updateWord(1, '新B')
      expect(ok).toBe('ok')
      expect(wordBank.value).toEqual(['A', '新B', 'C'])
    })

    it('空字符串返回 empty', async () => {
      const { wordBank, updateWord } = useWordBank()
      wordBank.value = ['A']
      expect(await updateWord(0, '')).toBe('empty')
    })

    it('审核不通过返回 moderation_fail', async () => {
      vi.mocked(checkContent).mockResolvedValue({ pass: false })
      const { wordBank, updateWord } = useWordBank()
      wordBank.value = ['A']
      const result = await updateWord(0, '违禁')
      expect(result).toBe('moderation_fail')
      expect(wordBank.value).toEqual(['A'])
    })
  })

  // ── removeWord ──

  describe('removeWord', () => {
    it('删除并返回被删的词', () => {
      const { wordBank, removeWord } = useWordBank()
      wordBank.value = ['A', 'B', 'C']
      const removed = removeWord(1)
      expect(removed).toBe('B')
      expect(wordBank.value).toEqual(['A', 'C'])
    })

    it('越界返回 null', () => {
      const { wordBank, removeWord } = useWordBank()
      wordBank.value = ['A']
      expect(removeWord(5)).toBeNull()
    })

    it('删除后自动持久化', () => {
      const { wordBank, removeWord } = useWordBank()
      wordBank.value = ['A', 'B']
      removeWord(0)
      expect(uni.setStorageSync).toHaveBeenCalled()
    })
  })

  // ── mergeWords ──

  describe('mergeWords', () => {
    it('批量合并新词', async () => {
      const { wordBank, mergeWords } = useWordBank()
      wordBank.value = ['A']
      const result = await mergeWords(['B', 'C'])
      expect(result).toEqual({ added: 2, blocked: false })
      expect(wordBank.value).toEqual(['A', 'B', 'C'])
    })

    it('跳过已有的词', async () => {
      const { wordBank, mergeWords } = useWordBank()
      wordBank.value = ['A', 'B']
      const result = await mergeWords(['B', 'C'])
      expect(result).toEqual({ added: 1, blocked: false })
    })

    it('审核不通过返回 blocked', async () => {
      vi.mocked(checkContent).mockResolvedValue({ pass: false })
      const { wordBank, mergeWords } = useWordBank()
      wordBank.value = []
      const result = await mergeWords(['违禁1', '违禁2'])
      expect(result).toEqual({ added: 0, blocked: true })
      expect(wordBank.value).toHaveLength(0)
    })
  })

  // ── loadWordBank ──

  describe('loadWordBank', () => {
    it('本地有数据时加载', () => {
      vi.mocked(uni.getStorageSync).mockReturnValue(['已存', '词库'])
      const { wordBank, loadWordBank } = useWordBank()
      loadWordBank()
      expect(wordBank.value).toEqual(['已存', '词库'])
    })

    it('本地无数据时用默认词库', () => {
      vi.mocked(uni.getStorageSync).mockReturnValue(undefined)
      const { wordBank, loadWordBank } = useWordBank()
      loadWordBank()
      expect(wordBank.value.length).toBeGreaterThan(0)
    })

    it('已加载后不会用旧缓存覆盖当前词库', () => {
      vi.mocked(uni.getStorageSync).mockReturnValue(['旧词'])
      const { wordBank, loadWordBank } = useWordBank()
      wordBank.value = ['当前词', '模板词']
      loadWordBank()
      expect(wordBank.value).toEqual(['当前词', '模板词'])
    })
  })
})
