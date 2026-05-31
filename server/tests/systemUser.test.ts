import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { ensureSystemAdminUser, SYSTEM_ADMIN_OPENID } from '../src/db/database'

describe('system admin user', () => {
  it('creates a system user even when a regular user has the admin nickname', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        openid TEXT NOT NULL UNIQUE,
        nickname TEXT DEFAULT NULL UNIQUE,
        kind TEXT NOT NULL DEFAULT 'wechat',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    db.prepare("INSERT INTO users (openid, nickname) VALUES ('user-openid', 'admin')").run()

    const systemUserId = ensureSystemAdminUser(db)
    const row = db.prepare('SELECT openid, nickname, kind FROM users WHERE id = ?').get(systemUserId) as {
      openid: string
      nickname: string | null
      kind: string
    }

    expect(row.openid).toBe(SYSTEM_ADMIN_OPENID)
    expect(row.nickname).toBeNull()
    expect(row.kind).toBe('system')

    db.close()
  })
})
