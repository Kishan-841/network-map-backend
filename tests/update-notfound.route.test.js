import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const admin = jwt.sign({ sub: 'test-admin', role: 'ADMIN' }, env.jwtSecret, { expiresIn: '1h' })

describe('update edge cases return clean 4xx (not 500)', () => {
  it('PATCH /users/:id on a missing id → 404', async () => {
    const res = await request(createApp())
      .patch('/api/v1/users/does-not-exist')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'X' })
    expect(res.status).toBe(404)
  })

  it('PATCH /zones/:id can clear a boundary to null without 500', async () => {
    const stamp = Date.now()
    const zone = await prisma.zone.create({
      data: {
        name: `BoundaryClear-${stamp}`,
        city: 'Testville',
        boundary: [
          { latitude: 1, longitude: 1 },
          { latitude: 2, longitude: 2 },
          { latitude: 3, longitude: 3 },
        ],
      },
    })
    const res = await request(createApp())
      .patch(`/api/v1/zones/${zone.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ boundary: null })
    expect(res.status).toBe(200)
    expect(res.body.data.boundary).toBeNull()

    const reloaded = await prisma.zone.findUnique({ where: { id: zone.id } })
    expect(reloaded.boundary).toBeNull()

    await prisma.zone.delete({ where: { id: zone.id } })
  })

  it('PATCH /zones/:id on a missing id → 404', async () => {
    const res = await request(createApp())
      .patch('/api/v1/zones/does-not-exist')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'X' })
    expect(res.status).toBe(404)
  })
})
