/**
 * Template snapshot helpers.
 *
 * When a template is published, the author's illustrations are copied into
 * immutable per-template snapshot objects so the template
 * stays stable even if the author later changes their illustrations. This logic
 * is shared by the public `templates` router and the `admin` router; it lives
 * in the service layer so neither route module has to import from the other.
 */
import crypto from 'crypto'
import type { Database } from 'better-sqlite3'
import { getStorage } from './storage'

/** Copy an author's illustrations into a template's cells as stable snapshots. */
export async function copyIllustrationsToTemplate(
  db: Database,
  templateId: number,
  authorId: number,
  words: string[],
): Promise<void> {
  const uniqueWords = [...new Set(words.filter(Boolean))]
  if (uniqueWords.length === 0) return

  const placeholders = uniqueWords.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT word, image_path FROM illustrations WHERE user_id = ? AND word IN (${placeholders})`
  ).all(authorId, ...uniqueWords) as Array<{ word: string; image_path: string }>

  if (rows.length === 0) return

  const illustMap = new Map(rows.map(r => [r.word, r.image_path]))
  const storage = getStorage()
  const updateStmt = db.prepare('UPDATE template_cells SET image_path = ? WHERE id = ? AND title = ? AND image_path = ?')

  const cellRows = db.prepare(
    'SELECT id, position, title, image_path FROM template_cells WHERE template_id = ?'
  ).all(templateId) as Array<{ id: number; position: number; title: string; image_path: string }>

  for (const cell of cellRows) {
    const srcPath = illustMap.get(cell.title)
    if (!srcPath) continue
    try {
      const ext = srcPath.split('.').pop() || 'jpg'
      const destKey = `templates/t${templateId}/c${cell.position}-${crypto.randomUUID()}.${ext}`
      await storage.copy(srcPath, destKey)
      updateStmt.run(destKey, cell.id, cell.title, cell.image_path)
    } catch (err) {
      console.error(`[Template] Failed to copy illustration for position ${cell.position}:`, err)
    }
  }
}
