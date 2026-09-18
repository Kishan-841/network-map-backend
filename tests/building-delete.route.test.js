import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

describe('DELETE /api/v1/buildings/:id', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).delete('/api/v1/buildings/whatever')
    expect(res.status).toBe(401)
  })

// A fiber records the zone it runs in, so these fixtures pick any real one.
const anyZoneId = async () => (await prisma.zone.findFirst()).id

// Fiber writes need the per-user tick, not just a role — see seed-test-users.
const fiberManagerToken = jwt.sign({ sub: 'test-fiber-manager', role: 'MANAGER' }, env.jwtSecret, {
  audience: 'staff',
  expiresIn: '1h',
})

  it('rejects SURVEYOR', async () => {
    const res = await request(createApp())
      .delete('/api/v1/buildings/whatever')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
    expect(res.status).toBe(403)
  })

  it('rejects MANAGER (admin only)', async () => {
    const res = await request(createApp())
      .delete('/api/v1/buildings/whatever')
      .set('Authorization', `Bearer ${tokenFor('MANAGER')}`)
    expect(res.status).toBe(403)
  })

  it('404s for an unknown id', async () => {
    const res = await request(createApp())
      .delete('/api/v1/buildings/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(res.status).toBe(404)
  })

  it('admin round-trip: 204 and the building (with children) is gone', async () => {
    const stamp = Date.now()
    const zone = await prisma.zone.findFirst()
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    const building = await prisma.building.create({
      data: {
        buildingName: `DeleteTest-${stamp}`,
        formattedAddress: '1 Delete St',
        latitude: 18.5,
        longitude: 73.8,
        zoneId: zone.id,
        createdById: admin.id,
        details: { create: { floors: 3 } },
      },
    })

    const res = await request(createApp())
      .delete(`/api/v1/buildings/${building.id}`)
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(res.status).toBe(204)

    expect(await prisma.building.findUnique({ where: { id: building.id } })).toBeNull()
    expect(await prisma.buildingDetails.findUnique({ where: { buildingId: building.id } })).toBeNull()
  })

  it('refuses to delete a building attached to a fiber, then succeeds once the fiber is gone', async () => {
    const stamp = Date.now()
    const admin = ['Authorization', `Bearer ${tokenFor('ADMIN')}`]
    const manager = ['Authorization', `Bearer ${fiberManagerToken}`]
    const app = createApp()

    const building = await prisma.building.create({
      data: {
        buildingName: `FiberAttachedDelete-${stamp}`,
        formattedAddress: '1 Attached St',
        latitude: 18.56,
        longitude: 73.86,
        createdById: 'test-admin',
      },
    })

    let fiberId = null
    try {
      const fiber = await request(app)
        .post('/api/v1/fibers')
        .set(...manager)
        .send({
          zoneId: await anyZoneId(),
          coreCount: 2,
          points: [
            { type: 'WAYPOINT', latitude: 18.561, longitude: 73.861 },
            { type: 'BUILDING', buildingId: building.id, latitude: 18.56, longitude: 73.86 },
          ],
        })
      expect(fiber.status).toBe(201)
      fiberId = fiber.body.data.id
      const fiberName = fiber.body.data.name

      const blocked = await request(app).delete(`/api/v1/buildings/${building.id}`).set(...admin)
      expect(blocked.status).toBe(409)
      expect(blocked.body.error.message).toContain(fiberName)

      const deleteFiber = await request(app).delete(`/api/v1/fibers/${fiberId}`).set(...manager)
      expect(deleteFiber.status).toBe(200)
      fiberId = null

      const allowed = await request(app).delete(`/api/v1/buildings/${building.id}`).set(...admin)
      expect(allowed.status).toBe(204)
    } finally {
      if (fiberId) await prisma.fiber.delete({ where: { id: fiberId } }).catch(() => {})
      await prisma.building.deleteMany({ where: { id: building.id } })
    }
  })
})
