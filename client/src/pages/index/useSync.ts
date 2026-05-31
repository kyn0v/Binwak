// ============================================
// Binwak — data sync composable
// Local-first; auto-sync to the server when online
// ============================================
import { ref } from 'vue'
import {
  isLoggedIn,
  getBoards,
  createBoard,
  getBoard,
  updateBoard,
  updateCells,
  replaceWordBank,
  uploadImage,
  activateBoard,
  deleteBoard,
  resetBoard as apiResetBoard,
  cloneBoard as apiCloneBoard,
  resolveApiUrl,
} from './api'
import type { BingoCell } from './useBingoBoard'
import { useBingoBoard } from './useBingoBoard'
import { DEFAULT_WORDS } from './bingoDefaults'

/**
 * Generate a default Bingo board title, e.g. "2/18 Challenge".
 */
export function defaultBoardTitle(existingTitles: string[] = []): string {
  const d = new Date()
  const base = `${d.getMonth() + 1}月${d.getDate()}日挑战`
  if (!existingTitles.includes(base)) return base
  let i = 2
  while (existingTitles.includes(`${base} #${i}`)) i++
  return `${base} #${i}`
}

interface RemoteBoard {
  id: number
  title: string
  gridSize: number
  theme: string
  isActive: boolean
  completedCount?: number
  totalCount?: number
  createdAt: string
  updatedAt: string
  cells: Array<{ position: number; title: string; imageName: string; imageUrl?: string; completed: boolean }>
}

import { STORAGE_KEYS } from '@/config/storageKeys'
import { safeGet, safeSet, safeRemove } from '@/utils/safeStorage'

const BOARD_ID_KEY = STORAGE_KEYS.REMOTE_BOARD_ID

const remoteBoardId = ref<number | null>(null)
const syncing = ref(false)
const lastSyncError = ref('')

// Per-board data cache: boardId → { cells, title, gridSize, theme }
// Render from cache first when switching, then call activate in the background to sync server state
interface CachedBoard {
  title: string
  cells: BingoCell[]
  gridSize: number
  theme: string
  publishedTemplateId?: number | null
}
const boardCache = new Map<number, CachedBoard>()
const MAX_BOARD_CACHE = 20

export function useSync() {
  function loadBoardId() {
    const saved = safeGet<number>(BOARD_ID_KEY)
    if (saved) remoteBoardId.value = saved
  }

  function saveBoardId(id: number) {
    remoteBoardId.value = id
    safeSet(BOARD_ID_KEY, id)
  }

  function cacheBoard(boardId: number, data: CachedBoard) {
    // FIFO eviction when cache is full
    if (boardCache.size >= MAX_BOARD_CACHE && !boardCache.has(boardId)) {
      const oldest = boardCache.keys().next().value
      if (oldest !== undefined) boardCache.delete(oldest)
    }
    boardCache.set(boardId, data)
  }

  function invalidateBoardCache(boardId: number) {
    boardCache.delete(boardId)
  }

  /**
   * Convert remote board cells → BingoCell[] format.
   * imageUrl from the server is already the correct URL for the current channel:
   * - stable: plain public URL
   * - beta: presigned URL (time-limited, HTTPS)
   * imagePath stores the resolved URL directly; usePrivateImage handles local paths.
   */
  function toLocalCells(remoteCells: Array<{ position: number; title: string; imageName: string; imageUrl?: string; illustrationPath?: string; illustrationUrl?: string; completed: boolean }>): BingoCell[] {
    return remoteCells.map((c) => ({
      id: c.position,
      title: c.title,
      imagePath: c.imageUrl ? resolveApiUrl(c.imageUrl) : undefined,
      illustrationPath: c.illustrationUrl ? resolveApiUrl(c.illustrationUrl) : undefined,
      completed: c.completed,
    }))
  }

  /**
   * Write remote board data into the shared singleton state.
   * Sets the _loadingFromRemote guard to suppress the cells watcher.
   */
  function applyRemoteBoard(board: {
    title?: string
    cells: BingoCell[]
    gridSize: number
    theme?: string
    preserveLocalImages?: boolean
  }) {
    const store = useBingoBoard()
    store.setLoadingFromRemote(true)
    try {
      if (board.title) {
        store.saveBoardTitle(board.title)
      }
      if (board.gridSize !== store.gridSize.value) {
        store.changeGridSize(board.gridSize)
      }
      // Ensure cell array length matches
      const total = store.gridSize.value * store.gridSize.value
      if (store.cells.value.length !== total) {
        store.changeGridSize(board.gridSize)
      }
      store.cells.value.forEach((cell, i) => {
        const rc = board.cells[i]
        if (rc) {
          const previousTitle = cell.title
          const localImagePath = cell.imagePath
          cell.title = rc.title
          const shouldPreserveLocalImage =
            board.preserveLocalImages === true &&
            safeGet(STORAGE_KEYS.IMAGE_MODE) === 'local' &&
            rc.completed === true &&
            !rc.imagePath &&
            !!localImagePath &&
            previousTitle === rc.title

          if (shouldPreserveLocalImage) {
            cell.imagePath = localImagePath
          } else {
            cell.imagePath = rc.imagePath
          }
          cell.illustrationPath = rc.illustrationPath
          cell.completed = rc.completed
        } else {
          cell.title = ''
          cell.imagePath = undefined
          cell.illustrationPath = undefined
          cell.completed = false
        }
      })
      store.persistState()
      // Sync bingo line count so celebration doesn't re-trigger
      store.syncLineCount()
    } finally {
      store.setLoadingFromRemote(false)
    }
  }

  /**
   * Initial sync: if there's no Bingo board on the server, create one from local data.
   * If a Bingo board already exists on the server, fetch the latest version.
   */
  async function initialSync(
    localCells: BingoCell[],
    gridSize: number,
    themeId: string,
    _wordBank?: string[],
  ): Promise<{
    title?: string
    cells?: BingoCell[]
    gridSize?: number
    theme?: string
    wordBank?: string[]
    publishedTemplateId?: number | null
  } | null> {
    if (!isLoggedIn()) return null

    syncing.value = true
    lastSyncError.value = ''
    try {
      // 1. Check whether a remote Bingo board exists (no longer push the word bank every time, only when the user edits)
      loadBoardId()
      const requestedBoardId = remoteBoardId.value
      let board

      if (remoteBoardId.value) {
        try {
          board = await getBoard(remoteBoardId.value)
        } catch {
          // The Bingo board may have been deleted
          remoteBoardId.value = null
        }
      }

      if (!board) {
        // Find an existing Bingo board or create a new one
        const boards = await getBoards()
        if (boards.length > 0) {
          board = await getBoard(boards[0].id)
        } else {
          board = await createBoard({
            title: defaultBoardTitle(),
            gridSize,
            theme: themeId,
          })
        }
      }

      saveBoardId(board.id)

      // 3. Compare local and remote data
      const remoteHasContent = board.cells.some((c: { title: string }) => c.title)

      // Detect whether the local cells are still the freshly initialized default words (user hasn't edited them)
      const isLocalDefaults = localCells.length === DEFAULT_WORDS.length &&
        localCells.every((c, i) => c.title === (DEFAULT_WORDS[i] ?? '') && !c.completed && !c.imagePath)

      if (!remoteHasContent && localCells.some((c) => c.title)) {
        // Server is empty + local has content → push local data
        await pushCells(localCells, gridSize, themeId)
        return null
      }

      if (isLocalDefaults && remoteHasContent) {
        // Local has default words (rebuilt after cache was cleared) but remote has user data → pull remote
        // We must not overwrite the user's remote data with default words
        const remoteCells = toLocalCells(board.cells)
        applyRemoteBoard({
          title: board.title,
          cells: remoteCells,
          gridSize: board.gridSize,
          preserveLocalImages: requestedBoardId === board.id,
        })
        const result = {
          title: board.title,
          cells: remoteCells,
          gridSize: board.gridSize,
          theme: board.theme,
          wordBank: undefined as string[] | undefined,
          publishedTemplateId: (board as any).publishedTemplateId || null,
        }
        cacheBoard(board.id, result)
        return result
      }

      // Server has data: write to the shared singleton and return it
      const remoteCells = toLocalCells(board.cells)

      applyRemoteBoard({
        title: board.title,
        cells: remoteCells,
        gridSize: board.gridSize,
        preserveLocalImages: requestedBoardId === board.id,
      })

      const result = {
        title: board.title,
        cells: remoteCells,
        gridSize: board.gridSize,
        theme: board.theme,
        wordBank: undefined as string[] | undefined,
        publishedTemplateId: (board as any).publishedTemplateId || null,
      }
      cacheBoard(board.id, result)
      return result
    } catch (err: any) {
      lastSyncError.value = err.message || '同步失败'
      console.warn('[Sync] 初始同步失败:', err)
      return null
    } finally {
      syncing.value = false
    }
  }

  /**
   * Push cell data to the server
   */
  async function pushCells(
    localCells: BingoCell[],
    gridSize: number,
    themeId: string,
  ) {
    if (!isLoggedIn() || !remoteBoardId.value) return

    // Skip sync if all cells are blank (user hasn't edited yet)
    const hasContent = localCells.some((c) => c.title.trim())
    if (!hasContent) return

    try {
      // Update Bingo board settings
      await updateBoard(remoteBoardId.value, {
        gridSize,
        theme: themeId,
      })

      // Update cell titles, illustrations and completion state
      await updateCells(
        remoteBoardId.value,
        localCells.map((c) => ({ position: c.id, title: c.title, illustrationPath: c.illustrationPath, completed: c.completed })),
      )

      // Content changed, invalidate cache
      invalidateBoardCache(remoteBoardId.value)
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('违规')) throw err
      console.warn('[Sync] 推送格子失败:', err)
    }
  }

  /**
   * Mark a cell as completed and upload the image
   * Errors propagate to caller (index.vue handles moderation + network errors)
   */
  type UploadResult = Awaited<ReturnType<typeof uploadImage>>

  async function pushComplete(position: number, imagePath: string): Promise<UploadResult | null> {
    if (!isLoggedIn() || !remoteBoardId.value) return null
    const result = await uploadImage(imagePath, remoteBoardId.value, position)
    invalidateBoardCache(remoteBoardId.value)
    return result
  }

  /**
   * Sync the word bank to the server
   */
  async function pushWordBank(words: string[]) {
    if (!isLoggedIn()) return
    try {
      await replaceWordBank(words)
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('违规')) throw err
      console.warn('[Sync] 词库同步失败:', err)
    }
  }

  /**
   * Create a new Bingo board and sync it
   */
  async function pushNewBoard(gridSize: number, themeId: string) {
    if (!isLoggedIn()) return

    try {
      const existingBoards = await getBoards()
      const titles = existingBoards.map(b => b.title)
      const board = await createBoard({
        title: defaultBoardTitle(titles),
        gridSize,
        theme: themeId,
      })
      saveBoardId(board.id)
    } catch (err) {
      console.warn('[Sync] 创建Bingo卡失败:', err)
    }
  }

  /**
   * Fetch the list of all Bingo boards.
   * Returns an empty array when not logged in; throws on network errors.
   */
  async function fetchBoards() {
    if (!isLoggedIn()) return []
    try {
      return await getBoards()
    } catch (err) {
      console.warn('[Sync] 获取Bingo卡列表失败:', err)
      throw err
    }
  }

  /**
   * Switch to the given Bingo board, update shared state directly, and return its theme info
   */
  async function switchBoard(boardId: number): Promise<{
    title?: string
    cells?: BingoCell[]
    gridSize?: number
    theme?: string
    publishedTemplateId?: number | null
  } | null> {
    if (!isLoggedIn()) return null
    try {
      // Render immediately from cache when available
      const cached = boardCache.get(boardId)
      if (cached) {
        saveBoardId(boardId)
        applyRemoteBoard({
          title: cached.title,
          cells: cached.cells,
          gridSize: cached.gridSize,
        })
        // Notify the server to activate it in the background; don't block the UI
        activateBoard(boardId).catch(() => {})
        return cached
      }

      // Cache miss: do the full request
      const board = await activateBoard(boardId)
      saveBoardId(board.id)

      const remoteCells = toLocalCells(board.cells)
      const result = {
        title: board.title,
        cells: remoteCells,
        gridSize: board.gridSize,
        theme: board.theme,
        publishedTemplateId: (board as any).publishedTemplateId || null,
      }

      applyRemoteBoard({
        title: board.title,
        cells: remoteCells,
        gridSize: board.gridSize,
      })

      cacheBoard(board.id, result)
      return result
    } catch (err) {
      console.warn('[Sync] 切换Bingo卡失败:', err)
      return null
    }
  }

  /**
   * Delete the specified Bingo board
   */
  async function removeBoard(boardId: number): Promise<boolean> {
    if (!isLoggedIn()) return false
    try {
      await deleteBoard(boardId)
      invalidateBoardCache(boardId)
      // If the deleted board is the current one, clear the local reference
      if (remoteBoardId.value === boardId) {
        remoteBoardId.value = null
        safeRemove(BOARD_ID_KEY)
      }
      return true
    } catch (err) {
      console.warn('[Sync] 删除Bingo卡失败:', err)
      return false
    }
  }

  /**
   * Create a new Bingo board, activate it, and update shared state directly
   */
  async function createAndSwitchBoard(
    title: string,
    gridSize: number,
    themeId: string,
  ): Promise<{
    title?: string
    cells?: BingoCell[]
    gridSize?: number
    theme?: string
  } | null> {
    if (!isLoggedIn()) return null
    try {
      const board = await createBoard({ title, gridSize, theme: themeId })
      saveBoardId(board.id)

      const remoteCells = toLocalCells(board.cells)
      const result = {
        title: board.title,
        cells: remoteCells,
        gridSize: board.gridSize,
        theme: board.theme,
      }

      applyRemoteBoard({
        title: board.title,
        cells: remoteCells,
        gridSize: board.gridSize,
      })

      cacheBoard(board.id, result)
      return result
    } catch (err) {
      console.warn('[Sync] 创建并切换Bingo卡失败:', err)
      return null
    }
  }

  /**
   * Rename a Bingo board
   */
  async function renameBoard(boardId: number, title: string): Promise<boolean> {
    if (!isLoggedIn()) return false
    try {
      await updateBoard(boardId, { title })
      invalidateBoardCache(boardId)
      // If we renamed the currently active Bingo board, also update the shared title
      if (boardId === remoteBoardId.value) {
        const store = useBingoBoard()
        store.saveBoardTitle(title)
      }
      return true
    } catch (err) {
      console.warn('[Sync] 重命名Bingo卡失败:', err)
      return false
    }
  }

  /**
   * Clone a Bingo board
   */
  async function duplicateBoard(boardId: number, title: string): Promise<boolean> {
    if (!isLoggedIn()) return false
    try {
      await apiCloneBoard(boardId, title)
      return true
    } catch (err) {
      console.warn('[Sync] 克隆Bingo卡失败:', err)
      return false
    }
  }

  /**
   * Get the current Bingo board's index among all of the user's boards (sorted by creation time, the first being 1)
   */
  async function getBoardSequenceNumber(): Promise<number | null> {
    if (!isLoggedIn() || !remoteBoardId.value) return null
    try {
      const boards = await getBoards()
      // Sort by createdAt ascending (oldest first)
      // Replace space with T for iOS Date compatibility ("yyyy-MM-dd HH:mm:ss" → "yyyy-MM-ddTHH:mm:ss")
      boards.sort((a, b) =>
        new Date(a.createdAt.replace(' ', 'T')).getTime() - new Date(b.createdAt.replace(' ', 'T')).getTime()
      )
      const index = boards.findIndex((b) => b.id === remoteBoardId.value)
      return index >= 0 ? index + 1 : null
    } catch (err) {
      console.warn('[Sync] 获取Bingo卡序号失败:', err)
      return null
    }
  }

  /**
   * Reset the remote Bingo board: delete server-side images and clear completion state
   */
  async function resetRemoteBoard(): Promise<boolean> {
    if (!isLoggedIn() || !remoteBoardId.value) return false
    try {
      await apiResetBoard(remoteBoardId.value)
      console.log('[Sync] 远端Bingo卡已重置')
      return true
    } catch (err) {
      console.warn('[Sync] 远端重置失败:', err)
      return false
    }
  }

  /**
   * Reload the currently active Bingo board (used when an external page switched the active board and we need to refresh local state)
   */
  async function reloadActiveBoard(): Promise<{
    title?: string
    cells?: BingoCell[]
    gridSize?: number
    theme?: string
  } | null> {
    if (!isLoggedIn()) return null
    try {
      const boards = await getBoards()
      const active = boards.find(b => b.isActive)
      if (!active) return null

      const board = await getBoard(active.id)
      saveBoardId(board.id)

      const remoteCells = toLocalCells(board.cells)
      const result = {
        title: board.title,
        cells: remoteCells,
        gridSize: board.gridSize,
        theme: board.theme,
      }

      applyRemoteBoard({
        title: board.title,
        cells: remoteCells,
        gridSize: board.gridSize,
      })

      cacheBoard(board.id, result)
      return result
    } catch (err) {
      console.warn('[Sync] 重新加载活跃卡失败:', err)
      return null
    }
  }

  return {
    remoteBoardId,
    syncing,
    lastSyncError,
    initialSync,
    pushCells,
    pushComplete,
    pushWordBank,
    pushNewBoard,
    fetchBoards,
    switchBoard,
    removeBoard,
    createAndSwitchBoard,
    renameBoard,
    duplicateBoard,
    getBoardSequenceNumber,
    resetRemoteBoard,
    reloadActiveBoard,
  }
}
