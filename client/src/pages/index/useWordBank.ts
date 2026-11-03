import { ref } from 'vue'
import { checkContent } from './api'
import { editBoard } from './useBingoBoard'
import { MAX_WORDS } from '@/config/limits'

function normalizeWord(word: string) {
  return word.trim().replace(/\s+/g, ' ')
}

function sanitizeWordList(words: string[]) {
  const seen = new Set<string>()
  return words.map(normalizeWord).filter(w => {
    if (!w || seen.has(w)) return false
    seen.add(w)
    return true
  }).slice(0, MAX_WORDS)
}

// ── Singleton state (shared across all pages) ──
const wordBank = ref<string[]>([])
let captureWordEdit: () => () => boolean = () => () => false
export function installWordEditGuard(capture: typeof captureWordEdit) { captureWordEdit = capture }

export function useWordBank() {

  /**
   * Add a word to the word bank (after passing server-side moderation)
   * @returns 'ok' | 'moderation_fail' | 'duplicate' | 'full' | 'empty'
   */
  async function addWord(word: string): Promise<'ok' | 'moderation_fail' | 'duplicate' | 'full' | 'empty' | 'save_failed' | 'stale'> {
    const normalized = normalizeWord(word)
    if (!normalized) return 'empty'
    if (wordBank.value.includes(normalized)) return 'duplicate'
    if (wordBank.value.length >= MAX_WORDS) return 'full'

    const current = captureWordEdit()
    if (!current()) return 'stale'
    const check = await checkContent(normalized)
    if (!current()) return 'stale'
    if (!check.pass) return 'moderation_fail'
    if (wordBank.value.includes(normalized)) return 'duplicate'
    if (wordBank.value.length >= MAX_WORDS) return 'full'
    return editBoard(() => { wordBank.value = [normalized, ...wordBank.value] }) ? 'ok' : 'save_failed'
  }

  /**
   * Edit a word (after passing server-side moderation)
   * @returns 'ok' | 'moderation_fail' | 'empty'
   */
  async function updateWord(index: number, word: string): Promise<'ok' | 'moderation_fail' | 'empty' | 'duplicate' | 'save_failed' | 'stale'> {
    const normalized = normalizeWord(word)
    if (!normalized) return 'empty'

    const current = captureWordEdit()
    if (!current()) return 'stale'
    const original = wordBank.value
    const check = await checkContent(normalized)
    if (!current() || wordBank.value !== original) return 'stale'
    if (!check.pass) return 'moderation_fail'
    if (wordBank.value.some((word, idx) => idx !== index && word === normalized)) return 'duplicate'
    return editBoard(() => { wordBank.value = wordBank.value.map((item, idx) => idx === index ? normalized : item) }) ? 'ok' : 'save_failed'
  }

  function removeWord(index: number) {
    const removed = wordBank.value[index]
    if (removed === undefined) return null
    return editBoard(() => { wordBank.value = wordBank.value.filter((_, idx) => idx !== index) }) ? removed : null
  }

  /**
   * Merge a group of words into the word bank (deduplicating, skipping existing entries).
   * Used by share-code imports, template application and other bulk paths.
   * Bulk moderation: check all new words in one go.
   */
  async function mergeWords(words: string[]): Promise<{ added: number; blocked: boolean }> {
    const existing = new Set(wordBank.value)
    const newWords: string[] = []
    for (const w of words) {
      const normalized = normalizeWord(w)
      if (!normalized) continue
      if (existing.has(normalized)) continue
      if (wordBank.value.length + newWords.length >= MAX_WORDS) break
      newWords.push(normalized)
      existing.add(normalized)
    }

    if (newWords.length === 0) return { added: 0, blocked: false }

    // Bulk moderation
    const allText = newWords.join('\n')
    const current = captureWordEdit()
    if (!current()) return { added: 0, blocked: true }
    const check = await checkContent(allText)
    if (!current() || !check.pass) return { added: 0, blocked: true }
    const merged = sanitizeWordList([...wordBank.value, ...newWords])
    const added = merged.length - wordBank.value.length
    if (!editBoard(() => { wordBank.value = merged })) return { added: 0, blocked: true }
    return { added, blocked: false }
  }

  function resetWordBank() {
    return editBoard(() => { wordBank.value = [] })
  }

  return {
    wordBank,
    resetWordBank,
    addWord,
    updateWord,
    removeWord,
    mergeWords,
  }
}
