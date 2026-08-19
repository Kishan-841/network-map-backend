import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

const SEGMENTS = [
  [
    { latitude: 18.59, longitude: 73.74 },
    { latitude: 18.6, longitude: 73.75 },
  ],
]

describe('fiber routes API', () => {
  it('lists for any authenticated role; requires auth', async () => {
    const ok = await request(createApp())
      .get('/api/v1/fiber-routes')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
    expect(ok.status).toBe(200)
    expect(Array.isArray(ok.body.data)).toBe(true)
    expect((await request(createApp()).get('/api/v1/fiber-routes')).status).toBe(401)
  })

  it('blocks SURVEYOR writes', async () => {
    const res = await request(createApp())
      .post('/api/v1/fiber-routes')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
      .send({ name: 'Nope', segments: SEGMENTS })
    expect(res.status).toBe(403)
  })

  it('MANAGER round-trip: create → duplicate 409 → update → delete', async () => {
    const stamp = Date.now()
    const app = createApp()
    const auth = ['Authorization', `Bearer ${tokenFor('MANAGER')}`]

    const created = await request(app)
      .post('/api/v1/fiber-routes')
      .set(...auth)
      .send({ name: `FiberTest-${stamp}`, segments: SEGMENTS, color: '#dc2626' })
    expect(created.status).toBe(201)
    expect(created.body.data.color).toBe('#dc2626')
    const id = created.body.data.id

    const dup = await request(app)
      .post('/api/v1/fiber-routes')
      .set(...auth)
      .send({ name: `fibertest-${stamp}`, segments: SEGMENTS })
    expect(dup.status).toBe(409)

    const updated = await request(app)
      .patch(`/api/v1/fiber-routes/${id}`)
      .set(...auth)
      .send({ segments: [...SEGMENTS, [SEGMENTS[0][1], { latitude: 18.61, longitude: 73.73 }]] })
    expect(updated.status).toBe(200)
    expect(updated.body.data.segments).toHaveLength(2)

    const del = await request(app).delete(`/api/v1/fiber-routes/${id}`).set(...auth)
    expect(del.status).toBe(200)
  })
})
