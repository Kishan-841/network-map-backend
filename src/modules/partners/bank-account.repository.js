import { prisma } from '../../lib/prisma.js'

const include = { updatedBy: { select: { id: true, name: true } } }

export const bankAccountRepository = {
  findByPartnerId: (partnerId) => prisma.partnerBankAccount.findUnique({ where: { partnerId }, include }),
  upsert: (partnerId, data) =>
    prisma.partnerBankAccount.upsert({ where: { partnerId }, update: data, create: { partnerId, ...data }, include }),
  findManyByPartnerIds: (ids) => prisma.partnerBankAccount.findMany({ where: { partnerId: { in: ids } } }),
}
