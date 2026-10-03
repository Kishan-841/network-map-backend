import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const stamp = String(Date.now()).slice(-8)
const P = `lang-p-${stamp}`
const auth = { Authorization: `Bearer ${jwt.sign({ sub: P }, env.jwtSecret, { audience: 'partner', expiresIn: '1h' })}` }

beforeAll(async () => {
  await prisma.partner.create({ data: { id: P, name: P, type: 'RETAIL_SHOP', mobile: `95${stamp}`, status: 'REGISTERED' } })
})
afterAll(async () => {
  await prisma.partner.deleteMany({ where: { id: P } })
})

describe('PATCH /partner-auth/me', () => {
  it('saves the partner\'s language', async () => {
    const res = await request(app).patch('/api/v1/partner-auth/me').set(auth).send({ preferredLanguage: 'HI' })
    expect(res.status).toBe(200)
    expect(res.body.data.preferredLanguage).toBe('HI')
    expect(res.body.data.passwordHash).toBeUndefined()
    expect((await prisma.partner.findUnique({ where: { id: P } })).preferredLanguage).toBe('HI')
  })

  it('refuses a language we do not have', async () => {
    const res = await request(app).patch('/api/v1/partner-auth/me').set(auth).send({ preferredLanguage: 'TA' })
    expect(res.status).toBe(400)
  })

  it('refuses any other field — only the language is editable here', async () => {
    const res = await request(app).patch('/api/v1/partner-auth/me').set(auth).send({ preferredLanguage: 'MR', status: 'APPROVED' })
    expect(res.status).toBe(400)
    expect((await prisma.partner.findUnique({ where: { id: P } })).status).toBe('REGISTERED')
  })

  it('needs a partner token', async () => {
    expect((await request(app).patch('/api/v1/partner-auth/me').send({ preferredLanguage: 'EN' })).status).toBe(401)
  })
})
