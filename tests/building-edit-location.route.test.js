import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const admin = { Authorization: `Bearer ${jwt.sign({ sub: 'test-admin', role: 'ADMIN' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` }

const B = `editloc-${Date.now()}`

beforeAll(async () => {
  await prisma.building.create({
    data: { id: B, buildingName: B.toUpperCase(), formattedAddress: `${B} rd`, latitude: 18.5, longitude: 73.8, createdById: 'test-admin', source: 'COVERAGE' },
  })
})
afterAll(async () => {
  await prisma.building.deleteMany({ where: { id: B } })
})

describe('PATCH /buildings/:id — move the map pin', () => {
  it('accepts and persists new latitude/longitude', async () => {
    const res = await request(app)
      .patch(`/api/v1/buildings/${B}`)
      .set(admin)
      .send({ latitude: 18.573002, longitude: 73.792476 })
    expect(res.status).toBe(200)
    const row = await prisma.building.findUnique({ where: { id: B }, select: { latitude: true, longitude: true } })
    expect(row.latitude).toBeCloseTo(18.573002, 5)
    expect(row.longitude).toBeCloseTo(73.792476, 5)
  })

  it('rejects an out-of-range coordinate', async () => {
    const res = await request(app).patch(`/api/v1/buildings/${B}`).set(admin).send({ latitude: 200, longitude: 73.8 })
    expect(res.status).toBe(400)
  })
})
