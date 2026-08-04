import { prisma } from '../../lib/prisma.js'

export const zoneRepository = {
  list: () => prisma.zone.findMany({ orderBy: { name: 'asc' } }),
  listAssigned: (userId) =>
    prisma.zone.findMany({
      where: { assignedUsers: { some: { id: userId } } },
      orderBy: { name: 'asc' },
    }),
  findById: (id) => prisma.zone.findUnique({ where: { id } }),
  findByName: (name) => prisma.zone.findUnique({ where: { name } }),
  create: (data) => prisma.zone.create({ data }),
  update: (id, data) => prisma.zone.update({ where: { id }, data }),
  delete: (id) => prisma.zone.delete({ where: { id } }),
  countBuildings: (zoneId) => prisma.building.count({ where: { zoneId } }),
  countByIds: (ids) => prisma.zone.count({ where: { id: { in: ids } } }),
  paged: ({ where, skip, take }) =>
    prisma.zone.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
  count: (where) => prisma.zone.count({ where }),
}
