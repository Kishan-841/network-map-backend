import { prisma } from '../../lib/prisma.js'

export const systemLogRepository = {
  create: (data) => prisma.systemLog.create({ data }),
  findMany: ({ where, skip, take }) =>
    prisma.systemLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
  count: (where) => prisma.systemLog.count({ where }),
}
