import { prisma } from '../../lib/prisma.js'

export const fiberRouteRepository = {
  list: () => prisma.fiberRoute.findMany({ orderBy: { name: 'asc' } }),
  findById: (id) => prisma.fiberRoute.findUnique({ where: { id } }),
  findByName: (name) =>
    prisma.fiberRoute.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }),
  create: (data) => prisma.fiberRoute.create({ data }),
  update: (id, data) => prisma.fiberRoute.update({ where: { id }, data }),
  delete: (id) => prisma.fiberRoute.delete({ where: { id } }),
}
