import { describe, it, expect } from 'vitest'
import { getDb } from '../src/db/database'
import { upsertIllustration } from '../src/services/imageUpload'

describe('upsertIllustration', () => {
  function seedUser(): number {
    const db = getDb()
    const r = db.prepare('INSERT INTO users (openid, nickname) VALUES (?, ?)').run('illu-openid', 'u')
    return r.lastInsertRowid as number
  }

  it('inserts a new illustration and reports no previous key', () => {
    const db = getDb()
    const userId = seedUser()

    const { previousKey } = upsertIllustration(db, '花束', userId, 'illustrations/u1/a.jpg')

    expect(previousKey).toBeNull()
    const row = db.prepare('SELECT image_path FROM illustrations WHERE word = ? AND user_id = ?')
      .get('花束', userId) as { image_path: string }
    expect(row.image_path).toBe('illustrations/u1/a.jpg')
  })

  it('replaces an existing illustration and returns the previous key for cleanup', () => {
    const db = getDb()
    const userId = seedUser()

    upsertIllustration(db, '花束', userId, 'illustrations/u1/a.jpg')
    const { previousKey } = upsertIllustration(db, '花束', userId, 'illustrations/u1/b.jpg')

    expect(previousKey).toBe('illustrations/u1/a.jpg')
    const row = db.prepare('SELECT image_path FROM illustrations WHERE word = ? AND user_id = ?')
      .get('花束', userId) as { image_path: string }
    expect(row.image_path).toBe('illustrations/u1/b.jpg')
    // Upsert must not create a duplicate row for the same (word, user).
    const count = db.prepare('SELECT COUNT(*) as c FROM illustrations WHERE word = ? AND user_id = ?')
      .get('花束', userId) as { c: number }
    expect(count.c).toBe(1)
  })
})
