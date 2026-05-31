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

function createStorageFileName(ext: string) {
  return `${crypto.randomBytes(16).toString('hex')}${ext}`
}

export async function prepareImageForStorage(inputPath: string, mimeType: string): Promise<PreparedImageForStorage> {
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
