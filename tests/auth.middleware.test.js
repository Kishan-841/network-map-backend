import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { requireAuth, requireRole } from '../src/middleware/auth.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { env } from '../src/config/env.js'

function testApp() {
  const app = express()
  app.get('/me', requireAuth, (req, res) => res.json({ success: true, data: req.user }))
  app.get('/admin-only', requireAuth, requireRole('ADMIN'), (req, res) =>
    res.json({ success: true, data: 'secret' }),
  )
  app.use(errorHandler)
  return app
}

const tokenFor = (role) =>
  jwt.sign({ sub: 'user-1', role }, env.jwtSecret, { expiresIn: '1h' })

describe('auth middleware', () => {
  it('rejects requests with no token', async () => {
    const res = await request(testApp()).get('/me')
    expect(res.status).toBe(401)
  })

  it('rejects a malformed token', async () => {
    const res = await request(testApp()).get('/me').set('Authorization', 'Bearer garbage')
    expect(res.status).toBe(401)
  })

  it('sets req.user from a valid token', async () => {
    const res = await request(testApp())
      .get('/me')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ id: 'user-1', role: 'SURVEYOR' })
  })

  it('blocks a surveyor from an admin route', async () => {
    const res = await request(testApp())
      .get('/admin-only')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
    expect(res.status).toBe(403)
  })

  it('allows an admin through requireRole("ADMIN")', async () => {
    const res = await request(testApp())
      .get('/admin-only')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(res.status).toBe(200)
  })
})
