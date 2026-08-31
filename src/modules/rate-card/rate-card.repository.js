import { prisma } from '../../lib/prisma.js'

export const rateCardRepository = {
  /**
   * The rates in force today. Rows are never edited — a price change is a new
   * row with a later effectiveFrom, so a quote given last month can still be
   * explained.
   */
  async current(at = new Date()) {
    const rows = await prisma.rateCard.findMany({
      where: { effectiveFrom: { lte: at } },
      orderBy: [{ speedMbps: 'asc' }, { effectiveFrom: 'desc' }],
    })
    const newest = new Map()
    for (const row of rows) {
      const key = `${row.speedMbps}|${row.billingPeriod}`
      if (!newest.has(key)) newest.set(key, row)
    }
    return [...newest.values()].map(({ speedMbps, billingPeriod, amount }) => ({
      speedMbps,
      billingPeriod,
      amount,
    }))
  },
}
