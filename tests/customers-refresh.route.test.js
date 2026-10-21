import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { createOpticalLookup } from '../src/lib/olt-optical.js'
import { REFRESH_STALE_MS } from '../src/lib/customer-list.js'
import { createCustomerService } from '../src/modules/customers/customer.service.js'
import {
  setOpticalLookupForTests,
  setOltReachabilityForTests,
} from '../src/modules/customers/customer.controller.js'

// POST /customers/refresh (spec 2026-10-21-customers-refresh §2). Fakes only — never the real OLT API.
const app = createApp()
const S = `crefresh-${Date.now()}`
const auth = (id, role) => ({
  Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
})
const IDS = { admin: `${S}-admin`, sv: `${S}-sv`, other: `${S}-other`, exec: `${S}-exec` }
const ADMIN = auth(IDS.admin, 'ADMIN')
const SV = auth(IDS.sv, 'SURVEYOR')
const OTHER = auth(IDS.other, 'SURVEYOR')
const DOWN_OLT = `${S}-OLT-DOWN`
const U = { fresh: `${S}-fresh`, stale: `${S}-stale`, never: `${S}-never`, bad: `${S}-bad`, gone: `${S}-gone`, far: `${S}-far` }

const onu = (status, extra = {}) => ({
  olt: 'OLT-1', pon_no: 3, onu_no: 4, status, stale: false, rx_dbm: -16, rx_quality: 'good',
  baseline_rx_dbm: -16, last_seen: '2026-10-21T06:00:00+00:00', serial: 'SERIAL9', location: 'SECRET-PLACE', ...extra,
})
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body })
const calls = []
const fakeFetch = vi.fn(async (url) => {
  const u = decodeURIComponent(new URL(url).searchParams.get('username'))
  calls.push(u)
  if (u === U.bad) return reply(503, {})
  if (u === U.gone) return reply(200, { onus: [onu('unknown', { stale: true, olt: DOWN_OLT })] })
  return reply(200, { onus: [onu('online')] })
})
const fakeLookup = (enabled = true) =>
  createOpticalLookup({ fetchImpl: fakeFetch, baseUrl: enabled ? 'https://olt.test' : '', apiKey: enabled ? 'test-key' : '' })

let zone, otherZone, home, away, c
const refresh = (body, who = SV) => request(app).post('/api/v1/customers/refresh').send(body).set(who)
const snap = (id) => prisma.customer.findUnique({ where: { id }, select: { connState: true, connOlt: true, connCheckedAt: true } })
const MIN = 60 * 1000

beforeAll(async () => {
  setOltReachabilityForTests({ unreachableOlts: async () => new Set([DOWN_OLT]) })
  zone = await prisma.zone.create({ data: { name: `${S}-z`, city: 'Test' } })
  otherZone = await prisma.zone.create({ data: { name: `${S}-z2`, city: 'Test' } })
  const user = (id, role, zoneId) =>
    prisma.user.create({
      data: { id, name: id, email: `${id}@t.local`, passwordHash: 'x', role, ...(zoneId && { assignedZones: { connect: { id: zoneId } } }) },
    })
  await user(IDS.admin, 'ADMIN')
  await user(IDS.sv, 'SURVEYOR', zone.id)
  await user(IDS.other, 'SURVEYOR', otherZone.id)
  const b = (name, zoneId) =>
    prisma.building.create({
      data: { buildingName: `${S} ${name}`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId, createdById: IDS.admin },
    })
  home = await b('Home', zone.id)
  away = await b('Away', otherZone.id)
  const cust = (buildingId, name, mobile, username) =>
    prisma.customer.create({ data: { buildingId, name, mobile, username, createdById: IDS.admin } })
  c = {
    fresh: await cust(home.id, 'Fresh', '9400000001', U.fresh),
    stale: await cust(home.id, 'Stale', '9400000002', U.stale),
    never: await cust(home.id, 'Never', '9400000003', U.never),
    bad: await cust(home.id, 'Bad', '9400000004', U.bad),
    gone: await cust(home.id, 'Gone', '9400000005', U.gone),
    blank: await cust(home.id, 'Blank', '9400000006', null),
    far: await cust(away.id, 'Far', '9400000007', U.far),
  }
})

beforeEach(async () => {
  const ago = (ms) => new Date(Date.now() - ms)
  const set = (id, data) => prisma.customer.update({ where: { id }, data })
  await set(c.fresh.id, { connState: 'offline', connCheckedAt: ago(1 * MIN) })
  await set(c.stale.id, { connState: 'offline', connCheckedAt: ago(REFRESH_STALE_MS + MIN) })
  await set(c.never.id, { connState: null, connCheckedAt: null })
  await set(c.bad.id, { connState: 'offline', connCheckedAt: ago(30 * MIN) })
  await set(c.gone.id, { connState: null, connCheckedAt: null })
  await set(c.blank.id, { connState: null, connCheckedAt: null })
  await set(c.far.id, { connState: null, connCheckedAt: null })
})

afterEach(() => {
  calls.length = 0
  setOpticalLookupForTests(null)
})

afterAll(async () => {
  setOltReachabilityForTests(null)
  await prisma.customer.deleteMany({ where: { building: { buildingName: { startsWith: S } } } })
  await prisma.building.deleteMany({ where: { buildingName: { startsWith: S } } })
  await prisma.user.deleteMany({ where: { id: { in: Object.values(IDS) } } })
  await prisma.zone.deleteMany({ where: { id: { in: [zone.id, otherZone.id] } } })
})

const allIds = () => [c.fresh.id, c.stale.id, c.never.id, c.bad.id, c.gone.id, c.blank.id, c.far.id]

describe('POST /customers/refresh', () => {
  it('checks only stale / never-checked rows with a Username; drops out-of-scope ids', async () => {
    setOpticalLookupForTests(fakeLookup())
    const res = await refresh({ ids: allIds() })
    expect(res.status).toBe(200)
    expect(calls.sort()).toEqual([U.stale, U.never, U.bad, U.gone].sort())
    const { rows, pending } = res.body.data
    // Order as asked, out-of-scope `far` silently dropped.
    expect(rows.map((r) => r.id)).toEqual([c.fresh.id, c.stale.id, c.never.id, c.bad.id, c.gone.id, c.blank.id])
    expect(pending).toEqual([c.bad.id]) // 503 → unavailable: kept, listed as pending
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(byId[c.fresh.id].connState).toBe('offline') // not stale: untouched
    expect(byId[c.stale.id].connState).toBe('online')
    expect(byId[c.never.id].connState).toBe('online')
    expect(byId[c.bad.id].connState).toBe('offline')
    expect(byId[c.gone.id]).toMatchObject({ connState: 'not_seen', connOlt: DOWN_OLT, oltReachable: false })
    expect(byId[c.stale.id].oltReachable).toBe(true)
    expect(byId[c.blank.id].oltReachable).toBeNull()
  })

  it('rows are the list row shape plus oltReachable — no serial, no location', async () => {
    setOpticalLookupForTests(fakeLookup())
    const res = await refresh({ ids: [c.stale.id] })
    const [row] = res.body.data.rows
    expect(Object.keys(row).sort()).toEqual(
      [
        'id', 'name', 'username', 'mobile', 'email', 'operator', 'networkZone', 'planName', 'planAmount',
        'planExpiresAt', 'status', 'autoRenewal', 'ponNumber', 'olt', 'building', 'wing', 'zone', 'connState',
        'connRxDbm', 'connRxQuality', 'connOlt', 'connPon', 'connOnu', 'connLastSeen', 'connWeak', 'connCheckedAt',
        'oltReachable',
      ].sort(),
    )
    expect(row.building).toEqual({ id: home.id, buildingName: home.buildingName })
    const text = JSON.stringify(res.body)
    expect(text).not.toContain('SERIAL9')
    expect(text).not.toContain('SECRET-PLACE')
  })

  it('saves the snapshots (write-through); a failed row keeps its stored one', async () => {
    setOpticalLookupForTests(fakeLookup())
    const before = await snap(c.bad.id)
    await refresh({ ids: allIds() })
    const stale = await snap(c.stale.id)
    expect(stale.connState).toBe('online')
    expect(stale.connCheckedAt.getTime()).toBeGreaterThan(Date.now() - MIN)
    expect((await snap(c.gone.id)).connState).toBe('not_seen')
    expect(await snap(c.bad.id)).toEqual(before)
    expect((await snap(c.far.id)).connState).toBeNull()
    expect((await snap(c.blank.id)).connState).toBeNull() // no Username: not touched
  })

  it('force checks every row with a Username, bypassing the in-memory cache', async () => {
    const lookup = fakeLookup()
    setOpticalLookupForTests(lookup)
    await refresh({ ids: allIds() }) // fills the cache for stale/never/gone
    calls.length = 0
    const res = await refresh({ ids: allIds(), force: true })
    expect(res.status).toBe(200)
    expect(calls.sort()).toEqual([U.fresh, U.stale, U.never, U.bad, U.gone].sort())
    expect(res.body.data.rows.find((r) => r.id === c.fresh.id).connState).toBe('online')
    // Without force a cached answer is reused (rows made stale again by hand).
    calls.length = 0
    await prisma.customer.update({ where: { id: c.stale.id }, data: { connCheckedAt: null } })
    await refresh({ ids: [c.stale.id] })
    expect(calls).toEqual([])
  })

  it('a surveyor with none of the ids in scope gets nothing and causes no OLT call', async () => {
    setOpticalLookupForTests(fakeLookup())
    const res = await refresh({ ids: allIds() }, OTHER)
    expect(res.status).toBe(200)
    expect(res.body.data.rows.map((r) => r.id)).toEqual([c.far.id])
    expect(calls).toEqual([U.far])
    expect((await refresh({ ids: ['nope'] }, OTHER)).body.data).toEqual({ rows: [], pending: [] })
  })

  it('ADMIN reads every building', async () => {
    setOpticalLookupForTests(fakeLookup())
    const res = await refresh({ ids: [c.far.id] }, ADMIN)
    expect(res.body.data.rows.map((r) => r.id)).toEqual([c.far.id])
  })

  it('feature off: stored rows come back, nothing checked, nothing pending', async () => {
    setOpticalLookupForTests(fakeLookup(false))
    const res = await refresh({ ids: [c.stale.id, c.never.id] })
    expect(res.status).toBe(200)
    expect(res.body.data.rows.map((r) => r.connState)).toEqual(['offline', null])
    expect(res.body.data.pending).toEqual([])
    expect(calls).toEqual([])
  })

  it('validates the body', async () => {
    const ids51 = Array.from({ length: 51 }, (_, i) => `id-${i}`)
    expect((await refresh({ ids: ids51 })).status).toBe(400)
    expect((await refresh({ ids: [] })).status).toBe(400)
    expect((await refresh({ ids: [''] })).status).toBe(400)
    expect((await refresh({})).status).toBe(400)
    expect((await refresh({ ids: [c.stale.id], force: 'yes' })).status).toBe(400)
    setOpticalLookupForTests(fakeLookup(false))
    expect((await refresh({ ids: Array.from({ length: 50 }, (_, i) => `id-${i}`) })).status).toBe(200)
  })

  it('needs a session', async () => {
    expect((await request(app).post('/api/v1/customers/refresh').send({ ids: ['x'] })).status).toBe(401)
  })
})

describe('refreshCustomers (service) — deadline', () => {
  const row = (id, username, connCheckedAt = null) => ({
    id, username, connCheckedAt, connOlt: null, connState: null, name: id,
    building: { id: 'b', buildingName: 'B', zone: null }, wing: null,
  })

  function make({ lookup, rows, deadline = 50, availableTokens }) {
    const saved = []
    const service = createCustomerService({
      customerRepository: {
        listBuildingsWithCustomers: async () => [{ id: 'b' }],
        listPage: async () => rows,
        saveConnectionSnapshots: async (entries) => { saved.push(...entries) },
      },
      buildingService: { readScope: async () => () => true },
      getOpticalLookup: () => ({ enabled: true, lookup, ...(availableTokens && { availableTokens }) }),
      getOltReachability: () => ({ unreachableOlts: async () => new Set() }),
      refreshDeadlineMs: deadline,
    })
    return { service, saved }
  }

  it('rows not answered by the deadline are pending; answered ones are saved', async () => {
    const lookup = vi.fn(async (u) => (u === 'hang' ? new Promise(() => {}) : { found: false }))
    const rows = [row('a', 'fast'), row('b', 'hang'), row('c', 'fast2')]
    const { service, saved } = make({ lookup, rows })
    const t0 = Date.now()
    const out = await service.refreshCustomers({ ids: ['a', 'b', 'c'] }, { role: 'ADMIN' })
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(out.pending).toEqual(['b'])
    expect(saved.map((e) => e.id).sort()).toEqual(['a', 'c'])
    expect(saved[0].snapshot.connState).toBe('not_linked')
  })

  it('rows not started by the deadline make no OLT call', async () => {
    const lookup = vi.fn(() => new Promise(() => {}))
    const rows = Array.from({ length: 12 }, (_, i) => row(`r${i}`, `u${i}`))
    const { service } = make({ lookup, rows })
    const out = await service.refreshCustomers({ ids: rows.map((r) => r.id) }, { role: 'ADMIN' })
    expect(lookup).toHaveBeenCalledTimes(5) // fan-out 5; the rest never started
    expect(out.pending).toHaveLength(12)
  })

  it('a rate-limited answer is pending and saves nothing', async () => {
    const lookup = vi.fn(async () => ({ unavailable: true, reason: 'rate_limited' }))
    const { service, saved } = make({ lookup, rows: [row('a', 'x')] })
    const out = await service.refreshCustomers({ ids: ['a'] }, { role: 'ADMIN' })
    expect(out.pending).toEqual(['a'])
    expect(saved).toEqual([])
  })

  it('force passes { fresh: true } to the lookup; non-force does not', async () => {
    const lookup = vi.fn(async () => ({ found: false }))
    const { service } = make({ lookup, rows: [row('a', 'x', new Date())] })
    await service.refreshCustomers({ ids: ['a'] }, { role: 'ADMIN' })
    expect(lookup).not.toHaveBeenCalled() // checked just now: not stale
    await service.refreshCustomers({ ids: ['a'], force: true }, { role: 'ADMIN' })
    expect(lookup).toHaveBeenCalledWith('x', { fresh: true })
  })

  it('starts no new lookup once the shared bucket is under the floor (15); those rows are pending', async () => {
    let tokens = 17
    const lookup = vi.fn(async () => {
      tokens -= 1
      return { found: false }
    })
    const rows = Array.from({ length: 6 }, (_, i) => row(`r${i}`, `u${i}`))
    const { service, saved } = make({ lookup, rows, availableTokens: () => tokens })
    const out = await service.refreshCustomers({ ids: rows.map((r) => r.id) }, { role: 'ADMIN' })
    // 17 and 16 are at or above 15; at 15 one more starts, at 14 none.
    expect(lookup).toHaveBeenCalledTimes(3)
    expect(saved).toHaveLength(3)
    expect(out.pending).toEqual(['r3', 'r4', 'r5'])
  })

  it('an empty-ish bucket checks nothing at all', async () => {
    const lookup = vi.fn(async () => ({ found: false }))
    const rows = [row('a', 'x'), row('b', 'y')]
    const { service } = make({ lookup, rows, availableTokens: () => 3 })
    const out = await service.refreshCustomers({ ids: ['a', 'b'] }, { role: 'ADMIN' })
    expect(lookup).not.toHaveBeenCalled()
    expect(out.pending).toEqual(['a', 'b'])
  })
})
