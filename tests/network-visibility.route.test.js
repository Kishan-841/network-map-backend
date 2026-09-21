import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

/**
 * Who sees a fiber, POP, closure or splitter: anyone assigned to its ZONE,
 * whoever added it, and an ADMIN. Nobody else. A closure or splitter has no
 * zone of its own — it inherits the zone of the fiber it sits on.
 */
const STAMP = Date.now()
const IDS = {
  admin: `zv-admin-${STAMP}`,
  alice: `zv-alice-${STAMP}`, // zone 1, made everything below
  bob: `zv-bob-${STAMP}`, // zone 1 too — a colleague on the same patch
  carol: `zv-carol-${STAMP}`, // zone 2
  manager: `zv-mgr-${STAMP}`, // no zones at all
}
const app = createApp()
const as = (id) => [
  'Authorization',
  `Bearer ${jwt.sign({ sub: id, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]
let zone1 = null
let zone2 = null
const mine = {}

beforeAll(async () => {
  const zones = await prisma.zone.findMany({ take: 2, orderBy: { name: 'asc' } })
  zone1 = zones[0].id
  zone2 = zones[1]?.id ?? zones[0].id
  const users = [
    { id: IDS.admin, role: 'ADMIN' },
    { id: IDS.alice, role: 'SURVEYOR', canManageFiber: true, zone: zone1 },
    { id: IDS.bob, role: 'SURVEYOR', canManageFiber: true, zone: zone1 },
    { id: IDS.carol, role: 'SURVEYOR', canManageFiber: true, zone: zone2 },
    { id: IDS.manager, role: 'MANAGER', canManageFiber: true },
  ]
  for (const { zone, ...user } of users) {
    await prisma.user.create({
      data: {
        name: `ZV ${user.id}`,
        email: `${user.id}@vitest.local`,
        passwordHash: 'x',
        ...user,
        ...(zone && { assignedZones: { connect: { id: zone } } }),
      },
    })
  }

  // Alice's patch: a POP and a fiber carrying a closure and a splitter, all in zone 1.
  const pop = await request(app)
    .post('/api/v1/pops')
    .set(...as(IDS.alice))
    .send({ name: `ZV POP ${STAMP}`, zoneId: zone1, latitude: 18.6, longitude: 73.76 })
  mine.pop = pop.body.data.id
  const fiber = await request(app)
    .post('/api/v1/fibers')
    .set(...as(IDS.alice))
    .send({
      name: `ZV-FIB-${STAMP}`,
      coreCount: 2,
      zoneId: zone1,
      points: [
        { type: 'POP', popId: mine.pop, latitude: 18.6, longitude: 73.76 },
        { type: 'CLOSURE', latitude: 18.6005, longitude: 73.761, newClosure: { kind: 'Jumbo' } },
        { type: 'SPLITTER', latitude: 18.6008, longitude: 73.7615, newSplitter: { ratio: 'R1_6', location: 'S1' } },
        { latitude: 18.601, longitude: 73.762 },
      ],
    })
  mine.fiber = fiber.body.data.id
  mine.closure = fiber.body.data.points.find((p) => p.type === 'CLOSURE').closureId
  mine.splitter = fiber.body.data.points.find((p) => p.type === 'SPLITTER').splitterId

  // A closure on no fiber at all, and a fiber and POP from before zones were
  // recorded: nothing gives these a zone, so only Alice and an ADMIN see them.
  const loose = await request(app)
    .post('/api/v1/closures')
    .set(...as(IDS.alice))
    .send({ latitude: 18.62, longitude: 73.78, kind: 'FDC' })
  mine.looseClosure = loose.body.data.id
  mine.unzonedFiber = (
    await prisma.fiber.create({ data: { name: `ZV-NOZONE-${STAMP}`, coreCount: 2, createdById: IDS.alice } })
  ).id
  mine.unzonedPop = (
    await prisma.pop.create({
      data: { name: `ZV POP nozone ${STAMP}`, latitude: 18.63, longitude: 73.79, createdById: IDS.alice },
    })
  ).id
})

afterAll(async () => {
  const ids = Object.values(IDS)
  for (const id of [mine.fiber, mine.unzonedFiber]) {
    if (id) await request(app).delete(`/api/v1/fibers/${id}`).set(...as(IDS.admin))
  }
  await prisma.fiber.deleteMany({ where: { name: { startsWith: 'ZV-' } } })
  await prisma.splitter.deleteMany({ where: { createdById: { in: ids } } })
  await prisma.closure.deleteMany({ where: { createdById: { in: ids } } })
  await prisma.pop.deleteMany({ where: { createdById: { in: ids } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

const listIds = async (path, who) =>
  (await request(app).get(`/api/v1/${path}`).set(...as(who))).body.data.map((row) => row.id)
const status = async (path, who) => (await request(app).get(`/api/v1/${path}`).set(...as(who))).status

describe('a colleague assigned to the same zone', () => {
  it('sees the POP, the fiber and the closure on it', async () => {
    expect(await listIds('pops', IDS.bob)).toContain(mine.pop)
    expect(await listIds('fibers', IDS.bob)).toContain(mine.fiber)
    expect(await listIds('closures', IDS.bob)).toContain(mine.closure)
  })

  it('can open each one by id', async () => {
    expect(await status(`pops/${mine.pop}`, IDS.bob)).toBe(200)
    expect(await status(`fibers/${mine.fiber}`, IDS.bob)).toBe(200)
    expect(await status(`closures/${mine.closure}`, IDS.bob)).toBe(200)
  })

  it('can work on them — the zone is a shared patch, not a private one', async () => {
    const edit = await request(app)
      .patch(`/api/v1/closures/${mine.closure}`)
      .set(...as(IDS.bob))
      .send({ notes: 'Checked by Bob' })
    expect(edit.status).toBe(200)
    const splitter = await request(app)
      .patch(`/api/v1/splitters/${mine.splitter}`)
      .set(...as(IDS.bob))
      .send({ location: 'S2' })
    expect(splitter.status).toBe(200)
  })

  it('can run their own fiber from the POP on that patch', async () => {
    const res = await request(app)
      .post('/api/v1/fibers')
      .set(...as(IDS.bob))
      .send({
        name: `ZV-BOB-${STAMP}`,
        coreCount: 2,
        zoneId: zone1,
        points: [
          { type: 'POP', popId: mine.pop, latitude: 18.6, longitude: 73.76 },
          { latitude: 18.604, longitude: 73.766 },
        ],
      })
    expect(res.status).toBe(201)
    await request(app).delete(`/api/v1/fibers/${res.body.data.id}`).set(...as(IDS.bob))
  })
})

describe('someone assigned to a different zone', () => {
  it('finds none of it in a list', async () => {
    if (zone1 === zone2) return
    expect(await listIds('pops', IDS.carol)).not.toContain(mine.pop)
    expect(await listIds('fibers', IDS.carol)).not.toContain(mine.fiber)
    expect(await listIds('closures', IDS.carol)).not.toContain(mine.closure)
  })

  it('gets "not found", not "forbidden", by id', async () => {
    if (zone1 === zone2) return
    expect(await status(`pops/${mine.pop}`, IDS.carol)).toBe(404)
    expect(await status(`fibers/${mine.fiber}`, IDS.carol)).toBe(404)
    expect(await status(`closures/${mine.closure}`, IDS.carol)).toBe(404)
  })

  it('cannot change or remove any of it', async () => {
    if (zone1 === zone2) return
    const tries = [
      request(app).patch(`/api/v1/pops/${mine.pop}`).set(...as(IDS.carol)).send({ notes: 'x' }),
      request(app).delete(`/api/v1/pops/${mine.pop}`).set(...as(IDS.carol)),
      request(app).patch(`/api/v1/fibers/${mine.fiber}`).set(...as(IDS.carol)).send({ notes: 'x' }),
      request(app).patch(`/api/v1/closures/${mine.closure}`).set(...as(IDS.carol)).send({ notes: 'x' }),
      request(app).patch(`/api/v1/splitters/${mine.splitter}`).set(...as(IDS.carol)).send({ location: 'S3' }),
    ]
    for (const res of await Promise.all(tries)) expect(res.status).toBe(404)
  })
})

describe('someone with no zones assigned at all', () => {
  it('sees only what they added themselves', async () => {
    expect(await listIds('fibers', IDS.manager)).not.toContain(mine.fiber)
    expect(await status(`fibers/${mine.fiber}`, IDS.manager)).toBe(404)
    const own = await request(app)
      .post('/api/v1/fibers')
      .set(...as(IDS.manager))
      .send({
        name: `ZV-MGR-${STAMP}`,
        coreCount: 2,
        zoneId: zone2,
        points: [
          { latitude: 18.64, longitude: 73.8 },
          { latitude: 18.641, longitude: 73.801 },
        ],
      })
    expect(own.status).toBe(201)
    // Their own work stays theirs even though the zone is not on their list.
    expect(await listIds('fibers', IDS.manager)).toContain(own.body.data.id)
    await request(app).delete(`/api/v1/fibers/${own.body.data.id}`).set(...as(IDS.manager))
  })
})

describe('what has no zone to go by', () => {
  it('stays with whoever added it, and an ADMIN', async () => {
    expect(await listIds('fibers', IDS.alice)).toContain(mine.unzonedFiber)
    expect(await listIds('fibers', IDS.bob)).not.toContain(mine.unzonedFiber)
    expect(await listIds('fibers', IDS.admin)).toContain(mine.unzonedFiber)

    expect(await listIds('pops', IDS.bob)).not.toContain(mine.unzonedPop)
    expect(await listIds('pops', IDS.admin)).toContain(mine.unzonedPop)
  })

  it('applies to a closure sitting on no fiber at all', async () => {
    expect(await listIds('closures', IDS.alice)).toContain(mine.looseClosure)
    expect(await listIds('closures', IDS.bob)).not.toContain(mine.looseClosure)
    expect(await listIds('closures', IDS.admin)).toContain(mine.looseClosure)
  })
})

describe('moving a fiber to another zone moves who can see it', () => {
  it('hands it from one patch to the other', async () => {
    if (zone1 === zone2) return
    const moved = await request(app)
      .patch(`/api/v1/fibers/${mine.fiber}`)
      .set(...as(IDS.admin))
      .send({ zoneId: zone2 })
    expect(moved.status).toBe(200)

    expect(await listIds('fibers', IDS.carol)).toContain(mine.fiber)
    expect(await listIds('fibers', IDS.bob)).not.toContain(mine.fiber)
    // The closure on it goes with it — it has no zone of its own.
    expect(await listIds('closures', IDS.carol)).toContain(mine.closure)
    expect(await listIds('closures', IDS.bob)).not.toContain(mine.closure)
    // Alice still sees her own work wherever it now runs.
    expect(await listIds('fibers', IDS.alice)).toContain(mine.fiber)

    await request(app).patch(`/api/v1/fibers/${mine.fiber}`).set(...as(IDS.admin)).send({ zoneId: zone1 })
  })
})

describe('an ADMIN', () => {
  it('sees everything, zone or no zone', async () => {
    expect(await listIds('pops', IDS.admin)).toContain(mine.pop)
    expect(await listIds('fibers', IDS.admin)).toContain(mine.fiber)
    expect(await listIds('closures', IDS.admin)).toContain(mine.closure)
  })

  it('adding a closure to a fiber leaves it owned by the fiber\'s owner', async () => {
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
    const newest = added.find((id) => id !== mine.closure)
    expect((await prisma.closure.findUnique({ where: { id: newest } })).createdById).toBe(IDS.alice)
  })
})

describe('GET /pops/:id — one POP in full, for the detail drawer', () => {
  it('opens for the maker, a colleague in the zone, and an ADMIN', async () => {
    for (const who of [IDS.alice, IDS.bob, IDS.admin]) {
      expect(await status(`pops/${mine.pop}`, who)).toBe(200)
    }
    const res = await request(app).get(`/api/v1/pops/${mine.pop}`).set(...as(IDS.bob))
    expect(res.body.data).toMatchObject({ id: mine.pop, zone: { id: zone1 }, createdBy: { id: IDS.alice } })
    expect(res.body.data.fibers.map((f) => f.id)).toContain(mine.fiber)
  })

  it('answers 404 to another zone and to someone with no zones', async () => {
    if (zone1 !== zone2) expect(await status(`pops/${mine.pop}`, IDS.carol)).toBe(404)
    expect(await status(`pops/${mine.pop}`, IDS.manager)).toBe(404)
  })

  it('names who added a fiber and a closure too', async () => {
    const fiber = await request(app).get(`/api/v1/fibers/${mine.fiber}`).set(...as(IDS.bob))
    expect(fiber.body.data.createdBy).toMatchObject({ id: IDS.alice })
    const closure = await request(app).get(`/api/v1/closures/${mine.closure}`).set(...as(IDS.bob))
    expect(closure.body.data.createdBy).toMatchObject({ id: IDS.alice })
  })
})
