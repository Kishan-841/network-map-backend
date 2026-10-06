import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const stamp = String(Date.now()).slice(-8)
const DSA = `rc-dsa-${stamp}`
const SHOP = `rc-shop-${stamp}`
const tok = (sub) => ({ Authorization: `Bearer ${jwt.sign({ sub }, env.jwtSecret, { audience: 'partner', expiresIn: '1h' })}` })

beforeAll(() =>
  prisma.partner.createMany({
    data: [
      { id: DSA, name: DSA, type: 'DSA', mobile: `97${stamp}` },
      { id: SHOP, name: SHOP, type: 'RETAIL_SHOP', mobile: `96${stamp}`, status: 'APPROVED' },
    ],
  }),
)
afterAll(() => prisma.partner.deleteMany({ where: { id: { in: [DSA, SHOP] } } }))

describe('GET /partner/rate-card — fixed pay', () => {
  it('tells a retail shop they earn a flat ₹500 per customer', async () => {
    const res = await request(app).get('/api/v1/partner/rate-card').set(tok(SHOP))
    expect(res.status).toBe(200)
    expect(res.body.data.fixedPerCustomer).toBe(500)
  })

  it('gives a DSA the rate card and no fixed amount', async () => {
    const res = await request(app).get('/api/v1/partner/rate-card').set(tok(DSA))
    expect(res.body.data.fixedPerCustomer).toBeNull()
    expect(res.body.data.rates.length).toBeGreaterThan(0)
  })
})

describe('GET /rate-card (staff) — the flat amounts for the convert preview', () => {
  it('includes the flat amount per partner type', async () => {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    const token = jwt.sign({ sub: admin.id, role: 'ADMIN' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })
    const res = await request(app).get('/api/v1/rate-card').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.fixedAmountByType).toEqual({ AGENT: 500, SOCIETY_REPRESENTATIVE: 500, RETAIL_SHOP: 500 })
  })
})

describe('GET /partner/earnings — fixed pay', () => {
  it('carries fixedPerCustomer for a retail shop', async () => {
    const res = await request(app).get('/api/v1/partner/earnings').set(tok(SHOP))
    expect(res.status).toBe(200)
    expect(res.body.data.fixedPerCustomer).toBe(500)
  })
})
