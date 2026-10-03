import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const stamp = String(Date.now()).slice(-8)
const P = `bank-adm-${stamp}`
const body = { accountHolderName: 'Asha Patil', accountNumber: '001234567890', ifsc: 'HDFC0001234', branchName: 'Cidco' }
let as

beforeAll(async () => {
  const user = async (role) => {
    const u = await prisma.user.findFirst({ where: { role } })
    if (!u) throw new Error(`no ${role} user in the dev DB`)
    return { Authorization: `Bearer ${jwt.sign({ sub: u.id, role }, env.jwtSecret, { audience: 'staff', expiresIn: '1h' })}` }
  }
  as = { admin: await user('ADMIN'), manager: await user('PARTNER_MANAGER'), accounts: await user('ACCOUNTS') }
  await prisma.partner.create({ data: { id: P, name: P, type: 'DSA', mobile: `90${stamp}`, status: 'APPROVED' } })
})
afterAll(async () => {
  await prisma.systemLog.deleteMany({ where: { recordId: P } })
  await prisma.partner.deleteMany({ where: { id: P } })
})

describe('admin bank details', () => {
  it('returns null before anything is saved', async () => {
    const res = await request(app).get(`/api/v1/partners/${P}/bank-account`).set(as.admin)
    expect(res.status).toBe(200)
    expect(res.body.data).toBeNull()
  })

  it('lets an ADMIN edit a locked (approved) partner and see the full number', async () => {
    const put = await request(app).put(`/api/v1/partners/${P}/bank-account`).set(as.admin).send(body)
    expect(put.status).toBe(200)
    expect(put.body.data.accountNumber).toBe('001234567890')
    const get = await request(app).get(`/api/v1/partners/${P}/bank-account`).set(as.admin)
    expect(get.body.data).toMatchObject({ accountNumber: '001234567890', accountLast4: '7890' })
    expect(get.body.data.updatedBy.id).toBeTruthy()
  })

  it('keeps the number out of the audit log', async () => {
    const logs = await prisma.systemLog.findMany({ where: { recordId: P } })
    expect(logs.length).toBeGreaterThan(0)
    expect(JSON.stringify(logs)).not.toContain('001234567890')
  })

  it('is ADMIN only — a partner manager and accounts get 403', async () => {
    for (const who of [as.manager, as.accounts]) {
      expect((await request(app).get(`/api/v1/partners/${P}/bank-account`).set(who)).status).toBe(403)
      expect((await request(app).put(`/api/v1/partners/${P}/bank-account`).set(who).send(body)).status).toBe(403)
    }
  })

  it('404s an unknown partner', async () => {
    expect((await request(app).get('/api/v1/partners/nobody/bank-account').set(as.admin)).status).toBe(404)
  })

  it('lets an ADMIN replace the cheque (foreign URL refused like the partner route)', async () => {
    const res = await request(app).post(`/api/v1/partners/${P}/documents`).set(as.admin).send({ type: 'CANCELLED_CHEQUE', url: 'https://evil.example/c.jpg' })
    expect(res.status).toBe(400)
    expect((await request(app).post(`/api/v1/partners/${P}/documents`).set(as.manager).send({ type: 'CANCELLED_CHEQUE', url: 'https://x/uploads/c.jpg' })).status).toBe(403)
  })
})
