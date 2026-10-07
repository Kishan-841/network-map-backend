import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { dateOnly, istToday } from '../src/lib/visit-plan.js'

/**
 * Owner decision (7 Oct): a team leader's check-in that lists an executive as
 * a companion counts as that executive's visit for task matching — everywhere
 * "has a matching visit" is used (status, edit lock, import keep, handover).
 * A companion visit that matches none of the executive's tasks is NOT their
 * off-plan visit (it's the TL's; they can't open it).
 */
const app = createApp()
const auth = (id, role) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })
const S = `vtc-${Date.now()}`
const [MGR, TL, SE, SE2] = ['mgr', 'tl', 'se', 'se2'].map((s) => `${S}-${s}`)
const [X, Y] = ['x', 'y'].map((s) => `${S}-${s}`)
const USERS = [SE, SE2, TL, MGR]
const BLDS = [X, Y]
const today = istToday()
const none = [false, false, false, false, false, false, false]
const mgr = auth(MGR, 'SALES_MANAGER')
let seTask
let tlTask
let visitX
let visitY

beforeAll(async () => {
  const mk = (id, role, extra = {}) => prisma.user.create({ data: { id, name: id, email: `${id}@v.local`, passwordHash: 'x', role, ...extra } })
  await mk(MGR, 'SALES_MANAGER')
  await mk(TL, 'TEAM_LEADER', { managerId: MGR })
  await mk(SE, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL })
  await mk(SE2, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL })
  for (const id of BLDS) {
    await prisma.building.create({ data: { id, buildingName: `${S} ${id}`, formattedAddress: `${S} ${id}, Test`,
      latitude: 18.6, longitude: 73.79, source: 'COVERAGE', createdById: MGR } })
  }
  await prisma.buildingAssignment.create({ data: { buildingId: X, assignedToId: SE, assignedById: MGR } })
  seTask = (await prisma.visitTask.create({ data: { assigneeId: SE, buildingId: X, taskDate: dateOnly(today), createdById: MGR } })).id
  tlTask = (await prisma.visitTask.create({ data: { assigneeId: TL, buildingId: X, taskDate: dateOnly(today), createdById: MGR } })).id
  const now = new Date()
  visitX = (await prisma.buildingVisit.create({ data: { buildingId: X, userId: TL, visitedAt: now, companions: { create: [{ userId: SE }] } } })).id
  visitY = (await prisma.buildingVisit.create({ data: { buildingId: Y, userId: TL, visitedAt: now, companions: { create: [{ userId: SE }] } } })).id
})
afterAll(async () => {
  await prisma.visitTask.deleteMany({ where: { OR: [{ assigneeId: { in: USERS } }, { buildingId: { in: BLDS } }] } })
  await prisma.taskUpload.deleteMany({ where: { uploadedById: { in: USERS } } })
  await prisma.buildingVisit.deleteMany({ where: { OR: [{ userId: { in: USERS } }, { buildingId: { in: BLDS } }] } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {})
  await prisma.buildingAssignment.deleteMany({ where: { buildingId: { in: BLDS } } })
  await prisma.building.deleteMany({ where: { id: { in: BLDS } } })
  await prisma.user.deleteMany({ where: { id: { in: USERS } } })
})

const read = (userId, who = mgr) => request(app).get(`/api/v1/sales/tasks?userId=${userId}&from=${today}&to=${today}`).set(who)

describe('a TL visit with the executive as companion counts for the executive', () => {
  it("the executive's task at X is VISITED via the TL's visit", async () => {
    const res = await read(SE)
    expect(res.status).toBe(200)
    const t = res.body.data.tasks.find((x) => x.id === seTask)
    expect(t.status).toBe('VISITED')
    expect(t.visit).toMatchObject({ id: visitX, byUserId: TL, byName: TL, viaCompanion: true })
  })

  it("an unmatched companion visit is not the executive's off-plan visit", async () => {
    const res = await read(SE, auth(SE, 'SALES_EXECUTIVE'))
    expect(res.status).toBe(200)
    expect(res.body.data.offPlan.map((v) => v.id)).not.toContain(visitY)
    expect(res.body.data.offPlan).toHaveLength(0)
  })

  it("the TL's own view is unchanged: own visit matches own task, the other is off-plan", async () => {
    const res = await read(TL, auth(TL, 'TEAM_LEADER'))
    const t = res.body.data.tasks.find((x) => x.id === tlTask)
    expect(t.status).toBe('VISITED')
    expect(t.visit).toMatchObject({ id: visitX, byUserId: TL, viaCompanion: false })
    expect(res.body.data.offPlan.map((v) => v.id)).toEqual([visitY])
  })

  it("the executive's companion-visited task is locked (PATCH 409)", async () => {
    const res = await request(app).patch(`/api/v1/sales/tasks/${seTask}`).set(mgr).send({ startTime: '09:00', endTime: '10:00' })
    expect(res.status).toBe(409)
  })

  it('a re-import keeps it', async () => {
    const res = await request(app).post('/api/v1/sales/tasks/import').set(mgr).send({ rows: [
      { rowNumber: 2, assigneeId: SE, buildingId: X, date: today, startTime: null, endTime: null, until: null, weekdays: none },
    ] })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ created: 0, replaced: 0 })
    expect(await prisma.visitTask.findUnique({ where: { id: seTask } })).not.toBeNull()
  })

  it("handing X to another executive keeps the executive's companion-visited task today", async () => {
    const res = await request(app).post('/api/v1/sales/assignments').set(mgr).send({ buildingIds: [X], assignedToId: SE2 })
    expect(res.status).toBe(200)
    expect(await prisma.visitTask.findUnique({ where: { id: seTask } })).not.toBeNull()
  })
})
