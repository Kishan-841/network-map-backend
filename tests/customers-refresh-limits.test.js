import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createCustomerRefreshLimiter, createForceThrottle } from '../src/middleware/rate-limit.js'

// The per-user limits on POST /customers/refresh. The route's own instances are
// skipped under NODE_ENV=test; these are fresh ones from the same factories.
function appWith(...mw) {
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    req.user = { id: req.get('x-user') }
    next()
  })
  app.post('/refresh', ...mw, (req, res) => res.json({ success: true, data: { force: req.body.force ?? null } }))
  return app
}
const post = (app, user, body = { ids: ['a'] }) => request(app).post('/refresh').set('x-user', user).send(body)

describe('createCustomerRefreshLimiter', () => {
  it('6 calls a minute per user, then 429 in the project error shape', async () => {
    const app = appWith(createCustomerRefreshLimiter())
    for (let i = 0; i < 6; i++) expect((await post(app, 'u1')).status).toBe(200)
    const res = await post(app, 'u1')
    expect(res.status).toBe(429)
    expect(res.body).toEqual({ success: false, error: { code: 'RATE_LIMITED', message: expect.any(String) } })
    // Keyed by user, not by IP: another user on the same address is unaffected.
    expect((await post(app, 'u2')).status).toBe(200)
  })

  it('skip turns it off', async () => {
    const app = appWith(createCustomerRefreshLimiter({ limit: 1, skip: () => true }))
    expect((await post(app, 'u1')).status).toBe(200)
    expect((await post(app, 'u1')).status).toBe(200)
  })
})

describe('createForceThrottle', () => {
  it('force honoured once per 30 s per user; a repeat runs as non-force (no 429)', async () => {
    let t = 1000
    const app = appWith(createForceThrottle({ now: () => t }))
    const force = { ids: ['a'], force: true }
    expect((await post(app, 'u1', force)).body.data.force).toBe(true)
    t += 29999
    const again = await post(app, 'u1', force)
    expect(again.status).toBe(200)
    expect(again.body.data.force).toBe(false)
    expect((await post(app, 'u2', force)).body.data.force).toBe(true) // per user
    t += 1
    expect((await post(app, 'u1', force)).body.data.force).toBe(true) // 30 s after the honoured one
  })

  it('a non-force call does not use up the force allowance', async () => {
    const t = 1000
    const app = appWith(createForceThrottle({ now: () => t }))
    expect((await post(app, 'u1')).body.data.force).toBeNull()
    expect((await post(app, 'u1', { ids: ['a'], force: false })).body.data.force).toBe(false)
    expect((await post(app, 'u1', { ids: ['a'], force: true })).body.data.force).toBe(true)
  })
})
