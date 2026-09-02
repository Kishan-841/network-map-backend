import { ApiError } from '../../lib/api-error.js'

/** A calendar month, as the statement groups them. */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export function createPayoutService({ earningRepository }) {
  return {
    /**
     * What is owed, one row per partner per month.
     *
     * A payout is per month, not per lead — you pay someone once for August,
     * not eleven times — so the money is grouped the way it is actually paid.
     */
    async outstanding() {
      const rows = await earningRepository.owedByPartnerMonth()
      // Newest month first, then by name — so the list is stable between
      // loads and the oldest debt sinks to the bottom where it is obvious.
      const owed = [...rows].sort(
        (a, b) =>
          b.month.localeCompare(a.month) || (a.partnerName ?? '').localeCompare(b.partnerName ?? ''),
      )
      return {
        owed,
        total: owed.reduce((sum, row) => sum + row.amount, 0),
      }
    },

    /** Payments already recorded, newest first, for checking against a bank. */
    settled: () => earningRepository.paidByPartnerMonth(),

    /**
     * Record that a partner has been paid for a month.
     *
     * Settles every earning in that group that is still awaiting payment, and
     * ONLY those: an earning already marked paid is never touched again
     * (partner-network.md §6.2), so pressing this twice cannot rewrite who
     * recorded the first payment or when.
     *
     * If a customer converts in that month AFTER it was settled, a new
     * earning appears and the row comes back with just the new amount. That
     * is correct — it is genuinely a further payment owed, not a mistake.
     */
    async markPaid({ partnerId, month }, actor) {
      if (!partnerId) throw ApiError.badRequest('Which partner?')
      if (!MONTH.test(month ?? '')) throw ApiError.badRequest('Not a valid month')

      const { count } = await earningRepository.markMonthPaid({
        partnerId,
        month,
        byUserId: actor?.id ?? null,
      })
      // Zero is not an error — someone else may have settled it a second
      // earlier — but it must not be reported as a payment that happened.
      return { count, alreadySettled: count === 0 }
    },
  }
}
