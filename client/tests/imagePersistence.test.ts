import { describe, expect, it, vi } from 'vitest'
import { saveImage } from '../src/pages/index/imageTools'

describe('permanent photo save', () => {
  it('rejects a failed permanent save instead of reporting a temporary file as saved', async () => {
    vi.stubGlobal('uni', { getFileSystemManager: () => ({ saveFile: ({ fail }: { fail: (error: unknown) => void }) => fail(new Error('quota')) }) })
    await expect(saveImage('wxfile://temporary/photo')).rejects.toThrow('照片未能保存')
  })
  it('returns the permanent platform path', async () => {
    vi.stubGlobal('uni', { getFileSystemManager: () => ({ saveFile: ({ success }: { success: (result: unknown) => void }) => success({ savedFilePath: 'wxfile://saved/photo' }) }) })
    expect(await saveImage('wxfile://temporary/photo')).toBe('wxfile://saved/photo')
  })
})
