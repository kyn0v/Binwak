<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getAdminWordbank, addAdminWord, deleteAdminWord, batchAddAdminWords, uploadWordIllustration } from '../api'
import type { AdminWordItem } from '../api'

const words = ref<AdminWordItem[]>([])
const loading = ref(false)
const error = ref('')
const newWord = ref('')
const batchInput = ref('')
const showBatchInput = ref(false)
const search = ref('')
const adminUserId = ref<number | null>(null)
const uploadingId = ref<number | null>(null)

const filteredWords = computed(() => {
  if (!search.value.trim()) return words.value
  const q = search.value.trim().toLowerCase()
  return words.value.filter(w => w.word.toLowerCase().includes(q))
})

async function fetchWords() {
  loading.value = true
  error.value = ''
  try {
    const data = await getAdminWordbank()
    words.value = data.words
    adminUserId.value = data.adminUserId
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function onAddWord() {
  const word = newWord.value.trim()
  if (!word) return

  try {
    await addAdminWord(word)
    newWord.value = ''
    await fetchWords()
  } catch (e: any) {
    alert(e.message || '添加失败')
  }
}

async function onDeleteWord(id: number, word: string) {
  if (!confirm(`确认删除「${word}」？`)) return
  try {
    await deleteAdminWord(id)
    await fetchWords()
  } catch (e: any) {
    alert(e.message || '删除失败')
  }
}

async function onBatchAdd() {
  const input = batchInput.value.trim()
  if (!input) return

  const wordList = input.split(/[,，\n]/).map(w => w.trim()).filter(Boolean)
  if (wordList.length === 0) return

  try {
    const result = await batchAddAdminWords(wordList)
    alert(`成功添加 ${result.added} 个词语（共 ${result.total} 个）`)
    batchInput.value = ''
    showBatchInput.value = false
    await fetchWords()
  } catch (e: any) {
    alert(e.message || '批量添加失败')
  }
}

function triggerUpload(wordId: number) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/jpeg,image/png,image/webp,image/gif'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    uploadingId.value = wordId
    try {
      const result = await uploadWordIllustration(wordId, file)
      const item = words.value.find(w => w.id === wordId)
      if (item) item.illustrationUrl = result.illustrationUrl
    } catch (e: any) {
      alert(e.message || '上传失败')
    } finally {
      uploadingId.value = null
    }
  }
  input.click()
}

onMounted(fetchWords)
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-gray-800">📚 词库管理</h1>
      <span v-if="adminUserId" class="text-sm text-gray-400">管理员用户 ID: {{ adminUserId }}</span>
    </div>

    <!-- Error -->
    <div v-if="error" class="mb-4 p-4 bg-red-50 text-red-600 rounded-lg">
      {{ error }}
    </div>

    <!-- Add word -->
    <div class="mb-6 flex gap-3 items-center flex-wrap">
      <form @submit.prevent="onAddWord" class="flex gap-2 items-center">
        <input
          v-model="newWord"
          type="text"
          placeholder="输入新词语..."
          maxlength="80"
          class="px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 w-full sm:w-64"
        />
        <button
          type="submit"
          :disabled="!newWord.trim()"
          class="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:opacity-40"
        >
          + 添加
        </button>
      </form>
      <button
        @click="showBatchInput = !showBatchInput"
        class="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
      >
        {{ showBatchInput ? '收起' : '📋 批量添加' }}
      </button>
    </div>

    <!-- Batch input -->
    <div v-if="showBatchInput" class="mb-6 p-4 bg-gray-50 rounded-lg">
      <p class="text-sm text-gray-500 mb-2">每行一个词语，或用逗号分隔：</p>
      <textarea
        v-model="batchInput"
        rows="5"
        placeholder="追风筝的人&#10;路边野餐&#10;落叶归根"
        class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 resize-y"
      ></textarea>
      <button
        @click="onBatchAdd"
        :disabled="!batchInput.trim()"
        class="mt-2 px-4 py-2 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600 disabled:opacity-40"
      >
        批量添加
      </button>
    </div>

    <!-- Search + stats -->
    <div class="mb-4 flex items-center gap-4">
      <input
        v-model="search"
        type="text"
        placeholder="🔍 搜索词语..."
        class="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white w-full sm:w-64"
      />
      <span class="text-sm text-gray-400">
        共 {{ words.length }} 个词语
        <span v-if="search.trim()">（筛选出 {{ filteredWords.length }} 个）</span>
      </span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-12 text-gray-400">加载中...</div>

    <!-- Word list -->
    <div v-else-if="filteredWords.length > 0" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      <div
        v-for="item in filteredWords"
        :key="item.id"
        class="group relative bg-white border border-gray-100 rounded-xl p-4 hover:shadow-md transition-shadow"
      >
        <!-- Illustration (click to upload) -->
        <div
          class="w-full aspect-square bg-gray-50 rounded-lg mb-3 overflow-hidden flex items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors relative"
          @click="triggerUpload(item.id)"
          :title="item.illustrationUrl ? '点击更换插画' : '点击上传插画'"
        >
          <div v-if="uploadingId === item.id" class="absolute inset-0 bg-white/80 flex items-center justify-center">
            <span class="text-sm text-gray-500">上传中...</span>
          </div>
          <img
            v-if="item.illustrationUrl"
            :src="item.illustrationUrl"
            class="w-full h-full object-cover"
            loading="lazy"
          />
          <span v-else class="text-2xl opacity-30 hover:opacity-50 transition-opacity">📷</span>
        </div>

        <!-- Word -->
        <p class="text-sm font-medium text-gray-700 text-center truncate">{{ item.word }}</p>

        <!-- Delete button -->
        <button
          @click="onDeleteWord(item.id, item.word)"
          class="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-50 text-red-400 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="text-center py-12 text-gray-400">
      <p class="text-lg mb-2">词库为空</p>
      <p class="text-sm">添加词语开始构建你的 Bingo 词库</p>
    </div>
  </div>
</template>
