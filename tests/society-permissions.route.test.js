import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

// Society permissions, phase 1 (.superpowers/sdd/2026-10-08-society-permissions/design.md).
const app = createApp()
const auth = (id, role) => [
  'Authorization',
  `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]

const S = `sp-${Date.now()}`
const U = {
  PE: { id: `${S}-pe`, role: 'PERMISSION_EXECUTIVE' },
  PE2: { id: `${S}-pe2`, role: 'PERMISSION_EXECUTIVE' },
  ADMIN: { id: `${S}-admin`, role: 'ADMIN' },
  MANAGER: { id: `${S}-mgr`, role: 'MANAGER' },
  SURVEYOR: { id: `${S}-sur`, role: 'SURVEYOR' },
  SUPERVISOR: { id: `${S}-sup`, role: 'SUPERVISOR' },
  SALES_MANAGER: { id: `${S}-sm`, role: 'SALES_MANAGER' },
  TEAM_LEADER: { id: `${S}-tl`, role: 'TEAM_LEADER' },
  SALES_EXECUTIVE: { id: `${S}-se`, role: 'SALES_EXECUTIVE' },
}
const as = (key) => auth(U[key].id, U[key].role)
let ZONE = null

const society = (extra = {}) => ({
  buildingName: `${S} Society ${Math.random().toString(36).slice(2, 8)}`,
  formattedAddress: `${S} Baner, Pune`,
  latitude: 18.5612,
  longitude: 73.7812,
  zoneId: ZONE,
  details: { wings: 2, floors: 7, homePass: 120 },
  contact: { contactName: 'A Patil', contactPhone: '9876543210', designation: 'SECRETARY' },
  permission: { permissionStatus: 'ACCEPTED', societyOffer: 'DEMO', demoCount: 2 },
  remark: '  Met the secretary, agreed in principle  ',
  ...extra,
})

const addAs = async (key, extra) => {
  const res = await request(app).post('/api/v1/buildings').set(...as(key)).send(society(extra))
  expect(res.status).toBe(201)
  return res.body.data
}

beforeAll(async () => {
  ZONE = (await prisma.zone.findFirst()).id
  for (const [key, u] of Object.entries(U)) {
    await prisma.user.create({
      data: {
        id: u.id,
        name: `${S} ${key}`,
        email: `${u.id}@v.local`,
        passwordHash: 'x',
        role: u.role,
        // The zone-based scopes (surveyor, team leader) would see a zoned
        // society if hiding failed — so give them the society's zone.
        ...(['SURVEYOR', 'TEAM_LEADER'].includes(u.role) && { assignedZones: { connect: { id: ZONE } } }),
        ...(['TEAM_LEADER', 'SALES_EXECUTIVE'].includes(u.role) && { managerId: U.SALES_MANAGER.id }),
      },
    })
  }
})

afterAll(async () => {
  const ids = Object.values(U).map((u) => u.id)
  await prisma.building.deleteMany({ where: { buildingName: { startsWith: S } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.updateMany({ where: { id: { in: ids } }, data: { managerId: null } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
})

describe('POST /buildings by a permission executive', () => {
  it('400s without a remark, with a clear message', async () => {
    const { remark, ...body } = society()
    const res = await request(app).post('/api/v1/buildings').set(...as('PE')).send(body)
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/remark/i)
  })

  it('400s on a blank remark', async () => {
    const res = await request(app).post('/api/v1/buildings').set(...as('PE')).send(society({ remark: '   ' }))
    expect(res.status).toBe(400)
  })

  it('creates a PERMISSION building with one ADDED history row', async () => {
    const b = await addAs('PE')
    expect(b.source).toBe('PERMISSION')
    // Added as ACCEPTED, so phase 2 also sends it for approval (a SUBMITTED row).
    const visits = await prisma.permissionVisit.findMany({ where: { buildingId: b.id }, orderBy: { createdAt: 'asc' } })
    expect(visits.map((v) => v.kind)).toEqual(['ADDED', 'SUBMITTED'])
    expect(visits[0]).toMatchObject({
      kind: 'ADDED',
      userId: U.PE.id,
      remark: 'Met the secretary, agreed in principle',
      statusBefore: null,
      statusAfter: 'ACCEPTED',
      changes: [],
    })
  })

  it('an admin still adds a COVERAGE building (remark ignored)', async () => {
    const res = await request(app)
      .post('/api/v1/buildings')
      .set(...as('ADMIN'))
      .send({
        buildingName: `${S} Admin coverage`,
        formattedAddress: 'Somewhere',
        latitude: 18.5,
        longitude: 73.8,
        zoneId: ZONE,
        remark: 'not used',
      })
    expect(res.status).toBe(201)
    expect(res.body.data.source).toBe('COVERAGE')
    expect(await prisma.permissionVisit.count({ where: { buildingId: res.body.data.id } })).toBe(0)
  })
})

describe('PERMISSION buildings are hidden from the staff registry views', () => {
  let b = null
  beforeAll(async () => {
    b = await addAs('PE', { buildingName: `${S} HIDDEN society` })
  })
  const listIds = (res) => (res.body.data.items ?? res.body.data).map((x) => x.id)

  for (const key of ['ADMIN', 'MANAGER', 'SURVEYOR', 'SUPERVISOR', 'SALES_MANAGER']) {
    it(`GET /buildings omits it for ${key}`, async () => {
      const res = await request(app).get(`/api/v1/buildings?search=${encodeURIComponent(`${S} HIDDEN`)}`).set(...as(key))
      expect(res.status).toBe(200)
      expect(listIds(res)).not.toContain(b.id)
    })
  }

  for (const key of ['ADMIN', 'SUPERVISOR', 'MANAGER']) {
    it(`GET /buildings/markers omits it for ${key}`, async () => {
      const res = await request(app).get('/api/v1/buildings/markers').set(...as(key))
      expect(res.status).toBe(200)
      expect(res.body.data.map((x) => x.id)).not.toContain(b.id)
    })
  }

  it('GET /buildings/:id is a 404 for a manager / supervisor, 200 for an admin', async () => {
    expect((await request(app).get(`/api/v1/buildings/${b.id}`).set(...as('MANAGER'))).status).toBe(404)
    expect((await request(app).get(`/api/v1/buildings/${b.id}`).set(...as('SUPERVISOR'))).status).toBe(404)
    expect((await request(app).get(`/api/v1/buildings/${b.id}`).set(...as('ADMIN'))).status).toBe(200)
  })

  it('the nearby duplicate check does not surface it to a surveyor', async () => {
    const res = await request(app)
      .get('/api/v1/buildings/nearby?latitude=18.5612&longitude=73.7812&radius=100')
      .set(...as('SURVEYOR'))
    expect(res.status).toBe(200)
    expect(res.body.data.map((x) => x.id)).not.toContain(b.id)
  })

  for (const key of ['ADMIN', 'SALES_MANAGER', 'TEAM_LEADER']) {
    it(`the sales map omits it for ${key}`, async () => {
      const res = await request(app).get('/api/v1/sales/map-buildings').set(...as(key))
      expect(res.status).toBe(200)
      expect(res.body.data.map((x) => x.id)).not.toContain(b.id)
    })
  }

  it('the team leader’s zone pool omits it', async () => {
    const res = await request(app).get('/api/v1/sales/buildings').set(...as('TEAM_LEADER'))
    expect(res.status).toBe(200)
    expect(res.body.data.map((x) => x.id)).not.toContain(b.id)
  })

  it('the sales registry search omits it', async () => {
    const res = await request(app).get(`/api/v1/sales/search-buildings?q=${encodeURIComponent(`${S} HIDDEN`)}`).set(...as('ADMIN'))
    expect(res.status).toBe(200)
    expect(res.body.data.map((x) => x.id)).not.toContain(b.id)
  })

  it('it cannot be assigned to sales by id', async () => {
    const res = await request(app)
      .post('/api/v1/sales/assignments')
      .set(...as('ADMIN'))
      .send({ buildingIds: [b.id], assignedToId: U.SALES_EXECUTIVE.id })
    expect(res.status).toBe(400)
  })

  for (const key of ['ADMIN', 'TEAM_LEADER']) {
    it(`the visit-plan building search omits it for ${key}`, async () => {
      const res = await request(app).get(`/api/v1/sales/tasks/buildings?q=${encodeURIComponent(`${S} HIDDEN`)}`).set(...as(key))
      expect(res.status).toBe(200)
      expect(res.body.data.map((x) => x.id)).not.toContain(b.id)
    })
  }

  it('the executive’s own GET /buildings list still shows it', async () => {
    const res = await request(app).get('/api/v1/buildings?pageSize=100').set(...as('PE'))
    expect(res.status).toBe(200)
    expect(listIds(res)).toContain(b.id)
  })
})

describe('GET /permission-buildings', () => {
  let mine = null
  let theirs = null
  beforeAll(async () => {
    mine = await addAs('PE', { buildingName: `${S} LIST mine`, permission: { permissionStatus: 'FOLLOW_UP' } })
    theirs = await addAs('PE2', { buildingName: `${S} LIST theirs`, permission: { permissionStatus: 'DENIED' } })
  })
  const ids = (res) => res.body.data.items.map((x) => x.id)

  it('a permission executive sees only their own (createdById ignored)', async () => {
    const res = await request(app).get(`/api/v1/permission-buildings?pageSize=100&createdById=${U.PE2.id}`).set(...as('PE'))
    expect(res.status).toBe(200)
    expect(ids(res)).toContain(mine.id)
    expect(ids(res)).not.toContain(theirs.id)
    const row = res.body.data.items.find((x) => x.id === mine.id)
    expect(row).toMatchObject({
      buildingName: `${S} LIST mine`,
      permissionStatus: 'FOLLOW_UP',
      contact: { contactName: 'A Patil', contactPhone: '9876543210', designation: 'SECRETARY' },
      createdBy: { id: U.PE.id },
      visitCount: 1,
      lastVisit: { kind: 'ADDED', remark: 'Met the secretary, agreed in principle', user: { id: U.PE.id } },
    })
    expect(res.body.data.pagination).toMatchObject({ page: 1, pageSize: 100 })
  })

  it('an admin sees everyone’s, and can filter by executive, status and search', async () => {
    const all = await request(app).get(`/api/v1/permission-buildings?pageSize=100&search=${encodeURIComponent(`${S} LIST`)}`).set(...as('ADMIN'))
    expect(all.status).toBe(200)
    expect(ids(all)).toEqual(expect.arrayContaining([mine.id, theirs.id]))

    const byPe = await request(app).get(`/api/v1/permission-buildings?pageSize=100&createdById=${U.PE2.id}`).set(...as('ADMIN'))
    expect(ids(byPe)).toContain(theirs.id)
    expect(ids(byPe)).not.toContain(mine.id)

    const denied = await request(app).get(`/api/v1/permission-buildings?pageSize=100&status=DENIED&search=${encodeURIComponent(S)}`).set(...as('ADMIN'))
    expect(ids(denied)).toContain(theirs.id)
    expect(ids(denied)).not.toContain(mine.id)
  })

  it('newest activity first', async () => {
    await request(app).post(`/api/v1/permission-buildings/${theirs.id}/visits`).set(...as('ADMIN')).send({ remark: 'bump' })
    await request(app).post(`/api/v1/permission-buildings/${mine.id}/visits`).set(...as('ADMIN')).send({ remark: 'bump' })
    const res = await request(app).get(`/api/v1/permission-buildings?pageSize=100&search=${encodeURIComponent(`${S} LIST`)}`).set(...as('ADMIN'))
    expect(ids(res).slice(0, 2)).toEqual([mine.id, theirs.id])
  })

  it('rejects pageSize over 100 and a bad status', async () => {
    expect((await request(app).get('/api/v1/permission-buildings?pageSize=101').set(...as('ADMIN'))).status).toBe(400)
    expect((await request(app).get('/api/v1/permission-buildings?status=MAYBE').set(...as('ADMIN'))).status).toBe(400)
  })

  for (const key of ['SALES_MANAGER', 'TEAM_LEADER']) {
    it(`is a 403 for ${key}`, async () => {
      expect((await request(app).get('/api/v1/permission-buildings').set(...as(key))).status).toBe(403)
    })
  }

  // Phase 3 (society survey): these roles read APPROVED societies only, so a
  // society that was never approved is not in their list.
  for (const key of ['MANAGER', 'SURVEYOR', 'SUPERVISOR']) {
    it(`${key} gets 200 without the never-approved societies`, async () => {
      const res = await request(app).get('/api/v1/permission-buildings?pageSize=100').set(...as(key))
      expect(res.status).toBe(200)
      expect(res.body.data.items.filter((i) => i.buildingName.startsWith(S))).toEqual([])
    })
  }
})

describe('GET /permission-buildings/:id and POST /:id/visits', () => {
  let b = null
  beforeAll(async () => {
    b = await addAs('PE', { buildingName: `${S} DETAIL` })
  })

  it('the owner reads it with details, contact, permission and visits', async () => {
    const res = await request(app).get(`/api/v1/permission-buildings/${b.id}`).set(...as('PE'))
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: b.id,
      buildingName: `${S} DETAIL`,
      source: 'PERMISSION',
      details: { wings: 2, floors: 7, homePass: 120 },
      contact: { contactName: 'A Patil' },
      permission: { permissionStatus: 'ACCEPTED', societyOffer: 'DEMO', demoCount: 2 },
      createdBy: { id: U.PE.id },
      photos: [],
    })
    // ADDED + the phase-2 SUBMITTED row (it was added as ACCEPTED).
    expect(res.body.data.visits.map((v) => v.kind)).toEqual(['SUBMITTED', 'ADDED'])
  })

  it('another executive gets a 404, a manager 404 (not approved — phase 3), sales 403, an admin a 200', async () => {
    expect((await request(app).get(`/api/v1/permission-buildings/${b.id}`).set(...as('PE2'))).status).toBe(404)
    expect((await request(app).get(`/api/v1/permission-buildings/${b.id}`).set(...as('MANAGER'))).status).toBe(404)
    expect((await request(app).get(`/api/v1/permission-buildings/${b.id}`).set(...as('SALES_MANAGER'))).status).toBe(403)
    expect((await request(app).get(`/api/v1/permission-buildings/${b.id}`).set(...as('ADMIN'))).status).toBe(200)
  })

  it('a coverage building is not reachable through this module', async () => {
    const cov = await prisma.building.create({
      data: { buildingName: `${S} COV`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, createdById: U.ADMIN.id },
    })
    expect((await request(app).get(`/api/v1/permission-buildings/${cov.id}`).set(...as('ADMIN'))).status).toBe(404)
    expect((await request(app).post(`/api/v1/permission-buildings/${cov.id}/visits`).set(...as('ADMIN')).send({ remark: 'x' })).status).toBe(404)
  })

  it('a visit update needs a remark', async () => {
    const res = await request(app).post(`/api/v1/permission-buildings/${b.id}/visits`).set(...as('PE')).send({ permissionStatus: 'FOLLOW_UP' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/remark/i)
  })

  it('records a status change before → after and updates the permission', async () => {
    const res = await request(app)
      .post(`/api/v1/permission-buildings/${b.id}/visits`)
      .set(...as('PE'))
      .send({ remark: ' Chairman wants a demo first ', permissionStatus: 'FOLLOW_UP' })
    expect(res.status).toBe(201)
    expect(res.body.data.permissionStatus).toBe('FOLLOW_UP')
    expect(res.body.data.visit).toMatchObject({
      kind: 'VISIT',
      remark: 'Chairman wants a demo first',
      statusBefore: 'ACCEPTED',
      statusAfter: 'FOLLOW_UP',
      user: { id: U.PE.id },
    })
    const perm = await prisma.permission.findUnique({ where: { buildingId: b.id } })
    expect(perm.permissionStatus).toBe('FOLLOW_UP')
  })

  it('a visit with the same status records no change', async () => {
    const res = await request(app)
      .post(`/api/v1/permission-buildings/${b.id}/visits`)
      .set(...as('ADMIN'))
      .send({ remark: 'Still thinking', permissionStatus: 'FOLLOW_UP' })
    expect(res.status).toBe(201)
    expect(res.body.data.visit).toMatchObject({ statusBefore: null, statusAfter: null, user: { id: U.ADMIN.id } })
  })

  it('the detail lists visits newest first', async () => {
    const res = await request(app).get(`/api/v1/permission-buildings/${b.id}`).set(...as('PE'))
    const remarks = res.body.data.visits.map((v) => v.remark)
    // Phase 2: leaving ACCEPTED while waiting withdrew the approval request
    // (WITHDRAWN, carrying the visit's remark) — it sent on add (SUBMITTED).
    expect(remarks).toEqual([
      'Still thinking',
      'Chairman wants a demo first',
      'Chairman wants a demo first',
      'Sent for approval',
      'Met the secretary, agreed in principle',
    ])
    expect(res.body.data.visits.map((v) => v.kind)).toEqual(['VISIT', 'WITHDRAWN', 'VISIT', 'SUBMITTED', 'ADDED'])
    expect(res.body.data.visits[0].user).toEqual({ id: U.ADMIN.id, name: `${S} ADMIN` })
  })

  it('another executive cannot add a visit (404); other roles 403', async () => {
    expect((await request(app).post(`/api/v1/permission-buildings/${b.id}/visits`).set(...as('PE2')).send({ remark: 'x' })).status).toBe(404)
    expect((await request(app).post(`/api/v1/permission-buildings/${b.id}/visits`).set(...as('SUPERVISOR')).send({ remark: 'x' })).status).toBe(403)
  })

  it('creates the Permission row when a society has none', async () => {
    const bare = await prisma.building.create({
      data: { buildingName: `${S} BARE`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, createdById: U.PE.id, source: 'PERMISSION' },
    })
    const res = await request(app)
      .post(`/api/v1/permission-buildings/${bare.id}/visits`)
      .set(...as('PE'))
      .send({ remark: 'First proper visit', permissionStatus: 'ACCEPTED' })
    expect(res.status).toBe(201)
    expect(res.body.data.visit).toMatchObject({ statusBefore: null, statusAfter: 'ACCEPTED' })
    expect((await prisma.permission.findUnique({ where: { buildingId: bare.id } })).permissionStatus).toBe('ACCEPTED')
  })
})

describe('PATCH /buildings/:id on a PERMISSION building', () => {
  let b = null
  beforeAll(async () => {
    b = await addAs('PE', { buildingName: `${S} EDIT` })
  })

  it('400s without a remark', async () => {
    const res = await request(app).patch(`/api/v1/buildings/${b.id}`).set(...as('PE')).send({ formattedAddress: 'New address' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/remark/i)
  })

  it('logs an EDIT with the changed fields', async () => {
    const res = await request(app)
      .patch(`/api/v1/buildings/${b.id}`)
      .set(...as('PE'))
      .send({
        buildingName: `${S} EDIT`, // unchanged
        formattedAddress: `${S} Aundh, Pune`,
        contact: { contactName: 'B Kulkarni', contactPhone: '9876543210', designation: 'CHAIRMAN' },
        permission: { permissionStatus: 'ACCEPTED', societyOffer: 'PAYMENT', paymentType: 'ONE_TIME', demoCount: null },
        details: { wings: 2, floors: 7, homePass: 120 }, // unchanged
        remark: 'Corrected the chairman’s name and the offer',
      })
    expect(res.status).toBe(200)
    expect(res.body.data.contact.contactName).toBe('B Kulkarni')
    expect(res.body.data.permission.societyOffer).toBe('PAYMENT')
    const [edit] = await prisma.permissionVisit.findMany({ where: { buildingId: b.id, kind: 'EDIT' } })
    expect(edit.remark).toBe('Corrected the chairman’s name and the offer')
    expect(edit.userId).toBe(U.PE.id)
    expect([...edit.changes].sort()).toEqual(['address', 'contact', 'offer'])
    expect(edit.statusBefore).toBeNull()
    expect(edit.statusAfter).toBeNull()
  })

  it('records a status change made through an edit', async () => {
    const res = await request(app)
      .patch(`/api/v1/buildings/${b.id}`)
      .set(...as('ADMIN'))
      .send({ permission: { permissionStatus: 'DENIED' }, remark: 'Committee said no' })
    expect(res.status).toBe(200)
    const edits = await prisma.permissionVisit.findMany({ where: { buildingId: b.id, kind: 'EDIT' }, orderBy: { createdAt: 'desc' } })
    expect(edits[0]).toMatchObject({ statusBefore: 'ACCEPTED', statusAfter: 'DENIED', userId: U.ADMIN.id })
    expect(edits[0].changes).toContain('status')
  })

  it('an edit that changes nothing is a 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/buildings/${b.id}`)
      .set(...as('PE'))
      .send({ formattedAddress: `${S} Aundh, Pune`, remark: 'Just checking' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/nothing changed/i)
    const remarkOnly = await request(app).patch(`/api/v1/buildings/${b.id}`).set(...as('PE')).send({ remark: 'Only a remark' })
    expect(remarkOnly.status).toBe(400)
    expect(remarkOnly.body.error.message).toMatch(/nothing changed/i)
  })

  it('rejects a permission status outside the list', async () => {
    const res = await request(app)
      .patch(`/api/v1/buildings/${b.id}`)
      .set(...as('PE'))
      .send({ permission: { permissionStatus: 'MAYBE' }, remark: 'x' })
    expect(res.status).toBe(400)
  })

  it('a permission executive may not mark their society live', async () => {
    const res = await request(app).patch(`/api/v1/buildings/${b.id}`).set(...as('PE')).send({ isLive: true, remark: 'x' })
    expect(res.status).toBe(403)
  })

  it('another executive, a manager and a supervisor all get a 404', async () => {
    const body = { formattedAddress: 'Hijack', remark: 'x' }
    expect((await request(app).patch(`/api/v1/buildings/${b.id}`).set(...as('PE2')).send(body)).status).toBe(404)
    expect((await request(app).patch(`/api/v1/buildings/${b.id}`).set(...as('MANAGER')).send(body)).status).toBe(404)
    expect((await request(app).patch(`/api/v1/buildings/${b.id}`).set(...as('SUPERVISOR')).send(body)).status).toBe(404)
    expect((await request(app).patch(`/api/v1/buildings/${b.id}/status`).set(...as('MANAGER')).send({ isLive: true })).status).toBe(404)
    // No coverage status on a society, not even for an admin.
    expect((await request(app).patch(`/api/v1/buildings/${b.id}/status`).set(...as('ADMIN')).send({ isLive: true })).status).toBe(404)
  })

  it('contact stays refused on a coverage building', async () => {
    const cov = await prisma.building.create({
      data: { buildingName: `${S} COV2`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, createdById: U.ADMIN.id, zoneId: ZONE },
    })
    const res = await request(app)
      .patch(`/api/v1/buildings/${cov.id}`)
      .set(...as('ADMIN'))
      .send({ contact: { contactName: 'X', contactPhone: '9876543210', designation: 'OWNER' } })
    expect(res.status).toBe(400)
  })
})

// URLs the active storage provider recognises as ours, under a test-only key
// prefix (nothing is uploaded; a removed one's best-effort delete is a no-op).
const storageBase = () => (env.storageDriver === 'r2' ? env.r2.publicUrl : `${env.appUrl}/uploads`)
const fileUrl = (name) => `${storageBase()}/${S}/${name}`

describe('photos on a PERMISSION building', () => {
  let b = null
  let photos = null
  beforeAll(async () => {
    b = await addAs('PE', {
      buildingName: `${S} PHOTOS`,
      photos: [
        { type: 'ENTRANCE', url: fileUrl('entrance.jpg') },
        { type: 'PERMISSION_LETTER', url: fileUrl('letter.pdf') },
      ],
      permission: { permissionStatus: 'ACCEPTED', documentUrl: fileUrl('letter.pdf') },
    })
    photos = await prisma.photo.findMany({ where: { buildingId: b.id } })
  })

  it('the single-photo routes are closed: owner / admin 400, anyone else 404', async () => {
    const add = (key) =>
      request(app).post(`/api/v1/buildings/${b.id}/photos`).set(...as(key)).send({ type: 'ADDITIONAL', url: fileUrl('x.jpg') })
    for (const key of ['PE', 'ADMIN']) {
      const res = await add(key)
      expect(res.status).toBe(400)
      expect(res.body.error.message).toBe('Change photos from Edit details')
    }
    expect((await add('PE2')).status).toBe(404)
    expect((await add('MANAGER')).status).toBe(404)
    const letter = await request(app)
      .post(`/api/v1/buildings/${b.id}/photos`)
      .set(...as('PE'))
      .send({ type: 'PERMISSION_LETTER', url: fileUrl('l2.pdf') })
    expect(letter.status).toBe(400)

    const del = (key) => request(app).delete(`/api/v1/buildings/${b.id}/photos/${photos[0].id}`).set(...as(key))
    expect((await del('PE')).status).toBe(400)
    expect((await del('ADMIN')).status).toBe(400)
    expect((await del('PE2')).status).toBe(404)
    expect((await del('SUPERVISOR')).status).toBe(404)
    expect(await prisma.photo.count({ where: { buildingId: b.id } })).toBe(2)
  })

  it('echoing back the served (signed) photo URLs is no change', async () => {
    const detail = await request(app).get(`/api/v1/permission-buildings/${b.id}`).set(...as('PE'))
    const served = detail.body.data.photos.map((p) => ({ type: p.type, url: p.url }))
    expect(served).toHaveLength(2)
    const res = await request(app).patch(`/api/v1/buildings/${b.id}`).set(...as('PE')).send({ photos: served, remark: 'Same photos' })
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/nothing changed/i)
  })

  it('removing the letter through PATCH clears the permission document and is logged', async () => {
    const detail = await request(app).get(`/api/v1/permission-buildings/${b.id}`).set(...as('PE'))
    const keep = detail.body.data.photos.filter((p) => p.type === 'ENTRANCE').map((p) => ({ type: p.type, url: p.url }))
    const res = await request(app).patch(`/api/v1/buildings/${b.id}`).set(...as('PE')).send({ photos: keep, remark: 'Letter was the wrong society' })
    expect(res.status).toBe(200)
    const rows = await prisma.photo.findMany({ where: { buildingId: b.id } })
    expect(rows.map((p) => p.type)).toEqual(['ENTRANCE'])
    expect(rows[0].url).toBe(fileUrl('entrance.jpg'))
    expect((await prisma.permission.findUnique({ where: { buildingId: b.id } })).documentUrl).toBeNull()
    const [edit] = await prisma.permissionVisit.findMany({ where: { buildingId: b.id, kind: 'EDIT' } })
    expect(edit).toMatchObject({ changes: ['photos'], remark: 'Letter was the wrong society' })
  })
})
