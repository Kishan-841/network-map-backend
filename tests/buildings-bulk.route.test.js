import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })

describe('POST /buildings/bulk', () => {
  it('is ADMIN-only', async () => {
    for (const role of ['SURVEYOR', 'MANAGER']) {
      const res = await request(createApp())
        .post('/api/v1/buildings/bulk')
        .set('Authorization', `Bearer ${tokenFor(role)}`)
        .send({ rows: [] })
      expect(res.status).toBe(403)
    }
  })

  it('admin round-trip: imports, re-import skips, cleanup', async () => {
    const stamp = Date.now()
    const app = createApp()
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    const token = jwt.sign({ sub: admin.id, role: 'ADMIN' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })
    const rows = [
      {
        buildingName: `BulkBldg-${stamp}`,
        latitude: 18.5239,
        longitude: 73.8615,
        zone: `BulkZone-${stamp}`,
        operator: `BulkOp-${stamp}`,
        homePass: 50,
        remark: 'SERVER',
      },
    ]

    const first = await request(app)
      .post('/api/v1/buildings/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows })
    expect(first.status).toBe(200)
    expect(first.body.data.createdCount).toBe(1)
    expect(first.body.data.zonesCreated).toBe(1)
    expect(first.body.data.operatorsCreated).toBe(1)

    // Idempotent: same file again → everything skipped.
    const again = await request(app)
      .post('/api/v1/buildings/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows })
    expect(again.body.data.createdCount).toBe(0)
    expect(again.body.data.skipped[0].reason).toBe('already exists in zone')

    // Cleanup.
    await prisma.building.deleteMany({ where: { buildingName: `BulkBldg-${stamp}` } })
    await prisma.zone.deleteMany({ where: { name: `BulkZone-${stamp}` } })
    await prisma.operator.deleteMany({ where: { name: `BulkOp-${stamp}` } })
  })
})

describe('POST /buildings/bulk-delete', () => {
  const app = createApp()
  const adminToken = async () => {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    return jwt.sign({ sub: admin.id, role: 'ADMIN' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })
  }

  it('is ADMIN-only', async () => {
    for (const role of ['SURVEYOR', 'MANAGER']) {
      const res = await request(app)
        .post('/api/v1/buildings/bulk-delete')
        .set('Authorization', `Bearer ${tokenFor(role)}`)
        .send({ ids: ['x'] })
      expect(res.status).toBe(403)
    }
  })

  it('deletes the ticked buildings and reports the count', async () => {
    const stamp = Date.now()
    const token = await adminToken()
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    const make = (n) =>
      prisma.building.create({
        data: {
          buildingName: `BD-${stamp}-${n}`,
          formattedAddress: 'Test address',
          latitude: 18.5,
          longitude: 73.8,
          // ACQUISITION so the parallel building-markers test (which counts
          // COVERAGE buildings) is unaffected by these transient rows.
          source: 'ACQUISITION',
          createdById: admin.id,
        },
      })
    const b1 = await make(1)
    const b2 = await make(2)

    const res = await request(app)
      .post('/api/v1/buildings/bulk-delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [b1.id, b2.id] })
    expect(res.status).toBe(200)
    expect(res.body.data.deletedCount).toBe(2)
    expect(res.body.data.skipped).toHaveLength(0)
    expect(await prisma.building.findUnique({ where: { id: b1.id } })).toBeNull()
    expect(await prisma.building.findUnique({ where: { id: b2.id } })).toBeNull()
  })

  it('rejects an empty id list', async () => {
    const res = await request(app)
      .post('/api/v1/buildings/bulk-delete')
      .set('Authorization', `Bearer ${await adminToken()}`)
      .send({ ids: [] })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /buildings/bulk-olt', () => {
  const app = createApp()
  const adminToken = async () => {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    return jwt.sign({ sub: admin.id, role: 'ADMIN' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })
  }

  it('is open to any surveyor with no edit tick — not a 403', async () => {
    // The OLT-assign action is wider than building editing: an unticked
    // surveyor is let through the auth gate (the service still keeps it
    // zone-safe). A bogus OLT id therefore fails at the service (400), not 403.
    const res = await request(app)
      .patch('/api/v1/buildings/bulk-olt')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
      .send({ ids: ['x'], oltId: 'y', ponPort: 1 })
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(400)
  })

  it('rejects an empty id list, and a missing OLT', async () => {
    const token = await adminToken()
    const empty = await request(app)
      .patch('/api/v1/buildings/bulk-olt')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [], oltId: 'y', ponPort: 1 })
    expect(empty.status).toBe(400)
    const noOlt = await request(app)
      .patch('/api/v1/buildings/bulk-olt')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: ['x'], ponPort: 1 })
    expect(noOlt.status).toBe(400)
  })
})

describe('PATCH /buildings/bulk-olt — multiple PON ports & multi-zone OLTs', () => {
  const app = createApp()
  const STAMP = Date.now()
  const SUR = `bmp-sur-${STAMP}`
  const state = {}

  const auth = (id) => ['Authorization', `Bearer ${jwt.sign({ sub: id, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`]

  beforeAll(async () => {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    state.adminId = admin.id
    const [zoneA, zoneB] = await prisma.zone.findMany({ take: 2 })
    state.zoneA = zoneA.id
    state.zoneB = zoneB?.id ?? zoneA.id
    state.twoZones = state.zoneA !== state.zoneB

    await prisma.user.create({
      data: {
        id: SUR, name: 'BMP Surveyor', email: `${SUR}@vitest.local`, passwordHash: 'x',
        role: 'SURVEYOR', assignedZones: { connect: { id: state.zoneA } },
      },
    })
    // POP in zone A with an 8-port OLT; a second POP in zone B with its own OLT.
    const popA = await prisma.pop.create({
      data: { name: `BMP POP-A ${STAMP}`, latitude: 18.5, longitude: 73.8, createdById: state.adminId, zones: { connect: { id: state.zoneA } } },
    })
    state.oltA = (await prisma.olt.create({ data: { popId: popA.id, name: `BMP OLT-A ${STAMP}`, ponPortCount: 8 } })).id
    if (state.twoZones) {
      const popB = await prisma.pop.create({
        data: { name: `BMP POP-B ${STAMP}`, latitude: 18.6, longitude: 73.9, createdById: state.adminId, zones: { connect: { id: state.zoneB } } },
      })
      state.oltB = (await prisma.olt.create({ data: { popId: popB.id, name: `BMP OLT-B ${STAMP}`, ponPortCount: 8 } })).id
    }
    // Two buildings in zone A, made by the surveyor (so they are in their scope).
    const mk = (n) =>
      prisma.building.create({
        data: {
          buildingName: `BMP-${STAMP}-${n}`, formattedAddress: 'addr', latitude: 18.51, longitude: 73.81,
          source: 'COVERAGE', zoneId: state.zoneA, createdById: SUR,
        },
      })
    state.b1 = (await mk(1)).id
    state.b2 = (await mk(2)).id
  })

  afterAll(async () => {
    await prisma.building.deleteMany({ where: { buildingName: { startsWith: `BMP-${STAMP}` } } })
    await prisma.olt.deleteMany({ where: { name: { startsWith: 'BMP OLT' } } })
    await prisma.pop.deleteMany({ where: { name: { startsWith: 'BMP POP' } } })
    await prisma.systemLog.deleteMany({ where: { userId: SUR } })
    await prisma.user.deleteMany({ where: { id: SUR } })
  })

  it('maps buildings to a list of PON ports', async () => {
    const res = await request(app)
      .patch('/api/v1/buildings/bulk-olt')
      .set(...auth(state.adminId))
      .send({ ids: [state.b1, state.b2], oltId: state.oltA, ponPorts: [1, 2, 3] })
    expect(res.status).toBe(200)
    expect(res.body.data.count).toBe(2)
    const b = await prisma.building.findUnique({ where: { id: state.b1 }, select: { ponPorts: true } })
    expect(b.ponPorts).toEqual([1, 2, 3])
  })

  it('dedupes repeated ports', async () => {
    const res = await request(app)
      .patch('/api/v1/buildings/bulk-olt')
      .set(...auth(state.adminId))
      .send({ ids: [state.b1], oltId: state.oltA, ponPorts: [2, 2, 1] })
    expect(res.status).toBe(200)
    const b = await prisma.building.findUnique({ where: { id: state.b1 }, select: { ponPorts: true } })
    expect([...b.ponPorts].sort()).toEqual([1, 2])
  })

  it('rejects a port above the OLT port count', async () => {
    const res = await request(app)
      .patch('/api/v1/buildings/bulk-olt')
      .set(...auth(state.adminId))
      .send({ ids: [state.b1], oltId: state.oltA, ponPorts: [9] })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toContain('1 and 8')
  })

  it('accepts a legacy singular ponPort (back-compat)', async () => {
    const res = await request(app)
      .patch('/api/v1/buildings/bulk-olt')
      .set(...auth(state.adminId))
      .send({ ids: [state.b2], oltId: state.oltA, ponPort: 5 })
    expect(res.status).toBe(200)
    const b = await prisma.building.findUnique({ where: { id: state.b2 }, select: { ponPorts: true } })
    expect(b.ponPorts).toEqual([5])
  })

  it('lets a surveyor map to an OLT whose zones include the selection zone', async () => {
    const res = await request(app)
      .patch('/api/v1/buildings/bulk-olt')
      .set(...auth(SUR))
      .send({ ids: [state.b1], oltId: state.oltA, ponPorts: [4] })
    expect(res.status).toBe(200)
  })

  it('refuses a surveyor an OLT in a different zone from the selection', async () => {
    if (!state.twoZones) return
    const res = await request(app)
      .patch('/api/v1/buildings/bulk-olt')
      .set(...auth(SUR))
      .send({ ids: [state.b1], oltId: state.oltB, ponPorts: [1] })
    expect(res.status).toBe(400)
  })

  it('records the PON ports in the audit log, not "undefined"', async () => {
    await request(app)
      .patch('/api/v1/buildings/bulk-olt')
      .set(...auth(state.adminId))
      .send({ ids: [state.b2], oltId: state.oltA, ponPorts: [6, 7, 8] })
    // audit() writes on res 'finish' — poll for the log carrying these ports.
    let log = null
    for (let i = 0; i < 40 && !log; i++) {
      log = await prisma.systemLog.findFirst({
        where: { action: 'BulkOltMap', description: { contains: '6, 7, 8' } },
        orderBy: { createdAt: 'desc' },
      })
      if (!log) await new Promise((r) => setTimeout(r, 25))
    }
    expect(log).toBeTruthy()
    expect(log.description).not.toContain('undefined')
  })
})
