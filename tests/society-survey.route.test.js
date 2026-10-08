import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

// Society permissions, phase 3: site survey + material request
// (.superpowers/sdd/2026-10-08-society-survey/design.md).
const app = createApp()
const auth = (id, role) => [
  'Authorization',
  `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
]

const S = `ss-${Date.now()}`
const U = {
  PE: { id: `${S}-pe`, role: 'PERMISSION_EXECUTIVE' },
  PE2: { id: `${S}-pe2`, role: 'PERMISSION_EXECUTIVE' },
  ADMIN: { id: `${S}-admin`, role: 'ADMIN' },
  MANAGER: { id: `${S}-mgr`, role: 'MANAGER' },
  SUPERVISOR: { id: `${S}-sup`, role: 'SUPERVISOR' },
  SURVEYOR: { id: `${S}-sur`, role: 'SURVEYOR' }, // zone Z1
  SURVEYOR2: { id: `${S}-sur2`, role: 'SURVEYOR' }, // zone Z2
  SALES_MANAGER: { id: `${S}-sm`, role: 'SALES_MANAGER' },
}
const as = (key) => auth(U[key].id, U[key].role)
let OP = null
let Z1 = null
let Z2 = null

const base = '/api/v1/permission-buildings'
const society = (extra = {}) => ({
  buildingName: `${S} Society ${Math.random().toString(36).slice(2, 8)}`,
  formattedAddress: `${S} Kothrud, Pune`,
  latitude: 18.5074,
  longitude: 73.8077,
  details: { wings: 2, floors: 5, homePass: 40 },
  contact: { contactName: 'R Joshi', contactPhone: '9876500000', designation: 'CHAIRMAN' },
  permission: { permissionStatus: 'ACCEPTED', societyOffer: 'DEMO', demoCount: 1 },
  remark: 'Met the chairman',
  ...extra,
})

/** A society the PE added (ACCEPTED → PENDING); `zone` set → ADMIN approves it there. */
async function makeSociety(zone = Z1) {
  const res = await request(app).post('/api/v1/buildings').set(...as('PE')).send(society())
  expect(res.status).toBe(201)
  const b = res.body.data
  if (zone) {
    const ok = await request(app).post(`${base}/${b.id}/approve`).set(...as('ADMIN')).send({ zoneId: zone })
    expect(ok.status).toBe(200)
  }
  return b
}

const goodSurvey = (extra = {}) => ({
  checks: { nameOk: true, wingsOk: true, homePassOk: false, note: 'Wing B has 6 floors' },
  wings: [
    { name: 'A', floors: 5, flatsPerFloor: 4, shafts: 1, homePass: 20 },
    { name: 'B', floors: 6, flatsPerFloor: 4, shafts: 1, homePass: 24 },
  ],
  links: [{ from: 'A', to: 'B', method: 'AERIAL', meters: 30 }],
  materials: { FIBER_12F: 120, FAT_BOX: 2, PATCH_LC_SC: 0 },
  ...extra,
})

const getSurvey = (id, key) => request(app).get(`${base}/${id}/survey`).set(...as(key))
const putSurvey = (id, body, key = 'SURVEYOR') => request(app).put(`${base}/${id}/survey`).set(...as(key)).send(body)
const submit = (id, key = 'SURVEYOR', body = {}) =>
  request(app).post(`${base}/${id}/survey/submit`).set(...as(key)).send(body)
const approveM = (id, body = {}, key = 'ADMIN') =>
  request(app).post(`${base}/${id}/survey/approve`).set(...as(key)).send(body)
const rejectM = (id, body, key = 'ADMIN') =>
  request(app).post(`${base}/${id}/survey/reject`).set(...as(key)).send(body)
const markLive = (id, key = 'SURVEYOR', body = {}) =>
  request(app).post(`${base}/${id}/mark-live`).set(...as(key)).send(body)
const detail = async (id, key = 'ADMIN') => {
  const res = await request(app).get(`${base}/${id}`).set(...as(key))
  expect(res.status).toBe(200)
  return res.body.data
}
const listIds = async (key, query = '') => {
  const res = await request(app).get(`${base}?pageSize=100&search=${encodeURIComponent(S)}${query}`).set(...as(key))
  expect(res.status).toBe(200)
  return res.body.data.items.map((i) => i.id)
}

/** A society with a SUBMITTED survey. */
async function submitted(zone = Z1) {
  const b = await makeSociety(zone)
  const surveyor = zone === Z2 ? 'SURVEYOR2' : 'SURVEYOR'
  expect((await putSurvey(b.id, goodSurvey(), surveyor)).status).toBe(200)
  expect((await submit(b.id, surveyor)).status).toBe(200)
  return b
}

/** A society with APPROVED materials. */
async function approvedMaterials(zone = Z1) {
  const b = await submitted(zone)
  expect((await approveM(b.id)).status).toBe(200)
  return b
}

beforeAll(async () => {
  OP = await prisma.operator.create({ data: { name: `${S} Operator` } })
  Z1 = (await prisma.zone.create({ data: { name: `${S} Zone 1`, city: 'Pune', operatorId: OP.id } })).id
  Z2 = (await prisma.zone.create({ data: { name: `${S} Zone 2`, city: 'Pune', operatorId: OP.id } })).id
  for (const [key, u] of Object.entries(U)) {
    await prisma.user.create({
      data: {
        id: u.id,
        name: `${S} ${key}`,
        email: `${u.id}@v.local`,
        passwordHash: 'x',
        role: u.role,
        ...(key === 'SURVEYOR' && { assignedZones: { connect: { id: Z1 } } }),
        ...(key === 'SURVEYOR2' && { assignedZones: { connect: { id: Z2 } } }),
      },
    })
  }
})

afterAll(async () => {
  const ids = Object.values(U).map((u) => u.id)
  await prisma.building.deleteMany({ where: { buildingName: { startsWith: S } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await prisma.zone.deleteMany({ where: { id: { in: [Z1, Z2] } } })
  await prisma.operator.deleteMany({ where: { id: OP.id } })
})

describe('the zone surveyor reads the executive’s work', () => {
  let b = null
  beforeAll(async () => {
    b = await makeSociety(Z1)
    // The letter + an entrance photo, as the executive's edit would leave them.
    await prisma.photo.createMany({
      data: [
        { buildingId: b.id, type: 'PERMISSION_LETTER', url: `${S}/letter.pdf` },
        { buildingId: b.id, type: 'ENTRANCE', url: `${S}/gate.jpg` },
      ],
    })
    await prisma.permission.update({ where: { buildingId: b.id }, data: { documentUrl: `${S}/letter.pdf` } })
  })

  it('GET /buildings/:id carries contact, permission details and every photo incl. the letter', async () => {
    const res = await request(app).get(`/api/v1/buildings/${b.id}`).set(...as('SURVEYOR'))
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.contact).toMatchObject({ contactName: 'R Joshi', contactPhone: '9876500000' })
    expect(d.permission).toMatchObject({ permissionStatus: 'ACCEPTED', societyOffer: 'DEMO' })
    expect(d.permission.documentUrl).toBeTruthy()
    expect(d.photos.map((p) => p.type).sort()).toEqual(['ENTRANCE', 'PERMISSION_LETTER'])
  })

  it('GET /permission-buildings/:id is open to them too, with the history', async () => {
    const d = await detail(b.id, 'SURVEYOR')
    expect(d.contact.contactName).toBe('R Joshi')
    expect(d.permission.documentUrl).toBeTruthy()
    expect(d.photos).toHaveLength(2)
    expect(d.visits.length).toBeGreaterThan(0)
    expect(d.survey).toBeNull()
    expect(d.isLive).toBe(false)
  })

  it('a surveyor of another zone gets 404 on both', async () => {
    expect((await request(app).get(`/api/v1/buildings/${b.id}`).set(...as('SURVEYOR2'))).status).toBe(404)
    expect((await request(app).get(`${base}/${b.id}`).set(...as('SURVEYOR2'))).status).toBe(404)
    expect((await getSurvey(b.id, 'SURVEYOR2')).status).toBe(404)
  })

  it('the surveyor cannot add a visit update (403)', async () => {
    const res = await request(app).post(`${base}/${b.id}/visits`).set(...as('SURVEYOR')).send({ remark: 'x' })
    expect(res.status).toBe(403)
  })
})

describe('the society list for surveyors, managers and supervisors', () => {
  let mine = null
  let other = null
  let waiting = null
  beforeAll(async () => {
    mine = await makeSociety(Z1)
    other = await makeSociety(Z2)
    waiting = await makeSociety(null)
  })

  it('a surveyor sees approved societies of their zones only', async () => {
    const ids = await listIds('SURVEYOR')
    expect(ids).toContain(mine.id)
    expect(ids).not.toContain(other.id)
    expect(ids).not.toContain(waiting.id)
    const ids2 = await listIds('SURVEYOR2')
    expect(ids2).toContain(other.id)
    expect(ids2).not.toContain(mine.id)
  })

  it('a surveyor cannot open a waiting society (404)', async () => {
    expect((await request(app).get(`${base}/${waiting.id}`).set(...as('SURVEYOR'))).status).toBe(404)
    expect((await getSurvey(waiting.id, 'SURVEYOR')).status).toBe(404)
    expect((await putSurvey(waiting.id, goodSurvey())).status).toBe(404)
  })

  for (const key of ['MANAGER', 'SUPERVISOR']) {
    it(`${key} sees every approved society, read-only`, async () => {
      const ids = await listIds(key)
      expect(ids).toEqual(expect.arrayContaining([mine.id, other.id]))
      expect(ids).not.toContain(waiting.id)
      expect((await request(app).get(`${base}/${waiting.id}`).set(...as(key))).status).toBe(404)
      expect((await getSurvey(mine.id, key)).status).toBe(200)
      expect((await putSurvey(mine.id, goodSurvey(), key)).status).toBe(403)
    })
  }

  it('a forged createdById does not widen a surveyor', async () => {
    const ids = await listIds('SURVEYOR', `&createdById=${U.PE.id}`)
    expect(ids).not.toContain(waiting.id)
    expect(ids).not.toContain(other.id)
  })

  it('sales roles are still refused', async () => {
    expect((await request(app).get(base).set(...as('SALES_MANAGER'))).status).toBe(403)
  })

  it('items carry survey and isLive', async () => {
    const res = await request(app).get(`${base}?pageSize=100&search=${encodeURIComponent(S)}`).set(...as('SURVEYOR'))
    const item = res.body.data.items.find((i) => i.id === mine.id)
    expect(item).toMatchObject({ survey: null, isLive: false, stage: 'APPROVED_NO_SURVEY' })
  })
})

describe('saving a survey', () => {
  let b = null
  beforeAll(async () => {
    b = await makeSociety(Z1)
  })

  it('starts as null', async () => {
    const res = await getSurvey(b.id, 'SURVEYOR')
    expect(res.status).toBe(200)
    expect(res.body.data).toBeNull()
  })

  it('the zone surveyor saves a draft; zero quantities are dropped', async () => {
    const res = await putSurvey(b.id, goodSurvey())
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      status: 'DRAFT',
      buildingId: b.id,
      checks: { nameOk: true, wingsOk: true, homePassOk: false, note: 'Wing B has 6 floors' },
      materials: { FIBER_12F: 120, FAT_BOX: 2 },
      rejectReason: null,
      submittedAt: null,
    })
    expect(res.body.data.wings).toHaveLength(2)
    expect(res.body.data.links).toEqual([{ from: 'A', to: 'B', method: 'AERIAL', meters: 30 }])
    const again = await getSurvey(b.id, 'SURVEYOR')
    expect(again.body.data.status).toBe('DRAFT')
    expect(again.body.data.materials).toEqual({ FIBER_12F: 120, FAT_BOX: 2 })
  })

  it('the executive reads it but cannot save (403); another executive 404', async () => {
    expect((await getSurvey(b.id, 'PE')).status).toBe(200)
    expect((await putSurvey(b.id, goodSurvey(), 'PE')).status).toBe(403)
    expect((await getSurvey(b.id, 'PE2')).status).toBe(404)
    expect((await putSurvey(b.id, goodSurvey(), 'PE2')).status).toBe(404)
  })

  it('a surveyor of another zone gets 404', async () => {
    expect((await putSurvey(b.id, goodSurvey(), 'SURVEYOR2')).status).toBe(404)
    expect((await submit(b.id, 'SURVEYOR2')).status).toBe(404)
  })

  it('the detail and the list carry the survey summary', async () => {
    const d = await detail(b.id, 'SURVEYOR')
    expect(d.survey).toMatchObject({ status: 'DRAFT', submittedAt: null, decidedAt: null })
  })

  describe('validation', () => {
    const bad = async (body) => {
      const res = await putSurvey(b.id, body)
      expect(res.status).toBe(400)
      return res
    }
    it('unknown material key', () => bad(goodSurvey({ materials: { GOLD_CABLE: 3 } })))
    it('negative, fractional or huge quantity', async () => {
      await bad(goodSurvey({ materials: { FIBER_4F: -1 } }))
      await bad(goodSurvey({ materials: { FIBER_4F: 1.5 } }))
      await bad(goodSurvey({ materials: { FIBER_4F: 100001 } }))
    })
    it('link to an unknown wing', () => bad(goodSurvey({ links: [{ from: 'A', to: 'C', method: 'TRAY' }] })))
    it('link from a wing to itself', () => bad(goodSurvey({ links: [{ from: 'A', to: 'a', method: 'TRAY' }] })))
    it('bad link method', () => bad(goodSurvey({ links: [{ from: 'A', to: 'B', method: 'WIFI' }] })))
    it('duplicate wing names (case-insensitive)', () =>
      bad(
        goodSurvey({
          wings: [
            { name: 'A', floors: 1, flatsPerFloor: 1, shafts: 0, homePass: 1 },
            { name: ' a ', floors: 1, flatsPerFloor: 1, shafts: 0, homePass: 1 },
          ],
          links: [],
        }),
      ))
    it('wing name too long / empty, negative ints', async () => {
      await bad(goodSurvey({ wings: [{ name: 'x'.repeat(21), floors: 1, flatsPerFloor: 1, shafts: 0, homePass: 1 }], links: [] }))
      await bad(goodSurvey({ wings: [{ name: '  ', floors: 1, flatsPerFloor: 1, shafts: 0, homePass: 1 }], links: [] }))
      await bad(goodSurvey({ wings: [{ name: 'A', floors: -1, flatsPerFloor: 1, shafts: 0, homePass: 1 }], links: [] }))
    })
    it('more than 26 wings', () =>
      bad(
        goodSurvey({
          wings: Array.from({ length: 27 }, (_, i) => ({ name: `W${i}`, floors: 1, flatsPerFloor: 1, shafts: 0, homePass: 1 })),
          links: [],
        }),
      ))
    it('unknown keys are refused (strict)', async () => {
      await bad({ ...goodSurvey(), status: 'APPROVED' })
      await bad(goodSurvey({ checks: { nameOk: true, wingsOk: true, homePassOk: true, extra: 1 } }))
    })
    it('a duplicate link (same wings + method, either direction) is refused', async () => {
      const dup = (links) => bad(goodSurvey({ links }))
      const r1 = await dup([
        { from: 'A', to: 'B', method: 'AERIAL' },
        { from: 'a', to: 'b', method: 'AERIAL', meters: 5 },
      ])
      expect(r1.body.error.message).toBe('That link is already listed')
      const r2 = await dup([
        { from: 'A', to: 'B', method: 'TRAY' },
        { from: 'B', to: 'A', method: 'TRAY' },
      ])
      expect(r2.body.error.message).toBe('That link is already listed')
    })
    it('the same wings by two different methods is fine', async () => {
      const res = await putSurvey(
        b.id,
        goodSurvey({ links: [{ from: 'A', to: 'B', method: 'AERIAL' }, { from: 'B', to: 'A', method: 'UNDERGROUND' }] }),
      )
      expect(res.status).toBe(200)
    })
    it('link names are stored in the wing’s own spelling', async () => {
      const res = await putSurvey(b.id, goodSurvey({ links: [{ from: ' a ', to: 'b', method: 'TRAY', meters: 12 }] }))
      expect(res.status).toBe(200)
      expect(res.body.data.links).toEqual([{ from: 'A', to: 'B', method: 'TRAY', meters: 12 }])
    })
    it('removing a wing a stored link uses is refused', () =>
      bad({ wings: [{ name: 'A', floors: 5, flatsPerFloor: 4, shafts: 1, homePass: 20 }] }))
  })
})

describe('submitting', () => {
  it('needs at least one wing and one material', async () => {
    const b = await makeSociety(Z1)
    expect((await submit(b.id)).status).toBe(409) // nothing saved yet
    expect((await putSurvey(b.id, goodSurvey({ wings: [], links: [] }))).status).toBe(200)
    expect((await submit(b.id)).status).toBe(400)
    expect((await putSurvey(b.id, goodSurvey({ materials: { FIBER_4F: 0 } }))).status).toBe(200)
    expect((await submit(b.id)).status).toBe(400)
    expect((await putSurvey(b.id, goodSurvey())).status).toBe(200)
    const res = await submit(b.id)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'SUBMITTED', submittedBy: { id: U.SURVEYOR.id } })
    expect(res.body.data.submittedAt).toBeTruthy()
    const d = await detail(b.id)
    expect(d.visits[0]).toMatchObject({ kind: 'SURVEY_SUBMITTED', remark: 'Survey submitted', user: { id: U.SURVEYOR.id } })
    expect((await submit(b.id)).status).toBe(409)
  })

  it('a surveyor edit while submitted stays SUBMITTED and logs SURVEY_EDITED with changes', async () => {
    const b = await submitted()
    const res = await putSurvey(b.id, goodSurvey({ materials: { FIBER_12F: 150, FAT_BOX: 2 } }))
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('SUBMITTED')
    const d = await detail(b.id)
    expect(d.visits[0]).toMatchObject({ kind: 'SURVEY_EDITED', changes: ['materials'], user: { id: U.SURVEYOR.id } })
  })

  it('the executive cannot submit (403)', async () => {
    const b = await makeSociety(Z1)
    await putSurvey(b.id, goodSurvey())
    expect((await submit(b.id, 'PE')).status).toBe(403)
  })

  it('pending-count counts submitted surveys (ADMIN only)', async () => {
    const count = async () => {
      const res = await request(app).get(`${base}/survey-pending-count`).set(...as('ADMIN'))
      expect(res.status).toBe(200)
      return res.body.data.count
    }
    const before = await count()
    const b = await submitted()
    expect(await count()).toBe(before + 1)
    await approveM(b.id)
    expect(await count()).toBe(before)
    expect((await request(app).get(`${base}/survey-pending-count`).set(...as('PE'))).status).toBe(403)
    expect((await request(app).get(`${base}/survey-pending-count`).set(...as('SURVEYOR'))).status).toBe(403)
  })
})

describe('approving and rejecting materials', () => {
  let b = null
  beforeAll(async () => {
    b = await submitted()
  })

  it('is ADMIN only', async () => {
    expect((await approveM(b.id, {}, 'SURVEYOR')).status).toBe(403)
    expect((await approveM(b.id, {}, 'MANAGER')).status).toBe(403)
    expect((await rejectM(b.id, { reason: 'x' }, 'PE')).status).toBe(403)
  })

  it('reject needs a reason', async () => {
    expect((await rejectM(b.id, {})).status).toBe(400)
    expect((await rejectM(b.id, { reason: '  ' })).status).toBe(400)
  })

  it('reject records the reason and a MATERIALS_REJECTED row', async () => {
    const res = await rejectM(b.id, { reason: '  Too much fibre  ' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'REJECTED', rejectReason: 'Too much fibre', decidedBy: { id: U.ADMIN.id } })
    const d = await detail(b.id, 'SURVEYOR')
    expect(d.visits[0]).toMatchObject({ kind: 'MATERIALS_REJECTED', remark: 'Too much fibre' })
    expect(d.survey.status).toBe('REJECTED')
  })

  it('a decision on a non-submitted survey is a 409', async () => {
    expect((await approveM(b.id)).status).toBe(409)
    expect((await rejectM(b.id, { reason: 'again' })).status).toBe(409)
  })

  it('the surveyor saves (→ DRAFT, reason kept) and resubmits', async () => {
    const res = await putSurvey(b.id, goodSurvey({ materials: { FIBER_12F: 80, FAT_BOX: 2 } }))
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'DRAFT', rejectReason: 'Too much fibre' })
    const sub = await submit(b.id)
    expect(sub.status).toBe(200)
    expect(sub.body.data.status).toBe('SUBMITTED')
  })

  it('approve sets APPROVED with a MATERIALS_APPROVED row (note or fixed text)', async () => {
    const res = await approveM(b.id, { note: 'Take it from store 2' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ status: 'APPROVED', rejectReason: null, decidedBy: { id: U.ADMIN.id } })
    const d = await detail(b.id)
    expect(d.visits[0]).toMatchObject({ kind: 'MATERIALS_APPROVED', remark: 'Take it from store 2' })
    expect((await approveM(b.id)).status).toBe(409)
  })

  it('after approval the surveyor is locked out', async () => {
    const res = await putSurvey(b.id, goodSurvey())
    expect(res.status).toBe(403)
    expect((await submit(b.id)).status).toBe(409)
  })

  it('an ADMIN edit after approval needs a remark and logs SURVEY_EDITED with changes', async () => {
    const body = goodSurvey({ materials: { FIBER_12F: 90, FAT_BOX: 2 } })
    expect((await putSurvey(b.id, body, 'ADMIN')).status).toBe(400)
    const res = await putSurvey(b.id, { ...body, remark: 'Store had only 90 m' }, 'ADMIN')
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('APPROVED')
    expect(res.body.data.materials).toEqual({ FIBER_12F: 90, FAT_BOX: 2 })
    const d = await detail(b.id)
    expect(d.visits[0]).toMatchObject({
      kind: 'SURVEY_EDITED',
      remark: 'Store had only 90 m',
      changes: ['materials'],
      user: { id: U.ADMIN.id },
    })
  })
})

describe('marking live', () => {
  it('only after materials are approved', async () => {
    const b = await submitted()
    expect((await markLive(b.id)).status).toBe(409)
    const fresh = await makeSociety(Z1)
    expect((await markLive(fresh.id)).status).toBe(409)
  })

  it('only the zone surveyor or an ADMIN', async () => {
    const b = await approvedMaterials()
    expect((await markLive(b.id, 'SURVEYOR2')).status).toBe(404)
    expect((await markLive(b.id, 'PE')).status).toBe(403)
    expect((await markLive(b.id, 'MANAGER')).status).toBe(403)
    expect((await markLive(b.id, 'SUPERVISOR')).status).toBe(403)
    expect((await markLive(b.id, 'PE2')).status).toBe(404)
  })

  it('sets isLive, logs MARKED_LIVE, and a second time is a 409', async () => {
    const b = await approvedMaterials()
    const res = await markLive(b.id)
    expect(res.status).toBe(200)
    expect(res.body.data.isLive).toBe(true)
    const row = await prisma.building.findUnique({ where: { id: b.id }, select: { isLive: true } })
    expect(row.isLive).toBe(true)
    const d = await detail(b.id)
    expect(d.visits[0]).toMatchObject({ kind: 'MARKED_LIVE', remark: 'Marked live', user: { id: U.SURVEYOR.id } })
    expect((await markLive(b.id)).status).toBe(409)
    // The audit row is written after the response finishes — poll briefly.
    let log = null
    for (let i = 0; i < 20 && !log; i++) {
      log = await prisma.systemLog.findFirst({
        where: { userId: U.SURVEYOR.id, action: 'MarkLive', status: 'SUCCESS', recordId: b.id },
      })
      if (!log) await new Promise((r) => setTimeout(r, 50))
    }
    expect(log).toBeTruthy()
  })

  it('once live the surveyor can no longer save or submit (409); an ADMIN still can', async () => {
    const b = await approvedMaterials()
    expect((await markLive(b.id)).status).toBe(200)
    const save = await putSurvey(b.id, goodSurvey({ materials: { FIBER_12F: 1 } }))
    expect(save.status).toBe(409)
    expect(save.body.error.message).toBe('Already live')
    const sub = await submit(b.id)
    expect(sub.status).toBe(409)
    expect(sub.body.error.message).toBe('Already live')
    const admin = await putSurvey(b.id, { materials: { FIBER_12F: 100, FAT_BOX: 2 }, remark: 'Actual use' }, 'ADMIN')
    expect(admin.status).toBe(200)
  })

  it('a society moved to another zone is out of the old surveyor’s reach (404)', async () => {
    const b = await approvedMaterials()
    await prisma.building.update({ where: { id: b.id }, data: { zoneId: Z2 } })
    expect((await markLive(b.id)).status).toBe(404)
    expect((await putSurvey(b.id, goodSurvey())).status).toBe(404)
  })

  it('an ADMIN may mark live too (no body at all is fine)', async () => {
    const b = await approvedMaterials()
    const res = await request(app).post(`${base}/${b.id}/mark-live`).set(...as('ADMIN'))
    expect(res.status).toBe(200)
    expect(res.body.data.isLive).toBe(true)
  })

  it('a non-approved society is out of reach for the surveyor (404) and a 409 for an ADMIN', async () => {
    const waiting = await makeSociety(null)
    expect((await markLive(waiting.id)).status).toBe(404)
    expect((await markLive(waiting.id, 'ADMIN')).status).toBe(409)
    expect((await putSurvey(waiting.id, goodSurvey(), 'ADMIN')).status).toBe(409)
    const g = await getSurvey(waiting.id, 'ADMIN')
    expect(g.status).toBe(200)
    expect(g.body.data).toBeNull()
  })

  it('the existing live routes still refuse surveyors', async () => {
    const b = await makeSociety(Z1)
    expect((await request(app).patch(`/api/v1/buildings/${b.id}/status`).set(...as('SURVEYOR')).send({ isLive: true })).status).toBe(403)
    expect((await request(app).patch('/api/v1/buildings/bulk-status').set(...as('SURVEYOR')).send({ ids: [b.id], isLive: true })).status).toBe(403)
    expect((await request(app).patch(`/api/v1/buildings/${b.id}`).set(...as('SURVEYOR')).send({ isLive: true, remark: 'x' })).status).toBe(403)
    const row = await prisma.building.findUnique({ where: { id: b.id }, select: { isLive: true } })
    expect(row.isLive).toBe(false)
  })
})

describe('list stage filter', () => {
  let noSurvey, sub, mat, live, waiting
  beforeAll(async () => {
    noSurvey = await makeSociety(Z1)
    sub = await submitted()
    mat = await approvedMaterials()
    live = await approvedMaterials()
    expect((await markLive(live.id)).status).toBe(200)
    waiting = await makeSociety(null)
  })

  const cases = () => [
    ['APPROVAL_PENDING', () => waiting],
    ['APPROVED_NO_SURVEY', () => noSurvey],
    ['SURVEY_SUBMITTED', () => sub],
    ['MATERIALS_APPROVED', () => mat],
    ['LIVE', () => live],
  ]
  it('each stage holds exactly its society (of these five)', async () => {
    const all = [waiting, noSurvey, sub, mat, live].map((b) => b.id)
    for (const [stage, pick] of cases()) {
      const ids = (await listIds('ADMIN', `&stage=${stage}`)).filter((id) => all.includes(id))
      expect(ids, stage).toEqual([pick().id])
    }
  })

  it('the items carry the stage, survey summary and isLive', async () => {
    const res = await request(app).get(`${base}?pageSize=100&search=${encodeURIComponent(S)}`).set(...as('ADMIN'))
    const byId = new Map(res.body.data.items.map((i) => [i.id, i]))
    expect(byId.get(live.id)).toMatchObject({ isLive: true, stage: 'LIVE', survey: { status: 'APPROVED' } })
    expect(byId.get(sub.id)).toMatchObject({ isLive: false, stage: 'SURVEY_SUBMITTED', survey: { status: 'SUBMITTED' } })
    expect(byId.get(sub.id).survey.submittedAt).toBeTruthy()
    expect(byId.get(waiting.id)).toMatchObject({ stage: 'APPROVAL_PENDING', survey: null })
  })

  it('a bad stage is a 400', async () => {
    expect((await request(app).get(`${base}?stage=NOPE`).set(...as('ADMIN'))).status).toBe(400)
  })
})

describe('misc', () => {
  it('a coverage building is not reachable', async () => {
    const cov = await prisma.building.create({
      data: {
        buildingName: `${S} Coverage`,
        formattedAddress: 'x',
        latitude: 18.5,
        longitude: 73.8,
        zoneId: Z1,
        createdById: U.ADMIN.id,
      },
    })
    expect((await getSurvey(cov.id, 'ADMIN')).status).toBe(404)
    expect((await putSurvey(cov.id, goodSurvey(), 'ADMIN')).status).toBe(404)
    expect((await markLive(cov.id, 'ADMIN')).status).toBe(404)
  })

  it('the catalogue is served', async () => {
    const res = await request(app).get(`${base}/survey-catalogue`).set(...as('SURVEYOR'))
    expect(res.status).toBe(200)
    expect(res.body.data.materials).toHaveLength(31)
    expect(res.body.data.materials[0]).toEqual({ key: 'FIBER_4F', label: '4F', unit: 'm', group: 'Fiber' })
    expect(res.body.data.linkMethods).toEqual(['AERIAL', 'UNDERGROUND', 'TRAY'])
  })
})
