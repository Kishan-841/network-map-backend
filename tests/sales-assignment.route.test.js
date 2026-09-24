import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const token = (id) => jwt.sign({ sub: id }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })
const auth = (id) => ({ Authorization: `Bearer ${token(id)}` })

// One manager's team, plus a second manager's team for isolation checks.
const USERS = [
  { id: 'sales-mgr', role: 'SALES_MANAGER' },
  { id: 'sales-mgr2', role: 'SALES_MANAGER' },
  { id: 'sales-tl', role: 'TEAM_LEADER', managerId: 'sales-mgr' },
  { id: 'sales-tl2', role: 'TEAM_LEADER', managerId: 'sales-mgr2' },
  { id: 'sales-se1', role: 'SALES_EXECUTIVE', managerId: 'sales-mgr', teamLeaderId: 'sales-tl' },
  { id: 'sales-se2', role: 'SALES_EXECUTIVE', managerId: 'sales-mgr', teamLeaderId: 'sales-tl' },
  { id: 'sales-se3', role: 'SALES_EXECUTIVE', managerId: 'sales-mgr2', teamLeaderId: 'sales-tl2' },
]
const B1 = 'sales-b1'
const B2 = 'sales-b2'
const B3 = 'sales-b3'

const buildingIdsOf = (res) => res.body.data.map((b) => b.id)

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: USERS.map((u) => u.id) } } })
  // Managers first (no FK), then their reports.
  for (const u of USERS.filter((u) => !u.managerId).concat(USERS.filter((u) => u.managerId))) {
    await prisma.user.create({
      data: {
        id: u.id,
        name: u.id,
        email: `${u.id}@vitest.local`,
        passwordHash: 'x',
        role: u.role,
        managerId: u.managerId ?? null,
        teamLeaderId: u.teamLeaderId ?? null,
      },
    })
  }
  for (const id of [B1, B2, B3]) {
    await prisma.building.upsert({
      where: { id },
      update: {},
      create: {
        id,
        buildingName: id.toUpperCase(),
        formattedAddress: `${id} road`,
        latitude: 18.5,
        longitude: 73.8,
        createdById: 'test-admin',
      },
    })
  }
})

afterAll(async () => {
  await prisma.building.deleteMany({ where: { id: { in: [B1, B2, B3] } } }) // cascades assignments
  await prisma.user.deleteMany({ where: { email: { startsWith: 'sales-made-' } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: USERS.map((u) => u.id) } } })
  await prisma.user.deleteMany({ where: { id: { in: USERS.map((u) => u.id) } } })
})

describe('field-sales assignment + scope', () => {
  it('admin assigns a building to a manager; only that manager sees it', async () => {
    const res = await request(app).post('/api/v1/sales/assignments').set(auth('test-admin')).send({ buildingIds: [B1], assignedToId: 'sales-mgr' })
    expect(res.status).toBe(200)
    expect(res.body.data.count).toBe(1)

    expect(buildingIdsOf(await request(app).get('/api/v1/sales/buildings').set(auth('sales-mgr')))).toContain(B1)
    // Held by the manager, so an executive under them does not see it yet.
    expect(buildingIdsOf(await request(app).get('/api/v1/sales/buildings').set(auth('sales-se1')))).not.toContain(B1)
    // A different team never sees it.
    expect(buildingIdsOf(await request(app).get('/api/v1/sales/buildings').set(auth('sales-mgr2')))).not.toContain(B1)
  })

  it('manager distributes to a team leader; leader and manager both see it', async () => {
    const res = await request(app).post('/api/v1/sales/assignments').set(auth('sales-mgr')).send({ buildingIds: [B1], assignedToId: 'sales-tl' })
    expect(res.status).toBe(200)
    expect(buildingIdsOf(await request(app).get('/api/v1/sales/buildings').set(auth('sales-tl')))).toContain(B1)
    expect(buildingIdsOf(await request(app).get('/api/v1/sales/buildings').set(auth('sales-mgr')))).toContain(B1)
  })

  it('team leader distributes to an executive; the whole chain above sees it, siblings do not', async () => {
    const res = await request(app).post('/api/v1/sales/assignments').set(auth('sales-tl')).send({ buildingIds: [B1], assignedToId: 'sales-se1' })
    expect(res.status).toBe(200)
    expect(buildingIdsOf(await request(app).get('/api/v1/sales/buildings').set(auth('sales-se1')))).toContain(B1)
    expect(buildingIdsOf(await request(app).get('/api/v1/sales/buildings').set(auth('sales-se2')))).not.toContain(B1)
    expect(buildingIdsOf(await request(app).get('/api/v1/sales/buildings').set(auth('sales-tl')))).toContain(B1)
    expect(buildingIdsOf(await request(app).get('/api/v1/sales/buildings').set(auth('sales-mgr')))).toContain(B1)
  })

  it('an executive cannot assign at all (403)', async () => {
    const res = await request(app).post('/api/v1/sales/assignments').set(auth('sales-se1')).send({ buildingIds: [B1], assignedToId: 'sales-se2' })
    expect(res.status).toBe(403)
  })

  it('a leader cannot assign to someone off their team (403)', async () => {
    const res = await request(app).post('/api/v1/sales/assignments').set(auth('sales-tl')).send({ buildingIds: [B1], assignedToId: 'sales-se3' })
    expect(res.status).toBe(403)
  })

  it('a manager may assign ANY registry building, not just their pool', async () => {
    // B2 has never been assigned — a manager can still hand it out.
    const res = await request(app).post('/api/v1/sales/assignments').set(auth('sales-mgr')).send({ buildingIds: [B2], assignedToId: 'sales-tl' })
    expect(res.status).toBe(200)
  })

  it('a team leader is still limited to their own pool (400 for an unassigned building)', async () => {
    // B3 is unassigned and not in sales-tl's pool.
    const res = await request(app).post('/api/v1/sales/assignments').set(auth('sales-tl')).send({ buildingIds: [B3], assignedToId: 'sales-se1' })
    expect(res.status).toBe(400)
  })

  it('registry search: a manager finds buildings by name; a team leader is refused', async () => {
    const mgr = await request(app).get('/api/v1/sales/search-buildings?q=SALES-B').set(auth('sales-mgr'))
    expect(mgr.status).toBe(200)
    expect(mgr.body.data.map((b) => b.id)).toEqual(expect.arrayContaining([B1, B3]))
    expect((await request(app).get('/api/v1/sales/search-buildings?q=SALES-B').set(auth('sales-tl'))).status).toBe(403)
    expect((await request(app).get('/api/v1/sales/search-buildings?q=x').set(auth('sales-mgr'))).status).toBe(400)
  })

  it('rejects a non-sales assignee (400)', async () => {
    const res = await request(app).post('/api/v1/sales/assignments').set(auth('test-admin')).send({ buildingIds: [B1], assignedToId: 'test-surveyor' })
    expect(res.status).toBe(400)
  })

  it('history is visible in-scope and 404 out of scope', async () => {
    const mine = await request(app).get(`/api/v1/sales/assignments?buildingId=${B1}`).set(auth('sales-mgr'))
    expect(mine.status).toBe(200)
    // mgr -> tl -> se1: three rows, newest first, only one ACTIVE.
    expect(mine.body.data.length).toBe(3)
    expect(mine.body.data.filter((a) => a.status === 'ACTIVE')).toHaveLength(1)
    expect(mine.body.data[0].assignedTo.id).toBe('sales-se1')

    const other = await request(app).get(`/api/v1/sales/assignments?buildingId=${B1}`).set(auth('sales-se3'))
    expect(other.status).toBe(404)
  })

  it('an executive cannot reach a building they do not hold by id — it simply is not in their list', async () => {
    const se2 = await request(app).get('/api/v1/sales/buildings').set(auth('sales-se2'))
    expect(se2.status).toBe(200)
    expect(buildingIdsOf(se2)).toEqual([]) // se2 holds nothing
  })
})

describe('field-sales team picker + hierarchy creation', () => {
  const idsOf = (res) => res.body.data.map((u) => u.id)

  it('the target picker is scoped to the actor\'s own reports', async () => {
    const mgr = await request(app).get('/api/v1/sales/team').set(auth('sales-mgr'))
    expect(mgr.status).toBe(200)
    expect(idsOf(mgr).sort()).toEqual(['sales-se1', 'sales-se2', 'sales-tl'])

    const tl = await request(app).get('/api/v1/sales/team').set(auth('sales-tl'))
    expect(idsOf(tl).sort()).toEqual(['sales-se1', 'sales-se2'])

    const admin = await request(app).get('/api/v1/sales/team').set(auth('test-admin'))
    expect(idsOf(admin)).toEqual(expect.arrayContaining(['sales-mgr', 'sales-tl', 'sales-se1', 'sales-se3']))
  })

  it('an executive cannot open the team picker (403)', async () => {
    expect((await request(app).get('/api/v1/sales/team').set(auth('sales-se1'))).status).toBe(403)
  })

  it('creates a sales executive under a manager + team leader', async () => {
    const res = await request(app).post('/api/v1/users').set(auth('test-admin')).send({
      name: 'New Exec',
      email: 'sales-made-1@vitest.local',
      password: 'Passw0rd1',
      role: 'SALES_EXECUTIVE',
      managerId: 'sales-mgr',
      teamLeaderId: 'sales-tl',
    })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ role: 'SALES_EXECUTIVE', managerId: 'sales-mgr', teamLeaderId: 'sales-tl' })
  })

  it('rejects a hierarchy that points at the wrong role (400)', async () => {
    const res = await request(app).post('/api/v1/users').set(auth('test-admin')).send({
      name: 'Bad Exec',
      email: 'sales-made-2@vitest.local',
      password: 'Passw0rd1',
      role: 'SALES_EXECUTIVE',
      managerId: 'sales-tl', // a team leader, not a manager
    })
    expect(res.status).toBe(400)
  })

  it('clears the hierarchy for a non-sales role', async () => {
    const res = await request(app).post('/api/v1/users').set(auth('test-admin')).send({
      name: 'A Surveyor',
      email: 'sales-made-3@vitest.local',
      password: 'Passw0rd1',
      role: 'SURVEYOR',
      managerId: 'sales-mgr', // should be ignored / cleared
    })
    expect(res.status).toBe(201)
    expect(res.body.data.managerId).toBeNull()
  })
})

describe('field-sales visit tracking (check-in / activity / inquiry / check-out)', () => {
  // By here B1 is held by sales-se1.
  const IN = { checkInLat: 18.5, checkInLng: 73.8, selfieUrl: 'https://cdn/selfie.jpg' }
  let visitId

  it('cannot check in without a location or selfie (400)', async () => {
    expect((await request(app).post('/api/v1/sales/visits').set(auth('sales-se1')).send({ buildingId: B1 })).status).toBe(400)
    expect(
      (await request(app).post('/api/v1/sales/visits').set(auth('sales-se1')).send({ buildingId: B1, checkInLat: 18.5, checkInLng: 73.8 })).status,
    ).toBe(400) // no selfie
  })

  it('cannot check in to a building not in scope (404)', async () => {
    expect((await request(app).post('/api/v1/sales/visits').set(auth('sales-se3')).send({ buildingId: B1, ...IN })).status).toBe(404)
  })

  it('checks in with location + selfie', async () => {
    const res = await request(app).post('/api/v1/sales/visits').set(auth('sales-se1')).send({ buildingId: B1, ...IN })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ buildingId: B1, userId: 'sales-se1', checkInLat: 18.5, selfieUrl: 'https://cdn/selfie.jpg', checkOutAt: null })
    visitId = res.body.data.id
  })

  it('refuses a second open visit until checkout (409)', async () => {
    expect((await request(app).post('/api/v1/sales/visits').set(auth('sales-se1')).send({ buildingId: B1, ...IN })).status).toBe(409)
  })

  it('logs multiple activities on the open visit', async () => {
    for (const type of ['DESK', 'UMBRELLA']) {
      const res = await request(app).post(`/api/v1/sales/visits/${visitId}/activities`).set(auth('sales-se1')).send({ type })
      expect(res.status).toBe(201)
    }
    expect((await request(app).post(`/api/v1/sales/visits/${visitId}/activities`).set(auth('sales-se1')).send({ type: 'NOPE' })).status).toBe(400)
    // someone else's visit is a 404
    expect((await request(app).post(`/api/v1/sales/visits/${visitId}/activities`).set(auth('sales-se2')).send({ type: 'LIFT' })).status).toBe(404)
  })

  it('raises an inquiry linked to the open visit, snapshotting the address', async () => {
    const res = await request(app)
      .post('/api/v1/sales/inquiries')
      .set(auth('sales-se1'))
      .send({ buildingId: B1, customerName: 'Asha', phone: '9876543210', visitId })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ buildingId: B1, createdById: 'sales-se1', customerName: 'Asha', address: 'sales-b1 road', visitId })
  })

  it('checks out with a location, then rejects further activity', async () => {
    const res = await request(app).post(`/api/v1/sales/visits/${visitId}/checkout`).set(auth('sales-se1')).send({ checkOutLat: 18.6, checkOutLng: 73.9 })
    expect(res.status).toBe(200)
    expect(res.body.data.checkOutAt).toBeTruthy()
    expect((await request(app).post(`/api/v1/sales/visits/${visitId}/activities`).set(auth('sales-se1')).send({ type: 'LIFT' })).status).toBe(400)
  })

  it('the visit record carries its activities + inquiry, and stays team-scoped', async () => {
    const se = await request(app).get('/api/v1/sales/visits').set(auth('sales-se1'))
    const v = se.body.data.find((x) => x.id === visitId)
    expect(v.activities.map((a) => a.type)).toEqual(['DESK', 'UMBRELLA'])
    expect(v.inquiries.map((i) => i.customerName)).toEqual(['Asha'])
    expect(v.checkOutAt).toBeTruthy()

    const mgr = await request(app).get('/api/v1/sales/visits').set(auth('sales-mgr'))
    expect(mgr.body.data.some((x) => x.userId === 'sales-se1')).toBe(true)
    const other = await request(app).get('/api/v1/sales/visits').set(auth('sales-mgr2'))
    expect(other.body.data.some((x) => x.userId === 'sales-se1')).toBe(false)
  })
})

describe('field-sales dashboard', () => {
  // By here sales-se1 has exactly 1 visit + 1 inquiry (on B1); nobody else has any.
  it('a manager sees team totals + per-person activity', async () => {
    const res = await request(app).get('/api/v1/sales/dashboard').set(auth('sales-mgr'))
    expect(res.status).toBe(200)
    expect(res.body.data.totals).toEqual({ visits: 1, inquiries: 1 })
    expect(res.body.data.team.find((u) => u.id === 'sales-se1')).toMatchObject({ visits: 1, inquiries: 1 })
    // the whole team is listed, including members with no activity
    expect(res.body.data.team.map((u) => u.id)).toEqual(expect.arrayContaining(['sales-se1', 'sales-se2', 'sales-tl']))
    expect(res.body.data.team.find((u) => u.id === 'sales-se2')).toMatchObject({ visits: 0, inquiries: 0 })
  })

  it('a leader sees only their executives', async () => {
    const res = await request(app).get('/api/v1/sales/dashboard').set(auth('sales-tl'))
    expect(res.status).toBe(200)
    expect(res.body.data.team.map((u) => u.id)).toEqual(expect.arrayContaining(['sales-se1', 'sales-se2']))
    expect(res.body.data.team.every((u) => u.role === 'SALES_EXECUTIVE')).toBe(true)
    expect(res.body.data.totals).toEqual({ visits: 1, inquiries: 1 })
  })

  it('another team sees none of it', async () => {
    const res = await request(app).get('/api/v1/sales/dashboard').set(auth('sales-mgr2'))
    expect(res.body.data.totals).toEqual({ visits: 0, inquiries: 0 })
    expect(res.body.data.team.some((u) => u.id === 'sales-se1')).toBe(false)
  })

  it('an executive cannot open the dashboard (403)', async () => {
    expect((await request(app).get('/api/v1/sales/dashboard').set(auth('sales-se1'))).status).toBe(403)
  })

  it('a future date range shows nothing', async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString()
    const res = await request(app).get(`/api/v1/sales/dashboard?from=${tomorrow}`).set(auth('sales-mgr'))
    expect(res.body.data.totals).toEqual({ visits: 0, inquiries: 0 })
  })

  it('filtering by a specific executive narrows the totals', async () => {
    const a = await request(app).get('/api/v1/sales/dashboard?userId=sales-se1').set(auth('sales-mgr'))
    expect(a.body.data.totals).toEqual({ visits: 1, inquiries: 1 })
    const b = await request(app).get('/api/v1/sales/dashboard?userId=sales-se2').set(auth('sales-mgr'))
    expect(b.body.data.totals).toEqual({ visits: 0, inquiries: 0 })
  })
})
