import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const token = (id, role) => jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })
const auth = (id, role) => ({ Authorization: `Bearer ${token(id, role)}` })

const S = `is-${Date.now()}`
const MGR = `${S}-mgr`
const TL = `${S}-tl`
const SE = `${S}-se`
const OUT = `${S}-out` // an executive on a different team — out of SE's scope
const B = `${S}-bldg`
const soon = new Date(Date.now() + 86400000).toISOString()

const createLead = (extra = {}, who = SE, role = 'SALES_EXECUTIVE') =>
  request(app)
    .post('/api/v1/sales/inquiries')
    .set(auth(who, role))
    .send({ buildingId: B, customerName: 'Asha', phone: '9876543210', ...extra })

beforeAll(async () => {
  await prisma.user.create({ data: { id: MGR, name: MGR, email: `${MGR}@v.local`, passwordHash: 'x', role: 'SALES_MANAGER' } })
  await prisma.user.create({ data: { id: TL, name: TL, email: `${TL}@v.local`, passwordHash: 'x', role: 'TEAM_LEADER', managerId: MGR } })
  await prisma.user.create({ data: { id: SE, name: SE, email: `${SE}@v.local`, passwordHash: 'x', role: 'SALES_EXECUTIVE', managerId: MGR, teamLeaderId: TL } })
  await prisma.user.create({ data: { id: OUT, name: OUT, email: `${OUT}@v.local`, passwordHash: 'x', role: 'SALES_EXECUTIVE' } })
  await prisma.building.create({ data: { id: B, buildingName: B.toUpperCase(), formattedAddress: `${B} rd`, latitude: 18.5, longitude: 73.8, createdById: 'test-admin', source: 'COVERAGE' } })
  await prisma.buildingAssignment.create({ data: { buildingId: B, assignedToId: SE, assignedById: MGR, status: 'ACTIVE' } })
})
afterAll(async () => {
  await prisma.building.deleteMany({ where: { id: B } }) // cascades inquiries + assignment
  await prisma.user.deleteMany({ where: { id: { in: [MGR, TL, SE, OUT] } } })
})

describe('a lead carries a status and a follow-up time', () => {
  it('defaults a new lead to NOT_CONTACTED', async () => {
    const res = await createLead()
    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('NOT_CONTACTED')
    expect(res.body.data.followUpAt).toBeNull()
  })

  it('creates a FOLLOW_UP lead with a followUpAt', async () => {
    const res = await createLead({ status: 'FOLLOW_UP', followUpAt: soon })
    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('FOLLOW_UP')
    expect(res.body.data.followUpAt).toBeTruthy()
  })

  it('rejects FOLLOW_UP without a followUpAt (400)', async () => {
    const res = await createLead({ status: 'FOLLOW_UP' })
    expect(res.status).toBe(400)
  })
})

describe('updating a lead status', () => {
  let id = null
  beforeAll(async () => {
    id = (await createLead()).body.data.id
  })

  it('marks a lead COMPLETED and clears any follow-up', async () => {
    await request(app).patch(`/api/v1/sales/inquiries/${id}`).set(auth(SE, 'SALES_EXECUTIVE')).send({ status: 'FOLLOW_UP', followUpAt: soon })
    const res = await request(app).patch(`/api/v1/sales/inquiries/${id}`).set(auth(SE, 'SALES_EXECUTIVE')).send({ status: 'COMPLETED' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('COMPLETED')
    expect(res.body.data.followUpAt).toBeNull()
  })

  it('rejects a move to FOLLOW_UP without a followUpAt (400)', async () => {
    const res = await request(app).patch(`/api/v1/sales/inquiries/${id}`).set(auth(SE, 'SALES_EXECUTIVE')).send({ status: 'FOLLOW_UP' })
    expect(res.status).toBe(400)
  })

  it('lets the team leader above the creator update it', async () => {
    const res = await request(app).patch(`/api/v1/sales/inquiries/${id}`).set(auth(TL, 'TEAM_LEADER')).send({ status: 'NOT_INTERESTED' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('NOT_INTERESTED')
  })

  it('answers 404 to someone out of scope (never 403)', async () => {
    const res = await request(app).patch(`/api/v1/sales/inquiries/${id}`).set(auth(OUT, 'SALES_EXECUTIVE')).send({ status: 'COMPLETED' })
    expect(res.status).toBe(404)
  })
})

describe('listing leads by status', () => {
  it('filters the list to one status', async () => {
    await createLead({ status: 'COMPLETED' })
    const res = await request(app).get('/api/v1/sales/inquiries?status=COMPLETED').set(auth(SE, 'SALES_EXECUTIVE'))
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(res.body.data.every((l) => l.status === 'COMPLETED')).toBe(true)
  })
})
