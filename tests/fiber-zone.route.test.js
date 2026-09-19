import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const STAMP = Date.now()
const IDS = { surveyor: `fz-surv-${STAMP}`, manager: `fz-mgr-${STAMP}` }
const app = createApp()
const auth = (id) => [
  'Authorization',
  `Bearer ${jwt.sign({ sub: id, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]

let myZoneId = null
let otherZoneId = null
let operatorId = null
const created = []

const line = [
  { latitude: 18.6, longitude: 73.76 },
  { latitude: 18.601, longitude: 73.762 },
]
const body = (extra) => ({ coreCount: 2, points: line, ...extra })

beforeAll(async () => {
  const zones = await prisma.zone.findMany({ take: 2 })
  myZoneId = zones[0].id
  otherZoneId = zones[1]?.id ?? zones[0].id
  operatorId = (await prisma.operator.findFirst())?.id ?? null
  await prisma.user.create({
    data: {
      id: IDS.surveyor,
      name: 'FZ Surveyor',
      email: `${IDS.surveyor}@vitest.local`,
      passwordHash: 'x',
      role: 'SURVEYOR',
      canManageFiber: true,
      assignedZones: { connect: { id: myZoneId } },
    },
  })
  await prisma.user.create({
    data: {
      id: IDS.manager,
      name: 'FZ Manager',
      email: `${IDS.manager}@vitest.local`,
      passwordHash: 'x',
      role: 'MANAGER',
      canManageFiber: true,
    },
  })
})

afterAll(async () => {
  // As an ADMIN: the surveyor's fibers are theirs alone, so the manager would
  // get a 404 and leave them behind.
  for (const id of created) {
    await request(app).delete(`/api/v1/fibers/${id}`).set(...auth('test-admin'))
  }
  const ids = Object.values(IDS)
  await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

const create = (actorId, extra) =>
  request(app).post('/api/v1/fibers').set(...auth(actorId)).send(body(extra))

describe('a fiber records its zone', () => {
  it('refuses a fiber with no zone — the map filter depends on it', async () => {
    const res = await create(IDS.manager, {})
    expect(res.status).toBe(400)
  })

  it('saves the zone and the operator, and hands both back', async () => {
    const res = await create(IDS.manager, { zoneId: myZoneId, operatorId })
    expect(res.status).toBe(201)
    created.push(res.body.data.id)
    expect(res.body.data.zoneId).toBe(myZoneId)
    expect(res.body.data.zone.name).toBeTruthy()
    if (operatorId) expect(res.body.data.operatorId).toBe(operatorId)
  })

  it('refuses a zone that does not exist', async () => {
    const res = await create(IDS.manager, { zoneId: 'no-such-zone' })
    expect(res.status).toBe(400)
  })
})

describe('a surveyor draws only inside their own zones', () => {
  it('lets them save a fiber in a zone they are assigned to', async () => {
    const res = await create(IDS.surveyor, { zoneId: myZoneId })
    expect(res.status).toBe(201)
    created.push(res.body.data.id)
  })

  it('refuses a zone they are not assigned to', async () => {
    if (otherZoneId === myZoneId) return
    const res = await create(IDS.surveyor, { zoneId: otherZoneId })
    expect(res.status).toBe(403)
  })

  it('refuses moving an existing fiber into a zone they are not assigned to', async () => {
    if (otherZoneId === myZoneId) return
    const mine = await create(IDS.surveyor, { zoneId: myZoneId })
    created.push(mine.body.data.id)
    const res = await request(app)
      .patch(`/api/v1/fibers/${mine.body.data.id}`)
      .set(...auth(IDS.surveyor))
      .send({ zoneId: otherZoneId })
    expect(res.status).toBe(403)
  })

  it('does not restrict a manager, who works every zone', async () => {
    const res = await create(IDS.manager, { zoneId: otherZoneId })
    expect(res.status).toBe(201)
    created.push(res.body.data.id)
  })
})

describe('the fiber list carries the zone', () => {
  it('includes zoneId on every row, so the map can filter without another call', async () => {
    const res = await request(app).get('/api/v1/fibers').set(...auth(IDS.manager))
    expect(res.status).toBe(200)
    const mine = res.body.data.find((f) => created.includes(f.id))
    expect(mine.zoneId).toBeTruthy()
  })
})
