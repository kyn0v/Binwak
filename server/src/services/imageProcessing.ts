import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { config } from '../config'

const MAX_IMAGE_EDGE = 1024
const JPEG_QUALITY = 82

const PASS_THROUGH_EXT_BY_MIME: Record<string, string> = {
  'image/gif': '.gif',
}

const NORMALIZABLE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

interface PreparedImageForStorage {
  filePath: string
  fileName: string
  cleanupPaths: string[]
}

/**
 * Verify the file's leading bytes actually match the declared image type.
 * Multer's fileFilter trusts the client-supplied Content-Type, and the GIF
 * branch below stores bytes without re-encoding, so without this check an
 * attacker could store arbitrary content under an image extension.
 */
async function assertImageMagicBytes(filePath: string, mimeType: string): Promise<void> {
  let header: Buffer
  const fh = await fs.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(12)
    const { bytesRead } = await fh.read(buf, 0, 12, 0)
    header = buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }

  const matches = (() => {
    switch (mimeType) {
      case 'image/jpeg':
        return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
      case 'image/png':
        return header.length >= 8 &&
          header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47 &&
          header[4] === 0x0d && header[5] === 0x0a && header[6] === 0x1a && header[7] === 0x0a
      case 'image/gif':
        return header.length >= 6 && header.subarray(0, 4).toString('latin1') === 'GIF8' &&
          (header[4] === 0x37 || header[4] === 0x39) && header[5] === 0x61
      case 'image/webp':
        return header.length >= 12 &&
          header.subarray(0, 4).toString('latin1') === 'RIFF' &&
          header.subarray(8, 12).toString('latin1') === 'WEBP'
      default:
        return false
    }
  })()

  if (!matches) {
    throw new Error(`Image content does not match declared type: ${mimeType}`)
  }
}

function createStorageFileName(ext: string) {
  return `${crypto.randomBytes(16).toString('hex')}${ext}`
}

export async function prepareImageForStorage(inputPath: string, mimeType: string): Promise<PreparedImageForStorage> {
  await assertImageMagicBytes(inputPath, mimeType)

  const passThroughExt = PASS_THROUGH_EXT_BY_MIME[mimeType]
  if (passThroughExt) {
    return {
      filePath: inputPath,
      fileName: createStorageFileName(passThroughExt),
      cleanupPaths: [],
    }
  }

  if (!NORMALIZABLE_MIME_TYPES.has(mimeType)) {
    throw new Error(`Unsupported image mime type: ${mimeType}`)
  }

  const outputFileName = createStorageFileName('.jpg')
  const outputPath = path.join(config.uploadDir, outputFileName)

  await sharp(inputPath)
    .rotate()
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(outputPath)

  return {
    filePath: outputPath,
    fileName: outputFileName,
    cleanupPaths: [inputPath],
  }
}

export async function cleanupFiles(paths: string[]) {
  const uniquePaths = [...new Set(paths.filter(Boolean))]
  await Promise.all(uniquePaths.map(async (filePath) => {
    try {
      await fs.unlink(filePath)
    } catch {}
  }))
}

export { MAX_IMAGE_EDGE, JPEG_QUALITY }
