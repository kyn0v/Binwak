/**
 * useIllustMode
 *
 * Owns the home tab's "illustration mode" — the toggle that swaps cell words for
 * matched illustrations. Encapsulates:
 *  - reactive state (`isIllustMode`, `illustLoading`),
 *  - the per-board persisted preference (STORAGE_KEYS.ILLUST_MODE_PREFIX + boardId),
 *  - the word→illustration cache (`illustCache`) and the fetch/populate logic,
 *  - the toggle flow with graceful fallback to text mode on failure / no matches.
 *
 * `illustCache` is intentionally exposed because the word-picker also reads/writes
 * it (cache hits avoid re-fetching when assigning a word). It is owned here so the
 * cache has a single home.
 *
 * Dependencies are injected so this stays decoupled from the page:
 *   useIllustMode({ cells, remoteBoardId, persistState })
 */
import { ref, type Ref } from 'vue'
import type { BingoCell } from './useBingoBoard'
import { STORAGE_KEYS } from '@/config/storageKeys'
import { safeGet, safeSet } from '@/utils/safeStorage'
import { matchIllustrations } from './api'
import { preWarmLocalPaths } from './useCanvasExport'
import { defaultIllustModeOn } from './boardState'

const ILLUST_MODE_PREFIX = STORAGE_KEYS.ILLUST_MODE_PREFIX

export interface UseIllustModeDeps {
  cells: Ref<BingoCell[]>
  remoteBoardId: Ref<number | null>
  persistState: () => void
}

export function useIllustMode(deps: UseIllustModeDeps) {
  const { cells, remoteBoardId, persistState } = deps

  const isIllustMode = ref(false)
  const illustLoading = ref(false)
  // word → illustrationUrl (or the sentinel 'none'); shared with the word picker.
  const illustCache = new Map<string, string>()
  let fetching = false

  function illustModeKey(): string {
    const bid = remoteBoardId.value
    return bid ? `${ILLUST_MODE_PREFIX}${bid}` : ''
  }

  /** Load the per-board illustration-mode preference (defaults ON if the board already has illustrations). */
  function loadIllustMode() {
    const key = illustModeKey()
    if (!key) {
      isIllustMode.value = false
      return
    }
    const stored = safeGet(key)
    if (stored === undefined) {
      // No explicit preference yet: default ON if the board has any illustration-bearing cells
      isIllustMode.value = defaultIllustModeOn(cells.value)
    } else {
      isIllustMode.value = !!stored
    }
  }

  /**
   * Fetch matching illustrations for the current cell words and populate each
   * cell's illustrationPath. Returns true on success (or nothing to fetch),
   * false if the API call failed.
   */
  async function autoPopulateIllustrations(): Promise<boolean> {
    if (fetching) return true // already in progress
    const words = cells.value.map((c) => c.title).filter(Boolean)
    if (words.length === 0) return true

    const uncached = words.filter((w) => !illustCache.has(w))

    if (uncached.length > 0) {
      fetching = true
      illustLoading.value = true
      try {
        const matches = await matchIllustrations(uncached)
        for (const word of uncached) {
          const info = matches[word]
          illustCache.set(word, info ? info.illustrationUrl : 'none')
        }
      } catch {
        uni.showToast({ title: '插画加载失败，请重试', icon: 'none' })
        fetching = false
        illustLoading.value = false
        return false
      } finally {
        fetching = false
        illustLoading.value = false
      }
    }

    let changed = false
    for (const cell of cells.value) {
      const url = cell.title ? illustCache.get(cell.title) : undefined
      if (url && url !== 'none' && cell.illustrationPath !== url) {
        cell.illustrationPath = url
        changed = true
      }
    }
    if (changed) {
      persistState()
    }
    // Pre-warm canvas local path cache so first preview is fast
    const urlsToWarm = cells.value
      .flatMap((c) => [c.illustrationPath, c.imagePath])
      .filter(Boolean) as string[]
    if (urlsToWarm.length) preWarmLocalPaths(urlsToWarm)
    return true
  }

  /** Toggle illustration mode, persisting the preference and falling back to text mode on failure / no matches. */
  async function toggleIllustMode() {
    const wantIllust = !isIllustMode.value
    isIllustMode.value = wantIllust
    const key = illustModeKey()
    if (key) safeSet(key, wantIllust)

    if (wantIllust) {
      const ok = await autoPopulateIllustrations()
      if (!ok) {
        // Fetch failed → fall back to text mode
        isIllustMode.value = false
        if (key) safeSet(key, false)
        return
      }
      // No matching illustrations at all → toast and fall back
      const hasAny = cells.value.some((c) => c.illustrationPath)
      if (!hasAny) {
        uni.showToast({ title: '当前词语暂无匹配插画', icon: 'none' })
        isIllustMode.value = false
        if (key) safeSet(key, false)
      }
    }
  }

  return {
    isIllustMode,
    illustLoading,
    illustCache,
    loadIllustMode,
    toggleIllustMode,
    autoPopulateIllustrations,
  }
}
