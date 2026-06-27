import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePhotoNotice } from '../src/pages/index/usePhotoNotice'

// In-memory stub for uni storage (safeStorage wraps uni.getStorageSync/setStorageSync).
const store = new Map<string, unknown>()
;(globalThis as any).uni = {
  getStorageSync: (k: string) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k: string, v: unknown) => { store.set(k, v) },
  removeStorageSync: (k: string) => { store.delete(k) },
}

const DISMISS_KEY = 'binwak-photo-notice-shown'

describe('usePhotoNotice', () => {
  beforeEach(() => { store.clear() })

  it('opens the modal and resolves true when the user confirms', async () => {
    const pn = usePhotoNotice()
    expect(pn.showPhotoNotice.value).toBe(false)

    const consent = pn.requirePhotoConsent()
    // Modal is shown while awaiting the user's choice.
    expect(pn.showPhotoNotice.value).toBe(true)
    expect(pn.photoNoticeDontShow.value).toBe(false)

    pn.confirmPhotoNotice()
    await expect(consent).resolves.toBe(true)
    expect(pn.showPhotoNotice.value).toBe(false)
  })

  it('resolves false when the user cancels', async () => {
    const pn = usePhotoNotice()
    const consent = pn.requirePhotoConsent()
    expect(pn.showPhotoNotice.value).toBe(true)

    pn.cancelPhotoNotice()
    await expect(consent).resolves.toBe(false)
    expect(pn.showPhotoNotice.value).toBe(false)
  })

  it('persists "don\'t show again" and then skips the modal', async () => {
    const pn = usePhotoNotice()
    const consent = pn.requirePhotoConsent()
    pn.photoNoticeDontShow.value = true
    pn.confirmPhotoNotice()
    await consent
    expect(store.get(DISMISS_KEY)).toBe(true)

    // A fresh instance must now auto-consent without opening the modal.
    const pn2 = usePhotoNotice()
    const consent2 = pn2.requirePhotoConsent()
    expect(pn2.showPhotoNotice.value).toBe(false)
    await expect(consent2).resolves.toBe(true)
  })

  it('does NOT persist when confirming without ticking the box', async () => {
    const pn = usePhotoNotice()
    const consent = pn.requirePhotoConsent()
    pn.confirmPhotoNotice() // dontShow stays false
    await consent
    expect(store.has(DISMISS_KEY)).toBe(false)
  })

  it('resets the checkbox each time the modal is reopened', async () => {
    const pn = usePhotoNotice()
    // First open, tick the box, cancel (so it isn't persisted).
    let consent = pn.requirePhotoConsent()
    pn.photoNoticeDontShow.value = true
    pn.cancelPhotoNotice()
    await consent
    // Reopen — checkbox must be back to unchecked.
    consent = pn.requirePhotoConsent()
    expect(pn.photoNoticeDontShow.value).toBe(false)
    pn.cancelPhotoNotice()
    await consent
  })
})
