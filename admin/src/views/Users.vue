<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getUsers } from '../api'
import Pagination from '../components/Pagination.vue'

const router = useRouter()
const users = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(20)
const search = ref('')
const loading = ref(false)
const error = ref('')

let searchTimer: ReturnType<typeof setTimeout>

async function fetchUsers() {
  loading.value = true
  error.value = ''
  try {
    const data = await getUsers({ page: page.value, limit: limit.value, search: search.value })
    users.value = data.users
    total.value = data.total
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    fetchUsers()
  }, 300)
}

watch(page, fetchUsers)
onMounted(fetchUsers)

function formatDate(d: string) {
  return d ? d.replace('T', ' ').slice(0, 16) : '-'
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold text-gray-800">用户管理</h2>
      <span class="text-sm text-gray-400">共 {{ total }} 个用户</span>
    </div>

    <div class="mb-4">
      <input
        v-model="search"
        @input="onSearch"
        placeholder="搜索昵称或 ID..."
        class="w-full max-w-xs px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
    </div>

    <div v-if="error" class="text-red-500 text-sm mb-4">{{ error }}</div>

    <div class="bg-white rounded-xl border border-gray-200 overflow-x-auto">
      <table class="w-full text-sm min-w-[600px]">
        <thead class="bg-gray-50 text-gray-500">
          <tr>
            <th class="text-left px-4 py-3 font-medium">ID</th>
            <th class="text-left px-4 py-3 font-medium">昵称</th>
            <th class="text-right px-4 py-3 font-medium">Boards</th>
            <th class="text-right px-4 py-3 font-medium">模板</th>
            <th class="text-right px-4 py-3 font-medium">词库</th>
            <th class="text-right px-4 py-3 font-medium">插画</th>
            <th class="text-left px-4 py-3 font-medium">注册时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="7" class="text-center py-8 text-gray-400">加载中...</td>
          </tr>
          <tr v-else-if="users.length === 0">
            <td colspan="7" class="text-center py-8 text-gray-400">暂无数据</td>
          </tr>
          <tr
            v-for="u in users"
            :key="u.id"
            @click="router.push(`/users/${u.id}`)"
            class="border-t border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
          >
            <td class="px-4 py-3 text-gray-500">{{ u.id }}</td>
            <td class="px-4 py-3 font-medium text-gray-800">{{ u.nickname || '(未设置)' }}</td>
            <td class="px-4 py-3 text-right">{{ u.boardCount }}</td>
            <td class="px-4 py-3 text-right">{{ u.templateCount }}</td>
            <td class="px-4 py-3 text-right">{{ u.wordCount }}</td>
            <td class="px-4 py-3 text-right">{{ u.illustrationCount }}</td>
            <td class="px-4 py-3 text-gray-500">{{ formatDate(u.created_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Pagination :page="page" :total="total" :limit="limit" @change="p => page = p" />
  </div>
</template>
