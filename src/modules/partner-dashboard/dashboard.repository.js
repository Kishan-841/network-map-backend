import { prisma } from '../../lib/prisma.js'

/** Start of the current month, UTC — the same boundary the statement uses. */
const monthStart = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/**
 * `scope` is a partner manager's user id, or null for an admin.
 *
 * Every function takes it and applies it the same way, so there is one place
 * to look when asking "could this leak another manager's figures".
 */
const byEmployee = (scope) => (scope ? { employeeId: scope } : {})

export const dashboardRepository = {
  async partnerCounts(scope) {
    const where = scope ? { onboardedById: scope } : {}
    const [total, approved, pending] = await Promise.all([
      prisma.partner.count({ where }),
      prisma.partner.count({ where: { ...where, status: 'APPROVED' } }),
      prisma.partner.count({
        where: { ...where, status: { in: ['REGISTERED', 'PENDING_APPROVAL'] } },
      }),
    ])
    return { total, approved, pending }
  },

  async leadCounts(scope) {
    const where = byEmployee(scope)
    const since = monthStart()
    const [total, converted, thisMonth, convertedThisMonth] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.count({ where: { ...where, status: 'CONVERTED' } }),
      prisma.lead.count({ where: { ...where, createdAt: { gte: since } } }),
      prisma.lead.count({ where: { ...where, status: 'CONVERTED', createdAt: { gte: since } } }),
    ])
    return { total, converted, thisMonth, convertedThisMonth }
  },

  async earningTotals(scope) {
    const where = byEmployee(scope)
    const since = monthStart()
    const [all, month] = await Promise.all([
      prisma.partnerEarning.aggregate({ where, _sum: { amount: true } }),
      prisma.partnerEarning.aggregate({
        where: { ...where, earnedAt: { gte: since } },
        _sum: { amount: true },
      }),
    ])
    return { total: all._sum.amount ?? 0, thisMonth: month._sum.amount ?? 0 }
  },

  /**
   * Six months of leads added against leads converted.
   *
   * One pass over the leads rather than twelve counts: the added month comes
   * from createdAt and the converted month from the same row, so a lead that
   * arrived in July and converted in July counts once in each series.
   */
  async byMonth(scope) {
    const since = new Date()
    since.setUTCMonth(since.getUTCMonth() - 5)
    const start = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1))

    const rows = await prisma.lead.findMany({
      where: { ...byEmployee(scope), createdAt: { gte: start } },
      select: { createdAt: true, status: true },
    })

    const key = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const months = new Map()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + (5 - i), 1))
      months.set(key(d), { month: key(d), added: 0, converted: 0 })
    }
    for (const lead of rows) {
      const slot = months.get(key(lead.createdAt))
      if (!slot) continue
      slot.added += 1
      if (lead.status === 'CONVERTED') slot.converted += 1
    }
    return [...months.values()]
  },

  /** The partners actually producing, by leads sent. */
  async topPartners(scope, take = 5) {
    const partners = await prisma.partner.findMany({
      where: scope ? { onboardedById: scope } : {},
      select: {
        id: true,
        name: true,
        _count: { select: { leads: true } },
        leads: { where: { status: 'CONVERTED' }, select: { id: true } },
        earnings: { select: { amount: true } },
      },
    })
    return partners
      .map((p) => ({
        id: p.id,
        name: p.name,
        leads: p._count.leads,
        converted: p.leads.length,
        earnings: p.earnings.reduce((sum, e) => sum + e.amount, 0),
      }))
      .filter((p) => p.leads > 0)
      .sort((a, b) => b.leads - a.leads || b.earnings - a.earnings)
      .slice(0, take)
  },

  /** Callbacks that are due or overdue, soonest first — this is the work. */
  dueCalls: (scope, take = 10) =>
    prisma.lead.findMany({
      where: {
        ...byEmployee(scope),
        nextCallAt: { not: null, lte: new Date() },
        status: { notIn: ['CONVERTED', 'NOT_INTERESTED', 'DUPLICATE'] },
      },
      orderBy: { nextCallAt: 'asc' },
      take,
      select: {
        id: true, customerName: true, customerMobile: true, nextCallAt: true, status: true,
        partner: { select: { id: true, name: true } },
      },
    }),

  /** Leads nobody has touched yet, oldest first — the ones going stale. */
  untouchedLeads: (scope, take = 10) =>
    prisma.lead.findMany({
      where: { ...byEmployee(scope), status: 'NEW' },
      orderBy: { createdAt: 'asc' },
      take,
      select: {
        id: true, customerName: true, customerMobile: true, createdAt: true, status: true,
        partner: { select: { id: true, name: true } },
      },
    }),

  openIntroductions: (scope) =>
    prisma.partnerReferral.count({
      where: { ...byEmployee(scope), status: { in: ['NEW', 'CONTACTED'] } },
    }),
}
