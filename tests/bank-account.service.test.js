import { describe, it, expect, vi } from 'vitest'
import crypto from 'node:crypto'
import { createFieldCipher } from '../src/lib/field-cipher.js'
import { createBankAccountService } from '../src/modules/partners/bank-account.service.js'
import { bankAccountSchema, redactBankBody } from '../src/modules/partners/bank-account.schemas.js'

const cipher = createFieldCipher(crypto.randomBytes(32).toString('base64'))
const input = { accountHolderName: 'Asha Patil', accountNumber: '001234567890', ifsc: 'HDFC0001234', branchName: 'Cidco', bankName: 'HDFC Bank' }

function make(existing = null) {
  let stored = existing
  const bankAccountRepository = {
    findByPartnerId: vi.fn(async () => stored),
    upsert: vi.fn(async (partnerId, data) => (stored = { partnerId, updatedBy: null, updatedAt: new Date(), ...data })),
    findManyByPartnerIds: vi.fn(async () => (stored ? [stored] : [])),
  }
  const partnerRepository = { findById: vi.fn(async (id) => (id === 'missing' ? null : { id, status: 'APPROVED' })) }
  return { svc: createBankAccountService({ bankAccountRepository, partnerRepository, cipher }), bankAccountRepository, stored: () => stored }
}

describe('bankAccountSchema', () => {
  it('strips spaces, keeps leading zeros, upper-cases the IFSC', () => {
    const out = bankAccountSchema.parse({ ...input, accountNumber: '0012 3456 7890', ifsc: ' hdfc0001234 ' })
    expect(out.accountNumber).toBe('001234567890')
    expect(out.ifsc).toBe('HDFC0001234')
  })
  it.each([['12345678'], ['1234567890123456789'], ['12345abc901']])('refuses account number %s', (n) => {
    expect(bankAccountSchema.safeParse({ ...input, accountNumber: n }).success).toBe(false)
  })
  it.each([['HDFC1001234'], ['HDF00001234'], ['HDFC000123']])('refuses IFSC %s', (ifsc) => {
    expect(bankAccountSchema.safeParse({ ...input, ifsc }).success).toBe(false)
  })
  it('refuses unknown fields', () => {
    expect(bankAccountSchema.safeParse({ ...input, status: 'APPROVED' }).success).toBe(false)
  })
  it('redacts the number for the audit log', () => {
    const r = redactBankBody({ ...input, accountNumber: '0012 3456 7890' })
    expect(r.accountNumber).toBeUndefined()
    expect(r.accountLast4).toBe('7890')
  })
})

describe('bank account service', () => {
  it('stores the number encrypted with last4, returns it masked', async () => {
    const { svc, stored } = make()
    const out = await svc.saveByPartner({ id: 'p1', status: 'REGISTERED' }, input)
    expect(out.accountNumberMasked).toBe('XXXXXX7890')
    expect(JSON.stringify(out)).not.toContain('001234567890')
    expect(stored().accountNumberEnc).not.toContain('001234567890')
    expect(cipher.decrypt(stored().accountNumberEnc)).toBe('001234567890')
    expect(stored().accountLast4).toBe('7890')
    expect(stored().updatedById).toBeNull()
  })

  it.each([
    ['REGISTERED', false, true], ['REJECTED', true, true], ['APPROVED', false, true],
    ['APPROVED', true, false], ['PENDING_APPROVAL', false, false], ['SUSPENDED', false, false],
  ])('status %s with row=%s → editable %s', (status, hasRow, editable) => {
    expect(make().svc.isEditableByPartner(status, hasRow)).toBe(editable)
  })

  it('refuses a locked partner with 409', async () => {
    const { svc } = make({ accountLast4: '1111' })
    await expect(svc.saveByPartner({ id: 'p1', status: 'APPROVED' }, input)).rejects.toMatchObject({ status: 409 })
  })

  it('gives an admin the full number and records who edited', async () => {
    const { svc, stored } = make({ accountLast4: '1111' })
    const out = await svc.saveByAdmin('p1', input, { id: 'admin1' })
    expect(out.accountNumber).toBe('001234567890')
    expect(stored().updatedById).toBe('admin1')
  })

  it('404s an admin edit for a partner that does not exist', async () => {
    await expect(make().svc.saveByAdmin('missing', input, { id: 'a' })).rejects.toMatchObject({ status: 404 })
  })

  it('maps payees by partner id with the full number', async () => {
    const { svc } = make()
    await svc.saveByPartner({ id: 'p1', status: 'REGISTERED' }, input)
    const map = await svc.payeesFor(['p1'])
    expect(map.get('p1')).toMatchObject({ accountNumber: '001234567890', ifsc: 'HDFC0001234' })
  })
})
