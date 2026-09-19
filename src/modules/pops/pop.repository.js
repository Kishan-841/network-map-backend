import { prisma } from '../../lib/prisma.js'

const withOlts = {
  olts: { orderBy: { name: 'asc' }, include: { _count: { select: { fibers: true } } } },
  devices: { orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] },
  zone: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { points: true } },
}

export const popRepository = {
  list: (where = {}) => prisma.pop.findMany({ where, orderBy: { name: 'asc' }, include: withOlts }),
  findById: (id) => prisma.pop.findUnique({ where: { id }, include: withOlts }),
  /**
   * Everything the detail drawer shows: each OLT with the fibers on its ports,
   * and every fiber that has a point at this POP. Owners come along so the
   * service can drop the cables the reader may not open.
   */
  findDetail: (id) =>
    prisma.pop.findUnique({
      where: { id },
      include: {
        ...withOlts,
        olts: {
          orderBy: { name: 'asc' },
          include: {
            _count: { select: { fibers: true } },
            fibers: {
              orderBy: { ponPort: 'asc' },
              select: { id: true, name: true, ponPort: true, coreCount: true, createdById: true },
            },
          },
        },
      },
    }),
  fibersAtPop: (popId) =>
    prisma.fiber.findMany({
      where: { points: { some: { popId } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, coreCount: true, status: true, createdById: true },
    }),
  findByName: (name) =>
    prisma.pop.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }),
  create: (data, tx = prisma) => tx.pop.create({ data, include: withOlts }),
  update: (id, data, tx = prisma) => tx.pop.update({ where: { id }, data, include: withOlts }),
  delete: (id) => prisma.pop.delete({ where: { id } }),
  createOlt: (data) => prisma.olt.create({ data }),
  // With its POP's owner: an OLT is only as visible as the POP it stands in.
  findOltById: (id) => prisma.olt.findUnique({ where: { id }, include: { pop: { select: { createdById: true } } } }),
  findOltByName: (popId, name) => prisma.olt.findFirst({ where: { popId, name } }),
  updateOlt: (id, data) => prisma.olt.update({ where: { id }, data }),
  deleteOlt: (id) => prisma.olt.delete({ where: { id } }),
  countPointsForPop: (popId) => prisma.fiberPoint.count({ where: { popId } }),
  maxUsedPort: async (oltId) =>
    (await prisma.fiber.aggregate({ where: { oltId }, _max: { ponPort: true } }))._max.ponPort ?? 0,
  countFibersForOlt: (oltId) => prisma.fiber.count({ where: { oltId } }),
  createDevice: (data) => prisma.popDevice.create({ data }),
  findDeviceById: (id) => prisma.popDevice.findUnique({ where: { id } }),
  updateDevice: (id, data) => prisma.popDevice.update({ where: { id }, data }),
  deleteDevice: (id) => prisma.popDevice.delete({ where: { id } }),
}
