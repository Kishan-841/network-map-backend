import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

// Society permissions, phase 2: admin approval
// (.superpowers/sdd/2026-10-08-society-approval/design.md).
const app = createApp()
const auth = (id, role) => [
  'Authorization',
  `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]

const S = `sa-${Date.now()}`
const U = {
  PE: { id: `${S}-pe`, role: 'PERMISSION_EXECUTIVE' },
  PE2: { id: `${S}-pe2`, role: 'PERMISSION_EXECUTIVE' },
  ADMIN: { id: `${S}-admin`, role: 'ADMIN' },
  MANAGER: { id: `${S}-mgr`, role: 'MANAGER' },
  SURVEYOR: { id: `${S}-sur`, role: 'SURVEYOR' },
  SUPERVISOR: { id: `${S}-sup`, role: 'SUPERVISOR' },
  SALES_MANAGER: { id: `${S}-sm`, role: 'SALES_MANAGER' },
  TEAM_LEADER: { id: `${S}-tl`, role: 'TEAM_LEADER' },
  SALES_EXECUTIVE: { id: `${S}-se`, role: 'SALES_EXECUTIVE' },
}
const as = (key) => auth(U[key].id, U[key].role)
let OP = null
let ZONE = null

const society = (extra = {}) => ({
  buildingName: `${S} Society ${Math.random().toString(36).slice(2, 8)}`,
  formattedAddress: `${S} Kothrud, Pune`,
  latitude: 18.5074,
  longitude: 73.8077,
  // In the test zone already: if hiding failed, every zone-scoped view (and
  // the operator's stats) would pick a not-yet-approved society up.
  zoneId: ZONE,
  details: { wings: 1, floors: 5, homePass: 40 },
  contact: { contactName: 'R Joshi', contactPhone: '9876500000', designation: 'CHAIRMAN' },
  permission: { permissionStatus: 'ACCEPTED', societyOffer: 'DEMO', demoCount: 1 },
  remark: 'Met the chairman',
  ...extra,
})

const addAs = async (key, extra) => {
  const res = await request(app).post('/api/v1/buildings').set(...as(key)).send(society(extra))
  expect(res.status).toBe(201)
  return res.body.data
}
const detail = async (id, key = 'ADMIN') => {
  const res = await request(app).get(`/api/v1/permission-buildings/${id}`).set(...as(key))
  expect(res.status).toBe(200)
  return res.body.data
}
const visit = (id, body, key = 'PE') =>
  request(app).post(`/api/v1/permission-buildings/${id}/visits`).set(...as(key)).send(body)
const patch = (id, body, key = 'PE') => request(app).patch(`/api/v1/buildings/${id}`).set(...as(key)).send(body)
const approve = (id, body, key = 'ADMIN') =>
  request(app).post(`/api/v1/permission-buildings/${id}/approve`).set(...as(key)).send(body)
const reject = (id, body, key = 'ADMIN') =>
  request(app).post(`/api/v1/permission-buildings/${id}/reject`).set(...as(key)).send(body)
const kinds = (d) => d.visits.map((v) => v.kind)

beforeAll(async () => {
  OP = await prisma.operator.create({ data: { name: `${S} Operator` } })
  ZONE = (await prisma.zone.create({ data: { name: `${S} Zone`, city: 'Pune', operatorId: OP.id } })).id
  for (const [key, u] of Object.entries(U)) {
    await prisma.user.create({
      data: {
        id: u.id,
        name: `${S} ${key}`,
        email: `${u.id}@v.local`,
        passwordHash: 'x',
        role: u.role,
        ...(['SURVEYOR', 'TEAM_LEADER'].includes(u.role) && { assignedZones: { connect: { id: ZONE } } }),
        ...(['TEAM_LEADER', 'SALES_EXECUTIVE'].includes(u.role) && { managerId: U.SALES_MANAGER.id }),
      },
    })
  }
})

afterAll(async () => {
  const ids = Object.values(U).map((u) => u.id)
  // A fibre point RESTRICTs its building's delete — fibres go first.
  await prisma.fiber.deleteMany({ where: { zoneId: ZONE } })
  await prisma.building.deleteMany({ where: { buildingName: { startsWith: S } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.updateMany({ where: { id: { in: ids } }, data: { managerId: null } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await prisma.zone.deleteMany({ where: { id: ZONE } })
  await prisma.operator.deleteMany({ where: { id: OP.id } })
})

describe('sending a society for approval', () => {
  it('adding it as Accepted sends it straight away (SUBMITTED after ADDED)', async () => {
    const b = await addAs('PE')
    const d = await detail(b.id)
    expect(d.approval).toMatchObject({ status: 'PENDING', reason: null, decidedAt: null, decidedBy: null })
    expect(d.approval.submittedAt).toBeTruthy()
    expect(kinds(d)).toEqual(['SUBMITTED', 'ADDED'])
    expect(d.visits[0]).toMatchObject({ kind: 'SUBMITTED', user: { id: U.PE.id } })
  })

  it('adding it as Follow up does not', async () => {
    const b = await addAs('PE', { permission: { permissionStatus: 'FOLLOW_UP' } })
    const d = await detail(b.id)
    expect(d.approval).toBeNull()
    expect(kinds(d)).toEqual(['ADDED'])
  })

  it('a visit update that sets Accepted sends it', async () => {
    const b = await addAs('PE', { permission: { permissionStatus: 'FOLLOW_UP' } })
    const res = await visit(b.id, { remark: 'They agreed', permissionStatus: 'ACCEPTED' })
    expect(res.status).toBe(201)
    const d = await detail(b.id)
    expect(d.approval.status).toBe('PENDING')
    expect(kinds(d)).toEqual(['SUBMITTED', 'VISIT', 'ADDED'])
  })

  it('an edit that sets Accepted sends it', async () => {
    const b = await addAs('PE', { permission: { permissionStatus: 'DENIED' } })
    const res = await patch(b.id, { permission: { permissionStatus: 'ACCEPTED' }, remark: 'Changed their mind' })
    expect(res.status).toBe(200)
    const d = await detail(b.id)
    expect(d.approval.status).toBe('PENDING')
    expect(kinds(d)).toEqual(['SUBMITTED', 'EDIT', 'ADDED'])
  })

  it('a visit that keeps it Accepted while pending sends nothing new', async () => {
    const b = await addAs('PE')
    expect((await visit(b.id, { remark: 'Called again' })).status).toBe(201)
    const d = await detail(b.id)
    expect(d.approval.status).toBe('PENDING')
    expect(kinds(d)).toEqual(['VISIT', 'SUBMITTED', 'ADDED'])
  })

  it('moving off Accepted while pending withdraws it (visit)', async () => {
    const b = await addAs('PE')
    const res = await visit(b.id, { remark: 'Committee overruled', permissionStatus: 'FOLLOW_UP' })
    expect(res.status).toBe(201)
    const d = await detail(b.id)
    expect(d.approval).toBeNull()
    expect(kinds(d)).toEqual(['WITHDRAWN', 'VISIT', 'SUBMITTED', 'ADDED'])
    expect(d.visits[0]).toMatchObject({ kind: 'WITHDRAWN', remark: 'Committee overruled', user: { id: U.PE.id } })
  })

  it('moving off Accepted while pending withdraws it (edit)', async () => {
    const b = await addAs('PE')
    const res = await patch(b.id, { permission: { permissionStatus: 'DENIED' }, remark: 'Wrong society' })
    expect(res.status).toBe(200)
    const d = await detail(b.id)
    expect(d.approval).toBeNull()
    expect(d.visits[0]).toMatchObject({ kind: 'WITHDRAWN', remark: 'Wrong society' })
  })
})

describe('rejecting', () => {
  let b = null
  beforeAll(async () => {
    b = await addAs('PE')
  })

  it('needs a reason', async () => {
    expect((await reject(b.id, {})).status).toBe(400)
    expect((await reject(b.id, { reason: '   ' })).status).toBe(400)
  })

  it('is ADMIN only', async () => {
    expect((await reject(b.id, { reason: 'x' }, 'PE')).status).toBe(403)
    expect((await reject(b.id, { reason: 'x' }, 'MANAGER')).status).toBe(403)
  })

  it('records the reason, the admin and a REJECTED history row; the executive sees it', async () => {
    const res = await reject(b.id, { reason: '  Letter is unsigned  ' })
    expect(res.status).toBe(200)
    const d = await detail(b.id, 'PE')
    expect(d.approval).toMatchObject({
      status: 'REJECTED',
      reason: 'Letter is unsigned',
      decidedBy: { id: U.ADMIN.id, name: `${S} ADMIN` },
    })
    expect(d.approval.decidedAt).toBeTruthy()
    expect(d.visits[0]).toMatchObject({ kind: 'REJECTED', remark: 'Letter is unsigned', user: { id: U.ADMIN.id } })
  })

  it('a second decision is a 409', async () => {
    const res = await reject(b.id, { reason: 'again' })
    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe('Not waiting for approval')
    expect((await approve(b.id, { zoneId: ZONE })).status).toBe(409)
  })

  it('any executive action that leaves it Accepted re-submits (visit)', async () => {
    expect((await visit(b.id, { remark: 'Got the signed letter' })).status).toBe(201)
    const d = await detail(b.id, 'PE')
    expect(d.approval.status).toBe('PENDING')
    expect(kinds(d).slice(0, 2)).toEqual(['SUBMITTED', 'VISIT'])
  })

  it('an edit re-submits a rejected society too', async () => {
    const r = await addAs('PE')
    expect((await reject(r.id, { reason: 'Bad address' })).status).toBe(200)
    expect((await patch(r.id, { formattedAddress: `${S} Karve Road, Pune`, remark: 'Fixed the address' })).status).toBe(200)
    const d = await detail(r.id)
    expect(d.approval.status).toBe('PENDING')
    expect(kinds(d).slice(0, 2)).toEqual(['SUBMITTED', 'EDIT'])
  })
})

describe('approving', () => {
  let b = null
  beforeAll(async () => {
    b = await addAs('PE', { zoneId: undefined })
  })

  it('is ADMIN only', async () => {
    expect((await approve(b.id, { zoneId: ZONE }, 'PE')).status).toBe(403)
    for (const key of ['MANAGER', 'SUPERVISOR', 'SALES_MANAGER']) {
      expect((await approve(b.id, { zoneId: ZONE }, key)).status).toBe(403)
    }
  })

  it('needs a real zone', async () => {
    const none = await approve(b.id, {})
    expect(none.status).toBe(400)
    expect(none.body.error.message).toBe('Pick a zone')
    const bad = await approve(b.id, { zoneId: 'no-such-zone' })
    expect(bad.status).toBe(400)
    expect(bad.body.error.message).toBe('Pick a zone')
  })

  it('404s an unknown id or a coverage building', async () => {
    expect((await approve('no-such-building', { zoneId: ZONE })).status).toBe(404)
    const cov = await prisma.building.create({
      data: {
        buildingName: `${S} coverage`,
        formattedAddress: 'x',
        latitude: 18.5,
        longitude: 73.8,
        zoneId: ZONE,
        createdById: U.ADMIN.id,
      },
    })
    expect((await approve(cov.id, { zoneId: ZONE })).status).toBe(404)
  })

  it('409s a society that is not waiting', async () => {
    const f = await addAs('PE', { permission: { permissionStatus: 'FOLLOW_UP' } })
    expect((await approve(f.id, { zoneId: ZONE })).status).toBe(409)
  })

  it('sets the zone, FEASIBLE and an APPROVED history row', async () => {
    const res = await approve(b.id, { zoneId: ZONE, note: '  Looks good  ' })
    expect(res.status).toBe(200)
    const row = await prisma.building.findUnique({ where: { id: b.id } })
    expect(row).toMatchObject({
      zoneId: ZONE,
      feasibleStatus: 'FEASIBLE',
      permissionApproval: 'APPROVED',
      approvalDecidedById: U.ADMIN.id,
      isLive: false,
    })
    const d = await detail(b.id)
    expect(d.zone).toMatchObject({ id: ZONE, name: `${S} Zone` })
    expect(d.approval).toMatchObject({ status: 'APPROVED', decidedBy: { id: U.ADMIN.id } })
    expect(d.visits[0]).toMatchObject({ kind: 'APPROVED', remark: 'Looks good', user: { id: U.ADMIN.id } })
  })

  it('without a note the history says Approved', async () => {
    const c = await addAs('PE')
    expect((await approve(c.id, { zoneId: ZONE })).status).toBe(200)
    expect((await detail(c.id)).visits[0]).toMatchObject({ kind: 'APPROVED', remark: 'Approved' })
  })
})

describe('an approved society appears everywhere; a waiting / rejected one nowhere', () => {
  let ok = null
  let waiting = null
  let rejected = null
  const name = (tag) => `${S} VIS ${tag}`
  const listIds = (res) => (res.body.data.items ?? res.body.data).map((x) => x.id)

  beforeAll(async () => {
    ok = await addAs('PE', { buildingName: name('approved') })
    waiting = await addAs('PE', { buildingName: name('waiting') })
    rejected = await addAs('PE', { buildingName: name('rejected') })
    expect((await approve(ok.id, { zoneId: ZONE })).status).toBe(200)
    expect((await reject(rejected.id, { reason: 'No letter' })).status).toBe(200)
  })

  const check = (ids) => {
    expect(ids).toContain(ok.id)
    expect(ids).not.toContain(waiting.id)
    expect(ids).not.toContain(rejected.id)
  }

  for (const key of ['ADMIN', 'MANAGER', 'SURVEYOR', 'SUPERVISOR', 'SALES_MANAGER']) {
    it(`GET /buildings (default list) for ${key}, carrying source`, async () => {
      const res = await request(app).get(`/api/v1/buildings?pageSize=100&search=${encodeURIComponent(name(''))}`).set(...as(key))
      expect(res.status).toBe(200)
      check(listIds(res))
      expect(res.body.data.items.find((x) => x.id === ok.id).source).toBe('PERMISSION')
    })
  }

  it('the admin source=PERMISSION filter lists approved societies only', async () => {
    const res = await request(app).get(`/api/v1/buildings?pageSize=100&source=PERMISSION&search=${encodeURIComponent(name(''))}`).set(...as('ADMIN'))
    expect(res.status).toBe(200)
    check(listIds(res))
  })

  it('an explicit source=COVERAGE still means coverage rows only', async () => {
    const res = await request(app).get(`/api/v1/buildings?pageSize=100&source=COVERAGE&search=${encodeURIComponent(name(''))}`).set(...as('ADMIN'))
    expect(res.status).toBe(200)
    expect(listIds(res)).not.toContain(ok.id)
  })

  for (const key of ['ADMIN', 'MANAGER', 'SUPERVISOR']) {
    it(`map markers for ${key}, carrying source`, async () => {
      const res = await request(app).get('/api/v1/buildings/markers').set(...as(key))
      expect(res.status).toBe(200)
      check(listIds(res))
      expect(res.body.data.find((x) => x.id === ok.id).source).toBe('PERMISSION')
    })
  }

  it('GET /buildings/:id opens it for a manager (with source); still 404 while waiting', async () => {
    const res = await request(app).get(`/api/v1/buildings/${ok.id}`).set(...as('MANAGER'))
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('PERMISSION')
    expect((await request(app).get(`/api/v1/buildings/${waiting.id}`).set(...as('MANAGER'))).status).toBe(404)
  })

  it('the export carries it', async () => {
    const res = await request(app)
      .get(`/api/v1/buildings/export?search=${encodeURIComponent(name(''))}`)
      .set(...as('ADMIN'))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = []
        r.on('data', (c) => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })
    expect(res.status).toBe(200)
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(res.body)
    const names = []
    wb.worksheets[0].eachRow((row) => names.push(row.getCell(1).value))
    expect(names).toContain(name('approved'))
    expect(names).not.toContain(name('waiting'))
  })

  it('the surveyor’s nearby check sees it like any building', async () => {
    const res = await request(app)
      .get('/api/v1/buildings/nearby?latitude=18.5074&longitude=73.8077&radius=100')
      .set(...as('SURVEYOR'))
    expect(res.status).toBe(200)
    check(res.body.data.map((x) => x.id))
  })

  for (const key of ['ADMIN', 'SALES_MANAGER', 'TEAM_LEADER']) {
    it(`the sales map for ${key}, carrying source`, async () => {
      const res = await request(app).get('/api/v1/sales/map-buildings').set(...as(key))
      expect(res.status).toBe(200)
      check(res.body.data.map((x) => x.id))
      expect(res.body.data.find((x) => x.id === ok.id).source).toBe('PERMISSION')
    })
  }

  it('the team leader’s zone pool', async () => {
    const res = await request(app).get('/api/v1/sales/buildings').set(...as('TEAM_LEADER'))
    expect(res.status).toBe(200)
    check(res.body.data.map((x) => x.id))
  })

  it('the sales registry search', async () => {
    const res = await request(app).get(`/api/v1/sales/search-buildings?q=${encodeURIComponent(name(''))}`).set(...as('ADMIN'))
    expect(res.status).toBe(200)
    check(res.body.data.map((x) => x.id))
  })

  it('sales assignment by id: approved yes, waiting no', async () => {
    const yes = await request(app)
      .post('/api/v1/sales/assignments')
      .set(...as('ADMIN'))
      .send({ buildingIds: [ok.id], assignedToId: U.SALES_EXECUTIVE.id })
    expect(yes.status).toBe(200)
    const no = await request(app)
      .post('/api/v1/sales/assignments')
      .set(...as('ADMIN'))
      .send({ buildingIds: [waiting.id], assignedToId: U.SALES_EXECUTIVE.id })
    expect(no.status).toBe(400)
  })

  for (const key of ['ADMIN', 'TEAM_LEADER']) {
    it(`the visit-plan building lookup for ${key}`, async () => {
      const res = await request(app).get(`/api/v1/sales/tasks/buildings?q=${encodeURIComponent(name(''))}`).set(...as(key))
      expect(res.status).toBe(200)
      check(res.body.data.map((x) => x.id))
    })
  }

  it('partner building search and place matching (repository) see it', async () => {
    const { buildingRepository } = await import('../src/modules/buildings/building.repository.js')
    check((await buildingRepository.searchForPartner(name(''), 10)).map((x) => x.id))
    expect((await buildingRepository.searchForPartner(null, 1, ok.id)).map((x) => x.id)).toEqual([ok.id])
    expect(await buildingRepository.searchForPartner(null, 1, waiting.id)).toEqual([])
    const box = { minLat: 18.5, maxLat: 18.51, minLon: 73.8, maxLon: 73.81 }
    const near = (await buildingRepository.findWithinBounds(box)).map((x) => x.id)
    expect(near).toContain(ok.id)
    expect(near).not.toContain(waiting.id)
  })

  it('the dashboard stats count it (and only it) in its operator', async () => {
    const res = await request(app).get(`/api/v1/stats/dashboard?operatorId=${OP.id}`).set(...as('ADMIN'))
    expect(res.status).toBe(200)
    // Approved societies in this test's zone: `ok` here plus the two from the
    // approving block; every waiting / rejected one in the same zone is left out.
    const approvedInZone = await prisma.building.count({
      where: { zoneId: ZONE, source: 'PERMISSION', permissionApproval: 'APPROVED' },
    })
    const coverageInZone = await prisma.building.count({ where: { zoneId: ZONE, source: 'COVERAGE' } })
    expect(res.body.data.totalBuildings).toBe(approvedInZone + coverageInZone)
    const op = res.body.data.byOperator.find((o) => o.operatorId === OP.id)
    expect(op.buildings).toBe(approvedInZone + coverageInZone)
  })

  it('the zone-delete guard names only the hidden societies', async () => {
    const res = await request(app).delete(`/api/v1/zones/${ZONE}`).set(...as('ADMIN'))
    expect(res.status).toBe(409)
    const hidden = await prisma.building.count({
      // null-safe: a bare NOT would drop the never-sent (null) ones in SQL.
      where: { zoneId: ZONE, source: 'PERMISSION', OR: [{ permissionApproval: null }, { permissionApproval: { not: 'APPROVED' } }] },
    })
    expect(res.body.error.message).toContain(`including ${hidden} society-permission building`)
  })
})

describe('after approval the society is locked as Accepted', () => {
  let b = null
  beforeAll(async () => {
    b = await addAs('PE')
    expect((await approve(b.id, { zoneId: ZONE })).status).toBe(200)
  })

  it('the executive can still add a visit note', async () => {
    const res = await visit(b.id, { remark: 'Installed the demo' })
    expect(res.status).toBe(201)
    expect((await detail(b.id)).approval.status).toBe('APPROVED')
  })

  it('but not change the status, even to the same value', async () => {
    for (const permissionStatus of ['FOLLOW_UP', 'ACCEPTED']) {
      const res = await visit(b.id, { remark: 'x', permissionStatus })
      expect(res.status).toBe(400)
      expect(res.body.error.message).toBe('Approved societies keep their status')
    }
  })

  it('and cannot edit the details', async () => {
    const res = await patch(b.id, { formattedAddress: 'Elsewhere', remark: 'moved' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe("Approved societies can't be edited")
  })

  it('an admin may still edit, and it is logged', async () => {
    const res = await patch(b.id, { formattedAddress: `${S} Elsewhere`, remark: 'Corrected the address' }, 'ADMIN')
    expect(res.status).toBe(200)
    const d = await detail(b.id)
    expect(d.visits[0]).toMatchObject({ kind: 'EDIT', changes: ['address'], user: { id: U.ADMIN.id } })
    expect(d.approval.status).toBe('APPROVED')
    expect((await patch(b.id, { formattedAddress: `${S} Again` }, 'ADMIN')).status).toBe(400)
  })

  it('an admin cannot move it off Accepted either', async () => {
    const res = await patch(b.id, { permission: { permissionStatus: 'DENIED' }, remark: 'x' }, 'ADMIN')
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('Approved societies keep their status')
  })

  it('the normal status route works for an admin', async () => {
    const res = await request(app).patch(`/api/v1/buildings/${b.id}/status`).set(...as('ADMIN')).send({ isLive: true })
    expect(res.status).toBe(200)
    expect(res.body.data.isLive).toBe(true)
  })
})

describe('GET /permission-buildings: approval on the list, filter, pending count', () => {
  let p = null
  let a = null
  beforeAll(async () => {
    p = await addAs('PE', { buildingName: `${S} LIST pending` })
    a = await addAs('PE', { buildingName: `${S} LIST approved` })
    expect((await approve(a.id, { zoneId: ZONE })).status).toBe(200)
  })
  const ids = (res) => res.body.data.items.map((x) => x.id)

  it('items carry approval and zone', async () => {
    const res = await request(app).get(`/api/v1/permission-buildings?pageSize=100&search=${encodeURIComponent(`${S} LIST`)}`).set(...as('PE'))
    expect(res.status).toBe(200)
    const pr = res.body.data.items.find((x) => x.id === p.id)
    const ar = res.body.data.items.find((x) => x.id === a.id)
    expect(pr.approval).toMatchObject({ status: 'PENDING', reason: null, decidedBy: null })
    expect(ar.approval).toMatchObject({ status: 'APPROVED', decidedBy: { id: U.ADMIN.id, name: `${S} ADMIN` } })
    expect(ar.zone).toEqual({ id: ZONE, name: `${S} Zone` })
  })

  it('filters by approval', async () => {
    const pending = await request(app).get(`/api/v1/permission-buildings?pageSize=100&approval=PENDING&search=${encodeURIComponent(`${S} LIST`)}`).set(...as('ADMIN'))
    expect(pending.status).toBe(200)
    expect(ids(pending)).toContain(p.id)
    expect(ids(pending)).not.toContain(a.id)
    const approved = await request(app).get(`/api/v1/permission-buildings?pageSize=100&approval=APPROVED&search=${encodeURIComponent(`${S} LIST`)}`).set(...as('ADMIN'))
    expect(ids(approved)).toEqual([a.id])
    expect((await request(app).get('/api/v1/permission-buildings?approval=NOPE').set(...as('ADMIN'))).status).toBe(400)
  })

  it('pending-count is ADMIN only and counts waiting societies', async () => {
    const res = await request(app).get('/api/v1/permission-buildings/pending-count').set(...as('ADMIN'))
    expect(res.status).toBe(200)
    const inDb = await prisma.building.count({ where: { source: 'PERMISSION', permissionApproval: 'PENDING' } })
    expect(res.body.data.count).toBeGreaterThanOrEqual(1)
    expect(Math.abs(res.body.data.count - inDb)).toBeLessThanOrEqual(5) // other files may add rows meanwhile
    expect((await request(app).get('/api/v1/permission-buildings/pending-count').set(...as('PE'))).status).toBe(403)
  })
})

// URLs the active storage provider recognises as ours, under a test-only key
// prefix (nothing is uploaded).
const storageBase = () => (env.storageDriver === 'r2' ? env.r2.publicUrl : `${env.appUrl}/uploads`)
const fileUrl = (n) => `${storageBase()}/${S}/${n}`

describe('fix round 1', () => {
  it('approve refuses a society whose Place is already in the target zone (clear 409, stays PENDING)', async () => {
    const soc = await addAs('PE', { zoneId: undefined, buildingName: `${S} Clash place society` })
    await prisma.building.update({ where: { id: soc.id }, data: { placeId: `${S}-place-1` } })
    await prisma.building.create({
      data: {
        buildingName: `${S} Clash place coverage`,
        formattedAddress: 'x',
        latitude: 18.5,
        longitude: 73.8,
        zoneId: ZONE,
        placeId: `${S}-place-1`,
        createdById: U.ADMIN.id,
      },
    })
    const res = await approve(soc.id, { zoneId: ZONE })
    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe(`This society is already in ${S} Zone as '${S} Clash place coverage'`)
    const row = await prisma.building.findUnique({ where: { id: soc.id } })
    expect(row).toMatchObject({ permissionApproval: 'PENDING', zoneId: null })
    expect((await detail(soc.id)).visits[0].kind).toBe('SUBMITTED')
  })

  it('approve refuses a society whose name is already in the target zone', async () => {
    await prisma.building.create({
      data: {
        buildingName: `${S} Clash Name`,
        formattedAddress: 'x',
        latitude: 18.5,
        longitude: 73.8,
        zoneId: ZONE,
        createdById: U.ADMIN.id,
      },
    })
    const soc = await addAs('PE', { zoneId: undefined, buildingName: `${S} clash name` })
    const res = await approve(soc.id, { zoneId: ZONE })
    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe(`This society is already in ${S} Zone as '${S} Clash Name'`)
    expect((await prisma.building.findUnique({ where: { id: soc.id } })).permissionApproval).toBe('PENDING')
  })

  describe('photos on an approved society', () => {
    let b = null
    let letter = null
    beforeAll(async () => {
      b = await addAs('PE', {
        buildingName: `${S} Approved photos`,
        photos: [{ type: 'PERMISSION_LETTER', url: fileUrl('letter.pdf') }],
        permission: { permissionStatus: 'ACCEPTED', documentUrl: fileUrl('letter.pdf') },
      })
      expect((await approve(b.id, { zoneId: ZONE })).status).toBe(200)
      letter = await prisma.photo.findFirst({ where: { buildingId: b.id, type: 'PERMISSION_LETTER' } })
    })
    const docUrl = async () => (await prisma.permission.findUnique({ where: { buildingId: b.id } })).documentUrl

    it('nobody uploads or deletes the permission letter through the photo routes', async () => {
      const before = await docUrl()
      for (const key of ['MANAGER', 'ADMIN']) {
        const up = await request(app)
          .post(`/api/v1/buildings/${b.id}/photos`)
          .set(...as(key))
          .send({ type: 'PERMISSION_LETTER', url: fileUrl(`letter-${key}.pdf`) })
        expect(up.status).toBe(400)
        expect(up.body.error.message).toBe('Change the permission letter from Edit details')
        const del = await request(app).delete(`/api/v1/buildings/${b.id}/photos/${letter.id}`).set(...as(key))
        expect(del.status).toBe(400)
        expect(del.body.error.message).toBe('Change the permission letter from Edit details')
      }
      expect(await docUrl()).toBe(before)
      expect(await prisma.photo.count({ where: { buildingId: b.id, type: 'PERMISSION_LETTER' } })).toBe(1)
    })

    it('a manager adds an entrance photo like on any building', async () => {
      const res = await request(app)
        .post(`/api/v1/buildings/${b.id}/photos`)
        .set(...as('MANAGER'))
        .send({ type: 'ENTRANCE', url: fileUrl('entrance.jpg') })
      expect(res.status).toBe(201)
    })

    it('another executive gets a 404; the owner the lock', async () => {
      const other = await request(app)
        .post(`/api/v1/buildings/${b.id}/photos`)
        .set(...as('PE2'))
        .send({ type: 'ADDITIONAL', url: fileUrl('x.jpg') })
      expect(other.status).toBe(404)
      const own = await request(app)
        .post(`/api/v1/buildings/${b.id}/photos`)
        .set(...as('PE'))
        .send({ type: 'ADDITIONAL', url: fileUrl('x.jpg') })
      expect(own.status).toBe(400)
      expect(own.body.error.message).toBe("Approved societies can't be edited")
    })
  })

  it('a fibre point cannot attach to a society not yet approved; an approved one is fine', async () => {
    const waiting = await addAs('PE')
    const ok = await addAs('PE')
    expect((await approve(ok.id, { zoneId: ZONE })).status).toBe(200)
    const fibre = (buildingId) =>
      request(app)
        .post('/api/v1/fibers')
        .set(...as('ADMIN'))
        .send({
          zoneId: ZONE,
          coreCount: 2,
          points: [
            { type: 'WAYPOINT', latitude: 18.5, longitude: 73.8 },
            { type: 'BUILDING', buildingId, latitude: 18.5074, longitude: 73.8077 },
          ],
        })
    const refused = await fibre(waiting.id)
    expect(refused.status).toBe(400)
    expect(refused.body.error.message).toBe('Building does not exist')
    const fine = await fibre(ok.id)
    expect(fine.status).toBe(201)
  })
})
