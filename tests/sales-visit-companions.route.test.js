import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const token = (id, role) => jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })
const auth = (id, role) => ({ Authorization: `Bearer ${token(id, role)}` })

const S = `vc-${Date.now()}`
const MGR = `${S}-mgr`
const TL = `${S}-tl`
const TL2 = `${S}-tl2`
const SE1 = `${S}-se1`
const SE2 = `${S}-se2`
const OUT = `${S}-out` // an executive under a DIFFERENT team leader
const B = `${S}-bldg`

const checkIn = (extra) =>
  request(app)
    .post('/api/v1/sales/visits')
    .set(auth(TL, 'TEAM_LEADER'))
    .send({ buildingId: B, checkInLat: 18.5, checkInLng: 73.8, selfieUrl: 'https://r2/x.jpg', ...extra })
const checkout = (id) =>
  request(app).post(`/api/v1/sales/visits/${id}/checkout`).set(auth(TL, 'TEAM_LEADER')).send({ checkOutLat: 18.5, checkOutLng: 73.8 })

beforeAll(async () => {
  await prisma.user.create({ data: { id: MGR, name: MGR, email: `${MGR}@v.local`, passwordHash: 'x', role: 'SALES_MANAGER' } })
  await prisma.user.create({ data: { id: TL, name: TL, email: `${TL}@v.local`, passwordHash: 'x', role: 'TEAM_LEADER', managerId: MGR } })
  await prisma.user.create({ data: { id: TL2, name: TL2, email: `${TL2}@v.local`, passwordHash: 'x', role: 'TEAM_LEADER', managerId: MGR } })
  for (const id of [SE1, SE2]) await prisma.user.create({ data: { id, name: id, email: `${id}@v.local`, passwordHash: 'x', role: 'SALES_EXECUTIVE', managerId: MGR, teamLeaderId: TL } })
  await prisma.user.create({ data: { id: OUT, name: OUT, email: `${OUT}@v.local`, passwordHash: 'x', role: 'SALES_EXECUTIVE', managerId: MGR, teamLeaderId: TL2 } })
  await prisma.building.create({ data: { id: B, buildingName: B.toUpperCase(), formattedAddress: `${B} rd`, latitude: 18.5, longitude: 73.8, createdById: 'test-admin', source: 'COVERAGE' } })
  await prisma.buildingAssignment.create({ data: { buildingId: B, assignedToId: TL, assignedById: MGR, status: 'ACTIVE' } })
})
afterAll(async () => {
  await prisma.building.deleteMany({ where: { id: B } }) // cascades visits + companions + assignment
  await prisma.user.deleteMany({ where: { id: { in: [MGR, TL, TL2, SE1, SE2, OUT] } } })
})

describe('team-leader check-in — who they went with', () => {
  it('rejects a TL check-in with neither companions nor solo (400)', async () => {
    const res = await checkIn({})
    expect(res.status).toBe(400)
  })

  it("rejects a companion who isn't the TL's own executive (400)", async () => {
    const res = await checkIn({ companionIds: [OUT] })
    expect(res.status).toBe(400)
  })

  it('records the executives the TL went with, and checks out', async () => {
    const res = await checkIn({ companionIds: [SE1, SE2] })
    expect(res.status).toBe(201)
    const open = await request(app).get('/api/v1/sales/visits/open').set(auth(TL, 'TEAM_LEADER'))
    expect(open.body.data.wentSolo).toBe(false)
    expect(open.body.data.companions.map((c) => c.user.id).sort()).toEqual([SE1, SE2].sort())
    expect((await checkout(res.body.data.id)).status).toBe(200)
  })

  it('records a solo visit (wentSolo true, no companions)', async () => {
    const res = await checkIn({ wentSolo: true })
    expect(res.status).toBe(201)
    const open = await request(app).get('/api/v1/sales/visits/open').set(auth(TL, 'TEAM_LEADER'))
    expect(open.body.data.wentSolo).toBe(true)
    expect(open.body.data.companions).toHaveLength(0)
    await checkout(res.body.data.id)
  })
})
