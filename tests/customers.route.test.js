import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { customerRepository } from '../src/modules/customers/customer.repository.js'

const app = createApp()
const S = `cust-${Date.now()}`
const auth = (id, role) => ({
  Authorization: `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`,
})
const IDS = { admin: `${S}-admin`, surveyor: `${S}-sv`, other: `${S}-sv2`, manager: `${S}-mgr` }
const ADMIN = auth(IDS.admin, 'ADMIN')
const SV = auth(IDS.surveyor, 'SURVEYOR')
const OTHER = auth(IDS.other, 'SURVEYOR')
const MGR = auth(IDS.manager, 'MANAGER')

let zone, mine, theirs
const post = (body, who = ADMIN) => request(app).post('/api/v1/customers').set(who).send(body)
const list = (buildingId, who = ADMIN) =>
  request(app).get('/api/v1/customers').query({ buildingId }).set(who)

beforeAll(async () => {
  zone = await prisma.zone.create({ data: { name: `${S}-z`, city: 'Test' } })
  await prisma.user.create({ data: { id: IDS.admin, name: 'A', email: `${IDS.admin}@t.local`, passwordHash: 'x', role: 'ADMIN' } })
  await prisma.user.create({ data: { id: IDS.surveyor, name: 'S', email: `${IDS.surveyor}@t.local`, passwordHash: 'x', role: 'SURVEYOR' } })
  await prisma.user.create({ data: { id: IDS.other, name: 'O', email: `${IDS.other}@t.local`, passwordHash: 'x', role: 'SURVEYOR' } })
  await prisma.user.create({ data: { id: IDS.manager, name: 'M', email: `${IDS.manager}@t.local`, passwordHash: 'x', role: 'MANAGER' } })
  mine = await prisma.building.create({
    data: { buildingName: `${S} Vardhaman Vatika Phase 1`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId: zone.id, createdById: IDS.surveyor },
  })
  theirs = await prisma.building.create({
    data: { buildingName: `${S} Other Tower`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId: zone.id, createdById: IDS.admin },
  })
})

afterAll(async () => {
  await prisma.customer.deleteMany({ where: { building: { buildingName: { startsWith: S } } } })
  await prisma.building.deleteMany({ where: { buildingName: { startsWith: S } } })
  await prisma.systemLog.deleteMany({ where: { userId: { in: Object.values(IDS) } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: Object.values(IDS) } } })
  await prisma.zone.delete({ where: { id: zone.id } })
})

describe('POST /customers', () => {
  it('the repository has the methods the service calls', () => {
    for (const method of ['listByBuilding', 'findById', 'findByBuildingAndMobile', 'create', 'update', 'remove', 'createMany', 'listMobilesForBuildings', 'findBuildingIds', 'listBuildingsForLookup']) {
      expect(typeof customerRepository[method]).toBe('function')
    }
  })

  it('adds a customer and normalises the mobile number', async () => {
    const res = await post({ buildingId: mine.id, name: 'Ramesh Patil', mobile: '+91 98674 12726', planAmount: 500 })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ name: 'Ramesh Patil', mobile: '9867412726', planAmount: 500, buildingId: mine.id })
    expect(res.body.data.createdById).toBe(IDS.admin)
  })

  it('refuses the same mobile in the same building', async () => {
    const res = await post({ buildingId: mine.id, name: 'Ramesh Again', mobile: '919867412726' })
    expect(res.status).toBe(409)
    expect(res.body.error.message).toMatch(/already exists/i)
  })

  it('allows the same mobile in a different building (a second connection)', async () => {
    const res = await post({ buildingId: theirs.id, name: 'Ramesh Patil', mobile: '9867412726' })
    expect(res.status).toBe(201)
  })

  it('refuses a missing name or mobile', async () => {
    expect((await post({ buildingId: mine.id, mobile: '9999999999' })).status).toBe(400)
    expect((await post({ buildingId: mine.id, name: 'No Number' })).status).toBe(400)
  })

  it('404s an unknown building, and is ADMIN-only', async () => {
    expect((await post({ buildingId: 'nope', name: 'X', mobile: '9000000001' })).status).toBe(404)
    expect((await post({ buildingId: mine.id, name: 'X', mobile: '9000000002' }, SV)).status).toBe(403)
  })

  it('turns blank optional fields into null, and reads a yes/no auto renewal', async () => {
    const res = await post({ buildingId: mine.id, name: 'Blanky', mobile: '9000000003', email: '', planName: '  ', autoRenewal: 'YES' })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ email: null, planName: null, autoRenewal: true })
  })
})

describe('GET /customers', () => {
  it('lists a building’s customers for the admin', async () => {
    const res = await list(mine.id)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBeGreaterThanOrEqual(2)
  })

  it('requires a buildingId', async () => {
    expect((await request(app).get('/api/v1/customers').set(ADMIN)).status).toBe(400)
  })

  it('follows the building’s scope — the owner reads, a stranger 404s', async () => {
    expect((await list(mine.id, SV)).status).toBe(200)
    expect((await list(mine.id, OTHER)).status).toBe(404)
  })

  it('a manager reads its assigned zone’s buildings but cannot write', async () => {
    await post({ buildingId: theirs.id, name: 'Zone Read', mobile: '9000000040' })
    expect((await list(theirs.id, MGR)).status).toBe(404) // not yet in a zone it manages
    await prisma.zone.update({ where: { id: zone.id }, data: { assignedUsers: { connect: { id: IDS.manager } } } })
    expect((await list(theirs.id, MGR)).status).toBe(200)
    expect((await post({ buildingId: theirs.id, name: 'Nope', mobile: '9000000041' }, MGR)).status).toBe(403)
  })
})

describe('GET /customers/:id', () => {
  it('returns one customer with its building, and 404s an unknown id', async () => {
    const created = (await post({ buildingId: mine.id, name: 'Detail Me', mobile: '9000000060' })).body.data
    const res = await request(app).get(`/api/v1/customers/${created.id}`).set(ADMIN)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: created.id, name: 'Detail Me', mobile: '9000000060' })
    expect(res.body.data.building).toMatchObject({ id: mine.id, buildingName: mine.buildingName })
    expect((await request(app).get('/api/v1/customers/nope').set(ADMIN)).status).toBe(404)
  })

  it('follows the building’s scope — the owner reads, a stranger 404s', async () => {
    const created = (await post({ buildingId: mine.id, name: 'Scoped', mobile: '9000000061' })).body.data
    expect((await request(app).get(`/api/v1/customers/${created.id}`).set(SV)).status).toBe(200)
    expect((await request(app).get(`/api/v1/customers/${created.id}`).set(OTHER)).status).toBe(404)
  })
})

describe('PATCH /customers/:id', () => {
  it('updates fields, and 404s an unknown id', async () => {
    const created = (await post({ buildingId: mine.id, name: 'Edit Me', mobile: '9000000010' })).body.data
    const res = await request(app).patch(`/api/v1/customers/${created.id}`).set(ADMIN).send({ name: 'Edited', planAmount: 750 })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ name: 'Edited', planAmount: 750 })
    expect((await request(app).patch('/api/v1/customers/nope').set(ADMIN).send({ name: 'x' })).status).toBe(404)
  })

  it('refuses a mobile already used by another customer here', async () => {
    const a = (await post({ buildingId: mine.id, name: 'A', mobile: '9000000011' })).body.data
    const b = (await post({ buildingId: mine.id, name: 'B', mobile: '9000000012' })).body.data
    expect((await request(app).patch(`/api/v1/customers/${b.id}`).set(ADMIN).send({ mobile: '9000000011' })).status).toBe(409)
    // its own number is not a clash
    expect((await request(app).patch(`/api/v1/customers/${a.id}`).set(ADMIN).send({ mobile: '9000000011' })).status).toBe(200)
  })

  it('refuses clearing the name and an empty body', async () => {
    const created = (await post({ buildingId: mine.id, name: 'Keep Name', mobile: '9000000013' })).body.data
    expect((await request(app).patch(`/api/v1/customers/${created.id}`).set(ADMIN).send({ name: '' })).status).toBe(400)
    expect((await request(app).patch(`/api/v1/customers/${created.id}`).set(ADMIN).send({})).status).toBe(400)
  })
})

describe('DELETE /customers/:id', () => {
  it('removes the row, and 404s an unknown id', async () => {
    const created = (await post({ buildingId: mine.id, name: 'Gone', mobile: '9000000020' })).body.data
    expect((await request(app).delete(`/api/v1/customers/${created.id}`).set(ADMIN)).status).toBe(200)
    expect(await prisma.customer.findUnique({ where: { id: created.id } })).toBeNull()
    expect((await request(app).delete('/api/v1/customers/nope').set(ADMIN)).status).toBe(404)
  })
})

describe('POST /customers/building-lookup', () => {
  const lookup = (names) => request(app).post('/api/v1/customers/building-lookup').set(ADMIN).send({ names })

  it('matches a name exactly, and folds punctuation', async () => {
    const res = await lookup([`${S} Vardhaman Vatika Phase 1`, `${S} vardhaman vatika, phase1`])
    expect(res.status).toBe(200)
    expect(res.body.data[`${S} Vardhaman Vatika Phase 1`].matches).toHaveLength(1)
    expect(res.body.data[`${S} vardhaman vatika, phase1`].matches[0].id).toBe(mine.id)
  })

  it('returns every match for an ambiguous name, and none for an unknown one', async () => {
    await prisma.building.create({
      data: { buildingName: `${S} Morya Residency`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId: zone.id, createdById: IDS.admin },
    })
    await prisma.building.create({
      data: { buildingName: `${S} Morya Residency`, formattedAddress: 'y', latitude: 18.6, longitude: 73.9, zoneId: zone.id, createdById: IDS.admin },
    })
    const res = await lookup([`${S} morya residency`, `${S} nothing here`])
    expect(res.body.data[`${S} morya residency`].matches).toHaveLength(2)
    expect(res.body.data[`${S} nothing here`].matches).toHaveLength(0)
  })

  it('is ADMIN-only', async () => {
    expect((await request(app).post('/api/v1/customers/building-lookup').set(SV).send({ names: ['x'] })).status).toBe(403)
  })
})

describe('POST /customers/import', () => {
  const run = (rows) => request(app).post('/api/v1/customers/import').set(ADMIN).send({ rows })

  it('creates the good rows and reports every skip with a reason', async () => {
    const res = await run([
      { row: 2, buildingId: mine.id, name: 'Sheet One', mobile: '919000000030', planAmount: 499, planValidityDays: 30 },
      { row: 3, buildingId: mine.id, name: 'Sheet One Again', mobile: '9000000030' }, // same mobile → duplicate in file
      { row: 4, buildingId: 'does-not-exist', name: 'Ghost', mobile: '9000000031' },
      { row: 5, buildingId: mine.id, name: '', mobile: '9000000032' },
      { row: 6, buildingId: mine.id, name: 'Ramesh Patil', mobile: '9867412726' }, // already stored
      { row: 7, buildingId: theirs.id, name: 'Second Building', mobile: '9000000030' }, // same mobile, other building → ok
    ])
    expect(res.status).toBe(201)
    expect(res.body.data.createdCount).toBe(2)
    const byRow = Object.fromEntries(res.body.data.skipped.map((s) => [s.row, s]))
    expect(byRow[3].reason).toMatch(/already recorded/i)
    expect(byRow[4].reason).toMatch(/building not found/i)
    expect(byRow[5].reason).toMatch(/name is missing/i)
    expect(byRow[6].reason).toMatch(/already recorded/i)
    expect(await prisma.customer.count({ where: { buildingId: mine.id, mobile: '9000000030' } })).toBe(1)
  })

  it('is ADMIN-only, and rejects an empty file', async () => {
    expect((await request(app).post('/api/v1/customers/import').set(SV).send({ rows: [{ row: 1, buildingId: mine.id, name: 'x', mobile: '9' }] })).status).toBe(403)
    expect((await run([])).status).toBe(400)
  })

  it('re-uploading the same file writes nothing and reports every row already recorded', async () => {
    const rows = [
      { row: 2, buildingId: mine.id, name: 'Repeat One', mobile: '9000000050' },
      { row: 3, buildingId: theirs.id, name: 'Repeat Two', mobile: '9000000051' },
    ]
    const first = await run(rows)
    expect(first.body.data.createdCount).toBe(2)
    const second = await run(rows)
    expect(second.status).toBe(201)
    expect(second.body.data.createdCount).toBe(0)
    expect(second.body.data.skipped).toHaveLength(2)
    expect(second.body.data.skipped.every((s) => /already recorded/i.test(s.reason))).toBe(true)
    expect(await prisma.customer.count({ where: { mobile: { in: ['9000000050', '9000000051'] } } })).toBe(2)
  })
})
