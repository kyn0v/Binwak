<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { getTemplates, getTemplate, updateTemplate, deleteTemplate, toggleTemplatePin, setTemplateStatus, createAdminTemplate } from '../api'
import Pagination from '../components/Pagination.vue'

const templates = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(20)
const search = ref('')
const statusFilter = ref('')
const categoryFilter = ref('')
const loading = ref(false)
const error = ref('')

// Edit modal state
const editVisible = ref(false)
const editLoading = ref(false)
const editSaving = ref(false)
const editId = ref(0)
const editTitle = ref('')
const editDesc = ref('')
const editCategory = ref('')
const editCells = ref<Array<{ position: number; title: string }>>([])
const editGridSize = ref(5)

let searchTimer: ReturnType<typeof setTimeout>

async function fetchTemplates() {
  loading.value = true
  error.value = ''
  try {
    const data = await getTemplates({
      page: page.value, limit: limit.value,
      search: search.value, status: statusFilter.value,
      category: categoryFilter.value,
    })
    templates.value = data.templates
    total.value = data.total
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; fetchTemplates() }, 300)
}

function onFilterChange() {
  page.value = 1
  fetchTemplates()
}

async function onTogglePin(id: number) {
  try {
    const res = await toggleTemplatePin(id)
    const tpl = templates.value.find(t => t.id === id)
    if (tpl) tpl.is_pinned = res.isPinned ? 1 : 0
  } catch (e: any) {
    alert(e.message)
  }
}

async function onToggleStatus(id: number, currentStatus: string) {
  const newStatus = currentStatus === 'active' ? 'hidden' : 'active'
  try {
    await setTemplateStatus(id, newStatus)
    const tpl = templates.value.find(t => t.id === id)
    if (tpl) tpl.status = newStatus
  } catch (e: any) {
    alert(e.message)
  }
}

async function onEdit(id: number) {
  editVisible.value = true
  editLoading.value = true
  editId.value = id
  try {
    const data = await getTemplate(id)
    editTitle.value = data.title
    editDesc.value = data.description || ''
    editCategory.value = data.category || ''
    editGridSize.value = data.grid_size || 5
    editCells.value = data.cells || []
    // Ensure all positions exist
    const totalCells = editGridSize.value * editGridSize.value
    for (let i = 0; i < totalCells; i++) {
      if (!editCells.value.find(c => c.position === i)) {
        editCells.value.push({ position: i, title: '' })
      }
    }
    editCells.value.sort((a, b) => a.position - b.position)
  } catch (e: any) {
    alert('加载失败: ' + e.message)
    editVisible.value = false
  } finally {
    editLoading.value = false
  }
}

async function onSaveEdit() {
  editSaving.value = true
  try {
    await updateTemplate(editId.value, {
      title: editTitle.value,
      description: editDesc.value,
      category: editCategory.value,
      cells: editCells.value.map(c => ({ position: c.position, title: c.title })),
    })
    editVisible.value = false
    // Update local list
    const tpl = templates.value.find(t => t.id === editId.value)
    if (tpl) {
      tpl.title = editTitle.value
      tpl.category = editCategory.value
    }
  } catch (e: any) {
    alert('保存失败: ' + e.message)
  } finally {
    editSaving.value = false
  }
}

async function onDelete(id: number, title: string) {
  if (!confirm(`确定删除模板「${title}」？\n此操作不可恢复，同时会删除所有收藏和使用记录。`)) return
  try {
    await deleteTemplate(id)
    templates.value = templates.value.filter(t => t.id !== id)
    total.value--
  } catch (e: any) {
    alert('删除失败: ' + e.message)
  }
}

// Create modal state
const createVisible = ref(false)
const createSaving = ref(false)
const createTitle = ref('')
const createDesc = ref('')
const createCategory = ref('creative')
const createGridSize = ref(5)
const createWords = ref('')

const createCells = computed(() => {
  const total = createGridSize.value * createGridSize.value
  const words = createWords.value.split('\n').map(w => w.trim()).filter(Boolean)
  return Array.from({ length: total }, (_, i) => ({
    position: i,
    title: words[i] || '',
  }))
})

function openCreate() {
  createTitle.value = ''
  createDesc.value = ''
  createCategory.value = 'creative'
  createGridSize.value = 5
  createWords.value = ''
  createVisible.value = true
}

async function onSaveCreate() {
  if (!createTitle.value.trim()) { alert('请填写标题'); return }
  createSaving.value = true
  try {
    await createAdminTemplate({
      title: createTitle.value.trim(),
      description: createDesc.value.trim() || undefined,
      gridSize: createGridSize.value,
      cells: createCells.value,
      category: createCategory.value || undefined,
    })
    createVisible.value = false
    fetchTemplates()
  } catch (e: any) {
    alert('创建失败: ' + e.message)
  } finally {
    createSaving.value = false
  }
}

watch(page, fetchTemplates)
onMounted(fetchTemplates)
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold text-gray-800">模板管理</h2>
      <div class="flex items-center gap-3">
        <button @click="openCreate" class="px-3 py-1.5 text-sm text-white bg-blue-500 hover:bg-blue-600 rounded-lg">+ 添加模板</button>
        <span class="text-sm text-gray-400">共 {{ total }} 个模板</span>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex gap-3 mb-4 flex-wrap">
      <input
        v-model="search"
        @input="onSearch"
        placeholder="搜索标题..."
        class="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 w-full sm:w-48"
      />
      <select v-model="statusFilter" @change="onFilterChange" class="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
        <option value="">全部状态</option>
        <option value="active">active</option>
        <option value="hidden">hidden</option>
        <option value="deleted">deleted</option>
      </select>
      <select v-model="categoryFilter" @change="onFilterChange" class="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
        <option value="">全部分类</option>
        <option value="creative">creative</option>
        <option value="nicetry">nicetry</option>
      </select>
    </div>

    <div v-if="error" class="text-red-500 text-sm mb-4">{{ error }}</div>

    <div class="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <table class="w-full text-sm min-w-[700px]">
        <thead class="bg-gray-50 text-gray-500">
          <tr>
            <th class="text-left px-4 py-3 font-medium">ID</th>
            <th class="text-left px-4 py-3 font-medium">标题</th>
            <th class="text-left px-4 py-3 font-medium">作者</th>
            <th class="text-center px-4 py-3 font-medium">分类</th>
            <th class="text-right px-4 py-3 font-medium">使用</th>
            <th class="text-right px-4 py-3 font-medium">收藏</th>
            <th class="text-center px-4 py-3 font-medium">状态</th>
            <th class="text-center px-4 py-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="8" class="text-center py-8 text-gray-400">加载中...</td></tr>
          <tr v-else-if="templates.length === 0"><td colspan="8" class="text-center py-8 text-gray-400">暂无数据</td></tr>
          <tr v-for="t in templates" :key="t.id" class="border-t border-gray-100">
            <td class="px-4 py-3 text-gray-500">{{ t.id }}</td>
            <td class="px-4 py-3 text-gray-800 font-medium max-w-48 truncate">{{ t.title }}</td>
            <td class="px-4 py-3 text-gray-600">{{ t.authorName || '-' }}</td>
            <td class="px-4 py-3 text-center text-gray-500">{{ t.category }}</td>
            <td class="px-4 py-3 text-right">{{ t.use_count }}</td>
            <td class="px-4 py-3 text-right">{{ t.favorite_count }}</td>
            <td class="px-4 py-3 text-center">
              <span
                :class="{
                  'text-green-600 bg-green-50': t.status === 'active',
                  'text-gray-500 bg-gray-100': t.status === 'hidden',
                  'text-red-500 bg-red-50': t.status === 'deleted',
                }"
                class="text-xs font-medium px-2 py-0.5 rounded-full"
              >{{ t.status }}</span>
              <span v-if="t.is_pinned" class="ml-1">📌</span>
            </td>
            <td class="px-4 py-3 text-center">
              <div class="flex gap-1 justify-center flex-wrap">
                <button
                  @click="onEdit(t.id)"
                  class="px-2 py-1 text-xs rounded hover:bg-blue-50 text-blue-600 transition-colors"
                >✏️编辑</button>
                <button
                  @click="onTogglePin(t.id)"
                  class="px-2 py-1 text-xs rounded hover:bg-gray-100 transition-colors"
                  :title="t.is_pinned ? '取消置顶' : '置顶'"
                >
                  {{ t.is_pinned ? '📌取消' : '📌置顶' }}
                </button>
                <button
                  v-if="t.status !== 'deleted'"
                  @click="onToggleStatus(t.id, t.status)"
                  class="px-2 py-1 text-xs rounded hover:bg-gray-100 transition-colors"
                  :class="t.status === 'active' ? 'text-orange-600' : 'text-green-600'"
                >
                  {{ t.status === 'active' ? '隐藏' : '恢复' }}
                </button>
                <button
                  @click="onDelete(t.id, t.title)"
                  class="px-2 py-1 text-xs rounded hover:bg-red-50 text-red-500 transition-colors"
                >🗑️删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Pagination :page="page" :total="total" :limit="limit" @change="p => page = p" />

    <!-- Edit Modal -->
    <div v-if="editVisible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" @click.self="editVisible = false">
      <div class="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 class="text-lg font-bold text-gray-800">编辑模板</h3>
          <button @click="editVisible = false" class="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <div v-if="editLoading" class="py-16 text-center text-gray-400">加载中...</div>
        <div v-else class="p-6 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1">标题</label>
            <input v-model="editTitle" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1">描述</label>
            <input v-model="editDesc" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1">分类</label>
            <select v-model="editCategory" class="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="creative">creative (脑洞大开)</option>
              <option value="nicetry">nicetry (Nice Try)</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-2">格子内容 ({{ editGridSize }}×{{ editGridSize }})</label>
            <div class="grid gap-1.5" :style="{ gridTemplateColumns: `repeat(${editGridSize}, 1fr)` }">
              <textarea
                v-for="cell in editCells"
                :key="cell.position"
                v-model="cell.title"
                rows="2"
                class="px-2 py-2 border border-gray-200 rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-300 resize-none"
                :placeholder="String(cell.position + 1)"
              />
            </div>
          </div>
          <div class="flex justify-end gap-3 pt-2">
            <button @click="editVisible = false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
            <button @click="onSaveEdit" :disabled="editSaving" class="px-4 py-2 text-sm text-white bg-blue-500 hover:bg-blue-600 rounded-lg disabled:opacity-50">
              {{ editSaving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <div v-if="createVisible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" @click.self="createVisible = false">
      <div class="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 class="text-lg font-bold text-gray-800">添加模板</h3>
          <button @click="createVisible = false" class="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <div class="p-6 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-1">标题</label>
              <input v-model="createTitle" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" placeholder="模板标题" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-1">尺寸</label>
              <select v-model="createGridSize" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                <option :value="3">3×3 (9格)</option>
                <option :value="4">4×4 (16格)</option>
                <option :value="5">5×5 (25格)</option>
                <option :value="6">6×6 (36格)</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-1">描述（可选）</label>
              <input v-model="createDesc" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" placeholder="模板描述" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-1">分类</label>
              <select v-model="createCategory" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                <option value="creative">creative (脑洞大开)</option>
                <option value="nicetry">nicetry (Nice Try)</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-6">
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-1">批量填词（每行一个）</label>
              <textarea v-model="createWords" rows="12" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 font-mono" :placeholder="`输入 ${createGridSize * createGridSize} 个词，每行一个`"></textarea>
              <p class="text-xs text-gray-400 mt-1">已填 {{ createWords.split('\n').filter(w => w.trim()).length }} / {{ createGridSize * createGridSize }} 格</p>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-2">预览 ({{ createGridSize }}×{{ createGridSize }})</label>
              <div class="grid gap-1.5" :style="{ gridTemplateColumns: `repeat(${createGridSize}, 1fr)` }">
                <div
                  v-for="cell in createCells"
                  :key="cell.position"
                  class="px-1 py-2 border border-gray-200 rounded text-xs text-center overflow-hidden whitespace-pre-line"
                  :class="cell.title ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-300'"
                >
                  {{ cell.title || (cell.position + 1) }}
                </div>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-3 pt-2">
            <button @click="createVisible = false" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
            <button @click="onSaveCreate" :disabled="createSaving" class="px-4 py-2 text-sm text-white bg-blue-500 hover:bg-blue-600 rounded-lg disabled:opacity-50">
              {{ createSaving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
