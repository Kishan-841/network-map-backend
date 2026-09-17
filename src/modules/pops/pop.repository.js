import { prisma } from '../../lib/prisma.js'

const withOlts = {
  olts: { orderBy: { name: 'asc' }, include: { _count: { select: { fibers: true } } } },
  _count: { select: { points: true } },
}

export const popRepository = {
  list: () => prisma.pop.findMany({ orderBy: { name: 'asc' }, include: withOlts }),
  findById: (id) => prisma.pop.findUnique({ where: { id }, include: withOlts }),
  findByName: (name) =>
    prisma.pop.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }),
  create: (data, tx = prisma) => tx.pop.create({ data, include: withOlts }),
  update: (id, data, tx = prisma) => tx.pop.update({ where: { id }, data, include: withOlts }),
  delete: (id) => prisma.pop.delete({ where: { id } }),
  createOlt: (data) => prisma.olt.create({ data }),
  findOltById: (id) => prisma.olt.findUnique({ where: { id } }),
  findOltByName: (popId, name) => prisma.olt.findFirst({ where: { popId, name } }),
  updateOlt: (id, data) => prisma.olt.update({ where: { id }, data }),
  deleteOlt: (id) => prisma.olt.delete({ where: { id } }),
  countPointsForPop: (popId) => prisma.fiberPoint.count({ where: { popId } }),
  maxUsedPort: async (oltId) =>
    (await prisma.fiber.aggregate({ where: { oltId }, _max: { ponPort: true } }))._max.ponPort ?? 0,
  countFibersForOlt: (oltId) => prisma.fiber.count({ where: { oltId } }),
}
