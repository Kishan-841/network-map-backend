import { prisma } from '../src/lib/prisma.js'

/**
 * The rate card as supplied 2026-08-31. Rupees PER CUSTOMER — see the note in
 * partner-network.md §3.2 about the table-versus-example conflict.
 */
const RATES = [
  [100, 'QUARTERLY', 375], [100, 'HALF_YEARLY', 750], [100, 'YEARLY', 1200],
  [200, 'QUARTERLY', 450], [200, 'HALF_YEARLY', 900], [200, 'YEARLY', 1500],
  [300, 'QUARTERLY', 525], [300, 'HALF_YEARLY', 1050], [300, 'YEARLY', 1800],
  [400, 'QUARTERLY', 600], [400, 'HALF_YEARLY', 1200], [400, 'YEARLY', 2100],
]

const effectiveFrom = new Date('2026-01-01T00:00:00.000Z')

for (const [speedMbps, billingPeriod, amount] of RATES) {
  await prisma.rateCard.upsert({
    where: { speedMbps_billingPeriod_effectiveFrom: { speedMbps, billingPeriod, effectiveFrom } },
    update: { amount },
    create: { speedMbps, billingPeriod, amount, effectiveFrom },
  })
}
console.log(`seeded ${RATES.length} rates`)
await prisma.$disconnect()
