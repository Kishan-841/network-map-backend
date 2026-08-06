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
})
