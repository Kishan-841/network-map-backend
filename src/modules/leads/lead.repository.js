import { prisma } from '../../lib/prisma.js'

const partnerView = {
  id: true, customerName: true, customerMobile: true, customerEmail: true,
  address: true, status: true, note: true, createdAt: true,
  building: { select: { id: true, buildingName: true } },
}

export const leadRepository = {
  create: (data) => prisma.lead.create({ data }),
  /** An open claim on this customer — a closed-out lead does not block a retry. */
  findOpenByMobile: (customerMobile) =>
    prisma.lead.findFirst({
      where: {
        customerMobile,
        status: { notIn: ['NOT_INTERESTED', 'UNREACHABLE', 'DUPLICATE'] },
      },
      orderBy: { createdAt: 'asc' },
    }),
  listByPartner: (partnerId) =>
    prisma.lead.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'desc' },
      select: partnerView,
    }),
  /** Just the dates — the earnings statement counts leads per month. */
  listCreatedAtForPartner: (partnerId) =>
    prisma.lead.findMany({ where: { partnerId }, select: { createdAt: true } }),
  findById: (id) => prisma.lead.findUnique({ where: { id } }),
  update: (id, data) => prisma.lead.update({ where: { id }, data }),
  recordEvent: (data) => prisma.leadStatusEvent.create({ data }),
  /** Staff view — richer, and scoped by the caller's role in the route. */
  listForStaff: (where = {}) =>
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        partner: { select: { id: true, name: true, type: true } },
        employee: { select: { id: true, name: true } },
        building: { select: { id: true, buildingName: true } },
        // So a converted lead with no earning behind it is visible as such,
        // rather than looking identical to one that paid out.
        earning: { select: { amount: true, status: true } },
      },
    }),
}

export const demandRepository = {
  record: (data) => prisma.coverageRequest.create({ data }),
}
