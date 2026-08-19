import { prisma } from '../../lib/prisma.js'

const withOperator = { operator: { select: { id: true, name: true } } }

export const fiberRouteRepository = {
  list: () => prisma.fiberRoute.findMany({ orderBy: { name: 'asc' }, include: withOperator }),
  findById: (id) => prisma.fiberRoute.findUnique({ where: { id } }),
  findByName: (name) =>
    prisma.fiberRoute.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }),
  create: (data) => prisma.fiberRoute.create({ data, include: withOperator }),
  update: (id, data) => prisma.fiberRoute.update({ where: { id }, data, include: withOperator }),
  delete: (id) => prisma.fiberRoute.delete({ where: { id } }),
}
