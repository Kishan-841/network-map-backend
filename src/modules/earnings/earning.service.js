import { ApiError } from '../../lib/api-error.js'

/** The month a date belongs to, as the statement groups it. */
const monthKey = (date) => {
  const d = new Date(date)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function createEarningService({ earningRepository, rateCardRepository }) {
  return {
    /** The earning behind a lead, if one was ever recorded. */
    findForLead: (leadId) => earningRepository.findByLeadId(leadId),

    /**
     * Turn a converted lead into money owed.
     *
     * The amount is snapshotted here and never recomputed: the rate card is
     * append-only, but even so, what a partner earned in August must not
     * change because we repriced in September.
     *
     * `plan` is what the customer ACTUALLY bought, which is not always what
     * they asked for — the lead's requirementMbps is only the opening ask.
     */
    async recordConversion(lead, plan, at = new Date()) {
      // The unique index on leadId is the real guard; this makes converting
      // an already-converted lead a quiet no-op instead of a 500.
      const existing = await earningRepository.findByLeadId(lead.id)
      if (existing) return existing

      const rate = await rateCardRepository.findRate(plan.speedMbps, plan.billingPeriod, at)
      // A combination we do not sell has no rate. Recording it as ₹0 would
      // look like a paid-out earning worth nothing; refusing says what is
      // actually wrong.
      if (!rate) {
        throw ApiError.badRequest(
          `No rate for ${plan.speedMbps} Mbps ${plan.billingPeriod.toLowerCase().replace('_', '-')}`,
        )
      }

      return earningRepository.create({
        leadId: lead.id,
        partnerId: lead.partnerId,
        // Mirrors the lead's snapshot, so re-assigning a partner later cannot
        // move an earning that has already been made.
        employeeId: lead.employeeId ?? null,
        speedMbps: rate.speedMbps,
        billingPeriod: rate.billingPeriod,
        amount: rate.amount,
        earnedAt: at,
      })
    },

    /**
     * A lead moving back out of Converted.
     *
     * Unpaid, it never should have existed, so it goes. Paid, it is history:
     * partner-network.md §6.2 settles that a paid earning is immutable, and a
     * correction has to be an adjustment somebody signs for, not a silent
     * delete.
     */
    async revokeConversion(leadId) {
      const existing = await earningRepository.findByLeadId(leadId)
      if (!existing) return null
      if (existing.status === 'PAID') {
        throw ApiError.conflict(
          'This lead has already been paid for. Reversing it needs an adjustment, not an edit.',
        )
      }
      await earningRepository.deleteByLeadId(leadId)
      return existing
    },

    /**
     * What the partner sees on the Earnings tab: month by month, newest
     * first, with whether we have settled it.
     */
    async statementFor(partnerId) {
      const rows = await earningRepository.listForPartner(partnerId)

      const byMonth = new Map()
      for (const row of rows) {
        const key = monthKey(row.earnedAt)
        if (!byMonth.has(key)) byMonth.set(key, { month: key, total: 0, count: 0, lines: [] })
        const month = byMonth.get(key)
        month.total += row.amount
        month.count += 1
        month.lines.push({
          id: row.id,
          customerName: row.lead?.customerName ?? null,
          speedMbps: row.speedMbps,
          billingPeriod: row.billingPeriod,
          amount: row.amount,
          status: row.status,
          earnedAt: row.earnedAt,
        })
      }

      const months = [...byMonth.values()]
        .sort((a, b) => b.month.localeCompare(a.month))
        // A month is only paid once every line in it is. Anything else would
        // show "Paid" over a total the partner has not fully received.
        .map((m) => ({
          ...m,
          status: m.lines.every((l) => l.status === 'PAID') ? 'PAID' : 'AWAITING_PAYMENT',
        }))

      return {
        months,
        total: rows.reduce((sum, r) => sum + r.amount, 0),
        outstanding: rows
          .filter((r) => r.status !== 'PAID')
          .reduce((sum, r) => sum + r.amount, 0),
        count: rows.length,
      }
    },
  }
}
