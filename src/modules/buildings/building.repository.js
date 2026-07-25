import { prisma } from '../../lib/prisma.js'

const fullInclude = {
  zone: true,
  details: true,
  permission: true,
  photos: true,
  createdBy: { select: { id: true, name: true } },
}

export const buildingRepository = {
  create: (data) => prisma.building.create({ data, include: fullInclude }),
  list: (where = {}, { skip = 0, take = 100 } = {}) =>
    prisma.building.findMany({
      where,
      include: { zone: true, details: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  count: (where = {}) => prisma.building.count({ where }),
  findById: (id) => prisma.building.findUnique({ where: { id }, include: fullInclude }),
  update: (id, data) => prisma.building.update({ where: { id }, data, include: fullInclude }),
  findWithinBounds: ({ minLat, maxLat, minLon, maxLon }) =>
    prisma.building.findMany({
      where: {
        latitude: { gte: minLat, lte: maxLat },
        longitude: { gte: minLon, lte: maxLon },
      },
      include: { zone: true, details: true },
    }),
  findByPlaceId: (placeId) =>
    prisma.building.findUnique({ where: { placeId }, include: { zone: true, details: true } }),
  createPhoto: (data) => prisma.photo.create({ data }),
  findPhotoById: (id) => prisma.photo.findUnique({ where: { id } }),
  deletePhoto: (id) => prisma.photo.delete({ where: { id } }),
  upsertPermissionDocument: (buildingId, documentUrl) =>
    prisma.permission.upsert({
      where: { buildingId },
      update: { documentUrl },
      create: { buildingId, documentUrl },
    }),
  clearPermissionDocument: (buildingId, url) =>
    prisma.permission.updateMany({
      where: { buildingId, documentUrl: url },
      data: { documentUrl: null },
    }),
}
