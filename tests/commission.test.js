import { describe, it, expect, vi } from 'vitest'
import { FLAT_AMOUNT, FLAT_PAY_TYPES, commissionFor, fixedAmountFor } from '../src/modules/earnings/commission.js'
import { createEarningService } from '../src/modules/earnings/earning.service.js'

/**
 * Agents, society representatives and retail shops only pass a lead on — our
 * sales team does the converting — so they are paid a flat ₹500 per customer
 * who signs up. A DSA works the lead until it converts, so a DSA is paid from
 * the rate card (speed × plan length).
 */
describe('commission rule', () => {
  it('pays agents, society reps and shops a flat ₹500, whatever the plan is worth', () => {
    expect(FLAT_AMOUNT).toBe(500)
    expect(FLAT_PAY_TYPES).toEqual(['AGENT', 'SOCIETY_REPRESENTATIVE', 'RETAIL_SHOP'])
    for (const type of FLAT_PAY_TYPES) {
      expect(commissionFor(type, { amount: 2100 })).toBe(500)
      expect(commissionFor(type, { amount: 375 })).toBe(500)
    }
  })

  it('pays a DSA the rate-card amount', () => {
    expect(commissionFor('DSA', { amount: 750 })).toBe(750)
    expect(commissionFor('DSA', { amount: 2100 })).toBe(2100)
  })

  it('says which types are paid a flat amount', () => {
    expect(fixedAmountFor('RETAIL_SHOP')).toBe(500)
    expect(fixedAmountFor('DSA')).toBeNull()
    // An unknown type is paid from the rate card, never assumed flat.
    expect(fixedAmountFor(undefined)).toBeNull()
  })
})

describe('recording a conversion', () => {
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

  it('records ₹500 for a retail shop and still the plan the customer took', async () => {
    const { earningRepository, service } = build('RETAIL_SHOP')
    await service.recordConversion(lead, { speedMbps: 400, billingPeriod: 'YEARLY' })
    expect(earningRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500, speedMbps: 400, billingPeriod: 'YEARLY' }),
    )
  })

  it('records the rate-card amount for a DSA', async () => {
    const { earningRepository, service } = build('DSA')
    await service.recordConversion(lead, { speedMbps: 400, billingPeriod: 'YEARLY' })
    expect(earningRepository.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 2100 }))
  })

  it('still refuses a plan we do not sell, for a flat-pay partner too', async () => {
    const { earningRepository, service } = build('AGENT')
    await expect(service.recordConversion(lead, { speedMbps: 999, billingPeriod: 'YEARLY' })).rejects.toMatchObject({ status: 400 })
    expect(earningRepository.create).not.toHaveBeenCalled()
  })
})
