import { prisma } from '../../lib/prisma.js'

// Operator name travels with every zone read so the UI can label + narrow.
const withOperator = { operator: { select: { id: true, name: true } } }

export const zoneRepository = {
  list: () => prisma.zone.findMany({ orderBy: { name: 'asc' }, include: withOperator }),
  listAll: () => prisma.zone.findMany(),
  listAssigned: (userId) =>
    prisma.zone.findMany({
      where: { assignedUsers: { some: { id: userId } } },
      orderBy: { name: 'asc' },
      include: withOperator,
    }),
  findById: (id) => prisma.zone.findUnique({ where: { id } }),
  findByName: (name) => prisma.zone.findUnique({ where: { name } }),
  create: (data) => prisma.zone.create({ data }),
  update: (id, data) => prisma.zone.update({ where: { id }, data }),
  delete: (id) => prisma.zone.delete({ where: { id } }),
  clearOperator: (operatorId) =>
    prisma.zone.updateMany({ where: { operatorId }, data: { operatorId: null } }),
  countBuildings: (zoneId) => prisma.building.count({ where: { zoneId } }),
  countByIds: (ids) => prisma.zone.count({ where: { id: { in: ids } } }),
  paged: ({ where, skip, take }) =>
    prisma.zone.findMany({ where, orderBy: { name: 'asc' }, skip, take, include: withOperator }),
  count: (where) => prisma.zone.count({ where }),
}
