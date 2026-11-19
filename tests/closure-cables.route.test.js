import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { CLOSURE_CABLE_CORES } from '../src/lib/fiber-constants.js'

const STAMP = Date.now()
const ADMIN = `cc-admin-${STAMP}`
const app = createApp()
const auth = [
  'Authorization',
  `Bearer ${jwt.sign({ sub: ADMIN, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]
const made = []
const at = { latitude: 18.62, longitude: 73.78 }

const post = (body) => request(app).post('/api/v1/closures').set(...auth).send({ ...at, ...body })
const patch = (id, body) => request(app).patch(`/api/v1/closures/${id}`).set(...auth).send(body)
const strip = (cables) => cables.map(({ direction, cableType, coreCount, cableTag }) => ({ direction, cableType, coreCount, cableTag }))

async function closureWith(cables) {
  const res = await post({ kind: 'FDC', cables })
  expect(res.status).toBe(201)
  made.push(res.body.data.id)
  return res.body.data
}

beforeAll(async () => {
  await prisma.user.create({
    data: { id: ADMIN, name: 'CC Admin', email: `${ADMIN}@vitest.local`, passwordHash: 'x', role: 'ADMIN' },
  })
})

afterAll(async () => {
  for (const id of made) await request(app).delete(`/api/v1/closures/${id}`).set(...auth)
  await prisma.systemLog.deleteMany({ where: { userId: ADMIN } })
  await prisma.user.deleteMany({ where: { id: ADMIN } })
})

describe('closure In / Out cables', () => {
  it('offers 2, 4, 6, 8, 12, 24 and 48 cores', () => {
    expect(CLOSURE_CABLE_CORES).toEqual([2, 4, 6, 8, 12, 24, 48])
  })

  it('saves In and Out cables in order', async () => {
    const closure = await closureWith([
      { direction: 'OUT', cableType: 'SUB_SF', coreCount: 6, cableTag: ' OUT-A ' },
      { direction: 'IN', cableType: 'MAIN_SF', coreCount: 12, cableTag: 'IN-1' },
      { direction: 'OUT', cableType: 'DROP_CABLE', coreCount: 2, cableTag: 'OUT-B' },
    ])
    expect(strip(closure.cables)).toEqual([
      { direction: 'IN', cableType: 'MAIN_SF', coreCount: 12, cableTag: 'IN-1' },
      { direction: 'OUT', cableType: 'SUB_SF', coreCount: 6, cableTag: 'OUT-A' },
      { direction: 'OUT', cableType: 'DROP_CABLE', coreCount: 2, cableTag: 'OUT-B' },
    ])
    const read = await request(app).get(`/api/v1/closures/${closure.id}`).set(...auth)
    expect(strip(read.body.data.cables)).toEqual(strip(closure.cables))
  })

  it('keeps a row with only some fields filled, and an empty fiber ID as none', async () => {
    const closure = await closureWith([{ direction: 'IN', coreCount: 8, cableTag: '  ' }])
    expect(strip(closure.cables)).toEqual([{ direction: 'IN', cableType: null, coreCount: 8, cableTag: null }])
  })

  it('rejects a bad core count, direction, cable type, or more than 40 rows', async () => {
    expect((await post({ cables: [{ direction: 'IN', coreCount: 9 }] })).status).toBe(400)
    expect((await post({ cables: [{ direction: 'SIDE' }] })).status).toBe(400)
    expect((await post({ cables: [{ direction: 'IN', cableType: 'COPPER' }] })).status).toBe(400)
    expect((await post({ cables: [{ direction: 'IN', cableTag: 'x'.repeat(61) }] })).status).toBe(400)
    const many = Array.from({ length: 41 }, () => ({ direction: 'OUT' }))
    expect((await post({ cables: many })).status).toBe(400)
  })

  it('replaces the list on update', async () => {
    const closure = await closureWith([
      { direction: 'IN', coreCount: 12 },
      { direction: 'OUT', coreCount: 6 },
    ])
    const one = await patch(closure.id, { cables: [{ direction: 'OUT', coreCount: 4, cableTag: 'NEW' }] })
    expect(one.status).toBe(200)
    expect(strip(one.body.data.cables)).toEqual([{ direction: 'OUT', cableType: null, coreCount: 4, cableTag: 'NEW' }])
    const none = await patch(closure.id, { cables: [] })
    expect(none.body.data.cables).toEqual([])
  })

  it('keeps the list when an update does not mention cables', async () => {
    const closure = await closureWith([{ direction: 'IN', coreCount: 24, cableTag: 'KEEP' }])
    const res = await patch(closure.id, { notes: 'moved the lid', latitude: 18.621, longitude: 73.781 })
    expect(res.status).toBe(200)
    expect(strip(res.body.data.cables)).toEqual([{ direction: 'IN', cableType: null, coreCount: 24, cableTag: 'KEEP' }])
  })

  it('deletes the cable rows with the closure', async () => {
    const res = await post({ cables: [{ direction: 'IN', coreCount: 2 }] })
    const id = res.body.data.id
    expect((await request(app).delete(`/api/v1/closures/${id}`).set(...auth)).status).toBeLessThan(300)
    expect(await prisma.closureCable.count({ where: { closureId: id } })).toBe(0)
  })
})

describe('a closure dropped while drawing', () => {
  it('keeps the In / Out cables the card collected', async () => {
    const zoneId = (await prisma.zone.findFirst()).id
    const res = await request(app)
      .post('/api/v1/fibers')
      .set(...auth)
      .send({
        name: `CC-FIB-${STAMP}`,
        coreCount: 2,
        zoneId,
        points: [
          { latitude: 18.62, longitude: 73.78 },
          {
            type: 'CLOSURE',
            latitude: 18.621,
            longitude: 73.781,
            newClosure: {
              kind: 'Jumbo',
              cables: [
                { direction: 'IN', cableType: 'MAIN_SF', coreCount: 48, cableTag: 'DRAW-IN' },
                { direction: 'OUT', cableType: 'SUB_SF', coreCount: 8, cableTag: 'DRAW-OUT' },
              ],
            },
          },
        ],
      })
    expect(res.status).toBe(201)
    const closureId = res.body.data.points.find((p) => p.type === 'CLOSURE').closureId
    const rows = await prisma.closureCable.findMany({ where: { closureId }, orderBy: [{ direction: 'asc' }, { position: 'asc' }] })
    expect(strip(rows)).toEqual([
      { direction: 'IN', cableType: 'MAIN_SF', coreCount: 48, cableTag: 'DRAW-IN' },
      { direction: 'OUT', cableType: 'SUB_SF', coreCount: 8, cableTag: 'DRAW-OUT' },
    ])
    await request(app).delete(`/api/v1/fibers/${res.body.data.id}`).set(...auth)
    await prisma.closure.deleteMany({ where: { id: closureId } })
  })
})
