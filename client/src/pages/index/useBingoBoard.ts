import { computed, ref } from 'vue'
import { DEFAULT_GRID_SIZE, GRID_SIZE_OPTIONS, GRID_SIZE_KEY } from './bingoDefaults'

type BingoCell = {
  id: number
  title: string
  imagePath?: string
  illustrationPath?: string
  completed: boolean
}

type BingoState = {
  cells: BingoCell[]
  hasBingo: boolean
  gridSize?: number
}

import { STORAGE_KEYS } from '@/config/storageKeys'
import { safeGet, safeSet, safeRemove } from '@/utils/safeStorage'

const STORAGE_KEY = STORAGE_KEYS.BINGO_STATE
const BOARD_TITLE_KEY = STORAGE_KEYS.BOARD_TITLE

// ── Singleton state (shared across all pages) ─────────────
const gridSize = ref(DEFAULT_GRID_SIZE)
const cells = ref<BingoCell[]>(createCells(DEFAULT_GRID_SIZE))
const boardTitle = ref('')
const showBingo = ref(false)
const bingoLineCount = ref(0)
const lastSeenLineCount = ref(0)

/**
 * Guard flag – while true the cells watcher should NOT push to server.
 * Used by useSync when loading remote data into the shared state.
 */
let _loadingFromRemote = false

function createCells(size: number): BingoCell[] {
  const total = size * size
  return Array.from({ length: total }, (_, i) => ({
    id: i,
    title: '',
    completed: false,
  }))
}

function getBingoLines(source: BingoCell[], gridSize: number) {
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

  return lines.filter((line) => line.every((idx) => source[idx]?.completed))
}

function sanitizeCells(saved: BingoState, gridSize: number) {
  const total = gridSize * gridSize
  return Array.from({ length: total }, (_, index) => {
    const cell = saved.cells[index]
    return {
      id: index,
      title: cell?.title || '',
      imagePath: cell?.imagePath,
      illustrationPath: cell?.illustrationPath?.startsWith('/static/') ? undefined : cell?.illustrationPath,
      completed: Boolean(cell?.completed),
    }
  })
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

  function loadState() {
    // Load grid size
    const savedSize = safeGet<number>(GRID_SIZE_KEY)
    if (savedSize && GRID_SIZE_OPTIONS.includes(savedSize)) {
      gridSize.value = savedSize
    }

    const saved = safeGet<BingoState>(STORAGE_KEY)
    const total = gridSize.value * gridSize.value
    if (saved?.cells?.length === total) {
      cells.value = sanitizeCells(saved, gridSize.value)
      const count = currentLineCount()
      bingoLineCount.value = count
      lastSeenLineCount.value = count // don't re-trigger on load
      showBingo.value = false
    } else {
      cells.value = createCells(gridSize.value)
    }
  }

  function persistState() {
    const state: BingoState = {
      cells: cells.value,
      hasBingo: bingoLineCount.value > 0,
      gridSize: gridSize.value,
    }
    safeSet(STORAGE_KEY, state)
  }

  function changeGridSize(newSize: number) {
    if (!GRID_SIZE_OPTIONS.includes(newSize)) return
    if (newSize === gridSize.value) return
    gridSize.value = newSize
    safeSet(GRID_SIZE_KEY, newSize)
    cells.value = createCells(newSize)
    showBingo.value = false
    bingoLineCount.value = 0
    lastSeenLineCount.value = 0
    persistState()
  }

  function resetBoard(onConfirmed?: () => void) {
    uni.showModal({
      title: '重置卡片',
      content: '确定要清空所有进度和照片吗？',
      success: (res) => {
        if (!res.confirm) return
        cells.value = createCells(gridSize.value)
        showBingo.value = false
        bingoLineCount.value = 0
        lastSeenLineCount.value = 0
        safeRemove(STORAGE_KEY)
        onConfirmed?.()
      },
    })
  }

  function toggleComplete(index: number) {
    const cell = cells.value[index]
    if (!cell) return
    cell.completed = !cell.completed
  }

  function checkBingo() {
    const count = currentLineCount()
    bingoLineCount.value = count
    if (count <= 0) return
    if (count <= lastSeenLineCount.value) return

    // New line(s) completed — show celebration
    lastSeenLineCount.value = count
    showBingo.value = true
    // No auto-dismiss; user must tap to close
  }

  function dismissBingo() {
    showBingo.value = false
  }

  function applyTitles(titles: string[]) {
    cells.value = applyTitlesToCells(cells.value, titles)
  }

  function clearTitles(titles: string[]) {
    if (titles.length === 0) return
    const titleSet = new Set(titles)
    cells.value = cells.value.map((cell) => {
      if (!titleSet.has(cell.title)) return cell
      return {
        ...cell,
        title: '',
        imagePath: undefined,
        completed: false,
      }
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
    isAllDone,
    resetBoard,
    toggleComplete,
    loadState,
    persistState,
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
    },
    /** True while useSync is writing remote data into cells/boardTitle */
    isLoadingFromRemote: () => _loadingFromRemote,
    setLoadingFromRemote: (v: boolean) => { _loadingFromRemote = v },
    /** Save boardTitle to local storage */
    saveBoardTitle: (title: string) => {
      boardTitle.value = title
      safeSet(BOARD_TITLE_KEY, title)
    },
    /** Load boardTitle from local storage */
    loadBoardTitle: () => {
      const saved = safeGet<string>(BOARD_TITLE_KEY)
      if (saved) boardTitle.value = saved
    },
  }
}

export type { BingoCell, BingoState }
export { createCells, getBingoLines, sanitizeCells, applyTitlesToCells, GRID_SIZE_OPTIONS, BOARD_TITLE_KEY }
