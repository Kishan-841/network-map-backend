import { prisma } from '../../lib/prisma.js'

export const customerRepository = {
  listByBuilding: (buildingId) =>
    prisma.customer.findMany({ where: { buildingId }, orderBy: { createdAt: 'asc' } }),

  findById: (id) => prisma.customer.findUnique({ where: { id } }),

  findByBuildingAndMobile: (buildingId, mobile) =>
    prisma.customer.findFirst({ where: { buildingId, mobile } }),

  create: (data) => prisma.customer.create({ data }),

  update: (id, data) => prisma.customer.update({ where: { id }, data }),

  remove: (id) => prisma.customer.delete({ where: { id } }),

  /**
   * The import writes in one statement. `updatedAt` is passed explicitly —
   * `createMany` skips Prisma's `@updatedAt` and the column has no DB default.
   */
  createMany: (rows) =>
    prisma.customer.createMany({ data: rows.map((row) => ({ ...row, updatedAt: new Date() })) }),

  /** Every (building, mobile) already stored, for the import's duplicate check. */
  listMobilesForBuildings: (buildingIds) =>
    prisma.customer.findMany({
      where: { buildingId: { in: buildingIds } },
      select: { buildingId: true, mobile: true },
    }),

  /** Lean existence lookups — a building row carries a lot we do not need. */
  findBuildingIds: async (ids) => {
    const rows = await prisma.building.findMany({ where: { id: { in: ids } }, select: { id: true } })
    return rows.map((row) => row.id)
  },

  /**
   * Every building, lean, for the import's name matching. The matching folds
   * punctuation away ("Vardhaman Vatika, Phase 1" == "vardhaman vatika phase1"),
   * which SQL cannot express, so the comparison happens in
   * `src/lib/customers.js` — ~1.7k small rows, one query.
   */
  listBuildingsForLookup: () =>
    prisma.building.findMany({
      select: {
        id: true,
        buildingName: true,
        formattedAddress: true,
        zone: { select: { name: true } },
      },
      orderBy: { buildingName: 'asc' },
    }),
}
