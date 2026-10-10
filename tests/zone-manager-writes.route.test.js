import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

// Zone manager, task 3: a MANAGER's building writes stay inside its zones
// (spec 2026-10-10-zone-manager). Out of zone = 404, a foreign target zone = 400.
const tokenFor = (u) => jwt.sign({ sub: u.id, role: u.role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })

describe('zone manager writes only inside their zones', () => {
  const stamp = Date.now()
  let zoneA, zoneB, manager, admin, inA, inB, popA, oltA
  const created = []
  beforeAll(async () => {
    zoneA = await prisma.zone.create({ data: { name: `ZMW-A-${stamp}`, city: 'Aurangabad' } })
    zoneB = await prisma.zone.create({ data: { name: `ZMW-B-${stamp}`, city: 'Aurangabad' } })
    manager = await prisma.user.create({ data: { name: 'M', email: `zmw-m-${stamp}@test.local`, passwordHash: 'x', role: 'MANAGER', assignedZones: { connect: { id: zoneA.id } } } })
    admin = await prisma.user.create({ data: { name: 'A', email: `zmw-a-${stamp}@test.local`, passwordHash: 'x', role: 'ADMIN' } })
    const base = { formattedAddress: '1 ZM St', latitude: 19.87, longitude: 75.34, source: 'COVERAGE', createdById: admin.id, isLive: false }
    inA = await prisma.building.create({ data: { ...base, buildingName: `ZMW-inA-${stamp}`, zoneId: zoneA.id } })
    inB = await prisma.building.create({ data: { ...base, buildingName: `ZMW-inB-${stamp}`, latitude: 19.88, zoneId: zoneB.id } })
    // One POP serving zone A, with one OLT — the target for the bulk OLT mapping.
    popA = await prisma.pop.create({
      data: { name: `ZMW POP-A ${stamp}`, latitude: 19.87, longitude: 75.34, createdById: admin.id, zones: { connect: { id: zoneA.id } } },
    })
    oltA = await prisma.olt.create({ data: { popId: popA.id, name: `ZMW OLT-A ${stamp}`, ponPortCount: 8 } })
  })
  afterAll(async () => {
    const ids = [inA, inB].filter(Boolean).map((b) => b.id).concat(created)
    await prisma.building.deleteMany({ where: { OR: [{ id: { in: ids } }, { buildingName: { startsWith: `ZMW-new-${stamp}` } }] } })
    if (oltA) await prisma.olt.deleteMany({ where: { id: oltA.id } })
    if (popA) await prisma.pop.deleteMany({ where: { id: popA.id } })
    await prisma.systemLog.deleteMany({ where: { userId: { in: [manager, admin].filter(Boolean).map((u) => u.id) } } })
    await prisma.user.deleteMany({ where: { id: { in: [manager, admin].filter(Boolean).map((u) => u.id) } } })
    await prisma.zone.deleteMany({ where: { id: { in: [zoneA, zoneB].filter(Boolean).map((z) => z.id) } } })
  })

  const send = (method, user, path, body) =>
    request(createApp())[method](path).set('Authorization', `Bearer ${tokenFor(user)}`).send(body)

  it('edits a zone-A building, 404s a zone-B one', async () => {
    expect((await send('patch', manager, `/api/v1/buildings/${inA.id}`, { buildingName: `ZMW-A2-${stamp}` })).status).toBe(200)
    expect((await send('patch', manager, `/api/v1/buildings/${inB.id}`, { buildingName: 'nope' })).status).toBe(404)
    expect((await prisma.building.findUnique({ where: { id: inB.id } })).buildingName).toBe(`ZMW-inB-${stamp}`)
  })

  it('cannot move a building into a zone that is not theirs', async () => {
    const res = await send('patch', manager, `/api/v1/buildings/${inA.id}`, { zoneId: zoneB.id })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('Pick one of your zones')
    expect((await prisma.building.findUnique({ where: { id: inA.id } })).zoneId).toBe(zoneA.id)
  })

  it('marks zone A live, 404s zone B status', async () => {
    expect((await send('patch', manager, `/api/v1/buildings/${inA.id}/status`, { isLive: true })).status).toBe(200)
    expect((await send('patch', manager, `/api/v1/buildings/${inB.id}/status`, { isLive: true })).status).toBe(404)
    expect((await prisma.building.findUnique({ where: { id: inB.id } })).isLive).toBe(false)
  })

  it('bulk live changes only zone-A rows', async () => {
    const res = await send('patch', manager, '/api/v1/buildings/bulk-status', { ids: [inA.id, inB.id], isLive: true })
    expect(res.status).toBe(200)
    expect(res.body.data.count).toBe(1)
    expect((await prisma.building.findUnique({ where: { id: inB.id } })).isLive).toBe(false) // untouched (seeded false)
  })

  it('cannot create a building in zone B', async () => {
    const res = await send('post', manager, '/api/v1/buildings', {
      buildingName: `ZMW-new-${stamp}-B`, formattedAddress: '2 ZM St', latitude: 19.9, longitude: 75.3, zoneId: zoneB.id,
    })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('Pick one of your zones')
  })

  it('creates a building in zone A', async () => {
    const res = await send('post', manager, '/api/v1/buildings', {
      buildingName: `ZMW-new-${stamp}-A`, formattedAddress: '2 ZM St', latitude: 19.9, longitude: 75.3, zoneId: zoneA.id,
    })
    expect(res.status).toBe(201)
    created.push(res.body.data.id)
    expect(res.body.data.zoneId).toBe(zoneA.id)
  })

  it('cannot OLT-assign a zone-B building', async () => {
    const res = await send('patch', manager, '/api/v1/buildings/bulk-olt', { ids: [inB.id], oltId: oltA.id, ponPorts: [1] })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('None of those buildings are available to you')
    expect((await prisma.building.findUnique({ where: { id: inB.id } })).oltId).toBeNull()
  })

  it('a mixed OLT assignment maps only the zone-A building', async () => {
    const res = await send('patch', manager, '/api/v1/buildings/bulk-olt', { ids: [inA.id, inB.id], oltId: oltA.id, ponPorts: [2] })
    expect(res.status).toBe(200)
    expect(res.body.data.count).toBe(1)
    expect((await prisma.building.findUnique({ where: { id: inA.id } })).oltId).toBe(oltA.id)
    expect((await prisma.building.findUnique({ where: { id: inB.id } })).oltId).toBeNull()
  })
})
