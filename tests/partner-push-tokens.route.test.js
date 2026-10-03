import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { pushTokenRepository } from '../src/modules/partners/push-token.repository.js'

const app = createApp()
const stamp = String(Date.now()).slice(-8)
const P1 = `push-p1-${stamp}`
const P2 = `push-p2-${stamp}`
const auth = (id) => ({ Authorization: `Bearer ${jwt.sign({ sub: id }, env.jwtSecret, { audience: 'partner', expiresIn: '1h' })}` })
const TOKEN = `ExponentPushToken[test-${stamp}]`

beforeAll(async () => {
  for (const [id, mobile] of [[P1, `97${stamp}`], [P2, `96${stamp}`]]) {
    await prisma.partner.create({ data: { id, name: id, type: 'RETAIL_SHOP', mobile, status: 'REGISTERED' } })
  }
})
afterAll(async () => {
  await prisma.partnerPushToken.deleteMany({ where: { partnerId: { in: [P1, P2] } } })
  await prisma.partner.deleteMany({ where: { id: { in: [P1, P2] } } })
})

describe('POST /partner/push-tokens', () => {
  it('registers a phone for a partner who is not approved yet', async () => {
    const res = await request(app).post('/api/v1/partner/push-tokens').set(auth(P1)).send({ token: TOKEN, platform: 'android' })
    expect(res.status).toBe(200)
    const row = await prisma.partnerPushToken.findUnique({ where: { token: TOKEN } })
    expect(row.partnerId).toBe(P1)
  })

  it('moves a shared phone to whoever signed in on it last', async () => {
    await request(app).post('/api/v1/partner/push-tokens').set(auth(P2)).send({ token: TOKEN, platform: 'android' })
    const row = await prisma.partnerPushToken.findUnique({ where: { token: TOKEN } })
    expect(row.partnerId).toBe(P2)
  })

  it('refuses something that is not an Expo token', async () => {
    const res = await request(app).post('/api/v1/partner/push-tokens').set(auth(P1)).send({ token: 'abc', platform: 'android' })
    expect(res.status).toBe(400)
  })

  it('needs a partner token, not a staff one', async () => {
    const staff = { Authorization: `Bearer ${jwt.sign({ sub: 'test-admin', role: 'ADMIN' }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` }
    const res = await request(app).post('/api/v1/partner/push-tokens').set(staff).send({ token: TOKEN, platform: 'android' })
    expect(res.status).toBe(401)
  })
})

describe('DELETE /partner/push-tokens', () => {
  it('does not let one partner remove another partner\'s phone', async () => {
    const res = await request(app).delete('/api/v1/partner/push-tokens').set(auth(P1)).send({ token: TOKEN })
    expect(res.status).toBe(200)
    expect(await prisma.partnerPushToken.findUnique({ where: { token: TOKEN } })).not.toBeNull()
  })

  it('removes the caller\'s own phone on sign-out', async () => {
    const res = await request(app).delete('/api/v1/partner/push-tokens').set(auth(P2)).send({ token: TOKEN })
    expect(res.status).toBe(200)
    expect(await prisma.partnerPushToken.findUnique({ where: { token: TOKEN } })).toBeNull()
  })
})

describe('the repository', () => {
  it('has every method the push service relies on', () => {
    for (const m of ['upsert', 'removeForPartner', 'listForPartner', 'removeTokens']) {
      expect(typeof pushTokenRepository[m], m).toBe('function')
    }
  })
})
