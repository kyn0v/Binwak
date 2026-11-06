import { expect, it, vi } from 'vitest'
import express from 'express'
import http from 'node:http'
import { config } from '../src/config'
import { getDb, useMemoryDb } from '../src/db/database'
import { asyncRoute } from '../src/middleware/asyncRoute'

it('bounds shutdown with disconnected handler work pending without closing SQLite under that handler', async () => {
  const app = express()
  const db = getDb()
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let notifyStarted = () => {}
  const started = new Promise<void>(resolve => { notifyStarted = resolve })
  let notifyDone = () => {}
  const done = new Promise<void>(resolve => { notifyDone = resolve })
  app.get('/waiting', asyncRoute(async (_req, res) => {
    notifyStarted()
    await gate
    db.prepare("INSERT INTO users (openid) VALUES ('deadline-handler')").run()
    notifyDone()
    res.end()
  }))
  const listen = vi.spyOn(app, 'listen')
  const originalPort = config.port
  config.port = 0
  vi.doMock('../src/app', () => ({ createApp: () => app }))
  const exits: unknown[] = []
  vi.spyOn(process, 'exit').mockImplementation(code => { exits.push(code); return undefined! })
  let signal = () => {}
  const originalOn = process.on.bind(process)
  vi.spyOn(process, 'on').mockImplementation((event, listener) => {
    if (event === 'SIGTERM') signal = listener
    else if (event !== 'SIGINT') originalOn(event, listener)
    return process
  })
  await import('../src/index')
  const server = listen.mock.results[0].value as http.Server
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server')
  const closed = new Promise<void>(resolve => server.once('close', resolve))
  const disconnected = new Promise<void>(resolve => {
    server.once('connection', socket => socket.once('close', resolve))
  })
  const outgoing = http.get(`http://127.0.0.1:${address.port}/waiting`)
  const response = new Promise<Error>(resolve => { outgoing.on('error', resolve) })
  await started
  try {
    outgoing.destroy()
    await disconnected
    expect((await response).message).toContain('socket hang up')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    signal()
    await closed
    await vi.advanceTimersByTimeAsync(29_999)
    expect(exits).toEqual([])
    expect(db.open).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(exits).toEqual([1])
    expect(db.open).toBe(true)
    release()
    await done
    await closed
    expect(exits).toEqual([1])
  } finally {
    release()
    server.closeAllConnections()
    if (server.listening) server.close()
    await closed
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.doUnmock('../src/app')
    config.port = originalPort
    useMemoryDb()
  }
})
