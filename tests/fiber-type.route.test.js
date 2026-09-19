import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { FIBER_TYPES } from '../src/modules/fibers/fiber.schemas.js'

const STAMP = Date.now()
const ADMIN = `ft-admin-${STAMP}`
const app = createApp()
const auth = [
  'Authorization',
  `Bearer ${jwt.sign({ sub: ADMIN, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]
let zoneId = null
const made = []
const line = [
  { latitude: 18.6, longitude: 73.76 },
  { latitude: 18.601, longitude: 73.762 },
]

beforeAll(async () => {
  zoneId = (await prisma.zone.findFirst()).id
  await prisma.user.create({
    data: { id: ADMIN, name: 'FT Admin', email: `${ADMIN}@vitest.local`, passwordHash: 'x', role: 'ADMIN' },
  })
})

afterAll(async () => {
  for (const id of made) await request(app).delete(`/api/v1/fibers/${id}`).set(...auth)
  await prisma.systemLog.deleteMany({ where: { userId: ADMIN } })
  await prisma.user.deleteMany({ where: { id: ADMIN } })
})

describe('a fiber records what kind of cable it is', () => {
  it('offers main, sub and drop', () => {
    expect(FIBER_TYPES).toEqual(['MAIN_SF', 'SUB_SF', 'DROP_CABLE'])
  })

  it('saves the type and hands it back', async () => {
    const res = await request(app)
      .post('/api/v1/fibers')
      .set(...auth)
      .send({ name: `FT-${STAMP}`, coreCount: 2, zoneId, cableType: 'SUB_SF', points: line })
    expect(res.status).toBe(201)
    made.push(res.body.data.id)
    expect(res.body.data.cableType).toBe('SUB_SF')
  })

  it('refuses a kind of cable we do not lay', async () => {
    const res = await request(app)
      .post('/api/v1/fibers')
      .set(...auth)
      .send({ name: `FT-bad-${STAMP}`, coreCount: 2, zoneId, cableType: 'ribbon', points: line })
    expect(res.status).toBe(400)
  })

  it('lets a fiber be saved without one, and set later', async () => {
    const res = await request(app)
      .post('/api/v1/fibers')
      .set(...auth)
      .send({ name: `FT-none-${STAMP}`, coreCount: 2, zoneId, points: line })
    expect(res.status).toBe(201)
    made.push(res.body.data.id)
    expect(res.body.data.cableType).toBeNull()

    const patched = await request(app)
      .patch(`/api/v1/fibers/${res.body.data.id}`)
      .set(...auth)
      .send({ cableType: 'DROP_CABLE' })
    expect(patched.status).toBe(200)
    expect(patched.body.data.cableType).toBe('DROP_CABLE')
  })
})
