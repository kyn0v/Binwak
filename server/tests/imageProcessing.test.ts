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

  it('rejects a file whose bytes do not match the declared image type', async () => {
    fs.mkdirSync(config.uploadDir, { recursive: true })
    // Non-image bytes uploaded with a spoofed image/gif content-type.
    const inputPath = path.join(config.uploadDir, `spoof-${Date.now()}.gif`)
    fs.writeFileSync(inputPath, Buffer.from('<html>not an image</html>'))

    try {
      await expect(prepareImageForStorage(inputPath, 'image/gif')).rejects.toThrow(/does not match declared type/)
    } finally {
      await cleanupFiles([inputPath])
    }
  })

  it('accepts a real GIF via the pass-through branch', async () => {
    fs.mkdirSync(config.uploadDir, { recursive: true })
    const inputPath = path.join(config.uploadDir, `real-${Date.now()}.gif`)
    // Minimal valid GIF89a header + body.
    const gif = Buffer.from('474946383961010001008000000000ffffff21f90400000000002c00000000010001000002024401003b', 'hex')
    fs.writeFileSync(inputPath, gif)

    const prepared = await prepareImageForStorage(inputPath, 'image/gif')
    try {
      expect(prepared.fileName).toMatch(/^[0-9a-f]{32}\.gif$/)
      expect(prepared.filePath).toBe(inputPath)
    } finally {
      await cleanupFiles([prepared.filePath, ...prepared.cleanupPaths])
    }
  })
})
