import { ApiError } from '../../lib/api-error.js'

/** A calendar month, as the statement groups them. */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'UPI', 'CASH', 'CHEQUE', 'OTHER']

/**
 * Cash is the only route with nothing to quote back. Everything else leaves a
 * UTR, a transaction id or a cheque number, and a payment that cannot be
 * checked against a statement is a claim rather than a record.
 */
const NEEDS_REFERENCE = ['BANK_TRANSFER', 'UPI', 'CHEQUE']

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

    /** Payments as entered, newest first — what other users read. */
    settled: () => earningRepository.listPayments(),

    /**
     * Record a payment against one partner-month.
     *
     * The entry is the point: how much moved, by what route, and the
     * reference the partner can check. Settling the earnings is a consequence
     * of it, not the other way round.
     *
     * `amountOwed` is read from the server, never from the form — a screen
     * left open while another earning converts would otherwise record a total
     * that was never true.
     */
    async markPaid(entry, actor) {
      const { partnerId, month, method, reference, note, amountPaid, paidOn } = entry ?? {}

      if (!partnerId) throw ApiError.badRequest('Which partner?')
      if (!MONTH.test(month ?? '')) throw ApiError.badRequest('Not a valid month')
      if (!PAYMENT_METHODS.includes(method)) throw ApiError.badRequest('Pick how it was paid')

      const amount = Number(amountPaid)
      if (!Number.isFinite(amount) || amount <= 0) {
        throw ApiError.badRequest('Enter the amount that was paid')
      }
      const ref = reference?.trim() || null
      if (!ref && NEEDS_REFERENCE.includes(method)) {
        throw ApiError.badRequest('Enter the transaction or cheque reference')
      }

      // What the server says is owed right now — and proof there is anything
      // left to settle, which also guards two people paying the same month.
      const owed = (await earningRepository.owedByPartnerMonth()).find(
        (row) => row.partnerId === partnerId && row.month === month,
      )
      if (!owed) {
        throw ApiError.conflict('Nothing is owed for that month any more — reload the list')
      }

      const when = paidOn ? new Date(paidOn) : new Date()
      if (Number.isNaN(when.getTime())) throw ApiError.badRequest('Not a valid payment date')

      const { payment, count } = await earningRepository.recordPayment({
        payment: {
          partnerId,
          month,
          amountOwed: owed.amount,
          amountPaid: amount,
          method,
          reference: ref,
          note: note?.trim() || null,
          paidOn: when,
          recordedById: actor?.id ?? null,
        },
      })

      return { payment, count, shortfall: owed.amount - amount }
    },
  }
}
