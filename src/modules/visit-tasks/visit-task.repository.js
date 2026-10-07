import { prisma } from '../../lib/prisma.js'
import { ApiError } from '../../lib/api-error.js'
import { dateOnly } from '../../lib/visit-plan.js'

const userLite = { id: true, name: true, email: true, role: true, managerId: true, teamLeaderId: true, isActive: true }
const buildingLite = {
  id: true, buildingName: true, formattedAddress: true, zoneId: true,
  salesAssignments: { where: { status: 'ACTIVE' }, take: 1, select: { assignedToId: true } },
}
const taskInclude = {
  assignee: { select: { id: true, name: true } },
  building: { select: { id: true, buildingName: true, formattedAddress: true } },
}

export const visitTaskRepository = {
  listUsersForPlanning: (where) => prisma.user.findMany({ where, select: userLite, orderBy: { name: 'asc' } }),

  zoneIdsFor: async (userId) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { assignedZones: { select: { id: true } } } }))
      ?.assignedZones.map((z) => z.id) ?? [],

  listBuildingsLite: (where) => prisma.building.findMany({ where, select: buildingLite }),

  searchBuildings: (where, q, take = 10) =>
    prisma.building.findMany({
      where: { AND: [where, { OR: [
        { buildingName: { contains: q, mode: 'insensitive' } },
        { formattedAddress: { contains: q, mode: 'insensitive' } },
      ] }] },
      select: buildingLite,
      take,
      orderBy: { buildingName: 'asc' },
    }),

  tasksInRange: ({ assigneeIds, from, to }) =>
    prisma.visitTask.findMany({
      where: {
        ...(assigneeIds ? { assigneeId: { in: assigneeIds } } : {}),
        taskDate: { gte: dateOnly(from), lte: dateOnly(to) },
      },
      include: taskInclude,
      orderBy: [{ taskDate: 'asc' }, { startTime: 'asc' }],
    }),

  visitsInRange: ({ userIds, from, to }) =>
    prisma.buildingVisit.findMany({
      where: { ...(userIds ? { userId: { in: userIds } } : {}), visitedAt: { gte: from, lt: to } },
      select: {
        id: true, userId: true, buildingId: true, visitedAt: true, checkOutAt: true,
        building: { select: { id: true, buildingName: true } },
      },
      orderBy: { visitedAt: 'asc' },
    }),

  findTask: (id) => prisma.visitTask.findUnique({ where: { id }, include: taskInclude }),
  createTask: (data) => prisma.visitTask.create({ data, include: taskInclude }),
  updateTask: (id, data) => prisma.visitTask.update({ where: { id }, data, include: taskInclude }),
  deleteTask: (id) => prisma.visitTask.delete({ where: { id } }),

  /**
   * One transaction: close + re-open building assignments, delete the replaced
   * tasks, create the new ones, record the upload.
   * `assignments`: [{ assigneeId, buildingIds }]; `deletes`: task ids;
   * `creates`: [{ assigneeId, buildingId, taskDate:'YYYY-MM-DD', startTime, endTime }].
   * With `allowedHolderIds` (a team leader planning), the buildings are locked
   * and their holders re-checked inside the transaction — mirrors
   * salesRepository.reassign — so another team cannot lose a building in the
   * gap between the service's check and this write.
   */
  importPlan: ({ actorId, assignments, deletes, creates, upload, allowedHolderIds }) =>
    prisma.$transaction(async (tx) => {
      const lockIds = assignments.flatMap((a) => a.buildingIds)
      if (allowedHolderIds && lockIds.length) {
        await tx.$queryRaw`SELECT id FROM "Building" WHERE id = ANY(${lockIds}) FOR UPDATE`
        const held = await tx.buildingAssignment.findFirst({
          where: { buildingId: { in: lockIds }, status: 'ACTIVE', assignedToId: { notIn: allowedHolderIds } },
          select: { building: { select: { buildingName: true } } },
        })
        if (held) throw ApiError.badRequest(`${held.building.buildingName} is held by another team`)
      }
      let assigned = 0
      for (const { assigneeId, buildingIds } of assignments) {
        if (!buildingIds.length) continue
        await tx.buildingAssignment.updateMany({
          where: { buildingId: { in: buildingIds }, status: 'ACTIVE' },
          data: { status: 'REASSIGNED', endedAt: new Date() },
        })
        await tx.buildingAssignment.createMany({
          data: buildingIds.map((buildingId) => ({ buildingId, assignedToId: assigneeId, assignedById: actorId })),
        })
        assigned += buildingIds.length
      }
      const { count: replaced } = deletes.length
        ? await tx.visitTask.deleteMany({ where: { id: { in: deletes } } })
        : { count: 0 }
      const row = await tx.taskUpload.create({
        data: { ...upload, fromDate: dateOnly(upload.fromDate), toDate: dateOnly(upload.toDate),
          uploadedById: actorId, created: creates.length, replaced, assigned },
      })
      await tx.visitTask.createMany({
        data: creates.map((t) => ({ ...t, taskDate: dateOnly(t.taskDate), uploadId: row.id, createdById: actorId })),
      })
      return { uploadId: row.id, created: creates.length, replaced, assigned }
    }, { timeout: 60000 }),

  listUploads: (where) =>
    prisma.taskUpload.findMany({
      where,
      include: { uploadedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
}
