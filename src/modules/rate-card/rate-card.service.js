import { ApiError } from '../../lib/api-error.js'

/** The order they appear across the top of the calculator. */
export const BILLING_PERIODS = ['QUARTERLY', 'HALF_YEARLY', 'YEARLY']

/**
 * What a set of grid cells is worth.
 *
 * The rate is PER CUSTOMER — what the partner earns for one connection at
 * that speed and billing period. partner-network.md §3.2 records the conflict
 * this resolves: the table says ₹750 for 100 Mbps half-yearly and reads as a
 * clean ₹125/month scale, while the spoken example implied ₹750 was the total
 * for three. The table wins; flipping it is a one-line change here.
 */
export function quoteFor(rates, cells) {
  let total = 0
  for (const cell of cells ?? []) {
    const n = Number(cell.customers ?? 0)
    if (!Number.isInteger(n) || n < 0) {
      throw ApiError.badRequest('Enter a whole number of customers')
    }
    const rate = rates.find(
      (r) => r.speedMbps === cell.speedMbps && r.billingPeriod === cell.billingPeriod,
    )
    // No rate means we do not sell that combination — counting it as free
    // would quietly under-quote rather than simply not offering it.
    if (!rate) continue
    total += rate.amount * n
  }
  return total
}

export function createRateCardService({ rateCardRepository }) {
  return {
    async getCurrent() {
      const rates = await rateCardRepository.current()
      // The axes come from the data, so adding a 500 Mbps plan is a row in a
      // table rather than an edit to the grid.
      const speeds = [...new Set(rates.map((r) => r.speedMbps))].sort((a, b) => a - b)
      const periods = BILLING_PERIODS.filter((p) => rates.some((r) => r.billingPeriod === p))
      return { rates, speeds, periods }
    },
  }
}
