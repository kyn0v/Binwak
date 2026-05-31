<script setup lang="ts">
defineProps<{
  title: string
  value: string | number
  subtitle?: string
  color?: string
}>()
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 p-5">
    <p class="text-sm text-gray-500 mb-1">{{ title }}</p>
    <p class="text-2xl font-bold" :class="color || 'text-gray-800'">{{ value }}</p>
    <p v-if="subtitle" class="text-xs text-gray-400 mt-1">{{ subtitle }}</p>
  </div>
</template>
