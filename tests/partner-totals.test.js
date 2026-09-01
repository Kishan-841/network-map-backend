import { describe, it, expect, vi } from 'vitest'
import { withPartnerTotals } from '../src/modules/partners/partner-totals.js'

/**
 * Each partner's figures on the roster: how many customers they sent in, how
 * many of those signed up, and what that earned them.
 *
 * The sums come from a separate grouped query rather than from including
 * every earning row — a productive partner would otherwise ship hundreds of
 * rows per screen to produce one number.
 */
const PARTNERS = [
  { id: 'p1', name: 'Meena', _count: { leads: 7, earnings: 3 } },
  { id: 'p2', name: 'Raghav', _count: { leads: 2, earnings: 0 } },
]

describe('attaching totals to a partner list', () => {
  it('reads the counts straight off the row', () => {
    const [meena] = withPartnerTotals(PARTNERS, [])
    expect(meena).toMatchObject({ customersAdded: 7, customersActivated: 3 })
  })

  it('matches each partner to their own sum', () => {
    const rows = withPartnerTotals(PARTNERS, [
      { partnerId: 'p1', _sum: { amount: 2700 } },
      { partnerId: 'p2', _sum: { amount: 900 } },
    ])
    expect(rows.map((r) => r.totalEarnings)).toEqual([2700, 900])
  })

  it('is zero, not undefined, for a partner who has earned nothing', () => {
    const [, raghav] = withPartnerTotals(PARTNERS, [{ partnerId: 'p1', _sum: { amount: 2700 } }])
    expect(raghav.totalEarnings).toBe(0)
  })

  it('survives a null sum, which is what an empty group returns', () => {
    const [meena] = withPartnerTotals(PARTNERS, [{ partnerId: 'p1', _sum: { amount: null } }])
    expect(meena.totalEarnings).toBe(0)
  })

  it('drops the raw _count so the API shape stays deliberate', () => {
    const [meena] = withPartnerTotals(PARTNERS, [])
    expect(meena._count).toBeUndefined()
  })

  it('keeps every other field untouched', () => {
    const [meena] = withPartnerTotals(PARTNERS, [])
    expect(meena.name).toBe('Meena')
    expect(meena.id).toBe('p1')
  })

  it('handles an empty roster', () => {
    expect(withPartnerTotals([], [])).toEqual([])
  })

  it('tolerates a partner row with no _count at all', () => {
    const [row] = withPartnerTotals([{ id: 'p9', name: 'X' }], [])
    expect(row).toMatchObject({ customersAdded: 0, customersActivated: 0, totalEarnings: 0 })
  })
})

/**
 * The wiring. The tests above use plain objects, so they cannot notice that
 * the real repository is missing the method the route calls — the seam that
 * has already shipped two 500s in this feature.
 */
describe('the real repository exposes what the route calls', () => {
  it('has listWithTotals', async () => {
    const { partnerRepository } = await import('../src/modules/partners/partner.repository.js')
    expect(typeof partnerRepository.listWithTotals).toBe('function')
  })
})
