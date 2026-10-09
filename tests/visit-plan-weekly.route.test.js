import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { addDays, dateOnly, istToday, weekdayIndex } from '../src/lib/visit-plan.js'

/**
 * Visit plan, 9 Oct (brief .superpowers/sdd/2026-10-09-weekly-plan/design.md):
 * weekly sheet rows (`repeatWeeks`), series edits (scope ONE | FOLLOWING) and
 * undoing an upload.
 */
const app = createApp()
const auth = (id, role) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })
const S = `vpw-${Date.now()}`
const [MGR, TL, TL2, SE, SE2, SE3, SE4, SE5] = ['mgr', 'tl', 'tl2', 'se', 'se2', 'se3', 'se4', 'se5'].map((s) => `${S}-${s}`)
const BLDS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${S}-b${n}`)
const [B1, B2, B3, B4, B5, B6, B7, B8] = BLDS
const USERS = [SE, SE2, SE3, SE4, SE5, TL, TL2, MGR]
const Z = `${S}-z`
const today = istToday()
const d = addDays(today, 2)
const none = [false, false, false, false, false, false, false]
const tenAm = new Date(`${today}T10:00:00+05:30`)
const base = '/api/v1/sales/tasks'
const MGR_AUTH = auth(MGR, 'SALES_MANAGER')

beforeAll(async () => {
  const mk = (id, role, extra = {}) => prisma.user.create({ data: { id, name: id, email: `${id}@v.local`, passwordHash: 'x', role, ...extra } })
  await mk(MGR, 'SALES_MANAGER')
  await prisma.zone.create({ data: { id: Z, name: Z, city: 'Test' } })
  await mk(TL, 'TEAM_LEADER', { managerId: MGR, assignedZones: { connect: [{ id: Z }] } })
  await mk(TL2, 'TEAM_LEADER', { managerId: MGR })
  await mk(SE, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL })
  await mk(SE2, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL2 })
  await mk(SE3, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL })
  await mk(SE4, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL })
  await mk(SE5, 'SALES_EXECUTIVE', { managerId: MGR, teamLeaderId: TL })
  for (const [i, id] of BLDS.entries()) {
    await prisma.building.create({ data: { id, buildingName: `${S} Weekly ${i + 1}`, formattedAddress: `${S} Weekly ${i + 1}, Test`,
      latitude: 18.6, longitude: 73.79, source: 'COVERAGE', createdById: MGR, zoneId: id === B8 ? Z : null } })
  }
})
afterAll(async () => {
  await prisma.visitTask.deleteMany({ where: { OR: [{ assigneeId: { in: USERS } }, { buildingId: { in: BLDS } }] } })
  await prisma.taskUpload.deleteMany({ where: { uploadedById: { in: USERS } } })
  await prisma.buildingVisit.deleteMany({ where: { OR: [{ userId: { in: USERS } }, { buildingId: { in: BLDS } }] } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {})
  await prisma.buildingAssignment.deleteMany({ where: { buildingId: { in: BLDS } } })
  await prisma.building.deleteMany({ where: { id: { in: BLDS } } })
  await prisma.user.deleteMany({ where: { id: { in: USERS } } })
  await prisma.zone.deleteMany({ where: { id: Z } })
})

const weekly = (o) => ({ rowNumber: 2, employee: SE, building: `${S} Weekly 1`, date: d, startTime: '09:00', endTime: '10:00', repeatWeeks: '4', ...o })
const preview = (rows, h = MGR_AUTH) => request(app).post(`${base}/preview`).set(h).send({ rows })
const imp = (rows, h = MGR_AUTH, fileName = 'weekly.xlsx') => request(app).post(`${base}/import`).set(h).send({ fileName, rows })
const impRow = (o) => ({ rowNumber: 2, assigneeId: SE, buildingId: B1, date: d, startTime: '09:00', endTime: '10:00', repeatWeeks: 4, ...o })
const tasksOf = (assigneeId) => prisma.visitTask.findMany({ where: { assigneeId }, orderBy: { taskDate: 'asc' } })
const day = (t) => t.taskDate.toISOString().slice(0, 10)
// The audit row is written on 'finish', just after the response — poll briefly.
async function logOf(where) {
  for (let i = 0; i < 20; i++) {
    const log = await prisma.systemLog.findFirst({ where, orderBy: { createdAt: 'desc' } })
    if (log) return log
    await new Promise((r) => setTimeout(r, 50))
  }
  return null
}
const patch = (id, body, h = MGR_AUTH) => request(app).patch(`${base}/${id}`).set(h).send(body)
const del = (id, scope, h = MGR_AUTH) => request(app).delete(`${base}/${id}${scope ? `?scope=${scope}` : ''}`).set(h)

describe('weekly sheet rows', () => {
  it('Repeat 4 → exactly 4 dates on the same weekday, with count and range', async () => {
    const res = await preview([weekly()])
    expect(res.status).toBe(200)
    const [r] = res.body.data.rows
    expect(r.state).toBe('ok')
    expect(r.dates).toEqual([d, addDays(d, 7), addDays(d, 14), addDays(d, 21)])
    expect(new Set(r.dates.map(weekdayIndex)).size).toBe(1)
    expect(r).toMatchObject({ repeatWeeks: 4, visitCount: 4, firstDate: d, lastDate: addDays(d, 21) })
    expect(res.body.data.people[0]).toMatchObject({ assigneeId: SE, tasks: 4, from: d, to: addDays(d, 21) })
    expect(await prisma.visitTask.count({ where: { assigneeId: SE } })).toBe(0)
  })

  it('Repeat blank or 1 → that date only; 13 is allowed', async () => {
    const res = await preview([weekly({ repeatWeeks: '' }), weekly({ rowNumber: 3, repeatWeeks: '1' }), weekly({ rowNumber: 4, repeatWeeks: 13, date: today })])
    const [a, b, c] = res.body.data.rows
    expect(a.dates).toEqual([d])
    expect(a.visitCount).toBe(1)
    expect(b.dates).toEqual([d])
    expect(c.state).toBe('ok')
    expect(c.dates).toHaveLength(13)
  })

  it('Repeat 0, 14, "x" or 2.5 is a row error', async () => {
    const res = await preview(['0', '14', 'x', '2.5'].map((v, i) => weekly({ rowNumber: i + 2, repeatWeeks: v })))
    for (const r of res.body.data.rows) {
      expect(r.state).toBe('error')
      expect(r.errors.join(' ')).toMatch(/Repeat must be a whole number of weeks, 1–13/)
    }
  })

  it('a past Date on a weekly row is a row error', async () => {
    const res = await preview([weekly({ date: addDays(today, -1) })])
    expect(res.body.data.rows[0].state).toBe('error')
    expect(res.body.data.rows[0].errors.join(' ')).toMatch(/passed/)
  })

  it('a row carrying both Repeat (weeks) and Repeat until / weekdays is an error', async () => {
    const res = await preview([
      weekly({ until: addDays(d, 14) }),
      weekly({ rowNumber: 3, weekdays: [true, false, false, false, false, false, false] }),
    ])
    for (const r of res.body.data.rows) {
      expect(r.state).toBe('error')
      expect(r.errors.join(' ')).toMatch(/one template/)
    }
  })

  it('import refuses a weekly row with a past date sent straight to it', async () => {
    const res = await imp([impRow({ date: addDays(today, -1) })])
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/passed/)
    expect(await prisma.visitTask.count({ where: { assigneeId: SE } })).toBe(0)
  })

  it('import refuses a bad repeat even when hand-crafted', async () => {
    for (const repeatWeeks of [0, 14, 'x', 2.5]) {
      const res = await imp([impRow({ repeatWeeks })])
      expect(res.status).toBe(400)
    }
    expect(await prisma.visitTask.count({ where: { assigneeId: SE } })).toBe(0)
  })

  it('monthly rows still work unchanged next to weekly ones (no repeatWeeks key)', async () => {
    const res = await preview([{ rowNumber: 2, employee: SE, building: `${S} Weekly 1`, date: d, startTime: '', endTime: '', until: '', weekdays: none }])
    expect(res.body.data.rows[0]).toMatchObject({ state: 'ok', dates: [d], repeatWeeks: null, visitCount: 1 })
  })

  it('import: every row is one series — shared within a row, distinct across rows', async () => {
    const res = await imp([impRow(), impRow({ rowNumber: 3, buildingId: B2, repeatWeeks: 2, startTime: null, endTime: null })])
    expect(res.status).toBe(200)
    expect(res.body.data.created).toBe(6)
    const tasks = await tasksOf(SE)
    const one = tasks.filter((t) => t.buildingId === B1)
    const two = tasks.filter((t) => t.buildingId === B2)
    expect(one.map(day)).toEqual([d, addDays(d, 7), addDays(d, 14), addDays(d, 21)])
    expect(two).toHaveLength(2)
    expect(new Set(one.map((t) => t.seriesId)).size).toBe(1)
    expect(new Set(two.map((t) => t.seriesId)).size).toBe(1)
    expect(one[0].seriesId).toBeTruthy()
    expect(one[0].seriesId).not.toBe(two[0].seriesId)
  })

  it('re-upload replaces only within the covered (expanded) range', async () => {
    const inside = await prisma.visitTask.create({ data: { assigneeId: SE, buildingId: B3, taskDate: dateOnly(addDays(d, 10)), createdById: MGR } })
    const outside = await prisma.visitTask.create({ data: { assigneeId: SE, buildingId: B3, taskDate: dateOnly(addDays(d, 35)), createdById: MGR } })
    const res = await imp([impRow({ repeatWeeks: 3 })])
    expect(res.status).toBe(200)
    expect(await prisma.visitTask.findUnique({ where: { id: inside.id } })).toBeNull()
    expect(await prisma.visitTask.findUnique({ where: { id: outside.id } })).not.toBeNull()
    const left = (await tasksOf(SE)).filter((t) => t.buildingId !== B3)
    // B1 × 3 (d..d+14); the old B1 d+21 is outside d..d+14 and stays; B2 rows are inside and go.
    expect(left.map(day)).toEqual([d, addDays(d, 7), addDays(d, 14), addDays(d, 21)])
  })
})

describe('series edits', () => {
  let ids
  beforeAll(async () => {
    const res = await imp([impRow({ assigneeId: SE3, buildingId: B4 })])
    expect(res.status).toBe(200)
    ids = (await tasksOf(SE3)).map((t) => t.id)
    expect(ids).toHaveLength(4)
  })

  it('task payloads carry seriesId and seriesLaterCount', async () => {
    const res = await request(app).get(base).query({ userId: SE3, from: d, to: addDays(d, 21) }).set(MGR_AUTH)
    expect(res.status).toBe(200)
    const counts = res.body.data.tasks.map((t) => t.seriesLaterCount)
    expect(counts).toEqual([3, 2, 1, 0])
    expect(res.body.data.tasks[0].seriesId).toBeTruthy()
  })

  it('FOLLOWING: a time change lands on this and every later task, not earlier ones', async () => {
    const res = await patch(ids[1], { startTime: '11:00', endTime: '12:00', scope: 'FOLLOWING' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: ids[1], startTime: '11:00', changed: 3, skipped: 0, outOfScope: 0, released: 0 })
    const tasks = await tasksOf(SE3)
    expect(tasks.map((t) => t.startTime)).toEqual(['09:00', '11:00', '11:00', '11:00'])
    // The audit log names every touched task with its date + assignee before the edit.
    const log = await logOf({ userId: MGR, action: 'TaskUpdate', recordId: ids[1] })
    expect(log.newValue).toMatchObject({ scope: 'FOLLOWING', changed: 3 })
    expect(log.newValue.tasks).toEqual(tasks.slice(1).map((t) => ({ id: t.id, taskDate: day(t), assigneeId: SE3 })))
  })

  it('FOLLOWING: a date move shifts each later task by the same days', async () => {
    const res = await patch(ids[1], { taskDate: addDays(d, 8), scope: 'FOLLOWING' })
    expect(res.status).toBe(200)
    expect(res.body.data.changed).toBe(3)
    expect((await tasksOf(SE3)).map(day)).toEqual([d, addDays(d, 8), addDays(d, 15), addDays(d, 22)])
  })

  it('FOLLOWING: one shifted date out of bounds → 400 and nothing changed', async () => {
    const before = (await tasksOf(SE3)).map(day)
    // Pushing the 2nd task 70 days on sends the last one past the 92-day limit.
    const res = await patch(ids[1], { taskDate: addDays(d, 78), scope: 'FOLLOWING' })
    expect(res.status).toBe(400)
    expect((await tasksOf(SE3)).map(day)).toEqual(before)
  })

  it('ONE (the default) changes only this task', async () => {
    const res = await patch(ids[3], { startTime: '15:00', endTime: '16:00' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ changed: 1, skipped: 0 })
    expect((await tasksOf(SE3)).map((t) => t.startTime)).toEqual(['09:00', '11:00', '11:00', '15:00'])
  })

  it('another planner out of scope → 404 for PATCH and DELETE', async () => {
    const h = auth(TL2, 'TEAM_LEADER')
    expect((await patch(ids[1], { startTime: '13:00', endTime: '14:00', scope: 'FOLLOWING' }, h)).status).toBe(404)
    expect((await del(ids[1], 'FOLLOWING', h)).status).toBe(404)
    expect(await prisma.visitTask.count({ where: { id: { in: ids } } })).toBe(4)
  })

  it('a bad scope is a 400', async () => {
    expect((await patch(ids[1], { startTime: '13:00', endTime: '14:00', scope: 'ALL' })).status).toBe(400)
    expect((await del(ids[1], 'ALL')).status).toBe(400)
    expect((await patch(ids[1], { scope: 'FOLLOWING' })).status).toBe(400)
  })

  it('DELETE FOLLOWING removes this and the later ones', async () => {
    const res = await del(ids[2], 'FOLLOWING')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ deleted: true, removed: 2, skipped: 0, outOfScope: 0 })
    expect((await tasksOf(SE3)).map((t) => t.id)).toEqual([ids[0], ids[1]])
    const log = await logOf({ userId: MGR, action: 'TaskDelete', recordId: ids[2] })
    expect(log.newValue.taskIds.sort()).toEqual([ids[2], ids[3]].sort())
  })

  it('FOLLOWING reassignment moves the tasks and hands the building over in one go', async () => {
    const holder = async () => (await prisma.buildingAssignment.findFirst({ where: { buildingId: B4, status: 'ACTIVE' } }))?.assignedToId
    expect(await holder()).toBe(SE3)
    const res = await patch(ids[0], { assigneeId: SE4, scope: 'FOLLOWING' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ assigneeId: SE4, changed: 2, skipped: 0, released: 0 })
    expect((await prisma.visitTask.findMany({ where: { id: { in: [ids[0], ids[1]] } } })).map((t) => t.assigneeId)).toEqual([SE4, SE4])
    expect(await holder()).toBe(SE4)
  })

  it('ONE reassignment of a task at a building its assignee holds keeps the task; the old holder\'s other task there is released', async () => {
    const res = await patch(ids[1], { assigneeId: SE3 })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: ids[1], assigneeId: SE3, changed: 1, released: 1 })
    expect(res.body.data.outOfScope).toBeUndefined()
    expect(await prisma.visitTask.findUnique({ where: { id: ids[0] } })).toBeNull()
  })

  it('FOLLOWING: a shifted date landing on another series\' identical task → 409, nothing changed', async () => {
    const t = (date, seriesId) => prisma.visitTask.create({ data: { assigneeId: SE4, buildingId: B6, taskDate: dateOnly(date), seriesId, createdById: MGR } })
    const a1 = await t(addDays(d, 40), `${S}-series-a`)
    const a2 = await t(addDays(d, 47), `${S}-series-a`)
    await t(addDays(d, 48), `${S}-series-b`)
    const res = await patch(a1.id, { taskDate: addDays(d, 41), scope: 'FOLLOWING' })
    expect(res.status).toBe(409)
    expect(day(await prisma.visitTask.findUnique({ where: { id: a1.id } }))).toBe(addDays(d, 40))
    expect(day(await prisma.visitTask.findUnique({ where: { id: a2.id } }))).toBe(addDays(d, 47))
  })

  it("FOLLOWING over a series partly reassigned to another team's executive leaves those alone and counts them", async () => {
    const seriesId = `${S}-series-mixed`
    const t = (assigneeId, date) => prisma.visitTask.create({ data: { assigneeId, buildingId: B8, taskDate: dateOnly(date), seriesId, createdById: MGR } })
    const first = await t(SE, addDays(d, 30))
    const other = await t(SE2, addDays(d, 37))
    const last = await t(SE, addDays(d, 44))
    const h = auth(TL, 'TEAM_LEADER')
    const res = await patch(first.id, { startTime: '14:00', endTime: '15:00', scope: 'FOLLOWING' }, h)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ changed: 2, skipped: 0, outOfScope: 1 })
    expect((await prisma.visitTask.findUnique({ where: { id: other.id } })).startTime).toBeNull()
    expect((await prisma.visitTask.findUnique({ where: { id: last.id } })).startTime).toBe('14:00')
    const gone = await del(first.id, 'FOLLOWING', h)
    expect(gone.body.data).toEqual({ deleted: true, removed: 2, skipped: 0, outOfScope: 1 })
    expect(await prisma.visitTask.findUnique({ where: { id: other.id } })).not.toBeNull()
  })

  it('a visited later task is skipped and counted (PATCH)', async () => {
    const seriesId = `${S}-series-v`
    const t = (date) => prisma.visitTask.create({ data: { assigneeId: SE4, buildingId: B5, taskDate: dateOnly(date), seriesId, createdById: MGR } })
    const missed = await t(addDays(today, -7))
    const visited = await t(today)
    const later = await t(addDays(today, 7))
    await prisma.buildingAssignment.create({ data: { buildingId: B5, assignedToId: SE4, assignedById: MGR } })
    await prisma.buildingVisit.create({ data: { buildingId: B5, userId: SE4, visitedAt: tenAm } })
    const res = await patch(missed.id, { taskDate: addDays(today, 1), scope: 'FOLLOWING' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ taskDate: addDays(today, 1), changed: 2, skipped: 1 })
    expect(day(await prisma.visitTask.findUnique({ where: { id: visited.id } }))).toBe(today)
    expect(day(await prisma.visitTask.findUnique({ where: { id: later.id } }))).toBe(addDays(today, 15))
    // Now dated tomorrow: today's visited task is no longer "later".
    const delRes = await del(missed.id, 'FOLLOWING')
    expect(delRes.body.data).toEqual({ deleted: true, removed: 2, skipped: 0, outOfScope: 0 })
    expect(await prisma.visitTask.findUnique({ where: { id: visited.id } })).not.toBeNull()
  })

  it('a legacy task with no series: FOLLOWING behaves as ONE', async () => {
    const a = await prisma.visitTask.create({ data: { assigneeId: SE4, buildingId: B6, taskDate: dateOnly(addDays(d, 1)), createdById: MGR } })
    const b = await prisma.visitTask.create({ data: { assigneeId: SE4, buildingId: B6, taskDate: dateOnly(addDays(d, 8)), createdById: MGR } })
    const res = await patch(a.id, { startTime: '10:00', endTime: '11:00', scope: 'FOLLOWING' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ seriesId: null, changed: 1, skipped: 0 })
    expect((await prisma.visitTask.findUnique({ where: { id: b.id } })).startTime).toBeNull()
    expect((await del(a.id, 'FOLLOWING')).body.data).toEqual({ deleted: true, removed: 1, skipped: 0, outOfScope: 0 })
    expect(await prisma.visitTask.findUnique({ where: { id: b.id } })).not.toBeNull()
  })
})

describe('uploads: list and remove', () => {
  let tlUpload
  let mgrUpload
  let ids
  beforeAll(async () => {
    // A team leader's upload (a building in their zone, for their executive).
    const res = await imp([impRow({ assigneeId: SE5, buildingId: B8, repeatWeeks: 2 })], auth(TL, 'TEAM_LEADER'), 'tl.xlsx')
    expect(res.status).toBe(200)
    tlUpload = res.body.data.uploadId
    // A manager's upload with history: a missed task, a visited one today, two upcoming.
    const up = await prisma.taskUpload.create({ data: { uploadedById: MGR, fromDate: dateOnly(addDays(today, -3)), toDate: dateOnly(addDays(today, 9)),
      assigneeCount: 1, created: 4, replaced: 0, assigned: 0, fileName: 'mgr.xlsx' } })
    mgrUpload = up.id
    const t = (date) => prisma.visitTask.create({ data: { assigneeId: SE2, buildingId: B7, taskDate: dateOnly(date), uploadId: up.id, createdById: MGR } })
    ids = { missed: (await t(addDays(today, -3))).id, visited: (await t(today)).id, up1: (await t(addDays(today, 2))).id, up2: (await t(addDays(today, 9))).id }
    await prisma.buildingVisit.create({ data: { buildingId: B7, userId: SE2, visitedAt: tenAm } })
  })

  it('the uploader and their manager see an upload; another team leader does not', async () => {
    const mgr = await request(app).get(`${base}/uploads`).set(MGR_AUTH)
    expect(mgr.status).toBe(200)
    const mine = mgr.body.data.find((u) => u.id === mgrUpload)
    expect(mine).toMatchObject({ fileName: 'mgr.xlsx', taskCount: 4, upcomingCount: 2, visitedCount: 1, createdBy: { id: MGR, name: MGR } })
    expect(mine.createdAt).toBeTruthy()
    expect(mgr.body.data.find((u) => u.id === tlUpload)).toMatchObject({ taskCount: 2, upcomingCount: 2, visitedCount: 0 })
    const tl = await request(app).get(`${base}/uploads`).set(auth(TL, 'TEAM_LEADER'))
    expect(tl.body.data.map((u) => u.id)).toEqual([tlUpload])
    const tl2 = await request(app).get(`${base}/uploads`).set(auth(TL2, 'TEAM_LEADER'))
    expect(tl2.body.data).toEqual([])
  })

  it('out of scope or unknown → 404, nothing removed', async () => {
    expect((await request(app).delete(`${base}/uploads/${tlUpload}`).set(auth(TL2, 'TEAM_LEADER'))).status).toBe(404)
    expect((await request(app).delete(`${base}/uploads/${S}-nope`).set(MGR_AUTH)).status).toBe(404)
    expect(await prisma.visitTask.count({ where: { uploadId: tlUpload } })).toBe(2)
  })

  it('remove keeps the visited and the missed tasks, removes the upcoming ones, audited', async () => {
    const res = await request(app).delete(`${base}/uploads/${mgrUpload}`).set(MGR_AUTH)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ removed: 2, kept: 2 })
    const left = await prisma.visitTask.findMany({ where: { uploadId: mgrUpload } })
    expect(left.map((t) => t.id).sort()).toEqual([ids.missed, ids.visited].sort())
    const log = await logOf({ userId: MGR, action: 'RemoveTaskUpload', recordId: mgrUpload })
    expect(log.newValue).toMatchObject({ removed: 2, kept: 2 })
    expect(log.newValue.taskIds.sort()).toEqual([ids.up1, ids.up2].sort())
    const again = await request(app).get(`${base}/uploads`).set(MGR_AUTH)
    expect(again.body.data.find((u) => u.id === mgrUpload)).toMatchObject({ taskCount: 2, upcomingCount: 0, visitedCount: 1 })
  })

  it("a team leader removes their own upload; buildings stay assigned", async () => {
    const res = await request(app).delete(`${base}/uploads/${tlUpload}`).set(auth(TL, 'TEAM_LEADER'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ removed: 2, kept: 0 })
    expect((await prisma.buildingAssignment.findFirst({ where: { buildingId: B8, status: 'ACTIVE' } }))?.assignedToId).toBe(SE5)
  })
})
