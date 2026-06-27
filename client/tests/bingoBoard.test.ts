import { describe, it, expect } from 'vitest'
import { createCells, createDefaultCells, getBingoLines, sanitizeCells, applyTitlesToCells } from '../src/pages/index/useBingoBoard'
import { useBingoBoard } from '../src/pages/index/useBingoBoard'
import { DEFAULT_WORDS } from '../src/pages/index/bingoDefaults'
import type { BingoCell, BingoState } from '../src/pages/index/useBingoBoard'

// ── createCells ──

describe('createCells', () => {
  it('3×3 生成 9 个格子', () => {
    const cells = createCells(3)
    expect(cells).toHaveLength(9)
  })

  it('5×5 生成 25 个格子', () => {
    const cells = createCells(5)
    expect(cells).toHaveLength(25)
  })

  it('每个格子有正确结构', () => {
    const cells = createCells(3)
    cells.forEach((cell, i) => {
      expect(cell.id).toBe(i)
      expect(typeof cell.title).toBe('string')
      expect(cell.completed).toBe(false)
      expect(cell.imagePath).toBeUndefined()
    })
  })

  it('1×1 也能工作', () => {
    const cells = createCells(1)
    expect(cells).toHaveLength(1)
    expect(cells[0].id).toBe(0)
  })

  it('createCells 生成空白 title（用于 reset / 改尺寸）', () => {
    createCells(5).forEach((cell) => expect(cell.title).toBe(''))
  })
})

// ── createDefaultCells ──

describe('createDefaultCells', () => {
  it('用 DEFAULT_WORDS 预填 title，与词库兜底一致', () => {
    const cells = createDefaultCells(5)
    expect(cells).toHaveLength(25)
    // 默认 5×5 = 25 格，DEFAULT_WORDS 恰好 25 个 → 全部填上
    cells.forEach((cell, i) => {
      expect(cell.title).toBe(DEFAULT_WORDS[i] ?? '')
      expect(cell.completed).toBe(false)
    })
    expect(cells.every((c) => c.title)).toBe(true)
  })

  it('格子数多于词数时，多出的格子留空（不越界）', () => {
    const cells = createDefaultCells(6) // 36 格 > 25 词
    expect(cells).toHaveLength(36)
    for (let i = 0; i < DEFAULT_WORDS.length; i++) {
      expect(cells[i].title).toBe(DEFAULT_WORDS[i])
    }
    for (let i = DEFAULT_WORDS.length; i < 36; i++) {
      expect(cells[i].title).toBe('')
    }
  })

  it('格子数少于词数时，只填前 N 个', () => {
    const cells = createDefaultCells(3) // 9 格 < 25 词
    expect(cells).toHaveLength(9)
    cells.forEach((cell, i) => expect(cell.title).toBe(DEFAULT_WORDS[i]))
  })
})

// ── getBingoLines ──

describe('getBingoLines', () => {
  function makeCells(size: number, completedIndices: number[]): BingoCell[] {
    return Array.from({ length: size * size }, (_, i) => ({
      id: i,
      title: `cell-${i}`,
      completed: completedIndices.includes(i),
    }))
  }

  it('没有完成任何格子 → 0 条线', () => {
    const cells = makeCells(3, [])
    expect(getBingoLines(cells, 3)).toHaveLength(0)
  })

  it('第一行完成 → 1 条线', () => {
    const cells = makeCells(3, [0, 1, 2])
    const lines = getBingoLines(cells, 3)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual([0, 1, 2])
  })

  it('第一列完成 → 1 条线', () => {
    const cells = makeCells(3, [0, 3, 6])
    const lines = getBingoLines(cells, 3)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual([0, 3, 6])
  })

  it('主对角线完成 → 1 条线', () => {
    const cells = makeCells(3, [0, 4, 8])
    const lines = getBingoLines(cells, 3)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual([0, 4, 8])
  })

  it('副对角线完成 → 1 条线', () => {
    const cells = makeCells(3, [2, 4, 6])
    const lines = getBingoLines(cells, 3)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual([2, 4, 6])
  })

  it('行 + 列同时完成 → 2 条线', () => {
    // First row [0,1,2] plus first column [0,3,6].
    const cells = makeCells(3, [0, 1, 2, 3, 6])
    const lines = getBingoLines(cells, 3)
    expect(lines).toHaveLength(2)
  })

  it('全部完成 → 3行 + 3列 + 2对角线 = 8 条线', () => {
    const all = Array.from({ length: 9 }, (_, i) => i)
    const cells = makeCells(3, all)
    expect(getBingoLines(cells, 3)).toHaveLength(8)
  })

  it('4×4 Bingo卡第一行完成', () => {
    const cells = makeCells(4, [0, 1, 2, 3])
    const lines = getBingoLines(cells, 4)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual([0, 1, 2, 3])
  })

  it('4×4 对角线', () => {
    const cells = makeCells(4, [0, 5, 10, 15])
    const lines = getBingoLines(cells, 4)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual([0, 5, 10, 15])
  })

  it('差一格不算完成', () => {
    const cells = makeCells(3, [0, 1]) // First row is missing index 2.
    expect(getBingoLines(cells, 3)).toHaveLength(0)
  })
})

// ── sanitizeCells ──

describe('sanitizeCells', () => {
  it('恢复保存的数据', () => {
    const saved: BingoState = {
      cells: [
        { id: 0, title: 'A', completed: true },
        { id: 1, title: 'B', completed: false },
        { id: 2, title: 'C', completed: true },
        { id: 3, title: '', completed: false },
      ],
      hasBingo: false,
      gridSize: 2,
    }
    const result = sanitizeCells(saved, 2)
    expect(result).toHaveLength(4)
    expect(result[0].title).toBe('A')
    expect(result[0].completed).toBe(true)
    expect(result[2].title).toBe('C')
  })

  it('缺失的格子用默认值填充', () => {
    const saved: BingoState = {
      cells: [{ id: 0, title: 'X', completed: false }],
      hasBingo: false,
      gridSize: 2,
    }
    const result = sanitizeCells(saved, 2)
    expect(result).toHaveLength(4)
    expect(result[0].title).toBe('X')
    // Other cells should be filled safely.
    expect(result[1].completed).toBe(false)
  })

  it('completed 被强转为 boolean', () => {
    const saved: BingoState = {
      cells: [{ id: 0, title: 'A', completed: 1 as any }],
      hasBingo: false,
    }
    const result = sanitizeCells(saved, 1)
    expect(result[0].completed).toBe(true)
    expect(typeof result[0].completed).toBe('boolean')
  })
})

// ── applyTitlesToCells ──

describe('applyTitlesToCells', () => {
  it('覆盖标题并重置状态', () => {
    const cells: BingoCell[] = [
      { id: 0, title: '旧A', imagePath: '/img.png', completed: true },
      { id: 1, title: '旧B', completed: false },
    ]
    const result = applyTitlesToCells(cells, ['新A', '新B'])
    expect(result[0].title).toBe('新A')
    expect(result[0].imagePath).toBeUndefined()
    expect(result[0].completed).toBe(false)
    expect(result[1].title).toBe('新B')
  })

  it('标题数组不足时保留原标题', () => {
    const cells: BingoCell[] = [
      { id: 0, title: '原', completed: false },
      { id: 1, title: '原2', completed: false },
    ]
    const result = applyTitlesToCells(cells, ['替换'])
    expect(result[0].title).toBe('替换')
    expect(result[1].title).toBe('原2') // Preserve the original title.
  })

  it('不修改原数组（不可变）', () => {
    const cells: BingoCell[] = [
      { id: 0, title: '原', imagePath: '/a.png', completed: true },
    ]
    applyTitlesToCells(cells, ['新'])
    expect(cells[0].title).toBe('原') // Original array is unchanged.
    expect(cells[0].completed).toBe(true)
  })
})

// ── progress freeze on bingo (useBingoBoard composable) ──

describe('progress freeze on bingo', () => {
  const setEmpty4x4 = (b: ReturnType<typeof useBingoBoard>) => {
    b.gridSize.value = 4
    b.cells.value = Array.from({ length: 16 }, (_, i) => ({ id: i, title: 'x', completed: false }))
    b.syncLineCount() // reset line/freeze trackers to a clean mid-progress state
  }

  it('freezes the target on a fresh bingo, then resumes after the next cell', () => {
    const b = useBingoBoard()
    setEmpty4x4(b)

    // Complete the first row (cells 0..3) → one bingo line.
    for (const i of [0, 1, 2, 3]) b.cells.value[i].completed = true
    b.checkBingo()

    expect(b.bingoLineCount.value).toBe(1)
    expect(b.completedCount.value).toBe(4)
    // Frozen: status shows the achieved bingo, bar reads 4/4 (100%).
    expect(b.bingoJustCompleted.value).toBe(true)
    expect(b.progressTarget.value).toBe(4)

    // Mark the next cell (4) — does not form a new line.
    b.cells.value[4].completed = true
    b.checkBingo()

    // Unfrozen: bar resumes tracking the next-closest line.
    expect(b.bingoJustCompleted.value).toBe(false)
    expect(b.completedCount.value).toBe(5)
    // Closest incomplete line is col0 (0,4,8,12): 2 done, 2 remaining → 5 + 2.
    expect(b.progressTarget.value).toBe(7)
  })

  it('re-freezes when the next cell immediately forms another bingo', () => {
    const b = useBingoBoard()
    setEmpty4x4(b)

    // First bingo: row 0.
    for (const i of [0, 1, 2, 3]) b.cells.value[i].completed = true
    b.checkBingo()
    expect(b.bingoJustCompleted.value).toBe(true)

    // Pre-fill col0 except the last cell, then complete it → second bingo.
    b.cells.value[4].completed = true
    b.cells.value[8].completed = true
    b.checkBingo() // still 1 line, unfrozen mid-progress
    expect(b.bingoJustCompleted.value).toBe(false)

    b.cells.value[12].completed = true // completes col0 (0,4,8,12)
    b.checkBingo()
    expect(b.bingoLineCount.value).toBe(2)
    expect(b.bingoJustCompleted.value).toBe(true)
    expect(b.progressTarget.value).toBe(b.completedCount.value)
  })

  it('re-freezes when a line is broken and later re-formed (sticky-high guard bug)', () => {
    const b = useBingoBoard()
    setEmpty4x4(b)

    // Form row 0 → freeze.
    for (const i of [0, 1, 2, 3]) b.cells.value[i].completed = true
    b.checkBingo()
    expect(b.bingoJustCompleted.value).toBe(true)

    // Break the line by un-completing one cell.
    b.cells.value[3].completed = false
    b.checkBingo()
    expect(b.bingoLineCount.value).toBe(0)
    expect(b.bingoJustCompleted.value).toBe(false)

    // Re-complete it: the line count goes 0 → 1 again. Even though
    // lastSeenLineCount is already 1 (sticky-high), the freeze MUST re-engage.
    b.cells.value[3].completed = true
    b.checkBingo()
    expect(b.bingoLineCount.value).toBe(1)
    expect(b.bingoJustCompleted.value).toBe(true)
    expect(b.progressTarget.value).toBe(b.completedCount.value)
  })
})
