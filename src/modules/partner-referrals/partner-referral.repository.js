import { prisma } from '../../lib/prisma.js'
import { OPEN_REFERRAL_STATUSES } from './partner-referral.service.js'

/** What the referring partner is allowed to see back — never our workings. */
const partnerView = {
  id: true, name: true, type: true, mobile: true, status: true, createdAt: true,
}

export const partnerReferralRepository = {
  create: (data) => prisma.partnerReferral.create({ data }),

  /** A live introduction of this person, by anyone. Declined ones do not block. */
  findOpenByMobile: (mobile) =>
    prisma.partnerReferral.findFirst({
      where: { mobile, status: { in: OPEN_REFERRAL_STATUSES } },
      orderBy: { createdAt: 'asc' },
    }),

  listForPartner: (referredById) =>
    prisma.partnerReferral.findMany({
      where: { referredById },
      orderBy: { createdAt: 'desc' },
      select: partnerView,
    }),

  listForStaff: (where = {}) =>
    prisma.partnerReferral.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        referredBy: { select: { id: true, name: true, type: true } },
        employee: { select: { id: true, name: true } },
        joinedPartner: { select: { id: true, name: true, status: true } },
        // Newest first, so the client reads [0] as the current link. The raw
        // token is never stored, so nothing secret travels here.
        invites: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, expiresAt: true, usedAt: true, revokedAt: true, createdAt: true },
        },
      },
    }),

  findById: (id) =>
    prisma.partnerReferral.findUnique({
      where: { id },
      // inviteFor needs to see a live link before raising another.
      include: { invites: { orderBy: { createdAt: 'desc' } } },
    }),
  update: (id, data) => prisma.partnerReferral.update({ where: { id }, data }),
}
