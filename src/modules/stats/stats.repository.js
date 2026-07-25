import { prisma } from '../../lib/prisma.js'

export const statsRepository = {
  countBuildings: () => prisma.building.count(),
  countsByStatus: () =>
    prisma.building.groupBy({ by: ['feasibleStatus'], _count: { _all: true } }),
  sumHomePass: () =>
    prisma.buildingDetails
      .aggregate({ _sum: { homePass: true } })
      .then((result) => result._sum.homePass),
  sumPermissionCost: () =>
    prisma.permission
      .aggregate({ _sum: { amountPaid: true } })
      .then((result) => result._sum.amountPaid),
}
