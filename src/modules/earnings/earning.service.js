import { ApiError } from '../../lib/api-error.js'

/** The month a date belongs to, as the statement groups it. */
const monthKey = (date) => {
  const d = new Date(date)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function createEarningService({ earningRepository, rateCardRepository, leadRepository }) {
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
    /**
     * What the partner sees on the Earnings tab: month by month, newest
     * first, with whether we have settled it.
     *
     * Two clocks meet here. A customer is ADDED when the partner sends them
     * in and ACTIVATED when they sign up, which is often a different month —
     * so a month can have leads and no earnings, and must still appear.
     * Dropping it would make the table claim the partner did nothing.
     */
    async statementFor(partnerId) {
      const [rows, leads] = await Promise.all([
        earningRepository.listForPartner(partnerId),
        leadRepository?.listCreatedAtForPartner(partnerId) ?? [],
      ])

      const byMonth = new Map()
      const slot = (key) => {
        if (!byMonth.has(key)) {
          byMonth.set(key, {
            month: key, added: 0, activated: 0, total: 0, count: 0, lines: [],
          })
        }
        return byMonth.get(key)
      }

      for (const lead of leads) slot(monthKey(lead.createdAt)).added += 1

      for (const row of rows) {
        const month = slot(monthKey(row.earnedAt))
        month.total += row.amount
        month.count += 1
        month.activated += 1
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
        .map((m) => ({
          ...m,
          // A month is only paid once every line in it is. Anything else
          // would show "Paid" over a total not fully received. A month with
          // no earnings at all is not "paid" — it is simply awaiting.
          status:
            m.lines.length && m.lines.every((l) => l.status === 'PAID')
              ? 'PAID'
              : 'AWAITING_PAYMENT',
          paid: m.lines.filter((l) => l.status === 'PAID').reduce((s, l) => s + l.amount, 0),
          outstanding: m.lines
            .filter((l) => l.status !== 'PAID')
            .reduce((s, l) => s + l.amount, 0),
        }))

      const sum = (list) => list.reduce((total, r) => total + r.amount, 0)
      return {
        months,
        added: leads.length,
        // One earning per converted lead, so this counts customers who
        // actually signed up.
        activated: rows.length,
        total: sum(rows),
        paid: sum(rows.filter((r) => r.status === 'PAID')),
        outstanding: sum(rows.filter((r) => r.status !== 'PAID')),
        count: rows.length,
      }
    },
  }
}
