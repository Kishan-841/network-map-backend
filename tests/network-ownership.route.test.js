import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

// Fibers, closures, POPs and splitters are private: their creator and an ADMIN
// see them, nobody else — managers and supervisors included.
const STAMP = Date.now()
const IDS = {
  admin: `own-admin-${STAMP}`,
  alice: `own-alice-${STAMP}`,
  bob: `own-bob-${STAMP}`,
  manager: `own-mgr-${STAMP}`,
}
const app = createApp()
const as = (id) => [
  'Authorization',
  `Bearer ${jwt.sign({ sub: id, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]
let zoneId = null
const mine = {}
const line = (lat = 18.6, lng = 73.76) => [
  { latitude: lat, longitude: lng },
  { latitude: lat + 0.001, longitude: lng + 0.002 },
]

beforeAll(async () => {
  zoneId = (await prisma.zone.findFirst()).id
  const users = [
    { id: IDS.admin, role: 'ADMIN' },
    { id: IDS.alice, role: 'SURVEYOR', canManageFiber: true },
    { id: IDS.bob, role: 'SURVEYOR', canManageFiber: true },
    { id: IDS.manager, role: 'MANAGER', canManageFiber: true },
  ]
  for (const user of users) {
    await prisma.user.create({
      data: {
        name: `OWN ${user.role}`,
        email: `${user.id}@vitest.local`,
        passwordHash: 'x',
        ...user,
        ...(user.role === 'SURVEYOR' && { assignedZones: { connect: { id: zoneId } } }),
      },
    })
  }

  // Alice's world: a POP, a fiber carrying a new closure and a new splitter,
  // and a closure made on its own.
  const pop = await request(app)
    .post('/api/v1/pops')
    .set(...as(IDS.alice))
    .send({ name: `OWN POP ${STAMP}`, zoneId, latitude: 18.6, longitude: 73.76 })
  mine.pop = pop.body.data.id
  const fiber = await request(app)
    .post('/api/v1/fibers')
    .set(...as(IDS.alice))
    .send({
      name: `OWN-FIB-${STAMP}`,
      coreCount: 2,
      zoneId,
      points: [
        { latitude: 18.6, longitude: 73.76 },
        { type: 'CLOSURE', latitude: 18.6005, longitude: 73.761, newClosure: { kind: 'Jumbo' } },
        {
          type: 'SPLITTER',
          latitude: 18.6008,
          longitude: 73.7615,
          newSplitter: { ratio: 'R1_6', location: 'S1' },
        },
        { latitude: 18.601, longitude: 73.762 },
      ],
    })
  mine.fiber = fiber.body.data.id
  mine.fiberClosure = fiber.body.data.points.find((p) => p.type === 'CLOSURE').closureId
  mine.splitter = fiber.body.data.points.find((p) => p.type === 'SPLITTER').splitterId
  const closure = await request(app)
    .post('/api/v1/closures')
    .set(...as(IDS.alice))
    .send({ latitude: 18.61, longitude: 73.77, kind: 'FDC' })
  mine.closure = closure.body.data.id
})

afterAll(async () => {
  const ids = Object.values(IDS)
  const fibers = await prisma.fiber.findMany({ where: { createdById: { in: ids } }, select: { id: true } })
  for (const { id } of fibers) await request(app).delete(`/api/v1/fibers/${id}`).set(...as(IDS.admin))
  await prisma.fiber.deleteMany({ where: { name: { startsWith: 'OWN-' } } })
  await prisma.splitter.deleteMany({ where: { createdById: { in: ids } } })
  await prisma.closure.deleteMany({ where: { createdById: { in: ids } } })
  await prisma.pop.deleteMany({ where: { createdById: { in: ids } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

const listIds = async (path, who) =>
  (await request(app).get(`/api/v1/${path}`).set(...as(who))).body.data.map((row) => row.id)

describe('what a creator sees', () => {
  it('records who made each thing', async () => {
    for (const [model, id] of [
      [prisma.pop, mine.pop],
      [prisma.fiber, mine.fiber],
      [prisma.closure, mine.closure],
      [prisma.closure, mine.fiberClosure],
      [prisma.splitter, mine.splitter],
    ]) {
      expect((await model.findUnique({ where: { id } })).createdById).toBe(IDS.alice)
    }
  })

  it('lists their own POPs, fibers and closures', async () => {
    expect(await listIds('pops', IDS.alice)).toContain(mine.pop)
    expect(await listIds('fibers', IDS.alice)).toContain(mine.fiber)
    const closures = await listIds('closures', IDS.alice)
    expect(closures).toContain(mine.closure)
    expect(closures).toContain(mine.fiberClosure)
  })
})

describe('what everyone else sees — another surveyor, and a manager', () => {
  for (const who of ['bob', 'manager']) {
    it(`${who} does not find them in any list`, async () => {
      expect(await listIds('pops', IDS[who])).not.toContain(mine.pop)
      expect(await listIds('fibers', IDS[who])).not.toContain(mine.fiber)
      expect(await listIds('closures', IDS[who])).not.toContain(mine.closure)
    })

    it(`${who} gets "not found", not "forbidden", for each one by id`, async () => {
      expect((await request(app).get(`/api/v1/fibers/${mine.fiber}`).set(...as(IDS[who]))).status).toBe(404)
      expect((await request(app).get(`/api/v1/closures/${mine.closure}`).set(...as(IDS[who]))).status).toBe(404)
    })

    it(`${who} cannot change or remove them`, async () => {
      const tries = [
        request(app).patch(`/api/v1/pops/${mine.pop}`).set(...as(IDS[who])).send({ notes: 'x' }),
        request(app).delete(`/api/v1/pops/${mine.pop}`).set(...as(IDS[who])),
        request(app).patch(`/api/v1/fibers/${mine.fiber}`).set(...as(IDS[who])).send({ notes: 'x' }),
        request(app).patch(`/api/v1/closures/${mine.closure}`).set(...as(IDS[who])).send({ notes: 'x' }),
        request(app).delete(`/api/v1/closures/${mine.closure}`).set(...as(IDS[who])),
        request(app).patch(`/api/v1/splitters/${mine.splitter}`).set(...as(IDS[who])).send({ location: 'S2' }),
      ]
      for (const res of await Promise.all(tries)) expect(res.status).toBe(404)
    })
  }

  it('another surveyor cannot run their own line from Alice\'s POP', async () => {
    const res = await request(app)
      .post('/api/v1/fibers')
      .set(...as(IDS.bob))
      .send({
        name: `OWN-BOB-${STAMP}`,
        coreCount: 2,
        zoneId,
        points: [
          { type: 'POP', popId: mine.pop, latitude: 18.6, longitude: 73.76 },
          { latitude: 18.602, longitude: 73.763 },
        ],
      })
    expect([400, 404]).toContain(res.status)
  })
})

describe('what an ADMIN sees', () => {
  it('everything', async () => {
    expect(await listIds('pops', IDS.admin)).toContain(mine.pop)
    expect(await listIds('fibers', IDS.admin)).toContain(mine.fiber)
    expect(await listIds('closures', IDS.admin)).toContain(mine.closure)
  })

  it('adding a closure to Alice\'s fiber leaves it Alice\'s — she must see what is on her own line', async () => {
    const fiber = (await request(app).get(`/api/v1/fibers/${mine.fiber}`).set(...as(IDS.admin))).body.data
    const points = fiber.points.map((p) => ({
      type: p.type,
      latitude: p.latitude,
      longitude: p.longitude,
      ...(p.closureId && { closureId: p.closureId }),
      ...(p.splitterId && { splitterId: p.splitterId }),
      ...(p.popId && { popId: p.popId }),
    }))
    points.splice(points.length - 1, 0, {
      type: 'CLOSURE',
      latitude: 18.6009,
      longitude: 73.7618,
      newClosure: { kind: 'Tiffin' },
    })
    const res = await request(app).patch(`/api/v1/fibers/${mine.fiber}`).set(...as(IDS.admin)).send({ points })
    expect(res.status).toBe(200)
    const added = res.body.data.points.filter((p) => p.type === 'CLOSURE').map((p) => p.closureId)
    const newest = added.find((id) => id !== mine.fiberClosure)
    expect((await prisma.closure.findUnique({ where: { id: newest } })).createdById).toBe(IDS.alice)
    expect(await listIds('closures', IDS.alice)).toContain(newest)
  })
})

describe('rows nobody can be traced to', () => {
  it('are the ADMIN\'s alone', async () => {
    const orphan = await prisma.pop.create({
      data: { name: `OWN POP orphan ${STAMP}`, latitude: 18.5, longitude: 73.8, zoneId },
    })
    expect(await listIds('pops', IDS.admin)).toContain(orphan.id)
    expect(await listIds('pops', IDS.alice)).not.toContain(orphan.id)
    expect(await listIds('pops', IDS.manager)).not.toContain(orphan.id)
    await prisma.pop.delete({ where: { id: orphan.id } })
  })
})

describe('GET /pops/:id — one POP in full, for the detail drawer', () => {
  it('gives the maker every field, who added it, and the fibers there', async () => {
    const res = await request(app).get(`/api/v1/pops/${mine.pop}`).set(...as(IDS.alice))
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: mine.pop, zone: { id: zoneId }, createdBy: { id: IDS.alice } })
    expect(Array.isArray(res.body.data.olts)).toBe(true)
    expect(Array.isArray(res.body.data.devices)).toBe(true)
    expect(Array.isArray(res.body.data.fibers)).toBe(true)
  })

  it('answers 404 to another surveyor and to a manager', async () => {
    for (const who of [IDS.bob, IDS.manager]) {
      expect((await request(app).get(`/api/v1/pops/${mine.pop}`).set(...as(who))).status).toBe(404)
    }
  })

  it('opens for an ADMIN', async () => {
    expect((await request(app).get(`/api/v1/pops/${mine.pop}`).set(...as(IDS.admin))).status).toBe(200)
  })

  it('names who added a fiber and a closure too', async () => {
    const fiber = await request(app).get(`/api/v1/fibers/${mine.fiber}`).set(...as(IDS.alice))
    expect(fiber.body.data.createdBy).toMatchObject({ id: IDS.alice })
    const closure = await request(app).get(`/api/v1/closures/${mine.closure}`).set(...as(IDS.alice))
    expect(closure.body.data.createdBy).toMatchObject({ id: IDS.alice })
  })
})
