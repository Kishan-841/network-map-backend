import { prisma } from '../../lib/prisma.js'

export const statsRepository = {
  countBuildings: (where) => prisma.building.count({ where }),
  countsByStatus: (where) =>
    prisma.building.groupBy({ by: ['feasibleStatus'], _count: { _all: true }, where }),
  sumHomePass: (where) =>
    prisma.buildingDetails
      .aggregate({ _sum: { homePass: true }, where })
      .then((result) => result._sum.homePass),
  sumPermissionCost: (where) =>
    prisma.permission
      .aggregate({ _sum: { amountPaid: true }, where })
      .then((result) => result._sum.amountPaid),
}
