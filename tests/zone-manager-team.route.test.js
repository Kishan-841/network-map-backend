import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

// Zone manager, task 4: a MANAGER adds and edits their own Surveyors (zones
// only from their own), lists only their team; the ADMIN sets "reports to";
// demoting a manager clears their surveyors' link (spec 2026-10-10-zone-manager).
const tokenFor = (u) => jwt.sign({ sub: u.id, role: u.role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })

describe('zone manager runs their own surveyors', () => {
  const stamp = Date.now()
  let zoneA, zoneB, zoneC, m1, m2, admin, t1
  beforeAll(async () => {
    zoneA = await prisma.zone.create({ data: { name: `ZMT-A-${stamp}`, city: 'Aurangabad' } })
    zoneB = await prisma.zone.create({ data: { name: `ZMT-B-${stamp}`, city: 'Aurangabad' } })
    zoneC = await prisma.zone.create({ data: { name: `ZMT-C-${stamp}`, city: 'Aurangabad' } })
    m1 = await prisma.user.create({ data: { name: 'M1', email: `zmt-m1-${stamp}@test.local`, passwordHash: 'x', role: 'MANAGER', assignedZones: { connect: [{ id: zoneA.id }, { id: zoneB.id }] } } })
    m2 = await prisma.user.create({ data: { name: 'M2', email: `zmt-m2-${stamp}@test.local`, passwordHash: 'x', role: 'MANAGER', assignedZones: { connect: { id: zoneA.id } } } })
    admin = await prisma.user.create({ data: { name: 'A', email: `zmt-a-${stamp}@test.local`, passwordHash: 'x', role: 'ADMIN' } })
  })
  afterAll(async () => {
    const surveyors = await prisma.user.findMany({ where: { email: { startsWith: 'zmt-', endsWith: `-${stamp}@test.local` }, id: { notIn: [m1, m2, admin].filter(Boolean).map((u) => u.id) } }, select: { id: true } })
    const sIds = surveyors.map((u) => u.id)
    const mIds = [m1, m2, admin].filter(Boolean).map((u) => u.id)
    await prisma.systemLog.deleteMany({ where: { userId: { in: [...sIds, ...mIds] } } })
    await prisma.user.deleteMany({ where: { id: { in: sIds } } })
    await prisma.user.deleteMany({ where: { id: { in: mIds } } })
    await prisma.zone.deleteMany({ where: { id: { in: [zoneA, zoneB, zoneC].filter(Boolean).map((z) => z.id) } } })
  })

  const send = (method, user, path, body) =>
    request(createApp())[method](path).set('Authorization', `Bearer ${tokenFor(user)}`).send(body)

  it('manager creates a surveyor in their zone; role and reports-to are forced', async () => {
    const res = await send('post', m1, '/api/v1/users', { name: 'T1', email: `zmt-t1-${stamp}@test.local`, password: 'pass1234', role: 'SURVEYOR', zoneIds: [zoneA.id], managerId: m2.id })
    expect(res.status).toBe(201)
    expect(res.body.data.role).toBe('SURVEYOR')
    expect(res.body.data.managerId).toBe(m1.id)
    expect(res.body.data.teamLeaderId).toBeNull()
    expect(res.body.data.assignedZones.map((z) => z.id)).toEqual([zoneA.id])
    t1 = res.body.data
  })

  it('refuses other roles (403) and zones the manager does not have (400)', async () => {
    expect((await send('post', m1, '/api/v1/users', { name: 'x', email: `zmt-x-${stamp}@test.local`, password: 'pass1234', role: 'SALES_EXECUTIVE' })).status).toBe(403)
    expect((await send('post', m1, '/api/v1/users', { name: 'x', email: `zmt-x2-${stamp}@test.local`, password: 'pass1234', role: 'MANAGER' })).status).toBe(403)
    const res = await send('post', m1, '/api/v1/users', { name: 'y', email: `zmt-y-${stamp}@test.local`, password: 'pass1234', role: 'SURVEYOR', zoneIds: [zoneC.id] })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('You can only give zones you manage')
    expect(await prisma.user.findUnique({ where: { email: `zmt-y-${stamp}@test.local` } })).toBeNull()
  })

  it('lists only their own surveyors', async () => {
    const res = await send('get', m1, '/api/v1/users?page=1')
    expect(res.status).toBe(200)
    expect(res.body.data.items.map((u) => u.id)).toEqual([t1.id])
    expect(res.body.data.total).toBe(1)
    // A forged role filter does not widen the scope.
    const forged = await send('get', m1, '/api/v1/users?page=1&role=ADMIN')
    expect(forged.body.data.items.map((u) => u.id)).toEqual([t1.id])
    const arr1 = await send('get', m1, '/api/v1/users')
    expect(arr1.body.data.map((u) => u.id)).toEqual([t1.id])
    const arr = await send('get', m2, '/api/v1/users')
    expect(arr.status).toBe(200)
    expect(arr.body.data.map((u) => u.id)).not.toContain(t1.id)
  })

  it('another manager, or the manager on themselves, gets 404', async () => {
    expect((await send('patch', m2, `/api/v1/users/${t1.id}`, { name: 'z' })).status).toBe(404)
    expect((await send('patch', m1, `/api/v1/users/${m1.id}`, { name: 'z' })).status).toBe(404)
    expect((await prisma.user.findUnique({ where: { id: m1.id } })).name).toBe('M1')
  })

  it('cannot change role or reports-to; sending the current values is a no-op', async () => {
    expect((await send('patch', m1, `/api/v1/users/${t1.id}`, { role: 'MANAGER' })).status).toBe(400)
    expect((await send('patch', m1, `/api/v1/users/${t1.id}`, { managerId: m2.id })).status).toBe(400)
    expect((await send('patch', m1, `/api/v1/users/${t1.id}`, { managerId: null })).status).toBe(400)
    const same = await send('patch', m1, `/api/v1/users/${t1.id}`, { role: 'SURVEYOR', managerId: m1.id, name: 'T1b' })
    expect(same.status).toBe(200)
    expect(same.body.data.name).toBe('T1b')
    const row = await prisma.user.findUnique({ where: { id: t1.id } })
    expect(row.role).toBe('SURVEYOR')
    expect(row.managerId).toBe(m1.id)
  })

  it('refuses a zone the manager does not have on edit', async () => {
    const res = await send('patch', m1, `/api/v1/users/${t1.id}`, { zoneIds: [zoneC.id] })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('You can only give zones you manage')
  })

  it('keeps a zone the manager cannot see when editing zones', async () => {
    await prisma.user.update({ where: { id: t1.id }, data: { assignedZones: { connect: { id: zoneC.id } } } }) // admin gave C
    const res = await send('patch', m1, `/api/v1/users/${t1.id}`, { zoneIds: [zoneB.id] })
    expect(res.status).toBe(200)
    expect(res.body.data.assignedZones.map((z) => z.id).sort()).toEqual([zoneB.id, zoneC.id].sort())
  })

  it('admin sets reports-to a manager; a non-manager is refused', async () => {
    const ok = await send('patch', admin, `/api/v1/users/${t1.id}`, { managerId: m2.id })
    expect(ok.status).toBe(200)
    expect(ok.body.data.managerId).toBe(m2.id)
    const bad = await send('patch', admin, `/api/v1/users/${t1.id}`, { managerId: admin.id })
    expect(bad.status).toBe(400)
    expect(bad.body.error.message).toBe('Reports to must be a manager')
  })

  it('demoting a manager clears their surveyors\' reports-to', async () => {
    expect((await send('patch', admin, `/api/v1/users/${m2.id}`, { role: 'SUPERVISOR' })).status).toBe(200)
    expect((await prisma.user.findUnique({ where: { id: t1.id } })).managerId).toBeNull()
  })
})
