import { prisma } from '../../lib/prisma.js'

export const userRepository = {
  findByEmail: (email) => prisma.user.findUnique({ where: { email } }),
  findById: (id) => prisma.user.findUnique({ where: { id } }),
  create: (data) => prisma.user.create({ data }),
  list: () =>
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { assignedZones: { select: { id: true, name: true } } },
    }),
  assignedZoneIds: (userId) =>
    prisma.zone
      .findMany({ where: { assignedUsers: { some: { id: userId } } }, select: { id: true } })
      .then((rows) => rows.map((row) => row.id)),
  update: (id, data) => prisma.user.update({ where: { id }, data }),
}
