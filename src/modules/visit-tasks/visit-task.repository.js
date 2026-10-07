import { prisma } from '../../lib/prisma.js'
import { ApiError } from '../../lib/api-error.js'
import { dateOnly } from '../../lib/visit-plan.js'
import { releaseStrandedTasks, strandedTasks } from '../../lib/handover-tasks.js'

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
   * Hand one building to an executive: close its ACTIVE assignment, open a new
   * one. With `allowedHolderIds` (a team leader planning) the building is locked
   * and its holder re-checked inside the transaction, as importPlan does.
   * The previous holder's planned tasks there from today on are dropped
   * (lib/handover-tasks.js) — they could never be checked in.
   */
  assignBuilding: ({ buildingId, assigneeId, actorId, allowedHolderIds, now = new Date() }) =>
    prisma.$transaction(async (tx) => {
      if (allowedHolderIds) {
        await tx.$queryRaw`SELECT id FROM "Building" WHERE id = ${buildingId} FOR UPDATE`
        const held = await tx.buildingAssignment.findFirst({
          where: { buildingId, status: 'ACTIVE', assignedToId: { notIn: allowedHolderIds } },
          select: { building: { select: { buildingName: true } } },
        })
        if (held) throw ApiError.badRequest(`${held.building.buildingName} is held by another team`)
      }
      await releaseStrandedTasks(tx, { buildingIds: [buildingId], newHolderId: assigneeId, now })
      await tx.buildingAssignment.updateMany({ where: { buildingId, status: 'ACTIVE' }, data: { status: 'REASSIGNED', endedAt: new Date() } })
      await tx.buildingAssignment.create({ data: { buildingId, assignedToId: assigneeId, assignedById: actorId } })
    }),

  /**
   * One transaction: close + re-open building assignments (dropping the
   * previous holders' tasks there from today on), delete the replaced tasks,
   * create the new ones, record the upload.
   * `assignments`: [{ assigneeId, buildingIds }]; `deletes`: task ids;
   * `creates`: [{ assigneeId, buildingId, taskDate:'YYYY-MM-DD', startTime, endTime }].
   * With `allowedHolderIds` (a team leader planning), the buildings are locked
   * and their holders re-checked inside the transaction — mirrors
   * salesRepository.reassign — so another team cannot lose a building in the
   * gap between the service's check and this write.
   */
  importPlan: ({ actorId, assignments, deletes, creates, upload, allowedHolderIds, now = new Date() }) =>
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
      let released = 0
      for (const { assigneeId, buildingIds } of assignments) {
        if (!buildingIds.length) continue
        released += await releaseStrandedTasks(tx, { buildingIds, newHolderId: assigneeId, now })
        await tx.buildingAssignment.updateMany({
          where: { buildingId: { in: buildingIds }, status: 'ACTIVE' },
          data: { status: 'REASSIGNED', endedAt: new Date() },
        })
        await tx.buildingAssignment.createMany({
          data: buildingIds.map((buildingId) => ({ buildingId, assignedToId: assigneeId, assignedById: actorId })),
        })
        assigned += buildingIds.length
      }
      const { count: deleted } = deletes.length
        ? await tx.visitTask.deleteMany({ where: { id: { in: deletes } } })
        : { count: 0 }
      // `replaced` covers both: the planned assignees' replaced tasks and the
      // previous holders' tasks at the buildings handed over.
      const replaced = deleted + released
      const row = await tx.taskUpload.create({
        data: { ...upload, fromDate: dateOnly(upload.fromDate), toDate: dateOnly(upload.toDate),
          uploadedById: actorId, created: creates.length, replaced, assigned },
      })
      await tx.visitTask.createMany({
        data: creates.map((t) => ({ ...t, taskDate: dateOnly(t.taskDate), uploadId: row.id, createdById: actorId })),
      })
      return { uploadId: row.id, created: creates.length, replaced, assigned }
    }, { timeout: 60000 }),

  /** Read-only: what handing these buildings to `newHolderId` would drop (preview). */
  strandedTasks: ({ buildingIds, newHolderId, now }) => strandedTasks(prisma, { buildingIds, newHolderId, now }),

  listUploads: (where) =>
    prisma.taskUpload.findMany({
      where,
      include: { uploadedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
}
