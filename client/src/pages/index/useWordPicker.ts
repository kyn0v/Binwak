/**
 * useWordPicker
 *
 * Owns the edit-mode "word picker" overlay used to assign a word from the word
 * bank to a board cell. Encapsulates:
 *  - reactive state (`showWordPicker`, `manualAssignTarget`, `wordSearch`,
 *    `pickerNewWord`) and the `filteredWordBank` computed,
 *  - opening the picker for a target cell (pre-fetching illustrations for the
 *    bank words on a cache miss),
 *  - assigning a word to the target cell (resetting its photo/illustration/
 *    completed state and auto-populating a matching illustration),
 *  - adding a brand-new word to the bank and immediately assigning it.
 *
 * Dependencies are injected so this stays decoupled from the page. `illustCache`
 * is shared with useIllustMode (single owner there); the word picker reads/writes
 * it to avoid redundant illustration look-ups.
 */
import { computed, ref, type Ref } from 'vue'
import type { BingoCell } from './useBingoBoard'
import { matchIllustrations } from './api'
import { preWarmLocalPaths } from './useCanvasExport'

type AddWordResult = 'ok' | 'moderation_fail' | 'duplicate' | 'full' | 'empty'

export interface UseWordPickerDeps {
  cells: Ref<BingoCell[]>
  wordBank: Ref<string[]>
  addWord: (word: string) => Promise<AddWordResult>
  illustCache: Map<string, string>
}

export function useWordPicker(deps: UseWordPickerDeps) {
  const { cells, wordBank, addWord, illustCache } = deps

  const showWordPicker = ref(false)
  const manualAssignTarget = ref<number | null>(null)
  const wordSearch = ref('')
  const pickerNewWord = ref('')

  const filteredWordBank = computed(() => {
    const query = wordSearch.value.trim().toLowerCase()
    if (!query) return wordBank.value
    return wordBank.value.filter((word) => word.toLowerCase().includes(query))
  })

  function openWordPicker(index: number) {
    manualAssignTarget.value = index
    wordSearch.value = ''
    pickerNewWord.value = ''
    showWordPicker.value = true
    // Pre-fetch illustrations for all word bank words (cache miss only)
    const uncached = wordBank.value.filter((w) => !illustCache.has(w))
    if (uncached.length > 0) {
      matchIllustrations(uncached).then((matches) => {
        for (const word of uncached) {
          const info = matches[word]
          illustCache.set(word, info ? info.illustrationUrl : 'none')
        }
      }).catch(() => {})
    }
  }

  function assignWordToTarget(word: string) {
    const targetIndex = manualAssignTarget.value
    if (targetIndex === null) return
    const cell = cells.value[targetIndex]
    if (!cell) return
    cell.title = word
    cell.imagePath = undefined
    cell.illustrationPath = undefined
    cell.completed = false
    showWordPicker.value = false
    manualAssignTarget.value = null
    // Auto-populate illustration for this word
    const cachedUrl = illustCache.get(word)
    if (cachedUrl && cachedUrl !== 'none') {
      cell.illustrationPath = cachedUrl
    } else if (cachedUrl === undefined) {
      // Not yet looked up: call the API and cache the result
      matchIllustrations([word]).then((matches) => {
        if (matches[word]) {
          illustCache.set(word, matches[word].illustrationUrl)
          cell.illustrationPath = matches[word].illustrationUrl
          preWarmLocalPaths([matches[word].illustrationUrl])
        } else {
          illustCache.set(word, 'none')
        }
      }).catch(() => {})
    }
  }

  async function addAndAssignWord() {
    const text = pickerNewWord.value.trim()
    if (!text) {
      uni.showToast({ title: '请输入词语', icon: 'none' })
      return
    }
    const result = await addWord(text)
    if (result === 'moderation_fail') {
      uni.showToast({ title: '内容含违规信息，请修改', icon: 'none' })
      return
    }
    if (result !== 'ok') {
      uni.showToast({ title: result === 'duplicate' ? '该词已存在' : '添加失败', icon: 'none' })
      return
    }
    pickerNewWord.value = ''
    assignWordToTarget(text)
  }

  function closeWordPicker() {
    showWordPicker.value = false
    manualAssignTarget.value = null
    wordSearch.value = ''
    pickerNewWord.value = ''
  }

  return {
    showWordPicker,
    manualAssignTarget,
    wordSearch,
    pickerNewWord,
    filteredWordBank,
    openWordPicker,
    assignWordToTarget,
    addAndAssignWord,
    closeWordPicker,
  }
}
