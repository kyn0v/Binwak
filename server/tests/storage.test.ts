import { describe, expect, it } from 'vitest'
import { validateStorageKey } from '../src/services/storage'

describe('validateStorageKey', () => {
  it('accepts namespaced object keys', () => {
    expect(() => validateStorageKey('photos/u1/abc.jpg')).not.toThrow()
    expect(() => validateStorageKey('illustrations/u1/abc.jpg')).not.toThrow()
  })

  it('rejects traversal, absolute paths, and null bytes', () => {
    expect(() => validateStorageKey('../secret.jpg')).toThrow()
    expect(() => validateStorageKey('photos/u1/../../secret.jpg')).toThrow()
    expect(() => validateStorageKey('/etc/passwd')).toThrow()
    expect(() => validateStorageKey('photos/u1/a\0.jpg')).toThrow()
  })
})
