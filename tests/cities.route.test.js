import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

describe('cities API', () => {
  it('lists cities for MANAGER, blocks SURVEYOR, requires auth', async () => {
    const ok = await request(createApp())
      .get('/api/v1/cities')
      .set('Authorization', `Bearer ${tokenFor('MANAGER')}`)
    expect(ok.status).toBe(200)
    expect(Array.isArray(ok.body.data)).toBe(true)

    const denied = await request(createApp())
      .get('/api/v1/cities')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
    expect(denied.status).toBe(403)

    const anon = await request(createApp()).get('/api/v1/cities')
    expect(anon.status).toBe(401)
  })

  it('create is ADMIN-only (MANAGER blocked)', async () => {
    const res = await request(createApp())
      .post('/api/v1/cities')
      .set('Authorization', `Bearer ${tokenFor('MANAGER')}`)
      .send({ name: 'NopeCity' })
    expect(res.status).toBe(403)
  })

  it('admin round-trip: create, duplicate 409, rename, delete detaches operators', async () => {
    const stamp = Date.now()
    const app = createApp()
    const auth = ['Authorization', `Bearer ${tokenFor('ADMIN')}`]

    const created = await request(app)
      .post('/api/v1/cities')
      .set(...auth)
      .send({ name: `CityTest-${stamp}` })
    expect(created.status).toBe(201)
    const cityId = created.body.data.id

    const dup = await request(app)
      .post('/api/v1/cities')
      .set(...auth)
      .send({ name: `citytest-${stamp}` })
    expect(dup.status).toBe(409)

    const renamed = await request(app)
      .patch(`/api/v1/cities/${cityId}`)
      .set(...auth)
      .send({ name: `CityTest-${stamp}-renamed` })
    expect(renamed.status).toBe(200)

    const operator = await prisma.operator.create({
      data: { name: `CityTestOp-${stamp}`, cityId },
    })

    const del = await request(app).delete(`/api/v1/cities/${cityId}`).set(...auth)
    expect(del.status).toBe(200)

    const detached = await prisma.operator.findUnique({ where: { id: operator.id } })
    expect(detached.cityId).toBeNull()
    await prisma.operator.delete({ where: { id: operator.id } })
  })
})
