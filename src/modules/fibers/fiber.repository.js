import { prisma } from '../../lib/prisma.js'

export const fiberPointRepository = {
  updatePositionForPop: (popId, pos) =>
    prisma.fiberPoint.updateMany({ where: { popId }, data: pos }).then((r) => r.count),
  updatePositionForClosure: (closureId, pos) =>
    prisma.fiberPoint.updateMany({ where: { closureId }, data: pos }).then((r) => r.count),
  recomputeSegmentsTouching: async () => 0, // replaced in Task A5
}
