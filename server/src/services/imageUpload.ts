/**
 * Shared image-upload plumbing.
 *
 * Three routes (`upload`, `illustrations`, admin word-bank illustration) all
 * configured an identical multer disk storage + file filter and re-implemented
 * the same illustration upsert. This module is the single source of truth so a
 * fix (e.g. allowed types, key naming, upsert semantics) only has to be made
 * once. Size limits legitimately differ per route, so they are an explicit
 * parameter rather than a hard-coded constant.
 */
import crypto from 'crypto'
import fs from 'fs'
import multer from 'multer'
import type { Database } from 'better-sqlite3'
import { config } from '../config'
import type { StorageDriver } from './storage'

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

/**
 * Build a multer instance that stores uploads to the local temp dir with a
 * random, MIME-derived filename (ignoring the client-supplied extension) and
 * rejects non-image types.
 */
export function imageMulter(options: { maxBytes: number }): multer.Multer {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(config.uploadDir)) {
        fs.mkdirSync(config.uploadDir, { recursive: true })
      }
      cb(null, config.uploadDir)
    },
    filename: (_req, file, cb) => {
      const ext = MIME_TO_EXT[file.mimetype] || '.jpg'
      cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`)
    },
  })

  return multer({
    storage,
    limits: { fileSize: options.maxBytes },
    fileFilter: (_req, file, cb) => {
      if (ACCEPTED_IMAGE_TYPES.includes(file.mimetype)) {
        cb(null, true)
      } else {
        cb(new Error('只支持 JPG/PNG/WebP/GIF 格式'))
      }
    },
  })
}

/**
 * Upsert an illustration row for (word, userId), replacing any previous storage
 * object only after the DB write commits. Returns the previous image key (if
 * any) so the caller can delete the now-orphaned object.
 *
 * Throws if the DB write fails; the caller is responsible for deleting the
 * freshly stored object in that case.
 */
export function upsertIllustration(
  db: Database,
  word: string,
  userId: number,
  imageKey: string,
): { previousKey: string | null } {
  const existing = db
    .prepare('SELECT image_path FROM illustrations WHERE word = ? AND user_id = ?')
    .get(word, userId) as { image_path: string } | undefined

  db.prepare(`
    INSERT INTO illustrations (word, user_id, image_path)
    VALUES (?, ?, ?)
    ON CONFLICT(word, user_id) DO UPDATE SET
      image_path = excluded.image_path,
      created_at = CURRENT_TIMESTAMP
  `).run(word, userId, imageKey)

  return { previousKey: existing?.image_path || null }
}

/** Delete a storage object, swallowing any error (best-effort cleanup). */
export async function deleteStorageObjectQuietly(storage: StorageDriver, key: string): Promise<void> {
  await storage.delete(key).catch(() => {})
}
