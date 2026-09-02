import { prisma } from '../../lib/prisma.js'

export const leadCallRepository = {
  create: (data) => prisma.leadCall.create({ data }),
  listForLead: (leadId) =>
    prisma.leadCall.findMany({
      where: { leadId },
      orderBy: { endedAt: 'desc' },
      include: { by: { select: { id: true, name: true } } },
    }),
}
