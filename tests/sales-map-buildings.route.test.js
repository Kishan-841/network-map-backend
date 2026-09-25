import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const token = (id, role) => jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })
const auth = (id, role) => ({ Authorization: `Bearer ${token(id, role)}` })

const S = `map-${Date.now()}`
const MGR = `${S}-mgr`
const TL = `${S}-tl`
const SE = `${S}-se`
const MGR2 = `${S}-mgr2`
const ACQ = `${S}-acq` // a non-sales user, for the 403 check
const BA = `${S}-assigned` // assigned to SE (under MGR/TL)
const BU = `${S}-unassigned` // in the registry, assigned to nobody

const roleOf = { [MGR]: 'SALES_MANAGER', [TL]: 'TEAM_LEADER', [SE]: 'SALES_EXECUTIVE', [MGR2]: 'SALES_MANAGER' }
const rowsOf = (res) => Object.fromEntries(res.body.data.map((b) => [b.id, b]))

beforeAll(async () => {
  await prisma.user.create({ data: { id: MGR, name: MGR, email: `${MGR}@v.local`, passwordHash: 'x', role: 'SALES_MANAGER' } })
  await prisma.user.create({ data: { id: MGR2, name: MGR2, email: `${MGR2}@v.local`, passwordHash: 'x', role: 'SALES_MANAGER' } })
  await prisma.user.create({ data: { id: TL, name: TL, email: `${TL}@v.local`, passwordHash: 'x', role: 'TEAM_LEADER', managerId: MGR } })
  await prisma.user.create({ data: { id: SE, name: SE, email: `${SE}@v.local`, passwordHash: 'x', role: 'SALES_EXECUTIVE', managerId: MGR, teamLeaderId: TL } })
  await prisma.user.create({ data: { id: ACQ, name: ACQ, email: `${ACQ}@v.local`, passwordHash: 'x', role: 'ACQUISITION_AGENT' } })
  for (const id of [BA, BU]) {
    await prisma.building.create({
      data: { id, buildingName: id.toUpperCase(), formattedAddress: `${id} road`, latitude: 18.5, longitude: 73.8, createdById: 'test-admin' },
    })
  }
  await prisma.buildingAssignment.create({
    data: { buildingId: BA, assignedToId: SE, assignedById: MGR, status: 'ACTIVE' },
  })
})

afterAll(async () => {
  await prisma.building.deleteMany({ where: { id: { in: [BA, BU] } } }) // cascades the assignment
  await prisma.user.deleteMany({ where: { id: { in: [MGR, MGR2, TL, SE, ACQ] } } })
})

describe('GET /api/v1/sales/map-buildings', () => {
  it('requires a sales/admin role', async () => {
    expect((await request(app).get('/api/v1/sales/map-buildings')).status).toBe(401)
    expect((await request(app).get('/api/v1/sales/map-buildings').set(auth(ACQ, 'ACQUISITION_AGENT'))).status).toBe(403)
  })

  it('a manager sees the whole registry; assigned=true only for their team', async () => {
    const res = await request(app).get('/api/v1/sales/map-buildings').set(auth(MGR, 'SALES_MANAGER'))
    expect(res.status).toBe(200)
    const rows = rowsOf(res)
    expect(rows[BA]).toBeTruthy()
    expect(rows[BU]).toBeTruthy() // unassigned building still visible
    expect(rows[BA].assigned).toBe(true)
    expect(rows[BU].assigned).toBe(false)
    // coordinates are present for the pin
    expect(rows[BA]).toMatchObject({ latitude: 18.5, longitude: 73.8 })
  })

  it("a different manager sees the building but assigned=false (not their team)", async () => {
    const res = await request(app).get('/api/v1/sales/map-buildings').set(auth(MGR2, 'SALES_MANAGER'))
    const rows = rowsOf(res)
    expect(rows[BA]).toBeTruthy()
    expect(rows[BA].assigned).toBe(false)
  })

  it('a team leader sees only their team\'s assigned buildings', async () => {
    const res = await request(app).get('/api/v1/sales/map-buildings').set(auth(TL, 'TEAM_LEADER'))
    const rows = rowsOf(res)
    expect(rows[BA]).toBeTruthy()
    expect(rows[BA].assigned).toBe(true)
    expect(rows[BU]).toBeUndefined() // no unassigned/registry buildings
  })

  it('an executive sees only buildings assigned to them', async () => {
    const res = await request(app).get('/api/v1/sales/map-buildings').set(auth(SE, 'SALES_EXECUTIVE'))
    const rows = rowsOf(res)
    expect(rows[BA]).toBeTruthy()
    expect(rows[BA].assigned).toBe(true)
    expect(rows[BU]).toBeUndefined()
  })
})
