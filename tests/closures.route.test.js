import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, {
    audience: 'staff',
    expiresIn: '1h',
  })

describe('closures API', () => {
  it('SURVEYOR reads, cannot write; MANAGER creates closure → splitter → set output → delete splitter → delete closure', async () => {
    const app = createApp()
    let closureId = null
    let splitterId = null
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

      const auth = ['Authorization', `Bearer ${tokenFor('MANAGER')}`]

      const created = await request(app)
        .post('/api/v1/closures')
        .set(...auth)
        .send({ latitude: 18.5, longitude: 73.8, kind: 'pole' })
      expect(created.status).toBe(201)
      closureId = created.body.data.id
      expect(created.body.data.code).toMatch(/^CL-\d{4}$/)

      const splitter = await request(app)
        .post(`/api/v1/closures/${closureId}/splitters`)
        .set(...auth)
        .send({ ratio: 'R1_4', location: 'WAN' })
      expect(splitter.status).toBe(201)
      splitterId = splitter.body.data.id
      expect(splitter.body.data.outputs).toHaveLength(4)
      expect(splitter.body.data.inputFiberId).toBeNull()

      const outputPatch = await request(app)
        .patch(`/api/v1/splitters/${splitterId}/outputs/2`)
        .set(...auth)
        .send({ label: 'Shop' })
      expect(outputPatch.status).toBe(200)
      expect(outputPatch.body.data.label).toBe('Shop')

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
      const auth = ['Authorization', `Bearer ${tokenFor('MANAGER')}`]
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
    }
  })
})
