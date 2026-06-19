import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

/**
 * Versioned SQL migration runner.
 *
 * Migrations live as `.sql` files in ./migrations, named `NNNN_description.sql`.
 * They run in ascending filename order, exactly once each, inside a transaction.
 * Applied versions are recorded in the `schema_migrations` table. Any failure
 * aborts startup loudly (no silent error swallowing), so a bad migration can
 * never leave the DB in a half-applied, inconsistent state.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations')

interface MigrationFile {
  version: string
  name: string
  fullPath: string
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

function listMigrationFiles(): MigrationFile[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return []
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      version: f.replace(/\.sql$/, ''),
      name: f,
      fullPath: path.join(MIGRATIONS_DIR, f),
    }))
}

function appliedVersions(db: Database.Database): Set<string> {
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]
  return new Set(rows.map((r) => r.version))
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    return cols.some((c) => c.name === column)
  } catch {
    return false
  }
}

/**
 * Databases created before the migration system existed already had migration
 * 0001's columns applied by the old ad-hoc ALTER loop. Detect that case and
 * record 0001 as applied without re-running it (which would fail with a
 * duplicate-column error).
 */
function baselineLegacyDb(db: Database.Database, applied: Set<string>): void {
  if (applied.has('0001_add_user_and_template_columns')) return
  const legacyAlreadyMigrated = hasColumn(db, 'users', 'kind')
  if (legacyAlreadyMigrated) {
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(
      '0001_add_user_and_template_columns'
    )
    applied.add('0001_add_user_and_template_columns')
  }
}

/** Apply all pending migrations in order. Throws on the first failure. */
export function runMigrations(db: Database.Database): void {
  ensureMigrationsTable(db)
  const applied = appliedVersions(db)
  baselineLegacyDb(db, applied)

  const record = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)')

  for (const migration of listMigrationFiles()) {
    if (applied.has(migration.version)) continue

    const sql = fs.readFileSync(migration.fullPath, 'utf-8')
    const apply = db.transaction(() => {
      db.exec(sql)
      record.run(migration.version)
    })

    try {
      apply()
      console.log(`[DB] Applied migration: ${migration.name}`)
    } catch (err) {
      throw new Error(
        `Migration failed: ${migration.name}\n${(err as Error).message}`
      )
    }
  }
}
