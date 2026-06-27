import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { useBoardSwitcher } from '../src/pages/index/useBoardSwitcher'

const toasts: string[] = []
const navs: string[] = []
;(globalThis as any).uni = {
  showToast: (o: { title: string }) => { toasts.push(o.title) },
  navigateTo: (o: { url: string }) => { navs.push(o.url) },
}

describe('useBoardSwitcher', () => {
  beforeEach(() => { toasts.length = 0; navs.length = 0 })

  it('openBoardSwitcher requires login', () => {
    const b = useBoardSwitcher({ loggedIn: ref(false) })
    b.openBoardSwitcher()
    expect(b.showBoardSwitcher.value).toBe(false)
    expect(toasts).toContain('请先登录')
  })

  it('openBoardSwitcher toggles open/closed when logged in', () => {
    const b = useBoardSwitcher({ loggedIn: ref(true) })
    b.openBoardSwitcher()
    expect(b.showBoardSwitcher.value).toBe(true)
    b.openBoardSwitcher() // second tap closes
    expect(b.showBoardSwitcher.value).toBe(false)
  })

  it('closeBoardSwitcher collapses both the dropdown and the size picker', () => {
    const b = useBoardSwitcher({ loggedIn: ref(true) })
    b.openBoardSwitcher()
    b.toggleSizePicker()
    expect(b.showSizePicker.value).toBe(true)
    b.closeBoardSwitcher()
    expect(b.showBoardSwitcher.value).toBe(false)
    expect(b.showSizePicker.value).toBe(false)
  })

  it('toggleSizePicker flips the nested picker', () => {
    const b = useBoardSwitcher({ loggedIn: ref(true) })
    expect(b.showSizePicker.value).toBe(false)
    b.toggleSizePicker()
    expect(b.showSizePicker.value).toBe(true)
    b.toggleSizePicker()
    expect(b.showSizePicker.value).toBe(false)
  })

  it('goToBoards closes the dropdown and navigates', () => {
    const b = useBoardSwitcher({ loggedIn: ref(true) })
    b.openBoardSwitcher()
    b.goToBoards()
    expect(b.showBoardSwitcher.value).toBe(false)
    expect(navs).toContain('/pages/boards/boards')
  })

  it('reacts to a login state that flips at runtime', () => {
    const loggedIn = ref(false)
    const b = useBoardSwitcher({ loggedIn })
    b.openBoardSwitcher()
    expect(b.showBoardSwitcher.value).toBe(false)
    loggedIn.value = true
    b.openBoardSwitcher()
    expect(b.showBoardSwitcher.value).toBe(true)
  })
})
