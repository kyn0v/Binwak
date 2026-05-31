import { describe, it, expect } from 'vitest'
import { buildShareCode, parseShareCode } from '../src/pages/index/shareCode'

describe('buildShareCode', () => {
  it('生成带前缀的分享码', () => {
    const code = buildShareCode(['瀑布', '搭档', '作画'])
    expect(code.startsWith('CWBG1|')).toBe(true)
  })

  it('空标题也能编码', () => {
    const code = buildShareCode(['', '搭档', ''])
    expect(code).toBe('CWBG1|,%E6%90%AD%E6%A1%A3,')
  })

  it('特殊字符正确编码', () => {
    const code = buildShareCode(['a,b', 'x|y'])
    expect(code).not.toContain('a,b')
    const parsed = parseShareCode(code)
    // 2 items is not a valid grid count → null
    expect(parsed).toBeNull()
  })

  it('特殊字符在有效尺寸下往返一致', () => {
    // 9 items for 3×3
    const titles = ['a,b', 'x|y', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const code = buildShareCode(titles)
    const parsed = parseShareCode(code)
    expect(parsed).not.toBeNull()
    expect(parsed!.titles).toEqual(titles)
    expect(parsed!.gridSize).toBe(3)
  })
})

describe('parseShareCode', () => {
  it('正确解析 3×3 分享码', () => {
    const titles = ['瀑布', '搭档', '作画', 'A', 'B', 'C', 'D', 'E', 'F']
    const code = buildShareCode(titles)
    const result = parseShareCode(code)
    expect(result).not.toBeNull()
    expect(result!.titles).toEqual(titles)
    expect(result!.gridSize).toBe(3)
  })

  it('正确解析 4×4 分享码', () => {
    const titles = Array.from({ length: 16 }, (_, i) => `格子${i}`)
    const code = buildShareCode(titles)
    const result = parseShareCode(code)
    expect(result!.gridSize).toBe(4)
    expect(result!.titles).toHaveLength(16)
  })

  it('正确解析 5×5 分享码', () => {
    const titles = Array.from({ length: 25 }, (_, i) => `格子${i}`)
    const code = buildShareCode(titles)
    const result = parseShareCode(code)
    expect(result!.gridSize).toBe(5)
    expect(result!.titles).toHaveLength(25)
  })

  it('不匹配前缀 → null', () => {
    expect(parseShareCode('WRONG|a,b,c')).toBeNull()
  })

  it('非法数量(非 9/16/25) → null', () => {
    const code = buildShareCode(['A', 'B'])
    expect(parseShareCode(code)).toBeNull()
  })

  it('expectedCount 不匹配 → null', () => {
    const titles = Array.from({ length: 9 }, (_, i) => `格子${i}`)
    const code = buildShareCode(titles)
    expect(parseShareCode(code, 16)).toBeNull()
  })

  it('空字符串 → null', () => {
    expect(parseShareCode('')).toBeNull()
  })

  it('3×3 编码-解码往返一致', () => {
    const titles = ['街头音乐', '霓虹招牌', '雨后水洼', '蓝色雨伞', 'A', 'B', 'C', 'D', 'E']
    const code = buildShareCode(titles)
    const result = parseShareCode(code)
    expect(result!.titles).toEqual(titles)
    expect(result!.gridSize).toBe(3)
  })

  it('跨尺寸分享码不用指定 expectedCount 也能解析', () => {
    const titles = ['瀑布', '搭档', '作画', '跑者', '野猫对视', '街头音乐', '霓虹招牌', '雨后水洼', '蓝色雨伞']
    const code = buildShareCode(titles)
    const result = parseShareCode(code)
    expect(result).not.toBeNull()
    expect(result!.gridSize).toBe(3)
    expect(result!.titles).toEqual(titles)
  })

  it('剪贴板零宽字符不影响解析', () => {
    const titles = Array.from({ length: 9 }, (_, i) => `格子${i}`)
    const code = buildShareCode(titles)
    // Simulate clipboard injecting zero-width space
    const dirty = '\u200b' + code + '\ufeff'
    const result = parseShareCode(dirty)
    expect(result).not.toBeNull()
    expect(result!.titles).toEqual(titles)
  })
})
