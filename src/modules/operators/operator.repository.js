import { prisma } from '../../lib/prisma.js'

const withZoneCount = {
  _count: { select: { zones: true } },
  city: { select: { id: true, name: true } },
}
const shape = (operator) =>
  operator && { ...operator, zoneCount: operator._count?.zones ?? 0, _count: undefined }

export const operatorRepository = {
  list: () =>
    prisma.operator
      .findMany({ orderBy: { name: 'asc' }, include: withZoneCount })
      .then((rows) => rows.map(shape)),
  paged: ({ where, skip, take }) =>
    prisma.operator
      .findMany({ where, orderBy: { name: 'asc' }, skip, take, include: withZoneCount })
      .then((rows) => rows.map(shape)),
  count: (where) => prisma.operator.count({ where }),
  findById: (id) => prisma.operator.findUnique({ where: { id } }),
  findByName: (name) => prisma.operator.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }),
  create: (data) =>
    prisma.operator
      .create({ data, include: { city: { select: { id: true, name: true } } } })
      .then((op) => ({ ...op, zoneCount: 0 })),
  update: (id, data) =>
    prisma.operator.update({
      where: { id },
      data,
      include: { city: { select: { id: true, name: true } } },
    }),
  delete: (id) => prisma.operator.delete({ where: { id } }),
  listAll: () => prisma.operator.findMany(),
}
