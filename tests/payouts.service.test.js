import { describe, it, expect, vi } from 'vitest'
import { createPayoutService } from '../src/modules/earnings/payout.service.js'

/**
 * What accounts sees, and what pressing "paid" actually does.
 *
 * A payout is per partner per MONTH, not per lead: you pay someone once for
 * August, not eleven times. So the screen groups, and marking paid settles
 * every unpaid earning in that group.
 */
const ROWS = [
  { partnerId: 'p1', month: '2026-08', partnerName: 'Meena', partnerMobile: '9812300001', amount: 750, count: 1 },
  { partnerId: 'p1', month: '2026-07', partnerName: 'Meena', partnerMobile: '9812300001', amount: 1200, count: 2 },
  { partnerId: 'p2', month: '2026-08', partnerName: 'Raghav', partnerMobile: '9812300002', amount: 375, count: 1 },
]

const build = ({ owed = ROWS, marked = { count: 2, payment: { id: 'pay1' } } } = {}) => {
  const repo = {
    owedByPartnerMonth: vi.fn(async () => owed),
    paidByPartnerMonth: vi.fn(async () => []),
    recordPayment: vi.fn(async () => marked),
  }
  return { repo, service: createPayoutService({ earningRepository: repo }) }
}
const ACCOUNTS = { id: 'acc1', role: 'ACCOUNTS' }

describe('what is owed', () => {
  it('lists a row per partner per month, newest month first', async () => {
    const { service } = build()
    const { owed } = await service.outstanding()
    expect(owed.map((r) => `${r.partnerName} ${r.month}`)).toEqual([
      'Meena 2026-08', 'Raghav 2026-08', 'Meena 2026-07',
    ])
  })

  it('totals what is owed across everyone', async () => {
    const { service } = build()
    expect((await service.outstanding()).total).toBe(2325)
  })

  it('is an empty list, not a crash, when nothing is owed', async () => {
    const { service } = build({ owed: [] })
    expect(await service.outstanding()).toMatchObject({ owed: [], total: 0 })
  })
})
describe('outstanding carries where to pay', () => {
  it("attaches each partner's bank details, or null", async () => {
    const earningRepository = {
      owedByPartnerMonth: async () => [
        { partnerId: 'p1', month: '2026-09', partnerName: 'A', amount: 750, count: 1 },
        { partnerId: 'p2', month: '2026-09', partnerName: 'B', amount: 900, count: 1 },
      ],
    }
    const payees = { payeesFor: async () => new Map([['p1', { accountNumber: '001234567890', ifsc: 'HDFC0001234' }]]) }
    const { owed } = await createPayoutService({ earningRepository, payees }).outstanding()
    expect(owed.find((r) => r.partnerId === 'p1').bankAccount.accountNumber).toBe('001234567890')
    expect(owed.find((r) => r.partnerId === 'p2').bankAccount).toBeNull()
  })
})
describe('the month is still validated before anything is recorded', () => {
  const ACC = { id: 'acc1', role: 'ACCOUNTS' }
  const entry = { partnerId: 'p1', amountPaid: 100, method: 'CASH' }

  it.each(['2026-13', 'august', '2026', '', '2026-8', null])(
    'refuses month %s',
    async (month) => {
      const { repo, service } = build()
      await expect(service.markPaid({ ...entry, month }, ACC)).rejects.toMatchObject({ status: 400 })
      expect(repo.recordPayment).not.toHaveBeenCalled()
    },
  )
})
