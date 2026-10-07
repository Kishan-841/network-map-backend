import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { addDays, dateOnly, istToday } from '../src/lib/visit-plan.js'

/**
 * A building handed from executive A to someone else strands A's planned
 * tasks there (A can no longer check in). Every hand-over — import, a single
 * task, and Assign to… — deletes A's tasks at that building dated today or
 * later, keeping past ones and a task A already visited today.
 */
const app = createApp()
const auth = (id, role) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })
const S = `vth-${Date.now()}`
const [MGR, A, B] = ['mgr', 'a', 'b'].map((s) => `${S}-${s}`)
const X = `${S}-x`
const USERS = [A, B, MGR]
const today = istToday()
const none = [false, false, false, false, false, false, false]
const NAME = `${S} Silver Oak`

beforeAll(async () => {
  const mk = (id, role, extra = {}) => prisma.user.create({ data: { id, name: id, email: `${id}@v.local`, passwordHash: 'x', role, ...extra } })
  await mk(MGR, 'SALES_MANAGER')
  await mk(A, 'SALES_EXECUTIVE', { managerId: MGR })
  await mk(B, 'SALES_EXECUTIVE', { managerId: MGR })
  await prisma.building.create({ data: { id: X, buildingName: NAME, formattedAddress: `${NAME}, Test`,
    latitude: 18.6, longitude: 73.79, source: 'COVERAGE', createdById: MGR } })
})

/** X held by A; A has tasks yesterday, today (visited or not), tomorrow and in 3 days. */
async function seed({ visitedToday = false } = {}) {
  await prisma.visitTask.deleteMany({ where: { buildingId: X } })
  await prisma.taskUpload.deleteMany({ where: { uploadedById: MGR } })
  await prisma.buildingVisit.deleteMany({ where: { buildingId: X } })
  await prisma.buildingAssignment.deleteMany({ where: { buildingId: X } })
  await prisma.buildingAssignment.create({ data: { buildingId: X, assignedToId: A, assignedById: MGR } })
  const t = async (assigneeId, day) =>
    (await prisma.visitTask.create({ data: { assigneeId, buildingId: X, taskDate: dateOnly(day), createdById: MGR } })).id
  const ids = {
    past: await t(A, addDays(today, -1)),
    today: await t(A, today),
    tomorrow: await t(A, addDays(today, 1)),
    later: await t(A, addDays(today, 3)),
  }
  if (visitedToday) await prisma.buildingVisit.create({ data: { buildingId: X, userId: A, visitedAt: new Date() } })
  return ids
}
const aTasks = async () => (await prisma.visitTask.findMany({ where: { assigneeId: A, buildingId: X }, select: { id: true } })).map((t) => t.id).sort()
const holder = async () => (await prisma.buildingAssignment.findFirst({ where: { buildingId: X, status: 'ACTIVE' } }))?.assignedToId ?? null

afterAll(async () => {
  await prisma.visitTask.deleteMany({ where: { OR: [{ assigneeId: { in: USERS } }, { buildingId: X }] } })
  await prisma.taskUpload.deleteMany({ where: { uploadedById: { in: USERS } } })
  await prisma.buildingVisit.deleteMany({ where: { OR: [{ userId: { in: USERS } }, { buildingId: X }] } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {})
  await prisma.buildingAssignment.deleteMany({ where: { buildingId: X } })
  await prisma.building.deleteMany({ where: { id: X } })
  await prisma.user.deleteMany({ where: { id: { in: USERS } } })
})

const mgr = auth(MGR, 'SALES_MANAGER')

describe('handing a building over frees the previous holder\'s planned tasks', () => {
  let ids
  beforeEach(async () => { ids = await seed() })

  it('preview shows what B takes from A; import removes A\'s future X tasks and counts them in replaced', async () => {
    const day = addDays(today, 2)
    const pre = await request(app).post('/api/v1/sales/tasks/preview').set(mgr).send({ rows: [
      { rowNumber: 2, employee: B, building: NAME, date: day, startTime: '', endTime: '', until: '', weekdays: none },
    ] })
    expect(pre.status).toBe(200)
    const person = pre.body.data.people.find((p) => p.assigneeId === B)
    // Today (not visited), tomorrow and in 3 days go; yesterday stays.
    expect(person.takesFrom).toEqual([{ buildingId: X, buildingName: NAME, fromId: A, fromName: A, tasks: 3 }])
    expect(person).toMatchObject({ tasks: 1, replaces: 0, assigns: 1 })
    expect((await aTasks()).length).toBe(4) // preview writes nothing

    const imp = await request(app).post('/api/v1/sales/tasks/import').set(mgr).send({ rows: [
      { rowNumber: 2, assigneeId: B, buildingId: X, date: day, startTime: null, endTime: null, until: null, weekdays: none },
    ] })
    expect(imp.status).toBe(200)
    expect(imp.body.data).toMatchObject({ created: 1, replaced: 3, assigned: 1 })
    expect(await aTasks()).toEqual([ids.past])
    expect(await holder()).toBe(B)
  })

  it('a single task for B at X removes A\'s future X tasks', async () => {
    const res = await request(app).post('/api/v1/sales/tasks').set(mgr)
      .send({ assigneeId: B, buildingId: X, taskDate: addDays(today, 1), startTime: null, endTime: null })
    expect(res.status).toBe(201)
    expect(await aTasks()).toEqual([ids.past])
    expect(await prisma.visitTask.count({ where: { assigneeId: B, buildingId: X } })).toBe(1)
  })

  it('moving one of B\'s tasks to X removes A\'s future X tasks', async () => {
    await prisma.building.create({ data: { id: `${X}-2`, buildingName: `${NAME} Two`, formattedAddress: 'x', latitude: 18.6, longitude: 73.79, source: 'COVERAGE', createdById: MGR } })
    try {
      await prisma.buildingAssignment.create({ data: { buildingId: `${X}-2`, assignedToId: B, assignedById: MGR } })
      const own = await prisma.visitTask.create({ data: { assigneeId: B, buildingId: `${X}-2`, taskDate: dateOnly(addDays(today, 1)), createdById: MGR } })
      const res = await request(app).patch(`/api/v1/sales/tasks/${own.id}`).set(mgr).send({ buildingId: X })
      expect(res.status).toBe(200)
      expect(await aTasks()).toEqual([ids.past])
    } finally {
      await prisma.visitTask.deleteMany({ where: { buildingId: `${X}-2` } })
      await prisma.buildingAssignment.deleteMany({ where: { buildingId: `${X}-2` } })
      await prisma.building.delete({ where: { id: `${X}-2` } })
    }
  })
})

describe('Assign to… frees the previous holder\'s planned tasks', () => {
  it('moving X from A to B removes A\'s future X tasks, keeps today\'s visited one and B\'s own', async () => {
    const ids = await seed({ visitedToday: true })
    const bOwn = (await prisma.visitTask.create({ data: { assigneeId: B, buildingId: X, taskDate: dateOnly(addDays(today, 2)), createdById: MGR } })).id
    const res = await request(app).post('/api/v1/sales/assignments').set(mgr).send({ buildingIds: [X], assignedToId: B })
    expect(res.status).toBe(200)
    expect(await holder()).toBe(B)
    expect(await aTasks()).toEqual([ids.past, ids.today].sort())
    expect(await prisma.visitTask.findUnique({ where: { id: bOwn } })).not.toBeNull()
  })

  it('re-assigning X to its own holder removes nothing', async () => {
    await seed()
    const res = await request(app).post('/api/v1/sales/assignments').set(mgr).send({ buildingIds: [X], assignedToId: A })
    expect(res.status).toBe(200)
    expect((await aTasks()).length).toBe(4)
  })
})
