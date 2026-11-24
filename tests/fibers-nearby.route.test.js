import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

/**
 * GET /fibers/nearby (spec 2026-11-24-splitter-in-building): fibres whose line
 * passes within 100 m of a pin, nearest first, or fibres by route name — only
 * ones the reader may see.
 */
const app = createApp()
const S = `fnb-${Date.now()}`
const as = (sub) => ({ Authorization: `Bearer ${jwt.sign({ sub, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })
const [MATE, TL] = [`${S}-mate`, `${S}-tl`]
const [ZONE, OTHER] = [`${S}-z`, `${S}-z2`]
const PIN = { lat: 18.6, lng: 73.8 }
const at = (dLatM) => 18.6 + dLatM / 111_320
// East-west lines at a given distance north of the pin (2 km long, no vertex near the pin).
const line = (dLatM) => [{ sequence: 0, latitude: at(dLatM), longitude: 73.79 }, { sequence: 1, latitude: at(dLatM), longitude: 73.81 }]
const FIBERS = [
  ['near30', ZONE, line(30)],
  ['near80', ZONE, line(80)],
  ['far300', ZONE, line(300)],
  ['hidden20', OTHER, line(20)],
]

beforeAll(async () => {
  await prisma.zone.create({ data: { id: ZONE, name: `${S} Zone`, city: 'Pune' } })
  await prisma.zone.create({ data: { id: OTHER, name: `${S} Zone 2`, city: 'Pune' } })
  await prisma.user.create({ data: { id: MATE, name: MATE, email: `${MATE}@t.local`, passwordHash: 'x', role: 'SURVEYOR',
    assignedZones: { connect: [{ id: ZONE }] } } })
  await prisma.user.create({ data: { id: TL, name: TL, email: `${TL}@t.local`, passwordHash: 'x', role: 'TEAM_LEADER' } })
  for (const [suffix, zoneId, points] of FIBERS) {
    await prisma.fiber.create({ data: { id: `${S}-${suffix}`, name: `${S}-${suffix}`, coreCount: 12, zoneId, points: { create: points } } })
  }
})
afterAll(async () => {
  await prisma.fiber.deleteMany({ where: { id: { in: FIBERS.map(([s]) => `${S}-${s}`) } } })
  await prisma.user.deleteMany({ where: { id: { in: [MATE, TL] } } })
  await prisma.zone.deleteMany({ where: { id: { in: [ZONE, OTHER] } } })
})

const get = (who, query) => request(app).get(`/api/v1/fibers/nearby?${query}`).set(as(who))
const mine = (rows) => rows.filter((r) => r.name.startsWith(S))

describe('GET /fibers/nearby', () => {
  it('lists fibres passing within 100 m of the pin, nearest first, with the distance', async () => {
    const res = await get(MATE, `lat=${PIN.lat}&lng=${PIN.lng}`)
    expect(res.status).toBe(200)
    const rows = mine(res.body.data)
    expect(rows.map((r) => r.name)).toEqual([`${S}-near30`, `${S}-near80`])
    expect(rows[0].distanceM).toBeGreaterThanOrEqual(28)
    expect(rows[0].distanceM).toBeLessThanOrEqual(32)
    expect(rows[0]).toMatchObject({ id: `${S}-near30`, status: 'PLANNED' })
  })

  it('finds a fibre by route name wherever it is, with its distance from the pin', async () => {
    const res = await get(MATE, `q=${encodeURIComponent(`${S}-far`)}&lat=${PIN.lat}&lng=${PIN.lng}`)
    const rows = mine(res.body.data)
    expect(rows.map((r) => r.name)).toEqual([`${S}-far300`])
    expect(rows[0].distanceM).toBeGreaterThan(290)
  })

  it("never shows a fibre the reader can't see", async () => {
    const near = mine((await get(MATE, `lat=${PIN.lat}&lng=${PIN.lng}`)).body.data)
    expect(near.some((r) => r.name.endsWith('hidden20'))).toBe(false)
    const byName = mine((await get(MATE, `q=${encodeURIComponent(`${S}-hidden`)}`)).body.data)
    expect(byName).toEqual([])
  })

  it('needs a pin or at least two letters, and a fibre reader', async () => {
    expect((await get(MATE, '')).status).toBe(400)
    expect((await get(MATE, 'q=a')).status).toBe(400)
    expect((await get(MATE, 'lat=18.6')).status).toBe(400)
    expect((await get(TL, `lat=${PIN.lat}&lng=${PIN.lng}`)).status).toBe(403)
  })
})
