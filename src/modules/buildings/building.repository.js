import { prisma } from '../../lib/prisma.js'

const fullInclude = {
  contact: true,
  city: { select: { id: true, name: true } },
  zone: true,
  details: true,
  permission: true,
  photos: true,
  createdBy: { select: { id: true, name: true } },
  // The OLT + PON that serve this building (Zone → Operator → OLT → PON).
  olt: {
    select: {
      id: true,
      name: true,
      ponPortCount: true,
      pop: { select: { id: true, name: true, zone: { select: { id: true, name: true } } } },
    },
  },
}

// List rows only need the zone's NAME — `zone: true` would ship the zone's
// boundary polygon with every building (duplicated per building, huge at
// pageSize 500 for the map).
const listInclude = {
  zone: { select: { id: true, name: true } },
  city: { select: { id: true, name: true } },
  details: true,
  contact: true,
  // Who logged it — the acquisition list shows this as the "Agent" column.
  createdBy: { select: { id: true, name: true } },
}

/**
 * Exactly the fields the spreadsheet writes, and nothing else.
 *
 * Separate from `listInclude` on purpose: that one carries contact, city,
 * photos and createdBy for the screen, and the operator join added there
 * would ride along on every map request too.
 */
const exportSelect = {
  buildingName: true,
  formattedAddress: true,
  pincode: true,
  details: { select: { homePass: true } },
  zone: { select: { name: true, operator: { select: { name: true } } } },
}

/**
 * The map's payload: enough to place a pin, colour it, and fill the selected
 * building card — and nothing else. No photos, contacts or permission rows,
 * because the map draws every building the actor can see in one response and
 * anything extra is multiplied by the whole registry.
 */
const markerSelect = {
  id: true,
  buildingName: true,
  formattedAddress: true,
  latitude: true,
  longitude: true,
  isLive: true,
  feasibleStatus: true,
  source: true,
  createdById: true,
  createdAt: true,
  zone: { select: { id: true, name: true, operatorId: true } },
  cityId: true,
  pincode: true,
  details: { select: { homePass: true, floors: true, wings: true } },
  // The acquisition map's card shows the city and the contact person.
  city: { select: { id: true, name: true } },
  contact: {
    select: {
      contactName: true,
      contactPhone: true,
      contactEmail: true,
      designation: true,
      designationOther: true,
    },
  },
}

export const buildingRepository = {
  /** One row per Place per zone — the clash the create path refuses. */
  findByPlaceIdInZone: (placeId, zoneId) =>
    prisma.building.findFirst({ where: { placeId, zoneId }, select: { id: true } }),
  create: (data) => prisma.building.create({ data, include: fullInclude }),
  listForExport: (where = {}, { take = 1000 } = {}) =>
    prisma.building.findMany({
      where,
      select: exportSelect,
      orderBy: { buildingName: 'asc' },
      take,
    }),
  list: (where = {}, { skip = 0, take = 100 } = {}) =>
    prisma.building.findMany({
      where,
      include: listInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  // Just id + zone, for the bulk OLT map's same-zone check.
  findManyScoped: (where) => prisma.building.findMany({ where, select: { id: true, zoneId: true } }),
  // An OLT with its POP's zone and its port count — for the bulk OLT map.
  findOltWithZone: (id) =>
    prisma.olt.findUnique({
      where: { id },
      select: { id: true, name: true, ponPortCount: true, pop: { select: { zoneId: true } } },
    }),
  /**
   * Every matching building, lean. Deliberately unpaginated: the map is not a
   * page of results, it is the whole picture — a `take` here is exactly the
   * bug that capped it at 500.
   */
  listMarkers: (where = {}) =>
    prisma.building.findMany({
      where,
      select: markerSelect,
      orderBy: { buildingName: 'asc' },
    }),
  count: (where = {}) => prisma.building.count({ where }),
  updateMany: (where, data) => prisma.building.updateMany({ where, data }),
  findById: (id) => prisma.building.findUnique({ where: { id }, include: fullInclude }),
  update: (id, data) => prisma.building.update({ where: { id }, data, include: fullInclude }),
  delete: (id) => prisma.building.delete({ where: { id } }),
  /**
   * Fiber names still touching this building via a FiberPoint — the delete
   * guard's evidence. Deduplicated + sorted so the 409 message is stable
   * regardless of point order.
   */
  fiberNamesAttachedTo: async (buildingId) => {
    const refs = await prisma.fiberPoint.findMany({
      where: { buildingId },
      select: { fiber: { select: { name: true } } },
    })
    return [...new Set(refs.map((r) => r.fiber.name))].sort()
  },
  // Capped so a large/degenerate box can't pull the whole table into memory.
  // The nearby check only needs enough candidates to flag a duplicate.
  findWithinBounds: ({ minLat, maxLat, minLon, maxLon }) =>
    prisma.building.findMany({
      where: {
        latitude: { gte: minLat, lte: maxLat },
        longitude: { gte: minLon, lte: maxLon },
      },
      include: listInclude,
      take: 200,
    }),
  findByNameInZone: (buildingName, zoneId) =>
    prisma.building.findFirst({
      where: { zoneId, buildingName: { equals: buildingName, mode: 'insensitive' } },
    }),
  findByPlaceId: (placeId) =>
    prisma.building.findUnique({ where: { placeId }, include: listInclude }),
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
