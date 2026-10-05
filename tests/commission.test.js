import { describe, it, expect, vi } from 'vitest'
import { DSA_FIXED_AMOUNT, commissionFor, fixedAmountFor } from '../src/modules/earnings/commission.js'
import { createEarningService } from '../src/modules/earnings/earning.service.js'

/**
 * DSAs are paid a flat ₹500 per customer who signs up, whatever plan the
 * customer takes. Every other partner type is paid from the rate card.
 */
describe('commission rule', () => {
  it('is ₹500 flat for a DSA, whatever the plan is worth', () => {
    expect(DSA_FIXED_AMOUNT).toBe(500)
    expect(commissionFor('DSA', { amount: 2100 })).toBe(500)
    expect(commissionFor('DSA', { amount: 375 })).toBe(500)
  })

  it.each(['AGENT', 'SOCIETY_REPRESENTATIVE', 'RETAIL_SHOP'])('pays %s the rate-card amount', (type) => {
    expect(commissionFor(type, { amount: 750 })).toBe(750)
  })

  it('says which types are paid a fixed amount', () => {
    expect(fixedAmountFor('DSA')).toBe(500)
    expect(fixedAmountFor('AGENT')).toBeNull()
    expect(fixedAmountFor(undefined)).toBeNull()
  })
})

describe('recording a conversion for a DSA', () => {
  const RATES = [{ speedMbps: 400, billingPeriod: 'YEARLY', amount: 2100 }]
  const build = (type) => {
    const earningRepository = {
      findByLeadId: vi.fn(async () => null),
      create: vi.fn(async (data) => ({ id: 'e', ...data })),
    }
    const rateCardRepository = {
      findRate: vi.fn(async (s, p) => RATES.find((r) => r.speedMbps === s && r.billingPeriod === p) ?? null),
    }
    const partnerRepository = { findById: vi.fn(async (id) => ({ id, type })) }
    return { earningRepository, service: createEarningService({ earningRepository, rateCardRepository, partnerRepository }) }
  }
  const lead = { id: 'l1', partnerId: 'p1', employeeId: null }

  it('records ₹500 and still the plan the customer took', async () => {
    const { earningRepository, service } = build('DSA')
    await service.recordConversion(lead, { speedMbps: 400, billingPeriod: 'YEARLY' })
    expect(earningRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500, speedMbps: 400, billingPeriod: 'YEARLY' }),
    )
  })

  it('records the rate-card amount for any other partner', async () => {
    const { earningRepository, service } = build('RETAIL_SHOP')
    await service.recordConversion(lead, { speedMbps: 400, billingPeriod: 'YEARLY' })
    expect(earningRepository.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 2100 }))
  })

  it('still refuses a plan we do not sell, for a DSA too', async () => {
    const { earningRepository, service } = build('DSA')
    await expect(service.recordConversion(lead, { speedMbps: 999, billingPeriod: 'YEARLY' })).rejects.toMatchObject({ status: 400 })
    expect(earningRepository.create).not.toHaveBeenCalled()
  })
})
