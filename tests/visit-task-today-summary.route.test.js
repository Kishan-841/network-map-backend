import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { addDays, dateOnly, istToday } from '../src/lib/visit-plan.js'

/**
 * Today cards on the Assign buildings page (spec 2026-11-24-sales-today-cards):
 * planned (today's visit-plan rows), done, held, checked in — for a manager's
 * team or one person in it.
 */
const app = createApp()
const auth = (id, role) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })
const S = `vts-${Date.now()}`
const [MGR, MGR2, TL, SE, SE2, SE_OFF, SE_OTHER] = ['mgr', 'mgr2', 'tl', 'se', 'se2', 'off', 'other'].map((s) => `${S}-${s}`)
const [B1, B2, B3] = [`${S}-b1`, `${S}-b2`, `${S}-b3`]
const USERS = [SE, SE2, SE_OFF, SE_OTHER, TL, MGR, MGR2]
const today = istToday()
const at = (hhmm, day = today) => new Date(`${day}T${hhmm}:00+05:30`)

beforeAll(async () => {
  const mk = (id, role, extra = {}) => prisma.user.create({ data: { id, name: id, email: `${id}@v.local`, passwordHash: 'x', role, ...extra } })
  await mk(MGR, 'SALES_MANAGER')
  await mk(MGR2, 'SALES_MANAGER')
  await mk(TL, 'TEAM_LEADER', { managerId: MGR })
  await mk(SE, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL })
  await mk(SE2, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL })
  await mk(SE_OFF, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL, isActive: false })
  await mk(SE_OTHER, 'SALES_EXECUTIVE', { managerId: MGR2 })
  for (const id of [B1, B2, B3]) {
    await prisma.building.create({ data: { id, buildingName: `${S} ${id}`, formattedAddress: `${S} ${id}, Test`,
      latitude: 18.6, longitude: 73.79, source: 'COVERAGE', createdById: MGR } })
  }
  const task = (assigneeId, buildingId, day = today) =>
    prisma.visitTask.create({ data: { assigneeId, buildingId, taskDate: dateOnly(day), createdById: MGR } })
  await task(SE, B1)
  await task(SE, B2)
  await task(SE, B3, addDays(today, 1))
  await task(SE_OFF, B3)
  const hold = (assignedToId, buildingId) => prisma.buildingAssignment.create({ data: { buildingId, assignedToId, assignedById: MGR } })
  await hold(SE, B1)
  await hold(SE, B2)
  await hold(SE_OFF, B3)
  // SE's own check-in; TL's visit with SE and SE2 along; TL also visited late yesterday.
  await prisma.buildingVisit.create({ data: { buildingId: B1, userId: SE, visitedAt: at('12:00') } })
  await prisma.buildingVisit.create({ data: { buildingId: B2, userId: TL, visitedAt: at('13:00'),
    companions: { create: [{ userId: SE }, { userId: SE2 }] } } })
  await prisma.buildingVisit.create({ data: { buildingId: B1, userId: TL, visitedAt: at('23:30', addDays(today, -1)) } })
})
afterAll(async () => {
  const visits = await prisma.buildingVisit.findMany({ where: { userId: { in: USERS } }, select: { id: true } })
  await prisma.visitCompanion.deleteMany({ where: { visitId: { in: visits.map((v) => v.id) } } })
  await prisma.buildingVisit.deleteMany({ where: { userId: { in: USERS } } })
  await prisma.visitTask.deleteMany({ where: { assigneeId: { in: USERS } } })
  await prisma.buildingAssignment.deleteMany({ where: { buildingId: { in: [B1, B2, B3] } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {})
  await prisma.building.deleteMany({ where: { id: { in: [B1, B2, B3] } } })
  await prisma.user.deleteMany({ where: { id: { in: USERS } } })
})

const get = (query, id, role) => request(app).get(`/api/v1/sales/tasks/today-summary${query}`).set(auth(id, role))

describe('today summary', () => {
  it("gives a manager their team's totals for today", async () => {
    const res = await get('', MGR, 'SALES_MANAGER')
    expect(res.status).toBe(200)
    // TL, SE, SE2 counted; SE_OFF (inactive) left out of every number.
    expect(res.body.data).toEqual({ date: today, planned: 2, done: 2, held: 2, checkedIn: 2, users: 3, user: null })
  })

  it('narrows to one person', async () => {
    const res = await get(`?userId=${SE}`, MGR, 'SALES_MANAGER')
    expect(res.status).toBe(200)
    const { user, ...counts } = res.body.data
    expect(counts).toEqual({ date: today, planned: 2, done: 2, held: 2, checkedIn: 1, users: 1 })
    expect(user).toMatchObject({ id: SE, name: SE, role: 'SALES_EXECUTIVE' })
    expect(new Date(user.firstCheckInAt).getTime()).toBe(at('12:00').getTime())
  })

  it('does not count coming along on a visit as checking in', async () => {
    const res = await get(`?userId=${SE2}`, MGR, 'SALES_MANAGER')
    expect(res.body.data).toMatchObject({ checkedIn: 0, users: 1, user: { id: SE2, firstCheckInAt: null } })
  })

  it("uses today's own first check-in, not last night's", async () => {
    const res = await get(`?userId=${TL}`, MGR, 'SALES_MANAGER')
    expect(res.body.data).toMatchObject({ planned: 0, done: 0, checkedIn: 1, user: { id: TL } })
    expect(new Date(res.body.data.user.firstCheckInAt).getTime()).toBe(at('13:00').getTime())
  })

  it("answers 404 for someone outside the manager's team or inactive", async () => {
    expect((await get(`?userId=${SE_OTHER}`, MGR, 'SALES_MANAGER')).status).toBe(404)
    expect((await get(`?userId=${SE_OFF}`, MGR, 'SALES_MANAGER')).status).toBe(404)
  })

  it('is for admins and sales managers only', async () => {
    expect((await get('', TL, 'TEAM_LEADER')).status).toBe(403)
    expect((await get('', SE, 'SALES_EXECUTIVE')).status).toBe(403)
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, select: { id: true } })
    const res = await get('', admin.id, 'ADMIN')
    expect(res.status).toBe(200)
    for (const k of ['planned', 'done', 'held', 'checkedIn', 'users']) expect(typeof res.body.data[k]).toBe('number')
  })
})
