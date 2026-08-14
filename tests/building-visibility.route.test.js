import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: '1h' })

// The reported bug: admin adds a building in Wakad; the surveyor assigned to
// Wakad can't see it and adds a duplicate.
describe('surveyor sees admin-added buildings in assigned zones', () => {
  const stamp = Date.now()
  let zone
  let surveyor
  let building

  beforeAll(async () => {
    zone = await prisma.zone.findFirst()
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    surveyor = await prisma.user.create({
      data: {
        name: 'Visibility Test Surveyor',
        email: `vis-test-${stamp}@test.local`,
        passwordHash: 'not-a-real-hash',
        role: 'SURVEYOR',
        assignedZones: { connect: { id: zone.id } },
      },
    })
    building = await prisma.building.create({
      data: {
        buildingName: `AdminAdded-${stamp}`,
        formattedAddress: '1 Visibility St',
        latitude: 18.51,
        longitude: 73.81,
        zoneId: zone.id,
        createdById: admin.id,
      },
    })
  })

  afterAll(async () => {
    await prisma.building.delete({ where: { id: building.id } })
    await prisma.user.delete({ where: { id: surveyor.id } })
  })

  it('lists the admin-added building for the assigned surveyor', async () => {
    const res = await request(createApp())
      .get('/api/v1/buildings?pageSize=500')
      .set('Authorization', `Bearer ${tokenFor(surveyor)}`)
    expect(res.status).toBe(200)
    const ids = res.body.data.items.map((b) => b.id)
    expect(ids).toContain(building.id)
  })

  it('serves the detail page for the admin-added building', async () => {
    const res = await request(createApp())
      .get(`/api/v1/buildings/${building.id}`)
      .set('Authorization', `Bearer ${tokenFor(surveyor)}`)
    expect(res.status).toBe(200)
    expect(res.body.data.buildingName).toBe(`AdminAdded-${stamp}`)
  })

  it('returns it unmasked in the nearby duplicate check', async () => {
    const res = await request(createApp())
      .get('/api/v1/buildings/nearby?latitude=18.51&longitude=73.81&radius=200')
      .set('Authorization', `Bearer ${tokenFor(surveyor)}`)
    expect(res.status).toBe(200)
    const hit = res.body.data.find((b) => b.id === building.id)
    expect(hit.buildingName).toBe(`AdminAdded-${stamp}`)
    expect(hit.masked).toBeUndefined()
  })
})
