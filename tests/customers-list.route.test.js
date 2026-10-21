import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { istDay } from '../src/lib/visit-plan.js'

// GET /customers/list and /customers/list.csv (spec 2026-10-21, decisions 2, 4–7).
const app = createApp()
const S = `clist-${Date.now()}`
const auth = (id, role) => ({
  Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
})
const IDS = { admin: `${S}-admin`, svA: `${S}-sva`, svB: `${S}-svb`, agent: `${S}-agent` }
const ADMIN = auth(IDS.admin, 'ADMIN')
const SVA = auth(IDS.svA, 'SURVEYOR')
const SVB = auth(IDS.svB, 'SURVEYOR')
const AGENT = auth(IDS.agent, 'ACQUISITION_AGENT')

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const now = Date.now()
const at = (ms) => new Date(now + ms)

let z1, z2, alpha, beta, gamma, hidden, big, wingA
const c = {}

const list = (query = {}, who = SVA) => request(app).get('/api/v1/customers/list').query(query).set(who)
const csv = (query = {}, who = SVA) =>
  request(app)
    .get('/api/v1/customers/list.csv')
    .query(query)
    .set(who)
    .buffer(true)
    .parse((res, cb) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => cb(null, body))
    })
const names = (res) => res.body.data.rows.map((r) => r.name)

beforeAll(async () => {
  z1 = await prisma.zone.create({ data: { name: `${S}-z1`, city: 'Test' } })
  z2 = await prisma.zone.create({ data: { name: `${S}-z2`, city: 'Test' } })
  const user = (id, role, zoneId) =>
    prisma.user.create({
      data: {
        id, name: id, email: `${id}@t.local`, passwordHash: 'x', role,
        ...(zoneId && { assignedZones: { connect: { id: zoneId } } }),
      },
    })
  await user(IDS.admin, 'ADMIN')
  await user(IDS.svA, 'SURVEYOR', z1.id)
  await user(IDS.svB, 'SURVEYOR', z2.id)
  await user(IDS.agent, 'ACQUISITION_AGENT')
  const building = (name, zoneId, extra = {}) =>
    prisma.building.create({
      data: { buildingName: `${S} ${name}`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId, createdById: IDS.admin, ...extra },
    })
  alpha = await building('Alpha', z1.id)
  beta = await building('Beta', z1.id)
  gamma = await building('Gamma', z2.id)
  // A society permission still waiting for approval: only ADMIN reads it.
  hidden = await building('Hidden', z1.id, { source: 'PERMISSION' })
  big = await building('Big', null)
  wingA = await prisma.buildingWing.create({ data: { buildingId: alpha.id, name: 'A', latitude: 18.5, longitude: 73.8 } })

  const cust = (buildingId, data) => prisma.customer.create({ data: { buildingId, createdById: IDS.admin, ...data } })
  c.asha = await cust(alpha.id, {
    name: 'Asha', mobile: '9100000001', username: `${S}-asha`, email: 'asha@x.in', wingId: wingA.id,
    operator: 'Airtel', networkZone: 'NZ-East', status: 'Active', planName: 'Basic 100', planAmount: 500,
    planExpiresAt: at(3 * DAY), autoRenewal: true, ponNumber: '7', olt: 'OLT-1',
    connState: 'online', connRxDbm: -18, connRxQuality: 'good', connWeak: false, connCheckedAt: at(-HOUR),
    connOlt: 'OLT-1', connPon: 7, connOnu: 3, connLastSeen: at(-HOUR),
  })
  c.bharat = await cust(alpha.id, {
    name: 'Bharat', mobile: '9100000002', username: `${S}-bharat`, operator: 'Jio', networkZone: 'NZ-West',
    status: 'Expired', planName: 'Pro 200', planAmount: 900, planExpiresAt: at(-2 * DAY), autoRenewal: false,
    connState: 'offline', connRxDbm: -27, connRxQuality: 'poor', connWeak: true, connCheckedAt: at(-2 * HOUR),
  })
  c.chitra = await cust(alpha.id, {
    name: 'Chitra', mobile: '9100000003', username: `${S}-zeta`, operator: 'Airtel', networkZone: 'NZ-East',
    status: 'Active', planName: 'Basic 100', planExpiresAt: at(20 * DAY),
    connState: 'not_seen', connCheckedAt: at(-30 * 60 * 1000),
  })
  c.dev = await cust(alpha.id, { name: 'Dev', mobile: '9100000004' })
  // Every awkward character the CSV has to survive.
  c.evil = await cust(beta.id, {
    name: '=SUM(A1)', mobile: '9100000005', username: '@user5', email: '+cmd@x.in', address: 'SECRET ADDRESS',
    operator: 'Airtel', status: 'Active', planName: 'Fibre, "Gold"\nPlus', planExpiresAt: at(40 * DAY),
    connState: 'online', connRxDbm: -15, connRxQuality: 'good', connWeak: false, connCheckedAt: at(-60 * 1000),
  })
  c.farid = await cust(gamma.id, { name: 'Farid', mobile: '9100000006', operator: 'BSNL', status: 'Active', connState: 'online' })
  c.hidden = await cust(hidden.id, { name: 'Hidden', mobile: '9100000007', operator: 'Secret' })
})

afterAll(async () => {
  await prisma.customer.deleteMany({ where: { building: { buildingName: { startsWith: S } } } })
  await prisma.buildingWing.deleteMany({ where: { building: { buildingName: { startsWith: S } } } })
  await prisma.building.deleteMany({ where: { buildingName: { startsWith: S } } })
  await prisma.user.deleteMany({ where: { id: { in: Object.values(IDS) } } })
  await prisma.zone.deleteMany({ where: { id: { in: [z1.id, z2.id] } } })
})

describe('GET /customers/list — scope', () => {
  it('a surveyor sees only customers of buildings in their zone (never an unapproved society)', async () => {
    const res = await list({ sort: 'expiry' })
    expect(res.status).toBe(200)
    expect(names(res).sort()).toEqual(['=SUM(A1)', 'Asha', 'Bharat', 'Chitra', 'Dev'])
    expect(res.body.data.total).toBe(5)
    expect(res.body.data.counts).toEqual({ total: 5, online: 2, offline: 1, notSeen: 1, weak: 1, expiring7d: 1 })

    const other = await list({}, SVB)
    expect(names(other)).toEqual(['Farid'])
    expect(other.body.data.counts).toEqual({ total: 1, online: 1, offline: 0, notSeen: 0, weak: 0, expiring7d: 0 })
    expect(other.body.data.facets).toEqual({
      zones: [{ id: z2.id, name: z2.name }],
      networkZones: [],
      operators: ['BSNL'],
      billingStatuses: ['Active'],
      planNames: [],
      buildings: [{ id: gamma.id, buildingName: gamma.buildingName }],
    })
  })

  it('a query param cannot widen the scope', async () => {
    expect((await list({ buildingId: gamma.id })).body.data).toMatchObject({ rows: [], total: 0 })
    expect((await list({ zoneId: z2.id })).body.data.total).toBe(0)
    expect((await list({ buildingId: hidden.id })).body.data.total).toBe(0)
  })

  it('a role whose read rule allows nothing gets an empty list, not 403', async () => {
    const res = await list({}, AGENT)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ rows: [], total: 0, counts: { total: 0 } })
    expect(res.body.data.facets.buildings).toEqual([])
  })

  it('ADMIN reads every building, including an unapproved society', async () => {
    expect(names(await list({ buildingId: hidden.id }, ADMIN))).toEqual(['Hidden'])
    expect(names(await list({ zoneId: z2.id }, ADMIN))).toEqual(['Farid'])
  })

  it('needs a session', async () => {
    expect((await request(app).get('/api/v1/customers/list')).status).toBe(401)
  })
})

describe('GET /customers/list — rows and facets', () => {
  it('a row carries building, wing, zone and the snapshot — no address, no device ids beyond the snapshot', async () => {
    const res = await list({ q: 'asha' })
    const [row] = res.body.data.rows
    expect(Object.keys(row).sort()).toEqual(
      [
        'id', 'name', 'username', 'mobile', 'email', 'operator', 'networkZone', 'planName', 'planAmount',
        'planExpiresAt', 'status', 'autoRenewal', 'ponNumber', 'olt', 'building', 'wing', 'zone', 'connState',
        'connRxDbm', 'connRxQuality', 'connOlt', 'connPon', 'connOnu', 'connLastSeen', 'connWeak', 'connCheckedAt',
      ].sort(),
    )
    expect(row).toMatchObject({
      id: c.asha.id,
      building: { id: alpha.id, buildingName: alpha.buildingName },
      wing: { id: wingA.id, name: 'A' },
      zone: { id: z1.id, name: z1.name },
      connState: 'online',
      connRxDbm: -18,
      planAmount: 500,
    })
    expect(names(await list({ q: 'dev' }))).toEqual(['Dev'])
    expect((await list({ q: 'dev' })).body.data.rows[0].wing).toBeNull()
  })

  it('facets come from the whole scope, ignoring the filter', async () => {
    const res = await list({ operator: 'Jio' })
    expect(res.body.data.total).toBe(1)
    expect(res.body.data.facets).toEqual({
      zones: [{ id: z1.id, name: z1.name }],
      networkZones: ['NZ-East', 'NZ-West'],
      operators: ['Airtel', 'Jio'],
      billingStatuses: ['Active', 'Expired'],
      planNames: ['Basic 100', 'Fibre, "Gold"\nPlus', 'Pro 200'],
      buildings: [
        { id: alpha.id, buildingName: alpha.buildingName },
        { id: beta.id, buildingName: beta.buildingName },
      ],
    })
  })
})

describe('GET /customers/list — filters', () => {
  const cases = [
    [{ q: 'ASHA' }, ['Asha']],
    [{ q: '00000002' }, ['Bharat']],
    [{ q: '+91 91000 00002' }, ['Bharat']],
    [{ q: 'zeta' }, ['Chitra']],
    [{ zoneId: '$z1' }, ['=SUM(A1)', 'Asha', 'Bharat', 'Chitra', 'Dev']],
    [{ networkZone: 'NZ-East' }, ['Asha', 'Chitra']],
    [{ operator: 'Jio' }, ['Bharat']],
    [{ billingStatus: 'Expired' }, ['Bharat']],
    [{ conn: 'online' }, ['=SUM(A1)', 'Asha']],
    [{ conn: 'offline' }, ['Bharat']],
    [{ conn: 'not_seen' }, ['Chitra']],
    [{ conn: 'not_linked' }, []],
    [{ conn: 'never' }, ['Dev']],
    [{ weak: 'true' }, ['Bharat']],
    [{ expiry: 'expired' }, ['Bharat']],
    [{ expiry: '7d' }, ['Asha']],
    [{ expiry: '30d' }, ['Asha', 'Chitra']],
    [{ buildingId: '$beta' }, ['=SUM(A1)']],
    [{ planName: 'Basic 100' }, ['Asha', 'Chitra']],
    [{ autoRenewal: 'yes' }, ['Asha']],
    [{ autoRenewal: 'no' }, ['Bharat']],
    [{ autoRenewal: 'unset' }, ['=SUM(A1)', 'Chitra', 'Dev']],
  ]
  // Seeded ids do not exist yet when the table is built — resolved per test.
  const resolve = (query) =>
    Object.fromEntries(Object.entries(query).map(([k, v]) => [k, v === '$z1' ? z1.id : v === '$beta' ? beta.id : v]))
  it.each(cases)('%j', async (query, expected) => {
    const res = await list(resolve(query))
    expect(res.status).toBe(200)
    expect(names(res).sort()).toEqual(expected)
    expect(res.body.data.total).toBe(expected.length)
  })

  it('filters combine with AND, and counts follow the filter', async () => {
    const both = await list({ operator: 'Airtel', conn: 'online' })
    expect(names(both).sort()).toEqual(['=SUM(A1)', 'Asha'])
    expect(both.body.data.counts).toEqual({ total: 2, online: 2, offline: 0, notSeen: 0, weak: 0, expiring7d: 1 })
    const three = await list({ operator: 'Airtel', conn: 'online', expiry: '7d' })
    expect(names(three)).toEqual(['Asha'])
  })

  it('a blank filter is no filter', async () => {
    expect((await list({ q: '', operator: '', conn: '' })).body.data.total).toBe(5)
  })

  it('rejects unknown enum values and a page size over 100', async () => {
    expect((await list({ conn: 'bogus' })).status).toBe(400)
    expect((await list({ expiry: '90d' })).status).toBe(400)
    expect((await list({ sort: 'mobile' })).status).toBe(400)
    expect((await list({ weak: 'false' })).status).toBe(400)
    expect((await list({ pageSize: 101 })).status).toBe(400)
    expect((await list({ pageSize: 0 })).status).toBe(400)
    expect((await list({ page: 0 })).status).toBe(400)
  })
})

describe('GET /customers/list — sort and pages', () => {
  it('name (default), expiry, signal and last checked', async () => {
    const byName = names(await list()).filter((n) => n !== '=SUM(A1)')
    expect(byName).toEqual(['Asha', 'Bharat', 'Chitra', 'Dev'])
    expect(names(await list({ sort: 'expiry' }))).toEqual(['Bharat', 'Asha', 'Chitra', '=SUM(A1)', 'Dev'])
    const signal = names(await list({ sort: 'signal' }))
    expect(signal.slice(0, 3)).toEqual(['Bharat', 'Asha', '=SUM(A1)'])
    expect(signal.slice(3).sort()).toEqual(['Chitra', 'Dev'])
    expect(names(await list({ sort: 'checked' }))).toEqual(['=SUM(A1)', 'Chitra', 'Asha', 'Bharat', 'Dev'])
  })

  it('pages keep the filter; a page past the end is empty with the real total', async () => {
    const p1 = await list({ sort: 'expiry', pageSize: 2, page: 1 })
    const p2 = await list({ sort: 'expiry', pageSize: 2, page: 2 })
    const p3 = await list({ sort: 'expiry', pageSize: 2, page: 3 })
    expect([...names(p1), ...names(p2), ...names(p3)]).toEqual(['Bharat', 'Asha', 'Chitra', '=SUM(A1)', 'Dev'])
    expect(p2.body.data).toMatchObject({ total: 5, page: 2, pageSize: 2 })
    const past = await list({ sort: 'expiry', pageSize: 2, page: 9 })
    expect(past.status).toBe(200)
    expect(past.body.data).toMatchObject({ rows: [], total: 5, page: 9 })
    const filtered = await list({ conn: 'online', pageSize: 1, page: 2 })
    expect(filtered.body.data.total).toBe(2)
    expect(filtered.body.data.rows).toHaveLength(1)
  })

  it('defaults to page 1 of 50', async () => {
    expect((await list()).body.data).toMatchObject({ page: 1, pageSize: 50 })
  })
})

describe('GET /customers/list.csv', () => {
  const HEADER =
    'Name,Username,Mobile,Email,Building,Wing,Zone,Network zone,Operator,Plan,Amount,Expires,Billing status,Auto renewal,PON,OLT,Connection,Signal (dBm),Signal quality,Last seen,Checked at'

  it('BOM, header, one line per customer in scope; escaped and formula-safe', async () => {
    const res = await csv({ sort: 'expiry' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/)
    expect(res.headers['content-disposition']).toBe(`attachment; filename="customers-${istDay(new Date())}.csv"`)
    expect(res.headers['x-truncated']).toBeUndefined()
    const text = res.body
    expect(text.startsWith('﻿')).toBe(true)
    const lines = text.slice(1).split('\r\n')
    expect(lines[0]).toBe(HEADER)
    expect(lines.at(-1)).toBe('')
    expect(lines.slice(1, -1).map((l) => l.split(',')[0])).toEqual(['Bharat', 'Asha', 'Chitra', "'=SUM(A1)", 'Dev'])

    expect(lines[2].startsWith(
      ['Asha', `${S}-asha`, '9100000001', 'asha@x.in', alpha.buildingName, 'A', z1.name, 'NZ-East', 'Airtel',
        'Basic 100', '500', istDay(c.asha.planExpiresAt), 'Active', 'Yes', '7', 'OLT-1', 'Online', '-18', 'good'].join(','),
    )).toBe(true)
    expect(lines[2]).toMatch(/,\d{4}-\d{2}-\d{2} \d{2}:\d{2},\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

    // The evil row: quotes doubled, the cell with a comma/newline wrapped,
    // every text cell starting = + - @ neutralised; a negative number is not text.
    expect(text).toContain(`'=SUM(A1),'@user5,9100000005,'+cmd@x.in,${beta.buildingName},,${z1.name},,Airtel,"Fibre, ""Gold""\nPlus",`)
    expect(text).toContain(',Online,-15,good,')
    expect(text).not.toContain('SECRET ADDRESS')
    expect(text).not.toMatch(/serial|session_ip|customer_ips/i)
    expect(lines.find((l) => l.startsWith('Dev,'))).toBe('Dev,,9100000004,,' + `${alpha.buildingName},,${z1.name},,,,,,,,,,Not checked,,,,`)
  })

  it('the export follows the filter and the scope', async () => {
    const res = await csv({ operator: 'Jio' })
    expect(res.body.slice(1).split('\r\n').filter(Boolean)).toHaveLength(2)
    const other = await csv({}, SVB)
    const lines = other.body.slice(1).split('\r\n').filter(Boolean)
    expect(lines.map((l) => l.split(',')[0])).toEqual(['Name', 'Farid'])
    expect((await csv({ pageSize: 500 })).status).toBe(400)
  })

  it('caps at 5000 rows and says so', async () => {
    await prisma.customer.createMany({
      data: Array.from({ length: 5001 }, (_, i) => ({
        buildingId: big.id, name: `Bulk ${String(i).padStart(5, '0')}`, mobile: `8${String(i).padStart(9, '0')}`,
      })),
    })
    const res = await csv({ buildingId: big.id }, ADMIN)
    expect(res.status).toBe(200)
    expect(res.headers['x-truncated']).toBe('true')
    expect(res.body.slice(1).split('\r\n').filter(Boolean)).toHaveLength(5001) // header + 5000
    const page = await list({ buildingId: big.id, pageSize: 1 }, ADMIN)
    expect(page.body.data.total).toBe(5001)
    expect(page.body.data.rows[0].zone).toBeNull()
  }, 30000)
})
