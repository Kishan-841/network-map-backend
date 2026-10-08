import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const auth = (id, role) => ['Authorization', `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`]

const S = `pe-${Date.now()}`
const PE = `${S}-pe`
const PE2 = `${S}-pe2`
let ZONE = null
const made = []

const society = (extra = {}) => ({
  placeId: `${S}-place-${Math.random().toString(36).slice(2)}`,
  buildingName: `${S} Society ${Math.random().toString(36).slice(2)}`,
  formattedAddress: 'Baner, Pune',
  latitude: 18.56,
  longitude: 73.78,
  zoneId: ZONE,
  details: { wings: 2, floors: 7, homePass: 120 },
  contact: { contactName: 'A Patil', contactPhone: '9876543210', designation: 'SECRETARY' },
  permission: { permissionStatus: 'ACCEPTED', societyOffer: 'DEMO', demoCount: 2 },
  remark: 'First visit',
  ...extra,
})

beforeAll(async () => {
  ZONE = (await prisma.zone.findFirst()).id
  await prisma.user.create({ data: { id: PE, name: PE, email: `${PE}@v.local`, passwordHash: 'x', role: 'PERMISSION_EXECUTIVE' } })
  await prisma.user.create({ data: { id: PE2, name: PE2, email: `${PE2}@v.local`, passwordHash: 'x', role: 'PERMISSION_EXECUTIVE' } })
})
afterAll(async () => {
  await prisma.building.deleteMany({ where: { buildingName: { startsWith: S } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: [PE, PE2] } } })
  await prisma.user.deleteMany({ where: { id: { in: [PE, PE2] } } })
})

describe('a permission executive adds a society', () => {
  it('creates a PERMISSION building with contact + permission (contact allowed for this role)', async () => {
    const res = await request(app).post('/api/v1/buildings').set(...auth(PE, 'PERMISSION_EXECUTIVE')).send(society())
    expect(res.status).toBe(201)
    made.push(res.body.data.id)
    expect(res.body.data.source).toBe('PERMISSION')
    expect(res.body.data.createdById).toBe(PE)
    expect(res.body.data.contact.contactName).toBe('A Patil')
    expect(res.body.data.permission.permissionStatus).toBe('ACCEPTED')
    expect(res.body.data.permission.societyOffer).toBe('DEMO')
    expect(res.body.data.permission.demoCount).toBe(2)
  })

  it('adds a society without a zone (zone is not asked of this role)', async () => {
    const res = await request(app).post('/api/v1/buildings').set(...auth(PE, 'PERMISSION_EXECUTIVE')).send(society({ zoneId: undefined, buildingName: `${S} NOZONE` }))
    expect(res.status).toBe(201)
    made.push(res.body.data.id)
    expect(res.body.data.zoneId).toBeNull()
  })

  it('lists only the societies the executive added, not another executive’s', async () => {
    const mine = await request(app).post('/api/v1/buildings').set(...auth(PE, 'PERMISSION_EXECUTIVE')).send(society({ buildingName: `${S} MINE` }))
    made.push(mine.body.data.id)
    const theirs = await request(app).post('/api/v1/buildings').set(...auth(PE2, 'PERMISSION_EXECUTIVE')).send(society({ buildingName: `${S} THEIRS` }))
    made.push(theirs.body.data.id)

    const list = await request(app).get('/api/v1/buildings').set(...auth(PE, 'PERMISSION_EXECUTIVE'))
    expect(list.status).toBe(200)
    const names = list.body.data.items.map((b) => b.buildingName)
    expect(names).toContain(`${S} MINE`)
    expect(names).not.toContain(`${S} THEIRS`)
  })
})

describe('a permission executive edits their own society', () => {
  let mineId = null
  let theirsId = null
  beforeAll(async () => {
    mineId = (await request(app).post('/api/v1/buildings').set(...auth(PE, 'PERMISSION_EXECUTIVE')).send(society({ buildingName: `${S} EDIT` }))).body.data.id
    theirsId = (await request(app).post('/api/v1/buildings').set(...auth(PE2, 'PERMISSION_EXECUTIVE')).send(society({ buildingName: `${S} OTHER` }))).body.data.id
    made.push(mineId, theirsId)
  })

  it('updates the permission status on their own society', async () => {
    const res = await request(app).patch(`/api/v1/buildings/${mineId}`).set(...auth(PE, 'PERMISSION_EXECUTIVE')).send({ permission: { permissionStatus: 'FOLLOW_UP' }, remark: 'Asked to come back' })
    expect(res.status).toBe(200)
    expect(res.body.data.permission.permissionStatus).toBe('FOLLOW_UP')
  })

  it('refuses to edit a society another executive added', async () => {
    const res = await request(app).patch(`/api/v1/buildings/${theirsId}`).set(...auth(PE, 'PERMISSION_EXECUTIVE')).send({ permission: { permissionStatus: 'DENIED' }, remark: 'x' })
    // Out of scope is a 404 (society permissions, fix round 1).
    expect(res.status).toBe(404)
  })

  it('may not mark a society live', async () => {
    const res = await request(app).patch(`/api/v1/buildings/${mineId}`).set(...auth(PE, 'PERMISSION_EXECUTIVE')).send({ isLive: true, remark: 'x' })
    expect(res.status).toBe(403)
  })
})

describe('reading a society (the edit page + the list column)', () => {
  let mineId = null
  let theirsId = null
  beforeAll(async () => {
    mineId = (await request(app).post('/api/v1/buildings').set(...auth(PE, 'PERMISSION_EXECUTIVE')).send(society({ buildingName: `${S} READ` }))).body.data.id
    theirsId = (await request(app).post('/api/v1/buildings').set(...auth(PE2, 'PERMISSION_EXECUTIVE')).send(society({ buildingName: `${S} READ2` }))).body.data.id
    made.push(mineId, theirsId)
  })

  it('opens the executive’s own society by id, with its permission', async () => {
    const res = await request(app).get(`/api/v1/buildings/${mineId}`).set(...auth(PE, 'PERMISSION_EXECUTIVE'))
    expect(res.status).toBe(200)
    expect(res.body.data.permission.permissionStatus).toBe('ACCEPTED')
  })

  it('404s on a society another executive added', async () => {
    const res = await request(app).get(`/api/v1/buildings/${theirsId}`).set(...auth(PE, 'PERMISSION_EXECUTIVE'))
    expect(res.status).toBe(404)
  })

  it('carries the permission status in the list rows', async () => {
    const list = await request(app).get('/api/v1/buildings').set(...auth(PE, 'PERMISSION_EXECUTIVE'))
    const row = list.body.data.items.find((b) => b.id === mineId)
    expect(row.permission.permissionStatus).toBe('ACCEPTED')
  })
})
