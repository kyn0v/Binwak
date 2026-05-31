<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getSystemInfo } from '../api'
import StatsCard from '../components/StatsCard.vue'

const info = ref<any>(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    info.value = await getSystemInfo()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}天 ${h}时`
  if (h > 0) return `${h}时 ${m}分`
  return `${m}分`
}
</script>

<template>
  <div>
    <h2 class="text-lg font-bold text-gray-800 mb-4">系统信息</h2>

    <div v-if="loading" class="text-gray-400 text-sm">加载中...</div>
    <div v-else-if="error" class="text-red-500 text-sm">{{ error }}</div>
    <div v-else-if="info">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatsCard title="运行时间" :value="formatUptime(info.uptime)" />
        <StatsCard title="Node 版本" :value="info.nodeVersion" />
        <StatsCard title="存储驱动" :value="info.storageDriver" />
        <StatsCard title="数据库大小" :value="formatBytes(info.dbSizeBytes)" />
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatsCard title="上传文件数" :value="info.uploadsFileCount" />
        <StatsCard title="上传文件大小" :value="formatBytes(info.uploadsSizeBytes)" />
        <StatsCard title="内存使用 (RSS)" :value="formatBytes(info.memoryUsage.rss)" />
      </div>

      <div class="bg-white rounded-xl border border-gray-200 p-5">
        <h3 class="text-sm font-medium text-gray-600 mb-3">内存详情</h3>
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div class="flex justify-between">
            <span class="text-gray-500">Heap Used</span>
            <span class="text-gray-800 font-medium">{{ formatBytes(info.memoryUsage.heapUsed) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">Heap Total</span>
            <span class="text-gray-800 font-medium">{{ formatBytes(info.memoryUsage.heapTotal) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">External</span>
            <span class="text-gray-800 font-medium">{{ formatBytes(info.memoryUsage.external) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">RSS</span>
            <span class="text-gray-800 font-medium">{{ formatBytes(info.memoryUsage.rss) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
