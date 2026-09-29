import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const auth = (id, role) => ['Authorization', `Bearer ${jwt.sign({ sub: id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}`]

const S = `bex-${Date.now()}`
const MGR = `${S}-mgr`
const SUR = `${S}-sur`

beforeAll(async () => {
  await prisma.user.create({ data: { id: MGR, name: MGR, email: `${MGR}@v.local`, passwordHash: 'x', role: 'SALES_MANAGER' } })
  await prisma.user.create({ data: { id: SUR, name: SUR, email: `${SUR}@v.local`, passwordHash: 'x', role: 'SURVEYOR' } })
})
afterAll(async () => {
  await prisma.systemLog.deleteMany({ where: { userId: { in: [MGR, SUR] } } })
  await prisma.user.deleteMany({ where: { id: { in: [MGR, SUR] } } })
})

describe('GET /buildings/export access', () => {
  it('lets a SALES_MANAGER download the spreadsheet', async () => {
    const res = await request(app).get('/api/v1/buildings/export').set(...auth(MGR, 'SALES_MANAGER'))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/spreadsheet|officedocument/)
  })

  it('accepts an isLive filter', async () => {
    const res = await request(app).get('/api/v1/buildings/export?isLive=true').set(...auth(MGR, 'SALES_MANAGER'))
    expect(res.status).toBe(200)
  })

  it('still blocks a role that may not export', async () => {
    const res = await request(app).get('/api/v1/buildings/export').set(...auth(SUR, 'SURVEYOR'))
    expect(res.status).toBe(403)
  })
})
