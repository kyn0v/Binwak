<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getAdminWordbank, generateTemplateFromWordbank, type AdminWordItem } from '../api'

const router = useRouter()

const words = ref<AdminWordItem[]>([])
const selected = ref<Set<string>>(new Set())
const title = ref('')
const description = ref('')
const category = ref('creative')
const loading = ref(false)
const error = ref('')
const generating = ref(false)
const search = ref('')
const filterMode = ref<'all' | 'with-illust' | 'no-illust'>('all')
const page = ref(1)
const pageSize = 60

const filteredWords = computed(() => {
  let list = words.value
  if (search.value.trim()) {
    list = list.filter(w => w.word.includes(search.value.trim()))
  }
  if (filterMode.value === 'with-illust') {
    list = list.filter(w => w.illustrationUrl)
  } else if (filterMode.value === 'no-illust') {
    list = list.filter(w => !w.illustrationUrl)
  }
  return list
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredWords.value.length / pageSize)))
const pagedWords = computed(() => {
  const start = (page.value - 1) * pageSize
  return filteredWords.value.slice(start, start + pageSize)
})

const selectedCount = computed(() => selected.value.size)
const canGenerate = computed(() => selectedCount.value === 25 && title.value.trim())

function toggleWord(word: string) {
  if (selected.value.has(word)) {
    selected.value.delete(word)
  } else if (selected.value.size < 25) {
    selected.value.add(word)
  }
  selected.value = new Set(selected.value)
}

function selectRandom() {
  selected.value.clear()
  const available = filteredWords.value.map(w => w.word)
  const shuffled = available.sort(() => Math.random() - 0.5)
  for (const w of shuffled.slice(0, 25)) {
    selected.value.add(w)
  }
  selected.value = new Set(selected.value)
}

function clearSelection() {
  selected.value = new Set()
}

function setPage(p: number) {
  page.value = Math.max(1, Math.min(p, totalPages.value))
}

async function fetchWords() {
  loading.value = true
  error.value = ''
  try {
    const data = await getAdminWordbank()
    words.value = data.words
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function onGenerate() {
  if (!canGenerate.value) return
  generating.value = true
  error.value = ''
  try {
    const wordList = Array.from(selected.value)
    const result = await generateTemplateFromWordbank({
      title: title.value.trim(),
      description: description.value.trim() || undefined,
      words: wordList,
      category: category.value,
    })
    alert(`模板已生成！ID: ${result.templateId}`)
    router.push('/templates')
  } catch (e: any) {
    error.value = e.message
  } finally {
    generating.value = false
  }
}

onMounted(fetchWords)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold text-gray-800">生成模板</h2>
      <span class="text-sm" :class="selectedCount === 25 ? 'text-green-600 font-medium' : 'text-gray-400'">
        已选 {{ selectedCount }} / 25 词
      </span>
    </div>

    <div v-if="error" class="text-red-500 text-sm mb-4 p-3 bg-red-50 rounded-lg">{{ error }}</div>

    <!-- Template info -->
    <div class="bg-white rounded-xl border border-gray-200 p-4 mb-4">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label class="block text-xs text-gray-500 mb-1">标题 *</label>
          <input
            v-model="title"
            placeholder="如：脑洞大开 Bingo Vol.1"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">描述</label>
          <input
            v-model="description"
            placeholder="可选描述"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">分类</label>
          <select v-model="category" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="creative">creative (脑洞大开)</option>
            <option value="city">city</option>
            <option value="food">food</option>
            <option value="sport">sport</option>
            <option value="lifestyle">lifestyle</option>
            <option value="nicetry">nicetry</option>
            <option value="other">other</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Action bar -->
    <div class="flex gap-2 mb-3 flex-wrap items-center">
      <input
        v-model="search"
        placeholder="搜索词语..."
        class="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 w-40"
      />
      <!-- Filter buttons -->
      <button
        v-for="f in [
          { key: 'all', label: '全部' },
          { key: 'with-illust', label: '🖼 有插画' },
          { key: 'no-illust', label: '无插画' },
        ]"
        :key="f.key"
        @click="filterMode = f.key as any; page = 1"
        class="px-3 py-2 text-xs rounded-lg border transition-colors"
        :class="filterMode === f.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'"
      >{{ f.label }}</button>
      <span class="text-xs text-gray-400">{{ filteredWords.length }} 词</span>
      <button
        @click="selectRandom"
        :disabled="filteredWords.length < 25"
        class="px-3 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
      >🎲 随机 25 词</button>
      <button
        @click="clearSelection"
        :disabled="selectedCount === 0"
        class="px-3 py-2 text-sm bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
      >清空选择</button>
      <div class="flex-1"></div>
      <button
        @click="onGenerate"
        :disabled="!canGenerate || generating"
        class="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium"
      >{{ generating ? '生成中...' : '✨ 生成模板' }}</button>
    </div>

    <!-- Word grid -->
    <div v-if="loading" class="text-center py-8 text-gray-400">加载中...</div>
    <div v-else-if="words.length === 0" class="text-center py-8 text-gray-400">
      词库为空，请先到「词库管理」添加词语
    </div>
    <div v-else class="flex flex-wrap gap-2">
      <button
        v-for="w in pagedWords"
        :key="w.id"
        @click="toggleWord(w.word)"
        class="px-3 py-2 text-sm rounded-lg border transition-all"
        :class="selected.has(w.word)
          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
          : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:bg-blue-50'"
      >
        <span v-if="w.illustrationUrl" class="mr-1">🖼</span>
        {{ w.word }}
      </button>
    </div>

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 mt-4">
      <button
        @click="setPage(page - 1)"
        :disabled="page <= 1"
        class="px-3 py-1 text-sm rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
      >‹</button>
      <span class="text-sm text-gray-500">{{ page }} / {{ totalPages }}</span>
      <button
        @click="setPage(page + 1)"
        :disabled="page >= totalPages"
        class="px-3 py-1 text-sm rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50"
      >›</button>
    </div>

    <!-- Preview grid -->
    <div v-if="selectedCount > 0" class="mt-6">
      <h3 class="text-sm font-medium text-gray-600 mb-2">预览（{{ selectedCount }}/25）</h3>
      <div class="grid grid-cols-5 gap-1 max-w-md">
        <div
          v-for="(word, idx) in Array.from(selected)"
          :key="idx"
          class="bg-blue-50 text-blue-800 text-xs text-center py-2 px-1 rounded truncate"
          :title="word"
        >{{ word }}</div>
        <div
          v-for="i in (25 - selectedCount)"
          :key="'empty-' + i"
          class="bg-gray-50 text-gray-300 text-xs text-center py-2 px-1 rounded"
        >?</div>
      </div>
    </div>
  </div>
</template>
