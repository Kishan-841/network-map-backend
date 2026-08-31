import { describe, it, expect, vi } from 'vitest'
import { createRateCardService, quoteFor } from '../src/modules/rate-card/rate-card.service.js'

const RATES = [
  { speedMbps: 100, billingPeriod: 'QUARTERLY', amount: 375 },
  { speedMbps: 100, billingPeriod: 'HALF_YEARLY', amount: 750 },
  { speedMbps: 100, billingPeriod: 'YEARLY', amount: 1200 },
  { speedMbps: 200, billingPeriod: 'HALF_YEARLY', amount: 900 },
]

const svc = () => createRateCardService({ rateCardRepository: { current: vi.fn(async () => RATES) } })

describe('the rate card', () => {
  it('serves the current rates', async () => {
    const out = await svc().getCurrent()
    expect(out.rates).toHaveLength(4)
    expect(out.rates[0]).toEqual({ speedMbps: 100, billingPeriod: 'QUARTERLY', amount: 375 })
  })

  it('names the speeds and periods so the grid needs no hardcoded axes', async () => {
    const out = await svc().getCurrent()
    expect(out.speeds).toEqual([100, 200])
    expect(out.periods).toEqual(['QUARTERLY', 'HALF_YEARLY', 'YEARLY'])
  })
})

/**
 * The rate is PER CUSTOMER — the figure the partner earns for one connection
 * at that speed and billing period. See the conflict note in
 * partner-network.md §3.2: the table and the spoken example disagreed, and
 * this is the reading the table supports.
 */
describe('quoting', () => {
  it('multiplies the rate by the number of customers', () => {
    expect(quoteFor(RATES, [{ speedMbps: 100, billingPeriod: 'HALF_YEARLY', customers: 3 }])).toBe(2250)
  })

  it('is zero for no customers', () => {
    expect(quoteFor(RATES, [{ speedMbps: 100, billingPeriod: 'HALF_YEARLY', customers: 0 }])).toBe(0)
  })

  it('adds every cell of the grid together', () => {
    const total = quoteFor(RATES, [
      { speedMbps: 100, billingPeriod: 'QUARTERLY', customers: 2 },   // 750
      { speedMbps: 100, billingPeriod: 'YEARLY', customers: 1 },      // 1200
      { speedMbps: 200, billingPeriod: 'HALF_YEARLY', customers: 4 }, // 3600
    ])
    expect(total).toBe(5550)
  })

  it('ignores a combination we have no rate for rather than counting it as zero-priced', () => {
    expect(quoteFor(RATES, [{ speedMbps: 400, billingPeriod: 'YEARLY', customers: 5 }])).toBe(0)
  })

  it('refuses a negative or fractional customer count', () => {
    expect(() =>
      quoteFor(RATES, [{ speedMbps: 100, billingPeriod: 'HALF_YEARLY', customers: -2 }]),
    ).toThrow()
    expect(() =>
      quoteFor(RATES, [{ speedMbps: 100, billingPeriod: 'HALF_YEARLY', customers: 1.5 }]),
    ).toThrow()
  })
})
