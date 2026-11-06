import { describe, expect, it } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { createApp } from '../src/app'
import { getDb } from '../src/db/database'
import { config } from '../src/config'

createApp()
const collectionDatabase = getDb().name

describe('test isolation', () => {
  it('uses an in-memory database even while test modules are loading', () => {
    expect(collectionDatabase).toBe(':memory:')
  })

  it('stores uploads in a temporary directory instead of the checkout or cloud', () => {
    expect(config.storage.driver).toBe('local')
    expect(config.uploadDir).toBe(config.storage.localDir)
    expect(path.relative(os.tmpdir(), config.uploadDir)).not.toMatch(/^\.\./)
    expect(path.relative(process.cwd(), config.uploadDir)).toMatch(/^\.\./)
  })
})
