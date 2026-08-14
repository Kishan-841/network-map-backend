import { prisma } from '../../lib/prisma.js'

const withOperatorCount = { _count: { select: { operators: true } } }
const shape = (city) =>
  city && { ...city, operatorCount: city._count?.operators ?? 0, _count: undefined }

export const cityRepository = {
  list: () =>
    prisma.city
      .findMany({ orderBy: { name: 'asc' }, include: withOperatorCount })
      .then((rows) => rows.map(shape)),
  findById: (id) => prisma.city.findUnique({ where: { id } }),
  findByName: (name) =>
    prisma.city.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }),
  create: (data) => prisma.city.create({ data }).then((city) => ({ ...city, operatorCount: 0 })),
  update: (id, data) => prisma.city.update({ where: { id }, data }),
  delete: (id) => prisma.city.delete({ where: { id } }),
}
