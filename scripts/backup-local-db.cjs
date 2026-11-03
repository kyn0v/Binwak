const path = require('node:path')
const { createRequire } = require('node:module')
const Database = createRequire(path.resolve(__dirname, '../server/package.json'))('better-sqlite3')

async function main() {
  const [source, destination] = process.argv.slice(2)
  if (!source || !destination) throw new Error('Expected source and backup database paths')
  const db = new Database(source, { readonly: true, fileMustExist: true })
  try {
    await db.backup(destination)
  } finally {
    db.close()
  }
  const backup = new Database(destination, { fileMustExist: true })
  try {
    backup.pragma('journal_mode = DELETE')
    if (backup.pragma('quick_check', { simple: true }) !== 'ok') {
      throw new Error('SQLite backup integrity check failed')
    }
  } finally {
    backup.close()
  }
}

main().catch(error => {
  console.error(`Backup failed. Original database retained. ${error.message}`)
  process.exitCode = 1
})
