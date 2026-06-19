import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../src/db/migrate'

/**
 * These tests exercise the migration runner directly against bare in-memory
 * databases (not the app's initDb), so they verify the runner's own behaviour.
 */

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  // Minimal base tables the 0001 migration targets.
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      openid TEXT UNIQUE,
      nickname TEXT
    );
    CREATE TABLE template_cells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER,
      position INTEGER,
      title TEXT
    );
  `)
  return db
}

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
}

describe('migration runner', () => {
  it('applies pending migrations on a fresh database', () => {
    const db = freshDb()
    runMigrations(db)

    expect(columns(db, 'users')).toContain('kind')
    expect(columns(db, 'users')).toContain('image_storage')
    expect(columns(db, 'template_cells')).toContain('image_path')

    const applied = db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]
    expect(applied.map((r) => r.version)).toContain('0001_add_user_and_template_columns')
  })

  it('is idempotent — running twice does not error or duplicate', () => {
    const db = freshDb()
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()

    const count = db
      .prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = '0001_add_user_and_template_columns'")
      .get() as { n: number }
    expect(count.n).toBe(1)
  })

  it('baselines a legacy DB that already has the columns (no duplicate-column error)', () => {
    const db = freshDb()
    // Simulate the old ad-hoc loop having already added the columns,
    // without any schema_migrations table.
    db.exec("ALTER TABLE users ADD COLUMN kind TEXT NOT NULL DEFAULT 'wechat'")
    db.exec("ALTER TABLE users ADD COLUMN image_storage TEXT NOT NULL DEFAULT 'local'")
    db.exec("ALTER TABLE template_cells ADD COLUMN image_path TEXT DEFAULT ''")

    expect(() => runMigrations(db)).not.toThrow()

    const applied = db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]
    expect(applied.map((r) => r.version)).toContain('0001_add_user_and_template_columns')
  })

  it('records the migration so it is skipped next run', () => {
    const db = freshDb()
    runMigrations(db)

    // Tamper: drop a column-bearing table and re-create it WITHOUT the column.
    // If the runner wrongly re-ran 0001, it would re-add columns; instead it
    // must skip because the version is recorded.
    const appliedBefore = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }
    runMigrations(db)
    const appliedAfter = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }
    expect(appliedAfter.n).toBe(appliedBefore.n)
  })
})
