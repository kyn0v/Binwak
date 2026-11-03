import { readonly, ref } from 'vue'
import * as api from './api'

type ImageMode = 'local' | 'cloud'
type Preference = { mode: ImageMode; pending: boolean }
const imageMode = ref<ImageMode>('local')
let owner: string | null = null
let preference: Preference = { mode: 'local', pending: false }
let revision = 0
const key = (principal: string) => `binwak-photo-preference-v1/${encodeURIComponent(principal)}`

function bindOwner(principal: string | null) {
  if (owner === principal) return
  imageMode.value = 'local'
  preference = { mode: 'local', pending: false }
  if (!principal) { owner = null; return }
  const saved: unknown = uni.getStorageSync(key(principal))
  if (saved === '' || saved === undefined || saved === null) { owner = principal; return }
  if (typeof saved !== 'object' || !('mode' in saved) || !('pending' in saved) || (saved.mode !== 'local' && saved.mode !== 'cloud') || typeof saved.pending !== 'boolean') {
    throw new Error('照片偏好无法读取，已暂停云端照片模式')
  }
  owner = principal
  preference = { mode: saved.mode, pending: saved.pending }
  imageMode.value = preference.mode
}
function save(principal: string, next: Preference) {
  uni.setStorageSync(key(principal), next)
  preference = next
  imageMode.value = next.mode
}
function capturePreference() {
  bindOwner(api.getLastPrincipal())
  return { auth: api.getAuthScope(), revision }
}
type PreferenceFence = ReturnType<typeof capturePreference>
function current(fence: PreferenceFence) {
  return api.isAuthScopeCurrent(fence.auth) && fence.revision === revision
}
function parseProfile(profile: unknown): { principal: string; mode: ImageMode } {
  if (typeof profile !== 'object' || profile === null || !('userId' in profile) || typeof profile.userId !== 'number' || !Number.isSafeInteger(profile.userId) || profile.userId <= 0 || !('imageStorage' in profile) || (profile.imageStorage !== 'local' && profile.imageStorage !== 'cloud')) throw new Error('照片偏好响应无效')
  return { principal: `${api.SERVICE_ID}/account/${profile.userId}`, mode: profile.imageStorage }
}
function hydratePreference(profile: unknown, fence: PreferenceFence) {
  if (!current(fence)) return
  const parsed = parseProfile(profile)
  if (fence.auth.principal && parsed.principal !== fence.auth.principal) throw new Error('照片偏好账号不一致')
  bindOwner(parsed.principal)
  if (!preference.pending) save(parsed.principal, { mode: parsed.mode, pending: false })
}
async function setImageMode(mode: ImageMode, fence = capturePreference()): Promise<boolean> {
  if (!api.isAuthScopeCurrent(fence.auth)) return false
  const principal = fence.auth.principal
  if (!principal || !api.isLoggedIn()) throw new Error('请先联网验证账号，再修改照片偏好')
  bindOwner(principal)
  revision++
  const choice = { auth: fence.auth, revision }
  // Keep an explicit choice across failed requests and restarts, instead of accepting an older GET.
  if (mode === 'local') { preference = { mode, pending: true }; imageMode.value = mode }
  save(principal, { mode, pending: true })
  const profile = await api.updateImageStorage(mode)
  if (!current(choice)) return false
  const parsed = parseProfile(profile)
  if (parsed.principal !== principal || parsed.mode !== mode) throw new Error('照片偏好响应与本次选择不一致')
  revision++
  save(principal, { mode, pending: false })
  return true
}
api.onAuthChange(() => {
  revision++
  try { bindOwner(api.getLastPrincipal()) } catch { imageMode.value = 'local' }
})
export function usePhotoPreference() {
  try { bindOwner(api.getLastPrincipal()) } catch { imageMode.value = 'local' }
  return { imageMode: readonly(imageMode), capturePreference, hydratePreference, setImageMode }
}
