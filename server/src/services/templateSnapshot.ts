/**
 * Template snapshot helpers.
 *
 * When a template is published, the author's illustrations are copied into
 * per-template snapshot objects (`templates/t{id}/c{pos}.ext`) so the template
 * stays stable even if the author later changes their illustrations. This logic
 * is shared by the public `templates` router and the `admin` router; it lives
 * in the service layer so neither route module has to import from the other.
 */
import type { Database } from 'better-sqlite3'
import { getStorage } from './storage'

/** Delete all snapshot objects belonging to a template (best-effort). */
export async function deleteTemplateSnapshotFiles(db: Database, templateId: number): Promise<void> {
  const rows = db.prepare(
    "SELECT image_path FROM template_cells WHERE template_id = ? AND image_path != ''"
  ).all(templateId) as Array<{ image_path: string }>
  if (rows.length === 0) return

  const storage = getStorage()
  const uniqueKeys = [...new Set(rows.map(r => r.image_path).filter(Boolean))]
  for (const key of uniqueKeys) {
    try { await storage.delete(key) } catch { /* ignore cleanup failures */ }
  }
}

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
  const updateStmt = db.prepare('UPDATE template_cells SET image_path = ? WHERE template_id = ? AND position = ?')

  const cellRows = db.prepare(
    'SELECT position, title FROM template_cells WHERE template_id = ?'
  ).all(templateId) as Array<{ position: number; title: string }>

  for (const cell of cellRows) {
    const srcPath = illustMap.get(cell.title)
    if (!srcPath) continue
    try {
      const ext = srcPath.split('.').pop() || 'jpg'
      const destKey = `templates/t${templateId}/c${cell.position}.${ext}`
      await storage.copy(srcPath, destKey)
      try {
        updateStmt.run(destKey, templateId, cell.position)
      } catch (err) {
        await storage.delete(destKey).catch(() => {})
        throw err
      }
    } catch (err) {
      console.error(`[Template] Failed to copy illustration for position ${cell.position}:`, err)
    }
  }
}
