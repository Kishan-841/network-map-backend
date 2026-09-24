import { prisma } from '../../lib/prisma.js'

// What a scoped building row returns to the field team — enough to list and map
// it, plus its current holder. Never the whole registry shape.
const buildingCard = {
  id: true,
  buildingName: true,
  formattedAddress: true,
  latitude: true,
  longitude: true,
  zoneId: true,
  isLive: true,
  feasibleStatus: true,
  surveyStatus: true,
  salesAssignments: {
    where: { status: 'ACTIVE' },
    take: 1,
    select: {
      assignedToId: true,
      assignedAt: true,
      assignedTo: { select: { id: true, name: true, role: true } },
    },
  },
}

const holder = { select: { id: true, name: true, role: true } }

export const salesRepository = {
  findUser: (id) =>
    prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true, managerId: true, teamLeaderId: true, isActive: true },
    }),

  // The sales users an actor may assign buildings TO: an admin sees every sales
  // user; a manager their own reports; a leader their own executives.
  teamMembers: (actor) => {
    const where =
      actor.role === 'ADMIN'
        ? { role: { in: ['SALES_MANAGER', 'TEAM_LEADER', 'SALES_EXECUTIVE'] }, isActive: true }
        : actor.role === 'SALES_MANAGER'
          ? { managerId: actor.id, isActive: true }
          : actor.role === 'TEAM_LEADER'
            ? { teamLeaderId: actor.id, isActive: true }
            : { id: '__none__' }
    return prisma.user.findMany({
      where,
      select: { id: true, name: true, role: true, managerId: true, teamLeaderId: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    })
  },

  idsUnderManager: (managerId) =>
    prisma.user.findMany({ where: { managerId }, select: { id: true } }).then((r) => r.map((u) => u.id)),

  idsUnderTeamLeader: (teamLeaderId) =>
    prisma.user
      .findMany({ where: { teamLeaderId }, select: { id: true } })
      .then((r) => r.map((u) => u.id)),

  listBuildings: (scopeWhere) =>
    prisma.building.findMany({ where: scopeWhere, select: buildingCard, orderBy: { buildingName: 'asc' } }),

  // Registry search for assignment — name or address, with the current holder.
  searchBuildings: (q) =>
    prisma.building.findMany({
      where: {
        OR: [
          { buildingName: { contains: q, mode: 'insensitive' } },
          { formattedAddress: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: buildingCard,
      orderBy: { buildingName: 'asc' },
      take: 30,
    }),

  countExisting: (ids) => prisma.building.count({ where: { id: { in: ids } } }),

  // Of these building ids, the ones whose ACTIVE holder is in the scope set
  // (null scope = admin = every id that has an active assignment).
  assignedInScope: (buildingIds, scopeIds) =>
    prisma.buildingAssignment
      .findMany({
        where: {
          buildingId: { in: buildingIds },
          status: 'ACTIVE',
          ...(scopeIds === null ? {} : { assignedToId: { in: scopeIds } }),
        },
        select: { buildingId: true },
      })
      .then((r) => new Set(r.map((a) => a.buildingId))),

  history: (buildingId) =>
    prisma.buildingAssignment.findMany({
      where: { buildingId },
      orderBy: { assignedAt: 'desc' },
      include: { assignedTo: holder, assignedBy: holder },
    }),

  buildingExists: (id) => prisma.building.findUnique({ where: { id }, select: { id: true } }),

  buildingBasic: (id) =>
    prisma.building.findUnique({ where: { id }, select: { id: true, buildingName: true, formattedAddress: true } }),

  createVisit: (data) => prisma.buildingVisit.create({ data }),

  // The user's current OPEN visit (not yet checked out), if any.
  openVisitFor: (userId) =>
    prisma.buildingVisit.findFirst({
      where: { userId, checkOutAt: null },
      include: {
        building: { select: { id: true, buildingName: true, formattedAddress: true } },
        activities: { orderBy: { createdAt: 'asc' } },
        inquiries: { select: { id: true, customerName: true } },
      },
    }),

  // A visit the actor owns — for adding an activity, checking out, or linking an
  // inquiry. Returns enough to tell whether it is still open.
  ownedVisit: (id, userId) =>
    prisma.buildingVisit.findFirst({ where: { id, userId }, select: { id: true, buildingId: true, checkOutAt: true } }),

  // One visit in full, scoped by userWhere ({} for admin), for the detail page.
  getVisit: (id, userWhere) =>
    prisma.buildingVisit.findFirst({
      where: { id, ...userWhere },
      include: {
        user: holder,
        building: { select: { id: true, buildingName: true, formattedAddress: true, latitude: true, longitude: true } },
        activities: { orderBy: { createdAt: 'asc' } },
        inquiries: { select: { id: true, customerName: true, phone: true, email: true, createdAt: true } },
      },
    }),

  // Idempotent — the type is a set member, so re-adding it is a no-op.
  addActivity: ({ visitId, type }) =>
    prisma.visitActivity.upsert({ where: { visitId_type: { visitId, type } }, create: { visitId, type }, update: {} }),

  removeActivity: (visitId, type) => prisma.visitActivity.deleteMany({ where: { visitId, type } }),

  checkoutVisit: (id, data) => prisma.buildingVisit.update({ where: { id }, data }),

  createInquiry: (data) => prisma.customerInquiry.create({ data }),

  // The service builds the scoped `where` (a fail-closed id set + optional
  // date / building filters); these just run it.
  listVisits: (where) =>
    prisma.buildingVisit.findMany({
      where,
      orderBy: { visitedAt: 'desc' },
      take: 500,
      include: {
        user: holder,
        building: { select: { id: true, buildingName: true, formattedAddress: true } },
        activities: { orderBy: { createdAt: 'asc' } },
        inquiries: { select: { id: true, customerName: true, phone: true, email: true, createdAt: true } },
      },
    }),

  listInquiries: (where) =>
    prisma.customerInquiry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { createdBy: holder, building: { select: { id: true, buildingName: true } } },
    }),

  countVisits: (where) => prisma.buildingVisit.count({ where }),
  countInquiries: (where) => prisma.customerInquiry.count({ where }),
  visitsByUser: (where) => prisma.buildingVisit.groupBy({ by: ['userId'], where, _count: { _all: true } }),
  inquiriesByUser: (where) =>
    prisma.customerInquiry.groupBy({ by: ['createdById'], where, _count: { _all: true } }),

  // Close every ACTIVE assignment for these buildings, then open a fresh one —
  // in one transaction, so history is preserved and a building never has two
  // ACTIVE holders.
  reassign: ({ buildingIds, assignedToId, assignedById }) =>
    prisma.$transaction([
      prisma.buildingAssignment.updateMany({
        where: { buildingId: { in: buildingIds }, status: 'ACTIVE' },
        data: { status: 'REASSIGNED', endedAt: new Date() },
      }),
      prisma.buildingAssignment.createMany({
        data: buildingIds.map((buildingId) => ({ buildingId, assignedToId, assignedById })),
      }),
    ]),
}
