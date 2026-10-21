import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { createOpticalLookup } from '../src/lib/olt-optical.js'
import { setOpticalLookupForTests, setOltReachabilityForTests } from '../src/modules/customers/customer.controller.js'

// Customer page: same-PON health on /customers/:id/connection and building
// lat/lng on /customers/:id (spec 2026-10-21-customer-detail §2–3).
const app = createApp()
const S = `spon-${Date.now()}`
const auth = (id, role) => ({
  Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
})
const IDS = { admin: `${S}-admin`, surveyor: `${S}-sv` }
const ADMIN = auth(IDS.admin, 'ADMIN')
const SV = auth(IDS.surveyor, 'SURVEYOR')
const OLT_A = `${S}-OLT-A`
const OLT_D = `${S}-OLT-D`
const U = { live: `${S}-u-live`, fallback: `${S}-u-fb` }

const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const fakeFetch = vi.fn(async (url) => {
  const u = decodeURIComponent(new URL(url).searchParams.get('username'))
  if (u === U.live) {
    return reply(200, { username: u, onus: [{ onu_id: 1, olt_id: 2, olt: OLT_A, pon_no: 3, onu_no: 4, status: 'online', rx_dbm: -15, rx_quality: 'good', stale: false }] })
  }
  return reply(503, {}) // fallback customer: live answer unavailable
})
const fake = (enabled = true) =>
  createOpticalLookup({ fetchImpl: fakeFetch, baseUrl: enabled ? 'https://olt.test' : '', apiKey: enabled ? 'test-key' : '' })

let zone, mine, theirs, c
const one = (id, who = ADMIN) => request(app).get(`/api/v1/customers/${id}/connection`).set(who)

beforeAll(async () => {
  setOltReachabilityForTests({ unreachableOlts: async () => new Set([OLT_D]) })
  zone = await prisma.zone.create({ data: { name: `${S}-z`, city: 'Test' } })
  for (const [id, role] of [[IDS.admin, 'ADMIN'], [IDS.surveyor, 'SURVEYOR']]) {
    await prisma.user.create({ data: { id, name: id, email: `${id}@t.local`, passwordHash: 'x', role } })
  }
  const b = (name, createdById) =>
    prisma.building.create({
      data: { buildingName: `${S} ${name}`, formattedAddress: 'x', latitude: 19.8762, longitude: 75.3433, zoneId: zone.id, createdById },
    })
  mine = await b('Mine', IDS.surveyor)
  theirs = await b('Theirs', IDS.admin)
  let n = 10
  const cust = (buildingId, name, extra = {}) =>
    prisma.customer.create({ data: { buildingId, name, mobile: `90000000${n++}`, createdById: IDS.admin, ...extra } })
  const snap = (connState, olt, pon) => ({ connState, connOlt: olt, connPon: pon, connCheckedAt: new Date() })
  c = {
    live: await cust(mine.id, 'Live', { username: U.live, ...snap('offline', OLT_A, 3) }), // live answer will overwrite to online
    onA: await cust(mine.id, 'OnA', snap('online', OLT_A, 3)),
    offA: await cust(mine.id, 'OffA', snap('offline', OLT_A, 3)),
    nsA: await cust(mine.id, 'NsA', snap('not_seen', OLT_A, 3)),
    otherPon: await cust(mine.id, 'OtherPon', snap('online', OLT_A, 4)),
    farA: await cust(theirs.id, 'FarA', snap('online', OLT_A, 3)),
    fb: await cust(mine.id, 'Fallback', { username: U.fallback, ...snap('not_seen', OLT_D, 5) }),
    dn1: await cust(mine.id, 'Dn1', snap('not_seen', OLT_D, 5)),
    dn2: await cust(theirs.id, 'Dn2', snap('not_seen', OLT_D, 5)),
    dOn: await cust(mine.id, 'DOn', snap('online', OLT_D, 5)),
    none: await cust(mine.id, 'None'),
  }
})

afterEach(() => setOpticalLookupForTests(null))

afterAll(async () => {
  setOltReachabilityForTests(null)
  await prisma.customer.deleteMany({ where: { building: { buildingName: { startsWith: S } } } })
  await prisma.building.deleteMany({ where: { buildingName: { startsWith: S } } })
  await prisma.user.deleteMany({ where: { id: { in: Object.values(IDS) } } })
  await prisma.zone.delete({ where: { id: zone.id } })
})

describe('GET /customers/:id/connection samePon', () => {
  it('counts the live best ONU\'s PON from stored snapshots, the customer included', async () => {
    setOpticalLookupForTests(fake())
    const res = await one(c.live.id)
    expect(res.status).toBe(200)
    // live (now online) + onA + offA + nsA + farA (admin sees all); otherPon excluded
    expect(res.body.data.samePon).toEqual({ olt: OLT_A, pon: 3, total: 5, online: 3, offline: 1, notSeen: 1, oltDown: 0 })
  })

  it('counts only buildings in the reader\'s scope', async () => {
    setOpticalLookupForTests(fake())
    const res = await one(c.live.id, SV)
    expect(res.status).toBe(200)
    expect(res.body.data.samePon).toEqual({ olt: OLT_A, pon: 3, total: 4, online: 2, offline: 1, notSeen: 1, oltDown: 0 })
  })

  it('falls back to the stored olt/pon; not_seen on an unreachable OLT is oltDown, not notSeen', async () => {
    setOpticalLookupForTests(fake())
    const res = await one(c.fb.id)
    expect(res.body.data.connection.state).toBe('unavailable')
    expect(res.body.data.samePon).toEqual({ olt: OLT_D, pon: 5, total: 4, online: 1, offline: 0, notSeen: 0, oltDown: 3 })
    const sv = await one(c.fb.id, SV)
    expect(sv.body.data.samePon).toEqual({ olt: OLT_D, pon: 5, total: 3, online: 1, offline: 0, notSeen: 0, oltDown: 2 })
  })

  it('is null when olt or pon is unknown', async () => {
    setOpticalLookupForTests(fake())
    const res = await one(c.none.id)
    expect(res.status).toBe(200)
    expect(res.body.data.samePon).toBeNull()
  })

  it('stays { enabled: false } when the feature is off', async () => {
    setOpticalLookupForTests(fake(false))
    expect((await one(c.live.id)).body.data).toEqual({ enabled: false })
  })
})

describe('GET /customers/:id building location', () => {
  it('carries the building latitude and longitude', async () => {
    const res = await request(app).get(`/api/v1/customers/${c.live.id}`).set(ADMIN)
    expect(res.status).toBe(200)
    expect(res.body.data.building).toEqual({ id: mine.id, buildingName: `${S} Mine`, latitude: 19.8762, longitude: 75.3433 })
  })
})
