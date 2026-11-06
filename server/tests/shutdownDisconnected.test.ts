import { afterEach, expect, it, vi } from 'vitest'
import express from 'express'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../src/config'
import * as database from '../src/db/database'
import { getStorage } from '../src/services/storage'
import { createTestUser } from './helpers'

vi.mock('../src/services/moderation', () => ({
  checkText: vi.fn(async () => ({ pass: true })),
  checkImageSync: vi.fn(async () => ({ pass: true })),
  checkImage: vi.fn(async () => ({ submitted: true })),
}))

function gate() {
  let resolve = () => {}
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

const originalPort = config.port
afterEach(() => {
  vi.restoreAllMocks()
  config.port = originalPort
  database.useMemoryDb()
})

it('drains a clone after the client disconnects before closing SQLite', async () => {
  const user = createTestUser()
  const db = database.getDb()
  const boardId = Number(db.prepare('INSERT INTO boards (user_id, grid_size) VALUES (?, 3)').run(user.userId).lastInsertRowid)
  for (let position = 0; position < 9; position++) {
    db.prepare('INSERT INTO cells (board_id, position, title, image_name) VALUES (?, ?, ?, ?)')
      .run(boardId, position, `word${position}`, position === 0 ? 'photos/disconnected.jpg' : '')
  }
  const file = path.join(config.storage.localDir, 'photos/disconnected.jpg')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, 'photo')
  const entered = gate(), release = gate(), copied = gate(), exited = gate()
  const storage = getStorage()
  const copy = storage.copy.bind(storage)
  vi.spyOn(storage, 'copy').mockImplementation(async (src, dest) => {
    entered.resolve()
    await release.promise
    await copy(src, dest)
    copied.resolve()
  })
  const closeDb = database.closeDb
  let cloneAtClose: Array<{ image_name: string }> = []
  vi.spyOn(database, 'closeDb').mockImplementation(() => {
    cloneAtClose = db.prepare('SELECT image_name FROM cells WHERE board_id != ? ORDER BY position').all(boardId) as Array<{ image_name: string }>
    closeDb()
  })
  config.port = 0
  const listen = vi.spyOn(express.application, 'listen')
  const exits: unknown[] = []
  vi.spyOn(process, 'exit').mockImplementation(code => { exits.push(code); exited.resolve(); return undefined! })
  const signals = new Map<string, () => void>()
  const on = process.on.bind(process)
  vi.spyOn(process, 'on').mockImplementation((event, listener) => {
    if (event === 'SIGTERM' || event === 'SIGINT') signals.set(event, listener)
    else on(event, listener)
    return process
  })
  await import('../src/index')
  const server = listen.mock.results[0].value as http.Server
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server')
  const disconnected = gate()
  server.once('connection', socket => socket.once('close', disconnected.resolve))
  const closed = new Promise<void>(resolve => server.once('close', resolve))
  const outgoing = http.request({
    hostname: '127.0.0.1', port: address.port, method: 'POST', path: `/api/boards/${boardId}/clone`,
    headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
  })
  outgoing.on('error', () => {})
  outgoing.end('{}')
  await entered.promise
  try {
    outgoing.destroy()
    await disconnected.promise
    signals.get('SIGTERM')?.()
    signals.get('SIGINT')?.()
    await closed
    expect(db.open).toBe(true)
    expect(exits).toEqual([])
    release.resolve()
    await exited.promise
    expect(exits).toEqual([0])
    expect(db.open).toBe(false)
    expect(cloneAtClose).toHaveLength(9)
    expect(cloneAtClose[0].image_name).toMatch(/^photos\/u\d+\/b\d+\//)
    expect(await fs.readFile(path.join(config.storage.localDir, cloneAtClose[0].image_name), 'utf8')).toBe('photo')
  } finally {
    release.resolve()
    await copied.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    server.closeAllConnections()
    if (server.listening) server.close()
    await closed
  }
})
