import { prisma } from '../../lib/prisma.js'
import { withPartnerTotals } from './partner-totals.js'

const publicSelect = {
  id: true, name: true, type: true, companyName: true, mobile: true, email: true,
  status: true, onboardedAt: true, approvedAt: true, rejectionReason: true,
  onboardedBy: { select: { id: true, name: true } },
}

export const partnerRepository = {
  findById: (id) => prisma.partner.findUnique({ where: { id } }),
  listDocuments: (partnerId) =>
    prisma.partner.findUnique({ where: { id: partnerId } }).documents(),
  upsertDocument: ({ partnerId, type, url }) =>
    prisma.partnerDocument.upsert({
      where: { partnerId_type: { partnerId, type } },
      update: { url, uploadedAt: new Date() },
      create: { partnerId, type, url },
    }),
  update: (id, data) => prisma.partner.update({ where: { id }, data }),
  list: (where = {}) =>
    prisma.partner.findMany({ where, orderBy: { createdAt: 'desc' }, select: publicSelect }),

  /**
   * The roster with each partner's figures. Two queries, not one per row:
   * the counts ride along free, and the money is one grouped aggregate.
   */
  async listWithTotals(where = {}) {
    const partners = await prisma.partner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { ...publicSelect, _count: { select: { leads: true, earnings: true } } },
    })
    if (!partners.length) return []
    const sums = await prisma.partnerEarning.groupBy({
      by: ['partnerId'],
      where: { partnerId: { in: partners.map((p) => p.id) } },
      _sum: { amount: true },
    })
    return withPartnerTotals(partners, sums)
  },
  count: (where = {}) => prisma.partner.count({ where }),
}
