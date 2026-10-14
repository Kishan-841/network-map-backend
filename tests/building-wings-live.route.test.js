
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { createBuildingService } from '../src/modules/buildings/building.service.js'
import { buildingRepository } from '../src/modules/buildings/building.repository.js'

const app = createApp()
const S = `bwl-${Date.now()}`
const ADMIN = `${S}-admin`
const auth = { Authorization: `Bearer ${jwt.sign({ sub: ADMIN, role: 'ADMIN' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` }
let zone, complete, partial, society
const mk = (name, wings, placed) =>
  prisma.building.create({
    data: { buildingName: `${S} ${name}`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId: zone.id, createdById: ADMIN, isLive: false,
      details: { create: { wings, homePass: 50 } },
      wings: { create: placed.map((n, i) => ({ name: n, latitude: 18.5 + i / 1e4, longitude: 73.8, homePass: 10, isLive: false })) } },
  })

beforeAll(async () => {
  zone = await prisma.zone.create({ data: { name: `${S}-z`, city: 'Test' } })
  await prisma.user.create({ data: { id: ADMIN, name: 'A', email: `${ADMIN}@t.local`, passwordHash: 'x', role: 'ADMIN' } })
  complete = await mk('Complete', 2, ['A', 'B'])
  partial = await mk('Partial', 3, ['A'])
  society = await mk('Soc', 2, ['A', 'B'])
  await prisma.building.update({ where: { id: society.id }, data: { source: 'PERMISSION', permissionApproval: 'APPROVED' } })
})
afterAll(async () => {
  await prisma.building.deleteMany({ where: { id: { in: [complete.id, partial.id, society.id] } } })
  await prisma.systemLog.deleteMany({ where: { userId: ADMIN } }).catch(() => {})
  await prisma.user.delete({ where: { id: ADMIN } })
  await prisma.zone.delete({ where: { id: zone.id } })
})

const wingsOf = (id) => prisma.buildingWing.findMany({ where: { buildingId: id }, orderBy: { name: 'asc' } })

describe('building edits with wings', () => {
  it('refuses lowering the wing count below the wings placed', async () => {
    const res = await request(app).patch(`/api/v1/buildings/${complete.id}`).set(auth).send({ details: { wings: 1 } })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/2 wings are located/)
  })

  it('ignores a typed home pass on a complete building', async () => {
    const res = await request(app).patch(`/api/v1/buildings/${complete.id}`).set(auth).send({ details: { homePass: 999, floors: 4 } })
    expect(res.status).toBe(200)
    const row = await prisma.buildingDetails.findUnique({ where: { buildingId: complete.id } })
    expect(row.floors).toBe(4)
    expect(row.homePass).toBe(20)
  })

  it('the single Live toggle cascades to a complete building\'s wings only', async () => {
    expect((await request(app).patch(`/api/v1/buildings/${complete.id}/status`).set(auth).send({ isLive: true })).status).toBe(200)
    expect((await wingsOf(complete.id)).every((w) => w.isLive)).toBe(true)
    await request(app).patch(`/api/v1/buildings/${partial.id}/status`).set(auth).send({ isLive: true })
    expect((await wingsOf(partial.id)).every((w) => !w.isLive)).toBe(true)
  })

  it('bulk Live cascades to complete buildings only', async () => {
    await prisma.buildingWing.updateMany({ where: { buildingId: { in: [complete.id, partial.id] } }, data: { isLive: true } })
    const res = await request(app).patch('/api/v1/buildings/bulk-status').set(auth).send({ ids: [complete.id, partial.id], isLive: false })
    expect(res.status).toBe(200)
    expect((await wingsOf(partial.id)).every((w) => w.isLive)).toBe(true)
    expect((await wingsOf(complete.id)).every((w) => !w.isLive)).toBe(true)
  })

  it('the edit-form Live switch cascades too', async () => {
    await request(app).patch(`/api/v1/buildings/${complete.id}`).set(auth).send({ isLive: true })
    expect((await wingsOf(complete.id)).every((w) => w.isLive)).toBe(true)
  })

  it('deleting a building deletes its wings', async () => {
    const tmp = await mk('Tmp', 1, ['A'])
    await request(app).delete(`/api/v1/buildings/${tmp.id}`).set(auth)
    expect(await prisma.buildingWing.count({ where: { buildingId: tmp.id } })).toBe(0)
  })

  it('a society obeys the wing count limit too', async () => {
    const res = await request(app).patch(`/api/v1/buildings/${society.id}`).set(auth).send({ details: { wings: 1 }, remark: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/2 wings are located/)
  })

  it('a complete society ignores a typed home pass', async () => {
    const res = await request(app).patch(`/api/v1/buildings/${society.id}`).set(auth).send({ details: { homePass: 777, floors: 5 }, remark: 'x' })
    expect(res.status).toBe(200)
    const row = await prisma.buildingDetails.findUnique({ where: { buildingId: society.id } })
    expect(row.floors).toBe(5)
    expect(row.homePass).toBe(20)
  })

  it('a filter that includes isLive still cascades (ids resolved before the update)', async () => {
    await prisma.building.updateMany({ where: { id: { in: [complete.id, partial.id] } }, data: { isLive: false } })
    await prisma.buildingWing.updateMany({ where: { buildingId: { in: [complete.id, partial.id] } }, data: { isLive: false } })
    const service = createBuildingService({ buildingRepository })
    await service.bulkSetLive({ filter: { zoneId: zone.id, isLive: false }, isLive: true }, { id: ADMIN, role: 'ADMIN' })
    expect((await wingsOf(complete.id)).every((w) => w.isLive)).toBe(true)
    expect((await wingsOf(partial.id)).every((w) => !w.isLive)).toBe(true)
  })

  it('lowering the count to the wings placed makes it complete and derives totals', async () => {
    const b = await mk('Derive', 3, ['A', 'B'])
    try {
      await prisma.buildingWing.updateMany({ where: { buildingId: b.id, name: 'A' }, data: { isLive: true, homePass: 7 } })
      const res = await request(app).patch(`/api/v1/buildings/${b.id}`).set(auth).send({ details: { wings: 2 } })
      expect(res.status).toBe(200)
      const row = await prisma.buildingDetails.findUnique({ where: { buildingId: b.id } })
      expect(row.homePass).toBe(17)
      expect((await prisma.building.findUnique({ where: { id: b.id } })).isLive).toBe(true)
    } finally {
      await prisma.building.delete({ where: { id: b.id } })
    }
  })
})
