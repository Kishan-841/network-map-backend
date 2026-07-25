import { prisma } from '../../lib/prisma.js'

export const buildingTypeRepository = {
  list: () => prisma.buildingType.findMany({ orderBy: { name: 'asc' } }),
  findById: (id) => prisma.buildingType.findUnique({ where: { id } }),
  findByName: (name) => prisma.buildingType.findUnique({ where: { name } }),
  create: (data) => prisma.buildingType.create({ data }),
  update: (id, data) => prisma.buildingType.update({ where: { id }, data }),
  delete: (id) => prisma.buildingType.delete({ where: { id } }),
}
