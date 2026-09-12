import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, {
    audience: 'staff',
    expiresIn: '1h',
  })

describe('GET /api/v1/buildings/markers', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).get('/api/v1/buildings/markers')
    expect(res.status).toBe(401)
  })

  it('an ADMIN sees every building as exactly five fields', async () => {
    const stamp = Date.now()
    const zone = await prisma.zone.findFirst()
    const building = await prisma.building.create({
      data: {
        buildingName: `MarkerTest-${stamp}`,
        formattedAddress: '1 Marker St',
        latitude: 18.53,
        longitude: 73.83,
        zoneId: zone.id,
        createdById: 'test-admin',
      },
    })

    try {
      const res = await request(createApp())
        .get('/api/v1/buildings/markers')
        .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      const row = res.body.data.find((b) => b.id === building.id)
      expect(row).toBeTruthy()
      expect(Object.keys(row).sort()).toEqual(['buildingName', 'id', 'isLive', 'latitude', 'longitude'])
    } finally {
      await prisma.building.delete({ where: { id: building.id } })
    }
  })

  it('a SURVEYOR with no zone assignments sees only their own buildings', async () => {
    const stamp = Date.now()
    const zone = await prisma.zone.findFirst()
    const ownBuilding = await prisma.building.create({
      data: {
        buildingName: `MarkerSurveyorOwn-${stamp}`,
        formattedAddress: '2 Marker St',
        latitude: 18.54,
        longitude: 73.84,
        zoneId: zone.id,
        createdById: 'test-surveyor',
      },
    })
    const otherBuilding = await prisma.building.create({
      data: {
        buildingName: `MarkerSurveyorOther-${stamp}`,
        formattedAddress: '3 Marker St',
        latitude: 18.55,
        longitude: 73.85,
        zoneId: zone.id,
        createdById: 'test-admin',
      },
    })

    try {
      const res = await request(createApp())
        .get('/api/v1/buildings/markers')
        .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
      expect(res.status).toBe(200)
      const ids = res.body.data.map((b) => b.id)
      expect(ids).toContain(ownBuilding.id)
      expect(ids).not.toContain(otherBuilding.id)
    } finally {
      await prisma.building.delete({ where: { id: ownBuilding.id } })
      await prisma.building.delete({ where: { id: otherBuilding.id } })
    }
  })
})
