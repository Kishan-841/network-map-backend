import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { buildingRepository } from '../src/modules/buildings/building.repository.js'

const app = createApp()
const S = `bw-${Date.now()}`
const auth = (id, role) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })
const IDS = { admin: `${S}-admin`, surveyor: `${S}-sv`, other: `${S}-sv2` }
let zone, building, society
const wing = (o) => ({ name: 'A', latitude: 18.5, longitude: 73.8, homePass: 10, isLive: false, ...o })
const put = (id, wings, who = IDS.admin, role = 'ADMIN') => request(app).put(`/api/v1/buildings/${id}/wings`).set(auth(who, role)).send({ wings })

beforeAll(async () => {
  zone = await prisma.zone.create({ data: { name: `${S}-z`, city: 'Test' } })
  await prisma.user.create({ data: { id: IDS.admin, name: 'A', email: `${IDS.admin}@t.local`, passwordHash: 'x', role: 'ADMIN' } })
  await prisma.user.create({ data: { id: IDS.surveyor, name: 'S', email: `${IDS.surveyor}@t.local`, passwordHash: 'x', role: 'SURVEYOR', canEditBuildings: true } })
  await prisma.user.create({ data: { id: IDS.other, name: 'O', email: `${IDS.other}@t.local`, passwordHash: 'x', role: 'SURVEYOR', canEditBuildings: true } })
  building = await prisma.building.create({
    data: { buildingName: `${S} Tower`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId: zone.id, createdById: IDS.surveyor, isLive: false,
      details: { create: { wings: 3, homePass: 99 } } },
  })
  society = await prisma.building.create({
    data: { buildingName: `${S} Society`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId: zone.id, createdById: IDS.surveyor, source: 'PERMISSION', permissionApproval: 'APPROVED',
      details: { create: { wings: 2 } } },
  })
})
afterAll(async () => {
  await prisma.building.deleteMany({ where: { id: { in: [building.id, society.id] } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: Object.values(IDS) } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: Object.values(IDS) } } })
  await prisma.zone.delete({ where: { id: zone.id } })
})

describe('PUT /buildings/:id/wings', () => {
  it('the repository has the methods the service calls', () => {
    expect(typeof buildingRepository.replaceWings).toBe('function')
  })

  it('partial placement keeps the building totals as typed', async () => {
    const res = await put(building.id, [wing({ name: 'A', homePass: 10, isLive: true })])
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ complete: false, isLive: false, homePass: 99 })
    expect(res.body.data.wings).toHaveLength(1)
  })

  it('placing the last wing derives live and home pass', async () => {
    const current = (await request(app).get(`/api/v1/buildings/${building.id}`).set(auth(IDS.admin, 'ADMIN'))).body.data.wings
    const res = await put(building.id, [...current, wing({ name: 'B', homePass: 5 }), wing({ name: 'C', homePass: 7 })])
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ complete: true, isLive: true, homePass: 22 })
    const row = await prisma.building.findUnique({ where: { id: building.id }, include: { details: true } })
    expect(row.isLive).toBe(true)
    expect(row.details.homePass).toBe(22)
  })

  it('refuses more wings than the count, and duplicate names — nothing saved', async () => {
    const four = [wing({ name: 'A' }), wing({ name: 'B' }), wing({ name: 'C' }), wing({ name: 'D' })]
    expect((await put(building.id, four)).status).toBe(400)
    const dup = await put(building.id, [wing({ name: 'A' }), wing({ name: 'a' })])
    expect(dup.status).toBe(400)
    expect(dup.body.error.message).toMatch(/used twice/)
    expect(await prisma.buildingWing.count({ where: { buildingId: building.id } })).toBe(3)
  })

  it('a granted surveyor edits wings of their own building only', async () => {
    const current = (await request(app).get(`/api/v1/buildings/${building.id}`).set(auth(IDS.admin, 'ADMIN'))).body.data.wings
    expect((await put(building.id, current, IDS.surveyor, 'SURVEYOR')).status).toBe(200)
    expect((await put(building.id, current, IDS.other, 'SURVEYOR')).status).toBe(403)
  })

  it('only an admin changes a society building\'s wings', async () => {
    expect((await put(society.id, [wing()], IDS.surveyor, 'SURVEYOR')).status).toBe(403)
    expect((await put(society.id, [wing()])).status).toBe(200)
  })

  it('removing a wing from a complete building keeps its last totals', async () => {
    const current = (await request(app).get(`/api/v1/buildings/${building.id}`).set(auth(IDS.admin, 'ADMIN'))).body.data.wings
    const res = await put(building.id, current.slice(0, 2))
    expect(res.body.data).toMatchObject({ complete: false, homePass: 22, isLive: true })
  })

  it('an unknown building is 404', async () => {
    expect((await put(`${S}-nope`, [])).status).toBe(404)
  })

  it('renaming wings A and B to B and A in one save works', async () => {
    const mk = await prisma.building.create({
      data: { buildingName: `${S} Swap`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId: zone.id, createdById: IDS.surveyor, details: { create: { wings: 3 } } },
    })
    try {
      await put(mk.id, [wing({ name: 'A' }), wing({ name: 'B' })])
      const cur = (await request(app).get(`/api/v1/buildings/${mk.id}`).set(auth(IDS.admin, 'ADMIN'))).body.data.wings
      const a = cur.find((w) => w.name === 'A')
      const b = cur.find((w) => w.name === 'B')
      const res = await put(mk.id, [{ ...a, name: 'B' }, { ...b, name: 'A' }])
      expect(res.status).toBe(200)
      const after = await prisma.buildingWing.findMany({ where: { buildingId: mk.id } })
      expect(after.find((w) => w.id === a.id).name).toBe('B')
      expect(after.find((w) => w.id === b.id).name).toBe('A')
    } finally {
      await prisma.building.delete({ where: { id: mk.id } })
    }
  })
})
