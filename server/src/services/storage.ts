/**
 * Storage abstraction layer
 *
 * Supports local filesystem and OSS (Alibaba Cloud).
 * Set STORAGE_DRIVER=oss in env to enable OSS.
 *
 * Note: OSS driver requires `ali-oss` package:
 *   npm install ali-oss @types/ali-oss
 */
import fs from 'fs'
import path from 'path'
import { config } from '../config'

export interface StorageResult {
  /** Public-facing URL or path */
  url: string
  /** Storage key (filename for local, object key for OSS) */
  key: string
}

export interface StorageDriver {
  save(filePath: string, fileName: string): Promise<StorageResult>
  /** Save with an explicit object key (no prefix prepending) */
  saveAs(filePath: string, objectKey: string): Promise<StorageResult>
  /** Copy an object to a new key */
  copy(srcKey: string, destKey: string): Promise<void>
  delete(key: string): Promise<void>
  getUrl(key: string): string
  /** Generate a time-limited signed URL for private object access. Falls back to getUrl for local driver. */
  getPresignedUrl(key: string, expiresSeconds?: number): string
}

/**
 * Reject keys that would escape the storage namespace.
 * Used by all drivers (especially LocalDriver where keys map to fs paths).
 * Throws on null bytes, absolute paths, or `..` segments.
 */
export function validateStorageKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('Invalid storage key: must be non-empty string')
  }
  if (key.includes('\0')) {
    throw new Error('Invalid storage key: null byte')
  }
  if (path.isAbsolute(key)) {
    throw new Error('Invalid storage key: absolute path')
  }
  // Reject any `..` segment in either POSIX or Windows form.
  const segments = key.split(/[/\\]+/)
  if (segments.some((s) => s === '..')) {
    throw new Error('Invalid storage key: path traversal')
  }
}

// ── Local storage driver ──
class LocalDriver implements StorageDriver {
  async save(filePath: string, fileName: string): Promise<StorageResult> {
    validateStorageKey(fileName)
    const targetPath = path.join(config.storage.localDir, fileName)
    if (path.resolve(filePath) !== path.resolve(targetPath)) {
      await fs.promises.mkdir(config.storage.localDir, { recursive: true })
      await fs.promises.rename(filePath, targetPath)
    }
    return {
      url: this.getUrl(fileName),
      key: fileName,
    }
  }

  async saveAs(filePath: string, objectKey: string): Promise<StorageResult> {
    validateStorageKey(objectKey)
    const targetPath = path.join(config.storage.localDir, objectKey)
    const targetDir = path.dirname(targetPath)
    await fs.promises.mkdir(targetDir, { recursive: true })
    if (path.resolve(filePath) !== path.resolve(targetPath)) {
      await fs.promises.rename(filePath, targetPath)
    }
    return {
      url: this.getUrl(objectKey),
      key: objectKey,
    }
  }

  async delete(key: string): Promise<void> {
    try {
      validateStorageKey(key)
    } catch {
      return // Silently drop malformed keys rather than touch the filesystem
    }
    const filePath = path.join(config.storage.localDir, key)
    fs.unlink(filePath, () => {}) // async, ignore errors
  }

  async copy(srcKey: string, destKey: string): Promise<void> {
    validateStorageKey(srcKey)
    validateStorageKey(destKey)
    const srcPath = path.join(config.storage.localDir, srcKey)
    const destPath = path.join(config.storage.localDir, destKey)
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
    await fs.promises.copyFile(srcPath, destPath)
  }

  getUrl(key: string): string {
    return `/uploads/${key}`
  }

  // Local driver has no signing; return plain URL as fallback
  getPresignedUrl(key: string, _expiresSeconds = 3600): string {
    validateStorageKey(key)
    return this.getUrl(key)
  }
}

// ── OSS storage driver ──
class OSSDriver implements StorageDriver {
  private client: any = null

  private getClient() {
    if (!this.client) {
      // Lazy require to avoid mandatory dependency
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const OSS = require('ali-oss')
        this.client = new OSS({
          region: config.storage.oss.region,
          bucket: config.storage.oss.bucket,
          accessKeyId: config.storage.oss.accessKeyId,
          accessKeySecret: config.storage.oss.accessKeySecret,
        })
      } catch {
        throw new Error('ali-oss package not installed. Run: npm install ali-oss')
      }
    }
    return this.client
  }

  // Headers for long-term caching (uploaded images are immutable)
  private static UPLOAD_HEADERS = {
    'Cache-Control': 'public, max-age=31536000, immutable',
  }

  async save(filePath: string, fileName: string): Promise<StorageResult> {
    const client = this.getClient()
    const objectKey = `${config.storage.oss.prefix}${fileName}`
    await client.put(objectKey, filePath, { headers: OSSDriver.UPLOAD_HEADERS })

    // Delete local temp file after upload
    fs.unlink(filePath, () => {})

    return {
      url: this.getUrl(objectKey),
      key: objectKey,
    }
  }

  async saveAs(filePath: string, objectKey: string): Promise<StorageResult> {
    validateStorageKey(objectKey)
    const client = this.getClient()
    await client.put(objectKey, filePath, { headers: OSSDriver.UPLOAD_HEADERS })
    fs.unlink(filePath, () => {})
    return {
      url: this.getUrl(objectKey),
      key: objectKey,
    }
  }

  async delete(key: string): Promise<void> {
    try {
      validateStorageKey(key)
      const client = this.getClient()
      await client.delete(key)
    } catch {
      // Ignore delete errors (file may not exist)
    }
  }

  async copy(srcKey: string, destKey: string): Promise<void> {
    validateStorageKey(srcKey)
    validateStorageKey(destKey)
    const client = this.getClient()
    await client.copy(destKey, srcKey)
  }

  getUrl(key: string): string {
    validateStorageKey(key)
    if (config.storage.oss.cdnDomain) {
      return `https://${config.storage.oss.cdnDomain}/${key}`
    }
    return `https://${config.storage.oss.bucket}.${config.storage.oss.region}.aliyuncs.com/${key}`
  }

  getPresignedUrl(key: string, expiresSeconds = 3600): string {
    validateStorageKey(key)
    const client = this.getClient()
    // ali-oss signatureUrl ignores `secure` option in some versions, so we force https manually
    const url = client.signatureUrl(key, { expires: expiresSeconds })
    return url.replace(/^http:\/\//, 'https://')
  }
}

// ── Export singleton based on config ──
let _storage: StorageDriver | null = null

export function getStorage(): StorageDriver {
  if (!_storage) {
    if (config.storage.driver === 'oss') {
      console.log('[Storage] Using OSS driver')
      _storage = new OSSDriver()
    } else {
      console.log('[Storage] Using local driver')
      _storage = new LocalDriver()
    }
  }
  return _storage
}
