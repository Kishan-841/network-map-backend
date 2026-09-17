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

// Fiber writes need the per-user tick, not just a role — see seed-test-users.
const fiberManagerToken = jwt.sign({ sub: 'test-fiber-manager', role: 'MANAGER' }, env.jwtSecret, {
  audience: 'staff',
  expiresIn: '1h',
})

describe('closures API', () => {
  it('SURVEYOR reads, cannot write; MANAGER creates closure → splitter → set output → delete splitter → delete closure', async () => {
    const app = createApp()
    let closureId = null
    let splitterId = null
    let buildingId = null
    try {
      expect(
        (
          await request(app)
            .get('/api/v1/closures')
            .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
        ).status,
      ).toBe(200)
      expect(
        (
          await request(app)
            .post('/api/v1/closures')
            .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
            .send({})
        ).status,
      ).toBe(403)

      const auth = ['Authorization', `Bearer ${fiberManagerToken}`]

      const created = await request(app)
        .post('/api/v1/closures')
        .set(...auth)
        .send({ latitude: 18.5, longitude: 73.8, kind: 'pole' })
      expect(created.status).toBe(201)
      closureId = created.body.data.id
      expect(created.body.data.code).toMatch(/^JC-\d{4}$/)

      const splitter = await request(app)
        .post(`/api/v1/closures/${closureId}/splitters`)
        .set(...auth)
        .send({ ratio: 'R1_4', location: 'S1', fiberType: 'MAIN' })
      expect(splitter.status).toBe(201)
      splitterId = splitter.body.data.id
      expect(splitter.body.data.outputs).toHaveLength(4)
      expect(splitter.body.data.inputFiberId).toBeNull()
      expect(splitter.body.data.fiberType).toBe('MAIN')
      expect(splitter.body.data.code).toMatch(/^S\d+$/)
      // A closure's splitter inherits the closure's position.
      expect(splitter.body.data.latitude).toBe(18.5)

      const retyped = await request(app)
        .patch(`/api/v1/splitters/${splitterId}`)
        .set(...auth)
        .send({ fiberType: 'SUB', location: 'S2' })
      expect(retyped.status).toBe(200)
      expect(retyped.body.data.fiberType).toBe('SUB')
      expect(retyped.body.data.location).toBe('S2')

      const outputPatch = await request(app)
        .patch(`/api/v1/splitters/${splitterId}/outputs/2`)
        .set(...auth)
        .send({ label: 'Shop' })
      expect(outputPatch.status).toBe(200)
      expect(outputPatch.body.data.label).toBe('Shop')

      const building = await prisma.building.create({
        data: {
          buildingName: `Closure-Test-Bldg-${Date.now()}`,
          formattedAddress: '1 Closure St',
          latitude: 18.5,
          longitude: 73.8,
          createdById: 'test-admin',
        },
      })
      buildingId = building.id

      const outputPatch2 = await request(app)
        .patch(`/api/v1/splitters/${splitterId}/outputs/2`)
        .set(...auth)
        .send({ toBuildingId: buildingId })
      expect(outputPatch2.status).toBe(200)

      const closureGet = await request(app)
        .get(`/api/v1/closures/${closureId}`)
        .set(...auth)
      expect(closureGet.status).toBe(200)
      expect(closureGet.body.data.splitters[0].outputs[1].toBuilding.buildingName).toBe(building.buildingName)
      expect(closureGet.body.data.splitters[0].outputs[0].toBuilding).toBeNull()
      expect(closureGet.body.data.splitters[0].outputs[0].toFiber).toBeNull()
      expect(closureGet.body.data.splitters[0].fiberType).toBe('SUB')
      expect(closureGet.body.data.splitters[0].location).toBe('S2')

      expect(
        (
          await request(app)
            .delete(`/api/v1/splitters/${splitterId}`)
            .set(...auth)
        ).status,
      ).toBe(200)
      splitterId = null

      expect(
        (
          await request(app)
            .delete(`/api/v1/closures/${closureId}`)
            .set(...auth)
        ).status,
      ).toBe(200)
      closureId = null
    } finally {
      const auth = ['Authorization', `Bearer ${fiberManagerToken}`]
      if (splitterId) {
        await request(app)
          .delete(`/api/v1/splitters/${splitterId}`)
          .set(...auth)
      }
      if (closureId) {
        await request(app)
          .delete(`/api/v1/closures/${closureId}`)
          .set(...auth)
      }
      if (buildingId) {
        await prisma.building.delete({ where: { id: buildingId } }).catch(() => {})
      }
    }
  })
})
