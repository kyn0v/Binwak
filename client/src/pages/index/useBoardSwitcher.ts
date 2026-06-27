/**
 * useBoardSwitcher
 *
 * Owns the header "board switcher" dropdown (the menu under the board name that
 * hosts 管理全部卡片 / 创建卡片 / 编辑 / 预览 / 分享). Encapsulates:
 *  - the dropdown open state (`showBoardSwitcher`) and the nested size-picker
 *    open state (`showSizePicker`),
 *  - opening (login-gated toggle), closing (also collapses the size picker),
 *  - navigation to the full boards-management page.
 *
 * The dropdown no longer lists boards, so opening it is a pure toggle — no
 * server fetch. `loggedIn` is injected for the login gate.
 */
import { ref, type Ref } from 'vue'

export interface UseBoardSwitcherDeps {
  loggedIn: Ref<boolean>
}

export function useBoardSwitcher(deps: UseBoardSwitcherDeps) {
  const { loggedIn } = deps

  const showBoardSwitcher = ref(false)
  const showSizePicker = ref(false)

  function closeBoardSwitcher() {
    showBoardSwitcher.value = false
    showSizePicker.value = false
  }

  /** Login-gated toggle of the dropdown. */
  function openBoardSwitcher() {
    if (!loggedIn.value) {
      uni.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    if (showBoardSwitcher.value) {
      closeBoardSwitcher()
      return
    }
    showBoardSwitcher.value = true
  }

  function toggleSizePicker() {
    showSizePicker.value = !showSizePicker.value
  }

  function goToBoards() {
    closeBoardSwitcher()
    uni.navigateTo({ url: '/pages/boards/boards' })
  }

  return {
    showBoardSwitcher,
    showSizePicker,
    openBoardSwitcher,
    closeBoardSwitcher,
    toggleSizePicker,
    goToBoards,
  }
}
