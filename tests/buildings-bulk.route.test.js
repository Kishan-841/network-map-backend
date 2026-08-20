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
