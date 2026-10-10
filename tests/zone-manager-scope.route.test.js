import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

// Zone manager, task 2: a MANAGER reads only the zones an admin gave them,
// plus what they added themselves (spec 2026-10-10-zone-manager).
const tokenFor = (u) => jwt.sign({ sub: u.id, role: u.role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })

describe('zone manager reads only their zones', () => {
  const stamp = Date.now()
  let op, zoneA, zoneB, manager, emptyManager, surveyor, inA, inB, societyA, societyB
  beforeAll(async () => {
    op = await prisma.operator.create({ data: { name: `ZMS-op-${stamp}` } })
    zoneA = await prisma.zone.create({ data: { name: `ZMS-A-${stamp}`, city: 'Aurangabad', operatorId: op.id } })
    zoneB = await prisma.zone.create({ data: { name: `ZMS-B-${stamp}`, city: 'Aurangabad', operatorId: op.id } })
    manager = await prisma.user.create({ data: { name: 'M', email: `zms-m-${stamp}@test.local`, passwordHash: 'x', role: 'MANAGER', assignedZones: { connect: { id: zoneA.id } } } })
    emptyManager = await prisma.user.create({ data: { name: 'E', email: `zms-e-${stamp}@test.local`, passwordHash: 'x', role: 'MANAGER' } })
    surveyor = await prisma.user.create({ data: { name: 'S', email: `zms-s-${stamp}@test.local`, passwordHash: 'x', role: 'SURVEYOR', assignedZones: { connect: { id: zoneA.id } } } })
    const base = { formattedAddress: '1 ZM St', latitude: 19.87, longitude: 75.34, source: 'COVERAGE' }
    inA = await prisma.building.create({ data: { ...base, buildingName: `ZMS-inA-${stamp}`, zoneId: zoneA.id, createdById: surveyor.id } })
    inB = await prisma.building.create({ data: { ...base, buildingName: `ZMS-inB-${stamp}`, latitude: 19.88, zoneId: zoneB.id, createdById: surveyor.id } })
    const society = { ...base, source: 'PERMISSION', permissionApproval: 'APPROVED', createdById: surveyor.id }
    societyA = await prisma.building.create({ data: { ...society, buildingName: `ZMS-socA-${stamp}`, zoneId: zoneA.id } })
    societyB = await prisma.building.create({ data: { ...society, buildingName: `ZMS-socB-${stamp}`, zoneId: zoneB.id } })
  })
  afterAll(async () => {
    await prisma.building.deleteMany({ where: { id: { in: [inA, inB, societyA, societyB].filter(Boolean).map((b) => b.id) } } })
    await prisma.user.deleteMany({ where: { id: { in: [manager, emptyManager, surveyor].filter(Boolean).map((u) => u.id) } } })
    await prisma.zone.deleteMany({ where: { id: { in: [zoneA, zoneB].filter(Boolean).map((z) => z.id) } } })
    if (op) await prisma.operator.deleteMany({ where: { id: op.id } })
  })

  const get = (user, path) => request(createApp()).get(path).set('Authorization', `Bearer ${tokenFor(user)}`)

  it('lists the zone-A building a surveyor added, not the zone-B one', async () => {
    const res = await get(manager, `/api/v1/buildings?pageSize=500&search=ZMS-`)
    expect(res.status).toBe(200)
    const ids = res.body.data.items.map((b) => b.id)
    expect(ids).toContain(inA.id)
    expect(ids).not.toContain(inB.id)
  })

  it('map markers carry zone A only', async () => {
    const res = await get(manager, `/api/v1/buildings/markers?search=ZMS-in`)
    expect(res.status).toBe(200)
    const rows = Array.isArray(res.body.data) ? res.body.data : res.body.data.items
    const ids = rows.map((b) => b.id)
    expect(ids).toContain(inA.id)
    expect(ids).not.toContain(inB.id)
  })

  it('opens zone A by link, 404s zone B', async () => {
    expect((await get(manager, `/api/v1/buildings/${inA.id}`)).status).toBe(200)
    expect((await get(manager, `/api/v1/buildings/${inB.id}`)).status).toBe(404)
  })

  it('nearby masks the zone-B building', async () => {
    const res = await get(manager, `/api/v1/buildings/nearby?latitude=19.875&longitude=75.34&radius=2000`)
    expect(res.status).toBe(200)
    const a = res.body.data.find((b) => b.id === inA.id)
    const b = res.body.data.find((row) => row.id === inB.id)
    expect(a?.masked).toBeFalsy()
    expect(a?.buildingName).toBe(`ZMS-inA-${stamp}`)
    expect(b?.masked).toBe(true)
  })

  it('a manager with no zones sees no buildings and no zones', async () => {
    const list = await get(emptyManager, `/api/v1/buildings?pageSize=500&search=ZMS-`)
    expect(list.status).toBe(200)
    expect(list.body.data.items).toEqual([])
    expect(list.body.data.pagination.total).toBe(0)
    const zones = await get(emptyManager, '/api/v1/zones')
    expect(zones.status).toBe(200)
    const items = Array.isArray(zones.body.data) ? zones.body.data : zones.body.data.items
    expect(items).toEqual([])
  })

  it('dashboard counts only zone A for the manager', async () => {
    const res = await get(manager, `/api/v1/stats/dashboard?operatorId=${op.id}`)
    expect(res.status).toBe(200)
    // inA + the approved society in zone A; zone B's two are left out.
    expect(res.body.data.totalBuildings).toBe(2)
  })

  it('dashboard totals for a manager with no zones are zero', async () => {
    const res = await get(emptyManager, '/api/v1/stats/dashboard')
    expect(res.status).toBe(200)
    expect(res.body.data.totalBuildings).toBe(0)
    expect(res.body.data.byLive).toEqual({ live: 0, notLive: 0 })
    expect(res.body.data.totalHomePass).toBe(0)
  })

  it('reads the approved society in zone A, 404s the one in zone B', async () => {
    expect((await get(manager, `/api/v1/permission-buildings/${societyA.id}`)).status).toBe(200)
    expect((await get(manager, `/api/v1/permission-buildings/${societyB.id}`)).status).toBe(404)
    expect((await get(emptyManager, `/api/v1/permission-buildings/${societyA.id}`)).status).toBe(404)
  })

  it('the societies list holds zone A only, and nothing for a manager with no zones', async () => {
    const res = await get(manager, `/api/v1/permission-buildings?search=ZMS-soc&pageSize=100`)
    expect(res.status).toBe(200)
    const rows = Array.isArray(res.body.data) ? res.body.data : res.body.data.items
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(societyA.id)
    expect(ids).not.toContain(societyB.id)
    const empty = await get(emptyManager, `/api/v1/permission-buildings?search=ZMS-soc&pageSize=100`)
    expect(empty.status).toBe(200)
    expect(Array.isArray(empty.body.data) ? empty.body.data : empty.body.data.items).toEqual([])
  })
})
