import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { getStorageProvider } from '../src/lib/storage/index.js'

// Photo URLs must come from OUR storage (the service enforces it), so build
// them from the active provider rather than hard-coding a path. No object is
// written: the rule is about the URL's shape, not the file behind it.
const storage = getStorageProvider()
const ownedUrl = (name) => {
  const probe = storage.keyFromUrl(`/uploads/${name}`)
  return probe ? `/uploads/${name}` : `${process.env.R2_PUBLIC_URL}/${name}`
}

const STAMP = Date.now()
const ADMIN = `cp-admin-${STAMP}`
const OTHER = `cp-surveyor-${STAMP}`
const app = createApp()
const authOf = (sub) => [
  'Authorization',
  `Bearer ${jwt.sign({ sub, role: 'IGNORED' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]
const auth = authOf(ADMIN)
const made = []
const at = { latitude: 18.61, longitude: 73.77 }
const PHOTO_A = ownedUrl(`2026/10/cp-${STAMP}-a.jpg`)
const PHOTO_B = ownedUrl(`2026/10/cp-${STAMP}-b.jpg`)
const keyOf = (url) => storage.keyFromUrl(url)

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: ADMIN, name: 'CP Admin', email: `${ADMIN}@vitest.local`, passwordHash: 'x', role: 'ADMIN' },
      // Allowed to write fibre, but owns nothing and has no zones.
      {
        id: OTHER,
        name: 'CP Surveyor',
        email: `${OTHER}@vitest.local`,
        passwordHash: 'x',
        role: 'SURVEYOR',
        canManageFiber: true,
      },
    ],
  })
})

afterAll(async () => {
  // A failing draw-time test may leave its fiber behind — sweep by name.
  for (const f of await prisma.fiber.findMany({ where: { name: { startsWith: `CP-FIB-${STAMP}` } } })) {
    await request(app).delete(`/api/v1/fibers/${f.id}`).set(...auth)
  }
  await prisma.closure.deleteMany({ where: { createdById: ADMIN } })
  for (const id of made) await request(app).delete(`/api/v1/closures/${id}`).set(...auth)
  await prisma.systemLog.deleteMany({ where: { userId: { in: [ADMIN, OTHER] } } })
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN, OTHER] } } })
})

async function createWith(body) {
  const res = await request(app).post('/api/v1/closures').set(...auth).send({ ...at, ...body })
  if (res.status === 201) made.push(res.body.data.id)
  return res
}

describe('closure photos', () => {
  it('stores the canonical URL and hands back a readable one', async () => {
    const res = await createWith({ kind: 'FDC', images: [PHOTO_A] })
    expect(res.status).toBe(201)
    const saved = await prisma.closure.findUnique({ where: { id: res.body.data.id } })
    expect(saved.images).toEqual([storage.canonicalUrl(PHOTO_A)])
    expect(res.body.data.images).toHaveLength(1)
    expect(keyOf(res.body.data.images[0])).toBe(keyOf(PHOTO_A))
  })

  it('signs the photos on every read: list and detail', async () => {
    const res = await createWith({ images: [PHOTO_A] })
    const id = res.body.data.id
    const one = await request(app).get(`/api/v1/closures/${id}`).set(...auth)
    expect(one.status).toBe(200)
    expect(keyOf(one.body.data.images[0])).toBe(keyOf(PHOTO_A))
    const list = await request(app).get('/api/v1/closures').set(...auth)
    const row = list.body.data.find((c) => c.id === id)
    expect(keyOf(row.images[0])).toBe(keyOf(PHOTO_A))
    // A signed read URL is what the browser holds; it must not be stored.
    if (env.storageDriver === 'r2') expect(one.body.data.images[0]).toContain('X-Amz-')
  })

  it('an edit replaces the list, and the echoed signed URL is stored canonical', async () => {
    const res = await createWith({ images: [PHOTO_A] })
    const id = res.body.data.id
    const echoed = res.body.data.images[0]
    const upd = await request(app)
      .patch(`/api/v1/closures/${id}`)
      .set(...auth)
      .send({ images: [echoed, PHOTO_B] })
    expect(upd.status).toBe(200)
    expect(upd.body.data.images.map(keyOf)).toEqual([keyOf(PHOTO_A), keyOf(PHOTO_B)])
    const saved = await prisma.closure.findUnique({ where: { id } })
    expect(saved.images).toEqual([storage.canonicalUrl(PHOTO_A), storage.canonicalUrl(PHOTO_B)])
  })

  it('an empty list clears the photos; an edit without images leaves them alone', async () => {
    const res = await createWith({ images: [PHOTO_A] })
    const id = res.body.data.id
    const notes = await request(app).patch(`/api/v1/closures/${id}`).set(...auth).send({ notes: 'tidy' })
    expect(notes.status).toBe(200)
    expect(notes.body.data.images).toHaveLength(1)
    const cleared = await request(app).patch(`/api/v1/closures/${id}`).set(...auth).send({ images: [] })
    expect(cleared.status).toBe(200)
    expect(cleared.body.data.images).toEqual([])
    expect((await prisma.closure.findUnique({ where: { id } })).images).toEqual([])
  })

  it('refuses a URL that is not one of our uploads', async () => {
    for (const bad of ['https://evil.example.com/x.jpg', 'javascript:alert(1)']) {
      const created = await createWith({ images: [bad] })
      expect(created.status).toBe(400)
    }
    const res = await createWith({ images: [PHOTO_A] })
    const upd = await request(app)
      .patch(`/api/v1/closures/${res.body.data.id}`)
      .set(...auth)
      .send({ images: ['https://evil.example.com/x.jpg'] })
    expect(upd.status).toBe(400)
    const saved = await prisma.closure.findUnique({ where: { id: res.body.data.id } })
    expect(saved.images).toEqual([storage.canonicalUrl(PHOTO_A)])
  })

  it('refuses more than 20 photos and a non-string entry', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ownedUrl(`2026/10/cp-${STAMP}-${i}.jpg`))
    expect((await createWith({ images: many })).status).toBe(400)
    expect((await createWith({ images: [42] })).status).toBe(400)
  })

  it('a closure outside the editor scope still reads as not found', async () => {
    const res = await createWith({ images: [PHOTO_A] })
    const other = authOf(OTHER)
    const upd = await request(app)
      .patch(`/api/v1/closures/${res.body.data.id}`)
      .set(...other)
      .send({ images: [] })
    expect(upd.status).toBe(404)
    expect((await request(app).get(`/api/v1/closures/${res.body.data.id}`).set(...other)).status).toBe(404)
    const saved = await prisma.closure.findUnique({ where: { id: res.body.data.id } })
    expect(saved.images).toEqual([storage.canonicalUrl(PHOTO_A)])
  })
})

describe('photos on a closure dropped while drawing', () => {
  const fiberBody = (newClosure, suffix) => ({
    name: `CP-FIB-${STAMP}-${suffix}`,
    coreCount: 2,
    points: [
      { latitude: 18.61, longitude: 73.77 },
      { type: 'CLOSURE', latitude: 18.611, longitude: 73.771, newClosure },
    ],
  })

  it('stores them canonical, like the closure form does', async () => {
    const zoneId = (await prisma.zone.findFirst()).id
    const res = await request(app)
      .post('/api/v1/fibers')
      .set(...auth)
      .send({ ...fiberBody({ kind: 'FDC', images: [PHOTO_A] }, 'ok'), zoneId })
    expect(res.status).toBe(201)
    const closureId = res.body.data.points.find((p) => p.type === 'CLOSURE').closureId
    const saved = await prisma.closure.findUnique({ where: { id: closureId } })
    expect(saved.kind).toBe('FDC')
    expect(saved.images).toEqual([storage.canonicalUrl(PHOTO_A)])
    const read = await request(app).get(`/api/v1/closures/${closureId}`).set(...auth)
    expect(keyOf(read.body.data.images[0])).toBe(keyOf(PHOTO_A))
    await request(app).delete(`/api/v1/fibers/${res.body.data.id}`).set(...auth)
    await prisma.closure.deleteMany({ where: { id: closureId } })
  })

  it('refuses a foreign photo URL and saves nothing', async () => {
    const zoneId = (await prisma.zone.findFirst()).id
    const name = `CP-FIB-${STAMP}-bad`
    const res = await request(app)
      .post('/api/v1/fibers')
      .set(...auth)
      .send({ ...fiberBody({ images: ['https://evil.example.com/x.jpg'] }, 'bad'), zoneId })
    expect(res.status).toBe(400)
    expect(await prisma.fiber.findFirst({ where: { name } })).toBeNull()
    // The transaction rolls back: no closure was minted at the drawn point.
    expect(await prisma.closure.count({ where: { createdById: ADMIN, latitude: 18.611 } })).toBe(0)
  })
})
