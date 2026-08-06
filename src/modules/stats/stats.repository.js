import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

export const statsRepository = {
  countBuildings: (where) => prisma.building.count({ where }),
  countsByStatus: (where) =>
    prisma.building.groupBy({ by: ['feasibleStatus'], _count: { _all: true }, where }),
  countsByLive: (where) =>
    prisma.building.groupBy({ by: ['isLive'], _count: { _all: true }, where }),
  sumHomePass: (where) =>
    prisma.buildingDetails
      .aggregate({ _sum: { homePass: true }, where })
      .then((result) => result._sum.homePass),
  sumPermissionCost: (where) =>
    prisma.permission
      .aggregate({ _sum: { amountPaid: true }, where })
      .then((result) => result._sum.amountPaid),

  countOperators: () => prisma.operator.count(),
  countZones: (where) => prisma.zone.count({ where }),

  // Buildings + home pass per operator (all operators — the comparison chart).
  // Prisma can't group by a relation field, so this is a static join query.
  buildingsByOperator: () =>
    prisma.$queryRaw`
      SELECT o.id AS "operatorId", o.name AS "name",
             COUNT(b.id)::int AS "buildings",
             COALESCE(SUM(d."homePass"), 0)::int AS "homePass"
      FROM "Operator" o
      JOIN "Zone" z ON z."operatorId" = o.id
      JOIN "Building" b ON b."zoneId" = z.id
      LEFT JOIN "BuildingDetails" d ON d."buildingId" = b.id
      GROUP BY o.id, o.name
      ORDER BY "buildings" DESC`,

  // Buildings created per day since a cutoff, optionally scoped to a surveyor
  // and/or an operator. Params are bound, never string-interpolated.
  buildingsOverTime: ({ sinceDate, createdById = null, operatorId = null }) =>
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', b."createdAt"), 'YYYY-MM-DD') AS "date",
             COUNT(*)::int AS "count"
      FROM "Building" b
      JOIN "Zone" z ON z.id = b."zoneId"
      WHERE b."createdAt" >= ${sinceDate}
        AND (${createdById}::text IS NULL OR b."createdById" = ${createdById})
        AND (${operatorId}::text IS NULL OR z."operatorId" = ${operatorId})
      GROUP BY 1
      ORDER BY 1`,
}

export { Prisma }
