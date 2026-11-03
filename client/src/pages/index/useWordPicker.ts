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
import { editBoard, type BingoCell } from './useBingoBoard'
import { matchIllustrations } from './api'
import { preWarmLocalPaths } from './useCanvasExport'

type AddWordResult = 'ok' | 'moderation_fail' | 'duplicate' | 'full' | 'empty' | 'save_failed' | 'stale'

export interface UseWordPickerDeps {
  cells: Ref<BingoCell[]>
  wordBank: Ref<string[]>
  addWord: (word: string) => Promise<AddWordResult>
  illustCache: Map<string, string>
  illustKeys?: Map<string, string>
}

export function useWordPicker(deps: UseWordPickerDeps) {
  const { cells, wordBank, addWord, illustCache, illustKeys = new Map<string, string>() } = deps

  let targetCell: BingoCell | undefined
  let targetGeneration: number | undefined
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
    targetCell = cells.value[index]
    targetGeneration = targetCell?.generation
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
          if (info) illustKeys.set(word, info.illustrationPath)
        }
      }).catch(() => {})
    }
  }

  function assignWordToTarget(word: string) {
    const targetIndex = manualAssignTarget.value
    if (targetIndex === null) return
    const cell = cells.value[targetIndex]
    if (!cell || cell !== targetCell || cell.generation !== targetGeneration) return
    if (!editBoard(() => {
      cell.title = word
      cell.imagePath = undefined
      cell.localPath = undefined
      cell.illustrationPath = undefined
      cell.illustrationKey = undefined
      cell.completed = false
    })) return
    const generation = cell.generation
    showWordPicker.value = false
    manualAssignTarget.value = null
    // Auto-populate illustration for this word
    const cachedUrl = illustCache.get(word)
    if (cachedUrl && cachedUrl !== 'none') {
      editBoard(() => { cell.illustrationPath = cachedUrl; cell.illustrationKey = illustKeys.get(word) })
    } else if (cachedUrl === undefined) {
      // Not yet looked up: call the API and cache the result
      matchIllustrations([word]).then((matches) => {
        if (matches[word]) {
          if (cells.value[targetIndex] !== cell || cell.generation !== generation || cell.title !== word) return
          illustCache.set(word, matches[word].illustrationUrl)
          illustKeys.set(word, matches[word].illustrationPath)
          if (editBoard(() => { cell.illustrationPath = matches[word].illustrationUrl; cell.illustrationKey = matches[word].illustrationPath })) preWarmLocalPaths([matches[word].illustrationUrl])
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
    const originalTarget = targetCell
    const result = await addWord(text)
    if (originalTarget !== targetCell) return
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
