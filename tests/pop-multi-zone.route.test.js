import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

// A POP may serve several zones. Whoever is assigned to ANY of them sees it;
// the maker always does; an ADMIN sees all. A SURVEYOR may only attach zones
// they hold. Moving a POP's zones hands over who can see it.

const STAMP = Date.now()
const IDS = { admin: `pmz-admin-${STAMP}`, aOnly: `pmz-a-${STAMP}`, bOnly: `pmz-b-${STAMP}` }
const app = createApp()
const auth = (id) => [
  'Authorization',
  `Bearer ${jwt.sign({ sub: id, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]

let zoneA = null
let zoneB = null
let twoZones = false
const made = []
const pop = (extra) => ({ name: `PMZ ${extra.tag}-${STAMP}`, latitude: 18.52, longitude: 73.85, ...extra })

beforeAll(async () => {
  const zones = await prisma.zone.findMany({ take: 2 })
  zoneA = zones[0].id
  zoneB = zones[1]?.id ?? zones[0].id
  twoZones = zoneA !== zoneB
  await prisma.user.create({
    data: { id: IDS.admin, name: 'PMZ Admin', email: `${IDS.admin}@vitest.local`, passwordHash: 'x', role: 'ADMIN' },
  })
  await prisma.user.create({
    data: {
      id: IDS.aOnly, name: 'PMZ A', email: `${IDS.aOnly}@vitest.local`, passwordHash: 'x',
      role: 'SURVEYOR', canManageFiber: true, assignedZones: { connect: { id: zoneA } },
    },
  })
  await prisma.user.create({
    data: {
      id: IDS.bOnly, name: 'PMZ B', email: `${IDS.bOnly}@vitest.local`, passwordHash: 'x',
      role: 'SURVEYOR', canManageFiber: true, ...(twoZones && { assignedZones: { connect: { id: zoneB } } }),
    },
  })
})

afterAll(async () => {
  await prisma.pop.deleteMany({ where: { name: { startsWith: 'PMZ ' } } })
  const ids = Object.values(IDS)
  await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

describe('creating a multi-zone POP', () => {
  it('accepts a zoneIds array and hands both zones back', async () => {
    const res = await request(app)
      .post('/api/v1/pops')
      .set(...auth(IDS.admin))
      .send(pop({ tag: 'both', zoneIds: twoZones ? [zoneA, zoneB] : [zoneA] }))
    expect(res.status).toBe(201)
    made.push(res.body.data.id)
    const ids = res.body.data.zones.map((z) => z.id)
    expect(ids).toContain(zoneA)
    if (twoZones) expect(ids).toContain(zoneB)
  })

  it('is visible to a surveyor assigned to EITHER of its zones', async () => {
    const seenByA = await request(app).get('/api/v1/pops').set(...auth(IDS.aOnly))
    expect(seenByA.body.data.map((p) => p.name)).toContain(`PMZ both-${STAMP}`)
    if (twoZones) {
      const seenByB = await request(app).get('/api/v1/pops').set(...auth(IDS.bOnly))
      expect(seenByB.body.data.map((p) => p.name)).toContain(`PMZ both-${STAMP}`)
    }
  })

  it('folds a legacy singular zoneId (deploy-window back-compat)', async () => {
    const res = await request(app)
      .post('/api/v1/pops')
      .set(...auth(IDS.admin))
      .send(pop({ tag: 'legacy', zoneId: zoneA }))
    expect(res.status).toBe(201)
    made.push(res.body.data.id)
    expect(res.body.data.zones.map((z) => z.id)).toEqual([zoneA])
  })
})

describe('a surveyor may only attach zones they hold', () => {
  it('rejects the whole request if any zone is not theirs', async () => {
    if (!twoZones) return
    const res = await request(app)
      .post('/api/v1/pops')
      .set(...auth(IDS.aOnly))
      .send(pop({ tag: 'mixed', zoneIds: [zoneA, zoneB] }))
    expect(res.status).toBe(403)
    const list = await request(app).get('/api/v1/pops').set(...auth(IDS.admin))
    expect(list.body.data.map((p) => p.name)).not.toContain(`PMZ mixed-${STAMP}`)
  })
})

describe('moving a POP’s zones hands over who sees it', () => {
  it('an A-only surveyor loses a POP re-zoned to B; a B surveyor gains it; the maker keeps it', async () => {
    if (!twoZones) return
    // ADMIN makes a POP in zone A. The A-surveyor (not the maker) sees it.
    const created = await request(app)
      .post('/api/v1/pops')
      .set(...auth(IDS.admin))
      .send(pop({ tag: 'move', zoneIds: [zoneA] }))
    const id = created.body.data.id
    made.push(id)
    let listA = await request(app).get('/api/v1/pops').set(...auth(IDS.aOnly))
    expect(listA.body.data.map((p) => p.name)).toContain(`PMZ move-${STAMP}`)

    // Re-zone it to B only.
    const moved = await request(app).patch(`/api/v1/pops/${id}`).set(...auth(IDS.admin)).send({ zoneIds: [zoneB] })
    expect(moved.status).toBe(200)

    // A-only surveyor (not the maker) can no longer see it — 404, not 403.
    const gone = await request(app).get(`/api/v1/pops/${id}`).set(...auth(IDS.aOnly))
    expect(gone.status).toBe(404)
    // B surveyor now sees it.
    const listB = await request(app).get('/api/v1/pops').set(...auth(IDS.bOnly))
    expect(listB.body.data.map((p) => p.name)).toContain(`PMZ move-${STAMP}`)
  })

  it('the maker still sees a POP whose zones no longer match them', async () => {
    if (!twoZones) return
    // The A-surveyor makes a POP in zone A (they are both maker and in-zone).
    const created = await request(app)
      .post('/api/v1/pops')
      .set(...auth(IDS.aOnly))
      .send(pop({ tag: 'mine', zoneIds: [zoneA] }))
    const id = created.body.data.id
    made.push(id)
    // ADMIN re-zones it to B. The A-surveyor is no longer in-zone but is the maker.
    await request(app).patch(`/api/v1/pops/${id}`).set(...auth(IDS.admin)).send({ zoneIds: [zoneB] })
    const still = await request(app).get(`/api/v1/pops/${id}`).set(...auth(IDS.aOnly))
    expect(still.status).toBe(200)
  })
})
