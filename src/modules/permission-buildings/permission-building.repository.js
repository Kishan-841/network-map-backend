import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { approvalTransition, transitionData, transitionVisit } from './approval.js'

const userLite = { select: { id: true, name: true } }
const visitInclude = { user: userLite }

// The filters as SQL — the list orders by latest activity (the newest history
// row), which Prisma cannot express, so the page of ids comes from SQL and the
// rows themselves from Prisma.
function whereSql({ createdById, status, approval, search }) {
  const conds = [Prisma.sql`b."source" = 'PERMISSION'`]
  if (createdById) conds.push(Prisma.sql`b."createdById" = ${createdById}`)
  if (status) conds.push(Prisma.sql`p."permissionStatus" = ${status}`)
  if (approval) conds.push(Prisma.sql`b."permissionApproval" = ${approval}`)
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`
    conds.push(Prisma.sql`(b."buildingName" ILIKE ${like} OR b."formattedAddress" ILIKE ${like})`)
  }
  return Prisma.join(conds, ' AND ')
}

export const permissionBuildingRepository = {
  async pageIds(filters, { skip, take }) {
    const where = whereSql(filters)
    const [rows, [{ total }]] = await Promise.all([
      prisma.$queryRaw`
        SELECT b.id
        FROM "Building" b
        LEFT JOIN "Permission" p ON p."buildingId" = b.id
        WHERE ${where}
        ORDER BY COALESCE(
          (SELECT MAX(v."createdAt") FROM "PermissionVisit" v WHERE v."buildingId" = b.id),
          b."createdAt"
        ) DESC, b.id DESC
        LIMIT ${take} OFFSET ${skip}`,
      prisma.$queryRaw`
        SELECT COUNT(*)::int AS total
        FROM "Building" b
        LEFT JOIN "Permission" p ON p."buildingId" = b.id
        WHERE ${where}`,
    ])
    return { ids: rows.map((r) => r.id), total }
  },

  listRows: (ids) =>
    prisma.building.findMany({
      where: { id: { in: ids }, source: 'PERMISSION' },
      select: {
        id: true,
        buildingName: true,
        formattedAddress: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        zone: { select: { id: true, name: true } },
        permissionApproval: true,
        approvalReason: true,
        approvalSubmittedAt: true,
        approvalDecidedAt: true,
        approvalDecidedBy: userLite,
        permission: { select: { permissionStatus: true } },
        contact: {
          select: { contactName: true, contactPhone: true, designation: true, designationOther: true },
        },
        createdBy: userLite,
        _count: { select: { permissionVisits: true } },
        permissionVisits: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true, remark: true, kind: true, user: userLite },
        },
      },
    }),

  /** Just enough to decide scope and the status before a visit. */
  findScopeRow: (id) =>
    prisma.building.findUnique({
      where: { id },
      select: {
        id: true,
        source: true,
        createdById: true,
        permissionApproval: true,
        permission: { select: { permissionStatus: true } },
      },
    }),

  findDetail: (id) =>
    prisma.building.findUnique({
      where: { id },
      include: {
        zone: { select: { id: true, name: true } },
        details: true,
        permission: true,
        contact: true,
        photos: { orderBy: { createdAt: 'asc' } },
        createdBy: userLite,
        approvalDecidedBy: userLite,
        permissionVisits: { orderBy: [{ createdAt: 'desc' }], include: visitInclude },
      },
    }),

  /**
   * One visit update, atomically and under a row lock on the building: the
   * current status and approval are read INSIDE the lock, so "before" can't be
   * stale against a concurrent visit, edit or decision; `guard(fresh)` may
   * throw to refuse (an approved society's locked status). Then the status
   * change (creating the Permission row if the society has none), the history
   * row, and — when the status it leaves behind calls for it — the approval
   * request or its withdrawal (phase 2).
   * `permissionStatus` undefined = no status given. Returns { visit, status }.
   */
  recordVisit: ({ buildingId, userId, remark, permissionStatus, guard }) =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Building" WHERE id = ${buildingId} FOR UPDATE`
      const fresh = await tx.building.findUnique({
        where: { id: buildingId },
        select: { permissionApproval: true, permission: { select: { permissionStatus: true } } },
      })
      const current = fresh?.permission?.permissionStatus ?? null
      guard?.({ approval: fresh?.permissionApproval ?? null, current })
      const changed = permissionStatus !== undefined && permissionStatus !== current
      if (changed) {
        await tx.permission.upsert({
          where: { buildingId },
          update: { permissionStatus },
          create: { buildingId, permissionStatus },
        })
      }
      const at = new Date()
      const status = changed ? permissionStatus : current
      const visit = await tx.permissionVisit.create({
        data: {
          buildingId,
          userId,
          remark,
          kind: 'VISIT',
          statusBefore: changed ? current : null,
          statusAfter: changed ? permissionStatus : null,
          createdAt: at,
        },
        include: visitInclude,
      })
      const transition = approvalTransition({ approval: fresh?.permissionApproval ?? null, statusAfter: status })
      if (transition) {
        await tx.building.update({ where: { id: buildingId }, data: transitionData(transition, at) })
        await tx.permissionVisit.create({ data: { buildingId, ...transitionVisit(transition, { userId, remark, at }) } })
      }
      return { visit, status }
    }),

  /**
   * The building already in `zoneId` that this society would duplicate once
   * approved into it — the same two checks a normal add / import makes (one
   * row per Place per zone; one name per zone), the society itself excluded.
   */
  findClashInZone: async (tx, { id, placeId, buildingName, zoneId }) => {
    const select = { id: true, buildingName: true }
    const samePlace = placeId
      ? await tx.building.findFirst({ where: { placeId, zoneId, id: { not: id } }, select })
      : null
    return (
      samePlace ??
      (await tx.building.findFirst({
        where: { zoneId, id: { not: id }, buildingName: { equals: buildingName, mode: 'insensitive' } },
        select,
      }))
    )
  },

  pendingCount: () => prisma.building.count({ where: { source: 'PERMISSION', permissionApproval: 'PENDING' } }),

  /**
   * An ADMIN's decision, under the same row lock: refused (409) unless the
   * society is still PENDING when locked; `data` is the Building update and
   * `visit` the history row to add with it.
   */
  decide: ({ buildingId, data, visit, notPending, beforeWrite }) =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Building" WHERE id = ${buildingId} FOR UPDATE`
      const fresh = await tx.building.findUnique({
        where: { id: buildingId },
        select: { id: true, buildingName: true, placeId: true, permissionApproval: true },
      })
      if (fresh?.permissionApproval !== 'PENDING') throw notPending()
      await beforeWrite?.(fresh, tx)
      await tx.building.update({
        where: { id: buildingId },
        data: { ...data, permissionVisits: { create: visit } },
      })
    }),
}
