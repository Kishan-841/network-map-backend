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

// A POP records the zone it sits in; these fixtures pick any real one.
const anyZoneId = async () => (await prisma.zone.findFirst()).id

// POP writes follow the fiber grant now — see seed-test-users.
const fiberManagerToken = jwt.sign({ sub: 'test-fiber-manager', role: 'MANAGER' }, env.jwtSecret, {
  audience: 'staff',
  expiresIn: '1h',
})

describe('pops API', () => {
  it('SURVEYOR reads but cannot write without the grant; a granted MANAGER create → olt → duplicate olt 409 → delete', async () => {
    const app = createApp()
    const stamp = Date.now()
    let id = null
    try {
      expect(
        (
          await request(app)
            .get('/api/v1/pops')
            .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
        ).status,
      ).toBe(200)
      expect(
        (
          await request(app)
            .post('/api/v1/pops')
            .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
            .send({})
        ).status,
      ).toBe(403)

      const auth = ['Authorization', `Bearer ${fiberManagerToken}`]
      const created = await request(app)
        .post('/api/v1/pops')
        .set(...auth)
        .send({ zoneId: await anyZoneId(), name: `POP-${stamp}`, latitude: 18.5, longitude: 73.8 })
      expect(created.status).toBe(201)
      id = created.body.data.id

      const olt = await request(app)
        .post(`/api/v1/pops/${id}/olts`)
        .set(...auth)
        .send({ name: 'OLT-1', ponPortCount: 16 })
      expect(olt.status).toBe(201)

      const dup = await request(app)
        .post(`/api/v1/pops/${id}/olts`)
        .set(...auth)
        .send({ name: 'OLT-1', ponPortCount: 16 })
      expect(dup.status).toBe(409)
    } finally {
      if (id) {
        const auth = ['Authorization', `Bearer ${fiberManagerToken}`]
        expect(
          (
            await request(app)
              .delete(`/api/v1/pops/${id}`)
              .set(...auth)
          ).status,
        ).toBe(200)
      }
    }
  })
})
