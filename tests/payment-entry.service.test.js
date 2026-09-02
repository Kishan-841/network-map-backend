import { describe, it, expect, vi } from 'vitest'
import { createPayoutService } from '../src/modules/earnings/payout.service.js'

/**
 * The entry accounts actually make: how much moved, by what route, and the
 * reference the partner can check against their bank.
 */
const OWED = [{ partnerId: 'p1', month: '2026-08', partnerName: 'Meena', amount: 1950, count: 2 }]

const build = ({ owed = OWED, settled = { count: 2 } } = {}) => {
  const repo = {
    owedByPartnerMonth: vi.fn(async () => owed),
    paidByPartnerMonth: vi.fn(async () => []),
    recordPayment: vi.fn(async ({ payment }) => ({ payment: { id: 'pay1', ...payment }, ...settled })),
  }
  return { repo, service: createPayoutService({ earningRepository: repo }) }
}
const ACC = { id: 'acc1', role: 'ACCOUNTS' }
const ENTRY = {
  partnerId: 'p1',
  month: '2026-08',
  amountPaid: 1950,
  method: 'BANK_TRANSFER',
  reference: 'UTR123456',
  paidOn: '2026-09-02',
}

describe('recording a payment', () => {
  it('saves what moved, how, and the reference', async () => {
    const { repo, service } = build()
    await service.markPaid(ENTRY, ACC)
    expect(repo.recordPayment.mock.calls[0][0].payment).toMatchObject({
      partnerId: 'p1',
      month: '2026-08',
      amountPaid: 1950,
      method: 'BANK_TRANSFER',
      reference: 'UTR123456',
      recordedById: 'acc1',
    })
  })

  it('snapshots what was owed at the time, from the server not the form', async () => {
    // Sent from a stale screen: the client claims 1 rupee was owed.
    const { repo, service } = build()
    await service.markPaid({ ...ENTRY, amountOwed: 1 }, ACC)
    expect(repo.recordPayment.mock.calls[0][0].payment.amountOwed).toBe(1950)
  })

  it('keeps a part payment visible instead of pretending it matched', async () => {
    const { repo, service } = build()
    await service.markPaid({ ...ENTRY, amountPaid: 1000 }, ACC)
    const saved = repo.recordPayment.mock.calls[0][0].payment
    expect(saved).toMatchObject({ amountOwed: 1950, amountPaid: 1000 })
  })

  it('records when the money MOVED, not when the entry was typed', async () => {
    const { repo, service } = build()
    await service.markPaid({ ...ENTRY, paidOn: '2026-08-29' }, ACC)
    expect(repo.recordPayment.mock.calls[0][0].payment.paidOn.toISOString()).toContain('2026-08-29')
  })

  it('defaults the date to today when none is given', async () => {
    const { repo, service } = build()
    await service.markPaid({ ...ENTRY, paidOn: undefined }, ACC)
    expect(repo.recordPayment.mock.calls[0][0].payment.paidOn).toBeInstanceOf(Date)
  })
})

describe('what the entry must contain', () => {
  const bad = async (patch) => {
    const { repo, service } = build()
    const err = await service.markPaid({ ...ENTRY, ...patch }, ACC).catch((e) => e)
    return { status: err?.status, called: repo.recordPayment.mock.calls.length }
  }

  it('needs a reference for anything that is not cash', async () => {
    // A bank transfer with no UTR cannot be checked against a statement.
    for (const method of ['BANK_TRANSFER', 'UPI', 'CHEQUE']) {
      expect((await bad({ method, reference: '' })).status, method).toBe(400)
    }
  })

  it('allows cash without one', async () => {
    const { repo, service } = build()
    await service.markPaid({ ...ENTRY, method: 'CASH', reference: '' }, ACC)
    expect(repo.recordPayment).toHaveBeenCalled()
  })

  it('rejects an amount that is zero, negative or not a number', async () => {
    for (const amountPaid of [0, -50, 'abc', null, undefined]) {
      expect((await bad({ amountPaid })).status, String(amountPaid)).toBe(400)
    }
  })

  it('rejects a method we do not offer', async () => {
    expect((await bad({ method: 'BITCOIN' })).status).toBe(400)
  })

  it('rejects a month that is not a real YYYY-MM', async () => {
    expect((await bad({ month: '2026-13' })).status).toBe(400)
  })

  it('refuses when nothing is owed for that partner-month', async () => {
    // Guards a stale screen: two people settling the same month.
    const { repo, service } = build({ owed: [] })
    await expect(service.markPaid(ENTRY, ACC)).rejects.toMatchObject({ status: 409 })
    expect(repo.recordPayment).not.toHaveBeenCalled()
  })

  it('never records a payment when validation fails', async () => {
    expect((await bad({ amountPaid: -1 })).called).toBe(0)
  })
})
