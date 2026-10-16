import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { getStorageProvider } from '../src/lib/storage/index.js'

// Proof-photo URLs must come from OUR storage (the service enforces it), so
// build them from the active provider rather than hard-coding a path. No object
// is written: the rule is about the URL's shape, not the file behind it.
const storage = getStorageProvider()
const ownedUrl = (name) => {
  const probe = storage.keyFromUrl(`/uploads/${name}`)
  return probe ? `/uploads/${name}` : `${process.env.R2_PUBLIC_URL}/${name}`
}
const keyOf = (url) => storage.keyFromUrl(url)
const canonical = (url) => storage.canonicalUrl(url)

const app = createApp()
const token = (id, role) => jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })
const auth = (id, role) => ({ Authorization: `Bearer ${token(id, role)}` })

const S = `ai-${Date.now()}`
const MGR = `${S}-mgr`
const TL = `${S}-tl`
const TL2 = `${S}-tl2`
const B1 = `${S}-b1`
const B2 = `${S}-b2`

const PHOTO_A = ownedUrl(`2026/10/${S}-a.jpg`)
const PHOTO_B = ownedUrl(`2026/10/${S}-b.jpg`)
const manyPhotos = (n) => Array.from({ length: n }, (_, i) => ownedUrl(`2026/10/${S}-${i}.jpg`))

const checkIn = (actor, buildingId) =>
  request(app)
    .post('/api/v1/sales/visits')
    .set(auth(actor, 'TEAM_LEADER'))
    .send({ buildingId, checkInLat: 18.5, checkInLng: 73.8, selfieUrl: PHOTO_A, wentSolo: true })

const addActivity = (actor, visitId, type) =>
  request(app).post(`/api/v1/sales/visits/${visitId}/activities`).set(auth(actor, 'TEAM_LEADER')).send({ type })

const addImage = (actor, visitId, type, url) =>
  request(app)
    .post(`/api/v1/sales/visits/${visitId}/activities/${type}/images`)
    .set(auth(actor, 'TEAM_LEADER'))
    .send({ url })

const removeImage = (actor, visitId, type, url) =>
  request(app)
    .delete(`/api/v1/sales/visits/${visitId}/activities/${type}/images`)
    .set(auth(actor, 'TEAM_LEADER'))
    .send({ url })

const imagesOf = async (visitId, type) =>
  (await prisma.visitActivity.findUnique({ where: { visitId_type: { visitId, type } } }))?.images ?? null

// A fresh open visit on B1 with the DESK activity logged — the common starting
// point. Leaves the actor with an open visit other tests must not see.
async function openDeskVisit(actor = TL) {
  const res = await checkIn(actor, B1)
  expect(res.status).toBe(201)
  expect((await addActivity(actor, res.body.data.id, 'DESK')).status).toBe(201)
  return res.body.data.id
}

beforeAll(async () => {
  await prisma.user.create({ data: { id: MGR, name: MGR, email: `${MGR}@v.local`, passwordHash: 'x', role: 'SALES_MANAGER' } })
  await prisma.user.create({ data: { id: TL, name: TL, email: `${TL}@v.local`, passwordHash: 'x', role: 'TEAM_LEADER', managerId: MGR } })
  await prisma.user.create({ data: { id: TL2, name: TL2, email: `${TL2}@v.local`, passwordHash: 'x', role: 'TEAM_LEADER', managerId: MGR } })
  for (const b of [B1, B2]) {
    await prisma.building.create({
      data: { id: b, buildingName: b.toUpperCase(), formattedAddress: `${b} rd`, latitude: 18.5, longitude: 73.8, createdById: 'test-admin', source: 'COVERAGE' },
    })
  }
  await prisma.buildingAssignment.create({ data: { buildingId: B1, assignedToId: TL, assignedById: MGR, status: 'ACTIVE' } })
  await prisma.buildingAssignment.create({ data: { buildingId: B2, assignedToId: TL2, assignedById: MGR, status: 'ACTIVE' } })
})

// Never let one test's open visit leak into the next (one open visit per user).
afterEach(async () => {
  await prisma.buildingVisit.deleteMany({ where: { userId: { in: [TL, TL2] }, checkOutAt: null } })
})

afterAll(async () => {
  await prisma.building.deleteMany({ where: { id: { in: [B1, B2] } } }) // cascades visits + activities + assignments
  await prisma.user.deleteMany({ where: { id: { in: [MGR, TL, TL2] } } })
})

describe('activity proof photos', () => {
  it('adds a photo: stored canonical, returned as a readable signed link', async () => {
    const visitId = await openDeskVisit()
    const res = await addImage(TL, visitId, 'DESK', PHOTO_A)
    expect(res.status).toBe(201)
    expect(res.body.data.images).toHaveLength(1)
    expect(keyOf(res.body.data.images[0])).toBe(keyOf(PHOTO_A))
    // What we keep on the row is the stable form, not the signed one we served.
    expect(await imagesOf(visitId, 'DESK')).toEqual([canonical(PHOTO_A)])
  })

  it('signs the photos on the open-visit read the card uses', async () => {
    const visitId = await openDeskVisit()
    await addImage(TL, visitId, 'DESK', PHOTO_A)
    const open = await request(app).get('/api/v1/sales/visits/open').set(auth(TL, 'TEAM_LEADER'))
    expect(open.status).toBe(200)
    const desk = open.body.data.activities.find((a) => a.type === 'DESK')
    expect(desk.images).toHaveLength(1)
    expect(keyOf(desk.images[0])).toBe(keyOf(PHOTO_A))
    if (env.storageDriver === 'r2') expect(desk.images[0]).toContain('X-Amz-')
  })

  it('re-adding the same photo is a no-op (the list is a set)', async () => {
    const visitId = await openDeskVisit()
    expect((await addImage(TL, visitId, 'DESK', PHOTO_A)).status).toBe(201)
    expect((await addImage(TL, visitId, 'DESK', PHOTO_A)).status).toBe(201)
    expect(await imagesOf(visitId, 'DESK')).toEqual([canonical(PHOTO_A)])
  })

  it('keeps at most 10 photos per activity', async () => {
    const visitId = await openDeskVisit()
    for (const url of manyPhotos(10)) expect((await addImage(TL, visitId, 'DESK', url)).status).toBe(201)
    const over = await addImage(TL, visitId, 'DESK', ownedUrl(`2026/10/${S}-over.jpg`))
    expect(over.status).toBe(400)
    expect(await imagesOf(visitId, 'DESK')).toHaveLength(10)
  })

  it('removes one photo by its URL, signed or canonical', async () => {
    const visitId = await openDeskVisit()
    await addImage(TL, visitId, 'DESK', PHOTO_A)
    const added = await addImage(TL, visitId, 'DESK', PHOTO_B)
    // Remove using the signed link the browser holds, like the UI does: the
    // photo just added is last in the list.
    const signed = added.body.data.images.at(-1)
    const res = await removeImage(TL, visitId, 'DESK', signed)
    expect(res.status).toBe(200)
    expect(res.body.data.images.map(keyOf)).toEqual([keyOf(PHOTO_A)])
    expect(await imagesOf(visitId, 'DESK')).toEqual([canonical(PHOTO_A)])
  })

  it('refuses a URL that is not one of our uploads', async () => {
    const visitId = await openDeskVisit()
    for (const bad of ['https://evil.example.com/x.jpg', 'javascript:alert(1)']) {
      expect((await addImage(TL, visitId, 'DESK', bad)).status).toBe(400)
    }
    expect(await imagesOf(visitId, 'DESK')).toEqual([])
  })

  it('refuses an unknown activity type and an activity that is not logged', async () => {
    const visitId = await openDeskVisit()
    expect((await addImage(TL, visitId, 'NOPE', PHOTO_A)).status).toBe(400)
    expect((await addImage(TL, visitId, 'UMBRELLA', PHOTO_A)).status).toBe(400)
    expect(await imagesOf(visitId, 'UMBRELLA')).toBeNull()
  })

  it('refuses photos once the visit is checked out', async () => {
    const visitId = await openDeskVisit()
    const out = await request(app)
      .post(`/api/v1/sales/visits/${visitId}/checkout`)
      .set(auth(TL, 'TEAM_LEADER'))
      .send({ checkOutLat: 18.5, checkOutLng: 73.8 })
    expect(out.status).toBe(200)
    expect((await addImage(TL, visitId, 'DESK', PHOTO_A)).status).toBe(400)
  })

  it("does not touch someone else's visit", async () => {
    const tlVisit = await openDeskVisit(TL)
    // TL2 is a valid team leader with their own visit, but not the owner here.
    expect((await addImage(TL2, tlVisit, 'DESK', PHOTO_A)).status).toBe(404)
    expect(await imagesOf(tlVisit, 'DESK')).toEqual([])
  })

  it('un-logging an activity drops its photos with the row', async () => {
    const visitId = await openDeskVisit()
    await addImage(TL, visitId, 'DESK', PHOTO_A)
    const off = await request(app).delete(`/api/v1/sales/visits/${visitId}/activities/DESK`).set(auth(TL, 'TEAM_LEADER'))
    expect(off.status).toBe(200)
    expect(await prisma.visitActivity.findUnique({ where: { visitId_type: { visitId, type: 'DESK' } } })).toBeNull()
  })
})
