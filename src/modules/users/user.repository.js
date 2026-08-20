import { prisma } from '../../lib/prisma.js'

export const userRepository = {
  findByEmail: (email) => prisma.user.findUnique({ where: { email } }),
  findByEmailInsensitive: (email) =>
    prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }),
  findById: (id) => prisma.user.findUnique({ where: { id } }),
  create: (data) =>
    prisma.user.create({
      data,
      include: {
        assignedZones: { select: { id: true, name: true } },
        pincodes: { select: { pincode: true, cityId: true, city: { select: { name: true } } } },
      },
    }),
  list: () =>
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        assignedZones: { select: { id: true, name: true } },
        pincodes: { select: { pincode: true, cityId: true, city: { select: { name: true } } } },
      },
    }),
  paged: ({ where, skip, take }) =>
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        assignedZones: { select: { id: true, name: true } },
        pincodes: { select: { pincode: true, cityId: true, city: { select: { name: true } } } },
      },
    }),
  count: (where) => prisma.user.count({ where }),
  /// Acquisition agent's covered pincodes + city (empty for other roles).
  assignedPincodes: (userId) =>
    prisma.userPincode.findMany({
      where: { userId },
      select: { pincode: true, cityId: true },
    }),
  assignedZoneIds: (userId) =>
    prisma.zone
      .findMany({ where: { assignedUsers: { some: { id: userId } } }, select: { id: true } })
      .then((rows) => rows.map((row) => row.id)),
  update: (id, data) =>
    prisma.user.update({
      where: { id },
      data,
      include: {
        assignedZones: { select: { id: true, name: true } },
        pincodes: { select: { pincode: true, cityId: true, city: { select: { name: true } } } },
      },
    }),
}
