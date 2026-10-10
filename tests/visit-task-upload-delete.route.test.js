import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { addDays, dateOnly, istToday } from '../src/lib/visit-plan.js'
import { visitTaskRepository } from '../src/modules/visit-tasks/visit-task.repository.js'

/**
 * Uploads panel (10 Oct): an upload's task list, and ADMIN-only delete of a
 * whole upload — refused once any of its tasks has a visit.
 */
const app = createApp()
const auth = (id, role) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` })
const S = `vtud-${Date.now()}`
const [ADMIN, MGR, SE] = ['admin', 'mgr', 'se'].map((s) => `${S}-${s}`)
const [B1, B2] = [`${S}-b1`, `${S}-b2`]
const USERS = [ADMIN, MGR, SE]
const today = istToday()

/** An upload by MGR for SE: one task per [buildingId, day]. */
async function seedUpload(days) {
  const up = await prisma.taskUpload.create({
    data: { uploadedById: MGR, fromDate: dateOnly(today), toDate: dateOnly(today), assigneeCount: 1, created: days.length, replaced: 0, assigned: 0, fileName: `${S}.xlsx` },
  })
  await prisma.visitTask.createMany({
    data: days.map(([buildingId, day]) => ({ assigneeId: SE, buildingId, taskDate: dateOnly(day), uploadId: up.id, createdById: MGR })),
  })
  return up.id
}

beforeAll(async () => {
  const mk = (id, role, extra = {}) => prisma.user.create({ data: { id, name: id, email: `${id}@v.local`, passwordHash: 'x', role, ...extra } })
  await mk(ADMIN, 'ADMIN')
  await mk(MGR, 'SALES_MANAGER')
  await mk(SE, 'SALES_EXECUTIVE', { managerId: MGR })
  for (const id of [B1, B2]) {
    await prisma.building.create({ data: { id, buildingName: `${S} ${id}`, formattedAddress: `${S}, Test`, latitude: 18.6, longitude: 73.79, source: 'COVERAGE', createdById: MGR } })
  }
})
afterAll(async () => {
  await prisma.visitTask.deleteMany({ where: { assigneeId: { in: USERS } } })
  await prisma.taskUpload.deleteMany({ where: { uploadedById: { in: USERS } } })
  await prisma.buildingVisit.deleteMany({ where: { userId: { in: USERS } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: USERS } } }).catch(() => {})
  await prisma.building.deleteMany({ where: { id: { in: [B1, B2] } } })
  await prisma.user.deleteMany({ where: { id: { in: USERS } } })
})

describe('visit plan uploads: task list + delete', () => {
  it('the repository has the methods the service calls', () => {
    expect(typeof visitTaskRepository.uploadTaskList).toBe('function')
    expect(typeof visitTaskRepository.deleteUploadChecked).toBe('function')
  })

  it('lists an upload\'s tasks with MISSED / UPCOMING status', async () => {
    const id = await seedUpload([[B1, addDays(today, -2)], [B1, addDays(today, 3)]])
    const res = await request(app).get(`/api/v1/sales/tasks/uploads/${id}/tasks`).set(auth(MGR, 'SALES_MANAGER'))
    expect(res.status).toBe(200)
    expect(res.body.data.map((t) => [t.taskDate, t.status])).toEqual([[addDays(today, -2), 'MISSED'], [addDays(today, 3), 'UPCOMING']])
    expect(res.body.data[0]).toMatchObject({ assignee: { id: SE }, building: { id: B1 } })
  })

  it('only ADMIN may delete an upload; unknown id is 404', async () => {
    const id = await seedUpload([[B2, addDays(today, 1)]])
    expect((await request(app).delete(`/api/v1/sales/tasks/uploads/${id}`).set(auth(MGR, 'SALES_MANAGER'))).status).toBe(403)
    expect(await prisma.visitTask.count({ where: { uploadId: id } })).toBe(1)
    expect((await request(app).delete(`/api/v1/sales/tasks/uploads/${S}-nope`).set(auth(ADMIN, 'ADMIN'))).status).toBe(404)
  })

  it('an upload with no visits goes entirely — past missed tasks and the upload row too', async () => {
    const id = await seedUpload([[B2, addDays(today, -1)], [B2, addDays(today, 2)], [B2, addDays(today, 4)]])
    const res = await request(app).delete(`/api/v1/sales/tasks/uploads/${id}`).set(auth(ADMIN, 'ADMIN'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ removed: 3 })
    expect(await prisma.visitTask.count({ where: { uploadId: id } })).toBe(0)
    expect(await prisma.taskUpload.findUnique({ where: { id } })).toBeNull()
  })

  it('an upload with a visited task is refused (409) and nothing changes', async () => {
    const id = await seedUpload([[B1, today], [B1, addDays(today, 7)]])
    await prisma.buildingVisit.create({ data: { buildingId: B1, userId: SE, visitedAt: new Date() } })
    const list = await request(app).get(`/api/v1/sales/tasks/uploads/${id}/tasks`).set(auth(ADMIN, 'ADMIN'))
    expect(list.body.data.map((t) => t.status)).toEqual(['VISITED', 'UPCOMING'])
    const res = await request(app).delete(`/api/v1/sales/tasks/uploads/${id}`).set(auth(ADMIN, 'ADMIN'))
    expect(res.status).toBe(409)
    expect(res.body.error.message).toMatch(/already done/)
    expect(await prisma.visitTask.count({ where: { uploadId: id } })).toBe(2)
    expect(await prisma.taskUpload.findUnique({ where: { id } })).not.toBeNull()

    // A single unvisited task of it can still be deleted.
    const next = list.body.data.find((t) => t.status === 'UPCOMING')
    expect((await request(app).delete(`/api/v1/sales/tasks/${next.id}`).set(auth(ADMIN, 'ADMIN'))).status).toBe(200)
    expect(await prisma.visitTask.count({ where: { uploadId: id } })).toBe(1)
  })
})
