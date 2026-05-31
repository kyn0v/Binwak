<script setup lang="ts">
defineProps<{
  page: number
  total: number
  limit: number
}>()

const emit = defineEmits<{
  change: [page: number]
}>()
</script>

<template>
  <div class="flex items-center justify-between text-sm text-gray-500 mt-4">
    <span>共 {{ total }} 条</span>
    <div class="flex items-center gap-2">
      <button
        :disabled="page <= 1"
        @click="emit('change', page - 1)"
        class="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        上一页
      </button>
      <span>{{ page }} / {{ Math.ceil(total / limit) || 1 }}</span>
      <button
        :disabled="page * limit >= total"
        @click="emit('change', page + 1)"
        class="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        下一页
      </button>
    </div>
  </div>
</template>
