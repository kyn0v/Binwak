import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { describe, it, expect } from 'vitest'
import { config } from '../src/config'
import { cleanupFiles, MAX_IMAGE_EDGE, prepareImageForStorage } from '../src/services/imageProcessing'

describe('prepareImageForStorage', () => {
  it('normalizes png uploads into bounded jpeg files', async () => {
    fs.mkdirSync(config.uploadDir, { recursive: true })

    const inputPath = path.join(config.uploadDir, `normalize-input-${Date.now()}.png`)
    await sharp({
      create: {
        width: 1600,
        height: 1200,
        channels: 4,
        background: { r: 12, g: 34, b: 56, alpha: 1 },
      },
    })
      .png()
      .toFile(inputPath)

    const prepared = await prepareImageForStorage(inputPath, 'image/png')

    try {
      expect(prepared.fileName).toMatch(/^[0-9a-f]{32}\.jpg$/)
      expect(prepared.filePath).not.toBe(inputPath)
      expect(prepared.cleanupPaths).toContain(inputPath)

      const metadata = await sharp(prepared.filePath).metadata()
      expect(metadata.format).toBe('jpeg')
      expect(metadata.width).toBeLessThanOrEqual(MAX_IMAGE_EDGE)
      expect(metadata.height).toBeLessThanOrEqual(MAX_IMAGE_EDGE)
    } finally {
      await cleanupFiles([prepared.filePath, ...prepared.cleanupPaths])
    }
  })
})
