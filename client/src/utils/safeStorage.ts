/**
 * safeStorage — safe wrapper around local storage
 *
 * All uni storage calls go through here so that storage exceptions
 * (quota exceeded, serialization failure, etc.) never crash the app.
 */

const TAG = '[Storage]'

export function safeGet<T = unknown>(key: string): T | undefined {
  try {
    const v = uni.getStorageSync(key)
    return (v === '' || v === null) ? undefined : (v as T)
  } catch (err) {
    console.warn(TAG, `读取失败 key="${key}"`, err)
    return undefined
  }
}

export function safeSet(key: string, value: unknown): boolean {
  try {
    uni.setStorageSync(key, value)
    return true
  } catch (err) {
    console.warn(TAG, `写入失败 key="${key}"`, err)
    return false
  }
}

export function safeRemove(key: string): boolean {
  try {
    uni.removeStorageSync(key)
    return true
  } catch (err) {
    console.warn(TAG, `删除失败 key="${key}"`, err)
    return false
  }
}
