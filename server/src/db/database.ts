import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { config } from '../config'
import { runMigrations } from './migrate'

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

  // Two complementary mechanisms keep every database (yours, a teammate's, the
  // test DBs, production) at the correct structure:
  //
  // 1. schema.sql — creates the BASE tables. `CREATE TABLE IF NOT EXISTS` means
  //    a brand-new DB gets all tables, while an existing DB is left untouched.
  //
  // 2. runMigrations — applies structural CHANGES made after the base schema
  //    (e.g. "add column X"). Each migration runs once per database and is
  //    recorded, so it executes on first startup of a fresh DB and is skipped
  //    forever after.
  //
  // Why both, and why migrations matter even though "the DB is already
  // designed": once there is data you cannot wipe (real users in production,
  // or any long-lived DB), you can't just edit schema.sql and recreate the DB —
  // that would lose the data. Migrations let you evolve an existing DB in place
  // without data loss. Pre-launch you could fold columns into schema.sql, but
  // keeping migrations now means post-launch schema changes are a one-file add
  // with zero risk.
  const schema = fs.readFileSync(
    path.resolve(__dirname, 'schema.sql'),
    'utf-8'
  )
  database.exec(schema)

  runMigrations(database)

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
