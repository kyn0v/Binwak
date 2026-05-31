import { beforeEach, afterAll } from 'vitest'
import { useMemoryDb, closeDb } from '../src/db/database'

// Reset to a fresh in-memory database before each test.
beforeEach(() => {
  useMemoryDb()
})

afterAll(() => {
  closeDb()
})
