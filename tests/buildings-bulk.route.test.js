import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

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
    const token = jwt.sign({ sub: admin.id, role: 'ADMIN' }, env.jwtSecret, { expiresIn: '1h' })
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
