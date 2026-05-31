import { ref } from 'vue'
import { DEFAULT_WORDS } from './bingoDefaults'
import { checkContent } from './api'
import { STORAGE_KEYS } from '@/config/storageKeys'
import { MAX_WORDS } from '@/config/limits'
import { safeGet, safeSet } from '@/utils/safeStorage'

const WORD_BANK_KEY = STORAGE_KEYS.WORD_BANK

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
let loaded = false

export function useWordBank() {

  function loadWordBank() {
    if (loaded) return
    const saved = safeGet<string[]>(WORD_BANK_KEY)
    if (Array.isArray(saved)) {
      wordBank.value = sanitizeWordList(saved)
      loaded = true
      return
    }
    wordBank.value = [...DEFAULT_WORDS]
    loaded = true
  }

  function persistWordBank() {
    safeSet(WORD_BANK_KEY, wordBank.value)
  }

  /**
   * Add a word to the word bank (after passing server-side moderation)
   * @returns 'ok' | 'moderation_fail' | 'duplicate' | 'full' | 'empty'
   */
  async function addWord(word: string): Promise<'ok' | 'moderation_fail' | 'duplicate' | 'full' | 'empty'> {
    const normalized = normalizeWord(word)
    if (!normalized) return 'empty'
    if (wordBank.value.includes(normalized)) return 'duplicate'
    if (wordBank.value.length >= MAX_WORDS) return 'full'

    // Server-side moderation
    const check = await checkContent(normalized)
    if (!check.pass) return 'moderation_fail'

    wordBank.value = [normalized, ...wordBank.value]
    persistWordBank()
    return 'ok'
  }

  /**
   * Edit a word (after passing server-side moderation)
   * @returns 'ok' | 'moderation_fail' | 'empty'
   */
  async function updateWord(index: number, word: string): Promise<'ok' | 'moderation_fail' | 'empty'> {
    const normalized = normalizeWord(word)
    if (!normalized) return 'empty'

    // Server-side moderation
    const check = await checkContent(normalized)
    if (!check.pass) return 'moderation_fail'

    wordBank.value = wordBank.value.map((item, idx) => (idx === index ? normalized : item))
    persistWordBank()
    return 'ok'
  }

  function removeWord(index: number) {
    const removed = wordBank.value[index]
    if (removed === undefined) return null
    wordBank.value = wordBank.value.filter((_, idx) => idx !== index)
    persistWordBank()
    return removed
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
    }

    if (newWords.length === 0) return { added: 0, blocked: false }

    // Bulk moderation
    const allText = newWords.join('\n')
    const check = await checkContent(allText)
    if (!check.pass) return { added: 0, blocked: true }

    for (const w of newWords) {
      wordBank.value.push(w)
    }
    persistWordBank()
    return { added: newWords.length, blocked: false }
  }

  function resetWordBank() {
    loaded = false
    wordBank.value = []
  }

  return {
    wordBank,
    loadWordBank,
    resetWordBank,
    addWord,
    updateWord,
    removeWord,
    mergeWords,
  }
}
