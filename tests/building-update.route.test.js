import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

describe('PATCH /api/v1/buildings/:id', () => {
  it('requires authentication', async () => {
    const res = await request(createApp())
      .patch('/api/v1/buildings/whatever')
      .send({ buildingName: 'X' })
    expect(res.status).toBe(401)
  })

  it('rejects SURVEYOR', async () => {
    const res = await request(createApp())
      .patch('/api/v1/buildings/whatever')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
      .send({ buildingName: 'X' })
    expect(res.status).toBe(403)
  })

  it('rejects an empty patch', async () => {
    const res = await request(createApp())
      .patch('/api/v1/buildings/whatever')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('admin round-trip: updates name, details, and permission', async () => {
    const stamp = Date.now()
    const zone = await prisma.zone.findFirst()
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    const building = await prisma.building.create({
      data: {
        buildingName: `EditTest-${stamp}`,
        formattedAddress: '1 Edit St',
        latitude: 18.5,
        longitude: 73.8,
        zoneId: zone.id,
        createdById: admin.id,
      },
    })

    const res = await request(createApp())
      .patch(`/api/v1/buildings/${building.id}`)
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({
        buildingName: `EditTest-${stamp}-renamed`,
        isLive: true,
        details: { floors: 9, buildingType: 'Commercial' },
        permission: { amountPaid: 2500, ownerName: 'Owner X', permissionDate: '2026-08-01' },
      })
    expect(res.status).toBe(200)
    expect(res.body.data.buildingName).toBe(`EditTest-${stamp}-renamed`)
    expect(res.body.data.isLive).toBe(true)
    expect(res.body.data.details.floors).toBe(9)
    expect(res.body.data.permission.ownerName).toBe('Owner X')

    // Second patch updates the now-existing child rows (upsert update path).
    const res2 = await request(createApp())
      .patch(`/api/v1/buildings/${building.id}`)
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({ details: { floors: 10 }, permission: { ownerName: null } })
    expect(res2.status).toBe(200)
    expect(res2.body.data.details.floors).toBe(10)
    expect(res2.body.data.permission.ownerName).toBeNull()

    await prisma.building.delete({ where: { id: building.id } })
  })
})
