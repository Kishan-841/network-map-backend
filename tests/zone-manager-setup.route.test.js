import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (u) => jwt.sign({ sub: u.id, role: u.role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })

describe('zone manager: zones and setup pages', () => {
  const stamp = Date.now()
  let zoneA, zoneB, manager, admin
  beforeAll(async () => {
    admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    zoneA = await prisma.zone.create({ data: { name: `ZM-A-${stamp}`, city: 'Aurangabad' } })
    zoneB = await prisma.zone.create({ data: { name: `ZM-B-${stamp}`, city: 'Aurangabad' } })
    manager = await prisma.user.create({
      data: { name: 'ZM Manager', email: `zm-mgr-${stamp}@test.local`, passwordHash: 'x', role: 'MANAGER' },
    })
  })
  afterAll(async () => {
    await prisma.user.delete({ where: { id: manager.id } })
    await prisma.zone.deleteMany({ where: { id: { in: [zoneA.id, zoneB.id] } } })
  })

  it('an admin can give a manager zones', async () => {
    const res = await request(createApp())
      .patch(`/api/v1/users/${manager.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ zoneIds: [zoneA.id] })
    expect(res.status).toBe(200)
    expect(res.body.data.assignedZones.map((z) => z.id)).toEqual([zoneA.id])
  })

  it('the manager lists only their zones', async () => {
    const res = await request(createApp()).get('/api/v1/zones').set('Authorization', `Bearer ${tokenFor(manager)}`)
    expect(res.status).toBe(200)
    const items = Array.isArray(res.body.data) ? res.body.data : res.body.data.items
    expect(items.map((z) => z.id)).toEqual([zoneA.id])
  })

  it('setup writes are admin-only', async () => {
    const app = createApp()
    const auth = { Authorization: `Bearer ${tokenFor(manager)}` }
    expect((await request(app).post('/api/v1/zones').set(auth).send({ name: `x-${stamp}`, city: 'X' })).status).toBe(403)
    expect((await request(app).patch(`/api/v1/zones/${zoneA.id}`).set(auth).send({ name: 'y' })).status).toBe(403)
    expect((await request(app).post('/api/v1/operators').set(auth).send({ name: `op-${stamp}` })).status).toBe(403)
    expect((await request(app).post('/api/v1/building-types').set(auth).send({ name: `bt-${stamp}` })).status).toBe(403)
  })
})
