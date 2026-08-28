import { prisma } from '../../lib/prisma.js'

const publicSelect = {
  id: true, name: true, type: true, companyName: true, mobile: true, email: true,
  status: true, hasGst: true, onboardedAt: true, approvedAt: true, rejectionReason: true,
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
  count: (where = {}) => prisma.partner.count({ where }),
}
