import { beforeEach, afterEach, afterAll, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { useMemoryDb, closeDb } from '../src/db/database'
import { config } from '../src/config'

const uploadDir = mkdtempSync(path.join(os.tmpdir(), 'binwak-test-uploads-'))
config.uploadDir = uploadDir
config.storage.localDir = uploadDir

const unexpectedRequests: string[] = []
vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
  const url = input instanceof Request ? input.url : String(input)
  unexpectedRequests.push(url)
  throw new Error(`Unexpected outbound request in test: ${url}`)
}))

beforeEach(() => {
  useMemoryDb()
})

afterEach(() => {
  expect(unexpectedRequests.splice(0), 'Mock external integrations explicitly').toEqual([])
})

afterAll(() => {
  closeDb()
  rmSync(uploadDir, { recursive: true, force: true })
})
