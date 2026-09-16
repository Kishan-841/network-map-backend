import { prisma } from '../../lib/prisma.js'
import { deriveSegments } from './fiber-geometry.js'

export const FIBER_INCLUDE = {
  points: { orderBy: { sequence: 'asc' }, include: { pop: { select: { name: true } }, closure: { select: { code: true, kind: true, notes: true, splitters: { select: { id: true, ratio: true, location: true, fiberType: true } } } }, building: { select: { buildingName: true } } } },
  segments: { orderBy: { sequence: 'asc' } },
  olt: { select: { id: true, name: true, pop: { select: { id: true, name: true } } } },
  operator: { select: { id: true, name: true } },
  fedBy: { select: { portNo: true, splitter: { select: { id: true, ratio: true, location: true, fiberType: true, closure: { select: { id: true, code: true } }, inputFiber: { select: { id: true, name: true } } } } } },
}

export const fiberRepository = {
  list: () => prisma.fiber.findMany({ orderBy: { name: 'asc' }, include: FIBER_INCLUDE }),
  findById: (id, tx = prisma) => tx.fiber.findUnique({ where: { id }, include: FIBER_INCLUDE }),
  findByName: (name) => prisma.fiber.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }),
  // findUnique rejects null components in a compound unique key — guard rather than let Prisma throw.
  findUsingPort: (oltId, ponPort) =>
    oltId == null || ponPort == null ? null : prisma.fiber.findUnique({ where: { oltId_ponPort: { oltId, ponPort } } }),
  create: (data, tx = prisma) => tx.fiber.create({ data }),
  update: (id, data, tx = prisma) => tx.fiber.update({ where: { id }, data }),
  delete: (id) => prisma.fiber.delete({ where: { id } }),
  /** Replaces points and segments wholesale. `segments` items reference points by index. */
  async replaceGeometry(fiberId, points, segments, tx) {
    await tx.fiberSegment.deleteMany({ where: { fiberId } })
    await tx.fiberPoint.deleteMany({ where: { fiberId } })
    const created = []
    for (const [sequence, p] of points.entries()) {
      created.push(await tx.fiberPoint.create({ data: { fiberId, sequence, type: p.type, latitude: p.latitude, longitude: p.longitude, popId: p.popId ?? null, closureId: p.closureId ?? null, buildingId: p.buildingId ?? null } }))
    }
    for (const s of segments) {
      await tx.fiberSegment.create({ data: { fiberId, sequence: s.sequence, fromPointId: created[s.fromIndex].id, toPointId: created[s.toIndex].id, mapMeters: s.mapMeters, fiberLaidMeters: s.fiberLaidMeters ?? null, isCut: s.isCut ?? false, cutAt: s.cutAt ?? null, cutNote: s.cutNote ?? null } })
    }
  },
  /**
   * Merge candidates: every fiber's first and last point that is still a
   * WAYPOINT. One query loads all the points; picking the two ends in JS beats
   * a per-fiber min/max round trip at this table size.
   */
  async listEndpointWaypoints() {
    const fibers = await prisma.fiber.findMany({
      select: {
        id: true,
        name: true,
        points: { orderBy: { sequence: 'asc' }, select: { id: true, type: true, latitude: true, longitude: true } },
      },
    })
    const out = []
    for (const fiber of fibers) {
      if (!fiber.points.length) continue
      const ends = fiber.points.length === 1 ? [fiber.points[0]] : [fiber.points[0], fiber.points.at(-1)]
      for (const p of ends) {
        if (p.type !== 'WAYPOINT') continue
        out.push({ pointId: p.id, fiberId: fiber.id, fiberName: fiber.name, latitude: p.latitude, longitude: p.longitude })
      }
    }
    return out
  },
  /** Raw rows for the ids a merge selected — no includes, the service only needs type + position. */
  findPointsByIds: (ids) =>
    prisma.fiberPoint.findMany({
      where: { id: { in: ids } },
      select: { id: true, fiberId: true, sequence: true, type: true, latitude: true, longitude: true },
    }),
  findSegment: (fiberId, segmentId) => prisma.fiberSegment.findFirst({ where: { id: segmentId, fiberId } }),
  updateSegment: (id, data) => prisma.fiberSegment.update({ where: { id }, data }),
  cutSegment: (fiberId, segmentId, note) => prisma.$transaction([
    prisma.fiberSegment.update({ where: { id: segmentId }, data: { isCut: true, cutAt: new Date(), cutNote: note ?? null } }),
    prisma.fiber.update({ where: { id: fiberId }, data: { status: 'CUT' } }),
  ]),
  restoreAll: (fiberId) => prisma.$transaction([
    prisma.fiberSegment.updateMany({ where: { fiberId }, data: { isCut: false, cutAt: null, cutNote: null } }),
    prisma.fiber.update({ where: { id: fiberId }, data: { status: 'LIVE' } }),
  ]),
  splittersFedBy: (fiberId) => prisma.splitter.findMany({ where: { inputFiberId: fiberId }, include: { closure: { select: { id: true, code: true } }, outputs: { orderBy: { portNo: 'asc' }, include: { toFiber: { select: { id: true, name: true, status: true } }, toBuilding: { select: { id: true, buildingName: true } } } } } }),
  /** The SplitterOutput (with its splitter/closure/inputFiber) that feeds this fiber, or null. */
  fedBy: (fiberId) => prisma.fiber.findUnique({ where: { id: fiberId }, select: { fedBy: FIBER_INCLUDE.fedBy } }).then((r) => r?.fedBy ?? null),
}

export const fiberPointRepository = {
  updatePositionForPop: (popId, pos) =>
    prisma.fiberPoint.updateMany({ where: { popId }, data: pos }).then((r) => r.count),
  updatePositionForClosure: (closureId, pos) =>
    prisma.fiberPoint.updateMany({ where: { closureId }, data: pos }).then((r) => r.count),
  /** After an entity moved: recompute mapMeters of every segment on every fiber that touches it. */
  async recomputeSegmentsTouching(where) {
    const fiberIds = [...new Set((await prisma.fiberPoint.findMany({ where, select: { fiberId: true } })).map((p) => p.fiberId))]
    for (const fiberId of fiberIds) {
      const points = await prisma.fiberPoint.findMany({ where: { fiberId }, orderBy: { sequence: 'asc' } })
      for (const s of deriveSegments(points)) {
        await prisma.fiberSegment.updateMany({ where: { fiberId, sequence: s.sequence }, data: { mapMeters: s.mapMeters } })
      }
    }
  },
}
