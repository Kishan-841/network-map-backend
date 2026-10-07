import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { addDays, dateOnly, istToday } from '../src/lib/visit-plan.js'

/**
 * Visit plan read API (spec 2026-10-07): tasks with live status from
 * check-ins, off-plan visits, overdue list; scoped like the sales hierarchy.
 * Fixtures are all-day tasks relative to today (IST) so the result does not
 * depend on the time of day; window cases live in visit-task-status.test.js.
 */
const app = createApp()
const auth = (id, role) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })
const S = `vtr-${Date.now()}`
const [MGR, TL, TL2, SE, SE2, SV] = ['mgr', 'tl', 'tl2', 'se', 'se2', 'sv'].map((s) => `${S}-${s}`)
const [B1, B2] = [`${S}-b1`, `${S}-b2`]
const USERS = [SE, SE2, TL, TL2, MGR, SV]
const today = istToday()
const yesterday = addDays(today, -1)
const tomorrow = addDays(today, 1)
const midday = new Date(`${today}T12:00:00+05:30`)

beforeAll(async () => {
  const mk = (id, role, extra = {}) => prisma.user.create({ data: { id, name: id, email: `${id}@v.local`, passwordHash: 'x', role, ...extra } })
  await mk(MGR, 'SALES_MANAGER')
  await mk(SV, 'SURVEYOR')
  await mk(TL, 'TEAM_LEADER', { managerId: MGR })
  await mk(TL2, 'TEAM_LEADER', { managerId: MGR })
  await mk(SE, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL })
  await mk(SE2, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL2 })
  for (const [id, name] of [[B1, 'Read One'], [B2, 'Read Two']]) {
    await prisma.building.create({ data: { id, buildingName: `${S} ${name}`, formattedAddress: `${S} ${name}, Test`,
      latitude: 18.6, longitude: 73.79, source: 'COVERAGE', createdById: MGR } })
  }
  const t = (taskDate) => prisma.visitTask.create({ data: { assigneeId: SE, buildingId: B1, taskDate: dateOnly(taskDate), createdById: MGR } })
  await t(yesterday)
  await t(today)
  await t(tomorrow)
  await prisma.buildingVisit.create({ data: { buildingId: B1, userId: SE, visitedAt: midday } })
  await prisma.buildingVisit.create({ data: { buildingId: B2, userId: SE, visitedAt: midday } })
})
afterAll(async () => {
  await prisma.visitTask.deleteMany({ where: { OR: [{ assigneeId: { in: USERS } }, { buildingId: { in: [B1, B2] } }] } })
  await prisma.buildingVisit.deleteMany({ where: { OR: [{ userId: { in: USERS } }, { buildingId: { in: [B1, B2] } }] } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {})
  await prisma.building.deleteMany({ where: { id: { in: [B1, B2] } } })
  await prisma.user.deleteMany({ where: { id: { in: USERS } } })
})

const get = (path, id, role) => request(app).get(`/api/v1/sales/tasks${path}`).set(auth(id, role))
const range = `from=${yesterday}&to=${tomorrow}`

describe('visit plan read API', () => {
  it('an executive reads their own tasks with live status and off-plan visits', async () => {
    const res = await get(`?${range}`, SE, 'SALES_EXECUTIVE')
    expect(res.status).toBe(200)
    const { tasks, offPlan } = res.body.data
    expect(tasks.map((t) => [t.taskDate, t.status])).toEqual([
      [yesterday, 'OVERDUE'], [today, 'VISITED'], [tomorrow, 'UPCOMING'],
    ])
    expect(tasks[1].visit).toMatchObject({ visitedAt: midday.toISOString(), checkOutAt: null })
    expect(tasks[0].building.buildingName).toBe(`${S} Read One`)
    expect(offPlan).toHaveLength(1)
    expect(offPlan[0]).toMatchObject({ userId: SE, buildingId: B2, buildingName: `${S} Read Two`, day: today })
  })

  it('defaults to today for the actor', async () => {
    const res = await get('', SE, 'SALES_EXECUTIVE')
    expect(res.status).toBe(200)
    expect(res.body.data.tasks.map((t) => t.taskDate)).toEqual([today])
  })

  it("an executive cannot read another executive's tasks — 404", async () => {
    expect((await get(`?userId=${SE2}`, SE, 'SALES_EXECUTIVE')).status).toBe(404)
  })

  it('a team leader reads their own executive, not another team', async () => {
    const own = await get(`?userId=${SE}&${range}`, TL, 'TEAM_LEADER')
    expect(own.status).toBe(200)
    expect(own.body.data.tasks).toHaveLength(3)
    expect((await get(`?userId=${SE2}`, TL, 'TEAM_LEADER')).status).toBe(404)
  })

  it('a manager reads an executive under them', async () => {
    const res = await get(`?userId=${SE}&${range}`, MGR, 'SALES_MANAGER')
    expect(res.status).toBe(200)
    expect(res.body.data.tasks).toHaveLength(3)
  })

  it('/overdue returns only the missed task', async () => {
    const res = await get('/overdue', SE, 'SALES_EXECUTIVE')
    expect(res.status).toBe(200)
    expect(res.body.data.map((t) => [t.taskDate, t.status])).toEqual([[yesterday, 'OVERDUE']])
    expect((await get(`/overdue?userId=${SE2}`, SE, 'SALES_EXECUTIVE')).status).toBe(404)
  })

  it('a range over 62 days, a reversed range or a bad date is a 400', async () => {
    expect((await get(`?from=${today}&to=${addDays(today, 63)}`, SE, 'SALES_EXECUTIVE')).status).toBe(400)
    expect((await get(`?from=${today}&to=${yesterday}`, SE, 'SALES_EXECUTIVE')).status).toBe(400)
    expect((await get('?from=03-11-2026', SE, 'SALES_EXECUTIVE')).status).toBe(400)
  })

  it('a non-sales role is refused', async () => {
    expect((await get('', SV, 'SURVEYOR')).status).toBe(403)
  })
})
