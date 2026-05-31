<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getStats } from '../api'
import StatsCard from '../components/StatsCard.vue'

const stats = ref<any>(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    stats.value = await getStats()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

function formatNumber(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
</script>

<template>
  <div>
    <h2 class="text-lg font-bold text-gray-800 mb-4">数据概览</h2>

    <div v-if="loading" class="text-gray-400 text-sm">加载中...</div>
    <div v-else-if="error" class="text-red-500 text-sm">{{ error }}</div>
    <div v-else-if="stats">
      <!-- Metric cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatsCard title="总用户" :value="formatNumber(stats.users.totalUsers)" color="text-blue-600" />
        <StatsCard title="7 日活跃" :value="formatNumber(stats.users.activeUsers7d)" :subtitle="`今日 ${stats.users.activeUsers1d}`" color="text-green-600" />
        <StatsCard title="总 Boards" :value="formatNumber(stats.boards.totalBoards)" :subtitle="`使用中 ${stats.boards.activeBoards}`" />
        <StatsCard title="模板" :value="formatNumber(stats.templates.activeTemplates)" :subtitle="`使用 ${stats.templates.totalUses} 次`" color="text-purple-600" />
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Daily new users (simple bar chart) -->
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <h3 class="text-sm font-medium text-gray-600 mb-3">近 30 天新增用户</h3>
          <div v-if="stats.dailyNewUsers.length === 0" class="text-gray-400 text-sm">暂无数据</div>
          <div v-else class="flex items-end gap-px h-32">
            <div
              v-for="day in stats.dailyNewUsers"
              :key="day.date"
              class="flex-1 bg-blue-400 hover:bg-blue-500 rounded-t-sm transition-colors cursor-default group relative"
              :style="{ height: `${Math.max(4, (day.count / Math.max(...stats.dailyNewUsers.map((d: any) => d.count))) * 100)}%` }"
              :title="`${day.date}: ${day.count} 人`"
            />
          </div>
          <div class="flex justify-between text-xs text-gray-400 mt-1">
            <span>{{ stats.dailyNewUsers[0]?.date?.slice(5) }}</span>
            <span>{{ stats.dailyNewUsers[stats.dailyNewUsers.length - 1]?.date?.slice(5) }}</span>
          </div>
        </div>

        <!-- Category distribution -->
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <h3 class="text-sm font-medium text-gray-600 mb-3">模板分类分布</h3>
          <div class="space-y-2">
            <div v-for="cat in stats.categoryDistribution" :key="cat.category" class="flex items-center gap-3">
              <span class="text-sm text-gray-600 w-16">{{ cat.category }}</span>
              <div class="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                <div
                  class="h-full bg-purple-400 rounded-full flex items-center justify-end pr-2"
                  :style="{ width: `${Math.max(8, (cat.count / Math.max(...stats.categoryDistribution.map((c: any) => c.count))) * 100)}%` }"
                >
                  <span class="text-xs text-white font-medium">{{ cat.count }}</span>
                </div>
              </div>
              <span class="text-xs text-gray-400 w-16 text-right">{{ cat.totalUses }} 次使用</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Extra stats row -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <StatsCard title="30 天新用户" :value="formatNumber(stats.users.newUsers30d)" color="text-blue-600" />
        <StatsCard title="插画总数" :value="formatNumber(stats.illustrations.totalIllustrations)" />
      </div>
    </div>
  </div>
</template>
