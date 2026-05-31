<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { clearToken } from '../api'

const route = useRoute()
const router = useRouter()

const isMobile = ref(window.innerWidth < 768)
const sidebarOpen = ref(!isMobile.value)

function onResize() {
  isMobile.value = window.innerWidth < 768
  if (isMobile.value) sidebarOpen.value = false
}

onMounted(() => window.addEventListener('resize', onResize))
onUnmounted(() => window.removeEventListener('resize', onResize))

const navItems = [
  { path: '/', label: '📊 数据概览', icon: '' },
  { path: '/users', label: '👥 用户管理', icon: '' },
  { path: '/templates', label: '📋 模板管理', icon: '' },
  { path: '/wordbank', label: '📚 词库管理', icon: '' },
  { path: '/generate', label: '✨ 生成模板', icon: '' },
  { path: '/system', label: '⚙️ 系统信息', icon: '' },
]

const currentPath = computed(() => route.path)

function onNavClick() {
  if (isMobile.value) sidebarOpen.value = false
}

function logout() {
  clearToken()
  router.push('/login')
}
</script>

<template>
  <div class="flex h-screen bg-gray-50">
    <!-- Mobile overlay -->
    <div
      v-if="isMobile && sidebarOpen"
      class="fixed inset-0 bg-black/30 z-20"
      @click="sidebarOpen = false"
    ></div>

    <!-- Sidebar -->
    <aside
      class="flex flex-col bg-white border-r border-gray-200 transition-all duration-200 shrink-0"
      :class="[
        sidebarOpen ? 'w-56' : 'w-0 overflow-hidden',
        isMobile ? 'fixed inset-y-0 left-0 z-30' : ''
      ]"
    >
      <div class="p-4 border-b border-gray-100">
        <h1 class="text-lg font-bold text-gray-800 whitespace-nowrap">🎯 CWB Admin</h1>
      </div>
      <nav class="flex-1 p-2 space-y-1">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="block px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap"
          :class="currentPath === item.path
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-gray-600 hover:bg-gray-100'"
          @click="onNavClick"
        >
          {{ item.label }}
        </router-link>
      </nav>
      <div class="p-2 border-t border-gray-100">
        <button
          @click="logout"
          class="w-full px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors text-left whitespace-nowrap"
        >
          🚪 退出登录
        </button>
      </div>
    </aside>

    <!-- Main content -->
    <div class="flex-1 flex flex-col overflow-hidden min-w-0">
      <header class="flex items-center h-14 px-4 bg-white border-b border-gray-200 shrink-0">
        <button
          @click="sidebarOpen = !sidebarOpen"
          class="p-1 mr-3 rounded hover:bg-gray-100 text-gray-500"
        >
          ☰
        </button>
        <span class="text-sm text-gray-400">Binwak 管理后台</span>
      </header>
      <main class="flex-1 overflow-y-auto p-4 md:p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
