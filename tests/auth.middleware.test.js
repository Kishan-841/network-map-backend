import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { requireAuth, requireRole } from '../src/middleware/auth.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

function testApp() {
  const app = express()
  app.get('/me', requireAuth, (req, res) => res.json({ success: true, data: req.user }))
  app.get('/admin-only', requireAuth, requireRole('ADMIN'), (req, res) =>
    res.json({ success: true, data: 'secret' }),
  )
  app.use(errorHandler)
  return app
}

const SURV_ID = `mw-surv-${Date.now()}`
const ADMIN_ID = `mw-admin-${Date.now()}`
// Token role is deliberately bogus — requireAuth must read role from the DB.
const tokenFor = (id) => jwt.sign({ sub: id, role: 'IGNORED' }, env.jwtSecret, { expiresIn: '1h' })

beforeAll(async () => {
  await prisma.user.create({
    data: { id: SURV_ID, name: 'S', email: `${SURV_ID}@vitest.local`, passwordHash: 'x', role: 'SURVEYOR' },
  })
  await prisma.user.create({
    data: { id: ADMIN_ID, name: 'A', email: `${ADMIN_ID}@vitest.local`, passwordHash: 'x', role: 'ADMIN' },
  })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [SURV_ID, ADMIN_ID] } } })
})

describe('auth middleware', () => {
  it('rejects requests with no token', async () => {
    expect((await request(testApp()).get('/me')).status).toBe(401)
  })

  it('rejects a malformed token', async () => {
    const res = await request(testApp()).get('/me').set('Authorization', 'Bearer garbage')
    expect(res.status).toBe(401)
  })

  it('sets req.user from the DB, ignoring the token role', async () => {
    const res = await request(testApp())
      .get('/me')
      .set('Authorization', `Bearer ${tokenFor(SURV_ID)}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ id: SURV_ID, role: 'SURVEYOR' })
  })

  it('blocks a surveyor from an admin route', async () => {
    const res = await request(testApp())
      .get('/admin-only')
      .set('Authorization', `Bearer ${tokenFor(SURV_ID)}`)
    expect(res.status).toBe(403)
  })

  it('allows an admin through requireRole("ADMIN")', async () => {
    const res = await request(testApp())
      .get('/admin-only')
      .set('Authorization', `Bearer ${tokenFor(ADMIN_ID)}`)
    expect(res.status).toBe(200)
  })

  it('rejects a token for a user that no longer exists', async () => {
    const res = await request(testApp())
      .get('/me')
      .set('Authorization', `Bearer ${tokenFor('deleted-user-id')}`)
    expect(res.status).toBe(401)
  })

  it('rejects a deactivated user immediately', async () => {
    await prisma.user.update({ where: { id: SURV_ID }, data: { isActive: false } })
    const res = await request(testApp())
      .get('/me')
      .set('Authorization', `Bearer ${tokenFor(SURV_ID)}`)
    expect(res.status).toBe(401)
    await prisma.user.update({ where: { id: SURV_ID }, data: { isActive: true } })
  })
})
