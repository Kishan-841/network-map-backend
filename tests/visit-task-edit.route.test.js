import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { addDays, dateOnly, istToday } from '../src/lib/visit-plan.js'

/**
 * Visit plan single-task edits (spec 2026-10-07, phase 3): a planner may add,
 * edit, move, reassign or delete any task with no matching visit — past ones
 * included; a visited task is locked (409).
 */
const app = createApp()
const auth = (id, role) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })
const S = `vte-${Date.now()}`
const [MGR, TL, TL2, SE, SE2] = ['mgr', 'tl', 'tl2', 'se', 'se2'].map((s) => `${S}-${s}`)
const [B1, B2, B3, B4] = [1, 2, 3, 4].map((n) => `${S}-b${n}`)
const BLDS = [B1, B2, B3, B4]
const USERS = [SE, SE2, TL, TL2, MGR]
const Z = `${S}-z`
const today = istToday()
const yesterday = addDays(today, -1)
const tomorrow = addDays(today, 1)
const dayAfter = addDays(today, 2)
const tenAm = new Date(`${today}T10:00:00+05:30`)
let pastId
let visitedId
let se2TaskId

beforeAll(async () => {
  const mk = (id, role, extra = {}) => prisma.user.create({ data: { id, name: id, email: `${id}@v.local`, passwordHash: 'x', role, ...extra } })
  await mk(MGR, 'SALES_MANAGER')
  await prisma.zone.create({ data: { id: Z, name: Z, city: 'Test' } })
  await mk(TL, 'TEAM_LEADER', { managerId: MGR, assignedZones: { connect: [{ id: Z }] } })
  await mk(TL2, 'TEAM_LEADER', { managerId: MGR })
  await mk(SE, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL })
  await mk(SE2, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL2 })
  for (const [id, name] of [[B1, 'Edit One'], [B2, 'Edit Two'], [B3, 'Edit Held'], [B4, 'Edit Outside']]) {
    await prisma.building.create({ data: { id, buildingName: `${S} ${name}`, formattedAddress: `${S} ${name}, Test`,
      latitude: 18.6, longitude: 73.79, source: 'COVERAGE', createdById: MGR, zoneId: id === B3 ? Z : null } })
  }
  await prisma.buildingAssignment.create({ data: { buildingId: B2, assignedToId: SE, assignedById: MGR } })
  // B3 sits in TL's zone but another team (SE2, under TL2) holds it.
  await prisma.buildingAssignment.create({ data: { buildingId: B3, assignedToId: SE2, assignedById: MGR } })
  const t = (data) => prisma.visitTask.create({ data: { createdById: MGR, ...data } })
  pastId = (await t({ assigneeId: SE, buildingId: B2, taskDate: dateOnly(yesterday) })).id
  visitedId = (await t({ assigneeId: SE, buildingId: B2, taskDate: dateOnly(today) })).id
  se2TaskId = (await t({ assigneeId: SE2, buildingId: B3, taskDate: dateOnly(tomorrow) })).id
  await prisma.buildingVisit.create({ data: { buildingId: B2, userId: SE, visitedAt: tenAm } })
})
afterAll(async () => {
  await prisma.visitTask.deleteMany({ where: { OR: [{ assigneeId: { in: USERS } }, { buildingId: { in: BLDS } }] } })
  await prisma.buildingVisit.deleteMany({ where: { OR: [{ userId: { in: USERS } }, { buildingId: { in: BLDS } }] } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {})
  await prisma.buildingAssignment.deleteMany({ where: { buildingId: { in: BLDS } } })
  await prisma.building.deleteMany({ where: { id: { in: BLDS } } })
  await prisma.user.deleteMany({ where: { id: { in: USERS } } })
  await prisma.zone.deleteMany({ where: { id: Z } })
})

const base = '/api/v1/sales/tasks'
const post = (body, id = MGR, role = 'SALES_MANAGER') => request(app).post(base).set(auth(id, role)).send(body)
const patch = (taskId, body, id = TL, role = 'TEAM_LEADER') => request(app).patch(`${base}/${taskId}`).set(auth(id, role)).send(body)
const del = (taskId, id = TL, role = 'TEAM_LEADER') => request(app).delete(`${base}/${taskId}`).set(auth(id, role))
const holder = async (buildingId) =>
  (await prisma.buildingAssignment.findFirst({ where: { buildingId, status: 'ACTIVE' } }))?.assignedToId ?? null
let addedId

describe('visit plan single-task edits', () => {
  it('a manager adds a task for an executive — 201, and the executive now holds the building', async () => {
    expect(await holder(B1)).toBeNull()
    const res = await post({ assigneeId: SE, buildingId: B1, taskDate: tomorrow, startTime: null, endTime: null })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ assigneeId: SE, buildingId: B1, taskDate: tomorrow, startTime: null, endTime: null })
    expect(res.body.data.building.buildingName).toBe(`${S} Edit One`)
    expect(await holder(B1)).toBe(SE)
    addedId = res.body.data.id
  })

  it('the same task again is a 409 (exact duplicate)', async () => {
    const res = await post({ assigneeId: SE, buildingId: B1, taskDate: tomorrow, startTime: null, endTime: null })
    expect(res.status).toBe(409)
  })

  it("the executive's team leader moves it to the day after — 200", async () => {
    const res = await patch(addedId, { taskDate: dayAfter, startTime: '09:00', endTime: '10:30' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: addedId, taskDate: dayAfter, startTime: '09:00', endTime: '10:30' })
  })

  it("a team leader cannot touch another team's task — 404", async () => {
    expect((await patch(se2TaskId, { taskDate: dayAfter })).status).toBe(404)
    expect((await del(se2TaskId)).status).toBe(404)
  })

  it('a team leader cannot plan a building another team holds, nor one outside their pool', async () => {
    const held = await post({ assigneeId: SE, buildingId: B3, taskDate: tomorrow, startTime: null, endTime: null }, TL, 'TEAM_LEADER')
    expect(held.status).toBe(400)
    expect(await holder(B3)).toBe(SE2)
    const outside = await post({ assigneeId: SE, buildingId: B4, taskDate: tomorrow, startTime: null, endTime: null }, TL, 'TEAM_LEADER')
    expect(outside.status).toBe(404)
    expect(await holder(B4)).toBeNull()
  })

  it('a missed task (yesterday, no visit) is rescheduled to tomorrow — 200', async () => {
    const res = await patch(pastId, { taskDate: tomorrow })
    expect(res.status).toBe(200)
    expect(res.body.data.taskDate).toBe(tomorrow)
  })

  it('a visited task is locked — PATCH and DELETE are 409', async () => {
    const p = await patch(visitedId, { taskDate: tomorrow })
    expect(p.status).toBe(409)
    expect(p.body.error.message).toMatch(/has a visit/)
    expect((await del(visitedId)).status).toBe(409)
    expect((await prisma.visitTask.findUnique({ where: { id: visitedId } })).taskDate.toISOString().slice(0, 10)).toBe(today)
  })

  it('a new task may not take the visit of an already visited task — 409', async () => {
    // A 09:00–11:00 window holds the 10:00 visit and would win it from the all-day task.
    const res = await post({ assigneeId: SE, buildingId: B2, taskDate: today, startTime: '09:00', endTime: '11:00' })
    expect(res.status).toBe(409)
  })

  it('an unvisited task is deleted — 200', async () => {
    const res = await del(addedId)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ deleted: true })
    expect(await prisma.visitTask.findUnique({ where: { id: addedId } })).toBeNull()
  })

  it('a window whose end is not after its start, or half a window, is a 400', async () => {
    expect((await post({ assigneeId: SE, buildingId: B1, taskDate: tomorrow, startTime: '11:00', endTime: '10:00' })).status).toBe(400)
    expect((await post({ assigneeId: SE, buildingId: B1, taskDate: tomorrow, startTime: '11:00', endTime: '11:00' })).status).toBe(400)
    expect((await post({ assigneeId: SE, buildingId: B1, taskDate: tomorrow, startTime: '11:00', endTime: null })).status).toBe(400)
    expect((await patch(pastId, { endTime: '08:00', startTime: '09:00' })).status).toBe(400)
  })

  it('an impossible day or an empty patch is a 400', async () => {
    expect((await post({ assigneeId: SE, buildingId: B1, taskDate: '2026-02-30', startTime: null, endTime: null })).status).toBe(400)
    expect((await patch(pastId, {})).status).toBe(400)
  })

  it('nothing is planned backwards: a create or move to a past day is a 400', async () => {
    expect((await post({ assigneeId: SE, buildingId: B1, taskDate: yesterday, startTime: null, endTime: null })).status).toBe(400)
    const future = await prisma.visitTask.create({ data: { assigneeId: SE, buildingId: B1, taskDate: dateOnly(dayAfter), createdById: MGR } })
    expect((await patch(future.id, { taskDate: yesterday })).status).toBe(400)
    // A missed task left in the past may not be edited in place either…
    const missed = await prisma.visitTask.create({ data: { assigneeId: SE, buildingId: B1, taskDate: dateOnly(addDays(today, -2)), createdById: MGR } })
    expect((await patch(missed.id, { startTime: '09:00', endTime: '10:00' })).status).toBe(400)
    // …but it can be deleted.
    expect((await del(missed.id)).status).toBe(200)
  })

  it('an executive cannot add a task — 403', async () => {
    const res = await post({ assigneeId: SE, buildingId: B1, taskDate: tomorrow, startTime: null, endTime: null }, SE, 'SALES_EXECUTIVE')
    expect(res.status).toBe(403)
  })
})
