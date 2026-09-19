import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { CLOSURE_KINDS, TUBE_COUNTS } from '../src/modules/closures/closure.schemas.js'

const STAMP = Date.now()
const ADMIN = `cs-admin-${STAMP}`
const app = createApp()
const auth = [
  'Authorization',
  `Bearer ${jwt.sign({ sub: ADMIN, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]
const made = []
const at = { latitude: 18.61, longitude: 73.77 }

beforeAll(async () => {
  await prisma.user.create({
    data: { id: ADMIN, name: 'CS Admin', email: `${ADMIN}@vitest.local`, passwordHash: 'x', role: 'ADMIN' },
  })
})

afterAll(async () => {
  for (const id of made) await request(app).delete(`/api/v1/closures/${id}`).set(...auth)
  await prisma.systemLog.deleteMany({ where: { userId: ADMIN } })
  await prisma.user.deleteMany({ where: { id: ADMIN } })
})

describe('the closure survey sheet', () => {
  it('offers the five kinds the sheet names', () => {
    expect(CLOSURE_KINDS).toEqual(['Jumbo', 'Tiffin', 'Compass', 'FDC', 'PatchPanel'])
  })

  it('allows 0 to 4 tubes', () => {
    expect(TUBE_COUNTS).toEqual([0, 1, 2, 3, 4])
  })

  it('saves the kind, the cable it sits on, its tubes and the cores in and out', async () => {
    const res = await request(app)
      .post('/api/v1/closures')
      .set(...auth)
      .send({ ...at, kind: 'FDC', fiberType: 'SUB_SF', tubeCount: 2, inCoreCount: 24, outCoreCount: 12 })
    expect(res.status).toBe(201)
    made.push(res.body.data.id)
    expect(res.body.data).toMatchObject({
      kind: 'FDC',
      fiberType: 'SUB_SF',
      tubeCount: 2,
      inCoreCount: 24,
      outCoreCount: 12,
    })
  })

  it('takes a patch panel with no tubes at all', async () => {
    const res = await request(app)
      .post('/api/v1/closures')
      .set(...auth)
      .send({ ...at, kind: 'PatchPanel', tubeCount: 0 })
    expect(res.status).toBe(201)
    made.push(res.body.data.id)
    expect(res.body.data.tubeCount).toBe(0)
  })

  it('refuses a cable type that is not one of the three', async () => {
    const res = await request(app).post('/api/v1/closures').set(...auth).send({ ...at, fiberType: 'RIBBON' })
    expect(res.status).toBe(400)
  })

  it('refuses five tubes and a core count we do not stock', async () => {
    expect((await request(app).post('/api/v1/closures').set(...auth).send({ ...at, tubeCount: 5 })).status).toBe(400)
    expect((await request(app).post('/api/v1/closures').set(...auth).send({ ...at, inCoreCount: 9 })).status).toBe(400)
  })

  it('leaves the whole sheet optional — a closure dropped from the editor still saves', async () => {
    const res = await request(app).post('/api/v1/closures').set(...auth).send({ ...at, kind: 'Tiffin' })
    expect(res.status).toBe(201)
    made.push(res.body.data.id)
    expect(res.body.data.fiberType).toBeNull()
    expect(res.body.data.tubeCount).toBeNull()
  })
})

describe('a closure dropped while drawing', () => {
  it('carries the sheet the card collected, not just its kind', async () => {
    const zoneId = (await prisma.zone.findFirst()).id
    const res = await request(app)
      .post('/api/v1/fibers')
      .set(...auth)
      .send({
        name: `CS-FIB-${STAMP}`,
        coreCount: 2,
        zoneId,
        points: [
          { latitude: 18.61, longitude: 73.77 },
          {
            type: 'CLOSURE',
            latitude: 18.611,
            longitude: 73.771,
            newClosure: { kind: 'FDC', fiberType: 'DROP_CABLE', tubeCount: 1, inCoreCount: 24, outCoreCount: 12 },
          },
        ],
      })
    expect(res.status).toBe(201)
    const closureId = res.body.data.points.find((p) => p.type === 'CLOSURE').closureId
    const saved = await prisma.closure.findUnique({ where: { id: closureId } })
    expect(saved).toMatchObject({
      kind: 'FDC',
      fiberType: 'DROP_CABLE',
      tubeCount: 1,
      inCoreCount: 24,
      outCoreCount: 12,
    })
    await request(app).delete(`/api/v1/fibers/${res.body.data.id}`).set(...auth)
    await prisma.closure.deleteMany({ where: { id: closureId } })
  })
})
