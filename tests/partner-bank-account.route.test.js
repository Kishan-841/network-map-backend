import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const app = createApp()
const stamp = String(Date.now()).slice(-8)
const ids = { reg: `bank-reg-${stamp}`, pend: `bank-pend-${stamp}`, appr: `bank-appr-${stamp}` }
const tok = (sub) => ({ Authorization: `Bearer ${jwt.sign({ sub }, env.jwtSecret, { audience: 'partner', expiresIn: '1h' })}` })
const body = { accountHolderName: 'Asha Patil', accountNumber: '0012 3456 7890', ifsc: 'hdfc0001234', branchName: 'Cidco', bankName: 'HDFC Bank' }
const docs = (partnerId) =>
  prisma.partnerDocument.createMany({
    data: ['AADHAAR', 'PAN', 'CANCELLED_CHEQUE'].map((type) => ({ partnerId, type, url: `https://x/uploads/${type}.jpg` })),
  })

beforeAll(async () => {
  await prisma.partner.createMany({
    data: [
      { id: ids.reg, name: ids.reg, type: 'RETAIL_SHOP', mobile: `93${stamp}`, status: 'REGISTERED' },
      { id: ids.pend, name: ids.pend, type: 'RETAIL_SHOP', mobile: `92${stamp}`, status: 'PENDING_APPROVAL' },
      { id: ids.appr, name: ids.appr, type: 'RETAIL_SHOP', mobile: `91${stamp}`, status: 'APPROVED' },
    ],
  })
})
afterAll(async () => {
  await prisma.systemLog.deleteMany({ where: { recordId: { in: Object.values(ids) } } })
  await prisma.partner.deleteMany({ where: { id: { in: Object.values(ids) } } })
})

describe('partner bank details', () => {
  it('saves for a REGISTERED partner, answers masked, stores encrypted', async () => {
    const res = await request(app).put('/api/v1/partner/bank-account').set(tok(ids.reg)).send(body)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ accountNumberMasked: 'XXXXXX7890', ifsc: 'HDFC0001234' })
    expect(JSON.stringify(res.body)).not.toContain('001234567890')
    const row = await prisma.partnerBankAccount.findUnique({ where: { partnerId: ids.reg } })
    expect(row.accountNumberEnc).not.toContain('001234567890')
    expect(row.accountLast4).toBe('7890')
  })

  it('never writes the number to the audit log', async () => {
    let logs = []
    for (let i = 0; i < 40 && !logs.length; i++) {
      logs = await prisma.systemLog.findMany({ where: { recordId: ids.reg, module: 'PartnerBankAccount' } })
      if (!logs.length) await new Promise((r) => setTimeout(r, 50))
    }
    expect(logs.length).toBeGreaterThan(0)
    expect(JSON.stringify(logs)).not.toContain('001234567890')
    expect(JSON.stringify(logs)).toContain('7890')
  })

  it('onboarding returns it masked, with the lock flag and the cheque required', async () => {
    const res = await request(app).get('/api/v1/partner/onboarding').set(tok(ids.reg))
    expect(res.body.data.bankAccount.accountNumberMasked).toBe('XXXXXX7890')
    expect(res.body.data.bankEditable).toBe(true)
    expect(res.body.data.required).toEqual(['AADHAAR', 'PAN', 'CANCELLED_CHEQUE'])
    expect(JSON.stringify(res.body)).not.toContain('001234567890')
  })

  it('refuses a bad body with 400', async () => {
    const res = await request(app).put('/api/v1/partner/bank-account').set(tok(ids.reg)).send({ ...body, ifsc: 'HDFC1001234' })
    expect(res.status).toBe(400)
  })

  it('is locked while waiting for approval (409)', async () => {
    const res = await request(app).put('/api/v1/partner/bank-account').set(tok(ids.pend)).send(body)
    expect(res.status).toBe(409)
  })

  it('lets an approved partner with no details add them once, then locks', async () => {
    expect((await request(app).put('/api/v1/partner/bank-account').set(tok(ids.appr)).send(body)).status).toBe(200)
    expect((await request(app).put('/api/v1/partner/bank-account').set(tok(ids.appr)).send(body)).status).toBe(409)
  })

  it('accepts a cheque photo as a document type', async () => {
    const res = await request(app).post('/api/v1/partner/documents').set(tok(ids.reg)).send({ type: 'CANCELLED_CHEQUE', url: 'https://evil.example/x.jpg' })
    // 400 for the foreign URL proves the TYPE passed validation and the provenance check ran.
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/uploads API/)
  })

  it('submit needs the cheque and the bank details, then works', async () => {
    await prisma.partnerDocument.createMany({
      data: ['AADHAAR', 'PAN'].map((type) => ({ partnerId: ids.reg, type, url: `https://x/uploads/${type}.jpg` })),
    })
    const missing = await request(app).post('/api/v1/partner/documents/submit').set(tok(ids.reg))
    expect(missing.status).toBe(400)
    expect(missing.body.error.message).toMatch(/Cancelled cheque/)
    await prisma.partnerDocument.create({ data: { partnerId: ids.reg, type: 'CANCELLED_CHEQUE', url: 'https://x/uploads/c.jpg' } })
    const ok = await request(app).post('/api/v1/partner/documents/submit').set(tok(ids.reg))
    expect(ok.status).toBe(200)
    expect(ok.body.data.status).toBe('PENDING_APPROVAL')
  })

  it('refuses submit from an APPROVED partner and leaves them approved', async () => {
    await docs(ids.appr)
    const res = await request(app).post('/api/v1/partner/documents/submit').set(tok(ids.appr))
    expect(res.status).toBe(409)
    expect((await prisma.partner.findUnique({ where: { id: ids.appr } })).status).toBe('APPROVED')
  })

  it('IFSC route rejects a bad code without calling out', async () => {
    const res = await request(app).get('/api/v1/partner/ifsc/HDFC1').set(tok(ids.reg))
    expect(res.status).toBe(400)
  })
})
