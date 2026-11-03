import type { Database } from 'better-sqlite3'
import { validateStorageKey, type StorageDriver } from './storage'

export function extractStorageKey(pathOrUrl: string | null): string {
  if (!pathOrUrl) return ''
  let value = pathOrUrl.trim()
  while (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      value = decodeURIComponent(new URL(value).pathname.slice(1))
    } catch {
      return ''
    }
  }
  return value.startsWith('/uploads/') ? value.slice('/uploads/'.length) : value
}

/**
 * Shareable objects can be attached after a reference scan, even during deletion.
 * Retain those orphans until a safe collector exists. There is no collector yet.
 * Private photos keep best-effort cleanup from committed-reference scans.
 */
export async function deleteUnreferencedMedia(db: Database, storage: StorageDriver, key: string): Promise<void> {
  if (!key) return
  const normalizedKey = extractStorageKey(key).replace(/^uploads\//, '')
  if (normalizedKey.startsWith('illustrations/') || normalizedKey.startsWith('templates/')) return
  const references = db.prepare(`
    SELECT image_name AS key FROM cells WHERE image_name != ''
    UNION ALL SELECT illustration_path AS key FROM cells WHERE illustration_path != ''
    UNION ALL SELECT image_path AS key FROM template_cells WHERE image_path != ''
    UNION ALL SELECT image_path AS key FROM illustrations WHERE image_path != ''
  `).iterate() as Iterable<{ key: string }>
  for (const reference of references) {
    const referenceKey = extractStorageKey(reference.key)
    if (referenceKey === key || referenceKey === `uploads/${key}`) return
  }
  try {
    validateStorageKey(key)
    await storage.delete(key)
  } catch {}
}
