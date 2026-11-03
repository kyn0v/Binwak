import { afterEach, expect, it, vi } from 'vitest'
import express from 'express'
import http from 'node:http'
import { config } from '../src/config'
import { getDb, useMemoryDb } from '../src/db/database'
import { asyncRoute } from '../src/middleware/asyncRoute'

const originalPort = config.port

afterEach(() => {
  config.port = originalPort
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.doUnmock('../src/app')
  useMemoryDb()
})

it('drains a request waiting on async work before closing SQLite and ignores repeated signals', async () => {
  const app = express()
  const db = getDb()
  let releaseRequest = () => {}
  const gate = new Promise<void>(resolve => { releaseRequest = resolve })
  let requestStarted = () => {}
  const started = new Promise<void>(resolve => { requestStarted = resolve })
  app.get('/waiting', asyncRoute(async (_req, res) => {
    requestStarted()
    await gate
    try {
      db.prepare("INSERT INTO users (openid) VALUES ('shutdown-completed')").run()
      res.json({ persisted: true })
    } catch (error) {
      res.status(500).json({ error: String(error) })
    }
  }))
  const listen = vi.spyOn(app, 'listen')
  vi.doMock('../src/app', () => ({ createApp: () => app }))
  config.port = 0
  const exits: unknown[] = []
  let notifyExit = () => {}
  const exited = new Promise<void>(resolve => { notifyExit = resolve })
  vi.spyOn(process, 'exit').mockImplementation(code => { exits.push(code); notifyExit(); return undefined! })
  const signals = new Map<string, () => void>()
  const originalOn = process.on.bind(process)
  vi.spyOn(process, 'on').mockImplementation((event, listener) => {
    if (event === 'SIGTERM' || event === 'SIGINT') signals.set(event, listener)
    else originalOn(event, listener)
    return process
  })
  await import('../src/index')
  const server = listen.mock.results[0].value as http.Server
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP server')
  const response = new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    http.get(`http://127.0.0.1:${address.port}/waiting`, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject)
  })
  await started
  const closed = new Promise<void>(resolve => server.once('close', resolve))
  try {
    signals.get('SIGTERM')?.()
    signals.get('SIGINT')?.()
    releaseRequest()
    expect(await response).toEqual({ status: 200, body: '{"persisted":true}' })
    await closed
    await exited
    expect(exits).toEqual([0])
    expect(db.open).toBe(false)
  } finally {
    releaseRequest()
    server.closeAllConnections()
    if (server.listening) server.close()
    await closed
    await new Promise<void>(resolve => setImmediate(resolve))
  }
})
