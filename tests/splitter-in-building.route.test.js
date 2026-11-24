import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

/**
 * A splitter fitted inside a building (spec 2026-11-24-splitter-in-building):
 * POST /splitters with a building, the exact pin, an optional wing, where in the
 * building and a note; the building's zone team can read it; edits keep the rules.
 */
const app = createApp()
const S = `sib-${Date.now()}`
const as = (sub) => ({ Authorization: `Bearer ${jwt.sign({ sub, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })
const [ADMIN, FIBER, MATE, STRANGER, FAR_FIBER] = ['admin', 'fiber', 'mate', 'stranger', 'farfiber'].map((s) => `${S}-${s}`)
const USERS = [ADMIN, FIBER, MATE, STRANGER, FAR_FIBER]
const [ZONE, OTHER_ZONE] = [`${S}-z`, `${S}-z2`]
const [B, B2, SOC] = [`${S}-b`, `${S}-b2`, `${S}-soc`]
const [W1, W2] = [`${S}-w1`, `${S}-w2`]
const [F_MINE, F_HIDDEN] = [`${S}-f1`, `${S}-f2`]
const made = []

const post = (who, body) => request(app).post('/api/v1/splitters').set(as(who)).send(body)
const patch = (who, id, body) => request(app).patch(`/api/v1/splitters/${id}`).set(as(who)).send(body)
const base = { buildingId: B, latitude: 18.6001, longitude: 73.8001, ratio: 'R1_8', location: 'S2', fiberType: 'SUB' }

async function create(body = {}) {
  const res = await post(FIBER, { ...base, ...body })
  expect(res.status).toBe(201)
  made.push(res.body.data.id)
  return res.body.data
}

beforeAll(async () => {
  await prisma.zone.create({ data: { id: ZONE, name: `${S} Zone`, city: 'Pune' } })
  await prisma.zone.create({ data: { id: OTHER_ZONE, name: `${S} Zone 2`, city: 'Pune' } })
  const mk = (id, role, extra = {}) =>
    prisma.user.create({ data: { id, name: id, email: `${id}@t.local`, passwordHash: 'x', role, ...extra } })
  await mk(ADMIN, 'ADMIN')
  await mk(FIBER, 'SURVEYOR', { canManageFiber: true, assignedZones: { connect: [{ id: ZONE }] } })
  await mk(MATE, 'SURVEYOR', { assignedZones: { connect: [{ id: ZONE }] } })
  await mk(STRANGER, 'SURVEYOR', { assignedZones: { connect: [{ id: OTHER_ZONE }] } })
  await mk(FAR_FIBER, 'SURVEYOR', { canManageFiber: true, assignedZones: { connect: [{ id: OTHER_ZONE }] } })
  const building = (id, extra = {}) =>
    prisma.building.create({ data: { id, buildingName: `${S} ${id}`, formattedAddress: `${S} ${id}`, latitude: 18.6,
      longitude: 73.8, source: 'COVERAGE', createdById: ADMIN, zoneId: ZONE, ...extra } })
  await building(B)
  await building(B2)
  await building(SOC, { source: 'PERMISSION', permissionApproval: 'PENDING' })
  await prisma.buildingWing.create({ data: { id: W1, buildingId: B, name: 'A', latitude: 18.6, longitude: 73.8 } })
  await prisma.buildingWing.create({ data: { id: W2, buildingId: B2, name: 'B', latitude: 18.6, longitude: 73.8 } })
  const fiber = (id, zoneId, createdById) =>
    prisma.fiber.create({ data: { id, name: `${S}-${id.slice(-2)}`, coreCount: 12, zoneId, createdById,
      points: { create: [{ sequence: 0, latitude: 18.6, longitude: 73.79 }, { sequence: 1, latitude: 18.6, longitude: 73.81 }] } } })
  await fiber(F_MINE, ZONE, ADMIN)
  await fiber(F_HIDDEN, OTHER_ZONE, ADMIN)
})

afterAll(async () => {
  await prisma.splitter.deleteMany({ where: { OR: [{ id: { in: made } }, { buildingId: { in: [B, B2, SOC] } }] } })
  await prisma.fiber.deleteMany({ where: { id: { in: [F_MINE, F_HIDDEN] } } })
  await prisma.buildingWing.deleteMany({ where: { id: { in: [W1, W2] } } })
  await prisma.building.deleteMany({ where: { id: { in: [B, B2, SOC] } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: USERS } } })
  await prisma.zone.deleteMany({ where: { id: { in: [ZONE, OTHER_ZONE] } } })
})

describe('POST /splitters — in a building', () => {
  it('saves the splitter at the pin with its building, wing, where and note', async () => {
    const s = await create({ wingId: W1, placement: 'FLOOR', floorNumber: 3, note: '  by the lift  ', inputFiberId: F_MINE })
    expect(s).toMatchObject({
      latitude: 18.6001, longitude: 73.8001, ratio: 'R1_8', location: 'S2', fiberType: 'SUB', closure: null,
      building: { id: B, buildingName: `${S} ${B}` }, wing: { id: W1, name: 'A' },
      placement: 'FLOOR', floorNumber: 3, note: 'by the lift', inputFiber: { id: F_MINE }, portsTotal: 8,
    })
    expect(s.code).toMatch(/^S\d+/)
    const row = await prisma.splitter.findUnique({ where: { id: s.id } })
    expect(row.createdById).toBe(FIBER)
  })

  it('keeps only the building when nothing else is given', async () => {
    const s = await create()
    expect(s).toMatchObject({ wing: null, placement: null, floorNumber: null, note: null, inputFiber: null })
  })

  it('refuses a wing of another building, an unknown or unapproved building', async () => {
    expect((await post(FIBER, { ...base, wingId: W2 })).status).toBe(400)
    expect((await post(FIBER, { ...base, buildingId: `${S}-nope` })).status).toBe(400)
    expect((await post(FIBER, { ...base, buildingId: SOC })).status).toBe(400)
  })

  it('needs a floor number for Floor and only for Floor', async () => {
    expect((await post(FIBER, { ...base, placement: 'FLOOR' })).status).toBe(400)
    expect((await post(FIBER, { ...base, placement: 'TERRACE', floorNumber: 2 })).status).toBe(400)
    expect((await post(FIBER, { ...base, placement: 'FLOOR', floorNumber: 0 })).status).toBe(400)
    expect((await post(FIBER, { ...base, placement: 'FLOOR', floorNumber: 201 })).status).toBe(400)
    expect((await post(FIBER, { ...base, placement: 'ROOF' })).status).toBe(400)
  })

  it("refuses an input fiber the user can't see, and a missing pin", async () => {
    expect((await post(FIBER, { ...base, inputFiberId: F_HIDDEN })).status).toBe(400)
    expect((await post(FIBER, { ...base, latitude: undefined })).status).toBe(400)
  })

  it("refuses a building outside the user's zones, even with the fibre tick", async () => {
    const res = await post(FAR_FIBER, base)
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('Building does not exist')
  })

  it('needs the fibre tick', async () => {
    expect((await post(MATE, base)).status).toBe(403)
  })
})

describe('reading a building splitter', () => {
  it("is seen by the building zone's team and not by others", async () => {
    const s = await create({ placement: 'BASEMENT' })
    const mate = await request(app).get(`/api/v1/splitters/${s.id}`).set(as(MATE))
    expect(mate.status).toBe(200)
    expect(mate.body.data).toMatchObject({ building: { id: B }, placement: 'BASEMENT' })
    const list = await request(app).get('/api/v1/splitters').set(as(MATE))
    expect(list.body.data.some((x) => x.id === s.id)).toBe(true)
    expect((await request(app).get(`/api/v1/splitters/${s.id}`).set(as(STRANGER))).status).toBe(404)
  })
})

describe('giving an existing splitter a building', () => {
  async function closureSplitter() {
    const closure = await prisma.closure.create({ data: { code: `JC-${S}-${made.length}`, latitude: 18.61, longitude: 73.81, createdById: FIBER } })
    const res = await request(app).post(`/api/v1/closures/${closure.id}/splitters`).set(as(FIBER)).send({ ratio: 'R1_4' })
    expect(res.status).toBe(201)
    return { closure, splitter: res.body.data }
  }

  it('adds a building, wing, where and note to a closure splitter, keeping its closure and position', async () => {
    const { closure, splitter } = await closureSplitter()
    const res = await patch(FIBER, splitter.id, { buildingId: B, wingId: W1, placement: 'BASEMENT', note: 'old box' })
    expect(res.status).toBe(200)
    const read = (await request(app).get(`/api/v1/splitters/${splitter.id}`).set(as(FIBER))).body.data
    expect(read).toMatchObject({ closure: { id: closure.id }, building: { id: B }, wing: { id: W1 }, placement: 'BASEMENT',
      note: 'old box', latitude: 18.61, longitude: 73.81 })
    await prisma.closure.delete({ where: { id: closure.id } })
  })

  it('moving to another building drops a wing that is not in it', async () => {
    const s = await create({ wingId: W1 })
    const res = await patch(FIBER, s.id, { buildingId: B2 })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ buildingId: B2, wingId: null })
    expect((await patch(FIBER, s.id, { wingId: W1 })).status).toBe(400)
    expect((await patch(FIBER, s.id, { wingId: W2 })).status).toBe(200)
  })

  it('removing the building from a closure splitter clears wing and where, keeps the note', async () => {
    const { closure, splitter } = await closureSplitter()
    await patch(FIBER, splitter.id, { buildingId: B, wingId: W1, placement: 'FLOOR', floorNumber: 2, note: 'keep me' })
    const res = await patch(FIBER, splitter.id, { buildingId: null })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ buildingId: null, wingId: null, placement: null, floorNumber: null, note: 'keep me' })
    await prisma.closure.delete({ where: { id: closure.id } })
  })

  it("won't remove the building from a splitter that is only in a building", async () => {
    const s = await create()
    expect((await patch(FIBER, s.id, { buildingId: null })).status).toBe(400)
  })

  it('moving a building-only splitter to another building moves its pin there', async () => {
    await prisma.building.update({ where: { id: B2 }, data: { latitude: 18.65, longitude: 73.85 } })
    const s = await create()
    const res = await patch(FIBER, s.id, { buildingId: B2 })
    expect(res.body.data).toMatchObject({ buildingId: B2, latitude: 18.65, longitude: 73.85 })
    await prisma.building.update({ where: { id: B2 }, data: { latitude: 18.6, longitude: 73.8 } })
  })

  it("refuses a building the editor can't read or an unapproved one", async () => {
    const s = await create()
    expect((await patch(FIBER, s.id, { buildingId: SOC })).status).toBe(400)
    expect((await patch(FIBER, s.id, { buildingId: `${S}-nope` })).status).toBe(400)
    const far = await prisma.building.create({ data: { id: `${S}-far`, buildingName: `${S} far`, formattedAddress: 'x',
      latitude: 18.6, longitude: 73.8, source: 'COVERAGE', createdById: ADMIN, zoneId: OTHER_ZONE } })
    expect((await patch(FIBER, s.id, { buildingId: far.id })).status).toBe(400)
    await prisma.building.delete({ where: { id: far.id } })
  })

  it('a note alone is fine on any splitter', async () => {
    const { closure, splitter } = await closureSplitter()
    const res = await patch(FIBER, splitter.id, { note: 'just a note' })
    expect(res.status).toBe(200)
    expect(res.body.data.note).toBe('just a note')
    await prisma.closure.delete({ where: { id: closure.id } })
  })
})

describe('editing a building splitter', () => {
  it('changes where it is; leaving Floor clears the floor number', async () => {
    const s = await create({ placement: 'GROUND' })
    const toFloor = await patch(FIBER, s.id, { placement: 'FLOOR', floorNumber: 7, note: 'moved up', wingId: W1 })
    expect(toFloor.status).toBe(200)
    expect(toFloor.body.data).toMatchObject({ placement: 'FLOOR', floorNumber: 7, note: 'moved up', wingId: W1 })
    const toTerrace = await patch(FIBER, s.id, { placement: 'TERRACE' })
    expect(toTerrace.body.data).toMatchObject({ placement: 'TERRACE', floorNumber: null })
    expect((await patch(FIBER, s.id, { placement: 'FLOOR' })).status).toBe(400)
  })

  it("refuses an input fiber the editor can't see", async () => {
    const s = await create()
    expect((await patch(FIBER, s.id, { inputFiberId: F_HIDDEN })).status).toBe(400)
    expect((await patch(FIBER, s.id, { inputFiberId: F_MINE })).status).toBe(200)
  })

  it("keeps an input fiber the editor can't see when their save sends none", async () => {
    const hiddenFed = await prisma.splitter.create({
      data: { code: `ST-${S}`, latitude: 18.6, longitude: 73.8, ratio: 'R1_2', buildingId: B, inputFiberId: F_HIDDEN,
        createdById: ADMIN, outputs: { create: [{ portNo: 1 }, { portNo: 2 }] } },
    })
    made.push(hiddenFed.id)
    const res = await patch(FIBER, hiddenFed.id, { note: 'checked', inputFiberId: null })
    expect(res.status).toBe(200)
    const row = await prisma.splitter.findUnique({ where: { id: hiddenFed.id } })
    expect(row).toMatchObject({ note: 'checked', inputFiberId: F_HIDDEN })
  })

  it('refuses a wing of another building, and a wing on a splitter with no building', async () => {
    const s = await create()
    expect((await patch(FIBER, s.id, { wingId: W2 })).status).toBe(400)
    const closure = await prisma.closure.create({ data: { code: `JC-${S}`, latitude: 18.6, longitude: 73.8, createdById: FIBER } })
    const inClosure = await request(app).post(`/api/v1/closures/${closure.id}/splitters`).set(as(FIBER)).send({ ratio: 'R1_2' })
    expect(inClosure.status).toBe(201)
    expect((await patch(FIBER, inClosure.body.data.id, { wingId: W1 })).status).toBe(400)
    expect((await patch(FIBER, inClosure.body.data.id, { placement: 'TERRACE' })).status).toBe(400)
    expect((await patch(FIBER, inClosure.body.data.id, { location: 'S2' })).status).toBe(200)
    await prisma.closure.delete({ where: { id: closure.id } })
  })
})
