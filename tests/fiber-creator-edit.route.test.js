import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

// Owner's rule (6 Nov 2026): whoever created a closure or splitter may always
// edit it — even after their fibre tick is taken away. Everyone else still
// needs the tick (ADMIN always has it). Deleting still needs the tick.
const STAMP = Date.now()
const IDS = {
  admin: `fce-admin-${STAMP}`,
  creator: `fce-creator-${STAMP}`, // made the rows, tick since removed
  stranger: `fce-stranger-${STAMP}`, // unticked, did not make them
  ticked: `fce-ticked-${STAMP}`, // ticked, did not make them (same zone)
}
const USERS = [
  { id: IDS.admin, role: 'ADMIN' },
  { id: IDS.creator, role: 'SURVEYOR', canManageFiber: false },
  { id: IDS.stranger, role: 'SURVEYOR', canManageFiber: false },
  { id: IDS.ticked, role: 'SURVEYOR', canManageFiber: true },
]

const auth = (id) => [
  'Authorization',
  `Bearer ${jwt.sign({ sub: id, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]

const app = createApp()
let closureId
let splitterId
let tickedClosureId

beforeAll(async () => {
  for (const user of USERS) {
    await prisma.user.create({
      data: { name: `FCE ${user.role}`, email: `${user.id}@vitest.local`, passwordHash: 'x', ...user },
    })
  }
  const closure = await prisma.closure.create({
    data: { code: `FCE-${STAMP}`, latitude: 18.5, longitude: 73.8, createdById: IDS.creator },
  })
  closureId = closure.id
  const splitter = await prisma.splitter.create({
    data: {
      code: `FCES-${STAMP}`,
      latitude: 18.5,
      longitude: 73.8,
      closureId,
      ratio: 'R1_4',
      location: 'S1',
      createdById: IDS.creator,
    },
  })
  splitterId = splitter.id
  tickedClosureId = (
    await prisma.closure.create({
      data: { code: `FCE2-${STAMP}`, latitude: 18.5, longitude: 73.8, createdById: IDS.ticked },
    })
  ).id
})

afterAll(async () => {
  await prisma.splitter.deleteMany({ where: { code: { startsWith: 'FCES-' } } })
  await prisma.closure.deleteMany({ where: { code: { in: [`FCE-${STAMP}`, `FCE2-${STAMP}`] } } })
  const ids = Object.values(IDS)
  await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

describe('closure edit: creator without the tick', () => {
  it('lets the creator edit their own closure', async () => {
    const res = await request(app).patch(`/api/v1/closures/${closureId}`).set(...auth(IDS.creator)).send({ notes: 'by creator' })
    expect(res.status).toBe(200)
    expect(res.body.data.notes).toBe('by creator')
  })

  it('refuses an unticked user who did not create it', async () => {
    const res = await request(app).patch(`/api/v1/closures/${closureId}`).set(...auth(IDS.stranger)).send({ notes: 'x' })
    expect(res.status).toBe(403)
  })

  it('still lets ADMIN edit', async () => {
    const res = await request(app).patch(`/api/v1/closures/${closureId}`).set(...auth(IDS.admin)).send({ notes: 'by admin' })
    expect(res.status).toBe(200)
  })

  it('still lets a ticked user edit a closure they can see', async () => {
    const res = await request(app).patch(`/api/v1/closures/${tickedClosureId}`).set(...auth(IDS.ticked)).send({ notes: 'mine' })
    expect(res.status).toBe(200)
  })

  it('does not let an unticked creator delete', async () => {
    const res = await request(app).delete(`/api/v1/closures/${closureId}`).set(...auth(IDS.creator))
    expect(res.status).toBe(403)
  })

  it('an unknown closure is still a 404 for the unticked, not a 500', async () => {
    const res = await request(app).patch('/api/v1/closures/does-not-exist').set(...auth(IDS.creator)).send({ notes: 'x' })
    expect([403, 404]).toContain(res.status)
  })
})

describe('splitter edit: creator without the tick', () => {
  it('lets the creator edit their own splitter', async () => {
    const res = await request(app).patch(`/api/v1/splitters/${splitterId}`).set(...auth(IDS.creator)).send({ location: 'S2' })
    expect(res.status).toBe(200)
    expect(res.body.data.location).toBe('S2')
  })

  it('refuses an unticked user who did not create it', async () => {
    const res = await request(app).patch(`/api/v1/splitters/${splitterId}`).set(...auth(IDS.stranger)).send({ location: 'S3' })
    expect(res.status).toBe(403)
  })

  it('does not let an unticked creator delete it', async () => {
    const res = await request(app).delete(`/api/v1/splitters/${splitterId}`).set(...auth(IDS.creator))
    expect(res.status).toBe(403)
  })
})
