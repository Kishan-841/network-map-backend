import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { mayManageFiber } from '../src/middleware/auth.js'

// Own fixtures rather than the shared seed: these tests flip the flag, and a
// shared row flipped mid-suite would make other files order-dependent.
const STAMP = Date.now()
const IDS = {
  admin: `fa-admin-${STAMP}`,
  manager: `fa-manager-${STAMP}`,
  ticked: `fa-ticked-${STAMP}`,
  surveyor: `fa-surveyor-${STAMP}`,
  agent: `fa-agent-${STAMP}`,
  lead: `fa-lead-${STAMP}`,
}
const USERS = [
  { id: IDS.admin, role: 'ADMIN' },
  { id: IDS.manager, role: 'MANAGER' },
  { id: IDS.ticked, role: 'SURVEYOR', canManageFiber: true },
  { id: IDS.surveyor, role: 'SURVEYOR' },
  { id: IDS.agent, role: 'ACQUISITION_AGENT' },
  { id: IDS.lead, role: 'ACQUISITION_LEAD' },
]

const auth = (id) => [
  'Authorization',
  `Bearer ${jwt.sign({ sub: id, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]

const app = createApp()
const closureBody = { latitude: 18.5, longitude: 73.8, kind: 'pole' }

beforeAll(async () => {
  for (const user of USERS) {
    await prisma.user.create({
      data: { name: `FA ${user.role}`, email: `${user.id}@vitest.local`, passwordHash: 'x', ...user },
    })
  }
})

afterAll(async () => {
  const ids = Object.values(IDS)
  await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

describe('mayManageFiber', () => {
  it('always allows an ADMIN, ticked or not', () => {
    expect(mayManageFiber({ role: 'ADMIN', canManageFiber: false })).toBe(true)
  })

  it('allows a ticked MANAGER, SURVEYOR or SUPERVISOR', () => {
    for (const role of ['MANAGER', 'SURVEYOR', 'SUPERVISOR']) {
      expect(mayManageFiber({ role, canManageFiber: true })).toBe(true)
    }
  })

  it('refuses an unticked MANAGER', () => {
    expect(mayManageFiber({ role: 'MANAGER', canManageFiber: false })).toBe(false)
  })

  it('refuses a ticked user whose role is not a map role', () => {
    expect(mayManageFiber({ role: 'ACQUISITION_AGENT', canManageFiber: true })).toBe(false)
  })

  it('refuses a missing actor', () => {
    expect(mayManageFiber(undefined)).toBe(false)
  })
})

describe('fiber write access', () => {
  it('lets a ticked SURVEYOR create and delete a closure', async () => {
    const created = await request(app).post('/api/v1/closures').set(...auth(IDS.ticked)).send(closureBody)
    expect(created.status).toBe(201)
    const removed = await request(app)
      .delete(`/api/v1/closures/${created.body.data.id}`)
      .set(...auth(IDS.ticked))
    expect(removed.status).toBe(200)
  })

  it('refuses an unticked MANAGER on closures and fibers, but still lets them read', async () => {
    const closure = await request(app).post('/api/v1/closures').set(...auth(IDS.manager)).send(closureBody)
    expect(closure.status).toBe(403)
    const fiber = await request(app).post('/api/v1/fibers').set(...auth(IDS.manager)).send({})
    expect(fiber.status).toBe(403)
    const read = await request(app).get('/api/v1/fibers').set(...auth(IDS.manager))
    expect(read.status).toBe(200)
  })

  it('refuses an unticked MANAGER on splitters', async () => {
    const res = await request(app).delete('/api/v1/splitters/nope').set(...auth(IDS.manager))
    expect(res.status).toBe(403)
  })

  it('lets an ADMIN write without a tick', async () => {
    const created = await request(app).post('/api/v1/closures').set(...auth(IDS.admin)).send(closureBody)
    expect(created.status).toBe(201)
    await request(app).delete(`/api/v1/closures/${created.body.data.id}`).set(...auth(IDS.admin))
  })
})

describe('PATCH /users/:id/access', () => {
  it('lets an ADMIN tick a surveyor, and the tick works on the very next request', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${IDS.surveyor}/access`)
      .set(...auth(IDS.admin))
      .send({ canManageFiber: true })
    expect(res.status).toBe(200)
    expect(res.body.data.canManageFiber).toBe(true)
    expect(res.body.data.passwordHash).toBeUndefined()

    const created = await request(app).post('/api/v1/closures').set(...auth(IDS.surveyor)).send(closureBody)
    expect(created.status).toBe(201)
    await request(app).delete(`/api/v1/closures/${created.body.data.id}`).set(...auth(IDS.surveyor))

    const unticked = await request(app)
      .patch(`/api/v1/users/${IDS.surveyor}/access`)
      .set(...auth(IDS.admin))
      .send({ canManageFiber: false })
    expect(unticked.body.data.canManageFiber).toBe(false)
    const refused = await request(app).post('/api/v1/closures').set(...auth(IDS.surveyor)).send(closureBody)
    expect(refused.status).toBe(403)
  })

  it('is ADMIN only — a MANAGER cannot tick themselves', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${IDS.manager}/access`)
      .set(...auth(IDS.manager))
      .send({ canManageFiber: true })
    expect(res.status).toBe(403)
  })

  it('refuses a target whose role cannot hold fiber access', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${IDS.agent}/access`)
      .set(...auth(IDS.admin))
      .send({ canManageFiber: true })
    expect(res.status).toBe(400)
  })

  it('answers 404 for an unknown user', async () => {
    const res = await request(app)
      .patch('/api/v1/users/no-such-user/access')
      .set(...auth(IDS.admin))
      .send({ canManageFiber: true })
    expect(res.status).toBe(404)
  })

  it('rejects a body that is not a boolean', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${IDS.surveyor}/access`)
      .set(...auth(IDS.admin))
      .send({ canManageFiber: 'yes' })
    expect(res.status).toBe(400)
  })

  it('writes an audit row naming the user', async () => {
    await request(app)
      .patch(`/api/v1/users/${IDS.surveyor}/access`)
      .set(...auth(IDS.admin))
      .send({ canManageFiber: false })
    // audit() logs on res 'finish', just after the response resolves.
    await new Promise((resolve) => setTimeout(resolve, 150))
    const row = await prisma.systemLog.findFirst({
      where: { userId: IDS.admin, action: 'AccessChange' },
      orderBy: { createdAt: 'desc' },
    })
    expect(row?.description).toContain(`${IDS.surveyor}@vitest.local`)
  })
})

describe('the ordinary user update cannot grant fiber access', () => {
  it('drops canManageFiber from PATCH /users/:id', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${IDS.manager}`)
      .set(...auth(IDS.admin))
      .send({ name: 'FA MANAGER renamed', canManageFiber: true })
    expect(res.status).toBe(200)
    expect(res.body.data.canManageFiber).toBe(false)
  })
})
