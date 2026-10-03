import { prisma } from '../../lib/prisma.js'

export const inviteRepository = {
  create: (data) => prisma.partnerInvite.create({ data }),
  findByTokenHash: (tokenHash) => prisma.partnerInvite.findUnique({ where: { tokenHash } }),
  findById: (id) =>
    prisma.partnerInvite.findUnique({
      where: { id },
      // The join page greets the partner by their recruiter's name.
      include: { employee: { select: { id: true, name: true } } },
    }),
  markUsed: (id, partnerId) =>
    prisma.partnerInvite.update({
      where: { id },
      data: { usedAt: new Date(), usedById: partnerId },
    }),
  revoke: (id) => prisma.partnerInvite.update({ where: { id }, data: { revokedAt: new Date() } }),
  listForEmployee: (employeeId) =>
    prisma.partnerInvite.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      include: { usedBy: { select: { id: true, name: true, status: true } } },
    }),
  listAll: () =>
    prisma.partnerInvite.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        usedBy: { select: { id: true, name: true, status: true } },
        employee: { select: { id: true, name: true } },
      },
    }),
}
