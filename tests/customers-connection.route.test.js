import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { createOpticalLookup, ADMIN_ONLY_ONU_FIELDS } from '../src/lib/olt-optical.js'
import { createCustomerService } from '../src/modules/customers/customer.service.js'
import { setOpticalLookupForTests, setOltReachabilityForTests } from '../src/modules/customers/customer.controller.js'

const app = createApp()
const S = `conn-${Date.now()}`
const auth = (id, role) => ({
  Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
})
const IDS = { admin: `${S}-admin`, surveyor: `${S}-sv`, other: `${S}-sv2` }
const ADMIN = auth(IDS.admin, 'ADMIN')
const SV = auth(IDS.surveyor, 'SURVEYOR')
const OTHER = auth(IDS.other, 'SURVEYOR')

const U = { online: `${S}-u-on`, off: `${S}-u-off`, down: `${S}-u-down`, unlinked: `${S}-u-nl`, gone: `${S}-u-gone`, quiet: `${S}-u-quiet`, up: `${S}-u-up` }
const DOWN_OLT = `${S}-OLT-DOWN`
const onu = (status, extra = {}) => ({
  onu_id: 1, olt_id: 2, olt: 'OLT-1', pon_no: 3, onu_no: 4, onu_index: 'GPON0/3:4', serial: 'SERIAL123',
  status, distance_m: 100, last_seen: '2026-10-19T06:00:00+00:00', session_ip: '100.64.0.9',
  rx_dbm: -15, rx_quality: 'good', tx_dbm: 2, baseline_rx_dbm: -15, customer_ips: ['100.64.0.9'],
  stale: false, location: 'SECRET-PLACE', ...extra,
})
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const calls = []
const fakeFetch = vi.fn(async (url) => {
  const u = decodeURIComponent(new URL(url).searchParams.get('username'))
  calls.push(u)
  if (u === U.online) return reply(200, { username: u, onus: [onu('online')] })
  if (u === U.off) return reply(200, { username: u, onus: [onu('down')] })
  if (u === U.down) return reply(503, {})
  if (u === U.gone) return reply(200, { username: u, onus: [onu('unknown', { stale: true, olt: DOWN_OLT })] })
  if (u === U.quiet) return reply(200, { username: u, onus: [onu('unknown', { stale: true })] })
  if (u === U.up) return reply(200, { username: u, onus: [onu('online', { olt: DOWN_OLT })] })
  return reply(404, { detail: 'No ONU mapped' })
})
const fake = (enabled = true) =>
  createOpticalLookup({
    fetchImpl: fakeFetch,
    baseUrl: enabled ? 'https://olt.test' : '',
    apiKey: enabled ? 'test-key' : '',
  })

let zone, mine, theirs, third, c
const conns = (buildingId, who = ADMIN) =>
  request(app).get('/api/v1/customers/connections').query({ buildingId }).set(who)

beforeAll(async () => {
  setOltReachabilityForTests({ unreachableOlts: async () => new Set([DOWN_OLT]) })
  zone = await prisma.zone.create({ data: { name: `${S}-z`, city: 'Test' } })
  for (const [id, role] of [[IDS.admin, 'ADMIN'], [IDS.surveyor, 'SURVEYOR'], [IDS.other, 'SURVEYOR']]) {
    await prisma.user.create({ data: { id, name: id, email: `${id}@t.local`, passwordHash: 'x', role } })
  }
  const b = (name, createdById) =>
    prisma.building.create({
      data: { buildingName: `${S} ${name}`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId: zone.id, createdById },
    })
  mine = await b('Mine', IDS.surveyor)
  theirs = await b('Theirs', IDS.admin)
  third = await b('Third', IDS.surveyor)
  const cust = (buildingId, name, mobile, username) =>
    prisma.customer.create({ data: { buildingId, name, mobile, username, createdById: IDS.admin } })
  c = {
    on: await cust(mine.id, 'On', '9000000011', U.online),
    off: await cust(mine.id, 'Off', '9000000012', U.off),
    down: await cust(mine.id, 'Down', '9000000013', U.down),
    nl: await cust(mine.id, 'Nl', '9000000014', U.unlinked),
    none: await cust(mine.id, 'None', '9000000015', null),
    blank: await cust(mine.id, 'Blank', '9000000016', '  '),
    far: await cust(theirs.id, 'Far', '9000000017', U.online),
    gone: await cust(third.id, 'Gone', '9000000018', U.gone),
    quiet: await cust(third.id, 'Quiet', '9000000019', U.quiet),
    up: await cust(third.id, 'Up', '9000000020', U.up),
  }
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
  await prisma.zone.delete({ where: { id: zone.id } })
})

describe('building connections deadline', () => {
  it('a lookup that never resolves is pending once the deadline passes; others intact', async () => {
    const rows = [{ id: 'a', username: 'fast' }, { id: 'b', username: 'hang' }, { id: 'c', username: null }]
    const lookup = async (u) => (u === 'hang' ? new Promise(() => {}) : u ? { found: false } : null)
    const svc = createCustomerService({
      customerRepository: { listByBuilding: async () => rows, saveConnectionSnapshots: async () => {} },
      buildingService: { getBuilding: async () => ({}) },
      getOpticalLookup: () => ({ enabled: true, lookup }),
      connectionDeadlineMs: 50,
    })
    const t0 = Date.now()
    const out = await svc.getBuildingConnections({ buildingId: 'x' }, { role: 'ADMIN' })
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(out.connections.a.state).toBe('not_linked')
    expect(out.connections.b).toEqual({ state: 'pending', onus: [], best: null, signalDropped: false, weak: false, oltReachable: null })
    expect(out.connections.c.state).toBe('no_username')
    expect(out.counts.pending).toBe(1)
    expect(out.counts.unavailable).toBe(0)
  })

  it('a rate_limited lookup is pending, a real error stays unavailable', async () => {
    const rows = [{ id: 'a', username: 'rl' }, { id: 'b', username: 'bad' }]
    const lookup = async (u) => ({ unavailable: true, reason: u === 'rl' ? 'rate_limited' : 'error' })
    const svc = createCustomerService({
      customerRepository: { listByBuilding: async () => rows, saveConnectionSnapshots: async () => {} },
      buildingService: { getBuilding: async () => ({}) },
      getOpticalLookup: () => ({ enabled: true, lookup }),
    })
    const out = await svc.getBuildingConnections({ buildingId: 'x' }, { role: 'ADMIN' })
    expect(out.connections.a.state).toBe('pending')
    expect(out.connections.b.state).toBe('unavailable')
    expect(out.counts).toMatchObject({ pending: 1, unavailable: 1 })
  })
})

describe('GET /customers/connections', () => {
  it('fans out: states, counts, one unavailable does not break the rest', async () => {
    setOpticalLookupForTests(fake())
    const res = await conns(mine.id)
    expect(res.status).toBe(200)
    const { enabled, connections, counts } = res.body.data
    expect(enabled).toBe(true)
    expect(connections[c.on.id].state).toBe('online')
    expect(connections[c.off.id].state).toBe('offline')
    expect(connections[c.down.id].state).toBe('unavailable')
    expect(connections[c.nl.id].state).toBe('not_linked')
    expect(connections[c.none.id].state).toBe('no_username')
    expect(connections[c.blank.id].state).toBe('no_username')
    expect(counts).toEqual({ online: 1, offline: 1, notSeen: 0, oltDown: 0, notLinked: 1, noUsername: 2, unavailable: 1, pending: 0, weak: 0 })
  })

  it('makes no OLT call for customers without a username', async () => {
    setOpticalLookupForTests(fake())
    await conns(mine.id)
    expect(calls.sort()).toEqual([U.down, U.off, U.online, U.unlinked].sort())
  })

  it('ADMIN gets serial and session ip', async () => {
    setOpticalLookupForTests(fake())
    const res = await conns(mine.id)
    const conn = res.body.data.connections[c.on.id]
    expect(conn.onus[0].serial).toBe('SERIAL123')
    expect(conn.onus[0].sessionIp).toBe('100.64.0.9')
    expect(JSON.stringify(res.body)).not.toContain('SECRET-PLACE')
  })

  it('a surveyor in scope gets none of the admin-only fields, at any depth', async () => {
    setOpticalLookupForTests(fake())
    const res = await conns(mine.id, SV)
    expect(res.status).toBe(200)
    expect(res.body.data.connections[c.on.id].state).toBe('online')
    const text = JSON.stringify(res.body)
    for (const k of ADMIN_ONLY_ONU_FIELDS) expect(text).not.toContain(`"${k}"`)
    expect(text).not.toContain('SERIAL123')
    expect(text).not.toContain('100.64.0.9')
  })

  it('out of scope answers 404 and makes no OLT call', async () => {
    setOpticalLookupForTests(fake())
    expect((await conns(mine.id, OTHER)).status).toBe(404)
    expect((await conns(theirs.id, SV)).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('feature off answers only { enabled: false }', async () => {
    setOpticalLookupForTests(fake(false))
    const res = await conns(mine.id)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ enabled: false })
    expect(calls).toEqual([])
  })

  it('requires buildingId', async () => {
    expect((await request(app).get('/api/v1/customers/connections').set(ADMIN)).status).toBe(400)
  })
})

describe('GET /customers/:id/connection', () => {
  const one = (id, who = ADMIN) => request(app).get(`/api/v1/customers/${id}/connection`).set(who)

  it('returns the connection (full for ADMIN)', async () => {
    setOpticalLookupForTests(fake())
    const res = await one(c.on.id)
    expect(res.status).toBe(200)
    expect(res.body.data.enabled).toBe(true)
    expect(res.body.data.connection.state).toBe('online')
    expect(res.body.data.connection.onus[0].serial).toBe('SERIAL123')
  })

  it('redacts for a surveyor and 404s out of scope', async () => {
    setOpticalLookupForTests(fake())
    const res = await one(c.on.id, SV)
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain('SERIAL123')
    expect((await one(c.far.id, SV)).status).toBe(404)
    expect((await one(c.on.id, OTHER)).status).toBe(404)
  })

  it('no username -> no_username without a call; unavailable stays row-level', async () => {
    setOpticalLookupForTests(fake())
    expect((await one(c.none.id)).body.data.connection.state).toBe('no_username')
    expect(calls).toEqual([])
    expect((await one(c.down.id)).body.data.connection.state).toBe('unavailable')
  })

  it('feature off -> { enabled: false }; unknown id -> 404', async () => {
    setOpticalLookupForTests(fake(false))
    expect((await one(c.on.id)).body.data).toEqual({ enabled: false })
    setOpticalLookupForTests(fake())
    expect((await one('nope')).status).toBe(404)
  })
})

describe('snapshot write-through', () => {
  const snap = (id) => prisma.customer.findUnique({ where: { id }, select: { connState: true, connRxDbm: true, connRxQuality: true, connOlt: true, connPon: true, connOnu: true, connWeak: true, connLastSeen: true, connCheckedAt: true } })
  const reset = () =>
    prisma.customer.updateMany({
      where: { building: { buildingName: { startsWith: S } } },
      data: { connState: null, connRxDbm: null, connRxQuality: null, connOlt: null, connPon: null, connOnu: null, connWeak: null, connLastSeen: null, connCheckedAt: null },
    })

  it('the building fan-out stores answered rows and leaves an unavailable row untouched', async () => {
    await reset()
    const old = new Date('2026-01-01T00:00:00Z')
    await prisma.customer.update({ where: { id: c.down.id }, data: { connState: 'online', connRxDbm: -10, connCheckedAt: old } })
    setOpticalLookupForTests(fake())
    await conns(mine.id)
    const on = await snap(c.on.id)
    expect(on).toMatchObject({ connState: 'online', connRxDbm: -15, connRxQuality: 'good', connOlt: 'OLT-1', connPon: 3, connOnu: 4, connWeak: false })
    expect(on.connLastSeen).toBeInstanceOf(Date)
    expect(on.connCheckedAt.getTime()).toBeGreaterThan(Date.now() - 60000)
    expect((await snap(c.off.id)).connState).toBe('offline')
    expect((await snap(c.nl.id))).toMatchObject({ connState: 'not_linked', connRxDbm: null })
    expect((await snap(c.none.id)).connState).toBe('no_username')
    expect((await snap(c.blank.id)).connState).toBe('no_username')
    const down = await snap(c.down.id) // 503 -> unavailable: previous snapshot kept
    expect(down.connState).toBe('online')
    expect(down.connRxDbm).toBe(-10)
    expect(down.connCheckedAt).toEqual(old)
    expect((await snap(c.far.id)).connState).toBeNull() // other building untouched
  })

  it('a rate-limited (pending) row keeps its stored snapshot', async () => {
    await reset()
    await prisma.customer.update({ where: { id: c.on.id }, data: { connState: 'offline', connCheckedAt: new Date('2026-01-01T00:00:00Z') } })
    const lookup = { enabled: true, lookup: async () => ({ unavailable: true, reason: 'rate_limited' }) }
    setOpticalLookupForTests(lookup)
    await conns(mine.id)
    expect((await snap(c.on.id)).connState).toBe('offline')
  })

  it('a failing save is logged and does not fail the request', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = createCustomerService({
      customerRepository: { listByBuilding: async () => [{ id: 'a', username: 'x' }], saveConnectionSnapshots: async () => { throw new Error('db down') } },
      buildingService: { getBuilding: async () => ({}) },
      getOpticalLookup: () => ({ enabled: true, lookup: async () => ({ found: false }) }),
    })
    const out = await svc.getBuildingConnections({ buildingId: 'x' }, { role: 'ADMIN' })
    expect(out.connections.a.state).toBe('not_linked')
    expect(err).toHaveBeenCalled()
    expect(JSON.stringify(err.mock.calls)).not.toContain('test-key')
    err.mockRestore()
  })

  it('the single-customer route stores too, and keeps the old one on unavailable', async () => {
    await reset()
    setOpticalLookupForTests(fake())
    await request(app).get(`/api/v1/customers/${c.on.id}/connection`).set(ADMIN)
    expect((await snap(c.on.id)).connState).toBe('online')
    await request(app).get(`/api/v1/customers/${c.down.id}/connection`).set(ADMIN)
    expect((await snap(c.down.id)).connState).toBeNull()
    await prisma.customer.update({ where: { id: c.on.id }, data: { connState: 'offline' } })
    setOpticalLookupForTests({ enabled: true, lookup: async () => ({ unavailable: true, reason: 'error' }) })
    await request(app).get(`/api/v1/customers/${c.on.id}/connection`).set(ADMIN)
    expect((await snap(c.on.id)).connState).toBe('offline')
  })
})

describe('OLT not reachable on the live connection routes', () => {
  it('building connections: oltReachable per connection; oltDown split out of notSeen', async () => {
    setOpticalLookupForTests(fake())
    const res = await conns(third.id, SV)
    expect(res.status).toBe(200)
    const { connections, counts } = res.body.data
    expect(connections[c.gone.id]).toMatchObject({ state: 'not_seen', oltReachable: false })
    expect(connections[c.quiet.id]).toMatchObject({ state: 'not_seen', oltReachable: true })
    expect(connections[c.up.id]).toMatchObject({ state: 'online', oltReachable: false })
    expect(counts).toEqual({ online: 1, offline: 0, notSeen: 1, oltDown: 1, notLinked: 0, noUsername: 0, unavailable: 0, pending: 0, weak: 0 })
  })

  it('a connection with no ONU has oltReachable null', async () => {
    setOpticalLookupForTests(fake())
    const { connections } = (await conns(mine.id)).body.data
    expect(connections[c.nl.id].oltReachable).toBeNull()
    expect(connections[c.none.id].oltReachable).toBeNull()
    expect(connections[c.on.id].oltReachable).toBe(true)
  })

  it('single customer: oltReachable on the connection', async () => {
    setOpticalLookupForTests(fake())
    const res = await request(app).get(`/api/v1/customers/${c.gone.id}/connection`).set(SV)
    expect(res.body.data.connection).toMatchObject({ state: 'not_seen', oltReachable: false })
  })

  it('a reachability failure leaves everything reachable, never fails the route', async () => {
    setOpticalLookupForTests(fake())
    setOltReachabilityForTests({ unreachableOlts: async () => { throw new Error('boom') } })
    try {
      const res = await conns(third.id, SV)
      expect(res.status).toBe(200)
      expect(res.body.data.counts).toMatchObject({ notSeen: 2, oltDown: 0 })
    } finally {
      setOltReachabilityForTests({ unreachableOlts: async () => new Set([DOWN_OLT]) })
    }
  })
})
