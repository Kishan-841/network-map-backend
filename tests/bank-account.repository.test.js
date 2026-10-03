import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { bankAccountRepository } from '../src/modules/partners/bank-account.repository.js'

const stamp = String(Date.now()).slice(-8)
const P = `bank-repo-${stamp}`
const row = { accountHolderName: 'Asha Patil', accountNumberEnc: 'v1:a:b:c', accountLast4: '1234', ifsc: 'HDFC0001234', bankName: 'HDFC Bank', branchName: 'Cidco', updatedById: null }

beforeAll(() => prisma.partner.create({ data: { id: P, name: P, type: 'RETAIL_SHOP', mobile: `94${stamp}` } }))
afterAll(() => prisma.partner.deleteMany({ where: { id: P } }))

describe('bankAccountRepository', () => {
  it('has every method the service relies on', () => {
    for (const m of ['findByPartnerId', 'upsert', 'findManyByPartnerIds']) {
      expect(typeof bankAccountRepository[m]).toBe('function')
    }
  })

  it('creates, then updates in place (one row per partner)', async () => {
    await bankAccountRepository.upsert(P, row)
    await bankAccountRepository.upsert(P, { ...row, branchName: 'Garkheda' })
    expect(await prisma.partnerBankAccount.count({ where: { partnerId: P } })).toBe(1)
    const found = await bankAccountRepository.findByPartnerId(P)
    expect(found.branchName).toBe('Garkheda')
    expect(found.updatedBy).toBeNull()
  })

  it('finds many by partner id', async () => {
    const rows = await bankAccountRepository.findManyByPartnerIds([P, 'nobody'])
    expect(rows.map((r) => r.partnerId)).toEqual([P])
  })

  it('accepts CANCELLED_CHEQUE as a document type', async () => {
    const doc = await prisma.partnerDocument.create({ data: { partnerId: P, type: 'CANCELLED_CHEQUE', url: 'https://x/uploads/c.jpg' } })
    expect(doc.type).toBe('CANCELLED_CHEQUE')
  })
})
