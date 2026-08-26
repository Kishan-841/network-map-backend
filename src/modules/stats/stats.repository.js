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

  /**
   * Buildings + home pass per tier. Counting happens in the database, one
   * bounded range per tier, so this stays a handful of aggregates whatever the
   * table grows to — never "fetch every row and count them here".
   */
  // Composed with AND, never spread: the caller's where can itself carry an
  // OR (the surveyor's zone-or-own scope does), and spreading would silently
  // overwrite it — widening a scoped user's counts to the whole table.
  countBuildingsInHomePassRange: (where, { min, max }) =>
    prisma.building.count({
      where: {
        AND: [where, { details: { homePass: { gte: min, ...(max !== null && { lte: max }) } } }],
      },
    }),
  sumHomePassInRange: (buildingWhere, { min, max }) =>
    prisma.buildingDetails
      .aggregate({
        _sum: { homePass: true },
        where: { building: buildingWhere, homePass: { gte: min, ...(max !== null && { lte: max }) } },
      })
      .then((r) => r._sum.homePass ?? 0),
  /** Buildings with no home-pass figure at all — unmeasured, not "small". */
  countBuildingsUnrated: (where) =>
    prisma.building.count({
      where: {
        AND: [where, { OR: [{ details: { is: null } }, { details: { homePass: null } }] }],
      },
    }),

  // Buildings created per day since a cutoff, optionally scoped to a surveyor
  // and/or an operator. Params are bound, never string-interpolated.
  buildingsOverTime: ({ sinceDate, createdById = null, operatorId = null, cityId = null }) =>
    prisma.$queryRaw`
      SELECT to_char(date_trunc('day', b."createdAt"), 'YYYY-MM-DD') AS "date",
             COUNT(*)::int AS "count"
      FROM "Building" b
      JOIN "Zone" z ON z.id = b."zoneId"
      LEFT JOIN "Operator" o ON o.id = z."operatorId"
      WHERE b."createdAt" >= ${sinceDate}
        AND (${createdById}::text IS NULL OR b."createdById" = ${createdById})
        AND (${operatorId}::text IS NULL OR z."operatorId" = ${operatorId})
        AND (${cityId}::text IS NULL OR o."cityId" = ${cityId})
      GROUP BY 1
      ORDER BY 1`,
}

export { Prisma }
