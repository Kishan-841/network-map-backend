import { prisma } from '../../lib/prisma.js'

export const rateCardRepository = {
  /**
   * The rates in force today. Rows are never edited — a price change is a new
   * row with a later effectiveFrom, so a quote given last month can still be
   * explained.
   */
  /**
   * The one rate in force for a speed and period, WITH its amount — what an
   * earning is snapshotted from. Separate from current() because that one
   * strips ids and shapes the grid; this one answers "what is this worth".
   */
  async findRate(speedMbps, billingPeriod, at = new Date()) {
    return prisma.rateCard.findFirst({
      where: { speedMbps, billingPeriod, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    })
  },

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
