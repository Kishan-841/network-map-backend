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

const build = ({ owed = ROWS, marked = { count: 2 } } = {}) => {
  const repo = {
    owedByPartnerMonth: vi.fn(async () => owed),
    paidByPartnerMonth: vi.fn(async () => []),
    markMonthPaid: vi.fn(async () => marked),
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

describe('recording a payment', () => {
  it('settles every unpaid earning in that partner-month', async () => {
    const { repo, service } = build()
    await service.markPaid({ partnerId: 'p1', month: '2026-08' }, ACCOUNTS)
    expect(repo.markMonthPaid).toHaveBeenCalledWith({
      partnerId: 'p1',
      month: '2026-08',
      byUserId: 'acc1',
    })
  })

  it('reports how many earnings it settled', async () => {
    const { service } = build({ marked: { count: 3 } })
    expect(await service.markPaid({ partnerId: 'p1', month: '2026-08' }, ACCOUNTS)).toMatchObject({
      count: 3,
    })
  })

  it('refuses a month that is not a real YYYY-MM', async () => {
    const { repo, service } = build()
    for (const month of ['2026-13', 'august', '2026', '', '2026-8', null]) {
      await expect(
        service.markPaid({ partnerId: 'p1', month }, ACCOUNTS),
      ).rejects.toMatchObject({ status: 400 })
    }
    expect(repo.markMonthPaid).not.toHaveBeenCalled()
  })

  it('refuses without a partner', async () => {
    const { service } = build()
    await expect(service.markPaid({ month: '2026-08' }, ACCOUNTS)).rejects.toMatchObject({
      status: 400,
    })
  })

  it('says so plainly when there was nothing left to pay', async () => {
    // Two people pressing the button at once, or a month already settled.
    // Not an error — but it must not report a payment that did not happen.
    const { service } = build({ marked: { count: 0 } })
    const out = await service.markPaid({ partnerId: 'p1', month: '2026-08' }, ACCOUNTS)
    expect(out).toMatchObject({ count: 0, alreadySettled: true })
  })
})
