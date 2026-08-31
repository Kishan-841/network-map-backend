import { describe, it, expect, vi } from 'vitest'
import { createEarningService } from '../src/modules/earnings/earning.service.js'

/**
 * Money. Every rule here exists because getting it wrong is a partner being
 * paid twice, paid nothing, or paid an amount nobody can explain later.
 */

const RATES = [
  { id: 'r1', speedMbps: 100, billingPeriod: 'HALF_YEARLY', amount: 750 },
  { id: 'r2', speedMbps: 400, billingPeriod: 'YEARLY', amount: 2100 },
]

const LEAD = { id: 'l1', partnerId: 'p1', employeeId: 'e1', requirementMbps: 100 }

const build = ({ rates = RATES, existing = null } = {}) => {
  const earningRepository = {
    findByLeadId: vi.fn(async () => existing),
    create: vi.fn(async (data) => ({ id: 'earn1', ...data })),
    deleteByLeadId: vi.fn(async () => ({ count: 1 })),
    listForPartner: vi.fn(async () => []),
  }
  const rateCardRepository = {
    findRate: vi.fn(async (speed, period) =>
      rates.find((r) => r.speedMbps === speed && r.billingPeriod === period) ?? null,
    ),
  }
  return { earningRepository, rateCardRepository,
    service: createEarningService({ earningRepository, rateCardRepository }) }
}

describe('creating an earning when a lead converts', () => {
  it('snapshots the rate for the plan the customer actually took', async () => {
    const { earningRepository, service } = build()
    await service.recordConversion(LEAD, { speedMbps: 100, billingPeriod: 'HALF_YEARLY' })
    expect(earningRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'l1', partnerId: 'p1', employeeId: 'e1',
        speedMbps: 100, billingPeriod: 'HALF_YEARLY', amount: 750,
      }),
    )
  })

  it('pays for what they bought, not what they asked for', async () => {
    // Asked for 100; signed for 400 yearly. The earning is ₹2,100, not ₹750.
    const { earningRepository, service } = build()
    await service.recordConversion(LEAD, { speedMbps: 400, billingPeriod: 'YEARLY' })
    expect(earningRepository.create.mock.calls[0][0].amount).toBe(2100)
  })

  it('refuses a combination we do not sell rather than paying zero', async () => {
    const { earningRepository, service } = build()
    await expect(
      service.recordConversion(LEAD, { speedMbps: 300, billingPeriod: 'QUARTERLY' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(earningRepository.create).not.toHaveBeenCalled()
  })

  it('never pays twice for the same lead', async () => {
    const existing = { id: 'earn1', leadId: 'l1', amount: 750, status: 'AWAITING_PAYMENT' }
    const { earningRepository, service } = build({ existing })
    const out = await service.recordConversion(LEAD, { speedMbps: 400, billingPeriod: 'YEARLY' })
    expect(earningRepository.create).not.toHaveBeenCalled()
    expect(out).toBe(existing)
  })
})

describe('undoing a conversion', () => {
  it('removes an unpaid earning when the lead moves back', async () => {
    const { earningRepository, service } = build({
      existing: { id: 'earn1', status: 'AWAITING_PAYMENT' },
    })
    await service.revokeConversion('l1')
    expect(earningRepository.deleteByLeadId).toHaveBeenCalledWith('l1')
  })

  it('refuses to unwind an earning that has already been paid', async () => {
    const { earningRepository, service } = build({
      existing: { id: 'earn1', status: 'PAID' },
    })
    await expect(service.revokeConversion('l1')).rejects.toMatchObject({ status: 409 })
    expect(earningRepository.deleteByLeadId).not.toHaveBeenCalled()
  })

  it('is a no-op when there was never an earning', async () => {
    const { earningRepository, service } = build()
    await expect(service.revokeConversion('l1')).resolves.toBeNull()
    expect(earningRepository.deleteByLeadId).not.toHaveBeenCalled()
  })
})

describe('the partner’s month-by-month statement', () => {
  const rows = [
    { id: 'a', amount: 750, status: 'PAID', earnedAt: new Date('2026-08-04T10:00:00Z'),
      lead: { customerName: 'Anita' }, speedMbps: 100, billingPeriod: 'HALF_YEARLY' },
    { id: 'b', amount: 1200, status: 'PAID', earnedAt: new Date('2026-08-20T10:00:00Z'),
      lead: { customerName: 'Rohit' }, speedMbps: 100, billingPeriod: 'YEARLY' },
    { id: 'c', amount: 2100, status: 'AWAITING_PAYMENT', earnedAt: new Date('2026-07-11T10:00:00Z'),
      lead: { customerName: 'Sunil' }, speedMbps: 400, billingPeriod: 'YEARLY' },
  ]
  const statement = async () => {
    const { earningRepository, service } = build()
    earningRepository.listForPartner.mockResolvedValue(rows)
    return service.statementFor('p1')
  }

  it('groups by month, newest first', async () => {
    const { months } = await statement()
    expect(months.map((m) => m.month)).toEqual(['2026-08', '2026-07'])
  })

  it('totals each month and counts the customers', async () => {
    const { months } = await statement()
    expect(months[0]).toMatchObject({ total: 1950, count: 2, status: 'PAID' })
    expect(months[1]).toMatchObject({ total: 2100, count: 1, status: 'AWAITING_PAYMENT' })
  })

  it('a month is only paid when every line in it is', async () => {
    const { earningRepository, service } = build()
    earningRepository.listForPartner.mockResolvedValue([
      { ...rows[0] }, { ...rows[1], status: 'AWAITING_PAYMENT' },
    ])
    const { months } = await service.statementFor('p1')
    expect(months[0].status).toBe('AWAITING_PAYMENT')
  })

  it('reports the lifetime and outstanding totals', async () => {
    const out = await statement()
    expect(out.total).toBe(4050)
    expect(out.outstanding).toBe(2100)
  })

  it('has an empty statement, not a crash, for a partner who has earned nothing', async () => {
    const { earningRepository, service } = build()
    earningRepository.listForPartner.mockResolvedValue([])
    expect(await service.statementFor('p1')).toEqual({
      months: [], total: 0, outstanding: 0, count: 0,
    })
  })
})
