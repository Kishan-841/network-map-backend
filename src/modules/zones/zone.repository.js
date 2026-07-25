import { prisma } from '../../lib/prisma.js'

export const zoneRepository = {
  list: () => prisma.zone.findMany({ orderBy: { name: 'asc' } }),
  findById: (id) => prisma.zone.findUnique({ where: { id } }),
  findByName: (name) => prisma.zone.findUnique({ where: { name } }),
  create: (data) => prisma.zone.create({ data }),
  update: (id, data) => prisma.zone.update({ where: { id }, data }),
  delete: (id) => prisma.zone.delete({ where: { id } }),
  countBuildings: (zoneId) => prisma.building.count({ where: { zoneId } }),
}
