<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login } from '../api'

const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    await login(username.value, password.value)
    router.push('/')
  } catch (e: any) {
    error.value = e.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <form
      @submit.prevent="handleLogin"
      class="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm"
    >
      <h1 class="text-xl font-bold text-gray-800 mb-1">🎯 CWB Admin</h1>
      <p class="text-sm text-gray-400 mb-6">Binwak 管理后台</p>

      <div v-if="error" class="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">
        {{ error }}
      </div>

      <label class="block mb-4">
        <span class="text-sm text-gray-600">用户名</span>
        <input
          v-model="username"
          type="text"
          autocomplete="username"
          required
          class="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
      </label>

      <label class="block mb-6">
        <span class="text-sm text-gray-600">密码</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          class="mt-1 block w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
      </label>

      <button
        type="submit"
        :disabled="loading"
        class="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {{ loading ? '登录中...' : '登录' }}
      </button>
    </form>
  </div>
</template>
