import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { config } from '../config'

let db: Database.Database

export const SYSTEM_ADMIN_OPENID = '__system_admin__'
export const SYSTEM_ADMIN_DISPLAY_NAME = 'Binwak'

export function getDb(): Database.Database {
  if (!db) {
    // Ensure data/ directory exists
    const dataDir = path.dirname(config.dbPath)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }

    db = new Database(config.dbPath)
    initDb(db)
    console.log('[DB] SQLite initialized:', config.dbPath)
  }
  return db
}

/** Replace current connection with in-memory DB (for tests) */
export function useMemoryDb(): Database.Database {
  if (db) {
    try { db.close() } catch {}
  }
  db = new Database(':memory:')
  initDb(db)
  return db
}

function initDb(database: Database.Database) {
  // WAL mode for better concurrency (ignored for in-memory DB)
  try { database.pragma('journal_mode = WAL') } catch {}
  // NORMAL sync is safe under WAL and ~2x faster writes
  try { database.pragma('synchronous = NORMAL') } catch {}
  // Wait up to 5s on lock contention instead of immediate SQLITE_BUSY
  database.pragma('busy_timeout = 5000')
  database.pragma('foreign_keys = ON')

  // Run schema creation
  const schema = fs.readFileSync(
    path.resolve(__dirname, 'schema.sql'),
    'utf-8'
  )
  database.exec(schema)

  // Incremental migrations: add new columns (ignore if already exist)
  const migrations: string[] = [
    "ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'wechat'",
    "ALTER TABLE users ADD COLUMN image_storage TEXT NOT NULL DEFAULT 'local'",
    "ALTER TABLE template_cells ADD COLUMN image_path TEXT DEFAULT ''",
  ]
  for (const sql of migrations) {
    try { database.exec(sql) } catch {}
  }

  ensureSystemAdminUser(database)
}

export function ensureSystemAdminUser(database: Database.Database = getDb()): number {
  database.prepare(`
    INSERT INTO users (openid, nickname, kind)
    VALUES (?, NULL, 'system')
    ON CONFLICT(openid) DO UPDATE SET
      nickname = NULL,
      kind = 'system',
      updated_at = CURRENT_TIMESTAMP
  `).run(SYSTEM_ADMIN_OPENID)

  const row = database
    .prepare('SELECT id FROM users WHERE openid = ?')
    .get(SYSTEM_ADMIN_OPENID) as { id: number } | undefined

  if (!row) throw new Error('Failed to initialize system admin user')
  return row.id
}

export function closeDb(): void {
  if (db) {
    db.close()
    console.log('[DB] SQLite closed')
  }
}
