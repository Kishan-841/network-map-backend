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
  for (const id of [B1, B2]) {
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
  await prisma.building.deleteMany({ where: { id: { in: [B1, B2] } } }) // cascades assignments
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

  it('a manager cannot assign a building outside their pool (400)', async () => {
    // B2 is unassigned — not in sales-mgr's pool.
    const res = await request(app).post('/api/v1/sales/assignments').set(auth('sales-mgr')).send({ buildingIds: [B2], assignedToId: 'sales-tl' })
    expect(res.status).toBe(400)
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
