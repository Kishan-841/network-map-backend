import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { addDays, istToday } from '../src/lib/visit-plan.js'

/**
 * Visit plan (spec 2026-10-07): preview matches names and expands repeats
 * without writing; import re-checks and saves in one transaction.
 */
const app = createApp()
const auth = (id, role) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })
const S = `vtp-${Date.now()}`
const [MGR, TL, TL2, SE, SE2, SE3] = ['mgr', 'tl', 'tl2', 'se', 'se2', 'se3'].map((s) => `${S}-${s}`)
const B1 = `${S}-b1`, B2 = `${S}-b2`, B3 = `${S}-b3`
const today = istToday()
const none = [false, false, false, false, false, false, false]
const everyDay = [true, true, true, true, true, true, true]
const USERS = [SE, SE2, SE3, TL, TL2, MGR]

beforeAll(async () => {
  const mk = (id, role, extra = {}) => prisma.user.create({ data: { id, name: id, email: `${id}@v.local`, passwordHash: 'x', role, ...extra } })
  await mk(MGR, 'SALES_MANAGER')
  await mk(TL, 'TEAM_LEADER', { managerId: MGR })
  await mk(TL2, 'TEAM_LEADER', { managerId: MGR })
  await mk(SE, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL })
  await mk(SE2, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL2 })
  await mk(SE3, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL })
  for (const [id, name] of [[B1, `${S} Silver Oak`], [B2, `${S} Sunit Apartment`], [B3, `${S} Shared Plaza`]]) {
    await prisma.building.create({ data: { id, buildingName: name, formattedAddress: `${name}, Test`, latitude: 18.6, longitude: 73.79, source: 'COVERAGE', createdById: MGR } })
  }
})
afterAll(async () => {
  await prisma.visitTask.deleteMany({ where: { OR: [{ assigneeId: { in: USERS } }, { buildingId: { in: [B1, B2, B3] } }] } })
  await prisma.taskUpload.deleteMany({ where: { uploadedById: { in: USERS } } })
  await prisma.buildingVisit.deleteMany({ where: { OR: [{ userId: { in: USERS } }, { buildingId: { in: [B1, B2, B3] } }] } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {})
  await prisma.buildingAssignment.deleteMany({ where: { buildingId: { in: [B1, B2, B3] } } })
  await prisma.building.deleteMany({ where: { id: { in: [B1, B2, B3] } } })
  await prisma.user.deleteMany({ where: { id: { in: USERS } } })
})

const row = (o) => ({ rowNumber: 2, employee: SE, building: `${S} Silver Oak`, date: today, startTime: '09:30', endTime: '11:00', until: '', weekdays: none, ...o })

describe('visit plan preview + import', () => {
  it('preview matches employee (by name) and building, expands repeats, writes nothing', async () => {
    const res = await request(app).post('/api/v1/sales/tasks/preview').set(auth(MGR, 'SALES_MANAGER'))
      .send({ rows: [row({ until: addDays(today, 6), weekdays: everyDay })] })
    expect(res.status).toBe(200)
    const [r] = res.body.data.rows
    expect(r.state).toBe('ok')
    expect(r.employee.match.id).toBe(SE)
    expect(r.building.match.id).toBe(B1)
    expect(r.dates).toHaveLength(7)
    expect(res.body.data.people[0]).toMatchObject({ assigneeId: SE, tasks: 7, assigns: 1 })
    expect(await prisma.visitTask.count({ where: { assigneeId: SE } })).toBe(0)
  })

  it('flags an unknown building, a bad date, and a missing Repeat until', async () => {
    const res = await request(app).post('/api/v1/sales/tasks/preview').set(auth(MGR, 'SALES_MANAGER')).send({ rows: [
      row({ rowNumber: 2, building: 'Nowhere Towers 123' }),
      row({ rowNumber: 3, date: '31-02-2026' }),
      row({ rowNumber: 4, weekdays: everyDay, until: '' }),
    ] })
    const [a, b, c] = res.body.data.rows
    expect(a.state).toBe('fix')
    expect(b.state).toBe('error')
    expect(c.state).toBe('error')
  })

  it('a partial name is only offered, never auto-matched', async () => {
    const res = await request(app).post('/api/v1/sales/tasks/preview').set(auth(MGR, 'SALES_MANAGER'))
      .send({ rows: [row({ building: `${S} Silver` })] })
    const [r] = res.body.data.rows
    expect(r.state).toBe('fix')
    expect(r.building.match).toBeNull()
    expect(r.building.candidates.map((b) => b.id)).toContain(B1)
  })

  it("a team leader cannot plan another team's executive", async () => {
    const res = await request(app).post('/api/v1/sales/tasks/preview').set(auth(TL, 'TEAM_LEADER'))
      .send({ rows: [row({ employee: SE2 })] })
    expect(res.body.data.rows[0].employee.match).toBeNull()
    const imp = await request(app).post('/api/v1/sales/tasks/import').set(auth(TL, 'TEAM_LEADER')).send({ rows: [
      { rowNumber: 2, assigneeId: SE2, buildingId: B1, date: today, startTime: null, endTime: null, until: null, weekdays: none },
    ] })
    expect(imp.status).toBe(400)
    expect(await prisma.visitTask.count({ where: { assigneeId: SE2 } })).toBe(0)
  })

  it('a team leader naming a building outside their pool gets an error, never a write', async () => {
    const imp = await request(app).post('/api/v1/sales/tasks/import').set(auth(TL, 'TEAM_LEADER')).send({ rows: [
      { rowNumber: 2, assigneeId: SE, buildingId: B1, date: today, startTime: null, endTime: null, until: null, weekdays: none },
    ] })
    expect(imp.status).toBe(400)
    expect(await prisma.visitTask.count({ where: { assigneeId: SE } })).toBe(0)
    expect(await prisma.buildingAssignment.count({ where: { buildingId: B1 } })).toBe(0)
  })

  it('two executives needing the same building in one sheet is a 400 naming it', async () => {
    const imp = await request(app).post('/api/v1/sales/tasks/import').set(auth(MGR, 'SALES_MANAGER')).send({ rows: [
      { rowNumber: 2, assigneeId: SE, buildingId: B3, date: today, startTime: null, endTime: null, until: null, weekdays: none },
      { rowNumber: 3, assigneeId: SE3, buildingId: B3, date: today, startTime: null, endTime: null, until: null, weekdays: none },
    ] })
    expect(imp.status).toBe(400)
    expect(imp.body.error.message).toContain(`${S} Shared Plaza`)
    expect(await prisma.visitTask.count({ where: { buildingId: B3 } })).toBe(0)
    const pre = await request(app).post('/api/v1/sales/tasks/preview').set(auth(MGR, 'SALES_MANAGER')).send({ rows: [
      row({ rowNumber: 2, building: `${S} Shared Plaza` }),
      row({ rowNumber: 3, employee: SE3, building: `${S} Shared Plaza` }),
    ] })
    expect(pre.body.data.rows.map((r) => r.state)).toEqual(['error', 'error'])
  })

  it('import creates tasks and assigns the building to the executive', async () => {
    const res = await request(app).post('/api/v1/sales/tasks/import').set(auth(MGR, 'SALES_MANAGER')).send({ rows: [
      { rowNumber: 2, assigneeId: SE, buildingId: B1, date: today, startTime: '09:30', endTime: '11:00', until: addDays(today, 6), weekdays: everyDay },
    ] })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ created: 7, replaced: 0, assigned: 1 })
    const holder = await prisma.buildingAssignment.findFirst({ where: { buildingId: B1, status: 'ACTIVE' } })
    expect(holder.assignedToId).toBe(SE)
  })

  it('re-import replaces future unvisited tasks but keeps a task visited today', async () => {
    await prisma.buildingVisit.create({ data: { buildingId: B1, userId: SE, visitedAt: new Date() } })
    const res = await request(app).post('/api/v1/sales/tasks/import').set(auth(MGR, 'SALES_MANAGER')).send({ rows: [
      { rowNumber: 2, assigneeId: SE, buildingId: B2, date: today, startTime: null, endTime: null, until: addDays(today, 1), weekdays: everyDay },
    ] })
    expect(res.status).toBe(200)
    // The new sheet covers today..tomorrow: today's B1 task is visited (kept),
    // tomorrow's is replaced; B1 tasks beyond tomorrow are outside the range (kept).
    expect(res.body.data.replaced).toBe(1)
    const left = await prisma.visitTask.findMany({ where: { assigneeId: SE }, select: { buildingId: true } })
    expect(left.filter((t) => t.buildingId === B1)).toHaveLength(6)
    expect(left.filter((t) => t.buildingId === B2)).toHaveLength(2)
  })

  it("a TL assignee's building must already be in their pool (never assigned to a TL)", async () => {
    const res = await request(app).post('/api/v1/sales/tasks/preview').set(auth(MGR, 'SALES_MANAGER'))
      .send({ rows: [row({ employee: TL2, building: `${S} Sunit Apartment` })] })
    expect(res.body.data.rows[0].state).toBe('error')
    expect(res.body.data.rows[0].errors.join(' ')).toMatch(/zones/)
  })

  it('assignees, building search and upload history', async () => {
    const people = await request(app).get('/api/v1/sales/tasks/assignees').set(auth(TL, 'TEAM_LEADER'))
    expect(people.status).toBe(200)
    expect(people.body.data.map((u) => u.id).sort()).toEqual([SE, SE3].sort())
    const found = await request(app).get('/api/v1/sales/tasks/buildings').query({ q: `${S} Sil` }).set(auth(MGR, 'SALES_MANAGER'))
    expect(found.body.data.map((b) => b.id)).toEqual([B1])
    const short = await request(app).get('/api/v1/sales/tasks/buildings').query({ q: 'S' }).set(auth(MGR, 'SALES_MANAGER'))
    expect(short.body.data).toEqual([])
    const ups = await request(app).get('/api/v1/sales/tasks/uploads').set(auth(MGR, 'SALES_MANAGER'))
    expect(ups.body.data).toHaveLength(2)
    expect((await request(app).get('/api/v1/sales/tasks/uploads').set(auth(TL, 'TEAM_LEADER'))).body.data).toHaveLength(0)
  })

  it('an executive cannot preview or import (403)', async () => {
    expect((await request(app).post('/api/v1/sales/tasks/preview').set(auth(SE, 'SALES_EXECUTIVE')).send({ rows: [row()] })).status).toBe(403)
    expect((await request(app).post('/api/v1/sales/tasks/import').set(auth(SE, 'SALES_EXECUTIVE')).send({ rows: [] })).status).toBe(403)
  })
})
