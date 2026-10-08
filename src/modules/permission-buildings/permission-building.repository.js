import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'

const userLite = { select: { id: true, name: true } }
const visitInclude = { user: userLite }

// The filters as SQL — the list orders by latest activity (the newest history
// row), which Prisma cannot express, so the page of ids comes from SQL and the
// rows themselves from Prisma.
function whereSql({ createdById, status, search }) {
  const conds = [Prisma.sql`b."source" = 'PERMISSION'`]
  if (createdById) conds.push(Prisma.sql`b."createdById" = ${createdById}`)
  if (status) conds.push(Prisma.sql`p."permissionStatus" = ${status}`)
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
      select: { id: true, source: true, createdById: true, permission: { select: { permissionStatus: true } } },
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
        permissionVisits: { orderBy: [{ createdAt: 'desc' }], include: visitInclude },
      },
    }),

  /**
   * One visit update, atomically: the status change (creating the Permission
   * row if the society has none) and its history row.
   */
  async recordVisit({ buildingId, userId, remark, statusBefore, statusAfter }) {
    const visit = prisma.permissionVisit.create({
      data: { buildingId, userId, remark, kind: 'VISIT', statusBefore, statusAfter },
      include: visitInclude,
    })
    if (statusAfter === null) return visit
    const [, created] = await prisma.$transaction([
      prisma.permission.upsert({
        where: { buildingId },
        update: { permissionStatus: statusAfter },
        create: { buildingId, permissionStatus: statusAfter },
      }),
      visit,
    ])
    return created
  },
}
