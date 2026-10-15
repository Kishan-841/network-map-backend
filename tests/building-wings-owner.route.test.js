import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

/**
 * The surveyor who added a building locates its wings — with or without the
 * "can edit buildings" tick (owner's request, 15 Oct) — and may set the wing
 * count and each wing's Live while doing it.
 */
const app = createApp()
const S = `bwo-${Date.now()}`
const IDS = { owner: `${S}-owner`, other: `${S}-other` }
const auth = (id) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role: 'SURVEYOR' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })
const wing = (o) => ({ name: 'A', latitude: 18.5, longitude: 73.8, homePass: 10, isLive: false, ...o })
let zone, noCount, counted

beforeAll(async () => {
  zone = await prisma.zone.create({ data: { name: `${S}-z`, city: 'Test' } })
  for (const id of Object.values(IDS)) {
    // Deliberately WITHOUT the edit tick.
    await prisma.user.create({ data: { id, name: id, email: `${id}@t.local`, passwordHash: 'x', role: 'SURVEYOR', canEditBuildings: false } })
  }
  const mk = (name, details) =>
    prisma.building.create({
      data: { buildingName: `${S} ${name}`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId: zone.id, createdById: IDS.owner, isLive: false, details: { create: details } },
    })
  noCount = await mk('NoCount', { homePass: 40 })
  counted = await mk('Counted', { wings: 2, homePass: 40 })
})
afterAll(async () => {
  await prisma.building.deleteMany({ where: { id: { in: [noCount.id, counted.id] } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: Object.values(IDS) } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: Object.values(IDS) } } })
  await prisma.zone.delete({ where: { id: zone.id } })
})

const put = (id, body, who = IDS.owner) => request(app).put(`/api/v1/buildings/${id}/wings`).set(auth(who)).send(body)

describe('the surveyor who added a building locates its wings', () => {
  it('without the edit tick, and can set the wing count in the same save', async () => {
    const res = await put(noCount.id, { wingCount: 3, wings: [wing({ name: 'A' })] })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ complete: false, wingCount: 3 })
    const row = await prisma.buildingDetails.findUnique({ where: { buildingId: noCount.id } })
    expect(row.wings).toBe(3)
    expect(row.homePass).toBe(40) // partial: the typed home pass stays
  })

  it('cannot set the count below the wings placed', async () => {
    const res = await put(noCount.id, { wingCount: 1, wings: [wing({ name: 'A' }), wing({ name: 'B' })] })
    expect(res.status).toBe(400)
    expect((await prisma.buildingDetails.findUnique({ where: { buildingId: noCount.id } })).wings).toBe(3)
  })

  it('marks a wing live without the tick', async () => {
    const res = await put(counted.id, { wings: [wing({ name: 'A', isLive: true }), wing({ name: 'B' })] })
    expect(res.status).toBe(200)
    expect(res.body.data.wings.map((w) => w.isLive)).toEqual([true, false])
    expect(res.body.data).toMatchObject({ complete: true, isLive: true, homePass: 20 })
  })

  it("another surveyor can't touch it — tick or not", async () => {
    expect((await put(counted.id, { wings: [] }, IDS.other)).status).toBe(403)
    expect((await put(noCount.id, { wingCount: 5, wings: [] }, IDS.other)).status).toBe(403)
  })

  it('a wing count of 0 or over 100 is refused', async () => {
    expect((await put(noCount.id, { wingCount: 0, wings: [] })).status).toBe(400)
    expect((await put(noCount.id, { wingCount: 101, wings: [] })).status).toBe(400)
  })
})
