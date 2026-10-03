import { describe, it, expect, vi } from 'vitest'
import { createPartnerDashboardService } from '../src/modules/partner-dashboard/dashboard.service.js'

/**
 * The partner manager's dashboard.
 *
 * Every figure is scoped to the manager: their partners, the leads those
 * partners sent, the earnings those leads made. An admin sees all of it.
 * A dashboard that quietly widens its scope is worse than none — it reports
 * someone else's work as yours.
 */
const repo = () => ({
  partnerCounts: vi.fn(async () => ({ total: 8, approved: 6, pending: 2 })),
  leadCounts: vi.fn(async () => ({ total: 40, converted: 12, thisMonth: 9, convertedThisMonth: 3 })),
  earningTotals: vi.fn(async () => ({ total: 27000, thisMonth: 4500 })),
  byMonth: vi.fn(async () => [{ month: '2026-08', added: 9, converted: 3 }]),
  topPartners: vi.fn(async () => [{ id: 'p1', name: 'Meena', leads: 12, converted: 5, earnings: 9000 }]),
  dueCalls: vi.fn(async () => [{ id: 'l1', customerName: 'Anita', nextCallAt: new Date() }]),
  untouchedLeads: vi.fn(async () => [{ id: 'l2', customerName: 'Rohit' }]),
  openIntroductions: vi.fn(async () => 3),
})

const PM = { id: 'e1', role: 'PARTNER_MANAGER' }
const ADMIN = { id: 'a1', role: 'ADMIN' }

describe('what the dashboard scopes to', () => {
  it('confines a partner manager to their own employee id', async () => {
    const r = repo()
    await createPartnerDashboardService({ dashboardRepository: r }).overview(PM)
    for (const fn of ['partnerCounts', 'leadCounts', 'earningTotals', 'byMonth', 'topPartners',
                      'dueCalls', 'untouchedLeads', 'openIntroductions']) {
      expect(r[fn], fn).toHaveBeenCalledWith('e1')
    }
  })

  it('passes null for an admin, so nothing is filtered', async () => {
    const r = repo()
    await createPartnerDashboardService({ dashboardRepository: r }).overview(ADMIN)
    expect(r.leadCounts).toHaveBeenCalledWith(null)
  })
})

describe('the figures', () => {
  const overview = (over = {}) => {
    const r = { ...repo(), ...over }
    return createPartnerDashboardService({ dashboardRepository: r }).overview(PM)
  }

  it('carries the headline counts through', async () => {
    const out = await overview()
    expect(out.partners).toMatchObject({ total: 8, approved: 6, pending: 2 })
    expect(out.leads).toMatchObject({ total: 40, converted: 12, thisMonth: 9 })
  })

  it('works out the conversion rate', async () => {
    expect((await overview()).leads.conversionRate).toBe(30)
  })

  it('is 0%, not NaN, before any lead has arrived', async () => {
    const out = await overview({
      leadCounts: vi.fn(async () => ({ total: 0, converted: 0, thisMonth: 0, convertedThisMonth: 0 })),
    })
    expect(out.leads.conversionRate).toBe(0)
  })

  it('rounds the rate rather than printing a recurring decimal', async () => {
    const out = await overview({
      leadCounts: vi.fn(async () => ({ total: 3, converted: 1, thisMonth: 0, convertedThisMonth: 0 })),
    })
    expect(out.leads.conversionRate).toBe(33)
  })

  it('counts the work waiting: callbacks due plus leads never touched', async () => {
    const out = await overview()
    expect(out.waiting).toBe(2)
  })

  it('hands back the lists the manager acts on', async () => {
    const out = await overview()
    expect(out.dueCalls).toHaveLength(1)
    expect(out.untouchedLeads).toHaveLength(1)
    expect(out.introductions.open).toBe(3)
  })

  it('survives a manager with nothing at all', async () => {
    const empty = {
      partnerCounts: vi.fn(async () => ({ total: 0, approved: 0, pending: 0 })),
      leadCounts: vi.fn(async () => ({ total: 0, converted: 0, thisMonth: 0, convertedThisMonth: 0 })),
      earningTotals: vi.fn(async () => ({ total: 0, thisMonth: 0 })),
      byMonth: vi.fn(async () => []),
      topPartners: vi.fn(async () => []),
      dueCalls: vi.fn(async () => []),
      untouchedLeads: vi.fn(async () => []),
      openIntroductions: vi.fn(async () => 0),
    }
    const out = await createPartnerDashboardService({ dashboardRepository: empty }).overview(PM)
    expect(out).toMatchObject({ waiting: 0, leads: { conversionRate: 0 } })
  })
})

describe('the real repository exposes what the service calls', () => {
  it('has every query, so an unwired one fails here not in the browser', async () => {
    const { dashboardRepository } = await import(
      '../src/modules/partner-dashboard/dashboard.repository.js'
    )
    for (const fn of ['partnerCounts', 'leadCounts', 'earningTotals', 'byMonth', 'topPartners',
                      'dueCalls', 'untouchedLeads', 'openIntroductions']) {
      expect(typeof dashboardRepository[fn], fn).toBe('function')
    }
  })
})
