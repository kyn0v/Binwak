// ============================================
// Binwak — user authentication composable
// ============================================
import { ref } from 'vue'
import { login as apiLogin, logout as apiLogout, isLoggedIn as apiIsLoggedIn, onLoginStateChange } from './api'

const loggedIn = ref(false)
const isLoggingIn = ref(false)
/** Offline reason (empty string means online) */
const offlineReason = ref('')

// Register a callback so reactive state stays in sync with the api-layer token
onLoginStateChange((state) => {
  loggedIn.value = state
  if (state) offlineReason.value = ''
})

export function useAuth() {
  /**
   * Attempt silent login (if not already logged in).
   * Returns true if login succeeded or the user was already logged in.
   */
  async function ensureLoggedIn(): Promise<boolean> {
    if (apiIsLoggedIn()) {
      loggedIn.value = true
      offlineReason.value = ''
      return true
    }

    if (isLoggingIn.value) return false

    isLoggingIn.value = true
    try {
      await apiLogin()
      loggedIn.value = true
      offlineReason.value = ''
      return true
    } catch (err: any) {
      console.warn('[Auth] 登录失败:', err)
      loggedIn.value = false
      // Extract a meaningful error reason
      if (err?.errMsg?.includes?.('request:fail')) {
        offlineReason.value = '无法连接服务器，请检查网络'
      } else if (err?.errMsg?.includes?.('login:fail')) {
        offlineReason.value = '微信登录失败，请重试'
      } else if (err?.message) {
        offlineReason.value = err.message
      } else {
        offlineReason.value = '登录失败，数据仅保存在本地'
      }
      return false
    } finally {
      isLoggingIn.value = false
    }
  }

  function logout() {
    apiLogout()
    loggedIn.value = false
    offlineReason.value = ''
  }

  return {
    loggedIn,
    isLoggingIn,
    offlineReason,
    ensureLoggedIn,
    logout,
  }
}
