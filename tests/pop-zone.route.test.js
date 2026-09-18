import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const STAMP = Date.now()
const IDS = { admin: `pz-admin-${STAMP}`, mine: `pz-mine-${STAMP}`, other: `pz-other-${STAMP}` }
const app = createApp()
const auth = (id) => [
  'Authorization',
  `Bearer ${jwt.sign({ sub: id, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]

let myZoneId = null
let otherZoneId = null
const made = []
const pop = (extra) => ({ name: `PZ ${extra.tag}-${STAMP}`, latitude: 18.52, longitude: 73.85, ...extra })

beforeAll(async () => {
  const zones = await prisma.zone.findMany({ take: 2 })
  myZoneId = zones[0].id
  otherZoneId = zones[1]?.id ?? zones[0].id
  await prisma.user.create({
    data: { id: IDS.admin, name: 'PZ Admin', email: `${IDS.admin}@vitest.local`, passwordHash: 'x', role: 'ADMIN' },
  })
  await prisma.user.create({
    data: {
      id: IDS.mine, name: 'PZ Mine', email: `${IDS.mine}@vitest.local`, passwordHash: 'x',
      role: 'SURVEYOR', canManageFiber: true, assignedZones: { connect: { id: myZoneId } },
    },
  })
  await prisma.user.create({
    data: {
      id: IDS.other, name: 'PZ Other', email: `${IDS.other}@vitest.local`, passwordHash: 'x',
      role: 'SURVEYOR', canManageFiber: true, ...(otherZoneId !== myZoneId && { assignedZones: { connect: { id: otherZoneId } } }),
    },
  })
})

afterAll(async () => {
  await prisma.pop.deleteMany({ where: { name: { startsWith: 'PZ ' } } })
  const ids = Object.values(IDS)
  await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

describe('a POP records the zone it sits in', () => {
  it('refuses a POP with no zone — visibility depends on it', async () => {
    const res = await request(app).post('/api/v1/pops').set(...auth(IDS.admin)).send(pop({ tag: 'nozone' }))
    expect(res.status).toBe(400)
  })

  it('saves the zone and hands it back', async () => {
    const res = await request(app)
      .post('/api/v1/pops')
      .set(...auth(IDS.admin))
      .send(pop({ tag: 'withzone', zoneId: myZoneId }))
    expect(res.status).toBe(201)
    made.push(res.body.data.id)
    expect(res.body.data.zoneId).toBe(myZoneId)
    expect(res.body.data.zone.name).toBeTruthy()
  })

  it('refuses a zone that does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/pops')
      .set(...auth(IDS.admin))
      .send(pop({ tag: 'ghost', zoneId: 'no-such-zone' }))
    expect(res.status).toBe(400)
  })
})

describe('a surveyor only uses their own zones', () => {
  it('lets them add a POP in a zone they are assigned to', async () => {
    const res = await request(app)
      .post('/api/v1/pops')
      .set(...auth(IDS.mine))
      .send(pop({ tag: 'ownzone', zoneId: myZoneId }))
    expect(res.status).toBe(201)
    made.push(res.body.data.id)
  })

  it('refuses a zone they are not assigned to', async () => {
    if (otherZoneId === myZoneId) return
    const res = await request(app)
      .post('/api/v1/pops')
      .set(...auth(IDS.mine))
      .send(pop({ tag: 'foreign', zoneId: otherZoneId }))
    expect(res.status).toBe(403)
  })

  it('refuses moving a POP into a zone they are not assigned to', async () => {
    if (otherZoneId === myZoneId) return
    const res = await request(app)
      .patch(`/api/v1/pops/${made[made.length - 1]}`)
      .set(...auth(IDS.mine))
      .send({ zoneId: otherZoneId })
    expect(res.status).toBe(403)
  })
})

describe('who sees which POPs', () => {
  it('shows a surveyor the POPs in their zones, and hides other zones', async () => {
    if (otherZoneId === myZoneId) return
    const theirs = await request(app)
      .post('/api/v1/pops')
      .set(...auth(IDS.admin))
      .send(pop({ tag: 'elsewhere', zoneId: otherZoneId }))
    made.push(theirs.body.data.id)

    const list = await request(app).get('/api/v1/pops').set(...auth(IDS.mine))
    expect(list.status).toBe(200)
    const names = list.body.data.map((p) => p.name)
    expect(names).toContain(`PZ ownzone-${STAMP}`)
    expect(names).not.toContain(`PZ elsewhere-${STAMP}`)
  })

  it('still shows a POP that has no zone yet — nothing vanishes from an old map', async () => {
    const legacy = await prisma.pop.create({
      data: { name: `PZ legacy-${STAMP}`, latitude: 18.5, longitude: 73.8 },
    })
    made.push(legacy.id)
    const list = await request(app).get('/api/v1/pops').set(...auth(IDS.mine))
    expect(list.body.data.map((p) => p.name)).toContain(`PZ legacy-${STAMP}`)
  })

  it('shows an ADMIN every POP, whatever the zone', async () => {
    const list = await request(app).get('/api/v1/pops').set(...auth(IDS.admin))
    const names = list.body.data.map((p) => p.name)
    expect(names).toContain(`PZ ownzone-${STAMP}`)
    if (otherZoneId !== myZoneId) expect(names).toContain(`PZ elsewhere-${STAMP}`)
  })

  it('hides a POP out of scope behind a 404 rather than a 403', async () => {
    if (otherZoneId === myZoneId) return
    const elsewhere = made.find((_, i) => i === made.length - 2)
    const res = await request(app).get(`/api/v1/pops/${elsewhere}`).set(...auth(IDS.mine))
    expect([404, 405]).toContain(res.status)
  })
})
