import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

describe('POST /api/v1/users/bulk-zones', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).post('/api/v1/users/bulk-zones').send({})
    expect(res.status).toBe(401)
  })

  it('rejects MANAGER and SURVEYOR', async () => {
    for (const role of ['MANAGER', 'SURVEYOR']) {
      const res = await request(createApp())
        .post('/api/v1/users/bulk-zones')
        .set('Authorization', `Bearer ${tokenFor(role)}`)
        .send({ assignments: [{ email: 'a@b.co', zoneNames: ['X'] }] })
      expect(res.status).toBe(403)
    }
  })

  it('rejects an invalid body', async () => {
    const res = await request(createApp())
      .post('/api/v1/users/bulk-zones')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({ assignments: [] })
    expect(res.status).toBe(400)
  })

  it('assigns zones by sheet rows end-to-end', async () => {
    const stamp = Date.now()
    const email = `bulk-assign-${stamp}@isp.local`
    const zones = await prisma.zone.findMany({ take: 2 })
    const surveyor = await prisma.user.create({
      data: { name: 'Bulk Assign Test', email, passwordHash: 'x', role: 'SURVEYOR' },
    })

    const res = await request(createApp())
      .post('/api/v1/users/bulk-zones')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({
        assignments: [
          { email: email.toUpperCase(), zoneNames: zones.map((z) => z.name) },
          { email: `ghost-${stamp}@isp.local`, zoneNames: [zones[0].name] },
        ],
      })
    expect(res.status).toBe(200)
    expect(res.body.data.updated).toEqual([{ email, zones: zones.length }])
    expect(res.body.data.skipped).toEqual([
      { email: `ghost-${stamp}@isp.local`, reason: 'user not found' },
    ])

    const assigned = await prisma.zone.findMany({
      where: { assignedUsers: { some: { id: surveyor.id } } },
      select: { id: true },
    })
    expect(assigned.map((z) => z.id).sort()).toEqual(zones.map((z) => z.id).sort())

    await prisma.user.delete({ where: { id: surveyor.id } })
  })
})
