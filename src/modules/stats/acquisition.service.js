/**
 * Acquisition-team analytics for the lead dashboard: how much each agent
 * logged in a date range. Reads only ACQUISITION rows — the coverage
 * registry is never touched here.
 */
import { Prisma } from '@prisma/client'

export function createAcquisitionService({ prisma }) {
  const rangeWhere = ({ dateFrom, dateTo, agentId }) => ({
    source: 'ACQUISITION',
    ...(agentId && { createdById: agentId }),
    ...((dateFrom || dateTo) && {
      createdAt: {
        ...(dateFrom && { gte: new Date(dateFrom) }),
        ...(dateTo && { lte: new Date(`${dateTo}T23:59:59.999Z`) }),
      },
    }),
  })

  const startOf = (days) => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - days)
    return d
  }

  return {
    async getAcquisitionStats({ dateFrom, dateTo, agentId } = {}) {
      const where = rangeWhere({ dateFrom, dateTo, agentId })

      const [inRange, today, week, month, agents, perAgent, contacts] = await Promise.all([
        prisma.building.count({ where }),
        prisma.building.count({
          where: { source: 'ACQUISITION', createdAt: { gte: startOf(0) } },
        }),
        prisma.building.count({
          where: { source: 'ACQUISITION', createdAt: { gte: startOf(6) } },
        }),
        prisma.building.count({
          where: { source: 'ACQUISITION', createdAt: { gte: startOf(29) } },
        }),
        prisma.user.findMany({
          where: { role: 'ACQUISITION_AGENT' },
          select: {
            id: true,
            name: true,
            email: true,
            isActive: true,
            pincodes: { select: { pincode: true } },
          },
          orderBy: { name: 'asc' },
        }),
        prisma.building.groupBy({
          by: ['createdById'],
          where,
          _count: { _all: true },
          _max: { createdAt: true },
        }),
        prisma.buildingContact.count({ where: { building: where } }),
      ])

      const statsById = new Map(
        perAgent.map((row) => [row.createdById, { count: row._count._all, last: row._max.createdAt }]),
      )

      // Per-day trend for the chart (dates with zero rows are simply absent).
      // Values are BOUND, never interpolated — no string-built SQL.
      const conditions = [Prisma.sql`"source" = 'ACQUISITION'`]
      if (dateFrom) conditions.push(Prisma.sql`"createdAt" >= ${new Date(dateFrom)}`)
      if (dateTo) {
        conditions.push(Prisma.sql`"createdAt" <= ${new Date(`${dateTo}T23:59:59.999Z`)}`)
      }
      if (agentId) conditions.push(Prisma.sql`"createdById" = ${agentId}`)
      const trendRows = await prisma.$queryRaw`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS count
        FROM "Building"
        WHERE ${Prisma.join(conditions, ' AND ')}
        GROUP BY 1 ORDER BY 1`

      return {
        totalInRange: inRange,
        today,
        last7Days: week,
        last30Days: month,
        contactsCaptured: contacts,
        activeAgents: agents.filter((a) => a.isActive).length,
        agents: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          email: agent.email,
          isActive: agent.isActive,
          pincodes: agent.pincodes.map((p) => p.pincode),
          buildings: statsById.get(agent.id)?.count ?? 0,
          lastActivity: statsById.get(agent.id)?.last ?? null,
        })),
        trend: trendRows,
      }
    },
  }
}
