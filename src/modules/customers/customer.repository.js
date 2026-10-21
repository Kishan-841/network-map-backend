import { prisma } from '../../lib/prisma.js'

export const customerRepository = {
  listByBuilding: (buildingId) =>
    prisma.customer.findMany({
      where: { buildingId },
      orderBy: { createdAt: 'asc' },
      include: { wing: { select: { id: true, name: true } } },
    }),

  findById: (id) =>
    prisma.customer.findUnique({ where: { id }, include: { wing: { select: { id: true, name: true } } } }),

  /** The building's located wings, for the wing picker and the list's grouping. */
  listWings: (buildingId) =>
    prisma.buildingWing.findMany({
      where: { buildingId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),

  findWing: (id) =>
    prisma.buildingWing.findUnique({ where: { id }, select: { id: true, name: true, buildingId: true } }),

  findByUsername: (username) => prisma.customer.findFirst({ where: { username } }),

  findByBuildingAndMobile: (buildingId, mobile) =>
    prisma.customer.findFirst({ where: { buildingId, mobile } }),

  create: (data) => prisma.customer.create({ data }),

  update: (id, data) => prisma.customer.update({ where: { id }, data }),

  /** entries: [{ id, snapshot }] — one transaction, stamps connCheckedAt. */
  saveConnectionSnapshots: (entries) => {
    if (!entries.length) return Promise.resolve([])
    const connCheckedAt = new Date()
    return prisma.$transaction(
      entries.map(({ id, snapshot }) =>
        prisma.customer.updateMany({ where: { id }, data: { ...snapshot, connCheckedAt } }),
      ),
    )
  },

  /** Customers with a Username, least recently checked first (never checked first),
   *  skipping excludeIds (rows the refresher is backing off from). */
  listForRefresh: (limit, excludeIds = []) =>
    prisma.customer.findMany({
      where: { username: { not: null }, NOT: { username: '' }, ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}) },
      orderBy: [{ connCheckedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: limit,
      select: { id: true, username: true },
    }),

  remove: (id) => prisma.customer.delete({ where: { id } }),

  // ── The all-customers list (spec 2026-10-21) ──

  /**
   * Every building that has a customer, lean: just the fields the building
   * read rule needs (readScope + isVisibleBuilding) and the names the list's
   * pickers show. One query; the scope is applied in memory by the service.
   */
  listBuildingsWithCustomers: () =>
    prisma.building.findMany({
      where: { customers: { some: {} } },
      select: {
        id: true,
        buildingName: true,
        zoneId: true,
        createdById: true,
        source: true,
        permissionApproval: true,
        zone: { select: { id: true, name: true } },
      },
      orderBy: [{ buildingName: 'asc' }, { id: 'asc' }],
    }),

  /** One page (or the export's first `take`) of the filtered list. */
  listPage: ({ where, orderBy, skip, take }) =>
    prisma.customer.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        building: { select: { id: true, buildingName: true, zone: { select: { id: true, name: true } } } },
        wing: { select: { id: true, name: true } },
      },
    }),

  count: (where) => prisma.customer.count({ where }),

  /** `{ [connState]: n }` for the filtered list — one grouped query. */
  countByConnState: async (where) => {
    const groups = await prisma.customer.groupBy({ by: ['connState'], where, _count: { _all: true } })
    return Object.fromEntries(groups.map((g) => [g.connState, g._count._all]))
  },

  /** Distinct non-empty values of one text column, sorted. */
  distinctValues: async (field, where) => {
    const groups = await prisma.customer.groupBy({
      by: [field],
      where: { AND: [where, { [field]: { not: null } }, { NOT: { [field]: '' } }] },
      orderBy: { [field]: 'asc' },
    })
    return groups.map((g) => g[field])
  },

  /** Located wings of many buildings, as `Map<buildingId, wings[]>`, for the import. */
  listWingsForBuildings: async (buildingIds) => {
    const rows = await prisma.buildingWing.findMany({
      where: { buildingId: { in: buildingIds } },
      select: { id: true, name: true, buildingId: true },
      orderBy: { name: 'asc' },
    })
    const byBuilding = new Map(buildingIds.map((id) => [id, []]))
    for (const row of rows) byBuilding.get(row.buildingId)?.push({ id: row.id, name: row.name })
    return byBuilding
  },

  /** Every stored customer of these buildings, with the names the import report shows. */
  listForImport: (buildingIds) =>
    prisma.customer.findMany({
      where: { buildingId: { in: buildingIds } },
      orderBy: { createdAt: 'asc' },
      include: {
        wing: { select: { id: true, name: true } },
        building: { select: { buildingName: true } },
      },
    }),

  /** Stored customers holding any of these Usernames, in any building. */
  listByUsernames: (usernames) =>
    usernames.length
      ? prisma.customer.findMany({
          where: { username: { in: usernames } },
          orderBy: { createdAt: 'asc' },
          include: {
            wing: { select: { id: true, name: true } },
            building: { select: { buildingName: true } },
          },
        })
      : Promise.resolve([]),

  /**
   * The import's writes, all or nothing: one `createMany` (explicit
   * `updatedAt`, as above) and one `update` per changed customer.
   */
  applyImport: ({ creates, updates }) => {
    const now = new Date()
    const ops = []
    if (creates.length) {
      ops.push(prisma.customer.createMany({ data: creates.map((row) => ({ ...row, updatedAt: now })) }))
    }
    for (const { id, data } of updates) ops.push(prisma.customer.update({ where: { id }, data }))
    return ops.length ? prisma.$transaction(ops) : Promise.resolve([])
  },

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
