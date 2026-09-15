import { prisma } from '../../lib/prisma.js'

const outputsWithTargets = {
  orderBy: { portNo: 'asc' },
  include: {
    toFiber: { select: { id: true, name: true, status: true } },
    toBuilding: { select: { id: true, buildingName: true } },
  },
}

const withDetail = {
  splitters: { include: { outputs: outputsWithTargets } },
  building: true,
  _count: { select: { points: true } },
}

// Repositories are plain objects — `this` is unreliable inside their method
// values, so this lives as a standalone function and both `fibersThrough`
// and `fibersEndingAt` call it directly.
async function fibersThrough(closureId) {
  const points = await prisma.fiberPoint.findMany({
    where: { closureId },
    include: { fiber: { select: { id: true, name: true, coreCount: true, status: true } } },
  })
  const maxSeqs = await prisma.fiberPoint.groupBy({
    by: ['fiberId'],
    where: { fiberId: { in: points.map((p) => p.fiberId) } },
    _max: { sequence: true },
  })
  const maxOf = Object.fromEntries(maxSeqs.map((m) => [m.fiberId, m._max.sequence]))
  return points.map((p) => ({ fiber: p.fiber, pointSeq: p.sequence, maxSeq: maxOf[p.fiberId] }))
}

export const closureRepository = {
  list: () => prisma.closure.findMany({ orderBy: { code: 'asc' }, include: withDetail }),
  findById: (id) => prisma.closure.findUnique({ where: { id }, include: withDetail }),
  create: (data, tx = prisma) => tx.closure.create({ data, include: withDetail }),
  update: (id, data, tx = prisma) => tx.closure.update({ where: { id }, data, include: withDetail }),
  delete: (id) => prisma.closure.delete({ where: { id } }),

  fibersThrough,
  fibersEndingAt: async (closureId) =>
    (await fibersThrough(closureId)).filter((x) => x.pointSeq === x.maxSeq).map((x) => x.fiber),

  createSplitter: (data, portCount) =>
    prisma.splitter.create({
      data: {
        ...data,
        outputs: { create: Array.from({ length: portCount }, (_, i) => ({ portNo: i + 1 })) },
      },
      include: { outputs: outputsWithTargets },
    }),
  findSplitterById: (id) => prisma.splitter.findUnique({ where: { id }, include: { outputs: true } }),
  updateSplitter: (id, data, newPortCount) => {
    if (!newPortCount) return prisma.splitter.update({ where: { id }, data, include: { outputs: true } })
    return prisma.$transaction(async (tx) => {
      const splitter = await tx.splitter.update({ where: { id }, data, include: { outputs: true } })
      await tx.splitterOutput.deleteMany({ where: { splitterId: id, portNo: { gt: newPortCount } } })
      await tx.splitterOutput.createMany({
        data: Array.from({ length: newPortCount }, (_, i) => ({ splitterId: id, portNo: i + 1 })),
        skipDuplicates: true,
      })
      return tx.splitter.findUnique({ where: { id }, include: { outputs: true } })
    })
  },
  deleteSplitter: (id) => prisma.splitter.delete({ where: { id } }),
  updateOutput: (splitterId, portNo, data, tx = prisma) =>
    tx.splitterOutput.update({ where: { splitterId_portNo: { splitterId, portNo } }, data }),

  // Consumed by a later task's service (fiber module), not this one.
  findManyWithSplitters: (ids) =>
    prisma.closure.findMany({ where: { id: { in: ids } }, include: { splitters: { include: { outputs: true } } } }),
  claimSplitterInput: (closureId, fiberId, tx = prisma) =>
    tx.splitter.updateMany({ where: { closureId, inputFiberId: null }, data: { inputFiberId: fiberId } }),
}
