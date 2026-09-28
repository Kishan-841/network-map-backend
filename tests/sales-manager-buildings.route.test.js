import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const token = (id, role) => jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })
const auth = (id, role) => ({ Authorization: `Bearer ${token(id, role)}` })

const S = `smb-${Date.now()}`
const MGR = `${S}-mgr`
const COV = `${S}-coverage`
const ACQ = `${S}-acq`

beforeAll(async () => {
  await prisma.user.create({ data: { id: MGR, name: MGR, email: `${MGR}@v.local`, passwordHash: 'x', role: 'SALES_MANAGER' } })
  await prisma.building.create({
    data: { id: COV, buildingName: COV.toUpperCase(), formattedAddress: `${COV} rd`, latitude: 18.5, longitude: 73.8, createdById: 'test-admin', source: 'COVERAGE' },
  })
  await prisma.building.create({
    data: { id: ACQ, buildingName: ACQ.toUpperCase(), formattedAddress: `${ACQ} rd`, latitude: 18.6, longitude: 73.9, createdById: 'test-admin', source: 'ACQUISITION' },
  })
  await prisma.buildingAssignment.create({ data: { buildingId: COV, assignedToId: MGR, assignedById: MGR, status: 'ACTIVE' } })
})

afterAll(async () => {
  await prisma.building.deleteMany({ where: { id: { in: [COV, ACQ] } } })
  await prisma.user.deleteMany({ where: { id: MGR } } )
})

describe('a sales manager browsing the registry via GET /buildings', () => {
  it('returns coverage buildings (with the sales holder) and NOT acquisition rows', async () => {
    const res = await request(app).get('/api/v1/buildings').set(auth(MGR, 'SALES_MANAGER')).query({ pageSize: 500 })
    expect(res.status).toBe(200)
    const ids = res.body.data.items.map((b) => b.id)
    expect(ids).toContain(COV)
    expect(ids).not.toContain(ACQ) // acquisition registry is not the sales manager's
    const cov = res.body.data.items.find((b) => b.id === COV)
    expect(cov.salesAssignments?.[0]?.assignedTo?.id).toBe(MGR) // "Held by" is available
  })

  it('accepts the operator / zone / tier filters without error', async () => {
    const res = await request(app)
      .get('/api/v1/buildings')
      .set(auth(MGR, 'SALES_MANAGER'))
      .query({ tier: 'PLATINUM', pageSize: 20 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data.items)).toBe(true)
  })
})
