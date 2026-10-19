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

let zone, mine, theirs, wingA, wingB, wingX
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
  const wing = (buildingId, name) =>
    prisma.buildingWing.create({ data: { buildingId, name, latitude: 18.5, longitude: 73.8 } })
  wingA = await wing(mine.id, 'A')
  wingB = await wing(mine.id, 'B')
  wingX = await wing(theirs.id, 'X')
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
    for (const method of ['listByBuilding', 'findById', 'findByBuildingAndMobile', 'create', 'update', 'remove', 'findBuildingIds', 'listBuildingsForLookup', 'listWings', 'findWing', 'findByUsername', 'listWingsForBuildings', 'listForImport', 'listByUsernames', 'applyImport']) {
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
    expect(Array.isArray(res.body.data.customers)).toBe(true)
    expect(res.body.data.customers.length).toBeGreaterThanOrEqual(2)
  })

  it('list returns customers, the located wings and the building', async () => {
    const created = (await post({ buildingId: mine.id, name: 'Winged', mobile: '9000000070', wingId: wingA.id })).body.data
    const res = await list(mine.id)
    expect(res.body.data.wings.map((w) => w.name)).toEqual(['A', 'B'])
    expect(res.body.data.building).toMatchObject({ id: mine.id, buildingName: mine.buildingName })
    const row = res.body.data.customers.find((c) => c.id === created.id)
    expect(row.wing).toEqual({ id: wingA.id, name: 'A' })
    const plain = res.body.data.customers.find((c) => c.mobile === '9867412726')
    expect(plain.wing).toBeNull()
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
    expect(res.body.data.wing).toBeNull()
    expect(res.body.data.wings.map((w) => w.name)).toEqual(['A', 'B'])
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

describe('wings, PON/OLT and Username identity', () => {
  const patch = (id, body) => request(app).patch(`/api/v1/customers/${id}`).set(ADMIN).send(body)

  it('stores PON number and OLT', async () => {
    const res = await post({ buildingId: mine.id, name: 'Pon', mobile: '9000000071', ponNumber: '6', olt: 'DIAMOND ROCK' })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ ponNumber: '6', olt: 'DIAMOND ROCK', wingId: null })
  })

  it('refuses a wing from another building', async () => {
    const bad = await post({ buildingId: mine.id, name: 'Wrong Wing', mobile: '9000000072', wingId: wingX.id })
    expect(bad.status).toBe(400)
    expect(bad.body.error.message).toBe('That wing is not in this building')
    const ok = (await post({ buildingId: mine.id, name: 'Right Wing', mobile: '9000000073' })).body.data
    expect((await patch(ok.id, { wingId: wingX.id })).status).toBe(400)
    expect((await patch(ok.id, { wingId: 'no-such-wing' })).status).toBe(400)
  })

  it('PATCH wingId: null moves a customer to No wing', async () => {
    const c = (await post({ buildingId: mine.id, name: 'Move', mobile: '9000000074', wingId: wingA.id })).body.data
    expect(c.wingId).toBe(wingA.id)
    const res = await patch(c.id, { wingId: null })
    expect(res.status).toBe(200)
    expect(res.body.data.wingId).toBeNull()
    expect((await patch(c.id, { wingId: wingB.id })).body.data.wingId).toBe(wingB.id)
  })

  it('a duplicate Username is refused', async () => {
    expect((await post({ buildingId: mine.id, name: 'U1', mobile: '9000000075', username: `${S}-u1` })).status).toBe(201)
    const res = await post({ buildingId: theirs.id, name: 'U1b', mobile: '9000000076', username: `${S}-u1` })
    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe('A customer with this username already exists')
  })

  it('PATCH checks the Username against others, not itself', async () => {
    const a = (await post({ buildingId: mine.id, name: 'UA', mobile: '9000000080', username: `${S}-ua` })).body.data
    const b = (await post({ buildingId: mine.id, name: 'UB', mobile: '9000000081', username: `${S}-ub` })).body.data
    expect((await patch(a.id, { username: `${S}-ua`, name: 'UA2' })).status).toBe(200)
    expect((await patch(b.id, { username: `${S}-ua` })).status).toBe(409)
  })

  it('same mobile, different usernames are two customers', async () => {
    const one = await post({ buildingId: mine.id, name: 'Two Conn', mobile: '9000000077', username: `${S}-c1` })
    const two = await post({ buildingId: mine.id, name: 'Two Conn', mobile: '9000000077', username: `${S}-c2` })
    expect([one.status, two.status]).toEqual([201, 201])
  })

  it('no username: duplicate mobile in the building is refused', async () => {
    expect((await post({ buildingId: mine.id, name: 'N1', mobile: '9000000078' })).status).toBe(201)
    expect((await post({ buildingId: mine.id, name: 'N2', mobile: '9000000078' })).status).toBe(409)
  })

  it('deleting a wing drops its customers to No wing', async () => {
    const wing = await prisma.buildingWing.create({ data: { buildingId: mine.id, name: 'Temp', latitude: 18.5, longitude: 73.8 } })
    const c = (await post({ buildingId: mine.id, name: 'Orphan', mobile: '9000000079', wingId: wing.id })).body.data
    await prisma.buildingWing.delete({ where: { id: wing.id } })
    const after = await prisma.customer.findUnique({ where: { id: c.id } })
    expect(after.wingId).toBeNull()
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
    expect(byRow[3].reason).toBe('Duplicate in this file')
    expect(byRow[4].reason).toMatch(/building not found/i)
    expect(byRow[5].reason).toMatch(/name is missing/i)
    // already stored, same cells → matched by building + mobile, nothing to change
    expect(byRow[6]).toBeUndefined()
    expect(res.body.data.rows.find((r) => r.row === 6).outcome).toBe('unchanged')
    expect(await prisma.customer.count({ where: { buildingId: mine.id, mobile: '9000000030' } })).toBe(1)
  })

  it('is ADMIN-only, and rejects an empty file', async () => {
    expect((await request(app).post('/api/v1/customers/import').set(SV).send({ rows: [{ row: 1, buildingId: mine.id, name: 'x', mobile: '9' }] })).status).toBe(403)
    expect((await run([])).status).toBe(400)
  })

  it('re-uploading the same file writes nothing and reports every row unchanged', async () => {
    const rows = [
      { row: 2, buildingId: mine.id, name: 'Repeat One', mobile: '9000000050' },
      { row: 3, buildingId: theirs.id, name: 'Repeat Two', mobile: '9000000051' },
    ]
    const first = await run(rows)
    expect(first.body.data.createdCount).toBe(2)
    const second = await run(rows)
    expect(second.status).toBe(201)
    expect(second.body.data.createdCount).toBe(0)
    expect(second.body.data.skipped).toHaveLength(0)
    expect(second.body.data.unchangedCount).toBe(2)
    expect(await prisma.customer.count({ where: { mobile: { in: ['9000000050', '9000000051'] } } })).toBe(2)
  })
})

describe('POST /customers/import — upsert, dry run, wings, not in this sheet', () => {
  const run = (rows, extra = {}) =>
    request(app).post('/api/v1/customers/import').set(ADMIN).send({ rows, ...extra })
  const U = (n) => `${S}-i${n}`
  let imp
  const BASE = () => [
    { row: 2, sheet: 'Sheet1', buildingId: imp.id, username: U(1), name: 'Imp One', mobile: '9100000001', wing: 'wing a', email: 'a@x.in' },
    { row: 3, sheet: 'Sheet1', buildingId: imp.id, username: U(2), name: 'Imp Two', mobile: '9100000002', wing: 'C' },
  ]
  const stored = (username) => prisma.customer.findFirst({ where: { username } })
  const importLogs = () =>
    prisma.systemLog.count({ where: { userId: IDS.admin, module: 'Customer', action: 'BulkImport' } })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150))
  let firstRun

  beforeAll(async () => {
    imp = await prisma.building.create({
      data: { buildingName: `${S} Import Heights`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId: zone.id, createdById: IDS.admin },
    })
    for (const name of ['A', 'B']) {
      await prisma.buildingWing.create({ data: { buildingId: imp.id, name, latitude: 18.5, longitude: 73.8 } })
    }
  })

  it('dry run writes nothing', async () => {
    const before = await importLogs()
    const res = await run(BASE(), { dryRun: true })
    expect(res.status).toBe(201)
    expect(res.body.data.createdCount).toBe(2)
    expect(res.body.data.rows.map((r) => r.outcome)).toEqual(['create', 'create'])
    expect((await list(imp.id)).body.data.customers).toHaveLength(0)
    await settle()
    expect(await importLogs()).toBe(before)
  })

  it('creates with the wing from the Wing cell', async () => {
    const before = await importLogs()
    firstRun = await run(BASE())
    expect(firstRun.status).toBe(201)
    expect(firstRun.body.data.createdCount).toBe(2)
    const wingA = await prisma.buildingWing.findFirst({ where: { buildingId: imp.id, name: 'A' } })
    expect((await stored(U(1))).wingId).toBe(wingA.id)
    expect(firstRun.body.data.rows[0]).toMatchObject({ row: 2, sheet: 'Sheet1', outcome: 'create', wingName: 'A', flags: [] })
    await settle()
    expect(await importLogs()).toBe(before + 1)
    const log = await prisma.systemLog.findFirst({
      where: { userId: IDS.admin, module: 'Customer', action: 'BulkImport' },
      orderBy: { createdAt: 'desc' },
    })
    expect(log.description).toBe('Customer import: 2 created, 0 updated, 0 unchanged, 0 skipped')
  })

  it('unlocated wing is flagged, customer kept with no wing', async () => {
    expect((await stored(U(2))).wingId).toBeNull()
    expect(firstRun.body.data.flagged).toHaveLength(1)
    expect(firstRun.body.data.flagged[0]).toMatchObject({ row: 3, sheet: 'Sheet1', name: 'Imp Two' })
    expect(firstRun.body.data.flagged[0].note).toBe('Wing C is not located yet — added without a wing')
    expect(firstRun.body.data.rows[1].flags).toEqual(['Wing C is not located yet — added without a wing'])
  })

  it('re-upload of the same rows changes nothing', async () => {
    const before = await stored(U(1))
    const res = await run(BASE())
    expect(res.body.data).toMatchObject({ createdCount: 0, updatedCount: 0, unchangedCount: 2 })
    expect((await stored(U(1))).updatedAt).toEqual(before.updatedAt)
  })

  it('update fills only filled cells', async () => {
    const res = await run([{ row: 2, buildingId: imp.id, username: U(1), name: '', mobile: '', email: '', planName: 'NEW' }])
    expect(res.status).toBe(201)
    expect(res.body.data.updatedCount).toBe(1)
    const after = await stored(U(1))
    expect(after).toMatchObject({ planName: 'NEW', email: 'a@x.in', name: 'Imp One', mobile: '9100000001' })
  })

  it('blank Wing keeps the current wing', async () => {
    const before = await stored(U(1))
    const res = await run([{ row: 2, buildingId: imp.id, username: U(1), name: 'Imp One', mobile: '9100000001', wing: null }])
    expect(res.body.data.unchangedCount).toBe(1)
    expect(res.body.data.rows[0].wingName).toBe('A')
    expect((await stored(U(1))).wingId).toBe(before.wingId)
  })

  it('bad email on an update still applies the other cells', async () => {
    const res = await run([{ row: 2, buildingId: imp.id, username: U(1), name: 'Imp One', mobile: '9100000001', email: 'not-an-email', status: 'Inactive' }])
    expect(res.status).toBe(201)
    expect(res.body.data.updatedCount).toBe(1)
    expect(res.body.data.rows[0].flags).toEqual(['Email address looks wrong — kept the old one'])
    expect(res.body.data.flagged).toHaveLength(1)
    const after = await stored(U(1))
    expect(after).toMatchObject({ status: 'Inactive', email: 'a@x.in' })
  })

  it('bad mobile on an update keeps the old one, with a flag', async () => {
    const res = await run([{ row: 2, buildingId: imp.id, username: U(1), name: 'Imp One', mobile: '12', status: 'Active' }])
    expect(res.body.data.updatedCount).toBe(1)
    expect(res.body.data.rows[0].flags).toEqual(['Mobile number looks wrong — kept the old one'])
    expect(await stored(U(1))).toMatchObject({ status: 'Active', mobile: '9100000001' })
  })

  it('bad email on a new customer is skipped, not a 400', async () => {
    const res = await run([{ row: 9, buildingId: imp.id, username: U(9), name: 'Bad Mail', mobile: '9100000009', email: 'nope' }])
    expect(res.status).toBe(201)
    expect(res.body.data.skipped[0]).toMatchObject({ row: 9, name: 'Bad Mail', reason: 'Email address looks wrong' })
    expect(res.body.data.rows[0]).toMatchObject({ outcome: 'skip', reason: 'Email address looks wrong' })
    expect(await stored(U(9))).toBeNull()
  })

  it('same mobile, different usernames → two customers', async () => {
    const res = await run([
      { row: 2, buildingId: imp.id, username: U(3), name: 'Twin', mobile: '9100000003' },
      { row: 3, buildingId: imp.id, username: U(4), name: 'Twin', mobile: '9100000003' },
    ])
    expect(res.body.data.createdCount).toBe(2)
    expect(await prisma.customer.count({ where: { buildingId: imp.id, mobile: '9100000003' } })).toBe(2)
  })

  it('a Username twice in one file is skipped the second time', async () => {
    const res = await run([
      { row: 2, buildingId: imp.id, username: U(5), name: 'Once', mobile: '9100000005' },
      { row: 3, buildingId: imp.id, username: U(5), name: 'Twice', mobile: '9100000006' },
    ])
    expect(res.body.data.createdCount).toBe(1)
    expect(res.body.data.skipped[0]).toMatchObject({ row: 3, reason: 'Duplicate in this file' })
  })

  it('a Username row claims a stored customer with no Username on the same mobile', async () => {
    const hand = (await post({ buildingId: imp.id, name: 'Hand Added', mobile: '9100000020' })).body.data
    const res = await run([{ row: 2, buildingId: imp.id, username: `${S}-claim`, name: 'Hand Added', mobile: '919100000020', planName: 'P1' }])
    expect(res.body.data).toMatchObject({ createdCount: 0, updatedCount: 1 })
    const after = await prisma.customer.findUnique({ where: { id: hand.id } })
    expect(after).toMatchObject({ username: `${S}-claim`, planName: 'P1' })
    expect(await prisma.customer.count({ where: { buildingId: imp.id, mobile: '9100000020' } })).toBe(1)
  })

  it('a stored customer with a different Username on the same mobile is never claimed', async () => {
    expect((await post({ buildingId: imp.id, name: 'Has A', mobile: '9100000021', username: `${S}-ua1` })).status).toBe(201)
    const res = await run([{ row: 2, buildingId: imp.id, username: `${S}-ub1`, name: 'Has B', mobile: '9100000021' }])
    expect(res.body.data).toMatchObject({ createdCount: 1, updatedCount: 0 })
    expect((await stored(`${S}-ua1`)).name).toBe('Has A')
  })

  it('an unknown wing on an update row keeps the wing, and says so', async () => {
    const before = await stored(U(1))
    const res = await run([
      { row: 2, buildingId: imp.id, username: U(1), name: 'Imp One', mobile: '9100000001', wing: 'Z' },
      { row: 3, buildingId: imp.id, username: U(6), name: 'New Z', mobile: '9100000006', wing: 'Z' },
    ])
    expect(res.body.data.rows[0].flags).toEqual(['Wing Z is not located yet — wing left as it was'])
    expect(res.body.data.rows[0].wingName).toBe('A')
    expect(res.body.data.rows[1].flags).toEqual(['Wing Z is not located yet — added without a wing'])
    expect((await stored(U(1))).wingId).toBe(before.wingId)
  })

  it('an ambiguous wing on an update row says the wing was left as it was', async () => {
    const extra = await prisma.buildingWing.create({ data: { buildingId: imp.id, name: 'Wing B', latitude: 18.5, longitude: 73.8 } })
    try {
      const res = await run([{ row: 2, buildingId: imp.id, username: U(1), name: 'Imp One', mobile: '9100000001', wing: 'b' }])
      expect(res.body.data.rows[0].flags).toEqual(['Wing b matches more than one wing — wing left as it was'])
    } finally {
      await prisma.buildingWing.delete({ where: { id: extra.id } })
    }
  })

  it('a skipped row carries no wing flags', async () => {
    expect((await post({ buildingId: mine.id, name: 'Elsewhere', mobile: '9100000022', username: `${S}-u-far` })).status).toBe(201)
    const res = await run([{ row: 7, buildingId: imp.id, username: `${S}-u-far`, name: 'Far', mobile: '9100000022', wing: 'Nowhere' }])
    expect(res.body.data.rows[0]).toMatchObject({ outcome: 'skip', flags: [] })
    expect(res.body.data.rows[0].reason).toBe(`Username belongs to ${mine.buildingName}`)
    expect(res.body.data.flagged).toEqual([])
  })

  it('two rows with no Username and no mobile get the real reason, not a duplicate', async () => {
    const res = await run([
      { row: 2, buildingId: imp.id, name: 'No Number 1', mobile: '' },
      { row: 3, buildingId: imp.id, name: 'No Number 2', mobile: '' },
    ])
    expect(res.body.data.skipped.map((s) => s.reason)).toEqual(['Mobile number is missing', 'Mobile number is missing'])
  })

  it('username in another building is skipped', async () => {
    expect((await post({ buildingId: mine.id, name: 'Other Home', mobile: '9100000010', username: `${S}-u-other` })).status).toBe(201)
    const res = await run([{ row: 4, buildingId: imp.id, username: `${S}-u-other`, name: 'Moved?', mobile: '9100000010' }])
    expect(res.status).toBe(201)
    expect(res.body.data.skipped[0].reason).toBe(`Username belongs to ${mine.buildingName}`)
    expect((await stored(`${S}-u-other`)).buildingId).toBe(mine.id)
  })

  it('not in sheet lists untouched customers', async () => {
    const own = await prisma.building.create({
      data: { buildingName: `${S} Not In Sheet`, formattedAddress: 'x', latitude: 18.5, longitude: 73.8, zoneId: zone.id, createdById: IDS.admin },
    })
    const three = [1, 2, 3].map((n) => ({ row: n + 1, buildingId: own.id, username: `${S}-n${n}`, name: `Nis ${n}`, mobile: `920000000${n}` }))
    expect((await run(three)).body.data.createdCount).toBe(3)
    const third = await stored(`${S}-n3`)
    const res = await run(three.slice(0, 2))
    expect(res.body.data.unchangedCount).toBe(2)
    expect(res.body.data.notInSheet).toEqual([
      { id: third.id, name: 'Nis 3', mobile: '9200000003', buildingName: own.buildingName, wingName: null },
    ])
    expect(await stored(`${S}-n3`)).toEqual(third)
  })

  it('a 900-row file with long addresses is accepted', async () => {
    const rows = Array.from({ length: 900 }, (_, i) => ({
      row: i + 2,
      buildingId: imp.id,
      username: `${S}-big-${i}`,
      name: `Big Customer ${i}`.padEnd(100, '.'),
      mobile: String(9300000000 + i),
      address: 'x'.repeat(490),
      olt: 't'.repeat(90),
      site: 's'.repeat(90),
      operator: 'o'.repeat(90),
      networkZone: 'z'.repeat(90),
      planName: 'p'.repeat(90),
    }))
    expect(JSON.stringify({ rows }).length).toBeGreaterThan(1024 * 1024) // past the global 1 MB parser
    const res = await run(rows, { dryRun: true })
    expect(res.status).not.toBe(413)
    expect(res.status).toBe(201)
    expect(res.body.data.createdCount).toBe(900)
  })
})
