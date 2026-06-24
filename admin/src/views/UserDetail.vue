<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getUserDetail, deleteUser } from '../api'

const props = defineProps<{ id: string }>()
const router = useRouter()
const data = ref<any>(null)
const loading = ref(true)
const error = ref('')
const deleting = ref(false)

onMounted(async () => {
  try {
    data.value = await getUserDetail(Number(props.id))
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

async function onDelete() {
  const u = data.value?.user
  if (!u) return
  const label = u.nickname || `用户 #${u.id}`
  if (!window.confirm(`确定删除「${label}」及其全部数据（Bingo 卡、模板、词库、插画、收藏等）？\n此操作不可恢复。`)) return
  deleting.value = true
  try {
    await deleteUser(Number(props.id))
    router.push('/users')
  } catch (e: any) {
    window.alert(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

function formatDate(d: string) {
  return d ? d.replace('T', ' ').slice(0, 16) : '-'
}
</script>

<template>
  <div>
    <button @click="router.push('/users')" class="text-sm text-blue-600 hover:underline mb-4 inline-block">
      ← 返回用户列表
    </button>

    <div v-if="loading" class="text-gray-400 text-sm">加载中...</div>
    <div v-else-if="error" class="text-red-500 text-sm">{{ error }}</div>
    <div v-else-if="data">
      <!-- User info -->
      <div class="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div class="flex items-center gap-4 mb-3">
          <h2 class="text-lg font-bold text-gray-800">{{ data.user.nickname || '(未设置昵称)' }}</h2>
          <span class="text-sm text-gray-400">ID: {{ data.user.id }}</span>
          <button
            @click="onDelete"
            :disabled="deleting"
            class="ml-auto px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ deleting ? '删除中…' : '删除用户' }}
          </button>
        </div>
        <div class="flex gap-6 text-sm text-gray-500">
          <span>注册: {{ formatDate(data.user.created_at) }}</span>
          <span>最后活跃: {{ formatDate(data.user.updated_at) }}</span>
          <span>词库: {{ data.wordCount }} 词</span>
          <span>插画: {{ data.illustrationCount }} 张</span>
        </div>
      </div>

      <!-- Boards -->
      <h3 class="text-sm font-bold text-gray-700 mb-2">Bingo 卡 ({{ data.boards.length }})</h3>
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-gray-500">
            <tr>
              <th class="text-left px-4 py-2 font-medium">ID</th>
              <th class="text-left px-4 py-2 font-medium">标题</th>
              <th class="text-center px-4 py-2 font-medium">尺寸</th>
              <th class="text-center px-4 py-2 font-medium">主题</th>
              <th class="text-right px-4 py-2 font-medium">进度</th>
              <th class="text-center px-4 py-2 font-medium">状态</th>
              <th class="text-left px-4 py-2 font-medium">更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="data.boards.length === 0"><td colspan="7" class="text-center py-6 text-gray-400">暂无</td></tr>
            <tr v-for="b in data.boards" :key="b.id" class="border-t border-gray-100">
              <td class="px-4 py-2 text-gray-500">{{ b.id }}</td>
              <td class="px-4 py-2 text-gray-800">{{ b.title }}</td>
              <td class="px-4 py-2 text-center">{{ b.grid_size }}×{{ b.grid_size }}</td>
              <td class="px-4 py-2 text-center">{{ b.theme }}</td>
              <td class="px-4 py-2 text-right">{{ b.completedCount }}/{{ b.totalCells }}</td>
              <td class="px-4 py-2 text-center">
                <span v-if="b.is_active" class="text-green-600 text-xs font-medium">活跃</span>
                <span v-if="b.is_favorite" class="text-yellow-500 text-xs ml-1">★</span>
              </td>
              <td class="px-4 py-2 text-gray-500 text-xs">{{ formatDate(b.updated_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Templates -->
      <h3 class="text-sm font-bold text-gray-700 mb-2">发布的模板 ({{ data.templates.length }})</h3>
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-gray-500">
            <tr>
              <th class="text-left px-4 py-2 font-medium">ID</th>
              <th class="text-left px-4 py-2 font-medium">标题</th>
              <th class="text-center px-4 py-2 font-medium">分类</th>
              <th class="text-right px-4 py-2 font-medium">使用</th>
              <th class="text-right px-4 py-2 font-medium">收藏</th>
              <th class="text-center px-4 py-2 font-medium">状态</th>
              <th class="text-left px-4 py-2 font-medium">创建时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="data.templates.length === 0"><td colspan="7" class="text-center py-6 text-gray-400">暂无</td></tr>
            <tr v-for="t in data.templates" :key="t.id" class="border-t border-gray-100">
              <td class="px-4 py-2 text-gray-500">{{ t.id }}</td>
              <td class="px-4 py-2 text-gray-800">{{ t.title }}</td>
              <td class="px-4 py-2 text-center">{{ t.category }}</td>
              <td class="px-4 py-2 text-right">{{ t.use_count }}</td>
              <td class="px-4 py-2 text-right">{{ t.favorite_count }}</td>
              <td class="px-4 py-2 text-center">
                <span :class="t.status === 'active' ? 'text-green-600' : 'text-gray-400'" class="text-xs font-medium">{{ t.status }}</span>
                <span v-if="t.is_pinned" class="text-orange-500 text-xs ml-1">📌</span>
              </td>
              <td class="px-4 py-2 text-gray-500 text-xs">{{ formatDate(t.created_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
