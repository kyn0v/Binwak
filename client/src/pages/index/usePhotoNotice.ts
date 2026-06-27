/**
 * usePhotoNotice
 *
 * Owns the one-shot "photo privacy" confirmation modal shown before the user
 * picks a photo in cloud (upload) mode. Encapsulates:
 *  - the modal's reactive state (`showPhotoNotice`, `photoNoticeDontShow`),
 *  - the "don't show again" persisted flag (STORAGE_KEYS.PHOTO_NOTICE_SHOWN),
 *  - the promise dance that resolves when the user confirms/cancels.
 *
 * Usage in the page:
 *   const { showPhotoNotice, photoNoticeDontShow,
 *           requirePhotoConsent, confirmPhotoNotice, cancelPhotoNotice } = usePhotoNotice()
 *   // before uploading a photo:
 *   if (!(await requirePhotoConsent())) return   // user declined
 *   // template binds showPhotoNotice / photoNoticeDontShow and the two handlers.
 */
import { ref } from 'vue'
import { STORAGE_KEYS } from '@/config/storageKeys'
import { safeGet, safeSet } from '@/utils/safeStorage'

const PHOTO_NOTICE_KEY = STORAGE_KEYS.PHOTO_NOTICE_SHOWN

export function usePhotoNotice() {
  const showPhotoNotice = ref(false)
  const photoNoticeDontShow = ref(false)
  let resolveConsent: ((confirmed: boolean) => void) | null = null

  /** True once the user has ticked "don't show again" on a prior confirm. */
  function isDismissed(): boolean {
    return Boolean(safeGet(PHOTO_NOTICE_KEY))
  }

  /**
   * Ensure the user has consented to the photo-privacy notice.
   * Resolves immediately with `true` if the notice was previously dismissed;
   * otherwise opens the modal and resolves with the user's choice
   * (true = 我知道了, false = 取消).
   */
  function requirePhotoConsent(): Promise<boolean> {
    if (isDismissed()) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      photoNoticeDontShow.value = false
      resolveConsent = resolve
      showPhotoNotice.value = true
    })
  }

  function confirmPhotoNotice() {
    if (photoNoticeDontShow.value) {
      safeSet(PHOTO_NOTICE_KEY, true)
    }
    showPhotoNotice.value = false
    resolveConsent?.(true)
    resolveConsent = null
  }

  function cancelPhotoNotice() {
    showPhotoNotice.value = false
    resolveConsent?.(false)
    resolveConsent = null
  }

  return {
    showPhotoNotice,
    photoNoticeDontShow,
    requirePhotoConsent,
    confirmPhotoNotice,
    cancelPhotoNotice,
  }
}
