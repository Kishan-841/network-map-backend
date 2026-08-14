import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

describe('operators API', () => {
  it('lists operators for MANAGER, blocks SURVEYOR', async () => {
    const ok = await request(createApp())
      .get('/api/v1/operators')
      .set('Authorization', `Bearer ${tokenFor('MANAGER')}`)
    expect(ok.status).toBe(200)
    expect(Array.isArray(ok.body.data)).toBe(true)

    const denied = await request(createApp())
      .get('/api/v1/operators')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
    expect(denied.status).toBe(403)
  })

  it('import is ADMIN-only', async () => {
    const res = await request(createApp())
      .post('/api/v1/operators/import')
      .set('Authorization', `Bearer ${tokenFor('MANAGER')}`)
      .send({ rows: [{ operator: 'O', zone: 'Z', city: 'C', email: 'a@b.co' }] })
    expect(res.status).toBe(403)
  })

  it('imports a mapping end-to-end: creates operator+zones, assigns surveyor', async () => {
    const stamp = Date.now()
    const email = `op-import-${stamp}@isp.local`
    const surveyor = await prisma.user.create({
      data: { name: 'OpImport', email, passwordHash: 'x', role: 'SURVEYOR' },
    })
    const opName = `OP-${stamp}`
    const zoneA = `OPZ-A-${stamp}`
    const zoneB = `OPZ-B-${stamp}`

    const res = await request(createApp())
      .post('/api/v1/operators/import')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({
        rows: [
          { operator: opName, zone: zoneA, city: 'Pune', email: email.toUpperCase() },
          { operator: opName, zone: zoneB, city: 'Pune', email },
        ],
      })
    expect(res.status).toBe(200)
    expect(res.body.data.operatorsCreated).toBe(1)
    expect(res.body.data.zonesCreated).toBe(2)
    expect(res.body.data.surveyorsUpdated).toEqual([{ email, zones: 2 }])

    // Both zones belong to the new operator, and the surveyor is assigned both.
    const operator = await prisma.operator.findFirst({ where: { name: opName } })
    const zones = await prisma.zone.findMany({ where: { name: { in: [zoneA, zoneB] } } })
    expect(zones.every((z) => z.operatorId === operator.id)).toBe(true)
    const assigned = await prisma.zone.findMany({
      where: { assignedUsers: { some: { id: surveyor.id } } },
      select: { name: true },
    })
    expect(assigned.map((z) => z.name).sort()).toEqual([zoneA, zoneB].sort())

    // GET /buildings?operatorId filters via the zone relation (no rows here, but no 500).
    const filtered = await request(createApp())
      .get(`/api/v1/buildings?operatorId=${operator.id}`)
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(filtered.status).toBe(200)
    expect(Array.isArray(filtered.body.data.items)).toBe(true)

    // The import upserts the sheet's city as a City row linked to the operator.
    expect(operator.cityId).not.toBeNull()

    // Cleanup (zones first: FK restrict on building none here; detach assignment via delete).
    await prisma.zone.deleteMany({ where: { name: { in: [zoneA, zoneB] } } })
    await prisma.operator.delete({ where: { id: operator.id } })
    await prisma.user.delete({ where: { id: surveyor.id } })
    // Delete the upserted city only if this run created it and nothing else uses it.
    const cityInUse = await prisma.operator.count({ where: { cityId: operator.cityId } })
    if (cityInUse === 0) await prisma.city.deleteMany({ where: { id: operator.cityId } })
  })
})
