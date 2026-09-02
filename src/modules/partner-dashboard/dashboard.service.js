/**
 * The partner manager's overview.
 *
 * Every query takes the same scope argument: the manager's id, or null for an
 * admin who sees everything. One argument, threaded through all of them, so a
 * new figure cannot accidentally be added unscoped — a dashboard that reports
 * someone else's work as yours is worse than no dashboard.
 */
export function createPartnerDashboardService({ dashboardRepository }) {
  return {
    async overview(actor) {
      const scope = actor?.role === 'PARTNER_MANAGER' ? actor.id : null

      const [partners, leads, earnings, byMonth, topPartners, dueCalls, untouchedLeads, openIntros] =
        await Promise.all([
          dashboardRepository.partnerCounts(scope),
          dashboardRepository.leadCounts(scope),
          dashboardRepository.earningTotals(scope),
          dashboardRepository.byMonth(scope),
          dashboardRepository.topPartners(scope),
          dashboardRepository.dueCalls(scope),
          dashboardRepository.untouchedLeads(scope),
          dashboardRepository.openIntroductions(scope),
        ])

      return {
        partners,
        leads: {
          ...leads,
          // Rounded: a recurring decimal reads as false precision on a figure
          // that is a rough measure of how a month is going.
          conversionRate: leads.total ? Math.round((leads.converted / leads.total) * 100) : 0,
        },
        earnings,
        byMonth,
        topPartners,
        // The two lists that are actual work, and one number for the badge.
        dueCalls,
        untouchedLeads,
        waiting: dueCalls.length + untouchedLeads.length,
        introductions: { open: openIntros },
      }
    },
  }
}
