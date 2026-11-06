import { expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import { asyncRoute, drainAsyncRoutes } from '../src/middleware/asyncRoute'
import { errorHandler } from '../src/middleware/errorHandler'

function gate() {
  let resolve = () => {}
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

it('draining waits for every handler even when their responses have already ended', async () => {
  const app = express()
  const first = gate(), second = gate()
  const completed: string[] = []
  app.get('/first', asyncRoute(async (_req, res) => {
    res.end()
    await first.promise
    completed.push('first')
  }))
  app.get('/second', asyncRoute(async (_req, res) => {
    res.end()
    await second.promise
    completed.push('second')
  }))
  await Promise.all([request(app).get('/first').expect(200), request(app).get('/second').expect(200)])
  let drained = false
  const draining = drainAsyncRoutes().then(() => { drained = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(drained).toBe(false)
    first.resolve()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(completed).toEqual(['first'])
    expect(drained).toBe(false)
    second.resolve()
    await draining
    expect(completed).toEqual(['first', 'second'])
    expect(drained).toBe(true)
  } finally {
    first.resolve(); second.resolve()
    await draining
  }
})

it('forwards rejected handlers to Express error handling and releases their pending work', async () => {
  const app = express()
  app.get('/failing', asyncRoute(async () => {
    await Promise.resolve()
    throw new Error('test handler failed')
  }))
  app.use(errorHandler)
  const response = await request(app).get('/failing').expect(500)
  expect(response.body.success).toBe(false)
  await drainAsyncRoutes()
})
