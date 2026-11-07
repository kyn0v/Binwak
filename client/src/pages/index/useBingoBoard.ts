import { computed, ref } from 'vue'
import { DEFAULT_GRID_SIZE, GRID_SIZE_OPTIONS, DEFAULT_WORDS } from './bingoDefaults'

type BingoCell = {
  id: number
  title: string
  imagePath?: string
  illustrationPath?: string
  completed: boolean
  localPath?: string
  imageName?: string
  suppressedImageName?: string
  illustrationKey?: string
  generation?: number
}

// ── Singleton state (shared across all pages) ─────────────
const gridSize = ref(DEFAULT_GRID_SIZE)
const cells = ref<BingoCell[]>(createDefaultCells(DEFAULT_GRID_SIZE))
const boardTitle = ref('')
const showBingo = ref(false)
const bingoLineCount = ref(0)
const lastSeenLineCount = ref(0)
// completedCount captured at the moment a NEW bingo line was last formed.
// While completedCount still equals this, we "freeze" the progress display on
// the just-achieved bingo (已完成 ×N 🏆 / 100%); marking the next cell makes
// completedCount diverge and the bar resumes tracking the next line. -1 = none.
const lastBingoCompletedCount = ref(-1)

let resetAction: () => Promise<boolean> = async () => false
export function installResetAction(action: typeof resetAction) { resetAction = action }
let localEdit: (change: () => void) => boolean = change => { change(); return true }
export function installLocalEdit(handler: typeof localEdit) { localEdit = handler }
export function editBoard(change: () => void): boolean { return localEdit(change) }

function createCells(size: number): BingoCell[] {
  const total = size * size
  return Array.from({ length: total }, (_, i) => ({
    id: i,
    title: '',
    completed: false,
  }))
}

/**
 * Create the cells for a brand-new board (no local cache, no remote data),
 * pre-filling titles from DEFAULT_WORDS so the board is consistent with the
 * word bank's own DEFAULT_WORDS fallback. Used only on first-launch
 * initialization — explicit "reset" / "change grid size" still use the empty
 * createCells(). Fills up to min(cellCount, DEFAULT_WORDS.length); any extra
 * cells stay blank.
 */
function createDefaultCells(size: number): BingoCell[] {
  return createCells(size).map((cell, i) => ({
    ...cell,
    title: DEFAULT_WORDS[i] ?? '',
  }))
}

function getAllLines(gridSize: number): number[][] {
  const lines: number[][] = []

  for (let row = 0; row < gridSize; row += 1) {
    const rowLine = []
    for (let col = 0; col < gridSize; col += 1) {
      rowLine.push(row * gridSize + col)
    }
    lines.push(rowLine)
  }

  for (let col = 0; col < gridSize; col += 1) {
    const colLine = []
    for (let row = 0; row < gridSize; row += 1) {
      colLine.push(row * gridSize + col)
    }
    lines.push(colLine)
  }

  const diag1 = []
  const diag2 = []
  for (let i = 0; i < gridSize; i += 1) {
    diag1.push(i * gridSize + i)
    diag2.push(i * gridSize + (gridSize - 1 - i))
  }
  lines.push(diag1, diag2)

  return lines
}

function getBingoLines(source: BingoCell[], gridSize: number) {
  return getAllLines(gridSize).filter((line) => line.every((idx) => source[idx]?.completed))
}

function applyTitlesToCells(source: BingoCell[], titles: string[]) {
  return source.map((cell, index) => ({
    ...cell,
    title: titles[index] ?? cell.title,
    imagePath: undefined,
    illustrationPath: undefined,
    completed: false,
  }))
}

export function useBingoBoard() {
  // ── Progress tracking ──
  const completedCount = computed(() => cells.value.filter((c) => c.completed).length)
  const totalCount = computed(() => cells.value.length)
  const isAllDone = computed(() => completedCount.value === totalCount.value && totalCount.value > 0)

  /**
   * True right after a new Bingo line forms, until the user marks another cell.
   * Used to freeze the progress bar on the just-achieved bingo (已完成 ×N 🏆)
   * instead of immediately jumping the denominator to the next line's target.
   */
  const bingoJustCompleted = computed(() =>
    bingoLineCount.value > 0 && completedCount.value === lastBingoCompletedCount.value
  )

  /**
   * Progress denominator shown in the bar = completedCount + the minimum number
   * of cells still needed to finish the *closest* incomplete Bingo line (its
   * geometric minimum remaining). This shrinks as the user nears any line, e.g.
   * on a 4×4 after the first row, the closest column still needs 3 → 5/7 once
   * one more cell of that column is marked.
   *
   * While a bingo is "frozen" (a line just formed, before the next cell is
   * marked) the denominator collapses to completedCount so the bar reads as
   * fully complete for the achieved line (e.g. 4/4 at 100%, 已完成 ×N).
   */
  const progressTarget = computed(() => {
    if (bingoJustCompleted.value) return completedCount.value
    const lines = getAllLines(gridSize.value)
    const incomplete = lines.filter(
      (line) => !line.every((idx) => cells.value[idx]?.completed)
    )
    if (incomplete.length === 0) return completedCount.value // all lines done (isAllDone)
    const minRemaining = Math.min(
      ...incomplete.map((line) => line.filter((idx) => !cells.value[idx]?.completed).length)
    )
    return completedCount.value + minRemaining
  })

  /** Set of cell indices that belong to a completed bingo line */
  const bingoLineIndices = computed(() => {
    const lines = getBingoLines(cells.value, gridSize.value)
    const indices = new Set<number>()
    for (const line of lines) {
      for (const idx of line) indices.add(idx)
    }
    return indices
  })
  const centerIndex = computed(() => {
    const s = gridSize.value
    return s % 2 === 1 ? Math.floor((s * s) / 2) : -1
  })

  function currentLineCount() {
    return getBingoLines(cells.value, gridSize.value).length
  }

  function changeGridSize(newSize: number): boolean {
    if (!GRID_SIZE_OPTIONS.includes(newSize)) return false
    if (newSize === gridSize.value) return true
    return editBoard(() => {
      gridSize.value = newSize
      cells.value = createCells(newSize)
      showBingo.value = false
      bingoLineCount.value = 0
      lastSeenLineCount.value = 0
      lastBingoCompletedCount.value = -1
    })
  }

  function resetBoard(onConfirmed?: () => void) {
    const originalCells = cells.value
    const snapshot = JSON.stringify(originalCells)
    uni.showModal({
      title: '重置卡片',
      content: '确定要清空所有进度和照片吗？',
      success: async (res) => {
        if (!res.confirm || cells.value !== originalCells || JSON.stringify(cells.value) !== snapshot) return
        if (await resetAction()) onConfirmed?.()
      },
    })
  }

  function toggleComplete(index: number) {
    const cell = cells.value[index]
    if (!cell) return
    return editBoard(() => { cell.completed = !cell.completed })
  }

  function checkBingo() {
    const count = currentLineCount()
    const prevCount = bingoLineCount.value
    bingoLineCount.value = count

    // Freeze trigger: decoupled from the celebration's all-time-max guard. The
    // freeze must engage whenever THIS cell-mark increases the line count, even
    // if the same line existed earlier in the session (lastSeenLineCount is
    // sticky-high and would otherwise suppress it → bug: 3/4 →(bingo)→ 4/7
    // instead of 4/4). Capturing completedCount here makes the progress bar
    // read N/N (已完成 ×k) until the next cell is marked.
    if (count > prevCount) {
      lastBingoCompletedCount.value = completedCount.value
    }

    // Celebration: only for a NEW all-time-max line count, so we don't
    // re-celebrate a milestone the user has already seen.
    if (count > 0 && count > lastSeenLineCount.value) {
      lastSeenLineCount.value = count
      showBingo.value = true
      // No auto-dismiss; user must tap to close
    }
  }

  function dismissBingo() {
    showBingo.value = false
  }

  function applyTitles(titles: string[]) {
    return editBoard(() => { cells.value = applyTitlesToCells(cells.value, titles) })
  }

  function clearTitles(titles: string[]) {
    if (titles.length === 0) return
    const titleSet = new Set(titles)
    return editBoard(() => {
      cells.value = cells.value.map((cell) => titleSet.has(cell.title)
        ? { id: cell.id, title: '', completed: false }
        : cell)
    })
  }

  return {
    gridSize,
    cells,
    boardTitle,
    showBingo,
    bingoLineCount,
    bingoLineIndices,
    centerIndex,
    completedCount,
    totalCount,
    progressTarget,
    bingoJustCompleted,
    isAllDone,
    resetBoard,
    toggleComplete,
    editBoard,
    checkBingo,
    dismissBingo,
    applyTitles,
    clearTitles,
    changeGridSize,
    /** Sync lastSeenLineCount to current state (prevents re-triggering celebration) */
    syncLineCount: () => {
      const count = currentLineCount()
      bingoLineCount.value = count
      lastSeenLineCount.value = count
      // NOTE: deliberately do NOT touch lastBingoCompletedCount here. syncLineCount
      // runs on every sync roundtrip (applyRemoteBoard writes the cells back after
      // a push), so resetting it would clear the just-achieved-bingo freeze the
      // instant the user completes a line. The freeze clears naturally when the
      // user marks another cell (completedCount diverges from the captured value).
    },
    saveBoardTitle: (title: string) => editBoard(() => { boardTitle.value = title }),
  }
}

export type { BingoCell }
export { createCells, createDefaultCells, getBingoLines, applyTitlesToCells, GRID_SIZE_OPTIONS }
