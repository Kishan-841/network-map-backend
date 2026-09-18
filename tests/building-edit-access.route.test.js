import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { mayEditBuildings } from '../src/middleware/auth.js'

// Own fixtures: these tests flip the grant, and a shared row flipped mid-suite
// would make other files order-dependent.
const STAMP = Date.now()
const IDS = {
  admin: `be-admin-${STAMP}`,
  ticked: `be-ticked-${STAMP}`,
  other: `be-other-${STAMP}`,
  plain: `be-plain-${STAMP}`,
}
const app = createApp()
const auth = (id) => [
  'Authorization',
  `Bearer ${jwt.sign({ sub: id, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]

let zoneId = null
let otherZoneId = null
let ownBuildingId = null
let othersBuildingId = null

beforeAll(async () => {
  const zones = await prisma.zone.findMany({ take: 2 })
  zoneId = zones[0].id
  otherZoneId = zones[1]?.id ?? zones[0].id
  const users = [
    { id: IDS.admin, role: 'ADMIN' },
    { id: IDS.ticked, role: 'SURVEYOR', canEditBuildings: true },
    { id: IDS.other, role: 'SURVEYOR', canEditBuildings: true },
    { id: IDS.plain, role: 'SURVEYOR' },
  ]
  for (const user of users) {
    await prisma.user.create({
      data: {
        name: `BE ${user.role}`,
        email: `${user.id}@vitest.local`,
        passwordHash: 'x',
        ...user,
        // Both ticked surveyors work this zone, so zone access is never what
        // decides these cases — ownership is.
        ...(user.role === 'SURVEYOR' && { assignedZones: { connect: { id: zoneId } } }),
      },
    })
  }
  const building = (createdById, name) => ({
    buildingName: `${name}-${STAMP}`,
    formattedAddress: '1 Edit St',
    latitude: 18.5,
    longitude: 73.8,
    zoneId,
    createdById,
  })
  ownBuildingId = (await prisma.building.create({ data: building(IDS.ticked, 'BEOwn') })).id
  othersBuildingId = (await prisma.building.create({ data: building(IDS.other, 'BEOther') })).id
})

afterAll(async () => {
  const ids = Object.values(IDS)
  await prisma.buildingDetails.deleteMany({ where: { buildingId: { in: [ownBuildingId, othersBuildingId] } } })
  await prisma.building.deleteMany({ where: { id: { in: [ownBuildingId, othersBuildingId] } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

describe('mayEditBuildings', () => {
  it('is true for the roles that always could', () => {
    for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR']) {
      expect(mayEditBuildings({ role, canEditBuildings: false })).toBe(true)
    }
  })

  it('needs the tick for a SURVEYOR', () => {
    expect(mayEditBuildings({ role: 'SURVEYOR', canEditBuildings: false })).toBe(false)
    expect(mayEditBuildings({ role: 'SURVEYOR', canEditBuildings: true })).toBe(true)
  })

  it('ignores a tick on a role that cannot hold it', () => {
    expect(mayEditBuildings({ role: 'ACQUISITION_AGENT', canEditBuildings: true })).toBe(false)
    expect(mayEditBuildings(undefined)).toBe(false)
  })
})

describe('PATCH /buildings/:id as a ticked surveyor', () => {
  it('edits their own building — name, address and details', async () => {
    const res = await request(app)
      .patch(`/api/v1/buildings/${ownBuildingId}`)
      .set(...auth(IDS.ticked))
      .send({
        buildingName: `BEOwn-${STAMP}-renamed`,
        formattedAddress: '2 Edit St',
        details: { floors: 4, remarks: 'corrected on site' },
      })
    expect(res.status).toBe(200)
    expect(res.body.data.buildingName).toBe(`BEOwn-${STAMP}-renamed`)
    expect(res.body.data.details.floors).toBe(4)
  })

  it('cannot touch a building someone else logged, even in their own zone', async () => {
    const res = await request(app)
      .patch(`/api/v1/buildings/${othersBuildingId}`)
      .set(...auth(IDS.ticked))
      .send({ buildingName: 'nope' })
    expect(res.status).toBe(403)
    const untouched = await prisma.building.findUnique({ where: { id: othersBuildingId } })
    expect(untouched.buildingName).toBe(`BEOther-${STAMP}`)
  })

  it('cannot set permission details — a legal artifact stays with managers', async () => {
    const res = await request(app)
      .patch(`/api/v1/buildings/${ownBuildingId}`)
      .set(...auth(IDS.ticked))
      .send({ permission: { amountPaid: 5000, ownerName: 'Someone' } })
    expect(res.status).toBe(403)
  })

  it('cannot mark a building live — that is still the status route', async () => {
    const res = await request(app)
      .patch(`/api/v1/buildings/${ownBuildingId}`)
      .set(...auth(IDS.ticked))
      .send({ isLive: true })
    expect(res.status).toBe(403)
  })

  it('cannot move a building into a zone they are not assigned to', async () => {
    if (otherZoneId === zoneId) return
    const res = await request(app)
      .patch(`/api/v1/buildings/${ownBuildingId}`)
      .set(...auth(IDS.ticked))
      .send({ zoneId: otherZoneId })
    expect(res.status).toBe(403)
  })

  it('still cannot delete it', async () => {
    const res = await request(app).delete(`/api/v1/buildings/${ownBuildingId}`).set(...auth(IDS.ticked))
    expect(res.status).toBe(403)
  })
})

describe('PATCH /buildings/:id without the tick', () => {
  it('refuses an unticked surveyor on their own building', async () => {
    const mine = await prisma.building.create({
      data: {
        buildingName: `BEPlain-${STAMP}`,
        formattedAddress: '3 Edit St',
        latitude: 18.5,
        longitude: 73.8,
        zoneId,
        createdById: IDS.plain,
      },
    })
    const res = await request(app)
      .patch(`/api/v1/buildings/${mine.id}`)
      .set(...auth(IDS.plain))
      .send({ buildingName: 'nope' })
    expect(res.status).toBe(403)
    await prisma.building.delete({ where: { id: mine.id } })
  })

  it('still lets an ADMIN edit anything, tick or no tick', async () => {
    const res = await request(app)
      .patch(`/api/v1/buildings/${othersBuildingId}`)
      .set(...auth(IDS.admin))
      .send({ isLive: true, permission: { ownerName: 'Admin may' } })
    expect(res.status).toBe(200)
  })
})

describe('PATCH /users/:id/access carries both grants', () => {
  it('ticks building editing for a surveyor and takes it away again', async () => {
    const on = await request(app)
      .patch(`/api/v1/users/${IDS.plain}/access`)
      .set(...auth(IDS.admin))
      .send({ canEditBuildings: true })
    expect(on.status).toBe(200)
    expect(on.body.data.canEditBuildings).toBe(true)

    const off = await request(app)
      .patch(`/api/v1/users/${IDS.plain}/access`)
      .set(...auth(IDS.admin))
      .send({ canEditBuildings: false })
    expect(off.body.data.canEditBuildings).toBe(false)
  })

  it('leaves the fiber grant alone when only the building one is sent', async () => {
    await prisma.user.update({ where: { id: IDS.plain }, data: { canManageFiber: true } })
    const res = await request(app)
      .patch(`/api/v1/users/${IDS.plain}/access`)
      .set(...auth(IDS.admin))
      .send({ canEditBuildings: true })
    expect(res.body.data.canManageFiber).toBe(true)
    expect(res.body.data.canEditBuildings).toBe(true)
  })

  it('refuses building editing for a role that cannot hold it', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${IDS.admin}/access`)
      .set(...auth(IDS.admin))
      .send({ canEditBuildings: true })
    expect(res.status).toBe(400)
  })

  it('rejects an empty body — a PATCH must say what it changes', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${IDS.plain}/access`)
      .set(...auth(IDS.admin))
      .send({})
    expect(res.status).toBe(400)
  })
})
