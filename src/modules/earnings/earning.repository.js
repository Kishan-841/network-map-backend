import { prisma } from '../../lib/prisma.js'

export const earningRepository = {
  findByLeadId: (leadId) => prisma.partnerEarning.findUnique({ where: { leadId } }),
  create: (data) => prisma.partnerEarning.create({ data }),
  deleteByLeadId: (leadId) => prisma.partnerEarning.deleteMany({ where: { leadId } }),

  /** Everything a partner has earned, newest first; the service groups it. */
  listForPartner: (partnerId) =>
    prisma.partnerEarning.findMany({
      where: { partnerId },
      orderBy: { earnedAt: 'desc' },
      include: { lead: { select: { customerName: true } } },
    }),
}
