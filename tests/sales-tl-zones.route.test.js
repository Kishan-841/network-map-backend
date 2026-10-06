import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

/**
 * Team-leader zones (spec 2026-10-06): a TL works every building in their
 * zones plus whatever their team already holds; managers no longer hand
 * buildings to a TL; a TL cannot take a zone building another team holds.
 */
const app = createApp()
const S = `tlz-${Date.now()}`
const auth = (id) => ({
  Authorization: `Bearer ${jwt.sign({ sub: id, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
})
const U = {
  mgr: `${S}-mgr`,
  mgr2: `${S}-mgr2`,
  tl: `${S}-tl`,
  tl2: `${S}-tl2`, // under mgr2, and SHARES zone Z1 with tl
  se: `${S}-se`, // under tl
  se2: `${S}-se2`, // under tl2
}
const Z1 = `${S}-z1`
const Z2 = `${S}-z2`
const B = {
  zoneFree: `${S}-zfree`, // in Z1, held by nobody
  zoneOther: `${S}-zother`, // in Z1, held by se2 (the other team)
  legacy: `${S}-legacy`, // no zone, assigned to tl one-by-one before this feature
  outside: `${S}-outside`, // in Z2, nobody's
}
const idsOf = (res) => res.body.data.map((b) => b.id)

beforeAll(async () => {
  for (const id of [Z1, Z2]) await prisma.zone.create({ data: { id, name: id, city: 'Test' } })
  const user = (id, role, extra = {}) =>
    prisma.user.create({ data: { id, name: id, email: `${id}@v.local`, passwordHash: 'x', role, ...extra } })
  await user(U.mgr, 'SALES_MANAGER')
  await user(U.mgr2, 'SALES_MANAGER')
  await user(U.tl, 'TEAM_LEADER', { managerId: U.mgr, assignedZones: { connect: [{ id: Z1 }] } })
  await user(U.tl2, 'TEAM_LEADER', { managerId: U.mgr2, assignedZones: { connect: [{ id: Z1 }] } })
  await user(U.se, 'SALES_EXECUTIVE', { managerId: U.mgr, teamLeaderId: U.tl })
  await user(U.se2, 'SALES_EXECUTIVE', { managerId: U.mgr2, teamLeaderId: U.tl2 })
  const building = (id, zoneId) =>
    prisma.building.create({
      data: {
        id,
        buildingName: id.toUpperCase(),
        formattedAddress: `${id} road`,
        latitude: 18.5,
        longitude: 73.8,
        createdById: 'test-admin',
        ...(zoneId && { zoneId }),
      },
    })
  await building(B.zoneFree, Z1)
  await building(B.zoneOther, Z1)
  await building(B.legacy, null)
  await building(B.outside, Z2)
  await prisma.buildingAssignment.create({
    data: { buildingId: B.zoneOther, assignedToId: U.se2, assignedById: U.tl2, status: 'ACTIVE' },
  })
  await prisma.buildingAssignment.create({
    data: { buildingId: B.legacy, assignedToId: U.tl, assignedById: U.mgr, status: 'ACTIVE' },
  })
})

afterAll(async () => {
  const userIds = Object.values(U)
  await prisma.buildingVisit.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.building.deleteMany({ where: { id: { in: Object.values(B) } } }) // cascades assignments
  await prisma.systemLog.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.zone.deleteMany({ where: { id: { in: [Z1, Z2] } } })
})

const checkIn = (who, buildingId) =>
  request(app)
    .post('/api/v1/sales/visits')
    .set(auth(who))
    .send({ buildingId, checkInLat: 18.5, checkInLng: 73.8, selfieUrl: 'https://example.test/s.jpg', wentSolo: true })

describe("a team leader's pool", () => {
  it('holds every building in their zones plus their legacy assignments, nothing else', async () => {
    const ids = idsOf(await request(app).get('/api/v1/sales/buildings').set(auth(U.tl)))
    expect(ids).toEqual(expect.arrayContaining([B.zoneFree, B.zoneOther, B.legacy]))
    expect(ids).not.toContain(B.outside)
  })

  it('the map shows the same pool, every pin tappable (assigned=true)', async () => {
    const res = await request(app).get('/api/v1/sales/map-buildings').set(auth(U.tl))
    const rows = Object.fromEntries(res.body.data.map((b) => [b.id, b]))
    expect(rows[B.zoneFree]?.assigned).toBe(true)
    expect(rows[B.outside]).toBeUndefined()
  })

  it("an executive in the TL's zone still sees only what is assigned to them", async () => {
    const ids = idsOf(await request(app).get('/api/v1/sales/buildings').set(auth(U.se)))
    expect(ids).not.toContain(B.zoneFree)
  })
})

describe('checking in', () => {
  it('a TL checks in on an unassigned building in their zone', async () => {
    const res = await checkIn(U.tl, B.zoneFree)
    expect(res.status).toBe(201)
    await request(app)
      .post(`/api/v1/sales/visits/${res.body.data.id}/checkout`)
      .set(auth(U.tl))
      .send({ checkOutLat: 18.5, checkOutLng: 73.8 })
  })

  it('outside the pool is a 404', async () => {
    expect((await checkIn(U.tl, B.outside)).status).toBe(404)
  })
})

describe('assigning', () => {
  const assign = (who, buildingIds, assignedToId) =>
    request(app).post('/api/v1/sales/assignments').set(auth(who)).send({ buildingIds, assignedToId })

  it('a TL gives a free zone building to their executive', async () => {
    expect((await assign(U.tl, [B.zoneFree], U.se)).status).toBe(200)
    expect(idsOf(await request(app).get('/api/v1/sales/buildings').set(auth(U.se)))).toContain(B.zoneFree)
  })

  it('a TL cannot take a shared-zone building another team holds (400, names the holder)', async () => {
    const res = await assign(U.tl, [B.zoneOther], U.se)
    expect(res.status).toBe(400)
    expect(res.body.error.message).toContain(U.se2)
    const still = await prisma.buildingAssignment.findFirst({ where: { buildingId: B.zoneOther, status: 'ACTIVE' } })
    expect(still.assignedToId).toBe(U.se2)
  })

  it('a TL cannot assign outside their pool', async () => {
    expect((await assign(U.tl, [B.outside], U.se)).status).toBe(400)
  })

  it('a manager can no longer assign buildings to a team leader', async () => {
    const res = await assign(U.mgr, [B.outside], U.tl)
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/zones/i)
  })

  it('a manager still assigns straight to an executive', async () => {
    expect((await assign(U.mgr, [B.outside], U.se)).status).toBe(200)
  })
})

describe('a manager sets team-leader zones', () => {
  const put = (who, tl, zoneIds) =>
    request(app).put(`/api/v1/sales/team-leaders/${tl}/zones`).set(auth(who)).send({ zoneIds })

  it("lists only the manager's own TLs, with their zones", async () => {
    const res = await request(app).get('/api/v1/sales/team-leaders').set(auth(U.mgr))
    expect(res.status).toBe(200)
    const ids = res.body.data.map((u) => u.id)
    expect(ids).toContain(U.tl)
    expect(ids).not.toContain(U.tl2)
    expect(res.body.data.find((u) => u.id === U.tl).assignedZones.map((z) => z.id)).toEqual([Z1])
  })

  it("replaces their own TL's zones (duplicates tolerated)", async () => {
    const res = await put(U.mgr, U.tl, [Z1, Z2, Z2])
    expect(res.status).toBe(200)
    expect(res.body.data.assignedZones.map((z) => z.id).sort()).toEqual([Z1, Z2].sort())
    // The pool follows at once: B.outside (Z2) is now in.
    expect(idsOf(await request(app).get('/api/v1/sales/buildings').set(auth(U.tl)))).toContain(B.outside)
    await put(U.mgr, U.tl, [Z1])
  })

  it("another manager's TL is a 404, and nothing changes", async () => {
    expect((await put(U.mgr, U.tl2, [Z2])).status).toBe(404)
    const tl2 = await prisma.user.findUnique({ where: { id: U.tl2 }, include: { assignedZones: true } })
    expect(tl2.assignedZones.map((z) => z.id)).toEqual([Z1])
  })

  it('a non-TL target (an executive) is a 404', async () => {
    expect((await put(U.mgr, U.se, [Z1])).status).toBe(404)
  })

  it('an unknown zone is a 400', async () => {
    expect((await put(U.mgr, U.tl, ['nope'])).status).toBe(400)
  })

  it('a TL or executive may not set zones (403)', async () => {
    expect((await put(U.tl, U.tl, [])).status).toBe(403)
    expect((await request(app).get('/api/v1/sales/team-leaders').set(auth(U.se))).status).toBe(403)
  })

  it("an admin may set any TL's zones", async () => {
    expect((await put('test-admin', U.tl2, [Z1])).status).toBe(200)
  })
})
