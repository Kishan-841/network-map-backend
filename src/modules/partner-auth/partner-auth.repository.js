import { prisma } from '../../lib/prisma.js'

export const partnerAuthRepository = {
  findByMobile: (mobile) => prisma.partner.findUnique({ where: { mobile } }),
  findById: (id) => prisma.partner.findUnique({ where: { id } }),
  findByEmail: (email) => prisma.partner.findUnique({ where: { email } }),
  create: (data) => prisma.partner.create({ data }),
  update: (id, data) => prisma.partner.update({ where: { id }, data }),
}

export const otpRepository = {
  create: (data) => prisma.otpChallenge.create({ data }),
  /** The newest code that is still alive and unused. */
  findActive: (identifier) =>
    prisma.otpChallenge.findFirst({
      where: { identifier, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }),
  lastIssuedAt: (identifier) =>
    prisma.otpChallenge
      .findFirst({ where: { identifier }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
      .then((row) => row?.createdAt ?? null),
  consume: (id) => prisma.otpChallenge.update({ where: { id }, data: { consumedAt: new Date() } }),
  bumpAttempts: (id) =>
    prisma.otpChallenge.update({ where: { id }, data: { attempts: { increment: 1 } } }),
}
